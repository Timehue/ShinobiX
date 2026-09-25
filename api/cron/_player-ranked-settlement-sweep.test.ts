import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import { SESSION_TTL } from '../combat-core/constants.js';
import { mintPlayerRankedMatchTokenWithStore } from '../_ranked-match-token.js';
import { activatePlayerRankedAdmission, getPlayerRankedAdmission } from '../pet/_ranked-preparation.js';
import type { PvpSession } from '../pvp/session.js';
import { commitPvpSessionMutation } from '../pvp/_session-mutation.js';
import {
    getPlayerRankedJournal,
    playerRankedJournalKey,
    playerRankedSettlingKey,
    publishPlayerRankedTerminal,
    settlePlayerRankedJournal,
} from '../pvp/_player-ranked-journal.js';
import { startRankedSeasonWithStore } from './_ranked-season.js';
import {
    PLAYER_RANKED_SETTLEMENT_DISCOVERY_KEY,
    runPlayerRankedSettlementSweep,
} from './_player-ranked-settlement-sweep.js';

const lock = async <T>(_key: string, action: () => Promise<T>): Promise<T> => action();

function save(name: string, extra: Record<string, unknown> = {}) {
    return {
        _saveVersion: 1,
        character: {
            name, level: 25, rankedRating: 1000, rankedWins: 0, rankedLosses: 0,
            profession: 'ninja', serverSettlementReceipts: [], ...extra,
        },
    };
}

async function seasonStore(): Promise<KvLike> {
    const store = _makeMemoryKv();
    await startRankedSeasonWithStore(store, Date.now());
    return store;
}

let counter = 0;

/** A match between `winner` (side a) and `loser` whose terminal session CAS committed. */
async function ended(store: KvLike, winner: string, loser: string) {
    counter += 1;
    const hex = counter.toString(16).padStart(8, '0');
    const matchId = `player-ranked-${hex}-2234-4123-8123-1234567890ab`;
    const battleId = `pvp-${hex}-2234-4123-8123-1234567890ab`;
    const endedAt = Date.now() - 10 * 60_000;
    const createdAt = endedAt - 5 * 60_000;
    await mintPlayerRankedMatchTokenWithStore(store, {
        a: winner, b: loser, aLevel: 25, bLevel: 25, aRating: 1000, bRating: 1000,
        now: createdAt - 1_000, matchId,
    });
    await activatePlayerRankedAdmission(store, matchId, battleId, createdAt);
    const active = {
        battleId, p1: { name: winner }, p2: { name: loser }, status: 'active', winner: null,
        ranked: false, rankedKind: 'player', playerRankedAuthorityVersion: 2, rankedMatchId: matchId,
        rankedSeasonId: 1, rankedSeasonEpoch: 1, p1Rating: 1000, p2Rating: 1000,
        joined: { p1: true, p2: true }, rewardAuthority: 'ranked', baseRewards: false,
        realFighters: { p1: true, p2: true }, itemCharges: { p1: {}, p2: {} }, itemsUsed: { p1: {}, p2: {} },
        log: [], createdAt, lastMoveAt: endedAt,
    } as unknown as PvpSession;
    await store.set(`pvp:${battleId}`, active, { ex: 900 });
    const committed = await commitPvpSessionMutation(store, `pvp:${battleId}`, active, {
        ...active, status: 'done', winner: 'p1', endedAt,
    });
    assert.equal(committed.status, 'committed');
    return { matchId, battleId, endedAt, session: committed.session };
}

async function character(store: KvLike, slug: string): Promise<Record<string, any>> {
    return ((await store.get<Record<string, any>>(`save:${slug}`))?.character ?? {}) as Record<string, any>;
}

async function readAt<T>(store: KvLike, key: string, at: number): Promise<T | null> {
    const realNow = Date.now;
    Date.now = () => at;
    try {
        return await store.get<T>(key);
    } finally {
        Date.now = realNow;
    }
}

