/**
 * POST /api/debt-sync-full
 * อัปเดตข้อมูลหนี้ในตาราง customers จาก debt-data.json (ฉบับเต็ม 3,886 CIF)
 * - ใช้เกณฑ์ "มีสัญญาใดเป็น Y" สำหรับ 15 เดือน (เหมือนหน้าแผนที่)
 * - อัปเดตทุก CIF ที่มีข้อมูลหนี้ (ไม่จำกัดแค่ 980 รายของ import เก่า)
 * - Batch 100 statements/round-trip (D1 limit)
 */
import { extractBearerToken, verifyHS256, jwtSecret } from '../_lib/jwt.js';
import { trackWrites, getWriteBudget } from '../_lib/shared.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function authCheck(request, env) {
  const token = extractBearerToken(request);
  if (!token) return { error: 'No token' };
  const secret = jwtSecret(env, request);
  if (!secret) return { error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ (BFR_JWT_SECRET)' };
  const payload = await verifyHS256(token, secret);
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
    let added = 0;
    let skipped = 0;
    let noCif = 0;

    // ดึงค่าปัจจุบันรอบเดียว (batch 90 — D1 รับ bind ได้สูงสุด 100 ตัว/คำสั่ง)
    // ต้องรวมแถวในถังขยะ (deleted=1) ด้วย — ไม่งั้น INSERT จะชน PK กับ CIF ในถังขยะ
    const cifs = [];
    for (const r of data) {
      const cif = String(r.cif || '').trim();
      if (cif) cifs.push(cif); else noCif++;
    }
    const current = new Map();
    for (let i = 0; i < cifs.length; i += 90) {
      const batch = cifs.slice(i, i + 90);
      const ph = batch.map(() => '?').join(',');
      const rows = await env.BFR_DB.prepare(
        `SELECT cif, deleted, zone, branch, debt_class, debt_balance, reserve_pct,
                recognition, overdue_15m, next_due, subsidy, commitment_date
         FROM customers WHERE cif IN (${ph})`
      ).bind(...batch).all();
      (rows.results || []).forEach(x => current.set(String(x.cif), x));
    }

    const num = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0;
    const str = (v) => String(v ?? '').trim();

    for (const r of data) {
      const cif = String(r.cif || '').trim();
      if (!cif) continue; // นับ noCif แล้วรอบบน

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

      // zone/branch/commitment จากคลัง KV (แถวเก่าไม่มี = ไม่แตะของเดิมใน D1 กันเขียนทับด้วยค่าว่าง)
      const rowZone = str(r.zone);
      const rowBranch = str(r.branch);
      const rowCommit = str(r.commitment_date);

      const cur = current.get(cif);
      if (cur && !cur.deleted) {
        // เทียบก่อนเขียน — เท่าเดิมข้าม (ประหยัดโควต้า D1 แบบเดียวกับ debt-import)
        const same =
          str(cur.debt_class) === String(r.max_tier ?? '') &&
          num(cur.debt_balance) === (parseFloat(r.total_debt) || 0) &&
          str(cur.reserve_pct) === reserve &&
          str(cur.recognition) === recognition &&
          str(cur.overdue_15m) === m15Val &&
          str(cur.next_due) === str(r.earliest_due) &&
          str(cur.subsidy) === subsidy &&
          str(cur.commitment_date) === rowCommit &&
          (!rowZone || str(cur.zone) === rowZone) &&
          (!rowBranch || str(cur.branch) === rowBranch);
        if (same) { skipped++; continue; }
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
              commitment_date = ?,
              zone = ?,
              branch = ?,
              debt_updated_at = ?,
              updated_at = ?
            WHERE cif = ?`
          ).bind(
            String(r.max_tier ?? ''),
            parseFloat(r.total_debt) || 0,
            reserve,
            recognition,
            m15Val,
            r.earliest_due || '',
            subsidy,
            rowCommit || str(cur.commitment_date),
            rowZone || str(cur.zone),
            rowBranch || str(cur.branch),
            now,
            now,
            cif
          )
        );
        updated++;
      } else if (!cur) {
        // CIF ใหม่ (ยังไม่มีใน D1) — เพิ่มแถว กันข้อมูลในคลังลอยโดยไม่มีตัวตนในถังหลัก
        statements.push(
          env.BFR_DB.prepare(
            `INSERT INTO customers (
              cif, name, zone, branch, debt_class, debt_balance, reserve_pct,
              recognition, overdue_15m, next_due, subsidy, commitment_date,
              debt_updated_at, risk_level, deleted, created_by, created_at, updated_at
            ) VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclassified', 0, 'Debt-Import', ?, ?)`
          ).bind(
            cif,
            rowZone,
            rowBranch,
            String(r.max_tier ?? ''),
            parseFloat(r.total_debt) || 0,
            reserve,
            recognition,
            m15Val,
            r.earliest_due || '',
            subsidy,
            rowCommit,
            now,
            now,
            now
          )
        );
        added++;
      } else {
        // CIF อยู่ในถังขยะ (deleted=1) — ข้าม กันชน PK (อยากได้คืนให้กู้จากถังขยะก่อน)
        skipped++;
      }
    }

    // โควต้า D1 รายวัน: เช็คก่อนเขียนทั้งก้อน (กันล็อก 100k/วัน) (16 ต.ค.69)
    const quota = await getWriteBudget(env);
    if (quota.blockBulk || statements.length > quota.remaining) {
      return json({
        success: false,
        error: `โควต้าเขียนวันนี้ไม่พอ (เหลือ ${quota.remaining.toLocaleString()} แต่รอบนี้ต้องเขียน ~${statements.length.toLocaleString()} แถว) — รอพรุ่งนี้เช้า 07:00`,
      });
    }

    // Execute batch (D1 batch API — batch ละ 100 statements)
    if (statements.length > 0) {
      for (let i = 0; i < statements.length; i += 100) {
        await env.BFR_DB.batch(statements.slice(i, i + 100));
      }
    }
    await trackWrites(env, statements.length, 'debt-sync-full');

    return json({
      success: true,
      total_cifs: data.length,
      updated,
      added,
      skipped_identical: skipped,
      no_cif: noCif,
      debt_updated_at: now,
    });
  } catch (error) {
    console.error('Debt sync full error:', error);
    return json({ error: 'Sync failed: ' + error.message }, 500);
  }
}