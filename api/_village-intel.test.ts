import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.DISABLE_VILLAGE_STORES;

const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const SCOUT = 'Frostfang Village';
const OWNER = 'Moonshadow Village';
const SECTOR = 19; // a Moonshadow home sector

let kv: typeof import('./_storage.js').kv;
let intel: typeof import('./_village-intel.js');
let sectorWar: typeof import('./_sector-war.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    intel = await import('./_village-intel.js');
    sectorWar = await import('./_sector-war.js');
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(`world:territory:${SECTOR}`, { sector: SECTOR, ownerVillage: OWNER, hp: 20_000 });
    delete process.env.DISABLE_VILLAGE_STORES;
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

describe('village intel: tiers and declare cost (pure)', () => {
    it('tiers at 100 / 250 / 500', () => {
        assert.equal(intel.intelTierFor(0), 'none');
        assert.equal(intel.intelTierFor(99), 'none');
        assert.equal(intel.intelTierFor(100), 'scouted');
        assert.equal(intel.intelTierFor(249), 'scouted');
        assert.equal(intel.intelTierFor(250), 'mapped');
        assert.equal(intel.intelTierFor(500), 'infiltrated');
        assert.equal(intel.intelTierFor(2_000), 'infiltrated');
    });

    it('declare base cost 250 / 250 / 175 / 125', () => {
        assert.equal(intel.intelDeclareCost(250, 'none'), 250);
        assert.equal(intel.intelDeclareCost(250, 'scouted'), 250);
        assert.equal(intel.intelDeclareCost(250, 'mapped'), 175);
        assert.equal(intel.intelDeclareCost(250, 'infiltrated'), 125);
    });

    it('stacks multiplicatively under the comeback discount via canDeclareSectorWar', () => {
        const base = {
            attackerVillage: SCOUT, defenderVillage: OWNER, sector: SECTOR, sectorOwnerVillage: OWNER,
            winCondition: 'combat' as const, attackerInActiveVillageWar: false, defenderInActiveVillageWar: false,
            contestAlreadyActive: false, attackerWr: 10_000, attackerSectorsHeld: 8,
        };
        assert.deepEqual(sectorWar.canDeclareSectorWar(base), { ok: true, cost: 250 });
        assert.deepEqual(sectorWar.canDeclareSectorWar({ ...base, baseCost: intel.intelDeclareCost(250, 'mapped') }), { ok: true, cost: 175 });
        assert.deepEqual(sectorWar.canDeclareSectorWar({ ...base, baseCost: intel.intelDeclareCost(250, 'infiltrated') }), { ok: true, cost: 125 });
        // comeback at 2 held sectors = x0.5 on top of the intel base
        assert.deepEqual(sectorWar.canDeclareSectorWar({ ...base, attackerSectorsHeld: 2, baseCost: 125 }), { ok: true, cost: 63 });
        assert.deepEqual(sectorWar.canDeclareSectorWar({ ...base, attackerSectorsHeld: 2, baseCost: 175 }), { ok: true, cost: 88 });
        const short = sectorWar.canDeclareSectorWar({ ...base, attackerWr: 150, baseCost: 175 });
        assert.deepEqual(short, { ok: false, error: 'insufficient-wr', cost: 175 });
    });
});

describe('village intel: crediting', () => {
    it('credits 1 per explore on a sector the explorer village does NOT own, never on its own', async () => {
        const r = await intel.creditSectorIntel(SCOUT, SECTOR, intel.INTEL_PER_EXPLORE, NOW);
        assert.deepEqual(r, { credited: true, points: 1, tier: 'none' });
        const own = await intel.creditSectorIntel(OWNER, SECTOR, intel.INTEL_PER_EXPLORE, NOW);
        assert.deepEqual(own, { credited: false, reason: 'owned' });
        assert.equal((await intel.readVillageIntel(OWNER, NOW)).sectors[String(SECTOR)], undefined);
    });

    it('an unowned sector still earns', async () => {
        await kv.del(`world:territory:${SECTOR}`);
        const r = await intel.creditSectorIntel(OWNER, SECTOR, 1, NOW);
        assert.equal(r.credited, true);
    });

    it('a chest is worth 3', async () => {
        assert.equal(intel.INTEL_PER_CHEST, 3);
        const r = await intel.creditSectorIntel(SCOUT, SECTOR, intel.INTEL_PER_CHEST, NOW);
        assert.deepEqual(r, { credited: true, points: 3, tier: 'none' });
    });

    it('caps at 2,000 per sector', async () => {
        await intel.creditSectorIntel(SCOUT, SECTOR, 1_999, NOW);
        const r = await intel.creditSectorIntel(SCOUT, SECTOR, 50, NOW);
        assert.deepEqual(r, { credited: true, points: 2_000, tier: 'infiltrated' });
        assert.equal(intel.INTEL_CAP_PER_SECTOR, 2_000);
    });

    it('prunes 7 days after the last credit on read', async () => {
        await intel.creditSectorIntel(SCOUT, SECTOR, 120, NOW);
        assert.equal((await intel.sectorIntelFor(SCOUT, SECTOR, NOW + 6 * DAY)).tier, 'scouted');
        assert.deepEqual(await intel.sectorIntelFor(SCOUT, SECTOR, NOW + 7 * DAY + 1), { points: 0, tier: 'none' });
        // a fresh credit after expiry starts from zero
        const r = await intel.creditSectorIntel(SCOUT, SECTOR, 1, NOW + 7 * DAY + 1);
        assert.deepEqual(r, { credited: true, points: 1, tier: 'none' });
    });

    it('zeroes on resolve for both villages, idempotently', async () => {
        await intel.creditSectorIntel(SCOUT, SECTOR, 300, NOW);
        await intel.creditSectorIntel(SCOUT, 20, 300, NOW);
        await kv.del(`world:territory:${SECTOR}`);
        await intel.creditSectorIntel(OWNER, SECTOR, 300, NOW);
        await intel.zeroSectorIntel(SECTOR, [SCOUT, OWNER], NOW);
        await intel.zeroSectorIntel(SECTOR, [SCOUT, OWNER], NOW);
        assert.deepEqual(await intel.sectorIntelFor(SCOUT, SECTOR, NOW), { points: 0, tier: 'none' });
        assert.deepEqual(await intel.sectorIntelFor(OWNER, SECTOR, NOW), { points: 0, tier: 'none' });
        assert.equal((await intel.sectorIntelFor(SCOUT, 20, NOW)).points, 300, 'other sectors untouched');
    });

    it('kill switch: no credit, no tier', async () => {
        process.env.DISABLE_VILLAGE_STORES = '1';
        assert.deepEqual(await intel.creditSectorIntel(SCOUT, SECTOR, 500, NOW), { credited: false, reason: 'disabled' });
        delete process.env.DISABLE_VILLAGE_STORES;
        await intel.creditSectorIntel(SCOUT, SECTOR, 500, NOW);
        process.env.DISABLE_VILLAGE_STORES = '1';
        assert.deepEqual(await intel.sectorIntelFor(SCOUT, SECTOR, NOW), { points: 0, tier: 'none' });
        delete process.env.DISABLE_VILLAGE_STORES;
    });
});

describe('village intel: world-state view (pure)', () => {
    const contest = {
        sector: SECTOR, startedAt: NOW - 3 * 60 * 60_000, endsAt: NOW + 60 * 60_000, winCondition: 'combat' as const,
        lastLiveBattleAt: NOW - 3 * 60 * 60_000, flipped: false, expiredAt: undefined,
    };
    const structures = { ramparts: 2, watchtower: 1, barracks: 0, warAcademy: 0, supplyDepot: 3, treasuryVault: 0 };

    it('reveals only sectors at >= 100 and reads garrison / pool / structures', () => {
        const view = intel.buildVillageIntelView({
            viewerVillage: SCOUT,
            allIntel: {
                frostfangvillage: { village: SCOUT, sectors: { [SECTOR]: { points: 120, lastAt: NOW, expiresAt: NOW + DAY }, '20': { points: 99, lastAt: NOW, expiresAt: NOW + DAY } } },
            },
            ownerBySector: { [SECTOR]: OWNER, '20': OWNER },
            contests: [contest],
            structuresByVillageSlug: { moonshadowvillage: structures },
            sectorPools: { [SECTOR]: { explores: 12, chests: 2 } },
            now: NOW,
        });
        assert.equal(view.village, SCOUT);
        assert.equal(view.revealed.length, 1);
        assert.deepEqual(view.revealed[0], {
            sector: SECTOR, points: 120, tier: 'scouted', expiresAt: NOW + DAY, owner: OWNER,
            revealed: { garrison: 'open', poolUsage: { explores: 12, chests: 2 }, structures },
        });
        assert.deepEqual(view.scoutedBy, {}, 'scout owns nothing -> no scoutedBy');
    });

    it('garrison reads locked while the defence still turns up, none without a contest', () => {
        const mk = (contests: typeof contest[]) => intel.buildVillageIntelView({
            viewerVillage: SCOUT,
            allIntel: { frostfangvillage: { village: SCOUT, sectors: { [SECTOR]: { points: 100, lastAt: NOW, expiresAt: NOW + DAY } } } },
            ownerBySector: { [SECTOR]: OWNER }, contests, structuresByVillageSlug: {}, sectorPools: {}, now: NOW,
        }).revealed[0].revealed;
        assert.equal(mk([{ ...contest, lastLiveBattleAt: NOW - 60_000 }]).garrison, 'locked');
        assert.equal(mk([]).garrison, 'none');
        assert.equal(mk([]).structures, null, 'unknown structures -> null');
    });

    it('scoutedBy lists rivals at >= 100 only on sectors the viewer OWNS', () => {
        const view = intel.buildVillageIntelView({
            viewerVillage: OWNER,
            allIntel: {
                frostfangvillage: { village: SCOUT, sectors: { [SECTOR]: { points: 260, lastAt: NOW, expiresAt: NOW + DAY }, '20': { points: 50, lastAt: NOW, expiresAt: NOW + DAY }, '5': { points: 900, lastAt: NOW, expiresAt: NOW + DAY } } },
                stormveilvillage: { village: 'Stormveil Village', sectors: { [SECTOR]: { points: 100, lastAt: NOW, expiresAt: NOW + DAY } } },
                moonshadowvillage: { village: OWNER, sectors: { [SECTOR]: { points: 999, lastAt: NOW, expiresAt: NOW + DAY } } },
            },
            ownerBySector: { [SECTOR]: OWNER, '20': OWNER, '5': 'Stormveil Village' },
            contests: [], structuresByVillageSlug: {}, sectorPools: {}, now: NOW,
        });
        assert.deepEqual(view.scoutedBy, {
            [SECTOR]: [
                { village: SCOUT, tier: 'mapped', points: 260 },
                { village: 'Stormveil Village', tier: 'scouted', points: 100 },
            ],
        });
    });
});

/*
 * Duplicate-read elimination: api/world/explore.ts and api/world/open-chest.ts
 * both resolve `world:territory:<sector>` for the sector-pool cap BEFORE they
 * credit intel, and the credit then read the identical row a second time. It now
 * accepts that pre-read owner. The CREDIT RULES are unchanged either way — the
 * owning village still earns nothing on its own ground, an unowned sector still
 * earns — so every case below is asserted against both call shapes.
 */
describe('village intel: credit with a caller-supplied owner', { concurrency: false }, () => {
    /** Counts reads of the territory row for the duration of one call. */
    async function countingTerritoryReads<T>(run: () => Promise<T>): Promise<{ value: T; reads: number }> {
        const original = kv.get.bind(kv);
        let reads = 0;
        (kv as unknown as { get: typeof kv.get }).get = ((key: string, ...rest: unknown[]) => {
            if (String(key).startsWith('world:territory:')) reads++;
            return (original as (...a: unknown[]) => unknown)(key, ...rest);
        }) as typeof kv.get;
        try {
            return { value: await run(), reads };
        } finally {
            (kv as unknown as { get: typeof kv.get }).get = original;
        }
    }

    it('a supplied owner skips the duplicate territory read entirely', async () => {
        const supplied = await countingTerritoryReads(
            () => intel.creditSectorIntel(SCOUT, SECTOR, intel.INTEL_PER_EXPLORE, NOW, { ownerVillage: OWNER }),
        );
        assert.deepEqual(supplied.value, { credited: true, points: 1, tier: 'none' });
        assert.equal(supplied.reads, 0, 'the caller already held this row');

        const unsupplied = await countingTerritoryReads(
            () => intel.creditSectorIntel(SCOUT, SECTOR, intel.INTEL_PER_EXPLORE, NOW),
        );
        assert.equal(unsupplied.value.credited, true);
        assert.equal(unsupplied.reads, 1, 'omitting it keeps the original read-it-yourself behaviour');
    });

    it('the owning village still earns NOTHING on its own ground, from the supplied owner', async () => {
        const out = await countingTerritoryReads(
            () => intel.creditSectorIntel(OWNER, SECTOR, intel.INTEL_PER_CHEST, NOW, { ownerVillage: OWNER }),
        );
        assert.deepEqual(out.value, { credited: false, reason: 'owned' });
        assert.equal(out.reads, 0);
        assert.deepEqual((await intel.readVillageIntel(OWNER, NOW)).sectors, {});
    });

    it('an UNOWNED sector still earns — `ownerVillage: undefined` is an answer, not a miss', async () => {
        const out = await countingTerritoryReads(
            () => intel.creditSectorIntel(SCOUT, 41, intel.INTEL_PER_CHEST, NOW, { ownerVillage: undefined }),
        );
        assert.deepEqual(out.value, { credited: true, points: 3, tier: 'none' });
        assert.equal(out.reads, 0, 'an unowned sector must not fall back to a read');
    });

    it('supplied and unsupplied agree on the credited result for every owner shape', async () => {
        // Foreign owner → earns. Same result whichever way the owner arrives.
        const viaArg = await intel.creditSectorIntel(SCOUT, SECTOR, 120, NOW, { ownerVillage: OWNER });
        const viaRead = await intel.creditSectorIntel(SCOUT, 20, 120, NOW);
        assert.equal(viaArg.credited, true);
        assert.equal(viaRead.credited, true);
        assert.equal(
            (viaArg as { tier: string }).tier,
            (viaRead as { tier: string }).tier,
        );
        // A blank/whitespace owner is "unowned", exactly as the read path treats it.
        assert.equal((await intel.creditSectorIntel(SCOUT, 42, 1, NOW, { ownerVillage: '   ' })).credited, true);
    });

    it('null means "not supplied" and falls back to the stored row', async () => {
        const out = await countingTerritoryReads(
            () => intel.creditSectorIntel(OWNER, SECTOR, 1, NOW, null),
        );
        assert.deepEqual(out.value, { credited: false, reason: 'owned' });
        assert.equal(out.reads, 1);
    });

    it('the kill switch and the argument guards still win over a supplied owner', async () => {
        assert.deepEqual(
            await intel.creditSectorIntel('', SECTOR, 5, NOW, { ownerVillage: undefined }),
            { credited: false, reason: 'no-village' },
        );
        assert.deepEqual(
            await intel.creditSectorIntel(SCOUT, 0, 5, NOW, { ownerVillage: undefined }),
            { credited: false, reason: 'invalid' },
        );
        process.env.DISABLE_VILLAGE_STORES = '1';
        try {
            assert.deepEqual(
                await intel.creditSectorIntel(SCOUT, SECTOR, 500, NOW, { ownerVillage: undefined }),
                { credited: false, reason: 'disabled' },
            );
        } finally {
            delete process.env.DISABLE_VILLAGE_STORES;
        }
    });
});
