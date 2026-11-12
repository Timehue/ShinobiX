"""Start or resume one moderated portrait read. Invoked only by the game server."""
import base64
from hashlib import sha256
import json
import os
import re
import sys
from dispatch_result import terminal_result_errors


def advance(request, ledger, function, lookup, terminal_errors):
    operation, source = request["operation"], request["sourceSha256"]
    if not re.fullmatch(r"[a-f0-9-]{36}", operation) or not re.fullmatch(r"[a-f0-9]{64}", source):
        raise ValueError("invalid-read-binding")
    frame = request["frameHash"]
    if not re.fullmatch(r"[a-f0-9]{64}", frame):
        raise ValueError("invalid-moderated-frame")
    key = f"portrait/{operation}/{source}/{frame}"
    call = ledger.get(key)
    if call is None:
        raw = base64.b64decode(request["portrait"], validate=True)
        if not 0 < len(raw) <= 3 * 1024**2 or sha256(raw).hexdigest() != source:
            raise ValueError("invalid-portrait")
        if not ledger.put(key, "submitting", skip_if_exists=True):
            return {"status": "pending"}
        call = function.spawn(raw, source, frame, operation).object_id
        ledger.put(key, call)
    if call == "submitting":
        started = ledger.get(key + "/started")
        if started is None:
            return {"status": "pending"}
        if not isinstance(started, str) or not re.fullmatch(r"fc-[a-zA-Z0-9]{1,100}", started):
            raise ValueError("invalid-read-call")
        call = started
        ledger.put(key, call)
    if not isinstance(call, str) or not re.fullmatch(r"fc-[a-zA-Z0-9]{1,100}", call):
        raise ValueError("invalid-read-call")
    handle = lookup(call)
    try:
        result = handle.get(timeout=0)
    except terminal_errors:
        return {"status": "failed"}
    except TimeoutError:
        return {"status": "pending"}
    receipt = result["receipt"]
    if receipt["sourceSha256"] != source:
        raise ValueError("unexpected-read-source")
    if receipt["declined"] is not None:
        return {"status": "declined"}
    response = {"status": "accepted", "receipt": receipt, "pipelineVersion": result["pipelineVersion"]}
    if result.get("paintedCostumes") is True:
        response["paintedCostumes"] = True
        if isinstance(result.get("paintedTemplate"), str):
            response["paintedTemplate"] = result["paintedTemplate"]
    for name, field, limit in (("descriptor", "fittedMasterSha256", 128*1024), ("sheet", "sheetSha256", 16*1024**2)):
        data = result[name]
        if not 0 < len(data) <= limit or sha256(data).hexdigest() != receipt[field]:
            raise ValueError("unexpected-read-art")
        response[name] = base64.b64encode(data).decode("ascii")
    return response


if __name__ == "__main__":
    import modal
    env = os.environ["AVATAR_MODEL_MODAL_ENVIRONMENT"]
    ledger = modal.Dict.from_name("shinobix-avatar-dispatch", environment_name=env, create_if_missing=True)
    fn = modal.Function.from_name("shinobix-avatar-sprites", "read_portrait", environment_name=env)
    print(json.dumps(advance(json.load(sys.stdin), ledger, fn, modal.FunctionCall.from_id,
                             terminal_result_errors())))
