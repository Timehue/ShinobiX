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
            // B and C start beside A, before its movement revision is known; later starts carry it.
            if (req.attempt===1) assert.equal(req.movement,undefined);
            else if (req.stage!=='A') assert.equal(req.movement,movement);
            if (!remoteAssembly && req.stage==='finish' && req.attempt===2) {
                assert.deepEqual(req.completed,{A:'fc-A1',B:'fc-B2',C:'fc-C1'});
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
            assert.deepEqual(req.completed,{A:'fc-A3',B:'fc-B2',C:'fc-C1'});
            return {status:'complete',callId:req.callId,model:{assetId,version:'f'.repeat(64),objects:317,bytes:5432100}};
        }
        return {status:'complete',callId:req.callId,movement};
    };
    for(let tick=0;tick<22;tick++) await advanceSpriteJob(id,policy,provider,read);
    // B and C start the tick after A does, so the three styles render at once. B's failure
    // retries B alone; C's early render is kept.
    assert.deepEqual(submits,['A1','B1','C1','B2',...(remoteAssembly?['finish2']:[]),'A3','finish3','recognize3']);
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
    // Publishing settles the fixed cost at once (the 300-micro holds are under the default amount),
    // so the next player's job is not blocked by this one.
    for (const provider of ['modal','openai'])
        assert.deepEqual(await kv.get(prefix+'budget:'+provider+':fixture'),{spentMicros:300,reservedMicros:0});
    assert.deepEqual((await kv.get<{reserved:unknown[]}>(key))?.reserved,[]);
    const calls=(await kv.get<{providerCalls:Record<string,string>}>(key))!.providerCalls;
    assert.deepEqual(Object.values(calls).sort(), submits.map(value=>'fc-'+value).sort());
    const {reconcileModelCost}=await import('./_cost-reconciliation.js');
    const billing={final:true as const,currency:'USD' as const,provider:'modal' as const,jobId:id,assetId,
        charges:Object.values(calls).map(callId=>({callId,eventId:id+'/'+callId,cycle:'fixture',micros:10}))};
    await assert.rejects(reconcileModelCost({...billing,charges:billing.charges.filter(row=>row.callId!=='fc-B1')},true),
        /omits a recorded Modal call/);
    // A real statement replaces the fixed estimate: the fixed 300 leaves and the billed lines take its place.
    await reconcileModelCost(billing,true);
    assert.deepEqual(await kv.get(prefix+'budget:modal:fixture'),{spentMicros:submits.length*10,reservedMicros:0});
    assert.equal((await reconcileModelCost(billing,true)).status,'already-settled');
    assert.deepEqual(await kv.get(prefix+'budget:modal:fixture'),{spentMicros:submits.length*10,reservedMicros:0});
    assert.deepEqual(await kv.get(prefix+'budget:openai:fixture'),{spentMicros:300,reservedMicros:0});
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

