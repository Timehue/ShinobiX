import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, type TestContext } from 'node:test';
import type { KvCasOp } from './_storage.js';

/*
 * Receipt-backed Era contributions: one receipt row plus a counter shard per
 * settlement, committed together (api/_era.ts, addReceiptContribution). These
 * replace the one hash row per metric that every receipt rewrote whole.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';

let kv: typeof import('./_storage.js').kv;
let era: typeof import('./_era.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    era = await import('./_era.js');
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

type Many = (ops: readonly KvCasOp[]) => Promise<boolean>;
const mockable = () => kv as unknown as { compareSetMany: Many };

/** Wrap kv.compareSetMany; `around` decides what each call does. */
function aroundCompareSetMany(t: TestContext, around: (ops: readonly KvCasOp[], real: Many, call: number) => Promise<boolean>) {
    const real = kv.compareSetMany!.bind(kv) as Many;
    let calls = 0;
    const mock = t.mock.method(mockable(), 'compareSetMany', (ops: readonly KvCasOp[]) => around(ops, real, ++calls));
    return mock;
}

async function shardTotals(metric: string): Promise<number[]> {
    const keys = Array.from({ length: era.ERA_RECEIPT_SHARDS }, (_, shard) => `era:contrib-sum:${metric}:${shard}`);
    return (await kv.mget<number[]>(...keys)).map((value) => Number(value ?? 0));
}

