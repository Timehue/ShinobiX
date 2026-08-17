/*
 * The player-challenge pet duel — one fight, one verdict, both participants.
 *
 * What these pin is the property the old path did not have: a challenge decides
 * ONE fight. Each client used to call /api/pet/battle-start for itself, get its
 * own `randomInt` seed and its own sealed outcome, and be rated on a fight the
 * other player never saw. Both could be told they had won.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isPvpPetDuelSeal,
    pvpPetDuelOutcomeFor,
    pvpSettlementSnapshot,
    resolvePvpPetDuel,
    sealChallengedPets,
    type PvpPetDuelSeal,
} from './_pvp-duel.js';
import { parseSealedPetSnapshots } from './_casual-pve-seal.js';
import type { Pet } from '../_pet-sim/pet-types.js';

function mkPet(id: string, over: Record<string, unknown> = {}): Pet {
    return {
        id, name: id, rarity: 'standard', level: 30, hp: 800, attack: 120, defense: 90, speed: 60,
        element: 'Fire', role: 'tracker', unlockedForPve: true,
        jutsus: [
            { name: 'Jab', power: 90, cooldown: 1, currentCooldown: 0, kind: 'damage' },
            { name: 'Bolt', power: 140, cooldown: 2, currentCooldown: 0, kind: 'damage' },
        ],
        ...over,
    } as unknown as Pet;
}

function mkSeal(over: Partial<PvpPetDuelSeal> = {}): PvpPetDuelSeal {
    return {
        challengeId: 'chal-1',
        a: 'Akemi', b: 'Boro',
        aPets: [mkPet('a0')], bPets: [mkPet('b0')],
        format: '1v1',
        seed: 90210,
        sealedAt: 0,
        ...over,
    };
}

test('the same seal re-derives the same verdict AND the same log, for either participant', () => {
    // Both players fetch this independently, on their own schedule, possibly
    // minutes apart. If the derivation drifted they would watch different
    // fights — which is precisely the bug being closed.
    const seal = mkSeal();
    const first = resolvePvpPetDuel(seal);
    const second = resolvePvpPetDuel(JSON.parse(JSON.stringify(seal)) as PvpPetDuelSeal);
    assert.equal(first.winnerName, second.winnerName);
    assert.deepEqual(first.script, second.script);
});

test('the verdict names an account, and the two sides read opposite outcomes off it', () => {
    const seal = mkSeal();
    const { winnerName } = resolvePvpPetDuel(seal);
    assert.ok(winnerName === seal.a || winnerName === seal.b, 'the judge always decides');
    const forA = pvpPetDuelOutcomeFor(seal, seal.a, winnerName);
    const forB = pvpPetDuelOutcomeFor(seal, seal.b, winnerName);
    assert.ok(forA && forB);
    assert.notEqual(forA, forB, 'exactly one of them won');
    assert.equal(winnerName === seal.a ? forA : forB, 'win');
});

test('a name that is not in the duel gets no outcome at all', () => {
    const seal = mkSeal();
    assert.equal(pvpPetDuelOutcomeFor(seal, 'Nobody', seal.a), null);
});

test('the format is the one the players agreed to — 1v1 fields one pet, with no bench fill', () => {
    // WAR_DUEL_FORMAT's forced 2v2-plus-bench is a ruling about war duels, where
    // the roster that arrived was an accident of the submission flow. Filling
    // three more pets in behind a champion two players agreed to send would be a
    // different match than the one they consented to.
    const solo = resolvePvpPetDuel(mkSeal({ format: '1v1' }));
    assert.equal(solo.script.initialState.player.length, 1);

    const pair = resolvePvpPetDuel(mkSeal({
        format: '2v2',
        aPets: [mkPet('a0'), mkPet('a1')],
        bPets: [mkPet('b0'), mkPet('b1')],
    }));
    assert.equal(pair.script.initialState.player.length, 2);
    assert.equal(pair.script.initialState.player.filter((p) => p.benched).length, 0);
});

test('a seal is rejected unless it carries exactly the pets its format fields', () => {
    assert.ok(isPvpPetDuelSeal(mkSeal()));
    assert.ok(!isPvpPetDuelSeal({ ...mkSeal(), format: '3v3' }), 'a challenge is never 3v3');
    assert.ok(!isPvpPetDuelSeal({ ...mkSeal(), format: '2v2' }), 'two-pet format needs two pets a side');
    assert.ok(!isPvpPetDuelSeal({ ...mkSeal(), seed: 1.5 }), 'a fractional seed is not a seed');
    assert.ok(!isPvpPetDuelSeal({ ...mkSeal(), b: '' }), 'both participants must be named');
    assert.ok(!isPvpPetDuelSeal(null));
});

test('sealing takes exactly the named pets, refuses a busy one, and clamps to the rarity ceiling', () => {
    const character = {
        pets: [
            mkPet('chosen', { attack: 999999 }),
            mkPet('spare'),
            mkPet('away', { expedition: { endsAt: 1 } }),
        ],
    } as unknown as Record<string, unknown>;

    const sealed = sealChallengedPets(character, ['chosen']);
    assert.ok(sealed, 'the named pet is fielded');
    assert.equal(sealed!.length, 1, 'no roster fill — only what was named');
    assert.equal(sealed![0].id, 'chosen');
    assert.ok(
        Number(sealed![0].attack) < 999999,
        'a tampered save cannot field a giant: stats clamp to the rarity ceiling',
    );

    assert.equal(sealChallengedPets(character, ['away']), null, 'a busy pet is refused, not substituted');
    assert.equal(sealChallengedPets(character, ['ghost']), null, 'an unknown pet id seals nothing');
});

test('the settlement snapshot is one the settlement will actually accept', () => {
    /*
     * This is the shape battle-result reads back off the reward token, and its
     * parser is stricter than it looks: a pet is rejected for merely HAVING an
     * image, bodyImage, training or expedition key — a hosted URL, or a null,
     * is enough. Stripping only inline `data:` art passes every eyeball test and
     * then 409s every single duel settlement.
     */
    const pets = [
        mkPet('p0', {
            image: 'data:image/png;base64,AAAA',
            bodyImage: 'https://cdn/ok.webp',
            training: null,
            expedition: undefined,
            loadout: { consumable: 'soldier-pill', weapon: 'fang' },
        }),
    ];
    const snapshot = pvpSettlementSnapshot(pets);
    assert.deepEqual(
        parseSealedPetSnapshots(snapshot, ['p0']),
        snapshot,
        'the snapshot round-trips through the settlement parser',
    );
    const raw = snapshot[0] as unknown as Record<string, unknown>;
    assert.ok(!('image' in raw) && !('bodyImage' in raw), 'no art keys at all, not even hosted ones');
    assert.ok(!('training' in raw) && !('expedition' in raw), 'no busy-state keys at all, not even null ones');
    assert.equal(
        (raw.loadout as Record<string, unknown>).consumable,
        undefined,
        'the consumable slot is empty: a sealed duel does not fire one, so settlement must not spend one',
    );
    assert.equal((raw.loadout as Record<string, unknown>).weapon, 'fang', 'the rest of the loadout is untouched');
});

test('an inline sprite blob never reaches the seal', () => {
    // The engine reads no art, and a base64 pet is megabytes of stored payload.
    const character = {
        pets: [mkPet('arty', { image: 'data:image/png;base64,AAAA', bodyImage: 'https://cdn/ok.webp' })],
    } as unknown as Record<string, unknown>;
    const sealed = sealChallengedPets(character, ['arty']);
    assert.ok(sealed);
    assert.equal((sealed![0] as unknown as Record<string, unknown>).image, undefined, 'inline blob stripped');
    assert.equal(
        (sealed![0] as unknown as Record<string, unknown>).bodyImage,
        'https://cdn/ok.webp',
        'a hosted URL ref is small and stays',
    );
});
