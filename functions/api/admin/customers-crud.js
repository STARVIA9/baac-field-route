// Admin Customer CRUD — /api/admin/customers-crud
// D1-backed (single source of truth). Replaces the old KV customers:all/recycle.
// GET: list active customers (admin only)
// POST: create new customer (admin only)
// PUT: update customer (admin only)
// DELETE: soft-delete → recycle bin (admin only)
// POST ?action=restore: restore from recycle bin (admin only)
// DELETE ?action=purge: permanent delete after 30 days (admin only)

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';

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

// ===== D1 helpers =====

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
    potential: r.potential || '',
    photo: r.photo || '',
    createdBy: r.created_by || '',
    deleted: !!r.deleted,
    deletedAt: r.deleted_at || null,
    deletedBy: r.deleted_by || null,
    tags: [],
    createdAt: r.created_at || '',
    updatedAt: r.updated_at || '',
    geo_source: r.geo_source || '',
    extra: {
      amphoe: r.amphoe || '', tambon: r.tambon || '', province: r.province || '',
      postcode: r.postcode || '', moo: r.moo || '', idCard: r.id_card || '', dob: r.dob || '',
    },
  };
}

async function getAll(env, includeDeleted = false) {
  if (!env.BFR_DB) return [];
  const where = includeDeleted ? '' : 'WHERE deleted=0';
  const { results } = await env.BFR_DB.prepare(`SELECT * FROM customers ${where} ORDER BY name ASC`).all();
  return (results || []).map(rowToCustomer);
}

async function getRecycle(env) {
  if (!env.BFR_DB) return [];
  // Recycle = deleted customers
  const { results } = await env.BFR_DB.prepare(
    'SELECT * FROM customers WHERE deleted=1 ORDER BY deleted_at DESC OR updated_at DESC'
  ).all();
  return (results || []).map(rowToCustomer);
}

async function saveRecycle(env, recycle) {
  return recycle; // D1 is source of truth; no-op (deleted flag in D1)
}

// Bump GPS overlay version so map polling picks it up
async function bumpOverlay(env, cif, lat, lng, name) {
  if (!env.BFR_KV) return;
  try {
    const raw = await env.BFR_KV.get('gps:overlay');
    const overlay = raw ? JSON.parse(raw) : {};
    if (cif && lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      overlay[String(cif)] = { lat: Number(lat), lng: Number(lng), name: name || '', updatedAt: new Date().toISOString() };
    } else if (cif) {
      delete overlay[String(cif)];
    }
    await env.BFR_KV.put('gps:overlay', JSON.stringify(overlay));
    await env.BFR_KV.put('meta:overlay-updated', new Date().toISOString());
  } catch (e) { console.warn('bumpOverlay failed:', e.message); }
}

async function log(env, user, action, detail) {
  try {
    if (!env.BFR_KV) return;
    const raw = await env.BFR_KV.get('audit:log');
    const logs = raw ? JSON.parse(raw) : [];
    logs.push({ ts: new Date().toISOString(), user: user.username || user.sub || 'unknown', action, detail });
    await env.BFR_KV.put('audit:log', JSON.stringify(logs.slice(-500)));
  } catch (e) { console.warn('audit log failed:', e.message); }
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// ===== GET =====
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
  const includeRecycle = url.searchParams.get('includeRecycle') === 'true';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const perPage = Math.min(500, Math.max(1, parseInt(url.searchParams.get('per_page') || '50')));
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const hasGps = url.searchParams.get('hasGps');
  const riskFilter = url.searchParams.get('risk');

  let customers = await getAll(env, includeDeleted);

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
    customers = customers.filter(c => c.lat != null && Number.isFinite(c.lat));
  } else if (hasGps === 'false') {
    customers = customers.filter(c => !(c.lat != null && Number.isFinite(c.lat)));
  }
  if (riskFilter && riskFilter !== 'all') {
    customers = customers.filter(c => (c.riskLevel || 'unclassified') === riskFilter);
  }

  const total = customers.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * perPage;
  const pageCustomers = customers.slice(start, start + perPage);

  const allTags = [];
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

