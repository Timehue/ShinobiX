import type { Jutsu, JutsuTag, GameItem } from "../types/combat";
import { normalizeTagName } from "./tags";

export type CombatVfxKey =
    | "fire"
    | "water"
    | "wind"
    | "lightning"
    | "earth"
    | "blood"
    | "shadow"
    | "poison"
    | "magma"
    | "metal"
    | "slash"
    | "impact"
    | "pierce"
    | "heal"
    | "shield"
    | "reflect"
    | "absorb"
    | "spark"
    | "seal"
    | "wound"
    | "burn"
    | "poisonCloud"
    | "drain"
    | "cleanse"
    | "buff"
    | "debuff"
    | "throwable"
    | "weapon"
    | "namedWeapon"
    | "heavy"
    | "ko";

export type CombatVfxTarget = "caster" | "target" | "tile" | "area";
export type CombatVfxIntensity = "minor" | "normal" | "heavy" | "finisher";

export type CombatVfxSpec = {
    key: CombatVfxKey;
    target: CombatVfxTarget;
    intensity: CombatVfxIntensity;
    durationMs: number;
    persistent?: boolean;
    maxParticles?: number;
    tiles?: number[];
};

export type CombatVfxAction =
    | "jutsu"
    | "weapon"
    | "throwable"
    | "consumable"
    | "basicAttack"
    | "basicHeal"
    | "clear"
    | "cleanse"
    | "dot"
    | "unknown";

export type CombatVfxIntent = {
    action?: CombatVfxAction;
    element?: string | null;
    discipline?: string | null;
    effectPower?: number | null;
    isUtility?: boolean | null;
    tags?: Array<Pick<JutsuTag, "name">> | null;
    target?: Pick<Jutsu, "target">["target"] | "OPPONENT" | string | null;
    method?: Pick<Jutsu, "method">["method"] | string | null;
    itemSlot?: Pick<GameItem, "slot">["slot"] | string | null;
    named?: boolean;
    heavy?: boolean;
    ko?: boolean;
    ground?: boolean;
    area?: boolean;
    persistent?: boolean;
    tiles?: number[];
};

type CombatVfxDefaults = {
    durationMs: number;
    maxParticles: number;
};

export const COMBAT_VFX_REGISTRY: Record<CombatVfxKey, CombatVfxDefaults> = {
    fire: { durationMs: 680, maxParticles: 20 },
    water: { durationMs: 720, maxParticles: 18 },
    wind: { durationMs: 620, maxParticles: 16 },
    lightning: { durationMs: 560, maxParticles: 18 },
    earth: { durationMs: 720, maxParticles: 16 },
    blood: { durationMs: 680, maxParticles: 18 },
    shadow: { durationMs: 740, maxParticles: 16 },
    poison: { durationMs: 760, maxParticles: 16 },
    magma: { durationMs: 760, maxParticles: 22 },
    metal: { durationMs: 640, maxParticles: 14 },
    slash: { durationMs: 420, maxParticles: 8 },
    impact: { durationMs: 460, maxParticles: 10 },
    pierce: { durationMs: 460, maxParticles: 10 },
    heal: { durationMs: 820, maxParticles: 16 },
    shield: { durationMs: 900, maxParticles: 14 },
    reflect: { durationMs: 820, maxParticles: 14 },
    absorb: { durationMs: 820, maxParticles: 14 },
    spark: { durationMs: 560, maxParticles: 18 },
    seal: { durationMs: 760, maxParticles: 14 },
    wound: { durationMs: 620, maxParticles: 12 },
    burn: { durationMs: 720, maxParticles: 18 },
    poisonCloud: { durationMs: 900, maxParticles: 18 },
    drain: { durationMs: 840, maxParticles: 16 },
    cleanse: { durationMs: 760, maxParticles: 14 },
    buff: { durationMs: 820, maxParticles: 14 },
    debuff: { durationMs: 760, maxParticles: 14 },
    throwable: { durationMs: 520, maxParticles: 10 },
    weapon: { durationMs: 440, maxParticles: 8 },
    namedWeapon: { durationMs: 620, maxParticles: 14 },
    heavy: { durationMs: 620, maxParticles: 16 },
    ko: { durationMs: 980, maxParticles: 24 },
};

