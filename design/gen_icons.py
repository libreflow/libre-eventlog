#!/usr/bin/env python3
"""Génère les icônes PNG/ICO de Libre EventLog à partir de formes vectorielles (Pillow).

Équivalent raster du design/logo.svg : moniteur sombre arrondi, lignes de log
(critique/erreur/info), stylus/pulse accent, trois LEDs de statut.
"""

import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
os.makedirs(OUT, exist_ok=True)

BG_TOP = (43, 53, 80)
BG_BOT = (19, 23, 34)
SCREEN = (11, 13, 18)
STROKE = (79, 140, 255, 90)
ACC1 = (79, 140, 255)
ACC2 = (122, 92, 255)
CRIT = (255, 95, 86)
WARN = (255, 189, 46)
OK = (39, 201, 63)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 512.0

    # Fond dégradé
    grad = Image.new("RGBA", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        gd.line([(0, y), (size, y)], fill=lerp(BG_TOP, BG_BOT, y / max(size - 1, 1)) + (255,))
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    r = int(96 * s)
    md.rounded_rectangle([int(32 * s), int(32 * s), int(480 * s), int(480 * s)], r, fill=255)
    img.paste(grad, (0, 0), mask)
    d.rounded_rectangle(
        [int(32 * s), int(32 * s), int(480 * s), int(480 * s)], r,
        outline=(79, 140, 255, 90), width=max(1, int(6 * s)),
    )

    # Écran
    d.rounded_rectangle(
        [int(112 * s), int(112 * s), int(400 * s), int(400 * s)], int(40 * s),
        fill=SCREEN + (216,),
    )

    # Lignes de log
    rows = [
        (164, CRIT, 176),
        (200, WARN, 132),
        (236, ACC1, 196),
    ]
    for y0, col, w in rows:
        y = int(y0 * s)
        h = max(2, int(12 * s))
        d.rounded_rectangle([int(152 * s), y, int(164 * s), y + h], max(1, h // 3), fill=col + (140,))
        d.rounded_rectangle([int(180 * s), y, int((180 + w) * s), y + h], max(1, h // 3), fill=col + (77,))

    # Stylus / pulse accent (chemin simplifié : ligne brisée avec coin arrondi)
    pulse = [
        (272, 272), (288, 272), (336, 320), (312, 368), (264, 368),
        (240, 392), (176, 392),
    ]
    pts = [(int(x * s), int(y * s)) for x, y in pulse]
    wline = max(2, int(20 * s))
    d.line(pts, fill=ACC1, width=wline, joint="curve")
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - wline // 2, p[1] - wline // 2, p[0] + wline // 2, p[1] + wline // 2], fill=ACC1)

    # LEDs statut
    for x0, col in ((176, OK), (208, WARN), (240, ACC1)):
        cx, cy, rr = int(x0 * s), int(416 * s), max(2, int(9 * s))
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col)

    return img


def main():
    base = draw_icon(512)
    base.resize((512, 512)).save(os.path.join(OUT, "icon.png"))
    base.resize((32, 32), Image.LANCZOS).save(os.path.join(OUT, "32x32.png"))
    base.resize((128, 128), Image.LANCZOS).save(os.path.join(OUT, "128x128.png"))
    base.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, "128x128@2x.png"))

    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base.resize((256, 256), Image.LANCZOS).save(
        os.path.join(OUT, "icon.ico"),
        sizes=sizes,
    )
    print("Icônes générées dans", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
