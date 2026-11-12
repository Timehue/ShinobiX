"""One submission or status check for a server-owned sprite stage."""
import base64
from hashlib import sha256
import json
import os
import re
import sys
from dispatch_result import terminal_result_errors


def advance(request, ledger, function, lookup, terminal_errors=(), paint_claim=None):
    """The durable reservation precedes spawn. Unknown submissions are never sent twice."""
    stage = request["stage"]
    if stage not in ("A", "B", "C", "finish", "paint", "recognize"):
        raise ValueError("invalid-stage")
    asset, master = request["assetId"], request["masterSha256"]
    if not re.fullmatch("[a-f0-9]{32}", asset) or not re.fullmatch("[a-f0-9]{64}", master):
        raise ValueError("invalid-job-binding")
    attempt = request["attempt"]
    if type(attempt) is not int or not 1 <= attempt <= 3 or (stage == "paint" and attempt != 1):
        raise ValueError("invalid-attempt")
    key = f"{asset}/{master}/{stage}/{attempt}"
    call_id = request.get("callId") or ledger.get(key)
    if call_id == "submitting" and stage != "paint":
        # A render may already be running when the submitter loses its connection.
        started = ledger.get(key + "/started")
        if not isinstance(started, str) or not re.fullmatch(r"fc-[A-Za-z0-9]{1,100}", started):
            return {"status": "unknown"}
        call_id = started
        ledger.put(key, call_id)
    elif call_id == "submitting":
        # A worker can start even if the dispatcher lost the response to spawn().
        claim = paint_claim(asset) if stage == "paint" and paint_claim else None
        if not (isinstance(claim, dict) and claim.get("master") == master
                and claim.get("portrait") == request["sourceSha256"]
                and isinstance(claim.get("callId"), str)
                and re.fullmatch(r"fc-[A-Za-z0-9]{1,100}", claim["callId"])):
            return {"status": "unknown"}
        call_id = claim["callId"]
        ledger.put(key, call_id)
    if not call_id:
        descriptor = base64.b64decode(request["descriptor"], validate=True)
        if sha256(descriptor).hexdigest() != master:
            raise ValueError("invalid-master")
        fit = json.loads(descriptor)["fit"]
        if fit["sourceSha256"] != request["sourceSha256"]:
            raise ValueError("invalid-portrait")
        if stage in ("paint", "recognize"):
            raw = base64.b64decode(request["portrait"], validate=True)
            if not 0 < len(raw) <= 3*1024**2 or sha256(raw).hexdigest() != fit["sourceSha256"]:
                raise ValueError("invalid-paint-portrait")
            args = (asset, descriptor, master, raw, fit["sourceSha256"])
            if stage == "recognize":
                from recognition_worker import validate_operation
                op = {**request["recognition"], "assetId":asset, "masterSha256":master,
                      "sourceSha256":fit["sourceSha256"], "version":request["model"]["version"]}
                validate_operation(op)
                if request["model"]["assetId"] != asset or not re.fullmatch(r"fc-[A-Za-z0-9]{1,100}", request["finishedCall"]):
                    raise ValueError("invalid-recognition-finished-call")
                args += (request["finishedCall"], request["model"], request["recognition"], attempt)
        elif stage == "finish":
            args = (asset, descriptor, master, request["completed"], attempt, request["movement"])
        else:
            sheet = base64.b64decode(request["sheet"], validate=True)
            if sha256(sheet).hexdigest() != fit["sheetSha256"]:
                raise ValueError("invalid-sheet")
            args = (descriptor, sheet, master, stage, request.get("movement"), asset, attempt)
        if not ledger.put(key, "submitting", skip_if_exists=True):
            return {"status": "unknown"}
        call_id = function.spawn(*args).object_id
        ledger.put(key, call_id)
        return {"status": "pending", "callId": call_id}
    if not re.fullmatch("fc-[a-zA-Z0-9]+", call_id):
        raise ValueError("invalid-call-id")
    handle = lookup(call_id)
    try:
        result = handle.get(timeout=0)
    except terminal_errors:
        return {"status": "failed", "callId": call_id}
    except TimeoutError:
        return {"status": "pending", "callId": call_id}
    if stage == "recognize":
        return {"status":"complete", "callId":call_id, "recognitionReceipt":result}
    if stage == "paint":
        invalid = {"status": "invalid-art", "callId": call_id}
        if not isinstance(result, dict):
            return invalid
        receipt = result.get("receipt")
        if (result.get("assetId") != asset or result.get("screened") != master or not isinstance(receipt, dict)
                or "declined" not in receipt or receipt["declined"] is not None
                or receipt.get("sourceSha256") != request["sourceSha256"] or receipt.get("style") != "painted-kit"):
            return invalid
        reply = {"status":"complete","callId":call_id}
        for key, digest, limit in (("descriptor","fittedMasterSha256",64*1024),("sheet","sheetSha256",16*1024**2)):
            data = result.get(key)
            if not isinstance(data,bytes) or not 0 < len(data) <= limit or sha256(data).hexdigest() != receipt.get(digest):
                return invalid
            reply[key] = base64.b64encode(data).decode("ascii")
        return reply
    if stage == "finish":
        if isinstance(result, dict) and "lostStyle" in result:
            lost = result["lostStyle"]
            if (result.get("assetId") != asset or result.get("master") != master
                    or result.get("movement") != request["movement"] or lost not in request["completed"].values()):
                raise ValueError("invalid-lost-style-binding")
            return {"status":"lost-style", "callId":call_id, "lostStyle":lost}
        from browser_motion import worker_delivery_objects
        worker_delivery_objects(result, asset, request["sourceSha256"])
        return {"status": "complete", "callId": call_id, "model": result["model"]}
    receipt = result["receipt"]
    if (receipt["style"] != stage or receipt["master"] != master or receipt["portrait"] != request["sourceSha256"]
            or sha256(result["archive"]).hexdigest() != receipt["archive"]
            or not re.fullmatch("[a-f0-9]{64}", receipt["movement"])
            or (request.get("movement") and receipt["movement"] != request["movement"])):
        raise ValueError("invalid-render-receipt")
    return {"status": "complete", "callId": call_id, "movement": receipt["movement"]}


