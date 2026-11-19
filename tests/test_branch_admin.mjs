// Harness: ระบบแอดมินสาขา (branch_admin) — scope ผู้ใช้/PIN/ประวัติ แยกตามสาขา
// รัน: node tests/test_branch_admin.mjs
import { onRequestGet as usersGet, onRequestPost as usersPost, onRequestPut as usersPut, onRequestDelete as usersDelete } from '../functions/api/admin/users.js';
import { onRequestGet as loginsGet } from '../functions/api/admin/logins.js';
import { onRequestGet as viewsGet } from '../functions/api/admin/views.js';
import { onRequestGet as branchesGet } from '../functions/api/admin/branches.js';
import { signHS256 } from '../functions/_lib/jwt.js';
import { hashPassword, verifyPassword } from '../functions/_lib/crypto.js';

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' — ' + extra : '')); if (!c) fails++; };

const SECRET = 'test-secret-at-least-32-chars-long!!';
const NOW = Math.floor(Date.now() / 1000);

function makeKV(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get: async k => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async k => { m.delete(k); },
    _map: m,
  };
}

const pinHash = async (p) => hashPassword(p);

const seedUsers = [
  { id: 'adm1', username: 'admin', displayName: 'แอดมินกลาง', role: 'admin', branch: 'WTC', pinHash: await pinHash('3117'), pwdVersion: 1, deleted: false },
  { id: 'kb1', username: 'kbb_admin', displayName: 'ผู้ดูแลกบินทร์', role: 'branch_admin', branch: 'KBB', pinHash: await pinHash('5501'), pwdVersion: 1, deleted: false },
  { id: 'k1', username: 'kbb01', displayName: 'พนักงานกบินทร์ 1', role: 'user', branch: 'KBB', pinHash: await pinHash('1111'), pwdVersion: 1, deleted: false },
  { id: 'w1', username: 'wtc01', displayName: 'พนักงานวังท่าช้าง 1', role: 'user', branch: 'WTC', pinHash: await pinHash('2222'), pwdVersion: 1, deleted: false },
];

