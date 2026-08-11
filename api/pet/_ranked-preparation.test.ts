import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import {
    claimPetRankedActivePair,
    petRankedActiveKey,
    type ServerResolvedPetRankedToken,
} from './_ranked-engine.js';
import { getPetRankedJournal } from './_ranked-journal.js';
import {
    activatePlayerRankedAdmission,
    cancelExpiredOrphanPlayerRankedAdmissions,
    closePetRankedSeasonGate,
    completePetRankedPreparation,
    ensurePetRankedSeasonGate,
    getPlayerRankedAdmission,
    loadPetRankedPreparation,
    makePlayerRankedAdmission,
    makePetRankedPreparation,
    markPlayerRankedSessionPublished,
    parsePetRankedPreparation,
    parsePetRankedSeasonGate,
    petRankedPreparationKey,
    PLAYER_RANKED_JOIN_DEADLINE_MS,
    readPetRankedSeasonGateFresh,
    reservePlayerRankedAdmission,
    reservePetRankedPreparation,
    type PetRankedPreparation,
} from './_ranked-preparation.js';
import { settlePetRankedMatchDurably } from './_ranked-settlement.js';
import { recordCancelledPlayerRankedAdmission } from '../pvp/_player-ranked-journal.js';

const MATCH = '91726354abcdef0091726354abcdef00';
const OTHER_MATCH = '81726354abcdef0081726354abcdef00';
const NOW = 1_750_000_000_000;
const PLAYER_MATCH = 'player-ranked-12345678-1234-4123-8123-1234567890ab';
const PLAYER_BATTLE = 'pvp-12345678-1234-4123-8123-1234567890ab';

const token: ServerResolvedPetRankedToken = {
    version: 'pet-ranked-token-v1',
    matchId: MATCH,
    a: 'alpha',
    b: 'bravo',
    aRating: 1000,
    bRating: 1000,
    createdAt: NOW,
    seed: 481516,
    aPetId: 'alpha-pet',
    bPetId: 'bravo-pet',
    resolution: {
        authority: 'server-engine-v1',
        engineVersion: 'pet-duel-sim-ranked-v1',
        winner: 'a',
        resolvedAt: NOW,
        engineDigest: '1234567890abcdef'.repeat(4),
        reward: { kind: 'pet-rating-v1', ryo: 0, aDelta: 12, bDelta: -12 },
    },
};

const save = (name: string) => ({
    _saveVersion: 1,
    character: {
        name,
        petRankedRating: 1000,
        petRankedWins: 0,
        petRankedLosses: 0,
        pets: [{ id: `${name}-pet`, loadout: { consumable: 'pet-tonic' } }],
    },
});

const lock = async <T>(_key: string, action: () => Promise<T>): Promise<T> => action();

async function initialized() {
    const store = _makeMemoryKv();
    await ensurePetRankedSeasonGate(store, 1, NOW);
    return store;
}

function preparation(matchToken: ServerResolvedPetRankedToken = token): PetRankedPreparation {
    return makePetRankedPreparation(matchToken, { seasonId: 1, epoch: 1 });
}

