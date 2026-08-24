import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('direct ranked-pet challenge release lock', () => {
    it('cannot be enabled by client state, and the retired key is scrubbed at load', async () => {
        const original = globalThis.localStorage;
        const removed: string[] = [];
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: () => '1',
                removeItem: (key: string) => { removed.push(key); },
            },
        });
        try {
            // Imported INSIDE the stub so the module-load scrub is observed —
            // that scrub replaced five no-op `set…Enabled(_on)` setters which no
            // production code ever called.
            const flags = await import('./pet-coliseum-flag');
            assert.equal(flags.petRankedChallengeEnabled(), false);
            assert.ok(removed.includes('petRankedChallenge.v1'), `scrubbed: ${removed.join(', ')}`);

            // A leftover "1" in every retired key still cannot turn a combat
            // rule into a per-device switch.
            removed.length = 0;
            flags.scrubRetiredPetFlagKeys();
            assert.deepEqual(removed.sort(), [
                'petAccuracy.v1',
                'petArenaV2.v1',
                'petDuelEngine.v1',
                'petPlayerControl.v1',
                'petRankedChallenge.v1',
            ]);
            assert.equal(flags.petRankedChallengeEnabled(), false);
            assert.equal(flags.petAccuracyEnabled(), true);
            assert.equal(flags.petDuelEngineEnabled(), true);
            assert.equal(flags.petPlayerControlEnabled(), true);
            assert.equal(flags.petArenaV2Enabled(), true);
        } finally {
            if (original === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
            else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
        }
    });
});
