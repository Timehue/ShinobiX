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

    it('continues to allow premium-wallet spending before the strict cutover', () => {
        const incoming = {
            ...existingCharacter,
            fateShards: 9, boneCharms: 10, auraStones: 11, auraDust: 12,
            mythicSeals: 13, honorSeals: 14, hollowShards: 15,
        };
        const result = sanitizeCharacterSave({ character: incoming }, { character: existingCharacter });
        const char = result.character as Record<string, unknown>;
        assert.equal(char.fateShards, 9);
        assert.equal(char.hollowShards, 15);
        assert.equal(char.level, 12);
        assert.equal(char.xp, 345);
    });

    it('re-asserts stored ryo: a generic save can neither spend it nor erase a server credit', () => {
        // Every live ryo spend settles through a server endpoint, so a lower
        // balance in a generic save is a stale client echoing an older wallet —
        // accepting it would erase whatever the server credited in between.
        for (const staleRyo of [9_000, 0]) {
            const result = sanitizeCharacterSave({ character: { ...existingCharacter, ryo: staleRyo } }, { character: existingCharacter });
            assert.equal((result.character as Record<string, unknown>).ryo, 10_000, `stale ${staleRyo}`);
        }
        const { ryo: _omitted, ...withoutRyo } = existingCharacter;
        const missing = sanitizeCharacterSave({ character: withoutRyo }, { character: existingCharacter });
        assert.equal((missing.character as Record<string, unknown>).ryo, 10_000, 'a save that omits ryo keeps the stored balance');
    });

    it('ALLOW_CLIENT_RYO_DECREASE=1 restores the old decrease-free rule as a rollback', () => {
        const previous = process.env.ALLOW_CLIENT_RYO_DECREASE;
        process.env.ALLOW_CLIENT_RYO_DECREASE = '1';
        try {
            const spent = sanitizeCharacterSave({ character: { ...existingCharacter, ryo: 9_000 } }, { character: existingCharacter });
            assert.equal((spent.character as Record<string, unknown>).ryo, 9_000);
            const minted = sanitizeCharacterSave({ character: { ...existingCharacter, ryo: 20_000 } }, { character: existingCharacter });
            assert.equal((minted.character as Record<string, unknown>).ryo, 10_000, 'the rollback never lets ryo rise');
        } finally {
            if (previous === undefined) delete process.env.ALLOW_CLIENT_RYO_DECREASE;
            else process.env.ALLOW_CLIENT_RYO_DECREASE = previous;
        }
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
