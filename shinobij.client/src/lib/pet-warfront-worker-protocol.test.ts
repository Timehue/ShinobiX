import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeWarfrontWorkerBatch, encodeWarfrontWorkerBatch, type WarfrontWorkerBatch } from "./pet-warfront-worker-protocol.ts";

test("Warfront worker batches round-trip through a transferable byte buffer", () => {
    const batch = {
        snapshots: [],
        events: [{ t: 0, type: "stance", team: "blue", stance: "balanced", answer: false }],
        ticks: 60,
        round: 0,
        done: false,
        winner: null,
        coins: { blue: 12, red: 11 },
        stances: { blue: "balanced", red: "siege" },
        buyState: [],
    } satisfies WarfrontWorkerBatch;
    const encoded = encodeWarfrontWorkerBatch(batch);
    assert.ok(encoded.byteLength > 0);
    assert.deepEqual(decodeWarfrontWorkerBatch(encoded), batch);
});
