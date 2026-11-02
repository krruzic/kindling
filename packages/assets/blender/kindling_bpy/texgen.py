"""Procedural low-res textures (from Grudge's tools/blender/texgen.py). Pure Python (numpy only for the optional
palette reduction), so generators run inside Blender or plain CPython and are tileable and seeded: the same seed
always gives the same pixels. A Canvas is a grid of RGBA floats (row 0 = top); to_image() turns it into a packed
Blender image (and optionally a PNG).

Generators: noise_ramp (fbm through colour stops: grass, dirt, sand...), bricks, planks, cobbles (voronoi).
retro() is Grudge's N64 look: downsample to <= 64 px, 16-colour palette (k-means), 5 bits per channel, 1-bit alpha.
"""

import math
import os
import random


def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(lerp(a, b, t) for a, b in zip(c1, c2))


def clamp01(v):
    return 0.0 if v < 0 else 1.0 if v > 1 else v


class Noise:
    """Tileable value noise on a `period` lattice."""

    def __init__(self, seed, period=8):
        r = random.Random(seed)
        self.p = period
        self.v = [[r.random() for _ in range(period)] for _ in range(period)]

    def at(self, x, y):
        p = self.p
        x0, y0 = math.floor(x), math.floor(y)
        fx, fy = x - x0, y - y0
        fx = fx * fx * (3 - 2 * fx)
        fy = fy * fy * (3 - 2 * fy)
        a = self.v[y0 % p][x0 % p]
        b = self.v[y0 % p][(x0 + 1) % p]
        c = self.v[(y0 + 1) % p][x0 % p]
        d = self.v[(y0 + 1) % p][(x0 + 1) % p]
        return lerp(lerp(a, b, fx), lerp(c, d, fx), fy)


_cache = {}


def _noise(seed, per):
    if (seed, per) not in _cache:
        _cache[(seed, per)] = Noise(seed, per)
    return _cache[(seed, per)]


def fbm(seed, u, v, base=4, octaves=3):
    """Fractal value noise in 0..1, tileable over u, v in 0..1."""
    total, amp, norm = 0.0, 0.5, 0.0
    for o in range(octaves):
        per = base * (2 ** o)
        total += _noise(seed + o, per).at(u * per, v * per) * amp
        norm += amp
        amp *= 0.5
    return total / norm


class Canvas:
    def __init__(self, size=64, bg=(0, 0, 0), alpha=1.0):
        self.s = size
        self.px = [[(bg[0], bg[1], bg[2], alpha) for _ in range(size)] for _ in range(size)]

    def set(self, x, y, c, a=1.0):
        if len(c) == 4:
            a = c[3]
        self.px[y % self.s][x % self.s] = (c[0], c[1], c[2], a)

    def get(self, x, y):
        return self.px[y % self.s][x % self.s]

    def blend(self, x, y, c, t):
        o = self.get(x, y)
        self.set(x, y, mix(o[:3], c, t), o[3])

    def flat(self):
        """RGBA floats, bottom row first (Blender's pixel order)."""
        out = []
        for row in reversed(self.px):
            for p in row:
                out.extend(p)
        return out


def palette_ramp(stops, t):
    t = clamp01(t)
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t <= t1:
            return mix(c0, c1, (t - t0) / max(1e-6, t1 - t0))
    return stops[-1][1]


def noise_ramp(stops, seed=1, size=64, base=4, octaves=3, specks=0, speck_colors=()):
    """fbm noise mapped through colour stops [(t, "#hex")...], plus optional random specks."""
    st = [(t, hexc(c) if isinstance(c, str) else c) for t, c in stops]
    cv = Canvas(size)
    for y in range(size):
        for x in range(size):
            cv.set(x, y, palette_ramp(st, fbm(seed, x / size, y / size, base, octaves)))
    r = random.Random(seed)
    for _ in range(specks):
        col = hexc(r.choice(speck_colors)) if speck_colors else (1, 1, 1)
        cv.blend(r.randrange(size), r.randrange(size), col, 0.6)
    return cv


