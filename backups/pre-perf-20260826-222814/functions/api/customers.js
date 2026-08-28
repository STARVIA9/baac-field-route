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
    // ข้อมูลหนี้จาก Customer Indicator
    debtClass: r.debt_class || '',
    debtBalance: r.debt_balance != null ? r.debt_balance : null,
    reservePct: r.reserve_pct != null ? r.reserve_pct : null,
    recognition: r.recognition || '',
    overdue15m: r.overdue_15m || '',
    nextDue: r.next_due || '',
    subsidy: r.subsidy || '',
    commitmentDate: r.commitment_date || '',
    debtUpdatedAt: r.debt_updated_at || '',
  };
}

// SQL escape helper — DEPRECATED: use .bind() prepared statements instead.
// Kept only for backward compat with dynamic column names in SET clauses.
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// Helper: run a D1 query and return rows
async function q(env, sql, ...params) {
  const stmt = params.length > 0 ? env.BFR_DB.prepare(sql).bind(...params) : env.BFR_DB.prepare(sql);
  const { results } = await stmt.all();
  return results;
}

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
    const rows = await q(env, 'SELECT * FROM customers WHERE cif=?1 LIMIT 1', cif);
    if (rows.length === 0) return json({ success: false, error: 'Customer not found' }, 404);
    return json({ success: true, customer: rowToCustomer(rows[0]) });
  }

  // List customers
  const includeDeleted = url.searchParams.get('deleted') === '1';
  const where = includeDeleted ? '' : 'WHERE deleted=0';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '5000', 10) || 5000, 10000);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
  const rows = await q(env, `SELECT * FROM customers ${where} ORDER BY name ASC LIMIT ?1 OFFSET ?2`, limit, offset);
  const customers = rows.map(rowToCustomer);

  const countRes = await q(env, `SELECT COUNT(*) n FROM customers ${where ? 'WHERE deleted=0' : ''}`);
  const total = countRes[0]?.n || 0;

  return json({
    success: true,
    customers,
    total,
    count: customers.length,
    offset,
    hasMore: offset + customers.length < total,
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
  const existing = await q(env, 'SELECT cif FROM customers WHERE cif=?1', cif);
  if (existing.length > 0) return json({ success: false, error: `CIF ${cif} already exists` }, 409);

  const lat = body.lat != null && Number.isFinite(Number(body.lat)) ? Number(body.lat) : null;
  const lng = body.lng != null && Number.isFinite(Number(body.lng)) ? Number(body.lng) : null;
  const now = new Date().toISOString();

  const createdBy = auth.user.username || auth.user.sub || 'unknown';

  try {
    await env.BFR_DB.prepare(
      `INSERT INTO customers (cif, name, nickname, phone, address, risk_level, debt_type, zone, customer_class, potential, photo, created_by, deleted, created_at, updated_at, lat, lng)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?13, ?14, ?15)`
    ).bind(
      cif, body.name || '', body.nickname || '', body.phone || '', body.address || '',
      body.riskLevel || 'unclassified', body.debtType || null,
      body.zone || '', body.customerClass || '', body.potential || '', body.photo || '',
      createdBy, now, lat, lng
    ).run();
  } catch (e) {
    return json({ success: false, error: 'Insert failed: ' + e.message }, 500);
  }

  // Update GPS overlay version marker (client polls this)
  if (env.BFR_KV) await env.BFR_KV.put('meta:overlay-updated', now);

  return json({ success: true, customer: { id: 'db_' + cif, cif, name: body.name || '', lat, lng } }, 201);
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

  const existing = await q(env, 'SELECT * FROM customers WHERE cif=?1', cif);
  if (existing.length === 0) return json({ success: false, error: 'Customer not found' }, 404);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  // Build SET clause using prepared statement parameters
  const updates = [];
  const params = [];
  let paramIdx = 1;

  const fieldMap = {
    name: 'name', nickname: 'nickname', phone: 'phone', address: 'address',
    risk_level: 'risk_level', riskLevel: 'risk_level',
    debt_type: 'debt_type', debtType: 'debt_type',
    zone: 'zone', customer_class: 'customer_class', customerClass: 'customer_class',
    potential: 'potential', photo: 'photo', geo_source: 'geo_source',
    created_by: 'created_by',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (body[key] !== undefined) {
      updates.push(`${col}=?${paramIdx}`);
      params.push(body[key] || '');
      paramIdx++;
    }
  }

  // lat/lng update (GPS) — server-authoritative
  if (body.lat !== undefined && body.lng !== undefined) {
    const lat = body.lat != null && Number.isFinite(Number(body.lat)) ? Number(body.lat) : null;
    const lng = body.lng != null && Number.isFinite(Number(body.lng)) ? Number(body.lng) : null;
    updates.push(`lat=?${paramIdx}`);
    params.push(lat);
    paramIdx++;
    updates.push(`lng=?${paramIdx}`);
    params.push(lng);
    paramIdx++;
  }

  const now = new Date().toISOString();
  updates.push(`updated_at=?${paramIdx}`);
  params.push(now);
  paramIdx++;

  if (updates.length === 0) return json({ success: false, error: 'No fields to update' }, 400);

  // Add CIF as the last parameter for WHERE clause
  params.push(cif);
  const sql = `UPDATE customers SET ${updates.join(', ')} WHERE cif=?${paramIdx}`;
  try {
    await env.BFR_DB.prepare(sql).bind(...params).run();
  } catch (e) {
    return json({ success: false, error: 'Update failed: ' + e.message }, 500);
  }

  // Notify clients via overlay version marker
  if (env.BFR_KV) await env.BFR_KV.put('meta:overlay-updated', now);

  const fresh = await q(env, 'SELECT * FROM customers WHERE cif=?1', cif);
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

  const existing = await q(env, 'SELECT * FROM customers WHERE cif=?1', cif);
  if (existing.length === 0) return json({ success: false, error: 'Customer not found' }, 404);

  // restore if :cif/restore path
  const isRestore = segs[3] === 'restore';
  const now = new Date().toISOString();
  const updater = auth.user.username || auth.user.sub || 'unknown';

  if (isRestore) {
    await env.BFR_DB.prepare('UPDATE customers SET deleted=0, updated_at=?1 WHERE cif=?2').bind(now, cif).run();
  } else {
    await env.BFR_DB.prepare('UPDATE customers SET deleted=1, updated_at=?1 WHERE cif=?2').bind(now, cif).run();
  }

  if (env.BFR_KV) await env.BFR_KV.put('meta:overlay-updated', now);
  return json({ success: true, message: isRestore ? 'Customer restored' : 'Customer moved to recycle bin', cif });
}

export async function onRequestOptions() {
  return json({ success: true });
}
