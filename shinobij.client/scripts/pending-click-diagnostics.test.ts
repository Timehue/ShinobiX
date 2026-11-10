import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import type { Locator, TestInfo } from "@playwright/test";
import {
  clickWithPendingDiagnostics,
  runWithPendingClickDiagnostics,
} from "../e2e/helpers/pending-click-diagnostics";

type Options = Parameters<typeof runWithPendingClickDiagnostics<string>>[0];
type Event = Parameters<Options["emit"]>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function scheduler() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const cancelled: number[] = [];
  return {
    now: () => now,
    timers,
    cancelled,
    after: (milliseconds: number, callback: () => void) => {
      const key = ++id;
      timers.set(key, { due: now + milliseconds, callback });
      return () => { cancelled.push(key); timers.delete(key); };
    },
    advance: (milliseconds: number) => {
      const end = now + milliseconds;
      while (true) {
        const entry = [...timers].sort((a, b) => a[1].due - b[1].due).find(([, timer]) => timer.due <= end);
        if (!entry) break;
        now = entry[1].due;
        timers.delete(entry[0]);
        entry[1].callback();
      }
      now = end;
    },
  };
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function setup(overrides: Partial<Options> = {}) {
  const action = deferred<string>();
  const clock = scheduler();
  const events: Event[] = [];
  const calls = { action: 0, snapshot: 0, probe: 0 };
  const order: string[] = [];
  let closed = false;
  const result = runWithPendingClickDiagnostics({
    action: () => { calls.action++; order.push("action"); return action.promise; },
    isClosed: () => closed,
    emit: (event) => { events.push(event); order.push(event.event); },
    snapshot: async () => { calls.snapshot++; order.push("read-snapshot"); return { matchCount: 1 }; },
    probe: async () => { calls.probe++; order.push("read-probe"); return { frames: [1, 2] }; },
    scheduler: clock,
    ...overrides,
  });
  return { action, clock, events, calls, order, result, close: () => { closed = true; } };
}

test("fast success starts the action immediately, cancels the only timer and never captures", async () => {
  const h = setup();
  assert.deepEqual(h.order, ["action"]);
  assert.equal(h.clock.timers.size, 1);
  h.action.resolve("original value");
  assert.equal(await h.result, "original value");
  assert.equal(h.clock.timers.size, 0);
  assert.deepEqual(h.clock.cancelled, [1]);
  h.clock.advance(20_000);
  assert.deepEqual(h.calls, { action: 1, snapshot: 0, probe: 0 });
  assert.equal(h.events.length, 0);
});

for (const rejection of [new Error("original error"), "original rejection", undefined]) {
  test(`fast failure preserves rejection identity (${typeof rejection}) and clears the timer`, async () => {
    const h = setup();
    const check = assert.rejects(h.result, (error: unknown) => Object.is(error, rejection));
    h.action.reject(rejection);
    await check;
    assert.equal(h.clock.timers.size, 0);
    h.clock.advance(5_000);
    assert.deepEqual(h.calls, { action: 1, snapshot: 0, probe: 0 });
    assert.equal(h.events.length, 0);
  });
}

test("a synchronous action throw is identical and does not start diagnostics", () => {
  const error = { message: "synchronous action failure" };
  const clock = scheduler();
  assert.throws(() => setup({ action: () => { throw error; }, scheduler: clock }), (actual) => actual === error);
  assert.equal(clock.timers.size, 0);
});

test("capture triggers exactly once at 5s, saving Node and snapshot evidence before the probe", async () => {
  const h = setup();
  const callback = [...h.clock.timers.values()][0].callback;
  h.clock.advance(4_999);
  assert.equal(h.events.length, 0);
  h.clock.advance(1);
  assert.equal(h.events[0].elapsedMs, 5_000);
  await flush();
  callback();
  h.clock.advance(20_000);
  await flush();
  assert.deepEqual(h.calls, { action: 1, snapshot: 1, probe: 1 });
  assert.deepEqual(h.order, ["action", "pending", "read-snapshot", "snapshot", "probe-start", "read-probe", "probe"]);
  h.action.resolve("done");
  await h.result;
  assert.deepEqual(h.events.at(-1)?.settled, { elapsedMs: 25_000, outcome: "resolved", phase: "done" });
  assert.equal(h.clock.timers.size, 0);
});

test("a never-settling capture cannot delay a completed click", async () => {
  const h = setup({ snapshot: () => new Promise(() => {}) });
  h.clock.advance(5_000);
  h.action.resolve("completed while snapshot hung");
  assert.equal(await h.result, "completed while snapshot hung");
  assert.deepEqual(h.events.at(-1)?.settled, { elapsedMs: 5_000, outcome: "resolved", phase: "snapshot" });
  // The bounded background read may finish later; it is not joined to the click.
  h.clock.advance(1_000);
  await flush();
  assert.equal(h.events.at(-1)?.event, "snapshot");
  assert.deepEqual(h.events.at(-1)?.detail, { status: "node-deadline" });
  assert.equal(h.calls.probe, 0);
  assert.equal(h.clock.timers.size, 0);
});

test("a timed-out snapshot never starts a probe, including after late resolution", async () => {
  const snapshot = deferred<unknown>();
  const h = setup({ snapshot: () => snapshot.promise });
  h.clock.advance(5_000);
  h.clock.advance(1_000);
  await flush();
  assert.deepEqual(h.events.at(-1)?.detail, { status: "node-deadline" });
  snapshot.resolve({ late: true });
  await flush();
  assert.equal(h.calls.probe, 0);
  assert.equal(h.events.filter((event) => event.event === "snapshot").length, 1);
  h.action.resolve("done");
  await h.result;
  assert.equal(h.clock.timers.size, 0);
});

