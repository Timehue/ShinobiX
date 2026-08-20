import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { claimVnAction, VN_ACTION_LOCK_EXPIRY_MS } from "./vn-action-gate";

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

    it("self-heals a claim whose continuation never advanced the scene", () => {
        // Losing a VN-launched battle (or a failed finale claim) hands control
        // back to the still-mounted VN without changing page/line/finale state,
        // so the renderer's unlock effect never fires. The claim must expire or
        // every control on the full-screen overlay stays dead forever.
        const lock = { current: false };

        assert.equal(claimVnAction(lock, 1_000), true);
        assert.equal(claimVnAction(lock, 1_000 + VN_ACTION_LOCK_EXPIRY_MS - 1), false,
            "inside the batch window the double-fire protection must hold");
        assert.equal(claimVnAction(lock, 1_000 + VN_ACTION_LOCK_EXPIRY_MS), true,
            "a stale claim must not outlive the expiry window");
    });

    it("keeps the Skip/Leave escape hatch un-gated in the VN component", () => {
        // cancelScene must never require the action lock: it is the escape
        // hatch for exactly the states where the lock is (or was) wedged.
        const source = readFileSync(new URL("../components/TriggeredVisualNovel.tsx", import.meta.url), "utf8");
        assert.match(source, /function cancelScene\(\) \{ onCancel\(\); \}/,
            "cancelScene must call onCancel unconditionally, not behind beginAction()");
    });
});
