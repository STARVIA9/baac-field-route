/**
 * GET /api/debt-data  (AUTH REQUIRED)
 * คืนข้อมูลหนี้ Customer Indicator ฉบับล่าสุด:
 * - ตรวจ JWT ทุกครั้ง (ลูกค้าที่ login แล้วเท่านั้น)
 * - ถ้ามี KV 'debt:data' (อัปเดตล่าสุดผ่าน /api/debt-import) → คืนของใหม่
 * - ไม่มี fallback static (ปิดช่องรั่วจาก public file)
 */

import { extractBearerToken, verifyHS256 } from '../_lib/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  // AUTH: any logged-in user (user or admin) can read debt data for their work
  const token = extractBearerToken(request);
  if (!token) return json({ success: false, error: 'No token' }, 401);
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return json({ success: false, error: 'Invalid token' }, 401);

  // Read from KV (single source written by /api/debt-import)
  if (env.BFR_KV) {
    try {
      const raw = await env.BFR_KV.get('debt:data');
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          return new Response(JSON.stringify(parsed), {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-cache',
              'X-Debt-Source': 'kv',
            },
          });
        } catch (e) {
          console.warn('debt:data KV corrupt:', e.message);
          return json({ success: false, error: 'debt data corrupt' }, 500);
        }
      }
    } catch (e) {
      console.warn('debt:data KV read failed:', e.message);
    }
  }

  // No KV data — tell client to import first (no public-file fallback)
  return json({ success: false, error: 'ยังไม่มีข้อมูลหนี้ — อัปโหลดไฟล์ Customer Indicator ก่อน' }, 404);
}
