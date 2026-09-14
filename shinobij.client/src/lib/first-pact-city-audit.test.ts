import assert from "node:assert/strict";
import test from "node:test";

import {
    FIRST_PACT_ARCHITECTURE,
    FIRST_PACT_CITY_PROPS,
    FIRST_PACT_KENNEL_STRUCTURES,
    FIRST_PACT_NPCS,
    FIRST_PACT_PLAYER_START,
    findFirstPactPath,
    isFirstPactWalkable,
    type FirstPactRect,
} from "./first-pact-world";

/**
 * A whole-city sweep for the defect classes a district-by-district review keeps
 * turning up. Each of these shipped at least once and was found by eye rather
 * than by a test, which is the reason this file exists.
 */

type Piece = { id: string; bounds: FirstPactRect };
const allPieces: Piece[] = [
    ...FIRST_PACT_ARCHITECTURE.map((p) => ({ id: p.id, bounds: p.bounds })),
    ...FIRST_PACT_KENNEL_STRUCTURES.map((p) => ({ id: p.id, bounds: p.bounds })),
    ...FIRST_PACT_CITY_PROPS.map((p) => ({ id: p.id, bounds: p.bounds })),
];

const overlap = (a: FirstPactRect, b: FirstPactRect) => ({
    x: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    y: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
});

test("nothing the city places reaches past the ground the city renders", () => {
    // renderWorld clips to these two rectangles. Anything outside them is drawn
    // and then sliced off mid-shape, which is how a paddock ended up cut in half
    // by the shelf edge.
    const insideCity = (x: number, y: number) =>
        (x >= 3 && x <= 81 && y >= 1 && y <= 53) || (x >= 32 && x <= 57 && y >= 53 && y <= 56);
    for (const piece of allPieces) {
        const b = piece.bounds;
        for (const [x, y] of [
            [b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height],
        ] as const) {
            assert.ok(
                insideCity(x, y),
                `${piece.id} reaches ${x},${y}, outside the rendered city: the rim will slice it`,
            );
        }
    }
});

test("props overlap a building only where the district authored them to", () => {
    // A prop resting against a working frontage is deliberate. A prop that has
    // drifted into a wall is not, and only ever reads as a mistake.
    const authored = new Set([
        "stable-tack-annex|stable-hay-cart",
        "handler-lodge|stable-trough",
        "stable-tack-annex|stable-trough",
        "gateworks-pump-house|gateworks-store-crates",
    ]);
    const solids = [...FIRST_PACT_ARCHITECTURE, ...FIRST_PACT_KENNEL_STRUCTURES];
    const found: string[] = [];
    for (const solid of solids) {
        for (const prop of FIRST_PACT_CITY_PROPS) {
            const o = overlap(solid.bounds, prop.bounds);
            if (o.x <= .05 || o.y <= .05) continue;
            const key = `${solid.id}|${prop.id}`;
            if (!authored.has(key)) found.push(`${key} (${o.x.toFixed(2)}x${o.y.toFixed(2)} tiles)`);
        }
    }
    assert.deepEqual(found, [], `props have drifted into buildings:\n${found.join("\n")}`);
});

test("two buildings never occupy the same ground", () => {
    const solids = [...FIRST_PACT_ARCHITECTURE, ...FIRST_PACT_KENNEL_STRUCTURES];
    const found: string[] = [];
    for (let i = 0; i < solids.length; i += 1) {
        for (let j = i + 1; j < solids.length; j += 1) {
            const o = overlap(solids[i].bounds, solids[j].bounds);
            if (o.x > .05 && o.y > .05) found.push(`${solids[i].id} x ${solids[j].id}`);
        }
    }
    assert.deepEqual(found, [], `buildings share ground:\n${found.join("\n")}`);
});

test("every landmark can be walked up to, and every citizen can be reached", () => {
    for (const prop of FIRST_PACT_CITY_PROPS) {
        const b = prop.bounds;
        const x0 = Math.floor(b.x) - 1, x1 = Math.ceil(b.x + b.width);
        const y0 = Math.floor(b.y) - 1, y1 = Math.ceil(b.y + b.height);
        let beside = false;
        for (let x = x0; x <= x1 && !beside; x += 1) beside = isFirstPactWalkable(x, y0) || isFirstPactWalkable(x, y1);
        for (let y = y0; y <= y1 && !beside; y += 1) beside = isFirstPactWalkable(x0, y) || isFirstPactWalkable(x1, y);
        assert.ok(beside, `${prop.id} has no walkable ground anywhere around it`);
    }
    for (const npc of FIRST_PACT_NPCS) {
        assert.ok(
            isFirstPactWalkable(npc.position.x, npc.position.y),
            `${npc.id} stands on solid ground at ${npc.position.x},${npc.position.y}`,
        );
        assert.ok(
            findFirstPactPath(FIRST_PACT_PLAYER_START, npc.position).length > 0,
            `${npc.id} cannot be reached from the arrival gate`,
        );
    }
});
