import {
    startWarfrontMatch,
    WARFRONT_TPS,
    type WarfrontChoice,
    type WarfrontMatchCtl,
    type WfStance,
} from "../lib/pet-warfront-sim";
import {
    encodeWarfrontWorkerBatch,
    type WarfrontWorkerBatch,
    type WarfrontWorkerCommand,
    type WarfrontWorkerInit,
} from "../lib/pet-warfront-worker-protocol";

let ctl: WarfrontMatchCtl | null = null;
let sentSnapshots = 0;
let sentEvents = 0;
let running = false;

function emitBatch() {
    if (!ctl) return;
    const result = ctl.result;
    const batch: WarfrontWorkerBatch = {
        snapshots: result.snapshots.slice(sentSnapshots),
        events: result.events.slice(sentEvents),
        ticks: result.ticks,
        round: ctl.round,
        done: ctl.done,
        winner: result.winner,
        coins: { blue: ctl.coins("blue"), red: ctl.coins("red") },
        favor: { blue: ctl.favor("blue"), red: ctl.favor("red") },
        lanes: ctl.lanes(),
        commandState: ctl.commandState(),
        commandLog: ctl.commandLog(),
        omen: result.omen,
        commandImpacts: result.commandImpacts,
        stances: ctl.stances(),
        buyState: ctl.buyState("blue"),
        petStats: result.petStats,
    };
    sentSnapshots = result.snapshots.length;
    sentEvents = result.events.length;
    const buffer = encodeWarfrontWorkerBatch(batch);
    self.postMessage({ type: "batch", buffer }, { transfer: [buffer] });
}

function runRound(choices?: WarfrontChoice[], stance?: WfStance) {
    if (!ctl || running || ctl.done) return;
    running = true;
    let firstChunk = true;
    const pump = () => {
        if (!ctl) { running = false; return; }
        try {
            // Two simulated seconds per task keeps worker messages compact while
            // still yielding regularly for shutdown/restart commands.
            const roundDone = ctl.advanceRoundPartial(
                WARFRONT_TPS * 2,
                firstChunk ? choices : undefined,
                firstChunk ? stance : undefined,
            );
            firstChunk = false;
            emitBatch();
            if (roundDone || ctl.done) { running = false; return; }
            setTimeout(pump, 0);
        } catch (error) {
            running = false;
            self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
    };
    pump();
}

function initialize(message: WarfrontWorkerInit) {
    ctl = startWarfrontMatch(message.blue, message.red, message.seed, {
        ...message.options,
        // Presentation interpolation makes 15 Hz visually continuous while
        // gameplay, AI, combat, and authority remain at 30 Hz.
        snapshotEvery: 2,
    });
    // The worker is the sole runtime owner of the simulation engine. Send its
    // authoritative tick-zero frame before streaming the opening round.
    sentSnapshots = 0;
    sentEvents = 0;
    running = false;
    emitBatch();
    runRound();
}

self.onmessage = (event: MessageEvent<WarfrontWorkerCommand>) => {
    // Dedicated-worker messages normally carry an empty origin. Reject any
    // non-empty origin that does not match the worker script's own origin so a
    // future shared/window bridge cannot silently widen this trust boundary.
    if (event.origin !== "" && event.origin !== self.location.origin) return;
    const message = event.data;
    if (message.type === "init") initialize(message);
    else runRound(message.choices, message.stance);
};
