import type { PetVisualQualityConfig } from "./pet-visual-quality";

export type WarfrontCapabilityTier = "standard" | "eight-rig" | "constrained";

export const WARFRONT_ROUTE_STORAGE_KEY = "kage:warfront-render-route:v2";
export const WARFRONT_PREFLIGHT_THRESHOLD_MS = 100;
export const WARFRONT_PREFLIGHT_WARMUP_MS = 250;
// The problematic hardware/browser path stalls on a roughly three-second
// cadence. Keep the probe behind the existing formation curtain long enough to
// cross that cadence once, without turning the intro into an open-ended test.
export const WARFRONT_PREFLIGHT_SAMPLE_MS = 3_250;

export type WarfrontPerformanceSample = Readonly<{
    durationMs: number;
    frameGapsOver100ms: number;
    frameGapMaxMs: number;
    longTasksOver100ms: number;
    longTaskMaxMs: number;
}>;

export type WarfrontRuntimeRoute = Readonly<{
    mode: "skinned-3d" | "model-impostor";
    status: "probing" | "validating" | "locked";
    reason: "pending-preflight" | "preflight-fast" | "preflight-slow"
        | "visible-fast" | "visible-slow" | "persisted-fast" | "persisted-slow"
        | "safe-default" | "software-renderer" | "missing-impostor-assets" | "rig-import-failed";
    persisted: boolean;
    sample: WarfrontPerformanceSample | null;
}>;

export type WarfrontPersistedRoute = Readonly<{
    version: 2;
    renderer: string;
    mode: "skinned-3d" | "model-impostor";
    proof: "fast-visible-canary" | "slow-observed" | "safe-default";
    sample: WarfrontPerformanceSample | null;
}>;

export function parseWarfrontPersistedRoute(raw: string | null, renderer: string): WarfrontPersistedRoute | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Partial<WarfrontPersistedRoute>;
        if (value.version !== 2 || value.renderer !== renderer) return null;
        if (value.mode !== "skinned-3d" && value.mode !== "model-impostor") return null;
        const sample = value.sample;
        if (sample && (!Number.isFinite(sample.durationMs) || !Number.isFinite(sample.frameGapMaxMs)
            || !Number.isFinite(sample.frameGapsOver100ms) || !Number.isFinite(sample.longTaskMaxMs)
            || !Number.isFinite(sample.longTasksOver100ms))) return null;
        if (value.mode === "skinned-3d" && (value.proof !== "fast-visible-canary" || !sample
            || sample.frameGapMaxMs > WARFRONT_PREFLIGHT_THRESHOLD_MS
            || sample.longTaskMaxMs > WARFRONT_PREFLIGHT_THRESHOLD_MS)) return null;
        if (value.mode === "model-impostor" && value.proof !== "slow-observed" && value.proof !== "safe-default") return null;
        return value as WarfrontPersistedRoute;
    } catch {
        return null;
    }
}

export function serializeWarfrontPersistedRoute(renderer: string, route: WarfrontRuntimeRoute): string | null {
    if (route.status !== "locked") return null;
    if (route.mode === "skinned-3d" && (!route.sample || route.reason !== "visible-fast")) return null;
    const proof: WarfrontPersistedRoute["proof"] = route.mode === "skinned-3d"
        ? "fast-visible-canary"
        : route.reason === "safe-default" ? "safe-default" : "slow-observed";
    return JSON.stringify({ version: 2, renderer, mode: route.mode, proof, sample: route.sample } satisfies WarfrontPersistedRoute);
}

export function initialWarfrontRuntimeRoute(options: {
    actorCount: number;
    renderer: string;
    impostorAssetsAvailable: boolean;
    persisted: WarfrontPersistedRoute | null;
    force3dCanary?: boolean;
}): WarfrontRuntimeRoute {
    if (options.actorCount < 8 || !options.impostorAssetsAvailable) {
        return { mode: "skinned-3d", status: "locked", reason: "missing-impostor-assets", persisted: false, sample: null };
    }
    if (options.force3dCanary) {
        return { mode: "skinned-3d", status: "probing", reason: "pending-preflight", persisted: false, sample: null };
    }
    if (isSoftwareWebGLRenderer(options.renderer)) {
        return { mode: "model-impostor", status: "locked", reason: "software-renderer", persisted: false, sample: null };
    }
    if (options.persisted?.mode === "model-impostor") {
        return { mode: "model-impostor", status: "locked", reason: "persisted-slow", persisted: true, sample: options.persisted.sample };
    }
    if (options.persisted?.mode === "skinned-3d") {
        return { mode: "skinned-3d", status: "locked", reason: "persisted-fast", persisted: true, sample: options.persisted.sample };
    }
    // An opaque-overlay microbenchmark cannot prove Chromium's visible canvas
    // compositor cost. Unknown hardware therefore starts safe; only a prior
    // full visible canary may opt this exact renderer/version into eight rigs.
    return { mode: "model-impostor", status: "locked", reason: "safe-default", persisted: false, sample: null };
}

/** Both explicit QA flags are required before a clean browser may request the
 * heavyweight rig chunk. One flag alone must remain on the shippable cold path. */
