import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import type { ArenaRole, ArenaSlot } from "./pet-arena-sim";
import { wfLaneAt } from "./pet-warfront-map";
import {
    parseWarfrontCommandPlan,
    runWarfrontMatch,
    startWarfrontMatch,
    WARFRONT_TPS,
    WF_MAX_SECONDS,
    WF_ROUND_SECONDS,
    WF_OMENS,
    wfOmenForSeed,
    wfTakedownFavor,
    wfVerdictScore,
} from "./pet-warfront-sim";
import { pruneWarfrontSnapshots } from "./pet-warfront-worker-client";

function mkPet(id: string, boost = 0): Pet {
    return {
        id,
        name: id,
        element: ["Earth", "Water", "Fire", "Wind"][Number(id.at(-1)) || 0],
        hp: 700 + boost * 4,
        attack: 90 + boost,
        defense: 45 + boost / 4,
        speed: 60,
        jutsus: [],
    } as Pet;
}

function squad(prefix: string, boost = 0): ArenaSlot[] {
    const roles: ArenaRole[] = ["defender", "tracker", "assassin", "sage"];
    return roles.map((role, index) => ({ pet: mkPet(`${prefix}-${index}`, boost), role }));
}

test("opening deployment normalizes to 2–1–1 and records the sealed lanes", () => {
    const ctl = startWarfrontMatch(squad("A"), squad("B"), 11, {
        initialLanes: { blue: ["s", "s", "n", "m"] },
    });
    assert.deepEqual(ctl.result.initialLanes.blue, ["s", "s", "n", "m"]);
    assert.deepEqual(ctl.lanes().blue, ["s", "s", "n", "m"]);
    assert.deepEqual(ctl.result.snapshots[0].actors.filter((actor) => actor.team === "blue").map((actor) => actor.lane), ["s", "s", "n", "m"]);

    const invalid = startWarfrontMatch(squad("A"), squad("B"), 11, {
        initialLanes: { blue: ["m", "m", "m", "m"] },
    });
    assert.deepEqual(invalid.result.initialLanes.blue, ["n", "m", "s", "m"], "a lane may never begin empty");
});

test("scheduled windows pause at two minutes and permit exactly one transfer or Hold", () => {
    const ctl = startWarfrontMatch(squad("A", -45), squad("B", -45), 23, { snapshotEvery: WARFRONT_TPS });
    ctl.advanceRoundPartial(WARFRONT_TPS * (WF_ROUND_SECONDS + 10));
    const command = ctl.commandState();
    assert.equal(command?.reason, "scheduled");
    assert.equal(command?.t, WARFRONT_TPS * WF_ROUND_SECONDS);
    assert.equal(command?.maxMoves, 1);
    const before = ctl.lanes().blue;
    ctl.advanceRound([{ type: "move", petIndex: 0, lane: "m" }, { type: "move", petIndex: 2, lane: "m" }]);
    const after = ctl.lanes().blue;
    assert.equal(after.filter((lane, index) => lane !== before[index]).length, 1);
    assert.deepEqual(ctl.commandLog()[0].moves, [{ petIndex: 0, lane: "m" }]);

    const hold = startWarfrontMatch(squad("A", -45), squad("B", -45), 23, { snapshotEvery: WARFRONT_TPS });
    hold.advanceRoundPartial(WARFRONT_TPS * (WF_ROUND_SECONDS + 10));
    const holdBefore = hold.lanes().blue;
    hold.advanceRound([]);
    assert.deepEqual(hold.commandLog()[0].moves, []);
    assert.deepEqual(hold.lanes().blue, holdBefore, "an explicit empty command is Hold, not an AI move");
});

test("the match is deterministic and actors never leave their sealed lane graph", () => {
    const a = runWarfrontMatch(squad("A"), squad("B"), 12345);
    const b = runWarfrontMatch(squad("A"), squad("B"), 12345);
    assert.equal(a.winner, b.winner);
    assert.equal(a.ticks, b.ticks);
    assert.deepEqual(a.events, b.events);
    assert.deepEqual(a.commandLog, b.commandLog);
    for (const frame of a.snapshots.filter((_, index) => index % 90 === 0)) {
        for (const actor of frame.actors) assert.equal(wfLaneAt(actor.x, actor.y), actor.lane, `${actor.id} crossed out of ${actor.lane}`);
    }
});

