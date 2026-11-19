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
const COL_POTENTIAL = 14;         // ศักยภาพรายคน (เขียว/เหลือง/แดง) — หัวตารางจริงก่อน ถ้าไม่เจอใช้ตำแหน่งนี้
const COL_POTENTIAL_CONTRACT = 15; // ศักยภาพรายสัญญา (เขียว/เหลือง/แดง)

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

// วัน DD/MM/YYYY → timestamp สำหรับ compare (ว่าง/ผิดรูป = Infinity → ไม่มีวันชนะวันที่จริง)
function dueKey(d) {
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) : Infinity;
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

// กลุ่มสีศักยภาพลูกหนี้ (เขียว/เหลือง/แดง) — ฟีดเข้าบล็อก "แยกตามกลุ่มสี" ของแท็บสรุปข้อมูล
// เดิมระบบไม่อ่านคอลัมน์นี้เลย → สาขาที่อัพใหม่ (เช่น บ้านสร้าง 291) ไม่มีสีขึ้นในหน้าสรุป
const COLOR_RANK = { 'เขียว': 1, 'เหลือง': 2, 'แดง': 3 };
function colorOf(v) {
  const s = String(v || '').trim();
  return COLOR_RANK[s] ? s : '';
}
function worstColor(a, b) {
  return (COLOR_RANK[a] || 0) >= (COLOR_RANK[b] || 0) ? (a || b) : b;
}
function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length < 3) return { rows: [], fileMY: null };

  // แถว0 = หัวรายงาน, แถว1 = ชื่อคอลัมน์, แถว2+ = ข้อมูล
  const fileMY = fileMonthYear(lines[0]);
  // ตำแหน่งคอลัมน์สี: หาจากหัวตารางจริง (ไฟล์แต่ละสาขาอาจเลื่อนคอลัมน์) — ไม่เจอจึงใช้ค่ามาตรฐาน
  const hdr = splitCsvLine(lines[1] || '');
  const findCol = (re, fallback) => { const i = hdr.findIndex(h => re.test(h)); return i >= 0 ? i : fallback; };
  const colPot = findCol(/ศักยภาพรายคน/, COL_POTENTIAL);
  const colPotC = findCol(/ศักยภาพรายสัญญา/, COL_POTENTIAL_CONTRACT);
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
      potential: colorOf(cols[colPot]),
      potentialC: colorOf(cols[colPotC]),
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
    let pot = '';   // กลุ่มสีศักยภาพ (เอารุนแรงสุดในสัญญาทั้งหมด) — ฟีดบล็อกสีในแท็บสรุป

    const contracts = items.map(c => {
      const t = tierNum(c.debtClass);
      if (t > maxTier) maxTier = t;
      totalDebt += c.debtBalance || 0;
      pot = worstColor(pot, worstColor(c.potential || '', c.potentialC || ''));
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
        pot: c.potential || '',
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
      potential: pot,
    };

    debtRows.push({
      cif,
      total_debt: totalDebt,
      branch: (summaries[cif] && summaries[cif].branch) || '',
      zone: (summaries[cif] && summaries[cif].zone) || '',
      commitment_date: (summaries[cif] && summaries[cif].commitmentDate) || '',
      gb: (summaries[cif] && summaries[cif].gb) || '',
      potential: (summaries[cif] && summaries[cif].potential) || '',
      num_contracts: items.length,
      max_tier: maxTier,
      earliest_due: earliestDue,
      is_omsom: items.some(c => /3080|2838|2751/.test(c.marketCode || '')),
      contracts,
    });
  }

  return { summaries, debtRows };
}

