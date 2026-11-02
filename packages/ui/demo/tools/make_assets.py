#!/usr/bin/env python3
"""Builds the UI demo's assets (never hand-edited; rerun to reproduce):

  assets/font.png + font.json        atlas font baked from Barlow Semi Condensed Bold (OFL): fill in the red
                                     channel, a dilated outline in green, 4 atlas px per font px
  assets/pixelfont.png + .json       5x7 pixel font defined below (fill red, 1 px outline green), 1:1
  assets/gui.png + gui.json          pixel GUI sheet: nine-slice frames, keys, track, knob, arrow

Run: python3 packages/ui/demo/tools/make_assets.py
"""
import json
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets")

# ── Atlas font ──

CHARS = "".join(chr(c) for c in range(32, 127))


def atlas_font():
    S = 4  # atlas px per font px
    EM = 16  # em size in font px
    H = 20  # line box in font px
    PAD = 2  # outline room each side (font px)
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
    img_fill = Image.new("L", (cols * cw * S, rows * H * S), 0)
    d = ImageDraw.Draw(img_fill)
    for i, (ch, adv, left, w) in enumerate(cells):
        cx = (i % cols) * cw
        cy = (i // cols) * H
        ox = PAD - left
        d.text(((cx + ox) * S, cy * S + (base * S - asc)), ch, font=font, fill=255)
        glyphs[ch] = {"x": cx, "y": cy, "w": w, "adv": round(adv, 3), "ox": round(ox, 3)}
    # Outline: dilate the fill by ~1.4 font px, softened a little.
    outline = img_fill.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(1.2))
    outline = outline.point(lambda v: min(255, v * 2))
    out = Image.merge("RGBA", (img_fill, outline, Image.new("L", img_fill.size, 0), Image.new("L", img_fill.size, 255)))
    out.save(os.path.join(OUT, "font.png"), optimize=True)
    meta = {"px": EM, "h": H, "base": base, "scale": S, "track": 0.2, "glyphs": glyphs}
    with open(os.path.join(OUT, "font.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))


# ── Pixel font (5x7, upper case) ──

PIXEL = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["111", "010", "010", "010", "010", "010", "111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["010", "110", "010", "010", "010", "010", "111"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    ".": ["0", "0", "0", "0", "0", "0", "1"],
    ",": ["00", "00", "00", "00", "00", "01", "10"],
    ":": ["0", "1", "0", "0", "0", "1", "0"],
    ";": ["00", "01", "00", "00", "00", "01", "10"],
    "!": ["1", "1", "1", "1", "1", "0", "1"],
    "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
    "'": ["1", "1", "0", "0", "0", "0", "0"],
    '"': ["101", "101", "000", "000", "000", "000", "000"],
    "-": ["000", "000", "000", "111", "000", "000", "000"],
    "+": ["000", "010", "010", "111", "010", "010", "000"],
    "=": ["000", "000", "111", "000", "111", "000", "000"],
    "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
    "(": ["01", "10", "10", "10", "10", "10", "01"],
    ")": ["10", "01", "01", "01", "01", "01", "10"],
    "[": ["11", "10", "10", "10", "10", "10", "11"],
    "]": ["11", "01", "01", "01", "01", "01", "11"],
    "<": ["0001", "0010", "0100", "1000", "0100", "0010", "0001"],
    ">": ["1000", "0100", "0010", "0001", "0010", "0100", "1000"],
    "%": ["11001", "11001", "00010", "00100", "01000", "10011", "10011"],
    "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
    "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
    "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
    "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
    " ": ["000", "000", "000", "000", "000", "000", "000"],
}


def pixel_font():
    H = 10  # cell: 1 px outline above, 7 rows, room for outline + descender below
    TOP = 1
    glyphs = {}
    items = list(PIXEL.items())
    cols = 16
    cw = 8
    rows = (len(items) + cols - 1) // cols
    fill = Image.new("L", (cols * cw, rows * H), 0)
    px = fill.load()
    for i, (ch, rws) in enumerate(items):
        cx = (i % cols) * cw
        cy = (i // cols) * H
        gw = len(rws[0])
        for y, r in enumerate(rws):
            for x, v in enumerate(r):
                if v == "1":
                    px[cx + 1 + x, cy + TOP + y] = 255
        glyphs[ch] = {"x": cx, "y": cy, "w": gw + 2, "adv": gw + 1, "ox": 1}
    glyphs[" "]["adv"] = 3
    outline = fill.filter(ImageFilter.MaxFilter(3))
    out = Image.merge("RGBA", (fill, outline, Image.new("L", fill.size, 0), Image.new("L", fill.size, 255)))
    out.save(os.path.join(OUT, "pixelfont.png"), optimize=True)
    meta = {"px": 8, "h": H, "base": TOP + 7, "scale": 1, "caps": True, "pixel": True, "glyphs": glyphs}
    with open(os.path.join(OUT, "pixelfont.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))


# ── Pixel GUI sheet ──

INK = (20, 27, 27, 255)
CREAM = (248, 240, 208, 255)
BOX = (24, 32, 44, 255)
BOX_HI = (36, 48, 64, 255)
GOLD = (255, 216, 74, 255)
GOLD_DK = (176, 120, 32, 255)
TEAL = (70, 150, 140, 255)
TEAL_HI = (130, 210, 190, 255)
TEAL_DK = (30, 80, 80, 255)
RED = (190, 50, 60, 255)
RED_HI = (240, 110, 110, 255)
RED_DK = (110, 24, 36, 255)


def frame_box(edge, field, size=12, inner_hi=None):
    """Link's Awakening dialog box: dark rim, clipped corners, 1 px coloured border, dark field."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    p = im.load()
    n = size
    for y in range(n):
        for x in range(n):
            corner = (x + y < 2) or (n - 1 - x + y < 2) or (x + n - 1 - y < 2) or (2 * n - 2 - x - y < 2)
            if corner:
                continue
            p[x, y] = INK
    for i in range(3, n - 3):
        p[i, 1] = edge
        p[i, n - 2] = edge
        p[1, i] = edge
        p[n - 2, i] = edge
    for x, y in [(2, 2), (n - 3, 2), (2, n - 3), (n - 3, n - 3)]:
        p[x, y] = edge
    for y in range(3, n - 3):
        for x in range(3, n - 3):
            p[x, y] = field
    if inner_hi:
        for x in range(3, n - 3):
            p[x, 3] = inner_hi
    return im


def bevel(hi, mid, dk, field, size=16, b=5):
    """A bevelled window frame: ink outline, light top-left, dark bottom-right, coloured band, dark field."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    p = im.load()
    n = size
    for y in range(n):
        for x in range(n):
            if (x in (0, n - 1) and y in (0, n - 1)):
                continue
            edge = x == 0 or y == 0 or x == n - 1 or y == n - 1
            if edge:
                p[x, y] = INK
            elif x < b - 1 or y < b - 1 or x > n - b or y > n - b:
                ring = min(x, y, n - 1 - x, n - 1 - y)
                if ring == 1:
                    p[x, y] = hi if (x == 1 or y == 1) else dk
                elif ring == b - 2:
                    p[x, y] = dk if (x == b - 2 or y == b - 2) else hi
                else:
                    p[x, y] = mid
            elif x == b - 1 or y == b - 1 or x == n - b or y == n - b:
                p[x, y] = INK
            else:
                p[x, y] = field
    # Studs in the corners of the band.
    for cx, cy in [(2, 2), (n - 3, 2), (2, n - 3), (n - 3, n - 3)]:
        p[cx, cy] = CREAM
    return im


def pill(fill, hi, dk, size=10):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    p = im.load()
    n = size
    for y in range(n):
        for x in range(n):
            if (x in (0, n - 1) and y in (0, n - 1)):
                continue
            edge = x == 0 or y == 0 or x == n - 1 or y == n - 1
            p[x, y] = INK if edge else (hi if y == 1 else dk if y >= n - 3 else fill)
    return im


def ribbon(size=16):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    p = im.load()
    n = size
    for y in range(n):
        for x in range(n):
            if y == 0 or y == n - 1 or x == 0 or x == n - 1:
                p[x, y] = INK
            elif y == 1:
                p[x, y] = RED_HI
            elif y >= n - 3:
                p[x, y] = RED_DK
            elif y in (3, n - 5):
                p[x, y] = GOLD_DK if x % 2 else GOLD
            else:
                p[x, y] = RED
    return im


def arrow():
    rows = ["1100000", "1211000", "1222110", "1222221", "1222110", "1211000", "1100000"]
    im = Image.new("RGBA", (7, 7), (0, 0, 0, 0))
    p = im.load()
    for y, r in enumerate(rows):
        for x, v in enumerate(r):
            if v == "1":
                p[x, y] = INK
            elif v == "2":
                p[x, y] = GOLD if y <= 3 else GOLD_DK
    return im


def knob():
    rows = ["01110", "12221", "12221", "12221", "12331", "12331", "01110"]
    im = Image.new("RGBA", (5, 7), (0, 0, 0, 0))
    p = im.load()
    for y, r in enumerate(rows):
        for x, v in enumerate(r):
            if v == "1":
                p[x, y] = INK
            elif v == "2":
                p[x, y] = CREAM
            elif v == "3":
                p[x, y] = (180, 170, 140, 255)
    return im


def gui():
    parts = [
        ("box", frame_box(CREAM, BOX, inner_hi=BOX_HI), 5),
        ("box.sel", frame_box(GOLD, BOX, inner_hi=BOX_HI), 5),
        ("frame", bevel(TEAL_HI, TEAL, TEAL_DK, BOX), 6),
        ("row", frame_box((86, 96, 92, 255), BOX, size=10), 4),
        ("row.sel", frame_box(GOLD, (44, 52, 40, 255), size=10, inner_hi=(70, 76, 50, 255)), 4),
        ("inset", frame_box((10, 14, 18, 255), (12, 16, 22, 255), size=8), 3),
        ("field", frame_box((86, 96, 92, 255), (12, 16, 22, 255), size=10), 4),
        ("button", pill((60, 72, 84, 255), (100, 116, 128, 255), (36, 44, 52, 255)), 3),
        ("button.sel", pill((210, 160, 40, 255), GOLD, GOLD_DK), 3),
        ("key", frame_box((70, 80, 80, 255), BOX, size=8), 3),
        ("key.sel", frame_box(GOLD, (52, 56, 40, 255), size=8), 3),
        ("track", frame_box((10, 14, 18, 255), (10, 14, 18, 255), size=8), 3),
        ("banner", ribbon(), 5),
    ]
    sprites = [("arrow", arrow()), ("knob", knob())]
    W = 128
    sheet = Image.new("RGBA", (W, 64), (0, 0, 0, 0))
    entries = {}
    x = y = 0
    rowh = 0
    for name, im, border in parts + [(n, im, None) for n, im in sprites]:
        if x + im.width > W:
            x = 0
            y += rowh + 1
            rowh = 0
        sheet.paste(im, (x, y))
        e = {"rect": [x, y, im.width, im.height]}
        if border is not None:
            e["border"] = border
        entries[name] = e
        x += im.width + 1
        rowh = max(rowh, im.height)
    sheet = sheet.crop((0, 0, W, y + rowh))
    sheet.save(os.path.join(OUT, "gui.png"), optimize=True)
    with open(os.path.join(OUT, "gui.json"), "w") as f:
        json.dump({"entries": entries}, f, indent=1)


if __name__ == "__main__":
    atlas_font()
    pixel_font()
    gui()
    print("wrote", sorted(f for f in os.listdir(OUT) if not os.path.isdir(os.path.join(OUT, f))))
