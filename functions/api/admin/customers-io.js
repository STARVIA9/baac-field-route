// Admin Customer Import/Export — /api/admin/customers-io
// POST: import Excel/CSV (admin only)
// GET: export CSV (admin only)
//   ?format=csv|json (default csv)
//   ?fields=cif,name,phone,... (default all)
//   ?hasGps=true|false (filter)
//   ?q=text (search)

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';

const KV_CUSTOMERS = 'customers:all';
const KV_RECYCLE = 'customers:recycle';
const KV_AUDIT = 'audit:log';

// Standard fields in exportable order
const ALL_FIELDS = ['cif', 'name', 'nickname', 'phone', 'address', 'lat', 'lng', 'riskLevel', 'debtType', 'tags', 'createdAt', 'updatedAt'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function authCheck(request, env) {
  const token = extractBearerToken(request);
  if (!token) return { error: 'No token' };
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return { error: 'Invalid token' };
  return { user: payload };
}

async function log(env, user, action, detail) {
  try {
    if (!env.BFR_KV) return;
    const raw = await env.BFR_KV.get(KV_AUDIT);
    const logs = raw ? JSON.parse(raw) : [];
    logs.push({ ts: new Date().toISOString(), user: user.username || user.sub || 'unknown', action, detail });
    await env.BFR_KV.put(KV_AUDIT, JSON.stringify(logs.slice(-500)));
  } catch (e) { console.warn('audit log failed:', e.message); }
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeCsv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function getAll(env) {
  const raw = await env.BFR_KV.get(KV_CUSTOMERS);
  return raw ? JSON.parse(raw) : [];
}

// ===== GET: export =====
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const url = new URL(request.url);
  const format = url.searchParams.get('format') || 'csv';
  const fieldsParam = url.searchParams.get('fields');
  const hasGps = url.searchParams.get('hasGps');
  const query = (url.searchParams.get('q') || '').toLowerCase().trim();

  // Validate fields
  let fields = ALL_FIELDS;
  if (fieldsParam) {
    fields = fieldsParam.split(',').map(f => f.trim()).filter(f => ALL_FIELDS.includes(f));
    if (fields.length === 0) {
      return json({ success: false, error: `fields ไม่ถูกต้อง — ใช้ได้เฉพาะ: ${ALL_FIELDS.join(', ')}` }, 400);
    }
  }

  // Load + filter
  let customers = (await getAll(env)).filter(c => !c.deleted);

  if (hasGps === 'true') customers = customers.filter(c => c.lat && c.lng && Number.isFinite(c.lat) && Number.isFinite(c.lng));
  else if (hasGps === 'false') customers = customers.filter(c => !c.lat || !c.lng || !Number.isFinite(c.lat) || !Number.isFinite(c.lng));

  if (query) {
    customers = customers.filter(c => {
      const hay = `${c.cif || ''} ${c.name || ''} ${c.nickname || ''} ${c.phone || ''} ${c.address || ''}`.toLowerCase();
      return hay.includes(query);
    });
  }

  if (format === 'json') {
    return new Response(JSON.stringify({
      success: true,
      count: customers.length,
      fields,
      customers: customers.map(c => Object.fromEntries(fields.map(f => [f, c[f]]))),
    }, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="customers-${Date.now()}.json"`,
      },
    });
  }

  // CSV (default)
  const header = fields.join(',');
  const rows = customers.map(c => fields.map(f => {
    const v = c[f];
    if (Array.isArray(v)) return escapeCsv(v.join('|'));
    return escapeCsv(v);
  }).join(','));

  const csv = '\uFEFF' + header + '\n' + rows.join('\n'); // BOM for Excel Thai

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="customers-${Date.now()}.csv"`,
    },
  });
}

// ===== POST: import =====
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { mode = 'append', customers: incoming = [] } = body;
  // mode: 'append' (skip dup) | 'upsert' (update existing) | 'replace' (delete all first)

  if (!Array.isArray(incoming) || incoming.length === 0) {
    return json({ success: false, error: 'ต้องส่ง customers array' }, 400);
  }

  let all = await getAll(env);
  const stats = { added: 0, updated: 0, skipped: 0, errors: [] };

  if (mode === 'replace') {
    // Move all existing active customers to recycle
    const recycleRaw = await env.BFR_KV.get(KV_RECYCLE);
    const recycle = recycleRaw ? JSON.parse(recycleRaw) : [];
    const now = new Date().toISOString();
    const toRecycle = all.filter(c => !c.deleted).map(c => ({
      ...c, deleted: true, deletedAt: now, deletedBy: `import-${auth.user.username || auth.user.sub}`,
    }));
    recycle.push(...toRecycle);
    await env.BFR_KV.put(KV_RECYCLE, JSON.stringify(recycle));
    all = [];
  }

  for (let i = 0; i < incoming.length; i++) {
    const inc = incoming[i];
    if (!inc.cif || !inc.name) {
      stats.errors.push({ row: i + 1, reason: 'ขาด CIF หรือ name' });
      continue;
    }

    const existingIdx = all.findIndex(c => c.cif === inc.cif && !c.deleted);

    if (existingIdx >= 0) {
      if (mode === 'upsert') {
        // Update only non-empty fields
        const old = all[existingIdx];
        const fields = ['name', 'nickname', 'phone', 'address', 'lat', 'lng', 'riskLevel', 'debtType', 'tags'];
        for (const f of fields) {
          if (inc[f] !== undefined && inc[f] !== null && inc[f] !== '') old[f] = inc[f];
        }
        old.updatedAt = new Date().toISOString();
        old.updatedBy = `import-${auth.user.username || auth.user.sub}`;
        stats.updated++;
      } else {
        stats.skipped++;
      }
    } else {
      const newCustomer = {
        id: genId(),
        cif: inc.cif,
        name: inc.name,
        nickname: inc.nickname || '',
        phone: inc.phone || '',
        address: inc.address || '',
        lat: inc.lat ? parseFloat(inc.lat) : null,
        lng: inc.lng ? parseFloat(inc.lng) : null,
        riskLevel: inc.riskLevel || 'unclassified',
        debtType: inc.debtType || '',
        tags: Array.isArray(inc.tags) ? inc.tags : (typeof inc.tags === 'string' && inc.tags ? inc.tags.split('|').filter(Boolean) : []),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: `import-${auth.user.username || auth.user.sub}`,
      };
      all.push(newCustomer);
      stats.added++;
    }
  }

  await env.BFR_KV.put(KV_CUSTOMERS, JSON.stringify(all));
  await log(env, auth.user, 'import', { mode, ...stats, total: incoming.length });

  return json({ success: true, ...stats, total: incoming.length });
}
