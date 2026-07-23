// Tests for standing orders (docs/pet-coliseum-player-control-plan.md §11).
//
// The doctrine is what makes a garrison worth leaving: an unattended pet fights
// to its owner's plan instead of bare AI, so an attacker who shows up is beating
// a briefed defender rather than a rock. These tests pin the decisions that plan
// is allowed to make.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    doctrineCommand, parseDoctrine, runDoctrineDuel, DEFAULT_DOCTRINE,
    type DoctrineView, type PetDoctrine,
} from "./pet-duel-doctrine";
import { BOND_FULL } from "./pet-bond-meter";
import type { Pet } from "../types/pet";

/** A garrison-grade pet for the whole-duel cases below. */
const gPet = (id: string, element: string): Pet => ({
    id, name: id, species: id, level: 20,
    hp: 820, attack: 92, defense: 44, speed: 96,
    element, trait: "Swift",
    jutsus: [
        { name: "Fang Strike", kind: "damage", power: 104, cooldown: 1 },
        { name: "Ember Coil", kind: "burn", power: 88, cooldown: 3 },
        { name: "Stone Ward", kind: "shield", power: 60, cooldown: 4 },
        { name: "Ruin Fang", kind: "crush", power: 182, cooldown: 6, signature: true },
    ],
} as unknown as Pet);

const ability = (over: Partial<DoctrineView["abilities"][number]> = {}) =>
    ({ cdLeft: 0, cost: 20, signature: false, isMove: false, support: false, ...over });

const view = (over: Partial<DoctrineView> = {}): DoctrineView => ({
    tick: 60,
    selfHpFrac: 1, foeHpFrac: 1,
    bond: 0, stance: 1, orderedIdx: -2, breakPending: false, stamina: 100,
    abilities: [ability(), ability(), ability({ support: true }), ability({ signature: true, cost: 40 })],
    ...over,
});

const DOC: PetDoctrine = { stance: 0, priority: [1, 0], breakAt: "ready" };

test("stance is set once, on the opening tick", () => {
    assert.deepEqual(
        doctrineCommand("player-0", DOC, view({ tick: 0, stance: 1 })),
        { kind: "stance", actorId: "player-0", stance: 0 },
    );
    // Already in the right stance: fall straight through to picking a move.
    assert.equal(doctrineCommand("player-0", DOC, view({ tick: 0, stance: 0 }))?.kind, "ability");
    // Mid-fight it is too late to re-open the question — the pet has committed.
    const mid = doctrineCommand("player-0", DOC, view({ tick: 200, stance: 1 }));
    assert.notEqual(mid?.kind, "stance");
});

test("the highest-priority usable move is the one ordered", () => {
    const cmd = doctrineCommand("player-0", DOC, view({ tick: 90 }));
    assert.deepEqual(cmd, { kind: "ability", actorId: "player-0", idx: 1 }, "slot 1 is first in the priority list");
});

test("an unusable move is skipped, not waited on", () => {
    // Slot 1 is on cooldown, so the plan falls through to its second choice
    // rather than stalling — a doctrine that waits is a doctrine that loses.
    const abilities = [ability(), ability({ cdLeft: 40 }), ability({ support: true }), ability({ signature: true })];
    assert.deepEqual(
        doctrineCommand("player-0", DOC, view({ tick: 90, abilities })),
        { kind: "ability", actorId: "player-0", idx: 0 },
    );
    // Unaffordable counts as unusable too.
    const broke = view({ tick: 90, stamina: 5 });
    assert.equal(doctrineCommand("player-0", DOC, broke), null, "nothing affordable → leave it to the pet's own AI");
});

test("the signature is never ordered directly — it is the Break's job", () => {
    const doc: PetDoctrine = { stance: 1, priority: [3, 0], breakAt: "never" };
    const cmd = doctrineCommand("player-0", doc, view({ tick: 90 }));
    assert.deepEqual(cmd, { kind: "ability", actorId: "player-0", idx: 0 }, "slot 3 is the signature and is skipped");
});

test("a standing order in flight is left alone", () => {
    assert.equal(doctrineCommand("player-0", DOC, view({ tick: 90, orderedIdx: 1 })), null,
        "a doctrine nudges the pet; it does not re-issue every tick");
});

test("breakAt: ready spends the meter the moment it fills", () => {
    // One short of full, the plan gets on with ordering moves.
    assert.equal(doctrineCommand("player-0", DOC, view({ bond: BOND_FULL - 1 }))?.kind, "ability");
    // Full: the Break outranks the move order.
    assert.deepEqual(doctrineCommand("player-0", DOC, view({ bond: BOND_FULL })), { kind: "break", actorId: "player-0" });
});

test("breakAt: foeBloodied holds until the opponent is under half", () => {
    const doc: PetDoctrine = { ...DOC, breakAt: "foeBloodied" };
    assert.notEqual(doctrineCommand("player-0", doc, view({ bond: BOND_FULL, foeHpFrac: 0.8 }))?.kind, "break");
    assert.deepEqual(
        doctrineCommand("player-0", doc, view({ bond: BOND_FULL, foeHpFrac: 0.4 })),
        { kind: "break", actorId: "player-0" },
    );
});

