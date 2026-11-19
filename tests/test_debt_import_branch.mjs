// Harness: ผู้ดูแลสาขาอัปโหลด CI ได้เอง — เฉพาะแถวสาขาตัวเอง + กันล้างหนี้ผิดสาขา
// รัน: node tests/test_debt_import_branch.mjs
import { onRequestPost as debtImport } from '../functions/api/debt-import.js';
import { signHS256 } from '../functions/_lib/jwt.js';

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' — ' + extra : '')); if (!c) fails++; };

const SECRET = 'test-secret-at-least-32-chars-long!!';
const NOW = Math.floor(Date.now() / 1000);
const tok = (sub, role, branch) => signHS256({ sub, username: sub, role, branch, pv: 1, exp: NOW + 3600 }, SECRET);
const kbTok = await tok('kb1', 'branch_admin', 'KBB');
const staffTok = await tok('k1', 'user', 'KBB');
const adminTok = await tok('adm', 'admin', 'WTC');

// ===== สร้างไฟล์ CI ปลอม (140 คอลัมน์ — index ตามที่ debt-import อ่าน) =====
function row(branch, cif, name, cls = '1', bal = '1000') {
  const c = new Array(140).fill('');
  c[2] = branch + ' - สาขาทดสอบ';
  c[5] = name;
  c[7] = cif;
  c[24] = bal;
  c[30] = cls;
  return c.join(',');
}
function csv(rows) {
  return ['ข้อมูล ณ 15/11/2569', new Array(140).fill('h').join(','), ...rows].join('\n');
}
// เข้ารหัสเป็น TIS-620 (ไทย = 0xA1 + offset จาก U+0E01) — ตรงกับที่ debt-import ถอดด้วย TextDecoder('tis-620')
function tis(str) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0E01 && cp <= 0x0E5B) out.push(0xA1 + (cp - 0x0E01));
    else if (cp < 128) out.push(cp);
    else out.push(0x3F); // '?'
  }
  return new Uint8Array(out);
}
const MIXED = csv([
  row('854', 'C85401', 'ลูกค้าวังท่าช้าง 1'),
  row('145', 'C14501', 'ลูกค้ากบินทร์ 1'),
  row('145', 'C14502', 'ลูกค้ากบินทร์ 2'),
]);

function makeKV(init = {}) {
  const m = new Map(Object.entries(init));
  return { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); }, _map: m };
}
function makeDB(existingDebtRows = []) {
  const state = { batches: 0, statements: 0, sqls: [] };
  return {
    state,
    prepare(sql) {
      state.sqls.push(String(sql));
      const st = {
        _sql: String(sql), _args: [],
        bind(...a) { st._args = a; return st; },
        all: async () => {
          // 16 พ.ย.69: query เปลี่ยนจาก created_by='Debt-Import' → แถว active ที่มีข้อมูลหนี้ทุกช่องทาง
          if (/deleted = 0\s+AND \(debt_balance != 0/.test(st._sql) || /created_by = 'Debt-Import'/.test(st._sql)) return { results: existingDebtRows };
          if (/FROM customers WHERE cif IN/.test(st._sql)) return { results: [] };
          return { results: [] };
        },
        first: async () => null,
        run: async () => ({}),
      };
      return st;
    },
    batch: async (arr) => { state.batches++; state.statements += arr.length; return []; },
  };
}
function req(fileText, t) {
  const fd = new FormData();
  fd.append('file', new File([tis(fileText)], 'ci.csv', { type: 'text/csv' }));
  return new Request('https://x/api/debt-import' + (globalThis.__dry ? '?dryrun=1' : ''), {
    method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: fd,
  });
}
async function call(text, t, { dry = false, existing = [] } = {}) {
  globalThis.__dry = dry;
  const kv = makeKV();
  const db = makeDB(existing);
  const env = { BFR_JWT_SECRET: SECRET, BFR_KV: kv, BFR_DB: db };
  const res = await debtImport({ request: req(text, t), env });
  let j = null;
  try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, body: j, db, kv };
}

// ===== 1) ผู้ดูแลสาขา: ไฟล์รวมหลายสาขา → เก็บเฉพาะสาขาตัวเอง =====
{
  const r = await call(MIXED, kbTok, { dry: true });
  const b = r.body;
  ok('branch_admin dryrun: 200', r.status === 200, b.error || '');
  ok('branch_admin: เห็นเฉพาะ CIF สาขาตัวเอง (2)', b.unique_cifs === 2, 'unique=' + b.unique_cifs);
  ok('branch_admin: นับแถวสาขาอื่นที่ข้าม (1)', b.ignored_other_branch === 1, 'ignored=' + b.ignored_other_branch);
  ok('branch_admin: scope_branch = 145 (KBB)', b.scope_branch === '145', b.scope_branch);
  ok('branch_admin: will_add = 2 (เฉพาะสาขาตัวเอง)', b.will_add === 2, 'add=' + b.will_add);
}

