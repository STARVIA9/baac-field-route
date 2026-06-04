// Customer sync — POST /api/customers/sync
// Body: { customers: [...] }
// Returns: { success, customers: [...all known...], count }

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';

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

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
  const { customers = [] } = body;

  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  // Read existing
  const existingRaw = await env.BFR_KV.get('customers:all');
  const existing = existingRaw ? JSON.parse(existingRaw) : [];

  // Merge: by id, keep latest updatedAt
  const byId = new Map(existing.map(c => [c.id, c]));
  for (const c of customers) {
    if (!c.id) continue;
    const old = byId.get(c.id);
    if (!old) {
      byId.set(c.id, c);
    } else {
      const oldTime = new Date(old.updatedAt || old.createdAt || 0).getTime();
      const newTime = new Date(c.updatedAt || c.createdAt || 0).getTime();
      byId.set(c.id, newTime >= oldTime ? c : old);
    }
  }

  const merged = Array.from(byId.values());
  await env.BFR_KV.put('customers:all', JSON.stringify(merged));

  return json({ success: true, count: merged.length, customers: merged });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);

  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);
  const raw = await env.BFR_KV.get('customers:all');
  const customers = raw ? JSON.parse(raw) : [];
  return json({ success: true, count: customers.length, customers });
}
