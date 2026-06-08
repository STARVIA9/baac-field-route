// Auth handler — POST /api/login
// Supports: username/password (KV users) + admin PIN (KV) + legacy team PINs

import { signHS256 } from '../_lib/jwt.js';
import { verifyPassword } from '../_lib/crypto.js';
import { BRANCHES as DEFAULT_BRANCHES } from '../_lib/branches.js';
import { verifyAdminPin } from './admin/pin.js';

// Legacy team PINs (non-admin offline fallback)
const PIN_TEAM = {
  '1001': { name: 'สมชาย ใจดี', role: 'user', branch: 'WTC' },
  '1002': { name: 'สมหญิง รักไทย', role: 'user', branch: 'WTC' },
  '1003': { name: 'ประยุทธ์ มั่นคง', role: 'user', branch: 'WTC' },
  '1004': { name: 'มาลี สดใส', role: 'user', branch: 'WTC' },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Get branch name from KV (with fallback to defaults)
async function getBranchName(code, kv) {
  if (!kv) {
    const b = DEFAULT_BRANCHES.find(x => x.code === code);
    return b ? b.name : code;
  }
  const raw = await kv.get('branches:all');
  const branches = raw ? JSON.parse(raw) : DEFAULT_BRANCHES;
  const b = branches.find(x => x.code === code);
  return b ? b.name : code;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { username, password, pin } = body;

  // ===== Username/password login (primary) =====
  if (username && password) {
    if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

    const usersRaw = await env.BFR_KV.get('users:all');
    const users = usersRaw ? JSON.parse(usersRaw) : [];
    const user = users.find(u => u.username === username && !u.deleted);

    if (!user) return json({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401);

    const valid = await verifyPassword(password, user.password);
    if (!valid) return json({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401);

    const secret = env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min';
    const branchName = await getBranchName(user.branch, env.BFR_KV);
    const tokenPayload = {
      sub: user.id,
      username: user.username,
      name: user.displayName,
      role: user.role,
      branch: user.branch,
      branchName,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400 * 7,
    };
    const token = await signHS256(tokenPayload, secret);

    return json({
      success: true,
      token,
      user: { id: user.id, username: user.username, name: user.displayName, role: user.role, branch: user.branch, branchName },
    });
  }

  // ===== PIN login =====
  if (pin) {
    // Check admin PIN from KV first
    if (env.BFR_KV) {
      const adminValid = await verifyAdminPin(pin, env.BFR_KV);
      if (adminValid) {
        const secret = env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min';
        const branchName = await getBranchName('WTC', env.BFR_KV);
        const tokenPayload = {
          sub: 'admin-pin',
          username: 'admin',
          name: 'Admin',
          role: 'admin',
          branch: 'WTC',
          branchName,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 86400 * 7,
        };
        const token = await signHS256(tokenPayload, secret);
        return json({ success: true, token, user: { username: 'admin', name: 'Admin', role: 'admin', branch: 'WTC', branchName } });
      }
    }

    // Fallback: legacy team PINs
    const userInfo = PIN_TEAM[pin];
    if (!userInfo) return json({ success: false, error: 'PIN ไม่ถูกต้อง' }, 401);

    const secret = env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min';
    const branchName = await getBranchName(userInfo.branch, env.BFR_KV);
    const token = await signHS256(
      { pin, ...userInfo, branchName, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 * 7 },
      secret,
    );
    return json({ success: true, token, user: { pin, ...userInfo, branchName } });
  }

  return json({ success: false, error: 'กรุณากรอก username+password หรือ PIN' }, 400);
}
