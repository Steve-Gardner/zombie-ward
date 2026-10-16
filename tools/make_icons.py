#!/usr/bin/env python3
"""Draws the app icons (icons/icon-192.png, icon-512.png, icon-maskable-512.png) with no extra libraries."""
import math, pathlib, struct, zlib
OUT = pathlib.Path(__file__).resolve().parent.parent / "icons"; OUT.mkdir(exist_ok=True)

def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay; t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def smooth(d, w, aa=1.2):           # 1 inside the stroke, 0 outside, soft edge
    return max(0.0, min(1.0, (w / 2 + aa - d) / (2 * aa)))

def render(size, maskable):
    s = size / 512.0; k = 0.74 if maskable else 1.0; sc = s * k
    W_PTS = [(-90, -78), (90, -78), (-90, 78), (90, 78)]
    ticks = [((-228, 0), (-150, 0)), ((150, 0), (228, 0)), ((0, -228), (0, -150)), ((0, 150), (0, 228))]
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            # background gradient
            t = (x + y) / (2.0 * size)
            r, g, b = 16 + 20 * t, 22 + 4 * t, 30 - 18 * t
            a = 1.0
            if not maskable:                                    # rounded corners
                rad = 96 * s; cx = min(max(x, rad), size - rad); cy = min(max(y, rad), size - rad)
                a = max(0.0, min(1.0, rad - math.hypot(x - cx, y - cy) + 0.5))
            u, v = (x - size / 2) / sc, (y - size / 2) / sc    # icon space (512 units, centred)
            d = math.hypot(u, v)
            ring_d = abs(d - 178)
            glow = math.exp(-(ring_d / 38.0) ** 2) * 0.35 + math.exp(-(d / 150.0) ** 2) * 0.10
            r, g, b = r + (60 - r) * glow, g + (255 - g) * glow, b + (90 - b) * glow
            c = smooth(ring_d * sc, 16 * sc)
            for (ax, ay), (bx, by) in ticks: c = max(c, smooth(seg_dist(u, v, ax, ay, bx, by) * sc, 16 * sc))
            if c > 0: r, g, b = r + (120 - r) * c, g + (255 - g) * c, b + (90 - b) * c
            wd = min(seg_dist(u, v, *W_PTS[i], *W_PTS[i + 1]) for i in range(3))
            wglow = math.exp(-(wd / 26.0) ** 2) * 0.55
            r, g, b = r + (255 - r) * wglow * 0.8, g + (176 - g) * wglow * 0.8, b + (32 - b) * wglow * 0.8
            wc = smooth(wd * sc, 30 * sc)
            if wc > 0: r, g, b = r + (255 - r) * wc, g + (255 - g) * wc, b + (255 - b) * wc
            row += bytes((int(min(255, r)), int(min(255, g)), int(min(255, b)), int(255 * a)))
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(tag, data): return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

for name, size, mask in [("icon-512.png", 512, False), ("icon-192.png", 192, False), ("icon-maskable-512.png", 512, True)]:
    (OUT / name).write_bytes(render(size, mask)); print("wrote", name)
