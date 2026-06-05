/*
 * Core combat damage math — the unified PvE/PvP damage formula plus the
 * supporting stat/multiplier/status helpers.
 *
 * Mirrors api/pvp/move.ts so PvE and PvP produce identical damage for the same
 * inputs. Pure functions depending only on the extracted type / constant / util
 * modules and lib/tags.
 *
 * starterSavedBloodlines is imported back from "../App" (read lazily inside
 * getBloodlineMultiplier, never at module-init), following the existing
 * lib/bloodline pattern, pending extraction of the starter bloodline data.
 *
 * Extracted from App.tsx (Region A).
 */

import { statusMatchesName } from "./tags";
import { clampNumber } from "./utils";
import { HP_CAP, MAX_STAT, JUTSU_MAX_LEVEL } from "../constants/game";
import { starterSavedBloodlines } from "../App";
import type { Stats, Jutsu, JutsuTag, SavedBloodline } from "../types/combat";
import type { JutsuType } from "../types/core";
import type { Character } from "../types/character";

export function getOffenseStat(stats: Stats, type: JutsuType | string) {
    if (type === "Any") return Math.max(
        stats.ninjutsuOffense + stats.willpower + stats.speed,
        stats.taijutsuOffense + stats.strength + stats.speed,
        stats.genjutsuOffense + stats.intelligence + stats.willpower,
        stats.bukijutsuOffense + stats.intelligence + stats.strength,
    );
    if (type === "Taijutsu") return stats.taijutsuOffense + stats.strength + stats.speed;
    if (type === "Bukijutsu") return stats.bukijutsuOffense + stats.intelligence + stats.strength;
    if (type === "Genjutsu") return stats.genjutsuOffense + stats.intelligence + stats.willpower;
    return stats.ninjutsuOffense + stats.willpower + stats.speed;
}

export function getDefenseStat(stats: Stats, type: JutsuType | string) {
    if (type === "Any") return Math.max(
        stats.ninjutsuDefense + stats.willpower + stats.speed,
        stats.taijutsuDefense + stats.strength + stats.speed,
        stats.genjutsuDefense + stats.intelligence + stats.willpower,
        stats.bukijutsuDefense + stats.intelligence + stats.strength,
    );
    if (type === "Taijutsu") return stats.taijutsuDefense + stats.strength + stats.speed;
    if (type === "Bukijutsu") return stats.bukijutsuDefense + stats.intelligence + stats.strength;
    if (type === "Genjutsu") return stats.genjutsuDefense + stats.intelligence + stats.willpower;
    return stats.ninjutsuDefense + stats.willpower + stats.speed;
}

export function diminishingPercent(percent: number, stackIndex: number) {
    const raw = Math.max(0, percent) / 100;
    return raw / (1 + stackIndex * 0.35 + raw * 0.25);
}

export function multiplicativeTagMultiplier(tags: { percent?: number }[], direction: "increase" | "decrease") {
    return tags.reduce((multiplier, tag, index) => {
        const effective = diminishingPercent(tag.percent ?? 0, index);
        return direction === "increase"
            ? multiplier * (1 + effective)
            : multiplier / (1 + effective);
    }, 1);
}

export function getBloodlineMultiplier(char: Character, allSavedBloodlines: SavedBloodline[]): number {
    if (!char.equippedBloodlineId) return 1.0;
    const adminBl = allSavedBloodlines.find(b => b.id === char.equippedBloodlineId);
    if (adminBl) return adminBl.rank === "S Rank" ? 1.20 : adminBl.rank === "A Rank" ? 1.15 : 1.10;
    const starterBl = starterSavedBloodlines.find(b => b.id === char.equippedBloodlineId);
    if (starterBl) return 1.08;
    return 1.0;
}

// True for "utility" jutsu that deal no damage (status/buff/debuff only).
// Prefers the explicit `isUtility` flag; when absent, falls back to the legacy
// 40-AP convention so all existing content behaves exactly as before — existing
// 40-AP jutsu keep dealing zero damage.
export function isZeroDamageFortyApJutsu(jutsu: Pick<Jutsu, "id" | "ap" | "isUtility">) {
    if (jutsu.isUtility === true) return true;
    if (jutsu.isUtility === false) return false;
    return jutsu.ap === 40 && jutsu.id !== "basic-attack" && !jutsu.id.startsWith("item-");
}

// ─── PvP-formula constants (mirrors api/pvp/move.ts) ─────────────────────────
// Keep these in sync with the server constants. The whole point is that PvE
// and PvP produce the same damage given the same inputs.
export const EP_MULTIPLIER_PVE = 32;       // Raw dmg = scaledEp × 32
export const K_DR_PVE          = 0.5;      // Defensive DR pool soft-cap
export const K_AMP_PVE         = 0.5;      // Offensive amp pool soft-cap
export const HEAL_FLAT_PVE     = 750;      // Heal tag value at max jutsu mastery
export const SHIELD_FLAT_PVE   = 750;      // Shield tag value at max jutsu mastery
export const WOUND_HARD_CAP_PCT_PVE = 60;  // Wound max cap (in % of finalDmg)
export const WOUND_CAP_BY_RANK_PVE: Record<string, number> = {
    basic: 25, AB: 30, S: 35,
};

