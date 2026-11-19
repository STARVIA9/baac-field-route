#!/usr/bin/env python3
"""Final polish: cover chips inline, natural card wrapping, denser OneDrive window, taller QR strip."""
import pathlib

p = pathlib.Path(__file__).resolve().parent / "deck.template.html"
s = p.read_text(encoding="utf-8")


def rep(old, new, count=1):
    global s
    if old not in s:
        raise SystemExit("NOT FOUND: " + old[:70])
    s = s.replace(old, new, count)


# 1) cover chips -> part of the text block
rep(".cover-chips{position:absolute;left:15mm;bottom:26mm;display:flex;gap:3mm}",
    ".cover-chips{margin-top:9mm;display:flex;gap:3mm}")
rep("""    <div class="cover-chips"><span>1 ปุ่ม ที่คอม</span><span>1 QR ที่แท็บเล็ต</span><span>0 เซิร์ฟเวอร์ใหม่</span></div>
    <div class="cover-foot">""",
    """    <div class="cover-foot">""")
rep("""      ข้อมูลเดินทางในระบบของธนาคาร และไม่มีใครกลางทางอ่านได้</p>""",
    """      ข้อมูลเดินทางในระบบของธนาคาร และไม่มีใครกลางทางอ่านได้</p>
      <div class="cover-chips"><span>1 ปุ่ม ที่คอม</span><span>1 QR ที่แท็บเล็ต</span><span>0 เซิร์ฟเวอร์ใหม่</span></div>""")

# 2) page 2: natural wrapping instead of hard breaks
rep("""<div class="cb">วันนี้ไฟล์ CI ของสาขา 854 อยู่ในโฟลเดอร์ OneDrive ธนาคารแล้ว (10.6 MB)<br>
        แต่ใครที่เข้าถึงโฟลเดอร์ได้ ก็เปิดเห็นชื่อและยอดหนี้ลูกค้าได้ทันที</div>""",
    """<div class="cb">วันนี้ไฟล์ CI ของสาขา 854 อยู่ในโฟลเดอร์ OneDrive ธนาคารแล้ว (10.6 MB) แต่ใครที่เข้าถึงโฟลเดอร์ได้ ก็เปิดเห็นชื่อและยอดหนี้ลูกค้าได้ทันที</div>""")
rep("""<div class="cb">ห้ามต่อ USB · คอมสาขาเปิด hotspot ไม่ได้<br>
        ส่งทางแชทหรืออีเมลก็ไม่ได้ เพราะเป็นข้อมูลลูกค้า<br>
        และไม่ควรให้เจ้าหน้าที่ต้องพิมพ์รหัสยาว ๆ</div>""",
    """<div class="cb">ห้ามต่อ USB · คอมสาขาเปิด hotspot ไม่ได้ · ส่งทางแชทหรืออีเมลก็ไม่ได้ เพราะเป็นข้อมูลลูกค้า และไม่ควรให้เจ้าหน้าที่ต้องพิมพ์รหัสยาว ๆ</div>""")
rep("""<div class="cb">ไม่ต้องรอไอที · ไม่ต้องมีอุปกรณ์เพิ่มในสาขา<br>
        ไม่ต้องติดตั้งเซิร์ฟเวอร์ · และข้อมูลต้องไม่หลุด<br>
        แม้เครื่องหรือโฟลเดอร์จะตกไปอยู่ในมือคนอื่น</div>""",
    """<div class="cb">ไม่ต้องรอไอที · ไม่ต้องมีอุปกรณ์เพิ่มในสาขา · ไม่ต้องติดตั้งเซิร์ฟเวอร์ · และข้อมูลต้องไม่หลุดแม้เครื่องหรือโฟลเดอร์จะตกไปอยู่ในมือคนอื่น</div>""")

# 3) page 3: extra OneDrive row + breathing room
rep("""          <div class="odrow">
            __ICO_FOLDER_SM__
            <span class="nm">สำรองรายเดือน</span>""",
    """          <div class="odrow">
            __ICO_SHIELD_SM__
            <span class="nm" style="font-weight:400;color:#5C6B63">แก้ไขล่าสุด วันนี้ 08:41 · ซิงก์แล้ว</span>
            <span class="meta">สถานะ</span>
          </div>
          <div class="odrow">
            __ICO_FOLDER_SM__
            <span class="nm">สำรองรายเดือน</span>""")
rep(".truthline{margin-top:6mm;", ".truthline{margin-top:9mm;")

# 4) page 5: denser hex block
rep("""          5E A8 31 D7 4B 09 66 F3 8C 27 B1 5D AA 40 79 CE<br>""",
    """          5E A8 31 D7 4B 09 66 F3 8C 27 B1 5D AA 40 79 CE<br>
          91 6C 2E B5 7F D0 43 1A E6 8B 54 CD 07 9F 32 6D<br>
          B0 47 1E 85 FC 39 A2 6B D9 10 78 C5 4E 93 2A EF<br>
          63 0C 57 B1 8E 24 DA 71 3F C6 09 5B 97 E2 14 8D<br>""")

# 5) page 6 proportions
rep(".qrstrip img{width:30mm;height:30mm;", ".qrstrip img{width:34mm;height:34mm;")
rep(".qrstrip .qt{font-size:9.8pt;", ".qrstrip .qt{font-size:10.6pt;")
rep("gap:2.4mm;min-height:110mm}", "gap:2.4mm;min-height:100mm}")

p.write_text(s, encoding="utf-8")
print("ok")
