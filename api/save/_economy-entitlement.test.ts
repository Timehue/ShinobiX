import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitizeCharacterSave } from './[name].js';

const existingCharacter = {
    name: 'Player', level: 12, xp: 345, experience: 345, profession: 'vanguard', professionXp: 900,
    ryo: 10_000, fateShards: 10, boneCharms: 11, auraStones: 12, auraDust: 13,
    mythicSeals: 14, honorSeals: 15, hollowShards: 16, stats: {}, inventory: [], pets: [],
};

describe('generic-save economy entitlement', () => {
    it('rejects every positive wallet, XP, level, and profession-XP delta', () => {
        const forged = Object.fromEntries(Object.entries(existingCharacter).map(([key, value]) =>
            [key, typeof value === 'number' ? value + 999_999 : value]));
        const result = sanitizeCharacterSave({ character: forged }, { character: existingCharacter });
        const char = result.character as Record<string, unknown>;
        for (const field of ['level', 'xp', 'experience', 'professionXp', 'ryo', 'fateShards', 'boneCharms', 'auraStones', 'auraDust', 'mythicSeals', 'honorSeals', 'hollowShards']) {
            assert.equal(char[field], existingCharacter[field as keyof typeof existingCharacter], field);
        }
    });

    it('continues to allow legitimate wallet spending before the strict cutover', () => {
        const incoming = {
            ...existingCharacter,
            ryo: 9_000, fateShards: 9, boneCharms: 10, auraStones: 11, auraDust: 12,
            mythicSeals: 13, honorSeals: 14, hollowShards: 15,
        };
        const result = sanitizeCharacterSave({ character: incoming }, { character: existingCharacter });
        const char = result.character as Record<string, unknown>;
        assert.equal(char.ryo, 9_000);
        assert.equal(char.fateShards, 9);
        assert.equal(char.hollowShards, 15);
        assert.equal(char.level, 12);
        assert.equal(char.xp, 345);
    });

    it('requires authoritative spending after the strict cutover', () => {
        const previous = process.env.STRICT_RAW_SAVE_LEDGER;
        process.env.STRICT_RAW_SAVE_LEDGER = '1';
        try {
            const incoming = { ...existingCharacter, ryo: 9_000, fateShards: 9, hollowShards: 15 };
            const result = sanitizeCharacterSave({ character: incoming }, { character: existingCharacter });
            const char = result.character as Record<string, unknown>;
            assert.equal(char.ryo, 10_000);
            assert.equal(char.fateShards, 10);
            assert.equal(char.hollowShards, 16);
        } finally {
            if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = previous;
        }
    });
});
