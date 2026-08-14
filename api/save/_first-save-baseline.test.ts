import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyCanonicalFirstSave, FIRST_SAVE_INVENTORY, FIRST_SAVE_RYO } from './_first-save-baseline.js';
import { sanitizeCharacterSave } from './[name].js';

describe('canonical first player save', () => {
    it('replaces forged economy, progression, stats, inventory, cards, and pets with the starter grant', () => {
        const out = applyCanonicalFirstSave({
            name: 'Audit', village: 'Stormveil Village', specialty: 'Ninjutsu', bloodline: 'Ashen Eyes',
            level: 100, xp: 999_999_999, ryo: 999_999_999, fateShards: 999_999,
            stats: { strength: 999_999 }, unspentStats: 999_999,
            inventory: ['legendary-war-crate', 'forged-item'],
            itemStacks: [{ itemId: 'potion-rejuvenation', count: 9_999 }],
            pets: [{ id: 'forged-mythic', rarity: 'mythic' }], tileCards: ['tc-121'],
            equipment: { weapon: 'forged-item' }, profession: 'vanguard',
            masterySpec: { forged: 99 }, totalAiKills: 50_000,
        });

        assert.equal(out.name, 'Audit', 'identity/customization fields survive');
        assert.equal(out.village, 'Stormveil Village');
        assert.equal(out.level, 1);
        assert.equal(out.xp, 0);
        assert.equal(out.ryo, FIRST_SAVE_RYO);
        assert.equal(out.fateShards, 0);
        assert.equal(out.unspentStats, 20);
        assert.deepEqual(out.inventory, [...FIRST_SAVE_INVENTORY]);
        assert.deepEqual(out.itemStacks, []);
        assert.deepEqual(out.pets, []);
        assert.deepEqual(out.tileCards, []);
        assert.deepEqual(out.equipment, {});
        assert.equal(out.profession, undefined);
        assert.equal(out.masterySpec, undefined);
        assert.equal(out.totalAiKills, 0);
        assert.deepEqual(Object.values(out.stats as Record<string, number>), Array(12).fill(10));
    });

    it('is idempotent and does not mutate the submitted character', () => {
        const incoming = { name: 'Rill', inventory: ['forged'], ryo: 5000 };
        const once = applyCanonicalFirstSave(incoming);
        const twice = applyCanonicalFirstSave(once);
        assert.deepEqual(twice, once);
        assert.deepEqual(incoming, { name: 'Rill', inventory: ['forged'], ryo: 5000 });
    });

    it('is enforced by the real generic save sanitizer when no character exists', () => {
        const out = sanitizeCharacterSave({
            character: {
                name: 'Hostile', village: 'Stormveil Village', specialty: 'Ninjutsu', bloodline: 'Ashen Eyes',
                level: 100, xp: 999_999_999, ryo: 999_999_999, fateShards: 999_999,
                stats: { strength: 999_999 }, inventory: ['forged-item'],
                itemStacks: [{ itemId: 'forged-stack', count: 9_999 }],
                pets: [{ id: 'forged-pet', rarity: 'mythic', hp: 99_999 }],
                tileCards: ['forged-card'],
            },
        }, null);
        const character = out.character as Record<string, unknown>;

        assert.equal(character.level, 1);
        assert.equal(character.xp, 0);
        assert.equal(character.ryo, FIRST_SAVE_RYO);
        assert.equal(character.fateShards, 0);
        assert.deepEqual(character.inventory, [...FIRST_SAVE_INVENTORY]);
        assert.deepEqual(character.itemStacks, []);
        assert.deepEqual(character.pets, []);
        assert.deepEqual(character.tileCards, []);
    });

    it('does not let a later generic save erase or forge the war-crate claim ledger', () => {
        const base = { name: 'Audit', level: 10, xp: 0, ryo: 100, stats: {}, claimedWarCrateIds: ['war-crate-a-vs-b'] };
        const out = sanitizeCharacterSave(
            { character: { ...base, claimedWarCrateIds: ['war-crate-forged-vs-id'] } },
            { character: base },
        );
        assert.deepEqual((out.character as Record<string, unknown>).claimedWarCrateIds, ['war-crate-a-vs-b']);
    });
});
