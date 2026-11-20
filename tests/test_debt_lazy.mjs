// Harness: แอดมินโหลดข้อมูลหนี้ทีละสาขา (17 พ.ย.69)
// - เปิดแอป: โหลดเฉพาะสาขาหลัก (สาขาที่มีลูกค้าหนี้มากสุด) ไม่ดึงทุกสาขา
// - ensureBranch(): โหลดสาขาอื่นเมื่อผู้ใช้เลือก
// รัน: node tests/test_debt_lazy.mjs
import fs from 'node:fs';
import vm from 'node:vm';

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' — ' + extra : '')); if (!c) fails++; };
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const src = fs.readFileSync(ROOT + '/public/js/debt-db.js', 'utf8');
const m = src.match(/const DebtDB = \{([\s\S]*?)\n\};\n\nwindow\.DebtDB = DebtDB;/);
if (!m) { console.log('FAIL extract DebtDB'); process.exit(1); }

const B854 = [{ cif: 'A1', total_debt: 100, branch: '854' }, { cif: 'A2', total_debt: 200, branch: '854' }];
const B145 = [{ cif: 'B1', total_debt: 300, branch: '145' }];
let fetchedBranches = [];

const sandbox = {
  console: { log: () => {}, warn: () => {} },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  caches: { open: async () => ({ match: async () => null, put: async () => {}, keys: async () => [], delete: async () => {} }) },
  fetch: async (url) => {
    const u = String(url);
    if (u.includes('/api/customers/stats')) {
      return { ok: true, json: async () => ({ success: true, by_branch: [
        { branch: '145', customers: 10, with_debt: 1, debt_total: 300 },
        { branch: '854', customers: 20, with_debt: 2, debt_total: 300 },
      ] }) };
    }
    if (u.includes('?v=1')) return { ok: true, json: async () => ({ success: true, updated: 'V1' }), headers: { get: () => null } };
    const mb = u.match(/branch=([^&]+)/);
    const b = mb ? decodeURIComponent(mb[1]) : '';
    fetchedBranches.push(b);
    const rows = b === '854' ? B854 : b === '145' ? B145 : [];
    return { ok: true, clone: () => ({ json: async () => rows }), json: async () => rows, headers: { get: (h) => h === 'X-Debt-Updated' ? 'V1' : (h === 'X-Debt-Source' ? 'kv-branch' : null) } };
  },
  API: { baseUrl: () => '', headers: () => ({}) },
  Auth: { getUser: () => ({ id: 'adm', username: 'adm', role: 'admin', branch: 'WTC' }), isAdmin: () => true },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext('var DebtDB = {' + m[1] + '\n};', sandbox);
const D = sandbox.DebtDB;

await D.load();
ok('โหลดแรก: เฉพาะสาขาหลัก (854) ไม่ดึงทุกสาขา', D._byCif.size === 2 && fetchedBranches.length === 1 && fetchedBranches[0] === '854', 'branches=' + JSON.stringify(fetchedBranches));
ok('ตั้งค่าสถิติไว้ใช้แสดงยอดรวม', !!(D._stats && D._stats.success) && D._partial === true);
ok('ยังไม่โหลด 145', !D._branchesLoaded.has('145'));

await D.ensureBranch('145');
ok('ensureBranch(145): โหลดเพิ่มและรวมเข้าคลัง', D._byCif.size === 3 && D._byCif.get('B1').total_debt === 300);
ok('โหลดครบแล้ว partial = false', D._partial === false);

const before = fetchedBranches.length;
await D.ensureBranch('145');
ok('ensureBranch ซ้ำ: ไม่ยิงเน็ตอีก', fetchedBranches.length === before);

console.log(fails ? `\n❌ FAIL ${fails} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(fails ? 1 : 0);
