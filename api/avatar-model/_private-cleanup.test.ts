import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { test } from 'node:test';

test('private erasure protects shared files, retries failures and fences delayed uploads with unique tombstones',async t=>{
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1',
        AVATAR_MODEL_R2_ACCOUNT_ID:'a'.repeat(32),AVATAR_MODEL_R2_PRIVATE_BUCKET:'cleanup-private',
        AVATAR_MODEL_R2_ACCESS_KEY_ID:'fixture',AVATAR_MODEL_R2_SECRET_ACCESS_KEY:'fixture'});
    const {kv}=await import('../_storage.js');
    const {ensureModelOwner,modelOwnerKey}=await import('./_owner.js');
    const {erasePrivateReference}=await import('./_private-cleanup.js');
    const {privateReferenceKey}=await import('./_private-index.js');
    const {sealModelRead,privateObjectRequest,erasePrivateModelFile,readPrivateModelFile}=await import('./_private-files.js');
    const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
    const portrait=Buffer.from('private portrait'),sheet=Buffer.from('private fitted sheet');
    const descriptor=Buffer.from(JSON.stringify({version:1,templateSha256:'a'.repeat(64),
        fit:{declined:null,sourceSha256:sha(portrait),sheetSha256:sha(sheet)}}));
    const objects=new Map<string,{bytes:Buffer;etag:string;deleted:boolean}>();
    let eraseFailure=false,puts=0;
    t.mock.method(globalThis,'fetch',async(raw:string,init:RequestInit)=>{
        const key=new URL(raw).pathname,headers=new Headers(init.headers),old=objects.get(key);
        if(init.method==='PUT') {
            puts++;
            if(headers.has('if-none-match')) {
                assert.match(headers.get('Authorization')??'',/SignedHeaders=[^,]*if-none-match/);
                if(old) return new Response(null,{status:412});
            }
            if(headers.has('if-match')) {
                assert.match(headers.get('Authorization')??'',/SignedHeaders=[^,]*if-match/);
                if(old?.etag!==headers.get('if-match')) return new Response(null,{status:412});
            }
            const deleted=headers.get('x-amz-meta-avatar-model-deleted')==='1';
            if(eraseFailure && deleted && key.includes('/masters/')) return new Response(null,{status:503});
            const bytes=Buffer.from(await (init.body as Blob).arrayBuffer());
            objects.set(key,{bytes,etag:'"'+sha(bytes)+'"',deleted});
            return new Response(null,{status:200});
        }
        if(!old) return new Response(null,{status:404});
        return new Response(new Uint8Array(old.bytes),{headers:{ETag:old.etag,'Content-Length':String(old.bytes.length),
            ...(old.deleted ? {'x-amz-meta-avatar-model-deleted':'1'} : {})}});
    });
    async function seal(owner:string) {
        const input={slug:owner,sourceSha256:sha(portrait),masterSha256:sha(descriptor),pipelineVersion:'fixture',
            kitVersion:'a'.repeat(64),path:'A' as const,summary:'Test coat',revision:0,
            expiresAt:Date.now()+60000,operation:randomUUID()};
        const token=await sealModelRead(input,portrait,descriptor,sheet);
        return {input,token,key:privateReferenceKey(input.operation)};
    }
    for(const owner of ['privatefirst','privatesecond']) await kv.set('save:'+owner,{character:{name:owner}});
    const a=await seal('privatefirst'),b=await seal('privatesecond');
    const future=Date.now()+120000;
    assert.equal(await erasePrivateReference(a.key,undefined,Date.now()),false,'Live reads remain available');
    assert.equal(await erasePrivateReference(a.key,undefined,future),true);
    assert.deepEqual(await readPrivateModelFile('portraits',sha(portrait)),portrait,'Another reference protects shared bytes');
    assert.equal([...objects.values()].some(object=>object.deleted),false);
    eraseFailure=true;
    await assert.rejects(erasePrivateReference(b.key,undefined,future),/remains pending/);
    assert.ok(await kv.get(b.key),'A partial failure retains the retry anchor');
    eraseFailure=false;
    assert.equal(await erasePrivateReference(b.key,undefined,future),true);
    assert.equal(await kv.get(b.key),null);
    assert.equal([...objects.values()].filter(object=>object.deleted && object.bytes.length===32).length,3);
    const pathname='/cleanup-private/avatar-model/private/portraits/'+sha(portrait);
    const marker=objects.get(pathname)!;
    const late=await privateObjectRequest('portraits',sha(portrait),'PUT',portrait,{ifNoneMatch:'*'});
    assert.equal(late.status,412,'An earlier delayed immutable upload cannot resurrect erased content');
    await erasePrivateModelFile('portraits',sha(portrait));
    assert.notEqual(objects.get(pathname)?.etag,marker.etag,'Every erasure has a distinct marker version');
    const staleRestore=await privateObjectRequest('portraits',sha(portrait),'PUT',portrait,{ifMatch:marker.etag});
    assert.equal(staleRestore.status,412,'A delayed restoration cannot overwrite a later erasure');
    const restored=await seal('privatefirst');
    assert.deepEqual(await readPrivateModelFile('portraits',sha(portrait)),portrait,'A new valid upload can use the same artwork');
    const owner=await ensureModelOwner('privatefirst');assert.ok(owner.ok);
    await kv.set(modelOwnerKey(owner.value.id),{...owner.value,state:'deleting'});
    const before=puts;
    await assert.rejects(seal('privatefirst'),/unavailable/);
    assert.equal(puts,before,'A deleted account cannot write more private objects');
    assert.equal(await erasePrivateReference(restored.key),true,'Account deletion also erases unexpired reads');
});

