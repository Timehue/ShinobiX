import { chromium } from "@playwright/test";

const target = process.argv[2]
    ?? "https://127.0.0.1:5176/petvfx.html?rite=1&petQuality=high&ritespeed=0.78&autostart=1";
const sequentialCycles = Number.parseInt(process.argv[3] ?? "15", 10);
const cycleThresholdMs = Number.parseInt(process.argv[4] ?? "35000", 10);
const concurrentContexts = Number.parseInt(process.argv[5] ?? "2", 10);
const performanceMode = process.argv[6];
const requirePerformanceSample = performanceMode === "sample";
const awaitPerformanceSample = requirePerformanceSample || performanceMode === "warm";
const screenshotPath = process.argv[8] && process.argv[8] !== "-" ? process.argv[8] : undefined;
const browserChannel = process.argv[9] === "chrome" ? "chrome" : undefined;
const viewportMode = process.argv[7];
const explicitViewport = ["desktop", "landscape", "portrait", "stress"].includes(viewportMode);
const sampleViewport = viewportMode === "stress"
    ? { width: 320, height: 180 }
    : viewportMode === "landscape"
      ? { width: 915, height: 412 }
      : viewportMode === "portrait"
        ? { width: 412, height: 915 }
        : { width: 1280, height: 720 };
// The deterministic harness fight starts windup at tick 18 and lands its first
// hit at tick 32. Tick 33 proves eight rigs became ready and an authored attack
// family actually ran; no timeout or combat skip can satisfy it.
const ATTACK_REACHED_TICK = 33;

if (!Number.isSafeInteger(sequentialCycles) || sequentialCycles < 1) {
    throw new Error(`Invalid sequential reload count: ${sequentialCycles}`);
}
if (!Number.isSafeInteger(cycleThresholdMs) || cycleThresholdMs < 5_000) {
    throw new Error(`Invalid per-cycle threshold: ${cycleThresholdMs}`);
}
if (concurrentContexts !== 0 && concurrentContexts !== 2) {
    throw new Error(`Concurrent context count must be 0 or 2, got: ${concurrentContexts}`);
}

const browser = await chromium.launch({
    headless: true,
    channel: browserChannel,
    args: browserChannel ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] : [],
});
const failures = [];
const results = [];

const buildUrl = (label) => {
    const url = new URL(target);
    url.searchParams.set("ritemotionqa", "1");
    url.searchParams.set("reloadstress", label);
    return url.href;
};

async function instrument(page, label) {
    const errors = [];
    errors.rigRequests = [];
    errors.heavyRequests = [];
    await page.route("**/api/perf-beacon", (route) => route.fulfill({ status: 204 }));
    await page.addInitScript(() => {
        window.__riteWebglEvents = { lost: 0, restored: 0 };
        window.__riteHarnessLongTasks = [];
        window.__riteHarnessFrames = { last: null, gapsOver100ms: 0, maxGapMs: 0 };
        const sampleFrame = (now) => {
            const sample = window.__riteHarnessFrames;
            if (sample.last !== null) {
                const gap = now - sample.last;
                sample.maxGapMs = Math.max(sample.maxGapMs, gap);
                if (gap > 100) sample.gapsOver100ms += 1;
            }
            sample.last = now;
            requestAnimationFrame(sampleFrame);
        };
        requestAnimationFrame(sampleFrame);
        if (typeof PerformanceObserver !== "undefined") {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.duration > 100) window.__riteHarnessLongTasks.push({ start: entry.startTime, duration: entry.duration });
                }
            });
            observer.observe({ type: "longtask", buffered: true });
        }
        document.addEventListener("webglcontextlost", () => { window.__riteWebglEvents.lost += 1; }, true);
        document.addEventListener("webglcontextrestored", () => { window.__riteWebglEvents.restored += 1; }, true);
    });
    page.on("pageerror", (error) => errors.push(`${label} pageerror: ${error.message}`));
    page.on("request", (request) => {
        const url = request.url();
        if (/PetWarfrontSkinnedModel3D|\/pet-models\/warfront-lod\/|PetModel3D-[^/]+\.js/iu.test(url)) {
            errors.rigRequests.push(url);
        }
        if (/three-vendor|(?:node_modules\/\.vite\/deps\/(?:three|@react-three))|PetWarfrontRiteStage3D|PetWarfrontSkinnedModel3D|PetModel3D|pet-model-preload|pet-warfront-model-lod|pet-warfront-lod-manifest|\/pet-models\/warfront-lod\//iu.test(url)) {
            errors.heavyRequests.push(url);
        }
    });
    page.on("console", (message) => {
        const messageText = message.text();
        if (message.type() === "warning"
            && /^THREE\.Clock: This module has been deprecated|GL Driver Message.*ReadPixels/iu.test(messageText)) return;
        if (message.type() !== "error" && message.type() !== "warning"
            && !/_cacheIndex|AnimationMixer|webgl.*context|context.*lost/iu.test(messageText)) return;
        const location = message.location();
        errors.push(`${label} ${message.type()}: ${messageText}${location.url ? ` @ ${location.url}:${location.lineNumber}` : ""}`);
    });
    return errors;
}

