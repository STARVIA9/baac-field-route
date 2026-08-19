// Unified Customer API — /api/customers
// Single source of truth backed by D1 (SQLite). Replaces the fragmented
// static customers-db.json + KV customers:all + gps:overlay stores.
//
// GET  /api/customers            → list ALL active customers (deleted=0) from D1
// GET  /api/customers?deleted=1  → list deleted (recycle bin)
// GET  /api/customers/:cif       → single customer by CIF
// PUT  /api/customers/:cif       → update customer (lat/lng/name/phone/...)
// POST /api/customers            → create new customer
// DELETE /api/customers/:cif     → soft-delete (mark deleted=1)
// POST /api/customers/:cif/restore → restore from recycle
//
// All auth via Bearer token (same JWT as other endpoints).

import { extractBearerToken, verifyHS256 } from '../_lib/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function authCheck(request, env) {
  const token = extractBearerToken(request);
  if (!token) return { error: 'No token' };
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return { error: 'Invalid token' };
  return { user: payload };
}

// Map D1 row → frontend customer shape (null-safe lat/lng)
function rowToCustomer(r) {
  return {
    id: r.id || 'db_' + r.cif,
    cif: r.cif,
    name: r.name,
    nickname: r.nickname || '',
    phone: r.phone || '',
    address: r.address || '',
    lat: r.lat != null ? r.lat : null,
    lng: r.lng != null ? r.lng : null,
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
      amphoe: r.amphoe || '',
      tambon: r.tambon || '',
      province: r.province || '',
      postcode: r.postcode || '',
      moo: r.moo || '',
      idCard: r.id_card || '',
      dob: r.dob || '',
    },
  };
}

// SQL escape helper (D1 prepared statements are not available on query, so sanitize)
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// Helper: run a D1 query and return rows
async function q(env, sql) {
  const stmt = env.BFR_DB.prepare(sql);
  const { results } = await stmt.all();
  return results;
}

const SAFE_COLS = ['name','nickname','phone','address','amphoe','tambon','province',
  'postcode','moo','zone','customer_class','potential','risk_level','debt_type',
  'photo','id_card','dob','geo_source','created_by'];

// ==================== GET ====================
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const url = new URL(request.url);
  const path = url.pathname; // /api/customers or /api/customers/:cif
  const segs = path.split('/').filter(Boolean); // ['api','customers', maybeCif]

  // Single customer by CIF: /api/customers/4642836
  if (segs.length >= 3) {
    const cif = decodeURIComponent(segs[2]);
    const rows = await q(env, `SELECT * FROM customers WHERE cif=${esc(cif)} LIMIT 1`);
    if (rows.length === 0) return json({ success: false, error: 'Customer not found' }, 404);
    return json({ success: true, customer: rowToCustomer(rows[0]) });
  }

  // List customers
  const includeDeleted = url.searchParams.get('deleted') === '1';
  const where = includeDeleted ? '' : 'WHERE deleted=0';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '5000', 10) || 5000, 10000);
  const rows = await q(env, `SELECT * FROM customers ${where} ORDER BY name ASC LIMIT ${limit}`);
  const customers = rows.map(rowToCustomer);

  const counts = await q(env, 'SELECT COUNT(*) n FROM customers WHERE deleted=0');
  const total = counts[0]?.n || 0;

  return json({
    success: true,
    customers,
    total,
    count: customers.length,
    serverTime: new Date().toISOString(),
  });
}

// ==================== POST (create) ====================
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
  const cif = String(body.cif || '').trim();
  if (!cif) return json({ success: false, error: 'cif is required' }, 400);

  // Check duplicate CIF
  const existing = await q(env, `SELECT cif FROM customers WHERE cif=${esc(cif)}`);
  if (existing.length > 0) return json({ success: false, error: `CIF ${cif} already exists` }, 409);

  const lat = body.lat != null && Number.isFinite(Number(body.lat)) ? Number(body.lat) : null;
  const lng = body.lng != null && Number.isFinite(Number(body.lng)) ? Number(body.lng) : null;
  const now = new Date().toISOString();

  const fields = {
    cif, name: body.name || '' ,
    nickname: body.nickname || '', phone: body.phone || '', address: body.address || '',
    risk_level: body.riskLevel || 'unclassified', debt_type: body.debtType || null,
    zone: body.zone || '', customer_class: body.customerClass || '',
    potential: body.potential || '', photo: body.photo || '',
    created_by: auth.user.username || auth.user.sub || 'unknown',
    deleted: 0, created_at: now, updated_at: now,
    lat, lng,
  };

  const cols = Object.keys(fields);
  const vals = cols.map(c => esc(fields[c]));
  const sql = `INSERT INTO customers (${cols.join(',')}) VALUES (${vals.join(',')})`;
  try {
    await q(env, sql);
  } catch (e) {
    return json({ success: false, error: 'Insert failed: ' + e.message }, 500);
  }

  // Update GPS overlay version marker (client polls this)
  if (env.BFR_KV) await env.BFR_KV.put('meta:overlay-updated', now);

  return json({ success: true, customer: rowToCustomer({ ...fields, id: 'db_' + cif }) }, 201);
}

