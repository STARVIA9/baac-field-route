// Customer sync — POST /api/customers/sync
// Body: { customers: [...] }
// Now D1-backed (single source of truth). Returns all known customers from D1.
// Kept for backward-compat with legacy clients; new clients use /api/customers.

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
    createdBy: r.created_by || 'AutoImport:StaticDB',
    deleted: !!r.deleted,
    createdAt: r.created_at || '',
    updatedAt: r.updated_at || '',
    geo_source: r.geo_source || 'static_db',
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
  const { customers = [] } = body;

  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  // Upsert incoming customers into D1
  const now = new Date().toISOString();
  for (const c of customers) {
    const cif = String(c.cif || '').trim();
    if (!cif) continue;
    const deleted = c.deleted ? 1 : 0;
    try {
      const exists = await env.BFR_DB.prepare('SELECT cif FROM customers WHERE cif = ?1').bind(cif).first();
      if (exists) {
        await env.BFR_DB.prepare(
          `UPDATE customers SET
             name = COALESCE(?1, name),
             phone = COALESCE(?2, phone),
             address = COALESCE(?3, address),
             risk_level = COALESCE(?4, risk_level),
             lat = COALESCE(?5, lat),
             lng = COALESCE(?6, lng),
             deleted = ?7,
             updated_at = ?8
           WHERE cif = ?9`
        ).bind(c.name ?? null, c.phone ?? null, c.address ?? null,
          c.riskLevel ?? null,
          (c.lat != null && Number.isFinite(Number(c.lat))) ? Number(c.lat) : null,
          (c.lng != null && Number.isFinite(Number(c.lng))) ? Number(c.lng) : null,
          deleted, now, cif).run();
      } else {
        await env.BFR_DB.prepare(
          `INSERT INTO customers (cif, name, phone, address, risk_level, lat, lng, deleted, created_by, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`
        ).bind(cif, c.name || '', c.phone || '', c.address || '',
          c.riskLevel || 'unclassified',
          (c.lat != null && Number.isFinite(Number(c.lat))) ? Number(c.lat) : null,
          (c.lng != null && Number.isFinite(Number(c.lng))) ? Number(c.lng) : null,
          deleted, c.createdBy || 'user', now).run();
      }
    } catch (e) { console.warn('customers/sync failed', cif, e.message); }
  }

  const { results } = await env.BFR_DB.prepare('SELECT * FROM customers WHERE deleted=0').all();
  const all = (results || []).map(rowToCustomer);
  return json({ success: true, count: all.length, customers: all });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);

  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);
  const { results } = await env.BFR_DB.prepare('SELECT * FROM customers WHERE deleted=0').all();
  const customers = (results || []).map(rowToCustomer);
  return json({ success: true, count: customers.length, customers });
}
