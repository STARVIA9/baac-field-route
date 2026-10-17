// Change password — POST /api/change-password
// Authenticated users can change their own password
// Requires: { currentPassword, newPassword }

import { extractBearerToken, verifyHS256, jwtSecret } from '../_lib/jwt.js';
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
  const __secret = jwtSecret(env, request);
  if (!__secret) return json({ success: false, error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ (BFR_JWT_SECRET)' }, 500);
  const payload = await verifyHS256(token, __secret);
  if (!payload) return json({ success: false, error: 'Session หมดอายุ กรุณา login ใหม่' }, 401);

  // PIN-login users cannot change password (no password stored)
  // ⚠️ JWT ที่ออกให้ผู้ใช้ PIN ไม่มี field `pin` (login.js สร้าง {sub:'pin-xxxx'} / {sub:'admin-pin'})
  // จึงต้องดูจาก sub ไม่งั้นเช็คไม่ติด แล้วไปตายที่ "ไม่พบผู้ใช้"
  const isPinUser = payload.pin
    || (typeof payload.sub === 'string' && (payload.sub.startsWith('pin-') || payload.sub === 'admin-pin'));
  if (isPinUser) {
    return json({ success: false, error: 'บัญชีนี้เข้าสู่ระบบด้วย PIN — ไม่มีรหัสผ่านให้เปลี่ยน' }, 400);
  }

  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  // Parse body
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { currentPassword, newPassword } = body;
  if (!newPassword) {
    return json({ success: false, error: 'กรุณากรอกรหัสผ่านใหม่' }, 400);
  }
  if (newPassword.length < 4) {
    return json({ success: false, error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร' }, 400);
  }

  // Find user
  const raw = await env.BFR_KV.get(USERS_KV_KEY);
  const users = raw ? JSON.parse(raw) : [];
  const user = users.find(u => u.id === payload.sub && !u.deleted);
  if (!user) return json({ success: false, error: 'ไม่พบผู้ใช้' }, 404);

  if (!user.password) {
    // บัญชี PIN อย่างเดียว (password=null) — ตั้งรหัสครั้งแรก ไม่ต้องถามรหัสเดิม (16 ต.ค.69)
    user.password = await hashPassword(newPassword);
    user.pwdVersion = (user.pwdVersion || 1) + 1; // กุญแจเก่าต่ออายุไม่ได้
    user.updatedAt = new Date().toISOString();
    await env.BFR_KV.put(USERS_KV_KEY, JSON.stringify(users));
    return json({ success: true, message: 'ตั้งรหัสผ่านสำเร็จ ✅ กรุณาเข้าสู่ระบบใหม่', relogin: true });
  }

  if (!currentPassword) {
    return json({ success: false, error: 'กรุณากรอกรหัสผ่านเดิม' }, 400);
  }

  // Verify current password
  const valid = await verifyPassword(currentPassword, user.password);
  if (!valid) return json({ success: false, error: 'รหัสผ่านเดิมไม่ถูกต้อง' }, 401);
  if (newPassword === currentPassword) {
    return json({ success: false, error: 'รหัสผ่านใหม่ต้องต่างจากรหัสเดิม' }, 400);
  }

  // Hash and update
  user.password = await hashPassword(newPassword);
  user.pwdVersion = (user.pwdVersion || 1) + 1; // กุญแจเก่าต่ออายุไม่ได้
  user.updatedAt = new Date().toISOString();
  await env.BFR_KV.put(USERS_KV_KEY, JSON.stringify(users));

  return json({ success: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ ✅ กรุณาเข้าสู่ระบบใหม่', relogin: true });
}
