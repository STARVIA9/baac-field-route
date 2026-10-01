// Admin user management — /api/admin/users
// GET: list all users (admin only)
// POST: create user (admin only)
// PUT: update user (admin only)
// DELETE: delete user (admin only)

import { extractBearerToken, verifyHS256 } from '../../_lib/jwt.js';
import { hashPassword, verifyPassword } from '../../_lib/crypto.js';
import { BRANCHES as DEFAULT_BRANCHES } from '../../_lib/branches.js';

const KV_KEY = 'users:all';
const BRANCHES_KV_KEY = 'branches:all';

// Load branches from KV (includes admin-added branches), fallback to defaults
async function loadBranches(kv) {
  if (!kv) return DEFAULT_BRANCHES;
  const raw = await kv.get(BRANCHES_KV_KEY);
  if (raw) return JSON.parse(raw);
  return DEFAULT_BRANCHES;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function authCheck(request, env) {
  const token = extractBearerToken(request);
  if (!token) return { error: 'No token' };
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return { error: 'Invalid token' };
  return { user: payload };
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ===== GET /api/admin/users — list all users =====
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const raw = await env.BFR_KV.get(KV_KEY);
  const users = raw ? JSON.parse(raw) : [];

  // Load branches from KV for display names (includes admin-added ones)
  const branchList = await loadBranches(env.BFR_KV);

  // Return safe view (no password hashes)
  const safeUsers = users
    .filter(u => !u.deleted)
    .map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      branch: u.branch,
      branchName: (branchList.find(b => b.code === u.branch) || {}).name || u.branch,
      hasPin: !!u.pinHash,
      createdAt: u.createdAt,
    }));

  return json({ success: true, users: safeUsers });
}

// ===== POST /api/admin/users — create user =====
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { username, password, pin, displayName, role, branch } = body;

  // Validate — ต้องมี password หรือ pin อย่างใดอย่างหนึ่ง (staff ใช้ pin, admin ใช้ password)
  if (!username || !displayName || !branch || (!password && !pin)) {
    return json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบ (username, displayName, branch + password หรือ PIN)' }, 400);
  }
  if (username.length < 3) {
    return json({ success: false, error: 'username ต้องมีอย่างน้อย 3 ตัวอักษร' }, 400);
  }
  if (password && password.length < 4) {
    return json({ success: false, error: 'password ต้องมีอย่างน้อย 4 ตัวอักษร' }, 400);
  }
  // ponytail: staff PIN = ตัวเลข 4-8 หลักเท่านั้น (กดง่ายบนมือถือ)
  if (pin && !/^\d{4,8}$/.test(pin)) {
    return json({ success: false, error: 'PIN ต้องเป็นตัวเลข 4-8 หลัก' }, 400);
  }
  // Validate branch against KV branches (includes admin-added ones)
  const branches = await loadBranches(env.BFR_KV);
  if (!branches.find(b => b.code === branch)) {
    return json({ success: false, error: `สาขา "${branch}" ไม่ถูกต้อง` }, 400);
  }

  // Check duplicate username
  const raw = await env.BFR_KV.get(KV_KEY);
  const users = raw ? JSON.parse(raw) : [];
  if (users.find(u => u.username === username && !u.deleted)) {
    return json({ success: false, error: `ชื่อผู้ใช้ "${username}" มีอยู่แล้ว` }, 409);
  }

  // Check duplicate PIN — hash มี salt เลยเทียบตรงไม่ได้ ต้อง verify ทีละคน (staff ไม่เยอะ ทำได้)
  if (pin) {
    for (const u of users) {
      if (u.deleted || !u.pinHash) continue;
      if (await verifyPassword(pin, u.pinHash)) {
        return json({ success: false, error: 'PIN นี้มีคนใช้แล้ว กรุณาใช้เลขอื่น' }, 409);
      }
    }
  }

  // Hash password และ/หรือ PIN
  const passwordHash = password ? await hashPassword(password) : null;
  const pinHash = pin ? await hashPassword(pin) : null;

  const newUser = {
    id: genId(),
    username,
    password: passwordHash,
    pinHash,
    displayName,
    role: role === 'admin' ? 'admin' : 'user',
    branch,
    createdAt: new Date().toISOString(),
    deleted: false,
  };

  users.push(newUser);
  await env.BFR_KV.put(KV_KEY, JSON.stringify(users));

  return json({
    success: true,
    user: { id: newUser.id, username, displayName, role: newUser.role, branch },
  }, 201);
}

// ===== PUT /api/admin/users — update user =====
export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { id, password, pin, clearPin, displayName, role, branch } = body;
  if (!id) return json({ success: false, error: 'ต้องระบุ user id' }, 400);

  const raw = await env.BFR_KV.get(KV_KEY);
  const users = raw ? JSON.parse(raw) : [];
  const idx = users.findIndex(u => u.id === id && !u.deleted);
  if (idx < 0) return json({ success: false, error: 'ไม่พบผู้ใช้' }, 404);

  // Update fields
  if (displayName) users[idx].displayName = displayName;
  if (role) users[idx].role = role === 'admin' ? 'admin' : 'user';
  if (branch) {
    const branchList = await loadBranches(env.BFR_KV);
    if (branchList.find(b => b.code === branch)) users[idx].branch = branch;
  }
  if (password && password.length >= 4) users[idx].password = await hashPassword(password);
  // ตั้ง/เปลี่ยน PIN staff — เช็คซ้ำยกเว้นตัวเอง, clearPin=true = ปิด login ด้วย PIN
  if (pin) {
    if (!/^\d{4,8}$/.test(pin)) return json({ success: false, error: 'PIN ต้องเป็นตัวเลข 4-8 หลัก' }, 400);
    for (const u of users) {
      if (u.deleted || u.id === id || !u.pinHash) continue;
      if (await verifyPassword(pin, u.pinHash)) {
        return json({ success: false, error: 'PIN นี้มีคนใช้แล้ว กรุณาใช้เลขอื่น' }, 409);
      }
    }
    users[idx].pinHash = await hashPassword(pin);
  } else if (clearPin) {
    delete users[idx].pinHash;
  }

  await env.BFR_KV.put(KV_KEY, JSON.stringify(users));

  return json({ success: true });
}

// ===== DELETE /api/admin/users — soft-delete user =====
export async function onRequestDelete(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { id } = body;
  if (!id) return json({ success: false, error: 'ต้องระบุ user id' }, 400);

  // Prevent deleting yourself
  if (auth.user.sub === id) {
    return json({ success: false, error: 'ไม่สามารถลบตัวเองได้' }, 400);
  }

  const raw = await env.BFR_KV.get(KV_KEY);
  const users = raw ? JSON.parse(raw) : [];
  const idx = users.findIndex(u => u.id === id && !u.deleted);
  if (idx < 0) return json({ success: false, error: 'ไม่พบผู้ใช้' }, 404);

  users[idx].deleted = true;
  users[idx].deletedAt = new Date().toISOString();
  await env.BFR_KV.put(KV_KEY, JSON.stringify(users));

  return json({ success: true });
}
