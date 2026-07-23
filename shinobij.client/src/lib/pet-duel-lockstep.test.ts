// Tests for the two-player lockstep duel (docs/pet-coliseum-player-control-plan.md §10).
//
// The whole point of lockstep is that two machines, each commanding one pet and
// exchanging only sparse scheduled commands, converge on the SAME fight. So the
// central test drives two independent sessions through a simulated server and
// asserts their timelines are byte-identical — which is also what lets the server
// replay the merged log to decide the winner.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import {
    createLockstepDuel, INPUT_DELAY_TICKS,
    type LockstepDuel, type LockstepInput,
} from "./pet-duel-lockstep";
import { DUEL_TPS } from "./pet-duel-sim";

function pet(id: string, element: string): Pet {
    return {
        id, name: id, species: id, level: 20,
        hp: 820, attack: 92, defense: 44, speed: 96,
        element, trait: "Swift",
        jutsus: [
            { name: "Fang Strike", kind: "damage", power: 104, cooldown: 1 },
            { name: "Ember Coil", kind: "burn", power: 88, cooldown: 3 },
            { name: "Stone Ward", kind: "shield", power: 60, cooldown: 4 },
            { name: "Ruin Fang", kind: "crush", power: 182, cooldown: 6, signature: true },
        ],
    } as unknown as Pet;
}

/**
 * A stand-in for the server: assigns the authoritative seq, and computes the
 * watermark as `min(both players' reported progress) + INPUT_DELAY_TICKS` —
 * the rule that makes a tick settled for both sides.
 */
function makeRelay() {
    const inputs: LockstepInput[] = [];
    const progress = { A: -1, B: -1 };
    let seq = 0;
    return {
        accept(from: "A" | "B", proposal: LockstepInput) {
            const stamped: LockstepInput = { tick: proposal.tick, seq: seq++, cmd: proposal.cmd };
            assert.ok(stamped.tick > this.safeTick(), `a command must never be scheduled at or below the watermark (from ${from})`);
            inputs.push(stamped);
        },
        report(who: "A" | "B", tick: number) { progress[who] = Math.max(progress[who], tick); },
        safeTick() { return Math.min(progress.A, progress.B) + INPUT_DELAY_TICKS; },
        update() { return { safeTick: this.safeTick(), inputs: [...inputs] }; },
        inputs: () => inputs,
    };
}

/** Run both sides to completion, exchanging through the relay each round. */
function runPair(a: LockstepDuel, b: LockstepDuel, relay: ReturnType<typeof makeRelay>, script: Array<{ at: number; who: "A" | "B"; cmd: Parameters<LockstepDuel["command"]>[0] }>) {
    const fired = new Set<number>();
    let playback = 0;
    for (let round = 0; round < 4000 && !(a.settled && b.settled); round++) {
        // Both clients pull the same authoritative view before advancing.
        a.ingest(relay.update());
        b.ingest(relay.update());
        a.advance(playback);
        b.advance(playback);
        relay.report("A", a.progressTick);
        relay.report("B", b.progressTick);
        script.forEach((entry, i) => {
            if (fired.has(i) || playback < entry.at) return;
            fired.add(i);
            (entry.who === "A" ? a : b).command(entry.cmd);
        });
        // Playback creeps forward only as fast as the watermark allows, which is
        // exactly how the renderer's clock behaves when it hits a stall.
        playback = Math.min(playback + 8, Math.max(0, relay.safeTick()));
    }
    return { a, b };
}

function pairFor(script: Parameters<typeof runPair>[3], seed = 21) {
    const relay = makeRelay();
    const a = createLockstepDuel(pet("P", "Fire"), pet("Q", "Water"), seed, "player", (p) => relay.accept("A", p));
    const b = createLockstepDuel(pet("P", "Fire"), pet("Q", "Water"), seed, "enemy", (p) => relay.accept("B", p));
    runPair(a, b, relay, script);
    return { a, b, relay };
}

test("two lockstep clients with no commands produce identical fights", () => {
    const { a, b } = pairFor([]);
    assert.ok(a.settled && b.settled, "both sides should reach a result");
    assert.deepEqual(a.outcome(), b.outcome(), "an uncommanded lockstep duel must converge");
});

