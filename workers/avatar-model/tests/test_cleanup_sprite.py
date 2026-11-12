from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock,patch

from botocore.exceptions import ClientError

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from cleanup_sprite import cleanup,main,public_keys,purge_asset,request_digest,revoke_asset,validate_request
from recognition_worker import PrivateRecognitionClaims
from publish_sprite import RevokedSprite,publish_worker_result,verify_published_result
from dispatch_stage import publish


class Store:
    def __init__(self):
        self.objects={};self.writes=[];self.deleted=[];self.page_size=2
        self.fail_delete=False;self.foreign_listing=False;self.after_put=None

    def put_object(self,*,Bucket,Key,Body,IfNoneMatch=None,IfMatch=None,**metadata):
        previous=self.objects.get((Bucket,Key))
        if (IfNoneMatch=="*" and previous is not None) or (IfMatch and (previous is None or '"'+sha256(previous).hexdigest()+'"'!=IfMatch)):
            raise ClientError({"Error":{"Code":"PreconditionFailed"}},"PutObject")
        self.objects[Bucket,Key]=Body;self.writes.append(Key)
        if self.after_put:
            self.after_put(Key)

    def get_object(self,*,Bucket,Key):
        if (Bucket,Key) not in self.objects:
            raise ClientError({"Error":{"Code":"NoSuchKey"}},"GetObject")
        raw=self.objects[Bucket,Key]
        return {"Body":BytesIO(raw),"ContentLength":len(raw),"ETag":'"'+sha256(raw).hexdigest()+'"'}

    def list_objects_v2(self,*,Bucket,Prefix,MaxKeys,ContinuationToken=None):
        keys=sorted(key for bucket,key in self.objects if bucket==Bucket and key.startswith(Prefix))
        start=int(ContinuationToken or 0);stop=start+self.page_size
        page=keys[start:stop]
        if self.foreign_listing:
            page.append("sector-models/players/"+"f"*32+"/"+"d"*64+".json")
        return {"Contents":[{"Key":key} for key in page],"IsTruncated":stop<len(keys),
                **({"NextContinuationToken":str(stop)} if stop<len(keys) else {})}

    def delete_objects(self,*,Bucket,Delete):
        deleted=[];errors=[]
        for row in Delete["Objects"]:
            key=row["Key"]
            if self.fail_delete:
                errors.append({"Key":key,"Code":"InternalError"});self.fail_delete=False;continue
            self.objects.pop((Bucket,key),None);self.deleted.append(key);deleted.append({"Key":key})
        return {"Deleted":deleted,"Errors":errors}