test('verified publication erases transient files and retains the final fit until revocation',async()=>{
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1'});
    const {kv}=await import('../_storage.js');
    const {ensureModelOwner}=await import('./_owner.js');
    const {declarePrivateRead,extendPrivateJobFiles,withPrivateFileLock}=await import('./_private-index.js');
    const {erasePrivateReference}=await import('./_private-cleanup.js');
    const owner='jobprivatecleanup';await kv.set('save:'+owner,{character:{name:owner}});
    const identity=await ensureModelOwner(owner);assert.ok(identity.ok);
    const key=await withPrivateFileLock(()=>declarePrivateRead({slug:owner,accountId:identity.value.id,
        sourceSha256:'1'.repeat(64),masterSha256:'2'.repeat(64),expiresAt:Date.now()+60000}));
    const original=await kv.get<Record<string,unknown>>(key),jobId='private-cleanup-job';
    await kv.set(key,{...original,state:'job',jobId});
    await kv.set('avatar-model:job:'+jobId,{slug:owner,accountId:identity.value.id,state:'render'});
    await kv.set('avatar-model:active:'+owner,jobId);
    await extendPrivateJobFiles({owner,accountId:identity.value.id,jobId,referenceKey:key,revision:0},[
        {kind:'masters',hash:'4'.repeat(64)},{kind:'sheets',hash:'3'.repeat(64)},{kind:'sheets',hash:'5'.repeat(64)},
    ]);
    const erased:string[]=[];
    const erase=async(kind:string,hash:string)=>{erased.push(kind+'/'+hash);};
    assert.equal(await erasePrivateReference(key,erase),false);assert.deepEqual(erased,[]);
    const assetId='f'.repeat(32),version='a'.repeat(64);
    const job={slug:owner,accountId:identity.value.id,state:'ready',assetId,delivery:{version},
        summary:'A detailed description from the portrait',sourceKey:'private/portrait',
        masterKey:'private/master',originalMasterSha256:'c'.repeat(64),checkedPainting:'d'.repeat(64),
        recognition:{nonce:'e'.repeat(64)},masterSha256:'4'.repeat(64),
        reserved:[{provider:'modal',cycle:'test',micros:100}],providerCalls:{'A/1':'fc-fixture'}};
    await kv.set('avatar-model:job:'+jobId,job);
    const assetKey='avatar-model:asset:'+assetId;
    const asset={owner,accountId:identity.value.id,jobId,status:'ready',version,masterSha256:job.masterSha256};
    assert.equal(await erasePrivateReference(key,erase),false,'A ready job without its public asset retains its inputs');
    await kv.set(assetKey,{...asset,version:'b'.repeat(64)});
    assert.equal(await erasePrivateReference(key,erase),false,'Another public revision cannot authorize deletion');
    await kv.set(assetKey,asset);
    await kv.set('avatar-model:job:'+jobId,{...job,publishingAt:Date.now()});
    assert.equal(await erasePrivateReference(key,erase),false,'A publishing worker may still use the files');
    await kv.set('avatar-model:job:'+jobId,job);
    await kv.del('avatar-model:active:'+owner);
    await assert.rejects(extendPrivateJobFiles({owner,accountId:identity.value.id,jobId,referenceKey:key,revision:0},
        [{kind:'sheets',hash:'4'.repeat(64)}]),/changed before storage/);
    const read=async (kind:string,hash:string)=>{
        if(kind==='masters') {
            assert.equal(hash,job.masterSha256);
            return Buffer.from(JSON.stringify({fit:{sourceSha256:'1'.repeat(64),sheetSha256:'5'.repeat(64)}}));
        }
        assert.equal(kind,'sheets');
        assert.equal(hash,'5'.repeat(64));
        return Buffer.from('verified final fitted sheet');
    };
    await assert.rejects(erasePrivateReference(key,erase,Date.now(),async()=>{throw Error('No verified fit');}),/No verified fit/);
    assert.deepEqual(erased,[],'If the final fit cannot be verified, keep every input');
    await assert.rejects(erasePrivateReference(key,async()=>{throw Error('Object store unavailable');},Date.now(),read),/remains pending/);
    assert.deepEqual(await kv.get('avatar-model:job:'+jobId),job,'A failed erasure retains the retry state');
    assert.equal(await erasePrivateReference(key,erase,Date.now(),read),true);
    assert.deepEqual(erased.sort(),['masters/'+'2'.repeat(64),'portraits/'+'1'.repeat(64),'sheets/'+'3'.repeat(64)]);
    const fit=await kv.get<{files:{kind:string;hash:string}[];retainedForRerender:boolean}>(key);
    assert.equal(fit?.retainedForRerender,true);
    assert.deepEqual(fit?.files,[{kind:'masters',hash:'4'.repeat(64)},{kind:'sheets',hash:'5'.repeat(64)}]);
    assert.equal(await erasePrivateReference(key,erase),false,'Cleanup leaves a published fit available');
    assert.deepEqual(await kv.get(assetKey),asset);
    const retained = await kv.get<Record<string, unknown>>('avatar-model:job:'+jobId);
    for (const field of ['summary','sourceKey','masterKey','originalMasterSha256','checkedPainting'])
        assert.equal(Object.hasOwn(retained!,field),false);
    assert.deepEqual(retained?.providerCalls,job.providerCalls);
    assert.deepEqual(retained?.reserved,job.reserved);
    assert.deepEqual(retained?.recognition,job.recognition);
    assert.equal(retained?.masterSha256,job.masterSha256);
    await kv.set(assetKey,{...asset,status:'revoked'});
    erased.length=0;
    assert.equal(await erasePrivateReference(key,erase),true);
    assert.deepEqual(erased.sort(),['masters/'+'4'.repeat(64),'sheets/'+'5'.repeat(64)]);
    assert.equal(await kv.get(key),null);
});