async function snapshot(page) {
    return page.evaluate(() => {
        const canvas = document.querySelector(".wfr-canvas canvas");
        const clock = document.querySelector('[data-testid="wfr-clock"]');
        const curtain = document.querySelector('[data-testid="wfr-stage-curtain"]');
        const scriptResources = performance.getEntriesByType("resource")
            .filter((entry) => entry.initiatorType === "script" || /\.(?:m?js|tsx?|jsx?)(?:\?|$)/u.test(entry.name))
            .map((entry) => ({
                name: entry.name,
                duration: entry.duration,
                transferSize: entry.transferSize ?? 0,
                decodedBodySize: entry.decodedBodySize ?? 0,
            }));
        return {
            tick: Number(clock?.getAttribute("data-tick") ?? "0"),
            modelsReady: Number(curtain?.getAttribute("data-models-ready") ?? "0"),
            stageReady: curtain?.getAttribute("data-stage-ready"),
            boardVisible: canvas?.getAttribute("data-rite-board-visible"),
            boardMaxX: Number(canvas?.getAttribute("data-rite-board-max-x") ?? "NaN"),
            boardMaxY: Number(canvas?.getAttribute("data-rite-board-max-y") ?? "NaN"),
            actorsVisible: canvas?.getAttribute("data-rite-initial-actors-visible"),
            cameraDelta: Number(canvas?.getAttribute("data-rite-camera-max-delta") ?? "NaN"),
            renderCalls: Number(canvas?.getAttribute("data-rite-render-calls") ?? "NaN"),
            renderTriangles: Number(canvas?.getAttribute("data-rite-render-triangles") ?? "NaN"),
            renderPrograms: Number(canvas?.getAttribute("data-rite-render-programs") ?? "NaN"),
            sceneMeshes: Number(canvas?.getAttribute("data-rite-scene-meshes") ?? "NaN"),
            sceneSkinnedMeshes: Number(canvas?.getAttribute("data-rite-scene-skinned-meshes") ?? "NaN"),
            visibleMeshes: Number(canvas?.getAttribute("data-rite-visible-meshes") ?? "NaN"),
            visibleTriangles: Number(canvas?.getAttribute("data-rite-visible-triangles") ?? "NaN"),
            requestedQuality: canvas?.getAttribute("data-rite-requested-quality"),
            renderBudget: canvas?.getAttribute("data-rite-render-budget"),
            capabilityTier: canvas?.getAttribute("data-rite-capability-tier"),
            renderer: canvas?.getAttribute("data-rite-renderer"),
            actorRenderMode: canvas?.getAttribute("data-rite-actor-render-mode"),
            impostorActors: Number(canvas?.getAttribute("data-rite-impostor-actors") ?? "NaN"),
            runtimeRoute: canvas?.getAttribute("data-rite-runtime-route"),
            runtimeRouteStatus: canvas?.getAttribute("data-rite-runtime-route-status"),
            runtimeRouteReason: canvas?.getAttribute("data-rite-runtime-route-reason"),
            runtimeRoutePersisted: canvas?.getAttribute("data-rite-runtime-route-persisted"),
            runtimeRouteQaCanary: canvas?.getAttribute("data-rite-runtime-route-qa-canary"),
            runtimeRouteSwitches: Number(canvas?.getAttribute("data-rite-runtime-route-switches") ?? "NaN"),
            runtimeRouteBeforeReveal: canvas?.getAttribute("data-rite-runtime-route-before-reveal"),
            impostorAssetsReady: canvas?.getAttribute("data-rite-impostor-assets-ready"),
            preflightThresholdMs: Number(canvas?.getAttribute("data-rite-preflight-threshold-ms") ?? "NaN"),
            preflightFrameGaps: Number(canvas?.getAttribute("data-rite-preflight-frame-gaps") ?? "NaN"),
            preflightFrameGapMaxMs: Number(canvas?.getAttribute("data-rite-preflight-frame-gap-max-ms") ?? "NaN"),
            preflightLongTasks: Number(canvas?.getAttribute("data-rite-preflight-long-tasks") ?? "NaN"),
            preflightLongTaskMaxMs: Number(canvas?.getAttribute("data-rite-preflight-long-task-max-ms") ?? "NaN"),
            routeValidationFrameGaps: Number(canvas?.getAttribute("data-rite-route-validation-frame-gaps") ?? "NaN"),
            routeValidationFrameGapMaxMs: Number(canvas?.getAttribute("data-rite-route-validation-frame-gap-max-ms") ?? "NaN"),
            routeValidationLongTasks: Number(canvas?.getAttribute("data-rite-route-validation-long-tasks") ?? "NaN"),
            routeValidationLongTaskMaxMs: Number(canvas?.getAttribute("data-rite-route-validation-long-task-max-ms") ?? "NaN"),
            silhouette: canvas?.getAttribute("data-rite-silhouette"),
            textureAnisotropy: Number(canvas?.getAttribute("data-rite-texture-anisotropy") ?? "NaN"),
            dpr: Number(canvas?.getAttribute("data-rite-dpr") ?? "NaN"),
            petLodEnabled: canvas?.getAttribute("data-rite-pet-lod-enabled"),
            petLodActors: Number(canvas?.getAttribute("data-rite-pet-lod-actors") ?? "NaN"),
            petLodFallbacks: Number(canvas?.getAttribute("data-rite-pet-lod-fallbacks") ?? "NaN"),
            petSourceTriangles: Number(canvas?.getAttribute("data-rite-pet-source-triangles") ?? "NaN"),
            petSelectedTriangles: Number(canvas?.getAttribute("data-rite-pet-selected-triangles") ?? "NaN"),
            rigChunkStatus: canvas?.getAttribute("data-rite-rig-chunk-status"),
            rigChunkRequested: canvas?.getAttribute("data-rite-rig-chunk-requested"),
            hydrationPhase: Number(canvas?.getAttribute("data-rite-hydration-phase") ?? "NaN"),
            hydrationMarks: performance.getEntriesByType("mark")
                .filter((entry) => entry.name.startsWith("wfr-hydration-"))
                .map((entry) => ({ name: entry.name, startTime: entry.startTime })),
            attackCues: Number(canvas?.getAttribute("data-rite-attack-cues") ?? "NaN"),
            attackStreakMs: Number(canvas?.getAttribute("data-rite-attack-streak-ms") ?? "NaN"),
            contactHoldFrames: Number(canvas?.getAttribute("data-rite-contact-hold-frames") ?? "NaN"),
            attackCausalityActive: Number(canvas?.getAttribute("data-rite-attack-causality-active") ?? "NaN"),
            attackContactsActive: Number(canvas?.getAttribute("data-rite-attack-contacts-active") ?? "NaN"),
            attackCausalityMaxActive: Number(canvas?.getAttribute("data-rite-attack-causality-max-active") ?? "NaN"),
            groundingPermanentPads: Number(canvas?.getAttribute("data-rite-grounding-permanent-pads") ?? "NaN"),
            groundingWideAuras: Number(canvas?.getAttribute("data-rite-grounding-wide-auras") ?? "NaN"),
            groundingShadowMode: canvas?.getAttribute("data-rite-grounding-shadow-mode"),
            groundingActiveRings: Number(canvas?.getAttribute("data-rite-grounding-active-rings") ?? "NaN"),
            groundingMaxActiveRings: Number(canvas?.getAttribute("data-rite-grounding-max-active-rings") ?? "NaN"),
            groundingIdleActors: Number(canvas?.getAttribute("data-rite-grounding-idle-actors") ?? "NaN"),
            groundingDeadActors: Number(canvas?.getAttribute("data-rite-grounding-dead-actors") ?? "NaN"),
            groundingIdleRings: Number(canvas?.getAttribute("data-rite-grounding-idle-rings") ?? "NaN"),
            groundingDeadRings: Number(canvas?.getAttribute("data-rite-grounding-dead-rings") ?? "NaN"),
            groundingSubmittedAoCount: Number(canvas?.getAttribute("data-rite-grounding-submitted-ao-count") ?? "NaN"),
            groundingSubmittedAoMaxAlpha: Number(canvas?.getAttribute("data-rite-grounding-submitted-ao-max-alpha") ?? "NaN"),
            groundingSubmittedAoMaxRadiusPx: Number(canvas?.getAttribute("data-rite-grounding-submitted-ao-max-radius-px") ?? "NaN"),
            groundingSubmittedAoMaxRadiusRatio: Number(canvas?.getAttribute("data-rite-grounding-submitted-ao-max-radius-ratio") ?? "NaN"),
            groundingSubmittedRimCount: Number(canvas?.getAttribute("data-rite-grounding-submitted-rim-count") ?? "NaN"),
            groundingSubmittedRimMaxAlpha: Number(canvas?.getAttribute("data-rite-grounding-submitted-rim-max-alpha") ?? "NaN"),
            groundingSubmittedPlanarImpactCount: Number(canvas?.getAttribute("data-rite-grounding-submitted-planar-impact-count") ?? "NaN"),
            groundingAuthoritativeActor: canvas?.getAttribute("data-rite-grounding-authoritative-actor") ?? "",
            arenaPrototypeDressingDraws: Number(canvas?.getAttribute("data-rite-arena-prototype-dressing-draws") ?? "NaN"),
            arenaPrototypeDressingMeshes: Number(canvas?.getAttribute("data-rite-arena-prototype-dressing-meshes") ?? "NaN"),
            arenaGlyphDebrisDraws: Number(canvas?.getAttribute("data-rite-arena-glyph-debris-draws") ?? "NaN"),
            arenaGlyphDebrisMeshes: Number(canvas?.getAttribute("data-rite-arena-glyph-debris-meshes") ?? "NaN"),
            arenaFloorDecalDraws: Number(canvas?.getAttribute("data-rite-arena-floor-decal-draws") ?? "NaN"),
            arenaFloorDecalMaxAlpha: Number(canvas?.getAttribute("data-rite-arena-floor-decal-max-alpha") ?? "NaN"),
            arenaFloorDecalMaxRadiusWorld: Number(canvas?.getAttribute("data-rite-arena-floor-decal-max-radius-world") ?? "NaN"),
            arenaScrollPropDraws: Number(canvas?.getAttribute("data-rite-arena-scroll-prop-draws") ?? "NaN"),
            arenaScrollPropMeshes: Number(canvas?.getAttribute("data-rite-arena-scroll-prop-meshes") ?? "NaN"),
            arenaActorLightMode: canvas?.getAttribute("data-rite-arena-actor-light-mode") ?? "",
            arenaActorLightOverlays: Number(canvas?.getAttribute("data-rite-arena-actor-light-overlays") ?? "NaN"),
            arenaActorLightMaxAlpha: Number(canvas?.getAttribute("data-rite-arena-actor-light-max-alpha") ?? "NaN"),
            arenaActorLightMultiplyMaxAlpha: Number(canvas?.getAttribute("data-rite-arena-actor-light-multiply-max-alpha") ?? "NaN"),
            arenaActorLightMultiplyCap: Number(canvas?.getAttribute("data-rite-arena-actor-light-multiply-cap") ?? "NaN"),
            arenaActorLightEdgeRecoveryMaxAlpha: Number(canvas?.getAttribute("data-rite-arena-actor-light-edge-recovery-max-alpha") ?? "NaN"),
            arenaSideLights: Number(canvas?.getAttribute("data-rite-arena-side-lights") ?? "NaN"),
            arenaSideLightIntensity: Number(canvas?.getAttribute("data-rite-arena-side-light-intensity") ?? "0"),
            longTaskSample: canvas?.getAttribute("data-rite-long-task-sample"),
            longTasksOver100ms: Number(canvas?.getAttribute("data-rite-long-tasks-over100ms") ?? "NaN"),
            longTaskMaxMs: Number(canvas?.getAttribute("data-rite-long-task-max-ms") ?? "NaN"),
            frameGapsOver100ms: Number(canvas?.getAttribute("data-rite-frame-gaps-over100ms") ?? "NaN"),
            frameGapMaxMs: Number(canvas?.getAttribute("data-rite-frame-gap-max-ms") ?? "NaN"),
            contextEvents: window.__riteWebglEvents ?? { lost: -1, restored: -1 },
            harnessLongTasks: window.__riteHarnessLongTasks ?? [],
            harnessFrames: window.__riteHarnessFrames ?? { gapsOver100ms: -1, maxGapMs: Number.NaN },
            scriptTransferBytes: scriptResources.reduce((sum, entry) => sum + entry.transferSize, 0),
            scriptDecodedBytes: scriptResources.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
            scriptRequestCount: scriptResources.length,
            slowestScripts: scriptResources.sort((a, b) => b.duration - a.duration).slice(0, 12),
            rendererStatus: document.querySelector('[data-testid="wfr-render-recovery"]')?.getAttribute("data-renderer-status") ?? "ready",
            documentVisibility: document.visibilityState,
        };
    });
}

