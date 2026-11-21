"""Paint the costume of one admitted character on the installed rig."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sys


def admitted_rig(asset, descriptor, expected_master, raw, source):
    if not re.fullmatch("[a-f0-9]{32}", asset) or not 0 < len(raw) <= 3 * 1024**2:
        raise ValueError("invalid-paint-input")
    if len(descriptor) > 64 * 1024 or sha256(descriptor).hexdigest() != expected_master or sha256(raw).hexdigest() != source:
        raise ValueError("wrong-admitted-portrait")
    master = json.loads(descriptor)
    fit = master["fit"]
    if (master["version"] != 1 or fit["sourceSha256"] != source or fit["declined"] is not None
            or fit.get("paintingSha256") or fit["template"] not in (
                "male-coat-template.json", "female-coat-template.json", "masked-collar-template.json")):
        raise ValueError("invalid-admitted-rig")
    return fit["template"], master["templateSha256"]


# The rig check (fit_candidate.py) names a refused piece by code, as in "ne/leg1:silhouette". The painter cannot
# act on a code: on 2026-11-21 it was shown exactly that line twice and repainted the same leg both times. Each code
# is also said in words, naming the piece by its column and row on the page.
COLUMNS = {"s": (1, "south"), "se": (2, "southeast"), "e": (3, "east"), "ne": (4, "northeast"),
           "n": (5, "north"), "nw": (6, "northwest"), "w": (7, "west"), "sw": (8, "southwest")}
ROWS = {"body": (1, "head and torso"), "arm0": (2, "first arm"), "arm1": (3, "second arm"),
        "leg0": (4, "first leg"), "leg1": (5, "second leg")}
PROBLEMS = {
    "silhouette": "does not match the shape of its cutout. Repaint it to fill that cutout's outline closely, "
                  "with nothing added past its edges and no part of the cutout left empty",
    "geometry-scale": "is the wrong size. Repaint it at the height and width of its cutout",
    "slot-placement": "is off center. Repaint it centered where its cutout sits",
    "slot-edge": "runs to the edge of its cell. Keep it inside its cutout with a clear transparent margin",
    "missing-part": "is missing. Paint it inside its cutout",
    "disconnected-part": "is broken into separate pieces. Paint it as one connected shape, with nothing floating "
                         "beside it",
    "joint-outside-art": "leaves a joint of the cutout unpainted. Fill the cutout all the way to its ends",
    "profile-boot-direction": "has its boot pointing the wrong way. The toe points the way the head faces",
}


def explain(correction):
    """The rig's own report, followed by the same report in words the painter can follow."""
    prefix = "Incompatible painting: "
    if not correction or not correction.startswith(prefix):
        return correction
    notes = []
    for code in correction[len(prefix):].split(", "):
        piece, _, problem = code.partition(":")
        view, _, part = piece.partition("/")
        if view in COLUMNS and part in ROWS and problem in PROBLEMS:
            column, heading = COLUMNS[view]
            row, name = ROWS[part]
            notes.append(f"The {name} in the {heading} view (column {column}, row {row}) {PROBLEMS[problem]}.")
    if not notes:
        return correction
    return correction + ". In words: " + " ".join(notes) + " Leave every other cutout as it is."


def explained(painter):
    def paint(upload_path, digest, template_path, attempt, correction):
        return painter(upload_path, digest, template_path, attempt, explain(correction))
    return paint


def likeness_checked(painter, upload, template, asker, refuse):
    """Run the likeness check on every painting the rig is about to receive.

    A painting that lost the portrait's character is refused like a geometry failure, so the
    rig's own loop (paint_screened_upload) repairs that same sheet with the check's note, and a
    third refusal ends the job at once instead of after an hour of rendering."""
    import painted_likeness
    from avatar_worker.portrait import prepare_portrait
    from PIL import Image

    spec = json.loads(template.read_bytes())
    with Image.open(template.with_suffix(".png")) as guide:
        guide_size = guide.size
    portrait = prepare_portrait(upload.read_bytes()).png

    def paint(upload_path, digest, template_path, attempt, correction):
        painting, painting_hash = painter(upload_path, digest, template_path, attempt, correction)
        note = painted_likeness.check(portrait, painting.read_bytes(), spec, guide_size, asker)
        if note is not None:
            raise refuse(note)
        return painting, painting_hash

    return paint


# A round whose three paintings were all refused exits with this code, so the costume call can paint one more round.
REFUSED = 3


def paint(entry, work, asset, master, source, reader_python, submit, likeness=None, round_number=1):
    """likeness(portrait_png, row_png) asks the vision model; None skips the post-paint check.
    round_number 2 is a fresh painting after a first round the rig refused three times: its edits keep their own
    folder and billing identity, so nothing of the first round is replayed or overwritten."""
    if round_number not in (1, 2):
        raise ValueError("invalid-paint-round")
    sys.path.insert(0, str(entry.resolve(strict=True).parent))
    from motion_worker_paths import TEMPLATES
    from paint_portrait import costume_painter, portrait_palette
    from register_painted_kit import PaintingGeometryError, paint_screened_upload

    upload = work / "portrait"
    descriptor = (work/"screened.json").read_bytes()
    rig, template_digest = admitted_rig(asset, descriptor, master, upload.read_bytes(), source)
    template = TEMPLATES / rig
    if sha256(template.read_bytes()).hexdigest() != template_digest:
        raise ValueError("screened-rig-revision-mismatch")
    operations = set()
    job = asset if round_number == 1 else f"{asset}/round-{round_number}"

    # One painting plus up to two repairs (paint_screened_upload).
    def reserve(reserved_job, operation):
        if reserved_job != job or operation in operations or len(operations) >= 3:
            return False
        operations.add(operation)
        return True

    screened = json.loads(descriptor)["fit"]
    closeup = screened.get("requiresPainting") is True
    edits = work/"edits" if round_number == 1 else work/f"edits-{round_number}"
    painter = costume_painter(edits, job, reserve, submit, closeup=closeup,
                              armored_raccoon=closeup and screened.get("style") == "armored-raccoon",
                              upright_animal=closeup and screened.get("style") == "upright-animal",
                              palette=portrait_palette)
    if likeness is not None:
        painter = likeness_checked(painter, upload, template, likeness, PaintingGeometryError)
    painter = explained(painter)
    paint_screened_upload(upload, source, template, work/"painted", painter, lambda _: None,
                          reader_python=reader_python)
    return sorted(operations)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("entry", "work", "reader_python"):
        parser.add_argument(name, type=Path)
    for name in ("asset", "master", "source"):
        parser.add_argument(name)
    parser.add_argument("--round", type=int, choices=(1, 2), default=1, dest="round_number")
    args = parser.parse_args()
    from paint_portrait import submit_edit
    import painted_likeness
    sys.path.insert(0, str(args.entry.resolve(strict=True).parent))
    from register_painted_kit import PaintingGeometryError
    try:
        paint(args.entry, args.work, args.asset, args.master, args.source, args.reader_python,
              lambda body, operation: submit_edit(body, os.environ["OPENAI_API_KEY"], operation),
              likeness=lambda portrait, row: painted_likeness.ask(portrait, row, os.environ["OPENAI_API_KEY"]),
              round_number=args.round_number)
    except PaintingGeometryError:
        import traceback
        traceback.print_exc()
        sys.exit(REFUSED)
