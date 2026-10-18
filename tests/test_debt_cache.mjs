// Harness เฟส 2-2: debt-data ?v=1 (server จริง) + DebtDB cache-first (client จริงจาก vendor.js)
import { onRequestGet } from '../functions/api/debt-data.js';
import { signHS256 } from '../functions/_lib/jwt.js';
import fs from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
import vm from 'node:vm';

let fails = 0;
const ok = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n); if (!c) fails++; };

// ===== ส่วน 1: server =====
const SECRET = 'test-secret-at-least-32-chars-long!!';
const store = new Map([['debt:data', JSON.stringify([{ cif: 'C1', total_debt: 100, contracts: [{ c: 'S1' }] }])], ['debt:updated', '2026-10-18T01:00:00Z']]);
const env = {
  BFR_JWT_SECRET: SECRET,
  BFR_KV: { get: async k => store.get(k) ?? null, put: async (k, v) => store.set(k, v), delete: async k => store.delete(k) },
  BFR_DB: { prepare: () => { throw new Error('should not query D1'); } },
};
const tok = await signHS256({ sub: 'admin', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
const req = (qs) => new Request('https://baacroute.shop/api/debt-data' + qs, { headers: { Authorization: 'Bearer ' + tok } });

let r = await onRequestGet({ request: req('?v=1'), env });
let j = await r.json();
ok('?v=1 -> updated stamp', r.status === 200 && j.success && j.updated === '2026-10-18T01:00:00Z');
r = await onRequestGet({ request: req(''), env });
ok('full has X-Debt-Updated', r.headers.get('X-Debt-Updated') === '2026-10-18T01:00:00Z');
ok('full rows intact', (await r.json()).length === 1);
r = await onRequestGet({ request: new Request('https://baacroute.shop/api/debt-data?v=1'), env });
ok('?v=1 no token -> 401', r.status === 401);

// ===== ส่วน 2: client (DebtDB จาก vendor.js) =====
const src = fs.readFileSync(ROOT + '/public/js/vendor.js', 'utf8');
const m = src.match(/const DebtDB = \{([\s\S]*?)\n\};\n\nwindow\.DebtDB = DebtDB;/);
if (!m) { console.log('FAIL extract DebtDB'); process.exit(1); }
const FULL = [{ cif: 'C1', total_debt: 100, contracts: [{ c: 'S1' }] }];
let fullFetches = 0, cache = new Map();
const sandbox = {
  console: { log: () => {}, warn: () => {} },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  caches: {
    open: async () => ({
      match: async (k) => cache.has(k) ? { json: async () => cache.get(k) } : null,
      put: async (k, v) => cache.set(k, await v.json()),
      keys: async () => [...cache.keys()].map(url => ({ url })),
      delete: async (k) => cache.delete(k),
    }),
  },
  fetch: async (url) => {
    if (String(url).includes('?v=1')) return { ok: true, json: async () => ({ success: true, updated: '2026-10-18T01:00:00Z' }), headers: { get: () => null } };
    fullFetches++;
    return { ok: true, clone: () => ({ json: async () => FULL }), json: async () => FULL, headers: { get: (h) => h === 'X-Debt-Updated' ? '2026-10-18T01:00:00Z' : (h === 'X-Debt-Source' ? 'kv' : null) } };
  },
  API: { baseUrl: () => '', headers: () => ({}) },
  Auth: { getUser: () => ({ id: 'wtc01' }) },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext('var DebtDB = {' + m[1] + '\n};', sandbox);
const D = sandbox.DebtDB;

await D.load();
ok('1st load: full fetch + stamp + cache', fullFetches === 1 && D._byCif.size === 1 && D._fromCache === false
  && sandbox.localStorage.getItem('bfr_debt_updated') === 'wtc01|2026-10-18T01:00:00Z' && cache.size === 1);
D._loaded = false;
await D.load();
ok('2nd load: cache hit, no full fetch', fullFetches === 1 && D._fromCache === true && D._byCif.size === 1);
ok('refresh forces full fetch', (await D.refresh()) === true && fullFetches === 2 && D._fromCache === false);
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
