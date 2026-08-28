import { normalizeActiveTrainingSession } from './_session.js';

const TRAINING_STATS = new Set([
    'strength', 'speed', 'intelligence', 'willpower',
    'ninjutsuOffense', 'ninjutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'bukijutsuOffense', 'bukijutsuDefense',
]);

const LEGACY_DURATIONS = new Set([
    15 * 60 * 1000,
    60 * 60 * 1000,
    4 * 60 * 60 * 1000,
    8 * 60 * 60 * 1000,
]);

export interface LegacyTrainingGrant {
    token: string;
    stat: string;
    startedAt: number;
    endsAt: number;
    sealedGain: number;
    sealedXp: number;
}

/** Convert a pre-modern session already preserved in a save into a bounded grant. */
export function parseLegacyTraining(value: unknown): LegacyTrainingGrant | null {
    if (!value || typeof value !== 'object') return null;
    const active = value as Record<string, unknown>;
    // Stand down for exactly one thing: a lease the MODERN path can actually
    // redeem. Deferring on anything else recreates the dead zone this parser
    // exists to close — the build retired on 2026-07-12 minted a token but never
    // wrote `startedAt`/`expiresAt`, and because this guard used to refuse any
    // token at all, those records satisfied NEITHER validator and deadlocked
    // their owners for weeks. Testing the field shape here (say, "has startedAt
    // and expiresAt") would reopen the same hole one shape over: a record with
    // those two fields but no usable token would again be refused by both sides.
    // Asking normalizeActiveTrainingSession directly makes that impossible —
    // whatever it turns down, this parser is still allowed to rescue.
    if (normalizeActiveTrainingSession(value) !== null) return null;

    const stat = typeof active.stat === 'string' ? active.stat : '';
    const endsAt = Math.floor(Number(active.endsAt));
    const durationMs = Math.floor(Number(active.durationMs));
    const sealedGain = Math.floor(Number(active.statGain));
    const sealedXp = Math.floor(Number(active.xp));
    if (!TRAINING_STATS.has(stat) || !Number.isFinite(endsAt) || !LEGACY_DURATIONS.has(durationMs)) return null;
    if (!Number.isFinite(sealedGain) || sealedGain < 0 || sealedGain > 300) return null;
    if (!Number.isFinite(sealedXp) || sealedXp < 0 || sealedXp > 750) return null;

    const startedAt = endsAt - durationMs;
    if (!Number.isSafeInteger(startedAt) || startedAt <= 0) return null;
    return { token: `legacy${endsAt.toString(36)}${stat}`, stat, startedAt, endsAt, sealedGain, sealedXp };
}
