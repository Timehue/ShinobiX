import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { PVP_LAPSED_RETENTION_SECONDS, PVP_TERMINAL_REPLAY_TTL, SESSION_TTL } from '../combat-core/constants.js';
import { isPvpSessionLapsed, pvpSessionLapsesAt, pvpSessionMayLapse } from './_lapse-rules.js';
import { PVP_LAPSE_LOG_LINE, terminalizeLapsedPvpSession } from './_lapse.js';
import type { PvpSession } from './session.js';

/*
 * F08 — a duel nobody touched for a whole session TTL is a double walk-out.
 * It is recorded as a DRAW from the row's own evidence and its ordinary
 * terminal replay runs; a live, terminal, or otherwise-owned duel is left as
 * found.
 */

const NOW = 1_800_000_000_000;
const TTL_MS = SESSION_TTL * 1000;

function session(over: Partial<PvpSession> & Record<string, unknown> = {}): PvpSession {
    return {
        battleId: 'duel-1', status: 'active', winner: null, rewardAuthority: 'world', continuousVitals: true,
        createdAt: NOW - 60 * 60_000, lastMoveAt: NOW - 20 * 60_000,
        p1: { name: 'rill', hp: 40, maxHp: 100 }, p2: { name: 'raider', hp: 55, maxHp: 100 },
        log: ['Battle started.'], round: 3, activePlayer: 'p1',
        ...over,
    } as unknown as PvpSession;
}

describe('pvp lapse rules', () => {
    it('lapses one session TTL after the LAST touch: a move, a server-passed turn, or creation', () => {
        assert.equal(pvpSessionLapsesAt(session({ createdAt: 10, lastMoveAt: 20, turnStartedAt: 30 })), 30 + TTL_MS);
        assert.equal(pvpSessionLapsesAt(session({ createdAt: 10, lastMoveAt: undefined, turnStartedAt: undefined })), 10 + TTL_MS);
        assert.equal(isPvpSessionLapsed(session({ lastMoveAt: NOW - TTL_MS + 1 }), NOW), false, 'still inside the TTL');
        assert.equal(isPvpSessionLapsed(session({ lastMoveAt: NOW - TTL_MS }), NOW), true);
        assert.equal(isPvpSessionLapsed(session({ lastMoveAt: NOW - TTL_MS, turnStartedAt: NOW - 30_000 }), NOW), false,
            'a present player polling keeps the server passing lapsed turns, which re-stamps the clock');
        assert.equal(isPvpSessionLapsed(session({ status: 'done', winner: 'p1' }), NOW), false, 'terminal rows never lapse');
    });

    it('never lapses a duel whose lifecycle is owned elsewhere', () => {
        assert.equal(pvpSessionMayLapse(session()), true);
        assert.equal(pvpSessionMayLapse(session({ rewardAuthority: 'admin' })), false, 'admin bouts have no real fighters');
        assert.equal(pvpSessionMayLapse(session({ rankedKind: 'player', rankedMatchId: 'm-1', playerRankedAuthorityVersion: 2 })), false,
            'player-ranked V2 owns its own orphan/close tombstones');
    });
});

describe('terminalizeLapsedPvpSession', () => {
    function harness(row: PvpSession | null) {
        const kv = _makeMemoryKv();
        const replayed: PvpSession[] = [];
        const ttls: Array<number | undefined> = [];
        const recording = {
            get: <T,>(key: string) => kv.get<T>(key),
            compareSet: (key: string, expected: unknown, value: unknown, opts?: { ex?: number }) => {
                ttls.push(opts?.ex);
                return kv.compareSet(key, expected, value, opts);
            },
        };
        return {
            kv,
            replayed,
            ttls,
            seed: async () => { if (row) await kv.set('pvp:duel-1', row, { ex: SESSION_TTL + PVP_LAPSED_RETENTION_SECONDS }); },
            deps: { kv: recording, now: () => NOW, replayTerminal: async (s: PvpSession) => { replayed.push(s); } },
        };
    }

    it('records a lapsed duel as a draw at the moment it lapsed, and replays the terminal effects', async () => {
        const h = harness(session());
        await h.seed();
        const result = await terminalizeLapsedPvpSession('duel-1', h.deps);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.transitioned, true);
        assert.equal(result.settled, true);
        const next = result.session!;
        assert.equal(next.status, 'done');
        assert.equal(next.winner, 'draw');
        assert.equal(next.endedAt, NOW - 20 * 60_000 + TTL_MS, 'the terminal time is the lapse, not the sweep');
        assert.equal(next.lapsedAt, next.endedAt);
        assert.equal(next.log.at(-1), PVP_LAPSE_LOG_LINE);
        assert.equal(next.p1.hp, 40, 'the vitals each body carried out of the fight are the evidence settlement uses');
        assert.equal(h.replayed.length, 1);
        assert.deepEqual(await h.kv.get('pvp:duel-1'), next, 'the terminal row is what storage holds');
        assert.ok((h.ttls[0] ?? 0) >= PVP_TERMINAL_REPLAY_TTL, `terminal rows keep the replay window (ttl ${h.ttls[0]})`);
    });

    it('leaves a live, terminal, or missing duel exactly as found', async () => {
        const live = harness(session({ lastMoveAt: NOW - 60_000 }));
        await live.seed();
        const liveResult = await terminalizeLapsedPvpSession('duel-1', live.deps);
        assert.equal(liveResult.ok && liveResult.transitioned, false);
        assert.equal((await live.kv.get<PvpSession>('pvp:duel-1'))?.status, 'active');
        assert.equal(live.replayed.length, 0);

        const done = harness(session({ status: 'done', winner: 'p2', endedAt: NOW - 30 * 60_000 }));
        await done.seed();
        const doneResult = await terminalizeLapsedPvpSession('duel-1', done.deps);
        assert.equal(doneResult.ok && doneResult.transitioned, false);
        assert.equal((await done.kv.get<PvpSession>('pvp:duel-1'))?.winner, 'p2');

        const gone = harness(null);
        const goneResult = await terminalizeLapsedPvpSession('duel-1', gone.deps);
        assert.deepEqual(goneResult, { ok: true, session: null, transitioned: false, settled: false });
    });

    it('is fenced on the exact row it read: a move that lands meanwhile wins', async () => {
        const h = harness(session());
        await h.seed();
        let raced = false;
        const racingKv = {
            get: async <T,>(key: string) => h.kv.get<T>(key),
            compareSet: async (key: string, expected: unknown, value: unknown, opts?: { ex?: number }) => {
                if (!raced) {
                    raced = true;
                    // Someone moved between our read and our write.
                    await h.kv.set('pvp:duel-1', session({ lastMoveAt: NOW - 1_000, round: 4 }));
                }
                return h.kv.compareSet(key, expected, value, opts);
            },
        };
        const result = await terminalizeLapsedPvpSession('duel-1', { ...h.deps, kv: racingKv });
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.retryable, true);
        assert.equal((await h.kv.get<PvpSession>('pvp:duel-1'))?.status, 'active', 'the live move stands');
        assert.equal(h.replayed.length, 0);
    });
});
