import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { decideWandererGift, rollWandererGift, WANDERER_GIFTS_PER_DAY } from "./_wanderer-gift.js";

describe("rollWandererGift", () => {
    it("rolls shards 1–5, charms 1–10, and positive ryo across the rng range", () => {
        for (const r of [() => 0, () => 0.5, () => 0.999]) {
            const g = rollWandererGift(40, r);
            assert.ok(g.fateShards >= 1 && g.fateShards <= 5, `shards ${g.fateShards}`);
            assert.ok(g.boneCharms >= 1 && g.boneCharms <= 10, `charms ${g.boneCharms}`);
            assert.ok(g.ryo > 0, `ryo ${g.ryo}`);
        }
    });
    it("ryo scales with level but stays modest", () => {
        const lo = rollWandererGift(1, () => 0.5);
        const hi = rollWandererGift(100, () => 0.5);
        assert.ok(hi.ryo > lo.ryo);
        assert.ok(hi.ryo <= 1500, "ryo stays small");
    });
    it("clamps junk level", () => {
        assert.equal(rollWandererGift(0, () => 0).ryo, rollWandererGift(1, () => 0).ryo);
        assert.equal(rollWandererGift(9999, () => 0).ryo, rollWandererGift(100, () => 0).ryo);
    });
});

describe("decideWandererGift", () => {
    it("allows up to the daily cap, then blocks", () => {
        for (let i = 0; i < WANDERER_GIFTS_PER_DAY; i++) assert.equal(decideWandererGift(i).ok, true);
        const d = decideWandererGift(WANDERER_GIFTS_PER_DAY);
        assert.equal(d.ok, false);
        if (!d.ok) assert.equal(d.reason, "daily-cap");
    });
});
