export type PetVisualQuality = "low" | "medium" | "high";
export const PET_VISUAL_QUALITY_STORAGE_KEY = "petVisualQuality";

export type PetVisualQualityConfig = {
    id: PetVisualQuality;
    dpr: [number, number];
    modelShadows: boolean;
    outline: boolean;
    textureAnisotropy: number;
    ambientParticles: number;
    identityParticles: number;
    setPieceParticles: number;
    dynamicPetLight: boolean;
    translucentLayers: number;
    distortion: boolean;
};

export const PET_VISUAL_QUALITY_PRESETS: Readonly<Record<PetVisualQuality, PetVisualQualityConfig>> = Object.freeze({
    low: Object.freeze({
        id: "low", dpr: [1, 1] as [number, number], modelShadows: false, outline: false,
        textureAnisotropy: 2, ambientParticles: 12, identityParticles: 3,
        setPieceParticles: 16, dynamicPetLight: false, translucentLayers: 1,
        distortion: false,
    }),
    medium: Object.freeze({
        // Medium is the shipped/default battle preset. Keep the anime outline and
        // inexpensive authored contact blobs, but reserve fill-rate for the action
        // itself: realtime shadow passes, transient point lights and a 1.35 DPR
        // ceiling pushed the default Coliseum toward 30 fps during overlap.
        id: "medium", dpr: [1, 1.16] as [number, number], modelShadows: false, outline: true,
        textureAnisotropy: 6, ambientParticles: 20, identityParticles: 5,
        setPieceParticles: 28, dynamicPetLight: false, translucentLayers: 2,
        distortion: false,
    }),
    high: Object.freeze({
        id: "high", dpr: [1, 1.75] as [number, number], modelShadows: true, outline: true,
        textureAnisotropy: 8, ambientParticles: 42, identityParticles: 12,
        setPieceParticles: 52, dynamicPetLight: true, translucentLayers: 3,
        distortion: true,
    }),
});

export function resolvePetVisualQuality(value?: string | null): PetVisualQualityConfig {
    const normalized = String(value ?? "").toLowerCase();
    if (normalized === "low" || normalized === "medium" || normalized === "high") return PET_VISUAL_QUALITY_PRESETS[normalized];
    return PET_VISUAL_QUALITY_PRESETS.medium;
}

/** Read once per battle/model mount. `?petQuality=` is the QA override and the
 * localStorage value is the player-facing setting hook. Automatic fallback is
 * conservative: reduced motion, a narrow mobile viewport, or <=4 GB memory uses
 * Low; everything else defaults to Medium until the player explicitly selects High. */
export function petVisualQuality(): PetVisualQualityConfig {
    if (typeof window === "undefined") return PET_VISUAL_QUALITY_PRESETS.medium;
    const query = new URLSearchParams(window.location.search).get("petQuality");
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(PET_VISUAL_QUALITY_STORAGE_KEY); } catch { /* storage may be unavailable */ }
    if (query) return resolvePetVisualQuality(query);
    // "High" is retired as a player-facing preset — the shadow pass + 1.75 DPR +
    // dynamic lights tanked the Warfront frame rate. A previously stored "high"
    // now runs Medium; the ?petQuality= QA override above can still reach it.
    if (stored) return resolvePetVisualQuality(stored.toLowerCase() === "high" ? "medium" : stored);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8);
    if (reduced || window.innerWidth <= 640 || memory <= 4) return PET_VISUAL_QUALITY_PRESETS.low;
    return PET_VISUAL_QUALITY_PRESETS.medium;
}

export function savePetVisualQuality(value: PetVisualQuality): void {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(PET_VISUAL_QUALITY_STORAGE_KEY, value); } catch { /* storage may be unavailable */ }
}