test("authoritative replay is outcome-identical without retaining presentation history", () => {
    const full = runWarfrontMatch(squad("A"), squad("B"), 8080, "balanced", "balanced", undefined,
        { blue: "jungle", red: "balanced" }, { blue: "warden-pact", red: "vanguard" });
    const authority = runWarfrontMatch(squad("A"), squad("B"), 8080, "balanced", "balanced", undefined,
        { blue: "jungle", red: "balanced" }, { blue: "warden-pact", red: "vanguard" }, undefined,
        { captureSnapshots: false });
    assert.equal(authority.winner, full.winner);
    assert.equal(authority.ticks, full.ticks);
    assert.deepEqual(authority.events, full.events);
    assert.deepEqual(authority.commandLog, full.commandLog);
    assert.deepEqual(authority.petStats, full.petStats);
    assert.equal(authority.snapshots.length, 1, "authority keeps only the structural tick-zero frame");

    const tenMinuteAuthority = runWarfrontMatch(squad("A", -75), squad("B", -75), 7,
        "balanced", "balanced", undefined, undefined, undefined, undefined,
        { captureSnapshots: false });
    assert.equal(tenMinuteAuthority.ticks, WARFRONT_TPS * WF_MAX_SECONDS);
    assert.equal(tenMinuteAuthority.snapshots.length, 1);
    assert.ok(JSON.stringify(tenMinuteAuthority).length < 500_000, "authority result must remain below the 500 KB serialized budget");
});

test("browser playback prunes consumed frames while retaining an interpolation anchor", () => {
    const ctl = startWarfrontMatch(squad("A", -45), squad("B", -45), 71, { snapshotEvery: 2 });
    ctl.advanceRoundPartial(WARFRONT_TPS * (WF_ROUND_SECONDS + 1));
    const frames = ctl.result.snapshots;
    assert.ok(frames.length > 1_000, "the worker should have streamed a complete command segment");
    const removed = pruneWarfrontSnapshots(frames, ctl.result.ticks, WARFRONT_TPS * 2);
    assert.ok(removed > 1_000);
    assert.ok(frames.length <= WARFRONT_TPS + 2, "only the two-second 15 Hz interpolation tail should remain");
    assert.ok(frames[0].t <= ctl.result.ticks - WARFRONT_TPS * 2);
    assert.ok(frames.length === 1 || frames[1].t > ctl.result.ticks - WARFRONT_TPS * 2);
});

test("command log replay produces the identical authoritative winner and event stream", () => {
    const played = runWarfrontMatch(squad("A"), squad("B"), 9090, "balanced", "balanced", undefined,
        { blue: "jungle", red: "balanced" }, { blue: "warden-pact", red: "vanguard" });
    const replay = runWarfrontMatch(squad("A"), squad("B"), 9090, "balanced", "balanced", undefined,
        { blue: "jungle", red: "balanced" }, { blue: "warden-pact", red: "vanguard" }, {
            initialLanes: played.initialLanes,
            commands: played.commandLog,
        });
    assert.equal(replay.winner, played.winner);
    assert.equal(replay.ticks, played.ticks);
    assert.deepEqual(replay.events, played.events);
});

test("a supplied plan treats omitted command windows as Hold instead of AI assistance", () => {
    const held = runWarfrontMatch(squad("A", -20), squad("B", -20), 5, "balanced", "balanced", undefined,
        undefined, undefined, { initialLanes: { blue: ["n", "m", "s", "m"] }, commands: [] });
    const firstScheduled = held.commandLog.find((entry) => entry.reason === "scheduled");
    assert.ok(firstScheduled, "the match should reach a scheduled command window");
    assert.deepEqual(firstScheduled.moves, []);
    assert.equal(firstScheduled.summonLane, undefined);
    assert.equal(firstScheduled.summonAspect, undefined);
});

