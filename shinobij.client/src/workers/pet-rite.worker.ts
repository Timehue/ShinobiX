import { runWarfrontRite } from "../lib/pet-warfront-rite";
import type { RiteSimulationRequest, RiteSimulationResponse } from "../lib/pet-rite-worker-client";

self.onmessage = (event: MessageEvent<RiteSimulationRequest>) => {
    const { blue, red, seed, bluePlan, redPlan } = event.data;
    let response: RiteSimulationResponse;
    try {
        response = { result: runWarfrontRite(blue, red, seed, bluePlan, redPlan) };
    } catch {
        response = { error: "Unable to resolve this formation. Please retry." };
    }
    self.postMessage(response);
};
