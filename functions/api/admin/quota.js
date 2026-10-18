// Quota dashboard — GET /api/admin/quota (admin only)
// โควต้าเขียน D1 วันนี้ (กันล็อก 100,000 แถว/วัน) — อ่านอย่างเดียว ไม่นับโควต้า

import { extractBearerToken, verifyHS256, jwtSecret } from '../../_lib/jwt.js';
import { getWriteBudget } from '../../_lib/shared.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// สุขภาพระบบ (เฟส 0): ตัวเลขรวมจาก D1 ชุดเดียว เก็บแคช KV 10 นาที
// → เปิดแท็บสุขภาพกี่ครั้งก็อ่าน D1 จริงไม่เกิน 1 ครั้ง/10 นาที (?force=1 ข้ามแคช)
const HEALTH_KEY = 'health:cache';
const HEALTH_TTL_MS = 10 * 60 * 1000;

export async function getHealth(env, force = false) {
  try {
    if (!force && env?.BFR_KV) {
      const raw = await env.BFR_KV.get(HEALTH_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && Date.now() - c.ts < HEALTH_TTL_MS) return { ...c.data, cached: true, cacheAgeSec: Math.round((Date.now() - c.ts) / 1000) };
      }
    }
    if (!env?.BFR_DB) return null;
    const { results } = await env.BFR_DB.prepare(
      `SELECT branch AS branch, COUNT(*) AS total,
              SUM(CASE WHEN lat IS NOT NULL AND lng IS NOT NULL AND lat != '' AND lng != '' THEN 1 ELSE 0 END) AS gps,
              SUM(CASE WHEN debt_balance IS NOT NULL AND debt_balance != '' THEN 1 ELSE 0 END) AS debt,
              MAX(updated_at) AS lastUpdated
         FROM customers WHERE deleted = 0 GROUP BY branch ORDER BY branch`
    ).all();
    const branches = (results || []).map(r => ({
      branch: r.branch || '', total: r.total || 0, gps: r.gps || 0, debt: r.debt || 0,
      gpsPct: r.total ? Math.round(((r.gps || 0) / r.total) * 1000) / 10 : 0,
      lastUpdated: r.lastUpdated || '',
    }));
    const data = {
      branches,
      total: branches.reduce((s, b) => s + b.total, 0),
      gps: branches.reduce((s, b) => s + b.gps, 0),
      debt: branches.reduce((s, b) => s + b.debt, 0),
      at: new Date().toISOString(),
    };
    data.gpsPct = data.total ? Math.round((data.gps / data.total) * 1000) / 10 : 0;
    if (env?.BFR_KV) await env.BFR_KV.put(HEALTH_KEY, JSON.stringify({ ts: Date.now(), data }));
    return { ...data, cached: false, cacheAgeSec: 0 };
  } catch (e) { console.warn('getHealth skip:', e.message); return null; }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const token = extractBearerToken(request);
  if (!token) return json({ success: false, error: 'No token' }, 401);
  const __secret = jwtSecret(env, request);
  if (!__secret) return json({ success: false, error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ (BFR_JWT_SECRET)' }, 500);
  const payload = await verifyHS256(token, __secret);
  if (!payload) return json({ success: false, error: 'Invalid token' }, 401);
  if (payload.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);

  const force = new URL(request.url).searchParams.get('force') === '1';
  const [quota, health] = await Promise.all([getWriteBudget(env), getHealth(env, force)]);
  return json({ success: true, quota, health });
}
