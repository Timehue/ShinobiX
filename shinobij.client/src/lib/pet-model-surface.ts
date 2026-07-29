export type PetModelSurfaceTreatment = Readonly<{
    lowTint: string;
    highTint: string;
    tintStrength: number;
    tintBlend: number;
    emissive: string;
    emissiveIntensity: number;
}>;

/**
 * Hollow Gate creatures keep their authored atlas detail, but the void has to
 * read as their identity rather than as a faint elemental wash. This treatment
 * is deliberately opt-in so ordinary roster pets retain their certified color.
 */
export const HOLLOW_HOUND_SURFACE: PetModelSurfaceTreatment = Object.freeze({
    lowTint: "#210449",
    highTint: "#f0abfc",
    tintStrength: 0.94,
    tintBlend: 0.88,
    emissive: "#c084fc",
    emissiveIntensity: 0.78,
});

/** Lane hounds share the same certified rig, but need unmistakable team
 * language. Their glow is intentionally quieter than the Hollow treatment so
 * purple remains exclusive to the neutral breach creatures. */
export const WARFRONT_MINION_SURFACES: Readonly<Record<"blue" | "red", PetModelSurfaceTreatment>> = Object.freeze({
    blue: Object.freeze({
        lowTint: "#082f49",
        highTint: "#bae6fd",
        tintStrength: 0.9,
        tintBlend: 0.82,
        emissive: "#38bdf8",
        emissiveIntensity: 0.52,
    }),
    red: Object.freeze({
        lowTint: "#4c0519",
        highTint: "#fecdd3",
        tintStrength: 0.9,
        tintBlend: 0.82,
        emissive: "#fb7185",
        emissiveIntensity: 0.52,
    }),
});
