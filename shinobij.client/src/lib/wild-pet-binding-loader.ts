import { useEffect } from "react";
import type { Pet } from "../types/pet";
import { cacheDynamicImport, lazyWithRetry } from "./lazyWithRetry";

const loadWildPetBinding = cacheDynamicImport(() => import("../components/WildPetBinding").then(m => ({ default: m.WildPetBinding })));
export const WildPetBinding = lazyWithRetry(loadWildPetBinding);

export function useWarmWildPetBinding(activePetEncounter: Pet | null) {
    // Warm only an actual encounter, while its introduction is still visible.
    // Battle/model preparation inside WildPetBinding remains unchanged.
    useEffect(() => {
        if (activePetEncounter) void loadWildPetBinding().catch(() => undefined);
    }, [activePetEncounter]);
}
