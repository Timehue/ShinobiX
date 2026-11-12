"""Submit or retrieve a standalone, detached portrait-to-game-package trial."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
from uuid import uuid4

import modal


ENVIRONMENT = "shinobix-avatar-staging"
PAINT_SECRET = os.environ.get("SPRITE_TRIAL_PAINT_SECRET", "shinobix-avatar-costume-paint")
INSTALL = Path("/opt/sprite")
WORKER = Path(__file__).with_name("modal_sprite_worker.py")
MAX_PORTRAIT = 3 * 1024**2
TRIAL_GPUS = ["L4", "A10", "T4"]
app = modal.App("shinobix-avatar-portrait-trial")
reader_image = motion_image = assembly_image = None
if modal.is_local() and sys.argv[1:2] != ["collect"]:
    os.environ["SPRITE_PAINTED_COSTUMES"] = "1"
    os.environ["SPRITE_WORKER_PLAN_PREWARM"] = "0"
    from modal_sprite_worker import cpu_image, gpu_image, paint_image

    cached_reader = os.environ.get("SPRITE_TRIAL_READER_IMAGE_ID")
    if cached_reader:
        gpu_image = modal.Image.from_id(cached_reader)
    cached_assembly = os.environ.get("SPRITE_TRIAL_ASSEMBLY_IMAGE_ID")
    if cached_assembly:
        cpu_image = modal.Image.from_id(cached_assembly)
    cached_motion = os.environ.get("SPRITE_TRIAL_MOTION_IMAGE_ID")
    if cached_motion:
        release = json.loads(Path(os.environ["SPRITE_WORKER_RELEASE_MANIFEST"]).read_bytes())
        motion_hash = release["movement"]
        if not re.fullmatch(r"im-[A-Za-z0-9]+", cached_motion) or not re.fullmatch(r"[a-f0-9]{64}", motion_hash):
            raise ValueError("invalid-cached-motion-image")
        # Reuse a sealed renderer only when it contains the exact same movement archive.
        paint_image = modal.Image.from_id(cached_motion).run_commands(
            f"echo '{motion_hash}  /opt/sprite/motion.zip' | sha256sum -c -",
            "/opt/sprite/blender/blender --background --factory-startup --version",
        )
    reader_image, motion_image, assembly_image = (
        image.add_local_file(WORKER, (INSTALL / WORKER.name).as_posix(), copy=True)
        for image in (gpu_image, paint_image, cpu_image)
    )
    for name in ("closeup_portrait.py", "armored_raccoon.py", "paint_admitted_costume.py", "paint_portrait.py"):
        reader_image = reader_image.add_local_file(WORKER.with_name(name), str(INSTALL / name), copy=True)
    assembly_image = assembly_image.add_local_file(
        WORKER.with_name("modal_trial_preview.py"), "/opt/sprite/modal_trial_preview.py", copy=True
    ).add_local_file(WORKER.parents[2] / "shinobij.client/public/sector-map/s46.webp",
                     "/opt/sprite/trial-sector.webp", copy=True)
    combiner = os.environ.get("SPRITE_TRIAL_ASSEMBLY_COMBINER")
    if combiner:
        assembly_image = assembly_image.add_local_file(
            WORKER.with_name("finish_sprite.py"), "/opt/sprite/finish_sprite.py", copy=True
        ).add_local_file(combiner, "/opt/sprite/run_style_package.py", copy=True)


@app.function(image=reader_image, gpu=TRIAL_GPUS, cpu=2, memory=6144, timeout=600, retries=0, max_containers=1)
def read_trial(portrait, source):
    sys.path.insert(0, str(INSTALL))
    from modal_sprite_worker import read_private_upload

    entry = Path((INSTALL / "entry.txt").read_text().strip())
    return read_private_upload(portrait, source, entry, INSTALL / "paint/bin/python",
                               INSTALL / "reader/bin/python", painted_costumes=True)


@app.function(image=reader_image, gpu=TRIAL_GPUS, timeout=1800, retries=0, max_containers=1,
              secrets=[modal.Secret.from_name(PAINT_SECRET, environment_name=ENVIRONMENT,
                                              required_keys=["OPENAI_API_KEY"])])
def paint_trial(asset, descriptor, master, portrait, source):
    sys.path.insert(0, str(INSTALL))
    from modal_sprite_worker import paint_costume

    return paint_costume.local(asset, descriptor, master, portrait, source)


@app.function(image=motion_image, cpu=4, memory=8192, timeout=6 * 3600, retries=0, max_containers=3)
def render_trial(descriptor, sheet, master, style):
    sys.path.insert(0, str(INSTALL))
    from modal_sprite_worker import render_style

    return render_style.local(descriptor, sheet, master, style)


@app.function(image=assembly_image, cpu=2, memory=4096, timeout=1800, retries=0, max_containers=1)
def assemble_trial(asset, descriptor, master, calls, movement):
    sys.path.insert(0, str(INSTALL))
    from modal_sprite_worker import finish_styles

    result = finish_styles.local(asset, descriptor, master, calls, movement=movement)
    if result.get("lostStyle"):
        return result
    source = json.loads(descriptor)["fit"]["sourceSha256"]
    with TemporaryDirectory() as temporary:
        folder = Path(temporary)
        (folder / "receipt.json").write_text(json.dumps({"model": result["model"], "sourceSha256": source}))
        objects = folder / "objects"
        objects.mkdir()
        for name, data in result["objects"].items():
            (objects / name).write_bytes(data)
        preview = folder / "preview.png"
        video = folder / "motion.mp4"
        try:
            subprocess.run([INSTALL / "paint/bin/python", INSTALL / "modal_trial_preview.py", folder,
                            INSTALL / "trial-sector.webp", preview, video], check=True, timeout=240)
        except subprocess.SubprocessError as error:
            result["previewError"] = type(error).__name__
        if preview.is_file():
            result["preview"] = preview.read_bytes()
            result["previewSha256"] = sha256(result["preview"]).hexdigest()
        if "previewError" not in result and video.is_file():
            video_bytes = video.read_bytes()
            result["media"] = {"motion.mp4": video_bytes}
            result["mediaSha256"] = {"motion.mp4": sha256(video_bytes).hexdigest()}
    return result


@app.function(timeout=7 * 3600, retries=0, max_containers=1)
def portrait_to_game_model(portrait, source, asset):
    if not isinstance(portrait, bytes) or not 0 < len(portrait) <= MAX_PORTRAIT or sha256(portrait).hexdigest() != source:
        raise ValueError("invalid-trial-portrait")
    fit = read_trial.remote(portrait, source)
    return run_fitted_trial(portrait, source, asset, fit)


def run_fitted_trial(portrait, source, asset, fit):
    receipt = fit["receipt"]
    if receipt["declined"] is not None:
        raise ValueError("portrait-intake-declined: " + receipt["declined"])
    print("Portrait read complete. Painting the directional costume.", flush=True)
    painted = paint_trial.remote(asset, fit["descriptor"], receipt["fittedMasterSha256"], portrait, source)
    descriptor, sheet = painted["descriptor"], painted["sheet"]
    master = painted["receipt"]["fittedMasterSha256"]
    if (painted["screened"] != receipt["fittedMasterSha256"] or painted["receipt"]["sourceSha256"] != source
            or sha256(descriptor).hexdigest() != master or sha256(sheet).hexdigest() != painted["receipt"]["sheetSha256"]):
        raise ValueError("invalid-trial-paint-result")
    print("Painting registered. Rendering all three styles.", flush=True)
    stages = {style: render_trial.spawn(descriptor, sheet, master, style) for style in "ABC"}
    movement = None
    for style, call in stages.items():
        stage = call.get()["receipt"]
        if stage["style"] != style or (movement is not None and stage["movement"] != movement):
            raise ValueError("inconsistent-trial-motion")
        movement = stage["movement"]
    result = assemble_trial.remote(asset, descriptor, master, {s: call.object_id for s, call in stages.items()}, movement)
    if result.get("lostStyle"):
        raise ValueError("trial-render-expired-before-assembly")
    return {"sourceSha256": source, "paintedMasterSha256": master, **result}


def submit(source_file, output):
    with source_file.open("rb") as handle:
        portrait = handle.read(MAX_PORTRAIT + 1)
    if not 0 < len(portrait) <= MAX_PORTRAIT:
        raise ValueError("Expected a saved portrait of at most 3 MiB")
    source, asset = sha256(portrait).hexdigest(), uuid4().hex
    output.mkdir(parents=True)
    receipt = {"sourceSha256": source, "assetId": asset, "environment": ENVIRONMENT}
    path = output / "submission.json"
    path.write_text(json.dumps(receipt, indent=2))
    with modal.enable_output(), app.run(detach=True, environment_name=ENVIRONMENT):
        call = portrait_to_game_model.spawn(portrait, source, asset)
        receipt["callId"] = call.object_id
        staged = path.with_suffix(".tmp")
        staged.write_text(json.dumps(receipt, indent=2))
        staged.replace(path)
        print(f"Submitted {call.object_id}. The job continues in Modal.", flush=True)


def collect(output, *, reassembled=False):
    receipt = json.loads((output / "submission.json").read_bytes())
    call_id = json.loads((output / "reassembly.json").read_bytes())["callId"] if reassembled else receipt["callId"]
    if receipt["environment"] != ENVIRONMENT or not re.fullmatch(r"fc-[A-Za-z0-9]+", call_id):
        raise ValueError("invalid-trial-submission")
    try:
        result = modal.FunctionCall.from_id(call_id).get(timeout=0)
    except TimeoutError:
        print("The hosted trial is still running.")
        return
    model, objects = result["model"], result["objects"]
    asset, version = model["assetId"], model["version"]
    if (asset != receipt["assetId"] or result["sourceSha256"] != receipt["sourceSha256"]
            or not re.fullmatch(r"[a-f0-9]{32}", asset) or not re.fullmatch(r"[a-f0-9]{64}", version)
            or version + ".json" not in objects or len(objects) != model["objects"]
            or sum(map(len, objects.values())) != model["bytes"]):
        raise ValueError("invalid-trial-delivery")
    for name, data in objects.items():
        if not re.fullmatch(r"[a-f0-9]{64}\.(json|gz|264|webp)", name) or sha256(data).hexdigest() != name.split(".")[0]:
            raise ValueError("damaged-trial-object")
    manifest = json.loads(objects[version + ".json"])
    if manifest["portraitSha256"] != receipt["sourceSha256"]:
        raise ValueError("trial-delivery-portrait-mismatch")
    path = output / "sector-models" / "players" / asset
    path.mkdir(parents=True, exist_ok=True)
    manifest_name = version + ".json"
    for name, data in objects.items():
        if name != manifest_name:
            (path / name).write_bytes(data)
    (path / manifest_name).write_bytes(objects[manifest_name])
    if "preview" in result:
        if sha256(result["preview"]).hexdigest() != result["previewSha256"]:
            raise ValueError("damaged-trial-preview")
        (output / "preview.png").write_bytes(result["preview"])
    for name, data in result.get("media", {}).items():
        if name not in ("preview.png", "sky-motion.mp4", "motion.mp4") or sha256(data).hexdigest() != result["mediaSha256"][name]:
            raise ValueError("damaged-trial-media")
        (output / name).write_bytes(data)
    (output / "result.json").write_text(json.dumps({
        k: v for k, v in result.items() if k not in ("objects", "preview", "media")
    }, indent=2))
    print(f"Retrieved the verified game package at {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    enqueue = commands.add_parser("submit")
    enqueue.add_argument("portrait", type=Path)
    enqueue.add_argument("output", type=Path)
    retrieve = commands.add_parser("collect")
    retrieve.add_argument("output", type=Path)
    retrieve.add_argument("--reassembled", action="store_true")
    args = parser.parse_args()
    if args.action == "submit":
        submit(args.portrait, args.output)
    else:
        collect(args.output, reassembled=args.reassembled)
