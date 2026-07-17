export type PetVisualQuality = "low" | "medium" | "high";

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
        id: "medium", dpr: [1, 1.35] as [number, number], modelShadows: true, outline: true,
        textureAnisotropy: 6, ambientParticles: 28, identityParticles: 7,
        setPieceParticles: 34, dynamicPetLight: true, translucentLayers: 2,
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
    try { stored = window.localStorage.getItem("petVisualQuality"); } catch { /* storage may be unavailable */ }
    if (query || stored) return resolvePetVisualQuality(query || stored);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8);
    if (reduced || window.innerWidth <= 640 || memory <= 4) return PET_VISUAL_QUALITY_PRESETS.low;
    return PET_VISUAL_QUALITY_PRESETS.medium;
}
