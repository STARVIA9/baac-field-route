// Admin view log — GET /api/admin/views (สมุดคุมเปิดดูการ์ด แผน B ขั้น 4)
// Admin only. Query: ?viewer=<username>&limit=<n, default 200, max 500>

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function authCheck(request, env) {
  const token = extractBearerToken(request);
  if (!token) return { error: 'No token' };
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return { error: 'Invalid token' };
  return { user: payload };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const url = new URL(request.url);
  const viewer = (url.searchParams.get('viewer') || '').trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1), 500);

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
