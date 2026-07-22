// Change password — POST /api/change-password
// Authenticated users can change their own password
// Requires: { currentPassword, newPassword }

import { extractBearerToken, verifyHS256 } from '../_lib/jwt.js';
import { hashPassword, verifyPassword } from '../_lib/crypto.js';

const USERS_KV_KEY = 'users:all';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Auth check
  const token = extractBearerToken(request);
  if (!token) return json({ success: false, error: 'No token' }, 401);
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return json({ success: false, error: 'Session หมดอายุ กรุณา login ใหม่' }, 401);

  // PIN-login users cannot change password (no password stored)
  if (payload.pin) {
    return json({ success: false, error: 'ผู้ใช้ที่เข้าสู่ระบบด้วย PIN ไม่สามารถเปลี่ยนรหัสผ่านได้' }, 400);
  }

  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  // Parse body
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) {
    return json({ success: false, error: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่' }, 400);
  }
  if (newPassword.length < 4) {
    return json({ success: false, error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร' }, 400);
  }

  // Find user
  const raw = await env.BFR_KV.get(USERS_KV_KEY);
  const users = raw ? JSON.parse(raw) : [];
  const user = users.find(u => u.id === payload.sub && !u.deleted);
  if (!user) return json({ success: false, error: 'ไม่พบผู้ใช้' }, 404);

  // Verify current password
  const valid = await verifyPassword(currentPassword, user.password);
  if (!valid) return json({ success: false, error: 'รหัสผ่านเดิมไม่ถูกต้อง' }, 401);

  // Hash and update
  user.password = await hashPassword(newPassword);
  user.updatedAt = new Date().toISOString();
  await env.BFR_KV.put(USERS_KV_KEY, JSON.stringify(users));

  return json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ ✅' });
}
