"""Check that costume retries use the same head-direction instructions."""
import base64
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import paint_portrait


class CostumePromptTest(unittest.TestCase):
    def test_new_and_existing_paint_attempts_keep_their_prompt_revision(self):
        png = BytesIO()
        Image.new("RGBA", (1536, 960)).save(png, "PNG")
        art = png.getvalue()
        result = {"data": [{"b64_json": base64.b64encode(art).decode()}]}
        source = "1" * 64
        asset = "2" * 32

        def request(_portrait, _source, _template, correction, _previous, *, sector_guide, head_turnaround):
            return {"guide": sector_guide, "prompt": paint_portrait.PROMPT + (
                paint_portrait.HEAD_TURNAROUND if head_turnaround else ""), "correction": correction}

        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            template = root / "template.json"
            template.write_bytes(b"template")
            for label, enabled in (("new", True), ("legacy", False)):
                with self.subTest(label=label), patch.object(paint_portrait, "edit_request", side_effect=request) as build:
                    folder = root / label
                    if not enabled:
                        first = folder / "edit-1"
                        first.mkdir(parents=True)
                        body = request(root/"portrait", source, template, None, None,
                                       sector_guide=paint_portrait.SECTOR_GUIDE, head_turnaround=False)
                        raw = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
                        operation = sha256(asset.encode() + b"\x001\x00" + raw).hexdigest()
                        (first / "painting.png").write_bytes(art)
                        (first / "completed.json").write_text(json.dumps({
                            "operation": operation, "painting": sha256(art).hexdigest(),
                            "binding": {"job": asset, "source": source, "template": sha256(b"template").hexdigest(),
                                        "sectorGuide": paint_portrait.SECTOR_GUIDE},
                        }))
                    submit = Mock(return_value=("fixture", result))
                    painter = paint_portrait.costume_painter(folder, asset, Mock(return_value=True), submit)
                    painter(root/"portrait", source, template, 1, None)
                    painter(root/"portrait", source, template, 2, "Repair detached sleeve")
                    painter(root/"portrait", source, template, 2, "Repair detached sleeve")
                    self.assertEqual([call.kwargs["head_turnaround"] for call in build.call_args_list], [enabled] * 3)
                    self.assertEqual(submit.call_count, 2 if enabled else 1)
                    first_binding = json.loads((folder/"edit-1/completed.json").read_bytes())["binding"]
                    self.assertEqual(first_binding.get("headTurnaround", False), enabled)


if __name__ == "__main__":
    unittest.main()
