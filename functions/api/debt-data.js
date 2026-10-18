/**
 * GET /api/debt-data  (AUTH REQUIRED)
 * คืนข้อมูลหนี้ Customer Indicator ฉบับล่าสุด:
 * - ตรวจ JWT ทุกครั้ง (login แล้วเท่านั้น)
 * - staff เห็นเฉพาะสาขาตัวเอง (กรอง server-side) — admin เห็นทั้งหมด (17 ต.ค.69)
 * - KV 'debt:data' เป็นแหล่งหลัก (รายสัญญาครบ); ถ้า KV ว่าง → fallback สร้าง
 *   จาก D1 (degraded: มีแค่ยอดสรุป ไม่มีรายสัญญา — ดีกว่าหน้าว่างแล้วนึกว่าข้อมูลหาย)
 */

import { extractBearerToken, verifyHS256, jwtSecret } from '../_lib/jwt.js';
import { toBaacCode } from '../_lib/branches.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// debt_class ใน D1 (ตัวเลข '1'-'5' หรือข้อความไทยเก่า) → max_tier ตัวเลข
function tierToNum(v) {
  const s = String(v || '').trim();
  const map = { 'ปกติ': 1, 'กล่าวถึงเป็นพิเศษ': 2, 'สงสัย': 3, 'สงสัยจะสูญ': 4, 'สงสัยจะสูญมาก': 5 };
  if (map[s] !== undefined) return map[s];
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  // AUTH: any logged-in user (user or admin) can read debt data for their work
  const token = extractBearerToken(request);
  if (!token) return json({ success: false, error: 'No token' }, 401);
  const secret = jwtSecret(env, request);
  if (!secret) return json({ success: false, error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ (BFR_JWT_SECRET)' }, 500);
  const payload = await verifyHS256(token, secret);
  if (!payload) return json({ success: false, error: 'Invalid token' }, 401);

  // สาขาของผู้เรียก (admin = '' = เห็นทั้งหมด)
  const wantBranch = payload.role !== 'admin' ? String(toBaacCode(payload.branch) || '').trim() : '';

  // ?v=1 — ถามเวอร์ชันอย่างเดียว (เบามาก: KV 1 read) → หน้าบ้านใช้เทียบแคชในเครื่อง
  // ถ้าตรงกันข้ามการโหลด 7MB ไปเลย (เฟส 2)
  if (new URL(request.url).searchParams.get('v') === '1') {
    let updated = null;
    try { updated = env.BFR_KV ? await env.BFR_KV.get('debt:updated') : null; } catch {}
    return json({ success: true, updated });
  }

  // ตราประทับรอบอัพหนี้ล่าสุด → แปะหัว X-Debt-Updated ให้หน้าบ้านจำเทียบรอบหน้า
  let debtUpdated = null;
  try { debtUpdated = env.BFR_KV ? await env.BFR_KV.get('debt:updated') : null; } catch {}

  // 1) แหล่งหลัก: KV (ฉบับล่าสุดจาก /api/debt-import — รายสัญญาครบ)
  if (env.BFR_KV) {
    try {
      const raw = await env.BFR_KV.get('debt:data');
      if (raw) {
        try {
          let rows = JSON.parse(raw);
          if (!Array.isArray(rows)) rows = [];
          if (wantBranch) {
            rows = rows.filter(r => {
              const b = String((r && r.branch) || '').trim();
              if (!b) return true; // แถวเก่า (ก่อน sync สาขาลงคลัง) รวมไว้ก่อน กันซ่อนหนี้
              return b === wantBranch;
            });
          }
          return new Response(JSON.stringify(rows), {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-cache',
              'X-Debt-Source': 'kv',
              ...(debtUpdated ? { 'X-Debt-Updated': debtUpdated } : {}),
            },
          });
        } catch (e) {
          console.warn('debt:data KV corrupt:', e.message);
          return json({ success: false, error: 'debt data corrupt' }, 500);
        }
      }
    } catch (e) {
      console.warn('debt:data KV read failed:', e.message);
    }
  }

  // 2) Fallback: สร้างจาก D1 (กันหน้าว่างตอน KV หาย — มีแค่ยอดสรุป ไม่มีรายสัญญา)
  if (env.BFR_DB) {
    try {
      const sql = `SELECT cif, zone, branch, debt_class, debt_balance, reserve_pct,
                          recognition, overdue_15m, next_due, subsidy, commitment_date
                   FROM customers WHERE deleted = 0
                     AND (debt_class != '' OR debt_balance != 0 OR overdue_15m != ''
                          OR next_due != '' OR subsidy != '' OR commitment_date != '')`;
      const q = wantBranch
        ? env.BFR_DB.prepare(sql + ' AND branch = ?1').bind(wantBranch)
        : env.BFR_DB.prepare(sql);
      const out = await q.all();
      const rows = (out.results || []).map(x => ({
        cif: x.cif,
        total_debt: Number(x.debt_balance) || 0,
        branch: x.branch || '',
        zone: x.zone || '',
        commitment_date: x.commitment_date || '',
        gb: '',
        num_contracts: 0,
        max_tier: tierToNum(x.debt_class),
        earliest_due: x.next_due || '',
        is_omsom: false,
        contracts: [],
        _degraded: true,
      }));
      return new Response(JSON.stringify(rows), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Debt-Source': 'd1-fallback',
        },
      });
    } catch (e) {
      console.warn('debt:data D1 fallback failed:', e.message);
    }
  }

  // ไม่มีทั้ง KV และ D1 — บอกให้ import ก่อน (ไม่มี fallback ไฟล์ public แล้ว)
  return json({ success: false, error: 'ยังไม่มีข้อมูลหนี้ — อัปโหลดไฟล์ Customer Indicator ก่อน' }, 404);
}
