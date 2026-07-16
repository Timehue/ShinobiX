"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weeklyBossRunKey = void 0;
exports.validateAuthoritativeWeeklyBossRun = validateAuthoritativeWeeklyBossRun;
const weeklyBossRunKey = (runId) => `weekly-boss-run:${runId}`;
exports.weeklyBossRunKey = weeklyBossRunKey;
function validateAuthoritativeWeeklyBossRun(params) {
    const { run, session } = params;
    if (!run)
        return { ok: false, reason: 'missing-run' };
    if (!params.admin && run.playerName !== params.playerName)
        return { ok: false, reason: 'wrong-player' };
    if (run.settledAt)
        return { ok: false, reason: 'already-settled' };
    if (!session)
        return { ok: false, reason: 'missing-session' };
    if (session.status !== 'done')
        return { ok: false, reason: 'not-finished' };
    if (!session.actors.some((entry) => entry.side === 'squad' && entry.ownerSlug === run.playerName)) {
        return { ok: false, reason: 'not-a-member' };
    }
    if (run.weekKey !== params.boss.weekKey || run.aiId !== params.boss.aiId || run.bossStartedAt !== params.boss.startedAt) {
        return { ok: false, reason: 'stale-boss' };
    }
    const bossActor = session.actors.find((entry) => entry.id === session.phaseState.bossId);
    if (!bossActor)
        return { ok: false, reason: 'missing-boss' };
    return { ok: true, damage: Math.max(0, Math.floor(run.initialBossHp - Math.max(0, bossActor.hp))) };
}
