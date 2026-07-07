import type { CombatVfxKey } from "./combat-vfx";

export type CombatVfxDiscipline =
    | "elemental"
    | "ninjutsu"
    | "taijutsu"
    | "bukijutsu"
    | "genjutsu"
    | "support"
    | "status"
    | "finisher";

export type CombatVfxAssetRole =
    | "element"
    | "physical-offense"
    | "weapon-offense"
    | "support"
    | "control"
    | "status"
    | "finisher";

export type CombatVfxAssetPlane = "burst" | "ground" | "slash" | "ward";

export type CombatVfxAssetSpec = {
    filename: string;
    url: string;
    discipline: CombatVfxDiscipline;
    role: CombatVfxAssetRole;
    plane: CombatVfxAssetPlane;
    tags: readonly string[];
    assetScale: number;
    liftPx: number;
    opacity: number;
};

function asset(
    filename: string,
    discipline: CombatVfxDiscipline,
    role: CombatVfxAssetRole,
    plane: CombatVfxAssetPlane,
    tags: readonly string[],
    assetScale = 1.42,
    liftPx = -3,
    opacity = 0.88,
): CombatVfxAssetSpec {
    return {
        filename,
        url: `/combat-vfx/${filename}`,
        discipline,
        role,
        plane,
        tags,
        assetScale,
        liftPx,
        opacity,
    };
}

export const COMBAT_VFX_ASSETS: Record<CombatVfxKey, CombatVfxAssetSpec> = {
    fire: asset("fire.webp", "elemental", "element", "burst", ["Element: Fire", "Material: Elemental"]),
    water: asset("water.webp", "elemental", "element", "ground", ["Element: Water", "Material: Elemental"], 1.52, -2),
    wind: asset("wind.webp", "elemental", "element", "burst", ["Element: Wind", "Material: Elemental"], 1.5, -1),
    lightning: asset("lightning.webp", "elemental", "element", "ground", ["Element: Lightning", "Material: Elemental"], 1.48, -1),
    earth: asset("earth.webp", "elemental", "element", "ground", ["Element: Earth", "Material: Elemental"], 1.42, 0),
    blood: asset("blood.webp", "elemental", "element", "burst", ["Element: Blood", "Material: Bloodline"], 1.5, -2),
    shadow: asset("shadow.webp", "elemental", "element", "burst", ["Element: Shadow", "Control: Shadow"], 1.5, -3),
    poison: asset("poison.webp", "elemental", "element", "ground", ["Element: Poison", "Tag: Poison"], 1.45, 0, 0.84),
    magma: asset("magma.webp", "elemental", "element", "ground", ["Element: Magma", "Element: Lava"], 1.48, -1),
    metal: asset("metal.webp", "elemental", "element", "ground", ["Element: Metal", "Element: Iron"], 1.38, 0),
    slash: asset("slash.webp", "bukijutsu", "weapon-offense", "slash", ["Offense: Bukijutsu", "Hit: Slash"], 1.46, -4),
    impact: asset("impact.webp", "taijutsu", "physical-offense", "ground", ["Offense: Taijutsu", "Hit: Impact", "Fallback"], 1.36, 0),
    pierce: asset("pierce.webp", "bukijutsu", "weapon-offense", "slash", ["Offense: Bukijutsu", "Tag: Pierce"], 1.48, -5),
    heal: asset("heal.webp", "support", "support", "ward", ["Tag: Heal", "Support: Recovery"], 1.38, -4, 0.86),
    shield: asset("shield.webp", "support", "support", "ward", ["Tag: Shield", "Tag: Barrier"], 1.46, -8, 0.86),
    reflect: asset("reflect.webp", "support", "support", "ward", ["Tag: Reflect", "Support: Guard"], 1.46, -8, 0.86),
    absorb: asset("absorb.webp", "support", "support", "ward", ["Tag: Absorb", "Support: Guard"], 1.46, -8, 0.86),
    spark: asset("spark.webp", "genjutsu", "control", "ground", ["Tag: Stun", "Tag: Lag"], 1.4, 0),
    seal: asset("seal.webp", "genjutsu", "control", "ward", ["Tag: Bloodline Seal", "Tag: Elemental Seal"], 1.44, -5, 0.86),
    wound: asset("wound.webp", "status", "status", "burst", ["Tag: Wound", "Status: Damage over time"], 1.38, -2, 0.84),
    burn: asset("burn.webp", "status", "status", "ground", ["Tag: Ignition", "Status: Burn"], 1.42, 0, 0.86),
    poisonCloud: asset("poison-cloud.webp", "status", "status", "ground", ["Tag: Poison", "Status: Ground cloud"], 1.54, 1, 0.82),
    drain: asset("drain.webp", "genjutsu", "status", "ward", ["Tag: Drain", "Tag: Siphon"], 1.42, -3, 0.84),
    cleanse: asset("cleanse.webp", "support", "support", "ward", ["Action: Cleanse", "Action: Clear"], 1.42, -4, 0.84),
    buff: asset("buff.webp", "support", "support", "ward", ["Tag: Increase", "Tag: Overclock", "Support: Buff"], 1.44, -5, 0.84),
    debuff: asset("debuff.webp", "genjutsu", "status", "ward", ["Tag: Decrease", "Status: Debuff"], 1.42, -3, 0.84),
    throwable: asset("throwable.webp", "bukijutsu", "weapon-offense", "slash", ["Action: Throwable", "Offense: Bukijutsu"], 1.32, -4),
    weapon: asset("weapon.webp", "bukijutsu", "weapon-offense", "slash", ["Action: Weapon", "Offense: Bukijutsu"], 1.4, -5),
    namedWeapon: asset("named-weapon.webp", "bukijutsu", "weapon-offense", "slash", ["Action: Named Weapon", "Offense: Bukijutsu"], 1.52, -6),
    heavy: asset("heavy.webp", "taijutsu", "physical-offense", "ground", ["Action: Heavy", "Offense: Taijutsu"], 1.5, -1),
    ko: asset("ko.webp", "finisher", "finisher", "ground", ["Result: KO", "Result: Finisher"], 1.62, -2, 0.94),
};

export function combatVfxAssetFor(key: CombatVfxKey): CombatVfxAssetSpec {
    return COMBAT_VFX_ASSETS[key] ?? COMBAT_VFX_ASSETS.impact;
}
