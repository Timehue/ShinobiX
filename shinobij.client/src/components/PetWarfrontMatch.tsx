/*
 * ── Hollow Warfront — the lane-war match renderer + shell ────────────────────
 * Plays a pet-warfront-sim match as a true-3D MOBA broadcast on the themed
 * battlefield: GLB pets on the walkmask floor, Guardian Totems + Ward Seals,
 * the Hollow Gate breach with its Gate Warden and hollow-spawn, four Lesser
 * Wardens, broadcast/team cameras, a tactical minimap, and the WAR COUNCIL
 * checkpoint (or silent auto-buy when a policy is set).
 *
 * The sim is chunked and interactive: the shell advances one 90 s round at a
 * time, pausing at each boundary for the player's powerup spending. With an
 * auto-buy policy the match is a pure function of (teams, seed, policies) — the
 * shape shared co-op replays will use. Rendering never feeds the sim.
 */
import {
    Component,
    Suspense,
    useEffect,
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ErrorInfo,
    type KeyboardEvent,
    type MutableRefObject,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, Sparkles, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Pet } from "../types/pet";
import type { ArenaRole, ArenaSlot } from "../lib/pet-arena-sim";
import {
    startWarfrontMatch, wfVerdictScore, WARFRONT_TPS, WF_CAMP_REWARDS, WF_DOCTRINES, WF_MAX_SECONDS, WF_PHASE_SKIRMISH, WF_PHASE_SUDDEN, WF_PHASE_WAR, WF_POWERUPS, WF_STANCES,
    type WarfrontChoice, type WarfrontRoundChoice, type WarfrontRoundDecision, type WarfrontResult,
    type WfBuildPackage, type WfBuyPolicy, type WfCoachOrder, type WfCounterstrike,
    type WfDoctrine, type WfEvent, type WfObjectiveTechnique, type WfOpeningDeployment,
    type WfSnapshot, type WfStance,
} from "../lib/pet-warfront-sim";
import {
    WF_MASK, WF_COLS, WF_ROWS, WF_X, WF_Y, WF_BUSHES, WF_CELL_X, WF_CELL_Y, WF_LAIR, WF_LANES, WF_MINI_NAMES, WF_PADS, WF_SPAWNS, WF_THEMES,
    wfCellWalkable, wfInsideField,
    type WfTheme,
} from "../lib/pet-warfront-map";
import { councilCartCost, councilPackageChoices, visiblePackageActivationLabel, type WfCouncilBuyState } from "../lib/pet-warfront-council";
import {
    firstViableWarfrontChoice,
    hasWarfrontRole,
    WARFRONT_PACKAGE_ROLE,
    WARFRONT_ROLE_LABEL,
    WARFRONT_TECHNIQUE_ROLE,
} from "../lib/warfront-council-roles";
import { walkTilesFromMask, arenaCameraDist, arenaModelHeight, arenaModelMotion, A3D_FOV } from "../lib/pet-arena-3d";
import { radialTexture3d, TransientFx3DLayer, type TransientFx3DLayerApi } from "./PetArena3DStage";
import { petCombatModel, type PetCombatModelConfig } from "../lib/pet-3d-models";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import {
    PET_VISUAL_QUALITY_PRESETS,
    petVisualQuality,
    savePetVisualQuality,
    type PetVisualQuality,
} from "../lib/pet-visual-quality";
import { projectileVisual } from "../lib/pet-projectile-vfx";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { preloadTransientFxTextures } from "../lib/transient-fx-textures";
import { elementVfxKey } from "../lib/pet-battle-anim";
import { lerp } from "../lib/pet-coliseum-scene";
import { HOLLOW_HOUND_SURFACE, WARFRONT_MINION_SURFACES } from "../lib/pet-model-surface";
import { petModelVariantSurface } from "../lib/pet-visual-variant";
import { isPetSfxMuted, playPetSfx, primePetSfx, setPetSfxMuted } from "../lib/pet-sfx";
import { setAudioMuted, subscribeAudioMute } from "../lib/pet-music";
import {
    playWarfrontEventAudio,
    primeWarfrontAudio,
    seekWarfrontAudio,
    startWarfrontAudioBed,
    stopWarfrontAudioBed,
} from "../lib/warfront-audio";
import {
    advanceWarfrontMotionFilter,
    adaptWarfrontPresentationBudget,
    createWarfrontMotionFilter,
    reconcileWarfrontMobSlots,
    shouldRenderWarfrontHoundRig,
    warfrontEventCursorThroughTick,
    warfrontEventSalience,
    warfrontHitStopSeconds,
    warfrontJudgmentState,
    warfrontLatestTickAtOrBefore,
    warfrontMotionFilterSpeed,
    warfrontMvpId,
    warfrontPaceForMotion,
    warfrontPipHealthColor,
    warfrontPresentationBudget,
    warfrontSmartPaceIsQuiet,
    warfrontSealBreakPresentation,
    warfrontSnapshotAtTick,
    warfrontSnapshotBoundsAtTick,
    warfrontSnapshotFrontier,
    warfrontTurningPoints,
    warfrontWardSealInstruction,
    type WarfrontAdaptivePressure,
    type WarfrontMotionFilterState,
    type WarfrontPaceMode,
    type WarfrontPresentationBudget,
} from "../lib/pet-warfront-presentation";

const GROUND_TEX_URL = new URL("../assets/warfront/warfront-ground.png", import.meta.url).href;
let _groundTex: THREE.Texture | null = null;
function groundTexture(): THREE.Texture {
    if (_groundTex) return _groundTex;
    const t = new THREE.TextureLoader().load(GROUND_TEX_URL);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    _groundTex = t;
    return t;
}
const GATE_WARDEN_GLB = "/pet-models/gate-warden-rigged.glb?v=20260729-rig-v2";
const WARFRONT_COMMON_FX = ["none", "spark", "power", "heal", "shadow", "fire", "water", "wind", "lightning", "earth"]
    .map((key) => bundledJutsuFxFrames(key))
    .filter((frames): frames is string[] => frames !== null);
// Hand-painted foliage atlas (fal flux → birefnet cutouts): 2×2 tiles —
// 0 ancient pine · 1 tall autumn pine · 2 jade spirit tree · 3 broadleaf.
const FOLIAGE_URL = new URL("../assets/warfront/foliage-atlas.png", import.meta.url).href;
let _foliageTex: THREE.Texture | null = null;
function foliageTexture(): THREE.Texture {
    if (_foliageTex) return _foliageTex;
    const t = new THREE.TextureLoader().load(FOLIAGE_URL);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    _foliageTex = t;
    return t;
}
/** Crossed-plane "tree card" geometry (two quads at 90°, bottom-anchored),
 * UV-mapped to one tile of the foliage atlas. The industry-standard stylized
 * forest — and cheaper to draw than the old cone stacks. */
function treeCardGeometry(tile: number): THREE.BufferGeometry {
    const u0 = (tile % 2) * 0.5, v0 = tile < 2 ? 0.5 : 0;
    const geos: THREE.BufferGeometry[] = [];
    for (const rot of [0, Math.PI / 2]) {
        const g = new THREE.PlaneGeometry(1, 1);
        g.translate(0, 0.5, 0);
        g.rotateY(rot);
        const uv = g.getAttribute("uv") as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5);
        geos.push(g);
    }
    // Tiny manual merge (avoids pulling BufferGeometryUtils for two quads).
    const merged = new THREE.BufferGeometry();
    const pos: number[] = [], norm: number[] = [], uvs: number[] = [], idx: number[] = [];
    let base = 0;
    for (const g of geos) {
        const p = g.getAttribute("position"), n = g.getAttribute("normal"), u = g.getAttribute("uv");
        for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); norm.push(n.getX(i), n.getY(i), n.getZ(i)); uvs.push(u.getX(i), u.getY(i)); }
        const ix = g.getIndex()!;
        for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
        base += p.count;
        g.dispose();
    }
    merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    merged.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
    merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    merged.setIndex(idx);
    return merged;
}
const CLIFF_TEX_URL = new URL("../assets/warfront/warfront-cliff.png", import.meta.url).href;   // codex-painted mossy granite
let _cliffTex: THREE.Texture | null = null;
function cliffTexture(): THREE.Texture {
    if (_cliffTex) return _cliffTex;
    const t = new THREE.TextureLoader().load(CLIFF_TEX_URL);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    _cliffTex = t;
    return t;
}

type Team = "blue" | "red";
// slow = seconds of remaining hit-stop (playback runs at quarter speed while
// it drains — pure presentation, the sim ticks underneath are untouched).
type WfClockState = { t: number; playing: boolean; slow: number; rate: number };
type WfClockRef = MutableRefObject<WfClockState>;
type WfDirectorSeek = { generation: number; tick: number };
// A director-ordered camera target: the broadcast cuts here until match-tick
// untilT (priority arbitrates simultaneous stories; kills < objectives).
type WfStoryCam = {
    x: number;
    z: number;
    fromT: number;
    untilT: number;
    span: number;
    prio: number;
    subject?: { kind: "mini"; padIdx: number; team: Team; startDowns: number };
};
// Spectator camera modes: broadcast = the auto-director with story cuts;
// calm = wide and steady, only the big objective cuts; team = locked to the
// player's squad. Dragging always enters free-cam on top of any of them.
type WfCamMode = "broadcast" | "calm" | "team";
type WfUiScale = "standard" | "large";

const WF_PHASES = [
    { id: "opening", label: "LANING", starts: 0, ends: WF_PHASE_SKIRMISH, color: "#93c5fd" },
    { id: "skirmish", label: "SKIRMISH", starts: WF_PHASE_SKIRMISH, ends: WF_PHASE_WAR, color: "#fbbf24" },
    { id: "war", label: "WAR", starts: WF_PHASE_WAR, ends: WF_PHASE_SUDDEN, color: "#c084fc" },
    { id: "collapse", label: "HOLLOW COLLAPSE", starts: WF_PHASE_SUDDEN, ends: WF_MAX_SECONDS, color: "#fb7185" },
] as const;
const phaseAtSeconds = (seconds: number) =>
    WF_PHASES.find((phase) => seconds >= phase.starts && seconds < phase.ends) ?? WF_PHASES[WF_PHASES.length - 1];
