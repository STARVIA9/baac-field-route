/**
 * POST /api/debt-import
 * อัปโหลดไฟล์ Customer Indicator (CSV TIS-620) → อัปเดตข้อมูลหนี้ในตาราง customers
 * 
 * Flow (Full Sync — ข้อมูลใหม่ = แหล่งจริงทั้งหมด):
 * 1. รับไฟล์ CSV (multipart/form-data)
 * 2. Parse CSV (TIS-620 encoding)
 * 3. Group by CIF → คำนวณสรุปต่อ CIF (ชั้นสูงสุด, หนี้รวม, 15เดือน = มีสัญญาใด Y)
 * 4. อัปเดต/เพิ่มในตาราง customers (UPDATE/INSERT batch 100)
 * 5. ล้างข้อมูลหนี้ของ CIF ที่ไม่อยู่ในไฟล์ใหม่ (ไม่ค้างเลขเก่า)
 * 6. เขียน debt-data.json ฉบับใหม่ลง KV (ให้หน้าแผนที่อ่านข้อมูลล่าสุด)
 * 7. คืนผลลัพธ์
 */

// คอลัมน์ Customer Indicator (0-indexed)
const COL_CIF = 7;
const COL_NAME = 5;
const COL_CONTRACT_NO = 22;       // เลขสัญญา
const COL_DEBT_BALANCE = 24;      // หนี้คงเหลือ
const COL_DEBT_CLASS = 30;        // ชั้นหนี้ตามเกณฑ์ ธปท.
const COL_SUBSIDY = 31;           // Subsidy plan
const COL_NEXT_DUE = 33;          // Next Due date
const COL_RESERVE_PCT = 60;       // อัตราการกันสำรอง (%)
const COL_RECOGNITION = 62;       // เกณฑ์การรับรู้รายได้
const COL_OVERDUE_15M = 65;       // 15เดือน ณ เดือนปัจจุบัน
const COL_COMMITMENT = 102;       // วันที่สิ้นสุดสัญญา

// ระดับชั้นหนี้ (สำหรับเปรียบเทียบ — สูงกว่า = สำคัญกว่า)
const DEBT_CLASS_RANK = {
  'ปกติ': 1,
  'กล่าวถึงเป็นพิเศษ': 2,
  'สงสัย': 3,
  'สงสัยจะสูญ': 4,
  'สงสัยจะสูญมาก': 5,
};

function tierNum(cls) {
  return DEBT_CLASS_RANK[cls] || 0;
}

// วัน DD/MM/YYYY → timestamp สำหรับ compare (ช้ากว่า = ค่าเล็กกว่า... กลับด้าน)
function dueKey(d) {
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) : 0;
}

/**
 * Parse CSV string (TIS-620) → array ของสัญญาทุกใบ (ไม่เลือกสัญญาเดียว)
 */
function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length < 3) return [];

  // แถว0 = หัวรายงาน, แถว1 = ชื่อคอลัมน์, แถว2+ = ข้อมูล
  const results = [];

  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 10) continue; // ข้ามแถวที่ไม่สมบูรณ์

    const cif = cols[COL_CIF];
    if (!cif || cif.length < 5) continue; // ข้าม CIF ไม่ถูกต้อง

    results.push({
      cif,
      name: cols[COL_NAME] || '',
      contractNo: cols[COL_CONTRACT_NO] || '',
      debtClass: cols[COL_DEBT_CLASS] || '',
      debtBalance: parseFloat(cols[COL_DEBT_BALANCE]) || 0,
      subsidy: cols[COL_SUBSIDY] || '',
      nextDue: cols[COL_NEXT_DUE] || '',
      reservePct: cols[COL_RESERVE_PCT] || '',
      recognition: cols[COL_RECOGNITION] || '',
      overdue15m: cols[COL_OVERDUE_15M] || '',
      commitmentDate: cols[COL_COMMITMENT] || '',
    });
  }

  return results;
}

