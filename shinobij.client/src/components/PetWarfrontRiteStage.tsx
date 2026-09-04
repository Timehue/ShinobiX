import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MutableRefObject } from "react";
import type { Pet } from "../types/pet";
import { DUEL_TPS, type DuelObjectiveSnap, type DuelResult } from "../lib/pet-duel-sim";
import { WARFRONT_ARENA_X, WARFRONT_ARENA_Y } from "../lib/pet-duel-cinematic";
import { petCombatModel } from "../lib/pet-3d-models";
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
import { warfrontImpostorAtlasUrl } from "../lib/pet-warfront-impostor-url";
import {
    RITE_TEAM_COLOR,
    actionFocus,
    createActorPoseSample,
    riteCanvasGroundingAoDepthScale,
    riteCanvasLivingWaterFootAnchorY,
    riteGroundingAoCameraForwardOffset,
    riteGroundingFocusStrength,
    sampleActorByIdInto,
    sampleActorInto,
    type ActorPose,
} from "../lib/pet-warfront-rite-presentation";
import { WARFRONT_PREFLIGHT_THRESHOLD_MS, WARFRONT_ROUTE_STORAGE_KEY, warfront3dQaCanaryRequested } from "../lib/pet-warfront-render-budget";
import type { PetVisualQualityConfig } from "../lib/pet-visual-quality";
import {
    WARFRONT_HERO_AXIS_TAIL_PX,
    WARFRONT_HERO_BURST_HOLD_TICKS,
    WARFRONT_HERO_BURST_PX,
    WARFRONT_HERO_CONTACT_LAYER_COUNT,
    WARFRONT_HERO_CONTACT_TARGET_WIDTHS,
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
    warfrontHeroFireShape,
    warfrontHeroImpactHold,
    warfrontHeroStage,
    warfrontHeroTravelSpanFraction,
    warfrontSpectacleParticleBudget,
    warfrontSpectaclePhaseInto,
    warfrontSpectaclePriority,
} from "../lib/pet-warfront-spectacle";
import {
    drawWarfrontElementResult,
    drawWarfrontElementTell,
    drawWarfrontElementTravel,
    drawWarfrontHeroFireCorridor,
    drawWarfrontHeroFireFlare,
    drawWarfrontHeroFireImpact,
    drawWarfrontHeroHealthFeedback,
} from "../lib/pet-warfront-spectacle-canvas";

export type StageFighter = {
    team: "player" | "enemy";
    lane: number;
    pet: Pet;
    entryHp: number;
};

export type PetWarfrontRiteStageProps = {
    sceneKey: number;
    result: DuelResult;
    fighters: StageFighter[];
    clockRef: MutableRefObject<number>;
    quality: PetVisualQualityConfig;
    winnerRef: MutableRefObject<{ player: boolean; enemy: boolean }>;
    reducedMotion: boolean;
    onReady?: () => void;
    onLoadProgress?: (readyCount: number) => void;
    onRouteTransition?: () => void;
    onRendererAvailability?: (available: boolean) => void;
};

type WebGlStageModule = Readonly<{
    PetWarfrontRiteStage3D: ComponentType<PetWarfrontRiteStageProps>;
    preloadRitePetModels: (pets: readonly Pet[]) => Promise<void>;
}>;

type StageRoute = Readonly<{ useWebGl: boolean; reason: "qa-canary" | "persisted-fast" | "safe-default" }>;
let cachedRoute: StageRoute | null = null;

function rawRendererName(): string | null {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { powerPreference: "high-performance" })
        ?? canvas.getContext("webgl", { powerPreference: "high-performance" });
    if (!context) return null;
    const debug = context.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null;
    const renderer = String(context.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER) ?? "unknown");
    context.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.width = 1;
    canvas.height = 1;
    return renderer;
}

function stageRoute(): StageRoute {
    if (cachedRoute) return cachedRoute;
    if (warfront3dQaCanaryRequested(window.location.search)) {
        return cachedRoute = { useWebGl: true, reason: "qa-canary" };
    }
    try {
        const raw = window.localStorage.getItem(WARFRONT_ROUTE_STORAGE_KEY);
        if (raw) {
            const record = JSON.parse(raw) as { version?: number; renderer?: string; mode?: string; proof?: string; sample?: { frameGapMaxMs?: number; longTaskMaxMs?: number } };
            const provenFast = record.version === 2
                && record.mode === "skinned-3d"
                && record.proof === "fast-visible-canary"
                && Number(record.sample?.frameGapMaxMs) <= WARFRONT_PREFLIGHT_THRESHOLD_MS
                && Number(record.sample?.longTaskMaxMs) <= WARFRONT_PREFLIGHT_THRESHOLD_MS;
            // Raw WebGL is opened only for an already proven-fast candidate.
            // Clean/default sessions do not initialize a GPU context at all.
            if (provenFast && record.renderer === rawRendererName()) {
                return cachedRoute = { useWebGl: true, reason: "persisted-fast" };
            }
        }
    } catch {
        // Denied or malformed storage simply retains the exact-model safe path.
    }
    return cachedRoute = { useWebGl: false, reason: "safe-default" };
}

function impostorUrl(pet: Pet): string | null {
    const source = petCombatModel(pet)?.url;
    return source ? warfrontImpostorAtlasUrl(source) : null;
}

const IMPOSTOR_IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();

/** Blue/red mirrors share the exact same authored atlas. Decode each URL once
 * before its first paint so the atomic eight-actor reveal never pays duplicate
 * decode/upload work inside one animation frame. */
function loadImpostorImage(url: string): Promise<HTMLImageElement> {
    const cached = IMPOSTOR_IMAGE_CACHE.get(url);
    if (cached) return cached;
    const pending = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
            void image.decode().catch(() => undefined).then(() => resolve(image));
        };
        image.onerror = () => reject(new Error(`Unable to load ${url}`));
        image.src = url;
    });
    IMPOSTOR_IMAGE_CACHE.set(url, pending);
    void pending.catch(() => IMPOSTOR_IMAGE_CACHE.delete(url));
    return pending;
}

/** Deployment warming follows the same physical import gate as mounting. */
export async function preloadRitePetModels(pets: readonly Pet[]): Promise<void> {
    const impactSpriteReady = loadImpostorImage(WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL);
    const route = stageRoute();
    const atlasComplete = pets.every((pet) => impostorUrl(pet) !== null);
    if (!route.useWebGl && atlasComplete) {
        await impactSpriteReady;
        return;
    }
    const [module] = await Promise.all([import("./PetWarfrontRiteStage3D"), impactSpriteReady]);
    await module.preloadRitePetModels(pets);
}

type CanvasBeat = WarfrontBodyContactBeat & Readonly<{ directionX: number; directionZ: number }>;
type CanvasActor = {
    fighter: StageFighter;
    image: HTMLImageElement;
    pose: ActorPose;
    prior: ActorPose;
    next: ActorPose;
    beats: readonly CanvasBeat[];
    phase: WarfrontBodyReactionPhase;
    scratch: WarfrontBodyReactionPhase;
    lastState: string;
    stateSince: number;
    lastFacing: number;
    facingCandidate: number;
    facingCandidateSince: number;
    facingFlips: number;
};

function sampleBody(beats: readonly CanvasBeat[], tick: number, phase: WarfrontBodyReactionPhase, scratch: WarfrontBodyReactionPhase): CanvasBeat | null {
    let selected: CanvasBeat | null = null;
    let priority = -1;
    let selectedTick = Number.NEGATIVE_INFINITY;
    phase.active = false;
    phase.lunge = 0;
    phase.recoil = 0;
    phase.recovery = 0;
    phase.koExit = 0;
    for (const beat of beats) {
        warfrontBodyReactionPhaseInto(beat, tick, scratch);
        if (!scratch.active) continue;
        const nextPriority = beat.role === "target" ? (beat.lethal ? 3 : 2) : 1;
        if (nextPriority < priority || (nextPriority === priority && beat.tick < selectedTick)) continue;
        selected = beat;
        priority = nextPriority;
        selectedTick = beat.tick;
        phase.active = scratch.active;
        phase.lunge = scratch.lunge;
        phase.recoil = scratch.recoil;
        phase.recovery = scratch.recovery;
        phase.koExit = scratch.koExit;
    }
    return selected;
}

function framingFractions(width: number, height: number): { x: number; y: number } {
    const aspect = width / Math.max(1, height);
    if (aspect < 0.75) return { x: 0.95, y: 0.74 };
    if (aspect > 1.8) return { x: 0.79, y: 0.76 };
    return { x: 0.87, y: 0.68 };
}

type CanvasBroadcastCamera = {
    x: number;
    z: number;
    zoom: number;
    initialized: boolean;
    lastFrameAt: number;
    focusId: string;
    shotCueKey: string;
    maxPanPerFrame: number;
    maxZoomPerFrame: number;
};

function createCanvasBroadcastCamera(): CanvasBroadcastCamera {
    return {
        x: 0,
        z: 0,
        zoom: 1,
        initialized: false,
        lastFrameAt: 0,
        focusId: "formation",
        shotCueKey: "",
        maxPanPerFrame: 0,
        maxZoomPerFrame: 0,
    };
}

function approach(current: number, target: number, maxDelta: number): number {
    const delta = target - current;
    if (Math.abs(delta) <= maxDelta) return target;
    return current + Math.sign(delta) * maxDelta;
}

type CanvasActorHealthRail = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
}>;

// The transparent atlas square is intentionally larger than the opaque pet.
// This reviewed occupancy tracks the painted body rather than its padding and
// gives the Fire contact a truthful target-relative screen measurement.
const CANVAS_ACTOR_PAINTED_WIDTH_RATIO = 0.66;

/** A deliberately small, actor-local HUD mark. Its one-pixel faction rim stays
 * visible even at zero health, while the fill carries the same health fraction
 * as the remote roster. The anchor is recomputed from the moving actor every
 * frame; it is not a DOM overlay or a second animation loop. */
function drawCanvasActorHealthRail(
    context: CanvasRenderingContext2D,
    x: number,
    footY: number,
    baseSize: number,
    healthFraction: number,
    teamColor: string,
    visibility: number,
    canvasWidth: number,
    canvasHeight: number,
): CanvasActorHealthRail | null {
    if (visibility <= 0.001) return null;
    const width = Math.max(38, Math.min(50, baseSize * 0.5));
    const height = Math.max(4, Math.min(5, baseSize * 0.05));
    // The actor simulation may briefly carry a silhouette through a camera
    // edge. Keep its identifying rail on-screen while preserving the live
    // horizontal anchor and normal above-head vertical offset.
    const left = Math.round(Math.max(2, Math.min(canvasWidth - width - 2, x - width * 0.5)));
    const top = Math.round(Math.max(2, Math.min(canvasHeight - height - 2, footY - baseSize * 0.92)));
    const fraction = Math.max(0, Math.min(1, healthFraction));
    const fillWidth = fraction > 0 ? Math.max(1, Math.round(width * fraction)) : 0;

    context.save();
    context.globalAlpha = Math.min(1, visibility);
    context.fillStyle = "rgba(2, 7, 10, .9)";
    context.fillRect(left - 2, top - 2, width + 4, height + 4);
    context.fillStyle = teamColor;
    context.fillRect(left - 1, top - 1, width + 2, height + 2);
    context.fillStyle = "rgba(7, 17, 23, .96)";
    context.fillRect(left, top, width, height);
    if (fillWidth > 0) {
        context.fillStyle = teamColor;
        context.fillRect(left, top, fillWidth, height);
    }
    context.restore();
    return { x: left, y: top, width, height };
}

const ARENA_FLOOR_DECAL_ALPHA_CAP = 0.18;
const ARENA_OBJECTIVE_DECAL_RADIUS_WORLD = 0.285;

type CanvasArenaSubmissionMetrics = Readonly<{
    prototypeDressingDraws: number;
    floorDecalDraws: number;
    floorDecalMaxAlpha: number;
    floorDecalMaxRadiusPx: number;
}>;

const EMPTY_CANVAS_ARENA_METRICS: CanvasArenaSubmissionMetrics = {
    prototypeDressingDraws: 0,
    floorDecalDraws: 0,
    floorDecalMaxAlpha: 0,
    floorDecalMaxRadiusPx: 0,
};

function sampleForbiddenScroll(result: DuelResult, tick: number): DuelObjectiveSnap | null {
    if (!result.snapshots.length) return null;
    const clamped = Math.max(0, Math.min(result.snapshots.length - 1, tick));
    const index = Math.floor(clamped);
    const mix = clamped - index;
    const current = result.snapshots[index]?.objectives?.find((objective) => objective.id === "forbidden-scroll");
    const next = result.snapshots[Math.min(index + 1, result.snapshots.length - 1)]?.objectives
        ?.find((objective) => objective.id === "forbidden-scroll");
    if (!current) return null;
    if (!next || next.state !== current.state || next.carrierId !== current.carrierId) return current;
    return {
        ...current,
        x: current.x + (next.x - current.x) * mix,
        y: current.y + (next.y - current.y) * mix,
        progress: current.progress + (next.progress - current.progress) * mix,
    };
}

