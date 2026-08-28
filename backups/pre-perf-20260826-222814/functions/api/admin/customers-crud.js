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

async function getAll(env, { includeDeleted = false, q = '', hasGps, riskFilter, debtClass, debt15m, hasDebt, debtMonth, limit = 5000, offset = 0 } = {}) {
  if (!env.BFR_DB) return { customers: [], total: 0 };
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (!includeDeleted) conditions.push('deleted=0');
  if (q) {
    conditions.push(`(LOWER(name) LIKE ?${paramIdx} OR LOWER(cif) LIKE ?${paramIdx} OR phone LIKE ?${paramIdx} OR LOWER(address) LIKE ?${paramIdx} OR LOWER(nickname) LIKE ?${paramIdx})`);
    params.push('%' + q.toLowerCase() + '%');
    paramIdx++;
  }
  if (hasGps === 'true') {
    conditions.push('lat IS NOT NULL AND lng IS NOT NULL');
  } else if (hasGps === 'false') {
    conditions.push('(lat IS NULL OR lng IS NULL)');
  }
  if (riskFilter && riskFilter !== 'all') {
    conditions.push(`COALESCE(risk_level, 'unclassified') = ?${paramIdx}`);
    params.push(riskFilter);
    paramIdx++;
  }
  // ===== กรองหนี้ (คล้ายการกรองในแผนที่) =====
  if (debtClass && debtClass !== 'all') {
    if (debtClass === 'none') {
      conditions.push(`(debt_class IS NULL OR debt_class = '')`);
    } else {
      conditions.push(`debt_class = ?${paramIdx}`);
      params.push(String(debtClass));
      paramIdx++;
    }
  }
  if (debt15m && debt15m !== 'all') {
    conditions.push(`overdue_15m = ?${paramIdx}`);
    params.push(debt15m === 'Y' ? 'Y' : 'N');
    paramIdx++;
  }
  if (hasDebt && hasDebt !== 'all') {
    if (hasDebt === 'yes') {
      conditions.push(`(debt_balance IS NOT NULL AND debt_balance > 0)`);
    } else if (hasDebt === 'no') {
      conditions.push(`(debt_balance IS NULL OR debt_balance = 0)`);
    }
  }
  if (debtMonth && debtMonth !== 'all') {
    // debtMonth = 'MM/YYYY' — เทียบกับ next_due (DD/MM/YYYY) ด้วย substring
    const m = String(debtMonth).match(/^(\d{2})\/(\d{4})$/);
    if (m) {
      conditions.push(`next_due LIKE ?${paramIdx}`);
      params.push(`%/${m[1]}/${m[2]}`);
      paramIdx++;
    }
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Count total
  const countRes = await env.BFR_DB.prepare(`SELECT COUNT(*) n FROM customers ${where}`).bind(...params).first();
  const total = countRes?.n || 0;

  // Fetch page
  params.push(limit, offset);
  const { results } = await env.BFR_DB.prepare(
    `SELECT * FROM customers ${where} ORDER BY name ASC LIMIT ?${paramIdx} OFFSET ?${paramIdx + 1}`
  ).bind(...params).all();

  return { customers: (results || []).map(rowToCustomer), total };
}

async function getRecycle(env) {
  if (!env.BFR_DB) return [];
  // Recycle = deleted customers
  const { results } = await env.BFR_DB.prepare(
    'SELECT * FROM customers WHERE deleted=1 ORDER BY deleted_at DESC, updated_at DESC'
  ).all();
  return (results || []).map(rowToCustomer);
}

async function saveRecycle(env, recycle) {
  return recycle; // D1 is source of truth; no-op (deleted flag in D1)
}

// Bump GPS overlay version so map polling picks it up
// R4 FIX: Don't read-modify-write KV overlay — GET /api/gps-overlay reads from D1.
// Just bump the timestamp so clients know to refetch.
async function bumpOverlay(env) {
  if (!env.BFR_KV) return;
  try {
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
  const debtClass = url.searchParams.get('debtClass') || 'all';
  const debt15m = url.searchParams.get('debt15m') || 'all';
  const hasDebt = url.searchParams.get('hasDebt') || 'all';
  const debtMonth = url.searchParams.get('debtMonth') || 'all';

  const offset = (page - 1) * perPage;
  const { customers, total } = await getAll(env, {
    includeDeleted, q, hasGps, riskFilter, debtClass, debt15m, hasDebt, debtMonth, limit: perPage, offset,
  });

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);

  // เดือนครบกำหนดจาก D1 (ตรงกับ filter debtMonth) — substr('30/09/2026',4,7) = '09/2026'
  const debtMonths = [];
  try {
    const mRes = await env.BFR_DB.prepare(
      `SELECT DISTINCT substr(next_due, 4, 7) m FROM customers WHERE deleted = 0 AND next_due != '' AND next_due IS NOT NULL ORDER BY m DESC`
    ).all();
    debtMonths.push(...(mRes.results || []).map(r => r.m).filter(Boolean));
  } catch (e) { console.warn('debtMonths failed:', e.message); }

  const allTags = [];
  const recycle = includeRecycle ? await getRecycle(env) : [];

  return json({
    success: true,
    total,
    page: safePage,
    perPage,
    totalPages,
    customers,
    recycle,
    allTags,
    debtMonths,
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
      if (fresh && fresh.lat != null && fresh.lng != null) await bumpOverlay(env);
      return json({ success: true, customer: rowToCustomer(fresh) });
    }
    const res = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
    if (!res) return json({ success: false, error: 'ไม่พบในถังขยะ' }, 404);
    await env.BFR_DB.prepare(
      'UPDATE customers SET deleted=0, deleted_at=NULL, deleted_by=NULL, updated_at=?1 WHERE cif=?2'
    ).bind(new Date().toISOString(), cif).run();
    const fresh = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
    await log(env, auth.user, 'restore', { id: 'db_' + cif, cif, name: fresh?.name });
    if (fresh && fresh.lat != null && fresh.lng != null) await bumpOverlay(env);
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
    // R4 FIX: Just bump overlay timestamp — GET reads from D1 directly
    if (deletedCifs.length > 0) {
      try {
        await env.BFR_KV.put('meta:overlay-updated', now);
      } catch (e) { console.warn('batch overlay bump failed:', e.message); }
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

  // INSERT using prepared statement with .bind()
  try {
    await env.BFR_DB.prepare(
      `INSERT INTO customers (cif, name, nickname, phone, address, lat, lng, risk_level, debt_type, deleted, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?11)`
    ).bind(
      cif, name, nickname || '', phone || '', address || '',
      latV, lngV, riskLevel || 'unclassified', debtType || null,
      createdBy, now
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
    if (latV != null && lngV != null) await bumpOverlay(env);
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
  const bindParams = [];
  let paramIdx = 1;

  const fieldMap = {
    name: 'name', nickname: 'nickname', phone: 'phone', address: 'address',
    riskLevel: 'risk_level', debtType: 'debt_type',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (updates[key] !== undefined) {
      sets.push(`${col}=?${paramIdx}`);
      bindParams.push(updates[key] || '');
      changed.push(key);
      paramIdx++;
    }
  }

  if (updates.lat !== undefined && updates.lng !== undefined) {
    const latV = updates.lat != null ? parseFloat(updates.lat) : null;
    const lngV = updates.lng != null ? parseFloat(updates.lng) : null;
    sets.push(`lat=?${paramIdx}`);
    bindParams.push(latV);
    paramIdx++;
    sets.push(`lng=?${paramIdx}`);
    bindParams.push(lngV);
    paramIdx++;
    changed.push('lat', 'lng');
  }

  if (sets.length === 0) return json({ success: false, error: 'ไม่มีข้อมูลให้อัพเดท' }, 400);

  const now = new Date().toISOString();
  sets.push(`updated_at=?${paramIdx}`);
  bindParams.push(now);
  paramIdx++;

  bindParams.push(cif);
  await env.BFR_DB.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE cif=?${paramIdx}`).bind(...bindParams).run();

  const fresh = await env.BFR_DB.prepare('SELECT * FROM customers WHERE cif=?1').bind(cif).first();
  await log(env, auth.user, 'update', { id, changed });
  if (changed.includes('lat') || changed.includes('lng')) {
    await bumpOverlay(env);
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
    if (res.lat != null && res.lng != null) await bumpOverlay(env);
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
    if (exists.lat != null && exists.lng != null) await bumpOverlay(env);
    await env.BFR_KV.put('meta:lastwrite', now);
  } catch (e) {
    console.error('admin delete post error:', e.message);
  }

  return json({ success: true, deleted: id, recycleDays: RECYCLE_TTL_DAYS });
}
