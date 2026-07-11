import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { petRankedChallengeEnabled, setPetRankedChallengeEnabled } from './pet-coliseum-flag';

describe('direct ranked-pet challenge release lock', () => {
    it('cannot be enabled by client state', () => {
        const original = globalThis.localStorage;
        let removed = '';
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: () => '1',
                removeItem: (key: string) => { removed = key; },
            },
        });
        try {
            assert.equal(petRankedChallengeEnabled(), false);
            setPetRankedChallengeEnabled(true);
            assert.equal(removed, 'petRankedChallenge.v1');
            assert.equal(petRankedChallengeEnabled(), false);
        } finally {
            if (original === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
            else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
        }
    });
});
