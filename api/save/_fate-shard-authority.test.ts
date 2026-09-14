import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeCharacterSave } from './[name].js';
import { applyPaidStatRespec } from './_stat-entitlement.js';
import { PROFILE_STAT_KEYS } from '../profile/_settlement.js';

const character = {
    name: 'shardowner', level: 1, levelLedgerMigrated: true, ryo: 100,
    fateShards: 100, stats: { ...Object.fromEntries(PROFILE_STAT_KEYS.map(key => [key, 10])), strength: 20 },
    unspentStats: 0, nindo: 'Keep my profile edit',
};

function sanitize(incoming: Record<string, unknown>, stored: Record<string, unknown> = character) {
    return sanitizeCharacterSave({ character: incoming }, { character: stored }).character as Record<string, unknown>;
}

test('ordinary saves cannot erase or restore spent shards in either supported ledger mode', () => {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    try {
        for (const mode of ['0', '1']) {
            process.env.STRICT_RAW_SAVE_LEDGER = mode;
            for (const fateShards of [undefined, 0, 20, 99, 101, 99999]) {
                const saved = sanitize({ ...character, fateShards });
                assert.equal(saved.fateShards, 100, `${mode}: ${fateShards}`);
                assert.equal(saved.nindo, character.nindo);
            }
            assert.equal(sanitize({ ...character, fateShards: 100 }, { ...character, fateShards: 50 }).fateShards, 50);
        }
    } finally {
        if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = previous;
    }
});

test('legacy full stat reset still refunds its exact points and charges its exact cost once', () => {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    process.env.STRICT_RAW_SAVE_LEDGER = '0';
    try {
        const reset = applyPaidStatRespec(character)!;
        const saved = sanitize({ ...reset, fateShards: 0 });
        assert.equal(saved.fateShards, 50, 'an overly low stale wallet cannot overcharge the validated reset');
        assert.equal(saved.unspentStats, 10);
        assert.equal((saved.stats as Record<string, number>).strength, 10);
        const repeated = sanitize({ ...reset, fateShards: 0 }, saved);
        assert.equal(repeated.fateShards, 50, 'the same reset cannot debit twice');
        const unpaid = sanitize({ ...reset, fateShards: 100 });
        assert.equal(unpaid.fateShards, 100);
        assert.equal((unpaid.stats as Record<string, number>).strength, 20);
        assert.equal(unpaid.unspentStats, 0);
    } finally {
        if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = previous;
    }
});
