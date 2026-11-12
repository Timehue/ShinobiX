"""Stage the fitted worker's complete motion as immutable, independently fetched banks."""
from gzip import compress, decompress
from hashlib import sha256
import json
from pathlib import Path
import re
from zipfile import ZipFile

from .game_package import DIRECTIONS, install

MAX_MOTION_BYTES = 8 * 1024**2

def encoded(value):
    return json.dumps(value, separators=(",", ":"), allow_nan=False).encode()


_X264_BANNER = re.compile(
    rb"\x00\x00(?:\x00)?\x01\x06\x05(\xff*)([\x00-\xfe])(" +
    re.escape(bytes.fromhex("dc45e9bde6d948b7962cd820d923eeef")) +
    rb"x264 - core [\x20-\x7e]+\x00)\x80(?=\x00\x00(?:\x00)?\x01|$)"
)


def without_encoder_banner(data):
    """Remove only a complete, standalone x264 identification message from Annex B."""
    match = _X264_BANNER.search(data)
    if match and 255 * len(match[1]) + match[2][0] == len(match[3]):
        return data[:match.start()] + data[match.end():]
    return data


def stage_motion(source, cache, asset_id, portrait, content, *, omit_encoder_banner=False):
    if not re.fullmatch("[0-9a-f]{32}", asset_id) or not re.fullmatch("[0-9a-f]{64}", portrait):
        raise ValueError("Invalid equipment identity")
    cached = json.loads(decompress((cache/"movement.json.gz").read_bytes()))
    with ZipFile(source) as archive:
        if archive.getinfo("roster-study.json").file_size > 16 * 1024**2:
            raise ValueError("Oversized fitting data")
        model = json.loads(archive.read("roster-study.json"))
        if model["portrait"] != portrait or model["directions"] != DIRECTIONS or model["heightFraction"] != .068:
            raise ValueError("Fitted identity or scale mismatch")
        if model["sprintStyle"] != "A" or cached["directions"] != DIRECTIONS:
            raise ValueError("Unexpected movement layout")
        with source.open("rb") as handle:
            digest = sha256()
            for block in iter(lambda: handle.read(1024*1024), b""):
                digest.update(block)
        if cached.get("sourceArchiveSha256") != digest.hexdigest():
            raise ValueError("The encoded pages came from a different fitting")
    payloads = {}

    def object_key(data, suffix):
        filename = sha256(data).hexdigest()+suffix
        payloads[filename] = data
        return filename

    header = dict(format="sector-motion-v2", mapWidth=1080, heightFraction=.068, portraitSha256=portrait,
                  directions=DIRECTIONS, styles={})
    verified = {}
    for style, field in zip("ABC", ("banks", "styleBBanks", "styleCBanks")):
        if len(model[field]) != 8 or len(cached[field]) != 8:
            raise ValueError("Incomplete directional coverage")
        refs = header["styles"][style] = []
        for original, bank in zip(model[field],cached[field]):
            if bank.keys()!=original.keys():
                raise ValueError("Missing movement clip")
            pages = {}
            clips = {}
            for name, clip in bank.items():
                source_clip = original[name]
                expected = {k:v for k,v in source_clip.items()
                            if k not in ("cell","cols","sha256","maxSupportDriftPx")}
                expected["origins"] = [[round(x,3),round(y,3)] for x,y in source_clip["origins"]]
                if expected != clip:
                    raise ValueError("Encoded pose timing or registration differs from the fitting")
                key = source_clip["file"]
                if clip["file"] != key or Path(key).name != key:
                    raise ValueError("Invalid movement page")
                page = cached["pages"][key]
                filename = page["file"]
                if filename != Path(key).stem+".264" or not re.fullmatch("[a-z0-9-]+[.]264",filename):
                    raise ValueError("Invalid encoded page name")
                digest = page["sha256"]
                if key not in verified:
                    data = (cache/filename).read_bytes()
                    if len(data)!=page["bytes"] or sha256(data).hexdigest() != digest:
                        raise ValueError("Encoded page checksum failed")
                    if omit_encoder_banner:
                        data = without_encoder_banner(data)
                    verified[key] = object_key(data, ".264")
                if clip["count"] != len(clip["origins"]) or page["cell"] != source_clip["cell"]:
                    raise ValueError("Invalid sprite frame geometry")
                if clip.get("firstCell",0)+clip["count"] > page["frames"]:
                    raise ValueError("Sprite frame outside encoded page")
                if key not in pages:
                    pages[key] = dict(file=verified[key],cell=page["cell"],frames=page["frames"],cols=source_clip["cols"])
                clips[name] = clip
            shard = compress(encoded(dict(clips=clips,pages=pages)),mtime=0)
            refs.append(object_key(shard,".gz"))
    if verified.keys() != cached["pages"].keys():
        raise ValueError("Unreferenced pose banks")
    manifest = encoded(header)
    size = len(manifest) + sum(map(len,payloads.values()))
    if size > MAX_MOTION_BYTES:
        if not omit_encoder_banner:
            return stage_motion(source, cache, asset_id, portrait, content, omit_encoder_banner=True)
        raise ValueError(f"Fitted player needs {size:,} bytes")
    folder = content/"players"/asset_id
    for filename,data in payloads.items():
        install(folder/filename,data)
    revision = sha256(manifest).hexdigest()
    install(folder/(revision+".json"),manifest)
    return dict(assetId=asset_id,version=revision,bytes=size,objects=1+len(payloads))
