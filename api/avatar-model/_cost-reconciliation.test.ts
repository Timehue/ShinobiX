import assert from 'node:assert/strict';
import { test } from 'node:test';

test('final billing statements settle exactly once across attempts, jobs and provider cycles', async () => {
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.NODE_ENV = 'test';
    const { kv } = await import('../_storage.js');
    const { reconcileModelCost } = await import('./_cost-reconciliation.js');
    const prefix = 'avatar-model:';
    const reservation = {provider:'modal',cycle:'before',micros:300};
    const other = {provider:'openai',cycle:'independent',micros:90};
    const assetId = '1'.repeat(32);
    const jobId = 'refund-job';
    const jobKey = prefix+'job:'+jobId;
    const budgetKey = prefix+'budget:modal:before';
    const job = {state:'render',assetId,reserved:[reservation,other]};
    await kv.set(jobKey,job);
    await kv.set(budgetKey,{reservedMicros:600,spentMicros:10});
    await kv.set(prefix+'budget:openai:independent',{reservedMicros:90,spentMicros:0});
    const statement = {final:true as const,currency:'USD' as const,provider:'modal' as const,jobId,assetId, charges:[
        {eventId:'failed-call-line',cycle:'before',micros:75}, {eventId:'retried-call-line',cycle:'after',micros:275}]};
    await assert.rejects(reconcileModelCost(statement,true),/terminal job/);
    await kv.set(jobKey,{...job,state:'failed'});
    await assert.rejects(reconcileModelCost({...statement,assetId:'3'.repeat(32)},true),/terminal job/);
    await assert.rejects(reconcileModelCost({...statement,charges:[]},true),/final/);
    await assert.rejects(reconcileModelCost({...statement,charges:[statement.charges[0],statement.charges[0]]},true),/duplicate/);
    assert.equal((await reconcileModelCost(statement)).status,'preview');
    assert.deepEqual(await kv.get(budgetKey),{reservedMicros:600,spentMicros:10});
    const results = await Promise.all([reconcileModelCost(statement,true),reconcileModelCost({...statement,
        charges:[...statement.charges].reverse()},true)]);
    assert.deepEqual(results.map(value => value.status).sort(),['already-settled','settled']);
    assert.deepEqual(await kv.get(budgetKey),{reservedMicros:300,spentMicros:85});
    assert.deepEqual(await kv.get(prefix+'budget:modal:after'),{reservedMicros:0,spentMicros:275});
    assert.deepEqual(await kv.get(prefix+'budget:openai:independent'),{reservedMicros:90,spentMicros:0});
    assert.deepEqual((await kv.get<typeof job>(jobKey))?.reserved,[other]);
    await assert.rejects(reconcileModelCost({...statement,charges:statement.charges.slice(1)},true),/different charges/);
    const otherId = 'delivered-job', otherAsset = '2'.repeat(32);
    await kv.set(prefix+'job:'+otherId,{state:'ready',assetId:otherAsset,reserved:[reservation]});
    await assert.rejects(reconcileModelCost({...statement,jobId:otherId,assetId:otherAsset},true),/already attributed/);
    assert.deepEqual(await kv.get(budgetKey),{reservedMicros:300,spentMicros:85});
    assert.equal((await reconcileModelCost({...statement,jobId:otherId,assetId:otherAsset,
        charges:[{eventId:'confirmed-zero',cycle:'before',micros:0}]},true)).releasedMicros,300);
    assert.deepEqual(await kv.get(budgetKey),{reservedMicros:0,spentMicros:85});
});

test('recognition costs require the retained response identity, including a refunded job',async()=>{
    Object.assign(process.env,{NODE_ENV:'test',SHINOBIX_QA_MEMORY_KV:'1'});
    const {kv}=await import('../_storage.js'); const {reconcileModelCost}=await import('./_cost-reconciliation.js');
    const jobId='review-refunded-job',assetId='7'.repeat(32),cycle='review-statement';
    await kv.set('avatar-model:job:'+jobId,{state:'failed',assetId,recognitionReceipt:{responseId:'resp_billed'},
        reserved:[{provider:'openai',cycle,micros:300}],providerCalls:{'recognize/1':'fc-review'}});
    await kv.set('avatar-model:budget:openai:'+cycle,{reservedMicros:300,spentMicros:0});
    const statement={final:true as const,currency:'USD' as const,provider:'openai' as const,jobId,assetId,
        charges:[{eventId:'recognition-actual-billing-line',cycle,micros:27}]};
    await assert.rejects(reconcileModelCost(statement,true),/omits the recorded recognition response/);
    const bound={...statement,charges:statement.charges.map(line=>({...line,responseId:'resp_billed'}))};
    assert.equal((await reconcileModelCost(bound,true)).status,'settled');
    assert.equal((await reconcileModelCost(bound,true)).status,'already-settled');
    await assert.rejects(reconcileModelCost({...bound,charges:bound.charges.map(line=>({...line,billedMilliseconds:0}))}),
        /Invalid or duplicate billing line/);
    assert.deepEqual(await kv.get('avatar-model:budget:openai:'+cycle),{reservedMicros:0,spentMicros:27});
});

test('Modal statements record time only when every charge has a confirmed duration', async () => {
    Object.assign(process.env, { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1' });
    const { kv } = await import('../_storage.js');
    const { reconcileModelCost } = await import('./_cost-reconciliation.js');
    const jobId = 'timed-modal-job', assetId = 'a'.repeat(32), cycle = 'timed-fixture';
    await kv.set('avatar-model:job:' + jobId, { assetId, state: 'ready',
        reserved: [{ provider: 'modal', cycle, micros: 300 }] });
    await kv.set('avatar-model:budget:modal:' + cycle, { reservedMicros: 300, spentMicros: 0 });
    const base = { final: true as const, currency: 'USD' as const, provider: 'modal' as const, jobId, assetId };
    const first = { eventId: 'timed-first', cycle, micros: 9, billedMilliseconds: 2500 };
    const second = { eventId: 'timed-second', cycle, micros: 0 };
    const incomplete = await reconcileModelCost({ ...base, charges: [first, second] });
    assert.equal('billedMilliseconds' in incomplete, false);
    await assert.rejects(reconcileModelCost({ ...base, charges: [{ ...first, billedMilliseconds: -1 }] }),
        /Invalid or duplicate billing line/);
    const statement = { ...base, charges: [first, { ...second, billedMilliseconds: 0 }] };
    assert.equal((await reconcileModelCost(statement, true)).billedMilliseconds, 2500);
    assert.equal((await reconcileModelCost(statement, true)).status, 'already-settled');
    await assert.rejects(reconcileModelCost({ ...base, charges: [first, second] }, true), /different charges/);
});
