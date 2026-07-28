import { test } from "node:test";
import assert from "node:assert/strict";
import { rewardSummary, statPointNote } from "./currency";

// Character XP is retired (docs/leveling-without-xp-map.md): rewardSummary has
// no `xp` term at all now, and progression rewards are surfaced as stat points
// by statPointNote.

test("rewardSummary omits zero-value clutter", () => {
    assert.equal(rewardSummary(0, 0), "No direct reward");
    assert.equal(rewardSummary(25, 0), "+25 ryo");
    assert.equal(rewardSummary(0, 15), "+15 stamina");
});

test("rewardSummary includes currencies, scrolls, and item drops", () => {
    assert.equal(
        rewardSummary(25, 0, { fateShards: 2 }, undefined, {
            territoryScrolls: 1,
            items: ["Moon Fang", "Shadow Pelt", "Claw", "Venom"],
        }),
        "+25 ryo / +2 Fate Shards / +1 Territory Control Scroll / +Moon Fang, Shadow Pelt, Claw +1 more",
    );
});

test("rewardSummary can no longer render an XP line", () => {
    // The retired currency must not come back through a stray argument.
    const summary = rewardSummary(25, 15, { fateShards: 1 });
    assert.ok(!summary.includes("XP"), summary);
});

test("statPointNote leads a claim toast only when points were actually paid", () => {
    assert.equal(statPointNote(3), "+3 Stat Pts / ");
    assert.equal(statPointNote(25), "+25 Stat Pts / ");
    assert.equal(statPointNote(0), "");
    assert.equal(statPointNote(undefined), "");
    assert.equal(statPointNote(-4), "");
});
