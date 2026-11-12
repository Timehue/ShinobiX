import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { modelCreationFixture } from './_creation-config.fixture.js';

test('admission binds the authenticated portrait, slot, reserved costs and dispatch atomically',async()=>{
    process.env.SHINOBIX_QA_MEMORY_KV='1';
    process.env.NODE_ENV='test';
    process.env.SESSION_SECRET='local-admission-test-session-secret';
    Object.assign(process.env, modelCreationFixture);
    const {issuePlayerToken}=await import('../_auth.js');
    const {kv}=await import('../_storage.js');
    const {perImageKey}=await import('../images.js');
    const {issueModelRead, modelCreationPolicy}=await import('./_admission.js');
    const handler=(await import('./jobs.js')).default as unknown as (req:never,res:never)=>Promise<unknown>;
    const owner='modelrequester', other='modelcompetitor', third='modelthird';
    const bytes=Buffer.from('one sealed local test portrait');
    const hash=createHash('sha256').update(bytes).digest('hex');
    const data='data:image/png;base64,'+bytes.toString('base64');
    const token=(slug:string)=>issueModelRead({slug,sourceSha256:hash,masterSha256:'d'.repeat(64),pipelineVersion:'test',
        kitVersion:'test',path:'A',summary:'Hooded warrior',expiresAt:Date.now()+60000,revision:0});
    async function post(slug:string,readToken:string,idempotencyKey='one-request',extra={}) {
        let status=0,value:{error?:string;jobId?:string}={};
        const res={setHeader(){},status(s:number){status=s;return res;},end(){},json(v:typeof value){value=v;}};
        await handler({method:'POST',headers:slug?{'x-player-token':issuePlayerToken(slug)}:{},query:{},socket:{remoteAddress:'127.0.0.1'},
            body:{readToken,idempotencyKey,...extra}} as never,res as never);
        return {status,...value};
    }
    const save={character:{patreon:{active:true,source:'promo',tier:'supporter'}}};
    for (const slug of [owner,other,third]) await kv.set(perImageKey('avatar:'+slug),data);
    await kv.set('save:'+owner,{character:{name:owner}});
    const read=await token(owner);
    assert.equal((await post('',read)).status,401);
    assert.equal((await post(owner,read,'one-request',{slug:other})).status,400);
    assert.equal((await post(owner,read)).error,'entitlement');
    // Test-fixture writes mirror other API integration fixtures.
    for(const slug of [owner,other,third]) {
        const prior=await kv.get<{character?:Record<string,unknown>}>('save:'+slug);
        await kv.set('save:'+slug,{character:{...prior?.character,...save.character}});
    }
    assert.equal((await post(other,read)).error,'read-expired');
    await kv.set(perImageKey('avatar:'+owner),data.replace(bytes.toString('base64'),'Y2hhbmdlZA=='));
    assert.equal((await post(owner,read)).error,'read-expired');
    await kv.set(perImageKey('avatar:'+owner),data);
    process.env.AVATAR_MODEL_KILL_SWITCH='1';
    assert.equal((await post(owner,read)).error,'disabled');
    delete process.env.AVATAR_MODEL_KILL_SWITCH;
    const configuredPolicy=process.env.AVATAR_MODEL_RESERVATIONS_JSON!;
    const withoutReview=JSON.parse(configuredPolicy); delete withoutReview.recognition;
    process.env.AVATAR_MODEL_RESERVATIONS_JSON=JSON.stringify(withoutReview);
    assert.equal((await post(owner,read)).error,'disabled');
    const withoutReviewBudget=JSON.parse(configuredPolicy);
    withoutReviewBudget.providers=withoutReviewBudget.providers.filter((p:{provider:string})=>p.provider!=='openai');
    process.env.AVATAR_MODEL_RESERVATIONS_JSON=JSON.stringify(withoutReviewBudget);
    assert.equal((await post(owner,read)).error,'disabled');
    process.env.AVATAR_MODEL_RESERVATIONS_JSON = '{';
    assert.deepEqual(await post(third,await token(third)), { status: 503, error: 'disabled' });
    assert.deepEqual(await kv.keys('avatar-model:slot:*'), []);
    assert.equal(await kv.get('avatar-model:active:'+owner),null);
    process.env.AVATAR_MODEL_RESERVATIONS_JSON=configuredPolicy;
    process.env.DISABLE_SCHEDULED_JOBS = '1';
    assert.equal(modelCreationPolicy().enabled, false);
    process.env.DISABLE_SCHEDULED_JOBS = '0';
    process.env.R2_PUBLIC_BASE = 'https://art.example.invalid:443';
    assert.equal(modelCreationPolicy().enabled, false);
    process.env.R2_PUBLIC_BASE = modelCreationFixture.R2_PUBLIC_BASE;
    assert.equal(modelCreationPolicy().enabled, true);
    const accepted=await Promise.all([post(owner,read),post(owner,read)]);
    assert.deepEqual(accepted[0],accepted[1]);
    const jobId=accepted[0].jobId;
    assert.ok(jobId);
    assert.equal(accepted[0].status,202);
    process.env.AVATAR_MODEL_DISPATCH_ENABLED = '0';
    assert.deepEqual(await post(owner,read), accepted[0]);
    process.env.AVATAR_MODEL_DISPATCH_ENABLED = '1';
    const another=await token(owner);
    assert.equal((await post(owner,another)).error,'input');
    assert.equal((await post(owner,another,'second-request')).error,'quota');
    const [otherRead,thirdRead]=await Promise.all([token(other),token(third)]);
    const rival=await Promise.all([post(other,otherRead),post(third,thirdRead)]);
    assert.deepEqual(rival.map(x=>x.status).sort(),[202,429]);
    const dispatch=await kv.get<string[]>('avatar-model:dispatch');
    assert.equal(dispatch?.length,2);
    assert.ok(dispatch.includes(jobId));
    const day=new Date().toISOString().slice(0,10);
    assert.equal(await kv.get('avatar-model:daily:'+day),2);
    assert.deepEqual(await kv.get('avatar-model:budget:modal:test-cycle'),{reservedMicros:600,spentMicros:0});
    assert.deepEqual(await kv.get('avatar-model:budget:openai:another-cycle'),{reservedMicros:12,spentMicros:0});
    assert.equal(await kv.get('avatar-model:active:'+owner),jobId);
    assert.equal(await kv.get('avatar-model:read:'+createHash('sha256').update(read).digest('hex')),null);
    const job=await kv.get<{state:string;sourceKey:string;entitlement:{source:string};recognition:{model:string;poolSha256:string;nonce:string}}>('avatar-model:job:'+jobId);
    assert.equal(job?.state,'queued');
    assert.equal(job.entitlement.source,'promo');
    assert.equal(job.sourceKey,'avatar-model/private/portraits/'+hash);
    assert.equal(job.recognition.model,'local-vision-fixture');
    assert.equal(job.recognition.poolSha256,'9'.repeat(64));
    assert.match(job.recognition.nonce,/^[a-f0-9]{64}$/);
    const {endModelJob} = await import('./_settlement.js');
    const cancel = (await import('./jobs/cancel.js')).default as unknown as typeof handler;
    async function cancelAs(slug:string) {
        let status = 0;
        const res = {setHeader(){},status(code:number){status=code;return res;},json(){},end(){}};
        await cancel({method:'POST', query:{id:jobId}, headers:{'x-player-token':issuePlayerToken(slug)}} as never,res as never);
        return status;
    }
    assert.equal(await cancelAs(other),404);
    assert.deepEqual(await Promise.all([cancelAs(owner),cancelAs(owner)]),[200,200]);
    assert.equal(await kv.get('avatar-model:active:'+owner),null);
    assert.equal((await post(owner,another,'second-request')).error,'quota');
    assert.deepEqual(await kv.get('avatar-model:budget:modal:test-cycle'),{reservedMicros:300,spentMicros:0});
    const winner = rival[0].status === 202 ? other : third;
    let failedId = rival.find(x=>x.status===202)!.jobId!;
    // A failed, already dispatched attempt retains unknown costs until reconciled.
    const claimed = await kv.get<Record<string,unknown>>('avatar-model:job:'+failedId);
    await kv.set('avatar-model:job:'+failedId,{...claimed,attempt:1,state:'render'});
    for (let i=1;i<=3;i++) {
        assert.equal(await endModelJob(failedId,winner,'unrecognized provider exception'),'failed');
        assert.equal(await endModelJob(failedId,winner,'worker-crash'),'conflict');
        assert.equal(await endModelJob(failedId,winner,'unrecognized provider exception'),'failed');
        assert.deepEqual(await kv.get('avatar-model:failures:'+winner+':'+hash),{count:i});
        assert.equal(await kv.get('avatar-model:slot:'+winner+':'+day.slice(0,7)),null);
        assert.deepEqual(await kv.get('avatar-model:budget:modal:test-cycle'),{reservedMicros:300,spentMicros:0});
        const config=JSON.parse(process.env.AVATAR_MODEL_RESERVATIONS_JSON!);
        config.dailyLimit=10;
        process.env.AVATAR_MODEL_RESERVATIONS_JSON=JSON.stringify(config);
        const next = await post(winner,await token(winner),'retry-after-'+i);
        if (i === 3) assert.equal(next.error,'input');
        else { assert.equal(next.status,202); failedId=next.jobId!; }
    }
    assert.equal(await kv.get('avatar-model:daily:'+day),4);
});
