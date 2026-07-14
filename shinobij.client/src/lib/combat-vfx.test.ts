import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
    COMBAT_VFX_REGISTRY,
    resolveCombatVfxSpec,
    safeCombatVfxSpec,
    combatVfxAnchorKey,
    dedupeCombatVfx,
    type CombatVfxKey,
} from "./combat-vfx.ts";
import { COMBAT_VFX_ASSETS } from "./combat-vfx-assets.ts";
import { JUTSU_VISUAL_EFFECT_OPTIONS } from "./jutsu-visuals.ts";
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

test("60 AP core-element attacks use literal elemental target plates", () => {
    const keys = ["Fire", "Water", "Wind", "Lightning", "Earth"].map(element =>
        resolveCombatVfxSpec({ action: "jutsu", ap: 60, element, target: "OPPONENT", tags: [tag("Wound")], ko: true }),
    );
    assert.deepEqual(keys.map(spec => spec.key), ["fire60", "water60", "wind60", "lightning60", "earth60"]);
    assert.ok(keys.every(spec => spec.target === "target"));
    assert.ok(keys.every(spec => spec.intensity === "finisher"));

    assert.equal(resolveCombatVfxSpec({ action: "jutsu", ap: 40, element: "Fire", target: "OPPONENT", tags: [tag("Wound")] }).key, "wound");
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", ap: 60, element: "Lava", target: "OPPONENT" }).key, "magma");
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", ap: 60, element: "Water", target: "SELF", tags: [tag("Shield")] }).key, "shield");
});

test("Bloodline Builder visual choice overrides automatic 60 AP element art", () => {
    const chosen = resolveCombatVfxSpec({
        action: "jutsu", ap: 60, visualEffect: "water60", element: "Lava",
        target: "OPPONENT", tags: [tag("Wound")],
    });
    assert.equal(chosen.key, "water60");
    assert.equal(chosen.target, "target");
    assert.equal(chosen.intensity, "heavy");

    assert.equal(resolveCombatVfxSpec({
        action: "jutsu", ap: 40, visualEffect: "water60", element: "Fire",
        target: "OPPONENT", tags: [tag("Wound")],
    }).key, "wound");
    assert.equal(resolveCombatVfxSpec({
        action: "jutsu", ap: 60, visualEffect: "not-real", element: "Fire", target: "OPPONENT",
    }).key, "fire60");

    const classicSupportArt = resolveCombatVfxSpec({
        action: "jutsu", ap: 60, visualEffect: "shield", element: "Fire", target: "OPPONENT",
    });
    assert.equal(classicSupportArt.key, "shield");
    assert.equal(classicSupportArt.target, "target", "a selected visual skin follows the offensive jutsu target");
});

test("Bloodline Builder dropdown exposes every shipped combat VFX", () => {
    const dropdownKeys = JUTSU_VISUAL_EFFECT_OPTIONS.map((option) => option.key).sort();
    const shippedKeys = Object.keys(COMBAT_VFX_ASSETS).sort();
    assert.deepEqual(dropdownKeys, shippedKeys);
    assert.equal(new Set(dropdownKeys).size, dropdownKeys.length);
});

test("bloodline element jutsu map to distinct combat VFX", () => {
    assert.equal(keyForElement("Blood"), "blood");
    assert.equal(keyForElement("Shadow"), "shadow");
    assert.equal(keyForElement("Lava"), "magma");
    assert.equal(keyForElement("Iron"), "metal");
    assert.equal(keyForElement("Crystal"), "metal");
    assert.equal(keyForElement("Storm"), "lightning");
    assert.equal(keyForElement("Ice"), "water");
    assert.equal(keyForElement("Venom"), "poison");
    assert.equal(keyForElement("Void"), "shadow");
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
    assert.equal(resolveCombatVfxSpec({ action: "basicHeal" }).key, "heal");
    assert.equal(resolveCombatVfxSpec({ action: "basicHeal" }).target, "caster");
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
        ["Push", "wind"],
        ["Pull", "wind"],
        ["Copy", "reflect"],
        ["Mirror", "debuff"],
    ];
    for (const [name, key] of pairs) {
        assert.equal(resolveCombatVfxSpec({ action: "jutsu", tags: [tag(name)] }).key, key);
    }
});

