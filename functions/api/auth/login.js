// Auth handler — POST /api/auth/login (legacy fallback)
// Rate-limited: max 10 attempts per IP per 15 minutes (KV-based)
// ⚠️ PIN ทีมถูกลบแล้ว — ใช้เฉพาะ username/password ที่สร้างจาก /api/admin/users

import { signHS256 } from '../../_lib/jwt.js';

const MAX_ATTEMPTS = 10;
const WINDOW_SEC = 15 * 60;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { username, password, pin } = body;

  // Rate limiting via KV (per IP)
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const rateKey = `ratelimit:authlogin:${ip}`;
  if (env.BFR_KV) {
    try {
      const raw = await env.BFR_KV.get(rateKey);
      const attempts = raw ? parseInt(raw, 10) : 0;
      if (attempts >= MAX_ATTEMPTS) {
        return json({ success: false, error: `พยายามเกิน ${MAX_ATTEMPTS} ครั้ง กรุณารอ 15 นาที` }, 429);
      }
      await env.BFR_KV.put(rateKey, String(attempts + 1), { expirationTtl: WINDOW_SEC });
    } catch (e) { /* fail open */ }
  }

  // ===== Username/password =====
  if (username && password) {
    if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);
    const raw = await env.BFR_KV.get('users:all');
    const users = raw ? JSON.parse(raw) : [];
    const user = users.find(u => u.username === username && !u.deleted);
    if (!user) return json({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401);

    const { verifyPassword } = await import('../../_lib/crypto.js');
    let valid = false;
    try { valid = await verifyPassword(password, user.password); } catch (e) {
      return json({ success: false, error: 'ระบบยืนยันรหัสผ่านขัดข้อง' }, 401);
    }
    if (!valid) return json({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401);

    const secret = env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min';
    const branchName = user.branch || '';
    const token = await signHS256({
      sub: user.id, username: user.username, name: user.displayName,
      role: user.role, branch: user.branch, branchName,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 7,
    }, secret);

    if (env.BFR_KV) await env.BFR_KV.delete(rateKey);
    return json({
      success: true, token,
      user: { id: user.id, username: user.username, name: user.displayName, role: user.role, branch: user.branch, branchName },
    });
  }

  // ===== PIN (ยกเลิกแล้ว) =====
  if (pin) {
    return json({ success: false, error: 'PIN ทีมถูกยกเลิก — กรุณาใช้ username/password' }, 401);
  }

  return json({ success: false, error: 'กรุณากรอก username+password' }, 400);
}