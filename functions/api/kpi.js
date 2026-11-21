// ปิด API /api/kpi — เก็บโค้ดเดิมไว้ที่ docs/archived/kpi-api-2026-11-21.js
export const onRequest = () =>
  new Response(JSON.stringify({ error: 'ปิดใช้งานแล้ว', since: '2026-11-21' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
