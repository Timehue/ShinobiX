/*
 * Showdown AI team generation — the sparring levelling rule.
 *
 * The authored campaign builder stands the whole AI team at the
 * player team's AVERAGE level. Sparring mirrors levels SLOT FOR SLOT, which is
 * the whole reason the mode is worth practising in: a roster of Lv 9 / Lv 7 /
 * Lv 4 / Lv 1 averaged to one number gives the Lv 1 an unwinnable fight and the
 * Lv 9 a free one. Both shapes are pinned here because the mirrored path is an
 * OPTION on a hot function — the easy regression is it quietly becoming the
 * default and moving authored campaign difficulty with it. Colosseum uses
 * strongest-first slot matching to resist low-level bench dilution.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildColosseumAiTeam, buildShowdownAiTeam, chooseShowdownAiCommands } from './ai.js';
import { createShowdownSession, estimateShowdownMoveDamage, sealShowdownPet } from './engine.js';
import { PET_CATALOG } from '../pet/_catalog.js';
import { normalizePetGrowth } from '../pet/_growth.js';
import type { Pet } from '../_pet-sim/pet-types.js';

function pet(id: string, level: number): Pet {
    return {
        id, name: `Pet ${id}`, element: 'Fire', role: 'assassin', rarity: 'standard',
        level, hp: 400, attack: 50, defense: 30, speed: 35,
        jutsus: [{ name: 'Ember Jab', power: 90, kind: 'damage' }],
    } as unknown as Pet;
}

// Deliberately lopsided: the average (5) matches none of them, so an averaged
// team and a mirrored team can never be confused for one another.
const LOPSIDED = [pet('a', 9), pet('b', 7), pet('c', 4), pet('d', 1)];

describe('buildShowdownAiTeam', () => {
    it('fields exactly as many pets as asked for', () => {
        for (const size of [1, 2, 3, 4]) {
            const { pets } = buildShowdownAiTeam(LOPSIDED.slice(0, size), size, 'scrapper', 12345);
            assert.equal(pets.length, size, `${size} player pets must face ${size} opponents`);
        }
    });

    it('stands the team at the AVERAGE level by default', () => {
        const { pets } = buildShowdownAiTeam(LOPSIDED, LOPSIDED.length, 'warrior', 999);
        // (9 + 7 + 4 + 1) / 4 = 5.25 → 5
        for (const p of pets) assert.equal(p.level, 5, 'every default opponent stands at the team average');
    });

    it('mirrors the player levels slot-for-slot when sparring', () => {
        const { pets } = buildShowdownAiTeam(LOPSIDED, LOPSIDED.length, 'warrior', 999, { mirrorLevels: true });
        assert.deepEqual(pets.map((p) => p.level), [9, 7, 4, 1]);
    });

    it('scales each mirrored opponent from its OWN level, not the average', () => {
        // A level-matched fight is only level-matched if the statline follows the
        // level. If growth stayed pinned to the average, the Lv 1 slot would meet
        // a Lv 1 nameplate wearing Lv 5 stats.
        const { pets } = buildShowdownAiTeam(LOPSIDED, LOPSIDED.length, 'warrior', 999, { mirrorLevels: true });
        const [top, , , bottom] = pets;
        assert.ok(Number(top.hp) > Number(bottom.hp), 'the Lv 9 slot must out-stat the Lv 1 slot');
        assert.ok(Number(top.attack) > Number(bottom.attack));
    });

    it('falls back to the average for a slot with no player pet behind it', () => {
        const { pets } = buildShowdownAiTeam([pet('a', 20)], 3, 'scrapper', 7, { mirrorLevels: true });
        assert.deepEqual(pets.map((p) => p.level), [20, 20, 20], 'slots past the roster take the average');
    });

    it('clamps a corrupt or out-of-range level into 1..100', () => {
        const junk = [pet('a', 0), pet('b', 4000), { ...pet('c', 1), level: undefined } as unknown as Pet];
        const { pets } = buildShowdownAiTeam(junk, junk.length, 'scrapper', 3, { mirrorLevels: true });
        for (const p of pets) {
            assert.ok(Number(p.level) >= 1 && Number(p.level) <= 100, `level ${p.level} out of range`);
        }
    });

    it('gives every opponent a real moveset off its catalog species', () => {
        // The AI is meant to fight like a player's pet, not like a statline. Its
        // kit is whatever the species ships, sealed through the same
        // sealShowdownPet path the player's team takes.
        const { pets } = buildShowdownAiTeam(LOPSIDED, 4, 'warrior', 88, { mirrorLevels: true });
        for (const p of pets) {
            const moves = (p as unknown as { jutsus?: unknown[] }).jutsus;
            assert.ok(Array.isArray(moves) && moves.length > 0, `${p.id} fields no moves`);
            assert.ok(p.templateId, `${p.id} carries no templateId — the client cannot resolve its model`);
        }
    });

    // The matching "every AI-drawable species has an approved 3D model" guard
    // lives client-side, in shinobij.client/src/lib/pet-showdown-identity.test
    // .ts. It has to: the approved roster is a CLIENT module, and importing it
    // from here drags the client's ESM sources into the server's CommonJS build
    // (`tsc -p tsconfig.cpanel.json`), which fails the build even though tsx
    // runs the test happily. The two pools are held equal by the existing pet
    // catalog parity test.

    it('stays deterministic for a seed — the engine replays from one', () => {
        const a = buildShowdownAiTeam(LOPSIDED, 4, 'champion', 4242, { mirrorLevels: true });
        const b = buildShowdownAiTeam(LOPSIDED, 4, 'champion', 4242, { mirrorLevels: true });
        assert.deepEqual(a.pets.map((p) => p.id), b.pets.map((p) => p.id));
        assert.equal(a.teamName, b.teamName);
    });
});

describe('Colosseum progression and AI side ownership', () => {
    it('matches strongest selected pets first without allowing a cheap bench to dilute active rivals', () => {
        const lead = pet('lead', 75);
        const reserve = { ...pet('reserve', 1), rarity: 'mythic' } as Pet;
        const solo = buildColosseumAiTeam([lead], 1, 'champion', 91);
        const team = buildColosseumAiTeam([reserve, lead, pet('middle', 30)], 3, 'champion', 91);
        assert.deepEqual(team.pets.map(p => p.level), [75, 30, 1]);
        assert.deepEqual(team.pets.map(p => p.rarity), ['standard', 'standard', 'mythic']);
        assert.equal(team.pets[0].level, solo.pets[0].level);
        assert.equal(lead.level, 75, 'matching never mutates the chosen roster');
        assert.equal(reserve.level, 1);
    });

    it('uses stable stat strength to resolve equal-level Colosseum slots', () => {
        const weak = pet('weak', 30);
        const strong = { ...pet('strong', 30), hp: 1000, rarity: 'rare' } as Pet;
        const team = buildColosseumAiTeam([weak, strong], 2, 'warrior', 28);
        assert.deepEqual(team.pets.map(p => p.rarity), ['rare', 'standard']);
        const sparring = buildColosseumAiTeam([weak, strong], 2, 'warrior', 28, true);
        assert.deepEqual(sparring.pets.map(p => p.rarity), ['standard', 'rare']);
    });

    it('every practice tier matches roster rarity while preserving its own loadout difficulty', () => {
        const players = [{ ...pet('a', 30), rarity: 'standard' }, { ...pet('b', 30), rarity: 'mythic' }] as Pet[];
        for (const tier of ['scrapper', 'warrior', 'champion'] as const) {
            const team = buildColosseumAiTeam(players, 2, tier, 91);
            assert.deepEqual(team.pets.map(p => p.rarity), players.map(p => p.rarity));
            if (tier === 'scrapper') assert.ok(team.pets.every(p => !p.trait));
            else assert.ok(team.pets.every(p => !!p.trait));
        }
    });
    it('sparring matches spent points and traits without handing untrained pets a trained rival', () => {
        const players = [
            { ...pet('unspent', 100), trait: undefined },
            { ...pet('trained', 100), trait: 'Guardian', growthAllocation: { vitality: 30, power: 10, guard: 20, agility: 9 } },
        ] as Pet[];
        const { pets } = buildColosseumAiTeam(players, 2, 'warrior', 38, true);
        const first = pets[0] as unknown as Record<string, unknown>;
        const second = pets[1] as unknown as Record<string, unknown>;
        assert.equal(first.trait, undefined);
        assert.equal(second.trait, 'Guardian');
        assert.deepEqual(first.growthAllocation, { vitality: 0, power: 0, guard: 0, agility: 0 });
        assert.equal(Object.values(second.growthAllocation as Record<string, number>).reduce((sum, n) => sum + n, 0), 69);
        assert.equal(first.growthPoints, 99);
        assert.equal(second.growthPoints, 30);
    });

    it('matches every sparring slot by level and rarity without duplicate species', () => {
        const players = [
            { ...pet('a', 1), rarity: 'mythic' }, { ...pet('b', 50), rarity: 'standard' },
            { ...pet('c', 100), rarity: 'rare' }, { ...pet('d', 12), rarity: 'legendary' },
            { ...pet('e', 1), rarity: 'standard' },
        ] as Pet[];
        for (let seed = 1; seed <= 24; seed++) {
            const team = buildColosseumAiTeam(players, 5, 'warrior', seed, true);
            assert.deepEqual(team.pets.map(p => [p.level, p.rarity]), players.map(p => [p.level, p.rarity]));
            assert.equal(new Set(team.pets.map(p => p.templateId)).size, 5);
            assert.deepEqual(team, buildColosseumAiTeam(players, 5, 'warrior', seed, true));
        }
    });

    it('a road beast fields its named species in slot 0 without changing the mirror', () => {
        const players = [
            { ...pet('lead', 30), rarity: 'standard' }, { ...pet('b', 50), rarity: 'rare' },
            { ...pet('c', 12), rarity: 'legendary' },
        ] as Pet[];
        const standards = Object.values(PET_CATALOG)
            .filter((tpl) => tpl.rarity === 'standard' && tpl.wildSpawnable !== false && Array.isArray(tpl.jutsus));
        for (let seed = 1; seed <= 24; seed++) {
            const named = String(standards[seed % standards.length].id);
            const plain = buildColosseumAiTeam(players, 3, 'warrior', seed, true);
            const beast = buildColosseumAiTeam(players, 3, 'warrior', seed, true, { leadTemplateId: named });
            assert.equal(beast.pets[0].templateId, named);
            assert.deepEqual(beast.pets.map((p) => [p.level, p.rarity]), plain.pets.map((p) => [p.level, p.rarity]));
            assert.equal(new Set(beast.pets.map((p) => p.templateId)).size, 3);
            assert.deepEqual(beast, buildColosseumAiTeam(players, 3, 'warrior', seed, true, { leadTemplateId: named }));
        }
    });

    it('ignores a named lead from outside the slot-0 rarity, or with no lead named', () => {
        const players = [{ ...pet('lead', 30), rarity: 'standard' }] as Pet[];
        const mythic = Object.values(PET_CATALOG).find((tpl) => tpl.rarity === 'mythic' && tpl.wildSpawnable !== false)!;
        for (let seed = 1; seed <= 12; seed++) {
            const plain = buildColosseumAiTeam(players, 1, 'warrior', seed, true);
            assert.deepEqual(buildColosseumAiTeam(players, 1, 'warrior', seed, true, { leadTemplateId: String(mythic.id) }), plain,
                'a mythic must never stand in a standard rival slot');
            assert.deepEqual(buildColosseumAiTeam(players, 1, 'warrior', seed, true, {}), plain);
        }
    });

    it('seals AI exactly like an owned pet of the same species, trait and allocation', () => {
        for (const level of [1, 25, 50, 100]) for (const tier of ['scrapper', 'warrior', 'champion'] as const) {
            for (const ai of buildColosseumAiTeam([pet('a', level)], 1, tier, 812).pets) {
                const tpl = PET_CATALOG[String(ai.templateId)];
                const owned = normalizePetGrowth({ ...tpl, id: ai.id, templateId: tpl.id, level, trait: ai.trait,
                    loadout: ai.loadout, growthAllocation: (ai as unknown as Record<string, unknown>).growthAllocation },
                    { hp: Number(tpl.hp), attack: Number(tpl.attack), defense: Number(tpl.defense), speed: Number(tpl.speed) });
                assert.deepEqual(sealShowdownPet(ai), sealShowdownPet(owned as unknown as Pet));
                assert.deepEqual(normalizePetGrowth(ai as unknown as Record<string, unknown>), ai, 'growth is idempotent at the combat boundary');
            }
        }
    });

    it('heals only the side being commanded, including headless player-side battles', () => {
        for (const side of ['player', 'enemy'] as const) {
            let heals = 0;
            for (let seed = 1; seed <= 24; seed++) {
                const session = createShowdownSession({ sessionId: 'heal', playerName: 'test', format: '1v1', tier: 'warrior', seed,
                    playerPets: [pet('player', 1)], enemyPets: [pet('enemy', 1)], enemyTeamName: 'AI', rewardEligible: false });
                const actor = session[side][0];
                // Isolate ally ownership from the separate lethal-threat policy.
                const foe = session[side === 'player' ? 'enemy' : 'player'][0];
                foe.moves = [];
                foe.meter = 0;
                actor.hp = Math.round(actor.maxHp * 0.2);
                actor.moves = [{ ...actor.moves[0], kind: 'heal', cls: 'status', power: 60, cost: 10 }];
                const [command] = chooseShowdownAiCommands(session, side);
                if (command.kind === 'move' && command.targetId === actor.id) heals++;
            }
            assert.ok(heals >= 16, `${side} must recognize its own wounded ally`);
        }
    });
});

describe('versioned AI move legality', () => {
    const fixture = (seed: number, level = 19) => {
        const session = createShowdownSession({ sessionId: 'legality', playerName: 'test', format: '1v1', tier: 'warrior', seed,
            playerPets: [pet('player', level)], enemyPets: [pet('enemy', level)], enemyTeamName: 'AI', rewardEligible: false });
        session.rulesetVersion = 'progression-v3';
        const actor = session.enemy[0];
        actor.level = level;
        actor.readiness = 20;
        actor.meter = 100;
        actor.stamina = 100;
        actor.maxStamina = 100;
        const base = actor.moves[0];
        actor.moves = [
            { ...base, name: 'Eligible Strike', kind: 'damage', power: 60, cost: 10, hold: 0, unlockLevel: 1 },
            { ...base, name: 'Future Art', kind: 'damage', power: 1000, cost: 10, hold: 0, unlockLevel: 75 },
            { ...base, name: 'Recovering Art', kind: 'damage', power: 1000, cost: 10, hold: 0, unlockLevel: 5, availableAtRound: 3 },
        ];
        actor.signatureMove = { ...actor.signatureMove, unlockLevel: 20, hold: 0 };
        return session;
    };

    it('never submits a level-locked move, recovering move or early signature', () => {
        for (let seed = 1; seed <= 32; seed++) {
            const session = fixture(seed);
            const [command] = chooseShowdownAiCommands(session);
            assert.equal(command.kind, 'move');
            if (command.kind === 'move') assert.equal(command.moveIndex, 0);
        }
    });

    it('admits a move exactly when the next round reaches its reuse boundary', () => {
        const session = fixture(19, 30);
        session.enemy[0].meter = 0;
        session.round = 1;
        const before = chooseShowdownAiCommands(session)[0];
        assert.equal(before.kind, 'move');
        if (before.kind === 'move') assert.equal(before.moveIndex, 0);
        session.round = 2;
        const boundary = chooseShowdownAiCommands(session)[0];
        assert.equal(boundary.kind, 'move');
        if (boundary.kind === 'move') assert.equal(boundary.moveIndex, 2);
    });

    it('never chooses an unavailable signature placeholder at any earned level', () => {
        for (const level of [20, 75, 100]) for (let seed = 1; seed <= 12; seed++) {
            const session = fixture(seed, level);
            session.enemy[0].signatureMove.abilityId = 'unavailable:signature';
            assert.notEqual(chooseShowdownAiCommands(session)[0].kind, 'super');
        }
    });

    it('retained sessions keep their old unversioned command policy', () => {
        let signatures = 0;
        for (let seed = 1; seed <= 32; seed++) {
            const session = fixture(seed);
            session.rulesetVersion = undefined;
            if (chooseShowdownAiCommands(session)[0].kind === 'super') signatures++;
        }
        assert.ok(signatures >= 20, 'old numeric/version seals must retain the prior AI behavior');
    });
});

describe('new AI threat and finishing decisions', () => {
    const fixture = () => {
        const session = createShowdownSession({ sessionId: 'threat', playerName: 'test', format: '1v1', tier: 'warrior', seed: 51,
            playerPets: [pet('foe', 30)], enemyPets: [pet('actor', 30)], enemyTeamName: 'AI', rewardEligible: false });
        session.rulesetVersion = 'progression-v3';
        const actor = session.enemy[0], foe = session.player[0];
        actor.role = foe.role = 'defender';
        actor.readiness = foe.readiness = 10;
        actor.meter = foe.meter = 0;
        actor.stamina = actor.maxStamina = foe.stamina = foe.maxStamina = 100;
        actor.moves = [
            { ...actor.moves[0], name: 'Direct Strike', kind: 'damage', cls: 'physical', power: 60, cost: 10, hold: 0, unlockLevel: 1 },
            { ...actor.moves[0], name: 'Sky Setup', kind: 'weather', cls: 'status', power: 500, cost: 10, hold: 0, unlockLevel: 5 },
        ];
        foe.moves = [{ ...foe.moves[0], kind: 'damage', cls: 'physical', power: 100, cost: 10, hold: 0, unlockLevel: 1 }];
        return session;
    };

    it('confirms a reachable finish instead of spending the action on setup', () => {
        const session = fixture();
        session.player[0].hp = 1;
        const chosen = chooseShowdownAiCommands(session)[0];
        assert.equal(chosen.kind, 'move');
        if (chosen.kind === 'move') assert.equal(chosen.moveIndex, 0);
    });

    it('uses Guard when an available enemy strike is lethal and guarding survives it', () => {
        const session = fixture();
        const actor = session.enemy[0], foe = session.player[0];
        const incoming = estimateShowdownMoveDamage(session, foe, actor, foe.moves[0]);
        assert.ok(incoming > 0);
        actor.hp = Math.ceil(incoming * 0.75);
        const chosen = chooseShowdownAiCommands(session)[0];
        assert.equal(chosen.kind, 'guard');
    });

    it('strikes rather than setting up when neither Guard nor waiting can save the pet', () => {
        const session = fixture();
        session.enemy[0].hp = 1;
        const chosen = chooseShowdownAiCommands(session)[0];
        assert.equal(chosen.kind, 'move');
        if (chosen.kind === 'move') assert.equal(chosen.moveIndex, 0);
    });

    it('forecasts do not consume the original RNG or a marked target status', () => {
        const session = fixture();
        session.player[0].statuses.push({ kind: 'mark', magnitude: 1, rounds: 2, bornRound: 0 });
        const before = structuredClone(session);
        const a = estimateShowdownMoveDamage(session, session.enemy[0], session.player[0], session.enemy[0].moves[0]);
        const b = estimateShowdownMoveDamage(session, session.enemy[0], session.player[0], session.enemy[0].moves[0]);
        assert.equal(a, b);
        assert.deepEqual(session, before);
    });
});