test("two clients each commanding their own pet converge on the same fight", () => {
    const { a, b, relay } = pairFor([
        { at: DUEL_TPS * 1, who: "A", cmd: { kind: "ability", actorId: "player-0", idx: 1 } },
        { at: DUEL_TPS * 2, who: "B", cmd: { kind: "ability", actorId: "enemy-0", idx: 0 } },
        { at: DUEL_TPS * 3, who: "A", cmd: { kind: "stance", actorId: "player-0", stance: 0 } },
        { at: DUEL_TPS * 4, who: "B", cmd: { kind: "stance", actorId: "enemy-0", stance: 2 } },
        { at: DUEL_TPS * 6, who: "A", cmd: { kind: "break", actorId: "player-0" } },
    ]);
    assert.ok(relay.inputs().length >= 5, "every scripted command should have reached the relay");
    assert.ok(a.settled && b.settled, "both sides should reach a result");
    const ra = a.outcome(), rb = b.outcome();
    assert.equal(ra.result, rb.result, "the two clients must agree on the winner");
    assert.equal(ra.ticks, rb.ticks, "the two clients must agree on the fight length");
    assert.deepEqual(ra.snapshots, rb.snapshots, "timelines must be byte-identical");
    assert.deepEqual(ra.events, rb.events, "event logs must be byte-identical");
});

test("both clients apply the identical command set at identical ticks", () => {
    const { a, b } = pairFor([
        { at: DUEL_TPS * 1, who: "A", cmd: { kind: "ability", actorId: "player-0", idx: 1 } },
        { at: DUEL_TPS * 2, who: "B", cmd: { kind: "ability", actorId: "enemy-0", idx: 2 } },
    ]);
    assert.deepEqual(a.inputLog(), b.inputLog(), "the applied logs are the shared source of truth for the server replay");
    assert.ok(a.inputLog().length >= 2);
});

test("a command is never scheduled at or below the settled watermark", () => {
    // makeRelay asserts this on every accept; a command landing at or before the
    // watermark would be applied by one client and skipped by the other.
    const { relay } = pairFor([
        { at: DUEL_TPS * 1, who: "A", cmd: { kind: "ability", actorId: "player-0", idx: 0 } },
        { at: DUEL_TPS * 2, who: "B", cmd: { kind: "ability", actorId: "enemy-0", idx: 1 } },
        { at: DUEL_TPS * 3, who: "A", cmd: { kind: "ability", actorId: "player-0", idx: 2 } },
    ]);
    for (const input of relay.inputs()) assert.ok(input.tick >= INPUT_DELAY_TICKS, "orders schedule ahead, never in the past");
});

test("simulation never runs past the watermark", () => {
    const relay = makeRelay();
    const a = createLockstepDuel(pet("P", "Fire"), pet("Q", "Water"), 5, "player", (p) => relay.accept("A", p));
    // Only one side ever reports progress, so the watermark stays pinned and the
    // client must refuse to simulate — this is the stall a dropped peer causes.
    relay.report("A", 500);
    a.ingest(relay.update());
    a.advance(400);
    assert.equal(a.safeTick, -1 + INPUT_DELAY_TICKS, "the watermark is gated by the SLOWER peer");
    assert.ok(a.progressTick <= a.safeTick, "the client must not simulate past the watermark");
    assert.equal(a.stalled, true, "and it should report itself stalled so the UI can say so");
});

test("ingest is idempotent and order-independent", () => {
    const relay = makeRelay();
    const a = createLockstepDuel(pet("P", "Fire"), pet("Q", "Water"), 9, "player", (p) => relay.accept("A", p));
    const b = createLockstepDuel(pet("P", "Fire"), pet("Q", "Water"), 9, "player", (p) => relay.accept("A", p));
    const inputs: LockstepInput[] = [
        { tick: 40, seq: 1, cmd: { kind: "ability", actorId: "player-0", idx: 1 } },
        { tick: 40, seq: 0, cmd: { kind: "stance", actorId: "player-0", stance: 2 } },
        { tick: 80, seq: 2, cmd: { kind: "ability", actorId: "player-0", idx: 0 } },
    ];
    // a: delivered in order, once. b: shuffled, duplicated, and split.
    a.ingest({ safeTick: 600, inputs });
    b.ingest({ safeTick: 300, inputs: [inputs[2], inputs[1]] });
    b.ingest({ safeTick: 600, inputs: [inputs[1], inputs[0], inputs[2], inputs[0]] });
    b.ingest({ safeTick: 100, inputs: [] });   // a stale watermark must not move it back
    assert.equal(b.safeTick, 600, "the watermark only moves forward");
    for (let t = 0; t < 900; t += 30) { a.advance(t); b.advance(t); }
    assert.deepEqual(a.inputLog(), b.inputLog(), "duplicate and out-of-order delivery must not change what is applied");
    assert.deepEqual(a.view().snapshots, b.view().snapshots, "…nor the resulting fight");
});

