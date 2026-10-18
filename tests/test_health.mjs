// Harness: /api/admin/quota health (เฟส 0) — import handler จริง + KV/D1 ปลอม นับ query
import { onRequestGet } from '../functions/api/admin/quota.js';
import { signHS256 } from '../functions/_lib/jwt.js';

const SECRET = 'test-secret-at-least-32-chars-long!!';
let d1Queries = 0;
const rows = [
  { branch: '854', total: 3957, gps: 266, debt: 3900, lastUpdated: '2026-10-18' },
  { branch: '145', total: 5175, gps: 0, debt: 5164, lastUpdated: '2026-10-17' },
];
const store = new Map();
const env = {
  BFR_JWT_SECRET: SECRET,
  BFR_KV: { get: async k => store.get(k) ?? null, put: async (k, v) => store.set(k, v), delete: async k => store.delete(k) },
  BFR_DB: { prepare: () => ({ all: async () => { d1Queries++; return { results: rows }; } }) },
};
const tokAdmin = await signHS256({ sub: 'admin', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
const tokStaff = await signHS256({ sub: 'wtc01', role: 'staff', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
const req = (tok, qs = '') => new Request('https://baacroute.shop/api/admin/quota' + qs, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} });

let fails = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) fails++; };

let r = await onRequestGet({ request: req(null), env });
ok('no token -> 401', r.status === 401);
r = await onRequestGet({ request: req(tokStaff), env });
ok('staff -> 403', r.status === 403);
r = await onRequestGet({ request: req(tokAdmin), env });
let d = await r.json();
ok('admin -> 200 + health', r.status === 200 && d.success && !!d.health);
ok('totals folded', d.health.total === 9132 && d.health.gps === 266 && d.health.debt === 9064);
ok('gpsPct 2.9', d.health.gpsPct === 2.9);
ok('branch 145 gpsPct 0', d.health.branches[1].gpsPct === 0);
ok('D1 queried once', d1Queries === 1);
r = await onRequestGet({ request: req(tokAdmin), env });
d = await r.json();
ok('2nd call cached, D1 still 1', d.health.cached === true && d1Queries === 1);
r = await onRequestGet({ request: req(tokAdmin, '?force=1'), env });
d = await r.json();
ok('force bypasses cache, D1=2', d.health.cached === false && d1Queries === 2);
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
