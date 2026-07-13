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

/** Convert the one pre-token session already preserved in a save into a bounded grant. */
export function parseLegacyTraining(value: unknown): LegacyTrainingGrant | null {
    if (!value || typeof value !== 'object') return null;
    const active = value as Record<string, unknown>;
    if (typeof active.token === 'string' && active.token.trim()) return null;

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
