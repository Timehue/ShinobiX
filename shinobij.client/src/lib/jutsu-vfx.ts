/*
 * Jutsu-combat VFX mapping — pure helpers that turn a cast jutsu into a
 * cosmetic particle burst for the main Arena hex battlefield (PvE / AI / story
 * boss / raid). It REUSES the pet arena's particle engine (PetParticleField)
 * and burst-spec mapper (vfxBurstForEvent) so the two battle systems share one
 * tested "juice" layer; this module only adds the jutsu element → palette
 * mapping and the cast → beat selection on top.
 *
 * IMPORTANT: cosmetic-only. The main Arena combat is computed client-side with
 * NO ranked replay / determinism constraint (unlike the pet sim and live PvP),
 * so nothing here can affect balance, rewards, or outcomes. Pure + node-testable;
 * must NOT import from ../App.
 */

import type { PetVfxKey, PetBattleAnimationEventType } from "../types/pet-battle";
import type { Jutsu } from "../types/combat";
import { vfxBurstForEvent, type VfxBurstSpec } from "./pet-vfx-particles";
import { tagMatchesName } from "./tags";

/**
 * Map a jutsu element to a particle-palette key. Covers the five core natures
 * plus the starter bloodline natures (Blood / Lava / Shadow / Iron), each of
 * which reuses the closest existing palette so no new color work is needed:
 *   Lava → fire, Iron → earth, Blood → blood, Shadow → shadow.
 * "None"/neutral falls back to the cyan "chakra" shimmer.
 */
export function jutsuElementVfxKey(element?: string | null): PetVfxKey {
    switch (String(element ?? "").toLowerCase()) {
        case "fire": return "fire";
        case "water": return "water";
        case "wind": return "wind";
        case "lightning": return "lightning";
        case "earth": return "earth";
        case "lava": return "fire";
        case "blood": return "blood";
        case "shadow": return "shadow";
        case "iron": return "earth";
        default: return "chakra";
    }
}

export type JutsuVfxInput = {
    /** The cast jutsu's element (incl. bloodline natures). */
    element?: string | null;
    /** Self-buff / heal / shield cast → particles gather IN on the caster. */
    selfCast?: boolean;
    /** Big hit (caller passes damage ≳ 18% of the target's max HP) → denser burst. */
    heavy?: boolean;
    /** The blow that ends the fight → KO-scale burst. */
    isKO?: boolean;
};

/**
 * The particle burst spec for one jutsu cast. Offensive / debuff casts land an
 * "impact" burst at the target tile; self-support casts use the rising "charge"
 * gather on the caster. Heavy hits and KOs amplify the burst (reusing the pet
 * mapper's crit / KO scaling). Returns the shared VfxBurstSpec the canvas
 * engine consumes; never returns a "none" spec for a known cast.
 */
export function jutsuVfxBurst(input: JutsuVfxInput): VfxBurstSpec {
    const vfxKey = jutsuElementVfxKey(input.element);
    const type = input.selfCast ? "charge" : "impact";
    return vfxBurstForEvent({ type, vfxKey }, { crit: !!input.heavy, isKO: !!input.isKO });
}

// ── Sprite-sheet selection ───────────────────────────────────────────────────
// The element-only sprite pick made every cast read the same: a self-buff, a
// debuff, a DoT and a physical blow all flashed the caster's element explosion
// on the target. These pure helpers pick the bundled fx/<key>/ folder by the
// cast's INTENT (damage / DoT / control / support), DISCIPLINE (nin/gen/tai/buki)
// and ELEMENT (incl. the bloodline natures Lava/Blood/Shadow/Iron, which ride on
// jutsu.element at runtime). The key is fed straight to bundledJutsuFxFrames();
// an empty key means "no sprite — particle burst only". Cosmetic, node-testable.

/** A resolved sprite pick: the fx folder key + an optional tint variant class. */
export type FxSpritePick = { key: string; variant?: string };

// The three intent gates below MIRROR App.tsx's isSelfSupportJutsu /
// isControlJutsu / isPressureJutsu (same tag sets) — keep them in sync. They live
// here too so this module stays self-contained and importable from the node test
// runner (jutsu-vfx.ts must never import from ../App).
const SELF_SUPPORT_TAGS = new Set([
    "Heal", "Shield", "Barrier", "Reflect", "Absorb",
    "Decrease Damage Taken", "Debuff Prevent", "Stun Prevent",
]);
const CONTROL_TAGS = [
    "Stun", "Bloodline Seal", "Seal", "Elemental Seal",
    "Decrease Damage Given", "Increase Damage Taken",
    "Buff Prevent", "Cleanse Prevent", "Clear Prevent", "Lag",
];
const PRESSURE_TAGS = ["Ignition", "Wound", "Poison", "Drain", "Siphon"];

type JutsuFxJutsu = Pick<Jutsu, "element" | "type" | "target" | "tags">;

function isSelfSupport(j: JutsuFxJutsu): boolean {
    return j.target === "SELF" || (j.tags ?? []).some((t) => SELF_SUPPORT_TAGS.has(t.name));
}
function isControl(j: JutsuFxJutsu): boolean {
    return j.target !== "SELF" && (j.tags ?? []).some((t) => CONTROL_TAGS.some((n) => tagMatchesName(t.name, n)));
}
function isPressure(j: JutsuFxJutsu): boolean {
    return j.target !== "SELF" && (j.tags ?? []).some((t) => PRESSURE_TAGS.some((n) => tagMatchesName(t.name, n)));
}

