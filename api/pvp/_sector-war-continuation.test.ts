import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.ENABLE_LEGACY;

/*
 * The world-PvP sector-war continuation is part of the PvP terminal credit
 * barrier (api/pvp/_committed-terminal-effects.ts): if it throws, neither
 * fighter's reward settlement can complete. It used to throw for EVERY sector
 * battle once its war held 200 receipts, and it scanned every contest row on
 * every world battle to recover a crash. These tests pin the repaired path:
 * scoring past the old ceiling, crash recovery by keyed reads, generation and
 * end-time eligibility, and no scan of all wars on the normal path.
 */

type Session = import('../_sector-war.js').SectorWarSession;
type PvpSession = import('./session.js').PvpSession;

const SECTOR = 23;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const RAIDER = 'raider';
const HOLDOUT = 'holdout';

let kv: typeof import('../_storage.js').kv;
let war: typeof import('../_sector-war.js');
let store: typeof import('../_sector-war-store.js');
let settle: typeof import('./_sector-war-continuation.js').settlePvpSectorWarContinuation;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    war = await import('../_sector-war.js');
    store = await import('../_sector-war-store.js');
    ({ settlePvpSectorWarContinuation: settle } = await import('./_sector-war-continuation.js'));
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

let battleSeq = 0;
function battle(args: { createdAt: number; endedAt: number; winner: 'p1' | 'p2'; battleId?: string }): PvpSession {
    battleSeq += 1;
    return {
        battleId: args.battleId ?? `pvp-cont-${battleSeq}`,
        status: 'done',
        winner: args.winner,
        createdAt: args.createdAt,
        endedAt: args.endedAt,
        rewardAuthority: 'world',
        rewardSector: SECTOR,
        joined: { p1: true, p2: true },
        progressionAuthorityVersion: 1,
        p1: { name: RAIDER, character: { name: RAIDER, village: ATTACKER } },
        p2: { name: HOLDOUT, character: { name: HOLDOUT, village: DEFENDER } },
        worldAttacker: { side: 'p1', name: RAIDER },
    } as unknown as PvpSession;
}

async function contest(overrides: Partial<Session> = {}, receipts = 0): Promise<Session> {
    const now = Date.now();
    const base = war.newSectorWarSession({ sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'combat', now: now - 60 * 60 * 1000 });
    const mirror = Array.from({ length: receipts }, (_, i) => ({
        battleId: `old-${i}`, attackerWon: true, points: 1, by: RAIDER, at: now - 50 * 60 * 1000 + i,
    })).reverse();
    const session: Session = {
        ...base,
        declarationGeneration: 1,
        ...(receipts ? { appliedBattles: mirror, attackerPoints: receipts } : {}),
        ...overrides,
    };
    await kv.set(war.sectorWarKey(session.id), session);
    return session;
}

async function register(session: PvpSession, contestId: string) {
    await store.mintSectorWarToken(war.newSectorWarBattleToken({
        battleId: session.battleId,
        sectorWarId: contestId,
        sector: SECTOR,
        attackerVillage: ATTACKER,
        defenderVillage: DEFENDER,
        registeredBy: RAIDER,
        winCondition: 'combat',
        p1Name: RAIDER,
        p2Name: HOLDOUT,
        p1Village: ATTACKER,
        p2Village: DEFENDER,
        biome: 'forest',
        now: session.createdAt,
    }));
}

async function row(id: string): Promise<Session> {
    return war.normalizeSectorWarSession((await kv.get(war.sectorWarKey(id))) as never)!;
}

describe('world PvP sector continuation past the old 200-receipt ceiling', { concurrency: false }, () => {
    it('scores the 201st battle of a war (it used to throw and stall both fighters\' rewards)', async () => {
        const war200 = await contest({}, 200);
        const now = Date.now();
        const fight = battle({ createdAt: now - 1000, endedAt: now - 10, winner: 'p1' });
        await register(fight, war200.id);

        const receipt = await settle(fight);
        assert.equal(receipt.outcome, 'applied');
        assert.equal(receipt.attackerWon, true);
        assert.equal(receipt.points, 5, 'villager-over-villager kill value, unchanged');
        assert.equal(receipt.attackerPoints, 205);
        const after = await row(war200.id);
        assert.equal(after.attackerPoints, 205);
        assert.equal(after.appliedBattles?.length, 200, 'the in-row mirror did not grow');
        assert.equal(after.battleLedger?.count, 201);
        assert.ok(await store.loadSectorWarExternalReceipt(after, fight.battleId), 'the battle has its own external receipt');

        // Either participant's retry is a replay of the canonical receipt.
        assert.deepEqual(await settle(fight), receipt);
        assert.equal((await row(war200.id)).attackerPoints, 205, 'and never scores twice');
    });

    it('a defender kill counts for the defence, attributed to the defender', async () => {
        const w = await contest({}, 200);
        const now = Date.now();
        const fight = battle({ createdAt: now - 1000, endedAt: now - 10, winner: 'p2' });
        await register(fight, w.id);
        const receipt = await settle(fight);
        assert.equal(receipt.attackerWon, false);
        const after = await row(w.id);
        assert.equal(after.defenderPoints, 5);
        assert.equal((await store.loadSectorWarExternalReceipt(after, fight.battleId))?.by, HOLDOUT);
        assert.ok(!after.battleLedger?.contributors.includes(HOLDOUT), 'a defence win is never capture credit');
    });
});

