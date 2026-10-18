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
  - EXCEPT when the count covers an item's whole lower arc — a coin, or an amount
    printed across the bottom CENTRE instead of in the corner. The convex hull of
    what survives is then a straight chord, so that repair comes out flat and
    ragged. If the outline the count did NOT touch is a circle to sub-pixel
    accuracy, the circle IS the silhouette and the count's area is painted from
    the item's own colours. The guard (a tight fit, and the circle must enclose
    the item) keeps a non-round token — the hexagonal 喵幣 / 愛心幣 captures — off
    this path, and `--no-round` turns it off by hand.
  - the silhouette is feathered 1px, cropped to the item, padded to a square
    (default 8% margin) and downscaled with LANCZOS.

The thresholds are tuned to a Mabinogi Mobile (TW) capture — purple glow over a
dark backdrop, white count bottom-right. A capture that does not match those
cues will need the two colour rules adjusted, which is why the count's search
box is exposed as `--number-x/--number-y` (a bottom-centre amount needs a much
smaller `--number-x`: 0.05 caught the gold coin's leading digit, 0.34 did not).

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

COUNT_TOUCH_PAD_PX = 2
COUNT_EDGE_SKIP_PAD_PX = 6
ROUND_MIN_OUTLINE_PX = 30
ROUND_FIT_P90_PX = 1.5
ROUND_ENCLOSE_FRAC = 0.03
COUNT_MASK_PAD_PX = 8
FILL_SOURCE_EDGE_TRIM_PX = 3
FILL_INPAINT_RADIUS_PX = 8
FILL_SEAM_SIGMA = 1.5
FILL_SEAM_GAIN = 1.6


def fit_circle(px: np.ndarray, py: np.ndarray) -> tuple[float, float, float]:
    """Least-squares circle through points (px, py) -> (cx, cy, r)."""
    a = np.c_[2 * px, 2 * py, np.ones(len(px))]
    b = px.astype(float) ** 2 + py.astype(float) ** 2
    (cx, cy, c), *_ = np.linalg.lstsq(a, b, rcond=None)
    return float(cx), float(cy), float(np.sqrt(c + cx**2 + cy**2))


def round_silhouette(item: np.ndarray, num: np.ndarray, number: np.ndarray, yy: np.ndarray, xx: np.ndarray) -> np.ndarray | None:
    """The silhouette as a circle, or None when the item is not round.

    Only for the case the convex-hull repair cannot handle: a count that covers an
    item's whole lower arc. Returns the disc mask, which then stands in for `item`.

    The guard is deliberately strict, because rounding a token that is NOT a disc
    would be a silent, permanent corruption of the icon:
      - the fit must be tight (p90 residual < `ROUND_FIT_P90_PX`) on the outline the
        count did not touch, and
      - the circle must enclose the item (a hexagon's circumscribed circle leaves
        its corners outside; its outline also misses the fit by several px).
    A count that does not touch the silhouette at all returns None: there is
    nothing to rebuild and the plain path is already correct.
    """
    outline = item & ~ndimage.binary_erosion(item, np.ones((3, 3)))
    if not (outline & ndimage.binary_dilation(num, np.ones((3, 3)), iterations=COUNT_TOUCH_PAD_PX)).any():
        return None
    reliable = outline & ~ndimage.binary_dilation(num, np.ones((3, 3)), iterations=COUNT_EDGE_SKIP_PAD_PX)
    oy, ox = np.where(reliable)
    if len(oy) < ROUND_MIN_OUTLINE_PX:
        return None
    cx, cy, r = fit_circle(ox, oy)
    residual = np.abs(np.hypot(ox - cx, oy - cy) - r)
    if np.percentile(residual, 90) > ROUND_FIT_P90_PX:
        return None
    inside = np.hypot(xx - cx, yy - cy) <= r
    if (item & ~inside).sum() > ROUND_ENCLOSE_FRAC * item.sum():
        return None
    return inside


def clean(rgb: np.ndarray, number_x: float, number_y: float, round_ok: bool = True) -> Image.Image:
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

    disc = round_silhouette(item, num, number, yy, xx) if round_ok else None
    if disc is not None:
        need = (disc & ndimage.binary_dilation(number, np.ones((3, 3)), iterations=COUNT_MASK_PAD_PX)).astype(np.uint8)
        good = disc & (~bg) & (~number) & ndimage.binary_erosion(item, np.ones((3, 3)), iterations=FILL_SOURCE_EDGE_TRIM_PX)
        if good.any():
            _, (gy, gx) = ndimage.distance_transform_edt(~good, return_indices=True)
            ext = rgb.copy()
            ext[~disc] = rgb[gy[~disc], gx[~disc]]
            bgr = ext[:, :, ::-1].copy()
            if need.any():
                bgr = cv2.inpaint(bgr, need, FILL_INPAINT_RADIUS_PX, cv2.INPAINT_NS)
            patched = np.ascontiguousarray(bgr[:, :, ::-1])
            weight = np.clip(ndimage.gaussian_filter(need.astype(np.float32), FILL_SEAM_SIGMA) * FILL_SEAM_GAIN, 0, 1)[:, :, None]
            patched = (rgb * (1 - weight) + patched * weight).astype(np.uint8)
            silhouette = disc
        else:
            disc = None
    if disc is None:
        hull = np.zeros((h, w), np.uint8)
        cnts, _ = cv2.findContours(item.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if cnts:
            cv2.fillPoly(hull, [cv2.convexHull(c) for c in cnts], 1)
        silhouette = ndimage.binary_fill_holes(item | ((hull > 0) & num))

        bgr = rgb[:, :, ::-1].copy()
        if num.any():
            bgr = cv2.inpaint(bgr, num.astype(np.uint8), 4, cv2.INPAINT_TELEA)
        patched = np.ascontiguousarray(bgr[:, :, ::-1])

    alpha = ndimage.gaussian_filter(silhouette.astype(np.float32), sigma=0.8)
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
    ap.add_argument("--no-round", action="store_true", help="do not rebuild a round silhouette from a circle fit")
    args = ap.parse_args()

    name = os.path.splitext(os.path.basename(args.input))[0]
    out = args.out or os.path.join("public", "items", name + ".webp")

    rgb = np.asarray(Image.open(args.input).convert("RGB"))
    cleaned = clean(rgb, args.number_x, args.number_y, round_ok=not args.no_round)

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
