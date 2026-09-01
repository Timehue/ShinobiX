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

/** Every move kind the Showdown engine can put on an action event, including
 * the two synthesized commands. Keeping the presentation list exported makes
 * missing VFX a test failure instead of a silent generic fallback. */
export const SHOWDOWN_MOVE_VFX_KINDS = [
    "damage", "crush", "lifesteal", "push", "pull", "pivot",
    "dot", "burn", "wound", "stun", "freeze", "confuse", "debuff",
    "mark", "slow", "movelock", "buff", "haste", "move", "shield",
    "barrier", "absorb", "taunt", "heal", "weather", "protect",
    "guard", "rest",
] as const;

/** A unique motion grammar per mechanic. Element supplies color/material;
 * family supplies silhouette and movement, so readability never depends on
 * hue alone. */
export type MoveAccentFamily =
    | "impact" | "slam" | "siphon" | "repulse" | "vacuum" | "pivot"
    | "toxin" | "embers" | "wound" | "stun" | "freeze" | "confuse"
    | "hex" | "mark" | "slow" | "bind" | "buff" | "haste" | "step"
    | "shield" | "barrier" | "absorb" | "taunt" | "heal" | "weather"
    | "protect" | "guard" | "rest";

const MOVE_ACCENT_FAMILY: Record<string, MoveAccentFamily> = {
    damage: "impact",
    crush: "slam",
    lifesteal: "siphon",
    push: "repulse",
    pull: "vacuum",
    pivot: "pivot",
    dot: "toxin",
    burn: "embers",
    wound: "wound",
    lacerate: "wound",
    stun: "stun",
    freeze: "freeze",
    confuse: "confuse",
    debuff: "hex",
    mark: "mark",
    slow: "slow",
    movelock: "bind",
    buff: "buff",
    haste: "haste",
    move: "step",
    shield: "shield",
    barrier: "barrier",
    absorb: "absorb",
    taunt: "taunt",
    heal: "heal",
    weather: "weather",
    protect: "protect",
    guard: "guard",
    rest: "rest",
};

export function moveAccentFamily(kind: string): MoveAccentFamily | null {
    return MOVE_ACCENT_FAMILY[String(kind ?? "").toLowerCase()] ?? null;
}

/** Stable per-technique art direction. Same-kind techniques share a readable
 * grammar but receive one of four rotations/cadences from their authored name,
 * so a whole catalog does not look like one cloned effect. */
export function moveAccentVariant(moveName: string): 0 | 1 | 2 | 3 {
    let hash = 2166136261;
    for (const ch of String(moveName ?? "")) {
        hash ^= ch.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 4 as 0 | 1 | 2 | 3;
}

/** Windup paint is mechanic-aware. Previously every melee move gathered the
 * same aura and every ranged move gathered the same charge, erasing a move's
 * intent before it even left the caster. */
export function castFlipbookKey(moveKind: string, delivery: string): string {
    switch (String(moveKind ?? "").toLowerCase()) {
        case "rest": return "";
        case "guard": case "protect": return "eshield";
        case "heal": return "heal";
        case "shield": case "barrier": return "shield";
        case "absorb": return "vortex";
        case "buff": return "buff";
        case "haste": case "move": return "charge";
        case "weather": return "aura";
        case "taunt": case "mark": return "power";
        case "debuff": return "shadow";
        case "slow": case "movelock": case "confuse": return "vortex";
        case "stun": return "spark";
        case "freeze": return "ice";
        case "burn": case "dot": return "burn";
        case "wound": case "lifesteal": return "blood";
        case "crush": return "power";
        case "push": case "pull": case "pivot": return "aura";
        default: return delivery === "ranged" ? "charge" : "aura";
    }
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
        case "guard": case "protect": return "eshield";
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
        case "taunt": return "power";
        case "buff": return "buff";
        case "haste": case "move": return "charge";
        case "weather": return "aura";
        case "shield": case "barrier": case "absorb": return "eshield";
        // Offense: crush lands heavier, shoves land as blunt contact.
        case "crush": return "bighit";
        case "push": case "pull": return "impact";
        case "pivot": return "slash";
        default: break;
    }
    if (superCast) return "explosion";
    const el = element.toLowerCase();
    if (el === "fire" || el === "water" || el === "earth" || el === "wind" || el === "lightning") return el;
    return "none";
}
