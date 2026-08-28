// The HP badge is positioned in JS against an anchor whose ART is sized in CSS.
// `battlefieldSpriteHeadroom` therefore keeps a copy of the sprite box geometry,
// and a copy is only safe if it cannot silently drift: re-tune
// `.battlefield-actor-sprite` in the stylesheet without touching the table and
// every enemy HP bar quietly slides back onto the fighter's face — the exact bug
// this helper exists to fix, and one no unit test would otherwise notice.
//
// So parse the stylesheet and recompute the headroom from it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    battlefieldFacingTowardNearest,
    battlefieldSpriteHeadroom,
    inferSpriteKind,
    type BattlefieldSpriteKind,
} from "./battlefield-sprite";

const actorCss = readFileSync(new URL("../styles/index/37-battlefield-actors.css", import.meta.url), "utf8");

/** Pull one declaration out of the last rule whose selector matches. */
function declIn(selector: string, prop: string): string | null {
    const anchor = actorCss.indexOf(selector);
    assert.ok(anchor >= 0, `37-battlefield-actors.css must still define ${selector}`);
    const body = actorCss.slice(anchor, actorCss.indexOf("}", anchor));
    // Unit is optional so an unsuffixed `bottom: 0` reads as 0 rather than as
    // "not declared" (which would wrongly fall back to the base rule's -3px).
    return body.match(new RegExp(`(?<![-\\w])${prop}:\\s*(-?[\\d.]+)(?:px|%)?`))?.[1] ?? null;
}

const BASE_SELECTOR = ".arena-fullscreen .battlefield-actor-sprite";
const kindSelector = (kind: BattlefieldSpriteKind) =>
    `.arena-fullscreen .battlefield-actor[data-battlefield-sprite-kind="${kind}"] .battlefield-actor-sprite`;

// The base rule is the humanoid geometry; each other kind overrides it.
const KINDS: BattlefieldSpriteKind[] = ["humanoid", "quadruped", "flying", "serpentine", "boss", "construct"];

test("sprite headroom is recomputed from the stylesheet's own box geometry", () => {
    const baseHeight = Number(declIn(BASE_SELECTOR, "height"));
    const baseBottom = Number(declIn(BASE_SELECTOR, "bottom"));
    assert.ok(Number.isFinite(baseHeight) && Number.isFinite(baseBottom), "the base sprite rule must size and pin the art");

    const ORB = 52; // the arena's actor anchor
    for (const kind of KINDS) {
        const heightPct = kind === "humanoid" ? baseHeight : Number(declIn(kindSelector(kind), "height") ?? baseHeight);
        const rawBottom = kind === "humanoid" ? String(baseBottom) : declIn(kindSelector(kind), "bottom");
        const bottomPx = rawBottom === null ? baseBottom : Number(rawBottom);

        // Absolutely positioned at `bottom`, so the art's top edge sits at
        // anchorTop + orb + bottom - height; the overflow above the anchor is
        // whatever is left over.
        const expected = Math.max(0, (heightPct / 100) * ORB - ORB + bottomPx);
        assert.equal(
            battlefieldSpriteHeadroom(ORB, `/assets/${kind}.webp`, kind),
            expected,
            `${kind} sprites overflow the anchor by ${expected}px per the stylesheet, but the helper disagrees — ` +
            "re-sync SPRITE_BOX in BattlefieldActor.tsx or enemy HP bars will sit on the fighter's face",
        );
    }
});

test("marker-rendered actors need no headroom, sprites always do", () => {
    assert.equal(battlefieldSpriteHeadroom(52, null), 0, "a player pin stays inside its anchor");
    assert.equal(battlefieldSpriteHeadroom(52, ""), 0);
    assert.equal(battlefieldSpriteHeadroom(52, "🐺"), 0, "an emoji fallback is not sprite art");

    for (const kind of KINDS) {
        assert.ok(
            battlefieldSpriteHeadroom(52, `/assets/${kind}.webp`, kind) > 0,
            `${kind} art overflows the anchor and must reserve clearance`,
        );
    }
});

test("the sprite kind inferred from a filename drives the clearance", () => {
    // Bosses are the tallest art on the board, so they need the most clearance —
    // the case that reads worst when it is wrong.
    const boss = battlefieldSpriteHeadroom(52, "/assets/clan-boss-ravager-idle.webp");
    const wolf = battlefieldSpriteHeadroom(52, "/assets/hunt-ai-frost-wolf-idle.webp");
    assert.equal(inferSpriteKind("/assets/clan-boss-ravager-idle.webp"), "boss");
    assert.equal(inferSpriteKind("/assets/hunt-ai-frost-wolf-idle.webp"), "quadruped");
    assert.ok(boss > wolf, "a boss must clear more than a low quadruped");
});

test("battlefield sprites face the nearest living opponent", () => {
    const actor = { id: "enemy", side: "enemy" as const, hp: 100, pos: 26 };
    const actors = [
        actor,
        { id: "dead-nearby", side: "squad" as const, hp: 0, pos: 27 },
        { id: "living-right", side: "squad" as const, hp: 100, pos: 28 },
        { id: "enemy-ally", side: "enemy" as const, hp: 100, pos: 25 },
    ];
    assert.equal(battlefieldFacingTowardNearest(actor, actors, 12), "right");
    assert.equal(battlefieldFacingTowardNearest({ ...actor, pos: 29 }, actors, 12), "left");
});

test("nearest-facing follows the real odd-column hex projection", () => {
    // Actor tile 1 is shifted a half-row down. Tile 14 on the right is therefore
    // visually closer than tile 0 on the left even though a square row/column
    // approximation would choose tile 0.
    const actor = { id: "enemy", side: "enemy" as const, hp: 100, pos: 1 };
    const actors = [
        actor,
        { id: "left", side: "squad" as const, hp: 100, pos: 0 },
        { id: "right", side: "squad" as const, hp: 100, pos: 14 },
    ];
    assert.equal(battlefieldFacingTowardNearest(actor, actors, 12), "right");
});

test("vertical and empty matchups hold a deterministic inward pose", () => {
    const leftActor = { id: "left", side: "enemy" as const, hp: 100, pos: 13 };
    const verticalTarget = { id: "target", side: "squad" as const, hp: 100, pos: 37 };
    const rightActor = { ...leftActor, id: "right", pos: 22 };
    assert.equal(battlefieldFacingTowardNearest(leftActor, [leftActor, verticalTarget], 12), "right");
    assert.equal(battlefieldFacingTowardNearest(rightActor, [rightActor], 12), "left");
});

test("the CSS mirror is scoped to the sprite image, not the combat anchor", () => {
    assert.match(
        actorCss,
        /\.battlefield-actor\[data-battlefield-mirrored="true"\] \.battlefield-actor-sprite\s*\{[^}]*transform:\s*translateX\(-50%\) scaleX\(-1\)/s,
    );
    assert.doesNotMatch(
        actorCss,
        /\.battlefield-actor\[data-battlefield-mirrored="true"\]\s*\{[^}]*transform:/s,
        "facing must never transform the authoritative actor anchor or its hitbox",
    );
});
