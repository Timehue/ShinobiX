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
        try { worker = createWorker(); } catch (error) { reject(error); return; }
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
            else finish(undefined, new Error(response && "error" in response ? response.error : "Invalid battle replay."));
        };
        worker.onerror = (event) => {
            event.preventDefault();
            finish(undefined, new Error("Unable to prepare the battle. Please retry."));
        };
        worker.onmessageerror = () => finish(undefined, new Error("Unable to read the battle replay. Please retry."));
        const withoutArt = (pet: Pet): Pet => ({ ...pet, image: "", bodyImage: undefined });
        try {
            worker.postMessage({ ...request, blue: request.blue.map(withoutArt), red: request.red.map(withoutArt) });
        } catch (error) { finish(undefined, error); }
    });
}
