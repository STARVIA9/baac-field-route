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

// ===== GET /api/admin/customers-crud?includeDeleted=true =====
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
  const includeRecycle = url.searchParams.get('includeRecycle') === 'true';

  const customers = await getAll(env, includeDeleted);
  const recycle = includeRecycle ? await getRecycle(env) : [];

  return json({ success: true, count: customers.length, customers, recycle });
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

    const all = await getAll(env, true);
    all.push(restored);
    await env.BFR_KV.put(KV_CUSTOMERS, JSON.stringify(all));
    await saveRecycle(env, recycle);
    await log(env, auth.user, 'restore', { id: restored.id, name: restored.name });

    return json({ success: true, customer: restored });
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
  await log(env, auth.user, 'create', { id: newCustomer.id, cif, name });

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
  await log(env, auth.user, 'update', { id, changed });

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

  // Move to recycle bin
  const recycle = await getRecycle(env);
  recycle.push(customer);
  await saveRecycle(env, recycle);

  // Remove from active list
  all.splice(idx, 1);
  await env.BFR_KV.put(KV_CUSTOMERS, JSON.stringify(all));
  await log(env, auth.user, 'delete', { id, cif: customer.cif, name: customer.name });

  return json({ success: true, deleted: id, recycleDays: RECYCLE_TTL_DAYS });
}
