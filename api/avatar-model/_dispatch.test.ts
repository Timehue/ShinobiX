import assert from 'node:assert/strict';
import { test } from 'node:test';

for (const remoteAssembly of [false,true]) test('the queue repairs one expired style and publishes once, remote assembly '+remoteAssembly,async()=>{
    process.env.NODE_ENV='test';
    process.env.SHINOBIX_QA_MEMORY_KV='1';
    const {advanceSpriteJob,publishSpriteJob}=await import('./_dispatch.js');
    const {endModelJob}=await import('./_settlement.js');
    const {kv}=await import('../_storage.js');
    const id='dispatch-job-'+remoteAssembly, slug='dispatch-fixture-'+remoteAssembly;
    const {ensureModelOwner}=await import('./_owner.js');
    await kv.set('save:'+slug,{character:{name:slug}});
    const identity=await ensureModelOwner(slug);assert.ok(identity.ok);
    const assetId=(remoteAssembly?'e':'a').repeat(32), source='b'.repeat(64), movement='d'.repeat(64);
    const prefix='avatar-model:', key=prefix+'job:'+id;
    const policy={enabled:true,dailyLimit:10,providers:[{provider:'modal' as 'modal'|'openai',cycle:'fixture',limitMicros:300,perAttemptMicros:100}]};
    await kv.set(prefix+'active:'+slug,id);
    await kv.set(prefix+'slot:'+slug+':2026-11',{jobId:id,reservedAt:42});
    await kv.set(prefix+'budget:modal:fixture',{spentMicros:0,reservedMicros:300});
    await kv.set(prefix+'budget:openai:fixture',{spentMicros:0,reservedMicros:300});
    policy.providers.push({provider:'openai',cycle:'fixture',limitMicros:300,perAttemptMicros:100});
    await kv.set(prefix+'dispatch',[id]);
    await kv.set(key,{slug,accountId:identity.value.id,sourceSha256:source,monthKey:'2026-11',state:'queued',attempt:0,
        assetId,revision:0,masterSha256:'c'.repeat(64),
        recognition:{model:'local-vision-fixture',poolSha256:'9'.repeat(64),nonce:'8'.repeat(64)},
        reserved:['modal','openai'].map(provider=>({provider,cycle:'fixture',micros:300}))});
    const read=async (kind:string)=>Buffer.from(kind==='sheets'?'pixels':JSON.stringify({fit:{sourceSha256:source,sheetSha256:'e'.repeat(64)}}));
    let unknown=true, fail=true;
    const submits:string[]=[];
    type Invoke=NonNullable<Parameters<typeof advanceSpriteJob>[2]>;
    const provider:Invoke=async req=>{
        if (!req.callId) {
            assert.ok(req.descriptor);
            if (req.stage==='A' && unknown) { unknown=false; return {status:'unknown'}; }
            if (req.stage!=='A') assert.equal(req.movement,movement);
            if (!remoteAssembly && req.stage==='finish' && req.attempt===2) {
                assert.deepEqual(req.completed,{A:'fc-A1',B:'fc-B2',C:'fc-C2'});
                return {status:'lost-style',callId:'fc-A1'};
            }
            submits.push(req.stage+req.attempt);
            return {status:'pending',callId:'fc-'+req.stage+req.attempt};
        }
        assert.equal(req.sheet,undefined);
        if (req.stage==='B' && fail) { fail=false; return {status:'failed',callId:req.callId}; }
        if (req.stage==='recognize') return {status:'complete',callId:req.callId,recognitionReceipt:{
            version:1,challengeSha256:'1'.repeat(64),replySha256:'2'.repeat(64),correct:8,rounds:8,passed:true,
            target:{assetId,version:req.model!.version,sourceSha256:source},model:req.recognition!.model,
            responseId:'resp_local',usage:{input_tokens:100,output_tokens:10,total_tokens:110},
            masterSha256:req.masterSha256,poolSha256:req.recognition!.poolSha256,nonce:req.recognition!.nonce}};
        if (req.stage==='finish') {
            if (req.attempt===2) return {status:'lost-style',callId:req.callId,lostStyle:'fc-A1'};
            assert.deepEqual(req.completed,{A:'fc-A3',B:'fc-B2',C:'fc-C2'});
            return {status:'complete',callId:req.callId,model:{assetId,version:'f'.repeat(64),objects:317,bytes:5432100}};
        }
        return {status:'complete',callId:req.callId,movement};
    };
    for(let tick=0;tick<22;tick++) await advanceSpriteJob(id,policy,provider,read);
    assert.deepEqual(submits,['A1','B1','B2','C2',...(remoteAssembly?['finish2']:[]),'A3','finish3','recognize3']);
    const job=await kv.get<{attempt:number;state:string;finishedCall:string;assetId:string;retryCauses:Record<string,number>}>(key);
    assert.equal(job?.state,'validate'); assert.equal(job.attempt,3); assert.equal(job.assetId,assetId);
    assert.equal(job.finishedCall,'fc-finish3');
    assert.deepEqual(job.retryCauses,{'worker-failure':1,'expired-style':1});
    assert.deepEqual(await kv.get(prefix+'dispatch'),[]);
    assert.deepEqual(await kv.get(prefix+'publish'),[id]);
    assert.equal(await kv.get(prefix+'asset:'+assetId),null);
    await assert.rejects(publishSpriteJob(id,async()=>{throw new Error('lost upload acknowledgement');}),/acknowledgement/);
    assert.equal(await kv.get(prefix+'asset:'+assetId),null);
    assert.equal(await endModelJob(id,slug,'player-cancelled'),'conflict');
    let uploads=0;
    for(let i=0;i<2;i++) await publishSpriteJob(id,async request=>{
        assert.equal(request.stage,'publish');
        assert.equal(request.callId,'fc-finish3');
        uploads++;
        return {status:'complete',callId:request.callId,model:request.model};
    });
    assert.equal(uploads,1);
    const slot=await kv.get<{jobId:string;reservedAt:number;usedAt:number}>(prefix+'slot:'+slug+':2026-11');
    assert.equal(slot?.jobId,id); assert.equal(slot.reservedAt,42); assert.ok(slot.usedAt>slot.reservedAt);
    assert.deepEqual(await kv.get(prefix+'publish'),[]);
    assert.equal(await kv.get(prefix+'active:'+slug),null);
    assert.equal((await kv.get<{state:string}>(key))?.state,'ready');
    const calls=(await kv.get<{providerCalls:Record<string,string>}>(key))!.providerCalls;
    assert.deepEqual(Object.values(calls).sort(), submits.map(value=>'fc-'+value).sort());
    const {reconcileModelCost}=await import('./_cost-reconciliation.js');
    const billing={final:true as const,currency:'USD' as const,provider:'modal' as const,jobId:id,assetId,
        charges:Object.values(calls).map(callId=>({callId,eventId:id+'/'+callId,cycle:'fixture',micros:10}))};
    await assert.rejects(reconcileModelCost({...billing,charges:billing.charges.filter(row=>row.callId!=='fc-B1')},true),
        /omits a recorded Modal call/);
    await reconcileModelCost(billing,true);
    assert.deepEqual(await kv.get(prefix+'budget:modal:fixture'),{spentMicros:submits.length*10,reservedMicros:0});
    assert.equal((await kv.get<{owner:string}>(prefix+'asset:'+assetId))?.owner,slug);
    process.env.SESSION_SECRET='dispatch-local-test-session-key';
    process.env.ENABLE_SECTOR_MODEL_DISPLAY='1';
    const {issuePlayerToken}=await import('../_auth.js');
    const {default:library}=await import('./models.js');
    let status=0, body:unknown;
    const res={setHeader(){},status(n:number){status=n;return res;},json(v:unknown){body=v;}};
    const get=library as unknown as (req:never,res:never)=>Promise<void>;
    await get({method:'GET',query:{},headers:{'x-player-token':issuePlayerToken(slug)}} as never,res as never);
    assert.equal(status,200);
    assert.deepEqual(body,{before:null,models:[{assetId,version:'f'.repeat(64),month:'2026-11'}]});
});

