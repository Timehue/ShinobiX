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

// NB: "Increase Discipline" is a LEGACY-signature-only tag — it lives in the
// combat-math lists (percentageTags / cappedDamageTags, so effectiveTagPercent
// rank-caps it) but is deliberately ABSENT from allTags / tagGroups below, so
// the bloodline maker and custom-jutsu editor never offer it. Keep it out of
// those picker lists (on a 40-AP jutsu its type is forced to "Any", where it
// no-ops — an offerable trap — and bloodlines already have Increase Generals).
export const percentageTags = [
    "Increase Damage Given",
    "Decrease Damage Given",
    "Increase Damage Taken",
    "Decrease Damage Taken",
    "Increase Generals",
    "Increase Discipline",
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
    "Increase Generals",
    "Increase Discipline",
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

/** Legacy/catalog combat magnitude cap. Player-creator choices live in jutsu-points.ts. */
export function tagCapForRank(rank?: Rank | null): number {
    if (rank === "S Rank") return 40;
    if (rank === "A Rank" || rank === "B Rank") return 35;
    return 30; // global / no rank
}

// Poison's percent is not on the amp scale: combat turns it into HP lost per cast
// (spend × percent × 12), so it has its own lower rank ceiling. Mirrors
// api/combat-core/formulas.ts POISON_CAP_BY_RANK (parity-pinned).
export const POISON_CAP_BY_RANK: Record<string, number> = {
    basic: 10,
    AB: 12,
    S: 14,
};
// A weapon swing answers to the A/B ceiling (mirrors the server constant).
export const WEAPON_POISON_TAG_CAP = POISON_CAP_BY_RANK.AB;

// The percent a weapon's tag applies in combat, for item cards. Poison on a weapon
// answers to WEAPON_POISON_TAG_CAP, so a blade forged before that cap (stored at
// 15-40) shows what it actually applies rather than its original roll.
export function weaponTagCombatPercent(name: string, percent: number): number {
    return normalizeTagName(name) === "Poison" ? Math.min(percent, WEAPON_POISON_TAG_CAP) : percent;
}

export function poisonCapForRank(rank?: string | null): number {
    const trimmed = (rank ?? "").trim();
    if (/^S/i.test(trimmed)) return POISON_CAP_BY_RANK.S;
    if (/^[AB]/i.test(trimmed)) return POISON_CAP_BY_RANK.AB;
    return POISON_CAP_BY_RANK.basic;
}

// Mirrors api/combat-core/formulas.ts poisonPercentForTag: the authored percent
// (default 6) clamped to the rank ceiling, then ramped two-thirds → full by mastery.
export function effectivePoisonPercent(rawPercent: number | undefined, bloodlineRank?: string | null, level = 50): number {
    const authored = Number(rawPercent) > 0 ? Number(rawPercent) : 6;
    const ceiling = Math.min(authored, poisonCapForRank(bloodlineRank));
    const mastery = Math.max(0, Math.min(50, Number(level) || 0));
    return Math.max(1, Math.floor(ceiling * (100 + mastery) / 150));
}

export function effectiveTagPercent(tag: JutsuTag, bloodlineRank?: Rank | null, level = 50): number {
    if (normalizeTagName(tag.name) === "Poison") return effectivePoisonPercent(tag.percent, bloodlineRank, level);
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
    "Increase Generals",
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

// Tag categories for the bloodline-maker dropdown — turns a flat wall of ~30
// cryptic names into scannable groups. Every entry in `allTags` belongs to
// exactly one group (enforced by the colocated test). `groupTags` filters these
// to whatever the picker currently allows, preserving group + member order.
export const tagGroups: { label: string; tags: string[] }[] = [
    { label: "Damage & DoT", tags: ["Wound", "Poison", "Ignition", "Drain", "Recoil"] },
    { label: "Offense (you)", tags: ["Increase Damage Given", "Increase Generals", "Lifesteal", "Siphon", "Increase Heal", "Overclock"] },
    { label: "Defense (you)", tags: ["Shield", "Heal", "Absorb", "Reflect", "Decrease Damage Taken", "Debuff Prevent", "Clear Prevent", "Stun Prevent"] },
    { label: "Debuffs (enemy)", tags: ["Decrease Damage Given", "Increase Damage Taken", "Buff Prevent", "Cleanse Prevent", "Lag"] },
    { label: "Control", tags: ["Stun", "Bloodline Seal", "Elemental Seal", "Copy", "Mirror"] },
    { label: "Movement", tags: ["Move", "Push", "Pull"] },
];

/** Group an available-tag list into the dropdown categories, dropping empties. */
export function groupTags(available: string[]): { label: string; tags: string[] }[] {
    const set = new Set(available);
    const grouped = tagGroups
        .map((group) => ({ label: group.label, tags: group.tags.filter((t) => set.has(t)) }))
        .filter((group) => group.tags.length > 0);
    // Anything not categorized (e.g. a future tag) lands in a trailing "Other".
    const placed = new Set(tagGroups.flatMap((g) => g.tags));
    const other = available.filter((t) => !placed.has(t));
    return other.length ? [...grouped, { label: "Other", tags: other }] : grouped;
}

/**
 * AP-tempo tags, reserved AWAY from the built-in (non-bloodline) starter set.
 *
 * Manipulating what an action COSTS is a deliberate bloodline-exclusive lever
 * (owner ruling 2026-05-28), so a starter may pair Increase Generals with any
 * ordinary buff but never with these. This is a different rule from
 * `bloodlineUniqueTags` below, which caps a tag at one copy per bloodline KIT
 * and says nothing about starters — conflating the two is how three starters
 * (Galewind Attunement, Thunderpulse Overdrive, Forgeheart Temper) shipped with
 * Overclock until 2026-09-01. Pinned by data/starter-tag-taxonomy.test.ts.
 */
export const starterForbiddenTags = ["Lag", "Overclock"];

/** Tags a single bloodline kit may spend on at most ONE of its techniques. */
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

// Tags that mean a jutsu touches the OPPONENT (debuffs / displacement / DoTs).
// Canonical names only. MUST mirror OPPONENT_AFFECTING_TAGS in api/pvp/_tags.ts
// — scripts/pvp-tags-parity.test.mjs would fail if the two drift. Self-buffs
// (Heal/Shield/Absorb/Reflect/Lifesteal/Increase*Given/Decrease*Taken/etc.) are
// deliberately absent: a pure self-buff auto-casts on the caster.
export const opponentAffectingTags = [
    "Stun",
    "Bloodline Seal",
    "Elemental Seal",
    "Buff Prevent",
    "Cleanse Prevent",
    "Decrease Damage Given",
    "Increase Damage Taken",
    "Ignition",
    "Poison",
    "Drain",
    "Lag",
    "Mirror",
    "Push",
    "Pull",
    "Recoil",
];

// Mirrors the server's `affectsOpponent` (api/pvp/move.ts): a jutsu touches the
// opponent when it deals damage OR carries an opponent-affecting tag. The PvP
// battle screen uses this to decide auto-cast (self) vs arm-then-click-opponent,
// so a clicked jutsu can't "do nothing" because the client guessed self-target
// while the server gated it on an in-range opponent.
export function pvpAffectsOpponent(jutsu: {
    effectPower?: number;
    tags?: ReadonlyArray<{ name?: string }>;
}): boolean {
    if ((jutsu.effectPower ?? 0) > 0) return true;
    const set = new Set(opponentAffectingTags);
    return (jutsu.tags ?? []).some((tag) => set.has(normalizeTagName(tag.name ?? "")));
}

const fixedEffectPowerTags = [...binaryTags, "Push", "Pull"];

export function hasFixedEffectPower(jutsu: Pick<Jutsu, "tags">) {
    return jutsu.tags.some((tag) => fixedEffectPowerTags.includes(normalizeTagName(tag.name)));
}