describe('player-ranked settlement sweep', () => {
    it('is one index probe and one gate read when nothing is owed', async () => {
        const store = await seasonStore();
        const listed: string[] = [];
        const read: string[] = [];
        const counting: KvLike = {
            ...store,
            async keys(pattern) { listed.push(pattern); return store.keys(pattern); },
            async get<T>(key: string) { read.push(key); return store.get<T>(key); },
            async mget<T extends unknown[]>(...keys: string[]) { read.push(...keys); return store.mget<T>(...keys); },
        };
        const result = await runPlayerRankedSettlementSweep({ store: counting, lock });
        assert.deepEqual(listed, ['player:ranked-settling:*']);
        assert.deepEqual(read, ['ranked:season:authority']);
        assert.equal(result.pointers, 0);
        assert.equal(result.attempted, 0);
    });

    it('finishes a journal season close completed without its session saga, once, and compacts the row', async () => {
        // drainRankedWork settles every still-pending journal with Elo alone
        // (settlePlayerRankedJournal) and removes its admission. That never
        // granted Vanguard or bounded the terminal row, which then lived forever.
        const store = await seasonStore();
        await store.set('save:alphasweep', save('alphasweep', {
            profession: 'vanguard', professionRank: 1, professionXp: 0, honorSeals: 0,
        }));
        await store.set('save:bravosweep', save('bravosweep'));
        const { matchId, battleId, endedAt, session } = await ended(store, 'alphasweep', 'bravosweep');
        const journal = await publishPlayerRankedTerminal(store, session, {
            eligible: async () => true, now: endedAt + 1_000,
        });
        await settlePlayerRankedJournal(store, journal, endedAt + 2_000);
        await store.del(playerRankedSettlingKey(matchId)); // the drain predates pointers
        assert.equal(await getPlayerRankedAdmission(store, matchId), null);
        assert.equal((await character(store, 'alphasweep')).honorSeals, 0);

        const first = await runPlayerRankedSettlementSweep({ store, lock, discover: true });

        assert.equal(first.discovery?.published, 1, 'its live terminal row betrays the owed work');
        assert.deepEqual(first.settled, [matchId]);
        assert.equal((await character(store, 'alphasweep')).honorSeals, 1);
        assert.equal((await character(store, 'alphasweep')).rankedRating, 1012, 'Elo was not applied again');
        assert.equal((await character(store, 'bravosweep')).rankedRating, 988);
        assert.equal(await readAt(store, `pvp:${battleId}`, Date.now() + (SESSION_TTL + 1) * 1_000), null);

        const second = await runPlayerRankedSettlementSweep({ store, lock, discover: true });
        assert.deepEqual(second.discovery, { journals: 0, published: 0, failures: 0, complete: true },
            'discovery reads every journal only once');
        assert.deepEqual(second.settled, []);
        assert.equal((await character(store, 'alphasweep')).honorSeals, 1);
    });

    it('keeps discovering while a journal is unreadable, but still points at the readable ones', async () => {
        const store = await seasonStore();
        await store.set('save:alphasweep', save('alphasweep'));
        await store.set('save:bravosweep', save('bravosweep'));
        const { matchId, endedAt, session } = await ended(store, 'alphasweep', 'bravosweep');
        await publishPlayerRankedTerminal(store, session, { eligible: async () => true, now: endedAt + 1_000 });
        await store.del(playerRankedSettlingKey(matchId));
        const corrupt = 'player-ranked-ffffffff-2234-4123-8123-1234567890ab';
        await store.set(playerRankedJournalKey(corrupt), { version: 'player-ranked-journal-v1', garbage: true });

        const result = await runPlayerRankedSettlementSweep({ store, lock, discover: true });

        assert.equal(result.discovery?.complete, false);
        assert.equal(result.discovery?.failures, 1);
        assert.equal(await store.get(PLAYER_RANKED_SETTLEMENT_DISCOVERY_KEY), null, 'retried on a later boot');
        assert.deepEqual(result.settled, [matchId]);
        assert.equal((await getPlayerRankedJournal(store, matchId))?.state, 'completed');
    });

    it('discards unreadable pointers and stops at its per-pass budget', async () => {
        const store = await seasonStore();
        for (const name of ['alphasweep', 'bravosweep', 'charliesweep', 'deltasweep']) {
            await store.set(`save:${name}`, save(name));
        }
        const first = await ended(store, 'alphasweep', 'bravosweep');
        const second = await ended(store, 'charliesweep', 'deltasweep');
        await store.set('player:ranked-settling:player-ranked-not-a-pointer', { version: 'nope' });

        const result = await runPlayerRankedSettlementSweep({ store, lock, budget: 1 });

        assert.equal(result.discarded, 1);
        assert.equal(await store.get('player:ranked-settling:player-ranked-not-a-pointer'), null);
        assert.equal(result.gatePublished, 2);
        assert.equal(result.attempted, 1);
        assert.equal(result.truncated, true);
        const next = await runPlayerRankedSettlementSweep({ store, lock, budget: 1 });
        assert.deepEqual([...result.settled, ...next.settled].sort(), [first.matchId, second.matchId].sort());
    });
});
