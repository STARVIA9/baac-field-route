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

  // I12: Optimistic locking — if client sends `ifUpdatedAt`, check it matches
  // the current row. Prevents two devices from silently overwriting each other.
  if (body.ifUpdatedAt && existing.updated_at && body.ifUpdatedAt !== existing.updated_at) {
    return json({
      success: false,
      error: 'ข้อมูลถูกแก้ไขโดยเครื่องอื่นแล้ว — กรุณาเปิดใหม่แล้วลองอีกครั้ง',
      conflict: true,
      serverUpdated: existing.updated_at,
    }, 409);
  }

  const sets = [];
  const bindParams = [];
  let paramIdx = 1;

  const fieldMap = {
    name: 'name', nickname: 'nickname', phone: 'phone', address: 'address',
    riskLevel: 'risk_level', debtType: 'debt_type',
    zone: 'zone', customerClass: 'customer_class', potential: 'potential', photo: 'photo',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (body[key] !== undefined) {
      sets.push(`${col}=?${paramIdx}`);
      bindParams.push(body[key] || '');
      paramIdx++;
    }
  }

  if (body.lat !== undefined && body.lng !== undefined) {
    const lat = body.lat != null && Number.isFinite(Number(body.lat)) ? Number(body.lat) : null;
    const lng = body.lng != null && Number.isFinite(Number(body.lng)) ? Number(body.lng) : null;
    sets.push(`lat=?${paramIdx}`);
    bindParams.push(lat);
    paramIdx++;
    sets.push(`lng=?${paramIdx}`);
    bindParams.push(lng);
    paramIdx++;
  }

  if (sets.length === 0) return json({ success: false, error: 'No fields to update' }, 400);
  const now = new Date().toISOString();
  sets.push(`updated_at=?${paramIdx}`);
  bindParams.push(now);
  paramIdx++;

  bindParams.push(cif);
  await env.BFR_DB.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE cif=?${paramIdx}`).bind(...bindParams).run();
  if (env.BFR_KV) await env.BFR_KV.put('meta:overlay-updated', now);

  const fresh = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
  // W13 FIX: Don't read-modify-write KV overlay here — GET /api/gps-overlay
  // already reads from D1 directly. Just bump the timestamp so clients know
  // to refetch. This eliminates the KV race condition entirely.
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
      // W13 FIX: Don't read-modify-write KV overlay — GET /api/gps-overlay
      // reads from D1 directly. Just bump the timestamp.
    }
  } catch (e) {
    console.error('overlay bump failed:', e.message);
  }
  return json({ success: true, deleted: true, cif });
}
