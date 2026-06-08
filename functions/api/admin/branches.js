// Admin branch management — /api/admin/branches
// GET: list all branches (seed defaults on first run)
// POST: create branch
// PUT: update branch
// DELETE: delete branch

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';
import { BRANCHES as DEFAULT_BRANCHES } from '../../_lib/branches.js';

const KV_KEY = 'branches:all';

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

// Seed default branches on first run
async function ensureDefaults(kv) {
  const raw = await kv.get(KV_KEY);
  if (raw) return JSON.parse(raw);
  const seeded = DEFAULT_BRANCHES.map(b => ({ ...b, createdAt: new Date().toISOString() }));
  await kv.put(KV_KEY, JSON.stringify(seeded));
  return seeded;
}

// ===== GET — list branches =====
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const branches = await ensureDefaults(env.BFR_KV);
  return json({ success: true, branches });
}

// ===== POST — create branch =====
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { code, name } = body;
  if (!code || !name) return json({ success: false, error: 'กรุณากรอก code และ name' }, 400);

  const branches = await ensureDefaults(env.BFR_KV);
  if (branches.find(b => b.code === code)) {
    return json({ success: false, error: `สาขา "${code}" มีอยู่แล้ว` }, 409);
  }

  branches.push({ code, name, createdAt: new Date().toISOString() });
  await env.BFR_KV.put(KV_KEY, JSON.stringify(branches));
  return json({ success: true, branches }, 201);
}

// ===== PUT — update branch =====
export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { code, name } = body;
  if (!code || !name) return json({ success: false, error: 'กรุณากรอก code และ name' }, 400);

  const branches = await ensureDefaults(env.BFR_KV);
  const idx = branches.findIndex(b => b.code === code);
  if (idx < 0) return json({ success: false, error: `ไม่พบสาขา "${code}"` }, 404);

  branches[idx].name = name;
  branches[idx].updatedAt = new Date().toISOString();
  await env.BFR_KV.put(KV_KEY, JSON.stringify(branches));
  return json({ success: true });
}

// ===== DELETE — delete branch =====
export async function onRequestDelete(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { code } = body;
  if (!code) return json({ success: false, error: 'กรุณากรอก code' }, 400);

  const branches = await ensureDefaults(env.BFR_KV);
  const idx = branches.findIndex(b => b.code === code);
  if (idx < 0) return json({ success: false, error: `ไม่พบสาขา "${code}"` }, 404);

  branches.splice(idx, 1);
  await env.BFR_KV.put(KV_KEY, JSON.stringify(branches));
  return json({ success: true });
}
