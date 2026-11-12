"""Private CPU and GPU stages for the hosted sprite worker."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory

import modal


HERE = Path(__file__).resolve().parent
INSTALL = Path("/opt/sprite")
MAX_UPLOAD = 20 * 1024 * 1024
app = modal.App("shinobix-avatar-sprites")


def worker_image():
    # CPython 3.12.14, slim Bookworm, official linux/amd64 manifest.
    image = modal.Image.from_registry(
        "python@sha256:1aaa65a85fda306ffb8b910824d4e93bdce61e212c7e87168123ea3073b41a1a"
    ).apt_install(
        "libgl1", "libglib2.0-0", "libportaudio2", "libgomp1"
    )
    painted = os.environ.get("SPRITE_PAINTED_COSTUMES") == "1"
    release = "sprite-worker-painted-review.json" if painted else "sprite-worker-release.json"
    manifest = Path(os.environ.get("SPRITE_WORKER_RELEASE_MANIFEST", str(HERE / release))).resolve(strict=True)
    image = image.add_local_file(manifest, "/opt/sprite/sprite-worker-release.json", copy=True)
    for name in (".python-version", "requirements-linux-paint.txt",
                 "install_sprite_worker.py", "finish_sprite.py", "paint_sprite_style.py", "browser_motion.py",
                 "verify_moderated_frame.py", "recognition_lineup.py", "recognition_worker.py", "requirements-recognition.txt"):
        image = image.add_local_file(HERE / name, "/opt/sprite/" + name, copy=True)
    if painted:
        image = image.env({"SPRITE_PAINTED_COSTUMES":"1"})
        for name in ("paint_admitted_costume.py", "paint_portrait.py", "closeup_portrait.py", "armored_raccoon.py",
                     "sector-costume-light.png"):
            image = image.add_local_file(HERE / name, "/opt/sprite/" + name, copy=True)
    image = image.run_commands(
        'python -c "import platform,pathlib; assert platform.python_version() == pathlib.Path(\'/opt/sprite/.python-version\').read_text().strip()"',
        "python -m venv /opt/sprite/paint",
        "/opt/sprite/paint/bin/pip install --no-cache-dir -r /opt/sprite/requirements-linux-paint.txt",
        "/opt/sprite/paint/bin/pip check",
    )
    # These archives are deployment inputs. Remote function imports use the baked installation.
    intake = Path(os.environ["SPRITE_INTAKE_ZIP"]).resolve(strict=True)
    movement = Path(os.environ["SPRITE_MOVEMENT_ZIP"]).resolve(strict=True)
    image = image.add_local_file(intake, "/opt/sprite/intake.zip", copy=True)
    image = image.add_local_file(movement, "/opt/sprite/motion.zip", copy=True)
    return image.run_commands(
        "python /opt/sprite/install_sprite_worker.py /opt/sprite/intake.zip /opt/sprite/motion.zip "
        "/opt/sprite/release > /opt/sprite/entry.txt",
        "/opt/sprite/paint/bin/python -c 'import cv2, mediapipe, imageio_ffmpeg; "
        "print(imageio_ffmpeg.get_ffmpeg_version())'",
    )


cpu_image = worker_image() if modal.is_local() else None
gpu_image = None
paint_image = None
recognition_image = None
if modal.is_local():
    pool = os.environ.get("SPRITE_RECOGNITION_POOL_ZIP")
    if pool:
        pool_hash = os.environ["SPRITE_RECOGNITION_POOL_SHA256"]
        pool_path = Path(pool).resolve(strict=True)
        if not re.fullmatch(r"[a-f0-9]{64}", pool_hash) or hashlib.sha256(pool_path.read_bytes()).hexdigest() != pool_hash:
            raise ValueError("recognition-pool-deployment-binding")
        recognition_image = cpu_image.add_local_file(pool_path, "/opt/sprite/recognition-pool.zip", copy=True).env({
            "SPRITE_RECOGNITION_POOL_SHA256":pool_hash, "SPRITE_RECOGNITION_MODEL":os.environ["SPRITE_RECOGNITION_MODEL"]
        }).run_commands("python -m pip install --no-cache-dir -r /opt/sprite/requirements-recognition.txt", "python -m pip check")
    gpu_image = cpu_image.add_local_file(HERE / "requirements-linux-reader.txt",
                                         "/opt/sprite/requirements-linux-reader.txt", copy=True).run_commands(
        "python -m venv /opt/sprite/reader",
        "/opt/sprite/reader/bin/pip install --no-cache-dir --no-deps "
        "--index-url https://download.pytorch.org/whl/cu126 torch==2.7.1+cu126 torchvision==0.22.1+cu126",
        "/opt/sprite/reader/bin/pip install --no-cache-dir -r /opt/sprite/requirements-linux-reader.txt",
        "/opt/sprite/reader/bin/pip check",
        "/opt/sprite/reader/bin/python -c 'from transformers import AutoModelForZeroShotObjectDetection'",
    )
    paint_image = cpu_image
    if os.environ.get("SPRITE_WORKER_PLAN_PREWARM") != "0":
        paint_image = paint_image.add_local_file(HERE / "warm_sprite_plans.py",
                                                "/opt/sprite/warm_sprite_plans.py", copy=True).run_commands(
            "/opt/sprite/paint/bin/python /opt/sprite/warm_sprite_plans.py /opt/sprite/entry.txt"
        )
    paint_image = paint_image.apt_install("curl", "xz-utils", "libxi6", "libxrender1", "libxfixes3",
                                        "libsm6", "libxkbcommon0", "libegl1", "libgl1-mesa-dri")
    tarball = "/tmp/blender-4.5.11-linux-x64.tar.xz"
    local_blender = os.environ.get("SPRITE_BLENDER_ARCHIVE")
    if local_blender:
        paint_image = paint_image.add_local_file(Path(local_blender).resolve(strict=True), tarball, copy=True)
    else:
        paint_image = paint_image.run_commands("curl -fsSL --retry 3 -o " + tarball +
            " https://download.blender.org/release/Blender4.5/blender-4.5.11-linux-x64.tar.xz")
    paint_image = paint_image.run_commands(
        "echo '05ed7bd41bf3e61ae4f4a7cdc364c43088bf8b3fed702c2269c018fdf63a2188  " +
        tarball + "' | sha256sum -c -",
        "mkdir /opt/sprite/blender && tar -xJf " + tarball + " -C /opt/sprite/blender --strip-components=1",
        "/opt/sprite/blender/blender --background --factory-startup --version",
    )


def read_private_upload(raw, expected_sha256, entry, paint_python, reader_python, frame_hash=None, *, painted_costumes=False):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_UPLOAD:
        raise ValueError("portrait-size")
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise ValueError("portrait-source-mismatch")
    with TemporaryDirectory() as directory:
        work = Path(directory)
        upload = work / "upload"
        upload.write_bytes(raw)
        if frame_hash is not None:
            proof = subprocess.run([paint_python, INSTALL / "verify_moderated_frame.py", entry, upload],
                                   check=True, capture_output=True, text=True, timeout=30)
            if proof.stdout.strip() != frame_hash:
                return {"receipt": {"sourceSha256": expected_sha256, "declined": "frame-mismatch"}}
        master = work / "master"
        subprocess.run([paint_python, entry.with_name("portrait_intake.py"), upload, master,
                        "--source-sha256", expected_sha256, "--reader-python", reader_python,
                        *(["--full-figure-equipment", "--portrait-bust"] if painted_costumes else [])],
                       stdout=subprocess.DEVNULL, check=True)
        receipt = json.loads((master / "read.json").read_bytes())
        if painted_costumes and receipt["declined"] == "portrait-bust-fit-uncertain":
            subprocess.run([paint_python, INSTALL / "closeup_portrait.py", entry, upload, master,
                            reader_python, expected_sha256], stdout=subprocess.DEVNULL, check=True)
            receipt = json.loads((master / "read.json").read_bytes())
        if receipt["sourceSha256"] != expected_sha256:
            raise ValueError("portrait-read-mismatch")
        if receipt["declined"] is not None:
            return {"receipt": receipt}
        descriptor = (master / "fitted-master.json").read_bytes()
        sheet = (master / "candidate.png").read_bytes()
        if (hashlib.sha256(descriptor).hexdigest() != receipt["fittedMasterSha256"] or
                hashlib.sha256(sheet).hexdigest() != receipt["sheetSha256"]):
            raise ValueError("portrait-read-binding")
        return {"receipt": receipt, "descriptor": descriptor, "sheet": sheet}


# Modal's durable calls use HTTPS blob storage for portraits, fitted sheets and
# movement packages. The reader, renderer and assemblers need that transport.
@app.function(image=gpu_image,
              gpu="L4", max_containers=1, min_containers=0,
              timeout=600, retries=0, block_network=False)
def read_portrait(raw: bytes, expected_sha256: str, frame_hash: str, operation: str | None = None):
    if not re.fullmatch(r"[a-f0-9]{64}", frame_hash):
        raise ValueError("missing-moderated-frame")
    if operation is not None:
        if not re.fullmatch(r"[a-f0-9-]{36}", operation) or not re.fullmatch(r"[a-f0-9]{64}", expected_sha256):
            raise ValueError("invalid-read-binding")
        acknowledge_reserved_call(f"portrait/{operation}/{expected_sha256}/{frame_hash}", "portrait")
    entry = Path((INSTALL / "entry.txt").read_text().strip())
    release = json.loads((INSTALL / "sprite-worker-release.json").read_bytes())
    result = read_private_upload(raw, expected_sha256, entry, INSTALL / "paint/bin/python",
                                 INSTALL / "reader/bin/python", frame_hash, painted_costumes=release.get("paintedCostumes",False))
    result["pipelineVersion"] = release["intake"]
    if release.get("paintedCostumes"):
        result["paintedCostumes"] = True
        if "descriptor" in result:
            template = json.loads(result["descriptor"])["fit"]["template"]
            if template in release.get("paintedTemplates", []):
                result["paintedTemplate"] = template
    return result


if os.environ.get("SPRITE_PAINTED_COSTUMES") == "1":
    @app.function(image=gpu_image, gpu="L4", max_containers=1, min_containers=0, retries=0, timeout=1800,
                  secrets=[modal.Secret.from_name("shinobix-avatar-costume-paint", required_keys=["OPENAI_API_KEY"])])
    def paint_costume(asset: str, descriptor: bytes, master: str, portrait: bytes, source: str):
        import sys
        sys.path.insert(0, str(INSTALL))
        from paint_admitted_costume import admitted_rig
        admitted_rig(asset, descriptor, master, portrait, source)
        # Provider rescheduling after preemption must never replay a paid edit.
        claims = modal.Dict.from_name("shinobix-avatar-costume-executions", create_if_missing=True)
        call_id = modal.current_function_call_id()
        if not isinstance(call_id, str) or not re.fullmatch(r"fc-[A-Za-z0-9]{1,100}", call_id):
            raise ValueError("paint-call-id-unavailable")
        claim = {"master": master, "portrait": source, "callId": call_id}
        if not claims.put(asset, claim, skip_if_exists=True):
            raise ValueError("paint-execution-already-claimed")
        entry = Path((INSTALL/"entry.txt").read_text().strip())
        with TemporaryDirectory() as directory:
            work = Path(directory)
            (work/"portrait").write_bytes(portrait)
            (work/"screened.json").write_bytes(descriptor)
            try:
                subprocess.run([INSTALL/"paint/bin/python",INSTALL/"paint_admitted_costume.py",
                                entry,work,INSTALL/"reader/bin/python",asset,master,source],check=True)
            finally:
                edits = []
                for number in (1, 2):
                    report = work/"edits"/f"edit-{number}"/"provider.json"
                    if report.is_file():
                        record = json.loads(report.read_bytes())
                        edits.append({k: record[k] for k in ("operation","requestId","model","size","quality","usage")})
                claims.put(asset, {**claim, "edits": edits})
            out = work/"painted"
            return {"assetId":asset,"screened":master,"receipt":json.loads((out/"read.json").read_bytes()),
                    "descriptor":(out/"fitted-master.json").read_bytes(),"sheet":(out/"candidate.png").read_bytes()}


def acknowledge_movement(asset, master, stage, attempt):
    if (not isinstance(asset, str) or not re.fullmatch(r"[a-f0-9]{32}", asset)
            or not re.fullmatch(r"[a-f0-9]{64}", master) or stage not in ("A", "B", "C", "finish")
            or type(attempt) is not int or not 1 <= attempt <= 3):
        raise ValueError("invalid-movement-operation")
    acknowledge_reserved_call(f"{asset}/{master}/{stage}/{attempt}", "movement")


def acknowledge_reserved_call(key, kind):
    call_id = modal.current_function_call_id()
    if not isinstance(call_id, str) or not re.fullmatch(r"fc-[A-Za-z0-9]{1,100}", call_id):
        raise ValueError(f"{kind}-call-id-unavailable")
    ledger = modal.Dict.from_name("shinobix-avatar-dispatch")
    if ledger.get(key) not in ("submitting", call_id):
        raise ValueError(f"unreserved-{kind}-operation")
    started = key + "/started"
    if not ledger.put(started, call_id, skip_if_exists=True) and ledger.get(started) != call_id:
        raise ValueError(f"{kind}-operation-already-started")


@app.function(image=recognition_image, cpu=1, memory=2048, max_containers=1, min_containers=0,
              timeout=600, retries=0,
              secrets=[modal.Secret.from_name("shinobix-avatar-recognition", required_keys=["OPENAI_API_KEY",
                  "AVATAR_MODEL_R2_ACCOUNT_ID", "AVATAR_MODEL_R2_PRIVATE_BUCKET", "AVATAR_MODEL_R2_ACCESS_KEY_ID",
                  "AVATAR_MODEL_R2_SECRET_ACCESS_KEY", "AVATAR_MODEL_R2_PUBLIC_BUCKET"])])
def recognize_sprite(asset, descriptor, master, portrait, source, finished_call, model, operation, attempt):
    import sys
    sys.path.insert(0, str(INSTALL))
    from recognition_worker import execute_review, post_response, prepare_review, validate_operation, private_claims
    op = {**operation, "assetId":asset, "masterSha256":master, "sourceSha256":source, "version":model["version"]}
    validate_operation(op)
    if (operation.get("model") != os.environ.get("SPRITE_RECOGNITION_MODEL")
            or operation.get("poolSha256") != os.environ.get("SPRITE_RECOGNITION_POOL_SHA256")
            or type(attempt) is not int or not 1 <= attempt <= 3
            or not re.fullmatch(r"fc-[A-Za-z0-9]{1,100}", finished_call)):
        raise ValueError("recognition-release-unavailable")
    acknowledge_reserved_call(f"{asset}/{master}/recognize/{attempt}", "recognition")
    claims = private_claims()
    def prepare():
        result = modal.FunctionCall.from_id(finished_call).get()
        if result.get("model") != model:
            raise ValueError("recognition-finished-call-mismatch")
        ffmpeg = subprocess.run([INSTALL/"paint/bin/python", "-c",
                                 "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"],
                                capture_output=True, text=True, check=True, timeout=30).stdout.strip()
        return prepare_review(op, descriptor, portrait, result, INSTALL/"recognition-pool.zip", ffmpeg)
    return execute_review(op, prepare, claims, lambda payload:post_response(payload, os.environ.get("OPENAI_API_KEY")))


@app.function(image=paint_image, cpu=4, memory=8192, max_containers=1, min_containers=0,
              timeout=6 * 3600, retries=0, block_network=False)
def render_style(descriptor: bytes, sheet: bytes, master_sha256: str, style: str,
                 expected_movement: str | None = None, asset_id: str | None = None, attempt: int | None = None):
    if style not in ("A", "B", "C"):
        raise ValueError("invalid-run-style")
    if json.loads(descriptor)["fit"].get("requiresPainting"):
        raise ValueError("closeup-painting-required")
    if expected_movement is not None and (not isinstance(expected_movement, str) or
                                          not re.fullmatch(r"[0-9a-f]{64}", expected_movement)):
        raise ValueError("invalid-movement-revision")
    if asset_id is not None or attempt is not None:
        acknowledge_movement(asset_id, master_sha256, style, attempt)
    with TemporaryDirectory() as directory:
        work = Path(directory)
        master = work / "master"
        master.mkdir()
        (master / "fitted-master.json").write_bytes(descriptor)
        (master / "candidate.png").write_bytes(sheet)
        entry = Path((INSTALL / "entry.txt").read_text().strip())
        command = [INSTALL / "paint/bin/python", INSTALL / "paint_sprite_style.py", entry,
                   master, INSTALL / "blender/blender", work, "--master-sha256", master_sha256,
                   "--style", style]
        if expected_movement is not None:
            command.extend(["--expected-movement", expected_movement])
        render = subprocess.run(command)
        if render.returncode == 78:
            raise ValueError("movement-worker-revision-mismatch")
        render.check_returncode()
        receipt = json.loads((work / "style.json").read_bytes())
        archive = (work / "style.zip").read_bytes()
        if (receipt["style"] != style or receipt["master"] != master_sha256 or
                (expected_movement is not None and receipt["movement"] != expected_movement) or
                hashlib.sha256(archive).hexdigest() != receipt["archive"]):
            raise ValueError("movement-style-binding")
        return {"receipt": receipt, "archive": archive}


def deliver(asset_id, descriptor, master_sha256, *, styles=None, archive=None, archive_sha256=None):
    if not re.fullmatch("[0-9a-f]{32}", asset_id):
        raise ValueError("invalid-game-asset")
    entry = Path((INSTALL / "entry.txt").read_text().strip())
    with TemporaryDirectory() as directory:
        work = Path(directory)
        metadata = work / "fitted-master.json"
        metadata.write_bytes(descriptor)
        motion = work / "movement.zip"
        if styles is None:
            motion.write_bytes(archive)
            source = ["--archive-sha256", archive_sha256]
        else:
            if set(styles) != set("ABC"):
                raise ValueError("incomplete-run-styles")
            for style, stage in styles.items():
                (work / (style + ".json")).write_text(json.dumps(stage["receipt"], allow_nan=False))
                (work / (style + ".zip")).write_bytes(stage["archive"])
            source = ["--from-styles", work]
        content = work / "content"
        result = subprocess.run(
            [INSTALL / "paint/bin/python", INSTALL / "finish_sprite.py", entry, metadata, motion,
             content, "--master-sha256", master_sha256, "--asset-id", asset_id, *source],
            check=True, stdout=subprocess.PIPE,
        )
        delivery = json.loads(result.stdout)
        if delivery["assetId"] != asset_id or not re.fullmatch("[0-9a-f]{64}", delivery["version"]):
            raise ValueError("unexpected-game-model")
        folder = content / "players" / asset_id
        manifest = delivery["version"] + ".json"
        objects = {}
        for path in folder.iterdir():
            if path.name != manifest and not re.fullmatch(r"[0-9a-f]{64}\.(gz|264)", path.name):
                raise ValueError("unexpected-game-object")
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != path.stem:
                raise ValueError("damaged-game-object")
            objects[path.name] = data
        if (manifest not in objects or len(objects) != delivery["objects"] or
                sum(map(len, objects.values())) != delivery["bytes"]):
            raise ValueError("incomplete-game-model")
        return {"model": delivery, "objects": objects}


@app.function(image=cpu_image, cpu=2, memory=4096, max_containers=1, min_containers=0,
              timeout=1800, retries=0, block_network=False)
def finish_sprite(asset_id: str, descriptor: bytes, master_sha256: str,
                  archive: bytes, archive_sha256: str):
    """Re-deliver a previously audited, combined movement archive."""
    return deliver(asset_id, descriptor, master_sha256, archive=archive, archive_sha256=archive_sha256)


@app.function(image=cpu_image, cpu=2, memory=4096, max_containers=1, min_containers=0,
              timeout=1800, retries=0, block_network=False)
def finish_styles(asset_id: str, descriptor: bytes, master_sha256: str, styles: dict,
                  attempt: int | None = None, movement: str | None = None):
    """Assemble the three successful render_style stage results for one admitted job."""
    if attempt is not None:
        acknowledge_movement(asset_id, master_sha256, "finish", attempt)
    if movement is not None:
        if (not re.fullmatch(r"[0-9a-f]{64}", movement) or set(styles) != set("ABC")
                or not all(isinstance(v, str) and re.fullmatch(r"fc-[A-Za-z0-9]{1,100}", v) for v in styles.values())
                or len(set(styles.values())) != 3 or hashlib.sha256(descriptor).hexdigest() != master_sha256):
            raise ValueError("invalid-style-calls")
        from modal.exception import ConnectionError as ModalConnectionError, OutputExpiredError
        portrait = json.loads(descriptor)["fit"]["sourceSha256"]
        archives = {}
        for style, call_id in styles.items():
            try:
                result = modal.FunctionCall.from_id(call_id).get(timeout=60)
            except OutputExpiredError:
                return {"lostStyle":call_id, "assetId":asset_id, "master":master_sha256, "movement":movement}
            except (TimeoutError, ModalConnectionError) as error:
                raise ValueError("completed-style-unavailable") from error
            receipt = result.get("receipt") if isinstance(result, dict) else None
            if (not isinstance(receipt, dict) or not isinstance(result.get("archive"), bytes)
                    or (receipt.get("style"), receipt.get("master"), receipt.get("movement"), receipt.get("portrait"))
                    != (style, master_sha256, movement, portrait)):
                raise ValueError("invalid-style-binding")
            archives[style] = result
        styles = archives
    return deliver(asset_id, descriptor, master_sha256, styles=styles)