async function exercise(page, errors, label, navigate) {
    const began = performance.now();
    const errorsBefore = errors.length;
    const rigRequestsBefore = errors.rigRequests.length;
    const heavyRequestsBefore = errors.heavyRequests.length;
    try {
        const navigationBudget = cycleThresholdMs;
        if (navigate === "goto") {
            await page.goto(buildUrl(label), { waitUntil: "domcontentloaded", timeout: navigationBudget });
        } else {
            await page.reload({ waitUntil: "domcontentloaded", timeout: navigationBudget });
        }
        const remaining = Math.max(1_000, cycleThresholdMs - (performance.now() - began));
        await page.waitForFunction(({ attackTick }) => {
            const clock = document.querySelector('[data-testid="wfr-clock"]');
            const curtain = document.querySelector('[data-testid="wfr-stage-curtain"]');
            return curtain?.getAttribute("data-models-ready") === "8"
                && curtain?.getAttribute("data-stage-ready") === "true"
                && Number(clock?.getAttribute("data-tick") ?? "0") >= attackTick;
        }, { attackTick: ATTACK_REACHED_TICK }, { polling: 100, timeout: remaining });
        if (awaitPerformanceSample) {
            const sampleRemaining = Math.max(1_000, cycleThresholdMs - (performance.now() - began));
            await page.waitForFunction(() => document.querySelector(".wfr-canvas canvas")
                ?.getAttribute("data-rite-long-task-sample") === "complete", undefined, { polling: 100, timeout: sampleRemaining });
        }
        const state = await snapshot(page);
        if (screenshotPath && label === "sequential-1") {
            await page.screenshot({ path: screenshotPath, type: "png" });
        }
        if (state.boardVisible !== "true") errors.push(`${label}: board was not framed`);
        if (state.actorsVisible !== "8") errors.push(`${label}: expected 8 visible actors, got ${state.actorsVisible}`);
        if (state.contextEvents.lost !== 0 || state.contextEvents.restored !== 0) {
            errors.push(`${label}: unexpected WebGL lifecycle ${JSON.stringify(state.contextEvents)}`);
        }
        if (state.rendererStatus !== "ready") errors.push(`${label}: renderer status ${state.rendererStatus}`);
        const cycleRigRequests = errors.rigRequests.slice(rigRequestsBefore);
        const cycleHeavyRequests = errors.heavyRequests.slice(heavyRequestsBefore);
        if (state.actorRenderMode === "skinned-3d") {
            if (state.petLodEnabled !== "true" || state.petLodActors !== 8 || state.petLodFallbacks !== 0) {
                errors.push(`${label}: incomplete Warfront LOD selection ${JSON.stringify({ enabled: state.petLodEnabled, actors: state.petLodActors, fallbacks: state.petLodFallbacks })}`);
            }
            if (state.petSelectedTriangles > 120_000) errors.push(`${label}: pet LOD triangle floor ${state.petSelectedTriangles} exceeded 120k`);
            if (state.rigChunkStatus !== "ready" || state.rigChunkRequested !== "true") {
                errors.push(`${label}: skinned route did not finish the lazy rig import ${JSON.stringify({ status: state.rigChunkStatus, requested: state.rigChunkRequested })}`);
            }
        } else if (state.runtimeRouteQaCanary !== "true") {
            if (state.petLodEnabled !== "false" || state.petLodActors !== 0 || state.petLodFallbacks !== 0) {
                errors.push(`${label}: impostor route initialized LOD metrics ${JSON.stringify({ enabled: state.petLodEnabled, actors: state.petLodActors, fallbacks: state.petLodFallbacks })}`);
            }
            if (state.rigChunkStatus !== "not-requested" || state.rigChunkRequested !== "false" || cycleRigRequests.length !== 0) {
                errors.push(`${label}: default route requested rig assets ${JSON.stringify({ status: state.rigChunkStatus, requested: state.rigChunkRequested, urls: cycleRigRequests })}`);
            }
            if (cycleHeavyRequests.length !== 0) {
                errors.push(`${label}: default route requested Three/R3F/rig/LOD modules ${JSON.stringify(cycleHeavyRequests)}`);
            }
        }
        if (state.dpr < 1) errors.push(`${label}: internal DPR ${state.dpr} fell below CSS-resolution floor`);
        if (state.attackCues < 1 || state.attackStreakMs < 250 || state.attackStreakMs > 400 || state.contactHoldFrames !== 2) {
            errors.push(`${label}: incomplete authoritative attack read ${JSON.stringify({ cues: state.attackCues, streakMs: state.attackStreakMs, holdFrames: state.contactHoldFrames })}`);
        }
        if (state.attackCausalityMaxActive > 16) errors.push(`${label}: attack overlap cap exceeded (${state.attackCausalityMaxActive})`);
        if (state.groundingPermanentPads !== 0 || state.groundingWideAuras !== 0 || state.groundingShadowMode !== "feathered-ao") {
            errors.push(`${label}: fighter grounding regressed to an opaque pad ${JSON.stringify({ pads: state.groundingPermanentPads, wideAuras: state.groundingWideAuras, shadow: state.groundingShadowMode })}`);
        }
        if (state.groundingIdleRings !== 0 || state.groundingDeadRings !== 0) {
            errors.push(`${label}: permanent faction ring survived outside combat ${JSON.stringify({ idle: state.groundingIdleRings, dead: state.groundingDeadRings })}`);
        }
        if (!Number.isFinite(state.groundingSubmittedAoCount)
            || state.groundingSubmittedAoMaxAlpha > 0.42
            || state.groundingSubmittedAoMaxRadiusRatio > 0.28
            || state.groundingSubmittedRimCount > 1
            || state.groundingSubmittedPlanarImpactCount !== 0
            || (state.groundingSubmittedRimCount > 0 && !state.groundingAuthoritativeActor)) {
            errors.push(`${label}: submitted grounding geometry exceeded the foot-scale contract ${JSON.stringify({
                aoCount: state.groundingSubmittedAoCount,
                aoAlpha: state.groundingSubmittedAoMaxAlpha,
                aoRadiusPx: state.groundingSubmittedAoMaxRadiusPx,
                aoRadiusRatio: state.groundingSubmittedAoMaxRadiusRatio,
                rims: state.groundingSubmittedRimCount,
                rimAlpha: state.groundingSubmittedRimMaxAlpha,
                planarImpacts: state.groundingSubmittedPlanarImpactCount,
                authority: state.groundingAuthoritativeActor,
            })}`);
        }
        if (state.arenaPrototypeDressingDraws !== 0 || state.arenaPrototypeDressingMeshes !== 0
            || state.arenaGlyphDebrisDraws !== 0 || state.arenaGlyphDebrisMeshes !== 0
            || state.arenaFloorDecalDraws < 1 || state.arenaFloorDecalMaxAlpha > 0.18
            || state.arenaFloorDecalMaxRadiusWorld > 0.285 || state.arenaScrollPropDraws < 4) {
            errors.push(`${label}: foreground arena dressing exceeded the floor-flush contract ${JSON.stringify({
                prototypeDraws: state.arenaPrototypeDressingDraws,
                prototypeMeshes: state.arenaPrototypeDressingMeshes,
                glyphDebrisDraws: state.arenaGlyphDebrisDraws,
                glyphDebrisMeshes: state.arenaGlyphDebrisMeshes,
                floorDecalDraws: state.arenaFloorDecalDraws,
                floorDecalAlpha: state.arenaFloorDecalMaxAlpha,
                floorDecalRadiusWorld: state.arenaFloorDecalMaxRadiusWorld,
                scrollPropDraws: state.arenaScrollPropDraws,
                scrollPropMeshes: state.arenaScrollPropMeshes,
            })}`);
        }
        const canvasLightInvalid = state.actorRenderMode === "model-impostor"
            && (state.arenaActorLightMode !== "position-aware-multiply-mask"
                || state.arenaActorLightOverlays < 1 || state.arenaActorLightOverlays > 8
                || state.arenaActorLightMaxAlpha > 0.17
                || state.arenaActorLightMultiplyMaxAlpha > 0.17
                || state.arenaActorLightMultiplyCap !== 0.17
                || state.arenaActorLightEdgeRecoveryMaxAlpha > 0.03
                || state.arenaSideLights !== 0);
        const threeLightInvalid = state.actorRenderMode === "skinned-3d"
            && (state.arenaActorLightMode !== "three-positional-pair"
                || state.arenaActorLightOverlays !== 0 || state.arenaSideLights !== 2
                || state.arenaSideLightIntensity !== 4.5);
        if (canvasLightInvalid || threeLightInvalid) {
            errors.push(`${label}: actor arena-light submission failed ${JSON.stringify({
                actorMode: state.actorRenderMode,
                lightMode: state.arenaActorLightMode,
                overlays: state.arenaActorLightOverlays,
                maxAlpha: state.arenaActorLightMaxAlpha,
                multiplyMaxAlpha: state.arenaActorLightMultiplyMaxAlpha,
                multiplyCap: state.arenaActorLightMultiplyCap,
                edgeRecoveryMaxAlpha: state.arenaActorLightEdgeRecoveryMaxAlpha,
                sideLights: state.arenaSideLights,
                sideLightIntensity: state.arenaSideLightIntensity,
            })}`);
        }
        const softwareRenderer = /swiftshader|llvmpipe|software raster|microsoft basic render|lavapipe/iu.test(state.renderer ?? "");
        const runtimeSlowRoute = state.runtimeRouteReason === "preflight-slow"
            || state.runtimeRouteReason === "visible-slow"
            || state.runtimeRouteReason === "safe-default"
            || state.runtimeRouteReason === "persisted-slow";
        if (state.runtimeRouteStatus !== "locked" || state.runtimeRouteBeforeReveal !== "true") {
            errors.push(`${label}: runtime route was not locked behind the formation curtain ${JSON.stringify({ status: state.runtimeRouteStatus, beforeReveal: state.runtimeRouteBeforeReveal })}`);
        }
        if (state.impostorAssetsReady !== "true") errors.push(`${label}: exact-model impostor bank was not preloaded`);
        if (softwareRenderer && (state.actorRenderMode !== "model-impostor" || state.impostorActors !== 8 || state.sceneSkinnedMeshes !== 0)) {
            errors.push(`${label}: software renderer did not select eight model impostors ${JSON.stringify({ mode: state.actorRenderMode, impostors: state.impostorActors, skinned: state.sceneSkinnedMeshes })}`);
        }
        if (!softwareRenderer && runtimeSlowRoute
            && (state.actorRenderMode !== "model-impostor" || state.impostorActors !== 8 || state.sceneSkinnedMeshes !== 0)) {
            errors.push(`${label}: slow hardware route did not replace all eight skinned rigs ${JSON.stringify({ mode: state.actorRenderMode, impostors: state.impostorActors, skinned: state.sceneSkinnedMeshes })}`);
        }
        if (!softwareRenderer && !runtimeSlowRoute && state.actorRenderMode !== "skinned-3d") {
            errors.push(`${label}: fast hardware route unexpectedly left the skinned 3D path (${state.actorRenderMode})`);
        }
        if (requirePerformanceSample && state.longTasksOver100ms !== 0) {
            errors.push(`${label}: ${state.longTasksOver100ms} main-thread tasks exceeded 100ms (max ${state.longTaskMaxMs}ms)`);
        }
        if (requirePerformanceSample && state.frameGapMaxMs > 100) {
            errors.push(`${label}: max rendered-frame gap ${state.frameGapMaxMs}ms exceeded 100ms`);
        }
        if ((requirePerformanceSample || state.runtimeRouteQaCanary !== "true") && state.harnessLongTasks.length !== 0) {
            errors.push(`${label}: cold navigation recorded ${state.harnessLongTasks.length} task(s) over 100ms (max ${Math.max(...state.harnessLongTasks.map((entry) => entry.duration)).toFixed(1)}ms)`);
        }
        if ((requirePerformanceSample || state.runtimeRouteQaCanary !== "true") && (state.harnessFrames.gapsOver100ms !== 0 || state.harnessFrames.maxGapMs > 100)) {
            errors.push(`${label}: cold navigation recorded ${state.harnessFrames.gapsOver100ms} frame gap(s) over 100ms (max ${state.harnessFrames.maxGapMs.toFixed(1)}ms)`);
        }
        if (errors.length !== errorsBefore) throw new Error("instrumentation recorded an error");
        const result = { label, elapsedMs: Math.round(performance.now() - began), rigRequests: cycleRigRequests, heavyRequests: cycleHeavyRequests, ...state };
        results.push(result);
        console.log(`${label}: ${result.elapsedMs}ms tick=${state.tick.toFixed(2)} ready=${state.modelsReady}/8`);
        return true;
    } catch (error) {
        const state = await snapshot(page).catch(() => ({ unavailable: true }));
        failures.push({ label, elapsedMs: Math.round(performance.now() - began), error: error.message, state, errors: errors.slice(errorsBefore) });
        console.error(`${label}: FAILED ${error.message} state=${JSON.stringify(state)}`);
        return false;
    }
}

