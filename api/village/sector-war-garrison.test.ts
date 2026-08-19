import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, beforeEach, after, describe, it } from 'node:test';

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