test("a dropped player's pet falls back to standing orders, and both clients stay in step", () => {
    // The fairness case: a pet whose owner is gone must not become a punching bag.
    // The doctrine is evaluated identically on both clients from the same tick, so
    // nothing about the hand-over crosses the wire — which is the only reason it
    // is safe to do mid-lockstep at all.
    const relay = makeRelay();
    const a = createLockstepDuel(pet("P", "Fire"), pet("Q", "Water"), 31, "player", (p) => relay.accept("A", p));
    const b = createLockstepDuel(pet("P", "Fire"), pet("Q", "Water"), 31, "enemy", (p) => relay.accept("B", p));
    const fallback = { actorIds: ["enemy-0"], doctrine: { stance: 2, priority: [1, 0], breakAt: "ready" as const } };
    // Both sides are told at the SAME tick — the server derives it from the drop.
    a.handOverToDoctrine(fallback, 60);
    b.handOverToDoctrine(fallback, 60);
    runPair(a, b, relay, [
        { at: DUEL_TPS * 3, who: "A", cmd: { kind: "ability", actorId: "player-0", idx: 1 } },
    ]);
    assert.ok(a.settled && b.settled, "the fight still finishes without the dropped player");
    assert.deepEqual(a.outcome().snapshots, b.outcome().snapshots, "an autonomous pet must not desynchronise the timeline");
    assert.deepEqual(a.inputLog(), b.inputLog(), "including the orders the doctrine issued on its behalf");
    assert.ok(a.inputLog().some((e) => e.cmd.actorId === "enemy-0"), "the briefed pet actually acted");
});

test("handing the same side over twice is ignored", () => {
    const relay = makeRelay();
    const a = createLockstepDuel(pet("P", "Fire"), pet("Q", "Water"), 33, "player", (p) => relay.accept("A", p));
    const fallback = { actorIds: ["enemy-0"], doctrine: { stance: 1, priority: [0], breakAt: "never" as const } };
    a.handOverToDoctrine(fallback, 30);
    a.handOverToDoctrine(fallback, 90);
    relay.report("A", 0); relay.report("B", 0);
    a.ingest(relay.update());
    a.advance(0);
    // A duplicated hand-over would double every order the doctrine issues.
    const enemyOrders = a.inputLog().filter((e) => e.cmd.actorId === "enemy-0");
    assert.equal(new Set(enemyOrders.map((e) => `${e.t}:${e.cmd.kind}`)).size, enemyOrders.length, "no duplicated doctrine orders");
});

test("a client tracks what it has proposed until the server confirms it", () => {
    const relay = makeRelay();
    const a = createLockstepDuel(pet("P", "Fire"), pet("Q", "Water"), 13, "player", (p) => relay.accept("A", p));
    // Report the progress this client ACTUALLY reached — reporting a tick it has
    // not simulated would make the relay's watermark describe a fight that does
    // not exist, which is the mismatch the accept-side assertion is there to catch.
    for (let t = 0; t <= 60; t += 10) {
        a.ingest(relay.update());
        a.advance(t);
        relay.report("A", a.progressTick);
        relay.report("B", a.progressTick);
    }
    a.command({ kind: "ability", actorId: "player-0", idx: 1 });
    assert.equal(a.pending().length, 1, "an unconfirmed proposal is retained so the caller can resend it");
    a.ingest(relay.update());
    assert.equal(a.pending().length, 0, "and retired once the server echoes it back");
});
