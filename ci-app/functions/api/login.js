// POST /api/login — PIN ประจำสาขาเทียบกับ KV ci:admins (fail-closed)
import { makeToken, cookieHeader } from '../_lib/ci-auth.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' }
});

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'ข้อมูลไม่ถูกต้อง' }, 400); }
  const branch = String(body.branch || '').trim();
  const pin = String(body.pin || '').trim();
  if (!branch || !pin) return json({ ok: false, error: 'กรอกสาขาและ PIN' }, 400);

  let raw = null;
  try { raw = env.BAAC_CI_KV ? await env.BAAC_CI_KV.get('ci:admins') : null; } catch { /* fail closed */ }
  if (!raw) return json({ ok: false, error: 'ยังไม่ได้ตั้ง PIN เจ้าหน้าที่สาขา (KV ci:admins)' }, 503);
  let pins;
  try { pins = JSON.parse(raw); } catch { return json({ ok: false, error: 'ข้อมูล PIN เสียหาย' }, 503); }
  if (String(pins[branch] || '') !== pin) return json({ ok: false, error: 'PIN หรือสาขาไม่ถูกต้อง' }, 401);

  let token;
  try { token = await makeToken(env, branch); }
  catch (e) { return json({ ok: false, error: e.message }, 500); }
  return new Response(JSON.stringify({ ok: true, branch }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookieHeader(token) }
  });
}
