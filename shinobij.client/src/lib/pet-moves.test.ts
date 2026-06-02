import { test } from "node:test";
import assert from "node:assert/strict";
import type { PetJutsu } from "../types/pet";
import {
    jutsuToPetMove,
    petMoveset,
    PET_BASE_ACTIONS,
    BATTLE_STATUS_DEFS,
    collectActorStatuses,
    aoeDamageMultiplier,
    petMoveTargetIds,
    PET_AOE_DAMAGE_MULT,
} from "./pet-moves";
import type { BattleStatusId, PetBaseAction } from "../types/pet-battle";

function j(kind: PetJutsu["kind"], over: Partial<PetJutsu> = {}): PetJutsu {
    return { name: over.name ?? `${kind} move`, power: 50, cooldown: 3, currentCooldown: 0, kind, ...over };
}

// ── jutsuToPetMove ───────────────────────────────────────────────────────

test("a damage jutsu projects to a melee descriptor", () => {
    const m = jutsuToPetMove(j("damage", { name: "Claw Swipe", power: 40 }), { element: "Fire" });
    assert.equal(m.id, "claw-swipe");
    assert.equal(m.power, 40);
    assert.deepEqual(m.range, { min: 1, max: 2 });
    assert.ok(m.tags.includes("melee"));
    assert.equal(m.animationType, "melee_lunge");
    assert.equal(m.aiHint, "damage");
    assert.equal(m.vfxKey, "fire");      // damage takes the pet's element tint
    assert.ok(m.accuracy > 0 && m.accuracy <= 100);
});

test("a DoT jutsu is ranged with the dot tag + poison VFX", () => {
    const m = jutsuToPetMove(j("dot", { name: "Venom Spit" }));
    assert.ok(m.tags.includes("ranged") && m.tags.includes("dot"));
    assert.deepEqual(m.range, { min: 1, max: 4 });
    assert.equal(m.animationType, "ranged_projectile");
    assert.equal(m.vfxKey, "poison");
    assert.equal(m.aiHint, "debuff");
});

test("self moves have zero range; heal/shield/buff map sensibly", () => {
    assert.deepEqual(jutsuToPetMove(j("heal")).range, { min: 0, max: 0 });
    assert.equal(jutsuToPetMove(j("heal")).aiHint, "heal");
    assert.ok(jutsuToPetMove(j("shield")).tags.includes("shield"));
    assert.equal(jutsuToPetMove(j("barrier")).aiHint, "defense");
    assert.equal(jutsuToPetMove(j("buff")).animationType, "self_buff");
});

test("control kinds carry control hints + themed VFX", () => {
    assert.equal(jutsuToPetMove(j("stun")).aiHint, "control");
    assert.equal(jutsuToPetMove(j("stun")).vfxKey, "lightning");
    assert.equal(jutsuToPetMove(j("freeze")).vfxKey, "ice");
    assert.ok(jutsuToPetMove(j("movelock")).tags.includes("root"));
});

test("a signature move gains the execute + charge tags and an execute hint", () => {
    const m = jutsuToPetMove(j("lifesteal", { name: "Soul Devour", signature: true }), { element: "Earth" });
    assert.ok(m.tags.includes("execute"));
    assert.ok(m.tags.includes("charge"));
    assert.equal(m.aiHint, "execute");
});

test("jutsuToPetMove derives a target type (self vs single-enemy)", () => {
    assert.equal(jutsuToPetMove(j("damage")).targetType, "singleEnemy");
    assert.equal(jutsuToPetMove(j("dot")).targetType, "singleEnemy");
    assert.equal(jutsuToPetMove(j("heal")).targetType, "self");
    assert.equal(jutsuToPetMove(j("shield")).targetType, "self");
    assert.equal(jutsuToPetMove(j("buff")).targetType, "self");
});

test("Phase 12 kinds project to the right descriptors", () => {
    // wound = melee bleed (single enemy); haste = self buff; slow/pull = ranged control.
    const wound = jutsuToPetMove(j("wound"));
    assert.ok(wound.tags.includes("dot"));
    assert.equal(wound.targetType, "singleEnemy");
    assert.equal(jutsuToPetMove(j("haste")).targetType, "self");
    assert.equal(jutsuToPetMove(j("haste")).aiHint, "buff");
    assert.ok(jutsuToPetMove(j("slow")).tags.includes("slow"));
    assert.equal(jutsuToPetMove(j("slow")).aiHint, "control");
    assert.ok(jutsuToPetMove(j("push")).tags.includes("push"));
    assert.ok(jutsuToPetMove(j("pull")).tags.includes("pull"));
    assert.equal(jutsuToPetMove(j("mark")).aiHint, "debuff");
    assert.equal(jutsuToPetMove(j("taunt")).aiHint, "defense");
});

