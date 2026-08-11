/*
 * The move -> painted-effect mapping, kept as a PURE module so it can be unit
 * tested. It used to live inside PetShowdownVfx.tsx next to three.js imports and
 * asset URLs, which made the single most important table in the VFX layer
 * impossible to assert on — and it was wrong in ways nobody could see: 20 of the
 * 25 move kinds ignored the caster's element entirely, five mechanically
 * different kinds shared one explosion, and every signature collapsed onto the
 * same sprite.
 */
/** Element tints. Every burst is tinted by the caster's element, which is what
 *  makes a Fire stun and a Water stun different objects — 20 of the 25 move
 *  kinds used to ignore element completely, so 80% of the game's moves painted
 *  the same grey-white sprite whatever cast them. */
export const VFX_ELEMENT_TINT: Record<string, string> = {
    Fire: "#ff8a45", Water: "#4fc3f7", Wind: "#7ff0d4",
    Lightning: "#ffe066", Earth: "#d8a86a", None: "#c9b8ff",
};

export function vfxElementTint(element: string): string {
    return VFX_ELEMENT_TINT[element] ?? VFX_ELEMENT_TINT.None;
}

/** Which painted frame set a move detonates.
 *
 *  KIND chooses the shape, because the shape is what the move DOES; element is
 *  carried by the tint (above) rather than by swapping the sprite. Previously
 *  this was a kind-first ladder that fell through to the element only for plain
 *  damage, so five mechanically different kinds (damage / crush / push / pull /
 *  and, absurdly, REST) all detonated the caster's element explosion — a Fire
 *  pet catching its breath set off a fireball on its own head.
 *
 *  `superCast` no longer short-circuits: a signature keeps its kind's silhouette
 *  and the caller layers the kaboom over it, so a lifesteal finisher and a pure
 *  damage finisher are no longer the same frame. */
export function impactFlipbookKey(element: string, moveKind: string, superCast: boolean): string {
    switch (moveKind) {
        // Rest detonates NOTHING. It is self-recovery: the stamina bar and the
        // cue carry it, and the caller skips the spawn on an empty key. This
        // used to fall through to the element branch, so a Fire pet catching
        // its breath set off a fireball on its own head.
        case "rest": return "";
        case "guard": return "eshield";
        case "heal": return "heal";
        case "burn": case "dot": return "burn";
        case "wound": return "poison";
        case "freeze": return "ice";
        case "lifesteal": return "blood";
        case "debuff": return "shadow";
        // Split apart: a stolen turn must not look like an order change.
        case "confuse": return "vortex";
        case "slow": case "movelock": return "magma";
        case "stun": return "spark";
        case "mark": return "power";
        case "taunt": return "aura";
        case "buff": return "buff";
        case "haste": case "move": return "charge";
        case "shield": case "barrier": case "absorb": return "eshield";
        // Offense: crush lands heavier, shoves land as blunt contact.
        case "crush": return "bighit";
        case "push": case "pull": return "impact";
        default: break;
    }
    if (superCast) return "explosion";
    const el = element.toLowerCase();
    if (el === "fire" || el === "water" || el === "earth" || el === "wind" || el === "lightning") return el;
    return "none";
}
