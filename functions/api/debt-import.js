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

// คอลัมน์ Customer Indicator (0-indexed) — อิง build_debt_data.py (ต้นฉบับถูกต้อง)
const COL_BRANCH = 2;             // สาขา (รูปแบบ "854 - สาขาวังท่าช้าง") — sync ลง customers.branch
const COL_CIF = 7;
const COL_ZONE = 4;              // เขต (1-5/9807/76003/99999) — sync ลง customers.zone ทุกครั้งที่อัพหนี้
const COL_GB = 117;              // โครงการนำร่อง: GOOD BANK / BAD BANK (ตัวจริงตามไฟล์ ห้ามเดาจากชั้นหนี้)
const COL_NAME = 5;
const COL_CONTRACT_NO = 22;       // เลขสัญญา
const COL_DEBT_BALANCE = 24;      // หนี้คงเหลือ
const COL_DEBT_CLASS = 30;        // ชั้นหนี้ตามเกณฑ์ ธปท.
const COL_SUBSIDY = 31;           // Subsidy plan
const COL_NEXT_DUE = 33;          // Next Due date
const COL_RESERVE_PCT = 60;       // อัตราการกันสำรอง (%)
const COL_RECOGNITION = 62;       // เกณฑ์การรับรู้รายได้
const COL_OVERDUE_15M = 65;       // 15เดือน Y = Reversed แล้ว / N = ยังไม่ (คนละตัวกับ col 64)
const COL_15M_NOW = 64;            // 15เดือน ณ เดือนปัจจุบัน (Y = เป็นแล้ว)
const COL_MONTHS_OVERDUE = 71;     // จำนวนเดือนค้าง (หักพักหนี้) — ใช้คำนวณเดือนเกิด 15 เดือนใหม่ (15 - เดือนค้าง)
const COL_OVERDUE_15M_AMT = 66;   // 15เดือน ณ 31/03/2570 ยอดขั้นต่ำ (บาท) — ที่หายไปทำให้ GPS โชว์ไม่ครบ
const COL_MC = 18;                // Market Code (3080/2838/2751 = อสม.)
const COL_F08 = 103;              // คาดการณ์ 15เดือน ส.ค.69 Y/N
const COL_F09 = 104;              // คาดการณ์ ก.ย.69
const COL_F10 = 105;              // คาดการณ์ ต.ค.69
const COL_P08 = 134;              // ยอดขั้นต่ำ ส.ค.69
const COL_P09 = 135;              // ยอดขั้นต่ำ ก.ย.69
const COL_P10 = 136;              // ยอดขั้นต่ำ ต.ค.69
const COL_COMMITMENT = 102;       // วันที่สิ้นสุดสัญญา

// ระดับชั้นหนี้ (สำหรับเปรียบเทียบ — สูงกว่า = สำคัญกว่า)
// รองรับทั้งข้อความไทย ("ปกติ") และรหัสตัวเลข ("1"-"5") จากไฟล์จริง WEEKLY 34
const DEBT_CLASS_RANK = {
  'ปกติ': 1,
  'กล่าวถึงเป็นพิเศษ': 2,
  'สงสัย': 3,
  'สงสัยจะสูญ': 4,
  'สงสัยจะสูญมาก': 5,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
};

function tierNum(cls) {
  const v = String(cls || '').trim();
  if (DEBT_CLASS_RANK[v] !== undefined) return DEBT_CLASS_RANK[v];
  // เผื่อ "01", " 1 " หรือ "ชั้น 1"
  const m = v.match(/[1-5]/);
  return m ? parseInt(m[0], 10) : 0;
}

// วัน DD/MM/YYYY → timestamp สำหรับ compare (ช้ากว่า = ค่าเล็กกว่า... กลับด้าน)
function dueKey(d) {
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) : 0;
}