/**
 * Group by CIF → สรุปต่อ CIF (ทุกสัญญา) + รายการสัญญา (สำหรับ debt-data.json)
 */
function groupByCIF(contracts) {
  const groups = {};
  for (const c of contracts) {
    if (!groups[c.cif]) groups[c.cif] = [];
    groups[c.cif].push(c);
  }

  const summaries = {};   // สำหรับ D1 (คอลัมน์สรุป)
  const debtRows = [];    // สำหรับ debt-data.json ฉบับใหม่ (รายสัญญา)

  for (const [cif, items] of Object.entries(groups)) {
    // ===== สรุปต่อ CIF =====
    let maxTier = 0;
    let totalDebt = 0;
    let earliestDue = '';
    let earliestKey = Infinity;
    let has15Y = false;
    let has15Data = false;
    let subsidy = '';
    let reserve = '';
    let recognition = '';

    const contracts = items.map(c => {
      const t = tierNum(c.debtClass);
      if (t > maxTier) maxTier = t;
      totalDebt += c.debtBalance || 0;
      const dk = dueKey(c.nextDue);
      if (dk < earliestKey) { earliestKey = dk; earliestDue = c.nextDue; }
      if (c.overdue15m === 'Y') has15Y = true;
      if (c.overdue15m === 'Y' || c.overdue15m === 'N') has15Data = true;
      if (!subsidy && /[A-Za-z]/.test(c.subsidy)) subsidy = c.subsidy;
      if (!reserve && c.reservePct) reserve = c.reservePct;
      if (!recognition && c.recognition) recognition = c.recognition;

      return {
        c: c.contractNo,
        d: c.debtBalance || 0,
        t: String(t || ''),
        due: c.nextDue,
        reserve: c.reservePct,
        rec: c.recognition,
        sub: c.subsidy,
        m15: c.overdue15m || 'N',
        m15_amt: 0,
        mc: '',
        f08: '', f09: '', f10: '',
        p08: 0, p09: 0, p10: 0,
      };
    });

    summaries[cif] = {
      cif,
      name: items[0].name || '',
      debtClass: maxTier ? String(maxTier) : '',
      debtBalance: totalDebt,
      reservePct: reserve,
      recognition,
      overdue15m: has15Y ? 'Y' : (has15Data ? 'N' : ''),
      nextDue: earliestDue,
      subsidy,
      commitmentDate: items[0].commitmentDate || '',
    };

    debtRows.push({
      cif,
      total_debt: totalDebt,
      num_contracts: items.length,
      max_tier: maxTier,
      earliest_due: earliestDue,
      is_omsom: false,
      contracts,
    });
  }

  return { summaries, debtRows };
}

