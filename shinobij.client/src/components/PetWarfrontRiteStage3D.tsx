/* eslint-disable react-hooks/immutability --
 * READ THIS BEFORE REMOVING.
 *
 * Every violation in this file is a react-three-fiber `useFrame` callback
 * mutating a Three.js object: a camera position, a mesh transform, a material's
 * opacity, or a pooled VFX slot. That is not a workaround — it is r3f's entire
 * execution model. The scene graph lives outside React, and a frame callback
 * exists precisely to drive it between renders; expressing a 60fps camera push
 * as render output would re-render the match tree sixty times a second, which is
 * the exact mistake that cost the retired lane-war stage its frame pacing.
 *
 * The rule is NOT disabled for anything else. React state, refs read during
 * render, and memoized values are all handled properly: the playback clock is
 * passed down as a ref and read only inside useFrame, and the impact pool is a
 * useMemo because it IS read during render.
 */
/*
 * Beastbound Warfront.
 *
 * Eight pets fight on a deterministic formation board: hard cell ownership,
 * sight-blocking shoji, roof cover, smoke, range and role-driven abilities. The
 * camera uses an actor-first broadcast crop while preserving one trustworthy
 * screen direction: blue stays left and red stays right. Its centre and
 * distance ease toward live action instead of snapping between duels.
 *
 * Two rules this file exists to hold:
 *
 *   1. NEVER hand the renderer an integer tick. The old warfront stage floored
 *      its clock, took the floor snapshot, and then ran an exponential low-pass
 *      filter to chase the resulting 30 Hz staircase — which alternates fast and
 *      slow frames at 60fps and lags two to three frames behind truth. That was
 *      the "jittery". This stage takes a FRACTIONAL tick through a ref and
 *      interpolates between the two bracketing snapshots, so motion is exact.
 *
 *   2. React must not re-render during a clash. The clock is a ref read inside
 *      useFrame; nothing here calls setState per tick.
 *
 * The fight itself belongs to the shipped cinematic engine and is not touched.
 * This is presentation only.
 */
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type MutableRefObject } from "react";
import { Canvas, addAfterEffect, useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Pet } from "../types/pet";
import { DUEL_TPS, type DuelEvent, type DuelObjectiveId, type DuelObjectiveSnap, type DuelResult } from "../lib/pet-duel-sim";
import {
    WARFRONT_ARENA_X,
    WARFRONT_ARENA_Y,
} from "../lib/pet-duel-cinematic";
import { petCombatModel } from "../lib/pet-3d-models";
import { petHeroMoveAt, petHeroMoveStyle, petHeroMoveWindows, type PetHeroMoveStyle } from "../lib/pet-hero-moves";
import { fitDistance } from "../lib/showdown-camera";
import {
    RITE_TEAM_COLOR as TEAM_COLOR,
    RITE_WORLD_SCALE as WORLD_SCALE,
    actionFocus,
    allRiteFighterModelsReady,
    bucketEvents,
    createActorPoseSample,
    elementColor,
    riteGroundingAoCameraForwardOffset,
    riteGroundingFocusStrength,
    sampleActor,
    sampleActorByIdInto,
    sampleActorInto,
    sampleProjectilesInto,
    squadFocusAt,
} from "../lib/pet-warfront-rite-presentation";
import type { PetVisualQualityConfig } from "../lib/pet-visual-quality";
import {
    WARFRONT_PREFLIGHT_SAMPLE_MS,
    WARFRONT_PREFLIGHT_THRESHOLD_MS,
    WARFRONT_PREFLIGHT_WARMUP_MS,
    WARFRONT_ROUTE_STORAGE_KEY,
    initialWarfrontRuntimeRoute,
    parseWarfrontPersistedRoute,
    resolveWarfrontRigImportFailure,
    resolveWarfrontRuntimeRoute,
    resolveWarfrontVisibleRoute,
    serializeWarfrontPersistedRoute,
    warfrontCapabilityTier,
    warfront3dQaCanaryRequested,
    warfrontRenderBudget,
    type WarfrontCapabilityTier,
    type WarfrontPerformanceSample,
    type WarfrontRuntimeRoute,
} from "../lib/pet-warfront-render-budget";
import { warfrontImpostorEntry } from "../lib/pet-warfront-impostor";
import {
    ATTACK_STREAK_DURATION_MS,
    BODY_KO_EXIT_DISTANCE,
    BODY_LUNGE_DISTANCE,
    BODY_RECOIL_DISTANCE,
    authoritativeGroundingActorAt,
    createWarfrontBodyReactionPhase,
    warfrontAttackCues,
    warfrontBodyContactBeats,
    warfrontBodyReactionPhaseInto,
    warfrontContactDirection,
    type WarfrontAttackCue,
    type WarfrontBodyContactBeat,
    type WarfrontBodyReactionPhase,
} from "../lib/pet-warfront-attack-causality";
import {
    WARFRONT_HERO_AXIS_TAIL_PX,
    WARFRONT_HERO_BURST_HOLD_TICKS,
    WARFRONT_HERO_BURST_PX,
    WARFRONT_HERO_CONTACT_LAYER_COUNT,
    WARFRONT_HERO_CONTACT_TARGET_WIDTHS,
    WARFRONT_HERO_DAMAGE_HOLD_TICKS,
    WARFRONT_HERO_FIRE_CONTACT_LAYERS,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_ASYMMETRY,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_LEFT_RIGHT_REACH_RATIO,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_SOURCE_PX,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL,
    WARFRONT_HERO_FIRE_RESIDUE_LAYERS,
    WARFRONT_HERO_FIRE_VFX_GRAMMAR,
    WARFRONT_HERO_FLARE_MIN_PX,
    WARFRONT_HERO_IMPACT_HOLD_TICKS,
    WARFRONT_HERO_IMPACT_MIN_PX,
    WARFRONT_HERO_RESIDUE_LAYER_COUNT,
    WARFRONT_HERO_TRAVEL_CORE_PX,
    WARFRONT_HERO_TRAVEL_MIN_SPAN_FRACTION,
    WARFRONT_HERO_TRAVEL_PLUME_PX,
    WARFRONT_SPECTACLE_OVERLAP_CAP,
    WARFRONT_SPECTACLE_RESULT_TICKS,
    createWarfrontSpectaclePhase,
    warfrontElementSignature,
    warfrontHeroAttackCue,
    warfrontHeroAxisTailStrength,
    warfrontHeroBurstHold,
    warfrontHeroContactWidthPx,
    warfrontHeroDamageHold,
    warfrontHeroFireShape,
    warfrontHeroImpactHold,
    warfrontHeroStage,
    warfrontHeroTravelSpanFraction,
    warfrontSpectacleParticleBudget,
    warfrontSpectaclePhaseInto,
} from "../lib/pet-warfront-spectacle";

/** One rendered fighter: which side, which lane, and the pet standing in it. */
export type StageFighter = {
    team: "player" | "enemy";
    lane: number;
    pet: Pet;
    /** 0..1 health it walked in with — the bar starts here and drains. */
    entryHp: number;
};

/** Lightweight structural contract shared with the dynamically imported rig
 * implementation. Keeping it here prevents the default impostor scene from
 * acquiring a runtime edge to PetModel3D (and therefore Drei/GLTF/meshopt). */
export type WarfrontRigFrame = {
    motion: "idle" | "run" | "dash" | "windup" | "strike" | "recover" | "stagger" | "dodge" | "guard" | "rest" | "dead";
    moving: boolean;
    speed: number;
    moveX: number;
    moveZ: number;
    faceX: number;
    faceZ: number;
    lockTargetFacing?: boolean;
    freezeFacing?: boolean;
    turnRate?: number;
    maxTurnPerFrame?: number;
    hit: number;
    impactPower?: number;
    casting: boolean;
    desperate: boolean;
    statuses: readonly string[];
    victorious?: boolean;
    moveStyle?: PetHeroMoveStyle;
    moveName?: string;
    attackPace?: number;
    performanceVariant?: 0 | 1 | 2;
    entranceProgress?: number;
    timeline?: number;
};

const DEFAULT_WARFRONT_RIG_FRAME: WarfrontRigFrame = Object.freeze({
    motion: "idle",
    moving: false,
    speed: 0,
    moveX: 1,
    moveZ: 0,
    faceX: 1,
    faceZ: 0,
    lockTargetFacing: false,
    freezeFacing: false,
    hit: 0,
    impactPower: 0.55,
    casting: false,
    desperate: false,
    statuses: [],
    victorious: false,
    moveStyle: "generic",
    performanceVariant: 0,
});

export type WarfrontSkinnedModelComponent = ComponentType<{
    pet: Pet;
    frame: MutableRefObject<WarfrontRigFrame>;
    quality: PetVisualQualityConfig;
    onReady: () => void;
}>;

export type WarfrontSkinnedMetrics = Readonly<{
    lodEnabled: boolean;
    mappedActors: number;
    missingActors: number;
    sourceTriangles: number;
    selectedTriangles: number;
}>;

type WarfrontSkinnedModule = Readonly<{
    PetWarfrontSkinnedModel3D: WarfrontSkinnedModelComponent;
    warfrontSkinnedMetrics: (pets: readonly Pet[]) => WarfrontSkinnedMetrics;
}>;

const EMPTY_SKINNED_METRICS: WarfrontSkinnedMetrics = Object.freeze({
    lodEnabled: false,
    mappedActors: 0,
    missingActors: 0,
    sourceTriangles: 0,
    selectedTriangles: 0,
});

/** Only the explicit two-flag canary may warm rigs before Stage routing. The
 * default path must not even request the rig chunk, regardless of cache state. */
export async function preloadRitePetModels(pets: readonly Pet[]): Promise<void> {
    if (!warfront3dQaCanaryRequested(typeof window === "undefined" ? "" : window.location.search)) return;
    const module = await import("./PetWarfrontSkinnedModel3D");
    await module.preloadWarfrontSkinnedPetModels(pets);
}

type FighterContactBeat = WarfrontBodyContactBeat & Readonly<{
    directionX: number;
    directionZ: number;
}>;
const NO_CONTACT_BEATS: readonly FighterContactBeat[] = Object.freeze([]);

/** Select exactly one deterministic body phrase per actor. A received hit wins
 * over an outgoing lunge; a lethal continuation wins until that body is gone.
 * Both samples are caller-owned, so eight render loops create no frame garbage. */
function sampleFighterBodyReaction(
    beats: readonly FighterContactBeat[],
    tick: number,
    out: WarfrontBodyReactionPhase,
    scratch: WarfrontBodyReactionPhase,
): FighterContactBeat | null {
    let selected: FighterContactBeat | null = null;
    let selectedPriority = -1;
    let selectedTick = Number.NEGATIVE_INFINITY;
    out.active = false;
    out.lunge = 0;
    out.recoil = 0;
    out.recovery = 0;
    out.koExit = 0;
    for (let index = 0; index < beats.length; index++) {
        const beat = beats[index];
        warfrontBodyReactionPhaseInto(beat, tick, scratch);
        if (!scratch.active) continue;
        const priority = beat.role === "target" ? (beat.lethal ? 3 : 2) : 1;
        if (priority < selectedPriority || (priority === selectedPriority && beat.tick < selectedTick)) continue;
        selected = beat;
        selectedPriority = priority;
        selectedTick = beat.tick;
        out.active = scratch.active;
        out.lunge = scratch.lunge;
        out.recoil = scratch.recoil;
        out.recovery = scratch.recovery;
        out.koExit = scratch.koExit;
    }
    return selected;
}

// ── Fighter ─────────────────────────────────────────────────────────────────

/** Mounted inside the model Suspense boundary. Two render frames prove that the
 * actual GLTF rig has committed and painted behind the closed curtain. */
function ModelReadySignal({ onReady }: { onReady: () => void }) {
    const paintedFrames = useRef(0);
    const reported = useRef(false);
    useFrame(() => {
        if (reported.current || ++paintedFrames.current < 2) return;
        reported.current = true;
        onReady();
    });
    return null;
}

/** Hydrate the hidden scene in bounded painted slices. A clean navigation used
 * to ask React, WebGL shader compilation, six VFX families, the static arena,
 * and eight textures to commit in one scheduler task. The formation veil is
 * already authoritative, so distributing that one-time work over a handful of
 * frames removes bootstrap long tasks without revealing partial combat. */
function SceneHydrationSequencer({ phase, finalPhase, onAdvance }: {
    phase: number;
    finalPhase: number;
    onAdvance: (phase: number) => void;
}) {
    const observedPhase = useRef(phase);
    const paintedFrames = useRef(0);
    const advanced = useRef(false);
    useFrame(() => {
        if (observedPhase.current !== phase) {
            observedPhase.current = phase;
            paintedFrames.current = 0;
            advanced.current = false;
        }
        if (phase >= finalPhase || advanced.current || ++paintedFrames.current < 2) return;
        advanced.current = true;
        onAdvance(phase);
    });
    return null;
}

/** Warm every exact-model atlas through Three's own texture cache. The switch
 * is not allowed to occur until these assets have loaded and two frames have
 * painted behind the still-opaque formation curtain. */
function ImpostorAssetsPreloader({ urls, onReady }: { urls: readonly string[]; onReady: () => void }) {
    useLoader(THREE.TextureLoader, urls as string[]);
    const paintedFrames = useRef(0);
    const reported = useRef(false);
    useFrame(() => {
        if (reported.current || ++paintedFrames.current < 2) return;
        reported.current = true;
        onReady();
    });
    return null;
}

type PreflightWindow = {
    startedAt: number;
    warmupEnds: number;
    sampleEnds: number;
    lastFrameAt: number | null;
    frameGaps: number;
    frameGapMax: number;
    longTasks: number;
    longTaskMax: number;
};

/** Samples only the fully hydrated eight-rig renderer. Page/bootstrap work is
 * excluded by construction: the observer starts after both rig and impostor
 * readiness, then ignores a bounded warmup before measuring. */
function RuntimePerformancePreflight({ enabled, probeClockRef, probeStressRef, probeStartTick, probeEndTick, onComplete }: {
    enabled: boolean;
    probeClockRef: MutableRefObject<number>;
    probeStressRef: MutableRefObject<boolean>;
    probeStartTick: number;
    probeEndTick: number;
    onComplete: (sample: WarfrontPerformanceSample) => void;
}) {
    const gl = useThree((state) => state.gl);
    const windowRef = useRef<PreflightWindow | null>(null);
    const observerRef = useRef<PerformanceObserver | null>(null);
    const timerRef = useRef<number | null>(null);
    const completed = useRef(false);
    const finishRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (!enabled) return;
        completed.current = false;
        probeStressRef.current = true;
        const startedAt = performance.now();
        const sampleWindow: PreflightWindow = {
            startedAt,
            warmupEnds: startedAt + WARFRONT_PREFLIGHT_WARMUP_MS,
            sampleEnds: startedAt + WARFRONT_PREFLIGHT_WARMUP_MS + WARFRONT_PREFLIGHT_SAMPLE_MS,
            lastFrameAt: null,
            frameGaps: 0,
            frameGapMax: 0,
            longTasks: 0,
            longTaskMax: 0,
        };
        windowRef.current = sampleWindow;
        const context = gl.getContext();
        // An opaque DOM curtain can let Chromium occlusion-cull presentation
        // work even though R3F still issues frames. Force the actual WebGL
        // command stream to finish after every hidden probe render so this
        // predicts the cost of the same canvas once it becomes visible.
        const removeAfterEffect = addAfterEffect(() => {
            if (completed.current || !windowRef.current) return;
            const began = performance.now();
            context.finish();
            const elapsed = performance.now() - began;
            if (performance.now() >= sampleWindow.warmupEnds) {
                sampleWindow.frameGapMax = Math.max(sampleWindow.frameGapMax, elapsed);
            }
        });
        const recordLongTasks = (entries: PerformanceEntryList) => {
            for (const entry of entries) {
                if (entry.startTime < sampleWindow.warmupEnds || entry.startTime >= sampleWindow.sampleEnds
                    || entry.duration <= WARFRONT_PREFLIGHT_THRESHOLD_MS) continue;
                sampleWindow.longTasks++;
                sampleWindow.longTaskMax = Math.max(sampleWindow.longTaskMax, entry.duration);
            }
        };
        if (typeof PerformanceObserver !== "undefined") {
            const observer = new PerformanceObserver((list) => recordLongTasks(list.getEntries()));
            observer.observe({ type: "longtask", buffered: false });
            observerRef.current = observer;
        }
        const finish = () => {
            if (completed.current) return;
            completed.current = true;
            probeStressRef.current = false;
            probeClockRef.current = 0;
            const observer = observerRef.current;
            if (observer) recordLongTasks(observer.takeRecords());
            observer?.disconnect();
            observerRef.current = null;
            const now = Math.min(performance.now(), sampleWindow.sampleEnds);
            if (sampleWindow.lastFrameAt !== null && now > sampleWindow.warmupEnds) {
                const trailingGap = now - Math.max(sampleWindow.lastFrameAt, sampleWindow.warmupEnds);
                sampleWindow.frameGapMax = Math.max(sampleWindow.frameGapMax, trailingGap);
                if (trailingGap > WARFRONT_PREFLIGHT_THRESHOLD_MS) sampleWindow.frameGaps++;
            }
            onComplete({
                durationMs: WARFRONT_PREFLIGHT_SAMPLE_MS,
                frameGapsOver100ms: sampleWindow.frameGaps,
                frameGapMaxMs: sampleWindow.frameGapMax,
                longTasksOver100ms: sampleWindow.longTasks,
                longTaskMaxMs: sampleWindow.longTaskMax,
            });
        };
        finishRef.current = finish;
        timerRef.current = window.setTimeout(finish, WARFRONT_PREFLIGHT_WARMUP_MS + WARFRONT_PREFLIGHT_SAMPLE_MS + 40);
        return () => {
            probeStressRef.current = false;
            probeClockRef.current = 0;
            removeAfterEffect();
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
            timerRef.current = null;
            observerRef.current?.disconnect();
            observerRef.current = null;
            windowRef.current = null;
            finishRef.current = null;
        };
    }, [enabled, gl, onComplete, probeClockRef, probeStressRef]);
    useFrame(() => {
        const sampleWindow = windowRef.current;
        if (!enabled || !sampleWindow || completed.current) return;
        const now = performance.now();
        // Exercise the real first authored action family while the formation is
        // still behind the curtain. The parent-owned simulation clock stays at
        // zero; only this scene-local presentation ref advances, then resets
        // before onReady can reveal a frame.
        const actionElapsedMs = Math.max(0, now - sampleWindow.warmupEnds);
        probeClockRef.current = Math.min(probeEndTick, probeStartTick + actionElapsedMs * DUEL_TPS / 1_000);
        const previous = sampleWindow.lastFrameAt;
        sampleWindow.lastFrameAt = now;
        if (previous !== null && now > sampleWindow.warmupEnds && previous < sampleWindow.sampleEnds) {
            const gap = Math.min(now, sampleWindow.sampleEnds) - Math.max(previous, sampleWindow.warmupEnds);
            if (gap > 0) {
                sampleWindow.frameGapMax = Math.max(sampleWindow.frameGapMax, gap);
                if (gap > WARFRONT_PREFLIGHT_THRESHOLD_MS) sampleWindow.frameGaps++;
            }
        }
        if (now >= sampleWindow.sampleEnds) finishRef.current?.();
    });
    return null;
}

/** Chromium may defer some canvas/compositor work until the opaque curtain is
 * gone. A route that passed the forced hidden proof therefore remains
 * provisional for one bounded, real combat window. The first >100 ms renderer
 * gap ends the window immediately so the switch can be veiled before another
 * action; a clean window is the only way hardware earns a persisted 3D route. */
function RuntimeVisibleRouteValidation({ enabled, clockRef, onComplete }: {
    enabled: boolean;
    clockRef: MutableRefObject<number>;
    onComplete: (sample: WarfrontPerformanceSample) => void;
}) {
    const windowRef = useRef<PreflightWindow | null>(null);
    const observerRef = useRef<PerformanceObserver | null>(null);
    const timerRef = useRef<number | null>(null);
    const completed = useRef(false);
    const finishRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        if (enabled) completed.current = false;
        return () => {
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
            timerRef.current = null;
            observerRef.current?.disconnect();
            observerRef.current = null;
            windowRef.current = null;
            finishRef.current = null;
        };
    }, [enabled]);
    useFrame(() => {
        if (!enabled || completed.current || clockRef.current <= 0) return;
        let sampleWindow = windowRef.current;
        if (!sampleWindow) {
            const startedAt = performance.now();
            sampleWindow = {
                startedAt,
                warmupEnds: startedAt,
                sampleEnds: startedAt + WARFRONT_PREFLIGHT_SAMPLE_MS,
                lastFrameAt: startedAt,
                frameGaps: 0,
                frameGapMax: 0,
                longTasks: 0,
                longTaskMax: 0,
            };
            windowRef.current = sampleWindow;
            const finish = () => {
                if (completed.current || !windowRef.current) return;
                completed.current = true;
                const observer = observerRef.current;
                if (observer) {
                    for (const entry of observer.takeRecords()) {
                        if (entry.startTime < sampleWindow!.startedAt || entry.startTime >= sampleWindow!.sampleEnds
                            || entry.duration <= WARFRONT_PREFLIGHT_THRESHOLD_MS) continue;
                        sampleWindow!.longTasks++;
                        sampleWindow!.longTaskMax = Math.max(sampleWindow!.longTaskMax, entry.duration);
                    }
                }
                observer?.disconnect();
                observerRef.current = null;
                if (timerRef.current !== null) window.clearTimeout(timerRef.current);
                timerRef.current = null;
                onComplete({
                    durationMs: Math.min(WARFRONT_PREFLIGHT_SAMPLE_MS, performance.now() - sampleWindow!.startedAt),
                    frameGapsOver100ms: sampleWindow!.frameGaps,
                    frameGapMaxMs: sampleWindow!.frameGapMax,
                    longTasksOver100ms: sampleWindow!.longTasks,
                    longTaskMaxMs: sampleWindow!.longTaskMax,
                });
            };
            finishRef.current = finish;
            if (typeof PerformanceObserver !== "undefined") {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.startTime < sampleWindow!.startedAt || entry.startTime >= sampleWindow!.sampleEnds
                            || entry.duration <= WARFRONT_PREFLIGHT_THRESHOLD_MS) continue;
                        sampleWindow!.longTasks++;
                        sampleWindow!.longTaskMax = Math.max(sampleWindow!.longTaskMax, entry.duration);
                    }
                    if (sampleWindow!.longTaskMax > WARFRONT_PREFLIGHT_THRESHOLD_MS) finishRef.current?.();
                });
                observer.observe({ type: "longtask", buffered: false });
                observerRef.current = observer;
            }
            timerRef.current = window.setTimeout(finish, WARFRONT_PREFLIGHT_SAMPLE_MS + 40);
            return;
        }
        const now = performance.now();
        const gap = now - (sampleWindow.lastFrameAt ?? now);
        sampleWindow.lastFrameAt = now;
        sampleWindow.frameGapMax = Math.max(sampleWindow.frameGapMax, gap);
        if (gap > WARFRONT_PREFLIGHT_THRESHOLD_MS) {
            sampleWindow.frameGaps++;
            finishRef.current?.();
        } else if (now >= sampleWindow.sampleEnds) finishRef.current?.();
    });
    return null;
}

/** Observe the renderer-owned canvas without installing another render loop. */
function RendererContextGuard({ onLost, onRestored }: { onLost: () => void; onRestored: () => void }) {
    const gl = useThree((state) => state.gl);
    const invalidate = useThree((state) => state.invalidate);
    const restoredFrames = useRef(-1);
    useFrame(() => {
        if (restoredFrames.current < 0) return;
        restoredFrames.current += 1;
        if (restoredFrames.current < 2) return;
        restoredFrames.current = -1;
        onRestored();
    });
    useEffect(() => {
        const canvas = gl.domElement;
        const handleLost = (event: Event) => {
            // Opt in to browser restoration. Combat pauses in the parent until
            // either this context returns or a clean Canvas is rebuilt.
            event.preventDefault();
            onLost();
        };
        const handleRestored = () => {
            // A restored context is not yet a painted battle view. Keep the
            // pause overlay up until two real R3F frames have completed.
            restoredFrames.current = 0;
            invalidate();
        };
        canvas.addEventListener("webglcontextlost", handleLost, false);
        canvas.addEventListener("webglcontextrestored", handleRestored, false);
        return () => {
            restoredFrames.current = -1;
            canvas.removeEventListener("webglcontextlost", handleLost, false);
            canvas.removeEventListener("webglcontextrestored", handleRestored, false);
        };
    }, [gl, invalidate, onLost, onRestored]);
    return null;
}

