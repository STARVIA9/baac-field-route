// Quota dashboard — GET /api/admin/quota (admin only)
// โควต้าเขียน D1 วันนี้ (กันล็อก 100,000 แถว/วัน) — อ่านอย่างเดียว ไม่นับโควต้า

import { extractBearerToken, verifyHS256, jwtSecret } from '../../_lib/jwt.js';
import { getWriteBudget } from '../../_lib/shared.js';

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
  const __secret = jwtSecret(env, request);
  if (!__secret) return json({ success: false, error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ (BFR_JWT_SECRET)' }, 500);
  const payload = await verifyHS256(token, __secret);
  if (!payload) return json({ success: false, error: 'Invalid token' }, 401);
  if (payload.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);

  const quota = await getWriteBudget(env);
  return json({ success: true, quota });
}
