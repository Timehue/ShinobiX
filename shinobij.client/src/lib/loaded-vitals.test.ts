import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isIdleVitalsOnlyChange, normalizeLoadedVital, regenerateIdleVitals } from "./loaded-vitals";

test("loading a stale maximum preserves an authoritative combat remainder", () => {
    assert.deepEqual(normalizeLoadedVital(30, 100, 500), {
        current: 30,
        maximum: 500,
    });
});

test("loading vitals clamps malformed and over-cap values without inventing healing", () => {
    assert.deepEqual(normalizeLoadedVital(-20, 100, 500), { current: 0, maximum: 500 });
    assert.deepEqual(normalizeLoadedVital(900, 100, 500), { current: 500, maximum: 500 });
    assert.deepEqual(normalizeLoadedVital(undefined, undefined, 500), { current: 500, maximum: 500 });
    assert.deepEqual(normalizeLoadedVital(250, 800, 500), { current: 250, maximum: 800 });
});

test("idle regeneration keeps an admitted character at the KO snapshot", () => {
    const admitted = {
        hp: 0, maxHp: 500,
        chakra: 100, maxChakra: 1000,
        stamina: 100, maxStamina: 1000,
        hospitalized: true,
    };
    assert.equal(regenerateIdleVitals(admitted, 30), admitted, "same reference prevents a dirty autosave");
    assert.equal(admitted.hp, 0);
});

test("idle regeneration still advances and clamps ordinary village vitals", () => {
    assert.deepEqual(regenerateIdleVitals({
        hp: 99, maxHp: 100,
        chakra: 40, maxChakra: 100,
        stamina: 100, maxStamina: 100,
        hospitalized: false,
    }, 2), {
        hp: 100, maxHp: 100,
        chakra: 42, maxChakra: 100,
        stamina: 100, maxStamina: 100,
        hospitalized: false,
    });
});

const shinobi = (overrides: Record<string, unknown> = {}) => ({
    name: "Kaya",
    level: 12,
    ryo: 500,
    itemStacks: [{ id: "soldier-pill", count: 2 }],
    hp: 40, maxHp: 100,
    chakra: 40, maxChakra: 100,
    stamina: 40, maxStamina: 100,
    ...overrides,
});

test("an idle regen tick is not a change worth autosaving", () => {
    const before = shinobi();
    // A tick adds the same figure to all three and clamps each at its own max.
    assert.equal(isIdleVitalsOnlyChange(before, { ...before, hp: 41, chakra: 41, stamina: 41 }), true);
    assert.equal(isIdleVitalsOnlyChange(before, { ...before, hp: 46, chakra: 46, stamina: 46 }), true, "an Aura Sphere bonus raises the rate, not the shape");
    // Vitals already at their cap stay put while the rest climb.
    const nearlyFull = shinobi({ hp: 100, chakra: 99, stamina: 40 });
    assert.equal(
        isIdleVitalsOnlyChange(nearlyFull, { ...nearlyFull, chakra: 100, stamina: 45 }),
        true,
        "hp is capped and chakra clamps short — both are still the same tick",
    );
});

test("a client-owned vitals GRANT is real progress and must still autosave", () => {
    // ⛔ The regression this guards: both grants raise vitals and change nothing
    // else, so "some vital went up" would have silently stopped saving them —
    // and neither has a server endpoint that could re-derive the gain.
    const before = shinobi();
    assert.equal(
        isIdleVitalsOnlyChange(before, { ...before, stamina: 55 }),
        false,
        "WorldMap sector Recover lifts stamina only, while hp/chakra sit below their maxima",
    );
    assert.equal(
        isIdleVitalsOnlyChange(before, { ...before, hp: 75, chakra: 55 }),
        false,
        "the Story boss recover() action lifts hp + chakra but not stamina",
    );
    // A consumed pill also changes itemStacks, so it was never mistaken for a tick.
    assert.equal(
        isIdleVitalsOnlyChange(before, { ...before, stamina: 65, itemStacks: [{ id: "soldier-pill", count: 1 }] }),
        false,
    );
});

test("anything beyond a uniform rise still marks the save dirty", () => {
    const before = shinobi();
    assert.equal(isIdleVitalsOnlyChange(before, { ...before, chakra: 30 }), false, "a spend or a hit is never regen");
    assert.equal(isIdleVitalsOnlyChange(before, { ...before, hp: 41, chakra: 41, stamina: 41, ryo: 600 }), false);
    assert.equal(isIdleVitalsOnlyChange(before, { ...before, hp: 41, chakra: 41, stamina: 41, level: 13 }), false);
    assert.equal(
        isIdleVitalsOnlyChange(before, { ...before, hp: 41, chakra: 41, stamina: 41, maxHp: 120 }),
        false,
        "a derived-stat change is progress even alongside a tick",
    );
    // Unverifiable maxima fail closed — the save runs rather than being skipped.
    const noMax = { hp: 40, chakra: 40, stamina: 40, maxHp: 100, maxChakra: 100, maxStamina: undefined };
    assert.equal(isIdleVitalsOnlyChange(noMax, { ...noMax, hp: 41, chakra: 41 }), false);
});

test("identical, absent, and reshaped characters are never treated as a tick", () => {
    const before = shinobi();
    assert.equal(isIdleVitalsOnlyChange(before, before), false, "no change at all is not a tick");
    assert.equal(isIdleVitalsOnlyChange(null, before), false);
    assert.equal(isIdleVitalsOnlyChange(before, null), false);
    assert.equal(isIdleVitalsOnlyChange(before, { ...before, hp: 41, chakra: 41, stamina: 41, bloodline: "Ember" }), false, "an added key is a real change");
    const { itemStacks: _dropped, ...withoutStacks } = before;
    assert.equal(isIdleVitalsOnlyChange(before, { ...withoutStacks, hp: 41, chakra: 41, stamina: 41 }), false, "a removed key is a real change");
});

test("App gates its dirty detection on the tick check", () => {
    // regenerateIdleVitals returns a NEW object every second below full vitals,
    // and App marks the save dirty on reference inequality. Without this guard a
    // merely-open tab autosaves forever with no player input, which is what makes
    // two tabs trade 409s indefinitely.
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    assert.match(
        app,
        /if \(!isIdleVitalsOnlyChange\(prevCharRef\.current, character\)\) charDirtyRef\.current = true;/u,
        "App must not flip charDirtyRef for a pure idle-regen tick",
    );
});
