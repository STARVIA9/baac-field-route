// Harness: คลังหนี้แยกคีย์ตามสาขา (debt:data:b:<baac>) — กันคลังรวมใหญ่เกินจนเขียนไม่ลง
// รัน: node tests/test_debt_kv_split.mjs
import { onRequestPost as debtImport } from '../functions/api/debt-import.js';
import { onRequestGet as debtData } from '../functions/api/debt-data.js';
import { signHS256 } from '../functions/_lib/jwt.js';

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' — ' + extra : '')); if (!c) fails++; };

const SECRET = 'test-secret-at-least-32-chars-long!!';
const NOW = Math.floor(Date.now() / 1000);
const tok = (sub, role, branch) => signHS256({ sub, username: sub, role, branch, pv: 1, exp: NOW + 3600 }, SECRET);
const adminTok = await tok('adm', 'admin', 'WTC');
const staff145 = await tok('k1', 'user', '145');
const ba291 = await tok('bs', 'branch_admin', '291');

function tis(str) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0E01 && cp <= 0x0E5B) out.push(0xA1 + (cp - 0x0E01));
    else if (cp < 128) out.push(cp);
    else out.push(0x3F);
  }
  return new Uint8Array(out);
}
function row(branch, cif, name, cls = '1', bal = '1000') {
  const c = new Array(140).fill('');
  c[2] = branch + ' - สาขาทดสอบ'; c[5] = name; c[7] = cif; c[24] = bal; c[30] = cls;
  return c.join(',');
}
const csv = (rows) => ['ข้อมูล ณ 15/11/2569', new Array(140).fill('h').join(','), ...rows].join('\n');

function makeKV(init = {}, { failOn = [] } = {}) {
  const m = new Map(Object.entries(init));
  return {
    get: async k => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => {
      if (failOn.some(p => k === p)) throw new Error('KV PUT too large: ' + k);
      m.set(k, v);
    },
    delete: async k => { m.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }),
    _map: m,
  };
}
function makeDB() {
  return {
    prepare(sql) {
      const st = { bind: () => st, all: async () => ({ results: [] }), first: async () => null, run: async () => ({}) };
      return st;
    },
    batch: async () => [],
  };
}
const reqUpload = (text, t) => {
  const fd = new FormData();
  fd.append('file', new File([tis(text)], 'ci.csv', { type: 'text/csv' }));
  return new Request('https://x/api/debt-import', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: fd });
};
const reqGet = (t) => new Request('https://x/api/debt-data', { headers: { Authorization: 'Bearer ' + t } });

const MIXED = csv([
  row('854', 'C85401', 'ลูกค้าวังท่าช้าง'),
  row('145', 'C14501', 'ลูกค้ากบินทร์ 1'),
  row('145', 'C14502', 'ลูกค้ากบินทร์ 2'),
]);

// ===== 1) อัพไฟล์ 2 สาขา → เขียนคีย์แยกสาขา + index =====
{
  const kv = makeKV();
  const env = { BFR_JWT_SECRET: SECRET, BFR_KV: kv, BFR_DB: makeDB() };
  const res = await debtImport({ request: reqUpload(MIXED, adminTok), env });
  const j = await res.json();
  ok('import 2 สาขา: 200', res.status === 200, j.error || '');
  ok('import: เขียนคีย์ 854', !!kv._map.get('debt:data:b:854'), '');
  ok('import: เขียนคีย์ 145', !!kv._map.get('debt:data:b:145'), '');
  const n145 = JSON.parse(kv._map.get('debt:data:b:145') || '[]').length;
  ok('import: คีย์ 145 มี 2 ราย', n145 === 2, 'n=' + n145);
  const idx = JSON.parse(kv._map.get('debt:index') || '[]');
  ok('import: debt:index ครบ 2 สาขา', idx.length === 2, JSON.stringify(idx));

  // ===== 2) พนักงานสาขา 145 อ่านได้เฉพาะของตัวเอง =====
  const r2 = await debtData({ request: reqGet(staff145), env });
  const rows145 = await r2.json();
  ok('staff 145: ได้ 2 ราย', Array.isArray(rows145) && rows145.length === 2, 'n=' + (rows145 || []).length);
  ok('staff 145: ทุกรายเป็นสาขา 145', (rows145 || []).every(x => x.branch === '145'));
  ok('staff 145: X-Debt-Source = kv-branch', r2.headers.get('X-Debt-Source') === 'kv-branch', r2.headers.get('X-Debt-Source'));

  // ===== 3) แอดมินกลาง เห็นรวมทุกสาขา =====
  const r3 = await debtData({ request: reqGet(adminTok), env });
  const all = await r3.json();
  ok('admin: เห็นรวม 3 ราย', Array.isArray(all) && all.length === 3, 'n=' + (all || []).length);
  ok('admin: X-Debt-Source = kv-branch-all', r3.headers.get('X-Debt-Source') === 'kv-branch-all', r3.headers.get('X-Debt-Source'));
}

// ===== 4) เขียนคลังรวมล้ม (ใหญ่เกิน) → คีย์แยกสาขาต้องยังสำเร็จ =====
{
  const kv = makeKV({}, { failOn: ['debt:data'] });
  const env = { BFR_JWT_SECRET: SECRET, BFR_KV: kv, BFR_DB: makeDB() };
  const res = await debtImport({ request: reqUpload(MIXED, adminTok), env });
  const j = await res.json();
  ok('คลังรวมล้ม: import ยัง 200', res.status === 200, j.error || '');
  ok('คลังรวมล้ม: kv_written = true (คีย์แยกสาขาสำเร็จ)', j.kv_written === true, String(j.kv_written));
  ok('คลังรวมล้ม: รายงาน kv_combined เป็น error', String(j.kv_combined || '').startsWith('error'), String(j.kv_combined));
  ok('คลังรวมล้ม: ยังมีคีย์ 145/854', !!kv._map.get('debt:data:b:145') && !!kv._map.get('debt:data:b:854'));
  const last = JSON.parse(kv._map.get('debt:last-import') || '{}');
  ok('คลังรวมล้ม: บันทึก debt:last-import ไว้ debug', last.kv_written === true && !!last.kv_error, JSON.stringify(last).slice(0, 120));
}

// ===== 5) สาขาใหม่ 291 ที่ยังไม่มีข้อมูล → คืน array ว่าง (ไม่หลุดข้อมูลสาขาอื่น) =====
{
  const kv = makeKV();
  const env = { BFR_JWT_SECRET: SECRET, BFR_KV: kv, BFR_DB: makeDB() };
  await debtImport({ request: reqUpload(MIXED, adminTok), env });
  const r = await debtData({ request: reqGet(ba291), env });
  const rows = await r.json();
  ok('สาขา 291 ไม่มีข้อมูล: ได้ [] (ไม่ใช่ของสาขาอื่น)', Array.isArray(rows) && rows.length === 0, 'n=' + (rows || []).length);
}

console.log(fails ? `\n❌ FAIL ${fails} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(fails ? 1 : 0);
