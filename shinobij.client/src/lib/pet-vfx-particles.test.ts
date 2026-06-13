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

// ── Scale-of-importance: signatures/ultimates spray bigger than basics ──────────
test("a basic impact is unchanged with no flags (exact parity)", () => {
    const plain = vfxBurstForEvent({ type: "impact", vfxKey: "none" });
    assert.equal(plain.count, 18);
    assert.equal(plain.speed, 3.2);
    assert.equal(plain.size, 2.4);
    assert.equal(plain.life, 40);
});

test("a signature impact out-sprays a basic, and flagship out-sprays signature", () => {
    const plain = vfxBurstForEvent({ type: "impact", vfxKey: "fire" });
    const sig = vfxBurstForEvent({ type: "impact", vfxKey: "fire" }, { signature: true });
    const flag = vfxBurstForEvent({ type: "impact", vfxKey: "fire" }, { signature: true, flagship: true });
    assert.ok(sig.count > plain.count, "signature should spray more than basic");
    assert.ok(flag.count > sig.count, "flagship should spray more than signature");
    assert.ok(sig.size > plain.size && flag.speed > sig.speed, "bigger moves also fly bigger/faster");
});

test("a signature charge gathers more energy than a basic charge", () => {
    const basic = vfxBurstForEvent({ type: "charge", vfxKey: "chakra" });
    const sig = vfxBurstForEvent({ type: "charge", vfxKey: "chakra" }, { signature: true });
    assert.ok(sig.count > basic.count && sig.life > basic.life);
});
