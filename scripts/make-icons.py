# Draws the HeaderDial icon (a dial with a pointer over two header lines) at each size.
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]
for size in (16, 32, 48, 128):
    s = 8  # supersample
    W = size * s
    im = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad = W * 0.04
    d.rounded_rectangle([pad, pad, W - pad, W - pad], radius=W * 0.22, fill=(37, 99, 235, 255))
    # two header lines on the left
    lw = W * 0.09
    for i, y in enumerate((0.36, 0.64)):
        d.rounded_rectangle([W * 0.17, W * y - lw / 2, W * 0.47, W * y + lw / 2], radius=lw / 2, fill=(255, 255, 255, 255))
    # dial on the right
    cx, cy, r = W * 0.67, W * 0.5, W * 0.2
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
    pr = r * 0.32
    d.line([cx, cy, cx + r * 0.55, cy - r * 0.55], fill=(37, 99, 235, 255), width=int(W * 0.07))
    d.ellipse([cx - pr * 0.5, cy - pr * 0.5, cx + pr * 0.5, cy + pr * 0.5], fill=(37, 99, 235, 255))
    im.resize((size, size), Image.LANCZOS).save(f'{out}/{size}.png')
