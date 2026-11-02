"""Writes a synthetic generated-sheet stand-in: 8 shapes in a jittered 4x2 grid on flat magenta, drawn at 4x and
downsampled so the edges blend into the background (the fringe the keyer must clean). Usage: synth_sheet.py out.png"""
import sys
from PIL import Image, ImageDraw

S = 4
W, H = 800, 400
COLORS = [(40, 200, 60), (230, 200, 40), (40, 90, 230), (240, 240, 240), (200, 40, 40), (30, 30, 30), (40, 200, 200), (240, 130, 30)]
img = Image.new("RGB", (W * S, H * S), (255, 0, 255))
d = ImageDraw.Draw(img)
for k, col in enumerate(COLORS):
    c, r = k % 4, k // 4
    cx = (c * 200 + 100 + (k * 13 % 21) - 10) * S
    cy = (r * 200 + 100 + (k * 7 % 15) - 7) * S
    s = (50 + (k * 11 % 25)) * S
    if k % 3 == 0:
        d.ellipse([cx - s, cy - s, cx + s, cy + s], fill=col, outline=(10, 8, 6), width=4 * S)
    elif k % 3 == 1:
        d.polygon([(cx, cy - s), (cx + s, cy + s), (cx - s, cy + s)], fill=col, outline=(10, 8, 6))
    else:
        d.rectangle([cx - s, cy - s * 0.7, cx + s, cy + s * 0.7], fill=col, outline=(10, 8, 6), width=4 * S)
img.resize((W, H), Image.LANCZOS).save(sys.argv[1])
