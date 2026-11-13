import { loadPins } from "virtual:sector-model-pins";
import { prefetchSectorPresentation } from "./sector-obstacles";

/**
 * Start the two small requests every fitted world figure waits on (the
 * presentation flags and the model registry) at boot, in parallel, instead of
 * one after the other once the world view mounts. Both are warm-ups: a failure
 * here is retried by the world view's own subscription.
 */
export function prefetchSectorModels(): void {
    void prefetchSectorPresentation().catch(() => {});
    void loadPins().catch(() => {});
}
