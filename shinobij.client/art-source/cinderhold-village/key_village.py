"""Key the Cinderhold village render off its magenta chroma background.

    python -I key_village.py <render.png> <out.webp> <preview.png>

Writes the walled compound as an RGBA WebP cropped to the wall (compose input
for scripts/compose-cinderhold-floors.py) and a preview on dark ash for review.
"""
import sys

from PIL import Image, ImageFilter


def main():
    src, out, preview = sys.argv[1:4]
    im = Image.open(src).convert('RGB')
    w, h = im.size
    px = im.load()
    alpha = Image.new('L', (w, h), 255)
    a = alpha.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            # Distance from pure magenta: high red and blue, low green.
            key = min(r, b) - g
            if key > 120:
                a[x, y] = 0
            elif key > 60:
                a[x, y] = round(255 * (120 - key) / 60)
    # Shrink the matte by a pixel so no pink rim survives, then soften it.
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(.6))
    # Despill: pull magenta tint out of edge pixels.
    rgb = im.copy()
    rp = rgb.load()
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if ap[x, y] < 250:
                r, g, b = rp[x, y]
                cap = g + 12
                rp[x, y] = (min(r, cap), g, min(b, cap))
    out_img = rgb.convert('RGBA')
    out_img.putalpha(alpha)
    out_img = out_img.crop(alpha.point(lambda v: 255 if v > 24 else 0).getbbox())
    out_img.save(out, 'WEBP', quality=92, method=6)
    bg = Image.new('RGBA', out_img.size, (52, 46, 42, 255))
    bg.alpha_composite(out_img)
    bg.convert('RGB').save(preview)
    print(out_img.size)


if __name__ == '__main__':
    main()
