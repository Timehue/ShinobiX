/* Sector-war card duels pay Chronicle Points (owner request 2026-10-22):
 * duels between players at the war table and in the open world pay 20 / 8
 * under the free-play rules, and a won garrison assault pays 15. Through the
 * real /api/village/sector-card handler on the isolated memory store. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'card-cp-sector-war-secret-32-bytes-ok';
delete process.env.DISABLE_VILLAGE_WAR;

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { statusCode: number; body: Record<string, unknown> };

const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const RAIDER = 'cpraider';
const HOLDOUT = 'cpholdout';
const ANBU = 'cpanbu';
const IDLE_MS = 2 * 60 * 60 * 1000;

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let war: typeof import('../_sector-war.js');
let villageStateKey: typeof import('../_anbu-infiltration-store.js').villageStateKey;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    war = await import('../_sector-war.js');
    ({ villageStateKey } = await import('../_anbu-infiltration-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    const card = await import('./sector-card.js');
    handler = ((card.default as unknown as { default?: Handler })?.default ?? card.default) as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    resetRateLimits();
    await kv.set(`save:${RAIDER}`, { _saveVersion: 1, character: { name: RAIDER, village: ATTACKER, chroniclePoints: 0 } });
    await kv.set(`save:${HOLDOUT}`, { _saveVersion: 1, character: { name: HOLDOUT, village: DEFENDER, chroniclePoints: 0 } });
    await kv.set(`save:${ANBU}`, { _saveVersion: 1, character: { name: ANBU, village: DEFENDER } });
    await kv.set(villageStateKey(DEFENDER), { anbuAppointees: [ANBU] });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function call(player: string, body: Record<string, unknown>): Promise<Reply> {
    const out: Reply = { statusCode: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (b: Record<string, unknown>) => { out.body = b; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST', body: { playerName: player, ...body },
        headers: { 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

async function pointsOf(name: string): Promise<number> {
    return Number((await kv.get<{ character: { chroniclePoints?: number } }>(`save:${name}`))?.character.chroniclePoints ?? 0);
}

let sector = 40;
async function seedContest(idleMs = 0) {
    sector += 1;
    const now = Date.now();
    const contest = war.newSectorWarSession({
        sector, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'card', now: now - 3 * 60 * 60 * 1000,
    });
    if (idleMs) contest.lastLiveBattleAt = now - idleMs;
    await kv.set(war.sectorWarKey(contest.id), contest);
    return contest;
}

type StoredDuel = {
    status: string; updatedAt: number;
    state: { status: string; winner: string | null; turnNumber: number };
    participation?: { startedAt: number; p1Actions: number; p2Actions: number; endedBy?: string };
};

/** Finish a stored duel as a played-out match the given side won. */
async function finish(key: string, winner: 'p1' | 'p2', seconds = 90) {
    const row = await kv.get<StoredDuel>(key);
    assert.ok(row, `no duel row at ${key}`);
    const now = Date.now();
    row.state.status = 'complete';
    row.state.winner = winner;
    row.state.turnNumber = 5;
    row.status = 'done';
    row.updatedAt = now;
    row.participation = { startedAt: now - seconds * 1000, p1Actions: 4, p2Actions: 4, endedBy: 'play' };
    await kv.set(key, row);
}

async function openTable(sectorWarId: string) {
    assert.equal((await call(RAIDER, { action: 'join', sectorWarId })).statusCode, 200);
    const seated = await call(HOLDOUT, { action: 'join', sectorWarId });
    assert.equal(seated.statusCode, 200, JSON.stringify(seated.body));
    const row = await kv.get<StoredDuel>(`sector-card:${sectorWarId}`);
    assert.equal(row?.participation?.p1Actions, 0, 'the table starts counting plays when the match is dealt');
}

