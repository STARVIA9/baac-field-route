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

// GPS history — บันทึกทุกครั้งที่พิกัดเปลี่ยน (กันพิกัดเคลื่อน/หายแล้วกู้ไม่ได้)
// - ข้ามเมื่อพิกัดไม่เปลี่ยน หรือไม่มีพิกัดทั้งก่อนและหลัง
// - try/catch ข้างใน: ถ้าตารางยังไม่มี (migration ยังไม่รัน) จะข้ามเงียบๆ ไม่พังงานหลัก
export async function logGpsHistory(env, { cif, oldLat, oldLng, newLat, newLng, by, source }) {
  try {
    if (!env?.BFR_DB || !cif) return false;
    const oLat = oldLat ?? null, oLng = oldLng ?? null;
    const nLat = newLat ?? null, nLng = newLng ?? null;
    if (oLat === nLat && oLng === nLng) return false;
    if (oLat == null && oLng == null && nLat == null && nLng == null) return false;
    await env.BFR_DB.prepare(
      `INSERT INTO gps_history (cif, old_lat, old_lng, new_lat, new_lng, changed_by, source, changed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(
      String(cif), oLat, oLng, nLat, nLng,
      String(by || ''), String(source || ''),
      new Date().toISOString()
    ).run();
    return true;
  } catch (e) { console.warn('logGpsHistory skip:', e.message); return false; }
}

// ===== D1 WRITE BUDGET (โควต้าเขียน D1 — กันล็อก 100,000 แถว/วัน) =====
// ที่มา: 16 ต.ค.69 เขียนไป 130,930 แถวในวันเดียว (อัพไฟล์หนี้ซ้ำ + backfill ทั้งตาราง)
// โดนล็อกเขียนถึง 00:00 UTC. หลัก: งาน bulk ต้อง dryrun → เทียบของเดิม → เขียนเฉพาะที่เปลี่ยน
// + เช็คโควต้าก่อนเขียนทุกครั้ง. นับแบบประมาณ (1 statement ≈ 1 แถว) ฝั่งปลอดภัย (ปัดขึ้น)

export const D1_DAILY_WRITE_LIMIT = 100000;
const D1_WRITE_WARN_AT = 70000;   // เตือน (แถบเหลือง)
const D1_WRITE_BLOCK_AT = 90000;  // งาน bulk ห้ามเกินนี้ (เหลือ 10k ให้งานแก้รายใบ)

function todayKey() {
  return 'd1writes:' + new Date().toISOString().slice(0, 10);
}

// บวกยอดเขียนของวันนี้ { total, byOp } — 1 KV read + 1 KV write (งาน bulk เรียกครั้งเดียวต่อรอบ)
export async function trackWrites(env, n, op) {
  try {
    if (!env?.BFR_KV || !n) return;
    const key = todayKey();
    const raw = await env.BFR_KV.get(key);
    const cur = raw ? JSON.parse(raw) : { total: 0, byOp: {} };
    cur.total = (cur.total || 0) + n;
    cur.byOp = cur.byOp || {};
    cur.byOp[op || 'other'] = (cur.byOp[op || 'other'] || 0) + n;
    await env.BFR_KV.put(key, JSON.stringify(cur));
  } catch (e) { console.warn('trackWrites skip:', e.message); }
}

// อ่านโควต้าวันนี้ (ไม่เขียนอะไร — เรียกโชว์บนจอได้บ่อย)
export async function getWriteBudget(env) {
  const d = { date: new Date().toISOString().slice(0, 10), used: 0, byOp: {}, limit: D1_DAILY_WRITE_LIMIT };
  try {
    if (!env?.BFR_KV) return { ...d, remaining: d.limit, warn: false };
    const raw = await env.BFR_KV.get(todayKey());
    if (raw) {
      const cur = JSON.parse(raw);
      d.used = cur.total || 0;
      d.byOp = cur.byOp || {};
    }
  } catch (e) { console.warn('getWriteBudget skip:', e.message); }
  d.remaining = Math.max(0, d.limit - d.used);
  d.warn = d.used >= D1_WRITE_WARN_AT;
  d.blockBulk = d.used >= D1_WRITE_BLOCK_AT;
  d.pct = Math.min(100, Math.round((d.used / d.limit) * 100));
  return d;
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
    branch: r.branch || '',
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
