// Auth handler — POST /api/login
// PIN อย่างเดียว (17 ต.ค.69 — เลิกรหัสผ่านตามพ่อสั่ง): Admin PIN (KV) + staff แตะชื่อ+PIN

import { signHS256, jwtSecret } from '../_lib/jwt.js';
import { verifyPassword } from '../_lib/crypto.js';
import { BRANCHES as DEFAULT_BRANCHES } from '../_lib/branches.js';
import { verifyAdminPin, getPinVersion } from './admin/pin.js';

// Admin PIN login — admin-pin (ใน KV) เท่านั้น
// ผู้ใช้ทั่วไปสร้างผ่าน /api/admin/users (username+PIN+สาขา)


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

// ===== ประวัติเข้าใช้ (IP + พิกัดประมาณจาก Cloudflare) =====
// ponytail: เก็บแค่ 100 รายการล่าสุดใน KV — กันบวม, พังเงียบได้ (login ต้องไม่พังเพราะ log)
// พิกัดจาก request.cf = ระดับเมือง/จังหวัดจาก IP (คลาดได้หลายสิบ กม.) ไม่ใช่ GPS เครื่อง
async function logLogin(env, request, { username, name, role, branch }) {
  try {
    if (!env?.BFR_KV) return;
    const cf = request?.cf || {};
    const entry = {
      t: new Date().toISOString(),
      user: String(username || ''),
      name: String(name || ''),
      role: String(role || ''),
      branch: String(branch || ''),
      ip: request.headers.get('cf-connecting-ip') || 'unknown',
      country: cf.country || '',
      city: cf.city || '',
      lat: typeof cf.latitude === 'number' ? cf.latitude : null,
      lng: typeof cf.longitude === 'number' ? cf.longitude : null,
      ua: (request.headers.get('user-agent') || '').slice(0, 120),
    };
    const KEY = 'loginlog:all';
    const raw = await env.BFR_KV.get(KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.push(entry);
    await env.BFR_KV.put(KEY, JSON.stringify(list.slice(-100)));
  } catch { /* กัน login พังเพราะ log */ }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); }
  catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

  const { username, password, pin } = body;

  // Fail-closed ถ้าเว็บจริงไม่มี BFR_JWT_SECRET (กันเซ็น/ตรวจ token ด้วยรหัส default ใน git)
  const __secret = jwtSecret(env, request);
  if (!__secret) return json({ success: false, error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ (BFR_JWT_SECRET)' }, 500);

  // Rate limiting via KV (per IP) — same as legacy /api/auth/login
  // ponytail/security (16 ต.ค.69): เชื่อ cf-connecting-ip อย่างเดียว — x-forwarded-for
  // ปลอมได้จาก client หมุน header หนีลิมิต 10 ครั้ง/15 นาทีได้
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
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

  // ===== Username/password — ลบแล้ว (17 ต.ค.69 เหลือ PIN อย่างเดียวตามพ่อสั่ง) =====
  if (username && password) {
    if (env.BFR_KV) { try { await env.BFR_KV.delete(rateKey); } catch {} }
    return json({ success: false, error: 'เลิกใช้รหัสผ่านแล้ว — กรุณาเข้าใช้งานด้วย PIN' }, 400);
  }

  // ===== PIN login =====
  if (pin) {
    // Check admin PIN from KV first
    if (env.BFR_KV) {
      const adminValid = await verifyAdminPin(pin, env.BFR_KV);
      if (adminValid) {
        const secret = __secret;
        const branchName = await getBranchName('WTC', env.BFR_KV);
        const tokenPayload = {
          sub: 'admin-pin',
          username: 'admin',
          name: 'Admin',
          role: 'admin',
          branch: 'WTC',
          branchName,
          pv: await getPinVersion(env.BFR_KV),
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 86400 * 7,
        };
        const token = await signHS256(tokenPayload, secret);
        if (env.BFR_KV) { try { await env.BFR_KV.delete(rateKey); } catch {} }
        await logLogin(env, request, { username: 'admin', name: 'Admin', role: 'admin', branch: 'WTC' });
        return json({ success: true, token, user: { username: 'admin', name: 'Admin', role: 'admin', branch: 'WTC', branchName, loginMethod: 'pin', hasPassword: false } });
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
          const secret = __secret;
          const branchName = await getBranchName(staff.branch, env.BFR_KV);
          const tokenPayload = {
            sub: staff.id,
            username: staff.username,
            name: staff.displayName,
            role: staff.role,
            branch: staff.branch,
            branchName,
            pv: staff.pwdVersion || 1,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 86400 * 7,
          };
          const token = await signHS256(tokenPayload, secret);
          if (env.BFR_KV) { try { await env.BFR_KV.delete(rateKey); } catch {} }
          await logLogin(env, request, { username: staff.username, name: staff.displayName, role: staff.role, branch: staff.branch });
          return json({
            success: true,
            token,
            user: { id: staff.id, username: staff.username, name: staff.displayName, role: staff.role, branch: staff.branch, branchName, loginMethod: 'pin', hasPassword: !!staff.password },
          });
        }
      }
      return json({ success: false, error: 'ชื่อหรือ PIN ไม่ถูกต้อง' }, 401);
    }

    // ไม่มี PIN ทีมแล้ว — staff ต้องส่ง username+pin, admin ใช้ PIN เดิม
    return json({ success: false, error: 'กรุณาเลือกชื่อก่อนใส่ PIN' }, 401);
  }

  return json({ success: false, error: 'กรุณาเข้าใช้งานด้วย PIN ที่หน้าแรก' }, 400);
}
