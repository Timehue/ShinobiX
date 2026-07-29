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

test("an earned Command Window technique converges on both clients", () => {
    const { a, b, relay } = pairFor([
        // Passive charge alone fills the meter by this point, so the command is
        // valid even if neither fighter has landed a hit yet.
        { at: DUEL_TPS * 8, who: "A", cmd: { kind: "technique", actorId: "player-0", idx: 1 } },
    ], 33);

    const technique = relay.inputs().find((input) => input.cmd.kind === "technique");
    assert.ok(technique, "the earned technique should reach the authoritative relay");
    assert.ok(a.settled && b.settled, "both sides should reach a result");
    assert.deepEqual(a.inputLog(), b.inputLog(), "both clients must apply the technique at the same tick");
    assert.deepEqual(a.outcome(), b.outcome(), "the immediate technique must remain deterministic");
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

// ── CLASH in live PvP ─────────────────────────────────────────────────────────
//
// A bind freezes BOTH fighters and asks each player for a read. In lockstep that
// is only sound if the two clients agree on (a) that a bind opened, (b) at which
// tick, and (c) how it resolved — with each call travelling as an ordinary
// scheduled command. These tests drive two independent sessions and assert exactly
// that.

/** A MELEE-identity pet. The `pet()` helper above carries a burn, which makes it a
 *  kiter — and the live brawl profile deliberately leaves zoners alone, so it never
 *  closes to contact and never binds. */
function bruiser(id: string, element: string): Pet {
    return {
        id, name: id, species: id, level: 20,
        hp: 820, attack: 92, defense: 44, speed: 96,
        element, trait: "Swift",
        jutsus: [
            { name: "Fang Strike", kind: "damage", power: 104, cooldown: 1 },
            { name: "Rend", kind: "damage", power: 96, cooldown: 2 },
            { name: "Bloodlet", kind: "lifesteal", power: 88, cooldown: 4 },
            { name: "Ruin Fang", kind: "crush", power: 182, cooldown: 6, signature: true },
        ],
    } as unknown as Pet;
}

/** Run a bruiser pair, letting each side answer any bind it is shown. */
function clashPair(seed: number, answer: { A?: number; B?: number }) {
    const relay = makeRelay();
    const a = createLockstepDuel(bruiser("P", "Fire"), bruiser("Q", "Water"), seed, "player", (p) => relay.accept("A", p));
    const b = createLockstepDuel(bruiser("P", "Fire"), bruiser("Q", "Water"), seed, "enemy", (p) => relay.accept("B", p));
    const answered = new Set<string>();
    let playback = 0;
    for (let round = 0; round < 4000 && !(a.settled && b.settled); round++) {
        a.ingest(relay.update());
        b.ingest(relay.update());
        a.advance(playback);
        b.advance(playback);
        relay.report("A", a.progressTick);
        relay.report("B", b.progressTick);
        // Each client answers its OWN bind, exactly as the prompt would.
        for (const [who, duel, actor, pick] of [
            ["A", a, "player-0", answer.A], ["B", b, "enemy-0", answer.B],
        ] as const) {
            if (pick === undefined) continue;
            const bind = duel.clashAt(playback, actor);
            if (!bind || bind.pick >= 0) continue;
            const key = `${who}:${bind.startT}`;
            if (answered.has(key)) continue;
            answered.add(key);
            duel.command({ kind: "clash", actorId: actor, pick });
        }
        playback = Math.min(playback + 8, Math.max(0, relay.safeTick()));
    }
    return { a, b, relay, answered };
}

test("a clash bind opens on BOTH lockstep clients at the same tick", () => {
    const { a, b } = clashPair(21, {});
    const binds = (d: LockstepDuel) => d.outcome().events.filter((e) => e.move === "Clash Bind").map((e) => e.t);
    const ba = binds(a), bb = binds(b);
    assert.ok(ba.length > 0, "the PvP coliseum should produce clash binds");
    assert.deepEqual(ba, bb, "both clients must see the same binds at the same ticks");
});

test("two clients answering their own clash reads converge on one fight", () => {
    for (const [pa, pb] of [[0, 1], [1, 2], [2, 0], [1, 1]] as const) {
        const { a, b, answered } = clashPair(21, { A: pa, B: pb });
        assert.ok(answered.size > 0, `picks ${pa}/${pb}: at least one bind should have been answered`);
        assert.ok(a.settled && b.settled, `picks ${pa}/${pb}: both sides should reach a result`);
        const ra = a.outcome(), rb = b.outcome();
        assert.equal(ra.result, rb.result, `picks ${pa}/${pb}: the clients must agree on the winner`);
        assert.deepEqual(ra.snapshots, rb.snapshots, `picks ${pa}/${pb}: timelines must be byte-identical`);
        assert.deepEqual(ra.events, rb.events, `picks ${pa}/${pb}: event logs must be byte-identical`);
    }
});

test("a clash call reaches the engine — the read actually changes the fight", () => {
    // Guard and Dodge answer a bind differently, so the fights must diverge. If the
    // scheduled call were landing after the window closed, both would be the
    // default-read fight and this would fail.
    const guard = clashPair(21, { A: 1 });
    const dodge = clashPair(21, { A: 2 });
    assert.notDeepEqual(
        guard.a.outcome().events, dodge.a.outcome().events,
        "answering the bind differently must produce a different fight",
    );
});

test("one side answering and the other ignoring it still converges", () => {
    // The quiet side falls back to its pet's own instinctive read, which both
    // clients compute identically from the shared sim — nothing crosses the wire.
    const { a, b, answered } = clashPair(21, { A: 0 });
    assert.ok(answered.size > 0, "side A should have answered at least one bind");
    assert.ok(a.settled && b.settled, "both sides should reach a result");
    assert.deepEqual(a.outcome().snapshots, b.outcome().snapshots, "timelines must stay byte-identical");
    assert.deepEqual(a.outcome().events, b.outcome().events, "event logs must stay byte-identical");
});

test("a clash call is scheduled strictly past the watermark, like any other command", () => {
    // makeRelay asserts this on every accept; this test just proves clash calls
    // actually went through it rather than being dropped somewhere earlier.
    const { relay } = clashPair(21, { A: 1, B: 2 });
    const clashes = relay.inputs().filter((i) => i.cmd.kind === "clash");
    assert.ok(clashes.length > 0, "clash calls should reach the relay as ordinary scheduled inputs");
});
