/*
 * Pure decision logic for the sector-wanderer QUEST (api/sector/wanderer-quest.ts),
 * split out so the catalog + reward math can be unit-tested without KV / auth /
 * locks (same pattern as api/pvp/_bounty.ts, api/sector/_wanderer-gift.ts).
 *
 * A "sage" wanderer offers a small bounty: defeat N foes on the roads, then claim
 * a reward. The objective baseline (the player's foe-kill count at accept time)
 * and the quest id are SEALED server-side in KV — the save copy is display-only,
 * so a tampered save can't forge an early/early claim. The reward is RECOMPUTED
 * from this catalog at claim time, never read from the client or the save.
 */

// id → number of foes to defeat. Server-authoritative; the client mirrors a
// display catalog (label + target) in shinobij.client/src/lib/wanderers.ts.
export const WANDERER_QUEST_TARGETS: Record<string, number> = {
    "wq-cull": 3,
    "wq-purge": 6,
};

export function isWandererQuestId(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(WANDERER_QUEST_TARGETS, id);
}

const clamp = (n: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));

/** Conservative, mildly level- and target-scaled ryo. Tunable. */
export function wandererQuestRyo(level: number, target: number): number {
    const lvl = clamp(level, 1, 100);
    const t = clamp(target, 1, 20);
    return t * (20 + lvl * 3); // e.g. L20/t3 ≈ 240, L50/t6 ≈ 1020 — modest
}

/** Objective met when foe-kills since accept (current − baseline) reach target. */
export function wandererQuestComplete(baseline: number, current: number, target: number): boolean {
    return (Number(current) || 0) - (Number(baseline) || 0) >= target;
}