const mmss = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, Math.floor(seconds)) % 60).padStart(2, "0")}`;
function objectiveEventLabel(event: WarfrontResult["events"][number]): string | null {
    if (event.type === "coredown") return warfrontSealBreakPresentation(event).label;
    const team = "team" in event ? event.team : "by" in event ? event.by : null;
    const who = team ? team === "blue" ? "Blue" : "Red" : "";
    if (event.type === "opening") return event.winner ? `${event.winner === "blue" ? "Blue" : "Red"} won the opening counter` : "Even opening";
    if (event.type === "readreserve") return `${who} converted the opening read into +${event.coins} reserve`;
    if (event.type === "shutdown") return `Shutdown bounty +${event.bounty}`;
    if (event.type === "mercy") return `${who} triggered Mercy acceleration`;
    if (event.type === "phase") return event.name;
    if (event.type === "verdict") return event.winner === "draw" ? "Judgment ended level" : `${event.winner === "blue" ? "Blue" : "Red"} won the Judgment`;
    if (event.type === "minikill") return `${who} ${event.stolen ? "stole" : "recruited"} ${WF_MINI_NAMES[event.padIdx]}${event.reward ? ` · ${WF_CAMP_REWARDS[event.reward].label}` : ""}`;
    if (event.type === "sigilawake") return `${WF_MINI_NAMES[event.padIdx]} awakened`;
    if (event.type === "sigilpip") return `${who} claimed Sigil ${event.count}`;
    if (event.type === "ascendance") return `${who} reached Ascendance`;
    if (event.type === "minimarch") return `${WF_MINI_NAMES[event.padIdx]} marched for ${who}`;
    if (event.type === "siegeescort") return `${who} ${event.escorted ? "linked" : "lost"} escort`;
    if (event.type === "siegebreak") return `${who} broke the siege`;
    if (event.type === "wardenphase") return `Warden Phase ${event.phase}`;
    if (event.type === "wardenkill") return `${who} ${event.stolen ? "stole" : "felled"} the Warden`;
    if (event.type === "statuedown" || event.type === "guardiandown") return `${who} lost a ${event.type === "statuedown" ? "Totem" : "Sentinel"}`;
    if (event.type === "coreexposed") return `${who} Seal exposed`;
    if (event.type === "techniqueused") return `${who} fired ${objectiveTechniqueSpec(event.choice)?.label ?? event.choice}`;
    if (event.type === "counterstrike") return `${who} triggered ${counterstrikeSpec(event.choice)?.label ?? event.choice}`;
    if (event.type === "counterstrikeclaim") return `${who} claimed a +${event.bounty} comeback bounty`;
    return null;
}
function objectiveEventColor(event: WarfrontResult["events"][number]): string {
    if (event.type === "coredown") return warfrontSealBreakPresentation(event).color;
    if (event.type === "sigilawake" || event.type === "shutdown" || ("stolen" in event && event.stolen)) return "#fde047";
    const team = (event.type === "opening" ? event.winner : event.type === "verdict" && event.winner !== "draw" ? event.winner : "team" in event ? event.team : "by" in event ? event.by : null) as Team | null;
    return team ? TEAM_SOFT[team] : "#a78bfa";
}

const TEAM_COLOR: Record<Team, string> = { blue: "#3b82f6", red: "#ef4444" };
const TEAM_SOFT: Record<Team, string> = { blue: "#93c5fd", red: "#fca5a5" };
const WF_DEFAULT_DEPLOYMENT: WfOpeningDeployment = ["top", "mid", "bottom", "flex"];
const WF_DEPLOYMENT_LABEL: Record<WfOpeningDeployment[number], string> = { top: "TOP", mid: "MID", bottom: "BOT", flex: "FLEX" };
const WF_CAMERA_PITCH = 1.04;
const ROLE_TAG: Record<string, string> = { defender: "DEF", tracker: "TRK", assassin: "ASN", sage: "SGE" };
const ELEMENT_TINT: Record<string, string> = { fire: "#fb923c", water: "#38bdf8", wind: "#86efac", lightning: "#fde047", earth: "#d3a05f" };
const tintOf = (el?: string | null) => ELEMENT_TINT[String(el ?? "").toLowerCase()] ?? "#a5f3fc";
const intentLabel = (intent: string) => {
    if (intent === "recall") return "RECALL · HEALING";
    if (intent === "respawn") return "";
    const [lane, goal = lane] = intent.split(":");
    const laneLabel = lane === "n" ? "TOP" : lane === "m" ? "MID" : lane === "s" ? "BOT" : "SQUAD";
    if (goal === "warden") return "SQUAD · GATE WARDEN";
    if (goal.startsWith("mini-")) return `${laneLabel} · CAMP`;
    if (goal.startsWith("defend")) return `${laneLabel} · DEFEND`;
    if (goal.startsWith("push")) return `${laneLabel} · PUSH`;
    return `${laneLabel} · CLEAR`;
};

const doctrineSpec = (doctrine: WfDoctrine) => WF_DOCTRINES.find((item) => item.id === doctrine)
    ?? { id: "none" as const, icon: "◇", label: "No Doctrine", desc: "No opening doctrine" };

function broadcastIntent(snap: WfSnapshot, team: Team): string {
    const convoy = snap.minis.find((mini) => mini.alive && mini.ally === team && mini.siegeDowns === 0);
    if (convoy?.escorted) return "ESCORT";
    if (snap.structures[team].core.exposed) return "DEFEND";
    const intents = snap.actors.filter((actor) => actor.team === team && actor.state !== "respawning").map((actor) => actor.intent);
    const atScheduledCamp = snap.sigil.state !== "idle" && intents.some((intent) => intent.includes(`mini-${snap.sigil.padIdx}`));
    if (atScheduledCamp || (snap.warden.active && intents.some((intent) => intent.endsWith(":warden")))) return "CONTEST";
    if (intents.some((intent) => intent.includes(":defend"))) return "DEFEND";
    if ((snap.sigil.state !== "idle" || snap.warden.active) && intents.some((intent) => intent.includes(":push"))) return "TRADE";
    if (intents.some((intent) => intent.includes(":push"))) return "PUSH";
    if (intents.some((intent) => intent.includes("mini-"))) return "HUNT";
    return "FARM";
}

function broadcastStakes(snap: WfSnapshot): string {
    if (snap.opening.active && snap.opening.winner) return `OPENING COUNTER · ${snap.opening.winner.toUpperCase()} +${snap.opening.attackPct}% ATK · +${snap.opening.speedPct}% SPEED · ${Math.ceil(snap.opening.secs)}s`;
    const pointTeam = (["blue", "red"] as const).find((team) => snap.sigilPips[team] === 2 && !snap.ascendant);
    if (pointTeam && snap.sigil.state !== "idle") return `ASCENDANCE POINT · ${pointTeam.toUpperCase()}`;
    const convoy = snap.minis.find((mini) => mini.alive && mini.ally && mini.siegeDowns === 0);
    if (convoy?.ally) return `${convoy.ally.toUpperCase()} CONVOY · ${convoy.escorted ? "FULL SIEGE" : "ESCORT NEEDED"}`;
    if (snap.structures.blue.core.exposed || snap.structures.red.core.exposed) return "WARD SEAL AT RISK · NEXT BREAK ENDS IT";
    if (snap.sigil.state === "awake") return "DOUBLE BOUNTY · SIGIL IN PLAY";
    if (snap.warden.active && snap.warden.alive) return "GATE'S WRATH · LAST HIT CLAIMS IT";
    if (!snap.warden.active && snap.t / WARFRONT_TPS >= WF_PHASE_WAR - 20) return "GATE WARDEN AWAKENS AT WAR";
    return "BREAK SENTINELS · OPEN THE WARD SEAL";
}

let wfSeq = 0;   // cosmetic FX keys — module-scoped so spawn closures stay ref-free

// Presentation events predate explicit IDs in the deterministic sim. Give
// them a stable normalization key once they reach the renderer: event time and
// type describe the domain event, while the occurrence ordinal only disambiguates
// multiple same-tick events. This is never generated during render and remains
// stable through replay, restart, and reseed of the same result.
function warfrontEventKey(event: WarfrontResult["events"][number], occurrence: number): string {
    const explicit = (event as { id?: unknown }).id;
    if (typeof explicit === "string" && explicit) return explicit;
    return `wf-event-${event.t}-${event.type}-${occurrence}`;
}

const WARDEN_URLS = {
    idle: new URL("../assets/coliseum/warden-idle.webp", import.meta.url).href,
    walk: new URL("../assets/coliseum/warden-walk.webp", import.meta.url).href,
    windup: new URL("../assets/coliseum/warden-windup.webp", import.meta.url).href,
    slam: new URL("../assets/coliseum/warden-slam.webp", import.meta.url).href,
} as const;
type WardenFrameKey = keyof typeof WARDEN_URLS;
const _wardenTex: Partial<Record<WardenFrameKey, THREE.Texture>> = {};
function wardenTex(f: WardenFrameKey): THREE.Texture {
    const hit = _wardenTex[f]; if (hit) return hit;
    const t = new THREE.TextureLoader().load(WARDEN_URLS[f]);
    t.colorSpace = THREE.SRGBColorSpace;
    _wardenTex[f] = t;
    return t;
}

const snapAt = (result: WarfrontResult, clock: WfClockRef): WfSnapshot => {
    const snaps = result.snapshots;
    const tick = Number.isFinite(clock.current.t) ? clock.current.t : 0;
    return warfrontSnapshotAtTick(snaps, Math.floor(tick)) ?? snaps.at(0)!;
};

// The sim stays at 30 TPS while the replay stores sparse presentation keyframes.
// Discrete state resolves to the last known keyframe; positions blend by each
// keyframe's real simulation tick for smooth 60/144 Hz display motion.
interface WfLerpFrame { s0: WfSnapshot; s1: WfSnapshot; f: number }
const lerpFrameAt = (result: WarfrontResult, clock: WfClockRef): WfLerpFrame => {
    const snaps = result.snapshots;
    const tick = Number.isFinite(clock.current.t) ? clock.current.t : 0;
    const bounds = warfrontSnapshotBoundsAtTick(snaps, tick);
    const fallback = snaps.at(0)!;
    return bounds
        ? { s0: bounds.lower, s1: bounds.upper, f: bounds.alpha }
        : { s0: fallback, s1: fallback, f: 0 };
};

type WfMobSnap = WfSnapshot["mobs"][number];
type WfActorSnap = WfSnapshot["actors"][number];
type WfSnapshotIndex = {
    actorsById: Map<string, WfActorSnap>;
    mobsById: Map<number, WfMobSnap>;
    hollowMobs: WfMobSnap[];
    laneMobs: WfMobSnap[];
};
const wfSnapshotIndexes = new WeakMap<WfSnapshot, WfSnapshotIndex>();
type WfPetStrikeIndex = { scanned: number; byActor: Map<string, number[]> };
const wfPetStrikeIndexes = new WeakMap<WarfrontResult, WfPetStrikeIndex>();

function wfPetStrikeTicks(result: WarfrontResult, actorId: string): readonly number[] {
    let index = wfPetStrikeIndexes.get(result);
    if (!index) {
        index = { scanned: 0, byActor: new Map() };
        wfPetStrikeIndexes.set(result, index);
    }
    for (let i = index.scanned; i < result.events.length; i++) {
        const event = result.events[i];
        if (event.type !== "petstrike") continue;
        const ticks = index.byActor.get(event.actorId) ?? [];
        ticks.push(event.t);
        index.byActor.set(event.actorId, ticks);
    }
    index.scanned = result.events.length;
    return index.byActor.get(actorId) ?? [];
}
type WfMobSlotBindings = {
    snapshot: WfSnapshot | null;
    hollow: Array<number | null>;
    lane: Array<number | null>;
};

/** Build each keyframe lookup once, then share it across every rendered actor.
 * This replaces thirty separate filter/find passes on every display frame. */
function wfSnapshotIndex(snapshot: WfSnapshot): WfSnapshotIndex {
    const cached = wfSnapshotIndexes.get(snapshot);
    if (cached) return cached;
    const actorsById = new Map<string, WfActorSnap>();
    for (const actor of snapshot.actors) actorsById.set(actor.id, actor);
    const mobsById = new Map<number, WfMobSnap>();
    const hollowMobs: WfMobSnap[] = [];
    const laneMobs: WfMobSnap[] = [];
    for (const mob of snapshot.mobs) {
        mobsById.set(mob.id, mob);
        if (mob.side === "hollow") hollowMobs.push(mob);
        else laneMobs.push(mob);
    }
    const index = { actorsById, mobsById, hollowMobs, laneMobs };
    wfSnapshotIndexes.set(snapshot, index);
    return index;
}

function reconcileWfMobBindings(bindings: WfMobSlotBindings, snapshot: WfSnapshot): void {
    if (bindings.snapshot === snapshot) return;
    const index = wfSnapshotIndex(snapshot);
    bindings.hollow = reconcileWarfrontMobSlots(
        bindings.hollow,
        index.hollowMobs.map((mob) => mob.id),
        HOLLOW_POOL,
    );
    bindings.lane = reconcileWarfrontMobSlots(
        bindings.lane,
        index.laneMobs.map((mob) => mob.id),
        MINION_POOL,
    );
    bindings.snapshot = snapshot;
}

// Frame-rate-INDEPENDENT exponential smoothing. `base` is the per-frame lerp
// factor authored against 60fps; this rescales it by the real frame time so the
// SAME visual damping holds at 30/60/144Hz. A fixed `x += (t-x)*k` slide-lags on
// a frame-dropping phone and snaps tight on a 144Hz monitor — this doesn't. The
// exponent is capped so a giant delta (tab refocus) can't overshoot.
const approach = (cur: number, target: number, base: number, delta: number): number =>
    cur + (target - cur) * (1 - Math.pow(1 - base, Math.min(4, delta * 60)));

const approachAngle = (cur: number, target: number, base: number, delta: number): number => {
    let diff = (target - cur + Math.PI) % (Math.PI * 2) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return cur + diff * (1 - Math.pow(1 - base, Math.min(4, delta * 60)));
};

const wfClockTick = (clock: WfClockRef): number =>
    Number.isFinite(clock.current.t) ? clock.current.t : 0;

const wfClockSeconds = (clock: WfClockRef): number =>
    wfClockTick(clock) / WARFRONT_TPS;

// ── Floor + set dressing ─────────────────────────────────────────────────────
function WfHollowGate({ glow, reducedMotion }: { glow: string; reducedMotion: boolean }) {
    const outer = useRef<THREE.Mesh>(null);
    const inner = useRef<THREE.Mesh>(null);
    const outerMat = useRef<THREE.MeshBasicMaterial>(null);
    const innerMat = useRef<THREE.MeshBasicMaterial>(null);
    useFrame((state) => {
        const now = reducedMotion ? 0 : state.clock.elapsedTime;
        if (outer.current) outer.current.rotation.z = now * 0.16;
        if (inner.current) inner.current.rotation.z = -now * 0.24;
        if (outerMat.current) outerMat.current.opacity = reducedMotion ? 0.42 : 0.42 + Math.sin(now * 1.8) * 0.12;
        if (innerMat.current) innerMat.current.opacity = reducedMotion ? 0.28 : 0.28 + Math.sin(now * 2.5 + 1.2) * 0.1;
    });
    return (
        <group position={[WF_LAIR.x, 0, WF_LAIR.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]}>
                <circleGeometry args={[2.35, 48]} />
                <meshBasicMaterial map={radialTexture3d()} color="#10041f" transparent opacity={0.98} depthWrite={false} />
            </mesh>
            <mesh ref={outer} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.032, 0]}>
                <ringGeometry args={[2.38, 3.02, 64, 1, 0.18, Math.PI * 1.82]} />
                <meshBasicMaterial ref={outerMat} color={glow} transparent opacity={0.52} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            <mesh ref={inner} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.038, 0]}>
                <ringGeometry args={[1.55, 2.16, 48, 1, 0.28, Math.PI * 1.68]} />
                <meshBasicMaterial ref={innerMat} color="#d8b4fe" transparent opacity={0.34} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            {Array.from({ length: 8 }, (_, i) => {
                const a = (i / 8) * Math.PI * 2;
                return (
                    <mesh key={i} rotation={[-Math.PI / 2, 0, a]} position={[Math.cos(a) * 2.7, 0.045, Math.sin(a) * 2.7]}>
                        <planeGeometry args={[0.24, 0.5]} />
                        <meshBasicMaterial color={glow} transparent opacity={0.72} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
                    </mesh>
                );
            })}
            {!reducedMotion && <Sparkles count={26} scale={[3.4, 2.6, 3.4]} position={[0, 1.2, 0]} size={2.4} speed={0.35} opacity={0.5} color={glow} noise={2} />}
        </group>
    );
}

function WfFloor({ theme, reducedMotion }: { theme: WfTheme; reducedMotion: boolean }) {
    const spec = WF_THEMES[theme];
    const tiles = useMemo(() => walkTilesFromMask(WF_MASK, WF_COLS, WF_ROWS, WF_X, WF_Y), []);
    const laneGuides = useMemo(() => (Object.entries(WF_LANES) as Array<
        [keyof typeof WF_LANES, typeof WF_LANES[keyof typeof WF_LANES]]
    >).map(([lane, points]) => new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, 0.055, z))),
        new THREE.LineBasicMaterial({
            color: lane === "m" ? "#a78bfa" : "#94a3b8",
            transparent: true,
            opacity: lane === "m" ? 0.24 : 0.17,
            depthWrite: false,
        }),
    )), []);
    useEffect(() => () => {
        for (const line of laneGuides) {
            line.geometry.dispose();
            line.material.dispose();
        }
    }, [laneGuides]);
    const instMesh = useMemo(() => {
        const geo = new THREE.BoxGeometry((WF_X * 2 / WF_COLS) * 0.995, 0.22, (WF_Y * 2 / WF_ROWS) * 0.99);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.04, map: groundTexture() });
        // Sample the painted flagstones by WORLD position — one continuous
        // hand-painted ground across all instanced tiles instead of a repeat
        // per 0.4-unit box face.
        mat.onBeforeCompile = (s) => {
            s.vertexShader = s.vertexShader
                .replace("#include <common>", "#include <common>\nvarying vec3 vWfWorld;")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\n{ vec4 wfw = instanceMatrix * vec4(position, 1.0); vWfWorld = (modelMatrix * wfw).xyz; }");
            s.fragmentShader = s.fragmentShader
                .replace("#include <common>", "#include <common>\nvarying vec3 vWfWorld;")
                .replace("#include <map_fragment>", "{ vec2 wfUv = vec2((vWfWorld.x + 44.0) / 88.0, 1.0 - (vWfWorld.z + 24.0) / 48.0); vec4 sampledDiffuseColor = texture2D( map, wfUv ); diffuseColor *= sampledDiffuseColor; }");
        };
        const m = new THREE.InstancedMesh(geo, mat, tiles.length);
        const mat4 = new THREE.Matrix4();
        const col = new THREE.Color();
        tiles.forEach((t, i) => {
            mat4.makeTranslation(t.x, -0.11 - (t.edge ? 0.02 : 0), t.z);
            m.setMatrixAt(i, mat4);
            col.setHSL(spec.tileHue, 0.05, 0.66 + t.shade * 0.3);   // near-neutral: the painted map is authoritative
            m.setColorAt(i, col);
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.receiveShadow = true;
        return m;
    }, [tiles, spec]);
    // Cliff skirts: edge tiles extrude downward so the paths read as real ledges
    // floating over the chasm instead of paper-thin planks.
    const skirtMesh = useMemo(() => {
        const edges = tiles.filter((t) => t.edge);
        const geo = new THREE.BoxGeometry((WF_X * 2 / WF_COLS) * 0.998, 1.7, (WF_Y * 2 / WF_ROWS) * 0.995);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.98, metalness: 0.02 });
        const m = new THREE.InstancedMesh(geo, mat, edges.length);
        const mat4 = new THREE.Matrix4();
        const col = new THREE.Color();
        edges.forEach((t, i) => {
            mat4.makeTranslation(t.x, -1.06, t.z);
            m.setMatrixAt(i, mat4);
            col.setHSL(spec.tileHue, spec.tileSat * 0.8, Math.max(0.02, (spec.tileLight - 0.06) * 0.55 + t.shade * 0.1));
            m.setColorAt(i, col);
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        return m;
    }, [tiles, spec]);
    useEffect(() => () => {
        instMesh.geometry.dispose();
        (instMesh.material as THREE.Material).dispose();
        instMesh.dispose();
        skirtMesh.geometry.dispose();
        (skirtMesh.material as THREE.Material).dispose();
        skirtMesh.dispose();
    }, [instMesh, skirtMesh]);
    const wallMesh = useMemo(() => {
        const cells: Array<{ x: number; z: number; h: number; shade: number }> = [];
        for (let r = 0; r < WF_ROWS; r++) {
            for (let c = 0; c < WF_COLS; c++) {
                const x = (c + 0.5) * (WF_X * 2 / WF_COLS) - WF_X, z = (r + 0.5) * (WF_Y * 2 / WF_ROWS) - WF_Y;
                if (wfCellWalkable(c, r) || !wfInsideField(x, z)) continue;
                if (Math.hypot(x - WF_LAIR.x, z - WF_LAIR.y) <= WF_LAIR.pitR + 0.6) continue;   // the arena pit is a HOLE, not a rock tower
                const hsh = ((c * 51721) ^ (r * 88301)) >>> 0;
                // SMOOTH mesa heights — neighbours share a low-frequency swell, so
                // the jungle reads as carved rock formations, not random steps.
                const swell = (Math.sin(x * 0.31) + Math.cos(z * 0.43) + Math.sin((x + z) * 0.19)) / 3;
                cells.push({ x, z, h: 0.58 + swell * 0.14 + ((hsh % 23) / 23) * 0.06, shade: (hsh % 89) / 89 });
            }
        }
        const geo = new THREE.BoxGeometry((WF_X * 2 / WF_COLS) * 1.001, 1, (WF_Y * 2 / WF_ROWS) * 1.001);
        // The faint emissive floor keeps shadow-side faces from reading as
        // holes; the shader adds a base-AO gradient so mesas sit IN the ground.
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.02, map: cliffTexture(), emissive: new THREE.Color("#0d110c"), emissiveIntensity: 0.5 });
        mat.onBeforeCompile = (s) => {
            s.vertexShader = s.vertexShader
                .replace("#include <common>", "#include <common>\nvarying vec3 vWfWall;")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\n{ vec4 wfw = instanceMatrix * vec4(position, 1.0); vWfWall = (modelMatrix * wfw).xyz; }");
            s.fragmentShader = s.fragmentShader
                .replace("#include <common>", "#include <common>\nvarying vec3 vWfWall;")
                .replace("#include <map_fragment>", "{ vec4 sampledDiffuseColor = texture2D( map, vWfWall.xz * 0.16 + vWfWall.y * 0.05 ); diffuseColor *= sampledDiffuseColor; diffuseColor.rgb *= (0.74 + 0.26 * smoothstep(0.0, 0.65, vWfWall.y)); }");
        };
        mat.customProgramCacheKey = () => "warfront-low-cliffs-v2";
        const m = new THREE.InstancedMesh(geo, mat, cells.length);
        const o = new THREE.Object3D();
        const col = new THREE.Color();
        cells.forEach((cel, i) => {
            o.position.set(cel.x, cel.h / 2 - 0.1, cel.z);
            o.scale.set(1, cel.h, 1);
            o.rotation.set(0, 0, 0);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
            col.setHSL(spec.tileHue, spec.tileSat * 0.55, 0.34 + cel.shade * 0.12);
            m.setColorAt(i, col);
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.receiveShadow = true;   // casts skipped — the wall shadow pass was a frame hog
        return m;
    }, [spec]);
    const canopyMesh = useMemo(() => {
        const spots: Array<{ x: number; z: number; h: number; s: number; hsh: number }> = [];
        for (let r = 0; r < WF_ROWS; r++) {
            for (let c = 0; c < WF_COLS; c++) {
                const x = (c + 0.5) * (WF_X * 2 / WF_COLS) - WF_X, z = (r + 0.5) * (WF_Y * 2 / WF_ROWS) - WF_Y;
                if (wfCellWalkable(c, r) || !wfInsideField(x, z)) continue;
                if (Math.hypot(x - WF_LAIR.x, z - WF_LAIR.y) <= WF_LAIR.pitR + 0.6) continue;
                const hsh = ((c * 40503) ^ (r * 69061)) >>> 0;
                if (c % 5 !== 2 || r % 5 !== 2 || hsh % 100 >= 22) continue;
                const swell = (Math.sin(x * 0.31) + Math.cos(z * 0.43) + Math.sin((x + z) * 0.19)) / 3;
                spots.push({ x, z, h: 0.58 + swell * 0.14, s: 0.8 + (hsh % 37) / 37 * 0.4, hsh });
            }
        }
        // HAND-PAINTED TREE CARDS (crossed alpha planes off the foliage atlas)
        // — the LoL/Unite forest technique, replacing the old cone stacks.
        // Four variants → four instanced draw calls for the whole jungle.
        const group = new THREE.Group();
        const tex = foliageTexture();
        const byTile: Record<number, Array<{ x: number; z: number; h: number; s: number; hsh: number }>> = { 0: [], 1: [], 2: [], 3: [] };
        for (const sp of spots) {
            const tile = sp.hsh % 12 === 0 ? 2 : [0, 1, 3][sp.hsh % 3];   // jade spirit trees stay rare
            byTile[tile].push(sp);
        }
        const o = new THREE.Object3D();
        const col = new THREE.Color();
        for (const tile of [0, 1, 2, 3]) {
            const list = byTile[tile];
            if (!list.length) continue;
            const mat = new THREE.MeshBasicMaterial({
                map: tex, alphaTest: 0.42, side: THREE.DoubleSide,
                // The sprites carry their own painted lighting — basic material
                // keeps them consistent; fog still applies for depth.
            });
            const m = new THREE.InstancedMesh(treeCardGeometry(tile), mat, list.length);
            list.forEach((sp, i) => {
                const size = (1.18 + ((sp.hsh % 29) / 29) * 0.48) * (tile === 2 ? 1.04 : 1);
                o.position.set(sp.x, Math.max(0, sp.h - 0.15), sp.z);
                o.scale.set(size, size, size);
                o.rotation.set(0, ((sp.hsh % 71) / 71) * Math.PI, 0);
                o.updateMatrix();
                m.setMatrixAt(i, o.matrix);
                // Sit the paintings into the scene: slight per-tree dimming
                // (canopy shade) with the spirit trees left luminous.
                const dim = tile === 2 ? 0.98 : 0.74 + ((sp.hsh % 17) / 17) * 0.2;
                col.setRGB(dim, dim, dim * (tile === 2 ? 1.02 : 0.97));
                m.setColorAt(i, col);
            });
            m.instanceMatrix.needsUpdate = true;
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
            group.add(m);
        }
        return group;
    }, []);
    useEffect(() => () => {
        wallMesh.geometry.dispose(); (wallMesh.material as THREE.Material).dispose(); wallMesh.dispose();
        canopyMesh.traverse((o) => {
            const mesh = o as THREE.InstancedMesh;
            if (mesh.isInstancedMesh) {
                mesh.dispose();
                mesh.geometry.dispose();
                (mesh.material as THREE.Material).dispose();
            }
        });
    }, [wallMesh, canopyMesh]);
    return (
        <group>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.8, 0]}>
                <planeGeometry args={[220, 130]} />
                <meshBasicMaterial color={spec.voidColor} />
            </mesh>
            <primitive object={instMesh} />
            <primitive object={skirtMesh} />
            <primitive object={wallMesh} />
            <primitive object={canopyMesh} />
            {laneGuides.map((line, lane) => <primitive key={lane} object={line} />)}
            <WfHollowGate glow={spec.breachGlow} reducedMotion={reducedMotion} />
            {/* Lesser-Warden shrine pads + team spawn rings. */}
            {WF_PADS.map(([x, y], i) => (
                <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, y]}>
                    <ringGeometry args={[1.15, 1.45, 40]} />
                    <meshBasicMaterial color={spec.breachGlow} transparent opacity={0.24} depthWrite={false} />
                </mesh>
            ))}
            {(["blue", "red"] as const).map((team) => (
                <group key={team} position={[WF_SPAWNS[team][0][0] + (team === "blue" ? 0.9 : -0.9), 0, 0]}>
                    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
                        <ringGeometry args={[1.3, 1.7, 44]} />
                        <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={0.5} depthWrite={false} />
                    </mesh>
                    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                        <circleGeometry args={[1.28, 44]} />
                        <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={0.08} depthWrite={false} />
                    </mesh>
                </group>
            ))}
        </group>
    );
}

/** Instanced scatter of a fal-generated prop GLB (largest mesh, normalized to
 * targetH, albedo-emissive lift like WfArtGlb so Hunyuan textures read in our
 * light). One draw call per prop kind. */
function WfPropInstances({ url, items, targetH, lift = 0.34 }: { url: string; items: ReadonlyArray<{ x: number; z: number; s: number; r: number }>; targetH: number; lift?: number }) {
    const gltf = useGLTF(url);
    const mesh = useMemo(() => {
        let src: THREE.Mesh | null = null;
        gltf.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const count = (m.geometry.getAttribute("position")?.count ?? 0);
            if (!src || count > (src.geometry.getAttribute("position")?.count ?? 0)) src = m;
        });
        const srcMesh = src as THREE.Mesh | null;
        if (!srcMesh) return null;
        const geo = srcMesh.geometry;
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        const k = targetH / Math.max(0.001, bb.max.y - bb.min.y);
        const mat = (srcMesh.material as THREE.MeshStandardMaterial).clone();
        if (mat.map) { mat.emissive = new THREE.Color("#ffffff"); mat.emissiveMap = mat.map; mat.emissiveIntensity = lift; }
        const inst = new THREE.InstancedMesh(geo, mat, items.length);
        const o = new THREE.Object3D();
        items.forEach((it, i) => {
            o.position.set(it.x, -bb.min.y * k * it.s, it.z);
            o.scale.setScalar(k * it.s);
            o.rotation.set(0, it.r, 0);
            o.updateMatrix();
            inst.setMatrixAt(i, o.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        return inst;
    }, [gltf, items, targetH, lift]);
    useEffect(() => () => {
        if (!mesh) return;
        // Geometry and textures belong to useGLTF's shared cache. This instance
        // owns only its cloned material and GPU instance buffers.
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) material.dispose();
        mesh.dispose();
    }, [mesh]);
    if (!mesh) return null;
    return <primitive object={mesh} />;
}
useGLTF.preload("/pet-models/wf-boulder.glb");
useGLTF.preload("/pet-models/wf-lantern.glb");
useGLTF.preload("/pet-models/ward-totem.glb");
useGLTF.preload(GATE_WARDEN_GLB);

// ── Set dressing — rim rocks, lane lanterns, breach crystals, base banners ───
// All deterministic (hash-sampled from the mask) and instanced: a handful of
// draw calls dresses the whole valley without touching gameplay or the sim.
function WfSetDressing({ theme }: { theme: WfTheme }) {
    const spec = WF_THEMES[theme];
    const data = useMemo(() => {
        const rocks: Array<{ x: number; z: number; s: number; r: number }> = [];
        const lanterns: Array<{ x: number; z: number }> = [];
        for (let r = 0; r < WF_ROWS; r++) {
            for (let c = 0; c < WF_COLS; c++) {
                const h = ((c * 92821) ^ (r * 68917)) >>> 0;
                const wx = (c + 0.5) * WF_CELL_X - WF_X, wz = (r + 0.5) * WF_CELL_Y - WF_Y;
                const walk = wfCellWalkable(c, r);
                const nearPath = wfCellWalkable(c - 1, r) || wfCellWalkable(c + 1, r) || wfCellWalkable(c, r - 1) || wfCellWalkable(c, r + 1);
                if (!walk && nearPath && h % 100 < 4 && Math.hypot(wx, wz) > WF_LAIR.r + 2 && wfInsideField(wx, wz)) {
                    rocks.push({ x: wx, z: wz, s: 0.5 + (h % 37) / 37 * 0.75, r: (h % 71) / 71 * Math.PI * 2 });
                } else if (walk && !nearPathAll(c, r) && Math.abs(wz) > 4.5 && h % 100 < 3) {
                    lanterns.push({ x: wx, z: wz });
                }
            }
        }
        function nearPathAll(c: number, r: number): boolean {
            return wfCellWalkable(c - 1, r) && wfCellWalkable(c + 1, r) && wfCellWalkable(c, r - 1) && wfCellWalkable(c, r + 1);
        }
        const crystals = Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2 + 0.3;
            const h = ((i * 48271) % 89) / 89;
            return { x: Math.cos(a) * (WF_LAIR.r + 0.8), z: Math.sin(a) * (WF_LAIR.r + 0.8) * 0.92, s: 0.9 + h * 0.65, r: a };
        });
        return { rocks, lanterns, crystals };
    }, []);
    const rockMesh = useMemo(() => {
        const geo = new THREE.DodecahedronGeometry(0.42, 0);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.96 });
        const m = new THREE.InstancedMesh(geo, mat, data.rocks.length);
        const o = new THREE.Object3D();
        const col = new THREE.Color();
        data.rocks.forEach((rk, i) => {
            o.position.set(rk.x, 0.16 * rk.s, rk.z);
            o.scale.setScalar(rk.s);
            o.rotation.set(rk.r, rk.r * 1.7, 0);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
            col.setHSL(spec.tileHue, spec.tileSat * 0.7, 0.08 + (i % 5) * 0.015);
            m.setColorAt(i, col);
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        return m;
    }, [data, spec]);
    const crystalMesh = useMemo(() => {
        // Jade breach crystals: sharper spires, hot emissive core, and a soft
        // additive glow pool at the base — they read as MAGIC now, not as
        // untextured wedges.
        const geo = new THREE.ConeGeometry(0.3, 1.15, 5);
        const mat = new THREE.MeshStandardMaterial({ color: "#0d1b16", emissive: new THREE.Color(spec.breachGlow), emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.1 });
        const m = new THREE.InstancedMesh(geo, mat, data.crystals.length);
        const o = new THREE.Object3D();
        data.crystals.forEach((cr, i) => {
            o.position.set(cr.x, 0.42 * cr.s, cr.z);
            o.scale.set(cr.s * 0.55, cr.s * 0.7, cr.s * 0.55);
            o.rotation.set(Math.sin(cr.r) * 0.24, cr.r, Math.cos(cr.r) * -0.24);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
        });
        m.instanceMatrix.needsUpdate = true;
        return m;
    }, [data, spec]);
    const crystalGlowMesh = useMemo(() => {
        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({ map: radialTexture3d(), color: new THREE.Color(spec.breachGlow), transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending });
        const m = new THREE.InstancedMesh(geo, mat, data.crystals.length);
        const o = new THREE.Object3D();
        data.crystals.forEach((cr, i) => {
            o.position.set(cr.x, 0.06, cr.z);
            o.rotation.set(-Math.PI / 2, 0, 0);
            o.scale.setScalar(1.6 * cr.s);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
        });
        m.instanceMatrix.needsUpdate = true;
        m.renderOrder = 2;
        return m;
    }, [data, spec]);
    // Lanterns are instanced too (two draw calls for every way-marker on the map).
    const lanternMeshes = useMemo(() => {
        const poleGeo = new THREE.CylinderGeometry(0.045, 0.06, 1.0, 6);
        const poleMat = new THREE.MeshStandardMaterial({ color: "#39304a", roughness: 0.8 });
        const lampGeo = new THREE.BoxGeometry(0.2, 0.24, 0.2);
        const lampMat = new THREE.MeshStandardMaterial({ color: "#1c1526", emissive: new THREE.Color(spec.sunColor), emissiveIntensity: 1.6 });
        const poles = new THREE.InstancedMesh(poleGeo, poleMat, data.lanterns.length);
        const lamps = new THREE.InstancedMesh(lampGeo, lampMat, data.lanterns.length);
        const o = new THREE.Object3D();
        data.lanterns.forEach((l, i) => {
            o.position.set(l.x, 0.5, l.z); o.rotation.set(0, 0, 0); o.scale.setScalar(1); o.updateMatrix();
            poles.setMatrixAt(i, o.matrix);
            o.position.set(l.x, 1.06, l.z); o.updateMatrix();
            lamps.setMatrixAt(i, o.matrix);
        });
        poles.instanceMatrix.needsUpdate = true;
        lamps.instanceMatrix.needsUpdate = true;
        return [poles, lamps] as const;
    }, [data, spec]);
    // Warm glow halos floating at each lamp (one instanced additive quad,
    // gently flickering) — the "bloom" a postprocessing stack would give us,
    // at a price the mobile budget can afford.
    const lanternGlowMesh = useMemo(() => {
        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({ map: radialTexture3d(), color: new THREE.Color(spec.sunColor), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
        const m = new THREE.InstancedMesh(geo, mat, data.lanterns.length);
        const o = new THREE.Object3D();
        data.lanterns.forEach((l, i) => {
            o.position.set(l.x, 1.12, l.z);
            o.rotation.set(-Math.PI / 2, 0, 0);
            o.scale.setScalar(1.5 + (i % 3) * 0.2);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
        });
        m.instanceMatrix.needsUpdate = true;
        m.renderOrder = 2;
        return m;
    }, [data, spec]);
    useEffect(() => () => {
        for (const m of [rockMesh, crystalMesh, crystalGlowMesh, lanternGlowMesh, ...lanternMeshes]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.dispose(); }
    }, [rockMesh, crystalMesh, crystalGlowMesh, lanternGlowMesh, lanternMeshes]);
    const lanternItems = useMemo(() => data.lanterns.map((l, i) => ({ x: l.x, z: l.z, s: 0.95 + (i % 3) * 0.08, r: (i * 2.39996) % (Math.PI * 2) })), [data]);
    return (
        <group>
            {/* fal-generated props (mossy boulder / stone toro lantern) with
                the old primitives as loading fallbacks. */}
            <Suspense fallback={<primitive object={rockMesh} />}>
                <WfPropInstances url="/pet-models/wf-boulder.glb" items={data.rocks} targetH={0.9} lift={0.12} />
            </Suspense>
            <Suspense fallback={(
                <group>
                    <primitive object={lanternMeshes[0]} />
                    <primitive object={lanternMeshes[1]} />
                </group>
            )}>
                <WfPropInstances url="/pet-models/wf-lantern.glb" items={lanternItems} targetH={1.35} lift={0.45} />
            </Suspense>
            <primitive object={crystalMesh} />
            <primitive object={crystalGlowMesh} />
            <primitive object={lanternGlowMesh} />
        </group>
    );
}

// ── One pet fighter (GLB driven from the warfront snapshot stream) ───────────
function WfPetModelFallback({ height, tint }: { height: number; tint: string }) {
    return (
        <mesh position={[0, height * 0.5, 0]}>
            <capsuleGeometry args={[height * 0.24, height * 0.5, 4, 10]} />
            <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.4} transparent opacity={0.9} />
        </mesh>
    );
}

function WfFighter3D({ result, clock, id, pet, config }: {
    result: WarfrontResult; clock: WfClockRef; id: string; pet: Pet; config: PetCombatModelConfig | null;
}) {
    const root = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const aura = useRef<THREE.Mesh>(null);
    const auraMat = useRef<THREE.MeshBasicMaterial>(null);
    const shadow = useRef<THREE.Mesh>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const nameWrap = useRef<HTMLDivElement>(null);
    const reviveRef = useRef<HTMLDivElement>(null);
    const markRef = useRef<HTMLSpanElement>(null);
    const shieldRef = useRef<THREE.Mesh>(null);
    const stacksRef = useRef<HTMLSpanElement>(null);
    const levelRef = useRef<HTMLSpanElement>(null);
    const intentRef = useRef<HTMLDivElement>(null);
    const modelFrame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const renderMotion = useRef<WarfrontMotionFilterState>(createWarfrontMotionFilter());
    const smSpd = useRef(0);
    const lastTick = useRef(-1);
    const wasMoving = useRef(false);
    const flash = useRef(0);
    const prevHp = useRef(Number.POSITIVE_INFINITY);
    const faceSm = useRef<[number, number]>([id.startsWith("blue") ? 1 : -1, 0]);
    const travel = useRef<[number, number]>([1, 0]);
    const team: Team = id.startsWith("blue") ? "blue" : "red";
    // A pet with no approved GLB (a custom/unapproved pet) still renders — a
    // team-tinted capsule placeholder, NEVER null/invisible. Everything below
    // (nameplate, HP, level, statuses, death/respawn) is model-independent.
    const targetH = config ? config.targetHeight : 1.6;
    const h = arenaModelHeight(targetH) * 1.15;   // the Warfront field is huge — pets read a touch bigger
    const s = config ? h / Math.max(0.001, targetH) : 1;
    const tint = useMemo(() => tintOf(pet.element), [pet.element]);
    const role = useMemo(() => result.snapshots.at(0)?.actors.find((a) => a.id === id)?.role ?? "tracker", [result, id]);

    useFrame((state, delta) => {
        const g = root.current; if (!g) return;
        const snaps = result.snapshots;
        const bounds = warfrontSnapshotBoundsAtTick(snaps, wfClockTick(clock));
        if (!bounds) return;
        const { lower, upper, tick: tf, alpha: f } = bounds;
        const a0 = wfSnapshotIndex(lower).actorsById.get(id); if (!a0) return;
        const a1 = wfSnapshotIndex(upper).actorsById.get(id) ?? a0;
        const down = a0.state === "respawning";
        const tdx = a1.x - a0.x, tdz = a1.y - a0.y;
        const teleport = tdx * tdx + tdz * tdz > 9;
        const ff = teleport ? (f < 0.5 ? 0 : 1) : f;
        const px = lerp(a0.x, a1.x, ff), pz = lerp(a0.y, a1.y, ff);
        const rewound = tf < lastTick.current;
        lastTick.current = tf;
        const motion = advanceWarfrontMotionFilter(renderMotion.current, px, pz, delta, teleport || rewound);
        const filteredSpeed = warfrontMotionFilterSpeed(motion);
        smSpd.current = approach(smSpd.current, down ? 0 : filteredSpeed, 0.22, delta);
        const moving = !down && (wasMoving.current ? smSpd.current > 0.28 : smSpd.current > 0.72);
        wasMoving.current = moving;
        g.position.set(motion.x, 0, motion.z);
        if (body.current) body.current.visible = !down;

        const now = wfClockSeconds(clock);
        const strikeTick = warfrontLatestTickAtOrBefore(wfPetStrikeTicks(result, id), tf);
        const striking = strikeTick !== null && tf >= strikeTick && tf - strikeTick < WARFRONT_TPS * 0.3;

        // While MOVING, face where you are going (sim facing is for combat) —
        // mismatched face/travel made pets moonwalk sideways.
        let fx = a0.faceX, fz = a0.faceY;
        if (moving && filteredSpeed > 1e-5) { fx = motion.vx / filteredSpeed; fz = motion.vz / filteredSpeed; }
        else if (Math.hypot(fx, fz) < 0.1) { fx = faceSm.current[0]; fz = faceSm.current[1]; }
        faceSm.current[0] = approach(faceSm.current[0], fx, 0.18, delta);
        faceSm.current[1] = approach(faceSm.current[1], fz, 0.18, delta);
        const flen = Math.hypot(faceSm.current[0], faceSm.current[1]) || 1;
        if (moving && filteredSpeed > 1e-5) travel.current = [motion.vx / filteredSpeed, motion.vz / filteredSpeed];

        if (a0.hp < prevHp.current - 0.5) flash.current = 1;
        prevHp.current = a0.hp;
        flash.current *= 0.86;
        const frac = a0.hp / Math.max(1, a0.maxHp);

        const mf = modelFrame.current;
        mf.motion = arenaModelMotion(a0.state === "respawning" ? "respawning" : a0.state === "dash" ? "dash" : striking ? "attack" : "idle", moving, striking);
        mf.moving = moving;
        mf.speed = Math.min(6, smSpd.current);   // real units/second — the rigs gallop at >= 2.65
        mf.moveX = travel.current[0];
        mf.moveZ = travel.current[1];
        mf.faceX = faceSm.current[0] / flen;
        mf.faceZ = faceSm.current[1] / flen;
        mf.hit = flash.current < 0.02 ? 0 : flash.current;
        mf.casting = false;
        mf.desperate = !down && frac > 0 && frac < 0.26;
        mf.statuses = a0.statuses;
        mf.timeline = wfClockSeconds(clock);

        if (aura.current && auraMat.current) {
            aura.current.visible = !down;
            aura.current.position.set(motion.x, 0.03, motion.z);
            auraMat.current.color.set(a0.intent === "recall" ? "#34d399" : TEAM_COLOR[team]);
        }
        if (shadow.current) { shadow.current.visible = !down; shadow.current.position.set(motion.x, 0.045, motion.z); }
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
        if (nameWrap.current) {
            const camDistance = Math.hypot(state.camera.position.x - px, state.camera.position.z - pz);
            const important = down || frac < 0.985 || striking || a0.statuses.length > 0;
            const opacity = important || camDistance < 22 ? (down ? 0.55 : 1) : camDistance < 29 ? 0.48 : 0.16;
            nameWrap.current.style.opacity = String(opacity);
            nameWrap.current.style.visibility = !important && camDistance > 35 ? "hidden" : "visible";
        }
        if (reviveRef.current) {
            const show = down && a0.respawnSecs > 0;
            reviveRef.current.style.opacity = show ? "1" : "0";
            if (show) reviveRef.current.textContent = `↻ ${a0.respawnSecs}s`;
        }
        if (stacksRef.current) stacksRef.current.textContent = a0.stacksTotal > 0 ? `▲${a0.stacksTotal}` : "";
        if (markRef.current) markRef.current.textContent = a0.statuses.includes("mark") ? " 🎯" : "";
        if (shieldRef.current) {
            shieldRef.current.visible = !down && a0.shielded;
            const pulse = 1 + Math.sin(now * 5) * 0.04;
            shieldRef.current.scale.setScalar(pulse);
        }
        if (levelRef.current) levelRef.current.textContent = a0.wlevel > 1 ? `★${a0.wlevel}` : "";
        if (intentRef.current) {
            intentRef.current.textContent = down ? "" : intentLabel(a0.intent);
            intentRef.current.style.color = a0.intent === "recall" ? "#6ee7b7" : TEAM_SOFT[team];
        }
        if (body.current) {
            const grow = 1 + (a0.wlevel - 1) * 0.08;   // Unite-style: levels physically GROW the pet
            body.current.scale.x = approach(body.current.scale.x, grow, 0.1, delta);
            body.current.scale.y = approach(body.current.scale.y, grow, 0.1, delta);
            body.current.scale.z = approach(body.current.scale.z, grow, 0.1, delta);
        }
    });

    return (
        <group>
            <group ref={root}>
                <group ref={body}>
                    {config ? (
                        <WfAssetErrorBoundary fallback={<WfPetModelFallback height={h} tint={tint} />} label={`${pet.name} rig`}>
                            <Suspense fallback={<WfPetModelFallback height={h} tint={tint} />}>
                                <group scale={s}>
                                    <PetModel3D config={config} frame={modelFrame} element={pet.element} surfaceTreatment={petModelVariantSurface(pet)} />
                                </group>
                            </Suspense>
                        </WfAssetErrorBoundary>
                    ) : (
                        // No approved model — a visible team-tinted placeholder.
                        <mesh position={[0, h * 0.5, 0]}>
                            <capsuleGeometry args={[h * 0.26, h * 0.52, 6, 12]} />
                            <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.35} />
                        </mesh>
                    )}
                    {/* Shield bubble — the defender/Aegis shields finally READ. */}
                    <mesh ref={shieldRef} visible={false} position={[0, h * 0.55, 0]} renderOrder={3}>
                        <sphereGeometry args={[h * 0.72, 18, 14]} />
                        <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                </group>
                <Html position={[0, h + 0.5, 0]} center distanceFactor={10} pointerEvents="none" zIndexRange={[6, 0]}>
                    <div ref={nameWrap} style={{ textAlign: "center", font: "700 11px Inter, system-ui, sans-serif", whiteSpace: "nowrap", userSelect: "none" }}>
                        <div style={{ color: "#fff", textShadow: "0 1px 3px #000", marginBottom: 2 }}>
                            <span style={{ color: TEAM_SOFT[team], fontSize: 8, fontWeight: 800, marginRight: 3 }}>{ROLE_TAG[role] ?? ""}</span>
                            {pet.name}
                            <span ref={levelRef} style={{ marginLeft: 3, color: "#6ee7b7", fontSize: 9, fontWeight: 900 }} />
                            <span ref={stacksRef} style={{ marginLeft: 3, color: "#fde047", fontSize: 9 }} /><span ref={markRef} style={{ color: "#f87171", fontSize: 9 }} />
                        </div>
                        <div style={{ position: "relative", width: 58, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: TEAM_COLOR[team] }} />
                        </div>
                        <div ref={intentRef} style={{ marginTop: 1, fontSize: 7, fontWeight: 900, letterSpacing: "0.08em", textShadow: "0 1px 2px #000" }} />
                        <div ref={reviveRef} style={{ opacity: 0, color: "#fde047", fontSize: 10, fontWeight: 800, marginTop: 1 }} />
                    </div>
                </Html>
            </group>
            <mesh ref={aura} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
                <planeGeometry args={[1.6, 1.6]} />
                <meshBasicMaterial ref={auraMat} map={radialTexture3d()} transparent opacity={0.3} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.95, 0.7]} />
                <meshBasicMaterial map={radialTexture3d()} color="#000000" transparent opacity={0.36} depthWrite={false} />
            </mesh>
        </group>
    );
}

// ── Hollow-spawn — the ABYSSAL ONI HOUND (roster mythic-4: the user's hollow
// beast, already an approved rigged GLB) in a fixed pool. Each slot drives its
// own PetModelFrame so the hounds RUN their skeletal gait along the lanes; a
// small wisp stands in while the model streams. Pool is imperative — waves
// never re-render React.
const HOLLOW_POOL = 6;    // = sim MOB_CAP (was 4 → up to 2 breach raiders rendered invisible)
const MINION_POOL = 24;   // = sim MINION_CAP (12) × 2 teams — exact once the cap-overflow bug is fixed
const HOLLOW_BEAST_ID = "mythic-4";   // Abyssal Oni Hound — the Hollow Gate beast
// Shared distant-LOD primitives. Thirty pooled slots now reuse five geometries
// and six materials instead of constructing hundreds of duplicate GPU objects.
type WfHoundSide = "blue" | "red" | "hollow";
const wfHoundMaterials = (
    body: string,
    leg: string,
    head: string,
    ear: string,
    muzzle: string,
    tail: string,
    emissive: string,
) => Object.freeze({
    body: new THREE.MeshStandardMaterial({ color: body, emissive, emissiveIntensity: 0.86, roughness: 0.42 }),
    leg: new THREE.MeshStandardMaterial({ color: leg, emissive, emissiveIntensity: 0.6, roughness: 0.5 }),
    head: new THREE.MeshStandardMaterial({ color: head, emissive, emissiveIntensity: 0.95, roughness: 0.36 }),
    ear: new THREE.MeshStandardMaterial({ color: ear, emissive, emissiveIntensity: 0.82, roughness: 0.35 }),
    muzzle: new THREE.MeshBasicMaterial({ color: muzzle, toneMapped: false }),
    tail: new THREE.MeshStandardMaterial({ color: tail, emissive, emissiveIntensity: 0.72, roughness: 0.4 }),
});
const WF_HOUND_LOD = {
    bodyGeometry: new THREE.CapsuleGeometry(0.2, 0.5, 3, 7),
    boxGeometry: new THREE.BoxGeometry(1, 1, 1),
    headGeometry: new THREE.DodecahedronGeometry(0.23, 0),
    earGeometry: new THREE.TetrahedronGeometry(0.17, 0),
    tailGeometry: new THREE.ConeGeometry(0.085, 0.5, 5),
    materials: Object.freeze({
        blue: wfHoundMaterials("#082f49", "#0c4a6e", "#075985", "#0284c7", "#e0f2fe", "#0369a1", "#38bdf8"),
        red: wfHoundMaterials("#4c0519", "#881337", "#9f1239", "#e11d48", "#ffe4e6", "#be123c", "#fb7185"),
        hollow: wfHoundMaterials("#210449", "#18032f", "#4c126f", "#7e22ce", "#f5d0fe", "#6b21a8", "#a855f7"),
    }),
};

function WfHollowHoundImpostor({ bodyRef, side = "hollow" }: { bodyRef: MutableRefObject<THREE.Group | null>; side?: WfHoundSide }) {
    const material = WF_HOUND_LOD.materials[side];
    return (
        <group ref={bodyRef} dispose={null}>
            {/* A clear quadruped silhouette for distant LODs: long torso,
                separated legs, angular head/ears and a luminous muzzle. */}
            <mesh geometry={WF_HOUND_LOD.bodyGeometry} material={material.body} position={[0, 0.32, -0.04]} rotation={[Math.PI / 2, 0, 0]} scale={[0.9, 1, 0.8]} />
            {([[-0.16, -0.2], [0.16, -0.2], [-0.16, 0.2], [0.16, 0.2]] as const).map(([x, z]) => (
                <mesh key={`${x}:${z}`} geometry={WF_HOUND_LOD.boxGeometry} material={material.leg} position={[x, 0.15, z]} scale={[0.085, 0.26, 0.11]} />
            ))}
            <mesh geometry={WF_HOUND_LOD.headGeometry} material={material.head} position={[0, 0.42, 0.42]} scale={[0.78, 0.78, 1.02]} />
            {([-0.11, 0.11] as const).map((x) => (
                <mesh key={x} geometry={WF_HOUND_LOD.earGeometry} material={material.ear} position={[x, 0.61, 0.37]} rotation={[0.18, x < 0 ? -0.3 : 0.3, x < 0 ? 0.18 : -0.18]} scale={[0.66, 0.96, 0.58]} />
            ))}
            <mesh geometry={WF_HOUND_LOD.boxGeometry} material={material.muzzle} position={[0, 0.39, 0.65]} scale={[0.18, 0.075, 0.2]} />
            {side === "hollow" ? (
                <>
                    <mesh geometry={WF_HOUND_LOD.earGeometry} material={material.muzzle} position={[-0.15, 0.53, -0.1]} rotation={[0, 0, 0.5]} scale={[0.48, 1.05, 0.48]} />
                    <mesh geometry={WF_HOUND_LOD.earGeometry} material={material.muzzle} position={[0.15, 0.53, -0.1]} rotation={[0, 0, -0.5]} scale={[0.48, 1.05, 0.48]} />
                </>
            ) : (
                <mesh geometry={WF_HOUND_LOD.boxGeometry} material={material.muzzle} position={[0, 0.51, -0.04]} scale={[0.31, 0.055, 0.3]} />
            )}
            <mesh geometry={WF_HOUND_LOD.tailGeometry} material={material.tail} position={[0, 0.39, -0.5]} rotation={[-Math.PI / 2.6, 0, 0]} />
        </group>
    );
}

/** One pooled hound slot: owns its refs (compiler-safe) and drives itself from
 * snap.mobs[index] every frame. Mounted once; waves never re-render React. */
function WfHoundSlot({ result, clock, index, config, rigBudget, rigDistance, bindings, kind }: {
    result: WarfrontResult;
    clock: WfClockRef;
    index: number;
    config: PetCombatModelConfig;
    rigBudget: number;
    rigDistance: number;
    bindings: MutableRefObject<WfMobSlotBindings>;
    kind: "lane" | "hollow";
}) {
    const isLane = kind === "lane";
    const group = useRef<THREE.Group>(null);
    const impostor = useRef<THREE.Group>(null);
    const hpBar = useRef<THREE.Group>(null);
    const hpFill = useRef<THREE.Mesh>(null);
    const frame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const renderMotion = useRef<WarfrontMotionFilterState>(createWarfrontMotionFilter());
    const smSpd = useRef(0);
    const lastTick = useRef(-1);
    const wasMoving = useRef(false);
    const boundId = useRef(-1);
    const [side, setSide] = useState<"blue" | "red">("blue");
    const [richUi, setRichUi] = useState(false);
    const richRef = useRef(false);
    const scale = 0.65 / Math.max(0.001, config.targetHeight);
    useFrame((state, delta) => {
        const g = group.current;
        if (!g) return;
        const { s0, s1, f: bf } = lerpFrameAt(result, clock);
        reconcileWfMobBindings(bindings.current, s1);
        const slotId = bindings.current[isLane ? "lane" : "hollow"][index];
        const m1 = slotId == null ? undefined : wfSnapshotIndex(s1).mobsById.get(slotId);
        if (!m1) {
            g.visible = false;
            boundId.current = -1;
            if (richRef.current) {
                richRef.current = false;
                setRichUi(false);
            }
            return;
        }
        g.visible = true;
        if (isLane && m1.side !== side && (m1.side === "blue" || m1.side === "red")) setSide(m1.side);
        const m0 = wfSnapshotIndex(s0).mobsById.get(m1.id);
        const jump = !!m0 && ((m1.x - m0.x) ** 2 + (m1.y - m0.y) ** 2 > 9);
        const tx = m0 && !jump ? lerp(m0.x, m1.x, bf) : m1.x;
        const tz = m0 && !jump ? lerp(m0.y, m1.y, bf) : m1.y;
        const fresh = boundId.current !== m1.id;
        boundId.current = m1.id;
        const tick = wfClockTick(clock);
        const rewound = tick < lastTick.current;
        lastTick.current = tick;
        const motion = advanceWarfrontMotionFilter(renderMotion.current, tx, tz, delta, fresh || jump || rewound);
        const filteredSpeed = warfrontMotionFilterSpeed(motion);
        smSpd.current = approach(smSpd.current, fresh ? 0 : filteredSpeed, 0.2, delta);
        const moving = !fresh && (wasMoving.current ? smSpd.current > 0.24 : smSpd.current > 0.65);
        wasMoving.current = moving;
        const camDistance = Math.hypot(state.camera.position.x - motion.x, state.camera.position.z - motion.z);
        const wantsRig = shouldRenderWarfrontHoundRig(
            index,
            camDistance,
            rigBudget,
            rigDistance + (richRef.current ? 4 : 0),
        );
        if (wantsRig !== richRef.current) {
            richRef.current = wantsRig;
            setRichUi(wantsRig);
        }
        g.scale.setScalar(isLane && m1.elite ? 1.3 : 1);   // Gate's Wrath elites LOOM
        const f = frame.current;
        const seconds = wfClockSeconds(clock);
        const attackPhase = m1.attackPhase >= 0
            ? (m0 && m0.attackPhase >= 0 ? lerp(m0.attackPhase, m1.attackPhase, bf) : m1.attackPhase)
            : -1;
        const strikePulse = attackPhase >= 0 ? Math.sin(Math.PI * Math.min(1, attackPhase)) : 0;
        const striking = attackPhase >= 0;
        f.motion = moving ? "run" : striking ? "strike" : "idle";
        f.moving = moving;
        f.speed = Math.min(6, smSpd.current);
        if (moving && filteredSpeed > 1e-6) {
            f.moveX = motion.vx / filteredSpeed;
            f.moveZ = motion.vz / filteredSpeed;
            f.faceX = f.moveX;
            f.faceZ = f.moveZ;
        }
        f.timeline = seconds;
        const lunge = strikePulse * (isLane ? 0.12 : 0.13);
        g.position.set(motion.x + f.faceX * lunge, 0, motion.z + f.faceZ * lunge);
        const health = Math.max(0, Math.min(1, m1.hp / Math.max(1, m1.maxHp)));
        f.desperate = health < 0.35;
        if (hpBar.current) {
            hpBar.current.visible = health < 0.995;
            hpBar.current.quaternion.copy(state.camera.quaternion);
        }
        if (hpFill.current) {
            hpFill.current.scale.x = health;
            hpFill.current.position.x = -0.3 * (1 - health);
        }
        if (impostor.current) {
            const targetYaw = Math.atan2(f.faceX, f.faceZ);
            impostor.current.rotation.y = approachAngle(impostor.current.rotation.y, targetYaw, 0.28, delta);
            const gait = seconds * (isLane ? 9 : 9.5) + index;
            impostor.current.position.y = moving ? Math.abs(Math.sin(gait)) * (isLane ? 0.035 : 0.04) : 0;
            impostor.current.rotation.z = moving ? Math.sin(gait) * (isLane ? 0.025 : 0.028) : 0;
        }
    });
    return (
        <group ref={group} visible={false}>
            {/* Ground-glow keeps lane and Hollow hounds readable in deep jungle. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]} renderOrder={1}>
                <planeGeometry args={isLane ? [1.05, 1.05] : [1.15, 1.15]} />
                <meshBasicMaterial
                    map={radialTexture3d()}
                    color={isLane ? (side === "blue" ? "#38bdf8" : "#fb7185") : "#a855f7"}
                    transparent
                    opacity={isLane ? 0.38 : 0.4}
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </mesh>
            <group ref={hpBar} position={[0, 0.86, 0]} visible={false} renderOrder={8}>
                <mesh position={[0, 0, -0.01]}>
                    <planeGeometry args={[0.68, 0.1]} />
                    <meshBasicMaterial color="#070b14" depthTest={false} />
                </mesh>
                <mesh ref={hpFill}>
                    <planeGeometry args={[0.6, 0.055]} />
                    <meshBasicMaterial color={isLane ? (side === "blue" ? "#38bdf8" : "#fb7185") : "#c084fc"} depthTest={false} />
                </mesh>
            </group>
            {richUi ? (
                <WfAssetErrorBoundary
                    fallback={<WfHollowHoundImpostor bodyRef={impostor} side={isLane ? side : "hollow"} />}
                    label={isLane ? `${side} lane hound rig` : "Hollow hound rig"}
                >
                    <Suspense fallback={<WfHollowHoundImpostor bodyRef={impostor} side={isLane ? side : "hollow"} />}>
                        <group scale={scale}>
                            <PetModel3D
                                config={config}
                                frame={frame}
                                element={isLane ? (side === "blue" ? "Water" : "Fire") : "Shadow"}
                                showIdentity={false}
                                surfaceTreatment={isLane ? WARFRONT_MINION_SURFACES[side] : HOLLOW_HOUND_SURFACE}
                            />
                        </group>
                    </Suspense>
                </WfAssetErrorBoundary>
            ) : (
                <WfHollowHoundImpostor bodyRef={impostor} side={isLane ? side : "hollow"} />
            )}
        </group>
    );
}

function WfMobPool({ result, clock, budget }: {
    result: WarfrontResult;
    clock: WfClockRef;
    budget: WarfrontPresentationBudget;
}) {
    const config = useMemo(() => petCombatModel({ id: HOLLOW_BEAST_ID } as Pet), []);
    const bindings = useRef<WfMobSlotBindings>({
        snapshot: null,
        hollow: Array.from({ length: HOLLOW_POOL }, () => null),
        lane: Array.from({ length: MINION_POOL }, () => null),
    });
    if (!config) return null;
    return (
        <group>
            {Array.from({ length: HOLLOW_POOL }, (_, i) => (
                <WfHoundSlot
                    key={i}
                    result={result}
                    clock={clock}
                    index={i}
                    config={config}
                    rigBudget={budget.hollowHoundRigs}
                    rigDistance={budget.houndRigDistance}
                    bindings={bindings}
                    kind="hollow"
                />
            ))}
            {Array.from({ length: MINION_POOL }, (_, i) => (
                <WfHoundSlot
                    key={`w${i}`}
                    result={result}
                    clock={clock}
                    index={i}
                    config={config}
                    rigBudget={budget.laneHoundRigs}
                    rigDistance={budget.houndRigDistance}
                    bindings={bindings}
                    kind="lane"
                />
            ))}
        </group>
    );
}

// ── Structures: Guardian Totems + Ward Seals ─────────────────────────────────
function WfStatue({ result, clock, team, idx }: { result: WarfrontResult; clock: WfClockRef; team: Team; idx: number }) {
    const grp = useRef<THREE.Group>(null);
    const rubble = useRef<THREE.Group>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const wrap = useRef<HTMLDivElement>(null);
    const first = result.snapshots.at(0)!.structures[team].statues[idx];
    useFrame(() => {
        const s = snapAt(result, clock).structures[team].statues[idx];
        if (grp.current) grp.current.visible = s.alive;
        if (rubble.current) rubble.current.visible = !s.alive;
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, (s.hp / s.maxHp) * 100))}%`;
        if (wrap.current) wrap.current.style.opacity = s.alive ? "1" : "0";
    });
    return (
        <group position={[first.x, 0, first.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.021, 0]}>
                <circleGeometry args={[0.8, 28]} />
                <meshBasicMaterial color="#0c0f1c" transparent opacity={0.8} depthWrite={false} />
            </mesh>
            <group ref={grp}>
                <Suspense fallback={(
                    <mesh castShadow position={[0, 1.1, 0]}>
                        <cylinderGeometry args={[0.55, 0.72, 2.2, 8]} />
                        <meshStandardMaterial color="#4c5670" roughness={0.85} />
                    </mesh>
                )}>
                    <WfArtGlb url="/pet-models/ward-totem.glb" targetH={2.7} />
                </Suspense>
                {/* Team-light crown so ownership reads from the broadcast camera. */}
                <mesh position={[0, 2.95, 0]}>
                    <octahedronGeometry args={[0.24]} />
                    <meshStandardMaterial color={TEAM_COLOR[team]} emissive={TEAM_COLOR[team]} emissiveIntensity={1.4} roughness={0.3} />
                </mesh>
                <Html position={[0, 2.9, 0]} center distanceFactor={11} pointerEvents="none" zIndexRange={[7, 0]}>
                    <div ref={wrap} style={{ textAlign: "center", font: "800 9px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
                        <div style={{ color: TEAM_SOFT[team], textShadow: "0 1px 3px #000", marginBottom: 1 }}>⛩ Totem</div>
                        <div style={{ position: "relative", width: 54, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: TEAM_COLOR[team] }} />
                        </div>
                    </div>
                </Html>
            </group>
            {/* Shattered aftermath — rubble instead of a bare dark socket. */}
            <group ref={rubble} visible={false}>
                <mesh position={[0.32, 0.16, 0.1]} rotation={[0.4, 0.8, 0.2]}>
                    <dodecahedronGeometry args={[0.32]} />
                    <meshStandardMaterial color="#565b68" roughness={0.95} />
                </mesh>
                <mesh position={[-0.34, 0.1, -0.16]} rotation={[0.2, 0.3, 0.7]}>
                    <dodecahedronGeometry args={[0.24]} />
                    <meshStandardMaterial color="#454a58" roughness={0.95} />
                </mesh>
                <mesh position={[-0.05, 0.28, 0.28]} rotation={[1.25, 0.5, 0.3]}>
                    <cylinderGeometry args={[0.17, 0.22, 0.9, 6]} />
                    <meshStandardMaterial color="#50556b" roughness={0.9} />
                </mesh>
            </group>
        </group>
    );
}

function WfCore({ result, clock, team, reducedMotion }: { result: WarfrontResult; clock: WfClockRef; team: Team; reducedMotion: boolean }) {
    const gem = useRef<THREE.Mesh>(null);
    const shield = useRef<THREE.Mesh>(null);
    const grp = useRef<THREE.Group>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const label = useRef<HTMLDivElement>(null);
    const first = result.snapshots.at(0)!.structures[team].core;
    useFrame((state) => {
        const c = snapAt(result, clock).structures[team].core;
        if (grp.current) grp.current.visible = c.alive;
        if (gem.current) {
            gem.current.rotation.y = reducedMotion ? 0 : state.clock.elapsedTime * 0.8;
            gem.current.position.y = reducedMotion ? 1.15 : 1.15 + Math.sin(state.clock.elapsedTime * 1.6) * 0.1;
        }
        if (shield.current) shield.current.visible = c.alive && !c.exposed;
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100))}%`;
        if (label.current) label.current.textContent = c.alive ? (c.exposed ? "🔮 Ward Seal — EXPOSED" : "🔮 Ward Seal") : "";
    });
    return (
        <group position={[first.x, 0, first.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.021, 0]}>
                <circleGeometry args={[1.0, 32]} />
                <meshBasicMaterial color="#0c0f1c" transparent opacity={0.85} depthWrite={false} />
            </mesh>
            <group ref={grp}>
                <mesh castShadow position={[0, 0.22, 0]}>
                    <cylinderGeometry args={[0.85, 1.0, 0.44, 10]} />
                    <meshStandardMaterial color="#39415a" roughness={0.85} />
                </mesh>
                <mesh ref={gem} castShadow position={[0, 1.15, 0]}>
                    <octahedronGeometry args={[0.62]} />
                    <meshStandardMaterial color={TEAM_COLOR[team]} emissive={TEAM_COLOR[team]} emissiveIntensity={1.1} roughness={0.25} />
                </mesh>
                <mesh ref={shield} position={[0, 1.1, 0]}>
                    <sphereGeometry args={[1.05, 18, 14]} />
                    <meshBasicMaterial color={TEAM_SOFT[team]} transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} />
                </mesh>
                <Html position={[0, 2.45, 0]} center distanceFactor={12} pointerEvents="none" zIndexRange={[8, 0]}>
                    <div style={{ textAlign: "center", font: "800 10px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
                        <div ref={label} style={{ color: TEAM_SOFT[team], textShadow: "0 1px 3px #000", marginBottom: 1 }}>🔮 Ward Seal</div>
                        <div style={{ position: "relative", width: 70, height: 6, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: TEAM_COLOR[team] }} />
                        </div>
                    </div>
                </Html>
            </group>
        </group>
    );
}

// ── The Gate Warden + Lesser Wardens (billboards, snapshot-driven) ───────────
/** A static art GLB (fal image-to-3D), normalized to stand on the floor at a
 * target height. Used for the Gate Warden (generated from his own artwork). */
function WfArtGlb({ url, targetH, color = "#ffffff", emissive = "#9a9a9a", emissiveIntensity = 0.38 }: {
    url: string;
    targetH: number;
    color?: string;
    emissive?: string;
    emissiveIntensity?: number;
}) {
    const { scene } = useGLTF(url);
    const prepared = useMemo(() => {
        const c = scene.clone(true);
        const box = new THREE.Box3().setFromObject(c);
        const size = new THREE.Vector3();
        box.getSize(size);
        const scale = targetH / Math.max(0.001, size.y);
        const center = new THREE.Vector3();
        box.getCenter(center);
        c.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        c.scale.setScalar(scale);
        c.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            // fal GLBs arrive with dim PBR settings — rebuild the material around
            // the baked albedo and lift shadows with a soft self-illumination so
            // the art reads under the valley's moody lighting.
            const orig = mesh.material as THREE.MeshStandardMaterial;
            const map = orig && orig.map ? orig.map : null;
            const nm = new THREE.MeshStandardMaterial({
                map,
                color,
                roughness: 0.8,
                metalness: 0.05,
            });
            if (map) {
                map.colorSpace = THREE.SRGBColorSpace;
                nm.emissive = new THREE.Color(emissive);
                nm.emissiveMap = map;
                nm.emissiveIntensity = emissiveIntensity;
            }
            mesh.material = nm;
            mesh.castShadow = true;
        });
        const holder = new THREE.Group();
        holder.add(c);
        return holder;
    }, [scene, targetH, color, emissive, emissiveIntensity]);
    useEffect(() => () => {
        prepared.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh) return;
            // The cloned scene shares cached geometry/albedo textures, but each
            // WfArtGlb creates its own lifted presentation material.
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of materials) material.dispose();
        });
    }, [prepared]);
    return <primitive object={prepared} />;
}

type WardenRigClip = "GW_Idle" | "GW_Walk" | "GW_Windup" | "GW_Slam" | "GW_Hit";
type WardenRigMotion = { clip: WardenRigClip; nonce: number; speed: number; playbackRate: number };

class WfAssetErrorBoundary extends Component<
    { children: ReactNode; fallback: ReactNode; label: string },
    { failed: boolean }
> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.warn(`[Warfront] ${this.props.label} could not load; using the safe fallback.`, error.message, info.componentStack);
    }

    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

function WfWardenBillboard({ height }: { height: number }) {
    return (
        <Billboard lockX lockZ>
            <mesh position={[0, height * 0.5, 0]}>
                <planeGeometry args={[height, height]} />
                <meshBasicMaterial map={wardenTex("idle")} transparent alphaTest={0.03} depthWrite={false} toneMapped={false} />
            </mesh>
        </Billboard>
    );
}

function WfWardenModelOrFallback({ motionRef, targetH }: {
    motionRef: MutableRefObject<WardenRigMotion>;
    targetH: number;
}) {
    return (
        <WfAssetErrorBoundary
            label="Gate Warden rig"
            fallback={<WfWardenBillboard height={targetH} />}
        >
            <Suspense fallback={<WfWardenBillboard height={targetH} />}>
                <WfRiggedWardenModel motionRef={motionRef} targetH={targetH} />
            </Suspense>
        </WfAssetErrorBoundary>
    );
}

/** Gate Warden-specific skinned renderer. The GLB owns the limb animation;
 * Warfront only selects and blends clips from the current simulation state. */
function WfRiggedWardenModel({ motionRef, targetH }: {
    motionRef: MutableRefObject<WardenRigMotion>;
    targetH: number;
}) {
    const { scene, animations } = useGLTF(GATE_WARDEN_GLB);
    const prepared = useMemo(() => {
        const clone = cloneSkeleton(scene) as THREE.Group;
        const box = new THREE.Box3().setFromObject(clone);
        const size = box.getSize(new THREE.Vector3());
        const scale = targetH / Math.max(0.001, size.y);
        const center = box.getCenter(new THREE.Vector3());
        clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        clone.scale.setScalar(scale);
        clone.traverse((node) => {
            const mesh = node as THREE.SkinnedMesh;
            if (!mesh.isMesh) return;
            const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const materials = sourceMaterials.map((sourceMaterial) => {
                const original = sourceMaterial as THREE.MeshStandardMaterial;
                const map = original.map ?? null;
                if (map) map.colorSpace = THREE.SRGBColorSpace;
                const material = new THREE.MeshStandardMaterial({
                    map,
                    color: "#e9d5ff",
                    roughness: 0.78,
                    metalness: 0.05,
                });
                if (map) {
                    material.emissive = new THREE.Color("#6d28d9");
                    material.emissiveMap = map;
                    material.emissiveIntensity = 0.58;
                }
                return material;
            });
            mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
            mesh.castShadow = true;
            mesh.frustumCulled = false;
        });
        return clone;
    }, [scene, targetH]);
    const mixer = useMemo(() => new THREE.AnimationMixer(prepared), [prepared]);
    const actions = useMemo(() => {
        const result = new Map<WardenRigClip, THREE.AnimationAction>();
        for (const clip of animations) {
            if (!clip.name.startsWith("GW_")) continue;
            result.set(clip.name as WardenRigClip, mixer.clipAction(clip, prepared));
        }
        return result;
    }, [animations, mixer, prepared]);
    const active = useRef<{ clip: WardenRigClip | null; nonce: number; action: THREE.AnimationAction | null }>({
        clip: null,
        nonce: -1,
        action: null,
    });
    useEffect(() => () => {
        mixer.stopAllAction();
        mixer.uncacheRoot(prepared);
        prepared.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh) return;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of materials) material.dispose();
        });
    }, [mixer, prepared]);
    useFrame((_state, delta) => {
        const desired = motionRef.current;
        const previous = active.current;
        if (previous.clip !== desired.clip || previous.nonce !== desired.nonce) {
            const next = actions.get(desired.clip);
            if (next) {
                const looping = desired.clip === "GW_Idle" || desired.clip === "GW_Walk";
                next.enabled = true;
                next.clampWhenFinished = !looping;
                next.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
                next.reset();
                next.setEffectiveWeight(1);
                next.setEffectiveTimeScale((desired.clip === "GW_Walk" ? desired.speed : 1) * desired.playbackRate);
                next.play();
                if (previous.action && previous.action !== next) next.crossFadeFrom(previous.action, 0.1, true);
                active.current = { clip: desired.clip, nonce: desired.nonce, action: next };
            }
        } else if (previous.action) {
            previous.action.setEffectiveTimeScale(
                (desired.clip === "GW_Walk" ? desired.speed : 1) * desired.playbackRate,
            );
        }
        mixer.update(Math.min(delta, 0.05));
    });
    return <primitive object={prepared} />;
}

function WfWarden({ result, clock }: { result: WarfrontResult; clock: WfClockRef }) {
    const root = useRef<THREE.Group>(null);
    const hpWrap = useRef<HTMLDivElement>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const phaseLabel = useRef<HTMLSpanElement>(null);
    const body = useRef<THREE.Group>(null);
    const aura = useRef<THREE.MeshBasicMaterial>(null);
    const slamTelegraph = useRef<THREE.Mesh>(null);
    const slamTelegraphMat = useRef<THREE.MeshBasicMaterial>(null);
    const smX = useRef(0), smZ = useRef(0);
    const heading = useRef(0);
    const gait = useRef(0);
    const prevWinding = useRef(false);
    const slamAt = useRef(-10);
    const prevHp = useRef(Number.POSITIVE_INFINITY);
    const hitAt = useRef(-10);
    const rigMotion = useRef<WardenRigMotion>({ clip: "GW_Idle", nonce: 0, speed: 1, playbackRate: 1 });
    const H = 2.45;
    useFrame((_state, delta) => {
        const { s0, s1, f: bf } = lerpFrameAt(result, clock);
        const w = s1.warden;         // discrete state (alive/winding/faceX)
        const w0 = s0.warden;
        const now = wfClockSeconds(clock);
        const jump = (w.x - w0.x) ** 2 + (w.y - w0.y) ** 2 > 9;
        const tx = jump ? w.x : lerp(w0.x, w.x, bf), tz = jump ? w.y : lerp(w0.y, w.y, bf);
        smX.current = tx;
        smZ.current = tz;
        if (root.current) {
            root.current.visible = w.alive;
            const vx = jump ? 0 : w.x - w0.x;
            const vz = jump ? 0 : w.y - w0.y;
            const travel = Math.hypot(vx, vz);
            const ups = travel * WARFRONT_TPS;
            const moving = w.active && ups > 0.18;
            if (moving && travel > 1e-5) {
                heading.current = approachAngle(heading.current, Math.atan2(vx, vz), 0.16, delta);
            } else if (Math.abs(w.faceX) > 0.1) {
                heading.current = approachAngle(heading.current, w.faceX < 0 ? -Math.PI / 2 : Math.PI / 2, 0.09, delta);
            }
            gait.current += delta * clock.current.rate * (moving ? 3.2 + Math.min(5, ups) * 1.15 : 1.15);
            if (prevWinding.current && !w.winding) slamAt.current = now;
            prevWinding.current = w.winding;
            if (w.hp < prevHp.current - 0.5) hitAt.current = now;
            prevHp.current = w.hp;
            const slamP = Math.max(0, Math.min(1, (now - slamAt.current) / 0.52));
            const slamArc = slamP < 1 ? Math.sin(slamP * Math.PI) : 0;
            const hitP = Math.max(0, Math.min(1, (now - hitAt.current) / 0.32));
            const bob = moving && w.alive ? Math.abs(Math.sin(gait.current)) * 0.028 : Math.sin(now * 1.7) * 0.008;
            root.current.position.set(smX.current, Math.max(-0.12, bob - slamArc * 0.11), smZ.current);
            let rigClip: WardenRigClip = moving ? "GW_Walk" : "GW_Idle";
            if (w.active && w.winding) rigClip = "GW_Windup";
            if (slamP < 1) rigClip = "GW_Slam";
            else if (hitP < 1) rigClip = "GW_Hit";
            if (rigMotion.current.clip !== rigClip) {
                rigMotion.current.clip = rigClip;
                rigMotion.current.nonce++;
            }
            rigMotion.current.speed = Math.max(0.7, Math.min(1.8, 0.72 + ups * 0.11));
            rigMotion.current.playbackRate = clock.current.playing ? clock.current.rate : 0;
            if (body.current) {
                // The skeleton owns the limbs. This outer controller only handles
                // steering and a restrained center-of-mass layer.
                body.current.rotation.y = heading.current;
                const breathe = Math.sin(now * 1.7) * 0.004;
                const stride = moving ? Math.sin(gait.current) : 0;
                const targetY = 1 + breathe;
                const targetXZ = 1 - breathe * 0.35;
                body.current.scale.y = approach(body.current.scale.y, targetY, 0.17, delta);
                body.current.scale.x = approach(body.current.scale.x, targetXZ, 0.17, delta);
                body.current.scale.z = approach(body.current.scale.z, targetXZ, 0.17, delta);
                body.current.rotation.x = approach(body.current.rotation.x, moving ? 0.025 : 0, 0.16, delta);
                body.current.rotation.z = approach(
                    body.current.rotation.z,
                    moving ? stride * 0.012 : 0,
                    0.14,
                    delta,
                );
            }
            if (aura.current) {
                aura.current.opacity = w.active
                    ? 0.32 + Math.abs(Math.sin(now * 2.4)) * 0.12 + (w.winding ? 0.18 : 0) + slamArc * 0.24
                    : 0.09 + Math.abs(Math.sin(now * 0.8)) * 0.025;
                aura.current.color.set(w.active ? (w.phase === 3 ? "#fb7185" : w.phase === 2 ? "#c084fc" : "#9333ea") : "#64748b");
            }
            if (slamTelegraph.current) {
                slamTelegraph.current.visible = w.winding;
                const radius = Math.max(1, w.slamRadius);
                slamTelegraph.current.scale.set(radius, radius, 1);
            }
            if (slamTelegraphMat.current) {
                slamTelegraphMat.current.color.set(w.phase === 3 ? "#fb7185" : w.phase === 2 ? "#e879f9" : "#c084fc");
                slamTelegraphMat.current.opacity = w.winding ? 0.22 + Math.abs(Math.sin(now * 9)) * 0.22 : 0;
            }
        }
        if (hpWrap.current) hpWrap.current.style.opacity = w.alive ? (w.active ? "1" : "0.7") : "0";
        if (hpFill.current) {
            hpFill.current.style.width = `${Math.max(0, Math.min(100, (w.hp / w.maxHp) * 100))}%`;
            hpFill.current.style.background = w.phase === 3 ? "#fb7185" : w.phase === 2 ? "#e879f9" : "#a78bfa";
        }
        if (phaseLabel.current) phaseLabel.current.textContent = w.active ? `PHASE ${["I", "II", "III"][w.phase - 1]}` : "DORMANT · SEALED UNTIL WAR";
    });
    return (
        <group ref={root} visible={false}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]} renderOrder={1}>
                <circleGeometry args={[1.62, 36]} />
                <meshBasicMaterial
                    ref={aura}
                    map={radialTexture3d()}
                    color="#9333ea"
                    transparent
                    opacity={0.4}
                    depthWrite={false}
                    toneMapped={false}
                    blending={THREE.AdditiveBlending}
                />
            </mesh>
            <mesh ref={slamTelegraph} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.055, 0]} visible={false} renderOrder={2}>
                <ringGeometry args={[0.78, 1, 56]} />
                <meshBasicMaterial
                    ref={slamTelegraphMat}
                    color="#c084fc"
                    transparent
                    opacity={0}
                    depthWrite={false}
                    toneMapped={false}
                    blending={THREE.AdditiveBlending}
                />
            </mesh>
            <group ref={body}>
                <WfWardenModelOrFallback motionRef={rigMotion} targetH={H} />
            </group>
            <Html position={[0, H + 0.4, 0]} center pointerEvents="none" distanceFactor={12} zIndexRange={[8, 0]}>
                <div ref={hpWrap} style={{ textAlign: "center", font: "800 10px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
                    <div style={{ color: "#c084fc", textShadow: "0 1px 3px #000", marginBottom: 2 }}>
                        ⛰ Gate Warden · <span ref={phaseLabel}>PHASE I</span>
                    </div>
                    <div style={{ position: "relative", width: 110, height: 6, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                        <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: "#a78bfa" }} />
                    </div>
                </div>
            </Html>
        </group>
    );
}

function WfMini({ result, clock, idx, name, glow }: { result: WarfrontResult; clock: WfClockRef; idx: number; name: string; glow: string }) {
    const root = useRef<THREE.Group>(null);
    const hpWrap = useRef<HTMLDivElement>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const allyRing = useRef<THREE.Mesh>(null);
    const allyMat = useRef<THREE.MeshBasicMaterial>(null);
    const awakeRing = useRef<THREE.Mesh>(null);
    // Each camp keeps a distinct LEGENDARY body with an element recolor:
    // Ancient Golem/Earth, Crystal Behemoth/Water, Void Stalker/Shadow, Rift Devourer/Fire.
    const CAMP_BOSS: ReadonlyArray<{ id: string; el: string }> = [
        { id: "legendary-2", el: "Earth" }, { id: "legendary-6", el: "Water" },
        { id: "legendary-10", el: "Shadow" }, { id: "legendary-14", el: "Fire" },
    ];
    const camp = CAMP_BOSS[idx % 4];
    const config = useMemo(() => petCombatModel({ id: camp.id } as Pet), [camp.id]);
    const frameRef = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const H = 2.1;
    const scale = config ? H / Math.max(0.001, config.targetHeight) : 1;
    const renderMotion = useRef<WarfrontMotionFilterState>(createWarfrontMotionFilter());
    const smSpd = useRef(0);
    const lastTick = useRef(-1);
    const wasMoving = useRef(false);
    const wasAlive = useRef(false);
    const [aliveUi, setAliveUi] = useState(false);
    useFrame((_state, delta) => {
        const { s0, s1, f: bf } = lerpFrameAt(result, clock);
        const m = s1.minis[idx];
        const m0 = s0.minis[idx];
        if (!m) return;
        if (m.alive !== aliveUi) setAliveUi(m.alive);   // unmount the rig while the camp is empty
        const jump = !!m0 && ((m.x - m0.x) ** 2 + (m.y - m0.y) ** 2 > 9);
        const tx = m0 && !jump ? lerp(m0.x, m.x, bf) : m.x;
        const tz = m0 && !jump ? lerp(m0.y, m.y, bf) : m.y;
        const fresh = m.alive && !wasAlive.current;   // just (re)spawned → snap onto its pad
        wasAlive.current = m.alive;
        const tick = wfClockTick(clock);
        const rewound = tick < lastTick.current;
        lastTick.current = tick;
        const motion = advanceWarfrontMotionFilter(renderMotion.current, tx, tz, delta, fresh || jump || rewound);
        const filteredSpeed = warfrontMotionFilterSpeed(motion);
        smSpd.current = approach(smSpd.current, fresh || !m.alive ? 0 : filteredSpeed, 0.2, delta);
        const moving = m.alive && !fresh && (wasMoving.current ? smSpd.current > 0.24 : smSpd.current > 0.65);
        wasMoving.current = moving;
        const f = frameRef.current;
        // A planted camp boss strikes only when the simulation actually attacks.
        const seconds = wfClockSeconds(clock);
        const attackPhase = m.attackPhase >= 0
            ? (m0 && m0.attackPhase >= 0 ? lerp(m0.attackPhase, m.attackPhase, bf) : m.attackPhase)
            : -1;
        const strikePulse = attackPhase >= 0 ? Math.sin(Math.PI * Math.min(1, attackPhase)) : 0;
        const striking = m.alive && attackPhase >= 0;
        f.motion = moving ? "run" : striking ? "strike" : "idle";
        f.moving = moving;
        f.speed = Math.min(6, smSpd.current);
        if (moving && filteredSpeed > 1e-6) {
            f.moveX = motion.vx / filteredSpeed;
            f.moveZ = motion.vz / filteredSpeed;
            f.faceX = f.moveX;
            f.faceZ = f.moveZ;
        }
        else { f.faceX = m.faceX; f.faceZ = 0.001; f.moveX = m.faceX; f.moveZ = 0.001; }
        f.timeline = seconds;
        const lunge = strikePulse * 0.14;
        if (root.current) {
            root.current.visible = m.alive;
            root.current.position.set(motion.x + f.faceX * lunge, 0, motion.z + f.faceZ * lunge);
        }
        f.desperate = m.alive && m.hp / Math.max(1, m.maxHp) < 0.4;
        if (hpWrap.current) hpWrap.current.style.opacity = m.alive ? "1" : "0";
        if (hpFill.current) { hpFill.current.style.width = `${Math.max(0, Math.min(100, (m.hp / m.maxHp) * 100))}%`; hpFill.current.style.background = m.ally ? TEAM_COLOR[m.ally] : "#c084fc"; }
        // Recruited → a team-colored ground ring marks it as fighting for a side.
        if (allyRing.current) { allyRing.current.visible = m.alive && !!m.ally; if (m.ally && allyMat.current) allyMat.current.color.set(TEAM_COLOR[m.ally]); }
        // AWAKENED (the Sigil appointment) → a pulsing gold ring under the boss.
        if (awakeRing.current) {
            const on = m.alive && !m.ally && m.awake;
            awakeRing.current.visible = on;
            if (on) awakeRing.current.scale.setScalar(1 + 0.12 * Math.sin(seconds * 5));
        }
    });
    if (!config) return null;
    return (
        <group ref={root} visible={false}>
            {aliveUi && <Suspense fallback={(
                <mesh position={[0, 0.9, 0]}>
                    <sphereGeometry args={[0.8, 12, 10]} />
                    <meshStandardMaterial color="#171126" emissive={glow} emissiveIntensity={0.5} roughness={0.6} />
                </mesh>
            )}>
                <group scale={scale}>
                    <PetModel3D config={config} frame={frameRef} element={camp.el} />
                </group>
            </Suspense>}
            <Html position={[0, H + 0.6, 0]} center pointerEvents="none" distanceFactor={11} zIndexRange={[7, 0]}>
                <div ref={hpWrap} style={{ textAlign: "center", font: "800 9px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
                    <div style={{ color: "#d8b4fe", textShadow: "0 1px 3px #000", marginBottom: 1 }}>👹 {name}</div>
                    <div style={{ position: "relative", width: 60, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                        <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: "#c084fc" }} />
                    </div>
                </div>
            </Html>
            <mesh ref={allyRing} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} renderOrder={-1}>
                <ringGeometry args={[1.15, 1.6, 28]} />
                <meshBasicMaterial ref={allyMat} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            <mesh ref={awakeRing} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} renderOrder={-1}>
                <ringGeometry args={[1.35, 1.85, 28]} />
                <meshBasicMaterial color="#fde047" transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
        </group>
    );
}

// ── Lane SENTINELS — recolored MYTHIC pets on turret duty (Unite-style) ──────
function WfGuardian({ result, clock, team, idx }: { result: WarfrontResult; clock: WfClockRef; team: Team; idx: number }) {
    const root = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const rubble = useRef<THREE.Group>(null);
    const hpWrap = useRef<HTMLDivElement>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const status = useRef<HTMLDivElement>(null);
    const rallyRing = useRef<THREE.Mesh>(null);
    const rallyMat = useRef<THREE.MeshBasicMaterial>(null);
    const frame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const prevHp = useRef(Number.POSITIVE_INFINITY);
    const hitAt = useRef(-10);
    // Two distinct mythic bodies per team (top / bottom lane) with team recolors.
    const config = useMemo(() => petCombatModel({ id: idx === 0 ? "mythic-0" : "mythic-2" } as Pet), [idx]);
    const first = result.snapshots.at(0)!.guardians[team][idx];
    const H = 1.75;
    const scale = config ? H / Math.max(0.001, config.targetHeight) : 1;
    useFrame((_state, delta) => {
        const g = snapAt(result, clock).guardians[team][idx];
        if (!g) return;
        if (root.current) {
            root.current.visible = g.alive;
            root.current.position.set(g.x, 0, g.y);
        }
        if (rubble.current) rubble.current.visible = !g.alive;
        const f = frame.current;
        const now = wfClockSeconds(clock);
        if (g.hp < prevHp.current - 0.5) hitAt.current = now;
        prevHp.current = g.hp;
        const hitAge = Math.max(0, now - hitAt.current);
        const hit = hitAge < 0.34 ? Math.sin((hitAge / 0.34) * Math.PI) : 0;
        const attackPhase = g.attackPhase;
        const firing = g.alive && attackPhase >= 0;
        const strikePulse = firing ? Math.sin(Math.PI * Math.min(1, attackPhase)) : 0;
        f.motion = hit > 0.03 ? "stagger" : firing ? "strike" : "idle";
        f.hit = hit;
        f.faceX = g.faceX; f.faceZ = 0.001;
        f.moveX = g.faceX; f.moveZ = 0.001;
        f.desperate = g.alive && g.hp / g.maxHp < 0.35;
        f.timeline = now;
        if (body.current) {
            const targetScale = scale * (1 + strikePulse * 0.025 - hit * 0.018);
            body.current.scale.x = approach(body.current.scale.x, targetScale, 0.2, delta);
            body.current.scale.y = approach(body.current.scale.y, scale * (1 - strikePulse * 0.035 + hit * 0.02), 0.2, delta);
            body.current.scale.z = approach(body.current.scale.z, targetScale, 0.2, delta);
            body.current.position.y = approach(body.current.position.y, firing ? 0.035 : 0, 0.18, delta);
        }
        const rallying = g.alive && g.rallySecs > 0;
        if (rallyRing.current) {
            rallyRing.current.visible = rallying;
            const pulse = 1 + Math.sin(now * 5 + idx) * 0.08;
            rallyRing.current.scale.setScalar(pulse);
        }
        if (rallyMat.current) rallyMat.current.opacity = rallying ? 0.38 + Math.sin(now * 5 + idx) * 0.12 : 0;
        if (hpWrap.current) hpWrap.current.style.opacity = g.alive ? "1" : "0";
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, (g.hp / g.maxHp) * 100))}%`;
        if (status.current) {
            status.current.textContent = rallying
                ? `⚡ Lane Sentinel · OVERCHARGED ${Math.ceil(g.rallySecs)}s`
                : "🛡 Lane Sentinel";
            status.current.style.color = rallying ? "#fde68a" : TEAM_SOFT[team];
        }
    });
    if (!config) return null;
    return (
        <>
        <group ref={root} visible={false}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} renderOrder={-1}>
                <ringGeometry args={[1.0, 1.3, 40]} />
                <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={0.38} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh ref={rallyRing} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]} renderOrder={-1}>
                <ringGeometry args={[1.45, 2.05, 48]} />
                <meshBasicMaterial ref={rallyMat} color="#fde047" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            <Suspense fallback={(
                <mesh position={[0, 0.85, 0]}>
                    <capsuleGeometry args={[0.4, 0.9, 4, 10]} />
                    <meshStandardMaterial color={TEAM_COLOR[team]} emissive={TEAM_COLOR[team]} emissiveIntensity={0.5} />
                </mesh>
            )}>
                <group ref={body} scale={scale}>
                    <PetModel3D config={config} frame={frame} element={team === "blue" ? "Water" : "Fire"} />
                </group>
            </Suspense>
            <Html position={[0, H + 0.55, 0]} center pointerEvents="none" distanceFactor={11} zIndexRange={[7, 0]}>
                <div ref={hpWrap} style={{ textAlign: "center", font: "800 9px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
                    <div ref={status} style={{ color: TEAM_SOFT[team], textShadow: "0 1px 3px #000", marginBottom: 1 }}>🛡 Lane Sentinel</div>
                    <div style={{ position: "relative", width: 64, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                        <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: TEAM_COLOR[team] }} />
                    </div>
                </div>
            </Html>
        </group>
        {/* Fallen-post rubble — a sibling, since the root hides when dead. */}
        <group ref={rubble} visible={false} position={[first.x, 0, first.y]}>
            <mesh position={[0.28, 0.14, 0.06]} rotation={[0.5, 0.7, 0.1]}>
                <dodecahedronGeometry args={[0.28]} />
                <meshStandardMaterial color="#525764" roughness={0.95} />
            </mesh>
            <mesh position={[-0.28, 0.1, -0.2]} rotation={[0.1, 0.4, 0.8]}>
                <dodecahedronGeometry args={[0.2]} />
                <meshStandardMaterial color="#41465a" roughness={0.95} />
            </mesh>
        </group>
        </>
    );
}

