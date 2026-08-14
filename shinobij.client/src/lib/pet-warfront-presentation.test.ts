import { test } from "node:test";
import assert from "node:assert/strict";
import {
    advanceWarfrontMotionFilter,
    adaptWarfrontPresentationBudget,
    createWarfrontMotionFilter,
    reconcileWarfrontMobSlots,
    shouldRenderWarfrontHoundRig,
    warfrontEventSalience,
    warfrontEventCursorThroughTick,
    warfrontHitStopSeconds,
    warfrontJudgmentState,
    warfrontLatestTickAtOrBefore,
    warfrontMotionFilterSpeed,
    warfrontMvpId,
    warfrontPaceForMotion,
    warfrontPipHealthColor,
    warfrontPresentationBudget,
    warfrontSmartPaceIsQuiet,
    warfrontSealBreakPresentation,
    warfrontSnapshotAtTick,
    warfrontSnapshotBoundsAtTick,
    warfrontSnapshotFrontier,
    warfrontTurningPoints,
    warfrontWardSealInstruction,
} from "./pet-warfront-presentation.ts";

test("sparse replay lookup resolves real ticks, interpolation, and terminal bounds", () => {
    const snapshots = [
        { t: 0, x: 0 },
        { t: 3, x: 6 },
        { t: 6, x: 12 },
        { t: 8, x: 20 },
    ] as const;

    assert.equal(warfrontSnapshotFrontier(snapshots), 8);
    assert.equal(warfrontSnapshotAtTick(snapshots, 5)?.t, 3, "discrete state must not leak a future keyframe");
    assert.deepEqual(warfrontSnapshotBoundsAtTick(snapshots, 4.5), {
        lower: snapshots[1], upper: snapshots[2], tick: 4.5, alpha: .5,
    });
    assert.deepEqual(warfrontSnapshotBoundsAtTick(snapshots, 7), {
        lower: snapshots[2], upper: snapshots[3], tick: 7, alpha: .5,
    }, "a short terminal gap still interpolates by real tick distance");
    const terminalBlend = warfrontSnapshotBoundsAtTick(snapshots, 7)!;
    assert.equal(
        terminalBlend.lower.x + (terminalBlend.upper.x - terminalBlend.lower.x) * terminalBlend.alpha,
        16,
        "motion interpolates continuously across a non-stride terminal interval",
    );
    assert.deepEqual(warfrontSnapshotBoundsAtTick(snapshots, 99), {
        lower: snapshots[3], upper: snapshots[3], tick: 8, alpha: 0,
    });
    assert.equal(warfrontSnapshotBoundsAtTick([], 2), null);
    assert.equal(warfrontSnapshotAtTick(snapshots, Number.NaN)?.t, 0);
});

test("a one-tick hit cue survives between sparse keyframes", () => {
    const snapshots = [{ t: 0 }, { t: 3 }] as const;
    const events = [{ t: 1, type: "petstrike" }, { t: 2, type: "hit" }, { t: 3, type: "kill" }] as const;
    assert.equal(warfrontSnapshotAtTick(snapshots, events[0].t)?.t, 0);
    const throughOne = warfrontEventCursorThroughTick(events, 0, 1);
    assert.equal(throughOne, 1);
    assert.equal(events[throughOne - 1].type, "petstrike", "the pose follows the event, not an action-state keyframe");
    assert.equal(warfrontEventCursorThroughTick(events, throughOne, 2), 2, "hit VFX remains event-driven too");
    assert.equal(warfrontEventCursorThroughTick(events, 2, 3), 3);
});

test("pre-indexed strike timing is deterministic through interpolation and rewind", () => {
    const strikes = [1, 7, 13] as const;
    assert.equal(warfrontLatestTickAtOrBefore(strikes, .9), null);
    assert.equal(warfrontLatestTickAtOrBefore(strikes, 1), 1);
    assert.equal(warfrontLatestTickAtOrBefore(strikes, 3.5), 1, "all display frames in the strike window resolve one authored cue");
    assert.equal(warfrontLatestTickAtOrBefore(strikes, 8), 7);
    assert.equal(warfrontLatestTickAtOrBefore(strikes, 2), 1, "rewind resolves from tick data instead of a consumed cursor");
    assert.equal(warfrontLatestTickAtOrBefore(strikes, 99), 13);
});

