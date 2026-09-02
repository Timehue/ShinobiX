import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    bucketEvents,
    elementColor,
    explainSquadClash,
    lethalTick,
    sampleActor,
    sampleProjectiles,
    squadFocusAt,
} from "./pet-warfront-rite-presentation";
import type { DuelEvent, DuelResult, DuelSnapshot } from "./pet-duel-sim";

/*
 * `sampleActor` IS the fix for the "jittery" complaint that killed the lane war.
 *
 * That stage floored its playback clock, took the FLOOR snapshot, and then ran
 * an exponential low-pass filter to chase the resulting 30 Hz staircase. At
 * 60fps against a 30 Hz input that filter alternates fast and slow frames and
 * lags two to three frames behind truth, which is what a viewer reads as stutter
 * and skating. These tests pin the replacement: a fractional tick returns the
 * exact interpolated position, with no smoothing anywhere.
 */

const actor = (team: "player" | "enemy", over: Partial<DuelSnapshot["actors"][number]> = {}) => ({
    id: team, team, slot: 0,
    x: 0, y: 0, faceX: 1, faceY: 0,
    hp: 100, maxHp: 100, stamina: 100, state: "idle" as const, statuses: [] as string[],
    ...over,
});

const resultFrom = (snapshots: DuelSnapshot[], events: DuelEvent[] = []): DuelResult => ({
    result: "win", winner: "player", ticks: snapshots.length, snapshots, events,
});

const twoTicks = () => resultFrom([
    { t: 0, actors: [actor("player", { x: 0, y: 0, hp: 100 }), actor("enemy", { x: 10, y: 4 })], projectiles: [] },
    { t: 1, actors: [actor("player", { x: 4, y: 2, hp: 60 }), actor("enemy", { x: 6, y: 0 })], projectiles: [] },
]);

test("Kage Tactics has one position owner, fixed framing, real terrain, and target-locked facing", () => {
    const source = readFileSync(new URL("../components/PetWarfrontRiteStage3D.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../styles/pet-warfront-rite.css", import.meta.url), "utf8");
    assert.doesNotMatch(source, /MathUtils\.damp\(group\.position\./,
        "the renderer must not chase the already-interpolated authoritative path with a second spring");
    assert.match(source, /locomotionActive\.current/,
        "run and idle animation need hysteresis instead of a single noisy speed threshold");
    assert.match(source, /f\.lockTargetFacing = true/,
        "combatants must keep their corrected model-forward axis on the live target");
    assert.match(source, /shadows=\{quality\.modelShadows \? "percentage" : false\}/,
        "the Rite must not select Three's deprecated warning-heavy boolean shadow preset");
    assert.match(source, /WARFRONT_MAZE_WALLS\.map/,
        "the stage must render every authoritative sight-blocking cell");
    assert.match(source, /function ShinobiMazeWall/,
        "collision cannot be represented by invisible debug barriers");
    assert.match(source, /function KageTacticsArena/,
        "the live stage must be a purpose-built 3D formation arena");
    assert.match(source, /Array\.from\(\{ length: 35 \}/,
        "the 7x5 simulation grid must have matching authored floor cells");
    assert.match(source, /function KageSmoke/,
        "smoke accuracy cells need a visible world treatment");
    assert.match(source, /const focusX = 0, focusZ = 0/,
        "the tactical camera must never chase targets around the board");
    assert.match(css, /kage-tactics-fortress-backdrop-v1\.webp/,
        "the mode must use the new generated fortress backdrop");
    assert.doesNotMatch(source, /shinobi-dual-scroll-courtyard-v3\.webp/,
        "retired capture-the-scroll floor art must not leak into Kage Tactics");
});

test("a fractional tick returns the exact interpolated position, not the floor snapshot", () => {
    const result = twoTicks();
    const mid = sampleActor(result, "player", 0, 0.5);
    assert.equal(mid.x, 2, "x must be halfway between the bracketing snapshots");
    assert.equal(mid.z, 1, "z must be halfway between the bracketing snapshots");
    // The old stage would have returned tick 0 here — that IS the staircase.
    assert.notEqual(mid.x, 0, "returning the floor snapshot is the retired behaviour");
});

test("interpolation is linear and continuous across the whole tick", () => {
    const result = twoTicks();
    let previous = -Infinity;
    for (let f = 0; f <= 1.0001; f += 0.1) {
        const pose = sampleActor(result, "player", 0, f);
        assert.ok(pose.x >= previous - 1e-9, `x went backwards at f=${f.toFixed(1)}`);
        assert.ok(Math.abs(pose.x - 4 * Math.min(1, f)) < 1e-6, `x is not linear at f=${f.toFixed(1)}`);
        previous = pose.x;
    }
});

test("health interpolates too, so a bar drains smoothly instead of stepping", () => {
    const quarter = sampleActor(twoTicks(), "player", 0, 0.25);
    assert.equal(quarter.hp, 90, "hp must interpolate between 100 and 60");
});

test("projectiles travel between snapshots instead of teleporting", () => {
    const result = resultFrom([
        { t: 0, actors: [], projectiles: [{ id: 7, x: -4, y: 2, team: "player", kind: "damage", element: "Fire" }] },
        { t: 1, actors: [], projectiles: [{ id: 7, x: 2, y: -2, team: "player", kind: "damage", element: "Fire" }] },
    ]);
    const [projectile] = sampleProjectiles(result, 0.5);
    assert.equal(projectile.x, -1);
    assert.equal(projectile.y, 0);
    assert.equal(projectile.id, 7);
});

test("facing interpolates, or a fighter snaps around between ticks", () => {
    const result = resultFrom([
        { t: 0, actors: [actor("player", { faceX: 1, faceY: 0 })], projectiles: [] },
        { t: 1, actors: [actor("player", { faceX: -1, faceY: 0 })], projectiles: [] },
    ]);
    assert.equal(sampleActor(result, "player", 0, 0.5).faceX, 0, "facing must pass through the midpoint");
});

test("discrete state takes the leading snapshot so a strike lands on its own frame", () => {
    const result = resultFrom([
        { t: 0, actors: [actor("player", { state: "idle" })], projectiles: [] },
        { t: 1, actors: [actor("player", { state: "strike" })], projectiles: [] },
    ]);
    assert.equal(sampleActor(result, "player", 0, 0.2).state, "idle");
    assert.equal(sampleActor(result, "player", 0, 0.8).state, "strike", "a state change must not arrive a frame late");
});

test("target assignments are discrete and expose a shared focus order", () => {
    const snapshot: DuelSnapshot = {
        t: 0,
        actors: [
            actor("player", { id: "player-0", slot: 0, targetId: "enemy-1" }),
            actor("player", { id: "player-1", slot: 1, targetId: "enemy-1" }),
            actor("player", { id: "player-2", slot: 2, targetId: "enemy-0" }),
            actor("enemy", { id: "enemy-0", slot: 0 }),
            actor("enemy", { id: "enemy-1", slot: 1 }),
        ],
        projectiles: [],
    };
    const result = resultFrom([snapshot]);
    assert.equal(sampleActor(result, "player", 0, 0).targetId, "enemy-1");
    assert.deepEqual(squadFocusAt(result, "player", 0), {
        team: "player",
        target: { team: "enemy", lane: 1 },
        attackers: [{ team: "player", lane: 0 }, { team: "player", lane: 1 }],
    });
    assert.equal(squadFocusAt(result, "enemy", 0), null, "one independent claim must not receive focus-fire VFX");
});

test("clash explanation credits a coordinated knockout instead of only naming the winner", () => {
    const snapshots: DuelSnapshot[] = [{
        t: 0,
        actors: [
            actor("player", { id: "player-0", slot: 0, targetId: "enemy-0" }),
            actor("player", { id: "player-1", slot: 1, targetId: "enemy-0" }),
            actor("enemy", { id: "enemy-0", slot: 0 }),
        ],
        projectiles: [],
    }];
    const events = [{ t: 1, type: "ko", side: "enemy", actorId: "enemy-0" }] as DuelEvent[];
    const explanation = explainSquadClash(resultFrom(snapshots, events), "player");
    assert.equal(explanation.playerFocusKos, 1);
    assert.match(explanation.headline, /coordinated focus/i);
    assert.match(explanation.detail, /numbers advantage/i);
});

test("a comeback is explained through formation durability instead of a retired objective", () => {
    const events = [
        { t: 12, type: "ko", side: "player", actorId: "player-0" },
        { t: 30, type: "ko", side: "enemy", actorId: "enemy-0" },
    ] as DuelEvent[];
    const explanation = explainSquadClash(resultFrom([], events), "player");
    assert.match(explanation.headline, /survived the counter-collapse/i);
    assert.match(explanation.detail, /cover and support/i);
    assert.doesNotMatch(`${explanation.headline} ${explanation.detail}`, /scroll|capture|extraction/i);
});

test("sampling is clamped at both ends and never returns a broken pose", () => {
    const result = twoTicks();
    assert.equal(sampleActor(result, "player", 0, -5).x, 0, "before the fight starts, hold the first snapshot");
    assert.equal(sampleActor(result, "player", 0, 99).x, 4, "past the end, hold the last snapshot");
    for (const t of [-1, 0, 0.5, 1, 50]) {
        const pose = sampleActor(result, "player", 0, t);
        assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.z), `non-finite pose at t=${t}`);
    }
});

