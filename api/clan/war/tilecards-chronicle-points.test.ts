/* Clan-war Chronicle card duels pay Chronicle Points (owner request
 * 2026-10-22) under the free-play participation, reciprocal and per-pair rules,
 * through the real /api/clan/war/tilecards handler and its campaign reconciler. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { CHRONICLE_AI_DECKS } from '../../card-clash/_ai-engine.js';
import { CHRONICLE_RULES_VERSION, TURN_TIMEOUT_MS, createMatch } from '../../../shared/chronicle-duel.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'card-cp-clan-war-secret-32-bytes-ok!!';

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { statusCode: number; body: Record<string, unknown> };

const WAR = 'war-card-cp';
let tilecards: Handler;
let reconcile: typeof import('./tilecards.js').reconcileClanWarCardDuel;
let kv: typeof import('../../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ issuePlayerToken } = await import('../../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../../_ratelimit.js'));
    const mod = await import('./tilecards.js');
    tilecards = mod.default as unknown as Handler;
    reconcile = mod.reconcileClanWarCardDuel;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    resetRateLimits();
    await kv.set('save:ember', { _saveVersion: 1, character: { name: 'ember', clan: 'Ash', chroniclePoints: 0 } });
    await kv.set('save:frost', { _saveVersion: 1, character: { name: 'frost', clan: 'Rime', chroniclePoints: 0 } });
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
    await tilecards({
        method: 'POST', query: {}, body: { warId: WAR, ...body },
        headers: { 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

async function pointsOf(name: string): Promise<number> {
    return Number((await kv.get<{ character: { chroniclePoints?: number } }>(`save:${name}`))?.character.chroniclePoints ?? 0);
}

let seq = 0;
/** A clan-war card duel row, live or finished, as tilecards.ts stores one. */
async function duelRow(o: { done?: boolean; winner?: 'p1' | 'p2'; seconds?: number }): Promise<string> {
    seq += 1;
    const challengeId = `cwm-cardcp${seq}`;
    const now = Date.now();
    const state = createMatch('ember', [...CHRONICLE_AI_DECKS.hard], 'frost', [...CHRONICLE_AI_DECKS.medium], () => 0.5, now - 120_000);
    if (o.done) {
        state.status = 'complete';
        state.winner = o.winner ?? 'p1';
        state.turnNumber = 6;
    }
    await kv.set(`cw-tilecards:${challengeId}`, {
        rulesVersion: CHRONICLE_RULES_VERSION, warId: WAR, challengeId,
        p1Name: 'ember', p1Clan: 'Ash', p1Deck: [...CHRONICLE_AI_DECKS.hard],
        p2Name: 'frost', p2Clan: 'Rime', p2Deck: [...CHRONICLE_AI_DECKS.medium],
        state, status: o.done ? 'done' : 'active', createdAt: now - 120_000, updatedAt: now,
        participation: { startedAt: now - (o.seconds ?? 100) * 1000, p1Actions: 7, p2Actions: 6, ...(o.done ? { endedBy: 'play' } : {}) },
    });
    return challengeId;
}

describe('clan-war card duels pay Chronicle Points', { concurrency: false }, () => {
    it('a credited win pays 20 and the loss 8, exactly once, even when the reconciler settles it', async () => {
        const challengeId = await duelRow({ done: true });
        // The campaign reconciler settles a finished duel nobody is watching.
        await reconcile(challengeId);
        await reconcile(challengeId);
        assert.equal(await pointsOf('ember'), 20);
        assert.equal(await pointsOf('frost'), 8);

        const winner = await call('ember', { action: 'state', challengeId });
        assert.equal(winner.statusCode, 200, JSON.stringify(winner.body));
        assert.deepEqual(winner.body.chroniclePoints, { earned: 20, status: 'paid', pairWeight: 1 });
        assert.equal((winner.body.character as { chroniclePoints: number }).chroniclePoints, 20);
        const loser = await call('frost', { action: 'state', challengeId });
        assert.deepEqual(loser.body.chroniclePoints, { earned: 8, status: 'paid', pairWeight: 1 });
        await call('frost', { action: 'state', challengeId });
        assert.equal(await pointsOf('ember'), 20);
        assert.equal(await pointsOf('frost'), 8);
    });

    it('a forfeit pays nothing, and neither does a short duel', async () => {
        const live = await duelRow({});
        const forfeited = await call('frost', { action: 'forfeit', challengeId: live });
        assert.equal(forfeited.statusCode, 200, JSON.stringify(forfeited.body));
        assert.equal((forfeited.body.chroniclePoints as { reason?: string }).reason, 'participation');

        const short = await duelRow({ done: true, seconds: 20 });
        const reply = await call('ember', { action: 'state', challengeId: short });
        assert.equal((reply.body.chroniclePoints as { reason?: string }).reason, 'participation');
        assert.equal(await pointsOf('ember'), 0);
        assert.equal(await pointsOf('frost'), 0);
    });

    it('a duel the turn clock ends as a walk-out pays nothing', async () => {
        const challengeId = await duelRow({});
        const row = await kv.get<{ state: { activePlayer: 'p1' | 'p2'; afkStrikes?: Record<string, number>; actedThisTurn?: boolean; turnStartedAt: number } }>(`cw-tilecards:${challengeId}`);
        row!.state.afkStrikes = { [row!.state.activePlayer]: 1 };
        row!.state.actedThisTurn = false;
        row!.state.turnStartedAt = Date.now() - TURN_TIMEOUT_MS - 1_000;
        await kv.set(`cw-tilecards:${challengeId}`, row);
        const settled = await reconcile(challengeId);
        assert.equal(settled?.status, 'done');
        assert.equal(settled?.participation?.endedBy, 'timeout');
        assert.equal(settled?.cpCredit?.status, 'skipped');
        assert.equal(await pointsOf('ember') + await pointsOf('frost'), 0);
    });

    it('repeat duels with one opponent decay by the shared per-pair day count', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 22, 15) });
        const earned: number[] = [];
        for (let i = 0; i < 4; i++) {
            const reply = await call('ember', { action: 'state', challengeId: await duelRow({ done: true }) });
            earned.push((reply.body.chroniclePoints as { earned: number }).earned);
        }
        assert.deepEqual(earned, [20, 20, 10, 5]);
        assert.equal(await pointsOf('frost'), 8 + 8 + 4 + 2);
    });
});
