import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import { mintPlayerRankedMatchTokenWithStore } from '../_ranked-match-token.js';
import {
    claimPetRankedActivePair,
    type ServerResolvedPetRankedToken,
} from '../pet/_ranked-engine.js';
import { getPetRankedJournal } from '../pet/_ranked-journal.js';
import {
    makePetRankedPreparation,
    activatePlayerRankedAdmission,
    getPlayerRankedAdmission,
    readPetRankedSeasonGateFresh,
    reservePetRankedPreparation,
} from '../pet/_ranked-preparation.js';
import type { PvpSession } from '../pvp/session.js';
import { getPlayerRankedJournal } from '../pvp/_player-ranked-journal.js';
import { commitPvpSessionMutation } from '../pvp/_session-mutation.js';
import { confirmPlayerRankedTerminalEffects } from '../pvp/_ranked-terminal-effects.js';
import {
    runRankedSeasonRolloverWithStore,
    SEASON_CURRENT_KEY,
    SEASON_ARCHIVE_PREFIX,
    SEASON_PLAN_PREFIX,
    startRankedSeasonWithStore,
} from './_ranked-season.js';

const NOW = 1_750_000_000_000;
const MATCH = 'aa726354abcdef00aa726354abcdef00';

const token: ServerResolvedPetRankedToken = {
    version: 'pet-ranked-token-v1',
    matchId: MATCH,
    a: 'alpha',
    b: 'bravo',
    aRating: 1000,
    bRating: 1000,
    createdAt: NOW + 1,
    seed: 815162,
    aPetId: 'alpha-pet',
    bPetId: 'bravo-pet',
    resolution: {
        authority: 'server-engine-v1',
        engineVersion: 'pet-duel-sim-ranked-v1',
        winner: 'a',
        resolvedAt: NOW + 1,
        engineDigest: 'abcdef0123456789'.repeat(4),
        reward: { kind: 'pet-rating-v1', ryo: 0, aDelta: 12, bDelta: -12 },
    },
};

const save = (name: string) => ({
    _saveVersion: 1,
    character: {
        name,
        rankedRating: 1000,
        petRankedRating: 1000,
        petRankedWins: 0,
        petRankedLosses: 0,
        auraStones: 0,
        inventory: [],
        itemStacks: [{ itemId: 'potion', count: 2 }],
        serverSettlementReceipts: [],
        rankedSeasonsWon: 0,
        pets: [{ id: `${name}-pet`, loadout: { consumable: 'pet-tonic' } }],
    },
});

const lock = async <T>(_key: string, action: () => Promise<T>): Promise<T> => action();

async function seededStore() {
    const store = _makeMemoryKv();
    await startRankedSeasonWithStore(store, NOW);
    await Promise.all([
        store.set('save:alpha', save('alpha')),
        store.set('save:bravo', save('bravo')),
    ]);
    return store;
}

