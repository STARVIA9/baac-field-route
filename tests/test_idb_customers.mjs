// Harness เฟส 2-3: รายชื่อย้ายไป IndexedDB (client จริงจาก storage.js + vendor.js)
import fs from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
import vm from 'node:vm';

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' — ' + extra : '')); if (!c) fails++; };

const storageSrc = fs.readFileSync(ROOT + '/public/js/storage.js', 'utf8');
const vendorSrc = fs.readFileSync(ROOT + '/public/js/vendor.js', 'utf8');

function makeLS() {
  return { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
}
function makeIDB(backing) {
  return {
    open() {
      const req = {};
      setTimeout(() => {
        if (typeof req.onupgradeneeded === 'function') { req.result = { createObjectStore() {} }; req.onupgradeneeded(); }
        req.result = {
          transaction: () => {
            const tx = {
              objectStore: () => ({
                get: (k) => { const r = {}; setTimeout(() => { r.result = backing.get(k); if (r.onsuccess) r.onsuccess(); }, 0); return r; },
                put: (v, k) => { backing.set(k, v); },
              }),
              oncomplete: null, onerror: null,
            };
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
          },
        };
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
}
// บูต Storage ใหม่หนึ่งรอบ (เหมือนเปิดแอปใหม่) — คืน { Storage, ls, toasts }
function boot({ idbBacking, ls, breakIDB = false, quotaLS = false }) {
  const toasts = [];
  const sb = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    localStorage: ls,
    Utils: { toast: (m) => toasts.push(m), uuid: () => 'u' + Math.random().toString(36).slice(2) },
  };
  if (quotaLS) { const o = ls.setItem.bind(ls); ls.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }; }
  sb.indexedDB = breakIDB ? { open() { throw new Error('no idb'); } } : makeIDB(idbBacking);
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(storageSrc + '\n;globalThis.__S = Storage;', sb);
  return { S: sb.__S, toasts };
}
const waitIDB = async (backing, timeoutMs = 3000) => {
  const t0 = Date.now();
  while (!backing.has('customers')) { if (Date.now() - t0 > timeoutMs) return false; await new Promise(r => setTimeout(r, 25)); }
  return true;
};
// รายชื่อจำลอง 9,132 ราย ใหญ่กว่าเพดาน localStorage ~5MB
const N = 9132;
const big = Array.from({ length: N }, (_, i) => ({
  id: 'db_C' + i, cif: 'C' + i, name: 'ลูกค้า ' + i, phone: '08x', address: 'ต.ท่า' + 'ก'.repeat(700),
  lat: 13.7, lng: 101.8, branch: '145', createdBy: 'AutoImport:StaticDB',
}));
const bigBytes = Buffer.byteLength(JSON.stringify(big));
ok('fixture > 5MB (เกินเพดาน localStorage)', bigBytes > 5 * 1024 * 1024, (bigBytes / 1048576).toFixed(2) + 'MB');

// 1: บูตเปล่า
{
  const { S } = boot({ idbBacking: new Map(), ls: makeLS() });
  await S.ready;
  ok('fresh boot: getCustomers []', S.getCustomers().length === 0);
}
// 2: เซฟ 9,132 ราย — ลง IDB, ไม่แตะ localStorage
{
  const backing = new Map(); const ls = makeLS();
  const { S } = boot({ idbBacking: backing, ls });
  await S.ready;
  S.saveCustomers(big);
  ok('save 9k: เขียนลง IDB', await waitIDB(backing));
  ok('save 9k: localStorage ไม่มี bfr_customers', ls.getItem('bfr_customers') === null);
  ok('save 9k: อ่านคืนครบ', S.getCustomers().length === N);
}
// 3: เปิดใหม่ — โหลดจาก IDB ครบ
{
  const backing = new Map(); const ls = makeLS();
  let b = boot({ idbBacking: backing, ls });
  await b.S.ready; b.S.saveCustomers(big); await waitIDB(backing);
  b = boot({ idbBacking: backing, ls: makeLS() });   // เครื่องเดิมเปิดใหม่ (localStorage ว่าง)
  await b.S.ready;
  const got = b.S.getCustomers();
  ok('reboot: โหลดจาก IDB ครบ 9,132', got.length === N, got.length + ' ราย');
  ok('reboot: ข้อมูลถูก (spot check)', got[0].cif === 'C0' && got[N - 1].cif === 'C' + (N - 1));
}
// 4: migration — ของเก่าใน localStorage ย้ายเข้า IDB แล้วลบ
{
  const backing = new Map(); const ls = makeLS();
  const old = Array.from({ length: 100 }, (_, i) => ({ id: 'x' + i, cif: 'M' + i, name: 'เก่า' + i }));
  ls.setItem('bfr_customers', JSON.stringify(old));
  const { S } = boot({ idbBacking: backing, ls });
  await S.ready;
  await waitIDB(backing);
  await new Promise(r => setTimeout(r, 100));
  ok('migrate: IDB มีของเก่า 100', (backing.get('customers') || []).length === 100);
  ok('migrate: ลบ bfr_customers ออกจาก localStorage', ls.getItem('bfr_customers') === null);
  ok('migrate: อ่านได้ 100', S.getCustomers().length === 100);
}
// 5: copy semantics + edit flow
{
  const backing = new Map(); const ls = makeLS();
  const { S } = boot({ idbBacking: backing, ls });
  await S.ready;
  S.saveCustomers([{ id: 'a', cif: 'A', name: 'เอ' }]); await waitIDB(backing);
  const copy = S.getCustomers(); copy.push({ id: 'hack' });   // แก้ก๊อปปี้โดยไม่เซฟ
  ok('copy: แก้ผลคืนโดยไม่เซฟไม่กระทบ _mem', S.getCustomers().length === 1);
  const list = S.getCustomers(); list.push({ id: 'b', cif: 'B', name: 'บี' }); S.saveCustomers(list);
  await new Promise(r => setTimeout(r, 200));
  ok('edit: push+save อ่านคืน 2', S.getCustomers().length === 2);
  ok('active: กรอง deleted', (() => { const l = S.getCustomers(); l[0].deleted = true; S.saveCustomers(l); return S.getActiveCustomers().length === 1; })());
}
// 6: ทางล้มเหลว — IDB พัง + localStorage เต็ม → toast แดง
{
  const ls = makeLS();
  const { S, toasts } = boot({ idbBacking: new Map(), ls, breakIDB: true, quotaLS: true });
  await S.ready;
  S.saveCustomers([{ id: 'z' }]);
  await new Promise(r => setTimeout(r, 200));
  ok('fail path: toast แจ้งพื้นที่เต็ม', toasts.some(t => t.includes('พื้นที่จัดเก็บเต็ม')), JSON.stringify(toasts));
}
// 7: vendor.js (ไฟล์ที่เว็บโหลดจริง) มีโค้ดชุดเดียวกัน
{
  for (const needle of ['_idbOpen()', '_loadMem()', 'Storage.ready = Storage._loadMem()', 'this._mem = slim;']) {
    ok('vendor.js parity: ' + needle, vendorSrc.includes(needle) && storageSrc.includes(needle));
  }
}
// ===== เฟส 2-4: สลิมแคช — ใบเต็ม 30 ฟิลด์ (ทรง rowToCustomer) เหลือ 18 =====
const fullRec = (i) => ({
  id: 'db_C' + i, cif: 'C' + i, name: 'ลูกค้า ' + i, nickname: 'น' + i, phone: '081234' + String(1000 + i).slice(-4),
  address: 'ม.1 ต.ท่างาม อ.เมือง จ.ปราจีนบุรี', lat: 13.7, lng: 101.8,
  riskLevel: 'unclassified', debtType: null, zone: '11', branch: '145',
  customerClass: 'A', potential: 'เขียว', photo: '', createdBy: 'AutoImport:StaticDB',
  deleted: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z', geo_source: 'static_db',
  extra: { amphoe: 'เมือง', tambon: 'ท่างาม', province: 'ปราจีนบุรี', postcode: '25000', moo: '1', idCard: '123456789012' + (i % 10), dob: '1970-01-01' },
  debtClass: 'B', debtBalance: 150000 + i, reservePct: 12.5, recognition: 'accrued', overdue15m: 'N',
  nextDue: '2026-11-01', subsidy: '', commitmentDate: '', debtUpdatedAt: '2026-10-01T00:00:00Z',
});
const full = Array.from({ length: N }, (_, i) => fullRec(i));
const fullBytes = Buffer.byteLength(JSON.stringify(full));
{
  const backing = new Map(); const ls = makeLS();
  const { S } = boot({ idbBacking: backing, ls });
  await S.ready;
  S.saveCustomers(full);
  ok('slim: เขียนลง IDB', await waitIDB(backing));
  const got = S.getCustomers();
  const slimBytes = Buffer.byteLength(JSON.stringify(got));
  console.log(`   full=${(fullBytes / 1048576).toFixed(2)}MB slim=${(slimBytes / 1048576).toFixed(2)}MB (เหลือ ${(slimBytes / fullBytes * 100).toFixed(0)}%)`);
  ok('slim: เล็กลง', slimBytes < fullBytes);
  const k0 = Object.keys(got[0]).sort();
  ok('slim: เหลือ 18 ฟิลด์', k0.length === 18, k0.length + ' ฟิลด์');
  ok('slim: ตัด extra+หนี้สแนปช็อต', got[0].extra === undefined && got[0].debtBalance === undefined && got[0].debtClass === undefined && got[0].geo_source === undefined && got[0].potential === undefined);
  ok('slim: เก็บที่ต้องใช้ครบ', got[0].name === 'ลูกค้า 0' && got[0].phone && got[0].lat === 13.7 && got[0].branch === '145' && got[0].zone === '11' && got[0].updatedAt !== null);
  ok('slim: ไม่มีเลขบัตรในเครื่อง', !JSON.stringify(got.slice(0, 50)).includes('123456789012'));
  // reboot: ค่าที่ต้องใช้ยังอยู่ครบ
  const b2 = boot({ idbBacking: backing, ls: makeLS() });
  await b2.S.ready;
  const g2 = b2.S.getCustomers();
  ok('slim reboot: ครบ 9,132 ใบสลิม', g2.length === N && Object.keys(g2[0]).length === 18, g2.length + ' ราย');
  ok('slim reboot: ค่าถูก (spot check)', g2[0].cif === 'C0' && g2[N - 1].name === 'ลูกค้า ' + (N - 1));
}
{
  for (const needle of ['_KEEP:', '_slim(list)']) {
    ok('vendor.js parity 2-4: ' + needle, vendorSrc.includes(needle) && storageSrc.includes(needle));
  }
}
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