// ===== POST =====
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // ---- Restore from recycle ----
  if (action === 'restore') {
    let body;
    try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
    const { cif } = body;
    if (!cif) {
      // fallback: try id (db_cif)
      const idMatch = (body.id || '').match(/^db_(.+)$/);
      if (!idMatch) return json({ success: false, error: 'ต้องระบุ cif หรือ id' }, 400);
      const res = await env.BFR_DB.prepare('SELECT cif FROM customers WHERE cif=?1').bind(idMatch[1]).first();
      if (!res) return json({ success: false, error: 'ไม่พบในถังขยะ' }, 404);
      await env.BFR_DB.prepare(
        'UPDATE customers SET deleted=0, deleted_at=NULL, deleted_by=NULL, updated_at=?1 WHERE cif=?2'
      ).bind(new Date().toISOString(), idMatch[1]).run();
      const fresh = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(idMatch[1]).first();
      await log(env, auth.user, 'restore', { id: body.id, cif: idMatch[1], name: fresh?.name });
      if (fresh && fresh.lat != null && fresh.lng != null) await bumpOverlay(env, fresh.cif, fresh.lat, fresh.lng, fresh.name);
      return json({ success: true, customer: rowToCustomer(fresh) });
    }
    const res = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
    if (!res) return json({ success: false, error: 'ไม่พบในถังขยะ' }, 404);
    await env.BFR_DB.prepare(
      'UPDATE customers SET deleted=0, deleted_at=NULL, deleted_by=NULL, updated_at=?1 WHERE cif=?2'
    ).bind(new Date().toISOString(), cif).run();
    const fresh = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
    await log(env, auth.user, 'restore', { id: 'db_' + cif, cif, name: fresh?.name });
    if (fresh && fresh.lat != null && fresh.lng != null) await bumpOverlay(env, fresh.cif, fresh.lat, fresh.lng, fresh.name);
    return json({ success: true, customer: rowToCustomer(fresh) });
  }

  // ---- Batch delete (soft) ----
  if (action === 'batch-delete') {
    let body;
    try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
    const { ids } = body;
    if (!Array.isArray(ids) || ids.length === 0) return json({ success: false, error: 'ต้องระบุ ids array' }, 400);
    if (ids.length > 200) return json({ success: false, error: 'ลบทีละไม่เกิน 200 รายการ' }, 400);

    const now = new Date().toISOString();
    const deletedBy = auth.user.username || auth.user.sub || "unknown";
    let deleted = [];
    let deletedCifs = [];

    for (const id of ids) {
      const m = String(id).match(/^db_(.+)$/);
      const cif = m ? m[1] : id;
      const res = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
      if (res) {
        await env.BFR_DB.prepare(
          'UPDATE customers SET deleted=1, deleted_at=?1, deleted_by=?2, updated_at=?1 WHERE cif=?3'
        ).bind(now, deletedBy, cif).run();
        if (res.lat != null && res.lng != null) deletedCifs.push(cif);
        deleted.push(id);
      }
    }
    await log(env, auth.user, 'batch-delete', { count: deleted.length, ids: deleted });
    // remove deleted from overlay
    if (deletedCifs.length > 0) {
      try {
        const raw = await env.BFR_KV.get('gps:overlay');
        const overlay = raw ? JSON.parse(raw) : {};
        for (const cif of deletedCifs) delete overlay[String(cif)];
        await env.BFR_KV.put('gps:overlay', JSON.stringify(overlay));
        await env.BFR_KV.put('meta:overlay-updated', now);
      } catch (e) { console.warn('batch overlay cleanup failed:', e.message); }
    }
    return json({ success: true, deleted, count: deleted.length, recycleDays: RECYCLE_TTL_DAYS });
  }

  // ---- Create new customer ----
  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { cif, name, phone, address, lat, lng, nickname, riskLevel, debtType } = body;
  if (!cif || !name) return json({ success: false, error: 'ต้องระบุ CIF และ ชื่อ-นามสกุล' }, 400);

  // Duplicate check
  const dup = await env.BFR_DB.prepare('SELECT cif FROM customers WHERE cif=?1').bind(cif).first();
  if (dup) return json({ success: false, error: `CIF ${cif} มีอยู่แล้วในระบบ` }, 409);

  const now = new Date().toISOString();
  const createdBy = auth.user.username || auth.user.sub || "unknown";
  const latV = lat ? parseFloat(lat) : null;
  const lngV = lng ? parseFloat(lng) : null;

  // INSERT using esc() — avoids D1 numbered-placeholder binding pitfalls
  const esc = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return "'" + String(v).replace(/'/g, "''") + "'";
  };
  const insCols = ['cif','name','nickname','phone','address','lat','lng','risk_level','debt_type','deleted','created_by','created_at','updated_at'];
  const insVals = [
    esc(cif), esc(name), esc(nickname || ''), esc(phone || ''), esc(address || ''),
    esc(latV), esc(lngV), esc(riskLevel || 'unclassified'), esc(debtType || null),
    '0', esc(createdBy), esc(now), esc(now),
  ];
  try {
    await env.BFR_DB.prepare(
      `INSERT INTO customers (${insCols.join(',')}) VALUES (${insVals.join(',')})`
    ).run();
  } catch (e) {
    console.error('admin create insert failed:', e.message);
    return json({ success: false, error: 'Insert failed: ' + e.message }, 500);
  }

  const newCustomer = rowToCustomer({
    cif, name, nickname: nickname || '', phone: phone || '', address: address || '',
    lat: latV, lng: lngV, risk_level: riskLevel || 'unclassified', debt_type: debtType || null,
    created_by: createdBy, created_at: now, updated_at: now, deleted: 0,
  });

  try {
    await log(env, auth.user, 'create', { id: newCustomer.id, cif, name });
    if (latV != null && lngV != null) await bumpOverlay(env, cif, latV, lngV, name);
    await env.BFR_KV.put('meta:lastwrite', now);
  } catch (e) {
    console.error('admin create post-insert error:', e.message);
  }

  return json({ success: true, customer: newCustomer }, 201);
}