test("Seal break credit and color belong to the attacker", () => {
    assert.deepEqual(warfrontSealBreakPresentation({ team: "red", by: "blue" }), {
        team: "blue",
        label: "Blue shattered the Seal",
        color: "#93c5fd",
    });
});

test("impact slowdowns are tiered and disabled by reduced motion", () => {
    assert.equal(warfrontHitStopSeconds({ type: "coredown" }, false), .46);
    assert.equal(warfrontHitStopSeconds({ type: "kill" }, false), .22);
    assert.equal(warfrontHitStopSeconds({ type: "ultimate" }, false), .14);
    assert.equal(warfrontHitStopSeconds({ type: "techniqueused" }, false), .26);
    assert.equal(warfrontHitStopSeconds({ type: "counterstrikeclaim" }, false), .34);
    assert.equal(warfrontHitStopSeconds({ type: "coredown" }, true), 0);
    assert.equal(warfrontHitStopSeconds({ type: "hit" }, false), 0);
});

test("story PiP keeps healthy red subjects red", () => {
    assert.equal(warfrontPipHealthColor("red", .8), "#fca5a5");
    assert.equal(warfrontPipHealthColor("blue", .8), "#93c5fd");
    assert.equal(warfrontPipHealthColor("red", .2), "#f87171");
});

test("Ward Seal calls stay correct from either team perspective", () => {
    assert.equal(warfrontWardSealInstruction("blue", "blue"), "DEFEND BLUE'S WARD SEAL");
    assert.equal(warfrontWardSealInstruction("red", "blue"), "BREAK RED'S WARD SEAL");
    assert.equal(warfrontWardSealInstruction("blue", "red"), "BREAK BLUE'S WARD SEAL");
    assert.equal(warfrontWardSealInstruction("red", "red"), "DEFEND RED'S WARD SEAL");
    assert.equal(warfrontWardSealInstruction(null, "red"), null);
});

test("motion filter rejects tick-level reversals but follows sustained travel", () => {
    const jitter = createWarfrontMotionFilter();
    let jitterMin = Infinity;
    let jitterMax = -Infinity;
    for (let frame = 0; frame < 180; frame++) {
        const target = Math.floor(frame / 2) % 2 === 0 ? -0.1 : 0.1;
        advanceWarfrontMotionFilter(jitter, target, 0, 1 / 60);
        if (frame > 60) {
            jitterMin = Math.min(jitterMin, jitter.x);
            jitterMax = Math.max(jitterMax, jitter.x);
        }
    }
    assert.ok(jitterMax - jitterMin < 0.035, `tick reversal leaked ${jitterMax - jitterMin}u`);
    assert.ok(warfrontMotionFilterSpeed(jitter) < 0.2);

    const travel = createWarfrontMotionFilter();
    for (let frame = 0; frame < 120; frame++) {
        advanceWarfrontMotionFilter(travel, frame * 0.05, 0, 1 / 60);
    }
    assert.ok(travel.x > 5.5, "sustained travel must not be mistaken for jitter");
    assert.ok(warfrontMotionFilterSpeed(travel) > 2);
});

test("Warfront exposes the broadcast wall on player-facing Medium and keeps it off Low", () => {
    const low = warfrontPresentationBudget("low");
    const medium = warfrontPresentationBudget("medium");
    const high = warfrontPresentationBudget("high");

    assert.equal(low.squadCameras, false);
    assert.equal(medium.squadCameras, true);
    assert.equal(high.squadCameras, true);
    assert.ok(low.laneHoundRigs < medium.laneHoundRigs);
    assert.ok(medium.laneHoundRigs < high.laneHoundRigs);
    assert.ok(medium.squadCameraRenderEvery > high.squadCameraRenderEvery);
});

test("hound LOD requires both an available rig slot and camera proximity", () => {
    assert.equal(shouldRenderWarfrontHoundRig(1, 12, 3, 25), true);
    assert.equal(shouldRenderWarfrontHoundRig(3, 12, 3, 25), false);
    assert.equal(shouldRenderWarfrontHoundRig(1, 30, 3, 25), false);
});

