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

test("a failed decode rejects its caller and the queue keeps going", async () => {
    const queue = createDecodeQueue();
    const broken = queue.run({ priority: 0 }, async () => { throw new Error("Pose decoder unavailable"); });
    const next = queue.run({ priority: 1 }, async () => "decoded");
    await assert.rejects(broken, /Pose decoder unavailable/);
    assert.equal(await next, "decoded");
    assert.equal(queue.waiting, 0);
});