describe('world PvP sector continuation: crash recovery by keyed reads', { concurrency: false }, () => {
    it('recovers a score whose resolution receipt was lost, without re-applying it', async () => {
        const w = await contest({}, 200);
        const now = Date.now();
        const fight = battle({ createdAt: now - 1000, endedAt: now - 10, winner: 'p1' });
        await register(fight, w.id);
        const originalCompareSet = kv.compareSet.bind(kv);
        kv.compareSet = (async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
            if (key === store.sectorWarResolutionReceiptKey(fight.battleId)) throw new Error('injected crash before the resolution receipt');
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        try {
            await assert.rejects(settle(fight), /injected crash/);
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }
        assert.equal((await row(w.id)).attackerPoints, 205, 'the score landed before the crash');
        const recovered = await settle(fight);
        assert.equal(recovered.outcome, 'applied');
        assert.equal(recovered.points, 5);
        assert.equal((await row(w.id)).attackerPoints, 205, 'recovery never adds the points again');
    });

    it('proves an applied battle after its contest row has expired (the receipt outlives the row)', async () => {
        const w = await contest({}, 200);
        const now = Date.now();
        const fight = battle({ createdAt: now - 1000, endedAt: now - 10, winner: 'p1' });
        await register(fight, w.id);
        const first = await settle(fight);
        // A defended war's record expires a day after settlement, while the
        // resolution receipt, token and recovery snapshot live ~48h.
        await kv.del(war.sectorWarKey(w.id));
        assert.deepEqual(await settle(fight), first, 'the replay still proves its receipt');
        // Even with the resolution receipt gone too, the bound token leads to it.
        await kv.del(store.sectorWarResolutionReceiptKey(fight.battleId));
        const again = await settle(fight);
        assert.equal(again.outcome, 'applied');
        assert.equal(again.points, 5);
        assert.equal(again.attackerPoints, 205, 'reported from the tally recorded with the receipt');
    });

    it('does not scan every war on the normal path', async () => {
        await contest({}, 3);
        const originalKeys = kv.keys.bind(kv);
        const scanned: string[] = [];
        kv.keys = (async (pattern: string) => { scanned.push(pattern); return originalKeys(pattern); }) as typeof kv.keys;
        try {
            const now = Date.now();
            // Ordinary world PvP with no contest token: a canonical no-op.
            const ordinary = battle({ createdAt: now - 1000, endedAt: now - 10, winner: 'p1' });
            assert.equal((await settle(ordinary)).outcome, 'not-applicable');
            assert.deepEqual(scanned, [], 'no keyspace scan at all');
        } finally {
            kv.keys = originalKeys as typeof kv.keys;
        }
    });
});

describe('world PvP sector continuation: eligibility', { concurrency: false }, () => {
    it('a battle begun before this contest instance started never scores it', async () => {
        const now = Date.now();
        const w = await contest();
        const stale = battle({ createdAt: w.startedAt - 5000, endedAt: w.startedAt + 10, winner: 'p1' });
        await register(stale, w.id);
        const receipt = await settle(stale);
        assert.equal(receipt.outcome, 'superseded');
        assert.equal((await row(w.id)).attackerPoints, 0);
        assert.ok(now > w.startedAt);
    });

    it('a battle that ended before endsAt still scores after endsAt until settlement stamps the war', async () => {
        const now = Date.now();
        const w = await contest({ startedAt: now - 73 * 3600_000, endsAt: now - 3600_000 }, 200);
        const inTime = battle({ createdAt: w.endsAt - 60_000, endedAt: w.endsAt - 1000, winner: 'p1' });
        await register(inTime, w.id);
        assert.equal((await settle(inTime)).outcome, 'applied');
        // Once settlement stamps the war, nothing more can score it.
        const settled = { ...(await row(w.id)), flipped: true, updatedAt: now };
        await kv.set(war.sectorWarKey(w.id), settled);
        const late = battle({ createdAt: w.endsAt - 50_000, endedAt: w.endsAt - 500, winner: 'p1' });
        await register(late, w.id);
        const before = await kv.get(war.sectorWarKey(w.id));
        assert.equal((await settle(late)).outcome, 'superseded');
        assert.deepEqual(await kv.get(war.sectorWarKey(w.id)), before, 'a settled row is never rewritten');
    });
});
