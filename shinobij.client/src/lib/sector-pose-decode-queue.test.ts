import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecodeQueue, type DecodeTicket } from "./sector-pose-delivery";

/** A job that finishes only when the test says so. */
function gate() {
    let open!: () => void, fail!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => { open = resolve; fail = reject; });
    return { done, open, fail };
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("the most urgent waiting decode runs next, oldest first among equals", async () => {
    const queue = createDecodeQueue();
    const order: string[] = [];
    const first = gate();
    const job = (name: string, ticket: DecodeTicket, wait?: Promise<void>) =>
        queue.run(ticket, async () => { order.push(name); await wait; });
    const running = job("peer-a", { priority: 1 }, first.done); // starts at once
    const jobs = [
        job("warm", { priority: 2 }),
        job("peer-b", { priority: 1 }),
        job("self", { priority: 0 }),
        job("peer-c", { priority: 1 }),
    ];
    await settle();
    assert.deepEqual(order, ["peer-a"], "a running decode is never interrupted");
    first.open();
    await Promise.all([running, ...jobs]);
    assert.deepEqual(order, ["peer-a", "self", "peer-b", "peer-c", "warm"]);
});

test("raising a waiting ticket moves it up", async () => {
    const queue = createDecodeQueue();
    const order: string[] = [];
    const first = gate();
    const warm: DecodeTicket = { priority: 2 };
    const all = [
        queue.run({ priority: 1 }, async () => { order.push("busy"); await first.done; }),
        queue.run(warm, async () => { order.push("warm-start"); }),
        queue.run({ priority: 1 }, async () => { order.push("peer"); }),
    ];
    await settle();
    warm.priority = 0; // the player started moving and needs this page now
    first.open();
    await Promise.all(all);
    assert.deepEqual(order, ["busy", "warm-start", "peer"]);
});

test("the player's own lane starts its page while a crowd page is still decoding", async () => {
    // One lane only for the player's figure, one for everything.
    const queue = createDecodeQueue([0, 2]);
    const started: string[] = [];
    const crowd = gate(), crowdNext = gate();
    const job = (name: string, ticket: DecodeTicket, wait?: Promise<void>) =>
        queue.run(ticket, async lane => { started.push(`${name}@${lane}`); await wait; });
    const jobs = [
        job("peer-a", { priority: 1 }, crowd.done),     // the crowd lane
        job("peer-b", { priority: 1 }, crowdNext.done), // waits: the own lane never takes it
        job("warm", { priority: 2 }),
        job("self-walk", { priority: 0 }),              // the own lane, at once
    ];
    await settle();
    assert.deepEqual(started, ["peer-a@1", "self-walk@0"], "the player's page does not wait on peer-a");
    crowd.open(); await settle();
    crowdNext.open();
    await Promise.all(jobs);
    assert.deepEqual(started, ["peer-a@1", "self-walk@0", "peer-b@1", "warm@1"]);
});

test("with the own lane busy, the player's next page takes the crowd lane ahead of the crowd", async () => {
    const queue = createDecodeQueue([0, 2]);
    const started: string[] = [];
    const self = gate();
    const job = (name: string, ticket: DecodeTicket, wait?: Promise<void>) =>
        queue.run(ticket, async lane => { started.push(`${name}@${lane}`); await wait; });
    const busy = job("self-start", { priority: 0 }, self.done);
    const crowd = gate();
    const peer = job("peer-a", { priority: 1 }, crowd.done);
    const queued = [job("peer-b", { priority: 1 }), job("self-brake", { priority: 0 })];
    await settle();
    assert.deepEqual(started, ["self-start@0", "peer-a@1"]);
    crowd.open(); await settle();
    // The own lane is still busy, so the crowd lane takes the player's page before peer-b.
    assert.deepEqual(started, ["self-start@0", "peer-a@1", "self-brake@1", "peer-b@1"]);
    self.open();
    await Promise.all([busy, peer, ...queued]);
});

test("a raised ticket starts on the own lane once pumped", async () => {
    const queue = createDecodeQueue([0, 2]);
    const started: string[] = [];
    const crowd = gate();
    const warm: DecodeTicket = { priority: 2 };
    const all = [
        queue.run({ priority: 1 }, async () => { started.push("peer"); await crowd.done; }),
        queue.run(warm, async lane => { started.push(`warm-start@${lane}`); }),
    ];
    await settle();
    assert.deepEqual(started, ["peer"]);
    warm.priority = 0; queue.pump();
    await settle();
    assert.deepEqual(started, ["peer", "warm-start@0"], "the player's start page does not wait for the crowd");
    crowd.open();
    await Promise.all(all);
});

test("a failed decode rejects its caller and the queue keeps going", async () => {
    const queue = createDecodeQueue();
    const broken = queue.run({ priority: 0 }, async () => { throw new Error("Pose decoder unavailable"); });
    const next = queue.run({ priority: 1 }, async () => "decoded");
    await assert.rejects(broken, /Pose decoder unavailable/);
    assert.equal(await next, "decoded");
    assert.equal(queue.waiting, 0);
});
