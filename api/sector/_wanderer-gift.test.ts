import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { decideWandererGift, wandererGiftRyo, WANDERER_GIFTS_PER_DAY } from "./_wanderer-gift.js";

describe("wandererGiftRyo", () => {
    it("is positive, bounded, and scales with level", () => {
        assert.ok(wandererGiftRyo(1) > 0);
        assert.ok(wandererGiftRyo(100) > wandererGiftRyo(1));
        assert.ok(wandererGiftRyo(100) <= 2000, "stays modest");
    });
    it("clamps junk/out-of-range levels", () => {
        assert.equal(wandererGiftRyo(0), wandererGiftRyo(1));
        assert.equal(wandererGiftRyo(9999), wandererGiftRyo(100));
        assert.equal(wandererGiftRyo(NaN), wandererGiftRyo(1));
    });
});

describe("decideWandererGift", () => {
    it("grants while under the daily cap", () => {
        for (let i = 0; i < WANDERER_GIFTS_PER_DAY; i++) {
            const d = decideWandererGift(20, i);
            assert.equal(d.ok, true);
            if (d.ok) assert.ok(d.ryo > 0);
        }
    });
    it("rejects once the cap is reached", () => {
        const d = decideWandererGift(20, WANDERER_GIFTS_PER_DAY);
        assert.equal(d.ok, false);
        if (!d.ok) assert.equal(d.reason, "daily-cap");
    });
});
