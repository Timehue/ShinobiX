import assert from "node:assert/strict";
import test from "node:test";
import type { ActivitySpine } from "../../../shared/activity-spine";
import { __activitySpineClientTest, preferredNowActivity } from "./activity-spine-client";

const spine = (eligibility: "eligible" | "blocked" | "complete"): ActivitySpine => ({
    generatedAt: 1,
    returningPlayer: false,
    selectedFocus: "auto",
    resolvedFocus: "companions",
    horizons: {
        now: [{
            id: "now-1",
            horizon: "now",
            title: "Current authority",
            why: "The server selected this.",
            commitment: "2 min",
            screen: "missions",
            cta: "Open Missions",
            eligibility,
        }],
        today: [],
        "this-week": [],
        "long-term": [],
    },
});

test("persistent direction uses the server Now recommendation even when blocked", () => {
    assert.equal(preferredNowActivity(spine("eligible"))?.id, "now-1");
    assert.equal(preferredNowActivity(spine("blocked"))?.id, "now-1");
});

test("a completed-only Now horizon remains inspectable instead of inventing a second engine", () => {
    assert.equal(preferredNowActivity(spine("complete"))?.id, "now-1");
    assert.equal(preferredNowActivity(null), null);
});

test("forced refreshes still join one in-flight recommendation request", async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    let release: (() => void) | undefined;
    globalThis.fetch = async () => {
        requestCount += 1;
        await new Promise<void>((resolve) => { release = resolve; });
        return new Response(JSON.stringify({ spine: spine("eligible") }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };
    __activitySpineClientTest.clear();
    try {
        const first = __activitySpineClientTest.request("Naruto", "auto", true);
        const second = __activitySpineClientTest.request("Naruto", "auto", true);
        assert.equal(requestCount, 1);
        release?.();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        assert.equal(firstResult, secondResult);
    } finally {
        globalThis.fetch = originalFetch;
        __activitySpineClientTest.clear();
    }
});
