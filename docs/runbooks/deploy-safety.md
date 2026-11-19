# BAAC Field Route — Deploy Safety Runbook
> ใช้ทุกครั้งที่จะขึ้นงาน offline-first / `.bfrpack` / แก้ชั้นข้อมูล
> วันที่วัด baseline: 11 พ.ย. 2569 · เจ้าของ: พีท

---

## 0. กติกาเหล็ก (อ่านก่อนทุกครั้ง)

1. **ห้าม push เข้า `main` ตรง ๆ** — ใช้ branch `offline-v2` → Preview → ทดสอบ → merge
2. **ทุกฟีเจอร์ใหม่อยู่หลัง flag** ค่าเริ่มต้น = ปิด (`false`)
3. **ฐานข้อมูลเปลี่ยนแบบเพิ่มอย่างเดียว** — `CREATE TABLE`, `ALTER TABLE ADD COLUMN`, `CREATE INDEX` เท่านั้น
4. **ห้าม DROP / RENAME / UPDATE ทั้งตาราง** ในรอบเดียวกับที่ขึ้นโค้ด
5. **Backup + จดจุดย้อนกลับก่อนทุก phase** (ไม่มีข้อยกเว้น)
6. **ขึ้นทีละ phase** — ห้ามรวมงาน offline กับงานอื่นใน deploy เดียว
7. **เวลา deploy:** 20:00–21:30 เท่านั้น
   - ห้าม 04:50–05:30 (cron ราคาน้ำมัน)
   - ห้าม 06:25–07:05 (คิวงานเช้า)
   - ห้าม 08:00–17:00 (เวลาออกพื้นที่)
8. **หลัง deploy เฝ้าดู 30 นาที** ก่อนปิดงาน

---

## 1. Baseline ที่วัดจริง (11 พ.ย. 69)

| รายการ | ค่า |
|---|---|
| customers ใน D1 | **9,154** |
| gps_history | **801** |
| ขนาด DB | **6,475,776 ไบต์ (~6.2 MB)** |
| MAX(updated_at) | `2026-11-10T07:18:46.656Z` |
| KV keys | **54** |
| Production version | `20261110.000001` |
| Deploy ล่าสุด | `945b4d22` (commit `0319441`) |
| Health | `/` 200 · `/version.json` 200 · `/api/sync?probe=1` 401 (ไม่มี token = ปกติ) |
| D1 Time Travel bookmark | `000007af-00000000-0000511f-4c58fa37efa4a1d486f95e46948e7b24` |

> ⚠️ **อย่าใช้ `meta:counts-d1` ตรวจยอด** — ค่าล่าสุดใน KV คือ 9,129 / 1,001 ซึ่งเก่ากว่าจริง ให้ query D1 สดเท่านั้น

### ปัญหาพบก่อนเริ่ม (ต้องแก้เป็น release แยก)
- `public/js/vendor.js` **ไม่ตรงกับ source แล้ว** — เทียบกับการต่อไฟล์ 8 ไฟล์ได้ diff 36 บรรทัด แต่ **เป็นคอมเมนต์ทั้งหมด (non-comment diff = 0)** → ไม่เปลี่ยนพฤติกรรม
- `app.bundle.js` ตรงกับ source (diff 0 บรรทัด)
- **ผลกระทบ:** ถ้าแก้ `storage.js` แล้วไม่ regenerate `vendor.js` เว็บจริงจะไม่เปลี่ยน
- **แผน:** Phase 0.5 — ปล่อย release “sync vendor” แยกก่อน 1 รอบ, ทดสอบ, แล้วค่อยเริ่ม offline v2

---

## 2. Pre-flight (ทุก phase)

```bash
cd /home/kara/baac-field-route
bash scripts/preflight.sh          # ต้องผ่านทุกข้อ
bash scripts/backup-before-deploy.sh   # ต้องได้ไฟล์ครบ
```

`preflight.sh` ตรวจ:
- git branch / ไฟล์ค้าง
- `version.json` ตรงกับ `?v=` ใน `index.html`
- ไฟล์ที่ SW precache ครบ (`check-offline-assets.py`)
- syntax JS ทุกไฟล์ + bundle ตรงกับ source
- ชีวิตเว็บจริง: `/` 200, `/version.json` 200, ไม่มี 5xx
- backup ล่าสุดอายุ < 24 ชม.