describe('receipt-backed Era contributions', () => {
    it('count a receipt once, however often it is retried', async () => {
        assert.equal(await era.bumpEraContributionOnce('discoveries', 'discovery:ayame:wanderer-discovery:road-1'), true);
        assert.equal(await era.bumpEraContributionOnce('discoveries', 'discovery:ayame:wanderer-discovery:road-1'), true);
        assert.equal(await era.bumpEraDiscoveryContribution('ayame', 'wanderer-discovery:road-1'), true);
        assert.equal((await era.readEraContributions()).discoveries, 1);
        assert.equal(await kv.get('era:receipt:discoveries:discovery:ayame:wanderer-discovery:road-1'), 1);
        assert.equal((await shardTotals('discoveries')).reduce((a, b) => a + b, 0), 1);
        assert.equal(await kv.get('era:contrib-receipts:discoveries'), null, 'the retired one-row hash is never written');
    });

    it('spread distinct receipts over the counter shards and sum them exactly', async () => {
        for (let n = 0; n < 200; n++) assert.equal(await era.bumpEraContributionOnce('warBattles', `war:battle-${n}`), true);
        assert.equal((await era.readEraContributions()).warBattles, 200);
        const shards = await shardTotals('warBattles');
        assert.equal(shards.reduce((a, b) => a + b, 0), 200);
        assert.ok(shards.filter((total) => total > 0).length >= era.ERA_RECEIPT_SHARDS / 2, `receipts spread over the shards: ${shards.join(',')}`);
    });

    it('write the receipt and its counter in one transaction, the receipt with a 30-day expiry', async (t) => {
        const batches: KvCasOp[][] = [];
        aroundCompareSetMany(t, (ops, real) => { batches.push([...ops]); return real(ops); });
        assert.equal(await era.bumpEraContributionOnce('legaciesAwakened', 'trial-7:era', 3), true);
        assert.equal(batches.length, 1);
        const [receipt, counter] = batches[0];
        assert.deepEqual(receipt, { op: 'cas', key: 'era:receipt:legaciesAwakened:trial-7:era', expected: null, value: 3, ex: era.ERA_RECEIPT_TTL_SECONDS });
        assert.equal(era.ERA_RECEIPT_TTL_SECONDS, 30 * 24 * 60 * 60);
        assert.match(counter.key, /^era:contrib-sum:legaciesAwakened:\d+$/);
        assert.equal(counter.op, 'cas');
        assert.equal((counter as { ex?: number }).ex, undefined, 'the counter never expires');
        assert.equal((await era.readEraContributions()).legaciesAwakened, 3);
    });

    it('retry, without double counting, when another settlement moved the counter first', async (t) => {
        aroundCompareSetMany(t, async (ops, real, call) => {
            if (call === 1) {
                // Another settlement commits to the same counter between our read and our write.
                const counter = ops.find((op) => op.key.startsWith('era:contrib-sum:'))!;
                await real([
                    { op: 'cas', key: 'era:receipt:warBattles:someone-else', expected: null, value: 1 },
                    { op: 'cas', key: counter.key, expected: (counter as { expected: unknown }).expected, value: 1 },
                ]);
                return real(ops); // refused: its expected counter value is stale now
            }
            return real(ops);
        });
        assert.equal(await era.bumpEraContributionOnce('warBattles', 'war:mine'), true);
        assert.equal((await era.readEraContributions()).warBattles, 2, 'one for the other settlement, one for ours');
        assert.equal(await kv.get('era:receipt:warBattles:war:mine'), 1);
    });

    it('report a failed write, and count it once on the retry', async (t) => {
        const mock = aroundCompareSetMany(t, async (ops, real, call) => {
            if (call === 1) throw new Error('injected era write failure');
            return real(ops);
        });
        assert.equal(await era.bumpEraContributionOnce('discoveries', 'discovery:kenji:road-9'), false);
        assert.equal((await era.readEraContributions()).discoveries, 0);
        assert.equal(await era.bumpEraContributionOnce('discoveries', 'discovery:kenji:road-9'), true);
        assert.equal(await era.bumpEraContributionOnce('discoveries', 'discovery:kenji:road-9'), true);
        assert.equal((await era.readEraContributions()).discoveries, 1);
        assert.equal(mock.mock.callCount(), 2, 'the third call found its receipt and wrote nothing');
    });

    it('report failure when the counter stays contended past every retry', async (t) => {
        aroundCompareSetMany(t, async () => false);
        assert.equal(await era.bumpEraContributionOnce('discoveries', 'discovery:busy:road-1'), false);
        assert.equal((await era.readEraContributions()).discoveries, 0);
    });

    it('never count again a receipt the retired one-row hash already holds', async (t) => {
        await kv.set('era:contrib-receipts:discoveries', { 'discovery:old:road-1': 1 });
        const mock = aroundCompareSetMany(t, (ops, real) => real(ops));
        assert.equal(await era.bumpEraContributionOnce('discoveries', 'discovery:old:road-1'), true);
        assert.equal(mock.mock.callCount(), 0);
        assert.equal((await era.readEraContributions()).discoveries, 1);
        assert.equal(await era.bumpEraContributionOnce('discoveries', 'discovery:new:road-2'), true);
        assert.equal((await era.readEraContributions()).discoveries, 2, 'the old hash and the new rows add up');
    });

    it('keep the retired hash on a store without multi-key transactions', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(kv, 'compareSetMany')!;
        Object.defineProperty(kv, 'compareSetMany', { value: undefined, configurable: true, writable: true });
        try {
            assert.equal(await era.bumpEraContributionOnce('warBattles', 'war:rest-1'), true);
            assert.equal(await era.bumpEraContributionOnce('warBattles', 'war:rest-1'), true);
            assert.deepEqual(await kv.get('era:contrib-receipts:warBattles'), { 'war:rest-1': 1 });
            assert.equal((await era.readEraContributions()).warBattles, 1);
        } finally {
            Object.defineProperty(kv, 'compareSetMany', descriptor);
        }
    });

    it('fail closed on a corrupt counter row', async () => {
        await kv.set('era:contrib-sum:discoveries:0', 'twelve');
        await assert.rejects(era.readEraContributions(), /era-receipt-sum-corrupt/);
        // Writes fail too, whichever shard they land on, once that shard is corrupt.
        for (let shard = 1; shard < era.ERA_RECEIPT_SHARDS; shard++) await kv.set(`era:contrib-sum:discoveries:${shard}`, -1);
        assert.equal(await era.bumpEraContributionOnce('discoveries', 'discovery:any:road-1'), false);
    });

    it('stay off while Legacy is disabled', async () => {
        delete process.env.ENABLE_LEGACY;
        try {
            assert.equal(await era.bumpEraContributionOnce('discoveries', 'discovery:off:road-1'), true);
            assert.deepEqual(await kv.keys('era:*'), []);
        } finally {
            process.env.ENABLE_LEGACY = '1';
        }
    });
});
