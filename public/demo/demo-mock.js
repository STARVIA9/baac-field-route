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
  var C = [
    ['D0001', 'ลูกค้าตัวอย่าง 1', '1', 13.7865, 101.9012, 'good', 120000, '10/11/2026', 1],
    ['D0002', 'ลูกค้าตัวอย่าง 2', '1', 13.7712, 101.9055, 'good', 85000, '15/11/2026', 1],
    ['D0003', 'ลูกค้าตัวอย่าง 3', '2', 13.7650, 101.8830, 'warning', 240000, '05/11/2026', 2],
    ['D0004', 'ลูกค้าตัวอย่าง 4', '2', 13.7920, 101.8845, 'good', 0, '', 0],
    ['D0005', 'ลูกค้าตัวอย่าง 5', '3', 13.7580, 101.8980, 'bad', 310000, '28/10/2026', 3],
    ['D0006', 'ลูกค้าตัวอย่าง 6', '3', 13.7830, 101.8720, 'good', 95000, '12/12/2026', 1],
    ['D0007', 'ลูกค้าตัวอย่าง 7', '4', 13.7690, 101.8700, 'warning', 178000, '08/11/2026', 2],
    ['D0008', 'ลูกค้าตัวอย่าง 8', '4', 13.7960, 101.9120, 'unclassified', 0, '', 0],
    ['D0009', 'ลูกค้าตัวอย่าง 9', '5', 13.7520, 101.9120, 'bad', 425000, '15/10/2026', 3],
    ['D0010', 'ลูกค้าตัวอย่าง 10', '5', 13.7900, 101.8950, 'good', 73000, '30/11/2026', 1],
    ['D0011', 'ลูกค้าตัวอย่าง 11', '1', 13.7620, 101.9180, 'warning', 142000, '18/11/2026', 2],
    ['D0012', 'ลูกค้าตัวอย่าง 12', '2', 13.8000, 101.8780, 'unclassified', 0, '', 0]
  ];
  var MOCK_CUSTOMERS = C.map(function (r, i) {
    return {
      id: 'db_' + r[0], cif: r[0], name: r[1], nickname: '', phone: '080-000-00' + String(i + 1).padStart(2, '0'),
      address: 'ม.' + ((i % 8) + 1) + ' ต.วังท่าช้าง อ.กบินทร์บุรี จ.ปราจีนบุรี',
      lat: r[3], lng: r[4], branch: '854', zone: r[2],
      riskLevel: r[5], debtType: null,
      createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z',
      createdBy: 'AutoImport:StaticDB', geo_source: 'demo',
      extra: { moo: String((i % 8) + 1), tambon: 'วังท่าช้าง', amphoe: 'กบินทร์บุรี', province: 'ปราจีนบุรี' }
    };
  });
  var MOCK_DEBTS = C.filter(function (r) { return r[6] > 0; }).map(function (r) {
    return {
      cif: r[0], total_debt: r[6], num_contracts: 1, max_tier: r[8], earliest_due: r[7],
      contracts: [{ c: 'CTR-' + r[0] + '-01', d: r[6], due: r[7], t: r[8] }]
    };
  });

  function json(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json', 'X-Demo-Mock': '1' }
    });
  }
  function readBody(init) {
    try { return JSON.parse((init && init.body) || '{}'); } catch (e) { return {}; }
  }

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
    // --- sync (นิ่ง — ไม่มีข้อมูลใหม่จากส่วนกลางในโหมดตัวอย่าง) ---
    if (p === '/api/sync' && method === 'GET') {
      return Promise.resolve(json({
        success: true, serverTime: DEMO_T0, overlayUpdatedAt: null,
        visits: {}, visitsByUser: {}, savedRoutes: [], customers: [],
        counts: { customers: MOCK_CUSTOMERS.length, visits: 0, savedRoutes: 0 }
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
    d.innerHTML = '<span>เว็บตัวอย่างสำหรับคณะกรรมการ — ข้อมูลสมมุติทั้งหมด ไม่ใช่ข้อมูลจริง<br>' +
      'แตะชื่อ “เจ้าหน้าที่ตัวอย่าง” แล้วกรอก PIN <b>1234</b> เพื่อทดลองใช้งาน</span>' +
      '<button type="button" id="demo-banner-x" aria-label="ปิดป้าย">✕</button>';
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:60000;background:#7c2d12;color:#fff;' +
      'font-size:15px;font-weight:700;text-align:center;padding:10px 44px 10px 12px;line-height:1.5;';
    var x = d.querySelector('#demo-banner-x');
    x.style.cssText = 'position:absolute;right:6px;top:50%;transform:translateY(-50%);background:transparent;' +
      'color:#fff;border:2px solid #fff;border-radius:10px;font-size:16px;min-width:40px;min-height:40px;';
    x.onclick = function () {
      try { sessionStorage.setItem('demo_banner_closed', '1'); } catch (e) {}
      d.remove();
    };
    document.body.prepend(d);
  }
  if (document.body) banner();
  else document.addEventListener('DOMContentLoaded', banner);
})();
