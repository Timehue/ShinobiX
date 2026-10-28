import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, type TestContext } from 'node:test';
import type { KvCasOp } from '../_storage.js';

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
let ensure: typeof import('./_sector-war-continuation.js').ensurePvpSectorWarRegistration;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    war = await import('../_sector-war.js');
    store = await import('../_sector-war-store.js');
    ({
        settlePvpSectorWarContinuation: settle,
        ensurePvpSectorWarRegistration: ensure,
    } = await import('./_sector-war-continuation.js'));
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(`save:${RAIDER}`, { character: { name: RAIDER, village: ATTACKER, level: 20 } });
    await kv.set(`save:${HOLDOUT}`, { character: { name: HOLDOUT, village: DEFENDER, level: 20 } });
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

/** Fail every era war-battle write: the one-row receipt hash, and the receipt
 *  row plus counter shard of docs/SHARED_HASH_ROW_SPLIT_PLAN.md §5. */
function failEraWarBattleWrites(t: TestContext): () => void {
    const originalHset = kv.hset.bind(kv);
    const hset = t.mock.method(kv, 'hset', async (key: string, fields: Record<string, unknown>) => {
        if (key === 'era:contrib-receipts:warBattles') throw new Error('injected era war-battle write failure');
        return originalHset(key, fields);
    });
    type Many = (ops: readonly KvCasOp[]) => Promise<boolean>;
    const originalMany = kv.compareSetMany?.bind(kv) as Many | undefined;
    const many = originalMany && t.mock.method(kv as unknown as { compareSetMany: Many }, 'compareSetMany', async (ops: readonly KvCasOp[]) => {
        if (ops.some((op) => op.key.startsWith('era:receipt:warBattles:'))) throw new Error('injected era war-battle write failure');
        return originalMany(ops);
    });
    return () => {
        hset.mock.restore();
        if (many) many.mock.restore();
    };
}

describe('world PvP sector purse eligibility', { concurrency: false }, () => {
    for (const winner of ['p1', 'p2'] as const) it(`${winner} scores territory but no purse credit against a fresh low-level opponent`, async () => {
        const w = await contest();
        const now = Date.now();
        const fight = battle({ createdAt: now - 1000, endedAt: now - 10, winner });
        fight.p1.character.level = 19;
        fight.p2.character.level = 19;
        const loser = winner === 'p1' ? HOLDOUT : RAIDER;
        await kv.set(`save:${loser}`, { character: { level: 100, createdAt: now - 60_000 } });
        await register(fight, w.id);
        const result = await settle(fight);
        assert.equal(result.outcome, 'applied');
        const receipt = (await row(w.id)).appliedBattles![0];
        assert.ok(receipt.points > 0);
        assert.equal(receipt.purseEligible, false, 'sealed level19 wins over the later saved level100');
        assert.equal(receipt.by, winner === 'p1' ? RAIDER : HOLDOUT);
    });
    it('unavailable account evidence leaves the continuation retryable, then pays an eligible result once', async () => {
        const w = await contest();
        const now = Date.now();
        const fight = battle({ createdAt: now - 1000, endedAt: now - 10, winner: 'p1' });
        await register(fight, w.id);
        const saved = await kv.get(`save:${HOLDOUT}`);
        await kv.del(`save:${HOLDOUT}`);
        await assert.rejects(settle(fight), /account-evidence-unavailable/);
        assert.equal((await row(w.id)).attackerPoints, 0);
        assert.equal(await store.loadSectorWarResolutionReceipt(fight.battleId), null);
        await kv.set(`save:${HOLDOUT}`, saved);
        assert.equal((await settle(fight)).outcome, 'applied');
        const committed = await row(w.id);
        assert.equal(committed.appliedBattles![0].purseEligible, true);
        await settle(fight);
        assert.equal((await row(w.id)).attackerPoints, committed.attackerPoints);
    });
});

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

describe('world PvP sector continuation: the verified sector binds the fight', { concurrency: false }, () => {
    // `rewardSector` is stamped only when the creator opts into base rewards. A
    // tampered client that opted out still got a world-authority fight in the
    // contested sector, but it never bound to the war, so a defender who won it
    // scored nothing. The sector the server verified from both fighters'
    // presence binds it now.
    it('binds and scores a world fight that opted out of base rewards', async () => {
        const w = await contest();
        const now = Date.now();
        const fight = {
            ...battle({ createdAt: now - 1000, endedAt: now - 10, winner: 'p2' }),
            rewardSector: undefined,
            worldTerritoryEvidence: { version: 1, sector: SECTOR, ownerClan: '', ownerVillage: DEFENDER, raidDamage: 0, observedAt: now - 1000 },
        } as unknown as PvpSession;
        assert.equal((await ensure(fight)).registered, true, 'the fight binds to the war in its verified sector');
        const receipt = await settle(fight);
        assert.equal(receipt.outcome, 'applied');
        assert.equal(receipt.attackerWon, false);
        assert.equal((await row(w.id)).defenderPoints, 5, 'and the defender\'s win counts');
    });
});

