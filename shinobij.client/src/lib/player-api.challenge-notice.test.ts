import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { postPlayerChallengeNotice } from "./player-api";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const challenge = { id: "challenge-session-fence" } as Parameters<typeof postPlayerChallengeNotice>[1];

afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
});

function makeBackoffsImmediate(onBackoff: () => void = () => {}): void {
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => {
        onBackoff();
        callback(...args);
        return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
}

describe("postPlayerChallengeNotice continuation authority", () => {
    it("cancels later retries when a failed attempt retires its same-name session epoch", async () => {
        let sessionIsCurrent = true;
        let fetchCalls = 0;
        let backoffs = 0;
        makeBackoffsImmediate(() => {
            backoffs += 1;
            sessionIsCurrent = false;
        });
        globalThis.fetch = (async () => {
            fetchCalls += 1;
            return { ok: false } as Response;
        }) as typeof fetch;

        const notified = await postPlayerChallengeNotice("opponent", challenge, {
            shouldContinue: () => sessionIsCurrent,
        });

        assert.equal(notified, false);
        assert.equal(fetchCalls, 1, "the replacement session must not issue attempt two");
        assert.equal(backoffs, 1, "the predicate must be rechecked after the failed attempt's backoff");
    });

    it("rejects a successful response that settles after its session retires", async () => {
        let sessionIsCurrent = true;
        let fetchCalls = 0;
        globalThis.fetch = (async () => {
            fetchCalls += 1;
            sessionIsCurrent = false;
            return { ok: true } as Response;
        }) as typeof fetch;

        const notified = await postPlayerChallengeNotice("opponent", challenge, {
            shouldContinue: () => sessionIsCurrent,
        });

        assert.equal(notified, false);
        assert.equal(fetchCalls, 1);
    });

    it("keeps two-argument callers backward compatible", async () => {
        let fetchCalls = 0;
        let backoffs = 0;
        makeBackoffsImmediate(() => { backoffs += 1; });
        globalThis.fetch = (async () => {
            fetchCalls += 1;
            return { ok: fetchCalls === 2 } as Response;
        }) as typeof fetch;

        const notified = await postPlayerChallengeNotice("opponent", challenge);

        assert.equal(notified, true);
        assert.equal(fetchCalls, 2);
        assert.equal(backoffs, 1);
    });
});
