import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claimVnAction } from "./vn-action-gate";

describe("VN action gate", () => {
    it("accepts only the first transition before the renderer unlocks", () => {
        const lock = { current: false };

        assert.equal(claimVnAction(lock), true);
        assert.equal(claimVnAction(lock), false);
        assert.equal(claimVnAction(lock), false);
    });

    it("accepts the next deliberate transition after a render unlock", () => {
        const lock = { current: false };

        assert.equal(claimVnAction(lock), true);
        lock.current = false;
        assert.equal(claimVnAction(lock), true);
    });
});
