#!/usr/bin/env python3
"""ติด version ของ asset จาก "เนื้อหา" (content hash) ใน index.html

ทำไม: เดิม bump ?v= มือทีละไฟล์ ทำให้ทุก deploy ต้องโหลดใหม่ทั้งชุด (~570KB)
แม้ไฟล์ไม่ได้เปลี่ยน → เปิดเว็บช้าช่วงหลังอัปเดต
สคริปต์นี้คำนวณ sha1 ของไฟล์จริง แล้วเขียน ?v=<hash8> ให้เฉพาะไฟล์ที่เปลี่ยน

ใช้: python3 scripts/stamp-assets.py [--check]
"""
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')
INDEX = os.path.join(PUB, 'index.html')
PATTERN = re.compile(r'((?:href|src)=")(/?)((?:js|css)/[^"?]+)(?:\?v=[^"]*)?(")')


def dig(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()[:10]


def main():
    html = open(INDEX, encoding='utf-8').read()
    changed = []

    def repl(m):
        pre, slash, rel, post = m.group(1), m.group(2), m.group(3), m.group(4)
        fp = os.path.join(PUB, rel)
        if not os.path.isfile(fp):
            return m.group(0)
        v = dig(fp)
        new = f'{pre}{slash}{rel}?v={v}{post}'
        if new != m.group(0):
            changed.append(rel)
        return new

    out = PATTERN.sub(repl, html)
    if '--check' in sys.argv:
        drift = sorted(set(changed))
        print(('OK' if not drift else 'DRIFT') + f' — {len(drift)} ไฟล์')
        for d in drift:
            print('  •', d)
        sys.exit(0 if not drift else 1)

    open(INDEX, 'w', encoding='utf-8').write(out)
    print(f'stamped {len(set(changed))} asset(s): ' + (', '.join(sorted(set(changed))) or 'ไม่มีการเปลี่ยนแปลง'))


if __name__ == '__main__':
    main()
