"""The app icon: two soft circles, the two of you, and where they overlap, the day you meet.
Like the sister apps' icons it is the one picture with gradients. Writes public/icons/ and src/app/ icons.

    python design/make-icons.py
"""
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 2048  # drawn large, then scaled down for smooth edges

yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S


def disc(cx, cy, r, soft=0.004):
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    return np.clip((r - d) / soft, 0, 1)


def ramp(c0, c1, ax, ay):
    """A linear gradient from c0 to c1 along the direction (ax, ay)."""
    t = np.clip(((xx - 0.5) * ax + (yy - 0.5) * ay) / 0.5 * 0.5 + 0.5, 0, 1)[..., None]
    a, b = np.array(c0, np.float32) / 255, np.array(c1, np.float32) / 255
    return a * (1 - t) + b * t


def over(base, color, alpha):
    a = alpha[..., None]
    return base * (1 - a) + color * a


def draw(full_bleed: bool):
    paper = np.array([252, 251, 248], np.float32) / 255
    img = np.ones((S, S, 3), np.float32) * paper
    # you: blue, them: pink to violet; where they overlap, a deeper violet-blue
    left = disc(0.395, 0.535, 0.215)
    right = disc(0.605, 0.465, 0.215)
    blue = ramp((120, 186, 255), (10, 100, 240), 0.7, 0.7)
    pink = ramp((255, 176, 214), (150, 120, 250), -0.7, 0.7)
    img = over(img, blue, left * 0.9)
    img = over(img, pink, right * 0.82)
    both = left * right
    deep = ramp((106, 79, 224), (52, 72, 235), 0.0, 1.0)
    img = over(img, deep, both * 0.55)
    # a small light in the overlap, the day itself
    img = over(img, np.ones_like(img), disc(0.5, 0.5, 0.034, 0.003) * 0.95)

    rgba = np.concatenate([img, np.ones((S, S, 1), np.float32)], axis=2)
    if not full_bleed:
        # a rounded card with transparent corners
        r = 0.225
        q = np.maximum(np.abs(xx - 0.5) - (0.5 - r), 0) ** 2 + np.maximum(np.abs(yy - 0.5) - (0.5 - r), 0) ** 2
        rgba[..., 3] = np.clip((r - np.sqrt(q)) / 0.002, 0, 1)
    return Image.fromarray((rgba * 255).round().astype(np.uint8), "RGBA")


def main():
    card = draw(False)
    square = draw(True)
    icons = os.path.join(ROOT, "public", "icons")
    os.makedirs(icons, exist_ok=True)
    for px in (192, 512):
        card.resize((px, px), Image.LANCZOS).save(os.path.join(icons, f"icon-{px}.png"))
    square.resize((512, 512), Image.LANCZOS).save(os.path.join(icons, "maskable-512.png"))
    app = os.path.join(ROOT, "src", "app")
    card.resize((512, 512), Image.LANCZOS).save(os.path.join(app, "icon.png"))
    square.resize((180, 180), Image.LANCZOS).convert("RGB").save(os.path.join(app, "apple-icon.png"))
    card.resize((256, 256), Image.LANCZOS).save(os.path.join(app, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
    print("icons written")


if __name__ == "__main__":
    sys.exit(main())
