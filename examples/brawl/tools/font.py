#!/usr/bin/env python3
"""Bakes BRAWL's atlas font (assets/ui/font.png + font.json) from Barlow Semi Condensed Bold (OFL), with the
middle dot, multiplication sign and arrows the UI uses on top of printable ASCII. Same layout as the @kindling/ui
demo's atlas (fill in red, dilated outline in green, 4 atlas px per font px). Never hand-edited; rerun:

    python3 tools/font.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(HERE, "..", "assets", "ui")
CHARS = "".join(chr(c) for c in range(32, 127)) + "\u00b7\u00d7\u2190\u2192\u2191\u2193\u2026"


def main():
    S, EM, H, PAD = 4, 16, 20, 2
    font = ImageFont.truetype(os.path.join(OUT, "fonts", "BarlowSemiCondensed-Bold.ttf"), EM * S)
    asc, desc = font.getmetrics()
    base = round((H * S - (asc + desc)) / 2 + asc) / S
    cols = 16
    glyphs = {}
    cells = []
    for ch in CHARS:
        adv = font.getlength(ch) / S
        l, t, r, b = font.getbbox(ch)
        left = min(0, l) / S
        w = int(max(adv, r / S) - left + PAD * 2 + 1)
        cells.append((ch, adv, left, w))
    cw = max(c[3] for c in cells)
    rows = (len(cells) + cols - 1) // cols
    fill = Image.new("L", (cols * cw * S, rows * H * S), 0)
    d = ImageDraw.Draw(fill)
    for i, (ch, adv, left, w) in enumerate(cells):
        cx = (i % cols) * cw
        cy = (i // cols) * H
        ox = PAD - left
        d.text(((cx + ox) * S, cy * S + (base * S - asc)), ch, font=font, fill=255)
        glyphs[ch] = {"x": cx, "y": cy, "w": w, "adv": round(adv, 3), "ox": round(ox, 3)}
    outline = fill.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(1.2)).point(lambda v: min(255, v * 2))
    zero = Image.new("L", fill.size, 0)
    Image.merge("RGBA", (fill, outline, zero, Image.new("L", fill.size, 255))).save(os.path.join(OUT, "font.png"), optimize=True)
    with open(os.path.join(OUT, "font.json"), "w") as f:
        json.dump({"px": EM, "h": H, "base": base, "scale": S, "track": 0.2, "glyphs": glyphs}, f, separators=(",", ":"))
    print(f"wrote {OUT}/font.png ({len(CHARS)} glyphs)")


main()