function drawArena(
    target: HTMLCanvasElement,
    width: number,
    height: number,
    project: (x: number, z: number) => readonly [number, number],
): CanvasArenaSubmissionMetrics {
    const targetWidth = Math.max(1, Math.round(width));
    const targetHeight = Math.max(1, Math.round(height));
    if (target.width !== targetWidth) target.width = targetWidth;
    if (target.height !== targetHeight) target.height = targetHeight;
    const context = target.getContext("2d")!;
    context.clearRect(0, 0, width, height);

    // Keep the generated temple court visible. The Canvas2D stage owns only a
    // calm, coordinate-true floor treatment and the legal blocker silhouettes.
    // This also keeps first paint cheap: the static layer is rebuilt only when
    // the viewport changes, never per combat frame.
    const atmosphere = context.createLinearGradient(0, 0, 0, height);
    atmosphere.addColorStop(0, "rgba(1, 5, 9, .2)");
    atmosphere.addColorStop(0.24, "rgba(4, 10, 13, .02)");
    atmosphere.addColorStop(0.78, "rgba(3, 8, 10, .04)");
    atmosphere.addColorStop(1, "rgba(1, 4, 7, .3)");
    context.fillStyle = atmosphere;
    context.fillRect(0, 0, width, height);

    // The generated court already supplies the stone. Keep the live tactical
    // layer inside the same chamfered courtyard silhouette instead of laying a
    // second opaque rectangle over it.
    const courtPoints = [
        project(-WARFRONT_ARENA_X * 0.82, -WARFRONT_ARENA_Y),
        project(WARFRONT_ARENA_X * 0.82, -WARFRONT_ARENA_Y),
        project(WARFRONT_ARENA_X, -WARFRONT_ARENA_Y * 0.78),
        project(WARFRONT_ARENA_X, WARFRONT_ARENA_Y * 0.78),
        project(WARFRONT_ARENA_X * 0.82, WARFRONT_ARENA_Y),
        project(-WARFRONT_ARENA_X * 0.82, WARFRONT_ARENA_Y),
        project(-WARFRONT_ARENA_X, WARFRONT_ARENA_Y * 0.78),
        project(-WARFRONT_ARENA_X, -WARFRONT_ARENA_Y * 0.78),
    ] as const;

    const boardPath = () => {
        context.beginPath();
        context.moveTo(...courtPoints[0]);
        for (let index = 1; index < courtPoints.length; index++) context.lineTo(...courtPoints[index]);
        context.closePath();
    };
    const boardShade = context.createLinearGradient(courtPoints[0][0], courtPoints[0][1], courtPoints[4][0], courtPoints[4][1]);
    boardShade.addColorStop(0, "rgba(19, 56, 63, .07)");
    boardShade.addColorStop(0.5, "rgba(24, 26, 24, .025)");
    boardShade.addColorStop(1, "rgba(68, 30, 26, .065)");
    boardPath();
    context.fillStyle = boardShade;
    context.fill();

    context.save();
    boardPath();
    context.clip();

    const factionWash = context.createLinearGradient(courtPoints[7][0], 0, courtPoints[2][0], 0);
    factionWash.addColorStop(0, "rgba(35, 169, 196, .045)");
    factionWash.addColorStop(0.36, "rgba(16, 56, 64, .008)");
    factionWash.addColorStop(0.64, "rgba(68, 30, 28, .008)");
    factionWash.addColorStop(1, "rgba(190, 64, 52, .04)");
    context.fillStyle = factionWash;
    context.fillRect(0, 0, width, height);

    // Three calm lane seams and tiny flush node studs preserve tactical
    // orientation without rebuilding the floor as thirty-five raised tiles.
    let floorDecalDraws = 0;
    let floorDecalMaxRadiusPx = 0;
    context.strokeStyle = "rgba(200, 171, 116, .12)";
    context.lineWidth = Math.max(0.65, Math.min(width, height) / 1250);
    for (const laneX of [-3.2, 0, 3.2] as const) {
        const start = project(laneX, -WARFRONT_ARENA_Y * 0.88);
        const end = project(laneX, WARFRONT_ARENA_Y * 0.88);
        context.beginPath(); context.moveTo(...start); context.lineTo(...end); context.stroke();
        floorDecalDraws++;
    }
    context.fillStyle = "rgba(213, 190, 143, .13)";
    for (let row = 0; row < 5; row++) for (let column = 0; column < 7; column++) {
        const node = project((column - 3) * 3.2, (row - 2) * 3);
        const nodeRadius = Math.max(0.65, Math.min(width, height) * 0.00125);
        context.beginPath(); context.ellipse(node[0], node[1], nodeRadius, nodeRadius * 0.62, 0, 0, Math.PI * 2); context.fill();
        floorDecalDraws++;
        floorDecalMaxRadiusPx = Math.max(floorDecalMaxRadiusPx, nodeRadius);
    }
    context.restore();

    // Flush stone-and-bronze inlays trace the authored courtyard edge. They are
    // deliberately hairline-thin: no second plinth and no neon perimeter rail.
    boardPath();
    context.strokeStyle = "rgba(8, 13, 14, .16)";
    context.lineWidth = Math.max(2, Math.min(width, height) * 0.0035);
    context.stroke();
    floorDecalDraws++;
    boardPath();
    context.strokeStyle = "rgba(184, 143, 78, .18)";
    context.lineWidth = Math.max(0.8, Math.min(width, height) * 0.0015);
    context.stroke();
    floorDecalDraws++;

    // Collision remains authoritative simulation data. No live shoji, torii,
    // pedestal, lantern, bottle or debris geometry is composited over the
    // generated court in the lightweight route.
    return {
        prototypeDressingDraws: 0,
        floorDecalDraws,
        floorDecalMaxAlpha: ARENA_FLOOR_DECAL_ALPHA_CAP,
        floorDecalMaxRadiusPx,
    };
}

