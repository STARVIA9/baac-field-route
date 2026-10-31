// ประวัติเข้าใช้ — GET /api/admin/logins (admin เท่านั้น)
// อ่านจาก KV loginlog:all ที่ login.js เขียนไว้ตอนล็อกอินสำเร็จ (เก็บ 100 รายการล่าสุด)

import { extractBearerToken, verifyHS256, jwtSecret } from '../../_lib/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const token = extractBearerToken(request);
  if (!token) return json({ success: false, error: 'No token' }, 401);
  const secret = jwtSecret(env, request);
  if (!secret) return json({ success: false, error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ' }, 500);
  const payload = await verifyHS256(token, secret);
  if (!payload) return json({ success: false, error: 'Invalid token' }, 401);
  if (payload.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 100);
  let list = [];
  try {
    const raw = await env.BFR_KV.get('loginlog:all');
    list = raw ? JSON.parse(raw) : [];
  } catch { list = []; }
  return json({ success: true, logins: list.slice(-limit).reverse() });
}
