// Debt KV backup list + restore — GET/POST /api/admin/debt-restore (admin only)
// ระบบกันหาย (17 ต.ค.69): ทุกครั้งที่อัพหนี้ สำรองคลังเดิมไว้ที่ debt:data:backup:YYYY-MM-DD
// กู้คืน = คัดลอกสำรองทับ debt:data กลับ (ข้อมูลไม่มีวันหายถาวร)

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function checkAdmin(request, env) {
  const token = extractBearerToken(request);
  if (!token) return 'No token';
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return 'Invalid token';
  if (payload.role !== 'admin') return 'ต้องเป็น Admin เท่านั้น';
  return null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const err = await checkAdmin(request, env);
  if (err) return json({ success: false, error: err }, err === 'No token' || err === 'Invalid token' ? 401 : 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV ไม่พร้อม' }, 500);
  const listed = await env.BFR_KV.list({ prefix: 'debt:data:backup:' });
  const backups = (listed.keys || []).map(k => k.name.replace('debt:data:backup:', '')).sort().reverse();
  const updated = await env.BFR_KV.get('debt:updated');
  let current = 0;
  try { current = JSON.parse((await env.BFR_KV.get('debt:data')) || '[]').length; } catch (e) { current = 0; }
  return json({ success: true, backups, current, updated });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const err = await checkAdmin(request, env);
  if (err) return json({ success: false, error: err }, err === 'No token' || err === 'Invalid token' ? 401 : 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV ไม่พร้อม' }, 500);
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const date = String(body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ success: false, error: 'ระบุวันที่สำรอง (YYYY-MM-DD)' }, 400);
  const raw = await env.BFR_KV.get('debt:data:backup:' + date);
  if (!raw) return json({ success: false, error: 'ไม่พบสำรองวันที่ ' + date }, 404);
  let rows = [];
  try { rows = JSON.parse(raw); } catch (e) { return json({ success: false, error: 'ไฟล์สำรองเสีย' }, 500); }
  // กันก่อนทับ: สำรองสภาพปัจจุบันไว้อีกชั้น (กู้คืนผิดรอบก็ย้อนได้)
  const cur = await env.BFR_KV.get('debt:data');
  if (cur) await env.BFR_KV.put('debt:data:backup:pre-restore-' + new Date().toISOString().slice(0, 10), cur);
  await env.BFR_KV.put('debt:data', raw);
  await env.BFR_KV.put('debt:updated', new Date().toISOString());
  return json({ success: true, restored: rows.length, from: date });
}
