import { test } from "node:test";
import assert from "node:assert/strict";
import { HOLLOW_GATE_FISSURE_BEAT_MS, hollowGateArenaFissures, hollowGateFissureBlocks, hollowGateFissureState } from "./hollow-gate-arena";
import { FISSURE_BEAT_MS, projectHollowGateMovement } from "./hollow-gate-movement-projection";
import { generateHollowGateShrineRun } from "./hollow-gate-dungeon";
import type { HollowGateShrineRun, HollowGateTile } from "../types/character";

// A 9×5 boss chamber: a door on the west wall, the boss on the east side.
//   #########
//   D.......#      D = door (0,1)... player stands in the doorway
//   #......B#
//   #.......#
//   #########
function arena(): HollowGateShrineRun {
    const w = 9, h = 5, tiles: HollowGateTile[] = [];
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const rim = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        const door = x === 0 && y === 1;
        tiles.push({ kind: rim && !door ? "wall" : x === 7 && y === 2 ? "boss" : "empty",
            terrain: door ? "door" : rim ? "wall" : "room_floor", roomId: rim && !door ? null : 0, revealed: false, resolved: false });
    }
    return { width: w, height: h, playerX: 0, playerY: 1, tiles, floor: 5, threat: 0, torch: 10, keys: 0, completed: false };
}

test("one fissure line splits the live boss chamber, leaving the boss and the doorway foothold clear", () => {
    const run = arena();
    const fissures = hollowGateArenaFissures(run);
    assert.deepEqual([...fissures.keys()].sort((a, b) => a - b), [1 * 9 + 4, 2 * 9 + 4, 3 * 9 + 4], "a single crack down the middle column");
    assert.deepEqual([...fissures.values()], [0, 1, 2], "its segments take turns");
    assert.ok(!fissures.has(2 * 9 + 7), "never on the boss");
    assert.ok(!fissures.has(1 * 9 + 1), "the tile inside the doorway is a safe foothold");
    run.tiles[2 * 9 + 7] = { ...run.tiles[2 * 9 + 7], resolved: true };
    assert.equal(hollowGateArenaFissures({ ...run, tiles: run.tiles.slice() }).size, 0, "a defeated boss quiets the chamber");
});

test("each stripe warns, erupts, then cools, and only one stripe erupts per beat", () => {
    const beat = HOLLOW_GATE_FISSURE_BEAT_MS;
    assert.deepEqual([0, 1, 2].map((s) => hollowGateFissureState(s, 0)), ["erupting", "warning", "calm"]);
    assert.deepEqual([0, 1, 2].map((s) => hollowGateFissureState(s, beat)), ["calm", "erupting", "warning"]);
    assert.deepEqual([0, 1, 2].map((s) => hollowGateFissureState(s, beat * 2)), ["warning", "calm", "erupting"]);
});

test("an erupting fissure blocks the step without a server step; a cool one lets you cross", () => {
    const base = { ...arena(), playerX: 3, playerY: 1 };
    // Generated floors carry this stamp; the eager movement check reads it.
    const run = { ...base, arenaFissures: Object.fromEntries(hollowGateArenaFissures(base)) };
    const target = 1 * 9 + 4, stripe = run.arenaFissures[target];
    const eruptingAt = stripe * HOLLOW_GATE_FISSURE_BEAT_MS;
    const calmAt = ((stripe + 2) % 3) * HOLLOW_GATE_FISSURE_BEAT_MS;
    assert.equal(hollowGateFissureBlocks(run, target, eruptingAt), true);
    const blocked = projectHollowGateMovement(run, 1, 0, eruptingAt)!;
    assert.equal(blocked.effect.wallBump, true);
    assert.equal(blocked.effect.step, undefined, "no step reaches the server");
    assert.match(blocked.effect.blockMessage ?? "", /fissure/i);
    const crossed = projectHollowGateMovement(run, 1, 0, calmAt)!;
    assert.equal(crossed.effect.wallBump, false);
    assert.equal(crossed.nextRun.playerX, 4);
});

test("the movement check and the arena share one fissure beat", () => {
    assert.equal(FISSURE_BEAT_MS, HOLLOW_GATE_FISSURE_BEAT_MS);
});

test("generated final floors put fissures in the boss chamber; other floors have none", () => {
    const final = generateHollowGateShrineRun(5, undefined, "arena-seed");
    assert.ok(hollowGateArenaFissures(final).size > 0);
    assert.deepEqual(final.arenaFissures, Object.fromEntries(hollowGateArenaFissures(final)), "the generator stamps the layout");
    const early = generateHollowGateShrineRun(2, undefined, "arena-seed");
    assert.equal(hollowGateArenaFissures(early).size, 0);
});
