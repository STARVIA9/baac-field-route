#!/usr/bin/env python3.12
"""Build the CI-via-OneDrive executive deck: inline fonts/icons + QR, render A4 landscape PDF."""
import base64, io, pathlib, shutil, sys

import qrcode
from playwright.sync_api import sync_playwright

BASE = pathlib.Path(__file__).resolve().parent
FONT_R = pathlib.Path.home() / ".fonts/Sarabun-Regular.ttf"
FONT_B = pathlib.Path.home() / ".fonts/Sarabun-Bold.ttf"


def b64(path: pathlib.Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


# ---------------- OneDrive cloud (layered, logo-like) ----------------
def cloud(size_mm: float, extra_class: str = "") -> str:
    px = size_mm * 3.7795
    h = px * 44 / 72
    return f'''<svg class="{extra_class}" width="{px:.1f}" height="{h:.1f}" viewBox="0 0 72 44" xmlns="http://www.w3.org/2000/svg">
  <path fill="#0364B8" d="M27 41h28.6a11.5 11.5 0 0 0 2.2-22.8A15.5 15.5 0 0 0 28.6 12 13 13 0 0 0 27 41z"/>
  <path fill="#0F7FD4" d="M15 41h23.2a10.6 10.6 0 0 0 1.1-21.1A13.6 13.6 0 0 0 12.2 18 11.2 11.2 0 0 0 15 41z"/>
  <path fill="#28A8EA" d="M20 34.5h24.6a7.4 7.4 0 0 0 .7-14.7 9.6 9.6 0 0 0-18-3.2A7.9 7.9 0 0 0 20 34.5z"/>
</svg>'''


def svg(body: str, w: float, h: float, vb: str, stroke: str = "currentColor", sw: float = 1.6,
        fill: str = "none", extra: str = "") -> str:
    return (f'<svg width="{w}mm" height="{h}mm" viewBox="{vb}" fill="{fill}" stroke="{stroke}" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" {extra} '
            f'xmlns="http://www.w3.org/2000/svg">{body}</svg>')


ICO = {}
ICO["__ICO_FOLDER__"] = svg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4.2l2.3 3h9.5A2.5 2.5 0 0 1 24 10.5v8A2.5 2.5 0 0 1 21.5 21h-16A2.5 2.5 0 0 1 3 18.5z"/>',
                            13, 13, "0 0 27 26")
ICO["__ICO_BLOCK__"] = svg('<circle cx="12" cy="12" r="8.5"/><path d="M6.2 17.8 17.8 6.2"/>', 13, 13, "0 0 24 24")
ICO["__ICO_TARGET__"] = svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
                            13, 13, "0 0 24 24")
ICO["__ICO_ARROW_RIGHT__"] = svg('<path d="M3 12h16"/><path d="m13 6 6 6-6 6"/>', 8, 8, "0 0 24 24",
                                 stroke="#EBCB66", sw=2.2)
ICO["__ICO_ARROW_SM__"] = svg('<path d="M2 12h18"/><path d="m14 6 6 6-6 6"/>', 6, 6, "0 0 24 24")
ICO["__ARROW__"] = svg('<path d="M2 12h19"/><path d="m15 5 7 7-7 7"/>', 13, 5.4, "0 0 24 24",
                       stroke="#97A8A0", sw=2.4)
ICO["__OD_CLOUD_BIG__"] = cloud(62)
ICO["__OD_CLOUD_MD__"] = cloud(26)
ICO["__OD_CLOUD_SM__"] = cloud(5.2)
ICO["__ICO_FOLDER_SM__"] = svg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4.2l2.3 3h9.5A2.5 2.5 0 0 1 24 10.5v8A2.5 2.5 0 0 1 21.5 21h-16A2.5 2.5 0 0 1 3 18.5z"/>',
                               5.6, 5.6, "0 0 27 26", stroke="#0B7BD4", sw=1.8)
ICO["__ICO_LOCK_SM__"] = svg('<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
                             5.4, 5.4, "0 0 24 24", stroke="#0B5EA8", sw=1.9)
