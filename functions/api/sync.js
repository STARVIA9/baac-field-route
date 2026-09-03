// Unified sync endpoint — POST /api/sync
// Syncs: customers, visits, routes, route-saved
// Body: { customers: [...], visits: {...}, route: [...], savedRoutes: [...] }
// Returns: full state of all data

import { extractBearerToken, verifyHS256 } from '../_lib/jwt.js';
import { touchCustomers } from '../_lib/shared.js';

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

// Merge two arrays by id, keeping the newer updatedAt
// Supports soft delete: if either side has deleted=true, honor the newer one
function mergeById(existing, incoming) {
  const byId = new Map();
  for (const c of existing) {
    if (c.id) byId.set(c.id, c);
  }
  for (const c of incoming) {
    if (!c.id) continue;
    if (c.deleted) {
      // Incoming says deleted — always accept (propagate delete)
      byId.set(c.id, c);
      continue;
    }
    const old = byId.get(c.id);
    if (!old) {
      byId.set(c.id, c);  // new from incoming
    } else if (old.deleted) {
      // Existing is deleted but incoming isn't — keep deleted if existing is newer
      const oldTime = new Date(old.updatedAt || 0).getTime();
      const newTime = new Date(c.updatedAt || 0).getTime();
      byId.set(c.id, newTime >= oldTime ? c : old);
    } else {
      // Normal merge by updatedAt
      const oldTime = new Date(old.updatedAt || old.createdAt || 0).getTime();
      const newTime = new Date(c.updatedAt || c.createdAt || 0).getTime();
      byId.set(c.id, newTime >= oldTime ? c : old);
    }
  }
  return Array.from(byId.values());
}

