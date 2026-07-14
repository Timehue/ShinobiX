import { trainingStatGain, type TrainingTier } from '../_training-config.js';

export const TRAINING_TOKEN_TTL_SECONDS = 25 * 60 * 60;
export const MAX_TRAINING_RECEIPTS = 256;

export interface ActiveTrainingSession {
    token: string;
    startedAt: number;
    endsAt: number;
    expiresAt: number;
}

export interface StoredTrainingGrant {
    stat: string;
    startedAt: number;
    endsAt: number;
    sealedGain: number;
    sealedXp: number;
}

const TRAINING_STATS = new Set([
    'strength', 'speed', 'intelligence', 'willpower',
    'ninjutsuOffense', 'ninjutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'bukijutsuOffense', 'bukijutsuDefense',
]);

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

/** A server-owned saved lease remains redeemable even after its cache token ages out. */
export function activeTrainingBlocksStart(raw: unknown): boolean {
    return normalizeActiveTrainingSession(raw) !== null;
}

export function activeTrainingMatches(raw: unknown, token: string): boolean {
    return normalizeActiveTrainingSession(raw)?.token === token;
}

/**
 * Recover the sealed reward from the server-owned save lease when the short-lived
 * KV acceleration token has expired. Generic saves cannot replace activeTraining,
 * so this is the same authority boundary as the original token record.
 */
export function storedTrainingGrant(raw: unknown, token: string): StoredTrainingGrant | null {
    const active = normalizeActiveTrainingSession(raw);
    if (!active || active.token !== token || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const stat = typeof record.stat === 'string' ? record.stat : '';
    const sealedGain = Math.floor(Number(record.statGain));
    const sealedXp = Math.floor(Number(record.xp));
    if (!TRAINING_STATS.has(stat)) return null;
    if (!Number.isFinite(sealedGain) || sealedGain < 0 || sealedGain > 300) return null;
    if (!Number.isFinite(sealedXp) || sealedXp < 0 || sealedXp > 750) return null;
    return { stat, startedAt: active.startedAt, endsAt: active.endsAt, sealedGain, sealedXp };
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
