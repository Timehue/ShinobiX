import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveClanWarPetDuel,
    isReadyToResolve,
    petsPerSide,
    sideOfPlayer,
    normalizeClanWarPetSession,
    clanWarPetSessionKey,
    clanWarPetDeclineMessage,
    CLAN_WAR_PET_DUEL,
    type ClanWarPetSession,
} from './_pet-duel.js';
import type { Pet } from '../../_pet-sim/pet-types.js';

/** A battle-grade pet, mirroring the shape the duel engine expects. */
const mkPet = (id: string, element: string, over: Partial<Record<string, number>> = {}): Pet => ({
    id, name: id, species: id, level: 20,
    hp: 820, attack: 92, defense: 44, speed: 96,
    element, trait: 'Swift',
    jutsus: [
        { name: 'Fang Strike', kind: 'damage', power: 104, cooldown: 1 },
        { name: 'Ember Coil', kind: 'burn', power: 88, cooldown: 3 },
        { name: 'Stone Ward', kind: 'shield', power: 60, cooldown: 4 },
        { name: 'Ruin Fang', kind: 'crush', power: 182, cooldown: 6, signature: true },
    ],
    ...over,
} as unknown as Pet);

function session(over: Partial<ClanWarPetSession> = {}): ClanWarPetSession {
    return {
        warId: 'war-1', challengeId: 'ch-1', mode: 'pet1v1', seed: 12345,
        from: [{ name: 'aria', pet: mkPet('brand', 'fire') }],
        to: [{ name: 'kell', pet: mkPet('tide', 'water') }],
        status: 'awaiting-pets', consumablesCharged: false, createdAt: 0, updatedAt: 0,
        ...over,
    };
}

describe('resolveClanWarPetDuel — determinism (the whole point)', () => {
    it('is stable across repeated runs of the same inputs', () => {
        const s = session();
        const first = resolveClanWarPetDuel(s);
        for (let i = 0; i < 5; i++) {
            assert.equal(resolveClanWarPetDuel(s), first, 'same pets + seed must always give the same winner');
        }
    });

    it('always returns a valid challenge result', () => {
        for (const seed of [1, 7, 99, 4242, 987654]) {
            const r = resolveClanWarPetDuel(session({ seed }));
            assert.ok(['from-wins', 'to-wins', 'draw'].includes(r), `seed ${seed} → ${r}`);
        }
    });

    it('is decided by the seed, not by submission order of equal pets', () => {
        // Identical stat-lines: the seed is what separates them, so the outcome must
        // not silently favour whoever submitted first across every seed.
        const mirror = (seed: number) => resolveClanWarPetDuel(session({
            seed,
            from: [{ name: 'a', pet: mkPet('twin', 'fire') }],
            to: [{ name: 'b', pet: mkPet('twin', 'fire') }],
        }));
        const results = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(mirror));
        assert.ok(results.size > 1, 'a mirror matchup must not resolve identically for every seed');
    });

    it('a decisively stronger side wins across most seeds', () => {
        const strong = mkPet('titan', 'fire', { hp: 3000, attack: 400, defense: 300, speed: 200 });
        const weak = mkPet('mote', 'fire', { hp: 200, attack: 10, defense: 5, speed: 20 });
        let wins = 0;
        const seeds = [3, 11, 29, 57, 88, 131, 404, 909];
        for (const seed of seeds) {
            if (resolveClanWarPetDuel(session({
                seed,
                from: [{ name: 'a', pet: strong }],
                to: [{ name: 'b', pet: weak }],
            })) === 'from-wins') wins++;
        }
        assert.ok(wins >= seeds.length - 1, `overwhelming favourite won ${wins}/${seeds.length}`);
    });

    it('swapping the sides swaps the winner (no side bias in the mapping)', () => {
        const strong = mkPet('titan', 'fire', { hp: 3000, attack: 400, defense: 300, speed: 200 });
        const weak = mkPet('mote', 'fire', { hp: 200, attack: 10, defense: 5, speed: 20 });
        const seed = 2026;
        const strongFrom = resolveClanWarPetDuel(session({ seed, from: [{ name: 'a', pet: strong }], to: [{ name: 'b', pet: weak }] }));
        const strongTo = resolveClanWarPetDuel(session({ seed, from: [{ name: 'a', pet: weak }], to: [{ name: 'b', pet: strong }] }));
        assert.equal(strongFrom, 'from-wins');
        assert.equal(strongTo, 'to-wins');
    });

    it('resolves a 2v2 party duel', () => {
        const r = resolveClanWarPetDuel(session({
            mode: 'pet2v2',
            from: [{ name: 'a', pet: mkPet('one', 'fire') }, { name: 'a2', pet: mkPet('two', 'earth') }],
            to: [{ name: 'b', pet: mkPet('three', 'water') }, { name: 'b2', pet: mkPet('four', 'wind') }],
        }));
        assert.ok(['from-wins', 'to-wins', 'draw'].includes(r));
    });

    it('pins the duel parameters the client replay must mirror', () => {
        // Drift here silently desyncs the animated fight from the recorded result.
        assert.deepEqual({ ...CLAN_WAR_PET_DUEL }, {
            damageMult: 1, hpMult: 1, reviveOnce: false, applyItems: false, accuracy: true, terrain: null,
        });
    });

    it('keeps a sealed PvP consumable inert in an asynchronous garrison duel', () => {
        const plain = mkPet('guard', 'earth');
        const equipped = {
            ...plain,
            loadout: { pvp: 'pvp-ironhide-barding', consumable: 'consum-second-wind' },
        } as Pet;
        for (const seed of [1, 7, 29, 88, 233, 987, 4_242, 65_537]) {
            const withoutItems = resolveClanWarPetDuel(session({
                seed,
                from: [{ name: 'a', pet: plain }],
            }));
            const withForgedOrSealedItems = resolveClanWarPetDuel(session({
                seed,
                from: [{ name: 'a', pet: equipped }],
            }));
            assert.equal(withForgedOrSealedItems, withoutItems, `seed ${seed}`);
        }
    });
});

