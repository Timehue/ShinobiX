import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.DISABLE_VILLAGE_WAR;

/*
 * A mercenary battle scores a Combat sector war through the same receipt
 * protocol as every other battle (api/_sector-war-store.ts
 * commitSectorWarBattle). Mercs are the easiest way to put many receipts on a
 * war — the autonomous tick deploys one per contest per tick — so they must keep
 * scoring once a war holds more than the 200 receipts the row can carry, and a
 * merc that lands after its war was settled must not rewrite (and so un-expire)
 * the settled record.
 *
 * Since the owner redesign (2026-10-08) the band is the DEFENDER's, hired for
 * this contest instance, and it fights ATTACKING-village players: a band win
 * scores the defence in full, an attacker who cuts it down scores a quarter.
 */

type Session = import('../_sector-war.js').SectorWarSession;

const SECTOR = 23;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const TARGET = 'mercmark';   // an attacking-village player
const HIRER = 'mercboss';    // the defender's Kage
const TIER = 'merc-ronin';
const BAND_ID = 'mh_ledger-band-0001';

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

function defenderBand(session: Session, now: number, count: number) {
    return {
        warResources: 0, structures: {}, sectors: {},
        mercLeases: [{
            id: BAND_ID,
            context: { kind: 'sector', contestId: session.id, instance: war.sectorWarInstanceTag(session), sector: SECTOR },
            tierId: TIER, player: HIRER, expiresAt: now + 24 * 3600_000, count,
        }],
    };
}

async function seedWar(now: number, overrides: Partial<Session> = {}): Promise<Session> {
    const base = war.newSectorWarSession({ sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'combat', now: now - 3600_000 });
    const mirror = Array.from({ length: 200 }, (_, i) => ({
        battleId: `old-${i}`, attackerWon: false, points: 1, by: 'someone', at: base.startedAt + i,
    })).reverse();
    const session: Session = { ...base, declarationGeneration: 2, appliedBattles: mirror, defenderPoints: 200, ...overrides };
    await kv.set(war.sectorWarKey(session.id), session);
    await kv.set(villageWarKey(DEFENDER), defenderBand(session, now, 3));
    await kv.set(`save:${TARGET}`, {
        character: { name: TARGET, village: ATTACKER, level: 5, hp: 120, maxHp: 120, stats: {}, jutsu: [], equipment: {} },
    });
    return session;
}

function deploy(contest: Session, now: number) {
    return deployOneMerc({
        village: DEFENDER, tierId: TIER, hirer: HIRER, bandKey: `id:${BAND_ID}`, sector: SECTOR,
        targetPlayer: TARGET, targetVillage: ATTACKER, contestId: contest.id,
        instance: war.sectorWarInstanceTag(contest), mercLevel: 20, now,
    });
}

async function row(id: string): Promise<Session> {
    return war.normalizeSectorWarSession((await kv.get(war.sectorWarKey(id))) as never)!;
}

async function bandCount(): Promise<number> {
    const rec = await kv.get<{ mercLeases?: Array<{ id?: string; count?: number }> }>(villageWarKey(DEFENDER));
    return Number(rec?.mercLeases?.find((l) => l.id === BAND_ID)?.count ?? 0);
}