import { extractBearerToken, verifyHS256, jwtSecret } from '../_lib/jwt.js';
import { extractBaacCode, toBaacCode, BRANCHES } from '../_lib/branches.js';
import { canManageUsers } from '../_lib/authz.js';
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
  // สีศักยภาพ: อัปเดตเมื่อไฟล์มีค่า (ไฟล์เก่าที่ไม่มีคอลัมน์สีต้องไม่ลบสีเดิมทิ้ง)
  if (str(s.potential) && str(cur.potential) !== str(s.potential)) out.push('potential');
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
  const __secret = jwtSecret(env, request);
  if (!__secret) return new Response(JSON.stringify({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ (BFR_JWT_SECRET)' }), { status: 500 });
  const payload = await verifyHS256(token, __secret);
  if (!payload) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
  if (!canManageUsers(payload)) return new Response(JSON.stringify({ error: 'ต้องเป็นแอดมินหรือผู้ดูแลสาขา' }), { status: 403 });

  // ===== ขอบเขตสาขา (16 พ.ย.69): แอดมินกลาง = ทุกสาขา · ผู้ดูแลสาขา = เฉพาะสาขาตัวเอง =====
  // ไฟล์ CI มีคอลัมน์สาขา (COL_2) — แถวสาขาอื่นถูกข้าม ไม่แตะข้อมูลเขา
  const isSuper = payload.role === 'admin';
  let actorBaac = '';
  if (!isSuper) {
    let branches = BRANCHES;
    try {
      const rawB = env.BFR_KV && await env.BFR_KV.get('branches:all');
      if (rawB) branches = JSON.parse(rawB);
    } catch { /* ใช้ค่า default */ }
    actorBaac = String(toBaacCode(payload.branch, branches) || '').trim();
    if (!actorBaac) return new Response(JSON.stringify({ error: 'บัญชีนี้ยังไม่ผูกสาขา — อัพโหลดไฟล์หนี้ไม่ได้' }), { status: 400 });
  }

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
    const parsed = parseCSV(text);
    const fileMY = parsed.fileMY;
    let contracts = parsed.rows;
    if (!fileMY) {
      return new Response(JSON.stringify({ error: 'อ่านวันที่ไฟล์ไม่ได้ (แถวแรกต้องมี \"ข้อมูล ณ DD/MM/YYYY\")' }), { status: 400 });
    }
    if (contracts.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid contracts found in CSV' }), { status: 400 });
    }

    // ===== ผู้ดูแลสาขา: เก็บเฉพาะแถวของสาขาตัวเอง =====
    // แถวไม่มีสาขา = ไม่รู้ว่าเป็นของใคร → ข้าม (กันเขียนทับป้ายสาขาผิดคน)
    let ignoredOtherBranch = 0;
    let ignoredNoBranch = 0;
    if (actorBaac) {
      const own = [];
      for (const c of contracts) {
        const b = String(c.branch || '').trim();
        if (!b) { ignoredNoBranch++; continue; }
        if (b === actorBaac) own.push(c);
        else ignoredOtherBranch++;
      }
      if (own.length === 0) {
        return new Response(JSON.stringify({
          error: `ไม่พบข้อมูลของสาขานี้ในไฟล์ (ต้องการสาขา ${actorBaac}) — ไฟล์มีสาขาอื่น ${ignoredOtherBranch} แถว` +
                 (ignoredNoBranch ? ` และไม่มีข้อมูลสาขา ${ignoredNoBranch} แถว` : ''),
        }), { status: 400 });
      }
      contracts = own;
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

    // เติมสาขาให้แถวที่ไฟล์ไม่มีคอลัมน์สาขา — ใช้สาขาเดิมใน D1 (กันแถวไม่มีป้ายหลุดข้ามสาขา)
    let branchFilled = 0;
    for (const row of debtRows) {
      if (String(row.branch || '').trim()) continue;
      const cur = current.get(String(row.cif));
      const b = cur && cur.branch ? String(cur.branch).trim() : '';
      if (b) {
        row.branch = b;
        if (summaries[row.cif]) summaries[row.cif].branch = b;
        branchFilled++;
      }
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
              potential = COALESCE(NULLIF(?, ''), potential),
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
            s.potential || '',
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
              recognition, overdue_15m, next_due, subsidy, commitment_date, potential,
              debt_updated_at, risk_level, deleted, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclassified', 0, 'Debt-Import', ?, ?)`
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
            s.potential || '',
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
    // ⛔ ทุกบทบาท (รวมแอดมินกลาง): ไฟล์ต้องครบ ≥80% ของหนี้ค้างในสาขานั้นก่อนจึงล้างได้
    //    — กันอัพไฟล์บางส่วน/ผิดไฟล์ แล้วลบหนี้ทั้งสาขาทิ้ง
    let cleared = 0;
    let clearSkipped = '';
    const cifSet = new Set(cifList);
    const fileBranches = actorBaac
      ? new Set([actorBaac])
      : new Set(cifList.map(c => (summaries[c].branch || '').trim()).filter(Boolean));
    const debtBranchOf = new Map(); // cif → แถว D1 ที่ยัง active + มีข้อมูลหนี้ (ทุกช่องทางที่เขียน D1)
    const blockedBranches = new Map(); // branch → ข้อความอธิบายว่าทำไมงดล้าง
    if (cifList.length > 0) {
      try {
        // เดิมกรอง created_by = 'Debt-Import' → แถวที่ถูกลบ/ถูกสร้างจากช่องทางอื่นไม่ถูกจับ
        // → แถวนั้นไม่ถูกตัดออกจากคลัง KV และค้างเป็นการ์ดผีตลอดกาล (16 พ.ย.69)
        const existingDebtRows = await env.BFR_DB.prepare(
          `SELECT cif, branch, debt_class, debt_balance, reserve_pct, recognition,
                  overdue_15m, next_due, subsidy, commitment_date
           FROM customers WHERE deleted = 0
             AND (debt_balance != 0 OR debt_class != '' OR reserve_pct != ''
                  OR recognition != '' OR overdue_15m != '' OR next_due != ''
                  OR subsidy != '' OR commitment_date != '')`
        ).all();
        const existing = existingDebtRows.results || [];
        existing.forEach(r => debtBranchOf.set(String(r.cif), r));

        // นับหนี้ค้างต่อสาขา (เฉพาะที่ยังไม่ถูกล้าง) เพื่อเช็คความครบของไฟล์
        const existingByBranch = {};
        for (const r of existing) {
          if (isDebtClean(r)) continue;
          const b = String(r.branch || '').trim() || '_none';
          existingByBranch[b] = (existingByBranch[b] || 0) + 1;
        }
        const fileByBranch = {};
        for (const cif of cifList) {
          const b = String((summaries[cif] && summaries[cif].branch) || '').trim() || '_none';
          fileByBranch[b] = (fileByBranch[b] || 0) + 1;
        }
        const guardTargets = fileBranches.size > 0 ? [...fileBranches] : Object.keys(existingByBranch);
        for (const b of guardTargets) {
          const have = existingByBranch[b] || 0;
          const got = fileByBranch[b] || 0;
          if (have >= 10 && got < Math.floor(have * 0.8)) {
            blockedBranches.set(b, `สาขา ${b === '_none' ? '(ไม่ระบุ)' : b}: ไฟล์มี ${got} ราย แต่มีหนี้ค้าง ${have} ราย`);
          }
        }
        if (blockedBranches.size > 0) {
          clearSkipped = [...blockedBranches.values()].join(' · ') + ' — ข้ามการล้างข้อมูลเก่า (กันไฟล์ไม่ครบ)';
        }
        const clearBranchOk = (b) => {
          const bb = String(b || '').trim() || '_none';
          if (blockedBranches.has(bb)) return false;
          if (fileBranches.size === 0) return true;
          return fileBranches.has(String(b || '').trim());
        };
        const toClear = existing
          .filter(r => !cifSet.has(r.cif) && !isDebtClean(r) && clearBranchOk(r.branch))
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
        // เก็บไว้ใช้ตัดแถวในคลัง KV รอบนี้ (ต้องเป็นชุดเดียวกับที่ล้าง D1 เป๊ะ)
        var clearBranchOkFn = clearBranchOk;
      } catch (e) {
        console.warn('clear stale debt skip:', e.message);
      }
    }

    const estimatedWrites = statements.length;
    const quota = await getWriteBudget(env);

    // รวมคลังการ์ดหนี้ (KV debt:data) แบบเดียวกับกฎล้าง D1 — ห้ามเขียนทับทั้งก้อน
    // (17 ต.ค.69: ไฟล์ 145 ทับคลังทั้งก้อน → การ์ด 854 หายเกลี้ยง ทั้งที่ D1 ยังอยู่)
    let kvPrev = [];
    if (env.BFR_KV) {
      try { kvPrev = JSON.parse((await env.BFR_KV.get('debt:data')) || '[]'); } catch (e) { kvPrev = []; }
    }
    const kvMerged = new Map();
    for (const r of kvPrev) if (r && r.cif != null) kvMerged.set(String(r.cif), r);
    // แถวใหม่ที่ยังไม่มีสาขา → ใช้สาขาของแถวเดิมในคลัง (กันเขียนทับป้ายสาขาด้วยค่าว่าง)
    for (const r of debtRows) {
      if (String(r.branch || '').trim()) continue;
      const prev = kvMerged.get(String(r.cif));
      if (prev && String(prev.branch || '').trim()) { r.branch = String(prev.branch).trim(); branchFilled++; }
    }
    for (const r of debtRows) kvMerged.set(String(r.cif), r);
    let kvDropped = 0;
    for (const cif of [...kvMerged.keys()]) {
      if (cifSet.has(cif)) continue;
      const d = debtBranchOf.get(cif);
      const kvRow = kvMerged.get(cif);
      // ใช้สาขาจาก D1 ก่อน — ถ้าแถวถูกลบใน D1 ไปแล้ว ให้ใช้ป้ายสาขาของแถวในคลังเอง
      // (บั๊กเดิม: d ไม่มี → b='' → ไม่ผ่านเงื่อนไขสาขา → แถวผีค้างตลอด)
      const b = String((d && d.branch) || (kvRow && kvRow.branch) || '').trim();
      const inScope = typeof clearBranchOkFn === 'function' ? clearBranchOkFn(b)
        : (fileBranches.size === 0 || fileBranches.has(b));
      if (inScope) { kvMerged.delete(cif); kvDropped++; }
    }
    const kvFinal = [...kvMerged.values()];
    const kvKept = kvFinal.length - debtRows.length;
    // แถวที่ยังไม่รู้สาขา = พนักงานจะไม่เห็น (admin ยังเห็น) — โชว์ในผลอัพเพื่อไม่ให้หายเงียบ
    const kvNoBranch = kvFinal.filter(r => !String((r && r.branch) || '').trim()).length;

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
        kv_total: kvFinal.length, kv_kept: kvKept, kv_dropped: kvDropped,
        branch_filled: branchFilled,
        kv_no_branch: kvNoBranch,
        field_diff: fieldTh,
        estimated_writes: estimatedWrites,
        quota,
        scope_branch: actorBaac,
        ignored_other_branch: ignoredOtherBranch,
        ignored_no_branch: ignoredNoBranch,
        clear_skipped: clearSkipped,
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
    // D1-SAVER (18ต.ค.69): อัพหนี้เปลี่ยน next_due → ล้างแคชเดือนหนี้ (คู่กับ debt-sync-full)
    try {
      if (env.BFR_KV && (updated > 0 || added > 0 || cleared > 0)) {
        await env.BFR_KV.delete('meta:debt-months');
        await env.BFR_KV.delete('meta:debt-months-updated');
      }
    } catch (e) { /* miss ครั้งหน้า recompute เอง */ }
    const quotaAfter = await getWriteBudget(env);

    // เขียนคลังการ์ดหนี้ลง KV → หน้าแผนที่อ่านข้อมูลล่าสุด
    // 18 พ.ย.69 (root cause: คลังรวมใหญ่เกิน ล้มเงียบ → สาขาใหม่ไม่ขึ้น):
    //   เขียนแยกคีย์ตามสาขา `debt:data:b:<baac>` (ก้อนละไม่กี่ MB) เป็นหลัก
    //   + พยายามเขียนคลังรวม `debt:data` เป็นสำรอง (ถ้าใหญ่เกินขีด KV จะข้าม ไม่ทำให้ทั้งงานล้ม)
    let kvWritten = false, kvBackup = '', kvError = '', kvCombined = 'ok', kvBranchKeys = 0;
    if (env.BFR_KV) {
      try {
        // สำรองของเดิมก่อนทุกครั้ง (17 ต.ค.69 — ระบบกันหาย: อัพแล้วกู้คืนได้เสมอ)
        if (kvPrev.length > 0) {
          kvBackup = 'debt:data:backup:' + now.slice(0, 10);
          try { await env.BFR_KV.put(kvBackup, JSON.stringify(kvPrev)); } catch (e) { console.warn('backup skip:', e.message); }
        }

        // ===== แยกตามสาขา =====
        const byBranch = new Map();
        const noBranchRows = [];
        for (const r of kvFinal) {
          const b = String((r && r.branch) || '').trim();
          if (!b) { noBranchRows.push(r); continue; }
          if (!byBranch.has(b)) byBranch.set(b, []);
          byBranch.get(b).push(r);
        }
        for (const [b, rows] of byBranch) {
          try {
            await env.BFR_KV.put('debt:data:b:' + b, JSON.stringify(rows));
            kvBranchKeys++;
          } catch (e) {
            kvError += `สาขา ${b}: ${e.message}; `;
          }
        }
        // แถวไม่ระบุสาขา: เก็บคีย์แยก (แอดมินกลางอ่านรวมได้)
        if (noBranchRows.length) {
          try { await env.BFR_KV.put('debt:data:b:_none', JSON.stringify(noBranchRows)); kvBranchKeys++; }
          catch (e) { kvError += `ไม่มีสาขา: ${e.message}; `; }
        }
        // สารบัญสาขา (ให้ /api/debt-data รู้ว่ามีกี่สาขา ไม่ต้อง list keys)
        try {
          const index = [...byBranch.entries()].map(([b, rows]) => ({ branch: b, count: rows.length }));
          if (noBranchRows.length) index.push({ branch: '_none', count: noBranchRows.length });
          await env.BFR_KV.put('debt:index', JSON.stringify(index));
        } catch (e) { /* index เป็นของเสริม */ }

        // ===== คลังรวม (สำรอง/ของเดิม) =====
        // KV จำกัดค่าต่อคีย์ 25 MiB → ถ้า JSON ใหญ่เกิน 20 MB ให้ข้าม แล้วพึ่งคีย์แยกสาขาแทน
        const combined = JSON.stringify(kvFinal);
        if (combined.length > 20 * 1024 * 1024) {
          kvCombined = 'skipped_too_large';
          console.warn('debt:data combined too large, skip:', combined.length);
        } else {
          try { await env.BFR_KV.put('debt:data', combined); }
          catch (e) { kvCombined = 'error: ' + e.message; kvError += 'รวม: ' + e.message; }
        }

        await env.BFR_KV.put('debt:updated', now);
        kvWritten = kvBranchKeys > 0;
      } catch (e) {
        console.warn('KV write debt failed:', e.message);
        kvError = e.message;
      }
    }

    // ===== ตรวจความถูกต้องหลังอัพ (16 พ.ย.69) =====
    // เทียบยอดในคลัง KV กับ D1 ต่อสาขา — ต่างเกิน 1 บาท = เตือนทันที ไม่ปล่อยผ่านเงียบ ๆ
    let verify = null, verifyOk = null;
    try {
      const g = await env.BFR_DB.prepare(
        `SELECT COALESCE(NULLIF(branch, ''), '_none') b, COUNT(*) n, SUM(COALESCE(debt_balance, 0)) s
         FROM customers WHERE deleted = 0
           AND (debt_balance != 0 OR debt_class != '' OR reserve_pct != ''
                OR recognition != '' OR overdue_15m != '' OR next_due != ''
                OR subsidy != '' OR commitment_date != '')
         GROUP BY b`
      ).all();
      const d1by = {};
      for (const r of (g.results || [])) d1by[r.b] = { n: +r.n || 0, s: +r.s || 0 };
      const kvby = {};
      for (const r of kvFinal) {
        const b = String((r && r.branch) || '').trim() || '_none';
        if (!kvby[b]) kvby[b] = { n: 0, s: 0 };
        kvby[b].n++;
        kvby[b].s += (+r.total_debt || 0);
      }
      verify = {};
      verifyOk = true;
      for (const b of new Set([...Object.keys(d1by), ...Object.keys(kvby)])) {
        const a = d1by[b] || { n: 0, s: 0 };
        const k = kvby[b] || { n: 0, s: 0 };
        const diff = Math.round((k.s - a.s) * 100) / 100;
        verify[b] = { d1_n: a.n, kv_n: k.n, d1_baht: Math.round(a.s), kv_baht: Math.round(k.s), diff_baht: diff };
        if (Math.abs(diff) > 1 || a.n !== k.n) verifyOk = false;
      }
    } catch (e) {
      verify = { error: e.message };
      verifyOk = null;
    }

    // เก็บผลรอบล่าสุดไว้ debug (เล็ก ไม่กี่ร้อยไบต์)
    try {
      if (env.BFR_KV) await env.BFR_KV.put('debt:last-import', JSON.stringify({
        at: now, by: payload.username, scope: actorBaac,
        updated, added, cleared, kv_total: kvFinal.length,
        kv_written: kvWritten, kv_combined: kvCombined, kv_branch_keys: kvBranchKeys, kv_error: kvError,
        kv_dropped: kvDropped, verify_ok: verifyOk, verify,
      }));
    } catch {}

    return new Response(JSON.stringify({
      success: true,
      total_contracts: contracts.length,
      unique_cifs: cifList.length,
      updated,
      added,
      skipped_identical: skipped,
      cleared,
      kv_total: kvFinal.length, kv_kept: kvKept, kv_dropped: kvDropped, kv_backup: kvBackup,
      kv_written: kvWritten, kv_combined: kvCombined, kv_branch_keys: kvBranchKeys, kv_error: kvError,
      branch_filled: branchFilled,
      kv_no_branch: kvNoBranch,
      field_diff: Object.fromEntries(Object.entries(fieldDiff).map(([f, n]) => [FIELD_TH[f] || f, n])),
      estimated_writes: estimatedWrites,
      quota: quotaAfter,
      zones_synced: cifList.filter(c => summaries[c] && summaries[c].zone).length,
      debt_rows: debtRows.length,
      debt_updated_at: now,
      scope_branch: actorBaac,
      ignored_other_branch: ignoredOtherBranch,
      ignored_no_branch: ignoredNoBranch,
      clear_skipped: clearSkipped,
      verify_ok: verifyOk,
      verify,
    }), { status: 200 });

  } catch (error) {
    console.error('Debt import error:', error);
    return new Response(JSON.stringify({ error: 'Import failed: ' + error.message }), { status: 500 });
  }
}