function Canvas2DStage({ sceneKey, result, fighters, clockRef, quality, reducedMotion, onReady, onLoadProgress, onRendererAvailability, onAssetFailure }: PetWarfrontRiteStageProps & Readonly<{ onAssetFailure: () => void }>) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const urls = useMemo(() => fighters.map((fighter) => impostorUrl(fighter.pet)), [fighters]);
    const [images, setImages] = useState<readonly HTMLImageElement[] | null>(null);
    const [heroImpactSprite, setHeroImpactSprite] = useState<HTMLImageElement | null>(null);
    const cues = useMemo(() => warfrontAttackCues(result.events), [result.events]);
    const heroCue = useMemo(() => warfrontHeroAttackCue(cues), [cues]);
    const fighterByActorId = useMemo(() => new Map(fighters.map((fighter) => [
        `${fighter.team}-${fighter.lane}`,
        fighter,
    ])), [fighters]);
    const beatsByActor = useMemo(() => {
        const authored = warfrontBodyContactBeats(cues);
        const resolved = new Map<string, CanvasBeat[]>();
        const origin = createActorPoseSample();
        const target = createActorPoseSample();
        for (const [actorId, beats] of authored) {
            resolved.set(actorId, beats.map((beat) => {
                let dx = 0;
                let dz = 0;
                let fallbackX = 1;
                let fallbackZ = 0;
                for (const cue of beat.cues) {
                    const from = sampleActorByIdInto(result, cue.actorId, cue.contactTick, origin);
                    const to = sampleActorByIdInto(result, cue.targetId, cue.contactTick, target);
                    const direction = warfrontContactDirection(from.x, from.z, to.x, to.z, from.faceX, from.faceZ);
                    dx += direction.x; dz += direction.z; fallbackX = direction.x; fallbackZ = direction.z;
                }
                const direction = warfrontContactDirection(0, 0, dx, dz, fallbackX, fallbackZ);
                return { ...beat, directionX: direction.x, directionZ: direction.z };
            }));
        }
        return resolved;
    }, [cues, result]);
    const actorsRef = useRef<CanvasActor[]>([]);
    const broadcastCameraRef = useRef<CanvasBroadcastCamera>(createCanvasBroadcastCamera());
    const staticCanvasRef = useRef<HTMLCanvasElement>(null);
    const staticSize = useRef("");
    const staticArenaMetrics = useRef<CanvasArenaSubmissionMetrics>(EMPTY_CANVAS_ARENA_METRICS);
    const readyReported = useRef(false);
    const groundingQaEnabled = useMemo(
        () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ritemotionqa") === "1",
        [],
    );

    useEffect(() => {
        let active = true;
        readyReported.current = false;
        // Clearing the previous scene before its replacement loads is the point of
        // this effect; without it the old impostors stay on screen through the load.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setImages(null);
        setHeroImpactSprite(null);
        onRendererAvailability?.(true);
        onLoadProgress?.(0);
        const load = urls.map((url) => url
            ? loadImpostorImage(url)
            : Promise.reject<HTMLImageElement>(new Error("Missing exact Warfront impostor")));
        void Promise.all([Promise.all(load), loadImpostorImage(WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL)]).then(([loaded, impactSprite]) => {
            if (active) {
                setImages(loaded);
                setHeroImpactSprite(impactSprite);
            }
        }).catch(() => {
            if (active) onAssetFailure();
        });
        return () => { active = false; };
    }, [onAssetFailure, onLoadProgress, onRendererAvailability, sceneKey, urls]);

    useEffect(() => {
        if (!images || !heroImpactSprite) return;
        broadcastCameraRef.current = createCanvasBroadcastCamera();
        actorsRef.current = fighters.map((fighter, index) => ({
            fighter,
            image: images[index],
            pose: createActorPoseSample(),
            prior: createActorPoseSample(),
            next: createActorPoseSample(),
            beats: beatsByActor.get(`${fighter.team}-${fighter.lane}`) ?? [],
            phase: createWarfrontBodyReactionPhase(),
            scratch: createWarfrontBodyReactionPhase(),
            lastState: "",
            stateSince: 0,
            lastFacing: fighter.team === "player" ? 1 : -1,
            facingCandidate: fighter.team === "player" ? 1 : -1,
            facingCandidateSince: 0,
            facingFlips: 0,
        }));
    }, [beatsByActor, fighters, heroImpactSprite, images]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const impactSpriteImage = heroImpactSprite;
        if (!canvas || !images || !impactSpriteImage) return;
        const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
        if (!context) return;
        let frame = 0;
        let terminal: { wall: number; tick: number } | null = null;
        let performanceStarted = false;
        let performanceObserver: PerformanceObserver | null = null;
        let performanceTimer: number | null = null;
        let sampleWindow: { warmup: number; end: number } | null = null;
        let lastFrameAt: number | null = null;
        let maxGap = 0;
        let gaps = 0;
        let maxActiveCues = 0;
        let maxSpectacleParticles = 0;
        const spectacleElementsSeen = new Set<string>();
        let lungeSeen = false;
        let recoilSeen = false;
        let koSeen = false;
        let maxBodyActive = 0;
        let maxBodyOffset = 0;
        let maxGroundingActiveRings = 0;
        let maxActorLocalHpBars = 0;
        let actorLocalHpAnchorsMoved = false;
        const firstActorLocalHpAnchor = new Map<string, { x: number; y: number }>();
        // Two reusable actor-sized surfaces keep the arena grade clipped to the
        // current atlas frame's alpha. The second surface is a tint mask, so the
        // primary pass can use a real multiply blend without ever painting a
        // colored rectangle outside the fighter silhouette.
        const actorLightSurface = document.createElement("canvas");
        const actorLightContext = actorLightSurface.getContext("2d", { alpha: true });
        const actorLightMaskSurface = document.createElement("canvas");
        const actorLightMaskContext = actorLightMaskSurface.getContext("2d", { alpha: true });
        const cueOrigin = createActorPoseSample();
        const cueTarget = createActorPoseSample();
        const heroHpBeforePose = createActorPoseSample();
        const heroHpAfterPose = createActorPoseSample();
        const heroPhase = createWarfrontSpectaclePhase();
        const focusPhase = createWarfrontSpectaclePhase();
        const cameraOrigin = createActorPoseSample();
        const cameraTarget = createActorPoseSample();
        const facingTarget = createActorPoseSample();
        const candidateSpectaclePhase = createWarfrontSpectaclePhase();
        const spectaclePhases = Array.from({ length: WARFRONT_SPECTACLE_OVERLAP_CAP }, createWarfrontSpectaclePhase);
        const activeSpectacleCues: WarfrontAttackCue[] = [];
        const activeSpectaclePriorities: number[] = [];
        const renderedActors = new Map<string, {
            x: number;
            footY: number;
            baseSize: number;
            hp: number;
            maxHp: number;
            recoil: number;
            team: "player" | "enemy";
            healthFraction: number;
            visibility: number;
        }>();

        const paint = (now: number) => {
            const cssWidth = Math.max(1, canvas.clientWidth);
            const cssHeight = Math.max(1, canvas.clientHeight);
            const dpr = Math.min(1.15, window.devicePixelRatio || 1);
            const pixelWidth = Math.round(cssWidth * dpr);
            const pixelHeight = Math.round(cssHeight * dpr);
            if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
                canvas.width = pixelWidth;
                canvas.height = pixelHeight;
                staticSize.current = "";
            }
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            context.clearRect(0, 0, cssWidth, cssHeight);
            renderedActors.clear();
            const tick = clockRef.current;
            if (tick >= result.ticks - 0.001) {
                if (!terminal) terminal = { wall: now, tick };
            } else terminal = null;
            const presentationTick = terminal ? terminal.tick + (now - terminal.wall) / 1000 * DUEL_TPS : tick;
            const ordered = actorsRef.current;
            for (const actor of ordered) sampleActorInto(result, actor.fighter.team, actor.fighter.lane, tick, actor.pose);

            // Actor-first broadcast direction. Establish the whole formation,
            // then frame the current attack pair plus nearby support instead of
            // leaving the camera fixed on an empty courtyard after every KO.
            const cameraState = broadcastCameraRef.current;
            const cueKey = (cue: WarfrontAttackCue) => `${cue.actorId}>${cue.targetId}@${cue.contactTick}`;
            // Direct one readable shot at a time. Without this hold, several
            // simultaneous duels could win priority on adjacent frames and
            // make the phone camera chase the entire board. Once selected, a
            // pair owns the lens from anticipation through contact.
            let focusCue = cues.find((cue) => cueKey(cue) === cameraState.shotCueKey
                && tick >= cue.contactTick - 84
                && tick <= cue.contactTick + 3) ?? null;
            if (!focusCue) {
                let bestScore = Number.POSITIVE_INFINITY;
                for (const cue of cues) {
                    const untilContact = cue.contactTick - tick;
                    if (untilContact < -2 || untilContact > 84) continue;
                    const actorPose = sampleActorByIdInto(result, cue.actorId, tick, cameraOrigin);
                    const targetPose = sampleActorByIdInto(result, cue.targetId, tick, cameraTarget);
                    if (untilContact > 0 && (actorPose.hp <= 0 || targetPose.hp <= 0)) continue;
                    const midpointX = (actorPose.x + targetPose.x) * 0.5;
                    const midpointZ = (actorPose.z + targetPose.z) * 0.5;
                    const travelDistance = cameraState.initialized
                        ? Math.hypot(midpointX - cameraState.x, midpointZ - cameraState.z)
                        : 0;
                    // Never accept a shot the bounded two-unit/second camera
                    // cannot establish before contact. Skipping an off-camera
                    // exchange is preferable to showing a clipped pet or
                    // snapping the lens across the arena.
                    const requiredLeadTicks = Math.max(0, travelDistance - 1.2) / 2 * DUEL_TPS;
                    if (cameraState.initialized && (untilContact <= 0 ? travelDistance > 1.2 : untilContact < requiredLeadTicks)) continue;
                    const travelCost = travelDistance * 6;
                    const score = Math.max(0, untilContact) + travelCost - (cue.lethal ? 1 : 0);
                    if (score < bestScore) { focusCue = cue; bestScore = score; }
                }
                cameraState.shotCueKey = focusCue ? cueKey(focusCue) : "";
            }
            const fallbackFocus = actionFocus(result, tick);
            const focusVisualPhase = focusCue ? warfrontSpectaclePhaseInto(focusCue, tick, focusPhase) : null;
            const focusVisualStrength = focusVisualPhase
                ? Math.max(focusVisualPhase.tell * 0.42, focusVisualPhase.travel, focusVisualPhase.contact, focusVisualPhase.result * 0.82)
                : 0;
            const focusPoints: ActorPose[] = [];
            if (focusCue) {
                focusPoints.push(
                    sampleActorByIdInto(result, focusCue.actorId, tick, cameraOrigin),
                    sampleActorByIdInto(result, focusCue.targetId, tick, cameraTarget),
                );
                const focusMidX = (focusPoints[0].x + focusPoints[1].x) * 0.5;
                const focusMidZ = (focusPoints[0].z + focusPoints[1].z) * 0.5;
                for (const team of ["player", "enemy"] as const) {
                    let support: CanvasActor | null = null;
                    let supportDistance = Number.POSITIVE_INFINITY;
                    for (const actor of ordered) {
                        const actorId = `${actor.fighter.team}-${actor.fighter.lane}`;
                        if (actor.fighter.team !== team || actor.pose.hp <= 0 || actorId === focusCue.actorId || actorId === focusCue.targetId) continue;
                        const distance = Math.hypot(actor.pose.x - focusMidX, actor.pose.z - focusMidZ);
                        if (distance < supportDistance) { support = actor; supportDistance = distance; }
                    }
                    const supportLimit = cssHeight > cssWidth ? 3.25 : 4.2;
                    if (support && supportDistance <= supportLimit) focusPoints.push(support.pose);
                }
            }

            let targetX = fallbackFocus.x;
            let targetZ = fallbackFocus.z;
            let spanX = Math.max(4.5, fallbackFocus.radius * 1.7);
            let spanZ = Math.max(3.7, fallbackFocus.radius * 1.35);
            let focusId = "living-cloud";
            if (focusPoints.length >= 2 && tick > DUEL_TPS * 0.55) {
                targetX = focusPoints.reduce((sum, pose) => sum + pose.x, 0) / focusPoints.length;
                targetZ = focusPoints.reduce((sum, pose) => sum + pose.z, 0) / focusPoints.length;
                spanX = Math.max(4.8, ...focusPoints.map((pose) => Math.abs(pose.x - targetX) * 2 + 2.8));
                spanZ = Math.max(3.8, ...focusPoints.map((pose) => Math.abs(pose.z - targetZ) * 2 + 2.4));
                focusId = `${focusCue?.actorId ?? "action"}>${focusCue?.targetId ?? "target"}`;
            }

            const portrait = cssHeight > cssWidth;
            const root = canvas.closest(".wfr-root") as HTMLElement | null;
            const hudBottom = (root?.querySelector(".wfr-hud") as HTMLElement | null)?.getBoundingClientRect().bottom ?? 0;
            const topSafe = portrait
                ? Math.min(152, Math.max(104, hudBottom + 10))
                : Math.min(92, Math.max(64, hudBottom + 8));
            const bottomSafe = portrait ? Math.max(28, cssHeight * 0.045) : Math.max(20, cssHeight * 0.035);
            const viewCenterX = cssWidth * 0.5;
            const viewCenterY = topSafe + (cssHeight - topSafe - bottomSafe) * 0.5;
            const fraction = framingFractions(cssWidth, cssHeight);
            const baseXScale = (cssWidth * 0.5 * fraction.x) / WARFRONT_ARENA_X;
            const baseZScale = ((cssHeight - topSafe - bottomSafe) * 0.5 * (portrait ? 0.82 : 0.9)) / WARFRONT_ARENA_Y;
            const desiredZoom = Math.max(1, Math.min(portrait ? 2.05 : 1.8,
                (cssWidth * (portrait ? 0.82 : 0.76)) / Math.max(1, spanX * baseXScale),
                ((cssHeight - topSafe - bottomSafe) * 0.78) / Math.max(1, spanZ * baseZScale),
            ));
            const elapsedSeconds = cameraState.lastFrameAt > 0 ? Math.min(0.05, Math.max(0.001, (now - cameraState.lastFrameAt) / 1000)) : 1 / 60;
            cameraState.lastFrameAt = now;
            if (!cameraState.initialized) {
                cameraState.x = targetX;
                cameraState.z = targetZ;
                cameraState.zoom = desiredZoom;
                cameraState.initialized = true;
            } else {
                const deadZone = focusId === cameraState.focusId ? 0.28 : 0.08;
                const desiredX = Math.abs(targetX - cameraState.x) < deadZone ? cameraState.x : targetX;
                const desiredZ = Math.abs(targetZ - cameraState.z) < deadZone ? cameraState.z : targetZ;
                const oldX = cameraState.x;
                const oldZ = cameraState.z;
                const oldZoom = cameraState.zoom;
                const panX = desiredX - cameraState.x;
                const panZ = desiredZ - cameraState.z;
                const panDistance = Math.hypot(panX, panZ);
                const panStep = Math.min(panDistance, elapsedSeconds * 2);
                if (panDistance > 0.0001) {
                    cameraState.x += panX / panDistance * panStep;
                    cameraState.z += panZ / panDistance * panStep;
                }
                cameraState.zoom = approach(cameraState.zoom, desiredZoom, elapsedSeconds * 0.5);
                cameraState.maxPanPerFrame = Math.max(cameraState.maxPanPerFrame, Math.hypot(cameraState.x - oldX, cameraState.z - oldZ));
                cameraState.maxZoomPerFrame = Math.max(cameraState.maxZoomPerFrame, Math.abs(cameraState.zoom - oldZoom));
            }
            cameraState.focusId = focusId;
            const xScale = baseXScale * cameraState.zoom;
            const zScale = baseZScale * cameraState.zoom;
            const project = (x: number, z: number) => [
                viewCenterX + (x - cameraState.x) * xScale,
                viewCenterY + (z - cameraState.z) * zScale,
            ] as const;
            if (root) {
                root.dataset.wfrCanvasCamera = "true";
                root.style.setProperty("--wfr-camera-zoom", cameraState.zoom.toFixed(4));
                root.style.setProperty("--wfr-camera-shift-x", `${(viewCenterX - cssWidth * 0.5 - cameraState.x * xScale).toFixed(2)}px`);
                root.style.setProperty("--wfr-camera-shift-y", `${(viewCenterY - cssHeight * 0.5 - cameraState.z * zScale).toFixed(2)}px`);
            }
            const sizeKey = `${Math.round(cssWidth)}:${Math.round(cssHeight)}:${Math.round(cameraState.x * xScale)}:${Math.round(cameraState.z * zScale)}:${Math.round(cameraState.zoom * 100)}`;
            if (staticSize.current !== sizeKey && staticCanvasRef.current) {
                staticArenaMetrics.current = drawArena(staticCanvasRef.current, cssWidth, cssHeight, project);
                staticSize.current = sizeKey;
            }
            context.save();
            context.beginPath();
            context.rect(0, topSafe, cssWidth, Math.max(1, cssHeight - topSafe - bottomSafe));
            context.clip();

            // One compact scroll supplies objective identity. Its hairline
            // state decal is floor-flush and the prop is painted before pets,
            // so even a carrier always remains the foreground silhouette.
            const scroll = sampleForbiddenScroll(result, tick) ?? {
                x: 0,
                y: 0,
                state: "sealed" as const,
                carrierId: null,
                owner: null,
            };
            let objectiveFloorDecalDraws = 0;
            let objectiveFloorDecalMaxAlpha: number;
            let objectiveFloorDecalMaxRadiusPx: number;
            let scrollPropDraws = 0;
            {
                const [objectiveX, objectiveY] = project(scroll.x, scroll.y);
                const [objectiveRadiusX] = project(scroll.x + ARENA_OBJECTIVE_DECAL_RADIUS_WORLD, scroll.y);
                const [, objectiveRadiusY] = project(scroll.x, scroll.y + ARENA_OBJECTIVE_DECAL_RADIUS_WORLD);
                const radiusX = Math.abs(objectiveRadiusX - objectiveX);
                const radiusY = Math.abs(objectiveRadiusY - objectiveY);
                const objectiveTeam = scroll.carrierId?.startsWith("player-") ? "player"
                    : scroll.carrierId?.startsWith("enemy-") ? "enemy"
                        : scroll.owner;
                const objectiveColor = objectiveTeam ? RITE_TEAM_COLOR[objectiveTeam] : "#d6b775";
                const decalAlpha = Math.min(ARENA_FLOOR_DECAL_ALPHA_CAP,
                    scroll.state === "dropped" ? 0.18 : scroll.state === "carried" ? 0.14 : 0.12);
                context.save();
                context.globalAlpha = decalAlpha;
                context.strokeStyle = objectiveColor;
                context.lineWidth = Math.max(0.65, Math.min(1, Math.min(cssWidth, cssHeight) * 0.0011));
                context.beginPath();
                context.ellipse(objectiveX, objectiveY + 1, radiusX, radiusY * 0.72, 0, 0, Math.PI * 2);
                context.stroke();
                context.restore();
                objectiveFloorDecalDraws++;
                objectiveFloorDecalMaxAlpha = decalAlpha;
                objectiveFloorDecalMaxRadiusPx = Math.max(radiusX, radiusY);

                const scrollWidth = Math.max(8, Math.min(16, Math.abs(project(scroll.x + 0.56, scroll.y)[0] - objectiveX)));
                const scrollHeight = scrollWidth * 0.4;
                context.save();
                context.translate(objectiveX, objectiveY - 1);
                context.rotate(Math.sin(tick * 0.025) * 0.04);
                context.globalAlpha = scroll.state === "carried" ? 0.82 : 0.92;
                context.fillStyle = "#d9c391";
                context.fillRect(-scrollWidth * 0.38, -scrollHeight * 0.5, scrollWidth * 0.76, scrollHeight);
                scrollPropDraws++;
                context.strokeStyle = "rgba(67, 38, 24, .82)";
                context.lineWidth = Math.max(0.6, scrollWidth * 0.055);
                context.strokeRect(-scrollWidth * 0.38, -scrollHeight * 0.5, scrollWidth * 0.76, scrollHeight);
                scrollPropDraws++;
                context.fillStyle = "#503020";
                for (const side of [-1, 1] as const) {
                    context.beginPath();
                    context.ellipse(side * scrollWidth * 0.43, 0, scrollWidth * 0.09, scrollHeight * 0.62, 0, 0, Math.PI * 2);
                    context.fill();
                    scrollPropDraws++;
                }
                context.fillStyle = objectiveColor;
                context.fillRect(-scrollWidth * 0.035, -scrollHeight * 0.56, scrollWidth * 0.07, scrollHeight * 1.12);
                scrollPropDraws++;
                context.restore();
            }

            let contacts = 0;
            let longestDistance = 0;
            let longestEndpoints = "";
            let tells = 0;
            let results = 0;
            let particles = 0;
            const heroStageName = heroCue
                ? warfrontHeroStage(warfrontSpectaclePhaseInto(heroCue, tick, heroPhase))
                : "idle";
            let heroOriginAnchor = "";
            let heroTargetAnchor = "";
            let heroCorridorLength = 0;
            let heroFlareVisiblePx = 0;
            let heroTravelCoreVisiblePx = 0;
            let heroTravelPlumeVisiblePx = 0;
            let heroTravelSpanFraction = 0;
            let heroTravelAxisX = 0;
            let heroTravelAxisY = 0;
            let heroAxisTailVisible = false;
            let heroAxisTailStrength = 0;
            let heroAxisTailAxis = "";
            let heroBurstVisiblePx = 0;
            let heroBurstHoldActive = false;
            let heroImpactVisiblePx = 0;
            let heroImpactHoldActive = false;
            let heroContactFrontActive = false;
            let heroContactTargetWidthPx = 0;
            let heroContactSpanPx = 0;
            let heroImpactSpriteVisible = false;
            let heroImpactSpriteRotationRad = 0;
            let heroImpactSpriteAxis = "";
            let heroImpactSpriteFootprintPx = 0;
            let heroResidueVisible = false;
            let heroResidueSpanPx = 0;
            let heroResidueMaterialStrength = 0;
            activeSpectacleCues.length = 0;
            activeSpectaclePriorities.length = 0;
            for (const cue of cues) {
                if (!warfrontSpectaclePhaseInto(cue, tick, candidateSpectaclePhase).visible) continue;
                const priority = warfrontSpectaclePriority(cue, tick) + (cue === heroCue ? 1_000 : 0);
                let insertAt = activeSpectaclePriorities.findIndex((value) => priority > value);
                if (insertAt < 0) insertAt = activeSpectaclePriorities.length;
                activeSpectaclePriorities.splice(insertAt, 0, priority);
                activeSpectacleCues.splice(insertAt, 0, cue);
                if (activeSpectacleCues.length > WARFRONT_SPECTACLE_OVERLAP_CAP) {
                    activeSpectacleCues.pop();
                    activeSpectaclePriorities.pop();
                }
            }
            const particlesPerCue = warfrontSpectacleParticleBudget(Math.min(cssWidth, cssHeight), activeSpectacleCues.length);
            const activeCues = activeSpectacleCues.length;
            for (let cueIndex = 0; cueIndex < activeSpectacleCues.length; cueIndex++) {
                const cue = activeSpectacleCues[cueIndex];
                const phase = warfrontSpectaclePhaseInto(cue, tick, spectaclePhases[cueIndex]);
                if (phase.contact > 0) contacts++;
                if (phase.tell > 0) tells++;
                if (phase.result > 0) results++;
                if (phase.result > 0) particles += Math.min(4, particlesPerCue);
                const from = sampleActorByIdInto(result, cue.actorId, cue.tellTick, cueOrigin);
                const to = sampleActorByIdInto(result, cue.targetId, cue.contactTick, cueTarget);
                const [ox, projectedOy] = project(from.x, from.z);
                const [tx, projectedTy] = project(to.x, to.z);
                const fromFighter = fighterByActorId.get(cue.actorId);
                const toFighter = fighterByActorId.get(cue.targetId);
                const oy = fromFighter
                    ? riteCanvasLivingWaterFootAnchorY(fromFighter.pet.element, projectedOy, cssWidth, cssHeight, from.hp > 0 && from.state !== "dead", false)
                    : projectedOy;
                const ty = toFighter
                    ? riteCanvasLivingWaterFootAnchorY(toFighter.pet.element, projectedTy, cssWidth, cssHeight, to.hp > 0 && to.state !== "dead", false)
                    : projectedTy;
                const distance = Math.hypot(tx - ox, ty - oy);
                if (distance > longestDistance) { longestDistance = distance; longestEndpoints = `${from.x.toFixed(2)},${from.z.toFixed(2)}>${to.x.toFixed(2)},${to.z.toFixed(2)}`; }
                const signature = warfrontElementSignature(cue.element);
                spectacleElementsSeen.add(signature.element);
                const radius = Math.max(13, Math.min(28, Math.min(cssWidth, cssHeight) * 0.035));
                const isHero = cue === heroCue;
                if (isHero) {
                    const heroTargetImpactY = ty - Math.max(46, Math.min(108, Math.min(cssWidth, cssHeight) * 0.22)) * 0.44;
                    const heroAxisDx = tx - ox;
                    const heroAxisDy = heroTargetImpactY - (oy - 12);
                    const heroAxisLength = Math.max(0.001, Math.hypot(heroAxisDx, heroAxisDy));
                    heroTravelAxisX = heroAxisDx / heroAxisLength;
                    heroTravelAxisY = heroAxisDy / heroAxisLength;
                    const ownerFlareStrength = phase.travel > 0 ? 0 : phase.tell;
                    drawWarfrontHeroFireFlare(context, ox, oy - 12, ownerFlareStrength);
                    if (ownerFlareStrength > 0) heroFlareVisiblePx = WARFRONT_HERO_FLARE_MIN_PX;
                    heroOriginAnchor = `${ox.toFixed(1)},${(oy - 12).toFixed(1)}`;
                    heroTargetAnchor = `${tx.toFixed(1)},${heroTargetImpactY.toFixed(1)}`;
                    heroCorridorLength = heroAxisLength;
                    const travelStrength = tick < cue.contactTick ? phase.travel : 0;
                    heroTravelSpanFraction = warfrontHeroTravelSpanFraction(travelStrength);
                    drawWarfrontHeroFireCorridor(context, ox, oy - 12, tx, heroTargetImpactY, heroTravelSpanFraction, travelStrength);
                    if (travelStrength > 0) {
                        heroTravelCoreVisiblePx = WARFRONT_HERO_TRAVEL_CORE_PX;
                        heroTravelPlumeVisiblePx = WARFRONT_HERO_TRAVEL_PLUME_PX;
                    }
                } else {
                    drawWarfrontElementTell(context, signature, ox, oy - 12, radius, phase.tell, cueIndex + cue.contactTick * 0.013);
                    drawWarfrontElementTravel(context, signature, ox, oy - 12, tx, ty - 12, phase.travel, Math.max(phase.travel, phase.contact), cueIndex + cue.contactTick * 0.017);
                }
            }
            maxActiveCues = Math.max(maxActiveCues, activeCues);

            // One broadcast sentence makes the selected exchange legible at a
            // glance. It is deliberately shared by every element: authored
            // elemental VFX still supply material identity, while this layer
            // owns only source, direction and target hierarchy.
            let broadcastFocusLabel = "";
            let broadcastImpactX = 0;
            let broadcastImpactY = 0;
            if (focusCue && focusVisualPhase && focusVisualStrength > 0.01) {
                const sourcePose = sampleActorByIdInto(result, focusCue.actorId, tick, cameraOrigin);
                const targetPose = sampleActorByIdInto(result, focusCue.targetId, tick, cameraTarget);
                const [sourceX, sourceY] = project(sourcePose.x, sourcePose.z);
                const [targetX, targetY] = project(targetPose.x, targetPose.z);
                const signature = warfrontElementSignature(focusCue.element);
                const dx = targetX - sourceX;
                const dy = targetY - sourceY;
                const length = Math.max(1, Math.hypot(dx, dy));
                const nx = dx / length;
                const ny = dy / length;
                const bend = Math.max(-42, Math.min(42, length * signature.travelBend));
                const controlX = (sourceX + targetX) * 0.5 - ny * bend;
                const controlY = (sourceY + targetY) * 0.5 + nx * bend;
                const connectionStrength = Math.max(focusVisualPhase.travel, focusVisualPhase.contact, focusVisualPhase.result * 0.62, focusVisualPhase.tell * 0.22);
                context.save();
                context.globalCompositeOperation = "lighter";
                context.globalAlpha = connectionStrength;
                context.lineCap = "round";
                context.shadowColor = signature.primary;
                context.shadowBlur = Math.min(22, 8 + connectionStrength * 14);
                const beamGradient = context.createLinearGradient(sourceX, sourceY, targetX, targetY);
                beamGradient.addColorStop(0, RITE_TEAM_COLOR[focusCue.side]);
                beamGradient.addColorStop(0.5, signature.highlight);
                beamGradient.addColorStop(1, signature.primary);
                context.strokeStyle = beamGradient;
                context.lineWidth = Math.max(2.5, Math.min(6, Math.min(cssWidth, cssHeight) * 0.009));
                context.beginPath();
                context.moveTo(sourceX, sourceY - 18);
                context.quadraticCurveTo(controlX, controlY - 18, targetX, targetY - 18);
                context.stroke();
                context.globalAlpha = connectionStrength * 0.95;
                context.fillStyle = signature.highlight;
                const travelProgress = focusVisualPhase.travel > 0
                    ? Math.max(0.18, Math.min(0.9, (tick - (focusCue.contactTick - 5)) / 5))
                    : focusVisualPhase.contact > 0 || focusVisualPhase.result > 0 ? 0.96 : 0.12;
                const oneMinus = 1 - travelProgress;
                const carrierX = oneMinus * oneMinus * sourceX + 2 * oneMinus * travelProgress * controlX + travelProgress * travelProgress * targetX;
                const carrierY = oneMinus * oneMinus * (sourceY - 18) + 2 * oneMinus * travelProgress * (controlY - 18) + travelProgress * travelProgress * (targetY - 18);
                context.beginPath();
                context.arc(carrierX, carrierY, Math.max(4, Math.min(8, cssWidth * 0.014)), 0, Math.PI * 2);
                context.fill();
                if (focusVisualPhase.contact > 0 || focusVisualPhase.result > 0) {
                    const impactStrength = Math.max(focusVisualPhase.contact, focusVisualPhase.result * 0.9);
                    const impactRadius = Math.max(34, Math.min(58, Math.min(cssWidth, cssHeight) * 0.115));
                    const glow = context.createRadialGradient(targetX, targetY - 22, 0, targetX, targetY - 22, impactRadius);
                    glow.addColorStop(0, `rgba(255,255,255,${0.92 * impactStrength})`);
                    glow.addColorStop(0.18, signature.highlight);
                    glow.addColorStop(0.48, signature.primary);
                    glow.addColorStop(1, "rgba(0,0,0,0)");
                    context.globalAlpha = 0.36 + impactStrength * 0.44;
                    context.fillStyle = glow;
                    context.beginPath(); context.arc(targetX, targetY - 22, impactRadius, 0, Math.PI * 2); context.fill();
                    broadcastImpactX = targetX;
                    broadcastImpactY = targetY - 22;
                }
                context.restore();
                const actorName = fighterByActorId.get(focusCue.actorId)?.pet.name ?? (focusCue.side === "player" ? "Azure" : "Crimson");
                const targetName = fighterByActorId.get(focusCue.targetId)?.pet.name ?? (focusCue.side === "player" ? "Crimson" : "Azure");
                broadcastFocusLabel = `${actorName} · ${signature.element.toUpperCase()} → ${targetName}`;
            }

            let bodyActive = 0;
            let lunges = 0;
            let lethalLunges = 0;
            let recoils = 0;
            let koExits = 0;
            let activeGroundingRings = 0;
            let idleGroundingActors = 0;
            let deadGroundingActors = 0;
            let idleGroundingRings = 0;
            let deadGroundingRings = 0;
            let submittedAoCount = 0;
            let submittedAoMaxRadiusPx = 0;
            let submittedAoMaxRadiusRatio = 0;
            let submittedRimCount = 0;
            let submittedRimMaxRadiusPx = 0;
            let submittedArenaLightOverlays = 0;
            let submittedArenaLightMaxAlpha = 0;
            let submittedArenaLightMultiplyMaxAlpha = 0;
            let submittedArenaLightEdgeRecoveryMaxAlpha = 0;
            let groundingFootprints = "";
            const authoritativeGroundingActorId = authoritativeGroundingActorAt(cues, tick);
            ordered.sort((a, b) => a.pose.z - b.pose.z || a.fighter.lane - b.fighter.lane);
            for (const actor of ordered) {
                const { fighter, pose } = actor;
                const id = `${fighter.team}-${fighter.lane}`;
                if (pose.state !== actor.lastState || tick < actor.stateSince) { actor.lastState = pose.state; actor.stateSince = tick; }
                const stateAge = Math.max(0, (pose.state === "dead" ? presentationTick : tick) - actor.stateSince);
                const prior = sampleActorInto(result, fighter.team, fighter.lane, Math.max(0, tick - 0.7), actor.prior);
                sampleActorInto(result, fighter.team, fighter.lane, tick, actor.next);
                const vx = pose.x - prior.x;
                const vz = pose.z - prior.z;
                const moving = tick > 0.01 && Math.hypot(vx, vz) > 0.018 && !["windup", "strike", "recover", "dead", "stagger"].includes(pose.state);
                const hereScreen = project(pose.x, pose.z);
                let facingScreenX = 0;
                if (pose.targetId) {
                    const targetPose = sampleActorByIdInto(result, pose.targetId, tick, facingTarget);
                    if (targetPose.hp > 0 && targetPose.state !== "dead") facingScreenX = project(targetPose.x, targetPose.z)[0] - hereScreen[0];
                }
                if (Math.abs(facingScreenX) < 1.25 && moving) {
                    facingScreenX = hereScreen[0] - project(prior.x, prior.z)[0];
                }
                if (Math.abs(facingScreenX) < 1.25) {
                    facingScreenX = project(pose.x + pose.faceX, pose.z + pose.faceZ)[0] - hereScreen[0];
                }
                const desiredFacing = facingScreenX >= 0 ? 1 : -1;
                if (desiredFacing === actor.lastFacing) {
                    actor.facingCandidate = desiredFacing;
                    actor.facingCandidateSince = tick;
                } else if (desiredFacing !== actor.facingCandidate) {
                    actor.facingCandidate = desiredFacing;
                    actor.facingCandidateSince = tick;
                } else if (tick - actor.facingCandidateSince >= (moving ? 3 : 1.5)) {
                    actor.lastFacing = desiredFacing;
                    actor.facingFlips++;
                    actor.facingCandidateSince = tick;
                }
                const beat = sampleBody(actor.beats, presentationTick, actor.phase, actor.scratch);
                if (beat) {
                    const causesKo = beat.lethal || beat.cues.some((cue) => cue.lethal);
                    bodyActive++;
                    if (actor.phase.lunge > 0.01) { lunges++; lungeSeen = true; if (causesKo) lethalLunges++; }
                    if (actor.phase.recoil > 0.01) { recoils++; recoilSeen = true; }
                    if (actor.phase.koExit > 0.01) { koExits++; koSeen = true; }
                }
                const offset = actor.phase.lunge * BODY_LUNGE_DISTANCE + actor.phase.recoil * BODY_RECOIL_DISTANCE + actor.phase.koExit * BODY_KO_EXIT_DISTANCE;
                maxBodyOffset = Math.max(maxBodyOffset, offset);
                const bodyX = beat ? beat.directionX * offset : 0;
                const bodyZ = beat ? beat.directionZ * offset : 0;
                const [x, y] = project(pose.x + bodyX, pose.z + bodyZ);
                const teamColor = RITE_TEAM_COLOR[fighter.team];
                const alive = pose.hp > 0 && pose.state !== "dead";
                const isFocusActor = focusCue?.actorId === id || focusCue?.targetId === id;
                const focusScale = focusVisualStrength > 0.12 ? (isFocusActor ? 1.16 : 0.88) : 1;
                const baseSize = Math.max(54, Math.min(portrait ? 128 : 140,
                    Math.min(cssWidth, cssHeight) * 0.22 * Math.min(1.22, Math.sqrt(cameraState.zoom)) * focusScale,
                ));
                const targetReaction = beat?.role === "target";
                const attackerReaction = beat?.role === "attacker";
                const visualState = targetReaction && actor.phase.recoil > 0.01 ? "stagger" : attackerReaction && actor.phase.lunge > 0.01 ? "strike" : pose.state;
                const koExiting = actor.phase.koExit > 0;
                const renderFootY = riteCanvasLivingWaterFootAnchorY(
                    fighter.pet.element, y, cssWidth, cssHeight, alive, koExiting,
                );
                if (visualState === "idle" && alive) idleGroundingActors++;
                if (!alive) deadGroundingActors++;
                const deathVisibility = visualState === "dead" ? Math.max(0, 1 - Math.max(0, stateAge - 18) / 10) : 1;
                const actorVisibility = deathVisibility * (focusVisualStrength > 0.18 && !isFocusActor ? 0.46 : 1);

                // Natural contact AO: a compact, fully feathered falloff whose
                // transparent edge reveals the authored wet slate. This is not
                // a filled base disc and carries no team ownership by itself.
                const groundingSuppressedForQa = groundingQaEnabled
                    && canvas.dataset.riteGroundingQaHide === "1";
                const aoVisibility = groundingSuppressedForQa ? 0 : alive ? 1 : deathVisibility * 0.24;
                const shadowRadius = baseSize * 0.28;
                const aoDepthScale = riteCanvasGroundingAoDepthScale(fighter.pet.element);
                const aoForwardOffset = riteGroundingAoCameraForwardOffset(fighter.pet.element, baseSize);
                const aoCenterY = renderFootY + 5 + aoForwardOffset;
                if (groundingQaEnabled) {
                    groundingFootprints += `${groundingFootprints ? ";" : ""}${id},${x.toFixed(2)},${aoCenterY.toFixed(2)},${(shadowRadius * 2).toFixed(2)},${fighter.pet.element ?? "None"},${alive ? "living" : "dead"},${koExiting ? "ko-exit" : "steady"}`;
                }
                if (aoVisibility > 0.001) {
                    context.save();
                    context.translate(x, aoCenterY);
                    context.scale(1, aoDepthScale);
                    const contactShadow = context.createRadialGradient(0, 0, 0, 0, 0, shadowRadius);
                    contactShadow.addColorStop(0, `rgba(5, 12, 13, ${0.42 * aoVisibility})`);
                    contactShadow.addColorStop(0.42, `rgba(5, 12, 13, ${0.12 * aoVisibility})`);
                    contactShadow.addColorStop(1, "rgba(5, 12, 13, 0)");
                    context.fillStyle = contactShadow;
                    context.beginPath(); context.arc(0, 0, shadowRadius, 0, Math.PI * 2); context.fill();
                    context.restore();
                    submittedAoCount++;
                    submittedAoMaxRadiusPx = Math.max(submittedAoMaxRadiusPx, shadowRadius);
                    submittedAoMaxRadiusRatio = Math.max(submittedAoMaxRadiusRatio, shadowRadius / baseSize);
                }

                // One authoritative attack sentence owns the only faction rune
                // in the whole frame. Concurrent recover/stagger states submit
                // exact zero rather than multiplying token rings.
                const groundingStrength = !groundingSuppressedForQa && id === authoritativeGroundingActorId
                    ? riteGroundingFocusStrength(visualState, alive, stateAge)
                    : 0;
                if (groundingStrength > 0.001) {
                    activeGroundingRings++;
                    if (visualState === "idle") idleGroundingRings++;
                    if (visualState === "dead") deadGroundingRings++;
                    context.save();
                    context.globalAlpha = groundingStrength * 0.34;
                    context.strokeStyle = teamColor;
                    context.lineWidth = Math.max(0.55, Math.min(0.8, baseSize * 0.006));
                    const rimRadius = baseSize * 0.17;
                    context.beginPath(); context.ellipse(x, y + 4.5, rimRadius, baseSize * 0.035, 0, 0, Math.PI * 2); context.stroke();
                    context.restore();
                    submittedRimCount++;
                    submittedRimMaxRadiusPx = Math.max(submittedRimMaxRadiusPx, rimRadius);
                }
                let atlasFrame = Math.floor(tick * 0.12) % 4;
                if (visualState === "dead") atlasFrame = 12 + Math.min(2, Math.floor(stateAge / 7));
                else if (visualState === "stagger") atlasFrame = 11;
                else if (visualState === "strike") atlasFrame = 9 + Math.min(1, Math.floor(stateAge / 2));
                else if (visualState === "windup") atlasFrame = 8;
                else if (visualState === "recover") atlasFrame = 10;
                else if (visualState === "dash" || visualState === "dodge") atlasFrame = 6 + (Math.floor(tick * 0.35) & 1);
                else if (moving) atlasFrame = 4 + (Math.floor(tick * 0.28) & 1);
                let atlasNextFrame = atlasFrame;
                let atlasBlend = 0;
                if (moving && visualState !== "dash" && visualState !== "dodge") {
                    const locomotionPhase = tick * 0.28;
                    const strideFrame = Math.floor(locomotionPhase) & 1;
                    atlasFrame = 4 + strideFrame;
                    atlasNextFrame = 4 + (strideFrame ^ 1);
                    const strideMix = locomotionPhase - Math.floor(locomotionPhase);
                    atlasBlend = strideMix * strideMix * (3 - 2 * strideMix);
                }
                const cellWidth = actor.image.naturalWidth / 4;
                const cellHeight = actor.image.naturalHeight / 4;
                const column = atlasFrame % 4;
                const row = Math.floor(atlasFrame / 4);
                const nextColumn = atlasNextFrame % 4;
                const nextRow = Math.floor(atlasNextFrame / 4);
                let scaleX = 1;
                let scaleY = 1;
                let lift = reducedMotion ? 0 : Math.sin(tick * 0.24 + fighter.lane) * 1.5;
                let roll = 0;
                if (moving) { scaleX = 1.03; scaleY = 0.98; roll = -actor.lastFacing * 0.04; }
                if (visualState === "windup") { scaleX = 1.1; scaleY = 0.86; roll = actor.lastFacing * 0.08; }
                else if (visualState === "strike") { scaleX = 0.92; scaleY = 1.13; lift += baseSize * 0.08; roll = -actor.lastFacing * 0.12; }
                else if (visualState === "recover") { scaleX = 1.04; scaleY = 0.94; }
                else if (visualState === "stagger") { scaleX = 1.09; scaleY = 0.87; roll = -actor.lastFacing * 0.26; }
                if (attackerReaction) { scaleX = 1.04 - actor.phase.lunge * 0.13; scaleY = 0.9 + actor.phase.lunge * 0.22; lift += baseSize * 0.08 * actor.phase.lunge; }
                if (targetReaction) { scaleX *= 1 + actor.phase.recoil * 0.09 - actor.phase.koExit * 0.12; scaleY *= 1 - actor.phase.recoil * 0.13 - actor.phase.koExit * 0.18; roll -= actor.lastFacing * (actor.phase.recoil * 0.28 + actor.phase.koExit * 0.62); }
                renderedActors.set(id, {
                    x,
                    footY: renderFootY + lift,
                    baseSize,
                    hp: pose.hp,
                    maxHp: pose.maxHp,
                    recoil: targetReaction ? actor.phase.recoil : 0,
                    team: fighter.team,
                    healthFraction: Math.max(0, Math.min(1,
                        (pose.maxHp > 0 ? pose.hp / pose.maxHp : 0) * fighter.entryHp,
                    )),
                    visibility: actorVisibility,
                });
                if (actorLightContext && actorLightMaskContext && actorVisibility > 0.001) {
                    const lightMargin = Math.ceil(baseSize * 0.24);
                    const lightSize = Math.ceil(baseSize + lightMargin * 2);
                    if (actorLightSurface.width !== lightSize || actorLightSurface.height !== lightSize) {
                        actorLightSurface.width = lightSize;
                        actorLightSurface.height = lightSize;
                    } else {
                        actorLightContext.clearRect(0, 0, lightSize, lightSize);
                    }
                    if (actorLightMaskSurface.width !== lightSize || actorLightMaskSurface.height !== lightSize) {
                        actorLightMaskSurface.width = lightSize;
                        actorLightMaskSurface.height = lightSize;
                    } else {
                        actorLightMaskContext.clearRect(0, 0, lightSize, lightSize);
                    }
                    const lightOriginX = lightMargin + baseSize * 0.5;
                    const lightOriginY = lightMargin + baseSize * 0.82;
                    for (const [surfaceContext, alpha] of [[actorLightContext, actorVisibility], [actorLightMaskContext, 1]] as const) {
                        surfaceContext.save();
                        surfaceContext.translate(lightOriginX, lightOriginY);
                        surfaceContext.rotate(roll);
                        // The authored atlas faces screen-left when unmirrored.
                        // `lastFacing` is the desired screen direction, so the
                        // native sign must be inverted here.
                        surfaceContext.scale(-actor.lastFacing * scaleX, scaleY);
                        surfaceContext.globalAlpha = alpha * (1 - atlasBlend);
                        surfaceContext.drawImage(actor.image, column * cellWidth, row * cellHeight, cellWidth, cellHeight, -baseSize * 0.5, -baseSize * 0.82, baseSize, baseSize);
                        if (atlasBlend > 0.001) {
                            surfaceContext.globalAlpha = alpha * atlasBlend;
                            surfaceContext.drawImage(actor.image, nextColumn * cellWidth, nextRow * cellHeight, cellWidth, cellHeight, -baseSize * 0.5, -baseSize * 0.82, baseSize, baseSize);
                        }
                        surfaceContext.restore();
                    }

                    // Shape the actor value into the painted court rather than
                    // adding a bright color wash. The continuously interpolated
                    // court hue is multiplied through an alpha-clipped mask;
                    // only a restrained three-percent edge recovery follows.
                    const arenaSide = Math.max(-1, Math.min(1, (x / cssWidth - 0.5) * 2));
                    const sideMix = (arenaSide + 1) * 0.5;
                    const courtRed = Math.round(74 + (164 - 74) * sideMix);
                    const courtGreen = Math.round(137 + (88 - 137) * sideMix);
                    const courtBlue = Math.round(153 + (84 - 153) * sideMix);
                    const multiplyAlpha = 0.10 + Math.abs(arenaSide) * 0.07;
                    const multiplyGradient = actorLightMaskContext.createLinearGradient(0, 0, lightSize, 0);
                    if (arenaSide <= 0) {
                        multiplyGradient.addColorStop(0, `rgba(${courtRed}, ${courtGreen}, ${courtBlue}, ${multiplyAlpha})`);
                        multiplyGradient.addColorStop(1, `rgba(${courtRed}, ${courtGreen}, ${courtBlue}, ${multiplyAlpha * 0.45})`);
                    } else {
                        multiplyGradient.addColorStop(0, `rgba(${courtRed}, ${courtGreen}, ${courtBlue}, ${multiplyAlpha * 0.45})`);
                        multiplyGradient.addColorStop(1, `rgba(${courtRed}, ${courtGreen}, ${courtBlue}, ${multiplyAlpha})`);
                    }
                    actorLightMaskContext.save();
                    actorLightMaskContext.globalCompositeOperation = "source-in";
                    actorLightMaskContext.fillStyle = multiplyGradient;
                    actorLightMaskContext.fillRect(0, 0, lightSize, lightSize);
                    actorLightMaskContext.restore();
                    actorLightContext.save();
                    actorLightContext.globalCompositeOperation = "multiply";
                    actorLightContext.drawImage(actorLightMaskSurface, 0, 0);
                    actorLightContext.restore();

                    const recoveryAlpha = 0.012 + Math.abs(arenaSide) * 0.018;
                    const recoveryRed = Math.round(118 + (237 - 118) * sideMix);
                    const recoveryGreen = Math.round(210 + (133 - 210) * sideMix);
                    const recoveryBlue = Math.round(230 + (116 - 230) * sideMix);
                    const recoveryGradient = actorLightContext.createLinearGradient(0, 0, lightSize, 0);
                    if (arenaSide <= 0) {
                        recoveryGradient.addColorStop(0, `rgba(${recoveryRed}, ${recoveryGreen}, ${recoveryBlue}, ${recoveryAlpha})`);
                        recoveryGradient.addColorStop(1, `rgba(${recoveryRed}, ${recoveryGreen}, ${recoveryBlue}, ${recoveryAlpha * 0.18})`);
                    } else {
                        recoveryGradient.addColorStop(0, `rgba(${recoveryRed}, ${recoveryGreen}, ${recoveryBlue}, ${recoveryAlpha * 0.18})`);
                        recoveryGradient.addColorStop(1, `rgba(${recoveryRed}, ${recoveryGreen}, ${recoveryBlue}, ${recoveryAlpha})`);
                    }
                    actorLightContext.save();
                    actorLightContext.globalCompositeOperation = "source-atop";
                    actorLightContext.fillStyle = recoveryGradient;
                    actorLightContext.fillRect(0, 0, lightSize, lightSize);
                    actorLightContext.restore();
                    context.save();
                    if (fighter.pet.element === "Wind" || fighter.pet.element === "Earth") {
                        context.shadowColor = "rgba(218, 230, 226, 0.3)";
                        context.shadowBlur = Math.max(2, baseSize * 0.05);
                    }
                    context.drawImage(actorLightSurface, x - lightOriginX, renderFootY + lift - lightOriginY);
                    context.restore();
                    submittedArenaLightOverlays++;
                    submittedArenaLightMaxAlpha = Math.max(submittedArenaLightMaxAlpha, multiplyAlpha);
                    submittedArenaLightMultiplyMaxAlpha = Math.max(submittedArenaLightMultiplyMaxAlpha, multiplyAlpha);
                    submittedArenaLightEdgeRecoveryMaxAlpha = Math.max(submittedArenaLightEdgeRecoveryMaxAlpha, recoveryAlpha);
                }
                if (beat) {
                    const causesKo = beat.lethal || beat.cues.some((cue) => cue.lethal);
                    canvas.dataset.riteBodyReactionLast = `${id}:${beat.role}@${beat.tick}${causesKo ? ":ko" : ""}`;
                    if (causesKo) canvas.dataset.riteBodyLethalLast = `${id}:${beat.role}@${beat.tick}`;
                }
            }
            // Local rails are painted after every body so the eight identities
            // remain readable when mirrored pets cross. Contact/result VFX and
            // the existing hero damage callout may still layer above them.
            let actorLocalHpBars = 0;
            let actorLocalHpPlayerRails = 0;
            let actorLocalHpEnemyRails = 0;
            let actorLocalHpMinWidth = Number.POSITIVE_INFINITY;
            let actorLocalHpMaxWidth = 0;
            let actorLocalHpMinHeight = Number.POSITIVE_INFINITY;
            const actorLocalHpAnchors: string[] = [];
            for (const [id, actorScreen] of renderedActors) {
                const rail = drawCanvasActorHealthRail(
                    context,
                    actorScreen.x,
                    actorScreen.footY,
                    actorScreen.baseSize,
                    actorScreen.healthFraction,
                    RITE_TEAM_COLOR[actorScreen.team],
                    actorScreen.visibility,
                    cssWidth,
                    cssHeight,
                );
                if (!rail) continue;
                actorLocalHpBars++;
                if (actorScreen.team === "player") actorLocalHpPlayerRails++;
                else actorLocalHpEnemyRails++;
                actorLocalHpMinWidth = Math.min(actorLocalHpMinWidth, rail.width);
                actorLocalHpMaxWidth = Math.max(actorLocalHpMaxWidth, rail.width);
                actorLocalHpMinHeight = Math.min(actorLocalHpMinHeight, rail.height);
                actorLocalHpAnchors.push(`${id},${rail.x.toFixed(1)},${rail.y.toFixed(1)},${rail.width.toFixed(1)},${rail.height.toFixed(1)}`);
                const firstAnchor = firstActorLocalHpAnchor.get(id);
                if (firstAnchor) {
                    if (Math.hypot(rail.x - firstAnchor.x, rail.y - firstAnchor.y) >= 1) actorLocalHpAnchorsMoved = true;
                } else {
                    firstActorLocalHpAnchor.set(id, { x: rail.x, y: rail.y });
                }
            }
            maxActorLocalHpBars = Math.max(maxActorLocalHpBars, actorLocalHpBars);
            // Contact/result paint after bodies: the target owns the brightest
            // edge while the directional tracer remains behind silhouettes.
            let heroHpDelta = 0;
            let heroTargetRecoil = 0;
            let heroLocalHpVisible = false;
            if (heroCue) {
                const before = sampleActorByIdInto(result, heroCue.targetId, Math.max(0, heroCue.contactTick - 1), heroHpBeforePose);
                const after = sampleActorByIdInto(result, heroCue.targetId, heroCue.contactTick, heroHpAfterPose);
                heroHpDelta = Math.max(0, before.hp - after.hp);
            }
            for (let cueIndex = 0; cueIndex < activeSpectacleCues.length; cueIndex++) {
                const cue = activeSpectacleCues[cueIndex];
                const phase = spectaclePhases[cueIndex];
                if (phase.contact <= 0 && phase.result <= 0) continue;
                const target = sampleActorByIdInto(result, cue.targetId, cue.contactTick, cueTarget);
                const [projectedTx, projectedTy] = project(target.x, target.z);
                const targetFighter = fighterByActorId.get(cue.targetId);
                const historicalFootY = targetFighter
                    ? riteCanvasLivingWaterFootAnchorY(targetFighter.pet.element, projectedTy, cssWidth, cssHeight, target.hp > 0 && target.state !== "dead", false)
                    : projectedTy;
                const targetScreen = renderedActors.get(cue.targetId);
                const tx = targetScreen?.x ?? projectedTx;
                const footY = targetScreen?.footY ?? historicalFootY;
                const isHero = cue === heroCue;
                const impactY = isHero ? footY - (targetScreen?.baseSize ?? 64) * 0.44 : footY - 12;
                const signature = warfrontElementSignature(cue.element);
                const radius = Math.max(15, Math.min(32, Math.min(cssWidth, cssHeight) * 0.04)) * (cue.lethal ? 1.18 : 1) * (isHero ? 1.18 : 1);
                if (isHero) {
                    const impactHold = warfrontHeroImpactHold(cue, tick);
                    const burstHold = warfrontHeroBurstHold(cue, tick);
                    const targetWidthPx = Math.max(1, (targetScreen?.baseSize ?? 64) * CANVAS_ACTOR_PAINTED_WIDTH_RATIO);
                    const contactWidthPx = warfrontHeroContactWidthPx(targetWidthPx);
                    const impactOrigin = sampleActorByIdInto(result, cue.actorId, cue.tellTick, cueOrigin);
                    const [impactOx, projectedImpactOy] = project(impactOrigin.x, impactOrigin.z);
                    const originFighter = fighterByActorId.get(cue.actorId);
                    const impactOy = originFighter
                        ? riteCanvasLivingWaterFootAnchorY(originFighter.pet.element, projectedImpactOy, cssWidth, cssHeight, impactOrigin.hp > 0 && impactOrigin.state !== "dead", false)
                        : projectedImpactOy;
                    const frozenTargetImpactY = historicalFootY - (targetScreen?.baseSize ?? 64) * 0.44;
                    const frozenAxisLength = Math.max(0.001, Math.hypot(projectedTx - impactOx, frozenTargetImpactY - (impactOy - 12)));
                    const frozenAxisX = (projectedTx - impactOx) / frozenAxisLength;
                    const frozenAxisY = (frozenTargetImpactY - (impactOy - 12)) / frozenAxisLength;
                    const incomingAngle = Math.atan2(frozenAxisY, frozenAxisX);
                    drawWarfrontHeroFireImpact(
                        context,
                        tx,
                        impactY,
                        contactWidthPx,
                        impactHold,
                        burstHold,
                        phase.result,
                        cueIndex + cue.contactTick * 0.019,
                        impactSpriteImage,
                        incomingAngle,
                    );
                    heroAxisTailStrength = warfrontHeroAxisTailStrength(impactHold, phase.result);
                    heroAxisTailVisible = heroAxisTailStrength > 0;
                    heroAxisTailAxis = `${frozenAxisX.toFixed(6)},${frozenAxisY.toFixed(6)}`;
                    heroContactTargetWidthPx = targetWidthPx;
                    heroContactSpanPx = contactWidthPx;
                    heroBurstHoldActive = burstHold > 0;
                    if (heroBurstHoldActive) heroBurstVisiblePx = contactWidthPx;
                    heroImpactHoldActive = impactHold > 0;
                    if (heroImpactHoldActive) heroImpactVisiblePx = contactWidthPx;
                    heroContactFrontActive = heroBurstHoldActive && heroImpactHoldActive;
                    heroImpactSpriteVisible = Math.max(impactHold, burstHold) > 0;
                    heroImpactSpriteRotationRad = incomingAngle;
                    heroImpactSpriteAxis = `${frozenAxisX.toFixed(6)},${frozenAxisY.toFixed(6)}`;
                    heroImpactSpriteFootprintPx = heroImpactSpriteVisible ? contactWidthPx : 0;
                    if (phase.result > 0) {
                        const residueAge = 1 - phase.result;
                        heroResidueVisible = true;
                        heroResidueSpanPx = contactWidthPx * (0.84 + residueAge * 0.1);
                        heroResidueMaterialStrength = phase.result * 0.82;
                    }
                    const hpStrength = phase.contact > 0 ? 1 : phase.result;
                    heroTargetRecoil = targetScreen?.recoil ?? 0;
                    heroLocalHpVisible = hpStrength > 0 && heroHpDelta > 0;
                    if (heroLocalHpVisible) {
                        drawWarfrontHeroHealthFeedback(
                            context,
                            tx,
                            footY - (targetScreen?.baseSize ?? 64) * 0.92,
                            heroHpBeforePose.hp,
                            heroHpAfterPose.hp,
                            heroHpAfterPose.maxHp,
                            RITE_TEAM_COLOR[targetFighter?.team ?? "enemy"],
                            hpStrength,
                        );
                    }
                } else {
                    drawWarfrontElementResult(
                        context,
                        signature,
                        tx,
                        impactY,
                        radius,
                        phase.contact,
                        phase.result,
                        particlesPerCue,
                        cueIndex + cue.contactTick * 0.019,
                    );
                }
            }
            if (broadcastFocusLabel) {
                context.save();
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.font = "800 10px system-ui, sans-serif";
                context.letterSpacing = "0.08em";
                let label = broadcastFocusLabel;
                while (label.length > 12 && context.measureText(label).width > cssWidth - 44) label = `${label.slice(0, -2)}…`;
                const labelWidth = Math.min(cssWidth - 24, context.measureText(label).width + 28);
                const labelY = topSafe + 17;
                context.fillStyle = "rgba(3, 9, 13, .88)";
                context.strokeStyle = focusCue ? RITE_TEAM_COLOR[focusCue.side] : "#d7e8ed";
                context.lineWidth = 1;
                context.beginPath();
                context.roundRect((cssWidth - labelWidth) * 0.5, labelY - 12, labelWidth, 24, 12);
                context.fill(); context.stroke();
                context.fillStyle = "#f4f8f8";
                context.shadowColor = "#000";
                context.shadowBlur = 3;
                context.fillText(label, cssWidth * 0.5, labelY + 0.5);
                if (broadcastImpactX || broadcastImpactY) {
                    const impactSize = Math.max(22, Math.min(38, cssWidth * 0.075));
                    context.translate(broadcastImpactX, broadcastImpactY);
                    context.globalCompositeOperation = "lighter";
                    context.strokeStyle = "rgba(255,255,255,.94)";
                    context.lineWidth = 3;
                    context.shadowColor = focusCue ? warfrontElementSignature(focusCue.element).primary : "#fff";
                    context.shadowBlur = 16;
                    context.beginPath();
                    context.moveTo(-impactSize, impactSize * 0.34); context.lineTo(impactSize, -impactSize * 0.34);
                    context.moveTo(-impactSize * 0.5, -impactSize * 0.75); context.lineTo(impactSize * 0.5, impactSize * 0.75);
                    context.stroke();
                }
                context.restore();
            }
            maxSpectacleParticles = Math.max(maxSpectacleParticles, particles);
            maxBodyActive = Math.max(maxBodyActive, bodyActive);
            maxGroundingActiveRings = Math.max(maxGroundingActiveRings, activeGroundingRings);
            canvas.dataset.riteGroundingPermanentPads = "0";
            canvas.dataset.riteGroundingWideAuras = "0";
            canvas.dataset.riteGroundingShadowMode = "feathered-ao";
            canvas.dataset.riteGroundingActiveRings = String(activeGroundingRings);
            canvas.dataset.riteGroundingMaxActiveRings = String(maxGroundingActiveRings);
            canvas.dataset.riteGroundingIdleActors = String(idleGroundingActors);
            canvas.dataset.riteGroundingDeadActors = String(deadGroundingActors);
            canvas.dataset.riteGroundingIdleRings = String(idleGroundingRings);
            canvas.dataset.riteGroundingDeadRings = String(deadGroundingRings);
            canvas.dataset.riteGroundingSubmittedAoCount = String(submittedAoCount);
            canvas.dataset.riteGroundingSubmittedAoMaxAlpha = submittedAoCount ? "0.420" : "0";
            canvas.dataset.riteGroundingSubmittedAoMaxRadiusPx = submittedAoMaxRadiusPx.toFixed(3);
            canvas.dataset.riteGroundingSubmittedAoMaxRadiusRatio = submittedAoMaxRadiusRatio.toFixed(3);
            canvas.dataset.riteGroundingSubmittedRimCount = String(submittedRimCount);
            canvas.dataset.riteGroundingSubmittedRimMaxAlpha = submittedRimCount ? "0.340" : "0";
            canvas.dataset.riteGroundingSubmittedRimMaxRadiusPx = submittedRimMaxRadiusPx.toFixed(3);
            canvas.dataset.riteGroundingSubmittedPlanarImpactCount = "0";
            canvas.dataset.riteGroundingAuthoritativeActor = authoritativeGroundingActorId ?? "";
            canvas.dataset.riteActorLocalHpBars = String(actorLocalHpBars);
            canvas.dataset.riteActorLocalHpBarsMax = String(maxActorLocalHpBars);
            canvas.dataset.riteActorLocalHpBarsExpected = String(fighters.length);
            canvas.dataset.riteActorLocalHpPlayerRails = String(actorLocalHpPlayerRails);
            canvas.dataset.riteActorLocalHpEnemyRails = String(actorLocalHpEnemyRails);
            canvas.dataset.riteActorLocalHpAnchorMode = "sampled-actor-screen-position";
            canvas.dataset.riteActorLocalHpAnchorsMoved = String(actorLocalHpAnchorsMoved);
            canvas.dataset.riteActorLocalHpAnchors = actorLocalHpAnchors.join(";");
            canvas.dataset.riteActorLocalHpMinWidthPx = Number.isFinite(actorLocalHpMinWidth) ? actorLocalHpMinWidth.toFixed(1) : "0";
            canvas.dataset.riteActorLocalHpMaxWidthPx = actorLocalHpMaxWidth.toFixed(1);
            canvas.dataset.riteActorLocalHpMinHeightPx = Number.isFinite(actorLocalHpMinHeight) ? actorLocalHpMinHeight.toFixed(1) : "0";
            canvas.dataset.riteActorLocalHpTeamColors = `player:${RITE_TEAM_COLOR.player},enemy:${RITE_TEAM_COLOR.enemy}`;
            canvas.dataset.riteArenaPrototypeDressingDraws = String(staticArenaMetrics.current.prototypeDressingDraws);
            canvas.dataset.riteArenaPrototypeDressingMeshes = "0";
            canvas.dataset.riteArenaGlyphDebrisDraws = "0";
            canvas.dataset.riteArenaGlyphDebrisMeshes = "0";
            canvas.dataset.riteArenaFloorDecalDraws = String(staticArenaMetrics.current.floorDecalDraws + objectiveFloorDecalDraws);
            canvas.dataset.riteArenaFloorDecalMaxAlpha = Math.max(staticArenaMetrics.current.floorDecalMaxAlpha, objectiveFloorDecalMaxAlpha).toFixed(3);
            canvas.dataset.riteArenaFloorDecalMaxRadiusPx = Math.max(staticArenaMetrics.current.floorDecalMaxRadiusPx, objectiveFloorDecalMaxRadiusPx).toFixed(3);
            let actorsPresent = 0;
            let actorsInSafeViewport = 0;
            let minLivingActorPx = Number.POSITIVE_INFINITY;
            const actorIsSafe = (actorScreen: (typeof renderedActors extends Map<string, infer V> ? V : never) | undefined) => Boolean(actorScreen
                && actorScreen.visibility > 0.001
                && actorScreen.x >= -actorScreen.baseSize * 0.25
                && actorScreen.x <= cssWidth + actorScreen.baseSize * 0.25
                && actorScreen.footY - actorScreen.baseSize >= topSafe
                && actorScreen.footY <= cssHeight - bottomSafe);
            for (const actorScreen of renderedActors.values()) {
                if (actorScreen.visibility > 0.001) {
                    actorsPresent++;
                    if (actorIsSafe(actorScreen)) actorsInSafeViewport++;
                    if (actorScreen.hp > 0) minLivingActorPx = Math.min(minLivingActorPx, actorScreen.baseSize);
                }
            }
            const heroActorPresent = Boolean(heroCue && (renderedActors.get(heroCue.actorId)?.visibility ?? 0) > 0.001);
            const heroTargetPresent = Boolean(heroCue && (renderedActors.get(heroCue.targetId)?.visibility ?? 0) > 0.001);
            canvas.dataset.riteActorsPresent = String(actorsPresent);
            canvas.dataset.riteActorsInSafeViewport = String(actorsInSafeViewport);
            canvas.dataset.riteMinLivingActorPx = Number.isFinite(minLivingActorPx) ? minLivingActorPx.toFixed(1) : "0";
            canvas.dataset.riteCameraMode = "actor-first-broadcast";
            canvas.dataset.riteCameraFocus = cameraState.focusId;
            canvas.dataset.riteCameraFocusActorSafe = String(Boolean(focusCue && actorIsSafe(renderedActors.get(focusCue.actorId))));
            canvas.dataset.riteCameraFocusTargetSafe = String(Boolean(focusCue && actorIsSafe(renderedActors.get(focusCue.targetId))));
            canvas.dataset.riteCameraFocusActorPx = focusCue ? (renderedActors.get(focusCue.actorId)?.baseSize ?? 0).toFixed(1) : "0";
            canvas.dataset.riteCameraFocusTargetPx = focusCue ? (renderedActors.get(focusCue.targetId)?.baseSize ?? 0).toFixed(1) : "0";
            canvas.dataset.riteBroadcastFocusLabel = broadcastFocusLabel;
            canvas.dataset.riteBroadcastImpactVisible = String(Boolean(broadcastImpactX || broadcastImpactY));
            canvas.dataset.riteBroadcastNonFocusOpacity = focusVisualStrength > 0.18 ? "0.46" : "1";
            canvas.dataset.riteCameraZoom = cameraState.zoom.toFixed(4);
            canvas.dataset.riteCameraMaxPanPerFrame = cameraState.maxPanPerFrame.toFixed(4);
            canvas.dataset.riteCameraMaxZoomPerFrame = cameraState.maxZoomPerFrame.toFixed(4);
            canvas.dataset.riteCameraTopSafePx = topSafe.toFixed(1);
            canvas.dataset.riteCameraMaxDelta = cameraState.maxPanPerFrame.toFixed(4);
            canvas.dataset.riteFacingPolicy = "live-target-screen-space-hysteresis";
            canvas.dataset.riteFacingNativeSign = "-1";
            canvas.dataset.riteFacingFlips = String(ordered.reduce((sum, actor) => sum + actor.facingFlips, 0));
            canvas.dataset.riteHeroActorPresent = String(heroActorPresent);
            canvas.dataset.riteHeroTargetPresent = String(heroTargetPresent);
            canvas.dataset.riteArenaFloorDecalMaxRadiusWorld = ARENA_OBJECTIVE_DECAL_RADIUS_WORLD.toFixed(3);
            canvas.dataset.riteArenaScrollPropDraws = String(scrollPropDraws);
            canvas.dataset.riteArenaScrollPropMeshes = "0";
            canvas.dataset.riteArenaActorLightMode = "position-aware-multiply-mask";
            canvas.dataset.riteArenaActorLightOverlays = String(submittedArenaLightOverlays);
            canvas.dataset.riteArenaActorLightMaxAlpha = submittedArenaLightMaxAlpha.toFixed(3);
            canvas.dataset.riteArenaActorLightMultiplyMaxAlpha = submittedArenaLightMultiplyMaxAlpha.toFixed(3);
            canvas.dataset.riteArenaActorLightMultiplyCap = "0.170";
            canvas.dataset.riteArenaActorLightEdgeRecoveryMaxAlpha = submittedArenaLightEdgeRecoveryMaxAlpha.toFixed(3);
            canvas.dataset.riteArenaSideLights = "0";
            if (groundingQaEnabled) canvas.dataset.riteGroundingFootprints = groundingFootprints;
            canvas.dataset.riteAttackCausalityActive = String(activeCues);
            canvas.dataset.riteAttackContactsActive = String(contacts);
            canvas.dataset.riteAttackCausalityMaxActive = String(maxActiveCues);
            canvas.dataset.riteAttackLongestDistance = longestDistance.toFixed(3);
            canvas.dataset.riteAttackLongestEndpoints = longestEndpoints;
            canvas.dataset.riteSpectacleGrammar = "elemental-v1";
            canvas.dataset.riteSpectacleOverlapCap = String(WARFRONT_SPECTACLE_OVERLAP_CAP);
            canvas.dataset.riteSpectacleTellActive = String(tells);
            canvas.dataset.riteSpectacleContactActive = String(contacts);
            canvas.dataset.riteSpectacleResultActive = String(results);
            canvas.dataset.riteSpectacleParticlesActive = String(particles);
            canvas.dataset.riteSpectacleParticlesMax = String(maxSpectacleParticles);
            canvas.dataset.riteSpectacleElementsSeen = [...spectacleElementsSeen].sort().join(",");
            canvas.dataset.riteHeroElement = heroCue ? "Fire" : "";
            canvas.dataset.riteHeroActor = heroCue?.actorId ?? "";
            canvas.dataset.riteHeroTarget = heroCue?.targetId ?? "";
            canvas.dataset.riteHeroTellTick = heroCue ? String(heroCue.tellTick) : "";
            canvas.dataset.riteHeroContactTick = heroCue ? String(heroCue.contactTick) : "";
            canvas.dataset.riteHeroStage = heroStageName;
            canvas.dataset.riteHeroVfxGrammar = heroCue ? WARFRONT_HERO_FIRE_VFX_GRAMMAR : "";
            canvas.dataset.riteHeroShape = heroCue ? warfrontHeroFireShape(heroStageName) : "";
            canvas.dataset.riteHeroOriginAnchor = heroOriginAnchor;
            canvas.dataset.riteHeroTargetAnchor = heroTargetAnchor;
            canvas.dataset.riteHeroCorridorLength = heroCorridorLength.toFixed(2);
            canvas.dataset.riteHeroHpDelta = heroHpDelta.toFixed(2);
            canvas.dataset.riteHeroLocalHpVisible = String(heroLocalHpVisible);
            canvas.dataset.riteHeroTargetRecoil = heroTargetRecoil.toFixed(3);
            canvas.dataset.riteHeroFlareMinPx = heroCue ? String(WARFRONT_HERO_FLARE_MIN_PX) : "0";
            canvas.dataset.riteHeroTravelCorePx = heroCue ? String(WARFRONT_HERO_TRAVEL_CORE_PX) : "0";
            canvas.dataset.riteHeroTravelPlumePx = heroCue ? String(WARFRONT_HERO_TRAVEL_PLUME_PX) : "0";
            canvas.dataset.riteHeroTravelMinSpanFraction = heroCue ? WARFRONT_HERO_TRAVEL_MIN_SPAN_FRACTION.toFixed(6) : "0";
            canvas.dataset.riteHeroTravelSpanFraction = heroTravelSpanFraction.toFixed(6);
            canvas.dataset.riteHeroTravelAxis = heroCue ? `${heroTravelAxisX.toFixed(6)},${heroTravelAxisY.toFixed(6)}` : "";
            canvas.dataset.riteHeroAxisTailPx = heroCue ? String(WARFRONT_HERO_AXIS_TAIL_PX) : "0";
            canvas.dataset.riteHeroAxisTailVisible = String(heroAxisTailVisible);
            canvas.dataset.riteHeroAxisTailStrength = heroAxisTailStrength.toFixed(3);
            canvas.dataset.riteHeroAxisTailAxis = heroAxisTailAxis;
            canvas.dataset.riteHeroBurstPx = heroCue ? String(WARFRONT_HERO_BURST_PX) : "0";
            canvas.dataset.riteHeroBurstHoldTicks = heroCue ? String(WARFRONT_HERO_BURST_HOLD_TICKS) : "0";
            canvas.dataset.riteHeroImpactMinPx = heroCue ? String(WARFRONT_HERO_IMPACT_MIN_PX) : "0";
            canvas.dataset.riteHeroImpactHoldTicks = heroCue ? String(WARFRONT_HERO_IMPACT_HOLD_TICKS) : "0";
            canvas.dataset.riteHeroFlareVisiblePx = heroFlareVisiblePx.toFixed(1);
            canvas.dataset.riteHeroTravelCoreVisiblePx = heroTravelCoreVisiblePx.toFixed(1);
            canvas.dataset.riteHeroTravelPlumeVisiblePx = heroTravelPlumeVisiblePx.toFixed(1);
            canvas.dataset.riteHeroBurstVisiblePx = heroBurstVisiblePx.toFixed(1);
            canvas.dataset.riteHeroBurstHoldActive = String(heroBurstHoldActive);
            canvas.dataset.riteHeroImpactVisiblePx = heroImpactVisiblePx.toFixed(1);
            canvas.dataset.riteHeroImpactHoldActive = String(heroImpactHoldActive);
            canvas.dataset.riteHeroContactRenderer = heroCue ? "canvas" : "";
            canvas.dataset.riteHeroContactLayer = heroCue ? "target-anchored-authored-sprite" : "";
            canvas.dataset.riteHeroContactLayerCount = heroCue ? String(WARFRONT_HERO_CONTACT_LAYER_COUNT) : "0";
            canvas.dataset.riteHeroContactLayers = heroCue ? WARFRONT_HERO_FIRE_CONTACT_LAYERS.join(",") : "";
            canvas.dataset.riteHeroContactTargetWidths = heroCue ? String(WARFRONT_HERO_CONTACT_TARGET_WIDTHS) : "0";
            canvas.dataset.riteHeroContactTargetWidthPx = heroContactTargetWidthPx.toFixed(1);
            canvas.dataset.riteHeroContactSpanPx = heroContactSpanPx.toFixed(1);
            canvas.dataset.riteHeroContactTargetWidthRatio = heroContactTargetWidthPx > 0
                ? (heroContactSpanPx / heroContactTargetWidthPx).toFixed(3)
                : "0";
            canvas.dataset.riteHeroContactFrontHoldTicks = heroCue ? String(WARFRONT_HERO_BURST_HOLD_TICKS) : "0";
            canvas.dataset.riteHeroContactFrontActive = String(heroContactFrontActive);
            canvas.dataset.riteHeroImpactSpriteUrl = heroCue ? WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL : "";
            canvas.dataset.riteHeroImpactSpriteLoaded = String(impactSpriteImage.complete
                && impactSpriteImage.naturalWidth === WARFRONT_HERO_FIRE_IMPACT_SPRITE_SOURCE_PX
                && impactSpriteImage.naturalHeight === WARFRONT_HERO_FIRE_IMPACT_SPRITE_SOURCE_PX);
            canvas.dataset.riteHeroImpactSpriteSourceWidth = String(impactSpriteImage.naturalWidth);
            canvas.dataset.riteHeroImpactSpriteSourceHeight = String(impactSpriteImage.naturalHeight);
            canvas.dataset.riteHeroImpactSpriteAnchor = `${WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X.toFixed(6)},${WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y.toFixed(6)}`;
            canvas.dataset.riteHeroImpactSpriteAsymmetry = WARFRONT_HERO_FIRE_IMPACT_SPRITE_ASYMMETRY;
            canvas.dataset.riteHeroImpactSpriteLeftRightReachRatio = WARFRONT_HERO_FIRE_IMPACT_SPRITE_LEFT_RIGHT_REACH_RATIO.toFixed(3);
            canvas.dataset.riteHeroImpactSpriteVisible = String(heroImpactSpriteVisible);
            canvas.dataset.riteHeroImpactSpriteDraws = heroImpactSpriteVisible ? "1" : "0";
            canvas.dataset.riteHeroImpactSpriteRotationRad = heroImpactSpriteRotationRad.toFixed(6);
            canvas.dataset.riteHeroImpactSpriteAxis = heroImpactSpriteAxis;
            canvas.dataset.riteHeroImpactSpriteFootprintPx = heroImpactSpriteFootprintPx.toFixed(1);
            canvas.dataset.riteHeroImpactSpriteTargetWidthRatio = heroContactTargetWidthPx > 0
                ? (heroImpactSpriteFootprintPx / heroContactTargetWidthPx).toFixed(3)
                : "0";
            canvas.dataset.riteHeroImpactSpritePrewarmed = "true";
            canvas.dataset.riteHeroImpactLegacyPrimitiveDraws = "0";
            canvas.dataset.riteHeroResidueTicks = heroCue ? String(WARFRONT_SPECTACLE_RESULT_TICKS) : "0";
            canvas.dataset.riteHeroResidueLayerCount = heroCue ? String(WARFRONT_HERO_RESIDUE_LAYER_COUNT) : "0";
            canvas.dataset.riteHeroResidueLayers = heroCue ? WARFRONT_HERO_FIRE_RESIDUE_LAYERS.join(",") : "";
            canvas.dataset.riteHeroResidueVisible = String(heroResidueVisible);
            canvas.dataset.riteHeroResidueSpanPx = heroResidueSpanPx.toFixed(1);
            canvas.dataset.riteHeroResidueMaterialStrength = heroResidueMaterialStrength.toFixed(3);
            canvas.dataset.riteBodyLungeActive = String(lunges);
            canvas.dataset.riteBodyLethalLungeActive = String(lethalLunges);
            canvas.dataset.riteBodyRecoilActive = String(recoils);
            canvas.dataset.riteBodyKoExitActive = String(koExits);
            canvas.dataset.riteBodyLungeSeen = String(lungeSeen);
            canvas.dataset.riteBodyRecoilSeen = String(recoilSeen);
            canvas.dataset.riteBodyKoExitSeen = String(koSeen);
            canvas.dataset.riteBodyReactionMaxActive = String(maxBodyActive);
            canvas.dataset.riteBodyReactionMaxOffset = maxBodyOffset.toFixed(3);

            context.restore();
            if (!performanceStarted && tick > 0 && typeof PerformanceObserver !== "undefined") {
                performanceStarted = true;
                const warmup = performance.now() + 4_000;
                const end = warmup + 8_000;
                sampleWindow = { warmup, end };
                let tasks = 0;
                let maxTask = 0;
                canvas.dataset.riteLongTaskSample = "warming";
                performanceObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) if (entry.startTime >= warmup && entry.startTime < end && entry.duration > 100) { tasks++; maxTask = Math.max(maxTask, entry.duration); }
                });
                performanceObserver.observe({ type: "longtask", buffered: false });
                performanceTimer = window.setTimeout(() => {
                    performanceObserver?.disconnect();
                    canvas.dataset.riteLongTaskSample = "complete";
                    canvas.dataset.riteLongTasksOver100ms = String(tasks);
                    canvas.dataset.riteLongTaskMaxMs = maxTask.toFixed(1);
                    canvas.dataset.riteFrameGapsOver100ms = String(gaps);
                    canvas.dataset.riteFrameGapMaxMs = maxGap.toFixed(1);
                }, 12_050);
            }
            if (lastFrameAt !== null && sampleWindow && now >= sampleWindow.warmup && now < sampleWindow.end) {
                const gap = now - lastFrameAt;
                maxGap = Math.max(maxGap, gap);
                if (gap > 100) gaps++;
            }
            lastFrameAt = now;
            frame = requestAnimationFrame(paint);
        };
        frame = requestAnimationFrame(paint);
        return () => {
            cancelAnimationFrame(frame);
            performanceObserver?.disconnect();
            if (performanceTimer !== null) window.clearTimeout(performanceTimer);
            const root = canvas.closest(".wfr-root") as HTMLElement | null;
            if (root) {
                delete root.dataset.wfrCanvasCamera;
                root.style.removeProperty("--wfr-camera-zoom");
                root.style.removeProperty("--wfr-camera-shift-x");
                root.style.removeProperty("--wfr-camera-shift-y");
            }
        };
    }, [clockRef, cues, fighterByActorId, heroCue, heroImpactSprite, images, quality, reducedMotion, result]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !images || !heroImpactSprite || readyReported.current) return;
        let first = 0;
        let second = 0;
        first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => {
                if (readyReported.current) return;
                readyReported.current = true;
                onLoadProgress?.(fighters.length);
                onReady?.();
            });
        });
        return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }, [fighters.length, heroImpactSprite, images, onLoadProgress, onReady]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const fractions = framingFractions(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
        canvas.dataset.riteRequestedQuality = quality.id;
        canvas.dataset.riteRenderBudget = fighters.length >= 8 ? "eight-rig" : "standard";
        canvas.dataset.riteTextureAnisotropy = "1";
        canvas.dataset.riteDpr = Math.min(1.15, window.devicePixelRatio || 1).toFixed(2);
        canvas.dataset.riteCapabilityTier = "constrained";
        canvas.dataset.riteRenderer = "Canvas2D exact-model impostors";
        canvas.dataset.riteSilhouette = "model-impostor";
        canvas.dataset.riteActorRenderMode = "model-impostor";
        canvas.dataset.riteImpostorActors = String(fighters.length);
        canvas.dataset.riteRuntimeRoute = "model-impostor";
        canvas.dataset.riteRuntimeRouteStatus = "locked";
        canvas.dataset.riteRuntimeRouteReason = "safe-default";
        canvas.dataset.riteRuntimeRoutePersisted = "false";
        canvas.dataset.riteRuntimeRouteQaCanary = "false";
        canvas.dataset.riteRuntimeRouteSwitches = "0";
        canvas.dataset.riteRuntimeRouteBeforeReveal = "true";
        canvas.dataset.riteRigChunkStatus = "not-requested";
        canvas.dataset.riteRigChunkRequested = "false";
        canvas.dataset.riteImpostorAssetsReady = String(Boolean(images));
        canvas.dataset.riteHeroImpactSpritePrewarmed = String(Boolean(heroImpactSprite));
        canvas.dataset.ritePetLodEnabled = "false";
        canvas.dataset.ritePetLodActors = "0";
        canvas.dataset.ritePetLodFallbacks = "0";
        canvas.dataset.ritePetSourceTriangles = "0";
        canvas.dataset.ritePetSelectedTriangles = "0";
        canvas.dataset.ritePreflightThresholdMs = String(WARFRONT_PREFLIGHT_THRESHOLD_MS);
        canvas.dataset.ritePreflightFrameGaps = "0";
        canvas.dataset.ritePreflightFrameGapMaxMs = "0";
        canvas.dataset.ritePreflightLongTasks = "0";
        canvas.dataset.ritePreflightLongTaskMaxMs = "0";
        canvas.dataset.riteRouteValidationFrameGaps = "0";
        canvas.dataset.riteRouteValidationFrameGapMaxMs = "0";
        canvas.dataset.riteRouteValidationLongTasks = "0";
        canvas.dataset.riteRouteValidationLongTaskMaxMs = "0";
        canvas.dataset.riteRenderCalls = "1";
        canvas.dataset.riteRenderTriangles = "0";
        canvas.dataset.riteRenderPrograms = "0";
        canvas.dataset.riteSceneMeshes = "1";
        canvas.dataset.riteSceneSkinnedMeshes = "0";
        canvas.dataset.riteVisibleMeshes = "1";
        canvas.dataset.riteVisibleTriangles = "0";
        canvas.dataset.riteCameraMaxDelta = "0";
        canvas.dataset.riteBoardVisible = "true";
        canvas.dataset.riteBoardMaxX = fractions.x.toFixed(4);
        canvas.dataset.riteBoardMaxY = fractions.y.toFixed(4);
        canvas.dataset.riteInitialActorsVisible = String(result.snapshots[0]?.actors.length ?? 0);
        canvas.dataset.riteInitialActorsExpected = String(fighters.length);
        canvas.dataset.riteAttackCues = String(cues.length);
        canvas.dataset.riteAttackStreakMs = String(ATTACK_STREAK_DURATION_MS);
        canvas.dataset.riteContactHoldFrames = "2";
        canvas.dataset.riteBodyReactionEvents = String([...beatsByActor.values()].reduce((sum, beats) => sum + beats.length, 0));
        canvas.dataset.riteBodyLethalEvents = String([...beatsByActor.values()].reduce((sum, beats) => sum + beats.filter((beat) => beat.lethal).length, 0));
        canvas.dataset.riteBodyRootMode = "presentation-child";
        canvas.dataset.riteBodyReactionMaxActive = "0";
        canvas.dataset.riteBodyReactionMaxOffset = "0";
        canvas.dataset.riteGroundingPermanentPads = "0";
        canvas.dataset.riteGroundingWideAuras = "0";
        canvas.dataset.riteGroundingShadowMode = "feathered-ao";
        canvas.dataset.riteGroundingActiveRings = "0";
        canvas.dataset.riteGroundingMaxActiveRings = "0";
        canvas.dataset.riteGroundingIdleActors = "0";
        canvas.dataset.riteGroundingDeadActors = "0";
        canvas.dataset.riteGroundingIdleRings = "0";
        canvas.dataset.riteGroundingDeadRings = "0";
        canvas.dataset.riteArenaPrototypeDressingDraws = "0";
        canvas.dataset.riteArenaPrototypeDressingMeshes = "0";
        canvas.dataset.riteArenaGlyphDebrisDraws = "0";
        canvas.dataset.riteArenaGlyphDebrisMeshes = "0";
        canvas.dataset.riteArenaFloorDecalDraws = "0";
        canvas.dataset.riteArenaFloorDecalMaxAlpha = "0";
        canvas.dataset.riteArenaFloorDecalMaxRadiusPx = "0";
        canvas.dataset.riteArenaFloorDecalMaxRadiusWorld = "0";
        canvas.dataset.riteArenaScrollPropDraws = "0";
        canvas.dataset.riteArenaScrollPropMeshes = "0";
        canvas.dataset.riteArenaActorLightMode = "position-aware-multiply-mask";
        canvas.dataset.riteArenaActorLightOverlays = "0";
        canvas.dataset.riteArenaActorLightMaxAlpha = "0";
        canvas.dataset.riteArenaActorLightMultiplyMaxAlpha = "0";
        canvas.dataset.riteArenaActorLightMultiplyCap = "0.170";
        canvas.dataset.riteArenaActorLightEdgeRecoveryMaxAlpha = "0";
        canvas.dataset.riteArenaSideLights = "0";
        canvas.dataset.riteLongTaskSample = "pending";
        canvas.dataset.riteLongTasksOver100ms = "0";
        canvas.dataset.riteLongTaskMaxMs = "0";
        canvas.dataset.riteFrameGapsOver100ms = "0";
        canvas.dataset.riteFrameGapMaxMs = "0";
        canvas.dataset.riteHydrationPhase = images && heroImpactSprite ? "1" : "0";
    }, [beatsByActor, cues.length, fighters.length, heroImpactSprite, images, quality.id, result.snapshots]);

    return (
        <div className="wfr-canvas">
            <canvas ref={canvasRef} className="wfr-canvas-surface" role="img" aria-label="Beastbound Warfront formation battle view" />
            <canvas ref={staticCanvasRef} className="wfr-canvas-static" aria-hidden="true" />
        </div>
    );
}

