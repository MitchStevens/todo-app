"""Render the PNG app icons (a white check on dark) without any dependencies."""
import math, struct, sys, zlib
from pathlib import Path

def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def render(size):
    # Same geometry as icon.svg, in a 100-unit box; it sits inside the maskable safe zone.
    pts = [(30, 52), (44, 66), (72, 36)]
    half = 4.5
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            ux, uy = (x + 0.5) * 100 / size, (y + 0.5) * 100 / size
            d = min(seg_dist(ux, uy, *pts[0], *pts[1]), seg_dist(ux, uy, *pts[1], *pts[2]))
            a = max(0.0, min(1.0, half - d + 0.5))
            v = round(0x1a + (0xff - 0x1a) * a)
            row += bytes([v, v, v])
        rows.append(bytes(row))
    raw = zlib.compress(b''.join(rows), 9)
    chunk = lambda tag, data: struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', raw) + chunk(b'IEND', b'')

out = Path(sys.argv[1] if len(sys.argv) > 1 else 'public')
for size in (192, 512):
    (out / f'icon-{size}.png').write_bytes(render(size))
