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

test('distributed-lock and settlement authority always bypass worker-local caches', async () => {
    const authorityKeys = [
        'tower:run-1',
        'tower-party:party-1',
        'tower-party-code:ABCDEFGH',
        'tower-party-player:kakashi',
        'tower-party-invites:kakashi',
        'tower-invite:invite-1',
        'battle-lock:kakashi',
        'tower-engine-clan-boss:clan-1',
        'missions:progress:kakashi',
        'mission-combat-active:kakashi',
        'clan-boss:party:party-1',
        'game:weekly-boss-state',
        'solo-pve:session-1',
        'ai-fight-token-1',
        'pet:battle-active:kakashi',
        'pet:ranked-token:match-1',
        'hg-run:kakashi',
        'endless-wave-active:kakashi',
        'story:run-1',
        'story-combat-binding:kakashi',
        'legacy:progress:kakashi',
        'era:contribution:run-1',
        'game:era-state',
        'world:territory:sector-1',
        'world:war:war-1',
        'shared:sector-war:sector-1',
        'shared:sector-war-token:battle-1',
        'shared:village-war:leaf',
        'game:village-state:leaf',
        'village:kage:leaf',
        'village:war-standing:leaf',
        'clan-war:war-1',
        'clan-war-pet:match-1',
        'cw-tilecards:war-1',
        'clan-seal-pool:clan-1',
        'clan-mentor:kakashi',
        'clan-mentor-of:naruto',
        'pet-sanctuary:kakashi:meta',
        'training-start-count:kakashi:2026-08-11',
        'card-clash:match-1',
        'cc-session-1',
        'petladder:season-1',
        'petgauntlet:lb:2026-08-11',
        'sector-card:match-1',
        'sector-pet:match-1',
        'infil:run-1',
        'infil-active:kakashi',
    ];

    for (const key of authorityKeys) {
        const backing = new Map<string, EconomySave>([[key, {
            character: { ryo: 100, settlementReceipts: [] },
        }]]);
        const workerA = processView(backing);
        const workerB = processView(backing);

        await workerB.get(key);
        const afterA = await workerA.get(key);
        assert.ok(afterA);
        afterA.character.villageStanding = 7;
        afterA.character.settlementReceipts.push('worker-a');
        await workerA.set(key, afterA);

        const afterB = await workerB.get(key);
        assert.ok(afterB);
        afterB.character.settlementReceipts.push('worker-b');
        await workerB.set(key, afterB);

        assert.deepEqual(backing.get(key)?.character.settlementReceipts, ['worker-a', 'worker-b'], key);
        assert.equal(backing.get(key)?.character.villageStanding, 7, key);
        assert.equal(_shouldCache(key), false, key);
    }
});
