import { createHash, randomUUID } from 'node:crypto';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { LIBERATOR_TITLES, STORY_LEVELS, STORY_REWARDS, storyOpponentId } from './_settle.js';

/*
 * Server-authoritative story-boss combat (SERVER_COMBAT_MIGRATION_PLAN Stage 4,
 * "high-value authored fights first"). Mirrors the mission pattern in
 * api/missions/_authoritative-combat-session.ts: /api/story/boss-start seals
 * the CURRENT story milestone (village + progress index + opponent + reward
 * table row) into a binding + a solo Tower session; /api/story/settle's runId
 * branch pays ONLY from a completed, winning, bound session. The client's old
 * role — attesting "I won" via the mint-at-start AiFightToken — is retired for
 * story bosses (kept for the capped Academy spar tutorial).
 */

export const STORY_COMBAT_SESSION_TTL_MS = 45 * 60 * 1000;
export const STORY_COMBAT_SESSION_TTL_SECONDS = Math.ceil(STORY_COMBAT_SESSION_TTL_MS / 1000);

export function storyCombatBindingKey(runId: string): string {
    return `story-combat-binding:${runId}`;
}

// Mirrors the client's data/village-biomes.ts map so the sealed fight keeps the
// chapter's authored battlefield feel. Values must stay within TOWER_BIOMES.
export const STORY_VILLAGE_BIOMES: Record<string, string> = {
    'Stormveil Village': 'forest',
    'Ashen Leaf Village': 'volcano',
    'Frostfang Village': 'snow',
    'Moonshadow Village': 'shadow',
};

export interface StoryCombatBinding {
    version: 1;
    sessionId: string;
    runId: string;
    playerName: string;
    village: string;
    progressIndex: number;
    opponentId: string;
    rewardFingerprint: string;
    createdAt: number;
    expiresAt: number;
    status: 'active' | 'won' | 'lost' | 'abandoned';
    settledAt?: number;
    /**
     * Which story-lane fight this binding seals. Absent means 'boss', so
     * bindings written before the Academy spar migration keep validating as
     * milestone bosses — the field is additive, never a re-interpretation.
     * A spar binding carries no milestone: its gate is onboarding state
     * (api/story/_academy-spar.ts), not storyProgress.
     */
    kind?: 'boss' | 'spar';
}

export type StoryCombatValidation =
    | { ok: true; binding: StoryCombatBinding }
    | { ok: false; reason: 'invalid-binding' | 'wrong-player' | 'wrong-milestone' | 'wrong-run' | 'expired' | 'already-settled' | 'not-complete' | 'not-won' | 'not-a-member' | 'reward-drift' };

export function storyCombatRewardFingerprint(village: string, progressIndex: number): string {
    const reward = STORY_REWARDS[progressIndex];
    return createHash('sha256').update(JSON.stringify({
        village,
        progressIndex,
        opponentId: storyOpponentId(village, STORY_LEVELS[progressIndex] ?? 0),
        // Fingerprint key name kept as `xp` for shape stability; the value is
        // now the milestone's stat-point grant. A binding minted BEFORE the XP
        // removal will fingerprint differently and settle as reward-drift once
        // — the player re-fights that milestone (one-time deploy cost).
        xp: reward?.statPoints ?? 0,
        ryo: reward?.ryo ?? 0,
    })).digest('hex');
}

export type StoryBossEligibility =
    | { ok: true; progressIndex: number; levelReq: number; village: string }
    | { ok: false; status: number; error: string };

export function storyBossEligibility(character: Record<string, unknown>): StoryBossEligibility {
    const progressIndex = Math.max(0, Math.floor(Number(character.storyProgress) || 0));
    if (progressIndex >= STORY_LEVELS.length) return { ok: false, status: 409, error: 'Village story is already complete.' };
    const levelReq = STORY_LEVELS[progressIndex];
    const playerLevel = Math.max(1, Math.floor(Number(character.level) || 1));
    if (playerLevel < levelReq) return { ok: false, status: 403, error: `Story milestone requires level ${levelReq}.` };
    const village = typeof character.village === 'string' ? character.village : '';
    if (!LIBERATOR_TITLES[village]) return { ok: false, status: 409, error: 'Player village has no story catalog.' };
    return { ok: true, progressIndex, levelReq, village };
}

export function createStoryCombatBinding(params: {
    runId: string;
    playerName: string;
    village: string;
    progressIndex: number;
    now?: number;
}): StoryCombatBinding {
    const now = params.now ?? Date.now();
    const levelReq = STORY_LEVELS[params.progressIndex] ?? 0;
    return {
        version: 1,
        sessionId: params.runId,
        runId: params.runId,
        playerName: params.playerName,
        village: params.village,
        progressIndex: params.progressIndex,
        opponentId: storyOpponentId(params.village, levelReq),
        rewardFingerprint: storyCombatRewardFingerprint(params.village, params.progressIndex),
        createdAt: now,
        expiresAt: now + STORY_COMBAT_SESSION_TTL_MS,
        status: 'active',
    };
}

/**
 * The checks that are true of ANY sealed story-lane run, milestone or not:
 * the binding is ours, unspent and unexpired, and the session it names really
 * did complete as a win with this player on the squad side. Split out so the
 * Academy spar (api/story/_academy-spar.ts) can demand exactly these without
 * inheriting the milestone and reward-fingerprint checks, which mean nothing
 * for a tutorial bout.
 */
