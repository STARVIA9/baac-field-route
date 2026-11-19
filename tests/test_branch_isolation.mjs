// Harness: แยกข้อมูลตามสาขา "ทุกทาง" — gps-overlay / customers sync เก่า / sync เขียนข้ามสาขา
// รัน: node tests/test_branch_isolation.mjs
import { onRequestGet as overlayGet } from '../functions/api/gps-overlay.js';
import { onRequestGet as legacyGet } from '../functions/api/customers/sync.js';
import { onRequestPost as syncPost } from '../functions/api/sync.js';
import { signHS256 } from '../functions/_lib/jwt.js';

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' — ' + extra : '')); if (!c) fails++; };

const SECRET = 'test-secret-at-least-32-chars-long!!';
const NOW = Math.floor(Date.now() / 1000);
const tok = (sub, role, branch) => signHS256({ sub, username: sub, role, branch, pv: 1, exp: NOW + 3600 }, SECRET);
const staff145 = await tok('k1', 'user', '145');
const boss291 = await tok('bs', 'branch_admin', '291');
const adminTok = await tok('adm', 'admin', 'WTC');

const rows = [
  { cif: 'C145', name: 'กบินทร์', branch: '145', lat: 13.7, lng: 101.8, updated_at: '2026-11-01', deleted: 0, updatedAt: '2026-11-01' },
  { cif: 'C291', name: 'บ้านสร้าง', branch: '291', lat: 13.9, lng: 101.4, updated_at: '2026-11-01', deleted: 0, updatedAt: '2026-11-01' },
  { cif: 'C854', name: 'วังท่าช้าง', branch: '854', lat: 13.5, lng: 101.9, updated_at: '2026-11-01', deleted: 0, updatedAt: '2026-11-01' },
];

function makeDB() {
  const state = { writes: [] };
  return {
    state,
    prepare(sql) {
      const s = String(sql);
      const st = {
        _args: [],
        bind(...a) { st._args = a; return st; },
        all: async () => {
          // gps-overlay / legacy sync: WHERE deleted=0 (+branch)
          const m = s.match(/branch\s*=\s*\?1/);
          if (m) return { results: rows.filter(r => r.branch === st._args[0]) };
          return { results: rows };
        },
        first: async () => {
          if (/WHERE cif = \?1/.test(s)) {
            const cif = st._args[0];
            return rows.find(r => r.cif === cif) || null;
          }
          if (/MAX\(updated_at\)/.test(s)) return { m: '2026-11-01' };
          if (/COUNT\(\*\)/.test(s)) return { n: rows.length };
          return null;
        },
        run: async () => { state.writes.push({ sql: s.slice(0, 40), args: st._args }); return { success: true }; },
      };
      return st;
    },
    batch: async (arr) => { state.writes.push({ batch: arr.length }); return []; },
  };
}
const envWith = (db) => ({ BFR_JWT_SECRET: SECRET, BFR_DB: db, BFR_KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } });
const req = (path, t) => new Request('https://x' + path, { headers: { Authorization: 'Bearer ' + t } });

// ===== 1) /api/gps-overlay =====
{
  const env = envWith(makeDB());
  const r = await overlayGet({ request: req('/api/gps-overlay', staff145), env });
  const j = await r.json();
  const overlay = j.overlay || j;
  const keys = Object.keys(overlay);
  ok('gps-overlay staff145: เห็นแค่พิกัดสาขาตัวเอง', keys.length === 1 && keys[0] === 'C145', keys.join(','));

  const r2 = await overlayGet({ request: req('/api/gps-overlay', boss291), env });
  const k2 = Object.keys((await r2.json()).overlay || {});
  ok('gps-overlay branch_admin 291: เห็นแค่ 291', k2.length === 1 && k2[0] === 'C291', k2.join(','));

  const r3 = await overlayGet({ request: req('/api/gps-overlay', adminTok), env });
  const k3 = Object.keys((await r3.json()).overlay || {});
  ok('gps-overlay admin: เห็นครบ 3', k3.length === 3, k3.join(','));
}

// ===== 2) /api/customers/sync (endpoint เก่า) =====
{
  const env = envWith(makeDB());
  const r = await legacyGet({ request: req('/api/customers/sync', staff145), env });
  const j = await r.json();
  ok('customers/sync เก่า staff145: เห็นเฉพาะสาขาตัวเอง', j.customers.length === 1 && j.customers[0].branch === '145', 'n=' + j.customers.length);

  const ra = await legacyGet({ request: req('/api/customers/sync', adminTok), env });
  const ja = await ra.json();
  ok('customers/sync เก่า admin: เห็นครบ', ja.customers.length === 3, 'n=' + ja.customers.length);
}

// ===== 3) sync POST — ห้ามเขียนทับลูกค้าสาขาอื่น =====
{
  const db = makeDB();
  const env = envWith(db);
  const body = {
    deviceId: 'dev1',
    customers: [
      { cif: 'C291', name: 'แก้ข้ามสาขา', updatedAt: '2026-11-16T00:00:00.000Z' }, // ต่างสาขา → ต้องถูกข้าม
      { cif: 'C145', name: 'แก้สาขาตัวเอง', updatedAt: '2026-11-16T00:00:00.000Z' }, // สาขาตัวเอง → เขียนได้
    ],
    visits: {}, savedRoutes: [],
  };
  const r = await syncPost({ request: new Request('https://x/api/sync', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + staff145, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env });
  ok('sync POST: 200', r.status === 200);
  const updates = db.state.writes.filter(w => /UPDATE customers/i.test(w.sql) || /INSERT INTO customers/i.test(w.sql));
  const touchedCif = updates.map(u => (u.args || []).slice(-1)[0]);
  ok('sync POST: เขียนเฉพาะ CIF สาขาตัวเอง', updates.length === 1, 'writes=' + updates.length);
  ok('sync POST: ไม่แตะ CIF 291', !updates.some(u => String(u.args).includes('C291')), String(touchedCif));
}

console.log(fails ? `\n❌ FAIL ${fails} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(fails ? 1 : 0);
