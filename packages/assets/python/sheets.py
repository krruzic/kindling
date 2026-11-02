#!/usr/bin/env python3
"""Sheet slicing and contact sheets (from Grudge's tools/campaign-icons-cut.py and slice-talent-sheets.py).

A generated sheet holds N images in reading order on a flat chroma background (magenta #FF00FF by default; any flat
colour works). slice finds rows then columns from the background gaps (projection profiles, merging the weakest
segments until the counts match), falls back to an equal grid when the gaps don't add up, then per cell: keys the
background out with a soft edge, removes the background's colour spill from the fringe (despill), trims to the
content, pads to a square, resizes to the icon size with premultiplied alpha (no dark halos) and optionally
quantises colours / hardens alpha for a crisp retro look. It can also composite each icon on a consistent
frame/stone tile. contact draws labelled thumbnails of many images on tiles in a grid.

  python3 sheets.py slice --sheet s.png --meta s.json --out icons/ [--size 96] [--bg auto|#ff00ff]
                          [--mode auto|gaps|grid] [--quantize 5] [--alpha soft|hard] [--tile #968a6e|tile.png]
                          [--raw]
  python3 sheets.py contact --out sheet.png [--per 8] [--cell 112] [--tile #968a6e] [--title T] files...

meta.json: {"cols": 4, "rows": 2, "ids": [...]} (ids in reading order). Prints a JSON summary on stdout.
Needs numpy and Pillow.
"""

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont


# ------------------------------------------------------------------------------------------------- background / key


def parse_color(s):
    s = s.lstrip("#")
    return np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


def border_bg(a):
    """Median colour of the image border (the flat background)."""
    edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    return np.median(edge, 0).astype(np.float32)


def bg_mask(a, bg, tol=60.0):
    """True where a pixel is background (within `tol` of the background colour)."""
    return np.sqrt(((a.astype(np.float32) - bg) ** 2).sum(-1)) < tol


def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx or dy:
                out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def key(cell, bg, lo=45.0, hi=105.0, band=3):
    """Soft alpha from the distance to the background colour, and the colour with background spill removed.

    In a band `band` px wide along the background, a pixel is unmixed as alpha * F + (1 - alpha) * bg, where the
    background share is read from the chroma spill (how far the background's strong channels exceed its weak ones,
    relative to the background's own): a dark outline anti-aliased into magenta becomes a dark, partly transparent
    pixel instead of an opaque purple one. Inside the band nothing changes, so purple artwork stays purple.
    """
    a = cell.astype(np.float32)
    dist = np.sqrt(((a - bg) ** 2).sum(-1))
    alpha = np.clip((dist - lo) / (hi - lo), 0, 1)
    high = [c for c in range(3) if bg[c] > 128]
    low = [c for c in range(3) if bg[c] <= 128]
    if high and low:
        spill = np.clip(np.min(a[..., high], -1) - np.max(a[..., low], -1), 0, None)
        bg_spill = max(1.0, float(min(bg[c] for c in high) - max(bg[c] for c in low)))
        edge = dilate(dist < lo, band) & (dist >= lo)
        k = np.where(edge, np.clip(spill / bg_spill, 0, 0.98), 0.0)
        alpha = np.minimum(alpha, 1 - k)
        a = np.where(edge[..., None], (a - k[..., None] * bg) / (1 - k[..., None]), a)
        # Whatever spill is left on soft pixels.
        rest = np.clip(np.min(a[..., high], -1) - np.max(a[..., low], -1), 0, None) * (1 - alpha) ** 0.5
        for c in high:
            a[..., c] -= rest * 0.8
    return np.clip(a, 0, 255), alpha


# ---------------------------------------------------------------------------------------------------- cell finding


def segments(proj, min_gap):
    segs, start, gap, end = [], None, 0, 0
    for i, v in enumerate(proj > 0):
        if v:
            if start is None:
                start = i
            gap, end = 0, i
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                segs.append([start, end + 1])
                start = None
    if start is not None:
        segs.append([start, end + 1])
    return segs


def fit(segs, n, proj):
    """Merges the weakest segments into their nearest neighbour until there are at most n."""
    segs = [s for s in segs if proj[s[0]:s[1]].sum() > 0]
    while len(segs) > n:
        gaps = [segs[i + 1][0] - segs[i][1] for i in range(len(segs) - 1)]
        weights = [proj[s[0]:s[1]].sum() for s in segs]
        k = min(range(len(segs)), key=lambda i: weights[i])
        j = k - 1 if k == len(segs) - 1 or (k > 0 and gaps[k - 1] < gaps[k]) else k
        segs[j] = [segs[j][0], segs[j + 1][1]]
        del segs[j + 1]
    return segs


