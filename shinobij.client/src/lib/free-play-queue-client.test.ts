import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  advanceFreePlayQueueAuthority,
  FreePlayQueueError,
  freePlayQueueAuthorityIsCurrent,
  freePlayPollOutcome,
  requestFreePlayQueue,
} from "./free-play-queue-client";

describe("Free-Play queue client", () => {
  it("retires every captured queue request when the normalized account changes", () => {
    const empty = { accountKey: "", generation: 0 } as const;
    const alpha = advanceFreePlayQueueAuthority(empty, "  Alpha ");
    const sameAlpha = advanceFreePlayQueueAuthority(alpha, "ALPHA");
    const beta = advanceFreePlayQueueAuthority(sameAlpha, "Beta");

    assert.strictEqual(sameAlpha, alpha, "case and surrounding whitespace do not create a second lease");
    assert.equal(freePlayQueueAuthorityIsCurrent(beta, alpha), false);
    assert.equal(freePlayQueueAuthorityIsCurrent(beta, beta), true);
    assert.deepEqual(beta, { accountKey: "beta", generation: alpha.generation + 1 });
  });

  it("treats a pruned queue entry as expired instead of searching forever", () => {
    assert.deepEqual(freePlayPollOutcome({ inQueue: false, match: null }), { kind: "expired" });
    assert.deepEqual(freePlayPollOutcome({ inQueue: true, match: null }), { kind: "waiting" });
    assert.deepEqual(
      freePlayPollOutcome({ inQueue: false, match: { matchId: "match-1" } }),
      { kind: "matched", matchId: "match-1" },
      "a durable match handoff wins over the queue-membership flag",
    );
  });

  it("surfaces server and network failures as recoverable queue errors", async () => {
    const rejectedFetch = async () => new Response(JSON.stringify({ error: "chronicle-locked" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
    await assert.rejects(
      requestFreePlayQueue("alpha", "join", {}, rejectedFetch as typeof fetch),
      (error: unknown) => error instanceof FreePlayQueueError && error.status === 409 && error.message === "chronicle-locked",
    );

    const offlineFetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(
      requestFreePlayQueue("alpha", "poll", {}, offlineFetch as typeof fetch),
      (error: unknown) => error instanceof FreePlayQueueError && error.status === null && /connection/i.test(error.message),
    );
  });

  it("sends navigation cleanup as a keepalive leave request", async () => {
    let captured: RequestInit | undefined;
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return new Response(JSON.stringify({ inQueue: false, match: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    await requestFreePlayQueue("alpha", "leave", { keepalive: true }, fakeFetch as typeof fetch);
    assert.equal(captured?.keepalive, true);
    assert.deepEqual(JSON.parse(String(captured?.body)), { name: "alpha", action: "leave" });
  });
});