// ── Camera + clock ───────────────────────────────────────────────────────────
const WF_CAM_MAX_SPAN = 22;   // hard cap: the broadcast NEVER frames the whole valley
// All lane polyline points, flattened — the quiet-map fallback leans toward
// the nearest road so idle moments frame painted stone, not treetops.
const WF_ROAD_PTS: ReadonlyArray<readonly [number, number]> = [...WF_LANES.n, ...WF_LANES.m, ...WF_LANES.s];
/** Frame the BEST CLUSTER of action — never the global centroid. Averaging two
 * far-apart fights used to aim the camera at the empty jungle between them
 * with both fights clipped at the frame edges. `px/pz` = current camera focus,
 * used as a tie-break so near-equal clusters do not flip-flop the shot. */
function wfCameraFocus(snap: WfSnapshot, px = 0, pz = 0, preferredTeam: Team = "blue"): { fx: number; fz: number; span: number } {
    const frame = (pts: Array<[number, number]>, wts?: number[]): { fx: number; fz: number; span: number } => {
        let bi = 0, bs = -1;
        for (let i = 0; i < pts.length; i++) {
            let s = 0;
            for (let j = 0; j < pts.length; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 9) s += wts ? wts[j] : 1;
            if (Math.hypot(pts[i][0] - px, pts[i][1] - pz) < 12) s += 0.75;   // shot stability
            if (s > bs) { bs = s; bi = i; }
        }
        const members = pts.filter((q) => Math.hypot(pts[bi][0] - q[0], pts[bi][1] - q[1]) < 9);
        let mx = 0, mz = 0;
        for (const [x, z] of members) { mx += x; mz += z; }
        mx /= members.length; mz /= members.length;
        let spread = 0;
        for (const [x, z] of members) { const d = Math.hypot(x - mx, z - mz); if (d > spread) spread = d; }
        return { fx: mx, fz: mz, span: Math.min(WF_CAM_MAX_SPAN, Math.max(12, spread * 2 + 9)) };
    };
    // A contested Warden is ALWAYS the shot — centered between the pit and his
    // attackers so the boss fight never hugs a frame corner.
    if (snap.warden.alive) {
        let n = 0, ax = 0, az = 0;
        for (const a of snap.actors) {
            if (a.state !== "respawning" && Math.hypot(a.x - snap.warden.x, a.y - snap.warden.y) < 6.5) { ax += a.x; az += a.y; n++; }
        }
        if (n) return { fx: (snap.warden.x + ax / n) / 2, fz: (snap.warden.y + az / n) / 2, span: 15 };
    }
    // 1) Pet-vs-pet engagements, WEIGHTED by urgency — a fight where someone is
    // about to die, or a base about to fall, wins the shot over a bigger but
    // lower-stakes brawl. The camera cuts to the money, not just the crowd.
    const fights: Array<[number, number]> = [];
    const fightW: number[] = [];
    for (const a of snap.actors) {
        if (a.team !== "blue" || a.state === "respawning") continue;
        for (const b of snap.actors) {
            if (b.team !== "red" || b.state === "respawning") continue;
            if (Math.hypot(a.x - b.x, a.y - b.y) < 7) {
                fights.push([(a.x + b.x) / 2, (a.y + b.y) / 2]);
                const low = Math.min(a.hp / Math.max(1, a.maxHp), b.hp / Math.max(1, b.maxHp));
                fightW.push(low < 0.3 ? 2.5 : 1);   // imminent kill = this is the shot
            }
        }
    }
    // A base under active siege (structure <45% with an enemy on it) is a money
    // moment — fold it in at high weight so the camera can catch the Seal fall.
    for (const team of ["blue", "red"] as const) {
        const foe: Team = team === "blue" ? "red" : "blue";
        const siege = (x: number, y: number, hp: number, mhp: number) => {
            if (hp / Math.max(1, mhp) >= 0.45) return;
            if (!snap.actors.some((a) => a.team === foe && a.state !== "respawning" && Math.hypot(a.x - x, a.y - y) < 4)) return;
            fights.push([x, y]); fightW.push(3);
        };
        for (const s of snap.structures[team].statues) if (s.alive) siege(s.x, s.y, s.hp, s.maxHp);
        const c = snap.structures[team].core;
        if (c.alive) siege(c.x, c.y, c.hp, c.maxHp);
    }
    if (fights.length) return frame(fights, fightW);
    // 2) Pets at WORK (on an enemy structure or wave — stable per-frame signal).
    const busy: Array<[number, number]> = [];
    for (const a of snap.actors) {
        if (a.state === "respawning") continue;
        const foe: Team = a.team === "blue" ? "red" : "blue";
        const fs = snap.structures[foe];
        const working = fs.statues.some((s) => s.alive && Math.hypot(s.x - a.x, s.y - a.y) < 4)
            || (fs.core.alive && Math.hypot(fs.core.x - a.x, fs.core.y - a.y) < 4)
            || snap.guardians[foe].some((g) => g.alive && Math.hypot(g.x - a.x, g.y - a.y) < 4.2)
            || snap.mobs.some((m) => m.side !== a.team && Math.hypot(m.x - a.x, m.y - a.y) < 3);
        if (working) busy.push([a.x, a.y]);
    }
    if (busy.length) return frame(busy);
    // A recruited boss becomes a broadcast subject once its escort meets
    // resistance or reaches a structure. Quiet travel remains in the tactical
    // convoy PiP so this does not monopolize the main camera for 50 seconds.
    for (const mini of snap.minis) {
        if (!mini.alive || !mini.ally || mini.siegeDowns > 0) continue;
        const foe: Team = mini.ally === "blue" ? "red" : "blue";
        const contested = snap.actors.some((actor) => actor.team === foe && actor.state !== "respawning" && Math.hypot(actor.x - mini.x, actor.y - mini.y) < 6);
        const atStructure = snap.guardians[foe].some((guard) => guard.alive && Math.hypot(guard.x - mini.x, guard.y - mini.y) < 7)
            || snap.structures[foe].statues.some((statue) => statue.alive && Math.hypot(statue.x - mini.x, statue.y - mini.y) < 7)
            || (snap.structures[foe].core.alive && Math.hypot(snap.structures[foe].core.x - mini.x, snap.structures[foe].core.y - mini.y) < 7);
        if (contested || atStructure) return { fx: mini.x, fz: mini.y, span: 14 };
    }
    // 3) The biggest minion clash.
    const clashes: Array<[number, number]> = [];
    for (const m of snap.mobs) {
        if (m.side === "red") continue;
        for (const o of snap.mobs) {
            if (o.side === m.side) continue;
            if (Math.hypot(m.x - o.x, m.y - o.y) < 3) { clashes.push([(m.x + o.x) / 2, (m.y + o.y) / 2]); break; }
        }
    }
    if (clashes.length) return frame(clashes);
    // 4) Truly quiet → ride with YOUR squad, leaned toward the nearest road.
    let n = 0, mx = 0, mz = 0;
    for (const a of snap.actors) { if (a.team === preferredTeam && a.state !== "respawning") { mx += a.x; mz += a.y; n++; } }
    if (!n) for (const a of snap.actors) { if (a.state !== "respawning") { mx += a.x; mz += a.y; n++; } }
    if (!n) return { fx: 0, fz: 0, span: 16 };
    mx /= n; mz /= n;
    let rx = mx, rz = mz, rd = Infinity;
    for (const [x, z] of WF_ROAD_PTS) { const d = Math.hypot(x - mx, z - mz); if (d < rd) { rd = d; rx = x; rz = z; } }
    return { fx: mx * 0.55 + rx * 0.45, fz: mz * 0.55 + rz * 0.45, span: 15 };
}

