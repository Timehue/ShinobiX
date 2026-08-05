import { strict as assert } from "node:assert";
import test from "node:test";
import { normalizeLoadedVital, regenerateIdleVitals } from "./loaded-vitals";

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
