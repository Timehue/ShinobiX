"""Launch the existing FramePack UI using its verified local transformer snapshot."""

from __future__ import annotations

import os
import runpy
import sys
import faulthandler
from pathlib import Path


FRAMEPACK_ROOT = Path(
    os.environ.get("FRAMEPACK_ROOT", r"C:\Users\Tyler R\.cache\FramePack")
).resolve()
TRANSFORMER_SNAPSHOT = (
    FRAMEPACK_ROOT
    / "hf_download"
    / "hub"
    / "models--lllyasviel--FramePackI2V_HY"
    / "snapshots"
    / "86cef4396041b6002c957852daac4c91aaa47c79"
).resolve()

if not (TRANSFORMER_SNAPSHOT / "diffusion_pytorch_model.safetensors.index.json").is_file():
    raise FileNotFoundError(f"FramePack transformer snapshot is incomplete: {TRANSFORMER_SNAPSHOT}")

os.environ["HF_HOME"] = str(FRAMEPACK_ROOT / "hf_download")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
sys.path.insert(0, str(FRAMEPACK_ROOT))
faulthandler.enable()
faulthandler.dump_traceback_later(90, repeat=True)

from diffusers_helper.models.hunyuan_video_packed import (  # noqa: E402
    HunyuanVideoTransformer3DModelPacked,
)


_original_from_pretrained = HunyuanVideoTransformer3DModelPacked.from_pretrained


def _local_from_pretrained(pretrained_model_name_or_path, *args, **kwargs):
    if pretrained_model_name_or_path == "lllyasviel/FramePackI2V_HY":
        pretrained_model_name_or_path = str(TRANSFORMER_SNAPSHOT)
        kwargs["local_files_only"] = True
    return _original_from_pretrained(pretrained_model_name_or_path, *args, **kwargs)


HunyuanVideoTransformer3DModelPacked.from_pretrained = staticmethod(
    _local_from_pretrained
)

demo = FRAMEPACK_ROOT / "demo_gradio.py"
sys.argv[0] = str(demo)
runpy.run_path(str(demo), run_name="__main__")
