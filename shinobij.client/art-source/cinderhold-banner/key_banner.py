"""Key the magenta chroma background off the Cinderhold owned-sector banner render
and fit it like the four village banners (341x512 RGBA WebP: the standee about
430 px tall, centred, its base ending near y 460)."""
import sys
from PIL import Image

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
# Force fully opaque art inside the figure (no lossy see-through), then crop.
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a >= 250:
            px[x, y] = (r, g, b, 255)
bbox = im.getbbox()
im = im.crop(bbox)
TARGET_H, BASE_Y, CANVAS = 432, 460, (341, 512)
scale = TARGET_H / im.height
im = im.resize((max(1, round(im.width * scale)), TARGET_H), Image.Resampling.LANCZOS)
canvas = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
canvas.alpha_composite(im, ((CANVAS[0] - im.width) // 2, BASE_Y - TARGET_H))
canvas.save(out, 'WEBP', quality=85, method=6)
for bg, name in (((255, 0, 255, 255), 'magenta'), ((40, 40, 40, 255), 'dark')):
    p = Image.new('RGBA', CANVAS, bg); p.alpha_composite(canvas)
    p.resize((CANVAS[0] * 3, CANVAS[1] * 3), Image.Resampling.NEAREST).save(preview.replace('.png', f'-{name}.png'))
print(canvas.size, bbox, im.size)
