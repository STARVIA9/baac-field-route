// Admin Customer CRUD — /api/admin/customers-crud
// GET: list active customers (admin only)
// POST: create new customer (admin only)
// PUT: update customer (admin only)
// DELETE: soft-delete → recycle bin (admin only)
// POST ?action=restore: restore from recycle bin (admin only)
// DELETE ?action=purge: permanent delete after 30 days (admin only)

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';

const KV_CUSTOMERS = 'customers:all';
const KV_RECYCLE = 'customers:recycle';
const KV_TAGS = 'customers:tags';
const KV_AUDIT = 'audit:log';
const RECYCLE_TTL_DAYS = 30;

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

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function log(env, user, action, detail) {
  try {
    if (!env.BFR_KV) return;
    const raw = await env.BFR_KV.get(KV_AUDIT);
    const logs = raw ? JSON.parse(raw) : [];
    logs.push({
      ts: new Date().toISOString(),
      user: user.username || user.sub || 'unknown',
      action,
      detail,
    });
    // Keep last 500 entries
    const trimmed = logs.slice(-500);
    await env.BFR_KV.put(KV_AUDIT, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('audit log failed:', e.message);
  }
}

async function getAll(env, includeDeleted = false) {
  const raw = await env.BFR_KV.get(KV_CUSTOMERS);
  const customers = raw ? JSON.parse(raw) : [];
  return includeDeleted ? customers : customers.filter(c => !c.deleted);
}

async function getRecycle(env) {
  const raw = await env.BFR_KV.get(KV_RECYCLE);
  return raw ? JSON.parse(raw) : [];
}

async function saveRecycle(env, recycle) {
  // Auto-purge items older than RECYCLE_TTL_DAYS
  const cutoff = Date.now() - (RECYCLE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const fresh = recycle.filter(r => new Date(r.deletedAt).getTime() > cutoff);
  await env.BFR_KV.put(KV_RECYCLE, JSON.stringify(fresh));
  return fresh;
}

/** Rebuild the tags cache from all customers — called after any write that changes tags */
async function refreshTagsCache(env) {
  try {
    const raw = await env.BFR_KV.get(KV_CUSTOMERS);
    const customers = raw ? JSON.parse(raw) : [];
    const tagsSet = new Set();
    for (const c of customers) {
      if (c.tags) c.tags.forEach(t => tagsSet.add(t));
    }
    await env.BFR_KV.put(KV_TAGS, JSON.stringify(Array.from(tagsSet).sort()));
  } catch (e) {
    console.warn('refreshTagsCache failed:', e.message);
  }
}

// ===== GET /api/admin/customers-crud =====
// Query params:
//   page=N (default 1), per_page=N (default 50, max 500)
//   q=text (search CIF/name/phone/address)
//   hasGps=true|false
//   risk=good|warning|bad|unclassified
//   tag=tagname
//   includeDeleted=true, includeRecycle=true
// Returns paginated results + total count + allTags
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
  const includeRecycle = url.searchParams.get('includeRecycle') === 'true';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const perPage = Math.min(500, Math.max(1, parseInt(url.searchParams.get('per_page') || '50')));
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const hasGps = url.searchParams.get('hasGps');
  const riskFilter = url.searchParams.get('risk');
  const tagFilter = url.searchParams.get('tag');

  let customers = await getAll(env, includeDeleted);

  // Server-side search & filter (to handle 10k+ records without loading all to client)
  if (q) {
    customers = customers.filter(c =>
      (c.cif && c.cif.toLowerCase().includes(q)) ||
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q)) ||
      (c.address && c.address.toLowerCase().includes(q)) ||
      (c.nickname && c.nickname.toLowerCase().includes(q))
    );
  }
  if (hasGps === 'true') {
    customers = customers.filter(c => c.lat && c.lng && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)));
  } else if (hasGps === 'false') {
    customers = customers.filter(c => !(c.lat && c.lng && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))));
  }
  if (riskFilter && riskFilter !== 'all') {
    customers = customers.filter(c => (c.riskLevel || 'unclassified') === riskFilter);
  }
  if (tagFilter && tagFilter !== 'all') {
    customers = customers.filter(c => (c.tags || []).includes(tagFilter));
  }

  const total = customers.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * perPage;
  const pageCustomers = customers.slice(start, start + perPage);

  // Read allTags from dedicated KV cache (tiny, fast)
  let allTags = [];
  try {
    const raw = await env.BFR_KV.get(KV_TAGS);
    if (raw !== null) allTags = JSON.parse(raw);
  } catch {}

  const recycle = includeRecycle ? await getRecycle(env) : [];

  return json({
    success: true,
    total,
    page: safePage,
    perPage,
    totalPages,
    customers: pageCustomers,
    recycle,
    allTags,
  });
}

