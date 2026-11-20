#!/usr/bin/env bash
# รวม source 8 ไฟล์เป็น public/js/vendor.js (ไฟล์ที่เว็บโหลดจริง)
# ใช้: bash scripts/build-vendor.sh           # ตรวจว่า vendor.js ตรงกับ source ไหม
#      bash scripts/build-vendor.sh --write   # เขียนทับ + syntax check + เก็บ .bak
#
# 19 พ.ย.69: ต่อไฟล์แล้วแปลง syntax ลงเป็น ES2017 (ตัด ?. / ??) ด้วย esbuild
# มือถือรุ่นเก่า (iOS < 13.4 / Chrome < 80) อ่าน optional chaining ไม่ได้ → ทั้งไฟล์พัง
# หน้าเว็บค้างที่ "กำลังโหลดรายชื่อ..." · pin esbuild ให้ผลเหมือนกันทุกเครื่อง/CI
set -euo pipefail
cd "$(dirname "$0")/../public/js"

ORDER="utils.js auth.js api.js storage.js fuel.js customer-db.js debt-db.js debt-summary.js"
ESBUILD="npx --yes esbuild@0.24.0"
RAW=/tmp/vendor.raw.js
OUT=/tmp/vendor.new.js

cat $ORDER > "$RAW"
$ESBUILD "$RAW" --target=es2017 --outfile="$OUT" --log-level=warning

if diff -q "$OUT" vendor.js >/dev/null; then
  echo "✅ vendor.js ตรงกับ source (ES2017) อยู่แล้ว"
  exit 0
fi

echo "⚠️ vendor.js ไม่ตรง source — diff:"
diff "$OUT" vendor.js | sed -n '1,80p' || true
echo "--- รวม $(diff "$OUT" vendor.js | wc -l || true) บรรทัดต่าง ---"

if [ "${1:-}" = "--write" ]; then
  cp vendor.js "vendor.js.bak.$(date +%Y%m%d-%H%M%S)"
  mv "$OUT" vendor.js
  node --check vendor.js
  echo "✅ เขียน vendor.js ใหม่แล้ว (ES2017) — stamp-assets จะ bump ?v= ให้"
else
  echo "ยังไม่เขียนไฟล์ — ตรวจ diff แล้วรันซ้ำด้วย --write"
  exit 1
fi
