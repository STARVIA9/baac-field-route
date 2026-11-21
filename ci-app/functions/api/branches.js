// GET /api/branches — รายการสาขาจาก KV branches:all (แหล่งเดียวกับการ์ดสาขา)
const json = data => new Response(JSON.stringify(data), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' }
});

export async function onRequestGet({ env }) {
  let branches = [];
  try {
    const raw = env.BAAC_CI_KV ? await env.BAAC_CI_KV.get('branches:all') : null;
    if (raw) branches = JSON.parse(raw);
  } catch { /* ส่งรายการว่างแทนการพังทั้งหน้า */ }
  return json({ ok: true, branches });
}
