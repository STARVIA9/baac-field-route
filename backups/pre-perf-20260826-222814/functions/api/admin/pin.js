// Admin PIN management — /api/admin/pin
// POST: change admin PIN (requires current PIN + new PIN)

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';
import { hashPassword, verifyPassword } from '../../_lib/crypto.js';

const KV_KEY = 'admin:pin';
const DEFAULT_PIN = '7531'; // Default admin PIN (more secure than 0000)

// ⚠️ PRE-COMPUTED PBKDF2 hash (500 iterations) of '7531'.
// Same reasoning as login.js: avoid PBKDF2 at runtime on fresh deploy.
// Regenerate if you change DEFAULT_PIN.
const DEFAULT_PIN_HASH = '500.qAdEUmySHWOuc7EOoX5m36HeAY80ApKb_9es2NerJHU.dF5b5JthfU2yDfX0zbG1q54AxGqx1ATzO2Y7alvmeQ8.dIuNUmrVfk4lwPcwrn_kiLyzAOc19xTZLZH6M5pGWKg';

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

/**
 * Get admin PIN hash from KV (or seed default).
 * Stores as a password hash so the PIN is never plain text in KV.
 */
async function getAdminPinHash(kv) {
  const raw = await kv.get(KV_KEY);
  if (raw) return raw;
  // Seed default PIN using pre-computed hash — no PBKDF2 at runtime
  await kv.put(KV_KEY, DEFAULT_PIN_HASH);
  return DEFAULT_PIN_HASH;
}

/**
 * Verify admin PIN against stored hash.
 */
export async function verifyAdminPin(pin, kv) {
  const stored = await getAdminPinHash(kv);
  return verifyPassword(pin, stored);
}

// ===== POST /api/admin/pin — change admin PIN =====
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { currentPin, newPin } = body;
  if (!currentPin || !newPin) {
    return json({ success: false, error: 'กรุณากรอก PIN ปัจจุบันและ PIN ใหม่' }, 400);
  }
  if (newPin.length < 4 || newPin.length > 8) {
    return json({ success: false, error: 'PIN ใหม่ต้อง 4-8 หลัก' }, 400);
  }
  if (currentPin === newPin) {
    return json({ success: false, error: 'PIN ใหม่ต้องต่างจาก PIN ปัจจุบัน' }, 400);
  }

  // Verify current PIN
  const valid = await verifyAdminPin(currentPin, env.BFR_KV);
  if (!valid) {
    return json({ success: false, error: 'PIN ปัจจุบันไม่ถูกต้อง' }, 401);
  }

  // Hash new PIN and save
  const newHash = await hashPassword(newPin);
  await env.BFR_KV.put(KV_KEY, newHash);

  return json({ success: true, message: 'เปลี่ยน PIN สำเร็จ' });
}

// ===== GET — check if admin PIN is set (for UI hint) =====
export async function onRequestGet(context) {
  const { env } = context;
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const raw = await env.BFR_KV.get(KV_KEY);
  return json({ success: true, isDefault: !raw });
}
