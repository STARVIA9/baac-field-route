/**
 * GET /api/debt-data
 * คืนข้อมูลหนี้ Customer Indicator ฉบับล่าสุด:
 * - ถ้ามี KV 'debt:data' (อัปเดตล่าสุดผ่าน /api/debt-import) → คืนของใหม่
 * - ถ้าไม่มี (ยังไม่เคย import) → fallback ไปไฟล์ static debt-data.json เดิม
 */
export async function onRequestGet(context) {
  const { env } = context;

  // 1. ลองอ่านจาก KV ก่อน (ข้อมูลอัปเดตล่าสุด)
  if (env.BFR_KV) {
    try {
      const raw = await env.BFR_KV.get('debt:data');
      if (raw) {
        // ตรวจว่า JSON ถูกต้องก่อนส่ง
        try {
          const parsed = JSON.parse(raw);
          return new Response(JSON.stringify(parsed), {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-cache',
              'X-Debt-Source': 'kv',
            },
          });
        } catch (e) {
          console.warn('debt:data KV corrupt, fallback to static');
        }
      }
    } catch (e) {
      console.warn('debt:data KV read failed:', e.message);
    }
  }

  // 2. Fallback: คืนจาก static debt-data.json (ข้อมูลเดิม)
  const res = await fetch(new Request('https://baacroute.shop/debt-data.json', { method: 'GET' }));
  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'debt data unavailable' }), { status: 500 });
  }
  const body = await res.text();
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Debt-Source': 'static',
    },
  });
}