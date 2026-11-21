// GET /api/session — ตรวจว่ายังล็อกอินอยู่หรือไม่
import { readSession, verifyToken } from '../_lib/ci-auth.js';

export async function onRequestGet({ request, env }) {
  let session = null;
  try { session = await verifyToken(env, readSession(request)); } catch { /* fail closed */ }
  return new Response(JSON.stringify({ ok: !!session, branch: session?.branch || null }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
