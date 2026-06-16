/*
 * Bloodline Maker quick-start templates — balanced, in-budget starting jutsu
 * sets a player can load and then rename / reskin instead of facing a blank
 * canvas. Pure. The colocated test guarantees every archetype × rank stays
 * within pointBudgetForRank and obeys the builder's structural rules (jutsu
 * count, at most one Nuke and one Pierce, bloodline-unique tags used once).
 *
 * Loading a template never changes balance: it only pre-fills values the
 * player can still edit, and every generated set is comfortably under budget.
 */

import { normalizeJutsu } from "./jutsu";
import { jutsuCountForRank } from "./jutsu-points";
import { binaryTags, cappedDamageTags, tagCapForRank } from "./tags";
import { makeId } from "./utils";
import type { Jutsu, JutsuTag } from "../types/combat";
import type { JutsuElement, JutsuTarget, JutsuType, Rank } from "../types/core";

export interface BloodlineArchetype {
    key: string;
    name: string;
    blurb: string;
}

export const bloodlineArchetypes: BloodlineArchetype[] = [
    { key: "glass-cannon", name: "Glass Cannon", blurb: "Maximum damage — a nuke, a piercing strike, and offense buffs." },
    { key: "bruiser", name: "Bruiser", blurb: "Sustained damage with lifesteal, bleed, and a finisher." },
    { key: "controller", name: "Controller", blurb: "Lock the enemy down — stun, bloodline seal, and damage debuffs." },
    { key: "support", name: "Support", blurb: "Stay standing — shields, healing, reflects, and damage cuts." },
];

type DamageMode = "standard" | "nuke" | "pierce";

interface TemplateJutsuSpec {
    name: string;
    ap: 40 | 60;
    damageMode?: DamageMode; // 60 AP only; defaults to standard
    target?: JutsuTarget;    // defaults to OPPONENT
    tags: string[];          // tag names; percents derived per rank below
}

// Nuke + Pierce jutsu (and any bloodline-unique tags) are kept in the first 4
// slots so B Rank (which only uses 4 jutsu) still gets the archetype's flavor.
const ARCHETYPE_SPECS: Record<string, TemplateJutsuSpec[]> = {
    "glass-cannon": [
        { name: "Annihilation Blast", ap: 60, damageMode: "nuke", tags: ["Increase Damage Given"] },
        { name: "Piercing Lance", ap: 60, damageMode: "pierce", tags: [] },
        { name: "Searing Barrage", ap: 60, tags: ["Ignition"] },
        { name: "Exposed Nerve", ap: 60, tags: ["Increase Damage Taken"] },
        { name: "Battle Trance", ap: 40, target: "SELF", tags: ["Increase Damage Given", "Overclock"] },
    ],
    "bruiser": [
        { name: "Rending Strike", ap: 60, tags: ["Wound"] },
        { name: "Leeching Blow", ap: 60, tags: ["Lifesteal"] },
        { name: "Devastator", ap: 60, damageMode: "nuke", tags: ["Increase Damage Given"] },
        { name: "Chakra Siphon", ap: 60, tags: ["Siphon"] },
        { name: "Iron Resolve", ap: 40, target: "SELF", tags: ["Decrease Damage Taken", "Increase Heal"] },
    ],
    "controller": [
        { name: "Paralyzing Grip", ap: 60, tags: ["Stun"] },
        { name: "Bloodline Sever", ap: 60, tags: ["Bloodline Seal"] },
        { name: "Crippling Hex", ap: 60, tags: ["Decrease Damage Given"] },
        { name: "Venom Curse", ap: 60, tags: ["Poison"] },
        { name: "Mind Fog", ap: 40, tags: ["Buff Prevent", "Decrease Damage Given"] },
    ],
    "support": [
        { name: "Aegis Ward", ap: 60, tags: ["Shield", "Decrease Damage Taken"] },
        { name: "Mending Tide", ap: 60, tags: ["Heal"] },
        { name: "Reflective Guard", ap: 60, tags: ["Reflect", "Absorb"] },
        { name: "Suppressing Field", ap: 60, tags: ["Decrease Damage Given"] },
        { name: "Bulwark Stance", ap: 40, target: "SELF", tags: ["Debuff Prevent", "Decrease Damage Taken"] },
    ],
};

// Per-rank percent for a template tag. Mirrors what the builder's TagPicker
// would set: capped damage tags sit at the rank cap; Wound/Poison use the
// standard bloodline values; binary tags carry no percent.
function templatePercent(name: string, rank: Rank): number {
    if (binaryTags.includes(name)) return 0;
    if (cappedDamageTags.includes(name)) return tagCapForRank(rank);
    if (name === "Wound") return rank === "S Rank" ? 35 : 30;
    if (name === "Poison") return 30;
    return 0;
}

function buildTemplateJutsu(spec: TemplateJutsuSpec, rank: Rank, element: JutsuElement, offense: JutsuType): Jutsu {
    const effectPower = spec.ap === 40 ? 0 : spec.damageMode === "nuke" ? 50 : 40;
    const tags: JutsuTag[] = spec.tags.map((name) => ({ name, percent: templatePercent(name, rank) }));
    if (spec.ap === 60 && spec.damageMode === "pierce") tags.push({ name: "Pierce", percent: 0 });
    return normalizeJutsu({
        id: makeId(),
        name: `${element} ${spec.name}`.trim(),
        type: offense,
        element,
        ap: spec.ap,
        range: 4,
        effectPower,
        cooldown: 7,
        chakraCost: 100,
        staminaCost: 100,
        target: spec.target ?? "OPPONENT",
        tags,
    });
}

/** Build a rank-appropriate jutsu set for an archetype, themed to element/offense. */
export function bloodlineTemplateJutsus(key: string, rank: Rank, element: string, offense: JutsuType): Jutsu[] {
    const specs = ARCHETYPE_SPECS[key] ?? [];
    const finalElement = (element.trim() || "Fire") as JutsuElement;
    return specs
        .slice(0, jutsuCountForRank(rank))
        .map((spec) => buildTemplateJutsu(spec, rank, finalElement, offense));
}
