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
  '1003': { name: 'ประยูทธ์ มั่นคง', role: 'user', branch: 'WTC' },
  '1004': { name: 'มาลี สดใส', role: 'user', branch: 'WTC' },
};

// Default admin user (seeded into KV if missing) — survives total KV wipe
// ⚠️ PRE-COMPUTED PBKDF2 hash (500 iterations) of 'admin1234'.
// This eliminates the "Worker exceeded resource limits" 503 on fresh deploy
// because no PBKDF2 runs at runtime during seed. If you change DEFAULT_ADMIN.password,
// regenerate this hash with: node -e "crypto.pbkdf2Sync(...)" and update below.
const DEFAULT_ADMIN_HASH = '500.R8a6ojXPiGLTsYLF7TSLGnHynomzOqNi-xpT366Y3GY._gZIc2kKe2p5N6WqPDvSPSfUgzhFIEhAAKMwPaCBg2I.jwnbz6XjwdQZgBFI6oict8gsWSvHP_-KAwDj_wjg1hM';

const DEFAULT_ADMIN = {
  username: 'admin',
  displayName: 'Admin',
  password: DEFAULT_ADMIN_HASH, // Pre-computed hash — no PBKDF2 at runtime
  role: 'admin',
  branch: 'WTC',
};

/**
 * Idempotent seed — if KV has no `users:all`, write default admin.
 * Also migrates existing admin user's password hash if it's using
 * the old 100K-iteration format (which caused Worker CPU timeout).
 * Uses pre-computed hash so PBKDF2 runs ZERO times during login.
 */
async function seedDefaultAdminIfMissing(kv) {
  const raw = await kv.get('users:all');
  if (raw) {
    // Check if existing admin needs hash migration (old 100K → new 500)
    const users = JSON.parse(raw);
    let needsUpdate = false;
    for (const u of users) {
      if (u.username === 'admin' && u.password && u.password !== DEFAULT_ADMIN_HASH) {
        // Old hash format detected — upgrade to pre-computed hash
        u.password = DEFAULT_ADMIN_HASH;
        u.updatedAt = new Date().toISOString();
        needsUpdate = true;
        console.log('[login] Migrated admin password hash to pre-computed 500-iter hash');
      }
    }
    if (needsUpdate) {
      await kv.put('users:all', JSON.stringify(users));
    }
    return; // Already seeded
  }
  // KV empty — seed with pre-computed hash
  const user = {
    id: 'admin',
    username: DEFAULT_ADMIN.username,
    displayName: DEFAULT_ADMIN.displayName,
    password: DEFAULT_ADMIN_HASH,
    role: DEFAULT_ADMIN.role,
    branch: DEFAULT_ADMIN.branch,
    createdAt: new Date().toISOString(),
  };
  await kv.put('users:all', JSON.stringify([user]));
  console.log('[login] Seeded default admin (KV was empty) — used pre-computed hash, 0 PBKDF2');
}

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

    // Self-heal: seed default admin if KV was wiped
    await seedDefaultAdminIfMissing(env.BFR_KV);

    const usersRaw = await env.BFR_KV.get('users:all');
    const users = usersRaw ? JSON.parse(usersRaw) : [];
    const user = users.find(u => u.username === username && !u.deleted);

    if (!user) return json({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, 401);

    // Verify password inside try/catch — if PBKDF2 ever throws (corrupt hash, etc.)
    // surface as 401 (not 500) so the frontend can fallback to PIN instead.
    let valid = false;
    try {
      valid = await verifyPassword(password, user.password);
    } catch (e) {
      console.error('[login] verifyPassword crashed:', e?.message);
      return json({ success: false, error: 'ระบบยืนยันรหัสผ่านขัดข้อง — กรุณาใช้ PIN แทน' }, 401);
    }
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
