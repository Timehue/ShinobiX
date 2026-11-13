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


def paint(entry, work, asset, master, source, reader_python, submit):
    sys.path.insert(0, str(entry.resolve(strict=True).parent))
    from motion_worker_paths import TEMPLATES
    from paint_portrait import costume_painter, portrait_palette
    from register_painted_kit import paint_screened_upload

    upload = work / "portrait"
    descriptor = (work/"screened.json").read_bytes()
    rig, template_digest = admitted_rig(asset, descriptor, master, upload.read_bytes(), source)
    template = TEMPLATES / rig
    if sha256(template.read_bytes()).hexdigest() != template_digest:
        raise ValueError("screened-rig-revision-mismatch")
    operations = set()

    def reserve(job, operation):
        if job != asset or operation in operations or len(operations) >= 2:
            return False
        operations.add(operation)
        return True

    screened = json.loads(descriptor)["fit"]
    closeup = screened.get("requiresPainting") is True
    painter = costume_painter(work/"edits", asset, reserve, submit, closeup=closeup,
                              armored_raccoon=closeup and screened.get("style") == "armored-raccoon",
                              upright_animal=closeup and screened.get("style") == "upright-animal",
                              palette=portrait_palette)
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
    paint(args.entry, args.work, args.asset, args.master, args.source, args.reader_python,
          lambda body, operation: submit_edit(body, os.environ["OPENAI_API_KEY"], operation))