export function warfront3dQaCanaryRequested(search: string): boolean {
    const params = new URLSearchParams(search);
    return params.get("ritemotionqa") === "1" && params.get("riteforce3d") === "1";
}

/** A rejected async rig import atomically falls back behind the existing
 * readiness veil. Locked impostor routes remain one-way and never retry. */
export function resolveWarfrontRigImportFailure(
    current: WarfrontRuntimeRoute,
    impostorAssetsAvailable: boolean,
): WarfrontRuntimeRoute {
    if (current.mode !== "skinned-3d" || !impostorAssetsAvailable) return current;
    return {
        mode: "model-impostor",
        status: "locked",
        reason: "rig-import-failed",
        persisted: false,
        sample: current.sample,
    };
}

/** One-way runtime verdict. Locked routes ignore later samples, so a context
 * restoration, clash remount, or noisy follow-up frame can never oscillate the
 * actor renderer during a battle. */
export function resolveWarfrontRuntimeRoute(
    current: WarfrontRuntimeRoute,
    sample: WarfrontPerformanceSample,
): WarfrontRuntimeRoute {
    if (current.status === "locked") return current;
    const slow = sample.frameGapMaxMs > WARFRONT_PREFLIGHT_THRESHOLD_MS
        || sample.longTaskMaxMs > WARFRONT_PREFLIGHT_THRESHOLD_MS;
    return slow
        ? { mode: "model-impostor", status: "locked", reason: "preflight-slow", persisted: false, sample }
        : { mode: "skinned-3d", status: "validating", reason: "preflight-fast", persisted: false, sample };
}

/** The occlusion-safe proof: a provisional skinned route gets one bounded
 * visible action sample. A failure may downgrade once; every locked route then
 * ignores all future evidence for the lifetime of the clash. */
export function resolveWarfrontVisibleRoute(
    current: WarfrontRuntimeRoute,
    sample: WarfrontPerformanceSample,
): WarfrontRuntimeRoute {
    if (current.status !== "validating") return current;
    const slow = sample.frameGapMaxMs > WARFRONT_PREFLIGHT_THRESHOLD_MS
        || sample.longTaskMaxMs > WARFRONT_PREFLIGHT_THRESHOLD_MS;
    return slow
        ? { mode: "model-impostor", status: "locked", reason: "visible-slow", persisted: false, sample }
        : { mode: "skinned-3d", status: "locked", reason: "visible-fast", persisted: false, sample };
}

export type WarfrontCapabilityProbe = {
    actorCount: number;
    renderer: string;
    viewportWidth: number;
    viewportHeight: number;
    coarsePointer: boolean;
};

export function isSoftwareWebGLRenderer(rendererName: string): boolean {
    return /swiftshader|llvmpipe|software raster|microsoft basic render|lavapipe/.test(rendererName.toLowerCase());
}

/**
 * Pick presentation cost from actual renderer/device evidence. This does not
 * change the authored rigs, clips, texture atlas, combat clock, or simulation.
 * The eight-rig tier batches scene decoration and event geometry on every
 * device; software and phone-class renderers additionally omit ambient-only
 * decoration so the action silhouettes keep the frame budget.
 */
export function warfrontCapabilityTier(probe: WarfrontCapabilityProbe): WarfrontCapabilityTier {
    if (probe.actorCount < 8) return "standard";
    const software = isSoftwareWebGLRenderer(probe.renderer);
    const phoneClass = probe.coarsePointer || Math.min(probe.viewportWidth, probe.viewportHeight) <= 480;
    return software || phoneClass ? "constrained" : "eight-rig";
}

/**
 * Eight independently animated GLTF rigs share one Warfront canvas.  The
 * ordinary High preset is intended for the two-rig Coliseum and would multiply
 * its shadow pass, transient lights, outline rig and fullscreen bloom across a
 * much larger scene.  Keep the requested model geometry, atlas sampling and
 * action effects, while selecting a deterministic eight-rig render budget.
 *
 * This is deliberately a pure profile rather than a frame-rate governor: all
 * clients see the same silhouettes and the combat clock never changes speed.
 */
export function warfrontRenderBudget(
    requested: PetVisualQualityConfig,
    actorCount: number,
): PetVisualQualityConfig {
    if (actorCount < 8) return requested;

    return Object.freeze({
        ...requested,
        // Preserve the High atlas/geometry path.  Fill-rate is bounded instead
        // by DPR and by removing the multipass bloom target.
        dpr: requested.id === "high" ? [1, 1.15] as [number, number] : requested.dpr,
        modelShadows: false,
        dynamicPetLight: false,
        ambientParticles: Math.min(requested.ambientParticles, 12),
        identityParticles: Math.min(requested.identityParticles, 5),
        setPieceParticles: Math.min(requested.setPieceParticles, 28),
        translucentLayers: Math.min(requested.translucentLayers, 2),
        distortion: false,
        impactDebris: Math.min(requested.impactDebris, 7),
        impactSparks: Math.min(requested.impactSparks, 6),
        aftermathLayers: Math.min(requested.aftermathLayers, 2),
        decalLimit: Math.min(requested.decalLimit, 6),
        bloomIntensity: 0,
    });
}
