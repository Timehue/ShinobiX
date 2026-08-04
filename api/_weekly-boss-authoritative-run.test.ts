import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateAuthoritativeWeeklyBossRun, type WeeklyBossAuthoritativeRun } from './_weekly-boss-authoritative-run.js';
import type { SoloPveSession } from './solo-pve/_session.js';

const run: WeeklyBossAuthoritativeRun = {
    runId: 'weekly-1', playerName: 'player', weekKey: '2026-W29', aiId: 'oni',
    bossStartedAt: 100, initialBossHp: 99_999_999, createdAt: 101,
};
const session = {
    runtime: 'solo-pve',
    schemaVersion: 1,
    sessionId: 'weekly-1',
    ownerSlug: 'player',
    status: 'done',
    terminalEvidence: { outcome: 'loss' },
    encounter: {
        kind: 'weekly-boss', id: '2026-W29', sourceId: 'oni', bindingId: 'weekly-1',
        metadata: { weekKey: '2026-W29', bossStartedAt: 100 },
    },
    enemy: { hp: 99_998_765 },
} as unknown as SoloPveSession;
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

    it('rejects membership, encounter binding, and boss mismatches', () => {
        assert.equal(reasonOf(validateAuthoritativeWeeklyBossRun({ run, session: { ...session, ownerSlug: 'other' }, playerName: 'player', boss })), 'not-a-member');
        assert.equal(reasonOf(validateAuthoritativeWeeklyBossRun({ run, session: { ...session, encounter: { ...session.encounter, bindingId: 'forged' } }, playerName: 'player', boss })), 'stale-boss');
        assert.equal(reasonOf(validateAuthoritativeWeeklyBossRun({ run, session: { ...session, enemy: null } as unknown as SoloPveSession, playerName: 'player', boss })), 'missing-boss');
    });
});
