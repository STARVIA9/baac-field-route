// Unified sync endpoint — POST /api/sync
// Syncs: customers, visits, routes, route-saved
// Body: { customers: [...], visits: {...}, route: [...], savedRoutes: [...] }
// Returns: full state of all data

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

  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  // Read all existing
  const customersRaw = await env.BFR_KV.get('customers:all');
  const visitsRaw = await env.BFR_KV.get('visits:all');
  const routesRaw = await env.BFR_KV.get('routes:all');  // saved routes (history)

  const existingCustomers = customersRaw ? JSON.parse(customersRaw) : [];
  const existingVisits = visitsRaw ? JSON.parse(visitsRaw) : {};
  const existingRoutes = routesRaw ? JSON.parse(routesRaw) : [];

  // Merge incoming
  const mergedCustomers = mergeById(existingCustomers, body.customers || []);
  const mergedVisits = mergeVisits(existingVisits, body.visits || {});
  const mergedRoutes = mergeById(existingRoutes, body.savedRoutes || []);

  // Save back
  await env.BFR_KV.put('customers:all', JSON.stringify(mergedCustomers));
  await env.BFR_KV.put('visits:all', JSON.stringify(mergedVisits));
  await env.BFR_KV.put('routes:all', JSON.stringify(mergedRoutes));

  // Update last-write timestamp (used for polling/etag)
  const serverTime = new Date().toISOString();
  await env.BFR_KV.put('meta:lastwrite', serverTime);

  return json({
    success: true,
    serverTime,
    // Intentionally NOT returning customers array (see GET handler for reasoning)
    customers: [],
    visits: mergedVisits,
    savedRoutes: mergedRoutes,
    counts: {
      customers: mergedCustomers.filter(c => !c.deleted).length,
      visits: Object.keys(mergedVisits).length,
      savedRoutes: mergedRoutes.length,
    },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);

  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const customersRaw = await env.BFR_KV.get('customers:all');
  const visitsRaw = await env.BFR_KV.get('visits:all');
  const routesRaw = await env.BFR_KV.get('routes:all');
  const lastWrite = await env.BFR_KV.get('meta:lastwrite');

  const customers = customersRaw ? JSON.parse(customersRaw) : [];
  const visits = visitsRaw ? JSON.parse(visitsRaw) : {};
  const savedRoutes = routesRaw ? JSON.parse(routesRaw) : [];

  return json({
    success: true,
    serverTime: lastWrite || new Date().toISOString(),
    // ⚠️ Intentionally NOT returning full customers array (3,852 records ≈ 4MB JSON)
    //     — caused "Worker exceeded resource limits" (503) on every GET.
    //     Sync endpoint previously JSON.stringify'd all customers every 3 seconds.
    //     Customers are loaded locally from customers-db.json + localStorage.
    //     Only visits + savedRoutes are synced for cross-device continuity.
    customers: [],
    visits,
    savedRoutes,
    counts: {
      customers: customers.length,
      visits: Object.keys(visits).length,
      savedRoutes: savedRoutes.length,
    },
  });
}
