/*
 * Guards the "every figure on a sector board is one size" rule.
 *
 * Four components draw a figure on the 12x12 sector grid, and they had each
 * grown their own FIGURE_W/FIGURE_H pair: on a phone the player came out at
 * 0.58 tiles, another player at 0.756, a wandering AI at 0.52 and the boss at
 * 0.90 — so the person you were playing as was the smallest real figure on the
 * board. Nothing caught it, because nothing tied the four numbers together.
 *
 * These tests are that tie. They assert the shared geometry resolves to one box
 * for every non-boss actor, and that no sector actor re-declares its own size
 * constants or re-introduces the anchoring split that planted peers ~0.4 tiles
 * below everyone else.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    SECTOR_BOSS_SCALE,
    SECTOR_MARKER_ANCHOR,
    SECTOR_MARKER_H,
    SECTOR_MARKER_W,
    SECTOR_RING_AI,
    SECTOR_RING_PEER,
    SECTOR_RING_SELF,
    sectorMarkerBox,
} from "./sector-marker";

const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "components");
const read = (file: string) => readFileSync(join(componentsDir, file), "utf8");

/** Every component that draws a figure standing on the sector grid. */
const SECTOR_ACTORS = [
    "SectorAvatar.tsx",
    "SectorPeers.tsx",
    "SectorWanderer.tsx",
    "SectorWeeklyBossActor.tsx",
] as const;

test("the player, other players and wandering AI share one figure box", () => {
    const tile = 28.08; // a 360px-wide phone: the size at which the drift was worst
    const player = sectorMarkerBox(tile);
    const peer = sectorMarkerBox(tile);
    const wanderer = sectorMarkerBox(tile);

    assert.deepEqual(peer, player, "another player must be exactly your size");
    assert.deepEqual(wanderer, player, "a wandering AI must be exactly your size");
    assert.equal(player.w, tile * SECTOR_MARKER_W);
});

test("the boss is the one deliberate exception, and it is bigger", () => {
    const tile = 28.08;
    const boss = sectorMarkerBox(tile, SECTOR_BOSS_SCALE);
    assert.ok(SECTOR_BOSS_SCALE > 1, "the boss is meant to loom");
    assert.equal(boss.w, sectorMarkerBox(tile).w * SECTOR_BOSS_SCALE);
});

test("the figure box is tall enough for the pin tip to land on the tile centre", () => {
    // .sector-avatar-pin hangs 30% of the circle below it. If the box were any
    // shorter the tip would sit below the box, and BASE_ANCHOR would plant the
    // marker off its own tile.
    assert.equal(Number((SECTOR_MARKER_H / SECTOR_MARKER_W).toFixed(4)), 1.3);
});

test("no sector actor declares its own figure size", () => {
    for (const file of SECTOR_ACTORS) {
        const source = read(file);
        assert.doesNotMatch(
            source,
            /const\s+FIGURE_[WH]\s*=/u,
            `${file} must size itself through lib/sector-marker, not a local constant`,
        );
        assert.match(
            source,
            /from "\.\.\/lib\/sector-marker"/u,
            `${file} must import the shared marker geometry`,
        );
    }
});

test("every sector actor plants its pin tip on the tile centre", () => {
    assert.equal(SECTOR_MARKER_ANCHOR, 100, "the box BASE is the ground contact point");
    for (const file of SECTOR_ACTORS) {
        const source = read(file);
        // The bug this replaces: peers used `translate(-50%, -50%)`, centring the
        // portrait on the tile instead of planting the pin, so they stood ~0.4
        // tiles lower than everyone else on the same tile.
        assert.doesNotMatch(
            source,
            /translate\(-50%,\s*-50%\)/u,
            `${file} must anchor by the pin tip, not by the figure's middle`,
        );
    }
});

test("identity is carried by the ring colour, not by size", () => {
    const rings = new Set([SECTOR_RING_SELF, SECTOR_RING_PEER, SECTOR_RING_AI]);
    assert.equal(rings.size, 3, "you, another player and AI must be tellable apart");

    assert.match(read("SectorAvatar.tsx"), /SECTOR_RING_SELF/u);
    assert.match(read("SectorPeers.tsx"), /SECTOR_RING_PEER/u);
    assert.match(read("SectorWanderer.tsx"), /SECTOR_RING_AI/u);
    assert.match(read("SectorWeeklyBossActor.tsx"), /SECTOR_RING_AI/u);
});

test("peers no longer carry chrome that inflates their painted footprint", () => {
    const source = read("SectorPeers.tsx");
    // `.other-player-map-avatar` paints a 2px red outline OUTSIDE the border box
    // plus a glow, which made another player 1.55x your painted width even before
    // their disc was bigger than yours. `.tiny-map-avatar` is the shared class
    // (combat orbs, arena hexes) whose `width: 88%` was the second multiplication.
    // Matched on the className attribute only — the file's own comments explain
    // both classes by name, and explaining them is not applying them.
    const classNames = [...source.matchAll(/className="([^"]*)"/gu)].map((m) => m[1]);
    assert.ok(classNames.length > 0, "expected to find className attributes to check");
    for (const value of classNames) {
        assert.doesNotMatch(value, /other-player-map-avatar/u);
        assert.doesNotMatch(value, /tiny-map-avatar/u);
    }
});