function RiteFighter3D({ result, fighter, clockRef, victorious, quality, contactBeats, performanceProbeRef, SkinnedModel, onModelReady }: {
    result: DuelResult;
    fighter: StageFighter;
    clockRef: MutableRefObject<number>;
    victorious: MutableRefObject<{ player: boolean; enemy: boolean }>;
    quality: PetVisualQualityConfig;
    contactBeats: readonly FighterContactBeat[];
    performanceProbeRef: MutableRefObject<boolean>;
    SkinnedModel: WarfrontSkinnedModelComponent;
    onModelReady: (fighterId: string) => void;
}) {
    const { team, lane, pet, entryHp } = fighter;
    const sourceConfig = useMemo(() => petCombatModel(pet), [pet]);
    const fighterId = `${team}-${lane}`;
    const facing = team === "player" ? 1 : -1;
    // Seed both the scene transform and model-performance ref from the same
    // authoritative snapshot. A cache-hot child may run before its parent's
    // first useFrame subscription; even that frame must still be tick zero.
    const initialPose = useMemo(() => sampleActor(result, team, lane, 0), [result, team, lane]);
    const initialFaceLength = Math.hypot(initialPose.faceX, initialPose.faceZ);
    const initialFaceX = initialFaceLength > 0.01 ? initialPose.faceX / initialFaceLength : facing;
    const initialFaceZ = initialFaceLength > 0.01 ? initialPose.faceZ / initialFaceLength : 0;
    const root = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const frame = useRef<WarfrontRigFrame>({
        ...DEFAULT_WARFRONT_RIG_FRAME,
        faceX: initialFaceX,
        faceZ: initialFaceZ,
        lockTargetFacing: false,
        hit: 0,
        statuses: initialPose.statuses,
        entranceProgress: 1,
        timeline: 0,
    });
    const lastHp = useRef(initialPose.maxHp > 0 ? initialPose.hp / initialPose.maxHp : 0);
    const poseSample = useRef(createActorPoseSample());
    const priorPoseSample = useRef(createActorPoseSample());
    const nextPoseSample = useRef(createActorPoseSample());
    const targetPoseSample = useRef(createActorPoseSample());
    const smoothedSpeed = useRef(0);
    const impactPower = useRef(0.58);
    const locomotionActive = useRef(false);
    const lastMoveFacing = useRef<{ x: number; z: number }>({ x: team === "player" ? 1 : -1, z: 0 });
    const lastFacing = useRef<{ x: number; z: number }>({ x: initialFaceX, z: initialFaceZ });
    const deathAt = useRef<number | null>(null);
    const terminalTimeline = useRef<{ wall: number; base: number } | null>(null);
    const visualTick = useRef(-1);
    const contactCursor = useRef(0);
    const contactHoldFrames = useRef(0);
    const latestContact = useRef<FighterContactBeat | null>(null);
    const bodyReaction = useRef(createWarfrontBodyReactionPhase());
    const bodyReactionScratch = useRef(createWarfrontBodyReactionPhase());
    const heroMoveWindows = useMemo(
        () => petHeroMoveWindows(result.events, fighterId, { id: pet.id, name: pet.name, profile: sourceConfig?.profile }),
        [sourceConfig?.profile, fighterId, pet.id, pet.name, result.events],
    );
    const fallbackMoveStyle = useMemo(
        () => petHeroMoveStyle({ petId: pet.id, petName: pet.name, profile: sourceConfig?.profile }),
        [sourceConfig?.profile, pet.id, pet.name],
    );
    // Four active pets need a little negative space between adjacent cells. Keep
    // the shipped rigs heroic, but never let long tails erase formation reads.
    const scale = sourceConfig ? Math.min(1.08, 1.7 / Math.max(0.1, sourceConfig.targetHeight)) : 0.94;
    const height = sourceConfig ? sourceConfig.targetHeight * scale : 1.25;
    // Give React Three Fiber the authoritative committed pose immediately.
    // `useFrame` continues from this same tick-zero point, so even the first
    // painted frame cannot briefly stack all eight roots at world origin.
    const reportModelReady = useCallback(() => onModelReady(fighterId), [fighterId, onModelReady]);

    useFrame((state, delta) => {
        const group = root.current;
        if (!group) return;
        const t = clockRef.current;
        const priorVisualTick = visualTick.current;
        const restarted = priorVisualTick >= 0 && t < priorVisualTick - 0.5;
        visualTick.current = t;
        if (restarted) {
            deathAt.current = null;
            terminalTimeline.current = null;
            lastHp.current = initialPose.maxHp > 0 ? initialPose.hp / initialPose.maxHp : 0;
            smoothedSpeed.current = 0;
            impactPower.current = 0.58;
            locomotionActive.current = false;
            lastMoveFacing.current.x = facing;
            lastMoveFacing.current.z = 0;
            lastFacing.current.x = initialFaceX;
            lastFacing.current.z = initialFaceZ;
            contactCursor.current = 0;
            contactHoldFrames.current = 0;
            latestContact.current = null;
        }
        while (contactCursor.current < contactBeats.length && contactBeats[contactCursor.current].tick <= t) {
            const beat = contactBeats[contactCursor.current++];
            if (restarted || priorVisualTick < 0 || beat.tick > priorVisualTick + 1e-4) {
                // A target reaction wins if this fighter both deals and receives
                // damage on the same authoritative tick.
                if (!latestContact.current || latestContact.current.tick !== beat.tick || beat.role === "target") {
                    latestContact.current = beat;
                }
                contactHoldFrames.current = 2;
            }
        }
        const heldContact = contactHoldFrames.current > 0 ? latestContact.current : null;
        const pose = sampleActorInto(result, team, lane, t, poseSample.current);
        group.position.x = pose.x * WORLD_SCALE;
        group.position.z = pose.z * WORLD_SCALE;

        const previous = lastHp.current;
        const hpFrac = pose.maxHp > 0 ? pose.hp / pose.maxHp : 0;
        const down = pose.hp <= 0 || pose.state === "dead";

        // Simulation time correctly stops on the terminal snapshot. Continue a
        // presentation-only clock so KO settles and victory clips do not freeze
        // at age zero; authoritative positions and combat state remain frozen.
        const baseTimeline = t / DUEL_TPS;
        if (t >= result.ticks - 0.001) {
            if (!terminalTimeline.current) terminalTimeline.current = { wall: state.clock.elapsedTime, base: baseTimeline };
        } else terminalTimeline.current = null;
        const presentationTimeline = terminalTimeline.current
            ? terminalTimeline.current.base + Math.max(0, state.clock.elapsedTime - terminalTimeline.current.wall)
            : baseTimeline;
        const reactionTick = presentationTimeline * DUEL_TPS;
        const activeContact = sampleFighterBodyReaction(
            contactBeats,
            reactionTick,
            bodyReaction.current,
            bodyReactionScratch.current,
        );
        if (down && deathAt.current === null) deathAt.current = presentationTimeline;

        // A trailing replay tangent cannot reveal future movement while the
        // formation clock is held at zero. It also avoids a direction change
        // one tick before the authored path actually turns.
        const beforeTick = Math.max(0, t - 0.7);
        const afterTick = t;
        const prior = sampleActorInto(result, team, lane, beforeTick, priorPoseSample.current);
        const next = sampleActorInto(result, team, lane, afterTick, nextPoseSample.current);
        const tangentSeconds = (afterTick - beforeTick) / DUEL_TPS;
        const vx = tangentSeconds > 1e-4 ? (next.x - prior.x) / tangentSeconds : 0;
        const vz = tangentSeconds > 1e-4 ? (next.z - prior.z) / tangentSeconds : 0;
        const rawSpeed = Math.hypot(vx, vz);
        if (rawSpeed > 0.05) {
            lastMoveFacing.current.x = vx / rawSpeed;
            lastMoveFacing.current.z = vz / rawSpeed;
        }
        const speedResponse = 1 - Math.exp(-10 * Math.min(delta, 1 / 15));
        smoothedSpeed.current = THREE.MathUtils.lerp(smoothedSpeed.current, rawSpeed, speedResponse);
        const speed = smoothedSpeed.current;

        let opponentFacingX = pose.faceX;
        let opponentFacingZ = pose.faceZ;
        let hasLiveTarget = false;
        if (pose.targetId) {
            const targetPose = sampleActorByIdInto(result, pose.targetId, t, targetPoseSample.current);
            const dx = targetPose.x - pose.x;
            const dz = targetPose.z - pose.z;
            const length = Math.hypot(dx, dz);
            if (targetPose.hp > 0 && length > 0.02) {
                hasLiveTarget = true;
                opponentFacingX = dx / length;
                opponentFacingZ = dz / length;
            }
        }

        const committed = pose.state === "windup" || pose.state === "strike" || pose.state === "recover";
        const rotationFrozen = down || pose.state === "stagger";
        if (down || committed || pose.state === "stagger") locomotionActive.current = false;
        else if (speed > 0.58) locomotionActive.current = true;
        else if (speed < 0.16) locomotionActive.current = false;
        const moving = !down && !committed && pose.state !== "stagger" && locomotionActive.current;

        let desiredFacingX = opponentFacingX;
        let desiredFacingZ = opponentFacingZ;
        // Travel owns ordinary locomotion; the opponent owns anticipation,
        // contact, and recovery. Dead/staggered actors retain their last yaw.
        if (moving && rawSpeed > 0.05 && !hasLiveTarget) {
            desiredFacingX = lastMoveFacing.current.x;
            desiredFacingZ = lastMoveFacing.current.z;
        }
        if (Math.hypot(desiredFacingX, desiredFacingZ) < 0.05) {
            desiredFacingX = lastFacing.current.x;
            desiredFacingZ = lastFacing.current.z;
        } else if (!rotationFrozen) {
            const desiredLength = Math.hypot(desiredFacingX, desiredFacingZ);
            lastFacing.current.x = desiredFacingX / desiredLength;
            lastFacing.current.z = desiredFacingZ / desiredLength;
        }

        const f = frame.current;
        f.motion = down ? "dead"
            : heldContact?.role === "target" ? "stagger"
            : heldContact?.role === "attacker" ? "strike"
            : pose.state === "windup" ? "windup"
            : pose.state === "strike" ? "strike"
            : pose.state === "recover" ? "recover"
            : pose.state === "dash" ? "dash"
            : pose.state === "stagger" ? "stagger"
            : pose.state === "dodge" ? "dodge"
            : moving ? "run" : "idle";
        f.moving = moving;
        f.speed = Math.min(9, speed);
        f.moveX = lastMoveFacing.current.x;
        f.moveZ = lastMoveFacing.current.z;
        f.faceX = desiredFacingX;
        f.faceZ = desiredFacingZ;
        f.lockTargetFacing = hasLiveTarget || committed || !moving;
        f.freezeFacing = rotationFrozen;
        f.turnRate = committed ? 120 : 50;
        f.maxTurnPerFrame = 55 * Math.PI / 180;
        const damageTaken = Math.max(0, previous - hpFrac);
        f.hit = damageTaken > 0.0005 ? 1 : Math.max(0, f.hit * 0.86);
        if (damageTaken > 0.0005) impactPower.current = THREE.MathUtils.clamp(0.84 + damageTaken * 4.2, 0.84, 1.24);
        else if (pose.state !== "stagger") impactPower.current = THREE.MathUtils.lerp(impactPower.current, 0.58, 0.16);
        f.impactPower = pose.state === "strike" ? 1.04 : impactPower.current;
        f.casting = pose.state === "windup";
        f.desperate = !down && hpFrac * entryHp < 0.3;
        f.statuses = pose.statuses;
        f.victorious = victorious.current[team] && !down;
        const heroMove = petHeroMoveAt(heroMoveWindows, t);
        f.moveStyle = heroMove?.style ?? fallbackMoveStyle;
        f.moveName = heroMove?.move;
        // Hold the exact contact sample for two PAINTED frames. This is local to
        // the authored pose: the simulation clock and X/Z interpolation continue
        // untouched, so hit-stop cannot manufacture a gameplay hitch or jump.
        f.timeline = heldContact ? heldContact.tick / DUEL_TPS : presentationTimeline;
        if (performanceProbeRef.current) {
            // Drive every hydrated rig through the same worst-case authored
            // action-family churn. This is presentation-only and happens while
            // the parent simulation remains frozen behind the curtain.
            const stressPhase = Math.floor(state.clock.elapsedTime * 5) % 4;
            f.motion = stressPhase === 0 ? "windup"
                : stressPhase === 1 ? "strike"
                    : stressPhase === 2 ? "stagger"
                        : "recover";
            f.moving = false;
            f.casting = stressPhase === 0;
            f.hit = stressPhase === 2 ? 1 : 0;
            f.lockTargetFacing = true;
            f.timeline = state.clock.elapsedTime;
        }
        lastHp.current = hpFrac;

        if (body.current) {
            const fade = deathAt.current === null ? 0 : Math.min(1, Math.max(0, (presentationTimeline - deathAt.current) / 0.9));
            // Warfront keeps the exact authored clip, then adds one bold
            // centre-of-mass phrase around its authoritative state edge. The
            // outer group never changes X/Z, so stronger anticipation/contact
            // cannot create foot sliding or violate snapshot interpolation.
            const reaction = bodyReaction.current;
            const targetReaction = activeContact?.role === "target";
            const attackerReaction = activeContact?.role === "attacker";
            const bodyMotion = performanceProbeRef.current ? f.motion
                : heldContact?.role === "target" ? "stagger"
                : heldContact?.role === "attacker" ? "strike"
                    : pose.state;
            let actionScaleXz = bodyMotion === "windup" ? 1.07
                : bodyMotion === "strike" ? 0.94
                    : bodyMotion === "recover" ? 1.025
                        : bodyMotion === "stagger" ? 1.055
                            : 1;
            let actionScaleY = bodyMotion === "windup" ? 0.87
                : bodyMotion === "strike" ? 1.12
                    : bodyMotion === "recover" ? 0.96
                        : bodyMotion === "stagger" ? 0.89
                            : 1;
            let actionLift = bodyMotion === "windup" ? -height * 0.035
                : bodyMotion === "strike" ? height * 0.055
                    : bodyMotion === "stagger" ? -height * 0.025
                        : 0;
            if (attackerReaction) {
                actionScaleXz = THREE.MathUtils.lerp(1.04, 0.91, reaction.lunge);
                actionScaleY = THREE.MathUtils.lerp(0.9, 1.12, reaction.lunge);
                actionLift = height * 0.08 * reaction.lunge;
            } else if (targetReaction) {
                actionScaleXz = 1 + reaction.recoil * 0.09 - reaction.koExit * 0.12;
                actionScaleY = 1 - reaction.recoil * 0.13 - reaction.koExit * 0.18;
                actionLift = -height * (reaction.recoil * 0.04 + reaction.koExit * 0.22);
            }
            const presentationDistance = reaction.lunge * BODY_LUNGE_DISTANCE
                + reaction.recoil * BODY_RECOIL_DISTANCE
                + reaction.koExit * BODY_KO_EXIT_DISTANCE;
            const offsetX = activeContact ? activeContact.directionX * presentationDistance : 0;
            const offsetZ = activeContact ? activeContact.directionZ * presentationDistance : 0;
            const deathScale = Math.max(0.001, 1 - fade * 0.35);
            body.current.position.set(offsetX, -fade * height * 0.45 + actionLift, offsetZ);
            body.current.scale.set(actionScaleXz * deathScale, actionScaleY * deathScale, actionScaleXz * deathScale);
            const directionalTilt = reaction.lunge * 0.12 + reaction.recoil * 0.24 + reaction.koExit * 0.58;
            body.current.rotation.x = activeContact ? activeContact.directionZ * directionalTilt : 0;
            body.current.rotation.z = activeContact
                ? -activeContact.directionX * directionalTilt
                : bodyMotion === "stagger" ? (team === "player" ? -0.11 : 0.11) : 0;
            body.current.visible = fade < 0.995;
        }
        if (contactHoldFrames.current > 0) contactHoldFrames.current -= 1;
    });

    return (
        <group ref={root} position={[initialPose.x * WORLD_SCALE, 0, initialPose.z * WORLD_SCALE]}>
            <group ref={body}>
                {sourceConfig ? (
                    <group scale={scale}>
                        <SkinnedModel pet={pet} frame={frame} quality={quality} onReady={reportModelReady} />
                    </group>
                ) : null}
            </group>
        </group>
    );
}

const IMPOSTOR_ATLAS_COLUMNS = 4;
const IMPOSTOR_ATLAS_ROWS = 4;
function criticalSoftwareImpostorUrl(pet: Pet): string | null {
    const sourceUrl = petCombatModel(pet)?.url;
    return sourceUrl ? warfrontImpostorEntry(sourceUrl)?.atlasUrl ?? null : null;
}

/** Software WebGL cannot submit even one 10k-triangle pet inside 100ms on the
 * QA renderer. This exact-model offline atlas retains authored clip poses and
 * texture identity while the authoritative root, facing, hit and KO timing are
 * still sampled every rendered frame. Hardware and real phones never use it. */
function SoftwareRiteFighter3D({ result, fighter, clockRef, impostorUrl, contactBeats, onModelReady }: {
    result: DuelResult;
    fighter: StageFighter;
    clockRef: MutableRefObject<number>;
    impostorUrl: string;
    contactBeats: readonly FighterContactBeat[];
    onModelReady: (fighterId: string) => void;
}) {
    const { team, lane, pet } = fighter;
    const fighterId = `${team}-${lane}`;
    const config = useMemo(() => petCombatModel(pet), [pet]);
    const sourceTexture = useLoader(THREE.TextureLoader, impostorUrl);
    const texture = useMemo(() => {
        const clone = sourceTexture.clone();
        clone.colorSpace = THREE.SRGBColorSpace;
        clone.wrapS = THREE.ClampToEdgeWrapping;
        clone.wrapT = THREE.ClampToEdgeWrapping;
        clone.generateMipmaps = false;
        clone.minFilter = THREE.LinearFilter;
        clone.magFilter = THREE.LinearFilter;
        clone.repeat.set(1 / IMPOSTOR_ATLAS_COLUMNS, 1 / IMPOSTOR_ATLAS_ROWS);
        clone.needsUpdate = true;
        return clone;
    }, [sourceTexture]);
    useEffect(() => () => texture.dispose(), [texture]);
    const root = useRef<THREE.Group>(null);
    const sprite = useRef<THREE.Mesh>(null);
    const poseSample = useRef(createActorPoseSample());
    const priorSample = useRef(createActorPoseSample());
    const nextSample = useRef(createActorPoseSample());
    const targetSample = useRef(createActorPoseSample());
    const lastState = useRef("");
    const stateSince = useRef(0);
    const lastFrame = useRef(-1);
    const lastFacingSign = useRef(team === "player" ? 1 : -1);
    const visualTick = useRef(-1);
    const contactCursor = useRef(0);
    const contactHoldFrames = useRef(0);
    const latestContact = useRef<FighterContactBeat | null>(null);
    const bodyReaction = useRef(createWarfrontBodyReactionPhase());
    const bodyReactionScratch = useRef(createWarfrontBodyReactionPhase());
    const terminalTimeline = useRef<{ wall: number; baseTick: number } | null>(null);
    const cameraRight = useMemo(() => new THREE.Vector3(), []);
    const height = config?.targetHeight ? Math.min(1.7, config.targetHeight * 1.08) : 1.5;
    const initialPose = useMemo(() => sampleActor(result, team, lane, 0), [lane, result, team]);
    const heroMoveWindows = useMemo(
        () => petHeroMoveWindows(result.events, fighterId, { id: pet.id, name: pet.name, profile: config?.profile }),
        [config?.profile, fighterId, pet.id, pet.name, result.events],
    );
    const reportReady = useCallback(() => onModelReady(fighterId), [fighterId, onModelReady]);

    useFrame(({ camera, clock }) => {
        const group = root.current;
        const plane = sprite.current;
        if (!group || !plane) return;
        const t = clockRef.current;
        const priorVisualTick = visualTick.current;
        const restarted = priorVisualTick >= 0 && t < priorVisualTick - 0.5;
        visualTick.current = t;
        if (restarted) {
            contactCursor.current = 0;
            contactHoldFrames.current = 0;
            latestContact.current = null;
            terminalTimeline.current = null;
            lastState.current = "";
            stateSince.current = 0;
            lastFrame.current = -1;
        }
        while (contactCursor.current < contactBeats.length && contactBeats[contactCursor.current].tick <= t) {
            const beat = contactBeats[contactCursor.current++];
            if (restarted || priorVisualTick < 0 || beat.tick > priorVisualTick + 1e-4) {
                if (!latestContact.current || latestContact.current.tick !== beat.tick || beat.role === "target") latestContact.current = beat;
                contactHoldFrames.current = 2;
            }
        }
        const heldContact = contactHoldFrames.current > 0 ? latestContact.current : null;
        const pose = sampleActorInto(result, team, lane, t, poseSample.current);
        group.position.set(pose.x * WORLD_SCALE, 0, pose.z * WORLD_SCALE);
        if (t >= result.ticks - 0.001) {
            if (!terminalTimeline.current) terminalTimeline.current = { wall: clock.elapsedTime, baseTick: t };
        } else terminalTimeline.current = null;
        const presentationTick = terminalTimeline.current
            ? terminalTimeline.current.baseTick + Math.max(0, clock.elapsedTime - terminalTimeline.current.wall) * DUEL_TPS
            : t;
        const activeContact = sampleFighterBodyReaction(
            contactBeats,
            presentationTick,
            bodyReaction.current,
            bodyReactionScratch.current,
        );
        if (pose.state !== lastState.current || t < stateSince.current) {
            lastState.current = pose.state;
            stateSince.current = t;
        }
        const stateAge = Math.max(0, (pose.state === "dead" ? presentationTick : t) - stateSince.current);
        const before = sampleActorInto(result, team, lane, Math.max(0, t - 0.7), priorSample.current);
        const after = sampleActorInto(result, team, lane, t, nextSample.current);
        const vx = after.x - before.x;
        const vz = after.z - before.z;
        const moving = t > 0.01 && Math.hypot(vx, vz) > 0.018 && pose.state !== "windup" && pose.state !== "strike" && pose.state !== "recover";
        let faceX = moving ? vx : pose.faceX;
        let faceZ = moving ? vz : pose.faceZ;
        if (pose.targetId) {
            const target = sampleActorByIdInto(result, pose.targetId, t, targetSample.current);
            const dx = target.x - pose.x;
            const dz = target.z - pose.z;
            if (target.hp > 0 && Math.hypot(dx, dz) > 0.02) { faceX = dx; faceZ = dz; }
        }
        cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
        const screenFacing = faceX * cameraRight.x + faceZ * cameraRight.z;
        if (screenFacing > 0.12) lastFacingSign.current = 1;
        else if (screenFacing < -0.12) lastFacingSign.current = -1;

        const heroMove = petHeroMoveAt(heroMoveWindows, t);
        const castLike = heroMove?.style.includes("cast") || heroMove?.style.includes("wave") || heroMove?.style.includes("undertow");
        const visualState = heldContact?.role === "target" ? "stagger"
            : heldContact?.role === "attacker" ? "strike"
                : pose.state;
        let frameIndex = Math.floor(t * 0.12) % 4;
        if (visualState === "dead") frameIndex = 12 + Math.min(2, Math.floor(stateAge / 7));
        else if (visualState === "stagger") frameIndex = 11;
        else if (visualState === "strike") frameIndex = heldContact ? 9 : 9 + Math.min(1, Math.floor(stateAge / 2));
        else if (visualState === "windup") frameIndex = castLike ? 15 : 8;
        else if (visualState === "recover") frameIndex = 10;
        else if (visualState === "dash" || visualState === "dodge") frameIndex = 6 + (Math.floor(t * 0.35) & 1);
        else if (moving) frameIndex = 4 + (Math.floor(t * 0.28) & 1);

        const facingSign = lastFacingSign.current;
        const atlasFacingSign = -facingSign;
        if (frameIndex !== lastFrame.current || Math.sign(texture.repeat.x) !== atlasFacingSign) {
            const column = frameIndex % IMPOSTOR_ATLAS_COLUMNS;
            const row = Math.floor(frameIndex / IMPOSTOR_ATLAS_COLUMNS);
            texture.repeat.x = atlasFacingSign / IMPOSTOR_ATLAS_COLUMNS;
            texture.offset.x = atlasFacingSign > 0
                ? column / IMPOSTOR_ATLAS_COLUMNS
                : (column + 1) / IMPOSTOR_ATLAS_COLUMNS;
            texture.offset.y = 1 - (row + 1) / IMPOSTOR_ATLAS_ROWS;
            texture.updateMatrix();
            lastFrame.current = frameIndex;
        }

        plane.quaternion.copy(camera.quaternion);
        const phase = Math.min(1, stateAge / 5);
        let scaleX = 1;
        let scaleY = 1;
        let lift = Math.sin(t * 0.24 + lane) * 0.025;
        let roll = 0;
        if (moving) {
            scaleX = 1.025;
            scaleY = 0.985;
            lift += Math.abs(Math.sin(t * 0.45)) * 0.055;
            roll = -facingSign * 0.045;
        }
        if (visualState === "windup") {
            scaleX = 1.1;
            scaleY = 0.84 + phase * 0.08;
            roll = facingSign * 0.08;
        } else if (visualState === "strike") {
            scaleX = 0.92;
            scaleY = 1.13;
            lift += Math.sin(Math.min(1, phase) * Math.PI) * 0.16;
            roll = -facingSign * 0.12;
        } else if (visualState === "recover") {
            scaleX = 1.04;
            scaleY = 0.94;
            roll = facingSign * 0.1 * (1 - phase);
        } else if (visualState === "stagger") {
            roll = facingSign * 0.25;
            scaleX = 1.08;
            scaleY = 0.88;
            lift -= height * 0.035;
        } else if (visualState === "dead") {
            const settle = Math.min(1, stateAge / 18);
            roll = facingSign * settle * 1.15;
            lift -= settle * height * 0.27;
            scaleX = 1 - settle * 0.12;
            scaleY = 1 - settle * 0.28;
        }
        const reaction = bodyReaction.current;
        const presentationDistance = reaction.lunge * BODY_LUNGE_DISTANCE
            + reaction.recoil * BODY_RECOIL_DISTANCE
            + reaction.koExit * BODY_KO_EXIT_DISTANCE;
        const bodyOffsetX = activeContact ? activeContact.directionX * presentationDistance : 0;
        const bodyOffsetZ = activeContact ? activeContact.directionZ * presentationDistance : 0;
        const screenDirection = activeContact
            ? activeContact.directionX * cameraRight.x + activeContact.directionZ * cameraRight.z
            : 0;
        if (activeContact?.role === "attacker") {
            scaleX = THREE.MathUtils.lerp(1.04, 0.91, reaction.lunge);
            scaleY = THREE.MathUtils.lerp(0.9, 1.12, reaction.lunge);
            lift += height * 0.08 * reaction.lunge;
            roll = -screenDirection * 0.14 * reaction.lunge;
        } else if (activeContact?.role === "target") {
            scaleX *= 1 + reaction.recoil * 0.09 - reaction.koExit * 0.12;
            scaleY *= 1 - reaction.recoil * 0.13 - reaction.koExit * 0.18;
            lift -= height * (reaction.recoil * 0.04 + reaction.koExit * 0.22);
            roll = -screenDirection * (reaction.recoil * 0.28 + reaction.koExit * 0.62);
        }
        const authoredOffsetX = activeContact
            ? 0
            : facingSign * (visualState === "strike" ? 0.13 : visualState === "windup" ? -0.06 : 0);
        plane.position.set(bodyOffsetX + authoredOffsetX, height * 0.62 + lift, bodyOffsetZ);
        plane.rotation.z = roll;
        plane.scale.set(height * 1.48 * scaleX, height * 1.48 * scaleY, 1);
        const material = plane.material as THREE.MeshBasicMaterial;
        material.opacity = visualState === "dead" ? Math.max(0, 1 - Math.max(0, stateAge - 18) / 10) : 1;
        plane.visible = material.opacity > 0.001;
        if (contactHoldFrames.current > 0) contactHoldFrames.current -= 1;
    });

    return (
        <group ref={root} position={[initialPose.x * WORLD_SCALE, 0, initialPose.z * WORLD_SCALE]}>
            <mesh ref={sprite} renderOrder={4}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial map={texture} transparent alphaTest={0.035} depthWrite={false} toneMapped={false} />
            </mesh>
            <ModelReadySignal onReady={reportReady} />
        </group>
    );
}

