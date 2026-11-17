import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

test('fixed costs default to $1 Modal and $0.25 OpenAI and follow settleMicros in the policy', async () => {
    const { fixedSettleMicros, DEFAULT_SETTLE_MICROS } = await import('./_fixed-cost.js');
    assert.deepEqual(fixedSettleMicros({}), { modal: 1_000_000, openai: 250_000 });
    assert.deepEqual(fixedSettleMicros({ AVATAR_MODEL_RESERVATIONS_JSON: '{' }), DEFAULT_SETTLE_MICROS);
    assert.deepEqual(fixedSettleMicros({ AVATAR_MODEL_RESERVATIONS_JSON: JSON.stringify({ providers: [
        { provider: 'modal', settleMicros: 760_000 },
        { provider: 'openai', settleMicros: -1 },
        { provider: 'other', settleMicros: 5 },
    ] }) }), { modal: 760_000, openai: 250_000 });
});

test('a job settles each provider once: the hold leaves, the fixed charge (at most the hold) is spent', async () => {
    const { kv } = await import('../_storage.js');
    const { fixedSettlementOps } = await import('./_fixed-cost.js');
    await kv.set('avatar-model:budget:modal:fc', { spentMicros: 5, reservedMicros: 18_000_000 + 600 });
    await kv.set('avatar-model:budget:openai:fc', { spentMicros: 0, reservedMicros: 100 });
    const job = { reserved: [
        { provider: 'modal', cycle: 'fc', micros: 18_000_000 },
        { provider: 'openai', cycle: 'fc', micros: 100 },
    ] };
    const { ops, settledCosts } = await fixedSettlementOps(job, { modal: 1_000_000, openai: 250_000 });
    assert.ok(await kv.compareSetMany!(ops));
    assert.deepEqual(await kv.get('avatar-model:budget:modal:fc'), { spentMicros: 1_000_005, reservedMicros: 600 });
    // The OpenAI hold (100) is below its fixed amount, so the charge is the hold itself.
    assert.deepEqual(await kv.get('avatar-model:budget:openai:fc'), { spentMicros: 100, reservedMicros: 0 });
    assert.deepEqual(settledCosts.modal, { digest: 'fixed:fc:1000000', releasedMicros: 18_000_000,
        spentMicros: 1_000_000, basis: 'fixed', cycle: 'fc' });
    await assert.rejects(fixedSettlementOps({ ...job, settledCosts }), /Invalid provider reservation/);
});

test('several jobs settling against one budget row write it once with their combined change', async () => {
    const { kv } = await import('../_storage.js');
    const { fixedSettlement, budgetDeltaOps } = await import('./_fixed-cost.js');
    await kv.set('avatar-model:budget:modal:merged', { spentMicros: 0, reservedMicros: 900 });
    const amounts = { modal: 100, openai: 0 };
    const deltas = [1, 2].flatMap(() => fixedSettlement({ reserved: [{ provider: 'modal', cycle: 'merged', micros: 300 }] }, amounts).deltas);
    const ops = await budgetDeltaOps([...deltas, { key: 'avatar-model:budget:modal:merged', release: 300, spend: 0 }]);
    assert.equal(ops.length, 1);
    assert.ok(await kv.compareSetMany!(ops));
    assert.deepEqual(await kv.get('avatar-model:budget:modal:merged'), { spentMicros: 200, reservedMicros: 0 });
    await assert.rejects(budgetDeltaOps([{ key: 'avatar-model:budget:modal:merged', release: 1, spend: 0 }]),
        /Inconsistent provider budget/);
});

test('a Modal attempt holds at most $1.25, whatever the policy says; a lower value still wins', async () => {
    const { modelCreationFixture } = await import('./_creation-config.fixture.js');
    const { modelCreationPolicy, MODAL_PER_ATTEMPT_CAP_MICROS } = await import('./_admission.js');
    Object.assign(process.env, modelCreationFixture);
    const live = JSON.parse(modelCreationFixture.AVATAR_MODEL_RESERVATIONS_JSON);
    for (const p of live.providers) if (p.provider === 'modal') Object.assign(p, { perAttemptMicros: 6_000_000, limitMicros: 30_000_000 });
    process.env.AVATAR_MODEL_RESERVATIONS_JSON = JSON.stringify(live);
    try {
        const policy = modelCreationPolicy();
        assert.equal(policy.enabled, true);
        assert.equal(policy.providers.find(p => p.provider === 'modal')?.perAttemptMicros, MODAL_PER_ATTEMPT_CAP_MICROS);
        assert.equal(policy.providers.find(p => p.provider === 'openai')?.perAttemptMicros, 2);
        process.env.AVATAR_MODEL_RESERVATIONS_JSON = modelCreationFixture.AVATAR_MODEL_RESERVATIONS_JSON;
        assert.equal(modelCreationPolicy().providers.find(p => p.provider === 'modal')?.perAttemptMicros, 100);
    } finally {
        process.env.AVATAR_MODEL_RESERVATIONS_JSON = modelCreationFixture.AVATAR_MODEL_RESERVATIONS_JSON;
    }
});

test('a missing budget row is refused rather than invented', async () => {
    const { fixedSettlementOps } = await import('./_fixed-cost.js');
    await assert.rejects(fixedSettlementOps({ reserved: [{ provider: 'modal', cycle: 'absent', micros: 1 }] }),
        /Reserved budget missing/);
    assert.deepEqual((await fixedSettlementOps({ reserved: [] })).ops, []);
});
