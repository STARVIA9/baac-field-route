// ปิดหน้า /kpi/ — เก็บโค้ดเดิมไว้ที่ docs/archived/kpi-page-2026-11-21.html
// 410 Gone = บอกชัดว่าหน้าถูกปิดถาวร (ไม่ใช่ 404 ชั่วคราว)
export const onRequest = () =>
  new Response(
    '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>หน้านี้ปิดใช้งานแล้ว</title></head>' +
    '<body style="font-family:Sarabun,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;text-align:center;color:#333">' +
    '<h1 style="font-size:22px">หน้านี้ปิดใช้งานแล้ว</h1>' +
    '<p style="font-size:16px;line-height:1.6">หน้า KPI ถูกปิดเมื่อ 21 พ.ย. 2569<br>หากต้องการใช้งานต่อ กรุณาติดต่อหัวหน้าพีท</p>' +
    '<p><a href="/" style="color:#0a6b3d;font-size:16px">กลับหน้าหลัก</a></p>' +
    '</body></html>',
    { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
