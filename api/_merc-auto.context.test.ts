import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.DISABLE_VILLAGE_WAR;

/*
 * War binding of mercenary bands (owner redesign 2026-10-08), against the real
 * band selection (activeBand) and the real war/contest scans on the memory store.
 * Only the fight itself (deploy / deployVillage), the online lists and the target
 * hydration are injected.
 *
 * Every band serves the ONE war it was hired for and acts only while that exact
 * instance is live; a legacy (unbound) band fights only in village wars; an
 * UNFED band sits out a whole tick, per band.
 */

type Session = import('./_sector-war.js').SectorWarSession;

const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const SECTOR = 23;
const OTHER_SECTOR = 24;

let kv: typeof import('./_storage.js').kv;
let war: typeof import('./_sector-war.js');
let villageWarKey: typeof import('./_war-state.js').villageWarKey;
let runMercAutoDeploy: typeof import('./_merc-auto.js').runMercAutoDeploy;
let activeBand: typeof import('./_merc-auto.js').activeBand;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    war = await import('./_sector-war.js');
    ({ villageWarKey } = await import('./_war-state.js'));
    ({ runMercAutoDeploy, activeBand } = await import('./_merc-auto.js'));
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function seedContest(sector: number, now: number, overrides: Partial<Session> = {}): Promise<Session> {
    const session: Session = {
        ...war.newSectorWarSession({ sector, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'combat', now: now - 60_000 }),
        declarationGeneration: 1,
        ...overrides,
    };
    await kv.set(war.sectorWarKey(session.id), session);
    return session;
}

function sectorBand(id: string, contest: Pick<Session, 'id' | 'sector' | 'declarationGeneration' | 'startedAt'>, now: number, extra: Record<string, unknown> = {}) {
    return {
        id, tierId: 'merc-ronin', player: 'dkage', expiresAt: now + 3_600_000, count: 3,
        context: { kind: 'sector', contestId: contest.id, instance: war.sectorWarInstanceTag(contest), sector: contest.sector },
        ...extra,
    };
}

async function seedBands(village: string, leases: unknown[]) {
    await kv.set(villageWarKey(village), { warResources: 0, structures: {}, sectors: {}, mercLeases: leases });
}

/** The tick with everything but band selection and the scans stubbed. */
async function tick(now: number) {
    const sector: Array<{ contestId: string; bandKey?: string; village: string; target: string }> = [];
    const village: Array<{ village: string; bandKey?: string; war?: unknown }> = [];
    await runMercAutoDeploy({
        now,
        sweepRetiredHires: async () => undefined,
        onlineNames: () => ['raider'],
        onlineAll: () => ['raider', 'holdout'],
        listSleepers: async () => [],
        targetsOf: async (names, enemy) => names
            .filter((n) => (n === 'raider' ? ATTACKER : DEFENDER) === enemy)
            .map((n) => ({ name: n, village: enemy, hp: 50, maxHp: 100 })),
        deploy: async (a) => { sector.push({ contestId: a.contestId, bandKey: a.bandKey, village: a.village, target: a.targetPlayer }); return { winner: 'merc', attackerPoints: 0, defenderPoints: 5, mercsRemaining: 2 }; },
        deployVillage: async (a) => { village.push({ village: a.village, bandKey: a.bandKey, war: a.war }); return { winner: 'merc', enemyWarHp: 100, mercsRemaining: 2 }; },
    });
    return { sector, village };
}

function villageWarRow(now: number, overrides: Record<string, unknown> = {}) {
    return {
        id: 'frostfangvillage-vs-moonshadowvillage',
        villages: [DEFENDER, ATTACKER],
        hp: { [DEFENDER]: 5_000, [ATTACKER]: 5_000 },
        warGroundSector: 40,
        warGroundHp: 1_000,
        startedAt: now - 2 * 3_600_000,
        pendingUntil: now - 3_600_000,
        updatedAt: now - 3_600_000,
        declarationGeneration: 2,
        ...overrides,
    };
}

describe('sector-war bands are bound to their contest instance', { concurrency: false }, () => {
    it('a defender band acts in its own contest, against the attacker', async () => {
        const now = Date.now();
        const contest = await seedContest(SECTOR, now);
        await seedBands(DEFENDER, [sectorBand('mh_def-0001', contest, now)]);
        const { sector } = await tick(now);
        assert.deepEqual(sector, [{ contestId: contest.id, bandKey: 'id:mh_def-0001', village: DEFENDER, target: 'raider' }]);
    });

    it('a band hired for an earlier siege of the sector does not serve the new one', async () => {
        const now = Date.now();
        const earlier = { id: `${SECTOR}:moonshadowvillage-vs-frostfangvillage`, sector: SECTOR, declarationGeneration: 1, startedAt: now - 5 * 86_400_000 };
        await seedContest(SECTOR, now);
        await seedBands(DEFENDER, [sectorBand('mh_old-siege-01', earlier, now)]);
        assert.deepEqual((await tick(now)).sector, []);
    });

    it('stops when its contest ends', async () => {
        const now = Date.now();
        const contest = await seedContest(SECTOR, now, { expiredAt: now - 1, expiredReason: 'defended' });
        await seedBands(DEFENDER, [sectorBand('mh_ended-0001', contest, now)]);
        assert.deepEqual((await tick(now)).sector, []);
    });

    it('a band bound to one contest never acts in another the village defends', async () => {
        const now = Date.now();
        const one = await seedContest(SECTOR, now);
        const other = await seedContest(OTHER_SECTOR, now);
        await seedBands(DEFENDER, [sectorBand('mh_only-one-01', one, now)]);
        const { sector } = await tick(now);
        assert.deepEqual(sector.map((s) => s.contestId), [one.id]);
        assert.ok(!sector.some((s) => s.contestId === other.id));
    });

    it('the ATTACKER\'s bands — legacy or bound — never act in its siege', async () => {
        const now = Date.now();
        const contest = await seedContest(SECTOR, now);
        await seedBands(ATTACKER, [
            { tierId: 'merc-oni', player: 'akage', expiresAt: now + 3_600_000, count: 4 },
            { ...sectorBand('mh_attacker-01', contest, now), player: 'akage' },
        ]);
        assert.deepEqual((await tick(now)).sector, []);
    });
});

