import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, beforeEach, after, describe, it } from 'node:test';
import { resolveSectorWeather, sectorWeatherElements } from '../../shared/sector-weather.js';
import { sectorBiomeOf } from '../../shared/sector-geo.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'sector-garrison-test-admin';
process.env.SESSION_SECRET = 'sector-garrison-test-secret-32-bytes-long';

/*
 * Replaces api/village/sector-war-garrison-retired.test.ts (deleted). That
 * file pinned the WRONG-OWNER Tower-backed garrison's retirement (a fail-closed
 * 410 that touched no state). This is the real, rebuilt behavior: garrison-start
 * mints a genuine Solo PvE session against a sealed snapshot of the defending
 * village's real ANBU, and garrison-resolve reads the AUTHORITATIVE finished
 * session and scores the SAME sector-war contest a live-defender fight would —
 * never a client claim, and never Tower's resolveMercBattle/sealTowerFighter.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const SECTOR = 12;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const CONTEST_ID = `${SECTOR}:moonshadowvillage-vs-frostfangvillage`;
const CONTEST_KEY = `shared:sector-war:${CONTEST_ID}`;
const TERRITORY_KEY = `world:territory:${SECTOR}`;
const ATTACKER_PLAYER = 'garrisonattacker';
const ANBU_SLUG = 'garrisonanbu';
const ANBU_VILLAGE_STATE_KEY = 'game:village-state:frostfangvillage';

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./sector-war.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

// Real per-player identity (a minted token), not the admin bypass — the
// ownership/participant checks in doGarrisonStart/doGarrisonResolveLocked are
// all `!identity.admin && ...`, so calling as admin would silently skip
// exactly the checks these tests exist to exercise.
async function call(body: Record<string, unknown>): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const playerName = String(body.playerName ?? '');
    const token = issuePlayerToken(playerName) ?? '';
    const req = {
        method: 'POST',
        body,
        headers: { 'x-player-name': playerName, 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res);
    return out;
}

function activeContest(now: number, over: Record<string, unknown> = {}) {
    const startedAt = now - 3 * 60 * 60 * 1000; // 3h ago — past the 2h liveness idle
    return {
        id: CONTEST_ID, sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER,
        winCondition: 'combat', attackerPoints: 0, defenderPoints: 0,
        startedAt, endsAt: startedAt + 72 * 60 * 60 * 1000, updatedAt: startedAt,
        lastLiveBattleAt: startedAt, flipped: false, appliedBattles: [],
        ...over,
    };
}

async function seedBaseState(now: number, contestOverrides: Record<string, unknown> = {}) {
    await kv.set(TERRITORY_KEY, { sector: SECTOR, ownerVillage: DEFENDER, updatedAt: now });
    await kv.set(CONTEST_KEY, activeContest(now, contestOverrides));
    await kv.set(`save:${ATTACKER_PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: ATTACKER_PLAYER, village: ATTACKER, level: 50,
            maxHp: 9000, hp: 9000, maxChakra: 500, maxStamina: 500,
            stats: {}, jutsu: [], pvpItems: [], equipment: {},
            itemStacks: [{ itemId: 'potion', count: 3 }],
        },
    });
    await kv.set(ANBU_VILLAGE_STATE_KEY, { anbuAppointees: [ANBU_SLUG] });
    await kv.set(`save:${ANBU_SLUG}`, {
        character: {
            name: 'Frostfang Anbu', village: DEFENDER, level: 100,
            maxHp: 12000, hp: 12000, maxChakra: 1000, maxStamina: 1000,
            // A distinctive, non-default stat proves the seal reads the ANBU's
            // OWN real save, not a generic scaled bot.
            stats: { taijutsuOffense: 7777 },
            jutsu: [], pvpItems: [], equipment: {},
        },
    });
}

async function startGarrison(): Promise<ResponseOut> {
    return call({ action: 'garrison-start', playerName: ATTACKER_PLAYER, sector: SECTOR });
}

async function terminateSession(runId: string, outcome: 'win' | 'loss') {
    const key = `solo-pve:${runId}`;
    const session = await kv.get<Record<string, unknown>>(key);
    if (!session) throw new Error('session not found');
    const player = session.player as Record<string, unknown>;
    const now = Date.now();
    await kv.set(key, {
        ...session,
        status: 'done',
        winner: outcome === 'win' ? 'player' : 'enemy',
        outcome,
        player: { ...player, hp: outcome === 'win' ? Math.floor(Number(player.hp) * 0.4) : 0 },
        itemsUsed: { potion: 1 },
        terminalEvidence: {
            finishedAt: now, finalMoveToken: 'test-token', finalVersion: 1, finalEventSeq: 0,
            winner: outcome === 'win' ? 'player' : 'enemy', outcome,
            itemsUsed: { potion: 1 }, settlementState: 'pending',
        },
    });
}

describe('Sector Combat garrison assault (rebuilt on Solo PvE)', { concurrency: false }, () => {
    it('refuses to assault before the liveness idle has elapsed', async () => {
        const now = Date.now();
        await seedBaseState(now, { startedAt: now - 60_000, lastLiveBattleAt: now - 60_000 });
        const response = await startGarrison();
        assert.equal(response.statusCode, 409);
        assert.match(String(response.body?.error), /can be assaulted in \d+ min/);
        assert.equal(await kv.get(`sector-war-garrison-active:${ATTACKER_PLAYER}:${SECTOR}`), null);
    });

    it('refuses a non-attacker village member', async () => {
        const now = Date.now();
        await seedBaseState(now);
        await kv.set(`save:${ATTACKER_PLAYER}`, {
            _saveVersion: 1,
            character: { name: ATTACKER_PLAYER, village: DEFENDER, level: 50, maxHp: 9000, hp: 9000 },
        });
        const response = await startGarrison();
        assert.equal(response.statusCode, 403);
    });

    it('seals the defending village\'s REAL appointed ANBU (their own save), never scales to the attacker', async () => {
        const now = Date.now();
        await seedBaseState(now); // attacker is level 50; the seeded ANBU is level 100
        const response = await startGarrison();
        assert.equal(response.statusCode, 200, JSON.stringify(response.body));
        const body = response.body as { runId: string; session: { encounter: { level: number; sourceId: string } } };
        // Per owner ruling, the garrison "goes off the defender" — the encounter
        // is built from the ANBU's OWN level, never floored/scaled to the
        // attacker's (the retired design fielded a generic bot at
        // max(40, attackerLevel), which here would have been 50, not 100).
        assert.equal(body.session.encounter.level, 100);
        assert.notEqual(body.session.encounter.level, 50);
        assert.equal(body.session.encounter.sourceId, ANBU_SLUG);
        // Masked display name (privacy, like Anbu Infiltration) but numbered by
        // roster position (owner ruling) so a returning attacker can tell
        // whether it's the same Anbu or a rotation.
        assert.equal((response.body as { anbu: { name: string } }).anbu.name, 'Frostfang Anbu #1');
        // The session is stored under the normal Solo PvE keyspace, reachable by
        // the generic /solo-pve/action route — no bespoke combat loop.
        assert.ok(await kv.get(`solo-pve:${body.runId}`));
    });

    it('replays the same active session on a second garrison-start (resumable, not a fresh mint)', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const first = await startGarrison();
        const second = await startGarrison();
        assert.equal((first.body as { runId: string }).runId, (second.body as { runId: string }).runId);
        assert.equal((second.body as { replayed: boolean }).replayed, true);
    });

    it('refuses to resolve an unfinished assault', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const started = await startGarrison();
        const runId = (started.body as { runId: string }).runId;
        const response = await call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        assert.equal(response.statusCode, 409);
    });

    it('a fallen garrison scores the contest (half-weight, garrison-capped) and settles the attacker\'s own item usage + HP', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const started = await startGarrison();
        const runId = (started.body as { runId: string }).runId;
        await terminateSession(runId, 'win');

        const response = await call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        assert.equal(response.statusCode, 200, JSON.stringify(response.body));
        const body = response.body as {
            outcome: string; attackerWon: boolean; points: number;
            attackerPoints: number; defenderPoints: number; character: Record<string, unknown>;
        };
        assert.equal(body.outcome, 'attacker');
        assert.equal(body.attackerWon, true);
        // ROLE_VILLAGER (5) win-swing, halved by GARRISON_POINTS_FRACTION (0.5),
        // floored: floor(5 * 0.5) = 2.
        assert.equal(body.points, 2);
        assert.equal(body.attackerPoints, 2);
        assert.equal(body.defenderPoints, 0);

        const contest = await kv.get<{ attackerPoints: number; appliedBattles: Array<{ garrison?: boolean }> }>(CONTEST_KEY);
        assert.equal(contest?.attackerPoints, 2);
        assert.equal(contest?.appliedBattles?.[0]?.garrison, true);

        // The attacker's own save reflects the fight's physical cost — never a
        // free, consequence-free item-farm against a real AI opponent.
        const stacks = body.character.itemStacks as Array<{ itemId: string; count: number }>;
        assert.equal(stacks.find(s => s.itemId === 'potion')?.count, 2);
        assert.equal(body.character.hp, 3600); // 9000 * 0.4, sealed by terminateSession

        // Retrying the resolve call replays the exact cached response instead of
        // scoring the contest (or burning the item) a second time.
        const replay = await call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        assert.deepEqual(replay.body, response.body);
        const contestAfterReplay = await kv.get<{ attackerPoints: number }>(CONTEST_KEY);
        assert.equal(contestAfterReplay?.attackerPoints, 2);
    });

    it('a held garrison scores the DEFENDER (merc-repel weight) and still settles the attacker\'s HP/hospital', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const started = await startGarrison();
        const runId = (started.body as { runId: string }).runId;
        await terminateSession(runId, 'loss');

        const response = await call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        assert.equal(response.statusCode, 200, JSON.stringify(response.body));
        const body = response.body as {
            outcome: string; attackerWon: boolean; points: number;
            attackerPoints: number; defenderPoints: number; character: Record<string, unknown>;
        };
        assert.equal(body.outcome, 'garrison');
        assert.equal(body.attackerWon, false);
        // ROLE_VILLAGER (5) loss-swing, quartered by MERC_REPEL_POINTS_FRACTION
        // (0.25), floored: floor(5 * 0.25) = 1.
        assert.equal(body.points, 1);
        assert.equal(body.attackerPoints, 0);
        assert.equal(body.defenderPoints, 1);
        assert.equal(body.character.hp, 0);
        assert.equal(body.character.hospitalized, true);
    });

    it('scores past the old 200-receipt ceiling, and a resolve whose cached reply was lost replays, never re-scores', async () => {
        const now = Date.now();
        const old = Array.from({ length: 200 }, (_, i) => ({
            battleId: `old-${i}`, attackerWon: false, points: 1, by: 'defender', at: now - 3 * 60 * 60 * 1000 + i,
        })).reverse();
        await seedBaseState(now, { appliedBattles: old, defenderPoints: 200 });
        const started = await startGarrison();
        const runId = (started.body as { runId: string }).runId;
        await terminateSession(runId, 'win');

        const response = await call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        assert.equal(response.statusCode, 200, JSON.stringify(response.body));
        assert.equal((response.body as { points: number }).points, 2, 'same garrison weight as ever');
        const contest = await kv.get<{ attackerPoints: number; appliedBattles: unknown[]; battleLedger: { count: number; lastGarrisonAt: number } }>(CONTEST_KEY);
        assert.equal(contest?.attackerPoints, 2);
        assert.equal(contest?.appliedBattles.length, 200, 'the in-row mirror did not grow');
        assert.equal(contest?.battleLedger.count, 201);
        assert.ok(contest!.battleLedger.lastGarrisonAt > 0);

        // Lose the run's cached settlement (a crash after scoring, before the
        // run write). The retry must find the battle's receipt — which lives
        // only externally past the mirror — and replay it.
        const runKey = `sector-war-garrison:${runId}`;
        const run = await kv.get<Record<string, unknown>>(runKey);
        const { settlement: _lost, ...unsettled } = run!;
        await kv.set(runKey, unsettled);
        const retried = await call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        assert.equal(retried.statusCode, 200, JSON.stringify(retried.body));
        assert.equal((retried.body as { points: number }).points, 2);
        const after = await kv.get<{ attackerPoints: number; battleLedger: { count: number } }>(CONTEST_KEY);
        assert.equal(after?.attackerPoints, 2, 'scored once');
        assert.equal(after?.battleLedger.count, 201);
    });

    it('an assault opened against an earlier war on the sector never scores its replacement', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const started = await startGarrison();
        const runId = (started.body as { runId: string }).runId;
        await terminateSession(runId, 'win');
        // The war this run was opened against ended and a new declaration took
        // the same contest id (and restarted at generation 1) AFTER the run began.
        const run = await kv.get<{ createdAt: number }>(`sector-war-garrison:${runId}`);
        const replacementStart = run!.createdAt + 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        await kv.set(CONTEST_KEY, activeContest(now, { startedAt: replacementStart, endsAt: replacementStart + 72 * 3600_000, lastLiveBattleAt: replacementStart }));
        const response = await call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        assert.equal(response.statusCode, 200, JSON.stringify(response.body));
        assert.equal((response.body as { outcome: string }).outcome, 'superseded');
        assert.equal((await kv.get<{ attackerPoints: number }>(CONTEST_KEY))?.attackerPoints, 0);
    });

    it('abandoning copies every battle receipt out before the record starts to expire', async () => {
        const now = Date.now();
        const old = Array.from({ length: 150 }, (_, i) => ({
            battleId: `old-${i}`, attackerWon: i % 2 === 0, points: 1, by: i % 2 === 0 ? ATTACKER_PLAYER : 'defender', at: now - 3 * 60 * 60 * 1000 + i,
        })).reverse();
        await seedBaseState(now, { appliedBattles: old, attackerPoints: 75, defenderPoints: 75 });
        await kv.set('village:kage:moonshadow-village', { seatedKage: ATTACKER_PLAYER });
        const response = await call({ action: 'abandon', playerName: ATTACKER_PLAYER, sector: SECTOR });
        assert.equal(response.statusCode, 200, JSON.stringify(response.body));
        assert.equal((response.body as { contest: Record<string, unknown> }).contest.battleLedger, undefined, 'never projected');
        const row = await kv.get<Record<string, unknown>>(CONTEST_KEY);
        assert.equal((row?.battleLedger as { mirrorExternalized: boolean }).mirrorExternalized, true);
        assert.equal((row?.battleLedger as { pending: unknown[] }).pending.length, 0);
        const receipts = await kv.keys('shared:sector-war-battle:*');
        assert.equal(receipts.length, 150, 'every receipt now outlives the conceded record');
    });

    it('only the attacker of THIS assault may resolve it', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const started = await startGarrison();
        const runId = (started.body as { runId: string }).runId;
        await terminateSession(runId, 'win');
        const response = await call({ action: 'garrison-resolve', playerName: 'someoneelse', runId });
        assert.equal(response.statusCode, 403);
    });

    it('has no Tower resolver reachability, and still exposes every existing action untouched', () => {
        const source = readFileSync(join(process.cwd(), 'api', 'village', 'sector-war.ts'), 'utf8');
        assert.doesNotMatch(source, /towers\/_merc-fighters|\bresolveMercBattle\b|\bsealTowerFighter\b/);
        assert.match(source, /case 'garrison-start': return await doGarrisonStart\(/);
        assert.match(source, /case 'garrison-resolve': return await doGarrisonResolve\(/);
        assert.match(source, /case 'declare': return await doDeclare\(/);
        assert.match(source, /case 'attack': return await doAttack\(/);
        assert.match(source, /case 'resolve': return await doResolve\(/);
        assert.match(source, /case 'abandon': return await doAbandon\(/);
        assert.match(source, /case 'status': return await doStatus\(/);
        assert.match(source, /case 'seed': return await doSeed\(/);
    });
});

// A garrison assault's result used to settle only when the attacker's client
// reported it. Every case below is a way that report never came — or came too
// late — and what the server does about it now.
describe('Sector Combat garrison — a fight always settles, and never heals', { concurrency: false }, () => {
    let fightOutcome: Handler;
    let soloPveAction: Handler;
    let resetRateLimits: () => void;

    before(async () => {
        fightOutcome = (await import('../pve/fight-outcome.js')).default as unknown as Handler;
        soloPveAction = (await import('../solo-pve/action.js')).default as unknown as Handler;
        ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    });
    beforeEach(() => resetRateLimits());

    async function callHandler(target: Handler, body: Record<string, unknown>): Promise<ResponseOut> {
        const { res, out } = fakeRes();
        const playerName = String(body.playerName ?? '');
        const req = {
            method: 'POST',
            body,
            headers: { 'x-player-name': playerName, 'x-player-token': issuePlayerToken(playerName) ?? '' },
            socket: { remoteAddress: '127.0.0.1' },
        } as never;
        await target(req, res);
        return out;
    }

    async function setAttackerHp(hp: number) {
        const save = await kv.get<Record<string, unknown>>(`save:${ATTACKER_PLAYER}`);
        await kv.set(`save:${ATTACKER_PLAYER}`, { ...save, character: { ...(save!.character as Record<string, unknown>), hp } });
    }
    const attackerSave = async () => (await kv.get<{ character: Record<string, unknown> }>(`save:${ATTACKER_PLAYER}`))!.character;
    const contestRow = async () => (await kv.get<{ attackerPoints: number; defenderPoints: number; appliedBattles?: unknown[] }>(CONTEST_KEY))!;

    /** Run `fn` with the wall clock `aheadMs` in the future (the memory store
     *  expires keys against Date.now, so this is how an hour passes). */
    async function later<T>(aheadMs: number, fn: () => Promise<T>): Promise<T> {
        const realNow = Date.now;
        Date.now = () => realNow() + aheadMs;
        try { return await fn(); } finally { Date.now = realNow; }
    }

    it('a wounded attacker who starts an assault and walks out is never healed by it', async () => {
        const now = Date.now();
        await seedBaseState(now);
        await setAttackerHp(3_000); // of 9 000
        const started = await startGarrison();
        assert.equal(started.statusCode, 200, JSON.stringify(started.body));
        const { runId, session } = started.body as { runId: string; session: { player: { hp: number } } };
        assert.equal(session.player.hp, 3_000, 'the attacker enters with the HP their save holds');

        // Walk out through the generic physical-settlement endpoint: an abandon.
        const walked = await callHandler(fightOutcome, { playerName: ATTACKER_PLAYER, runId });
        assert.equal(walked.statusCode, 200, JSON.stringify(walked.body));
        // The abandon costs 10% of max HP, from where the attacker stood — it
        // used to start from a full 9 000 pool and write 8 100 back.
        assert.equal((await attackerSave()).hp, 2_100);
    });

    it('a finished assault nobody reported is settled by the next garrison-start — once, and shown', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const started = await startGarrison();
        const runId = (started.body as { runId: string }).runId;
        await terminateSession(runId, 'win');

        // No garrison-resolve: the client never reported it.
        const again = await startGarrison();
        assert.equal(again.statusCode, 200, JSON.stringify(again.body));
        const body = again.body as { settledPrevious?: boolean; runId: string; result: { outcome: string; points: number; attackerPoints: number } };
        assert.equal(body.settledPrevious, true, 'the unreported assault comes back settled, not resumed or orphaned');
        assert.equal(body.runId, runId);
        assert.equal(body.result.outcome, 'attacker');
        assert.equal(body.result.points, 2);
        assert.equal((await contestRow()).attackerPoints, 2);
        assert.equal(potionCount((await attackerSave())), 2, 'and its item cost landed');

        // Exactly once: the client's own late report replays it...
        const late = await call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        assert.deepEqual(late.body, body.result);
        // ...and the NEXT start is a genuinely new assault.
        const next = await startGarrison();
        assert.equal(next.statusCode, 200, JSON.stringify(next.body));
        assert.notEqual((next.body as { runId: string }).runId, runId);
        assert.equal((next.body as { replayed: boolean }).replayed, false);
        assert.equal((await contestRow()).attackerPoints, 2, 'scored once');
    });

    it('an assault fought past the old one-hour record still settles', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const started = await startGarrison();
        const runId = (started.body as { runId: string }).runId;
        // Two hours of play (every action slides the fight's idle window), then
        // the result: the run record used to have expired at the hour mark.
        const resolved = await later(2 * 60 * 60 * 1000, async () => {
            await terminateSession(runId, 'win');
            return call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        });
        assert.equal(resolved.statusCode, 200, JSON.stringify(resolved.body));
        assert.equal((resolved.body as { outcome: string }).outcome, 'attacker');
        assert.equal((await contestRow()).attackerPoints, 2);
    });

    it('an assault left idle past its window counts as a walk-out, and settles on the next start', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const started = await startGarrison();
        assert.equal(started.statusCode, 200, JSON.stringify(started.body));
        const again = await later(46 * 60 * 1000, () => startGarrison());
        assert.equal(again.statusCode, 200, JSON.stringify(again.body));
        const body = again.body as { settledPrevious?: boolean; result: { outcome: string; lapsed?: boolean; defenderPoints: number } };
        assert.equal(body.settledPrevious, true, 'a lapsed assault is ended and settled, not resumed');
        assert.equal(body.result.outcome, 'garrison', 'walking away is a loss: the garrison held');
        assert.equal(body.result.lapsed, true);
        assert.equal((await contestRow()).defenderPoints, 1, 'the defence gets its hold');
        assert.equal((await attackerSave()).hp, 8_100, 'the walk-out cost its 10%');
    });

    it('the request that ENDS the fight settles it — no client report needed', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const started = await startGarrison();
        const { runId, session } = started.body as { runId: string; session: { version: number } };
        const acted = await callHandler(soloPveAction, {
            playerName: ATTACKER_PLAYER, sessionId: runId, type: 'abandon',
            expectedVersion: session.version, moveToken: 'garrison-hook-abandon-1',
        });
        assert.equal(acted.statusCode, 200, JSON.stringify(acted.body));
        assert.equal((acted.body as { session: { status: string } }).session.status, 'done');

        const run = await kv.get<{ settlement?: { response: Record<string, unknown> } }>(`sector-war-garrison:${runId}`);
        assert.ok(run?.settlement, 'settled by the fight\'s own final request');
        assert.equal((await contestRow()).defenderPoints, 1);
        assert.equal((await attackerSave()).hp, 8_100);

        // The client's report is now a replay of that settlement.
        const reported = await call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        assert.deepEqual(reported.body, run!.settlement!.response);
        assert.equal((await contestRow()).defenderPoints, 1);
    });

    it('a late settle never re-heals: the generic walk-out path and the garrison settle share one body', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const started = await startGarrison();
        const runId = (started.body as { runId: string }).runId;
        await terminateSession(runId, 'win'); // ends at 40% = 3 600
        const resolved = await call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        assert.equal(resolved.statusCode, 200, JSON.stringify(resolved.body));
        assert.equal((await attackerSave()).hp, 3_600);

        // Hurt elsewhere afterwards, then the same fight reported again through
        // the generic endpoint: it must not set HP back up to the fight's end.
        await setAttackerHp(1_000);
        const again = await callHandler(fightOutcome, { playerName: ATTACKER_PLAYER, runId });
        assert.equal(again.statusCode, 200, JSON.stringify(again.body));
        assert.equal((await attackerSave()).hp, 1_000);
    });

    it('scores by the battle\'s own clock: a fight that ended inside the war counts when settled after it', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const started = await startGarrison();
        const runId = (started.body as { runId: string }).runId;
        await terminateSession(runId, 'win'); // finished now, inside the war
        // The war's window closes (not yet settled) before anyone reports it.
        const row = await kv.get<Record<string, unknown>>(CONTEST_KEY);
        await kv.set(CONTEST_KEY, { ...row, endsAt: Date.now() + 50 });
        await new Promise((resolve) => setTimeout(resolve, 80));
        const resolved = await call({ action: 'garrison-resolve', playerName: ATTACKER_PLAYER, runId });
        assert.equal(resolved.statusCode, 200, JSON.stringify(resolved.body));
        assert.equal((resolved.body as { outcome: string }).outcome, 'attacker');
        assert.equal((await contestRow()).attackerPoints, 2);
    });
});

