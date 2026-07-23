// Tests for the player-controlled coliseum duel (docs/pet-coliseum-player-control-plan.md).
//
// The load-bearing invariant is the FIRST test: stepping the sim tick-by-tick with
// no commands must reproduce runPetDuelCinematic byte for byte. That is what proves
// the create/step refactor did not disturb the pet ladder, sector war, or the
// generated server mirror — all of which still call the one-shot entry point.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import {
    runPetDuelCinematic, runPetPartyDuelCinematic,
    createLiveCinematicDuel, createLivePartyCinematicDuel,
    stepCinematicDuel, finishCinematicDuel, applyDuelCommand, readDuelControl,
    checkpointCinematicDuel, restoreCinematicDuel,
} from "./pet-duel-cinematic";
import { createLiveDuel } from "./pet-duel-live";
import { bondCharge, bondReady, BOND_FULL } from "./pet-bond-meter";
import { DUEL_TPS, type DuelEvent } from "./pet-duel-sim";

function pet(id: string, element: string, over: Partial<Pet> = {}): Pet {
    return {
        id, name: id, species: id, level: 20,
        hp: 820, attack: 92, defense: 44, speed: 96,
        element, trait: "Swift",
        jutsus: [
            { name: "Fang Strike", kind: "damage", power: 104, cooldown: 1 },
            { name: "Ember Coil", kind: "burn", power: 88, cooldown: 3 },
            { name: "Stone Ward", kind: "shield", power: 60, cooldown: 4 },
            { name: "Slipstream", kind: "move", power: 10, cooldown: 3 },
            { name: "Ruin Fang", kind: "crush", power: 182, cooldown: 6, signature: true },
        ],
        ...over,
    } as unknown as Pet;
}

/** Drive a live sim to completion without ever issuing a command. */
function runUncommanded(sim: ReturnType<typeof createLiveCinematicDuel>) {
    let guard = 0;
    while (stepCinematicDuel(sim) && guard++ < DUEL_TPS * 200) { /* run out the fight */ }
    return finishCinematicDuel(sim);
}

test("an uncommanded live duel is byte-identical to the one-shot engine", () => {
    for (let seed = 1; seed <= 8; seed++) {
        const oneShot = runPetDuelCinematic(pet("P", "Fire"), pet("Q", "Water"), seed, 1, 1, false, true, true, null, false);
        const live = runUncommanded(createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), seed, 1, 1, false, true, true, null, false));
        assert.deepEqual(live, oneShot, `seed ${seed} diverged from the one-shot engine`);
    }
});

test("an uncommanded live 2v2 is byte-identical to the one-shot engine", () => {
    for (let seed = 1; seed <= 4; seed++) {
        const args = [pet("A", "Fire"), pet("B", "Earth"), pet("C", "Water"), pet("D", "Wind")] as const;
        const oneShot = runPetPartyDuelCinematic(args[0], args[1], args[2], args[3], seed, 1, 1, false, true, true, false);
        const live = runUncommanded(createLivePartyCinematicDuel(
            pet("A", "Fire"), pet("B", "Earth"), pet("C", "Water"), pet("D", "Wind"), seed, 1, 1, false, true, true, false,
        ));
        assert.deepEqual(live, oneShot, `2v2 seed ${seed} diverged from the one-shot engine`);
    }
});

test("a checkpoint restores the sim exactly, so a rewind replays identically", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 5, 1, 1, false, true, true, null, false);
    for (let i = 0; i < 90; i++) stepCinematicDuel(sim);
    const cp = checkpointCinematicDuel(sim);
    const forward: string[] = [];
    for (let i = 0; i < 60; i++) { stepCinematicDuel(sim); forward.push(JSON.stringify(sim.snapshots[sim.snapshots.length - 1])); }

    restoreCinematicDuel(sim, cp);
    assert.equal(sim.snapshots.length, 90, "rewind must discard the snapshots taken after the checkpoint");
    const replay: string[] = [];
    for (let i = 0; i < 60; i++) { stepCinematicDuel(sim); replay.push(JSON.stringify(sim.snapshots[sim.snapshots.length - 1])); }
    assert.deepEqual(replay, forward, "replaying from a checkpoint must reproduce the same ticks");
});

