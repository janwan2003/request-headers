#!/usr/bin/env python3
# Store promo tiles (440x280 and 1400x560). Usage: python3 scripts/make-promo.py <repo root>
import sys
from PIL import Image, ImageDraw, ImageFont
root = sys.argv[1]
B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"; R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
M = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
def tile(w, h, out, scale):
    im = Image.new("RGB", (w, h), "#111827"); d = ImageDraw.Draw(im)
    icon = Image.open(f"{root}/extension/icons/128.png").convert("RGBA")
    s = int(96 * scale); icon = icon.resize((s, s), Image.LANCZOS)
    x0 = int(32 * scale); im.paste(icon, (x0, int(36 * scale)), icon)
    d.text((x0 + s + int(20*scale), int(48*scale)), "HeaderDial", font=ImageFont.truetype(B, int(40*scale)), fill="#ffffff")
    d.text((x0 + s + int(22*scale), int(100*scale)), "Modify HTTP headers", font=ImageFont.truetype(R, int(19*scale)), fill="#93c5fd")
    mono = ImageFont.truetype(M, int(15*scale)); y = int(158*scale)
    for line, col in (("+ Authorization: Bearer …", "#86efac"), ("+ X-Forwarded-For: 203.0.113.7", "#86efac"), ("− Cookie", "#fca5a5")):
        d.text((x0, y), line, font=mono, fill=col); y += int(24*scale)
    d.text((x0, h - int(30*scale)), "Open source · no account · no tracking", font=ImageFont.truetype(R, int(13*scale)), fill="#9ca3af")
    im.save(out)
tile(440, 280, f"{root}/store/promo-small-440x280.png", 1)
tile(1400, 560, f"{root}/store/promo-marquee-1400x560.png", 2)
