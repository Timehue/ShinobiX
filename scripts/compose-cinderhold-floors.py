"""Native composition of Cinderhold's floor paintings (2026-11-08).

Owner-authorized method (docs/handoffs/connected-sector-world-work-state.md,
"compose and bake the finished maps"): every pixel comes from an already
accepted volcano floor, re-laid on the authored 12x12 mask, so ground, ash-rock,
flagstone road and the stronghold read exactly like the Lavafront they join.

    python -I scripts/compose-cinderhold-floors.py <layouts.json> <out-dir>

Writes s<artKey>-candidate.webp for 67-74 plus the two patched Lavafront floors
(s7, s66) with their new climbs. Deterministic: the seed is the sector id.
"""
import io
import json
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
FLOORS = ROOT / 'shinobij.client' / 'public' / 'sector-map'
SIZE = 1024
T = SIZE / 12
MAX_BYTES = 250 * 1024
SOURCES = [7, 2, 52, 66]          # the accepted Lavafront/Emberspine floors (ground)
ROCK_SOURCES = [7, 66]            # natural outcrops only: 2 and 52 carry ruins and props
STRONGHOLD_SOURCE = 99            # the Obsidian Stronghold compound (3x3)
# The walled village for Cinderhold Gates (67), keyed from its render; see
# shinobij.client/art-source/cinderhold-village/README.md.
VILLAGE_ART = ROOT / 'shinobij.client' / 'art-source' / 'cinderhold-village' / 'compound.webp'
GROUND_PATCH = (171, 171)         # 2x2 tiles
ROCK_PATCH = (96, 96)             # one rock cell, slightly enlarged so lobes overlap


def load_layouts():
    return json.loads((ROOT / 'shared' / 'sector-floor-layout-data.json').read_text(encoding='utf-8'))['layouts']