// ===== POST /api/admin/customers-crud =====
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // Restore from recycle bin
  if (action === 'restore') {
    let body;
    try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
    const { id } = body;
    if (!id) return json({ success: false, error: 'ต้องระบุ id' }, 400);

    const recycle = await getRecycle(env);
    const idx = recycle.findIndex(c => c.id === id);
    if (idx < 0) return json({ success: false, error: 'ไม่พบในถังขยะ' }, 404);

    const restored = recycle.splice(idx, 1)[0];
    delete restored.deleted;
    delete restored.deletedAt;
    restored.updatedAt = new Date().toISOString();

    const all = await getAll(env, true);
    all.push(restored);
    await env.BFR_KV.put(KV_CUSTOMERS, JSON.stringify(all));
    await saveRecycle(env, recycle);
    await env.BFR_KV.put('meta:lastwrite', restored.updatedAt);
    await log(env, auth.user, 'restore', { id: restored.id, name: restored.name });
    await refreshTagsCache(env);

    return json({ success: true, customer: restored });
  }

  // Batch delete — soft delete multiple customers → recycle bin
  if (action === 'batch-delete') {
    let body;
    try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
    const { ids } = body;
    if (!Array.isArray(ids) || ids.length === 0) return json({ success: false, error: 'ต้องระบุ ids array' }, 400);
    if (ids.length > 200) return json({ success: false, error: 'ลบทีละไม่เกิน 200 รายการ' }, 400);

    const all = await getAll(env, true);
    const recycle = await getRecycle(env);
    const deleted = [];

    for (const id of ids) {
      const idx = all.findIndex(c => c.id === id);
      if (idx >= 0) {
        const customer = all[idx];
        customer.deleted = true;
        customer.deletedAt = new Date().toISOString();
        customer.deletedBy = auth.user.username || auth.user.sub;
        customer.updatedAt = new Date().toISOString();
        recycle.push(customer);
        // Keep in customers:all with deleted:true (don't splice out)
        deleted.push(id);
      }
    }

    await env.BFR_KV.put(KV_CUSTOMERS, JSON.stringify(all));
    await saveRecycle(env, recycle);
    const batchTime = new Date().toISOString();
    await env.BFR_KV.put('meta:lastwrite', batchTime);
    await log(env, auth.user, 'batch-delete', { count: deleted.length, ids: deleted });

    return json({ success: true, deleted, count: deleted.length, recycleDays: RECYCLE_TTL_DAYS });
  }

  // Create new customer
  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { cif, name, phone, address, lat, lng, nickname, riskLevel, debtType, tags } = body;

  if (!cif || !name) {
    return json({ success: false, error: 'ต้องระบุ CIF และ ชื่อ-นามสกุล' }, 400);
  }

  const all = await getAll(env, true);

  // Check duplicate CIF
  if (all.find(c => c.cif === cif && !c.deleted)) {
    return json({ success: false, error: `CIF ${cif} มีอยู่แล้วในระบบ` }, 409);
  }

  const newCustomer = {
    id: genId(),
    cif,
    name,
    nickname: nickname || '',
    phone: phone || '',
    address: address || '',
    lat: lat ? parseFloat(lat) : null,
    lng: lng ? parseFloat(lng) : null,
    riskLevel: riskLevel || 'unclassified',
    debtType: debtType || '',
    tags: Array.isArray(tags) ? tags : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: auth.user.username || auth.user.sub,
  };

  all.push(newCustomer);
  await env.BFR_KV.put(KV_CUSTOMERS, JSON.stringify(all));
  await env.BFR_KV.put('meta:lastwrite', newCustomer.updatedAt);
  await log(env, auth.user, 'create', { id: newCustomer.id, cif, name });
  await refreshTagsCache(env);

  return json({ success: true, customer: newCustomer }, 201);
}

