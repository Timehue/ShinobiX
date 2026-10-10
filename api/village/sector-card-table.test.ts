import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sector-card-table-secret-32-bytes-long';
delete process.env.DISABLE_VILLAGE_WAR;

/*
 * The Sector War Card table (api/village/sector-card.ts), through the real
 * handler on the memory store:
 *
 *   - a war that is OVER opens and answers no tables (its row lingers a day);
 *   - a duel that ends after the war did scores nothing and writes no receipt,
 *     and the table says it did not count;
 *   - a contended table answers a retryable 503, and a poll with nothing to say
 *     writes nothing;
 *   - a defender who opens the table before any attacker is seated the moment
 *     one does, instead of waiting on a 403 forever.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const SECTOR = 41;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const RAIDER = 'cardraider';
const HOLDOUT = 'cardholdout';
const IDLE_MS = 2 * 60 * 60 * 1000;

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let war: typeof import('../_sector-war.js');
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    war = await import('../_sector-war.js');
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    const card = await import('./sector-card.js');
    handler = ((card.default as unknown as { default?: Handler })?.default ?? card.default) as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    resetRateLimits();
    await kv.set(`save:${RAIDER}`, { character: { name: RAIDER, village: ATTACKER } });
    await kv.set(`save:${HOLDOUT}`, { character: { name: HOLDOUT, village: DEFENDER } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function call(body: Record<string, unknown>): Promise<ResponseOut> {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (b: Record<string, unknown>) => { out.body = b; return res; },
        end: () => res,
    };
    const playerName = String(body.playerName ?? '');
    const req = {
        method: 'POST',
        body,
        headers: { 'x-player-name': playerName, 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res as never);
    return out;
}

async function seedContest(overrides: Record<string, unknown> = {}) {
    const now = Date.now();
    const contest = { ...war.newSectorWarSession({
        sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'card', now: now - 3 * 60 * 60 * 1000,
    }), ...overrides };
    await kv.set(war.sectorWarKey(contest.id), contest);
    return contest;
}

async function patchContest(id: string, patch: Record<string, unknown>) {
    const row = await kv.get<Record<string, unknown>>(war.sectorWarKey(id));
    await kv.set(war.sectorWarKey(id), { ...row, ...patch });
}

async function receiptsOf(id: string) {
    const row = war.normalizeSectorWarSession((await kv.get(war.sectorWarKey(id))) as never)!;
    return { mirror: row.appliedBattles ?? [], count: row.battleLedger?.count ?? (row.appliedBattles?.length ?? 0), row };
}

async function openLiveDuel(id: string) {
    const opened = await call({ action: 'join', playerName: RAIDER, sectorWarId: id });
    assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
    const answered = await call({ action: 'join', playerName: HOLDOUT, sectorWarId: id });
    assert.equal(answered.statusCode, 200, JSON.stringify(answered.body));
    assert.ok((answered.body?.session as { p1?: unknown }).p1, 'the defender is seated at a live match');
}

describe('Sector War card table — wars that are over', { concurrency: false }, () => {
    it('a defended war (its row still lingering) opens no table', async () => {
        const contest = await seedContest({ expiredAt: Date.now() - 60_000, expiredReason: 'defended' });
        const out = await call({ action: 'join', playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(out.statusCode, 409);
        assert.match(String(out.body?.error), /No active Card contest/);
        assert.equal(await kv.get(`sector-card:${contest.id}`), null, 'and no table was written');
    });

    it('a war past its 72 hours (not yet settled) answers no open table', async () => {
        const contest = await seedContest();
        const opened = await call({ action: 'join', playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
        await patchContest(contest.id, { endsAt: Date.now() - 1 });
        const answered = await call({ action: 'join', playerName: HOLDOUT, sectorWarId: contest.id });
        assert.equal(answered.statusCode, 409);
        assert.equal((await kv.get<{ status: string }>(`sector-card:${contest.id}`))?.status, 'awaiting-defender', 'nobody was seated');
    });
});

describe('Sector War card table — the whistle', { concurrency: false }, () => {
    it('a duel that ends after the war did scores nothing, writes no receipt, and says so', async () => {
        const contest = await seedContest();
        await openLiveDuel(contest.id);
        // The 72 hours run out mid-match; the duel then finishes (a forfeit).
        await patchContest(contest.id, { endsAt: Date.now() - 1 });
        const out = await call({ action: 'forfeit', playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.deepEqual(out.body?.warResult, { scored: false, reason: 'superseded' });
        const { count, row } = await receiptsOf(contest.id);
        assert.equal(count, 0, 'no 0-point receipt (it used to log battle-scored and credit the winner)');
        assert.equal(row.attackerPoints + row.defenderPoints, 0);
        assert.equal((await kv.get<{ status: string }>(`sector-card:${contest.id}`))?.status, 'done');
    });

    it('a duel that ends inside the war reports the points it scored', async () => {
        const contest = await seedContest();
        await openLiveDuel(contest.id);
        const out = await call({ action: 'forfeit', playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const result = out.body?.warResult as { scored: boolean; points: number };
        assert.equal(result.scored, true);
        assert.ok(result.points > 0);
        assert.equal((await receiptsOf(contest.id)).row.defenderPoints, result.points, 'the forfeit is the defender\'s win');
    });

    it('the attacker can still finish their own garrison match after the whistle — it just does not count', async () => {
        const villageState = 'game:village-state:frostfangvillage';
        await kv.set('save:cardanbu', { character: { name: 'cardanbu', village: DEFENDER } });
        await kv.set(villageState, { anbuAppointees: ['cardanbu'] });
        const contest = await seedContest({ lastLiveBattleAt: Date.now() - IDLE_MS - 60_000 });
        const opened = await call({ action: 'join', garrison: true, playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));
        await patchContest(contest.id, { endsAt: Date.now() - 1 });
        const out = await call({ action: 'forfeit', garrison: true, playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.deepEqual(out.body?.warResult, { scored: false, reason: 'superseded' });
        assert.equal((await receiptsOf(contest.id)).count, 0);
    });
});

describe('Sector War card table — load', { concurrency: false }, () => {
    it('a contended table answers a retryable 503, not a 500', async () => {
        const contest = await seedContest();
        await openLiveDuel(contest.id);
        await kv.set(`lock:sector-card:${contest.id}`, 'another-request', { nx: true, ex: 5 });
        const out = await call({ action: 'state', playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(out.statusCode, 503);
        assert.match(String(out.body?.error), /busy/i);
    });

    it('a state poll with nothing new writes nothing', async () => {
        const { battleStateKey } = await import('../_realtime/battle-projection.js');
        const contest = await seedContest();
        await openLiveDuel(contest.id);
        // Both duelists poll every two seconds; each poll used to rewrite the
        // table and both presence rows under the table lock.
        const watched = new Set([`sector-card:${contest.id}`, battleStateKey(RAIDER), battleStateKey(HOLDOUT)]);
        const writes: string[] = [];
        const realSet = kv.set.bind(kv);
        kv.set = (async (key: string, ...rest: unknown[]) => {
            if (watched.has(key)) writes.push(key);
            return (realSet as (...args: unknown[]) => Promise<unknown>)(key, ...rest);
        }) as typeof kv.set;
        try {
            for (const playerName of [RAIDER, HOLDOUT, RAIDER]) {
                const out = await call({ action: 'state', playerName, sectorWarId: contest.id });
                assert.equal(out.statusCode, 200, JSON.stringify(out.body));
                assert.ok((out.body?.session as { p1?: unknown }).p1, 'the poll still answers with the match');
            }
        } finally {
            kv.set = realSet;
        }
        assert.deepEqual(writes, [], 'neither the session nor either presence row was rewritten');
    });
});

describe('Sector War card table — a defender who arrives first', { concurrency: false }, () => {
    it('waits without an error, and is seated the moment an attacker opens the table', async () => {
        const contest = await seedContest();
        const early = await call({ action: 'join', playerName: HOLDOUT, sectorWarId: contest.id });
        assert.equal(early.statusCode, 200, JSON.stringify(early.body));
        assert.deepEqual(early.body?.session, { rulesVersion: (early.body?.session as { rulesVersion: unknown }).rulesVersion, status: 'awaiting-attacker', viewerSide: null });

        const polled = await call({ action: 'state', playerName: HOLDOUT, sectorWarId: contest.id });
        assert.equal(polled.statusCode, 200, JSON.stringify(polled.body));
        assert.equal((polled.body?.session as { status: string }).status, 'awaiting-attacker');
        assert.equal(polled.body?.seatOpen, undefined, 'no seat to take yet');

        const opened = await call({ action: 'join', playerName: RAIDER, sectorWarId: contest.id });
        assert.equal(opened.statusCode, 200, JSON.stringify(opened.body));

        const seat = await call({ action: 'state', playerName: HOLDOUT, sectorWarId: contest.id });
        assert.equal(seat.statusCode, 200, JSON.stringify(seat.body));
        assert.equal(seat.body?.seatOpen, true, 'the open seat is announced to the defender');
        assert.equal((seat.body?.session as { p1?: unknown }).p1, undefined, 'but never the match itself');

        const seated = await call({ action: 'join', playerName: HOLDOUT, sectorWarId: contest.id });
        assert.equal(seated.statusCode, 200, JSON.stringify(seated.body));
        assert.equal((seated.body?.session as { viewerSide: string }).viewerSide, 'p2');
        assert.equal((await kv.get<{ status: string }>(`sector-card:${contest.id}`))?.status, 'active');
    });

    it('a bystander still learns nothing from the table', async () => {
        await kv.set('save:cardbystander', { character: { name: 'cardbystander', village: 'Sunscar Village' } });
        const contest = await seedContest();
        await call({ action: 'join', playerName: RAIDER, sectorWarId: contest.id });
        const peek = await call({ action: 'state', playerName: 'cardbystander', sectorWarId: contest.id });
        assert.equal(peek.statusCode, 403);
    });
});
