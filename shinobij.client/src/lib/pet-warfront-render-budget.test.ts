import test from "node:test";
import assert from "node:assert/strict";
import { PET_VISUAL_QUALITY_PRESETS } from "./pet-visual-quality";
import {
    WARFRONT_PREFLIGHT_THRESHOLD_MS,
    initialWarfrontRuntimeRoute,
    isSoftwareWebGLRenderer,
    parseWarfrontPersistedRoute,
    resolveWarfrontRigImportFailure,
    resolveWarfrontRuntimeRoute,
    resolveWarfrontVisibleRoute,
    serializeWarfrontPersistedRoute,
    warfront3dQaCanaryRequested,
    warfrontCapabilityTier,
    warfrontRenderBudget,
    type WarfrontPerformanceSample,
} from "./pet-warfront-render-budget";

test("the eight-rig High budget preserves the authored model path", () => {
    const requested = PET_VISUAL_QUALITY_PRESETS.high;
    const budget = warfrontRenderBudget(requested, 8);

    assert.equal(budget.id, "high");
    assert.equal(budget.textureAnisotropy, requested.textureAnisotropy);
    assert.equal(budget.outline, true, "PetModel keeps a silhouette path even when Warfront selects its single-rig implementation");
    assert.notEqual(budget, requested);
});

test("the eight-rig profile removes multiplicative passes without changing playback", () => {
    const budget = warfrontRenderBudget(PET_VISUAL_QUALITY_PRESETS.high, 8);

    assert.deepEqual(budget.dpr, [1, 1.15]);
    assert.equal(budget.modelShadows, false);
    assert.equal(budget.dynamicPetLight, false);
    assert.equal(budget.bloomIntensity, 0);
    assert.ok(budget.impactSparks >= 6, "contact ownership retains a radial six-direction action read");
    assert.ok(budget.identityParticles >= 5, "pet identity particles remain present");
});

test("smaller scenes retain their selected visual-quality preset", () => {
    const requested = PET_VISUAL_QUALITY_PRESETS.high;
    assert.equal(warfrontRenderBudget(requested, 2), requested);
});

test("the runtime tier identifies software and phone-class eight-rig canvases", () => {
    assert.equal(isSoftwareWebGLRenderer("ANGLE (SwiftShader Device (Subzero))"), true);
    assert.equal(isSoftwareWebGLRenderer("ANGLE (Qualcomm, Adreno 830)"), false);
    assert.equal(warfrontCapabilityTier({
        actorCount: 8,
        renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))",
        viewportWidth: 1280,
        viewportHeight: 720,
        coarsePointer: false,
    }), "constrained");
    assert.equal(warfrontCapabilityTier({
        actorCount: 8,
        renderer: "ANGLE (Qualcomm, Adreno 830)",
        viewportWidth: 915,
        viewportHeight: 412,
        coarsePointer: true,
    }), "constrained");
    assert.equal(warfrontCapabilityTier({
        actorCount: 8,
        renderer: "ANGLE (NVIDIA GeForce RTX 3080)",
        viewportWidth: 1280,
        viewportHeight: 720,
        coarsePointer: false,
    }), "eight-rig");
    assert.equal(warfrontCapabilityTier({
        actorCount: 2,
        renderer: "SwiftShader",
        viewportWidth: 320,
        viewportHeight: 180,
        coarsePointer: true,
    }), "standard", "non-Warfront hero views retain their requested presentation");
});

const sample = (overrides: Partial<WarfrontPerformanceSample> = {}): WarfrontPerformanceSample => ({
    durationMs: 3_250,
    frameGapsOver100ms: 0,
    frameGapMaxMs: 16.7,
    longTasksOver100ms: 0,
    longTaskMaxMs: 0,
    ...overrides,
});

