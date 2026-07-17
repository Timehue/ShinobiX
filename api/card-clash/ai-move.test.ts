/*
 * Hermetic e2e for the SERVER-AUTHORITATIVE AI card match: drives the real
 * ai-start + ai-move handlers against an in-memory KV (no Supabase, no network).
 *
 * The reward-integrity property under test: the client can no longer assert a
 * result. There is no `result` field any more — the server computes the winner
 * from the board and pays from THAT. A player who never wins is settled the LOSS
 * reward; a genuine win pays the win reward; and settlement is single-pay.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CLASH } from '../clan/war/_card-catalog.js';
import type { ClashCard } from '../clan/war/_card-clash-engine.js';
import { cardClashAiTokenKey } from './_ai-reward.js';
import { createAiMatch, playOne } from './_ai-engine.js';

process.env.ADMIN_PASSWORD = 'cc-ai-test-admin';
process.env.SUPABASE_URL ??= 'http://localhost:1';   // never contacted — kv is patched
process.env.SUPABASE_SERVICE_KEY ??= 'x';

const store = new Map<string, unknown>();
const clone = (v: unknown) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

function fakeReq(body: unknown) {
    return {
        method: 'POST', query: {}, body,
        headers: { 'x-admin-password': 'cc-ai-test-admin', 'x-forwarded-for': '10.0.0.2' },
        socket: { remoteAddress: '10.0.0.2' },
    } as never;
}
function fakeRes() {
    const out = { statusCode: 200, body: undefined as never };
    const res = {
        setHeader: () => res, status: (c: number) => { out.statusCode = c; return res; },
        json: (b: unknown) => { out.body = b as never; return res; }, end: () => res,
    };
    return { res: res as never, out };
}

type Handler = (req: never, res: never) => Promise<unknown>;
let aiStart: Handler;
let aiMove: Handler;

before(async () => {
    const kv = (await import('../_storage.js')).kv as unknown as Record<string, unknown>;
    kv.get = async (k: string) => clone(store.get(k));
    kv.set = async (k: string, v: unknown, o?: { nx?: boolean }) => {
        if (o?.nx && store.has(k)) return null;
        store.set(k, clone(v));
        return 'OK';
    };
    kv.del = async (...ks: string[]) => ks.reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0);
    kv.delIfEqual = async (k: string, expected: string) => {
        if (store.get(k) !== expected) return false;
        store.delete(k);
        return true;
    };
    aiStart = (await import('./ai-start.js')).default as unknown as Handler;
    aiMove = (await import('./ai-move.js')).default as unknown as Handler;
});

function deckBody(): ClashCard[] {
    const ids = Object.keys(BUILTIN_CLASH).filter((id) => BUILTIN_CLASH[id].rarity === 'common').slice(0, 12);
    return ids.map((id) => ({ id, ...BUILTIN_CLASH[id] }));
}
async function call(handler: Handler, body: unknown): Promise<{ statusCode: number; body: never }> {
    const { res, out } = fakeRes();
    await handler(fakeReq(body) as never, res);
    return out;
}
const char = (name: string) => (store.get(`save:${name}`) as { character: Record<string, unknown> }).character;

test('a fabricated win cannot pay: a passive player is settled the LOSS reward', async () => {
    store.clear();
    store.set('save:hollow', { character: { name: 'Hollow', ryo: 100 } });
    const start = await call(aiStart, { playerName: 'hollow', playerLevel: 30, deck: deckBody() });
    assert.equal(start.statusCode, 200);
    const matchId = (start.body as { matchId: string }).matchId;
    assert.ok(matchId);

    // Play NOTHING — just end turns. The greedy AI accrues board power, so the
    // SERVER-computed winner is the opponent. There is no way to claim a win.
    let last: { statusCode: number; body: never } = start;
    for (let i = 0; i < 8; i++) {
        last = await call(aiMove, { matchId, action: 'end-turn' });
        assert.equal(last.statusCode, 200);
        if ((last.body as { session: { status: string } }).session.status === 'done') break;
    }
    const body = last.body as { session: { status: string; winner: string }; reward: { result: string; ryo: number } };
    assert.equal(body.session.status, 'done');
    assert.equal(body.session.winner, 'opponent');
    assert.equal(body.reward.result, 'opponent');
    assert.equal(body.reward.ryo, 5, 'loss reward — never the 50/300 win payout');
    assert.equal(char('hollow').ryo, 105);
    assert.equal(char('hollow').cardClashLosses, 1);
});

test('a genuine win pays the full win reward incl. first-win-of-day bonus', async () => {
    store.clear();
    store.set('save:victor', { character: { name: 'Victor', ryo: 0 } });
    // Seed a near-final winning session (AI empty → player controls the board),
    // created long enough ago to clear the min-win-duration guard.
    const matchId = '00000000-0000-0000-0000-000000000001';
    const session = createAiMatch(matchId, 'victor', deckBody(), 30, Date.now() - 60_000);
    session.ai.hand = [];
    session.ai.deck = [];
    session.match.turn = 6;
    session.player.chakra = 6;
    assert.equal(playOne(session, 'p1', 0, 0).ok, true);
    store.set(cardClashAiTokenKey(matchId), session);

    const out = await call(aiMove, { matchId, action: 'end-turn' });
    assert.equal(out.statusCode, 200);
    const body = out.body as { session: { winner: string }; reward: { ryo: number } };
    assert.equal(body.session.winner, 'player');
    assert.equal(body.reward.ryo, 300, '50 win + 250 first-daily bonus');
    assert.equal(char('victor').ryo, 300);
    assert.equal(char('victor').cardClashWins, 1);
});

test('an instant win is zeroed by the min-win-duration guard (anti-farm)', async () => {
    store.clear();
    store.set('save:flash', { character: { name: 'Flash', ryo: 0 } });
    const matchId = '00000000-0000-0000-0000-000000000002';
    const session = createAiMatch(matchId, 'flash', deckBody(), 30, Date.now());   // just now
    session.ai.hand = [];
    session.ai.deck = [];
    session.match.turn = 6;
    session.player.chakra = 6;
    playOne(session, 'p1', 0, 0);
    store.set(cardClashAiTokenKey(matchId), session);

    const out = await call(aiMove, { matchId, action: 'end-turn' });
    const body = out.body as { session: { winner: string }; reward: { ryo: number } };
    assert.equal(body.session.winner, 'player');
    assert.equal(body.reward.ryo, 0, 'won, but too fast → payout zeroed');
    assert.equal(char('flash').ryo, 0);
});

test('retreat settles the loss reward', async () => {
    store.clear();
    store.set('save:quit', { character: { name: 'Quit', ryo: 0 } });
    const start = await call(aiStart, { playerName: 'quit', playerLevel: 30, deck: deckBody() });
    const matchId = (start.body as { matchId: string }).matchId;
    const out = await call(aiMove, { matchId, action: 'retreat' });
    assert.equal(out.statusCode, 200);
    const body = out.body as { session: { winner: string }; reward: { ryo: number } };
    assert.equal(body.session.winner, 'opponent');
    assert.equal(body.reward.ryo, 5);
    assert.equal(char('quit').ryo, 5);
});

test('settlement is single-pay: a replayed terminal move never double-credits', async () => {
    store.clear();
    store.set('save:echo', { character: { name: 'Echo', ryo: 0 } });
    const start = await call(aiStart, { playerName: 'echo', playerLevel: 30, deck: deckBody() });
    const matchId = (start.body as { matchId: string }).matchId;
    let last: { statusCode: number; body: never } = start;
    for (let i = 0; i < 8; i++) {
        last = await call(aiMove, { matchId, action: 'end-turn' });
        if ((last.body as { session: { status: string } }).session.status === 'done') break;
    }
    const paidRyo = char('echo').ryo;
    const firstResult = (last.body as { reward: { result: string } }).reward.result;

    const replay = await call(aiMove, { matchId, action: 'end-turn' });
    assert.equal(replay.statusCode, 200);
    assert.equal((replay.body as { reward: { result: string } }).reward.result, firstResult);
    assert.equal(char('echo').ryo, paidRyo, 'replayed settle must not credit again');
});

test('a play/end-turn on an unknown match is rejected', async () => {
    store.clear();
    const out = await call(aiMove, { matchId: '00000000-0000-0000-0000-0000000000ff', action: 'end-turn' });
    assert.equal(out.statusCode, 404);
});
