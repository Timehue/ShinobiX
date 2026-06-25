// Pure profession logic helpers extracted from App.tsx for unit testing.
// The functions here take primitives / minimal interfaces so they can be
// imported and tested without pulling in the rest of the client.
//
// Server-side mirrors live in api/missions/_progress.ts and
// api/pvp/_vanguard-rewards.ts. Keep formulas in sync.

export type Profession = "healer" | "vanguard" | "petTamer";

export const PROFESSION_MAX_RANK = 10;

// Cumulative XP needed to reach each rank index (rank 1 = idx 1, max = 10).
// Baseline curve used by Vanguard and Pet Tamer; Healer scales by 1.5×.
export const PROFESSION_XP_BASELINE = [0, 100, 350, 850, 1850, 3850, 7350, 12850, 20850, 32850, Infinity];
export const PROFESSION_XP_HEALER = PROFESSION_XP_BASELINE.map(v => v === Infinity ? v : Math.floor(v * 1.5));

export function professionThresholds(profession: Profession): readonly number[] {
    return profession === "healer" ? PROFESSION_XP_HEALER : PROFESSION_XP_BASELINE;
}

export function getProfessionRankForXp(profession: Profession, xp: number): number {
    const t = professionThresholds(profession);
    let rank = 1;
    for (let i = 1; i <= PROFESSION_MAX_RANK; i += 1) {
        if (xp >= t[i]) rank = i + 1;
    }
    return Math.min(PROFESSION_MAX_RANK, rank);
}

// Vanguard Rank 2+ perk: +10% XP. Applied at the awardProfessionXp call site.
export function professionXpMultiplier(profession: Profession | undefined, rank: number): number {
    if (profession === "vanguard" && rank >= 2) return 1.1;
    return 1;
}

// Pet Tamer PvE pet damage multiplier: +5% at unlock, +1.5% per rank.
// PvE only — never apply in PvP.
export function petTamerPveMultiplier(profession: Profession | undefined, rank: number): number {
    if (profession !== "petTamer") return 1;
    const r = Math.max(0, Math.min(PROFESSION_MAX_RANK, rank));
    return 1 + (5 + r * 1.5) / 100;
}

// Pet Tamer training speed bonus (% faster).
export function petTamerTrainingSpeedPct(profession: Profession | undefined, rank: number): number {
    if (profession !== "petTamer") return 0;
    const r = Math.max(0, Math.min(PROFESSION_MAX_RANK, rank));
    return 10 + r;
}

// Pet Tamer expedition reward multiplier.
export function petTamerExpeditionMult(profession: Profession | undefined, rank: number): number {
    if (profession !== "petTamer") return 1;
    const r = Math.max(0, Math.min(PROFESSION_MAX_RANK, rank));
    return 1 + (10 + r * 1.5) / 100;
}

// Vanguard rank table (Seals per PvP kill). Idx = rank (0 unused).
export const VANGUARD_SEALS_PER_KILL = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5] as const;
export const VANGUARD_DAILY_SEAL_CAP = 50;
export const VANGUARD_PER_TARGET_DAILY_CAP = 3;

// ── Healer rank perks ─────────────────────────────────────────────────────
// Idx = rank (0 unused). Two perk axes that scale across ranks 1-10:
//   1. HEAL_XP_BONUS_PCT: extra % XP on every successful cross-player heal.
//      Stacks with the existing raid-assist +50% bonus.
//   2. PER_TARGET_COOLDOWN_SEC: the shared "same target was healed recently"
//      lockout. Base 5 min at rank 1, reduced to 1.5 min at rank 10.
//      Higher-rank Healers can ping-pong heal more efficiently.
// (A former rank-scaled HOSPITAL_TIMER_SEC was dropped — Healers now self-heal &
//  discharge instantly for free, so there is no Healer hospital timer to scale.)
export const HEALER_HEAL_XP_BONUS_PCT = [0, 0, 5, 10, 15, 20, 25, 30, 35, 40, 50] as const;
export const HEALER_PER_TARGET_COOLDOWN_SEC = [0, 300, 285, 270, 240, 210, 180, 150, 120, 105, 90] as const;
// Rank 10 unlocks world-wide injured-villager visibility (existing perk;
// see api/player/injured-villagers.ts).
export const HEALER_WORLDWIDE_RANK = 10;

