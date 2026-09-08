import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreAccountFromServer } from "./boot-restore";
import { beginSessionLoad } from "./session-load-authority";

type Snapshot = { character: { name: string }; version: number };
const saved = (name = "Shinobi"): Snapshot => ({ character: { name }, version: 7 });
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function fixture() {
    const generation = { current: 0 };
    const scope = beginSessionLoad(generation, "Shinobi");
    const first = deferred<Snapshot | null>();
    const lock = deferred<{ id: string }>();
    const retry = deferred<Snapshot | null>();
    const guest = deferred<string | null>();
    const events: string[] = [], requested: string[] = [];
    const applied: [Snapshot, { id: string }][] = [];
    let timeout!: () => void;
    const run = () => restoreAccountFromServer({
        accountName: "Shinobi", scope,
        pullSave: (name) => { requested.push(name); return requested.length === 1 ? first.promise : retry.promise; },
        fetchBattleLock: () => lock.promise,
        resumeGuest: () => { events.push("guest"); return guest.promise; },
        applySnapshot: (snapshot, proof) => { applied.push([snapshot, proof]); },
        onFailure: () => { scope.retire(); events.push("failure"); },
        onTimeout: () => { events.push("timeout"); },
        onSettled: () => { events.push("settled"); },
        onComplete: () => { events.push("complete"); },
        scheduleTimeout: (callback, delay) => {
            assert.equal(delay, 12000);
            timeout = callback;
            return () => { events.push("cancel-timeout"); };
        },
    });
    return { run, generation, scope, first, lock, retry, guest, events, requested, applied, timeout: () => timeout() };
}
async function flush() { await new Promise<void>(resolve => setImmediate(resolve)); }

test("restore waits for both the save and battle lock, then applies the matching account", async () => {
    const f = fixture(), pending = f.run();
    f.first.resolve(saved("SHINOBI"));
    await flush();
    assert.deepEqual(f.applied, []);
    f.lock.resolve({ id: "active-fight" });
    await pending;
    assert.deepEqual(f.applied, [[saved("SHINOBI"), { id: "active-fight" }]]);
    assert.deepEqual(f.events, ["settled", "cancel-timeout", "complete"]);
});

test("timeout retires the restore before a late server response can paint", async () => {
    const f = fixture(), pending = f.run();
    f.timeout();
    assert.equal(f.scope.isCurrent(), false);
    f.first.resolve(saved()); f.lock.resolve({ id: "fight" });
    await pending;
    assert.deepEqual(f.applied, []);
    assert.deepEqual(f.events, ["failure", "timeout", "settled", "cancel-timeout"]);
});

test("a newer session blocks both old snapshot application and old completion callbacks", async () => {
    const f = fixture(), pending = f.run();
    beginSessionLoad(f.generation, "Other");
    f.timeout();
    f.first.resolve(saved()); f.lock.resolve({ id: "fight" });
    await pending;
    assert.deepEqual(f.applied, []);
    assert.deepEqual(f.events, ["settled", "cancel-timeout"]);
});

test("guest recovery reuses the sealed lock and accepts only the expected account", async () => {
    const f = fixture(), pending = f.run();
    f.first.resolve(null); f.lock.resolve({ id: "fight" }); f.guest.resolve("SHINOBI");
    await flush();
    assert.deepEqual(f.requested, ["Shinobi", "SHINOBI"]);
    f.retry.resolve(saved());
    await pending;
    assert.deepEqual(f.applied, [[saved(), { id: "fight" }]]);
    assert.deepEqual(f.events, ["guest", "settled", "cancel-timeout", "complete"]);
});

test("foreign initial and retry snapshots never apply and failure still settles", async () => {
    const f = fixture(), pending = f.run();
    f.first.resolve(saved("Other")); f.lock.resolve({ id: "fight" }); f.guest.resolve("Shinobi");
    f.retry.resolve(saved("Other"));
    await pending;
    assert.deepEqual(f.applied, []);
    assert.deepEqual(f.events, ["guest", "failure", "settled", "cancel-timeout"]);
});

for (const phase of ["guest", "retry"] as const) {
    test(`a session switch during ${phase} recovery prevents stale continuation`, async () => {
        const f = fixture(), pending = f.run();
        f.first.resolve(null); f.lock.resolve({ id: "fight" });
        await flush();
        if (phase === "retry") { f.guest.resolve("Shinobi"); await flush(); }
        beginSessionLoad(f.generation, "Other");
        if (phase === "guest") f.guest.resolve("Shinobi"); else f.retry.resolve(saved());
        await pending;
        assert.deepEqual(f.applied, []);
        assert.equal(f.requested.length, phase === "guest" ? 1 : 2);
        assert.deepEqual(f.events, ["guest", "settled", "cancel-timeout"]);
    });
}

test("a rejected request retains rejection while clearing the timer and completing the current gate", async () => {
    const f = fixture(), pending = f.run();
    f.first.reject(new Error("offline")); f.lock.resolve({ id: "fight" });
    await assert.rejects(pending, /offline/);
    assert.deepEqual(f.applied, []);
    assert.deepEqual(f.events, ["settled", "cancel-timeout", "complete"]);
});
