import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWeeklyBossSettlementCoordinator} from './weekly-boss-settlement';

test('completion and physical outcome share one request and its original damage receipt', async () => {
    const settle = createWeeklyBossSettlementCoordinator();
    let calls = 0;
    const request = async () => { calls++; return {dealt:17127}; };
    const [result, outcome] = await Promise.all([settle(request),settle(request)]);
    assert.deepEqual(result,{dealt:17127});
    assert.equal(result,outcome);
    assert.equal(calls,1);
    assert.deepEqual(await settle(request),result);
    assert.equal(calls,1);
});

test('a failed settlement can be retried without hiding the failure or duplicating parallel retries', async () => {
    const settle = createWeeklyBossSettlementCoordinator();
    let calls=0;
    const request=async()=>{if(++calls===1)throw new Error('offline');return {dealt:321};};
    await assert.rejects(settle(request),/offline/);
    const [a,b]=await Promise.all([settle(request),settle(request)]);
    assert.deepEqual(a,{dealt:321});assert.equal(a,b);assert.equal(calls,2);
});

test('a lost response does not permanently latch the retry button to a hung request',async()=>{
    const settle=createWeeklyBossSettlementCoordinator(5);
    await assert.rejects(settle(()=>new Promise(()=>{})),/timed out/);
    assert.deepEqual(await settle(async()=>({dealt:432})),{dealt:432});
});