def bricks(seed=5, size=64, rows=8, brick_w=16, tint="#a49680", mortar="#3a342a"):
    cv = Canvas(size)
    r = random.Random(seed)
    rh = size // rows
    base = hexc(tint)
    for row in range(rows):
        off = 0 if row % 2 == 0 else brick_w // 2
        for bx in range(-1, size // brick_w + 1):
            shade = 0.82 + r.random() * 0.3
            col_b = tuple(clamp01(c * shade) for c in mix(base, hexc("#8a7c64"), r.random() * 0.5))
            for yy in range(rh):
                for xx in range(brick_w):
                    x, y = bx * brick_w + off + xx, row * rh + yy
                    if yy == 0 or xx == 0:
                        cv.set(x, y, hexc(mortar))
                        continue
                    c = mix(col_b, hexc("#5e5444"), fbm(seed + 3, x / size, y / size, 8, 2) * 0.4)
                    if yy == rh - 1:
                        c = mix(c, hexc("#e0d4b8"), 0.35)
                    cv.set(x, y, c)
    return cv


def planks(seed=6, size=64, plank=16, light="#a8703c", dark="#7a4a24"):
    cv = Canvas(size)
    r = random.Random(seed)
    for px in range(size // plank):
        tone = mix(hexc(dark), hexc(light), r.random())
        for y in range(size):
            for xx in range(plank):
                x = px * plank + xx
                grain = math.sin(xx * 0.9 + fbm(seed + px, x / size, y / size, 2, 2) * 8) * 0.5 + 0.5
                c = mix(tone, hexc("#5a3418"), grain * 0.35)
                if xx == 0:
                    c = hexc("#2c1a0c")
                elif xx == 1:
                    c = mix(c, hexc("#c8905a"), 0.4)
                cv.set(x, y, c)
    return cv


def cobbles(seed=3, size=64, cells=14, dark="#8d8577", light="#b5ab96", gap="#3f3a30"):
    cv = Canvas(size)
    r = random.Random(seed)
    pts = [(r.random(), r.random(), r.random()) for _ in range(cells)]
    for y in range(size):
        for x in range(size):
            u, v = x / size, y / size
            d1 = d2 = 9.0
            best = pts[0]
            for (px, py, pv) in pts:
                for ox in (-1, 0, 1):
                    for oy in (-1, 0, 1):
                        d = (u - px - ox) ** 2 + (v - py - oy) ** 2
                        if d < d1:
                            d2, d1, best = d1, d, (px + ox, py + oy, pv)
                        elif d < d2:
                            d2 = d
            edge = math.sqrt(d2) - math.sqrt(d1)
            col = mix(mix(hexc(dark), hexc(light), best[2]), hexc("#6d6558"), fbm(seed + 9, u, v, 8, 2) * 0.35)
            col = mix(col, hexc("#d8d0bc"), clamp01((u - best[0]) * -0.6 + (v - best[1]) * -0.6) * 0.8)
            if edge < 0.035:
                col = hexc(gap)
            elif edge < 0.06:
                col = mix(col, hexc(gap), 0.55)
            cv.set(x, y, col)
    return cv


def retro(flat, size, colors=16, max_size=64, soften=True):
    """N64-style reduction of flat RGBA (bottom-up) -> (numpy array n x n x 4, n)."""
    import numpy as np

    a = np.asarray(flat, dtype=np.float32).reshape(size, size, 4)
    f = max(1, size // max_size)
    n = size // f
    a = a[: n * f, : n * f].reshape(n, f, n, f, 4).mean((1, 3))
    if soften:
        rgb0 = a[..., :3]
        acc = np.zeros_like(rgb0)
        for dy, dx, w in ((0, 0, 0.36), (1, 0, 0.12), (-1, 0, 0.12), (0, 1, 0.12), (0, -1, 0.12), (1, 1, 0.04),
                          (-1, -1, 0.04), (1, -1, 0.04), (-1, 1, 0.04)):
            acc += np.roll(np.roll(rgb0, dy, 0), dx, 1) * w
        m = acc.reshape(-1, 3).mean(0)
        a[..., :3] = m + (acc - m) * 0.85
    rgb = a[..., :3].reshape(-1, 3)
    alpha = (a[..., 3:] > 0.5).astype(np.float32)
    opaque = alpha.reshape(-1) > 0.5
    src = rgb[opaque] if opaque.any() else rgb
    k = min(colors, len(src))
    lum = src @ np.array([0.3, 0.59, 0.11], np.float32)
    centers = src[np.argsort(lum)[np.linspace(0, len(src) - 1, k).astype(int)]].copy()
    for _ in range(12):
        lab = ((src[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1)
        for i in range(k):
            m = lab == i
            if m.any():
                centers[i] = src[m].mean(0)
    centers = np.round(np.clip(centers, 0, 1) * 31) / 31
    rgb = centers[((rgb[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1)].reshape(n, n, 3)
    return np.concatenate([rgb, alpha], -1), n


def to_image(name, canvas, out_dir=None, retro_look=False):
    """A packed Blender image from a Canvas (optionally also saved as <out_dir>/<name>.png)."""
    import bpy

    if retro_look:
        px, size = retro(canvas.flat(), canvas.s)
        px = px.ravel().tolist()
    else:
        px, size = canvas.flat(), canvas.s
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=True)
    img.pixels.foreach_set(px)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        img.filepath_raw = os.path.join(out_dir, name + ".png")
        img.file_format = "PNG"
        img.save()
    img.pack()
    return img