test('cancellation during submission preserves the late call ID for provider billing',async()=>{
    process.env.NODE_ENV='test';
    process.env.SHINOBIX_QA_MEMORY_KV='1';
    const {advanceSpriteJob}=await import('./_dispatch.js');
    const {endModelJob}=await import('./_settlement.js');
    const {kv}=await import('../_storage.js');
    const prefix='avatar-model:', id='cancel-during-submit', slug='cancel-pilot';
    const {ensureModelOwner}=await import('./_owner.js');
    await kv.set('save:'+slug,{character:{name:slug}});
    const identity=await ensureModelOwner(slug);assert.ok(identity.ok);
    const key=prefix+'job:'+id, assetId='9'.repeat(32), source='8'.repeat(64);
    await kv.set(prefix+'active:'+slug,id);
    await kv.set(prefix+'slot:'+slug+':2026-11',{jobId:id,reservedAt:1});
    await kv.set(prefix+'budget:modal:cancel',{spentMicros:0,reservedMicros:300});
    await kv.set(prefix+'dispatch',[id]);
    await kv.set(key,{slug,accountId:identity.value.id,assetId,sourceSha256:source,masterSha256:'7'.repeat(64),state:'queued',
        attempt:0,monthKey:'2026-11',revision:0,reserved:[{provider:'modal',cycle:'cancel',micros:300}]});
    await advanceSpriteJob(id,{enabled:true,dailyLimit:5,providers:[{provider:'modal',cycle:'cancel',
        limitMicros:300,perAttemptMicros:100}]},async ()=>{
        assert.equal(await endModelJob(id,slug,'player-cancelled'),'cancelled');
        return {status:'pending',callId:'fc-late'};
    },async()=>Buffer.from(JSON.stringify({fit:{sourceSha256:source}})));
    const record=await kv.get<{state:string; providerCalls:Record<string,string>}>(key);
    assert.equal(record?.state,'cancelled');
    assert.deepEqual(record.providerCalls,{'A/1':'fc-late'});
    assert.deepEqual(await kv.get(prefix+'budget:modal:cancel'),{spentMicros:0,reservedMicros:300});
    assert.deepEqual(await kv.get(prefix+'dispatch'),[]);
});
