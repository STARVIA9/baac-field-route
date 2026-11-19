#!/usr/bin/env python3
"""Second pass: bigger executive typography, fixed band spacing (no auto-push gaps)."""
import pathlib

p = pathlib.Path(__file__).resolve().parent / "deck.template.html"
s = p.read_text(encoding="utf-8")


def rep(old, new, count=1):
    global s
    if old not in s:
        raise SystemExit("NOT FOUND: " + old[:70])
    s = s.replace(old, new, count)


rep(".grid3 .card{flex:1;min-height:105mm;", ".grid3 .card{flex:1;min-height:112mm;")
rep(".grid3 .ct{font-size:13.5pt;", ".grid3 .ct{font-size:15pt;")
rep(".grid3 .cb{font-size:12pt;line-height:1.55;", ".grid3 .cb{font-size:13pt;line-height:1.6;")
rep(".card .ico{width:11mm;height:11mm;", ".card .ico{width:15mm;height:15mm;")
rep("padding:3.6mm 6mm;font-size:12.5pt;", "padding:4.2mm 6mm;font-size:13.2pt;")
# p2 band -> fixed gap
rep('<div class="band" style="margin-top:auto">', '<div class="band" style="margin-top:8mm">')
# OneDrive window density
rep(".odrow{display:flex;align-items:center;gap:2.6mm;padding:2.5mm 4mm;font-size:9.6pt;",
    ".odrow{display:flex;align-items:center;gap:2.6mm;padding:3.9mm 4mm;font-size:10.4pt;")
rep(".odfoot{background:#F7FAFD;border-top:1px solid #E8EFF6;padding:2.4mm 4mm;font-size:8pt;",
    ".odfoot{background:#F7FAFD;border-top:1px solid #E8EFF6;padding:3mm 4mm;font-size:8.6pt;")
rep(".truthline{margin-top:auto;font-size:9.6pt;color:#4C5D53;background:#FBF7EA;border:1px solid #EFE3BF;border-radius:2mm;\n           padding:2.4mm 4mm;",
    ".truthline{margin-top:6mm;font-size:10.4pt;color:#4C5D53;background:#FBF7EA;border:1px solid #EFE3BF;border-radius:2mm;\n           padding:3.2mm 4.4mm;")
rep(".odside .cs{font-size:9.6pt;", ".odside .cs{font-size:10.2pt;")
# flow
rep(".node{flex:1;min-height:99mm;", ".node{flex:1;min-height:106mm;")
rep(".node .nm{font-size:13.5pt;", ".node .nm{font-size:14.5pt;")
rep(".node ul{list-style:none;font-size:10.2pt;", ".node ul{list-style:none;font-size:10.8pt;")
rep('<div class="band" style="margin-top:auto">', '<div class="band" style="margin-top:9mm">')
# page 5
rep('<div class="ba-notes">', '<div class="ba-notes" style="margin-top:5mm">')
rep(".ba-notes div{flex:1;background:var(--cream);border:1px solid #EAE4D4;border-radius:2mm;padding:2.6mm 3.6mm;font-size:9.8pt;",
    ".ba-notes div{flex:1;background:var(--cream);border:1px solid #EAE4D4;border-radius:2mm;padding:3.2mm 4mm;font-size:10.6pt;")
# page 6
rep('<div class="qrstrip" style="margin-top:auto">', '<div class="qrstrip" style="margin-top:5mm">')
rep(".step .t{font-size:12.4pt;", ".step .t{font-size:13.2pt;")
rep(".step .d{font-size:9.8pt;", ".step .d{font-size:10.4pt;")

p.write_text(s, encoding="utf-8")
print("ok")
