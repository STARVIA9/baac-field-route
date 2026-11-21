# baac-ci — Phase 1 (หน้านำเข้า CI จริง)

> สถานะ: **โค้ด commit แล้วในเครื่อง · ยังไม่ push / ไม่ deploy — รอพ่อนอนุมัติ + ข้อมูลจริง**
> แผน: `../docs/plans/2026-11-21-ci-onedrive-pseudonym.md`
> ภาพจำลองที่พ่ออนุมัติ: `C:\Users\ichillshop\Desktop\BAAC-CI-ทดลอง\mockup-ci-admin.html`

## สิ่งที่ทำใน Phase 1

- `public/index.html` — หน้า admin จริง (PIN → เลือกสาขา → เลือกไฟล์ CI → เลือกกุญแจ → สร้างซอง → โหลดซอง + เปิดลิงก์ OneDrive)
- `public/js/ci-pack.js` — อ่าน CI (TIS-620), ตรวจสาขา, HMAC-SHA-256 ทำรหัส 12 ตัว, AES-256-GCM เข้ารหัสซอง
- `functions/api/*` — login/session/logout/branches/config (อ่าน KV `BAAC_CI_KV`)
- `tests/ci-pack.selftest.mjs` — assert self-check ตามแผน §1.6

## กฎที่ยึด (จากแผน)

1. ข้อมูลลูกค้าดิบ + secret ไม่ถูกส่งขึ้นเซิร์ฟเวอร์ (ประมวลผลในเบราว์เซอร์ล้วน)
2. เซิร์ฟเวอร์ที่จะได้ในPhase 3 คือ `{code,lat,lng,branch}` เท่านั้น
3. ชื่อไฟล์ซองคงที่ `<branch>.bfrpack` (ตาม §11 — แทนชื่อมีวันที่ในภาพจำลองเก่า)
4. รหัส 12 hex (≥10 ตาม §7.3) · CIF เดิมได้รหัสเดิมเสมอ
5. `branches:all` ดึงจาก KV — ไม่ hardcode

## วิธีเตรียมและลงเว็บ (1 คำสั่ง)

1. `cp ci-app/config.example.json ci-app/config.local.json` — กรอก `oneDriveLink` + PIN 854/145 (ไฟล์นี้ถูก gitignore ห้าม commit)
2. `bash ci-app/scripts/deploy.sh --dry-run` — ตรวจค่า + เขียน KV อย่างเดียว ยังไม่ลงเว็บ
3. `bash ci-app/scripts/deploy.sh` — เขียน KV + ตั้ง secret + ลง `baac-ci` + ตรวจหน้าเว็บจริง
   - **รันเมื่อพ่อนอนุมัติแล้วเท่านั้น** (กฎ: แจ้งพ่อก่อน deploy ทุกครั้ง)
   - ต้องมี `CLOUDFLARE_API_TOKEN` ใน environment

สิ่งที่ทำไปแล้วโดยไม่ต้องรอ: seed `branches:all` 7 สาขาเข้า `BAAC_CI_KV` (ตรวจ readback ตรงทุกไบต์) + สุ่ม `CI_SESSION_SECRET` เก็บใน `config.local.json`

## สิ่งที่ยังต้องพ่อ/ยังค้าง (ห้ามเดา)

- **ลิงก์ OneDrive 1 ลิงก์** (พ่อสร้างวันจันทร์) → เซ็ต KV `ci:config` = `{"oneDriveLink":"..."}`
- **PIN เจ้าหน้าที่สาขา** → เซ็ต KV `ci:admins` = `{"854":"...","145":"..."}` (ไม่เดา PIN)
- **secret จริงของแต่ละสาขา** → สำรอง 3 ชั้น + วิธี rotate (แผน §7.2)
- **ตัวอย่างไฟล์ CI จริงจากระบบรับส่งข้อมูลสาขา** (พ่อจะให้รายละเอียดวันจันทร์) — ตอนนี้เทสต์ด้วยข้อมูลสังเคราะห์
- ตั้ง `CI_SESSION_SECRET` เป็น Pages secret ก่อน deploy

## คำสั่งตรวจ/deploy

```bash
node tests/ci-pack.selftest.mjs                 # self-check
cd ci-app && npx wrangler pages deploy . --project-name baac-ci --branch main
```

**ห้าม deploy ก่อนพ่อดูภาพหน้าเว็บจริงและอนุมัติ (แผน §5 ข้อ 2, 4)**
