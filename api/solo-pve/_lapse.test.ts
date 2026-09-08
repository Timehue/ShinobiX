import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import type { PvpFighter } from '../pvp/session.js';
import {
    SOLO_PVE_LAPSED_RETENTION_SECONDS,
    SOLO_PVE_SESSION_TTL_SECONDS,
    SOLO_PVE_TERMINAL_TTL_SECONDS,
    createSoloPveSession,
    isSoloPveSessionLapsed,
    type SoloPveSession,
} from './_session.js';
import { abandonMoveToken, abandonSoloPveSession, isHollowGateFightSession, terminalizeLapsedSoloPveSession } from './_abandon.js';
import { readSoloPveSession, soloPveRowTtlSeconds, writeSoloPveSession, type SoloPveKv } from './_store.js';
import { battleStateKey, isBattleStateProjection } from '../_realtime/battle-projection.js';

/*
 * F08 — a Solo-PvE session that lapses (active, past its gameplay expiry) is
 * terminalized with the engine's own abandon rule from the HP the player last
 * stood at, stamped at the moment it lapsed. The row is retained past expiry
 * so that evidence exists; storage cleanup and gameplay expiry are separate
 * clocks. Nothing is invented: no knockout, no reward.
 */

const NOW = 1_800_000_000_000;

function fighter(name: string, hp: number, maxHp = 100): PvpFighter {
    return {
        name, hp, maxHp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        shield: 0, statuses: [], pos: name === 'Rill' ? 62 : 63,
        character: { name, level: 10, specialty: 'Taijutsu', stats: {}, jutsu: [], pvpItems: [], equipment: {} },
    };
}

function activeSession(over: Partial<SoloPveSession> = {}): SoloPveSession {
    return {
        ...createSoloPveSession({
            sessionId: 'lapse-run-1', ownerSlug: 'rill',
            encounter: { kind: 'mission', id: 'combat-e-drill', bindingId: 'lapse-run-1' },
            player: fighter('Rill', 80), enemy: fighter('Enemy', 50), now: NOW,
        }),
        ...over,
    };
}

function deps(session: SoloPveSession | null, now: number) {
    const writes: Array<{ expected: SoloPveSession; next: SoloPveSession }> = [];
    return {
        writes,
        deps: {
            read: async () => session,
            compareWrite: async (expected: SoloPveSession, next: SoloPveSession) => { writes.push({ expected, next }); return true; },
            lock: async <T,>(_target: string, fn: () => Promise<T>) => fn(),
            now: () => now,
        },
    };
}

