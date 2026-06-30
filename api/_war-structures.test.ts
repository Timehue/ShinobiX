import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    STRUCTURE_DEFS,
    structureUpgradeCost,
    effectiveLevel,
    villageWarHpMax,
    sectorControlHpMax,
    mercCostMultiplier,
    sectorWarDamageMultiplier,
    wrPerSector,
    taxRateMultiplier,
    applyStructureUpgrade,
} from './_war-structures.js';
import { defaultVillageWarRecord, STRUCTURE_KEYS, SECTOR_CONTROL_HP_MAX, type VillageWarRecord } from './_war-state.js';
import { VILLAGE_STRUCTURE_MAX_LEVEL } from './_war-economy.js';

function rec(levels: Partial<Record<string, number>> = {}, dormant = false): VillageWarRecord {
    const r = defaultVillageWarRecord('Frostfang Village');
    r.dormant = dormant;
    for (const [k, v] of Object.entries(levels)) (r.structures as Record<string, number>)[k] = v as number;
    return r;
}

describe('war-structures: definitions + cost', () => {
    it('defines all 6 structures', () => {
        assert.equal(Object.keys(STRUCTURE_DEFS).length, 6);
        for (const k of STRUCTURE_KEYS) assert.ok(STRUCTURE_DEFS[k], `def for ${k}`);
    });
    it('upgrade cost rises with level (round 5·(lvl+1)^1.4)', () => {
        assert.equal(structureUpgradeCost('ramparts', 0), 5);   // L0→1
        assert.equal(structureUpgradeCost('ramparts', 4), 48);  // L4→5
        assert.equal(structureUpgradeCost('ramparts', 9), 126); // L9→10
    });
});

describe('war-structures: effects (dormancy-aware)', () => {
    it('effective level is the built level when active, 0 when dormant', () => {
        assert.equal(effectiveLevel(rec({ ramparts: 7 }), 'ramparts'), 7);
        assert.equal(effectiveLevel(rec({ ramparts: 7 }, true), 'ramparts'), 0);
    });
    it('Ramparts raise village war HP up to +15% at L10', () => {
        assert.equal(villageWarHpMax(rec()), 5000);
        assert.equal(villageWarHpMax(rec({ ramparts: 10 })), 5750); // 5000 × 1.15
        assert.equal(villageWarHpMax(rec({ ramparts: 10 }, true)), 5000); // dormant → no bonus
    });
    it('Watchtower raises sector Control HP', () => {
        assert.equal(sectorControlHpMax(rec()), SECTOR_CONTROL_HP_MAX);
        assert.equal(sectorControlHpMax(rec({ watchtower: 10 })), Math.round(SECTOR_CONTROL_HP_MAX * 1.15));
    });
    it('Barracks discount mercenary cost; War Academy boosts sector-war damage', () => {
        assert.ok(Math.abs(mercCostMultiplier(rec({ barracks: 10 })) - 0.85) < 1e-9);
        assert.ok(Math.abs(sectorWarDamageMultiplier(rec({ warAcademy: 10 })) - 1.15) < 1e-9);
        assert.equal(mercCostMultiplier(rec()), 1);
    });
    it('Supply Depot raises per-sector WR income (+0.5/level)', () => {
        assert.equal(wrPerSector(rec()), 25);
        assert.equal(wrPerSector(rec({ supplyDepot: 10 })), 30);
        assert.equal(wrPerSector(rec({ supplyDepot: 10 }, true)), 25); // dormant → base
    });
    it('Treasury Vault softens the tax rate (×0.7 at L10)', () => {
        assert.ok(Math.abs(taxRateMultiplier(rec({ treasuryVault: 10 })) - 0.7) < 1e-9);
        assert.equal(taxRateMultiplier(rec()), 1);
    });
});

describe('war-structures: applyStructureUpgrade (pure)', () => {
    it('upgrades when affordable, debiting seals', () => {
        const r = applyStructureUpgrade(rec(), 100, 'ramparts');
        assert.equal(r.ok, true);
        assert.equal(r.cost, 5);
        assert.equal(r.nextSeals, 95);
        assert.equal(r.newLevel, 1);
        assert.equal(r.record!.structures.ramparts, 1);
    });
    it('rejects when seals are insufficient (reporting the cost)', () => {
        const r = applyStructureUpgrade(rec({ ramparts: 4 }), 10, 'ramparts');
        assert.equal(r.ok, false);
        assert.equal(r.error, 'insufficient-seals');
        assert.equal(r.cost, 48);
    });
    it('rejects at max level', () => {
        const r = applyStructureUpgrade(rec({ ramparts: VILLAGE_STRUCTURE_MAX_LEVEL }), 99999, 'ramparts');
        assert.equal(r.ok, false);
        assert.equal(r.error, 'max-level');
    });
    it('rejects an unknown structure', () => {
        const r = applyStructureUpgrade(rec(), 99999, 'deathstar');
        assert.equal(r.ok, false);
        assert.equal(r.error, 'unknown-structure');
    });
    it('does not mutate the input record', () => {
        const base = rec();
        applyStructureUpgrade(base, 100, 'ramparts');
        assert.equal(base.structures.ramparts, 0);
    });
});
