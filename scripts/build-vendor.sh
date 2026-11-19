#!/usr/bin/env bash
# รวม source 8 ไฟล์เป็น public/js/vendor.js (ไฟล์ที่เว็บโหลดจริง)
# ใช้: bash scripts/build-vendor.sh           # dry-run: แสดง diff
#      bash scripts/build-vendor.sh --write   # เขียนทับ + syntax check + เก็บ .bak
set -euo pipefail
cd "$(dirname "$0")/../public/js"

ORDER="utils.js auth.js api.js storage.js fuel.js customer-db.js debt-db.js debt-summary.js"
cat $ORDER > /tmp/vendor.new.js

if diff -q /tmp/vendor.new.js vendor.js >/dev/null; then
  echo "✅ vendor.js ตรงกับ source อยู่แล้ว"
  exit 0
fi

echo "⚠️ vendor.js ไม่ตรง source — diff:"
diff /tmp/vendor.new.js vendor.js | sed -n '1,80p' || true
echo "--- รวม $(diff /tmp/vendor.new.js vendor.js | wc -l || true) บรรทัดต่าง ---"

if [ "${1:-}" = "--write" ]; then
  cp vendor.js "vendor.js.bak.$(date +%Y%m%d-%H%M%S)"
  mv /tmp/vendor.new.js vendor.js
  node --check vendor.js
  echo "✅ เขียน vendor.js ใหม่แล้ว (เก็บ .bak ไว้) — อย่าลืม bump ?v= ใน index.html"
else
  echo "ยังไม่เขียนไฟล์ — ตรวจ diff แล้วรันซ้ำด้วย --write"
  exit 1
fi
