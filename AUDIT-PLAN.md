# BAAC Field Route — Audit & Plan

> เว็บ: [baac-field-route.pages.dev](https://baac-field-route.pages.dev/)
> Repo: `github.com/STARVIA9/baac-field-route.git`
> Path: `/home/kara/baac-field-route/`
> Date Audit: 19 กรกฎาคม 2569
> Version: 20260714.000006

---

## 1. สภาพเว็บปัจจุบัน (Audit Result)

### ✅ ระบบที่ทำงานปกติ

| ระบบ | สถานะ | หมายเหตุ |
|------|--------|---------|
| 🔐 Login (admin/admin1234) | ✅ ผ่าน | มี PIN ด้วย |
| 🗺️ แผนที่ (Leaflet + OSM) | ✅ ใช้ได้ | แบบแผนที่/ดาวเทียม |
| 🧭 วางแผนเส้นทาง | ✅ ครบ | ค้นหา → เพิ่ม → เรียง → TSP → คำนวณน้ำมัน |
| 📊 รายงาน | ✅ มี | เลือกช่วงวัน, รถ, แสดงเกณฑ์เบี้ยเลี้ยง |
| 📋 เข้าพบ | ✅ ครบ | สถิตรอเยี่ยม/เยี่ยมแล้ว/ข้าม |
| ➕ เพิ่มลูกค้า | ✅ ครบ | แผนที่จิ้ม, GPS, รูป, ระดับความเสี่ยง, ประเภทหนี้ |
| 👥 จัดการ Users | ✅ มีปุ่ม 🔑 |
| 🔄 Refresh/Update DB | ✅ ปุ่มพร้อม |
| 🗺️ Map Layers | ✅ Street/Satellite/Marker |
| 🚗 คำนวณน้ำมัน | ✅ กระบะ/เก๋ง/มอเตอร์ไซค์ + จำแนกถนน |

### ❌ ปัญหาที่พบ

| # | ปัญหา | รายละเอียด | ระดับ |
|---|-------|-----------|------|
| 1 | **ไม่มีข้อมูลลูกค้าในระบบ** | customer list = 0 คน, storage ใช้แค่ 0.7KB, customers-db.json มีแต่โครง | 🔴 |
| 2 | **Marker ซ้ำซ้อน** | ไม่มี clustering — ตำแหน่งใกล้กันซ้อนทับ มือถือจิ้มยาก | 🔴 |
| 3 | **Search ค้นหายาก** | ต้องกดเข้าเมนูย่อยก่อน กว่าจะเจอช่องค้นหา | 🟡 |
| 4 | **UX มือถือไม่ลื่นไหล** | โหลดข้อมูลทีเดียวทั้งหมด, ไม่มี lazy load | 🟡 |
| 5 | **ไม่มี offline-first** | localStorage ธรรมดา — เคลียร์ cache = ข้อมูลหาย | 🟡 |
| 6 | **ไม่มี GPS ใกล้ตัว** | ต้องหาลูกค้าเอง ไม่มีระบบแนะนำใกล้ที่สุด | 🟢 |

### 📊 สถิติเทคนิค

| รายการ | ค่า |
|--------|-----|
| JS files | 13 ไฟล์ (leaflet, utils, auth, api, storage, fuel, customers, customer-db, tsp, route, visit, report, app) |
| CSS files | 2 ไฟล์ (leaflet.css, app.css) |
| CDN Deps | Leaflet + OSM |
| Storage | localStorage (0.7KB ใช้จริง), 70KB capacity |
| Marker Cluster | ❌ ไม่มี |
| DB backend | localStorage + customers-db.json static |
| mapExists | ✅ |
| App Version | 20260714.000006 |
| Git Remote | STARVIA9/baac-field-route (GitHub) |

---

## 2. แผนงาน (3 Phase)

### Phase 1: ปัญหาเร่งด่วน 🔴

#### 1.1 Sync ข้อมูลลูกค้า → แสดงผล
- **ปัญหา**: ลูกค้า 0 คนในรายการ ทั้งที่มีข้อมูลใน `customers-db.json`
- **สาเหตุ**: ฟังก์ชันโหลดข้อมูลจาก static JSON ไม่ดึงเข้า localStorage/customers list
- **แก้**: ตรวจสอบ `/public/customers.js` + `customer-db.js` → ตอน init ต้องอ่าน `customers-db.json` แล้ว populate customer list + map markers
- **ไฟล์ที่เกี่ยวข้อง**: `public/js/customers.js`, `public/js/customer-db.js`, `public/js/storage.js`, `public/customers-db.json`
- **ตรวจสอบ backup**: `customers-db.json.backup-before-strip-gps`, `customers-db.json.backup-before-unjitter`

#### 1.2 Marker Clustering
- **ปัญหา**: พิกัดลูกค้าซ้ำซ้อน/ใกล้กัน — มือถือจิ้มยาก, แผนที่รก
- **แก้**: เพิ่ม Leaflet.markercluster plugin
- **วิธี**: import cluster CSS + JS → wrap marker group ด้วย `L.markerClusterGroup()`
- **ข้อควรระวัง**: ทดสอบ performance ที่ ~3,900 markers
- **CDN**: unpkg.com/leaflet.markercluster

#### 1.3 Search ตรงกลาง
- **ปัญหา**: ต้องกดเข้าเมนู "ลูกค้า" / "วางแผน" ก่อนถึงเห็นช่องค้นหา
- **แก้**: ย้าย Search Bar ไปไว้ที่ Header/Banner ตลอดเวลา, หรือเพิ่ม "ค้นหาด่วน" ปุ่มลอย
- **UX อ้างอิง**: Google Maps search bar

### Phase 2: UX Mobile + Performance 🟡

#### 2.1 Lazy Load + Virtual Scroll
- **ปัญหา**: โหลดข้อมูลลูกค้าทั้งหมด ~3,900 record ทีเดียว — เครื่องช้า
- **แก้**: โหลด 50-100 คนแรก → เลื่อนแล้วค่อยโหลดเพิ่ม (Intersection Observer)
- **เพิ่ม filter**: จังหวัด/อำเภอ/ตำบล

#### 2.2 Bottom Sheet Navigation
- **ปัญหา**: 4 แท็บล่าง = fixed bar — พื้นที่แสดงผลน้อย
- **แก้**: ใช้ Bottom Sheet (อย่าง Shopee/Google Maps) — เลื่อนขึ้นมาดูเนื้อหา, ปัดลงไปย่อ
- **Mobile-first**: ดีไซน์ให้มือถือเป็นหลักก่อน ปรับจอใหญ่ทีหลัง

#### 2.3 IndexedDB แทน localStorage
- **ปัญหา**: localStorage ข้อมูลหายเมื่อล้าง cache
- **แก้**: ย้ายไป IndexedDB — ข้อมูลอยู่ถาวร, เก็บรูป offline ได้, query เร็วกว่า
- **Offline-first**: service worker + Cache API

### Phase 3: Feature เสริม 🟢

#### 3.1 ลูกค้าใกล้ตัว
- GPS ปัจจุบัน → คำนวณระยะทาง → แสดง 10 คนใกล้ที่สุด
- ใช้ OSRM หรือ Haversine formula คำนวณ distance

#### 3.2 Dark Mode
- ทำงานกลางแจ้ง — แผนที่สว่างเกินไป
- ใช้ prefers-color-scheme + toggle

#### 3.3 Export/Share Route
- แชร์เส้นทางวันนี้ LINE/Facebook
- Export เป็น PDF/รูป

---

## 3. ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | บทบาท |
|------|-------|
| `public/index.html` | โครงสร้างหลัก |
| `public/css/app.css` | style ทั้งหมด |
| `public/js/leaflet.js` | แผนที่ |
| `public/js/customers.js` | รายชื่อลูกค้า UI |
| `public/js/customer-db.js` | ฐานข้อมูลลูกค้า |
| `public/js/storage.js` | localStorage management |
| `public/js/route.js` | เส้นทาง OSRM |
| `public/js/tsp.js` | Traveling Salesman (เรียงอัตโนมัติ) |
| `public/js/visit.js` | บันทึกการเข้าพบ |
| `public/js/report.js` | รายงาน |
| `public/js/fuel.js` | คำนวณน้ำมัน |
| `public/js/auth.js` | Login/auth |
| `public/js/api.js` | API helpers |
| `public/js/app.js` | main app init |
| `public/js/utils.js` | utilities |
| `public/customers-db.json` | ข้อมูลลูกค้า (static) |
| `public/customers-db.json.backup-before-strip-gps` | backup |
| `public/customers-db.json.backup-before-unjitter` | backup |
| `public/version.json` | version info |
| `tunnel-url.txt` | local tunnel URL |

---

## 4. ขั้นตอนการทำงานแนะนำ

```bash
# 1. เริ่มจาก root
cd /home/kara/baac-field-route

# 2. ใช้ wrangler dev สำหรับ local dev
npx wrangler pages dev public

# 3. แก้ไขไฟล์ JS ใน public/
# 4. ทดสอบ
# 5. Deploy
npx wrangler pages deploy public --project-name=baac-field-route
```

หรือ deploy ผ่าน GitHub → Cloudflare Pages auto-deploy (connected repo)

---

## 5. ข้อเสนอเพิ่มเติม (ถ้าพ่อพีทสนใจ)

- **Store พิกัดลูกค้าใน database** (D1/SQLite via Cloudflare Workers) — sync ข้ามอุปกรณ์ได้, ไม่หายตอนเคลียร์ cache
- **Route History** — เก็บประวัติเส้นทางย้อนหลัง ดู trend การทำงาน
- **Dashboard สำหรับผู้จัดการ** — สรุปภาพรวมพนักงานภาคสนาม
