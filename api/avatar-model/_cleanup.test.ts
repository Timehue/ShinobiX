import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { test } from 'node:test';

test('public erasure reaches due entries beyond a full page of delayed retries', async () => {
    Object.assign(process.env, { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1' });
    const { kv } = await import('../_storage.js');
    const { sweepPublicModelCleanup } = await import('./_cleanup.js');
    const queued = Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(32, '0'));
    await kv.set('avatar-model:cleanup', queued);
    for (const [index, id] of queued.entries()) {
        await kv.set('avatar-model:cleanup:' + id, {
            state: 'pending', nextAttemptAt: index < 100 ? Date.now() + 60_000 : 0,
        });
    }
    const attempts: string[] = [];
    const advance = async (id: string) => { attempts.push(id); };
    await sweepPublicModelCleanup(advance);
    assert.deepEqual(attempts, []);
    await sweepPublicModelCleanup(advance);
    assert.deepEqual(attempts, [queued[100]]);
    await kv.del('avatar-model:cleanup');
});

type CleanupRequest=Parameters<NonNullable<Parameters<typeof import('./_cleanup.js').advanceModelCleanup>[1]>>[0];
const reply=(request:CleanupRequest)=>({status:'complete' as const,requestSha256:createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    assets:request.assets,journals:request.journals.length,objectsDeleted:317,purgeIds:request.assets.map(()=> 'purge_fixture')});
const erasePrivate=async()=>true;

async function revoked(suffix:string) {
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1'});
    const {kv}=await import('../_storage.js');
    const {ensureModelOwner}=await import('./_owner.js');
    const {removePlayerModel}=await import('./_removal.js');
    const owner='erasure'+suffix,assetId=randomUUID().replaceAll('-',''),pendingAsset=randomUUID().replaceAll('-','');
    const version='1'.repeat(64),jobId='finished-'+suffix,cancelledId='cancelled-'+suffix;
    await kv.set('save:'+owner,{_saveVersion:1,character:{name:owner,level:10,ryo:50,playerModel:{assetId,version}}});
    const identity=await ensureModelOwner(owner);assert.ok(identity.ok);const accountId=identity.value.id;
    const base={slug:owner,accountId,monthKey:'2026-11',attempt:1,revision:0,sourceSha256:'2'.repeat(64),masterSha256:'3'.repeat(64),reserved:[]};
    await kv.set('avatar-model:job:'+jobId,{...base,privateRefKey:'avatar-model:private-ref:'+randomUUID(),state:'ready',assetId,recognition:{nonce:'4'.repeat(64)}});
    await kv.set('avatar-model:job:'+cancelledId,{...base,privateRefKey:'avatar-model:private-ref:'+randomUUID(),state:'render',assetId:pendingAsset,recognition:{nonce:'5'.repeat(64)}});
    await kv.set('avatar-model:asset:'+assetId,{owner,accountId,assetId,version,status:'ready',jobId,
        sourceSha256:base.sourceSha256,masterSha256:base.masterSha256});
    await kv.set('avatar-model:active:'+owner,cancelledId);
    await kv.set('avatar-model:slot:'+owner+':2026-11',{jobId:cancelledId,reservedAt:1});
    await kv.set('avatar-model:dispatch',[cancelledId]);
    const result=await removePlayerModel({slug:owner,assetId,expectedVersion:version,reason:'Test requested removal',
        idempotencyKey:'cleanup-'+suffix},'admin:full');assert.ok(result.ok);
    return {kv,owner,accountId,assetId,version,jobId,cancelledId,pendingAsset,key:'avatar-model:cleanup:'+assetId};
}

test('revocation cleanup erases both owned operations, tolerates late billing updates and marks complete once',async()=>{
    const f=await revoked('confirmed');const {advanceModelCleanup}=await import('./_cleanup.js');let calls=0;
    const erase=async(request:CleanupRequest)=>{
        calls++;
        assert.deepEqual(request.assets,[f.assetId,f.pendingAsset].sort());
        assert.deepEqual(new Set(request.journals.map(row=>row.assetId)),new Set(request.assets));
        const key='avatar-model:job:'+f.cancelledId,job=await f.kv.get<Record<string,unknown>>(key);
        await f.kv.set(key,{...job,providerCalls:{'A/1':'fc-latebilling'}});
        return reply(request);
    };
    await advanceModelCleanup(f.assetId,erase,erasePrivate);await advanceModelCleanup(f.assetId,erase,erasePrivate);
    assert.equal(calls,1);
    assert.equal((await f.kv.get<{state:string}>(f.key))?.state,'complete');
    assert.ok(!(await f.kv.get<string[]>('avatar-model:cleanup'))?.includes(f.assetId));
    assert.equal((await f.kv.get<{status:string}>('avatar-model:asset:'+f.assetId))?.status,'revoked');
    assert.deepEqual((await f.kv.get<{providerCalls:unknown}>('avatar-model:job:'+f.cancelledId))?.providerCalls,{'A/1':'fc-latebilling'});
});

test('failed storage or cache purges retain the queue and a mismatched receipt cannot complete it',async()=>{
    const f=await revoked('retry');const {advanceModelCleanup}=await import('./_cleanup.js');
    await advanceModelCleanup(f.assetId,async()=>{throw Error('cache unavailable');});
    const failed=await f.kv.get<{attempt:number;state:string;nextAttemptAt:number}>(f.key);assert.ok(failed);
    assert.equal(failed.state,'pending');assert.equal(failed.attempt,1);assert.ok(failed.nextAttemptAt>Date.now());
    assert.ok((await f.kv.get<string[]>('avatar-model:cleanup'))?.includes(f.assetId));
    let called=false;await advanceModelCleanup(f.assetId,async request=>{called=true;return reply(request);},erasePrivate);assert.equal(called,false);
    await f.kv.set(f.key,{...failed,nextAttemptAt:0});
    await advanceModelCleanup(f.assetId,async request=>({...reply(request),requestSha256:'0'.repeat(64)}));
    const mismatch=await f.kv.get<Record<string,unknown>>(f.key);assert.equal(mismatch?.state,'pending');
    await f.kv.set(f.key,{...mismatch,nextAttemptAt:0});
    await advanceModelCleanup(f.assetId,async request=>reply(request),erasePrivate);
    assert.equal((await f.kv.get<{state:string}>(f.key))?.state,'complete');
});

test('cleanup refuses changed asset ownership and a job that is still publishing',async()=>{
    const {advanceModelCleanup}=await import('./_cleanup.js');
    for(const condition of ['ownership','publishing']) {
        const f=await revoked(condition);let called=false;
        if(condition==='ownership') {
            const asset=await f.kv.get<Record<string,unknown>>('avatar-model:asset:'+f.assetId);
            await f.kv.set('avatar-model:asset:'+f.assetId,{...asset,accountId:randomUUID()});
        } else {
            const key='avatar-model:job:'+f.cancelledId,job=await f.kv.get<Record<string,unknown>>(key);
            await f.kv.set(key,{...job,publishingAt:Date.now()});
        }
        await advanceModelCleanup(f.assetId,async request=>{called=true;return reply(request);});
        assert.equal(called,false);assert.equal((await f.kv.get<{state:string}>(f.key))?.state,'pending');
    }
});

test('failed recognition and player cancellation queue their unpublished operation for erasure',async()=>{
    const f=await revoked('terminal');const {endModelJob}=await import('./_settlement.js');
    const {advanceModelCleanup}=await import('./_cleanup.js');
    for(const [reason,month,state] of [['output-validation','2027-01','failed'],['player-cancelled','2027-02','cancelled']] as const) {
    const jobId='terminal-cleanup-'+reason,assetId=randomUUID().replaceAll('-','');
    await f.kv.set('avatar-model:job:'+jobId,{slug:f.owner,accountId:f.accountId,assetId,monthKey:month,state:'validate',attempt:1,
        privateRefKey:'avatar-model:private-ref:'+randomUUID(),sourceSha256:'2'.repeat(64),masterSha256:'3'.repeat(64),recognition:{nonce:'6'.repeat(64)},reserved:[]});
    await f.kv.set('avatar-model:slot:'+f.owner+':'+month,{jobId,reservedAt:1});
    await f.kv.set('avatar-model:active:'+f.owner,jobId);await f.kv.set('avatar-model:dispatch',[jobId]);
    assert.equal(await endModelJob(jobId,f.owner,reason),state);
    assert.equal(!!await f.kv.get('avatar-model:slot:'+f.owner+':'+month),reason==='player-cancelled');
    assert.ok(await f.kv.get('avatar-model:cleanup:'+assetId));
    let erased=false;
    await advanceModelCleanup(assetId,async request=>{
        erased=true;assert.deepEqual(request.assets,[assetId]);assert.equal(request.journals.length,1);return reply(request);
    },erasePrivate);
    assert.equal(erased,true);
    assert.equal((await f.kv.get<{state:string}>('avatar-model:cleanup:'+assetId))?.state,'complete');
    }
});

test('public and CDN cleanup cannot complete while private-file erasure is still failing',async()=>{
    const f=await revoked('privatefailure');const {advanceModelCleanup}=await import('./_cleanup.js');
    await advanceModelCleanup(f.assetId,async request=>reply(request),async()=>{throw Error('private storage unavailable');});
    const pending=await f.kv.get<Record<string,unknown>>(f.key);
    assert.equal(pending?.state,'pending');assert.ok((await f.kv.get<string[]>('avatar-model:cleanup'))?.includes(f.assetId));
    await f.kv.set(f.key,{...pending,nextAttemptAt:0});let references=0;
    await advanceModelCleanup(f.assetId,async request=>reply(request),async()=>{references++;return true;});
    assert.equal(references,2);assert.equal((await f.kv.get<{state:string}>(f.key))?.state,'complete');
});
