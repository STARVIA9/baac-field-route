// Auth handler — POST /api/auth/login
// Rate-limited: max 10 attempts per IP per 15 minutes (KV-based)

import { signHS256 } from '../../_lib/jwt.js';

const PIN_TEAM = {
  '0000': { name: 'Admin', role: 'admin' },
  '1001': { name: 'สมชาย ใจดี', role: 'user' },
  '1002': { name: 'สมหญิง รักไทย', role: 'user' },
  '1003': { name: 'ประยุทธ์ มั่นคง', role: 'user' },
  '1004': { name: 'มาลี สดใส', role: 'user' },
};

const MAX_ATTEMPTS = 10;
const WINDOW_SEC = 15 * 60; // 15 minutes

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON' }, 400);
  }

  const { pin } = body;
  if (!pin) return json({ success: false, error: 'PIN required' }, 400);

  // Rate limiting via KV (per IP)
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const rateKey = `ratelimit:login:${ip}`;
  if (env.BFR_KV) {
    try {
      const raw = await env.BFR_KV.get(rateKey);
      const attempts = raw ? parseInt(raw, 10) : 0;
      if (attempts >= MAX_ATTEMPTS) {
        return json({ success: false, error: `พยายามเกิน ${MAX_ATTEMPTS} ครั้ง กรุณารอ 15 นาที` }, 429);
      }
      await env.BFR_KV.put(rateKey, String(attempts + 1), { expirationTtl: WINDOW_SEC });
    } catch (e) {
      console.warn('Rate limit KV error:', e.message);
      // Fail open — don't block login if KV is down
    }
  }

  const userInfo = PIN_TEAM[pin];
  if (!userInfo) return json({ success: false, error: 'Invalid PIN' }, 401);

  const secret = env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min';
  const token = await signHS256(
    { sub: 'pin-' + pin, ...userInfo, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 7 },
    secret,
  );

  // Clear rate limit on successful login
  if (env.BFR_KV) {
    try { await env.BFR_KV.delete(rateKey); } catch {}
  }

  return json({ success: true, token, user: { ...userInfo } });
}
