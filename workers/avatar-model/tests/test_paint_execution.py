"""Exercise the deployed function body locally with interrupted provider execution."""
from contextlib import ExitStack
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import modal


class PaintExecutionTest(unittest.TestCase):
    def test_duplicate_execution_cannot_issue_another_edit_after_a_billed_interruption(self):
        with patch.dict("os.environ", SPRITE_PAINTED_COSTUMES="1"), patch.object(modal, "is_local", return_value=False):
            import modal_sprite_worker as service

        portrait = b"private portrait"
        source = sha256(portrait).hexdigest()
        metadata = json.dumps({"version":1, "templateSha256":"a"*64, "fit":{
            "sourceSha256":source, "template":"male-coat-template.json", "declined":None}}).encode()
        master = sha256(metadata).hexdigest()
        asset = "1"*32
        receipt = {"operation":"costume-1", "requestId":"local-rehearsal", "model":"test",
                   "size":"1536x960", "quality":"high", "usage":{"total_tokens":100}}
        records = {}

        class Claims:
            def put(self, key, value, *, skip_if_exists=False):
                if skip_if_exists and key in records:
                    return False
                records[key] = dict(value)
                return True

        def interrupt(command, *, check):
            self.assertTrue(check)
            self.assertEqual(records[asset], {"master":master, "portrait":source, "callId":"fc-first"})
            work = Path(command[3])
            self.assertEqual((work/"portrait").read_bytes(), portrait)
            self.assertEqual((work/"screened.json").read_bytes(), metadata)
            journal = work/"edits/edit-1/provider.json"
            journal.parent.mkdir(parents=True)
            journal.write_text(json.dumps(receipt))
            raise subprocess.CalledProcessError(1, "local paint process interrupted after edit")

        with TemporaryDirectory() as temp, ExitStack() as stack:
            installation = Path(temp)
            (installation/"entry.txt").write_text(str(installation/"entry.py"))
            stack.enter_context(patch.object(service, "INSTALL", installation))
            stack.enter_context(patch.object(modal.Dict, "from_name", return_value=Claims()))
            stack.enter_context(patch.object(modal, "current_function_call_id", side_effect=["fc-first","fc-second"]))
            painter = stack.enter_context(patch.object(subprocess, "run", side_effect=interrupt))
            with self.assertRaises(subprocess.CalledProcessError):
                service.paint_costume.local(asset, metadata, master, portrait, source)
            with self.assertRaisesRegex(ValueError, "already-claimed"):
                service.paint_costume.local(asset, metadata, master, portrait, source)
            painter.assert_called_once()
        self.assertEqual(records[asset], {"master":master,"portrait":source,"callId":"fc-first","edits":[receipt]})


