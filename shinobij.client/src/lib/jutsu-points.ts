/*
 * Jutsu point-budget + rank rules — how many jutsu a bloodline rank grants, its
 * point budget, the per-tag point costs, and the rolled-up cost of a jutsu /
 * whole bloodline. Used by the bloodline creator + reviewer.
 *
 * Pure functions depending only on lib/tags and the type modules.
 * Extracted from App.tsx (jutsu cluster).
 */

import { normalizeTagName, cappedDamageTags, tagCapForRank, percentageTags, hasFixedEffectPower } from "./tags";
import type { Jutsu, JutsuTag } from "../types/combat";
import type { Rank } from "../types/core";

export function jutsuCountForRank(rank: Rank) { return rank === "B Rank" ? 4 : 5; }
export function pointBudgetForRank(rank: Rank) { return rank === "S Rank" ? 11 : rank === "A Rank" ? 10 : 7; }
// v4.3: rank-based Wound percent caps — basic jutsus = 25, A/B bloodline = 30, S bloodline = 35.
export function bloodlineTagPercentChoices(rank: Rank) { return rank === "S Rank" ? [30, 35] : [25, 30]; }
export function normalizeBloodlineTagPercent(percent: number | undefined, rank: Rank) {
    const choices = bloodlineTagPercentChoices(rank);
    return choices.includes(Number(percent)) ? Number(percent) : choices[choices.length - 1];
}

export function tagPointValue(tag: JutsuTag, rank?: Rank | null) {
    if (!tag.name) return 0;
    const tagName = normalizeTagName(tag.name);
    if (cappedDamageTags.includes(tagName)) {
        const cap = tagCapForRank(rank);
        if (tag.percent >= cap) return 0.75; // at-cap bonus cost
        return 0;
    }
    if (percentageTags.includes(tagName)) { // Wound only remains here
        // v4.3: shifted Wound % tiers (new caps are 25 / 30 / 35).
        if (tag.percent >= 35) return 1;
        if (tag.percent >= 30) return 0.5;
        return 0;
    }
    if (["Copy", "Mirror"].includes(tagName)) return 3;
    if (["Stun", "Bloodline Seal", "Lag", "Overclock", "Debuff Prevent", "Buff Prevent"].includes(tagName)) return 2;
    if (["Reflect", "Cleanse Prevent", "Clear Prevent", "Heal", "Elemental Seal"].includes(tagName)) return 1.5;
    if (["Shield", "Pierce", "Wound", "Barrier", "Drain"].includes(tagName)) return 1;
    if (tagName === "Push") return 1;
    if (tagName === "Pull") return 0.75;
    if (["Move", "Poison", "Ignition"].includes(tagName)) return 0.5;
    return 1;
}

export function jutsuPoints(jutsu: Jutsu, rank?: Rank | null) {
    const effectiveRank = rank ?? jutsu.bloodlineRank ?? null;
    let points = jutsu.tags.reduce((sum, tag) => sum + tagPointValue(tag, effectiveRank), 0);
    if (jutsu.ap === 40) points += 1;
    if (jutsu.range >= 5) points += 0.5;
    if (jutsu.target === "EMPTY_GROUND") {
        // AOE_CIRCLE is the cheap ring nudge; INSTANT_EFFECT and the bigger
        // AOE_SPIRAL ground-nova each cost a full point.
        if (jutsu.method === "AOE_CIRCLE") points += 0.5;
        else if (jutsu.method === "INSTANT_EFFECT" || jutsu.method === "AOE_SPIRAL") points += 1;
    }
    if (!hasFixedEffectPower(jutsu)) {
        if (jutsu.ap === 60 && jutsu.effectPower >= 45) points += 1;
    }
    if (jutsu.cooldown <= 1) points += 0.5;
    return points;
}

export function bloodlinePoints(jutsus: Jutsu[]) {
    return jutsus.reduce((sum, jutsu) => sum + jutsuPoints(jutsu), 0);
}
