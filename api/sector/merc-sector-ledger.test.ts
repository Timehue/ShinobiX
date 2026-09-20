import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.DISABLE_VILLAGE_WAR;

/*
 * A mercenary battle scores a Combat sector war through the same receipt
 * protocol as every other battle (api/_sector-war-store.ts
 * commitSectorWarBattle). Mercs are the easiest way to put many receipts on a
 * war — the autonomous tick deploys one per siege per tick — so they must keep
 * scoring once a war holds more than the 200 receipts the row can carry, and a
 * merc that lands after its war was settled must not rewrite (and so un-expire)
 * the settled record.
 */

type Session = import('../_sector-war.js').SectorWarSession;

const SECTOR = 23;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const TARGET = 'mercmark';
const HIRER = 'mercboss';
const TIER = 'merc-ronin';

let kv: typeof import('../_storage.js').kv;
let war: typeof import('../_sector-war.js');
let deployOneMerc: typeof import('../_merc-auto.js').deployOneMerc;
let villageWarKey: typeof import('../_war-state.js').villageWarKey;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    war = await import('../_sector-war.js');
    ({ deployOneMerc } = await import('../_merc-auto.js'));
    ({ villageWarKey } = await import('../_war-state.js'));
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

async function seedWar(now: number, overrides: Partial<Session> = {}): Promise<Session> {
    const base = war.newSectorWarSession({ sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'combat', now: now - 3600_000 });
    const mirror = Array.from({ length: 200 }, (_, i) => ({
        battleId: `old-${i}`, attackerWon: false, points: 1, by: 'someone', at: base.startedAt + i,
    })).reverse();
    const session: Session = { ...base, declarationGeneration: 2, appliedBattles: mirror, defenderPoints: 200, ...overrides };
    await kv.set(war.sectorWarKey(session.id), session);
    await kv.set(villageWarKey(ATTACKER), {
        warResources: 0, structures: {}, sectors: {},
        mercLeases: [{ tierId: TIER, player: HIRER, expiresAt: now + 24 * 3600_000, count: 50 }],
    });
    await kv.set(`save:${TARGET}`, {
        character: { name: TARGET, village: DEFENDER, level: 5, hp: 120, maxHp: 120, stats: {}, jutsu: [], equipment: {} },
    });
    return session;
}

function deploy(contestId: string, now: number) {
    return deployOneMerc({
        village: ATTACKER, tierId: TIER, hirer: HIRER, sector: SECTOR,
        targetPlayer: TARGET, targetVillage: DEFENDER, contestId, mercLevel: 20, now,
    });
}

async function row(id: string): Promise<Session> {
    return war.normalizeSectorWarSession((await kv.get(war.sectorWarKey(id))) as never)!;
}

describe('mercenary battles on a Combat sector war', { concurrency: false }, () => {
    it('keep scoring past the old 200-receipt ceiling, one receipt per decisive fight', async () => {
        const now = Date.now();
        const contest = await seedWar(now);
        let decisive = 0;
        // Each deploy stamps a 15-minute per-target cooldown, so step the
        // clock past it; the fight seed follows `now`, deterministically.
        for (let i = 0; i < 6; i += 1) {
            const at = now + i * 16 * 60_000;
            // A band holds only a few mercs; keep it stocked for the test.
            await kv.set(villageWarKey(ATTACKER), {
                warResources: 0, structures: {}, sectors: {},
                mercLeases: [{ tierId: TIER, player: HIRER, expiresAt: now + 24 * 3600_000, count: 3 }],
            });
            const result = await deploy(contest.id, at);
            assert.ok(result, `deploy ${i} fought`);
            const after = await row(contest.id);
            if (result.winner === 'stall') continue;
            decisive += 1;
            assert.equal(after.battleLedger?.count, 200 + decisive, 'exactly one receipt for a decisive fight');
            assert.equal(after.appliedBattles?.length, 200, 'the in-row mirror did not grow');
            assert.equal(result.attackerPoints, after.attackerPoints);
            assert.equal(result.defenderPoints, after.defenderPoints);
            const receipt = await kv.get(war.sectorWarBattleReceiptKey(after, `merc:${contest.id}:${TARGET}:${at}`));
            assert.ok(receipt, 'with its own external receipt');
        }
        assert.ok(decisive > 0, 'at least one deploy must be decisive for this test to mean anything');
        const final = await row(contest.id);
        // Merc kills credit nobody; a repel credits the defender, never capture credit.
        assert.deepEqual(final.battleLedger?.contributors ?? [], []);
    });

    it('never rewrites a settled war (the defended record keeps its cooldown expiry)', async () => {
        const now = Date.now();
        const contest = await seedWar(now, { expiredAt: now - 1000, expiredReason: 'defended' });
        const before = await kv.get(war.sectorWarKey(contest.id));
        const originalCompareSet = kv.compareSet.bind(kv);
        const originalSet = kv.set.bind(kv);
        const contestWrites: string[] = [];
        kv.compareSet = (async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
            if (key === war.sectorWarKey(contest.id)) contestWrites.push('compareSet');
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
            if (key === war.sectorWarKey(contest.id)) contestWrites.push('set');
            return originalSet(key, value, options);
        }) as typeof kv.set;
        try {
            const result = await deploy(contest.id, now);
            assert.ok(result);
            assert.equal(result.defenderPoints, 200, 'reports the settled tally');
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
            kv.set = originalSet as typeof kv.set;
        }
        assert.deepEqual(contestWrites, [], 'no write of any kind to the settled row');
        assert.deepEqual(await kv.get(war.sectorWarKey(contest.id)), before);
    });
});
