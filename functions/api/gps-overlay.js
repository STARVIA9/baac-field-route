// GPS Overlay — GET /api/gps-overlay (any logged-in user)
// Returns KV 'gps:overlay' — compact map CIF -> {lat,lng,name,updatedAt}.
// The main app fetches this at import time to apply bulk GPS to the static DB.

import { extractBearerToken, verifyHS256 } from '../_lib/jwt.js';

const KV_OVERLAY = 'gps:overlay';

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
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return json({ success: false, error: 'Invalid token' }, 401);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const raw = await env.BFR_KV.get(KV_OVERLAY);
  const overlay = raw ? JSON.parse(raw) : {};
  return json({ success: true, overlay, count: Object.keys(overlay).length });
}
