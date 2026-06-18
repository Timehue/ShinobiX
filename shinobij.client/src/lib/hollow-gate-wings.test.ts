import { test } from "node:test";
import assert from "node:assert/strict";
import { generateHollowGateWingRun, wingEntryEffect } from "./hollow-gate-wings";
import type { HollowGateShrineRun } from "../types/character";

const wingRun = (over: Partial<HollowGateShrineRun>): HollowGateShrineRun =>
    ({ wingThemes: { 0: "treasure", 1: "beast", 2: "trial" }, sealedWings: [], committedDetour: null, ...over }) as HollowGateShrineRun;

test("wingEntryEffect: first detour entry commits + seals the other detour", () => {
    const e = wingEntryEffect(wingRun({}), 0);     // enter treasure
    assert.equal(e.blocked, false);
    assert.equal(e.committedTheme, "treasure");
    assert.equal(e.patch?.committedDetour, 0);
    assert.deepEqual(e.patch?.sealedWings, [1]);   // beast sealed, trial untouched
});

test("wingEntryEffect: trial always open and never seals; hub free", () => {
    assert.deepEqual(wingEntryEffect(wingRun({}), 2), { blocked: false });
    assert.equal(wingEntryEffect(wingRun({}), undefined).blocked, false);
});

test("wingEntryEffect: a sealed wing is blocked; committed detour re-enterable", () => {
    const run = wingRun({ sealedWings: [1], committedDetour: 0 });
    assert.equal(wingEntryEffect(run, 1).blocked, true);   // beast sealed
    assert.equal(wingEntryEffect(run, 0).blocked, false);  // treasure (committed) ok
    assert.equal(wingEntryEffect(run, 2).blocked, false);  // trial always
});

test("wingEntryEffect: non-wing (legacy) floor never gates", () => {
    assert.equal(wingEntryEffect({} as HollowGateShrineRun, 0).blocked, false);
});

test("wing floor: hub + treasure/beast/trial; only trial descends; hub is a cut vertex", () => {
    // Content is rolled, so run several times — generateHollowGateWingRun throws
    // on any topology violation (reachability or wings touching), which would
    // fail this test rather than silently shipping a broken floor.
    for (let iter = 0; iter < 25; iter += 1) {
        const run = generateHollowGateWingRun(3, false);

        assert.deepEqual(Object.values(run.wingThemes ?? {}).sort(), ["beast", "treasure", "trial"]);

        const descendIdx = run.tiles.findIndex((t) => t.kind === "descend");
        assert.ok(descendIdx >= 0, "has a descend tile");
        assert.equal(run.wingThemes![run.tiles[descendIdx].wing!], "trial", "descend is in the trial wing");

        assert.ok(run.tiles.some((t) => t.kind === "exit"), "has a Leave tile");

        const spawnIdx = run.playerY * run.width + run.playerX;
        assert.equal(run.tiles[spawnIdx].wing, undefined, "hub spawn cell has no wing");

        // Every non-hub walkable cell (wing room + its private corridor) is tagged.
        const hubRoom = run.tiles[spawnIdx].roomId;
        for (let i = 0; i < run.tiles.length; i += 1) {
            const t = run.tiles[i];
            if (t.terrain === "wall" || t.roomId === hubRoom) continue;
            assert.notEqual(t.wing, undefined, `non-hub walkable tile ${i} should belong to a wing`);
        }
    }
});

test("wing floor: final floor puts the Warden boss in the trial wing, no descend", () => {
    const run = generateHollowGateWingRun(5, true);
    const bossIdx = run.tiles.findIndex((t) => t.kind === "boss");
    assert.ok(bossIdx >= 0, "final floor has a boss");
    assert.equal(run.wingThemes![run.tiles[bossIdx].wing!], "trial");
    assert.equal(run.tiles.findIndex((t) => t.kind === "descend"), -1, "no descend on the final floor");
});

test("wing floor: treasure has chests, beast has elites", () => {
    // Statistical-ish: across runs the treasure wing should hold chests and the
    // beast wing should hold elites (their defining content).
    let sawChestInTreasure = false;
    let sawEliteInBeast = false;
    for (let iter = 0; iter < 15 && (!sawChestInTreasure || !sawEliteInBeast); iter += 1) {
        const run = generateHollowGateWingRun(4, false);
        const themeOf = (wing?: number) => (wing === undefined ? undefined : run.wingThemes![wing]);
        for (const t of run.tiles) {
            if (t.kind === "chest" && themeOf(t.wing) === "treasure") sawChestInTreasure = true;
            if (t.kind === "elite" && themeOf(t.wing) === "beast") sawEliteInBeast = true;
        }
    }
    assert.ok(sawChestInTreasure, "treasure wing holds chests");
    assert.ok(sawEliteInBeast, "beast wing holds elites");
});