test("the new statuses surface as badges", () => {
    const out = collectActorStatuses({ wound: 3, marked: true, slow: 2, haste: 1, taunted: true });
    const ids = out.map(s => s.id);
    assert.ok(ids.includes("wound"));
    assert.ok(ids.includes("marked"));
    assert.ok(ids.includes("slow"));
    assert.ok(ids.includes("haste"));
    assert.ok(ids.includes("taunted"));
});

test("petMoveset maps a whole kit", () => {
    const moves = petMoveset({ jutsus: [j("damage"), j("heal"), j("stun")], element: "Water" });
    assert.equal(moves.length, 3);
    assert.deepEqual(moves.map(m => m.aiHint), ["damage", "heal", "control"]);
});

// ── Registries ─────────────────────────────────────────────────────────────

test("PET_BASE_ACTIONS defines all seven base actions", () => {
    const ids: PetBaseAction[] = ["move", "basicAttack", "guard", "evade", "focus", "brace", "useMove"];
    for (const id of ids) {
        assert.ok(PET_BASE_ACTIONS[id], id);
        assert.ok(PET_BASE_ACTIONS[id].name.length > 0);
        assert.ok(PET_BASE_ACTIONS[id].animationType.length > 0);
    }
});

test("BATTLE_STATUS_DEFS covers every status id with an icon + label", () => {
    const ids: BattleStatusId[] = [
        "burn", "poison", "wound", "slow", "haste", "root", "stun", "guarding",
        "shielded", "focused", "marked", "blinded", "taunted", "armorBroken", "countering", "reflecting",
    ];
    for (const id of ids) {
        const def = BATTLE_STATUS_DEFS[id];
        assert.equal(def.id, id);
        assert.ok(def.icon.length > 0, `${id} icon`);
        assert.ok(def.label.length > 0, `${id} label`);
    }
});

// ── collectActorStatuses ─────────────────────────────────────────────────

test("collectActorStatuses maps fighter flags to displayable statuses", () => {
    const out = collectActorStatuses({ poisoned: 3, burn: 2, guarding: true, focused: true });
    const byId = new Map(out.map(s => [s.id, s.rounds]));
    assert.equal(byId.get("poison"), 3);
    assert.equal(byId.get("burn"), 2);
    assert.equal(byId.get("guarding"), 1);
    assert.equal(byId.get("focused"), 1);
});

test("freeze folds into stun, confuse into blinded, evade into haste, moveLock into root", () => {
    const out = collectActorStatuses({ freeze: 2, confuse: 1, evading: true, moveLocked: true });
    const ids = out.map(s => s.id);
    assert.ok(ids.includes("stun"));
    assert.ok(ids.includes("blinded"));
    assert.ok(ids.includes("haste"));
    assert.ok(ids.includes("root"));
});

// ── AoE / multi-target (Phase 13c) ────────────────────────────────────────

test("an aoe jutsu becomes an allEnemies move; aoe support becomes allAllies", () => {
    const off = jutsuToPetMove(j("dot", { aoe: true }));
    assert.ok(off.tags.includes("aoe"));
    assert.equal(off.targetType, "allEnemies");
    const sup = jutsuToPetMove(j("heal", { aoe: true }));
    assert.equal(sup.targetType, "allAllies");
});

test("AoE damage is strictly less than single-target (ranked-safe)", () => {
    assert.ok(PET_AOE_DAMAGE_MULT < 1);
    assert.equal(aoeDamageMultiplier("allEnemies"), PET_AOE_DAMAGE_MULT);
    assert.equal(aoeDamageMultiplier("allPets"), PET_AOE_DAMAGE_MULT);
    assert.equal(aoeDamageMultiplier("singleEnemy"), 1);
    assert.equal(aoeDamageMultiplier("self"), 1);
});

test("petMoveTargetIds resolves the right pets per target type", () => {
    const teamOf = { me: "player", ally: "player", e1: "enemy", e2: "enemy" } as const;
    const living = ["me", "ally", "e1", "e2"];
    assert.deepEqual(petMoveTargetIds("self", "me", teamOf, living), ["me"]);
    assert.deepEqual(petMoveTargetIds("allEnemies", "me", teamOf, living).sort(), ["e1", "e2"]);
    assert.deepEqual(petMoveTargetIds("allAllies", "me", teamOf, living).sort(), ["ally", "me"]);
    assert.deepEqual(petMoveTargetIds("allPets", "me", teamOf, living).length, 4);
    assert.deepEqual(petMoveTargetIds("singleEnemy", "me", teamOf, living, "e2"), ["e2"]);
});

test("collectActorStatuses returns control/DoT threats before buffs", () => {
    const out = collectActorStatuses({ stun: 1, guarding: true, poisoned: 2 });
    const ids = out.map(s => s.id);
    assert.ok(ids.indexOf("stun") < ids.indexOf("guarding"));
    assert.ok(ids.indexOf("poison") < ids.indexOf("guarding"));
});
