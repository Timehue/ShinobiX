import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import type { AiFightSession } from '../missions/_ai-fight-outcome.js';
import { makePveEngineTestSession } from './_pve-engine-test-fixture.js';
import { TOWER_LAPSE_LOG_LINE, lapsedTowerSession, terminalizeLapsedTowerRun } from './_lapse.js';
import {
    TOWER_LAPSED_RETENTION_SECONDS,
    TOWER_SESSION_TTL,
    isTowerRunLapsed,
    readSession,
    towerRunExpiresAt,
    writeSession,
    type TowerKv,
} from './_tower-store.js';
import type { TowerSession } from './_tower-session.js';

/*
 * F08 — a Tower run that lapses is a forfeit recorded from its own evidence:
 * enemy win, nothing paid, the entry spent, leases released, the party run
 * closed, each human actor's HP settled at the value they walked away with.
 * A run that simply vanished used to be "confirmed missing" and REFUNDED.
 */

const NOW = 1_800_000_000_000;

function activeRun(over: Partial<TowerSession> = {}): TowerSession {
    const session = makePveEngineTestSession({ enemyLevel: 10, runId: 'tower-run-1' });
    return { ...session, status: 'active', winner: null, lastActionAt: NOW - 45 * 60_000, expiresAt: NOW - 15 * 60_000, ...over };
}

