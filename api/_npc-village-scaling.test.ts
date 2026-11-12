process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NPC_SCALING_ACTIVE_MS, NPC_SCALING_FLOOR, nextBaseLevel, npcLevelFor, scalingCandidates, trimmedMeanLevel } from './_npc-village-scaling.js';
import { NPC_VILLAGE_ROSTER } from '../shared/npc-village-roster.js';

const NOW = Date.UTC(2026, 10, 8, 3);

test('only public, recently active, non-NPC rows are candidates, highest level first', () => {
    const npc = NPC_VILLAGE_ROSTER[0]!.id;
    const rows: [string, { level: number; lastSeen: number }][] = [
        ['alice', { level: 40, lastSeen: NOW - 1000 }],
        ['bob', { level: 90, lastSeen: NOW - NPC_SCALING_ACTIVE_MS - 1 }], // idle 7 days
        ['admin', { level: 100, lastSeen: NOW }],                           // admin key
        [npc, { level: 100, lastSeen: NOW }],                               // an NPC
        ['carol', { level: 55, lastSeen: NOW - 5000 }],
    ];
    assert.deepEqual(scalingCandidates(rows, NOW).map((c) => c.key), ['carol', 'alice']);
});

test('the mean drops the top three levels so one inflated account cannot drag it', () => {
    const honest = Array.from({ length: 27 }, () => 50);
    assert.equal(trimmedMeanLevel([100, 100, 100, ...honest]), 50);
    assert.equal(trimmedMeanLevel([60, 40]), 50, 'a tiny sample keeps every level');
    assert.equal(trimmedMeanLevel([]), null);
});

test('the base level moves at most three a day and starts at the target', () => {
    assert.equal(nextBaseLevel(null, 47), 47);
    assert.equal(nextBaseLevel(40, 60), 43);
    assert.equal(nextBaseLevel(40, 20), 37);
    assert.equal(nextBaseLevel(40, 41), 41);
    assert.equal(nextBaseLevel(null, null), NPC_SCALING_FLOOR, 'an empty server sits on the floor');
    assert.equal(nextBaseLevel(99, 100), 100);
});

test('rank offsets keep regular NPCs below the top players and clamp to 10..100', () => {
    assert.equal(npcLevelFor('genin', 50), 40);
    assert.equal(npcLevelFor('elite', 50), 50);
    assert.equal(npcLevelFor('kage', 50), 55);
    assert.equal(npcLevelFor('kage', 99), 100);
    // Never a newcomer (below 10 a shinobi cannot be attacked): a low base floors at 10.
    assert.equal(npcLevelFor('genin', 5), 10);
    assert.equal(npcLevelFor('genin', 19), 10);
    assert.equal(npcLevelFor('genin', 21), 11);
});

test('NPC pets follow the median of the top players\' four best pet levels (owner ruling 2026-11-09)', async () => {
    const scaling = await import('./_npc-village-scaling.js');
    // Each player counts their four highest pets only; the pool's median wins.
    assert.equal(scaling.medianTopPetLevel([[60, 50, 40, 30, 1, 1], [20, 20, 20, 20]]), 25);
    assert.equal(scaling.medianTopPetLevel([[9]]), 9);
    assert.equal(scaling.medianTopPetLevel([]), null);
    // The base moves three levels a day at most, and starts at the floor.
    assert.equal(scaling.nextPetBaseLevel(undefined, null), scaling.NPC_PET_SCALING_FLOOR);
    assert.equal(scaling.nextPetBaseLevel(10, 40), 13);
    assert.equal(scaling.nextPetBaseLevel(40, 10), 37);
    // Each rank fields its pets at the pet base plus the rank offset, within 1..100.
    assert.equal(scaling.npcPetLevelFor('genin', 5), 1);
    assert.equal(scaling.npcPetLevelFor('commander', 99), 100);
    assert.equal(scaling.petLevelsOfSave({ character: { pets: [{ level: 12 }, { level: 'x' }, {}] } }).join(), '12');
});

test('a seeded NPC companion is raised to its level with every Growth Point spent', async () => {
    const { grownNpcPet, buildNpcSave, npcPetLevels, NPC_PET_LEVEL_SPREAD } = await import('./_npc-village-seed.js');
    const { growthPointsEarned } = await import('./pet/_growth.js');
    const npc = NPC_VILLAGE_ROSTER.find((n) => n.rank === 'elite')!;
    const save = buildNpcSave(npc, 60, null, 40) as { character: { pets: Array<Record<string, any>> } };
    assert.equal(save.character.pets.length, 4);
    // Like a player's, its four companions are not all one level: the signature
    // stands highest and the spread averages out to the scaled pet level.
    assert.equal(NPC_PET_LEVEL_SPREAD.reduce((a, b) => a + b, 0), 0);
    const levels = save.character.pets.map((pet) => pet.level);
    assert.deepEqual(levels, npcPetLevels(npc, 40));
    assert.equal(levels.reduce((a, b) => a + b, 0) / levels.length, 40);
    assert.equal(save.character.pets[npc.pets.findIndex((p) => p.signature)]!.level, Math.max(...levels), 'the signature companion is the strongest');
    for (const pet of save.character.pets) {
        assert.equal(pet.growthPoints, 0, 'nothing left unspent');
        const spent = Object.values(pet.growthAllocation as Record<string, number>).reduce((a, b) => a + b, 0);
        assert.equal(spent, growthPointsEarned(pet.level));
        assert.ok(pet.attack > 0 && pet.hp > 0);
    }
    // A level-1 build is the untrained baseline it replaces.
    const fresh = grownNpcPet(save.character.pets[0]!, 1);
    assert.equal(fresh.level, 1);
    assert.ok(Number(save.character.pets[0]!.hp) > Number(fresh.hp), 'a raised pet is stronger than a level-1 one');
});
test('a rebuild that changes nothing writes nothing, and a build is identical every time', async () => {
    const { buildNpcSave, seedNpcVillage } = await import('./_npc-village-seed.js');
    const npc = NPC_VILLAGE_ROSTER.find((n) => n.rank === 'jonin')!;
    assert.equal(JSON.stringify(buildNpcSave(npc, 50, null, 30)), JSON.stringify(buildNpcSave(npc, 50, null, 30)), 'deterministic');
    const save = buildNpcSave(npc, 50, null, 30) as { character: { rankTitle: string; pets: Array<{ happiness: number }> } };
    assert.notEqual(save.character.rankTitle, 'Academy Student');
    assert.ok(save.character.pets.every((pet) => pet.happiness === 100));
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'npc-scaling-rebuild-secret-0123456789ab';
    const { kv } = await import('./_storage.js');
    const first = await seedNpcVillage();
    assert.deepEqual(first.failures, []);
    const before = await kv.get<{ _saveVersion: number }>(`save:${npc.id}`);
    const second = await seedNpcVillage();
    assert.equal(second.unchanged.length, NPC_VILLAGE_ROSTER.length, JSON.stringify(second));
    assert.equal((await kv.get<{ _saveVersion: number }>(`save:${npc.id}`))?._saveVersion, before?._saveVersion, 'no write, no version bump');
});