#!/usr/bin/env python3
"""One-shot layout fixes for deck.template.html (vertical rhythm + OneDrive window density)."""
import pathlib
import re

p = pathlib.Path(__file__).resolve().parent / "deck.template.html"
s = p.read_text(encoding="utf-8")

# The raw garble block in the template contains stray control bytes — replace it wholesale.
clean_garble = """<div class="garble"><span class="hdr1">BFR1</span> 27 3E 9A C4 0F 7B E1 55 D8 2C 60 AF 11 9D 4E 83<br>
          7C 05 B2 EE 48 D1 36 9F 0A 74 C7 5B 22 8E F3 69<br>
          03 AD 91 5C E7 2B 78 C0 44 1F D6 8A 35 9B 62 FE<br>
          0F 3A 9C E1 7B 22 D4 88 5E 01 AF C3 76 9B 2D E8<br>
          4F 11 AC 63 B7 05 E9 2E 7C 8D 14 6A F0 3B 97 C2<br>
          5E A8 31 D7 4B 09 66 F3 8C 27 B1 5D AA 40 79 CE<br>
          µ§¶Ž¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß<br>
          ŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰′″‹›⁄€₣₤₧₩₪₫</div>"""
s, n = re.subn(r'<div class="garble">.*?</div>', clean_garble, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit("garble block not replaced")

R = [
# ---- CSS rhythm ----
(".grid3 .card{flex:1;min-height:92mm;", ".grid3 .card{flex:1;min-height:105mm;"),
(".grid3 .cb{font-size:11.5pt;", ".grid3 .cb{font-size:12pt;"),
(".odwin{flex:0 0 152mm;border:1px solid #D6DEE7;", ".odwin{flex:0 0 152mm;display:flex;flex-direction:column;border:1px solid #D6DEE7;"),
(".odside{flex:1;display:flex;flex-direction:column;gap:3mm}",
 ".odside{flex:1;display:flex;flex-direction:column;gap:3mm;justify-content:space-between}"),
(".odside .card{padding:3.6mm 4.4mm}",
 ".odside .card{flex:1;display:flex;flex-direction:column;justify-content:center;padding:4mm 4.6mm}"),
(".node{flex:1;border:1px solid var(--line);border-radius:3mm;background:#fff;padding:5mm 4.5mm;",
 ".node{flex:1;min-height:99mm;border:1px solid var(--line);border-radius:3mm;background:#fff;padding:5mm 4.5mm;"),
(".arrow svg{width:14mm;height:6mm}",
 ".arrow svg{width:14mm;height:6mm}\n.node > svg{height:21mm;width:auto;align-self:center}"),
(".step{flex:1;border:1px solid var(--line);border-radius:3mm;padding:4.4mm 4mm;background:#fff;display:flex;flex-direction:column;gap:2.2mm;min-height:96mm}",
 ".step{flex:1;border:1px solid var(--line);border-radius:3mm;padding:4.6mm 4.2mm;background:#fff;display:flex;flex-direction:column;gap:2.4mm;min-height:110mm}"),
(".step .ic{margin-top:auto;color:var(--green2);align-self:center}",
 ".step .ic{margin-top:auto;color:var(--green2);align-self:center}\n.step .ic svg{width:17mm;height:17mm}"),
(".qrstrip img{width:26mm;height:26mm;", ".qrstrip img{width:30mm;height:30mm;"),
(".g4 .card{flex:1 1 calc(50% - 2.25mm);min-height:36mm;", ".g4 .card{flex:1 1 calc(50% - 2.25mm);min-height:41mm;"),
(".g4 .gd{font-size:9.6pt;", ".g4 .gd{font-size:10.2pt;"),
(".stat .l{font-size:7.8pt;", ".stat .l{font-size:8.5pt;"),
(".garble{font-family:'DejaVu Sans Mono',monospace;font-size:7.2pt;", ".garble{overflow:hidden;font-family:'DejaVu Sans Mono',monospace;font-size:7.6pt;"),
(".truthline{margin-top:3mm;", ".truthline{margin-top:auto;"),
("box-shadow:0 0 0 2.6mm rgba(201,162,39,.18)", "box-shadow:0 0 0 1.6mm rgba(201,162,39,.18)"),
(".cover-cloud{position:absolute;right:16mm;top:93mm;width:82mm;text-align:center}",
 ".cover-cloud{position:absolute;right:16mm;top:100mm;width:84mm;text-align:center}\n"
 ".cover-chips{position:absolute;left:15mm;bottom:26mm;display:flex;gap:3mm}\n"
 ".cover-chips span{font-size:9.5pt;color:#E4C55C;border:1px solid rgba(228,197,92,.45);border-radius:20px;padding:1.8mm 4.4mm;letter-spacing:.2px}"),
(".cover h1{font-size:31pt;", ".cover h1{font-size:32pt;"),
# ---- page 2 ----
("""<div class="cb">ห้ามต่อ USB · คอมในสาขาเปิด hotspot ไม่ได้ ·<br>
        ส่งทางแชทหรืออีเมลก็ไม่ได้ เพราะเป็นข้อมูลลูกค้า<br>
        และแท็บเล็ตก็ไม่ควรต้องพิมพ์รหัสยาว ๆ</div>""",
 """<div class="cb">ห้ามต่อ USB · คอมสาขาเปิด hotspot ไม่ได้<br>
        ส่งทางแชทหรืออีเมลก็ไม่ได้ เพราะเป็นข้อมูลลูกค้า<br>
        และไม่ควรให้เจ้าหน้าที่ต้องพิมพ์รหัสยาว ๆ</div>"""),
('<div class="band" style="margin-top:6mm">', '<div class="band" style="margin-top:auto">'),
# ---- page 3 rows ----
("""          <div class="odrow">
            __ICO_SHIELD_SM__
            <span class="nm" style="font-weight:400;color:#5C6B63">โฟลเดอร์นี้เห็นได้เฉพาะผู้มีสิทธิ์ของสาขา</span>
          </div>""",
 """          <div class="odrow">
            __ICO_FOLDER_SM__
            <span class="nm">สำรองรายเดือน</span>
            <span class="meta">โฟลเดอร์</span>
          </div>
          <div class="odrow">
            __ICO_SHIELD_SM__
            <span class="nm" style="font-weight:400;color:#5C6B63">แชร์เฉพาะผู้มีสิทธิ์ของสาขา</span>
            <span class="meta">สิทธิ์การเข้าถึง</span>
          </div>"""),
# ---- page 4 band ----
('<div class="band" style="margin-top:7mm">', '<div class="band" style="margin-top:auto">'),
# ---- page 6 ----
('<div class="qrstrip">', '<div class="qrstrip" style="margin-top:auto">'),
# ---- cover chips ----
("""    <div class="cover-foot">""",
 """    <div class="cover-chips"><span>1 ปุ่ม ที่คอม</span><span>1 QR ที่แท็บเล็ต</span><span>0 เซิร์ฟเวอร์ใหม่</span></div>
    <div class="cover-foot">"""),
]

for old, new in R:
    if old not in s:
        raise SystemExit("NOT FOUND: " + old[:80])
    s = s.replace(old, new, 1)

p.write_text(s, encoding="utf-8")
print("patched", len(R))