test('a job already rendering starts its last style at once, and a style on another movement revision renders again',async()=>{
    process.env.NODE_ENV='test';
    process.env.SHINOBIX_QA_MEMORY_KV='1';
    const {advanceSpriteJob}=await import('./_dispatch.js');
    const {kv}=await import('../_storage.js');
    const {ensureModelOwner}=await import('./_owner.js');
    const prefix='avatar-model:', id='in-flight-styles', slug='in-flight-pilot';
    await kv.set('save:'+slug,{character:{name:slug}});
    const identity=await ensureModelOwner(slug);assert.ok(identity.ok);
    const key=prefix+'job:'+id, assetId='6'.repeat(32), source='5'.repeat(64), movement='d'.repeat(64);
    await kv.set(prefix+'active:'+slug,id);
    await kv.set(prefix+'budget:modal:flight',{spentMicros:0,reservedMicros:300});
    await kv.set(prefix+'dispatch',[id]);
    // The shape of a job the previous server left mid-render: A done, B running, C not started.
    await kv.set(key,{slug,accountId:identity.value.id,assetId,sourceSha256:source,masterSha256:'4'.repeat(64),state:'render',
        attempt:1,monthKey:'2026-11',revision:0,movement,completed:{A:'fc-A1'},callId:'fc-B1',
        providerCalls:{'A/1':'fc-A1','B/1':'fc-B1'},reserved:[{provider:'modal',cycle:'flight',micros:300}]});
    const read=async (kind:string)=>Buffer.from(kind==='sheets'?'pixels':JSON.stringify({fit:{sourceSha256:source,sheetSha256:'3'.repeat(64)}}));
    const submits:string[]=[];
    let bPolls=0;
    const policy={enabled:true,dailyLimit:5,providers:[{provider:'modal' as const,cycle:'flight',limitMicros:300,perAttemptMicros:100}]};
    const tick=()=>advanceSpriteJob(id,policy,async req=>{
        if (!req.callId) {
            assert.ok(req.descriptor);
            if (req.stage!=='finish') { assert.equal(req.sheet,Buffer.from('pixels').toString('base64')); assert.equal(req.movement,movement); }
            submits.push(req.stage+req.attempt);
            return {status:'pending',callId:'fc-'+req.stage+req.attempt};
        }
        // Polls leave the revision check to the server, so an early start can be judged here.
        if (req.stage!=='finish') assert.equal(req.movement,undefined);
        if (req.stage==='B' && bPolls++===0) return {status:'pending',callId:req.callId};
        if (req.callId==='fc-C1') return {status:'complete',callId:req.callId,movement:'e'.repeat(64)};
        return {status:'complete',callId:req.callId,movement};
    },read);
    await tick();
    assert.deepEqual(submits,['C1'],'C starts while B is still rendering');
    let job=await kv.get<{running?:Record<string,string>;callId?:string;providerCalls:Record<string,string>}>(key);
    assert.deepEqual(job?.running,{C:'fc-C1'}); assert.equal(job.callId,'fc-B1');
    for (let i=0;i<5;i++) await tick();
    assert.deepEqual(submits,['C1','C2','finish2']);
    const done=await kv.get<{completed:Record<string,string>;retryCauses:Record<string,number>;running:Record<string,string>;
        providerCalls:Record<string,string>;attempt:number}>(key);
    assert.deepEqual(done?.completed,{A:'fc-A1',B:'fc-B1',C:'fc-C2'});
    assert.deepEqual(done.running,{});
    assert.equal(done.attempt,2);
    assert.deepEqual(done.retryCauses,{'worker-failure':1});
    assert.deepEqual(done.providerCalls,{'A/1':'fc-A1','B/1':'fc-B1','C/1':'fc-C1','C/2':'fc-C2','finish/2':'fc-finish2'});
});

test('an early start that errors never holds up the current style, and one whose reply was lost keeps its attempt',async()=>{
    process.env.NODE_ENV='test';
    process.env.SHINOBIX_QA_MEMORY_KV='1';
    const {advanceSpriteJob}=await import('./_dispatch.js');
    const {kv}=await import('../_storage.js');
    const {ensureModelOwner}=await import('./_owner.js');
    const prefix='avatar-model:', id='early-start-faults', slug='early-start-pilot';
    await kv.set('save:'+slug,{character:{name:slug}});
    const identity=await ensureModelOwner(slug);assert.ok(identity.ok);
    const key=prefix+'job:'+id, assetId='2'.repeat(32), source='1'.repeat(64), movement='d'.repeat(64);
    await kv.set(prefix+'active:'+slug,id);
    await kv.set(prefix+'budget:modal:faults',{spentMicros:0,reservedMicros:300});
    await kv.set(prefix+'dispatch',[id]);
    await kv.set(key,{slug,accountId:identity.value.id,assetId,sourceSha256:source,masterSha256:'0'.repeat(64),state:'render',
        attempt:1,monthKey:'2026-11',revision:0,callId:'fc-A1',providerCalls:{'A/1':'fc-A1'},
        reserved:[{provider:'modal',cycle:'faults',micros:300}]});
    const read=async (kind:string)=>Buffer.from(kind==='sheets'?'pixels':JSON.stringify({fit:{sourceSha256:source,sheetSha256:'3'.repeat(64)}}));
    const policy={enabled:true,dailyLimit:5,providers:[{provider:'modal' as const,cycle:'faults',limitMicros:300,perAttemptMicros:100}]};
    const asked:string[]=[];
    let cReply:'unknown'|'started'='unknown', aDone=false, bThrows=true;
    const tick=()=>advanceSpriteJob(id,policy,async req=>{
        if (!req.callId) {
            asked.push(req.stage+req.attempt);
            if (req.stage==='B' && bThrows) { bThrows=false; throw new Error('worker status unavailable'); }
            if (req.stage==='C') return cReply==='unknown' ? {status:'unknown'} : {status:'pending',callId:'fc-C'+req.attempt};
            return {status:'pending',callId:'fc-'+req.stage+req.attempt};
        }
        if (req.callId==='fc-A1') return aDone ? {status:'complete',callId:req.callId,movement} : {status:'failed',callId:req.callId};
        return {status:'complete',callId:req.callId,movement};
    },read);
    // B's start throws and C's reply is lost, yet A is still polled: its failure is recorded.
    await tick();
    assert.deepEqual(asked,['B1','C1']);
    let job=await kv.get<{attempt:number;callId?:string;startingAt?:Record<string,number>;retryCauses?:Record<string,number>}>(key);
    assert.equal(job?.attempt,2); assert.equal(job.callId,undefined);
    assert.deepEqual(job.retryCauses,{'worker-failure':1});
    assert.deepEqual(job.startingAt,{C:1});
    // A retries at attempt 2. C is asked again under attempt 1, never 2, so a call it started is not orphaned.
    aDone=true; asked.length=0;
    await tick();
    await tick();
    assert.deepEqual(asked,['A2','B2','C1']);
    cReply='started'; asked.length=0;
    await tick();
    assert.deepEqual(asked,['C1']);
    job=await kv.get(key);
    const started=job as unknown as {running:Record<string,string>;providerCalls:Record<string,string>;startingAt:Record<string,number>};
    // B was adopted and finished on that tick; C is now running under the attempt it first started in.
    assert.deepEqual(started.running,{C:'fc-C1'});
    assert.equal(started.providerCalls['C/1'],'fc-C1'); assert.equal(started.providerCalls['C/2'],undefined);
    assert.deepEqual(started.startingAt,{});
});

