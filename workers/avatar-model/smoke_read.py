"""After a worker deploy: read one known portrait on the deployed app, and the cheap health check of every image.

Run by scripts/deploy-avatar-worker.ps1 with the deploy's Modal venv. Every portrait check died for three days
(2026-11-21 to 11-24) on a worker that deployed cleanly and passed its local tests; this proves the deployed
containers actually work before players find out. It reserves no job and touches no player's data.

    python smoke_read.py <environment> <portrait.png> <frameHash>

Prints one JSON line and exits 0 only when the read was accepted and every image's health check passed.
"""
from hashlib import sha256
import json
from pathlib import Path
import sys

from dispatch_result import failure_detail

APP = "shinobix-avatar-sprites"
HEALTH = ("health_reader", "health_render", "health_finish", "health_recognition")


def main(environment, portrait_path, frame_hash):
    import modal
    raw = Path(portrait_path).read_bytes()
    source = sha256(raw).hexdigest()
    report = {"health": {}}
    for name in HEALTH:
        try:
            report["health"][name] = modal.Function.from_name(APP, name, environment_name=environment).remote()
        except Exception as error:  # noqa: BLE001
            report["health"][name] = {"ok": False, "detail": failure_detail(error)}
    try:
        read = modal.Function.from_name(APP, "read_portrait", environment_name=environment)
        result = read.remote(raw, source, frame_hash)
        receipt = result["receipt"]
        report["read"] = {"declined": receipt["declined"], "style": receipt.get("style"),
                          "pipelineVersion": result.get("pipelineVersion")}
        if receipt["declined"] is None:
            for name, field in (("descriptor", "fittedMasterSha256"), ("sheet", "sheetSha256")):
                if sha256(result[name]).hexdigest() != receipt[field]:
                    report["read"]["declined"] = "unbound-" + name
    except Exception as error:  # noqa: BLE001
        report["read"] = {"declined": "error", "detail": failure_detail(error)}
    report["ok"] = report["read"]["declined"] is None and all(
        isinstance(row, dict) and row.get("ok") is True for row in report["health"].values())
    print(json.dumps(report))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
