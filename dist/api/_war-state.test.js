"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _war_state_js_1 = require("./_war-state.js");
const _war_economy_js_1 = require("./_war-economy.js");
const _war_map_sectors_js_1 = require("./_war-map-sectors.js");
(0, node_test_1.describe)('war-state: default record', () => {
    (0, node_test_1.it)('a fresh Frostfang record: empty WR, all structures L0, 8 secure sectors', () => {
        const r = (0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village');
        node_assert_1.strict.equal(r.warResources, 0);
        node_assert_1.strict.equal(r.dormant, false);
        node_assert_1.strict.equal(r.lastWarPassDate, '');
        for (const k of _war_state_js_1.STRUCTURE_KEYS)
            node_assert_1.strict.equal(r.structures[k], 0);
        node_assert_1.strict.equal(Object.keys(r.sectors).length, 8);
        for (const s of _war_map_sectors_js_1.HOME_SECTORS['Frostfang Village']) {
            const cell = r.sectors[String(s)];
            node_assert_1.strict.equal(cell.controlHp, _war_state_js_1.SECTOR_CONTROL_HP_MAX);
            node_assert_1.strict.ok(cell.winCondition === 'combat' || cell.winCondition === 'pet'); // Combat / Pet default spread
            node_assert_1.strict.equal(cell.terrain, 'snow'); // Frostfang biome default
        }
    });
    (0, node_test_1.it)('the default win-condition spread is valid (no card, no type over 7)', () => {
        const c = (0, _war_state_js_1.winConditionCounts)((0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village'));
        node_assert_1.strict.equal(c.card, 0);
        node_assert_1.strict.equal(c.combat + c.pet, 8);
        node_assert_1.strict.ok(c.combat <= _war_state_js_1.MAX_SECTORS_PER_WIN_CONDITION && c.pet <= _war_state_js_1.MAX_SECTORS_PER_WIN_CONDITION);
    });
});
(0, node_test_1.describe)('war-state: normalize', () => {
    (0, node_test_1.it)('clamps WR pool, structure levels, and control HP into range', () => {
        const r = (0, _war_state_js_1.normalizeVillageWarRecord)('Ashen Leaf Village', {
            warResources: 9_999_999,
            structures: { ramparts: 99, watchtower: -5 },
            sectors: { '36': { winCondition: 'card', terrain: 'forest', controlHp: 10_000 } },
        });
        node_assert_1.strict.equal(r.warResources, _war_economy_js_1.WR_POOL_CAP);
        node_assert_1.strict.equal(r.structures.ramparts, _war_economy_js_1.VILLAGE_STRUCTURE_MAX_LEVEL);
        node_assert_1.strict.equal(r.structures.watchtower, 0);
        node_assert_1.strict.equal(r.sectors['36'].controlHp, _war_state_js_1.SECTOR_CONTROL_HP_MAX);
        node_assert_1.strict.equal(r.sectors['36'].winCondition, 'card');
        node_assert_1.strict.equal(r.sectors['36'].terrain, 'forest');
    });
    (0, node_test_1.it)('fills any missing home sectors and ignores foreign/unknown sectors', () => {
        const r = (0, _war_state_js_1.normalizeVillageWarRecord)('Ashen Leaf Village', {
            sectors: { '36': { winCondition: 'pet', terrain: 'volcano', controlHp: 300 }, '99': { winCondition: 'card' } },
        });
        node_assert_1.strict.equal(Object.keys(r.sectors).length, 8); // all home sectors present
        node_assert_1.strict.equal(r.sectors['36'].controlHp, 300); // provided value kept
        node_assert_1.strict.equal(r.sectors['37'].controlHp, _war_state_js_1.SECTOR_CONTROL_HP_MAX); // missing → default
        node_assert_1.strict.equal(r.sectors['99'], undefined); // foreign sector dropped
    });
    (0, node_test_1.it)('bad win-condition / terrain fall back to safe defaults', () => {
        const r = (0, _war_state_js_1.normalizeVillageWarRecord)('Ashen Leaf Village', {
            sectors: { '36': { winCondition: 'hax', terrain: 'lava', controlHp: 300 } },
        });
        node_assert_1.strict.equal(r.sectors['36'].winCondition, 'combat');
        node_assert_1.strict.equal(r.sectors['36'].terrain, 'volcano'); // biome fallback
    });
    (0, node_test_1.it)('dedupes merc leases and drops malformed ones', () => {
        const r = (0, _war_state_js_1.normalizeVillageWarRecord)('Ashen Leaf Village', {
            mercLeases: [
                { tierId: 'merc-ronin', player: 'a', expiresAt: 100 },
                { tierId: 'merc-ronin', player: 'a', expiresAt: 200 }, // dup tier+player
                { tierId: '', player: 'b', expiresAt: 100 }, // malformed
                { tierId: 'merc-oni', player: 'b', expiresAt: 0 }, // bad expiry
                { tierId: 'merc-oni', player: 'b', expiresAt: 999 },
            ],
        });
        node_assert_1.strict.equal(r.mercLeases.length, 2);
    });
    (0, node_test_1.it)('a missing/garbage raw record returns a clean default', () => {
        node_assert_1.strict.deepEqual((0, _war_state_js_1.normalizeVillageWarRecord)('Frostfang Village', undefined), (0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village'));
        node_assert_1.strict.deepEqual((0, _war_state_js_1.normalizeVillageWarRecord)('Frostfang Village', null), (0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village'));
    });
});
(0, node_test_1.describe)('war-state: win-condition diversity (max-7 rule)', () => {
    (0, node_test_1.it)('re-assigning a sector to its current type is always allowed', () => {
        const r = (0, _war_state_js_1.defaultVillageWarRecord)('Stormveil Village');
        const keys = Object.keys(r.sectors);
        const cur = r.sectors[keys[0]].winCondition;
        node_assert_1.strict.equal((0, _war_state_js_1.canAssignWinCondition)(r, Number(keys[0]), cur), true);
    });
    (0, node_test_1.it)('blocks assigning an 8th sector to a type already on 7', () => {
        const r = (0, _war_state_js_1.defaultVillageWarRecord)('Stormveil Village');
        const keys = Object.keys(r.sectors);
        // Force exactly 7 of the 8 sectors onto card; pin the 8th off it (the
        // default for keys[7] varies with the home-sector ordering).
        for (let i = 0; i < 7; i++)
            r.sectors[keys[i]].winCondition = 'card';
        r.sectors[keys[7]].winCondition = 'combat';
        node_assert_1.strict.equal((0, _war_state_js_1.winConditionCounts)(r).card, 7);
        // The 8th cannot become card (would be 8) but can become pet (pet = 0).
        node_assert_1.strict.equal((0, _war_state_js_1.canAssignWinCondition)(r, Number(keys[7]), 'card'), false);
        node_assert_1.strict.equal((0, _war_state_js_1.canAssignWinCondition)(r, Number(keys[7]), 'pet'), true);
        node_assert_1.strict.equal(_war_state_js_1.MAX_SECTORS_PER_WIN_CONDITION, 7);
    });
    (0, node_test_1.it)('cannot assign a non-home sector', () => {
        const r = (0, _war_state_js_1.defaultVillageWarRecord)('Stormveil Village');
        node_assert_1.strict.equal((0, _war_state_js_1.canAssignWinCondition)(r, 99, 'combat'), false);
    });
});
(0, node_test_1.describe)('war-state: merc leases + upkeep', () => {
    (0, node_test_1.it)('activeMercLeases filters by expiry', () => {
        const r = (0, _war_state_js_1.normalizeVillageWarRecord)('Ashen Leaf Village', {
            mercLeases: [
                { tierId: 'merc-ronin', player: 'a', expiresAt: 1000 },
                { tierId: 'merc-oni', player: 'b', expiresAt: 5000 },
            ],
        });
        node_assert_1.strict.equal((0, _war_state_js_1.activeMercLeases)(r, 900).length, 2);
        node_assert_1.strict.equal((0, _war_state_js_1.activeMercLeases)(r, 1500).length, 1);
        node_assert_1.strict.equal((0, _war_state_js_1.activeMercLeases)(r, 9000).length, 0);
    });
    (0, node_test_1.it)('totalUpkeepWr sums the structure curve', () => {
        const r = (0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village');
        node_assert_1.strict.equal((0, _war_state_js_1.totalUpkeepWr)(r), 0); // all L0
        for (const k of _war_state_js_1.STRUCTURE_KEYS)
            r.structures[k] = 5;
        node_assert_1.strict.equal((0, _war_state_js_1.totalUpkeepWr)(r), 90); // 6 × round(2·5^1.25)=15
    });
});
(0, node_test_1.describe)('war-state: terrain quota (Kage 3 / elder 1)', () => {
    (0, node_test_1.it)('a fresh record has no terrain picks', () => {
        const r = (0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village');
        node_assert_1.strict.deepEqual(r.terrainSetBy, {});
        node_assert_1.strict.equal((0, _war_state_js_1.terrainSetCountFor)(r, 'kageguy'), 0);
    });
    (0, node_test_1.it)('the Kage may set up to 3 sectors, then is blocked', () => {
        const r = (0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village');
        const home = Object.keys(r.sectors); // 8 home sectors
        for (let i = 0; i < 3; i++) {
            node_assert_1.strict.equal((0, _war_state_js_1.canSetTerrain)(r, Number(home[i]), 'kage', 'kage').ok, true);
            r.terrainSetBy[home[i]] = 'kage';
        }
        node_assert_1.strict.equal((0, _war_state_js_1.canSetTerrain)(r, Number(home[3]), 'kage', 'kage').error, 'quota-reached');
        // Re-setting one already theirs is still free.
        node_assert_1.strict.equal((0, _war_state_js_1.canSetTerrain)(r, Number(home[0]), 'kage', 'kage').ok, true);
    });
    (0, node_test_1.it)('an elder may set 1 sector, then is blocked', () => {
        const r = (0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village');
        const home = Object.keys(r.sectors);
        node_assert_1.strict.equal((0, _war_state_js_1.canSetTerrain)(r, Number(home[0]), 'elder', 'elder').ok, true);
        r.terrainSetBy[home[0]] = 'elder';
        node_assert_1.strict.equal((0, _war_state_js_1.canSetTerrain)(r, Number(home[1]), 'elder', 'elder').error, 'quota-reached');
    });
    (0, node_test_1.it)('elders cannot override another leader\'s pick; the Kage can', () => {
        const r = (0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village');
        const home = Object.keys(r.sectors);
        r.terrainSetBy[home[0]] = 'kage';
        node_assert_1.strict.equal((0, _war_state_js_1.canSetTerrain)(r, Number(home[0]), 'elder', 'elder').error, 'set-by-another');
        node_assert_1.strict.equal((0, _war_state_js_1.canSetTerrain)(r, Number(home[0]), 'kage', 'kage').ok, true);
    });
    (0, node_test_1.it)('rejects a non-authorized actor and a non-home sector', () => {
        const r = (0, _war_state_js_1.defaultVillageWarRecord)('Frostfang Village');
        node_assert_1.strict.equal((0, _war_state_js_1.canSetTerrain)(r, Number(Object.keys(r.sectors)[0]), 'x', 'none').error, 'not-authorized');
        node_assert_1.strict.equal((0, _war_state_js_1.canSetTerrain)(r, 99, 'kage', 'kage').error, 'not-home-sector');
    });
    (0, node_test_1.it)('normalize keeps terrainSetBy only for home sectors', () => {
        const r = (0, _war_state_js_1.normalizeVillageWarRecord)('Frostfang Village', {
            terrainSetBy: { '47': 'kage', '99': 'hacker' },
        });
        node_assert_1.strict.equal(r.terrainSetBy['47'], 'kage'); // 47 is a Frostfang home sector
        node_assert_1.strict.equal(r.terrainSetBy['99'], undefined); // foreign sector dropped
    });
});
