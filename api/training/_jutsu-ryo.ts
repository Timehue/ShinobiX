import { jutsuLevelCapForLevel } from '../combat-core/formulas.js';

export type ServerJutsuTraining = {
    serverToken: string;
    jutsuId: string;
    label: string;
    fromLevel: number;
    toLevel: number;
    ryoCost: number;
    startedAt: number;
    endsAt: number;
    next?: ServerQueuedJutsuTraining | null;
    autoClaim?: boolean;
};

export type ServerQueuedJutsuTraining = {
    serverToken: string;
    jutsuId: string;
    label: string;
    fromLevel: number;
    toLevel: number;
    ryoCost: number;
    durationMs: number;
};

const whole = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));
export const jutsuRyoTrainingCost = (levelRaw: unknown): number => {
    const level = whole(levelRaw);
    return level < 10 ? 2500 + level * 500 : 8000 + Math.max(0, level - 10) * 1200;
};
/**
 * `bonusPct` is the player's own (client-reported, hard-clamped) training bonus.
 * `moraleTimeMult` is the village's war MORALE, resolved SERVER-SIDE — a separate
 * multiplier on purpose: folding morale into `bonusPct` meant the loser's debuff
 * could only ever shave an existing bonus, so a player without one felt the
 * advertised "+20% training time" not at all. As its own factor it always bites,
 * in both directions, and the client cannot touch it.
 */
export const jutsuRyoTrainingDuration = (levelRaw: unknown, bonusPctRaw: unknown, moraleTimeMult: unknown = 1): number => {
    const base = whole(levelRaw) < 10 ? 10 * 60_000 : 30 * 60_000;
    const bonus = Math.max(0, Math.min(60, Number(bonusPctRaw) || 0));
    const morale = Math.max(0.5, Math.min(2, Number(moraleTimeMult) || 1));
    return Math.max(60_000, Math.floor(base * (1 - bonus / 100) * morale));
};
export const jutsuRyoTrainingCap = (characterLevel: unknown): number => Math.min(30, jutsuLevelCapForLevel(Math.max(1, whole(characterLevel))));

type Mastery = { jutsuId: string; level: number; xp?: number };
function masteries(character: Record<string, unknown>): Mastery[] {
    return Array.isArray(character.jutsuMastery)
        ? (character.jutsuMastery as unknown[]).filter((row): row is Mastery => !!row && typeof row === 'object' && typeof (row as Mastery).jutsuId === 'string')
        : [];
}
export function currentJutsuLevel(character: Record<string, unknown>, jutsuId: string): number {
    return whole(masteries(character).find((row) => row.jutsuId === jutsuId)?.level);
}
export function applyJutsuLevel(character: Record<string, unknown>, jutsuId: string, requestedLevel: number) {
    const rows = masteries(character);
    const current = rows.find((row) => row.jutsuId === jutsuId);
    const level = Math.max(whole(current?.level), Math.min(jutsuRyoTrainingCap(character.level), whole(requestedLevel)));
    return { ...character, jutsuMastery: [...rows.filter((row) => row.jutsuId !== jutsuId), { jutsuId, level, xp: whole(current?.xp) }] };
}

export function startJutsuRyoTraining(character: Record<string, unknown>, jutsuId: string, label: string, token: string, now: number, bonusPct: unknown, moraleTimeMult: unknown = 1) {
    const fromLevel = currentJutsuLevel(character, jutsuId);
    const cap = jutsuRyoTrainingCap(character.level);
    if (fromLevel >= cap) return { ok: false as const, reason: 'jutsu-at-training-cap' as const };
    if (fromLevel === 0) return { ok: true as const, character: applyJutsuLevel(character, jutsuId, 1), active: null, cost: 0 };
    const cost = jutsuRyoTrainingCost(fromLevel);
    if (whole(character.ryo) < cost) return { ok: false as const, reason: 'not-enough-ryo' as const };
    const duration = jutsuRyoTrainingDuration(fromLevel, bonusPct, moraleTimeMult);
    const active: ServerJutsuTraining = { serverToken: token, jutsuId, label: label.slice(0, 80), fromLevel, toLevel: fromLevel + 1, ryoCost: cost, startedAt: now, endsAt: now + duration };
    return { ok: true as const, character: { ...character, ryo: whole(character.ryo) - cost }, active, cost };
}

