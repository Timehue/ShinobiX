"""Build the stocky release from the frozen painted archives and reviewed source diffs.

The output depends only on the inputs. Unchanged entries are copied byte for byte from the
base archive, and changed or added entries are stored uncompressed, so the archive hashes
do not depend on the local zlib build."""
import argparse
from hashlib import file_digest, sha256
import json
import os
from pathlib import Path
import struct
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import zlib

LOCAL = struct.Struct("<4s5H3L2H")
CENTRAL = struct.Struct("<4s6H3L5H2L")
END = struct.Struct("<4s4H2LH")
LIMIT = 0xFFFFFFFF
# Fixed metadata for added entries: 1980-01-01 00:00, made on Unix by version 2.0, mode 0644.
ADDED = dict(made_by=(3 << 8) | 20, needed=20, time=0, date=(1 << 5) | 1, external=0o100644 << 16)


def dos_time(date_time):
    year, month, day, hour, minute, second = date_time
    return (hour << 11) | (minute << 5) | (second // 2), ((year - 1980) << 9) | (month << 5) | day


def rewrite_zip(source, destination, updates):
    """Copy source to destination, replacing or appending the entries named in updates.

    Untouched entries keep their exact local header and compressed bytes. Updated and added
    entries are stored, in source order and then in the order of updates."""
    updates = dict(updates)
    with ZipFile(source) as original, open(source, "rb") as raw, open(destination, "xb") as out:
        infos = original.infolist()
        if original.comment or len(infos) + len(updates) > 0xFFFF:
            raise ValueError("Unsupported base archive layout")
        central = []

        def stored(name, data, made_by, needed, time, date, internal, external):
            offset = out.tell()
            encoded = name.encode("ascii")
            crc = zlib.crc32(data)
            if offset > LIMIT or len(data) > LIMIT:
                raise ValueError("Archive needs ZIP64")
            out.write(LOCAL.pack(b"PK\x03\x04", needed, 0, 0, time, date, crc, len(data), len(data), len(encoded), 0))
            out.write(encoded)
            out.write(data)
            central.append(CENTRAL.pack(b"PK\x01\x02", made_by, needed, 0, 0, time, date, crc, len(data), len(data),
                                        len(encoded), 0, 0, 0, internal, external, offset) + encoded)

        for info in infos:
            if info.flag_bits or info.extra or info.comment or info.file_size > LIMIT or info.compress_size > LIMIT:
                raise ValueError(f"Unsupported base entry {info.filename}")
            made_by = (info.create_system << 8) | info.create_version
            time, date = dos_time(info.date_time)
            if info.filename in updates:
                stored(info.filename, updates.pop(info.filename), made_by, info.extract_version, time, date,
                       info.internal_attr, info.external_attr)
                continue
            raw.seek(info.header_offset)
            header = raw.read(LOCAL.size)
            fields = LOCAL.unpack(header)
            if fields[0] != b"PK\x03\x04" or fields[2] != 0:
                raise ValueError(f"Unexpected local header for {info.filename}")
            body = raw.read(fields[9] + fields[10] + info.compress_size)
            offset = out.tell()
            if offset > LIMIT:
                raise ValueError("Archive needs ZIP64")
            out.write(header)
            out.write(body)
            encoded = info.filename.encode("ascii")
            central.append(CENTRAL.pack(b"PK\x01\x02", made_by, info.extract_version, 0, info.compress_type, time, date,
                                        info.CRC, info.compress_size, info.file_size, len(encoded), 0, 0, 0,
                                        info.internal_attr, info.external_attr, offset) + encoded)
        for name, data in updates.items():
            stored(name, data, ADDED["made_by"], ADDED["needed"], ADDED["time"], ADDED["date"], 0, ADDED["external"])
        start = out.tell()
        for record in central:
            out.write(record)
        size = out.tell() - start
        if start > LIMIT or size > LIMIT:
            raise ValueError("Archive needs ZIP64")
        out.write(END.pack(b"PK\x05\x06", 0, 0, len(central), len(central), size, start, 0))
    with ZipFile(destination) as check:
        if check.testzip() is not None:
            raise ValueError("Rewritten archive failed its CRC check")


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
    rewrite_zip(source, destination, {**files, name: json.dumps(index, indent=2).encode()})
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
