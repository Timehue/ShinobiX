import assert from "node:assert/strict";
import test from "node:test";
import {
    missionClaimActionScope,
    raidStartActionScope,
    remainingActionDeadline,
    startActionDeadline,
} from "./action-deadline-store";

test("action deadlines are absolute, scoped, and do not restart on repeated failures", () => {
    const player = `deadline-${Date.now()}`;
    const raid = raidStartActionScope(player);
    const claim = missionClaimActionScope(player);
    const startedAt = 10_000;
    const originalDeadline = startActionDeadline(raid, 5_000, startedAt);

    assert.equal(originalDeadline, 15_000);
    assert.equal(startActionDeadline(raid, 4_000, 11_000), originalDeadline, "the same limiter deadline is not restarted");
    assert.equal(remainingActionDeadline(raid, 12_000), 3_000);
    assert.equal(startActionDeadline(raid, 30_000, 11_000), 41_000, "a different active limiter window can extend the effective deadline");
    assert.equal(remainingActionDeadline(claim, 12_000), 0, "a raid refusal does not block mission claims");
    assert.equal(remainingActionDeadline(raid, 41_001), 0, "a resumed tab recomputes from the latest server deadline");

    assert.equal(startActionDeadline(claim, 2_000, 20_000), 22_000);
    assert.equal(remainingActionDeadline(raid, 20_000), 21_000, "claim deadlines do not replace or block raid deadlines");
});
