"""Native composition of Cinderhold's floors and the Lavafront repaint.

Owner-authorized method (docs/handoffs/connected-sector-world-work-state.md,
"compose and bake the finished maps"; owner 2026-11-11: "keep it in the same
style/theme as the other sectors", "feel free to add landmarks like ruins,
waterfalls, lakes, cool rock formations, shrines"). Every pixel comes from an
already accepted floor, re-laid on the authored 12x12 mask:

- Cinderhold (67-74): ash ground, ash-rock and flagstone road from the accepted
  Lavafront floors (s7, s2, s52, s66), the garrison keep from s99, and each
  sector's landmarks: lava from the s99 lava channel, ruins and beacon towers
  from the s52 ruins, basalt and obsidian from the s99/s66 rock.
- Cinder Foothills (58, s7) and Emberspine Ridge (66, s66): the accepted
  paintings, with the Cinderhold roads and their landmarks painted on cells
  that were already blocked.
- Northroad Saddle (59, s2) and Ashbrook Hills (60, s52), Midlands ground since
  2026-11-11: grass, rock, trees and road from the accepted Midlands floors
  (s44, s45, s62 green; s28, s30 dry), water from the Midlands river (s25) and
  the roped shrine stone from s62. Ashbrook Hills keeps its two reviewed ruins
  (Obsidian North Watch and Obsidian Road Station, shared/sector-buildings.ts)
  as the exact pixels of the accepted s52, so their restoration paintings and
  the frontier carrying frame still lean on the walls they were made for.

    python -I scripts/compose-cinderhold-floors.py <layouts.json> <out-dir> <originals-dir>

<originals-dir> holds the ACCEPTED pre-repaint s2/s7/s52/s66 (for example
`git show 0912393977:shinobij.client/public/sector-map/s7.webp`): they are both
the base paintings for 58/66 and texture sources, and re-running must never
read its own output. Writes s<artKey>-candidate.webp for all twelve floors.
Deterministic: the seed is the sector id.
"""
import io
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
FLOORS = ROOT / 'shinobij.client' / 'public' / 'sector-map'
SIZE = 1024
T = SIZE / 12
MAX_BYTES = 250 * 1024
REPAINTED = (2, 7, 52, 66)        # read from <originals-dir>, never from the tree
ASH_GROUND = [7, 2, 52, 66]
ASH_ROCK = [7, 66]                # natural outcrops only: 2 and 52 carry trees and ruins
STRONGHOLD_SOURCE = 99
LAVA_SOURCE = 99
GREEN_GROUND = [44, 45, 62]
DRY_GROUND = [28, 30]
MIDLANDS_ROCK = [44, 28, 30, 10]
MIDLANDS_TREES = [45, 9, 23, 29, 39, 20]
MIDLANDS_ROAD = 44
MIDLANDS_WATER = 25
VILLAGE_ART = ROOT / 'shinobij.client' / 'art-source' / 'cinderhold-village' / 'compound.webp'
GROUND_PATCH = (171, 171)
ROCK_PATCH = (96, 96)
# Literal pieces of accepted floors (source art, pixel box). See the module doc.
STAMPS = {
    'beacon': (52, (430, 600, 515, 688)),        # the round ember tower's crown
    'beacon-tall': (52, (430, 600, 515, 762)),   # the same tower with its banner
    'fire-shrine': (52, (0, 20, 178, 262)),      # tower, banner and wall
    'machinery': (52, (160, 64, 440, 262)),      # the walled winch and ring
    'hall': (52, (170, 425, 512, 594)),          # the roofed barracks ruin
    'wall': (52, (90, 930, 830, 1012)),          # the long broken wall
    'shrine-stone': (62, (560, 505, 765, 835)),  # the roped stone
    'timber-ruin': (60, (60, 500, 420, 760)),    # the fallen timber hall
    'river': (25, (171, 512, 256, 1024)),        # the Midlands river, rows 6-11
}

ORIGINALS = FLOORS
_cache = {}


def floor(art):
    key = int(art)
    if key not in _cache:
        path = (ORIGINALS if key in REPAINTED else FLOORS) / f's{key}.webp'
        _cache[key] = Image.open(path).convert('RGB')
    return _cache[key]


