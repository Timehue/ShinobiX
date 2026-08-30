import type { ArenaSlot } from "./pet-arena-sim";
import type {
    WarfrontChoice,
    WarfrontCommandEntry,
    WarfrontMatchCtl,
    WarfrontResult,
    WfBuyPolicy,
    WfCommandState,
    WfDoctrine,
    WfSnapshot,
    WfStance,
} from "./pet-warfront-sim";
import type { WfLaneId, WfTheme } from "./pet-warfront-map";

export type WarfrontBuyState = ReturnType<WarfrontMatchCtl["buyState"]>;

export type WarfrontWorkerInit = Readonly<{
    type: "init";
    blue: ArenaSlot[];
    red: ArenaSlot[];
    seed: number;
    options: {
        bluePolicy: WfBuyPolicy;
        redPolicy: WfBuyPolicy;
        theme: WfTheme;
        blueStance: WfStance;
        redStance: WfStance;
        blueDoctrine: WfDoctrine;
        redDoctrine: WfDoctrine;
        initialLanes?: Partial<Record<"blue" | "red", readonly WfLaneId[]>>;
    };
}>;

export type WarfrontWorkerAdvance = Readonly<{
    type: "advance";
    choices?: WarfrontChoice[];
    stance?: WfStance;
}>;

export type WarfrontWorkerCommand = WarfrontWorkerInit | WarfrontWorkerAdvance;

export type WarfrontWorkerBatch = Readonly<{
    snapshots: WfSnapshot[];
    events: WarfrontResult["events"];
    ticks: number;
    round: number;
    done: boolean;
    winner: WarfrontResult["winner"];
    coins: { blue: number; red: number };
    favor: { blue: number; red: number };
    lanes: Record<"blue" | "red", WfLaneId[]>;
    commandState: WfCommandState | null;
    commandLog: WarfrontCommandEntry[];
    omen: WarfrontResult["omen"];
    mutator: WarfrontResult["mutator"];
    hazard: WarfrontResult["hazard"];
    commandImpacts: WarfrontResult["commandImpacts"];
    stances: Record<"blue" | "red", WfStance>;
    buyState: WarfrontBuyState;
    petStats?: WarfrontResult["petStats"];
}>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Worker output travels as one transferable byte buffer. That prevents the
 * browser from recursively structured-cloning thousands of nested snapshot
 * objects on the render thread. The retained visual stream is only 15 Hz. */
export function encodeWarfrontWorkerBatch(batch: WarfrontWorkerBatch): ArrayBuffer {
    return encoder.encode(JSON.stringify(batch)).buffer;
}

export function decodeWarfrontWorkerBatch(buffer: ArrayBuffer): WarfrontWorkerBatch {
    return JSON.parse(decoder.decode(new Uint8Array(buffer))) as WarfrontWorkerBatch;
}
