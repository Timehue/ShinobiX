"""Screen a single illustrated close-up for painting on the neutral human rig."""
import argparse
from hashlib import sha256
from io import BytesIO
import json
from math import isfinite
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


def overlap(a, b):
    left, top, right, bottom = a
    x, y, end_x, end_y = b
    area = max(0, min(right, end_x) - max(left, x)) * max(0, min(bottom, end_y) - max(top, y))
    return area / ((right - left) * (bottom - top) + (end_x - x) * (end_y - y) - area)


def single_closeup(read):
    width, height = read["size"]

    def boxes(group, label, threshold):
        return [tuple(row["box"]) for row in read.get(group, ())
                if row["label"] == label and row["score"] >= threshold
                and len(row["box"]) == 4 and all(map(isfinite, row["box"]))
                and 0 <= row["box"][0] < row["box"][2] <= width + 1
                and 0 <= row["box"][1] < row["box"][3] <= height + 1]

    groups = ("robeRegions", "hoodRegions", "medicRegions")
    face_groups = [boxes(group, "a face", .64) for group in groups]
    faces = [box for group in face_groups for box in group]
    if sum(map(bool, face_groups)) < 2:
        return False
    face = faces[0]
    l, t, r, b = face
    if (not .19 <= (b-t)/height <= .72 or (r-l)/width < .15
            or not all(overlap(face, box) >= .75 for box in faces)
            or any(overlap(face, other) < .55 for group in ("regions", *groups)
                   for other in boxes(group, "a face", .44))):
        return False

    cx, cy = (l+r)/2, (t+b)/2
    people = boxes("regions", "a person", .32)
    if not any(x <= l < r <= end_x and y <= t < b <= end_y and end_y >= b + .20*height
               for x, y, end_x, end_y in people):
        return False
    if any(overlap(people[0], box) < .60 for box in people[1:]):
        return False
    hair = boxes("regions", "hair", .30)
    other_hair = boxes("robeRegions", "hair", .29) + boxes("hoodRegions", "hair", .29)
    return any(x <= cx <= end_x and y < cy <= end_y and overlap((x, y, end_x, end_y), other) >= .75
               for x, y, end_x, end_y in hair for other in other_hair)


def prepare(entry, upload, master, reader_python, digest):
    sys.path.insert(0, str(entry.parent))
    from motion_worker_paths import TEMPLATES
    from avatar_worker.portrait import prepare_portrait
    from avatar_worker.saved_kit import write_fitted_master
    from paint_portrait import layout_png
    from PIL import Image
    from armored_raccoon import face_and_muzzle, confirms_armor

    raw = upload.read_bytes()
    with Image.open(BytesIO(raw)) as image:
        static = getattr(image, "n_frames", 1) == 1
    portrait = prepare_portrait(raw)
    if portrait.source_sha256 != digest:
        raise ValueError("closeup-source-mismatch")
    with Image.open(BytesIO(portrait.png)) as image:
        if image.convert("RGBA").getchannel("A").getextrema() != (255, 255):
            return
    with TemporaryDirectory(dir=master.parent) as temp:
        reads = Path(temp) / "reads"
        subprocess.run([reader_python, entry.with_name("read_masked_kit.py"), "--supported-families",
                        "--full-figure-equipment", "--out", reads, upload], check=True)
        read = json.loads((reads / f"{digest}.json").read_bytes())
        if (read["sha256"], tuple(read["size"]), read["frame"]) != (
                digest, (portrait.width, portrait.height), portrait.frame_index):
            raise ValueError("closeup-read-mismatch")
        style = "portrait-bust-coat" if static and single_closeup(read) else None
        if style is None:
            subject = face_and_muzzle(read)
            if subject is None:
                return
            armor_read = Path(temp) / "armor.json"
            subprocess.run([reader_python, Path(__file__).with_name("armored_raccoon.py"), entry, upload,
                            armor_read], check=True)
            armor = json.loads(armor_read.read_bytes())
            if (armor["sha256"], tuple(armor["size"]), armor["frame"]) != (
                    digest, (portrait.width, portrait.height), portrait.frame_index):
                raise ValueError("armored-raccoon-read-mismatch")
            if not confirms_armor(*subject, armor["regions"]):
                return
            style = "armored-raccoon"
        template = TEMPLATES / "male-coat-template.json"
        guide = layout_png(template)
        (master / "candidate.png").write_bytes(guide)
        fit = {"sourceSha256": digest, "declined": None, "style": style,
               "sheetSha256": sha256(guide).hexdigest(), "template": template.name, "requiresPainting": True}
        receipt = {key: fit[key] for key in ("sourceSha256", "declined", "style", "sheetSha256")}
        receipt["fittedMasterSha256"] = write_fitted_master(master, fit, template)
        staged = master / "read.tmp"
        staged.write_text(json.dumps(receipt))
        staged.replace(master / "read.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("entry", "upload", "master", "reader_python"):
        parser.add_argument(name, type=Path)
    parser.add_argument("digest")
    args = parser.parse_args()
    prepare(args.entry, args.upload, args.master, args.reader_python, args.digest)
