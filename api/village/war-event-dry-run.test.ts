import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'war-event-dry-run-admin';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.SESSION_SECRET;
delete process.env.ENABLE_LEGACY;
delete process.env.WAR_EVENT_ID;

/*
 * A dry run of one staffed Village/Sector War event
 * (docs/CONTROLLED_WAR_EVENT_RUNBOOK.md), on the memory store, through the
 * real handlers and the real PvP continuation. Every case is a moment the
 * operators will meet on the day: a battle registered against the wrong
 * sector, the kill switch pulled mid-war, an unreadable contest row, two
 * settlement passes racing, a fighter reconnecting and replaying, a draw, a
 * cancelled war, a settlement that fails once and recovers, and an admin
 * correction. None of them may score twice, lose a score, or wedge a player.
 */

type Session = import('../_sector-war.js').SectorWarSession;
type PvpSession = import('../pvp/session.js').PvpSession;
type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };
type WarEvent = Record<string, unknown>;

const SECTOR = 23;
const OTHER_SECTOR = 24;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const RAIDER = 'raider';
const HOLDOUT = 'holdout';

let kv: typeof import('../_storage.js').kv;
let war: typeof import('../_sector-war.js');
let store: typeof import('../_sector-war-store.js');
let continuation: typeof import('../pvp/_sector-war-continuation.js');
let settlement: typeof import('../_sector-war-settle.js');
let sectorWar: Handler;
let worldState: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    war = await import('../_sector-war.js');
    store = await import('../_sector-war-store.js');
    continuation = await import('../pvp/_sector-war-continuation.js');
    settlement = await import('../_sector-war-settle.js');
    const sectorWarModule = await import('./sector-war.js');
    sectorWar = ((sectorWarModule.default as unknown as { default?: Handler })?.default ?? sectorWarModule.default) as unknown as Handler;
    const worldStateModule = await import('../world-state.js');
    worldState = worldStateModule.default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.DISABLE_VILLAGE_WAR;
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.DISABLE_VILLAGE_WAR;
});

// ── fixtures ────────────────────────────────────────────────────────────────

async function contest(overrides: Partial<Session> = {}): Promise<Session> {
    const now = Date.now();
    const base = war.newSectorWarSession({
        sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'combat', now: now - 60 * 60_000,
    });
    const session: Session = { ...base, declarationGeneration: 1, ...overrides };
    await kv.set(war.sectorWarKey(session.id), session);
    return session;
}

async function row(id: string): Promise<Session> {
    return war.normalizeSectorWarSession((await kv.get(war.sectorWarKey(id))) as never)!;
}

let battleSeq = 0;
/** A world PvP session exactly as pvp/session.ts seals one: both fighters were
 *  present in `rewardSector`, and nobody has moved yet. */
function liveBattle(args: { createdAt: number; rewardSector?: number; battleId?: string }): PvpSession {
    battleSeq += 1;
    return {
        battleId: args.battleId ?? `war-dry-run-${battleSeq}`,
        status: 'active',
        round: 1,
        actionsThisTurn: 0,
        log: ['The duel begins.'],
        biome: 'central',
        createdAt: args.createdAt,
        rewardAuthority: 'world',
        rewardSector: args.rewardSector ?? SECTOR,
        joined: { p1: true, p2: true },
        progressionAuthorityVersion: 1,
        p1: { name: RAIDER, character: { name: RAIDER, village: ATTACKER } },
        p2: { name: HOLDOUT, character: { name: HOLDOUT, village: DEFENDER } },
        worldAttacker: { side: 'p1', name: RAIDER },
    } as unknown as PvpSession;
}

function finished(battle: PvpSession, winner: 'p1' | 'p2' | 'draw', endedAt: number): PvpSession {
    return { ...battle, status: 'done', winner, endedAt } as unknown as PvpSession;
}

async function bindToken(battle: PvpSession, contestId: string, sector = SECTOR) {
    await store.mintSectorWarToken(war.newSectorWarBattleToken({
        battleId: battle.battleId,
        sectorWarId: contestId,
        sector,
        attackerVillage: ATTACKER,
        defenderVillage: DEFENDER,
        registeredBy: RAIDER,
        winCondition: 'combat',
        p1Name: RAIDER,
        p2Name: HOLDOUT,
        p1Village: ATTACKER,
        p2Village: DEFENDER,
        biome: 'central',
        now: battle.createdAt,
    }));
}