/**
 * Parse CSV string (TIS-620) → array ของสัญญาทุกใบ (ไม่เลือกสัญญาเดียว)
 * รองรับฟิลด์ที่มีเครื่องหมายคำพูดและคอมม่าภายใน (เช่น ที่อยู่)
 */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } // escaped ""
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(c => c.trim().replace(/^"|"$/g, '').trim());
}
// เดือนของไฟล์ (แถว0 "ข้อมูล ณ DD/MM/BBBB" พ.ศ.→ค.ศ.) — ฐานคำนวณเดือนเกิด 15 เดือนใหม่
function fileMonthYear(headLine) {
  const m = String(headLine || '').match(/ข้อมูล ณ\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return { m: parseInt(m[2], 10), y: parseInt(m[3], 10) - 543 };
}

// เดือนที่จะครบ 15 เดือน (b15 'MM/YYYY' ปี ค.ศ.) — เป็นแล้ว/ข้อมูลไม่พอ = ''
function birth15(fmy, now15, moRaw) {
  if (!fmy || now15) return '';
  const mo = parseInt(String(moRaw || '').trim(), 10);
  if (!Number.isFinite(mo) || mo < 0 || mo >= 15) return '';
  const t = (fmy.m - 1) + (15 - mo);   // เดือนค้าง mo → อีก (15-mo) เดือนครบ
  return String((t % 12) + 1).padStart(2, '0') + '/' + (fmy.y + Math.floor(t / 12));
}
// GOOD/BAD BANK จากช่องโครงการนำร่อง (ตัวจริงตามไฟล์)
function gbFlag(v) {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'BAD BANK') return 'BAD';
  if (s === 'GOOD BANK') return 'GOOD';
  return '';
}
function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length < 3) return { rows: [], fileMY: null };

  // แถว0 = หัวรายงาน, แถว1 = ชื่อคอลัมน์, แถว2+ = ข้อมูล
  const fileMY = fileMonthYear(lines[0]);
  const results = [];

  for (let i = 2; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 10) continue; // ข้ามแถวที่ไม่สมบูรณ์

    const cif = cols[COL_CIF];
    if (!cif || cif.length < 5) continue; // ข้าม CIF ไม่ถูกต้อง

    // helper: safe parse float without comma
    const parseAmt = (v) => parseFloat(String(v || '').replace(/,/g, '').trim()) || 0;
    const yn = (v) => { const s = String(v || '').trim(); return s === 'Y' || s === 'N' ? s : (s === 'Y' ? 'Y' : ''); };
    results.push({
      cif,
      name: cols[COL_NAME] || '',
      branch: extractBaacCode(cols[COL_BRANCH]),
      zone: (cols[COL_ZONE] || '').trim(),
      b15: birth15(fileMY, cols[COL_15M_NOW] === 'Y', cols[COL_MONTHS_OVERDUE]),
      gb: gbFlag(cols[COL_GB]),
      contractNo: cols[COL_CONTRACT_NO] || '',
      debtClass: cols[COL_DEBT_CLASS] || '',
      debtBalance: parseAmt(cols[COL_DEBT_BALANCE]),
      subsidy: cols[COL_SUBSIDY] || '',
      nextDue: cols[COL_NEXT_DUE] || '',
      reservePct: cols[COL_RESERVE_PCT] || '',
      recognition: cols[COL_RECOGNITION] || '',
      overdue15m: cols[COL_OVERDUE_15M] || '',
      overdue15mAmt: parseAmt(cols[COL_OVERDUE_15M_AMT]),
      marketCode: cols[COL_MC] || '',
      f08: yn(cols[COL_F08]),
      f09: yn(cols[COL_F09]),
      f10: yn(cols[COL_F10]),
      p08: parseAmt(cols[COL_P08]),
      p09: parseAmt(cols[COL_P09]),
      p10: parseAmt(cols[COL_P10]),
      commitmentDate: cols[COL_COMMITMENT] || '',
    });
  }

  return { rows: results, fileMY };
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
        b15: c.b15 || '',
        t: String(t || ''),
        due: c.nextDue,
        reserve: c.reservePct,
        rec: c.recognition,
        sub: c.subsidy,
        m15: c.overdue15m || 'N',
        m15_amt: c.overdue15mAmt || 0,
        mc: c.marketCode || '',
        f08: c.f08 || '', f09: c.f09 || '', f10: c.f10 || '',
        p08: c.p08 || 0, p09: c.p09 || 0, p10: c.p10 || 0,
      };
    });

    summaries[cif] = {
      cif,
      name: items[0].name || '',
      branch: items.reduce((z, c) => z || (c.branch || ''), ''),
      zone: items.reduce((z, c) => z || (c.zone || ''), ''),
      gb: items.reduce((z, c) => z || (c.gb || ''), ''),
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
      gb: (summaries[cif] && summaries[cif].gb) || '',
      num_contracts: items.length,
      max_tier: maxTier,
      earliest_due: earliestDue,
      is_omsom: items.some(c => /3080|2838|2751/.test(c.marketCode || '')),
      contracts,
    });
  }

  return { summaries, debtRows };
}

