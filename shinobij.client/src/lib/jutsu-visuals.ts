import type { JutsuVisualEffect } from "../types/combat";

export type JutsuVisualEffectOption = {
    key: JutsuVisualEffect;
    label: string;
    shortLabel: string;
    description: string;
    group: "New Elemental" | "Classic Elemental & Bloodline" | "Physical & Weapon" | "Support & Control" | "Status & Finisher";
};

export const JUTSU_VISUAL_EFFECT_OPTIONS: readonly JutsuVisualEffectOption[] = [
    { key: "fire60", label: "Fire Engulf", shortLabel: "Fire", description: "Opponent is engulfed in flames.", group: "New Elemental" },
    { key: "wind60", label: "Tornado Trap", shortLabel: "Wind", description: "Opponent is trapped inside a tornado.", group: "New Elemental" },
    { key: "water60", label: "Water Bubble", shortLabel: "Water", description: "Opponent is enclosed by a water sphere.", group: "New Elemental" },
    { key: "lightning60", label: "Lightning Strike", shortLabel: "Lightning", description: "Opponent is struck by branching lightning.", group: "New Elemental" },
    { key: "earth60", label: "Boulder Smash", shortLabel: "Earth", description: "Opponent is crushed by a boulder impact.", group: "New Elemental" },

    { key: "fire", label: "Classic Fire", shortLabel: "Fire", description: "The original flame burst effect.", group: "Classic Elemental & Bloodline" },
    { key: "water", label: "Classic Water", shortLabel: "Water", description: "The original rushing water effect.", group: "Classic Elemental & Bloodline" },
    { key: "wind", label: "Classic Wind", shortLabel: "Wind", description: "The original slicing wind effect.", group: "Classic Elemental & Bloodline" },
    { key: "lightning", label: "Classic Lightning", shortLabel: "Lightning", description: "The original electric impact effect.", group: "Classic Elemental & Bloodline" },
    { key: "earth", label: "Classic Earth", shortLabel: "Earth", description: "The original stone impact effect.", group: "Classic Elemental & Bloodline" },
    { key: "blood", label: "Blood Burst", shortLabel: "Blood", description: "A sharp crimson bloodline burst.", group: "Classic Elemental & Bloodline" },
    { key: "shadow", label: "Shadow Burst", shortLabel: "Shadow", description: "A dark shadow-energy impact.", group: "Classic Elemental & Bloodline" },
    { key: "poison", label: "Venom Splash", shortLabel: "Venom", description: "A toxic green venom splash.", group: "Classic Elemental & Bloodline" },
    { key: "magma", label: "Magma Eruption", shortLabel: "Magma", description: "A molten lava eruption.", group: "Classic Elemental & Bloodline" },
    { key: "metal", label: "Metal Impact", shortLabel: "Metal", description: "A hard metallic ground impact.", group: "Classic Elemental & Bloodline" },

    { key: "slash", label: "Slash", shortLabel: "Slash", description: "A fast bladed slash.", group: "Physical & Weapon" },
    { key: "impact", label: "Impact", shortLabel: "Impact", description: "A clean physical hit impact.", group: "Physical & Weapon" },
    { key: "pierce", label: "Pierce", shortLabel: "Pierce", description: "A focused piercing strike.", group: "Physical & Weapon" },
    { key: "throwable", label: "Throwing Weapon", shortLabel: "Throw", description: "A spinning projectile strike.", group: "Physical & Weapon" },
    { key: "weapon", label: "Weapon Strike", shortLabel: "Weapon", description: "A standard weapon hit.", group: "Physical & Weapon" },
    { key: "namedWeapon", label: "Named Weapon", shortLabel: "Named", description: "A stronger signature-weapon strike.", group: "Physical & Weapon" },
    { key: "heavy", label: "Heavy Impact", shortLabel: "Heavy", description: "A large, weighty physical impact.", group: "Physical & Weapon" },

    { key: "heal", label: "Heal", shortLabel: "Heal", description: "A bright restorative aura.", group: "Support & Control" },
    { key: "shield", label: "Shield", shortLabel: "Shield", description: "A protective energy barrier.", group: "Support & Control" },
    { key: "reflect", label: "Reflect", shortLabel: "Reflect", description: "A mirrored defensive ward.", group: "Support & Control" },
    { key: "absorb", label: "Absorb", shortLabel: "Absorb", description: "An energy-absorbing ward.", group: "Support & Control" },
    { key: "spark", label: "Stun Spark", shortLabel: "Stun", description: "A crackling stun or lag spark.", group: "Support & Control" },
    { key: "seal", label: "Seal", shortLabel: "Seal", description: "A binding seal formation.", group: "Support & Control" },
    { key: "cleanse", label: "Cleanse", shortLabel: "Cleanse", description: "A purifying clear effect.", group: "Support & Control" },
    { key: "buff", label: "Buff", shortLabel: "Buff", description: "A rising power-up aura.", group: "Support & Control" },
    { key: "debuff", label: "Debuff", shortLabel: "Debuff", description: "A weakening status aura.", group: "Support & Control" },
    { key: "drain", label: "Drain", shortLabel: "Drain", description: "A siphoning energy effect.", group: "Support & Control" },

    { key: "wound", label: "Wound", shortLabel: "Wound", description: "A bleeding wound impact.", group: "Status & Finisher" },
    { key: "burn", label: "Burn", shortLabel: "Burn", description: "A lingering ignition effect.", group: "Status & Finisher" },
    { key: "poisonCloud", label: "Poison Cloud", shortLabel: "Poison", description: "A spreading toxic cloud.", group: "Status & Finisher" },
    { key: "ko", label: "Knockout", shortLabel: "KO", description: "The full finisher knockout impact.", group: "Status & Finisher" },
];

const JUTSU_VISUAL_EFFECT_KEYS = new Set<JutsuVisualEffect>(JUTSU_VISUAL_EFFECT_OPTIONS.map(option => option.key));

export function isJutsuVisualEffect(value: unknown): value is JutsuVisualEffect {
    return typeof value === "string" && JUTSU_VISUAL_EFFECT_KEYS.has(value as JutsuVisualEffect);
}

export function jutsuVisualEffectLabel(value?: JutsuVisualEffect | null): string {
    return JUTSU_VISUAL_EFFECT_OPTIONS.find(option => option.key === value)?.label ?? "Automatic";
}
