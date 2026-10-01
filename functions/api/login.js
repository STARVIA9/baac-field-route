// Auth handler — POST /api/login
// Supports: username/password (KV users) + admin PIN (KV) + legacy team PINs

import { signHS256 } from '../_lib/jwt.js';
import { verifyPassword } from '../_lib/crypto.js';
import { BRANCHES as DEFAULT_BRANCHES } from '../_lib/branches.js';
import { verifyAdminPin } from './admin/pin.js';

// Admin PIN login — admin-pin (กับ KV) เท่านั้น
// ผู้ใช้ทั่วไปต้องสร้างผ่าน /api/admin/users (username+password+สาขา)

// Default admin user (seeded into KV if missing) — survives total KV wipe
// ⚠️ PRE-COMPUTED PBKDF2 hash (500 iterations) of 'admin1234'.
// This eliminates the "Worker exceeded resource limits" 503 on fresh deploy
// because no PBKDF2 runs at runtime during seed. If you change DEFAULT_ADMIN.password,
// regenerate this hash with: node -e "crypto.pbkdf2Sync(...)" and update below.
const DEFAULT_ADMIN_HASH = '500.R8a6ojXPiGLTsYLF7TSLGnHynomzOqNi-xpT366Y3GY._gZIc2kKe2p5N6WqPDvSPSfUgzhFIEhAAKMwPaCBg2I.jwnbz6XjwdQZgBFI6oict8gsWSvHP_-KAwDj_wjg1hM';

const DEFAULT_ADMIN = {
  username: 'admin',
  displayName: 'Admin',
  // password: null = ปิด login ด้วยรหัสผ่านโรงงาน (admin/admin1234) ถาวร
  // เหตุผล: verifyPassword ถูกแก้ให้ทำงานจริงแล้ว ถ้า seed hash โรงงานไว้
  // รหัส admin1234 ที่เขียนอยู่ในคอมเมนต์จะกลายเป็นประตูหลังทันที
  // admin เข้าทาง Admin PIN (3117 ใน KV) อย่างเดียว อยากได้ password ค่อยตั้งผ่าน PUT /api/admin/users
  password: null,
  role: 'admin',
  branch: 'WTC',
};

/**
 * Idempotent seed — if KV has no `users:all`, write default admin (password=null).
 * Migration: รหัสโรงงานทุกรูปแบบ (hash 100000 รอบเก่า / hash admin1234)
 * ถูกปิดเป็น null — เหลือแค่ Admin PIN เป็นทางเข้า (รหัส custom ที่ admin ตั้งเองไม่โดนแตะ)
 */
async function seedDefaultAdminIfMissing(kv) {
  const raw = await kv.get('users:all');
  if (raw) {
    // Check if existing admin still carries a factory password → disable it
    const users = JSON.parse(raw);
    let needsUpdate = false;
    for (const u of users) {
      if (u.username === 'admin' && u.password && (u.password.startsWith('100000.') || u.password === DEFAULT_ADMIN_HASH)) {
        // รหัสโรงงาน (เก่า 100K หรือ admin1234) — ปิดทิ้ง, admin ใช้ PIN อย่างเดียว
        u.password = null;
        u.updatedAt = new Date().toISOString();
        needsUpdate = true;
        console.log('[login] Disabled factory admin password — admin PIN only from now on');
      }
    }
    if (needsUpdate) {
      await kv.put('users:all', JSON.stringify(users));
    }
    return; // Already seeded
  }
  // KV empty — seed with NO password (admin PIN only)
  const user = {
    id: 'admin',
    username: DEFAULT_ADMIN.username,
    displayName: DEFAULT_ADMIN.displayName,
    password: null,
    role: DEFAULT_ADMIN.role,
    branch: DEFAULT_ADMIN.branch,
    createdAt: new Date().toISOString(),
  };
  await kv.put('users:all', JSON.stringify([user]));
  console.log('[login] Seeded default admin with NO password (admin PIN only)');
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

  // Rate limiting via KV (per IP) — same as legacy /api/auth/login
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const rateKey = `ratelimit:login:${ip}`;
  const MAX_ATTEMPTS = 10;
  const WINDOW_SEC = 15 * 60;
  if (env.BFR_KV) {
    try {
      const raw = await env.BFR_KV.get(rateKey);
      const attempts = raw ? parseInt(raw, 10) : 0;
      if (attempts >= MAX_ATTEMPTS) {
        return json({ success: false, error: `พยายามเกิน ${MAX_ATTEMPTS} ครั้ง กรุณารอ 15 นาที` }, 429);
      }
      await env.BFR_KV.put(rateKey, String(attempts + 1), { expirationTtl: WINDOW_SEC });
    } catch (e) {
      console.warn('Rate limit KV error:', e.message);
      // Fail open — don't block login if KV is down
    }
  }

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

    // Clear rate limit on successful login
    if (env.BFR_KV) { try { await env.BFR_KV.delete(rateKey); } catch {} }

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

    // ===== Staff PIN login (แตะชื่อ + PIN) =====
    // ponytail: PIN อย่างเดียวไม่พอ ต้องคู่ username เสมอ (กันเดาเลขถูกชุดเดียวแล้วเข้าเลย)
    if (username && env.BFR_KV) {
      const staffRaw = await env.BFR_KV.get('users:all');
      const staffList = staffRaw ? JSON.parse(staffRaw) : [];
      const staff = staffList.find(u => u.username === username && !u.deleted);
      if (staff?.pinHash) {
        let ok = false;
        try { ok = await verifyPassword(pin, staff.pinHash); } catch { ok = false; }
        if (ok) {
          const secret = env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min';
          const branchName = await getBranchName(staff.branch, env.BFR_KV);
          const tokenPayload = {
            sub: staff.id,
            username: staff.username,
            name: staff.displayName,
            role: staff.role,
            branch: staff.branch,
            branchName,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 86400 * 7,
          };
          const token = await signHS256(tokenPayload, secret);
          if (env.BFR_KV) { try { await env.BFR_KV.delete(rateKey); } catch {} }
          return json({
            success: true,
            token,
            user: { id: staff.id, username: staff.username, name: staff.displayName, role: staff.role, branch: staff.branch, branchName },
          });
        }
      }
      return json({ success: false, error: 'ชื่อหรือ PIN ไม่ถูกต้อง' }, 401);
    }

    // ไม่มี PIN ทีมแล้ว — staff ต้องส่ง username+pin, admin ใช้ PIN เดิม
    return json({ success: false, error: 'กรุณาเลือกชื่อก่อนใส่ PIN' }, 401);
  }

  return json({ success: false, error: 'กรุณากรอก username+password หรือ PIN' }, 400);
}
