import test from "node:test";
import assert from "node:assert/strict";
import type { DuelEvent } from "./pet-duel-sim";
import { appendCapped, boundedBurstStep, duelAttackDashBeats, duelHeroCutEligible, duelHeroCutEventIndexes, duelMoveOutcome, precedingNamedMove, selectDuelSpotlightEvent } from "./pet-duel-presentation";

const event = (value: Partial<DuelEvent> & Pick<DuelEvent, "t" | "type" | "actorId">): DuelEvent => ({
    side: value.actorId.startsWith("enemy") ? "enemy" : "player",
    ...value,
});

test("a signature cut-in is eligible only when its same-name hit really resolves", () => {
    const events = [
        event({ t: 100, type: "ultimate", actorId: "player-0", move: "Tidal Crash" }),
        event({ t: 110, type: "cast", actorId: "player-0", move: "Tidal Crash" }),
        event({ t: 116, type: "hit", actorId: "player-0", targetId: "enemy-0", move: "Tidal Crash", dmg: 90 }),
    ];
    assert.equal(duelMoveOutcome(events, 0).kind, "hit");
    assert.equal(duelMoveOutcome(events, 0).event, events[2]);
});

test("each fighter earns a hero cut even after the opponent has already shown theirs", () => {
    const shown = new Set(["enemy-0"]);
    assert.equal(duelHeroCutEligible({
        actorId: "player-0",
        eventType: "ultimate",
        move: "Lunar Eclipse: Ninetail Requiem",
        outcomeKind: "hit",
        shownActors: shown,
    }), true);
    assert.equal(duelHeroCutEligible({
        actorId: "enemy-0",
        eventType: "ultimate",
        move: "Tidal Crash",
        outcomeKind: "hit",
        shownActors: shown,
    }), false);
});

test("a short fight promotes one successful named attack when a fighter never reaches its ultimate", () => {
    const events = [
        event({ t: 100, type: "cast", actorId: "player-0", move: "Eclipse Fang" }),
        event({ t: 110, type: "hit", actorId: "player-0", targetId: "enemy-0", move: "Eclipse Fang", dmg: 80 }),
        event({ t: 130, type: "cast", actorId: "enemy-0", move: "Riptide Fang" }),
        event({ t: 140, type: "hit", actorId: "enemy-0", targetId: "player-0", move: "Riptide Fang", dmg: 75 }),
        event({ t: 210, type: "ultimate", actorId: "enemy-0", move: "Tidal Crash" }),
        event({ t: 220, type: "hit", actorId: "enemy-0", targetId: "player-0", move: "Tidal Crash", dmg: 120 }),
    ];
    assert.deepEqual(duelHeroCutEventIndexes(events, {
        "player-0": "Lunar Eclipse: Ninetail Requiem",
        "enemy-0": "Tidal Crash",
    }), {
        "player-0": 0,
        "enemy-0": 4,
    });
});

test("a dodged named move cannot promise an empty cinematic payoff", () => {
    const events = [
        event({ t: 200, type: "windup", actorId: "player-0", targetId: "enemy-0", move: "Eclipse Fang" }),
        event({ t: 208, type: "dodge", actorId: "enemy-0", move: "Evade" }),
        event({ t: 220, type: "whiff", actorId: "player-0" }),
    ];
    assert.equal(duelMoveOutcome(events, 0).kind, "whiff");
    assert.equal(precedingNamedMove(events, 2)?.move, "Eclipse Fang");
});

test("support cut-ins retain their visible buff, shield, or healing payoff", () => {
    const events = [
        event({ t: 300, type: "cast", actorId: "player-0", move: "Nine Shadow Blessing", kind: "buff" }),
        event({ t: 306, type: "buff", actorId: "player-0", targetId: "player-0" }),
    ];
    assert.equal(duelMoveOutcome(events, 0).kind, "support");
});

test("an unrelated later hit does not rescue an interrupted named move", () => {
    const events = [
        event({ t: 400, type: "ultimate", actorId: "player-0", move: "Ninetail Requiem" }),
        event({ t: 412, type: "whiff", actorId: "player-0" }),
        event({ t: 430, type: "hit", actorId: "player-0", targetId: "enemy-0", dmg: 12 }),
    ];
    assert.equal(duelMoveOutcome(events, 0).kind, "whiff");
});

test("a dropped frame cannot collapse an authored dash into a teleport", () => {
    const hitched = boundedBurstStep([0, 0], [9, 0], 0.12);
    assert.ok(Math.hypot(hitched[0], hitched[1]) <= 0.48001);

    const regular = boundedBurstStep([0, 0], [9, 0], 1 / 60);
    assert.ok(Math.hypot(regular[0], regular[1]) <= 0.35001);

    assert.deepEqual(boundedBurstStep([1, 2], [1.1, 2.1], 1 / 60), [1.1, 2.1]);
});

test("a moving melee whiff keeps its authored dash route while a stationary whiff does not", () => {
    const movingEvents = [
        event({ t: 4, type: "windup", actorId: "player-0", targetId: "enemy-0", move: "Eclipse Fang" }),
        event({ t: 10, type: "dodge", actorId: "enemy-0", move: "Evade" }),
        event({ t: 16, type: "whiff", actorId: "player-0" }),
    ];
    const movingSnapshots = Array.from({ length: 17 }, (_, tick) => ({ actors: [
        { id: "player-0", x: tick < 4 ? 0 : (tick - 4) / 12 * 5, y: 0 },
        { id: "enemy-0", x: 6, y: 0 },
    ] }));
    assert.deepEqual(duelAttackDashBeats(movingEvents, movingSnapshots), [{
        startTick: 4,
        resolveTick: 16,
        actorId: "player-0",
        targetId: "enemy-0",
        element: undefined,
        move: "Eclipse Fang",
        outcome: "whiff",
    }]);

    const stationarySnapshots = movingSnapshots.map((snapshot) => ({ actors: snapshot.actors.map((actor) => actor.id === "player-0" ? { ...actor, x: 0 } : actor) }));
    assert.deepEqual(duelAttackDashBeats(movingEvents, stationarySnapshots), []);
});

test("party presentation spotlights the strongest simultaneous combat beat", () => {
    const events = [
        event({ t: 40, type: "windup", actorId: "player-0", move: "Eclipse Fang" }),
        event({ t: 40, type: "hit", actorId: "enemy-1", targetId: "player-1", move: "Thunder Break", crit: true, dmg: 90 }),
        event({ t: 40, type: "ultimate", actorId: "player-1", move: "Tidal Crash" }),
    ];
    assert.equal(selectDuelSpotlightEvent(events), events[2]);
});

test("equal-priority spotlight events resolve deterministically to the first event", () => {
    const events = [
        event({ t: 50, type: "cast", actorId: "player-0", move: "Eclipse Fang" }),
        event({ t: 50, type: "cast", actorId: "enemy-0", move: "Riptide Fang" }),
    ];
    assert.equal(selectDuelSpotlightEvent(events), events[0]);
});

test("minor hits and maneuvers remain local instead of taking the party spotlight", () => {
    assert.equal(selectDuelSpotlightEvent([
        event({ t: 60, type: "hit", actorId: "player-0", targetId: "enemy-0", dmg: 12 }),
        event({ t: 60, type: "maneuver", actorId: "enemy-1", move: "Sidestep" }),
    ]), null);
});

test("capped presentation lists evict their oldest entry", () => {
    assert.deepEqual(appendCapped([1, 2, 3], 4, 3), [2, 3, 4]);
    assert.deepEqual(appendCapped([1], 2, 0), []);
});