def cell(mask, t):
    return mask[t // 12][t % 12]


def box(x, y, w=1, h=1, pad=0):
    return (round(x * T) - pad, round(y * T) - pad, round((x + w) * T) + pad, round((y + h) * T) + pad)


def feather(size, radius):
    """An alpha mask that is opaque in the middle and fades to 0 at the edges."""
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


def harvest(layouts):
    ground, rock = [], []
    for art in SOURCES:
        img = Image.open(FLOORS / f's{art}.webp').convert('RGB')
        mask = layouts[str(art)]['mask']
        for y in range(11):
            for x in range(11):
                cells = [mask[y + dy][x + dx] for dy in (0, 1) for dx in (0, 1)]
                if all(c == '.' for c in cells):
                    ground.append(img.crop(box(x, y, 2, 2)).resize(GROUND_PATCH))
        if art not in ROCK_SOURCES:
            continue
        for y in range(12):
            for x in range(12):
                if mask[y][x] == '#':
                    rock.append(img.crop(box(x, y)).resize(ROCK_PATCH))
    return ground, rock


def road_strip(art, layouts):
    """The longest straight vertical run of road in a floor, one tile wide."""
    img = Image.open(FLOORS / f's{art}.webp').convert('RGB')
    mask = layouts[str(art)]['mask']
    best = None
    for x in range(12):
        run = []
        for y in range(12):
            straight = mask[y][x] == '=' and (x == 0 or mask[y][x - 1] != '=') and (x == 11 or mask[y][x + 1] != '=')
            if straight:
                run.append(y)
                if best is None or len(run) > best[2]:
                    best = (x, run[0], len(run))
            else:
                run = []
    x, y0, n = best
    return img.crop(box(x, y0, 1, n))


def road_tile(strip, horizontal, rng):
    tile = round(T)
    top = rng.randrange(0, max(1, strip.height - tile))
    piece = strip.crop((0, top, strip.width, top + tile)).resize((tile, tile))
    if rng.random() < .5:
        piece = piece.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    return piece.rotate(90, expand=True) if horizontal else piece


def paint_roads(canvas, mask, tiles, strip, rng):
    draw = ImageDraw.Draw(canvas)
    for t in tiles:
        x, y = t % 12, t // 12
        road = lambda n: 0 <= n < 144 and cell(mask, n) == '='
        up, down = road(t - 12), road(t + 12)
        left, right = x > 0 and road(t - 1), x < 11 and road(t + 1)
        horizontal = (left or right) and not (up or down)
        x0, y0, x1, y1 = box(x, y)
        canvas.paste(road_tile(strip, horizontal, rng).resize((x1 - x0, y1 - y0)), (x0, y0))
    # A thin worn kerb wherever the road meets open ground or rock.
    for t in tiles:
        x, y = t % 12, t // 12
        x0, y0, x1, y1 = box(x, y)
        edge = (58, 50, 42)
        if y > 0 and cell(mask, t - 12) != '=':
            draw.line((x0, y0, x1, y0), fill=edge, width=2)
        if y < 11 and cell(mask, t + 12) != '=':
            draw.line((x0, y1 - 1, x1, y1 - 1), fill=edge, width=2)
        if x > 0 and cell(mask, t - 1) != '=':
            draw.line((x0, y0, x0, y1), fill=edge, width=2)
        if x < 11 and cell(mask, t + 1) != '=':
            draw.line((x1 - 1, y0, x1 - 1, y1), fill=edge, width=2)


def stronghold_art(layouts):
    img = Image.open(FLOORS / f's{STRONGHOLD_SOURCE}.webp').convert('RGB')
    x, y, n = layouts[str(STRONGHOLD_SOURCE)]['sites']['stronghold']['footprint']
    crop = img.crop(box(x, y, n, n))
    # Trim to the walled compound: the painted courtyard lies inside ~92% of it.
    w, h = crop.size
    return crop.crop((round(w * .02), round(h * .02), round(w * .98), round(h * .96)))


def save_webp(img, path, budget=MAX_BYTES):
    for quality in (86, 82, 78, 76, 74, 72, 70, 68, 66, 62):
        buf = io.BytesIO()
        img.save(buf, 'WEBP', quality=quality, method=6)
        if buf.tell() <= budget:
            path.write_bytes(buf.getvalue())
            return quality, buf.tell()
    raise SystemExit(f'{path.name} cannot fit {budget} bytes')


def compose(layout, ground, rock, strip, keep, rng):
    canvas = Image.new('RGB', (SIZE, SIZE), (70, 60, 52))
    # 1. Ash ground: overlapping 2x2-tile patches, feathered, randomly turned.
    step = round(T * 1.4)
    fade = feather(ground[0].size, 22)
    for gy in range(-step // 2, SIZE, step):
        for gx in range(-step // 2, SIZE, step):
            patch = variants(rng.choice(ground), rng)
            jitter = (rng.randrange(-18, 19), rng.randrange(-18, 19))
            canvas.paste(patch, (gx + jitter[0], gy + jitter[1]), fade if gx > -step // 2 or gy > -step // 2 else None)
    mask = layout['mask']
    # 2. Ash-rock outcrops. Rock texture is laid over each blocked cell's
    #    neighbourhood on its own layer, then cut by an organic outline: a lobe
    #    per cell plus bridges to blocked neighbours, roughened with noise.
    blocked = [t for t in range(144) if cell(mask, t) in '#T']
    layer = Image.new('RGB', (SIZE, SIZE), (44, 37, 34))
    soft = feather(ROCK_PATCH, 16)
    for t in blocked:
        x, y = t % 12, t // 12
        for dx, dy in ((-.3, -.3), (.3, -.3), (-.3, .3), (.3, .3), (0, 0)):
            patch = variants(rng.choice(rock), rng)
            layer.paste(patch, (round((x + .5 + dx) * T - patch.width / 2), round((y + .5 + dy) * T - patch.height / 2)), soft)
    outline = Image.new('L', (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(outline)
    for t in blocked:
        x, y = t % 12, t // 12
        cx, cy = (x + .5) * T + rng.uniform(-6, 6), (y + .5) * T + rng.uniform(-6, 6)
        r = T * rng.uniform(.52, .64)
        draw.ellipse((cx - r, cy - r * rng.uniform(.85, 1.05), cx + r, cy + r), fill=255)
        for n, ddx, ddy in ((t + 1, 1, 0), (t + 12, 0, 1)):
            if n < 144 and (ddx == 0 or x < 11) and cell(mask, n) in '#T':
                w = T * rng.uniform(.34, .46)
                draw.rectangle((cx - w if ddx == 0 else cx, cy - w if ddy == 0 else cy,
                                cx + w if ddx == 0 else cx + T, cy + w if ddy == 0 else cy + T), fill=255)
    noise = Image.effect_noise((SIZE // 8, SIZE // 8), 90).resize((SIZE, SIZE), Image.Resampling.BICUBIC)
    rough = Image.blend(outline.filter(ImageFilter.GaussianBlur(9)), noise, .28).point(lambda v: 255 if v > 150 else 0)
    rough = rough.filter(ImageFilter.GaussianBlur(1.6))
    shade = Image.new('L', (SIZE, SIZE), 0)
    shade.paste(rough.point(lambda v: v * 0.55), (6, 9))
    canvas.paste((18, 14, 12), (0, 0), shade.filter(ImageFilter.GaussianBlur(6)))
    canvas.paste(layer, (0, 0), rough)
    # 3. Flagstone roads with a kerb.
    paint_roads(canvas, mask, [t for t in range(144) if cell(mask, t) == '='], strip, rng)
    # 4. The garrison stronghold, baked in like every other regional stronghold.
    site = layout['sites'].get('stronghold')
    if site:
        x, y, n = site['footprint']
        x0, y0, x1, y1 = box(x, y, n, n)
        art = keep.resize((x1 - x0 + 4, y1 - y0 + 4), Image.Resampling.LANCZOS)
        shadow = Image.new('L', art.size, 0)
        ImageDraw.Draw(shadow).rectangle((6, 10, art.width - 2, art.height - 1), fill=150)
        canvas.paste((20, 16, 14), (x0 - 2 + 5, y0 - 2 + 7), shadow.filter(ImageFilter.GaussianBlur(5)))
        canvas.paste(art, (x0 - 2, y0 - 2), feather(art.size, 3))
    # 5. The walled village in a gate sector, centred on its 4x4 block like the
    #    four player villages, its gate on the south wall above the approach.
    if layout.get('village'):
        village = Image.open(VILLAGE_ART).convert('RGBA')
        x0, y0, x1, y1 = box(4, 4, 4, 4)
        inset, foot = 9, 3
        art = village.resize((x1 - x0 - 2 * inset, y1 - y0 - inset - foot), Image.Resampling.LANCZOS)
        ax, ay = x0 + inset, y0 + inset
        shadow = Image.new('L', canvas.size, 0)
        shadow.paste(art.getchannel('A').point(lambda v: v * 0.6), (ax + 7, ay + 10))
        canvas.paste((16, 12, 10), (0, 0), shadow.filter(ImageFilter.GaussianBlur(7)))
        canvas.paste(art, (ax, ay), art)
    return canvas


def patch_floor(art, layout, carved, layouts, rng, originals):
    # Always paint over the ACCEPTED painting (not an earlier patched candidate),
    # so re-running never re-compresses its own output.
    canvas = Image.open(originals / f's{art}.webp').convert('RGB')
    strip = road_strip(art, layouts)
    paint_roads(canvas, layout['mask'], carved, strip, rng)
    return canvas


def main():
    source = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    out = Path(sys.argv[2])
    # The accepted pre-Cinderhold s7/s66 (e.g. `git show <base>:shinobij.client/public/sector-map/s7.webp`).
    originals = Path(sys.argv[3]) if len(sys.argv) > 3 else FLOORS
    out.mkdir(parents=True, exist_ok=True)
    layouts = load_layouts()
    ground, rock = harvest(layouts)
    strip = road_strip(7, layouts)
    keep = stronghold_art(layouts)
    report = {}
    # The static-asset ceiling (scripts/verify-dist.mjs) is tight, so new floors
    # aim under 205 KB and a patched floor may not grow past its accepted size.
    for art, layout in source['layouts'].items():
        rng = random.Random(int(layout['sector']) * 7919)
        img = compose(layout, ground, rock, strip, keep, rng)
        report[art] = save_webp(img, out / f's{art}-candidate.webp', 205 * 1024)
    for art, entry in source['patched'].items():
        rng = random.Random(int(art) * 104729)
        img = patch_floor(art, entry['layout'], entry['carved'], layouts, rng, originals)
        report[art] = save_webp(img, out / f's{art}-candidate.webp', (originals / f's{art}.webp').stat().st_size)
    print(json.dumps({'ground': len(ground), 'rock': len(rock), 'floors': report}, indent=1))


if __name__ == '__main__':
    main()
