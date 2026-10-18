// KPI Calculator API — /api/kpi (KV-backed, prefix kpi: — ไม่แตะข้อมูล field-route เดิม)
const PRESETS = [
  ['2.งานยุทธศาสตร์', '2.1', 'เงินรับฝากเพิ่ม (Deposit Growth)', 'ล้านบาท', 3, 11, [7, 8, 9, 10, 11]],
  ['2.งานยุทธศาสตร์', '2.2', 'รายได้ค่าธรรมเนียม + เงินฝากสงเคราะห์ชีวิต', 'ล้านบาท', 3, 4.4, [2.88684, 3.2076, 3.564, 3.96, 4.4]],
  ['2.งานยุทธศาสตร์', '2.3', 'SME เกษตรหัวขบวนได้รับการพัฒนา', 'ราย', 3.5, 2, [0, 1, 1, 2, 2]],
  ['2.งานยุทธศาสตร์', '2.4', 'SME หัวขบวนรายได้/ธุรกิจเพิ่ม ≥10%', 'ราย', 3.5, 2, [0, 1, 1, 2, 2]],
  ['3.งานประจำ', '3.1', 'สินเชื่อ ESG', 'ล้านบาท', 3, 3.26, [2.138886, 2.37654, 2.6406, 2.934, 3.26]],
  ['3.งานประจำ', '3.2', 'รับลูกค้าสินเชื่อรายใหม่ (603)', 'ราย', 3, 127, [103.44, 108.89, 114.62, 120.65, 127]],
  ['3.งานประจำ', '3.3', 'Normal Port', 'ล้านบาท', 3, 4, [2.6244, 2.916, 3.24, 3.6, 4]],
  ['3.งานประจำ', '3.4', 'Secure Port', 'ล้านบาท', 6, 13.7, [10.2483, 11.0197, 11.8491, 12.741, 13.7]],
  ['3.งานประจำ', '3.5', 'จ่ายสินเชื่อปี 69 (รายไตรมาส)', 'ร้อยละ', 3, 0.03, [-0.06, -0.03, 0, 0.01, 0.03]],
  ['3.งานประจำ', '3.6', 'AA ถัวเฉลี่ยสิ้นปี', 'ร้อยละ', 2, 0.6149, [0.5149, 0.5399, 0.5649, 0.5899, 0.6149]],
  ['3.งานประจำ', '3.8', 'NA (เกณฑ์เงินสด)', 'ล้านบาท', 6, 7.47, [5.976, 6.3495, 6.723, 7.0965, 7.47]],
  ['3.งานประจำ', '3.9', 'Net NPLs (ยิ่งน้อยยิ่งดี)', 'ล้านบาท', 5, 24.4, [34.16, 31.72, 29.28, 26.84, 24.4]],
  ['3.งานประจำ', '3.10', '15 เดือนเป็นเงินสด', 'ร้อยละ', 6, 0.7, [0.58, 0.61, 0.64, 0.67, 0.7]],
  ['3.งานประจำ', '3.11', 'แก้ SM กลับ PL', 'ร้อยละ', 2, 0.05, [0.01, 0.02, 0.03, 0.04, 0.05]],
  ['4.รับชำระหนี้', '4.1', 'รับชำระหนี้สิ้นเดือนที่ 2 (95%)', 'ร้อยละ', 5, 0.95, [0.91, 0.92, 0.93, 0.94, 0.95]],
  ['4.รับชำระหนี้', '4.2', 'รับชำระหนี้สิ้นเดือนที่ 3 (98.5%)', 'ร้อยละ', 5, 0.985, [0.945, 0.955, 0.965, 0.975, 0.985]],
  ['5.FBI', '5', 'รายได้ค่าธรรมเนียม FBI', 'บาท', 1, 800000, [480000, 560000, 640000, 720000, 800000]],
  ['6.งส.', '6', 'เงินฝากสงเคราะห์ชีวิต', 'บาท', 1, 70000, [42000, 49000, 56000, 63000, 70000]],
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
async function getPresets(env) {
  const EVAL_DEFAULT = { '4.1': 'สิ้นเดือนที่ 2', '4.2': 'สิ้นเดือนที่ 3', '3.5': 'รายไตรมาส', '3.6': 'ถัวเฉลี่ยสิ้นปีบัญชี' };
  try {
    const raw = await env.BFR_KV.get('kpi:presets');
    if (raw) return JSON.parse(raw);
  } catch { /* fallback ข้างล่าง */ }
  return PRESETS.map(([section, code, name, unit, full, target, bands], i) => ({
    id: 'p' + i, section, code, name, unit, full, target,
    b1: bands[0], b2: bands[1], b3: bands[2], b4: bands[3], b5: bands[4],
    eval_note: EVAL_DEFAULT[code] || '',
  }));
}
async function mkItems(env) {
  const presets = await getPresets(env);
  return presets.map((p) => ({ ...p, actual: null, actuals: {}, owner: '', action: '', baseline: null, eval_date: null }));
}
async function getBranches(env) {
  try { return JSON.parse((await env.BFR_KV.get('kpi:branches')) || '[]'); } catch { return []; }
}
async function getBranch(env, code) {
  try { return JSON.parse((await env.BFR_KV.get('kpi:branch:' + code)) || 'null'); } catch { return null; }
}
const W61 = [0.9, 0.9, 1.15, 0.9, 0.9, 1.15, 0.9, 0.9, 1.15, 1.15];
const W62 = [0.6, 0.6, 0.8, 0.6, 0.6, 0.8, 0.6, 0.6, 0.8, 0.6, 0.6, 0.8, 0.6, 0.6, 0.8];
function tieredW(w, b, a) {
  if (a === null || a === undefined || a === '') return 0.1;
  const v = Number(a);
  const lo = b[0] > b[4];
  const thr = [b[4], b[3], b[2], b[1], b[0]];
  const pct = [1, 0.8, 0.6, 0.4, 0.2];
  for (let i = 0; i < 5; i++) {
    if (lo ? v <= thr[i] : v >= thr[i]) return Math.round(w * pct[i] * 100) / 100;
  }
  return 0.1;
}
function compo41(bands, arr) {
  if (!Array.isArray(arr) || !arr.some((x) => x !== null && x !== undefined && x !== '')) return null;
  const s = arr.reduce((t, m, i) => t + tieredW(W61[i] || 0, bands, m), 0);
  return Math.round((s / 2) * 1000) / 1000;
}
function compo42(bands, arr) {
  if (!Array.isArray(arr) || !arr.some((x) => x !== null && x !== undefined && x !== '')) return null;
  const s = arr.reduce((t, m, i) => t + tieredW(W62[i] || 0, bands, m), 0);
  return Math.round((s / 2) * 1000) / 1000;
}
function scoreOf(it) {
  const b = [it.b1, it.b2, it.b3, it.b4, it.b5].map(Number);
  if ((it.code === '4.1' || it.code === '4.2') && it.m) {
    const arr = it.code === '4.1' ? it.m.b61 : it.m.b62;
    const c = it.code === '4.1' ? compo41(b, arr) : compo42(b, arr);
    if (c !== null) return c;
  }
  if (it.actual === null || it.actual === undefined || it.actual === '') return null;
  const a = Number(it.actual), full = Number(it.full);
  const lo = b[0] > b[4];
  const thr = [b[4], b[3], b[2], b[1], b[0]];
  const pct = [1, 0.8, 0.6, 0.4, 0.2];
  for (let i = 0; i < 5; i++) {
    if (lo ? a <= thr[i] : a >= thr[i]) return Math.round(full * pct[i] * 100) / 100;
  }
  return 0.1;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  if (action === 'branches') return json({ success: true, branches: await getBranches(env) });
  if (action === 'branch') {
    const b = await getBranch(env, url.searchParams.get('code') || '');
    if (!b) return json({ success: false, error: 'ไม่พบสาขา' }, 404);
    b.items.forEach((it) => { it.score = scoreOf(it); });
    const tf = b.items.reduce((s, i) => s + Number(i.full || 0), 0);
    const tg = b.items.reduce((s, i) => s + (scoreOf(i) || 0), 0);
    return json({ success: true, branch: b, totalFull: Math.round(tf * 100) / 100, totalGot: Math.round(tg * 100) / 100 });
  }
  if (action === 'ranking') {
    const list = await getBranches(env);
    const rows = [];
    for (const br of list) {
      const b = await getBranch(env, br.code);
      if (!b) continue;
      const tf = b.items.reduce((s, i) => s + Number(i.full || 0), 0);
      const tg = b.items.reduce((s, i) => s + (scoreOf(i) || 0), 0);
      const nd = b.items.filter((i) => i.actual !== null && i.actual !== '').length;
      rows.push({ code: br.code, name: br.name, province: br.province || '-', got: Math.round(tg * 100) / 100,
        full: Math.round(tf * 100) / 100, pct: tf ? Math.round((tg / tf) * 1000) / 10 : 0, done: nd + '/' + b.items.length });
    }
    rows.sort((x, y) => y.pct - x.pct);
    return json({ success: true, rows });
  }
  if (action === 'snapshots') {
    const code = url.searchParams.get('code') || '';
    let snaps = [];
    try { snaps = JSON.parse((await env.BFR_KV.get('kpi:snaps:' + code)) || '[]'); } catch { snaps = []; }
    return json({ success: true, snaps });
  }
  if (action === 'presets') return json({ success: true, presets: await getPresets(env) });
  return json({ success: false, error: 'unknown action' }, 400);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
  const op = body.op;
  const list = await getBranches(env);

  if (op === 'upsert-branch') {
    const code = String(body.code || '').trim();
    if (!code) return json({ success: false, error: 'ใส่รหัสสาขา' }, 400);
    if (!list.find((b) => b.code === code)) {
      list.push({ code, name: String(body.name || code), province: String(body.province || '') });
      await env.BFR_KV.put('kpi:branches', JSON.stringify(list));
      await env.BFR_KV.put('kpi:branch:' + code, JSON.stringify({ code, persons: [], items: await mkItems(env), updated: new Date().toISOString() }));
    }
    return json({ success: true });
  }
  const b = await getBranch(env, body.code || '');
  if (!b && !['save-preset', 'add-preset', 'del-preset'].includes(op)) return json({ success: false, error: 'ไม่พบสาขา' }, 404);
  const save = async () => {
    b.updated = new Date().toISOString();
    await env.BFR_KV.put('kpi:branch:' + b.code, JSON.stringify(b));
  };
  if (op === 'save-item') {
    const it = b.items.find((x) => x.id === body.item.id);
    if (!it) return json({ success: false, error: 'ไม่พบหัวข้อ' }, 404);
    ['section', 'code', 'name', 'unit', 'full', 'target', 'b1', 'b2', 'b3', 'b4', 'b5', 'actual', 'actuals', 'm',
     'owner', 'action', 'baseline', 'eval_note', 'eval_date'].forEach((k) => {
      if (body.item[k] !== undefined) it[k] = body.item[k];
    });
    await save();
    return json({ success: true, score: scoreOf(it) });
  }
  if (op === 'add-item') {
    const n = body.item || {};
    b.items.push({ id: 'c' + Date.now(), section: n.section || 'งานเพิ่มเติม', code: n.code || 'X', name: n.name || 'หัวข้อใหม่',
      unit: n.unit || 'ร้อยละ', full: Number(n.full ?? 1), target: Number(n.target ?? 0),
      b1: Number(n.b1 ?? 0), b2: Number(n.b2 ?? 0), b3: Number(n.b3 ?? 0), b4: Number(n.b4 ?? 0), b5: Number(n.b5 ?? 0), actual: null });
    await save();
    return json({ success: true });
  }
  if (op === 'del-item') {
    b.items = b.items.filter((x) => x.id !== body.id);
    await save();
    return json({ success: true });
  }
  if (op === 'reset-branch') {
    b.items = await mkItems(env);
    await save();
    return json({ success: true });
  }
  if (op === 'save-persons') {
    const ps = Array.isArray(body.persons) ? body.persons : [];
    b.persons = ps.filter((p) => p && p.name).map((p, i) => ({ id: p.id || ('u' + Date.now() + i), name: String(p.name).slice(0, 60),
      ...(p.crit && typeof p.crit === 'object' ? { crit: p.crit } : {}) }));
    await save();
    return json({ success: true, persons: b.persons });
  }
  if (op === 'save-person-actual') {
    const it = b.items.find((x) => x.id === body.id);
    if (!it) return json({ success: false, error: 'ไม่พบหัวข้อ' }, 404);
    it.actuals = it.actuals || {};
    if (body.actual === null || body.actual === '') delete it.actuals[body.personId];
    else it.actuals[body.personId] = Number(body.actual);
    await save();
    return json({ success: true });
  }
  if (op === 'del-branch') {
    await env.BFR_KV.delete('kpi:branch:' + b.code);
    await env.BFR_KV.put('kpi:branches', JSON.stringify(list.filter((x) => x.code !== b.code)));
    return json({ success: true });
  }
  if (op === 'save-preset') {
    const ps = await getPresets(env);
    const p = ps.find((x) => x.id === body.preset.id);
    if (!p) return json({ success: false, error: 'ไม่พบหัวข้อตั้งต้น' }, 404);
    ['section', 'code', 'name', 'unit', 'full', 'target', 'b1', 'b2', 'b3', 'b4', 'b5', 'eval_note'].forEach((k) => {
      if (body.preset[k] !== undefined) p[k] = body.preset[k];
    });
    await env.BFR_KV.put('kpi:presets', JSON.stringify(ps));
    return json({ success: true });
  }
  if (op === 'add-preset') {
    const ps = await getPresets(env);
    const n = body.preset || {};
    ps.push({ id: 'c' + Date.now(), section: n.section || 'งานเพิ่มเติม', code: n.code || 'X', name: n.name || 'หัวข้อใหม่',
      unit: n.unit || 'ร้อยละ', full: Number(n.full ?? 1), target: Number(n.target ?? 0),
      b1: Number(n.b1 ?? 0), b2: Number(n.b2 ?? 0), b3: Number(n.b3 ?? 0), b4: Number(n.b4 ?? 0), b5: Number(n.b5 ?? 0),
      eval_note: n.eval_note || '' });
    await env.BFR_KV.put('kpi:presets', JSON.stringify(ps));
    return json({ success: true });
  }
  if (op === 'del-preset') {
    const ps = (await getPresets(env)).filter((x) => x.id !== body.id);
    await env.BFR_KV.put('kpi:presets', JSON.stringify(ps));
    return json({ success: true });
  }
  if (op === 'save-snapshot') {
    const period = String(body.period || new Date().toISOString().slice(0, 7));
    const tf = b.items.reduce((s, i) => s + Number(i.full || 0), 0);
    const tg = b.items.reduce((s, i) => s + (scoreOf(i) || 0), 0);
    let snaps = [];
    try { snaps = JSON.parse((await env.BFR_KV.get('kpi:snaps:' + b.code)) || '[]'); } catch { snaps = []; }
    snaps = snaps.filter((s) => s.period !== period);
    snaps.push({ period, got: Math.round(tg * 100) / 100, full: Math.round(tf * 100) / 100,
      pct: tf ? Math.round((tg / tf) * 1000) / 10 : 0, at: new Date().toISOString() });
    snaps.sort((a, c) => (a.period < c.period ? -1 : 1));
    await env.BFR_KV.put('kpi:snaps:' + b.code, JSON.stringify(snaps));
    return json({ success: true, snaps });
  }
  return json({ success: false, error: 'unknown op' }, 400);
}