function potionCount(character: Record<string, unknown>): number | undefined {
    return (character.itemStacks as Array<{ itemId: string; count: number }> | undefined)?.find((s) => s.itemId === 'potion')?.count;
}

// The garrison stands in for a human sector-war duel, and that duel seals the
// sector's sky (api/pvp/session.ts). The stand-in must fight under the same one,
// on the defender's terrain, or the two halves of one contest score differently.
describe('Sector Combat garrison assault — the sector sky', { concurrency: false }, () => {
    // The start limiter (12 a minute per player) outlives the per-test KV wipe,
    // and the cases above already spend most of the seeded attacker's budget,
    // so these assault as a copy of that attacker under their own name.
    async function startAs(playerName: string): Promise<ResponseOut> {
        const save = await kv.get<Record<string, unknown>>(`save:${ATTACKER_PLAYER}`);
        await kv.set(`save:${playerName}`, { ...save, character: { ...(save?.character as Record<string, unknown>), name: playerName } });
        return call({ action: 'garrison-start', playerName, sector: SECTOR });
    }

    it('seals the sky a holding clan has stamped on the sector', async () => {
        const now = Date.now();
        await seedBaseState(now);
        await kv.set(TERRITORY_KEY, { sector: SECTOR, ownerVillage: DEFENDER, ownerClan: 'Frost Wardens', weather: 'thunderstorm', updatedAt: now });
        const response = await startAs('garrisonskystamp');
        assert.equal(response.statusCode, 200, JSON.stringify(response.body));
        const env = (response.body as { session: { environment: Record<string, unknown> } }).session.environment;
        assert.equal(env.weatherPositiveElement, 'Lightning');
        assert.equal(env.weatherNegativeElement, 'Wind');
    });

    it('seals the scheduled sky of an unheld sector at the moment the assault starts', async () => {
        const now = Date.now();
        await seedBaseState(now);
        const territory = await kv.get<Record<string, unknown>>(TERRITORY_KEY);
        const skyAt = (ms: number) => sectorWeatherElements(resolveSectorWeather(sectorBiomeOf(SECTOR), SECTOR, ms, territory));
        const before = skyAt(Date.now());
        const response = await startAs('garrisonskysched');
        const afterwards = skyAt(Date.now());
        assert.equal(response.statusCode, 200, JSON.stringify(response.body));
        const env = (response.body as { session: { environment: Record<string, unknown> } }).session.environment;
        // A sealed clear sky is still a string; undefined would mean nothing was sealed.
        assert.equal(typeof env.weatherPositiveElement, 'string');
        assert.ok(
            [before, afterwards].some((sky) => sky.positiveElement === env.weatherPositiveElement && sky.negativeElement === env.weatherNegativeElement),
            `sealed ${JSON.stringify(env)} is not the sector's scheduled sky ${JSON.stringify([before, afterwards])}`,
        );
    });
});
