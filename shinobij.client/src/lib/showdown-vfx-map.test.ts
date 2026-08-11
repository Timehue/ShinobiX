/*
 * The move -> effect table is the thing that decides whether two different moves
 * LOOK different. It was wrong in ways only a matrix sweep reveals, so this
 * sweeps the matrix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { impactFlipbookKey, vfxElementTint, VFX_ELEMENT_TINT } from "./showdown-vfx-map";

/** Every kind the engine can put on the wire (KNOWN_KINDS + the two synthesized). */
const KINDS = [
    "damage", "buff", "heal", "debuff", "dot", "move", "barrier", "movelock", "lifesteal",
    "shield", "absorb", "burn", "freeze", "confuse", "stun", "crush", "wound", "mark",
    "slow", "haste", "taunt", "push", "pull", "guard", "rest",
];
const ELEMENTS = ["Fire", "Water", "Wind", "Earth", "Lightning", "None"];

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
