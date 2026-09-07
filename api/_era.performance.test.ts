import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

test('era contribution reads use one live batch with identical raw, receipted, and compacted totals', async t => {
    const { kv } = await import('./_storage.js');
    const { readEraContributions } = await import('./_era.js');
    await kv.set('era:contrib:missions', 10);
    await kv.set('era:contrib:discoveries', -2);
    await kv.set('era:contrib:legaciesAwakened', 4);
    await kv.set('era:contrib-receipts:legaciesAwakened', { a: 2, b: 3, invalid: -1 });
    await kv.set('era:contrib-idempotent:missions', {
        version: 1, compactedTotal: 7,
        pending: [{ version: 1, receiptId: 'mission-one', amount: 5, appliedAt: 100 }],
        settled: [],
    });
    const get = t.mock.method(kv, 'get');
    const original = kv.mget.bind(kv);
    const batch = t.mock.method(kv, 'mget', (...keys: string[]) => original(...keys));
    const result = await readEraContributions();
    assert.equal(result.missions, 22);
    assert.equal(result.legaciesAwakened, 9);
    assert.equal(result.discoveries, 0);
    assert.equal(result.pvpWins, 0);
    assert.equal(batch.mock.callCount(), 1);
    assert.equal(batch.mock.calls[0].arguments.length, 15);
    assert.equal(get.mock.callCount(), 0);
    await kv.set('era:contrib:missions', 20);
    assert.equal((await readEraContributions()).missions, 32, 'a new authoritative contribution is visible immediately');
});

test('a malformed authoritative contribution ledger still fails closed', async () => {
    const { kv } = await import('./_storage.js');
    const { readEraContributions } = await import('./_era.js');
    await kv.set('era:contrib-idempotent:missions', { version: 999 });
    await assert.rejects(readEraContributions(), /era-idempotent-contribution-corrupt/);
});
