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
};

const whole = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));
export const jutsuRyoTrainingCost = (levelRaw: unknown): number => {
    const level = whole(levelRaw);
    return level < 10 ? 2500 + level * 500 : 8000 + Math.max(0, level - 10) * 1200;
};
export const jutsuRyoTrainingDuration = (levelRaw: unknown, bonusPctRaw: unknown): number => {
    const base = whole(levelRaw) < 10 ? 10 * 60_000 : 30 * 60_000;
    const bonus = Math.max(0, Math.min(60, Number(bonusPctRaw) || 0));
    return Math.max(60_000, Math.floor(base * (1 - bonus / 100)));
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

export function startJutsuRyoTraining(character: Record<string, unknown>, jutsuId: string, label: string, token: string, now: number, bonusPct: unknown) {
    const fromLevel = currentJutsuLevel(character, jutsuId);
    const cap = jutsuRyoTrainingCap(character.level);
    if (fromLevel >= cap) return { ok: false as const, reason: 'jutsu-at-training-cap' as const };
    if (fromLevel === 0) return { ok: true as const, character: applyJutsuLevel(character, jutsuId, 1), active: null, cost: 0 };
    const cost = jutsuRyoTrainingCost(fromLevel);
    if (whole(character.ryo) < cost) return { ok: false as const, reason: 'not-enough-ryo' as const };
    const duration = jutsuRyoTrainingDuration(fromLevel, bonusPct);
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