describe('world PvP sector continuation: an unreadable contest row', { concurrency: false }, () => {
    // The runbook's promise is "play skips it". The recovery lookup read every
    // candidate row strictly, so one corrupt row threw for EVERY decisive fight
    // between its two villages in that sector, bound to the war or not, and
    // neither fighter could finish claiming their rewards until it was repaired.
    it('skips it for a fight not bound to that war, and still fails closed for one that is', async () => {
        const w = await contest({}, 3);
        const raw = (await kv.get<Record<string, unknown>>(war.sectorWarKey(w.id)))!;
        await kv.set(war.sectorWarKey(w.id), { ...raw, appliedBattles: 'corrupt' });
        const now = Date.now();

        const unbound = battle({ createdAt: now - 1000, endedAt: now - 10, winner: 'p1' });
        assert.equal((await settle(unbound)).outcome, 'not-applicable', 'an ordinary fight still completes');

        const bound = battle({ createdAt: now - 1000, endedAt: now - 10, winner: 'p1' });
        await register(bound, w.id);
        await assert.rejects(settle(bound), /ledger-invalid/, 'a fight bound to the broken war waits for the repair');
    });
});

describe('world PvP sector continuation: the era war-battle credit', { concurrency: false }, () => {
    // Legacy failures keep both fighters' rewards pending until a retry lands
    // them. The era war-battle credit deliberately does not: no era gates on
    // warBattles yet, so a failed write must not hold either payout.
    it('never holds the claim, and a later replay counts the battle once', async (t) => {
        const previousFlag = process.env.ENABLE_LEGACY;
        process.env.ENABLE_LEGACY = '1';
        try {
            const { readEraContributions } = await import('../_era.js');
            const w = await contest();
            const now = Date.now();
            for (const [name, village] of [[RAIDER, ATTACKER], [HOLDOUT, DEFENDER]]) {
                await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, level: 50 } });
            }
            // Long enough to earn Legacy war credit (15 s), so the first
            // settle proves Legacy lands before the era write fails.
            const fight = { ...battle({ createdAt: now - 60_000, endedAt: now - 10, winner: 'p1' }), lastMoveAt: now - 10 } as PvpSession;
            await register(fight, w.id);

            const restore = failEraWarBattleWrites(t);
            const receipt = await settle(fight);
            restore();
            assert.equal(receipt.outcome, 'applied', 'the battle settles through the failed era write');
            assert.equal((await row(w.id)).attackerPoints, 5);
            assert.equal((await kv.get<{ warPvpKills?: number }>(`legacy:stats:${RAIDER}`))?.warPvpKills, 1);
            assert.equal((await readEraContributions()).warBattles, 0, 'the failed write counted nothing');

            assert.deepEqual(await settle(fight), receipt, 'either fighter\'s replay returns the same receipt');
            assert.equal((await readEraContributions()).warBattles, 1, 'and retries the era credit');
            assert.deepEqual(await settle(fight), receipt);
            assert.equal((await readEraContributions()).warBattles, 1, 'a replay never counts the battle twice');
            assert.equal((await row(w.id)).attackerPoints, 5, 'nor scores it twice');
            assert.equal((await kv.get<{ warPvpKills?: number }>(`legacy:stats:${RAIDER}`))?.warPvpKills, 1, 'nor credits Legacy twice');
        } finally {
            if (previousFlag === undefined) delete process.env.ENABLE_LEGACY;
            else process.env.ENABLE_LEGACY = previousFlag;
        }
    });

    it('stays non-blocking only while no era gates on war battles', async () => {
        const { ERA_DEFS } = await import('../_era-defs.js');
        const gating = ERA_DEFS.filter((def) => def.milestones.some((m) => m.metric === 'warBattles')).map((def) => def.name);
        assert.deepEqual(gating, [], 'An era now gates on warBattles. Make helpAppliedSectorWarEffects throw when '
            + 'bumpEraContributionOnce returns false, so a failed write keeps the claim pending, and rewrite the test above to expect that.');
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