test("runtime preflight keeps genuine fast hardware on all eight skinned rigs", () => {
    const initial = initialWarfrontRuntimeRoute({
        actorCount: 8,
        renderer: "ANGLE (NVIDIA GeForce RTX 3080)",
        impostorAssetsAvailable: true,
        persisted: null,
        force3dCanary: true,
    });
    assert.equal(initial.status, "probing");
    const resolved = resolveWarfrontRuntimeRoute(initial, sample({ frameGapMaxMs: WARFRONT_PREFLIGHT_THRESHOLD_MS }));
    assert.deepEqual({ mode: resolved.mode, status: resolved.status, reason: resolved.reason }, {
        mode: "skinned-3d",
        status: "validating",
        reason: "preflight-fast",
    });
    const visible = resolveWarfrontVisibleRoute(resolved, sample());
    assert.deepEqual({ mode: visible.mode, status: visible.status, reason: visible.reason }, {
        mode: "skinned-3d",
        status: "locked",
        reason: "visible-fast",
    });
});

test("a renderer-owned sample over 100ms routes atomically to exact-model impostors", () => {
    const initial = initialWarfrontRuntimeRoute({
        actorCount: 8,
        renderer: "ANGLE (NVIDIA GeForce RTX 3080)",
        impostorAssetsAvailable: true,
        persisted: null,
        force3dCanary: true,
    });
    const resolved = resolveWarfrontRuntimeRoute(initial, sample({
        frameGapsOver100ms: 1,
        frameGapMaxMs: WARFRONT_PREFLIGHT_THRESHOLD_MS + 0.1,
        longTasksOver100ms: 1,
        longTaskMaxMs: 181,
    }));
    assert.equal(resolved.mode, "model-impostor");
    assert.equal(resolved.reason, "preflight-slow");
});

test("a slow decision is one-way across later frames and context restoration", () => {
    const initial = initialWarfrontRuntimeRoute({ actorCount: 8, renderer: "RTX", impostorAssetsAvailable: true, persisted: null, force3dCanary: true });
    const slow = resolveWarfrontRuntimeRoute(initial, sample({ frameGapsOver100ms: 2, frameGapMaxMs: 180 }));
    assert.equal(resolveWarfrontRuntimeRoute(slow, sample()).mode, "model-impostor");
    assert.equal(resolveWarfrontRuntimeRoute(slow, sample()).reason, "preflight-slow");
});

test("a provisional hardware route downgrades once when visible action exceeds 100ms", () => {
    const initial = initialWarfrontRuntimeRoute({ actorCount: 8, renderer: "RTX", impostorAssetsAvailable: true, persisted: null, force3dCanary: true });
    const provisional = resolveWarfrontRuntimeRoute(initial, sample());
    const slow = resolveWarfrontVisibleRoute(provisional, sample({ frameGapsOver100ms: 1, frameGapMaxMs: 151 }));
    assert.deepEqual({ mode: slow.mode, status: slow.status, reason: slow.reason }, {
        mode: "model-impostor",
        status: "locked",
        reason: "visible-slow",
    });
    assert.equal(resolveWarfrontVisibleRoute(slow, sample()).mode, "model-impostor");
});

test("the device verdict survives reload but never crosses renderer contexts", () => {
    const renderer = "ANGLE (NVIDIA GeForce RTX 3080)";
    const initial = initialWarfrontRuntimeRoute({ actorCount: 8, renderer, impostorAssetsAvailable: true, persisted: null, force3dCanary: true });
    const slow = resolveWarfrontRuntimeRoute(initial, sample({ frameGapsOver100ms: 2, frameGapMaxMs: 180 }));
    const encoded = serializeWarfrontPersistedRoute(renderer, slow);
    const restored = parseWarfrontPersistedRoute(encoded, renderer);
    assert.equal(initialWarfrontRuntimeRoute({ actorCount: 8, renderer, impostorAssetsAvailable: true, persisted: restored }).reason, "persisted-slow");
    assert.equal(parseWarfrontPersistedRoute(encoded, "ANGLE (Qualcomm Adreno 830)"), null);
});

