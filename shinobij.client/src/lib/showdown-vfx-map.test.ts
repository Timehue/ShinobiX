/*
 * The move -> effect table is the thing that decides whether two different moves
 * LOOK different. It was wrong in ways only a matrix sweep reveals, so this
 * sweeps the matrix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
    castFlipbookKey,
    impactFlipbookKey,
    moveAccentFamily,
    moveAccentVariant,
    SHOWDOWN_MOVE_VFX_KINDS,
    vfxElementTint,
    VFX_ELEMENT_TINT,
} from "./showdown-vfx-map";

/** Every kind the engine can put on the wire (KNOWN_KINDS + the two synthesized). */
const KINDS = SHOWDOWN_MOVE_VFX_KINDS;
const ELEMENTS = ["Fire", "Water", "Wind", "Earth", "Lightning", "None"];

test("the presentation catalog mirrors the server's actual move-kind seal", () => {
    const engine = readFileSync(new URL("../../../api/_pet-showdown/engine.ts", import.meta.url), "utf8");
    const block = /const KNOWN_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(engine)?.[1];
    assert.ok(block, "engine KNOWN_KINDS block is discoverable");
    const engineKinds = [...block.matchAll(/'([^']+)'/gu)].map((match) => match[1]).sort();
    const presentationKinds = KINDS.filter((kind) => kind !== "guard" && kind !== "rest").toSorted();
    assert.deepEqual(presentationKinds, engineKinds, "server kinds and VFX kinds cannot drift");
});

test("every mapped windup and impact key has bundled frames on disk", () => {
    const fxRoot = new URL("../assets/fx/", import.meta.url);
    const bundled = new Set(
        readdirSync(fxRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .filter((entry) => readdirSync(new URL(`${entry.name}/`, fxRoot)).some((name) => name.endsWith(".png")))
            .map((entry) => entry.name),
    );
    const keys = new Set<string>();
    for (const kind of KINDS) {
        keys.add(castFlipbookKey(kind, kind === "guard" || kind === "rest" ? "self" : "ranged"));
        for (const element of ELEMENTS) {
            keys.add(impactFlipbookKey(element, kind, false));
            keys.add(impactFlipbookKey(element, kind, true));
        }
    }
    keys.delete("");
    for (const key of keys) assert.ok(bundled.has(key), `${key} has at least one bundled frame`);
});

test("every element is visually distinct — the tint is what carries it", () => {
    const tints = new Set(ELEMENTS.map(vfxElementTint));
    assert.equal(tints.size, ELEMENTS.length, "no two elements share a tint");
    for (const el of ELEMENTS) assert.ok(VFX_ELEMENT_TINT[el], `${el} has a tint`);
    // An unknown element must not crash or come back blank.
    assert.ok(vfxElementTint("Nonsense"));
});

test("Rest never detonates the caster's element on its own head", () => {
    // A Fire pet catching its breath used to set off a fireball on itself: the
    // kind ladder had no `rest` case, so it fell through to the element branch.
    for (const el of ELEMENTS) {
        // Empty key = the caller spawns nothing at all.
        assert.equal(impactFlipbookKey(el, "rest", false), "", `${el} rest detonates nothing`);
    }
});

test("mechanically different kinds do not share a silhouette", () => {
    // These pairs mattered most: one steals a turn, the other only changes
    // order; one is a flat soak, the other amplifies the next hit.
    const distinct: [string, string][] = [
        ["stun", "mark"],
        ["confuse", "slow"],
        ["crush", "damage"],
        ["haste", "buff"],
        ["heal", "shield"],
        ["wound", "burn"],
    ];
    for (const [a, b] of distinct) {
        assert.notEqual(
            impactFlipbookKey("None", a, false),
            impactFlipbookKey("None", b, false),
            `${a} and ${b} must not paint the same effect`,
        );
    }
});

test("a signature keeps its kind's silhouette instead of collapsing to one sprite", () => {
    // superCast used to short-circuit first, so all 150 kind x element cells
    // resolved to `kaboom` — a lifesteal finisher and a pure damage finisher
    // were pixel-identical.
    assert.notEqual(
        impactFlipbookKey("Fire", "lifesteal", true),
        impactFlipbookKey("Fire", "damage", true),
        "supers of different kinds still differ",
    );
});

test("every kind resolves to a real frame set, and the matrix is not one sprite", () => {
    const seen = new Set<string>();
    for (const kind of KINDS) {
        for (const el of ELEMENTS) {
            for (const superCast of [false, true]) {
                const key = impactFlipbookKey(el, kind, superCast);
                assert.equal(typeof key, "string", `${kind}/${el} resolves`);
                if (kind !== "rest") assert.ok(key, `${kind}/${el} has an effect`);
                if (key) seen.add(key);
            }
        }
    }
    // Before the rewrite the 300-cell matrix collapsed onto 18 sprites, and the
    // super half of it onto exactly ONE.
    assert.ok(seen.size >= 18, `matrix uses ${seen.size} distinct effects`);
});

test("every engine move kind has its own accent motion grammar", () => {
    const families = KINDS.map((kind) => {
        const family = moveAccentFamily(kind);
        assert.ok(family, `${kind} has a 3D accent family`);
        return family;
    });
    assert.equal(new Set(families).size, KINDS.length, "no two mechanics collapse to the same accent family");
});

test("every active move gets an intent-specific windup", () => {
    for (const kind of KINDS) {
        const key = castFlipbookKey(kind, kind === "guard" || kind === "rest" ? "self" : "ranged");
        if (kind === "rest") assert.equal(key, "", "rest breathes instead of detonating a charge sprite");
        else assert.ok(key, `${kind} has windup paint`);
    }
    assert.notEqual(castFlipbookKey("heal", "self"), castFlipbookKey("debuff", "ranged"));
    assert.notEqual(castFlipbookKey("protect", "self"), castFlipbookKey("weather", "self"));
});

test("authored move names produce stable visual variants", () => {
    const names = ["Heaven's Vortex", "Wind Overdrive", "Gale Slash", "Feather Hex", "Mire", "Bulwark"];
    const variants = names.map(moveAccentVariant);
    assert.deepEqual(variants, names.map(moveAccentVariant), "same authored move always gets the same variant");
    assert.ok(new Set(variants).size >= 3, "catalog samples spread across several art-direction variants");
    assert.ok(variants.every((variant) => variant >= 0 && variant <= 3));
});
