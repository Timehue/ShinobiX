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

export type WarfrontMotionFilterState = {
    initialized: boolean;
    x: number;
    z: number;
    vx: number;
    vz: number;
};

export function createWarfrontMotionFilter(): WarfrontMotionFilterState {
    return { initialized: false, x: 0, z: 0, vx: 0, vz: 0 };
}

/**
 * Low-pass the authoritative 30 Hz position stream without changing gameplay.
 * The position stage removes single-tick A-to-B-to-A corrections; the velocity
 * stage keeps model facing and locomotion clips from reacting to the remainder.
 * Both coefficients are frame-rate independent.
 */
export function advanceWarfrontMotionFilter(
    state: WarfrontMotionFilterState,
    targetX: number,
    targetZ: number,
    delta: number,
    snap = false,
): WarfrontMotionFilterState {
    const dt = Math.max(1 / 240, Math.min(0.05, Number.isFinite(delta) ? delta : 1 / 60));
    if (!state.initialized || snap || !Number.isFinite(state.x) || !Number.isFinite(state.z)) {
        state.initialized = true;
        state.x = targetX;
        state.z = targetZ;
        state.vx = 0;
        state.vz = 0;
        return state;
    }
    const previousX = state.x;
    const previousZ = state.z;
    const positionAlpha = 1 - Math.pow(0.82, Math.min(3, dt * 60));
    state.x += (targetX - state.x) * positionAlpha;
    state.z += (targetZ - state.z) * positionAlpha;
    const rawVx = (state.x - previousX) / dt;
    const rawVz = (state.z - previousZ) / dt;
    const velocityAlpha = 1 - Math.pow(0.88, Math.min(3, dt * 60));
    state.vx += (rawVx - state.vx) * velocityAlpha;
    state.vz += (rawVz - state.vz) * velocityAlpha;
    if (Math.abs(state.vx) < 0.015) state.vx = 0;
    if (Math.abs(state.vz) < 0.015) state.vz = 0;
    return state;
}

export function warfrontMotionFilterSpeed(state: WarfrontMotionFilterState): number {
    return Math.hypot(state.vx, state.vz);
}

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

export type WarfrontPerformanceTarget = "desktop60" | "mobile30";
export const WARFRONT_PERFORMANCE_LIMITS = Object.freeze({
    desktop60: Object.freeze({ p95FrameMs: 18.5, worstFrameMs: 100, drawCalls: 320 }),
    mobile30: Object.freeze({ p95FrameMs: 34.5, worstFrameMs: 120, drawCalls: 240 }),
});

export function warfrontPercentile(samples: readonly number[], percentile: number): number {
    if (!samples.length) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1));
    return sorted[index];
}

export function evaluateWarfrontPerformance(
    frameMs: readonly number[],
    drawCalls: number,
    target: WarfrontPerformanceTarget,
) {
    const limits = WARFRONT_PERFORMANCE_LIMITS[target];
    const p95FrameMs = warfrontPercentile(frameMs, 0.95);
    const worstFrameMs = frameMs.length ? Math.max(...frameMs) : 0;
    return {
        pass: frameMs.length > 0
            && p95FrameMs <= limits.p95FrameMs
            && worstFrameMs <= limits.worstFrameMs
            && drawCalls <= limits.drawCalls,
        p95FrameMs,
        worstFrameMs,
        drawCalls,
        limits,
    } as const;
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