describe('tower lapse — gameplay expiry is a terminal event', () => {
    it('an active write stamps the gameplay expiry and retains the row past it; a terminal write does not', async () => {
        const writes: Array<{ key: string; ex?: number }> = [];
        const kv = {
            ...(_makeMemoryKv() as unknown as TowerKv),
            set: async (key: string, _value: unknown, opts?: { ex?: number }) => { writes.push({ key, ex: opts?.ex }); return 'OK' as const; },
        } as TowerKv;
        const session = activeRun({ expiresAt: undefined });
        await writeSession(session, { kv, now: () => NOW });
        assert.equal(session.expiresAt, NOW + TOWER_SESSION_TTL * 1000, 'the row now says when it lapses');
        assert.equal(writes[0].ex, TOWER_SESSION_TTL + TOWER_LAPSED_RETENTION_SECONDS, 'and outlives that moment');
        const done = { ...session, status: 'done' as const, winner: 'squad' as const };
        await writeSession(done, { kv, now: () => NOW });
        assert.equal(writes[1].ex, 24 * 60 * 60, 'terminal rows keep the receipt window');
    });

    it('lapse is judged from the stamped expiry, falling back to lastActionAt + TTL for older rows', () => {
        const stamped = activeRun({ expiresAt: NOW + 1 });
        assert.equal(isTowerRunLapsed(stamped, NOW), false);
        assert.equal(isTowerRunLapsed(stamped, NOW + 1), true);
        const legacy = activeRun({ expiresAt: undefined, lastActionAt: NOW - TOWER_SESSION_TTL * 1000 });
        assert.equal(towerRunExpiresAt(legacy), NOW);
        assert.equal(isTowerRunLapsed(legacy, NOW), true);
        assert.equal(isTowerRunLapsed({ ...legacy, status: 'done' }, NOW), false, 'terminal rows never lapse');
    });

    it('records a lapsed run as a forfeit and settles its consequences from the run\'s own evidence', async () => {
        const kv = _makeMemoryKv() as unknown as TowerKv;
        const session = activeRun();
        session.actors[0].hp = 120; // the human walked away at 120 of 800
        await kv.set('tower:tower-run-1', session);
        const released: string[][] = [];
        const closed: string[] = [];
        const settled: Array<{ runId: string; player: string; winner: unknown }> = [];
        const result = await terminalizeLapsedTowerRun('tower-run-1', {
            read: (runId) => readSession(runId, { kv }),
            write: (s) => writeSession(s, { kv, now: () => NOW }),
            lock: async (_key, fn) => fn(),
            now: () => NOW,
            releaseLeases: async (_runId, members) => { released.push([...members]); },
            closeParty: async (partyId) => { closed.push(partyId); return null; },
            settle: async (s: AiFightSession, player: string) => {
                settled.push({ runId: (s as TowerSession).runId, player, winner: (s as TowerSession).winner });
                return { ok: true, applied: true };
            },
        });
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.transitioned, true);
        assert.equal(result.settled, true);
        const next = result.session!;
        assert.equal(next.status, 'done');
        assert.equal(next.winner, 'enemy', 'a forfeit is an enemy win — nothing to pay');
        assert.equal(next.rewardSettlementState, 'settled', 'no reward settlement is owed');
        assert.equal(next.lapsedAt, NOW - 15 * 60_000, 'stamped at the lapse, not when it was noticed');
        assert.equal(next.log.at(-1), TOWER_LAPSE_LOG_LINE);
        assert.equal(next.actors[0].hp, 120, 'the HP the human walked away with is the evidence');
        assert.deepEqual(released, [['rill']], 'the account lease is released');
        assert.deepEqual(closed, []);
        assert.deepEqual(settled, [{ runId: 'tower-run-1', player: 'rill', winner: 'enemy' }], 'each human actor settles physically, no AI actor does');
        assert.equal((await readSession('tower-run-1', { kv }))?.status, 'done', 'the terminal row is what storage holds');
    });

    it('closes the party run when the run was party-bound', async () => {
        const kv = _makeMemoryKv() as unknown as TowerKv;
        const session = { ...activeRun(), towerPartyId: 'party-9' } as TowerSession;
        await kv.set('tower:tower-run-1', session);
        const closed: Array<[string, string]> = [];
        const result = await terminalizeLapsedTowerRun('tower-run-1', {
            read: (runId) => readSession(runId, { kv }),
            write: (s) => writeSession(s, { kv, now: () => NOW }),
            lock: async (_key, fn) => fn(),
            now: () => NOW,
            releaseLeases: async () => undefined,
            closeParty: async (partyId, runId) => { closed.push([partyId, runId]); return null; },
            settle: async () => ({ ok: true, applied: false }),
        });
        assert.equal(result.ok && result.transitioned, true);
        assert.deepEqual(closed, [['party-9', 'tower-run-1']]);
    });

    it('leaves a live, terminal, or missing run exactly as found', async () => {
        const kv = _makeMemoryKv() as unknown as TowerKv;
        const calls = { release: 0, settle: 0 };
        const deps = {
            read: (runId: string) => readSession(runId, { kv }),
            write: (s: TowerSession) => writeSession(s, { kv, now: () => NOW }),
            lock: async <T,>(_key: string, fn: () => Promise<T>) => fn(),
            now: () => NOW,
            releaseLeases: async () => { calls.release += 1; },
            settle: async () => { calls.settle += 1; return { ok: true, applied: true }; },
        };
        await kv.set('tower:tower-run-1', activeRun({ expiresAt: NOW + 60_000 }));
        const live = await terminalizeLapsedTowerRun('tower-run-1', deps);
        assert.equal(live.ok && live.transitioned, false);
        assert.equal((await readSession('tower-run-1', { kv }))?.status, 'active');

        await kv.set('tower:tower-run-1', { ...activeRun(), status: 'done', winner: 'squad' });
        const done = await terminalizeLapsedTowerRun('tower-run-1', deps);
        assert.equal(done.ok && done.transitioned, false);
        assert.equal((await readSession('tower-run-1', { kv }))?.winner, 'squad');

        await kv.del('tower:tower-run-1');
        const gone = await terminalizeLapsedTowerRun('tower-run-1', deps);
        assert.deepEqual(gone, { ok: true, session: null, transitioned: false, settled: false });
        assert.deepEqual(calls, { release: 0, settle: 0 });
    });

    it('lapsedTowerSession is pure and keeps every actor as evidence', () => {
        const session = activeRun();
        const next = lapsedTowerSession(session);
        assert.equal(session.status, 'active', 'the input is not mutated');
        assert.deepEqual(next.actors, session.actors);
        assert.equal(next.winner, 'enemy');
    });
});
