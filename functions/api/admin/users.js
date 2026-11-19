// Admin user management — /api/admin/users
// GET: list users        — แอดมินกลางเห็นทุกสาขา · ผู้ดูแลสาขาเห็นเฉพาะสาขาตัวเอง
// POST: create user      — ผู้ดูแลสาขาสร้างได้เฉพาะสาขาตัวเอง และได้แค่ role user
// PUT: update user       — ตั้ง/เปลี่ยน PIN, ชื่อ, role, สาขา (ตามสิทธิ์)
// DELETE: soft-delete    — ผู้ดูแลสาขาลบได้เฉพาะพนักงานทั่วไปในสาขาตัวเอง

import { extractBearerToken, verifyHS256, jwtSecret } from '../../_lib/jwt.js';
import { hashPassword, verifyPassword } from '../../_lib/crypto.js';
import { encryptPin, decryptPin } from '../../_lib/pin-vault.js';
import { BRANCHES as DEFAULT_BRANCHES } from '../../_lib/branches.js';
import { isSuper, canManageUsers, sameBranch, scopedBranch, canAssignRole, ROLE_USER, ROLE_BRANCH_ADMIN, ROLE_ADMIN } from '../../_lib/authz.js';

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
  const __secret = jwtSecret(env, request);
  if (!__secret) return { error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ (BFR_JWT_SECRET)' };
  const payload = await verifyHS256(token, __secret);
  if (!payload) return { error: 'Invalid token' };
  return { user: payload };
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ===== GET /api/admin/users — list users in scope =====
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (!canManageUsers(auth.user)) return json({ success: false, error: 'ต้องเป็นแอดมินหรือผู้ดูแลสาขา' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  const raw = await env.BFR_KV.get(KV_KEY);
  const users = raw ? JSON.parse(raw) : [];

  // Load branches from KV for display names (includes admin-added ones)
  const branchList = await loadBranches(env.BFR_KV);

  // Return safe view (no password hashes)
  // + ถอด PIN จากตู้ (pinEnc) ให้แอดมินดูได้ — ของเก่าที่ยังไม่มีซองได้ null (17 ต.ค.69)
  const vault = (() => { try { return jwtSecret(env, request); } catch { return null; } })();
  const scope = scopedBranch(auth.user);
  const safeUsers = [];
  for (const u of users.filter(x => !x.deleted)) {
    // ผู้ดูแลสาขา: เห็นเฉพาะคนในสาขาตัวเอง (กรองฝั่งเซิร์ฟเวอร์เท่านั้น)
    if (scope && u.branch !== scope) continue;
    let pin = null;
    if (u.pinEnc && vault) {
      try { pin = await decryptPin(u.pinEnc, vault); } catch { pin = null; }
    }
    safeUsers.push({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      branch: u.branch,
      branchName: (branchList.find(b => b.code === u.branch) || {}).name || u.branch,
      hasPin: !!u.pinHash,
      pin,
      createdAt: u.createdAt,
    });
  }

  return json({ success: true, users: safeUsers, scope });
}

// ===== POST /api/admin/users — create user =====
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (!canManageUsers(auth.user)) return json({ success: false, error: 'ต้องเป็นแอดมินหรือผู้ดูแลสาขา' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { username, pin, displayName, role } = body;
  let { branch } = body;

  // ผู้ดูแลสาขา: ล็อกสาขาตัวเอง (ไม่สนค่าที่ส่งมา) + สร้างได้แค่ role user
  if (!isSuper(auth.user)) {
    branch = scopedBranch(auth.user);
  }

  // PIN อย่างเดียว (17 ต.ค.69 — เลิกรหัสผ่านตามพ่อสั่ง)
  if (!username || !displayName || !branch || !pin) {
    return json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบ (username, displayName, branch + PIN)' }, 400);
  }
  if (username.length < 3) {
    return json({ success: false, error: 'username ต้องมีอย่างน้อย 3 ตัวอักษร' }, 400);
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

  const wantedRole = role || ROLE_USER;
  if (!canAssignRole(auth.user, wantedRole)) {
    return json({ success: false, error: 'คุณไม่มีสิทธิ์ตั้งสิทธิ์นี้' }, 403);
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

  // Hash PIN อย่างเดียว (17 ต.ค.69 — เลิกรหัสผ่าน)
  // + เก็บซองเข้าตู้ให้แอดมินดูได้ (ถอดไม่ได้ไม่เป็นไร login ยังใช้ hash)
  const pinHash = pin ? await hashPassword(pin) : null;
  let pinEnc = null;
  if (pin) {
    try {
      const vault = jwtSecret(env, request);
      if (vault) pinEnc = await encryptPin(pin, vault);
    } catch {}
  }

  const newUser = {
    id: genId(),
    username,
    password: null,
    pinHash,
    pinEnc,
    pwdVersion: 1, // เปลี่ยนรหัส/PIN → bump → กุญแจเก่าต่ออายุไม่ได้ (16 ต.ค.69)
    displayName,
    role: wantedRole,
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
  if (!canManageUsers(auth.user)) return json({ success: false, error: 'ต้องเป็นแอดมินหรือผู้ดูแลสาขา' }, 403);
  if (!env.BFR_KV) return json({ success: false, error: 'KV not configured' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { id, pin, clearPin, displayName } = body;
  let { role, branch } = body;
  if (!id) return json({ success: false, error: 'ต้องระบุ user id' }, 400);

  const raw = await env.BFR_KV.get(KV_KEY);
  const users = raw ? JSON.parse(raw) : [];
  const idx = users.findIndex(u => u.id === id && !u.deleted);
  if (idx < 0) return json({ success: false, error: 'ไม่พบผู้ใช้' }, 404);

  const target = users[idx];
  const actor = auth.user;
  const self = actor.sub === id;

  // ===== ขอบเขตสิทธิ์ =====
  if (!sameBranch(actor, target)) {
    return json({ success: false, error: 'ผู้ใช้นี้อยู่ต่างสาขา — จัดการไม่ได้' }, 403);
  }
  if (!isSuper(actor)) {
    if (target.role === ROLE_ADMIN) {
      return json({ success: false, error: 'แก้ไขแอดมินกลางไม่ได้' }, 403);
    }
    // ผู้ดูแลสาขาแก้บัญชีผู้ดูแลสาขาคนอื่นไม่ได้ (ตัวเองได้)
    if (target.role === ROLE_BRANCH_ADMIN && !self) {
      return json({ success: false, error: 'แก้ไขผู้ดูแลสาขาคนอื่นไม่ได้' }, 403);
    }
    // ผู้ดูแลสาขาเปลี่ยน role/สาขาใครไม่ได้เลย (แม้ตัวเอง — กันยกระดับสิทธิ์)
    role = undefined;
    branch = undefined;
  }

  // Update fields
  if (displayName) target.displayName = displayName;
  if (role) {
    if (!canAssignRole(actor, role)) return json({ success: false, error: 'คุณไม่มีสิทธิ์ตั้งสิทธิ์นี้' }, 403);
    target.role = role;
  }
  if (branch) {
    const branchList = await loadBranches(env.BFR_KV);
    if (!branchList.find(b => b.code === branch)) {
      return json({ success: false, error: `สาขา "${branch}" ไม่ถูกต้อง` }, 400);
    }
    target.branch = branch;
  }
  // (รหัสผ่านเลิกใช้แล้ว 17 ต.ค.69 — ส่ง password มาถูกเฉย)
  // ตั้ง/เปลี่ยน PIN staff — เช็คซ้ำยกเว้นตัวเอง, clearPin=true = ปิด login ด้วย PIN
  if (pin) {
    if (!/^\d{4,8}$/.test(pin)) return json({ success: false, error: 'PIN ต้องเป็นตัวเลข 4-8 หลัก' }, 400);
    for (const u of users) {
      if (u.deleted || u.id === id || !u.pinHash) continue;
      if (await verifyPassword(pin, u.pinHash)) {
        return json({ success: false, error: 'PIN นี้มีคนใช้แล้ว กรุณาใช้เลขอื่น' }, 409);
      }
    }
    target.pinHash = await hashPassword(pin);
    try {
      const vault = jwtSecret(env, request);
      target.pinEnc = vault ? await encryptPin(pin, vault) : null;
    } catch { target.pinEnc = null; }
    target.pwdVersion = (target.pwdVersion || 1) + 1; // กุญแจเก่าต่ออายุไม่ได้
  } else if (clearPin) {
    if (!isSuper(actor) && !self) {
      return json({ success: false, error: 'ปิด PIN ของคนอื่นไม่ได้' }, 403);
    }
    delete target.pinHash;
    delete target.pinEnc;
  }

  await env.BFR_KV.put(KV_KEY, JSON.stringify(users));

  return json({ success: true });
}

// ===== DELETE /api/admin/users — soft-delete user =====
export async function onRequestDelete(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (!canManageUsers(auth.user)) return json({ success: false, error: 'ต้องเป็นแอดมินหรือผู้ดูแลสาขา' }, 403);
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

  const target = users[idx];
  if (!sameBranch(auth.user, target)) {
    return json({ success: false, error: 'ผู้ใช้นี้อยู่ต่างสาขา — ลบไม่ได้' }, 403);
  }
  // ผู้ดูแลสาขา: ลบได้เฉพาะพนักงานทั่วไป (ไม่แตะแอดมิน/ผู้ดูแลสาขาคนอื่น)
  if (!isSuper(auth.user) && target.role !== ROLE_USER) {
    return json({ success: false, error: 'ลบได้เฉพาะพนักงานทั่วไป' }, 403);
  }

  target.deleted = true;
  target.deletedAt = new Date().toISOString();
  await env.BFR_KV.put(KV_KEY, JSON.stringify(users));

  return json({ success: true });
}
