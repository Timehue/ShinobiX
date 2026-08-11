/*
 * Pet Showdown glyph registry — kept in its own (component-free) module so the
 * data export doesn't trip react-refresh's "only export components" rule.
 *
 * Deliberately SEPARATE from GameIcon/icon-names: GameIcon is imported by
 * MobileNav and MobileStatusHUD, which sit on the entry path under a 640 KB
 * budget. Pet Showdown is a lazy route, so its glyphs ride that chunk and cost
 * the startup graph nothing. The two sets share authoring conventions (24x24,
 * currentColor, filled silhouettes) so they read as one family.
 */
export type ShowdownIconName =
    // ── Element crests (small sizes; >=48px uses the painted WebP) ──────────
    | "elem-fire"
    | "elem-water"
    | "elem-wind"
    | "elem-lightning"
    | "elem-earth"
    | "elem-none"
    // ── Move kinds: offense ────────────────────────────────────────────────
    | "strike"     // damage
    | "crush"      // crush
    | "rend"       // wound
    | "siphon"     // lifesteal
    | "pyre"       // burn, dot
    // ── Move kinds: control ────────────────────────────────────────────────
    | "bind"       // stun
    | "frost"      // freeze
    | "daze"       // confuse
    | "drag"       // slow, movelock, pull, push
    | "mark"       // mark
    | "provoke"    // taunt
    // ── Move kinds: support ────────────────────────────────────────────────
    | "mend"       // heal
    | "aegis"      // guard, shield — a held object, flat soak
    | "veil"       // barrier, absorb — a field over you
    // ── Stances and menu actions ───────────────────────────────────────────
    | "breath"     // rest
    | "rotate"     // switch
    | "brace"      // hold the line
    | "signature"  // the meter move
    | "scroll"     // the Skill menu row
    | "caret-back" // every "back / undo" affordance
    // ── Status modifiers ───────────────────────────────────────────────────
    | "wax"        // buff
    | "wane"       // debuff
    | "steadfast"  // immune to stun/freeze
    | "haste"      // haste, move
    // ── HUD chrome ─────────────────────────────────────────────────────────
    | "cursor"     // the kunai selection caret
    | "fast"       // playback speed
    | "sound-on"
    | "sound-off"
    | "flag"       // forfeit
    | "ko-stamp"
    | "bench"
    | "action-lost" // loses its next action
    | "veiled"      // the enemy's intent is unknown
    | "mvp"
    | "hp"
    | "stamina";
