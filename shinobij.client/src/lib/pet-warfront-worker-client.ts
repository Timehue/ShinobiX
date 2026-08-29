import type { ArenaSlot } from "./pet-arena-sim";
import {
    WARFRONT_TPS,
    wfOmenForSeed,
    type WarfrontChoice,
    type WarfrontCommandEntry,
    type WarfrontMatchCtl,
    type WarfrontResult,
    type WfBuyPolicy,
    type WfCommandState,
    type WfDoctrine,
    type WfSnapshot,
    type WfStance,
} from "./pet-warfront-sim";
import type { WfLaneId, WfTheme } from "./pet-warfront-map";
import { decodeWarfrontWorkerBatch, type WarfrontBuyState, type WarfrontWorkerCommand } from "./pet-warfront-worker-protocol";

type WarfrontWorkerStatus = "idle" | "loading" | "ready" | "error";

export type WarfrontWorkerController = WarfrontMatchCtl & Readonly<{
    start(): void;
    dispose(): void;
    pruneSnapshotsBefore(tick: number, retainTicks?: number): number;
    subscribeStatus(listener: () => void): () => void;
    usingWorker: boolean;
    status: WarfrontWorkerStatus;
    error: string | null;
}>;

/** Retain one interpolation anchor at or before the cutoff plus every newer
 * frame. The worker can simulate a full two-minute segment ahead of playback;
 * pruning consumed frames keeps memory bounded without affecting rendering. */
export function pruneWarfrontSnapshots(
    snapshots: WfSnapshot[],
    tick: number,
    retainTicks = WARFRONT_TPS * 2,
): number {
    if (snapshots.length < 3) return 0;
    const cutoff = Math.max(0, Math.floor(tick) - Math.max(0, Math.floor(retainTicks)));
    if (snapshots[0].t >= cutoff) return 0;
    let lo = 0;
    let hi = snapshots.length - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (snapshots[mid].t <= cutoff) lo = mid;
        else hi = mid - 1;
    }
    if (lo <= 0) return 0;
    snapshots.splice(0, lo);
    return lo;
}

