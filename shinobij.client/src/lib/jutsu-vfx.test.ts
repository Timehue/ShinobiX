import { test } from "node:test";
import assert from "node:assert/strict";
import { jutsuElementVfxKey, jutsuVfxBurst, jutsuFxSpriteKey, petFxSpriteKey } from "./jutsu-vfx.ts";
import type { Jutsu, JutsuTag } from "../types/combat.ts";

// Minimal jutsu factory — only the fields jutsuFxSpriteKey reads.
function mk(p: Partial<Pick<Jutsu, "element" | "type" | "target" | "tags">> = {}) {
    return {
        element: p.element ?? "None",
        type: p.type ?? "Ninjutsu",
        target: p.target ?? "OPPONENT",
        tags: (p.tags ?? []) as JutsuTag[],
    } as Pick<Jutsu, "element" | "type" | "target" | "tags">;
}
const tag = (name: string): JutsuTag => ({ name, percent: 30 });

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

// ── jutsuFxSpriteKey (main Arena sprite pick) ────────────────────────────────

test("a KO blow always picks the kaboom finisher, before any other gate", () => {
    assert.equal(jutsuFxSpriteKey(mk({ element: "Water", tags: [tag("Heal")] }), { isKO: true }).key, "kaboom");
});

test("self/support casts split into heal / shield-dome / buff", () => {
    const heal = jutsuFxSpriteKey(mk({ target: "SELF", tags: [tag("Heal")] }));
    assert.deepEqual(heal, { key: "heal", variant: "fx-heal" });
    // Shield/absorb → electric dome by default, but Water/Earth use the soft shield.
    assert.equal(jutsuFxSpriteKey(mk({ element: "Fire", tags: [tag("Shield")] })).key, "eshield");
    assert.equal(jutsuFxSpriteKey(mk({ element: "Water", tags: [tag("Absorb")] })).key, "shield");
    assert.equal(jutsuFxSpriteKey(mk({ element: "Earth", tags: [tag("Reflect")] })).key, "shield");
    // A SELF power-up wears the big soul aura; an outward-cast ward stays a sparkle.
    assert.equal(jutsuFxSpriteKey(mk({ target: "SELF", tags: [tag("Decrease Damage Taken")] })).key, "aura");
    assert.equal(jutsuFxSpriteKey(mk({ target: "OPPONENT", tags: [tag("Decrease Damage Taken")] })).key, "buff");
});

test("control casts → stun spark vs shadow wrap for seals/stat-downs", () => {
    assert.equal(jutsuFxSpriteKey(mk({ element: "Fire", tags: [tag("Stun")] })).key, "spark");
    assert.equal(jutsuFxSpriteKey(mk({ tags: [tag("Seal")] })).key, "shadow"); // "Seal" normalizes to Bloodline Seal
    assert.equal(jutsuFxSpriteKey(mk({ tags: [tag("Elemental Seal")] })).key, "shadow");
    assert.equal(jutsuFxSpriteKey(mk({ tags: [tag("Increase Damage Taken")] })).key, "shadow");
});

test("pressure/DoT casts → burn / blood / poison / vortex", () => {
    assert.equal(jutsuFxSpriteKey(mk({ element: "Fire", tags: [tag("Ignition")] })).key, "burn");
    assert.equal(jutsuFxSpriteKey(mk({ tags: [tag("Wound")] })).key, "blood");
    assert.deepEqual(jutsuFxSpriteKey(mk({ tags: [tag("Poison")] })), { key: "poison", variant: "fx-poison" });
    assert.equal(jutsuFxSpriteKey(mk({ tags: [tag("Drain")] })).key, "vortex");
    assert.equal(jutsuFxSpriteKey(mk({ tags: [tag("Siphon")] })).key, "vortex");
});

test("plain damage falls to element / discipline, with bloodline natures special-cased", () => {
    assert.equal(jutsuFxSpriteKey(mk({ element: "Fire" })).key, "fire");
    assert.equal(jutsuFxSpriteKey(mk({ element: "Lava" })).key, "magma");
    assert.equal(jutsuFxSpriteKey(mk({ element: "Blood" })).key, "blood");
    assert.equal(jutsuFxSpriteKey(mk({ element: "Shadow" })).key, "shadow");
    assert.equal(jutsuFxSpriteKey(mk({ element: "Iron" })).key, "bighit");
    // Non-elemental physical → slash; non-elemental nin/gen → neutral impact.
    assert.equal(jutsuFxSpriteKey(mk({ element: "None", type: "Taijutsu" })).key, "slash");
    assert.equal(jutsuFxSpriteKey(mk({ element: "None", type: "Genjutsu" })).key, "impact");
});

