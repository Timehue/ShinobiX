"""Paint transformed-form portraits from the existing boss art.

Usage: python -I scripts/paint-boss-forms.py <repo_root> [preview_dir]
Needs Pillow and numpy. Deterministic (fixed seeds), so re-running reproduces
the same files. Each form is painted over the boss's existing portrait: palette
shift, an energy aura around the silhouette, rim light and one motif per form
(lightning shroud, flame cloak, steam and seal-lines, moon halo, magma seams,
black sun and brand veins, storm ring). See docs/boss-transformations.md.
"""
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = sys.argv[1]
PREVIEW = sys.argv[2] if len(sys.argv) > 2 else None
CLIENT = os.path.join(ROOT, 'shinobij.client')
STORY = os.path.join(CLIENT, 'public', 'portraits', 'cinematic', 'storywide')
TOWER_SRC = os.path.join(CLIENT, 'src', 'assets', 'towers', 'enemies')
TOWER_OUT = os.path.join(CLIENT, 'public', 'portraits', 'towers', 'forms')

KAGE_SIZE = (440, 676)


def arr(im):
    return np.asarray(im, dtype=np.float32) / 255.0


def img(a, mode='RGBA'):
    return Image.fromarray(np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8), mode)


def blur(mask, radius):
    return arr(img(mask, 'L').filter(ImageFilter.GaussianBlur(radius)))


def dilate(mask, size):
    size = size if size % 2 else size + 1
    return arr(img(mask, 'L').filter(ImageFilter.MaxFilter(size)))


def erode(mask, size):
    size = size if size % 2 else size + 1
    return arr(img(mask, 'L').filter(ImageFilter.MinFilter(size)))


def noise(shape, scale, seed, stretch=(1.0, 1.0)):
    """Smooth value noise in 0..1; stretch=(sy, sx) elongates features."""
    h, w = shape
    rng = np.random.default_rng(seed)
    gh = max(2, int(h / (scale * stretch[0])))
    gw = max(2, int(w / (scale * stretch[1])))
    base = rng.random((gh, gw)).astype(np.float32)
    up = Image.fromarray((base * 255).astype(np.uint8), 'L').resize((w, h), Image.BICUBIC)
    return arr(up)


def fbm(shape, seed, scales=(64, 24, 9), stretch=(1.0, 1.0)):
    total, weight = np.zeros(shape, np.float32), 0.0
    for i, s in enumerate(scales):
        amp = 0.55 ** i
        total += amp * noise(shape, s, seed + i * 17, stretch)
        weight += amp
    return total / weight


