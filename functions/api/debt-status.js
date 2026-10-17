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
  let cur = {};
  try {
    cur = JSON.parse((await env.BFR_KV.get(KEY)) || '{}');
  } catch (e) { cur = {}; }
  const who = a.user?.username || a.user?.sub || 'team';
  const now = new Date().toISOString();
  for (const k of Object.keys(inc)) {
    cur[k] = { ...inc[k], by: inc[k].by || who, at: now };
  }
  await env.BFR_KV.put(KEY, JSON.stringify(cur));
  return json({ ok: true, n: Object.keys(cur).length });
}