const tok = (sub, role, branch) => signHS256({ sub, username: sub, name: sub, role, branch, pv: 1, iat: NOW, exp: NOW + 3600 }, SECRET);
const adminTok = await tok('adm1', 'admin', 'WTC');
const kbTok = await tok('kb1', 'branch_admin', 'KBB');
const staffTok = await tok('k1', 'user', 'KBB');
const req = (path, t, method = 'GET', body) => new Request('https://baacroute.shop' + path, {
  method,
  headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const envWith = (kv) => ({ BFR_JWT_SECRET: SECRET, BFR_KV: kv });

// ===== 1) GET /api/admin/users — scope ตามสาขา =====
{
  const kv = makeKV({ 'users:all': JSON.stringify(seedUsers) });
  const env = envWith(kv);

  const r = await usersGet({ request: req('/api/admin/users', kbTok), env });
  const j = await r.json();
  ok('branch_admin: 200 + เห็นเฉพาะสาขา KBB', r.status === 200 && j.success && j.users.every(u => u.branch === 'KBB'), JSON.stringify(j.users?.map(u => u.username)));
  ok('branch_admin: ไม่เห็นแถวสาขา WTC', !j.users.some(u => u.branch === 'WTC'));
  ok('branch_admin: scope คืนค่า KBB', j.scope === 'KBB');

  const ra = await usersGet({ request: req('/api/admin/users', adminTok), env });
  const ja = await ra.json();
  ok('admin กลาง: เห็นทุกสาขา (4 คน)', ra.status === 200 && ja.users.length === 4, 'นับ ' + (ja.users || []).length);

  const rs = await usersGet({ request: req('/api/admin/users', staffTok), env });
  ok('พนักงานทั่วไป: 403', rs.status === 403);

  const rn = await usersGet({ request: req('/api/admin/users', null), env });
  ok('ไม่มี token: 401', rn.status === 401);
}

// ===== 2) POST — ผู้ดูแลสาขาโดนบังคับสาขาตัวเอง + ตั้ง role สูงไม่ได้ =====
{
  const kv = makeKV({ 'users:all': JSON.stringify(seedUsers) });
  const env = envWith(kv);

  const r1 = await usersPost({ request: req('/api/admin/users', kbTok, 'POST', { username: 'kbb02', displayName: 'ใหม่ กบินทร์', branch: 'WTC', pin: '3333' }), env });
  const j1 = await r1.json();
  const saved = JSON.parse(kv._map.get('users:all')).find(u => u.username === 'kbb02');
  ok('branch_admin: สร้างได้ (201)', r1.status === 201 && j1.success, j1.error || '');
  ok('branch_admin: สาขาถูกบังคับเป็น KBB (ไม่ใช่ WTC ที่ส่งมา)', !!saved && saved.branch === 'KBB', saved && saved.branch);
  ok('branch_admin: role ที่ได้เป็น user', !!saved && saved.role === 'user');

  const r2 = await usersPost({ request: req('/api/admin/users', kbTok, 'POST', { username: 'kbb03', displayName: 'อยากเป็นแอดมิน', branch: 'KBB', pin: '3334', role: 'admin' }), env });
  ok('branch_admin: สร้าง role admin → 403', r2.status === 403);

  const r3 = await usersPost({ request: req('/api/admin/users', kbTok, 'POST', { username: 'kbb04', displayName: 'PIN ซ้ำ', branch: 'KBB', pin: '2222' }), env });
  ok('branch_admin: PIN ซ้ำ (มีคนใช้แล้ว) → 409', r3.status === 409);

  const r4 = await usersPost({ request: req('/api/admin/users', adminTok, 'POST', { username: 'wtc_admin', displayName: 'ผอ.วังท่าช้าง', branch: 'WTC', pin: '6601', role: 'branch_admin' }), env });
  const j4 = await r4.json();
  const saved2 = JSON.parse(kv._map.get('users:all')).find(u => u.username === 'wtc_admin');
  ok('admin กลาง: ตั้งผู้ดูแลสาขาได้', r4.status === 201 && saved2 && saved2.role === 'branch_admin', j4.error || '');
}

// ===== 3) PUT — ข้ามสาขาแก้ไม่ได้ · PIN ตัวเองได้ · ยกระดับสิทธิ์ไม่ได้ =====
{
  const kv = makeKV({ 'users:all': JSON.stringify(seedUsers) });
  const env = envWith(kv);

  const r1 = await usersPut({ request: req('/api/admin/users', kbTok, 'PUT', { id: 'w1', pin: '9999' }), env });
  ok('branch_admin: ตั้ง PIN คนต่างสาขา → 403', r1.status === 403);

  const r2 = await usersPut({ request: req('/api/admin/users', kbTok, 'PUT', { id: 'k1', pin: '4444' }), env });
  const k1 = JSON.parse(kv._map.get('users:all')).find(u => u.id === 'k1');
  ok('branch_admin: ตั้ง PIN พนักงานในสาขาได้', r2.status === 200 && await verifyPassword('4444', k1.pinHash));
  ok('branch_admin: PIN ถูกเก็บเป็น hash (ไม่ใช่ plain)', k1.pinHash !== '4444' && !k1.pinHash.includes('4444'));

  const r3 = await usersPut({ request: req('/api/admin/users', kbTok, 'PUT', { id: 'kb1', pin: '5502' }), env });
  const kb1 = JSON.parse(kv._map.get('users:all')).find(u => u.id === 'kb1');
  ok('branch_admin: เปลี่ยน PIN ตัวเองได้', r3.status === 200 && await verifyPassword('5502', kb1.pinHash));

  const r4 = await usersPut({ request: req('/api/admin/users', kbTok, 'PUT', { id: 'kb1', role: 'admin' }), env });
  const kb1b = JSON.parse(kv._map.get('users:all')).find(u => u.id === 'kb1');
  ok('branch_admin: ยกระดับตัวเองเป็น admin ไม่ได้', r4.status === 200 && kb1b.role === 'branch_admin', 'role=' + kb1b.role);

  const r5 = await usersPut({ request: req('/api/admin/users', kbTok, 'PUT', { id: 'adm1', pin: '0000' }), env });
  ok('branch_admin: แก้แอดมินกลาง → 403', r5.status === 403);

  const r6 = await usersPut({ request: req('/api/admin/users', adminTok, 'PUT', { id: 'k1', role: 'branch_admin' }), env });
  const k1b = JSON.parse(kv._map.get('users:all')).find(u => u.id === 'k1');
  ok('admin กลาง: เปลี่ยน role ได้', r6.status === 200 && k1b.role === 'branch_admin');
}

// ===== 4) DELETE — เฉพาะพนักงานในสาขาตัวเอง =====
{
  const kv = makeKV({ 'users:all': JSON.stringify(seedUsers) });
  const env = envWith(kv);

  const r1 = await usersDelete({ request: req('/api/admin/users', kbTok, 'DELETE', { id: 'w1' }), env });
  ok('branch_admin: ลบคนต่างสาขา → 403', r1.status === 403);

  const r2 = await usersDelete({ request: req('/api/admin/users', kbTok, 'DELETE', { id: 'adm1' }), env });
  ok('branch_admin: ลบแอดมินกลาง → 403', r2.status === 403);

  const r3 = await usersDelete({ request: req('/api/admin/users', kbTok, 'DELETE', { id: 'k1' }), env });
  const k1 = JSON.parse(kv._map.get('users:all')).find(u => u.id === 'k1');
  ok('branch_admin: ลบพนักงานในสาขาได้ (soft delete)', r3.status === 200 && k1.deleted === true);

  const r4 = await usersDelete({ request: req('/api/admin/users', kbTok, 'DELETE', { id: 'kb1' }), env });
  ok('branch_admin: ลบตัวเองไม่ได้', r4.status === 400);
}

// ===== 5) GET /api/admin/logins — กรองตามสาขา =====
{
  const logins = [
    { username: 'wtc01', branch: 'WTC', at: '2026-11-16T01:00:00Z' },
    { username: 'kbb01', branch: 'KBB', at: '2026-11-16T02:00:00Z' },
    { username: 'admin', branch: 'WTC', at: '2026-11-16T03:00:00Z' },
  ];
  const kv = makeKV({ 'loginlog:all': JSON.stringify(logins), 'users:all': JSON.stringify(seedUsers) });
  const env = envWith(kv);

  const rb = await loginsGet({ request: req('/api/admin/logins', kbTok), env });
  const jb = await rb.json();
  ok('branch_admin: เห็นประวัติเฉพาะ KBB', rb.status === 200 && jb.logins.length === 1 && jb.logins[0].username === 'kbb01', JSON.stringify(jb.logins));

  const ra = await loginsGet({ request: req('/api/admin/logins', adminTok), env });
  const ja = await ra.json();
  ok('admin กลาง: เห็นทุกสาขา (3)', ra.status === 200 && ja.logins.length === 3);

  const rs = await loginsGet({ request: req('/api/admin/logins', staffTok), env });
  ok('พนักงาน: 403', rs.status === 403);
}

// ===== 6) GET /api/admin/views — กรองเฉพาะ viewer ในสาขา =====
{
  const kv = makeKV({ 'users:all': JSON.stringify(seedUsers) });
  let captured = null;
  const db = (rows) => ({
    prepare: (sql) => {
      captured = sql;
      const stmt = { bind: (...a) => { captured = { sql, args: a }; return stmt; }, all: async () => ({ results: rows }) };
      return stmt;
    },
  });
  const envB = { BFR_JWT_SECRET: SECRET, BFR_KV: kv, BFR_DB: db([{ id: 1, cif: 'C1', viewer: 'kbb01' }]) };
  const rb = await viewsGet({ request: req('/api/admin/views', kbTok), env: envB });
  const jb = await rb.json();
  ok('branch_admin: สมุดคุม 200', rb.status === 200 && jb.success);
  ok('branch_admin: query กรองด้วย viewer IN (สาขาตัวเอง)', String(captured?.sql || captured).includes('viewer IN'), String(captured?.sql || captured).slice(0, 80));
  ok('branch_admin: ส่งชื่อ viewer ของ KBB (ไม่มี wtc01)', Array.isArray(captured?.args) && captured.args.includes('kbb01') && !captured.args.includes('wtc01'), JSON.stringify(captured?.args));

  const envA = { BFR_JWT_SECRET: SECRET, BFR_KV: kv, BFR_DB: db([{ id: 1 }, { id: 2 }]) };
  const ra = await viewsGet({ request: req('/api/admin/views', adminTok), env: envA });
  const ja = await ra.json();
  ok('admin กลาง: สมุดคุมเห็นทั้งหมด (ไม่กรอง)', ra.status === 200 && ja.views.length === 2);

  const rs = await viewsGet({ request: req('/api/admin/views', staffTok), env: envA });
  ok('พนักงาน: สมุดคุม 403', rs.status === 403);
}

// ===== 7) endpoint แอดมินกลางล้วน ต้องยังปิดผู้ดูแลสาขา =====
{
  const kv = makeKV({ 'users:all': JSON.stringify(seedUsers) });
  const env = envWith(kv);
  const rb = await branchesGet({ request: req('/api/admin/branches', kbTok), env });
  ok('branch_admin: เพิ่ม/ดูสาขา (admin/branches) → 403', rb.status === 403);
}

console.log(fails ? `\n❌ FAIL ${fails} ข้อ` : '\n✅ ผ่านทั้งหมด');
process.exit(fails ? 1 : 0);
