/*
 * Apex Contract — the Hunter Guild capstone.
 *
 * Hunter Rank 5 (Chakra Beast Warden) previously unlocked nothing. This is its
 * payoff: one rotating apex beast per ISO week, hand-tuned well past the S-Rank
 * contracts, paying a big ryo purse + fate shards + a permanent tally.
 *
 * Constraints this deliberately respects (see the Hunter Guild design notes):
 *   NO hunter gear, NO befriending, NO cooking. The payoff is economy /
 *   prestige only — never combat power. See the balanced-PvP design pillar:
 *   power is gated by skill, never bought or grinded.
 *
 * ── Why the roster is authored, not derived ────────────────────────────────
 * The four apex hunt bosses in lib/combat-ai.ts are ALREADY hand-tuned and
 * flagged `hpFloorExempt`, because aiHpForLevel would otherwise floor them into
 * an ~11k-18k "unwinnable grind" band. Two traps follow:
 *
 *   1. `relevelBuiltinAi` does NOT carry `hpFloorExempt` through (it preserves
 *      only image + masterAi). Re-levelling an apex boss therefore silently
 *      re-inflates its HP into exactly the band that was tuned away. So the
 *      apex clone sets hp AND hpFloorExempt explicitly, last.
 *   2. A CreatorAi does not store the statBonus it was built with — the bonus
 *      is already baked into `stats`. Passing a fresh statBonus to
 *      relevelBuiltinAi would REPLACE the authored 150-220, gutting the beast.
 *      So each row carries its own absolute numbers.
 *
 * Only the four apex-tier bosses rotate. The six lower beasts are level 5-42;
 * an Apex built from them would either be trivial for a Rank-5 player or would
 * have to discard their hand-tuning entirely.
 */
/** Hunter Rank required to see or accept an Apex Contract (max rank). */
export const APEX_MIN_HUNTER_RANK = 5;
/** Character level floor, matching the S-Rank hunt tier. */
export const APEX_MIN_LEVEL = 70;

/*
 * ⚖ BALANCE — reviewed numbers. Derived from each boss's authored tuning:
 *   level    = min(100, base + 20)
 *   stats    = base statBonus + 15  (absolute; base is already 150-220)
 *   hp       = NORMALISED into 11.2k-12.5k (see below)
 * Difficulty comes from level and stats, NOT from an HP sponge.
 *
 * ── Why HP CAPS at 12,500, the same as the hardest normal hunt ──────────────
 * With +165 to +235 on every stat, these beasts are already lethal; adding a
 * bigger health bar on top only makes the fight longer, not harder, and long
 * PvE slogs are what this codebase keeps having to tune back out (combat-ai.ts
 * :409 calls the curve's own ~11k-18k output an unwinnable grind, and the base
 * bosses were tuned DOWN out of it). So Apex reuses the Worldstorm base hunt's
 * 12.5k ceiling — an already-proven-fair pool — and spends its entire
 * difficulty budget on lethality instead. Same health bar, far more dangerous.
 *
 * HP is normalised into a band rather than scaled per-beast: a flat multiplier
 * preserved the base spread (8.5k-12.5k), which made an "Apex" Ember Drake week
 * SOFTER than an ordinary Worldstorm hunt, so how hard Apex felt depended on
 * which beast rotated in. Apex is one weekly max-rank event; every week must be
 * a comparable wall. The level/stat spread is left intact — that is the
 * roster's texture, and it is bounded.
 */
export type ApexBeast = {
    /** Base hunt AI id — the ROTATION key, not the fight id. */
    baseAiId: string;
    /** Distinct id so an Apex kill can never stamp a normal hunt's receipt. */
    apexAiId: string;
    name: string;
    level: number;
    statBonus: number;
    hp: number;
};

