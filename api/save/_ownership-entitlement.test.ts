import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeCharacterSave } from './[name].js';
import {
    LEGACY_PROGRESSION_CARD_IDS,
    SAGE_PROGRESSION_CARD_ID,
    STORY_PROGRESSION_CARD_IDS,
} from '../card-clash/_progression-cards.js';

const stored = {
    name: 'Player', level: 10, xp: 0, ryo: 0, stats: {},
    inventory: ['shinobi-vest', 'pet-treat', 'pet-treat'], itemStacks: [], tileCards: ['tc-01'],
    pets: [{ id: 'pet-1', name: 'Fox', rarity: 'rare', maxLevel: 100, level: 5, xp: 2, hp: 40, attack: 20, defense: 20, speed: 20, jutsus: [{ name: 'Bite', power: 10 }], unlockedForPve: true }],
};

describe('generic-save ownership entitlement', () => {
    it('rejects ordinary inventory and card additions while allowing consumption and stack migration', () => {
        const result = sanitizeCharacterSave({ character: {
            ...stored,
            inventory: ['forged-sword'],
            itemStacks: [{ itemId: 'pet-treat', count: 2 }, { itemId: 'forged-stack', count: 99 }],
            tileCards: ['tc-01', 'tc-21'],
        } }, { character: stored });
        const char = result.character as Record<string, unknown>;
        assert.deepEqual(char.inventory, []);
        assert.deepEqual(char.itemStacks, [{ itemId: 'pet-treat', count: 2 }]);
        assert.deepEqual(char.tileCards, ['tc-01']);
    });

    it('never lets a stale generic save erase server-earned Chronicle records', () => {
        const progressionCards = [
            STORY_PROGRESSION_CARD_IDS[0],
            'pet-witness-fire',
            SAGE_PROGRESSION_CARD_ID,
            LEGACY_PROGRESSION_CARD_IDS[0],
        ];
        const existing = {
            ...stored,
            tileCards: ['tc-01', ...progressionCards],
        };
        const result = sanitizeCharacterSave({ character: {
            ...stored,
            // This device last painted before any of the server receipts landed.
            tileCards: [],
        } }, { character: existing });
        const char = result.character as { tileCards: string[] };
        assert.deepEqual(char.tileCards, progressionCards);
    });

    it('treats an omitted legacy-client card field as unchanged', () => {
        const progressionCard = STORY_PROGRESSION_CARD_IDS[0];
        const existing = {
            ...stored,
            tileCards: ['tc-01', 'tc-02', progressionCard],
        };
        const incoming = { ...stored } as Record<string, unknown>;
        delete incoming.tileCards;
        const result = sanitizeCharacterSave({ character: incoming }, { character: existing });
        const char = result.character as { tileCards: string[] };
        assert.deepEqual(char.tileCards, existing.tileCards);
    });

    it('rejects new pets and preserves stored combat identity for existing IDs', () => {
        const result = sanitizeCharacterSave({ character: { ...stored, pets: [
            { ...stored.pets[0], rarity: 'mythic', jutsus: [{ name: 'Forge', power: 9999 }], level: 6 },
            { id: 'forged-pet', rarity: 'mythic', jutsus: [] },
        ] } }, { character: stored });
        const pets = (result.character as { pets: Array<Record<string, unknown>> }).pets;
        assert.equal(pets.length, 1);
        assert.equal(pets[0].id, 'pet-1');
        assert.equal(pets[0].rarity, 'rare');
        assert.deepEqual(pets[0].jutsus, stored.pets[0].jutsus);
        assert.equal(pets[0].level, 5);
    });
});
