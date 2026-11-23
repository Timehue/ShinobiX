"""Repair a refused arm or leg from the same painting before the rig check, with no paid edit.

The rig check (fit_candidate.py) refuses a whole costume when one limb's outline misses its cutout: on 2026-11-21
Nero's model failed because the north-east leg was refused on all three paintings, while the other 39 pieces were
fine. A painted limb is usually right in its mirror view, so a refused limb is redrawn from that same painting:

1. a leg is first bent to follow the rig's own leg line, the registration every arm already gets;
2. then the best matching limb of the same kind is borrowed, from the mirror view (flipped) or the same view.

Each option is kept only if the rig check then accepts that piece and refuses nothing it accepted before. A sheet
the check accepts, or one it refuses for a torso, a head or the page, is never touched: those go back to the painter.
"""
import contextlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image, ImageOps

MIRROR = {"s": "s", "se": "sw", "e": "w", "ne": "nw", "n": "n", "nw": "ne", "w": "e", "sw": "se"}
LIMBS = ("arm0", "arm1", "leg0", "leg1")
ALPHA = 32  # fit_candidate.py POLICY alphaThreshold


def refused_pieces(report):
    """{(view, part)} the check refused, or None when it refused anything but a limb."""
    pieces = set()
    for code in report["failures"]:
        piece, _, _ = code.partition(":")
        view, _, part = piece.partition("/")
        if view not in MIRROR or part not in LIMBS:
            return None
        pieces.add((view, part))
    return pieces


def outline(image, rect, size, flip):
    x, y, w, h = rect
    crop = image.crop((x, y, x + w, y + h))
    if flip:
        crop = ImageOps.mirror(crop)
    return np.asarray(crop.resize(size, Image.Resampling.LANCZOS))[:, :, 3] > ALPHA


def overlap(a, b):
    union = np.sum(a | b)
    return float(np.sum(a & b) / union) if union else 0.


def donors(views, guide, view, part, refused):
    """Limbs of the same kind that could stand in, best guide match first."""
    kind = part[:3]
    rect = views[view][part]["guideRect"]
    size = (rect[2], rect[3])
    target = outline(guide, rect, size, False)
    options = []
    for donor_view, flip in ((MIRROR[view], True), (view, False), (view, True)):
        for donor in (kind + "0", kind + "1"):
            if (donor_view, donor) == (view, part) or (donor_view, donor) in refused:
                continue
            match = overlap(outline(guide, views[donor_view][donor]["guideRect"], size, flip), target)
            options.append((match, donor_view, donor, flip))
    options.sort(key=lambda option: -option[0])
    return options


def repair(candidate, template, fit, register, log=print):
    """Rewrite the registered sheet at candidate when its refused limbs can be redrawn from the same painting.

    fit(sheet, parts_dir, template) is the rig check; register(piece, guide_piece) bends a limb to the guide's line
    (register_painted_kit.register_arm). Returns the repairs made, as "view/part from view/part[ flipped]"."""
    candidate, template = Path(candidate), Path(template)
    views = json.loads(template.read_bytes())["views"]
    guide = Image.open(template.with_suffix(".png")).convert("RGBA")
    with Image.open(candidate) as opened:
        sheet = opened.convert("RGBA")

    def check(image):
        """The refused pieces (None past a limb), and each piece's outline overlap with its cutout."""
        with TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            path = Path(directory) / "sheet.png"
            image.save(path)
            report = fit(path, Path(directory) / "parts", template)
        return refused_pieces(report), {(p["view"], p["part"]): p.get("silhouetteIou", 0.) for p in report["parts"]}

    refused, _ = check(sheet)
    if not refused:
        return []
    repairs = []
    for view, part in sorted(refused):
        rect = views[view][part]["guideRect"]
        x, y, w, h = rect
        guide_piece = guide.crop((x, y, x + w, y + h))
        options = []
        if part.startswith("leg"):
            options.append((f"{view}/{part} along the rig's leg line", lambda: sheet.crop((x, y, x + w, y + h))))
        for _, donor_view, donor, flip in donors(views, guide, view, part, refused):
            def borrowed(donor_view=donor_view, donor=donor, flip=flip):
                dx, dy, dw, dh = views[donor_view][donor]["guideRect"]
                piece = sheet.crop((dx, dy, dx + dw, dy + dh))
                return (ImageOps.mirror(piece) if flip else piece).resize((w, h), Image.Resampling.LANCZOS)
            options.append((f"{view}/{part} from {donor_view}/{donor}" + (" flipped" if flip else ""), borrowed))
        # Of the options the check accepts, keep the one closest to its cutout: a leg bent until it just passes
        # is worse than the painting's own matching leg.
        best = None
        for name, piece in options:
            trial = sheet.copy()
            trial.paste((0, 0, 0, 0), tuple(views[view][part]["slot"]))
            trial.alpha_composite(register(piece(), guide_piece), (x, y))
            after, fits = check(trial)
            if (after is not None and (view, part) not in after and after <= refused
                    and (best is None or fits[(view, part)] > best[0])):
                best = (fits[(view, part)], name, trial, after)
        if best is not None:
            _, name, sheet, refused = best
            repairs.append(name)
            log("limb-repair " + name, flush=True)
    if repairs:
        sheet.save(candidate)
    return repairs
