#!/usr/bin/env bash
# baac-ci — เตรียมค่า + ลงเว็บจริง 1 คำสั่ง
# ใช้: bash ci-app/scripts/deploy.sh [--dry-run]
#   --dry-run = ตรวจค่า + เขียน KV อย่างเดียว ยังไม่ลงเว็บ
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
CFG="ci-app/config.local.json"
ACC="${CLOUDFLARE_ACCOUNT_ID:-0416cbbc07103e45de7381ada19e4307}"
KV="$(grep -A2 '\[\[kv_namespaces\]\]' ci-app/wrangler.toml | grep '^id' | sed 's/.*"\(.*\)".*/\1/')"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { echo "❌ ต้องตั้ง CLOUDFLARE_API_TOKEN ก่อน"; exit 1; }
[ -f "$CFG" ] || { echo "❌ ไม่มี $CFG — copy จาก config.example.json แล้วกรอกค่า"; exit 1; }

echo "── 1/4 ตรวจค่าที่พ่อต้องกรอก ────────────────"
python3 - "$CFG" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
bad = []
link = str(d.get('oneDriveLink', '')).strip()
if not link.startswith('https://') or 'ตัวอย่าง' in link: bad.append('oneDriveLink')
for b in ('854', '145'):
    if not str(d.get('admins', {}).get(b, '')).strip(): bad.append('admins.' + b)
if len(str(d.get('sessionSecret', ''))) < 32: bad.append('sessionSecret')
if bad:
    print('❌ ยังกรอกไม่ครบ:', ', '.join(bad)); sys.exit(1)
print('✅ ค่าครบ (PIN ไม่ถูกพิมพ์ออกหน้าจอ)')
PY

echo "── 2/4 เขียน KV (ci:config / ci:admins) ───────"
python3 - "$CFG" <<'PY'
import json, sys, pathlib
d = json.load(open(sys.argv[1], encoding='utf-8'))
out = pathlib.Path('/home/kara/.hermes/cache/scratch/ci-qa')
out.mkdir(parents=True, exist_ok=True)
(out/'kv-config.json').write_text(json.dumps({'oneDriveLink': d['oneDriveLink']}, ensure_ascii=False), encoding='utf-8')
(out/'kv-admins.json').write_text(json.dumps(d['admins'], ensure_ascii=False), encoding='utf-8')
PY
for pair in "ci:config kv-config.json" "ci:admins kv-admins.json"; do
  set -- $pair
  KEY=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1")
  RES=$(curl -s -X PUT -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
    --data-binary @"/home/kara/.hermes/cache/scratch/ci-qa/$2" \
    "https://api.cloudflare.com/client/v4/accounts/$ACC/storage/kv/namespaces/$KV/values/$KEY")
  echo "$1 → $(echo "$RES" | python3 -c 'import json,sys; print("OK" if json.load(sys.stdin).get("success") else "FAIL")')"
done

echo "── 3/4 ตรวจ branches:all ใน KV ใหม่ ──────────"
N=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACC/storage/kv/namespaces/$KV/values/branches%3Aall" \
  | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
[ "$N" -ge 7 ] || { echo "❌ branches:all มีแค่ $N สาขา (ควร 7)"; exit 1; }
echo "✅ $N สาขา"

if [ "$DRY" = 1 ]; then echo "── dry-run: หยุดก่อนลงเว็บ ─────────────────"; exit 0; fi

echo "── 4/4 ลงเว็บจริง (baac-ci) ─────────────────"
SECRET=$(python3 -c "import json; print(json.load(open('$CFG', encoding='utf-8'))['sessionSecret'])")
printf '%s' "$SECRET" | npx --yes wrangler pages secret put CI_SESSION_SECRET --project-name baac-ci
cd ci-app
npx --yes wrangler pages deploy . --project-name baac-ci --branch main
cd "$ROOT"

echo "── ตรวจเว็บจริง ─────────────────────────────"
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
for p in / /api/branches /api/config; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" "https://baac-ci.pages.dev$p")
  echo "$p → $CODE"
done
echo "✅ เสร็จ — แจ้งพ่อก่อนลงเว็บจริงทุกครั้ง (สคริปต์นี้รันเมื่อพ่อนอนุมัติเท่านั้น)"