async function createContext(viewport = requirePerformanceSample || explicitViewport ? sampleViewport : { width: 320, height: 180 }) {
    return browser.newContext({ ignoreHTTPSErrors: true, viewport });
}

try {
    // One page is deliberately reloaded in place: this exercises React cleanup,
    // R3F unmount/context retirement, cached GLTF clones, and mixer reactivation.
    const sequentialContext = await createContext();
    const sequentialPage = await sequentialContext.newPage();
    const sequentialErrors = await instrument(sequentialPage, "sequential");
    let sequentialCompleted = 0;
    for (let cycle = 1; cycle <= sequentialCycles; cycle += 1) {
        const ok = await exercise(sequentialPage, sequentialErrors, `sequential-${cycle}`, cycle === 1 ? "goto" : "reload");
        if (!ok) break; // fail fast: never stack another long browser timeout
        sequentialCompleted += 1;
    }
    await sequentialContext.close();

    // Exactly two simultaneous contexts is the bounded pressure case. Both
    // must independently hydrate 8/8 and cross the real first-hit tick.
    let concurrentCompleted = 0;
    if (concurrentContexts && sequentialCompleted === sequentialCycles) {
        const contexts = await Promise.all(Array.from({ length: concurrentContexts }, () => createContext()));
        const entries = await Promise.all(contexts.map(async (context, index) => {
            const page = await context.newPage();
            const label = `concurrent-${index + 1}`;
            const errors = await instrument(page, label);
            return { context, page, label, errors };
        }));
        const outcomes = await Promise.all(entries.map(({ page, label, errors }) => exercise(page, errors, label, "goto")));
        concurrentCompleted = outcomes.filter(Boolean).length;
        await Promise.all(contexts.map((context) => context.close()));
    }

    console.log(JSON.stringify({
        requestedSequentialCycles: sequentialCycles,
        completedSequentialCycles: sequentialCompleted,
        requestedConcurrentContexts: concurrentContexts,
        completedConcurrentContexts: concurrentCompleted,
        attackReachedTick: ATTACK_REACHED_TICK,
        cycleThresholdMs,
        requirePerformanceSample,
        results,
        failures,
    }, null, 2));
} finally {
    await browser.close();
}

if (failures.length) process.exitCode = 1;