test('a style whose early start is still unresolved waits for it instead of starting a second render',async()=>{
    process.env.NODE_ENV='test';
    process.env.SHINOBIX_QA_MEMORY_KV='1';
    const {advanceSpriteJob}=await import('./_dispatch.js');
    const {kv}=await import('../_storage.js');
    const {ensureModelOwner}=await import('./_owner.js');
    const prefix='avatar-model:', id='early-start-pending', slug='early-pending-pilot';
    await kv.set('save:'+slug,{character:{name:slug}});
    const identity=await ensureModelOwner(slug);assert.ok(identity.ok);
    const key=prefix+'job:'+id, assetId='3'.repeat(32), source='2'.repeat(64), movement='d'.repeat(64);
    await kv.set(prefix+'active:'+slug,id);
    await kv.set(prefix+'budget:modal:pending',{spentMicros:0,reservedMicros:300});
    await kv.set(prefix+'dispatch',[id]);
    // A and B are done; C's early start under attempt 1 never answered, and a retry has moved the job to attempt 2.
    await kv.set(key,{slug,accountId:identity.value.id,assetId,sourceSha256:source,masterSha256:'1'.repeat(64),state:'render',
        attempt:2,monthKey:'2026-11',revision:0,movement,completed:{A:'fc-A1',B:'fc-B2'},startingAt:{C:1},
        providerCalls:{'A/1':'fc-A1','B/1':'fc-B1','B/2':'fc-B2'},reserved:[{provider:'modal',cycle:'pending',micros:300}]});
    const read=async (kind:string)=>Buffer.from(kind==='sheets'?'pixels':JSON.stringify({fit:{sourceSha256:source,sheetSha256:'3'.repeat(64)}}));
    const policy={enabled:true,dailyLimit:5,providers:[{provider:'modal' as const,cycle:'pending',limitMicros:300,perAttemptMicros:100}]};
    const asked:string[]=[];
    let answer=false;
    const tick=()=>advanceSpriteJob(id,policy,async req=>{
        asked.push(req.stage+req.attempt+(req.callId ? ':poll' : ''));
        if (!req.callId) return req.stage==='C' && !answer ? {status:'unknown'} : {status:'pending',callId:'fc-'+req.stage+req.attempt};
        return {status:'complete',callId:req.callId,movement};
    },read);
    await tick(); await tick();
    assert.deepEqual(asked,['C1','C1'],'never a fresh C2 while C1 may be running');
    assert.equal(typeof (await kv.get<{unknownSince?:number}>(key))?.unknownSince,'number');
    answer=true;
    await tick(); await tick();
    const job=await kv.get<{completed:Record<string,string>;unknownSince?:number;providerCalls:Record<string,string>}>(key);
    assert.deepEqual(job?.completed,{A:'fc-A1',B:'fc-B2',C:'fc-C1'});
    assert.equal(job.unknownSince,undefined);
    assert.equal(job.providerCalls['C/1'],'fc-C1');
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
    // A cancelled, dispatched job settles the fixed cost (never more than it held) and releases its hold.
    assert.deepEqual(await kv.get(prefix+'budget:modal:cancel'),{spentMicros:300,reservedMicros:0});
    assert.deepEqual(await kv.get(prefix+'dispatch'),[]);
});