describe('sector-war player card duels pay Chronicle Points', { concurrency: false }, () => {
    it('a credited table win pays the winner 20 and the loser 8, once', async () => {
        const contest = await seedContest();
        await openTable(contest.id);
        await finish(`sector-card:${contest.id}`, 'p1');
        const winner = await call(RAIDER, { action: 'state', sectorWarId: contest.id });
        assert.equal(winner.statusCode, 200, JSON.stringify(winner.body));
        assert.deepEqual(winner.body.chroniclePoints, { earned: 20, status: 'paid', pairWeight: 1 });
        assert.equal((winner.body.character as { chroniclePoints: number }).chroniclePoints, 20);
        const loser = await call(HOLDOUT, { action: 'state', sectorWarId: contest.id });
        assert.deepEqual(loser.body.chroniclePoints, { earned: 8, status: 'paid', pairWeight: 1 });
        await call(RAIDER, { action: 'state', sectorWarId: contest.id });
        await call(HOLDOUT, { action: 'state', sectorWarId: contest.id });
        assert.equal(await pointsOf(RAIDER), 20);
        assert.equal(await pointsOf(HOLDOUT), 8);
    });

    it('a forfeited table duel pays nothing', async () => {
        const contest = await seedContest();
        await openTable(contest.id);
        const forfeited = await call(HOLDOUT, { action: 'forfeit', sectorWarId: contest.id });
        assert.equal(forfeited.statusCode, 200, JSON.stringify(forfeited.body));
        assert.equal((forfeited.body.chroniclePoints as { reason?: string }).reason, 'participation');
        assert.equal(await pointsOf(RAIDER) + await pointsOf(HOLDOUT), 0);
    });

    it('an open-world duel pays its winner and decays with the same pair count', async () => {
        const contest = await seedContest();
        // Two credited table duels first: the pair's day count is shared by every card mode.
        for (let i = 0; i < 2; i++) {
            await openTable(contest.id);
            await finish(`sector-card:${contest.id}`, 'p1');
            await call(RAIDER, { action: 'state', sectorWarId: contest.id });
        }
        const engageId = 'ab'.repeat(12);
        const now = Date.now();
        const { CHRONICLE_RULES_VERSION, createMatch } = await import('../../shared/chronicle-duel.js');
        const { CHRONICLE_AI_DECKS } = await import('../card-clash/_ai-engine.js');
        const state = createMatch(RAIDER, [...CHRONICLE_AI_DECKS.hard], HOLDOUT, [...CHRONICLE_AI_DECKS.medium], () => 0.5, now - 120_000);
        state.status = 'complete';
        state.winner = 'p1';
        state.turnNumber = 5;
        await kv.set(`sector-card-open:${engageId}`, {
            rulesVersion: CHRONICLE_RULES_VERSION,
            sectorWarId: contest.id, sector: contest.sector, attackerVillage: ATTACKER, defenderVillage: DEFENDER,
            p1Name: RAIDER, p2Name: HOLDOUT, p1Deck: [], p2Deck: [],
            state, status: 'done',
            open: { engageId, initiator: RAIDER, target: HOLDOUT, joinBy: now },
            participation: { startedAt: now - 120_000, p1Actions: 5, p2Actions: 5, endedBy: 'play' },
            createdAt: now - 130_000, updatedAt: now,
        });
        const opened = await call(RAIDER, { action: 'state', sectorWarId: contest.id, engageId });
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
        assert.deepEqual(opened.body.chroniclePoints, { earned: 10, status: 'paid', pairWeight: 0.5 });
        assert.equal(await pointsOf(RAIDER), 20 + 20 + 10);
        assert.equal(await pointsOf(HOLDOUT), 8 + 8 + 4);
    });
});

describe('sector-war garrison assaults pay Chronicle Points', { concurrency: false }, () => {
    it('a won assault pays 15 once; a forfeited one pays nothing', async () => {
        const won = await seedContest(IDLE_MS + 60_000);
        const opened = await call(RAIDER, { action: 'join', garrison: true, sectorWarId: won.id });
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
        const key = `sector-card-garrison:${won.id}`;
        const row = await kv.get<{ match: { status: string; winner?: string; state: { status: string; winner: string | null } } }>(key);
        row!.match.state.status = 'complete';
        row!.match.state.winner = 'p1';
        row!.match.status = 'done';
        row!.match.winner = 'player';
        await kv.set(key, row);
        const first = await call(RAIDER, { action: 'state', garrison: true, sectorWarId: won.id });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.deepEqual(first.body.chroniclePoints, { earned: 15, status: 'paid' });
        assert.equal((first.body.character as { chroniclePoints: number }).chroniclePoints, 15);
        const replay = await call(RAIDER, { action: 'state', garrison: true, sectorWarId: won.id });
        assert.equal(replay.body.character, undefined);
        assert.equal(await pointsOf(RAIDER), 15);

        const lost = await seedContest(IDLE_MS + 60_000);
        assert.equal((await call(RAIDER, { action: 'join', garrison: true, sectorWarId: lost.id })).statusCode, 200);
        const forfeited = await call(RAIDER, { action: 'forfeit', garrison: true, sectorWarId: lost.id });
        assert.equal(forfeited.statusCode, 200, JSON.stringify(forfeited.body));
        assert.equal(forfeited.body.chroniclePoints, undefined);
        assert.equal(await pointsOf(RAIDER), 15);
    });
});
