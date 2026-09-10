import assert from "node:assert/strict";
import test from "node:test";
import { resolveRiteInWorker, type RiteSimulationRequest } from "./pet-rite-worker-client";
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