export function createWarfrontWorkerController(args: {
    blue: ArenaSlot[];
    red: ArenaSlot[];
    seed: number;
    bluePolicy: WfBuyPolicy;
    redPolicy: WfBuyPolicy;
    theme: WfTheme;
    blueStance: WfStance;
    redStance: WfStance;
    blueDoctrine: WfDoctrine;
    redDoctrine: WfDoctrine;
    initialLanes?: Partial<Record<"blue" | "red", readonly WfLaneId[]>>;
}): WarfrontWorkerController {
    const result: WarfrontResult = {
        winner: null,
        ticks: 0,
        snapshots: [],
        events: [],
        theme: args.theme,
        coins: { blue: 0, red: 0 },
        initialLanes: {
            blue: [...(args.initialLanes?.blue ?? ["n", "m", "s", "m"])],
            red: [...(args.initialLanes?.red ?? ["n", "m", "s", "m"])],
        },
        commandLog: [],
        omen: wfOmenForSeed(args.seed),
        commandImpacts: [],
    };
    let worker: Worker | null = null;
    let status: WarfrontWorkerStatus = "idle";
    let failure: string | null = null;
    let round = 0;
    let busy = false;
    let completedRoundAck = false;
    let awaitingAdvanceAck = false;
    let favor = { blue: 0, red: 0 };
    let lanes: Record<"blue" | "red", WfLaneId[]> = {
        blue: [...(args.initialLanes?.blue ?? ["n", "m", "s", "m"])],
        red: [...(args.initialLanes?.red ?? ["n", "m", "s", "m"])],
    };
    let commandState: WfCommandState | null = null;
    let commandLog: WarfrontCommandEntry[] = [];
    let stances = { blue: args.blueStance, red: args.redStance };
    let buyState: WarfrontBuyState = [];
    const listeners = new Set<() => void>();
    const publish = () => { for (const listener of listeners) listener(); };
    const updateStatus = (next: WarfrontWorkerStatus, error: string | null = null) => {
        status = next;
        failure = error;
        publish();
    };
    const fail = (reason: unknown) => {
        worker?.terminate();
        worker = null;
        busy = false;
        updateStatus("error", reason instanceof Error ? reason.message : String(reason || "Unknown Warfront worker error"));
    };
    const postAdvance = (choices?: WarfrontChoice[]) => {
        if (!worker || status !== "ready" || busy || result.winner !== null || !commandState) return;
        busy = true;
        awaitingAdvanceAck = true;
        const message: WarfrontWorkerCommand = { type: "advance", choices };
        worker.postMessage(message);
        publish();
    };
    return {
        get result() { return result; },
        get done() { return result.winner !== null; },
        get round() { return round; },
        get usingWorker() { return status === "ready"; },
        get status() { return status; },
        get error() { return failure; },
        coins: () => 0,
        favor: (team) => favor[team],
        stances: () => ({ ...stances }),
        commandState: () => commandState ? {
            ...commandState,
            activeLanes: [...commandState.activeLanes],
            freedPetSlots: { blue: [...commandState.freedPetSlots.blue], red: [...commandState.freedPetSlots.red] },
        } : null,
        lanes: () => ({ blue: [...lanes.blue], red: [...lanes.red] }),
        commandLog: () => commandLog.map((entry) => ({ ...entry, moves: entry.moves.map((move) => ({ ...move })) })),
        buyState: (team) => team === "blue" ? buyState.map((row) => ({ ...row, stacks: { ...row.stacks }, costs: { ...row.costs } })) : [],
        pruneSnapshotsBefore(tick, retainTicks) {
            return pruneWarfrontSnapshots(result.snapshots, tick, retainTicks);
        },
        advanceRound(choices?: WarfrontChoice[]) {
            completedRoundAck = false;
            postAdvance(choices);
        },
        advanceRoundPartial(_maxTicks: number, choices?: WarfrontChoice[]) {
            if (completedRoundAck) {
                completedRoundAck = false;
                return true;
            }
            postAdvance(choices);
            return false;
        },
        subscribeStatus(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        start() {
            if (worker || status === "loading" || status === "ready") return;
            if (typeof Worker === "undefined") { fail("This browser does not support the Warfront simulation worker."); return; }
            try {
                updateStatus("loading");
                worker = new Worker(new URL("../workers/pet-warfront.worker.ts", import.meta.url), { type: "module", name: "hollow-warfront-three-lane" });
                worker.onmessage = (event: MessageEvent<{ type: "batch"; buffer: ArrayBuffer } | { type: "error"; message: string }>) => {
                    if (event.data.type === "error") { fail(event.data.message); return; }
                    const batch = decodeWarfrontWorkerBatch(event.data.buffer);
                    const requestedRoundCompleted = awaitingAdvanceAck && batch.commandState !== null;
                    result.snapshots.push(...batch.snapshots);
                    result.events.push(...batch.events);
                    result.ticks = batch.ticks;
                    result.winner = batch.winner;
                    result.coins = batch.coins;
                    result.petStats = batch.petStats;
                    result.commandLog = batch.commandLog;
                    result.omen = batch.omen;
                    result.commandImpacts = batch.commandImpacts;
                    favor = batch.favor;
                    lanes = batch.lanes;
                    commandState = batch.commandState;
                    commandLog = batch.commandLog;
                    stances = batch.stances;
                    buyState = batch.buyState;
                    round = batch.round;
                    busy = !batch.done && batch.commandState === null;
                    if (requestedRoundCompleted) {
                        awaitingAdvanceAck = false;
                        completedRoundAck = true;
                    }
                    if (status !== "ready") status = "ready";
                    publish();
                };
                worker.onerror = (event) => fail(event.message);
                worker.onmessageerror = () => fail("The Warfront worker returned an unreadable battle state.");
                const message: WarfrontWorkerCommand = {
                    type: "init",
                    blue: args.blue,
                    red: args.red,
                    seed: args.seed,
                    options: {
                        bluePolicy: args.bluePolicy,
                        redPolicy: args.redPolicy,
                        theme: args.theme,
                        blueStance: args.blueStance,
                        redStance: args.redStance,
                        blueDoctrine: args.blueDoctrine,
                        redDoctrine: args.redDoctrine,
                        initialLanes: args.initialLanes,
                    },
                };
                busy = true;
                worker.postMessage(message);
            } catch (error) { fail(error); }
        },
        dispose() {
            worker?.terminate();
            worker = null;
            listeners.clear();
            busy = false;
        },
    };
}
