import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
    COMBAT_VFX_REGISTRY,
    resolveCombatVfxSpec,
    safeCombatVfxSpec,
    type CombatVfxKey,
} from "./combat-vfx.ts";
import { COMBAT_VFX_ASSETS } from "./combat-vfx-assets.ts";
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

test("mixed hostile tags win over incidental guard tags", () => {
    const burn = resolveCombatVfxSpec({
        action: "jutsu",
        target: "OPPONENT",
        tags: [tag("Ignition"), tag("Absorb")],
    });
    assert.equal(burn.key, "burn");
    assert.equal(burn.target, "target");

    const drain = resolveCombatVfxSpec({
        action: "jutsu",
        target: "OPPONENT",
        tags: [tag("Absorb"), tag("Drain")],
    });
    assert.equal(drain.key, "drain");
    assert.equal(drain.target, "target");

    const overclock = resolveCombatVfxSpec({
        action: "jutsu",
        target: "OPPONENT",
        tags: [tag("Increase Generals"), tag("Overclock")],
    });
    assert.equal(overclock.key, "buff");
    assert.equal(overclock.target, "caster");
});

test("movement, element, and discipline fallbacks stay semantically paired", () => {
    const move = resolveCombatVfxSpec({
        action: "jutsu",
        discipline: "Taijutsu",
        element: "None",
        target: "EMPTY_GROUND",
        tags: [tag("Move"), tag("Reflect")],
    });
    assert.equal(move.key, "spark");
    assert.equal(move.target, "tile");

    const elementalDamage = resolveCombatVfxSpec({
        action: "jutsu",
        discipline: "Ninjutsu",
        element: "Lava",
        target: "OPPONENT",
        effectPower: 30,
        tags: [tag("Increase Damage Given")],
    });
    assert.equal(elementalDamage.key, "magma");
    assert.equal(elementalDamage.target, "target");

    assert.equal(resolveCombatVfxSpec({ action: "jutsu", discipline: "Bukijutsu", target: "OPPONENT", effectPower: 30 }).key, "slash");
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", discipline: "Genjutsu", target: "OPPONENT", effectPower: 30 }).key, "debuff");
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

test("asset manifest covers every combat VFX key with a shipped plate", () => {
    assert.deepEqual(
        Object.keys(COMBAT_VFX_ASSETS).sort(),
        Object.keys(COMBAT_VFX_REGISTRY).sort(),
    );
    for (const [key, asset] of Object.entries(COMBAT_VFX_ASSETS)) {
        assert.match(asset.filename, /^[a-z0-9-]+\.webp$/, key);
        assert.equal(asset.url, `/combat-vfx/${asset.filename}`, key);
        assert.ok(asset.tags.length > 0, key);
        assert.ok(existsSync(new URL(`../../public/combat-vfx/${asset.filename}`, import.meta.url)), key);
    }
});

test("asset manifest keeps element, offense discipline, and tag lanes distinct", () => {
    for (const key of ["fire", "water", "wind", "lightning", "earth", "blood", "shadow", "poison", "magma", "metal"] as const) {
        assert.equal(COMBAT_VFX_ASSETS[key].role, "element", key);
        assert.equal(COMBAT_VFX_ASSETS[key].discipline, "elemental", key);
        assert.ok(COMBAT_VFX_ASSETS[key].tags.some(tag => tag.startsWith("Element:")), key);
    }
    for (const key of ["impact", "heavy"] as const) {
        assert.equal(COMBAT_VFX_ASSETS[key].role, "physical-offense", key);
        assert.equal(COMBAT_VFX_ASSETS[key].discipline, "taijutsu", key);
    }
    for (const key of ["slash", "pierce", "throwable", "weapon", "namedWeapon"] as const) {
        assert.equal(COMBAT_VFX_ASSETS[key].role, "weapon-offense", key);
        assert.equal(COMBAT_VFX_ASSETS[key].discipline, "bukijutsu", key);
    }
    for (const key of ["heal", "shield", "reflect", "absorb", "cleanse", "buff"] as const) {
        assert.equal(COMBAT_VFX_ASSETS[key].role, "support", key);
        assert.equal(COMBAT_VFX_ASSETS[key].discipline, "support", key);
    }
    assert.equal(COMBAT_VFX_ASSETS.seal.discipline, "genjutsu");
    assert.equal(COMBAT_VFX_ASSETS.debuff.discipline, "genjutsu");
    assert.equal(COMBAT_VFX_ASSETS.wound.discipline, "status");
    assert.equal(COMBAT_VFX_ASSETS.burn.discipline, "status");
    assert.equal(COMBAT_VFX_ASSETS.poisonCloud.discipline, "status");
    assert.equal(COMBAT_VFX_ASSETS.ko.role, "finisher");
});
