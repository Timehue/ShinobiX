import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv, type KvCasOp } from '../_storage.js';
import * as credit from './_valid-fight.js';

const keys = { slotKey: 'pvp:pairslot:recover-fight', counterKey: 'pvp:pair:recover-a:recover-b:2026-10-21' };
const pending = /pvp-credit-slot-pending/;
function atomicMemoryKv() {
    const memory = _makeMemoryKv();
    assert.ok(memory.compareSetMany);
    return memory as typeof memory & { compareSetMany: NonNullable<typeof memory.compareSetMany> };
}

describe('PvP credit slot recovery', () => {
    it('does not grant first-fight eligibility when a slot read fails', async (t) => {
        const store = atomicMemoryKv();
        const get = store.get.bind(store);
        let unavailable = true;
        t.mock.method(store, 'get', async (key: string) => {
            if (unavailable && key === keys.slotKey) throw new Error('slot read unavailable');
            return get(key);
        });
        await assert.rejects(credit.assignPvpCreditSlot(store, keys), pending);
        unavailable = false;
        assert.equal(await get(keys.counterKey), null);
        assert.equal(await credit.assignPvpCreditSlot(store, keys), 1);
    });

    it('keeps an exhausted pair exhausted after a failed counter read and retry', async (t) => {
        const store = atomicMemoryKv();
        await store.set(keys.counterKey, 5);
        const get = store.get.bind(store);
        let unavailable = true;
        t.mock.method(store, 'get', async (key: string) => {
            if (unavailable && key === keys.counterKey) throw new Error('counter read unavailable');
            return get(key);
        });
        await assert.rejects(credit.assignPvpCreditSlot(store, keys), pending);
        unavailable = false;
        const ordinal = await credit.assignPvpCreditSlot(store, keys);
        assert.equal(ordinal, 6);
        assert.equal(credit.pvpPairWeight(ordinal), 0);
        assert.equal(await credit.assignPvpCreditSlot(store, keys), 6);
        assert.equal(await get(keys.counterKey), 6);
    });

    it('reserves neither row on transaction failure and retries the original first slot', async (t) => {
        const store = atomicMemoryKv();
        const commit = store.compareSetMany!.bind(store);
        let unavailable = true;
        t.mock.method(store, 'compareSetMany', async (ops: readonly KvCasOp[]) => {
            if (unavailable) throw new Error('transaction unavailable');
            return commit(ops);
        });
        await assert.rejects(credit.assignPvpCreditSlot(store, keys), pending);
        assert.equal(await store.get(keys.counterKey), null);
        assert.equal(await store.get(keys.slotKey), null);
        unavailable = false;
        assert.equal(await credit.assignPvpCreditSlot(store, keys), 1);
        assert.equal(await credit.assignPvpCreditSlot(store, keys), 1);
        assert.equal(await store.get(keys.counterKey), 1);
    });

    for (const previous of [0, 2, 4]) {
        it('recovers the same ordinal after a lost commit reply at counter ' + previous, async (t) => {
            const store = atomicMemoryKv();
            if (previous) await store.set(keys.counterKey, previous);
            const commit = store.compareSetMany!.bind(store);
            let loseReply = true;
            t.mock.method(store, 'compareSetMany', async (ops: readonly KvCasOp[]) => {
                const committed = await commit(ops);
                if (committed && loseReply) {
                    loseReply = false;
                    throw new Error('commit reply lost after both rows landed');
                }
                return committed;
            });
            await assert.rejects(credit.assignPvpCreditSlot(store, keys), pending);
            assert.equal(await store.get(keys.counterKey), previous + 1);
            assert.equal(await store.get(keys.slotKey), previous + 1);
            const retried = await credit.assignPvpCreditSlot(store, keys);
            assert.equal(retried, previous + 1, 'no increment on retry');
            assert.equal(credit.pvpPairWeight(retried), [1, 0.5, 0][previous / 2]);
            assert.equal(await store.get(keys.counterKey), previous + 1);
        });
    }

    it('retries refused comparisons without partially consuming the allowance', async (t) => {
        const store = atomicMemoryKv();
        const commit = store.compareSetMany!.bind(store);
        let refused = 0;
        t.mock.method(store, 'compareSetMany', async (ops: readonly KvCasOp[]) => ++refused <= 2 ? false : commit(ops));
        assert.equal(await credit.assignPvpCreditSlot(store, keys), 1);
        assert.equal(refused, 3);
        assert.equal(await store.get(keys.counterKey), 1);
    });

    it('leaves prolonged contention retryable instead of granting full credit', async (t) => {
        const store = atomicMemoryKv();
        const commit = store.compareSetMany!.bind(store);
        let contended = true;
        t.mock.method(store, 'compareSetMany', async (ops: readonly KvCasOp[]) => contended ? false : commit(ops));
        await assert.rejects(credit.assignPvpCreditSlot(store, keys), pending);
        assert.equal(await store.get(keys.counterKey), null);
        contended = false;
        assert.equal(await credit.assignPvpCreditSlot(store, keys), 1);
    });

    it('shares one ordinal between racing helpers and advances once for the next fight', async () => {
        const store = atomicMemoryKv();
        assert.deepEqual(await Promise.all([credit.assignPvpCreditSlot(store, keys), credit.assignPvpCreditSlot(store, keys)]), [1, 1]);
        assert.equal(await store.get(keys.counterKey), 1);
        const next = { ...keys, slotKey: 'pvp:pairslot:another-fight' };
        assert.equal(await credit.assignPvpCreditSlot(store, next), 2);
        assert.equal(await credit.assignPvpCreditSlot(store, keys), 1);
        assert.equal(await store.get(keys.counterKey), 2);
    });

    it('preserves pre-existing numeric slots and refuses unsupported atomic storage', async () => {
        const store = atomicMemoryKv();
        await store.set(keys.slotKey, 3);
        const unsupported = { ...store, compareSetMany: undefined };
        assert.equal(await credit.assignPvpCreditSlot(unsupported, keys), 3);
        await assert.rejects(credit.assignPvpCreditSlot(unsupported, { ...keys, slotKey: 'pvp:pairslot:new' }), pending);
    });

    it('never prices a corrupt ordinal as a fresh pair', async () => {
        const store = atomicMemoryKv();
        await store.set(keys.counterKey, 'unreadable');
        await assert.rejects(credit.assignPvpCreditSlot(store, keys), pending);
        await assert.rejects(credit.peekPvpCreditSlot(store, keys), pending);
        await store.set(keys.slotKey, 0);
        await assert.rejects(credit.assignPvpCreditSlot(store, keys), pending);
    });

    it('read-only credit and sleeper previews also keep storage errors pending', async () => {
        const store = { get: async () => { throw new Error('read unavailable'); } };
        await assert.rejects(credit.peekPvpCreditSlot(store, keys), pending);
        await assert.rejects(credit.previewSleeperKoCredit(store, {
            attackerSlug: 'a', targetSlug: 'b', attackerLevel: 90, targetLevel: 90,
            targetCreatedAt: undefined, rewardEligible: true, now: Date.UTC(2026, 9, 21),
        }), pending);
    });

    it('reserves a sleeper camp once before a save retry instead of counting after payment', async () => {
        const store = atomicMemoryKv();
        const input = { attackerSlug: 'a', targetSlug: 'b', attackerLevel: 90, targetLevel: 90,
            targetCreatedAt: undefined, rewardEligible: true, now: Date.UTC(2026, 9, 21), receiptId: 'same-camp' };
        const first = await credit.reserveSleeperKoCredit(store, input);
        const retried = await credit.reserveSleeperKoCredit(store, input);
        assert.equal(first.pairOrdinal, 1);
        assert.deepEqual(retried, first);
        assert.equal(await store.get(credit.pvpPairCounterKey('a', 'b', '2026-10-21')), 1);
        await store.set(credit.pvpPairCounterKey('a', 'b', '2026-10-21'), 5);
        const exhausted = await credit.reserveSleeperKoCredit(store, { ...input, receiptId: 'another-camp' });
        assert.equal(exhausted.factor, 0);
        assert.equal(exhausted.ryo, 0);
        assert.deepEqual(await credit.reserveSleeperKoCredit(store, input), first, 'a previously reserved legitimate reward keeps its slot');
    });
});
