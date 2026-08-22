import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_RETRY_MAX_ROUNDS, scheduleImageCategoryRetry } from "./shared-image-cache";

type Scheduled = { delay: number; run: () => void };

function withStubbedTimers(body: (scheduled: Scheduled[]) => void) {
    const scheduled: Scheduled[] = [];
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
        setTimeout: (run: () => void, delay: number) => { scheduled.push({ delay, run }); return scheduled.length; },
    };
    try { body(scheduled); } finally { (globalThis as { window?: unknown }).window = previous; }
}

test("the unattended image-category retry is bounded and backs off", () => {
    withStubbedTimers((scheduled) => {
        const rounds = new Map<string, number>();
        // One extra attempt past the budget proves the loop actually stops.
        for (let attempt = 0; attempt < IMAGE_RETRY_MAX_ROUNDS + 3; attempt++) {
            scheduleImageCategoryRetry(rounds, "item", () => false, () => {});
        }
        assert.equal(scheduled.length, IMAGE_RETRY_MAX_ROUNDS,
            "a permanently broken category must stop re-arming instead of polling for the whole session");
        assert.deepEqual(scheduled.map(entry => entry.delay), [10_000, 20_000, 30_000, 40_000],
            "each round must back off further than the last");
    });
});

test("each category carries its own budget and a success refunds it", () => {
    withStubbedTimers((scheduled) => {
        const rounds = new Map<string, number>();
        for (let attempt = 0; attempt < IMAGE_RETRY_MAX_ROUNDS; attempt++) {
            scheduleImageCategoryRetry(rounds, "item", () => false, () => {});
        }
        scheduleImageCategoryRetry(rounds, "item", () => false, () => {});
        assert.equal(scheduled.length, IMAGE_RETRY_MAX_ROUNDS, "item is exhausted");

        // A different category must not inherit item's spent budget.
        scheduleImageCategoryRetry(rounds, "jutsu", () => false, () => {});
        assert.equal(scheduled.length, IMAGE_RETRY_MAX_ROUNDS + 1, "jutsu has its own budget");

        // App clears the entry on a successful load; the next failure starts fresh.
        rounds.delete("item");
        scheduleImageCategoryRetry(rounds, "item", () => false, () => {});
        assert.equal(scheduled.at(-1)?.delay, 10_000, "a refunded category restarts at the base delay");
    });
});

test("a category that loaded before the timer fires is not re-fetched", () => {
    withStubbedTimers((scheduled) => {
        let retried = false;
        scheduleImageCategoryRetry(new Map(), "item", () => true, () => { retried = true; });
        scheduled[0]?.run();
        assert.equal(retried, false, "an already-loaded category must not be re-requested");
    });
});