ICO["__ICO_SHIELD_SM__"] = svg('<path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
                               5.6, 5.6, "0 0 24 24", stroke="#14684A", sw=1.7)
ICO["__ICO_BANK__"] = svg('<path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20.5h18"/>',
                          10, 10, "0 0 24 24", stroke="#14684A", sw=1.7)
ICO["__ICO_USERS__"] = svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c0-3.3 2.5-5.4 5.5-5.4s5.5 2.1 5.5 5.4"/><path d="M16 5.6a3 3 0 0 1 0 6"/><path d="M17.5 13.9c2 .6 3.4 2.4 3.4 5.1"/>',
                           10, 10, "0 0 24 24", stroke="#14684A", sw=1.7)
ICO["__ICO_PLUG__"] = svg('<path d="M9 3v5M15 3v5"/><path d="M6.5 8h11v3.2a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.7V21"/>',
                          10, 10, "0 0 24 24", stroke="#14684A", sw=1.7)
ICO["__ICO_PC__"] = svg('<rect x="2.5" y="4.5" width="19" height="12" rx="1.8"/><path d="M9 20h6M12 16.5V20"/>',
                        24, 24, "0 0 24 24", stroke="#14684A", sw=1.5)
ICO["__ICO_TABLET__"] = svg('<rect x="5.5" y="2.5" width="13" height="19" rx="2.2"/><path d="M10.5 18.6h3"/>',
                            24, 24, "0 0 24 24", stroke="#14684A", sw=1.5)
ICO["__ICO_SHIELD_W__"] = svg('<path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
                              6.4, 6.4, "0 0 24 24", stroke="#EBCB66", sw=1.9)
ICO["__ICO_QR__"] = svg('<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3v3h-3zM20.5 14v6.5M14 20.5h6.5"/>',
                        14, 14, "0 0 24 24", stroke="#14684A", sw=1.5)
ICO["__ICO_KEY__"] = svg('<circle cx="8" cy="8" r="4.2"/><path d="m11.2 11.2 8.3 8.3M16 16l2.4-2.4M18.6 18.6 21 16.2"/>',
                         14, 14, "0 0 24 24", stroke="#14684A", sw=1.5)
ICO["__ICO_DB__"] = svg('<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
                        14, 14, "0 0 24 24", stroke="#14684A", sw=1.5)
ICO["__ICO_TRASH__"] = svg('<path d="M4.5 6.5h15M9 6.5V4.5h6v2M6.5 6.5 7.5 20h9l1-13.5"/><path d="M10.5 10v6M13.5 10v6"/>',
                           14, 14, "0 0 24 24", stroke="#14684A", sw=1.5)


def make_qr() -> str:
    payload = ("BFR-KEY:JPB2-BJE3-YCGF-ZUMF-352U-R6VX-BNGB-GYB-JTAL-YW5Q-PVIL-247L-HP5A"
               "|FILE:CI_0854_20261115.bfrpack|EXP:15m")
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=1)
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0B3D2E", back_color="#FFFFFF").convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    (BASE / "qr_sample.png").write_bytes(buf.getvalue())
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> int:
    html = (BASE / "deck.template.html").read_text(encoding="utf-8")
    html = html.replace("__FONT_REGULAR__", b64(FONT_R)).replace("__FONT_BOLD__", b64(FONT_B))
    html = html.replace("__QR_SRC__", make_qr())
    for k, v in ICO.items():
        html = html.replace(k, v)
    left = [t for t in ("__FONT_", "__QR_SRC__", "__ICO_", "__OD_CLOUD", "__ARROW") if t in html]
    if left:
        print("UNREPLACED:", left, file=sys.stderr)
        return 1

    out_html = BASE / "deck.html"
    out_html.write_text(html, encoding="utf-8")
    pdf = BASE / "CI-OneDrive-กระบวนการนำส่งข้อมูล.pdf"

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 1123, "height": 794})
        page.goto(out_html.as_uri())
        page.emulate_media(media="print")
        page.wait_for_timeout(1200)
        page.pdf(path=str(pdf), format="A4", landscape=True, print_background=True,
                 prefer_css_page_size=True, margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
        browser.close()

    print(pdf)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
