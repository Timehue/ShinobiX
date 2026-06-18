import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { computeSpoils, bumpStanding, SPOILS_CURRENCY_PCT, SPOILS_FATE_PCT } from "./_war-spoils.js";

describe("computeSpoils", () => {
    it("takes 15% of ryo + honor seals and 10% of fate shards (floored)", () => {
        const s = computeSpoils({ ryo: 100_000, honorSeals: 200, fateShards: 95 });
        assert.equal(s.ryo, Math.floor(100_000 * SPOILS_CURRENCY_PCT));   // 15,000
        assert.equal(s.honorSeals, Math.floor(200 * SPOILS_CURRENCY_PCT)); // 30
        assert.equal(s.fateShards, Math.floor(95 * SPOILS_FATE_PCT));      // 9
    });
    it("is uncapped — scales straight with the loser's holdings", () => {
        assert.equal(computeSpoils({ ryo: 10_000_000 }).ryo, 1_500_000);
    });
    it("never goes negative and treats missing/garbage as 0", () => {
        assert.deepEqual(computeSpoils({}), { ryo: 0, honorSeals: 0, fateShards: 0 });
        assert.deepEqual(computeSpoils({ ryo: -50, honorSeals: NaN as unknown as number }), { ryo: 0, honorSeals: 0, fateShards: 0 });
    });
});

describe("bumpStanding", () => {
    it("increments the right counter and stamps lastResult", () => {
        const a = bumpStanding(null, "win", 100);
        assert.deepEqual({ wins: a.wins, losses: a.losses, lastResult: a.lastResult }, { wins: 1, losses: 0, lastResult: "win" });
        const b = bumpStanding(a, "loss", 200);
        assert.deepEqual({ wins: b.wins, losses: b.losses, lastResult: b.lastResult, updatedAt: b.updatedAt }, { wins: 1, losses: 1, lastResult: "loss", updatedAt: 200 });
    });
});