test("first to destroy two towers wins and a first break opens a breakthrough", () => {
    const result = runWarfrontMatch(squad("A", 180), squad("B", -60), 44, "balanced", "balanced", undefined,
        { blue: "siege", red: "balanced" }, { blue: "vanguard", red: "none" });
    assert.equal(result.winner, "blue");
    const last = result.snapshots.at(-1)!;
    assert.equal(wfVerdictScore(last).blue, 2);
    assert.equal(result.events.filter((event) => event.type === "towerdown" && event.by === "blue").length, 2);
    assert.ok(result.events.some((event) => event.type === "commandwindow" && event.reason === "breakthrough"));
});

test("Favor is earned and can call the Warden from a command window", () => {
    const result = runWarfrontMatch(squad("A", 20), squad("B"), 31337, "balanced", "balanced", undefined,
        { blue: "jungle", red: "balanced" }, { blue: "warden-pact", red: "vanguard" });
    assert.ok(result.snapshots.some((frame) => frame.favor.blue > 0), "combat and tower pressure should earn Favor");
    assert.ok(result.events.some((event) => event.type === "wardensummon" && event.team === "blue"), "Oathseekers + Pact should reach a summon in a representative match");
});

test("server-facing command plans reject malformed or lane-empty input", () => {
    assert.equal(parseWarfrontCommandPlan(null), null);
    assert.equal(parseWarfrontCommandPlan({ initialLanes: ["m", "m", "m", "m"], commands: [] }), null);
    assert.equal(parseWarfrontCommandPlan({ initialLanes: ["n", "m", "s", "m"], commands: [{ t: 3600, reason: "scheduled", moves: [{ petIndex: 9, lane: "n" }] }] }), null);
    assert.deepEqual(parseWarfrontCommandPlan({
        initialLanes: ["n", "m", "s", "m"],
        commands: [{ t: 3600, reason: "scheduled", moves: [], summonLane: "s" }],
    }), {
        initialLanes: { blue: ["n", "m", "s", "m"], red: ["n", "m", "s", "m"] },
        commands: [{ t: 3600, reason: "scheduled", moves: [], summonLane: "s" }],
    });
    assert.ok(parseWarfrontCommandPlan({
        initialLanes: ["n", "m", "s", "m"],
        commands: [{ t: 1777, reason: "omen", moves: [{ petIndex: 1, lane: "n" }] }],
    }), "a Shattered Wards reaction must survive the client-to-server replay parser");
});

test("every match terminates by the ten-minute Riftfall verdict", () => {
    const result = runWarfrontMatch(squad("A", -75), squad("B", -75), 7);
    assert.ok(result.ticks <= WARFRONT_TPS * WF_MAX_SECONDS);
    assert.notEqual(result.winner, null);
});

test("Hollow Omens are deterministic, shared, and alter command cadence without adding hidden randomness", () => {
    assert.deepEqual([4, 5, 6, 7].map(wfOmenForSeed), WF_OMENS.map((omen) => omen.id));
    const storm = runWarfrontMatch(squad("A"), squad("B"), 5);
    assert.equal(storm.omen, "storm-gate");
    const firstScheduled = storm.events.find((event) => event.type === "commandwindow" && event.reason === "scheduled");
    assert.equal(firstScheduled?.t, WARFRONT_TPS * 90);

    const thinVeil = runWarfrontMatch(squad("A", 20), squad("B"), 4, "balanced", "balanced", undefined,
        { blue: "jungle", red: "balanced" }, { blue: "warden-pact", red: "vanguard" });
    const thinVeilMaxDuration = Math.max(...thinVeil.snapshots.map((frame) => frame.wardens.blue.active ? frame.wardens.blue.secs : 0));
    assert.ok(thinVeil.events.some((event) => event.type === "wardensummon" && event.team === "blue"));
    assert.ok(thinVeilMaxDuration > 27 && thinVeilMaxDuration <= 28, `Thin Veil duration drifted to ${thinVeilMaxDuration}s`);

    assert.equal(wfTakedownFavor("blood-moon", true), 24, "Blood Moon adds 12 Favor to the normal takedown award");
    assert.equal(wfTakedownFavor("thin-veil", true), 18, "ordinary fractured-tower defense keeps the six-Favor comeback award");
    assert.equal(wfTakedownFavor("blood-moon", false), 12, "Blood Moon is not a global takedown multiplier");
});

