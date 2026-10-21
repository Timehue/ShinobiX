import { test } from "node:test";
import assert from "node:assert/strict";
import { lifeActorsAt } from "../../../shared/sector-life";
import { lifeActorPosition } from "../../../shared/sector-life-motion";
import { WORLD_DAY_MS, WORLD_HOUR_MS } from "../../../shared/world-clock";
import { isWalkableTile } from "../../../shared/sector-walk-mask";
import { advanceAuthoredGroundMotion } from "./authored-ground-motion";
import { createSectorNavigator } from "./sector-path-waypoint";

const STEP_MS = 200;
const WALK_SPEED = 0.6;

test("a 720ms-late callback catches authored training motion up before the shared hold", () => {
    const base = Math.floor(Date.now() / WORLD_DAY_MS) * WORLD_DAY_MS + 8 * WORLD_HOUR_MS;
    const actors = lifeActorsAt(9, base, "clear")
        .filter(actor => actor.id.startsWith("crew:9:"));
    assert.equal(actors.length, 2, "the authored training pair must be present");

    const practice = actors.map(actor => actor.cyclePhases?.find(phase => phase.activity === "Practising footwork"));
    assert.ok(practice.every((phase): phase is NonNullable<typeof phase> => !!phase), "both actors need the authored practice phase");
    const cycle = actors[0]!.motion!.start
        + Math.ceil((base - actors[0]!.motion!.start) / actors[0]!.motion!.repeat!) * actors[0]!.motion!.repeat!;
    const start = cycle + practice[0]!.at + 1_000;
    const sampleAt = start + 3_300;
    const targets = actors.map(actor => (at: number) => {
        const pose = lifeActorPosition(9, actor, at);
        return { col: pose.col, row: pose.row };
    });
    const expected = targets.map(targetAt => targetAt(sampleAt));
    assert.deepEqual(expected.map(pose => pose.row), [5, 5], "sample must fall inside the authored row-5 hold");

    const states = actors.map(actor => ({ col: actor.restTile % 12, row: Math.floor(actor.restTile / 12) }));
    const navigators = actors.map(() => createSectorNavigator());
    let lastCallbackAt = [start, start];
    const advance = (index: number, now: number) => {
        const elapsedMs = now - lastCallbackAt[index]!;
        const result = advanceAuthoredGroundMotion({
            position: states[index]!, elapsedMs, now, maxStepMs: STEP_MS, speed: WALK_SPEED,
            targetAt: targets[index]!,
            navigate: (position, target) => {
                const positionTile = Math.round(position.row) * 12 + Math.round(position.col);
                assert.ok(isWalkableTile(9, positionTile), `actor ${index} stepped from unwalkable ${JSON.stringify(position)}`);
                const next = navigators[index]!(9, position, target);
                const nextTile = Math.round(next.row) * 12 + Math.round(next.col);
                assert.ok(isWalkableTile(9, nextTile), `actor ${index} was routed onto unwalkable ${JSON.stringify(next)}`);
                return next;
            },
        });
        assert.equal(result.unconsumedMs, 0, "the callback must consume its full elapsed interval");
        states[index] = result.position;
        lastCallbackAt[index] = now;
    };

    // Actor 0 receives its normal 200ms callbacks. Actor 1 misses the callback
    // due at +200ms and first runs at +920ms: 720ms late. Both are evaluated at
    // that same absolute clock, so the delayed callback must replay the missed
    // authored targets in bounded substeps rather than discard elapsed time.
    for (let at = start + STEP_MS; at <= start + 800; at += STEP_MS) advance(0, at);
    advance(0, start + 920);
    advance(1, start + 920);
    assert.ok(Math.abs(states[1]!.row - states[0]!.row) < 0.05,
        "timely and delayed callbacks must share the authored row at the same timestamp");

    // Resume both loops and sample during the authored hold. The timer cadences
    // remain offset after the delayed callback, as setTimeout does in the app.
    for (let at = start + 1_000; at <= start + 3_200; at += STEP_MS) advance(0, at);
    for (let at = start + 1_120; at <= start + 3_120; at += STEP_MS) advance(1, at);
    for (let index = 0; index < actors.length; index++) {
        assert.ok(Math.hypot(states[index]!.col - expected[index]!.col, states[index]!.row - expected[index]!.row) < 0.05,
            `actor ${index} missed its authored hold target: ${JSON.stringify(states[index])} vs ${JSON.stringify(expected[index])}`);
    }
    assert.ok(Math.abs(states[0]!.row - states[1]!.row) < 0.05,
        `the pair lost alignment during the hold: ${states[0]!.row} vs ${states[1]!.row}`);
});

