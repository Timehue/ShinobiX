import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

test('sealed inputs survive a fresh reader and storage failure cannot issue a token',async(t)=>{
    process.env.NODE_ENV='test';
    process.env.SHINOBIX_QA_MEMORY_KV='1';
    process.env.AVATAR_MODEL_R2_ACCOUNT_ID='a'.repeat(32);
    process.env.AVATAR_MODEL_R2_PRIVATE_BUCKET='model-test-private';
    process.env.AVATAR_MODEL_R2_ACCESS_KEY_ID='fixture-id';
    process.env.AVATAR_MODEL_R2_SECRET_ACCESS_KEY='fixture-secret';
    const {sealModelRead,readPrivateModelFile}=await import('./_private-files.js');
    const {kv}=await import('../_storage.js');
    const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
    const portrait=Buffer.from('test portrait'),sheet=Buffer.from('test sheet');
    const descriptor=Buffer.from(JSON.stringify({version:1,templateSha256:'d'.repeat(64),
        fit:{declined:null,sourceSha256:sha(portrait),sheetSha256:sha(sheet)}}));
    const input={slug:'readfixture',sourceSha256:sha(portrait),masterSha256:sha(descriptor),pipelineVersion:'test',
        kitVersion:'d'.repeat(64),path:'A' as const,summary:'test coat',revision:0,expiresAt:Date.now()+60000};
    await kv.set('save:readfixture',{character:{name:'readfixture'}});
    const objects=new Map<string,Buffer>();
    let corrupt=false;
    t.mock.method(globalThis,'fetch',async(raw:string,init:RequestInit)=>{
        const url=new URL(raw),headers=new Headers(init.headers);
        assert.equal(url.host,'a'.repeat(32)+'.r2.cloudflarestorage.com');
        assert.match(url.pathname,/^\/model-test-private\/avatar-model\/private\/(portraits|sheets|masters)\/[a-f0-9]{64}$/);
        assert.match(headers.get('Authorization')??'',/^AWS4-HMAC-SHA256 Credential=fixture-id\//);
        assert.equal(init.redirect,'error');
        if(init.method==='PUT'){
            const references=await kv.mget<Array<{files:Array<{kind:string;hash:string}>}>>(...await kv.keys('avatar-model:private-ref:*'));
            const path=url.pathname.split('/');
            assert.ok(references.some(ref=>ref?.files.some(f=>f.kind===path.at(-2) && f.hash===path.at(-1))),
                'Every upload must have a durable ownership reference before the request starts');
            const data=Buffer.from(await (init.body as Blob).arrayBuffer());
            assert.equal(headers.get('x-amz-content-sha256'),sha(data));
            objects.set(url.pathname,data);return new Response(null,{status:200});
        }
        return new Response(new Uint8Array(corrupt?Buffer.from('bad'):objects.get(url.pathname)!));
    });
    await assert.rejects(sealModelRead(input,portrait,descriptor,Buffer.from('different sheet')),/different fit/);
    assert.equal(objects.size,0);
    corrupt=true;
    await assert.rejects(sealModelRead(input,portrait,descriptor,sheet),/digest mismatch/);
    assert.deepEqual(await kv.keys('avatar-model:read:*'),[]);
    assert.ok((await kv.keys('avatar-model:private-ref:*')).length>0,'Interrupted uploads remain discoverable');
    corrupt=false;
    const token=await sealModelRead(input,portrait,descriptor,sheet);
    assert.ok(token);assert.equal(objects.size,3);
    const master=JSON.parse((await readPrivateModelFile('masters',input.masterSha256)).toString());
    assert.deepEqual(await readPrivateModelFile('portraits',master.fit.sourceSha256),portrait);
    assert.deepEqual(await readPrivateModelFile('sheets',master.fit.sheetSha256),sheet);
    assert.equal((await kv.keys('avatar-model:read:*')).length,1);
    assert.deepEqual(await kv.keys('avatar-model:slot:*'),[]);
});
