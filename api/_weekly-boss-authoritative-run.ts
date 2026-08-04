import type { SoloPveSession } from './solo-pve/_session.js';

export type WeeklyBossAuthoritativeRun = {
    runId: string;
    playerName: string;
    weekKey: string;
    aiId: string;
    bossStartedAt: number;
    initialBossHp: number;
    createdAt: number;
    startState?: 'prepared' | 'ready';
    settledAt?: number;
};

export const weeklyBossRunKey = (runId: string) => `weekly-boss-run:${runId}`;

export type WeeklyBossRunValidation =
    | { ok: true; damage: number }
    | { ok: false; reason: 'missing-run' | 'wrong-player' | 'already-settled' | 'missing-session' | 'not-finished' | 'not-a-member' | 'stale-boss' | 'missing-boss' };

export function validateAuthoritativeWeeklyBossRun(params: {
    run: WeeklyBossAuthoritativeRun | null | undefined;
    session: SoloPveSession | null | undefined;
    playerName: string;
    admin?: boolean;
    boss: { weekKey: string; aiId: string; startedAt: number };
}): WeeklyBossRunValidation {
    const { run, session } = params;
    if (!run) return { ok: false, reason: 'missing-run' };
    if (!params.admin && run.playerName !== params.playerName) return { ok: false, reason: 'wrong-player' };
    if (run.settledAt) return { ok: false, reason: 'already-settled' };
    if (run.startState === 'prepared') return { ok: false, reason: 'not-finished' };
    if (!session) return { ok: false, reason: 'missing-session' };
    if (session.runtime !== 'solo-pve' || session.status !== 'done' || !session.terminalEvidence) return { ok: false, reason: 'not-finished' };
    if (session.ownerSlug !== run.playerName) {
        return { ok: false, reason: 'not-a-member' };
    }
    if (session.encounter.kind !== 'weekly-boss'
        || session.encounter.bindingId !== run.runId
        || session.encounter.sourceId !== run.aiId
        || session.encounter.metadata?.weekKey !== run.weekKey
        || Number(session.encounter.metadata?.bossStartedAt) !== run.bossStartedAt) {
        return { ok: false, reason: 'stale-boss' };
    }
    if (run.weekKey !== params.boss.weekKey || run.aiId !== params.boss.aiId || run.bossStartedAt !== params.boss.startedAt) {
        return { ok: false, reason: 'stale-boss' };
    }
    if (!session.enemy) return { ok: false, reason: 'missing-boss' };
    return { ok: true, damage: Math.max(0, Math.floor(run.initialBossHp - Math.max(0, session.enemy.hp))) };
}