// ===== PUT /api/admin/customers-crud =====
export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { id, ...updates } = body;
  if (!id) return json({ success: false, error: 'ต้องระบุ id' }, 400);

  const all = await getAll(env, true);
  const idx = all.findIndex(c => c.id === id);
  if (idx < 0) return json({ success: false, error: 'ไม่พบลูกค้า' }, 404);

  const allowed = ['name', 'nickname', 'phone', 'address', 'lat', 'lng', 'riskLevel', 'debtType', 'tags'];
  const changed = [];
  for (const key of allowed) {
    if (key in updates && updates[key] !== all[idx][key]) {
      changed.push(key);
      all[idx][key] = updates[key];
    }
  }
  all[idx].updatedAt = new Date().toISOString();
  all[idx].updatedBy = auth.user.username || auth.user.sub;

  await env.BFR_KV.put(KV_CUSTOMERS, JSON.stringify(all));
  await env.BFR_KV.put('meta:lastwrite', all[idx].updatedAt);
  await log(env, auth.user, 'update', { id, changed });

  // Refresh tags if tags changed
  if (changed.includes('tags')) await refreshTagsCache(env);

  return json({ success: true, customer: all[idx] });
}

// ===== DELETE /api/admin/customers-crud?id=... =====
export async function onRequestDelete(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // Permanent purge from recycle
  if (action === 'purge') {
    const id = url.searchParams.get('id');
    if (!id) return json({ success: false, error: 'ต้องระบุ id' }, 400);

    const recycle = await getRecycle(env);
    const idx = recycle.findIndex(c => c.id === id);
    if (idx < 0) return json({ success: false, error: 'ไม่พบในถังขยะ' }, 404);

    const removed = recycle.splice(idx, 1)[0];
    await saveRecycle(env, recycle);
    await env.BFR_KV.put('meta:lastwrite', new Date().toISOString());
    await log(env, auth.user, 'purge', { id, cif: removed.cif, name: removed.name });

    return json({ success: true, purged: id });
  }

  // Soft delete → recycle bin
  const id = url.searchParams.get('id');
  if (!id) return json({ success: false, error: 'ต้องระบุ id' }, 400);

  const all = await getAll(env, true);
  const idx = all.findIndex(c => c.id === id);
  if (idx < 0) return json({ success: false, error: 'ไม่พบลูกค้า' }, 404);

  const customer = all[idx];
  customer.deleted = true;
  customer.deletedAt = new Date().toISOString();
  customer.deletedBy = auth.user.username || auth.user.sub;
  customer.updatedAt = new Date().toISOString();

  // Move to recycle bin
  const recycle = await getRecycle(env);
  recycle.push(customer);
  await saveRecycle(env, recycle);

  // Keep in customers:all with deleted:true flag (don't splice out)
  // so the app's incremental sync can detect and process the deletion
  await env.BFR_KV.put(KV_CUSTOMERS, JSON.stringify(all));
  await env.BFR_KV.put('meta:lastwrite', customer.updatedAt);
  await log(env, auth.user, 'delete', { id, cif: customer.cif, name: customer.name });

  return json({ success: true, deleted: id, recycleDays: RECYCLE_TTL_DAYS });
}
