"""Deliver the verified browser objects of an admitted job to its public art bucket."""
from concurrent.futures import ThreadPoolExecutor
import os
import re

from browser_motion import checked_browser_objects, worker_delivery_objects


class RevokedSprite(ValueError):
    pass


def assert_asset_active(client, bucket, asset_id):
    from botocore.exceptions import ClientError
    if not re.fullmatch(r"[a-f0-9]{32}", asset_id):
        raise ValueError("Invalid public asset")
    try:
        result = client.get_object(Bucket=bucket, Key=f"sector-models/players/{asset_id}/_revoked.json")
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in ("NoSuchKey", "404", "NotFound"):
            return
        raise
    result["Body"].close()
    raise RevokedSprite("Public sprite is revoked")


def public_destination():
    import boto3
    from botocore.config import Config

    account = os.environ["AVATAR_MODEL_R2_ACCOUNT_ID"]
    bucket = os.environ["AVATAR_MODEL_R2_PUBLIC_BUCKET"]
    private = os.environ["AVATAR_MODEL_R2_PRIVATE_BUCKET"]
    if (not re.fullmatch("[a-f0-9]{32}", account) or not re.fullmatch("[a-z0-9-]{3,63}", bucket)
            or not private or bucket == private):
        raise ValueError("Invalid public sprite destination")
    client = boto3.client("s3", endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
                          region_name="auto", aws_access_key_id=os.environ["AVATAR_MODEL_R2_PUBLIC_ACCESS_KEY_ID"],
                          aws_secret_access_key=os.environ["AVATAR_MODEL_R2_PUBLIC_SECRET_ACCESS_KEY"],
                          config=Config(connect_timeout=10, read_timeout=30, retries={"total_max_attempts":1}))
    return client, bucket


def put_verified_public_object(client, bucket, key, data, mime):
    from botocore.exceptions import ClientError

    try:
        client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=mime, IfNoneMatch="*",
                          CacheControl="public, max-age=31536000, immutable, no-transform")
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in ("PreconditionFailed", "412"):
            raise
    result = client.get_object(Bucket=bucket, Key=key)
    stream = result["Body"]
    try:
        if result["ContentLength"] != len(data) or stream.read(len(data) + 1) != data:
            raise ValueError("Public sprite read-back mismatch")
    finally:
        stream.close()


def publish_worker_result(result, asset_id, portrait, client, bucket):
    assert_asset_active(client, bucket, asset_id)
    objects = worker_delivery_objects(result, asset_id, portrait)
    def write_and_verify(name, data):
        assert_asset_active(client, bucket, asset_id)
        key = f"sector-models/players/{asset_id}/{name}"
        mime = {"json": "application/json", "webp": "image/webp"}.get(name.rsplit(".", 1)[-1], "application/octet-stream")
        put_verified_public_object(client, bucket, key, data, mime)
        assert_asset_active(client, bucket, asset_id)

    manifest = result["model"]["version"] + ".json"
    header = objects.pop(manifest)
    # Pages are immutable and independently verified. Only the manifest exposes
    # the revision to players, so write it after every successful read-back.
    with ThreadPoolExecutor(max_workers=4) as pool:
        for _ in pool.map(write_and_verify, objects.keys(), objects.values()):
            pass
    write_and_verify(manifest, header)
    assert_asset_active(client, bucket, asset_id)
    return {key: result["model"][key] for key in ("assetId", "version", "objects", "bytes")}


def verify_published_result(model, portrait, client, bucket):
    """Recover a lost publication acknowledgement, even after the provider call expires."""
    if not re.fullmatch("[a-f0-9]{32}", model["assetId"]):
        raise ValueError("Invalid public asset")
    assert_asset_active(client, bucket, model["assetId"])

    def read(name, limit):
        response = client.get_object(Bucket=bucket, Key=f"sector-models/players/{model['assetId']}/{name}")
        stream = response["Body"]
        try:
            if response["ContentLength"] > limit:
                raise ValueError("Oversized public object")
            return stream.read(limit + 1)
        finally:
            stream.close()

    objects = checked_browser_objects(read, model["version"], portrait)
    if len(objects) != model["objects"] or sum(map(len, objects.values())) != model["bytes"]:
        raise ValueError("Public delivery differs from admitted result")
    assert_asset_active(client, bucket, model["assetId"])
    return model
