import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _makeMemoryKv } from './_storage.js';
import {
    isPlayerRankedMatchToken,
    mintPlayerRankedMatchTokenWithStore,
    playerRankedMatchTokenKey,
    provePlayerRankedMatchTokenWithStore,
    rankedMatchTokenKey,
} from './_ranked-match-token.js';
import {
    cancelNonterminalPlayerRankedAdmissions,
    closePetRankedSeasonGate,
    completePlayerRankedAdmission,
    ensurePetRankedSeasonGate,
    PLAYER_RANKED_ADMISSION_TTL_MS,
    readPetRankedSeasonGateFresh,
    releaseExpiredQueuedPlayerRankedAdmissions,
    releaseQueuedPlayerRankedAdmission,
    reopenPetRankedSeasonGate,
} from './pet/_ranked-preparation.js';

// The token's security rests on the KEY: it must identify the unordered pair of
// fighters on a specific ladder, so a token minted for (A,B) on the player
// ladder is found regardless of which fighter creates the session, and can NOT
// be confused with a different pair or the pet ladder. mint/consume are thin
// kv.set/kv.del wrappers (kv.del's row count gives the atomic single-use check),
// so the key derivation is the load-bearing logic to pin down here.

test('rankedMatchTokenKey is independent of fighter order', () => {
    assert.equal(
        rankedMatchTokenKey('Alice', 'Bob', 'player'),
        rankedMatchTokenKey('Bob', 'Alice', 'player'),
    );
});

test('rankedMatchTokenKey separates the player and pet ladders', () => {
    assert.notEqual(
        rankedMatchTokenKey('Alice', 'Bob', 'player'),
        rankedMatchTokenKey('Alice', 'Bob', 'pet'),
    );
});

test('rankedMatchTokenKey canonicalizes names via safeName', () => {
    // safeName lowercases and strips non [a-z0-9-_]; display casing / spaces /
    // punctuation must resolve to the same key as the stored slug.
    assert.equal(
        rankedMatchTokenKey('Alice', 'Bob', 'player'),
        rankedMatchTokenKey('  ALICE ', 'B!o!b', 'player'),
    );
});

test('rankedMatchTokenKey distinguishes different pairs', () => {
    assert.notEqual(
        rankedMatchTokenKey('alice', 'bob', 'player'),
        rankedMatchTokenKey('alice', 'carol', 'player'),
    );
});

test('rankedMatchTokenKey has the expected shape', () => {
    // Sorted slugs, ladder in the middle segment.
    assert.equal(
        rankedMatchTokenKey('Bob', 'Alice', 'player'),
        'pvp:ranked-match-token:player:alice:bob',
    );
});

const NOW = 1_800_000_000_000;
const MATCH = 'player-ranked-12345678-1234-4123-8123-1234567890ab';

async function openStore() {
    const store = _makeMemoryKv();
    await store.set('ranked:season:current', { id: 1, startedAt: NOW, endsAt: NOW + 10_000 });
    await ensurePetRankedSeasonGate(store, 1, NOW);
    return store;
}

test('player token is an exact matchId/pair/season/epoch capability admitted by the shared CAS gate', async () => {
    const store = await openStore();
    const token = await mintPlayerRankedMatchTokenWithStore(store, {
        a: 'Alice', b: 'Bob', aLevel: 20, bLevel: 22, aRating: 1100, bRating: 1080,
        now: NOW + 1, matchId: MATCH,
    });
    assert.equal(isPlayerRankedMatchToken(token), true);
    assert.deepEqual(token, {
        version: 'player-ranked-match-token-v2',
        matchId: MATCH,
        a: 'alice',
        b: 'bob',
        seasonId: 1,
        seasonEpoch: 1,
        createdAt: NOW + 1,
    });
    const proof = await provePlayerRankedMatchTokenWithStore(store, { a: 'bob', b: 'alice', matchId: MATCH });
    assert.equal(proof?.admission.phase, 'queued');
    assert.equal(proof?.admission.aRating, 1100);
    assert.equal(await provePlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'charlie', matchId: MATCH,
    }), null);
    assert.equal(await provePlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', matchId: 'player-ranked-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }), null);
});