describe('ranked preparation and admission authority', () => {
    it('reconstructs the immutable row when its mirror write fails after gate admission', async () => {
        const store = await initialized();
        const prep = preparation();
        const mirrorFault: KvLike = {
            ...store,
            async set(key, value, options) {
                if (key === petRankedPreparationKey(MATCH)) {
                    throw new Error('preparation-mirror-precommit-failure');
                }
                return store.set(key, value, options);
            },
        };

        await assert.rejects(reservePetRankedPreparation(mirrorFault, prep), /mirror-precommit/);
        assert.equal((await readPetRankedSeasonGateFresh(store))?.admissions.length, 1);
        assert.equal(await store.get(petRankedPreparationKey(MATCH)), null);
        assert.equal(await store.get(petRankedActiveKey('alpha')), null, 'no lease precedes durable preparation');

        const recovered = await loadPetRankedPreparation(store, MATCH);
        assert.deepEqual(recovered, prep);
        assert.equal(typeof await store.get(petRankedPreparationKey(MATCH)), 'string');
    });

    it('recognizes a lost gate-CAS acknowledgement and preserves the winning seed', async () => {
        const store = await initialized();
        const prep = preparation();
        let failed = false;
        const lostAck: KvLike = {
            ...store,
            async compareSet(key, expected, value, options) {
                const committed = await store.compareSet(key, expected, value, options);
                if (key === 'ranked:season:authority' && committed && !failed) {
                    failed = true;
                    throw new Error('lost-gate-admission-ack');
                }
                return committed;
            },
        };

        assert.deepEqual(await reservePetRankedPreparation(lostAck, prep), prep);
        assert.deepEqual(await loadPetRankedPreparation(store, MATCH), prep);
        assert.equal((await readPetRankedSeasonGateFresh(store))?.admissions.length, 1);
    });

    it('keeps first-lease authority through a second-lease precommit crash and resumes it', async () => {
        const store = await initialized();
        const prep = await reservePetRankedPreparation(store, preparation());
        const secondKey = petRankedActiveKey('bravo');
        let failed = false;
        const leaseFault: KvLike = {
            ...store,
            async set(key, value, options) {
                if (key === secondKey && !failed) {
                    failed = true;
                    throw new Error('second-lease-precommit-failure');
                }
                return store.set(key, value, options);
            },
        };

        await assert.rejects(
            claimPetRankedActivePair(leaseFault, [prep.a, prep.b], prep.matchId),
            /second-lease-precommit/,
        );
        assert.equal(await store.get(petRankedActiveKey('alpha')), MATCH);
        assert.equal(await store.get(secondKey), null);
        assert.deepEqual(await loadPetRankedPreparation(store, MATCH), prep);

        assert.equal((await claimPetRankedActivePair(store, [prep.a, prep.b], prep.matchId)).ok, true);
        assert.equal(await store.get(secondKey), MATCH);
    });

    it('helps a preparation with both leases but no journal completely forward', async () => {
        const store = await initialized();
        await Promise.all([
            store.set('save:alpha', save('alpha')),
            store.set('save:bravo', save('bravo')),
        ]);
        const prep = await reservePetRankedPreparation(store, preparation());
        assert.equal((await claimPetRankedActivePair(store, [prep.a, prep.b], prep.matchId)).ok, true);
        assert.equal(await getPetRankedJournal(store, MATCH), null, 'simulated crash before journal reservation');

        await settlePetRankedMatchDurably(store, {
            matchToken: prep.matchId,
            token: prep.token,
            lock,
            now: NOW + 1,
        });
        await completePetRankedPreparation(store, prep);

        assert.equal((await getPetRankedJournal(store, MATCH))?.state, 'completed');
        assert.equal((await readPetRankedSeasonGateFresh(store))?.admissions.length, 0);
        assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedRating, 1012);
        assert.equal((await store.get<Record<string, any>>('save:bravo'))?.character.petRankedRating, 988);
    });

    it('a closing epoch fences a stale fresh starter before it can claim a lease', async () => {
        const store = await initialized();
        await closePetRankedSeasonGate(store, 1, NOW + 1);
        const other = preparation({
            ...token,
            matchId: OTHER_MATCH,
            a: 'charlie',
            b: 'delta',
            aPetId: 'charlie-pet',
            bPetId: 'delta-pet',
        });
        await assert.rejects(reservePetRankedPreparation(store, other), /admission-closed/);
        assert.equal(await store.get(petRankedActiveKey('charlie')), null);
        assert.equal(await store.get(petRankedActiveKey('delta')), null);
    });

    it('enforces the shared 256-row capacity across player and pet admissions', async () => {
        const store = await initialized();
        const gate = await readPetRankedSeasonGateFresh(store);
        assert.ok(gate);
        const playerAdmissions = Array.from({ length: 256 }, (_, index) => makePlayerRankedAdmission({
            matchId: `player-ranked-${index.toString(16).padStart(8, '0')}-1234-4123-8123-1234567890ab`,
            a: `player-${index}-a`,
            b: `player-${index}-b`,
            aLevel: 20,
            bLevel: 20,
            aRating: 1000,
            bRating: 1000,
            createdAt: NOW + index + 1,
            seasonId: 1,
            seasonEpoch: 1,
        }));
        await store.set('ranked:season:authority', { ...gate, playerAdmissions });

        await assert.rejects(
            reservePetRankedPreparation(store, preparation()),
            /ranked-season-admission-capacity/,
        );
        assert.equal((await readPetRankedSeasonGateFresh(store))?.playerAdmissions.length, 256);
        assert.equal((await readPetRankedSeasonGateFresh(store))?.admissions.length, 0);
    });

    it('cancels only an old active admission whose exact session row is missing', async () => {
        const store = await initialized();
        const admission = makePlayerRankedAdmission({
            matchId: PLAYER_MATCH,
            a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
            createdAt: NOW, seasonId: 1, seasonEpoch: 1,
        });
        await reservePlayerRankedAdmission(store, admission);
        await activatePlayerRankedAdmission(store, PLAYER_MATCH, PLAYER_BATTLE, NOW + 1);

        const cancelled = await cancelExpiredOrphanPlayerRankedAdmissions(store, NOW + 2, NOW + 3);

        assert.equal(cancelled.length, 1);
        assert.equal(cancelled[0].phase, 'cancelled');
        assert.equal((await getPlayerRankedAdmission(store, PLAYER_MATCH))?.phase, 'cancelled');

        // Crash after the cancellation gate CAS: the next traffic sweep must
        // rediscover the durable cancelled row instead of returning [].
        const rediscovered = await cancelExpiredOrphanPlayerRankedAdmissions(store, NOW + 2, NOW + 4);
        assert.equal(rediscovered.length, 1);
        let failed = false;
        const completionCrash: KvLike = {
            ...store,
            async compareSet(key, expected, value, options) {
                const gate = value as { playerAdmissions?: Array<{ matchId?: string }> };
                if (key === 'ranked:season:authority'
                    && !gate.playerAdmissions?.some((entry) => entry.matchId === PLAYER_MATCH)
                    && !failed) {
                    failed = true;
                    throw new Error('orphan-completion-precommit-crash');
                }
                return store.compareSet(key, expected, value, options);
            },
        };
        await assert.rejects(() => recordCancelledPlayerRankedAdmission(
            completionCrash,
            rediscovered[0],
            { reason: 'orphan-session-missing' },
        ), /orphan-completion-precommit-crash/);
        assert.ok(await store.get(`player:ranked-cancelled:${PLAYER_MATCH}`));
        assert.equal((await getPlayerRankedAdmission(store, PLAYER_MATCH))?.phase, 'cancelled');

        await recordCancelledPlayerRankedAdmission(store, rediscovered[0], { reason: 'orphan-session-missing' });
        assert.equal(await getPlayerRankedAdmission(store, PLAYER_MATCH), null);
    });

    it('never cancels an active admission while its session exists', async () => {
        const store = await initialized();
        const admission = makePlayerRankedAdmission({
            matchId: PLAYER_MATCH,
            a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
            createdAt: NOW, seasonId: 1, seasonEpoch: 1,
        });
        await reservePlayerRankedAdmission(store, admission);
        await activatePlayerRankedAdmission(store, PLAYER_MATCH, PLAYER_BATTLE, NOW + 1);
        await store.set(`pvp:${PLAYER_BATTLE}`, { battleId: PLAYER_BATTLE, status: 'active' });

        assert.deepEqual(await cancelExpiredOrphanPlayerRankedAdmissions(store, NOW + 2, NOW + 3), []);
        assert.equal((await getPlayerRankedAdmission(store, PLAYER_MATCH))?.phase, 'active');
    });

    it('exact-fences a never-joined V2 session at the join deadline and immediately readmits both players', async () => {
        const store = await initialized();
        const admission = makePlayerRankedAdmission({
            matchId: PLAYER_MATCH,
            a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
            createdAt: NOW, seasonId: 1, seasonEpoch: 1,
        });
        await reservePlayerRankedAdmission(store, admission);
        await activatePlayerRankedAdmission(store, PLAYER_MATCH, PLAYER_BATTLE, NOW + 1);
        const createdAt = NOW + 2;
        await store.set(`pvp:${PLAYER_BATTLE}`, {
            battleId: PLAYER_BATTLE,
            p1: { name: 'alice' },
            p2: { name: 'bob' },
            status: 'active',
            ranked: false,
            rankedKind: 'player',
            playerRankedAuthorityVersion: 2,
            rankedMatchId: PLAYER_MATCH,
            rankedSeasonId: 1,
            rankedSeasonEpoch: 1,
            p1Rating: 1000,
            p2Rating: 1000,
            rewardAuthority: 'ranked',
            baseRewards: false,
            joined: { p1: true, p2: false },
            createdAt,
        });

        const cancelled = await cancelExpiredOrphanPlayerRankedAdmissions(
            store,
            NOW - 1, // the ordinary 30m missing-session cutoff has not elapsed
            createdAt + PLAYER_RANKED_JOIN_DEADLINE_MS + 1,
        );
        assert.equal(cancelled.length, 1);
        assert.equal((await store.get<Record<string, unknown>>(`pvp:${PLAYER_BATTLE}`))?.version,
            'player-ranked-session-orphan-tombstone-v1');
        await recordCancelledPlayerRankedAdmission(store, cancelled[0], { reason: 'orphan-session-missing' });
        assert.equal(await getPlayerRankedAdmission(store, PLAYER_MATCH), null);

        const successor = makePlayerRankedAdmission({
            matchId: 'player-ranked-22345678-1234-4123-8123-1234567890ab',
            a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
            createdAt: createdAt + PLAYER_RANKED_JOIN_DEADLINE_MS + 2,
            seasonId: 1,
            seasonEpoch: 1,
        });
        assert.equal((await reservePlayerRankedAdmission(store, successor)).matchId, successor.matchId);
    });

    it('a join CAS that wins at the deadline defeats stale no-contest cleanup', async () => {
        const base = await initialized();
        const admission = makePlayerRankedAdmission({
            matchId: PLAYER_MATCH,
            a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
            createdAt: NOW, seasonId: 1, seasonEpoch: 1,
        });
        await reservePlayerRankedAdmission(base, admission);
        await activatePlayerRankedAdmission(base, PLAYER_MATCH, PLAYER_BATTLE, NOW + 1);
        const createdAt = NOW + 2;
        const unjoined = {
            battleId: PLAYER_BATTLE,
            p1: { name: 'alice' }, p2: { name: 'bob' }, status: 'active',
            ranked: false, rankedKind: 'player', playerRankedAuthorityVersion: 2,
            rankedMatchId: PLAYER_MATCH, rankedSeasonId: 1, rankedSeasonEpoch: 1,
            p1Rating: 1000, p2Rating: 1000, rewardAuthority: 'ranked', baseRewards: false,
            joined: { p1: true, p2: false }, createdAt,
        };
        await base.set(`pvp:${PLAYER_BATTLE}`, unjoined);
        let joinedWon = false;
        const raced: KvLike = {
            ...base,
            async compareSet(key, expected, value, options) {
                if (key === `pvp:${PLAYER_BATTLE}`
                    && (value as Record<string, unknown>)?.version === 'player-ranked-session-orphan-tombstone-v1'
                    && !joinedWon) {
                    joinedWon = await base.compareSet(key, expected, {
                        ...(expected as Record<string, unknown>),
                        joined: { p1: true, p2: true },
                    });
                }
                return base.compareSet(key, expected, value, options);
            },
        };

        assert.deepEqual(await cancelExpiredOrphanPlayerRankedAdmissions(
            raced,
            NOW - 1,
            createdAt + PLAYER_RANKED_JOIN_DEADLINE_MS + 1,
        ), []);
        assert.equal(joinedWon, true);
        assert.deepEqual((await base.get<Record<string, any>>(`pvp:${PLAYER_BATTLE}`))?.joined, { p1: true, p2: true });
        assert.equal((await getPlayerRankedAdmission(base, PLAYER_MATCH))?.phase, 'active');
    });

    it('an orphan tombstone remains cancellation authority after a racing recovery heartbeat', async () => {
        const base = await initialized();
        const admission = makePlayerRankedAdmission({
            matchId: PLAYER_MATCH,
            a: 'alice', b: 'bob', aLevel: 20, bLevel: 20, aRating: 1000, bRating: 1000,
            createdAt: NOW, seasonId: 1, seasonEpoch: 1,
        });
        await reservePlayerRankedAdmission(base, admission);
        await activatePlayerRankedAdmission(base, PLAYER_MATCH, PLAYER_BATTLE, NOW + 1);
        let raced = false;
        let stalePublish: 'OK' | null = 'OK';
        const store: KvLike = {
            ...base,
            async compareSet(key, expected, value, options) {
                if (key === `pvp:${PLAYER_BATTLE}` && expected === null && !raced) {
                    raced = true;
                    await markPlayerRankedSessionPublished(base, PLAYER_MATCH, PLAYER_BATTLE, NOW + 10);
                    const swapped = await base.compareSet(key, expected, value, options);
                    stalePublish = await base.set(
                        `pvp:${PLAYER_BATTLE}`,
                        { battleId: PLAYER_BATTLE, status: 'active' },
                        { nx: true },
                    );
                    return swapped;
                }
                return base.compareSet(key, expected, value, options);
            },
        };

        const cancelled = await cancelExpiredOrphanPlayerRankedAdmissions(store, NOW + 2, NOW + 11);
        assert.equal(cancelled.some((entry) => entry.matchId === PLAYER_MATCH), true);
        assert.equal((await getPlayerRankedAdmission(base, PLAYER_MATCH))?.phase, 'cancelled');
        assert.equal(stalePublish, null, 'production NX publication loses to the exact orphan tombstone');
        assert.equal(raced, true);
    });

    it('strict parsers reject malformed durable preparation and gate records', async () => {
        const prep = preparation();
        assert.equal(parsePetRankedPreparation(JSON.stringify({ ...prep, clientSeed: 7 })), null);
        assert.equal(parsePetRankedPreparation(JSON.stringify({ ...prep, tokenFingerprint: '0'.repeat(64) })), null);
        assert.equal(parsePetRankedPreparation(JSON.stringify({
            ...prep,
            token: { ...prep.token, clientOutcome: 'win' },
        })), null);
        const store = await initialized();
        const gate = await readPetRankedSeasonGateFresh(store);
        assert.ok(gate);
        assert.equal(parsePetRankedSeasonGate({ ...gate, admissions: [prep, prep] }), null);
        assert.equal(parsePetRankedSeasonGate({ ...gate, clientState: 'open' }), null);
    });
});