export function PetWarfrontRiteStage(props: PetWarfrontRiteStageProps) {
    const atlasComplete = useMemo(() => props.fighters.every((fighter) => impostorUrl(fighter.pet) !== null), [props.fighters]);
    const requestedRoute = useMemo(() => stageRoute(), []);
    const wantsWebGl = requestedRoute.useWebGl || !atlasComplete;
    const [module, setModule] = useState<WebGlStageModule | null>(null);
    const [failed, setFailed] = useState(false);
    const [canvasFailed, setCanvasFailed] = useState(false);
    const handleCanvasAssetFailure = useCallback(() => setCanvasFailed(true), []);
    const useWebGl = wantsWebGl || canvasFailed;
    useEffect(() => {
        if (!useWebGl || module || failed) return;
        let active = true;
        void import("./PetWarfrontRiteStage3D").then((loaded) => {
            if (active) setModule({ PetWarfrontRiteStage3D: loaded.PetWarfrontRiteStage3D, preloadRitePetModels: loaded.preloadRitePetModels });
        }).catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [failed, module, useWebGl]);
    if (!useWebGl || failed) return <Canvas2DStage {...props} onAssetFailure={handleCanvasAssetFailure} />;
    if (!module) {
        return <div className="wfr-canvas" data-rite-rig-chunk-status="loading" data-rite-rig-chunk-requested="true" aria-hidden="true" />;
    }
    const WebGlStage = module.PetWarfrontRiteStage3D;
    return <WebGlStage {...props} />;
}
