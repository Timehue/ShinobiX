import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    defaultVillageWarRecord,
    normalizeVillageWarRecord,
    winConditionCounts,
    canAssignWinCondition,
    activeMercLeases,
    totalUpkeepWr,
    canSetTerrain,
    terrainSetCountFor,
    STRUCTURE_KEYS,
    SECTOR_CONTROL_HP_MAX,
    MAX_SECTORS_PER_WIN_CONDITION,
} from './_war-state.js';
import { WR_POOL_CAP, VILLAGE_STRUCTURE_MAX_LEVEL } from './_war-economy.js';
import { HOME_SECTORS } from './_war-map-sectors.js';

describe('war-state: default record', () => {
    it('a fresh Frostfang record: empty WR, all structures L0, 8 secure sectors', () => {
        const r = defaultVillageWarRecord('Frostfang Village');
        assert.equal(r.warResources, 0);
        assert.equal(r.dormant, false);
        assert.equal(r.lastWarPassDate, '');
        for (const k of STRUCTURE_KEYS) assert.equal(r.structures[k], 0);
        assert.equal(Object.keys(r.sectors).length, 8);
        for (const s of HOME_SECTORS['Frostfang Village']) {
            const cell = r.sectors[String(s)];
            assert.equal(cell.controlHp, SECTOR_CONTROL_HP_MAX);
            assert.ok(cell.winCondition === 'combat' || cell.winCondition === 'pet'); // Combat / Pet default spread
            assert.equal(cell.terrain, 'snow'); // Frostfang biome default
        }
    });
    it('the default win-condition spread is valid (no card, no type over 7)', () => {
        const c = winConditionCounts(defaultVillageWarRecord('Frostfang Village'));
        assert.equal(c.card, 0);
        assert.equal(c.combat + c.pet, 8);
        assert.ok(c.combat <= MAX_SECTORS_PER_WIN_CONDITION && c.pet <= MAX_SECTORS_PER_WIN_CONDITION);
    });
});

describe('war-state: normalize', () => {
    it('clamps WR pool, structure levels, and control HP into range', () => {
        const r = normalizeVillageWarRecord('Ashen Leaf Village', {
            warResources: 9_999_999,
            structures: { ramparts: 99, watchtower: -5 } as never,
            sectors: { '36': { winCondition: 'card', terrain: 'forest', controlHp: 10_000 } } as never,
        });
        assert.equal(r.warResources, WR_POOL_CAP);
        assert.equal(r.structures.ramparts, VILLAGE_STRUCTURE_MAX_LEVEL);
        assert.equal(r.structures.watchtower, 0);
        assert.equal(r.sectors['36'].controlHp, SECTOR_CONTROL_HP_MAX);
        assert.equal(r.sectors['36'].winCondition, 'card');
        assert.equal(r.sectors['36'].terrain, 'forest');
    });

    it('fills any missing home sectors and ignores foreign/unknown sectors', () => {
        const r = normalizeVillageWarRecord('Ashen Leaf Village', {
            sectors: { '36': { winCondition: 'pet', terrain: 'volcano', controlHp: 300 }, '99': { winCondition: 'card' } } as never,
        });
        assert.equal(Object.keys(r.sectors).length, 8);        // all home sectors present
        assert.equal(r.sectors['36'].controlHp, 300);          // provided value kept
        assert.equal(r.sectors['37'].controlHp, SECTOR_CONTROL_HP_MAX); // missing → default
        assert.equal(r.sectors['99'], undefined);              // foreign sector dropped
    });

    it('bad win-condition / terrain fall back to safe defaults', () => {
        const r = normalizeVillageWarRecord('Ashen Leaf Village', {
            sectors: { '36': { winCondition: 'hax', terrain: 'lava', controlHp: 300 } } as never,
        });
        assert.equal(r.sectors['36'].winCondition, 'combat');
        assert.equal(r.sectors['36'].terrain, 'volcano'); // biome fallback
    });

    it('dedupes merc leases and drops malformed ones', () => {
        const r = normalizeVillageWarRecord('Ashen Leaf Village', {
            mercLeases: [
                { tierId: 'merc-ronin', player: 'a', expiresAt: 100 },
                { tierId: 'merc-ronin', player: 'a', expiresAt: 200 }, // dup tier+player
                { tierId: '', player: 'b', expiresAt: 100 },           // malformed
                { tierId: 'merc-oni', player: 'b', expiresAt: 0 },     // bad expiry
                { tierId: 'merc-oni', player: 'b', expiresAt: 999 },
            ] as never,
        });
        assert.equal(r.mercLeases.length, 2);
    });

    it('a missing/garbage raw record returns a clean default', () => {
        assert.deepEqual(normalizeVillageWarRecord('Frostfang Village', undefined), defaultVillageWarRecord('Frostfang Village'));
        assert.deepEqual(normalizeVillageWarRecord('Frostfang Village', null as never), defaultVillageWarRecord('Frostfang Village'));
    });
});