test("an ordered ability is the move the pet actually commits to", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 3, 1, 1, false, true, true, null, false);
    // Let the pets close first, so the order has a window to resolve in.
    for (let i = 0; i < DUEL_TPS * 2; i++) stepCinematicDuel(sim);
    const before = sim.events.length;
    assert.ok(applyDuelCommand(sim, { kind: "ability", actorId: "player-0", idx: 1 }), "the order should be accepted");
    for (let i = 0; i < DUEL_TPS * 6; i++) stepCinematicDuel(sim);
    const opened = sim.events.slice(before).filter((e: DuelEvent) => e.actorId === "player-0" && (e.type === "windup" || e.type === "cast" || e.type === "ultimate"));
    assert.ok(opened.length > 0, "the commanded pet should have opened a move");
    assert.equal(opened[0].move, "Ember Coil", "the FIRST move opened after the order must be the ordered one");
});

test("Bond Break unleashes the signature even while it is on cooldown", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 7, 1, 1, false, true, true, null, false);
    for (let i = 0; i < DUEL_TPS; i++) stepCinematicDuel(sim);
    // The signature opens gated behind a long cooldown precisely so the AI hoards it.
    const gated = readDuelControl(sim, "player-0")!.abilities.find((a) => a.signature)!;
    assert.ok(gated.cdLeft > 0, "the signature should still be on its opening cooldown");
    const before = sim.events.length;
    assert.ok(applyDuelCommand(sim, { kind: "break", actorId: "player-0" }));
    for (let i = 0; i < DUEL_TPS * 8; i++) stepCinematicDuel(sim);
    const ults = sim.events.slice(before).filter((e: DuelEvent) => e.type === "ultimate" && e.actorId === "player-0");
    assert.ok(ults.length > 0, "Bond Break must produce a signature release");
    assert.equal(readDuelControl(sim, "player-0")!.breakPending, false, "the Break is spent once it fires");
});

test("Auto hands the pet back to its own AI and drops any standing order", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 11, 1, 1, false, true, true, null, false);
    applyDuelCommand(sim, { kind: "ability", actorId: "player-0", idx: 2 });
    applyDuelCommand(sim, { kind: "auto", actorId: "player-0", on: true });
    const control = readDuelControl(sim, "player-0")!;
    assert.equal(control.auto, true);
    assert.equal(control.orderedIdx, -2, "switching to Auto must clear the queued order");
    // With no controlled fighter left, further commands are refused outright.
    assert.equal(applyDuelCommand(sim, { kind: "ability", actorId: "player-0", idx: 1 }), false);
});

test("stance is accepted, clamped, and defaults to the AI's own balance", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 13, 1, 1, false, true, true, null, false);
    assert.equal(readDuelControl(sim, "player-0")!.stance, 1, "balanced is the default, i.e. the shipped AI");
    applyDuelCommand(sim, { kind: "stance", actorId: "player-0", stance: 9 });
    assert.equal(readDuelControl(sim, "player-0")!.stance, 2, "an out-of-range stance clamps rather than corrupting the fighter");
});

test("the enemy pet never accepts commands", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 17, 1, 1, false, true, true, null, false);
    assert.equal(applyDuelCommand(sim, { kind: "ability", actorId: "enemy-0", idx: 0 }), false);
    assert.equal(applyDuelCommand(sim, { kind: "break", actorId: "enemy-0" }), false);
});

test("the live controller keeps the sim ahead of playback and never shows the buffer", () => {
    const duel = createLiveDuel(pet("P", "Fire"), pet("Q", "Water"), 23, 1, 1, false, true, true, null);
    const view = duel.advance(0);
    assert.ok(view.snapshots.length >= 1, "playback tick 0 must have something to draw");
    // Everything visible is settled: the look-ahead the presentation layer needs
    // has already been simulated, but is deliberately not exposed.
    assert.ok(view.events.every((e) => e.t <= view.snapshots.length - 1), "no event may reference an unshown tick");
    const later = duel.advance(60);
    assert.ok(later.snapshots.length > view.snapshots.length, "advancing playback must reveal more of the fight");
});

test("a command issued at the playback head takes effect without waiting out the buffer", () => {
    const duel = createLiveDuel(pet("P", "Fire"), pet("Q", "Water"), 29, 1, 1, false, true, true, null);
    const playbackTick = DUEL_TPS * 2;
    const before = duel.advance(playbackTick);
    const seenBefore = before.snapshots.length;
    duel.command({ kind: "ability", actorId: "player-0", idx: 1 });
    const after = duel.advance(playbackTick);
    // The already-seen prefix is untouched — a rewind must never rewrite history.
    for (let t = 0; t <= playbackTick && t < seenBefore; t++) {
        assert.deepEqual(after.snapshots[t], before.snapshots[t], `tick ${t} changed under the player`);
    }
    assert.ok(after.snapshots.length >= seenBefore - 1, "the buffer should refill after a rewind");
});

