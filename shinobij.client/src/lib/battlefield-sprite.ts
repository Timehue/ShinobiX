/*
 * Battlefield sprite geometry — the JS-side mirror of the sprite box that
 * styles/index/37-battlefield-actors.css paints inside each actor anchor.
 *
 * The battle screens position a FIXED-size `.avatar-orb` anchor per fighter and
 * hang everything else off it: movement, targeting, board scaling, and the
 * floating HP badge. Player pins stay inside that anchor, but AI body art is
 * drawn taller than it and pinned near its bottom, so a sprite always overflows
 * the anchor UPWARD — which is why an overlay pinned to the anchor's top edge
 * lands on the fighter's head instead of above it.
 *
 * This module lives apart from BattlefieldActor.tsx so the component file keeps
 * exporting only its component (react-refresh), and so the numbers have one home.
 */

import { isImageAvatar } from "./avatar";

export type BattlefieldSpriteKind = "humanoid" | "quadruped" | "flying" | "serpentine" | "boss" | "construct";

// Mirrors `.battlefield-actor-sprite` and its per-kind overrides. `heightPct` is
// the sprite box height as a percentage of the anchor; `bottomPx` is the CSS
// `bottom` offset (negative = the art hangs below the anchor's feet).
// `battlefield-sprite.test.ts` parses the stylesheet and fails if these drift
// apart.
const SPRITE_BOX: Record<BattlefieldSpriteKind, { heightPct: number; bottomPx: number }> = {
    humanoid: { heightPct: 136, bottomPx: -3 },
    quadruped: { heightPct: 126, bottomPx: -2 },
    flying: { heightPct: 146, bottomPx: 0 },
    serpentine: { heightPct: 154, bottomPx: -3 },
    boss: { heightPct: 158, bottomPx: -3 },
    construct: { heightPct: 154, bottomPx: -3 },
};

export function inferSpriteKind(src: string): BattlefieldSpriteKind {
    if (/forest-hawk/i.test(src)) return "flying";
    if (/(moon-serpent|leviathan)/i.test(src)) return "serpentine";
    if (/(wild-boar|wolf|lizard|panther|bear|chakra-beast|warren-alpha|hollow-hound)/i.test(src)) return "quadruped";
    if (/golem/i.test(src)) return "construct";
    if (/(apex-|boss-|ravager|armored|spectral|worldstorm|drake|oni|gate-heir|mirror-shard)/i.test(src)) return "boss";
    return "humanoid";
}

/**
 * How far (in board px) a full-body sprite's art rises ABOVE the top edge of the
 * `orbSize` actor anchor. Zero for marker-rendered actors (player pins, emoji
 * fallbacks, missing art), whose portrait stays inside the anchor.
 *
 * Purely a layout query — it changes nothing about the actor itself. Callers add
 * it to whatever offset they already use for an above-the-head overlay. If the
 * sprite image 404s the actor falls back to a marker and this over-reports by a
 * few px, which reads as a slightly high badge rather than a covered face.
 */
export function battlefieldSpriteHeadroom(
    orbSize: number,
    sprite?: string | null,
    spriteKind?: BattlefieldSpriteKind,
): number {
    if (!sprite || !isImageAvatar(sprite)) return 0;
    const box = SPRITE_BOX[spriteKind ?? inferSpriteKind(sprite)];
    return Math.max(0, (box.heightPct / 100) * orbSize - orbSize + box.bottomPx);
}