**Go / No-Go**
- [ ] preflight เขียวทุกข้อ
- [ ] backup มีขนาด > 0 และเปิดอ่านได้
- [ ] ยอด customers ตรง baseline (9,154) ก่อนเริ่ม
- [ ] preview URL ทดสอบบนมือถือ + แท็บเล็ตแล้ว
- [ ] flag ใหม่ = ปิด
- [ ] จด deployment id ที่จะย้อนกลับ
- [ ] พ่อเห็นภาพหน้าจอและ OK
- [ ] อยู่ในเวลา deploy

---

## 3. แผนกันเว็บล่มราย phase

### Phase 0 — วัด baseline / เตรียมของ (ไม่แตะ production)
| หัวข้อ | รายละเอียด |
|---|---|
| สิ่งที่เปลี่ยน | ไม่มีใน production |
| ความเสี่ยง | ต่ำ |
| Guard | ทำงานบน branch, วัดจากสำเนา |
| ตรวจ | ตัวเลข baseline ตรงกับตารางข้อ 1 |
| ย้อน | ไม่ต้อง |
| Downtime | 0 |

### Phase 0.5 — Sync `vendor.js` (release แยก)
| หัวข้อ | รายละเอียด |
|---|---|
| สิ่งที่เปลี่ยน | regenerate `vendor.js` จาก 8 source ให้ตรงกัน |
| ความเสี่ยง | 🟠 UI เปลี่ยนโดยไม่ตั้งใจ (custom confirm dialog ฯลฯ) |
| Guard | diff ก่อนรวม, เก็บ `vendor.js` เดิมเป็น `.bak`, preview เทียบภาพ 5 หน้า |
| ตรวจ | ปุ่มยืนยัน/ฟอร์ม/แผนที่/บันทึกเยี่ยม ใช้งานได้; syntax ผ่าน |
| ย้อน | Cloudflare Dashboard → Deployment ก่อนหน้า → Rollback (≤2 นาที) |
| Downtime | 0 |

### Phase 1 — IDB v2 + Outbox ฝั่ง client
| หัวข้อ | รายละเอียด |
|---|---|
| สิ่งที่เปลี่ยน | `storage.js` (+`vendor.js`), `app.js` (+bundle) — flag `offline_v2` |
| ความเสี่ยง | 🔴 migration ทำข้อมูลในเครื่องเสีย / SW ค้างรุ่นเก่า |
| Guard | (1) export ข้อมูลในเครื่องก่อน migrate (2) เขียนคู่ v1 `kv` ไว้ 7 วัน (3) migration idempotent + transaction เดียว (4) flag ปิดไว้ก่อน (5) ไม่แก้ API |
| ตรวจ | เปิดเครื่องบิน → แก้ 10 ราย + ปัก 10 + เยี่ยม 10 → ปิด/เปิดแอป → ครบ 30; เปิดเน็ต → คิวลด 0 |
| ย้อน | ตั้ง flag `offline_v2=false` → โหลดใหม่ (ข้อมูล v1 ยังอยู่) |
| Downtime | 0 |

### Phase 2 — Server ops + `sync_ops`
| หัวข้อ | รายละเอียด |
|---|---|
| สิ่งที่เปลี่ยน | D1 เพิ่มตาราง `sync_ops`; เพิ่ม `POST /api/sync/ops` (ไม่แตะ `/api/sync` เดิม) |
| ความเสี่ยง | 🔴 เขียน D1 ผิด / quota / endpoint ใหม่พัง |
| Guard | (1) `CREATE TABLE IF NOT EXISTS` เท่านั้น (2) endpoint หลัง flag (3) batch ≤50 ops (4) `op_id` UNIQUE (5) ทดสอบยิงซ้ำ 5 ครั้ง (6) จำกัด payload ≤1 MB |
| ตรวจ | `SELECT COUNT(*) FROM sync_ops` = จำนวน op ที่ยิง; customers ไม่เพิ่มซ้ำ; `/api/sync` เดิมยังตอบปกติ |
| ย้อน | flag off; ตาราง `sync_ops` ปล่อยไว้ได้ (ไม่กระทบ) |
| Downtime | 0 |

