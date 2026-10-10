import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    tallyHeldSectors,
    homeSectorBaseline,
    looksUnseeded,
    loadHeldSectorCounts,
    heldSectorsForVillage,
    sectorFromTerritoryKey,
    type HeldSectorStore,
} from './_war-held-sectors.js';
import { WAR_VILLAGES, homeSectorsForVillage, CENTRAL_SECTORS, NON_WAR_SPECIAL_SECTORS, isWarSector } from './_war-map-sectors.js';

const NOW = Date.UTC(2026, 9, 8, 12);
// Not one of the 32 home war sectors: central keep, specials, and plain
// wilderness bands (25, 34+ are exploration sectors no village starts with).
const NON_WAR_SECTORS = [...new Set([...CENTRAL_SECTORS, ...NON_WAR_SPECIAL_SECTORS, 25, 34, 35, 40, 44, 55, 58])];

function storeOf(rows: Record<string, unknown>): HeldSectorStore {
    return {
        keys: async (pattern: string) => {
            const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
            return Object.keys(rows).filter((k) => k.startsWith(prefix));
        },
        mget: async (...keys: string[]) => keys.map((k) => rows[k] ?? null),
    };
}
function territoryRows(owners: Record<number, string>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [sector, ownerVillage] of Object.entries(owners)) {
        out[`world:territory:${sector}`] = { sector: Number(sector), ownerVillage };
    }
    return out;
}

describe('tallyHeldSectors (pure)', () => {
    it('counts war sectors per owning village', () => {
        const counts = tallyHeldSectors([
            { sector: 26, ownerVillage: 'Frostfang Village' },
            { sector: 27, ownerVillage: 'Frostfang Village' },
            { sector: 17, ownerVillage: 'Moonshadow Village' },
        ], { now: NOW });
        assert.deepEqual(counts, { 'Frostfang Village': 2, 'Moonshadow Village': 1 });
    });

    it('ignores unowned, blank, null and missing rows', () => {
        const counts = tallyHeldSectors([
            null,
            undefined,
            {},
            { sector: 1 },
            { sector: 2, ownerVillage: '' },
            { sector: 3, ownerVillage: '   ' },
            { sector: 4, ownerVillage: 'Stormveil Village' },
        ], { now: NOW });
        assert.deepEqual(counts, { 'Stormveil Village': 1 });
    });

    it('counts occupied enemy land too — conquest is uncapped', () => {
        // Moonshadow holds its 8 home sectors plus 4 taken from Frostfang.
        const sectors = [...homeSectorsForVillage('Moonshadow Village'), 27, 28, 29, 30];
        const counts = tallyHeldSectors(sectors.map((sector) => ({ sector, ownerVillage: 'Moonshadow Village' })), { now: NOW });
        assert.equal(counts['Moonshadow Village'], 12);
    });

    it('counts ONLY the 32 war sectors — central, special and wilderness rows never raise a village', () => {
        // A clan capture (or anything else) can stamp ownerVillage on a central or
        // wilderness row. Counting those rows inflated WR income, seals, the tax
        // tier and the comeback math; the war economy is a 32-sector contest (§4).
        for (const sector of NON_WAR_SECTORS) assert.equal(isWarSector(sector), false, `${sector} is not a war sector`);
        const counts = tallyHeldSectors([
            ...homeSectorsForVillage('Frostfang Village').map((sector) => ({ sector, ownerVillage: 'Frostfang Village' })),
            ...NON_WAR_SECTORS.map((sector) => ({ sector, ownerVillage: 'Frostfang Village' })),
        ], { now: NOW });
        assert.deepEqual(counts, { 'Frostfang Village': 8 });
    });

    it('a row that does not name its war sector counts toward nobody', () => {
        const counts = tallyHeldSectors([
            { ownerVillage: 'Frostfang Village' },
            { sector: 'not-a-sector', ownerVillage: 'Frostfang Village' },
            { sector: 0, ownerVillage: 'Frostfang Village' },
        ], { now: NOW });
        assert.deepEqual(counts, {});
    });

    it('a suspended war sector (breach or clan inactivity) is not counted, unless asked for', () => {
        const rows = [
            { sector: 26, ownerVillage: 'Frostfang Village' },
            { sector: 27, ownerVillage: 'Frostfang Village', ownerClan: 'Frost', rewardSuspendedAt: NOW - 1 },
        ];
        assert.deepEqual(tallyHeldSectors(rows, { now: NOW }), { 'Frostfang Village': 1 });
        assert.deepEqual(tallyHeldSectors(rows, { now: NOW, includeSuspended: true }), { 'Frostfang Village': 2 });
    });

    it('does not let a crafted owner name reach Object.prototype', () => {
        const counts = tallyHeldSectors([{ sector: 1, ownerVillage: '__proto__' }, { sector: 2, ownerVillage: 'constructor' }], { now: NOW });
        assert.equal(({} as Record<string, unknown>).polluted, undefined);
        assert.ok(typeof counts === 'object');
    });
});

