// Branch list — GET /api/branches (public, for login form dropdown)
// Reads from KV (seeded with defaults on first admin access)

import { BRANCHES as DEFAULT_BRANCHES } from '../_lib/branches.js';

export async function onRequestGet(context) {
  const { env } = context;
  let branches = DEFAULT_BRANCHES;

  if (env.BFR_KV) {
    const raw = await env.BFR_KV.get('branches:all');
    if (raw) branches = JSON.parse(raw);
  }

  return new Response(JSON.stringify({ success: true, branches }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
