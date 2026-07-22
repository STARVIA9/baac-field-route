// JWT helper for BAAC Field Route (HS256 via Web Crypto)

async function getKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

// UTF-8 safe base64url encode (works in both browser + Node + Workers)
// Uses TextEncoder to convert string → UTF-8 bytes first, then base64
function base64UrlEncode(input) {
  // Convert string to UTF-8 bytes
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  // Convert bytes to binary string for btoa
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export async function signHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const message = `${headerB64}.${payloadB64}`;
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const sigB64 = base64UrlEncode(String.fromCharCode(...new Uint8Array(sig)));
  return `${message}.${sigB64}`;
}

export async function verifyHS256(token, secret) {
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const enc = new TextEncoder();
    const message = `${headerB64}.${payloadB64}`;
    const key = await getKey(secret);
    const sig = Uint8Array.from(base64UrlDecode(sigB64), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sig, enc.encode(message));
    if (!valid) return null;
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function extractBearerToken(request) {
  const auth = request.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
