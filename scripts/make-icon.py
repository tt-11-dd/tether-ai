#!/usr/bin/env python3
"""Rasterize build/icon.svg into build/icon.png with a transparent outside.

QuickLook (the only SVG rasterizer available on a stock macOS) flattens alpha to
white, which shows up as a white square behind the Dock icon. So the tile shape
is masked back in here: the rounded rect is the icon's silhouette, everything
outside it becomes fully transparent.

Usage: python3 scripts/make-icon.py
"""
from __future__ import annotations

import math
import pathlib
import struct
import subprocess
import sys
import tempfile
import zlib

SIZE = 1024
# Must match the rect in build/icon.svg.
TILE_X, TILE_Y, TILE_W, TILE_H, TILE_R = 100, 100, 824, 824, 185
TILE_RGB = (0xF2, 0xE9, 0xE1)
SUBROWS = 4

ROOT = pathlib.Path(__file__).resolve().parent.parent


def render_opaque(svg: pathlib.Path, out_dir: pathlib.Path) -> pathlib.Path:
    subprocess.run(
        ["qlmanage", "-t", "-s", str(SIZE), "-o", str(out_dir), str(svg)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    rendered = out_dir / f"{svg.name}.png"
    if not rendered.exists():
        sys.exit("qlmanage produced no thumbnail")
    return rendered


def read_png(path: pathlib.Path) -> tuple[int, int, list[bytes], int]:
    data = path.read_bytes()
    pos, idat, width, height, channels = 8, b"", 0, 0, 0
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", chunk[:10])
            if depth != 8:
                sys.exit(f"unsupported bit depth {depth}")
            channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color, 0)
            if not channels:
                sys.exit(f"unsupported color type {color}")
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length

    raw = zlib.decompress(idat)
    stride = width * channels
    rows, previous, offset = [], bytearray(stride), 0
    for _ in range(height):
        filter_type = raw[offset]
        offset += 1
        line = bytearray(raw[offset:offset + stride])
        offset += stride
        for x in range(stride):
            left = line[x - channels] if x >= channels else 0
            up = previous[x]
            up_left = previous[x - channels] if x >= channels else 0
            if filter_type == 1:
                line[x] = (line[x] + left) & 255
            elif filter_type == 2:
                line[x] = (line[x] + up) & 255
            elif filter_type == 3:
                line[x] = (line[x] + (left + up) // 2) & 255
            elif filter_type == 4:
                estimate = left + up - up_left
                deltas = (abs(estimate - left), abs(estimate - up), abs(estimate - up_left))
                line[x] = (line[x] + (left if deltas[0] <= deltas[1] and deltas[0] <= deltas[2]
                                      else up if deltas[1] <= deltas[2] else up_left)) & 255
        rows.append(bytes(line))
        previous = line
    return width, height, [bytes(row) for row in rows], channels


def tile_span(y: float) -> tuple[float, float] | None:
    """Horizontal extent of the rounded rect at scanline y, or None outside it."""
    top, bottom = TILE_Y, TILE_Y + TILE_H
    if y < top or y > bottom:
        return None
    inset = 0.0
    if y < top + TILE_R:
        dy = (top + TILE_R) - y
        inset = TILE_R - math.sqrt(max(0.0, TILE_R * TILE_R - dy * dy))
    elif y > bottom - TILE_R:
        dy = y - (bottom - TILE_R)
        inset = TILE_R - math.sqrt(max(0.0, TILE_R * TILE_R - dy * dy))
    return TILE_X + inset, TILE_X + TILE_W - inset


def coverage_row(y: int) -> list[float]:
    """Per-pixel alpha coverage: exact horizontally, supersampled vertically."""
    row = [0.0] * SIZE
    for sub in range(SUBROWS):
        span = tile_span(y + (sub + 0.5) / SUBROWS)
        if span is None:
            continue
        left, right = span
        for x in range(max(0, int(left)), min(SIZE, int(math.ceil(right)))):
            overlap = min(x + 1.0, right) - max(float(x), left)
            if overlap > 0:
                row[x] += overlap / SUBROWS
    return row


def write_png(path: pathlib.Path, rows: list[bytes]) -> None:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    body = b"".join(b"\x00" + row for row in rows)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(body, 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    svg = ROOT / "build" / "icon.svg"
    with tempfile.TemporaryDirectory() as tmp:
        width, height, rows, channels = read_png(render_opaque(svg, pathlib.Path(tmp)))
    if (width, height) != (SIZE, SIZE):
        sys.exit(f"expected {SIZE}x{SIZE} render, got {width}x{height}")

    out = []
    for y in range(SIZE):
        source, line = rows[y], bytearray()
        alpha_row = coverage_row(y)
        for x in range(SIZE):
            alpha = alpha_row[x]
            if alpha <= 0:
                line += b"\x00\x00\x00\x00"
                continue
            if alpha >= 1:
                px = source[x * channels:(x + 1) * channels]
                line += bytes((px[0], px[1], px[2], 255))
            else:
                # Edge pixels take the tile colour so the flattened white never fringes.
                line += bytes((*TILE_RGB, round(alpha * 255)))
        out.append(bytes(line))

    target = ROOT / "build" / "icon.png"
    write_png(target, out)
    print(f"wrote {target.relative_to(ROOT)} ({SIZE}x{SIZE}, transparent outside the tile)")


if __name__ == "__main__":
    main()
