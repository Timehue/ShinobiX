import type { Character } from '../types/character';
import type { TowerHostLoadout, TowerSession } from './towers-api';

/*
 * Server-authoritative story-boss combat (mirrors lib/hollow-gate-combat-api).
 * /api/story/boss-start seals the CURRENT milestone into a solo Tower session;
 * /api/story/settle (runId channel) pays the story reward only from the
 * completed, winning server session — the client never attests the outcome.
 */

export type StoryBossStartResult = {
    ok: boolean;
    runId: string;
    session: TowerSession;
    error?: string;
};

export type StoryBossSettleResult = {
    ok: boolean;
    replayed?: boolean;
    progress: number;
    xp: number; // retired (character XP removed) — servers send 0
    statPoints?: number; // one-time milestone stat-pool grant
    ryo: number;
    auraDust: number;
    finale: boolean;
    title?: string;
    character?: Character | null;
    _saveVersion?: number;
    error?: string;
};

export async function startStoryBossCombat(params: {
    playerName: string;
    bossName?: string;
    hostLoadout?: TowerHostLoadout;
}): Promise<StoryBossStartResult> {
    const response = await fetch('/api/story/boss-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    const data = await response.json().catch(() => ({})) as Partial<StoryBossStartResult>;
    if (!response.ok || !data.runId || !data.session) throw new Error(data.error ?? 'The story battle could not start.');
    return data as StoryBossStartResult;
}

export async function settleStoryBossCombat(params: {
    playerName: string;
    runId: string;
}): Promise<StoryBossSettleResult> {
    const response = await fetch('/api/story/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, kind: 'storyBoss' }),
    });
    const data = await response.json().catch(() => ({})) as Partial<StoryBossSettleResult>;
    if (!response.ok || data.ok !== true) throw new Error(data.error ?? 'The story reward could not be verified.');
    return data as StoryBossSettleResult;
}
