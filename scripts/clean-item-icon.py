#!/usr/bin/env python3
"""Captured item icon -> the repo's 128x128 transparent WebP.

Some items have no clean art source, so they are captured in-game instead. A
capture carries two things the icon must not:

  - the game's rarity glow and backdrop behind the item, and
  - the stack count printed over the item's lower-right corner.

This script strips both and exports the format `public/items/` uses: 128x128,
WebP quality 85, method 6, alpha kept.

How it decides:
  - background = the purple rarity glow (`B-G>18 & R>=G & B>R`) plus the
    neutral-dark backdrop beyond it (low saturation, dark). Everything else is
    the item.
  - the count = neutral-white pixels in the lower-right (a region filter keeps
    the item's own bright, coloured art out of it); its mask is dilated to
    swallow the dark outline, painted out with `cv2.inpaint`, and the notch it
    left in the silhouette is filled back to the item's convex shape.
  - the silhouette is feathered 1px, cropped to the item, padded to a square
    (default 8% margin) and downscaled with LANCZOS.

The thresholds are tuned to a Mabinogi Mobile (TW) capture — purple glow over a
dark backdrop, white count bottom-right. A capture that does not match those
cues will need the two colour rules adjusted, which is why the count's search
box is exposed as `--number-x/--number-y`.

Requires: Pillow, numpy, scipy, opencv-python.

    python scripts/clean-item-icon.py capture.png
    python scripts/clean-item-icon.py capture.png --out public/items/深淵的化石.webp
"""
import argparse
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage


def clean(rgb: np.ndarray, number_x: float, number_y: float) -> Image.Image:
    arr = rgb.astype(np.int16)
    h, w, _ = arr.shape
    R, G, B = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    mx = np.max(arr, axis=2)
    mn = np.min(arr, axis=2)
    yy, xx = np.mgrid[0:h, 0:w]

    bg = ((B - G > 18) & (R >= G) & (B > R)) | (((mx - mn) < 12) & (mx < 46))
    number = ((mx - mn) < 46) & (mn > 150) & (xx > number_x * w) & (yy > number_y * h)
    num = ndimage.binary_dilation(number, np.ones((3, 3)), iterations=4)

    item = (~bg) & (~num)
    item = ndimage.binary_opening(item, np.ones((3, 3)), iterations=1)
    item = ndimage.binary_fill_holes(item)
    lab, n = ndimage.label(item)
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        item = lab == (1 + int(np.argmax(sizes)))

    # heal the bite the count left: fill it where the silhouette is convex
    hull = np.zeros((h, w), np.uint8)
    cnts, _ = cv2.findContours(item.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if cnts:
        cv2.fillPoly(hull, [cv2.convexHull(c) for c in cnts], 1)
    item = ndimage.binary_fill_holes(item | ((hull > 0) & num))

    bgr = rgb[:, :, ::-1].copy()
    if num.any():
        bgr = cv2.inpaint(bgr, num.astype(np.uint8), 4, cv2.INPAINT_TELEA)
    patched = np.ascontiguousarray(bgr[:, :, ::-1])

    alpha = ndimage.gaussian_filter(item.astype(np.float32), sigma=0.8)
    alpha = np.clip((alpha - 0.15) / 0.7, 0, 1)
    return Image.fromarray(np.dstack([patched, (alpha * 255).astype(np.uint8)]), "RGBA")


def main() -> int:
    ap = argparse.ArgumentParser(description="captured item icon -> 128px transparent WebP")
    ap.add_argument("input", help="captured PNG/JPG of the item")
    ap.add_argument("--out", help="output path (default public/items/<name>.webp)")
    ap.add_argument("--size", type=int, default=128)
    ap.add_argument("--quality", type=int, default=85)
    ap.add_argument("--margin", type=float, default=0.08, help="square padding around the item")
    ap.add_argument("--number-x", type=float, default=0.34, help="count search starts at this x fraction")
    ap.add_argument("--number-y", type=float, default=0.48, help="count search starts at this y fraction")
    args = ap.parse_args()

    name = os.path.splitext(os.path.basename(args.input))[0]
    out = args.out or os.path.join("public", "items", name + ".webp")

    rgb = np.asarray(Image.open(args.input).convert("RGB"))
    cleaned = clean(rgb, args.number_x, args.number_y)

    bbox = cleaned.getchannel("A").point(lambda v: 255 if v > 127 else 0).getbbox()
    if not bbox:
        print("no item found (everything read as background)", file=sys.stderr)
        return 1
    crop = cleaned.crop(bbox)
    side = round(max(crop.width, crop.height) * (1 + args.margin))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2), crop)
    final = canvas.resize((args.size, args.size), Image.LANCZOS)

    assert final.size == (args.size, args.size) and "A" in final.getbands(), "bad export"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    final.save(out, "WEBP", quality=args.quality, method=6)
    print(f"{args.input} -> {out} {final.size} ({os.path.getsize(out)}B)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
