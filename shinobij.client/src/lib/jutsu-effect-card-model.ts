import { normalizeTagName } from "./tags";
import type { Jutsu } from "../types/combat";

type EffectTone = "power" | "recovery" | "guard" | "harm" | "control" | "utility";

const EFFECT_TONES = [
    ["power", /^(?:Increase Damage Given|Increase Generals|Increase Discipline|Siphon|Lifesteal|Pierce|Overclock)$/],
    ["recovery", /^(?:Heal|Increase Heal)$/],
    ["guard", /^(?:Shield|Barrier|Decrease Damage Taken|Reflect|Absorb|Debuff Prevent|Clear Prevent|Stun Prevent)$/],
    ["harm", /^(?:Damage|Wound|Poison|Drain|Ignition|Afterburn|Recoil|Increase Damage Taken|Decrease Damage Given)$/],
    ["control", /^(?:Stun|Push|Pull|Bloodline Seal|Elemental Seal|Buff Prevent|Cleanse Prevent|Lag|Time Compression|Mirror)$/],
] as const satisfies ReadonlyArray<readonly [Exclude<EffectTone, "utility">, RegExp]>;

const SELF_EFFECT_TAGS = new Set([
    "Heal",
    "Shield",
    "Absorb",
    "Siphon",
    "Lifesteal",
    "Reflect",
    "Increase Damage Given",
    "Decrease Damage Taken",
    "Debuff Prevent",
    "Clear Prevent",
    "Stun Prevent",
    "Copy",
    "Overclock",
    "Increase Heal",
    "Increase Generals",
    "Increase Discipline",
    "Move",
]);

const ENEMY_EFFECT_TAGS = new Set([
    "Damage",
    "Recoil",
    "Wound",
    "Ignition",
    "Stun",
    "Bloodline Seal",
    "Elemental Seal",
    "Push",
    "Pull",
    "Buff Prevent",
    "Cleanse Prevent",
    "Poison",
    "Drain",
    "Mirror",
    "Lag",
    "Decrease Damage Given",
    "Increase Damage Taken",
    "Pierce",
]);

/** The recipient of this individual effect, which may differ from the cast target on mixed-tag jutsu. */
export function jutsuEffectTargetLabel(jutsu: Pick<Jutsu, "target">, tagName: string): string {
    const canonicalName = normalizeTagName(tagName);
    if (SELF_EFFECT_TAGS.has(canonicalName)) return canonicalName === "Copy" ? "Self (copies eligible enemy buffs)" : "Self";
    if (ENEMY_EFFECT_TAGS.has(canonicalName)) return canonicalName === "Mirror" ? "Enemy (copies all your debuffs)" : "Enemy";
    if (canonicalName === "Barrier") return "Battlefield";

    switch (jutsu.target ?? "OPPONENT") {
        case "SELF": return "Self";
        case "OPPONENT": return "Enemy";
        case "OTHER_USER": return "Other player";
        case "CHARACTER": return "Character";
        case "EMPTY_GROUND": return "Ground";
    }
}

export function jutsuEffectTone(name: string): EffectTone {
    for (const [tone, pattern] of EFFECT_TONES) {
        if (pattern.test(name)) return tone;
    }
    return "utility";
}