import { extractBearerToken, verifyHS256 } from '../_lib/jwt.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  // ตรวจสอบ auth จริง — verify JWT signature + ต้องเป็น admin
  const token = extractBearerToken(request);
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
  if (payload.role !== 'admin') return new Response(JSON.stringify({ error: 'ต้องเป็น Admin เท่านั้น' }), { status: 403 });

  try {
    // รับไฟล์ CSV
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file uploaded' }), { status: 400 });
    }

    // อ่านไฟล์เป็น text (TIS-620)
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder('tis-620');
    const text = decoder.decode(buffer);

    // Parse CSV
    const contracts = parseCSV(text);
    if (contracts.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid contracts found in CSV' }), { status: 400 });
    }

    // Group by CIF → สรุป + รายสัญญา
    const { summaries, debtRows } = groupByCIF(contracts);
    const cifList = Object.keys(summaries);
    const BATCH_SIZE = 100;
    const now = new Date().toISOString();

    // ดึง CIF ที่มีอยู่ในตาราง customers (แบ่ง batch 100 CIF ต่อครั้ง)
    // ต้องเช็คทุก CIF รวมที่ถูกลบ (deleted=1) ด้วย — ไม่งั้น INSERT จะชน UNIQUE (PK) กับ CIF ในถังขยะ
    const existingCIFs = new Set();
    for (let i = 0; i < cifList.length; i += BATCH_SIZE) {
      const batch = cifList.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');
      const rows = await env.BFR_DB.prepare(
        `SELECT cif FROM customers WHERE cif IN (${placeholders})`
      ).bind(...batch).all();
      (rows.results || []).forEach(r => existingCIFs.add(r.cif));
    }

    // อัปเดต/เพิ่มข้อมูลหนี้ (ทุกสัญญารวมกัน)
    let updated = 0;
    let added = 0;
    const statements = [];

    for (const cif of cifList) {
      const s = summaries[cif];
      if (existingCIFs.has(cif)) {
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
              debt_updated_at = ?
            WHERE cif = ?`
          ).bind(
            s.debtClass,
            s.debtBalance,
            s.reservePct,
            s.recognition,
            s.overdue15m,
            s.nextDue,
            s.subsidy,
            s.commitmentDate,
            now,
            cif
          )
        );
        updated++;
      } else {
        // INSERT ลูกค้าใหม่
        statements.push(
          env.BFR_DB.prepare(
            `INSERT INTO customers (
              cif, name, debt_class, debt_balance, reserve_pct,
              recognition, overdue_15m, next_due, subsidy, commitment_date,
              debt_updated_at, risk_level, deleted, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclassified', 0, 'Debt-Import', ?, ?)`
          ).bind(
            cif,
            (s.name || '').trim(),
            s.debtClass,
            s.debtBalance,
            s.reservePct,
            s.recognition,
            s.overdue15m,
            s.nextDue,
            s.subsidy,
            s.commitmentDate,
            now,
            now,
            now
          )
        );
        added++;
      }
    }

    // ล้างข้อมูลหนี้ของ CIF ที่ไม่อยู่ในไฟล์ใหม่
    // ⚠️ ปลอดภัย: ล้างเฉพาะ CIF ที่ระบบสร้างจากไฟล์หนี้ (created_by='Debt-Import')
    // — CIF เหล่านี้เกิดจากไฟล์ Customer Indicator ล้วน ถ้าไม่อยู่ในไฟล์ใหม่ = ไม่มีหนี้จริง
    // ลูกค้าจริง (AutoImport/GPS/Admin) ไม่โดนล้าง — คงข้อมูลเดิม (เผื่อไฟล์ย่อย/ไม่ครบ)
    if (cifList.length > 0) {
      const placeholders = cifList.map(() => '?').join(',');
      statements.push(
        env.BFR_DB.prepare(
          `UPDATE customers SET
            debt_class = '',
            debt_balance = 0,
            reserve_pct = '',
            recognition = '',
            overdue_15m = '',
            next_due = '',
            subsidy = '',
            commitment_date = '',
            debt_updated_at = ?
          WHERE deleted = 0 AND created_by = 'Debt-Import' AND cif NOT IN (${placeholders})`
        ).bind(now, ...cifList)
      );
    }

    // Execute batch (D1 batch API — batch ละ 100 statements)
    if (statements.length > 0) {
      for (let i = 0; i < statements.length; i += 100) {
        const chunk = statements.slice(i, i + 100);
        await env.BFR_DB.batch(chunk);
      }
    }

    // เขียน debt-data.json ฉบับใหม่ลง KV → หน้าแผนที่อ่านข้อมูลล่าสุด
    let kvWritten = false;
    if (env.BFR_KV) {
      try {
        await env.BFR_KV.put('debt:data', JSON.stringify(debtRows));
        await env.BFR_KV.put('debt:updated', now);
        kvWritten = true;
      } catch (e) {
        console.warn('KV write debt:data failed:', e.message);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_contracts: contracts.length,
      unique_cifs: cifList.length,
      updated,
      added,
      debt_rows: debtRows.length,
      kv_written: kvWritten,
      debt_updated_at: now,
    }), { status: 200 });

  } catch (error) {
    console.error('Debt import error:', error);
    return new Response(JSON.stringify({ error: 'Import failed: ' + error.message }), { status: 500 });
  }
}