test("settlement during snapshot prevents the probe and preserves the original error", async () => {
  const snapshot = deferred<unknown>();
  const h = setup({ snapshot: () => snapshot.promise });
  h.clock.advance(5_000);
  const error = new Error("click failed while capturing");
  const check = assert.rejects(h.result, (actual) => actual === error);
  h.action.reject(error);
  await check;
  snapshot.resolve({ matchCount: 1 });
  await flush();
  assert.equal(h.calls.probe, 0);
  assert.deepEqual(h.events.at(-1)?.settled, { elapsedMs: 5_000, outcome: "rejected", phase: "snapshot" });
  assert.equal(h.clock.timers.size, 0);
});

test("page closure before the trigger leaves Node evidence without browser operations", async () => {
  const h = setup();
  h.close();
  h.clock.advance(5_000);
  await flush();
  assert.equal(h.events[0].pageClosed, true);
  assert.deepEqual(h.calls, { action: 1, snapshot: 0, probe: 0 });
  h.action.resolve("done");
  await h.result;
});

test("page closure during snapshot prevents any subsequent probe", async () => {
  const snapshot = deferred<unknown>();
  const h = setup({ snapshot: () => snapshot.promise });
  h.clock.advance(5_000);
  h.close();
  snapshot.resolve({ matchCount: 0 });
  await flush();
  assert.equal(h.events.at(-1)?.pageClosed, true);
  assert.equal(h.calls.probe, 0);
  h.action.resolve("done");
  await h.result;
});

test("a closure while publishing probe-start also prevents the browser probe", async () => {
  const h = setup({ emit: (event) => { if (event.event === "probe-start") h.close(); } });
  h.clock.advance(5_000);
  await flush();
  assert.equal(h.calls.probe, 0);
  h.action.resolve("done");
  await h.result;
});

test("settlement during the probe is recorded without waiting for it", async () => {
  const probe = deferred<unknown>();
  const h = setup({ probe: () => probe.promise });
  h.clock.advance(5_000);
  await flush();
  h.clock.advance(250);
  h.action.resolve("done");
  assert.equal(await h.result, "done");
  assert.deepEqual(h.events.at(-1)?.settled, { elapsedMs: 5_250, outcome: "resolved", phase: "probe" });
  probe.resolve({ frames: [1, 2] });
  await flush();
  assert.equal(h.events.at(-1)?.event, "probe");
  assert.equal(h.events.at(-1)?.settled?.elapsedMs, 5_250);
  assert.equal(h.clock.timers.size, 0);
});

test("a never-settling probe has its own independent Node deadline", async () => {
  const h = setup({ probe: () => new Promise(() => {}) });
  h.clock.advance(5_000);
  await flush();
  h.clock.advance(1_000);
  await flush();
  assert.equal(h.events.at(-1)?.event, "probe");
  assert.deepEqual(h.events.at(-1)?.detail, { status: "node-deadline" });
  assert.equal(h.clock.timers.size, 0);
  h.action.resolve("done");
  await h.result;
});

test("throwing and rejected captures leave the click authoritative and clean up deadlines", async () => {
  for (const snapshot of [() => { throw new Error("snapshot throw"); }, () => Promise.reject("snapshot rejection")]) {
    const h = setup({ snapshot });
    h.clock.advance(5_000);
    await flush();
    assert.equal((h.events.at(-1)?.detail as { status: string }).status, "error");
    assert.equal(h.calls.probe, 0);
    h.action.resolve("done");
    assert.equal(await h.result, "done");
    assert.equal(h.clock.timers.size, 0);
  }
});

test("throwing, rejected and hung attachments cannot delay or replace the click", async () => {
  for (const emit of [() => { throw new Error("attach throw"); }, () => Promise.reject("attach rejection"), () => new Promise(() => {})]) {
    const h = setup({ emit });
    h.clock.advance(5_000);
    await flush();
    assert.equal(h.calls.snapshot, 1);
    assert.equal(h.calls.probe, 1);
    h.action.resolve("done");
    assert.equal(await h.result, "done");
    assert.equal(h.clock.timers.size, 0);
  }
});

test("late snapshot/probe rejection and failed emits produce no unhandled rejections", async () => {
  const unhandled: unknown[] = [];
  const listener = (error: unknown) => { unhandled.push(error); };
  process.on("unhandledRejection", listener);
  try {
    for (const operation of ["snapshot", "probe"] as const) {
      const capture = deferred<unknown>();
      const h = setup({ [operation]: () => capture.promise, emit: () => Promise.reject("attachment unavailable") });
      h.clock.advance(5_000);
      await flush();
      h.clock.advance(1_000);
      await flush();
      h.action.resolve("done");
      assert.equal(await h.result, "done");
      capture.reject(new Error("late diagnostic rejection"));
      await setImmediate();
      assert.equal(h.clock.timers.size, 0);
    }
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

test("non-WebKit uses exactly one direct click, without reading diagnostic metadata", async () => {
  let clicks = 0;
  const original = Promise.resolve();
  const locator = {
    click: () => { clicks++; return original; },
    page: () => { throw new Error("must not inspect page"); },
  } as unknown as Locator;
  const info = { project: { use: { browserName: "chromium" } } } as TestInfo;
  assert.equal(clickWithPendingDiagnostics(locator, info, { stage: "pass", locatorDescription: "Pass", moves: [] }), original);
  await original;
  assert.equal(clicks, 1);
});
