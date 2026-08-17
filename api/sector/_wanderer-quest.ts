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
    | "totalTilesExplored"
    // Distinct biomes walked since the quest was accepted (api/world/_explore.ts
    // withRelicSurveyProgress). A SET expressed as its length, so the ordinary
    // baseline+target completion check reads it with no survey-specific branch.
    | "relicSurveyCount";

export interface WandererQuestDef {
    metric: WandererQuestMetric;
    target: number;
    /** effort weight driving the reward (NOT the raw target count) */
    weight: number;
}

export const WANDERER_QUESTS: Record<string, WandererQuestDef> = {
    "wq-cull":       { metric: "totalAiKills",       target: 3,  weight: 3 },
    "wq-purge":      { metric: "totalAiKills",       target: 6,  weight: 6 },
    "wq-warpath":    { metric: "totalAiKills",       target: 10, weight: 9 },
    "wq-beasts":     { metric: "totalPetWins",       target: 2,  weight: 4 },
    "wq-menagerie":  { metric: "totalPetWins",       target: 4,  weight: 7 },
    "wq-cards":      { metric: "cardClashWins",      target: 2,  weight: 2 },
    "wq-highroller": { metric: "cardClashWins",      target: 4,  weight: 4 },
    "wq-scout":      { metric: "totalTilesExplored", target: 10, weight: 3 },
    "wq-trailblaze": { metric: "totalTilesExplored", target: 25, weight: 6 },
    // The relic survey — the game's only in-world explanation of where relics come
    // from. Target 5 = one tile in each of the five countries; accepting RESETS the
    // set (see RESET_ON_ACCEPT_METRICS) so a well-travelled player starts the
    // survey fresh rather than completing it instantly.
    "wq-relic-survey": { metric: "relicSurveyCount", target: 5, weight: 5 },
    // Legacy Emissary mini-quests (client mirror: lib/legacy-emissaries.ts).
    // Same metrics, same reward band — flavored errands, not a new economy.
    "eq-storm-conduits":      { metric: "totalAiKills",       target: 8,  weight: 8 },
    "eq-storm-skyward":       { metric: "totalTilesExplored", target: 15, weight: 4 },
    "eq-veil-unseen":         { metric: "totalAiKills",       target: 5,  weight: 5 },
    "eq-veil-moths":          { metric: "totalTilesExplored", target: 12, weight: 4 },
    "eq-iron-tally":          { metric: "totalAiKills",       target: 10, weight: 9 },
    "eq-iron-road":           { metric: "totalTilesExplored", target: 20, weight: 5 },
    "eq-blade-rites":         { metric: "totalAiKills",       target: 8,  weight: 8 },
    "eq-blade-vigil":         { metric: "totalAiKills",       target: 6,  weight: 6 },
    "eq-broker-ledger":       { metric: "cardClashWins",      target: 4,  weight: 4 },
    "eq-broker-debts":        { metric: "totalAiKills",       target: 8,  weight: 8 },
    "eq-hollow-toll":         { metric: "totalAiKills",       target: 10, weight: 9 },
    "eq-hollow-depths":       { metric: "totalTilesExplored", target: 18, weight: 5 },
    "eq-lantern-rounds":      { metric: "totalTilesExplored", target: 14, weight: 4 },
    "eq-lantern-watch":       { metric: "totalAiKills",       target: 6,  weight: 6 },
    "eq-mapless-edges":       { metric: "totalTilesExplored", target: 25, weight: 6 },
    "eq-mapless-companions":  { metric: "totalPetWins",       target: 3,  weight: 6 },
};

/**
 * Metrics whose counter is a survey rather than a lifetime total: accepting the
 * quest zeroes them, so progress always measures work done AFTER the errand was
 * taken. Without this a player who had already walked all five countries would
 * complete the survey the instant they accepted it.
 */
export const RESET_ON_ACCEPT_METRICS: ReadonlySet<WandererQuestMetric> = new Set(['relicSurveyCount']);

/** The character fields a reset-on-accept metric clears, alongside the counter. */
export const SURVEY_RESET_FIELDS: Readonly<Record<string, readonly string[]>> = {
    relicSurveyCount: ['relicSurvey'],
};

export function isWandererQuestId(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(WANDERER_QUESTS, id);
}

export type WandererQuestSeal = { id: string; baseline: number; at: number };

export function parseWandererQuestSeal(raw: unknown): WandererQuestSeal | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : '';
    const baseline = Number(value.baseline);
    const at = Number(value.at ?? 0);
    if (!isWandererQuestId(id) || !Number.isFinite(baseline) || !Number.isSafeInteger(at) || at < 0) return null;
    return { id, baseline, at };
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
