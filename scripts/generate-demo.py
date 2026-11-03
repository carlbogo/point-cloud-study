"""Generate explicitly synthetic, balanced digit point-cloud PNGs using only stdlib."""

import json, math, random, struct, zlib
from pathlib import Path

root = Path(__file__).resolve().parent.parent
dest = root / "data/demo"
dest.mkdir(parents=True, exist_ok=True)
segments = {
    "1": [[(120, 85), (160, 55), (160, 255)]],
    "2": [[(75, 85), (110, 50), (190, 50), (230, 85), (230, 115), (75, 255), (235, 255)]],
    "3": [
        [(75, 55), (220, 55), (155, 150), (220, 190), (210, 245), (145, 265), (75, 235)],
        [(120, 150), (170, 150)],
    ],
    "4": [[(205, 260), (205, 50), (70, 190), (245, 190)]],
    "5": [
        [(235, 55), (85, 55), (80, 150), (190, 140), (235, 180), (220, 245), (150, 265), (75, 240)]
    ],
    "6": [
        [
            (215, 65),
            (160, 45),
            (100, 85),
            (75, 175),
            (90, 240),
            (150, 265),
            (215, 240),
            (230, 180),
            (185, 145),
            (120, 145),
            (75, 175),
        ]
    ],
    "7": [[(70, 55), (240, 55), (125, 260)]],
    "8": [
        [
            (150, 150),
            (90, 115),
            (90, 70),
            (150, 45),
            (215, 70),
            (215, 115),
            (150, 150),
            (80, 195),
            (90, 245),
            (150, 270),
            (220, 245),
            (230, 195),
            (150, 150),
        ]
    ],
    "9": [
        [
            (225, 145),
            (170, 165),
            (100, 145),
            (80, 90),
            (110, 50),
            (180, 45),
            (225, 80),
            (225, 175),
            (190, 240),
            (115, 265),
        ]
    ],
}


def png(pixels, w):
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, w, 8, 2, 0, 0, 0))
        + chunk(
            b"IDAT",
            zlib.compress(
                b"".join(b"\0" + bytes(pixels[y * w * 3 : (y + 1) * w * 3]) for y in range(w))
            ),
        )
        + chunk(b"IEND", b"")
    )


items = []
for difficulty in [9, 11, 13, 17]:
    for label, paths in segments.items():
        for variant in range(6):
            rng = random.Random(int(label) * 100 + variant + difficulty * 1000)
            w = 320
            pixels = bytearray([9, 11, 15] * (w * w))

            def dot(x, y, r=2):
                for dy in range(-r, r + 1):
                    for dx in range(-r, r + 1):
                        xx, yy = round(x) + dx, round(y) + dy
                        if dx * dx + dy * dy <= r * r and 0 <= xx < w and 0 <= yy < w:
                            i = (yy * w + xx) * 3
                            pixels[i : i + 3] = bytes([220, 230, 245])

            for path in paths:
                for (x1, y1), (x2, y2) in zip(path, path[1:]):
                    n = max(1, int(math.hypot(x2 - x1, y2 - y1) / (difficulty + 2)))
                    for j in range(n):
                        t = j / n
                        dot(
                            x1 + (x2 - x1) * t + rng.uniform(-3, 3),
                            y1 + (y2 - y1) * t + rng.uniform(-3, 3),
                        )
            for _ in range(45 if difficulty == 9 else 70):
                dot(rng.randrange(w), rng.randrange(w), 1)
            name = f"{label}-{difficulty}-{variant}.png"
            (dest / name).write_bytes(png(pixels, w))
            items.append(
                dict(
                    dataset="mnist",
                    label=label,
                    difficulty=difficulty,
                    source_index=f"{label}-{variant}",
                    image="demo/" + name,
                )
            )
(root / "data/demo-manifest.json").write_text(
    json.dumps(dict(source="demo-glyphs", items=items), indent=2)
)
print("Generated synthetic demo images; these are NOT MNIST samples.")
