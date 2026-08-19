# รวมถังข้อมูล into D1 — BAAC Field Route

> **สถานะ**: พ่อกำลังเพิ่มสิทธิ์ D1 ให้ token ที่ Cloudflare dash
> **เป้าหมาย**: ย้ายข้อมูลลูกค้าจาก 3 ที่ (static JSON + KV keys) → ถังเดียว D1

## ปัญหา (ถังข้อมูลหลายถัง)

ข้อมูลลูกค้าปัจจุบันกระจาย 3 ที่:

| ที่ | แหล่ง | จำนวน | ปัญหา |
|-----|-------|-------|-------|
| 1 | `public/customers-db.json` | 3,852 | static ไฟล์ — หน้า map อ่านจากนี้ |
| 2 | KV `customers:all` | 212 | CRUD หน้าจัดการ — มี `deleted:true` ปน |
| 3 | KV `customers:recycle` | 776 | ถังรีไซเคิล deleted |
| + | KV `gps:overlay` | marker | GPS import แยก — map ต้อง merge |

ทำให้: map ≠ หน้าจัดการ ≠ sync ต้อง sync กันตลอด (งานที่ค้าง)

## แผน D1 (เดียว)

1. พ่อเพิ่มสิทธิ์ D1 → `wrangler d1 create baac-field-route-db`
2. สร้าง schema 1 ตาราง `customers` (cif, name, lat, lng, + demo fields)
3. Migrate 3 แหล่ง → D1 (3,852 + 212 + 776 unique โดย cif)
4. เขียน API เดียว `/api/customers` ให้ map + admin + sync อ่านจาก D1
5. ลบ dependency static JSON + KV keys เก่า

## Schema เริ่มต้น

```sql
CREATE TABLE customers (
  cif TEXT PRIMARY KEY,
  name TEXT,
  nickname TEXT,
  lat REAL,
  lng REAL,
  phone TEXT,
  address TEXT,
  zone TEXT,
  risk_level TEXT,
  debt_type TEXT,
  created_by TEXT,
  deleted INTEGER DEFAULT 0,
  updated_at TEXT,
  created_at TEXT
);
```

## Warning

- โค้ดเดิมใช้หลาย key ใน BFR_KV (gps:overlay, customers:all ฯลฯ) — D1 จะแทนทั้งหมด
- ต้องไม่แตะ STARVIA_KV / BAAC_KPI_DATA (ถังคนละงาน)
