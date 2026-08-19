// GPS Overlay — GET /api/gps-overlay (any logged-in user)
// Now D1-backed: returns a compact map CIF -> {lat,lng,name,updatedAt} of all
// active customers that HAVE GPS coords, straight from the single D1 database.
// Kept for backward-compat with the app's applyGpsOverlay() merge (which is now
// a no-op merge since D1 already has the coords — but the endpoint stays valid).

import { extractBearerToken, verifyHS256 } from '../_lib/jwt.js';

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

  if (env.BFR_DB) {
    // D1 source of truth: all active customers with coords
    const { results } = await env.BFR_DB.prepare(
      `SELECT cif, name, lat, lng, updated_at FROM customers WHERE deleted=0 AND lat IS NOT NULL AND lng IS NOT NULL`
    ).all();
    const overlay = {};
    for (const r of results || []) {
      overlay[String(r.cif)] = {
        lat: Number(r.lat),
        lng: Number(r.lng),
        name: r.name || '',
        updatedAt: r.updated_at || '',
      };
    }
    const overlayUpdatedAt = env.BFR_KV ? await env.BFR_KV.get('meta:overlay-updated') : null;
    return json({ success: true, overlay, count: Object.keys(overlay).length, overlayUpdatedAt: overlayUpdatedAt || null });
  }

  // Fallback: KV (legacy, if D1 not bound yet)
  const raw = await env.BFR_KV.get('gps:overlay');
  const overlay = raw ? JSON.parse(raw) : {};
  const overlayUpdatedAt = await env.BFR_KV.get('meta:overlay-updated');
  return json({ success: true, overlay, count: Object.keys(overlay).length, overlayUpdatedAt: overlayUpdatedAt || null });
}
