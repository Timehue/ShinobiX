import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rollAmbushReward, ambushCleared, AMBUSH_KILLS_REQUIRED, AMBUSH_FATE_SHARDS } from "./_wanderer-ambush.js";

function seq(...values: number[]) { let i = 0; return () => values[i++] ?? 0; }

describe("rollAmbushReward", () => {
    it("pays exactly 1 fate shard, 5–10 bone charms, positive ryo across the rng range", () => {
        assert.equal(AMBUSH_FATE_SHARDS, 1);
        for (const r of [() => 0, () => 0.5, () => 0.999]) {
            const g = rollAmbushReward(50, r);
            assert.equal(g.fateShards, AMBUSH_FATE_SHARDS, `shards ${g.fateShards}`);
            assert.ok(g.boneCharms >= 5 && g.boneCharms <= 10, `charms ${g.boneCharms}`);
            assert.ok(g.ryo > 0, `ryo ${g.ryo}`);
        }
    });
    it("draws ryo then bone charms, with no draw spent on the shard", () => {
        const g = rollAmbushReward(50, seq(0, 0.999));
        assert.equal(g.ryo, Math.round((150 + 50 * 12) * 0.8));
        assert.equal(g.boneCharms, 10);
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