describe('sectorFromTerritoryKey', () => {
    it('reads the sector a territory row is stored under, and nothing else', () => {
        assert.equal(sectorFromTerritoryKey('world:territory:26'), 26);
        assert.equal(sectorFromTerritoryKey('world:territory:99'), 99);
        assert.equal(sectorFromTerritoryKey('world:territory:26:extra'), 0);
        assert.equal(sectorFromTerritoryKey('world:territory:abc'), 0);
        assert.equal(sectorFromTerritoryKey('shared:sector-war:26'), 0);
    });
});

describe('homeSectorBaseline / looksUnseeded', () => {
    it('gives every war village its full home allocation', () => {
        const base = homeSectorBaseline();
        for (const v of WAR_VILLAGES) assert.equal(base[v], homeSectorsForVillage(v).length);
    });

    it('flags an empty table as unseeded but a real conquest state as seeded', () => {
        assert.equal(looksUnseeded({}), true);
        assert.equal(looksUnseeded({ 'Frostfang Village': 0, 'Moonshadow Village': 0 }), true);
        // Even a village conquered to zero leaves the sectors owned by SOMEONE.
        assert.equal(looksUnseeded({ 'Moonshadow Village': 32 }), false);
    });
});

describe('loadHeldSectorCounts (IO, fail-safe)', () => {
    it('reads live ownership from the territory rows', async () => {
        const counts = await loadHeldSectorCounts(storeOf(territoryRows({
            1: 'Stormveil Village', 2: 'Stormveil Village', 3: 'Moonshadow Village',
        })));
        assert.equal(counts['Stormveil Village'], 2);
        assert.equal(counts['Moonshadow Village'], 1);
        assert.equal(counts['Frostfang Village'] ?? 0, 0);
    });

    it('excludes suspended sectors from every count without treating the world as unseeded', async () => {
        // One definition for every consumer: the War Map shows, the faucet pays,
        // and the tax and costs are charged on the same number.
        const now = Date.UTC(2026, 7, 22, 12);
        const store = storeOf({
            'world:territory:1': { sector: 1, ownerVillage: 'Stormveil Village', ownerClan: 'Storm', rewardSuspendedAt: now - 1 },
            'world:territory:2': { sector: 2, ownerVillage: 'Moonshadow Village', ownerClan: 'Moon' },
        });
        const counts = await loadHeldSectorCounts(store, { now });
        assert.equal(counts['Stormveil Village'] ?? 0, 0);
        assert.equal(counts['Moonshadow Village'], 1);
    });

    it('a central, special or wilderness row stamped with a village does not raise its count', async () => {
        const owners: Record<number, string> = {};
        for (const s of homeSectorsForVillage('Frostfang Village')) owners[s] = 'Frostfang Village';
        for (const s of NON_WAR_SECTORS) owners[s] = 'Frostfang Village';
        const counts = await loadHeldSectorCounts(storeOf(territoryRows(owners)), { now: NOW });
        assert.equal(counts['Frostfang Village'], 8, 'only the 8 war sectors count, not the extra stamped rows');
    });

    it('reads the sector from the KEY a row is stored under, not from a field inside it', async () => {
        const counts = await loadHeldSectorCounts(storeOf({
            // Stored under wilderness sector 40 but claiming to be war sector 26.
            'world:territory:40': { sector: 26, ownerVillage: 'Frostfang Village' },
            // Stored under war sector 27 with no sector field at all.
            'world:territory:27': { ownerVillage: 'Frostfang Village' },
        }), { now: NOW });
        assert.equal(counts['Frostfang Village'], 1);
    });

    it('falls back to the home baseline when nothing is seeded', async () => {
        const counts = await loadHeldSectorCounts(storeOf({}));
        assert.deepEqual(counts, homeSectorBaseline());
    });

    it('treats a table whose only owned rows are NON-war sectors as unseeded', async () => {
        const counts = await loadHeldSectorCounts(storeOf(territoryRows({ 40: 'Frostfang Village', 47: 'Moonshadow Village' })), { now: NOW });
        assert.deepEqual(counts, homeSectorBaseline());
    });

    it('a seeded world whose war sectors are all suspended counts zero, not the baseline', async () => {
        const rows: Record<string, unknown> = {};
        for (const s of homeSectorsForVillage('Frostfang Village')) {
            rows[`world:territory:${s}`] = { sector: s, ownerVillage: 'Frostfang Village', ownerClan: 'Frost', rewardSuspendedAt: NOW - 1 };
        }
        const counts = await loadHeldSectorCounts(storeOf(rows), { now: NOW });
        assert.equal(counts['Frostfang Village'] ?? 0, 0);
        assert.equal(counts['Moonshadow Village'] ?? 0, 0, 'not the 8-sector fallback');
    });

    it('THROWS when the scan fails — a failed scan is never paid or charged as the baseline', async () => {
        // It used to answer the 8-sector baseline, which the daily pass then paid
        // and stamped for the day.
        const brokenKeys: HeldSectorStore = {
            keys: async () => { throw new Error('kv down'); },
            mget: async () => [],
        };
        await assert.rejects(() => loadHeldSectorCounts(brokenKeys), /kv down/);
        const brokenRows: HeldSectorStore = {
            keys: async () => ['world:territory:26'],
            mget: async () => { throw new Error('mget down'); },
        };
        await assert.rejects(() => loadHeldSectorCounts(brokenRows), /mget down/);
    });

    it('does NOT fall back when a village has genuinely been conquered to zero', async () => {
        // Frostfang lost every sector to Moonshadow — a real state, not an unseeded one.
        const owners: Record<number, string> = {};
        for (const s of [26, 27, 28, 29, 30, 31, 32, 33]) owners[s] = 'Moonshadow Village';
        const counts = await loadHeldSectorCounts(storeOf(territoryRows(owners)));
        assert.equal(counts['Frostfang Village'] ?? 0, 0, 'stays at zero — the comeback discount must fire');
        assert.equal(counts['Moonshadow Village'], 8);
    });
});

