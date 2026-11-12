"""Reserved, private recognition execution. Ambiguous paid submissions are never retried."""
import base64
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from zipfile import ZipFile


class PrivateRecognitionClaims:
    """Persistent private R2 journal. Conditional creation is the paid-call claim."""
    def __init__(self, client, bucket):
        self.client, self.bucket = client, bucket
        self.etags = {}

    def object_key(self, key):
        if not re.fullmatch(r"[a-f0-9]{32}/[a-f0-9]{64}/[a-f0-9]{64}", key):
            raise ValueError("recognition-journal-key")
        return "avatar-model/private/recognition/" + key + ".json"

    def _read(self, key, *, billing=False):
        from botocore.exceptions import ClientError
        name = self.object_key(key)
        if billing:
            name = name.replace("/recognition/", "/recognition-billing/")
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=name)
        except ClientError as error:
            if error.response.get("Error",{}).get("Code") in ("NoSuchKey","404","NotFound"):
                self.etags[name] = None
                return None
            raise
        stream = response["Body"]
        try:
            if response["ContentLength"] > 16 * 1024**2:
                raise ValueError("recognition-journal-size")
            raw = stream.read(16 * 1024**2 + 1)
            if len(raw) != response["ContentLength"]:
                raise ValueError("recognition-journal-readback")
            tag = response.get("ETag")
            if not isinstance(tag, str) or not 1 <= len(tag) <= 256:
                raise ValueError("recognition-journal-version")
            self.etags[name] = tag
            return raw
        finally:
            stream.close()

    def get(self, key):
        def restore(value):
            if isinstance(value, dict):
                if set(value) == {"$bytes"}:
                    return base64.b64decode(value["$bytes"],validate=True)
                return {k:restore(v) for k,v in value.items()}
            if isinstance(value, list):
                return [restore(v) for v in value]
            return value
        raw = self._read(key)
        return None if raw is None else restore(json.loads(raw))

    def put(self, key, record, *, skip_if_exists=False):
        from botocore.exceptions import ClientError
        def encode(value):
            if isinstance(value, bytes):
                return {"$bytes":base64.b64encode(value).decode("ascii")}
            raise TypeError("unsupported-private-recognition-value")
        raw = json.dumps(record,default=encode,sort_keys=True,separators=(",",":"),allow_nan=False).encode()
        if len(raw) > 16 * 1024**2:
            raise ValueError("recognition-journal-size")
        name = self.object_key(key)
        tag = self.etags.get(name)
        if not skip_if_exists and not tag:
            raise ValueError("recognition-journal-update-unobserved")
        try:
            self.client.put_object(Bucket=self.bucket, Key=name, Body=raw,
                                   ContentType="application/json", CacheControl="private, no-store",
                                   **({"IfNoneMatch":"*"} if skip_if_exists else {"IfMatch":tag}))
        except ClientError as error:
            if error.response.get("Error",{}).get("Code") in ("PreconditionFailed","412","ConditionalRequestConflict"):
                if skip_if_exists:
                    return False
                if self._read(key) == raw:
                    return True
                raise ValueError("recognition-journal-changed") from error
            raise
        if self._read(key) != raw:
            raise ValueError("recognition-journal-readback")
        return True

    def redact(self, key):
        """Remove portrait/challenge content while permanently refusing old paid work."""
        record = self.get(key)
        if record is not None and record.get("state") == "deleted":
            return
        tombstone = {"state":"deleted", "deletedAt":int(time.time()*1000)}
        if not self.put(key,tombstone,skip_if_exists=record is None):
            raise ValueError("recognition-journal-changed")

    def save_billing(self, key, op, response):
        """A separate immutable minimal receipt survives deletion of image content."""
        from botocore.exceptions import ClientError
        receipt = {k:op[k] for k in ("assetId","masterSha256","nonce","model")}
        request_id = response.get("requestId")
        if isinstance(request_id,str) and re.fullmatch(r"[A-Za-z0-9_-]{1,256}",request_id):
            receipt["requestId"] = request_id
        if type(response.get("status")) is int:
            receipt["status"] = response["status"]
        try:
            body = json.loads(response["body"])
        except (ValueError,TypeError):
            body = {}
        if isinstance(body,dict):
            if isinstance(body.get("id"),str) and re.fullmatch(r"resp_[A-Za-z0-9_-]{1,200}",body["id"]):
                receipt["responseId"] = body["id"]
            usage = body.get("usage",{})
            if isinstance(usage,dict):
                receipt["usage"] = {k:usage[k] for k in ("input_tokens","output_tokens","total_tokens")
                                    if type(usage.get(k)) is int and usage[k]>=0}
        name = self.object_key(key).replace("/recognition/", "/recognition-billing/")
        raw = json.dumps(receipt,sort_keys=True,separators=(",",":"),allow_nan=False).encode()
        try:
            self.client.put_object(Bucket=self.bucket,Key=name,Body=raw,ContentType="application/json",
                                   CacheControl="private, no-store",IfNoneMatch="*")
        except ClientError as error:
            if error.response.get("Error",{}).get("Code") not in ("PreconditionFailed","412"):
                raise
        if self._read(key,billing=True) != raw:
            raise ValueError("recognition-billing-readback")


