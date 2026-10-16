// GPS history + restore — /api/admin/gps-history (admin only)
// GET ?cif=<cif>&limit=<n>: ดูประวัติพิกัดรายคน (ใหม่สุดก่อน)
// POST {cif, historyId}: กู้พิกัดกลับเป็นค่า new_lat/new_lng ของประวัตินั้น
//   (กู้ = เขียนทับ lat/lng ปัจจุบัน + บันทึกประวัติ source='restore' ต่อท้าย)

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';
import { logGpsHistory } from '../../_lib/shared.js';

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
  const cif = (url.searchParams.get('cif') || '').trim();
  if (!cif) return json({ success: false, error: 'ต้องระบุ cif' }, 400);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);

  try {
    const { results } = await env.BFR_DB.prepare(
      'SELECT * FROM gps_history WHERE cif=?1 ORDER BY id DESC LIMIT ?2'
    ).bind(cif, limit).all();
    return json({ success: true, history: results || [] });
  } catch (e) {
    // ตารางยังไม่มี (migration ยังไม่รัน) → ประวัติว่าง ไม่พัง
    return json({ success: true, history: [], note: 'no-history-table' });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
  const cif = String(body.cif || '').trim();
  const historyId = parseInt(body.historyId, 10);
  if (!cif || !historyId) return json({ success: false, error: 'ต้องระบุ cif + historyId' }, 400);

  const h = await env.BFR_DB.prepare(
    'SELECT * FROM gps_history WHERE id=?1 AND cif=?2'
  ).bind(historyId, cif).first();
  if (!h) return json({ success: false, error: 'ไม่พบประวัติรายการนี้' }, 404);
  if (h.new_lat == null || h.new_lng == null) {
    return json({ success: false, error: 'ประวัตินี้ไม่มีพิกัดให้กู้ (ถูกลบ)' }, 400);
  }

  const cur = await env.BFR_DB.prepare('SELECT lat, lng FROM customers WHERE cif=?1').bind(cif).first();
  if (!cur) return json({ success: false, error: 'ไม่พบลูกค้า' }, 404);

  const now = new Date().toISOString();
  await env.BFR_DB.prepare(
    'UPDATE customers SET lat=?1, lng=?2, updated_at=?3 WHERE cif=?4'
  ).bind(h.new_lat, h.new_lng, now, cif).run();

  const by = auth.user.username || auth.user.sub || 'admin';
  await logGpsHistory(env, {
    cif, oldLat: cur.lat, oldLng: cur.lng,
    newLat: h.new_lat, newLng: h.new_lng, by, source: 'restore#' + historyId,
  });

  if (env.BFR_KV) {
    await env.BFR_KV.put('meta:overlay-updated', now);
    await env.BFR_KV.put('meta:lastwrite', now);
  }
  return json({ success: true, cif, lat: h.new_lat, lng: h.new_lng });
}
