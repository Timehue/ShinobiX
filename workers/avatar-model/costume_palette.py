"""Keep a painted costume as colorful as its portrait once it is shrunk to game size.

A world sprite is about 36 pixels wide. Shading, outlines and thin trim average into grey at
that size, and the H.264 frames halve the color resolution again. The painter is told the
portrait's main colors, and the returned sheet is then corrected per color family (hue band):
each family is brought up to the saturation and brightness the same family has in the
portrait, measured at game size. The correction only ever adds color, and it leaves
near-neutral pixels (fur, steel, outlines, skin shading) as painted.
"""
import io

import numpy as np
from PIL import Image

GAME_SCALE = 1 / 5          # painted sheet view (~190 px) to world sprite (~36 px)
BANDS = 12                  # 30 degree hue families
COLORED = .14               # below this saturation a pixel takes no part in the measurement
PROTECT = (.28, .45)        # boost fades in between these saturations, so muted fur stays muted
# A vivid family that dominates the portrait (a bright blue coat) is boosted from lower down,
# because the painter tends to deliver it as a dark, half-saturated version of itself.
VIVID_PROTECT = (.10, .20)
VIVID = (.70, .10)          # portrait median saturation and share that make a family vivid
MIN_SHARE = .03             # a hue family must cover this much of both images' colored pixels
MAX_SATURATION_GAIN = 2.0
MAX_VALUE_GAIN = 1.35


def _hsv(rgb):
    rgb = rgb.astype(np.float64) / 255
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    value = rgb.max(-1)
    low = rgb.min(-1)
    chroma = value - low
    saturation = np.where(value > 0, chroma / np.maximum(value, 1e-9), 0)
    safe = np.maximum(chroma, 1e-9)
    hue = np.where(value == r, ((g - b) / safe) % 6, np.where(value == g, (b - r) / safe + 2, (r - g) / safe + 4))
    hue = np.where(chroma > 1e-9, hue / 6, 0)
    return hue, saturation, value


def _subject(portrait):
    """The middle of the portrait, where the character is; frames and corner text stay out."""
    with Image.open(io.BytesIO(portrait)) as image:
        rgb = np.asarray(image.convert("RGB"))
    h, w = rgb.shape[:2]
    return rgb[int(h * .08):int(h * .92), int(w * .12):int(w * .88)].reshape(-1, 3)


def _families(pixels):
    """Per hue family: (share of colored pixels, median saturation, median value)."""
    hue, saturation, value = _hsv(pixels)
    colored = (saturation >= COLORED) & (value >= .12)
    band = (hue[colored] * BANDS).astype(int) % BANDS
    result = {}
    total = colored.sum()
    for k in range(BANDS):
        member = band == k
        if total and member.sum() / total >= MIN_SHARE:
            result[k] = (member.sum() / total, float(np.median(saturation[colored][member])),
                         float(np.median(value[colored][member])))
    return result


