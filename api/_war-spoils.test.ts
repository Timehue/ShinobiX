import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { computeSpoils, bumpStanding, SPOILS_CURRENCY_PCT, SPOILS_FATE_PCT, SPOILS_RYO_CAP, SPOILS_SEAL_CAP, SPOILS_FATE_CAP } from "./_war-spoils.js";

describe("computeSpoils", () => {
    it("takes the bounded comeback-safe percentage (floored)", () => {
        const s = computeSpoils({ ryo: 100_000, honorSeals: 200, fateShards: 95 });
        assert.equal(s.ryo, Math.floor(100_000 * SPOILS_CURRENCY_PCT));
        assert.equal(s.honorSeals, Math.floor(200 * SPOILS_CURRENCY_PCT));
        assert.equal(s.fateShards, Math.floor(95 * SPOILS_FATE_PCT));
    });
    it("caps every resource so one win cannot create a runaway lead", () => {
        const s = computeSpoils({ ryo: 100_000_000, honorSeals: 100_000, fateShards: 100_000 });
        assert.deepEqual(s, { ryo: SPOILS_RYO_CAP, honorSeals: SPOILS_SEAL_CAP, fateShards: SPOILS_FATE_CAP });
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
