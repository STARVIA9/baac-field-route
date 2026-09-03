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

// ===== D1 ETAG GATE helpers (ลด rows_read — D1 free quota 5M rows/day) =====
// หลัก: ทุก write ลงตาราง customers ต้องเรียก touchCustomers(env) → เขียน KV
// meta:customers-updated = ตอนเขียน. GET /api/sync ใช้ตัวนี้เทียบกับ since ของ client:
//   since >= customers-updated → ไม่มีข้อมูลใหม่ → ใช้ cached counts (0 D1 query!)
// เขียนแค่ KV (ถูก, เร็ว) — ทำให้ poll ที่ไม่มีข้อมูลเปลี่ยน = 0 rows_read

const CUSTOMERS_UPDATED_KEY = 'meta:customers-updated';
const DB_MAX_UPDATED_KEY = 'meta:db-max-updated';
const COUNTS_KEY = 'meta:counts-d1';

// เรียกทุกครั้งที่ customers ใน D1 เปลี่ยน (insert/update/delete/import)
export async function touchCustomers(env) {
  if (!env?.BFR_KV) return;
  try {
    await env.BFR_KV.put(CUSTOMERS_UPDATED_KEY, new Date().toISOString());
  } catch (e) { console.warn('touchCustomers failed:', e.message); }
}

// เรียกทุกครั้งที่ GET query D1 จริง → refresh etag gate data (MAX updated_at + counts)
export async function refreshCustomerCache(env, { maxUpdated, customersCount, gpsCount }) {
  if (!env?.BFR_KV) return;
  try {
    if (maxUpdated) await env.BFR_KV.put(DB_MAX_UPDATED_KEY, maxUpdated);
    await env.BFR_KV.put(COUNTS_KEY, JSON.stringify({ customers: customersCount, gps: gpsCount }));
  } catch (e) { console.warn('refreshCustomerCache failed:', e.message); }
}

export { CUSTOMERS_UPDATED_KEY, DB_MAX_UPDATED_KEY, COUNTS_KEY };

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