import { extractBearerToken, verifyHS256 } from '../_lib/jwt.js';
import { extractBaacCode } from '../_lib/branches.js';
import { trackWrites, getWriteBudget } from '../_lib/shared.js';

// ชื่อช่องภาษาไทย (โชว์บนจอ preview ว่าแต่ละช่องเปลี่ยนกี่ราย)
const FIELD_TH = {
  debt_class: 'ชั้นหนี้', debt_balance: 'ยอดหนี้', zone: 'เขต', branch: 'สาขา',
  reserve_pct: 'กันสำรอง', recognition: 'รับรู้รายได้', overdue_15m: 'ค้าง 15 ด.',
  next_due: 'งวดถัดไป', subsidy: 'ชดเชย', commitment_date: 'สิ้นสุดสัญญา',
};

// เทียบค่าหนี้ในไฟล์ (s) กับในถัง (cur) → คืนรายชื่อช่องที่เปลี่ยน (ว่าง = เท่าเดิม ไม่ต้องเขียน)
function debtDiff(cur, s) {
  const str = (v) => String(v ?? '').trim();
  const num = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0;
  const out = [];
  if (str(cur.debt_class) !== str(s.debtClass)) out.push('debt_class');
  if (str(cur.zone) !== str(s.zone || '')) out.push('zone');
  if (str(cur.branch) !== str(s.branch || '')) out.push('branch');
  if (num(cur.debt_balance) !== num(s.debtBalance)) out.push('debt_balance');
  if (str(cur.reserve_pct) !== str(s.reservePct)) out.push('reserve_pct');
  if (str(cur.recognition) !== str(s.recognition)) out.push('recognition');
  if (str(cur.overdue_15m) !== str(s.overdue15m)) out.push('overdue_15m');
  if (str(cur.next_due) !== str(s.nextDue)) out.push('next_due');
  if (str(cur.subsidy) !== str(s.subsidy)) out.push('subsidy');
  if (str(cur.commitment_date) !== str(s.commitmentDate)) out.push('commitment_date');
  return out;
}