test("adaptive pressure sheds secondary cameras and rigs before combat presentation", () => {
    const high = warfrontPresentationBudget("high");
    const warm = adaptWarfrontPresentationBudget(high, 1);
    const emergency = adaptWarfrontPresentationBudget(high, 2);

    assert.equal(warm.squadCameras, false);
    assert.ok(warm.hollowHoundRigs < high.hollowHoundRigs);
    assert.ok(warm.laneHoundRigs < high.laneHoundRigs);
    assert.deepEqual(emergency, warfrontPresentationBudget("low"));
});

test("mob render slots stay bound when an earlier mob dies", () => {
    const initial = reconcileWarfrontMobSlots([null, null, null, null], [10, 11, 12]);
    assert.deepEqual(initial, [10, 11, 12, null]);

    const afterDeath = reconcileWarfrontMobSlots(initial, [11, 12, 13]);
    assert.deepEqual(afterDeath, [13, 11, 12, null]);
});

test("mob slot reconciliation ignores duplicate ids and respects capacity", () => {
    assert.deepEqual(
        reconcileWarfrontMobSlots([4, null], [4, 4, 5, 6], 2),
        [4, 5],
    );
});

test("MVP scoring recognizes decisive kills, assists, and economy", () => {
    assert.equal(warfrontMvpId([
        { id: "damage-only", dmg: 2200, kills: 0, assists: 0, coins: 100 },
        { id: "closer", dmg: 1500, kills: 2, assists: 2, coins: 500 },
    ]), "closer");
    assert.equal(warfrontMvpId([]), null);
});

test("broadcast salience ranks decisive beats before chronology is restored", () => {
    const events = [
        { t: 10, type: "opening" },
        { t: 20, type: "gank" },
        { t: 30, type: "coredown" },
        { t: 40, type: "shutdown" },
        { t: 50, type: "wardenkill", stolen: true },
    ] as const;
    assert.ok(warfrontEventSalience(events[4]) > warfrontEventSalience(events[1]));
    assert.equal(warfrontEventSalience({ type: "mercy" }), 8);
    assert.equal(warfrontEventSalience({ type: "techniqueused" }), 7);
    assert.equal(warfrontEventSalience({ type: "counterstrike" }), 6);
    assert.equal(warfrontEventSalience({ type: "counterstrikeclaim" }), 8);
    assert.equal(warfrontEventSalience({ type: "bosssig", kind: "roar" }), 0, "ambient boss loops must not spam the broadcast");
    assert.deepEqual(warfrontTurningPoints(events, 3).map((event) => event.t), [30, 40, 50]);
});

test("Judgment advantage follows structures before the coin tiebreak", () => {
    assert.deepEqual(warfrontJudgmentState({ blue: 2, red: 1 }, { blue: 0, red: 999 }).leader, "blue");
    assert.deepEqual(warfrontJudgmentState({ blue: 1, red: 1 }, { blue: 300, red: 420 }).leader, "red");
    assert.equal(warfrontJudgmentState({ blue: 1, red: 1 }, { blue: 300, red: 300 }).blueShare, 50);
});

test("smart pace accelerates only certified quiet battlefield state", () => {
    const quiet = {
        actors: [
            { team: "blue" as const, state: "move", x: -12, y: 0 },
            { team: "red" as const, state: "move", x: 12, y: 0 },
        ],
        structures: { blue: { core: { exposed: false } }, red: { core: { exposed: false } } },
        warden: { active: false, alive: true, x: 0, y: 0 },
        minis: [],
    };
    assert.equal(warfrontSmartPaceIsQuiet(quiet, false), true);
    assert.equal(warfrontSmartPaceIsQuiet(quiet, true), false, "four-second major-event pre-roll must be 1x");
    assert.equal(warfrontSmartPaceIsQuiet({ ...quiet, actors: [quiet.actors[0], { ...quiet.actors[1], x: -6 }] }, false), false);
    assert.equal(warfrontSmartPaceIsQuiet({ ...quiet, structures: { ...quiet.structures, blue: { core: { exposed: true } } } }, false), false);
});

test("reduced motion always resolves broadcast pace to predictable 1x", () => {
    assert.equal(warfrontPaceForMotion("smart", true), "1");
    assert.equal(warfrontPaceForMotion("2", true), "1");
    assert.equal(warfrontPaceForMotion("1.5", false), "1.5");
});
