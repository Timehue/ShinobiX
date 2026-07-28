import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { preserveStatPointEntitlement } from './_stat-entitlement.js';
import { sanitizeCharacterSave } from './[name].js';

const stats = (strength = 20, speed = 10) => ({
    strength, speed, intelligence: 10, willpower: 10,
    bukijutsuOffense: 10, bukijutsuDefense: 10,
    taijutsuOffense: 10, taijutsuDefense: 10,
    genjutsuOffense: 10, genjutsuDefense: 10,
    ninjutsuOffense: 10, ninjutsuDefense: 10,
});

describe('stat-point entitlement', () => {
    it('allows allocating stored unspent points without creating power', () => {
        const out = preserveStatPointEntitlement(
            { stats: stats(25), unspentStats: 5, fateShards: 100 },
            { stats: stats(20), unspentStats: 10, fateShards: 100 },
        );
        assert.equal(out.accepted, 'allocation');
        assert.equal(out.stats.strength, 25);
        assert.equal(out.unspentStats, 5);
    });

    it('allows only the paid full reset redistribution path', () => {
        const accepted = preserveStatPointEntitlement(
            { stats: stats(10), unspentStats: 10, fateShards: 50 },
            { stats: stats(20), unspentStats: 0, fateShards: 100 },
        );
        assert.equal(accepted.accepted, 'respec');

        const free = preserveStatPointEntitlement(
            { stats: stats(10), unspentStats: 10, fateShards: 100 },
            { stats: stats(20), unspentStats: 0, fateShards: 100 },
        );
        assert.equal(free.accepted, 'rejected');
        assert.equal(free.stats.strength, 20);
    });

    it('rejects forged new points even when spread across stats and pool', () => {
        const out = preserveStatPointEntitlement(
            { stats: stats(520, 510), unspentStats: 1000, fateShards: 100 },
            { stats: stats(20), unspentStats: 10, fateShards: 100 },
        );
        assert.equal(out.accepted, 'rejected');
        assert.deepEqual(out.stats, stats(20));
        assert.equal(out.unspentStats, 10);
    });

    it('rejects point-moving between allocated stats without a paid full respec', () => {
        const out = preserveStatPointEntitlement(
            { stats: stats(15, 15), unspentStats: 0, fateShards: 100 },
            { stats: stats(20, 10), unspentStats: 0, fateShards: 100 },
        );
        assert.equal(out.accepted, 'rejected');
        assert.deepEqual(out.stats, stats(20, 10));
    });

    it('is enforced by the real generic save sanitizer for an existing character', () => {
        const existingCharacter = { name: 'Audit', level: 10, xp: 0, ryo: 100, fateShards: 100, stats: stats(20), unspentStats: 10, totalStatsTrained: 10 };
        const out = sanitizeCharacterSave(
            { character: { ...existingCharacter, stats: stats(520, 510), unspentStats: 1000, totalStatsTrained: 9999 } },
            { character: existingCharacter },
        );
        const character = out.character as Record<string, unknown>;
        assert.deepEqual(character.stats, stats(20), 'forged stat jump rejected, stored stats restored');
        // The forged pool is rejected back to the stored 10 — then the ONE-TIME
        // ledger migration (stat-derived leveling) tops the pool up to cover the
        // stored level: earnedForLevel(10) = 1,800, earned was 10 allocated +
        // 10 pool = 20 → +1,780. Level stays 10, derived from that ledger.
        assert.equal(character.unspentStats, 10 + 1780);
        assert.equal(character.level, 10, 'level derives from the migrated ledger, not the client');
        assert.equal(character.levelLedgerMigrated, true);
        assert.equal(character.totalStatsTrained, 10);
    });
});