/**
 * Pick the main-Arena sprite-sheet for a cast jutsu. Priority: KO finisher →
 * self/support → control/lock → DoT/pressure → element/discipline damage.
 * `heavy` (big hit) upgrades a plain neutral/physical blow to the heavy starburst
 * (element identity is preserved — elemental sprites already read big, and the
 * particle layer densifies on `heavy` regardless). Returns `{ key: "" }` to mean
 * "no sprite — fall back to the particle burst".
 */
export function jutsuFxSpriteKey(
    jutsu: JutsuFxJutsu,
    opts: { heavy?: boolean; isKO?: boolean } = {},
): FxSpritePick {
    if (opts.isKO) return { key: "kaboom" };

    const tags = jutsu.tags ?? [];
    const has = (name: string) => tags.some((t) => tagMatchesName(t.name, name));
    const el = String(jutsu.element ?? "").toLowerCase();
    const physical = jutsu.type === "Taijutsu" || jutsu.type === "Bukijutsu";

    // Self / support — heal, shield/absorb dome, or generic buff aura.
    if (isSelfSupport(jutsu)) {
        if (has("Heal")) return { key: "heal", variant: "fx-heal" };
        if (has("Shield") || has("Barrier") || has("Absorb") || has("Reflect")) {
            return { key: el === "water" || el === "earth" ? "shield" : "eshield" };
        }
        // A self power-up wears the big soul aura; an outward-cast ward / prevent
        // uses the lighter sparkle so the two read differently.
        return { key: jutsu.target === "SELF" ? "aura" : "buff" }; // buff, ↓DmgTaken, prevents
    }

    // Control — stun crackle, else a shadow wrap for seals / stat-downs / lag.
    if (isControl(jutsu)) {
        if (has("Stun")) return { key: "spark" };
        return { key: "shadow" };
    }

    // Pressure / DoT — ignition burn, blood wound, poison cloud, drain vortex.
    if (isPressure(jutsu)) {
        if (has("Ignition")) return { key: "burn" };
        if (has("Wound")) return { key: "blood" };
        if (has("Poison")) return { key: "poison", variant: "fx-poison" };
        if (has("Drain") || has("Siphon")) return { key: "vortex" };
    }

    // Damage (default) — bloodline natures first, then element / discipline.
    let key: string;
    if (el === "lava") key = "magma";
    else if (el === "blood") key = "blood";
    else if (el === "shadow") key = "shadow";
    else if (el === "iron") key = "bighit";
    else if (el === "fire" || el === "water" || el === "earth" || el === "wind" || el === "lightning") key = el;
    else if (physical) key = "slash";
    else key = "impact"; // None-element nin/gen → neutral shockwave

    // Heavy hit upgrades only the plain neutral/physical keys to the starburst,
    // so a heavy Fire blast still reads as fire (its sprite is already big).
    if (opts.heavy && (key === "slash" || key === "impact")) key = "bighit";
    return { key };
}

/**
 * Pick the pet-Arena sprite-sheet for the active animation beat. Mirrors the old
 * inline beat×actionKind ladder but: routes blood/shadow/poison (folders now
 * exist), gives KO and signature casts a cinematic tier, and tints poison green.
 * Returns `{ key: "" }` for beats that should stay particle-only.
 */
export function petFxSpriteKey(input: {
    beat?: PetBattleAnimationEventType;
    actionKind?: string;
    vfxKey?: PetVfxKey;
    signature?: boolean;
    element?: string | null;
    isKO?: boolean;
}): FxSpritePick {
    const { beat, actionKind: ak, vfxKey: vk, signature, isKO } = input;
    const el = String(input.element ?? "").toLowerCase();
    const isHitBeat = beat === "impact" || beat === "beam";

    // KO finisher — the loudest beat, regardless of element.
    if (isKO && isHitBeat) return { key: "kaboom", variant: "fx-signature" };

    // Signature unleash — its own marquee tier (charge wind-up on caster, then an
    // element-heavy flagship hit).
    if (signature) {
        if (beat === "charge") return { key: "charge", variant: "fx-signature" };
        if (isHitBeat) {
            const k =
                el === "fire" ? "kaboom" :
                el === "water" ? "explosion" :
                el === "earth" || el === "iron" ? "bighit" :
                el === "wind" ? "vortex" :
                el === "lightning" ? "spark" :
                "explosion";
            return { key: k, variant: "fx-signature" };
        }
    }

    if (beat === "impact" || beat === "beam" || beat === "statusApply") {
        if (ak === "basic") return { key: "slash" };
        if (vk === "poison") return { key: "poison", variant: "fx-poison" };
        if (vk && vk !== "none" && vk !== "chakra") return { key: vk }; // elemental / blood / shadow hit
        return { key: "" };
    }
    if (beat === "charge") {
        if (ak === "heal") return { key: "heal", variant: "fx-heal" };
        if (ak === "buff") return { key: "buff" };
        return { key: "" };
    }
    if (beat === "guard") return { key: "shield" };
    return { key: "" };
}
