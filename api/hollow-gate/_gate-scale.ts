/*
 * Hollow Gate and Rift pay dials (2026-10 economy rebalance, framework #1, #12, I-18).
 *
 * Gate and Rift ryo scale with the runner's level, sealed on the run token at
 * start: a level-12 Rift used to pay the full L60+ purse, five times the
 * anchor. Only ryo scales. Fate Shards, Bone Charms, Aura Stones, Aura Dust,
 * Hollow Shards and Honor Seals keep their own tables.
 */
import { anchorRyoPerMinute } from '../../shared/economy-anchor.js';
import { economyDial } from '../_economy-dials.js';

/** Ryo per active minute of a full L60+ run before the augment: 31,205 ryo over ~100 min. */
export const GATE_RYO_REFERENCE_PER_MIN = 312;

/**
 * Code default of the GATE_RYO_K dial: scale = min(1, K * A(L) / 312).
 *
 * The framework sized K = 1.2 on run totals that leave out the augment, but
 * every run must take one before it can move (step.ts, event.ts) and the
 * cheapest pays 1.2x on every currency. 1.04 (= A(L) / 300) keeps a Rift or
 * full run inside the 1.0-1.5x anchor band with that free augment, and full
 * pay starts where the anchor plateaus (L70).
 */
export const GATE_RYO_K = 1.04;
export const GATE_RYO_K_MIN = 1;
export const GATE_RYO_K_MAX = 1.4;
/** Kill value: lifts every level to the flat pay. */
export const GATE_RYO_K_FLAT = 99;

/** Env GATE_RYO_K inside [1, 1.4], or exactly 99 (flat); anything else is the default. */
export function gateRyoK(): number {
    const k = economyDial('GATE_RYO_K', GATE_RYO_K, { min: GATE_RYO_K_MIN, max: GATE_RYO_K_FLAT });
    return k <= GATE_RYO_K_MAX || k === GATE_RYO_K_FLAT ? k : GATE_RYO_K;
}

/** The level a run seals at start (1-100). */
export function hollowGateEntryLevel(levelRaw: unknown): number {
    return Math.max(1, Math.min(100, Math.floor(Number(levelRaw) || 1)));
}

export function hollowGateRyoScaleForLevel(levelRaw: unknown, k: number = gateRyoK()): number {
    return Math.min(1, (k * anchorRyoPerMinute(hollowGateEntryLevel(levelRaw))) / GATE_RYO_REFERENCE_PER_MIN);
}

/** Runs minted before the cutover carry no entryLevel and keep their flat pay
 *  until they end (I-18). start.ts is the only minting path and always seals it. */
export function hollowGateRunRyoScale(run: { entryLevel?: unknown } | null | undefined): number {
    const raw = run?.entryLevel;
    if (raw == null || !Number.isFinite(Number(raw))) return 1;
    return hollowGateRyoScaleForLevel(raw);
}

export function scaleHollowGateRyo(ryoRaw: unknown, scale: number): number {
    const ryo = Math.max(0, Math.floor(Number(ryoRaw) || 0));
    return Math.floor(ryo * Math.max(0, Math.min(1, Number(scale) || 0)));
}

/** At most 16 threat ambushes pay ryo per run (framework #12); up to 64 could spawn. */
export const HOLLOW_GATE_PAID_AMBUSHES_PER_RUN = 16;

/** Threat ambushes already won this run. Encounter keys are `${floor}:${kind}:${nodeId}`;
 *  the run keeps the last 128, more than the 80 combats a run can resolve. */
export function hollowGatePaidAmbushCount(run: { resolvedEncounterIds?: unknown } | null | undefined): number {
    const resolved = run && Array.isArray(run.resolvedEncounterIds) ? run.resolvedEncounterIds as unknown[] : [];
    return resolved.filter((key) => typeof key === 'string' && key.split(':')[1] === 'ambush').length;
}

/** Where a won threat ambush sits against the per-run purse cap. combat-settle
 *  returns it so the reward line shows the limit (owner rule: every limit is
 *  visible in the UI). */
export type HollowGateAmbushPurse = { ordinal: number; paidCap: number; paid: boolean };

/** `priorAmbushes` counts the run's won ambushes before this one. */
export function hollowGateAmbushPurse(kind: unknown, won: boolean, priorAmbushes: unknown): HollowGateAmbushPurse | undefined {
    if (kind !== 'ambush' || !won) return undefined;
    const ordinal = Math.max(0, Math.floor(Number(priorAmbushes) || 0)) + 1;
    return { ordinal, paidCap: HOLLOW_GATE_PAID_AMBUSHES_PER_RUN, paid: ordinal <= HOLLOW_GATE_PAID_AMBUSHES_PER_RUN };
}