test("breakAt: finisher also fires when the pet itself is about to die", () => {
    const doc: PetDoctrine = { ...DOC, breakAt: "finisher" };
    assert.notEqual(doctrineCommand("player-0", doc, view({ bond: BOND_FULL, foeHpFrac: 0.6, selfHpFrac: 0.9 }))?.kind, "break");
    assert.deepEqual(
        doctrineCommand("player-0", doc, view({ bond: BOND_FULL, foeHpFrac: 0.2 })),
        { kind: "break", actorId: "player-0" }, "the kill window",
    );
    assert.deepEqual(
        doctrineCommand("player-0", doc, view({ bond: BOND_FULL, foeHpFrac: 0.9, selfHpFrac: 0.15 })),
        { kind: "break", actorId: "player-0" }, "an unspent Break is worth nothing once the pet is down",
    );
});

test("breakAt: never leaves the meter unspent", () => {
    const doc: PetDoctrine = { ...DOC, breakAt: "never" };
    assert.notEqual(doctrineCommand("player-0", doc, view({ bond: BOND_FULL, foeHpFrac: 0.1 }))?.kind, "break");
});

test("a Break already in flight is not re-issued", () => {
    assert.notEqual(
        doctrineCommand("player-0", DOC, view({ bond: BOND_FULL, breakPending: true }))?.kind,
        "break",
    );
});

test("the default doctrine changes nothing about how a pet fights", () => {
    // An owner who never opens the doctrine screen must be exactly as well off as
    // before this feature existed.
    assert.equal(DEFAULT_DOCTRINE.priority.length, 0);
    assert.equal(doctrineCommand("player-0", DEFAULT_DOCTRINE, view({ tick: 90 })), null);
    assert.equal(doctrineCommand("player-0", DEFAULT_DOCTRINE, view({ tick: 0, stance: 1 })), null);
});

test("a garrison clash is deterministic in (pets, seed, doctrines)", () => {
    // Sector war records the winner server-side and the client replays it. If this
    // were not reproducible the two would disagree and the banner would lie.
    const args = () => [gPet("Holder", "Earth"), gPet("Raider", "Fire"), 4242] as const;
    const doc = { stance: 2, priority: [1, 0], breakAt: "foeBloodied" as const };
    const raid = { stance: 0, priority: [0, 1], breakAt: "ready" as const };
    const a = runDoctrineDuel(...args(), doc, raid, { applyItems: false, accuracy: false, terrain: null });
    const b = runDoctrineDuel(...args(), doc, raid, { applyItems: false, accuracy: false, terrain: null });
    assert.equal(a.result, b.result);
    assert.equal(a.ticks, b.ticks);
    assert.deepEqual(a.snapshots, b.snapshots, "client replay and server resolve must be byte-identical");
});

test("both garrisons fight to THEIR OWN orders — the clash is symmetric", () => {
    // The fairness property. Swapping which side holds the aggressive plan must
    // change the fight; if only one side's doctrine were read, it would not.
    const bold = { stance: 0, priority: [0, 1], breakAt: "ready" as const };
    const wary = { stance: 2, priority: [2], breakAt: "never" as const };
    const boldHolds = runDoctrineDuel(gPet("A", "Earth"), gPet("B", "Fire"), 77, bold, wary);
    const waryHolds = runDoctrineDuel(gPet("A", "Earth"), gPet("B", "Fire"), 77, wary, bold);
    assert.notDeepEqual(boldHolds.snapshots, waryHolds.snapshots, "each side's plan must actually drive its own pet");
});

test("an unbriefed garrison still fights, it just fights as before", () => {
    const briefed = runDoctrineDuel(gPet("A", "Earth"), gPet("B", "Fire"), 91,
        { stance: 0, priority: [0, 1], breakAt: "ready" }, DEFAULT_DOCTRINE);
    const plain = runDoctrineDuel(gPet("A", "Earth"), gPet("B", "Fire"), 91, DEFAULT_DOCTRINE, DEFAULT_DOCTRINE);
    assert.ok(plain.ticks > 0, "a pet with no standing orders is not a passenger");
    assert.notDeepEqual(briefed.snapshots, plain.snapshots, "and a briefed one fights differently");
});

test("a malformed stored doctrine degrades instead of crashing a fight", () => {
    assert.deepEqual(parseDoctrine(null), DEFAULT_DOCTRINE);
    assert.deepEqual(parseDoctrine("nonsense"), DEFAULT_DOCTRINE);
    const cleaned = parseDoctrine({ stance: 99, breakAt: "explode", priority: [1, 1, 7, -3, "x", 0] }, 4);
    assert.equal(cleaned.stance, 2, "an out-of-range stance clamps");
    assert.equal(cleaned.breakAt, "ready", "an unknown rule falls back");
    assert.deepEqual(cleaned.priority, [1, 0], "duplicates and out-of-range slots are dropped");
});
