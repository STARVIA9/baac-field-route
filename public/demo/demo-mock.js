/* DEMO MOCK — เว็บตัวอย่างสำหรับคณะกรรมการ (ข้อมูลสมมุติทั้งหมด)
 * หน้าที่ 3 อย่าง:
 * 1) แยกที่เก็บข้อมูลออกจากเว็บจริง (localStorage/IndexedDB/Cache เติม prefix demo_)
 *    → กรรมการลองกดได้เต็มที่ ไม่แตะข้อมูลจริงของ ธ.ก.ส. แม้แต่บิตเดียว
 * 2) ดัก fetch ไป /api/* และ /version.json ตอบข้อมูลสมมุติ — ห้ามยิงหลังบ้านจริง
 *    (OSRM/แผนที่/ฟอนต์ ปล่อยผ่าน เพราะไม่มีข้อมูลส่วนบุคคล)
 * 3) ป้ายบอกชัดว่าเป็นเว็บตัวอย่าง + วิธีเข้า (PIN 1234)
 * ไฟล์นี้โหลดก่อน vendor.js เสมอ (ดู <script> ใน demo/index.html)
 */
(function () {
  'use strict';

  // ---------- 0) ปิด Service Worker ในโหมดตัวอย่าง ----------
  // กัน SW ตัวจริง (scope /) เข้ามาคุมหน้า demo
  try {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: function () { return Promise.resolve({ scope: '/demo/ (disabled)' }); },
        ready: Promise.resolve({}),
        controller: null,
        addEventListener: function () {},
        removeEventListener: function () {},
        getRegistration: function () { return Promise.resolve(undefined); }
      }
    });
  } catch (e) { /* อุปกรณ์เก่าไม่รองรับก็ข้าม */ }

  // ---------- 1) แยกที่เก็บข้อมูล (กันปนกับเว็บจริง) ----------
  function mapKey(k) {
    if (typeof k !== 'string') return k;
    if (k.indexOf('bfr') === 0 || k === 'app_version' || k === 'vehicle_profile') return 'demo_' + k;
    return k;
  }
  try {
    var _ls = window.localStorage;
    var _get = _ls.getItem.bind(_ls), _set = _ls.setItem.bind(_ls), _rem = _ls.removeItem.bind(_ls);
    _ls.getItem = function (k) { return _get(mapKey(k)); };
    _ls.setItem = function (k, v) { return _set(mapKey(k), v); };
    _ls.removeItem = function (k) { return _rem(mapKey(k)); };
  } catch (e) {}
  try {
    if (window.IDBFactory && IDBFactory.prototype.open) {
      var __open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, ver) {
        if (name === 'bfr') name = 'bfr-demo';
        return __open.call(this, name, ver);
      };
    }
  } catch (e) {}
  try {
    if (window.caches && CacheStorage.prototype.open) {
      var __copen = CacheStorage.prototype.open;
      CacheStorage.prototype.open = function (name) {
        if (name === 'bfr-debt-v1') name = 'bfr-debt-demo-v1';
        return __copen.call(this, name);
      };
    }
  } catch (e) {}

  // ---------- 1.5) ซ่อมเว็บ — ทางเดียวที่ใช้โหลดใหม่ (กันลูปโหลดค้าง) ----------
  // ทุกปุ่มที่โหลดใหม่ต้องเรียกฟังก์ชันนี้ ห้ามใช้ location.reload() ธรรมดา
  // เพราะแคช/Service Worker ตัวเดิมจะยังอยู่ → โหลดใหม่ก็ค้างที่เดิมอีก
  window.__demoHardRepair = function (btn) {
    if (window.__demoRepairing) return;   // กันกดซ้ำ/ auto + manual พร้อมกัน
    window.__demoRepairing = true;
    var old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังซ่อม...'; }
    var go = function () {
      var u = new URL(location.href);
      u.searchParams.set('_fix', String(Date.now()));
      location.replace(u.toString());
    };
    var fail = function () {
      if (btn) { btn.disabled = false; btn.textContent = old; }
      alert('ซ่อมอัตโนมัติไม่สำเร็จ — ปิดแท็บทั้งหมดแล้วเปิดใหม่ค่ะ');
    };
    var clearCaches = function () {
      if (!window.caches || typeof caches.keys !== 'function') return Promise.resolve();
      return caches.keys().then(function (names) {
        return Promise.all(names.map(function (n) { try { return caches.delete(n); } catch (e) { return null; } }));
      });
    };
    try {
      // โหมดตัวอย่างดัก serviceWorker ไว้ (ไม่มี getRegistrations) → ต้องเช็คก่อนเรียก
      if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) { try { return r.unregister(); } catch (e) { return null; } }));
        }).then(clearCaches).then(go).catch(fail);
      } else {
        clearCaches().then(go).catch(fail);
      }
    } catch (e) { fail(e); }
  };

  // ---------- 2) ข้อมูลสมมุติ ----------
  var DEMO_T0 = '2026-10-23T00:00:00.000Z';
  function b64(s) {
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fakeToken() {
    var exp = Math.floor(Date.now() / 1000) + 30 * 86400;
    return b64('{"alg":"HS256","typ":"JWT"}') + '.' + b64(JSON.stringify({ sub: 'demo01', exp: exp })) + '.demo-signature';
  }
  var MOCK_USER = {
    id: 'demo01', username: 'demo01', name: 'เจ้าหน้าที่ตัวอย่าง',
    role: 'staff', branch: '854', branchName: 'สาขาจำลอง',
    loginMethod: 'pin', hasPassword: false
  };
  var MOCK_STAFF = [{ username: 'demo01', displayName: 'เจ้าหน้าที่ตัวอย่าง', branch: '854', branchName: 'สาขาจำลอง' }];

  // พิกัดสมมุติรอบสำนักงาน (ตัวเลขแต่งขึ้น ไม่ใช่บ้านลูกค้าจริง)
  // คอลัมน์: [cif, ชื่อ, zone, lat, lng, risk]
  // 30 ราย (มีหนี้ 25 + ไม่มีหนี้ 5) — ทุกตัวกรองหลักเจอ ≥5 ราย:
  // tier 1-5 ×5 · เดือนถึงกำหนด 5 เดือน ×5 (ต.ค./พ.ย./ธ.ค.69, ก.พ./มี.ค.70)
  // เขต 1-5 ×5-6 · อสม. 5 ราย · สำรอง 1%: 10 ราย / 100%: 10 ราย / ไม่มีสำรอง: 5 ราย
  // 15 เดือน 9 ราย (มีสัญญา m15='Y' + ขั้นต่ำจริง 1,200-6,100 บาท)
  // พิกัดแปะถนนจริงทุกจุด (snap ผ่าน OSRM nearest — เส้นทางลากถึงทุกหมุด)
  var C = [
    ['D0001', 'ลูกค้าตัวอย่าง 1', '2', 13.785848, 101.902939, 'good'],
    ['D0002', 'ลูกค้าตัวอย่าง 2 (อสม.)', '4', 13.767121, 101.90711, 'warning'],
    ['D0003', 'ลูกค้าตัวอย่าง 3', '1', 13.765683, 101.880842, 'bad'],
    ['D0004', 'ลูกค้าตัวอย่าง 4', '3', 13.790315, 101.886743, 'bad'],
    ['D0005', 'ลูกค้าตัวอย่าง 5', '5', 13.75745, 101.901622, 'bad'],
    ['D0006', 'ลูกค้าตัวอย่าง 6', '2', 13.782504, 101.872131, 'good'],
    ['D0007', 'ลูกค้าตัวอย่าง 7', '4', 13.767467, 101.871188, 'warning'],
    ['D0008', 'ลูกค้าตัวอย่าง 8 (อสม.)', '1', 13.797224, 101.912339, 'bad'],
    ['D0009', 'ลูกค้าตัวอย่าง 9', '3', 13.753306, 101.912629, 'bad'],
    ['D0010', 'ลูกค้าตัวอย่าง 10', '5', 13.790381, 101.892601, 'bad'],
    ['D0011', 'ลูกค้าตัวอย่าง 11', '2', 13.763309, 101.919305, 'good'],
    ['D0012', 'ลูกค้าตัวอย่าง 12', '4', 13.805704, 101.885455, 'warning'],
    ['D0013', 'ลูกค้าตัวอย่าง 13 (อสม.)', '1', 13.77363, 101.891967, 'bad'],
    ['D0014', 'ลูกค้าตัวอย่าง 14', '3', 13.778325, 101.908278, 'bad'],
    ['D0015', 'ลูกค้าตัวอย่าง 15', '5', 13.767991, 101.896053, 'bad'],
    ['D0016', 'ลูกค้าตัวอย่าง 16', '2', 13.796302, 101.898904, 'good'],
    ['D0017', 'ลูกค้าตัวอย่าง 17', '4', 13.759695, 101.886333, 'warning'],
    ['D0018', 'ลูกค้าตัวอย่าง 18 (อสม.)', '1', 13.788933, 101.917521, 'bad'],
    ['D0019', 'ลูกค้าตัวอย่าง 19', '3', 13.762999, 101.874001, 'bad'],
    ['D0020', 'ลูกค้าตัวอย่าง 20', '5', 13.799615, 101.890426, 'bad'],
    ['D0021', 'ลูกค้าตัวอย่าง 21', '2', 13.772007, 101.919927, 'good'],
    ['D0022', 'ลูกค้าตัวอย่าง 22', '4', 13.78178, 101.881891, 'warning'],
    ['D0023', 'ลูกค้าตัวอย่าง 23 (อสม.)', '1', 13.755357, 101.90782, 'bad'],
    ['D0024', 'ลูกค้าตัวอย่าง 24', '3', 13.796599, 101.902836, 'bad'],
    ['D0025', 'ลูกค้าตัวอย่าง 25', '5', 13.765955, 101.909995, 'bad'],
    ['D0026', 'ลูกค้าตัวอย่าง 26', '1', 13.78265, 101.883495, 'good'],
    ['D0027', 'ลูกค้าตัวอย่าง 27', '2', 13.779066, 101.915994, 'good'],
    ['D0028', 'ลูกค้าตัวอย่าง 28', '3', 13.762184, 101.890175, 'unclassified'],
    ['D0029', 'ลูกค้าตัวอย่าง 29', '4', 13.788105, 101.883673, 'good'],
    ['D0030', 'ลูกค้าตัวอย่าง 30', '5', 13.776843, 101.898609, 'unclassified']
  ];
  // อสม. 5 ราย (กันตารางหลักยาวเกิน)
  var OMSOM_SET = { D0002: true, D0008: true, D0013: true, D0018: true, D0023: true };
  // 8 ราย "ยังไม่มีพิกัด" — ให้คนลองใช้ demo ได้ลองกดเก็บพิกัดในคิวงานวันนี้จริง
  // 19 พ.ย.69: สลับ D0003 ออกจากกลุ่มนี้ (ต้องมีพิกัดเพื่อขึ้นเส้นทางตัวอย่าง/กดคำนวณเส้นทาง)
  var NO_GPS = { D0004: 1, D0006: 1, D0009: 1, D0012: 1, D0015: 1, D0018: 1, D0024: 1, D0028: 1 };

  // ---------- ข้อมูลสัญญา (เลียนแบบ CI จริง — 12 หลัก, 2-4 สัญญาต่อราย) ----------
  // คอลัมน์: [ต้นเงินคงเป็นหนี้, ชั้นหนี้, ถึงกำหนด dd/mm/yyyy, กันสำรอง %, m15 Y/N, ขั้นต่ำ 15 เดือน, พักหนี้, รับรู้รายได้, โครงการ]
  // ยอดทุกสัญญารวมกัน = หนี้รวมของ CIF นั้น · สัญญาแรกคืองวดที่ถึงกำหนดเร็วสุด (ใช้กรองเดือน)
  var MC = {
    n: '1001 - โครงการปกติของธนาคาร',
    s1: '2975 - บัญชีรวมต้นเงิน ปปน. สร้างสุข (ปรับหนี้ ผ่อนสบาย) ระยะที่ 2 ชั้น 1',
    s2: '2965 - บัญชีรวมต้นเงิน ปปน. สร้างสุข (ปรับหนี้ ผ่อนสบาย) ระยะที่ 2 ชั้น 2',
    i1: '2976 - บัญชีรวมดอกเบี้ย ปปน. สร้างสุข (ปรับหนี้ ผ่อนสบาย) ระยะที่ 2 ชั้น 1',
    x67: '2695 - บัญชีรวมต้นเงิน ปปน.ขยายและลด ปี67 เกษตร/บุคคล',
    rev: '8900 - โครงการฟื้นฟูอาชีพ/ปรับโครงสร้างหนี้ ปี69'
  };
  var CONTRACTS = {
    D0001: [[52300, 1, '05/10/2026', '1', 'N', 0, '', '97NA', MC.n],
            [67700, 1, '31/03/2027', '', 'Y', 2000, '', '95NA', MC.s1]],
    D0002: [[48000, 2, '12/11/2026', '1', 'N', 0, '', '97NA', MC.n],
            [37000, 1, '31/03/2027', '1', 'N', 0, '', '97NA', MC.i1]],
    D0003: [[120000, 3, '18/12/2026', '1', 'N', 0, 'SP', '95NA', MC.x67],
            [75000, 2, '31/03/2027', '1', 'N', 0, '', '97NA', MC.n],
            [45000, 1, '30/06/2027', '', 'N', 0, '', '97NA', MC.i1]],
    D0004: [[150000, 4, '25/02/2027', '1', 'N', 0, '', '97NA', MC.n],
            [70000, 3, '30/06/2027', '1', 'N', 0, '', '95NA', MC.x67],
            [45000, 2, '30/09/2027', '', 'N', 0, '', '97NA', MC.i1],
            [45000, 1, '31/12/2027', '', 'N', 0, '', '97NA', MC.n]],
    D0005: [[60000, 5, '28/03/2027', '1', 'Y', 3400, '', '57AA', MC.s1],
            [35000, 4, '30/06/2027', '1', 'N', 0, '', '97NA', MC.n]],
    D0006: [[110000, 1, '12/10/2026', '1', 'N', 0, '', '97NA', MC.n],
            [68000, 1, '31/03/2027', '', 'N', 0, '', '97NA', MC.i1]],
    D0007: [[250000, 2, '18/11/2026', '1', 'N', 0, '', '97NA', MC.s2],
            [120000, 1, '31/03/2027', '1', 'N', 0, '', '97NA', MC.n],
            [55000, 1, '30/06/2027', '', 'Y', 5800, '', '95NA', MC.i1]],
    D0008: [[43000, 3, '25/12/2026', '1', 'N', 0, '', '97NA', MC.n],
            [30000, 2, '31/03/2027', '', 'N', 0, '', '97NA', MC.i1]],
    D0009: [[90000, 4, '28/02/2027', '1', 'N', 0, 'EP', '95NA', MC.x67],
            [52000, 3, '30/06/2027', '1', 'Y', 2600, '', '97NA', MC.s1]],
    D0010: [[120000, 5, '05/03/2027', '1', 'N', 0, '', '57AA', MC.n],
            [48000, 3, '30/06/2027', '1', 'N', 0, '', '97NA', MC.x67],
            [30000, 2, '30/09/2027', '', 'N', 0, '', '97NA', MC.i1]],
    D0011: [[40000, 1, '18/10/2026', '100', 'N', 0, '', '97NA', MC.n],
            [27000, 1, '31/03/2027', '100', 'Y', 1200, '', '97NA', MC.s1]],
    D0012: [[165000, 2, '25/11/2026', '100', 'N', 0, '', '97NA', MC.n],
            [100000, 1, '30/06/2027', '100', 'N', 0, '', '97NA', MC.i1]],
    D0013: [[54000, 3, '28/12/2026', '100', 'Y', 2300, '', '95NA', MC.x67],
            [35000, 2, '31/03/2027', '100', 'N', 0, 'SP', '97NA', MC.s1]],
    D0014: [[95000, 4, '05/02/2027', '100', 'N', 0, '', '97NA', MC.n],
            [60000, 2, '30/06/2027', '', 'N', 0, '', '97NA', MC.i1]],
    D0015: [[180000, 5, '12/03/2027', '100', 'N', 0, '', '57AA', MC.n],
            [62000, 4, '30/06/2027', '100', 'N', 0, '', '95NA', MC.x67],
            [50000, 3, '30/09/2027', '100', 'N', 0, '', '97NA', MC.s1],
            [40000, 2, '31/12/2027', '', 'N', 0, '', '97NA', MC.i1]],
    D0016: [[46000, 1, '25/10/2026', '100', 'N', 0, '', '97NA', MC.n],
            [30000, 1, '31/03/2027', '100', 'Y', 1800, '', '97NA', MC.i1]],
    D0017: [[130000, 2, '28/11/2026', '100', 'N', 0, '', '97NA', MC.n],
            [80000, 1, '30/06/2027', '100', 'N', 0, '', '97NA', MC.s1]],
    D0018: [[240000, 3, '05/12/2026', '100', 'N', 0, '', '95NA', MC.x67],
            [120000, 2, '31/03/2027', '100', 'N', 0, '', '97NA', MC.s2],
            [70000, 1, '30/06/2027', '100', 'N', 0, '', '97NA', MC.n],
            [50000, 1, '31/12/2027', '100', 'Y', 6100, '', '97NA', MC.i1]],
    D0019: [[36000, 4, '12/02/2027', '100', 'N', 0, '', '97NA', MC.n],
            [23000, 3, '30/06/2027', '', 'N', 0, '', '97NA', MC.i1]],
    D0020: [[84000, 5, '18/03/2027', '100', 'N', 0, '', '57AA', MC.s1],
            [50000, 4, '30/06/2027', '100', 'N', 0, '', '97NA', MC.n]],
    D0021: [[170000, 1, '28/10/2026', '', 'N', 0, '', '97NA', MC.n],
            [105000, 1, '31/03/2027', '', 'N', 0, '', '97NA', MC.i1]],
    D0022: [[60000, 2, '05/11/2026', '', 'N', 0, '', '97NA', MC.n],
            [38000, 1, '30/06/2027', '', 'N', 0, '', '97NA', MC.s1]],
    D0023: [[100000, 3, '12/12/2026', '', 'Y', 4200, '', '95NA', MC.x67],
            [66000, 2, '31/03/2027', '', 'N', 0, '', '97NA', MC.n]],
    D0024: [[240000, 4, '18/02/2027', '', 'N', 0, '', '97NA', MC.n],
            [150000, 3, '30/06/2027', '', 'N', 0, '', '97NA', MC.x67]],
    D0025: [[52000, 5, '25/03/2027', '', 'N', 0, '', '57AA', MC.n],
            [32000, 4, '30/09/2027', '', 'N', 0, '', '97NA', MC.i1]]
  };
  // เลขสัญญา 12 หลักแบบไฟล์ CI จริง (8005xxxxxxxx) — คำนวณจาก cif ให้ซ้ำเดิมทุกครั้ง
  var _ctrSeq = 0;
  function makeContractNo(cif) {
    _ctrSeq++;
    var s = seedOf(cif);
    var tail = String(10000000 + ((s * 7919 + _ctrSeq * 104729) % 89999999)).slice(0, 8);
    var pre = ['8005', '8004', '8003', '8002'][(_ctrSeq + s) % 4];
    return pre + tail;
  }
  function dueKey(d) {
    var m = String(d || '').match(/^(\d+)\/(\d+)\/(\d+)$/);
    return m ? (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) : Infinity;
  }
  var MOCK_CUSTOMERS = C.map(function (r, i) {
    var noGps = !!NO_GPS[r[0]];
    return {
      id: 'db_' + r[0], cif: r[0], name: r[1], nickname: '', phone: '080-000-00' + String(i + 1).padStart(2, '0'),
      address: 'ม.' + ((i % 8) + 1) + ' ต.วังท่าช้าง อ.กบินทร์บุรี จ.ปราจีนบุรี',
      lat: noGps ? null : r[3], lng: noGps ? null : r[4], branch: '854', zone: r[2],
      riskLevel: r[5], debtType: null,
      createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z',
      createdBy: 'AutoImport:StaticDB', geo_source: noGps ? 'none' : 'demo',
      extra: { moo: String((i % 8) + 1), tambon: 'วังท่าช้าง', amphoe: 'กบินทร์บุรี', province: 'ปราจีนบุรี' }
    };
  });
  // สรุปหนี้ต่อ CIF คำนวณจากรายสัญญา (ยอดรวม/จำนวนสัญญา/ชั้นสูงสุด/งวดเร็วสุด) — เหมือนที่ /api/debt-import ทำจริง
  var MOCK_DEBTS = Object.keys(CONTRACTS).map(function (cif) {
    var row = null;
    for (var ri = 0; ri < C.length; ri++) if (C[ri][0] === cif) { row = C[ri]; break; }
    var total = 0, maxTier = 0, earliest = '', earliestKey = Infinity;
    var contracts = CONTRACTS[cif].map(function (a) {
      var d = +a[0], t = +a[1], due = a[2];
      total += d;
      if (t > maxTier) maxTier = t;
      var dk = dueKey(due);
      if (dk < earliestKey) { earliestKey = dk; earliest = due; }
      var p = String(due).split('/');
      return {
        c: makeContractNo(cif), d: d, b15: p.length === 3 ? p[1] + '/' + p[2] : '',
        t: String(t), due: due, reserve: String(a[3] || ''),
        rec: a[7] || '', sub: a[6] || '',
        m15: a[4] === 'Y' ? 'Y' : 'N', m15_amt: (+a[5]) || 0,
        mc: a[8] || '',
        f08: '', p08: 0, f09: '', p09: 0, f10: '', p10: 0
      };
    });
    // คาดการณ์ 15 เดือน (เฉพาะบางสัญญา ให้การ์ดมีข้อมูลให้ดูครบทุกบรรทัด)
    if (cif === 'D0001' && contracts[1]) { contracts[1].f08 = 'Y'; contracts[1].p08 = 2000; }
    if (cif === 'D0018' && contracts[3]) { contracts[3].f10 = 'Y'; contracts[3].p10 = 3000; }
    var _s = seedOf(cif);
    // 19 พ.ย.69: เติมสีศักยภาพรายคน + โครงการนำร่อง Good/Bad ให้เหมือนไฟล์ CI จริง
    // (เดิมไม่มี → แท็บสรุปหนี้ขึ้น "ไม่พบข้อมูลศักยภาพ" / "อัพไฟล์หนี้รอบใหม่")
    var _pot = ['แดง', 'เหลือง', 'เขียว'][_s % 3];
    var _gb = (_s % 6 === 0) ? 'BAD' : 'GOOD';
    return {
      cif: cif, branch: '854', zone: (row && row[2]) || '',
      potential: _pot, gb: _gb,
      total_debt: Math.round(total * 100) / 100,
      num_contracts: contracts.length,
      max_tier: maxTier,
      earliest_due: earliest,
      is_omsom: !!OMSOM_SET[cif],
      contracts: contracts
    };
  });

  // ---------- 2b) ตัวอย่างการบันทึกติดตามในปฏิทิน (ข้อมูลสมมุติ) ----------
  // ให้คณะกรรมการเห็นว่า "ถ้าเคยคีย์นัดไว้แล้ว" ระบบจะเตือน/แสดงผลอย่างไร
  // 19 พ.ย.69: เปลี่ยนจากวันตายตัว → อิง "วันนี้" ตอนเปิดครั้งแรก
  // เพื่อให้เดโมมีตัวอย่างครบทุกสถานะเสมอ: ถึงกำหนดวันนี้ / เลยกำหนด / รอถึงกำหนด / ชำระแล้ว
  function dayOffset(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function daysAgoIso(n) {
    return new Date(Date.now() - n * 86400000).toISOString();
  }
  var SEED_VISITS = {
    'db_D0001': { promiseDate: dayOffset(0), promiseAmount: 5000, promiseStatus: 'pending', status: 'visited',
      note: 'นัดติดตามวันนี้ — ลูกค้าขอผ่อน 2 งวด', timestamp: daysAgoIso(1) },
    'db_D0002': { promiseDate: dayOffset(1), promiseAmount: 3000, promiseStatus: 'pending', status: 'visited',
      note: 'นัดจ่ายพรุ่งนี้ (อสม.)', timestamp: daysAgoIso(1) },
    'db_D0003': { promiseDate: dayOffset(-1), promiseAmount: 6000, promiseStatus: 'pending', status: 'visited',
      note: 'เลยกำหนด 1 วัน — ยังไม่จ่าย ต้องติดตามซ้ำ', timestamp: daysAgoIso(3),
      promiseHistory: [{ date: dayOffset(-8), result: 'rescheduled', newDate: dayOffset(-1), at: daysAgoIso(8) }] },
    'db_D0005': { promiseDate: dayOffset(-9), promiseAmount: 4000, promiseStatus: 'pending', status: 'visited',
      note: 'เลยกำหนดแล้ว — ติดต่อไม่ได้ ต้องลงพื้นที่ซ้ำ', timestamp: daysAgoIso(12) },
    'db_D0007': { promiseDate: dayOffset(-14), promiseAmount: 8000, promiseStatus: 'paid', status: 'visited',
      note: 'จ่ายครบแล้วตามนัด', timestamp: daysAgoIso(15) },
    'db_D0008': { status: 'no_answer', note: 'ไปถึงบ้านไม่มีคนอยู่', timestamp: daysAgoIso(2) },
    'db_D0011': { status: 'not_home', note: 'ญาติแจ้งว่าออกไปทำนา', timestamp: daysAgoIso(2) },
    'db_D0013': { promiseDate: dayOffset(3), promiseAmount: 2500, promiseStatus: 'pending', status: 'interested',
      note: 'รับปากจ่ายปลายสัปดาห์ (อสม.)', timestamp: daysAgoIso(1) }
  };
  try {
    var VKEY = 'demo_bfr_visits_demo01';
    // seed เวอร์ชัน 2 (วันอิงวันนี้) — เขียนทับชุดเก่าวันตายตัวครั้งเดียว
    if (!localStorage.getItem('demo_seed_v2')) {
      localStorage.setItem(VKEY, JSON.stringify(SEED_VISITS));
      localStorage.setItem('demo_seed_v2', '1');
    }
  } catch (e) { /* ignore */ }

  // ---------- 2b-2) เส้นทางตัวอย่างวันนี้ (ให้แท็บบันทึกการเข้าพบมีรายชื่อเหมือนเว็บจริง) ----------
  // เว็บจริงพนักงานมีเส้นทางของวัน → เดโมต้องมีให้เห็น ไม่ใช่หน้าว่าง
  // ใส่ครั้งแรกหลังล็อกอินเท่านั้น (ถ้าผู้ทดลองล้างเส้นทางเอง จะไม่ใส่อีก)
  // ทุกคนในเส้นทางต้องมีพิกัด ไม่งั้นกดคำนวณเส้นทาง (Golden Route) ไม่ได้
  var SEED_ROUTE = ['db_D0001', 'db_D0002', 'db_D0003', 'db_D0005', 'db_D0007',
                    'db_D0008', 'db_D0011', 'db_D0013', 'db_D0016', 'db_D0021'];
  var _routeTries = 0;
  var _routeTimer = setInterval(function () {
    if (++_routeTries > 40) { clearInterval(_routeTimer); return; }
    if (typeof Storage === 'undefined' || typeof Auth === 'undefined') return;
    if (!(Auth.isLoggedIn && Auth.isLoggedIn())) return;
    clearInterval(_routeTimer);
    try {
      if (!localStorage.getItem('demo_route_seeded')) {
        if (!Storage.getRoute().length) Storage.saveRoute(SEED_ROUTE.slice());
        localStorage.setItem('demo_route_seeded', '1');
      }
      if (typeof App !== 'undefined' && App.updateRouteUI) App.updateRouteUI();
      if (typeof Visit !== 'undefined' && Visit.render) Visit.render();
      if (typeof WorkCalendar !== 'undefined' && WorkCalendar.refreshAlert) WorkCalendar.refreshAlert();
    } catch (e) { /* ignore */ }
  }, 700);

  function json(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json', 'X-Demo-Mock': '1' }
    });
  }
  function readBody(init) {
    try { return JSON.parse((init && init.body) || '{}'); } catch (e) { return {}; }
  }

  // ---------- 2c) ปักพิกัดจำลองรายคน (ไม่ทับกัน) ----------
  // demo ไม่มี GPS จริง → กด "เก็บพิกัด" แล้วให้พิกัดจำลองใกล้สำนักงาน โดยกระจายตาม cif
  function seedOf(str) {
    var s = 0;
    for (var i = 0; i < String(str).length; i++) s = (s * 31 + String(str).charCodeAt(i)) % 99991;
    return s;
  }
  function patchDemoGps() {
    if (typeof Customers === 'undefined' || typeof Storage === 'undefined' || typeof Utils === 'undefined') return false;
    if (Customers.__demoGpsPatched) return true;
    Customers.__demoGpsPatched = true;
    var OFFICE = window.OFFICE_LOCATION || { lat: 13.7761, lng: 101.8907 };
    Customers.saveQuickGps = function (id) {
      var list = (Storage.getCustomers ? Storage.getCustomers() : []) || [];
      var c = null;
      for (var i = 0; i < list.length; i++) if (list[i].id === id) { c = list[i]; break; }
      if (!c) return;
      var n = seedOf(c.cif || c.id);
      var lat = +(OFFICE.lat + ((n % 43) - 21) * 0.0011).toFixed(6);
      var lng = +(OFFICE.lng + ((Math.floor(n / 43) % 43) - 21) * 0.0011).toFixed(6);
      if (Utils.toast) Utils.toast('📍 ตัวอย่าง: ปักพิกัดจำลองให้แล้ว (ข้อมูลอยู่ในเครื่องคุณเท่านั้น)', 'info');
      Customers.saveGpsFast(id, c.cif, lat, lng, c.name);
    };
    return true;
  }
  // [ลบออก] เดิม demo บังคับ App.setSheetState('half') หลังล็อกอิน
  // → แผงล่างทับแถบเมนู ทำให้กด "ลูกค้า/หนี้/ปฏิทิน" ไม่ได้ (hit-test เจอ .sheet-tab แทน)
  // เว็บจริงไม่ทำแบบนี้ → ให้ demo ใช้สถานะเริ่มต้นเหมือนเว็บจริงทุกประการ
  var _gpsTries = 0;
  var _gpsTimer = setInterval(function () { if (patchDemoGps() || ++_gpsTries > 40) clearInterval(_gpsTimer); }, 500);

  // ---------- 3) ดัก fetch ----------
  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var raw = String((input && input.url) || input || '');
    var method = String(((init && init.method) || (input && input.method) || 'GET')).toUpperCase();
    var path = null;
    try {
      var u = new URL(raw, location.origin);
      if (u.origin === location.origin) path = u.pathname + u.search;
    } catch (e) { /* URL ภายนอก ปล่อยผ่าน */ }

    if (path && path.indexOf('/version.json') === 0) {
      return Promise.resolve(json({ version: 'demo-20261023', lastUpdate: '2026-10-23', changelog: 'เว็บตัวอย่างสำหรับคณะกรรมการ (ข้อมูลสมมุติ)' }));
    }
    if (!path || path.indexOf('/api/') !== 0) return _fetch(input, init); // แผนที่/OSRM/ฟอนต์/ราคาน้ำมัน ปล่อยผ่าน

    var p = path.split('?')[0];
    // --- login ---
    if (p === '/api/login' && method === 'POST') {
      var b = readBody(init);
      if (String(b.pin) === '1234' && (!b.username || b.username === 'demo01')) {
        return Promise.resolve(json({ success: true, token: fakeToken(), user: MOCK_USER }));
      }
      return Promise.resolve(json({ success: false, error: 'PIN ไม่ถูกต้อง (เว็บตัวอย่างใช้ PIN 1234)' }));
    }
    if (p === '/api/auth/login') {
      return Promise.resolve(json({ success: false, error: 'เว็บตัวอย่างใช้ทางเข้าหลักเท่านั้น' }));
    }
    // --- staff list (สาธารณะ) ---
    if (p === '/api/staff') return Promise.resolve(json({ success: true, staff: MOCK_STAFF }));
    // --- customers ---
    if (p === '/api/customers' && method === 'GET') {
      return Promise.resolve(json({ success: true, customers: MOCK_CUSTOMERS, total: MOCK_CUSTOMERS.length }));
    }
    if (p.indexOf('/api/customers/') === 0 && (method === 'PUT' || method === 'DELETE')) {
      return Promise.resolve(json({ success: true, demo: true }));
    }
    if (p === '/api/customers/sync') return Promise.resolve(json({ success: true, demo: true }));
    // --- gps overlay (ว่าง — พิกัดมากับลูกค้าแล้ว) ---
    if (p === '/api/gps-overlay') {
      return Promise.resolve(json({ success: true, overlay: {}, overlayUpdatedAt: null }));
    }
    // --- debt (คืนอาร์เรย์ เหมือนของจริง) ---
    if (p === '/api/debt-data') {
      if (/[?&]v=1(&|$)/.test(path)) return Promise.resolve(json({ success: true, updated: DEMO_T0 }));
      return Promise.resolve(json(MOCK_DEBTS));
    }
    // --- สรุปตัวเลขจากเซิร์ฟเวอร์ (ตัวเลขหลักบนแท็บสรุปหนี้ — ให้เหมือนเว็บจริง) ---
    if (p === '/api/customers/stats') {
      var _sum = 0;
      MOCK_DEBTS.forEach(function (r) { _sum += (+r.total_debt || 0); });
      return Promise.resolve(json({
        success: true,
        total_customers: MOCK_CUSTOMERS.length,
        with_debt: MOCK_DEBTS.length,
        debt_total: _sum,
        by_branch: [{ branch: '854', customers: MOCK_CUSTOMERS.length, with_debt: MOCK_DEBTS.length, debt_total: _sum }],
        scope_branch: '', serverTime: DEMO_T0
      }));
    }
    if (p === '/api/branches') {
      return Promise.resolve(json({ success: true, branches: [{ code: '854', name: 'สาขาจำลอง (วังท่าช้าง)' }] }));
    }
    // --- sync (นิ่ง — ไม่มีข้อมูลใหม่จากส่วนกลางในโหมดตัวอย่าง) ---
    if (p === '/api/sync' && method === 'GET') {
      var _gpsN = 0;
      MOCK_CUSTOMERS.forEach(function (c) { if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) _gpsN++; });
      return Promise.resolve(json({
        success: true, serverTime: DEMO_T0, overlayUpdatedAt: null,
        visits: SEED_VISITS, visitsByUser: { demo01: SEED_VISITS }, savedRoutes: [], customers: [],
        counts: { customers: MOCK_CUSTOMERS.length, visits: Object.keys(SEED_VISITS).length, savedRoutes: 0, gps: _gpsN }
      }));
    }
    if (p === '/api/sync' && method === 'POST') {
      return Promise.resolve(json({ success: true, serverTime: DEMO_T0, demo: true }));
    }
    if (p === '/api/refresh-token') {
      return Promise.resolve(json({ success: true, token: fakeToken(), user: MOCK_USER }));
    }
    // --- อื่น ๆ ที่หน้าแอดมินเรียก: ตอบว่างแบบสุภาพ ไม่ 401 (กัน logout วน) ---
    return Promise.resolve(json({ success: false, demo: true, error: 'เว็บตัวอย่างไม่รองรับเมนูนี้' }));
  };

  // ---------- 4) ป้ายเว็บตัวอย่าง ----------
  function banner() {
    if (document.getElementById('demo-banner')) return;
    if (sessionStorage.getItem('demo_banner_closed') === '1') return;
    var d = document.createElement('div');
    d.id = 'demo-banner';
    d.innerHTML = '<span>เว็บตัวอย่าง · ข้อมูลสมมุติ · PIN <b>1234</b></span>' +
      '<button type="button" id="demo-banner-fix" title="ลบแคชเก่า + โหลดเว็บใหม่ 1 จิ้ม">🔄 ซ่อมเว็บ</button>' +
      '<button type="button" id="demo-banner-reset" title="ล้างข้อมูลที่ลองแก้ แล้วเริ่มใหม่">เริ่มใหม่</button>' +
      '<button type="button" id="demo-banner-x" aria-label="ปิดป้าย">✕</button>';
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:60000;background:#7c2d12;color:#fff;' +
      'font-size:14px;font-weight:700;text-align:center;padding:8px 96px 8px 12px;line-height:1.45;';
    // spacer กันแบนเนอร์ทับหัวเว็บ (ตัวเลือกของเว็บจริงต้องมองเห็นครบ)
    var sp = document.createElement('div');
    sp.id = 'demo-banner-spacer';
    sp.style.cssText = 'height:0;flex:0 0 auto';
    var fit = function () { sp.style.height = d.offsetHeight + 'px'; };
    window.addEventListener('resize', fit);
    window.addEventListener('load', fit);
    setTimeout(fit, 400);
    setTimeout(fit, 1200);
    var fx = d.querySelector('#demo-banner-fix');
    fx.style.cssText = 'margin-left:6px;background:#fff;color:#7c2d12;border:1px solid #fff;' +
      'border-radius:10px;font-size:14px;padding:0 10px;min-height:40px;font-weight:700';
    fx.onclick = function () { window.__demoHardRepair(fx); };
    var rs = d.querySelector('#demo-banner-reset');
    rs.style.cssText = 'margin-left:8px;background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.55);' +
      'border-radius:10px;font-size:13px;padding:0 10px;min-height:32px;font-weight:600';
    rs.onclick = function () {
      try {
        Object.keys(localStorage).filter(function (k) { return k.indexOf('demo_') === 0; })
          .forEach(function (k) { localStorage.removeItem(k); });
        sessionStorage.clear();
        if (window.indexedDB && indexedDB.deleteDatabase) indexedDB.deleteDatabase('bfr-demo');
      } catch (e) { /* ignore */ }
      // สำคัญ: ห้าม location.reload() ธรรมดา — แคชเดิมจะยังอยู่แล้วค้างที่เดิมอีก
      window.__demoHardRepair(rs);
    };
    var x = d.querySelector('#demo-banner-x');
    x.style.cssText = 'position:absolute;right:6px;top:50%;transform:translateY(-50%);background:transparent;' +
      'color:#fff;border:2px solid #fff;border-radius:10px;font-size:16px;min-width:40px;min-height:40px;';
    x.onclick = function () {
      try { sessionStorage.setItem('demo_banner_closed', '1'); } catch (e) {}
      d.remove(); sp.remove();
      window.removeEventListener('resize', fit);
    };
    document.body.prepend(sp);
    document.body.prepend(d);
    requestAnimationFrame(fit);
  }
  if (document.body) banner();
  else document.addEventListener('DOMContentLoaded', banner);
})();
