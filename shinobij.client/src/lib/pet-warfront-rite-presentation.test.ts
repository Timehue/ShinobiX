import { test } from "node:test";
import assert from "node:assert/strict";
import {
    bucketEvents,
    elementColor,
    lethalTick,
    sampleActor,
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