def find_cells(fg, cols, rows, count):
    """Content boxes (x0, y0, x1, y1) in reading order from background gaps, or None when they don't add up."""
    H, W = fg.shape
    rproj = fg.sum(1).astype(float)
    rproj[rproj < W * 0.01] = 0
    rsegs = fit(segments(rproj, max(4, H // 150)), rows, rproj)
    if len(rsegs) != rows:
        return None
    boxes = []
    left = count
    for y0, y1 in rsegs:
        need = min(cols, left)
        band = fg[y0:y1]
        cproj = band.sum(0).astype(float)
        cproj[cproj < (y1 - y0) * 0.02] = 0
        csegs = fit(segments(cproj, max(6, W // 120)), need, cproj)
        if len(csegs) != need:
            return None
        for x0, x1 in csegs:
            ys = np.where(band[:, x0:x1].any(1))[0]
            boxes.append((int(x0), int(y0 + ys.min()), int(x1), int(y0 + ys.max() + 1)))
        left -= need
    return boxes


def grid_cells(W, H, cols, rows, count):
    out = [(c * W // cols, r * H // rows, (c + 1) * W // cols, (r + 1) * H // rows) for r in range(rows) for c in range(cols)]
    return out[:count]


# ------------------------------------------------------------------------------------------------------------ output


def tile_image(size, tile):
    """A consistent frame tile: an image file scaled to size, or a flat stone-ish square with a dark border."""
    if tile and os.path.exists(tile):
        return Image.open(tile).convert("RGBA").resize((size, size), Image.LANCZOS)
    col = tuple(int(v) for v in parse_color(tile or "#968a6e"))
    t = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(t)
    w = max(2, size // 32)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 10, fill=col + (255,), outline=(11, 8, 6, 255), width=w)
    hi = tuple(min(255, int(c * 1.18)) for c in col) + (255,)
    d.rounded_rectangle([w * 2, w * 2, size - 1 - w * 2, size - 1 - w * 2], radius=size // 12, outline=hi, width=1)
    return t


def finish(rgb, alpha, size, pad=3, quantize=0, hard=False):
    """Trims to content, pads square, premultiplied resize to `size`, optional quantise / hard alpha. -> RGBA."""
    H, W = alpha.shape
    ys, xs = np.where(alpha > 0.5)
    if not len(ys):
        return Image.new("RGBA", (size, size), (0, 0, 0, 0)), False
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + pad + 1)
    side = max(y1 - y0, x1 - x0)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.float32)
    canvas = np.zeros((side, side, 4), np.float32)
    oy, ox = (side - (y1 - y0)) // 2, (side - (x1 - x0)) // 2
    canvas[oy:oy + y1 - y0, ox:ox + x1 - x0] = rgba[y0:y1, x0:x1]
    canvas[..., :3] *= canvas[..., 3:4] / 255
    small = np.asarray(Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), "RGBA").resize((size, size), Image.LANCZOS)).astype(np.float32)
    al = small[..., 3:4]
    small[..., :3] = np.where(al > 0, small[..., :3] * 255 / np.maximum(al, 1), 0)
    rgb_out = np.clip(small[..., :3], 0, 255).astype(np.int32)
    if quantize:
        shift = 8 - quantize
        rgb_out = (rgb_out >> shift) << shift
    a_out = np.where(small[..., 3] > 100, 255, 0) if hard else small[..., 3]
    return Image.fromarray(np.dstack([rgb_out, a_out]).astype(np.uint8), "RGBA"), True


def slice_sheet(sheet, ids, cols, rows, out, size=96, bg="auto", mode="auto", pad=3, quantize=0, hard=False,
                tile=None, raw=False, tol=60.0):
    os.makedirs(out, exist_ok=True)
    a = np.asarray(Image.open(sheet).convert("RGB")).astype(np.int32)
    H, W = a.shape[:2]
    bgc = border_bg(a) if bg == "auto" else parse_color(bg)
    fg = ~bg_mask(a, bgc, tol)
    # Rows / columns that are almost all "foreground" are borders or grid lines the model drew anyway.
    fg[fg.mean(1) > 0.85, :] = False
    fg[:, fg.mean(0) > 0.85] = False
    boxes = None
    how = "grid"
    if mode in ("auto", "gaps"):
        boxes = find_cells(fg, cols, rows, len(ids))
        if boxes is not None:
            how = "gaps"
        elif mode == "gaps":
            raise SystemExit(f"{sheet}: gaps did not give {rows} rows x {cols} cols")
    if boxes is None:
        boxes = grid_cells(W, H, cols, rows, len(ids))
    cells = []
    for name, (x0, y0, x1, y1) in zip(ids, boxes):
        p = 8
        bx0, by0, bx1, by1 = max(0, x0 - p), max(0, y0 - p), min(W, x1 + p), min(H, y1 + p)
        cell = a[by0:by1, bx0:bx1].astype(np.uint8)
        side = max(cell.shape[:2])
        sq = np.zeros((side, side, 3), np.uint8)
        sq[...] = bgc.astype(np.uint8)
        oy, ox = (side - cell.shape[0]) // 2, (side - cell.shape[1]) // 2
        sq[oy:oy + cell.shape[0], ox:ox + cell.shape[1]] = cell
        if raw:
            Image.fromarray(sq).save(os.path.join(out, f"{name}_raw.png"))
        rgb, alpha = key(sq, bgc)
        img, has = finish(rgb, alpha, size, pad, quantize, hard)
        img.save(os.path.join(out, f"{name}.png"))
        if tile:
            t = tile_image(size, tile)
            inset = max(2, size // 12)
            icon = img.resize((size - inset * 2, size - inset * 2), Image.LANCZOS)
            t.alpha_composite(icon, (inset, inset))
            t.save(os.path.join(out, f"{name}_tile.png"))
        cells.append({"id": name, "box": [int(x0), int(y0), int(x1), int(y1)], "empty": not has})
    return {"sheet": sheet, "how": how, "bg": [int(v) for v in bgc], "cells": cells}


# ----------------------------------------------------------------------------------------------------------- contact


def load_font(px):
    for f in ("/usr/share/fonts/TTF/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/dejavu/DejaVuSans.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, px)
    return ImageFont.load_default()


def contact(files, out, per=8, cell=112, tile="#968a6e", labels=None, title=None, bg=(44, 36, 34)):
    """Every image fitted into a tile in a grid, its label (file stem) centred under it."""
    labels = labels or [os.path.splitext(os.path.basename(f))[0] for f in files]
    per = max(1, min(per, len(files)))
    rows = (len(files) + per - 1) // per
    fpx = max(10, min(16, cell // 8))
    font = load_font(fpx)
    head = fpx * 2 if title else 0
    lab = fpx + 8
    inner = cell - 14
    # Cells take the tallest image's aspect (screenshots are wide, icons square).
    aspects = []
    for f in files:
        if os.path.exists(f):
            with Image.open(f) as im:
                aspects.append(im.height / im.width)
    aspect = min(1.5, max(0.3, max(aspects) if aspects else 1.0))
    inner_h = int(inner * aspect)
    ch = inner_h + 14
    cs = Image.new("RGB", (per * cell + 8, rows * (ch + lab) + 8 + head), bg)
    d = ImageDraw.Draw(cs)
    if title:
        d.text((8, 4), title, fill=(240, 228, 200), font=load_font(fpx + 4))
    for k, (f, name) in enumerate(zip(files, labels)):
        x, y = 4 + (k % per) * cell, 4 + head + (k // per) * (ch + lab)
        t = tile_image(inner + 2, tile).resize((inner + 2, inner_h + 2)) if tile and tile != "none" else None
        if t:
            cs.paste(t, (x + 6, y + 4), t)
        if os.path.exists(f):
            im = Image.open(f).convert("RGBA")
            im.thumbnail((inner - 4, inner_h - 4), Image.LANCZOS)
            cs.paste(im, (x + 7 + (inner - im.width) // 2, y + 5 + (inner_h - im.height) // 2), im)
        w = d.textlength(name, font=font)
        while w > cell - 4 and len(name) > 3:
            name = name[:-2] + "…"
            w = d.textlength(name, font=font)
        d.text((x + cell / 2 - w / 2, y + inner_h + 8), name, fill=(240, 228, 200), font=font)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    cs.save(out)
    return {"out": out, "count": len(files), "size": [cs.width, cs.height]}


def main(argv):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("slice")
    s.add_argument("--sheet", required=True)
    s.add_argument("--meta")
    s.add_argument("--ids")
    s.add_argument("--cols", type=int)
    s.add_argument("--rows", type=int)
    s.add_argument("--out", required=True)
    s.add_argument("--size", type=int, default=96)
    s.add_argument("--bg", default="auto")
    s.add_argument("--mode", default="auto", choices=["auto", "gaps", "grid"])
    s.add_argument("--pad", type=int, default=3)
    s.add_argument("--quantize", type=int, default=0)
    s.add_argument("--alpha", default="soft", choices=["soft", "hard"])
    s.add_argument("--tile")
    s.add_argument("--raw", action="store_true")
    s.add_argument("--tol", type=float, default=60.0)
    c = sub.add_parser("contact")
    c.add_argument("--out", required=True)
    c.add_argument("--per", type=int, default=8)
    c.add_argument("--cell", type=int, default=112)
    c.add_argument("--tile", default="#968a6e")
    c.add_argument("--title")
    c.add_argument("files", nargs="+")
    a = ap.parse_args(argv)
    if a.cmd == "slice":
        meta = json.load(open(a.meta)) if a.meta else {}
        ids = a.ids.split(",") if a.ids else meta["ids"]
        cols = a.cols or meta.get("cols", 4)
        rows = a.rows or meta.get("rows", (len(ids) + cols - 1) // cols)
        r = slice_sheet(a.sheet, ids, cols, rows, a.out, a.size, a.bg, a.mode, a.pad, a.quantize, a.alpha == "hard",
                        a.tile, a.raw, a.tol)
    else:
        r = contact(a.files, a.out, a.per, a.cell, a.tile, title=a.title)
    print(json.dumps(r))


if __name__ == "__main__":
    main(sys.argv[1:])