export function settleJutsuRyoTraining(character: Record<string, unknown>, active: ServerJutsuTraining, action: 'complete' | 'cancel' | 'finish', now: number) {
    if (action === 'complete') {
        if (now < active.endsAt) return { ok: false as const, reason: 'training-not-finished' as const };
        return { ok: true as const, character: applyJutsuLevel(character, active.jutsuId, active.toLevel), active: null, cost: 0, refund: 0 };
    }
    if (action === 'cancel') {
        const refund = Math.floor(whole(active.ryoCost) * 0.5);
        return { ok: true as const, character: { ...character, ryo: whole(character.ryo) + refund }, active: null, cost: 0, refund };
    }
    const finishCost = Math.max(0, Math.ceil(Math.max(0, active.endsAt - now) / 60_000)) * 500;
    if (whole(character.ryo) < finishCost) return { ok: false as const, reason: 'not-enough-ryo' as const };
    const debited = { ...character, ryo: whole(character.ryo) - finishCost };
    return { ok: true as const, character: applyJutsuLevel(debited, active.jutsuId, active.toLevel), active: null, cost: finishCost, refund: 0 };
}

export function queueJutsuRyoTraining(
    character: Record<string, unknown>,
    active: ServerJutsuTraining,
    jutsuId: string,
    label: string,
    token: string,
    bonusPct: unknown,
    moraleTimeMult: unknown = 1,
) {
    if (active.next) return { ok: false as const, reason: 'jutsu-training-queue-full' as const };
    const fromLevel = active.jutsuId === jutsuId ? active.toLevel : currentJutsuLevel(character, jutsuId);
    const cap = jutsuRyoTrainingCap(character.level);
    if (fromLevel <= 0) return { ok: false as const, reason: 'train-level-zero-directly' as const };
    if (fromLevel >= cap) return { ok: false as const, reason: 'jutsu-at-training-cap' as const };
    const cost = jutsuRyoTrainingCost(fromLevel);
    if (whole(character.ryo) < cost) return { ok: false as const, reason: 'not-enough-ryo' as const };
    const queued: ServerQueuedJutsuTraining = {
        serverToken: token,
        jutsuId,
        label: label.slice(0, 80),
        fromLevel,
        toLevel: fromLevel + 1,
        ryoCost: cost,
        durationMs: jutsuRyoTrainingDuration(fromLevel, bonusPct, moraleTimeMult),
    };
    return {
        ok: true as const,
        character: { ...character, ryo: whole(character.ryo) - cost },
        active: { ...active, next: queued },
        cost,
        refund: 0,
    };
}

export function cancelQueuedJutsuRyoTraining(character: Record<string, unknown>, active: ServerJutsuTraining) {
    if (!active.next) return { ok: false as const, reason: 'jutsu-training-queue-empty' as const };
    const refund = whole(active.next.ryoCost);
    return {
        ok: true as const,
        character: { ...character, ryo: whole(character.ryo) + refund },
        active: { ...active, next: null },
        cost: 0,
        refund,
    };
}

export function advanceQueuedJutsuRyoTraining(character: Record<string, unknown>, active: ServerJutsuTraining, now: number) {
    let nextCharacter = character;
    let current: ServerJutsuTraining | null = active;
    for (let step = 0; current && step < 4 && now >= current.endsAt; step += 1) {
        if (current.next) {
            nextCharacter = applyJutsuLevel(nextCharacter, current.jutsuId, current.toLevel);
            const queued: ServerQueuedJutsuTraining = current.next;
            const startedAt: number = current.endsAt;
            current = {
                serverToken: queued.serverToken,
                jutsuId: queued.jutsuId,
                label: queued.label,
                fromLevel: queued.fromLevel,
                toLevel: queued.toLevel,
                ryoCost: queued.ryoCost,
                startedAt,
                endsAt: startedAt + queued.durationMs,
                next: null,
                autoClaim: true,
            };
            continue;
        }
        if (current.autoClaim) {
            nextCharacter = applyJutsuLevel(nextCharacter, current.jutsuId, current.toLevel);
            current = null;
        }
        break;
    }
    return { ok: true as const, character: nextCharacter, active: current, cost: 0, refund: 0 };
}
