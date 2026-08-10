import test from 'node:test';
import assert from 'node:assert/strict';
import { _shouldCache } from './_storage.js';

type EconomySave = {
    character: {
        ryo: number;
        settlementReceipts: string[];
        villageStanding?: number;
    };
};

function clone<T>(value: T): T {
    return structuredClone(value);
}

/** Models the per-process L1 around one shared backing store. This intentionally
 * primes worker B before worker A commits: if save caching is re-enabled, B's
 * later lock callback will read its stale copy and erase A's receipt/field. */
function processView(backing: Map<string, EconomySave>) {
    const local = new Map<string, EconomySave>();
    return {
        async get(key: string): Promise<EconomySave | null> {
            if (_shouldCache(key) && local.has(key)) return clone(local.get(key)!);
            const current = backing.get(key);
            if (!current) return null;
            if (_shouldCache(key)) local.set(key, clone(current));
            return clone(current);
        },
        async set(key: string, value: EconomySave): Promise<void> {
            backing.set(key, clone(value));
            if (_shouldCache(key)) local.set(key, clone(value));
        },
    };
}

test('two worker-local caches cannot lose a sequential save settlement', async () => {
    const key = 'save:Kakashi';
    const backing = new Map<string, EconomySave>([[key, {
        character: { ryo: 100, settlementReceipts: [] },
    }]]);
    const workerA = processView(backing);
    const workerB = processView(backing);

    // B observes the original value before A obtains and releases the
    // distributed economy lock.
    await workerB.get(key);

    const afterA = await workerA.get(key);
    assert.ok(afterA);
    afterA.character.ryo += 25;
    afterA.character.villageStanding = 7;
    afterA.character.settlementReceipts.push('receipt-a');
    await workerA.set(key, afterA);

    // B is the next lock holder. Its read must come from shared backing state,
    // not the value it observed before A's settlement.
    const afterB = await workerB.get(key);
    assert.ok(afterB);
    afterB.character.ryo += 10;
    afterB.character.settlementReceipts.push('receipt-b');
    await workerB.set(key, afterB);

    assert.deepEqual(backing.get(key), {
        character: {
            ryo: 135,
            settlementReceipts: ['receipt-a', 'receipt-b'],
            villageStanding: 7,
        },
    });
    assert.equal(_shouldCache(key), false);
    assert.equal(_shouldCache('save-snapshot:Kakashi:1'), true,
        'immutable snapshot caching is unaffected by the exact save: prefix');
});