describe('session readiness', () => {
    it('needs one pet per side for 1v1 and two for 2v2', () => {
        assert.equal(petsPerSide('pet1v1'), 1);
        assert.equal(petsPerSide('pet2v2'), 2);
    });

    it('is not ready until BOTH sides are full', () => {
        const from = [{ name: 'a', pet: mkPet('x', 'fire') }];
        const to = [{ name: 'b', pet: mkPet('y', 'water') }];
        assert.equal(isReadyToResolve({ mode: 'pet1v1', from, to: [] }), false);
        assert.equal(isReadyToResolve({ mode: 'pet1v1', from: [], to }), false);
        assert.equal(isReadyToResolve({ mode: 'pet1v1', from, to }), true);
        // 2v2 needs the full pair on each side.
        assert.equal(isReadyToResolve({ mode: 'pet2v2', from: [...from, ...from], to }), false);
        assert.equal(isReadyToResolve({ mode: 'pet2v2', from: [...from, ...from], to: [...to, ...to] }), true);
    });
});

describe('sideOfPlayer', () => {
    const ch = { fromPlayer: 'Aria', fromPlayer2: 'Ash', acceptedPlayer: 'Kell', acceptedPlayer2: 'Rin' };
    it('places each named participant on the right side, case-insensitively', () => {
        assert.equal(sideOfPlayer('aria', ch), 'from');
        assert.equal(sideOfPlayer('ASH', ch), 'from');
        assert.equal(sideOfPlayer(' kell ', ch), 'to');
        assert.equal(sideOfPlayer('Rin', ch), 'to');
    });
    it('returns null for a non-participant (they cannot field a pet)', () => {
        assert.equal(sideOfPlayer('stranger', ch), null);
        assert.equal(sideOfPlayer('', ch), null);
    });
});

describe('normalizeClanWarPetSession', () => {
    it('round-trips a valid session', () => {
        const s = session({ status: 'done', winner: 'from-wins' });
        const n = normalizeClanWarPetSession(s);
        assert.equal(n?.status, 'done');
        assert.equal(n?.winner, 'from-wins');
        assert.equal(n?.from.length, 1);
    });

    it('rejects a session with no ids', () => {
        assert.equal(normalizeClanWarPetSession(null), null);
        assert.equal(normalizeClanWarPetSession({ warId: '', challengeId: 'c' }), null);
        assert.equal(normalizeClanWarPetSession({ warId: 'w', challengeId: '  ' }), null);
    });

    it('drops fighters with no pet and caps each side at the mode size', () => {
        const n = normalizeClanWarPetSession({
            warId: 'w', challengeId: 'c', mode: 'pet1v1',
            from: [{ name: 'a' }, { name: 'b', pet: mkPet('x', 'fire') }] as never,
            to: [
                { name: 'c', pet: mkPet('y', 'water') },
                { name: 'd', pet: mkPet('z', 'wind') },
            ] as never,
        });
        assert.equal(n?.from.length, 1, 'the pet-less entry is dropped');
        assert.equal(n?.to.length, 1, 'a 1v1 side cannot hold two pets');
    });

    it('defaults an unknown mode to 1v1 rather than trusting the blob', () => {
        const n = normalizeClanWarPetSession({ warId: 'w', challengeId: 'c', mode: 'pet9v9' as never });
        assert.equal(n?.mode, 'pet1v1');
    });

    it('cannot normalize forged item-charge metadata into an async session', () => {
        const n = normalizeClanWarPetSession({
            ...session(),
            consumablesCharged: true as never,
        });
        assert.equal(n?.consumablesCharged, false);
    });
});

describe('keys and messages', () => {
    it('scopes a session to its war AND challenge', () => {
        assert.equal(clanWarPetSessionKey('w1', 'c1'), 'clan-war-pet:w1:c1');
        assert.notEqual(clanWarPetSessionKey('w1', 'c1'), clanWarPetSessionKey('w1', 'c2'));
    });
    it('has a player-facing message for every decline reason', () => {
        for (const r of ['not-a-pet-mode', 'not-a-participant', 'side-already-full', 'already-submitted', 'duel-already-resolved', 'no-pet'] as const) {
            assert.ok(clanWarPetDeclineMessage(r).length > 10, r);
        }
    });
});