test('gate close winning before mint creates no player token or admission', async () => {
    const store = await openStore();
    await closePetRankedSeasonGate(store, 1, NOW + 1);
    await assert.rejects(() => mintPlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
        now: NOW + 2, matchId: MATCH,
    }), /admission-closed/);
    assert.equal(await store.get(rankedMatchTokenKey('alice', 'bob', 'player')), null);
    assert.equal(await store.get(playerRankedMatchTokenKey(MATCH)), null);
    assert.deepEqual((await readPetRankedSeasonGateFresh(store))?.playerAdmissions, []);
});

test('mint winning before close remains discoverable and stale epoch proof is rejected after reopen', async () => {
    const store = await openStore();
    await mintPlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
        now: NOW + 1, matchId: MATCH,
    });
    const closing = await closePetRankedSeasonGate(store, 1, NOW + 2);
    const cancelled = await cancelNonterminalPlayerRankedAdmissions(store, closing, NOW + 3);
    assert.equal(cancelled.length, 1);
    await completePlayerRankedAdmission(store, cancelled[0]);
    await store.set('ranked:season:current', { id: 2, startedAt: NOW + 10_000, endsAt: NOW + 20_000 });
    await reopenPetRankedSeasonGate(store, 1, 2, NOW + 4);
    assert.equal(await provePlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', matchId: MATCH,
    }), null);
});

test('token materialization recognizes a committed write whose acknowledgement was lost', async () => {
    const base = await openStore();
    let lost = false;
    const store = {
        ...base,
        async compareSet(key: string, expected: unknown | null, value: unknown, options?: { ex?: number }) {
            const committed = await base.compareSet(key, expected, value, options);
            if (committed && key === playerRankedMatchTokenKey(MATCH) && !lost) {
                lost = true;
                throw new Error('lost-token-ack');
            }
            return committed;
        },
    };
    const token = await mintPlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
        now: NOW + 1, matchId: MATCH,
    });
    assert.equal(lost, true);
    assert.equal(token.matchId, MATCH);
    assert.equal((await provePlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', matchId: MATCH,
    }))?.token.matchId, MATCH);
});

test('a d76a pair-key consumer cannot observe or delete a v2 player admission', async () => {
    const store = await openStore();
    await mintPlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
        now: NOW + 1, matchId: MATCH,
    });
    const legacyKey = rankedMatchTokenKey('alice', 'bob', 'player');
    assert.equal(await store.get(legacyKey), null, 'new workers must not dual-publish into the old namespace');

    // Exact d76a behavior: blindly delete its pair-key capability, then treat a
    // missing row as casual. That deletion has no addressability into v2.
    assert.equal(await store.del(legacyKey), 0);
    assert.ok(await store.get(playerRankedMatchTokenKey(MATCH)));
    assert.equal((await provePlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', matchId: MATCH,
    }))?.admission.phase, 'queued');
});

test('expired queue authority is unusable and an exact participant release frees the gate', async () => {
    const expiredStore = await openStore();
    await mintPlayerRankedMatchTokenWithStore(expiredStore, {
        a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
        now: Date.now() - PLAYER_RANKED_ADMISSION_TTL_MS - 1,
        matchId: MATCH,
    });
    assert.equal(await provePlayerRankedMatchTokenWithStore(expiredStore, {
        a: 'alice', b: 'bob', matchId: MATCH,
    }), null);

    assert.equal(await releaseQueuedPlayerRankedAdmission(expiredStore, MATCH, 'alice'), true);
    assert.deepEqual((await readPetRankedSeasonGateFresh(expiredStore))?.playerAdmissions, []);
    assert.equal(await releaseQueuedPlayerRankedAdmission(expiredStore, MATCH, 'alice'), true, 'release replay is idempotent');
});

test('traffic cleanup prunes every expired queued capability in one gate CAS', async () => {
    const store = await openStore();
    const old = Date.now() - PLAYER_RANKED_ADMISSION_TTL_MS - 1;
    const secondMatch = 'player-ranked-22345678-1234-4123-8123-1234567890ab';
    await mintPlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
        now: old, matchId: MATCH,
    });
    await mintPlayerRankedMatchTokenWithStore(store, {
        a: 'cara', b: 'dan', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
        now: old, matchId: secondMatch,
    });
    const expired = await releaseExpiredQueuedPlayerRankedAdmissions(store, Date.now());
    assert.deepEqual(expired.map((entry) => entry.matchId).sort(), [MATCH, secondMatch].sort());
    assert.deepEqual((await readPetRankedSeasonGateFresh(store))?.playerAdmissions, []);
});
