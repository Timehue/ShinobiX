import type { Pet } from "../types/pet";
import type { RitePlan, RiteResult } from "./pet-warfront-rite";

export type RiteSimulationRequest = {
    blue: readonly Pet[];
    red: readonly Pet[];
    seed: number;
    bluePlan?: RitePlan | null;
    redPlan?: RitePlan | null;
};

export type RiteSimulationResponse = { result: RiteResult } | { error: string };

type SimulationWorker = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;

/** The worker itself failed — it could not be created or loaded, crashed, or
 * returned something unreadable. That says nothing about the battle, so a fresh
 * worker may succeed. A simulation that threw, a timeout, and an abort are
 * deliberately NOT this type: retrying those repeats the same outcome or makes
 * the player wait out another full deadline. */
export class RiteWorkerUnavailable extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RiteWorkerUnavailable";
    }
}

/** Two tries: one fresh worker after the first fails to run. */
export const RITE_WORKER_ATTEMPTS = 2;

/** One bounded job per decision. Termination releases the worker's simulation
 * snapshots on success, failure and leaving the match. No idle worker or stale
 * result can survive a route change. Art never crosses the worker boundary. */
export function resolveRiteInWorker(
    request: RiteSimulationRequest,
    signal: AbortSignal,
    createWorker: () => SimulationWorker = () => new Worker(new URL("../workers/pet-rite.worker.ts", import.meta.url), { type: "module" }),
): Promise<RiteResult> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new DOMException("Battle closed", "AbortError")); return; }
        let worker: SimulationWorker;
        try { worker = createWorker(); } catch { reject(new RiteWorkerUnavailable("Unable to prepare the battle. Please retry.")); return; }
        let finished = false;
        const finish = (result?: RiteResult, error?: unknown) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            signal.removeEventListener("abort", abort);
            worker.onmessage = worker.onerror = worker.onmessageerror = null;
            worker.terminate();
            if (result) resolve(result);
            else reject(error ?? new Error("Unable to prepare the battle."));
        };
        const abort = () => finish(undefined, new DOMException("Battle closed", "AbortError"));
        const timeout = setTimeout(() => finish(undefined, new Error("Battle preparation timed out. Please retry.")), 30_000);
        signal.addEventListener("abort", abort, { once: true });
        worker.onmessage = (event: MessageEvent<RiteSimulationResponse>) => {
            const response = event.data;
            if (response && "result" in response) finish(response.result);
            else if (response && "error" in response) finish(undefined, new Error(response.error));
            else finish(undefined, new RiteWorkerUnavailable("Invalid battle replay."));
        };
        worker.onerror = (event) => {
            event.preventDefault();
            finish(undefined, new RiteWorkerUnavailable("Unable to prepare the battle. Please retry."));
        };
        worker.onmessageerror = () => finish(undefined, new RiteWorkerUnavailable("Unable to read the battle replay. Please retry."));
        const withoutArt = (pet: Pet): Pet => ({ ...pet, image: "", bodyImage: undefined });
        try {
            worker.postMessage({ ...request, blue: request.blue.map(withoutArt), red: request.red.map(withoutArt) });
        } catch { finish(undefined, new RiteWorkerUnavailable("Unable to prepare the battle. Please retry.")); }
    });
}

/**
 * Resolve one Rite decision, retrying once when the worker itself failed.
 *
 * A dropped or crashed worker is the one preparation failure a second attempt
 * can fix, so it gets exactly one. Anything else — the simulation rejecting
 * the plan, the 30-second deadline, the match closing — is returned at once,
 * and the caller decides how the match continues (the re-form panel can always
 * hold the formation it just fought, which needs no simulation at all).
 */
export async function resolveRite(
    request: RiteSimulationRequest,
    signal: AbortSignal,
    resolveOnce: (request: RiteSimulationRequest, signal: AbortSignal) => Promise<RiteResult> = resolveRiteInWorker,
): Promise<RiteResult> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await resolveOnce(request, signal);
        } catch (error) {
            if (signal.aborted || !(error instanceof RiteWorkerUnavailable) || attempt >= RITE_WORKER_ATTEMPTS) throw error;
        }
    }
}
