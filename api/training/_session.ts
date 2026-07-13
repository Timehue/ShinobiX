import { trainingStatGain, type TrainingTier } from '../_training-config.js';

export const TRAINING_TOKEN_TTL_SECONDS = 25 * 60 * 60;
export const MAX_TRAINING_RECEIPTS = 256;

export interface ActiveTrainingSession {
    token: string;
    startedAt: number;
    endsAt: number;
    expiresAt: number;
}

export function normalizeActiveTrainingSession(raw: unknown): ActiveTrainingSession | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const token = typeof record.token === 'string' && /^[A-Za-z0-9]+$/.test(record.token)
        ? record.token
        : '';
    const startedAt = Number(record.startedAt);
    const endsAt = Number(record.endsAt);
    const expiresAt = Number(record.expiresAt);
    if (!token || !Number.isSafeInteger(startedAt) || !Number.isSafeInteger(endsAt) || !Number.isSafeInteger(expiresAt)) {
        return null;
    }
    if (startedAt <= 0 || endsAt <= startedAt || expiresAt <= endsAt) return null;
    return { token, startedAt, endsAt, expiresAt };
}

/** Only a live token may keep the single-session lease occupied. */
export function activeTrainingBlocksStart(raw: unknown, tokenExists: boolean, now = Date.now()): boolean {
    const active = normalizeActiveTrainingSession(raw);
    return !!active && tokenExists && active.expiresAt > now;
}

export function activeTrainingMatches(raw: unknown, token: string): boolean {
    return normalizeActiveTrainingSession(raw)?.token === token;
}

/**
 * Stat training temporarily uses base rewards only. This function deliberately
 * has no client-input parameters; village and war modifiers can return only
 * after they are derived from trusted server state.
 */
export function trustedTrainingRewards(tier: TrainingTier): { sealedGain: number; sealedXp: number } {
    return {
        sealedGain: Math.max(0, Math.round(trainingStatGain(tier, tier.ms, 0))),
        sealedXp: Math.max(0, Math.round(tier.xp)),
    };
}