describe('village-war bands are bound to their war instance', { concurrency: false }, () => {
    it('a band of THIS generation acts; one hired for the previous war does not; a legacy band still does', async () => {
        const now = Date.now();
        await kv.set('world:war:frostfangvillage-vs-moonshadowvillage', villageWarRow(now));
        const bound = (id: string, generation: number) => ({
            id, tierId: 'merc-ronin', player: 'akage', expiresAt: now + 3_600_000, count: 3,
            context: { kind: 'village', warId: 'frostfangvillage-vs-moonshadowvillage', generation },
        });
        await seedBands(ATTACKER, [bound('mh_prev-war-01', 1), bound('mh_this-war-01', 2)]);
        await seedBands(DEFENDER, [{ tierId: 'merc-oni', player: 'dkage', expiresAt: now + 3_600_000, count: 4 }]);
        const { village } = await tick(now);
        assert.deepEqual(village, [
            { village: DEFENDER, bandKey: 'merc-oni:dkage', war: { id: 'frostfangvillage-vs-moonshadowvillage', generation: 2 } },
            { village: ATTACKER, bandKey: 'id:mh_this-war-01', war: { id: 'frostfangvillage-vs-moonshadowvillage', generation: 2 } },
        ]);
    });

    it('no band acts while the war is pending, frozen by a settling strike, or over', async () => {
        const now = Date.now();
        const legacy = [{ tierId: 'merc-ronin', player: 'akage', expiresAt: now + 3_600_000, count: 3 }];
        await seedBands(ATTACKER, legacy);
        for (const row of [
            villageWarRow(now, { pendingUntil: now + 600_000 }),
            villageWarRow(now, { mercenaryFunding: { status: 'funding' } }),
            villageWarRow(now, { endedAt: now - 1 }),
            villageWarRow(now, { startedAt: now - 20 * 86_400_000, pendingUntil: now - 15 * 86_400_000 }),
        ]) {
            await kv.set('world:war:frostfangvillage-vs-moonshadowvillage', row);
            assert.deepEqual((await tick(now)).village, [], JSON.stringify(row).slice(0, 80));
        }
    });

    it('a legacy band never fights a sector war', async () => {
        const now = Date.now();
        await seedContest(SECTOR, now);
        await seedBands(DEFENDER, [{ tierId: 'merc-ronin', player: 'dkage', expiresAt: now + 3_600_000, count: 3 }]);
        assert.deepEqual((await tick(now)).sector, []);
    });
});

describe('an UNFED band sits out one whole tick, per band', { concurrency: false }, () => {
    it('skips the unfed band in every context of the tick, lets a fed band act, and returns next tick', async () => {
        const now = Date.now();
        const contest = await seedContest(SECTOR, now);
        await seedBands(DEFENDER, [
            sectorBand('mh_unfed-0001', contest, now, { skipNextAutoDeploy: true }),
            sectorBand('mh_fed-000001', contest, now),
        ]);
        const context = { kind: 'sector' as const, contestId: contest.id, instance: war.sectorWarInstanceTag(contest), sector: SECTOR };

        const skipped = new Set<string>();
        const first = await activeBand(DEFENDER, now, context, skipped);
        assert.equal(first?.key, 'id:mh_fed-000001', 'the unfed band sits out; the fed one acts');
        // The flag is persisted as cleared…
        const stored = await kv.get<{ mercLeases: Array<{ id: string; skipNextAutoDeploy?: boolean }> }>(villageWarKey(DEFENDER));
        assert.equal(stored?.mercLeases.find((l) => l.id === 'mh_unfed-0001')?.skipNextAutoDeploy, undefined);
        // …but a second look in the SAME tick (another context, or a retry) still skips it.
        assert.equal((await activeBand(DEFENDER, now, context, skipped))?.key, 'id:mh_fed-000001');

        // Next tick: the band is fed again and first in hire order.
        assert.equal((await activeBand(DEFENDER, now, context, new Set()))?.key, 'id:mh_unfed-0001');
    });

    it('an unfed band that is the only one leaves its war without a merc that tick', async () => {
        const now = Date.now();
        const contest = await seedContest(SECTOR, now);
        await seedBands(DEFENDER, [sectorBand('mh_unfed-0002', contest, now, { skipNextAutoDeploy: true })]);
        assert.deepEqual((await tick(now)).sector, []);
        assert.equal((await tick(now)).sector.length, 1, 'and it is back on the next tick');
    });
});
