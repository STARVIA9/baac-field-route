// self-check เดียวตามแผน §1.6 — ไม่ทำ framework เทสต์
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { parseCI, buildPack, makePackKey, CODE_HEX_LEN } from '../ci-app/public/js/ci-pack.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const SECRET = enc.encode('selftest-secret-key-0123456789');

function ciFile(branch = '854') {
  const header = Array.from({ length: 30 }, (_, i) => `col${i}`);
  header[2] = 'สาขา2'; header[7] = 'CIF'; header[22] = 'สัญญา'; header[24] = 'หนี้คงเหลือ';
  const row = (cif, debt) => {
    const r = Array.from({ length: 30 }, (_, i) => '');
    r[0] = '1'; r[1] = 'ทดสอบ'; r[2] = `${branch} - สาขาทดสอบ`;
    r[7] = cif; r[22] = `CT-${cif}`; r[24] = debt;
    return r.join(',');
  };
  return enc.encode(['รายงานทดสอบ (ข้อมูลสังเคราะห์)', header.join(','),
    row('0000123456', '100000'), row('0000123456', '50000'), row('0000999999', '25000')].join('\n'));
}

function unpack(pack) {
  const dv = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  let p = 5;
  const bl = dv.getUint8(p++); const branch = dec.decode(pack.slice(p, p + bl)); p += bl;
  const vl = dv.getUint8(p++); const version = dec.decode(pack.slice(p, p + vl)); p += vl;
  const iv = pack.slice(p, p + 12); p += 12;
  return { branch, version, iv, ct: pack.slice(p) };
}

const parsed = parseCI(ciFile());
assert.equal(parsed.branch, '854');
assert.equal(parsed.stats.cif, 2, 'CIF ซ้ำต้องถูกนับครั้งเดียว');
assert.equal(parsed.stats.rows, 3);
assert.equal(parsed.stats.contracts, 2);
assert.equal(parsed.stats.debt, 175000);
const mixed = ['หัว', Array.from({ length: 9 }, (_, i) => `c${i}`).join(','),
  'x,y,854 - ก,c3,c4,c5,c6,CIF1', 'x,y,145 - ข,c3,c4,c5,c6,CIF2'].join('\n');
assert.throws(() => parseCI(enc.encode(mixed)), /หลายสาขา/);

const a = await buildPack({ ciBuf: ciFile(), secretBuf: SECRET, expectedBranch: '854', version: '2026-11-21' });
const b = await buildPack({ ciBuf: ciFile(), secretBuf: SECRET, expectedBranch: '854', version: '2026-11-21' });
assert.ok(!('codeOf' in a.manifest) && typeof a.manifest.rows === 'number', 'manifest ห้ามมีข้อมูลลูกค้า (มีแต่จำนวนนับ)');
assert.equal(a.manifest.filename, '854.bfrpack', 'ชื่อไฟล์ต้องคงที่ตามแผน §11');
assert.equal(a.manifest.sha256.length, 64);
assert.equal(a.manifest.cif, 2);
await assert.rejects(() => buildPack({ ciBuf: ciFile(), secretBuf: SECRET, expectedBranch: '145', version: 'v' }), /ไม่ตรง/);

const h = unpack(a.pack);
assert.equal(h.branch, '854');
const key = await makePackKey(SECRET, '854');
const payload = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: h.iv }, key, h.ct)));
assert.equal(payload.rows.length, 3);
assert.equal(Object.keys(payload.codeOf).length, 2);
assert.ok(Object.keys(payload.codeOf).every(c => c.length === CODE_HEX_LEN && /^[0-9a-f]+$/.test(c)));
const payload2 = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unpack(b.pack).iv }, key, unpack(b.pack).ct)));
assert.deepEqual(payload2.codeOf, payload.codeOf, 'CIF เดิมต้องได้รหัสเดิมทุกครั้ง');

const tampered = a.pack.slice();
tampered[tampered.length - 1] ^= 1;
const th = unpack(tampered);
await assert.rejects(() => crypto.subtle.decrypt({ name: 'AES-GCM', iv: th.iv }, key, th.ct));

const wrong = await makePackKey(enc.encode('another-secret'), '854');
await assert.rejects(() => crypto.subtle.decrypt({ name: 'AES-GCM', iv: h.iv }, wrong, h.ct));

console.log('PASS ci-pack self-check — rows=3 cif=2 codeLen=12 pack=' + a.pack.byteLength + 'B sha256=' + a.manifest.sha256.slice(0, 12));
