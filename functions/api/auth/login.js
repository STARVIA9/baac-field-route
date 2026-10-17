// Auth handler — POST /api/auth/login (legacy fallback)
// 17 ต.ค.69 — เลิกรหัสผ่าน เหลือ PIN อย่างเดียว: endpoint นี้ตอบแค่ข้อความบอกให้ใช้ PIN
// Rate-limited: max 10 attempts per IP per 15 minutes (KV-based)

const MAX_ATTEMPTS = 10;
const WINDOW_SEC = 15 * 60;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { username, password, pin } = body;

  // Rate limiting via KV (per IP)
  // ponytail/security (16 ต.ค.69): เชื่อ cf-connecting-ip อย่างเดียว — x-forwarded-for ปลอมได้
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rateKey = `ratelimit:authlogin:${ip}`;
  if (env.BFR_KV) {
    try {
      const raw = await env.BFR_KV.get(rateKey);
      const attempts = raw ? parseInt(raw, 10) : 0;
      if (attempts >= MAX_ATTEMPTS) {
        return json({ success: false, error: `พยายามเกิน ${MAX_ATTEMPTS} ครั้ง กรุณารอ 15 นาที` }, 429);
      }
      await env.BFR_KV.put(rateKey, String(attempts + 1), { expirationTtl: WINDOW_SEC });
    } catch (e) { /* fail open */ }
  }

  // ===== Username/password — ลบแล้ว (17 ต.ค.69 เหลือ PIN อย่างเดียว) =====
  if (username && password) {
    return json({ success: false, error: 'เลิกใช้รหัสผ่านแล้ว — กรุณาเข้าใช้งานด้วย PIN' }, 400);
  }

  // ===== PIN (ทางเข้าเดียว) =====
  if (pin) {
    return json({ success: false, error: 'กรุณาเข้าใช้งานด้วย PIN ที่หน้าแรก' }, 400);
  }

  return json({ success: false, error: 'กรุณาเข้าใช้งานด้วย PIN ที่หน้าแรก' }, 400);
}