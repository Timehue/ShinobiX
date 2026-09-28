import { MAX_STAT, STAT_KEYS } from '../_xp-engine.js';

export const STAT_RESPEC_FATE_COST = 50;

type CharacterLike = Record<string, unknown>;
type StatMap = Record<string, number>;

function normalizedStats(value: unknown): StatMap {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return Object.fromEntries(STAT_KEYS.map((key) => {
        const parsed = Number(raw[key]);
        return [key, Number.isFinite(parsed) ? Math.max(10, Math.min(MAX_STAT, Math.floor(parsed))) : 10];
    }));
}

function unspent(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function allocated(stats: StatMap): number {
    return STAT_KEYS.reduce((total, key) => total + Math.max(0, stats[key] - 10), 0);
}

export function applyPaidStatRespec(character: CharacterLike): CharacterLike | null {
    const stats = normalizedStats(character.stats);
    const refund = allocated(stats);
    const shards = Math.max(0, Math.floor(Number(character.fateShards) || 0));
    if (refund <= 0 || shards < STAT_RESPEC_FATE_COST) return null;
    return {
        ...character,
        stats: Object.fromEntries(STAT_KEYS.map((key) => [key, 10])),
        unspentStats: unspent(character.unspentStats) + refund,
        fateShards: shards - STAT_RESPEC_FATE_COST,
    };
}

/**
 * Per-stat increases from `existing` to `incoming` that are NOT a proven
 * allocation of the player's own pool — what the save handler's per-minute
 * stat window should count.
 *
 * Spending banked points is not a gain: the points were earned (and rate-
 * limited) when the server granted them. So when preserveStatPointEntitlement
 * classifies the save as an exact `allocation` (total unchanged, every
 * increase paid for by an equal drop in unspentStats), the funded amount is
 * subtracted. Anything else still counts in full: a save it rejects, the
 * legacy branch that accepts stats unchecked, and any part of a raw value that
 * the classifier had to clamp (it reads stats bounded to 10..MAX_STAT).
 *
 * Call it on the FINAL sanitized character, never the raw request body.
 */
export function unfundedStatGains(incoming: CharacterLike, existing: CharacterLike): Record<string, number> {
    const rawIn = incoming.stats && typeof incoming.stats === 'object' ? incoming.stats as Record<string, unknown> : {};
    const rawEx = existing.stats && typeof existing.stats === 'object' ? existing.stats as Record<string, unknown> : {};
    const funded: Record<string, number> = {};
    if (preserveStatPointEntitlement(incoming, existing).accepted === 'allocation') {
        const inStats = normalizedStats(incoming.stats);
        const exStats = normalizedStats(existing.stats);
        for (const key of STAT_KEYS) funded[key] = Math.max(0, inStats[key] - exStats[key]);
    }
    const out: Record<string, number> = {};
    for (const key of Object.keys(rawIn)) {
        // Same arithmetic the handler has always used, so anything that was not
        // counted before (a non-numeric value) is still not counted.
        const delta = Math.max(0, Number(rawIn[key] ?? 0) - Number(rawEx[key] ?? 0));
        if (!(delta > 0)) continue;
        const counted = delta - (funded[key] ?? 0);
        if (counted > 0) out[key] = counted;
    }
    return out;
}

/**
 * Ordinary saves may allocate the server-owned stat-point pool, or perform the
 * existing paid full respec. They may never create stat points. Training and
 * combat rewards write their grants directly to the stored save first.
 */
export function preserveStatPointEntitlement(incoming: CharacterLike, existing: CharacterLike): {
    stats: StatMap;
    unspentStats: number;
    accepted: 'unchanged' | 'allocation' | 'respec' | 'rejected';
} {
    const exStats = normalizedStats(existing.stats);
    const inStats = normalizedStats(incoming.stats);
    const exUnspent = unspent(existing.unspentStats);
    const inUnspent = unspent(incoming.unspentStats);
    const exTotal = allocated(exStats) + exUnspent;
    const inTotal = allocated(inStats) + inUnspent;

    if (inTotal !== exTotal) return { stats: exStats, unspentStats: exUnspent, accepted: 'rejected' };

    const deltas = STAT_KEYS.map((key) => inStats[key] - exStats[key]);
    if (deltas.every((delta) => delta === 0) && inUnspent === exUnspent) {
        return { stats: inStats, unspentStats: inUnspent, accepted: 'unchanged' };
    }

    const gained = deltas.reduce((total, delta) => total + Math.max(0, delta), 0);
    if (deltas.every((delta) => delta >= 0) && exUnspent - inUnspent === gained) {
        return { stats: inStats, unspentStats: inUnspent, accepted: 'allocation' };
    }

    const isFullReset = STAT_KEYS.every((key) => inStats[key] === 10);
    const fateBefore = Math.max(0, Number(existing.fateShards) || 0);
    const fateAfter = Math.max(0, Number(incoming.fateShards) || 0);
    if (isFullReset && inUnspent === exUnspent + allocated(exStats) && fateBefore - fateAfter >= STAT_RESPEC_FATE_COST) {
        return { stats: inStats, unspentStats: inUnspent, accepted: 'respec' };
    }

    return { stats: exStats, unspentStats: exUnspent, accepted: 'rejected' };
}
