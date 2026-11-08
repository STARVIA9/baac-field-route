// Harness: client poll หลังแก้ — probe/full เวลาเดียวกันต้องไม่ดึงเต็มซ้ำ + push ไม่เลื่อน cursor
// รัน: node tests/test_poll_cursor.mjs
import fs from 'node:fs';
import vm from 'node:vm';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const src = fs.readFileSync(ROOT + '/public/js/vendor.js', 'utf8');
const m = src.match(/const Storage = \{([\s\S]*?)\n\};\n\n\/\/ ===== Merge helpers/);
if (!m) { console.log('FAIL extract Storage block'); process.exit(1); }

let fullCalls = 0, probeCalls = 0, pushServerTime = null;
const sandbox = {
  console,
  document: { hidden: false, addEventListener: () => {} },
  navigator: { onLine: true },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  setInterval: () => 1, clearInterval: () => {}, setTimeout: (fn) => { fn && fn(); return 0; }, clearTimeout: () => {},
  fetch: async (url) => {
    if (url.includes('probe=1')) {
      probeCalls++;
      return { ok: true, json: async () => ({ success: true, serverTime: '2026-11-04T04:52:33.305Z', userUpdatedAt: '2026-11-08T04:36:02.632Z', overlayUpdatedAt: null }) };
    }
    fullCalls++;
    return { ok: true, json: async () => ({ success: true, serverTime: '2026-11-04T04:52:33.305Z', userUpdatedAt: '2026-11-08T04:36:02.632Z', overlayUpdatedAt: null, customers: [], visits: {}, savedRoutes: [], counts: { customers: 9130 } }) };
  },
  API: { baseUrl: () => '', headers: () => ({}), syncAll: async () => ({ success: true, serverTime: pushServerTime }) },
  Utils: { toast: () => {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext('var Storage = {' + m[1] + '\n};', sandbox);
const S = sandbox.Storage;
S.deviceId = () => 'dev1';
S._mergeRemote = () => {};
S._notifyListeners = () => {};
S._markRoutesSynced = () => {};
S.getVisits = () => ({});
S.getSavedRoutes = () => [];
S._buildPayload = () => ({ customers: [], visits: {}, savedRoutes: [], deviceId: 'dev1' });
S.applyGpsOverlay = async () => 0;

let fails = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' :: ' + x)); if (!c) fails++; };

await S.pollOnce();            // ครั้งแรกยังไม่มี cursor → ดึงเต็ม 1
await S.pollOnce();            // probe เวลาเดิม → ต้องไม่ดึงเต็มอีก
ok('full fetch ครั้งแรก 1 ครั้ง', fullCalls === 1, 'full=' + fullCalls);
ok('probe ยิงทุกรอบ', probeCalls === 2, 'probe=' + probeCalls);
ok('เก็บ cursor = MAX(D1)', sandbox.localStorage.getItem('bfr_server_time') === '2026-11-04T04:52:33.305Z', sandbox.localStorage.getItem('bfr_server_time'));
ok('เก็บ user cursor แยก', sandbox.localStorage.getItem('bfr_user_time') === '2026-11-08T04:36:02.632Z', sandbox.localStorage.getItem('bfr_user_time'));

pushServerTime = '2026-11-08T09:00:00.000Z';
await S.push();
ok('push ไม่เลื่อน cursor ข้อมูล', sandbox.localStorage.getItem('bfr_server_time') === '2026-11-04T04:52:33.305Z', sandbox.localStorage.getItem('bfr_server_time'));

fullCalls = 0;
sandbox.fetch = async (url) => {
  if (url.includes('probe=1')) {
    probeCalls++;
    return { ok: true, json: async () => ({ success: true, serverTime: '2026-11-04T04:52:33.305Z', userUpdatedAt: '2026-11-08T10:00:00.000Z', overlayUpdatedAt: null }) };
  }
  fullCalls++;
  return { ok: true, json: async () => ({ success: true, serverTime: '2026-11-04T04:52:33.305Z', userUpdatedAt: '2026-11-08T10:00:00.000Z', overlayUpdatedAt: null, customers: [], visits: {}, savedRoutes: [], counts: {} }) };
};
await S.pollOnce();
ok('visit เปลี่ยน → ดึงเต็ม 1 ครั้ง', fullCalls === 1, 'full=' + fullCalls);
ok('เก็บ user cursor ใหม่', sandbox.localStorage.getItem('bfr_user_time') === '2026-11-08T10:00:00.000Z', sandbox.localStorage.getItem('bfr_user_time'));

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`);
process.exit(fails ? 1 : 0);