/** Team ownership and anticipation remain attached to authoritative actor
 * positions, but are submitted in four global instance families instead of
 * forty-eight per-fighter meshes/materials. */
// `reducedMotion` stays in the prop contract (callers pass it and the layer may
// need it again) but is not destructured, because nothing in the body reads it.
function FighterReadabilityLayer({ result, fighters, cues, clockRef }: {
    result: DuelResult;
    fighters: readonly StageFighter[];
    cues: readonly WarfrontAttackCue[];
    clockRef: MutableRefObject<number>;
    reducedMotion: boolean;
}) {
    const pools = useRef<THREE.InstancedMesh>(null);
    const rims = useRef<THREE.InstancedMesh>(null);
    const canvas = useThree((state) => state.gl.domElement);
    const camera = useThree((state) => state.camera);
    const viewportSize = useThree((state) => state.size);
    const transform = useMemo(() => new THREE.Object3D(), []);
    const tint = useMemo(() => new THREE.Color(), []);
    const projectedFoot = useMemo(() => new THREE.Vector3(), []);
    const projectedEdgeX = useMemo(() => new THREE.Vector3(), []);
    const projectedEdgeZ = useMemo(() => new THREE.Vector3(), []);
    const samples = useMemo(() => fighters.map(() => createActorPoseSample()), [fighters]);
    const groundingStates = useMemo(() => fighters.map(() => ({ state: "", since: 0 })), [fighters]);
    const maxActiveRings = useRef(0);
    const groundingQaEnabled = useMemo(
        () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ritemotionqa") === "1",
        [],
    );
    const shadowAlphaMap = useMemo(() => {
        const size = 32;
        const pixels = new Uint8Array(size * size * 4);
        for (let row = 0; row < size; row++) {
            for (let column = 0; column < size; column++) {
                const nx = ((column + 0.5) / size) * 2 - 1;
                const ny = ((row + 0.5) / size) * 2 - 1;
                const falloff = Math.pow(Math.max(0, 1 - Math.hypot(nx, ny)), 1.65);
                const value = Math.round(falloff * 255);
                const offset = (row * size + column) * 4;
                pixels[offset] = value;
                pixels[offset + 1] = value;
                pixels[offset + 2] = value;
                pixels[offset + 3] = 255;
            }
        }
        const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        return texture;
    }, []);
    const metrics = useMemo(() => fighters.map((fighter) => {
        const config = petCombatModel(fighter.pet);
        const scale = config ? Math.min(1.08, 1.7 / Math.max(0.1, config.targetHeight)) : 0.94;
        return {
            height: config ? config.targetHeight * scale : 1.25,
            teamColor: TEAM_COLOR[fighter.team],
        };
    }), [fighters]);

    useEffect(() => {
        canvas.dataset.riteGroundingPermanentPads = "0";
        canvas.dataset.riteGroundingWideAuras = "0";
        canvas.dataset.riteGroundingShadowMode = "feathered-ao";
        canvas.dataset.riteGroundingActiveRings = "0";
        canvas.dataset.riteGroundingMaxActiveRings = "0";
        canvas.dataset.riteGroundingIdleActors = "0";
        canvas.dataset.riteGroundingDeadActors = "0";
        canvas.dataset.riteGroundingIdleRings = "0";
        canvas.dataset.riteGroundingDeadRings = "0";
        return () => {
            delete canvas.dataset.riteGroundingPermanentPads;
            delete canvas.dataset.riteGroundingWideAuras;
            delete canvas.dataset.riteGroundingShadowMode;
            delete canvas.dataset.riteGroundingActiveRings;
            delete canvas.dataset.riteGroundingMaxActiveRings;
            delete canvas.dataset.riteGroundingIdleActors;
            delete canvas.dataset.riteGroundingDeadActors;
            delete canvas.dataset.riteGroundingIdleRings;
            delete canvas.dataset.riteGroundingDeadRings;
            delete canvas.dataset.riteGroundingSubmittedAoCount;
            delete canvas.dataset.riteGroundingSubmittedAoMaxAlpha;
            delete canvas.dataset.riteGroundingSubmittedAoMaxRadiusWorld;
            delete canvas.dataset.riteGroundingSubmittedAoMaxRadiusPx;
            delete canvas.dataset.riteGroundingSubmittedAoMaxRadiusRatio;
            delete canvas.dataset.riteGroundingSubmittedRimCount;
            delete canvas.dataset.riteGroundingSubmittedRimMaxAlpha;
            delete canvas.dataset.riteGroundingSubmittedRimMaxRadiusWorld;
            delete canvas.dataset.riteGroundingSubmittedPlanarImpactCount;
            delete canvas.dataset.riteGroundingAuthoritativeActor;
            delete canvas.dataset.riteGroundingFootprints;
            shadowAlphaMap.dispose();
        };
    }, [canvas, shadowAlphaMap]);

    useLayoutEffect(() => {
        transform.position.set(0, -100, 0);
        transform.rotation.set(0, 0, 0);
        transform.scale.setScalar(0);
        transform.updateMatrix();
        for (const mesh of [pools.current, rims.current]) {
            if (!mesh) continue;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            for (let index = 0; index < mesh.count; index++) mesh.setMatrixAt(index, transform.matrix);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
        }
    }, [transform]);

    useFrame(() => {
        const poolMesh = pools.current;
        const rimMesh = rims.current;
        if (!poolMesh || !rimMesh) return;
        const t = clockRef.current;
        let activeGroundingRings = 0;
        let idleGroundingActors = 0;
        let deadGroundingActors = 0;
        let idleGroundingRings = 0;
        let deadGroundingRings = 0;
        let submittedAoCount = 0;
        let submittedAoMaxRadiusWorld = 0;
        let submittedAoMaxRadiusPx = 0;
        let submittedAoMaxRadiusRatio = 0;
        let submittedRimCount = 0;
        let submittedRimMaxRadiusWorld = 0;
        let groundingFootprints = "";
        const cameraGroundDistance = Math.hypot(camera.position.x, camera.position.z);
        const screenDownX = cameraGroundDistance > 0 ? camera.position.x / cameraGroundDistance : 0;
        const screenDownZ = cameraGroundDistance > 0 ? camera.position.z / cameraGroundDistance : 0;
        const authoritativeGroundingActorId = authoritativeGroundingActorAt(cues, t);
        const groundingSuppressedForQa = groundingQaEnabled
            && canvas.dataset.riteGroundingQaHide === "1";
        for (let index = 0; index < fighters.length; index++) {
            const fighter = fighters[index];
            const fighterId = `${fighter.team}-${fighter.lane}`;
            const metric = metrics[index];
            const pose = sampleActorInto(result, fighter.team, fighter.lane, t, samples[index]);
            const alive = pose.hp > 0 && pose.state !== "dead";
            if (pose.state === "idle" && alive) idleGroundingActors++;
            if (!alive) deadGroundingActors++;
            const x = pose.x * WORLD_SCALE;
            const z = pose.z * WORLD_SCALE;
            const markerScale = Math.max(0.64, Math.min(0.9, metric.height * 0.5));
            const aoForwardOffset = riteGroundingAoCameraForwardOffset(fighter.pet.element, markerScale);
            const aoX = x + screenDownX * aoForwardOffset;
            const aoZ = z + screenDownZ * aoForwardOffset;
            const groundingState = groundingStates[index];
            if (groundingState.state !== pose.state || t < groundingState.since) {
                groundingState.state = pose.state;
                groundingState.since = t;
            }
            const groundingStrength = !groundingSuppressedForQa && fighterId === authoritativeGroundingActorId
                ? riteGroundingFocusStrength(pose.state, alive, t - groundingState.since)
                : 0;
            if (groundingStrength > 0.001) {
                activeGroundingRings++;
                if (pose.state === "idle") idleGroundingRings++;
                if (pose.state === "dead") deadGroundingRings++;
            }

            transform.position.set(aoX, 0.012, aoZ);
            transform.rotation.set(-Math.PI / 2, 0, 0);
            transform.scale.setScalar(alive && !groundingSuppressedForQa ? markerScale : 0);
            transform.updateMatrix();
            poolMesh.setMatrixAt(index, transform.matrix);
            if (alive && !groundingSuppressedForQa) {
                const aoRadiusWorld = markerScale * 0.28;
                submittedAoCount++;
                submittedAoMaxRadiusWorld = Math.max(submittedAoMaxRadiusWorld, aoRadiusWorld);
                submittedAoMaxRadiusRatio = Math.max(submittedAoMaxRadiusRatio, aoRadiusWorld / markerScale);
                projectedFoot.set(aoX, 0.012, aoZ).project(camera);
                projectedEdgeX.set(aoX + aoRadiusWorld, 0.012, aoZ).project(camera);
                projectedEdgeZ.set(aoX, 0.012, aoZ + aoRadiusWorld).project(camera);
                const footX = (projectedFoot.x * 0.5 + 0.5) * viewportSize.width;
                const footY = (-projectedFoot.y * 0.5 + 0.5) * viewportSize.height;
                const edgeX = (projectedEdgeX.x * 0.5 + 0.5) * viewportSize.width;
                const edgeXY = (-projectedEdgeX.y * 0.5 + 0.5) * viewportSize.height;
                const edgeZ = (projectedEdgeZ.x * 0.5 + 0.5) * viewportSize.width;
                const edgeZY = (-projectedEdgeZ.y * 0.5 + 0.5) * viewportSize.height;
                const aoRadiusPx = Math.max(Math.hypot(edgeX - footX, edgeXY - footY), Math.hypot(edgeZ - footX, edgeZY - footY));
                submittedAoMaxRadiusPx = Math.max(submittedAoMaxRadiusPx, aoRadiusPx);
                if (groundingQaEnabled) {
                    groundingFootprints += `${groundingFootprints ? ";" : ""}${fighterId},${footX.toFixed(2)},${footY.toFixed(2)},${(aoRadiusPx * 2).toFixed(2)}`;
                }
            }

            transform.position.set(x, 0.02, z);
            transform.scale.setScalar(groundingStrength > 0.001 ? markerScale : 0);
            transform.updateMatrix();
            rimMesh.setMatrixAt(index, transform.matrix);
            rimMesh.setColorAt(index, tint.set(metric.teamColor).multiplyScalar(groundingStrength));
            if (groundingStrength > 0.001) {
                submittedRimCount++;
                submittedRimMaxRadiusWorld = Math.max(submittedRimMaxRadiusWorld, markerScale * 0.17);
            }
        }
        for (const mesh of [poolMesh, rimMesh]) {
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        maxActiveRings.current = Math.max(maxActiveRings.current, activeGroundingRings);
        canvas.dataset.riteGroundingPermanentPads = "0";
        canvas.dataset.riteGroundingActiveRings = String(activeGroundingRings);
        canvas.dataset.riteGroundingMaxActiveRings = String(maxActiveRings.current);
        canvas.dataset.riteGroundingIdleActors = String(idleGroundingActors);
        canvas.dataset.riteGroundingDeadActors = String(deadGroundingActors);
        canvas.dataset.riteGroundingIdleRings = String(idleGroundingRings);
        canvas.dataset.riteGroundingDeadRings = String(deadGroundingRings);
        canvas.dataset.riteGroundingSubmittedAoCount = String(submittedAoCount);
        canvas.dataset.riteGroundingSubmittedAoMaxAlpha = submittedAoCount ? "0.420" : "0";
        canvas.dataset.riteGroundingSubmittedAoMaxRadiusWorld = submittedAoMaxRadiusWorld.toFixed(4);
        canvas.dataset.riteGroundingSubmittedAoMaxRadiusPx = submittedAoMaxRadiusPx.toFixed(3);
        canvas.dataset.riteGroundingSubmittedAoMaxRadiusRatio = submittedAoMaxRadiusRatio.toFixed(3);
        canvas.dataset.riteGroundingSubmittedRimCount = String(submittedRimCount);
        canvas.dataset.riteGroundingSubmittedRimMaxAlpha = submittedRimCount ? "0.340" : "0";
        canvas.dataset.riteGroundingSubmittedRimMaxRadiusWorld = submittedRimMaxRadiusWorld.toFixed(4);
        canvas.dataset.riteGroundingSubmittedPlanarImpactCount = "0";
        canvas.dataset.riteGroundingAuthoritativeActor = authoritativeGroundingActorId ?? "";
        if (groundingQaEnabled) canvas.dataset.riteGroundingFootprints = groundingFootprints;
    });

    return (
        <group name="wfr-batched-fighter-readability">
            <instancedMesh ref={pools} args={[undefined, undefined, fighters.length]} frustumCulled={false} renderOrder={1}>
                <circleGeometry args={[0.28, 24]} />
                <meshBasicMaterial color="#071112" alphaMap={shadowAlphaMap} transparent opacity={0.42} depthWrite={false} toneMapped={false} />
            </instancedMesh>
            <instancedMesh ref={rims} args={[undefined, undefined, fighters.length]} frustumCulled={false} renderOrder={2}>
                <ringGeometry args={[0.165, 0.17, 32]} />
                <meshBasicMaterial vertexColors transparent opacity={0.34} depthWrite={false} toneMapped={false} />
            </instancedMesh>
        </group>
    );
}

const ATTACK_CAUSALITY_CAPACITY = WARFRONT_SPECTACLE_OVERLAP_CAP;
const ATTACK_PARTICLES_PER_CUE = 4;
const KAGE_SLATE_TEXTURE_URL = "/assets/warfront/kage-tactics-slate-v1.webp";

// Begin the one route-specific network/decode warm as soon as the WebGL stage
// chunk is requested. The live layer consumes this same useLoader cache entry.
useLoader.preload(THREE.TextureLoader, WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL);

function worldUnitsPerScreenPixel(
    camera: THREE.Camera,
    point: THREE.Vector3,
    pixelHeight: number,
    cameraSpace: THREE.Vector3,
): number {
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        const perspective = camera as THREE.PerspectiveCamera;
        cameraSpace.copy(point).applyMatrix4(camera.matrixWorldInverse);
        const depth = Math.max(0.01, -cameraSpace.z);
        return 2 * depth * Math.tan(THREE.MathUtils.degToRad(perspective.fov) * 0.5)
            / Math.max(1, pixelHeight);
    }
    const orthographic = camera as THREE.OrthographicCamera;
    if (orthographic.isOrthographicCamera) {
        return (orthographic.top - orthographic.bottom) / Math.max(0.01, orthographic.zoom)
            / Math.max(1, pixelHeight);
    }
    return 1 / Math.max(1, pixelHeight);
}

function createHeroFireCrownShapes(): THREE.Shape[] {
    const outer = new THREE.Shape();
    outer.moveTo(-0.5, -0.38);
    outer.bezierCurveTo(-0.51, -0.06, -0.48, 0.18, -0.32, 0.4);
    outer.bezierCurveTo(-0.34, 0.08, -0.22, -0.04, -0.16, -0.15);
    outer.bezierCurveTo(-0.19, 0.11, -0.1, 0.4, -0.01, 0.5);
    outer.bezierCurveTo(0.08, 0.3, 0.06, 0.03, 0.13, -0.11);
    outer.bezierCurveTo(0.18, 0.12, 0.31, 0.36, 0.38, 0.42);
    outer.bezierCurveTo(0.36, 0.1, 0.52, -0.08, 0.5, -0.37);
    outer.quadraticCurveTo(0, -0.5, -0.5, -0.38);
    outer.closePath();
    const sideLicks = [-0.39, 0.4].map((offset, index) => {
        const lick = new THREE.Shape();
        const lean = index === 0 ? -0.09 : 0.09;
        lick.moveTo(offset - 0.09, -0.25);
        lick.bezierCurveTo(offset - 0.13, -0.02, offset + lean - 0.04, 0.24, offset + lean, 0.34);
        lick.bezierCurveTo(offset + lean + 0.07, 0.14, offset + 0.13, -0.04, offset + 0.09, -0.25);
        lick.closePath();
        return lick;
    });
    return [outer, ...sideLicks];
}

function createHeroFireBoltShapes(): THREE.Shape[] {
    const bolt = new THREE.Shape();
    bolt.moveTo(0.04, 0);
    bolt.bezierCurveTo(-0.14, 0.5, -0.36, 0.31, -0.5, 0.2);
    bolt.bezierCurveTo(-0.62, 0.34, -0.8, 0.18, -1, 0.055);
    bolt.bezierCurveTo(-0.82, 0.015, -0.7, -0.08, -0.76, -0.18);
    bolt.bezierCurveTo(-0.5, -0.13, -0.32, -0.28, -0.2, -0.16);
    bolt.bezierCurveTo(-0.1, -0.11, -0.02, -0.09, 0.04, 0);
    bolt.closePath();
    const embers = [
        [-0.28, -0.33, 0.035],
        [-0.53, 0.35, 0.028],
        [-0.78, -0.26, 0.022],
    ].map(([x, y, radius]) => {
        const ember = new THREE.Shape();
        ember.moveTo(x + radius * 1.6, y);
        ember.lineTo(x, y + radius);
        ember.lineTo(x - radius * 1.4, y);
        ember.lineTo(x, y - radius);
        ember.closePath();
        return ember;
    });
    return [bolt, ...embers];
}

function createHeroFireScorchShapes(): THREE.Shape[] {
    const scorch = new THREE.Shape();
    scorch.moveTo(-0.5, -0.04);
    scorch.bezierCurveTo(-0.43, -0.24, -0.12, -0.31, 0.08, -0.24);
    scorch.bezierCurveTo(0.28, -0.3, 0.46, -0.2, 0.5, -0.04);
    scorch.bezierCurveTo(0.43, 0.18, 0.18, 0.28, -0.05, 0.22);
    scorch.bezierCurveTo(-0.26, 0.3, -0.46, 0.18, -0.5, -0.04);
    scorch.closePath();
    const cinders = [
        { x: 0.42, y: 0.21, size: 0.062 },
        { x: 0.24, y: -0.27, size: 0.048 },
        { x: -0.32, y: 0.24, size: 0.043 },
        { x: -0.43, y: -0.18, size: 0.035 },
        { x: 0.06, y: 0.31, size: 0.03 },
    ].map(({ x, y, size }) => {
        const cinder = new THREE.Shape();
        cinder.moveTo(x + size, y);
        cinder.lineTo(x, y + size * 0.55);
        cinder.lineTo(x - size, y);
        cinder.lineTo(x, y - size * 0.55);
        cinder.closePath();
        return cinder;
    });
    return [scorch, ...cinders];
}

const WARFRONT_THREE_HERO_RESIDUE_RENDER_ORDER = 3;
const WARFRONT_THREE_TARGET_SPRITE_RENDER_ORDER = 4;
const WARFRONT_THREE_HERO_CONTACT_SPRITE_FRONT_RENDER_ORDER = 6;
const WARFRONT_THREE_HERO_DAMAGE_RENDER_ORDER = 13;
const WARFRONT_THREE_HERO_CONTACT_DEPTH_OFFSET_WORLD = 0.18;
// Warfront rigs normalize to roughly 1.7 world units high. This reviewed
// painted-body width excludes tails/wings and is projected at the live target
// depth before the contact span is derived.
const WARFRONT_THREE_HERO_TARGET_WIDTH_WORLD = 1.5;
const WARFRONT_THREE_HERO_DAMAGE_FONT_PX = 14;
const WARFRONT_THREE_HERO_DAMAGE_OUTLINE_PX = 2;
const WARFRONT_THREE_HERO_DAMAGE_WIDTH_PX = 64;
const WARFRONT_THREE_HERO_DAMAGE_HEIGHT_PX = 26;

