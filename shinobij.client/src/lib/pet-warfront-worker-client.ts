import type { ArenaSlot } from "./pet-arena-sim";
import {
    startWarfrontMatch,
    type WarfrontChoice,
    type WarfrontMatchCtl,
    type WfBuyPolicy,
    type WfDoctrine,
    type WfStance,
} from "./pet-warfront-sim";
import type { WfTheme } from "./pet-warfront-map";
import {
    decodeWarfrontWorkerBatch,
    type WarfrontBuyState,
    type WarfrontWorkerCommand,
} from "./pet-warfront-worker-protocol";

export type WarfrontWorkerController = WarfrontMatchCtl & Readonly<{
    start(): void;
    dispose(): void;
    usingWorker: boolean;
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
    // A tick-zero controller is cheap and gives React a complete first frame
    // synchronously. All expensive round simulation moves to the worker.
    const local = startWarfrontMatch(args.blue, args.red, args.seed, {
        bluePolicy: args.bluePolicy,
        redPolicy: "balanced",
        theme: args.theme,
        blueStance: args.blueStance,
        redStance: args.redStance,
        blueDoctrine: args.blueDoctrine,
        redDoctrine: args.redDoctrine,
        snapshotEvery: 2,
    });
    const initial = local.result;
    const result = {
        ...initial,
        snapshots: [...initial.snapshots],
        events: [...initial.events],
        coins: { ...initial.coins },
    };
    let worker: Worker | null = null;
    let useWorker = typeof Worker !== "undefined";
    let round = 0;
    let pendingRound: number | null = 0; // worker automatically computes round zero
    let buyState: WarfrontBuyState = local.buyState("blue");
    let coins = { blue: local.coins("blue"), red: local.coins("red") };
    let stances = local.stances();

    const syncFromLocal = () => {
        const source = local.result;
        result.snapshots.splice(0, result.snapshots.length, ...source.snapshots);
        result.events.splice(0, result.events.length, ...source.events);
        result.ticks = source.ticks;
        result.winner = source.winner;
        result.coins = { ...source.coins };
        result.petStats = source.petStats;
        round = local.round;
        buyState = local.buyState("blue");
        coins = { blue: local.coins("blue"), red: local.coins("red") };
        stances = local.stances();
    };

    const fallbackToMainThread = (reason: unknown) => {
        if (!useWorker) return;
        console.warn("[warfront] worker unavailable; using chunked main-thread fallback", reason);
        useWorker = false;
        worker?.terminate();
        worker = null;
        syncFromLocal();
        pendingRound = null;
    };

    const requestAdvance = (choices?: WarfrontChoice[], stance?: WfStance) => {
        if (!useWorker) return local.advanceRoundPartial(8, choices, stance);
        if (!worker || result.winner !== null || pendingRound === round) return false;
        pendingRound = round;
        const message: WarfrontWorkerCommand = { type: "advance", choices, stance };
        worker.postMessage(message);
        return false;
    };

    const controller: WarfrontWorkerController = {
        get result() { return result; },
        get done() { return result.winner !== null; },
        get round() { return useWorker ? round : local.round; },
        get usingWorker() { return useWorker; },
        buyState: (team) => team === "blue" && useWorker ? buyState.map((row) => ({
            ...row,
            stacks: { ...row.stacks },
            costs: { ...row.costs },
        })) : local.buyState(team),
        coins: (team) => useWorker ? coins[team] : local.coins(team),
        stances: () => useWorker ? { ...stances } : local.stances(),
        advanceRound(choices?: WarfrontChoice[], stance?: WfStance) {
            if (!useWorker) { local.advanceRound(choices, stance); syncFromLocal(); return; }
            requestAdvance(choices, stance);
        },
        advanceRoundPartial(maxTicks: number, choices?: WarfrontChoice[], stance?: WfStance) {
            if (!useWorker) {
                const done = local.advanceRoundPartial(maxTicks, choices, stance);
                syncFromLocal();
                return done;
            }
            return requestAdvance(choices, stance);
        },
        start() {
            if (!useWorker || worker) return;
            try {
                worker = new Worker(new URL("../workers/pet-warfront.worker.ts", import.meta.url), { type: "module", name: "hollow-warfront-sim" });
                worker.onmessage = (event: MessageEvent<{ type: "batch"; buffer: ArrayBuffer } | { type: "error"; message: string }>) => {
                    if (event.data.type === "error") { fallbackToMainThread(event.data.message); return; }
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
                    if (pendingRound !== null && round > pendingRound) pendingRound = null;
                };
                worker.onerror = (event) => fallbackToMainThread(event.message);
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
                fallbackToMainThread(error);
            }
        },
        dispose() {
            worker?.terminate();
            worker = null;
            if (useWorker) {
                syncFromLocal();
                pendingRound = 0;
            }
        },
    };
    return controller;
}
