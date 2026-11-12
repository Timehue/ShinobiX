"""Identify the actual decoded frame the installed reader will use for this source."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import sys

from PIL import Image


def frame_digest(entry, upload):
    sys.path.insert(0, str(entry.resolve().parent))
    from fit_masked_upload import prepare_portrait
    frame = prepare_portrait(upload.read_bytes())
    with Image.open(BytesIO(frame.png)) as image:
        digest = sha256(f"{image.width}x{image.height}:".encode())
        digest.update(image.convert("RGBA").tobytes())
    return digest.hexdigest()


if __name__ == "__main__":
    print(frame_digest(Path(sys.argv[1]), Path(sys.argv[2])))
