#!/usr/bin/env bash
# Backup ก่อน deploy — D1 (full+schema), KV ทั้งหมด, git info, baseline counts
# ใช้: bash scripts/backup-before-deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=$(date +%Y%m%d-%H%M)
OUT="backups/deploy-$STAMP"
DB="baac-field-route-db"
KV_NS="bc1b3d9b873045c88b43ebe0fd241706"
mkdir -p "$OUT/kv"

echo "==> D1 export (full) → $OUT/d1-full.sql"
wrangler d1 export "$DB" --remote --skip-confirmation --output "$OUT/d1-full.sql"

echo "==> D1 export (schema only) → $OUT/d1-schema.sql"
wrangler d1 export "$DB" --remote --skip-confirmation --no-data --output "$OUT/d1-schema.sql"

echo "==> KV keys → $OUT/kv/"
wrangler kv key list --namespace-id "$KV_NS" --remote > "$OUT/kv-keys.raw" 2>/dev/null
python3 - "$OUT" "$KV_NS" <<'PY'
import json,sys,subprocess,os,re
out,ns=sys.argv[1],sys.argv[2]
raw=open(os.path.join(out,'kv-keys.raw'),encoding='utf-8',errors='replace').read()
data=json.loads(raw[raw.index('['):])
keys=[x['name'] for x in data]
print(f'   พบ {len(keys)} คีย์')
fail=[]
for k in keys:
    safe=re.sub(r'[^A-Za-z0-9._-]+','__',k)
    path=os.path.join(out,'kv',safe+'.txt')
    r=subprocess.run(['wrangler','kv','key','get',k,'--namespace-id',ns,'--remote','--text'],
                     capture_output=True,text=True)
    if r.returncode!=0:
        fail.append(k); continue
    # ตัด banner บรรทัดแรกถ้ามี (เฉพาะกรณีที่ไม่ใช่ JSON)
    txt=r.stdout
    if txt.startswith('Cloudflare agent skills'):
        txt=txt.split('\n',1)[1] if '\n' in txt else ''
    open(path,'w',encoding='utf-8').write(txt)
open(os.path.join(out,'kv-failed.txt'),'w').write('\n'.join(fail))
print(f'   ดาวน์โหลดสำเร็จ {len(keys)-len(fail)} / {len(keys)}')
if fail: print('   ⚠️ ล้มเหลว:', ', '.join(fail))
PY

echo "==> git info"
{
  echo "branch: $(git branch --show-current)"
  echo "commit: $(git rev-parse HEAD)"
  echo "commit_short: $(git rev-parse --short HEAD)"
  echo "date: $(date -Iseconds)"
  echo "status:"
  git status --short
} > "$OUT/git.txt"

echo "==> D1 counts"
wrangler d1 execute "$DB" --remote --json \
  --command "SELECT (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM gps_history) AS gps_history, (SELECT MAX(updated_at) FROM customers) AS max_updated, (SELECT COUNT(*) FROM sqlite_master WHERE type='table') AS tables;" \
  > "$OUT/counts.raw" 2>/dev/null
python3 - "$OUT" <<'PY'
import json,sys,os
out=sys.argv[1]
raw=open(os.path.join(out,'counts.raw'),encoding='utf-8',errors='replace').read()
d=json.loads(raw[raw.index('['):])
row=d[0]['results'][0]
open(os.path.join(out,'counts.json'),'w').write(json.dumps(row,ensure_ascii=False,indent=2))
print('  ',row)
PY

echo "==> ตรวจไฟล์"
ls -lh "$OUT"/d1-full.sql "$OUT"/d1-schema.sql | sed 's/^/   /'
echo "   KV ไฟล์: $(ls "$OUT/kv" | wc -l) ไฟล์"
[ -s "$OUT/d1-full.sql" ] || { echo "❌ d1-full.sql ว่าง"; exit 1; }
[ "$(stat -c%s "$OUT/d1-full.sql")" -gt 1000000 ] || { echo "❌ d1-full.sql เล็กผิดปกติ"; exit 1; }

# copy ไป OneDrive ถ้ามี
ONEDRIVE="/mnt/c/Users/ichillshop/OneDrive/Documents/BAAC-Backups"
if [ -d "$ONEDRIVE" ]; then
  cp -r "$OUT" "$ONEDRIVE/" && echo "==> copy ไป OneDrive แล้ว: $ONEDRIVE/deploy-$STAMP"
else
  echo "⚠️ ไม่พบ $ONEDRIVE — เก็บไว้ที่เครื่องเท่านั้น"
fi

echo "✅ Backup เสร็จ: $OUT"
