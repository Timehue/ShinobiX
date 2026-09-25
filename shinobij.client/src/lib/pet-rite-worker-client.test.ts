import assert from "node:assert/strict";
import test from "node:test";
import {
    RITE_WORKER_ATTEMPTS,
    RiteWorkerUnavailable,
    resolveRite,
    resolveRiteInWorker,
    type RiteSimulationRequest,
} from "./pet-rite-worker-client";
import type { RiteResult } from "./pet-warfront-rite";
import type { Pet } from "../types/pet";

function workerProbe() {
    const probe = {
        onmessage: null as Worker["onmessage"],
        onerror: null as Worker["onerror"],
        onmessageerror: null as Worker["onmessageerror"],
        terminated: 0,
        sent: null as RiteSimulationRequest | null,
        postMessage(value: RiteSimulationRequest) { this.sent = value; },
        terminate() { this.terminated++; },
    };
    return probe;
}
const request: RiteSimulationRequest = {
    blue: [{ id: "trained", image: "large-inline-art", bodyImage: "large-model-art", level: 40, attack: 245, speed: 95 } as Pet],
    red: [], seed: 23,
};

test("worker success preserves combat stats, strips art and releases every handler", async () => {
    const worker = workerProbe();
    const pending = resolveRiteInWorker(request, new AbortController().signal, () => worker);
    assert.equal(worker.sent?.blue[0].level, 40);
    assert.equal(worker.sent?.blue[0].attack, 245);
    assert.equal(worker.sent?.blue[0].speed, 95);
    assert.equal(worker.sent?.blue[0].image, "");
    assert.equal(worker.sent?.blue[0].bodyImage, undefined);
    assert.equal(request.blue[0].image, "large-inline-art");
    const result = { seed: 23, clashes: [] } as unknown as RiteResult;
    worker.onmessage?.call(worker as unknown as Worker, { data: { result } } as MessageEvent);
    assert.equal(await pending, result);
    assert.equal(worker.terminated, 1);
    assert.equal(worker.onmessage, null);
    assert.equal(worker.onerror, null);
    assert.equal(worker.onmessageerror, null);
});

test("leaving during simulation terminates its CPU work and ignores a queued result", async () => {
    const worker = workerProbe();
    const abort = new AbortController();
    const pending = resolveRiteInWorker(request, abort.signal, () => worker);
    const late = worker.onmessage;
    abort.abort();
    await assert.rejects(pending, { name: "AbortError" });
    late?.call(worker as unknown as Worker, { data: { result: { seed: 23 } } } as MessageEvent);
    assert.equal(worker.terminated, 1);
    assert.equal(worker.onmessage, null);
});

test("worker and clone failures release the worker and permit a fresh retry", async () => {
    for (const failure of ["error", "messageerror", "postMessage"] as const) {
        const worker = workerProbe();
        if (failure === "postMessage") worker.postMessage = () => { throw new Error("clone failed"); };
        const pending = resolveRiteInWorker(request, new AbortController().signal, () => worker);
        if (failure === "error") worker.onerror?.call(worker as unknown as Worker, { preventDefault() {} } as ErrorEvent);
        if (failure === "messageerror") worker.onmessageerror?.call(worker as unknown as Worker, {} as MessageEvent);
        await assert.rejects(pending);
        assert.equal(worker.terminated, 1);
        assert.equal(worker.onmessage, null);
    }
});

test("an already cancelled match never creates a worker", async () => {
    const abort = new AbortController();
    abort.abort();
    let created = false;
    await assert.rejects(resolveRiteInWorker(request, abort.signal, () => { created = true; return workerProbe(); }), { name: "AbortError" });
    assert.equal(created, false);
});

test("a worker that cannot run is reported as unavailable, never as a battle verdict", async () => {
    for (const failure of ["construct", "error", "messageerror", "postMessage", "garbage"] as const) {
        const worker = workerProbe();
        if (failure === "postMessage") worker.postMessage = () => { throw new Error("clone failed"); };
        const pending = resolveRiteInWorker(request, new AbortController().signal, () => {
            if (failure === "construct") throw new Error("Failed to construct 'Worker'");
            return worker;
        });
        if (failure === "error") worker.onerror?.call(worker as unknown as Worker, { preventDefault() {} } as ErrorEvent);
        if (failure === "messageerror") worker.onmessageerror?.call(worker as unknown as Worker, {} as MessageEvent);
        if (failure === "garbage") worker.onmessage?.call(worker as unknown as Worker, { data: null } as MessageEvent);
        await assert.rejects(pending, (error: unknown) => error instanceof RiteWorkerUnavailable, failure);
    }
    // The simulation itself rejecting the plan is a different, final answer.
    const worker = workerProbe();
    const pending = resolveRiteInWorker(request, new AbortController().signal, () => worker);
    worker.onmessage?.call(worker as unknown as Worker, { data: { error: "Unable to resolve this formation. Please retry." } } as MessageEvent);
    await assert.rejects(pending, (error: unknown) => error instanceof Error && !(error instanceof RiteWorkerUnavailable)
        && error.message === "Unable to resolve this formation. Please retry.");
});

const settled = { seed: 23, clashes: [] } as unknown as RiteResult;

test("resolveRite gives a worker that failed to run exactly one fresh attempt", async () => {
    const calls: number[] = [];
    const result = await resolveRite(request, new AbortController().signal, async () => {
        calls.push(calls.length + 1);
        if (calls.length === 1) throw new RiteWorkerUnavailable("Unable to prepare the battle. Please retry.");
        return settled;
    });
    assert.equal(result, settled);
    assert.deepEqual(calls, [1, 2]);

    let attempts = 0;
    await assert.rejects(resolveRite(request, new AbortController().signal, async () => {
        attempts += 1;
        throw new RiteWorkerUnavailable("Unable to prepare the battle. Please retry.");
    }), (error: unknown) => error instanceof RiteWorkerUnavailable);
    assert.equal(attempts, RITE_WORKER_ATTEMPTS, "the retry is bounded");
});

test("resolveRite never repeats a verdict, a deadline or a closed match", async () => {
    for (const failure of [
        new Error("Unable to resolve this formation. Please retry."),
        new Error("Battle preparation timed out. Please retry."),
    ]) {
        let attempts = 0;
        await assert.rejects(resolveRite(request, new AbortController().signal, async () => { attempts += 1; throw failure; }), failure);
        assert.equal(attempts, 1, failure.message);
    }
    const closed = new AbortController();
    let attempts = 0;
    await assert.rejects(resolveRite(request, closed.signal, async () => {
        attempts += 1;
        closed.abort();
        throw new RiteWorkerUnavailable("Unable to prepare the battle. Please retry.");
    }));
    assert.equal(attempts, 1, "a match that closed mid-attempt is not retried");
});
