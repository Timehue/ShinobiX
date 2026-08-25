import type { ArenaSlot } from "./pet-arena-sim";
import type {
    WarfrontChoice,
    WarfrontMatchCtl,
    WarfrontResult,
    WfBuyPolicy,
    WfDoctrine,
    WfStance,
} from "./pet-warfront-sim";
import type { WfTheme } from "./pet-warfront-map";
import {
    decodeWarfrontWorkerBatch,
    type WarfrontBuyState,
    type WarfrontWorkerCommand,
} from "./pet-warfront-worker-protocol";

type WarfrontWorkerStatus = "idle" | "loading" | "ready" | "error";

export type WarfrontWorkerController = WarfrontMatchCtl & Readonly<{
    start(): void;
    dispose(): void;
    subscribeStatus(listener: () => void): () => void;
    usingWorker: boolean;
    status: WarfrontWorkerStatus;
    error: string | null;
}>;

export function createWarfrontWorkerController(args: {
    blue: ArenaSlot[];
    red: ArenaSlot[];
    seed: number;
    bluePolicy: WfBuyPolicy;
    theme: WfTheme;
    blueStance: WfStance;
    redStance: WfStance;
    blueDoctrine: WfDoctrine;
    redDoctrine: WfDoctrine;
}): WarfrontWorkerController {
    // The Web Worker is the only browser runtime that owns the simulation
    // engine. Its first message supplies the authoritative tick-zero frame.
    const result: WarfrontResult = {
        winner: null,
        ticks: 0,
        snapshots: [],
        events: [],
        theme: args.theme,
        coins: { blue: 0, red: 0 },
    };
    let worker: Worker | null = null;
    let status: WarfrontWorkerStatus = "idle";
    let failure: string | null = null;
    const statusListeners = new Set<() => void>();
    let round = 0;
    let pendingRound: number | null = 0; // worker automatically computes round zero
    let completionReady = false;
    let buyState: WarfrontBuyState = [];
    let coins = { blue: 0, red: 0 };
    let stances = { blue: args.blueStance, red: args.redStance };

    const updateStatus = (next: WarfrontWorkerStatus, error: string | null = null) => {
        if (status === next && failure === error) return;
        status = next;
        failure = error;
        for (const listener of statusListeners) listener();
    };

    const failWorker = (reason: unknown) => {
        const message = reason instanceof Error ? reason.message : String(reason || "Unknown worker error");
        console.error("[warfront] authoritative simulation worker failed", reason);
        worker?.terminate();
        worker = null;
        pendingRound = null;
        updateStatus("error", message);
    };

    const requestAdvance = (choices?: WarfrontChoice[], stance?: WfStance) => {
        // advanceRoundPartial's contract is synchronous even though the worker
        // is not: acknowledge a completed requested round on the next UI pump
        // so War Council choices are cleared before another round can start.
        if (completionReady) {
            completionReady = false;
            return true;
        }
        if (!worker || status !== "ready" || result.winner !== null || pendingRound === round) return false;
        pendingRound = round;
        const message: WarfrontWorkerCommand = { type: "advance", choices, stance };
        worker.postMessage(message);
        return false;
    };

    const controller: WarfrontWorkerController = {
        get result() { return result; },
        get done() { return result.winner !== null; },
        get round() { return round; },
        get usingWorker() { return status === "ready"; },
        get status() { return status; },
        get error() { return failure; },
        subscribeStatus(listener) {
            statusListeners.add(listener);
            return () => statusListeners.delete(listener);
        },
        buyState: (team) => team === "blue" ? buyState.map((row) => ({
            ...row,
            stacks: { ...row.stacks },
            costs: { ...row.costs },
        })) : [],
        coins: (team) => coins[team],
        stances: () => ({ ...stances }),
        advanceRound(choices?: WarfrontChoice[], stance?: WfStance) {
            // The void API is an explicit new-round command, not a poll for a
            // prior partial call, so consume any outstanding acknowledgement.
            completionReady = false;
            requestAdvance(choices, stance);
        },
        advanceRoundPartial(maxTicks: number, choices?: WarfrontChoice[], stance?: WfStance) {
            void maxTicks;
            return requestAdvance(choices, stance);
        },
        start() {
            if (worker || status === "loading" || status === "ready") return;
            if (typeof Worker === "undefined") {
                failWorker("This browser does not support the Warfront simulation worker.");
                return;
            }
            try {
                updateStatus("loading");
                worker = new Worker(new URL("../workers/pet-warfront.worker.ts", import.meta.url), { type: "module", name: "hollow-warfront-sim" });
                worker.onmessage = (event: MessageEvent<{ type: "batch"; buffer: ArrayBuffer } | { type: "error"; message: string }>) => {
                    if (event.data.type === "error") {
                        failWorker(event.data.message);
                        return;
                    }
                    const batch = decodeWarfrontWorkerBatch(event.data.buffer);
                    result.snapshots.push(...batch.snapshots);
                    result.events.push(...batch.events);
                    result.ticks = batch.ticks;
                    result.winner = batch.winner;
                    result.coins = batch.coins;
                    result.petStats = batch.petStats;
                    round = batch.round;
                    coins = batch.coins;
                    stances = batch.stances;
                    buyState = batch.buyState;
                    if (pendingRound !== null && round > pendingRound) {
                        // Round zero starts automatically during init; only
                        // caller-requested rounds need a completion handshake.
                        if (pendingRound > 0) completionReady = true;
                        pendingRound = null;
                    }
                    if (status !== "ready") updateStatus("ready");
                };
                worker.onerror = (event) => failWorker(event.message);
                worker.onmessageerror = () => failWorker("The Warfront worker returned an unreadable battle state.");
                const message: WarfrontWorkerCommand = {
                    type: "init",
                    blue: args.blue,
                    red: args.red,
                    seed: args.seed,
                    options: {
                        bluePolicy: args.bluePolicy,
                        redPolicy: "balanced",
                        theme: args.theme,
                        blueStance: args.blueStance,
                        redStance: args.redStance,
                        blueDoctrine: args.blueDoctrine,
                        redDoctrine: args.redDoctrine,
                    },
                };
                worker.postMessage(message);
            } catch (error) {
                failWorker(error);
            }
        },
        dispose() {
            worker?.terminate();
            worker = null;
            pendingRound = null;
            completionReady = false;
            statusListeners.clear();
        },
    };
    return controller;
}