describe('ranked season transition durability', () => {
    it('recovers a committed terminal past 15m with no client retry, settles effects, then compacts it', async () => {
        const realDateNow = Date.now;
        let clock = NOW;
        Date.now = () => clock;
        try {
            const store = await seededStore();
            const playerMatch = 'player-ranked-12345678-1234-4123-8123-1234567890ab';
            const battleId = 'pvp-12345678-1234-4123-8123-1234567890ab';
            const proof = await mintPlayerRankedMatchTokenWithStore(store, {
                a: 'alpha', b: 'bravo', aLevel: 25, bLevel: 25, aRating: 1000, bRating: 1000,
                now: NOW + 1, matchId: playerMatch,
            });
            await activatePlayerRankedAdmission(store, proof.matchId, battleId, NOW + 2);
            const activeSession = {
                battleId,
                p1: { name: 'alpha' },
                p2: { name: 'bravo' },
                status: 'active',
                winner: null,
                ranked: false,
                rankedKind: 'player',
                playerRankedAuthorityVersion: 2,
                rankedMatchId: playerMatch,
                rankedSeasonId: 1,
                rankedSeasonEpoch: 1,
                p1Rating: 1000,
                p2Rating: 1000,
                joined: { p1: true, p2: true },
                rewardAuthority: 'ranked',
                baseRewards: false,
                realFighters: { p1: true, p2: true },
                itemCharges: { p1: { potion: 0 }, p2: { potion: 0 } },
                itemsUsed: { p1: {}, p2: {} },
                log: [],
                createdAt: NOW,
            } as unknown as PvpSession;
            const terminalSession = { ...activeSession, status: 'done', winner: 'p1' } as PvpSession;
            const sessionKey = `pvp:${battleId}`;
            await store.set(sessionKey, activeSession, { ex: 900 });
            const committed = await commitPvpSessionMutation(store, sessionKey, activeSession, terminalSession);
            assert.equal(committed.status, 'committed');

            // Simulated process death immediately after the terminal CAS. The
            // ordinary 15m session lease has passed and no client returns.
            clock = NOW + 16 * 60 * 1_000;
            assert.equal((await store.get<PvpSession>(sessionKey))?.status, 'done');
            const rolled = await runRankedSeasonRolloverWithStore(store, clock, { force: true, lock });
            assert.equal(rolled.ok, true, String(rolled.error ?? 'ranked rollover failed'));
            assert.equal((await getPlayerRankedJournal(store, playerMatch))?.state, 'completed');
            const alpha = await store.get<Record<string, any>>('save:alpha');
            const bravo = await store.get<Record<string, any>>('save:bravo');
            assert.equal(alpha?.character.rankedRating, 1006, '1012 old-season Elo is reset only after settlement');
            assert.equal(bravo?.character.rankedRating, 994, '988 old-season Elo is reset only after settlement');
            assert.equal(alpha?.character.rankedWins, 1);
            assert.equal(bravo?.character.rankedLosses, 1);
            assert.deepEqual(alpha?.character.itemStacks, [{ itemId: 'potion', count: 2 }]);
            assert.deepEqual(bravo?.character.itemStacks, [{ itemId: 'potion', count: 2 }]);
            assert.equal((await readPetRankedSeasonGateFresh(store))?.playerAdmissions.length, 0);

            assert.ok(await store.get(sessionKey), 'settled terminal remains replayable during its compact TTL');
            clock += 901 * 1_000;
            assert.equal(await store.get(sessionKey), null, 'settled terminal is bounded only after all effects complete');
        } finally {
            Date.now = realDateNow;
        }
    });

    it('fails closed on one transient snapshot read and retries with the correct full podium', async () => {
        const store = await seededStore();
        const alpha = await store.get<Record<string, any>>('save:alpha');
        alpha!.character.rankedRating = 1400;
        await store.set('save:alpha', alpha);
        let failed = false;
        const transient: KvLike = {
            ...store,
            async get<T>(key: string) {
                if (key === 'save:alpha' && !failed) {
                    failed = true;
                    throw new Error('transient-champion-read');
                }
                return store.get<T>(key);
            },
        };
        const interrupted = await runRankedSeasonRolloverWithStore(transient, NOW + 4, { force: true, lock });
        assert.equal(interrupted.ok, false);
        assert.match(String(interrupted.error), /transient-champion-read/);
        assert.equal((await store.get<{ id: number }>(SEASON_CURRENT_KEY))?.id, 1);
        assert.equal((await readPetRankedSeasonGateFresh(store))?.state, 'closing');
        assert.equal(await store.get(`${SEASON_PLAN_PREFIX}1`), null);
        assert.equal(await store.get(`${SEASON_ARCHIVE_PREFIX}1`), null);
        assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.rankedRating, 1400);

        const retry = await runRankedSeasonRolloverWithStore(store, NOW + 5, { lock });
        assert.equal(retry.ok, true);
        assert.equal(retry.playerChampion, 'alpha');
        assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.rankedRating, 1200);
    });

    it('settles zero-use V2 items without any mutable save debit before Elo or compaction', async () => {
        const store = await seededStore();
        const playerMatch = 'player-ranked-72345678-1234-4123-8123-1234567890ab';
        const battleId = 'pvp-72345678-1234-4123-8123-1234567890ab';
        const proof = await mintPlayerRankedMatchTokenWithStore(store, {
            a: 'alpha', b: 'bravo', aLevel: 25, bLevel: 25, aRating: 1000, bRating: 1000,
            now: NOW + 1, matchId: playerMatch,
        });
        await activatePlayerRankedAdmission(store, proof.matchId, battleId, NOW + 2);
        const terminal = {
            battleId,
            p1: { name: 'alpha' },
            p2: { name: 'bravo' },
            status: 'done',
            winner: 'p1',
            ranked: false,
            rankedKind: 'player',
            playerRankedAuthorityVersion: 2,
            rankedMatchId: playerMatch,
            rankedSeasonId: 1,
            rankedSeasonEpoch: 1,
            p1Rating: 1000,
            p2Rating: 1000,
            joined: { p1: true, p2: true },
            rewardAuthority: 'ranked',
            baseRewards: false,
            realFighters: { p1: true, p2: true },
            itemCharges: { p1: { potion: 0 }, p2: { potion: 0 } },
            itemsUsed: { p1: {}, p2: {} },
            log: [],
            createdAt: NOW,
        } as unknown as PvpSession;
        await store.set(`pvp:${battleId}`, terminal);
        await confirmPlayerRankedTerminalEffects(store, terminal, {
            now: NOW + 3,
            eligible: async () => true,
            lock,
        });
        assert.equal(await getPlayerRankedAdmission(store, playerMatch), null);
        assert.equal((await getPlayerRankedJournal(store, playerMatch))?.state, 'completed');
        assert.deepEqual((await store.get<Record<string, any>>('save:alpha'))?.character.itemStacks, [{ itemId: 'potion', count: 2 }]);

        const rolled = await runRankedSeasonRolloverWithStore(store, NOW + 4, { force: true, lock });
        assert.equal(rolled.ok, true);
        assert.equal((await getPlayerRankedJournal(store, playerMatch))?.state, 'completed');
        assert.deepEqual((await store.get<Record<string, any>>('save:alpha'))?.character.itemStacks, [{ itemId: 'potion', count: 2 }]);
        assert.deepEqual((await store.get<Record<string, any>>('save:bravo'))?.character.itemStacks, [{ itemId: 'potion', count: 2 }]);
    });

    it('treats an enumerated but missing save row as an unreadable snapshot member', async () => {
        const store = await seededStore();
        const missing: KvLike = {
            ...store,
            async keys(pattern: string) {
                const keys = await store.keys(pattern);
                return pattern === 'save:*' ? [...keys, 'save:ghost'] : keys;
            },
        };
        const result = await runRankedSeasonRolloverWithStore(missing, NOW + 6, { force: true, lock });
        assert.equal(result.ok, false);
        assert.match(String(result.error), /snapshot-save-unreadable:save:ghost/);
        assert.equal((await store.get<{ id: number }>(SEASON_CURRENT_KEY))?.id, 1);
        assert.equal(await store.get(`${SEASON_PLAN_PREFIX}1`), null);
    });

    it('finishes a partial two-save Elo journal before snapshot/reset and never crosses the season boundary', async () => {
        const store = await seededStore();
        const prep = await reservePetRankedPreparation(
            store,
            makePetRankedPreparation(token, { seasonId: 1, epoch: 1 }),
        );
        assert.equal((await claimPetRankedActivePair(store, [prep.a, prep.b], prep.matchId)).ok, true);

        let failed = false;
        const failSecondSave: KvLike = {
            ...store,
            async compareSet(key, expected, value, options) {
                if (key === 'save:bravo' && !failed) {
                    failed = true;
                    throw new Error('bravo-ranked-save-precommit-failure');
                }
                return store.compareSet(key, expected, value, options);
            },
        };
        const partial = await runRankedSeasonRolloverWithStore(
            failSecondSave,
            NOW + 2,
            { force: true, lock },
        );
        assert.equal(partial.ok, false);
        assert.match(String(partial.error), /bravo-ranked-save-precommit/);
        assert.equal((await store.get<{ id: number }>(SEASON_CURRENT_KEY))?.id, 1);
        assert.equal((await readPetRankedSeasonGateFresh(store))?.state, 'closing');
        assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedRating, 1012);
        assert.equal((await store.get<Record<string, any>>('save:bravo'))?.character.petRankedRating, 1000);
        assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'pending');

        const completed = await runRankedSeasonRolloverWithStore(store, NOW + 3, { lock });
        assert.equal(completed.ok, true);
        assert.equal(completed.action, 'rolled-over');
        assert.equal((await store.get<{ id: number }>(SEASON_CURRENT_KEY))?.id, 2);
        const gate = await readPetRankedSeasonGateFresh(store);
        assert.equal(gate?.state, 'open');
        assert.equal(gate?.seasonId, 2);
        assert.equal(gate?.admissions.length, 0);
        assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'completed');

        const alpha = await store.get<Record<string, any>>('save:alpha');
        const bravo = await store.get<Record<string, any>>('save:bravo');
        assert.equal(alpha?.character.petRankedRating, 1006, '1012 settles before the season soft reset');
        assert.equal(bravo?.character.petRankedRating, 994, '988 settles before the season soft reset');
        assert.deepEqual(alpha?.character.rankedSeasonSettlementReceipts, [1]);
        assert.deepEqual(bravo?.character.rankedSeasonSettlementReceipts, [1]);
    });

    it('recovers lost acknowledgements for close, current advance, and reopen CAS', async () => {
        const store = await seededStore();
        const lost = new Set<string>();
        const lostAck: KvLike = {
            ...store,
            async compareSet(key, expected, value, options) {
                const committed = await store.compareSet(key, expected, value, options);
                if (!committed) return false;
                const record = value as Record<string, unknown>;
                const boundary = key === 'ranked:season:authority'
                    ? record.state === 'closing' ? 'close' : record.state === 'open' && record.seasonId === 2 ? 'reopen' : ''
                    : key === SEASON_CURRENT_KEY && record.id === 2 ? 'advance' : '';
                if (boundary && !lost.has(boundary)) {
                    lost.add(boundary);
                    throw new Error(`lost-${boundary}-ack`);
                }
                return true;
            },
        };

        const result = await runRankedSeasonRolloverWithStore(
            lostAck,
            NOW + 10,
            { force: true, lock },
        );
        assert.equal(result.ok, true);
        assert.deepEqual([...lost].sort(), ['advance', 'close', 'reopen']);
        assert.equal((await store.get<{ id: number }>(SEASON_CURRENT_KEY))?.id, 2);
        assert.equal((await readPetRankedSeasonGateFresh(store))?.state, 'open');
    });

    it('keeps admission closed after a reopen precommit crash and repairs it on restart', async () => {
        const store = await seededStore();
        let rejected = false;
        const failReopen: KvLike = {
            ...store,
            async compareSet(key, expected, value, options) {
                const record = value as Record<string, unknown>;
                if (key === 'ranked:season:authority'
                    && record.state === 'open'
                    && record.seasonId === 2
                    && !rejected) {
                    rejected = true;
                    throw new Error('reopen-precommit-failure');
                }
                return store.compareSet(key, expected, value, options);
            },
        };

        const interrupted = await runRankedSeasonRolloverWithStore(
            failReopen,
            NOW + 20,
            { force: true, lock },
        );
        assert.equal(interrupted.ok, false);
        assert.match(String(interrupted.error), /reopen-precommit/);
        assert.equal((await store.get<{ id: number }>(SEASON_CURRENT_KEY))?.id, 2);
        assert.equal((await readPetRankedSeasonGateFresh(store))?.state, 'closing');

        const restarted = await runRankedSeasonRolloverWithStore(store, NOW + 21, { lock });
        assert.equal(restarted.ok, true);
        assert.equal(restarted.action, 'skipped');
        const gate = await readPetRankedSeasonGateFresh(store);
        assert.equal(gate?.state, 'open');
        assert.equal(gate?.seasonId, 2);
    });

    it('retries a current-season advance precommit crash without resetting or rewarding twice', async () => {
        const store = await seededStore();
        const alpha = await store.get<Record<string, any>>('save:alpha');
        alpha!.character.rankedRating = 1400;
        await store.set('save:alpha', alpha);
        let rejected = false;
        const failAdvance: KvLike = {
            ...store,
            async compareSet(key, expected, value, options) {
                const record = value as Record<string, unknown>;
                if (key === SEASON_CURRENT_KEY && record.id === 2 && !rejected) {
                    rejected = true;
                    throw new Error('advance-precommit-failure');
                }
                return store.compareSet(key, expected, value, options);
            },
        };

        const interrupted = await runRankedSeasonRolloverWithStore(
            failAdvance,
            NOW + 30,
            { force: true, lock },
        );
        assert.equal(interrupted.ok, false);
        assert.match(String(interrupted.error), /advance-precommit/);
        assert.equal((await store.get<{ id: number }>(SEASON_CURRENT_KEY))?.id, 1);
        assert.equal((await readPetRankedSeasonGateFresh(store))?.state, 'closing');
        const once = await store.get<Record<string, any>>('save:alpha');
        assert.equal(once?.character.rankedRating, 1200);
        assert.equal(once?.character.auraStones, 10);

        const completed = await runRankedSeasonRolloverWithStore(store, NOW + 31, { lock });
        assert.equal(completed.ok, true);
        assert.equal((await store.get<{ id: number }>(SEASON_CURRENT_KEY))?.id, 2);
        const final = await store.get<Record<string, any>>('save:alpha');
        assert.equal(final?.character.rankedRating, 1200);
        assert.equal(final?.character.auraStones, 10);
        assert.deepEqual(final?.character.rankedSeasonSettlementReceipts, [1]);
    });

    it('recovers season-one publication when current CAS commits and its ack is lost', async () => {
        const store = _makeMemoryKv();
        let lost = false;
        const lostStartAck: KvLike = {
            ...store,
            async compareSet(key, expected, value, options) {
                const committed = await store.compareSet(key, expected, value, options);
                if (key === SEASON_CURRENT_KEY && committed && !lost) {
                    lost = true;
                    throw new Error('lost-season-start-ack');
                }
                return committed;
            },
        };
        const result = await startRankedSeasonWithStore(lostStartAck, NOW);
        assert.equal(result.action, 'initialized');
        assert.equal(lost, true);
        assert.equal((await store.get<{ id: number }>(SEASON_CURRENT_KEY))?.id, 1);
        assert.equal((await readPetRankedSeasonGateFresh(store))?.state, 'open');
    });
});
