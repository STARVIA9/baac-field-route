#!/usr/bin/env python3
"""ตรวจว่า demo บนเว็บจริงสอดคล้องกับเว็บจริง (select/option/button/tab เท่ากัน)

ใช้: python3 scripts/check-demo-live.py [--wait 60]
exit 0 = ตรงกัน · 1 = ไม่ตรง/โหลดไม่ได้
"""
import re
import sys
import time
import urllib.request

BASE = 'https://baacroute.shop'
PATHS = {'real': '/', 'demo': '/demo/'}


def counts(url):
    req = urllib.request.Request(url, headers={
        'cache-control': 'no-cache',
        'user-agent': 'Mozilla/5.0 (compatible; bfr-deploy-check/1.0)',
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        h = r.read().decode('utf-8', 'ignore')
    return {
        'select': len(re.findall(r'<select', h)),
        'option': len(re.findall(r'<option', h)),
        'button': len(re.findall(r'<button', h)),
        'tab': len(re.findall(r'data-sheet=', h)),
        'mock': bool(re.search(r'demo-mock\.js\?v=', h)),
    }


def main():
    wait = 0
    if '--wait' in sys.argv:
        wait = int(sys.argv[sys.argv.index('--wait') + 1])
    deadline = time.time() + wait
    while True:
        try:
            real = counts(BASE + PATHS['real'] + '?cb=' + str(int(time.time())))
            demo = counts(BASE + PATHS['demo'] + '?cb=' + str(int(time.time())))
        except Exception as e:
            print(f'โหลดไม่สำเร็จ: {e}')
            if time.time() >= deadline:
                return 1
            time.sleep(10)
            continue

        ui = ['select', 'option', 'button', 'tab']
        diff = {k: (real[k], demo[k]) for k in ui if real[k] != demo[k]}
        if not diff and demo['mock']:
            print('✅ demo ตรงกับเว็บจริง: ' + ' · '.join(f'{k} {real[k]}' for k in ui))
            return 0
        print('❌ demo ไม่ตรง — ' + (', '.join(f'{k}: จริง {v[0]} / demo {v[1]}' for k, v in diff.items())
                                    or 'demo ไม่ได้โหลด demo-mock.js'))
        if time.time() >= deadline:
            return 1
        print('   รอ propagation 10 วิ...')
        time.sleep(10)


if __name__ == '__main__':
    sys.exit(main())
