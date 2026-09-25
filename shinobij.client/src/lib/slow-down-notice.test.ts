import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAlertRouter, isSlowDownNotice, SLOW_DOWN_TOAST_GAP_MS } from "./slow-down-notice";

describe("slow-down notices", () => {
    it("recognises the server's rate-limit wording, the client's 429 paraphrases and save-lock retries", () => {
        for (const message of [
            "You're going a little fast — try again in 3s.",
            "This action is temporarily unavailable. Try again in 3s.",
            "Rate limit exceeded.",
            "❌ Rate limit exceeded.",
            "Too many exploration requests. Wait a moment, then try again; your saved attempt will be reused.",
            "Too many requests",
            "The clan server is busy (rate limited). Wait a moment and retry.",
            "Concurrent save in flight. Retry.",
            "Another clan or territory change is saving. Retry.",
        ]) assert.equal(isSlowDownNotice(message), true, message);
    });

    it("leaves every real error as a normal notice", () => {
        for (const message of [
            "Not enough ryo. You need 500.",
            "Your session needs to reconnect.",
            "Daily tile exploration limit reached (150/150). Resets at midnight UTC.",
            "Couldn't save your progress",
            "Training could not be started.",
            "Too many active challenges.",
            "Rate this companion",
        ]) assert.equal(isSlowDownNotice(message), false, message);
    });
});

describe("alert routing", () => {
    const slow = "You're going a little fast — try again in 3s.";

    it("toasts a slow-down notice and drops its repeats inside the window", () => {
        const route = createAlertRouter();
        const t0 = 1_000_000;
        assert.equal(route(slow, t0), "toast");
        for (let i = 1; i < 30; i += 1) assert.equal(route(slow.replace("3s", `${(i % 9) + 1}s`), t0 + i * 500), "drop", "a new countdown is still a repeat");
        assert.equal(route(slow, t0 + SLOW_DOWN_TOAST_GAP_MS), "toast", "a fresh window shows it again");
    });

    it("never hides a different feature's notice behind another one", () => {
        const route = createAlertRouter();
        assert.equal(route(slow, 0), "toast");
        assert.equal(route("Too many exploration requests. Wait a moment. Your discovered chest remains saved.", 1_000), "toast");
    });

    it("keeps real errors and multi-line detail as modals", () => {
        const route = createAlertRouter();
        assert.equal(route("Not enough ryo. You need 500.", 0), "modal");
        assert.equal(route("Some images failed:\nRate limit exceeded.\nPrompt rejected.", 0), "modal");
    });
});