test("heavy upgrades only the plain neutral/physical hit, never an element sprite", () => {
    assert.equal(jutsuFxSpriteKey(mk({ element: "None", type: "Taijutsu" }), { heavy: true }).key, "bighit");
    assert.equal(jutsuFxSpriteKey(mk({ element: "None", type: "Ninjutsu" }), { heavy: true }).key, "bighit");
    assert.equal(jutsuFxSpriteKey(mk({ element: "Fire" }), { heavy: true }).key, "fire"); // element identity kept
});

// ── petFxSpriteKey (pet Arena sprite pick) ───────────────────────────────────

test("pet KO and signature beats get the cinematic tier", () => {
    assert.deepEqual(petFxSpriteKey({ beat: "impact", isKO: true }), { key: "kaboom", variant: "fx-signature" });
    assert.deepEqual(petFxSpriteKey({ beat: "charge", signature: true }), { key: "charge", variant: "fx-signature" });
    assert.deepEqual(petFxSpriteKey({ beat: "impact", signature: true, element: "Fire" }), { key: "kaboom", variant: "fx-signature" });
    assert.deepEqual(petFxSpriteKey({ beat: "impact", signature: true, element: "Water" }), { key: "explosion", variant: "fx-signature" });
    assert.deepEqual(petFxSpriteKey({ beat: "impact", signature: true, element: "Wind" }), { key: "vortex", variant: "fx-signature" });
    assert.deepEqual(petFxSpriteKey({ beat: "impact", signature: true, element: "Earth" }), { key: "bighit", variant: "fx-signature" });
});

test("an apex (flagship) signature detonates the power burst, overriding element", () => {
    // Flagship beats the element-heavy hit on the impact beat...
    assert.deepEqual(petFxSpriteKey({ beat: "impact", signature: true, flagship: true, element: "Fire" }), { key: "power", variant: "fx-signature" });
    assert.deepEqual(petFxSpriteKey({ beat: "impact", signature: true, flagship: true, element: "None" }), { key: "power", variant: "fx-signature" });
    // ...but the wind-up still gathers as a charge, and a flagship KO is still the finisher.
    assert.deepEqual(petFxSpriteKey({ beat: "charge", signature: true, flagship: true }), { key: "charge", variant: "fx-signature" });
    assert.deepEqual(petFxSpriteKey({ beat: "impact", signature: true, flagship: true, isKO: true }), { key: "kaboom", variant: "fx-signature" });
});

test("pet hit beats route basic / DoT / element distinctly", () => {
    assert.equal(petFxSpriteKey({ beat: "impact", actionKind: "basic" }).key, "slash");
    assert.deepEqual(petFxSpriteKey({ beat: "statusApply", vfxKey: "poison" }), { key: "poison", variant: "fx-poison" });
    assert.equal(petFxSpriteKey({ beat: "impact", vfxKey: "blood" }).key, "blood");
    assert.equal(petFxSpriteKey({ beat: "impact", vfxKey: "shadow" }).key, "shadow");
    assert.equal(petFxSpriteKey({ beat: "impact", vfxKey: "fire" }).key, "fire");
    // Neutral / chakra hits stay particle-only (empty key).
    assert.equal(petFxSpriteKey({ beat: "impact", vfxKey: "chakra" }).key, "");
    assert.equal(petFxSpriteKey({ beat: "impact", vfxKey: "none" }).key, "");
});

test("pet support + guard beats pick heal / buff / shield, idle stays empty", () => {
    assert.deepEqual(petFxSpriteKey({ beat: "charge", actionKind: "heal" }), { key: "heal", variant: "fx-heal" });
    assert.equal(petFxSpriteKey({ beat: "charge", actionKind: "buff" }).key, "buff");
    assert.equal(petFxSpriteKey({ beat: "guard" }).key, "shield");
    assert.equal(petFxSpriteKey({ beat: "idle" }).key, "");
    assert.equal(petFxSpriteKey({ beat: "moveCallout" }).key, "");
});