class CleanupTest(unittest.TestCase):
    def setUp(self):
        self.store=Store();self.asset="a"*32;self.other="b"*32
        self.prefix=f"sector-models/players/{self.asset}/"
        for i in range(4):
            self.store.objects["public",self.prefix+str(i)*64+".264"]=b"private-looking sprite bytes"
        self.other_key=f"sector-models/players/{self.other}/"+"e"*64+".json"
        self.store.objects["public",self.other_key]=b"another player's sprite"
        self.claims=PrivateRecognitionClaims(self.store,"private")
        self.journal={"assetId":self.asset,"masterSha256":"c"*64,"nonce":"d"*64}
        self.key="/".join(self.journal.values())
        self.claims.put(self.key,{"state":"answered","prepared":{"portrait":b"private original"},
                                  "response":{"body":"private provider response"}},skip_if_exists=True)
        self.claims.save_billing(self.key,{**self.journal,"model":"local-vision-fixture"},
                                {"status":200,"body":json.dumps({"id":"resp_local","usage":{"input_tokens":10,"output_tokens":1,"total_tokens":11}})})
        self.request={"assets":[self.asset],"journals":[self.journal]}

    def test_paginated_erasure_redacts_images_keeps_billing_and_other_players_and_replays(self):
        purges=[]
        def purge(asset):
            self.assertEqual(self.claims.get(self.key)["state"],"deleted")
            self.assertEqual(public_keys(self.store,"public",asset),[])
            purges.append(asset);return "purge_fixture"
        result=cleanup(self.request,self.store,"public",self.claims,purge)
        self.assertEqual(result,{"status":"complete","requestSha256":request_digest(self.request),"assets":[self.asset],
                                 "journals":1,"objectsDeleted":4,"purgeIds":["purge_fixture"]})
        self.assertEqual(self.store.objects["public",self.other_key],b"another player's sprite")
        self.assertEqual(set(self.claims.get(self.key)),{"state","deletedAt"})
        self.assertEqual(json.loads(self.claims._read(self.key,billing=True))["responseId"],"resp_local")
        self.assertEqual(cleanup(self.request,self.store,"public",self.claims,purge)["objectsDeleted"],0)
        self.assertEqual(purges,[self.asset,self.asset])

    def test_partial_bulk_delete_or_failed_purge_never_reports_completion_and_retry_finishes(self):
        self.store.fail_delete=True;purge=Mock(return_value="purge_fixture")
        with self.assertRaisesRegex(ValueError,"erasure is incomplete"):
            cleanup(self.request,self.store,"public",self.claims,purge)
        purge.assert_not_called()
        purge.side_effect=OSError("cache service offline")
        with self.assertRaises(OSError):
            cleanup(self.request,self.store,"public",self.claims,purge)
        self.assertEqual(public_keys(self.store,"public",self.asset),[])
        purge.side_effect=None
        self.assertEqual(cleanup(self.request,self.store,"public",self.claims,purge)["status"],"complete")

    def test_an_escaped_or_unexpected_listing_is_refused_before_any_delete(self):
        self.store.foreign_listing=True
        with self.assertRaisesRegex(ValueError,"escaped"):
            cleanup(self.request,self.store,"public",self.claims,Mock())
        self.assertEqual(self.store.deleted,[])
        self.store.foreign_listing=False
        self.store.objects["public",self.prefix+"private-source.png"]=b"unexpected"
        with self.assertRaisesRegex(ValueError,"Unexpected"):
            cleanup(self.request,self.store,"public",self.claims,Mock())
        self.assertEqual(self.store.deleted,[])

    def test_revocation_refuses_recovery_and_new_publication_without_a_provider_lookup(self):
        revoke_asset(self.store,"public",self.asset)
        model={"assetId":self.asset,"version":"e"*64,"objects":1,"bytes":1}
        with self.assertRaises(RevokedSprite):
            publish_worker_result({},self.asset,"c"*64,self.store,"public")
        with self.assertRaises(RevokedSprite):
            verify_published_result(model,"c"*64,self.store,"public")
        lookup=Mock()
        with self.assertRaises(RevokedSprite):
            publish({"assetId":self.asset,"model":model,"sourceSha256":"c"*64,"callId":"fc-known"},
                    lookup,lambda:(self.store,"public"))
        lookup.assert_not_called()

    def test_revocation_during_a_page_write_prevents_the_manifest_and_is_erasable(self):
        name="e"*64+".264";manifest="f"*64+".json"
        def revoke_after_page(key):
            if key.endswith(name):
                self.store.after_put=None;revoke_asset(self.store,"public",self.asset)
        self.store.after_put=revoke_after_page
        result={"model":{"version":"f"*64}}
        with patch("publish_sprite.worker_delivery_objects",return_value={name:b"x",manifest:b"{}"}),self.assertRaises(RevokedSprite):
            publish_worker_result(result,self.asset,"c"*64,self.store,"public")
        self.assertNotIn(("public",self.prefix+manifest),self.store.objects)
        self.assertEqual(cleanup(self.request,self.store,"public",self.claims,lambda _:"purge_fixture")["status"],"complete")

    def test_malformed_cleanup_requests_cannot_choose_arbitrary_prefixes_or_private_journals(self):
        for request in ({"assets":["../"],"journals":[]},{"assets":[{}],"journals":[]},
                        {"assets":[self.asset],"journals":[{**self.journal,"assetId":self.other}]},
                        {**self.request,"bucket":"private"},{"assets":[self.asset]*2,"journals":[]}):
            with self.subTest(request=request),self.assertRaises(ValueError):
                validate_request(request)

    def test_cache_purge_targets_only_this_avatar_directory_and_refuses_bad_configuration(self):
        env={"AVATAR_MODEL_CDN_ZONE_ID":"a"*32,"AVATAR_MODEL_CDN_PURGE_TOKEN":"fixture-token","R2_PUBLIC_BASE":"https://art.example.test"}
        response=Mock();response.read.return_value=b'{"success":true,"errors":[],"result":{"id":"fixture_purge"}}'
        opener=Mock();opener.open.return_value.__enter__=Mock(return_value=response);opener.open.return_value.__exit__=Mock(return_value=False)
        with patch.dict("os.environ",env),patch("cleanup_sprite.build_opener",return_value=opener):
            self.assertEqual(purge_asset(self.asset),"fixture_purge")
            request=opener.open.call_args.args[0]
            self.assertEqual(request.full_url,"https://api.cloudflare.com/client/v4/zones/"+"a"*32+"/purge_cache")
            self.assertEqual(json.loads(request.data),{"prefixes":["art.example.test/sector-models/players/"+self.asset+"/"]})
            response.read.return_value=b'{"success":false,"errors":[{"code":1}]}'
            with self.assertRaisesRegex(ValueError,"unconfirmed"):
                purge_asset(self.asset)
        stdin=Mock();stdin.buffer=BytesIO(json.dumps(self.request).encode())
        with patch.dict("os.environ",{**env,"R2_PUBLIC_BASE":"http://art.example.test"}),patch("sys.stdin",stdin),patch("cleanup_sprite.public_destination") as destination:
            with self.assertRaisesRegex(ValueError,"configuration"):
                main()
            destination.assert_not_called()


if __name__=="__main__":
    unittest.main()
