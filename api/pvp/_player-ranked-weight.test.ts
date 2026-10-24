import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { mintPlayerRankedMatchTokenWithStore } from '../_ranked-match-token.js';
import { buildPublicPlayerIndexEntry, REGISTRY_KEY } from '../player/_public-index.js';
import { activatePlayerRankedAdmission, ensurePetRankedSeasonGate } from '../pet/_ranked-preparation.js';
import { weightedRankedDelta } from '../_ranked-rating.js';
import type { PvpSession } from './session.js';
import {
    PLAYER_RANKED_SETTLEMENT_STAMP_FIELD,
    publishPlayerRankedTerminal,
    settlePlayerRankedJournal,
} from './_player-ranked-journal.js';
import { readRankedWeightRow } from './_valid-fight.js';

// I-3 through the real ranked V2 journal: a fed flee moves nothing, a short KO
// counts half, and one pair's results in a UTC day are weighted 1/1/0.5/0.25/0.

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const id = (n: number) => `12345678-1234-4123-8123-${String(n).padStart(12, '0')}`;

async function setup() {
    const store = _makeMemoryKv();
    await store.set('ranked:season:current', { id: 1, startedAt: NOW - 1_000, endsAt: NOW + 86_400_000 });
    await ensurePetRankedSeasonGate(store, 1, NOW - 1_000);
    await Promise.all([
        store.set('save:alice', { _saveVersion: 1, character: { name: 'Alice', level: 25, rankedRating: 1000, rankedWins: 0, serverSettlementReceipts: [] } }),
        store.set('save:bob', { _saveVersion: 1, character: { name: 'Bob', level: 25, rankedRating: 1000, rankedLosses: 0, serverSettlementReceipts: [] } }),
    ]);
    await store.hset(REGISTRY_KEY, {
        alice: buildPublicPlayerIndexEntry({ name: 'Alice', rankedRating: 1000 }, 'alice'),
        bob: buildPublicPlayerIndexEntry({ name: 'Bob', rankedRating: 1000 }, 'bob'),
    });
    return store;
}

async function playMatch(store: ReturnType<typeof _makeMemoryKv>, n: number, o: { round: number; fled?: boolean; durationMs: number }) {
    const alice = (await store.get<Record<string, any>>('save:alice'))!.character;
    const bob = (await store.get<Record<string, any>>('save:bob'))!.character;
    const matchId = `player-ranked-${id(n)}`;
    const battleId = `pvp-${id(n)}`;
    const token = await mintPlayerRankedMatchTokenWithStore(store, {
        a: 'alice', b: 'bob', aLevel: 25, bLevel: 25, aRating: alice.rankedRating, bRating: bob.rankedRating,
        now: NOW + n * 10, matchId,
    });
    await activatePlayerRankedAdmission(store, token.matchId, battleId, NOW + n * 10 + 1);
    const session = {
        battleId,
        p1: { name: 'Alice', hp: 700, maxHp: 1000, character: { level: 25 } },
        p2: { name: 'Bob', hp: o.fled ? 900 : 0, maxHp: 1000, character: { level: 25 } },
        status: 'done', winner: 'p1', round: o.round, ...(o.fled ? { fleedBy: 'p2' } : {}),
        ranked: false, rankedKind: 'player', playerRankedAuthorityVersion: 2,
        rankedMatchId: matchId, rankedSeasonId: 1, rankedSeasonEpoch: 1,
        p1Rating: alice.rankedRating, p2Rating: bob.rankedRating,
        joined: { p1: true, p2: true }, rewardAuthority: 'ranked', baseRewards: false,
        realFighters: { p1: true, p2: true }, itemCharges: { p1: {}, p2: {} }, itemsUsed: { p1: {}, p2: {} },
        log: [], createdAt: NOW, endedAt: NOW + o.durationMs,
    } as unknown as PvpSession;
    await store.set(`pvp:${battleId}`, session, { ex: 900 });
    // Published ten minutes late: the weight still comes from endedAt.
    const journal = await publishPlayerRankedTerminal(store, session, { now: NOW + o.durationMs + 600_000, eligible: async () => true });
    await settlePlayerRankedJournal(store, matchId, NOW + o.durationMs + 600_001);
    return { matchId, journal, before: { a: alice.rankedRating as number, b: bob.rankedRating as number } };
}

const ratings = async (store: ReturnType<typeof _makeMemoryKv>) => ({
    a: (await store.get<Record<string, any>>('save:alice'))!.character.rankedRating as number,
    b: (await store.get<Record<string, any>>('save:bob'))!.character.rankedRating as number,
});

describe('ranked V2 credit weight', () => {
    it('a flee, a short KO and a repeat result each move the Elo they should', async () => {
        const store = await setup();

        const flee = await playMatch(store, 1, { round: 1, fled: true, durationMs: 20_000 });
        assert.equal(flee.journal.terminal.rankedEligible, false, 'a turn-1 flee is a no-contest');
        assert.deepEqual(await ratings(store), { a: 1000, b: 1000 });
        const alice = (await store.get<Record<string, any>>('save:alice'))!.character;
        assert.equal(alice.rankedWins, 0, 'no rankedWins');
        assert.equal(alice[PLAYER_RANKED_SETTLEMENT_STAMP_FIELD][flee.matchId].combatStatPoints, undefined, 'no stat points');

        const shortKo = await playMatch(store, 2, { round: 2, durationMs: 40_000 });
        assert.equal(shortKo.journal.terminal.rankedEligible, true);
        assert.equal((await readRankedWeightRow(store, shortKo.matchId))?.weight, 0.5);
        assert.deepEqual(await ratings(store), { a: 1006, b: 994 });

        const third = await playMatch(store, 3, { round: 6, durationMs: 300_000 });
        const step = weightedRankedDelta(third.before.a, third.before.b, 0.5);
        assert.equal((await readRankedWeightRow(store, third.matchId))?.weight, 0.5, 'the pair’s third result today');
        assert.deepEqual(await ratings(store), { a: 1006 + step, b: 994 - step });

        await playMatch(store, 4, { round: 6, durationMs: 300_000 });
        assert.equal((await readRankedWeightRow(store, `player-ranked-${id(4)}`))?.weight, 0.25);
        const fifth = await playMatch(store, 5, { round: 6, durationMs: 300_000 });
        assert.equal(fifth.journal.terminal.rankedEligible, false, 'the pair’s fifth result today counts for nothing');
    });
});
