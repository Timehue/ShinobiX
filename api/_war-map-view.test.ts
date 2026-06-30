import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeVillageWarRecord } from './_war-state.js';
import { villageWarMapView } from './_war-map-view.js';

function recordWith(structures: Record<string, number> = {}, warResources = 0, dormant = false) {
    return normalizeVillageWarRecord('Moonshadow Village', { warResources, structures, dormant });
}

describe('war-map-view: villageWarMapView', () => {
    it('assembles a fresh village view', () => {
        const v = villageWarMapView({ village: 'Moonshadow Village', record: recordWith(), treasurySeals: 0, sectorsHeld: 8 });
        assert.equal(v.village, 'Moonshadow Village');
        assert.equal(v.biome, 'shadow');
        assert.deepEqual(v.homeSectors, [11, 19, 15, 4, 5, 6, 16, 8]);
        assert.equal(v.warResources, 0);
        assert.equal(v.upkeepWr, 0);
        assert.equal(v.dormant, false);
        assert.equal(v.sectorsHeld, 8);
        assert.equal(v.taxRatePct, 0);                 // full 8 sectors → 0% tier
        assert.equal(v.wrPerSector, 25);               // no Supply Depot
        assert.equal(v.sectors.length, 8);
        assert.equal(v.sectors[0].sector, 11);
        assert.equal(v.sectors[0].alias, 'MS-1');
        assert.equal(v.sectors[0].controlHpMax, 600);  // no Watchtower
        assert.equal(v.sectors[0].winCondition, 'combat'); // defaults alternate combat/card
        assert.equal(v.sectors[1].winCondition, 'card');
    });

    it('reflects Watchtower (Control HP cap) and Supply Depot (WR/sector)', () => {
        const v = villageWarMapView({ village: 'Moonshadow Village', record: recordWith({ watchtower: 10, supplyDepot: 10 }), treasurySeals: 50, sectorsHeld: 8 });
        assert.equal(v.sectors[0].controlHpMax, 690);  // 600 × 1.15
        assert.equal(v.wrPerSector, 30);               // 25 + 0.5×10
        assert.equal(v.treasurySeals, 50);
        assert.equal(v.structures.watchtower, 10);
    });

    it('computes the effective tax tier (held count × Treasury-Vault softening)', () => {
        const v1 = villageWarMapView({ village: 'Moonshadow Village', record: recordWith(), treasurySeals: 0, sectorsHeld: 1 });
        assert.equal(v1.taxRatePct, 5);                // 1 sector → heaviest tier
        const v2 = villageWarMapView({ village: 'Moonshadow Village', record: recordWith({ treasuryVault: 10 }), treasurySeals: 0, sectorsHeld: 1 });
        assert.equal(v2.taxRatePct, 3.5);              // × Treasury-Vault L10 (×0.7)
    });

    it('suspends Control-HP/WR bonuses while dormant but still owes upkeep', () => {
        const v = villageWarMapView({ village: 'Moonshadow Village', record: recordWith({ ramparts: 5, watchtower: 5, supplyDepot: 5 }, 0, true), treasurySeals: 0, sectorsHeld: 8 });
        assert.equal(v.dormant, true);
        assert.equal(v.sectors[0].controlHpMax, 600);  // Watchtower suspended
        assert.equal(v.wrPerSector, 25);               // Supply Depot suspended
        assert.ok(v.upkeepWr > 0);                     // upkeep owed reflects built levels
    });
});
