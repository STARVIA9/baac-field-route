// Public staff directory — GET /api/staff
// รายชื่อพนักงานสำหรับหน้า login แบบ "แตะชื่อ + PIN" (ไม่ต้อง login ก่อน)
// คืนเฉพาะ username + ชื่อแสดง + สาขา — ไม่มี hash, ไม่มี PIN

import { BRANCHES as DEFAULT_BRANCHES } from '../_lib/branches.js';

const KV_KEY = 'users:all';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const raw = await env.BFR_KV.get('branches:all');
  const branches = raw ? JSON.parse(raw) : DEFAULT_BRANCHES;

  const usersRaw = await env.BFR_KV.get(KV_KEY);
  const users = usersRaw ? JSON.parse(usersRaw) : [];

  // เฉพาะ staff ที่มี PIN (เข้าแบบแตะชื่อได้) — ซ่อน admin และคนที่โดนลบ
  const staff = users
    .filter(u => !u.deleted && u.role !== 'admin' && u.pinHash)
    .map(u => ({
      username: u.username,
      displayName: u.displayName,
      branch: u.branch,
      branchName: (branches.find(b => b.code === u.branch) || {}).name || u.branch,
    }));

  return json({ success: true, staff });
}
