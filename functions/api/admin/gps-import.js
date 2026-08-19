// GPS Import — POST /api/admin/gps-import (admin only)
// Body: { records: [{ cif, name, lat, lng }] }
// Updates lat/lng in D1 (single source of truth) + mirrors to KV gps:overlay
// for the live marker-refresh trigger. D1 is authoritative.

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
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const records = body.records;
  if (!Array.isArray(records) || records.length === 0) {
    return json({ success: false, error: 'ต้องส่ง records array' }, 400);
  }

  // Read current KV overlay (for the trigger + fallback mirror)
  const raw = env.BFR_KV ? await env.BFR_KV.get(KV_OVERLAY) : null;
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

    // Check existence in D1
    const exists = await env.BFR_DB.prepare('SELECT cif FROM customers WHERE cif = ?1').bind(cif).first();
    if (exists) {
      // Update coordinates in D1
      await env.BFR_DB.prepare(
        'UPDATE customers SET lat = ?1, lng = ?2, updated_at = ?3 WHERE cif = ?4'
      ).bind(lat, lng, now, cif).run();
      updated++;
    } else {
      // Create new customer with coords
      await env.BFR_DB.prepare(
        `INSERT INTO customers (cif, name, lat, lng, risk_level, deleted, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'unclassified', 0, 'GPS-Import', ?5, ?5)`
      ).bind(cif, String(r.name || '').trim(), lat, lng, now).run();
      added++;
    }

    // Mirror to KV overlay (trigger for live polling)
    overlay[cif] = { lat, lng, name: String(r.name || '').trim(), updatedAt: now };
  }

  if (env.BFR_KV) {
    await env.BFR_KV.put(KV_OVERLAY, JSON.stringify(overlay));
    await env.BFR_KV.put('meta:overlay-updated', now);
  }
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
