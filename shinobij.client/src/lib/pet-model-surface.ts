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
    lowTint: "#160628",
    highTint: "#d946ef",
    tintStrength: 0.82,
    tintBlend: 0.72,
    emissive: "#7c3aed",
    emissiveIntensity: 0.46,
});