function response(): { out: ResponseOut; res: never } {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function asAdmin(handler: Handler, body: Record<string, unknown>): Promise<ResponseOut> {
    const { out, res } = response();
    await handler({
        method: 'POST',
        body,
        query: {},
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD!, 'x-forwarded-for': '127.0.0.1' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res);
    return out;
}

/** Runs `fn` and returns every `[war-event]` line it logged, parsed. */
async function warEvents<T>(fn: () => Promise<T>): Promise<{ result: T; events: WarEvent[] }> {
    const events: WarEvent[] = [];
    const originals = { info: console.info, warn: console.warn, error: console.error };
    const grab = (original: (...args: unknown[]) => void) => (...args: unknown[]) => {
        const text = args.map(String).join(' ');
        if (text.startsWith('[war-event] ')) events.push(JSON.parse(text.slice('[war-event] '.length)) as WarEvent);
        else original(...args);
    };
    console.info = grab(originals.info);
    console.warn = grab(originals.warn);
    console.error = grab(originals.error);
    try {
        return { result: await fn(), events };
    } finally {
        Object.assign(console, originals);
    }
}

// ── D1: a battle is bound only to the sector it was fought in ───────────────

describe('war event: battle registration is bound to the battle\'s own sector', { concurrency: false }, () => {
    it('a registration naming another contested sector binds nothing and wedges nobody', async () => {
        const w = await contest();
        const battle = liveBattle({ createdAt: Date.now() - 1000, rewardSector: OTHER_SECTOR });
        await kv.set(`pvp:${battle.battleId}`, battle);

        const out = await asAdmin(sectorWar, { action: 'attack', playerName: RAIDER, sector: SECTOR, battleId: battle.battleId });
        assert.equal(out.statusCode, 200, 'a 200 no-op: the client retries any non-200 four times');
        assert.equal(out.body?.registered, false);
        assert.equal(out.body?.reason, 'other-sector');
        assert.equal(await kv.get(war.sectorWarTokenKey(battle.battleId)), null, 'no token was minted');

        // The battle's own first move finds no contest on its sector, and its
        // terminal step is an ordinary no-op rather than an authority conflict.
        assert.deepEqual(await continuation.ensurePvpSectorWarRegistration(battle), { registered: false, noContest: true });
        const receipt = await continuation.settlePvpSectorWarContinuation(finished(battle, 'p1', Date.now()));
        assert.equal(receipt.outcome, 'not-applicable');
        assert.equal((await row(w.id)).attackerPoints, 0);
    });

    it('the token the old endpoint minted is exactly what wedged the battle', async () => {
        // Why the endpoint must never bind another sector: the continuation
        // refuses such a token, and that refusal escapes the terminal step.
        const w = await contest();
        const battle = liveBattle({ createdAt: Date.now() - 1000, rewardSector: OTHER_SECTOR });
        await bindToken(battle, w.id, SECTOR);
        await assert.rejects(
            continuation.settlePvpSectorWarContinuation(finished(battle, 'p1', Date.now())),
            /sector-war-token-authority-conflict/,
        );
    });

    it('a registration for the right sector binds once, and a reconnect replays it', async () => {
        const w = await contest();
        const battle = liveBattle({ createdAt: Date.now() - 1000 });
        await kv.set(`pvp:${battle.battleId}`, battle);

        const { result: first, events } = await warEvents(() =>
            asAdmin(sectorWar, { action: 'attack', playerName: RAIDER, sector: SECTOR, battleId: battle.battleId }));
        assert.equal(first.statusCode, 200);
        assert.equal(first.body?.registered, true);
        assert.equal(first.body?.sectorWarId, w.id);
        assert.deepEqual(events.map((event) => event.kind), ['battle-registered']);
        assert.equal(events[0]!.contestId, w.id);
        assert.equal(events[0]!.battleId, battle.battleId);

        // A reconnecting client registers again: the same binding, replayed.
        const again = await asAdmin(sectorWar, { action: 'attack', playerName: RAIDER, sector: SECTOR, battleId: battle.battleId });
        assert.equal(again.statusCode, 200);
        assert.equal(again.body?.replayed, true);
        // And the first move's server-side registration agrees with it.
        const registration = await continuation.ensurePvpSectorWarRegistration(battle);
        assert.equal(registration.registered, true);
    });
});

// ── scoring, replay, draw ────────────────────────────────────────────────────

describe('war event: a scored battle counts once, however often it is resolved', { concurrency: false }, () => {
    it('a win scores once; the terminal replay and a player\'s resolve both return the same receipt', async () => {
        const w = await contest();
        const battle = liveBattle({ createdAt: Date.now() - 5000 });
        await bindToken(battle, w.id);
        const done = finished(battle, 'p1', Date.now() - 10);
        await kv.set(`pvp:${battle.battleId}`, done);

        const { result: receipt, events } = await warEvents(() => continuation.settlePvpSectorWarContinuation(done));
        assert.equal(receipt.outcome, 'applied');
        assert.equal(receipt.attackerWon, true);
        const points = receipt.points;
        assert.ok(points > 0);
        assert.equal((await row(w.id)).attackerPoints, points);
        const scored = events.filter((event) => event.kind === 'battle-scored');
        assert.equal(scored.length, 1);
        assert.equal(scored[0]!.contestId, w.id);
        assert.equal(scored[0]!.battleId, battle.battleId);
        assert.equal(scored[0]!.instance, war.sectorWarInstanceTag(w));

        // Either fighter reconnects and replays: the terminal barrier again,
        // then the explicit resolve route. Neither adds a point.
        assert.deepEqual(await continuation.settlePvpSectorWarContinuation(done), receipt);
        const resolved = await asAdmin(sectorWar, { action: 'resolve', playerName: HOLDOUT, battleId: battle.battleId });
        assert.equal(resolved.statusCode, 200);
        assert.equal((await row(w.id)).attackerPoints, points, 'still counted exactly once');

        // Nothing the operators search by names a player.
        const logged = JSON.stringify(events);
        assert.ok(!logged.includes(RAIDER) && !logged.includes(HOLDOUT), logged);
    });

    it('concurrent terminal replays by both fighters score the battle once', async () => {
        const w = await contest();
        const battle = liveBattle({ createdAt: Date.now() - 5000 });
        await bindToken(battle, w.id);
        const done = finished(battle, 'p2', Date.now() - 10);
        const results = await Promise.allSettled([
            continuation.settlePvpSectorWarContinuation(done),
            continuation.settlePvpSectorWarContinuation(done),
        ]);
        const receipts = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<unknown>).value);
        assert.ok(receipts.length >= 1, JSON.stringify(results));
        const settled = await continuation.settlePvpSectorWarContinuation(done);
        for (const receipt of receipts) assert.deepEqual(receipt, settled);
        assert.equal((await row(w.id)).defenderPoints, settled.points, 'the defence win counted once');
        assert.equal((await row(w.id)).attackerPoints, 0);
    });

    it('a draw scores nothing for either side', async () => {
        const w = await contest();
        const battle = liveBattle({ createdAt: Date.now() - 5000 });
        await bindToken(battle, w.id);
        const receipt = await continuation.settlePvpSectorWarContinuation(finished(battle, 'draw', Date.now() - 10));
        assert.equal(receipt.outcome, 'not-applicable');
        assert.equal(receipt.points, 0);
        const after = await row(w.id);
        assert.equal(after.attackerPoints, 0);
        assert.equal(after.defenderPoints, 0);
    });
});

