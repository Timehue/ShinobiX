import { test } from "node:test";
import assert from "node:assert/strict";
import {
    hollowGateBossDisplayName,
    hollowGateBossScaling,
    hollowGateRunMaxFloor,
    hollowGateVariantDims,
    normalizeHollowGateEventConfig,
    variantFromEventConfig,
} from "./hollow-gate-variant";
import { HOLLOW_GATE_MAX_FLOOR, HOLLOW_GATE_SHRINE_H, HOLLOW_GATE_SHRINE_W } from "../constants/game";

test("no variant → the standard shrine everywhere (back-compat)", () => {
    assert.equal(hollowGateRunMaxFloor(null), HOLLOW_GATE_MAX_FLOOR);
    assert.equal(hollowGateRunMaxFloor({ variant: undefined }), HOLLOW_GATE_MAX_FLOOR);
    assert.deepEqual(hollowGateVariantDims(undefined), { width: HOLLOW_GATE_SHRINE_W, height: HOLLOW_GATE_SHRINE_H });
    assert.equal(hollowGateBossDisplayName(null), "Hollow Gate Warden");
    assert.equal(hollowGateBossDisplayName({ variant: { id: "e" } }), "Hollow Gate Warden");
});

test("variant fields are read and clamped", () => {
    assert.equal(hollowGateRunMaxFloor({ variant: { id: "e", maxFloor: 3 } }), 3);
    assert.equal(hollowGateRunMaxFloor({ variant: { id: "e", maxFloor: 0 } }), 1, "floors clamp up to 1");
    assert.equal(hollowGateRunMaxFloor({ variant: { id: "e", maxFloor: 99 } }), 9, "floors clamp down to 9");
    assert.deepEqual(hollowGateVariantDims({ id: "e", width: 19, height: 13 }), { width: 19, height: 13 });
    assert.deepEqual(hollowGateVariantDims({ id: "e", width: 5, height: 500 }), { width: 15, height: 21 }, "dims clamp into generator-safe bounds");
    assert.equal(hollowGateBossDisplayName({ variant: { id: "e", bossName: "  Festival Oni  " } }), "Festival Oni");
});

test("boss scaling reproduces the original 5-floor table exactly", () => {
    // The pre-variant code: levelOffset = -5 + (floor-1)*5, hpMult = 1 + (floor-1)*0.1.
    for (let floor = 1; floor <= 5; floor += 1) {
        const { levelOffset, hpMult } = hollowGateBossScaling(floor, 5);
        assert.equal(levelOffset, -5 + (floor - 1) * 5, `floor ${floor} level offset`);
        assert.ok(Math.abs(hpMult - (1 + (floor - 1) * 0.1)) < 1e-9, `floor ${floor} hp mult`);
    }
});

test("boss scaling ramps over the variant's own floor count", () => {
    // A 3-floor event still starts at -5 and ENDS at Warden strength (+15, 1.4x).
    assert.deepEqual(hollowGateBossScaling(1, 3).levelOffset, -5);
    assert.deepEqual(hollowGateBossScaling(3, 3).levelOffset, 15);
    assert.ok(Math.abs(hollowGateBossScaling(3, 3).hpMult - 1.4) < 1e-9);
    // A 1-floor gauntlet IS the final floor.
    assert.equal(hollowGateBossScaling(1, 1).levelOffset, 15);
    assert.ok(Math.abs(hollowGateBossScaling(1, 1).hpMult - 1.4) < 1e-9);
});

test("normalizeHollowGateEventConfig clamps and rejects junk", () => {
    assert.equal(normalizeHollowGateEventConfig(null), null);
    assert.equal(normalizeHollowGateEventConfig("nope"), null);
    assert.equal(normalizeHollowGateEventConfig({ label: "no id" }), null);
    const cfg = normalizeHollowGateEventConfig({
        id: "  festival-2026  ",
        label: "Festival Gate",
        maxFloor: "2",
        width: 19, height: 13,
        bossAiId: "boss-festival-oni",
        bossName: "Festival Oni",
        active: 1, keyCost: 5, requiresUnlock: 0,
    });
    assert.ok(cfg);
    assert.equal(cfg.id, "festival-2026");
    assert.equal(cfg.maxFloor, 2);
    assert.equal(cfg.keyCost, 1, "keyCost clamps to 0..1");
    assert.equal(cfg.active, true);
    assert.equal(cfg.requiresUnlock, false);
    // Round-trip into the run-stamped variant.
    const v = variantFromEventConfig(cfg);
    assert.equal(v.maxFloor, 2);
    assert.equal(v.bossAiId, "boss-festival-oni");
    assert.ok(!("active" in v), "run variant carries shape only, not activation");
});

test("omitted dims stay omitted (standard grid), present dims clamp", () => {
    const cfg = normalizeHollowGateEventConfig({ id: "e" });
    assert.ok(cfg);
    assert.equal(cfg.width, undefined);
    assert.equal(cfg.height, undefined);
    const sized = normalizeHollowGateEventConfig({ id: "e", width: 9, height: 9 });
    assert.ok(sized);
    assert.equal(sized.width, 15);
    assert.equal(sized.height, 11);
});