// แถวถูกล้างหนี้แล้วหรือยัง (ล้างแล้ว = ข้าม ไม่ต้องเขียนซ้ำ)
function isDebtClean(r) {
  return !String(r.debt_class || '').trim()
    && !(Number(r.debt_balance) || 0)
    && !String(r.reserve_pct || '').trim()
    && !String(r.recognition || '').trim()
    && !String(r.overdue_15m || '').trim()
    && !String(r.next_due || '').trim()
    && !String(r.subsidy || '').trim()
    && !String(r.commitment_date || '').trim();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // ตรวจสอบ auth จริง — verify JWT signature + ต้องเป็น admin
  const token = extractBearerToken(request);
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const payload = await verifyHS256(token, env.BFR_JWT_SECRET || 'dev-secret-change-me-32-chars-min');
  if (!payload) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
  if (payload.role !== 'admin') return new Response(JSON.stringify({ error: 'ต้องเป็น Admin เท่านั้น' }), { status: 403 });

  // dryrun=1 → วิเคราะห์ไฟล์เทียบของเดิมแล้วตอบกลับเลย ไม่เขียนอะไร (16 ต.ค.69)
  const url = new URL(request.url);
  const dryrun = url.searchParams.get('dryrun') === '1';

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
    const { rows: contracts, fileMY } = parseCSV(text);
    if (!fileMY) {
      return new Response(JSON.stringify({ error: 'อ่านวันที่ไฟล์ไม่ได้ (แถวแรกต้องมี \"ข้อมูล ณ DD/MM/YYYY\")' }), { status: 400 });
    }
    if (contracts.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid contracts found in CSV' }), { status: 400 });
    }

    // Group by CIF → สรุป + รายสัญญา
    const { summaries, debtRows } = groupByCIF(contracts);
    const cifList = Object.keys(summaries);
    const BATCH_SIZE = 90; // D1 รับ bind ได้สูงสุด 100 ตัว/คำสั่ง — 90 เผื่อเหลือ
    const now = new Date().toISOString();

    // ดึงค่าปัจจุบันในถัง (มีอยู่ไหม + ค่าหนี้ 10 ช่อง + ที่มา + สาขา) — รอบเดียว
    // ต้องเช็คทุก CIF รวมที่ถูกลบ (deleted=1) ด้วย — ไม่งั้น INSERT จะชน UNIQUE (PK) กับ CIF ในถังขยะ
    const current = new Map();
    for (let i = 0; i < cifList.length; i += BATCH_SIZE) {
      const batch = cifList.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');
      const rows = await env.BFR_DB.prepare(
        `SELECT cif, deleted, created_by, branch, zone, debt_class, debt_balance, reserve_pct,
                recognition, overdue_15m, next_due, subsidy, commitment_date
         FROM customers WHERE cif IN (${placeholders})`
      ).bind(...batch).all();
      (rows.results || []).forEach(r => current.set(r.cif, r));
    }

    // เทียบทีละ CIF → เขียนเฉพาะที่เปลี่ยนจริง (เท่าเดิม = ข้าม ไม่เปลืองโควต้า)
    let updated = 0;
    let added = 0;
    let skipped = 0;
    const statements = [];
    const fieldDiff = {}; // ช่อง → จำนวนรายที่เปลี่ยน (โชว์บนจอ preview)

    for (const cif of cifList) {
      const s = summaries[cif];
      const cur = current.get(cif);
      if (cur && !cur.deleted) {
        const diff = debtDiff(cur, s);
        if (diff.length === 0) { skipped++; continue; }
        diff.forEach(f => { fieldDiff[f] = (fieldDiff[f] || 0) + 1; });
        statements.push(
          env.BFR_DB.prepare(
            `UPDATE customers SET
              debt_class = ?,
              zone = ?,
              branch = ?,
              debt_balance = ?,
              reserve_pct = ?,
              recognition = ?,
              overdue_15m = ?,
              next_due = ?,
              subsidy = ?,
              commitment_date = ?,
              debt_updated_at = ?,
              updated_at = ?
            WHERE cif = ?`
          ).bind(
            s.debtClass,
            s.zone || '',
            s.branch || '',
            s.debtBalance,
            s.reservePct,
            s.recognition,
            s.overdue15m,
            s.nextDue,
            s.subsidy,
            s.commitmentDate,
            now,
            now,
            cif
          )
        );
        updated++;
      } else if (!cur) {
        // INSERT ลูกค้าใหม่
        statements.push(
          env.BFR_DB.prepare(
            `INSERT INTO customers (
              cif, name, zone, branch, debt_class, debt_balance, reserve_pct,
              recognition, overdue_15m, next_due, subsidy, commitment_date,
              debt_updated_at, risk_level, deleted, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclassified', 0, 'Debt-Import', ?, ?)`
          ).bind(
            cif,
            (s.name || '').trim(),
            (s.zone || '').trim(),
            (s.branch || '').trim(),
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
      } else {
        // CIF อยู่ในถังขยะ (deleted=1) — ข้าม (กันชน PK) นับเป็นข้าม
        skipped++;
      }
    }

    // ล้างข้อมูลหนี้ของ CIF ที่ไม่อยู่ในไฟล์ใหม่ (เฉพาะที่ยังมีหนี้ค้าง — ล้างแล้วข้าม)
    // ⛔ ห้ามล้างข้ามสาขา: ไฟล์แต่ละรอบเป็นของสาขาเดียว → ล้างเฉพาะ CIF ที่ branch ตรงกับในไฟล์
    let cleared = 0;
    if (cifList.length > 0) {
      try {
        const cifSet = new Set(cifList);
        const fileBranches = new Set(cifList.map(c => (summaries[c].branch || '').trim()).filter(Boolean));
        const existingDebtRows = await env.BFR_DB.prepare(
          `SELECT cif, branch, debt_class, debt_balance, reserve_pct, recognition,
                  overdue_15m, next_due, subsidy, commitment_date
           FROM customers WHERE deleted = 0 AND created_by = 'Debt-Import'`
        ).all();
        const toClear = (existingDebtRows.results || [])
          .filter(r => !cifSet.has(r.cif) && (fileBranches.size === 0 || fileBranches.has((r.branch || '').trim())) && !isDebtClean(r))
          .map(r => r.cif);
        for (let i = 0; i < toClear.length; i += 90) {
          const chunk = toClear.slice(i, i + 90);
          const ph = chunk.map(() => '?').join(',');
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
                debt_updated_at = ?,
                updated_at = ?
              WHERE cif IN (${ph})`
            ).bind(now, now, ...chunk)
          );
        }
        cleared = toClear.length;
      } catch (e) {
        console.warn('clear stale debt skip:', e.message);
      }
    }

    const estimatedWrites = statements.length;
    const quota = await getWriteBudget(env);

    // โหมดวิเคราะห์: ตอบอย่างเดียว ไม่เขียน D1/KV ไม่นับโควต้า
    if (dryrun) {
      const fieldTh = {};
      for (const [f, n] of Object.entries(fieldDiff)) fieldTh[FIELD_TH[f] || f] = n;
      return new Response(JSON.stringify({
        success: true, dryrun: true,
        total_contracts: contracts.length,
        unique_cifs: cifList.length,
        will_update: updated,
        will_add: added,
        will_skip_identical: skipped,
        will_clear: cleared,
        field_diff: fieldTh,
        estimated_writes: estimatedWrites,
        quota,
      }), { status: 200 });
    }

    // โหมดเขียนจริง: เช็คโควต้าก่อน (กันล็อก 100k/วัน)
    if (quota.blockBulk || estimatedWrites > quota.remaining) {
      return new Response(JSON.stringify({
        success: false,
        error: `โควต้าเขียนวันนี้ไม่พอ (ใช้ไป ${quota.used.toLocaleString()}/${quota.limit.toLocaleString()} เหลือ ${quota.remaining.toLocaleString()} แต่รอบนี้ต้องเขียน ~${estimatedWrites.toLocaleString()} แถว) — รอพรุ่งนี้เช้า 07:00 หรืออัพไฟล์ที่เล็กลง`,
        quota, estimated_writes: estimatedWrites,
      }), { status: 429 });
    }

    // Execute batch (D1 batch API — batch ละ 100 statements)
    if (statements.length > 0) {
      for (let i = 0; i < statements.length; i += 100) {
        const chunk = statements.slice(i, i + 100);
        await env.BFR_DB.batch(chunk);
      }
    }
    await trackWrites(env, estimatedWrites, 'debt-import');
    const quotaAfter = await getWriteBudget(env);

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
      skipped_identical: skipped,
      cleared,
      field_diff: Object.fromEntries(Object.entries(fieldDiff).map(([f, n]) => [FIELD_TH[f] || f, n])),
      estimated_writes: estimatedWrites,
      quota: quotaAfter,
      zones_synced: cifList.filter(c => summaries[c] && summaries[c].zone).length,
      debt_rows: debtRows.length,
      kv_written: kvWritten,
      debt_updated_at: now,
    }), { status: 200 });

  } catch (error) {
    console.error('Debt import error:', error);
    return new Response(JSON.stringify({ error: 'Import failed: ' + error.message }), { status: 500 });
  }
}