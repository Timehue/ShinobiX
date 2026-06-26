"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.WANDERER_QUESTS = void 0;
exports.isWandererQuestId = isWandererQuestId;
exports.wandererQuestRyo = wandererQuestRyo;
exports.wandererQuestComplete = wandererQuestComplete;
exports.WANDERER_QUESTS = {
    "wq-cull": { metric: "totalAiKills", target: 3, weight: 3 },
    "wq-purge": { metric: "totalAiKills", target: 6, weight: 6 },
    "wq-warpath": { metric: "totalAiKills", target: 10, weight: 9 },
    "wq-beasts": { metric: "totalPetWins", target: 2, weight: 4 },
    "wq-menagerie": { metric: "totalPetWins", target: 4, weight: 7 },
    "wq-cards": { metric: "cardClashWins", target: 2, weight: 2 },
    "wq-highroller": { metric: "cardClashWins", target: 4, weight: 4 },
    "wq-scout": { metric: "totalTilesExplored", target: 10, weight: 3 },
    "wq-trailblaze": { metric: "totalTilesExplored", target: 25, weight: 6 },
};
function isWandererQuestId(id) {
    return Object.prototype.hasOwnProperty.call(exports.WANDERER_QUESTS, id);
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));
/** Conservative, level- and effort-scaled ryo. Tunable. */
function wandererQuestRyo(level, weight) {
    const lvl = clamp(level, 1, 100);
    const w = clamp(weight, 1, 20);
    return w * (20 + lvl * 3); // e.g. L50/w3 ≈ 510, L50/w6 ≈ 1020 — modest
}
/** Objective met when (current − baseline) on the metric reaches target. */
function wandererQuestComplete(baseline, current, target) {
    return (Number(current) || 0) - (Number(baseline) || 0) >= target;
}
