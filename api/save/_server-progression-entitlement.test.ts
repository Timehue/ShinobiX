import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';

test('generic saves cannot forge server-owned achievement and combat progression', () => {
    const stored = { character: {
        auraSphereLevel: 7,
        auraDust: 50,
        redeemedAuraFeeds: ['aura_receipt_1'],
        battleTowerAscension: 3,
        rankedSeasonsWon: 1,
        weeklyBossKills: { '2026-W01': 'boss-a' },
        defeatedAiIds: ['enemy-a'],
        hunterRank: 2,
        redeemedHunterRanks: ['hunter_receipt_1'],
        element: 'Fire', elements: ['Fire'], claimedAwakenings: ['awakening-free-lv2'], redeemedAwakeningActions: ['awakening_receipt_1'],
        examsPassed: ['genin'],
        elderFocus: 'trade',
    } };
    const incoming = { character: {
        auraSphereLevel: 300,
        auraDust: 50,
        redeemedAuraFeeds: [],
        battleTowerAscension: 20,
        rankedSeasonsWon: 99,
        weeklyBossKills: { forged1: 'x', forged2: 'x', forged3: 'x', forged4: 'x', forged5: 'x' },
        defeatedAiIds: Array.from({ length: 200 }, (_, i) => `forged-${i}`),
        hunterRank: 5,
        redeemedHunterRanks: [],
        element: 'Lightning', elements: ['Fire', 'Water', 'Wind', 'Earth', 'Lightning'], claimedAwakenings: [], redeemedAwakeningActions: [],
        examsPassed: ['genin', 'chunin', 'jonin', 'specialJonin'],
        elderFocus: 'training',
    } };
    const out = sanitizeCharacterSave(incoming, stored) as Record<string, any>;
    const storedCharacter = stored.character as Record<string, unknown>;
    for (const field of ['auraSphereLevel', 'redeemedAuraFeeds', 'battleTowerAscension', 'rankedSeasonsWon', 'weeklyBossKills', 'defeatedAiIds', 'hunterRank', 'redeemedHunterRanks', 'element', 'elements', 'claimedAwakenings', 'redeemedAwakeningActions', 'examsPassed', 'elderFocus']) {
        assert.deepEqual(out.character[field], storedCharacter[field], field);
    }
});

test('first save canonicalizes server-owned progression', () => {
    const out = sanitizeCharacterSave({ character: {
        auraSphereLevel: 300,
        battleTowerAscension: 20,
        rankedSeasonsWon: 99,
        weeklyBossKills: { forged: 'boss' },
        defeatedAiIds: ['forged'],
        redeemedAuraFeeds: ['forged_receipt'],
        hunterRank: 5,
        redeemedHunterRanks: ['forged_receipt'],
        element: 'Fire', elements: ['Fire', 'Water'], claimedAwakenings: ['forged'], redeemedAwakeningActions: ['forged'],
        elderFocus: 'trade',
    } }, null) as Record<string, any>;
    assert.equal(out.character.auraSphereLevel, 1);
    assert.equal(out.character.battleTowerAscension, 0);
    assert.equal(out.character.rankedSeasonsWon, 0);
    assert.deepEqual(out.character.weeklyBossKills, {});
    assert.deepEqual(out.character.defeatedAiIds, []);
    assert.deepEqual(out.character.redeemedAuraFeeds, []);
    assert.equal(out.character.hunterRank, 0);
    assert.deepEqual(out.character.redeemedHunterRanks, []);
    assert.equal(out.character.element, undefined);
    assert.deepEqual(out.character.elements, []);
    assert.deepEqual(out.character.claimedAwakenings, []);
    assert.deepEqual(out.character.redeemedAwakeningActions, []);
    assert.equal(out.character.elderFocus, undefined);
});

test('generic saves cannot forge an owned pet combat build or paid loadout', () => {
    const storedPet = { id: 'pet-1', name: 'Wolf', rarity: 'rare', maxLevel: 100, level: 12, xp: 30, hp: 400, attack: 55, defense: 40, speed: 38, jutsus: [{ name: 'Bite', power: 60 }], unlockedForPve: false, happiness: 20, training: null, nickname: 'Ash', loadout: { pvp: 'owned-gear' } };
    const forgedPet = { ...storedPet, level: 100, xp: 0, hp: 99999, attack: 99999, defense: 99999, speed: 99999, jutsus: [{ name: 'Bite', power: 99999 }], unlockedForPve: true, happiness: 100, training: { type: 'strength', endsAt: 1 }, nickname: 'Free Rename', loadout: { pvp: 'unowned-gear' } };
    const out = sanitizeCharacterSave({ character: { pets: [forgedPet] } }, { character: { pets: [storedPet] } }) as Record<string, any>;
    for (const field of ['level', 'xp', 'hp', 'attack', 'defense', 'speed', 'jutsus', 'unlockedForPve', 'happiness', 'training', 'nickname', 'loadout']) {
        assert.deepEqual(out.character.pets[0][field], (storedPet as Record<string, unknown>)[field], field);
    }
});
