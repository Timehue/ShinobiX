import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateAuthoritativeWeeklyBossRun, type WeeklyBossAuthoritativeRun } from './_weekly-boss-authoritative-run.js';
import type { TowerSession } from './towers/_tower-session.js';

const run: WeeklyBossAuthoritativeRun = {
    runId: 'weekly-1', playerName: 'player', weekKey: '2026-W29', aiId: 'oni',
    bossStartedAt: 100, initialBossHp: 99_999_999, createdAt: 101,
};
const session = {
    status: 'done',
    phaseState: { bossId: 'boss', pendingPhases: [], triggeredPhases: [] },
    actors: [
        { id: 'sq-0', side: 'squad', ownerSlug: 'player' },
        { id: 'boss', side: 'enemy', ownerSlug: null, hp: 99_998_765 },
    ],
} as unknown as TowerSession;
const boss = { weekKey: '2026-W29', aiId: 'oni', startedAt: 100 };

function reasonOf(result: ReturnType<typeof validateAuthoritativeWeeklyBossRun>): string {
    assert.equal(result.ok, false);
    return result.ok ? 'unexpected-success' : result.reason;
}

describe('authoritative Weekly Boss run validation', () => {
    it('derives contribution only from server session HP', () => {
        assert.deepEqual(validateAuthoritativeWeeklyBossRun({ run, session, playerName: 'player', boss }), { ok: true, damage: 1234 });
    });

    it('rejects wrong accounts, unfinished sessions, stale bosses, and replay', () => {
        assert.equal(reasonOf(validateAuthoritativeWeeklyBossRun({ run, session, playerName: 'other', boss })), 'wrong-player');
        assert.equal(reasonOf(validateAuthoritativeWeeklyBossRun({ run, session: { ...session, status: 'active' }, playerName: 'player', boss })), 'not-finished');
        assert.equal(reasonOf(validateAuthoritativeWeeklyBossRun({ run, session, playerName: 'player', boss: { ...boss, startedAt: 999 } })), 'stale-boss');
        assert.equal(reasonOf(validateAuthoritativeWeeklyBossRun({ run: { ...run, settledAt: 200 }, session, playerName: 'player', boss })), 'already-settled');
    });

    it('rejects membership and boss-actor mismatches', () => {
        assert.equal(reasonOf(validateAuthoritativeWeeklyBossRun({ run, session: { ...session, actors: session.actors.filter((a) => a.side !== 'squad') }, playerName: 'player', boss })), 'not-a-member');
        assert.equal(reasonOf(validateAuthoritativeWeeklyBossRun({ run, session: { ...session, actors: session.actors.filter((a) => a.id !== 'boss') }, playerName: 'player', boss })), 'missing-boss');
    });
});
