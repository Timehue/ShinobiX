/* Free-play Chronicle Showdown pays Chronicle Points (owner request
 * 2026-10-22) through the real /api/card-clash/match handler, signed in as the
 * duelists, on the isolated memory store. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { CHRONICLE_AI_DECKS } from './_ai-engine.js';
import { CHRONICLE_RULES_VERSION, TURN_TIMEOUT_MS, createMatch } from '../../shared/chronicle-duel.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'card-cp-free-play-secret-32-bytes-ok!';
delete process.env.ENABLE_LEGACY;

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { statusCode: number; body: Record<string, unknown> };

let match: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    match = (await import('./match.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    resetRateLimits();
    for (const name of ['alpha', 'bravo']) {
        const deck = name === 'alpha' ? CHRONICLE_AI_DECKS.hard : CHRONICLE_AI_DECKS.medium;
        await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, chroniclePoints: 0, tileCards: [...deck], cardClashDeck: [...deck] } });
    }
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
    await match({
        method: 'POST', query: {}, body,
        headers: { 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

const poll = (player: string, matchId: string) => call(player, { action: 'state', matchId });

async function pointsOf(name: string): Promise<number> {
    return Number((await kv.get<{ character: { chroniclePoints?: number } }>(`save:${name}`))?.character.chroniclePoints ?? 0);
}

let seq = 0;
function matchId(): string {
    seq += 1;
    return `${String(seq).padStart(8, '0')}-1111-4111-8111-111111111111`;
}

/** A finished free-play duel, stored exactly as the handler stores one. */
async function finishedDuel(o: { winner?: 'p1' | 'p2'; seconds?: number; endedBy?: 'play' | 'forfeit' } = {}): Promise<string> {
    const id = matchId();
    const now = Date.now();
    const state = createMatch('alpha', [...CHRONICLE_AI_DECKS.hard], 'bravo', [...CHRONICLE_AI_DECKS.medium], () => 0.5, now - 120_000);
    state.status = 'complete';
    state.winner = o.winner ?? 'p1';
    state.turnNumber = 5;
    await kv.set(`cc-freeplay:${id}`, {
        matchId: id, rulesVersion: CHRONICLE_RULES_VERSION, p1Name: 'alpha', p2Name: 'bravo',
        state, status: 'done', createdAt: now - 120_000, updatedAt: now,
        participation: { startedAt: now - (o.seconds ?? 90) * 1000, p1Actions: 6, p2Actions: 5, endedBy: o.endedBy ?? 'play' },
    });
    return id;
}

/** A live duel both duelists have joined through the handler. */
async function liveDuel(): Promise<string> {
    const id = matchId();
    await kv.set(`cc-pair:${id}`, { matchId: id, p1Name: 'alpha', p2Name: 'bravo', createdAt: Date.now() });
    assert.equal((await call('alpha', { action: 'join', matchId: id, deck: CHRONICLE_AI_DECKS.hard })).statusCode, 200);
    assert.equal((await call('bravo', { action: 'join', matchId: id, deck: CHRONICLE_AI_DECKS.medium })).statusCode, 200);
    return id;
}

