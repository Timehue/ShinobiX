/*
 * Showdown AI team generation — the sparring levelling rule.
 *
 * The default (arena, chosen-tier practice) stands the whole AI team at the
 * player team's AVERAGE level. Sparring mirrors levels SLOT FOR SLOT, which is
 * the whole reason the mode is worth practising in: a roster of Lv 9 / Lv 7 /
 * Lv 4 / Lv 1 averaged to one number gives the Lv 1 an unwinnable fight and the
 * Lv 9 a free one. Both shapes are pinned here because the mirrored path is an
 * OPTION on a hot function — the easy regression is it quietly becoming the
 * default and moving arena difficulty with it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildColosseumAiTeam, buildShowdownAiTeam, chooseShowdownAiCommands } from './ai.js';
import { createShowdownSession, sealShowdownPet } from './engine.js';
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
                actor.hp = Math.round(actor.maxHp * 0.2);
                actor.moves = [{ ...actor.moves[0], kind: 'heal', cls: 'status', power: 60, cost: 10 }];
                const [command] = chooseShowdownAiCommands(session, side);
                if (command.kind === 'move' && command.targetId === actor.id) heals++;
            }
            assert.ok(heals >= 16, `${side} must recognize its own wounded ally`);
        }
    });
});