def main_colors(portrait, count=5):
    """The portrait's main colored tones as hex, most common first (k-means on colored pixels)."""
    pixels = _subject(portrait)
    _, saturation, value = _hsv(pixels)
    colored = pixels[(saturation >= .25) & (value >= .18)].astype(np.float64)
    if len(colored) < 50:
        return []
    rng = np.random.default_rng(7)
    sample = colored[rng.choice(len(colored), size=min(len(colored), 4000), replace=False)]
    centers = sample[np.linspace(0, len(sample) - 1, count).astype(int)]
    for _ in range(12):
        nearest = ((sample[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1)
        centers = np.array([sample[nearest == k].mean(0) if (nearest == k).any() else centers[k] for k in range(count)])
    shares = np.bincount(nearest, minlength=count) / len(sample)
    order = [k for k in np.argsort(-shares) if shares[k] >= .05]
    return ["#%02x%02x%02x" % tuple(int(round(c)) for c in centers[k]) for k in order]


def prompt_line(portrait):
    colors = main_colors(portrait)
    if not colors:
        return ""
    return ("\nThe portrait's main colors are " + ", ".join(colors) + ". Paint the costume in these colors at the "
            "portrait's full strength and brightness, with large flat areas of each main color and bold, simple "
            "shading. Do not darken, grey out or wash the colors toward the world reference. Make trim and accents "
            "broad enough to read at a standing height of 73 pixels.")


def _game_size(rgba):
    image = Image.fromarray(rgba, "RGBA")
    size = (max(1, round(image.width * GAME_SCALE)), max(1, round(image.height * GAME_SCALE)))
    # Premultiplied shrink, as the renderer composites it.
    small = np.asarray(image.convert("RGBa").resize(size, Image.Resampling.BOX).convert("RGBA"))
    return small[small[..., 3] > 200][:, :3]


def gains(painting_rgba, portrait):
    """Per hue family: (saturation gain, value gain, protection range) that bring the painting at game
    size up to the portrait."""
    exact, painted = _families(_subject(portrait)), _families(_game_size(painting_rgba))
    # The painter often shifts a hue by a few degrees (electric blue comes back navy), so each
    # painted family is compared with the portrait's family pooled with its two neighbours.
    target = {}
    for k in range(BANDS):
        near = [exact[j % BANDS] for j in (k - 1, k, k + 1) if j % BANDS in exact]
        share = sum(f[0] for f in near)
        if share:
            target[k] = (share, sum(f[0] * f[1] for f in near) / share, sum(f[0] * f[2] for f in near) / share)
    result = {}
    for k in target.keys() & painted.keys():
        s_gain = float(np.clip(target[k][1] / max(painted[k][1], 1e-6), 1, MAX_SATURATION_GAIN))
        v_gain = float(np.clip(target[k][2] / max(painted[k][2], 1e-6), 1, MAX_VALUE_GAIN))
        vivid = target[k][1] >= VIVID[0] and target[k][0] >= VIVID[1]
        if s_gain > 1.02 or v_gain > 1.02:
            result[k] = (s_gain, v_gain, VIVID_PROTECT if vivid else PROTECT)
    return result


def restore(painting, portrait):
    """Return the painted sheet (PNG bytes) with its colors restored; unchanged when it already matches."""
    with Image.open(io.BytesIO(painting)) as image:
        if image.format != "PNG" or image.mode != "RGBA":
            raise ValueError("costume-palette-input")
        rgba = np.asarray(image).copy()
    family_gains = gains(rgba, portrait)
    if not family_gains:
        return painting
    rgb = rgba[..., :3].astype(np.float64) / 255
    hue, saturation, value = _hsv(rgba[..., :3])
    band = (hue * BANDS).astype(int) % BANDS
    s_gain = np.ones(saturation.shape)
    v_gain = np.ones(saturation.shape)
    low = np.full(saturation.shape, PROTECT[0])
    high = np.full(saturation.shape, PROTECT[1])
    for k, (s, v, (lo, hi)) in family_gains.items():
        member = band == k
        s_gain[member], v_gain[member], low[member], high[member] = s, v, lo, hi
    weight = np.clip((saturation - low) / (high - low), 0, 1)
    new_s = np.clip(saturation * (1 + (s_gain - 1) * weight), 0, 1)[..., None]
    new_v = np.clip(value * (1 + (v_gain - 1) * weight), 0, 1)[..., None]
    # Rebuild each pixel with its hue unchanged: keep each channel's position between min and max.
    high = rgb.max(-1, keepdims=True)
    low = rgb.min(-1, keepdims=True)
    position = np.where(high - low > 1e-9, (rgb - low) / np.maximum(high - low, 1e-9), 0)
    new_low = new_v * (1 - new_s)
    out = new_low + position * (new_v - new_low)
    rgba[..., :3] = np.clip(np.round(out * 255), 0, 255).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buffer, "PNG")
    return buffer.getvalue()
