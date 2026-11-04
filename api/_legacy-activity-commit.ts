import { getLegacyStats, legacyEnabled, legacyStatsKey, attemptSageAfterVerifiedProgress, type LegacyStatDeltas } from './_legacy-track.js';

/**
 * Join a new deed to its source save transaction, after the source replay guard.
 * Save, currency ledger and stats either all commit or none do. Existing source
 * receipts own replay, so no second receipt list can expire ahead of a reward.
 */
export async function legacyActivityCommit(
    playerName: string,
    character: Record<string, unknown>,
    deltas: LegacyStatDeltas,
) {
    if (!legacyEnabled()) return {};
    const entries = Object.entries(deltas).filter(([, value]) => Number.isFinite(value) && Number(value) >= 1);
    if (!entries.length) return {};
    const previous = await getLegacyStats(playerName, character);
    const next = { ...previous, updatedAt: Date.now() };
    for (const [key, delta] of entries) {
        const stat = key as keyof LegacyStatDeltas;
        const current = Number(previous[stat]);
        next[stat] = (Number.isFinite(current) ? current : 0) + Math.floor(Number(delta));
    }
    return {
        // ex:0 is permanent in both storage adapters, like ordinary Legacy stats.
        atomicProof: { key: legacyStatsKey(playerName), expected: previous, value: next, ex: 0 },
        afterCommit: () => attemptSageAfterVerifiedProgress(playerName, next),
    };
}