def luminance(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def grade(rgb, tint, amount, contrast=1.0, sat=1.0, lift=0.0):
    """Push colors toward `tint` while keeping the painted shading."""
    lum = luminance(rgb)[..., None]
    tinted = lum * np.array(tint, np.float32) * 1.6
    out = rgb * (1 - amount) + np.clip(tinted, 0, 1) * amount
    gray = luminance(out)[..., None]
    out = gray + (out - gray) * sat
    out = (out - 0.5) * contrast + 0.5 + lift
    return np.clip(out, 0, 1)


def over(top_rgb, top_a, bot_rgb, bot_a):
    out_a = top_a + bot_a * (1 - top_a)
    safe = np.maximum(out_a, 1e-5)[..., None]
    out_rgb = (top_rgb * top_a[..., None] + bot_rgb * bot_a[..., None] * (1 - top_a[..., None])) / safe
    return out_rgb, out_a


def screen(base, light, strength):
    light = np.clip(light * strength, 0, 1)
    return 1 - (1 - base) * (1 - light)


def color_layer(mask, color):
    return mask[..., None] * np.array(color, np.float32)


# â”€â”€ procedural strokes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def bolt_points(a, b, rng, rough=0.22, depth=6):
    pts = [a, b]
    for _ in range(depth):
        nxt = [pts[0]]
        for p, q in zip(pts, pts[1:]):
            mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            dx, dy = q[0] - p[0], q[1] - p[1]
            length = math.hypot(dx, dy)
            off = (rng.random() - 0.5) * rough * length
            nx, ny = -dy / (length or 1), dx / (length or 1)
            nxt += [(mx + nx * off, my + ny * off), q]
        pts = nxt
    return pts


def draw_bolts(size, bolts, seed, width=2, branch=0.35):
    rng = random.Random(seed)
    layer = Image.new('L', size, 0)
    d = ImageDraw.Draw(layer)
    for a, b in bolts:
        pts = bolt_points(a, b, rng)
        d.line(pts, fill=255, width=width)
        for i in range(2, len(pts) - 2, 9):
            if rng.random() < branch:
                p = pts[i]
                ang = rng.uniform(0, math.tau)
                ln = rng.uniform(25, 70) * size[0] / 560
                q = (p[0] + math.cos(ang) * ln, p[1] + math.sin(ang) * ln)
                d.line(bolt_points(p, q, rng, 0.35, 4), fill=200, width=max(1, width - 1))
    core = arr(layer)
    return core, blur(core, 3 * size[0] / 560 + 1), blur(core, 10 * size[0] / 560 + 2)


def draw_cracks(size, starts, seed, steps=40, width=2, spread=0.55):
    rng = random.Random(seed)
    layer = Image.new('L', size, 0)
    d = ImageDraw.Draw(layer)
    for (x, y) in starts:
        stack = [(x, y, rng.uniform(0, math.tau), steps)]
        while stack:
            cx, cy, ang, left = stack.pop()
            for _ in range(left):
                ang += rng.uniform(-spread, spread)
                step = rng.uniform(4, 9) * size[0] / 384
                nx, ny = cx + math.cos(ang) * step, cy + math.sin(ang) * step
                d.line([(cx, cy), (nx, ny)], fill=255, width=width)
                cx, cy = nx, ny
                left -= 1
                if rng.random() < 0.08 and left > 6:
                    stack.append((cx, cy, ang + rng.choice([-1, 1]) * rng.uniform(0.6, 1.2), left // 2))
    core = arr(layer)
    return core, blur(core, 2.5), blur(core, 7)


def radial(shape, cx, cy, r):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    return np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r


# â”€â”€ cut-out Kage forms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def load_cutout(name):
    im = Image.open(os.path.join(STORY, name)).convert('RGBA').resize(KAGE_SIZE, Image.LANCZOS)
    a = arr(im)
    return a[..., :3], a[..., 3]


def aura_base(alpha, color, reach, seed, rising=True, flicker=0.6):
    """Energy aura hugging the silhouette, flowing upward."""
    h, w = alpha.shape
    grown = blur(dilate(alpha, int(reach * 0.6)), reach * 0.55)
    halo = blur(alpha, reach * 1.4)
    stretch = (3.5, 1.0) if rising else (1.0, 1.0)
    n = fbm((h, w), seed, scales=(48, 18, 7), stretch=stretch)
    tongues = np.clip((n - 0.38) * 2.2, 0, 1)
    shape = np.clip(grown * (1 - flicker + flicker * tongues) * 1.35 + halo * 0.55, 0, 1)
    shape *= (1 - alpha * 0.35)
    return color_layer(shape, color), np.clip(shape, 0, 1)


def rim_light(rgb, alpha, color, width, strength):
    edge = np.clip(alpha - erode(alpha, width), 0, 1)
    edge = blur(edge, width * 0.5)
    return screen(rgb, color_layer(edge, color), strength)


def finish_kage(rgb, alpha, aura_rgb, aura_a, out_name):
    out_rgb, out_a = over(rgb, alpha, aura_rgb, aura_a)
    out = img(np.dstack([out_rgb, out_a]))
    path = os.path.join(STORY, out_name)
    out.save(path, 'WEBP', quality=62, method=6, alpha_quality=55)
    return path, out


def raiko():
    rgb, a = load_cutout('kage-raiko-veyr-hollow.webp')
    w, h = KAGE_SIZE
    rgb = grade(rgb, (0.55, 0.8, 1.15), 0.32, contrast=1.12, sat=1.15, lift=0.02)
    aura_rgb, aura_a = aura_base(a, (0.45, 0.8, 1.0), 26, 11, flicker=0.7)
    # Lightning shroud: bolts circling the silhouette and running down the body.
    rng = random.Random(4)
    bolts = []
    for i in range(14):
        x0 = rng.uniform(0.08, 0.92) * w
        bolts.append(((x0, rng.uniform(0.05, 0.35) * h), (x0 + rng.uniform(-120, 120), rng.uniform(0.55, 0.98) * h)))
    core, near, far = draw_bolts(KAGE_SIZE, bolts, 9, width=2)
    body_light = color_layer(np.clip(core + near * 0.9, 0, 1), (0.85, 0.95, 1.0))
    rgb = screen(rgb, body_light * a[..., None], 0.9)
    aura_rgb = aura_rgb + color_layer(far * 0.9 + near * 0.8 + core, (0.6, 0.85, 1.0))
    aura_a = np.clip(aura_a + far * 0.7 + near * 0.6 + core, 0, 1)
    # Eyes and crown burn white.
    eyes = np.exp(-radial(a.shape, w * 0.5, h * 0.118, w * 0.07) ** 2 * 3)
    rgb = screen(rgb, color_layer(eyes, (0.8, 0.95, 1.0)), 0.7)
    rgb = rim_light(rgb, a, (0.7, 0.92, 1.0), 9, 0.9)
    return finish_kage(rgb, a, np.clip(aura_rgb, 0, 1), aura_a, 'kage-raiko-veyr-thunder-shroud.webp')


def hoshina():
    rgb, a = load_cutout('kage-hoshina-enju-hollow-canon.webp')
    w, h = KAGE_SIZE
    rgb = grade(rgb, (1.2, 0.55, 0.22), 0.28, contrast=1.15, sat=1.2)
    aura_rgb, aura_a = aura_base(a, (1.0, 0.45, 0.08), 34, 21, flicker=0.85)
    # A cloak of living flame wrapping the body.
    n = fbm(a.shape, 31, scales=(36, 14, 6), stretch=(3.0, 1.0))
    veil = np.clip((n - 0.45) * 2.5, 0, 1) * a
    rgb = screen(rgb, color_layer(veil, (1.0, 0.55, 0.15)), 0.75)
    # Ember tails sweeping up behind her shoulders.
    tails = Image.new('L', KAGE_SIZE, 0)
    d = ImageDraw.Draw(tails)
    rng = random.Random(7)
    for i in range(5):
        side = -1 if i % 2 else 1
        x0, y0 = w * 0.5 + side * w * 0.1, h * 0.55
        pts = []
        for t in np.linspace(0, 1, 40):
            pts.append((x0 + side * (w * 0.38) * math.sin(t * 1.4 + i * 0.3), y0 - h * 0.5 * t + rng.uniform(-3, 3)))
        d.line(pts, fill=230, width=int(26 - i * 3))
    tails_a = blur(arr(tails), 9) * np.clip((n + 0.4), 0, 1)
    aura_rgb = aura_rgb + color_layer(tails_a, (1.0, 0.5, 0.1))
    aura_a = np.clip(aura_a + tails_a * 0.85, 0, 1)
    eyes = np.exp(-radial(a.shape, w * 0.44, h * 0.21, w * 0.06) ** 2 * 3)
    rgb = screen(rgb, color_layer(eyes, (1.0, 0.8, 0.3)), 0.8)
    rgb = rim_light(rgb, a, (1.0, 0.7, 0.25), 11, 1.0)
    return finish_kage(rgb, a, np.clip(aura_rgb, 0, 1), aura_a, 'kage-hoshina-enju-ember-cloak.webp')


def kael():
    rgb, a = load_cutout('kage-kael-whitefang-hollow.webp')
    w, h = KAGE_SIZE
    # Ice burning red: the release overwhelms his frost.
    rgb = grade(rgb, (1.15, 0.5, 0.45), 0.36, contrast=1.18, sat=1.1)
    aura_rgb, aura_a = aura_base(a, (0.95, 0.18, 0.12), 30, 41, flicker=0.6)
    # White steam pouring off his body.
    steam = fbm(a.shape, 51, scales=(40, 16, 7), stretch=(2.4, 1.0))
    steam_mask = np.clip((steam - 0.5) * 3.0, 0, 1) * blur(dilate(a, 40), 30) * (1 - a * 0.6)
    aura_rgb = aura_rgb + color_layer(steam_mask, (1.0, 0.92, 0.9))
    aura_a = np.clip(aura_a + steam_mask * 0.75, 0, 1)
    # Burning seal-lines over the body.
    starts = [(w * 0.5 + random.Random(i).uniform(-60, 60), h * (0.25 + 0.1 * i)) for i in range(6)]
    core, near, _ = draw_cracks(KAGE_SIZE, starts, 61, steps=36, width=2)
    rgb = screen(rgb, color_layer(np.clip(core + near, 0, 1) * a, (1.0, 0.3, 0.2)), 0.9)
    eyes = np.exp(-radial(a.shape, w * 0.537, h * 0.137, w * 0.06) ** 2 * 3)
    rgb = screen(rgb, color_layer(eyes, (1.0, 0.35, 0.25)), 0.85)
    rgb = rim_light(rgb, a, (1.0, 0.4, 0.3), 9, 0.9)
    return finish_kage(rgb, a, np.clip(aura_rgb, 0, 1), aura_a, 'kage-kael-whitefang-oath-gate.webp')


def sable():
    rgb, a = load_cutout('kage-sable-nocturne-hollow.webp')
    w, h = KAGE_SIZE
    rgb = grade(rgb, (0.75, 0.7, 1.1), 0.25, contrast=1.1, sat=1.05, lift=0.05)
    aura_rgb, aura_a = aura_base(a, (0.72, 0.68, 1.0), 28, 71, rising=False, flicker=0.4)
    # A full-moon halo behind her head with a pale corona.
    cx, cy = w * 0.43, h * 0.15
    d = radial(a.shape, cx, cy, w * 0.27)
    disc = np.clip(1 - d, 0, 1) ** 0.6
    ring = np.exp(-((d - 1.0) / 0.06) ** 2)
    corona = np.exp(-np.clip(d - 1, 0, None) * 3.5) * (d > 0.9)
    moon = np.clip(disc * 0.55 + ring + corona * 0.5, 0, 1)
    aura_rgb = aura_rgb + color_layer(moon, (0.92, 0.9, 1.0))
    aura_a = np.clip(aura_a + moon * 0.9, 0, 1)
    # Drifting moonlight motes gathering toward her (nature energy being drawn in).
    motes = Image.new('L', KAGE_SIZE, 0)
    dm = ImageDraw.Draw(motes)
    rng = random.Random(83)
    for _ in range(70):
        x, y = rng.uniform(0.05, 0.95) * w, rng.uniform(0.05, 0.9) * h
        r = rng.uniform(1.5, 4.5)
        dm.ellipse([x - r, y - r, x + r, y + r], fill=int(rng.uniform(140, 255)))
    motes_a = np.clip(arr(motes) + blur(arr(motes), 4) * 1.5, 0, 1)
    aura_rgb = aura_rgb + color_layer(motes_a, (0.9, 0.88, 1.0))
    aura_a = np.clip(aura_a + motes_a * 0.9, 0, 1)
    rgb = screen(rgb, color_layer(motes_a * a, (0.9, 0.88, 1.0)), 0.6)
    eyes = np.exp(-radial(a.shape, w * 0.44, h * 0.146, w * 0.05) ** 2 * 3)
    rgb = screen(rgb, color_layer(eyes, (0.95, 0.9, 1.0)), 0.9)
    rgb = rim_light(rgb, a, (0.85, 0.82, 1.0), 9, 0.95)
    return finish_kage(rgb, a, np.clip(aura_rgb, 0, 1), aura_a, 'kage-sable-nocturne-moon-hermit.webp')


# â”€â”€ square tower portraits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def load_square(name):
    im = Image.open(os.path.join(TOWER_SRC, name)).convert('RGB').resize((384, 384), Image.LANCZOS)
    return arr(im)


def save_square(rgb, out_name):
    os.makedirs(TOWER_OUT, exist_ok=True)
    out = img(np.clip(rgb, 0, 1), 'RGB').resize((288, 288), Image.LANCZOS)
    path = os.path.join(TOWER_OUT, out_name)
    out.save(path, 'WEBP', quality=68, method=6)
    return path, out


def warden():
    rgb = load_square('warden.webp')
    shape = rgb.shape[:2]
    # Obsidian: glassy black armor with a cold sheen, molten seams.
    rgb = grade(rgb, (0.55, 0.6, 0.75), 0.4, contrast=1.25, sat=0.8, lift=-0.04)
    # Glassy highlights along the upper edges of each plate (light from above).
    lum = luminance(rgb)
    edges = np.clip(lum - np.roll(lum, 3, axis=0), 0, 1)
    rgb = screen(rgb, color_layer(blur(np.clip(edges * 6, 0, 1), 1.2), (0.6, 0.7, 1.0)), 0.6)
    starts = [(120, 270), (265, 270), (192, 235), (80, 340), (305, 340)]
    core, near, far = draw_cracks((384, 384), starts, 3, steps=18, width=3, spread=0.28)
    lava = np.clip(core * 1.2 + near * 1.0 + far * 0.6, 0, 1)
    rgb = screen(rgb, color_layer(lava, (1.0, 0.45, 0.08)), 1.0)
    for ex in (160, 218):
        eye = np.exp(-radial(shape, ex, 127, 22) ** 2 * 2)
        rgb = screen(rgb, color_layer(eye, (1.0, 0.6, 0.15)), 1.0)
    floor_glow = np.clip((np.mgrid[0:384, 0:384][0] / 384.0 - 0.6) * 2.5, 0, 1) * fbm(shape, 9, scales=(40, 14))
    rgb = screen(rgb, color_layer(floor_glow, (1.0, 0.35, 0.05)), 0.8)
    vignette = np.clip(radial(shape, 192, 200, 260), 0, 1)[..., None]
    rgb = rgb * (1 - vignette * 0.35)
    return save_square(rgb, 'warden-obsidian-colossus.webp')


def sovereign():
    rgb = load_square('sovereign.webp')
    shape = rgb.shape[:2]
    rgb = grade(rgb, (0.75, 0.45, 1.0), 0.3, contrast=1.2, sat=1.15)
    # A black sun rising behind the crown, ringed by violet fire.
    d = radial(shape, 192, 48, 112)
    corona = np.exp(-((d - 1.0) / 0.05) ** 2) + np.exp(-np.clip(d - 1, 0, None) * 6) * 0.25 * (d > 1)
    rgb = screen(rgb, color_layer(np.clip(corona, 0, 1), (0.75, 0.35, 1.0)), 1.0)
    # The brand spreads: short violet veins branching out from the chest sigil.
    starts = [(232, 265), (232, 240), (232, 290), (110, 205), (330, 205)]
    core, near, far = draw_cracks((384, 384), starts, 17, steps=14, width=1, spread=0.35)
    rgb = screen(rgb, color_layer(np.clip(core + near * 0.6 + far * 0.3, 0, 1), (0.8, 0.35, 1.0)), 1.0)
    for ex in (178, 210):
        eye = np.exp(-radial(shape, ex, 92, 18) ** 2 * 2)
        rgb = screen(rgb, color_layer(eye, (0.95, 0.6, 1.0)), 1.0)
    return save_square(rgb, 'sovereign-eclipse-brand.webp')


def regent():
    rgb = load_square('stormglass-regent.webp')
    shape = rgb.shape[:2]
    rgb = grade(rgb, (0.6, 0.85, 1.1), 0.22, contrast=1.15, sat=1.2, lift=0.02)
    # Nature energy: a swirling storm ring and a crown of bolts.
    d = radial(shape, 192, 150, 150)
    ring = np.exp(-((d - 1.0) / 0.035) ** 2) * (0.5 + 0.5 * fbm(shape, 23, scales=(16, 6)))
    rgb = screen(rgb, color_layer(ring, (0.6, 0.9, 1.0)), 0.6)
    # Bolts gather into its raised hands from the sky, framing (not crossing) its face.
    bolts = [((30, 0), (70, 230)), ((110, 0), (60, 200)), ((355, 0), (440 - 20, 330)), ((290, 0), (420 - 20, 290))]
    core, near, far = draw_bolts((384, 384), bolts, 5, width=2, branch=0.25)
    rgb = screen(rgb, color_layer(np.clip(core + near + far * 0.6, 0, 1), (0.75, 0.92, 1.0)), 1.0)
    # Hermit markings: glowing eye pigment.
    for ex in (165, 207):
        eye = np.exp(-radial(shape, ex, 116, 16) ** 2 * 2)
        rgb = screen(rgb, color_layer(eye, (0.6, 1.0, 0.95)), 1.0)
    return save_square(rgb, 'regent-storm-hermit.webp')


def main():
    results = [raiko(), hoshina(), kael(), sable(), warden(), sovereign(), regent()]
    for path, _ in results:
        print(os.path.relpath(path, ROOT), os.path.getsize(path))
    if PREVIEW:
        bg = (34, 34, 44, 255)
        kage = [im for _, im in results[:4]]
        sheet = Image.new('RGBA', (280 * 4, 430), bg)
        for i, im in enumerate(kage):
            sheet.alpha_composite(im.resize((280, 430)), (i * 280, 0))
        sheet.convert('RGB').save(os.path.join(PREVIEW, 'forms-kage.png'))
        towers = [im for _, im in results[4:]]
        tsheet = Image.new('RGB', (384 * 3, 384))
        for i, im in enumerate(towers):
            tsheet.paste(im, (i * 384, 0))
        tsheet.save(os.path.join(PREVIEW, 'forms-tower.png'))


if __name__ == '__main__':
    main()
