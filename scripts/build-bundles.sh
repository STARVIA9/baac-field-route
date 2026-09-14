#!/usr/bin/env bash
# รวมไฟล์ js/ เป็น bundle ที่เว็บโหลดจริง (index.html โหลด js/vendor.js + js/app.bundle.js)
#
# ⚠️ vendor.js ไม่ได้ regenerate ที่นี่ — ไฟล์ที่อยู่บนเว็บยังต่างจาก js/storage.js
#    เรื่องคีย์เส้นทาง/เส้นทางที่บันทึก แยกตามผู้ใช้ (ของบนเว็บยังไม่แยก)
#    → แก้ vendor.js ตรงๆ ให้ตรงกับที่แก้ใน storage.js แทน ไม่งั้นพฤติกรรมจะเปลี่ยนโดยไม่ตั้งใจ
set -euo pipefail
cd "$(dirname "$0")/../public/js"

# app.bundle.js = ต่อไฟล์ตามลำดับนี้เป๊ะๆ (ตรวจแล้วว่าเท่ากับของเดิม 14 ก.ย.69)
cat customers.js tsp.js route.js visit.js report.js app.js > app.bundle.js

for f in customers.js storage.js app.js tsp.js route.js visit.js report.js vendor.js app.bundle.js; do
  node --check "$f" || { echo "❌ syntax error: $f"; exit 1; }
done
node --check ../sw.js
echo "✅ app.bundle.js rebuilt ($(wc -l < app.bundle.js) บรรทัด) — syntax ผ่านทุกไฟล์"
