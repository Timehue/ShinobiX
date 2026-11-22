"""Build the stocky release from the frozen painted archives and reviewed source diffs."""
import argparse
from hashlib import file_digest, sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


HERE = Path(__file__).resolve().parent
BASE = {"intake": "b676656b5dbb4980206814acefdfbd2075ab88aa144d60c352645e26e9ac8bc8",
        "movement": "e6816a5d825aa8aca6dab06f0918f1ad9fdbe8417f94c259a90d7904ab6f78f1"}
RIG = ".ci-evidence/avatar-model/constrained-fit-study-v2/"
CODE = ".ci-evidence/avatar-model/target-style-locomotion-v2/"


def digest(path):
    with path.open("rb") as stream:
        return file_digest(stream, "sha256").hexdigest()


def build(source, kind, folder):
    if digest(source) != BASE[kind]:
        raise ValueError(f"Unexpected {kind} base release")
    patch = HERE / (kind + ".patch")
    diff = patch.read_text(encoding="utf-8")
    targets = [line[6:] for line in diff.splitlines() if line.startswith("+++ b/")]
    name = "intake.json" if kind == "intake" else "motion-worker.json"
    destination = folder / f"stocky-{kind}.zip"
    with ZipFile(source) as original, TemporaryDirectory(dir=folder) as temporary:
        work = Path(temporary)
        index = json.loads(original.read(name))
        crlf = set()
        for target in targets:
            path = Path(original.extract(target, work))
            raw = path.read_bytes()
            if b"\r\n" in raw:
                crlf.add(target)
                path.write_bytes(raw.replace(b"\r\n",b"\n"))
        subprocess.run(["git", "-c", "core.autocrlf=false", "apply", "--no-index", "--whitespace=nowarn", "-"],
                       input=diff.encode(), cwd=work,
                       env=dict(os.environ, GIT_CEILING_DIRECTORIES=str(work.parent)), check=True)
        files = {target: (work/target).read_bytes() for target in targets}
        for target in crlf:
            files[target] = files[target].replace(b"\n",b"\r\n")
        if kind == "movement":
            files[CODE+"stocky_lower.py"] = (HERE/"stocky_lower.py").read_text(encoding="utf-8").encode()
        for ext in ("png", "json"):
            guide = "stocky-template." + ext
            path = HERE/guide
            files[RIG+guide] = path.read_text(encoding="utf-8").encode() if ext == "json" else path.read_bytes()
        index["files"].update({key: sha256(data).hexdigest() for key,data in files.items()})
        if kind == "intake":
            revision = sha256(index["revision"].encode())
            painting = [CODE+n for n in ("register_painted_kit.py", "painted_torso_hands.py", "motion_worker_paths.py")]
            for key in painting + [RIG+"stocky-template.json", RIG+"stocky-template.png"]:
                revision.update(key.encode()+b"\0"+bytes.fromhex(index["files"][key]))
            index["paintingRevision"] = revision.hexdigest()
        updates = {**files, name: json.dumps(index, indent=2).encode()}
        with ZipFile(destination, "x") as out:
            for info in original.infolist():
                if info.filename in updates:
                    out.writestr(info, updates.pop(info.filename))
                else:
                    with original.open(info) as src, out.open(info, "w") as dst:
                        shutil.copyfileobj(src, dst, length=1024*1024)
            for key, data in updates.items():
                out.writestr(ZipInfo(key), data, compress_type=ZIP_DEFLATED)
        for key, data in files.items():
            (folder/(destination.stem+"."+Path(key).name)).write_bytes(data)
    return digest(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("intake", "movement", "output"):
        parser.add_argument(arg, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(args.output)
    args.output.parent.mkdir(exist_ok=True, parents=True)
    with TemporaryDirectory(dir=args.output.parent) as tmp:
        staged = Path(tmp)/"release"
        staged.mkdir()
        pins = {kind: build(getattr(args, kind), kind, staged) for kind in BASE}
        pins.update(paintedCostumes=True, paintedTemplates=["male-coat-template.json", "female-coat-template.json",
                                                            "masked-collar-template.json", "stocky-template.json"])
        (staged/"sprite-worker-painted-review.json").write_text(json.dumps(pins, indent=2)+"\n", newline="\n")
        staged.rename(args.output)