export const APEX_ROSTER: readonly ApexBeast[] = [
    { baseAiId: "hunt-ai-ember-drake", apexAiId: "apex-ai-ember-drake", name: "Ember Drake, Ash-Crowned", level: 85, statBonus: 165, hp: 11_200 },
    { baseAiId: "hunt-ai-moon-serpent", apexAiId: "apex-ai-moon-serpent", name: "Moon Serpent, Tide-Eater", level: 88, statBonus: 173, hp: 11_600 },
    { baseAiId: "hunt-ai-ancient-chakra-beast", apexAiId: "apex-ai-ancient-chakra-beast", name: "The Ancient, Unbound", level: 100, statBonus: 220, hp: 12_000 },
    { baseAiId: "hunt-ai-worldstorm-dragon", apexAiId: "apex-ai-worldstorm-dragon", name: "Worldstorm, Sky-Breaker", level: 100, statBonus: 235, hp: 12_500 },
];

/*
 * ⚖ BALANCE — the purse. Once per ISO week, Rank 5 only, on its OWN weekly
 * slot (it never consumes a daily hunt). ~4.5x an S-Rank hunt's 1,800 base ryo.
 * Bounded by construction: one claim per player per week.
 */
export const APEX_RYO = 8_000;
export const APEX_FATE_SHARDS = 3;
// Weekly capstone stat-pool grant (XP retired — mirrors api/missions/
// _apex-contract.ts APEX_STAT_POINTS; display only, server seals the grant).
export const APEX_STAT_POINTS = 25;
export const APEX_STAMINA = 40;

/** ISO-8601 week key, e.g. "2026-W30". Rotation and the weekly claim share it. */
export function isoWeekKey(now: Date): string {
    // Copy to UTC midnight, then shift to the Thursday of this ISO week — the
    // year that Thursday falls in IS the ISO week-year (this is what makes
    // 29 Dec 2025 read as 2026-W01 rather than 2025-W53).
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayNumber = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    date.setUTCDate(date.getUTCDate() - dayNumber + 3);
    const isoYear = date.getUTCFullYear();
    const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
    const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
    const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Weeks since the ISO epoch used to index the roster — monotonic across years. */
function weekOrdinal(weekKey: string): number {
    const [yearPart, weekPart] = weekKey.split("-W");
    const year = Math.max(0, Math.floor(Number(yearPart) || 0));
    const week = Math.max(1, Math.floor(Number(weekPart) || 1));
    return year * 53 + week;
}

/**
 * The Apex beast for a given week. Deterministic and GLOBAL — every player
 * faces the same beast, so it is a shared talking point and no one can reroll
 * into an easier target.
 */
export function apexBeastForWeek(weekKey: string): ApexBeast {
    return APEX_ROSTER[weekOrdinal(weekKey) % APEX_ROSTER.length];
}

/*
 * The fightable profiles live in lib/combat-ai.ts as real builtins (ids
 * `apex-ai-*`), so the Arena resolves them by id with no runtime registration —
 * which keeps the Apex entry point out of App.tsx, whose line budget is at its
 * ratchet. Those entries are parity-tested against APEX_ROSTER above.
 *
 * They MUST be declared hpFloorExempt: the HP pools here sit below the L85+
 * curve, and makeBuiltinAi/normalizeAiProfile would otherwise raise them into
 * the ~11k-18k grind band that combat-ai.ts tuned the base bosses out of.
 *
 * The apex ids are DISTINCT from the base hunt ids on purpose: report-ai-fight
 * matches a sealed opponentId against accepted hunts via huntMissionByAiProfileId
 * to stamp kill receipts, and an Apex kill must never satisfy a normal contract.
 */

/** Whether a character may take this week's Apex Contract at all. */
export function canTakeApex(char: { hunterRank?: number; level?: number } | null | undefined): boolean {
    if (!char) return false;
    return Math.floor(Number(char.hunterRank ?? 0)) >= APEX_MIN_HUNTER_RANK
        && Math.floor(Number(char.level ?? 0)) >= APEX_MIN_LEVEL;
}

/** Already claimed this week? The save stores the last claimed ISO week key. */
export function apexClaimedThisWeek(char: { apexWeekClaimed?: unknown } | null | undefined, weekKey: string): boolean {
    return typeof char?.apexWeekClaimed === "string" && char.apexWeekClaimed === weekKey;
}
