// /api/customers/:cif — single customer operations (GET, PUT, DELETE)
// D1-backed (single source of truth).

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

function rowToCustomer(r) {
  return {
    id: 'db_' + r.cif,
    cif: r.cif,
    name: r.name,
    nickname: r.nickname || '',
    phone: r.phone || '',
    address: r.address || '',
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
    riskLevel: r.risk_level || 'unclassified',
    debtType: r.debt_type || null,
    zone: r.zone || '',
    customerClass: r.customer_class || '',
    potential: r.potential || '',
    photo: r.photo || '',
    createdBy: r.created_by || '',
    deleted: !!r.deleted,
    createdAt: r.created_at || '',
    updatedAt: r.updated_at || '',
    geo_source: r.geo_source || '',
    extra: {
      amphoe: r.amphoe || '', tambon: r.tambon || '', province: r.province || '',
      postcode: r.postcode || '', moo: r.moo || '', idCard: r.id_card || '', dob: r.dob || '',
    },
  };
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const cif = decodeURIComponent(params.cif || '');
  const row = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
  if (!row) return json({ success: false, error: 'Customer not found' }, 404);
  return json({ success: true, customer: rowToCustomer(row) });
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const cif = decodeURIComponent(params.cif || '');
  const existing = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
  if (!existing) return json({ success: false, error: 'Customer not found' }, 404);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const sets = [];
  const updater = auth.user.username || auth.user.sub || "unknown";
  if (body.name !== undefined) sets.push(`name=${esc(body.name)}`);
  if (body.nickname !== undefined) sets.push(`nickname=${esc(body.nickname)}`);
  if (body.phone !== undefined) sets.push(`phone=${esc(body.phone)}`);
  if (body.address !== undefined) sets.push(`address=${esc(body.address)}`);
  if (body.riskLevel !== undefined) sets.push(`risk_level=${esc(body.riskLevel)}`);
  if (body.debtType !== undefined) sets.push(`debt_type=${esc(body.debtType)}`);
  if (body.lat !== undefined && body.lng !== undefined) {
    const lat = body.lat != null && Number.isFinite(Number(body.lat)) ? Number(body.lat) : null;
    const lng = body.lng != null && Number.isFinite(Number(body.lng)) ? Number(body.lng) : null;
    sets.push(`lat=${lat === null ? 'NULL' : lat}`);
    sets.push(`lng=${lng === null ? 'NULL' : lng}`);
  }

  if (sets.length === 0) return json({ success: false, error: 'No fields to update' }, 400);
  const now = new Date().toISOString();
  sets.push(`updated_at=${esc(now)}`);

  await env.BFR_DB.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE cif=${esc(cif)}`).run();
  if (env.BFR_KV) await env.BFR_KV.put('meta:overlay-updated', now);

  const fresh = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
  if (env.BFR_KV && fresh && fresh.lat != null && fresh.lng != null) {
    try {
      const raw = await env.BFR_KV.get('gps:overlay');
      const overlay = raw ? JSON.parse(raw) : {};
      overlay[cif] = { lat: Number(fresh.lat), lng: Number(fresh.lng), name: fresh.name || '', updatedAt: now };
      await env.BFR_KV.put('gps:overlay', JSON.stringify(overlay));
    } catch (e) { console.warn('overlay sync failed:', e.message); }
  }
  return json({ success: true, customer: rowToCustomer(fresh) });
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const cif = decodeURIComponent(params.cif || '');
  const existing = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
  if (!existing) return json({ success: false, error: 'Customer not found' }, 404);

  const now = new Date().toISOString();
  try {
    await env.BFR_DB.prepare(
      'UPDATE customers SET deleted=1, deleted_at=?1, deleted_by=?2, updated_at=?1 WHERE cif=?3'
    ).bind(now, auth.user.username || auth.user.sub || "unknown", cif).run();
  } catch (e) {
    return json({ success: false, error: 'Delete failed: ' + e.message }, 500);
  }
  try {
    if (env.BFR_KV) {
      await env.BFR_KV.put('meta:overlay-updated', now);
      const raw = await env.BFR_KV.get('gps:overlay');
      const overlay = raw ? JSON.parse(raw) : {};
      delete overlay[cif];
      await env.BFR_KV.put('gps:overlay', JSON.stringify(overlay));
    }
  } catch (e) {
    console.error('single delete overlay sync failed:', e.message);
  }
  return json({ success: true, deleted: true, cif });
}