def publish(request, lookup, destination):
    from botocore.exceptions import ClientError
    from publish_sprite import verify_published_result, publish_worker_result, assert_asset_active, RevokedSprite
    model, portrait = request["model"], request["sourceSha256"]
    if model["assetId"] != request["assetId"] or not re.fullmatch("fc-[A-Za-z0-9]+", request["callId"]):
        raise ValueError("invalid-publication-binding")
    client, bucket = destination()
    assert_asset_active(client,bucket,model["assetId"])
    try:
        verified = verify_published_result(model, portrait, client, bucket)
        return {"status":"complete", "callId":request["callId"], "model":verified}
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in ("NoSuchKey", "404", "NotFound"):
            raise
    except RevokedSprite:
        raise
    except ValueError:
        # Rebuild damaged content from the same sealed, validated provider result.
        pass
    handle = lookup(request["callId"])
    try:
        result = handle.get(timeout=0)
    except terminal_result_errors():
        return {"status": "failed", "callId": request["callId"]}
    if any(result["model"].get(key) != model[key] for key in ("assetId","version","objects","bytes")):
        raise ValueError("wrong-publication-call")
    verified = publish_worker_result(result, model["assetId"], portrait, client, bucket)
    return {"status":"complete", "callId":request["callId"], "model":verified}


def main():
    import modal
    request = json.load(sys.stdin)
    if request["stage"] == "publish":
        from publish_sprite import public_destination
        return publish(request, modal.FunctionCall.from_id, public_destination)
    env = os.environ["AVATAR_MODEL_MODAL_ENVIRONMENT"]
    functions = {"paint":"paint_costume","recognize":"recognize_sprite","finish": "finish_styles", "A": "render_style", "B": "render_style", "C": "render_style"}
    ledger = modal.Dict.from_name("shinobix-avatar-dispatch", environment_name=env, create_if_missing=True)
    fn = modal.Function.from_name("shinobix-avatar-sprites", functions[request["stage"]], environment_name=env)
    def paint_claim(asset):
        claims = modal.Dict.from_name("shinobix-avatar-costume-executions", environment_name=env)
        try:
            return claims.get(asset)
        except modal.exception.NotFoundError:
            # The worker creates the ledger on its first execution in this environment.
            return None

    return advance(request, ledger, fn, modal.FunctionCall.from_id, terminal_result_errors(), paint_claim)


if __name__ == "__main__":
    print(json.dumps(main()))
