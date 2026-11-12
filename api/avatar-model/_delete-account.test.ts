import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { test } from 'node:test';

async function fixture(owner:string) {
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1',SESSION_SECRET:'model-account-deletion-fixture-secret'});
    const {kv}=await import('../_storage.js');
    const {perImageKey}=await import('../images.js');
    const {issueModelRead,admitModelJob}=await import('./_admission.js');
    const {ensureModelOwner}=await import('./_owner.js');
    const portrait=Buffer.from('private avatar for deletion '+owner),source=createHash('sha256').update(portrait).digest('hex');
    await kv.set('save:'+owner,{_saveVersion:1,character:{name:owner,level:10,ryo:50,patreon:{active:true,source:'promo',tier:'supporter'}}});
    await kv.set('auth:'+owner,{hash:'fixture-hash',salt:'fixture-salt',sessionEpoch:0});
    await kv.set(perImageKey('avatar:'+owner),'data:image/png;base64,'+portrait.toString('base64'));
    const identity=await ensureModelOwner(owner);assert.ok(identity.ok);
    const token=await issueModelRead({slug:owner,sourceSha256:source,masterSha256:'d'.repeat(64),pipelineVersion:'fixture',
        kitVersion:'fixture',path:'A',summary:'Test coat',expiresAt:Date.now()+60000,revision:0});
    const policy={enabled:true,dailyLimit:100,recognition:{model:'local-vision-fixture',poolSha256:'9'.repeat(64)},
        providers:(['modal','openai'] as const).map(provider=>({provider,cycle:owner,perAttemptMicros:100,limitMicros:3000}))};
    const admitted=await admitModelJob(owner,token,token,policy);assert.ok('jobId' in admitted,JSON.stringify(admitted));
    const jobId=admitted.jobId,key='avatar-model:job:'+jobId;
    const job=await kv.get<Record<string,unknown>>(key);assert.ok(job);
    return {kv,owner,accountId:identity.value.id,token,policy,jobId,key,job,source};
}

test('full account deletion fences jobs, revokes assets, queues erasure and keeps this month\'s slot for a reused name',async()=>{
    const f=await fixture('modelaccountdelete');
    const {deletePlayerAccount}=await import('../_delete-player-account.js');
    const {withKvLock}=await import('../_lock.js');
    const {ensureModelOwner}=await import('./_owner.js');
    const {admitModelJob}=await import('./_admission.js');
    const {offlineNoticesKey,pushOfflineNotice}=await import('../player/_offline-notices.js');
    const month=new Date().toISOString().slice(0,7),thisMonth='avatar-model:slot:'+f.owner+':'+month;
    const lastMonth='avatar-model:slot:'+f.owner+':2000-01';
    await f.kv.set(lastMonth,{jobId:'old-month-job',reservedAt:1,usedAt:2});
    const slotBefore=await f.kv.get(thisMonth);assert.ok(slotBefore);
    const assetId=randomUUID().replaceAll('-',''),version='a'.repeat(64);
    await f.kv.set('avatar-model:asset:'+assetId,{assetId,version,owner:f.owner,accountId:f.accountId,
        status:'ready',sourceSha256:f.source,masterSha256:'d'.repeat(64),jobId:'old-finished-job'});
    await pushOfflineNotice(f.owner,{kind:'world-model-removed',by:'moderation',sector:0,at:1,modelAccountId:f.accountId});
    const result=await withKvLock('save:'+f.owner,()=>deletePlayerAccount(f.owner),{failClosed:true});
    assert.deepEqual(result.failures,[]);
    assert.equal(await f.kv.get('auth:'+f.owner),null);assert.equal(await f.kv.get('save:'+f.owner),null);
    assert.equal(await f.kv.get(offlineNoticesKey(f.owner)),null);
    assert.equal((await f.kv.get<{state:string}>('avatar-model:owner:'+f.accountId))?.state,'deleting');
    assert.equal((await f.kv.get<{status:string}>('avatar-model:asset:'+assetId))?.status,'revoked');
    assert.ok(await f.kv.get('avatar-model:cleanup:'+assetId));
    assert.ok((await f.kv.keys('avatar-model:private-ref:*')).length,'Private erasure retains its durable references');
    assert.equal(await f.kv.get('avatar-model:active:'+f.owner),null);
    // Deleting and re-registering the same name must not grant a second slot this month.
    assert.deepEqual(await f.kv.keys('avatar-model:slot:'+f.owner+':*'),[thisMonth]);
    assert.deepEqual(await f.kv.get(thisMonth),slotBefore);
    assert.deepEqual(await f.kv.keys('avatar-model:idem:'+f.owner+':*'),[]);
    assert.equal((await f.kv.get<{state:string}>(f.key))?.state,'cancelled');
    for(const provider of ['modal','openai']) assert.deepEqual(await f.kv.get('avatar-model:budget:'+provider+':'+f.owner),
        {spentMicros:0,reservedMicros:0},'An unclaimed deleted job cannot strand a reservation');
    await f.kv.set('save:'+f.owner,{character:{name:f.owner,ryo:7,patreon:{source:'promo',tier:'supporter'}}});
    const replacement=await ensureModelOwner(f.owner);assert.ok(replacement.ok);assert.notEqual(replacement.value.id,f.accountId);
    assert.deepEqual(await admitModelJob(f.owner,f.token,f.token,f.policy),{error:'read-expired'});
});

