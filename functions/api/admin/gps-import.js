// GPS Import — POST /api/admin/gps-import (admin only)
// Body: { records: [{ cif, name, lat, lng }] }
// Merges coords into KV 'gps:overlay' — a compact map CIF -> {lat,lng,name,updatedAt}.
// Stored separately from customers:all so bulk GPS uploads never touch the
// static customers-db.json and never trigger the Worker 503 (coords are tiny).

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';

const KV_OVERLAY = 'gps:overlay';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const token = extractBearerToken(request);
  if (!token) return json({ success: false, error: 'No token' }, 401);
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return json({ success: false, error: 'Invalid token' }, 401);
  if (payload.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const records = body.records;
  if (!Array.isArray(records) || records.length === 0) {
    return json({ success: false, error: 'ต้องส่ง records array' }, 400);
  }

  const raw = await env.BFR_KV.get(KV_OVERLAY);
  const overlay = raw ? JSON.parse(raw) : {};
  const now = new Date().toISOString();
  let added = 0, updated = 0, skipped = 0;

  for (const r of records) {
    const cif = String(r.cif || '').trim();
    const lat = typeof r.lat === 'number' ? r.lat : parseFloat(r.lat);
    const lng = typeof r.lng === 'number' ? r.lng : parseFloat(r.lng);
    if (!cif || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      skipped++;
      continue;
    }
    if (overlay[cif]) updated++; else added++;
    overlay[cif] = { lat, lng, name: String(r.name || '').trim(), updatedAt: now };
  }

  await env.BFR_KV.put(KV_OVERLAY, JSON.stringify(overlay));
  // Bump overlay version so every device's 15s poll picks up the change
  await env.BFR_KV.put('meta:overlay-updated', now);
  return json({ success: true, added, updated, skipped, total: Object.keys(overlay).length, overlayUpdatedAt: now });
}

// DELETE /api/admin/gps-import?cif=4642836,4642883 — remove specific CIFs
// DELETE /api/admin/gps-import — clear the whole overlay (admin only)
export async function onRequestDelete(context) {
  const { request, env } = context;

  const token = extractBearerToken(request);
  if (!token) return json({ success: false, error: 'No token' }, 401);
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return json({ success: false, error: 'Invalid token' }, 401);
  if (payload.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const url = new URL(request.url);
  const cifParam = url.searchParams.get('cif');

  const raw = await env.BFR_KV.get(KV_OVERLAY);
  let overlay = raw ? JSON.parse(raw) : {};
  let removed = 0;

  if (cifParam) {
    const cifs = cifParam.split(',').map(s => s.trim()).filter(Boolean);
    for (const c of cifs) {
      if (overlay[c]) { delete overlay[c]; removed++; }
    }
  } else {
    removed = Object.keys(overlay).length;
    overlay = {};
  }

  await env.BFR_KV.put(KV_OVERLAY, JSON.stringify(overlay));
  // Bump overlay version so every device's 15s poll picks up the removal
  await env.BFR_KV.put('meta:overlay-updated', new Date().toISOString());
  return json({ success: true, removed, total: Object.keys(overlay).length });
}
