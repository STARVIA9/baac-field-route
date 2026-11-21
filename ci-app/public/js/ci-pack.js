// ci-pack.js — อ่าน CI / ทำรหัสสุ่ม / เข้ารหัสซอง (ทำงานในเบราว์เซอร์เท่านั้น)
// กฎ: ข้อมูลลูกค้าดิบไม่ถูกส่งขึ้นเซิร์ฟเวอร์ · secret ไม่ถูกส่งขึ้นเซิร์ฟเวอร์

export const COL = { BRANCH: 2, CIF: 7, CONTRACT: 22, DEBT: 24 };
export const CODE_HEX_LEN = 12; // ≥10 ตัวตามแผน §7.3
const MAGIC = 'BFRP1';
const enc = new TextEncoder();

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseLine(line, delim) {
  if (delim === '\t') return line.split('\t').map(s => s.trim());
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delim && !quoted) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// TIS-620 / windows-874 — ชื่อคอลัมน์ในไฟล์ CI เป็นภาษาไทย
function decodeText(buf) {
  for (const label of ['windows-874', 'tis-620', 'iso-8859-11']) {
    try { return new TextDecoder(label).decode(buf); } catch { /* try next */ }
  }
  return new TextDecoder().decode(buf);
}

export function parseCI(buf) {
  const text = decodeText(buf);
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) throw new Error('ไฟล์ CI ไม่มีแถวหัวคอลัมน์หรือไม่มีข้อมูล');
  const header = lines[1];
  const tabs = (header.match(/\t/g) || []).length;
  const commas = (header.match(/,/g) || []).length;
  const delim = tabs >= commas ? '\t' : ',';
  const rows = lines.slice(2).map(l => parseLine(l, delim)).filter(r => r.length > COL.CIF);
  if (!rows.length) throw new Error('ไฟล์ CI ไม่มีแถวข้อมูล');

  const branches = [...new Set(rows.map(r => String(r[COL.BRANCH] || '').match(/\d+/)?.[0] || '').filter(Boolean))];
  if (!branches.length) throw new Error('ไม่พบรหัสสาขาในคอลัมน์ที่ 3 ของไฟล์');
  if (branches.length > 1) throw new Error(`ไฟล์มีหลายสาขาปนกัน (${branches.join(', ')}) — ให้ export ใหม่เป็นไฟล์ต่อสาขา`);

  const cifs = [];
  for (const r of rows) {
    const cif = String(r[COL.CIF] || '').replace(/^['"]|['"]$/g, '').trim();
    if (cif) cifs.push(cif);
  }
  if (!cifs.length) throw new Error('ไม่พบ CIF ในคอลัมน์ที่ 8 ของไฟล์');

  const uniqCif = [...new Set(cifs)];
  const contracts = new Set(rows.map(r => String(r[COL.CONTRACT] || '').trim()).filter(Boolean)).size;
  const debt = rows.reduce((sum, r) => {
    const n = Number(String(r[COL.DEBT] || '').replace(/,/g, ''));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  return { branch: branches[0], rows, cifs: uniqCif, stats: { rows: rows.length, cif: uniqCif.length, contracts, debt } };
}

async function hmac(secretBuf, msg) {
  const key = await crypto.subtle.importKey('raw', secretBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

export async function makeCodes(secretBuf, cifs) {
  const map = {};
  for (const cif of cifs) {
    const sig = await hmac(secretBuf, `bfr:cif:${cif}`);
    const code = hex(sig).slice(0, CODE_HEX_LEN);
    if (map[code] && map[code] !== cif) throw new Error('รหัสสุ่มชนกัน — ห้ามสร้างซอง');
    map[code] = cif;
  }
  return map;
}

export async function makePackKey(secretBuf, branch) {
  const raw = await hmac(secretBuf, `bfr:pack:${branch}`);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function packHeader(branch, version, iv) {
  const b = enc.encode(branch), v = enc.encode(String(version));
  const head = new Uint8Array(MAGIC.length + 1 + b.length + 1 + v.length + 12);
  let p = 0;
  head.set(enc.encode(MAGIC), p); p += MAGIC.length;
  head[p++] = b.length; head.set(b, p); p += b.length;
  head[p++] = v.length; head.set(v, p); p += v.length;
  head.set(iv, p);
  return head;
}

export async function buildPack({ ciBuf, secretBuf, expectedBranch, version }) {
  const parsed = parseCI(ciBuf);
  if (expectedBranch && parsed.branch !== String(expectedBranch)) {
    throw new Error(`สาขาในไฟล์ (${parsed.branch}) ไม่ตรงกับสาขาที่เลือก (${expectedBranch}) — ปฏิเสธการเข้ารหัส`);
  }
  const codeOf = await makeCodes(secretBuf, parsed.cifs);
  const payload = {
    format: 'bfrpack', v: 1,
    branch: parsed.branch,
    version: String(version),
    createdAt: new Date().toISOString(),
    codeOf,
    rows: parsed.rows,
  };
  const key = await makePackKey(secretBuf, parsed.branch);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload))));
  const head = packHeader(parsed.branch, version, iv);
  const pack = new Uint8Array(head.length + ct.length);
  pack.set(head, 0); pack.set(ct, head.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', pack));
  const manifest = {
    branch: parsed.branch,
    filename: `${parsed.branch}.bfrpack`,
    version: String(version),
    createdAt: payload.createdAt,
    ...parsed.stats,
    sha256: hex(digest),
  };
  return { pack, manifest };
}
