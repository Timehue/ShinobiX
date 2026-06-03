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

import type { PetVfxKey } from "../types/pet-battle";
import { vfxBurstForEvent, type VfxBurstSpec } from "./pet-vfx-particles";

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
