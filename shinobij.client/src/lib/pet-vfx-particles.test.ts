import { test } from "node:test";
import assert from "node:assert/strict";
import { vfxBurstForEvent } from "./pet-vfx-particles.ts";

test("non-spraying beats return a `none` spec with zero count", () => {
    for (const type of ["idle", "windup", "lunge", "moveCallout", "damageNumber", "victory"] as const) {
        const spec = vfxBurstForEvent({ type, vfxKey: "fire" });
        assert.equal(spec.kind, "none");
        assert.equal(spec.count, 0);
    }
    assert.equal(vfxBurstForEvent(undefined).kind, "none");
});

test("impact sprays element-appropriate particles from the element palette", () => {
    const fire = vfxBurstForEvent({ type: "impact", vfxKey: "fire" });
    assert.equal(fire.kind, "ember");
    assert.ok(fire.count > 0);
    assert.ok(fire.colors.includes("#fb923c"));

    const ice = vfxBurstForEvent({ type: "impact", vfxKey: "ice" });
    assert.equal(ice.kind, "shard");

    const lightning = vfxBurstForEvent({ type: "impact", vfxKey: "lightning" });
    assert.equal(lightning.kind, "arc");
});

test("crit impact spawns more, faster particles than a plain impact", () => {
    const plain = vfxBurstForEvent({ type: "impact", vfxKey: "none" });
    const crit = vfxBurstForEvent({ type: "impact", vfxKey: "none" }, { crit: true });
    assert.ok(crit.count > plain.count);
    assert.ok(crit.speed >= plain.speed);
});

test("KO is the biggest burst", () => {
    const ko = vfxBurstForEvent({ type: "ko", vfxKey: "none" });
    const impact = vfxBurstForEvent({ type: "impact", vfxKey: "none" });
    assert.ok(ko.count > impact.count);
});

test("charge gathers UP (negative gravity)", () => {
    const charge = vfxBurstForEvent({ type: "charge", vfxKey: "chakra" });
    assert.ok(charge.gravity < 0);
    assert.ok(charge.count > 0);
});

test("statusApply sprays a small cloud/shard", () => {
    const poison = vfxBurstForEvent({ type: "statusApply", vfxKey: "poison" });
    assert.equal(poison.kind, "cloud");
    assert.ok(poison.count > 0 && poison.count < 20);
});

test("unknown element falls back to the default palette, never empty", () => {
    const spec = vfxBurstForEvent({ type: "impact", vfxKey: "none" });
    assert.ok(spec.colors.length > 0);
});
