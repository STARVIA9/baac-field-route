#!/usr/bin/env python3
"""ตรวจว่า Service Worker เตรียมไฟล์ครบกับที่ index.html เรียกจริงหรือไม่
ใช้: python3 scripts/check-offline-assets.py
อ่านอย่างเดียว — ไม่แก้ไฟล์
"""
import re, sys, os
from urllib.parse import urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
idx = open(os.path.join(PUB, 'index.html'), encoding='utf-8').read()
sw = open(os.path.join(PUB, 'sw.js'), encoding='utf-8').read()

# 1) ไฟล์ local ที่หน้าแรกเรียก (ทั้งแบบมี/ไม่มี ?v=)
refs = set()
for m in re.finditer(r'(?:src|href)\s*=\s*["\']([^"\']+)["\']', idx):
    u = m.group(1).strip()
    if u.startswith(('http://', 'https://', 'data:', '#', 'mailto:')):
        continue
    p = urlsplit(u).path
    if p.endswith(('.js', '.css')):
        refs.add(u.lstrip('/'))

# 2) รายการใน ASSETS ของ sw.js
m = re.search(r'const\s+ASSETS\s*=\s*\[(.*?)\]', sw, re.S)
sw_assets = []
if m:
    sw_assets = re.findall(r'["\']([^"\']+)["\']', m.group(1))
sw_set = {a.lstrip('/') for a in sw_assets}

def norm(u):
    return urlsplit(u).path.lstrip('/')

ref_norm = {norm(r) for r in refs}
sw_norm = {norm(a) for a in sw_assets}

missing = sorted(ref_norm - sw_norm)
extra = sorted(sw_norm - ref_norm)
versioned = sorted([r for r in refs if '?v=' in r])

print('=== สรุป ===')
print(f'index.html เรียกไฟล์ local: {len(refs)} รายการ')
print(f'SW precache: {len(sw_assets)} รายการ')
print(f'\n[ขาด] ไฟล์ที่หน้าแรกใช้แต่ SW ไม่ได้เตรียม ({len(missing)}):')
for u in missing:
    print('  -', u)
print(f'\n[เกิน] SW เตรียมไว้แต่หน้าแรกไม่ได้เรียก ({len(extra)}):')
for u in extra:
    print('  -', u)
print(f'\n[เสี่ยง] ไฟล์ที่มี ?v= แต่ precache เป็นชื่อไม่มี query ({len(versioned)}):')
for u in versioned:
    print('  -', u, '→ cache key ต้องตรงทั้ง query')

# 3) ไฟล์ที่มีอยู่จริงแต่ไม่ได้ precache และไม่ได้อยู่ใน /js หรือ /css (default handler)
local_missing_files = [u for u in missing if not os.path.exists(os.path.join(PUB, u))]
print('\n[ไฟล์หาย] อ้างในหน้าแรกแต่ไม่มีในเครื่อง:', len(local_missing_files))
for u in local_missing_files:
    print('  -', u)

sys.exit(1 if missing else 0)