### Phase 3 — Visits + Photos + Quota
| หัวข้อ | รายละเอียด |
|---|---|
| สิ่งที่เปลี่ยน | ย้าย visits → IDB, รูป → store แยก, `navigator.storage.persist()` |
| ความเสี่ยง | 🟠 ข้อมูลเยี่ยมเก่าหาย / พื้นที่เต็ม |
| Guard | (1) copy ก่อน ไม่ลบ localStorage ทันที (dual-read 7 วัน) (2) migrate ทีละ 200 (3) ตรวจจำนวนก่อน/หลัง (4) cap รูป/ราย |
| ตรวจ | จำนวน visits ตรง; รูปเปิดได้; `navigator.storage.estimate()` < 80% |
| ย้อน | flag off → อ่าน localStorage ต่อ |
| Downtime | 0 |

### Phase 4 — แผนที่ออฟไลน์ + ความสดข้อมูล
| หัวข้อ | รายละเอียด |
|---|---|
| สิ่งที่เปลี่ยน | ปุ่มโหลดไทล์ล่วงหน้า, cache แยก, ป้ายอายุข้อมูลหนี้ |
| ความเสี่ยง | 🟠 cache บวมจนระบบไล่แคช app shell |
| Guard | (1) cache แยกชื่อ `bfr-tiles-offline-v1` (2) cap ตาม MB ที่ผู้ใช้ยืนยัน (3) ไม่แตะ `STATIC_CACHE` (4) แสดง MB ก่อนโหลด |
| ตรวจ | โหมดเครื่องบิน → แผนที่เส้นทางวันนี้เห็นครบ; ลบ cache แล้วแอปยังเปิดได้ |
| ย้อน | ปิดปุ่ม + `caches.delete('bfr-tiles-offline-v1')` |
| Downtime | 0 |

### Phase 5 — QA matrix + เปิดใช้เต็ม
| หัวข้อ | รายละเอียด |
|---|---|
| สิ่งที่เปลี่ยน | เปิด flag ให้ทุกคน |
| ความเสี่ยง | 🟠 เครื่องรุ่นเก่า/iOS ทำงานต่าง |
| Guard | เปิดทีละสาขา (854 → 145), เฝ้า 24 ชม., มีเบอร์/ช่องทางแจ้งปัญหา |
| ตรวจ | ตาราง QA ครบ 8 เคส; pending queue = 0 หลัง sync |
| ย้อน | flag off ทั้งสาขา |
| Downtime | 0 |

---

## 4. Feature flag (kill switch)

KV key: `config:flags`
```json
{"offline_v2": false, "ops_api": false, "map_pack": false}
```
- Client อ่าน `/api/flags` ตอนเปิดแอป + ทุก 60 วิ (cache)
- ถ้าอ่านไม่ได้ → ใช้ค่าปิดทั้งหมด (safe default)
- ปิดฉุกเฉิน:
```bash
wrangler kv key put "config:flags" \
  '{"offline_v2":false,"ops_api":false,"map_pack":false}' \
  --namespace-id bc1b3d9b873045c88b43ebe0fd241706 --remote
```
- ผู้ใช้ต้อง reload 1 ครั้ง (แจ้งผ่านข้อความ/toast)

---

## 5. Backup ก่อน deploy

```bash
cd /home/kara/baac-field-route
bash scripts/backup-before-deploy.sh
```

ได้อะไร:
- `backups/deploy-YYYYMMDD-HHMM/d1-full.sql` (schema + data)
- `backups/deploy-YYYYMMDD-HHMM/d1-schema.sql` (schema อย่างเดียว)
- `backups/deploy-YYYYMMDD-HHMM/kv/*.json` (54 คีย์)
- `backups/deploy-YYYYMMDD-HHMM/git.txt` (commit, branch, tag)
- ตรวจขนาดไฟล์ + จำนวนตาราง + ยอด customers ในไฟล์ backup

**ที่เก็บ:** เครื่องนี้ + copy ไป `OneDrive/Documents/BAAC-Backups/` (อย่าเก็บที่เดียว)

---

## 6. Rollback 4 ระดับ

