// ===== สำรองข้อมูลทั้งระบบก้อนเดียว (เฟส 4) — Admin เท่านั้น =====
// GET /api/admin/backup → JSON snapshot: รายชื่อ D1 ทั้งหมด + หนี้ KV + overlay + รายชื่อพนักงาน + visits/routes
// อ่านอย่างเดียว (ไม่เขียน D1/KV → ไม่กินโควต้าเขียน)

import { authCheck, json } from '../../_lib/shared.js';

// KV keys/prefix ที่เป็น source-of-truth ฝั่งเซิร์ฟเวอร์ (ดูจาก grep BFR_KV ทุก endpoint)
const KV_SINGLE = ['debt:data', 'debt:updated', 'gps:overlay', 'users:all', 'visits:all', 'branches:all', 'meta:overlay-updated'];
const KV_PREFIXES = ['routes:', 'visits:user:', 'meta:lastwrite'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authCheck(request, env);
  if (auth.error) return json({ success: false, error: auth.error }, 401);
  if (auth.user.role !== 'admin') return json({ success: false, error: 'ต้องเป็น Admin เท่านั้น' }, 403);
  if (!env.BFR_DB) return json({ success: false, error: 'D1 not configured' }, 500);

  // 1) รายชื่อทั้งหมดจาก D1 (รวมที่ลบแล้ว — มี flag deleted ไว้กู้ได้)
  const { results } = await env.BFR_DB.prepare('SELECT * FROM customers').all();
  const customers = results || [];

  // 2) KV ที่เป็น source-of-truth
  const kv = {};
  if (env.BFR_KV) {
    for (const k of KV_SINGLE) {
      try { const v = await env.BFR_KV.get(k); if (v !== null && v !== undefined) kv[k] = v; } catch {}
    }
    for (const p of KV_PREFIXES) {
      try {
        let cursor = undefined;
        do {
          const page = await env.BFR_KV.list({ prefix: p, cursor });
          for (const key of page.keys || []) {
            try { const v = await env.BFR_KV.get(key.name); if (v !== null && v !== undefined) kv[key.name] = v; } catch {}
          }
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);
      } catch {}
    }
  }

  return json({
    success: true,
    exported_at: new Date().toISOString(),
    backup_version: 1,
    counts: { customers: customers.length, kv_keys: Object.keys(kv).length },
    d1: { customers },
    kv,
  });
}