describe('solo-pve lapse — gameplay expiry is a terminal event, not a storage disappearance', () => {
    it('the row outlives its gameplay expiry by the retention window; terminal rows keep the receipt window', () => {
        const active = activeSession();
        assert.equal(active.expiresAt, NOW + SOLO_PVE_SESSION_TTL_SECONDS * 1000, 'gameplay expiry is unchanged');
        assert.equal(soloPveRowTtlSeconds(active), SOLO_PVE_SESSION_TTL_SECONDS + SOLO_PVE_LAPSED_RETENTION_SECONDS);
        assert.equal(soloPveRowTtlSeconds({ ...active, status: 'done' }), SOLO_PVE_TERMINAL_TTL_SECONDS);
        assert.equal(isSoloPveSessionLapsed(active, active.expiresAt - 1), false);
        assert.equal(isSoloPveSessionLapsed(active, active.expiresAt), true);
        assert.equal(isSoloPveSessionLapsed({ ...active, status: 'done' }, active.expiresAt + 1), false, 'terminal rows never lapse');
    });

    it('terminalizes a lapsed session as abandoned AS OF its expiry, from the HP it lapsed with', async () => {
        const session = activeSession({ player: fighter('Rill', 35) });
        const seenAt = session.expiresAt + 6 * 3_600_000; // noticed six hours later
        const { deps: d, writes } = deps(session, seenAt);
        const result = await terminalizeLapsedSoloPveSession('lapse-run-1', d);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.transitioned, true);
        assert.equal(writes.length, 1);
        assert.equal(writes[0].expected, session, 'fenced on the exact row read');
        const next = result.session!;
        assert.equal(next.status, 'done');
        assert.equal(next.winner, 'enemy');
        assert.equal(next.outcome, 'loss');
        assert.equal(next.player.hp, 25, 'the engine\'s designed 10% max-HP abandon cost, nothing more');
        assert.equal(next.terminalEvidence?.finishedAt, session.expiresAt, 'stamped when it lapsed, not when it was noticed');
        assert.equal(next.terminalEvidence?.lapsedAt, session.expiresAt);
        assert.equal(next.terminalEvidence?.finalMoveToken, abandonMoveToken(session, true));
        assert.match(next.terminalEvidence!.finalMoveToken, /^lapsed-v1-/);
        assert.match(next.log.at(-1) ?? '', /lapsed unattended/);
        assert.equal(next.expiresAt, session.expiresAt + SOLO_PVE_TERMINAL_TTL_SECONDS * 1000, 'the terminal row keeps its receipt window from the lapse');
    });

    it('is a no-op on a live session, a terminal one, or a missing one', async () => {
        const live = activeSession();
        const liveRun = deps(live, live.expiresAt - 1);
        const liveResult = await terminalizeLapsedSoloPveSession('lapse-run-1', liveRun.deps);
        assert.deepEqual(liveResult, { ok: true, session: live, transitioned: false });
        assert.equal(liveRun.writes.length, 0);

        const done = activeSession({ status: 'done', winner: 'player', outcome: 'win' });
        const doneRun = deps(done, done.expiresAt + 1);
        const doneResult = await terminalizeLapsedSoloPveSession('lapse-run-1', doneRun.deps);
        assert.equal(doneResult.ok && doneResult.transitioned, false);
        assert.equal(doneRun.writes.length, 0);

        const goneResult = await terminalizeLapsedSoloPveSession('lapse-run-1', deps(null, NOW).deps);
        assert.deepEqual(goneResult, { ok: true, session: null, transitioned: false });
    });

    it('a lapsed fight inside a Hollow Gate dive is voided — the row deleted, nothing transitioned or charged', async () => {
        const dive = activeSession({ sessionId: 'hgcombat-1', encounter: { kind: 'hollow-gate', id: 'floor-2:sentinel', bindingId: 'hgcombat-1' } });
        assert.equal(isHollowGateFightSession(dive), true);
        assert.equal(isHollowGateFightSession(activeSession()), false);
        const removed: string[] = [];
        const run = deps(dive, dive.expiresAt + 1);
        const result = await terminalizeLapsedSoloPveSession('hgcombat-1', { ...run.deps, remove: async (id) => { removed.push(id); } });
        assert.deepEqual(result, { ok: true, session: null, transitioned: true, voided: true });
        assert.deepEqual(removed, ['hgcombat-1']);
        assert.equal(run.writes.length, 0, 'never abandoned: the dive treats any non-won terminal as death, and a lapse is not a loss');

        const stillLive = deps(dive, dive.expiresAt - 1);
        await terminalizeLapsedSoloPveSession('hgcombat-1', { ...stillLive.deps, remove: async (id) => { removed.push(id); } });
        assert.deepEqual(removed, ['hgcombat-1'], 'a live dive fight is left exactly as found');
    });

    it('an explicit abandon of a session that already lapsed is the same transition, stamped at the lapse', async () => {
        const session = activeSession();
        const { deps: d } = deps(session, session.expiresAt + 90_000);
        const result = await abandonSoloPveSession('lapse-run-1', 'rill', d);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.session.terminalEvidence?.lapsedAt, session.expiresAt);
        assert.equal(result.session.terminalEvidence?.finalMoveToken, abandonMoveToken(session, true));
    });

    it('creation publishes the owner\'s battle projection; a terminal write retires it only if it still names the session', async () => {
        const base = _makeMemoryKv();
        const ttls: Record<string, number | undefined> = {};
        const kv: SoloPveKv = {
            get: <T,>(key: string) => base.get<T>(key),
            set: (key: string, value: unknown, opts?: { ex?: number; nx?: boolean }) => { ttls[key] = opts?.ex; return base.set(key, value, opts); },
            del: (key: string) => base.del(key),
            compareSet: (key: string, expected: unknown, value: unknown, opts?: { ex?: number }) => base.compareSet(key, expected, value, opts),
        };
        const session = activeSession();
        await writeSoloPveSession(session, { kv });
        const projection = await kv.get(battleStateKey('rill'));
        assert.ok(isBattleStateProjection(projection));
        assert.equal(projection.kind, 'solo-pve');
        assert.equal(projection.sessionId, 'lapse-run-1');
        assert.equal(projection.expiresAt, session.expiresAt, 'the projection carries the gameplay expiry');
        assert.equal(ttls['solo-pve:lapse-run-1'], SOLO_PVE_SESSION_TTL_SECONDS + SOLO_PVE_LAPSED_RETENTION_SECONDS, 'the active row is retained past its gameplay expiry');
        assert.equal(ttls[battleStateKey('rill')], SOLO_PVE_SESSION_TTL_SECONDS + SOLO_PVE_LAPSED_RETENTION_SECONDS, 'so is the projection that names it');

        // A newer fight replaces the projection; the OLD fight's terminal write must not erase it.
        const newer = activeSession({ sessionId: 'lapse-run-2', version: 1 });
        await writeSoloPveSession(newer, { kv });
        await writeSoloPveSession({ ...session, version: 2, status: 'done', winner: 'player', outcome: 'win' }, { kv });
        const kept = await kv.get(battleStateKey('rill'));
        assert.ok(isBattleStateProjection(kept) && kept.sessionId === 'lapse-run-2', 'the newer fight\'s projection survives');

        await writeSoloPveSession({ ...newer, version: 2, status: 'done', winner: 'player', outcome: 'win' }, { kv });
        assert.equal(await kv.get(battleStateKey('rill')), null, 'its own terminal write retires it');
        assert.equal((await readSoloPveSession('lapse-run-2', { kv }))?.status, 'done');
    });
});
