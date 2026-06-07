# pin-point.co Research Log

**Date:** 2026-06-07
**Status:** ❌ **DROPPED** — ไม่ใช้แล้ว
**Decision maker:** พ่อ (perawit)

## TL;DR

pin-point.co เป็น Thai geocoding service (พันธมิตร GIS/CDG/NOSTRA) ที่น่าสนใจ
แต่ **block ที่ REST API access จาก server-side** — เลยไม่ pursue ต่อ

## ทำไมน่าสนใจ

- 🇹🇭 Thai-first, claim "แม่นยำที่สุดในไทย" (ต้องพิสูจน์)
- 💰 **Free tier: 15,000 credits** (no credit card)
- 📦 Batch service สำหรับ 3,853 records
- ✅ สมัครสำเร็จ + ได้ API key จริง (length 80 chars hex)

## API Spec (จาก SDK decompile)

**Base URL:** `https://pin-point.co`

**Endpoints (POST, form-encoded):**
- `/g/search/autocomplete` — forward geocoding
- `/g/search/details` — location details (ตามหลัง LocationID)

**Auth:** API key ใน form data: `key=<api_key>`

**Request (autocomplete):**
```
POST /g/search/autocomplete
Content-Type: application/x-www-form-urlencoded

keyword=<text>
&format=raw
&maxResult=5
&language=th
&key=<api_key>
```

**Response structure:**
```json
{
  "success": true,
  "fields": ["FormattedAddress", "LAT_LON", "LocationID", ...],
  "data": [
    {
      "FormattedAddress": "...",
      "LAT_LON": "13.123,100.456",
      "LocationID": "..."
    }
  ]
}
```

**SDK URL:** `https://pin-point.co/g/sdk/1.0.6` (JavaScript widget)

## ❌ Blocker

ทุก REST API call (ทดสอบ 4 referer variants) ได้:

```json
HTTP 401
{
  "success": false,
  "message": "The referrer and access token do not match.",
  "codeError": "UVT002"
}
```

**ปัญหา:** ไม่มี UI ใน portal ให้ whitelist domain (เห็นแค่ token name)
น่าจะต้อง activate ผ่าน "ทดลองจริง" (Live Test) tab แต่ไม่ได้ทดสอบ

## Cost Analysis (ก่อนตัดสินใจ)

| Plan | Credits | Price (THB) |
|---|---|---|
| Free | 15,000 | 0 ✅ |
| Starter | 50,000 | 6,500 |
| Pro | 100,000 | 12,000 |
| Business | 400,000 | 40,000 |

| Endpoint | Credits/req | 3,853 records |
|---|---|---|
| Autocomplete | 1 | 3,853 ✅ fits free |
| Batch | 5 | 19,265 ❌ |
| Details | 10 | 38,530 ❌ |

## เหตุผลที่ไม่ pursue

1. **Block ที่ auth/referrer** — ใช้เวลา debug มากเกินไป
2. **มีทางเลือกที่ดีกว่า** — Field GPS ฟรี 100%, แม่น 100%
3. **Free tier ไม่พอ** ถ้าใช้ batch (ขาด 4,265 cr)
4. **Key อาจ activate ง่าย** แต่ไม่คุ้มเวลา

## แผนที่ใช้แทน

- **Field GPS Capture** — เจ้าหน้าที่เก็บเองตอนลงพื้นที่
- **Leaflet + OSM** — แสดงผลบนแผนที่
- ข้อมูลที่ดีอยู่แล้ว (ที่อยู่ครบ) เก็บใน DB ไว้ก่อน ไม่ต้องเร่ง geocode

## เก็บไว้ (อาจกลับมา)

- API spec + endpoint format (เผื่อ pin-point แก้ปัญหาในอนาคต)
- Account: สมัครฟรีแล้ว + key อยู่ใน `~/baac-field-route/.dev.vars` (PINPOINT_API_KEY)
- **ถ้ากลับมา:** ลองแท็บ "ทดลองจริง" ใน portal ก่อน → ถ้าใช้ได้ → เช็ค referer ใหม่