// Convenience accessors. Clamp rank into [1, MAX_RANK] so an unset/bogus
// rank degrades to the rank-1 floor rather than throwing.
function clampRank(rank: number): number {
    if (!Number.isFinite(rank) || rank < 1) return 1;
    if (rank > PROFESSION_MAX_RANK) return PROFESSION_MAX_RANK;
    return Math.floor(rank);
}
export function healerHealXpBonusPct(profession: Profession | undefined, rank: number): number {
    if (profession !== "healer") return 0;
    return HEALER_HEAL_XP_BONUS_PCT[clampRank(rank)];
}
export function healerPerTargetCooldownSec(profession: Profession | undefined, rank: number): number {
    if (profession !== "healer") return 300; // non-healers fall through to base
    return HEALER_PER_TARGET_COOLDOWN_SEC[clampRank(rank)];
}

// Anti-abuse: zero rewards for targets whose account is <72 hours old.
const ANTI_ALT_ACCOUNT_AGE_MS = 72 * 60 * 60 * 1000;
export function targetTooYoungForRewards(opponentCreatedAt?: number, nowMs = Date.now()): boolean {
    if (!opponentCreatedAt) return false;
    return (nowMs - opponentCreatedAt) < ANTI_ALT_ACCOUNT_AGE_MS;
}

// Level-gap rule:
//   within 10 levels = full reward
//   10-20 below     = 50%
//   >20 below       = 0
// "Below" is from the attacker's perspective.
export function levelGapSealMultiplier(attackerLevel: number, opponentLevel: number): number {
    const gap = attackerLevel - opponentLevel;
    if (gap > 20) return 0;
    if (gap > 10) return 0.5;
    return 1;
}

export function vanguardXpForKill(opponentLevel: number): number {
    return 100 + 10 * Math.max(0, opponentLevel - 30);
}

// Compute Honor Seals earned for a Vanguard PvP kill given rank, level gap,
// daily cap, per-target cap, and account-age anti-alt rule. Returns the
// awarded amount plus the new by-target map for daily tracking.
export function vanguardSealsForKill(opts: {
    killerProfession: Profession | undefined;
    killerRank: number;
    killerLevel: number;
    opponentName: string;
    opponentLevel: number;
    opponentCreatedAt?: number;
    todayKey: string;
    dailyResetDate?: string;
    dailyHonorSealsEarned?: number;
    dailyHonorSealsByTarget?: Record<string, number>;
}): { amount: number; updatedByTarget: Record<string, number> } {
    const carryByTarget = opts.dailyHonorSealsByTarget ?? {};
    if (opts.killerProfession !== "vanguard") return { amount: 0, updatedByTarget: carryByTarget };
    if (targetTooYoungForRewards(opts.opponentCreatedAt)) return { amount: 0, updatedByTarget: carryByTarget };

    const rank = Math.max(1, Math.min(PROFESSION_MAX_RANK, opts.killerRank));
    const baseSeals = VANGUARD_SEALS_PER_KILL[rank];
    const gapMult = levelGapSealMultiplier(opts.killerLevel, opts.opponentLevel);
    let amount = Math.floor(baseSeals * gapMult);
    if (amount <= 0) return { amount: 0, updatedByTarget: carryByTarget };

    const todayActive = opts.dailyResetDate === opts.todayKey;
    const dailySoFar = todayActive ? (opts.dailyHonorSealsEarned ?? 0) : 0;
    const byTarget = todayActive ? carryByTarget : {};
    const targetKey = opts.opponentName.toLowerCase();
    const targetSoFar = byTarget[targetKey] ?? 0;

    amount = Math.min(amount, Math.max(0, VANGUARD_DAILY_SEAL_CAP - dailySoFar));
    amount = Math.min(amount, Math.max(0, VANGUARD_PER_TARGET_DAILY_CAP - targetSoFar));
    if (amount <= 0) return { amount: 0, updatedByTarget: byTarget };

    return {
        amount,
        updatedByTarget: { ...byTarget, [targetKey]: targetSoFar + amount },
    };
}
