import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    tallyHeldSectors,
    homeSectorBaseline,
    looksUnseeded,
    loadHeldSectorCounts,
    heldSectorsForVillage,
    type HeldSectorStore,
} from './_war-held-sectors.js';
import { WAR_VILLAGES, homeSectorsForVillage } from './_war-map-sectors.js';

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
    it('counts sectors per owning village', () => {
        const counts = tallyHeldSectors([
            { ownerVillage: 'Frostfang Village' },
            { ownerVillage: 'Frostfang Village' },
            { ownerVillage: 'Moonshadow Village' },
        ]);
        assert.deepEqual(counts, { 'Frostfang Village': 2, 'Moonshadow Village': 1 });
    });

    it('ignores unowned, blank, null and missing rows', () => {
        const counts = tallyHeldSectors([
            null,
            undefined,
            {},
            { ownerVillage: '' },
            { ownerVillage: '   ' },
            { ownerVillage: 'Stormveil Village' },
        ]);
        assert.deepEqual(counts, { 'Stormveil Village': 1 });
    });

    it('counts occupied enemy land too — conquest is uncapped', () => {
        // Moonshadow holds its 8 home sectors plus 4 taken from Frostfang.
        const counts = tallyHeldSectors(
            Array.from({ length: 12 }, () => ({ ownerVillage: 'Moonshadow Village' })),
        );
        assert.equal(counts['Moonshadow Village'], 12);
    });

    it('does not let a crafted owner name reach Object.prototype', () => {
        const counts = tallyHeldSectors([{ ownerVillage: '__proto__' }, { ownerVillage: 'constructor' }]);
        assert.equal(({} as Record<string, unknown>).polluted, undefined);
        assert.ok(typeof counts === 'object');
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

    it('excludes suspended sectors from reward counts without treating the world as unseeded', async () => {
        const now = Date.UTC(2026, 7, 22, 12);
        const store = storeOf({
            'world:territory:1': { sector: 1, ownerVillage: 'Stormveil Village', ownerClan: 'Storm', rewardSuspendedAt: now - 1 },
            'world:territory:2': { sector: 2, ownerVillage: 'Moonshadow Village', ownerClan: 'Moon' },
        });
        const counts = await loadHeldSectorCounts(store, { rewardEligibleOnly: true, now });
        assert.equal(counts['Stormveil Village'] ?? 0, 0);
        assert.equal(counts['Moonshadow Village'], 1);
    });

    it('falls back to the home baseline when nothing is seeded', async () => {
        const counts = await loadHeldSectorCounts(storeOf({}));
        assert.deepEqual(counts, homeSectorBaseline());
    });

    it('falls back to the home baseline when the store throws', async () => {
        const broken: HeldSectorStore = {
            keys: async () => { throw new Error('kv down'); },
            mget: async () => [],
        };
        assert.deepEqual(await loadHeldSectorCounts(broken), homeSectorBaseline());
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
});