test("unknown hardware defaults to pre-reveal impostors and persists the safe choice", () => {
    const renderer = "ANGLE (NVIDIA GeForce RTX 3080)";
    const route = initialWarfrontRuntimeRoute({ actorCount: 8, renderer, impostorAssetsAvailable: true, persisted: null });
    assert.deepEqual({ mode: route.mode, status: route.status, reason: route.reason }, {
        mode: "model-impostor",
        status: "locked",
        reason: "safe-default",
    });
    const encoded = serializeWarfrontPersistedRoute(renderer, route);
    const restored = parseWarfrontPersistedRoute(encoded, renderer);
    assert.equal(restored?.proof, "safe-default");
    assert.equal(initialWarfrontRuntimeRoute({ actorCount: 8, renderer, impostorAssetsAvailable: true, persisted: restored }).reason, "persisted-slow");
});

test("an unproven or over-budget 3D storage record cannot opt hardware into rigs", () => {
    const renderer = "ANGLE (NVIDIA GeForce RTX 3080)";
    const unproven = JSON.stringify({ version: 2, renderer, mode: "skinned-3d", proof: "safe-default", sample: sample() });
    const slow = JSON.stringify({ version: 2, renderer, mode: "skinned-3d", proof: "fast-visible-canary", sample: sample({ frameGapMaxMs: 101 }) });
    assert.equal(parseWarfrontPersistedRoute(unproven, renderer), null);
    assert.equal(parseWarfrontPersistedRoute(slow, renderer), null);
});

test("missing atlas coverage remains on the safe authored-rig fallback", () => {
    const route = initialWarfrontRuntimeRoute({ actorCount: 8, renderer: "RTX", impostorAssetsAvailable: false, persisted: null });
    assert.deepEqual({ mode: route.mode, status: route.status, reason: route.reason }, {
        mode: "skinned-3d",
        status: "locked",
        reason: "missing-impostor-assets",
    });
});

test("the rig import gate requires both explicit QA canary flags", () => {
    assert.equal(warfront3dQaCanaryRequested(""), false);
    assert.equal(warfront3dQaCanaryRequested("?ritemotionqa=1"), false);
    assert.equal(warfront3dQaCanaryRequested("?riteforce3d=1"), false);
    assert.equal(warfront3dQaCanaryRequested("?ritemotionqa=1&riteforce3d=1"), true);
    assert.equal(warfront3dQaCanaryRequested("?riteforce3d=1&ritemotionqa=1"), true);
});

test("a validated persisted-fast route is the only non-QA route into rigs", () => {
    const renderer = "ANGLE (NVIDIA GeForce RTX 3080)";
    const visibleFast = resolveWarfrontVisibleRoute(
        resolveWarfrontRuntimeRoute(initialWarfrontRuntimeRoute({
            actorCount: 8,
            renderer,
            impostorAssetsAvailable: true,
            persisted: null,
            force3dCanary: true,
        }), sample()),
        sample(),
    );
    const persisted = parseWarfrontPersistedRoute(serializeWarfrontPersistedRoute(renderer, visibleFast), renderer);
    const reload = initialWarfrontRuntimeRoute({ actorCount: 8, renderer, impostorAssetsAvailable: true, persisted });
    assert.deepEqual({ mode: reload.mode, reason: reload.reason, persisted: reload.persisted }, {
        mode: "skinned-3d",
        reason: "persisted-fast",
        persisted: true,
    });
});

test("a failed lazy rig import downgrades once when exact impostors exist", () => {
    const canary = initialWarfrontRuntimeRoute({
        actorCount: 8,
        renderer: "RTX",
        impostorAssetsAvailable: true,
        persisted: null,
        force3dCanary: true,
    });
    const fallback = resolveWarfrontRigImportFailure(canary, true);
    assert.deepEqual({ mode: fallback.mode, status: fallback.status, reason: fallback.reason }, {
        mode: "model-impostor",
        status: "locked",
        reason: "rig-import-failed",
    });
    assert.equal(resolveWarfrontRigImportFailure(fallback, true), fallback, "fallback is one-way");
    assert.equal(resolveWarfrontRigImportFailure(canary, false), canary, "never selects unavailable assets");
});
