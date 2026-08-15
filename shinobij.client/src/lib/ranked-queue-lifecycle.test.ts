import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    createRankedQueueLifecycle,
    rankedChallengeSettlementDecision,
} from "./ranked-queue-lifecycle";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => { resolve = next; });
    return { promise, resolve };
}

describe("ranked queue client lifecycle", () => {
    it("binds continuations to one normalized account owner", () => {
        const lifecycle = createRankedQueueLifecycle();
        lifecycle.bindOwner(" Kaya ");
        const kaya = lifecycle.beginJoin("KAYA");
        assert.equal(kaya.ownerKey, "kaya");
        assert.equal(lifecycle.isCurrent(kaya), true);

        assert.equal(lifecycle.bindOwner("Ren")?.generation, kaya.generation);
        assert.equal(lifecycle.isCurrent(kaya), false);
        const ren = lifecycle.beginJoin("ren");
        assert.equal(ren.ownerKey, "ren");
        assert.ok(ren.generation > kaya.generation);
    });

    it("retires an earlier same-owner attempt before retrying", () => {
        const lifecycle = createRankedQueueLifecycle();
        const first = lifecycle.beginJoin("Kaya");
        const second = lifecycle.beginJoin("kaya");
        assert.equal(lifecycle.isCurrent(first), false);
        assert.equal(lifecycle.confirmJoined(first), null);
        assert.ok(second.generation > first.generation);
    });

    it("does not poll before join confirmation and admits one poll at a time", async () => {
        const lifecycle = createRankedQueueLifecycle();
        const joining = lifecycle.beginJoin("Kaya");
        assert.equal((await lifecycle.run(joining, "poll", async () => "early")).status, "retired");

        const join = await lifecycle.run(joining, "join", async () => "joined");
        assert.deepEqual(join, { status: "completed", value: "joined" });
        const queued = lifecycle.confirmJoined(joining);
        assert.ok(queued);
        assert.equal(lifecycle.isCurrent(joining), false);
        assert.equal(lifecycle.isCurrent(queued), true);

        const gate = deferred<string>();
        const firstPoll = lifecycle.run(queued, "poll", () => gate.promise);
        const overlapping = await lifecycle.run(queued, "poll", async () => "duplicate");
        assert.equal(overlapping.status, "busy");
        gate.resolve("polled");
        assert.deepEqual(await firstPoll, { status: "completed", value: "polled" });
        assert.deepEqual(await lifecycle.run(queued, "poll", async () => "next"), {
            status: "completed",
            value: "next",
        });
    });

    it("consumes at most one match for a queue generation", () => {
        const lifecycle = createRankedQueueLifecycle();
        const queued = lifecycle.adoptQueued("Kaya");
        const launching = lifecycle.consumeMatch(queued);
        assert.equal(launching?.phase, "launching");
        assert.equal(lifecycle.isCurrent(queued), false);
        assert.equal(lifecycle.isCurrent(launching!), true);
        assert.equal(lifecycle.consumeMatch(queued), null);
    });

    it("serializes a leave behind an in-flight join while suppressing stale completion", async () => {
        const lifecycle = createRankedQueueLifecycle();
        const joining = lifecycle.beginJoin("Kaya");
        const joinGate = deferred<void>();
        const order: string[] = [];
        const join = lifecycle.run(joining, "join", async () => {
            order.push("join-start");
            await joinGate.promise;
            order.push("join-finish");
        });
        await Promise.resolve();

        assert.equal(lifecycle.retire(joining)?.generation, joining.generation);
        const leave = lifecycle.runCleanup(async () => { order.push("leave"); });
        await Promise.resolve();
        assert.deepEqual(order, ["join-start"]);

        joinGate.resolve();
        assert.equal((await join).status, "retired");
        await leave;
        assert.deepEqual(order, ["join-start", "join-finish", "leave"]);
        assert.equal(lifecycle.confirmJoined(joining), null);
    });

    it("serializes a leave behind an in-flight poll", async () => {
        const lifecycle = createRankedQueueLifecycle();
        const queued = lifecycle.adoptQueued("Kaya");
        const pollGate = deferred<void>();
        const order: string[] = [];
        const poll = lifecycle.run(queued, "poll", async () => {
            order.push("poll-start");
            await pollGate.promise;
            order.push("poll-finish");
        });
        await Promise.resolve();

        lifecycle.retire(queued);
        const leave = lifecycle.runCleanup(async () => { order.push("leave"); });
        pollGate.resolve();
        assert.equal((await poll).status, "retired");
        await leave;
        assert.deepEqual(order, ["poll-start", "poll-finish", "leave"]);
    });

    it("invalidates queued work on capability retirement or unmount disposal", async () => {
        const lifecycle = createRankedQueueLifecycle();
        const capabilityAttempt = lifecycle.adoptQueued("Kaya");
        lifecycle.retire(capabilityAttempt);
        assert.equal((await lifecycle.run(capabilityAttempt, "poll", async () => null)).status, "retired");

        const unmounted = lifecycle.adoptQueued("Kaya");
        assert.equal(lifecycle.disposeOwner("kaya")?.generation, unmounted.generation);
        assert.equal(lifecycle.isCurrent(unmounted), false);
    });
});

describe("ranked challenge settlement tracking", () => {
    const tracking = { challengeId: "challenge-ranked-1", observed: false, expiresAt: 10_000 } as const;

    it("ignores unrelated disappearance until the exact challenge has been observed", () => {
        assert.equal(rankedChallengeSettlementDecision(tracking, [{ id: "other" }], 1_000), "pending");
        assert.equal(rankedChallengeSettlementDecision(tracking, [], 1_000), "pending");
    });

    it("observes only the exact pending challenge and settles when it disappears", () => {
        assert.equal(rankedChallengeSettlementDecision(tracking, [{ id: tracking.challengeId }], 1_000), "observed");
        assert.equal(rankedChallengeSettlementDecision({ ...tracking, observed: true }, [], 2_000), "disappeared");
    });

    it("settles an exact resolution or conservative expiry", () => {
        assert.equal(rankedChallengeSettlementDecision(
            tracking,
            [{ id: tracking.challengeId, declined: true }],
            1_000,
        ), "resolved");
        assert.equal(rankedChallengeSettlementDecision(tracking, [], tracking.expiresAt), "expired");
    });
});
