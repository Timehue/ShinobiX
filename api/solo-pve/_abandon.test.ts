import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PvpFighter } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from './_session.js';
import { abandonMoveToken, abandonSoloPveSession, finalizeAbandonedSession } from './_abandon.js';
import { settleSoloPveTerminalUsage } from './_usage-authority.js';

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
            sessionId: 'abandon-run-1',
            ownerSlug: 'rill',
            encounter: { kind: 'mission', id: 'combat-e-drill', bindingId: 'abandon-run-1' },
            player: fighter('Rill', 80),
            enemy: fighter('Enemy', 50),
            now: NOW,
        }),
        ...over,
    };
}

function deps(session: SoloPveSession | null) {
    const writes: Array<{ expected: SoloPveSession; next: SoloPveSession }> = [];
    return {
        writes,
        deps: {
            read: async () => session,
            compareWrite: async (expected: SoloPveSession, next: SoloPveSession) => { writes.push({ expected, next }); return true; },
            lock: async <T>(_target: string, fn: () => Promise<T>) => fn(),
            now: () => NOW + 5_000,
        },
    };
}

describe('abandonSoloPveSession — the authorized terminal transition', () => {
    it('mints one deterministic move token per (session, version)', () => {
        const session = activeSession();
        assert.equal(abandonMoveToken(session), abandonMoveToken({ ...session }));
        assert.notEqual(abandonMoveToken(session), abandonMoveToken({ ...session, version: session.version + 1 }));
        assert.match(abandonMoveToken(session), /^[A-Za-z0-9_-]{8,96}$/, 'must be a valid solo-PvE move token');
    });

    it('transitions an active session to a sealed loss in the owning store, version-fenced', async () => {
        const session = activeSession();
        const { deps: d, writes } = deps(session);
        const result = await abandonSoloPveSession('abandon-run-1', 'Rill', d);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.transitioned, true);
        assert.equal(writes.length, 1);
        assert.equal(writes[0].expected, session, 'compare-write must fence on the exact session that was read');
        const next = result.session;
        assert.equal(next.status, 'done');
        assert.equal(next.winner, 'enemy');
        assert.equal(next.outcome, 'loss');
        assert.equal(next.version, session.version + 1);
        assert.equal(next.player.hp, 70, 'the engine charges its designed 10% max-HP abandon cost');
        assert.ok(next.terminalEvidence, 'terminal evidence is sealed with the transition');
        assert.equal(next.terminalEvidence?.finalVersion, next.version);
        assert.equal(next.terminalEvidence?.finalMoveToken, abandonMoveToken(session));
        assert.ok(next.recentMoveTokens.includes(abandonMoveToken(session)));
        // The mission usage guard that already worked keeps working on this evidence.
        const usage = await settleSoloPveTerminalUsage(next, 'rill');
        assert.equal(usage.ok, true);
    });

    it('is a no-op on a session that is already terminal', async () => {
        const done = activeSession({ status: 'done', winner: 'player', outcome: 'win' });
        const { deps: d, writes } = deps(done);
        const result = await abandonSoloPveSession('abandon-run-1', 'rill', d);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.transitioned, false);
        assert.equal(result.session, done);
        assert.equal(writes.length, 0);
    });

    it('refuses another player and reports a lost compare-write as retryable', async () => {
        const session = activeSession();
        const stranger = await abandonSoloPveSession('abandon-run-1', 'dopey', deps(session).deps);
        assert.equal(stranger.ok, false);
        if (!stranger.ok) assert.equal(stranger.status, 403);

        const lost = await abandonSoloPveSession('abandon-run-1', 'rill', {
            ...deps(session).deps,
            compareWrite: async () => false,
        });
        assert.equal(lost.ok, false);
        if (!lost.ok) {
            assert.equal(lost.status, 409);
            assert.equal(lost.retryable, true);
        }

        const missing = await abandonSoloPveSession('abandon-run-1', 'rill', deps(null).deps);
        assert.equal(missing.ok, false);
        if (!missing.ok) assert.equal(missing.status, 404);
    });

    it('seals the same evidence shape the action service seals on a done edge', () => {
        const session = activeSession();
        const resolved: SoloPveSession = { ...session, status: 'done', winner: 'enemy', outcome: 'loss', itemsUsed: { 'healing-pill': 1 } };
        const next = finalizeAbandonedSession(session, resolved, 'abandon-token-x', NOW + 1);
        assert.deepEqual(Object.keys(next.terminalEvidence ?? {}).sort(), [
            'finalEventSeq', 'finalMoveToken', 'finalVersion', 'finishedAt', 'itemsUsed', 'outcome', 'settlementState', 'winner',
        ]);
        assert.deepEqual(next.terminalEvidence?.itemsUsed, { 'healing-pill': 1 });
        assert.equal(next.expiresAt > NOW + 1, true);
    });
});
