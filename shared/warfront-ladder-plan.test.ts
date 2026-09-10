import assert from "node:assert/strict";
import test from "node:test";
import { defaultWarfrontLadderPlan, moveWarfrontLadderPet, parseWarfrontLadderPlan } from "./warfront-ladder-plan.js";

test("offline Warfront defense accepts only four unique legal cells and no future commands", () => {
    const plan = defaultWarfrontLadderPlan();
    assert.deepEqual(parseWarfrontLadderPlan(plan), plan);
    for (const deployment of [[3, 3, 7, 8], [3, 4, 7, 10], [3, 4, 7, -1], [3, 4, 7, 1.5], [3, 4, 7]]) {
        assert.equal(parseWarfrontLadderPlan({ ...plan, deployment }), null);
    }
    assert.equal(parseWarfrontLadderPlan({ ...plan, formation: [0, 1, 2, 2] }), null);
    assert.equal(parseWarfrontLadderPlan({ ...plan, reformAfterClash: 0 }), null);
    assert.equal(parseWarfrontLadderPlan({ ...plan, reforms: [{ afterClash: 0 }] }), null);
});

test("moving a ranked pet swaps occupied positions without losing either pet", () => {
    const plan = defaultWarfrontLadderPlan();
    const moved = moveWarfrontLadderPet(plan, 0, 7);
    assert.deepEqual(moved.deployment, [7, 4, 3, 8]);
    assert.deepEqual(plan.deployment, [3, 4, 7, 8]);
    assert.deepEqual(parseWarfrontLadderPlan(moved), moved);
    assert.deepEqual(moveWarfrontLadderPet(moved, 0, 0).deployment, [0, 4, 3, 8]);
    assert.equal(moveWarfrontLadderPet(moved, -1, 4), moved);
});
