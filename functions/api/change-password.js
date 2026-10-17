// Change password — POST /api/change-password
// ปิดแล้ว (17 ต.ค.69 — เลิกรหัสผ่าน เหลือ PIN อย่างเดียวตามพ่อสั่ง)
// เก็บไฟล์ไว้กัน client เก่าเจอ 404 เปล่าๆ — ตอบข้อความบอกให้ใช้ PIN แทน

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(context) {
  return json({ success: false, error: 'เลิกใช้รหัสผ่านแล้ว — PIN หายให้แอดมินตั้งใหม่ให้' }, 410);
}