def cell(mask, t):
    return mask[t // 12][t % 12]


def box(x, y, w=1, h=1, pad=0):
    return (round(x * T) - pad, round(y * T) - pad, round((x + w) * T) + pad, round((y + h) * T) + pad)


def tbox(t, pad=0):
    return box(t % 12, t // 12, 1, 1, pad)


def feather(size, radius):
    w, h = size
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rectangle((radius, radius, w - 1 - radius, h - 1 - radius), fill=255)
    return m.filter(ImageFilter.GaussianBlur(radius / 2))


def variants(img, rng):
    if rng.random() < .5:
        img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if rng.random() < .5:
        img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    return img.rotate(90 * rng.randrange(4)) if img.width == img.height else img


def seeded_noise(rng, size, sigma):
    """Gaussian grain around mid-grey from the sector's own seed (PIL's
    effect_noise reads the C library's rand, so runs would differ)."""
    img = Image.new('L', size)
    img.putdata([max(0, min(255, round(rng.gauss(128, sigma)))) for _ in range(size[0] * size[1])])
    return img


def cells_mask(tiles, pad=0):
    m = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(m)
    for t in tiles:
        d.rectangle(tbox(t, pad), fill=255)
    return m


# ── harvesting ──────────────────────────────────────────────────────────────

def harvest_ground(arts, masks):
    ground = []
    for art in arts:
        img, mask = floor(art), masks[str(art)]['mask']
        for y in range(11):
            for x in range(11):
                if all(mask[y + dy][x + dx] == '.' for dy in (0, 1) for dx in (0, 1)):
                    ground.append(img.crop(box(x, y, 2, 2)).resize(GROUND_PATCH))
    return ground


def harvest_cells(arts, masks, chars, size=ROCK_PATCH, keep=None):
    out = []
    for art in arts:
        img, mask = floor(art), masks[str(art)]['mask']
        for y in range(12):
            for x in range(12):
                if mask[y][x] in chars:
                    patch = img.crop(box(x, y))
                    if keep is None or keep(patch):
                        out.append(patch.resize(size))
    return out


def brightness(img):
    r, g, b = img.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    return (r + g + b) / 3


def obsidian(p):
    """Volcanic glass: the same basalt, harder contrast, a cold sheen."""
    p = ImageEnhance.Contrast(p).enhance(1.7)
    r, g, b = p.split()
    return Image.merge('RGB', (r.point(lambda v: round(v * .6)), g.point(lambda v: round(v * .6)), b.point(lambda v: round(min(255, v * .7 + 4)))))


def water_fraction(img):
    px = img.resize((24, 24)).getdata()
    return sum(1 for r, g, b in px if (b > r + 18 and g > r + 8 and b - r > 45) or (g > r + 25 and b > r + 25)) / 576


def harvest_water(art, masks):
    """Open water from the river's own channel: 48px squares that are all water."""
    img, mask, out = floor(art), masks[str(art)]['mask'], []
    for y in range(12):
        for x in range(12):
            if mask[y][x] != '~':
                continue
            x0, y0, x1, y1 = box(x, y)
            for yy in range(y0, y1 - 47, 12):
                for xx in range(x0 - 20, x1 - 27, 6):
                    patch = img.crop((xx, yy, xx + 48, yy + 48))
                    if water_fraction(patch) > .92:
                        out.append(patch)
    if len(out) < 6:
        raise SystemExit('Not enough open water in s%s' % art)
    return out


def lava_fraction(img):
    px = img.resize((24, 24)).getdata()
    return sum(1 for r, g, b in px if r > g * 1.5 and r > b * 2 and r > 140) / 576


def harvest_lava():
    """Molten texture from the s99 channel: 64px squares that are mostly lava."""
    img, out = floor(LAVA_SOURCE), []
    for y in range(600, SIZE - 64, 24):
        for x in range(0, 700, 24):
            patch = img.crop((x, y, x + 64, y + 64))
            if lava_fraction(patch) > .8:
                out.append(patch)
    if len(out) < 6:
        raise SystemExit('Not enough lava texture in s99')
    return out


def road_strip(art, masks):
    """The longest straight vertical run of road in a floor, one tile wide."""
    img, mask = floor(art), masks[str(art)]['mask']
    best = None
    for x in range(12):
        run = []
        # Board-edge tiles are left out: an accepted mouth may be tinted to
        # its neighbour's road.
        for y in range(1, 11):
            straight = mask[y][x] == '=' and (x == 0 or mask[y][x - 1] != '=') and (x == 11 or mask[y][x + 1] != '=')
            if straight:
                run.append(y)
                if best is None or len(run) > best[2]:
                    best = (x, run[0], len(run))
            else:
                run = []
    x, y0, n = best
    return img.crop(box(x, y0, 1, n))


def stamp(name):
    art, b = STAMPS[name]
    return floor(art).crop(b)


# ── painting primitives ─────────────────────────────────────────────────────

def tile_texture(patches, rng, size=SIZE, fade=None):
    layer = Image.new('RGB', (size, size), (0, 0, 0))
    p0 = patches[0].size[0]
    step = round(p0 * .7)
    fade = fade or feather(patches[0].size, max(4, p0 // 8))
    for gy in range(-p0 // 2, size, step):
        for gx in range(-p0 // 2, size, step):
            layer.paste(variants(rng.choice(patches), rng), (gx + rng.randrange(-6, 7), gy + rng.randrange(-6, 7)), fade)
    return layer


def paint_ground(canvas, ground, rng):
    step = round(T * 1.4)
    fade = feather(ground[0].size, 22)
    for gy in range(-step // 2, SIZE, step):
        for gx in range(-step // 2, SIZE, step):
            patch = variants(rng.choice(ground), rng)
            jitter = (rng.randrange(-18, 19), rng.randrange(-18, 19))
            canvas.paste(patch, (gx + jitter[0], gy + jitter[1]), fade if gx > -step // 2 or gy > -step // 2 else None)


def organic_outline(tiles, mask_ok, rng, lobe=(.52, .64), bridge=(.34, .46)):
    outline = Image.new('L', (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(outline)
    tiles = set(tiles)
    for t in tiles:
        x, y = t % 12, t // 12
        cx, cy = (x + .5) * T + rng.uniform(-6, 6), (y + .5) * T + rng.uniform(-6, 6)
        r = T * rng.uniform(*lobe)
        draw.ellipse((cx - r, cy - r * rng.uniform(.85, 1.05), cx + r, cy + r), fill=255)
        for n, ddx, ddy in ((t + 1, 1, 0), (t + 12, 0, 1)):
            if n in tiles and (ddx == 0 or x < 11):
                w = T * rng.uniform(*bridge)
                draw.rectangle((cx - w if ddx == 0 else cx, cy - w if ddy == 0 else cy,
                                cx + w if ddx == 0 else cx + T, cy + w if ddy == 0 else cy + T), fill=255)
    noise = seeded_noise(rng, (SIZE // 8, SIZE // 8), 90).resize((SIZE, SIZE), Image.Resampling.BICUBIC)
    rough = Image.blend(outline.filter(ImageFilter.GaussianBlur(9)), noise, .28).point(lambda v: 255 if v > 150 else 0)
    return rough.filter(ImageFilter.GaussianBlur(1.6))


def paint_outcrops(canvas, tiles, patches, rng, shadow=(18, 14, 12), ground_tint=(44, 37, 34), lobe=(.52, .64)):
    """Rock or canopy laid over blocked cells, cut by an organic outline."""
    if not tiles:
        return
    soft = feather(patches[0].size, 16)
    layer = Image.new('RGB', (SIZE, SIZE), ground_tint)
    for t in tiles:
        x, y = t % 12, t // 12
        for dx, dy in ((-.3, -.3), (.3, -.3), (-.3, .3), (.3, .3), (0, 0)):
            patch = variants(rng.choice(patches), rng)
            layer.paste(patch, (round((x + .5 + dx) * T - patch.width / 2), round((y + .5 + dy) * T - patch.height / 2)), soft)
    rough = organic_outline(tiles, None, rng, lobe=lobe)
    shade = Image.new('L', (SIZE, SIZE), 0)
    shade.paste(rough.point(lambda v: v * 0.55), (6, 9))
    canvas.paste(shadow, (0, 0), shade.filter(ImageFilter.GaussianBlur(6)))
    canvas.paste(layer, (0, 0), rough)


def inner_shape(tiles, inset, rng, roughness=.3, smooth=22):
    """The union of `tiles`, pulled `inset` px in from every edge that meets a
    non-member cell (a board edge stays open, so a lake or a fall runs off the
    board), then rounded into a natural outline that never leaves the cells."""
    members = set(tiles)
    pad = 40
    big = Image.new('L', (SIZE + 2 * pad, SIZE + 2 * pad), 0)
    d = ImageDraw.Draw(big)
    for t in tiles:
        x, y = t % 12, t // 12
        x0, y0, x1, y1 = tbox(t)
        left = 0 if x == 0 else (0 if t - 1 in members else inset)
        right = 0 if x == 11 else (0 if t + 1 in members else inset)
        top = 0 if y == 0 else (0 if t - 12 in members else inset)
        bottom = 0 if y == 11 else (0 if t + 12 in members else inset)
        d.rectangle((x0 + pad + left - (pad if x == 0 else 0), y0 + pad + top - (pad if y == 0 else 0),
                     x1 + pad - right + (pad if x == 11 else 0), y1 + pad - bottom + (pad if y == 11 else 0)), fill=255)
    noise = seeded_noise(rng, (big.width // 9, big.height // 9), 80).resize(big.size, Image.Resampling.BICUBIC)
    soft = Image.blend(big.filter(ImageFilter.GaussianBlur(smooth)), noise, roughness)
    shape = soft.point(lambda v: 255 if v > 150 else 0).filter(ImageFilter.GaussianBlur(1.5)).crop((pad, pad, pad + SIZE, pad + SIZE))
    return ImageChops.multiply(shape, cells_mask(tiles))


def lava_texture(lava, crust, rng, plates=1):
    """Molten rock with drifting crust plates, like the s99 channel."""
    tex = Image.new('RGB', (SIZE, SIZE))
    for gy in range(0, SIZE, 60):
        for gx in range(0, SIZE, 60):
            tex.paste(variants(rng.choice(lava), rng), (gx, gy))
    fade = feather(lava[0].size, 18)
    for _ in range(2):
        for gy in range(-32, SIZE, 30):
            for gx in range(-32, SIZE, 30):
                tex.paste(variants(rng.choice(lava), rng), (gx + rng.randrange(-10, 11), gy + rng.randrange(-10, 11)), fade)
    noise = seeded_noise(rng, (SIZE // 14, SIZE // 14), 110).resize((SIZE, SIZE), Image.Resampling.BICUBIC)
    cut = 168 if plates else 196
    plates = noise.filter(ImageFilter.GaussianBlur(3)).point(lambda v: 255 if v > cut else 0).filter(ImageFilter.GaussianBlur(2.2))
    tex.paste(crust, (0, 0), plates.point(lambda v: v * .92))
    seams = ImageChops.subtract(plates.filter(ImageFilter.MaxFilter(5)), plates)
    tex.paste((255, 214, 96), (0, 0), seams.point(lambda v: v * .5))
    return tex


def ring(shape, width):
    return ImageChops.subtract(shape, shape.filter(ImageFilter.MinFilter(width * 2 + 1)))


def fill(canvas, shape, texture, blur=1.2):
    canvas.paste(texture, (0, 0), shape.filter(ImageFilter.GaussianBlur(blur)))


def lava_body(canvas, shape, lava, crust, rng, clip, rocks=None, narrow=False):
    tex = lava_texture(lava, crust, rng, plates=.0 if narrow else 1)
    # A soft heat glow on the surrounding rock only (clip = blocked cells).
    glow = ImageChops.multiply(shape.filter(ImageFilter.MaxFilter(13)).filter(ImageFilter.GaussianBlur(12)), clip)
    canvas.paste((206, 78, 24), (0, 0), glow.point(lambda v: v * .45))
    fill(canvas, shape, tex)
    edge = ring(shape, 4 if narrow else 7).filter(ImageFilter.GaussianBlur(2.5))
    canvas.paste(crust, (0, 0), edge)
    if not narrow:
        inner = ImageChops.subtract(ring(shape, 16), ring(shape, 7)).filter(ImageFilter.GaussianBlur(4))
        canvas.paste((120, 40, 14), (0, 0), inner.point(lambda v: v * .35))
    if rocks:
        shore(canvas, shape, rocks, rng, clip)


def shore(canvas, shape, rocks, rng, clip, every=46, size=(8, 14)):
    """Boulders along a liquid's edge, inside the blocked cells."""
    edge = ring(shape, 3)
    px = edge.load()
    clip_px = clip.load()
    pts = [(x, y) for y in range(0, SIZE, 6) for x in range(0, SIZE, 6) if px[x, y] > 128 and clip_px[x, y] > 128]
    rng.shuffle(pts)
    placed = []
    for x, y in pts:
        if all((x - a) ** 2 + (y - b) ** 2 > every ** 2 for a, b in placed):
            placed.append((x, y))
            r = rng.uniform(*size)
            stone(canvas, x, y, r, r * rng.uniform(.7, .9), rocks, rng, rng.uniform(.8, 1.0))


def water_body(canvas, shape, water, stones, rng, rocks=None, clip=None):
    tex = tile_texture(water, rng)
    fill(canvas, shape, tex)
    shade = ImageChops.subtract(shape, shape.transform(shape.size, Image.Transform.AFFINE, (1, 0, 0, 0, 1, 10)))
    canvas.paste((14, 30, 32), (0, 0), shade.filter(ImageFilter.GaussianBlur(5)).point(lambda v: v * .6))
    rim = ring(shape, 6).filter(ImageFilter.GaussianBlur(1.5))
    canvas.paste(stones, (0, 0), rim.point(lambda v: v * .9))
    if rocks and clip is not None:
        shore(canvas, shape, rocks, rng, clip, every=78, size=(6, 10))


def path_shape(tiles, width, rng, extend_edges=True):
    """A channel along member cells (joined to member neighbours)."""
    m = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(m)
    tiles = list(tiles)
    members = set(tiles)
    centre = {t: ((t % 12 + .5) * T + rng.uniform(-5, 5), (t // 12 + .5) * T + rng.uniform(-5, 5)) for t in tiles}
    w = round(width)
    for t in tiles:
        cx, cy = centre[t]
        d.ellipse((cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2), fill=255)
        for n in (t + 1, t + 12):
            if n in members and (n != t + 1 or t % 12 < 11):
                d.line((cx, cy) + centre[n], fill=255, width=w)
        if extend_edges:
            if t % 12 == 0:
                d.line((cx, cy, -20, cy), fill=255, width=w)
            if t % 12 == 11:
                d.line((cx, cy, SIZE + 20, cy), fill=255, width=w)
            if t < 12:
                d.line((cx, cy, cx, -20), fill=255, width=w)
            if t >= 132:
                d.line((cx, cy, cx, SIZE + 20), fill=255, width=w)
    noise = seeded_noise(rng, (SIZE // 10, SIZE // 10), 80).resize((SIZE, SIZE), Image.Resampling.BICUBIC)
    return Image.blend(m.filter(ImageFilter.GaussianBlur(6)), noise, .25).point(lambda v: 255 if v > 128 else 0)


def foam(canvas, shape, rng, vertical=True, colour=(232, 240, 236), strength=.55):
    layer = Image.new('L', (SIZE, SIZE), 0)
    d = ImageDraw.Draw(layer)
    bbox = shape.getbbox()
    if not bbox:
        return
    x0, y0, x1, y1 = bbox
    for _ in range(int((x1 - x0) * (y1 - y0) / 140)):
        x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
        n = rng.uniform(8, 26)
        d.line((x, y, x, y + n) if vertical else (x, y, x + n, y), fill=rng.randrange(120, 255), width=rng.choice((1, 2, 2, 3)))
    layer = ImageChops.multiply(layer.filter(ImageFilter.GaussianBlur(1.2)), ImageChops.subtract(shape, ring(shape, 3)))
    canvas.paste(colour, (0, 0), layer.point(lambda v: v * strength))


def paste_stamp(canvas, art, dest, alpha, angle=0, shadow=True):
    """Scale a literal piece of an accepted floor into `dest` (pixel box),
    shown only where `alpha` (canvas-sized) allows."""
    x0, y0, x1, y1 = dest
    piece = art.rotate(angle, expand=True) if angle else art
    piece = piece.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS)
    a = alpha.crop(dest)
    if shadow:
        sh = Image.new('L', canvas.size, 0)
        sh.paste(a.point(lambda v: v * .55), (x0 + 5, y0 + 8))
        canvas.paste((16, 12, 10), (0, 0), ImageChops.multiply(sh.filter(ImageFilter.GaussianBlur(5)), alpha.filter(ImageFilter.MaxFilter(9))))
    canvas.paste(piece, (x0, y0), a)


def tiles_box(tiles, pad=0):
    xs = [t % 12 for t in tiles]
    ys = [t // 12 for t in tiles]
    return box(min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1, pad)


def clear_cells(canvas, tiles, ground, rng):
    """Re-lay plain ground under a free-standing landmark (cairn, stones)."""
    fade = feather(ground[0].size, 22)
    for t in tiles:
        x0, y0, x1, y1 = tbox(t)
        patch = variants(rng.choice(ground), rng).resize((x1 - x0 + 40, y1 - y0 + 40))
        alpha = Image.new('L', patch.size, 0)
        ImageDraw.Draw(alpha).ellipse((10, 10, patch.width - 10, patch.height - 10), fill=255)
        canvas.paste(patch, (x0 - 20, y0 - 20), alpha.filter(ImageFilter.GaussianBlur(8)))


def stone(canvas, cx, cy, rx, ry, patches, rng, light=1.0, shadow=(14, 12, 10)):
    """One rounded stone of real rock texture with a cast shadow."""
    size = (round(rx * 2) + 4, round(ry * 2) + 4)
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).ellipse((2, 2, size[0] - 2, size[1] - 2), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(1.2))
    tex = variants(rng.choice(patches), rng).resize(size)
    if light != 1.0:
        tex = tex.point(lambda v: min(255, round(v * light)))
    sh = Image.new('L', canvas.size, 0)
    sh.paste(m.point(lambda v: v * .6), (round(cx - rx) + 6, round(cy - ry) + 9))
    canvas.paste(shadow, (0, 0), sh.filter(ImageFilter.GaussianBlur(5)))
    # top-left light, bottom-right shade
    hl = Image.new('L', size, 0)
    ImageDraw.Draw(hl).ellipse((2, 2, size[0] * .7, size[1] * .6), fill=90)
    tex.paste((255, 250, 235), (0, 0), ImageChops.multiply(hl.filter(ImageFilter.GaussianBlur(size[0] / 6)), m).point(lambda v: v * .35))
    canvas.paste(tex, (round(cx - rx), round(cy - ry)), m)


# ── roads ───────────────────────────────────────────────────────────────────

def road_tile(strip, horizontal, rng):
    tile = round(T)
    top = rng.randrange(0, max(1, strip.height - tile))
    piece = strip.crop((0, top, strip.width, top + tile)).resize((tile, tile))
    if rng.random() < .5:
        piece = piece.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    return piece.rotate(90, expand=True) if horizontal else piece


def paint_roads(canvas, mask, tiles, strip, rng, edge=(58, 50, 42)):
    draw = ImageDraw.Draw(canvas)
    for t in tiles:
        x, y = t % 12, t // 12
        road = lambda n: 0 <= n < 144 and cell(mask, n) == '='
        up, down = road(t - 12), road(t + 12)
        left, right = x > 0 and road(t - 1), x < 11 and road(t + 1)
        horizontal = (left or right) and not (up or down)
        x0, y0, x1, y1 = box(x, y)
        canvas.paste(road_tile(strip, horizontal, rng).resize((x1 - x0, y1 - y0)), (x0, y0))
    for t in tiles:
        x, y = t % 12, t // 12
        x0, y0, x1, y1 = box(x, y)
        if y > 0 and cell(mask, t - 12) != '=':
            draw.line((x0, y0, x1, y0), fill=edge, width=2)
        if y < 11 and cell(mask, t + 12) != '=':
            draw.line((x0, y1 - 1, x1, y1 - 1), fill=edge, width=2)
        if x > 0 and cell(mask, t - 1) != '=':
            draw.line((x0, y0, x0, y1), fill=edge, width=2)
        if x < 11 and cell(mask, t + 1) != '=':
            draw.line((x1 - 1, y0, x1 - 1, y1), fill=edge, width=2)


def band_box(direction, tile):
    lane = tile % 12 if direction in ('north', 'south') else tile // 12
    lo, hi, d = round(lane * T), round((lane + 1) * T), round(T / 2)
    return {'north': (lo, 0, hi, d), 'south': (lo, SIZE - d, hi, SIZE),
            'west': (0, lo, d, hi), 'east': (SIZE - d, lo, SIZE, hi)}[direction]


def mean_rgb(img, b):
    c = img.crop(b).resize((1, 1), Image.Resampling.BOX)
    return c.getpixel((0, 0))


def match_mouths(canvas, layout, neighbours):
    """Ease each road mouth toward the colour of the road it meets next door,
    fading to nothing a tile inward, so the seam reads as one road."""
    for e in layout['exits']:
        other = neighbours.get(e['destination'])
        if other is None:
            continue
        img, exit_tile, direction = other
        target = mean_rgb(img, band_box(direction, exit_tile))
        here = band_box(e['direction'], e['tile'])
        mine = mean_rgb(canvas, here)
        delta = [target[i] - mine[i] for i in range(3)]
        x0, y0, x1, y1 = tbox(e['tile'])
        piece = canvas.crop((x0, y0, x1, y1))
        w, h = piece.size
        ramp = Image.new('L', (w, h), 0)
        px = ramp.load()
        for yy in range(h):
            for xx in range(w):
                depth = {'north': yy, 'south': h - 1 - yy, 'west': xx, 'east': w - 1 - xx}[e['direction']] / (w - 1)
                px[xx, yy] = round(255 * max(0, 1 - depth))
        shifted = Image.merge('RGB', [ch.point(lambda v, d=delta[i]: max(0, min(255, v + d))) for i, ch in enumerate(piece.split())])
        canvas.paste(Image.composite(shifted, piece, ramp), (x0, y0))


# ── buildings ───────────────────────────────────────────────────────────────

def stronghold_art(masks):
    img = floor(STRONGHOLD_SOURCE)
    x, y, n = SOURCE_LAYOUTS[str(STRONGHOLD_SOURCE)]['sites']['stronghold']['footprint']
    crop = img.crop(box(x, y, n, n))
    w, h = crop.size
    return crop.crop((round(w * .02), round(h * .02), round(w * .98), round(h * .96)))


def paint_stronghold(canvas, site, keep):
    x, y, n = site['footprint']
    x0, y0, x1, y1 = box(x, y, n, n)
    art = keep.resize((x1 - x0 + 4, y1 - y0 + 4), Image.Resampling.LANCZOS)
    shadow = Image.new('L', art.size, 0)
    ImageDraw.Draw(shadow).rectangle((6, 10, art.width - 2, art.height - 1), fill=150)
    canvas.paste((20, 16, 14), (x0 - 2 + 5, y0 - 2 + 7), shadow.filter(ImageFilter.GaussianBlur(5)))
    canvas.paste(art, (x0 - 2, y0 - 2), feather(art.size, 3))


def paint_village(canvas):
    village = Image.open(VILLAGE_ART).convert('RGBA')
    x0, y0, x1, y1 = box(4, 4, 4, 4)
    inset, foot = 9, 3
    art = village.resize((x1 - x0 - 2 * inset, y1 - y0 - inset - foot), Image.Resampling.LANCZOS)
    ax, ay = x0 + inset, y0 + inset
    shadow = Image.new('L', canvas.size, 0)
    shadow.paste(art.getchannel('A').point(lambda v: v * 0.6), (ax + 7, ay + 10))
    canvas.paste((16, 12, 10), (0, 0), shadow.filter(ImageFilter.GaussianBlur(7)))
    canvas.paste(art, (ax, ay), art)


# ── landmarks ───────────────────────────────────────────────────────────────

class Kit:
    pass


def landmark(canvas, mark, mask, kit, rng):
    kind, tiles = mark['kind'], mark['tiles']
    blocked = cells_mask([t for t in range(144) if cell(mask, t) not in '.='])
    members = cells_mask(tiles)
    if kind in ('lava-lake', 'lava-fissure'):
        shape = inner_shape(tiles, 22 if kind == 'lava-lake' else 18, rng)
        lava_body(canvas, shape, kit.lava, kit.crust, rng, blocked, kit.rock, narrow=kind == 'lava-fissure')
    elif kind in ('lava-fall', 'slag-channel'):
        vertical = [t for t in tiles if t % 12 == tiles[0] % 12 and t < 132] if kind == 'lava-fall' else []
        shape = inner_shape(tiles, 34 if kind == 'lava-fall' else 21, rng, smooth=16)
        lava_body(canvas, shape, kit.lava, kit.crust, rng, blocked, kit.rock)
        if vertical:
            foam(canvas, ImageChops.multiply(shape, cells_mask(vertical)), rng, colour=(255, 222, 130), strength=.5)
    elif kind == 'lava-cistern':
        outer = ImageChops.multiply(cells_mask(tiles, 0).filter(ImageFilter.MinFilter(13)), members)
        x0, y0, x1, y1 = outer.getbbox()
        sh = Image.new('L', canvas.size, 0)
        ImageDraw.Draw(sh).rectangle((x0 + 6, y0 + 9, x1 + 6, y1 + 9), fill=150)
        canvas.paste((14, 10, 8), (0, 0), sh.filter(ImageFilter.GaussianBlur(6)))
        walls = tile_texture(kit.wall, rng)
        canvas.paste(walls, (0, 0), outer)
        inner = Image.new('L', canvas.size, 0)
        ImageDraw.Draw(inner).rectangle((x0 + 22, y0 + 22, x1 - 22, y1 - 22), fill=255)
        lava_body(canvas, inner, kit.lava, kit.crust, rng, outer)
        d = ImageDraw.Draw(canvas)
        for cx, cy in ((x0 + 11, y0 + 11), (x1 - 11, y0 + 11), (x0 + 11, y1 - 11), (x1 - 11, y1 - 11)):
            d.rectangle((cx - 9, cy - 9, cx + 9, cy + 9), fill=(46, 38, 34), outline=(24, 18, 16), width=2)
        # a beacon crown on the cistern's north corners
        crown = stamp('beacon')
        for cx in (x0 + 11, x1 - 11):
            paste_stamp(canvas, crown, (cx - 20, y0 - 8, cx + 20, y0 + 32), Image.new('L', canvas.size, 255), shadow=False)
    elif kind == 'steam-vent':
        for t in tiles:
            x0, y0, x1, y1 = tbox(t)
            cx, cy = (x0 + x1) / 2 + rng.uniform(-6, 6), (y0 + y1) / 2 + rng.uniform(-4, 8)
            # scorched ground around the vent
            scorch = Image.new('L', canvas.size, 0)
            ImageDraw.Draw(scorch).ellipse((cx - 38, cy - 34, cx + 38, cy + 34), fill=170)
            canvas.paste((30, 24, 20), (0, 0), ImageChops.multiply(scorch.filter(ImageFilter.GaussianBlur(9)), members))
            for k in range(9):
                a = k / 9 * 6.283 + rng.uniform(-.25, .25)
                stone(canvas, cx + 29 * math.cos(a), cy + 24 * math.sin(a), rng.uniform(11, 16), rng.uniform(9, 13), kit.basalt, rng, 1.0)
            pit = Image.new('L', canvas.size, 0)
            ImageDraw.Draw(pit).ellipse((cx - 21, cy - 17, cx + 21, cy + 17), fill=255)
            canvas.paste((16, 11, 9), (0, 0), pit.filter(ImageFilter.GaussianBlur(2)))
            core = Image.new('L', canvas.size, 0)
            ImageDraw.Draw(core).ellipse((cx - 11, cy - 8, cx + 11, cy + 8), fill=255)
            fill(canvas, core, lava_texture(kit.lava, kit.crust, rng), 3)
            plume = Image.new('L', canvas.size, 0)
            pd = ImageDraw.Draw(plume)
            for k in range(20):
                r = rng.uniform(10, 24)
                px_, py_ = cx + rng.uniform(-16, 16) + k * .8, cy - 4 - k * 2.2 + rng.uniform(-6, 6)
                pd.ellipse((px_ - r, py_ - r, px_ + r, py_ + r), fill=rng.randrange(90, 180))
            plume = ImageChops.multiply(plume.filter(ImageFilter.GaussianBlur(6)), cells_mask([t], 4).filter(ImageFilter.GaussianBlur(5)))
            canvas.paste((226, 224, 218), (0, 0), plume.point(lambda v: v * .85))
    elif kind in ('basalt', 'obsidian'):
        patches = kit.basalt if kind == 'basalt' else kit.obsidian
        paint_outcrops(canvas, tiles, patches, rng, shadow=(10, 8, 8), lobe=(.5, .6))
        if kind == 'basalt':
            # stepped ledges: a hard shadow on the down-slope edge of each cell
            sh = Image.new('L', canvas.size, 0)
            d = ImageDraw.Draw(sh)
            for t in tiles:
                x0, y0, x1, y1 = tbox(t)
                d.rectangle((x0 + 8, y1 - 16, x1 - 8, y1 - 8), fill=150)
            canvas.paste((12, 10, 9), (0, 0), ImageChops.multiply(sh.filter(ImageFilter.GaussianBlur(3)), members.filter(ImageFilter.MinFilter(9))))
        else:
            gl = Image.new('L', canvas.size, 0)
            d = ImageDraw.Draw(gl)
            for t in tiles:
                x0, y0, x1, y1 = tbox(t)
                for _ in range(5):
                    gx, gy = rng.uniform(x0 + 16, x1 - 16), rng.uniform(y0 + 16, y1 - 16)
                    d.line((gx, gy, gx + rng.uniform(6, 16), gy - rng.uniform(4, 12)), fill=200, width=2)
            canvas.paste((176, 168, 214), (0, 0), ImageChops.multiply(gl.filter(ImageFilter.GaussianBlur(1)), members.filter(ImageFilter.MinFilter(15))).point(lambda v: v * .55))
    elif kind == 'ruin':
        dest = tiles_box(tiles)
        w, h = (dest[2] - dest[0]) / T, (dest[3] - dest[1]) / T
        alpha = members.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(6))
        if kit.midlands:
            piece = stamp('timber-ruin')
        elif h >= 2 and w >= 2.5:
            piece = stamp('hall')
        elif h >= w * 2:
            piece, dest = stamp('wall').crop((0, 0, round(T * h), 82)), dest
            paste_stamp(canvas, piece, dest, alpha, angle=90)
            return
        elif w >= 3:
            piece = stamp('wall').crop((0, 0, round(T * w * 1.05), 82))
        else:
            piece = stamp('machinery')
        paste_stamp(canvas, piece, dest, alpha)
    elif kind == 'beacon':
        for group in groups(tiles):
            dest = tiles_box(group)
            square = len(group) == 1
            piece = stamp('beacon') if square else stamp('fire-shrine')
            alpha = cells_mask(group).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(2))
            if square:
                x0, y0, x1, y1 = dest
                dest = (x0 + 6, y0 + 4, x1 - 6, y1 - 2)
            paste_stamp(canvas, piece, dest, alpha)
    elif kind == 'cairn':
        for t in tiles:
            x0, y0, x1, y1 = tbox(t)
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 + 6
            # a waymarker cairn: a ring of footing stones and a stack of four
            for k in range(7):
                a = k / 7 * 6.283
                stone(canvas, cx + 30 * math.cos(a), cy + 4 + 24 * math.sin(a), 9, 7, kit.pale, rng, .9)
            for r, dy, light in ((27, 8, .85), (21, -8, .95), (15, -21, 1.05), (10, -31, 1.15)):
                stone(canvas, cx + rng.uniform(-3, 3), cy + dy, r, r * .78, kit.pale, rng, light)
    elif kind == 'standing-stones':
        for t in tiles:
            x0, y0, x1, y1 = tbox(t)
            cx, cy = (x0 + x1) / 2 + rng.uniform(-6, 6), (y0 + y1) / 2 + rng.uniform(-4, 4)
            stone(canvas, cx, cy, rng.uniform(18, 22), rng.uniform(28, 33), kit.rock, rng, 1.2)
            for _ in range(2):
                stone(canvas, cx + rng.choice((-1, 1)) * rng.uniform(22, 30), cy + rng.uniform(10, 24), rng.uniform(7, 10), rng.uniform(6, 8), kit.rock, rng, 1.05)
    elif kind == 'shrine-stone':
        for t in tiles:
            x0, y0, x1, y1 = tbox(t)
            piece = stamp('shrine-stone')
            enclosed = all(0 <= n < 144 and cell(mask, n) not in '.=' for n in (t - 12, t + 12, t - 1, t + 1))
            w = round(T * (1.45 if enclosed else 1.0))
            h = round(w * piece.height / piece.width)
            cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
            dest = (cx - w // 2, cy - h // 2, cx - w // 2 + w, cy - h // 2 + h)
            alpha = Image.new('L', canvas.size, 0)
            ImageDraw.Draw(alpha).ellipse((dest[0] + 8, dest[1] + 4, dest[2] - 8, dest[3] - 4), fill=255)
            paste_stamp(canvas, piece, dest, ImageChops.multiply(alpha.filter(ImageFilter.GaussianBlur(8)), blocked.filter(ImageFilter.MaxFilter(1))))
    elif kind == 'ruin-in-place':
        # A reviewed ruin kept exactly where the accepted floor painted it.
        alpha = members.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.GaussianBlur(7))
        dest = tiles_box(tiles)
        paste_stamp(canvas, floor(kit.art).crop(dest), dest, alpha, shadow=False)
    elif kind == 'pond':
        shape = inner_shape(tiles, 14, rng)
        water_body(canvas, shape, kit.water, kit.stones, rng, kit.rock, blocked)
    elif kind in ('waterfall', 'brook'):
        # The running water is the Midlands river itself (s25, one tile wide
        # with its own banks), laid along the vertical cells; it spills into a
        # pool of the same water.
        vertical = mark.get('fall') or [t for t in tiles if t % 12 == tiles[0] % 12 and t < 132]
        pool = [t for t in tiles if t not in vertical]
        basin = inner_shape(pool, 11, rng)
        water_body(canvas, basin, kit.water, kit.stones, rng, kit.rock, blocked)
        river = stamp('river').crop((0, 0, round(T), round(T * len(vertical))))
        dest = tiles_box(vertical)
        if pool:
            last = vertical[-1]
            joined = pool[0]
            if joined == last + 12:
                dest = (dest[0], dest[1], dest[2], dest[3] + round(T * .45))
        alpha = Image.new('L', canvas.size, 0)
        ImageDraw.Draw(alpha).rectangle((dest[0] + 4, dest[1] - (0 if vertical[0] < 12 else 4), dest[2] - 4, dest[3]), fill=255)
        paste_stamp(canvas, river, dest, alpha.filter(ImageFilter.GaussianBlur(4)), shadow=False)
        if vertical[0] >= 12:
            # the spring: the water breaks out of a heap of rock
            for _ in range(6):
                stone(canvas, rng.uniform(dest[0] + 10, dest[2] - 10), dest[1] + rng.uniform(4, 22), rng.uniform(12, 18), rng.uniform(9, 13), kit.rock, rng, 1.15)
        if kind == 'waterfall':
            fall = ImageChops.multiply(cells_mask(vertical), Image.new('L', canvas.size, 255))
            band = Image.new('L', canvas.size, 0)
            ImageDraw.Draw(band).rectangle((dest[0] + 26, dest[1], dest[2] - 26, dest[3]), fill=255)
            foam(canvas, ImageChops.multiply(fall, band.filter(ImageFilter.GaussianBlur(6))), rng, strength=.6)
        if pool:
            foam(canvas, ImageChops.multiply(basin, cells_mask(pool[:1])), rng, vertical=False, strength=.3)
    else:
        raise SystemExit('Unknown landmark ' + kind)


def groups(tiles):
    left, out = set(tiles), []
    for t in tiles:
        if t not in left:
            continue
        g, q = [], [t]
        left.discard(t)
        while q:
            n = q.pop()
            g.append(n)
            for m in (n - 12, n + 12, n - 1 if n % 12 else -1, n + 1 if n % 12 < 11 else -1):
                if m in left:
                    left.discard(m)
                    q.append(m)
        out.append(sorted(g))
    return out


# ── whole floors ────────────────────────────────────────────────────────────

FREE_STANDING = ('cairn', 'standing-stones', 'shrine-stone', 'beacon', 'ruin', 'lava-cistern', 'steam-vent')


def compose_cinderhold(layout, marks, kit, rng):
    canvas = Image.new('RGB', (SIZE, SIZE), (70, 60, 52))
    paint_ground(canvas, kit.ground, rng)
    mask = layout['mask']
    special = {t for m in marks for t in m['tiles']}
    rock = [t for t in range(144) if cell(mask, t) in '#T' and t not in special]
    # Lava sits in a rock bed: lakes, fissures and channels get the ash-rock
    # outcrop under them first, so their rims read as natural stone.
    bedded = [t for m in marks if m['kind'] in ('lava-lake', 'lava-fissure', 'lava-fall', 'slag-channel') for t in m['tiles']]
    paint_outcrops(canvas, rock + bedded, kit.rock, rng)
    for m in marks:
        landmark(canvas, m, mask, kit, rng)
    paint_roads(canvas, mask, [t for t in range(144) if cell(mask, t) == '='], kit.strip, rng)
    bridge(canvas, layout, marks)
    site = layout['sites'].get('stronghold')
    if site:
        paint_stronghold(canvas, site, kit.keep)
    if layout.get('village'):
        paint_village(canvas)
    return canvas


def bridge(canvas, layout, marks):
    """Where a slag channel passes under the road, parapets on both kerbs."""
    mask = layout['mask']
    channel = {t for m in marks if m['kind'] == 'slag-channel' for t in m['tiles']}
    d = ImageDraw.Draw(canvas)
    for t in range(144):
        if cell(mask, t) != '=':
            continue
        x0, y0, x1, y1 = tbox(t)
        if t - 12 in channel and t + 12 in channel:
            for yy in (y0 + 2, y1 - 9):
                d.rectangle((x0 - 4, yy, x1 + 4, yy + 7), fill=(52, 44, 40), outline=(22, 17, 15), width=2)
                for xx in (x0 - 4, x1 - 4):
                    d.rectangle((xx, yy - 3, xx + 9, yy + 10), fill=(64, 54, 48), outline=(22, 17, 15), width=2)


def compose_lavafront(art, entry, kit, rng):
    canvas = floor(art).copy()
    layout = entry['layout']
    strip = road_strip(art, SOURCE_LAYOUTS)
    for m in entry['landmarks']:
        if m['kind'] in FREE_STANDING:
            clear_cells(canvas, m['tiles'], kit.ground, rng) if m['kind'] in ('cairn',) else None
        landmark(canvas, m, layout['mask'], kit, rng)
    if entry['carved']:
        # The accepted painting has rock or ground under the new road; repaint
        # those tiles plus a tile of road either side so the joins are clean.
        mask = layout['mask']
        tiles = set(entry['carved'])
        for t in entry['carved']:
            for n in (t - 12, t + 12, t - 1, t + 1):
                if 0 <= n < 144 and abs(n % 12 - t % 12) <= 1 and cell(mask, n) == '=':
                    tiles.add(n)
        paint_roads(canvas, mask, sorted(tiles), strip, rng)
    return canvas


def compose_midlands(art, entry, kit, rng):
    layout = entry['layout']
    mask = layout['mask']
    canvas = Image.new('RGB', (SIZE, SIZE), (96, 98, 62))
    paint_ground(canvas, kit.ground, rng)
    special = {t for m in entry['landmarks'] for t in m['tiles'] if m['kind'] in ('standing-stones', 'shrine-stone', 'ruin-in-place')}
    kit.art = art
    rock = [t for t in range(144) if cell(mask, t) == '#' and t not in special]
    trees = [t for t in range(144) if cell(mask, t) == 'T']
    paint_outcrops(canvas, rock, kit.rock, rng, shadow=(30, 32, 22), ground_tint=(70, 72, 60))
    paint_outcrops(canvas, trees, kit.trees, rng, shadow=(20, 30, 14), ground_tint=(40, 58, 30), lobe=(.55, .68))
    for m in entry['landmarks']:
        landmark(canvas, m, mask, kit, rng)
    paint_roads(canvas, mask, [t for t in range(144) if cell(mask, t) == '='], kit.strip, rng, edge=(84, 80, 66))
    return canvas


GEAR_AREA = (400, 460, 510, 600)   # shared/frontier-work-art-review.json, sector 60


def rebake_frontier_gear(new_floor):
    """Ashbrook Hills (60) carries the reviewed frontier painting
    lavafront-road-gear-v1: the accepted s52 with the scout's damaged carrying
    frame leaned on the ruin by tile 77. The frame is lifted off the accepted
    painting by its difference from the accepted s52 (inside the reviewed area
    only) and leaned on the same ruin cells of the repaint; nothing outside the
    area changes."""
    gear = Image.open(ORIGINALS / 'lavafront-road-gear-v1.webp').convert('RGB')
    base = floor(52)
    diff = ImageChops.difference(gear.crop(GEAR_AREA), base.crop(GEAR_AREA)).convert('L')
    alpha = diff.point(lambda v: 255 if v > 34 else 0).filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.5))
    out = new_floor.copy()
    out.paste(gear.crop(GEAR_AREA), GEAR_AREA[:2], alpha)
    full = ImageChops.difference(out, new_floor)
    full.paste((0, 0, 0), GEAR_AREA)
    if full.getbbox():
        raise SystemExit('frontier gear changed terrain outside its reviewed area')
    return out


def save_webp(img, path, budget=MAX_BYTES):
    for quality in (86, 82, 80, 78, 76, 74, 72, 70, 68, 66, 64, 62, 60):
        buf = io.BytesIO()
        img.save(buf, 'WEBP', quality=quality, method=6)
        if buf.tell() <= budget:
            path.write_bytes(buf.getvalue())
            return quality, buf.tell()
    raise SystemExit(f'{path.name} cannot fit {budget} bytes')


SOURCE_LAYOUTS = {}


def main():
    global ORIGINALS, SOURCE_LAYOUTS
    source = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    out = Path(sys.argv[2])
    ORIGINALS = Path(sys.argv[3])
    budgets = json.loads(Path(sys.argv[4]).read_text(encoding='utf-8')) if len(sys.argv) > 4 else {}
    out.mkdir(parents=True, exist_ok=True)
    SOURCE_LAYOUTS = json.loads((ROOT / 'shared' / 'sector-floor-layout-data.json').read_text(encoding='utf-8'))['layouts']
    # Texture sources read the ACCEPTED masks of the repainted floors.
    for art, entry in source['repaints'].items():
        SOURCE_LAYOUTS[art] = {**SOURCE_LAYOUTS[art], 'mask': entry['accepted']}

    ash = Kit()
    ash.midlands = False
    ash.ground = harvest_ground(ASH_GROUND, SOURCE_LAYOUTS)
    ash.rock = harvest_cells(ASH_ROCK, SOURCE_LAYOUTS, '#')
    ash.basalt = harvest_cells([99, 66], SOURCE_LAYOUTS, '#', keep=lambda p: lava_fraction(p) < .03 and brightness(p) < 92)
    ash.obsidian = [obsidian(p) for p in ash.basalt]
    # pale weathered stone (the s99 crags) for cairns
    ash.pale = harvest_cells([99], SOURCE_LAYOUTS, '#', keep=lambda p: lava_fraction(p) < .03 and brightness(p) >= 92)
    ash.lava = harvest_lava()
    ash.crust = tile_texture([p.point(lambda v: round(v * .55)) for p in ash.rock], random.Random(7))
    ash.wall = harvest_cells([52], SOURCE_LAYOUTS, '#', (64, 64), keep=lambda p: lava_fraction(p) < .05)[::2]
    ash.strip = road_strip(7, SOURCE_LAYOUTS)
    ash.keep = stronghold_art(SOURCE_LAYOUTS)

    def midlands_kit(ground):
        k = Kit()
        k.midlands = True
        k.ground = harvest_ground(ground, SOURCE_LAYOUTS)
        k.rock = harvest_cells(MIDLANDS_ROCK, SOURCE_LAYOUTS, '#')
        k.trees = harvest_cells(MIDLANDS_TREES, SOURCE_LAYOUTS, 'T')
        k.water = harvest_water(MIDLANDS_WATER, SOURCE_LAYOUTS)
        k.stones = tile_texture(k.rock, random.Random(11))
        k.strip = road_strip(MIDLANDS_ROAD, SOURCE_LAYOUTS)
        k.lava, k.crust = ash.lava, ash.crust
        return k

    green, dry = midlands_kit(GREEN_GROUND), midlands_kit(DRY_GROUND)
    report, done = {}, {}
    batch = {l['sector'] for l in source['layouts'].values()} | {e['layout']['sector'] for e in source['repaints'].values()}

    def neighbours_for(layout):
        out_ = {}
        for e in layout['exits']:
            dest = e['destination']
            if dest in done:
                img, lay = done[dest]
            elif dest in batch:
                continue  # painted later from the same road strip
            else:
                lay = next((l for l in SOURCE_LAYOUTS.values() if l['sector'] == dest), None)
                if lay is None:
                    continue
                img = floor(lay['artKey'])
            back = next((x for x in lay['exits'] if x['destination'] == layout['sector']), None)
            if back:
                out_[dest] = (img, back['tile'], back['direction'])
        return out_

    def finish(art, layout, img, budget):
        match_mouths(img, layout, neighbours_for(layout))
        done[layout['sector']] = (img, layout)
        report[art] = save_webp(img, out / f's{art}-candidate.webp', budget)

    for art, entry in source['repaints'].items():
        if entry['mode'] != 'lavafront':
            continue
        rng = random.Random(int(entry['layout']['sector']) * 104729)
        img = compose_lavafront(int(art), entry, ash, rng)
        finish(art, entry['layout'], img, budgets.get(art, (ORIGINALS / f's{art}.webp').stat().st_size))
    for art, layout in source['layouts'].items():
        rng = random.Random(int(layout['sector']) * 7919)
        img = compose_cinderhold(layout, source['landmarks'].get(art, []), ash, rng)
        finish(art, layout, img, budgets.get(art, 205 * 1024))
    for art, entry in source['repaints'].items():
        if entry['mode'] != 'midlands':
            continue
        rng = random.Random(int(entry['layout']['sector']) * 15485863)
        img = compose_midlands(int(art), entry, green if entry['layout']['sector'] == 59 else dry, rng)
        finish(art, entry['layout'], img, budgets.get(art, (ORIGINALS / f's{art}.webp').stat().st_size))
        if art == '52':
            # The gear painting is the DELIVERED floor plus the frame.
            delivered = Image.open(out / 's52-candidate.webp').convert('RGB')
            gear_budget = (ORIGINALS / 'lavafront-road-gear-v1.webp').stat().st_size
            report['lavafront-road-gear-v1'] = save_webp(rebake_frontier_gear(delivered), out / 'lavafront-road-gear-v1-candidate.webp', gear_budget)
    print(json.dumps({'floors': report}, indent=1))


if __name__ == '__main__':
    main()