test("the bond meter fills on the player's work and resets when it is spent", () => {
    const events: DuelEvent[] = [
        { t: 5, type: "hit", side: "player", actorId: "player-0", targetId: "enemy-0", dmg: 40 },
        { t: 9, type: "hit", side: "player", actorId: "player-0", targetId: "enemy-0", dmg: 60, crit: true },
        { t: 14, type: "dodge", side: "player", actorId: "player-0" },
        { t: 20, type: "hit", side: "enemy", actorId: "enemy-0", targetId: "player-0", dmg: 30 },
    ];
    assert.equal(bondCharge(events, "player-0", 4), 0, "nothing has happened yet");
    assert.equal(bondCharge(events, "player-0", 5), 9, "a landed hit pays");
    assert.equal(bondCharge(events, "player-0", 9), 24, "a crit pays a bonus on top");
    assert.equal(bondCharge(events, "player-0", 20), 41, "dodging and being hit both feed the meter");
    assert.equal(bondCharge(events, "player-0", 20, 9), 17, "spending the meter discounts everything up to that tick");
    assert.ok(!bondReady(events, "player-0", 20));
});

test("the bond meter never banks more than one Bond Break", () => {
    const events: DuelEvent[] = Array.from({ length: 60 }, (_, i) => (
        { t: i, type: "hit", side: "player", actorId: "player-0", targetId: "enemy-0", dmg: 10 } as DuelEvent
    ));
    assert.equal(bondCharge(events, "player-0", 59), BOND_FULL);
});

// ── Server replay parity (plan §9.6) ────────────────────────────────────────────
// THE contract behind server-authoritative rewards: the flat {tick, command} log
// the client posts, replayed by stepping the same seeded sim, must reproduce the
// fight the player actually played. If this drifts, api/pet/battle-result.ts pays
// out a different fight than the one on screen — which is the whole bug §9.6 is
// about. The replay loop below is deliberately a literal copy of the one in
// api/pet/_duel-replay.ts, so a change there that breaks parity fails here.
function replayInputLog(
    make: () => ReturnType<typeof createLiveCinematicDuel>,
    log: readonly { t: number; cmd: Parameters<typeof applyDuelCommand>[1] }[],
) {
    const sim = make();
    let i = 0;
    for (let guard = 0; guard < DUEL_TPS * 200; guard++) {
        while (i < log.length && log[i].t <= sim.t) applyDuelCommand(sim, log[i++].cmd);
        if (!stepCinematicDuel(sim)) break;
    }
    return finishCinematicDuel(sim);
}

test("replaying the input log reproduces the commanded duel exactly", () => {
    for (const seed of [3, 11, 23, 42]) {
        const make = () => createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), seed, 1, 1, false, true, true, null, false);
        const live = createLiveDuel(pet("P", "Fire"), pet("Q", "Water"), seed, 1, 1, false, true, true, null);

        // Drive real playback and issue orders through the rewind path, which is
        // what makes the recorded ticks non-trivial: each command lands on
        // playbackTick + 1, not on the sim's leading edge.
        let tick = 0;
        for (let guard = 0; guard < DUEL_TPS * 200 && !live.finishedAt(tick); guard++) {
            live.advance(tick);
            if (!live.settled) {
                if (tick % 17 === 0) live.command({ kind: "ability", actorId: "player-0", idx: (tick / 17) % 4 });
                if (tick % 43 === 0) live.command({ kind: "stance", actorId: "player-0", stance: (tick / 43) % 3 });
            }
            tick++;
        }

        const log = live.inputLog();
        assert.ok(log.length > 0, `seed ${seed} issued no commands — the test would prove nothing`);
        // Ticks must be non-decreasing, or the server's parser rejects the log.
        for (let i = 1; i < log.length; i++) {
            assert.ok(log[i].t >= log[i - 1].t, `seed ${seed} logged an out-of-order tick`);
        }
        assert.deepEqual(replayInputLog(make, log), live.outcome(), `seed ${seed} replay diverged from the played fight`);
    }
});

test("an empty input log replays as the uncommanded fight", () => {
    // This is what scores a duel the player watched without touching the deck,
    // and it is why battle-start can seal its baseline through the same helper.
    for (const seed of [7, 19]) {
        const make = () => createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), seed, 1, 1, false, true, true, null, false);
        assert.deepEqual(
            replayInputLog(make, []),
            runPetDuelCinematic(pet("P", "Fire"), pet("Q", "Water"), seed, 1, 1, false, true, true, null, false),
            `seed ${seed} empty-log replay is not the AI fight`,
        );
    }
});
