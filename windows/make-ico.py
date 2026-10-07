"""Packs PNG files into windows/HandoffBar.ico (PNG-compressed entries, Windows Vista and later).

Run on a Mac from the repo root:
  swift tools/make-icon.swift
  for s in 16 24 32 48 64 256; do sips -z $s $s AppIcon.iconset/icon_512x512@2x.png --out /tmp/ico-$s.png; done
  python3 windows/make-ico.py /tmp/ico-{16,24,32,48,64,256}.png
"""
import struct
import sys

pngs = [open(p, "rb").read() for p in sys.argv[1:]]
# ICONDIR header, then one 16-byte ICONDIRENTRY per image, then the image data.
out = struct.pack("<HHH", 0, 1, len(pngs))
offset = 6 + 16 * len(pngs)
entries, data = b"", b""
for png in pngs:
    w, h = struct.unpack(">II", png[16:24])
    # 256 is stored as 0 in the one-byte size fields.
    entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(png), offset)
    data += png
    offset += len(png)
open("windows/HandoffBar.ico", "wb").write(out + entries + data)
print("windows/HandoffBar.ico", len(pngs), "images")
