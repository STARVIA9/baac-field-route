// Shared helpers for BAAC Field Route API endpoints
// Import: import { esc, rowToCustomer, authCheck, json } from '../_lib/shared.js';

// JSON response helper
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// Auth check — extract + verify JWT
export async function authCheck(request, env) {
  const { extractBearerToken, verifyHS256 } = await import('./jwt.js');
  const token = extractBearerToken(request);
  if (!token) return { error: 'No token' };
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return { error: 'Invalid token' };
  return { user: payload };
}

// SQL escape helper — DEPRECATED: use .bind() prepared statements instead.
// Kept only for backward compat with dynamic column names in SET clauses.
export function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// Map D1 row → frontend customer shape (null-safe lat/lng)
export function rowToCustomer(r) {
  return {
    id: r.id || 'db_' + r.cif,
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