test('account deletion during submission retains a late provider call for reconciliation and never publishes it',async()=>{
    const f=await fixture('modellateaccountdelete');
    const {advanceSpriteJob,publishSpriteJob}=await import('./_dispatch.js');
    const {detachModelAccount}=await import('./_delete-account.js');
    await advanceSpriteJob(f.jobId,f.policy,async()=>{
        await detachModelAccount(f.owner);
        return {status:'pending',callId:'fc-afterdeletion'};
    },async()=>Buffer.from(JSON.stringify({fit:{sourceSha256:f.source}})));
    const ended=await f.kv.get<{state:string;providerCalls:Record<string,string>;reserved:unknown[]}>(f.key);
    assert.equal(ended?.state,'cancelled');assert.deepEqual(ended.providerCalls,{'A/1':'fc-afterdeletion'});
    assert.equal(ended.reserved.length,2,'Dispatched costs remain reserved until the actual bill is known');
    await advanceSpriteJob(f.jobId,f.policy,async()=>{throw Error('Deleted account resumed rendering');});
    await publishSpriteJob(f.jobId,async()=>{throw Error('Deleted account published a model');});
    const assetId=String(f.job.assetId),cleanupKey='avatar-model:cleanup:'+assetId;
    const cleanup=await f.kv.get<Record<string,unknown>>(cleanupKey);
    assert.ok(cleanup);
    const queue=await f.kv.get<string[]>('avatar-model:cleanup');
    await f.kv.set(cleanupKey,{...cleanup,state:'complete'});
    await f.kv.set('avatar-model:cleanup',queue?.filter(id=>id!==assetId)??[]);
    await detachModelAccount(f.owner);
    assert.ok(!(await f.kv.get<string[]>('avatar-model:cleanup'))?.includes(assetId));
});

test('a lost deletion transaction leaves credentials, quota, job and owner intact for a retry',async t=>{
    const f=await fixture('modeldeleteconflict');
    const {detachPlayerReferences}=await import('../_delete-player-account.js');
    const batch=f.kv.compareSetMany!.bind(f.kv);
    t.mock.method(f.kv as typeof f.kv & {compareSetMany:typeof batch},'compareSetMany',async(ops:Parameters<typeof batch>[0])=>
        ops.some(op=>op.key==='avatar-model:owner:'+f.accountId) ? false : batch(ops));
    const result=await detachPlayerReferences(f.owner);
    assert.ok(result.failures.some(failure=>failure.startsWith('avatar model teardown:')));
    assert.ok(await f.kv.get('auth:'+f.owner));assert.ok(await f.kv.get('save:'+f.owner));
    assert.equal((await f.kv.get<{state:string}>('avatar-model:owner:'+f.accountId))?.state,'active');
    assert.equal((await f.kv.get<{state:string}>(f.key))?.state,'queued');
    assert.equal(await f.kv.get('avatar-model:active:'+f.owner),f.jobId);
});
