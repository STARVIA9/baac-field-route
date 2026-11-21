// POST /api/enroll — พนักงานขออนุมัติ (5 ข้อ + รหัสเครื่อง)
// GET  /api/enroll?device=<id> — เช็คสถานะ (ไม่ต้องล็อกอิน รหัสเครื่องเป็นสุ่ม)
// ข้อมูลที่ขึ้นเซิร์ฟเวอร์ = ข้อมูลติดต่อเจ้าหน้าที่เท่านั้น ไม่มีข้อมูลลูกค้า (§4 Phase 2)
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ ok: false, error: 'ข้อมูลไม่ถูกต้อง' }, 400); }
  const deviceId = clean(b.deviceId, 64);
  const employeeId = clean(b.employeeId, 40);
  const fullName = clean(b.fullName, 120);
  const position = clean(b.position, 80);
  const branch = clean(b.branch, 10);
  const province = clean(b.province, 80);
  if (!deviceId || !employeeId || !fullName || !position || !branch || !province)
    return json({ ok: false, error: 'กรอกข้อมูลให้ครบ 5 ช่อง' }, 400);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId))
    return json({ ok: false, error: 'รหัสเครื่องไม่ถูกต้อง' }, 400);
  if (!env.CI_DB) return json({ ok: false, error: 'ยังไม่ได้ผูกฐานข้อมูล' }, 503);
  try {
    // ponytail: เครื่องที่อนุมัติแล้วสมัครซ้ำไม่ให้ตกกลับมา pending (รักษาสิทธิ์เดิม)
    await env.CI_DB.prepare(`
      INSERT INTO enrollments (device_id, employee_id, full_name, position, branch, province, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT(device_id) DO UPDATE SET
        employee_id=excluded.employee_id, full_name=excluded.full_name,
        position=excluded.position, branch=excluded.branch, province=excluded.province,
        status = CASE WHEN enrollments.status='approved' THEN 'approved' ELSE 'pending' END,
        created_at=excluded.created_at
    `).bind(deviceId, employeeId, fullName, position, branch, province, new Date().toISOString()).run();
  } catch (e) {
    return json({ ok: false, error: 'บันทึกคำขอไม่ได้: ' + (e.message || '').slice(0, 80) }, 500);
  }
  return json({ ok: true, status: 'pending' });
}

export async function onRequestGet({ request, env }) {
  const deviceId = clean(new URL(request.url).searchParams.get('device'), 64);
  if (!deviceId) return json({ ok: false, error: 'ไม่พบรหัสเครื่อง' }, 400);
  if (!env.CI_DB) return json({ ok: false, error: 'ยังไม่ได้ผูกฐานข้อมูล' }, 503);
  const row = await env.CI_DB.prepare('SELECT status, branch FROM enrollments WHERE device_id=?')
    .bind(deviceId).first();
  return json({ ok: true, status: row ? row.status : 'none', branch: row ? row.branch : null });
}