// ==================== PUT (update) ====================
export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const url = new URL(request.url);
  const segs = url.pathname.split('/').filter(Boolean);
  const cif = decodeURIComponent(segs[2]);

  const existing = await q(env, `SELECT * FROM customers WHERE cif=${esc(cif)}`);
  if (existing.length === 0) return json({ success: false, error: 'Customer not found' }, 404);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  // Build SET clause from allow-listed fields
  const sets = [];
  for (const c of SAFE_COLS) {
    const key = c; // column name matches
    if (body[key] !== undefined) sets.push(`${c}=${esc(body[key])}`);
  }
  // Frontend uses camelCase aliases
  if (body.name !== undefined) sets.push(`name=${esc(body.name)}`);
  if (body.phone !== undefined) sets.push(`phone=${esc(body.phone)}`);
  if (body.address !== undefined) sets.push(`address=${esc(body.address)}`);
  if (body.riskLevel !== undefined) sets.push(`risk_level=${esc(body.riskLevel)}`);
  if (body.debtType !== undefined) sets.push(`debt_type=${esc(body.debtType)}`);

  // lat/lng update (GPS) — server-authoritative
  if (body.lat !== undefined && body.lng !== undefined) {
    const lat = Number.isFinite(Number(body.lat)) ? Number(body.lat) : null;
    const lng = Number.isFinite(Number(body.lng)) ? Number(body.lng) : null;
    sets.push(`lat=${lat === null ? 'NULL' : lat}`);
    sets.push(`lng=${lng === null ? 'NULL' : lng}`);
  }

  const now = new Date().toISOString();
  sets.push(`updated_at=${esc(now)}`);

  if (sets.length === 0) return json({ success: false, error: 'No fields to update' }, 400);
  const sql = `UPDATE customers SET ${sets.join(', ')} WHERE cif=${esc(cif)}`;
  try {
    await q(env, sql);
  } catch (e) {
    return json({ success: false, error: 'Update failed: ' + e.message }, 500);
  }

  // Notify clients via overlay version marker
  if (env.BFR_KV) await env.BFR_KV.put('meta:overlay-updated', now);

  const fresh = await q(env, `SELECT * FROM customers WHERE cif=${esc(cif)}`);
  return json({ success: true, customer: rowToCustomer(fresh[0]) });
}

// ==================== DELETE (soft) / restore ====================
export async function onRequestDelete(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const url = new URL(request.url);
  const segs = url.pathname.split('/').filter(Boolean);
  const cif = decodeURIComponent(segs[2]);

  const existing = await q(env, `SELECT * FROM customers WHERE cif=${esc(cif)}`);
  if (existing.length === 0) return json({ success: false, error: 'Customer not found' }, 404);

  // restore if :cif/restore path
  const isRestore = segs[3] === 'restore';
  let sql, msg;
  if (isRestore) {
    sql = `UPDATE customers SET deleted=0, updated_at=${esc(new Date().toISOString())} WHERE cif=${esc(cif)}`;
    msg = 'Customer restored';
  } else {
    sql = `UPDATE customers SET deleted=1, updated_at=${esc(new Date().toISOString())} WHERE cif=${esc(cif)}`;
    msg = 'Customer moved to recycle bin';
  }
  await q(env, sql);
  if (env.BFR_KV) await env.BFR_KV.put('meta:overlay-updated', new Date().toISOString());
  return json({ success: true, message: msg, cif });
}

export async function onRequestOptions() {
  return json({ success: true });
}
