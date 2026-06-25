import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rollAmbushReward, ambushCleared, AMBUSH_KILLS_REQUIRED } from "./_wanderer-ambush.js";

describe("rollAmbushReward", () => {
    it("rolls 1–3 fate shards, 5–10 bone charms, positive ryo across the rng range", () => {
        for (const r of [() => 0, () => 0.5, () => 0.999]) {
            const g = rollAmbushReward(50, r);
            assert.ok(g.fateShards >= 1 && g.fateShards <= 3, `shards ${g.fateShards}`);
            assert.ok(g.boneCharms >= 5 && g.boneCharms <= 10, `charms ${g.boneCharms}`);
            assert.ok(g.ryo > 0, `ryo ${g.ryo}`);
        }
    });
    it("ryo scales with level and stays reasonable", () => {
        assert.ok(rollAmbushReward(100, () => 0.5).ryo > rollAmbushReward(1, () => 0.5).ryo);
        assert.ok(rollAmbushReward(100, () => 0.999).ryo <= 3000);
    });
});

describe("ambushCleared", () => {
    it("requires the full gauntlet's worth of kills since baseline", () => {
        assert.equal(ambushCleared(10, 10 + AMBUSH_KILLS_REQUIRED - 1), false);
        assert.equal(ambushCleared(10, 10 + AMBUSH_KILLS_REQUIRED), true);
        assert.equal(ambushCleared(10, 100), true);
        assert.equal(ambushCleared(10, 9), false);
    });
});
