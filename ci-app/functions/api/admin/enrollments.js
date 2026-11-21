// /api/admin/enrollments — หน้าอนุมัติของ branch_admin (สิทธิ์ตามสาขาของ cookie)
// GET  = รายการคำขอในสาขาตัวเอง · POST = อนุมัติ/ปฏิเสธ/เพิกถอน
// การกดอนุมัติคือ gate จริง (§7.9) — ฟอร์ม 5 ข้อเป็นแค่ข้อมูลติดต่อ
import { verifyToken, readSession } from '../../_lib/ci-auth.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

async function adminOf(request, env) {
  return await verifyToken(env, readSession(request));
}

export async function onRequestGet({ request, env }) {
  const admin = await adminOf(request, env);
  if (!admin) return json({ ok: false, error: 'เข้าสู่ระบบก่อน' }, 401);
  if (!env.CI_DB) return json({ ok: false, error: 'ยังไม่ได้ผูกฐานข้อมูล' }, 503);
  const res = await env.CI_DB.prepare(`
    SELECT device_id, employee_id, full_name, position, branch, province, status, created_at, decided_at
    FROM enrollments WHERE branch=?
    ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 100
  `).bind(admin.branch).all();
  return json({ ok: true, branch: admin.branch, items: res.results || [] });
}

export async function onRequestPost({ request, env }) {
  const admin = await adminOf(request, env);
  if (!admin) return json({ ok: false, error: 'เข้าสู่ระบบก่อน' }, 401);
  let b;
  try { b = await request.json(); } catch { return json({ ok: false, error: 'ข้อมูลไม่ถูกต้อง' }, 400); }
  const deviceId = clean(b.deviceId, 64);
  const decision = clean(b.decision, 20);
  if (!deviceId || !['approved', 'rejected', 'revoked'].includes(decision))
    return json({ ok: false, error: 'คำสั่งไม่ถูกต้อง' }, 400);
  if (!env.CI_DB) return json({ ok: false, error: 'ยังไม่ได้ผูกฐานข้อมูล' }, 503);
  const row = await env.CI_DB.prepare('SELECT branch FROM enrollments WHERE device_id=?').bind(deviceId).first();
  if (!row) return json({ ok: false, error: 'ไม่พบคำขอนี้' }, 404);
  // กัน branch_admin สาขาหนึ่งกดอนุมัติเครื่องของอีกสาขา
  if (row.branch !== admin.branch) return json({ ok: false, error: 'คำขอนี้ไม่ใช่สาขาของท่าน' }, 403);
  await env.CI_DB.prepare('UPDATE enrollments SET status=?, decided_at=?, decided_by=? WHERE device_id=?')
    .bind(decision, new Date().toISOString(), admin.branch, deviceId).run();
  return json({ ok: true, deviceId, status: decision });
}
