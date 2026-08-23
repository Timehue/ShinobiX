import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import { PET_RANKED_ENGINE_VERSION } from './_ranked-engine.js';
import {
    derivePetRankedSettlement,
    petRankedSettlementId,
    petRankedStartsEnabled,
    petRankedQueueEnabled,
    petRankedPublicChallengesEnabled,
    petRankedPublicPresentationEnabled,
    settlePetRankedSide,
    type ServerResolvedPetRankedToken,
} from './_ranked-settlement.js';

const MATCH_TOKEN = '12345678123412341234123456789abc';

const rankedSave = (name: string) => ({
    _saveVersion: 1,
    character: {
        name,
        petRankedRating: 1000,
        petRankedWins: 0,
        petRankedLosses: 0,
        pets: [{ id: `${name}-pet`, loadout: { consumable: 'pet-tonic', passive: 'guard' } }],
    },
});

const settlementInput = (playerName: string, role: 'winner' | 'loser' | 'draw') => ({
    playerName,
    matchToken: MATCH_TOKEN,
    role,
    winnerRating: 1000,
    loserRating: 1000,
    combatPetId: `${playerName}-pet`,
    now: 1_750_000_000_000,
});

function failOneSaveCompareSet(store: KvLike, key: string, afterCommit: boolean): KvLike {
    let failed = false;
    return {
        ...store,
        async compareSet(candidate, expected, value, options) {
            if (candidate !== key || failed) return store.compareSet(candidate, expected, value, options);
            failed = true;
            if (afterCommit) await store.compareSet(candidate, expected, value, options);
            throw new Error(afterCommit ? 'lost-save-ack' : 'save-write-failed');
        },
    };
}

const unresolved = {
    version: 'pet-ranked-token-v1',
    matchId: MATCH_TOKEN,
    a: 'alpha',
    b: 'bravo',
    aRating: 1100,
    bRating: 900,
    createdAt: 100,
    seed: 123,
    aPetId: 'alpha-pet',
    bPetId: 'bravo-pet',
} as unknown as ServerResolvedPetRankedToken;

const resolved: ServerResolvedPetRankedToken = {
    ...unresolved,
    resolution: {
        authority: 'server-engine-v1',
        engineVersion: PET_RANKED_ENGINE_VERSION,
        winner: 'b',
        resolvedAt: 200,
        engineDigest: '0123456789abcdef'.repeat(4),
        reward: { kind: 'pet-rating-v1', ryo: 0, aDelta: -18, bDelta: 18 },
    },
};

