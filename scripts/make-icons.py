#!/usr/bin/env python3
"""Generate simple PNG toolbar icons with the standard library only."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "icons"
BG = (109, 40, 217, 255)
FG = (250, 250, 250, 255)


def png(width: int, height: int, rows: list[bytes]) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + row for row in rows)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def dist_to_segment(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    dx, dy = x2 - x1, y2 - y1
    length = dx * dx + dy * dy
    if length == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def inside_rounded_rect(px: float, py: float, size: int, radius: float) -> bool:
    x = min(max(px, radius), size - radius)
    y = min(max(py, radius), size - radius)
    if radius <= px <= size - radius or radius <= py <= size - radius:
        return 0 <= px <= size and 0 <= py <= size
    return math.hypot(px - x, py - y) <= radius


def render(size: int) -> bytes:
    cx, cy = size * 0.42, size * 0.40
    radius = size * 0.20
    stroke = max(1.6, size * 0.085)
    rows: list[bytes] = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            pixel = BG if inside_rounded_rect(px, py, size, size * 0.22) else (0, 0, 0, 0)
            ring = abs(math.hypot(px - cx, py - cy) - radius)
            handle = dist_to_segment(
                px, py, cx + radius * 0.72, cy + radius * 0.72, size * 0.78, size * 0.80
            )
            if ring <= stroke / 2 or handle <= stroke / 2:
                pixel = FG
            row.extend(pixel)
        rows.append(bytes(row))
    return png(size, size, rows)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        (ROOT / f"icon-{size}.png").write_bytes(render(size))


if __name__ == "__main__":
    main()
