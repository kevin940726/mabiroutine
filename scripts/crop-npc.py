#!/usr/bin/env python3
"""
Simple NPC pfp crop: 4-side exact -> 76 square -> circle (transparent)
- Input: public/npc-raw/<npc>.png  (single bg, head not necessarily centered square)
- For each side, sample edge mid color, scan inward until != bg (tolerance 8) -> left/right/top/bottom
- Must be 76x76 square after trim, else error
- Then circle (transparent outside, head on transparent)
Keep original resolution, no upscale to 256.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

RAW_DIR = Path("public/npc-raw")
OUT_DIR = Path("public/npc")

def circle_crop(im):
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, w, h), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=1))
    ea = im.getchannel("A")
    comb = Image.new("L", (w, h), 0)
    for y in range(h):
        for x in range(w):
            comb.putpixel((x, y), (ea.getpixel((x, y)) * mask.getpixel((x, y))) // 255)
    im.putalpha(comb)
    return im

def process_one(src: Path):
    import math
    def d2(a,b): return math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2)
    try:
        orig = Image.open(src).convert("RGBA")
    except Exception as e:
        print(f"[skip] {src.name}: {e}")
        return False
    w0, h0 = orig.size
    tol = 8
    bg_l = orig.getpixel((0, h0//2))[:3]
    bg_r = orig.getpixel((w0-1, h0//2))[:3]
    bg_t = orig.getpixel((w0//2, 0))[:3]
    bg_b = orig.getpixel((w0//2, h0-1))[:3]
    left = next((x for x in range(w0) if d2(orig.getpixel((x, h0//2))[:3], bg_l) > tol), 0)
    right = next((x for x in range(w0-1, -1, -1) if d2(orig.getpixel((x, h0//2))[:3], bg_r) > tol), w0-1)
    top = next((y for y in range(h0) if d2(orig.getpixel((w0//2, y))[:3], bg_t) > tol), 0)
    bottom = next((y for y in range(h0-1, -1, -1) if d2(orig.getpixel((w0//2, y))[:3], bg_b) > tol), h0-1)
    w_box = right - left + 1
    h_box = bottom - top + 1
    print(f"  [4-side] {src.stem} {w0}x{h0} -> left {left} right {right} top {top} bottom {bottom} => w{w_box} h{h_box}")
    if w_box != h_box and abs(w_box - h_box) < 2:
        if w_box > h_box:
            print(f"  [fix] w{w_box} > h{h_box} by 1px, trimming right by 1")
            right -= 1
        else:
            print(f"  [fix] h{h_box} > w{w_box} by 1px, trimming bottom by 1")
            bottom -= 1
        w_box = right - left + 1
        h_box = bottom - top + 1
    if w_box != 76 or h_box != 76:
        print(f"[error] not 76x76 w{w_box} h{h_box} for {src.name}")
        return False
    square = orig.crop((left, top, right+1, bottom+1))
    # keep square as is (green bg + head), circle will make outside transparent only
    out = circle_crop(square)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dst = OUT_DIR / (src.stem + ".png")
    out.save(dst, "PNG")
    print(f"[ok] {src.name} -> {dst.name} {out.size}")
    return True

def main():
    import argparse
    ap = argparse.ArgumentParser(description="4-side -> 76 square -> circle")
    ap.add_argument("names", nargs="*")
    args = ap.parse_args()
    exts={".png",".jpg",".jpeg",".webp",".bmp"}
    if args.names:
        files=[]
        for n in args.names:
            for ext in exts:
                p=RAW_DIR/(n+ext)
                if p.exists():
                    files.append(p); break
            else:
                for p in RAW_DIR.iterdir():
                    if p.stem==n and p.suffix.lower() in exts:
                        files.append(p); break
                else:
                    print(f"[warn] not found {n}")
    else:
        files=[p for p in RAW_DIR.iterdir() if p.suffix.lower() in exts and p.name!="README.md"]
    ok=0
    for f in sorted(files):
        if process_one(f):
            ok+=1
    print(f"\ndone {ok}/{len(files)} -> {OUT_DIR}")

if __name__=="__main__":
    main()