// Wound rank cap → max allowed Wound percent. Mirrors api/pvp/move.ts
// `woundCapForJutsu` (basic/non-bloodline 25, A·B 30, S 35) EXACTLY, including
// the rank-prefix regex. "Wound" is deliberately NOT in `cappedDamageTags`, so
// `effectiveTagPercent` does not rank-cap it — the PvE combat paths apply this
// directly before `cappedPostDamage`, matching PvP. (Keeping WOUND_CAP_BY_RANK_PVE
// consumed also gives the combat-formula parity test real teeth — it was dead.)
export function woundCapForRankPVE(bloodlineRank?: string | null): number {
    const rank = (bloodlineRank ?? '').trim();
    if (/^S/i.test(rank)) return WOUND_CAP_BY_RANK_PVE.S;
    if (/^[AB]/i.test(rank)) return WOUND_CAP_BY_RANK_PVE.AB;
    return WOUND_CAP_BY_RANK_PVE.basic;
}

// Active-round duration for the four amp statuses (Increase/Decrease Damage
// Given/Taken). Mirrors api/pvp/move.ts STATUS_DURATIONS_OVERRIDE, which forces
// all four to 4 rounds ("amps run 4 rounds so stacking to 2 is reliable"). PvE
// previously hardcoded `rounds: 2` at every amp site → amps lasted ~half as long
// as in PvP. Centralized here so the value can't drift per-site and the parity
// test can guard it. (Special-duration amps — e.g. the smoke-bomb DDG — keep
// their own explicit rounds and intentionally do NOT use this.)
export const AMP_STATUS_ROUNDS_PVE = 4;

// Drain per-tick = clamp(50 + attacker-mastery×5, 50, 300), draining HP + chakra
// ONLY (never stamina). Mirrors api/pvp/move.ts DRAIN_BASE_TICK / DRAIN_PER_LEVEL
// / DRAIN_MAX_TICK. PvE previously drained a flat 250 from HP + chakra + stamina,
// ignoring attacker mastery — this aligns the jutsu Drain to PvP.
export const DRAIN_BASE_TICK_PVE = 50;
export const DRAIN_PER_LEVEL_PVE = 5;
export const DRAIN_MAX_TICK_PVE = 300;
export function drainTickPVE(masteryLevel: number): number {
    return Math.max(DRAIN_BASE_TICK_PVE, Math.min(DRAIN_MAX_TICK_PVE, DRAIN_BASE_TICK_PVE + masteryLevel * DRAIN_PER_LEVEL_PVE));
}

// Statuses that allow multiple coexisting instances. Mirrors api/pvp/move.ts
// STACKABLE_STATUS EXACTLY. Everything NOT in this set (Stun, Bloodline/Elemental
// Seal, the Prevents, and the DoTs Poison / Drain / Recoil) REPLACES a same-named
// instance on re-apply instead of piling up — see mergeCombatStatus.
export const STACKABLE_STATUS_PVE: ReadonlySet<string> = new Set([
    'Increase Damage Given', 'Increase Damage Taken', 'Ignition',
    'Decrease Damage Given', 'Decrease Damage Taken',
    'Wound', 'Lifesteal', 'Reflect', 'Absorb',
]);

// Apply a status to a PvE status list, mirroring api/pvp/move.ts addStatus:
// stackable statuses append (coexist); every other status replaces a same-named
// one. PvE previously always appended, so non-stackable statuses could stack
// (e.g. two Stuns, or DoTs ticking multiple times). Status duration is applied at
// the call sites (AMP_STATUS_ROUNDS_PVE etc.), not here.
export function mergeCombatStatus<T extends { name: string }>(list: T[], status: T): T[] {
    if (STACKABLE_STATUS_PVE.has(status.name)) return [...list, status];
    return [...list.filter((x) => x.name !== status.name), status];
}

// Structural type used by the helpers below — CombatStatus is declared
// locally inside the battle component (out of module scope here), so we
// accept any object shape that exposes the fields these helpers read.
export type PvpStatusLike = { name: string; percent?: number };

// Sum of attacker IDG% + defender IDT% + defender Ignition%, fed into a
// soft-cap pool. Mirrors server ampMultiplierFor in api/pvp/move.ts.
export function pvpAmpMultiplier(attackerStatuses: PvpStatusLike[] = [], defenderStatuses: PvpStatusLike[] = []): number {
    let rawAmp = 0;
    for (const s of attackerStatuses) {
        if (s.name === "Increase Damage Given") rawAmp += (s.percent ?? 0) / 100;
    }
    for (const s of defenderStatuses) {
        if (s.name === "Increase Damage Taken")       rawAmp += (s.percent ?? 0) / 100;
        else if (s.name === "Ignition" || statusMatchesName(s, "Ignition")) rawAmp += (s.percent ?? 0) / 100;
    }
    if (rawAmp <= 0) return 1;
    return 1 + rawAmp / (rawAmp + K_AMP_PVE);
}

