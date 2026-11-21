// GET /api/config — ตั้งค่าที่ไม่ใช่ความลับ (ลิงก์ OneDrive)
export async function onRequestGet({ env }) {
  let oneDriveLink = '';
  try {
    const raw = env.BAAC_CI_KV ? await env.BAAC_CI_KV.get('ci:config') : null;
    if (raw) oneDriveLink = JSON.parse(raw).oneDriveLink || '';
  } catch { /* ไม่มีค่า = ยังไม่ตั้งลิงก์ */ }
  return new Response(JSON.stringify({ ok: true, oneDriveLink }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
