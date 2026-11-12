import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import type { RecognitionReceipt } from './_recognition.js';

const prefix='avatar-model:';
async function fixture(suffix:string) {
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1'});
    const {kv}=await import('../_storage.js');
    const id='recognition-'+suffix, slug='review-'+suffix;
    const {ensureModelOwner}=await import('./_owner.js');
    await kv.set('save:'+slug,{character:{name:slug}});
    const identity=await ensureModelOwner(slug);assert.ok(identity.ok);
    const recognition={model:'local-vision-fixture',poolSha256:'9'.repeat(64),nonce:'8'.repeat(64)};
    const delivery={assetId:createHash('sha256').update(suffix).digest('hex').slice(0,32),version:'2'.repeat(64),bytes:5432100,objects:317};
    const job={slug,accountId:identity.value.id,monthKey:'2026-11',state:'validate',attempt:1,assetId:delivery.assetId,revision:0,
        masterSha256:'3'.repeat(64),sourceSha256:'4'.repeat(64),finishedCall:'fc-finished',delivery,recognition,
        reserved:(['modal','openai'] as const).map(provider=>({provider,cycle:id,micros:300}))};
    await kv.set(prefix+'active:'+slug,id);
    await kv.set(prefix+'slot:'+slug+':2026-11',{jobId:id,reservedAt:42});
    for (const row of job.reserved) await kv.set(prefix+'budget:'+row.provider+':'+id,{spentMicros:0,reservedMicros:300});
    await kv.set(prefix+'dispatch',[id]); await kv.set(prefix+'publish',[]); await kv.set(prefix+'job:'+id,job);
    const receipt:RecognitionReceipt={version:1,challengeSha256:'5'.repeat(64),replySha256:'6'.repeat(64),
        target:{assetId:job.assetId,version:delivery.version,sourceSha256:job.sourceSha256},correct:8,rounds:8,passed:true,
        model:recognition.model,responseId:'resp_fixture',usage:{input_tokens:100,output_tokens:20,total_tokens:120},
        masterSha256:job.masterSha256,poolSha256:recognition.poolSha256,nonce:recognition.nonce};
    const policy={enabled:true,dailyLimit:5,providers:job.reserved.map(row=>({...row,limitMicros:300,perAttemptMicros:100}))};
    const read=async(kind:string)=>Buffer.from(kind==='portraits'?'source portrait':JSON.stringify({fit:{sourceSha256:job.sourceSha256}}));
    return {kv,id,slug,job,receipt,policy,read,key:prefix+'job:'+id};
}

test('a finished delivery remains private until its exact recognition receipt passes',async()=>{
    const f=await fixture('pass');
    const {advanceSpriteJob,publishSpriteJob}=await import('./_dispatch.js');
    let submitted=0;
    const run:NonNullable<Parameters<typeof advanceSpriteJob>[2]>=async request=>{
        assert.equal(request.stage,'recognize'); assert.equal(request.finishedCall,'fc-finished');
        assert.deepEqual(request.recognition,f.job.recognition); assert.deepEqual(request.model,f.job.delivery);
        if (!request.callId) { submitted++; assert.ok(request.portrait); return {status:'pending',callId:'fc-review'}; }
        return {status:'complete',callId:request.callId,recognitionReceipt:f.receipt};
    };
    await advanceSpriteJob(f.id,f.policy,run,f.read);
    assert.deepEqual(await f.kv.get(prefix+'publish'),[]);
    assert.equal(await f.kv.get(prefix+'asset:'+f.job.assetId),null);
    await advanceSpriteJob(f.id,f.policy,run,f.read);
    await advanceSpriteJob(f.id,f.policy,run,f.read);
    assert.equal(submitted,1); assert.deepEqual(await f.kv.get(prefix+'dispatch'),[]);
    assert.deepEqual(await f.kv.get(prefix+'publish'),[f.id]);
    let uploads=0;
    for(let n=0;n<2;n++) await publishSpriteJob(f.id,async request=>{
        uploads++; return {status:'complete',callId:request.callId,model:request.model};
    });
    assert.equal(uploads,1); assert.equal((await f.kv.get<{state:string}>(f.key))?.state,'ready');
});

test('a mismatched or uncertain sprite refunds the slot and preserves incurred reservations and verdict',async()=>{
    const {advanceSpriteJob,publishSpriteJob}=await import('./_dispatch.js');
    for(const correct of [0,6,8]) {
        const f=await fixture('reject-'+correct), receipt={...f.receipt,correct,passed:false};
        await advanceSpriteJob(f.id,f.policy,async()=>({status:'complete',callId:'fc-review',recognitionReceipt:receipt}),f.read);
        let published=false;
        await publishSpriteJob(f.id,async()=>{published=true;throw Error('rejected art cannot publish');});
        const job=await f.kv.get<{state:string;errorCode:string;recognitionReceipt:unknown}>(f.key);
        assert.equal(job?.state,'failed'); assert.equal(job.errorCode,'output-validation');
        assert.deepEqual(job.recognitionReceipt,receipt); assert.equal(published,false);
        assert.equal(await f.kv.get(prefix+'slot:'+f.slug+':2026-11'),null);
        assert.equal(await f.kv.get(prefix+'active:'+f.slug),null);
        assert.deepEqual(await f.kv.get(prefix+'dispatch'),[]);
        for(const p of f.job.reserved) assert.deepEqual(await f.kv.get(prefix+'budget:'+p.provider+':'+f.id),{spentMicros:0,reservedMicros:300});
    }
});

