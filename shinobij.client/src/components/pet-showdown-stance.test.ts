import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pairedShowdownOpponentId, showdownLaneFacing } from "../lib/pet-showdown-facing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "PetShowdownBattle.tsx"), "utf8");

test("Showdown lane fallbacks are reciprocal rather than camera-biased", () => {
    assert.deepEqual(showdownLaneFacing("player"), [0, -1]);
    assert.deepEqual(showdownLaneFacing("enemy"), [0, 1]);
});

test("resting Showdown fighters are paired with the opposing field slot", () => {
    const players = ["player-0", "player-1", "player-2"];
    const enemies = ["enemy-0", "enemy-1"];
    assert.equal(pairedShowdownOpponentId("player-0", players, enemies), "enemy-0");
    assert.equal(pairedShowdownOpponentId("player-1", players, enemies), "enemy-1");
    assert.equal(pairedShowdownOpponentId("player-2", players, enemies), "enemy-1");
    assert.equal(pairedShowdownOpponentId("enemy-0", enemies, players), "player-0");
    assert.equal(pairedShowdownOpponentId("enemy-1", enemies, players), "player-1");
    assert.equal(pairedShowdownOpponentId("player-0", players, []), null);
});

test("the live Showdown renderer wires the paired target through the final model frame", () => {
    assert.doesNotMatch(source, /RESTING_TURN/, "camera-biased idle facing must not return");
    assert.match(source, /restingTargetId=\{pairedShowdownOpponentId\(/);
    assert.match(source, /resolveOpponentFacing\(stand\[0\], stand\[2\], restingTarget\[0\], restingTarget\[2\]/);
    assert.match(source, /lockTargetFacing: true/);
});
