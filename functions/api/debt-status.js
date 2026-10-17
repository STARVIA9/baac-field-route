// GET/POST /api/debt-status — ที่เก็บกลางเว็บติดตามหนี้ (5 คน)
// เก็บที่ KV key เดียว: debt:status:v1 (object {key: {st, note, by, at}})
// auth: ต้องมี JWT จาก /api/login (admin PIN 3117 ล็อกอินได้อยู่แล้ว)
import { json, authCheck } from '../_lib/shared.js';

const KEY = 'debt:status:v1';

export async function onRequestGet({ request, env }) {
  const a = await authCheck(request, env);
  if (a.error) return json({ error: 'unauthorized' }, 401);
  let data = {};
  try {
    data = JSON.parse((await env.BFR_KV.get(KEY)) || '{}');
  } catch (e) { data = {}; }
  return json({ data });
}

export async function onRequestPost({ request, env }) {
  const a = await authCheck(request, env);
  if (a.error) return json({ error: 'unauthorized' }, 401);
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const inc = body.data || {};
  const keys = Object.keys(inc);
  // กันยิงก้อนยักษ์ทับคลัง (KV write 1 ครั้ง/POST — ก้อนใหญ่ = กระตุกทั้งทีม)
  if (keys.length > 500) return json({ error: 'ส่งได้ครั้งละไม่เกิน 500 รายการ' }, 400);
  let cur = {};
  try {
    cur = JSON.parse((await env.BFR_KV.get(KEY)) || '{}');
  } catch (e) { cur = {}; }
  const who = a.user?.username || a.user?.sub || 'team';
  const now = new Date().toISOString();
  for (const k of keys) {
    if (k.length > 64) continue;
    const v = inc[k] || {};
    cur[k] = {
      st: String(v.st || '').slice(0, 20),
      note: String(v.note || '').slice(0, 500),
      by: String(v.by || who).slice(0, 60),
      at: now,
    };
  }
  await env.BFR_KV.put(KEY, JSON.stringify(cur));
  return json({ ok: true, n: Object.keys(cur).length });
}
