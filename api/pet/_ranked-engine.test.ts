import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { petJutsuPowerCeil, petStatCeil } from '../_pet-stat-ceil.js';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import {
    chooseAuthoritativeRankedPet,
    claimPetRankedActivePair,
    claimPetRankedStartingPair,
    commitPetRankedStartingPair,
    petRankedActiveKey,
    releasePetRankedActivePair,
    releasePetRankedStartingPair,
    resolveAuthoritativePetRankedMatch,
    snapshotPetForRanked,
    validateReciprocalPetRankedQueueMatch,
    PET_RANKED_TOKEN_TTL_SECONDS,
} from './_ranked-engine.js';

const MATCH_A = 'a'.repeat(32);
const MATCH_B = 'b'.repeat(32);

const pet = (id: string, patch: Record<string, unknown> = {}) => ({
    id,
    name: id,
    rarity: 'standard',
    level: 20,
    hp: 500,
    attack: 65,
    defense: 42,
    speed: 50,
    element: 'Fire',
    jutsus: [{ name: 'Fang', power: 90, cooldown: 2, kind: 'damage' }],
    loadout: { pvp: 'guard-vest', consumable: 'pet-tonic' },
    ...patch,
});

describe('private ranked pet engine', () => {
    it('selects only entitlement-carried, ready pets in server priority order', () => {
        const character = {
            name: 'alpha',
            activePetId: 'p1',
            pets: [
                pet('p1', { training: { endsAt: 1 } }),
                pet('p2'),
                pet('p3'),
                pet('overflow-p4', { level: 100 }),
            ],
        };
        const choice = chooseAuthoritativeRankedPet(character, 100);
        assert.equal(choice.ok, true);
        if (choice.ok) assert.equal(choice.pet.id, 'p2');

        const busy = chooseAuthoritativeRankedPet({
            ...character,
            pets: [
                pet('p1', { training: { endsAt: 1 } }),
                pet('p2', { expedition: { endsAt: 1 } }),
                pet('p3', { training: { endsAt: 1 } }),
                pet('overflow-p4'),
            ],
        }, 100);
        assert.deepEqual(busy, { ok: false, reason: 'all-entitled-pets-busy' });
    });

    it('bounds legacy/corrupt combat snapshots before simulation', () => {
        const snapshot = snapshotPetForRanked(pet('bounded', {
            hp: 999_999,
            attack: 999_999,
            defense: 999_999,
            speed: 999_999,
            jutsus: [{ name: 'Forged', power: 999_999, cooldown: -50, kind: 'not-real' }],
            loadout: { pvp: 'x'.repeat(500), consumable: 'y'.repeat(500) },
        }));
        assert.ok(snapshot);
        assert.equal(snapshot.hp, petStatCeil('standard', 'hp'));
        assert.equal(snapshot.attack, petStatCeil('standard', 'attack'));
        assert.equal(snapshot.defense, petStatCeil('standard', 'defense'));
        assert.equal(snapshot.speed, petStatCeil('standard', 'speed'));
        assert.equal(snapshot.jutsus[0].power, petJutsuPowerCeil('standard'));
        assert.equal(snapshot.jutsus[0].cooldown, 0);
        assert.equal(snapshot.jutsus[0].kind, 'damage');
        assert.equal(snapshot.loadout?.pvp?.length, 80);
        assert.equal(snapshot.loadout?.consumable?.length, 80);
    });

    it('replays deterministically and seals the winner plus rating reward in its digest', () => {
        const aPet = snapshotPetForRanked(pet('alpha-pet'))!;
        const bPet = snapshotPetForRanked(pet('bravo-pet', { element: 'Water', attack: 63 }))!;
        const input = {
            matchId: MATCH_A,
            a: 'Alpha',
            b: 'Bravo',
            aCharacter: { petRankedRating: 1025 },
            bCharacter: { petRankedRating: 975 },
            aPet,
            bPet,
            seed: 123456,
            now: 1_750_000_000_000,
        };
        const first = resolveAuthoritativePetRankedMatch(input);
        const replay = resolveAuthoritativePetRankedMatch(input);
        assert.deepEqual(replay, first);
        assert.equal(first.a, 'alpha');
        assert.equal(first.b, 'bravo');
        assert.match(first.resolution.engineDigest, /^[a-f0-9]{64}$/);
        assert.equal(first.resolution.reward.ryo, 0);
        assert.equal(first.resolution.reward.aDelta + first.resolution.reward.bDelta, 0);
        assert.ok(['a', 'b', 'draw'].includes(first.resolution.winner));
    });

    it('requires reciprocal, fresh queue records with the same server match id', () => {
        const now = 10_000;
        const mine = { matchId: MATCH_A, opponent: 'bravo', opponentElo: 1000, opponentLevel: 20, initiator: true, createdAt: now };
        const theirs = { matchId: MATCH_A, opponent: 'alpha', opponentElo: 1000, opponentLevel: 20, initiator: false, createdAt: now };
        assert.deepEqual(validateReciprocalPetRankedQueueMatch('alpha', mine, theirs, now), {
            ok: true,
            matchId: MATCH_A,
            opponent: 'bravo',
        });
        assert.equal(validateReciprocalPetRankedQueueMatch('alpha', mine, { ...theirs, matchId: MATCH_B }, now).ok, false);
        assert.equal(validateReciprocalPetRankedQueueMatch('alpha', mine, { ...theirs, initiator: true }, now).ok, false);
        assert.equal(validateReciprocalPetRankedQueueMatch('alpha', { ...mine, createdAt: 1 }, { ...theirs, createdAt: 1 }, now + 100_000).ok, false);
    });

    it('claims at most one active pair and compare-deletes only its own token', async () => {
        const store = _makeMemoryKv();
        const first = await claimPetRankedActivePair(store, ['alpha', 'bravo'], MATCH_A, 60);
        assert.equal(first.ok, true);
        assert.equal(await store.get(petRankedActiveKey('alpha')), MATCH_A);
        assert.equal(await store.get(petRankedActiveKey('bravo')), MATCH_A);

        const conflict = await claimPetRankedActivePair(store, ['alpha', 'charlie'], MATCH_B, 60);
        assert.deepEqual(conflict, { ok: false, conflictPlayer: 'alpha' });
        assert.equal(await store.get(petRankedActiveKey('charlie')), null);
        await releasePetRankedActivePair(store, ['alpha', 'bravo'], MATCH_B);
        assert.equal(await store.get(petRankedActiveKey('alpha')), MATCH_A, 'wrong token cannot release the lease');
        await releasePetRankedActivePair(store, ['alpha', 'bravo'], MATCH_A);
        assert.equal(await store.get(petRankedActiveKey('alpha')), null);
    });

    it('claims production ranked leases without expiry from the first NX write', async () => {
        const realNow = Date.now;
        let clock = 1_750_000_000_000;
        Date.now = () => clock;
        try {
            const store = _makeMemoryKv();
            const claimed = await claimPetRankedActivePair(store, ['alpha', 'bravo'], MATCH_A);
            assert.equal(claimed.ok, true);
            clock += (PET_RANKED_TOKEN_TTL_SECONDS + 1) * 1_000;
            assert.equal(await store.get(petRankedActiveKey('alpha')), MATCH_A);
            assert.equal(await store.get(petRankedActiveKey('bravo')), MATCH_A);
        } finally {
            Date.now = realNow;
        }
    });

    it('retains the first lease if the second write fails before commit so durable preparation can resume', async () => {
        const base = _makeMemoryKv();
        const secondKey = petRankedActiveKey('bravo');
        const failing: KvLike = {
            ...base,
            async set(key, value, options) {
                if (key === secondKey) throw new Error('second-active-write-failed');
                return base.set(key, value, options);
            },
        };
        await assert.rejects(
            claimPetRankedActivePair(failing, ['alpha', 'bravo'], MATCH_A, 60),
            /second-active-write-failed/,
        );
        assert.equal(await base.get(petRankedActiveKey('alpha')), MATCH_A);
        assert.equal(await base.get(secondKey), null);

        const resumed = await claimPetRankedActivePair(base, ['alpha', 'bravo'], MATCH_A, 60);
        assert.equal(resumed.ok, true);
        assert.equal(await base.get(secondKey), MATCH_A);
    });

    it('recovers a lost acknowledgement after the second lease committed', async () => {
        const base = _makeMemoryKv();
        const secondKey = petRankedActiveKey('bravo');
        let failed = false;
        const lostAck: KvLike = {
            ...base,
            async set(key, value, options) {
                const out = await base.set(key, value, options);
                if (key === secondKey && !failed) {
                    failed = true;
                    throw new Error('lost-active-ack');
                }
                return out;
            },
        };
        const claimed = await claimPetRankedActivePair(lostAck, ['alpha', 'bravo'], MATCH_A, 60);
        assert.equal(claimed.ok, true);
        assert.equal(await base.get(petRankedActiveKey('alpha')), MATCH_A);
        assert.equal(await base.get(secondKey), MATCH_A);
    });

    it('starting intent exact-releases the first key when the second acquisition races a foreign mode', async () => {
        const base = _makeMemoryKv();
        const secondKey = petRankedActiveKey('bravo');
        let raced = false;
        const racing: KvLike = {
            ...base,
            async set(key, value, options) {
                if (key === secondKey && !raced) {
                    raced = true;
                    await base.set(secondKey, 'casual-foreign-token', { ex: 900 });
                    return null;
                }
                return base.set(key, value, options);
            },
        };
        const claimed = await claimPetRankedStartingPair(racing, ['alpha', 'bravo'], MATCH_A);
        assert.equal(claimed.ok, false);
        assert.equal(await base.get(petRankedActiveKey('alpha')), null);
        assert.equal(await base.get(secondKey), 'casual-foreign-token');
    });

    it('retry cleanup releases a preexisting first intent when the second key is foreign', async () => {
        const store = _makeMemoryKv();
        const firstKey = petRankedActiveKey('alpha');
        const secondKey = petRankedActiveKey('bravo');
        const initial = await claimPetRankedStartingPair(store, ['alpha', 'bravo'], MATCH_A);
        assert.equal(initial.ok, true);
        const startingToken = await store.get<string>(firstKey);
        assert.match(String(startingToken), /^pet-ranked-starting:/);
        assert.equal(await store.delIfEqual(secondKey, startingToken as string), true);
        await store.set(secondKey, 'casual-foreign-token', { ex: 900 });

        const retried = await claimPetRankedStartingPair(store, ['alpha', 'bravo'], MATCH_A);
        assert.equal(retried.ok, false);
        assert.equal(await store.get(firstKey), null);
        assert.equal(await store.get(secondKey), 'casual-foreign-token');
    });

    it('cleanup owns an exact first-key NX race and confirms a lost delete acknowledgement', async () => {
        const base = _makeMemoryKv();
        const firstKey = petRankedActiveKey('alpha');
        const secondKey = petRankedActiveKey('bravo');
        await base.set(secondKey, 'casual-foreign-token', { ex: 900 });
        let raced = false;
        let lostDeleteAck = false;
        const racing: KvLike = {
            ...base,
            async set(key, value, options) {
                if (key === firstKey && !raced) {
                    raced = true;
                    await base.set(key, value, options);
                    return null;
                }
                return base.set(key, value, options);
            },
            async delIfEqual(key, expected) {
                const deleted = await base.delIfEqual(key, expected);
                if (key === firstKey && deleted && !lostDeleteAck) {
                    lostDeleteAck = true;
                    throw new Error('lost-starting-cleanup-ack');
                }
                return deleted;
            },
        };

        const claimed = await claimPetRankedStartingPair(racing, ['alpha', 'bravo'], MATCH_A);
        assert.equal(claimed.ok, false);
        assert.equal(raced, true);
        assert.equal(lostDeleteAck, true);
        assert.equal(await base.get(firstKey), null);
        assert.equal(await base.get(secondKey), 'casual-foreign-token');
    });

    it('upgrades both reversible starting intents only after economic admission is ready', async () => {
        const store = _makeMemoryKv();
        const starting = await claimPetRankedStartingPair(store, ['alpha', 'bravo'], MATCH_A);
        assert.equal(starting.ok, true);
        assert.match(String(await store.get(petRankedActiveKey('alpha'))), /^pet-ranked-starting:/);
        const committed = await commitPetRankedStartingPair(store, ['alpha', 'bravo'], MATCH_A);
        assert.equal(committed.ok, true);
        assert.equal(await store.get(petRankedActiveKey('alpha')), MATCH_A);
        assert.equal(await store.get(petRankedActiveKey('bravo')), MATCH_A);
        await releasePetRankedStartingPair(store, ['alpha', 'bravo'], MATCH_A);
        assert.equal(await store.get(petRankedActiveKey('alpha')), MATCH_A, 'starting cleanup cannot erase committed ranked ownership');
    });
});
