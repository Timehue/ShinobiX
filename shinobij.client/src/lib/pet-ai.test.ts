import { test } from "node:test";
import assert from "node:assert/strict";
import type { PetMove } from "../types/pet-battle";
import { choosePetAction, choosePartyTarget, type PetAiState } from "./pet-ai";
import { makeArena, type PetBattleActor, type PetArchetype, type BattleStatus } from "./pet-tactics";

function actor(id: string, archetype: PetArchetype, row: number, col: number, over: Partial<PetBattleActor> = {}): PetBattleActor {
    return { id, name: id, hp: 100, maxHp: 100, position: { row, col }, archetype, statuses: [], cooldowns: {}, ...over };
}
const M = {
    meleeHit: { id: "claw", name: "Claw", description: "", power: 30, accuracy: 95, cooldown: 0, range: { min: 1, max: 2 }, tags: ["melee"], animationType: "melee_lunge", vfxKey: "none", aiHint: "damage", targetType: "singleEnemy" } as PetMove,
    rangedHit: { id: "bolt", name: "Bolt", description: "", power: 25, accuracy: 95, cooldown: 0, range: { min: 2, max: 5 }, tags: ["ranged"], animationType: "ranged_projectile", vfxKey: "lightning", aiHint: "damage", targetType: "singleEnemy" } as PetMove,
    execute: { id: "finish", name: "Finisher", description: "", power: 50, accuracy: 90, cooldown: 0, range: { min: 1, max: 2 }, tags: ["melee", "execute"], animationType: "melee_lunge", vfxKey: "shadow", aiHint: "execute", targetType: "singleEnemy" } as PetMove,
    heal: { id: "mend", name: "Mend", description: "", power: 0, accuracy: 100, cooldown: 0, range: { min: 0, max: 0 }, tags: ["heal"], animationType: "heal", vfxKey: "chakra", aiHint: "heal", targetType: "self" } as PetMove,
    root: { id: "snare", name: "Snare", description: "", power: 0, accuracy: 90, cooldown: 0, range: { min: 1, max: 4 }, tags: ["ranged", "root"], animationType: "beam", vfxKey: "shadow", aiHint: "control", targetType: "singleEnemy" } as PetMove,
    aoe: { id: "nova", name: "Nova", description: "", power: 24, accuracy: 90, cooldown: 0, range: { min: 1, max: 4 }, tags: ["ranged", "aoe"], animationType: "beam", vfxKey: "fire", aiHint: "damage", targetType: "allEnemies" } as PetMove,
};

function state(actors: PetBattleActor[], moves: Record<string, PetMove[]>, stats?: PetAiState["statsByActor"]): PetAiState {
    const teamOf: Record<string, "player" | "enemy"> = {};
    for (const a of actors) teamOf[a.id] = a.id === "me" ? "player" : "enemy";
    return { actors, teamOf, movesByActor: moves, statsByActor: stats, arena: makeArena([]), round: 2 };
}

test("kite: when the enemy is point-blank, retreats or evades (not melee)", () => {
    const me = actor("me", "kite", 3, 5);
    const foe = actor("foe", "bruiser", 3, 6);
    const d = choosePetAction(state([me, foe], { me: [M.rangedHit], foe: [] }), "me");
    assert.ok(d.action === "evade" || (d.action === "move" && d.moveDir === "away"), `got ${d.action}/${d.moveDir}`);
});

test("kite: a rooted enemy in range gets shot from afar", () => {
    const me = actor("me", "kite", 3, 2);
    const foe = actor("foe", "bruiser", 3, 5, { statuses: [{ kind: "moveLock", rounds: 2 } as BattleStatus] });
    const d = choosePetAction(state([me, foe], { me: [M.rangedHit], foe: [] }), "me");
    assert.equal(d.action, "useMove");
    assert.equal(d.moveId, "bolt");
});

test("tank: guards against a charging enemy", () => {
    const me = actor("me", "tank", 3, 4);
    const foe = actor("foe", "bruiser", 3, 6, { isCharging: true });
    const d = choosePetAction(state([me, foe], { me: [M.meleeHit], foe: [] }), "me");
    assert.equal(d.action, "guard");
});

test("assassin: executes a low-HP foe in range", () => {
    const me = actor("me", "assassin", 3, 5);
    const foe = actor("foe", "bruiser", 3, 6, { hp: 28 });
    const d = choosePetAction(state([me, foe], { me: [M.execute, M.meleeHit], foe: [] }), "me");
    assert.equal(d.action, "useMove");
    assert.equal(d.moveId, "finish");
});

test("support: heals itself when low", () => {
    const me = actor("me", "support", 3, 3, { hp: 18 });
    const foe = actor("foe", "bruiser", 3, 6);
    const d = choosePetAction(state([me, foe], { me: [M.heal, M.rangedHit], foe: [] }), "me");
    assert.equal(d.action, "useMove");
    assert.equal(d.moveId, "mend");
});

test("control: punishes a charging enemy with a control move", () => {
    const me = actor("me", "control", 3, 2);
    const foe = actor("foe", "bruiser", 3, 5, { isCharging: true });
    const d = choosePetAction(state([me, foe], { me: [M.root, M.rangedHit], foe: [] }), "me");
    assert.equal(d.action, "useMove");
    assert.equal(d.moveId, "snare");
});

