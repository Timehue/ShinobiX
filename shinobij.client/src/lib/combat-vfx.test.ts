import { test } from "node:test";
import assert from "node:assert/strict";
import {
    COMBAT_VFX_REGISTRY,
    resolveCombatVfxSpec,
    safeCombatVfxSpec,
    type CombatVfxKey,
} from "./combat-vfx.ts";
import type { JutsuTag } from "../types/combat.ts";

const tag = (name: string): JutsuTag => ({ name, percent: 30 });

function keyForElement(element: string): CombatVfxKey {
    return resolveCombatVfxSpec({ action: "jutsu", element, target: "OPPONENT" }).key;
}

test("core elemental jutsu map to distinct combat VFX", () => {
    const keys = ["Fire", "Water", "Wind", "Lightning", "Earth"].map(keyForElement);
    assert.deepEqual(keys, ["fire", "water", "wind", "lightning", "earth"]);
    assert.equal(new Set(keys).size, 5);
});

test("bloodline element jutsu map to distinct combat VFX", () => {
    assert.equal(keyForElement("Blood"), "blood");
    assert.equal(keyForElement("Shadow"), "shadow");
    assert.equal(keyForElement("Lava"), "magma");
    assert.equal(keyForElement("Iron"), "metal");
});

test("heal, shield, and buff self-casts target the caster", () => {
    assert.deepEqual(resolveCombatVfxSpec({ action: "jutsu", target: "SELF", tags: [tag("Heal")] }), {
        key: "heal",
        target: "caster",
        intensity: "normal",
        durationMs: COMBAT_VFX_REGISTRY.heal.durationMs,
        persistent: false,
        maxParticles: COMBAT_VFX_REGISTRY.heal.maxParticles,
        tiles: undefined,
    });
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", target: "SELF", tags: [tag("Shield")] }).target, "caster");
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", target: "SELF", tags: [tag("Increase Generals")] }).target, "caster");
});

test("offensive jutsu target the enemy", () => {
    const spec = resolveCombatVfxSpec({ action: "jutsu", element: "Fire", target: "OPPONENT" });
    assert.equal(spec.key, "fire");
    assert.equal(spec.target, "target");
});

test("AoE and ground jutsu return area or tile VFX", () => {
    const area = resolveCombatVfxSpec({ action: "jutsu", element: "Earth", method: "AOE_CIRCLE", tiles: [1, 2, 3] });
    assert.equal(area.target, "area");
    assert.deepEqual(area.tiles, [1, 2, 3]);
    const ground = resolveCombatVfxSpec({ action: "jutsu", tags: [tag("Poison")], target: "EMPTY_GROUND", ground: true, tiles: [4, 5] });
    assert.equal(ground.key, "poisonCloud");
    assert.equal(ground.target, "tile");
});

test("weapon hits, named weapon hits, and throwables use distinct keys", () => {
    const weapon = resolveCombatVfxSpec({ action: "weapon" });
    const named = resolveCombatVfxSpec({ action: "weapon", named: true });
    const thrown = resolveCombatVfxSpec({ action: "throwable" });
    assert.equal(weapon.key, "weapon");
    assert.equal(named.key, "namedWeapon");
    assert.equal(thrown.key, "throwable");
    assert.equal(new Set([weapon.key, named.key, thrown.key]).size, 3);
});

test("status and damage-over-time tags map distinctly", () => {
    const pairs: Array<[string, CombatVfxKey]> = [
        ["Stun", "spark"],
        ["Seal", "seal"],
        ["Wound", "wound"],
        ["Ignition", "burn"],
        ["Poison", "poison"],
        ["Drain", "drain"],
        ["Siphon", "drain"],
    ];
    for (const [name, key] of pairs) {
        assert.equal(resolveCombatVfxSpec({ action: "jutsu", tags: [tag(name)] }).key, key);
    }
});

test("cleanse, buff, and debuff actions are visually distinct", () => {
    assert.equal(resolveCombatVfxSpec({ action: "cleanse" }).key, "cleanse");
    assert.equal(resolveCombatVfxSpec({ action: "consumable", tags: [tag("Increase Damage Given")] }).key, "buff");
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", tags: [tag("Decrease Damage Given")] }).key, "debuff");
});

test("KO and heavy hits escalate intensity", () => {
    const heavy = resolveCombatVfxSpec({ action: "basicAttack", heavy: true });
    assert.equal(heavy.key, "heavy");
    assert.equal(heavy.intensity, "heavy");
    const ko = resolveCombatVfxSpec({ action: "jutsu", element: "Fire", ko: true });
    assert.equal(ko.key, "ko");
    assert.equal(ko.intensity, "finisher");
});

test("missing or unknown combat actions fall back safely", () => {
    assert.equal(resolveCombatVfxSpec({ action: "unknown" }).key, "impact");
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", element: "Glass" }).key, "impact");
    assert.equal(safeCombatVfxSpec({ key: "not-real" as CombatVfxKey }).key, "impact");
});

test("registry exposes only the supported generic combat VFX keys", () => {
    const supported = new Set<CombatVfxKey>([
        "fire", "water", "wind", "lightning", "earth", "blood", "shadow", "poison",
        "magma", "metal", "slash", "impact", "pierce", "heal", "shield", "reflect",
        "absorb", "spark", "seal", "wound", "burn", "poisonCloud", "drain", "cleanse",
        "buff", "debuff", "throwable", "weapon", "namedWeapon", "heavy", "ko",
    ]);
    assert.deepEqual(new Set(Object.keys(COMBAT_VFX_REGISTRY)), supported);
});
