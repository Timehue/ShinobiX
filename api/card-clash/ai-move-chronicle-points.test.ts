/* PvE card battles pay Chronicle Points on a win (owner request 2026-10-22):
 * a won Dungeon Card seal pays CARD_PVE_DUNGEON_CP once with its proof, while
 * Card Hall practice and a generic externalStakes encounter stay unpaid.
 * Drives the real ai-start + ai-move handlers on the isolated memory store. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { CHRONICLE_FIXED_FALLBACK_DECK } from '../../shared/chronicle-duel.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'card-cp-pve-admin';
delete process.env.ENABLE_LEGACY;

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { statusCode: number; body: Record<string, unknown> };

let aiStart: Handler;
let aiMove: Handler;
let kv: typeof import('../_storage.js').kv;
let drainBackgroundWork: () => Promise<void>;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ drainBackgroundWork } = await import('../_background-work.js'));
    aiStart = (await import('./ai-start.js')).default as unknown as Handler;
    aiMove = (await import('./ai-move.js')).default as unknown as Handler;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.CARD_PVE_DUNGEON_CP;
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function call(handler: Handler, body: Record<string, unknown>): Promise<Reply> {
    const out: Reply = { statusCode: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (b: Record<string, unknown>) => { out.body = b; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST', query: {}, body,
        headers: { 'x-admin-password': 'card-cp-pve-admin' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

async function pointsOf(name: string): Promise<number> {
    return Number((await kv.get<{ character: { chroniclePoints?: number } }>(`save:${name}`))?.character.chroniclePoints ?? 0);
}

function dungeonCharacter(name: string, token: string): Record<string, unknown> {
    return {
        name, ryo: 0, chroniclePoints: 4,
        tileCards: [...CHRONICLE_FIXED_FALLBACK_DECK], cardClashDeck: [...CHRONICLE_FIXED_FALLBACK_DECK],
        activeDungeonRun: { token, combatAuthorityVersion: 1, wardenDefeated: true, wardenProofId: 'wardenproof123' },
    };
}

/** Force the stored showdown to a finished result the player won or lost. */
async function finish(matchId: string, winner: 'player' | 'opponent', ageMs = 120_000) {
    const key = `cc-ai:${matchId}`;
    const session = await kv.get<Record<string, unknown> & { state: Record<string, unknown> }>(key);
    assert.ok(session);
    session.state.status = 'complete';
    session.state.winner = winner === 'player' ? 'p1' : 'p2';
    session.status = 'done';
    session.winner = winner;
    session.createdAt = Date.now() - ageMs;
    await kv.set(key, session);
}

async function startDungeon(name: string, token: string): Promise<string> {
    await kv.set(`save:${name}`, { _saveVersion: 3, character: dungeonCharacter(name, token) });
    const started = await call(aiStart, { playerName: name, deck: CHRONICLE_FIXED_FALLBACK_DECK, dungeon: { token } });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    return String(started.body.matchId);
}

describe('PvE card battles pay Chronicle Points on a win', { concurrency: false }, () => {
    it('a won Dungeon Card seal pays 10 once, across concurrent and replayed claims', async () => {
        const matchId = await startDungeon('sealer', 'dungeonrun_cp_win_01');
        await finish(matchId, 'player');
        const [first, second] = await Promise.all([
            call(aiMove, { matchId, action: 'state' }),
            call(aiMove, { matchId, action: 'state' }),
        ]);
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.equal(second.statusCode, 200, JSON.stringify(second.body));
        assert.equal(await pointsOf('sealer'), 4 + 10);
        const replay = await call(aiMove, { matchId, action: 'state' });
        assert.equal(replay.body.chroniclePoints, 10, 'the result screen can still show what the seal paid');
        assert.equal((replay.body.character as { chroniclePoints: number }).chroniclePoints, 14);
        assert.equal(await pointsOf('sealer'), 14);
        const active = (await kv.get<{ character: { activeDungeonRun: { cardDefeated?: boolean } } }>('save:sealer'))!.character.activeDungeonRun;
        assert.equal(active.cardDefeated, true, 'the points ride the winning proof write');

        await drainBackgroundWork();
        const txns = (await kv.get<Array<{ txnId: string; source: string; delta: number }>>('econ:txns')) ?? [];
        assert.deepEqual(txns.filter((txn) => txn.txnId === `card-cp:dungeon:${matchId}`).map((txn) => [txn.source, txn.delta]),
            [['card.pve.dungeon', 10]]);
    });

    it('the dungeon dial sets the amount, and a lost seal pays nothing', async () => {
        process.env.CARD_PVE_DUNGEON_CP = '25';
        const dialed = await startDungeon('dialed', 'dungeonrun_cp_dial_01');
        await finish(dialed, 'player');
        const won = await call(aiMove, { matchId: dialed, action: 'state' });
        assert.equal(won.body.chroniclePoints, 25);
        assert.equal(await pointsOf('dialed'), 4 + 25);

        const matchId = await startDungeon('fallen', 'dungeonrun_cp_loss_01');
        await finish(matchId, 'opponent');
        const settled = await call(aiMove, { matchId, action: 'state' });
        assert.equal(settled.statusCode, 200, JSON.stringify(settled.body));
        assert.equal(settled.body.chroniclePoints, undefined);
        assert.equal(await pointsOf('fallen'), 4);
    });

    it('Card Hall practice and an unsealed encounter pay nothing, while a Dungeon seal pays', async () => {
        await kv.set('save:practice', { _saveVersion: 1, character: {
            name: 'practice', ryo: 0, chroniclePoints: 4, starterCardsClaimed: true,
            tileCards: [...CHRONICLE_FIXED_FALLBACK_DECK], cardClashDeck: [...CHRONICLE_FIXED_FALLBACK_DECK],
        } });
        for (const start of [
            { difficulty: 'easy' }, { difficulty: 'medium' }, { difficulty: 'hard' },
            // A client-flagged encounter with no server seal (an event tile).
            { difficulty: 'hard', externalStakes: true },
        ]) {
            const started = await call(aiStart, { playerName: 'practice', deck: CHRONICLE_FIXED_FALLBACK_DECK, ...start });
            assert.equal(started.statusCode, 200, JSON.stringify(started.body));
            const matchId = String(started.body.matchId);
            await finish(matchId, 'player');
            const settled = await call(aiMove, { matchId, action: 'state' });
            assert.equal(settled.statusCode, 200, JSON.stringify(settled.body));
            assert.equal(settled.body.chroniclePoints, undefined, JSON.stringify(start));
            assert.equal(await pointsOf('practice'), 4, JSON.stringify(start));
        }
        // The same kind of win inside a sealed Dungeon run pays.
        const sealed = await startDungeon('practice', 'dungeonrun_cp_cmp_01');
        await finish(sealed, 'player');
        await call(aiMove, { matchId: sealed, action: 'state' });
        assert.equal(await pointsOf('practice'), 4 + 10);
    });
});