test('publication independently rejects missing, stale, swapped and malformed recognition receipts',async()=>{
    const {publishSpriteJob}=await import('./_dispatch.js');
    const mutations=[()=>undefined,(r:RecognitionReceipt)=>({...r,nonce:'0'.repeat(64)}),
        (r:RecognitionReceipt)=>({...r,target:{...r.target,version:'0'.repeat(64)}}),
        (r:RecognitionReceipt)=>({...r,masterSha256:'0'.repeat(64)}),
        (r:RecognitionReceipt)=>({...r,model:'wrong-fixture'}),
        (r:RecognitionReceipt)=>({...r,poolSha256:'0'.repeat(64)}),
        (r:RecognitionReceipt)=>({...r,correct:6}),
        (r:RecognitionReceipt)=>({...r,usage:{...r.usage,total_tokens:1}})];
    for(const [n,mutate] of mutations.entries()) {
        const f=await fixture('tamper-'+n);
        await f.kv.set(f.key,{...f.job,recognitionReceipt:mutate(f.receipt)});
        await f.kv.set(prefix+'publish',[f.id]);
        await publishSpriteJob(f.id,async()=>{throw Error('invalid recognition reached publication');});
        assert.equal((await f.kv.get<{state:string}>(f.key))?.state,'failed');
        assert.equal(await f.kv.get(prefix+'slot:'+f.slug+':2026-11'),null);
    }
});

test('a review failure never increments into another paid attempt',async()=>{
    const f=await fixture('provider-failure'); const {advanceSpriteJob}=await import('./_dispatch.js');
    let calls=0;
    for(let n=0;n<3;n++) await advanceSpriteJob(f.id,f.policy,async()=>{
        calls++;return {status:'failed',callId:'fc-review'};
    },f.read);
    assert.equal(calls,1);
    const ended=await f.kv.get<{state:string;attempt:number;providerCalls:unknown}>(f.key);
    assert.equal(ended?.state,'failed'); assert.equal(ended.attempt,1);
    assert.deepEqual(ended.providerCalls,{'recognize/1':'fc-review'});
});

test('cancel during a completed review keeps the cancellation and both provider billing identities',async()=>{
    const f=await fixture('cancel'); const {advanceSpriteJob,publishSpriteJob}=await import('./_dispatch.js');
    const {endModelJob}=await import('./_settlement.js');
    await advanceSpriteJob(f.id,f.policy,async()=>{
        assert.equal(await endModelJob(f.id,f.slug,'player-cancelled'),'cancelled');
        return {status:'complete',callId:'fc-review',recognitionReceipt:f.receipt};
    },f.read);
    const ended=await f.kv.get<{state:string;recognitionReceipt:unknown;providerCalls:unknown}>(f.key);
    assert.equal(ended?.state,'cancelled'); assert.deepEqual(ended.recognitionReceipt,f.receipt);
    assert.deepEqual(ended.providerCalls,{'recognize/1':'fc-review'});
    await publishSpriteJob(f.id,async()=>{throw Error('cancelled art cannot publish');});
    assert.ok((await f.kv.get<{usedAt:number}>(prefix+'slot:'+f.slug+':2026-11'))?.usedAt);
});

test('revocation and the kill switch still win before recognition publication',async()=>{
    const {publishSpriteJob}=await import('./_dispatch.js');
    for(const reason of ['revision','kill']) {
        const f=await fixture(reason); await f.kv.set(f.key,{...f.job,recognitionReceipt:f.receipt});
        await f.kv.set(prefix+'publish',[f.id]);
        if(reason==='revision') await f.kv.set(prefix+'revision:'+f.slug,1);
        else process.env.AVATAR_MODEL_KILL_SWITCH='1';
        try { await publishSpriteJob(f.id,async()=>{throw Error('revoked output cannot publish');}); }
        finally { delete process.env.AVATAR_MODEL_KILL_SWITCH; }
        assert.equal(await f.kv.get(prefix+'asset:'+f.job.assetId),null);
        // The kill switch pauses: the job stays in validate with its slot unreleased.
        assert.equal((await f.kv.get<{state:string}>(f.key))?.state,'validate');
        assert.equal((await f.kv.get<{jobId:string}>(prefix+'slot:'+f.slug+':2026-11'))?.jobId,f.id);
    }
});

test('the kill switch pauses an in-flight job and the next tick resumes it',async()=>{
    const {advanceSpriteJob}=await import('./_dispatch.js');
    const f=await fixture('pause');
    const before=await f.kv.get(f.key);
    await advanceSpriteJob(f.id,{enabled:false,dailyLimit:5,providers:[]},async()=>{throw Error('paused job must not dispatch');},f.read);
    assert.deepEqual(await f.kv.get(f.key),before);
    assert.equal(await f.kv.get(prefix+'active:'+f.slug),f.id);
    assert.equal((await f.kv.get<{jobId:string}>(prefix+'slot:'+f.slug+':2026-11'))?.jobId,f.id);
    let resumed=0;
    await advanceSpriteJob(f.id,f.policy,async request=>{resumed++;return {status:'pending',callId:'fc-resumed',stage:request.stage} as never;},f.read);
    assert.equal(resumed,1);
    assert.equal((await f.kv.get<{callId?:string}>(f.key))?.callId,'fc-resumed');
});