// Sum of attacker DDG% + defender DDT% (raw, not yet pooled with armor).
export function pvpStatusDr(attackerStatuses: PvpStatusLike[] = [], defenderStatuses: PvpStatusLike[] = []): number {
    let dr = 0;
    for (const s of attackerStatuses) {
        if (s.name === "Decrease Damage Given") dr += (s.percent ?? 0) / 100;
    }
    for (const s of defenderStatuses) {
        if (s.name === "Decrease Damage Taken") dr += (s.percent ?? 0) / 100;
    }
    return dr;
}

// True-damage Pierce. Mirrors server pierceTrueDamage exactly.
export function pvpPierceTrueDamage(offenseComposite: number, jutsuAp: number, masteryLevel: number): number {
    const apFactor      = Math.max(0.5, (jutsuAp || 60) / 60);
    const masteryFactor = 1 + Math.max(0, Math.min(50, masteryLevel)) * 0.005;
    const raw           = offenseComposite * 0.35 * apFactor * masteryFactor;
    return Math.floor(Math.max(100, Math.min(900, raw)));
}

// Linear armorFactor → raw DR. The old PvE formula used a linear armorFactor
// (0.25..1.0 where lower = more reduction). New formula needs raw DR for the
// soft-cap pool. Conversion preserves the same equipped-armor intent.
export function armorFactorToRawDr(armorFactor: number): number {
    return Math.max(0, 1 - armorFactor);
}

// ─── Damage formula (mirrors api/pvp/move.ts applyJutsu damage block) ────────
// PvE and PvP now use the same math:
//   scaledEp   = jutsu utility-zero ? 0 : EP + mastery × 0.2
//   baseDmg    = scaledEp × 32 × statFactor × wMult × bloodlineMult × itemDmgMult
//   effDR      = (armorRawDR + statusDR) / (rawTotal + K_DR_PVE)
//   ampMult    = 1 + rawAmp / (rawAmp + K_AMP_PVE)
//   damage     = baseDmg × (1 - effDR) × ampMult     (or pierce true damage)
//
// Backward-compatible signature: old callers pass armorFactor + itemMult and
// the function derives armorRawDR + uses default empty status arrays. New
// callers pass attackerStatuses + defenderStatuses so amp/status DR pool work.
export function calculateDamage(
    jutsu: Jutsu,
    attackerStats: Stats,
    defenderStats: Stats,
    targetMaxHp = HP_CAP,
    bloodlineMult = 1.0,
    armorFactor = 1.0,
    itemMult = 1.0,
    weatherMult = 1.0,
    attackerStatuses: PvpStatusLike[] = [],
    defenderStatuses: PvpStatusLike[] = [],
    masteryLevel: number = JUTSU_MAX_LEVEL,
) {
    if (isZeroDamageFortyApJutsu(jutsu)) return 0;
    const offense = getOffenseStat(attackerStats, jutsu.type);
    const defense = getDefenseStat(defenderStats, jutsu.type);
    const statFactor = clampNumber(1 + ((offense - defense) / (MAX_STAT * 2)) * 0.85, 0.35, 1.85);

    // Pierce short-circuits to true damage (capped 900). Caller still needs
    // to handle shield/absorb-bypass semantics — this function only returns
    // the raw damage number.
    const pierce = jutsu.tags?.some(t => t.name === "Pierce");
    if (pierce) {
        return pvpPierceTrueDamage(offense, jutsu.ap ?? 40, masteryLevel);
    }

    const scaledEp = Math.max(0, jutsu.effectPower) + masteryLevel * 0.2;
    const baseDmg = Math.max(0, Math.floor(
        scaledEp * EP_MULTIPLIER_PVE * statFactor * weatherMult * bloodlineMult * itemMult
    ));

    // Defensive DR pool — armor + DDG/DDT statuses combined with soft-cap.
    const armorRawDR = armorFactorToRawDr(armorFactor);
    const statusDR   = pvpStatusDr(attackerStatuses, defenderStatuses);
    const rawTotalDR = armorRawDR + statusDR;
    const effectiveDR = rawTotalDR > 0 ? rawTotalDR / (rawTotalDR + K_DR_PVE) : 0;

    // Offensive amp pool — IDG attacker + IDT/Ignition defender soft-capped.
    const ampMult = pvpAmpMultiplier(attackerStatuses, defenderStatuses);

    // targetMaxHp param kept for signature compatibility; new formula doesn't
    // use it directly (damage no longer scales with target HP).
    void targetMaxHp;

    return Math.max(0, Math.floor(baseDmg * (1 - effectiveDR) * ampMult));
}

export function tagPower(tag: JutsuTag, fallback = 30) {
    return tag.percent > 0 ? tag.percent : fallback;
}
