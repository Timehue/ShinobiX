"""Private CPU and GPU stages for the hosted sprite worker."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
import time

import modal


HERE = Path(__file__).resolve().parent
INSTALL = Path("/opt/sprite")
MAX_UPLOAD = 20 * 1024 * 1024
app = modal.App("shinobix-avatar-sprites")
# Machines per step, so several players' checks, paintings and assemblies run side by side instead of
# queueing behind one another (a check queued 11 minutes on 2026-11-20). Each one is billed only while it
# runs. render_style stays at one: a job's three styles must share a machine (see its decorator).
PARALLEL_JOBS = 3
# GPUs a check or a costume painting may run on, in order of preference. Pinned to L4 alone, a check sat
# 20+ minutes in Modal's queue with no machine started on 2026-11-20 while L4s were scarce (a bare L4 probe
# took 167 s that hour, 34 s that morning). Any free one of these starts it instead. The trial harness
# (modal_portrait_trial.py) already runs this same reader image on this list.
GPUS = ["L4", "A10", "T4"]
# A job's highest attempt (api/avatar-model/_dispatch.ts MAX_ATTEMPTS, dispatch_stage.py): a style retry plus a
# full rebuild of the three styles after a failed assembly must not use up a job (owner, 2026-11-20).
MAX_ATTEMPT = 5
openai_secret_name = os.environ.get("SPRITE_OPENAI_SECRET", "").strip()


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
                 "install_sprite_worker.py", "finish_sprite.py", "paint_sprite_style.py", "browser_motion.py", "battle_pose.py",
                 "verify_moderated_frame.py", "recognition_lineup.py", "recognition_worker.py", "requirements-recognition.txt"):
        image = image.add_local_file(HERE / name, "/opt/sprite/" + name, copy=True)
    if painted:
        image = image.env({"SPRITE_PAINTED_COSTUMES":"1"})
        for name in ("paint_admitted_costume.py", "limb_repair.py", "paint_portrait.py", "closeup_portrait.py", "armored_raccoon.py",
                     "upright_animal.py", "animal_build.py", "painted_likeness.py", "costume_palette.py",
                     "sector-costume-light.png", "paint_battle_sprite.py", "battle-stance-reference.png"):
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
    stocky_sources = []
    if pool:
        pool_hash = os.environ["SPRITE_RECOGNITION_POOL_SHA256"]
        pool_path = Path(pool).resolve(strict=True)
        if not re.fullmatch(r"[a-f0-9]{64}", pool_hash) or hashlib.sha256(pool_path.read_bytes()).hexdigest() != pool_hash:
            raise ValueError("recognition-pool-deployment-binding")
        from zipfile import ZipFile
        from animal_build import STOCKY_TEMPLATE
        from recognition_worker import pool_entries
        with ZipFile(pool_path) as archive:
            stocky_sources = sorted({row["sourceSha256"] for row in pool_entries(archive)
                                     if STOCKY_TEMPLATE in row["templates"]})
        recognition_image = cpu_image.add_local_file(pool_path, "/opt/sprite/recognition-pool.zip", copy=True).env({
            "SPRITE_RECOGNITION_POOL_SHA256":pool_hash, "SPRITE_RECOGNITION_MODEL":os.environ["SPRITE_RECOGNITION_MODEL"]
        }).run_commands("python -m pip install --no-cache-dir -r /opt/sprite/requirements-recognition.txt", "python -m pip check")
        if openai_secret_name:
            # recognize_sprite's secret list depends on this name. The container re-imports this
            # module, so it must see the same name or Modal refuses to hydrate the function.
            recognition_image = recognition_image.env({"SPRITE_OPENAI_SECRET": openai_secret_name})
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
    if stocky_sources:
        gpu_image = gpu_image.env({"SPRITE_STOCKY_DECOY_SOURCES": ",".join(stocky_sources)})
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


STEP_TAIL_LINES = 25


class StepFailed(subprocess.CalledProcessError):
    """A worker step's non-zero exit, carrying the end of what it printed to stderr. Without it a failed job read
    only "returned non-zero exit status 1" and its cause was lost once the app log rolled over (three failed jobs,
    2026-11-17 to 11-21). It is still a CalledProcessError, so every returncode check below works unchanged."""
    def __str__(self):
        name = Path(str(self.cmd[1])).name if isinstance(self.cmd, (list, tuple)) and len(self.cmd) > 1 else "step"
        tail = (self.stderr or "").strip()
        return f"{name} exited {self.returncode}" + (":\n" + tail if tail else "")


def run_step(command, *, check=True, stdout=None, timeout=None):
    """subprocess.run that still streams the step's stderr into the container log as it runs, and keeps its last
    lines for the exception a failure raises."""
    import collections
    import threading
    tail = collections.deque(maxlen=STEP_TAIL_LINES)
    process = subprocess.Popen(command, stdout=stdout, stderr=subprocess.PIPE, text=True, errors="replace")

    def relay():
        for line in process.stderr:
            sys.stderr.write(line)
            sys.stderr.flush()
            tail.append(line.rstrip()[:300])
    reader = threading.Thread(target=relay, daemon=True)
    reader.start()
    try:
        output = process.stdout.read() if stdout == subprocess.PIPE else None
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        raise
    finally:
        reader.join(10)
    errors = "\n".join(tail)
    if check and process.returncode:
        raise StepFailed(process.returncode, command, output, errors)
    return subprocess.CompletedProcess(command, process.returncode, output, errors)


def read_private_upload(raw, expected_sha256, entry, paint_python, reader_python, frame_hash=None, *,
                        painted_costumes=False, stocky=False):
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
        run_step([paint_python, entry.with_name("portrait_intake.py"), upload, master,
                  "--source-sha256", expected_sha256, "--reader-python", reader_python,
                  *(["--full-figure-equipment", "--portrait-bust"] if painted_costumes else [])],
                 stdout=subprocess.DEVNULL)
        receipt = json.loads((master / "read.json").read_bytes())
        declined = receipt["declined"]
        if painted_costumes and isinstance(declined, str):
            # Only an uncertain bust fit may still become a detector-checked human close-up. Any
            # decline may still be a two-legged character the vision check admits (upright_animal.py),
            # which itself refuses photos, groups and four-legged animals: the rig takes every
            # bipedal character, so the intake's narrower families are not the last word.
            animal_only = [] if declined == "portrait-bust-fit-uncertain" else ["--animal-only"]
            try:
                run_step([paint_python, INSTALL / "closeup_portrait.py", entry, upload, master,
                          reader_python, expected_sha256, *animal_only, *(["--stocky"] if stocky else [])],
                         stdout=subprocess.DEVNULL)
            except subprocess.CalledProcessError as error:
                # An uncertain decline always went through this fallback, and its failure still fails
                # the read. A decline that only reaches it since every bipedal character is screened
                # keeps its original decline instead: the player keeps the monthly model and reads
                # "could not use this portrait", never "something went wrong". closeup_portrait
                # replaces read.json only as its last step, so the intake's receipt is still there.
                if declined.endswith("-uncertain"):
                    raise
                print("closeup-fallback-skipped", declined, error.returncode, flush=True)
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
              gpu=GPUS, max_containers=PARALLEL_JOBS, min_containers=0,
              timeout=600, retries=0, block_network=False,
              # The upright-animal check asks the costume key's model. The list has one entry in
              # both the deploy and the container, whichever name the deploy chose.
              secrets=[modal.Secret.from_name(openai_secret_name or "shinobix-avatar-costume-paint",
                                              required_keys=["OPENAI_API_KEY"])]
              if os.environ.get("SPRITE_PAINTED_COSTUMES") == "1" else [])
def read_portrait(raw: bytes, expected_sha256: str, frame_hash: str, operation: str | None = None):
    if not re.fullmatch(r"[a-f0-9]{64}", frame_hash):
        raise ValueError("missing-moderated-frame")
    if operation is not None:
        if not re.fullmatch(r"[a-f0-9-]{36}", operation) or not re.fullmatch(r"[a-f0-9]{64}", expected_sha256):
            raise ValueError("invalid-read-binding")
        acknowledge_reserved_call(f"portrait/{operation}/{expected_sha256}/{frame_hash}", "portrait")
    entry = Path((INSTALL / "entry.txt").read_text().strip())
    release = json.loads((INSTALL / "sprite-worker-release.json").read_bytes())
    stocky = False
    if release.get("paintedCostumes"):
        # The painted-costume modules are baked into INSTALL (worker_image), which is not on a function's
        # import path: without this the import fails and every portrait check dies (2026-11-21 to 11-24).
        sys.path.insert(0, str(INSTALL))
        from animal_build import stocky_review_available
        stocky = stocky_review_available(release, expected_sha256,
                                        os.environ.get("SPRITE_STOCKY_DECOY_SOURCES", "").split(","))
    result = read_private_upload(raw, expected_sha256, entry, INSTALL / "paint/bin/python",
                                 INSTALL / "reader/bin/python", frame_hash, painted_costumes=release.get("paintedCostumes",False),
                                 stocky=stocky)
    result["pipelineVersion"] = release["intake"]
    if release.get("paintedCostumes"):
        result["paintedCostumes"] = True
        if "descriptor" in result:
            template = json.loads(result["descriptor"])["fit"]["template"]
            if template in release.get("paintedTemplates", []):
                result["paintedTemplate"] = template
    return result


# A painted combat sprite waits here, keyed by asset, between the costume call that paints it
# and the style A render that publishes it. An entry expires after 7 days without a read.
BATTLE_SPRITES = "shinobix-avatar-battle-sprites"
PAINT_TIMEOUT = 2400
# Start the combat painting only with this long left: one edit, one repair (360 s each at most) and their checks.
BATTLE_PAINT_ROOM = 1000
# paint_admitted_costume.py REFUSED: the rig or the likeness check refused all three paintings of a round.
PAINT_REFUSED = 3
# The error a costume call raises when its paintings were refused, never a crash (dispatch_stage.py ends the job).
COSTUME_REFUSED = "costume-refused"


def paint_claim_key(asset, attempt):
    """The costume-executions key of one paint attempt. Attempt 1 keeps the bare asset key every earlier job used."""
    return asset if attempt == 1 else f"{asset}/attempt-{attempt}"
# Start a second painting round only with this long left. A round takes about 4 minutes; three edits at their
# 360 s timeout and the checks fit in 20. A combat painting that no longer fits is skipped and the posed model used.
REPAINT_ROOM = 1200


def paint_battle_sprite(entry, work, asset, source, painted_master, started):
    """The combat sprite: one more edit, and one repair. Returns the billing record of each edit sent.
    Any failure keeps the posed world model as the combat sprite; it never fails the costume."""
    if PAINT_TIMEOUT - (time.monotonic() - started) < BATTLE_PAINT_ROOM:
        print("battle-sprite-skipped no-time", flush=True)
        return []
    try:
        subprocess.run([INSTALL/"paint/bin/python", INSTALL/"paint_battle_sprite.py", entry, work, asset, source],
                       check=True, timeout=BATTLE_PAINT_ROOM - 100)
        sprite = (work/"battle"/"sprite.webp").read_bytes()
        modal.Dict.from_name(BATTLE_SPRITES, create_if_missing=True).put(
            asset, {"master": painted_master, "sprite": sprite})
    except Exception as error:  # noqa: BLE001
        print("battle-sprite-skipped", type(error).__name__, flush=True)
    # A sent edit is billed whether or not its painting was usable.
    records = []
    for number in (1, 2):
        try:
            record = json.loads((work/"battle"/f"edit-{number}"/"provider.json").read_bytes())
            records.append({k: record[k] for k in ("operation","requestId","model","size","quality","usage")})
        except Exception:  # noqa: BLE001
            pass  # No edit was sent for this attempt, or its record is unreadable.
    return records


def painted_battle_sprite(asset, master):
    """The combat sprite painted for this exact fitted master, or None to pose the world model."""
    try:
        entry = modal.Dict.from_name(BATTLE_SPRITES).get(asset)
    except Exception as error:  # noqa: BLE001
        print("battle-sprite-unavailable", type(error).__name__, flush=True)
        return None
    if not isinstance(entry, dict) or entry.get("master") != master:
        return None
    sprite = entry.get("sprite")
    return sprite if isinstance(sprite, bytes) and sprite else None


# Every model's legs render at 78% of their painted width below the hip (render_fitted_roster.LEG_SLIM), except
# an animal's (owner, 2026-11-21): a dinosaur's thick thighs read as haunches, and the armored raccoon was built
# with full legs and should stay that way. The costume call that knows the portrait's style records the animal
# here, keyed by asset, for the three style renders of that exact fitted master. An entry expires after 7 days
# without a read; a model with no entry renders like any other.
LEG_BUILDS = "shinobix-avatar-leg-builds"
ANIMAL_STYLES = ("upright-animal", "armored-raccoon")


def animal_portrait(descriptor):
    fit = json.loads(descriptor)["fit"]
    return fit.get("requiresPainting") is True and fit.get("style") in ANIMAL_STYLES


def record_painted_legs(asset, master):
    try:
        modal.Dict.from_name(LEG_BUILDS, create_if_missing=True).put(asset, {"master": master, "legs": "painted"})
        print("leg-build painted", flush=True)
    except Exception as error:  # noqa: BLE001
        print("leg-build-unrecorded", type(error).__name__, flush=True)  # The model renders with the usual legs.


def painted_legs(asset, master):
    """True when this exact fitted master is an animal's. The three styles of a job must agree, or their
    shared walking frames differ and the job cannot be assembled: an unreadable store fails the render
    (the server retries it) rather than guessing."""
    for wait in (0, 2, 5):
        time.sleep(wait)
        try:
            entry = modal.Dict.from_name(LEG_BUILDS, create_if_missing=True).get(asset)
            break
        except Exception as error:  # noqa: BLE001
            print("leg-build-unavailable", type(error).__name__, flush=True)
    else:
        raise ValueError("leg-build-unavailable")
    return isinstance(entry, dict) and entry.get("master") == master and entry.get("legs") == "painted"


def forget_battle_sprite(asset):
    try:
        modal.Dict.from_name(BATTLE_SPRITES).pop(asset)
    except Exception:  # noqa: BLE001
        pass  # Already gone, or it expires by itself.


if os.environ.get("SPRITE_PAINTED_COSTUMES") == "1":
    @app.function(image=gpu_image, gpu=GPUS, max_containers=PARALLEL_JOBS, min_containers=0, retries=0, timeout=PAINT_TIMEOUT,
                  secrets=[modal.Secret.from_name(openai_secret_name or "shinobix-avatar-costume-paint",
                                                  required_keys=["OPENAI_API_KEY"])])
    def paint_costume(asset: str, descriptor: bytes, master: str, portrait: bytes, source: str, attempt: int = 1):
        import sys
        started = time.monotonic()
        if type(attempt) is not int or attempt not in (1, 2):
            raise ValueError("invalid-paint-attempt")
        sys.path.insert(0, str(INSTALL))
        from paint_admitted_costume import admitted_rig
        admitted_rig(asset, descriptor, master, portrait, source)
        # Provider rescheduling after preemption must never replay a paid edit. The game retries a CRASHED painting
        # once (attempt 2, owner 2026-11-25), as a new execution under its own claim; a refused one is never retried.
        claims = modal.Dict.from_name("shinobix-avatar-costume-executions", create_if_missing=True)
        claim_key = paint_claim_key(asset, attempt)
        call_id = modal.current_function_call_id()
        if not isinstance(call_id, str) or not re.fullmatch(r"fc-[A-Za-z0-9]{1,100}", call_id):
            raise ValueError("paint-call-id-unavailable")
        claim = {"master": master, "portrait": source, "callId": call_id}
        if not claims.put(claim_key, claim, skip_if_exists=True):
            raise ValueError("paint-execution-already-claimed")
        entry = Path((INSTALL/"entry.txt").read_text().strip())
        with TemporaryDirectory() as directory:
            work = Path(directory)
            (work/"portrait").write_bytes(portrait)
            (work/"screened.json").write_bytes(descriptor)
            out = work/"painted"
            battle = []
            command = [INSTALL/"paint/bin/python",INSTALL/"paint_admitted_costume.py",
                       entry,work,INSTALL/"reader/bin/python",asset,master,source]
            try:
                try:
                    try:
                        run_step(command)
                    except subprocess.CalledProcessError as error:
                        # All three paintings of the first round were refused (Nero, 2026-11-21: the same leg three
                        # times, which ended a model at the first step). Paint one fresh round while there is time.
                        if error.returncode != PAINT_REFUSED or PAINT_TIMEOUT-(time.monotonic()-started) < REPAINT_ROOM:
                            raise
                        print("costume-repaint round 2", flush=True)
                        run_step(command+["--round","2"])
                except subprocess.CalledProcessError as error:
                    # Refused paintings are the portrait's verdict, not a crash: say so, so the game ends the job
                    # instead of retrying it and paying for more rounds of the same refusal.
                    if error.returncode == PAINT_REFUSED:
                        raise ValueError(COSTUME_REFUSED) from error
                    raise
                receipt = json.loads((out/"read.json").read_bytes())
                if animal_portrait(descriptor):
                    record_painted_legs(asset, receipt["fittedMasterSha256"])
                battle = paint_battle_sprite(entry, work, asset, source, receipt["fittedMasterSha256"], started)
            finally:
                edits = []
                for folder in ("edits", "edits-2"):
                    for number in (1, 2, 3):
                        report = work/folder/f"edit-{number}"/"provider.json"
                        if report.is_file():
                            record = json.loads(report.read_bytes())
                            edits.append({k: record[k] for k in ("operation","requestId","model","size","quality","usage")})
                claims.put(claim_key, {**claim, "edits": edits + battle})
            return {"assetId":asset,"screened":master,"receipt":receipt,
                    "descriptor":(out/"fitted-master.json").read_bytes(),"sheet":(out/"candidate.png").read_bytes()}


def acknowledge_movement(asset, master, stage, attempt):
    if (not isinstance(asset, str) or not re.fullmatch(r"[a-f0-9]{32}", asset)
            or not re.fullmatch(r"[a-f0-9]{64}", master) or stage not in ("A", "B", "C", "finish")
            or type(attempt) is not int or not 1 <= attempt <= MAX_ATTEMPT):
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


recognition_keys = [
    "AVATAR_MODEL_R2_ACCOUNT_ID", "AVATAR_MODEL_R2_PRIVATE_BUCKET", "AVATAR_MODEL_R2_ACCESS_KEY_ID",
    "AVATAR_MODEL_R2_SECRET_ACCESS_KEY", "AVATAR_MODEL_R2_PUBLIC_BUCKET",
]
if not openai_secret_name:
    recognition_keys.append("OPENAI_API_KEY")
recognition_secrets = [modal.Secret.from_name("shinobix-avatar-recognition", required_keys=recognition_keys)]
if openai_secret_name:
    recognition_secrets.append(modal.Secret.from_name(openai_secret_name, required_keys=["OPENAI_API_KEY"]))


@app.function(image=recognition_image, cpu=1, memory=2048, max_containers=PARALLEL_JOBS, min_containers=0,
              timeout=600, retries=0, secrets=recognition_secrets)
def recognize_sprite(asset, descriptor, master, portrait, source, finished_call, model, operation, attempt):
    import sys
    sys.path.insert(0, str(INSTALL))
    from recognition_worker import execute_review, post_response, prepare_review, validate_operation, private_claims
    op = {**operation, "assetId":asset, "masterSha256":master, "sourceSha256":source, "version":model["version"]}
    validate_operation(op)
    if (operation.get("model") != os.environ.get("SPRITE_RECOGNITION_MODEL")
            or operation.get("poolSha256") != os.environ.get("SPRITE_RECOGNITION_POOL_SHA256")
            or type(attempt) is not int or not 1 <= attempt <= MAX_ATTEMPT
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


# The game server starts a job's A, B and C renders together, so one job's styles finish in the
# time of its slowest instead of the sum of all three. They run side by side in ONE container.
# The styles share their walking and standing frames, and assembly requires those to be
# byte-identical (run_style_package.combine: "Incompatible movement banks"). The leg renderer's
# output differs by a few edge pixels between machines: with three containers, a 2026-11-18 trial
# rendered every style correctly and then could not be assembled, because one container's
# walking pages differed from the other two by 1 to 8 pixels. One machine gives one answer.
@app.function(image=paint_image, cpu=12, memory=24576, max_containers=1, min_containers=0,
              timeout=6 * 3600, retries=0, block_network=False)
@modal.concurrent(max_inputs=3)
def render_style(descriptor: bytes, sheet: bytes, master_sha256: str, style: str,
                 expected_movement: str | None = None, asset_id: str | None = None, attempt: int | None = None,
                 painted_for: str | None = None):
    """painted_for names the asset whose painted combat sprite to use when no server job reserved this call."""
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
        owner = asset_id or painted_for
        painted = painted_battle_sprite(owner, master_sha256) if style == "A" and owner else None
        if painted is not None:
            (work / "painted-battle.webp").write_bytes(painted)
            command.extend(["--battle-sprite", work / "painted-battle.webp"])
        if owner and painted_legs(owner, master_sha256):
            command.append("--painted-legs")
        render = run_step(command, check=False)
        if render.returncode == 78:
            raise ValueError("movement-worker-revision-mismatch")
        if render.returncode:
            raise StepFailed(render.returncode, command, None, render.stderr)
        receipt = json.loads((work / "style.json").read_bytes())
        archive = (work / "style.zip").read_bytes()
        if (receipt["style"] != style or receipt["master"] != master_sha256 or
                (expected_movement is not None and receipt["movement"] != expected_movement) or
                hashlib.sha256(archive).hexdigest() != receipt["archive"]):
            raise ValueError("movement-style-binding")
        result = {"receipt": receipt, "archive": archive}
        if "battleSpriteSha256" in receipt:
            result["battleSprite"] = (work / "battle.webp").read_bytes()
        return result


def deliver(asset_id, descriptor, master_sha256, *, styles=None, archive=None, archive_sha256=None):
    if not re.fullmatch("[0-9a-f]{32}", asset_id):
        raise ValueError("invalid-game-asset")
    sys.path.insert(0, str(INSTALL))
    from browser_motion import browser_motion_objects, checked_style_battle_sprite

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
                receipt = stage["receipt"]
                battle_sprite = checked_style_battle_sprite(style, receipt.get("battleSpriteSha256"), stage.get("battleSprite"))
                if battle_sprite is not None:
                    (work / "battle.webp").write_bytes(battle_sprite)
                (work / (style + ".json")).write_text(json.dumps(receipt, allow_nan=False))
                (work / (style + ".zip")).write_bytes(stage["archive"])
            source = ["--from-styles", work]
        content = work / "content"
        result = run_step(
            [INSTALL / "paint/bin/python", INSTALL / "finish_sprite.py", entry, metadata, motion,
             content, "--master-sha256", master_sha256, "--asset-id", asset_id, *source],
            stdout=subprocess.PIPE,
        )
        delivery = json.loads(result.stdout)
        if delivery["assetId"] != asset_id or not re.fullmatch("[0-9a-f]{64}", delivery["version"]):
            raise ValueError("unexpected-game-model")
        folder = content / "players" / asset_id
        portrait = json.loads(descriptor)["fit"]["sourceSha256"]
        objects = browser_motion_objects(folder, delivery["version"], portrait)
        if len(objects) != delivery["objects"] or sum(map(len, objects.values())) != delivery["bytes"]:
            raise ValueError("incomplete-game-model")
        return {"model": delivery, "objects": objects}


@app.function(image=cpu_image, cpu=2, memory=4096, max_containers=PARALLEL_JOBS, min_containers=0,
              timeout=1800, retries=0, block_network=False)
def finish_sprite(asset_id: str, descriptor: bytes, master_sha256: str,
                  archive: bytes, archive_sha256: str):
    """Re-deliver a previously audited, combined movement archive."""
    return deliver(asset_id, descriptor, master_sha256, archive=archive, archive_sha256=archive_sha256)


@app.function(image=cpu_image, cpu=2, memory=4096, max_containers=PARALLEL_JOBS, min_containers=0,
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
    delivery = deliver(asset_id, descriptor, master_sha256, styles=styles)
    if movement is not None:
        # The combat sprite now travels in the style A result. Drop the waiting copy.
        forget_battle_sprite(asset_id)
    return delivery


# Health checks, run once by the deploy script (smoke_read.py) right after `modal deploy`, one per image: a
# deploy whose image lacks a file, an interpreter, a package or a secret its real functions need is rolled back
# before a player's job reaches it. Each runs on a small CPU machine, starts nothing paid and reads no player data.
# Imports go through the same sys.path.insert(INSTALL) the real functions use (test_paint_step_errors.py guards that).
def health(checks):
    failures = []
    for name, check in checks:
        try:
            if check() is False:
                failures.append(name)
        except Exception as error:  # noqa: BLE001
            failures.append(f"{name}: {type(error).__name__}: {str(error)[-300:]}")
    return {"ok": not failures, "failures": failures}


def installed(*names):
    return lambda: all((INSTALL / name).exists() for name in names)


def runs(*command):
    return lambda: run_step([str(part) for part in command], stdout=subprocess.DEVNULL, timeout=240).returncode == 0


def entry_files(*names):
    def check():
        entry = Path((INSTALL / "entry.txt").read_text().strip())
        return entry.is_file() and all(entry.with_name(name).is_file() for name in names)
    return check


def imports_from_install(*modules):
    def check():
        sys.path.insert(0, str(INSTALL))
        for module in modules:
            __import__(module)
    return check


def has_env(*names):
    return lambda: all(os.environ.get(name, "").strip() for name in names)


@app.function(image=gpu_image, cpu=1, memory=4096, max_containers=1, min_containers=0, timeout=300, retries=0,
              secrets=[modal.Secret.from_name(openai_secret_name or "shinobix-avatar-costume-paint",
                                              required_keys=["OPENAI_API_KEY"])]
              if os.environ.get("SPRITE_PAINTED_COSTUMES") == "1" else [])
def health_reader():
    """read_portrait and paint_costume's image."""
    painted = os.environ.get("SPRITE_PAINTED_COSTUMES") == "1"
    return health([
        ("release", installed("sprite-worker-release.json", "verify_moderated_frame.py", "paint/bin/python", "reader/bin/python")),
        ("intake", entry_files("portrait_intake.py")),
        ("reader-packages", runs(INSTALL / "reader/bin/python", "-c", "import torch, transformers")),
        ("paint-packages", runs(INSTALL / "paint/bin/python", "-c", "import cv2, mediapipe, PIL, numpy")),
        *([("painted-modules", imports_from_install("animal_build", "paint_admitted_costume")),
           ("painted-files", installed("paint_admitted_costume.py", "closeup_portrait.py", "paint_battle_sprite.py",
                                       "sector-costume-light.png", "battle-stance-reference.png")),
           ("openai-key", has_env("OPENAI_API_KEY"))] if painted else []),
    ])