describe('heldSectorsForVillage', () => {
    it('returns the live count for one village, 0 for an unheld one', async () => {
        const store = storeOf(territoryRows({ 5: 'Stormveil Village', 6: 'Stormveil Village' }));
        assert.equal(await heldSectorsForVillage('Stormveil Village', store), 2);
        assert.equal(await heldSectorsForVillage('Ashen Leaf Village', store), 0);
    });

    it('trims the village name before lookup', async () => {
        const store = storeOf(territoryRows({ 5: 'Stormveil Village' }));
        assert.equal(await heldSectorsForVillage('  Stormveil Village  ', store), 1);
    });

    it('does not count non-war sectors, and fails closed on a failed scan', async () => {
        // The comeback discount, the declare and merc costs and the tax tier all
        // read this: a stamped wilderness row must not move them, and a failed scan
        // must refuse the action rather than price it off an invented count.
        const store = storeOf(territoryRows({ 5: 'Stormveil Village', 40: 'Stormveil Village', 48: 'Stormveil Village' }));
        assert.equal(await heldSectorsForVillage('Stormveil Village', store), 1);
        const broken: HeldSectorStore = { keys: async () => { throw new Error('kv down'); }, mget: async () => [] };
        await assert.rejects(() => heldSectorsForVillage('Stormveil Village', broken), /kv down/);
    });
});