function createHeroDamageTexture(text: string): THREE.CanvasTexture {
    const pixelRatio = 2;
    const surface = document.createElement("canvas");
    surface.width = WARFRONT_THREE_HERO_DAMAGE_WIDTH_PX * pixelRatio;
    surface.height = WARFRONT_THREE_HERO_DAMAGE_HEIGHT_PX * pixelRatio;
    const context = surface.getContext("2d");
    if (context) {
        context.scale(pixelRatio, pixelRatio);
        context.font = `800 ${WARFRONT_THREE_HERO_DAMAGE_FONT_PX}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.lineJoin = "round";
        context.strokeStyle = "#050809";
        context.lineWidth = WARFRONT_THREE_HERO_DAMAGE_OUTLINE_PX;
        context.fillStyle = "#fff0c2";
        const centerX = WARFRONT_THREE_HERO_DAMAGE_WIDTH_PX * 0.5;
        const centerY = WARFRONT_THREE_HERO_DAMAGE_HEIGHT_PX * 0.5;
        context.strokeText(text, centerX, centerY);
        context.fillText(text, centerX, centerY);
    }
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}

/** One cached texture object is shared by the hidden GPU warm and live contact
 * plane. Keeping the authored RGB intact is important: additive tinting would
 * erase the sprite's dark ember edge and return it to a flat orange marker. */
function useHeroFireImpactTexture(): THREE.Texture {
    const texture = useLoader(THREE.TextureLoader, WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL);
    return useMemo(() => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        return texture;
    }, [texture]);
}

/** Upload the cached contact texture behind the formation curtain and require
 * two painted frames before it may participate in the stage-ready quorum. */
function HeroFireImpactTexturePreloader({ onReady }: { onReady: () => void }) {
    const gl = useThree((state) => state.gl);
    const texture = useHeroFireImpactTexture();
    const initialized = useRef(false);
    const paintedFrames = useRef(0);
    const reported = useRef(false);
    useLayoutEffect(() => {
        gl.initTexture(texture);
        initialized.current = true;
        return () => { initialized.current = false; };
    }, [gl, texture]);
    useFrame(() => {
        if (!initialized.current || reported.current || ++paintedFrames.current < 2) return;
        reported.current = true;
        onReady();
    });
    return null;
}

/** One authoritative visual sentence: attacker origin -> target streak ->
 * contact flash. All attacks share three instanced draw families, so an AOE or
 * simultaneous exchange cannot multiply materials/programs on software GL. */
function AttackCausalityLayer({ result, cues, clockRef, heroImpactAssetReady }: {
    result: DuelResult;
    cues: readonly WarfrontAttackCue[];
    clockRef: MutableRefObject<number>;
    heroImpactAssetReady: boolean;
}) {
    const heroImpactTexture = useHeroFireImpactTexture();
    const streaks = useRef<THREE.InstancedMesh>(null);
    const tells = useRef<THREE.InstancedMesh>(null);
    const contacts = useRef<THREE.InstancedMesh>(null);
    const particles = useRef<THREE.InstancedMesh>(null);
    const heroFlare = useRef<THREE.Mesh>(null);
    const heroTravelCore = useRef<THREE.Mesh>(null);
    const heroTravelPlume = useRef<THREE.Mesh>(null);
    const heroImpactSprite = useRef<THREE.Mesh>(null);
    const heroResidue = useRef<THREE.Mesh>(null);
    const heroDamage = useRef<THREE.Mesh>(null);
    const heroHealth = useRef<THREE.Group>(null);
    const heroHealthFill = useRef<THREE.Mesh>(null);
    const heroHealthLoss = useRef<THREE.Mesh>(null);
    const transform = useMemo(() => new THREE.Object3D(), []);
    const tint = useMemo(() => new THREE.Color(), []);
    const originSamples = useMemo(
        () => Array.from({ length: ATTACK_CAUSALITY_CAPACITY }, () => createActorPoseSample()),
        [],
    );
    const targetSamples = useMemo(
        () => Array.from({ length: ATTACK_CAUSALITY_CAPACITY }, () => createActorPoseSample()),
        [],
    );
    const spectaclePhases = useMemo(
        () => Array.from({ length: ATTACK_CAUSALITY_CAPACITY }, createWarfrontSpectaclePhase),
        [],
    );
    const budgetPhase = useMemo(() => createWarfrontSpectaclePhase(), []);
    const heroCue = useMemo(() => warfrontHeroAttackCue(cues), [cues]);
    const heroTargetPose = useMemo(() => createActorPoseSample(), []);
    const heroOriginPose = useMemo(() => createActorPoseSample(), []);
    const heroActorPresencePose = useMemo(() => createActorPoseSample(), []);
    const heroTargetPresencePose = useMemo(() => createActorPoseSample(), []);
    const heroHpBeforePose = useMemo(() => createActorPoseSample(), []);
    const heroHpAfterPose = useMemo(() => createActorPoseSample(), []);
    const heroReaction = useMemo(() => createWarfrontBodyReactionPhase(), []);
    const heroScreenPoint = useMemo(() => new THREE.Vector3(), []);
    const heroCameraSpace = useMemo(() => new THREE.Vector3(), []);
    const heroCameraForward = useMemo(() => new THREE.Vector3(), []);
    const heroContactBehindPoint = useMemo(() => new THREE.Vector3(), []);
    const heroContactFrontPoint = useMemo(() => new THREE.Vector3(), []);
    const heroDamagePoint = useMemo(() => new THREE.Vector3(), []);
    const heroProjectedA = useMemo(() => new THREE.Vector3(), []);
    const heroProjectedB = useMemo(() => new THREE.Vector3(), []);
    const heroFlareShapes = useMemo(() => createHeroFireCrownShapes(), []);
    const heroBoltShapes = useMemo(() => createHeroFireBoltShapes(), []);
    const heroScorchShapes = useMemo(() => createHeroFireScorchShapes(), []);
    const heroDamageValue = useMemo(() => {
        if (!heroCue) return 0;
        const before = sampleActorByIdInto(
            result,
            heroCue.targetId,
            Math.max(0, heroCue.contactTick - 1),
            createActorPoseSample(),
        );
        const after = sampleActorByIdInto(
            result,
            heroCue.targetId,
            heroCue.contactTick,
            createActorPoseSample(),
        );
        return Math.max(0, before.hp - after.hp);
    }, [heroCue, result]);
    const heroDamageText = heroDamageValue > 0 ? `−${Math.max(1, Math.round(heroDamageValue))}` : "";
    const heroDamageTexture = useMemo(() => createHeroDamageTexture(heroDamageText), [heroDamageText]);
    const heroTargetBeat = useMemo<WarfrontBodyContactBeat | null>(() => heroCue ? ({
        actorId: heroCue.targetId,
        tick: heroCue.contactTick,
        role: "target",
        cues: [heroCue],
        hits: heroCue.hits,
        lethal: heroCue.lethal,
        koTick: heroCue.koTick,
    }) : null, [heroCue]);
    const canvas = useThree((state) => state.gl.domElement);
    const camera = useThree((state) => state.camera);
    const viewport = useThree((state) => state.size);
    const maxActive = useRef(0);
    const maxParticles = useRef(0);
    const elementsSeen = useRef(new Set<string>());
    const qaEnabled = useMemo(
        () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ritemotionqa") === "1",
        [],
    );

    useEffect(() => () => heroDamageTexture.dispose(), [heroDamageTexture]);

    useLayoutEffect(() => {
        transform.position.set(0, -100, 0);
        transform.rotation.set(0, 0, 0);
        transform.scale.setScalar(0);
        transform.updateMatrix();
        const streakMesh = streaks.current;
        const tellMesh = tells.current;
        const contactMesh = contacts.current;
        const particleMesh = particles.current;
        if (!streakMesh || !tellMesh || !contactMesh || !particleMesh) return;
        for (const mesh of [streakMesh, tellMesh, contactMesh, particleMesh]) {
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            for (let index = 0; index < mesh.count; index++) mesh.setMatrixAt(index, transform.matrix);
            mesh.instanceMatrix.needsUpdate = true;
        }
    }, [transform]);

    useEffect(() => {
        if (!qaEnabled) return;
        canvas.dataset.riteAttackCues = String(cues.length);
        canvas.dataset.riteAttackStreakMs = String(ATTACK_STREAK_DURATION_MS);
        canvas.dataset.riteContactHoldFrames = "2";
        canvas.dataset.riteSpectacleGrammar = "elemental-v1";
        canvas.dataset.riteSpectacleOverlapCap = String(WARFRONT_SPECTACLE_OVERLAP_CAP);
        canvas.dataset.riteHeroElement = heroCue ? "Fire" : "";
        canvas.dataset.riteHeroActor = heroCue?.actorId ?? "";
        canvas.dataset.riteHeroTarget = heroCue?.targetId ?? "";
        canvas.dataset.riteHeroTellTick = heroCue ? String(heroCue.tellTick) : "";
        canvas.dataset.riteHeroContactTick = heroCue ? String(heroCue.contactTick) : "";
        canvas.dataset.riteHeroVfxGrammar = heroCue ? WARFRONT_HERO_FIRE_VFX_GRAMMAR : "";
        canvas.dataset.riteHeroFlareMinPx = heroCue ? String(WARFRONT_HERO_FLARE_MIN_PX) : "0";
        canvas.dataset.riteHeroTravelCorePx = heroCue ? String(WARFRONT_HERO_TRAVEL_CORE_PX) : "0";
        canvas.dataset.riteHeroTravelPlumePx = heroCue ? String(WARFRONT_HERO_TRAVEL_PLUME_PX) : "0";
        canvas.dataset.riteHeroTravelMinSpanFraction = heroCue ? WARFRONT_HERO_TRAVEL_MIN_SPAN_FRACTION.toFixed(6) : "0";
        canvas.dataset.riteHeroAxisTailPx = heroCue ? String(WARFRONT_HERO_AXIS_TAIL_PX) : "0";
        canvas.dataset.riteHeroBurstPx = heroCue ? String(WARFRONT_HERO_BURST_PX) : "0";
        canvas.dataset.riteHeroBurstHoldTicks = heroCue ? String(WARFRONT_HERO_BURST_HOLD_TICKS) : "0";
        canvas.dataset.riteHeroImpactMinPx = heroCue ? String(WARFRONT_HERO_IMPACT_MIN_PX) : "0";
        canvas.dataset.riteHeroImpactHoldTicks = heroCue ? String(WARFRONT_HERO_IMPACT_HOLD_TICKS) : "0";
        canvas.dataset.riteHeroContactRenderer = heroCue ? "three" : "";
        canvas.dataset.riteHeroContactLayer = heroCue ? "target-anchored-authored-sprite" : "";
        canvas.dataset.riteHeroContactLayerCount = heroCue ? String(WARFRONT_HERO_CONTACT_LAYER_COUNT) : "0";
        canvas.dataset.riteHeroContactLayers = heroCue ? WARFRONT_HERO_FIRE_CONTACT_LAYERS.join(",") : "";
        canvas.dataset.riteHeroContactTargetWidths = heroCue ? String(WARFRONT_HERO_CONTACT_TARGET_WIDTHS) : "0";
        canvas.dataset.riteHeroContactFrontHoldTicks = heroCue ? String(WARFRONT_HERO_BURST_HOLD_TICKS) : "0";
        const heroImpactImage = heroImpactTexture.image as HTMLImageElement | undefined;
        const heroImpactSourceWidth = heroImpactImage?.naturalWidth ?? heroImpactImage?.width ?? 0;
        const heroImpactSourceHeight = heroImpactImage?.naturalHeight ?? heroImpactImage?.height ?? 0;
        canvas.dataset.riteHeroImpactSpriteUrl = heroCue ? WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL : "";
        canvas.dataset.riteHeroImpactSpriteLoaded = String(Boolean(heroCue)
            && heroImpactAssetReady
            && heroImpactSourceWidth === WARFRONT_HERO_FIRE_IMPACT_SPRITE_SOURCE_PX
            && heroImpactSourceHeight === WARFRONT_HERO_FIRE_IMPACT_SPRITE_SOURCE_PX);
        canvas.dataset.riteHeroImpactSpriteSourceWidth = String(heroImpactSourceWidth);
        canvas.dataset.riteHeroImpactSpriteSourceHeight = String(heroImpactSourceHeight);
        canvas.dataset.riteHeroImpactSpriteAnchor = `${WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X.toFixed(6)},${WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y.toFixed(6)}`;
        canvas.dataset.riteHeroImpactSpriteAsymmetry = WARFRONT_HERO_FIRE_IMPACT_SPRITE_ASYMMETRY;
        canvas.dataset.riteHeroImpactSpriteLeftRightReachRatio = WARFRONT_HERO_FIRE_IMPACT_SPRITE_LEFT_RIGHT_REACH_RATIO.toFixed(3);
        canvas.dataset.riteHeroImpactSpritePrewarmed = String(heroImpactAssetReady);
        canvas.dataset.riteHeroImpactLegacyPrimitiveDraws = "0";
        canvas.dataset.riteHeroContactTargetRenderOrder = String(WARFRONT_THREE_TARGET_SPRITE_RENDER_ORDER);
        canvas.dataset.riteHeroContactDepthOffsetWorld = String(WARFRONT_THREE_HERO_CONTACT_DEPTH_OFFSET_WORLD);
        canvas.dataset.riteHeroResidueLayer = heroCue ? "behind-target" : "";
        canvas.dataset.riteHeroResidueTicks = heroCue ? String(WARFRONT_SPECTACLE_RESULT_TICKS) : "0";
        canvas.dataset.riteHeroResidueLayerCount = heroCue ? String(WARFRONT_HERO_RESIDUE_LAYER_COUNT) : "0";
        canvas.dataset.riteHeroResidueLayers = heroCue ? WARFRONT_HERO_FIRE_RESIDUE_LAYERS.join(",") : "";
        canvas.dataset.riteHeroResidueRenderOrder = String(heroResidue.current?.renderOrder ?? -1);
        const residueMaterial = heroResidue.current?.material as THREE.MeshBasicMaterial | undefined;
        canvas.dataset.riteHeroResidueDepthTest = String(residueMaterial?.depthTest === true);
        canvas.dataset.riteHeroDamageFontPx = String(WARFRONT_THREE_HERO_DAMAGE_FONT_PX);
        canvas.dataset.riteHeroDamageOutlinePx = String(WARFRONT_THREE_HERO_DAMAGE_OUTLINE_PX);
        canvas.dataset.riteHeroDamageRenderOrder = String(heroDamage.current?.renderOrder ?? -1);
        canvas.dataset.riteHeroDamageHoldTicks = String(WARFRONT_HERO_DAMAGE_HOLD_TICKS);
        canvas.dataset.riteHeroDamageText = heroDamageText;
        return () => {
            delete canvas.dataset.riteAttackCues;
            delete canvas.dataset.riteAttackStreakMs;
            delete canvas.dataset.riteContactHoldFrames;
            delete canvas.dataset.riteAttackCausalityActive;
            delete canvas.dataset.riteAttackContactsActive;
            delete canvas.dataset.riteAttackCausalityMaxActive;
            delete canvas.dataset.riteAttackLongestDistance;
            delete canvas.dataset.riteAttackLongestEndpoints;
            delete canvas.dataset.riteSpectacleGrammar;
            delete canvas.dataset.riteSpectacleOverlapCap;
            delete canvas.dataset.riteSpectacleTellActive;
            delete canvas.dataset.riteSpectacleContactActive;
            delete canvas.dataset.riteSpectacleResultActive;
            delete canvas.dataset.riteSpectacleParticlesActive;
            delete canvas.dataset.riteSpectacleParticlesMax;
            delete canvas.dataset.riteSpectacleElementsSeen;
            delete canvas.dataset.riteHeroElement;
            delete canvas.dataset.riteHeroActor;
            delete canvas.dataset.riteHeroTarget;
            delete canvas.dataset.riteHeroTellTick;
            delete canvas.dataset.riteHeroContactTick;
            delete canvas.dataset.riteHeroVfxGrammar;
            delete canvas.dataset.riteHeroShape;
            delete canvas.dataset.riteHeroStage;
            delete canvas.dataset.riteHeroOriginAnchor;
            delete canvas.dataset.riteHeroTargetAnchor;
            delete canvas.dataset.riteHeroCorridorLength;
            delete canvas.dataset.riteHeroHpDelta;
            delete canvas.dataset.riteHeroLocalHpVisible;
            delete canvas.dataset.riteHeroTargetRecoil;
            delete canvas.dataset.riteHeroFlareMinPx;
            delete canvas.dataset.riteHeroTravelCorePx;
            delete canvas.dataset.riteHeroTravelPlumePx;
            delete canvas.dataset.riteHeroTravelMinSpanFraction;
            delete canvas.dataset.riteHeroTravelSpanFraction;
            delete canvas.dataset.riteHeroTravelAxis;
            delete canvas.dataset.riteHeroAxisTailPx;
            delete canvas.dataset.riteHeroAxisTailVisible;
            delete canvas.dataset.riteHeroAxisTailStrength;
            delete canvas.dataset.riteHeroAxisTailAxis;
            delete canvas.dataset.riteActorsPresent;
            delete canvas.dataset.riteHeroActorPresent;
            delete canvas.dataset.riteHeroTargetPresent;
            delete canvas.dataset.riteHeroBurstPx;
            delete canvas.dataset.riteHeroBurstHoldTicks;
            delete canvas.dataset.riteHeroImpactMinPx;
            delete canvas.dataset.riteHeroImpactHoldTicks;
            delete canvas.dataset.riteHeroContactRenderer;
            delete canvas.dataset.riteHeroContactLayer;
            delete canvas.dataset.riteHeroContactLayerCount;
            delete canvas.dataset.riteHeroContactLayers;
            delete canvas.dataset.riteHeroContactTargetWidths;
            delete canvas.dataset.riteHeroContactFrontHoldTicks;
            delete canvas.dataset.riteHeroContactFrontActive;
            delete canvas.dataset.riteHeroImpactSpriteUrl;
            delete canvas.dataset.riteHeroImpactSpriteLoaded;
            delete canvas.dataset.riteHeroImpactSpriteSourceWidth;
            delete canvas.dataset.riteHeroImpactSpriteSourceHeight;
            delete canvas.dataset.riteHeroImpactSpriteAnchor;
            delete canvas.dataset.riteHeroImpactSpriteAsymmetry;
            delete canvas.dataset.riteHeroImpactSpriteLeftRightReachRatio;
            delete canvas.dataset.riteHeroImpactSpriteVisible;
            delete canvas.dataset.riteHeroImpactSpriteDraws;
            delete canvas.dataset.riteHeroImpactSpriteRotationRad;
            delete canvas.dataset.riteHeroImpactSpriteAxis;
            delete canvas.dataset.riteHeroImpactSpriteFootprintPx;
            delete canvas.dataset.riteHeroImpactSpriteTargetWidthRatio;
            delete canvas.dataset.riteHeroImpactSpritePrewarmed;
            delete canvas.dataset.riteHeroImpactLegacyPrimitiveDraws;
            delete canvas.dataset.riteHeroContactTargetRenderOrder;
            delete canvas.dataset.riteHeroContactDepthOffsetWorld;
            delete canvas.dataset.riteHeroResidueLayer;
            delete canvas.dataset.riteHeroResidueTicks;
            delete canvas.dataset.riteHeroResidueLayerCount;
            delete canvas.dataset.riteHeroResidueLayers;
            delete canvas.dataset.riteHeroResidueRenderOrder;
            delete canvas.dataset.riteHeroResidueDepthTest;
            delete canvas.dataset.riteHeroResidueSmokeRenderOrder;
            delete canvas.dataset.riteHeroResidueSmokeDepthTest;
            delete canvas.dataset.riteHeroResidueVisible;
            delete canvas.dataset.riteHeroResidueSpanPx;
            delete canvas.dataset.riteHeroResidueMaterialStrength;
            delete canvas.dataset.riteHeroContactTargetWidthPx;
            delete canvas.dataset.riteHeroContactSpanPx;
            delete canvas.dataset.riteHeroContactTargetWidthRatio;
            delete canvas.dataset.riteHeroDamageFontPx;
            delete canvas.dataset.riteHeroDamageOutlinePx;
            delete canvas.dataset.riteHeroDamageRenderOrder;
            delete canvas.dataset.riteHeroDamageHoldTicks;
            delete canvas.dataset.riteHeroDamageText;
            delete canvas.dataset.riteHeroDamageVisible;
            delete canvas.dataset.riteHeroFlareVisiblePx;
            delete canvas.dataset.riteHeroTravelCoreVisiblePx;
            delete canvas.dataset.riteHeroTravelPlumeVisiblePx;
            delete canvas.dataset.riteHeroBurstVisiblePx;
            delete canvas.dataset.riteHeroBurstHoldActive;
            delete canvas.dataset.riteHeroImpactVisiblePx;
            delete canvas.dataset.riteHeroImpactHoldActive;
        };
    }, [canvas, cues.length, heroCue, heroDamageText, heroImpactAssetReady, heroImpactTexture, qaEnabled]);

    useFrame(() => {
        const streakMesh = streaks.current;
        const tellMesh = tells.current;
        const contactMesh = contacts.current;
        const particleMesh = particles.current;
        if (!streakMesh || !tellMesh || !contactMesh || !particleMesh) return;
        const tick = clockRef.current;
        if (heroFlare.current) {
            heroFlare.current.visible = false;
            heroFlare.current.renderOrder = 7;
            (heroFlare.current.material as THREE.MeshBasicMaterial).depthTest = false;
        }
        if (heroTravelCore.current) heroTravelCore.current.visible = false;
        if (heroTravelPlume.current) heroTravelPlume.current.visible = false;
        if (heroImpactSprite.current) {
            heroImpactSprite.current.visible = false;
            heroImpactSprite.current.renderOrder = WARFRONT_THREE_HERO_CONTACT_SPRITE_FRONT_RENDER_ORDER;
            (heroImpactSprite.current.material as THREE.MeshBasicMaterial).depthTest = false;
        }
        if (heroResidue.current) heroResidue.current.visible = false;
        if (heroDamage.current) heroDamage.current.visible = false;
        if (heroHealth.current) heroHealth.current.visible = false;
        const heroPhaseNow = heroCue
            ? warfrontSpectaclePhaseInto(heroCue, tick, budgetPhase)
            : null;
        const heroStageName = heroPhaseNow ? warfrontHeroStage(heroPhaseNow) : "idle";
        const heroCueIndex = heroCue ? cues.indexOf(heroCue) : -1;
        let visibleCueCount = 0;
        for (let order = -1; order < cues.length; order++) {
            const cue = order < 0 ? heroCue : cues[order];
            if (!cue || (order >= 0 && order === heroCueIndex)) continue;
            if (warfrontSpectaclePhaseInto(cue, tick, budgetPhase).visible) visibleCueCount++;
            if (visibleCueCount >= ATTACK_CAUSALITY_CAPACITY) break;
        }
        const particlesPerCue = Math.min(
            ATTACK_PARTICLES_PER_CUE,
            warfrontSpectacleParticleBudget(
                Math.min(canvas.clientWidth || 1280, canvas.clientHeight || 720),
                visibleCueCount,
            ),
        );
        let slot = 0;
        let contactCount = 0;
        let tellCount = 0;
        let resultCount = 0;
        let particleCount = 0;
        let longestDistance = 0;
        let longestOx = 0;
        let longestOz = 0;
        let longestTx = 0;
        let longestTz = 0;
        let heroHpDelta = 0;
        let heroTargetRecoil = 0;
        let heroLocalHpVisible = false;
        let heroOriginAnchor = "";
        let heroTargetAnchor = "";
        let heroCorridorLength = 0;
        let heroFlareVisiblePx = 0;
        let heroTravelCoreVisiblePx = 0;
        let heroTravelPlumeVisiblePx = 0;
        let heroTravelSpanFraction = 0;
        let heroTravelAxisX = 0;
        let heroTravelAxisY = 0;
        let heroTravelScreenAngle = 0;
        let heroAxisTailVisible = false;
        let heroAxisTailStrength = 0;
        let heroAxisTailAxis = "";
        let heroBurstVisiblePx = 0;
        let heroBurstHoldActive = false;
        let heroImpactVisiblePx = 0;
        let heroImpactHoldActive = false;
        let heroContactFrontActive = false;
        let heroImpactSpriteVisible = false;
        let heroImpactSpriteDraws = 0;
        let heroImpactSpriteFootprintPx = 0;
        let heroImpactSpriteAxis = "";
        let heroImpactSpriteRotationRad = 0;
        let heroContactTargetWidthPx = 0;
        let heroContactSpanPx = 0;
        let heroResidueVisible = false;
        let heroResidueSpanPx = 0;
        let heroResidueMaterialStrength = 0;
        let heroDamageVisible = false;
        for (let order = -1; order < cues.length && slot < ATTACK_CAUSALITY_CAPACITY; order++) {
            const cueIndex = order < 0 ? heroCueIndex : order;
            const cue = order < 0 ? heroCue : cues[order];
            if (!cue || cueIndex < 0 || (order >= 0 && order === heroCueIndex)) continue;
            const phase = warfrontSpectaclePhaseInto(cue, tick, spectaclePhases[slot]);
            if (!phase.visible) continue;

            // Freeze the line endpoints at contact during the post-hit trail;
            // otherwise recovery movement bends the causal arrow after damage.
            // Melee roots converge at contact, so sampling both at the hit edge
            // collapses the causal line into an unreadable dot. The tell origin
            // and authoritative target contact remain stable for the whole
            // sentence and expose who crossed the board to cause the damage.
            const origin = sampleActorByIdInto(result, cue.actorId, cue.tellTick, originSamples[slot]);
            const target = sampleActorByIdInto(result, cue.targetId, cue.contactTick, targetSamples[slot]);
            const ox = origin.x * WORLD_SCALE;
            const oz = origin.z * WORLD_SCALE;
            const tx = target.x * WORLD_SCALE;
            const tz = target.z * WORLD_SCALE;
            const dx = tx - ox;
            const dz = tz - oz;
            const distance = Math.max(0.001, Math.hypot(dx, dz));
            const isHero = cue === heroCue;
            let impactTx = tx;
            let impactTz = tz;
            if (isHero && heroTargetBeat) {
                const currentTarget = sampleActorByIdInto(result, cue.targetId, tick, heroTargetPose);
                const contactOrigin = sampleActorByIdInto(result, cue.actorId, cue.contactTick, heroOriginPose);
                const contactTarget = sampleActorByIdInto(result, cue.targetId, cue.contactTick, heroHpAfterPose);
                const direction = warfrontContactDirection(
                    contactOrigin.x, contactOrigin.z, contactTarget.x, contactTarget.z,
                    contactOrigin.faceX, contactOrigin.faceZ,
                );
                warfrontBodyReactionPhaseInto(heroTargetBeat, tick, heroReaction);
                heroTargetRecoil = heroReaction.recoil;
                impactTx = (currentTarget.x + direction.x * heroReaction.recoil * BODY_RECOIL_DISTANCE) * WORLD_SCALE;
                impactTz = (currentTarget.z + direction.z * heroReaction.recoil * BODY_RECOIL_DISTANCE) * WORLD_SCALE;
                const before = sampleActorByIdInto(result, cue.targetId, Math.max(0, cue.contactTick - 1), heroHpBeforePose);
                const after = sampleActorByIdInto(result, cue.targetId, cue.contactTick, heroHpAfterPose);
                heroHpDelta = Math.max(0, before.hp - after.hp);
                heroOriginAnchor = `${ox.toFixed(2)},${oz.toFixed(2)}`;
                heroTargetAnchor = `${impactTx.toFixed(2)},${impactTz.toFixed(2)}`;
                heroCorridorLength = distance;
            }
            if (distance > longestDistance) {
                longestDistance = distance;
                longestOx = ox;
                longestOz = oz;
                longestTx = tx;
                longestTz = tz;
            }
            const signature = warfrontElementSignature(cue.element);
            elementsSeen.current.add(signature.element);
            const elementColor = signature.primary;
            const overlapGain = Math.min(1.16, 1 + (cue.hits - 1) * 0.08);

            if (isHero) {
                heroProjectedA.set(ox, 0.62, oz).project(camera);
                heroProjectedB.set(tx, 0.62, tz).project(camera);
                const fullScreenDx = (heroProjectedB.x - heroProjectedA.x) * viewport.width * 0.5;
                const fullScreenDy = (heroProjectedB.y - heroProjectedA.y) * viewport.height * 0.5;
                const fullScreenLength = Math.max(0.001, Math.hypot(fullScreenDx, fullScreenDy));
                heroTravelAxisX = fullScreenDx / fullScreenLength;
                heroTravelAxisY = fullScreenDy / fullScreenLength;
                heroTravelScreenAngle = Math.atan2(heroTravelAxisY, heroTravelAxisX);
            }

            // The streak grows out of the attacker in the final two sim ticks
            // (~67ms at 30Hz) before the hit, holds across contact, then leaves
            // a short colored afterimage beneath the body-led contact phrase.
            const travel = phase.travel;
            const tailFraction = signature.shape === "crescent" ? 0.28 : signature.shape === "fault" ? 0.14 : 0.2;
            const tail = isHero ? 0 : Math.max(0, travel - tailFraction);
            const tracerMid = (travel + tail) * 0.5;
            const tracerLength = distance * Math.max(0, travel - tail);
            transform.position.set(ox + dx * tracerMid, 0.52, oz + dz * tracerMid);
            transform.rotation.set(0, Math.atan2(dx, dz), 0);
            let streakCrossScale = isHero ? 2.4 : signature.shape === "fault" ? 1.45 : 1;
            if (isHero && phase.travel > 0) {
                heroScreenPoint.copy(transform.position);
                const worldPerPixel = worldUnitsPerScreenPixel(
                    camera,
                    heroScreenPoint,
                    viewport.height,
                    heroCameraSpace,
                );
                streakCrossScale = Math.max(streakCrossScale, worldPerPixel * WARFRONT_HERO_TRAVEL_CORE_PX / 0.09);
            }
            transform.scale.set(!isHero && phase.travel > 0 ? streakCrossScale : 0, !isHero && phase.travel > 0 ? 1 : 0, tracerLength);
            transform.updateMatrix();
            streakMesh.setMatrixAt(slot, transform.matrix);
            streakMesh.setColorAt(slot, tint.set(elementColor).multiplyScalar(Math.max(0.14, phase.travel) * overlapGain));

            const heroTravelStrength = isHero && tick < cue.contactTick ? phase.travel : 0;
            const travelCore = heroTravelCore.current;
            const travelPlume = heroTravelPlume.current;
            if (heroTravelStrength > 0 && travelCore && travelPlume) {
                heroTravelSpanFraction = warfrontHeroTravelSpanFraction(heroTravelStrength);
                heroScreenPoint.set(
                    ox + dx * heroTravelSpanFraction,
                    0.62,
                    oz + dz * heroTravelSpanFraction,
                );
                const worldPerPixel = worldUnitsPerScreenPixel(
                    camera,
                    heroScreenPoint,
                    viewport.height,
                    heroCameraSpace,
                );
                heroProjectedA.set(ox, 0.62, oz).project(camera);
                heroProjectedB.copy(heroScreenPoint).project(camera);
                const screenDx = (heroProjectedB.x - heroProjectedA.x) * viewport.width * 0.5;
                const screenDy = (heroProjectedB.y - heroProjectedA.y) * viewport.height * 0.5;
                const corridorPixels = Math.max(1, Math.hypot(screenDx, screenDy));
                const plumeLength = worldPerPixel * corridorPixels;
                travelCore.visible = true;
                travelCore.position.copy(heroScreenPoint);
                travelCore.scale.setScalar(worldPerPixel * WARFRONT_HERO_TRAVEL_CORE_PX * 0.5);
                (travelCore.material as THREE.MeshBasicMaterial).opacity = 0.98;
                travelPlume.visible = true;
                travelPlume.position.copy(heroScreenPoint);
                travelPlume.quaternion.copy(camera.quaternion);
                travelPlume.rotateZ(heroTravelScreenAngle);
                travelPlume.scale.set(
                    plumeLength,
                    worldPerPixel * WARFRONT_HERO_TRAVEL_PLUME_PX,
                    1,
                );
                const travelMaterial = travelPlume.material as THREE.MeshBasicMaterial;
                travelMaterial.color.set("#ffad43");
                travelMaterial.opacity = 0.98;
                heroTravelCoreVisiblePx = WARFRONT_HERO_TRAVEL_CORE_PX;
                heroTravelPlumeVisiblePx = WARFRONT_HERO_TRAVEL_PLUME_PX;
            }

            const tellStrength = isHero ? 0 : phase.tell;
            const tellScale = tellStrength > 0 ? 0.34 + tellStrength * 0.34 : 0;
            transform.position.set(ox, signature.shape === "flare" ? 0.72 : 0.08, oz);
            transform.rotation.set(
                signature.shape === "flare" ? Math.PI / 2 : 0,
                cueIndex * 0.61 + tick * (signature.shape === "crescent" ? 0.08 : 0.025),
                signature.shape === "fault" ? Math.PI / 4 : signature.shape === "crescent" ? 0.48 : 0,
            );
            transform.scale.set(
                tellScale * (signature.shape === "flare" ? 0.52 : signature.shape === "crescent" ? 1.25 : 1),
                tellScale * (signature.shape === "flare" ? 1.35 : 1),
                tellScale * (signature.shape === "ripple" ? 1 : signature.shape === "fault" ? 0.82 : 0.55),
            );
            transform.updateMatrix();
            tellMesh.setMatrixAt(slot, transform.matrix);
            tellMesh.setColorAt(slot, tint.set(elementColor).multiplyScalar(0.46 + tellStrength * 0.54));
            if (phase.tell > 0) tellCount++;
            if (isHero && phase.tell > 0 && phase.travel <= 0 && heroFlare.current) {
                heroScreenPoint.set(ox, 0.58, oz);
                const worldPerPixel = worldUnitsPerScreenPixel(
                    camera,
                    heroScreenPoint,
                    viewport.height,
                    heroCameraSpace,
                );
                const flareSpan = worldPerPixel * WARFRONT_HERO_FLARE_MIN_PX;
                heroFlare.current.visible = true;
                heroFlare.current.position.copy(heroScreenPoint);
                heroFlare.current.quaternion.copy(camera.quaternion);
                heroFlare.current.rotateZ(0.04 + Math.sin(tick * 0.23) * 0.045);
                heroFlare.current.scale.setScalar(flareSpan);
                const flareMaterial = heroFlare.current.material as THREE.MeshBasicMaterial;
                flareMaterial.color.set("#ff6925");
                flareMaterial.opacity = 0.48 + phase.tell * 0.48;
                heroFlareVisiblePx = WARFRONT_HERO_FLARE_MIN_PX;
            }

            const impactStrength = Math.max(phase.contact, phase.result * 0.72);
            const contactScale = impactStrength > 0
                ? (0.18 + impactStrength * (cue.hits > 1 ? 0.54 : 0.43)) * (cue.lethal ? 1.18 : 1)
                : 0;
            transform.position.set(impactTx, 0.7, impactTz);
            transform.rotation.set(tick * 0.17 + cueIndex, cueIndex * 0.73, -tick * 0.11);
            if (isHero) transform.scale.setScalar(0);
            else if (signature.shape === "ripple") transform.scale.set(contactScale * 1.35, contactScale * 0.28, contactScale * 1.35);
            else if (signature.shape === "flare") transform.scale.set(contactScale * 0.6, contactScale * 1.7, contactScale * 0.6);
            else if (signature.shape === "crescent") transform.scale.set(contactScale * 1.65, contactScale * 0.24, contactScale * 0.48);
            else transform.scale.set(contactScale * 1.12, contactScale * 0.82, contactScale * 1.12);
            transform.updateMatrix();
            contactMesh.setMatrixAt(slot, transform.matrix);
            contactMesh.setColorAt(slot, tint.set(elementColor).multiplyScalar(0.72 + impactStrength * 0.34));
            if (phase.contact > 0) contactCount++;
            if (phase.result > 0) resultCount++;

            if (isHero) {
                const impactHold = warfrontHeroImpactHold(cue, tick);
                const burstHold = warfrontHeroBurstHold(cue, tick);
                const damageHold = warfrontHeroDamageHold(cue, tick);
                const contactSpriteHold = Math.min(impactHold, burstHold);
                heroScreenPoint.set(impactTx, 0.78, impactTz);
                const impactWorldPerPixel = worldUnitsPerScreenPixel(
                    camera,
                    heroScreenPoint,
                    viewport.height,
                    heroCameraSpace,
                );
                const targetWidthPx = WARFRONT_THREE_HERO_TARGET_WIDTH_WORLD / Math.max(0.001, impactWorldPerPixel);
                const contactWidthPx = warfrontHeroContactWidthPx(targetWidthPx);
                const coreWidthPx = Math.max(WARFRONT_HERO_IMPACT_MIN_PX, contactWidthPx * 0.46);
                heroContactTargetWidthPx = targetWidthPx;
                heroContactSpanPx = contactWidthPx;
                const impactScreenAngle = heroTravelScreenAngle;
                const impactWorldAngle = Math.atan2(dz, dx);
                camera.getWorldDirection(heroCameraForward);
                heroContactBehindPoint.copy(heroScreenPoint).addScaledVector(
                    heroCameraForward,
                    WARFRONT_THREE_HERO_CONTACT_DEPTH_OFFSET_WORLD,
                );
                heroContactFrontPoint.copy(heroScreenPoint).addScaledVector(
                    heroCameraForward,
                    -WARFRONT_THREE_HERO_CONTACT_DEPTH_OFFSET_WORLD,
                );
                heroAxisTailStrength = warfrontHeroAxisTailStrength(impactHold, phase.result);
                heroAxisTailVisible = heroAxisTailStrength > 0;
                heroAxisTailAxis = `${heroTravelAxisX.toFixed(6)},${heroTravelAxisY.toFixed(6)}`;
                if (heroAxisTailVisible && heroTravelPlume.current) {
                    const tailWorldLength = impactWorldPerPixel * WARFRONT_HERO_AXIS_TAIL_PX;
                    heroTravelPlume.current.visible = true;
                    heroTravelPlume.current.position.copy(heroContactFrontPoint);
                    heroTravelPlume.current.quaternion.copy(camera.quaternion);
                    heroTravelPlume.current.rotateZ(impactScreenAngle);
                    heroTravelPlume.current.scale.set(
                        tailWorldLength,
                        impactWorldPerPixel * WARFRONT_HERO_TRAVEL_PLUME_PX,
                        1,
                    );
                    const tailMaterial = heroTravelPlume.current.material as THREE.MeshBasicMaterial;
                    tailMaterial.color.set("#ff9d36");
                    tailMaterial.opacity = 0.2 + heroAxisTailStrength * 0.78;
                }
                if (contactSpriteHold > 0 && heroImpactSprite.current) {
                    const spriteWorldSpan = impactWorldPerPixel * contactWidthPx;
                    heroImpactSprite.current.visible = true;
                    heroImpactSprite.current.position.copy(heroContactFrontPoint);
                    heroImpactSprite.current.quaternion.copy(camera.quaternion);
                    heroImpactSprite.current.rotateZ(impactScreenAngle);
                    // The generated sprite's white-hot compression point is
                    // intentionally right of centre. Translate the quad back
                    // along its frozen local axis so that authored hotspot,
                    // rather than the transparent canvas centre, owns target.
                    heroImpactSprite.current.translateX(
                        (0.5 - WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X) * spriteWorldSpan,
                    );
                    heroImpactSprite.current.translateY(
                        (WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y - 0.5) * spriteWorldSpan,
                    );
                    heroImpactSprite.current.scale.set(spriteWorldSpan, spriteWorldSpan, 1);
                    const spriteMaterial = heroImpactSprite.current.material as THREE.MeshBasicMaterial;
                    spriteMaterial.opacity = 1;
                    heroBurstVisiblePx = contactWidthPx;
                    heroBurstHoldActive = true;
                    heroImpactVisiblePx = coreWidthPx;
                    heroImpactHoldActive = true;
                    heroContactFrontActive = true;
                    heroImpactSpriteVisible = true;
                    heroImpactSpriteDraws = 1;
                    heroImpactSpriteFootprintPx = contactWidthPx;
                    heroImpactSpriteAxis = heroAxisTailAxis;
                    heroImpactSpriteRotationRad = impactScreenAngle;
                }
                if (damageHold > 0 && heroDamageValue > 0 && heroDamage.current) {
                    heroDamagePoint.set(impactTx, 2.48, impactTz);
                    const damageWorldPerPixel = worldUnitsPerScreenPixel(
                        camera,
                        heroDamagePoint,
                        viewport.height,
                        heroCameraSpace,
                    );
                    heroDamage.current.visible = true;
                    heroDamage.current.position.copy(heroDamagePoint);
                    heroDamage.current.quaternion.copy(camera.quaternion);
                    heroDamage.current.scale.set(
                        damageWorldPerPixel * WARFRONT_THREE_HERO_DAMAGE_WIDTH_PX,
                        damageWorldPerPixel * WARFRONT_THREE_HERO_DAMAGE_HEIGHT_PX,
                        1,
                    );
                    heroDamageVisible = true;
                }
                if (phase.result > 0 && heroResidue.current) {
                    const residueAge = 1 - phase.result;
                    const residueSpanPx = contactWidthPx * (0.84 + residueAge * 0.1);
                    const residueWorldSpan = impactWorldPerPixel * residueSpanPx;
                    heroResidue.current.visible = true;
                    heroResidueVisible = true;
                    heroResidueSpanPx = residueSpanPx;
                    heroResidueMaterialStrength = phase.result * 0.88;
                    heroResidue.current.position.set(impactTx, 0.08, impactTz);
                    heroResidue.current.rotation.set(-Math.PI / 2, 0, -impactWorldAngle);
                    heroResidue.current.scale.set(residueWorldSpan, residueWorldSpan * 0.72, 1);
                    (heroResidue.current.material as THREE.MeshBasicMaterial).opacity = heroResidueMaterialStrength;
                    if (heroFlare.current) {
                        heroFlare.current.visible = true;
                        const smokeSideDrift = WARFRONT_THREE_HERO_TARGET_WIDTH_WORLD * 0.28;
                        heroScreenPoint.set(
                            impactTx - Math.sin(impactWorldAngle) * smokeSideDrift,
                            1.46 + residueAge * 0.56,
                            impactTz + Math.cos(impactWorldAngle) * smokeSideDrift,
                        );
                        heroContactBehindPoint.copy(heroScreenPoint).addScaledVector(
                            heroCameraForward,
                            WARFRONT_THREE_HERO_CONTACT_DEPTH_OFFSET_WORLD,
                        );
                        heroFlare.current.position.copy(heroContactBehindPoint);
                        heroFlare.current.renderOrder = WARFRONT_THREE_HERO_RESIDUE_RENDER_ORDER;
                        heroFlare.current.quaternion.copy(camera.quaternion);
                        heroFlare.current.rotateZ(-0.16 + Math.sin(tick * 0.19) * 0.04);
                        heroFlare.current.scale.setScalar(
                            impactWorldPerPixel * targetWidthPx * (0.92 + residueAge * 0.22),
                        );
                        const smokeMaterial = heroFlare.current.material as THREE.MeshBasicMaterial;
                        smokeMaterial.depthTest = true;
                        smokeMaterial.color.set("#ad8d82");
                        smokeMaterial.opacity = phase.result * 0.68;
                    }
                }
                const hpStrength = phase.contact > 0 ? 1 : phase.result;
                heroLocalHpVisible = hpStrength > 0 && heroHpDelta > 0;
                const health = heroHealth.current;
                const fill = heroHealthFill.current;
                const loss = heroHealthLoss.current;
                if (heroLocalHpVisible && health && fill && loss) {
                    const beforeFraction = Math.max(0, Math.min(1, heroHpBeforePose.hp / Math.max(1, heroHpBeforePose.maxHp)));
                    const afterFraction = Math.max(0, Math.min(beforeFraction, heroHpAfterPose.hp / Math.max(1, heroHpAfterPose.maxHp)));
                    health.visible = true;
                    health.position.set(impactTx, 2.18, impactTz);
                    health.quaternion.copy(camera.quaternion);
                    health.scale.setScalar(0.92);
                    fill.scale.set(1.3 * afterFraction, 0.105, 1);
                    fill.position.x = -0.65 + fill.scale.x * 0.5;
                    loss.scale.set(Math.max(0.035, 1.3 * (beforeFraction - afterFraction)), 0.105, 1);
                    loss.position.x = -0.65 + 1.3 * afterFraction + loss.scale.x * 0.5;
                    for (const child of health.children) {
                        const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
                        if (material) material.opacity = 0.48 + hpStrength * 0.48;
                    }
                }
            }

            const particlesForCue = particlesPerCue;
            for (let particle = 0; particle < particlesForCue; particle++) {
                const instance = slot * ATTACK_PARTICLES_PER_CUE + particle;
                const angle = cueIndex * 0.91 + particle / particlesForCue * Math.PI * 2;
                const release = Math.max(phase.contact, phase.result);
                const radius = (1 - phase.result) * (signature.shape === "flare" ? 1.15 : 0.82);
                const rise = signature.shape === "flare" ? (1 - phase.result) * 1.25
                    : signature.shape === "fault" ? Math.sin((1 - phase.result) * Math.PI) * 0.32
                        : 0.24 + Math.sin((1 - phase.result) * Math.PI) * 0.54;
                transform.position.set(impactTx + Math.cos(angle) * radius, 0.46 + rise, impactTz + Math.sin(angle) * radius);
                transform.rotation.set(angle, tick * 0.11 + particle, angle * 0.7);
                const particleScale = release > 0 ? (0.055 + release * (signature.shape === "fault" ? 0.1 : 0.065)) : 0;
                transform.scale.setScalar(particleScale);
                transform.updateMatrix();
                particleMesh.setMatrixAt(instance, transform.matrix);
                particleMesh.setColorAt(instance, tint.set(signature.highlight).multiplyScalar(0.4 + release * 0.6));
                particleCount++;
            }
            slot++;
        }

        transform.position.set(0, -100, 0);
        transform.rotation.set(0, 0, 0);
        transform.scale.setScalar(0);
        transform.updateMatrix();
        for (let index = slot; index < ATTACK_CAUSALITY_CAPACITY; index++) {
            streakMesh.setMatrixAt(index, transform.matrix);
            tellMesh.setMatrixAt(index, transform.matrix);
            contactMesh.setMatrixAt(index, transform.matrix);
        }
        for (let index = slot * ATTACK_PARTICLES_PER_CUE; index < ATTACK_CAUSALITY_CAPACITY * ATTACK_PARTICLES_PER_CUE; index++) {
            particleMesh.setMatrixAt(index, transform.matrix);
        }
        for (const mesh of [streakMesh, tellMesh, contactMesh, particleMesh]) {
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        maxActive.current = Math.max(maxActive.current, slot);
        maxParticles.current = Math.max(maxParticles.current, particleCount);
        if (qaEnabled) {
            let actorsPresent = 0;
            const presenceSnapshotIndex = Math.max(0, Math.min(result.snapshots.length - 1, Math.floor(tick)));
            const presenceSnapshot = result.snapshots[presenceSnapshotIndex];
            if (presenceSnapshot) {
                for (const actor of presenceSnapshot.actors) {
                    if (actor.hp > 0 && actor.state !== "dead") actorsPresent++;
                }
            }
            let heroActorPresent = false;
            let heroTargetPresent = false;
            if (heroCue) {
                const heroActor = sampleActorByIdInto(result, heroCue.actorId, tick, heroActorPresencePose);
                const heroTarget = sampleActorByIdInto(result, heroCue.targetId, tick, heroTargetPresencePose);
                heroActorPresent = heroActor.hp > 0 && heroActor.state !== "dead";
                heroTargetPresent = heroTarget.hp > 0 && heroTarget.state !== "dead";
            }
            canvas.dataset.riteActorsPresent = String(actorsPresent);
            canvas.dataset.riteHeroActorPresent = String(heroActorPresent);
            canvas.dataset.riteHeroTargetPresent = String(heroTargetPresent);
            canvas.dataset.riteAttackCausalityActive = String(slot);
            canvas.dataset.riteAttackContactsActive = String(contactCount);
            canvas.dataset.riteAttackCausalityMaxActive = String(maxActive.current);
            canvas.dataset.riteAttackLongestDistance = longestDistance.toFixed(3);
            canvas.dataset.riteAttackLongestEndpoints = `${longestOx.toFixed(2)},${longestOz.toFixed(2)}>${longestTx.toFixed(2)},${longestTz.toFixed(2)}`;
            canvas.dataset.riteSpectacleTellActive = String(tellCount);
            canvas.dataset.riteSpectacleContactActive = String(contactCount);
            canvas.dataset.riteSpectacleResultActive = String(resultCount);
            canvas.dataset.riteSpectacleParticlesActive = String(particleCount);
            canvas.dataset.riteSpectacleParticlesMax = String(maxParticles.current);
            canvas.dataset.riteSpectacleElementsSeen = [...elementsSeen.current].sort().join(",");
            canvas.dataset.riteHeroStage = heroStageName;
            canvas.dataset.riteHeroShape = heroCue ? warfrontHeroFireShape(heroStageName) : "";
            canvas.dataset.riteHeroOriginAnchor = heroOriginAnchor;
            canvas.dataset.riteHeroTargetAnchor = heroTargetAnchor;
            canvas.dataset.riteHeroCorridorLength = heroCorridorLength.toFixed(2);
            canvas.dataset.riteHeroHpDelta = heroHpDelta.toFixed(2);
            canvas.dataset.riteHeroLocalHpVisible = String(heroLocalHpVisible);
            canvas.dataset.riteHeroTargetRecoil = heroTargetRecoil.toFixed(3);
            canvas.dataset.riteHeroFlareVisiblePx = heroFlareVisiblePx.toFixed(1);
            canvas.dataset.riteHeroTravelCoreVisiblePx = heroTravelCoreVisiblePx.toFixed(1);
            canvas.dataset.riteHeroTravelPlumeVisiblePx = heroTravelPlumeVisiblePx.toFixed(1);
            canvas.dataset.riteHeroTravelSpanFraction = heroTravelSpanFraction.toFixed(6);
            canvas.dataset.riteHeroTravelAxis = heroCue ? `${heroTravelAxisX.toFixed(6)},${heroTravelAxisY.toFixed(6)}` : "";
            canvas.dataset.riteHeroAxisTailVisible = String(heroAxisTailVisible);
            canvas.dataset.riteHeroAxisTailStrength = heroAxisTailStrength.toFixed(3);
            canvas.dataset.riteHeroAxisTailAxis = heroAxisTailAxis;
            canvas.dataset.riteHeroBurstVisiblePx = heroBurstVisiblePx.toFixed(1);
            canvas.dataset.riteHeroBurstHoldActive = String(heroBurstHoldActive);
            canvas.dataset.riteHeroImpactVisiblePx = heroImpactVisiblePx.toFixed(1);
            canvas.dataset.riteHeroImpactHoldActive = String(heroImpactHoldActive);
            canvas.dataset.riteHeroContactFrontActive = String(heroContactFrontActive);
            canvas.dataset.riteHeroContactTargetWidthPx = heroContactTargetWidthPx.toFixed(1);
            canvas.dataset.riteHeroContactSpanPx = heroContactSpanPx.toFixed(1);
            canvas.dataset.riteHeroContactTargetWidthRatio = heroContactTargetWidthPx > 0
                ? (heroContactSpanPx / heroContactTargetWidthPx).toFixed(3)
                : "0";
            canvas.dataset.riteHeroImpactSpriteVisible = String(heroImpactSpriteVisible);
            canvas.dataset.riteHeroImpactSpriteDraws = String(heroImpactSpriteDraws);
            canvas.dataset.riteHeroImpactSpriteRotationRad = heroImpactSpriteRotationRad.toFixed(6);
            canvas.dataset.riteHeroImpactSpriteAxis = heroImpactSpriteAxis;
            canvas.dataset.riteHeroImpactSpriteFootprintPx = heroImpactSpriteFootprintPx.toFixed(1);
            canvas.dataset.riteHeroImpactSpriteTargetWidthRatio = heroContactTargetWidthPx > 0
                ? (heroImpactSpriteFootprintPx / heroContactTargetWidthPx).toFixed(3)
                : "0";
            canvas.dataset.riteHeroImpactLegacyPrimitiveDraws = "0";
            const residueMaterial = heroResidue.current?.material as THREE.MeshBasicMaterial | undefined;
            const residueSmokeMaterial = heroFlare.current?.material as THREE.MeshBasicMaterial | undefined;
            canvas.dataset.riteHeroResidueDepthTest = String(residueMaterial?.depthTest === true);
            canvas.dataset.riteHeroResidueSmokeRenderOrder = String(heroFlare.current?.renderOrder ?? -1);
            canvas.dataset.riteHeroResidueSmokeDepthTest = String(residueSmokeMaterial?.depthTest === true);
            canvas.dataset.riteHeroResidueVisible = String(heroResidueVisible);
            canvas.dataset.riteHeroResidueSpanPx = heroResidueSpanPx.toFixed(1);
            canvas.dataset.riteHeroResidueMaterialStrength = heroResidueMaterialStrength.toFixed(3);
            canvas.dataset.riteHeroDamageVisible = String(heroDamageVisible);
        }
    });

    return (
        <group name="wfr-authoritative-attack-causality">
            <instancedMesh ref={streaks} args={[undefined, undefined, ATTACK_CAUSALITY_CAPACITY]} frustumCulled={false} renderOrder={6}>
                <boxGeometry args={[0.09, 0.045, 1]} />
                <meshBasicMaterial color="#fff" transparent opacity={0.5} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </instancedMesh>
            <instancedMesh ref={tells} args={[undefined, undefined, ATTACK_CAUSALITY_CAPACITY]} frustumCulled={false} renderOrder={6}>
                <torusGeometry args={[1, 0.075, 5, 24]} />
                <meshBasicMaterial color="#fff" transparent opacity={0.7} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </instancedMesh>
            <instancedMesh ref={contacts} args={[undefined, undefined, ATTACK_CAUSALITY_CAPACITY]} frustumCulled={false} renderOrder={7}>
                <octahedronGeometry args={[1, 0]} />
                <meshBasicMaterial color="#fff" wireframe transparent opacity={0.78} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </instancedMesh>
            <instancedMesh ref={particles} args={[undefined, undefined, ATTACK_CAUSALITY_CAPACITY * ATTACK_PARTICLES_PER_CUE]} frustumCulled={false} renderOrder={8}>
                <tetrahedronGeometry args={[1, 0]} />
                <meshBasicMaterial color="#fff" transparent opacity={0.68} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </instancedMesh>
            <mesh ref={heroFlare} visible={false} frustumCulled={false} renderOrder={7}>
                <shapeGeometry args={[heroFlareShapes, 12]} />
                <meshBasicMaterial color="#ff6925" transparent opacity={0.9} side={THREE.DoubleSide} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh ref={heroTravelPlume} visible={false} frustumCulled={false} renderOrder={8}>
                <shapeGeometry args={[heroBoltShapes, 12]} />
                <meshBasicMaterial color="#ff7428" transparent opacity={0.9} side={THREE.DoubleSide} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh ref={heroTravelCore} visible={false} frustumCulled={false} renderOrder={9}>
                <sphereGeometry args={[1, 8, 6]} />
                <meshBasicMaterial color="#fff4ce" transparent opacity={0.98} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh ref={heroImpactSprite} visible={false} frustumCulled={false} renderOrder={WARFRONT_THREE_HERO_CONTACT_SPRITE_FRONT_RENDER_ORDER}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial map={heroImpactTexture} color="#fff" transparent alphaTest={0.01} opacity={1} side={THREE.DoubleSide} depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.NormalBlending} />
            </mesh>
            <mesh ref={heroResidue} visible={false} frustumCulled={false} renderOrder={WARFRONT_THREE_HERO_RESIDUE_RENDER_ORDER}>
                <shapeGeometry args={[heroScorchShapes, 12]} />
                <meshBasicMaterial color="#8e3322" transparent opacity={0.88} side={THREE.DoubleSide} depthTest depthWrite={false} toneMapped={false} />
            </mesh>
            <group ref={heroHealth} visible={false} renderOrder={10}>
                <mesh renderOrder={10}>
                    <planeGeometry args={[1.42, 0.16]} />
                    <meshBasicMaterial color="#02070a" transparent opacity={0.92} depthTest={false} depthWrite={false} toneMapped={false} />
                </mesh>
                <mesh ref={heroHealthFill} position={[0, 0, 0.012]} renderOrder={11}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial color="#ff5268" transparent opacity={0.94} depthTest={false} depthWrite={false} toneMapped={false} />
                </mesh>
                <mesh ref={heroHealthLoss} position={[0, 0, 0.018]} renderOrder={12}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial color="#ffd166" transparent opacity={0.98} depthTest={false} depthWrite={false} toneMapped={false} />
                </mesh>
            </group>
            <mesh ref={heroDamage} visible={false} frustumCulled={false} renderOrder={WARFRONT_THREE_HERO_DAMAGE_RENDER_ORDER}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial map={heroDamageTexture} transparent alphaTest={0.02} depthTest={false} depthWrite={false} toneMapped={false} />
            </mesh>
        </group>
    );
}

// ── Impact VFX ──────────────────────────────────────────────────────────────

type CombatFxKind = "hit" | "crit" | "heal" | "guard" | "cast" | "ultimate" | "dodge" | "ko" | "objective";
type ImpactSlot = {
    active: boolean;
    t: number;
    x: number;
    z: number;
    originX: number;
    originZ: number;
    color: string;
    kind: CombatFxKind;
    label: string;
    seed: number;
};

const fxLife = (kind: CombatFxKind): number => kind === "objective" ? 1.7 : kind === "ko" ? 1.55 : kind === "ultimate" ? 1.25 : kind === "cast" ? 0.88 : kind === "heal" || kind === "guard" ? 1.02 : 0.74;

function CombatPulse({ slot, clockRef, sparkCount }: {
    slot: MutableRefObject<ImpactSlot>;
    clockRef: MutableRefObject<number>;
    sparkCount: number;
}) {
    const group = useRef<THREE.Group>(null);
    const burst = useRef<THREE.Group>(null);
    const spinner = useRef<THREE.Group>(null);
    const link = useRef<THREE.Group>(null);
    const core = useRef<THREE.MeshBasicMaterial>(null);
    const beam = useRef<THREE.MeshBasicMaterial>(null);
    const linkMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const shield = useRef<THREE.MeshBasicMaterial>(null);
    const blades = useRef<THREE.InstancedMesh>(null);
    const shards = useRef<THREE.InstancedMesh>(null);
    const shardMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const instanceTransform = useMemo(() => new THREE.Object3D(), []);
    const label = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const mesh = blades.current;
        if (!mesh) return;
        for (let blade = 0; blade < 4; blade++) {
            instanceTransform.position.set(0.31, 0, 0);
            instanceTransform.rotation.set(0, 0, blade * Math.PI / 2);
            instanceTransform.scale.set(1, 1, 1);
            instanceTransform.updateMatrix();
            mesh.setMatrixAt(blade, instanceTransform.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
    }, [instanceTransform]);
    useFrame(() => {
        const node = group.current;
        const burstNode = burst.current;
        const s = slot.current;
        if (!node || !burstNode) return;
        if (!s.active) { node.visible = false; return; }
        const age = (clockRef.current - s.t) / DUEL_TPS;
        const life = fxLife(s.kind);
        if (age < 0 || age > life) { node.visible = false; s.active = false; return; }
        const k = age / life;
        const emphatic = s.kind === "crit" || s.kind === "ko" || s.kind === "ultimate" || s.kind === "objective";
        const ultimate = s.kind === "ultimate";
        const cast = s.kind === "cast";
        const restorative = s.kind === "heal" || s.kind === "guard";
        node.visible = true;
        node.position.set(s.x, 0.06, s.z);
        burstNode.scale.setScalar((ultimate ? 1.48 : emphatic ? 1.82 : restorative ? 1.22 : 1.08) * (0.3 + k * 1.18));
        if (spinner.current) spinner.current.rotation.y = (s.seed * 0.37) + k * Math.PI * (emphatic ? 3.4 : 1.6);
        for (const mat of [core.current, beam.current, shield.current]) {
            if (!mat) continue;
            mat.color.set(s.color);
            mat.opacity = (1 - k) * (ultimate ? 0.68 : emphatic ? 0.78 : restorative ? 0.68 : 0.6);
        }
        if (shield.current) shield.current.opacity = s.kind === "guard" ? (1 - k) * 0.72 : 0;
        if (beam.current) beam.current.opacity *= s.kind === "ko" || s.kind === "ultimate" ? 1 : 0.38;

        const dx = s.originX - s.x;
        const dz = s.originZ - s.z;
        const travel = Math.hypot(dx, dz);
        if (link.current && linkMaterial.current) {
            const showLink = (s.kind === "hit" || s.kind === "crit" || s.kind === "ultimate") && travel > 0.3 && k < 0.58;
            link.current.visible = showLink;
            if (showLink) {
                link.current.position.set(dx * 0.5, 0.62 + Math.sin(k * Math.PI) * 0.18, dz * 0.5);
                link.current.rotation.y = Math.atan2(dx, dz);
                link.current.scale.set(emphatic ? 1.55 : 1, emphatic ? 1.35 : 1, travel);
                linkMaterial.current.color.set(s.color);
                linkMaterial.current.opacity = (1 - k / 0.58) * (emphatic ? 0.92 : 0.62);
            }
        }

        const shardMesh = shards.current;
        const shardMat = shardMaterial.current;
        if (shardMesh && shardMat) {
            shardMat.color.set(s.color);
            shardMat.opacity = Math.min(1, (1 - k) * 1.8);
        }
        for (let i = 0; i < 8; i++) {
            const show = !cast && s.kind !== "dodge" && i < sparkCount;
            if (!shardMesh) break;
            const angle = (i / Math.max(1, sparkCount)) * Math.PI * 2 + s.seed * 0.71;
            const radius = restorative ? 0.22 + (i % 2) * 0.12 : (0.16 + k * (emphatic ? 1.9 : 1.25));
            const rise = restorative ? 0.12 + k * (1.5 + (i % 3) * 0.22) : 0.28 + Math.sin(k * Math.PI) * (0.7 + (i % 2) * 0.25);
            instanceTransform.position.set(Math.cos(angle) * radius, rise, Math.sin(angle) * radius);
            instanceTransform.rotation.set(k * 5 + i, angle, k * 3.2);
            instanceTransform.scale.setScalar(show ? Math.max(0.02, (1 - k) * (emphatic ? 0.16 : 0.11)) : 0);
            instanceTransform.updateMatrix();
            shardMesh.setMatrixAt(i, instanceTransform.matrix);
        }
        if (shardMesh) shardMesh.instanceMatrix.needsUpdate = true;
        if (label.current) {
            label.current.textContent = s.label;
            label.current.style.color = s.color;
            label.current.style.opacity = String(Math.min(1, (1 - k) * 1.7));
            label.current.style.transform = `translateY(${-k * 32}px) scale(${emphatic ? 1.12 : 1})`;
        }
    });
    return (
        <group ref={group} visible={false}>
            <group ref={burst}>
                {/* A procedural four-point shuriken flare replaces the retired
                    painted sci-fi crest while keeping impacts cheap on phones. */}
                <group position={[0, 0.76, 0]} rotation={[Math.PI / 2, 0, Math.PI / 4]}>
                    <instancedMesh ref={blades} args={[undefined, undefined, 4]} frustumCulled={false}>
                        <coneGeometry args={[0.18, 0.66, 3]} />
                        <meshBasicMaterial color="#ffffff" transparent opacity={0.42} depthWrite={false} blending={THREE.AdditiveBlending} />
                    </instancedMesh>
                </group>
                <group ref={spinner}>
                    <mesh position={[0, 0.72, 0]} rotation={[0.4, 0.3, 0]}>
                        <octahedronGeometry args={[0.34, 0]} />
                        <meshBasicMaterial ref={core} wireframe transparent depthWrite={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                    <mesh position={[0, 0.76, 0]}>
                        <cylinderGeometry args={[0.035, 0.2, 1.5, 8, 1, true]} />
                        <meshBasicMaterial ref={beam} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh position={[0, 0.68, 0]}>
                        <sphereGeometry args={[0.68, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
                        <meshBasicMaterial ref={shield} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                    </mesh>
                </group>
                <instancedMesh ref={shards} args={[undefined, undefined, 8]} frustumCulled={false}>
                    <octahedronGeometry args={[1, 0]} />
                    <meshBasicMaterial ref={shardMaterial} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
                </instancedMesh>
            </group>
            <group ref={link} visible={false}>
                <mesh>
                    <boxGeometry args={[0.08, 0.08, 1]} />
                    <meshBasicMaterial ref={linkMaterial} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
                </mesh>
            </group>
        </group>
    );
}

function fxKind(event: DuelEvent): CombatFxKind | null {
    if (event.type === "seal_capture" || event.type === "vault_open" || event.type === "relic_pickup" || event.type === "relic_drop" || event.type === "relic_return" || event.type === "capture") return "objective";
    if (event.type === "hit") return event.crit ? "crit" : "hit";
    if (event.type === "heal") return "heal";
    if (event.type === "shield" || event.type === "buff") return "guard";
    if (event.type === "cast" || event.type === "windup") return "cast";
    if (event.type === "ultimate") return "ultimate";
    if (event.type === "dodge") return "dodge";
    if (event.type === "ko") return "ko";
    return null;
}

function fxLabel(event: DuelEvent, kind: CombatFxKind): string {
    if (kind === "objective") {
        if (event.type === "seal_capture") return "CIPHER CLAIMED";
        if (event.type === "vault_open") return "VAULT BREACHED";
        if (event.type === "capture") return "SCROLL EXTRACTED";
        if (event.type === "relic_pickup") return "SCROLL CLAIMED";
        if (event.type === "relic_return") return "SUBSTITUTION TAG";
        return "SCROLL DROPPED";
    }
    if (kind === "crit") return `CRIT -${Math.max(1, Math.round(event.dmg ?? 1))}`;
    if (kind === "hit") return "";
    if (kind === "cast") return "";
    if (kind === "heal") return "RESTORE";
    if (kind === "guard") return "";
    if (kind === "ultimate") return "ULTIMATE";
    if (kind === "dodge") return "EVADE";
    return "DOWN";
}

/** Drives the complete event language: hits, casts, heals, guards, dodges and
 *  knockouts all have different silhouettes instead of invisible bookkeeping. */
function ImpactLayer({ result, clockRef, quality, batched = false }: {
    result: DuelResult;
    clockRef: MutableRefObject<number>;
    quality: PetVisualQualityConfig;
    batched?: boolean;
}) {
    const capacity = quality.impactSparks >= 7 ? 16 : 9;
    const sparkCount = Math.min(8, Math.max(4, quality.impactSparks));
    const slots = useMemo<MutableRefObject<ImpactSlot>[]>(
        () => Array.from({ length: capacity }, () => ({ current: {
            active: false, t: -1, x: 0, z: 0, originX: 0, originZ: 0,
            color: "#fff", kind: "hit", label: "", seed: 0,
        } })),
        [capacity],
    );
    const byTick = useMemo(() => bucketEvents(result.events), [result]);
    const lastTick = useRef(-1);
    const lastUltimateLabelTick = useRef(-DUEL_TPS * 10);
    const cursor = useRef(0);

    useFrame(() => {
        const tick = Math.floor(clockRef.current);
        if (tick === lastTick.current) return;
        const from = lastTick.current < 0 || tick < lastTick.current ? tick : lastTick.current + 1;
        for (let t = from; t <= tick; t++) {
            const events = byTick.get(t);
            if (!events) continue;
            for (const event of events) {
                const kind = fxKind(event);
                if (!kind) continue;
                const id = event.type === "hit" && event.targetId ? event.targetId : event.actorId;
                const [team, laneText] = String(id).split("-");
                const lane = Number(laneText);
                if ((team !== "player" && team !== "enemy") || !Number.isInteger(lane)) continue;
                const pose = sampleActor(result, team, lane, t);
                const [actorTeam, actorLaneText] = String(event.actorId).split("-");
                const actorLane = Number(actorLaneText);
                const actorPose = (actorTeam === "player" || actorTeam === "enemy") && Number.isInteger(actorLane)
                    ? sampleActor(result, actorTeam, actorLane, t)
                    : pose;
                const slot = slots[cursor.current % slots.length];
                cursor.current++;
                slot.current.active = true;
                slot.current.t = t;
                slot.current.x = pose.x * WORLD_SCALE;
                slot.current.z = pose.z * WORLD_SCALE;
                slot.current.originX = actorPose.x * WORLD_SCALE;
                slot.current.originZ = actorPose.z * WORLD_SCALE;
                slot.current.kind = kind;
                const announceUltimate = kind !== "ultimate" || t - lastUltimateLabelTick.current >= DUEL_TPS;
                if (kind === "ultimate" && announceUltimate) lastUltimateLabelTick.current = t;
                const focusBreak = kind === "ko"
                    ? squadFocusAt(result, event.side === "player" ? "enemy" : "player", Math.max(0, t - 1))
                    : null;
                slot.current.label = !announceUltimate ? "" : focusBreak
                    && `${focusBreak.target.team}-${focusBreak.target.lane}` === event.actorId
                    ? "FOCUS BREAK"
                    : fxLabel(event, kind);
                slot.current.seed = cursor.current + t * 0.031;
                slot.current.color = kind === "heal" ? "#79ffc1"
                    : kind === "objective" ? (event.side === "player" ? TEAM_COLOR.player : TEAM_COLOR.enemy)
                    : kind === "guard" ? "#83e8ff"
                    : kind === "dodge" ? "#f4fbff"
                    : kind === "ko" ? "#ff5470"
                    : kind === "hit" || kind === "crit" || kind === "ultimate" ? TEAM_COLOR[event.side]
                    : elementColor(event.element);
            }
        }
        lastTick.current = tick;
    });

    // The constrained/QA route already owns an authoritative streak, contact
    // flash and body reaction. Its former transparent octahedron pool
    // composited as black wire glyphs against the CSS-backed court, so it
    // submits no duplicate impact-debris geometry.
    return batched
        ? null
        : <>{slots.map((slot, i) => <CombatPulse key={i} slot={slot} clockRef={clockRef} sparkCount={sparkCount} />)}</>;
}

/** Snapshot-native projectile bolts. A small fixed pool keeps the phone path
 *  allocation-free while making ranged attacks physically travel to targets. */
function ProjectileLayer({ result, clockRef, quality }: {
    result: DuelResult;
    clockRef: MutableRefObject<number>;
    quality: PetVisualQualityConfig;
}) {
    const capacity = quality.setPieceParticles <= 28 ? 10 : 18;
    const cores = useRef<THREE.InstancedMesh>(null);
    const trails = useRef<THREE.InstancedMesh>(null);
    const transform = useMemo(() => new THREE.Object3D(), []);
    const tint = useMemo(() => new THREE.Color(), []);
    const projectilePool = useMemo(
        () => Array.from({ length: capacity }, () => ({ id: -1, x: 0, y: 0, team: "player" as const, kind: "damage" as const, element: null })),
        [capacity],
    );
    const previousIds = useMemo(() => new Int32Array(capacity).fill(-1), [capacity]);
    const previousX = useMemo(() => new Float32Array(capacity), [capacity]);
    const previousZ = useMemo(() => new Float32Array(capacity), [capacity]);
    const nextIds = useMemo(() => new Int32Array(capacity).fill(-1), [capacity]);
    const nextX = useMemo(() => new Float32Array(capacity), [capacity]);
    const nextZ = useMemo(() => new Float32Array(capacity), [capacity]);

    useLayoutEffect(() => {
        transform.position.set(0, -100, 0);
        transform.rotation.set(0, 0, 0);
        transform.scale.setScalar(0);
        transform.updateMatrix();
        for (const mesh of [cores.current, trails.current]) {
            if (!mesh) continue;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            for (let index = 0; index < capacity; index++) mesh.setMatrixAt(index, transform.matrix);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
        }
    }, [capacity, transform]);

    useFrame(() => {
        const coreMesh = cores.current;
        const trailMesh = trails.current;
        if (!coreMesh || !trailMesh) return;
        const count = sampleProjectilesInto(result, clockRef.current, projectilePool, capacity);
        nextIds.fill(-1);
        for (let i = 0; i < capacity; i++) {
            const projectile = i < count ? projectilePool[i] : null;
            if (!projectile) {
                transform.position.set(0, -100, 0);
                transform.rotation.set(0, 0, 0);
                transform.scale.setScalar(0);
                transform.updateMatrix();
                coreMesh.setMatrixAt(i, transform.matrix);
                trailMesh.setMatrixAt(i, transform.matrix);
                continue;
            }
            const x = projectile.x * WORLD_SCALE;
            const z = projectile.y * WORLD_SCALE;
            let oldIndex = -1;
            for (let candidate = 0; candidate < capacity; candidate++) {
                if (previousIds[candidate] === projectile.id) { oldIndex = candidate; break; }
            }
            let yaw = projectile.team === "player" ? Math.PI / 2 : -Math.PI / 2;
            if (oldIndex >= 0) {
                const dx = x - previousX[oldIndex];
                const dz = z - previousZ[oldIndex];
                if (Math.hypot(dx, dz) > 0.0001) yaw = Math.atan2(dx, dz);
            }
            nextIds[i] = projectile.id;
            nextX[i] = x;
            nextZ[i] = z;
            tint.set(elementColor(projectile.element));

            transform.position.set(x, 0.82, z);
            transform.rotation.set(0, yaw, 0);
            transform.scale.setScalar(1);
            transform.updateMatrix();
            coreMesh.setMatrixAt(i, transform.matrix);
            coreMesh.setColorAt(i, tint);

            transform.position.set(x - Math.sin(yaw) * 0.46, 0.82, z - Math.cos(yaw) * 0.46);
            transform.rotation.set(0, yaw, 0);
            transform.scale.set(1, 1, 2.8);
            transform.updateMatrix();
            trailMesh.setMatrixAt(i, transform.matrix);
            trailMesh.setColorAt(i, tint);
        }
        previousIds.set(nextIds);
        previousX.set(nextX);
        previousZ.set(nextZ);
        for (const mesh of [coreMesh, trailMesh]) {
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
    });

    return (
        <group name="wfr-batched-projectile-layer">
            <instancedMesh ref={cores} args={[undefined, undefined, capacity]} frustumCulled={false}>
                <sphereGeometry args={[0.2, 10, 8]} />
                <meshBasicMaterial vertexColors color="#fff" depthWrite={false} blending={THREE.AdditiveBlending} />
            </instancedMesh>
            <instancedMesh ref={trails} args={[undefined, undefined, capacity]} frustumCulled={false}>
                <sphereGeometry args={[0.13, 8, 6]} />
                <meshBasicMaterial vertexColors color="#fff" transparent opacity={0.42} depthWrite={false} blending={THREE.AdditiveBlending} />
            </instancedMesh>
        </group>
    );
}

// ── Camera ──────────────────────────────────────────────────────────────────

/** Side-on broadcast camera. Its orientation never rotates, but its centre and
 * distance ease toward the living action so pets remain the subject after KOs. */
function ClashCamera({ result, clockRef }: Readonly<{ result: DuelResult; clockRef: MutableRefObject<number> }>) {
    const camera = useThree((state) => state.camera);
    const viewport = useThree((state) => state.size);
    const lookRef = useRef(new THREE.Vector3(0, 0.08, 0));
    const distanceRef = useRef(0);
    const desiredPosition = useMemo(() => new THREE.Vector3(), []);
    const desiredLook = useMemo(() => new THREE.Vector3(), []);

    useFrame((_, delta) => {
        const portrait = viewport.height > viewport.width;
        const desiredFov = portrait ? 43 : 39;
        const focus = actionFocus(result, clockRef.current);
        desiredLook.set(focus.x * WORLD_SCALE, 0.08, focus.z * WORLD_SCALE);
        const focusRadius = Math.max(portrait ? 3.25 : 4.1, Math.min(10.5, focus.radius * WORLD_SCALE + (portrait ? 1.6 : 2.1)));
        const aspect = Math.max(0.35, viewport.width / Math.max(1, viewport.height));
        const desiredDistance = fitDistance(focusRadius, focusRadius * 0.72 + 2.1, desiredFov, aspect);
        const elapsed = Math.min(0.05, Math.max(0.001, delta));
        const centreAlpha = 1 - Math.exp(-elapsed * 3.2);
        const distanceAlpha = 1 - Math.exp(-elapsed * 2.4);
        lookRef.current.lerp(desiredLook, centreAlpha);
        distanceRef.current = distanceRef.current > 0
            ? THREE.MathUtils.lerp(distanceRef.current, desiredDistance, distanceAlpha)
            : desiredDistance;
        // Always look across +Z—even in portrait—so blue remains screen-left,
        // red remains screen-right, and target-facing silhouettes are readable.
        const elevation = portrait ? 0.98 : 0.84;
        const groundDistance = distanceRef.current / Math.sqrt(1 + elevation * elevation);
        desiredPosition.set(
            lookRef.current.x,
            lookRef.current.y + groundDistance * elevation,
            lookRef.current.z + groundDistance,
        );
        const perspective = camera as THREE.PerspectiveCamera;
        if (perspective.fov !== desiredFov) {
            perspective.fov = desiredFov;
            perspective.updateProjectionMatrix();
        }
        camera.position.copy(desiredPosition);
        camera.lookAt(lookRef.current);
    });
    return null;
}

// ── Stage ───────────────────────────────────────────────────────────────────

function sampleObjective(result: DuelResult, t: number, id: DuelObjectiveId): DuelObjectiveSnap | null {
    if (!result.snapshots.length) return null;
    const clamped = Math.max(0, Math.min(result.snapshots.length - 1, t));
    const i = Math.floor(clamped), mix = clamped - i;
    const a = result.snapshots[i]?.objectives?.find((objective) => objective.id === id);
    const b = result.snapshots[Math.min(i + 1, result.snapshots.length - 1)]?.objectives?.find((objective) => objective.id === id);
    if (!a) return null;
    if (!b || b.state !== a.state || b.carrierId !== a.carrierId) return a;
    return { ...a, x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix, progress: a.progress + (b.progress - a.progress) * mix };
}

const ARENA_FLOOR_DECAL_ALPHA_CAP = 0.18;
const ARENA_OBJECTIVE_DECAL_RADIUS_WORLD = 0.285;

/** The authored court owns all architecture. Three submits only a small relic
 * and one hairline state decal; collision/cover remain unchanged simulation
 * data and never become beige blockers, oversized rings, gates or debris. */
function FloorFlushRelicObjective({ result, clockRef }: {
    result: DuelResult;
    clockRef: MutableRefObject<number>;
}) {
    const root = useRef<THREE.Group>(null);
    const token = useRef<THREE.Group>(null);
    const decal = useRef<THREE.MeshBasicMaterial>(null);
    const tie = useRef<THREE.MeshStandardMaterial>(null);
    const canvas = useThree((state) => state.gl.domElement);
    const tint = useMemo(() => new THREE.Color(), []);

    useEffect(() => () => {
        delete canvas.dataset.riteArenaPrototypeDressingDraws;
        delete canvas.dataset.riteArenaPrototypeDressingMeshes;
        delete canvas.dataset.riteArenaGlyphDebrisDraws;
        delete canvas.dataset.riteArenaGlyphDebrisMeshes;
        delete canvas.dataset.riteArenaFloorDecalDraws;
        delete canvas.dataset.riteArenaFloorDecalMaxAlpha;
        delete canvas.dataset.riteArenaFloorDecalMaxRadiusWorld;
        delete canvas.dataset.riteArenaScrollPropDraws;
        delete canvas.dataset.riteArenaScrollPropMeshes;
    }, [canvas]);

    useFrame(() => {
        const scroll = sampleObjective(result, clockRef.current, "forbidden-scroll") ?? {
            x: 0,
            y: 0,
            state: "sealed" as const,
            carrierId: null,
            owner: null,
        };
        if (!root.current || !token.current || !decal.current || !tie.current) return;
        root.current.visible = true;
        root.current.position.set(scroll.x * WORLD_SCALE, 0, scroll.y * WORLD_SCALE);
        token.current.rotation.y = Math.sin(clockRef.current * 0.025) * 0.04;
        token.current.scale.setScalar(scroll.state === "carried" ? 0.82 : 1);
        const team = scroll.carrierId?.startsWith("player-") ? "player"
            : scroll.carrierId?.startsWith("enemy-") ? "enemy"
                : scroll.owner;
        const color = team ? TEAM_COLOR[team] : "#d6b775";
        const alpha = Math.min(ARENA_FLOOR_DECAL_ALPHA_CAP,
            scroll.state === "dropped" ? 0.18 : scroll.state === "carried" ? 0.14 : 0.12);
        decal.current.color.copy(tint.set(color));
        decal.current.opacity = alpha;
        tie.current.color.copy(tint.set(color));
        tie.current.emissive.copy(tint.multiplyScalar(0.12));

        // These values describe submitted scene geometry, not intent counters:
        // three KageBoardCells decal draw families plus this one relic ring;
        // four tiny scroll meshes; zero prototype-dressing submissions.
        canvas.dataset.riteArenaPrototypeDressingDraws = "0";
        canvas.dataset.riteArenaPrototypeDressingMeshes = "0";
        canvas.dataset.riteArenaGlyphDebrisDraws = "0";
        canvas.dataset.riteArenaGlyphDebrisMeshes = "0";
        canvas.dataset.riteArenaFloorDecalDraws = "4";
        canvas.dataset.riteArenaFloorDecalMaxAlpha = Math.max(ARENA_FLOOR_DECAL_ALPHA_CAP, alpha).toFixed(3);
        canvas.dataset.riteArenaFloorDecalMaxRadiusWorld = ARENA_OBJECTIVE_DECAL_RADIUS_WORLD.toFixed(3);
        canvas.dataset.riteArenaScrollPropDraws = "4";
        canvas.dataset.riteArenaScrollPropMeshes = "4";
    });

    return (
        <group ref={root} visible={false} name="wfr-floor-flush-relic-objective">
            <mesh position={[0, 0.034, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
                <ringGeometry args={[0.255, ARENA_OBJECTIVE_DECAL_RADIUS_WORLD, 32]} />
                <meshBasicMaterial ref={decal} color="#d6b775" transparent opacity={0.12} depthWrite={false} />
            </mesh>
            <group ref={token} position={[0, 0.064, 0]} name="wfr-small-scroll-relic">
                <mesh>
                    <boxGeometry args={[0.46, 0.028, 0.2]} />
                    <meshStandardMaterial color="#d9c391" roughness={0.88} metalness={0} />
                </mesh>
                {([-1, 1] as const).map((side) => (
                    <mesh key={side} position={[side * 0.245, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                        <cylinderGeometry args={[0.055, 0.055, 0.23, 10]} />
                        <meshStandardMaterial color="#503020" roughness={0.82} metalness={0.02} />
                    </mesh>
                ))}
                <mesh position={[0, 0.021, 0]}>
                    <boxGeometry args={[0.045, 0.018, 0.22]} />
                    <meshStandardMaterial ref={tie} color="#8f7442" emissive="#1b150c" emissiveIntensity={0.18} roughness={0.58} metalness={0.12} />
                </mesh>
            </group>
        </group>
    );
}

function KageSlateSurface({ width, depth }: { width: number; depth: number }) {
    const source = useLoader(THREE.TextureLoader, KAGE_SLATE_TEXTURE_URL);
    const courtShape = useMemo(() => {
        const halfX = width * 0.5;
        const halfZ = depth * 0.5;
        const cutX = halfX * 0.18;
        const cutZ = halfZ * 0.22;
        const shape = new THREE.Shape();
        shape.moveTo(-halfX + cutX, -halfZ);
        shape.lineTo(halfX - cutX, -halfZ);
        shape.lineTo(halfX, -halfZ + cutZ);
        shape.lineTo(halfX, halfZ - cutZ);
        shape.lineTo(halfX - cutX, halfZ);
        shape.lineTo(-halfX + cutX, halfZ);
        shape.lineTo(-halfX, halfZ - cutZ);
        shape.lineTo(-halfX, -halfZ + cutZ);
        shape.closePath();
        return shape;
    }, [depth, width]);
    const texture = useMemo(() => {
        const clone = source.clone();
        clone.colorSpace = THREE.SRGBColorSpace;
        clone.wrapS = THREE.RepeatWrapping;
        clone.wrapT = THREE.RepeatWrapping;
        clone.repeat.set(3.5, 2.5);
        clone.anisotropy = 2;
        clone.needsUpdate = true;
        return clone;
    }, [source]);
    useEffect(() => () => texture.dispose(), [texture]);
    return (
        <group name="wfr-authored-slate-surface">
            {/* The tight actor footprint layer supplies contact; omitting a
                full-court shadow catcher prevents large rig-shadow discs from
                darkening the authored stone. */}
            <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <shapeGeometry args={[courtShape]} />
                <meshStandardMaterial
                    map={texture}
                    color="#839092"
                    emissive="#11191b"
                    emissiveMap={texture}
                    emissiveIntensity={0.06}
                    roughness={0.9}
                    metalness={0.01}
                    transparent
                    opacity={0.075}
                    depthWrite={false}
                />
            </mesh>
        </group>
    );
}

/** Collision still owns thirty-five exact cells, but the rendered court is one
 * continuous authored surface with flush inlays instead of raised blocks. */
function KageBoardCells() {
    const rings = useRef<THREE.InstancedMesh>(null);
    const cellX = 3.2 * WORLD_SCALE;
    const cellZ = 3.0 * WORLD_SCALE;
    const courtWidth = cellX * 6.98;
    const courtDepth = cellZ * 4.98;
    const { boundaryGeometry, laneGeometry } = useMemo(() => {
        const halfX = courtWidth * 0.5;
        const halfZ = courtDepth * 0.5;
        const cutX = halfX * 0.18;
        const cutZ = halfZ * 0.22;
        const edge = [
            new THREE.Vector3(-halfX + cutX, 0.027, -halfZ),
            new THREE.Vector3(halfX - cutX, 0.027, -halfZ),
            new THREE.Vector3(halfX, 0.027, -halfZ + cutZ),
            new THREE.Vector3(halfX, 0.027, halfZ - cutZ),
            new THREE.Vector3(halfX - cutX, 0.027, halfZ),
            new THREE.Vector3(-halfX + cutX, 0.027, halfZ),
            new THREE.Vector3(-halfX, 0.027, halfZ - cutZ),
            new THREE.Vector3(-halfX, 0.027, -halfZ + cutZ),
        ];
        const boundary: THREE.Vector3[] = [];
        for (let index = 0; index < edge.length; index++) boundary.push(edge[index], edge[(index + 1) % edge.length]);
        const lanes: THREE.Vector3[] = [];
        for (const x of [-cellX, 0, cellX]) {
            lanes.push(new THREE.Vector3(x, 0.029, -halfZ * 0.86), new THREE.Vector3(x, 0.029, halfZ * 0.86));
        }
        return {
            boundaryGeometry: new THREE.BufferGeometry().setFromPoints(boundary),
            laneGeometry: new THREE.BufferGeometry().setFromPoints(lanes),
        };
    }, [cellX, courtDepth, courtWidth]);
    useEffect(() => () => {
        boundaryGeometry.dispose();
        laneGeometry.dispose();
    }, [boundaryGeometry, laneGeometry]);

    useLayoutEffect(() => {
        const ringMesh = rings.current;
        if (!ringMesh) return;
        const transform = new THREE.Object3D();
        const color = new THREE.Color();

        for (let index = 0; index < 35; index++) {
            const col = index % 7;
            const row = Math.floor(index / 7);
            const x = (col - 3) * cellX;
            const z = (row - 2) * cellZ;
            const blue = col < 2;
            const red = col > 4;

            transform.position.set(x, 0.031, z);
            transform.rotation.set(-Math.PI / 2, 0, 0);
            transform.scale.setScalar(1);
            transform.updateMatrix();
            ringMesh.setMatrixAt(index, transform.matrix);
            ringMesh.setColorAt(index, color.set(blue ? "#77c9d6" : red ? "#d58a79" : "#c3a16a"));
        }

        ringMesh.instanceMatrix.needsUpdate = true;
        if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;
        ringMesh.computeBoundingSphere();
    }, [cellX, cellZ]);

    return (
        <group name="wfr-instanced-board-cells">
            <KageSlateSurface width={courtWidth} depth={courtDepth} />
            <lineSegments geometry={boundaryGeometry} renderOrder={1}>
                <lineBasicMaterial color="#b38b55" transparent opacity={ARENA_FLOOR_DECAL_ALPHA_CAP} depthWrite={false} />
            </lineSegments>
            <lineSegments geometry={laneGeometry} renderOrder={1}>
                <lineBasicMaterial color="#bca87a" transparent opacity={0.12} depthWrite={false} />
            </lineSegments>
            <instancedMesh ref={rings} args={[undefined, undefined, 35]}>
                <ringGeometry args={[0.15, 0.18, 16]} />
                <meshBasicMaterial vertexColors transparent opacity={0.11} depthWrite={false} />
            </instancedMesh>
        </group>
    );
}

/** Release-only objective probe. It observes the real Three camera and projects
 * the real tick-zero formation without introducing React updates. Normal player
 * URLs do no work; `ritemotionqa=1` exposes compact canvas data attributes for
 * Playwright and the local browser harness. */
function MotionReadabilityProbe({ result, clockRef }: { result: DuelResult; clockRef: MutableRefObject<number> }) {
    const camera = useThree((state) => state.camera);
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const canvas = gl.domElement;
    const enabled = useMemo(
        () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ritemotionqa") === "1",
        [],
    );
    const baseline = useRef<Float64Array | null>(null);
    const maxCameraDelta = useRef(0);
    const scratch = useMemo(() => new THREE.Vector3(), []);
    const initialActors = useMemo(() => result.snapshots[0]?.actors ?? [], [result]);
    const measuredFraming = useRef(false);
    const performanceObserver = useRef<PerformanceObserver | null>(null);
    const performanceFinish = useRef<number | null>(null);
    const performanceStarted = useRef(false);
    const sampleWindow = useRef<{ warmupEnds: number; sampleEnds: number } | null>(null);
    const lastRenderedAt = useRef<number | null>(null);
    const maxFrameGap = useRef(0);
    const frameGapsOver100 = useRef(0);
    const renderStatsAt = useRef(0);
    const measuredSceneCost = useRef(false);
    useEffect(() => {
        if (!enabled) return;
        const previousAutoReset = gl.info.autoReset;
        gl.info.autoReset = false;
        gl.info.reset();
        const removeAfterEffect = addAfterEffect((timestamp) => {
            if (timestamp - renderStatsAt.current >= 500) {
                renderStatsAt.current = timestamp;
                canvas.dataset.riteRenderCalls = String(gl.info.render.calls);
                canvas.dataset.riteRenderTriangles = String(gl.info.render.triangles);
                canvas.dataset.riteRenderPrograms = String(gl.info.programs?.length ?? 0);
            }
            // With autoReset disabled this counter contains every pass rendered
            // by this canvas, including a composer if another profile enables
            // one.  Reset only after the global render loop has finished.
            gl.info.reset();
        });
        return () => {
            removeAfterEffect();
            gl.info.reset();
            gl.info.autoReset = previousAutoReset;
        };
    }, [canvas, enabled, gl]);
    useEffect(() => () => {
        performanceObserver.current?.disconnect();
        if (performanceFinish.current !== null) window.clearTimeout(performanceFinish.current);
    }, []);

    useFrame(() => {
        if (!enabled) return;
        // The authoritative clock is held at zero until all eight rigs have
        // loaded and the reveal has settled. The 4s warmup also contains the
        // bounded provisional-hardware proof and any veiled atomic swap, so the
        // published eight-second metric always describes the final route.
        if (!performanceStarted.current && clockRef.current > 0 && typeof PerformanceObserver !== "undefined") {
            performanceStarted.current = true;
            const warmupEnds = performance.now() + 4_000;
            const sampleEnds = warmupEnds + 8_000;
            sampleWindow.current = { warmupEnds, sampleEnds };
            let count = 0;
            let max = 0;
            canvas.dataset.riteLongTaskSample = "warming";
            canvas.dataset.riteLongTasksOver100ms = "0";
            canvas.dataset.riteLongTaskMaxMs = "0";
            canvas.dataset.riteFrameGapMaxMs = "0";
            canvas.dataset.riteFrameGapsOver100ms = "0";
            const recordEntries = (entries: PerformanceEntryList) => {
                for (const entry of entries) {
                    if (entry.startTime < warmupEnds || entry.startTime >= sampleEnds || entry.duration <= 100) continue;
                    count++;
                    max = Math.max(max, entry.duration);
                }
            };
            const observer = new PerformanceObserver((list) => recordEntries(list.getEntries()));
            performanceObserver.current = observer;
            observer.observe({ type: "longtask", buffered: false });
            performanceFinish.current = window.setTimeout(() => {
                recordEntries(observer.takeRecords());
                observer.disconnect();
                canvas.dataset.riteLongTaskSample = "complete";
                canvas.dataset.riteLongTasksOver100ms = String(count);
                canvas.dataset.riteLongTaskMaxMs = max.toFixed(1);
                canvas.dataset.riteFrameGapMaxMs = maxFrameGap.current.toFixed(1);
                canvas.dataset.riteFrameGapsOver100ms = String(frameGapsOver100.current);
            }, 12_050);
        }
        const now = performance.now();
        const previousFrameAt = lastRenderedAt.current;
        const activeSample = sampleWindow.current;
        if (previousFrameAt !== null && activeSample && now >= activeSample.warmupEnds && now < activeSample.sampleEnds) {
            const gap = now - previousFrameAt;
            maxFrameGap.current = Math.max(maxFrameGap.current, gap);
            if (gap > 100) frameGapsOver100.current += 1;
        }
        lastRenderedAt.current = now;
        if (!measuredSceneCost.current && clockRef.current > 0) {
            let meshes = 0;
            let skinnedMeshes = 0;
            let visibleMeshes = 0;
            let visibleTriangles = 0;
            scene.traverse((node) => {
                if (!(node as THREE.Mesh).isMesh) return;
                meshes += 1;
                if ((node as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes += 1;
            });
            scene.traverseVisible((node) => {
                const mesh = node as THREE.Mesh;
                if (!mesh.isMesh) return;
                visibleMeshes += 1;
                const geometry = mesh.geometry;
                const primitiveTriangles = geometry.index
                    ? geometry.index.count / 3
                    : (geometry.getAttribute("position")?.count ?? 0) / 3;
                const instances = (mesh as THREE.InstancedMesh).isInstancedMesh
                    ? (mesh as THREE.InstancedMesh).count
                    : 1;
                visibleTriangles += primitiveTriangles * instances;
            });
            canvas.dataset.riteSceneMeshes = String(meshes);
            canvas.dataset.riteSceneSkinnedMeshes = String(skinnedMeshes);
            canvas.dataset.riteVisibleMeshes = String(visibleMeshes);
            canvas.dataset.riteVisibleTriangles = String(Math.round(visibleTriangles));
            measuredSceneCost.current = true;
        }
        camera.updateMatrixWorld(true);
        const values = baseline.current ?? new Float64Array(8);
        const position = camera.position;
        const rotation = camera.quaternion;
        const fov = (camera as THREE.PerspectiveCamera).fov;
        if (!baseline.current) {
            values[0] = position.x; values[1] = position.y; values[2] = position.z;
            values[3] = rotation.x; values[4] = rotation.y; values[5] = rotation.z; values[6] = rotation.w;
            values[7] = fov;
            baseline.current = values;
            canvas.dataset.riteCameraMaxDelta = "0";
        } else {
            maxCameraDelta.current = Math.max(maxCameraDelta.current,
                Math.abs(values[0] - position.x), Math.abs(values[1] - position.y), Math.abs(values[2] - position.z),
                Math.abs(values[3] - rotation.x), Math.abs(values[4] - rotation.y), Math.abs(values[5] - rotation.z),
                Math.abs(values[6] - rotation.w), Math.abs(values[7] - fov));
            if (maxCameraDelta.current > Number(canvas.dataset.riteCameraMaxDelta ?? 0)) {
                canvas.dataset.riteCameraMaxDelta = maxCameraDelta.current.toExponential(4);
            }
        }
        if (measuredFraming.current) return;

        const boardX = WARFRONT_ARENA_X * WORLD_SCALE * 1.17;
        const boardZ = WARFRONT_ARENA_Y * WORLD_SCALE * 1.24;
        let boardVisible = true;
        let boardMaxX = 0;
        let boardMaxY = 0;
        for (const x of [-boardX, boardX]) for (const z of [-boardZ, boardZ]) {
            scratch.set(x, 0, z).project(camera);
            boardMaxX = Math.max(boardMaxX, Math.abs(scratch.x));
            boardMaxY = Math.max(boardMaxY, Math.abs(scratch.y));
            boardVisible = boardVisible && Math.abs(scratch.x) <= 1 && Math.abs(scratch.y) <= 1 && scratch.z >= -1 && scratch.z <= 1;
        }
        let actorsVisible = 0;
        for (const actor of initialActors) {
            let visible = true;
            for (const y of [0, 2.5]) {
                scratch.set(actor.x * WORLD_SCALE, y, actor.y * WORLD_SCALE).project(camera);
                visible = visible && Math.abs(scratch.x) <= 1 && Math.abs(scratch.y) <= 1 && scratch.z >= -1 && scratch.z <= 1;
            }
            if (visible) actorsVisible++;
        }
        canvas.dataset.riteBoardVisible = String(boardVisible);
        canvas.dataset.riteBoardMaxX = boardMaxX.toFixed(4);
        canvas.dataset.riteBoardMaxY = boardMaxY.toFixed(4);
        canvas.dataset.riteInitialActorsVisible = String(actorsVisible);
        canvas.dataset.riteInitialActorsExpected = String(initialActors.length);
        measuredFraming.current = true;
    });
    return null;
}

/** QA-only evidence that the body, rather than the accent meshes, owns each
 * authoritative contact sentence. It samples the same allocation-free phase
 * selector used by both actor renderers and never mutates combat or scene state. */
function BodyReactionProbe({ result, beatsByActor, clockRef }: {
    result: DuelResult;
    beatsByActor: ReadonlyMap<string, readonly FighterContactBeat[]>;
    clockRef: MutableRefObject<number>;
}) {
    const canvas = useThree((state) => state.gl.domElement);
    const enabled = useMemo(
        () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ritemotionqa") === "1",
        [],
    );
    const slots = useMemo(() => [...beatsByActor.entries()].map(([actorId, beats]) => ({
        actorId,
        beats,
        phase: createWarfrontBodyReactionPhase(),
        scratch: createWarfrontBodyReactionPhase(),
    })), [beatsByActor]);
    const maxActive = useRef(0);
    const maxOffset = useRef(0);
    const lungeSeen = useRef(false);
    const recoilSeen = useRef(false);
    const koExitSeen = useRef(false);
    const visualTick = useRef(-1);
    const terminalTimeline = useRef<{ wall: number; baseTick: number } | null>(null);
    useEffect(() => {
        if (!enabled) return;
        let beatCount = 0;
        let lethalCount = 0;
        for (const slot of slots) for (const beat of slot.beats) {
            beatCount++;
            if (beat.lethal) lethalCount++;
        }
        canvas.dataset.riteBodyReactionEvents = String(beatCount);
        canvas.dataset.riteBodyLethalEvents = String(lethalCount);
        canvas.dataset.riteBodyRootMode = "presentation-child";
        canvas.dataset.riteBodyReactionMaxActive = "0";
        canvas.dataset.riteBodyReactionMaxOffset = "0";
        return () => {
            delete canvas.dataset.riteBodyReactionEvents;
            delete canvas.dataset.riteBodyLethalEvents;
            delete canvas.dataset.riteBodyRootMode;
            delete canvas.dataset.riteBodyLungeActive;
            delete canvas.dataset.riteBodyLethalLungeActive;
            delete canvas.dataset.riteBodyRecoilActive;
            delete canvas.dataset.riteBodyKoExitActive;
            delete canvas.dataset.riteBodyLungeSeen;
            delete canvas.dataset.riteBodyRecoilSeen;
            delete canvas.dataset.riteBodyKoExitSeen;
            delete canvas.dataset.riteBodyReactionMaxActive;
            delete canvas.dataset.riteBodyReactionMaxOffset;
            delete canvas.dataset.riteBodyReactionLast;
            delete canvas.dataset.riteBodyLethalLast;
        };
    }, [canvas, enabled, slots]);
    useFrame(({ clock }) => {
        if (!enabled) return;
        const tick = clockRef.current;
        if (visualTick.current >= 0 && tick < visualTick.current - 0.5) terminalTimeline.current = null;
        visualTick.current = tick;
        if (tick >= result.ticks - 0.001) {
            if (!terminalTimeline.current) terminalTimeline.current = { wall: clock.elapsedTime, baseTick: tick };
        } else terminalTimeline.current = null;
        const presentationTick = terminalTimeline.current
            ? terminalTimeline.current.baseTick + Math.max(0, clock.elapsedTime - terminalTimeline.current.wall) * DUEL_TPS
            : tick;
        let active = 0;
        let lunges = 0;
        let lethalLunges = 0;
        let recoils = 0;
        let koExits = 0;
        let lastActor = "";
        let lastBeat: FighterContactBeat | null = null;
        let lethalActor = "";
        let lethalBeat: FighterContactBeat | null = null;
        for (let index = 0; index < slots.length; index++) {
            const slot = slots[index];
            const beat = sampleFighterBodyReaction(slot.beats, presentationTick, slot.phase, slot.scratch);
            if (!beat) continue;
            active++;
            const phase = slot.phase;
            let causesKo = beat.lethal;
            for (let cueIndex = 0; !causesKo && cueIndex < beat.cues.length; cueIndex++) causesKo = beat.cues[cueIndex].lethal;
            if (phase.lunge > 0.01) {
                lunges++;
                if (causesKo) lethalLunges++;
                lungeSeen.current = true;
            }
            if (phase.recoil > 0.01) { recoils++; recoilSeen.current = true; }
            if (phase.koExit > 0.01) { koExits++; koExitSeen.current = true; }
            maxOffset.current = Math.max(maxOffset.current,
                phase.lunge * BODY_LUNGE_DISTANCE + phase.recoil * BODY_RECOIL_DISTANCE + phase.koExit * BODY_KO_EXIT_DISTANCE);
            if (!lastBeat || beat.tick > lastBeat.tick) {
                lastActor = slot.actorId;
                lastBeat = beat;
            }
            if (causesKo && (!lethalBeat || beat.tick > lethalBeat.tick || (beat.tick === lethalBeat.tick && beat.role === "target"))) {
                lethalActor = slot.actorId;
                lethalBeat = beat;
            }
        }
        maxActive.current = Math.max(maxActive.current, active);
        canvas.dataset.riteBodyLungeActive = String(lunges);
        canvas.dataset.riteBodyLethalLungeActive = String(lethalLunges);
        canvas.dataset.riteBodyRecoilActive = String(recoils);
        canvas.dataset.riteBodyKoExitActive = String(koExits);
        canvas.dataset.riteBodyLungeSeen = String(lungeSeen.current);
        canvas.dataset.riteBodyRecoilSeen = String(recoilSeen.current);
        canvas.dataset.riteBodyKoExitSeen = String(koExitSeen.current);
        canvas.dataset.riteBodyReactionMaxActive = String(maxActive.current);
        canvas.dataset.riteBodyReactionMaxOffset = maxOffset.current.toFixed(3);
        if (lastBeat) {
            let causesKo = lastBeat.lethal;
            for (let cueIndex = 0; !causesKo && cueIndex < lastBeat.cues.length; cueIndex++) causesKo = lastBeat.cues[cueIndex].lethal;
            canvas.dataset.riteBodyReactionLast = `${lastActor}:${lastBeat.role}@${lastBeat.tick}${causesKo ? ":ko" : ""}`;
        }
        if (lethalBeat) canvas.dataset.riteBodyLethalLast = `${lethalActor}:${lethalBeat.role}@${lethalBeat.tick}`;
    });
    return null;
}

function Scene({ result, fighters, clockRef, quality, winnerRef, reducedMotion, onReady, onLoadProgress, onRouteTransition }: PetWarfrontRiteStage3DProps) {
    const gl = useThree((state) => state.gl);
    const viewport = useThree((state) => state.size);
    const canvas = useThree((state) => state.gl.domElement);
    const rendererName = useMemo(() => {
        const context = gl.getContext();
        const debugInfo = context.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null;
        return String(context.getParameter(debugInfo?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER) ?? "unknown");
    }, [gl]);
    const capabilityTier: WarfrontCapabilityTier = useMemo(() => warfrontCapabilityTier({
        actorCount: fighters.length,
        renderer: rendererName,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        coarsePointer: typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
    }), [fighters.length, rendererName, viewport.height, viewport.width]);
    const batchedBattle = capabilityTier !== "standard";
    const impostorUrls = useMemo(() => fighters.map((fighter) => criticalSoftwareImpostorUrl(fighter.pet)), [fighters]);
    const impostorAssetsAvailable = impostorUrls.every((url) => url !== null);
    const resolvedImpostorUrls = useMemo(
        () => impostorUrls.filter((url): url is string => url !== null),
        [impostorUrls],
    );
    const persistedRoute = useMemo(() => {
        if (typeof window === "undefined") return null;
        try {
            return parseWarfrontPersistedRoute(window.localStorage.getItem(WARFRONT_ROUTE_STORAGE_KEY), rendererName);
        } catch {
            // Privacy modes can deny storage while leaving WebGL available.
            // The renderer-local preflight remains the authority in that case.
            return null;
        }
    }, [rendererName]);
    const force3dCanary = useMemo(() => {
        if (typeof window === "undefined") return false;
        return warfront3dQaCanaryRequested(window.location.search);
    }, []);
    const initialRoute = useMemo(() => initialWarfrontRuntimeRoute({
        actorCount: fighters.length,
        renderer: rendererName,
        impostorAssetsAvailable,
        persisted: persistedRoute,
        force3dCanary,
    }), [fighters.length, force3dCanary, impostorAssetsAvailable, persistedRoute, rendererName]);
    const [runtimeRoute, setRuntimeRoute] = useState<WarfrontRuntimeRoute>(initialRoute);
    const [skinnedModule, setSkinnedModule] = useState<WarfrontSkinnedModule | null>(null);
    const [rigChunkStatus, setRigChunkStatus] = useState<"not-requested" | "loading" | "ready" | "failed">("not-requested");
    const [hiddenPreflightSample, setHiddenPreflightSample] = useState<WarfrontPerformanceSample | null>(null);
    const [visibleValidationSample, setVisibleValidationSample] = useState<WarfrontPerformanceSample | null>(null);
    const [impostorAssetsReady, setImpostorAssetsReady] = useState(false);
    const [heroImpactAssetReady, setHeroImpactAssetReady] = useState(false);
    const [actorReadyCount, setActorReadyCount] = useState(0);
    const [hydrationPhase, setHydrationPhase] = useState(0);
    const preflightClockRef = useRef(0);
    const preflightStressRef = useRef(false);
    const routeSwitches = useRef(0);
    const softwareImpostors = runtimeRoute.mode === "model-impostor" && impostorAssetsAvailable;
    const SkinnedModel = skinnedModule?.PetWarfrontSkinnedModel3D ?? null;
    const routedClockRef = runtimeRoute.status === "probing" ? preflightClockRef : clockRef;
    const attackCues = useMemo(() => warfrontAttackCues(result.events), [result.events]);
    const preflightStartTick = Math.max(0, (attackCues[0]?.tellTick ?? 0) - 2);
    const contactBeatsByActor = useMemo(() => {
        const authored = warfrontBodyContactBeats(attackCues);
        const resolved = new Map<string, FighterContactBeat[]>();
        const originSample = createActorPoseSample();
        const targetSample = createActorPoseSample();
        for (const [actorId, beats] of authored) {
            const fighterBeats: FighterContactBeat[] = [];
            for (const beat of beats) {
                let directionX = 0;
                let directionZ = 0;
                let fallbackX = 1;
                let fallbackZ = 0;
                for (let cueIndex = 0; cueIndex < beat.cues.length; cueIndex++) {
                    const cue = beat.cues[cueIndex];
                    const origin = sampleActorByIdInto(result, cue.actorId, cue.tellTick, originSample);
                    const target = sampleActorByIdInto(result, cue.targetId, cue.contactTick, targetSample);
                    const direction = warfrontContactDirection(
                        origin.x,
                        origin.z,
                        target.x,
                        target.z,
                        origin.faceX,
                        origin.faceZ,
                    );
                    directionX += direction.x;
                    directionZ += direction.z;
                    fallbackX = direction.x;
                    fallbackZ = direction.z;
                }
                const combined = warfrontContactDirection(0, 0, directionX, directionZ, fallbackX, fallbackZ);
                fighterBeats.push({ ...beat, directionX: combined.x, directionZ: combined.z });
            }
            resolved.set(actorId, fighterBeats);
        }
        return resolved;
    }, [attackCues, result]);
    const rigImportRequested = useRef(false);
    useEffect(() => {
        if (runtimeRoute.mode !== "skinned-3d" || rigImportRequested.current) return;
        rigImportRequested.current = true;
        setRigChunkStatus("loading");
        void import("./PetWarfrontSkinnedModel3D").then((module) => {
            setSkinnedModule({
                PetWarfrontSkinnedModel3D: module.PetWarfrontSkinnedModel3D,
                warfrontSkinnedMetrics: module.warfrontSkinnedMetrics,
            });
            setRigChunkStatus("ready");
        }).catch(() => {
            setRigChunkStatus("failed");
        });
    }, [runtimeRoute.mode]);
    const lodMetrics = useMemo(
        () => skinnedModule?.warfrontSkinnedMetrics(fighters.map((fighter) => fighter.pet)) ?? EMPTY_SKINNED_METRICS,
        [fighters, skinnedModule],
    );
    useEffect(() => {
        if (runtimeRoute.reason !== "safe-default" || typeof window === "undefined") return;
        const encoded = serializeWarfrontPersistedRoute(rendererName, runtimeRoute);
        if (!encoded) return;
        try { window.localStorage.setItem(WARFRONT_ROUTE_STORAGE_KEY, encoded); } catch { /* current clash remains safely routed */ }
    }, [rendererName, runtimeRoute]);
    useEffect(() => {
        canvas.dataset.ritePetLodEnabled = String(runtimeRoute.mode === "skinned-3d" && lodMetrics.lodEnabled);
        canvas.dataset.ritePetLodActors = String(lodMetrics.mappedActors);
        canvas.dataset.ritePetLodFallbacks = String(lodMetrics.missingActors);
        canvas.dataset.ritePetSourceTriangles = String(lodMetrics.sourceTriangles);
        canvas.dataset.ritePetSelectedTriangles = String(lodMetrics.selectedTriangles);
        canvas.dataset.riteCapabilityTier = capabilityTier;
        canvas.dataset.riteRenderer = rendererName;
        canvas.dataset.riteSilhouette = softwareImpostors ? "model-impostor" : "surface-ink";
        canvas.dataset.riteActorRenderMode = softwareImpostors ? "model-impostor" : SkinnedModel ? "skinned-3d" : "rig-loading";
        canvas.dataset.riteImpostorActors = softwareImpostors ? String(fighters.length) : "0";
        canvas.dataset.riteRuntimeRoute = runtimeRoute.mode;
        canvas.dataset.riteRuntimeRouteStatus = runtimeRoute.status;
        canvas.dataset.riteRuntimeRouteReason = runtimeRoute.reason;
        canvas.dataset.riteRuntimeRoutePersisted = String(runtimeRoute.persisted);
        canvas.dataset.riteRuntimeRouteQaCanary = String(force3dCanary);
        canvas.dataset.riteRuntimeRouteSwitches = String(routeSwitches.current);
        canvas.dataset.riteRuntimeRouteBeforeReveal = "true";
        canvas.dataset.riteRigChunkStatus = rigChunkStatus;
        canvas.dataset.riteRigChunkRequested = String(rigChunkStatus !== "not-requested");
        canvas.dataset.riteImpostorAssetsReady = String(impostorAssetsReady);
        canvas.dataset.ritePreflightThresholdMs = String(WARFRONT_PREFLIGHT_THRESHOLD_MS);
        canvas.dataset.ritePreflightFrameGaps = String(hiddenPreflightSample?.frameGapsOver100ms ?? 0);
        canvas.dataset.ritePreflightFrameGapMaxMs = (hiddenPreflightSample?.frameGapMaxMs ?? 0).toFixed(2);
        canvas.dataset.ritePreflightLongTasks = String(hiddenPreflightSample?.longTasksOver100ms ?? 0);
        canvas.dataset.ritePreflightLongTaskMaxMs = (hiddenPreflightSample?.longTaskMaxMs ?? 0).toFixed(2);
        canvas.dataset.riteRouteValidationFrameGaps = String(visibleValidationSample?.frameGapsOver100ms ?? 0);
        canvas.dataset.riteRouteValidationFrameGapMaxMs = (visibleValidationSample?.frameGapMaxMs ?? 0).toFixed(2);
        canvas.dataset.riteRouteValidationLongTasks = String(visibleValidationSample?.longTasksOver100ms ?? 0);
        canvas.dataset.riteRouteValidationLongTaskMaxMs = (visibleValidationSample?.longTaskMaxMs ?? 0).toFixed(2);
        canvas.dataset.riteArenaActorLightMode = "three-positional-pair";
        canvas.dataset.riteArenaActorLightOverlays = "0";
        canvas.dataset.riteArenaActorLightMaxAlpha = "0";
        canvas.dataset.riteArenaActorLightMultiplyMaxAlpha = "0";
        canvas.dataset.riteArenaActorLightMultiplyCap = "0";
        canvas.dataset.riteArenaActorLightEdgeRecoveryMaxAlpha = "0";
        canvas.dataset.riteArenaSideLights = "2";
        canvas.dataset.riteArenaSideLightIntensity = (batchedBattle ? 4.5 : 10).toFixed(1);
    }, [SkinnedModel, batchedBattle, canvas, capabilityTier, fighters.length, force3dCanary, hiddenPreflightSample, impostorAssetsReady, lodMetrics, rendererName, rigChunkStatus, runtimeRoute, softwareImpostors, visibleValidationSample]);
    const committedActorIds = useMemo(
        () => new Set(result.snapshots[0]?.actors.map((actor) => actor.id) ?? []),
        [result],
    );
    const readyFighters = useRef(new Set<string>());
    const readyReported = useRef(false);
    const heroImpactAssetReadyRef = useRef(false);
    const reportModelReady = useCallback((fighterId: string) => {
        const previousCount = readyFighters.current.size;
        readyFighters.current.add(fighterId);
        if (readyFighters.current.size !== previousCount) {
            setActorReadyCount(readyFighters.current.size);
            onLoadProgress?.(readyFighters.current.size);
        }
        if (heroImpactAssetReadyRef.current && runtimeRoute.status !== "probing" && !readyReported.current
            && allRiteFighterModelsReady(fighters, readyFighters.current, committedActorIds)) {
            readyReported.current = true;
            onReady?.();
        }
    }, [committedActorIds, fighters, onLoadProgress, onReady, runtimeRoute.status]);
    const handleImpostorAssetsReady = useCallback(() => setImpostorAssetsReady(true), []);
    const handleHeroImpactAssetReady = useCallback(() => {
        heroImpactAssetReadyRef.current = true;
        setHeroImpactAssetReady(true);
        if (runtimeRoute.status !== "probing" && !readyReported.current
            && allRiteFighterModelsReady(fighters, readyFighters.current, committedActorIds)) {
            readyReported.current = true;
            onReady?.();
        }
    }, [committedActorIds, fighters, onReady, runtimeRoute.status]);
    useEffect(() => {
        if (rigChunkStatus !== "failed") return;
        const nextRoute = resolveWarfrontRigImportFailure(runtimeRoute, impostorAssetsAvailable);
        if (nextRoute === runtimeRoute) return;
        const encoded = serializeWarfrontPersistedRoute(rendererName, nextRoute);
        if (encoded && typeof window !== "undefined") {
            try { window.localStorage.setItem(WARFRONT_ROUTE_STORAGE_KEY, encoded); } catch { /* in-memory fallback remains valid */ }
        }
        routeSwitches.current += 1;
        onRouteTransition?.();
        readyFighters.current.clear();
        readyReported.current = false;
        // A failed rig import has to reset the ready tally in the same pass that
        // switches route, or the new route inherits the dead route's count and
        // never reports ready.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActorReadyCount(0);
        onLoadProgress?.(0);
        setRuntimeRoute(nextRoute);
    }, [impostorAssetsAvailable, onLoadProgress, onRouteTransition, rendererName, rigChunkStatus, runtimeRoute]);
    const handlePreflightComplete = useCallback((sample: WarfrontPerformanceSample) => {
        setHiddenPreflightSample(sample);
        const nextRoute = resolveWarfrontRuntimeRoute(runtimeRoute, sample);
        if (nextRoute === runtimeRoute) return;
        if (nextRoute.mode === "model-impostor") {
            const encoded = serializeWarfrontPersistedRoute(rendererName, nextRoute);
            if (encoded && typeof window !== "undefined") {
                try { window.localStorage.setItem(WARFRONT_ROUTE_STORAGE_KEY, encoded); } catch { /* in-memory route remains authoritative */ }
            }
            // Both asset families are already painted behind the opaque Stage
            // curtain. Reset the readiness quorum before React replaces all
            // eight actors in one commit; reveal occurs only after the new
            // family itself has painted twice.
            routeSwitches.current += 1;
            onRouteTransition?.();
            readyFighters.current.clear();
            readyReported.current = false;
            setActorReadyCount(0);
            onLoadProgress?.(0);
            setRuntimeRoute(nextRoute);
            return;
        }
        setRuntimeRoute(nextRoute);
        if (heroImpactAssetReadyRef.current && !readyReported.current
            && allRiteFighterModelsReady(fighters, readyFighters.current, committedActorIds)) {
            readyReported.current = true;
            onReady?.();
        }
    }, [committedActorIds, fighters, onLoadProgress, onReady, onRouteTransition, rendererName, runtimeRoute]);
    const handleVisibleValidationComplete = useCallback((sample: WarfrontPerformanceSample) => {
        setVisibleValidationSample(sample);
        const nextRoute = resolveWarfrontVisibleRoute(runtimeRoute, sample);
        if (nextRoute === runtimeRoute) return;
        const encoded = serializeWarfrontPersistedRoute(rendererName, nextRoute);
        if (encoded && typeof window !== "undefined") {
            try {
                window.localStorage.setItem(WARFRONT_ROUTE_STORAGE_KEY, encoded);
            } catch {
                // A denied persistence write does not invalidate this clash's
                // one-way in-memory decision.
            }
        }
        if (nextRoute.mode === "model-impostor") {
            routeSwitches.current += 1;
            onRouteTransition?.();
            readyFighters.current.clear();
            readyReported.current = false;
            setActorReadyCount(0);
            onLoadProgress?.(0);
        }
        setRuntimeRoute(nextRoute);
    }, [onLoadProgress, onRouteTransition, rendererName, runtimeRoute]);
    const preflightEnabled = runtimeRoute.status === "probing"
        && actorReadyCount === fighters.length
        && impostorAssetsReady
        && heroImpactAssetReady;
    const advanceHydration = useCallback((phase: number) => {
        setHydrationPhase((current) => current === phase ? Math.min(5, current + 1) : current);
    }, []);
    useEffect(() => {
        canvas.dataset.riteHydrationPhase = String(hydrationPhase);
        performance.mark(`wfr-hydration-${hydrationPhase}`);
    }, [canvas, hydrationPhase]);
    return (
        <>
            {/* Portrait framing sits farther down the battle axis. The old
                34-unit fog wall erased the far six fighters on an S25 before
                the camera could even frame them. */}
            <fog attach="fog" args={["#0a1114", 42, 92]} />
            {/* A dark-furred pet against a dark void is the readability trap this
                mode exists to avoid, so the rigs are lit from four sides: a
                bright ambient floor, a warm key, a cool opposing fill, and a back
                rim that separates silhouettes from the background. */}
            <ambientLight intensity={batchedBattle ? 0.74 : 0.68} color="#bfd0d2" />
            <hemisphereLight intensity={batchedBattle ? 0.54 : 0.48} color="#8eb9d0" groundColor="#20150f" />
            <directionalLight position={[3.5, 11, 5]} intensity={2.35} color="#e7edf0" castShadow={quality.modelShadows} />
            <directionalLight position={[0, 6, -8]} intensity={1.05} color="#afc5db" />
            {!batchedBattle ? <directionalLight position={[-5, 6, 2]} intensity={0.42} color="#7db9cb" /> : null}
            <pointLight position={[-15, 3, 0]} color={TEAM_COLOR.player} intensity={batchedBattle ? 4.5 : 10} distance={22} decay={2} />
            <pointLight position={[15, 3, 0]} color={TEAM_COLOR.enemy} intensity={batchedBattle ? 4.5 : 10} distance={22} decay={2} />

            <ClashCamera result={result} clockRef={routedClockRef} />
            <SceneHydrationSequencer phase={hydrationPhase} finalPhase={5} onAdvance={advanceHydration} />
            {hydrationPhase >= 1 ? (
                <>
                    <KageBoardCells />
                    <FloorFlushRelicObjective result={result} clockRef={routedClockRef} />
                </>
            ) : null}
            {hydrationPhase >= 2 ? (
                <>
                    <FighterReadabilityLayer result={result} fighters={fighters} cues={attackCues} clockRef={routedClockRef} reducedMotion={reducedMotion} />
                    <Suspense fallback={null}>
                        <HeroFireImpactTexturePreloader onReady={handleHeroImpactAssetReady} />
                        <AttackCausalityLayer
                            result={result}
                            cues={attackCues}
                            clockRef={routedClockRef}
                            heroImpactAssetReady={heroImpactAssetReady}
                        />
                    </Suspense>
                </>
            ) : null}
            {hydrationPhase >= 4 && impostorAssetsAvailable ? (
                <Suspense fallback={null}>
                    <ImpostorAssetsPreloader urls={resolvedImpostorUrls} onReady={handleImpostorAssetsReady} />
                </Suspense>
            ) : null}
            {hydrationPhase >= 5 ? <RuntimePerformancePreflight
                enabled={preflightEnabled}
                probeClockRef={preflightClockRef}
                probeStressRef={preflightStressRef}
                probeStartTick={preflightStartTick}
                probeEndTick={result.ticks}
                onComplete={handlePreflightComplete}
            /> : null}
            {hydrationPhase >= 5 ? <RuntimeVisibleRouteValidation
                enabled={runtimeRoute.status === "validating"}
                clockRef={clockRef}
                onComplete={handleVisibleValidationComplete}
            /> : null}
            {hydrationPhase >= 5 ? fighters.map((fighter, index) => softwareImpostors ? (
                <Suspense key={`${fighter.team}-${fighter.lane}`} fallback={null}>
                    <SoftwareRiteFighter3D
                        result={result}
                        fighter={fighter}
                        clockRef={routedClockRef}
                        impostorUrl={impostorUrls[index]!}
                        contactBeats={contactBeatsByActor.get(`${fighter.team}-${fighter.lane}`) ?? NO_CONTACT_BEATS}
                        onModelReady={reportModelReady}
                    />
                </Suspense>
            ) : SkinnedModel ? (
                <RiteFighter3D
                    key={`${fighter.team}-${fighter.lane}`}
                    result={result}
                    fighter={fighter}
                    clockRef={routedClockRef}
                    victorious={winnerRef}
                    quality={quality}
                    contactBeats={contactBeatsByActor.get(`${fighter.team}-${fighter.lane}`) ?? NO_CONTACT_BEATS}
                    performanceProbeRef={preflightStressRef}
                    SkinnedModel={SkinnedModel}
                    onModelReady={reportModelReady}
                />
            ) : null) : null}
            {hydrationPhase >= 3 ? (
                <>
                    <ProjectileLayer result={result} clockRef={routedClockRef} quality={quality} />
                    <ImpactLayer result={result} clockRef={routedClockRef} quality={quality} batched={batchedBattle} />
                </>
            ) : null}
            {hydrationPhase >= 5 ? (
                <>
                    <MotionReadabilityProbe key={runtimeRoute.mode} result={result} clockRef={clockRef} />
                    <BodyReactionProbe result={result} beatsByActor={contactBeatsByActor} clockRef={clockRef} />
                </>
            ) : null}
        </>
    );
}

export type PetWarfrontRiteStage3DProps = {
    /** Remount combat-owned scene resources without replacing the WebGL context. */
    sceneKey: number;
    result: DuelResult;
    /** Every active rig on the field — four a side. */
    fighters: StageFighter[];
    /** FRACTIONAL sim tick. A ref, never state — see the header. */
    clockRef: MutableRefObject<number>;
    quality: PetVisualQualityConfig;
    /** Set once the clash resolves so the winning side plays its victory clip. */
    winnerRef: MutableRefObject<{ player: boolean; enemy: boolean }>;
    reducedMotion: boolean;
    onReady?: () => void;
    onLoadProgress?: (readyCount: number) => void;
    /** Re-close the existing formation veil before an atomic actor-family swap. */
    onRouteTransition?: () => void;
    onRendererAvailability?: (available: boolean) => void;
};

export function PetWarfrontRiteStage3D(props: PetWarfrontRiteStage3DProps) {
    const { quality, onReady, onRendererAvailability, sceneKey } = props;
    const renderQuality = useMemo(
        () => warfrontRenderBudget(quality, props.fighters.length),
        [props.fighters.length, quality],
    );
    const [canvasGeneration, setCanvasGeneration] = useState(0);
    const [canvasMounted, setCanvasMounted] = useState(true);
    const [contextStatus, setContextStatus] = useState<"ready" | "lost" | "recovering">("ready");
    const contextStatusRef = useRef<"ready" | "lost" | "recovering">("ready");
    const restoreTimer = useRef<number | null>(null);
    const remountTimer = useRef<number | null>(null);
    const clearRecoveryTimers = useCallback(() => {
        if (restoreTimer.current !== null) window.clearTimeout(restoreTimer.current);
        if (remountTimer.current !== null) window.clearTimeout(remountTimer.current);
        restoreTimer.current = null;
        remountTimer.current = null;
    }, []);
    const handleContextLost = useCallback(() => {
        if (contextStatusRef.current !== "ready") return;
        contextStatusRef.current = "lost";
        setContextStatus("lost");
        onRendererAvailability?.(false);
        clearRecoveryTimers();
        // Give the browser a short opportunity to restore in place. If it
        // cannot, unmount first; R3F then disconnects events, disposes render
        // lists/scene resources, and force-loses the old context before this
        // delayed replacement asks the browser for another one.
        restoreTimer.current = window.setTimeout(() => {
            contextStatusRef.current = "recovering";
            setContextStatus("recovering");
            setCanvasMounted(false);
            remountTimer.current = window.setTimeout(() => {
                setCanvasGeneration((generation) => generation + 1);
                setCanvasMounted(true);
            }, 650);
        }, 900);
    }, [clearRecoveryTimers, onRendererAvailability]);
    const handleContextRestored = useCallback(() => {
        if (contextStatusRef.current !== "lost") return;
        clearRecoveryTimers();
        contextStatusRef.current = "ready";
        setContextStatus("ready");
        onRendererAvailability?.(true);
    }, [clearRecoveryTimers, onRendererAvailability]);
    const handleSceneReady = useCallback(() => {
        clearRecoveryTimers();
        contextStatusRef.current = "ready";
        setContextStatus("ready");
        onRendererAvailability?.(true);
        onReady?.();
    }, [clearRecoveryTimers, onReady, onRendererAvailability]);
    useEffect(() => () => clearRecoveryTimers(), [clearRecoveryTimers]);

    return (
        <>
            {canvasMounted ? (
                /* Three 0.184 deprecates the boolean shadow preset as
                   PCFSoftShadowMap and logs repeatedly while six rigs render.
                   Select the supported percentage-filtered map explicitly. */
                <Canvas
                    key={canvasGeneration}
                    className="wfr-canvas"
                    dpr={renderQuality.dpr}
                    shadows={renderQuality.modelShadows ? "percentage" : false}
                    camera={{ fov: 44, position: [0, 9, 13], near: 0.1, far: 100 }}
                    gl={{ antialias: renderQuality.bloomIntensity > 0, alpha: true, powerPreference: "high-performance" }}
                    onCreated={({ gl }) => {
                        const canvas = gl.domElement;
                        canvas.dataset.riteRequestedQuality = quality.id;
                        canvas.dataset.riteRenderBudget = props.fighters.length >= 8 ? "eight-rig" : "standard";
                        canvas.dataset.riteSilhouette = props.fighters.length >= 8 ? "surface-ink" : "inverted-hull";
                        canvas.dataset.riteTextureAnisotropy = String(renderQuality.textureAnisotropy);
                        canvas.dataset.riteDpr = gl.getPixelRatio().toFixed(2);
                    }}
                    fallback={(
                        <div className="wfr-canvas-fallback" role="img" aria-label="Beastbound Warfront formation battle view">
                            <div className="wfr-fallback-band is-blue">{props.fighters.filter((fighter) => fighter.team === "player").map((fighter) => <span key={`${fighter.team}-${fighter.lane}`}>{fighter.pet.name.slice(0, 1)}</span>)}</div>
                            <strong>CLASH</strong>
                            <div className="wfr-fallback-band is-red">{props.fighters.filter((fighter) => fighter.team === "enemy").map((fighter) => <span key={`${fighter.team}-${fighter.lane}`}>{fighter.pet.name.slice(0, 1)}</span>)}</div>
                            <small>Reduced graphics mode</small>
                        </div>
                    )}
                >
                    <RendererContextGuard onLost={handleContextLost} onRestored={handleContextRestored} />
                    <Scene key={sceneKey} {...props} quality={renderQuality} onReady={handleSceneReady} />
                </Canvas>
            ) : null}
            {contextStatus !== "ready" ? (
                <div className="wfr-render-recovery" role="status" data-testid="wfr-render-recovery" data-renderer-status={contextStatus}>
                    <strong>RESTORING BATTLE VIEW</strong>
                    <span>Combat is paused at the current beat.</span>
                </div>
            ) : null}
        </>
    );
}