describe('mercenary battles on a Combat sector war', { concurrency: false }, () => {
    it('keep scoring past the old 200-receipt ceiling, one receipt per decisive fight, scored for the defence', async () => {
        const now = Date.now();
        const contest = await seedWar(now);
        let decisive = 0;
        let repelled = 0;
        let previous = await row(contest.id);
        // Each deploy stamps a 15-minute per-target cooldown, so step the
        // clock past it; the fight seed follows `now`, deterministically.
        for (let i = 0; i < 6; i += 1) {
            const at = now + i * 16 * 60_000;
            // A band holds only a few mercs; keep it stocked for the test.
            await kv.set(villageWarKey(DEFENDER), defenderBand(contest, now, 3));
            const result = await deploy(contest, at);
            assert.ok(result, `deploy ${i} fought`);
            const after = await row(contest.id);
            if (result.winner === 'stall') continue;
            decisive += 1;
            assert.equal(after.battleLedger?.count, 200 + decisive, 'exactly one receipt for a decisive fight');
            assert.equal(after.appliedBattles?.length, 200, 'the in-row mirror did not grow');
            assert.equal(result.attackerPoints, after.attackerPoints);
            assert.equal(result.defenderPoints, after.defenderPoints);
            // Villager-weight merc vs a villager attacker: a swing of 5.
            if (result.winner === 'merc') {
                assert.equal(after.defenderPoints - previous.defenderPoints, 5, 'a band win scores the DEFENCE in full');
                assert.equal(after.attackerPoints, previous.attackerPoints);
            } else {
                repelled += 1;
                assert.equal(after.attackerPoints - previous.attackerPoints, Math.floor(5 * war.MERC_REPEL_POINTS_FRACTION), 'an attacker who beats the band scores a quarter');
                assert.equal(after.defenderPoints, previous.defenderPoints);
            }
            assert.equal(after.lastLiveBattleAt, undefined, 'a merc battle is an AI battle: it never re-locks the garrison');
            const receipt = await kv.get<{ receipt?: { by?: string; attackerWon?: boolean } }>(war.sectorWarBattleReceiptKey(after, `merc:${contest.id}:${TARGET}:${at}`));
            assert.ok(receipt, 'with its own external receipt');
            assert.equal(receipt?.receipt?.by, result.winner === 'merc' ? '' : TARGET, 'by: the human winner, or nobody when the merc wins');
            previous = after;
        }
        assert.ok(decisive > 0, 'at least one deploy must be decisive for this test to mean anything');
        const final = await row(contest.id);
        // A merc win credits nobody; an attacker who repels one is a fighter of the attack.
        assert.deepEqual(final.battleLedger?.contributors ?? [], repelled > 0 ? [TARGET] : []);
    });

    it('never rewrites a settled war, and the merc that fought for nothing returns to its band', async () => {
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
        let result: Awaited<ReturnType<typeof deploy>> | undefined;
        try {
            result = await deploy(contest, now);
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
            kv.set = originalSet as typeof kv.set;
        }
        assert.equal(result, null, 'nothing applied');
        assert.deepEqual(contestWrites, [], 'no write of any kind to the settled row');
        assert.deepEqual(await kv.get(war.sectorWarKey(contest.id)), before);
        assert.equal(await bandCount(), 3, 'the merc is back in its band');
    });

    it('scores a band win for the defence in full and an attacker repel at a quarter (mercSide: defender)', async () => {
        const now = Date.now();
        const contest = await seedWar(now, { appliedBattles: [], defenderPoints: 0 });
        const forced = (winner: 'merc' | 'player' | 'stall') => ({
            prepareFighter: async () => ({ sealed: true }),
            runFight: () => ({ winner, mercWon: winner === 'merc', playerWon: winner === 'player', rounds: 1, log: [] }) as never,
        });
        // Make the attacker a Kage: worth a full bounty when the band fells him,
        // and more when he cuts it down.
        await kv.set('village:kage:moonshadow-village', { seatedKage: TARGET });

        const won = await deployOneMerc({
            village: DEFENDER, tierId: TIER, hirer: HIRER, bandKey: `id:${BAND_ID}`, sector: SECTOR,
            targetPlayer: TARGET, targetVillage: ATTACKER, contestId: contest.id,
            instance: war.sectorWarInstanceTag(contest), mercLevel: 20, now,
        }, forced('merc'));
        // Merc (villager win 5) + a fallen Kage (loss 50) = 55, all to the defence.
        assert.deepEqual({ a: won?.attackerPoints, d: won?.defenderPoints, left: won?.mercsRemaining }, { a: 0, d: 55, left: 2 });

        const repelled = await deployOneMerc({
            village: DEFENDER, tierId: TIER, hirer: HIRER, bandKey: `id:${BAND_ID}`, sector: SECTOR,
            targetPlayer: TARGET, targetVillage: ATTACKER, contestId: contest.id,
            instance: war.sectorWarInstanceTag(contest), mercLevel: 20, now: now + 16 * 60_000,
        }, forced('player'));
        // Kage win (30) + merc loss (0) = 30, at the repel quarter → 7 to the attack.
        assert.deepEqual({ a: repelled?.attackerPoints, d: repelled?.defenderPoints, left: repelled?.mercsRemaining }, { a: 7, d: 55, left: 1 });

        const stalled = await deployOneMerc({
            village: DEFENDER, tierId: TIER, hirer: HIRER, bandKey: `id:${BAND_ID}`, sector: SECTOR,
            targetPlayer: TARGET, targetVillage: ATTACKER, contestId: contest.id,
            instance: war.sectorWarInstanceTag(contest), mercLevel: 20, now: now + 32 * 60_000,
        }, forced('stall'));
        assert.equal(stalled?.winner, 'stall');
        assert.equal(stalled?.mercsRemaining, 0, 'a stall is inert, but the merc is spent');

        const final = await row(contest.id);
        assert.deepEqual({ a: final.attackerPoints, d: final.defenderPoints }, { a: 7, d: 55 });
        assert.equal(final.lastLiveBattleAt, undefined);
        assert.deepEqual(final.battleLedger?.contributors, [TARGET], 'only the attacker who beat the band earns capture credit');
        const receipts = (final.appliedBattles ?? []).map((r) => ({ attackerWon: r.attackerWon, by: r.by, points: r.points }));
        assert.deepEqual(receipts, [
            { attackerWon: true, by: TARGET, points: 7 },
            { attackerWon: false, by: '', points: 55 },
        ]);
    });

    it('returns the merc to its band when the scoring commit throws', async () => {
        const now = Date.now();
        const contest = await seedWar(now);
        const originalCompareSet = kv.compareSet.bind(kv);
        kv.compareSet = (async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
            if (key === war.sectorWarKey(contest.id)) throw new Error('contest row unavailable');
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        try {
            await assert.rejects(() => deployOneMerc({
                village: DEFENDER, tierId: TIER, hirer: HIRER, bandKey: `id:${BAND_ID}`, sector: SECTOR,
                targetPlayer: TARGET, targetVillage: ATTACKER, contestId: contest.id,
                instance: war.sectorWarInstanceTag(contest), mercLevel: 20, now,
            }, {
                prepareFighter: async () => ({ sealed: true }),
                runFight: () => ({ winner: 'merc', mercWon: true, playerWon: false, rounds: 1, log: [] }) as never,
            }), /contest row unavailable/);
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }
        assert.equal(await bandCount(), 3, 'claimed, fought, not scored — so not spent');
        assert.equal((await row(contest.id)).defenderPoints, 200, 'nothing scored');
    });

    it('a band never fights a war it was not hired for', async () => {
        const now = Date.now();
        const contest = await seedWar(now);
        // The same sector re-sieged later is a different instance.
        const r = await deployOneMerc({
            village: DEFENDER, tierId: TIER, hirer: HIRER, bandKey: `id:${BAND_ID}`, sector: SECTOR,
            targetPlayer: TARGET, targetVillage: ATTACKER, contestId: contest.id,
            instance: 'g9.s1', mercLevel: 20, now,
        });
        assert.equal(r, null);
        assert.equal(await bandCount(), 3, 'nothing spent');
        assert.equal(await kv.get(`merc:target-cd:${TARGET}`), null, 'and nobody was attacked');
    });
});
