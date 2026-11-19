#!/usr/bin/env bash
# Pre-flight gate ก่อน deploy BAAC Field Route
# ใช้: bash scripts/preflight.sh [--skip-offline]
# exit 0 = ผ่านทุกข้อ, 1 = มีข้อที่ต้องแก้
set -uo pipefail
cd "$(dirname "$0")/.."

SKIP_OFFLINE=0
[ "${1:-}" = "--skip-offline" ] && SKIP_OFFLINE=1

PASS=0; FAIL=0; WARN=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "❌ $1"; FAIL=$((FAIL+1)); }
warn() { echo "⚠️  $1"; WARN=$((WARN+1)); }

echo "=============================================="
echo " BAAC Field Route — Pre-flight"
echo " $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "=============================================="

# ---------- 1) git ----------
BRANCH=$(git branch --show-current 2>/dev/null || echo "?")
echo "branch: $BRANCH"
if [ "$BRANCH" = "main" ]; then
  warn "อยู่บน main — ควรทำงานบน branch แล้ว merge หลังทดสอบ"
else
  ok "ไม่ได้อยู่บน main"
fi
if [ -n "$(git status --porcelain)" ]; then
  warn "มีไฟล์ยังไม่ commit: $(git status --porcelain | wc -l) รายการ"
else
  ok "git สะอาด"
fi

# ---------- 2) version ----------
if python3 - <<'EOF'
import json,sys
try:
    d=json.load(open('public/version.json'))
    assert d.get('version') and d.get('lastUpdate')
except Exception as e:
    print('bad version.json:',e); sys.exit(1)
EOF
then ok "version.json อ่านได้"; else bad "version.json เสีย/ไม่มี version"; fi

if grep -q 'app.bundle.js?v=' public/index.html && grep -q 'app.css?v=' public/index.html; then
  ok "index.html มี cache-bust ?v= ของ JS/CSS หลัก"
else
  bad "index.html ขาด ?v= (เสี่ยง cache ค้างรุ่นเก่า)"
fi

# ---------- 3) offline assets ----------
if [ "$SKIP_OFFLINE" = "1" ]; then
  warn "ข้ามการตรวจ offline assets (--skip-offline)"
else
  if python3 scripts/check-offline-assets.py > /tmp/bfr-assets.txt 2>&1; then
    ok "SW precache ครบกับ index.html"
  else
    bad "SW precache ไม่ครบ — ดู: python3 scripts/check-offline-assets.py"
    sed -n '1,20p' /tmp/bfr-assets.txt | sed 's/^/    /'
  fi
fi

# ---------- 4) bundle drift ----------
cd public/js
if cat customers.js tsp.js route.js visit.js report.js app.js > /tmp/bfr-appbundle.js && \
   diff -q /tmp/bfr-appbundle.js app.bundle.js >/dev/null; then
  ok "app.bundle.js ตรงกับ source"
else
  bad "app.bundle.js ไม่ตรง source — รัน scripts/build-bundles.sh"
fi

if cat utils.js auth.js api.js storage.js fuel.js customer-db.js debt-db.js debt-summary.js > /tmp/bfr-vendor.js && \
   diff -q /tmp/bfr-vendor.js vendor.js >/dev/null; then
  ok "vendor.js ตรงกับ source"
else
  warn "vendor.js ไม่ตรง source ($(diff /tmp/bfr-vendor.js vendor.js | wc -l) บรรทัด) — ต้อง sync ก่อนแก้ storage.js"
fi

# ---------- 4b) demo sync ----------
cd ../..
if python3 scripts/build-demo.py --check >/tmp/bfr-demo.txt 2>&1; then
  ok "demo ตรงกับเว็บจริง ($(grep -o 'select=[0-9]* option=[0-9]*' /tmp/bfr-demo.txt | head -1))"
else
  if python3 scripts/build-demo.py >/tmp/bfr-demo-build.txt 2>&1; then
    ok "demo ล้าสมัย — สร้างใหม่จาก index.html ให้แล้ว"
  else
    bad "build demo ไม่ผ่าน — ดู /tmp/bfr-demo-build.txt"
  fi
fi
cd public/js

# ---------- 5) syntax ----------
SYNTAX_BAD=0
for f in *.js; do
  node --check "$f" >/dev/null 2>&1 || { bad "syntax error: js/$f"; SYNTAX_BAD=1; }
done
node --check ../sw.js >/dev/null 2>&1 || { bad "syntax error: sw.js"; SYNTAX_BAD=1; }
[ "$SYNTAX_BAD" = "0" ] && ok "syntax JS ผ่านทุกไฟล์"

cd ../..

# ---------- 6) live health ----------
H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://baacroute.shop/ || echo 000)
[ "$H" = "200" ] && ok "เว็บจริง / = 200" || bad "เว็บจริง / = $H"

V=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://baacroute.shop/version.json || echo 000)
[ "$V" = "200" ] && ok "เว็บจริง /version.json = 200" || bad "เว็บจริง /version.json = $V"

S=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://baacroute.shop/api/sync?probe=1 || echo 000)
case "$S" in
  200|401) ok "API sync ตอบ ($S = worker ยัง hidup)" ;;
  *) bad "API sync = $S (คาด 200/401)" ;;
esac

# ---------- 7) backup ล่าสุด ----------
LATEST=$(ls -1dt backups/deploy-* 2>/dev/null | head -1 || true)
if [ -n "$LATEST" ] && [ -f "$LATEST/d1-full.sql" ] && [ "$(stat -c%s "$LATEST/d1-full.sql")" -gt 1000000 ]; then
  AGE_H=$(( ( $(date +%s) - $(stat -c%Y "$LATEST/d1-full.sql") ) / 3600 ))
  if [ "$AGE_H" -le 24 ]; then ok "backup ล่าสุดอายุ ${AGE_H} ชม. ($LATEST)"
  else warn "backup ล่าสุดอายุ ${AGE_H} ชม. — ควร backup ใหม่"; fi
else
  bad "ไม่พบ backup deploy ล่าสุด — รัน scripts/backup-before-deploy.sh"
fi

# ---------- สรุป ----------
echo "----------------------------------------------"
echo "ผ่าน $PASS · เตือน $WARN · ไม่ผ่าน $FAIL"
echo "----------------------------------------------"
[ "$FAIL" -eq 0 ] || exit 1