export function validateSealedStoryRun(params: {
    binding: StoryCombatBinding | null | undefined;
    session: SoloPveSession | null | undefined;
    playerName: string;
    now?: number;
}): StoryCombatValidation {
    const { binding, session, playerName } = params;
    const now = params.now ?? Date.now();
    if (!binding || binding.version !== 1 || !binding.sessionId || !binding.runId) return { ok: false, reason: 'invalid-binding' };
    if (binding.playerName !== playerName) return { ok: false, reason: 'wrong-player' };
    if (!session || binding.sessionId !== session.sessionId || binding.runId !== session.sessionId) return { ok: false, reason: 'wrong-run' };
    if (binding.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (binding.settledAt || binding.status !== 'active') return { ok: false, reason: 'already-settled' };
    if (session.status !== 'done') return { ok: false, reason: 'not-complete' };
    if (session.winner !== 'player') return { ok: false, reason: 'not-won' };
    if (session.ownerSlug !== playerName) return { ok: false, reason: 'not-a-member' };
    const expectedKind = binding.kind === 'spar' ? 'academy-spar' : 'story-boss';
    if (session.encounter.kind !== expectedKind
        || session.encounter.sourceId !== binding.opponentId
        || session.encounter.bindingId !== binding.runId) return { ok: false, reason: 'wrong-run' };
    return { ok: true, binding };
}

export function validateCompletedStoryCombatSession(params: {
    binding: StoryCombatBinding | null | undefined;
    session: SoloPveSession | null | undefined;
    playerName: string;
    character: Record<string, unknown>;
    now?: number;
}): StoryCombatValidation {
    const { binding, character } = params;
    // A spar binding can never settle a milestone, whatever else it satisfies.
    if (binding?.kind === 'spar') return { ok: false, reason: 'wrong-milestone' };
    // The save's CURRENT milestone must still be the one that was sealed —
    // a stale session from an earlier chapter (or another village) cannot pay
    // the next milestone. Checked BEFORE the shared run checks so the reason
    // codes stay exactly what they were.
    if (binding && binding.version === 1 && binding.sessionId && binding.runId && binding.playerName === params.playerName) {
        const progressIndex = Math.max(0, Math.floor(Number(character.storyProgress) || 0));
        const village = typeof character.village === 'string' ? character.village : '';
        if (binding.progressIndex !== progressIndex || binding.village !== village) return { ok: false, reason: 'wrong-milestone' };
    }
    const shared = validateSealedStoryRun(params);
    if (!shared.ok) return shared;
    if (shared.binding.rewardFingerprint !== storyCombatRewardFingerprint(shared.binding.village, shared.binding.progressIndex)) {
        return { ok: false, reason: 'reward-drift' };
    }
    return { ok: true, binding: shared.binding };
}

export function settleStoryCombatBinding(binding: StoryCombatBinding, now = Date.now()): StoryCombatBinding {
    if (binding.status !== 'active' || binding.settledAt) return binding;
    return { ...binding, status: 'won', settledAt: now };
}

/** The player's surviving HP as the SERVER recorded it — replaces the old client-reported survivingHp. */
export function storySessionSurvivingHp(session: SoloPveSession, _playerName: string): number {
    return Math.max(0, Math.floor(Number(session.player.hp) || 0));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

/**
 * Server-owned story boss stats, scaled from the milestone level like
 * missionEnemyTemplate (api/_authoritative-pve.ts) with a boss-arc ramp:
 * early chapters fight gently above the mission curve, the finale hits hard.
 * The authored bossName from the client is DISPLAY-ONLY (never affects stats).
 */
export function storyBossEnemyTemplate(params: {
    village: string;
    progressIndex: number;
    displayName?: string;
}) {
    const progressIndex = clampInt(params.progressIndex, 0, STORY_LEVELS.length - 1, 0);
    const level = STORY_LEVELS[progressIndex];
    const arc = STORY_LEVELS.length <= 1 ? 1 : progressIndex / (STORY_LEVELS.length - 1);
    const specialty = (['Genjutsu', 'Taijutsu', 'Ninjutsu', 'Bukijutsu'] as const)[progressIndex % 4];
    const power = 1 + arc * 0.25;
    const offense = clampInt((150 + level * 27) * power, 180, 3200, 500);
    const defense = clampInt((120 + level * 20) * power, 140, 2600, 400);
    const name = typeof params.displayName === 'string' && params.displayName.trim()
        ? params.displayName.trim().slice(0, 80)
        : `${params.village.replace(/ Village$/, '')} Story Boss`;
    return {
        id: storyOpponentId(params.village, level),
        name,
        specialty,
        level,
        hp: clampInt((240 + level * level * 1.05) * (1.05 + arc * 0.4), 250, 14_000, 1000),
        stats: {
            [`${specialty.toLowerCase()}Offense`]: offense,
            [`${specialty.toLowerCase()}Defense`]: defense,
            strength: clampInt((80 + level * 8) * power, 80, 1100, 200),
            speed: clampInt((80 + level * 7) * power, 80, 1000, 200),
            intelligence: clampInt((80 + level * 7) * power, 80, 1000, 200),
            willpower: clampInt((80 + level * 7) * power, 80, 1000, 200),
        },
        visual: storyOpponentId(params.village, level),
        boss: true,
        armorRawDR: 0.05 + arc * 0.13,
        maxChakra: 120 + level * 4,
        maxStamina: 120 + level * 4,
        jutsu: [{
            id: `story-${progressIndex}-signature`,
            name: `${specialty} Signature`,
            type: specialty,
            element: 'None',
            ap: 60,
            range: specialty === 'Taijutsu' ? 1 : 3,
            effectPower: clampInt(22 + level * 0.55, 24, 72, 35),
            chakraCost: specialty === 'Taijutsu' || specialty === 'Bukijutsu' ? 0 : 18,
            staminaCost: specialty === 'Taijutsu' || specialty === 'Bukijutsu' ? 18 : 0,
            cooldown: 2,
            method: 'SINGLE',
        }],
    };
}

export function storyBossRunId(): string {
    return `story-${randomUUID().replace(/-/g, '')}`;
}