const SUPPORT_TAGS = new Set([
    "Heal",
    "Shield",
    "Barrier",
    "Reflect",
    "Absorb",
    "Lifesteal",
    "Increase Damage Given",
    "Increase Generals",
    "Increase Discipline",
    "Increase Heal",
    "Decrease Damage Taken",
    "Debuff Prevent",
    "Stun Prevent",
    "Overclock",
]);

const DEBUFF_TAGS = new Set([
    "Decrease Damage Given",
    "Increase Damage Taken",
    "Buff Prevent",
    "Cleanse Prevent",
    "Clear Prevent",
    "Lag",
    "Recoil",
]);

const CONTROL_TAGS = new Set(["Stun", "Lag"]);
const SEAL_TAGS = new Set(["Bloodline Seal", "Elemental Seal"]);
const CASTER_WARD_KEYS = new Set<CombatVfxKey>(["heal", "shield", "reflect", "absorb", "buff", "cleanse"]);

function tagsFor(intent: CombatVfxIntent): string[] {
    return (intent.tags ?? [])
        .map((tag) => normalizeTagName(String(tag.name ?? "")))
        .filter(Boolean);
}

function has(tags: string[], name: string): boolean {
    return tags.includes(name);
}

function hasAny(tags: string[], names: Iterable<string>): boolean {
    for (const name of names) {
        if (tags.includes(name)) return true;
    }
    return false;
}

function elementKey(element?: string | null): CombatVfxKey | null {
    switch (String(element ?? "").trim().toLowerCase()) {
        case "fire":
        case "flame":
        case "ember":
        case "ash":
        case "smoke":
        case "sun":
        case "solar":
            return "fire";
        case "water":
        case "ice":
        case "frost":
        case "snow":
        case "mist":
        case "steam":
            return "water";
        case "wind":
        case "air":
        case "gale":
            return "wind";
        case "lightning":
        case "storm":
        case "thunder":
        case "shock":
        case "plasma":
        case "tempest":
            return "lightning";
        case "earth":
        case "stone":
        case "rock":
        case "sand":
        case "mud":
        case "wood":
        case "plant":
            return "earth";
        case "blood":
        case "crimson":
            return "blood";
        case "shadow":
        case "dark":
        case "darkness":
        case "void":
        case "night":
        case "moon":
        case "illusion":
            return "shadow";
        case "poison":
        case "venom":
        case "toxin":
        case "acid":
            return "poison";
        case "lava":
        case "magma":
        case "molten":
            return "magma";
        case "iron":
        case "metal":
        case "steel":
        case "crystal":
        case "glass":
        case "diamond":
        case "magnet":
            return "metal";
        default:
            return null;
    }
}

function disciplineKey(discipline?: string | null): CombatVfxKey | null {
    switch (String(discipline ?? "").trim().toLowerCase()) {
        case "taijutsu": return "impact";
        case "bukijutsu": return "slash";
        case "genjutsu": return "debuff";
        default:
            return null;
    }
}

function normalizedMethod(method?: string | null): string {
    return method === "AOE_LINE" ? "INSTANT_EFFECT" : String(method ?? "SINGLE");
}

function intensityFor(intent: CombatVfxIntent, key: CombatVfxKey): CombatVfxIntensity {
    if (intent.ko || key === "ko") return "finisher";
    if (intent.heavy || key === "heavy" || key === "namedWeapon") return "heavy";
    if (intent.action === "dot") return "minor";
    return "normal";
}

function isDamagingIntent(intent: CombatVfxIntent): boolean {
    return Number(intent.effectPower ?? 0) > 0 && intent.target !== "SELF" && intent.isUtility !== true;
}

function targetFor(intent: CombatVfxIntent, key: CombatVfxKey, tags: string[]): CombatVfxTarget {
    const method = normalizedMethod(intent.method);
    const isArea = intent.area || method === "AOE_CIRCLE" || method === "AOE_SPIRAL";
    if (isArea) return "area";
    if (intent.ground || intent.target === "EMPTY_GROUND" || method === "INSTANT_EFFECT") return "tile";
    if (intent.action === "weapon" || intent.action === "throwable" || intent.action === "basicAttack") return "target";
    if (intent.target === "SELF" || CASTER_WARD_KEYS.has(key)) {
        return "caster";
    }
    if (key === "buff" && !isDamagingIntent(intent) && hasAny(tags, SUPPORT_TAGS) && !hasAny(tags, DEBUFF_TAGS) && !hasAny(tags, CONTROL_TAGS) && !hasAny(tags, SEAL_TAGS)) {
        return "caster";
    }
    return "target";
}