def private_claims():
    import boto3
    account, bucket = os.environ["AVATAR_MODEL_R2_ACCOUNT_ID"], os.environ["AVATAR_MODEL_R2_PRIVATE_BUCKET"]
    public = os.environ["AVATAR_MODEL_R2_PUBLIC_BUCKET"]
    if (not re.fullmatch(r"[a-f0-9]{32}", account) or not re.fullmatch(r"[a-z0-9-]{3,63}", bucket)
            or not public or bucket == public):
        raise ValueError("recognition-private-destination")
    from botocore.config import Config
    client = boto3.client("s3",endpoint_url=f"https://{account}.r2.cloudflarestorage.com",region_name="auto",
                          aws_access_key_id=os.environ["AVATAR_MODEL_R2_ACCESS_KEY_ID"],
                          aws_secret_access_key=os.environ["AVATAR_MODEL_R2_SECRET_ACCESS_KEY"],
                          config=Config(connect_timeout=10,read_timeout=30,retries={"total_max_attempts":1}))
    return PrivateRecognitionClaims(client,bucket)


def validate_operation(op):
    if (not isinstance(op, dict) or set(op) != {"assetId", "masterSha256", "sourceSha256", "version", "model", "poolSha256", "nonce"}
            or not re.fullmatch(r"[a-f0-9]{32}", op["assetId"])
            or any(not isinstance(op[k], str) or not re.fullmatch(r"[a-f0-9]{64}", op[k])
                   for k in ("masterSha256", "sourceSha256", "version", "poolSha256", "nonce"))
            or not isinstance(op["model"], str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", op["model"])):
        raise ValueError("recognition-operation-binding")


def approved_decoys(archive, expected, template, target, ffmpeg):
    """The operator pins an owner-approved pool; never promote local candidates here."""
    from browser_motion import checked_browser_objects
    from recognition_lineup import idle_views
    archive = Path(archive)
    if archive.stat().st_size > 256 * 1024**2 or sha256(archive.read_bytes()).hexdigest() != expected:
        raise ValueError("recognition-pool-binding")
    with ZipFile(archive) as source:
        entries = source.infolist()
        names = {entry.filename for entry in entries}
        if (len(names) != len(entries) or len(names) > 40000 or sum(e.file_size for e in entries) > 512 * 1024**2
                or any(not re.fullmatch(r"(?:pool.json|[a-f0-9]{32}/[a-f0-9]{64}/[a-f0-9]{64}\.(?:json|gz|264|webp))", e.filename)
                       for e in entries) or source.getinfo("pool.json").file_size > 128 * 1024):
            raise ValueError("recognition-pool-shape")
        pool = json.loads(source.read("pool.json"))
        if pool.get("version") != 1 or not isinstance(pool.get("entries"), list) or len(pool["entries"]) > 64:
            raise ValueError("recognition-pool-manifest")
        choices = []
        seen = {target["sourceSha256"]}
        for entry in pool["entries"]:
            if (not isinstance(entry, dict) or not re.fullmatch(r"[a-f0-9]{32}", entry.get("assetId", ""))
                    or any(not re.fullmatch(r"[a-f0-9]{64}", entry.get(k, "")) for k in ("sourceSha256", "version"))
                    or entry.get("approved") is not True or not isinstance(entry.get("templates"), list)
                    or not entry["templates"] or any(not isinstance(t, str) or len(t) > 128 for t in entry["templates"])
                    or not isinstance(entry.get("ownerApprovedAt"), str)
                    or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z", entry["ownerApprovedAt"])):
                raise ValueError("recognition-pool-unapproved-entry")
            if template in entry["templates"] and entry["sourceSha256"] not in seen:
                seen.add(entry["sourceSha256"])
                choices.append(entry)
        choices.sort(key=lambda e: sha256((target["assetId"] + target["version"] + e["version"]).encode()).digest())
        if len(choices) < 3:
            raise ValueError("recognition-approved-decoys-unavailable")
        result = []
        for entry in choices[:3]:
            prefix = entry["assetId"] + "/" + entry["version"] + "/"
            def read(name, limit):
                member = prefix + name
                if source.getinfo(member).file_size > limit:
                    raise ValueError("recognition-decoy-object-size")
                return source.read(member)
            objects = checked_browser_objects(read, entry["version"], entry["sourceSha256"])
            model = {"assetId":entry["assetId"], "version":entry["version"],
                     "bytes":sum(map(len, objects.values())), "objects":len(objects)}
            result.append({**entry, "views":idle_views({"model":model,"objects":objects}, entry["sourceSha256"], ffmpeg)})
        return result


def prepare_review(op, descriptor, portrait, result, archive, ffmpeg):
    from recognition_lineup import challenge, idle_views
    validate_operation(op)
    if sha256(descriptor).hexdigest() != op["masterSha256"] or sha256(portrait).hexdigest() != op["sourceSha256"]:
        raise ValueError("recognition-private-input-binding")
    fit = json.loads(descriptor)["fit"]
    model = result["model"]
    if fit["sourceSha256"] != op["sourceSha256"] or model["assetId"] != op["assetId"] or model["version"] != op["version"]:
        raise ValueError("recognition-finished-binding")
    target = {k:op[k] for k in ("assetId", "sourceSha256", "version")}
    target["views"] = idle_views(result, op["sourceSha256"], ffmpeg)
    decoys = approved_decoys(archive, op["poolSha256"], fit["template"], target, ffmpeg)
    return challenge(target, decoys, portrait, nonce=op["nonce"])


def post_response(payload, api_key):
    """Exactly one HTTPS request, with no SDK retries or alternate endpoint."""
    if not api_key:
        raise ValueError("recognition-provider-key-unavailable")
    request = Request("https://api.openai.com/v1/responses", method="POST",
                      data=json.dumps(payload, allow_nan=False).encode(),
                      headers={"Authorization":"Bearer " + api_key, "Content-Type":"application/json"})
    try:
        response = urlopen(request, timeout=120)
    except HTTPError as error:
        response = error
    with response:
        raw = response.read(128 * 1024 + 1)
        if len(raw) > 128 * 1024:
            raise ValueError("recognition-provider-response-size")
        return {"status":response.status, "requestId":response.headers.get("x-request-id"), "body":raw}


def execute_review(op, prepare, claims, send):
    from recognition_lineup import completed_response, response_request
    validate_operation(op)
    key = op["assetId"] + "/" + op["masterSha256"] + "/" + op["nonce"]
    record = claims.get(key)
    if isinstance(record,dict) and record.get("state") == "deleted":
        raise ValueError("recognition-deleted")
    if record is None:
        prepared = prepare()
        payload = response_request(prepared, op["model"])
        record = {"operation":op, "prepared":prepared, "request":payload, "state":"submitting"}
        if not claims.put(key, record, skip_if_exists=True):
            record = claims.get(key)
        else:
            # If this process is interrupted after sending, leave the durable submitting claim.
            response = send(payload)
            if hasattr(claims,"save_billing"):
                claims.save_billing(key,op,response)
            record = {**record, "response":response, "state":"received"}
            claims.put(key, record)
    if isinstance(record,dict) and record.get("state") == "deleted":
        raise ValueError("recognition-deleted")
    if not isinstance(record, dict) or record.get("operation") != op:
        raise ValueError("recognition-conflicting-operation")
    if "response" not in record:
        raise ValueError("recognition-submission-ambiguous")
    response = record["response"]
    if response.get("status") != 200:
        raise ValueError("recognition-provider-refused")
    verdict = completed_response(record["prepared"], json.loads(response["body"]), op["model"])
    receipt = {**verdict, **{k:op[k] for k in ("masterSha256", "poolSha256", "nonce")}}
    claims.put(key, {**record, "receipt":receipt, "state":"complete"})
    return receipt