// ===== PUT (update) =====
export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { id, ...updates } = body;
  if (!id) return json({ success: false, error: 'ต้องระบุ id' }, 400);
  const m = String(id).match(/^db_(.+)$/);
  const cif = m ? m[1] : id;

  const exists = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
  if (!exists) return json({ success: false, error: 'ไม่พบลูกค้า' }, 404);

  const sets = [];
  const changed = [];
  const updater = auth.user.username || auth.user.sub || "unknown";
  if (updates.name !== undefined) { sets.push('name=?1'); changed.push('name'); }
  if (updates.nickname !== undefined) { sets.push('nickname=?2'); changed.push('nickname'); }
  if (updates.phone !== undefined) { sets.push('phone=?3'); changed.push('phone'); }
  if (updates.address !== undefined) { sets.push('address=?4'); changed.push('address'); }
  if (updates.riskLevel !== undefined) { sets.push('risk_level=?5'); changed.push('riskLevel'); }
  if (updates.debtType !== undefined) { sets.push('debt_type=?6'); changed.push('debtType'); }
  if (updates.lat !== undefined && updates.lng !== undefined) {
    sets.push('lat=?7'); sets.push('lng=?8');
    changed.push('lat'); changed.push('lng');
  }

  if (sets.length === 0) return json({ success: false, error: 'ไม่มีข้อมูลให้อัพเดท' }, 400);

  const now = new Date().toISOString();
  sets.push('updated_at=?9');
  const params = [
    updates.name ?? null, updates.nickname ?? null, updates.phone ?? null,
    updates.address ?? null, updates.riskLevel ?? null, updates.debtType ?? null,
    updates.lat !== undefined ? (updates.lat != null ? parseFloat(updates.lat) : null) : null,
    updates.lng !== undefined ? (updates.lng != null ? parseFloat(updates.lng) : null) : null,
    now,
  ];

  await env.BFR_DB.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE cif=${esc(cif)}`).bind(...params).run();

  const fresh = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
  await log(env, auth.user, 'update', { id, changed });
  if (changed.includes('lat') || changed.includes('lng')) {
    await bumpOverlay(env, cif, fresh.lat, fresh.lng, fresh.name);
  }
  await env.BFR_KV.put('meta:lastwrite', now);

  return json({ success: true, customer: rowToCustomer(fresh) });
}

// ===== DELETE =====
export async function onRequestDelete(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const id = url.searchParams.get('id');
  if (!id) return json({ success: false, error: 'ต้องระบุ id' }, 400);
  const m = String(id).match(/^db_(.+)$/);
  const cif = m ? m[1] : id;

  // Purge = permanent delete
  if (action === 'purge') {
    const res = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
    if (!res) return json({ success: false, error: 'ไม่พบในถังขยะ' }, 404);
    await env.BFR_DB.prepare('DELETE FROM customers WHERE cif=?1').bind(cif).run();
    await log(env, auth.user, 'purge', { id, cif, name: res.name });
    if (res.lat != null && res.lng != null) await bumpOverlay(env, cif, null, null);
    return json({ success: true, purged: id });
  }

  // Soft delete
  const exists = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
  if (!exists) return json({ success: false, error: 'ไม่พบลูกค้า' }, 404);

  const now = new Date().toISOString();
  const deletedBy = auth.user.username || auth.user.sub || "unknown";
  try {
    await env.BFR_DB.prepare(
      'UPDATE customers SET deleted=1, deleted_at=?1, deleted_by=?2, updated_at=?1 WHERE cif=?3'
    ).bind(now, deletedBy, cif).run();
  } catch (e) {
    return json({ success: false, error: 'Delete failed: ' + e.message }, 500);
  }
  try {
    await log(env, auth.user, 'delete', { id, cif, name: exists.name });
    if (exists.lat != null && exists.lng != null) await bumpOverlay(env, cif, null, null);
    await env.BFR_KV.put('meta:lastwrite', now);
  } catch (e) {
    console.error('admin delete post error:', e.message);
  }

  return json({ success: true, deleted: id, recycleDays: RECYCLE_TTL_DAYS });
}