test("a guaranteed KO is always taken", () => {
    const me = actor("me", "bruiser", 3, 5);
    const foe = actor("foe", "bruiser", 3, 6, { hp: 6 });
    const d = choosePetAction(
        state([me, foe], { me: [M.meleeHit], foe: [] }, { me: { attack: 30, defense: 20, speed: 20 }, foe: { attack: 20, defense: 10, speed: 20 } }),
        "me",
    );
    assert.equal(d.action, "useMove");
    assert.equal(d.moveId, "claw");
});

test("bruiser advances when the enemy is out of reach", () => {
    const me = actor("me", "bruiser", 3, 2);
    const foe = actor("foe", "bruiser", 3, 9);
    const d = choosePetAction(state([me, foe], { me: [M.meleeHit], foe: [] }), "me");
    assert.equal(d.action, "move");
    assert.equal(d.moveDir, "toward");
});

test("rooted pets never choose to move", () => {
    const me = actor("me", "bruiser", 3, 2, { statuses: [{ kind: "moveLock", rounds: 2 } as BattleStatus] });
    const foe = actor("foe", "bruiser", 3, 9);
    const d = choosePetAction(state([me, foe], { me: [M.meleeHit], foe: [] }), "me");
    assert.notEqual(d.action, "move");
});

test("the decision is deterministic for identical state", () => {
    const mk = () => state([actor("me", "kite", 3, 4), actor("foe", "bruiser", 3, 5)], { me: [M.rangedHit, M.meleeHit], foe: [] });
    assert.deepEqual(choosePetAction(mk(), "me"), choosePetAction(mk(), "me"));
});

// ── 2v2 targeting (choosePartyTarget) ────────────────────────────────────

test("choosePartyTarget: assassin/striker finish the lowest-HP enemy", () => {
    const me = actor("me", "assassin", 3, 3);
    const e1 = actor("e1", "bruiser", 3, 5, { hp: 80 });
    const e2 = actor("e2", "bruiser", 3, 6, { hp: 20 });
    const st = state([me, e1, e2], { me: [], e1: [], e2: [] });
    assert.equal(choosePartyTarget(st, "me"), "e2");
});

test("choosePartyTarget: tank/control pressure the biggest-attack threat", () => {
    const me = actor("me", "tank", 3, 3);
    const e1 = actor("e1", "bruiser", 3, 5, { hp: 50 });
    const e2 = actor("e2", "bruiser", 3, 6, { hp: 50 });
    const st = state([me, e1, e2], { me: [], e1: [], e2: [] }, {
        e1: { attack: 30, defense: 20, speed: 20 },
        e2: { attack: 75, defense: 20, speed: 20 },
    });
    assert.equal(choosePartyTarget(st, "me"), "e2");
});

// ── Deeper playstyle behaviors (Phase 13c) ────────────────────────────────

test("control: does NOT re-root an already-rooted foe (anti-waste)", () => {
    const me = actor("me", "control", 3, 3);
    const foe = actor("foe", "bruiser", 3, 5, { statuses: [{ kind: "moveLock", rounds: 2 } as BattleStatus] });
    // Holds both a root and a ranged hit; the root is wasted, so it should fire the hit.
    const d = choosePetAction(state([me, foe], { me: [M.root, M.rangedHit], foe: [] }), "me");
    assert.equal(d.action, "useMove");
    assert.equal(d.moveId, "bolt");  // not "snare"
});

test("AoE is chosen vs two enemies but avoided vs one", () => {
    const me = actor("me", "control", 3, 3);
    const e1 = actor("e1", "bruiser", 3, 5);
    const e2 = actor("e2", "bruiser", 3, 6);
    const two = choosePetAction(state([me, e1, e2], { me: [M.aoe, M.rangedHit], e1: [], e2: [] }), "me");
    assert.equal(two.action, "useMove");
    assert.equal(two.moveId, "nova");
    const one = choosePetAction(state([me, e1], { me: [M.aoe, M.rangedHit], e1: [] }), "me");
    assert.equal(one.action, "useMove");
    assert.equal(one.moveId, "bolt");  // single-target preferred against a lone foe
});

test("kite holds a range band — retreats when inside its firing distance", () => {
    // Ranged move reaches 5; sitting at distance 2 is too close, so it kites back.
    const me = actor("me", "kite", 3, 4);
    const foe = actor("foe", "bruiser", 3, 6); // dist 2, bolt is on cooldown so it must reposition
    const cd = { ...me, cooldowns: { bolt: 1 } };
    const d = choosePetAction(state([cd, foe], { me: [M.rangedHit], foe: [] }), "me");
    assert.ok(d.action === "move" && d.moveDir === "away", `got ${d.action}/${d.moveDir}`);
});

test("choosePartyTarget: control interrupts a charging enemy first", () => {
    const me = actor("me", "control", 3, 3);
    const e1 = actor("e1", "bruiser", 3, 5, { hp: 20 });
    const e2 = actor("e2", "bruiser", 3, 6, { hp: 90, isCharging: true });
    const st = state([me, e1, e2], { me: [], e1: [], e2: [] });
    assert.equal(choosePartyTarget(st, "me"), "e2");  // the charge, not the low-HP one
});
