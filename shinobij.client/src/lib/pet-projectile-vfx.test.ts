import { test } from "node:test";
import assert from "node:assert/strict";
import { projectileVisual } from "./pet-projectile-vfx.ts";

test("each core element gets its own silhouette + motion", () => {
    assert.equal(projectileVisual({ element: "Fire" }).tex, "round");
    assert.ok(projectileVisual({ element: "Fire" }).flicker > 0, "fire flickers");

    assert.equal(projectileVisual({ element: "Water" }).tex, "round");
    assert.ok(projectileVisual({ element: "Water" }).wobble > 0, "water undulates");

    assert.equal(projectileVisual({ element: "Wind" }).tex, "crescent");
    assert.ok(projectileVisual({ element: "Wind" }).spin > 0, "wind crescent spins");

    assert.equal(projectileVisual({ element: "Earth" }).tex, "rock");
    assert.ok(projectileVisual({ element: "Earth" }).spin > 0, "rock tumbles");

    assert.equal(projectileVisual({ element: "Lightning" }).tex, "bolt");
    assert.ok(projectileVisual({ element: "Lightning" }).stretch >= 2, "bolt is a long streak");
});

test("element mapping is case-insensitive", () => {
    assert.equal(projectileVisual({ element: "fire" }).tex, projectileVisual({ element: "FIRE" }).tex);
    assert.equal(projectileVisual({ element: "Water" }).glow, projectileVisual({ element: "water" }).glow);
});

test("bloodline natures resolve to a body (no neutral fallback)", () => {
    // Lava rides fire's round core; Iron rides earth's rock; both keep a texture.
    assert.equal(projectileVisual({ element: "Lava" }).tex, "round");
    assert.equal(projectileVisual({ element: "Iron" }).tex, "rock");
    assert.equal(projectileVisual({ element: "Blood" }).tex, "round");
    assert.equal(projectileVisual({ element: "Shadow" }).tex, "round");
});

test("unknown / None / empty fall back to the neutral orb", () => {
    for (const el of ["None", "", null, undefined, "Glass"]) {
        const v = projectileVisual({ element: el });
        assert.equal(v.tex, "round");
        assert.ok(v.size > 0 && v.glow.startsWith("#"));
    }
});

test("roles restyle delivery but keep element colours + texture", () => {
    const base = projectileVisual({ element: "Fire" });
    const def = projectileVisual({ element: "Fire", role: "defender" });
    const trk = projectileVisual({ element: "Fire", role: "tracker" });
    const asn = projectileVisual({ element: "Fire", role: "assassin" });
    const sage = projectileVisual({ element: "Fire", role: "sage" });

    // Element identity (texture + glow hue) survives every role.
    for (const v of [def, trk, asn, sage]) {
        assert.equal(v.tex, base.tex, "texture preserved across role");
        assert.equal(v.glow, base.glow, "element glow preserved across role");
    }
    // Defender lobs a heavy, slow slug; assassin throws a fast piercing lance.
    assert.ok(def.size > base.size, "defender is bigger");
    assert.ok(def.speedMul < base.speedMul, "defender is slower");
    assert.ok(asn.speedMul > base.speedMul, "assassin is faster");
    assert.ok(asn.stretch >= 2.4, "assassin is a lance");
    assert.ok(trk.stretch >= 1.9 && trk.size < base.size, "tracker is a small sharp dart");
    assert.ok(sage.tail > base.tail, "sage trails a long comet");
});

test("case-insensitive role names", () => {
    assert.deepEqual(projectileVisual({ element: "Water", role: "ASSASSIN" }), projectileVisual({ element: "Water", role: "assassin" }));
});

test("support kinds (and the support flag) recolour to heal-green", () => {
    const heal = projectileVisual({ element: "Fire", kind: "heal" });
    assert.equal(heal.glow, "#34d399");
    const shield = projectileVisual({ element: "Lightning", support: true });
    assert.equal(shield.glow, "#34d399");
    // A plain damage shot keeps its element hue.
    assert.notEqual(projectileVisual({ element: "Fire", kind: "damage" }).glow, "#34d399");
});

test("charged (signature/crit) is the bigger, longer-tailed specialty tier", () => {
    const base = projectileVisual({ element: "Earth" });
    const big = projectileVisual({ element: "Earth", charged: true });
    assert.equal(big.charged, true);
    assert.equal(base.charged, false);
    assert.ok(big.size > base.size && big.tail > base.tail);
});

test("core elements (and natures) get the real painted sprite; support/neutral do not", () => {
    assert.equal(projectileVisual({ element: "Fire" }).spriteKey, "fire");
    assert.equal(projectileVisual({ element: "Water" }).spriteKey, "water");
    assert.equal(projectileVisual({ element: "Wind" }).spriteKey, "wind");
    assert.equal(projectileVisual({ element: "Earth" }).spriteKey, "earth");
    assert.equal(projectileVisual({ element: "Lightning" }).spriteKey, "lightning");
    // Bloodline natures ride the closest sprite.
    assert.equal(projectileVisual({ element: "Lava" }).spriteKey, "fire");
    assert.equal(projectileVisual({ element: "Iron" }).spriteKey, "earth");
    // Role keeps the element sprite (delivery changes, not identity).
    assert.equal(projectileVisual({ element: "Fire", role: "assassin" }).spriteKey, "fire");
    // Support shots and neutral/no-sprite natures stay procedural (no sprite).
    assert.equal(projectileVisual({ element: "Fire", kind: "heal" }).spriteKey, undefined);
    assert.equal(projectileVisual({ element: "Fire", support: true }).spriteKey, undefined);
    assert.equal(projectileVisual({ element: "Shadow" }).spriteKey, undefined);
    assert.equal(projectileVisual({ element: "None" }).spriteKey, undefined);
});

test("crush reads heavier than a basic hit of the same element", () => {
    const basic = projectileVisual({ element: "Earth" });
    const crush = projectileVisual({ element: "Earth", kind: "crush" });
    assert.ok(crush.size > basic.size);
});
