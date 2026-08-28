/**
 * POST /api/debt-sync-full
 * อัปเดตข้อมูลหนี้ในตาราง customers จาก debt-data.json (ฉบับเต็ม 3,886 CIF)
 * - ใช้เกณฑ์ "มีสัญญาใดเป็น Y" สำหรับ 15 เดือน (เหมือนหน้าแผนที่)
 * - อัปเดตทุก CIF ที่มีข้อมูลหนี้ (ไม่จำกัดแค่ 980 รายของ import เก่า)
 * - Batch 100 statements/round-trip (D1 limit)
 */
import { extractBearerToken, verifyHS256 } from '../_lib/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function authCheck(request, env) {
  const token = extractBearerToken(request);
  if (!token) return { error: 'No token' };
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return { error: 'Invalid token' };
  return { user: payload };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const auth = await authCheck(request, env);
    if (auth.error) return json({ success: false, error: auth.error }, 401);
    if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
    if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

    // อ่านข้อมูลหนี้จาก KV (source of truth — static public file ถูกเอาออกเพื่อความปลอดภัย)
    const raw = await env.BFR_KV.get('debt:data');
    if (!raw) throw new Error('ยังไม่มีข้อมูลหนี้ในระบบ — อัปโหลดไฟล์ Customer Indicator ก่อน (/api/debt-import)');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('debt data ต้องเป็น array');

    const now = new Date().toISOString();
    const statements = [];
    let updated = 0;
    let noCif = 0;

    for (const r of data) {
      const cif = String(r.cif || '').trim();
      if (!cif) { noCif++; continue; }

      // ===== เกณฑ์ 15 เดือน: มีสัญญาใดเป็น Y = "มี" (เหมือนหน้าแผนที่) =====
      let m15Val = '';
      if (Array.isArray(r.contracts) && r.contracts.length > 0) {
        const hasY = r.contracts.some(c => String(c.m15) === 'Y');
        const hasData = r.contracts.some(c => c.m15 === 'Y' || c.m15 === 'N');
        if (hasY) m15Val = 'Y';
        else if (hasData) m15Val = 'N';
      }

      // subsidy: เอาตัวที่มีตัวอักษร (SP/EP) ตัวแรก
      let subsidy = '';
      if (Array.isArray(r.contracts)) {
        const sub = r.contracts.map(c => String(c.sub || '').trim()).find(s => /[A-Za-z]/.test(s));
        if (sub) subsidy = sub;
      }

      // reserve: เอาค่าแรกที่ไม่ว่าง (กันสำรองของสัญญาหลัก)
      let reserve = '';
      if (Array.isArray(r.contracts)) {
        reserve = r.contracts.map(c => String(c.reserve ?? '')).find(v => v !== '') || '';
      }

      // recognition: ค่าแรกที่ไม่ว่าง
      let recognition = '';
      if (Array.isArray(r.contracts)) {
        recognition = r.contracts.map(c => String(c.rec ?? '')).find(v => v !== '') || '';
      }

      statements.push(
        env.BFR_DB.prepare(
          `UPDATE customers SET
            debt_class = ?,
            debt_balance = ?,
            reserve_pct = ?,
            recognition = ?,
            overdue_15m = ?,
            next_due = ?,
            subsidy = ?,
            debt_updated_at = ?
          WHERE cif = ? AND deleted = 0`
        ).bind(
          String(r.max_tier ?? ''),
          parseFloat(r.total_debt) || 0,
          reserve,
          recognition,
          m15Val,
          r.earliest_due || '',
          subsidy,
          now,
          cif
        )
      );
      updated++;
    }

    // Execute batch (D1 batch API — batch ละ 100 statements)
    if (statements.length > 0) {
      for (let i = 0; i < statements.length; i += 100) {
        await env.BFR_DB.batch(statements.slice(i, i + 100));
      }
    }

    return json({
      success: true,
      total_cifs: data.length,
      updated,
      no_cif: noCif,
      debt_updated_at: now,
    });
  } catch (error) {
    console.error('Debt sync full error:', error);
    return json({ error: 'Sync failed: ' + error.message }, 500);
  }
}