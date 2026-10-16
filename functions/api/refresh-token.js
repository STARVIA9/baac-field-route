// Token refresh — POST /api/refresh-token
//
// client (vendor.js/auth.js) เรียกทุก 5 นาที เมื่อกุญแจใกล้หมดอายุ (ภายใน 30 นาที)
// ก่อนหน้านี้ไฟล์นี้ไม่มีอยู่ในระบบ → 404 ทุกครั้ง → กุญแจตายเงียบเมื่อครบ 7 วัน
// แล้วแอพหยุดอัปเดตข้อมูลโดยไม่บอกผู้ใช้
//
// รับกุญแจเดิม (ที่ยังไม่หมดอายุ) แล้วออกกุญแจใหม่ให้อีก 7 วัน

import { extractBearerToken, verifyHS256, signHS256 } from '../_lib/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost({ request, env }) {
  const token = extractBearerToken(request);
  if (!token) return json({ success: false, error: 'ไม่พบกุญแจเข้าใช้งาน' }, 401);

  const secret = env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min';
  const payload = await verifyHS256(token, secret);
  if (!payload) return json({ success: false, error: 'กุญแจหมดอายุ กรุณาเข้าสู่ระบบใหม่' }, 401);

  // เปลี่ยนรหัส/PIN แล้ว → กุญแจเก่าต่ออายุไม่ได้ ต้อง login ใหม่ (16 ต.ค.69)
  if (env.BFR_KV) {
    let currentPv = 1;
    if (payload.sub === 'admin-pin') {
      const { getPinVersion } = await import('./admin/pin.js');
      currentPv = await getPinVersion(env.BFR_KV);
    } else if (payload.sub) {
      try {
        const raw = await env.BFR_KV.get('users:all');
        const users = raw ? JSON.parse(raw) : [];
        const u = users.find(x => x.id === payload.sub && !x.deleted);
        if (!u) return json({ success: false, error: 'บัญชีถูกปิดแล้ว กรุณาเข้าสู่ระบบใหม่' }, 401);
        currentPv = u.pwdVersion || 1;
      } catch { /* KV พัง = fail open ให้ต่ออายุได้ (กันล็อกทั้งทีม) */ currentPv = payload.pv || 1; }
    }
    if ((payload.pv || 1) !== currentPv) {
      return json({ success: false, error: 'เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่' }, 401);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const refreshed = { ...payload, iat: now, exp: now + 86400 * 7 };
  const newToken = await signHS256(refreshed, secret);

  return json({
    success: true,
    token: newToken,
    user: {
      id: payload.sub,
      username: payload.username,
      name: payload.name,
      role: payload.role,
      branch: payload.branch,
      branchName: payload.branchName,
    },
  });
}
