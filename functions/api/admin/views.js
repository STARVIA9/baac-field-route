// Admin view log — GET /api/admin/views (สมุดคุมเปิดดูการ์ด แผน B ขั้น 4)
// Admin only. Query: ?viewer=<username>&limit=<n, default 200, max 500>

import { extractBearerToken, verifyHS256, jwtSecret } from '../../_lib/jwt.js';
import { canManageUsers, scopedBranch } from '../../_lib/authz.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function authCheck(request, env) {
  const token = extractBearerToken(request);
  if (!token) return { error: 'No token' };
  const __secret = jwtSecret(env, request);
  if (!__secret) return { error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ (BFR_JWT_SECRET)' };
  const payload = await verifyHS256(token, __secret);
  if (!payload) return { error: 'Invalid token' };
  return { user: payload };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (!canManageUsers(auth.user)) return json({ success: false, error: 'ต้องเป็นแอดมินหรือผู้ดูแลสาขา' }, 403);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const url = new URL(request.url);
  const viewer = (url.searchParams.get('viewer') || '').trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1), 500);

  // ผู้ดูแลสาขา: เห็นเฉพาะประวัติของคนในสาขาตัวเอง → สร้างรายชื่อ viewer ของสาขาก่อน
  const scope = scopedBranch(auth.user);
  if (scope) {
    let users = [];
    try {
      const raw = await env.BFR_KV?.get('users:all');
      users = raw ? JSON.parse(raw) : [];
    } catch { users = []; }
    const names = users
      .filter(u => !u.deleted && u.branch === scope && (!viewer || u.username === viewer))
      .map(u => u.username);
    if (!names.length) return json({ success: true, views: [] });
    const placeholders = names.map((_, i) => '?' + (i + 2)).join(',');
    const { results } = await env.BFR_DB.prepare(
      `SELECT * FROM customer_views WHERE viewer IN (${placeholders}) ORDER BY id DESC LIMIT ?1`
    ).bind(limit, ...names).all();
    return json({ success: true, views: results || [] });
  }

  let stmt;
  if (viewer) {
    stmt = env.BFR_DB.prepare(
      'SELECT * FROM customer_views WHERE viewer=?1 ORDER BY id DESC LIMIT ?2'
    ).bind(viewer, limit);
  } else {
    stmt = env.BFR_DB.prepare(
      'SELECT * FROM customer_views ORDER BY id DESC LIMIT ?1'
    ).bind(limit);
  }
  const { results } = await stmt.all();
  return json({ success: true, views: results || [] });
}
