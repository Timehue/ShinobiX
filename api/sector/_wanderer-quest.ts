/*
 * Pure decision logic for the sector-wanderer QUEST (api/sector/wanderer-quest.ts).
 * Unit-testable without KV / auth / locks (same pattern as api/pvp/_bounty.ts).
 *
 * A "sage" wanderer offers a bounty tied to one of several server-tracked
 * progress counters (foes defeated, pet duels won, card rounds won, tiles
 * scouted). The objective baseline (the counter's value at accept) + quest id are
 * SEALED server-side in KV — the save copy is display-only, so a tampered save
 * can't forge an early claim. The reward is RECOMPUTED from this catalog at claim,
 * scaled by the quest's effort `weight` (decoupled from the raw target count, so a
 * "scout 10 tiles" task doesn't pay like "win 10 battles").
 */

// Each quest's objective counter — a field the game already increments on the
// character save. Mirrored (label + target + metric) by the client catalog in
// shinobij.client/src/lib/wanderers.ts.
export type WandererQuestMetric =
    | "totalAiKills"
    | "totalPetWins"
    | "cardClashWins"
    | "totalTilesExplored";

export interface WandererQuestDef {
    metric: WandererQuestMetric;
    target: number;
    /** effort weight driving the reward (NOT the raw target count) */
    weight: number;
}

export const WANDERER_QUESTS: Record<string, WandererQuestDef> = {
    "wq-cull":   { metric: "totalAiKills",       target: 3,  weight: 3 },
    "wq-purge":  { metric: "totalAiKills",       target: 6,  weight: 6 },
    "wq-beasts": { metric: "totalPetWins",       target: 2,  weight: 4 },
    "wq-cards":  { metric: "cardClashWins",      target: 2,  weight: 2 },
    "wq-scout":  { metric: "totalTilesExplored", target: 10, weight: 3 },
};

export function isWandererQuestId(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(WANDERER_QUESTS, id);
}

const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));

/** Conservative, level- and effort-scaled ryo. Tunable. */
export function wandererQuestRyo(level: number, weight: number): number {
    const lvl = clamp(level, 1, 100);
    const w = clamp(weight, 1, 20);
    return w * (20 + lvl * 3); // e.g. L50/w3 ≈ 510, L50/w6 ≈ 1020 — modest
}

/** Objective met when (current − baseline) on the metric reaches target. */
export function wandererQuestComplete(baseline: number, current: number, target: number): boolean {
    return (Number(current) || 0) - (Number(baseline) || 0) >= target;
}
