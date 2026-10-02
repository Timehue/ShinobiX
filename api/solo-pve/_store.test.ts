import assert from 'node:assert/strict';
import { test } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import type { PvpFighter } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from './_session.js';
import { compareWriteSoloPveSession, soloPveSessionKey, type SoloPveKv } from './_store.js';

const NOW = 1_800_000_000_000;

function fighter(name: string, hp: number): PvpFighter {
    return {
        name, hp, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], pos: name === 'Rill' ? 62 : 63,
        character: { name, level: 10, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    };
}

/**
 * Reads come back as Postgres returns them (the JSON form), and every
 * compareSet loses its reply. `land` says whether the write commits first.
 */
function lostReplyStore(land: boolean): SoloPveKv {
    const base = _makeMemoryKv();
    return {
        get: async <T>(key: string) => {
            const stored = await base.get<T>(key);
            return stored === null ? null : JSON.parse(JSON.stringify(stored)) as T;
        },
        set: (key, value, opts) => base.set(key, value, opts),
        compareSet: async (key, expected, value, opts) => {
            if (land) await base.compareSet(key, expected, value, opts);
            throw new Error('Connection terminated unexpectedly');
        },
    };
}

async function seededSession(store: SoloPveKv): Promise<{ expected: SoloPveSession; next: SoloPveSession }> {
    const expected = createSoloPveSession({
        sessionId: 'store-lost-reply',
        ownerSlug: 'rill',
        encounter: { kind: 'mission', id: 'combat-e-drill', bindingId: 'store-lost-reply' },
        player: fighter('Rill', 80),
        enemy: fighter('Enemy', 50),
        now: NOW,
    });
    // A fight with no weather keeps both weather keys, set to undefined.
    // Postgres drops them, so the read-back never carries them.
    assert.equal(Object.hasOwn(expected.environment, 'weatherPositiveElement'), true);
    assert.equal(expected.environment.weatherPositiveElement, undefined);
    await store.set(soloPveSessionKey(expected.sessionId), expected);
    return { expected, next: { ...expected, version: expected.version + 1, lastActionAt: NOW + 1_000 } };
}

test('a compare-write that landed but lost its reply is recognised from the JSON Postgres hands back', async () => {
    const store = lostReplyStore(true);
    const { expected, next } = await seededSession(store);
    assert.equal(await compareWriteSoloPveSession(expected, next, { kv: store }), true);
});

test('a compare-write that never landed still rethrows the transport error', async () => {
    const store = lostReplyStore(false);
    const { expected, next } = await seededSession(store);
    await assert.rejects(compareWriteSoloPveSession(expected, next, { kv: store }), /Connection terminated/);
});
