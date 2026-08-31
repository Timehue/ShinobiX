import test from "node:test";
import assert from "node:assert/strict";
import type { DuelEvent } from "./pet-duel-sim";
import {
    PET_DUEL_COMMAND_CATCHUP_SCALE,
    PET_DUEL_NEUTRAL_PLAYBACK_SCALE,
    PET_OPENING_TACTICS,
    appendCapped,
    boundedBurstStep,
    duelAttackDashBeats,
    duelFinisherOutcome,
    duelHeroCutEligible,
    duelHeroCutEventIndexes,
    duelMoveOutcome,
    petDuelAttackRhythm,
    petDuelContactTiming,
    petDuelImpactStrength,
    precedingNamedMove,
    selectDuelSpotlightEvent,
} from "./pet-duel-presentation";

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

test("opening tactics explain behavior, strength, and tradeoff before lock-in", () => {
    assert.deepEqual(PET_OPENING_TACTICS.map((tactic) => tactic.stance), [0, 1, 2]);
    for (const tactic of PET_OPENING_TACTICS) {
        assert.ok(tactic.behavior.length >= 55, `${tactic.name} needs a real behavior explanation`);
        assert.ok(tactic.strength.length >= 45, `${tactic.name} needs a readable strength`);
        assert.ok(tactic.tradeoff.length >= 45, `${tactic.name} needs an honest tradeoff`);
    }
});

test("combat pacing preserves readable neutral play and restrained command catch-up", () => {
    assert.ok(PET_DUEL_NEUTRAL_PLAYBACK_SCALE >= 1.2);
    assert.ok(PET_DUEL_NEUTRAL_PLAYBACK_SCALE <= 1.45);
    assert.ok(PET_DUEL_COMMAND_CATCHUP_SCALE > PET_DUEL_NEUTRAL_PLAYBACK_SCALE);
    assert.ok(PET_DUEL_COMMAND_CATCHUP_SCALE <= 1.8);
});

test("impact strength gives light hits a floor and preserves heavy/critical hierarchy", () => {
    const light = petDuelImpactStrength(0.02, false);
    const heavy = petDuelImpactStrength(0.3, false);
    const critical = petDuelImpactStrength(0.3, true);
    assert.ok(light >= 0.48);
    assert.ok(heavy > light);
    assert.ok(critical > heavy);
    assert.equal(petDuelImpactStrength(Number.NaN, false), 0.48);
    assert.equal(petDuelImpactStrength(10, true), 1.25);
});

test("attack rhythm gives heavy blows more anticipation than quick pokes", () => {
    const quick = petDuelAttackRhythm(0.1, false);
    const heavy = petDuelAttackRhythm(0.7, false);
    const critical = petDuelAttackRhythm(0.7, true);
    assert.ok(quick.pulseMultiplier < 1);
    assert.ok(heavy.pulseMultiplier > 1);
    assert.ok(critical.pulseMultiplier > heavy.pulseMultiplier);
    assert.ok(heavy.anticipationShare > quick.anticipationShare);
});

test("contact timing preserves a basic-to-finisher feedback hierarchy", () => {
    const basic = petDuelContactTiming({ damageFraction: 0.04 });
    const authored = petDuelContactTiming({ damageFraction: 0.04, playerAuthored: true });
    const heavy = petDuelContactTiming({ damageFraction: 0.34, heavy: true, critical: true });
    const finisher = petDuelContactTiming({ damageFraction: 0.5, signature: true, dash: true, perfect: true });
    assert.ok(authored.hitStop > basic.hitStop);
    assert.ok(heavy.shake > authored.shake);
    assert.ok(finisher.hitStop > heavy.hitStop);
    assert.ok(finisher.zoomKick > heavy.zoomKick);
    assert.ok(finisher.savorScale < basic.savorScale);
});

test("finisher anticipation only arms for an authoritative lethal payoff", () => {
    const events = [
        event({ t: 4, type: "windup", actorId: "player-0", targetId: "enemy-0", move: "Moon Fang" }),
        event({ t: 10, type: "hit", actorId: "player-0", targetId: "enemy-0", move: "Moon Fang", dmg: 40 }),
    ];
    const lethalSnapshots = Array.from({ length: 11 }, (_, t) => ({
        t,
        projectiles: [],
        actors: [{ id: "enemy-0", hp: t >= 10 ? 0 : 40 }],
    })) as Parameters<typeof duelFinisherOutcome>[1];
    const survivingSnapshots = Array.from({ length: 11 }, (_, t) => ({
        t,
        projectiles: [],
        actors: [{ id: "enemy-0", hp: t >= 10 ? 15 : 40 }],
    })) as Parameters<typeof duelFinisherOutcome>[1];

    assert.equal(duelFinisherOutcome(events, lethalSnapshots, 0)?.resolveTick, 10);
    assert.equal(duelFinisherOutcome(events, survivingSnapshots, 0), null);
    assert.equal(duelFinisherOutcome([events[0], event({ t: 10, type: "whiff", actorId: "player-0" })], lethalSnapshots, 0), null);
});
