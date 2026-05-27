/*
 * Profession progression / Vanguard reward constants.
 *
 * Source of truth for rank thresholds (used by every "what rank is this
 * player?" call) and Vanguard Honor-Seal reward tables (used by the
 * vanguardSealsForKill calculator).
 *
 * Pure data — no closures, no helpers. The helpers that consume these
 * (vanguardSealsForKill, professionThresholds, petTamerExpeditionMult,
 * etc.) stay in App.tsx for Pass 3.
 *
 * Mirrors docs/professions.md.
 */

// ── Vanguard PvP rewards ─────────────────────────────────────────────────
// Strict-spec: only Vanguards earn Honor Seals from PvP. Non-Vanguards get 0.
// Indexed by rank — idx 0 unused, rank 1..10 follows the docs/professions.md table.
export const VANGUARD_SEALS_PER_KILL = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5] as const;

export const VANGUARD_DAILY_SEAL_CAP = 50;
export const VANGUARD_PER_TARGET_DAILY_CAP = 3;

// Anti-alt: zero rewards for killing targets whose account is < 72 hours old.
export const ANTI_ALT_ACCOUNT_AGE_MS = 72 * 60 * 60 * 1000;

// ── Profession XP & rank progression ─────────────────────────────────────
// Cumulative XP needed to reach each rank index (rank 1 = index 1, max = 10).
// Baseline curve used by Vanguard and Pet Tamer; Healer scales by 1.5×.
// See docs/professions.md "XP curves" section.
export const PROFESSION_XP_BASELINE: ReadonlyArray<number> = [
    0, 100, 350, 850, 1850, 3850, 7350, 12850, 20850, 32850, Infinity,
];
export const PROFESSION_XP_HEALER: ReadonlyArray<number> =
    PROFESSION_XP_BASELINE.map(v => v === Infinity ? v : Math.floor(v * 1.5));

export const PROFESSION_MAX_RANK = 10;
