import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import type { ArenaSlot } from "./pet-arena-sim";
import { createWarfrontWorkerController } from "./pet-warfront-worker-client.ts";
import { encodeWarfrontWorkerBatch, type WarfrontWorkerBatch, type WarfrontWorkerCommand } from "./pet-warfront-worker-protocol.ts";

class FakeWorker {
    static instance: FakeWorker;
    onmessage: ((event: MessageEvent<{ type: "batch"; buffer: ArrayBuffer }>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    commands: WarfrontWorkerCommand[] = [];
    constructor() { FakeWorker.instance = this; }
    postMessage(command: WarfrontWorkerCommand) { this.commands.push(command); }
    terminate() { /* test worker owns no resources */ }
    send(round: number) {
        const batch = {
            snapshots: [], events: [], ticks: round * 2_700, round, done: false, winner: null,
            coins: { blue: 0, red: 0 }, stances: { blue: "balanced", red: "balanced" }, buyState: [],
        } satisfies WarfrontWorkerBatch;
        this.onmessage?.({ data: { type: "batch", buffer: encodeWarfrontWorkerBatch(batch) } } as MessageEvent<{ type: "batch"; buffer: ArrayBuffer }>);
    }
}

const slot = (id: string): ArenaSlot => ({
    role: "tracker",
    pet: { id, name: id, element: "Wind", level: 80, hp: 800, attack: 100, defense: 70, speed: 90 } as Pet,
});

test("Warfront worker acknowledges a requested round exactly once before accepting the next", () => {
    const originalWorker = globalThis.Worker;
    Object.assign(globalThis, { Worker: FakeWorker });
    try {
        const controller = createWarfrontWorkerController({
            blue: [slot("blue")], red: [slot("red")], seed: 7, bluePolicy: "off", theme: "central",
            blueStance: "balanced", redStance: "balanced", blueDoctrine: "none", redDoctrine: "none",
        });
        controller.start();
        const worker = FakeWorker.instance;
        assert.equal(worker.commands[0]?.type, "init");

        worker.send(0);
        worker.send(1); // automatically computed opening round
        assert.equal(controller.advanceRoundPartial(8, [], "siege"), false);
        assert.equal(worker.commands.length, 2);

        worker.send(2); // requested round completed asynchronously
        assert.equal(controller.advanceRoundPartial(8, [], "siege"), true, "UI pump receives one completion acknowledgement");
        assert.equal(worker.commands.length, 2, "acknowledgement must not enqueue the following round");
        assert.equal(controller.advanceRoundPartial(8, [], "siege"), false);
        assert.equal(worker.commands.length, 3, "the next pump may now enqueue a new round");
        controller.dispose();
    } finally {
        Object.assign(globalThis, { Worker: originalWorker });
    }
});