test("an empty or unknown actor degrades to a safe pose instead of throwing", () => {
    const empty = resultFrom([]);
    assert.equal(sampleActor(empty, "player", 0, 3).maxHp, 1, "an empty result must not divide by zero downstream");
    const onlyPlayer = resultFrom([{ t: 0, actors: [actor("player")], projectiles: [] }]);
    assert.equal(sampleActor(onlyPlayer, "enemy", 0, 0).hp, 0, "a missing actor reads as down, not as a crash");
});

test("events bucket by tick so per-frame lookup is constant time", () => {
    const events = [
        { t: 3, type: "hit", side: "player", actorId: "a" },
        { t: 3, type: "hit", side: "enemy", actorId: "b" },
        { t: 9, type: "ko", side: "player", actorId: "a" },
    ] as unknown as DuelEvent[];
    const byTick = bucketEvents(events);
    assert.equal(byTick.get(3)?.length, 2, "both tick-3 events must share a bucket");
    assert.equal(byTick.get(9)?.length, 1);
    assert.equal(byTick.get(4), undefined, "empty ticks must not allocate");
});

test("the lethal tick is found so slow-mo can be armed before the blow lands", () => {
    const events = [
        { t: 4, type: "hit", side: "player", actorId: "a" },
        { t: 12, type: "ko", side: "player", actorId: "a" },
    ] as unknown as DuelEvent[];
    assert.equal(lethalTick(resultFrom([], events)), 12);
    assert.equal(lethalTick(resultFrom([], [])), null, "a fight with no KO has no lethal beat");
});

test("every element resolves to a colour, including none and unknown", () => {
    for (const element of ["Fire", "Water", "Wind", "Lightning", "Earth", "None", null, undefined, "Nonsense"]) {
        assert.match(elementColor(element as string | null | undefined), /^#[0-9a-f]{6}$/i, `no colour for ${element}`);
    }
    assert.notEqual(elementColor("Fire"), elementColor("Water"), "elements must be distinguishable");
});
