// ===== Password hashing — PBKDF2-SHA256 via Web Crypto =====
// 500 iterations (reduced from 100K): CF Workers free tier has 10ms CPU limit.
// 100K iterations was causing "Worker exceeded resource limits" (503) on every deploy.
// For internal BAAC tool, 500 iterations + unique salt is adequate.
// When changing this value: pre-compute new DEFAULT_ADMIN_HASH and DEFAULT_PIN_HASH below.

const ITERATIONS = 500;
const KEY_LEN = 64; // bytes (32 auth + 32 verification)
const DIGEST = 'SHA-256';

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: DIGEST },
    keyMaterial, KEY_LEN * 8,
  );
}

/**
 * Hash a password → "iterations.salt_base64url.key_base64url"
 * Store this string in KV.
 */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const derived = await deriveKey(password, salt);
  const authKey = derived.slice(0, 32);
  const verifyKey = derived.slice(32, 64);
  return [
    ITERATIONS,
    base64UrlEncode(salt),
    base64UrlEncode(authKey),
    base64UrlEncode(verifyKey),
  ].join('.');
}

/**
 * Verify a password against a stored hash string.
 * Returns true if match, false otherwise.
 */
export async function verifyPassword(password, stored) {
  try {
    const [iterStr, saltB64, authB64, verifyB64] = stored.split('.');
    const iterations = parseInt(iterStr, 10);
    const salt = base64UrlDecode(saltB64);
    const expectedAuth = base64UrlDecode(authB64);
    const expectedVerify = base64UrlDecode(verifyB64);

    const derived = await deriveKey(password, salt);
    const authKey = derived.slice(0, 32);
    const verifyKey = derived.slice(32, 64);

    // Constant-time comparison
    const authMatch = crypto.subtle.timingSafeEqual
      ? crypto.subtle.timingSafeEqual(authKey, expectedAuth)
      : authKey.every((b, i) => b === expectedAuth[i]);
    const verifyMatch = crypto.subtle.timingSafeEqual
      ? crypto.subtle.timingSafeEqual(verifyKey, expectedVerify)
      : verifyKey.every((b, i) => b === expectedVerify[i]);

    return authMatch && verifyMatch;
  } catch {
    return false;
  }
}
