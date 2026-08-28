import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pairedShowdownOpponentId, showdownLaneFacing, showdownSlotLane } from "../lib/pet-showdown-facing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "PetShowdownBattle.tsx"), "utf8");
const modelSource = readFileSync(join(here, "PetModel3D.tsx"), "utf8");

test("Showdown lane fallbacks are reciprocal rather than camera-biased", () => {
    assert.deepEqual(showdownLaneFacing("player"), [0, -1]);
    assert.deepEqual(showdownLaneFacing("enemy"), [0, 1]);
});

test("mirrored Showdown formations expose their physical horizontal lanes", () => {
    assert.deepEqual(
        [showdownSlotLane(0, 2, "player"), showdownSlotLane(1, 2, "player")],
        [-0.5, 0.5],
    );
    assert.deepEqual(
        [showdownSlotLane(0, 2, "enemy"), showdownSlotLane(1, 2, "enemy")],
        [0.5, -0.5],
    );
});

test("resting Showdown fighters pair by physical lane instead of crossing sightlines", () => {
    const players = ["player-0", "player-1", "player-2"];
    const enemies = ["enemy-0", "enemy-1"];
    assert.equal(pairedShowdownOpponentId("player-0", players, enemies, "player"), "enemy-1");
    assert.equal(pairedShowdownOpponentId("player-1", players, enemies, "player"), "enemy-0");
    assert.equal(pairedShowdownOpponentId("player-2", players, enemies, "player"), "enemy-0");
    assert.equal(pairedShowdownOpponentId("enemy-0", enemies, players, "enemy"), "player-2");
    assert.equal(pairedShowdownOpponentId("enemy-1", enemies, players, "enemy"), "player-0");
    assert.equal(pairedShowdownOpponentId("player-0", players, [], "player"), null);

    const twoPlayers = players.slice(0, 2);
    assert.equal(pairedShowdownOpponentId("player-0", twoPlayers, enemies, "player"), "enemy-1");
    assert.equal(pairedShowdownOpponentId("player-1", twoPlayers, enemies, "player"), "enemy-0");
    assert.equal(pairedShowdownOpponentId("enemy-0", enemies, twoPlayers, "enemy"), "player-1");
    assert.equal(pairedShowdownOpponentId("enemy-1", enemies, twoPlayers, "enemy"), "player-0");
});

test("the live Showdown renderer wires the paired target through the final model frame", () => {
    assert.doesNotMatch(source, /RESTING_TURN/, "camera-biased idle facing must not return");
    assert.match(source, /showdownSlotLane\(i, count, side\) \* SLOT_SPACING/);
    assert.match(source, /restingTargetId=\{pairedShowdownOpponentId\(/);
    assert.match(source, /resolveOpponentFacing\(stand\[0\], stand\[2\], restingTarget\[0\], restingTarget\[2\]/);
    assert.match(source, /lockTargetFacing: true/);
});

test("3v3 formations pair every visible lane reciprocally", () => {
    const players = ["player-left", "player-centre", "player-right"];
    const enemies = ["enemy-right", "enemy-centre", "enemy-left"];
    assert.deepEqual(
        players.map((id) => pairedShowdownOpponentId(id, players, enemies, "player")),
        ["enemy-left", "enemy-centre", "enemy-right"],
    );
    assert.deepEqual(
        enemies.map((id) => pairedShowdownOpponentId(id, enemies, players, "enemy")),
        ["player-right", "player-centre", "player-left"],
    );
});

test("the entire 3D fighter performance follows the hit-stop-aware presentation clock", () => {
    assert.match(modelSource, /const presentationDelta = f\.timeline === undefined \? delta : animationDelta/);
    assert.match(modelSource, /const gaitPhase = timeline \* gait/);
    assert.match(modelSource, /uniform\.time\.value = timeline/);
    assert.match(modelSource, /const deformBlend = 1 - Math\.exp\(-presentationDelta \* 18\)/);
    assert.doesNotMatch(modelSource, /Math\.min\(1, delta \* (?:turnRate|8|11|12|13|15)/);
    assert.match(source, /entranceAt = useRef<number \| null>\(null\)/);
    assert.match(source, /timeline\.current - entranceAt\.current/);
    assert.doesNotMatch(source, /now - entranceAt\.current/);
});

test("identity-authored presentation clips are routed through every Colosseum performance state", () => {
    assert.match(modelSource, /findClip\(clips, \["victory", "idle", "walk"\]\)/);
    assert.match(modelSource, /findClip\(clips, \["entrance", "gallop_jump", "idle"\]\)/);
    assert.match(modelSource, /frame\.casting \? findClip\(clips, \["cast", "attack"\]\)/);
    assert.match(modelSource, /findClip\(clips, \["guard", "idle", "walk", "swimming_normal"\]\)/);
    assert.match(modelSource, /findClip\(clips, \["rest", "idle", "walk", "swimming_normal"\]\)/);
    assert.match(source, /f\.casting = frac < 0\.84/);
    assert.match(source, /f\.casting = ev\.delivery !== "melee" && frac < 0\.84/);
});
