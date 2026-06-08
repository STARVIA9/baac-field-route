// Branch list — GET /api/branches

import { BRANCHES } from '../../_lib/branches.js';

export async function onRequestGet() {
  return new Response(JSON.stringify({ success: true, branches: BRANCHES }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