// Merge visits (object keyed by customerId)
function mergeVisits(existing, incoming) {
  const merged = { ...existing };
  for (const [cid, visit] of Object.entries(incoming)) {
    const old = merged[cid];
    if (!old) {
      merged[cid] = visit;
    } else {
      const oldTime = new Date(old.timestamp || 0).getTime();
      const newTime = new Date(visit.timestamp || 0).getTime();
      merged[cid] = newTime >= oldTime ? visit : old;
    }
  }
  return merged;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  // Customers now live in D1 (single source of truth).
  // Visits + savedRoutes stay in KV — per user
  const userKey = auth.user && auth.user.username ? auth.user.username : 'default';
  const routesKey = 'routes:user:' + userKey;
  const visitsRaw = await env.BFR_KV.get('visits:all');
  const routesRaw = await env.BFR_KV.get(routesKey);

  const existingVisits = visitsRaw ? JSON.parse(visitsRaw) : {};
  const existingRoutes = routesRaw ? JSON.parse(routesRaw) : [];

  // Merge incoming
  const mergedVisits = mergeVisits(existingVisits, body.visits || {});
  const mergedRoutes = mergeById(existingRoutes, body.savedRoutes || []);

  // Save visits + routes to KV (per user)
  await env.BFR_KV.put('visits:all', JSON.stringify(mergedVisits));
  await env.BFR_KV.put(routesKey, JSON.stringify(mergedRoutes));
  // Track when visits last changed (client uses this to skip re-processing)
  const visitsUpdated = new Date().toISOString();
  await env.BFR_KV.put('meta:visits-updated', visitsUpdated);

  // Sync incoming customers into D1 (single source of truth)
  const customersSynced = await syncCustomersToD1(env, body.customers || []);
  // Bump etag gate: มี write จริง → client poll ถัดไปจะ query D1 (เห็นข้อมูลใหม่)
  if (customersSynced > 0) await touchCustomers(env);

  // Update last-write timestamp (used for polling/etag)
  const serverTime = new Date().toISOString();
  await env.BFR_KV.put('meta:lastwrite', serverTime);

  const d1Count = await d1CountCustomers(env);
  const gpsCount = await d1GpsCount(env);

  return json({
    success: true,
    serverTime,
    customers: [],
    visits: mergedVisits,
    savedRoutes: mergedRoutes,
    visitsUpdated,
    counts: {
      customers: d1Count,
      gps: gpsCount,
      visits: Object.keys(mergedVisits).length,
      savedRoutes: mergedRoutes.length,
    },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);

  const url = new URL(request.url);
  const since = url.searchParams.get('since');  // ISO timestamp — return only customers updated AFTER this

  const visitsRaw = await env.BFR_KV.get('visits:all');
  const routesKey = 'routes:user:' + (auth.user && auth.user.username ? auth.user.username : 'default');
  const routesRaw = await env.BFR_KV.get(routesKey);
  const lastWrite = await env.BFR_KV.get('meta:lastwrite');
  const overlayUpdatedAt = await env.BFR_KV.get('meta:overlay-updated');
  const visitsUpdated = await env.BFR_KV.get('meta:visits-updated');

  const visits = visitsRaw ? JSON.parse(visitsRaw) : {};
  const savedRoutes = routesRaw ? JSON.parse(routesRaw) : [];

  // ===== D1 ETAG GATE (ลด rows_read — D1 quota 5M rows/day) =====
  // ทุก write ลง customers ตั้ง updated_at = now เสมอ (verified ทุก endpoint)
  // → SELECT MAX(updated_at) ถูก index (idx_c_updated) = 1 row/poll ถูกมาก
  // ถ้า MAX ไม่เปลี่ยนจาก cache = ไม่มีข้อมูลใหม่ = ข้าม COUNT/gps/delta query เลย
  // (เขียนใหม่ผ่าน KV touch ใช้ไม่ได้ครบทุกจุด — MAX check ครอบคลุม 100%)
  let customers = [];
  let allCustomersCount = 0;
  let gpsCount = 0;
  let effectiveServerTime = lastWrite || new Date().toISOString();

  let d1Hit = false;  // true = query D1 เต็ม (มีข้อมูลใหม่ หรือ cache เก่า)

  if (env.BFR_DB) {
    const sinceTime = since ? new Date(since).getTime() : 0;
    const cachedMax = await env.BFR_KV.get('meta:db-max-updated');
    const cachedCounts = await env.BFR_KV.get('meta:counts-d1');
    const cacheWritten = await env.BFR_KV.get('meta:db-cache-written');
    const cachedMaxTime = cachedMax ? new Date(cachedMax).getTime() : 0;
    // cacheFresh คิดจากเวลาที่ cache ถูกเขียน (ไม่ใช่ MAX ซึ่งอาจเก่าหลายชม.)
    const cacheAgeMs = cacheWritten ? Date.now() - new Date(cacheWritten).getTime() : Infinity;
    // counts/MAX cache ใช้ได้ 6 ชม. — miss เกิดจาก MAX เปลี่ยนจริงเท่านั้น (มี write)
    // → ต่อ poll = 1 rows_read (MAX) เกือบตลอด; ต่อวัน ต่อเครื่องมี miss เต็มแค่ ~4 ครั้ง
    const cacheFresh = cacheAgeMs < 6 * 60 * 60 * 1000;

    // ที่สุด: SELECT MAX(updated_at) — ใช้ index idx_c_updated → rows_read = 1
    const maxRes = await env.BFR_DB.prepare(
      'SELECT MAX(updated_at) m FROM customers'
    ).first();
    const maxTime = maxRes?.m ? new Date(maxRes.m).getTime() : 0;

    // ETAG HIT: MAX เท่าเดิม + counts cache ยังสด → ไม่มีข้อมูลใหม่ → 0 query เพิ่ม
    const etagHit = maxTime > 0 && cachedMaxTime > 0 && maxTime === cachedMaxTime && cacheFresh;

    if (etagHit && cachedCounts) {
      // ✅ HIT — ใช้ cached counts, ไม่ query delta/count เลย (total rows_read = 1/poll!)
      try {
        const counts = JSON.parse(cachedCounts);
        allCustomersCount = counts.customers || 0;
        gpsCount = counts.gps || 0;
        d1Hit = false;
      } catch (e) { d1Hit = true; }
    } else {
      // ETAG MISS — มีข้อมูลใหม่ หรือ cache เก่า → query เต็ม + refresh cache
      d1Hit = true;
      if (sinceTime > 0 && !isNaN(sinceTime) && maxTime > sinceTime) {
        const sinceIso = new Date(sinceTime).toISOString();
        const { results } = await env.BFR_DB.prepare(
          `SELECT * FROM customers WHERE updated_at > ?1 AND deleted=0 ORDER BY updated_at ASC`
        ).bind(sinceIso).all();
        customers = (results || []).map(d1ToCustomer);
      }
      const countRes = await env.BFR_DB.prepare('SELECT COUNT(*) n FROM customers WHERE deleted=0').first();
      allCustomersCount = countRes?.n || 0;
      gpsCount = await d1GpsCount(env);
      // S3: serverTime = newest updated_at in D1 (not stale KV lastwrite) — clients
      // use this as `since` cursor, so no change is ever skipped between polls
      if (maxRes?.m && (!lastWrite || maxRes.m > lastWrite)) {
        effectiveServerTime = maxRes.m;
      }
      // Refresh KV caches (MAX + counts สำหรับ etag hit ครั้งถัดไป)
      try {
        const nowIso = new Date().toISOString();
        await env.BFR_KV.put('meta:db-max-updated', maxRes?.m || effectiveServerTime);
        await env.BFR_KV.put('meta:db-cache-written', nowIso);
        await env.BFR_KV.put('meta:counts-d1', JSON.stringify({ customers: allCustomersCount, gps: gpsCount }));
      } catch (e) { console.warn('etag cache put failed', e.message); }
    }
  }

  return json({
    success: true,
    serverTime: effectiveServerTime,
    overlayUpdatedAt: overlayUpdatedAt || null,
    visitsUpdated: visitsUpdated || null,
    customers,
    visits,
    savedRoutes,
    counts: {
      customers: allCustomersCount,
      gps: gpsCount,
      visits: Object.keys(visits).length,
      savedRoutes: savedRoutes.length,
    },
    _d1: d1Hit ? 'query' : 'cache',  // debug: ดูว่า poll นี้ query D1 หรือใช้ cache
  });
}

// ===== D1 helpers =====

function d1ToCustomer(r) {
  return {
    id: 'db_' + r.cif,
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
    potential: r.potential || '',
    photo: r.photo || '',
    createdBy: r.created_by || 'AutoImport:StaticDB',
    deleted: !!r.deleted,
    createdAt: r.created_at || '',
    updatedAt: r.updated_at || '',
    geo_source: r.geo_source || 'static_db',
  };
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

async function d1CountCustomers(env) {
  if (!env.BFR_DB) return 0;
  const res = await env.BFR_DB.prepare('SELECT COUNT(*) n FROM customers WHERE deleted=0').first();
  return res?.n || 0;
}

// Count customers that have GPS coords in D1 (server-authoritative for the
// "📍 มีพิกัดแล้ว N ราย" summary — every device reads the same number)
async function d1GpsCount(env) {
  if (!env.BFR_DB) return 0;
  const res = await env.BFR_DB.prepare(
    'SELECT COUNT(*) n FROM customers WHERE deleted=0 AND lat IS NOT NULL AND lng IS NOT NULL'
  ).first();
  return res?.n || 0;
}

// Upsert incoming customers into D1 (soft-delete honored)
async function syncCustomersToD1(env, incoming) {
  if (!env.BFR_DB || !Array.isArray(incoming) || incoming.length === 0) return 0;
  let synced = 0;
  let conflicts = 0;
  for (const c of incoming) {
    const cif = String(c.cif || '').trim();
    if (!cif) continue;
    const now = new Date().toISOString();
    const deleted = c.deleted ? 1 : 0;

    // Check existence (+ S1: conflict guard — compare updated_at)
    const exists = await env.BFR_DB.prepare(
      'SELECT cif, updated_at FROM customers WHERE cif = ?1'
    ).bind(cif).first();

    // S1: Server row is NEWER than what this device has → skip push (don't clobber)
    // Client wins only if its updatedAt >= server's (last-write-wins)
    const clientUpdatedAt = Date.parse(c.updatedAt || '') || 0;
    const serverUpdatedAt = exists?.updated_at ? Date.parse(exists.updated_at) : 0;
    if (exists && serverUpdatedAt > clientUpdatedAt + 1000) {  // 1s tolerance
      conflicts++;
      continue;
    }

    try {
      if (exists) {
        // Update all fields directly — COALESCE prevented clearing fields to null/empty.
        // Now: if client sends null/empty, the field IS cleared (server trusts the client).
        await env.BFR_DB.prepare(
          `UPDATE customers SET
             name = ?1,
             nickname = ?2,
             phone = ?3,
             address = ?4,
             risk_level = ?5,
             debt_type = ?6,
             lat = ?7,
             lng = ?8,
             deleted = ?9,
             updated_at = ?10
           WHERE cif = ?11`
        ).bind(
          c.name ?? null, c.nickname ?? null, c.phone ?? null, c.address ?? null,
          c.riskLevel ?? null, c.debtType ?? null,
          (c.lat != null && Number.isFinite(Number(c.lat))) ? Number(c.lat) : null,
          (c.lng != null && Number.isFinite(Number(c.lng))) ? Number(c.lng) : null,
          deleted, now, cif
        ).run();
      } else {
        await env.BFR_DB.prepare(
          `INSERT INTO customers (cif, name, nickname, phone, address, risk_level, debt_type, lat, lng, deleted, created_by, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)`
        ).bind(
          cif, c.name || '', c.nickname || '', c.phone || '', c.address || '',
          c.riskLevel || 'unclassified', c.debtType ?? null,
          (c.lat != null && Number.isFinite(Number(c.lat))) ? Number(c.lat) : null,
          (c.lng != null && Number.isFinite(Number(c.lng))) ? Number(c.lng) : null,
          deleted, c.createdBy || 'user', now
        ).run();
      }
      synced++;
    } catch (e) {
      console.warn('sync customer failed', cif, e.message);
    }
  }
  if (conflicts > 0) console.log(`[sync] skipped ${conflicts} stale updates (server newer)`);
  return synced;
}
