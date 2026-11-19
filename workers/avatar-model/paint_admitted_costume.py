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


def paint(entry, work, asset, master, source, reader_python, submit, likeness=None):
    """likeness(portrait_png, row_png) asks the vision model; None skips the post-paint check."""
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

    # One painting plus up to two repairs (paint_screened_upload).
    def reserve(job, operation):
        if job != asset or operation in operations or len(operations) >= 3:
            return False
        operations.add(operation)
        return True

    screened = json.loads(descriptor)["fit"]
    closeup = screened.get("requiresPainting") is True
    painter = costume_painter(work/"edits", asset, reserve, submit, closeup=closeup,
                              armored_raccoon=closeup and screened.get("style") == "armored-raccoon",
                              upright_animal=closeup and screened.get("style") == "upright-animal",
                              palette=portrait_palette)
    if likeness is not None:
        painter = likeness_checked(painter, upload, template, likeness, PaintingGeometryError)
    paint_screened_upload(upload, source, template, work/"painted", painter, lambda _: None,
                          reader_python=reader_python)
    return sorted(operations)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("entry", "work", "reader_python"):
        parser.add_argument(name, type=Path)
    for name in ("asset", "master", "source"):
        parser.add_argument(name)
    args = parser.parse_args()
    from paint_portrait import submit_edit
    import painted_likeness
    paint(args.entry, args.work, args.asset, args.master, args.source, args.reader_python,
          lambda body, operation: submit_edit(body, os.environ["OPENAI_API_KEY"], operation),
          likeness=lambda portrait, row: painted_likeness.ask(portrait, row, os.environ["OPENAI_API_KEY"]))
