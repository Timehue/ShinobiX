import type { PetCombatModelConfig, PetCombatModelProfile } from "./pet-3d-models";

export type PetDuelModelCalibration = Readonly<{
    modelScale: number;
    groundOffset: number;
    shadowWidth: number;
    shadowDepth: number;
    shadowOpacity: number;
    labelOffset: number;
}>;

const PROFILE_CALIBRATION: Readonly<Record<PetCombatModelProfile, PetDuelModelCalibration>> = Object.freeze({
    quadruped: Object.freeze({ modelScale: 1, groundOffset: 0, shadowWidth: 1, shadowDepth: 0.5, shadowOpacity: 0.44, labelOffset: 0.5 }),
    biped: Object.freeze({ modelScale: 0.98, groundOffset: 0, shadowWidth: 0.86, shadowDepth: 0.44, shadowOpacity: 0.42, labelOffset: 0.5 }),
    avian: Object.freeze({ modelScale: 1.03, groundOffset: 0.015, shadowWidth: 0.82, shadowDepth: 0.4, shadowOpacity: 0.34, labelOffset: 0.62 }),
    serpentine: Object.freeze({ modelScale: 0.96, groundOffset: -0.01, shadowWidth: 1.14, shadowDepth: 0.4, shadowOpacity: 0.46, labelOffset: 0.44 }),
    heavy: Object.freeze({ modelScale: 1.04, groundOffset: -0.012, shadowWidth: 1.1, shadowDepth: 0.56, shadowOpacity: 0.48, labelOffset: 0.46 }),
});

/**
 * Small reviewed exceptions for silhouettes whose longest axis or authored
 * stance differs from the rest of their profile. These tune only the live duel
 * wrapper; they never alter the shared GLB, material, skeleton, or atlas path.
 */
const MODEL_OVERRIDES: Readonly<Record<string, Partial<PetDuelModelCalibration>>> = Object.freeze({
    "starter-water-r": Object.freeze({ modelScale: 0.92, shadowWidth: 1.22, labelOffset: 0.4 }),
    "starter-water-l": Object.freeze({ modelScale: 0.94, shadowWidth: 1.2 }),
    "starter-fire-l": Object.freeze({ modelScale: 0.96, shadowWidth: 1.08 }),
    "starter-earth-l": Object.freeze({ modelScale: 1.01, shadowDepth: 0.6 }),
});

/** Active-Colosseum framing policy for an approved combat model. */
export function petDuelModelCalibration(
    config: Pick<PetCombatModelConfig, "visualId" | "identityVisualId" | "profile">,
): PetDuelModelCalibration {
    const base = PROFILE_CALIBRATION[config.profile];
    const override = MODEL_OVERRIDES[config.identityVisualId ?? config.visualId]
        ?? MODEL_OVERRIDES[config.visualId]
        ?? {};
    return Object.freeze({ ...base, ...override });
}
