// Auth handler — POST /api/auth/login

import { signHS256 } from '../../_lib/jwt.js';

const PIN_TEAM = {
  '0000': { name: 'Admin', role: 'admin' },
  '1001': { name: 'สมชาย ใจดี', role: 'user' },
  '1002': { name: 'สมหญิง รักไทย', role: 'user' },
  '1003': { name: 'ประยุทธ์ มั่นคง', role: 'user' },
  '1004': { name: 'มาลี สดใส', role: 'user' },
};

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

  const userInfo = PIN_TEAM[pin];
  if (!userInfo) return json({ success: false, error: 'Invalid PIN' }, 401);

  const secret = env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min';
  const token = await signHS256(
    { pin, ...userInfo, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 7 },
    secret,
  );

  return json({ success: true, token, user: { pin, ...userInfo } });
}