@app.function(image=paint_image, cpu=1, memory=4096, max_containers=1, min_containers=0, timeout=300, retries=0)
def health_render():
    """render_style's image."""
    return health([
        ("files", installed("paint_sprite_style.py", "paint/bin/python", "blender/blender")),
        ("entry", entry_files()),
        ("blender", runs(INSTALL / "blender/blender", "--background", "--factory-startup", "--version")),
        ("paint-packages", runs(INSTALL / "paint/bin/python", "-c", "import cv2, mediapipe, imageio_ffmpeg")),
    ])


@app.function(image=cpu_image, cpu=1, memory=2048, max_containers=1, min_containers=0, timeout=300, retries=0)
def health_finish():
    """finish_sprite and finish_styles's image."""
    return health([
        ("files", installed("finish_sprite.py", "paint/bin/python")),
        ("entry", entry_files()),
        ("modules", imports_from_install("browser_motion")),
    ])


@app.function(image=recognition_image, cpu=1, memory=2048, max_containers=1, min_containers=0, timeout=300,
              retries=0, secrets=recognition_secrets)
def health_recognition():
    """recognize_sprite's image."""
    return health([
        ("files", installed("recognition-pool.zip", "paint/bin/python")),
        ("modules", imports_from_install("recognition_worker")),
        ("release", has_env("SPRITE_RECOGNITION_MODEL", "SPRITE_RECOGNITION_POOL_SHA256", "OPENAI_API_KEY",
                            *recognition_keys)),
    ])
