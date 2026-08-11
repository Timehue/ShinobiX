import assert from 'node:assert/strict';
import test from 'node:test';
import { GAUNTLET_POOL } from '../_pet-sim/_gauntlet-pool.js';
import {
    buildWarfrontAiTeam,
    normalizeWarfrontPlayerTeam,
    warfrontAiWarband,
    WARFRONT_AI_WARBAND_VERSION,
} from './_warfront-ai.js';

const roles = ['defender', 'tracker', 'assassin', 'sage'] as const;

test('seed-sealed Warfront profiles use four distinct approved roster pets', () => {
    const allIds = new Set<string>();
    for (const seed of [0, 1, 2]) {
        const scout = warfrontAiWarband(seed);
        const team = buildWarfrontAiTeam(4, seed);
        assert.equal(scout.version, WARFRONT_AI_WARBAND_VERSION);
        assert.equal(team.length, 4);
        assert.equal(new Set(team.map((pet) => pet.id)).size, 4, `${scout.id} duplicated a fighter`);
        assert.deepEqual(team.map((pet) => pet.role), roles, `${scout.id} must expose one fighter per role`);
        assert.equal(new Set(team.map((pet) => pet.level)).size, 1, `${scout.id} changed reward level by member`);
        assert.equal(team[0].level, 18, `${scout.id} changed the sealed economy level`);
        for (const pet of team) {
            assert.equal(allIds.has(pet.id), false, `${pet.id} was reused across authored warbands`);
            allIds.add(pet.id);
            const canonical = GAUNTLET_POOL.find((entry) => entry.id === pet.id);
            assert.ok(canonical, `${pet.id} is not an approved canonical roster pet`);
            assert.deepEqual(
                { name: pet.name, hp: pet.hp, attack: pet.attack, defense: pet.defense, speed: pet.speed, element: pet.element },
                { name: canonical.name, hp: canonical.hp, attack: canonical.attack, defense: canonical.defense, speed: canonical.speed, element: canonical.element },
            );
        }
    }
    assert.equal(allIds.size, 12);
});

test('authored profile stat budgets stay in the same broad power band', () => {
    const budgets = [0, 1, 2].map((seed) => buildWarfrontAiTeam(4, seed)
        .reduce((sum, pet) => sum + pet.hp / 10 + pet.attack * 2 + pet.defense + pet.speed, 0));
    const low = Math.min(...budgets);
    const high = Math.max(...budgets);
    assert.ok(low / high >= 0.75, `warband stat budget spread is too wide: ${budgets.join(', ')}`);
});

test('warband selection is deterministic and count never cycles duplicates', () => {
    for (const seed of [1, 7, 42, 99_999, 0x7fffffff]) {
        assert.deepEqual(buildWarfrontAiTeam(4, seed), buildWarfrontAiTeam(4, seed));
        assert.deepEqual(warfrontAiWarband(seed), warfrontAiWarband(seed));
        for (const count of [1, 2, 3, 4]) {
            const team = buildWarfrontAiTeam(count, seed);
            assert.equal(team.length, count);
            assert.equal(new Set(team.map((pet) => pet.id)).size, count);
        }
    }
});

test('rookie pacing normalization is authoritative, bounded, and leaves durable stats untouched', () => {
    const source = GAUNTLET_POOL.slice(0, 4).map((pet) => ({
        ...pet,
        element: (pet.element ?? 'None') as 'Fire',
        level: 1,
        xp: 0,
        maxLevel: 100,
        unlockedForPve: false,
        jutsus: pet.jutsus.map((jutsu) => ({ ...jutsu, kind: jutsu.kind as 'damage', currentCooldown: 0 })),
    }));
    const before = structuredClone(source);
    const normalized = normalizeWarfrontPlayerTeam(source);
    const average = (field: 'attack' | 'speed') => normalized.reduce((sum, pet) => sum + Number(pet[field]), 0) / normalized.length;
    assert.ok(average('attack') >= 79.5 && average('speed') >= 51.5);
    assert.deepEqual(source, before, 'combat-only pacing must not mutate the saved roster');
    assert.deepEqual(
        normalized.map((pet) => ({ hp: pet.hp, defense: pet.defense, level: pet.level, jutsus: pet.jutsus })),
        source.map((pet) => ({ hp: pet.hp, defense: pet.defense, level: pet.level, jutsus: pet.jutsus })),
        'normalization may change only attack and movement pacing axes',
    );
});
