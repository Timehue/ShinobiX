/*
 * Tag data tables + tag-name normalization / effect helpers.
 *
 * Pure, leaf-level building blocks shared by combat math, jutsu logic, and the
 * jutsu/profile screens. Depends only on the extracted type modules, so it has
 * no dependency back on App.tsx.
 *
 * Extracted verbatim from App.tsx (Region A).
 */

import type { Rank, JutsuMethod } from "../types/core";
import type { JutsuTag, Jutsu } from "../types/combat";

export const percentageTags = [
    "Increase Damage Given",
    "Decrease Damage Given",
    "Increase Damage Taken",
    "Decrease Damage Taken",
    "Absorb",
    "Lifesteal",
    "Siphon",
    "Ignition",
    "Reflect",
    "Recoil",
    "Wound",
];

// Tags whose percent is capped per source rank
export const cappedDamageTags = [
    "Increase Damage Given",
    "Decrease Damage Given",
    "Increase Damage Taken",
    "Decrease Damage Taken",
    "Absorb",
    "Siphon",
    "Ignition",
    "Reflect",
    "Recoil",
    "Lifesteal",
];

// Tags that are binary (always apply, no percent-based hit chance)
export const binaryTags = [
    "Stun",
    "Bloodline Seal",
    "Elemental Seal",
    "Copy",
    "Mirror",
    "Move",
    "Buff Prevent",
    "Debuff Prevent",
    "Cleanse Prevent",
    "Clear Prevent",
    "Stun Prevent",
    "Lag",
    "Overclock",
];

export function normalizeTagName(name: string) {
    if (name === "Seal") return "Bloodline Seal";
    if (name === "Afterburn") return "Ignition";
    if (name === "Time Compression") return "Lag";
    if (name === "Time Dilation") return "Overclock";
    if (name === "Vamp") return "Siphon";
    return name;
}

export function normalizeJutsuMethod(method?: string) {
    if (method === "AOE_LINE") return "INSTANT_EFFECT";
    return (method ?? "SINGLE") as JutsuMethod;
}

export function tagMatchesName(name: string, canonicalName: string) {
    return normalizeTagName(name) === canonicalName;
}

export function statusMatchesName(status: { name: string }, canonicalName: string) {
    return tagMatchesName(status.name, canonicalName);
}

export function normalizeJutsuTags(tags?: JutsuTag[]): JutsuTag[] {
    return (tags ?? [])
        .filter((tag) => tag.name?.trim())
        .map((tag) => ({ ...tag, name: normalizeTagName(tag.name) }))
        .map((tag) => binaryTags.includes(tag.name) ? { ...tag, percent: 0 } : tag);
}

export function tagCapForRank(rank?: Rank | null): number {
    if (rank === "S Rank") return 40;
    if (rank === "A Rank" || rank === "B Rank") return 35;
    return 30; // global / no rank
}

export function effectiveTagPercent(tag: JutsuTag, bloodlineRank?: Rank | null, level = 50): number {
    const raw = tag.percent > 0 ? tag.percent : 30;
    // Scale linearly: level 50 = full creator value, each level below 50 subtracts 0.2
    const levelScaled = Math.max(0, raw - (50 - level) * 0.2);
    if (cappedDamageTags.includes(normalizeTagName(tag.name))) {
        return Math.min(levelScaled, tagCapForRank(bloodlineRank));
    }
    return levelScaled;
}

export const allTags = [
    "Absorb",
    "Buff Prevent",
    "Cleanse Prevent",
    "Clear Prevent",
    "Copy",
    "Debuff Prevent",
    "Decrease Damage Given",
    "Decrease Damage Taken",
    "Drain",
    "Elemental Seal",
    "Heal",
    "Ignition",
    "Increase Damage Given",
    "Increase Damage Taken",
    "Increase Heal",
    "Lifesteal",
    "Mirror",
    "Move",
    "Poison",
    "Pull",
    "Push",
    "Recoil",
    "Reflect",
    "Bloodline Seal",
    "Shield",
    "Siphon",
    "Stun",
    "Stun Prevent",
    "Lag",
    "Overclock",
    "Wound",
];

export const bloodlineUniqueTags = [
    "Stun",
    "Bloodline Seal",
    "Buff Prevent",
    "Debuff Prevent",
    "Elemental Seal",
    "Mirror",
    "Copy",
    "Lag",
    "Overclock",
    "Pierce",
];

const fixedEffectPowerTags = [...binaryTags, "Push", "Pull"];

export function hasFixedEffectPower(jutsu: Pick<Jutsu, "tags">) {
    return jutsu.tags.some((tag) => fixedEffectPowerTags.includes(normalizeTagName(tag.name)));
}
