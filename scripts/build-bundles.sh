#!/usr/bin/env bash
# รวมไฟล์ js/ เป็น bundle ที่เว็บโหลดจริง (index.html โหลด js/vendor.js + js/app.bundle.js)
#
# ⚠️ vendor.js สร้างด้วย scripts/build-vendor.sh (ไม่ใช่ที่นี่) — ที่นี่ตรวจ syntax ให้เท่านั้น
#
# 19 พ.ย.69: ต่อไฟล์แล้ว **แปลง syntax ลงเป็น ES2017 ด้วย esbuild** (ตัด ?. และ ??)
# เหตุผล: มือถือรุ่นเก่า (iOS < 13.4 / Chrome < 80) เจอ optional chaining แล้ว
# throw SyntaxError ทั้งไฟล์ → หน้าเว็บค้างที่ "กำลังโหลดรายชื่อ..." เปิดไม่ได้
# ต้อง pin เวอร์ชัน esbuild ให้ CI ผลิตไฟล์ได้เหมือนกันเป๊ะ (tests.yml เช็ค git diff)
set -euo pipefail
cd "$(dirname "$0")/../public/js"

ESBUILD="npx --yes esbuild@0.24.0"
RAW=/tmp/bfr-appbundle.raw.js

cat customers.js tsp.js route.js visit.js report.js app.js > "$RAW"
$ESBUILD "$RAW" --target=es2017 --outfile=app.bundle.js --log-level=warning

for f in customers.js storage.js app.js tsp.js route.js visit.js report.js vendor.js app.bundle.js; do
  node --check "$f" || { echo "❌ syntax error: $f"; exit 1; }
done
node --check ../sw.js
echo "✅ app.bundle.js rebuilt + transpiled ES2017 ($(wc -l < app.bundle.js) บรรทัด) — syntax ผ่านทุกไฟล์"
