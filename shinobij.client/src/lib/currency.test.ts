import { test } from "node:test";
import assert from "node:assert/strict";
import { rewardSummary } from "./currency";

test("rewardSummary omits zero-value clutter", () => {
    assert.equal(rewardSummary(0, 0, 0), "No direct reward");
    assert.equal(rewardSummary(10, 0, 0), "+10 XP");
});

test("rewardSummary includes currencies, scrolls, and item drops", () => {
    assert.equal(
        rewardSummary(10, 25, 0, { fateShards: 2 }, undefined, {
            territoryScrolls: 1,
            items: ["Moon Fang", "Shadow Pelt", "Claw", "Venom"],
        }),
        "+10 XP / +25 ryo / +2 Fate Shards / +1 Territory Control Scroll / +Moon Fang, Shadow Pelt, Claw +1 more",
    );
});