function keyFromTags(tags: string[], intent: CombatVfxIntent): CombatVfxKey | null {
    if (has(tags, "Heal")) return "heal";
    if (hasAny(tags, CONTROL_TAGS)) return "spark";
    if (hasAny(tags, SEAL_TAGS)) return "seal";
    if (has(tags, "Copy")) return "reflect";
    if (has(tags, "Mirror")) return "debuff";
    if (has(tags, "Push") || has(tags, "Pull")) return "wind";
    if (has(tags, "Wound")) return "wound";
    if (has(tags, "Ignition")) return "burn";
    if (has(tags, "Poison")) return intent.ground || intent.area ? "poisonCloud" : "poison";
    if (has(tags, "Drain") || has(tags, "Siphon")) return "drain";
    if (has(tags, "Pierce")) return "pierce";
    if (hasAny(tags, DEBUFF_TAGS)) return "debuff";
    if (has(tags, "Barrier") || has(tags, "Shield")) return "shield";
    if (has(tags, "Reflect")) return "reflect";
    if (has(tags, "Absorb")) return "absorb";
    if (hasAny(tags, SUPPORT_TAGS)) return "buff";
    return null;
}

function jutsuKey(intent: CombatVfxIntent, tags: string[]): CombatVfxKey {
    const tagKey = keyFromTags(tags, intent);
    const materialKey = elementKey(intent.element) ?? disciplineKey(intent.discipline);
    if (tagKey && !(isDamagingIntent(intent) && CASTER_WARD_KEYS.has(tagKey))) return tagKey;
    return materialKey ?? tagKey ?? (intent.heavy ? "heavy" : "impact");
}

function keyForIntent(intent: CombatVfxIntent, tags: string[]): CombatVfxKey {
    if (intent.ko) return "ko";
    switch (intent.action ?? "unknown") {
        case "basicHeal": return "heal";
        case "cleanse": return "cleanse";
        case "clear": return "cleanse";
        case "basicAttack": return intent.heavy ? "heavy" : "impact";
        case "throwable": return "throwable";
        case "weapon": return intent.named ? "namedWeapon" : intent.heavy ? "heavy" : "weapon";
        case "consumable": return keyFromTags(tags, intent) ?? "buff";
        case "dot": return keyFromTags(tags, intent) ?? "impact";
        case "jutsu": return jutsuKey(intent, tags);
        default:
            return "impact";
    }
}

export function resolveCombatVfxSpec(intent: CombatVfxIntent = {}): CombatVfxSpec {
    const tags = tagsFor(intent);
    const key = keyForIntent(intent, tags);
    const defaults = COMBAT_VFX_REGISTRY[key] ?? COMBAT_VFX_REGISTRY.impact;
    const target = targetFor(intent, key, tags);
    return {
        key,
        target,
        intensity: intensityFor(intent, key),
        durationMs: defaults.durationMs,
        persistent: intent.persistent || key === "shield" || target === "area",
        maxParticles: defaults.maxParticles,
        tiles: intent.tiles?.slice(0, 18),
    };
}

export function safeCombatVfxSpec(spec: Partial<CombatVfxSpec> | null | undefined): CombatVfxSpec {
    const key = spec?.key && spec.key in COMBAT_VFX_REGISTRY ? spec.key : "impact";
    const defaults = COMBAT_VFX_REGISTRY[key];
    return {
        key,
        target: spec?.target ?? "target",
        intensity: spec?.intensity ?? "normal",
        durationMs: Math.max(120, Math.min(1200, Number(spec?.durationMs ?? defaults.durationMs))),
        persistent: Boolean(spec?.persistent),
        maxParticles: Math.max(0, Math.min(24, Number(spec?.maxParticles ?? defaults.maxParticles))),
        tiles: spec?.tiles?.slice(0, 18),
    };
}
