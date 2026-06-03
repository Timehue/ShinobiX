import { test } from "node:test";
import assert from "node:assert/strict";
import { jutsuElementVfxKey, jutsuVfxBurst } from "./jutsu-vfx.ts";

test("core elements map to their own palette key", () => {
    assert.equal(jutsuElementVfxKey("Fire"), "fire");
    assert.equal(jutsuElementVfxKey("Water"), "water");
    assert.equal(jutsuElementVfxKey("Wind"), "wind");
    assert.equal(jutsuElementVfxKey("Lightning"), "lightning");
    assert.equal(jutsuElementVfxKey("Earth"), "earth");
});

test("bloodline natures reuse the closest existing palette", () => {
    assert.equal(jutsuElementVfxKey("Lava"), "fire");
    assert.equal(jutsuElementVfxKey("Iron"), "earth");
    assert.equal(jutsuElementVfxKey("Blood"), "blood");
    assert.equal(jutsuElementVfxKey("Shadow"), "shadow");
});

test("None / unknown / empty fall back to the chakra shimmer", () => {
    assert.equal(jutsuElementVfxKey("None"), "chakra");
    assert.equal(jutsuElementVfxKey(""), "chakra");
    assert.equal(jutsuElementVfxKey(null), "chakra");
    assert.equal(jutsuElementVfxKey(undefined), "chakra");
    assert.equal(jutsuElementVfxKey("Glass"), "chakra");
});

test("mapping is case-insensitive", () => {
    assert.equal(jutsuElementVfxKey("fire"), "fire");
    assert.equal(jutsuElementVfxKey("FIRE"), "fire");
    assert.equal(jutsuElementVfxKey("lAvA"), "fire");
});

test("offensive cast lands an element-tinted impact burst", () => {
    const burst = jutsuVfxBurst({ element: "Fire" });
    assert.equal(burst.kind, "ember");        // fire impact uses embers
    assert.ok(burst.count > 0);
    assert.ok(burst.colors.includes("#fb923c"));
});

test("self-support cast gathers UP on the caster (charge)", () => {
    const burst = jutsuVfxBurst({ element: "Water", selfCast: true });
    assert.equal(burst.kind, "ember");        // charge gather is embers...
    assert.ok(burst.gravity < 0);             // ...rising (negative gravity)
});

test("heavy and KO hits amplify the burst", () => {
    const plain = jutsuVfxBurst({ element: "Lightning" });
    const heavy = jutsuVfxBurst({ element: "Lightning", heavy: true });
    const ko = jutsuVfxBurst({ element: "Lightning", isKO: true });
    assert.ok(heavy.count > plain.count);
    assert.ok(ko.count > plain.count);
});

test("a bloodline jutsu still produces a real (non-empty) burst", () => {
    for (const el of ["Blood", "Lava", "Shadow", "Iron", "None"]) {
        const burst = jutsuVfxBurst({ element: el });
        assert.notEqual(burst.kind, "none");
        assert.ok(burst.count > 0);
    }
});