test("bloodline utility tags target the correct side", () => {
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", tags: [tag("Push")], target: "OPPONENT" }).target, "target");
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", tags: [tag("Pull")], target: "OPPONENT" }).target, "target");
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", tags: [tag("Copy")], target: "OPPONENT" }).target, "caster");
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", tags: [tag("Mirror")], target: "OPPONENT" }).target, "target");
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

test("element and discipline fallbacks stay semantically paired", () => {
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
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", element: "Glass" }).key, "metal");
    assert.equal(resolveCombatVfxSpec({ action: "jutsu", element: "Prism" }).key, "impact");
    assert.equal(safeCombatVfxSpec({ key: "not-real" as CombatVfxKey }).key, "impact");
});

test("overlapping plates on one render tile collapse to a single VFX", () => {
    // Model of the screens: each plate resolves to the tile it paints on — its
    // own tile list, else the caster/target fighter's current tile.
    const tileOf = { p1: 3, p2: 10 } as Record<string, number>;
    const anchorKey = (fx: { target: string; spec: { tiles?: number[] } }) =>
        combatVfxAnchorKey(fx.spec, tileOf[fx.target]);

    // A hit on the enemy plus its shield-reaction on the same enemy → one plate.
    const stacked = dedupeCombatVfx(
        [
            { target: "p2", spec: { key: "impact", tiles: undefined } },
            { target: "p2", spec: { key: "shield", tiles: undefined } },
        ],
        anchorKey,
    );
    assert.equal(stacked.length, 1);
    assert.equal(stacked[0].spec.key, "impact"); // primary (first) wins

    // Effects on two different fighters (self buff + enemy hit) both survive.
    const split = dedupeCombatVfx(
        [
            { target: "p1", spec: { key: "buff", tiles: undefined } },
            { target: "p2", spec: { key: "impact", tiles: undefined } },
        ],
        anchorKey,
    );
    assert.equal(split.length, 2);

    // A single-tile plate (movement flourish onto destTile) plus a fighter-anchored
    // plate at that same tile (spend-cloud on the caster's new position) collapse —
    // the same-pixel double the dedupe is meant to catch.
    const moveThenSpend = dedupeCombatVfx(
        [
            { target: "p1", spec: { key: "wind", tiles: [3] } },        // flourish on destTile 3
            { target: "p1", spec: { key: "poisonCloud", tiles: undefined } }, // cloud on p1 (tile 3)
        ],
        anchorKey,
    );
    assert.equal(moveThenSpend.length, 1);

    // Distinct tile clusters stay distinct; identical clusters collapse.
    assert.equal(dedupeCombatVfx(
        [
            { target: "p2", spec: { key: "earth", tiles: [1, 2, 3] } },
            { target: "p2", spec: { key: "poisonCloud", tiles: [1, 2, 3] } },
        ],
        anchorKey,
    ).length, 1);
    assert.equal(combatVfxAnchorKey({ tiles: [1, 2] }, 9), "1,2");
    assert.equal(combatVfxAnchorKey({ tiles: undefined }, 7), "7");
});

test("registry exposes only the supported generic combat VFX keys", () => {
    const supported = new Set<CombatVfxKey>([
        "fire", "fire60", "water", "water60", "wind", "wind60", "lightning", "lightning60", "earth", "earth60", "blood", "shadow", "poison",
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
    for (const key of ["fire", "fire60", "water", "water60", "wind", "wind60", "lightning", "lightning60", "earth", "earth60", "blood", "shadow", "poison", "magma", "metal"] as const) {
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