describe('free-play Chronicle Showdown pays Chronicle Points', { concurrency: false }, () => {
    it('pays a credited win 20 and the engaged loss 8, once, and hands each duelist their save', async () => {
        const id = await finishedDuel();
        const winner = await poll('alpha', id);
        assert.equal(winner.statusCode, 200, JSON.stringify(winner.body));
        assert.deepEqual(winner.body.chroniclePoints, { earned: 20, status: 'paid', pairWeight: 1 });
        assert.equal((winner.body.character as { chroniclePoints: number }).chroniclePoints, 20);
        assert.ok(Number(winner.body._saveVersion) > 1);

        const loser = await poll('bravo', id);
        assert.deepEqual(loser.body.chroniclePoints, { earned: 8, status: 'paid', pairWeight: 1 });
        assert.equal((loser.body.character as { chroniclePoints: number }).chroniclePoints, 8, 'the loser\'s poll returns the save the winner\'s request wrote');

        // Replayed claims from both sides pay nothing more and stop re-sending the save.
        for (const player of ['alpha', 'bravo', 'alpha']) {
            const again = await poll(player, id);
            assert.equal(again.body.character, undefined);
        }
        assert.equal(await pointsOf('alpha'), 20);
        assert.equal(await pointsOf('bravo'), 8);
    });

    it('a retry after the session lost its outbox still pays once', async () => {
        const id = await finishedDuel();
        await poll('alpha', id);
        const row = await kv.get<Record<string, unknown>>(`cc-freeplay:${id}`);
        delete row!.cpCredit;
        await kv.set(`cc-freeplay:${id}`, row);
        const retried = await poll('bravo', id);
        assert.deepEqual(retried.body.chroniclePoints, { earned: 8, status: 'paid', pairWeight: 1 });
        assert.equal(await pointsOf('alpha'), 20);
        assert.equal(await pointsOf('bravo'), 8);
    });

    it('a short duel pays nothing and says why', async () => {
        const id = await finishedDuel({ seconds: 30 });
        const reply = await poll('alpha', id);
        assert.equal((reply.body.chroniclePoints as { reason?: string }).reason, 'participation');
        assert.equal((reply.body.chroniclePoints as { earned: number }).earned, 0);
        assert.equal(await pointsOf('alpha'), 0);
        assert.equal(await pointsOf('bravo'), 0);
    });

    it('a forfeit pays neither duelist', async () => {
        const id = await liveDuel();
        const forfeited = await call('bravo', { action: 'forfeit', matchId: id });
        assert.equal(forfeited.statusCode, 200, JSON.stringify(forfeited.body));
        assert.deepEqual((forfeited.body.chroniclePoints as { reason?: string }).reason, 'participation');
        const winner = await poll('alpha', id);
        assert.equal((winner.body.chroniclePoints as { earned: number; reason?: string }).reason, 'participation');
        assert.equal(await pointsOf('alpha'), 0);
        assert.equal(await pointsOf('bravo'), 0);
    });

    it('a walk-out ended by the turn clock pays nothing', async () => {
        const id = await liveDuel();
        const row = await kv.get<{ state: { activePlayer: 'p1' | 'p2'; afkStrikes?: Record<string, number>; actedThisTurn?: boolean; turnStartedAt: number } }>(`cc-freeplay:${id}`);
        const absent = row!.state.activePlayer;
        row!.state.afkStrikes = { [absent]: 1 };
        row!.state.actedThisTurn = false;
        row!.state.turnStartedAt = Date.now() - TURN_TIMEOUT_MS - 1_000;
        await kv.set(`cc-freeplay:${id}`, row);
        const present = absent === 'p1' ? 'bravo' : 'alpha';
        const reply = await poll(present, id);
        assert.equal((reply.body.session as { status: string }).status, 'complete');
        assert.equal((reply.body.chroniclePoints as { reason?: string }).reason, 'participation');
        assert.equal(await pointsOf(present), 0);
    });

    it('repeat wins over one opponent decay 1, 1, .5, .25, 0 within the UTC day', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 22, 9) });
        const earned: number[] = [];
        for (let i = 0; i < 5; i++) {
            const id = await finishedDuel();
            earned.push((((await poll('alpha', id)).body.chroniclePoints) as { earned: number }).earned);
        }
        assert.deepEqual(earned, [20, 20, 10, 5, 0]);
        assert.equal(await pointsOf('alpha'), 55);
        assert.equal(await pointsOf('bravo'), 8 + 8 + 4 + 2);
    });

    it('wins traded back and forth pay nothing', async () => {
        await poll('alpha', await finishedDuel({ winner: 'p1' }));
        const reply = await poll('bravo', await finishedDuel({ winner: 'p2' }));
        assert.deepEqual(reply.body.chroniclePoints, { earned: 0, status: 'none', reason: 'reciprocal' });
        assert.equal(await pointsOf('alpha'), 20);
        assert.equal(await pointsOf('bravo'), 8);
    });
});
