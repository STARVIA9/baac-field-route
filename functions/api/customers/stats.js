/**
 * GET /api/customers/stats (AUTH REQUIRED)
 * ตัวเลขสรุปเบา ๆ จาก D1 โดยไม่ต้องโหลดรายชื่อทั้งตาราง (17 พ.ย.69)
 *   - total_customers : จำนวนลูกค้าทั้งหมด (ยังไม่ลบ) — ทั้งสาขา/ตามสิทธิ์ผู้ใช้
 *   - with_debt       : จำนวนที่มีข้อมูลหนี้
 *   - debt_total      : ยอดหนี้รวม
 *   - by_branch[]     : แยกต่อสาขา
 * ใช้กับหน้าสรุปข้อมูล/หน้าลูกค้า เพื่อโชว์ "จำนวนเต็ม" ได้ทันทีโดยไม่ต้องดึง 11,785 แถว
 */
import { extractBearerToken, verifyHS256, jwtSecret } from '../../_lib/jwt.js';
import { toBaacCode } from '../../_lib/branches.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Customers-Stats': '1' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const token = extractBearerToken(request);
  if (!token) return json({ success: false, error: 'No token' }, 401);
  const secret = jwtSecret(env, request);
  if (!secret) return json({ success: false, error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ (BFR_JWT_SECRET)' }, 500);
  const payload = await verifyHS256(token, secret);
  if (!payload) return json({ success: false, error: 'Invalid token' }, 401);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  const isAdmin = payload.role === 'admin';
  const own = isAdmin ? '' : String(toBaacCode(payload.branch) || '').trim();

  const debtCond = `(debt_balance != 0 OR debt_class != '' OR reserve_pct != ''
                    OR recognition != '' OR overdue_15m != '' OR next_due != ''
                    OR subsidy != '' OR commitment_date != '')`;
  try {
    const rows = await env.BFR_DB.prepare(
      `SELECT COALESCE(NULLIF(branch, ''), '_none') b,
              COUNT(*) n,
              SUM(CASE WHEN ${debtCond} THEN 1 ELSE 0 END) n_debt,
              SUM(CASE WHEN ${debtCond} THEN COALESCE(debt_balance, 0) ELSE 0 END) debt
       FROM customers
       WHERE deleted = 0 ${own ? 'AND branch = ?1' : ''}
       GROUP BY b`
    ).bind(...(own ? [own] : [])).all();

    const byBranch = (rows.results || []).map(r => ({
      branch: r.b,
      customers: +r.n || 0,
      with_debt: +r.n_debt || 0,
      debt_total: Math.round(+r.debt || 0),
    }));

    // 17 พ.ย.69: เติมสาขาที่คีย์ไว้ในระบบแต่ยังไม่มีข้อมูล (เช่น ปราจีนบุรี/ศรีมหาโพธิ/ประจันตคาม/นาดี)
    // → ตัวเลขสรุป "ทั้งจังหวัด" ครบทุกสาขาเสมอ ไม่หายไปเพราะยังไม่มีไฟล์หนี้
    try {
      const rawB = env.BFR_KV ? await env.BFR_KV.get('branches:all') : null;
      const list = rawB ? JSON.parse(rawB) : [];
      const have = new Set(byBranch.map(x => String(x.branch)));
      for (const b of (Array.isArray(list) ? list : [])) {
        const code = String(b.code || '').trim();
        if (!code || have.has(code)) continue;
        byBranch.push({ branch: code, customers: 0, with_debt: 0, debt_total: 0, empty: true });
      }
    } catch { /* branches:all ไม่พร้อม — คืนเท่าที่มี */ }
    const total = byBranch.reduce((s, x) => s + x.customers, 0);
    const withDebt = byBranch.reduce((s, x) => s + x.with_debt, 0);
    const debtTotal = byBranch.reduce((s, x) => s + x.debt_total, 0);

    return json({
      success: true,
      total_customers: total,
      with_debt: withDebt,
      debt_total: debtTotal,
      by_branch: byBranch,
      scope_branch: own,
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    return json({ success: false, error: 'อ่านตัวเลขสรุปไม่สำเร็จ: ' + e.message }, 500);
  }
}