| ระดับ | สถานการณ์ | วิธี | เวลา |
|---|---|---|---|
| **R1 — Flag off** | ฟีเจอร์ใหม่พัง แต่เว็บยังเปิด | ตั้ง `config:flags` ปิด → reload | <1 นาที |
| **R2 — Deployment rollback** | โค้ดใหม่ทำหน้าเว็บพัง | CF Dashboard → Pages → baac-field-route → Deployments → เลือก deployment ก่อนหน้า → Rollback | ~2 นาที |
| **R3 — Restore D1** | ข้อมูลเสียหาย/เขียนผิด | `wrangler d1 time-travel restore baac-field-route-db --bookmark=<จุดก่อน deploy>` | ~5 นาที |
| **R4 — Restore KV** | ค่า config/visits/routes หาย | `wrangler kv key put <key> --path <file> --namespace-id ... --remote` | ~10 นาที |

> R3 เป็นการย้อน **ทั้งฐานข้อมูล** — งานที่ผู้ใช้บันทึกหลังจุดนั้นจะหาย ต้องแจ้งพ่อก่อนใช้ทุกครั้ง

---

## 7. Monitoring / สัญญาณเตือน

**อัตโนมัติ (cron ทุก 5 นาที)**
- `/` ต้อง 200
- `/version.json` ต้อง 200 และ version ตรงที่ deploy
- `/api/sync?probe=1` ต้องไม่ใช่ 5xx (401 = ปกติ)
- ถ้าพลาด 2 ครั้งติด → Telegram แจ้งพ่อ

**ตรวจข้อมูลวันละครั้ง (06:00)**
- `SELECT COUNT(*) FROM customers` = 9,154 (หรือยอดล่าสุดที่อนุมัติ)
- `SELECT COUNT(*) FROM gps_history`
- `SELECT MAX(updated_at) FROM customers` ต้องใหม่ขึ้นทุกวันที่มีคนใช้
- `SELECT COUNT(*) FROM sync_ops` (หลัง phase 2)
- ถ้ายอดลดผิดปกติ > 0.5% → หยุดรับเขียน + แจ้ง

**ดูจาก Cloudflare**
- Pages → Analytics: 5xx, requests
- D1 → Metrics: rows read/written, errors
- KV → Operations: 429 / errors

---

## 8. Incident playbook

| อาการ | สาเหตุที่น่าจะเป็น | ทำทันที |
|---|---|---|
| หน้าเว็บขาว/โหลดไม่ขึ้น | deploy ใหม่พัง / SW ค้าง | R2 rollback deployment → hard refresh |
| ล็อกอินไม่ได้ทั้งสาขา | JWT secret / KV / login API | ตรวจ `/api/login`, ดู 5xx, R2 |
| ข้อมูลไม่ซิงก์ แต่แอปเปิดได้ | ops API / flag / quota | ปิด `offline_v2`, ดู pending queue, ตรวจ D1 quota |
| ข้อมูลหายบางส่วน | migration / merge ผิด | **หยุดเขียนทันที** → R3 restore → แจ้งพ่อ |
| แอปค้างรุ่นเก่า | SW cache | ปุ่ม refresh ในแอป / bump version / R2 |
| D1 เขียนไม่ได้ | quota รายวัน | ปิด bulk import, รอ reset, แจ้งพ่อ |
| KV 429 | เขียนคีย์เดิมถี่ | ลด polling, batch, ตรวจ `visits` key |

---

## 9. หลัง deploy (30 นาทีแรก)

- [ ] เปิดเว็บจริงบนมือถือ: login → งานวันนี้ → แผนที่ → บันทึก 1 ราย
- [ ] เปิดแท็บเล็ต: งานค้าง sync หมด
- [ ] `SELECT COUNT(*)` ตรง baseline + งานใหม่
- [ ] ไม่มี 5xx ใน CF Analytics
- [ ] แจ้งพ่อ + เขียน handoff

---

## 10. สิ่งที่ห้ามทำ

- ❌ push main ตรง
- ❌ แก้ `storage.js` แล้วลืม regenerate `vendor.js`
- ❌รัน `DROP TABLE` / `DELETE FROM customers` / `UPDATE` ทั้งตาราง
- ❌ deploy พร้อมกัน 2 คน
- ❌ deploy ระหว่าง 08:00–17:00 หรือระหว่างมีคนออกพื้นที่
- ❌ ใช้ `meta:counts-d1` เป็นตัวตัดสินยอดจริง
- ❌ ลบ backup ก่อนผ่านไป 30 วัน
