#!/usr/bin/env bash
# deploy เว็บจริง — บังคับให้เว็บตัวอย่าง (demo) สอดคล้องกันทุกครั้ง
# ใช้: bash scripts/deploy.sh [--dry-run] [--skip-offline]
#   1) build demo จาก index.html ล่าสุด
#   2) preflight gate (รวม demo sync + bundle + syntax + backup)
#   3) wrangler pages deploy (branch main = production)
#   4) ตรวจบนเว็บจริงว่า demo ตรงกับเว็บจริง (select/option/button/tab เท่ากัน)
set -uo pipefail
cd "$(dirname "$0")/.."

BRANCH="main"
DRY=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--dry-run" ]; then DRY=1; else ARGS+=("$a"); fi
done

echo "── 0/4 ตั้ง version asset จากเนื้อหา (hash) ───"
python3 scripts/stamp-assets.py

echo "── 1/4 สร้าง demo จากเว็บจริง ─────────────────"
python3 scripts/build-demo.py || { echo "❌ build-demo ล้มเหลว"; exit 1; }

echo "── 2/4 preflight ─────────────────────────────"
bash scripts/preflight.sh ${ARGS[@]+"${ARGS[@]}"} || { echo "❌ preflight ไม่ผ่าน — ไม่ deploy"; exit 1; }

if [ "$DRY" = 1 ]; then
  echo "── dry-run: หยุดก่อน deploy ─────────────────"
  python3 scripts/check-demo-live.py || true
  exit 0
fi

echo "── 3/4 deploy production (branch $BRANCH) ────"
npx --yes wrangler pages deploy public --project-name baac-field-route \
  --branch "$BRANCH" --commit-dirty=true || { echo "❌ deploy ล้มเหลว"; exit 1; }

echo "── 4/4 ตรวจเว็บจริง: demo ต้องตรงกับเว็บจริง ──"
python3 scripts/check-demo-live.py --wait 120