class BattlePaintingTest(unittest.TestCase):
    """The combat sprite is painted inside the costume call and waits for the style A render."""

    def run_costume(self, battle_step):
        with patch.dict("os.environ", SPRITE_PAINTED_COSTUMES="1"), patch.object(modal, "is_local", return_value=False):
            import modal_sprite_worker as service

        portrait = b"private portrait"
        source = sha256(portrait).hexdigest()
        metadata = json.dumps({"version":1, "templateSha256":"a"*64, "fit":{
            "sourceSha256":source, "template":"male-coat-template.json", "declined":None}}).encode()
        asset, painted = "2"*32, "c"*64
        stores = {}
        commands = []

        class Store:
            def __init__(self, name):
                self.rows = stores.setdefault(name, {})

            def put(self, key, value, *, skip_if_exists=False):
                if skip_if_exists and key in self.rows:
                    return False
                self.rows[key] = value
                return True

            def get(self, key, default=None):
                return self.rows.get(key, default)

            def pop(self, key, default=None):
                return self.rows.pop(key, default)

        def run(command, *, check, timeout=None):
            script, work = Path(command[1]).name, Path(command[3])
            commands.append(script)
            if script == "paint_admitted_costume.py":
                out = work/"painted"
                out.mkdir()
                (out/"read.json").write_text(json.dumps({"fittedMasterSha256":painted}))
                (out/"fitted-master.json").write_bytes(b"descriptor")
                (out/"candidate.png").write_bytes(b"sheet")
                journal = work/"edits/edit-1/provider.json"
                journal.parent.mkdir(parents=True)
                journal.write_text(json.dumps({"operation":"costume-1","requestId":"r1","model":"m","size":"1536x960",
                                               "quality":"high","usage":None}))
            else:
                self.assertIsNotNone(timeout)
                battle_step(work/"battle")

        with TemporaryDirectory() as temp, ExitStack() as stack:
            installation = Path(temp)
            (installation/"entry.txt").write_text(str(installation/"entry.py"))
            stack.enter_context(patch.object(service, "INSTALL", installation))
            stack.enter_context(patch.object(modal.Dict, "from_name", side_effect=lambda name, **_: Store(name)))
            stack.enter_context(patch.object(modal, "current_function_call_id", return_value="fc-first"))
            stack.enter_context(patch.object(subprocess, "run", side_effect=run))
            result = service.paint_costume.local(asset, metadata, sha256(metadata).hexdigest(), portrait, source)
            waiting = service.painted_battle_sprite(asset, painted)
            other_master = service.painted_battle_sprite(asset, "d"*64)
            service.forget_battle_sprite(asset)
            forgotten = service.painted_battle_sprite(asset, painted)
        self.assertEqual(commands, ["paint_admitted_costume.py", "paint_battle_sprite.py"])
        self.assertEqual((result["sheet"], result["descriptor"]), (b"sheet", b"descriptor"))
        edits = stores["shinobix-avatar-costume-executions"][asset]["edits"]
        return waiting, other_master, forgotten, edits

    def test_a_painted_sprite_waits_for_its_own_master_and_is_billed(self):
        def battle_step(folder):
            self.journal(folder, 1)
            (folder/"sprite.webp").write_bytes(b"painted sprite")

        waiting, other_master, forgotten, edits = self.run_costume(battle_step)
        self.assertEqual(waiting, b"painted sprite")
        self.assertIsNone(other_master)
        self.assertIsNone(forgotten)
        self.assertEqual([edit["operation"] for edit in edits], ["costume-1", "battle-1"])

    @staticmethod
    def journal(folder, attempt, text=None):
        slot = folder/f"edit-{attempt}"
        slot.mkdir(parents=True)
        (slot/"provider.json").write_text(text or json.dumps({
            "operation":f"battle-{attempt}","requestId":"r2","model":"m","size":"1024x1024","quality":"high","usage":None}))

    def test_two_refused_paintings_keep_the_costume_and_both_billing_records(self):
        def battle_step(folder):
            self.journal(folder, 1)
            self.journal(folder, 2)
            raise subprocess.CalledProcessError(1, "refused painting")

        waiting, _, _, edits = self.run_costume(battle_step)
        self.assertIsNone(waiting)
        self.assertEqual([edit["operation"] for edit in edits], ["costume-1", "battle-1", "battle-2"])

    def test_a_painting_killed_mid_record_cannot_fail_the_costume(self):
        def battle_step(folder):
            self.journal(folder, 1, text='{"operation": "battle-1", "requ')
            raise subprocess.TimeoutExpired("paint_battle_sprite.py", 900)

        waiting, _, _, edits = self.run_costume(battle_step)
        self.assertIsNone(waiting)
        self.assertEqual([edit["operation"] for edit in edits], ["costume-1"])

    def test_no_time_left_skips_the_painting(self):
        with patch.dict("os.environ", SPRITE_PAINTED_COSTUMES="1"), patch.object(modal, "is_local", return_value=False):
            import modal_sprite_worker as service
        with patch.object(subprocess, "run") as run:
            started = service.time.monotonic() - service.PAINT_TIMEOUT + service.BATTLE_PAINT_ROOM - 1
            self.assertEqual(service.paint_battle_sprite(Path("entry"), Path("work"), "2"*32, "a"*64, "c"*64, started), [])
        run.assert_not_called()

    def test_a_malformed_waiting_entry_poses_the_model_instead_of_failing_the_render(self):
        with patch.dict("os.environ", SPRITE_PAINTED_COSTUMES="1"), patch.object(modal, "is_local", return_value=False):
            import modal_sprite_worker as service
        for entry in ("text", ["list"], {"master": "c"*64}, {"master": "c"*64, "sprite": ""}, None):
            store = type("Store", (), {"get": lambda self, key, default=None, entry=entry: entry})()
            with self.subTest(entry=entry), patch.object(modal.Dict, "from_name", return_value=store):
                self.assertIsNone(service.painted_battle_sprite("2"*32, "c"*64))
