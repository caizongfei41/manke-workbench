"""Generate the workbench's app icons from a single square source image.

The project has no Node image library installed, so this uses the bundled
Python's Pillow — the same interpreter ComfyUI ships with.

Usage:
    E:\\ComfyUI\\python_embeded\\python.exe scripts\\make-app-icons.py <source-image>

Outputs (overwriting public/, with the originals kept as .bak):
    public/logo.png              300x300  — header logo, rendered at 28px
    public/apple-touch-icon.png  180x180  — iOS home-screen icon
    public/favicon.ico           multi-size (16/32/48/64/128/256)

The source is expected to be square; a non-square input is centre-cropped to a
square first, because every consumer of these files renders them in a square box.
"""
import os
import shutil
import sys

from PIL import Image

PUBLIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")

# Output file -> (size, format)
TARGETS = {
    "logo.png": (300, "PNG"),
    "apple-touch-icon.png": (180, "PNG"),
}

ICO_SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def square(im: Image.Image) -> Image.Image:
    """Centre-crop to a square so nothing is distorted when scaled down."""
    w, h = im.size
    if w == h:
        return im
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side))


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.strip())
        return 2

    src = sys.argv[1]
    if not os.path.exists(src):
        print(f"source not found: {src}")
        return 1

    im = square(Image.open(src).convert("RGB"))
    print(f"source  {Image.open(src).size} -> square {im.size}")

    for name, (size, fmt) in TARGETS.items():
        dest = os.path.join(PUBLIC, name)
        if os.path.exists(dest) and not os.path.exists(dest + ".bak"):
            shutil.copy2(dest, dest + ".bak")
        # LANCZOS keeps the icon's hard edges crisp when downscaling.
        im.resize((size, size), Image.LANCZOS).save(dest, fmt, optimize=True)
        print(f"  {name:24s} {size}x{size}  {os.path.getsize(dest) // 1024} KB")

    ico = os.path.join(PUBLIC, "favicon.ico")
    if os.path.exists(ico) and not os.path.exists(ico + ".bak"):
        shutil.copy2(ico, ico + ".bak")
    # Pillow writes every requested size into one .ico container.
    im.resize((256, 256), Image.LANCZOS).save(ico, format="ICO", sizes=ICO_SIZES)
    print(f"  {'favicon.ico':24s} {'/'.join(str(s[0]) for s in ICO_SIZES)}  "
          f"{os.path.getsize(ico) // 1024} KB")

    print(f"\nwrote into {PUBLIC} (originals kept as *.bak)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
