import { getLegacyStats, legacyEnabled, legacyStatsKey, attemptSageAfterVerifiedProgress, type LegacyStatDeltas, type LegacyStats } from './_legacy-track.js';

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
    const withDeltas = (base: LegacyStats): LegacyStats => {
        const out = { ...base, updatedAt: Date.now() };
        for (const [key, delta] of entries) {
            const stat = key as keyof LegacyStatDeltas;
            const current = Number(base[stat]);
            out[stat] = (Number.isFinite(current) ? current : 0) + Math.floor(Number(delta));
        }
        return out;
    };
    let next = withDeltas(previous);
    return {
        // ex:0 is permanent in both storage adapters, like ordinary Legacy stats.
        // These stats are also written under their own lock (PvP, Sage, reconcile),
        // so a row that moved after this read is rebased: the deltas add to it.
        atomicProof: {
            key: legacyStatsKey(playerName), expected: previous, value: next, ex: 0,
            rebase: (current: unknown) => {
                next = current && typeof current === 'object' ? withDeltas(current as LegacyStats) : withDeltas(previous);
                return next;
            },
        },
        afterCommit: () => attemptSageAfterVerifiedProgress(playerName, next),
    };
}