export type WfCamCtl = { mode: "follow" | "free"; fx: number; fz: number; dist: number };

function WfCameraRig({ result, clock, shake, camViewRef, camCtlRef, storyRef, modeRef, focusPetRef, focusMiniRef, localTeam, reducedMotion }: {
    result: WarfrontResult; clock: WfClockRef; shake: MutableRefObject<number>;
    camViewRef: MutableRefObject<{ x: number; z: number; half: number }>;
    camCtlRef: MutableRefObject<WfCamCtl>;
    storyRef: MutableRefObject<WfStoryCam | null>;
    modeRef: MutableRefObject<WfCamMode>;
    focusPetRef: MutableRefObject<string | null>;
    focusMiniRef: MutableRefObject<number | null>;
    localTeam: Team;
    reducedMotion: boolean;
}) {
    const sm = useRef({ fx: 0, fz: 0, d: 18, init: true });
    useFrame((state, delta) => {
        const s = sm.current;
        const ctl = camCtlRef.current;
        const replayStory = storyRef.current;
        const replayTick = wfClockTick(clock);
        const replayLocked = replayStory?.prio === 10 && replayTick >= replayStory.fromT && replayTick <= replayStory.untilT;
        if (ctl.mode === "free" && !replayLocked) {
            // Player-driven spectator cam — glide toward the requested view.
            const k = s.init ? 1 : 0.22;
            s.fx = approach(s.fx, ctl.fx, k, delta);
            s.fz = approach(s.fz, ctl.fz, k, delta);
            s.d = approach(s.d, ctl.dist, k, delta);
        } else {
            const mode = modeRef.current;
            let focus: { fx: number; fz: number; span: number } | null = null;
            let k0: number | null = null;
            const lockedPet = replayLocked ? null : focusPetRef.current;
            if (lockedPet) {
                const actor = snapAt(result, clock).actors.find((a) => a.id === lockedPet);
                if (actor) { focus = { fx: actor.x, fz: actor.y, span: 13 }; k0 = s.init ? 1 : 0.09; }
            }
            const lockedMini = replayLocked ? null : focusMiniRef.current;
            if (!lockedPet && lockedMini !== null) {
                const snap = snapAt(result, clock);
                const mini = snap.minis.find((candidate) => candidate.padIdx === lockedMini && candidate.alive && !!candidate.ally && candidate.siegeDowns === 0);
                if (mini) { focus = { fx: mini.x, fz: mini.y, span: 13 }; k0 = s.init ? 1 : 0.09; }
                else focusMiniRef.current = null;
            }
            if (focus === null) focus = ((): { fx: number; fz: number; span: number } => {
                if (mode === "team") {
                    const snap = snapAt(result, clock);
                    let n = 0, mx = 0, mz = 0;
                    for (const a of snap.actors) if (a.team === localTeam && a.state !== "respawning") { mx += a.x; mz += a.y; n++; }
                    if (!n) return wfCameraFocus(snap, s.fx, s.fz, localTeam);
                    mx /= n; mz /= n;
                    let spread = 0;
                    for (const a of snap.actors) {
                        if (a.team !== localTeam || a.state === "respawning") continue;
                        const d = Math.hypot(a.x - mx, a.y - mz);
                        if (d > spread) spread = d;
                    }
                    // Widen with the squad's spread so split lanes still show
                    // everyone instead of an empty centroid.
                    return { fx: mx, fz: mz, span: Math.min(26, Math.max(15, spread * 2 + 7)) };
                }
                const f0 = wfCameraFocus(snapAt(result, clock), s.fx, s.fz, localTeam);
                return mode === "calm" ? { fx: f0.fx, fz: f0.fz, span: Math.min(26, f0.span + 6) } : f0;
            })();
            let k = k0 ?? (s.init ? 1 : mode === "calm" ? 0.03 : 0.045);
            const story = storyRef.current;
            if (story) {
                const t = wfClockTick(clock);
                if (story.subject) {
                    const mini = snapAt(result, clock).minis.find((candidate) => candidate.padIdx === story.subject!.padIdx);
                    if (!mini || !mini.alive || mini.ally !== story.subject.team || mini.siegeDowns > story.subject.startDowns) storyRef.current = null;
                    else { story.x = mini.x; story.z = mini.y; }
                }
                if (storyRef.current && t <= story.untilT && t >= story.fromT) {
                    if (story.prio === 10 || (!lockedPet && lockedMini === null && (mode === "broadcast" || (mode === "calm" && story.prio >= 4)))) {
                        focus = { fx: story.x, fz: story.z, span: mode === "calm" && story.prio !== 10 ? story.span + 4 : story.span };
                        k = s.init ? 1 : 0.11;   // cut faster than the ambient drift
                    }
                } else if (t > story.untilT) storyRef.current = null;
            }
            // Keep the frame FULL of battlefield: bias edge fights toward the
            // map so the void beyond the rim never eats a third of the screen.
            // (North needs the most margin — the tilted camera shows far past
            // the focus on that side.)
            const fx2 = Math.max(-WF_X + focus.span * 0.42, Math.min(WF_X - focus.span * 0.42, focus.fx));
            const fz2 = Math.max(-WF_Y + focus.span * 0.5, Math.min(WF_Y - focus.span * 0.32, focus.fz));
            const aspect = state.size.width / Math.max(1, state.size.height);
            const targetD = Math.min(mode === "calm" ? 24 : 20, arenaCameraDist(focus.span, aspect));
            // A far-away story means a broadcast CUT (instant), never a long
            // swoosh across the whole valley — the pro-production rule.
            if (!s.init && Math.hypot(fx2 - s.fx, fz2 - s.fz) > 16) {
                s.fx = fx2; s.fz = fz2; s.d = targetD;
            } else {
                s.fx = approach(s.fx, fx2, k, delta);
                s.fz = approach(s.fz, fz2, k, delta);
                s.d = approach(s.d, targetD, k, delta);
            }
            ctl.fx = s.fx; ctl.fz = s.fz; ctl.dist = s.d;   // free-cam starts from here
        }
        s.init = false;
        camViewRef.current = { x: s.fx, z: s.fz, half: s.d * 0.62 };
        let ox = 0, oy = 0;
        const amp = reducedMotion ? 0 : shake.current;
        if (amp > 0.01) { ox = Math.sin(state.clock.elapsedTime * 92) * amp * 0.18; oy = Math.cos(state.clock.elapsedTime * 77) * amp * 0.13; }
        state.camera.position.set(s.fx + ox, Math.sin(WF_CAMERA_PITCH) * s.d + oy, s.fz + Math.cos(WF_CAMERA_PITCH) * s.d);
        state.camera.lookAt(s.fx + ox, 0, s.fz);
    });
    return null;
}

/** Drag-to-pan + wheel-zoom spectator controls on the canvas. Any interaction
 * switches to free-cam (the Follow chip returns to the broadcast). */
function WfCameraControls({ camCtlRef, onModeChange }: {
    camCtlRef: MutableRefObject<WfCamCtl>; onModeChange: (mode: "follow" | "free") => void;
}) {
    const gl = useThree((s) => s.gl);
    const sizeRef = useRef({ w: 1, h: 1 });
    useFrame((state) => { sizeRef.current = { w: state.size.width, h: state.size.height }; });
    useEffect(() => {
        const el = gl.domElement;
        let activePointer: number | null = null, lastX = 0, lastY = 0, moved = 0;
        const clampView = () => {
            const c = camCtlRef.current;
            c.fx = Math.max(-WF_X - 6, Math.min(WF_X + 6, c.fx));
            c.fz = Math.max(-WF_Y - 6, Math.min(WF_Y + 6, c.fz));
            c.dist = Math.max(9, Math.min(48, c.dist));
        };
        const down = (e: PointerEvent) => {
            if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
            activePointer = e.pointerId;
            moved = 0;
            lastX = e.clientX;
            lastY = e.clientY;
            el.setPointerCapture(e.pointerId);
        };
        const move = (e: PointerEvent) => {
            if (activePointer !== e.pointerId) return;
            const dx = e.clientX - lastX, dy = e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
            moved += Math.abs(dx) + Math.abs(dy);
            if (moved < 6) return;
            const c = camCtlRef.current;
            if (c.mode !== "free") { c.mode = "free"; onModeChange("free"); }
            // World units per CSS pixel at the current zoom.
            const worldPerPx = (2 * c.dist * Math.tan(((A3D_FOV / 2) * Math.PI) / 180) * (sizeRef.current.w / Math.max(1, sizeRef.current.h))) / Math.max(1, sizeRef.current.w);
            c.fx -= dx * worldPerPx;
            c.fz -= dy * worldPerPx / Math.sin(WF_CAMERA_PITCH);
            clampView();
        };
        const stop = (e: PointerEvent) => {
            if (activePointer !== e.pointerId) return;
            if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
            activePointer = null;
        };
        const lost = (e: PointerEvent) => {
            if (activePointer === e.pointerId) activePointer = null;
        };
        const wheel = (e: WheelEvent) => {
            e.preventDefault();
            const c = camCtlRef.current;
            if (c.mode !== "free") { c.mode = "free"; onModeChange("free"); }
            c.dist *= 1 + Math.sign(e.deltaY) * 0.09;
            clampView();
        };
        el.addEventListener("pointerdown", down);
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", stop);
        el.addEventListener("pointercancel", stop);
        el.addEventListener("lostpointercapture", lost);
        el.addEventListener("wheel", wheel, { passive: false });
        return () => {
            el.removeEventListener("pointerdown", down);
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", stop);
            el.removeEventListener("pointercancel", stop);
            el.removeEventListener("lostpointercapture", lost);
            el.removeEventListener("wheel", wheel);
        };
    }, [gl, camCtlRef, onModeChange]);
    return null;
}

function WfTicker({ result, clockRef, shakeRef, onFrontier, pumpRef, playbackRate, paceMode, replay }: {
    result: WarfrontResult; clockRef: WfClockRef; shakeRef: MutableRefObject<number>;
    onFrontier: MutableRefObject<() => void>;
    pumpRef: MutableRefObject<() => void>;
    playbackRate: number;
    paceMode: WarfrontPaceMode;
    replay: boolean;
}) {
    const smartCursor = useRef(0), smartLast = useRef(-1);
    useFrame((_s, delta) => {
        if (shakeRef.current > 0.01) shakeRef.current *= 0.85;
        // STREAM the sim: a couple of ms of ticks per frame keeps the frontier
        // ahead of the clock — the old synchronous 90 s chunk froze the main
        // thread for ~1 s at every council boundary.
        pumpRef.current();
        const frontier = warfrontSnapshotFrontier(result.snapshots);
        const c = clockRef.current;
        // Fast Refresh can preserve the pre-rate clock shape for one frame.
        // Recover defensively so a poisoned playback clock cannot fan out into
        // undefined snapshot lookups and crash every Three frame callback.
        if (!Number.isFinite(c.t)) c.t = 0;
        if (!Number.isFinite(c.rate)) c.rate = 1;
        if (!c.playing) return;
        // Hit-stop: kills briefly drop playback to quarter speed (pure
        // presentation — the recorded sim underneath is untouched).
        const now = Math.floor(c.t);
        if (now < smartLast.current) smartCursor.current = 0;
        smartLast.current = now;
        while (result.events[smartCursor.current]?.t < now - WARFRONT_TPS * 2) smartCursor.current++;
        let majorNearby = false;
        for (let i = smartCursor.current; i < result.events.length && result.events[i].t <= now + WARFRONT_TPS * 4; i++) {
            if (warfrontEventSalience(result.events[i]) >= 5) { majorNearby = true; break; }
        }
        const smartSnapshot = warfrontSnapshotAtTick(result.snapshots, now) ?? result.snapshots.at(0)!;
        const smartQuiet = !replay && paceMode === "smart" && warfrontSmartPaceIsQuiet(smartSnapshot, majorNearby);
        const selectedRate = replay ? 1 : paceMode === "smart" ? (smartQuiet ? 1.35 : 1) : Number(paceMode);
        const baseRate = replay ? 1 : playbackRate;
        const targetRate = (c.slow > 0 ? 0.28 : 1) * baseRate * selectedRate;
        if (!replay && paceMode === "smart" && majorNearby && c.slow <= 0) c.rate = Math.min(c.rate, baseRate);
        c.rate = approach(c.rate, targetRate, targetRate < c.rate ? 0.42 : 0.12, delta);
        if (c.slow > 0) c.slow = Math.max(0, c.slow - delta);
        c.t = Math.min(frontier, c.t + delta * c.rate * WARFRONT_TPS);
        if (c.t >= frontier) onFrontier.current();
    });
    return null;
}

// One story-aware chase feed replaces the old four-target camera wall. It uses
// one quarter of the render-target memory and updates a single coherent shot at
// broadcast cadence instead of four hard-to-read feeds at roughly 5 FPS each.
function WfStoryPip({ result, clock, petIds, selectedRef, storyRef, subjectRef, width, height, renderEvery, nameOf, labelRef, statusRef, hpRef }: {
    result: WarfrontResult; clock: WfClockRef; petIds: string[];
    selectedRef: MutableRefObject<string | null>; storyRef: MutableRefObject<WfStoryCam | null>; subjectRef: MutableRefObject<string | null>;
    width: number; height: number; renderEvery: number; nameOf: (id: string) => string;
    labelRef: MutableRefObject<HTMLSpanElement | null>; statusRef: MutableRefObject<HTMLSpanElement | null>; hpRef: MutableRefObject<HTMLElement | null>;
}) {
    type Rig = { target: THREE.WebGLRenderTarget; feed: THREE.PerspectiveCamera; scene: THREE.Scene; cam: THREE.OrthographicCamera; quad: THREE.Mesh; key: string };
    const rig = useRef<Rig | null>(null), frame = useRef(0), storySeen = useRef(-1), lastSnap = useRef<WfSnapshot | null>(null);
    const dispose = () => { const current = rig.current; if (!current) return; current.target.dispose(); current.quad.geometry.dispose(); (current.quad.material as THREE.Material).dispose(); rig.current = null; };
    useEffect(() => () => dispose(), []);
    useFrame(({ gl, scene, camera, size }) => {
        const n = frame.current++, dpr = gl.getPixelRatio(), key = `${width}/${height}/${dpr}`;
        gl.setScissorTest(false); gl.setViewport(0, 0, size.width, size.height); gl.autoClear = true; gl.render(scene, camera);
        if (rig.current?.key !== key) {
            dispose();
            const target = new THREE.WebGLRenderTarget(width * dpr, height * dpr), feed = new THREE.PerspectiveCamera(46, width / height, .4, 80);
            const overlay = new THREE.Scene(), cam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: target.texture }));
            overlay.add(quad); rig.current = { target, feed, scene: overlay, cam, quad, key };
        }
        const current = rig.current!, snap = snapAt(result, clock), index = wfSnapshotIndex(snap), selected = selectedRef.current;
        let actor = selected ? index.actorsById.get(selected) : undefined;
        const story = storyRef.current, storyActive = story && wfClockTick(clock) >= story.fromT && wfClockTick(clock) <= story.untilT;
        if (!actor && storyActive && storySeen.current !== story.fromT) {
            actor = petIds.map((id) => index.actorsById.get(id)).filter((item): item is WfActorSnap => !!item && item.state !== "respawning")
                .sort((a, b) => Math.hypot(a.x - story.x, a.y - story.z) - Math.hypot(b.x - story.x, b.y - story.z))[0];
            storySeen.current = story.fromT;
        }
        actor ??= subjectRef.current ? index.actorsById.get(subjectRef.current) : undefined;
        actor ??= petIds.map((id) => index.actorsById.get(id)).find((item) => item?.state !== "respawning") ?? index.actorsById.get(petIds[0]);
        if (actor) subjectRef.current = actor.id;
        if (actor && n % Math.max(1, renderEvery) === 0) {
            current.feed.position.set(actor.x, 6.8, actor.y + 4.6); current.feed.lookAt(actor.x, .6, actor.y);
            gl.setRenderTarget(current.target); gl.setClearColor("#05070f", 1); gl.clear(); gl.render(scene, current.feed); gl.setRenderTarget(null);
        }
        current.cam.right = size.width; current.cam.top = size.height; current.cam.updateProjectionMatrix();
        current.quad.position.set(10 + width / 2, 10 + height / 2, 0); current.quad.scale.set(width, height, 1);
        gl.autoClear = false; gl.render(current.scene, current.cam); gl.autoClear = true;
        if (actor && snap !== lastSnap.current) {
            lastSnap.current = snap;
            if (labelRef.current) labelRef.current.textContent = nameOf(actor.id);
            if (statusRef.current) statusRef.current.textContent = actor.state === "respawning" ? `↻ ${actor.respawnSecs}s` : actor.intent.split(":").at(-1)?.toUpperCase() ?? "";
            if (hpRef.current) { const share = actor.hp / actor.maxHp; hpRef.current.style.width = `${100 * share}%`; hpRef.current.style.background = warfrontPipHealthColor(actor.team, share); }
        }
    }, 1);
    return null;
}

// Broadcast colors for the elemental signature moves.
function WfDirector({ result, clockRef, seekRef, reducedMotion, nameOf, pushFeed, pushBanner, triggerFlash, shakeRef, spawnFx, spawnShot, spawnFloater, storyRef, onEnd }: {
    result: WarfrontResult; clockRef: WfClockRef; nameOf: (id: string) => string;
    seekRef: MutableRefObject<WfDirectorSeek>; reducedMotion: boolean;
    pushFeed: (text: string, color: string) => void;
    pushBanner: (text: string, color: string, big?: boolean) => void;
    triggerFlash: (color: string) => void; shakeRef: MutableRefObject<number>;
    spawnFx: (x: number, z: number, key: string | null, element: string | null | undefined, scale: number, dur: number) => void;
    spawnShot: (fromX: number, fromY: number, toX: number, toY: number, element: string | null | undefined, charged: boolean) => void;
    spawnFloater: (x: number, z: number, text: string, color: string, big: boolean) => void;
    storyRef: MutableRefObject<WfStoryCam | null>; onEnd: () => void;
}) {
    const last = useRef(-1), cursor = useRef(0), ended = useRef(false), activeResult = useRef(result), seenSeek = useRef(seekRef.current.generation);
    const preRolled = useRef(new Set<number>()), convoyImpact = useRef(new Set<number>());
    const featured = useRef(new Map<string, number>()), councilTicks = useRef(new Set<number>());
    const snapshotAtTick = (tick: number) => warfrontSnapshotAtTick(result.snapshots, tick) ?? result.snapshots.at(0)!;
    type CouncilPlan = { items: Array<{ petId: string; kind: Extract<WfEvent, { type: "buy" }>["kind"] }>; stance: WfStance; paid: boolean };
    const councilPlans = useRef<Record<Team, CouncilPlan | null>>({ blue: null, red: null });
    const hydrateCouncilPlans = (through: number): Record<Team, CouncilPlan | null> => {
        const plans: Record<Team, CouncilPlan | null> = { blue: null, red: null };
        for (let i = 0; i < result.events.length; i++) {
            const event = result.events[i];
            if (event.t > through) break;
            if (event.type === "round") {
                const buys: Record<Team, Array<Extract<WfEvent, { type: "buy" }>>> = { blue: [], red: [] };
                const stances: Partial<Record<Team, WfStance>> = {};
                for (let j = i + 1; j < result.events.length && result.events[j].t === event.t; j++) {
                    const order = result.events[j];
                    if (order.type === "buy") buys[order.team].push(order);
                    else if (order.type === "stance") stances[order.team] = order.stance;
                }
                const snap = snapshotAtTick(event.t);
                for (const team of ["blue", "red"] as const) plans[team] = {
                    items: buys[team].map((buy) => ({ petId: buy.petId, kind: buy.kind })),
                    stance: stances[team] ?? snap.stances[team],
                    paid: false,
                };
                continue;
            }
            let team: Team | null = null, actorId: string | null = null;
            if (event.type === "kill") { team = event.team; actorId = event.actorId; }
            else if (event.type === "shutdown") {
                actorId = event.actorId;
                team = snapshotAtTick(event.t).actors.find((actor) => actor.id === actorId)?.team ?? null;
            } else if (event.type === "statuedown" || event.type === "guardiandown" || event.type === "coredown") team = event.by;
            else if (event.type === "minikill" || event.type === "siegebreak" || event.type === "wardenkill") team = event.team;
            if (!team) continue;
            const plan = plans[team];
            if (plan && (!actorId || plan.items.some((item) => item.petId === actorId))) plan.paid = true;
        }
        return plans;
    };
    useFrame(() => {
        const now = Math.floor(wfClockTick(clockRef));
        if (activeResult.current !== result) {
            activeResult.current = result; cursor.current = 0; last.current = -1; ended.current = false;
            preRolled.current.clear(); convoyImpact.current.clear(); featured.current.clear(); councilTicks.current.clear(); councilPlans.current = { blue: null, red: null }; storyRef.current = null;
            seenSeek.current = seekRef.current.generation;
        }
        const seek = seekRef.current;
        if (seenSeek.current !== seek.generation) {
            seenSeek.current = seek.generation;
            cursor.current = result.events.findIndex((event) => event.t > seek.tick);
            if (cursor.current < 0) cursor.current = result.events.length;
            last.current = seek.tick;
            preRolled.current.clear(); convoyImpact.current.clear(); featured.current.clear(); councilTicks.current.clear();
            councilPlans.current = hydrateCouncilPlans(seek.tick);
            ended.current = false;
        }
        if (now < last.current) {
            const replayFocus = storyRef.current?.prio === 10 && now >= storyRef.current.fromT && now <= storyRef.current.untilT;
            cursor.current = result.events.findIndex((event) => event.t >= now);
            if (cursor.current < 0) cursor.current = result.events.length;
            last.current = now - 1; preRolled.current.clear(); convoyImpact.current.clear();
            featured.current.clear(); councilTicks.current.clear(); councilPlans.current = hydrateCouncilPlans(now - 1);
            if (!replayFocus) storyRef.current = null;
            ended.current = false;
        }
        const cut = (t: number, x: number, z: number, span: number, prio: number, secs: number, subject?: WfStoryCam["subject"], pre = 0) => {
            const active = storyRef.current;
            const replayLocked = active?.prio === 10 && now <= active.untilT;
            if (!replayLocked && (!active || now > active.untilT || prio > active.prio || (prio === active.prio && now - active.fromT > WARFRONT_TPS * 1.25))) storyRef.current = { x, z, span, prio, subject, fromT: t - pre * WARFRONT_TPS, untilT: t + secs * WARFRONT_TPS };
        };
        const feature = (key: string, t: number, cooldown: number) => {
            const previous = featured.current.get(key) ?? -Infinity;
            if (t - previous < cooldown * WARFRONT_TPS) return false;
            featured.current.set(key, t);
            return true;
        };
        const councilPayoff = (team: Team, actorId: string | null, moment: string) => {
            const plan = councilPlans.current[team];
            if (!plan || plan.paid) return;
            plan.paid = true;
            if (actorId) {
                const item = plan.items.find((buy) => buy.petId === actorId);
                if (!item) { plan.paid = false; return; }
                pushFeed(`COUNCIL PAYOFF · ${nameOf(item.petId)} +${item.kind.toUpperCase()} · ${moment}`, TEAM_SOFT[team]);
                return;
            }
            const stance = WF_STANCES.find((item) => item.id === plan.stance);
            pushFeed(`COUNCIL PAYOFF · ${stance?.icon ?? ""} ${stance?.label ?? "BALANCED"} PLAN · ${plan.items.length} UPGRADE${plan.items.length === 1 ? "" : "S"} · ${moment}`, TEAM_SOFT[team]);
        };
        const horizon = now + 4 * WARFRONT_TPS;
        for (let i = cursor.current; i < result.events.length; i++) {
            const event = result.events[i];
            if (event.t <= now) continue;
            if (event.t > horizon) break;
            if (preRolled.current.has(i)) continue;
            let focus: { x: number; y: number; span: number } | null = null;
            if (event.type === "sigilawake" || event.type === "siegebreak") focus = { x: event.x, y: event.y, span: 14 };
            else if (event.type === "wardenphase" || event.type === "wardenkill") focus = { x: WF_LAIR.x, y: WF_LAIR.y, span: 15 };
            else if (event.type === "gank" || event.type === "ultimate") focus = { x: event.x, y: event.y, span: 12 };
            else if (event.type === "techniqueused") {
                const mini = snapshotAtTick(event.t).minis.find((item) => item.padIdx === event.padIdx);
                if (mini) focus = { x: mini.x, y: mini.y, span: 12 };
            } else if (event.type === "counterstrikeclaim") {
                const target = snapshotAtTick(event.t).actors.find((item) => item.id === event.targetId);
                if (target) focus = { x: target.x, y: target.y, span: 12 };
            } else if (event.type === "counterstrike") {
                const eventSnap = snapshotAtTick(event.t);
                const target = event.targetId ? eventSnap?.actors.find((item) => item.id === event.targetId) : null;
                const statue = eventSnap?.structures[event.team].statues[event.statue];
                if (target ?? statue) focus = { x: (target ?? statue)!.x, y: (target ?? statue)!.y, span: 12 };
            }
            else if (event.type === "structhit" && event.mini !== undefined && !convoyImpact.current.has(event.mini)) {
                convoyImpact.current.add(event.mini); focus = { x: event.x, y: event.y, span: 13 };
            } else if (event.type === "minikill") {
                const mini = snapshotAtTick(event.t).minis.find((m) => m.padIdx === event.padIdx);
                if (mini) focus = { x: mini.x, y: mini.y, span: 13 };
            }
            if (focus) { preRolled.current.add(i); const salience = warfrontEventSalience(event); cut(event.t, focus.x, focus.y, focus.span, salience, 2.5, undefined, salience >= 5 ? 4 : 1.5); }
        }
        if (now > last.current) {
            let i = cursor.current;
            const through = warfrontEventCursorThroughTick(result.events, i, now);
            for (; i < through; i++) {
                const event = result.events[i];
                if (event.t <= last.current) continue;
                playWarfrontEventAudio(event);
                const snap = snapshotAtTick(event.t);
                const actor = (id: string) => snap.actors.find((item) => item.id === id);
                const color = (team: Team) => TEAM_SOFT[team];
                const salience = warfrontEventSalience(event);
                const hitStop = warfrontHitStopSeconds(event, reducedMotion);
                if (hitStop) clockRef.current.slow = Math.max(clockRef.current.slow, hitStop);
                const earnsKill = (petId: string) => {
                    for (let j = Math.max(0, i - 12); j < result.events.length; j++) {
                        const nearby = result.events[j];
                        if (nearby.t > event.t + WARFRONT_TPS) break;
                        if (nearby.t >= event.t - WARFRONT_TPS && nearby.type === "kill" && nearby.actorId === petId) return true;
                    }
                    return false;
                };
                if (event.type === "round") {
                    const buysBy: Record<Team, Array<Extract<WfEvent, { type: "buy" }>>> = { blue: [], red: [] };
                    const stanceBy: Partial<Record<Team, WfStance>> = {};
                    const packageBy: Partial<Record<Team, WfBuildPackage>> = {};
                    const orderBy: Partial<Record<Team, WfCoachOrder>> = {};
                    for (let j = i + 1; j < result.events.length && result.events[j].t === event.t; j++) {
                        const order = result.events[j];
                        if (order.type === "buy") buysBy[order.team].push(order);
                        else if (order.type === "stance") stanceBy[order.team] = order.stance;
                        else if (order.type === "buildpackage") packageBy[order.team] = order.choice;
                        else if (order.type === "coachorder") orderBy[order.team] = order.order;
                    }
                    councilTicks.current.add(event.t);
                    pushBanner(`WAR COUNCIL ${event.round} · ORDERS LOCKED`, "#c4b5fd");
                    for (const team of ["blue", "red"] as const) {
                        const buys = buysBy[team];
                        const stance = WF_STANCES.find((item) => item.id === (stanceBy[team] ?? snap.stances[team]));
                        const buildPackage = buildPackageSpec(packageBy[team]);
                        const coachOrder = coachOrderSpec(orderBy[team]);
                        councilPlans.current[team] = { items: buys.map((buy) => ({ petId: buy.petId, kind: buy.kind })), stance: stance?.id ?? "balanced", paid: false };
                        const build = buys.length ? buys.slice(0, 4).map((buy) => `${nameOf(buy.petId)} +${buy.kind.toUpperCase()}`).join(" / ") : "BANKED COINS";
                        const call = [buildPackage ? `${buildPackage.icon} ${buildPackage.label}` : null, coachOrder ? `${coachOrder.icon} ${coachOrder.label}` : null].filter(Boolean).join(" + ");
                        pushFeed(`COUNCIL ${event.round} · ${team.toUpperCase()} ${stance?.icon ?? ""} ${stance?.label ?? "BALANCED"}${call ? ` · ${call}` : ""} · ${build}`, color(team));
                    }
                } else if (event.type === "opening") {
                    const blue = doctrineSpec(event.doctrines.blue), red = doctrineSpec(event.doctrines.red);
                    pushFeed(`${blue.icon} ${blue.label} vs ${red.icon} ${red.label} · ${event.winner ? `${event.winner.toUpperCase()} wins ${event.secs}s` : "even"}`, event.winner ? color(event.winner) : "#c4b5fd");
                } else if (event.type === "readreserve") {
                    pushBanner(`ADAPTATION READ · ${event.team.toUpperCase()} +${event.coins}`, color(event.team));
                    pushFeed(`SCOUTING RESERVE · +${event.coins} coins for the counter-plan`, color(event.team));
                } else if (event.type === "deployment") {
                    pushFeed(`${event.team.toUpperCase()} DEPLOYMENT · ${event.slots.map((lane) => WF_DEPLOYMENT_LABEL[lane]).join(" / ")} · ${event.lockSecs}s LOCK`, color(event.team));
                } else if ((event.type === "buildpackage" || event.type === "coachorder") && !councilTicks.current.has(event.t)) {
                    const item = event.type === "buildpackage" ? buildPackageSpec(event.choice) : coachOrderSpec(event.order);
                    pushFeed(`${event.team.toUpperCase()} PLAN · ${item?.icon ?? ""} ${item?.label ?? (event.type === "buildpackage" ? event.choice : event.order)}`, color(event.team));
                } else if (event.type === "objectivetechnique") {
                    const technique = objectiveTechniqueSpec(event.choice);
                    pushFeed(`${event.team.toUpperCase()} TACTIC ARMED · ${technique?.icon ?? ""} ${technique?.label ?? event.choice}`, color(event.team));
                } else if (event.type === "packageproc") {
                    if (feature(`package:${event.team}:${event.choice}`, event.t, 12)) {
                        const item = buildPackageSpec(event.choice);
                        const target = actor(event.targetId);
                        pushFeed(`${item?.icon ?? ""} ${item?.label ?? event.choice} PROC · ${nameOf(event.actorId)} → ${nameOf(event.targetId)}`, color(event.team));
                        if (target) spawnFloater(target.x, target.y, item?.label.toUpperCase() ?? "PACKAGE PROC", color(event.team), false);
                    }
                } else if (event.type === "techniqueused") {
                    const item = objectiveTechniqueSpec(event.choice);
                    const boss = WF_MINI_NAMES[event.padIdx] ?? "Sigil";
                    const mini = snap.minis.find((candidate) => candidate.padIdx === event.padIdx);
                    const detail = event.choice === "secure" ? "threshold burst set up a safer claim" : event.choice === "hijack" ? "low-health execute landed" : "Defender delayed the contest";
                    pushBanner(`${item?.label.toUpperCase() ?? "OBJECTIVE TECHNIQUE"} · ${event.team.toUpperCase()}`, color(event.team), true);
                    pushFeed(`${boss} · ${detail}`, color(event.team));
                    if (mini) { spawnFx(mini.x, mini.y, event.choice === "zone" ? "power" : "spark", null, 2.4, 600); cut(event.t, mini.x, mini.y, 12, salience, 2.7); }
                    triggerFlash(event.team === "blue" ? "#3b82f644" : "#ef444444"); shakeRef.current = Math.max(shakeRef.current, 1.1);
                } else if (event.type === "counterstrike") {
                    const item = counterstrikeSpec(event.choice);
                    const target = event.targetId ? actor(event.targetId) : null;
                    const statue = snap.structures[event.team].statues[event.statue];
                    const detail = event.choice === "fortify" ? `next threatened route fortified for ${event.secs ?? 45}s` : event.choice === "cross-map" ? "elite wave launched on the opposite route" : `${event.targetId ? nameOf(event.targetId) : "enemy carry"} marked for +${event.bounty ?? 0}`;
                    pushBanner(`${item?.label.toUpperCase() ?? "COUNTERSTRIKE"} · ${event.team.toUpperCase()}`, color(event.team), true);
                    pushFeed(`COMEBACK ROUTE · ${detail}`, color(event.team));
                    if (target ?? statue) cut(event.t, (target ?? statue)!.x, (target ?? statue)!.y, 12, salience, 2.6);
                } else if (event.type === "counterstrikeclaim") {
                    const target = actor(event.targetId);
                    pushBanner(`BOUNTY CLAIMED · ${event.team.toUpperCase()} +${event.bounty}`, "#fde047", true);
                    pushFeed(`${nameOf(event.actorId)} completed the comeback hunt on ${nameOf(event.targetId)}`, "#fde047");
                    if (target) { spawnFloater(target.x, target.y, `+${event.bounty}`, "#fde047", true); cut(event.t, target.x, target.y, 11, salience, 2.8); }
                    triggerFlash("#fde04755"); shakeRef.current = Math.max(shakeRef.current, 1.3);
                } else if (event.type === "hit") {
                    const target = actor(event.targetId), source = actor(event.actorId);
                    if (target) {
                        spawnFx(target.x, target.y, null, event.element, event.crit ? 1.3 : 0.8, 260);
                        spawnFloater(target.x, target.y, String(event.dmg), event.crit ? "#fde047" : "#fecaca", event.crit);
                        if (source && Math.hypot(source.x - target.x, source.y - target.y) > 1.8) spawnShot(source.x, source.y, target.x, target.y, event.element, event.crit);
                    }
                } else if (event.type === "heal") {
                    const target = actor(event.targetId); if (target) spawnFx(target.x, target.y, "heal", null, 1.2, 400);
                } else if (event.type === "kill") {
                    const target = actor(event.targetId);
                    if (target) { spawnFx(target.x, target.y, "spark", null, 2.3, 520); cut(event.t, target.x, target.y, 12, salience, 2); }
                    pushFeed(`☠ ${nameOf(event.targetId)} · ${nameOf(event.actorId)}`, color(event.team)); shakeRef.current = Math.max(shakeRef.current, 1.1);
                    const shutdownFollows = result.events.slice(i + 1, i + 3).some((next) => next.t === event.t && next.type === "shutdown" && next.actorId === event.actorId);
                    if (!shutdownFollows) councilPayoff(event.team, event.actorId, "TAKEDOWN");
                } else if (event.type === "shutdown") {
                    const target = actor(event.targetId);
                    pushBanner(`SHUTDOWN · +${event.bounty} BOUNTY`, "#fde047", event.streak >= 5);
                    pushFeed(`${nameOf(event.actorId)} ends ${nameOf(event.targetId)}'s ${event.streak}-KO streak`, "#fde047");
                    if (target) { spawnFloater(target.x, target.y, `+${event.bounty}`, "#fde047", true); cut(event.t, target.x, target.y, 12, salience, 2.5); }
                    councilPayoff(actor(event.actorId)?.team ?? (actor(event.targetId)?.team === "blue" ? "red" : "blue"), event.actorId, "SHUTDOWN");
                } else if (event.type === "gank") {
                    if (feature(`gank:${event.actorId}`, event.t, 18)) {
                        pushFeed(`GANK ARRIVAL · ${nameOf(event.actorId)} hunts ${nameOf(event.targetId)}`, color(actor(event.actorId)?.team ?? "blue"));
                        cut(event.t, event.x, event.y, 11, salience, 1.8);
                    }
                } else if (event.type === "mercy") {
                    pushBanner(`MERCY ACCELERATION · ${event.team.toUpperCase()} COMMANDS THE FIELD`, color(event.team), true);
                    pushFeed("TRIPLE SIEGE PRESSURE · the war enters its finish", "#fde047");
                } else if (event.type === "bosssig") {
                    spawnFx(event.x, event.y, event.kind === "blink" ? "shadow" : "power", null, 1.9, 520);
                    if (salience && feature(`boss:${event.padIdx}:${event.kind}`, event.t, 24)) {
                        const move = event.kind === "quake" ? "EARTHSHATTER" : event.kind === "shell" ? "TIDAL SHELL" : event.kind === "blink" ? "VOID BLINK" : "INFERNO BREATH";
                        pushFeed(`${WF_MINI_NAMES[event.padIdx]} · ${move}`, "#d8b4fe");
                        cut(event.t, event.x, event.y, 12, salience, 1.5);
                    }
                } else if (event.type === "elemsig") {
                    spawnFx(event.x, event.y, null, event.el, 1.7, 480);
                    const decisive = earnsKill(event.petId);
                    if (decisive || feature(`element:${event.petId}`, event.t, 36)) {
                        pushFeed(`${nameOf(event.petId)} · ${event.name}${decisive ? " · FINISH" : ""}`, tintOf(event.el));
                        spawnFloater(event.x, event.y, event.name, tintOf(event.el), decisive);
                        cut(event.t, event.x, event.y, 11, decisive ? 5 : salience, decisive ? 2 : 1.2);
                    }
                } else if (event.type === "structhit") {
                    spawnFx(event.x, event.y, "spark", null, event.core ? 1.4 : 0.9, 220);
                    if (event.mini !== undefined && !convoyImpact.current.has(event.mini)) { convoyImpact.current.add(event.mini); cut(event.t, event.x, event.y, 13, 5, 2.5); }
                } else if (event.type === "statuedown" || event.type === "guardiandown") {
                    const object = event.type === "statuedown" ? snap.structures[event.team].statues[event.statue] : snap.guardians[event.team][event.idx];
                    pushBanner(event.type === "statuedown" ? "GUARDIAN TOTEM SHATTERED" : "SENTINEL FALLS", color(event.by));
                    pushFeed(`${event.by.toUpperCase()} opens the route to the Ward Seal`, color(event.by));
                    if (object) { spawnFx(object.x, object.y, "power", null, 2.6, 600); cut(event.t, object.x, object.y, 13, salience, 2.5); }
                    shakeRef.current = 1.7;
                    councilPayoff(event.by, null, "BREACH");
                } else if (event.type === "coreexposed") {
                    pushBanner(`${event.team.toUpperCase()} SEAL EXPOSED · LAST STAND`, color(event.team), true); pushFeed("Next break ends the war", "#fde047");
                } else if (event.type === "coredown") {
                    const core = snap.structures[event.team].core;
                    pushBanner(`${event.by.toUpperCase()} SHATTERS THE WARD SEAL`, color(event.by), true); pushFeed(`MATCH POINT · ${event.by.toUpperCase()} broke the Seal`, color(event.by));
                    spawnFx(core.x, core.y, "power", null, 3.4, 900); cut(event.t, core.x, core.y, 14, salience, 3.5); triggerFlash(event.by === "blue" ? "#3b82f666" : "#ef444466");
                    councilPayoff(event.by, null, "WARD SEAL");
                } else if (event.type === "minikill") {
                    const boss = WF_MINI_NAMES[event.padIdx] ?? "Lesser Warden";
                    const reward = event.reward ? WF_CAMP_REWARDS[event.reward].label : null;
                    pushBanner(event.stolen ? `SIGIL STOLEN · ${event.team.toUpperCase()}` : `${boss.toUpperCase()} RECRUITED · ${event.team.toUpperCase()}`, event.stolen || event.awakened ? "#fde047" : color(event.team), true);
                    pushFeed(`${event.stolen ? "OBJECTIVE STEAL" : "CONVOY"} · ${boss}${reward ? ` · ${reward}` : ""}${event.awakened ? " · +1 SIGIL" : ""}`, event.stolen ? "#fde047" : color(event.team));
                    convoyImpact.current.delete(event.padIdx);
                    const mini = snap.minis.find((item) => item.padIdx === event.padIdx);
                    if (mini) { spawnFx(mini.x, mini.y, "power", null, 2.5, 560); cut(event.t, mini.x, mini.y, 13, salience, 2.5); }
                    councilPayoff(event.team, null, event.stolen ? "SIGIL STEAL" : "CONVOY");
                } else if (event.type === "sigilsoon" || event.type === "sigilawake") {
                    const boss = WF_MINI_NAMES[event.padIdx] ?? "Lesser Warden", awake = event.type === "sigilawake";
                    pushBanner(`${boss.toUpperCase()} ${awake ? "AWAKENS · DOUBLE BOUNTY" : "STIRS · SIGIL SOON"}`, awake ? "#fde047" : "#fbbf24", awake);
                    pushFeed(awake ? "CONTEST · Sigil in play" : "Rotate to the coming Sigil", "#fde047"); cut(event.t, event.x, event.y, 14, 4, 2.5);
                } else if (event.type === "sigilpip") {
                    pushFeed(`${event.team.toUpperCase()} · ${event.count} SIGIL${event.count === 2 ? "S · ASCENDANCE POINT" : ""}`, event.count === 2 ? "#fde047" : color(event.team));
                } else if (event.type === "ascendance") {
                    pushBanner(`HOLLOW ASCENDANCE · ${event.team.toUpperCase()}`, "#fde047", true); pushFeed("PERMANENT POWER · ELITE WAVES · +30% SIEGE", "#fde047");
                } else if (event.type === "minimarch") {
                    const mini = snap.minis.find((item) => item.padIdx === event.padIdx);
                    pushFeed(`ESCORT · ${WF_MINI_NAMES[event.padIdx]} marches for ${event.team.toUpperCase()}`, color(event.team));
                    cut(event.t, event.x, event.y, 13, 4, 8, { kind: "mini", padIdx: event.padIdx, team: event.team, startDowns: mini?.siegeDowns ?? 0 });
                } else if (event.type === "siegeescort") {
                    pushFeed(event.escorted ? "ESCORT LINKED · FULL SIEGE" : "ESCORT BROKEN · REDUCED SIEGE", event.escorted ? color(event.team) : "#fbbf24");
                } else if (event.type === "siegebreak") {
                    pushBanner(`BREAK THE SIEGE · ${event.team.toUpperCase()}`, color(event.team), true); pushFeed(`Structure saved · +${event.bounty} coins`, color(event.team));
                    spawnFx(event.x, event.y, "power", null, 2.5, 620); cut(event.t, event.x, event.y, 13, salience, 3);
                    councilPayoff(event.team, null, "SIEGE DEFENSE");
                } else if (event.type === "wardensoon") {
                    pushFeed("Gate Warden awakens at WAR", "#d8b4fe"); cut(event.t, event.x, event.y, 15, 4, 2);
                } else if (event.type === "wardenphase") {
                    pushBanner(`GATE WARDEN · PHASE ${event.phase}`, event.phase === 3 ? "#fb7185" : "#e879f9", true); cut(event.t, WF_LAIR.x, WF_LAIR.y, 15, salience, 2.5);
                } else if (event.type === "wardenkill") {
                    pushBanner(`${event.stolen ? "WARDEN STOLEN" : "GATE WARDEN FALLS"} · ${event.team.toUpperCase()}`, event.stolen ? "#fde047" : color(event.team), true);
                    pushFeed(`${event.team.toUpperCase()} claims Gate's Wrath`, event.stolen ? "#fde047" : color(event.team)); cut(event.t, WF_LAIR.x, WF_LAIR.y, 15, salience, 3); triggerFlash(event.team === "blue" ? "#3b82f666" : "#ef444466");
                    councilPayoff(event.team, null, event.stolen ? "WARDEN STEAL" : "WARDEN");
                } else if (event.type === "phase") {
                    pushBanner(event.name, event.name === "SUDDEN DEATH" ? "#fb7185" : "#fde047", true);
                } else if (event.type === "verdict") {
                    const winner = event.winner === "draw" ? null : event.winner;
                    pushBanner(winner ? `${winner.toUpperCase()} WINS THE JUDGMENT` : "JUDGMENT / STALEMATE", winner ? color(winner) : "#c4b5fd", true);
                    pushFeed(`FINAL VERDICT / ${event.blueScore}-${event.redScore} / ${event.blueCoins}-${event.redCoins} COINS`, winner ? color(winner) : "#c4b5fd");
                } else if (event.type === "ultimate") {
                    const decisive = earnsKill(event.petId);
                    spawnFx(event.x, event.y, event.kind === "Sanctuary" ? "heal" : event.kind === "Shadow Execution" ? "shadow" : "power", null, 2.6, 650); spawnFloater(event.x, event.y, event.kind.toUpperCase(), "#c4b5fd", true);
                    if (decisive || feature(`ultimate:${actor(event.petId)?.team ?? "team"}`, event.t, 14)) {
                        pushFeed(`ULTIMATE · ${nameOf(event.petId)} · ${event.kind}${decisive ? " · FINISH" : ""}`, "#e9d5ff");
                        cut(event.t, event.x, event.y, 12, decisive ? 6 : salience, 2);
                    }
                } else if (event.type === "petlevel") {
                    const pet = actor(event.petId); if (pet) spawnFloater(pet.x, pet.y, `LEVEL ${event.level}`, "#6ee7b7", true);
                } else if (event.type === "stance" && !councilTicks.current.has(event.t)) pushFeed(`${event.team.toUpperCase()} · ${event.stance.toUpperCase()}`, color(event.team));
            }
            cursor.current = i; last.current = now;
        }
        if (!ended.current && result.winner !== null && now >= warfrontSnapshotFrontier(result.snapshots)) { ended.current = true; onEnd(); }
    });
    return null;
}

