import type { PetVisualQuality } from "./pet-visual-quality";

export type WarfrontPresentationBudget = Readonly<{
    hollowHoundRigs: number;
    laneHoundRigs: number;
    squadCameras: boolean;
    squadCameraRenderEvery: number;
    houndRigDistance: number;
}>;

export type WarfrontAdaptivePressure = 0 | 1 | 2;

export type WarfrontMvpCandidate = Readonly<{
    id: string;
    dmg: number;
    kills: number;
    assists?: number;
    coins: number;
}>;

/** MVP values decisive contributions instead of simply awarding the damage
 * crown. Kills, assists, and economy can now surface a tank/support who enabled
 * the winning push while damage remains the strongest single component. */
export function warfrontMvpId(rows: readonly WarfrontMvpCandidate[]): string | null {
    let best: WarfrontMvpCandidate | null = null;
    let bestScore = -Infinity;
    for (const row of rows) {
        const score = row.dmg + row.kills * 450 + (row.assists ?? 0) * 180 + row.coins * 0.35;
        if (score > bestScore) {
            best = row;
            bestScore = score;
        }
    }
    return best?.id ?? null;
}

const WARFRONT_BUDGETS: Readonly<Record<PetVisualQuality, WarfrontPresentationBudget>> = Object.freeze({
    low: Object.freeze({
        hollowHoundRigs: 0,
        laneHoundRigs: 0,
        squadCameras: false,
        squadCameraRenderEvery: 4,
        houndRigDistance: 0,
    }),
    medium: Object.freeze({
        hollowHoundRigs: 2,
        laneHoundRigs: 3,
        squadCameras: false,
        squadCameraRenderEvery: 3,
        houndRigDistance: 22,
    }),
    high: Object.freeze({
        hollowHoundRigs: 4,
        laneHoundRigs: 6,
        squadCameras: true,
        squadCameraRenderEvery: 2,
        houndRigDistance: 28,
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

/**
 * Keep a pooled render slot attached to the same simulation id until that id
 * disappears. Indexing directly into a filtered mob array makes every later
 * slot jump to a different creature whenever an earlier mob dies.
 */
export function reconcileWarfrontMobSlots(
    current: readonly (number | null)[],
    availableIds: readonly number[],
    capacity = current.length,
): Array<number | null> {
    const live = new Set(availableIds);
    const next = Array.from({ length: capacity }, (_, index) => {
        const id = current[index];
        return id !== null && id !== undefined && live.has(id) ? id : null;
    });
    const claimed = new Set(next.filter((id): id is number => id !== null));
    let open = 0;
    for (const id of availableIds) {
        if (claimed.has(id)) continue;
        while (open < next.length && next[open] !== null) open++;
        if (open >= next.length) break;
        next[open] = id;
        claimed.add(id);
    }
    return next;
}