test('the bounded sweep retains failed references for retry and runs independently of creation and paid dispatch',async()=>{
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1'});
    const {kv}=await import('../_storage.js');
    const {ensureModelOwner}=await import('./_owner.js');
    const {declarePrivateRead,withPrivateFileLock}=await import('./_private-index.js');
    const {erasePrivateReference,sweepPrivateModelReferences,tickPrivateModelCleanup}=await import('./_private-cleanup.js');
    const owner='privatecleanupcursor';await kv.set('save:'+owner,{character:{name:owner}});
    const identity=await ensureModelOwner(owner);assert.ok(identity.ok);
    const keys:string[]=[];
    for(let i=0;i<3;i++) {
        const key=await withPrivateFileLock(()=>declarePrivateRead({slug:owner,accountId:identity.value.id,
            sourceSha256:String(i+4).repeat(64),masterSha256:'8'.repeat(64),expiresAt:Date.now()+60000}));
        const ref=await kv.get<Record<string,unknown>>(key);
        await kv.set(key,{...ref,expiresAt:Date.now()-1});keys.push(key);
    }
    keys.sort();
    const first=await sweepPrivateModelReferences(async key=>{
        if(key===keys[0]) throw new Error('temporary storage failure');
        return erasePrivateReference(key,async()=>{});
    });
    assert.equal(first.failed,1);assert.equal(first.erased,2);assert.ok(await kv.get(keys[0]));
    const retry=await sweepPrivateModelReferences(key=>erasePrivateReference(key,async()=>{}));
    assert.equal(retry.erased,1);assert.equal(retry.failed,0);assert.equal(await kv.get(keys[0]),null);
    const before=await kv.get('avatar-model:private-cleanup-last');
    process.env.AVATAR_MODEL_CLEANUP_ENABLED='0';await tickPrivateModelCleanup();
    assert.deepEqual(await kv.get('avatar-model:private-cleanup-last'),before);
    Object.assign(process.env,{AVATAR_MODEL_CLEANUP_ENABLED:'1',AVATAR_MODEL_KILL_SWITCH:'1',AVATAR_MODEL_DISPATCH_ENABLED:'0'});
    await tickPrivateModelCleanup();
    assert.equal((await kv.get<{checked:number}>('avatar-model:private-cleanup-last'))?.checked,0);
    delete process.env.AVATAR_MODEL_CLEANUP_ENABLED;delete process.env.AVATAR_MODEL_KILL_SWITCH;
});
