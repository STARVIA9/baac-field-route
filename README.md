# 🗺️ BAAC Field Route

**Smart route planner for BAAC credit officers** — วางแผนเส้นทางออกพื้นที่อัจฉริยะ

## ✨ Features

- 🗺️ **แผนที่** — Leaflet + OpenStreetMap (ฟรี)
- 📍 **ปักหมุดลูกค้า** — พิกัด + ชื่อ + ที่อยู่ + เบอร์โทร
- 🧮 **วางแผนเส้นทางอัตโนมัติ** (TSP optimization) — เรียงลำดับลูกค้าให้สั้นที่สุด
- ⏱️ **คำนวณระยะทาง + เวลา** ด้วย OSRM
- 📤 **Export ไป Google Maps** — กดปุ่มเดียว นำทางจริง
- 👥 **Multi-user** — ทีม 2-5 คน login + sync ผ่าน Cloudflare KV
- 📱 **PWA** — ติดตั้งลงมือถือได้
- 📍 **GPS + บันทึกผลเข้าพบ**
- 💾 **Offline support** — service worker

## 🚀 Tech Stack

- **Frontend:** Vanilla JS + Leaflet.js
- **Hosting:** Cloudflare Pages (free)
- **Storage:** Cloudflare KV (5GB free)
- **Routing API:** OSRM (public, free)
- **Auth:** PIN code + JWT (HS256)
- **PWA:** manifest + service worker

## 💰 Cost: 0 บาท/เดือน

## 🛠️ Local Dev

```bash
# Clone
git clone https://github.com/peatlaonado-star/baac-field-route.git
cd baac-field-route

# Serve locally (Python)
python3 -m http.server 8000

# Open browser
open http://localhost:8000
```

## 📦 Deploy

```bash
# Push to GitHub
git push origin main

# Cloudflare Pages auto-deploys from main branch
```

## 🔐 Environment Variables (Cloudflare Pages)

| Key | Description |
|-----|-------------|
| `BFR_JWT_SECRET` | Long random secret for JWT signing (≥32 chars) |
| `BFR_KV` | KV namespace binding (auto-attached) |

## 👥 Default Team (5 PINs)

| Name | PIN | Role |
|------|-----|------|
| Admin | 0000 | ผู้ดูแล |
| User 1-4 | 1001-1004 | พนักงานสินเชื่อ |

(PINs เปลี่ยนได้ที่ Admin Panel)
