/**
 * GET/POST /api/admin/debt-verify (admin เท่านั้น)
 * ตรวจความถูกต้องของคลังการ์ดหนี้ (KV) เทียบกับฐานข้อมูลจริง (D1)
 *  - GET  : รายงานต่อสาขา: จำนวน/ยอดใน D1 vs KV + แถวผี (KV มี D1 ไม่มี/ลบแล้ว) + แถวหาย (D1 มีหนี้ KV ไม่มี)
 *  - POST : { fix_ghosts: true } → ลบเฉพาะ "แถวผี" ออกจาก KV (ปลอดภัย: D1 เป็นตัวตัดสิน) แล้วรายงานผล
 *
 * ใช้เป็นตาข่ายกันพลาดแทนการเดา: ไม่มีการสร้างแถวใหม่/เดายอด — แถวที่หายต้องอัพไฟล์ CI ของสาขานั้น
 */

import { extractBearerToken, verifyHS256, jwtSecret } from '../../_lib/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function checkAdmin(request, env) {
  const token = extractBearerToken(request);
  if (!token) return { error: 'No token', status: 401 };
  const secret = jwtSecret(env, request);
  if (!secret) return { error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสลับ (BFR_JWT_SECRET)', status: 500 };
  const payload = await verifyHS256(token, secret);
  if (!payload) return { error: 'Invalid token', status: 401 };
  if (payload.role !== 'admin') return { error: 'ต้องเป็น Admin เท่านั้น', status: 403 };
  return { user: payload };
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function loadKv(env) {
  let rows = [];
  try { rows = JSON.parse((await env.BFR_KV.get('debt:data')) || '[]'); } catch { rows = []; }
  if (!Array.isArray(rows) || rows.length === 0) {
    // คลังรวมถูกข้าม (ใหญ่เกิน) → รวมจากคีย์แยกสาขา
    rows = [];
    try {
      const idx = JSON.parse((await env.BFR_KV.get('debt:index')) || '[]');
      for (const x of (Array.isArray(idx) ? idx : [])) {
        const raw = await env.BFR_KV.get('debt:data:b:' + x.branch);
        if (!raw) continue;
        const part = JSON.parse(raw);
        if (Array.isArray(part)) rows.push(...part);
      }
    } catch { /* คืนเท่าที่อ่านได้ */ }
  }
  return Array.isArray(rows) ? rows : [];
}

async function compare(env) {
  const kv = await loadKv(env);
  const kvMap = new Map();
  for (const r of kv) if (r && r.cif != null) kvMap.set(String(r.cif).trim(), r);

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

  const all = await env.BFR_DB.prepare(
    `SELECT cif, COALESCE(NULLIF(branch, ''), '_none') b, debt_balance
     FROM customers WHERE deleted = 0
       AND (debt_balance != 0 OR debt_class != '' OR reserve_pct != ''
            OR recognition != '' OR overdue_15m != '' OR next_due != ''
            OR subsidy != '' OR commitment_date != '')`
  ).all();
  const d1cif = new Set();
  for (const r of (all.results || [])) d1cif.add(String(r.cif));

  const kvby = {};
  const ghosts = [];
  for (const [cif, r] of kvMap) {
    const b = String((r && r.branch) || '').trim() || '_none';
    if (!kvby[b]) kvby[b] = { n: 0, s: 0 };
    kvby[b].n++;
    kvby[b].s += num(r.total_debt);
    if (!d1cif.has(cif)) ghosts.push({ cif, branch: b, total_debt: num(r.total_debt) });
  }

  const perBranch = {};
  for (const b of new Set([...Object.keys(d1by), ...Object.keys(kvby)])) {
    const a = d1by[b] || { n: 0, s: 0 };
    const k = kvby[b] || { n: 0, s: 0 };
    perBranch[b] = {
      d1_n: a.n, kv_n: k.n,
      d1_baht: Math.round(a.s), kv_baht: Math.round(k.s),
      diff_baht: Math.round((k.s - a.s) * 100) / 100,
    };
  }
  const missing = [...d1cif].filter(c => !kvMap.has(c)).length;
  const ok = Object.values(perBranch).every(v => Math.abs(v.diff_baht) <= 1 && v.d1_n === v.kv_n);
  return { kv, kvMap, perBranch, ghosts, missing, ok };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await checkAdmin(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, auth.status);
  if (!env.BFR_KV || !env.BFR_DB) return json({ success: false, error: 'KV/D1 ไม่พร้อม' }, 500);
  const r = await compare(env);
  return json({
    success: true,
    ok: r.ok,
    per_branch: r.perBranch,
    ghost_count: r.ghosts.length,
    ghost_baht: Math.round(r.ghosts.reduce((s, g) => s + g.total_debt, 0)),
    missing_count: r.missing,
    checked_at: new Date().toISOString(),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await checkAdmin(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, auth.status);
  if (!env.BFR_KV || !env.BFR_DB) return json({ success: false, error: 'KV/D1 ไม่พร้อม' }, 500);
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  if (!body.fix_ghosts) return json({ success: false, error: 'ระบุ fix_ghosts: true เพื่อยืนยันการลบแถวผี' }, 400);

  const before = await compare(env);
  if (before.ghosts.length === 0) {
    return json({ success: true, removed: 0, message: 'ไม่พบแถวผี — ข้อมูลตรงกันอยู่แล้ว', ok: before.ok, per_branch: before.perBranch });
  }

  // สำรองคลังก่อนแก้ (กู้คืนได้ผ่าน /api/admin/debt-restore)
  const stamp = new Date().toISOString().slice(0, 10);
  try { await env.BFR_KV.put('debt:data:backup:' + stamp + '-verify', JSON.stringify(before.kv)); } catch { /* สำรองล้มไม่ควรบล็อก แต่รายงาน */ }

  const ghostSet = new Set(before.ghosts.map(g => g.cif));
  const kept = before.kv.filter(r => !ghostSet.has(String(r.cif).trim()));

  const byBranch = new Map();
  const none = [];
  for (const r of kept) {
    const b = String((r && r.branch) || '').trim();
    if (!b) { none.push(r); continue; }
    if (!byBranch.has(b)) byBranch.set(b, []);
    byBranch.get(b).push(r);
  }
  for (const [b, rows] of byBranch) await env.BFR_KV.put('debt:data:b:' + b, JSON.stringify(rows));
  if (none.length) await env.BFR_KV.put('debt:data:b:_none', JSON.stringify(none));
  const index = [...byBranch.entries()].map(([b, rows]) => ({ branch: b, count: rows.length }));
  if (none.length) index.push({ branch: '_none', count: none.length });
  await env.BFR_KV.put('debt:index', JSON.stringify(index));
  const combined = JSON.stringify(kept);
  let combinedWritten = false;
  if (combined.length < 20 * 1024 * 1024) {
    try { await env.BFR_KV.put('debt:data', combined); combinedWritten = true; } catch { combinedWritten = false; }
  }
  await env.BFR_KV.put('debt:updated', new Date().toISOString());

  const after = await compare(env);
  return json({
    success: true,
    removed: before.ghosts.length,
    removed_baht: Math.round(before.ghosts.reduce((s, g) => s + g.total_debt, 0)),
    backup: 'debt:data:backup:' + stamp + '-verify',
    combined_written: combinedWritten,
    ok: after.ok,
    per_branch: after.perBranch,
    ghost_count: after.ghosts.length,
    missing_count: after.missing,
  });
}