function WfMinimap({ result, clock, theme, camViewRef, camCtlRef, onModeChange, disabled }: {
    result: WarfrontResult; clock: WfClockRef; theme: WfTheme;
    camViewRef: MutableRefObject<{ x: number; z: number; half: number }>;
    camCtlRef: MutableRefObject<WfCamCtl>; onModeChange: (m: "follow" | "free") => void; disabled: boolean;
}) {
    const canvas = useRef<HTMLCanvasElement>(null), spec = WF_THEMES[theme];
    useEffect(() => {
        let frame = 0, live = true, paintedSnap: WfSnapshot | null = null;
        const base = document.createElement("canvas"), field = document.createElement("canvas");
        base.width = field.width = 224; base.height = field.height = 105;
        const baseCtx = base.getContext("2d")!, fieldCtx = field.getContext("2d")!;
        const px = (x: number) => (x + WF_X) / (2 * WF_X) * base.width, py = (y: number) => (y + WF_Y) / (2 * WF_Y) * base.height;
        const dot = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px(x), py(y), size, 0, 7); ctx.fill(); };
        baseCtx.fillStyle = spec.voidColor; baseCtx.fillRect(0, 0, base.width, base.height);
        baseCtx.strokeStyle = "#94a3b833"; baseCtx.lineWidth = 5;
        for (const lane of Object.values(WF_LANES)) { baseCtx.beginPath(); lane.forEach(([x, y], i) => i ? baseCtx.lineTo(px(x), py(y)) : baseCtx.moveTo(px(x), py(y))); baseCtx.stroke(); }
        const draw = () => {
            if (!live) return;
            const cv = canvas.current, ctx = cv?.getContext("2d");
            if (cv && ctx) {
                const snap = snapAt(result, clock);
                if (snap !== paintedSnap) {
                    paintedSnap = snap; fieldCtx.clearRect(0, 0, field.width, field.height); fieldCtx.drawImage(base, 0, 0);
                    for (const team of ["blue", "red"] as const) {
                        const color = TEAM_COLOR[team], structures = snap.structures[team];
                        for (const item of [...snap.guardians[team], ...structures.statues, structures.core]) if (item.alive) dot(fieldCtx, item.x, item.y, item === structures.core ? 4 : 2.5, color);
                    }
                    if (snap.warden.alive) dot(fieldCtx, snap.warden.x, snap.warden.y, 4, snap.warden.active ? "#c084fc" : "#64748b");
                    for (const mini of snap.minis) if (mini.alive) dot(fieldCtx, mini.x, mini.y, 3, mini.ally ? TEAM_COLOR[mini.ally] : mini.awake ? "#fde047" : "#a78bfa");
                    for (const actor of snap.actors) if (actor.state !== "respawning") dot(fieldCtx, actor.x, actor.y, 2.5, TEAM_SOFT[actor.team]);
                }
                ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(field, 0, 0);
                const view = camViewRef.current, w = view.half / (2 * WF_X) * cv.width, h = view.half * .62 / (2 * WF_Y) * cv.height;
                ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(px(view.x) - w, py(view.z) - h, 2 * w, 2 * h);
            }
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        return () => { live = false; cancelAnimationFrame(frame); };
    }, [camViewRef, clock, result, spec]);
    return <canvas className="wf-minimap" ref={canvas} width={224} height={105} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label="Warfront tactical map; click or use arrow keys to move the camera" onClick={(event) => {
        if (disabled) return;
        const rect = event.currentTarget.getBoundingClientRect(), ctl = camCtlRef.current;
        ctl.mode = "free"; ctl.fx = (event.clientX - rect.left) / rect.width * 2 * WF_X - WF_X; ctl.fz = (event.clientY - rect.top) / rect.height * 2 * WF_Y - WF_Y; onModeChange("free");
    }} onKeyDown={(event) => {
        if (disabled) return;
        const ctl = camCtlRef.current, step = event.shiftKey ? 8 : 4, dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, dz = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        if (!dx && !dz && event.key !== "Home") return;
        event.preventDefault(); ctl.mode = "free"; ctl.fx = event.key === "Home" ? 0 : Math.max(-WF_X, Math.min(WF_X, ctl.fx + dx)); ctl.fz = event.key === "Home" ? 0 : Math.max(-WF_Y, Math.min(WF_Y, ctl.fz + dz)); onModeChange("free");
    }} style={{ width: 224, height: 105, border: "1px solid #94a3b880", borderRadius: 8, background: spec.voidColor, cursor: disabled ? "default" : "pointer", pointerEvents: disabled ? "none" : "auto" }} />;
}


