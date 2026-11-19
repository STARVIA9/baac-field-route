#!/usr/bin/env python3
"""สร้าง public/demo/index.html จาก public/index.html

เว็บตัวอย่างต้องมี UI/ออปชันเหมือนเว็บจริงเสมอ — สคริปต์นี้ทำให้เป็นสำเนาที่
สร้างใหม่ได้ทุกครั้ง (ไม่ต้องก๊อปมือ) ต่างกันแค่ 4 จุด:
  1) <base href="/"> ให้ asset สัมพัทธ์ชี้ไฟล์จริงที่ root
  2) <title> ต่อท้าย "(เว็บตัวอย่าง)"
  3) meta robots noindex
  4) โหลด /demo/demo-mock.js ก่อน vendor.js (mock ข้อมูล + กัน SW + แยก storage)

ใช้:  python3 scripts/build-demo.py [--check]
"""
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'index.html')
DST = os.path.join(ROOT, 'public', 'demo', 'index.html')
MOCK = os.path.join(ROOT, 'public', 'demo', 'demo-mock.js')
MARK = 'demo-mock.js'


def mock_version() -> str:
    """cache-bust ตามเนื้อหา demo-mock.js — แก้ข้อมูลตัวอย่างแล้ว URL เปลี่ยนเอง"""
    try:
        with open(MOCK, 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()[:8]
    except OSError:
        return 'demo1'


def build(html: str) -> str:
    out = html
    ver = mock_version()
    if '<base ' not in out:
        out = out.replace('<head>', '<head>\n  <base href="/">\n'
                          '  <!-- DEMO: base บังคับ asset สัมพัทธ์ (js/css/lib/icons) ชี้ไฟล์จริงที่ root -->', 1)
    if '(เว็บตัวอย่าง)' not in out:
        out = re.sub(r'(<title>)(.*?)(</title>)',
                     lambda m: m.group(1) + m.group(2) + ' (เว็บตัวอย่าง)' + m.group(3), out, count=1)
        out = out.replace('</title>', '</title>\n  <meta name="robots" content="noindex">', 1)
    if MARK not in out:
        out = out.replace('<script src="js/vendor.js',
                          f'<script src="/demo/demo-mock.js?v={ver}"></script>\n  <script src="js/vendor.js', 1)
    else:
        out = re.sub(r'(/demo/demo-mock\.js\?v=)[^"]+', lambda m: m.group(1) + ver, out)
    return out


def stats(html: str) -> str:
    return (f"select={len(re.findall(r'<select', html))} "
            f"option={len(re.findall(r'<option', html))} "
            f"button={len(re.findall(r'<button', html))} "
            f"tab={len(re.findall(r'data-sheet=', html))} "
            f"lines={html.count(chr(10)) + 1}")


def main():
    src = open(SRC, encoding='utf-8').read()
    out = build(src)
    if '--check' in sys.argv:
        cur = open(DST, encoding='utf-8').read() if os.path.exists(DST) else ''
        ok = cur == out
        print(f"{'OK' if ok else 'DRIFT'} demo/index.html "
              f"(มีอยู่ {stats(cur) if cur else '-'} · ควรเป็น {stats(out)})")
        sys.exit(0 if ok else 1)
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    open(DST, 'w', encoding='utf-8').write(out)
    print('เขียน', os.path.relpath(DST, ROOT))
    print('  เว็บจริง:', stats(src))
    print('  เว็บตัวอย่าง:', stats(out))
    assert stats(src).count('=') == stats(out).count('=') and \
        re.sub(r'lines=\d+', '', stats(src)) == re.sub(r'lines=\d+', '', stats(out)), 'UI ไม่ตรงกัน!'
    print('  UI ตรงกันทุกจุด (select/option/button/tab เท่ากัน)')


if __name__ == '__main__':
    main()
