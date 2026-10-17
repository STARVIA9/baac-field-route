// PIN vault — เก็บ PIN แบบเข้ารหัส เปิดดูได้เฉพาะแอดมิน (17 ต.ค.69)
// ที่มา: hash ถอดกลับไม่ได้ จึงเก็บซองเข้ารหัส (pinEnc) คู่กับ hash ไว้อ่านคืน
// login ยังเทียบ hash เหมือนเดิม — pinEnc มีไว้ให้แอดมินดู/export เท่านั้น
// กุญแจตู้ = SHA-256(BFR_JWT_SECRET + context) — ไม่ต้องเพิ่ม env ใหม่

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function vaultKey(secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(String(secret) + '|pin-vault-v1|'));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptPin(pin, secret) {
  if (!pin || !secret) throw new Error('missing pin/secret');
  const key = await vaultKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(pin)));
  return b64urlEncode(iv) + '.' + b64urlEncode(new Uint8Array(ct));
}

export async function decryptPin(pinEnc, secret) {
  if (!pinEnc || !secret) return null;
  const parts = String(pinEnc).split('.');
  if (parts.length !== 2) return null;
  const key = await vaultKey(secret);
  const data = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlDecode(parts[0]) }, key, b64urlDecode(parts[1])
  );
  return dec.decode(data);
}