test("command reveals and impact records preserve the plan-to-consequence story", () => {
    const result = runWarfrontMatch(squad("A", 35), squad("B"), 8);
    const resolved = result.events.filter((event) => event.type === "commandresolved");
    assert.ok(resolved.length > 0);
    assert.ok(result.commandImpacts.length > 0);
    assert.ok(result.events.some((event) => event.type === "commandimpact"));
    assert.ok(result.commandImpacts.every((impact) => impact.resolvedAt >= impact.t));
    assert.ok(result.commandImpacts.every((impact) => impact.towerDamageDealt >= 0 && impact.towerDamageTaken >= 0));
});

test("Warden summons seal a visible behavior Aspect into the authoritative event and snapshots", () => {
    const result = runWarfrontMatch(squad("A", 20), squad("B"), 31337, "balanced", "balanced", undefined,
        { blue: "jungle", red: "balanced" }, { blue: "warden-pact", red: "vanguard" });
    const summon = result.events.find((event) => event.type === "wardensummon");
    assert.ok(summon && ["breaker", "sentinel", "harrier"].includes(summon.aspect));
    assert.ok(result.snapshots.some((frame) => frame.wardens.blue.active || frame.wardens.red.active));
    assert.ok(result.snapshots.filter((frame) => frame.wardens.blue.active).every((frame) => ["breaker", "sentinel", "harrier"].includes(frame.wardens.blue.aspect)));
});

test("Breaker, Sentinel, and Harrier produce distinct authoritative battlefield behavior", () => {
    const runAspect = (aspect: "breaker" | "sentinel" | "harrier") => runWarfrontMatch(
        squad("A", -60), squad("B", -60), 4, "balanced", "balanced", undefined,
        { blue: "jungle", red: "balanced" }, { blue: "warden-pact", red: "vanguard" }, {
            initialLanes: { blue: ["n", "m", "s", "m"] },
            commands: [
                { t: WARFRONT_TPS * 120, reason: "scheduled", moves: [] },
                { t: WARFRONT_TPS * 240, reason: "scheduled", moves: [], summonLane: "m", summonAspect: aspect },
            ],
        },
    );
    const breaker = runAspect("breaker");
    const sentinel = runAspect("sentinel");
    const harrier = runAspect("harrier");
    const maxWardenX = (result: typeof breaker) => Math.max(...result.snapshots
        .filter((frame) => frame.wardens.blue.active)
        .map((frame) => frame.wardens.blue.x));
    const petDamage = (result: typeof breaker) => result.events.reduce((sum, event) => (
        sum + (event.type === "hit" && event.actorId === "warden-blue" ? event.dmg : 0)
    ), 0);
    const towerDamage = (result: typeof breaker) => result.events.reduce((sum, event) => (
        sum + (event.type === "towerhit" && event.actorId === "warden-blue" ? event.dmg : 0)
    ), 0);

    assert.ok(maxWardenX(sentinel) < -20, "Sentinel must return to the allied tower anchor");
    assert.ok(maxWardenX(breaker) > 20 && maxWardenX(harrier) > 20, "offensive Aspects must advance down the lane");
    assert.ok(petDamage(harrier) > petDamage(breaker), "Harrier must outperform Breaker against pets");
    assert.ok(towerDamage(breaker) > towerDamage(harrier), "Breaker must outperform Harrier against structures");
});

test("Shattered Wards opens one immediate fracture reaction window", () => {
    const result = runWarfrontMatch(squad("A", 180), squad("B", -60), 7);
    assert.equal(result.omen, "shattered-wards");
    const reactions = result.events.filter((event) => event.type === "commandwindow" && event.reason === "omen" && event.lane !== undefined);
    assert.equal(reactions.length, 1);
    assert.equal(result.commandLog.filter((entry) => entry.reason === "omen").length, 1);
});