// ===== 2) ไฟล์ของสาขาอื่นล้วน → ปฏิเสธ =====
{
  const other = csv([row('854', 'C85402', 'ลูกค้าวังท่าช้าง 2')]);
  const r = await call(other, kbTok, { dry: true });
  ok('branch_admin: ไฟล์สาขาอื่นล้วน → 400', r.status === 400, 'status=' + r.status + ' ' + (r.body.error || ''));
}

// ===== 3) เขียนจริง: batch เขียนเฉพาะ 2 แถวของสาขาตัวเอง =====
{
  const r = await call(MIXED, kbTok, { dry: false });
  ok('branch_admin เขียนจริง: 200', r.status === 200, r.body.error || '');
  ok('branch_admin เขียนจริง: added 2', r.body.added === 2);
  ok('branch_admin เขียนจริง: เขียน 2 statement (ไม่แตะสาขาอื่น)', r.db.state.statements === 2, 'statements=' + r.db.state.statements);
  ok('branch_admin เขียนจริง: ไม่ล้างข้อมูล (ไม่มีหนี้เดิม)', r.body.cleared === 0);
}

// ===== 4) กันล้างหนี้: ไฟล์เล็กกว่าหนี้ค้างในสาขามาก → ข้ามการล้าง =====
{
  const existing = Array.from({ length: 10 }, (_, i) => ({
    cif: 'C1459' + i, branch: '145', debt_class: '2', debt_balance: 500,
    reserve_pct: '', recognition: '', overdue_15m: '', next_due: '', subsidy: '', commitment_date: '',
  }));
  const r = await call(csv([row('145', 'C14501', 'ลูกค้ากบินทร์ 1')]), kbTok, { dry: true, existing });
  ok('branch_admin: ไฟล์เล็ก (1 vs 10) → ไม่ล้างหนี้เก่า', r.body.will_clear === 0, 'will_clear=' + r.body.will_clear);
  ok('branch_admin: แจ้งเหตุผล clear_skipped', !!r.body.clear_skipped, r.body.clear_skipped || '');
}

// ===== 5) ไฟล์ครบ (≥80%) → ล้างได้เฉพาะสาขาตัวเอง =====
{
  const existing = [
    { cif: 'C14599', branch: '145', debt_class: '2', debt_balance: 500, reserve_pct: '', recognition: '', overdue_15m: '', next_due: '', subsidy: '', commitment_date: '' },
    { cif: 'C85499', branch: '854', debt_class: '2', debt_balance: 500, reserve_pct: '', recognition: '', overdue_15m: '', next_due: '', subsidy: '', commitment_date: '' },
  ];
  const r = await call(csv([row('145', 'C14501', 'ลูกค้ากบินทร์ 1'), row('145', 'C14502', 'ลูกค้ากบินทร์ 2')]), kbTok, { dry: true, existing });
  ok('branch_admin: ไฟล์ครบ → ล้างเฉพาะ CIF สาขาตัวเอง (1)', r.body.will_clear === 1, 'will_clear=' + r.body.will_clear + ' skip=' + (r.body.clear_skipped || '-'));
}

// ===== 6) สิทธิ์: พนักงานทั่วไปอัพไม่ได้ =====
{
  const r = await call(MIXED, staffTok, { dry: true });
  ok('พนักงานทั่วไป: 403', r.status === 403, 'status=' + r.status);
}

// ===== 7) แอดมินกลาง: อัพได้ทุกสาขาเหมือนเดิม =====
{
  const r = await call(MIXED, adminTok, { dry: true });
  ok('admin กลาง: 200 + เห็นทั้ง 3 CIF', r.status === 200 && r.body.unique_cifs === 3, 'unique=' + r.body.unique_cifs);
  ok('admin กลาง: ไม่มี scope_branch', !r.body.scope_branch, JSON.stringify(r.body.scope_branch));
  ok('admin กลาง: ignored_other_branch = 0', r.body.ignored_other_branch === 0);
}

// ===== 8) สีศักยภาพ (เขียว/เหลือง/แดง) ติดไปกับคลังการ์ดหนี้ + D1 =====
{
  const c = new Array(140).fill('');
  c[2] = '291 - สาขาบ้านสร้าง'; c[4] = '3'; c[5] = 'ลูกค้าบ้านสร้าง 1'; c[7] = 'C29101';
  c[14] = 'เหลือง'; c[15] = 'เขียว'; c[24] = '2500'; c[30] = '2';
  const r = await call(csv([c.join(',')]), adminTok, { dry: false });
  ok('สี: import 200', r.status === 200, r.body.error || '');
  const rows = JSON.parse(r.kv._map.get('debt:data:b:291') || '[]');
  ok('สี: คลังการ์ดหนี้มี potential = เหลือง (รุนแรงสุด)', rows[0] && rows[0].potential === 'เหลือง', rows[0] && rows[0].potential);
  ok('สี: สัญญามี pot = เหลือง', !!(rows[0] && rows[0].contracts && rows[0].contracts[0] && rows[0].contracts[0].pot === 'เหลือง'));
  ok('สี: คำสั่งเขียน D1 มีคอลัมน์ potential', r.db.state.sqls.some(s => /potential/.test(s)));
}

console.log(fails ? `\n❌ FAIL ${fails} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(fails ? 1 : 0);