describe('war-state: win-condition diversity (max-7 rule)', () => {
    it('re-assigning a sector to its current type is always allowed', () => {
        const r = defaultVillageWarRecord('Stormveil Village');
        const keys = Object.keys(r.sectors);
        const cur = r.sectors[keys[0]].winCondition;
        assert.equal(canAssignWinCondition(r, Number(keys[0]), cur), true);
    });

    it('blocks assigning an 8th sector to a type already on 7', () => {
        const r = defaultVillageWarRecord('Stormveil Village');
        const keys = Object.keys(r.sectors);
        // Force exactly 7 of the 8 sectors onto card; pin the 8th off it (the
        // default for keys[7] varies with the home-sector ordering).
        for (let i = 0; i < 7; i++) r.sectors[keys[i]].winCondition = 'card';
        r.sectors[keys[7]].winCondition = 'combat';
        assert.equal(winConditionCounts(r).card, 7);
        // The 8th cannot become card (would be 8) but can become pet (pet = 0).
        assert.equal(canAssignWinCondition(r, Number(keys[7]), 'card'), false);
        assert.equal(canAssignWinCondition(r, Number(keys[7]), 'pet'), true);
        assert.equal(MAX_SECTORS_PER_WIN_CONDITION, 7);
    });

    it('cannot assign a non-home sector', () => {
        const r = defaultVillageWarRecord('Stormveil Village');
        assert.equal(canAssignWinCondition(r, 99, 'combat'), false);
    });
});

describe('war-state: merc leases + upkeep', () => {
    it('activeMercLeases filters by expiry', () => {
        const r = normalizeVillageWarRecord('Ashen Leaf Village', {
            mercLeases: [
                { tierId: 'merc-ronin', player: 'a', expiresAt: 1000 },
                { tierId: 'merc-oni', player: 'b', expiresAt: 5000 },
            ] as never,
        });
        assert.equal(activeMercLeases(r, 900).length, 2);
        assert.equal(activeMercLeases(r, 1500).length, 1);
        assert.equal(activeMercLeases(r, 9000).length, 0);
    });

    it('totalUpkeepWr sums the structure curve', () => {
        const r = defaultVillageWarRecord('Frostfang Village');
        assert.equal(totalUpkeepWr(r), 0); // all L0
        for (const k of STRUCTURE_KEYS) r.structures[k] = 5;
        assert.equal(totalUpkeepWr(r), 90); // 6 × round(2·5^1.25)=15
    });
});

describe('war-state: terrain quota (Kage 3 / elder 1)', () => {
    it('a fresh record has no terrain picks', () => {
        const r = defaultVillageWarRecord('Frostfang Village');
        assert.deepEqual(r.terrainSetBy, {});
        assert.equal(terrainSetCountFor(r, 'kageguy'), 0);
    });
    it('the Kage may set up to 3 sectors, then is blocked', () => {
        const r = defaultVillageWarRecord('Frostfang Village');
        const home = Object.keys(r.sectors); // 8 home sectors
        for (let i = 0; i < 3; i++) {
            assert.equal(canSetTerrain(r, Number(home[i]), 'kage', 'kage').ok, true);
            r.terrainSetBy[home[i]] = 'kage';
        }
        assert.equal(canSetTerrain(r, Number(home[3]), 'kage', 'kage').error, 'quota-reached');
        // Re-setting one already theirs is still free.
        assert.equal(canSetTerrain(r, Number(home[0]), 'kage', 'kage').ok, true);
    });
    it('an elder may set 1 sector, then is blocked', () => {
        const r = defaultVillageWarRecord('Frostfang Village');
        const home = Object.keys(r.sectors);
        assert.equal(canSetTerrain(r, Number(home[0]), 'elder', 'elder').ok, true);
        r.terrainSetBy[home[0]] = 'elder';
        assert.equal(canSetTerrain(r, Number(home[1]), 'elder', 'elder').error, 'quota-reached');
    });
    it('elders cannot override another leader\'s pick; the Kage can', () => {
        const r = defaultVillageWarRecord('Frostfang Village');
        const home = Object.keys(r.sectors);
        r.terrainSetBy[home[0]] = 'kage';
        assert.equal(canSetTerrain(r, Number(home[0]), 'elder', 'elder').error, 'set-by-another');
        assert.equal(canSetTerrain(r, Number(home[0]), 'kage', 'kage').ok, true);
    });
    it('rejects a non-authorized actor and a non-home sector', () => {
        const r = defaultVillageWarRecord('Frostfang Village');
        assert.equal(canSetTerrain(r, Number(Object.keys(r.sectors)[0]), 'x', 'none').error, 'not-authorized');
        assert.equal(canSetTerrain(r, 99, 'kage', 'kage').error, 'not-home-sector');
    });
    it('normalize keeps terrainSetBy only for home sectors', () => {
        const r = normalizeVillageWarRecord('Frostfang Village', {
            terrainSetBy: { '47': 'kage', '99': 'hacker' } as never,
        });
        assert.equal(r.terrainSetBy['47'], 'kage'); // 47 is a Frostfang home sector
        assert.equal(r.terrainSetBy['99'], undefined); // foreign sector dropped
    });
});
