"""Paint transformed-form portraits and battle sprites from the existing boss art.

Usage: python -I scripts/paint-boss-forms.py <repo_root> [preview_dir]
Needs Pillow and numpy. Deterministic (fixed seeds), so re-running reproduces
the same files. Every form is painted over that boss's own art, so it stays
recognisably the same character: palette shift, an energy aura that follows
the silhouette, rim light and one motif per form (lightning shroud, flame
cloak with ember tails, steam and burning seal-lines, moon halo with motes,
obsidian shell with magma seams, eclipse brand with a black sun, storm ring).
See docs/boss-transformations.md.
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
SPRITE_SRC = os.path.join(CLIENT, 'src', 'assets', 'combat-actors')
TOWER_OUT = os.path.join(CLIENT, 'public', 'portraits', 'towers', 'forms')
SPRITE_OUT = os.path.join(CLIENT, 'public', 'combat-actors', 'forms')

KAGE_SIZE = (640, 983)
SPRITE = 384


def arr(im):
    return np.asarray(im, dtype=np.float32) / 255.0


def img(a, mode='RGBA'):
    return Image.fromarray(np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8), mode)


def blur(mask, radius):
    return arr(img(mask, 'L').filter(ImageFilter.GaussianBlur(max(0.1, radius))))


def dilate(mask, size):
    size = max(3, int(size) | 1)
    return arr(img(mask, 'L').filter(ImageFilter.MaxFilter(size)))


def erode(mask, size):
    size = max(3, int(size) | 1)
    return arr(img(mask, 'L').filter(ImageFilter.MinFilter(size)))


def noise(shape, scale, seed, stretch=(1.0, 1.0)):
    h, w = shape
    rng = np.random.default_rng(seed)
    gh = max(2, int(h / (scale * stretch[0])))
    gw = max(2, int(w / (scale * stretch[1])))
    base = rng.random((gh, gw)).astype(np.float32)
    return arr(Image.fromarray((base * 255).astype(np.uint8), 'L').resize((w, h), Image.BICUBIC))


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
    lum = luminance(rgb)[..., None]
    tinted = np.clip(lum * np.array(tint, np.float32) * 1.6, 0, 1)
    out = rgb * (1 - amount) + tinted * amount
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
    return 1 - (1 - base) * (1 - np.clip(light * strength, 0, 1))


def layer(mask, color):
    return mask[..., None] * np.array(color, np.float32)


def radial(shape, cx, cy, r):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    return np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r


def bolt_points(a, b, rng, rough=0.22, depth=6):
    pts = [a, b]
    for _ in range(depth):
        nxt = [pts[0]]
        for p, q in zip(pts, pts[1:]):
            mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            dx, dy = q[0] - p[0], q[1] - p[1]
            length = math.hypot(dx, dy) or 1
            off = (rng.random() - 0.5) * rough * length
            nxt += [(mx - dy / length * off, my + dx / length * off), q]
        pts = nxt
    return pts


def draw_bolts(size, bolts, seed, width=2, branch=0.35):
    rng = random.Random(seed)
    canvas = Image.new('L', size, 0)
    d = ImageDraw.Draw(canvas)
    unit = size[0] / 560
    for a, b in bolts:
        pts = bolt_points(a, b, rng)
        d.line(pts, fill=255, width=width)
        for i in range(2, len(pts) - 2, 9):
            if rng.random() < branch:
                p = pts[i]
                ang = rng.uniform(0, math.tau)
                ln = rng.uniform(25, 70) * unit
                d.line(bolt_points(p, (p[0] + math.cos(ang) * ln, p[1] + math.sin(ang) * ln), rng, 0.35, 4), fill=200, width=max(1, width - 1))
    core = arr(canvas)
    return core, blur(core, 3 * unit + 1), blur(core, 10 * unit + 2)


def draw_cracks(size, starts, seed, steps=40, width=2, spread=0.55):
    rng = random.Random(seed)
    canvas = Image.new('L', size, 0)
    d = ImageDraw.Draw(canvas)
    unit = size[0] / 384
    for (x, y) in starts:
        stack = [(x, y, rng.uniform(0, math.tau), steps)]
        while stack:
            cx, cy, ang, left = stack.pop()
            for _ in range(left):
                ang += rng.uniform(-spread, spread)
                step = rng.uniform(4, 9) * unit
                nx, ny = cx + math.cos(ang) * step, cy + math.sin(ang) * step
                d.line([(cx, cy), (nx, ny)], fill=255, width=width)
                cx, cy = nx, ny
                left -= 1
                if rng.random() < 0.08 and left > 6:
                    stack.append((cx, cy, ang + rng.choice([-1, 1]) * rng.uniform(0.6, 1.2), left // 2))
    core = arr(canvas)
    return core, blur(core, 2.5 * unit), blur(core, 7 * unit)


def motes(size, count, seed, rmin=1.5, rmax=4.5, area=(0.05, 0.95, 0.05, 0.9)):
    canvas = Image.new('L', size, 0)
    d = ImageDraw.Draw(canvas)
    rng = random.Random(seed)
    w, h = size
    scale = w / 560
    for _ in range(count):
        x, y = rng.uniform(area[0], area[1]) * w, rng.uniform(area[2], area[3]) * h
        r = rng.uniform(rmin, rmax) * scale
        d.ellipse([x - r, y - r, x + r, y + r], fill=int(rng.uniform(140, 255)))
    m = arr(canvas)
    return np.clip(m + blur(m, 4 * scale) * 1.5, 0, 1)


# ── one painter for every cut-out (Kage portraits and all battle sprites) ─────

def paint_cutout(rgb, a, theme, head, seed):
    """rgb/a: float arrays of a transparent cut-out. head: (x, y) fraction."""
    h, w = a.shape
    unit = w / 560
    hx, hy = head[0] * w, head[1] * h
    aura_rgb = np.zeros((h, w, 3), np.float32)
    aura_a = np.zeros((h, w), np.float32)

    def add_aura(mask, color, strength=1.0):
        nonlocal aura_rgb, aura_a
        aura_rgb = aura_rgb + layer(mask * strength, color)
        aura_a = np.clip(aura_a + mask * strength, 0, 1)

    def silhouette_aura(color, reach, rising=True, flicker=0.6):
        grown = blur(dilate(a, reach * unit * 0.6), reach * unit * 0.55)
        halo = blur(a, reach * unit * 1.4)
        n = fbm((h, w), seed, scales=(48 * unit, 18 * unit, 7 * unit), stretch=(3.5, 1.0) if rising else (1.0, 1.0))
        tongues = np.clip((n - 0.38) * 2.2, 0, 1)
        shape = np.clip(grown * (1 - flicker + flicker * tongues) * 1.35 + halo * 0.55, 0, 1) * (1 - a * 0.35)
        add_aura(shape, color)

    def rim(color, width_px, strength):
        nonlocal rgb
        edge = blur(np.clip(a - erode(a, width_px * unit), 0, 1), width_px * unit * 0.5)
        rgb = screen(rgb, layer(edge, color), strength)

    def eyes(color, radius, strength, dx=0.0):
        nonlocal rgb
        glow = np.exp(-radial(a.shape, hx + dx * w, hy, radius * w) ** 2 * 3)
        rgb = screen(rgb, layer(glow, color), strength)

    if theme == 'storm':
        rgb = grade(rgb, (0.55, 0.8, 1.15), 0.32, contrast=1.12, sat=1.15, lift=0.02)
        silhouette_aura((0.45, 0.8, 1.0), 26, flicker=0.7)
        rng = random.Random(seed)
        bolts = []
        for _ in range(14):
            x0 = rng.uniform(0.08, 0.92) * w
            bolts.append(((x0, rng.uniform(0.05, 0.35) * h), (x0 + rng.uniform(-120, 120) * unit, rng.uniform(0.55, 0.98) * h)))
        core, near, far = draw_bolts((w, h), bolts, seed + 5, width=max(1, int(2 * unit + 0.5)))
        rgb = screen(rgb, layer(np.clip(core + near * 0.9, 0, 1) * a, (0.85, 0.95, 1.0)), 0.9)
        add_aura(np.clip(far * 0.9 + near * 0.8 + core, 0, 1), (0.6, 0.85, 1.0))
        eyes((0.8, 0.95, 1.0), 0.07, 0.75)
        rim((0.7, 0.92, 1.0), 9, 0.9)
    elif theme == 'flame':
        rgb = grade(rgb, (1.2, 0.55, 0.22), 0.28, contrast=1.15, sat=1.2)
        silhouette_aura((1.0, 0.45, 0.08), 34, flicker=0.85)
        n = fbm((h, w), seed + 10, scales=(36 * unit, 14 * unit, 6 * unit), stretch=(3.0, 1.0))
        rgb = screen(rgb, layer(np.clip((n - 0.45) * 2.5, 0, 1) * a, (1.0, 0.55, 0.15)), 0.75)
        # Ember tails sweep up from the figure's hips, sized to the figure itself.
        ys, xs = np.nonzero(a > 0.5)
        fx0, fx1, fy0, fy1 = xs.min(), xs.max(), ys.min(), ys.max()
        fw, fh = fx1 - fx0, fy1 - fy0
        tails = Image.new('L', (w, h), 0)
        d = ImageDraw.Draw(tails)
        rng = random.Random(seed + 2)
        for i in range(5):
            side = -1 if i % 2 else 1
            x0, y0 = (fx0 + fx1) / 2 + side * fw * 0.15, fy0 + fh * 0.55
            pts = [(x0 + side * (fw * 0.55) * math.sin(t * 1.4 + i * 0.3), y0 - fh * 0.45 * t + rng.uniform(-3, 3) * unit) for t in np.linspace(0, 1, 40)]
            d.line(pts, fill=230, width=max(2, int((26 - i * 3) * unit * fw / (w * 0.7))))
        add_aura(blur(arr(tails), 9 * unit) * np.clip(n + 0.4, 0, 1), (1.0, 0.5, 0.1), 0.85)
        add_aura(motes((w, h), 40, seed + 3, area=(0.1, 0.9, 0.05, 0.6)), (1.0, 0.75, 0.3), 0.8)
        eyes((1.0, 0.8, 0.3), 0.06, 0.8)
        rim((1.0, 0.7, 0.25), 11, 1.0)
    elif theme == 'steam':
        rgb = grade(rgb, (1.15, 0.5, 0.45), 0.36, contrast=1.18, sat=1.1)
        silhouette_aura((0.95, 0.18, 0.12), 30, flicker=0.6)
        steam = fbm((h, w), seed + 20, scales=(40 * unit, 16 * unit, 7 * unit), stretch=(2.4, 1.0))
        add_aura(np.clip((steam - 0.5) * 3.0, 0, 1) * blur(dilate(a, 40 * unit), 30 * unit) * (1 - a * 0.6), (1.0, 0.92, 0.9), 0.75)
        starts = [(w * 0.5 + random.Random(seed + i).uniform(-60, 60) * unit, h * (0.25 + 0.1 * i)) for i in range(6)]
        core, near, _ = draw_cracks((w, h), starts, seed + 21, steps=36, width=max(1, int(2 * unit + 0.5)))
        rgb = screen(rgb, layer(np.clip(core + near, 0, 1) * a, (1.0, 0.3, 0.2)), 0.9)
        eyes((1.0, 0.35, 0.25), 0.06, 0.85)
        rim((1.0, 0.4, 0.3), 9, 0.9)
    elif theme == 'moon':
        rgb = grade(rgb, (0.75, 0.7, 1.1), 0.25, contrast=1.1, sat=1.05, lift=0.05)
        silhouette_aura((0.72, 0.68, 1.0), 28, rising=False, flicker=0.4)
        d = radial(a.shape, hx, hy - 0.02 * h, w * 0.27)
        moon = np.clip(np.clip(1 - d, 0, 1) ** 0.6 * 0.55 + np.exp(-((d - 1.0) / 0.06) ** 2) + np.exp(-np.clip(d - 1, 0, None) * 3.5) * (d > 0.9) * 0.5, 0, 1)
        add_aura(moon, (0.92, 0.9, 1.0), 0.9)
        m = motes((w, h), 70, seed + 30)
        add_aura(m, (0.9, 0.88, 1.0), 0.9)
        rgb = screen(rgb, layer(m * a, (0.9, 0.88, 1.0)), 0.6)
        eyes((0.95, 0.9, 1.0), 0.05, 0.9)
        rim((0.85, 0.82, 1.0), 9, 0.95)
    elif theme == 'obsidian':
        rgb = grade(rgb, (0.55, 0.6, 0.75), 0.4, contrast=1.25, sat=0.8, lift=-0.04)
        lum = luminance(rgb)
        sheen = blur(np.clip((lum - np.roll(lum, max(1, int(3 * unit)), axis=0)) * 6, 0, 1), 1.2 * unit) * a
        rgb = screen(rgb, layer(sheen, (0.6, 0.7, 1.0)), 0.6)
        silhouette_aura((1.0, 0.42, 0.06), 22, flicker=0.75)
        starts = [(w * x, h * y) for x, y in [(0.42, 0.42), (0.6, 0.42), (0.5, 0.35), (0.38, 0.62), (0.62, 0.62), (0.5, 0.78)]]
        core, near, far = draw_cracks((w, h), starts, seed + 40, steps=18, width=max(2, int(3 * w / 384)), spread=0.28)
        rgb = screen(rgb, layer(np.clip(core * 1.2 + near + far * 0.6, 0, 1) * a, (1.0, 0.45, 0.08)), 1.0)
        add_aura(motes((w, h), 40, seed + 41, area=(0.1, 0.9, 0.3, 1.0)), (1.0, 0.55, 0.12), 0.8)
        eyes((1.0, 0.6, 0.15), 0.05, 1.0)
        rim((1.0, 0.5, 0.15), 7, 0.8)
    elif theme == 'eclipse':
        rgb = grade(rgb, (0.75, 0.45, 1.0), 0.3, contrast=1.2, sat=1.15)
        silhouette_aura((0.55, 0.2, 0.9), 26, flicker=0.6)
        d = radial(a.shape, hx, hy - 0.03 * h, w * 0.2)
        sun = np.exp(-((d - 1.0) / 0.05) ** 2) + np.exp(-np.clip(d - 1, 0, None) * 6) * 0.3 * (d > 1)
        add_aura(np.clip(sun, 0, 1), (0.8, 0.4, 1.0))
        disc = np.clip(1 - d, 0, 1) ** 0.3 * (1 - a)
        aura_rgb = aura_rgb * (1 - disc[..., None] * 0.9)
        aura_a = np.clip(aura_a + disc * 0.85, 0, 1)
        starts = [(w * x, h * y) for x, y in [(0.5, 0.42), (0.5, 0.52), (0.38, 0.32), (0.62, 0.32), (0.5, 0.62)]]
        core, near, far = draw_cracks((w, h), starts, seed + 50, steps=14, width=1, spread=0.35)
        rgb = screen(rgb, layer(np.clip(core + near * 0.6 + far * 0.3, 0, 1) * a, (0.8, 0.35, 1.0)), 1.0)
        eyes((0.95, 0.6, 1.0), 0.04, 1.0)
        rim((0.75, 0.4, 1.0), 7, 0.9)
    elif theme == 'tempest':
        rgb = grade(rgb, (0.6, 0.85, 1.1), 0.22, contrast=1.15, sat=1.2, lift=0.02)
        silhouette_aura((0.45, 0.9, 1.0), 24, rising=False, flicker=0.65)
        d = radial(a.shape, hx, hy + 0.12 * h, w * 0.42)
        ring = np.exp(-((d - 1.0) / 0.035) ** 2) * (0.5 + 0.5 * fbm((h, w), seed + 60, scales=(16 * unit, 6 * unit)))
        add_aura(ring, (0.6, 0.9, 1.0), 0.8)
        bolts = [((w * 0.08, 0), (w * 0.18, h * 0.6)), ((w * 0.92, 0), (w * 0.82, h * 0.7)), ((w * 0.3, 0), (w * 0.2, h * 0.5))]
        core, near, far = draw_bolts((w, h), bolts, seed + 61, width=max(1, int(2 * unit + 0.5)), branch=0.25)
        add_aura(np.clip(core + near + far * 0.6, 0, 1), (0.75, 0.92, 1.0))
        eyes((0.6, 1.0, 0.95), 0.04, 1.0)
        rim((0.6, 0.95, 1.0), 7, 0.9)
    else:
        raise ValueError(theme)
    return over(rgb, a, np.clip(aura_rgb, 0, 1), aura_a)


def load_cutout(path, size=None):
    im = Image.open(path).convert('RGBA')
    if size:
        im = im.resize(size, Image.LANCZOS)
    a = arr(im)
    return a[..., :3], a[..., 3]


def save_rgba(out_rgb, out_a, path, quality=74, alpha_quality=70):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out = img(np.dstack([out_rgb, out_a]))
    out.save(path, 'WEBP', quality=quality, method=6, alpha_quality=alpha_quality)
    return path, out


def fit_sprite(im):
    """Fit a painted figure into a 384x384 transparent sprite (feet on the bottom)."""
    box = im.getbbox() or (0, 0, im.width, im.height)
    fig = im.crop(box)
    scale = min((SPRITE - 8) / fig.width, (SPRITE - 4) / fig.height)
    fig = fig.resize((max(1, int(fig.width * scale)), max(1, int(fig.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (SPRITE, SPRITE), (0, 0, 0, 0))
    canvas.alpha_composite(fig, ((SPRITE - fig.width) // 2, SPRITE - fig.height - 2))
    return canvas


KAGE = [
    # (source portrait, form portrait, form sprite, theme, head, seed)
    ('kage-raiko-veyr-hollow.webp', 'kage-raiko-veyr-thunder-shroud.webp', 'raiko-thunder-god-shroud-idle.webp', 'storm', (0.5, 0.118), 11),
    ('kage-hoshina-enju-hollow-canon.webp', 'kage-hoshina-enju-ember-cloak.webp', None, 'flame', (0.44, 0.21), 21),
    ('kage-kael-whitefang-hollow.webp', 'kage-kael-whitefang-oath-gate.webp', 'kael-oath-gate-release-idle.webp', 'steam', (0.537, 0.137), 41),
    ('kage-sable-nocturne-hollow.webp', 'kage-sable-nocturne-moon-hermit.webp', 'sable-moon-hermit-idle.webp', 'moon', (0.43, 0.15), 71),
]

SPRITES = [
    # (source sprite, form sprite, theme, head, seed)
    ('pve/hoshina-hollow-idle.webp', 'hoshina-ember-vessel-idle.webp', 'flame', (0.5, 0.2), 23),
    ('bosses/tower-armored-boss-idle.webp', 'boss-warden-obsidian-colossus-idle.webp', 'obsidian', (0.58, 0.16), 3),
    ('bosses/tower-armored-boss-idle.webp', 'boss-sovereign-eclipse-brand-idle.webp', 'eclipse', (0.58, 0.16), 17),
    ('bosses/tower-caster-idle.webp', 'regent-storm-hermit-idle.webp', 'tempest', (0.51, 0.12), 5),
]


# ── square tower portraits (opaque paintings with a background) ────────────────
# Coordinates are authored on a 384px frame and scaled to the source's own size,
# so each portrait keeps its native resolution.

def save_square(rgb, out_name):
    os.makedirs(TOWER_OUT, exist_ok=True)
    out = img(np.clip(rgb, 0, 1), 'RGB')
    path = os.path.join(TOWER_OUT, out_name)
    out.save(path, 'WEBP', quality=76, method=6)
    return path, out


def load_square(name):
    rgb = arr(Image.open(os.path.join(TOWER_SRC, name)).convert('RGB'))
    return rgb, rgb.shape[1] / 384.0


def warden_square():
    rgb, k = load_square('warden.webp')
    shape = rgb.shape[:2]
    size = (shape[1], shape[0])
    rgb = grade(rgb, (0.55, 0.6, 0.75), 0.4, contrast=1.25, sat=0.8, lift=-0.04)
    lum = luminance(rgb)
    rgb = screen(rgb, layer(blur(np.clip((lum - np.roll(lum, max(1, int(3 * k)), axis=0)) * 6, 0, 1), 1.2 * k), (0.6, 0.7, 1.0)), 0.6)
    starts = [(x * k, y * k) for x, y in [(120, 270), (265, 270), (192, 235), (80, 340), (305, 340)]]
    core, near, far = draw_cracks(size, starts, 3, steps=18, width=max(2, int(3 * k)), spread=0.28)
    rgb = screen(rgb, layer(np.clip(core * 1.2 + near + far * 0.6, 0, 1), (1.0, 0.45, 0.08)), 1.0)
    for ex in (160, 218):
        rgb = screen(rgb, layer(np.exp(-radial(shape, ex * k, 127 * k, 22 * k) ** 2 * 2), (1.0, 0.6, 0.15)), 1.0)
    floor = np.clip((np.mgrid[0:shape[0], 0:shape[1]][0] / shape[0] - 0.6) * 2.5, 0, 1) * fbm(shape, 9, scales=(40 * k, 14 * k))
    rgb = screen(rgb, layer(floor, (1.0, 0.35, 0.05)), 0.8)
    embers = motes(size, 30, 8, area=(0.0, 1.0, 0.45, 1.0))
    rgb = screen(rgb, layer(embers, (1.0, 0.55, 0.12)), 0.8)
    rgb = rgb * (1 - np.clip(radial(shape, 192 * k, 200 * k, 260 * k), 0, 1)[..., None] * 0.35)
    return save_square(rgb, 'warden-obsidian-colossus.webp')


def sovereign_square():
    rgb, k = load_square('sovereign.webp')
    shape = rgb.shape[:2]
    size = (shape[1], shape[0])
    rgb = grade(rgb, (0.75, 0.45, 1.0), 0.3, contrast=1.2, sat=1.15)
    d = radial(shape, 192 * k, 48 * k, 112 * k)
    corona = np.exp(-((d - 1.0) / 0.05) ** 2) + np.exp(-np.clip(d - 1, 0, None) * 6) * 0.25 * (d > 1)
    rgb = screen(rgb, layer(np.clip(corona, 0, 1), (0.75, 0.35, 1.0)), 1.0)
    starts = [(x * k, y * k) for x, y in [(232, 265), (232, 240), (232, 290), (110, 205), (330, 205)]]
    core, near, far = draw_cracks(size, starts, 17, steps=14, width=max(1, int(k)), spread=0.35)
    rgb = screen(rgb, layer(np.clip(core + near * 0.6 + far * 0.3, 0, 1), (0.8, 0.35, 1.0)), 1.0)
    for ex in (178, 210):
        rgb = screen(rgb, layer(np.exp(-radial(shape, ex * k, 92 * k, 18 * k) ** 2 * 2), (0.95, 0.6, 1.0)), 1.0)
    return save_square(rgb, 'sovereign-eclipse-brand.webp')


def regent_square():
    rgb, k = load_square('stormglass-regent.webp')
    shape = rgb.shape[:2]
    size = (shape[1], shape[0])
    rgb = grade(rgb, (0.6, 0.85, 1.1), 0.22, contrast=1.15, sat=1.2, lift=0.02)
    d = radial(shape, 192 * k, 150 * k, 150 * k)
    ring = np.exp(-((d - 1.0) / 0.035) ** 2) * (0.5 + 0.5 * fbm(shape, 23, scales=(16 * k, 6 * k)))
    rgb = screen(rgb, layer(ring, (0.6, 0.9, 1.0)), 0.6)
    bolts = [((x0 * k, 0), (x1 * k, y1 * k)) for x0, x1, y1 in [(30, 70, 230), (110, 60, 200), (355, 420, 330), (290, 400, 290)]]
    core, near, far = draw_bolts(size, bolts, 5, width=max(2, int(2 * k)), branch=0.25)
    rgb = screen(rgb, layer(np.clip(core + near + far * 0.6, 0, 1), (0.75, 0.92, 1.0)), 1.0)
    for ex in (165, 207):
        rgb = screen(rgb, layer(np.exp(-radial(shape, ex * k, 116 * k, 16 * k) ** 2 * 2), (0.6, 1.0, 0.95)), 1.0)
    return save_square(rgb, 'regent-storm-hermit.webp')


def main():
    results = []
    previews_portrait, previews_sprite = [], []
    for src, portrait, sprite, theme, head, seed in KAGE:
        rgb, a = load_cutout(os.path.join(STORY, src), KAGE_SIZE)
        out_rgb, out_a = paint_cutout(rgb, a, theme, head, seed)
        path, out = save_rgba(out_rgb, out_a, os.path.join(STORY, portrait))
        results.append(path)
        previews_portrait.append(out)
        if sprite:
            spath = os.path.join(SPRITE_OUT, sprite)
            os.makedirs(SPRITE_OUT, exist_ok=True)
            fit_sprite(out).save(spath, 'WEBP', quality=78, method=6, alpha_quality=80)
            results.append(spath)
            previews_sprite.append(Image.open(spath))
    for src, out_name, theme, head, seed in SPRITES:
        rgb, a = load_cutout(os.path.join(SPRITE_SRC, src))
        out_rgb, out_a = paint_cutout(rgb, a, theme, head, seed)
        spath, out = save_rgba(out_rgb, out_a, os.path.join(SPRITE_OUT, out_name), quality=78, alpha_quality=80)
        results.append(spath)
        previews_sprite.append(out)
    previews_tower = []
    for painter in (warden_square, sovereign_square, regent_square):
        path, out = painter()
        results.append(path)
        previews_tower.append(out)
    for path in results:
        print(os.path.relpath(path, ROOT).replace('\\', '/'), os.path.getsize(path))
    if PREVIEW:
        sheet = Image.new('RGBA', (280 * 4, 430), (34, 34, 44, 255))
        for i, im in enumerate(previews_portrait):
            sheet.alpha_composite(im.resize((280, 430)), (i * 280, 0))
        sheet.convert('RGB').save(os.path.join(PREVIEW, 'forms-kage.png'))
        ssheet = Image.new('RGBA', (SPRITE * len(previews_sprite), SPRITE), (40, 44, 52, 255))
        for i, im in enumerate(previews_sprite):
            ssheet.alpha_composite(im.convert('RGBA'), (i * SPRITE, 0))
        ssheet.convert('RGB').save(os.path.join(PREVIEW, 'forms-sprites.png'))
        tsheet = Image.new('RGB', (384 * 3, 384))
        for i, im in enumerate(previews_tower):
            tsheet.paste(im.resize((384, 384)), (i * 384, 0))
        tsheet.save(os.path.join(PREVIEW, 'forms-tower.png'))


if __name__ == '__main__':
    main()
