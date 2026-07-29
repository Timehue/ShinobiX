import type { PetVisualQuality } from "./pet-visual-quality";

export type WarfrontPresentationBudget = Readonly<{
    hollowHoundRigs: number;
    laneHoundRigs: number;
    squadCameras: boolean;
    squadCameraRenderEvery: number;
    houndRigDistance: number;
}>;

export type WarfrontAdaptivePressure = 0 | 1 | 2;

const WARFRONT_BUDGETS: Readonly<Record<PetVisualQuality, WarfrontPresentationBudget>> = Object.freeze({
    low: Object.freeze({
        hollowHoundRigs: 0,
        laneHoundRigs: 0,
        squadCameras: false,
        squadCameraRenderEvery: 4,
        houndRigDistance: 0,
    }),
    medium: Object.freeze({
        hollowHoundRigs: 3,
        laneHoundRigs: 4,
        squadCameras: false,
        squadCameraRenderEvery: 3,
        houndRigDistance: 25,
    }),
    high: Object.freeze({
        hollowHoundRigs: 6,
        laneHoundRigs: 8,
        squadCameras: true,
        squadCameraRenderEvery: 2,
        houndRigDistance: 34,
    }),
});

export function warfrontPresentationBudget(quality: PetVisualQuality): WarfrontPresentationBudget {
    return WARFRONT_BUDGETS[quality];
}

/** Shed secondary spectacle before touching combat readability. Pressure 1 is
 * the normal thermal/fps fallback; pressure 2 is the emergency mobile path. */
export function adaptWarfrontPresentationBudget(
    budget: WarfrontPresentationBudget,
    pressure: WarfrontAdaptivePressure,
): WarfrontPresentationBudget {
    if (pressure === 0) return budget;
    if (pressure === 2) return WARFRONT_BUDGETS.low;
    return Object.freeze({
        hollowHoundRigs: Math.min(2, budget.hollowHoundRigs),
        laneHoundRigs: Math.min(3, budget.laneHoundRigs),
        squadCameras: false,
        squadCameraRenderEvery: Math.max(3, budget.squadCameraRenderEvery),
        houndRigDistance: Math.min(22, budget.houndRigDistance),
    });
}

export function shouldRenderWarfrontHoundRig(
    index: number,
    distanceToCamera: number,
    rigBudget: number,
    maxDistance: number,
): boolean {
    return index >= 0
        && index < rigBudget
        && distanceToCamera <= maxDistance;
}