describe('_ranked-settlement', () => {
    it('ships ranked pet resolution ON with opt-out kill switches', () => {
        // The stacked positive flags belonged to the two-engine era. That defect
        // is fixed (one resolution, replayed to both players), so the mode ships
        // on like every other switch in _release-flags.ts.
        assert.equal(petRankedStartsEnabled({}), true);
        assert.equal(petRankedQueueEnabled({}), true);
        assert.equal(petRankedPublicPresentationEnabled({}), true);
        assert.equal(petRankedStartsEnabled({ DISABLE_PET_RANKED_SERVER_V1: '1' }), false);
        assert.equal(petRankedQueueEnabled({ DISABLE_PET_RANKED_QUEUE: '1' }), false);
        assert.equal(petRankedPublicPresentationEnabled({ DISABLE_PET_RANKED_PUBLIC_PRESENTATION: '1' }), false);
    });

    it('closes every dependent surface from the one core switch', () => {
        const off = { DISABLE_PET_RANKED_SERVER_V1: '1' } as NodeJS.ProcessEnv;
        assert.equal(petRankedQueueEnabled(off), false, 'matchmaking must follow the core switch');
        assert.equal(petRankedPublicPresentationEnabled(off), false);
        assert.equal(petRankedPublicChallengesEnabled(off), false);
    });

    it('keeps the retired legacy challenge record closed on its own positive flag', () => {
        // Its client showed one engine while settlement replayed another, so it
        // is NOT covered by the single-resolution fix and stays opt-in.
        assert.equal(petRankedPublicChallengesEnabled({}), false);
        assert.equal(petRankedPublicChallengesEnabled({ ENABLE_PET_RANKED_PUBLIC_CHALLENGES_V1: '1' }), true);
    });

    it('rejects a ratings-only token because it does not prove an outcome', () => {
        assert.deepEqual(derivePetRankedSettlement(unresolved, 'alpha', 'win'), {
            ok: false,
            reason: 'server-resolution-required',
        });
    });

    it('derives both sides from the server winner instead of the first reporter', () => {
        const winner = derivePetRankedSettlement(resolved, 'bravo', 'win');
        assert.equal(winner.ok, true);
        if (winner.ok) assert.deepEqual(winner.settlement, {
            callerRole: 'winner',
            authoritativeOutcome: 'win',
            aName: 'alpha',
            bName: 'bravo',
            aRating: 1100,
            bRating: 900,
            winnerName: 'bravo',
            loserName: 'alpha',
            winnerRating: 900,
            loserRating: 1100,
        });

        const loser = derivePetRankedSettlement(resolved, 'alpha', 'loss');
        assert.equal(loser.ok, true);
        if (loser.ok) assert.equal(loser.settlement.callerRole, 'loser');
    });

    it('rejects a conflicting report without changing the sealed winner', () => {
        assert.deepEqual(derivePetRankedSettlement(resolved, 'alpha', 'win'), {
            ok: false,
            reason: 'conflicting-client-outcome',
        });
        assert.deepEqual(derivePetRankedSettlement(resolved, 'bravo', 'loss'), {
            ok: false,
            reason: 'conflicting-client-outcome',
        });
    });

    it('rejects malformed server resolution metadata', () => {
        const malformed = {
            ...resolved,
            resolution: { ...resolved.resolution!, engineDigest: 'short' },
        };
        assert.deepEqual(derivePetRankedSettlement(malformed, 'bravo', 'win'), {
            ok: false,
            reason: 'invalid-server-resolution',
        });
    });

    it('seals draws without inventing a winner or rating reward', async () => {
        const draw: ServerResolvedPetRankedToken = {
            ...resolved,
            resolution: {
                ...resolved.resolution,
                winner: 'draw',
                reward: { kind: 'pet-rating-v1', ryo: 0, aDelta: 0, bDelta: 0 },
            },
        };
        const decision = derivePetRankedSettlement(draw, 'alpha', 'draw');
        assert.equal(decision.ok, true);
        if (decision.ok) {
            assert.equal(decision.settlement.callerRole, 'draw');
            assert.equal(decision.settlement.authoritativeOutcome, 'draw');
            assert.equal(decision.settlement.winnerName, undefined);
        }
        assert.deepEqual(derivePetRankedSettlement(draw, 'alpha', 'win'), {
            ok: false,
            reason: 'conflicting-client-outcome',
        });

        const store = _makeMemoryKv();
        await store.set('save:alpha', rankedSave('alpha'));
        const settled = await settlePetRankedSide(store, settlementInput('alpha', 'draw'));
        assert.equal(settled.status, 'settled');
        const saved = await store.get<Record<string, any>>('save:alpha');
        assert.equal(saved?.character.petRankedRating, 1000);
        assert.equal(saved?.character.petRankedWins, 0);
        assert.equal(saved?.character.petRankedLosses, 0);
        assert.equal(saved?.character.pets[0].loadout.consumable, undefined);
        assert.equal(saved?.character.serverSettlementReceipts.length, 1);
    });

    it('derives a stable bounded in-save receipt id without storing the raw token', () => {
        const id = petRankedSettlementId(MATCH_TOKEN);
        assert.match(id ?? '', /^pet-ranked-[a-f0-9]{48}$/);
        assert.equal(id, petRankedSettlementId(MATCH_TOKEN));
        assert.equal(id?.includes(MATCH_TOKEN), false);
        assert.equal(petRankedSettlementId('short'), null);
    });

    it('commits Elo, consumable cleanup, and receipt together and replays once', async () => {
        const store = _makeMemoryKv();
        await store.set('save:alpha', rankedSave('alpha'));

        const first = await settlePetRankedSide(store, settlementInput('alpha', 'winner'));
        assert.equal(first.status, 'settled');
        const afterFirst = await store.get<Record<string, any>>('save:alpha');
        assert.equal(afterFirst?.character.petRankedRating, 1012);
        assert.equal(afterFirst?.character.petRankedWins, 1);
        assert.equal(afterFirst?.character.pets[0].loadout.consumable, undefined);
        assert.equal(afterFirst?.character.pets[0].loadout.passive, 'guard');
        assert.equal(afterFirst?.character.serverSettlementReceipts.length, 1);

        const replay = await settlePetRankedSide(store, settlementInput('alpha', 'winner'));
        assert.equal(replay.status, 'replay');
        const afterReplay = await store.get<Record<string, any>>('save:alpha');
        assert.equal(afterReplay?.character.petRankedRating, 1012);
        assert.equal(afterReplay?.character.petRankedWins, 1);
        assert.equal(afterReplay?.character.serverSettlementReceipts.length, 1);
    });

    it('requires the exact dedicated stamp schema before trusting a replay', async () => {
        const store = _makeMemoryKv();
        await store.set('save:alpha', rankedSave('alpha'));
        assert.equal((await settlePetRankedSide(store, settlementInput('alpha', 'winner'))).status, 'settled');
        const committed = await store.get<Record<string, any>>('save:alpha');
        const validStamp = structuredClone(committed?.character.petRankedSettlementStamp);
        assert.ok(validStamp);

        const malformed = [
            { ...validStamp, clientOutcome: 'win' },
            { ...validStamp, rating: { ...validStamp.rating, bonus: 999 } },
            { ...validStamp, rating: { ...validStamp.rating, value: 1012.5 } },
            { ...validStamp, settledAt: 0 },
        ];
        for (const stamp of malformed) {
            const tampered = structuredClone(committed!);
            tampered.character.petRankedSettlementStamp = stamp;
            await store.set('save:alpha', tampered);
            const replay = await settlePetRankedSide(store, settlementInput('alpha', 'winner'));
            assert.equal(replay.status, 'invalid-receipts');
            assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedRating, 1012);
        }

        const stampOnly = structuredClone(committed!);
        stampOnly.character.petRankedSettlementStamp = validStamp;
        stampOnly.character.serverSettlementReceipts = [];
        await store.set('save:alpha', stampOnly);
        assert.equal((await settlePetRankedSide(store, settlementInput('alpha', 'winner'))).status, 'replay');
        assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedWins, 1);
    });

    it('recovers when the save write fails before commit because no orphan receipt exists', async () => {
        const store = _makeMemoryKv();
        await store.set('save:alpha', rankedSave('alpha'));
        const failing = failOneSaveCompareSet(store, 'save:alpha', false);

        await assert.rejects(
            settlePetRankedSide(failing, settlementInput('alpha', 'winner')),
            /save-write-failed/,
        );
        const afterFailure = await store.get<Record<string, any>>('save:alpha');
        assert.equal(afterFailure?.character.petRankedRating, 1000);
        assert.equal(afterFailure?.character.serverSettlementReceipts, undefined);

        const retry = await settlePetRankedSide(store, settlementInput('alpha', 'winner'));
        assert.equal(retry.status, 'settled');
        assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedRating, 1012);
    });

    it('treats a lost acknowledgement after commit as replay instead of double credit', async () => {
        const store = _makeMemoryKv();
        await store.set('save:alpha', rankedSave('alpha'));
        const lostAck = failOneSaveCompareSet(store, 'save:alpha', true);
        const outcome = await settlePetRankedSide(lostAck, settlementInput('alpha', 'winner'));
        assert.equal(outcome.status, 'settled');
        const committed = await store.get<Record<string, any>>('save:alpha');
        assert.equal(committed?.character.petRankedRating, 1012);
        assert.equal(committed?.character.serverSettlementReceipts.length, 1);

        const retry = await settlePetRankedSide(store, settlementInput('alpha', 'winner'));
        assert.equal(retry.status, 'replay');
        const final = await store.get<Record<string, any>>('save:alpha');
        assert.equal(final?.character.petRankedRating, 1012);
        assert.equal(final?.character.petRankedWins, 1);
    });

    it('recovers the loser independently after a partial two-save settlement', async () => {
        const store = _makeMemoryKv();
        await store.set('save:alpha', rankedSave('alpha'));
        await store.set('save:bravo', rankedSave('bravo'));

        assert.equal((await settlePetRankedSide(store, settlementInput('alpha', 'winner'))).status, 'settled');
        const failLoser = failOneSaveCompareSet(store, 'save:bravo', false);
        await assert.rejects(
            settlePetRankedSide(failLoser, settlementInput('bravo', 'loser')),
            /save-write-failed/,
        );

        assert.equal((await settlePetRankedSide(store, settlementInput('alpha', 'winner'))).status, 'replay');
        assert.equal((await settlePetRankedSide(store, settlementInput('bravo', 'loser'))).status, 'settled');
        assert.equal((await store.get<Record<string, any>>('save:alpha'))?.character.petRankedRating, 1012);
        assert.equal((await store.get<Record<string, any>>('save:bravo'))?.character.petRankedRating, 988);
    });
});
