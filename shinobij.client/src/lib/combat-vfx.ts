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

const CONTROL_TAGS = new Set(["Stun", "Lag", "Overclock"]);
const SEAL_TAGS = new Set(["Bloodline Seal", "Elemental Seal"]);

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
        case "fire": return "fire";
        case "water": return "water";
        case "wind": return "wind";
        case "lightning": return "lightning";
        case "earth": return "earth";
        case "blood": return "blood";
        case "shadow": return "shadow";
        case "poison": return "poison";
        case "lava":
        case "magma":
            return "magma";
        case "iron":
        case "metal":
            return "metal";
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

function targetFor(intent: CombatVfxIntent, key: CombatVfxKey, tags: string[]): CombatVfxTarget {
    const method = normalizedMethod(intent.method);
    const isArea = intent.area || method === "AOE_CIRCLE" || method === "AOE_SPIRAL";
    if (isArea) return "area";
    if (intent.ground || intent.target === "EMPTY_GROUND" || method === "INSTANT_EFFECT") return "tile";
    if (intent.target === "SELF" || key === "heal" || key === "shield" || key === "reflect" || key === "absorb" || key === "buff" || key === "cleanse") {
        return "caster";
    }
    if (hasAny(tags, SUPPORT_TAGS) && !hasAny(tags, DEBUFF_TAGS) && !hasAny(tags, CONTROL_TAGS) && !hasAny(tags, SEAL_TAGS)) {
        return "caster";
    }
    return "target";
}

function keyFromTags(tags: string[], intent: CombatVfxIntent): CombatVfxKey | null {
    if (has(tags, "Heal")) return "heal";
    if (has(tags, "Barrier") || has(tags, "Shield")) return "shield";
    if (has(tags, "Reflect")) return "reflect";
    if (has(tags, "Absorb")) return "absorb";
    if (has(tags, "Stun") || has(tags, "Lag") || has(tags, "Overclock")) return "spark";
    if (hasAny(tags, SEAL_TAGS)) return "seal";
    if (has(tags, "Wound")) return "wound";
    if (has(tags, "Ignition")) return "burn";
    if (has(tags, "Poison")) return intent.ground || intent.area ? "poisonCloud" : "poison";
    if (has(tags, "Drain") || has(tags, "Siphon")) return "drain";
    if (has(tags, "Pierce")) return "pierce";
    if (hasAny(tags, DEBUFF_TAGS)) return "debuff";
    if (hasAny(tags, SUPPORT_TAGS)) return "buff";
    return null;
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
        case "jutsu":
            return keyFromTags(tags, intent)
                ?? elementKey(intent.element)
                ?? (intent.heavy ? "heavy" : "impact");
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
