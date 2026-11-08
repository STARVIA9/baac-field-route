// Harness: probe/full คืน serverTime เดียวกัน + userUpdatedAt แยก
// + /api/debt-data ล็อกสาขาเข้ม (แถวไม่รู้สาขาต้องไม่หลุดให้สาขาอื่น)
// รัน: node tests/test_sync_cursor.mjs
import { onRequestGet as syncGet, onRequestPost as syncPost } from '../functions/api/sync.js';
import { onRequestGet as debtGet } from '../functions/api/debt-data.js';
import { signHS256 } from '../functions/_lib/jwt.js';

const SECRET = 'test-secret-0123456789-0123456789-abcdef';
const D1_MAX = '2026-11-04T04:52:33.305Z';
const LASTWRITE = '2026-11-02T08:50:53.446Z';
const USERWRITE = '2026-11-08T04:36:02.632Z';
const OVERLAY = '2026-11-02T08:50:53.446Z';

function kv(data = {}) {
  const m = new Map(Object.entries(data));
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
    },
  };
}
function d1(maxIso = D1_MAX) {
  return {
    prepare(sql) {
      const api = {
        bind() { return api; },
        async first() {
          if (/MAX\(updated_at\)/i.test(sql)) return { m: maxIso };
          if (/COUNT\(\*\)/i.test(sql)) return { n: 0 };
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { success: true }; },
      };
      return api;
    },
    async batch() { return []; },
  };
}
const req = (url, token) => new Request(url, { headers: { Authorization: 'Bearer ' + token } });
const readJson = async (r) => (r instanceof Response ? r : new Response(JSON.stringify(r))).json();
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + extra)); if (!cond) fails++; };

// ---------- 1) sync probe vs full ----------
{
  const env = {
    BFR_JWT_SECRET: SECRET,
    BFR_DB: d1(),
    BFR_KV: kv({
      'meta:lastwrite': LASTWRITE,
      'meta:lastwrite:user:staff1': USERWRITE,
      'meta:overlay-updated': OVERLAY,
      'meta:db-max-updated': D1_MAX,
      'meta:db-cache-written': new Date().toISOString(),
      'meta:counts-d1': JSON.stringify({ customers: 9130, gps: 1001 }),
      'visits:user:staff1': '{}',
    }),
  };
  const token = await signHS256({ sub: 'u1', username: 'staff1', role: 'user', branch: 'WTC', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  const probe = await readJson(await syncGet({ request: req('https://x/api/sync?probe=1', token), env }));
  const full = await readJson(await syncGet({ request: req('https://x/api/sync?since=2026-11-02T00:00:00Z&device=d1', token), env }));

  ok('probe 200/success', probe.success === true, JSON.stringify(probe).slice(0, 200));
  ok('probe.serverTime = MAX(D1)', probe.serverTime === D1_MAX, probe.serverTime);
  ok('full.serverTime = MAX(D1) (เดิมคืน lastwrite เก่า)', full.serverTime === D1_MAX, full.serverTime);
  ok('probe = full (ไม่ทำให้ client วน)', probe.serverTime === full.serverTime, probe.serverTime + ' vs ' + full.serverTime);
  ok('probe.userUpdatedAt = ของผู้ใช้', probe.userUpdatedAt === USERWRITE, String(probe.userUpdatedAt));
  ok('full.userUpdatedAt = ของผู้ใช้', full.userUpdatedAt === USERWRITE, String(full.userUpdatedAt));
  ok('full ยังใช้ cache ได้ (_d1=cache)', full._d1 === 'cache', String(full._d1));
  ok('full counts ยังถูก', full.counts && full.counts.customers === 9130, JSON.stringify(full.counts));
}

// ---------- 2) POST กรองคีย์ visit ที่ไม่ใช่ลูกค้า ----------
{
  const store = kv({ 'visits:user:staff1': JSON.stringify({ c1: { status: 'x', timestamp: '2026-06-01T00:00:00Z' } }) });
  const env = { BFR_JWT_SECRET: SECRET, BFR_DB: d1(), BFR_KV: store };
  const token = await signHS256({ sub: 'u1', username: 'staff1', role: 'user', branch: 'WTC', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  const body = {
    customers: [], savedRoutes: [],
    visits: {
      c1: { status: 'x', timestamp: '2026-06-02T00:00:00Z' },
      'gps-seed-1': { status: 'y', timestamp: '2026-06-02T00:00:00Z' },
      db_4641892: { status: 'visited', timestamp: '2026-11-09T00:00:00Z' },
    },
  };
  const res = await syncPost({
    request: new Request('https://x/api/sync', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    env,
  });
  const j = await res.json();
  const kvVisits = JSON.parse(await store.get('visits:user:staff1'));
  ok('POST ตัดคีย์ทดสอบออก', Object.keys(j.visits).join(',') === 'db_4641892', Object.keys(j.visits).join(','));
  ok('KV ไม่เก็บคีย์ทดสอบ', Object.keys(kvVisits).join(',') === 'db_4641892', Object.keys(kvVisits).join(','));
}

// ---------- 3) debt-data แยกสาขา ----------
{
  const rows = [
    { cif: '1001', branch: '854', total_debt: 1 },
    { cif: '2001', branch: '145', total_debt: 2 },
    { cif: '3001', branch: '', total_debt: 3 },   // ข้อมูลเก่าไม่รู้สาขา
  ];
  const env = { BFR_JWT_SECRET: SECRET, BFR_KV: kv({ 'debt:data': JSON.stringify(rows), 'debt:updated': '2026-11-03T01:57:27.688Z' }) };
  const tok = b => signHS256({ sub: b, username: 'u' + b, role: 'user', branch: b === '145' ? 'KBB' : 'WTC', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  const admin = await signHS256({ sub: 'admin-pin', username: 'admin', role: 'admin', branch: 'WTC', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  const get = async (token) => readJson(await debtGet({ request: req('https://x/api/debt-data', token), env }));

  // ตราประทับแคชต้องมีเวอร์ชันรูปแบบ → เครื่องที่แคช payload เก่า (ไม่มี branch) โหลดใหม่ครั้งเดียว
  const adminToken = admin;
  const full = await debtGet({ request: req('https://x/api/debt-data', adminToken), env });
  const ver = await readJson(await debtGet({ request: req('https://x/api/debt-data?v=1', adminToken), env }));
  ok('cache stamp = updated|b2', full.headers.get('X-Debt-Updated') === '2026-11-03T01:57:27.688Z|b2', String(full.headers.get('X-Debt-Updated')));
  ok('v=1 คืน stamp เดียวกับ header', ver.updated === full.headers.get('X-Debt-Updated'), ver.updated + ' vs ' + full.headers.get('X-Debt-Updated'));

  const r854 = await get(await tok('854'));
  const r145 = await get(await tok('145'));
  const rAdm = await get(admin);
  ok('854 เห็นเฉพาะ 854', r854.length === 1 && r854[0].cif === '1001', JSON.stringify(r854.map(r => r.cif)));
  ok('145 เห็นเฉพาะ 145', r145.length === 1 && r145[0].cif === '2001', JSON.stringify(r145.map(r => r.cif)));
  ok('แถวไม่รู้สาขาไม่หลุดถึงสาขา', !r854.some(r => r.cif === '3001'));
  ok('admin เห็นครบ 3', rAdm.length === 3, JSON.stringify(rAdm.map(r => r.cif)));
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`);
process.exit(fails ? 1 : 0);
