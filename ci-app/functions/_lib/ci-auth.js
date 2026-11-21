// .shared: session token สำหรับ CI admin (HMAC, ไม่มีตัวแปรลับในโค้ด)
const COOKIE = 'ci_sid';
const enc = new TextEncoder();

function secret(env) {
  const s = env?.CI_SESSION_SECRET;
  if (!s || String(s).length < 16) throw new Error('เซิร์ฟเวอร์ยังไม่ได้ตั้ง CI_SESSION_SECRET');
  return String(s);
}
async function key(env) {
  return crypto.subtle.importKey('raw', enc.encode(secret(env)), 'HMAC', false, ['sign', 'verify']);
}
function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export async function makeToken(env, branch, ttlSec = 3600) {
  const payload = `${branch}|${Math.floor(Date.now() / 1000) + ttlSec}`;
  const sig = await crypto.subtle.sign('HMAC', await key(env), enc.encode(payload));
  return `${payload}|${b64u(sig)}`;
}

export async function verifyToken(env, token) {
  try {
    const p = String(token || '').split('|');
    if (p.length !== 3 || !/^\d+$/.test(p[1])) return null;
    if (Number(p[1]) < Math.floor(Date.now() / 1000)) return null;
    const ok = await crypto.subtle.verify('HMAC', await key(env), unb64u(p[2]), enc.encode(`${p[0]}|${p[1]}`));
    return ok ? { branch: p[0] } : null;
  } catch { return null; }
}

export function readSession(request) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(/(?:^|;\s*)ci_sid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
export function cookieHeader(token) {
  return `ci_sid=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`;
}
export function clearCookieHeader() {
  return 'ci_sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}
