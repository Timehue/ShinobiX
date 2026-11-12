import { useSyncExternalStore } from "react";
import { revisions, portraitModels, subscribe, snapshot } from "virtual:sector-model-pins";

export function useSectorModelPins() {
    useSyncExternalStore(subscribe, snapshot, snapshot);
    return {revisions, portraitModels};
}
