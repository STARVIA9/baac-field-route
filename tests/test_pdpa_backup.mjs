// Harness เฟส 4: PDPA stripPII + CORS + ปุ่มสำรองข้อมูล
import { onRequestGet as custGet } from '../functions/api/customers.js';
import { signHS256 } from '../functions/_lib/jwt.js';
import fs from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' — ' + extra : '')); if (!c) fails++; };

const SECRET = 'test-secret-at-least-32-chars-long!!';
const ROW = {
  cif: 'C1', name: 'ทดสอบ', nickname: '', phone: '081', address: 'ม.1', lat: 13.7, lng: 101.8,
  risk_level: 'unclassified', debt_type: null, zone: '11', branch: '', customer_class: 'A', potential: 'เขียว',
  photo: '', created_by: 'AutoImport:StaticDB', deleted: 0, created_at: '2026-01-01', updated_at: '2026-10-18',
  geo_source: 'static', amphoe: 'เมือง', tambon: 'ท่างาม', province: 'ปราจีน', postcode: '25000', moo: '1',
  id_card: '1234567890123', dob: '1970-01-01',
};
const rows = [ROW];
const env = {
  BFR_JWT_SECRET: SECRET,
  BFR_DB: {
    prepare: (sql) => {
      const stmt = {
        bind: (...a) => stmt,
        all: async () => ({ results: String(sql).includes('COUNT') ? [{ n: rows.length }] : rows }),
        first: async () => (String(sql).includes('COUNT') ? { n: rows.length } : rows[0]),
        run: async () => ({}),
      };
      return stmt;
    },
  },
  BFR_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
};
const staffTok = await signHS256({ sub: 'wtc01', username: 'wtc01', role: 'staff', branch: '', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
const adminTok = await signHS256({ sub: 'admin', username: 'admin', role: 'admin', branch: '', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
const req = (path, tok) => new Request('https://baacroute.shop' + path, tok ? { headers: { Authorization: 'Bearer ' + tok } } : {});

// ===== 4-1: PII =====
{
  const r = await custGet({ request: req('/api/customers?limit=10000', staffTok), env });
  const j = await r.json();
  const ex = j.customers[0].extra || {};
  ok('staff list: ไม่มี idCard/dob', ex.idCard === undefined && ex.dob === undefined, JSON.stringify(Object.keys(ex)));
  ok('staff list: ที่อยู่แยกส่วนยังอยู่', ex.tambon === 'ท่างาม' && j.customers[0].name === 'ทดสอบ');
}
{
  const r = await custGet({ request: req('/api/customers?limit=10000', adminTok), env });
  const j = await r.json();
  ok('admin list: เห็น idCard เดิม', (j.customers[0].extra || {}).idCard === '1234567890123');
}
{
  const r = await custGet({ request: req('/api/customers/C1', staffTok), env });
  const j = await r.json();
  ok('staff single: ไม่มี idCard', ((j.customer || {}).extra || {}).idCard === undefined);
  const r2 = await custGet({ request: req('/api/customers/C1', adminTok), env });
  ok('admin single: เห็น idCard', ((await r2.json()).customer.extra || {}).idCard === '1234567890123');
  const r3 = await custGet({ request: req('/api/customers?limit=10', null), env });
  ok('no token -> 401', r3.status === 401);
}

// ===== 4-2: CORS ล็อกเฉพาะเว็บตัวเอง =====
{
  const h = fs.readFileSync(ROOT + '/public/_headers', 'utf8');
  const m = h.match(/\/api\/\*[\s\S]*?Access-Control-Allow-Origin: (\S+)/);
  ok('CORS /api ไม่ใช่ *', !!m && m[1] !== '*', 'ACAO=' + (m ? m[1] : 'ไม่เจอ'));
  ok('CORS /api = เว็บตัวเอง', !!m && m[1] === 'https://baacroute.shop');
}

// ===== 4-3: ปุ่มสำรอง (admin-only snapshot) =====
const { onRequestGet: backupGet } = await import('../functions/api/admin/backup.js');
{
  const kvData = { 'debt:data': '[{"cif":"C1"}]', 'debt:updated': '2026-10-18', 'routes:wtc01_x': '{"a":1}' };
  const env2 = {
    ...env,
    BFR_KV: {
      get: async (k) => kvData[k] ?? null,
      list: async ({ prefix }) => ({ keys: Object.keys(kvData).filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true, cursor: undefined }),
      put: async () => {}, delete: async () => {},
    },
  };
  const r = await backupGet({ request: req('/api/admin/backup', adminTok), env: env2 });
  const j = await r.json();
  ok('admin backup: สำเร็จ + ครบ', r.status === 200 && j.success && j.d1.customers.length === 1 && j.counts.customers === 1, 'customers=' + j.counts?.customers + ' kv=' + j.counts?.kv_keys);
  ok('backup: มีหนี้ + routes', (j.kv || {})['debt:data'] !== undefined && (j.kv || {})['routes:wtc01_x'] !== undefined);
  const r2 = await backupGet({ request: req('/api/admin/backup', staffTok), env: env2 });
  ok('staff backup -> 403', r2.status === 403);
  const r3 = await backupGet({ request: req('/api/admin/backup', null), env: env2 });
  ok('no token backup -> 401', r3.status === 401);
}

// ===== 4-3b: ปุ่มบนหน้า admin =====
{
  const html = fs.readFileSync(ROOT + '/public/admin.html', 'utf8');
  const js = fs.readFileSync(ROOT + '/public/js/admin-customers.js', 'utf8');
  ok('admin.html มีปุ่มสำรอง', html.includes('id="btn-backup"'));
  ok('admin-customers.js มี downloadBackup', js.includes('downloadBackup') && js.includes('/api/admin/backup'));
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