function WfConvoyFollow({ result, clock, onFollow, disabled }: { result: WarfrontResult; clock: WfClockRef; onFollow: (pad: number) => void; disabled: boolean }) {
    const box = useRef<HTMLButtonElement>(null), label = useRef<HTMLSpanElement>(null), hp = useRef<HTMLSpanElement>(null), pad = useRef<number | null>(null);
    useEffect(() => {
        let frame = 0, live = true, writtenSnap: WfSnapshot | null = null;
        const tick = () => {
            if (!live) return;
            const snap = snapAt(result, clock);
            if (snap === writtenSnap) { frame = requestAnimationFrame(tick); return; }
            writtenSnap = snap;
            const mini = snap.minis.find((m) => m.alive && m.ally && m.siegeDowns === 0);
            pad.current = mini?.padIdx ?? null;
            if (box.current) {
                box.current.style.display = mini ? "flex" : "none";
                box.current.setAttribute("aria-label", mini ? `Follow ${mini.ally} ${WF_MINI_NAMES[mini.padIdx]} convoy` : "No active convoy");
            }
            if (mini && label.current && hp.current) {
                label.current.textContent = `${mini.ally!.toUpperCase()} · ${mini.escorted ? "ESCORTED · FULL SIEGE" : "ESCORT NEEDED · 35% SIEGE"}`;
                hp.current.style.width = `${Math.round(100 * mini.hp / mini.maxHp)}%`;
                hp.current.style.background = TEAM_COLOR[mini.ally!];
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => { live = false; cancelAnimationFrame(frame); };
    }, [clock, result]);
    return (
        <button className="wf-convoy-follow" ref={box} type="button" disabled={disabled} onClick={() => !disabled && pad.current !== null && onFollow(pad.current)} style={{ display: "none", width: 224, minHeight: 44, alignItems: "center", gap: 8, padding: 6, border: "1px solid #7c3aed", borderRadius: 8, background: "#080c18ee", color: "#e2e8f0", cursor: disabled ? "default" : "pointer", pointerEvents: disabled ? "none" : "auto" }}>
            <span aria-hidden="true" style={{ fontSize: 24 }}>🗿</span>
            <span style={{ flex: 1, display: "grid", gap: 3, textAlign: "left", font: "800 12px/1.2 Inter, sans-serif" }}><b>CONVOY PiP · TAP TO FOLLOW</b><span ref={label} /><i style={{ height: 3, background: "#1e293b" }}><span ref={hp} style={{ display: "block", height: "100%" }} /></i></span>
        </button>
    );
}

/** Sustained frame pressure sheds presentation work in two sticky steps.
 * Simulation fidelity never changes; only cameras, distant rigs and particles do.
 * Detail resets between matches instead of remounting rigs during live combat. */
function WfFrameGovernor({ value, onPressure }: { value: WarfrontAdaptivePressure; onPressure: (pressure: WarfrontAdaptivePressure) => void }) {
    const averageMs = useRef(17), slowFor = useRef(0), pressure = useRef(value);
    useEffect(() => { pressure.current = value; slowFor.current = 0; }, [value]);
    useFrame((_state, delta) => {
        const dt = Math.min(.1, delta);
        averageMs.current += (dt * 1000 - averageMs.current) * .035;
        slowFor.current = averageMs.current > 27 ? slowFor.current + dt : Math.max(0, slowFor.current - dt / 2);
        if (slowFor.current > 2.5 && pressure.current < 2) {
            pressure.current = (pressure.current + 1) as WarfrontAdaptivePressure;
            slowFor.current = 0; onPressure(pressure.current);
        }
    });
    return null;
}

// ── HUD frame-writers (refs only, no re-render) ──────────────────────────────
function WfHudWriter({ result, clock, localTeam, timerRef, coinBlueRef, coinRedRef, scoreBlueRef, scoreRedRef, killBlueRef, killRedRef, structsBlueRef, structsRedRef, sigilPipsBlueRef, sigilPipsRedRef, judgmentRef, stanceBlueRef, stanceRedRef, phaseRef, phaseClockRef, objectiveRef, stakesRef, blueIntentRef, redIntentRef, wardenWrapRef, wardenHpRef, wardenStatusRef, wardenDamageRef, sigilRef, phaseOverlayRef }: {
    result: WarfrontResult; clock: WfClockRef; localTeam: Team;
    timerRef: MutableRefObject<HTMLSpanElement | null>; coinBlueRef: MutableRefObject<HTMLSpanElement | null>; coinRedRef: MutableRefObject<HTMLSpanElement | null>;
    scoreBlueRef: MutableRefObject<HTMLSpanElement | null>; scoreRedRef: MutableRefObject<HTMLSpanElement | null>; killBlueRef: MutableRefObject<HTMLSpanElement | null>; killRedRef: MutableRefObject<HTMLSpanElement | null>;
    structsBlueRef: MutableRefObject<HTMLSpanElement | null>; structsRedRef: MutableRefObject<HTMLSpanElement | null>; sigilPipsBlueRef: MutableRefObject<HTMLSpanElement | null>; sigilPipsRedRef: MutableRefObject<HTMLSpanElement | null>;
    judgmentRef: MutableRefObject<HTMLSpanElement | null>;
    stanceBlueRef: MutableRefObject<HTMLSpanElement | null>; stanceRedRef: MutableRefObject<HTMLSpanElement | null>; phaseRef: MutableRefObject<HTMLSpanElement | null>; phaseClockRef: MutableRefObject<HTMLSpanElement | null>;
    objectiveRef: MutableRefObject<HTMLSpanElement | null>; stakesRef: MutableRefObject<HTMLSpanElement | null>; blueIntentRef: MutableRefObject<HTMLSpanElement | null>; redIntentRef: MutableRefObject<HTMLSpanElement | null>;
    wardenWrapRef: MutableRefObject<HTMLDivElement | null>; wardenHpRef: MutableRefObject<HTMLDivElement | null>; wardenStatusRef: MutableRefObject<HTMLSpanElement | null>; wardenDamageRef: MutableRefObject<HTMLSpanElement | null>;
    sigilRef: MutableRefObject<HTMLSpanElement | null>; phaseOverlayRef: MutableRefObject<HTMLDivElement | null>;
}) {
    const eventCursor = useRef(0), kills = useRef([0, 0]), last = useRef(-1), writtenSnap = useRef<WfSnapshot | null>(null);
    useFrame(() => {
        const snap = snapAt(result, clock);
        if (snap === writtenSnap.current) return;
        writtenSnap.current = snap;
        const seconds = Math.floor(snap.t / WARFRONT_TPS), phase = phaseAtSeconds(seconds);
        if (timerRef.current) timerRef.current.textContent = mmss(WF_MAX_SECONDS - seconds);
        if (phaseRef.current) { phaseRef.current.textContent = phase.label; phaseRef.current.style.color = phase.color; }
        if (phaseClockRef.current) phaseClockRef.current.textContent = `${phase.id === "collapse" ? "JUDGMENT" : "NEXT"} ${mmss(phase.ends - seconds)}`;
        const blueOpen = snap.structures.blue.core.exposed, redOpen = snap.structures.red.core.exposed;
        const exposedTeam: Team | null = blueOpen ? "blue" : redOpen ? "red" : null;
        if (objectiveRef.current) objectiveRef.current.textContent = warfrontWardSealInstruction(exposedTeam, localTeam) ?? (snap.warden.active ? "CONTEST THE GATE WARDEN" : phase.id === "skirmish" ? "RECRUIT LESSER WARDENS" : "SECURE THE LANES");
        if (stakesRef.current) stakesRef.current.textContent = broadcastStakes(snap);
        if (blueIntentRef.current) blueIntentRef.current.textContent = `BLUE · ${broadcastIntent(snap, "blue")}`;
        if (redIntentRef.current) redIntentRef.current.textContent = `RED · ${broadcastIntent(snap, "red")}`;
        if (phaseOverlayRef.current) { phaseOverlayRef.current.style.opacity = phase.id === "collapse" ? ".22" : phase.id === "war" ? ".07" : "0"; phaseOverlayRef.current.style.background = phase.id === "collapse" ? "#9f123955" : "#6b21a833"; }
        const warden = snap.warden;
        if (wardenWrapRef.current) wardenWrapRef.current.style.display = seconds >= WF_PHASE_WAR - 20 || warden.active ? "grid" : "none";
        if (wardenHpRef.current) { wardenHpRef.current.style.width = `${100 * warden.hp / warden.maxHp}%`; wardenHpRef.current.style.background = warden.active ? warden.phase === 3 ? "#fb7185" : "#a78bfa" : "#475569"; }
        if (wardenStatusRef.current) wardenStatusRef.current.textContent = !warden.active ? `DORMANT · WAR IN ${mmss(WF_PHASE_WAR - seconds)}` : !warden.alive ? "DEFEATED" : warden.winding ? `SLAM ${warden.windupSecs.toFixed(1)}s` : `PHASE ${warden.phase} · ${Math.ceil(warden.hp)}/${warden.maxHp}`;
        if (wardenDamageRef.current) {
            const total = warden.damage.blue + warden.damage.red, blue = total ? Math.round(100 * warden.damage.blue / total) : 50;
            wardenDamageRef.current.textContent = warden.active ? `BLUE ${blue}% · ${100 - blue}% RED` : "SEALED · CANNOT BE DAMAGED";
        }
        if (sigilRef.current) {
            const sigil = snap.sigil, boss = (WF_MINI_NAMES[sigil.padIdx] ?? "SIGIL").toUpperCase();
            sigilRef.current.textContent = sigil.state === "awake" ? `🗿 ${boss} AWAKE` : sigil.state === "soon" ? `🗿 ${boss} ${mmss(sigil.secs)}` : sigil.scheduled ? `🗿 SIGIL ${mmss(sigil.secs)}` : "";
        }
        if (coinBlueRef.current) coinBlueRef.current.textContent = String(snap.coins.blue);
        if (coinRedRef.current) coinRedRef.current.textContent = String(snap.coins.red);
        const score = wfVerdictScore(snap);
        if (scoreBlueRef.current) scoreBlueRef.current.textContent = String(score.blue);
        if (scoreRedRef.current) scoreRedRef.current.textContent = String(score.red);
        if (judgmentRef.current) {
            const judgment = warfrontJudgmentState(score, snap.coins), split = judgment.blueShare;
            judgmentRef.current.style.background = `linear-gradient(90deg,#3b82f6 0 ${split - 1}%,#475569 ${split - 1}% ${split + 1}%,#ef4444 ${split + 1}% 100%)`;
            judgmentRef.current.dataset.wfJudgment = judgment.leader ?? "tied";
            judgmentRef.current.setAttribute("aria-label", judgment.label);
            judgmentRef.current.title = judgment.label;
        }
        if (snap.t < last.current) { eventCursor.current = 0; kills.current = [0, 0]; }
        last.current = snap.t;
        const eventFrontier = warfrontEventCursorThroughTick(result.events, eventCursor.current, snap.t);
        while (eventCursor.current < eventFrontier) {
            const event = result.events[eventCursor.current++]; if (event.type === "kill") kills.current[event.team === "blue" ? 0 : 1]++;
        }
        if (killBlueRef.current) killBlueRef.current.textContent = String(kills.current[0]);
        if (killRedRef.current) killRedRef.current.textContent = String(kills.current[1]);
        const pips = (team: Team) => `${snap.guardians[team].filter((item) => item.alive).length}🛡 ${snap.structures[team].statues.filter((item) => item.alive).length}⛩ ${snap.structures[team].core.alive ? "🔮" : "·"}`;
        if (structsBlueRef.current) structsBlueRef.current.textContent = pips("blue");
        if (structsRedRef.current) structsRedRef.current.textContent = pips("red");
        for (const [ref, team] of [[sigilPipsBlueRef, "blue"], [sigilPipsRedRef, "red"]] as const) if (ref.current) { const n = snap.sigilPips[team]; ref.current.textContent = "◆".repeat(n) + "◇".repeat(3 - n); ref.current.style.color = snap.ascendant === team ? "#fde047" : "#d8b4fe"; }
        for (const [ref, team] of [[stanceBlueRef, "blue"], [stanceRedRef, "red"]] as const) if (ref.current) ref.current.textContent = WF_STANCES.find((item) => item.id === snap.stances[team])?.icon ?? "";
    });
    return null;
}

type WfCouncilContext = {
    snapshot: WfSnapshot;
    decisions: readonly WarfrontRoundChoice[];
    events: readonly WfEvent[];
    setupDecision: WarfrontRoundDecision;
};

type CouncilChoiceMeta<T extends string> = { id: T; icon: string; label: string; desc: string };
const WF_COACH_ORDER_META: readonly CouncilChoiceMeta<WfCoachOrder>[] = [
    { id: "contest", icon: "◆", label: "Contest", desc: "Group for the next Sigil. Strong objective control; yields side-lane tempo." },
    { id: "trade", icon: "⇄", label: "Cross-map Trade", desc: "Pressure the opposite route. Gains structure tempo; may concede the objective." },
    { id: "ambush", icon: "◈", label: "Ambush", desc: "Send the assassin after the backline. High pick pressure; weaker in a full brawl." },
] as const;
const WF_BUILD_PACKAGE_META: readonly (CouncilChoiceMeta<WfBuildPackage> & { forecast: string })[] = [
    { id: "hold-line", icon: "🛡", label: "Hold the Line", desc: "Turn your anchor into a team shield.", forecast: "Guard + Vitality; non-defenders near your Defender take less damage." },
    { id: "blood-hunt", icon: "🗡", label: "Blood Hunt", desc: "Convert one pick into chase momentum.", forecast: "Strike + Swift; Assassin takedowns trigger a short pursuit surge." },
    { id: "escort-rite", icon: "🌿", label: "Escort Rite", desc: "Keep the push alive around captured bosses.", forecast: "Mend + Vitality; Sage support strengthens escorted allies." },
] as const;
const WF_OBJECTIVE_TECHNIQUE_META: readonly CouncilChoiceMeta<WfObjectiveTechnique>[] = [
    { id: "secure", icon: "🎯", label: "Secure", desc: "Tracker fires a threshold burst to set up a safer Sigil claim." },
    { id: "hijack", icon: "🥷", label: "Hijack", desc: "Assassin attempts a high-risk execute during the claim window." },
    { id: "zone", icon: "🛡", label: "Zone", desc: "Defender delays enemies around the Sigil so allies can finish it." },
] as const;
const WF_COUNTERSTRIKE_META: readonly CouncilChoiceMeta<WfCounterstrike>[] = [
    { id: "fortify", icon: "🏯", label: "Fortify", desc: "Reduce pressure on the next threatened route for 45 seconds." },
    { id: "cross-map", icon: "⚔", label: "Cross-map", desc: "Answer the loss with an elite wave on the opposite route." },
    { id: "bounty-hunt", icon: "🎯", label: "Bounty Hunt", desc: "Mark the enemy carry; defeating it pays a comeback bounty." },
] as const;
const buildPackageSpec = (choice: WfBuildPackage | undefined) => WF_BUILD_PACKAGE_META.find((item) => item.id === choice);
const coachOrderSpec = (choice: WfCoachOrder | undefined) => WF_COACH_ORDER_META.find((item) => item.id === choice);
const objectiveTechniqueSpec = (choice: WfObjectiveTechnique | undefined) => WF_OBJECTIVE_TECHNIQUE_META.find((item) => item.id === choice);
const counterstrikeSpec = (choice: WfCounterstrike | undefined) => WF_COUNTERSTRIKE_META.find((item) => item.id === choice);
const WF_POWERUP_BY_KIND = new Map(WF_POWERUPS.map((powerup) => [powerup.kind, powerup]));

function latestCouncilValue<K extends keyof WarfrontRoundChoice>(decisions: readonly WarfrontRoundChoice[], key: K): WarfrontRoundChoice[K] | undefined {
    for (let index = decisions.length - 1; index >= 0; index--) {
        const value = decisions[index][key];
        if (value !== undefined) return value;
    }
    return undefined;
}

function WfWarCouncil({
    round,
    buyState,
    coins,
    initialStance,
    adaptationReserve = 0,
    context,
    onResume,
    onRequestExit,
    forfeitRequired,
}: {
    round: number;
    buyState: WfCouncilBuyState;
    coins: number;
    initialStance: WfStance;
    adaptationReserve?: number;
    context: WfCouncilContext;
    onResume: (decision: WarfrontRoundDecision) => Promise<void> | void;
    onRequestExit: () => void;
    forfeitRequired: boolean;
}) {
    const score = wfVerdictScore(context.snapshot);
    const ownLost = context.snapshot.structures.blue.statues.filter((item) => !item.alive).length;
    const foeLost = context.snapshot.structures.red.statues.filter((item) => !item.alive).length;
    const enemyStance = WF_STANCES.find((item) => item.id === context.snapshot.stances.red) ?? WF_STANCES[0];
    const objectiveUrgent = context.snapshot.sigil.scheduled && (context.snapshot.sigil.state !== "idle" || context.snapshot.sigil.secs <= 30);
    const roles = useMemo(() => new Set<ArenaRole>(buyState.map((pet) => pet.role)), [buyState]);
    const preferredPackage: WfBuildPackage = score.blue < score.red ? "hold-line" : objectiveUrgent ? "escort-rite" : "blood-hunt";
    const recommendedPackage = firstViableWarfrontChoice(
        preferredPackage,
        WF_BUILD_PACKAGE_META.map((item) => item.id),
        WARFRONT_PACKAGE_ROLE,
        roles,
    );
    const preferredOrder: WfCoachOrder = objectiveUrgent ? "contest" : score.blue < score.red ? "trade" : "ambush";
    const recommendedOrder: WfCoachOrder = preferredOrder === "ambush" && !hasWarfrontRole(roles, "assassin") ? "trade" : preferredOrder;
    const preferredTechnique: WfObjectiveTechnique = objectiveUrgent ? "secure" : score.blue < score.red ? "zone" : "hijack";
    const recommendedTechnique = firstViableWarfrontChoice(
        preferredTechnique,
        WF_OBJECTIVE_TECHNIQUE_META.map((item) => item.id),
        WARFRONT_TECHNIQUE_ROLE,
        roles,
    );
    const previousPackage = (latestCouncilValue(context.decisions, "buildPackage") ?? context.setupDecision.buildPackage) as WfBuildPackage | undefined;
    const previousOrder = (latestCouncilValue(context.decisions, "coachOrder") ?? context.setupDecision.coachOrder) as WfCoachOrder | undefined;
    const previousTechnique = (latestCouncilValue(context.decisions, "objectiveTechnique") ?? context.setupDecision.objectiveTechnique) as WfObjectiveTechnique | undefined;
    const previousCounterstrike = (latestCouncilValue(context.decisions, "counterstrike") ?? context.setupDecision.counterstrike) as WfCounterstrike | undefined;
    const techniqueUse = context.events.find((event): event is Extract<WfEvent, { type: "techniqueused" }> => event.type === "techniqueused" && event.team === "blue");
    const counterstrikeUse = context.events.find((event): event is Extract<WfEvent, { type: "counterstrike" }> => event.type === "counterstrike" && event.team === "blue");
    const initialPackage = previousPackage && hasWarfrontRole(roles, WARFRONT_PACKAGE_ROLE[previousPackage]) ? previousPackage : recommendedPackage;
    const [selectedPackage, setSelectedPackage] = useState<WfBuildPackage | undefined>(initialPackage);
    const [cart, setCart] = useState<WarfrontChoice[]>(() => initialPackage ? councilPackageChoices(buyState, initialPackage, coins) : []);
    const initialOrder = previousOrder === "ambush" && !hasWarfrontRole(roles, "assassin") ? recommendedOrder : previousOrder ?? recommendedOrder;
    const [coachOrder, setCoachOrder] = useState<WfCoachOrder>(initialOrder);
    const [objectiveTechnique, setObjectiveTechnique] = useState<WfObjectiveTechnique | undefined>(undefined);
    const [counterstrike, setCounterstrike] = useState<WfCounterstrike | undefined>(ownLost > 0 && !previousCounterstrike && !counterstrikeUse ? "fortify" : undefined);
    const [councilStance, setCouncilStance] = useState<WfStance>(initialStance);
    const [councilLeft, setCouncilLeft] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(max-width: 600px)").matches ? 45 : 30);
    const [timerHeld, setTimerHeld] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [ordersLocked, setOrdersLocked] = useState(false);
    const decisionRef = useRef<WarfrontRoundDecision>({});
    const resumeRef = useRef(onResume);
    const resumedRef = useRef(false);
    const submittingRef = useRef(false);
    const deadlineCommitQueuedRef = useRef(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        decisionRef.current = {
            choices: cart,
            stance: councilStance,
            coachOrder,
            ...(selectedPackage ? { buildPackage: selectedPackage } : {}),
            ...(objectiveTechnique ? { objectiveTechnique } : {}),
            ...(counterstrike ? { counterstrike } : {}),
        };
        resumeRef.current = onResume;
    }, [cart, coachOrder, councilStance, counterstrike, objectiveTechnique, onResume, selectedPackage]);

    const commitCouncil = useCallback(async () => {
        if (resumedRef.current || submittingRef.current) return;
        submittingRef.current = true;
        // The POST may commit even when its response is lost. Freeze the exact
        // cart/stance from the first attempt so Retry cannot unknowingly fork
        // the token into a permanently conflicting path.
        setOrdersLocked(true);
        setSubmitting(true);
        setSubmitError("");
        try {
            await resumeRef.current(decisionRef.current);
            // Latch only after the authenticated server commit succeeds. A lost
            // response leaves this same modal/path retryable.
            resumedRef.current = true;
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "The server could not secure this Council decision. Retry the same choice.");
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    }, []);

    // Enter this modal deliberately and return focus to the takeover control
    // that owned it. Tab is contained while the underlying battle is inert.
    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        titleRef.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, []);
    const trapDialogFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onRequestExit();
            return;
        }
        if (event.key !== "Tab") return;
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };

    // A readable planning window replaces the old 15-second rush. The timer can
    // be held for motor/cognitive accessibility and never burns while the tab is
    // hidden. Keeping it local avoids reconciling the 3D scene once per second.
    useEffect(() => {
        if (timerHeld || submitting || councilLeft <= 0) return;
        const id = window.setInterval(() => {
            if (document.hidden) return;
            setCouncilLeft((seconds) => Math.max(0, seconds - 1));
        }, 1000);
        return () => window.clearInterval(id);
    }, [councilLeft, submitting, timerHeld]);

    // Keep state updaters pure. The deadline owns one cancellable task, while a
    // failed authenticated commit leaves the frozen choices manually retryable.
    useEffect(() => {
        if (timerHeld || submitting || councilLeft > 0 || deadlineCommitQueuedRef.current) return;
        deadlineCommitQueuedRef.current = true;
        let fired = false;
        const id = window.setTimeout(() => {
            fired = true;
            void commitCouncil();
        }, 0);
        return () => {
            window.clearTimeout(id);
            if (!fired && !resumedRef.current && !submittingRef.current) deadlineCommitQueuedRef.current = false;
        };
    }, [commitCouncil, councilLeft, submitting, timerHeld]);

    const cartCost = useMemo(() => councilCartCost(buyState, cart), [buyState, cart]);
    const coinsAvail = Math.max(0, coins - cartCost);
    const sigilState = !context.snapshot.sigil.scheduled ? "No more Sigils" : context.snapshot.sigil.state === "awake"
        ? `${WF_MINI_NAMES[context.snapshot.sigil.padIdx]} Sigil active · ${context.snapshot.sigil.secs}s`
        : `${WF_MINI_NAMES[context.snapshot.sigil.padIdx]} Sigil in ${context.snapshot.sigil.secs}s`;
    const pressure = score.blue === score.red ? "Judgment tied" : score.blue > score.red ? `Ahead ${score.blue}–${score.red}` : `Behind ${score.blue}–${score.red}`;
    const choosePackage = (choice: WfBuildPackage) => {
        if (!hasWarfrontRole(roles, WARFRONT_PACKAGE_ROLE[choice])) return;
        setSelectedPackage(choice);
        setCart(councilPackageChoices(buyState, choice, coins));
    };

    return (
        <div className="wf-council-backdrop">
            <div
                ref={dialogRef}
                className="wf-council-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="wf-council-title"
                aria-describedby="wf-council-help"
                onKeyDown={trapDialogFocus}
            >
                <div className="wf-council-header">
                    <h2 id="wf-council-title" ref={titleRef} tabIndex={-1}>📯 Coach Council · round {round}</h2>
                    <div className="wf-council-coins" aria-label={`${coinsAvail} coins available`}>🪙 {coinsAvail}</div>
                </div>
                <div id="wf-council-help">
                    <span>Choose one build package and one macro order. Your choices resolve for the next battle phase.</span>
                    <strong className={councilLeft <= 5 ? "urgent" : ""}>{timerHeld ? "Timer held" : `Resumes in ${councilLeft}s`}</strong>
                    {forfeitRequired && <span className="wf-council-contract">This authenticated match contract lasts 60 minutes. Holding the Council timer does not extend it; Forfeit &amp; exit remains available.</span>}
                </div>
                <div className="wf-council-context" aria-label="Current match state">
                    {[pressure, `${ownLost > foeLost ? "Down" : ownLost < foeLost ? "Up" : "Even"} ${Math.abs(ownLost - foeLost)} structure${Math.abs(ownLost - foeLost) === 1 ? "" : "s"}`, `Enemy ${enemyStance.icon} ${enemyStance.label}`, sigilState].map((text) => (
                        <span key={text}>{text}</span>
                    ))}
                </div>
                {adaptationReserve > 0 && (
                    <div className="wf-council-reserve" role="status">
                        🔎 Adaptation reserve · +{adaptationReserve} coins — your squad converted the opening read into a counter-plan.
                    </div>
                )}
                <section className="wf-council-block" aria-labelledby="wf-build-package-title">
                    <div className="wf-council-heading" id="wf-build-package-title">1 · Build package <span>{recommendedPackage ? `Recommended: ${buildPackageSpec(recommendedPackage)?.label}` : "No role-compatible package"}</span></div>
                    <div className="wf-council-upgrades">
                        {WF_BUILD_PACKAGE_META.map((item) => {
                            const requiredRole = WARFRONT_PACKAGE_ROLE[item.id];
                            const available = hasWarfrontRole(roles, requiredRole);
                            const fullChoices = available ? councilPackageChoices(buyState, item.id) : [];
                            const choices = available ? councilPackageChoices(buyState, item.id, coins) : [];
                            const target = buyState.find((pet) => pet.role === requiredRole);
                            const cost = councilCartCost(buyState, choices);
                            const selected = selectedPackage === item.id;
                            return (
                                <button className="wf-council-option wf-package-option" key={item.id} type="button" disabled={submitting || ordersLocked || !available} aria-pressed={selected} onClick={() => choosePackage(item.id)} title={available ? undefined : `Unavailable: add a ${WARFRONT_ROLE_LABEL[requiredRole]}`}>
                                    <span className="wf-option-top"><strong>{item.icon} {item.label}</strong><span>🪙{cost}</span></span>
                                    <span className="wf-option-desc">{item.desc}</span>
                                    <span className="wf-option-detail">{available ? <>{target?.petName ?? WARFRONT_ROLE_LABEL[requiredRole]} · {item.forecast}{choices.length < fullChoices.length ? ` · ${choices.length}/${fullChoices.length} upgrades affordable` : ""}</> : <>Unavailable · Requires a {WARFRONT_ROLE_LABEL[requiredRole]}</>}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="wf-council-cart" aria-label="Selected package upgrades">
                        {cart.length ? cart.map((choice, index) => {
                            const powerup = WF_POWERUP_BY_KIND.get(choice.kind);
                            const pet = buyState[choice.petIndex];
                            return <button className="wf-cart-chip" key={`${choice.petIndex}-${choice.kind}-${index}`} type="button" disabled={submitting || ordersLocked} aria-label={`Remove ${powerup?.label ?? choice.kind} from ${pet?.petName ?? "package"}`} onClick={() => setCart((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{powerup?.icon} {pet?.petName} · {powerup?.desc} <span aria-hidden="true">×</span></button>;
                        }) : <span className="wf-bank-copy">{selectedPackage ? "Coins banked · package identity remains active." : "Coins banked · no compatible package role available."}</span>}
                        <button className="wf-bank-button" type="button" disabled={submitting || ordersLocked || !cart.length} onClick={() => setCart([])}>Bank upgrade coins</button>
                    </div>
                </section>
                <section className="wf-council-block wf-council-orders-block" aria-labelledby="wf-coach-order-title">
                    <div className="wf-council-heading" id="wf-coach-order-title">2 · Coach order <span>Recommended: {coachOrderSpec(recommendedOrder)?.label}</span></div>
                    <div className="wf-council-orders">
                    {WF_COACH_ORDER_META.map((order) => {
                        const available = order.id !== "ambush" || hasWarfrontRole(roles, "assassin");
                        return (
                            <button
                                type="button"
                                key={order.id}
                                disabled={submitting || ordersLocked || !available}
                                onClick={() => setCoachOrder(order.id)}
                                aria-pressed={coachOrder === order.id}
                                className="wf-council-option wf-order-option"
                                title={available ? undefined : "Unavailable: add an Assassin"}
                            >
                                <strong>{order.icon} {order.label}</strong><span className="wf-option-desc">{available ? order.desc : "Unavailable · Requires an Assassin."}</span>
                            </button>
                        );
                    })}
                    </div>
                </section>
                <section className="wf-council-special" aria-label="Special tactics">
                    <div>
                        <div className="wf-special-title">One-use objective technique {recommendedTechnique && <span>Recommended: {objectiveTechniqueSpec(recommendedTechnique)?.label}</span>}</div>
                        {techniqueUse ? <div className="wf-tactic-spent">Spent · {objectiveTechniqueSpec(techniqueUse.choice)?.label}</div>
                            : previousTechnique ? <div className="wf-tactic-armed">Armed · {objectiveTechniqueSpec(previousTechnique)?.label}. It will trigger at a valid Sigil window.</div>
                            : <div className="wf-tactic-options">{WF_OBJECTIVE_TECHNIQUE_META.map((item) => {
                                const requiredRole = WARFRONT_TECHNIQUE_ROLE[item.id];
                                const available = hasWarfrontRole(roles, requiredRole);
                                return <button className="wf-council-option wf-technique-option" key={item.id} type="button" disabled={submitting || ordersLocked || !available} aria-pressed={objectiveTechnique === item.id} onClick={() => setObjectiveTechnique(item.id)} title={available ? undefined : `Unavailable: add a ${WARFRONT_ROLE_LABEL[requiredRole]}`}><strong>{item.icon} {item.label}</strong><span className="wf-option-desc">{available ? item.desc : `Unavailable · Requires a ${WARFRONT_ROLE_LABEL[requiredRole]}.`}</span></button>;
                            })}</div>}
                    </div>
                    <div>
                        <div className="wf-special-title">Comeback route</div>
                        {counterstrikeUse ? <div className="wf-tactic-spent">Triggered · {counterstrikeSpec(counterstrikeUse.choice)?.label}</div>
                            : previousCounterstrike ? <div className="wf-tactic-armed">Armed · {counterstrikeSpec(previousCounterstrike)?.label}</div>
                            : ownLost === 0 ? <div className="wf-tactic-spent">Unlocks after your first structure falls.</div>
                            : <div className="wf-tactic-options">{WF_COUNTERSTRIKE_META.map((item) => <button className="wf-council-option wf-counter-option" key={item.id} type="button" disabled={submitting || ordersLocked} aria-pressed={counterstrike === item.id} onClick={() => setCounterstrike(item.id)}><strong>{item.icon} {item.label}</strong><span className="wf-option-desc">{item.desc}</span></button>)}</div>}
                    </div>
                </section>
                <label className="wf-council-formation">Formation after Council
                    <select disabled={submitting || ordersLocked} value={councilStance} onChange={(event) => setCouncilStance(event.target.value as WfStance)}>{WF_STANCES.map((item) => <option key={item.id} value={item.id}>{item.icon} {item.label}</option>)}</select>
                    <span>{WF_STANCES.find((item) => item.id === councilStance)?.desc}</span>
                </label>
                {submitError && <p className="wf-council-error" role="alert">{submitError}</p>}
                <div className="wf-council-actions">
                    <div>
                        <span>Spend 🪙{cartCost} · Bank 🪙{coinsAvail}</span>
                        <button className="wf-timer-button" type="button" disabled={submitting || ordersLocked} aria-pressed={timerHeld} onClick={() => setTimerHeld((held) => !held)}>{timerHeld ? "▶ Resume timer" : "⏸ Hold timer"}</button>
                    </div>
                    <div className="wf-council-primary-actions">
                        <button className="wf-council-exit" type="button" onClick={onRequestExit}>{forfeitRequired ? "Forfeit & exit" : "Exit match"}</button>
                        <button className="wf-council-commit" type="button" disabled={submitting} onClick={() => void commitCouncil()}>{submitting ? "Securing decisions…" : submitError ? "Retry same decisions" : "⚔ Commit & resume"}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export type PetWarfrontMatchProps = {
    blue: ArenaSlot[]; red: ArenaSlot[]; seed: number;
    /** Which sealed side belongs to this viewer. Production Manual is
     * intentionally blue-only; red-side PvP/co-op decisions are auto-sealed. */
    localTeam?: Team;
    theme?: WfTheme;
    /** Blue-side policy. "off" (default) = interactive Blue War Council at
     * each 90 s round; any policy = deterministic auto-buy. */
    autoBuy?: WfBuyPolicy;
    /** Red-side policy. PvP/co-op callers seal and pass both policies so every
     * viewer replays the same deterministic decisions. */
    opponentAutoBuy?: WfBuyPolicy;
    /** Blue-side opening setup. Adjustable at each interactive Blue Council. */
    stance?: WfStance;
    doctrine?: WfDoctrine;
    /** Red-side formation/doctrine. Explicit values replay a sealed player or
     * ladder setup; omitted values use the simulator's adaptive AI defaults. */
    opponentStance?: WfStance;
    opponentDoctrine?: WfDoctrine;
    /** Authored setup layer. Ordered slots map pets to Top/Mid/Bottom/Flex for
     * the opening lock; the remaining choices are sealed gameplay, not UI-only. */
    deployment?: WfOpeningDeployment;
    buildPackage?: WfBuildPackage;
    coachOrder?: WfCoachOrder;
    objectiveTechnique?: WfObjectiveTechnique;
    counterstrike?: WfCounterstrike;
    opponentDeployment?: WfOpeningDeployment;
    opponentBuildPackage?: WfBuildPackage;
    opponentCoachOrder?: WfCoachOrder;
    opponentObjectiveTechnique?: WfObjectiveTechnique;
    opponentCounterstrike?: WfCounterstrike;
    /** Enables the 🎲 New-match button (vs-AI / harness). Leave off for shared
     * co-op/PvP replays, where both clients must stay on the agreed seed. */
    allowReseed?: boolean;
    /** Dev/QA playback multiplier. Production callers should keep the default. */
    playbackRate?: number;
    /** Server-accepted Manual Council prefix recovered for this exact token. */
    committedChoices?: WarfrontRoundChoice[];
    /** Secure one Council round before the local sim is allowed to resume. */
    onCouncilCommit?: (round: number, decision: WarfrontRoundDecision) => Promise<void>;
    /** Active authorized vs-AI matches must durably forfeit before leaving. */
    onForfeit?: () => Promise<void>;
    onExit: () => void;
    onResult?: (result: WarfrontResult) => void;
};

export function PetWarfrontMatch({ blue, red, seed, localTeam = "blue", theme = "central", autoBuy = "off", opponentAutoBuy = "balanced", opponentStance, opponentDoctrine, stance = "balanced", doctrine = "none", deployment, buildPackage, coachOrder, objectiveTechnique, counterstrike, opponentDeployment, opponentBuildPackage, opponentCoachOrder, opponentObjectiveTechnique, opponentCounterstrike, allowReseed = false, playbackRate = 1, committedChoices = [], onCouncilCommit, onForfeit, onExit, onResult }: PetWarfrontMatchProps) {
    const safePlaybackRate = Number.isFinite(playbackRate) ? Math.max(0.1, Math.min(30, playbackRate)) : 1;
    // Dev-only deterministic renderer mode for DPR/alignment automation. The
    // production build always keeps the frame governor active; without this QA
    // seam, software WebGL correctly sheds DPR before a matrix runner can record
    // the requested device scale factor.
    const qaPerfMode = import.meta.env.DEV && typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("wfperf")
        : null;
    const fixedQaDpr = qaPerfMode === "fixed" || qaPerfMode === "geometry";
    // Geometry automation validates DPR, containment, and pointer ownership;
    // it does not need a continuously animated battle behind those assertions.
    // Demand rendering preserves the real R3F canvas and controls while avoiding
    // minutes of SwiftShader long tasks across the four serial DPR projects.
    const geometryQa = qaPerfMode === "geometry";
    const [qualityId, setQualityId] = useState<PetVisualQuality>(() => petVisualQuality().id);
    const quality = PET_VISUAL_QUALITY_PRESETS[qualityId];
    const [adaptivePressure, setAdaptivePressure] = useState<WarfrontAdaptivePressure>(0);
    const basePresentationBudget = useMemo(() => warfrontPresentationBudget(quality.id), [quality.id]);
    const presentationBudget = useMemo(
        () => adaptWarfrontPresentationBudget(basePresentationBudget, adaptivePressure),
        [basePresentationBudget, adaptivePressure],
    );
    const canvasDpr: [number, number] = adaptivePressure === 0
        ? quality.dpr
        : adaptivePressure === 1 ? [1, Math.min(1.1, quality.dpr[1])] : [1, 1];
    // Restart machinery: bumping `run` rebuilds the sim from scratch (same seed
    // → identical match); `seedBump` rolls a fresh deterministic seed.
    const [run, setRun] = useState(0);
    const [seedBump, setSeedBump] = useState(0);
    const effectiveSeed = seed + seedBump * 1000003;
    const spec = WF_THEMES[theme];
    const roster = useMemo(() => [
        ...blue.slice(0, 4).map((s, i) => ({ id: `blue-${i}`, pet: s.pet })),
        ...red.slice(0, 4).map((s, i) => ({ id: `red-${i}`, pet: s.pet })),
    ], [blue, red]);
    const configs = useMemo(() => {
        const m = new Map<string, PetCombatModelConfig>();
        for (const r of roster) { const c = petCombatModel(r.pet); if (c) m.set(r.id, c); }
        return m;
    }, [roster]);
    // The interactive chunked sim: round 1 is streamed at mount so the
    // stage always has snapshots; later rounds advance at each boundary.
    const ctl = useMemo(() => {
        const repeatOrder = (order: WfCoachOrder | undefined) => order
            ? Array.from({ length: 6 }, () => ({ coachOrder: order } satisfies WarfrontRoundDecision))
            : undefined;
        const c = startWarfrontMatch(blue, red, effectiveSeed, {
            bluePolicy: autoBuy,
            redPolicy: opponentAutoBuy,
            theme,
            blueStance: stance,
            blueDoctrine: doctrine,
            redStance: opponentStance,
            redDoctrine: opponentDoctrine,
            blueDeployment: deployment,
            redDeployment: opponentDeployment,
            blueBuildPackage: buildPackage,
            redBuildPackage: opponentBuildPackage,
            blueObjectiveTechnique: objectiveTechnique,
            redObjectiveTechnique: opponentObjectiveTechnique,
            blueCounterstrike: counterstrike,
            redCounterstrike: opponentCounterstrike,
            blueRoundDecisions: autoBuy === "off" ? undefined : repeatOrder(coachOrder),
            redRoundDecisions: repeatOrder(opponentCoachOrder),
        });
        c.advanceRoundPartial(WARFRONT_TPS);   // seed one second; the frame pump streams the rest
        return c;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `run` intentionally forces a fresh sim (Restart)
    }, [blue, red, effectiveSeed, autoBuy, opponentAutoBuy, theme, stance, doctrine, opponentStance, opponentDoctrine, deployment, buildPackage, coachOrder, objectiveTechnique, counterstrike, opponentDeployment, opponentBuildPackage, opponentCoachOrder, opponentObjectiveTechnique, opponentCounterstrike, run]);
    const result = ctl.result;
    const clock = useRef<WfClockState>({ t: 0, playing: false, slow: 0, rate: safePlaybackRate });
    const shake = useRef(0);
    const camView = useRef<{ x: number; z: number; half: number }>({ x: 0, z: 0, half: 12 });
    const camCtl = useRef<WfCamCtl>({ mode: "follow", fx: 0, fz: 0, dist: 18 });
    const [freeCam, setFreeCam] = useState(false);
    const handleFreeCameraMode = useCallback((mode: "follow" | "free") => {
        setFreeCam(mode === "free");
    }, []);
    const [sfxMuted, setSfxMuted] = useState(() => isPetSfxMuted());
    useEffect(() => subscribeAudioMute(() => setSfxMuted(isPetSfxMuted())), []);
    useEffect(() => {
        if (sfxMuted) {
            stopWarfrontAudioBed();
            return;
        }
        primeWarfrontAudio();
        startWarfrontAudioBed();
        seekWarfrontAudio(result.events, Math.floor(wfClockTick(clock)));
        return stopWarfrontAudioBed;
    }, [result, sfxMuted]);
    const [reducedMotion, setReducedMotion] = useState(() => {
        try {
            const stored = localStorage.getItem("wfReducedMotion.v1");
            if (stored === "true" || stored === "false") return stored === "true";
        } catch { /* storage disabled — use the OS preference */ }
        return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    });
    const [uiScale, setUiScale] = useState<WfUiScale>(() => {
        try {
            const stored = localStorage.getItem("wfUiScale.v1");
            if (stored === "large" || stored === "standard") return stored;
        } catch { /* storage disabled — use the viewport-safe default */ }
        return typeof window !== "undefined" && window.matchMedia?.("(max-width: 600px)").matches ? "large" : "standard";
    });
    const [paceMode, setPaceMode] = useState<WarfrontPaceMode>(() => {
        try {
            const stored = localStorage.getItem("wfPace.v1");
            if (stored === "1" || stored === "1.5" || stored === "2" || stored === "smart") {
                const safe = warfrontPaceForMotion(stored, reducedMotion);
                if (safe !== stored) localStorage.setItem("wfPace.v1", safe);
                return safe;
            }
        } catch { /* storage disabled — use broadcast speed */ }
        return "1";
    });
    const [userPaused, setUserPaused] = useState(false);
    // Spectator camera mode — persisted per device; drag still enters free-cam.
    const [camMode, setCamModeState] = useState<WfCamMode>(() => {
        try {
            const v = localStorage.getItem("wfCamMode.v1");
            if (v === "broadcast" || v === "calm" || v === "team") return v;
        } catch { /* storage disabled — use the motion-safe default */ }
        return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "calm" : "broadcast";
    });
    const camModeRef = useRef<WfCamMode>("broadcast");
    useEffect(() => { camModeRef.current = camMode; });
    const setCamMode = (m: WfCamMode) => {
        setCamModeState(m);
        try { localStorage.setItem("wfCamMode.v1", m); } catch { /* storage disabled — ignore */ }
    };
    const [ended, setEnded] = useState(false);
    const [exitPrompt, setExitPrompt] = useState(false);
    const [exitPending, setExitPending] = useState(false);
    const [exitError, setExitError] = useState("");
    const exitWasPlaying = useRef(false);
    const exitDialogRef = useRef<HTMLDivElement>(null);
    const exitHeadingRef = useRef<HTMLHeadingElement>(null);
    const [assetsReady, setAssetsReady] = useState(false);
    const [flash, setFlash] = useState<{ id: number; color: string } | null>(null);
    const [banner, setBanner] = useState<{ id: number; text: string; color: string; big: boolean } | null>(null);
    const [replayClip, setReplayClip] = useState<{ label: string; startTick: number; eventTick: number; endTick: number } | null>(null);
    const replayCameraRestore = useRef<WfCamCtl | null>(null);
    const replayFocusRestore = useRef<{ petId: string | null; mini: number | null } | null>(null);
    const [feed, setFeed] = useState<Array<{ id: number; text: string; color: string }>>([]);
    const transientFxRef = useRef<TransientFx3DLayerApi | null>(null);
    const [council, setCouncil] = useState<{ round: number } | null>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const endDialogRef = useRef<HTMLDivElement>(null);
    const endHeadingRef = useRef<HTMLHeadingElement>(null);
    const replaySkipRef = useRef<HTMLButtonElement>(null);
    const focusBeforeTakeover = useRef<HTMLElement | null>(null);
    useEffect(() => {
        focusBeforeTakeover.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const id = window.requestAnimationFrame(() => stageRef.current?.focus());
        return () => {
            window.cancelAnimationFrame(id);
            focusBeforeTakeover.current?.focus();
        };
    }, []);
    useEffect(() => {
        if (!ended || replayClip) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const id = window.requestAnimationFrame(() => endHeadingRef.current?.focus());
        return () => {
            window.cancelAnimationFrame(id);
            if (previous?.isConnected) previous.focus();
        };
    }, [ended, replayClip]);
    useEffect(() => {
        if (!exitPrompt) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const id = window.requestAnimationFrame(() => exitHeadingRef.current?.focus());
        return () => {
            window.cancelAnimationFrame(id);
            if (previous?.isConnected) previous.focus();
        };
    }, [exitPrompt]);
    const trapExitDialogFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape" && !exitPending) { event.preventDefault(); setExitPrompt(false); clock.current.playing = exitWasPlaying.current && !userPaused && !council; return; }
        if (event.key !== "Tab") return;
        const focusable = Array.from(exitDialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === exitHeadingRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const trapEndDialogFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Tab") return;
        const focusable = Array.from(endDialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === endHeadingRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const trapTakeoverFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Tab" || exitPrompt || council || (ended && !replayClip)) return;
        const root = stageRef.current;
        if (!root) return;
        const focusable = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])"))
            .filter((element) => element !== root && element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== "hidden");
        if (!focusable.length) { event.preventDefault(); root.focus(); return; }
        const first = focusable[0], lastFocusable = focusable[focusable.length - 1], active = document.activeElement;
        if (!root.contains(active)) { event.preventDefault(); (event.shiftKey ? lastFocusable : first).focus(); }
        else if (event.shiftKey && (active === first || active === root)) { event.preventDefault(); lastFocusable.focus(); }
        else if (!event.shiftKey && active === lastFocusable) { event.preventDefault(); first.focus(); }
    };
    const [stageWidth, setStageWidth] = useState(1200);
    useLayoutEffect(() => {
        const el = stageRef.current;
        if (!el) return;
        const resize = () => setStageWidth(el.clientWidth);
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    const timerRef = useRef<HTMLSpanElement>(null);
    const coinBlueRef = useRef<HTMLSpanElement>(null);
    const coinRedRef = useRef<HTMLSpanElement>(null);
    const scoreBlueRef = useRef<HTMLSpanElement>(null);
    const scoreRedRef = useRef<HTMLSpanElement>(null);
    const killBlueRef = useRef<HTMLSpanElement>(null);
    const killRedRef = useRef<HTMLSpanElement>(null);
    const structsBlueRef = useRef<HTMLSpanElement>(null);
    const structsRedRef = useRef<HTMLSpanElement>(null);
    const sigilPipsBlueRef = useRef<HTMLSpanElement>(null);
    const sigilPipsRedRef = useRef<HTMLSpanElement>(null);
    const judgmentRef = useRef<HTMLSpanElement>(null);
    const stanceBlueRef = useRef<HTMLSpanElement>(null);
    const stanceRedRef = useRef<HTMLSpanElement>(null);
    const phaseRef = useRef<HTMLSpanElement>(null);
    const phaseClockRef = useRef<HTMLSpanElement>(null);
    const objectiveRef = useRef<HTMLSpanElement>(null);
    const stakesRef = useRef<HTMLSpanElement>(null);
    const blueIntentRef = useRef<HTMLSpanElement>(null);
    const redIntentRef = useRef<HTMLSpanElement>(null);
    const wardenWrapRef = useRef<HTMLDivElement>(null);
    const wardenHpRef = useRef<HTMLDivElement>(null);
    const wardenStatusRef = useRef<HTMLSpanElement>(null);
    const wardenDamageRef = useRef<HTMLSpanElement>(null);
    const sigilRef = useRef<HTMLSpanElement>(null);
    const phaseOverlayRef = useRef<HTMLDivElement>(null);
    const storyCam = useRef<WfStoryCam | null>(null);
    const directorSeek = useRef<WfDirectorSeek>({ generation: 0, tick: 0 });
    const focusMiniRef = useRef<number | null>(null);
    const [focusPetId, setFocusPetId] = useState<string | null>(null);
    const handleConvoyFollow = useCallback((padIdx: number) => {
        focusMiniRef.current = focusMiniRef.current === padIdx ? null : padIdx;
        setFocusPetId(null);
        camCtl.current.mode = "follow";
        setFreeCam(false);
        setCamModeState("broadcast");
        try { localStorage.setItem("wfCamMode.v1", "broadcast"); } catch { /* storage disabled — ignore */ }
    }, []);
    // Opening VS card — a studio title before the action reads. Motion-safe
    // viewers get the same strategic information without a four-second sweep.
    const [intro, setIntro] = useState(true);
    useEffect(() => {
        if (!intro || !assetsReady) return;
        clock.current.playing = false;
        const id = window.setTimeout(() => {
            setIntro(false);
            if (!council && !ended && !replayClip && !userPaused) clock.current.playing = true;
        }, reducedMotion ? 1100 : 4200);
        return () => window.clearTimeout(id);
    }, [assetsReady, council, ended, intro, reducedMotion, replayClip, userPaused]);
    const focusPetRef = useRef<string | null>(null);
    useEffect(() => { focusPetRef.current = focusPetId; }, [focusPetId]);
    const pipSubjectRef = useRef<string | null>(null);
    const pipLabelRef = useRef<HTMLSpanElement>(null);
    const pipStatusRef = useRef<HTMLSpanElement>(null);
    const pipHpRef = useRef<HTMLElement>(null);
    const myPets = useMemo(() => result.snapshots.at(0)!.actors.filter((a) => a.team === localTeam).map((a) => ({ id: a.id, name: roster.find((r) => r.id === a.id)?.pet.name ?? a.id })), [localTeam, result, roster]);
    const myPetIds = useMemo(() => myPets.map((pet) => pet.id), [myPets]);
    const multiCamOn = presentationBudget.squadCameras && myPetIds.length > 0;
    const pipWidth = Math.round(Math.min(210, Math.max(128, stageWidth * .38)));
    const pipHeight = Math.round(pipWidth * .6);

    const nameOf = useMemo(() => {
        const names = new Map(roster.map((r) => [r.id, r.pet.name]));
        return (id: string) => {
            if (names.has(id)) return names.get(id)!;
            if (id === "warden") return "the Gate Warden";
            if (id.startsWith("mini")) return "a Lesser Warden";
            if (id.startsWith("statue")) return "a Guardian Totem";
            if (id.startsWith("mob")) return "hollow-spawn";
            return id;
        };
    }, [roster]);

    // Short-lived HUD effects can schedule heavily during a crowded fight. Keep
    // their timers owned by this takeover so replay/restart and unmount cannot
    // let stale callbacks mutate a replacement match.
    const transientTimers = useRef(new Set<number>());
    const scheduleTransient = (callback: () => void, delay: number) => {
        const id = window.setTimeout(() => {
            transientTimers.current.delete(id);
            callback();
        }, delay);
        transientTimers.current.add(id);
        return id;
    };
    const clearTransientTimers = useCallback(() => {
        for (const id of transientTimers.current) window.clearTimeout(id);
        transientTimers.current.clear();
    }, []);
    useEffect(() => () => {
        for (const id of transientTimers.current) window.clearTimeout(id);
        transientTimers.current.clear();
    }, []);

    const pushFeed = (text: string, color: string) => {
        const id = wfSeq++;
        setFeed((arr) => {
            const next = [{ id, text, color }, ...arr];
            const orders = next.filter((item) => /^COUNCIL \d/.test(item.text)).slice(0, 2);
            return [...orders, ...next.filter((item) => !/^COUNCIL \d/.test(item.text)).slice(0, 6 - orders.length)];
        });
        scheduleTransient(() => setFeed((arr) => arr.filter((f) => f.id !== id)), 4500);
    };
    // Banner QUEUE: broadcast moments display SEQUENTIALLY (big ones hold the
    // screen longer) instead of stomping each other mid-animation.
    const bannerQueue = useRef<Array<{ id: number; text: string; color: string; big: boolean }>>([]);
    const bannerBusy = useRef(false);
    const pumpBanner = () => {
        const next = bannerQueue.current.shift();
        if (!next) { bannerBusy.current = false; setBanner(null); return; }
        bannerBusy.current = true;
        setBanner(next);
        scheduleTransient(pumpBanner, next.big ? 2300 : 1600);
    };
    const pushBanner = (text: string, color: string, big = false) => {
        if (bannerQueue.current.length >= 3) bannerQueue.current.shift();   // drop the stalest
        bannerQueue.current.push({ id: wfSeq++, text, color, big });
        if (!bannerBusy.current) pumpBanner();
    };
    const clearPresentationTransient = useCallback(() => {
        clearTransientTimers();
        bannerQueue.current = [];
        bannerBusy.current = false;
        shake.current = 0;
        setFeed([]);
        setBanner(null);
        setFlash(null);
        transientFxRef.current?.clear();
    }, [clearTransientTimers]);
    const triggerFlash = (color: string) => {
        if (reducedMotion) return;
        const id = wfSeq++;
        setFlash({ id, color });
        scheduleTransient(() => setFlash((f) => (f && f.id === id ? null : f)), 380);
    };
    const spawnFx = (x: number, z: number, key: string | null, element: string | null | undefined, scale: number, dur: number) => {
        if (reducedMotion) return;
        const frames = (key ? bundledJutsuFxFrames(key) : null) ?? bundledJutsuFxFrames(elementVfxKey(element)) ?? bundledJutsuFxFrames("none");
        if (!frames) return;
        transientFxRef.current?.spawnFx({ frames, pos: [x, 0.8, z], scale, durationMs: dur });
    };
    const spawnShot = (fromX: number, fromY: number, toX: number, toY: number, element: string | null | undefined, charged: boolean) => {
        if (reducedMotion) return;
        const visual = projectileVisual({ element, charged });
        const dist = Math.hypot(toX - fromX, toY - fromY);
        const dur = Math.min(820, Math.max(420, 260 + dist * 24));
        transientFxRef.current?.spawnShot({ from: [fromX, 0.9, fromY], to: [toX, 0.9, toY], visual, durationMs: dur, arc: 0.28 });
    };
    const spawnFloater = (x: number, z: number, text: string, color: string, big: boolean) => {
        if (reducedMotion) return;
        transientFxRef.current?.spawnFloater({ pos: [x, 1.5, z], text, color, big });
    };

    // Round boundary: interactive → pause + open the War Council; auto → advance.
    // "Latest ref" pattern: the ticker calls through the ref; the effect (not
    // render) keeps the closure fresh, which is compiler-safe.
    const boundaryBusy = useRef(false);
    const onFrontier = useRef<() => void>(() => {});
    const committedChoicesRef = useRef<WarfrontRoundChoice[]>(committedChoices);
    useEffect(() => { committedChoicesRef.current = committedChoices; }, [committedChoices]);
    // Council choices waiting to be applied to the STREAMED round.
    const pendingResume = useRef<WarfrontRoundDecision | null>(null);
    const pumpSim = useRef<() => void>(() => {});
    useEffect(() => {
        pumpSim.current = () => {
            if (ctl.done) return;
            const runway = warfrontSnapshotFrontier(result.snapshots) - wfClockTick(clock);
            if (runway > WARFRONT_TPS * 6) return;
            // Refill frequently in tiny slices. This keeps the same deterministic
            // runway without a periodic CPU burst interrupting skeletal motion.
            const chunk = adaptivePressure === 0 ? 8 : adaptivePressure === 1 ? 6 : 4;
            if (autoBuy !== "off") { ctl.advanceRoundPartial(chunk); return; }
            const pend = pendingResume.current;
            if (pend) {
                if (ctl.advanceRoundPartial(chunk, pend)) pendingResume.current = null;
                return;
            }
            // Round zero is the opening battle, before the first shopping phase.
            // Keep streaming it to 90s instead of treating the initial 8s runway
            // as a round frontier and presenting a Council whose buys cannot apply.
            if (ctl.round === 0) ctl.advanceRoundPartial(chunk);
            // Interactive with nothing pending: the clock reaches the frontier
            // and the War Council opens (onFrontier).
        };
    });
    useEffect(() => {
        onFrontier.current = () => {
            if (ctl.done || boundaryBusy.current || council) return;
            boundaryBusy.current = true;
            // A resumed Council streams its selected build into the next round.
            // If a slow frame consumes that small runway immediately, do not
            // reopen the same Council while those choices are still pending.
            if (pendingResume.current) {
                clock.current.playing = true;
                boundaryBusy.current = false;
                return;
            }
            // Round zero is the uninterrupted opening/laning round. Under an
            // accelerated clock (or a temporarily slow renderer), playback can
            // consume the tiny streamed runway before the next render pumps it.
            // Refill here instead of presenting a nonsensical "round 0" Council
            // a few seconds after the VS card.
            if (ctl.round === 0) {
                ctl.advanceRoundPartial(Math.max(WARFRONT_TPS * 6, Math.ceil(safePlaybackRate * WARFRONT_TPS * 2)));
                clock.current.playing = true;
                boundaryBusy.current = false;
                return;
            }
            if (autoBuy === "off") {
                // Reload/recovery replays the immutable server-accepted prefix
                // without reopening those rounds for a second branch. The next
                // uncommitted boundary remains interactive.
                const recovered = committedChoicesRef.current[ctl.round - 1];
                if (recovered?.round === ctl.round) {
                    pendingResume.current = recovered;
                    clock.current.playing = true;
                    boundaryBusy.current = false;
                    return;
                }
                clock.current.playing = false;
                setUserPaused(false);
                setCouncil({ round: ctl.round });
            } else {
                ctl.advanceRound();
                clock.current.playing = true;
                boundaryBusy.current = false;
            }
        };
    });
    const resumeFromCouncil = async (round: number, decision: WarfrontRoundDecision) => {
        if (onCouncilCommit) await onCouncilCommit(round, decision);
        setCouncil(null);
        // Streamed, not synchronous — the pump applies these on its next call.
        pendingResume.current = decision;
        clock.current.playing = true;
        setUserPaused(false);
        boundaryBusy.current = false;
    };

    // Replays (including a seven-second turning-point clip) must never submit a
    // second reward report. The result object changes only for a fresh sim run.
    const reportedResults = useRef(new WeakSet<WarfrontResult>());
    useEffect(() => {
        if (!ended || reportedResults.current.has(result)) return;
        reportedResults.current.add(result);
        onResult?.(result);
    }, [ended, onResult, result]);

    // Preload EVERY rig the match will mount — roster, hounds, the four camp
    // bosses and both sentinel bodies. Camp bosses used to lazy-load at their
    // 90 s spawn and drop a frame spike mid-match.
    useEffect(() => {
        let cancelled = false;
        let timeoutTimer = 0;
        const timeout = new Promise<void>((resolve) => {
            timeoutTimer = window.setTimeout(resolve, 4500);
        });
        const preload = Promise.all([
            import("../lib/pet-model-preload").then((m) => m.preloadPetWarfrontModels(roster.map((r) => r.pet))),
            preloadTransientFxTextures(WARFRONT_COMMON_FX),
        ]).then(() => undefined).catch(() => { /* fallbacks keep the match playable */ });
        void Promise.race([preload, timeout]).then(() => {
            if (!cancelled) setAssetsReady(true);
        });
        return () => {
            cancelled = true;
            window.clearTimeout(timeoutTimer);
        };
    }, [roster]);

    const chooseQuality = (next: PetVisualQuality) => {
        setQualityId(next);
        savePetVisualQuality(next);
        setAdaptivePressure(0);
    };

    // Verdict receipts: HOW the match was decided (seal destruction vs the
    // timer's judgment on structures-then-coins), with the tallies to prove it.
    const sealBroken = ended && result.events.some((e) => e.type === "coredown");
    const localVictory = result.winner === localTeam;
    const decisionReceipt = result.decisionReceipts?.[localTeam];
    const localSlots = localTeam === "blue" ? blue : red;
    const winLabel = result.winner === "draw" ? "Stalemate"
        : `${localVictory ? "Victory" : "Defeat"} · ${result.winner === "blue" ? "Blue" : "Red"} ${sealBroken ? "Shatters the Ward Seal" : "Wins the Judgment"}`;

    const finishReplayClip = useCallback(() => {
        clearPresentationTransient();
        const finalTick = warfrontSnapshotFrontier(result.snapshots);
        directorSeek.current = { generation: directorSeek.current.generation + 1, tick: finalTick };
        seekWarfrontAudio(result.events, finalTick);
        clock.current.playing = false;
        clock.current.slow = 0;
        clock.current.t = finalTick;
        if (replayCameraRestore.current) camCtl.current = replayCameraRestore.current;
        replayCameraRestore.current = null;
        if (replayFocusRestore.current) {
            focusMiniRef.current = replayFocusRestore.current.mini;
            setFocusPetId(replayFocusRestore.current.petId);
        }
        replayFocusRestore.current = null;
        storyCam.current = null;
        setReplayClip(null);
        setEnded(true);
        setUserPaused(false);
    }, [clearPresentationTransient, result]);
    useEffect(() => {
        if (!replayClip) return;
        const armFrame = requestAnimationFrame(() => { replaySkipRef.current?.focus(); clock.current.playing = true; });
        let frame = 0;
        const monitor = () => {
            if (clock.current.t >= replayClip.endTick) { finishReplayClip(); return; }
            frame = requestAnimationFrame(monitor);
        };
        frame = requestAnimationFrame(monitor);
        return () => { cancelAnimationFrame(armFrame); cancelAnimationFrame(frame); };
    }, [finishReplayClip, replayClip]);

    const replayTurningPoint = (event: WarfrontResult["events"][number], label: string) => {
        clearPresentationTransient();
        replayCameraRestore.current = camCtl.current.mode === "free" ? { ...camCtl.current } : null;
        replayFocusRestore.current = { petId: focusPetId, mini: focusMiniRef.current };
        const startTick = Math.max(0, event.t - WARFRONT_TPS * 3);
        const endTick = Math.min(warfrontSnapshotFrontier(result.snapshots), event.t + WARFRONT_TPS * 4);
        const eventSnap = warfrontSnapshotAtTick(result.snapshots, event.t) ?? result.snapshots.at(0)!;
        const startSnap = warfrontSnapshotAtTick(result.snapshots, startTick) ?? result.snapshots.at(0)!;
        let focus = wfCameraFocus(startSnap, 0, 0, localTeam);
        if ("x" in event && "y" in event && typeof event.x === "number" && typeof event.y === "number") focus = { fx: event.x, fz: event.y, span: 13 };
        else if (event.type === "wardenkill" || event.type === "wardenphase") focus = { fx: WF_LAIR.x, fz: WF_LAIR.y, span: 15 };
        else if (event.type === "coreexposed" || event.type === "coredown") { const core = eventSnap.structures[event.team].core; focus = { fx: core.x, fz: core.y, span: 13 }; }
        else if (event.type === "statuedown") { const statue = eventSnap.structures[event.team].statues[event.statue]; if (statue) focus = { fx: statue.x, fz: statue.y, span: 12 }; }
        else if (event.type === "guardiandown") { const guardian = eventSnap.guardians[event.team][event.idx]; if (guardian) focus = { fx: guardian.x, fz: guardian.y, span: 12 }; }
        else if (event.type === "minikill") { const mini = eventSnap.minis.find((item) => item.padIdx === event.padIdx); if (mini) focus = { fx: mini.x, fz: mini.y, span: 13 }; }
        else if (event.type === "kill" || event.type === "shutdown") { const target = eventSnap.actors.find((actor) => actor.id === event.targetId); if (target) focus = { fx: target.x, fz: target.y, span: 12 }; }
        else if (event.type === "techniqueused") { const mini = eventSnap.minis.find((item) => item.padIdx === event.padIdx); if (mini) focus = { fx: mini.x, fz: mini.y, span: 12 }; }
        else if (event.type === "counterstrikeclaim") { const target = eventSnap.actors.find((actor) => actor.id === event.targetId); if (target) focus = { fx: target.x, fz: target.y, span: 12 }; }
        else if (event.type === "counterstrike") { const target = event.targetId ? eventSnap.actors.find((actor) => actor.id === event.targetId) : null; const statue = eventSnap.structures[event.team].statues[event.statue]; if (target ?? statue) focus = { fx: (target ?? statue)!.x, fz: (target ?? statue)!.y, span: 12 }; }
        startWarfrontAudioBed();
        const silentFrontier = startTick === 0 ? -1 : startTick;
        seekWarfrontAudio(result.events, silentFrontier);
        directorSeek.current = { generation: directorSeek.current.generation + 1, tick: silentFrontier };
        storyCam.current = { x: focus.fx, z: focus.fz, fromT: startTick, untilT: endTick, span: focus.span, prio: 10 };
        clock.current = { t: startTick, playing: false, slow: 0, rate: 1 };
        focusMiniRef.current = null;
        setFocusPetId(null);
        setIntro(false);
        setCouncil(null);
        setEnded(false);
        setUserPaused(false);
        setReplayClip({ label, startTick, eventTick: event.t, endTick });
    };

    // ⟲/↻/🎲 controls: Replay rewinds the clock (the director re-fires events
    // and later councils reopen on schedule); Restart rebuilds the sim on the
    // SAME seed; New match rolls a fresh deterministic seed (vs-AI/harness only).
    const resetTransient = () => {
        startWarfrontAudioBed();
        seekWarfrontAudio(result.events, -1);
        clearPresentationTransient();
        clock.current = { t: 0, playing: false, slow: 0, rate: safePlaybackRate };
        storyCam.current = null;
        focusMiniRef.current = null;
        setFocusPetId(null);
        setIntro(true);
        setReplayClip(null);
        replayCameraRestore.current = null;
        replayFocusRestore.current = null;
        setAdaptivePressure(0);
        pendingResume.current = null;
        boundaryBusy.current = false;
        setEnded(false);
        setUserPaused(false);
        setCouncil(null);
    };
    const doReplay = () => resetTransient();
    const doRestart = () => { setRun((r) => r + 1); resetTransient(); };
    const doNewMatch = () => { setSeedBump((b) => b + 1); setRun((r) => r + 1); resetTransient(); };

    const togglePause = () => {
        if (!assetsReady || intro || council || ended) return;
        const next = !userPaused;
        setUserPaused(next);
        clock.current.playing = !next;
        clock.current.slow = 0;
        if (next) shake.current = 0;
    };
    const chooseUiScale = (next: WfUiScale) => {
        setUiScale(next);
        try { localStorage.setItem("wfUiScale.v1", next); } catch { /* storage disabled — session setting still works */ }
    };
    const choosePace = (next: WarfrontPaceMode) => {
        const safe = warfrontPaceForMotion(next, reducedMotion);
        setPaceMode(safe);
        clock.current.slow = 0;
        try { localStorage.setItem("wfPace.v1", safe); } catch { /* storage disabled — session setting still works */ }
    };
    const toggleReducedMotion = () => {
        const next = !reducedMotion;
        setReducedMotion(next);
        try { localStorage.setItem("wfReducedMotion.v1", String(next)); } catch { /* storage disabled — session setting still works */ }
        if (next) {
            choosePace("1");
            shake.current = 0;
            setFlash(null);
            transientFxRef.current?.clear();
            setCamMode("calm");
        }
    };
    const confirmLiveAction = (message: string, action: () => void) => {
        if (ended || intro || wfClockTick(clock) < WARFRONT_TPS * 5) { action(); return; }
        const wasPlaying = clock.current.playing;
        clock.current.playing = false;
        const approved = window.confirm(message);
        if (approved) action();
        else clock.current.playing = wasPlaying && !userPaused && !council;
    };
    const requestExit = () => {
        if (!onForfeit || ended) { confirmLiveAction("Leave this Warfront? The current battle will be abandoned.", onExit); return; }
        exitWasPlaying.current = clock.current.playing;
        clock.current.playing = false;
        setExitError("");
        setExitPrompt(true);
    };
    const cancelExit = () => {
        if (exitPending) return;
        setExitPrompt(false);
        setExitError("");
        clock.current.playing = exitWasPlaying.current && !userPaused && !council;
    };
    const confirmForfeit = async () => {
        if (!onForfeit || exitPending) return;
        setExitPending(true);
        setExitError("");
        try {
            await onForfeit();
        } catch (error) {
            setExitError(error instanceof Error ? error.message : "The server could not secure this forfeit. Retry or return to the match.");
            setExitPending(false);
        }
    };

    const btn: CSSProperties = { padding: "6px 10px", background: "rgba(15,23,42,0.88)", border: "1px solid #475569", borderRadius: 8, color: "#e2e8f0", cursor: "pointer", font: "700 14px Inter, system-ui, sans-serif" };
    const metaControl: CSSProperties = { display: "flex", alignItems: "center", gap: 4, padding: "3px 7px", background: "rgba(15,23,42,0.9)", border: "1px solid #475569", borderRadius: 999, color: "#cbd5e1", font: "700 12px Inter, system-ui, sans-serif" };
    const metaSelect: CSSProperties = { background: "#0f172a", border: 0, color: "#e2e8f0", font: "700 12px Inter, system-ui, sans-serif", cursor: "pointer" };
    const blueDoctrine = doctrineSpec(result.doctrines.blue);
    const redDoctrine = doctrineSpec(result.doctrines.red);
    const blueDeploymentPlan = deployment ?? WF_DEFAULT_DEPLOYMENT;
    const redDeploymentPlan = opponentDeployment ?? WF_DEFAULT_DEPLOYMENT;
    const bluePackage = buildPackageSpec(buildPackage), redPackage = buildPackageSpec(opponentBuildPackage);
    const blueOrder = coachOrderSpec(coachOrder), redOrder = coachOrderSpec(opponentCoachOrder);
    const openingLine = result.opening.winner
        ? `${result.opening.winner === localTeam ? "YOUR SQUAD" : "RIVAL SQUAD"} COUNTERS · +${result.opening.attackPct}% ATTACK · +${result.opening.speedPct}% SPEED FOR ${result.opening.durationSecs}s`
        : result.opening.reason === "mirror" ? "MIRRORED DOCTRINES · EVEN OPENING" : "NEUTRAL MATCHUP · NO OPENING EDGE";

    return createPortal((
        <div
            ref={stageRef}
            className="pet-combat-takeover pet-warfront-takeover"
            role="dialog"
            aria-modal="true"
            aria-label="Hollow Warfront match"
            tabIndex={-1}
            onKeyDown={trapTakeoverFocus}
            data-wf-motion={reducedMotion ? "reduced" : "full"}
            data-wf-ui-scale={uiScale}
            data-wf-replay-focus={replayClip ? "locked" : "off"}
            data-wf-camera-effective={replayClip ? "story" : freeCam ? "free" : camMode}
            style={{ backgroundColor: "#05060a" }}
        >
            <style>{`@keyframes arenaFloat{0%{transform:translateY(4px);opacity:0}15%{opacity:1}100%{transform:translateY(-30px);opacity:0}}@keyframes wfLoad{from{transform:translateX(-10%);opacity:.55}to{transform:translateX(120%);opacity:1}}@keyframes wfFeedIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}@keyframes wfFlash{0%{opacity:0}12%{opacity:0.85}100%{opacity:0}}@keyframes wfBanner{0%{opacity:0;transform:translate(-50%,-50%) scale(0.72)}12%{opacity:1;transform:translate(-50%,-50%) scale(1.05)}22%{transform:translate(-50%,-50%) scale(1)}84%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-56%) scale(1)}}@keyframes wfShine{0%{transform:translateX(-140%) skewX(-18deg)}60%,100%{transform:translateX(260%) skewX(-18deg)}}@keyframes wfTilePulse{0%,100%{box-shadow:0 0 6px rgba(251,113,133,0.35)}50%{box-shadow:0 0 20px rgba(251,113,133,0.95)}}@keyframes wfIntro{0%{opacity:0;transform:scale(0.94)}10%{opacity:1;transform:scale(1)}82%{opacity:1}100%{opacity:0;transform:scale(1.02)}}@keyframes wfEndIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}@media(max-width:979px){.pet-warfront-takeover .wf-team-intent,.pet-warfront-takeover .wf-stakes-arrow{display:none}.pet-warfront-takeover .wf-live-stakes{max-inline-size:100%;text-align:center}}`}</style>
            <style>{`
                .pet-warfront-takeover button,.pet-warfront-takeover select,.pet-warfront-takeover [tabindex]{touch-action:manipulation}
                .pet-warfront-takeover button:focus-visible,.pet-warfront-takeover select:focus-visible,.pet-warfront-takeover [tabindex]:focus-visible{outline:3px solid #fde047!important;outline-offset:2px}
                .pet-warfront-takeover[data-wf-motion="reduced"] *{animation-duration:.001ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.001ms!important}
                .pet-warfront-takeover[data-wf-motion="reduced"] .wf-banner,.pet-warfront-takeover[data-wf-motion="reduced"] .wf-intro-overlay{animation:none!important;opacity:1!important}
                .pet-warfront-takeover[data-wf-motion="reduced"] .wf-banner{transform:translate(-50%,-50%)!important}
                .pet-warfront-takeover[data-wf-motion="reduced"] .wf-banner-shine{display:none}
                .wf-top-controls button{min-height:38px;font-size:14px!important}
                .wf-score-strip{font-size:15px!important;z-index:52}
                .wf-score-strip span{font-size:inherit!important}
                .wf-objective-main>span{font-size:13px!important}
                .wf-live-stakes,.wf-team-intent,.wf-warden-strip span{font-size:12px!important}
                .wf-camera-modes button{min-width:40px;min-height:38px;font-size:14px!important}
                .wf-feed-item{font-size:13px!important}
                .wf-council-backdrop{position:absolute;inset:0;display:grid;place-items:center;background:#030712c2;z-index:80}
                .wf-council-dialog{width:min(920px,96vw);max-height:min(86vh,760px);overflow-y:auto;background:#0a0e1cfa;border:1px solid #a855f7b3;border-radius:16px;padding:18px;box-shadow:0 24px 90px #000b}
                .wf-council-dialog button{min-height:44px;padding:8px 12px;background:#0f172ae6;border:1px solid #475569;border-radius:9px;color:#e2e8f0;cursor:pointer;font:700 14px/1.25 Inter,system-ui,sans-serif}
                .wf-council-dialog button:disabled{cursor:not-allowed;opacity:.55}
                .wf-council-header,#wf-council-help,.wf-council-actions,.wf-council-actions>div,.wf-council-context,.wf-council-cart{display:flex;align-items:center}
                .wf-council-header{justify-content:space-between;align-items:baseline;margin-bottom:8px}
                .wf-council-header h2{margin:0;color:#e9d5ff;font:900 22px Inter,system-ui,sans-serif}
                .wf-council-coins{color:#fde047;font:800 18px Inter,system-ui,sans-serif}
                #wf-council-help{justify-content:space-between;gap:10px;flex-wrap:wrap;color:#cbd5e1;font:600 14px/1.4 Inter,system-ui,sans-serif;margin-bottom:12px}
                #wf-council-help strong{color:#fde68a}#wf-council-help strong.urgent{color:#fca5a5}
                #wf-council-help .wf-council-contract{flex:1 0 100%;color:#94a3b8;font-size:12px}
                .wf-council-context{flex-wrap:wrap;gap:6px;margin-bottom:10px}
                .wf-council-context span{padding:5px 8px;border-radius:999px;background:#1e293bd9;border:1px solid #475569;color:#e2e8f0;font:800 12px Inter,system-ui,sans-serif}
                .wf-council-reserve{margin:0 0 12px;padding:9px 11px;border:1px solid #93c5fd88;border-radius:9px;background:#1e3a8a33;color:#dbeafe;font:800 14px/1.35 Inter,system-ui,sans-serif}
                .wf-council-block,.wf-council-special{border-top:1px solid #475569b3;padding-top:10px}.wf-council-orders-block,.wf-council-special{margin-top:10px}
                .wf-council-heading,.wf-special-title{color:#f8fafc;font:900 15px Inter,system-ui,sans-serif;margin-bottom:7px}.wf-special-title{font-size:14px;margin-bottom:6px}
                .wf-council-heading span,.wf-special-title span{color:#86efac;font-size:12px}
                .wf-council-upgrades,.wf-council-orders{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:8px}
                .wf-council-option{display:grid;align-content:start;gap:4px;text-align:left}.wf-option-top{display:flex;justify-content:space-between;gap:6px}.wf-option-top>span{color:#fde047}
                .wf-option-desc{color:#e2e8f0;font-size:12px;font-weight:600}.wf-option-detail{color:#a5b4fc;font-size:11px}
                .wf-package-option[aria-pressed=true]{border-color:#c4b5fd;background:#6d28d947;box-shadow:0 0 0 2px #c4b5fd29}
                .wf-order-option[aria-pressed=true]{border-color:#6ee7b7;color:#d1fae5;box-shadow:0 0 0 2px #6ee7b733}
                .wf-technique-option[aria-pressed=true]{border-color:#38bdf8}.wf-counter-option[aria-pressed=true]{border-color:#fb7185}
                .wf-council-cart{flex-wrap:wrap;gap:6px;margin-top:8px}.wf-council-dialog .wf-cart-chip,.wf-council-dialog .wf-bank-button{min-height:36px;padding:5px 8px;font-size:12px}.wf-cart-chip{border-color:#7c3aed!important}.wf-bank-copy{color:#fde68a;font:700 12px Inter,system-ui,sans-serif}
                .wf-council-special{display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:10px}.wf-tactic-options{display:grid;gap:5px}.wf-tactic-spent,.wf-tactic-armed{color:#94a3b8;font-size:12px}.wf-tactic-armed{color:#86efac}
                .wf-council-formation{display:flex;align-items:center;gap:8px;margin-top:10px;color:#cbd5e1;font:700 12px Inter,system-ui,sans-serif}.wf-council-formation select{min-height:40px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f8fafc;padding:6px 8px}
                .wf-council-error{margin:10px 4px 0;color:#fca5a5;font:700 14px/1.4 Inter,system-ui,sans-serif}
                .wf-council-actions{position:sticky;bottom:-18px;justify-content:space-between;margin:14px -18px -18px;padding:14px;gap:8px;background:#0a0e1cfa;border-top:1px solid #334155}.wf-council-actions>div{gap:8px}.wf-council-actions>div>span{color:#fde047;font-weight:800}.wf-council-primary-actions{display:flex;gap:8px}.wf-timer-button[aria-pressed=true]{border-color:#fbbf24!important}.wf-council-dialog .wf-council-exit{border-color:#fb7185;color:#fecdd3;background:#4c051966}.wf-council-dialog .wf-council-commit{background:#6d28d9;border-color:#c4b5fd;padding-inline:18px}
                .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-top-controls button,
                .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-camera-modes button,
                .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-top-meta label,
                .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-top-meta select{font-size:16px!important;min-height:44px}
                .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-score-strip{font-size:18px!important}
                .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-objective-main>span,
                .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-live-stakes,
                .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-team-intent,
                .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-feed-item{font-size:16px!important}
                @media(max-width:600px){
                    .pet-warfront-takeover .wf-top-controls{top:max(8px,env(safe-area-inset-top,0px))!important;left:max(8px,env(safe-area-inset-left,0px))!important;right:max(8px,env(safe-area-inset-right,0px))!important;gap:5px!important;justify-content:center;z-index:62}
                    .pet-warfront-takeover .wf-top-controls button{min-width:44px;min-height:44px;padding:6px 8px!important;font-size:14px!important}
                    .pet-warfront-takeover .wf-control-label{position:absolute!important;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
                    .pet-warfront-takeover .wf-score-strip{top:calc(max(8px,env(safe-area-inset-top,0px)) + 46px)!important;left:max(8px,env(safe-area-inset-left,0px))!important;right:max(8px,env(safe-area-inset-right,0px))!important;width:auto;transform:none!important;padding:6px 8px!important;gap:3px!important;border-radius:11px!important}
                    .pet-warfront-takeover .wf-score-strip{font-size:13px!important}
                    .pet-warfront-takeover .wf-score-strip>div{gap:5px!important;max-width:100%}
                    .pet-warfront-takeover .wf-score-strip>div:last-child,.pet-warfront-takeover .wf-score-strip>div:last-child>span{white-space:nowrap;line-height:1}
                    .pet-warfront-takeover .wf-score-doctrine,.pet-warfront-takeover .wf-score-stance{display:none}
                    .pet-warfront-takeover .wf-score-divider{width:54px!important}
                    .pet-warfront-takeover .wf-objective-strip{top:calc(max(8px,env(safe-area-inset-top,0px)) + 108px)!important;left:max(8px,env(safe-area-inset-left,0px))!important;right:max(8px,env(safe-area-inset-right,0px))!important;width:auto!important;transform:none!important;padding:7px 9px!important;background:rgba(8,12,24,.92)!important;border-radius:10px;z-index:50}
                    .pet-warfront-takeover .wf-objective-main{gap:6px!important;flex-wrap:wrap;line-height:1.2}
                    .pet-warfront-takeover .wf-objective-main>span{font-size:12px!important}
                    .pet-warfront-takeover .wf-objective-separator{display:none}
                    .pet-warfront-takeover .wf-stakes-row{line-height:1.3}
                    .pet-warfront-takeover .wf-live-stakes{font-size:11px!important}
                    .pet-warfront-takeover .wf-warden-strip{grid-template-columns:1fr 112px 1fr!important;column-gap:5px!important}
                    .pet-warfront-takeover .wf-warden-strip span{min-width:0!important;font-size:10px!important}
                    .pet-warfront-takeover .wf-camera-modes{top:calc(max(8px,env(safe-area-inset-top,0px)) + 228px)!important;left:max(8px,env(safe-area-inset-left,0px))!important;z-index:54}
                    .pet-warfront-takeover .wf-right-stack{top:calc(max(8px,env(safe-area-inset-top,0px)) + 228px)!important;right:max(8px,env(safe-area-inset-right,0px))!important;z-index:53}
                    .pet-warfront-takeover .wf-minimap{width:176px!important;height:auto!important}
                    .pet-warfront-takeover .wf-convoy-follow{width:176px!important}
                    .pet-warfront-takeover .wf-top-meta{top:auto!important;bottom:max(8px,env(safe-area-inset-bottom,0px))!important;left:auto!important;right:max(8px,env(safe-area-inset-right,0px))!important;display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));width:196px;max-width:calc(58vw - max(8px,env(safe-area-inset-right,0px)));gap:4px!important;align-items:stretch!important;z-index:56}
                    .pet-warfront-takeover .wf-mode-badge{display:none}
                    .pet-warfront-takeover .wf-top-meta label{box-sizing:border-box;width:100%;min-width:0!important;min-height:44px;font-size:12px!important;padding:3px 5px!important;justify-content:space-between}
                    .pet-warfront-takeover .wf-top-meta select{min-width:0;max-width:58px;font-size:11px!important}
                    .pet-warfront-takeover .wf-pace-label{display:none}
                    .pet-warfront-takeover .wf-motion-toggle{width:100%;min-width:44px;min-height:44px!important;font-size:18px!important}
                    .pet-warfront-takeover .wf-free-camera{top:calc(max(8px,env(safe-area-inset-top,0px)) + 278px)!important;left:max(8px,env(safe-area-inset-left,0px))!important}
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-free-camera{min-height:44px;font-size:15px!important}
                    .pet-warfront-takeover .wf-multicam-wall{left:max(8px,env(safe-area-inset-left,0px))!important;right:auto!important;bottom:max(8px,env(safe-area-inset-bottom,0px))!important;max-width:42vw}
                    .pet-warfront-takeover .wf-replay-chip{top:calc(max(8px,env(safe-area-inset-top,0px)) + 146px)!important;max-width:calc(100vw - max(8px,env(safe-area-inset-left,0px)) - max(8px,env(safe-area-inset-right,0px)))}
                    .pet-warfront-takeover .wf-intro-card{max-width:calc(100vw - 24px);padding:12px}
                    .pet-warfront-takeover .wf-intro-versus{gap:10px!important}
                    .pet-warfront-takeover .wf-intro-versus>div:first-child,.pet-warfront-takeover .wf-intro-versus>div:last-child{min-width:0;max-width:42vw}
                    .pet-warfront-takeover .wf-council-backdrop{padding:max(8px,env(safe-area-inset-top,0px)) max(8px,env(safe-area-inset-right,0px)) max(8px,env(safe-area-inset-bottom,0px)) max(8px,env(safe-area-inset-left,0px));box-sizing:border-box}
                    .pet-warfront-takeover .wf-council-dialog{box-sizing:border-box;width:100%!important;max-width:100%!important;max-height:100%!important;padding:14px!important;border-radius:12px!important;overflow-x:hidden!important}
                    .pet-warfront-takeover .wf-council-dialog button,.pet-warfront-takeover .wf-council-dialog select{min-height:44px!important}
                    .pet-warfront-takeover .wf-council-orders,.pet-warfront-takeover .wf-council-upgrades,.pet-warfront-takeover .wf-council-special{grid-template-columns:minmax(0,1fr)!important;align-items:stretch!important}
                    .pet-warfront-takeover .wf-council-orders button,.pet-warfront-takeover .wf-council-upgrades button,.pet-warfront-takeover .wf-council-special button{box-sizing:border-box;min-width:0!important;min-height:44px;padding:8px!important}
                    .pet-warfront-takeover .wf-council-formation{display:grid!important;grid-template-columns:1fr!important;font-size:14px!important}
                    .pet-warfront-takeover .wf-council-formation select{box-sizing:border-box;width:100%;min-height:44px;font-size:16px!important}
                    .pet-warfront-takeover .wf-council-actions{bottom:-14px!important;margin:12px -14px -14px!important;padding:10px!important;flex-wrap:wrap}
                    .pet-warfront-takeover .wf-council-actions>div{display:grid!important;grid-template-columns:1fr;flex:1 1 100%}
                    .pet-warfront-takeover .wf-council-primary-actions{grid-template-columns:1fr!important;width:100%}
                    .pet-warfront-takeover .wf-end-card{width:calc(100vw - max(8px,env(safe-area-inset-left,0px)) - max(8px,env(safe-area-inset-right,0px)))!important;max-height:calc(100dvh - max(8px,env(safe-area-inset-top,0px)) - max(8px,env(safe-area-inset-bottom,0px)))!important;padding:16px 10px!important}
                    .pet-warfront-takeover .wf-end-timeline{grid-template-columns:repeat(2,minmax(0,1fr))!important}
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-score-strip{font-size:18px!important}
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-score-secondary,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-phase-clock,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-team-intent,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-stakes-arrow,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-warden-damage{display:none!important}
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-phase-label{font-size:14px!important}
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-objective-call,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-live-stakes,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-warden-status,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-feed-item{font-size:18px!important}
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-warden-strip{grid-template-columns:auto minmax(112px,1fr)!important}
                    .pet-warfront-takeover[data-wf-ui-scale="large"] #wf-council-help,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-council-orders button,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-council-upgrades button,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-council-special button,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-council-actions button{font-size:18px!important;min-height:44px}
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-council-orders button span,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-council-upgrades button span,
                    .pet-warfront-takeover[data-wf-ui-scale="large"] .wf-council-special button span{font-size:14px!important;line-height:1.35!important}
                }
            `}</style>
            <div className="pet-warfront-canvas-stage" style={{ position: "absolute", inset: 0 }}>
                <Canvas
                    dpr={canvasDpr}
                    frameloop={geometryQa ? "demand" : "always"}
                    shadows={!geometryQa && quality.id === "high" && adaptivePressure === 0 ? "percentage" : false}
                    camera={{ fov: A3D_FOV, near: 0.5, far: 160, position: [0, 20, 24] }}
                    gl={{ antialias: true }}
                >
                    {geometryQa ? (
                        <>
                            {/* DPR/alignment automation has separate lifecycle coverage for
                                the complete scene. Keep a real R3F/WebGL canvas and the real
                                pointer controls without constructing every scene asset four
                                times in serial software-renderer projects. */}
                            <color attach="background" args={[spec.voidColor]} />
                            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                                <planeGeometry args={[48, 28]} />
                                <meshBasicMaterial color={spec.groundLight} />
                            </mesh>
                            {!replayClip && <WfCameraControls camCtlRef={camCtl} onModeChange={handleFreeCameraMode} />}
                        </>
                    ) : (
                        <>
                    <color attach="background" args={[spec.voidColor]} />
                    <fog attach="fog" args={[spec.fogColor, 26, 64]} />
                    {/* Warm key + cool fill: the warm/cool contrast that makes
                        painted environments read as LIT instead of flat. */}
                    <hemisphereLight args={[spec.skyLight, spec.groundLight, 1.15]} />
                    <directionalLight position={[-12, 10, -9]} intensity={0.5} color="#7ea8c4" />
                    {!geometryQa && quality.dynamicPetLight && adaptivePressure === 0 && <pointLight position={[0, 2.6, 0]} color={spec.breachGlow} intensity={3.4} distance={18} decay={2} />}
                    <directionalLight
                        position={[10, 17, 7]} intensity={1.85} color={spec.sunColor} castShadow={!geometryQa && quality.modelShadows && adaptivePressure === 0}
                        shadow-mapSize-width={quality.id === "high" ? 2048 : 1024} shadow-mapSize-height={quality.id === "high" ? 2048 : 1024}
                        shadow-camera-left={-24} shadow-camera-right={24} shadow-camera-top={15} shadow-camera-bottom={-15} shadow-camera-far={60}
                    />
                    <WfFloor theme={theme} reducedMotion={reducedMotion} />
                    <WfSetDressing theme={theme} />
                    {roster.map((r) => (
                        // Always render — a pet without an approved GLB falls back
                        // to a visible placeholder inside WfFighter3D (never null).
                        <WfFighter3D key={r.id} result={result} clock={clock} id={r.id} pet={r.pet} config={configs.get(r.id) ?? null} />
                    ))}
                    <WfMobPool result={result} clock={clock} budget={presentationBudget} />
                    {(["blue", "red"] as const).map((team) => [0, 1].map((gi) => (
                        <WfGuardian key={`${team}g${gi}`} result={result} clock={clock} team={team} idx={gi} />
                    )))}
                    {WF_BUSHES.map(([bx, by, br], i) => (
                        <group key={`bush${i}`} position={[bx, 0, by]}>
                            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} renderOrder={-1}>
                                <circleGeometry args={[br, 22]} />
                                <meshBasicMaterial color="#1c3a1c" transparent opacity={0.65} depthWrite={false} />
                            </mesh>
                            {Array.from({ length: 8 }, (_, k) => {
                                const a = (k / 8) * Math.PI * 2 + i;
                                return (
                                    <mesh key={k} position={[Math.cos(a) * br * 0.55, 0.28, Math.sin(a) * br * 0.55]} rotation={[0, a, (k % 2 ? 0.18 : -0.18)]}>
                                        <coneGeometry args={[0.16, 0.62, 5]} />
                                        <meshStandardMaterial color="#2c5a2a" roughness={0.9} />
                                    </mesh>
                                );
                            })}
                        </group>
                    ))}
                    {(["blue", "red"] as const).map((team) => (
                        <group key={team}>
                            <WfStatue result={result} clock={clock} team={team} idx={0} />
                            <WfStatue result={result} clock={clock} team={team} idx={1} />
                            <WfCore result={result} clock={clock} team={team} reducedMotion={reducedMotion} />
                        </group>
                    ))}
                    <WfWarden result={result} clock={clock} />
                    {WF_PADS.map((_, i) => (
                        <WfMini key={i} result={result} clock={clock} idx={i} name={WF_MINI_NAMES[i]} glow={spec.breachGlow} />
                    ))}
                    <TransientFx3DLayer apiRef={transientFxRef} />
                    {!geometryQa && !reducedMotion && <Sparkles count={adaptivePressure === 0 ? Math.max(12, quality.ambientParticles) : adaptivePressure === 1 ? 10 : 5} scale={[42, 7, 21]} position={[0, 3, 0]} size={2} speed={0.14} opacity={0.24} color={spec.sunColor} noise={2} />}
                    <WfCameraRig result={result} clock={clock} shake={shake} camViewRef={camView} camCtlRef={camCtl} storyRef={storyCam} modeRef={camModeRef} focusPetRef={focusPetRef} focusMiniRef={focusMiniRef} localTeam={localTeam} reducedMotion={reducedMotion} />
                    {!replayClip && <WfCameraControls camCtlRef={camCtl} onModeChange={handleFreeCameraMode} />}
                    <WfTicker result={result} clockRef={clock} shakeRef={shake} onFrontier={onFrontier} pumpRef={pumpSim} playbackRate={safePlaybackRate} paceMode={paceMode} replay={!!replayClip} />
                    {!fixedQaDpr && <WfFrameGovernor value={adaptivePressure} onPressure={setAdaptivePressure} />}
                    <WfDirector result={result} clockRef={clock} seekRef={directorSeek} reducedMotion={reducedMotion} nameOf={nameOf} pushFeed={pushFeed} pushBanner={pushBanner} triggerFlash={triggerFlash} shakeRef={shake} spawnFx={spawnFx} spawnShot={spawnShot} spawnFloater={spawnFloater} storyRef={storyCam} onEnd={() => { setEnded(true); setUserPaused(false); }} />
                    <WfHudWriter result={result} clock={clock} localTeam={localTeam} timerRef={timerRef} coinBlueRef={coinBlueRef} coinRedRef={coinRedRef} scoreBlueRef={scoreBlueRef} scoreRedRef={scoreRedRef} killBlueRef={killBlueRef} killRedRef={killRedRef} structsBlueRef={structsBlueRef} structsRedRef={structsRedRef} stanceBlueRef={stanceBlueRef} stanceRedRef={stanceRedRef} phaseRef={phaseRef} phaseClockRef={phaseClockRef} objectiveRef={objectiveRef} stakesRef={stakesRef} blueIntentRef={blueIntentRef} redIntentRef={redIntentRef} wardenWrapRef={wardenWrapRef} wardenHpRef={wardenHpRef} wardenStatusRef={wardenStatusRef} wardenDamageRef={wardenDamageRef} sigilRef={sigilRef} sigilPipsBlueRef={sigilPipsBlueRef} sigilPipsRedRef={sigilPipsRedRef} judgmentRef={judgmentRef} phaseOverlayRef={phaseOverlayRef} />
                    {!geometryQa && multiCamOn && <WfStoryPip result={result} clock={clock} petIds={myPetIds} selectedRef={focusPetRef} storyRef={storyCam} subjectRef={pipSubjectRef} width={pipWidth} height={pipHeight} renderEvery={presentationBudget.squadCameraRenderEvery} nameOf={nameOf} labelRef={pipLabelRef} statusRef={pipStatusRef} hpRef={pipHpRef} />}
                        </>
                    )}
                </Canvas>
            </div>

            {!assetsReady && (
                <div
                    role="status"
                    aria-live="polite"
                    style={{ position: "absolute", inset: 0, zIndex: 96, display: "grid", placeItems: "center", background: "radial-gradient(ellipse at center, rgba(8,12,24,0.82), rgba(3,6,14,0.97))" }}
                >
                    <div style={{ width: "min(360px, 82vw)", padding: "20px 24px", textAlign: "center", border: "1px solid rgba(168,85,247,0.55)", borderRadius: 14, background: "rgba(8,12,24,0.9)", boxShadow: "0 18px 60px rgba(0,0,0,0.55)" }}>
                        <div style={{ color: "#d8b4fe", font: "900 16px Inter, system-ui, sans-serif", letterSpacing: 3 }}>PREPARING WARFRONT</div>
                        <div style={{ height: 4, marginTop: 12, overflow: "hidden", borderRadius: 999, background: "#1e1b2e" }}>
                            <div style={{ width: "48%", height: "100%", borderRadius: 999, background: "linear-gradient(90deg,#7c3aed,#e879f9)", animation: "wfLoad 1.1s ease-in-out infinite alternate" }} />
                        </div>
                        <div style={{ marginTop: 9, color: "#cbd5e1", font: "600 14px Inter, system-ui, sans-serif" }}>Warming rigs, materials, and the Gate Warden</div>
                    </div>
                </div>
            )}

            {/* Opening VS card — team lineups + declared formations. */}
            {intro && assetsReady && (
                <div className="wf-intro-overlay" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "radial-gradient(ellipse at center, rgba(3,6,14,0.55) 30%, rgba(3,6,14,0.9) 100%)", zIndex: 58, pointerEvents: "none", animation: `wfIntro ${reducedMotion ? 1.1 : 4.2}s ease-in-out forwards` }}>
                    <div className="wf-intro-card" style={{ textAlign: "center" }}>
                        <div style={{ color: "#e9d5ff", font: "900 18px Inter, system-ui, sans-serif", letterSpacing: 6 }}>HOLLOW WARFRONT</div>
                        <div style={{ color: "#94a3b8", font: "700 14px Inter, system-ui, sans-serif", letterSpacing: 2, marginTop: 2 }}>{spec.label.toUpperCase()} · BREAK THE WARD SEAL</div>
                        <div className="wf-intro-versus" style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 18 }}>
                            <div style={{ textAlign: "right" }}>
                                <div style={{ color: localTeam === "blue" ? "#fde68a" : "#64748b", font: "900 11px Inter, system-ui, sans-serif", letterSpacing: 1.5, marginBottom: 4 }}>{localTeam === "blue" ? "YOUR SQUAD" : "RIVAL SQUAD"}</div>
                                {result.snapshots.at(0)!.actors.filter((a) => a.team === "blue").map((a, index) => (
                                    <div key={a.id} style={{ color: "#93c5fd", font: "800 15px Inter, system-ui, sans-serif", textShadow: "0 2px 8px #000" }}><span style={{ color: "#fde68a", fontSize: 11 }}>{WF_DEPLOYMENT_LABEL[blueDeploymentPlan[index] ?? WF_DEFAULT_DEPLOYMENT[index]]} · </span>{roster.find((r) => r.id === a.id)?.pet.name ?? a.id} <span style={{ color: "#94a3b8", fontSize: 12 }}>{ROLE_TAG[a.role] ?? ""}</span></div>
                                ))}
                                <div style={{ color: "#60a5fa", font: "700 14px Inter, system-ui, sans-serif", marginTop: 6 }}>{WF_STANCES.find((st2) => st2.id === result.snapshots.at(0)!.stances.blue)?.icon} {WF_STANCES.find((st2) => st2.id === result.snapshots.at(0)!.stances.blue)?.label}</div>
                                <div style={{ color: "#bfdbfe", font: "800 14px Inter, system-ui, sans-serif", marginTop: 3 }}>{blueDoctrine.icon} {blueDoctrine.label}</div>
                                {(bluePackage || blueOrder) && <div style={{ color: "#c4b5fd", font: "700 11px Inter, system-ui, sans-serif", marginTop: 3 }}>{bluePackage?.icon} {bluePackage?.label}{bluePackage && blueOrder ? " · " : ""}{blueOrder?.icon} {blueOrder?.label}</div>}
                            </div>
                            <div style={{ color: "#fde047", font: "900 34px Inter, system-ui, sans-serif", textShadow: "0 0 24px rgba(250,204,21,0.5)" }}>VS</div>
                            <div style={{ textAlign: "left" }}>
                                <div style={{ color: localTeam === "red" ? "#fde68a" : "#64748b", font: "900 11px Inter, system-ui, sans-serif", letterSpacing: 1.5, marginBottom: 4 }}>{localTeam === "red" ? "YOUR SQUAD" : "RIVAL SQUAD"}</div>
                                {result.snapshots.at(0)!.actors.filter((a) => a.team === "red").map((a, index) => (
                                    <div key={a.id} style={{ color: "#fca5a5", font: "800 15px Inter, system-ui, sans-serif", textShadow: "0 2px 8px #000" }}><span style={{ color: "#fde68a", fontSize: 11 }}>{WF_DEPLOYMENT_LABEL[redDeploymentPlan[index] ?? WF_DEFAULT_DEPLOYMENT[index]]} · </span><span style={{ color: "#94a3b8", fontSize: 12 }}>{ROLE_TAG[a.role] ?? ""}</span> {roster.find((r) => r.id === a.id)?.pet.name ?? a.id}</div>
                                ))}
                                <div style={{ color: "#f87171", font: "700 14px Inter, system-ui, sans-serif", marginTop: 6 }}>{WF_STANCES.find((st2) => st2.id === result.snapshots.at(0)!.stances.red)?.icon} {WF_STANCES.find((st2) => st2.id === result.snapshots.at(0)!.stances.red)?.label}</div>
                                <div style={{ color: "#fecaca", font: "800 14px Inter, system-ui, sans-serif", marginTop: 3 }}>{redDoctrine.icon} {redDoctrine.label}</div>
                                {(redPackage || redOrder) && <div style={{ color: "#c4b5fd", font: "700 11px Inter, system-ui, sans-serif", marginTop: 3 }}>{redPackage?.icon} {redPackage?.label}{redPackage && redOrder ? " · " : ""}{redOrder?.icon} {redOrder?.label}</div>}
                            </div>
                        </div>
                        <div style={{ marginTop: 16, color: result.opening.winner ? TEAM_SOFT[result.opening.winner] : "#c4b5fd", font: "900 16px Inter, system-ui, sans-serif", letterSpacing: 1.2 }}>{openingLine}</div>
                        <div style={{ marginTop: 4, color: "#bae6fd", font: "800 11px Inter, system-ui, sans-serif", letterSpacing: 1 }}>NAMED LANES LOCK FOR THE OPENING 40 SECONDS</div>
                        <div style={{ marginTop: 4, color: "#94a3b8", font: "700 12px Inter, system-ui, sans-serif" }}>VANGUARD › ZEALOT › BULWARK › VANGUARD · WARDEN'S PACT IS NEUTRAL</div>
                    </div>
                </div>
            )}
            <div ref={phaseOverlayRef} style={{ position: "absolute", inset: 0, opacity: 0, pointerEvents: "none", transition: "opacity 1.2s ease" }} />
            {userPaused && (
                <div role="status" aria-live="polite" style={{ position: "absolute", left: "50%", top: "42%", transform: "translate(-50%,-50%)", zIndex: 64, padding: "10px 18px", border: "1px solid rgba(253,224,71,.7)", borderRadius: 999, background: "rgba(8,12,24,.94)", color: "#fde68a", font: "900 16px Inter,system-ui,sans-serif", letterSpacing: 1.5, pointerEvents: "none" }}>⏸ BATTLE PAUSED</div>
            )}
            {/* Broadcast vignette — pulls the eye to the action and hides the
                hard viewport edge; pure CSS, zero render cost. */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 54%, rgba(2,4,10,0.42) 100%)" }} />
            {flash && <div key={flash.id} style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, transparent 38%, ${flash.color} 100%)`, pointerEvents: "none", animation: "wfFlash 0.4s ease-out forwards", mixBlendMode: "screen" }} />}
            {/* Broadcast ribbon banner: dark gradient bar, team-color hairlines,
                a shine sweep, queued display (big moments sit higher + longer). */}
            {banner && (
                <div className="wf-banner" role="status" aria-live="polite" aria-atomic="true" key={banner.id} style={{ position: "absolute", top: banner.big ? "26%" : "16%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none", animation: reducedMotion ? "none" : `wfBanner ${banner.big ? 2.3 : 1.6}s cubic-bezier(.2,.8,.2,1) forwards`, opacity: reducedMotion ? 1 : undefined, maxWidth: "96vw" }}>
                    <div style={{ position: "relative", overflow: "hidden", padding: banner.big ? "12px 58px" : "7px 38px", background: "linear-gradient(90deg, transparent 0%, rgba(6,9,20,0.92) 13%, rgba(6,9,20,0.92) 87%, transparent 100%)" }}>
                        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, background: `linear-gradient(90deg, transparent, ${banner.color}, transparent)` }} />
                        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, background: `linear-gradient(90deg, transparent, ${banner.color}, transparent)` }} />
                        <div style={{ color: banner.color, font: `900 ${banner.big ? 40 : 24}px Inter, system-ui, sans-serif`, letterSpacing: banner.big ? 3 : 2, textShadow: "0 2px 18px #000, 0 0 30px currentColor", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}>{banner.text}</div>
                        <div className="wf-banner-shine" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "38%", background: "linear-gradient(105deg, transparent, rgba(255,255,255,0.16), transparent)", animation: "wfShine 1.25s ease-out forwards" }} />
                    </div>
                </div>
            )}
            {replayClip && (
                <div className="wf-replay-chip" role="status" aria-live="polite" style={{ position: "absolute", left: "50%", top: 116, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", border: "1px solid rgba(253,224,71,0.65)", borderRadius: 999, background: "rgba(8,12,24,0.92)", color: "#fde047", font: "900 13px Inter, system-ui, sans-serif", zIndex: 65 }}>
                    <span>1× TURNING-POINT REPLAY · {replayClip.label}</span>
                    <button ref={replaySkipRef} type="button" onClick={finishReplayClip} style={{ ...btn, padding: "4px 8px", fontSize: 13 }}>Skip</button>
                </div>
            )}

            {/* Top bar: exit · replay/restart · timer · coins · mode badge */}
            <div className="wf-top-controls" style={{ position: "absolute", top: 10, left: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" onClick={requestExit} disabled={exitPending} style={btn} aria-label="Exit Warfront">✕ <span className="wf-control-label">Exit</span></button>
                <button type="button" onClick={doReplay} style={btn} title="Rewatch this match from the start" aria-label="Replay match">⟲ <span className="wf-control-label">Replay</span></button>
                <button type="button" onClick={() => confirmLiveAction("Restart this battle from the beginning with the same seed?", doRestart)} style={btn} title="Fresh match, same seed" aria-label="Restart match">↻ <span className="wf-control-label">Restart</span></button>
                {allowReseed && <button type="button" onClick={() => confirmLiveAction("Abandon this battle and create a new matchup?", doNewMatch)} style={btn} title="Fresh match, new seed" aria-label="New match">🎲 <span className="wf-control-label">New match</span></button>}
                <button
                    type="button"
                    onClick={togglePause}
                    disabled={!assetsReady || intro || !!council || ended}
                    aria-pressed={userPaused}
                    aria-label={userPaused ? "Resume battle" : "Pause battle"}
                    style={{ ...btn, opacity: !assetsReady || intro || council || ended ? 0.55 : 1 }}
                >{userPaused ? "▶" : "⏸"} <span className="wf-control-label">{userPaused ? "Resume" : "Pause"}</span></button>
                <button
                    type="button"
                    onClick={() => {
                        const next = !sfxMuted;
                        setPetSfxMuted(next);
                        setAudioMuted(next);
                        setSfxMuted(next);
                        if (!next) { primeWarfrontAudio(); startWarfrontAudioBed(); seekWarfrontAudio(result.events, Math.floor(wfClockTick(clock))); primePetSfx(); playPetSfx("buff"); }
                    }}
                    style={btn}
                    title={sfxMuted ? "Enable objective and combat cues" : "Mute Warfront cues"}
                    aria-label={sfxMuted ? "Enable Warfront sound" : "Mute Warfront sound"}
                    aria-pressed={!sfxMuted}
                >{sfxMuted ? "🔇" : "🔊"}</button>
            </div>
            {/* SCORE STRIP — the win condition at a glance: ⛩ points (statues +
                seal broken), coin tiebreak, and the exact live Judgment leader. */}
            <div className="wf-score-strip" style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "grid", gap: 4, justifyItems: "center", padding: "6px 16px 7px", background: "rgba(8,12,24,0.82)", border: "1px solid rgba(148,163,184,0.4)", borderRadius: 14, font: "800 14px Inter, system-ui, sans-serif" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, whiteSpace: "nowrap" }}>
                    {localTeam === "blue" && <span className="wf-team-marker" style={{ color: "#dbeafe", fontSize: 10, letterSpacing: 1 }}>YOU</span>}
                    <span className="wf-score-doctrine" title={`Blue doctrine: ${blueDoctrine.label} — ${blueDoctrine.desc}`} style={{ color: "#bfdbfe", fontSize: 12 }}>{blueDoctrine.icon}</span>
                    <span className="wf-score-stance" ref={stanceBlueRef} style={{ fontSize: 13 }} />
                    <span style={{ color: "#93c5fd" }} aria-label={`Blue${localTeam === "blue" ? ", your team" : ""} structures score`} title="Structures broken (statues + Ward Seal) — how this mode is won">⛩ <span ref={scoreBlueRef}>0</span></span>
                    <span className="wf-score-secondary" style={{ color: "#93c5fd", fontSize: 12 }} title="Kills">⚔ <span ref={killBlueRef}>0</span></span>
                    <span className="wf-score-secondary" style={{ color: "#60a5fa", fontSize: 12 }}>🪙 <span ref={coinBlueRef}>0</span></span>
                    <span ref={timerRef} style={{ color: "#e2e8f0", fontSize: 13, padding: "0 4px" }}>10:00</span>
                    <span className="wf-score-secondary" style={{ color: "#fca5a5", fontSize: 12 }}><span ref={coinRedRef}>0</span> 🪙</span>
                    <span className="wf-score-secondary" style={{ color: "#fca5a5", fontSize: 12 }} title="Kills"><span ref={killRedRef}>0</span> ⚔</span>
                    <span style={{ color: "#fca5a5" }} aria-label={`Red${localTeam === "red" ? ", your team" : ""} structures score`} title="Structures broken (statues + Ward Seal) — how this mode is won"><span ref={scoreRedRef}>0</span> ⛩</span>
                    <span className="wf-score-stance" ref={stanceRedRef} style={{ fontSize: 13 }} />
                    <span className="wf-score-doctrine" title={`Red doctrine: ${redDoctrine.label} — ${redDoctrine.desc}`} style={{ color: "#fecaca", fontSize: 12 }}>{redDoctrine.icon}</span>
                    {localTeam === "red" && <span className="wf-team-marker" style={{ color: "#fee2e2", fontSize: 10, letterSpacing: 1 }}>YOU</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span ref={sigilPipsBlueRef} title="Blue's Sigil claims — three crowns HOLLOW ASCENDANCE" style={{ fontSize: 9, letterSpacing: 1, color: "#475569" }} />
                    <span ref={structsBlueRef} title="Blue's remaining sentinels · totems · Ward Seal" style={{ fontSize: 9, letterSpacing: 1, opacity: 0.9 }} />
                    <span ref={judgmentRef} className="wf-score-divider" role="img" data-wf-judgment="tied" aria-label="Judgment tied" style={{ width: 160, height: 3, borderRadius: 999, background: "linear-gradient(90deg,#3b82f6 0 49%,#475569 49% 51%,#ef4444 51% 100%)" }} />
                    <span ref={structsRedRef} title="Red's remaining Ward Seal · totems · sentinels" style={{ fontSize: 9, letterSpacing: 1, opacity: 0.9 }} />
                    <span ref={sigilPipsRedRef} title="Red's Sigil claims — three crowns HOLLOW ASCENDANCE" style={{ fontSize: 9, letterSpacing: 1, color: "#475569" }} />
                </div>
            </div>
            {/* Objective ribbon — phase clock, current instruction and live
                neutral-objective state. Refs keep it cheap at 60fps. */}
            <div className="wf-objective-strip" style={{ position: "absolute", top: 70, left: "50%", transform: "translateX(-50%)", width: "min(610px, 58vw)", display: "grid", gap: 4, padding: "5px 10px 6px", background: "linear-gradient(90deg, transparent, rgba(8,12,24,0.9) 10%, rgba(8,12,24,0.9) 90%, transparent)", pointerEvents: "none", fontFamily: "Inter, system-ui, sans-serif" }}>
                <div className="wf-objective-main" style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 9, whiteSpace: "nowrap" }}>
                    <span className="wf-phase-label" ref={phaseRef} style={{ color: "#93c5fd", fontSize: 11, fontWeight: 900, letterSpacing: 1.8 }}>LANING</span>
                    <span className="wf-phase-clock" ref={phaseClockRef} style={{ color: "#64748b", fontSize: 9, fontWeight: 800 }}>NEXT 1:00</span>
                    <span className="wf-objective-separator" style={{ color: "#334155" }}>◆</span>
                    <span ref={sigilRef} style={{ color: "#8b93a7", fontSize: 9, fontWeight: 800 }} />
                    <span className="wf-objective-separator" style={{ color: "#334155" }}>◆</span>
                    <span className="wf-objective-call" ref={objectiveRef} style={{ color: "#f8fafc", fontSize: 10, fontWeight: 900, letterSpacing: 0.7 }}>FARM COINS · SECURE THE LANES</span>
                </div>
                <div className="wf-stakes-row" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, whiteSpace: "nowrap", minWidth: 0 }}>
                    <span className="wf-team-intent" ref={blueIntentRef} style={{ minWidth: 84, color: "#93c5fd", fontSize: 8, fontWeight: 900, textAlign: "right", letterSpacing: 0.7 }}>BLUE · FARM</span>
                    <span className="wf-stakes-arrow" style={{ color: "#334155" }}>›</span>
                    <span className="wf-live-stakes" ref={stakesRef} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: "#fde68a", fontSize: 8, fontWeight: 900, letterSpacing: 0.7 }}>BREAK SENTINELS · OPEN THE WARD SEAL</span>
                    <span className="wf-stakes-arrow" style={{ color: "#334155" }}>‹</span>
                    <span className="wf-team-intent" ref={redIntentRef} style={{ minWidth: 84, color: "#fca5a5", fontSize: 8, fontWeight: 900, textAlign: "left", letterSpacing: 0.7 }}>RED · FARM</span>
                </div>
                <div className="wf-warden-strip" ref={wardenWrapRef} style={{ display: "none", gridTemplateColumns: "auto 170px auto", justifyContent: "center", alignItems: "center", columnGap: 8, rowGap: 2 }}>
                    <span className="wf-warden-status" ref={wardenStatusRef} style={{ color: "#e9d5ff", fontSize: 9, fontWeight: 800, minWidth: 102, textAlign: "right" }}>PHASE I</span>
                    <div style={{ height: 6, background: "#1e1b2e", border: "1px solid rgba(216,180,254,0.4)", borderRadius: 5, overflow: "hidden" }}>
                        <div ref={wardenHpRef} style={{ height: "100%", width: "100%", background: "#a78bfa", transition: "width 0.15s linear" }} />
                    </div>
                    <span className="wf-warden-damage" ref={wardenDamageRef} style={{ color: "#94a3b8", fontSize: 8, fontWeight: 800, minWidth: 102 }}>BLUE 50% · 50% RED</span>
                </div>
            </div>
            <div className="wf-top-meta" style={{ position: "absolute", top: 10, right: 12, display: "flex", gap: 6, alignItems: "center" }}>
                <div className="wf-mode-badge" style={{ padding: "4px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(168,85,247,0.6)", borderRadius: 999, color: "#d8b4fe", font: "700 12px Inter, system-ui, sans-serif" }}>⛩ Hollow Warfront · {spec.label}</div>
                <label style={metaControl}>
                    FX
                    <select
                        aria-label="Warfront visual quality"
                        value={qualityId}
                        onChange={(event) => chooseQuality(event.target.value as PetVisualQuality)}
                        style={metaSelect}
                    >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                    </select>
                </label>
                <label style={metaControl}>
                    UI
                    <select aria-label="Warfront interface size" value={uiScale} onChange={(event) => chooseUiScale(event.target.value as WfUiScale)} style={metaSelect}>
                        <option value="standard">100%</option>
                        <option value="large">Large</option>
                    </select>
                </label>
                <label className="wf-pace-control" title="Smart uses 1.35× only in quiet play and returns to 1× before major moments" style={metaControl}>
                    <span className="wf-pace-label">PACE</span>
                    <select data-wf-pace={replayClip ? "1" : paceMode} aria-label="Broadcast pace" value={replayClip ? "1" : paceMode} disabled={!!replayClip} onChange={(event) => choosePace(event.target.value as WarfrontPaceMode)} style={metaSelect}>
                        <option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option><option value="smart">Smart</option>
                    </select>
                </label>
                <button className="wf-motion-toggle" type="button" aria-pressed={reducedMotion} aria-label={`${reducedMotion ? "Disable" : "Enable"} reduced motion`} title="Reduce camera cuts, shake, flashes and ambient motion" onClick={toggleReducedMotion} style={{ ...btn, minHeight: 34, padding: "4px 9px", borderRadius: 999, borderColor: reducedMotion ? "#6ee7b7" : "#475569" }}>◌</button>
            </div>
            {/* Camera modes: 📺 director's broadcast · 🎬 calm wide · 🛡 my team. */}
            <div className="wf-camera-modes" style={{ position: "absolute", top: 42, left: 12, display: "flex", gap: 4 }}>
                {([
                    ["broadcast", "📺", "Broadcast — the director chases fights, kills and objectives"],
                    ["calm", "🎬", "Calm — wide and steady; only the big objective moments cut"],
                    ["team", "🛡", "My Team — stay locked on your squad"],
                ] as const).map(([id, icon, tip]) => (
                    <button
                        type="button"
                        key={id}
                        disabled={!!replayClip}
                        onClick={() => { setCamMode(id); focusMiniRef.current = null; setFocusPetId(null); camCtl.current.mode = "follow"; setFreeCam(false); }}
                        title={tip}
                        aria-label={tip}
                        aria-pressed={camMode === id && !freeCam}
                        style={{ padding: "3px 9px", background: camMode === id && !freeCam ? "rgba(109,40,217,0.9)" : "rgba(15,23,42,0.85)", border: `1px solid ${camMode === id && !freeCam ? "#a78bfa" : "#334155"}`, borderRadius: 999, color: camMode === id && !freeCam ? "#fff" : "#94a3b8", cursor: "pointer", font: "700 12px Inter, system-ui, sans-serif" }}
                    >{icon}</button>
                ))}
            </div>
            {freeCam && (
                <button
                    type="button"
                    className="wf-free-camera"
                    disabled={!!replayClip}
                    onClick={() => { camCtl.current.mode = "follow"; setFreeCam(false); }}
                    style={{ position: "absolute", top: 74, left: 12, padding: "4px 10px", background: "rgba(109,40,217,0.9)", border: "1px solid #a78bfa", borderRadius: 999, color: "#fff", cursor: "pointer", font: "700 11px Inter, system-ui, sans-serif" }}
                >📍 Free cam — tap to follow</button>
            )}

            {/* Kill feed + minimap (right column) */}
            <div className="wf-right-stack" style={{ position: "absolute", top: 46, right: 12, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", pointerEvents: "none" }}>
                <WfMinimap result={result} clock={clock} theme={theme} camViewRef={camView} camCtlRef={camCtl} onModeChange={handleFreeCameraMode} disabled={!!replayClip} />
                {quality.id === "medium" && <WfConvoyFollow result={result} clock={clock} onFollow={handleConvoyFollow} disabled={!!replayClip} />}
                {feed.map((f) => { const councilOrder = /^COUNCIL \d/.test(f.text); return <div className={`wf-feed-item${councilOrder ? " wf-council-recap" : ""}`} role={councilOrder ? "status" : undefined} key={f.id} title={f.text} style={{ padding: "4px 9px", background: "rgba(8,12,24,0.88)", border: `1px solid ${f.color}66`, borderRadius: 6, color: f.color, font: "700 13px Inter, system-ui, sans-serif", animation: "wfFeedIn 0.2s ease-out", maxWidth: "44vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.text}</div>; })}
            </div>

            {multiCamOn && <div className="wf-multicam-wall" data-wf-pip-count="1" style={{ position: "absolute", left: 10, bottom: 10, display: "flex", zIndex: 55 }}>
                <button className="wf-story-pip" type="button" disabled={!!replayClip} data-wf-pip="story" data-wf-pip-team={localTeam} aria-pressed={!!focusPetId} aria-label={`Feature the story camera subject from your ${localTeam} squad`} onClick={() => { const id = pipSubjectRef.current; if (!id) return; focusMiniRef.current = null; setFocusPetId((focused) => focused === id ? null : id); }} style={{ position: "relative", width: pipWidth, height: pipHeight, padding: 0, border: `2px solid ${focusPetId ? "#fbbf24" : `${TEAM_SOFT[localTeam]}80`}`, borderRadius: 10, background: "transparent", cursor: replayClip ? "default" : "pointer", overflow: "hidden" }}>
                    <span style={{ position: "absolute", inset: "2px 6px auto", display: "flex", justifyContent: "space-between", gap: 8, color: "#e2e8f0", font: "700 10px Inter" }}><span ref={pipLabelRef}>{myPets[0]?.name}</span><span ref={pipStatusRef} /></span>
                    <span style={{ position: "absolute", inset: "auto 0 0", height: 4, background: "#111827" }}><span ref={pipHpRef} style={{ display: "block", height: "100%", background: TEAM_SOFT[localTeam] }} /></span>
                </button>
            </div>}

            {exitPrompt && (
                <div style={{ position: "absolute", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: 14, background: "rgba(3,7,18,.82)" }}>
                    <div ref={exitDialogRef} role="dialog" aria-modal="true" aria-labelledby="wf-forfeit-title" aria-describedby="wf-forfeit-desc" onKeyDown={trapExitDialogFocus} style={{ width: "min(470px, 94vw)", padding: 18, borderRadius: 14, border: "1px solid #fb7185", background: "rgba(10,14,28,.98)", boxShadow: "0 24px 80px rgba(0,0,0,.7)" }}>
                        <h2 id="wf-forfeit-title" ref={exitHeadingRef} tabIndex={-1} style={{ margin: 0, color: "#fecdd3", font: "900 22px Inter,system-ui,sans-serif" }}>Forfeit this Warfront?</h2>
                        <p id="wf-forfeit-desc" style={{ color: "#e2e8f0", lineHeight: 1.45 }}>The server will immediately record a loss with zero victory reward. To prevent seed rerolls, fresh scouting stays locked until this match&apos;s original regulation clock expires. The match stays open unless the receipt succeeds.</p>
                        {exitError && <p role="alert" style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(127,29,29,.28)", color: "#fecaca", fontWeight: 700 }}>{exitError}</p>}
                        <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
                            <button type="button" disabled={exitPending} onClick={cancelExit} style={{ ...btn, minHeight: 44 }}>{exitError ? "Return to match" : "Cancel"}</button>
                            <button type="button" disabled={exitPending} onClick={() => void confirmForfeit()} style={{ ...btn, minHeight: 44, borderColor: "#fb7185", background: "#9f1239" }}>{exitPending ? "Securing forfeit…" : exitError ? "Retry forfeit" : "Forfeit & exit"}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* WAR COUNCIL — a fast tactical order + build checkpoint. */}
            {council && (
                <WfWarCouncil
                    key={council.round}
                    round={council.round}
                    buyState={ctl.buyState("blue").map((pet, index) => ({ ...pet, role: blue[index]?.role ?? "defender" }))}
                    coins={ctl.coins("blue")}
                    initialStance={ctl.stances().blue}
                    adaptationReserve={result.events.find((event): event is Extract<WfEvent, { type: "readreserve" }> => event.type === "readreserve" && event.team === "blue")?.coins ?? 0}
                    context={{
                        snapshot: result.snapshots.at(-1)!,
                        decisions: result.choiceLog ?? [],
                        events: result.events,
                        setupDecision: { buildPackage, coachOrder, objectiveTechnique, counterstrike },
                    }}
                    onResume={(decision) => resumeFromCouncil(council.round, decision)}
                    onRequestExit={requestExit}
                    forfeitRequired={!!onForfeit}
                />
            )}

            {ended && !replayClip && (
                <div ref={endDialogRef} role="dialog" aria-modal="true" aria-labelledby="wf-result-title" onKeyDown={trapEndDialogFocus} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,7,18,0.72)", zIndex: 70, padding: 12 }}>
                    <div className="wf-end-card" style={{ width: "min(760px, 96vw)", maxHeight: "92vh", overflowY: "auto", padding: "22px 18px", textAlign: "center", animation: "wfEndIn 0.5s ease-out", background: "rgba(8,12,24,.9)", border: `1px solid ${result.winner === "draw" ? "#facc15" : localVictory ? "#6ee7b7" : "#fb7185"}`, borderRadius: 16 }}>
                        <h2 id="wf-result-title" ref={endHeadingRef} tabIndex={-1} style={{ margin: 0, font: "900 34px Inter, system-ui, sans-serif", color: result.winner === "blue" ? "#60a5fa" : result.winner === "red" ? "#f87171" : "#facc15", textShadow: "0 2px 12px #000" }}>{winLabel}</h2>
                        {(() => {
                            const last = result.snapshots.at(-1)!;
                            const score = wfVerdictScore(last);
                            return (
                                <div style={{ marginTop: 6, display: "grid", gap: 2 }}>
                                    <div style={{ color: "#e2e8f0", font: "800 14px Inter, system-ui, sans-serif" }}>
                                        ⛩ Points <span style={{ color: "#93c5fd" }}>{score.blue}{localTeam === "blue" ? " (you)" : ""}</span> — <span style={{ color: "#fca5a5" }}>{score.red}{localTeam === "red" ? " (you)" : ""}</span>
                                        <span style={{ color: "#64748b" }}> · </span>🗿 Sigils <span style={{ color: "#93c5fd" }}>{last.sigilPips.blue}</span> — <span style={{ color: "#fca5a5" }}>{last.sigilPips.red}</span>
                                    </div>
                                    {last.ascendant && <div style={{ color: "#fde047", font: "800 14px Inter" }}>🗿 {last.ascendant.toUpperCase()} · HOLLOW ASCENDANCE</div>}
                                    <div style={{ color: result.opening.winner ? TEAM_SOFT[result.opening.winner] : "#94a3b8", font: "800 14px Inter, system-ui, sans-serif" }}>
                                        {blueDoctrine.icon} {blueDoctrine.label} vs {redDoctrine.icon} {redDoctrine.label} · {openingLine}
                                    </div>
                                    <div style={{ color: "#94a3b8", font: "600 14px Inter, system-ui, sans-serif" }}>
                                        {sealBroken ? "Decided by Ward Seal destruction" : "Timer verdict — points (statues + seal broken), then coins"}
                                    </div>
                                </div>
                            );
                        })()}
                        {decisionReceipt && (() => {
                            const orderCounts = new Map<WfCoachOrder, number>();
                            for (const round of decisionReceipt.rounds) if (round.coachOrder) orderCounts.set(round.coachOrder, (orderCounts.get(round.coachOrder) ?? 0) + 1);
                            const orderLine = WF_COACH_ORDER_META
                                .filter((item) => orderCounts.has(item.id))
                                .map((item) => `${item.icon} ${item.label} ×${orderCounts.get(item.id)}`)
                                .join(" · ") || "No authored round orders";
                            const packageLine = (decisionReceipt.buildPackages ?? []).map((entry) => {
                                const item = buildPackageSpec(entry.choice);
                                return `${item?.icon ?? ""} ${item?.label ?? entry.choice} · ${visiblePackageActivationLabel(entry.procs)}`;
                            }).join(" · ") || "No build package";
                            const techniqueMeta = decisionReceipt.objectiveTechnique ? WF_OBJECTIVE_TECHNIQUE_META.find((item) => item.id === decisionReceipt.objectiveTechnique?.choice) : null;
                            const counterMeta = decisionReceipt.counterstrike ? WF_COUNTERSTRIKE_META.find((item) => item.id === decisionReceipt.counterstrike?.choice) : null;
                            const openingResult = result.opening.winner === localTeam ? "won the opening read" : result.opening.winner ? "lost the opening read" : "opened neutral";
                            return (
                                <section aria-labelledby="wf-decision-receipt-title" style={{ margin: "12px auto 0", maxWidth: 700, padding: "10px", border: "1px solid rgba(56,189,248,.42)", borderRadius: 11, background: "rgba(8,47,73,.18)", textAlign: "left" }}>
                                    <h3 id="wf-decision-receipt-title" style={{ margin: "0 0 8px", color: "#bae6fd", font: "900 15px Inter,system-ui,sans-serif" }}>Your decision receipt</h3>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 7 }}>
                                        <div style={{ padding: 8, borderRadius: 8, background: "rgba(15,23,42,.72)" }}>
                                            <strong style={{ color: "#f8fafc" }}>Opening plan</strong>
                                            <div style={{ marginTop: 3, color: "#cbd5e1", fontSize: 12 }}>{localSlots.map((slot, index) => `${decisionReceipt.deployment?.[index] ?? ["top", "mid", "bottom", "flex"][index]} · ${slot.pet.name} (${slot.role})`).join(" · ")}</div>
                                            <div style={{ marginTop: 4, color: "#a5b4fc", fontSize: 12 }}>{doctrineSpec(result.doctrines[localTeam]).label} · {openingResult}</div>
                                        </div>
                                        <div style={{ padding: 8, borderRadius: 8, background: "rgba(15,23,42,.72)" }}>
                                            <strong style={{ color: "#f8fafc" }}>Build & orders</strong>
                                            <div style={{ marginTop: 3, color: "#cbd5e1", fontSize: 12 }}>{packageLine}</div>
                                            <div style={{ marginTop: 4, color: "#a5b4fc", fontSize: 12 }}>{orderLine}</div>
                                        </div>
                                        <div style={{ padding: 8, borderRadius: 8, background: "rgba(15,23,42,.72)" }}>
                                            <strong style={{ color: "#f8fafc" }}>Clutch tools</strong>
                                            <div style={{ marginTop: 3, color: decisionReceipt.objectiveTechnique?.used ? "#86efac" : "#94a3b8", fontSize: 12 }}>{techniqueMeta?.icon} {techniqueMeta?.label ?? "No technique"} · {decisionReceipt.objectiveTechnique?.used ? `used ${mmss((decisionReceipt.objectiveTechnique.usedAt ?? 0) / WARFRONT_TPS)}` : "not triggered"}</div>
                                            <div style={{ marginTop: 4, color: decisionReceipt.counterstrike?.triggered ? "#fda4af" : "#94a3b8", fontSize: 12 }}>{counterMeta?.icon} {counterMeta?.label ?? "No counterstrike"} · {decisionReceipt.counterstrike?.triggered ? `triggered ${mmss((decisionReceipt.counterstrike.triggeredAt ?? 0) / WARFRONT_TPS)}` : "not triggered"}</div>
                                        </div>
                                        <div style={{ padding: 8, borderRadius: 8, background: "rgba(15,23,42,.72)" }}>
                                            <strong style={{ color: "#f8fafc" }}>Measured impact</strong>
                                            <div style={{ marginTop: 3, color: "#cbd5e1", fontSize: 12 }}>{decisionReceipt.outcome.petKills} kills · {decisionReceipt.outcome.structuresDestroyed} structures · {decisionReceipt.outcome.sigilsClaimed} Sigils</div>
                                            <div style={{ marginTop: 4, color: "#fde68a", fontSize: 12 }}>{decisionReceipt.outcome.objectiveSteals} steals · 🪙{decisionReceipt.outcome.coins}</div>
                                        </div>
                                    </div>
                                </section>
                            );
                        })()}
                        {(() => {
                            const allBeats = result.events
                                .map((event) => ({ event, label: objectiveEventLabel(event) }))
                                .filter((beat): beat is { event: WarfrontResult["events"][number]; label: string } => !!beat.label);
                            const openingBeat = allBeats.find((beat) => beat.event.type === "opening");
                            const byEvent = new Map(allBeats.map((beat) => [beat.event, beat]));
                            const beats = [...(openingBeat ? [openingBeat] : []), ...warfrontTurningPoints(allBeats.filter((beat) => beat !== openingBeat).map((beat) => beat.event), 7).map((event) => byEvent.get(event)!)];
                            if (!beats.length) return null;
                            return (
                                <div className="wf-end-timeline" style={{ margin: "12px auto 0", maxWidth: 680, display: "grid", gridTemplateColumns: `repeat(${Math.min(4, beats.length)}, minmax(0, 1fr))`, alignItems: "stretch", justifyContent: "center", gap: 5 }}>
                                    {beats.map(({ event, label }, index) => (
                                        <button
                                            key={warfrontEventKey(event, index)}
                                            type="button"
                                            data-wf-salience={warfrontEventSalience(event)}
                                            onClick={() => replayTurningPoint(event, label)}
                                            aria-label={`Replay turning point at ${mmss(event.t / WARFRONT_TPS)}: ${label}`}
                                            title="Replay three seconds before and four seconds after this turning point"
                                            style={{ flex: "1 1 0", minWidth: 0, padding: "5px 6px", background: "rgba(8,12,24,0.82)", border: 0, borderTop: `2px solid ${objectiveEventColor(event)}`, color: "#cbd5e1", textAlign: "left", cursor: "pointer" }}
                                        >
                                            <div style={{ color: objectiveEventColor(event), font: "900 12px Inter, system-ui, sans-serif" }}>{mmss(event.t / WARFRONT_TPS)}</div>
                                            <div style={{ font: "700 12px/1.3 Inter, system-ui, sans-serif" }}>{label}</div>
                                        </button>
                                    ))}
                                </div>
                            );
                        })()}
                        {result.petStats?.length ? (() => {
                            const mvpId = warfrontMvpId(result.petStats);
                            const mvp = result.petStats.find((pet) => pet.id === mvpId) ?? result.petStats[0];
                            return <div style={{ marginTop: 12, color: TEAM_SOFT[mvp.team], font: "900 14px Inter,system-ui" }}>👑 MVP · {mvp.name} · {mvp.kills} K · {mvp.dmg} damage</div>;
                        })() : null}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 14 }}>
                            <button type="button" onClick={doReplay} style={{ ...btn, minHeight: 44, padding: "8px 14px" }}>⟲ Replay</button>
                            <button type="button" onClick={doRestart} style={{ ...btn, minHeight: 44, padding: "8px 14px" }}>↻ Restart</button>
                            {allowReseed && <button type="button" onClick={doNewMatch} style={{ ...btn, minHeight: 44, background: "#6d28d9", border: "1px solid #a78bfa", padding: "8px 14px" }}>🎲 New match</button>}
                            <button type="button" onClick={onExit} style={{ ...btn, minHeight: 44, background: "#1e3a8a", border: "1px solid #3b82f6", padding: "8px 14px" }}>Exit</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    ), document.body);
}
