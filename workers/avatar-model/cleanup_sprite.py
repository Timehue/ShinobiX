"""Erase revoked avatar objects and private review content; never submit provider work."""
from hashlib import sha256
import json
import os
import re
import sys
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from publish_sprite import public_destination
from recognition_worker import private_claims


def validate_request(request):
    if not isinstance(request,dict) or set(request) != {"assets","journals"}:
        raise ValueError("Invalid cleanup request")
    assets,journals=request["assets"],request["journals"]
    if (not isinstance(assets,list) or not 1<=len(assets)<=2 or
            any(not isinstance(asset,str) or not re.fullmatch(r"[a-f0-9]{32}",asset) for asset in assets) or len(set(assets))!=len(assets) or
            not isinstance(journals,list) or len(journals)>2):
        raise ValueError("Invalid cleanup scope")
    journal_keys=[]
    for journal in journals:
        if (not isinstance(journal,dict) or set(journal)!={"assetId","masterSha256","nonce"} or
                journal["assetId"] not in assets or
                any(not isinstance(journal[key],str) or not re.fullmatch(r"[a-f0-9]{64}",journal[key]) for key in ("masterSha256","nonce"))):
            raise ValueError("Invalid cleanup journal")
        journal_keys.append("/".join(journal[key] for key in ("assetId","masterSha256","nonce")))
    if len(set(journal_keys))!=len(journal_keys):
        raise ValueError("Duplicate cleanup journal")
    return assets,journal_keys


def request_digest(request):
    return sha256(json.dumps(request,sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()


def revoke_asset(client,bucket,asset):
    from botocore.exceptions import ClientError
    key=f"sector-models/players/{asset}/_revoked.json"
    raw=json.dumps({"assetId":asset,"state":"revoked"},sort_keys=True,separators=(",",":")).encode()
    try:
        client.put_object(Bucket=bucket,Key=key,Body=raw,ContentType="application/json",CacheControl="no-store",IfNoneMatch="*")
    except ClientError as error:
        if error.response.get("Error",{}).get("Code") not in ("PreconditionFailed","412"):
            raise
    result=client.get_object(Bucket=bucket,Key=key)
    stream=result["Body"]
    try:
        if result["ContentLength"]!=len(raw) or stream.read(len(raw)+1)!=raw:
            raise ValueError("Unverified public revocation")
    finally:
        stream.close()


def public_keys(client,bucket,asset):
    prefix=f"sector-models/players/{asset}/"
    keys=[];token=None;seen=set()
    for _ in range(16):
        reply=client.list_objects_v2(Bucket=bucket,Prefix=prefix,MaxKeys=1000,
                                    **({"ContinuationToken":token} if token else {}))
        contents=reply.get("Contents",[])
        if not isinstance(contents,list) or len(contents)>1000 or type(reply.get("IsTruncated")) is not bool:
            raise ValueError("Invalid public cleanup listing")
        for row in contents:
            key=row.get("Key") if isinstance(row,dict) else None
            if not isinstance(key,str) or not key.startswith(prefix):
                raise ValueError("Public cleanup escaped its asset")
            name=key[len(prefix):]
            if name!="_revoked.json" and not re.fullmatch(r"[a-f0-9]{64}\.(json|gz|264|webp)",name):
                raise ValueError("Unexpected public object")
            if name!="_revoked.json":
                keys.append(key)
            if len(keys)>8192:
                raise ValueError("Oversized public cleanup")
        if not reply["IsTruncated"]:
            if len(set(keys))!=len(keys):
                raise ValueError("Duplicate public object")
            return keys
        token=reply.get("NextContinuationToken")
        if not isinstance(token,str) or not token or len(token)>4096 or token in seen:
            raise ValueError("Invalid public cleanup continuation")
        seen.add(token)
    raise ValueError("Public cleanup listing is incomplete")


def erase_public(client,bucket,asset):
    keys=public_keys(client,bucket,asset)
    for offset in range(0,len(keys),1000):
        batch=keys[offset:offset+1000]
        reply=client.delete_objects(Bucket=bucket,Delete={"Objects":[{"Key":key} for key in batch],"Quiet":False})
        deleted=reply.get("Deleted",[])
        if (reply.get("Errors") or not isinstance(deleted,list) or
                {row.get("Key") for row in deleted if isinstance(row,dict)}!=set(batch)):
            raise ValueError("Public erasure is incomplete")
    if public_keys(client,bucket,asset):
        raise ValueError("Public erasure readback failed")
    return len(keys)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


def purge_configuration():
    zone=os.environ["AVATAR_MODEL_CDN_ZONE_ID"]
    token=os.environ["AVATAR_MODEL_CDN_PURGE_TOKEN"]
    base=urlsplit(os.environ["R2_PUBLIC_BASE"])
    if (not re.fullmatch(r"[a-f0-9]{32}",zone) or not token or base.scheme!="https" or
            not base.hostname or base.username or base.password or base.port or base.query or base.fragment or
            "%" in base.path or ".." in base.path or not re.fullmatch(r"[A-Za-z0-9./_-]*",base.path)):
        raise ValueError("Invalid public cleanup configuration")
    return zone,token,base.netloc+base.path.rstrip("/")


def purge_asset(asset):
    if not isinstance(asset,str) or not re.fullmatch(r"[a-f0-9]{32}",asset):
        raise ValueError("Invalid cache purge scope")
    zone,token,base=purge_configuration()
    prefix=base+f"/sector-models/players/{asset}/"
    request=Request(f"https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache",
                    data=json.dumps({"prefixes":[prefix]}).encode(),method="POST",
                    headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    with build_opener(NoRedirect()).open(request,timeout=20) as response:
        raw=response.read(65537)
        if len(raw)>65536:
            raise ValueError("Oversized cache purge receipt")
        reply=json.loads(raw)
    if (reply.get("success") is not True or reply.get("errors") or
            not isinstance(reply.get("result"),dict) or not isinstance(reply["result"].get("id"),str) or
            not re.fullmatch(r"[A-Za-z0-9_-]{1,128}",reply["result"]["id"])):
        raise ValueError("Cache purge is unconfirmed")
    return reply["result"]["id"]


def cleanup(request,client,bucket,claims,purge):
    assets,journals=validate_request(request)
    for asset in assets:
        revoke_asset(client,bucket,asset)
    for key in journals:
        claims.redact(key)
    deleted=0;purges=[]
    for asset in assets:
        deleted+=erase_public(client,bucket,asset)
        purges.append(purge(asset))
        if public_keys(client,bucket,asset):
            raise ValueError("Public objects reappeared during cleanup")
    return {"status":"complete","requestSha256":request_digest(request),"assets":assets,
            "journals":len(journals),"objectsDeleted":deleted,"purgeIds":purges}


def main():
    raw=sys.stdin.buffer.read(32769)
    if len(raw)>32768:
        raise ValueError("Oversized cleanup request")
    request=json.loads(raw)
    validate_request(request)
    purge_configuration()
    client,bucket=public_destination()
    return cleanup(request,client,bucket,private_claims(),purge_asset)


if __name__=="__main__":
    print(json.dumps(main()))