// ── D2: the kill switch ───────────────────────────────────────────────────────

describe('war event: DISABLE_VILLAGE_WAR stops world PvP scoring too', { concurrency: false }, () => {
    it('no new battle binds, a bound battle that ends while off scores nothing, and the stop is final', async () => {
        const w = await contest();
        const bound = liveBattle({ createdAt: Date.now() - 5000 });
        await bindToken(bound, w.id);
        const unbound = liveBattle({ createdAt: Date.now() - 4000 });

        process.env.DISABLE_VILLAGE_WAR = '1';
        let receipt;
        try {
            assert.deepEqual(await continuation.ensurePvpSectorWarRegistration(unbound), { registered: false, noContest: true });
            assert.equal(await kv.get(war.sectorWarTokenKey(unbound.battleId)), null);
            const { result, events } = await warEvents(() =>
                continuation.settlePvpSectorWarContinuation(finished(bound, 'p1', Date.now() - 10)));
            receipt = result;
            assert.equal(receipt.outcome, 'superseded');
            assert.equal(receipt.sectorWarId, w.id);
            assert.deepEqual(events.map((event) => [event.kind, event.reason]), [['pvp-resolution', 'war-disabled']]);
            assert.equal((await row(w.id)).attackerPoints, 0);
        } finally {
            delete process.env.DISABLE_VILLAGE_WAR;
        }
        // Switched back on, the battle's outcome stands: a replay returns it.
        assert.deepEqual(await continuation.settlePvpSectorWarContinuation(finished(bound, 'p1', receiptEndedAt(receipt))), receipt);
        assert.equal((await row(w.id)).attackerPoints, 0);
    });

    it('a score that landed before the switch is never lost', async () => {
        const w = await contest();
        const battle = liveBattle({ createdAt: Date.now() - 5000 });
        await bindToken(battle, w.id);
        const done = finished(battle, 'p1', Date.now() - 10);
        // A crash after the contest write, before the per-battle receipt.
        const originalCompareSet = kv.compareSet.bind(kv);
        kv.compareSet = (async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
            if (key === store.sectorWarResolutionReceiptKey(battle.battleId)) throw new Error('injected crash before the resolution receipt');
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        try {
            await assert.rejects(continuation.settlePvpSectorWarContinuation(done), /injected crash/);
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }
        const landed = (await row(w.id)).attackerPoints;
        assert.ok(landed > 0);

        process.env.DISABLE_VILLAGE_WAR = '1';
        try {
            const recovered = await continuation.settlePvpSectorWarContinuation(done);
            assert.equal(recovered.outcome, 'applied', 'recovery completes even with the war off');
            assert.equal(recovered.points, landed);
        } finally {
            delete process.env.DISABLE_VILLAGE_WAR;
        }
        assert.equal((await row(w.id)).attackerPoints, landed, 'and never adds the points again');
    });
});

function receiptEndedAt(receipt: { sessionEndedAt: number } | undefined): number {
    return receipt?.sessionEndedAt ?? Date.now();
}

// ── D3: one unreadable contest row ───────────────────────────────────────────

describe('war event: one unreadable contest row does not take the war down', { concurrency: false }, () => {
    const brokenKey = 'shared:sector-war:30:stormveilvillage-vs-frostfangvillage';

    async function breakAnotherRow() {
        const other = war.newSectorWarSession({
            sector: 30, attackerVillage: 'Stormveil Village', defenderVillage: DEFENDER, winCondition: 'combat', now: Date.now() - 60_000,
        });
        // A receipt whose attackerWon is not a boolean: the normalizer throws.
        await kv.set(brokenKey, { ...other, appliedBattles: [{ battleId: 'x', attackerWon: 'yes', points: 1, at: 1 }] });
    }

    it('world PvP, the war map and the daily pass still see every readable contest', async () => {
        const w = await contest();
        await breakAnotherRow();
        const { result, events } = await warEvents(async () => ({
            onSector: await store.activeContestOnSector(SECTOR),
            all: await store.listActiveSectorWars(),
            forVillage: await store.activeSectorWarsForVillage(ATTACKER),
        }));
        assert.equal(result.onSector?.id, w.id);
        assert.deepEqual(result.all.map((session) => session.id), [w.id]);
        assert.deepEqual(result.forVillage.map((session) => session.id), [w.id]);
        const skipped = events.filter((event) => event.kind === 'contest-row-unreadable');
        assert.ok(skipped.length >= 1);
        assert.equal(skipped[0]!.key, brokenKey);

        // The first move of a world battle on the healthy sector still binds.
        const battle = liveBattle({ createdAt: Date.now() - 1000 });
        const registration = await warEvents(() => continuation.ensurePvpSectorWarRegistration(battle));
        assert.equal(registration.result.registered, true);
    });

    it('ownership guards still fail closed on it', async () => {
        await contest();
        await breakAnotherRow();
        await assert.rejects(store.activeContestOnSector(SECTOR, Date.now(), { strict: true }), /ledger-invalid/);
        await assert.rejects(store.listFundingSectorWars(kv, { strict: true }), /ledger-invalid/);
        await assert.rejects(store.listUnsettledDueSectorWars(Date.now(), kv, { strict: true }), /ledger-invalid/);
    });

    it('settlement still settles a due war beside it', async () => {
        const now = Date.now();
        const w = await contest({ startedAt: now - 73 * 3600_000, endsAt: now - 60_000, attackerPoints: 2, defenderPoints: 5 });
        await kv.set(`world:territory:${SECTOR}`, { sector: SECTOR, ownerVillage: DEFENDER, hp: 20_000, updatedAt: now });
        await breakAnotherRow();
        const { result } = await warEvents(() => settlement.settleDueSectorWars(now));
        assert.deepEqual(result.map((s) => [s.id, s.attackerWon]), [[w.id, false]]);
    });
});

// ── settlement: duplicate passes, a failure and its recovery ────────────────

describe('war event: settlement flips or holds exactly once', { concurrency: false }, () => {
    async function dueWar(points: { attacker: number; defender: number }) {
        const now = Date.now();
        await kv.set(`world:territory:${SECTOR}`, { sector: SECTOR, ownerVillage: DEFENDER, hp: 20_000, updatedAt: now });
        return contest({
            startedAt: now - 73 * 3600_000,
            endsAt: now - 60_000,
            attackerPoints: points.attacker,
            defenderPoints: points.defender,
        });
    }

    it('two passes racing settle the war once and flip the sector once', async () => {
        const w = await dueWar({ attacker: 7, defender: 3 });
        const now = Date.now();
        const { result, events } = await warEvents(() => Promise.all([
            settlement.settleDueSectorWars(now),
            settlement.settleDueSectorWars(now),
        ]));
        const settled = result.flat();
        assert.equal(settled.length, 1, JSON.stringify(settled));
        assert.equal(settled[0]!.attackerWon, true);
        assert.equal((await kv.get<{ ownerVillage?: string }>(`world:territory:${SECTOR}`))?.ownerVillage, ATTACKER);
        assert.equal((await row(w.id)).flipped, true);
        const settledLines = events.filter((event) => event.kind === 'settled');
        assert.equal(settledLines.length, 1);
        assert.equal(settledLines[0]!.outcome, 'captured');
        // The later daily pass finds nothing left to do.
        assert.deepEqual(await settlement.settleDueSectorWars(now + 1000), []);
    });

    it('a pass that fails is logged, leaves the war due, and the next pass settles it once', async () => {
        const w = await dueWar({ attacker: 7, defender: 3 });
        const now = Date.now();
        const territoryKey = `world:territory:${SECTOR}`;
        const originalSet = kv.set.bind(kv);
        const originalCompareSet = kv.compareSet.bind(kv);
        kv.set = (async (key: string, ...rest: unknown[]) => {
            if (key === territoryKey) throw new Error('injected territory write failure');
            return (originalSet as (...args: unknown[]) => Promise<unknown>)(key, ...rest);
        }) as typeof kv.set;
        kv.compareSet = (async (key: string, ...rest: unknown[]) => {
            if (key === territoryKey) throw new Error('injected territory write failure');
            return (originalCompareSet as (...args: unknown[]) => Promise<unknown>)(key, ...rest);
        }) as typeof kv.compareSet;
        let failed;
        try {
            failed = await warEvents(() => settlement.settleDueSectorWars(now));
        } finally {
            kv.set = originalSet as typeof kv.set;
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }
        assert.deepEqual(failed.result, []);
        const deferred = failed.events.filter((event) => event.kind === 'settlement-deferred');
        assert.equal(deferred.length, 1);
        assert.equal(deferred[0]!.contestId, w.id);
        assert.equal(deferred[0]!.reason, 'error');
        assert.match(String(deferred[0]!.error), /injected territory write failure/);
        assert.equal((await row(w.id)).flipped, false, 'the war stays due');
        assert.equal((await kv.get<{ ownerVillage?: string }>(territoryKey))?.ownerVillage, DEFENDER);

        const recovered = await settlement.settleDueSectorWars(now + 1000);
        assert.equal(recovered.length, 1);
        assert.equal((await kv.get<{ ownerVillage?: string }>(territoryKey))?.ownerVillage, ATTACKER);
        assert.deepEqual(await settlement.settleDueSectorWars(now + 2000), []);
    });
});

// ── cancellation and correction ──────────────────────────────────────────────

describe('war event: cancelling a war and correcting a sector leave an audit trail', { concurrency: false }, () => {
    it('an admin abandon ends the war once, audits it once, and later battles cannot score it', async () => {
        const w = await contest({ attackerPoints: 4, defenderPoints: 1 });
        const bound = liveBattle({ createdAt: Date.now() - 5000 });
        await bindToken(bound, w.id);

        const { result: out, events } = await warEvents(() => asAdmin(sectorWar, { action: 'abandon', playerName: 'ops', sector: SECTOR }));
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const after = await row(w.id);
        assert.equal(after.expiredReason, 'abandoned');
        assert.deepEqual(events.map((event) => [event.kind, event.actor]), [['contest-abandoned', 'admin']]);

        const audit = (await kv.get<Array<Record<string, unknown>>>('audit:sector')) ?? [];
        assert.equal(audit.length, 1);
        assert.equal(audit[0]!.action, 'sector-war.abandon');
        assert.equal(audit[0]!.actor, 'admin');
        assert.equal(audit[0]!.entityId, w.id);
        assert.deepEqual(audit[0]!.before, { attackerPoints: 4, defenderPoints: 1, endsAt: w.endsAt });

        // A second request finds no war; the audit is not doubled.
        const again = await asAdmin(sectorWar, { action: 'abandon', playerName: 'ops', sector: SECTOR });
        assert.equal(again.statusCode, 409);
        assert.equal(((await kv.get<unknown[]>('audit:sector')) ?? []).length, 1);

        // A battle bound before the cancel that ends after it scores nothing.
        const receipt = await continuation.settlePvpSectorWarContinuation(finished(bound, 'p1', Date.now()));
        assert.equal(receipt.outcome, 'superseded');
        assert.equal((await row(w.id)).attackerPoints, 4);
    });

    it('an admin territory correction is audited with the owner before and after', async () => {
        const sector = 40;
        await kv.set(`world:territory:${sector}`, {
            sector, ownerVillage: ATTACKER, controlScore: 0, hp: 20_000, terrainBuffStat: 'bukijutsuOffense',
            guards: [], warSupply: 0, updatedAt: Date.now() - 1000,
        });
        const out = await asAdmin(worldState, {
            kind: 'territory',
            territory: {
                sector, ownerVillage: DEFENDER, controlScore: 0, hp: 20_000, terrainBuffStat: 'bukijutsuOffense',
                guards: [], warSupply: 0,
            },
        });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const audit = (await kv.get<Array<Record<string, unknown>>>('audit:sector')) ?? [];
        assert.equal(audit.length, 1);
        assert.equal(audit[0]!.action, 'territory.admin-write');
        assert.equal(audit[0]!.entityId, String(sector));
        assert.equal((audit[0]!.before as Record<string, unknown>).ownerVillage, ATTACKER);
        assert.equal((audit[0]!.after as Record<string, unknown>).ownerVillage, DEFENDER);
    });
});

// ── D6: the pet garrison lock ────────────────────────────────────────────────

describe('war event: pet duels never run their scoring section unlocked', () => {
    it('both sector-pet locks fail closed, and contention answers a retryable 503', () => {
        const source = readFileSync(join(process.cwd(), 'api', 'village', 'sector-pet.ts'), 'utf8');
        const locks = [...source.matchAll(/await withKvLock\(/g)].length;
        const closed = [...source.matchAll(/\}, \{ failClosed: true \}\);/g)].length;
        assert.equal(locks, 2);
        assert.equal(closed, 2, 'every lock in sector-pet.ts passes { failClosed: true }');
        assert.match(source, /if \(err instanceof LockContendedError\) \{\s*return res\.status\(503\)/);
    });
});
