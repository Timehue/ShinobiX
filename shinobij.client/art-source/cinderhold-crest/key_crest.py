"""Key the magenta chroma background off the Cinderhold crest render and size it
like the other map-landmark crests (256x256 RGBA WebP)."""
import sys
from PIL import Image, ImageFilter

src, out, preview = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src).convert('RGBA')
px = im.load()
w, h = im.size
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        # Distance from pure magenta: magenta has high R and B, low G.
        magentaness = min(r, b) - g
        if magentaness > 90 and r > 150 and b > 150:
            px[x, y] = (0, 0, 0, 0)
        elif magentaness > 30 and r > 110 and b > 110:
            # Fringe: fade alpha and pull the pink spill out of the colour.
            alpha = max(0, min(255, int(255 * (90 - magentaness) / 60)))
            px[x, y] = (r, max(g, min(r, b) - 30), min(b, g + 20), alpha)
# Despill any remaining pink tint on opaque edge pixels.
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a and b > g + 25 and r > g + 25:
            px[x, y] = (r, g, min(b, g + 10), a)
bbox = im.getbbox()
im = im.crop(bbox)
side = max(im.size)
canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
canvas.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
canvas = canvas.resize((256, 256), Image.Resampling.LANCZOS)
canvas.save(out, 'WEBP', quality=90, method=6)
for bg, name in (((255, 0, 255, 255), 'magenta'), ((40, 40, 40, 255), 'dark')):
    p = Image.new('RGBA', (256, 256), bg); p.alpha_composite(canvas)
    p.resize((768, 768), Image.Resampling.NEAREST).save(preview.replace('.png', f'-{name}.png'))
print(canvas.size, bbox)
