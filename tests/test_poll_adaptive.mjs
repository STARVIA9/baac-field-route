// Harness: adaptive polling (เฟส 2) — ดึงบล็อก Storage จาก vendor.js จริงมา eval ด้วย stub
import fs from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
import vm from 'node:vm';

const src = fs.readFileSync(ROOT + '/public/js/vendor.js', 'utf8');
const m = src.match(/const Storage = \{([\s\S]*?)\n\};\n\n\/\/ ===== Merge helpers/);
if (!m) { console.log('FAIL extract Storage block'); process.exit(1); }

// stub โลกเบราว์เซอร์ + จับ setInterval
let timers = [];
let nextTimerId = 1;   // id เริ่มที่ 1 (เบราว์เซอร์จริงไม่เคยคืน 0 — 0 เป็น falsy ทำให้ _clearPollTimer มองไม่เห็น)
let visHandler = null;
let hidden = false;
let polls = 0;
const sandbox = {
  console,
  document: {
    get hidden() { return hidden; },
    addEventListener: (ev, fn) => { if (ev === 'visibilitychange') visHandler = fn; },
  },
  navigator: { onLine: true },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  setInterval: (fn, ms) => { const id = nextTimerId++; timers[id] = { fn, ms }; return id; },
  clearInterval: (id) => { delete timers[id]; },
  setTimeout: () => 0, clearTimeout: () => {},
  fetch: async () => { polls++; return { ok: true, json: async () => ({ success: true, serverTime: '2026-10-18T00:00:00Z' }) }; },
  API: { baseUrl: () => '', headers: () => ({}) },
  Utils: { toast: () => {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext('var Storage = {' + m[1] + '\n};', sandbox);
const S = sandbox.Storage;
// pollOnce ยิง fetch จริงใน stub — แทนด้วยตัวนับเพื่อไม่ต้องรอ network
S.pollOnce = async () => { polls++; };
S.deviceId = () => 'test-dev';
S._mergeRemote = () => {}; S._notifyListeners = () => {};

let fails = 0;
const ok = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n); if (!c) fails++; };
const live = () => Object.values(timers).filter(Boolean);

S.startPolling();                       // จอเปิด → 20 วิ
await new Promise(r => setTimeout(r, 20));
ok('visible: 1 timer @20s', live().length === 1 && live()[0].ms === 20000);
ok('start polls immediately', polls >= 1);

hidden = true; visHandler();            // พับจอ → 120 วิ
ok('hidden: 1 timer @120s', live().length === 1 && live()[0].ms === 120000);
const p1 = polls;
hidden = false; visHandler();           // กลับมา → 20 วิ + เช็คทันที
await new Promise(r => setTimeout(r, 20));
ok('visible again: back @20s', live().length === 1 && live()[0].ms === 20000);
ok('return polls immediately', polls > p1);

S.startPolling();                       // เรียกซ้ำต้องไม่ผูก listener ซ้อน/ timer ซ้อน
ok('restart: still 1 timer', live().length === 1);
S.stopPolling();
ok('stop: no timers', live().length === 0);
hidden = true; visHandler();            // หยุดแล้วสลับจอต้องไม่ตั้ง timer ใหม่
ok('stopped stays stopped', live().length === 0);
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
