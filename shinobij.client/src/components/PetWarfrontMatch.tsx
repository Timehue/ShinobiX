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
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ErrorInfo,
    type MutableRefObject,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, Sparkles, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Pet } from "../types/pet";
import type { ArenaSlot } from "../lib/pet-arena-sim";
import {
    startWarfrontMatch, wfVerdictScore, WARFRONT_TPS, WF_MAX_SECONDS, WF_PHASE_SKIRMISH, WF_PHASE_SUDDEN, WF_PHASE_WAR, WF_POWERUPS, WF_STACK_CAP, WF_STANCES,
    type WarfrontChoice, type WarfrontResult, type WfBuyPolicy, type WfSnapshot, type WfStance, type WfDoctrine,
} from "../lib/pet-warfront-sim";
import {
    WF_MASK, WF_COLS, WF_ROWS, WF_X, WF_Y, WF_BUSHES, WF_CELL_X, WF_CELL_Y, WF_LAIR, WF_LANES, WF_MINI_NAMES, WF_PADS, WF_SPAWNS, WF_THEMES,
    wfCellWalkable, wfInsideField, wfLaneDistance,
    type WfTheme,
} from "../lib/pet-warfront-map";
import { walkTilesFromMask, arenaCameraDist, arenaModelHeight, arenaModelMotion, A3D_FOV } from "../lib/pet-arena-3d";
import { radialTexture3d, Fx3D, Shot3D, Floater3D } from "./PetArena3DStage";
import { petCombatModel, type PetCombatModelConfig } from "../lib/pet-3d-models";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import {
    PET_VISUAL_QUALITY_PRESETS,
    petVisualQuality,
    savePetVisualQuality,
    type PetVisualQuality,
} from "../lib/pet-visual-quality";
import { projectileVisual, type ProjectileVisual } from "../lib/pet-projectile-vfx";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { elementVfxKey } from "../lib/pet-battle-anim";
import { lerp } from "../lib/pet-coliseum-scene";
import { HOLLOW_HOUND_SURFACE, WARFRONT_MINION_SURFACES } from "../lib/pet-model-surface";
import { petModelVariantSurface } from "../lib/pet-visual-variant";
import { isPetSfxMuted, playPetSfx, primePetSfx, setPetSfxMuted } from "../lib/pet-sfx";
import {
    advanceWarfrontMotionFilter,
    adaptWarfrontPresentationBudget,
    createWarfrontMotionFilter,
    reconcileWarfrontMobSlots,
    shouldRenderWarfrontHoundRig,
    warfrontMotionFilterSpeed,
    warfrontMvpId,
    warfrontPresentationBudget,
    type WarfrontAdaptivePressure,
    type WarfrontMotionFilterState,
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

type Vec3 = [number, number, number];
type Team = "blue" | "red";
// slow = seconds of remaining hit-stop (playback runs at quarter speed while
// it drains — pure presentation, the sim ticks underneath are untouched).
type WfClockState = { t: number; playing: boolean; slow: number; rate: number };
type WfClockRef = MutableRefObject<WfClockState>;
// A director-ordered camera target: the broadcast cuts here until match-tick
// untilT (priority arbitrates simultaneous stories; kills < objectives).
type WfStoryCam = { x: number; z: number; untilT: number; span: number; prio: number };
// Spectator camera modes: broadcast = the auto-director with story cuts;
// calm = wide and steady, only the big objective cuts; team = locked to the
// player's squad. Dragging always enters free-cam on top of any of them.
type WfCamMode = "broadcast" | "calm" | "team";

const WF_PHASES = [
    { id: "opening", label: "LANING", starts: 0, ends: WF_PHASE_SKIRMISH, color: "#93c5fd" },
    { id: "skirmish", label: "SKIRMISH", starts: WF_PHASE_SKIRMISH, ends: WF_PHASE_WAR, color: "#fbbf24" },
    { id: "war", label: "WAR", starts: WF_PHASE_WAR, ends: WF_PHASE_SUDDEN, color: "#c084fc" },
    { id: "collapse", label: "HOLLOW COLLAPSE", starts: WF_PHASE_SUDDEN, ends: WF_MAX_SECONDS, color: "#fb7185" },
] as const;
const MINI_BOONS = [
    { icon: "🛡", label: "Stone Ward", desc: "shields nearby allies" },
    { icon: "✚", label: "Crystal Renewal", desc: "heals the escorted push" },
    { icon: "👁", label: "Void Hunt", desc: "reveals and marks enemies" },
    { icon: "🔥", label: "Rift Siege", desc: "empowers elite waves" },
] as const;
const phaseAtSeconds = (seconds: number) =>
    WF_PHASES.find((phase) => seconds >= phase.starts && seconds < phase.ends) ?? WF_PHASES[WF_PHASES.length - 1];
const mmss = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, Math.floor(seconds)) % 60).padStart(2, "0")}`;
function objectiveEventLabel(event: WarfrontResult["events"][number]): string | null {
    if (event.type === "phase") return event.name;
    if (event.type === "minikill") return `${event.team === "blue" ? "Blue" : "Red"} recruited ${WF_MINI_NAMES[event.padIdx] ?? "a Lesser Warden"}`;
    if (event.type === "wardenphase") return `Gate Warden entered Phase ${event.phase === 3 ? "III" : "II"}`;
    if (event.type === "wardenkill") return `${event.team === "blue" ? "Blue" : "Red"} felled the Gate Warden${event.stolen ? " (stolen)" : ""}`;
    if (event.type === "guardianrally") return `${event.team === "blue" ? "Blue" : "Red"} sentinels answered the War Council`;
    if (event.type === "guardiandown") return `${event.team === "blue" ? "Blue" : "Red"} sentinel fell`;
    if (event.type === "statuedown") return `${event.team === "blue" ? "Blue" : "Red"} Guardian Totem shattered`;
    if (event.type === "coreexposed") return `${event.team === "blue" ? "Blue" : "Red"} Ward Seal exposed`;
    if (event.type === "coredown") return `${event.by === "blue" ? "Blue" : "Red"} shattered the Ward Seal`;
    return null;
}
function objectiveEventColor(event: WarfrontResult["events"][number]): string {
    if (event.type === "minikill" || event.type === "wardenkill" || event.type === "guardianrally") return event.team === "blue" ? "#60a5fa" : "#f87171";
    if (event.type === "statuedown" || event.type === "coredown") return event.by === "blue" ? "#60a5fa" : "#f87171";
    if (event.type === "guardiandown" || event.type === "coreexposed") return event.team === "blue" ? "#f87171" : "#60a5fa";
    if (event.type === "phase") return event.name === "HOLLOW COLLAPSE" ? "#fb7185" : "#a78bfa";
    return "#a78bfa";
}

const TEAM_COLOR: Record<Team, string> = { blue: "#3b82f6", red: "#ef4444" };
const TEAM_SOFT: Record<Team, string> = { blue: "#93c5fd", red: "#fca5a5" };
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
    return snaps[Math.max(0, Math.min(snaps.length - 1, Math.floor(tick)))];
};

// The sim ticks at 30Hz but the playback clock advances a FRACTION of a tick per
// rendered frame (t += delta * rate * TPS). snapAt() floors to the current tick —
// correct for discrete state (hp, alive, statuses), but any actor that positions
// itself off snapAt() then jumps at 30Hz while the smooth 60/144Hz display begs to
// glide. lerpFrameAt() hands back the two bracketing snapshots + the blend so
// movement can be interpolated the way the hero pets already are — the whole field
// glides instead of only the four featured pets.
interface WfLerpFrame { s0: WfSnapshot; s1: WfSnapshot; f: number }
const lerpFrameAt = (result: WarfrontResult, clock: WfClockRef): WfLerpFrame => {
    const snaps = result.snapshots;
    const tick = Number.isFinite(clock.current.t) ? clock.current.t : 0;
    const tf = Math.max(0, Math.min(snaps.length - 1, tick));
    const i0 = Math.floor(tf);
    const i1 = Math.min(snaps.length - 1, i0 + 1);
    return { s0: snaps[i0], s1: snaps[i1], f: tf - i0 };
};

type WfMobSnap = WfSnapshot["mobs"][number];
type WfActorSnap = WfSnapshot["actors"][number];
type WfSnapshotIndex = {
    actorsById: Map<string, WfActorSnap>;
    mobsById: Map<number, WfMobSnap>;
    hollowMobs: WfMobSnap[];
    laneMobs: WfMobSnap[];
};
const wfSnapshotIndexes = new Map<WfSnapshot, WfSnapshotIndex>();
type WfMobSlotBindings = {
    snapshot: WfSnapshot | null;
    hollow: Array<number | null>;
    lane: Array<number | null>;
};

/** Build the per-tick lookup once, then share it across every rendered actor.
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
    if (wfSnapshotIndexes.size > 12) {
        const oldest = wfSnapshotIndexes.keys().next().value as WfSnapshot | undefined;
        if (oldest) wfSnapshotIndexes.delete(oldest);
    }
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
function WfHollowGate({ glow }: { glow: string }) {
    const outer = useRef<THREE.Mesh>(null);
    const inner = useRef<THREE.Mesh>(null);
    const outerMat = useRef<THREE.MeshBasicMaterial>(null);
    const innerMat = useRef<THREE.MeshBasicMaterial>(null);
    useFrame((state) => {
        const now = state.clock.elapsedTime;
        if (outer.current) outer.current.rotation.z = now * 0.16;
        if (inner.current) inner.current.rotation.z = -now * 0.24;
        if (outerMat.current) outerMat.current.opacity = 0.42 + Math.sin(now * 1.8) * 0.12;
        if (innerMat.current) innerMat.current.opacity = 0.28 + Math.sin(now * 2.5 + 1.2) * 0.1;
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
            <Sparkles count={26} scale={[3.4, 2.6, 3.4]} position={[0, 1.2, 0]} size={2.4} speed={0.35} opacity={0.5} color={glow} noise={2} />
        </group>
    );
}

function WfFloor({ theme }: { theme: WfTheme }) {
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
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
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
            <WfHollowGate glow={spec.breachGlow} />
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
    if (!mesh) return null;
    return <primitive object={mesh} />;
}
useGLTF.preload("/pet-models/wf-boulder.glb");
useGLTF.preload("/pet-models/wf-lantern.glb");

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
    const prevState = useRef("");
    const strikeAt = useRef(-10);
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
    const role = useMemo(() => result.snapshots[0]?.actors.find((a) => a.id === id)?.role ?? "tracker", [result, id]);

    useFrame((state, delta) => {
        const g = root.current; if (!g) return;
        const snaps = result.snapshots;
        const tf = Math.max(0, Math.min(snaps.length - 1, wfClockTick(clock)));
        const i0 = Math.floor(tf), i1 = Math.min(snaps.length - 1, i0 + 1), f = tf - i0;
        const a0 = wfSnapshotIndex(snaps[i0]).actorsById.get(id); if (!a0) return;
        const a1 = wfSnapshotIndex(snaps[i1]).actorsById.get(id) ?? a0;
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
        if (a0.state === "attack" && prevState.current !== "attack") strikeAt.current = now;
        prevState.current = a0.state;
        const striking = now - strikeAt.current < 0.3;

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
        mf.motion = arenaModelMotion(a0.state === "respawning" ? "respawning" : a0.state === "dash" ? "dash" : a0.state === "attack" ? "attack" : "idle", moving, striking);
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
            const important = down || frac < 0.985 || a0.state === "attack" || a0.statuses.length > 0;
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
    const first = result.snapshots[0].structures[team].statues[idx];
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

function WfCore({ result, clock, team }: { result: WarfrontResult; clock: WfClockRef; team: Team }) {
    const gem = useRef<THREE.Mesh>(null);
    const shield = useRef<THREE.Mesh>(null);
    const grp = useRef<THREE.Group>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const label = useRef<HTMLDivElement>(null);
    const first = result.snapshots[0].structures[team].core;
    useFrame((state) => {
        const c = snapAt(result, clock).structures[team].core;
        if (grp.current) grp.current.visible = c.alive;
        if (gem.current) {
            gem.current.rotation.y = state.clock.elapsedTime * 0.8;
            gem.current.position.y = 1.15 + Math.sin(state.clock.elapsedTime * 1.6) * 0.1;
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
    const [rigAvailable, setRigAvailable] = useState<boolean | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        void fetch(GATE_WARDEN_GLB, {
            method: "HEAD",
            cache: "force-cache",
            signal: controller.signal,
        }).then((response) => {
            setRigAvailable(response.ok);
            if (!response.ok) {
                console.warn(`[Warfront] Gate Warden rig returned HTTP ${response.status}; using the safe fallback.`);
            }
        }).catch((error: unknown) => {
            if (controller.signal.aborted) return;
            setRigAvailable(false);
            console.warn(
                "[Warfront] Gate Warden rig could not be reached; using the safe fallback.",
                error instanceof Error ? error.message : String(error),
            );
        });
        return () => controller.abort();
    }, []);

    if (rigAvailable !== true) return <WfWardenBillboard height={targetH} />;
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
            const moving = ups > 0.18;
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
            if (w.winding) rigClip = "GW_Windup";
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
                aura.current.opacity = 0.32 + Math.abs(Math.sin(now * 2.4)) * 0.12 + (w.winding ? 0.18 : 0) + slamArc * 0.24;
                aura.current.color.set(w.phase === 3 ? "#fb7185" : w.phase === 2 ? "#c084fc" : "#9333ea");
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
        if (hpWrap.current) hpWrap.current.style.opacity = w.alive ? "1" : "0";
        if (hpFill.current) {
            hpFill.current.style.width = `${Math.max(0, Math.min(100, (w.hp / w.maxHp) * 100))}%`;
            hpFill.current.style.background = w.phase === 3 ? "#fb7185" : w.phase === 2 ? "#e879f9" : "#a78bfa";
        }
        if (phaseLabel.current) phaseLabel.current.textContent = `PHASE ${["I", "II", "III"][w.phase - 1]}`;
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
    const first = result.snapshots[0].guardians[team][idx];
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
function wfCameraFocus(snap: WfSnapshot, px = 0, pz = 0): { fx: number; fz: number; span: number } {
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
    for (const a of snap.actors) { if (a.team === "blue" && a.state !== "respawning") { mx += a.x; mz += a.y; n++; } }
    if (!n) for (const a of snap.actors) { if (a.state !== "respawning") { mx += a.x; mz += a.y; n++; } }
    if (!n) return { fx: 0, fz: 0, span: 16 };
    mx /= n; mz /= n;
    let rx = mx, rz = mz, rd = Infinity;
    for (const [x, z] of WF_ROAD_PTS) { const d = Math.hypot(x - mx, z - mz); if (d < rd) { rd = d; rx = x; rz = z; } }
    return { fx: mx * 0.55 + rx * 0.45, fz: mz * 0.55 + rz * 0.45, span: 15 };
}

export type WfCamCtl = { mode: "follow" | "free"; fx: number; fz: number; dist: number };

function WfCameraRig({ result, clock, shake, camViewRef, camCtlRef, storyRef, modeRef, focusPetRef }: {
    result: WarfrontResult; clock: WfClockRef; shake: MutableRefObject<number>;
    camViewRef: MutableRefObject<{ x: number; z: number; half: number }>;
    camCtlRef: MutableRefObject<WfCamCtl>;
    storyRef: MutableRefObject<WfStoryCam | null>;
    modeRef: MutableRefObject<WfCamMode>;
    focusPetRef: MutableRefObject<string | null>;
}) {
    const sm = useRef({ fx: 0, fz: 0, d: 18, init: true });
    useFrame((state, delta) => {
        const s = sm.current;
        const ctl = camCtlRef.current;
        if (ctl.mode === "free") {
            // Player-driven spectator cam — glide toward the requested view.
            const k = s.init ? 1 : 0.22;
            s.fx = approach(s.fx, ctl.fx, k, delta);
            s.fz = approach(s.fz, ctl.fz, k, delta);
            s.d = approach(s.d, ctl.dist, k, delta);
        } else {
            // A FEATURED PET (clicked mini-screen) owns the main camera
            // outright; otherwise mode-aware focus — broadcast chases the
            // director's story cuts, calm rides wide, team locks to the squad.
            const mode = modeRef.current;
            let focus: { fx: number; fz: number; span: number } | null = null;
            let k0: number | null = null;
            const lockedPet = focusPetRef.current;
            if (lockedPet) {
                const snap = snapAt(result, clock);
                const a = snap.actors.find((x) => x.id === lockedPet);
                if (a) { focus = { fx: a.x, fz: a.y, span: 13 }; k0 = s.init ? 1 : 0.09; }
            }
            if (focus === null) focus = ((): { fx: number; fz: number; span: number } => {
                if (mode === "team") {
                    const snap = snapAt(result, clock);
                    let n = 0, mx = 0, mz = 0;
                    for (const a of snap.actors) if (a.team === "blue" && a.state !== "respawning") { mx += a.x; mz += a.y; n++; }
                    if (!n) return wfCameraFocus(snap, s.fx, s.fz);
                    mx /= n; mz /= n;
                    let spread = 0;
                    for (const a of snap.actors) {
                        if (a.team !== "blue" || a.state === "respawning") continue;
                        const d = Math.hypot(a.x - mx, a.y - mz);
                        if (d > spread) spread = d;
                    }
                    // Widen with the squad's spread so split lanes still show
                    // everyone instead of an empty centroid.
                    return { fx: mx, fz: mz, span: Math.min(26, Math.max(15, spread * 2 + 7)) };
                }
                const f0 = wfCameraFocus(snapAt(result, clock), s.fx, s.fz);
                return mode === "calm" ? { fx: f0.fx, fz: f0.fz, span: Math.min(26, f0.span + 6) } : f0;
            })();
            let k = k0 ?? (s.init ? 1 : mode === "calm" ? 0.03 : 0.045);
            const story = storyRef.current;
            if (story) {
                const t = wfClockTick(clock);
                if (t <= story.untilT && t >= story.untilT - WARFRONT_TPS * 4) {
                    if (!lockedPet && (mode === "broadcast" || (mode === "calm" && story.prio >= 4))) {
                        focus = { fx: story.x, fz: story.z, span: mode === "calm" ? story.span + 4 : story.span };
                        k = s.init ? 1 : 0.11;   // cut faster than the ambient drift
                    }
                } else storyRef.current = null;   // expired (or the clock rewound)
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
        const amp = shake.current;
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
        let dragging = false, lastX = 0, lastY = 0, moved = 0;
        const clampView = () => {
            const c = camCtlRef.current;
            c.fx = Math.max(-WF_X - 6, Math.min(WF_X + 6, c.fx));
            c.fz = Math.max(-WF_Y - 6, Math.min(WF_Y + 6, c.fz));
            c.dist = Math.max(9, Math.min(48, c.dist));
        };
        const down = (e: PointerEvent) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; };
        const move = (e: PointerEvent) => {
            if (!dragging) return;
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
        const up = () => { dragging = false; };
        const wheel = (e: WheelEvent) => {
            e.preventDefault();
            const c = camCtlRef.current;
            if (c.mode !== "free") { c.mode = "free"; onModeChange("free"); }
            c.dist *= 1 + Math.sign(e.deltaY) * 0.09;
            clampView();
        };
        el.addEventListener("pointerdown", down);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        el.addEventListener("wheel", wheel, { passive: false });
        return () => {
            el.removeEventListener("pointerdown", down);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            el.removeEventListener("wheel", wheel);
        };
    }, [gl, camCtlRef, onModeChange]);
    return null;
}

function WfTicker({ result, clockRef, shakeRef, onFrontier, pumpRef, playbackRate }: {
    result: WarfrontResult; clockRef: WfClockRef; shakeRef: MutableRefObject<number>;
    onFrontier: MutableRefObject<() => void>;
    pumpRef: MutableRefObject<() => void>;
    playbackRate: number;
}) {
    useFrame((_s, delta) => {
        if (shakeRef.current > 0.01) shakeRef.current *= 0.85;
        // STREAM the sim: a couple of ms of ticks per frame keeps the frontier
        // ahead of the clock — the old synchronous 90 s chunk froze the main
        // thread for ~1 s at every council boundary.
        pumpRef.current();
        const frontier = result.snapshots.length - 1;
        const c = clockRef.current;
        // Fast Refresh can preserve the pre-rate clock shape for one frame.
        // Recover defensively so a poisoned playback clock cannot fan out into
        // undefined snapshot lookups and crash every Three frame callback.
        if (!Number.isFinite(c.t)) c.t = 0;
        if (!Number.isFinite(c.rate)) c.rate = 1;
        if (!c.playing) return;
        // Hit-stop: kills briefly drop playback to quarter speed (pure
        // presentation — the recorded sim underneath is untouched).
        const targetRate = (c.slow > 0 ? 0.28 : 1) * playbackRate;
        c.rate = approach(c.rate, targetRate, targetRate < c.rate ? 0.42 : 0.12, delta);
        if (c.slow > 0) c.slow = Math.max(0, c.slow - delta);
        c.t = Math.min(frontier, c.t + delta * c.rate * WARFRONT_TPS);
        if (c.t >= frontier) onFrontier.current();
    });
    return null;
}

// ── PiP chase cam (render takeover, same pattern as the arena stage) ─────────
function WfMultiCam({ result, clock, petIds, tileW, tileH, margin, gap, renderEvery, statusRefs, hpRefs, tileRefs, selectedRef, camViewRef }: {
    result: WarfrontResult; clock: WfClockRef; petIds: string[];
    tileW: number; tileH: number; margin: number; gap: number;
    renderEvery: number;
    statusRefs: MutableRefObject<Array<HTMLSpanElement | null>>;
    hpRefs: MutableRefObject<Array<HTMLDivElement | null>>;
    tileRefs: MutableRefObject<Array<HTMLDivElement | null>>;
    selectedRef: MutableRefObject<string | null>;
    camViewRef: MutableRefObject<{ x: number; z: number; half: number }>;
}) {
    const cams = useRef<THREE.PerspectiveCamera[]>([]);
    const sm = useRef<Array<{ x: number; z: number; init: boolean }>>([]);
    // STAGGERED WALL: High quality renders one tile every other frame into a
    // cached texture (~7.5 fps per tile at 60 fps). Average cost is 1.5 world
    // renders per frame instead of the old 2 or the original 5.
    const rig = useRef<{ rts: THREE.WebGLRenderTarget[]; scene: THREE.Scene; cam: THREE.OrthographicCamera; quads: THREE.Mesh[] } | null>(null);
    const frameNo = useRef(0);
    useEffect(() => () => {
        const r = rig.current;
        if (!r) return;
        for (const rt of r.rts) rt.dispose();
        for (const q of r.quads) { q.geometry.dispose(); (q.material as THREE.Material).dispose(); }
        rig.current = null;
    }, []);
    useFrame((state, delta) => {
        const { gl, scene, camera, size } = state;
        // Shadow maps refresh at 30 Hz — invisible for a fixed sun, and it
        // halves the priciest fixed cost of the frame.
        gl.shadowMap.autoUpdate = false;
        const renderFrame = frameNo.current++;
        if (renderFrame % 2 === 0) gl.shadowMap.needsUpdate = true;
        gl.setScissorTest(false);
        gl.setViewport(0, 0, size.width, size.height);
        gl.autoClear = true;
        gl.render(scene, camera);
        const snap = snapAt(result, clock);
        const snapIndex = wfSnapshotIndex(snap);
        const selected = selectedRef.current;
        const view = camViewRef.current;
        if (!rig.current) {
            const dpr = gl.getPixelRatio();
            const cscene = new THREE.Scene();
            const ccam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
            const rts: THREE.WebGLRenderTarget[] = [];
            const quads: THREE.Mesh[] = [];
            for (let i = 0; i < petIds.length; i++) {
                const rt = new THREE.WebGLRenderTarget(Math.max(2, Math.round(tileW * dpr)), Math.max(2, Math.round(tileH * dpr)));
                rts.push(rt);
                const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: rt.texture }));
                quads.push(q);
                cscene.add(q);
            }
            rig.current = { rts, scene: cscene, cam: ccam, quads };
        }
        const r = rig.current;
        // Render exactly one tile's world this frame (round-robin).
        const shouldRefreshTile = renderFrame % Math.max(1, renderEvery) === 0;
        const i = Math.floor(renderFrame / Math.max(1, renderEvery)) % Math.max(1, petIds.length);
        const id = petIds[i];
        const a = snapIndex.actorsById.get(id);
        if (shouldRefreshTile && a) {
            if (!cams.current[i]) cams.current[i] = new THREE.PerspectiveCamera(46, tileW / Math.max(1, tileH), 0.4, 80);
            const cam = cams.current[i];
            cam.aspect = tileW / Math.max(1, tileH);
            cam.updateProjectionMatrix();
            if (selected === id) {
                // SWAPPED: this pet owns the MAIN screen — its tile carries the
                // broadcast so the director's view is never lost.
                const f = wfCameraFocus(snap, view.x, view.z);
                const d2 = Math.min(20, arenaCameraDist(f.span, tileW / Math.max(1, tileH)));
                cam.position.set(f.fx, Math.sin(WF_CAMERA_PITCH) * d2, f.fz + Math.cos(WF_CAMERA_PITCH) * d2);
                cam.lookAt(f.fx, 0, f.fz);
            } else {
                if (!sm.current[i]) sm.current[i] = { x: a.x, z: a.y, init: true };
                const s = sm.current[i];
                const jump = Math.hypot(a.x - s.x, a.y - s.z) > 5;
                if (s.init || jump) { s.x = a.x; s.z = a.y; s.init = false; }
                else { s.x = approach(s.x, a.x, 0.5, delta); s.z = approach(s.z, a.y, 0.5, delta); }
                // Same terrain-clearing drone framing as the old chase cam.
                cam.position.set(s.x, 6.8, s.z + 4.6);
                cam.lookAt(s.x, 0.6, s.z);
            }
            // Tiles reuse the shadow map the MAIN render just produced — no
            // second shadow pass for the monitor wall.
            const shadowAuto = gl.shadowMap.autoUpdate;
            gl.shadowMap.autoUpdate = false;
            gl.setRenderTarget(r.rts[i]);
            gl.setClearColor("#05070f", 1);
            gl.clear(true, true);
            gl.render(scene, cam);
            gl.setRenderTarget(null);
            gl.shadowMap.autoUpdate = shadowAuto;
        }
        // Composite all four cached tiles (one trivial quad pass).
        r.cam.right = size.width;
        r.cam.top = size.height;
        r.cam.updateProjectionMatrix();
        petIds.forEach((pid, j) => {
            const q = r.quads[j];
            const x0 = margin + j * (tileW + gap);
            q.position.set(x0 + tileW / 2, margin + tileH / 2, 0);
            q.scale.set(tileW, tileH, 1);
        });
        gl.autoClear = false;
        gl.render(r.scene, r.cam);
        gl.autoClear = true;
        // Tile chrome updates EVERY frame for every pet (DOM writes are cheap).
        petIds.forEach((pid, j) => {
            const aj = snapIndex.actorsById.get(pid);
            if (!aj) return;
            const el = statusRefs.current[j];
            if (el) {
                const t = aj.state === "respawning" && aj.respawnSecs > 0 ? `↻ ${aj.respawnSecs}s` : "";
                if (el.textContent !== t) el.textContent = t;
            }
            const hp = hpRefs.current[j];
            if (hp) {
                const frac = Math.max(0, Math.min(1, aj.hp / Math.max(1, aj.maxHp)));
                hp.style.width = `${Math.round(frac * 100)}%`;
                hp.style.background = frac < 0.35 ? "#f87171" : "#60a5fa";
            }
            const tile = tileRefs.current[j];
            if (tile) {
                const offscreen = Math.abs(aj.x - view.x) > view.half * 1.45 || Math.abs(aj.y - view.z) > view.half;
                const inFight = aj.state !== "respawning" && snap.actors.some((b) => b.team !== aj.team && b.state !== "respawning" && Math.hypot(b.x - aj.x, b.y - aj.y) < 6);
                const hurt = aj.state !== "respawning" && aj.hp / Math.max(1, aj.maxHp) < 0.35;
                const pulse = selected !== pid && offscreen && (inFight || hurt) ? "wfTilePulse 0.9s ease-in-out infinite" : "";
                if (tile.style.animation !== pulse) tile.style.animation = pulse;
            }
        });
    }, 1);
    return null;
}

// ── The broadcast director (events → FX/feed/banners) ────────────────────────
type WfFxItem = { id: number; frames: string[]; pos: Vec3; scale: number; dur: number };
type WfShotItem = { id: number; from: Vec3; to: Vec3; visual: ProjectileVisual; dur: number; arc: number };
type WfFloatItem = { id: number; pos: Vec3; text: string; color: string; big: boolean };

// Broadcast colors for the elemental signature moves.
const WF_EL_COLORS: Record<string, string> = {
    Fire: "#fb923c", Water: "#38bdf8", Earth: "#d3a44a", Wind: "#6ee7b7", Lightning: "#fde047",
};

function WfDirector({ result, clockRef, nameOf, pushFeed, pushBanner, triggerFlash, shakeRef, spawnFx, spawnShot, spawnFloater, storyRef, camViewRef, onEnd }: {
    result: WarfrontResult; clockRef: WfClockRef;
    nameOf: (id: string) => string;
    pushFeed: (text: string, color: string) => void;
    pushBanner: (text: string, color: string, big?: boolean) => void;
    triggerFlash: (color: string) => void;
    shakeRef: MutableRefObject<number>;
    spawnFx: (x: number, z: number, key: string | null, element: string | null | undefined, scale: number, dur: number) => void;
    spawnShot: (fromX: number, fromY: number, toX: number, toY: number, element: string | null | undefined, charged: boolean) => void;
    spawnFloater: (x: number, z: number, text: string, color: string, big: boolean) => void;
    storyRef: MutableRefObject<WfStoryCam | null>;
    camViewRef: MutableRefObject<{ x: number; z: number; half: number }>;
    onEnd: () => void;
}) {
    const lastTick = useRef(-1);
    const evCursor = useRef(0);   // forward-only index into result.events (tick-sorted)
    const ended = useRef(false);
    // Announcer memory: first blood fired, each pet's current kill spree, and
    // which structures already raised their under-siege alarm.
    const firstBlood = useRef(false);
    const sprees = useRef(new Map<string, number>());
    const siegeWarned = useRef(new Set<string>());
    const hollowWaves = useRef(0);
    const isPet = (id: string) => id.startsWith("blue-") || id.startsWith("red-");
    useFrame(() => {
        const cur = Math.floor(wfClockTick(clockRef));
        // Rewind (replay) resets ALL director-local memory — including `ended`,
        // which otherwise stayed true and stopped onEnd() from firing on replay.
        if (cur < lastTick.current) { lastTick.current = -1; evCursor.current = 0; firstBlood.current = false; sprees.current.clear(); siegeWarned.current.clear(); hollowWaves.current = 0; ended.current = false; }
        // The director orders a camera cut to a story beat; higher priority (or
        // an expired story) always wins the slot.
        const cut = (t: number, x: number, z: number, span: number, prio: number, secs: number) => {
            const s = storyRef.current;
            if (!s || wfClockTick(clockRef) > s.untilT || prio >= s.prio) storyRef.current = { x, z, untilT: t + WARFRONT_TPS * secs, span, prio };
        };
        if (cur > lastTick.current) {
            const snaps = result.snapshots;
            // Forward-only cursor: events are tick-sorted, so resume where the last
            // advance stopped instead of rescanning the whole (ever-growing) list
            // every tick — O(events) across the match, not O(events × ticks).
            const events = result.events;
            let ei = evCursor.current;
            for (; ei < events.length; ei++) {
                const e = events[ei];
                if (e.t <= lastTick.current) continue;   // defensive; cursor is normally already past these
                if (e.t > cur) break;                     // sorted → nothing more belongs to this advance
                const snap = snaps[Math.min(snaps.length - 1, e.t)];
                const actorPos = (id: string) => snap.actors.find((a) => a.id === id);
                if (e.type === "hit") {
                    const tgt = actorPos(e.targetId);
                    if (tgt) {
                        spawnFx(tgt.x, tgt.y, null, e.element, e.crit ? 1.35 : 0.8, 260);
                        spawnFloater(tgt.x, tgt.y, `${e.dmg}`, e.crit ? "#fde047" : "#fecaca", e.crit);
                        const src = actorPos(e.actorId);
                        if (src && Math.hypot(src.x - tgt.x, src.y - tgt.y) >= 1.8) spawnShot(src.x, src.y, tgt.x, tgt.y, e.element, e.crit);
                        else if (e.actorId.startsWith("guard-")) {
                            // Sentinel fire now reads: a bolt to the target + a muzzle
                            // flash at the post, and its charged shots (crit) fire big.
                            const [, gTeam, gIdx] = e.actorId.split("-");
                            const gg = snap.guardians[gTeam as Team]?.[Number(gIdx)];
                            if (gg) { spawnShot(gg.x, gg.y, tgt.x, tgt.y, gTeam === "blue" ? "Water" : "Fire", e.crit); spawnFx(gg.x, gg.y, "spark", null, e.crit ? 1.1 : 0.55, 200); }
                        }
                        if (e.crit) shakeRef.current = Math.max(shakeRef.current, 0.5);
                        // A pet in danger is the story — nudge the camera there.
                        if (tgt.hp / Math.max(1, tgt.maxHp) < 0.35) cut(e.t, tgt.x, tgt.y, 14, 1, 1.2);
                    }
                } else if (e.type === "heal") {
                    const tgt = actorPos(e.targetId);
                    if (tgt) { spawnFx(tgt.x, tgt.y, "heal", null, 1.3, 420); spawnFloater(tgt.x, tgt.y, `+${e.amount}`, "#86efac", false); }
                } else if (e.type === "kill") {
                    const tgt = actorPos(e.targetId);
                    if (tgt) {
                        spawnFx(tgt.x, tgt.y, "spark", null, 2.6, 560);
                        spawnFloater(tgt.x, tgt.y, "☠", "#f8fafc", true);
                        cut(e.t, tgt.x, tgt.y, 12, 3, 2.2);   // the broadcast cuts to the takedown
                    }
                    pushFeed(`☠ ${nameOf(e.targetId)} — slain by ${nameOf(e.actorId)}`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    shakeRef.current = Math.max(shakeRef.current, 1.3);
                    clockRef.current.slow = Math.max(clockRef.current.slow, 0.3);   // hit-stop
                    // Announcer: first blood, sprees, shutdowns (pet kills only).
                    if (isPet(e.actorId)) {
                        if (!firstBlood.current) {
                            firstBlood.current = true;
                            pushBanner(`🩸 FIRST BLOOD — ${nameOf(e.actorId)}`, e.team === "blue" ? "#93c5fd" : "#fca5a5", true);
                        }
                        const streak = (sprees.current.get(e.actorId) ?? 0) + 1;
                        sprees.current.set(e.actorId, streak);
                        if (streak === 3) { pushBanner(`🔥 ${nameOf(e.actorId).toUpperCase()} IS RAMPAGING`, "#fb923c"); }
                        else if (streak === 5) { pushBanner(`⚡ ${nameOf(e.actorId).toUpperCase()} IS UNSTOPPABLE`, "#fde047", true); }
                    }
                    const victimStreak = sprees.current.get(e.targetId) ?? 0;
                    if (victimStreak >= 3) pushFeed(`🛑 SHUTDOWN — ${nameOf(e.targetId)}'s rampage ends`, "#fbbf24");
                    sprees.current.set(e.targetId, 0);
                } else if (e.type === "gank") {
                    pushBanner(`🗡 GANK — ${nameOf(e.actorId)} springs the ambush!`, "#c084fc");
                    pushFeed(`🗡 ${nameOf(e.actorId)} ambushes ${nameOf(e.targetId)} from the tall grass`, "#c084fc");
                    spawnFx(e.x, e.y, "shadow", null, 2.0, 500);
                    cut(e.t, e.x, e.y, 12, 3, 2.4);
                } else if (e.type === "mobhit") {
                    spawnFx(e.x, e.y, "spark", null, 0.7, 200);
                    // A sentinel or camp boss shooting a minion gets a visible bolt
                    // from the shooter — their most common attack was invisible.
                    if (e.targetId?.startsWith("guard-")) {
                        const [, gTeam, gIdx] = e.targetId.split("-");
                        const gg = snap.guardians[gTeam as Team]?.[Number(gIdx)];
                        if (gg) { spawnShot(gg.x, gg.y, e.x, e.y, gTeam === "blue" ? "Water" : "Fire", false); spawnFx(gg.x, gg.y, "spark", null, 0.5, 150); }
                    } else if (e.targetId?.startsWith("mini-")) {
                        const m = snap.minis.find((z) => z.padIdx === Number(e.targetId!.split("-")[1]));
                        if (m) spawnFx(m.x, m.y, null, "Shadow", 0.5, 170);
                    }
                } else if (e.type === "mobstrike") {
                    // Small elemental puff — minion attacks now READ (Water=blue
                    // wave, Fire=red wave, Shadow=hollow-spawn).
                    spawnFx(e.x, e.y, null, e.el, 0.4, 170);
                } else if (e.type === "mobkill") {
                    spawnFloater(e.x, e.y, "+25 🪙", "#fde047", false);
                } else if (e.type === "mobwave") {
                    // The simulation's Hollow-wave beat now reaches the gate:
                    // a portal pulse makes new raiders feel spawned, not popped in.
                    spawnFx(WF_LAIR.x, WF_LAIR.y, "shadow", null, 1.65, 420);
                    hollowWaves.current++;
                    if (hollowWaves.current === 1 || hollowWaves.current % 3 === 0) {
                        pushFeed(`☾ Hollow hounds breach the ${hollowWaves.current % 2 ? "outer" : "inner"} lanes`, "#d8b4fe");
                    }
                } else if (e.type === "structhit") {
                    spawnFx(e.x, e.y, "spark", null, e.core ? 1.4 : 1.0, 240);
                    if (e.core) shakeRef.current = Math.max(shakeRef.current, 0.5);
                    // First warning per structure: it just fell under 60% —
                    // siege pressure must be a story BEFORE the point lands.
                    // (Resolve the target by position: guardian structhits
                    // reuse the `statue` field for their own index.)
                    let key = "", label = "", frac = 1;
                    const gg2 = snap.guardians[e.team].find((g) => g.alive && Math.hypot(g.x - e.x, g.y - e.y) < 2);
                    const ss2 = snap.structures[e.team].statues.find((s) => s.alive && Math.hypot(s.x - e.x, s.y - e.y) < 2);
                    if (gg2) { key = `g-${e.team}-${snap.guardians[e.team].indexOf(gg2)}`; label = "sentinel"; frac = gg2.hp / gg2.maxHp; }
                    else if (ss2) { key = `s-${e.team}-${snap.structures[e.team].statues.indexOf(ss2)}`; label = "totem"; frac = ss2.hp / ss2.maxHp; }
                    else if (e.core) { key = `c-${e.team}`; label = "Ward Seal"; frac = snap.structures[e.team].core.hp / snap.structures[e.team].core.maxHp; }
                    if (key && frac < 0.6 && !siegeWarned.current.has(key)) {
                        siegeWarned.current.add(key);
                        pushFeed(`🚨 ${e.team === "blue" ? "Blue" : "Red"}'s ${label} is under siege!`, "#fbbf24");
                        cut(e.t, e.x, e.y, 13, 2, 1.8);
                    }
                } else if (e.type === "statuedown") {
                    const fallen = snap.structures[e.team].statues[e.statue];
                    pushBanner("⛩ GUARDIAN TOTEM SHATTERED", e.by === "blue" ? "#93c5fd" : "#fca5a5");
                    pushFeed(`⛩ ${e.team === "blue" ? "Blue" : "Red"} totem down (+${200} 🪙)`, e.by === "blue" ? "#60a5fa" : "#f87171");
                    triggerFlash(e.by === "blue" ? "rgba(59,130,246,0.3)" : "rgba(239,68,68,0.3)");
                    shakeRef.current = Math.max(shakeRef.current, 1.8);
                    if (fallen) {
                        spawnFx(fallen.x, fallen.y, "power", null, 2.8, 650);
                        spawnFx(fallen.x, fallen.y, "spark", null, 2.0, 500);
                        cut(e.t, fallen.x, fallen.y, 13, 4, 2.4);
                    }
                    clockRef.current.slow = Math.max(clockRef.current.slow, 0.25);
                } else if (e.type === "coreexposed") {
                    pushBanner(`🛡 ${e.team === "blue" ? "BLUE" : "RED"} SEAL EXPOSED — LAST STAND!`, e.team === "blue" ? "#60a5fa" : "#f87171", true);
                    pushFeed(`🛡 ${e.team === "blue" ? "Blue" : "Red"}'s Ward Seal lies bare — a desperate LAST STAND (they hit +20% for 45s)`, "#fde047");
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.22)" : "rgba(239,68,68,0.22)");
                    playPetSfx("shield");
                } else if (e.type === "shutdown") {
                    pushBanner(`🎯 SHUTDOWN — ${nameOf(e.actorId)} cashes in! +${e.bounty}🪙`, "#fbbf24", true);
                    pushFeed(`🎯 ${nameOf(e.actorId)} SHUTS DOWN ${nameOf(e.targetId)}'s ${e.streak}-streak for a ${e.bounty}🪙 bounty`, "#fbbf24");
                    const av = actorPos(e.targetId);
                    if (av) spawnFloater(av.x, av.y, `+${e.bounty}🪙`, "#fde047", true);
                } else if (e.type === "coredown") {
                    const core = snap.structures[e.team].core;
                    pushBanner(`${e.by === "blue" ? "BLUE" : "RED"} SHATTERS THE WARD SEAL!`, e.by === "blue" ? "#60a5fa" : "#f87171", true);
                    playPetSfx("victory");
                    triggerFlash(e.by === "blue" ? "rgba(59,130,246,0.5)" : "rgba(239,68,68,0.5)");
                    shakeRef.current = Math.max(shakeRef.current, 2.2);
                    spawnFx(core.x, core.y, "power", null, 3.4, 900);
                    spawnFx(core.x, core.y, "spark", null, 2.6, 700);
                    cut(e.t, core.x, core.y, 14, 6, 3.5);
                    clockRef.current.slow = Math.max(clockRef.current.slow, 0.5);
                } else if (e.type === "minispawn") {
                    pushFeed(`👹 The ${WF_MINI_NAMES[e.padIdx] ?? "Lesser Warden"} has awakened at its shrine`, "#d8b4fe");
                } else if (e.type === "minikill") {
                    const boss = WF_MINI_NAMES[e.padIdx] ?? "Lesser Warden";
                    const boon = MINI_BOONS[e.padIdx] ?? MINI_BOONS[0];
                    pushBanner(`🤝 ${boss.toUpperCase()} RECRUITED — fights for ${e.team === "blue" ? "BLUE" : "RED"}!`, e.team === "blue" ? "#93c5fd" : "#fca5a5", true);
                    pushFeed(`${boon.icon} ${e.team === "blue" ? "Blue" : "Red"} recruits the ${boss}: ${boon.label} ${boon.desc} (+${350} 🪙)`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    playPetSfx("buff");
                    const mm = snap.minis.find((z) => z.padIdx === e.padIdx);
                    if (mm) { spawnFx(mm.x, mm.y, "power", null, 2.2, 520); cut(e.t, mm.x, mm.y, 13, 3, 2); }
                } else if (e.type === "miniboon") {
                    const boon = MINI_BOONS[e.padIdx] ?? MINI_BOONS[0];
                    const color = e.team === "blue" ? "#93c5fd" : "#fca5a5";
                    spawnFloater(e.x, e.y, `${boon.icon} ${boon.label.toUpperCase()}`, color, false);
                    spawnFx(e.x, e.y, e.kind === "hunt" ? "shadow" : e.kind === "siege" ? "power" : e.kind === "heal" ? "heal" : "spark", null, 1.25, 340);
                } else if (e.type === "wardenwindup") {
                    spawnFx(e.x, e.y, "shadow", null, 2.2, 420);
                    spawnFloater(e.x, e.y, "SLAM — MOVE!", "#f0abfc", true);
                    playPetSfx("debuff");
                    shakeRef.current = Math.max(shakeRef.current, 0.4);
                } else if (e.type === "wardenslam") {
                    spawnFx(e.x, e.y, "power", null, 2.8, 500);
                    playPetSfx("crit");
                    shakeRef.current = Math.max(shakeRef.current, 1.4);
                } else if (e.type === "wardenphase") {
                    const phase = e.phase === 3 ? "PHASE III — HOLLOW RAGE" : "PHASE II — VOID RUPTURE";
                    const color = e.phase === 3 ? "#fb7185" : "#e879f9";
                    pushBanner(`⛰ GATE WARDEN: ${phase}`, color, true);
                    pushFeed(`⛰ The Gate Warden enters ${phase}; its attacks quicken and the slam grows.`, color);
                    playPetSfx("ko");
                    triggerFlash(e.phase === 3 ? "rgba(244,63,94,0.3)" : "rgba(192,38,211,0.25)");
                    shakeRef.current = Math.max(shakeRef.current, e.phase === 3 ? 1.8 : 1.2);
                    cut(e.t, WF_LAIR.x, WF_LAIR.y, 15, 5, 2.5);
                } else if (e.type === "wardenkill") {
                    if (e.stolen) {
                        pushBanner(`😱 THE WARDEN IS STOLEN BY ${e.team === "blue" ? "BLUE" : "RED"}!`, "#fde047", true);
                        pushFeed(`😱 ${e.team === "blue" ? "Blue" : "Red"} STEALS the Gate Warden — daylight robbery! +${1200} 🪙`, "#fde047");
                    } else {
                        pushBanner(`⛰ ${e.team === "blue" ? "BLUE" : "RED"} FELLS THE GATE WARDEN! +${1200} 🪙`, e.team === "blue" ? "#60a5fa" : "#f87171", true);
                        pushFeed("⛰ The Hollow Gate falls silent…", "#c084fc");
                    }
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.45)" : "rgba(239,68,68,0.45)");
                    playPetSfx("victory");
                    shakeRef.current = Math.max(shakeRef.current, 1.8);
                    cut(e.t, WF_LAIR.x, WF_LAIR.y, 15, 5, 3);
                    clockRef.current.slow = Math.max(clockRef.current.slow, 0.35);
                } else if (e.type === "phase") {
                    const sudden = e.name === "SUDDEN DEATH";
                    const label = e.name === "SKIRMISH" ? "⚔ SKIRMISH — camps unlock" : e.name === "WAR" ? "⛰ WAR — MARCH ON THE WARDEN" : "💀 THE HOLLOW COLLAPSES — bases crumble, end it now";
                    pushBanner(label, sudden ? "#f87171" : "#fde047", true);
                    pushFeed(label, sudden ? "#f87171" : "#fde047");
                    shakeRef.current = Math.max(shakeRef.current, sudden ? 1.4 : 0.8);
                    playPetSfx(sudden ? "ko" : "buff");
                    if (sudden) triggerFlash("rgba(239,68,68,0.32)");
                } else if (e.type === "guardiandown") {
                    const post = snap.guardians[e.team]?.[e.idx];
                    pushBanner("🛡 SENTINEL FALLS — THE GATE LIES UNWARDED", e.by === "blue" ? "#93c5fd" : "#fca5a5");
                    pushFeed(`🛡 ${e.team === "blue" ? "Blue" : "Red"}'s sentinel is slain (+${250} 🪙)`, e.by === "blue" ? "#60a5fa" : "#f87171");
                    triggerFlash(e.by === "blue" ? "rgba(59,130,246,0.28)" : "rgba(239,68,68,0.28)");
                    shakeRef.current = Math.max(shakeRef.current, 1.6);
                    if (post) {
                        spawnFx(post.x, post.y, "power", null, 2.6, 600);
                        spawnFx(post.x, post.y, "spark", null, 1.8, 480);
                        cut(e.t, post.x, post.y, 13, 4, 2.2);
                    }
                } else if (e.type === "guardianrally") {
                    const color = e.team === "blue" ? "#93c5fd" : "#fca5a5";
                    const boss = WF_MINI_NAMES[e.padIdx] ?? "Lesser Warden";
                    pushFeed(`⚡ ${boss}'s capture overcharges ${e.team === "blue" ? "Blue" : "Red"} lane sentinels for ${e.secs}s`, color);
                    for (const guardian of snap.guardians[e.team]) {
                        if (guardian.alive) spawnFx(guardian.x, guardian.y, "power", null, 1.8, 500);
                    }
                    playPetSfx("buff");
                } else if (e.type === "guardianward") {
                    const target = actorPos(e.targetId);
                    if (target) {
                        spawnShot(e.x, e.y, target.x, target.y, e.team === "blue" ? "Water" : "Fire", false);
                        spawnFx(target.x, target.y, "spark", null, 1.0, 300);
                        spawnFloater(target.x, target.y, `🛡 WARD +${e.amount}`, e.team === "blue" ? "#93c5fd" : "#fca5a5", false);
                    }
                } else if (e.type === "ability") {
                    if (e.kind === "shield") spawnFx(e.x, e.y, null, "Water", 1.15, 320);
                    else if (e.kind === "dash") spawnFx(e.x, e.y, "shadow", null, 0.9, 260);
                    else if (e.kind === "mark") { spawnFx(e.x, e.y, "spark", null, 0.8, 240); spawnFloater(e.x, e.y, "🎯 MARKED", "#f87171", false); }
                } else if (e.type === "focus") {
                    // The squad collapses on one target — a single clean cue.
                    spawnFloater(e.x, e.y, "⚔ FOCUS FIRE", "#fbbf24", false);
                } else if (e.type === "elemsig") {
                    const col = WF_EL_COLORS[e.el] ?? "#c4b5fd";
                    spawnShot(e.px, e.py, e.x, e.y, e.el || null, false);
                    spawnFx(e.x, e.y, null, e.el || null, 1.5, 380);
                    spawnFloater(e.x, e.y, e.name, col, true);
                } else if (e.type === "bosssig") {
                    const bossN = WF_MINI_NAMES[e.padIdx] ?? "Lesser Warden";
                    if (e.kind === "quake") {
                        spawnFx(e.x, e.y, "shadow", null, 2.4, 620);
                        spawnFloater(e.x, e.y, "⛰ QUAKE!", "#fbbf24", true);
                        pushFeed(`⛰ The ${bossN} coils — QUAKE incoming!`, "#fbbf24");
                        shakeRef.current = Math.max(shakeRef.current, 0.5);
                        cut(e.t, e.x, e.y, 12, 2, 1.6);
                    } else if (e.kind === "quakeland") {
                        spawnFx(e.x, e.y, "power", null, 2.6, 520);
                        shakeRef.current = Math.max(shakeRef.current, 1.3);
                    } else if (e.kind === "shell") {
                        spawnFx(e.x, e.y, null, "Water", 2.0, 600);
                        spawnFloater(e.x, e.y, "💠 CRYSTAL SHELL", "#7dd3fc", false);
                        pushFeed(`💠 The ${bossN} hardens — attackers bleed back!`, "#7dd3fc");
                    } else if (e.kind === "blink") {
                        spawnFx(e.x, e.y, "shadow", null, 1.4, 360);
                        spawnFloater(e.x, e.y, "👁 BLINK", "#c084fc", false);
                    } else if (e.kind === "flame") {
                        spawnFx(e.x, e.y, null, "Fire", 2.2, 480);
                        shakeRef.current = Math.max(shakeRef.current, 0.5);
                    } else if (e.kind === "roar") {
                        // Idle menace — an uncontested camp boss pulses so it reads
                        // as a living threat, not a statue. No banner/feed spam.
                        spawnFx(e.x, e.y, "shadow", null, 1.7, 420);
                        spawnFloater(e.x, e.y, `${bossN} stirs…`, "#c4b5fd", false);
                    }
                } else if (e.type === "wardenshock") {
                    // The paired wardenphase event owns the announcement. Keep the
                    // shockwave itself physical and readable without a duplicate banner.
                    triggerFlash("rgba(147,51,234,0.32)");
                    spawnFx(e.x, e.y, "power", null, 3.2, 800);
                    spawnFx(e.x, e.y, "shadow", null, 2.6, 700);
                    shakeRef.current = Math.max(shakeRef.current, 2.0);
                    clockRef.current.slow = Math.max(clockRef.current.slow, 0.4);
                    cut(e.t, e.x, e.y, 15, 5, 2.6);
                } else if (e.type === "ultimate") {
                    // Each ultimate reads DIFFERENTLY — a signature, not a generic flash.
                    // The world FX + name floater ALWAYS play (visible if you're
                    // looking there or on the multi-cam wall) — but the disruptive
                    // broadcast beat (shake + hard cut) only fires when the caster
                    // is the pet you're actually watching. With ~50 ults a match,
                    // cutting to every one off-screen turned them into wallpaper;
                    // now each on-screen ult is a real moment and the rest just
                    // happen where they happen.
                    if (e.kind === "Shadow Execution") spawnFx(e.x, e.y, "shadow", null, 2.8, 650);
                    else if (e.kind === "Sanctuary") spawnFx(e.x, e.y, "heal", null, 3.0, 700);
                    else if (e.kind === "Bulwark Aegis") spawnFx(e.x, e.y, null, "Water", 2.6, 600);
                    else spawnFx(e.x, e.y, "power", null, 2.6, 600);
                    spawnFloater(e.x, e.y, e.kind.toUpperCase() + "!", "#c4b5fd", true);
                    pushFeed(`✨ ${nameOf(e.petId)} unleashes ${e.kind}!`, "#c4b5fd");
                    const cv = camViewRef.current;
                    const onScreen = Math.abs(e.x - cv.x) < cv.half && Math.abs(e.y - cv.z) < cv.half;
                    if (onScreen) {
                        shakeRef.current = Math.max(shakeRef.current, 0.9);
                        cut(e.t, e.x, e.y, 13, 2, 1.6);
                    }
                } else if (e.type === "petlevel") {
                    const a = actorPos(e.petId);
                    if (a) { spawnFx(a.x, a.y, "power", null, 1.8, 480); spawnFloater(a.x, a.y, `LEVEL ${e.level}!`, "#6ee7b7", true); }
                    pushFeed(`★ ${nameOf(e.petId)} reached level ${e.level}`, "#6ee7b7");
                } else if (e.type === "stance") {
                    const spec2 = WF_STANCES.find((s) => s.id === e.stance);
                    const who = e.team === "blue" ? "BLUE" : "RED";
                    pushBanner(`${spec2?.icon ?? "📜"} ${who} ${e.answer ? "ANSWERS" : "ADOPTS"}: ${(spec2?.label ?? e.stance).toUpperCase()}`, e.team === "blue" ? "#93c5fd" : "#fca5a5", true);
                    pushFeed(`📜 ${who[0]}${who.slice(1).toLowerCase()} ${e.answer ? "answers with" : "adopts"} ${spec2?.label ?? e.stance}`, e.team === "blue" ? "#60a5fa" : "#f87171");
                } else if (e.type === "buy") {
                    const spec = WF_POWERUPS.find((p) => p.kind === e.kind);
                    pushFeed(`${spec?.icon ?? "▲"} ${nameOf(e.petId)} gains ${spec?.label ?? e.kind}`, e.team === "blue" ? "#93c5fd" : "#fca5a5");
                }
            }
            evCursor.current = ei;
            lastTick.current = cur;
        }
        if (!ended.current && result.winner !== null && wfClockTick(clockRef) >= result.snapshots.length - 1) {
            ended.current = true;
            onEnd();
        }
    });
    return null;
}

// ── Minimap (DOM canvas — mask + live dots) ──────────────────────────────────
function WfMinimap({ result, clock, theme, camViewRef, camCtlRef, onModeChange }: {
    result: WarfrontResult; clock: WfClockRef; theme: WfTheme;
    camViewRef: MutableRefObject<{ x: number; z: number; half: number }>;
    camCtlRef: MutableRefObject<WfCamCtl>; onModeChange: (m: "follow" | "free") => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const spec = WF_THEMES[theme];
    const bg = useMemo(() => {
        const c = document.createElement("canvas");
        c.width = WF_COLS; c.height = WF_ROWS;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = spec.voidColor;
        ctx.fillRect(0, 0, WF_COLS, WF_ROWS);
        // Four-tone read, like a real MOBA minimap: gold ROADS, mid GROUND,
        // dark jungle WALLS inside the field, void beyond the rim.
        const h = Math.round(spec.tileHue * 360), sPct = Math.round(spec.tileSat * 100);
        const roadCol = `hsl(${h}, ${Math.min(70, sPct + 22)}%, 46%)`;
        const groundCol = `hsl(${h}, ${sPct}%, 27%)`;
        const wallCol = `hsl(${h}, ${sPct}%, 12%)`;
        for (let r = 0; r < WF_ROWS; r++) for (let cc = 0; cc < WF_COLS; cc++) {
            const x = (cc + 0.5) * (WF_X * 2 / WF_COLS) - WF_X, y = (r + 0.5) * (WF_Y * 2 / WF_ROWS) - WF_Y;
            const walk = WF_MASK.charCodeAt(r * WF_COLS + cc) === 49;
            if (walk) ctx.fillStyle = wfLaneDistance(x, y) < 1.8 ? roadCol : groundCol;
            else if (wfInsideField(x, y)) ctx.fillStyle = wallCol;
            else continue;
            ctx.fillRect(cc, r, 1, 1);
        }
        return c;
    }, [spec]);
    useEffect(() => {
        let live = true;
        const draw = () => {
            if (!live) return;
            const cv = canvasRef.current;
            if (cv) {
                const ctx = cv.getContext("2d");
                if (ctx) {
                    ctx.clearRect(0, 0, cv.width, cv.height);
                    ctx.drawImage(bg, 0, 0, cv.width, cv.height);
                    const snap = snapAt(result, clock);
                    const px = (x: number) => ((x + WF_X) / (WF_X * 2)) * cv.width;
                    const py = (y: number) => ((y + WF_Y) / (WF_Y * 2)) * cv.height;
                    const dot = (x: number, y: number, r: number, color: string) => {
                        ctx.fillStyle = color;
                        ctx.beginPath();
                        ctx.arc(px(x), py(y), r, 0, Math.PI * 2);
                        ctx.fill();
                    };
                    // Damaged structures pulse an amber alarm ring — siege
                    // pressure reads from the minimap at a glance.
                    const now2 = performance.now() / 1000;
                    const alarm = (x: number, y: number) => {
                        ctx.strokeStyle = `rgba(251,191,36,${(0.5 + 0.4 * Math.sin(now2 * 6.5)).toFixed(3)})`;
                        ctx.lineWidth = 1.4;
                        ctx.beginPath();
                        ctx.arc(px(x), py(y), 5.4 + Math.sin(now2 * 6.5) * 1.2, 0, Math.PI * 2);
                        ctx.stroke();
                    };
                    for (const team of ["blue", "red"] as const) {
                        const st = snap.structures[team];
                        for (const s of st.statues) {
                            if (!s.alive) continue;
                            dot(s.x, s.y, 2.6, team === "blue" ? "#1d4ed8" : "#b91c1c");
                            if (s.hp / s.maxHp < 0.6) alarm(s.x, s.y);
                        }
                        if (st.core.alive) {
                            dot(st.core.x, st.core.y, 3.6, TEAM_COLOR[team]);
                            const exposed = st.core.exposed;
                            if (exposed) {
                                ctx.strokeStyle = "#fef08a";
                                ctx.lineWidth = 1.5;
                                ctx.beginPath();
                                ctx.arc(px(st.core.x), py(st.core.y), 6.2 + Math.sin(now2 * 5.5), 0, Math.PI * 2);
                                ctx.stroke();
                            }
                            if (st.core.hp / st.core.maxHp < 0.6) alarm(st.core.x, st.core.y);
                        }
                        for (const g of snap.guardians[team]) {
                            if (!g.alive) continue;
                            dot(g.x, g.y, 2.1, team === "blue" ? "#2563eb" : "#dc2626");
                            if (g.hp / g.maxHp < 0.6) alarm(g.x, g.y);
                        }
                    }
                    if (snap.warden.alive) {
                        const wColor = snap.warden.phase === 3 ? "#fb7185" : snap.warden.phase === 2 ? "#e879f9" : "#a78bfa";
                        dot(snap.warden.x, snap.warden.y, 3.4, wColor);
                        ctx.strokeStyle = wColor;
                        ctx.lineWidth = 1.2;
                        ctx.beginPath();
                        ctx.arc(px(snap.warden.x), py(snap.warden.y), 5.3 + Math.sin(now2 * 4) * 0.6, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                    for (const m of snap.minis) {
                        if (m.alive) {
                            dot(m.x, m.y, 2.5, m.ally ? TEAM_COLOR[m.ally] : "#c084fc");
                            ctx.fillStyle = "#ffffff";
                            ctx.font = "700 6px Inter, sans-serif";
                            ctx.textAlign = "center";
                            ctx.fillText(["S", "C", "V", "R"][m.padIdx] ?? "L", px(m.x), py(m.y) - 4);
                        } else {
                            const [mx, my] = WF_PADS[m.padIdx] ?? [m.x, m.y];
                            ctx.fillStyle = "rgba(216,180,254,0.75)";
                            ctx.font = "700 6px Inter, sans-serif";
                            ctx.textAlign = "center";
                            ctx.fillText(`${Math.ceil(m.spawnSecs)}s`, px(mx), py(my) + 2);
                        }
                    }
                    for (const m of snap.mobs) dot(m.x, m.y, 1.5, m.side === "hollow" ? "#8b7bb8" : m.side === "blue" ? "#3b82f6" : "#ef4444");
                    for (const a of snap.actors) if (a.state !== "respawning") dot(a.x, a.y, 2.4, a.team === "blue" ? "#60a5fa" : "#f87171");
                    // The broadcast camera's current view window.
                    const v = camViewRef.current;
                    const halfW = (v.half / (WF_X * 2)) * cv.width;
                    const halfH = (v.half * 0.62 / (WF_Y * 2)) * cv.height;
                    ctx.strokeStyle = "rgba(255,255,255,0.75)";
                    ctx.lineWidth = 1;
                    ctx.strokeRect(px(v.x) - halfW, py(v.z) - halfH, halfW * 2, halfH * 2);
                }
            }
            requestAnimationFrame(draw);
        };
        const id = requestAnimationFrame(draw);
        return () => { live = false; cancelAnimationFrame(id); };
    }, [result, clock, bg, camViewRef]);
    return (
        <canvas
            ref={canvasRef} width={224} height={105}
            onClick={(e) => {
                // Tap the map → jump the spectator camera there (free-cam).
                const rect = e.currentTarget.getBoundingClientRect();
                const c = camCtlRef.current;
                c.mode = "free";
                c.fx = ((e.clientX - rect.left) / rect.width) * WF_X * 2 - WF_X;
                c.fz = ((e.clientY - rect.top) / rect.height) * WF_Y * 2 - WF_Y;
                onModeChange("free");
            }}
            style={{ width: 224, height: 105, borderRadius: 8, border: "1px solid rgba(148,163,184,0.5)", background: spec.voidColor, boxShadow: "0 3px 14px rgba(0,0,0,0.45)", cursor: "pointer", pointerEvents: "auto" }}
        />
    );
}

/** Sustained frame pressure sheds presentation work in two sticky steps.
 * Simulation fidelity never changes; only cameras, distant rigs and particles do.
 * Detail resets between matches instead of remounting rigs during live combat. */
function WfFrameGovernor({ value, onPressure }: { value: WarfrontAdaptivePressure; onPressure: (pressure: WarfrontAdaptivePressure) => void }) {
    const averageMs = useRef(16.7);
    const slowFor = useRef(0);
    const pressure = useRef<WarfrontAdaptivePressure>(value);
    useEffect(() => {
        pressure.current = value;
        slowFor.current = 0;
    }, [value]);
    useEffect(() => {
        if (typeof PerformanceObserver === "undefined") return;
        const recent: number[] = [];
        let observer: PerformanceObserver | null = null;
        try {
            observer = new PerformanceObserver((list) => {
                const now = performance.now();
                if (now < 5000) return; // shader/model warm-up is finite, not sustained pressure
                let emergency = false;
                for (const entry of list.getEntries()) {
                    if (entry.duration < 120) continue;
                    recent.push(now);
                    if (entry.duration >= 900) emergency = true;
                }
                while (recent.length && recent[0] < now - 8000) recent.shift();
                if (!emergency && recent.length < 2) return;
                const next = emergency ? 2 : Math.min(2, pressure.current + 1) as WarfrontAdaptivePressure;
                if (next > pressure.current) {
                    pressure.current = next;
                    recent.length = 0;
                    onPressure(next);
                }
            });
            observer.observe({ type: "longtask" });
        } catch {
            observer?.disconnect();
        }
        return () => observer?.disconnect();
    }, [onPressure]);
    useFrame((_state, delta) => {
        const dt = Math.min(0.1, Math.max(0.001, delta));
        const ms = dt * 1000;
        averageMs.current += (ms - averageMs.current) * 0.035;
        if (averageMs.current > 27) {
            slowFor.current += dt;
        } else {
            slowFor.current = Math.max(0, slowFor.current - dt * 0.5);
        }
        if (slowFor.current >= 2.5 && pressure.current < 2) {
            pressure.current = (pressure.current + 1) as WarfrontAdaptivePressure;
            slowFor.current = 0;
            onPressure(pressure.current);
        }
    });
    return null;
}

// ── HUD frame-writers (refs only, no re-render) ──────────────────────────────
function WfHudWriter({ result, clock, timerRef, coinBlueRef, coinRedRef, scoreBlueRef, scoreRedRef, killBlueRef, killRedRef, momentumRef, structsBlueRef, structsRedRef, stanceBlueRef, stanceRedRef, phaseRef, phaseClockRef, objectiveRef, wardenWrapRef, wardenHpRef, wardenStatusRef, wardenDamageRef, buffRef, campsRef, phaseOverlayRef }: {
    result: WarfrontResult; clock: WfClockRef;
    timerRef: MutableRefObject<HTMLSpanElement | null>;
    coinBlueRef: MutableRefObject<HTMLSpanElement | null>;
    coinRedRef: MutableRefObject<HTMLSpanElement | null>;
    scoreBlueRef: MutableRefObject<HTMLSpanElement | null>;
    scoreRedRef: MutableRefObject<HTMLSpanElement | null>;
    killBlueRef: MutableRefObject<HTMLSpanElement | null>;
    killRedRef: MutableRefObject<HTMLSpanElement | null>;
    momentumRef: MutableRefObject<HTMLDivElement | null>;
    structsBlueRef: MutableRefObject<HTMLSpanElement | null>;
    structsRedRef: MutableRefObject<HTMLSpanElement | null>;
    stanceBlueRef: MutableRefObject<HTMLSpanElement | null>;
    stanceRedRef: MutableRefObject<HTMLSpanElement | null>;
    phaseRef: MutableRefObject<HTMLSpanElement | null>;
    phaseClockRef: MutableRefObject<HTMLSpanElement | null>;
    objectiveRef: MutableRefObject<HTMLSpanElement | null>;
    wardenWrapRef: MutableRefObject<HTMLDivElement | null>;
    wardenHpRef: MutableRefObject<HTMLDivElement | null>;
    wardenStatusRef: MutableRefObject<HTMLSpanElement | null>;
    wardenDamageRef: MutableRefObject<HTMLSpanElement | null>;
    buffRef: MutableRefObject<HTMLSpanElement | null>;
    campsRef: MutableRefObject<HTMLSpanElement | null>;
    phaseOverlayRef: MutableRefObject<HTMLDivElement | null>;
}) {
    // Running kill tally advanced by a forward cursor — the old code recounted
    // from event zero EVERY frame (O(events) × 60fps, growing all match). Now it
    // consumes only newly-passed events; a rewind resets both.
    const evCursor = useRef(0);
    const kills = useRef<[number, number]>([0, 0]);
    const lastT = useRef(-1);
    useFrame(() => {
        const snap = snapAt(result, clock);
        const seconds = Math.floor(snap.t / WARFRONT_TPS);
        const phase = phaseAtSeconds(seconds);
        if (timerRef.current) {
            const remain = Math.max(0, WF_MAX_SECONDS - seconds);
            const mm = Math.floor(remain / 60), ss = remain % 60;
            timerRef.current.textContent = `${mm}:${ss < 10 ? "0" : ""}${ss}`;
        }
        if (phaseRef.current) {
            phaseRef.current.textContent = phase.label;
            phaseRef.current.style.color = phase.color;
        }
        if (phaseClockRef.current) {
            phaseClockRef.current.textContent = phase.id === "collapse"
                ? `JUDGMENT ${mmss(WF_MAX_SECONDS - seconds)}`
                : `NEXT ${mmss(phase.ends - seconds)}`;
        }
        const blueExposed = snap.structures.blue.core.exposed;
        const redExposed = snap.structures.red.core.exposed;
        if (objectiveRef.current) {
            objectiveRef.current.textContent = blueExposed && redExposed ? "WARD SEALS EXPOSED — END THE WAR"
                : redExposed ? "BREAK RED'S WARD SEAL"
                    : blueExposed ? "DEFEND BLUE'S WARD SEAL"
                        : phase.id === "collapse" ? "HOLLOW COLLAPSE — STRUCTURES ARE CRUMBLING"
                            : phase.id === "war" ? "CONTEST THE GATE WARDEN"
                                : phase.id === "skirmish" ? "RECRUIT LESSER WARDENS · PRESS THREE LANES"
                                    : "FARM COINS · SECURE THE LANES";
        }
        if (phaseOverlayRef.current) {
            phaseOverlayRef.current.style.opacity = phase.id === "collapse" ? "0.22" : phase.id === "war" ? "0.07" : "0";
            phaseOverlayRef.current.style.background = phase.id === "collapse"
                ? "radial-gradient(ellipse at center, transparent 35%, rgba(190,18,60,0.58) 100%)"
                : "radial-gradient(ellipse at center, transparent 55%, rgba(126,34,206,0.36) 100%)";
        }
        if (wardenWrapRef.current) wardenWrapRef.current.style.display = seconds >= WF_PHASE_SKIRMISH || snap.warden.hp < snap.warden.maxHp ? "grid" : "none";
        if (wardenHpRef.current) {
            wardenHpRef.current.style.width = `${Math.max(0, Math.min(100, snap.warden.hp / Math.max(1, snap.warden.maxHp) * 100))}%`;
            wardenHpRef.current.style.background = snap.warden.phase === 3 ? "#fb7185" : snap.warden.phase === 2 ? "#e879f9" : "#a78bfa";
        }
        if (wardenStatusRef.current) {
            wardenStatusRef.current.textContent = snap.warden.resetting ? "RESETTING · RECOVERING"
                : snap.warden.resetSecs > 0 ? `DISENGAGED · RECOVERS IN ${Math.ceil(snap.warden.resetSecs)}s`
                    : snap.warden.winding ? `SLAM ${snap.warden.windupSecs.toFixed(1)}s · R${snap.warden.slamRadius.toFixed(1)}`
                    : snap.warden.alive ? `PHASE ${["I", "II", "III"][snap.warden.phase - 1]} · ${Math.ceil(snap.warden.hp)}/${snap.warden.maxHp}`
                        : "DEFEATED";
        }
        if (wardenDamageRef.current) {
            const total = snap.warden.damage.blue + snap.warden.damage.red;
            const bluePct = total > 0 ? Math.round(snap.warden.damage.blue / total * 100) : 50;
            wardenDamageRef.current.textContent = `BLUE ${bluePct}% · ${100 - bluePct}% RED`;
        }
        if (buffRef.current) {
            const buffs: string[] = [];
            if (snap.wardenBuff.team) buffs.push(`⚡ ${snap.wardenBuff.team.toUpperCase()} GATE'S WRATH ${Math.ceil(snap.wardenBuff.secs)}s`);
            if (snap.atkBuff.blue > 0) buffs.push(`⚔ BLUE CAMP FURY ${Math.ceil(snap.atkBuff.blue)}s`);
            if (snap.atkBuff.red > 0) buffs.push(`⚔ RED CAMP FURY ${Math.ceil(snap.atkBuff.red)}s`);
            buffRef.current.textContent = buffs.join(" · ") || "⚡ Gate's Wrath unclaimed";
            buffRef.current.style.color = snap.wardenBuff.team ? TEAM_SOFT[snap.wardenBuff.team] : snap.atkBuff.blue > snap.atkBuff.red ? TEAM_SOFT.blue : snap.atkBuff.red > 0 ? TEAM_SOFT.red : "#64748b";
        }
        if (campsRef.current) {
            campsRef.current.textContent = snap.minis.map((m) => {
                const boon = MINI_BOONS[m.padIdx] ?? MINI_BOONS[0];
                if (m.alive && m.ally) return `${boon.icon} ${m.ally[0].toUpperCase()} ${Math.ceil(m.allySecs)}s`;
                if (m.alive) return `${boon.icon} READY`;
                return `${boon.icon} ${Math.ceil(m.spawnSecs)}s`;
            }).join("  ·  ");
        }
        if (coinBlueRef.current) coinBlueRef.current.textContent = String(snap.coins.blue);
        if (coinRedRef.current) coinRedRef.current.textContent = String(snap.coins.red);
        // SCORE = the actual win condition (wfVerdictScore: enemy statues +
        // core broken; the same formula the timer verdict rules on).
        const score = wfVerdictScore(snap);
        if (snap.t < lastT.current) { evCursor.current = 0; kills.current[0] = 0; kills.current[1] = 0; }   // rewound
        lastT.current = snap.t;
        const events = result.events;
        let ei = evCursor.current;
        for (; ei < events.length && events[ei].t <= snap.t; ei++) {
            const e = events[ei];
            if (e.type === "kill") kills.current[e.team === "blue" ? 0 : 1]++;
        }
        evCursor.current = ei;
        const kb = kills.current[0], kr = kills.current[1];
        if (scoreBlueRef.current) scoreBlueRef.current.textContent = String(score.blue);
        if (scoreRedRef.current) scoreRedRef.current.textContent = String(score.red);
        if (killBlueRef.current) killBlueRef.current.textContent = String(kb);
        if (killRedRef.current) killRedRef.current.textContent = String(kr);
        // Structure pips: each team's REMAINING sentinels/totems/seal — siege
        // pressure is glanceable before a point ever lands.
        if (structsBlueRef.current) {
            const s = `${snap.guardians.blue.map((g) => (g.alive ? "🛡" : "·")).join("")}${snap.structures.blue.statues.map((x) => (x.alive ? "⛩" : "·")).join("")}${snap.structures.blue.core.alive ? "🔮" : "·"}`;
            if (structsBlueRef.current.textContent !== s) structsBlueRef.current.textContent = s;
        }
        if (structsRedRef.current) {
            const s = `${snap.structures.red.core.alive ? "🔮" : "·"}${snap.structures.red.statues.map((x) => (x.alive ? "⛩" : "·")).join("")}${snap.guardians.red.map((g) => (g.alive ? "🛡" : "·")).join("")}`;
            if (structsRedRef.current.textContent !== s) structsRedRef.current.textContent = s;
        }
        // Stance chips: each team's declared formation, at a glance.
        for (const [ref, tm] of [[stanceBlueRef, "blue"], [stanceRedRef, "red"]] as const) {
            if (!ref.current) continue;
            const spec2 = WF_STANCES.find((s) => s.id === snap.stances[tm]);
            if (spec2 && ref.current.textContent !== spec2.icon) { ref.current.textContent = spec2.icon; ref.current.title = `${tm === "blue" ? "Blue" : "Red"} formation: ${spec2.label}`; }
        }
        // Momentum: structure damage dealt + points + kills + gold, squashed to
        // a 0..100% fill — the one-glance "who is winning" broadcast bar.
        if (momentumRef.current) {
            const dmgTo = (tm: Team) => {
                const st2 = snap.structures[tm];
                let d = st2.statues.reduce((a, s) => a + (s.maxHp - Math.max(0, s.hp)), 0) + (st2.core.maxHp - Math.max(0, st2.core.hp));
                for (const g of snap.guardians[tm]) d += (g.maxHp - Math.max(0, g.hp)) * 0.6;
                return d;
            };
            const lead = (dmgTo("red") - dmgTo("blue")) + (score.blue - score.red) * 900 + (kb - kr) * 220 + (snap.coins.blue - snap.coins.red) * 0.25;
            const pct = 50 + Math.max(-46, Math.min(46, lead / 60));
            momentumRef.current.style.width = `${pct}%`;
        }
    });
    return null;
}

// ── The match shell ──────────────────────────────────────────────────────────
type WfCouncilBuyState = Array<{
    petId: string;
    petName: string;
    stacks: Record<(typeof WF_POWERUPS)[number]["kind"], number>;
    costs: Record<(typeof WF_POWERUPS)[number]["kind"], number>;
}>;

function WfWarCouncil({
    round,
    buyState,
    coins,
    initialStance,
    onResume,
}: {
    round: number;
    buyState: WfCouncilBuyState;
    coins: number;
    initialStance: WfStance;
    onResume: (choices: WarfrontChoice[], stance: WfStance) => void;
}) {
    const [cart, setCart] = useState<WarfrontChoice[]>([]);
    const [councilStance, setCouncilStance] = useState<WfStance>(initialStance);
    const [councilLeft, setCouncilLeft] = useState(15);
    const cartRef = useRef(cart);
    const stanceRef = useRef(councilStance);
    const resumeRef = useRef(onResume);
    useEffect(() => {
        cartRef.current = cart;
        stanceRef.current = councilStance;
        resumeRef.current = onResume;
    }, [cart, councilStance, onResume]);

    // The countdown belongs to this lightweight overlay. Keeping it here avoids
    // reconciling the entire 3D scene once per second while the battle is paused.
    useEffect(() => {
        const id = window.setTimeout(() => {
            if (councilLeft <= 1) resumeRef.current(cartRef.current, stanceRef.current);
            else setCouncilLeft((seconds) => seconds - 1);
        }, 1000);
        return () => window.clearTimeout(id);
    }, [councilLeft]);

    const planCouncilCart = (policy: Exclude<WfBuyPolicy, "off">) => {
        const priorities = {
            balanced: ["strike", "vitality", "guard", "swift", "mend"],
            offense: ["strike", "swift", "vitality", "strike", "guard"],
            defense: ["guard", "vitality", "mend", "swift", "strike"],
        } as const;
        const stacks = buyState.map((pet) => ({ ...pet.stacks }));
        const added = buyState.map(() => new Map<string, number>());
        const planned: WarfrontChoice[] = [];
        let remaining = coins;
        for (let guard = 0; guard < 40; guard++) {
            const order = buyState.map((_, index) => index).sort((a, b) => {
                const total = (petIndex: number) => Object.values(stacks[petIndex]).reduce((sum, value) => sum + value, 0);
                return total(a) - total(b) || a - b;
            });
            let bought = false;
            for (const petIndex of order) {
                for (const kind of priorities[policy]) {
                    if (stacks[petIndex][kind] >= WF_STACK_CAP) continue;
                    const extra = added[petIndex].get(kind) ?? 0;
                    let price = buyState[petIndex].costs[kind];
                    for (let i = 0; i < extra; i++) price = Math.round(price * 1.35 / 5) * 5;
                    if (remaining < price) continue;
                    planned.push({ petIndex, kind });
                    stacks[petIndex][kind]++;
                    added[petIndex].set(kind, extra + 1);
                    remaining -= price;
                    bought = true;
                    break;
                }
                if (bought) break;
            }
            if (!bought) break;
        }
        setCart(planned);
    };

    const cartCost = useMemo(() => {
        const counts = new Map<string, number>();
        let total = 0;
        for (const choice of cart) {
            const pet = buyState[choice.petIndex];
            if (!pet) continue;
            const key = `${choice.petIndex}:${choice.kind}`;
            const extra = counts.get(key) ?? 0;
            let price = pet.costs[choice.kind];
            for (let i = 0; i < extra; i++) price = Math.round(price * 1.35 / 5) * 5;
            total += price;
            counts.set(key, extra + 1);
        }
        return total;
    }, [buyState, cart]);
    const coinsAvail = coins - cartCost;
    const btn: CSSProperties = { padding: "5px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", cursor: "pointer", font: "700 12px Inter, system-ui, sans-serif" };

    return (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,7,18,0.6)", zIndex: 60 }}>
            <div style={{ width: "min(860px, 96vw)", maxHeight: "86vh", overflowY: "auto", background: "rgba(10,14,28,0.97)", border: "1px solid rgba(168,85,247,0.5)", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <div style={{ color: "#d8b4fe", font: "900 16px Inter, system-ui, sans-serif" }}>📯 War Council — round {round}</div>
                    <div style={{ color: "#fde047", font: "800 14px Inter, system-ui, sans-serif" }}>🪙 {coinsAvail}</div>
                </div>
                <div style={{ color: "#94a3b8", font: "600 11px Inter, system-ui, sans-serif", marginBottom: 10 }}>Spend the squad&apos;s coins on small edges — the council convenes every 90s of battle. Resuming in {councilLeft}s.</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 4px 10px", borderBottom: "1px solid rgba(51,65,85,0.6)", marginBottom: 6 }}>
                    <div style={{ color: "#e2e8f0", font: "800 12px Inter, system-ui, sans-serif", minWidth: 110 }}>📜 War Order</div>
                    {WF_STANCES.map((stance) => (
                        <button
                            key={stance.id}
                            onClick={() => setCouncilStance(stance.id)}
                            title={stance.desc}
                            style={{ display: "grid", gap: 1, minWidth: 118, textAlign: "left", padding: "5px 8px", borderRadius: 8, border: `1px solid ${councilStance === stance.id ? "#6ee7b7" : "#334155"}`, background: councilStance === stance.id ? "rgba(16,185,129,0.16)" : "#111827", color: councilStance === stance.id ? "#d1fae5" : "#94a3b8", cursor: "pointer", font: "700 11px Inter, system-ui, sans-serif" }}
                        >
                            <span>{stance.icon} {stance.label}</span>
                            <span style={{ font: "600 9px Inter, system-ui, sans-serif", color: councilStance === stance.id ? "#a7f3d0" : "#64748b" }}>{stance.desc}</span>
                        </button>
                    ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 4px 10px" }}>
                    <div style={{ color: "#e2e8f0", font: "800 12px Inter, system-ui, sans-serif", minWidth: 110 }}>⚒ Quick Build</div>
                    {([
                        ["balanced", "⚖ Balanced", "Spread useful upgrades across the squad"],
                        ["offense", "🗡 Assault", "Prioritize attack, speed and pressure"],
                        ["defense", "🛡 Fortress", "Prioritize durability, healing and staying power"],
                    ] as const).map(([id, label, tip]) => (
                        <button key={id} onClick={() => planCouncilCart(id)} title={tip} style={{ ...btn, padding: "5px 9px", background: "rgba(30,41,59,0.8)" }}>{label}</button>
                    ))}
                    <button onClick={() => setCart([])} style={{ ...btn, padding: "5px 9px", color: "#94a3b8" }}>Clear</button>
                    <span style={{ color: "#64748b", font: "700 10px Inter, system-ui, sans-serif" }}>One click fills an affordable, deterministic squad build. Fine-tune below.</span>
                </div>
                {buyState.map((pet, petIndex) => (
                    <div key={pet.petId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderTop: "1px solid rgba(51,65,85,0.6)", flexWrap: "wrap" }}>
                        <div style={{ minWidth: 110, color: "#e2e8f0", font: "700 12px Inter, system-ui, sans-serif" }}>{pet.petName}</div>
                        {WF_POWERUPS.map((powerup) => {
                            const inCart = cart.filter((choice) => choice.petIndex === petIndex && choice.kind === powerup.kind).length;
                            const stacks = pet.stacks[powerup.kind] + inCart;
                            let price = pet.costs[powerup.kind];
                            for (let i = 0; i < inCart; i++) price = Math.round(price * 1.35 / 5) * 5;
                            const capped = stacks >= WF_STACK_CAP;
                            const afford = coinsAvail >= price;
                            return (
                                <button
                                    key={powerup.kind}
                                    disabled={capped || !afford}
                                    onClick={() => setCart((current) => [...current, { petIndex, kind: powerup.kind }])}
                                    style={{ display: "grid", gap: 1, minWidth: 108, textAlign: "left", padding: "5px 8px", borderRadius: 8, border: `1px solid ${capped ? "#334155" : afford ? "#7c3aed" : "#334155"}`, background: capped ? "#111827" : afford ? "rgba(124,58,237,0.18)" : "#111827", color: capped ? "#475569" : afford ? "#e9d5ff" : "#64748b", cursor: capped || !afford ? "default" : "pointer", font: "700 11px Inter, system-ui, sans-serif" }}
                                >
                                    <span>{powerup.icon} {powerup.label}</span>
                                    <span style={{ font: "600 10px Inter, system-ui, sans-serif", color: capped ? "#475569" : "#a5b4fc" }}>{powerup.desc}</span>
                                    <span style={{ font: "700 10px Inter, system-ui, sans-serif", color: capped ? "#64748b" : "#fde047" }}>{stacks}/{WF_STACK_CAP} owned · {capped ? "MAX" : `🪙${price}`}{inCart > 0 ? ` · +${inCart} in cart` : ""}</span>
                                </button>
                            );
                        })}
                    </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, gap: 8 }}>
                    <button onClick={() => setCart([])} style={{ ...btn, opacity: cart.length ? 1 : 0.5 }}>Clear ({cart.length})</button>
                    <button onClick={() => onResume(cart, councilStance)} style={{ ...btn, background: "#6d28d9", border: "1px solid #a78bfa" }}>⚔ Resume battle ({councilLeft}s)</button>
                </div>
            </div>
        </div>
    );
}

export type PetWarfrontMatchProps = {
    blue: ArenaSlot[]; red: ArenaSlot[]; seed: number;
    theme?: WfTheme;
    /** "off" (default) = interactive War Council at each 90 s round. Any policy = silent
     * auto-buy (the shape co-op replays share). */
    autoBuy?: WfBuyPolicy;
    /** Opening formation/strategy — the player's pre-match pick. Adjustable at
     * every War Council when the council is interactive. */
    stance?: WfStance;
    doctrine?: WfDoctrine;
    /** The OPPONENT's formation/doctrine. Needed whenever this component is
     *  replaying a match someone else resolved (a ranked ladder defense fights
     *  with its own setup) — leaving them at the defaults would replay a
     *  different fight than the one that was scored. */
    opponentStance?: WfStance;
    opponentDoctrine?: WfDoctrine;
    /** Enables the 🎲 New-match button (vs-AI / harness). Leave off for shared
     * co-op/PvP replays, where both clients must stay on the agreed seed. */
    allowReseed?: boolean;
    /** Dev/QA playback multiplier. Production callers should keep the default. */
    playbackRate?: number;
    onExit: () => void;
    onResult?: (result: WarfrontResult) => void;
};

export function PetWarfrontMatch({ blue, red, seed, theme = "central", autoBuy = "off", opponentStance = "balanced", opponentDoctrine = "vanguard", stance = "balanced", doctrine = "none", allowReseed = false, playbackRate = 1, onExit, onResult }: PetWarfrontMatchProps) {
    const safePlaybackRate = Number.isFinite(playbackRate) ? Math.max(0.1, Math.min(30, playbackRate)) : 1;
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
        const c = startWarfrontMatch(blue, red, effectiveSeed, { bluePolicy: autoBuy, redPolicy: "balanced", theme, blueStance: stance, blueDoctrine: doctrine, redStance: opponentStance, redDoctrine: opponentDoctrine });
        c.advanceRoundPartial(WARFRONT_TPS);   // seed one second; the frame pump streams the rest
        return c;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `run` intentionally forces a fresh sim (Restart)
    }, [blue, red, effectiveSeed, autoBuy, theme, stance, doctrine, opponentStance, opponentDoctrine, run]);
    const result = ctl.result;
    const clock = useRef<WfClockState>({ t: 0, playing: true, slow: 0, rate: safePlaybackRate });
    const shake = useRef(0);
    const camView = useRef<{ x: number; z: number; half: number }>({ x: 0, z: 0, half: 12 });
    const camCtl = useRef<WfCamCtl>({ mode: "follow", fx: 0, fz: 0, dist: 18 });
    const [freeCam, setFreeCam] = useState(false);
    const [sfxMuted, setSfxMuted] = useState(() => isPetSfxMuted());
    // Spectator camera mode — persisted per device; drag still enters free-cam.
    const [camMode, setCamModeState] = useState<WfCamMode>(() => {
        try {
            const v = localStorage.getItem("wfCamMode.v1");
            return v === "calm" || v === "team" ? v : "broadcast";
        } catch { return "broadcast"; }
    });
    const camModeRef = useRef<WfCamMode>("broadcast");
    useEffect(() => { camModeRef.current = camMode; });
    const setCamMode = (m: WfCamMode) => {
        setCamModeState(m);
        try { localStorage.setItem("wfCamMode.v1", m); } catch { /* storage disabled — ignore */ }
    };
    const [ended, setEnded] = useState(false);
    const [assetsReady, setAssetsReady] = useState(false);
    const [flash, setFlash] = useState<{ id: number; color: string } | null>(null);
    const [banner, setBanner] = useState<{ id: number; text: string; color: string; big: boolean } | null>(null);
    const [feed, setFeed] = useState<Array<{ id: number; text: string; color: string }>>([]);
    const [fxList, setFxList] = useState<WfFxItem[]>([]);
    const [shots, setShots] = useState<WfShotItem[]>([]);
    const [floaters, setFloaters] = useState<WfFloatItem[]>([]);
    const [council, setCouncil] = useState<{ round: number } | null>(null);
    const timerRef = useRef<HTMLSpanElement>(null);
    const coinBlueRef = useRef<HTMLSpanElement>(null);
    const coinRedRef = useRef<HTMLSpanElement>(null);
    const scoreBlueRef = useRef<HTMLSpanElement>(null);
    const scoreRedRef = useRef<HTMLSpanElement>(null);
    const killBlueRef = useRef<HTMLSpanElement>(null);
    const killRedRef = useRef<HTMLSpanElement>(null);
    const momentumRef = useRef<HTMLDivElement>(null);
    const structsBlueRef = useRef<HTMLSpanElement>(null);
    const structsRedRef = useRef<HTMLSpanElement>(null);
    const stanceBlueRef = useRef<HTMLSpanElement>(null);
    const stanceRedRef = useRef<HTMLSpanElement>(null);
    const phaseRef = useRef<HTMLSpanElement>(null);
    const phaseClockRef = useRef<HTMLSpanElement>(null);
    const objectiveRef = useRef<HTMLSpanElement>(null);
    const wardenWrapRef = useRef<HTMLDivElement>(null);
    const wardenHpRef = useRef<HTMLDivElement>(null);
    const wardenStatusRef = useRef<HTMLSpanElement>(null);
    const wardenDamageRef = useRef<HTMLSpanElement>(null);
    const buffRef = useRef<HTMLSpanElement>(null);
    const campsRef = useRef<HTMLSpanElement>(null);
    const phaseOverlayRef = useRef<HTMLDivElement>(null);
    const storyCam = useRef<WfStoryCam | null>(null);
    // MULTI-CAM WALL: one mini chase-screen per pet on YOUR team; clicking a
    // tile features that pet on the main screen (click again → broadcast).
    const [focusPetId, setFocusPetId] = useState<string | null>(null);
    // Opening VS card — a 4-second studio title before the action reads.
    const [intro, setIntro] = useState(true);
    useEffect(() => {
        if (!intro) return;
        const id = window.setTimeout(() => setIntro(false), 4200);
        return () => window.clearTimeout(id);
    }, [intro]);
    const focusPetRef = useRef<string | null>(null);
    useEffect(() => { focusPetRef.current = focusPetId; });
    const tileStatusRefs = useRef<Array<HTMLSpanElement | null>>([]);
    const tileHpRefs = useRef<Array<HTMLDivElement | null>>([]);
    const tileBoxRefs = useRef<Array<HTMLDivElement | null>>([]);
    const myPets = useMemo(
        () => result.snapshots[0].actors.filter((a) => a.team === "blue").map((a) => ({ id: a.id, name: roster.find((r) => r.id === a.id)?.pet.name ?? a.id })),
        [result, roster],
    );
    const myPetIds = useMemo(() => myPets.map((m) => m.id), [myPets]);
    const multiCamOn = presentationBudget.squadCameras && myPetIds.length > 0;
    const tileW = Math.round(Math.min(180, Math.max(84, ((typeof window !== "undefined" ? window.innerWidth : 1200) - 20 - 3 * 8) / 4)));
    const tileH = Math.round(tileW * 0.6);

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

    const pushFeed = (text: string, color: string) => {
        const id = wfSeq++;
        setFeed((arr) => [{ id, text, color }, ...arr].slice(0, 6));
        window.setTimeout(() => setFeed((arr) => arr.filter((f) => f.id !== id)), 4500);
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
        window.setTimeout(pumpBanner, next.big ? 2300 : 1600);
    };
    const pushBanner = (text: string, color: string, big = false) => {
        if (bannerQueue.current.length >= 3) bannerQueue.current.shift();   // drop the stalest
        bannerQueue.current.push({ id: wfSeq++, text, color, big });
        if (!bannerBusy.current) pumpBanner();
    };
    const triggerFlash = (color: string) => {
        const id = wfSeq++;
        setFlash({ id, color });
        window.setTimeout(() => setFlash((f) => (f && f.id === id ? null : f)), 380);
    };
    const spawnFx = (x: number, z: number, key: string | null, element: string | null | undefined, scale: number, dur: number) => {
        const frames = (key ? bundledJutsuFxFrames(key) : null) ?? bundledJutsuFxFrames(elementVfxKey(element)) ?? bundledJutsuFxFrames("none");
        if (!frames) return;
        const id = wfSeq++;
        setFxList((arr) => {
            const next = [...arr, { id, frames, pos: [x, 0.8, z] as Vec3, scale, dur }];
            return next.length > 24 ? next.slice(next.length - 24) : next;   // fight-spam cap
        });
    };
    const spawnShot = (fromX: number, fromY: number, toX: number, toY: number, element: string | null | undefined, charged: boolean) => {
        const visual = projectileVisual({ element, charged });
        const dist = Math.hypot(toX - fromX, toY - fromY);
        const dur = Math.min(820, Math.max(420, 260 + dist * 24));
        const id = wfSeq++;
        setShots((arr) => {
            const next = [...arr, { id, from: [fromX, 0.9, fromY] as Vec3, to: [toX, 0.9, toY] as Vec3, visual, dur, arc: 0.28 }];
            return next.length > 16 ? next.slice(next.length - 16) : next;   // fight-spam cap
        });
    };
    const spawnFloater = (x: number, z: number, text: string, color: string, big: boolean) => {
        const id = wfSeq++;
        setFloaters((arr) => {
            const next = [...arr, { id, pos: [x, 1.5, z] as Vec3, text, color, big }];
            return next.length > 12 ? next.slice(next.length - 12) : next;
        });
        window.setTimeout(() => setFloaters((arr) => arr.filter((f) => f.id !== id)), 800);
    };

    // Round boundary: interactive → pause + open the War Council; auto → advance.
    // "Latest ref" pattern: the ticker calls through the ref; the effect (not
    // render) keeps the closure fresh, which is compiler-safe.
    const boundaryBusy = useRef(false);
    const onFrontier = useRef<() => void>(() => {});
    // Council choices waiting to be applied to the STREAMED round.
    const pendingResume = useRef<{ choices: WarfrontChoice[]; stance?: WfStance } | null>(null);
    const pumpSim = useRef<() => void>(() => {});
    useEffect(() => {
        pumpSim.current = () => {
            if (ctl.done) return;
            const runway = result.snapshots.length - 1 - wfClockTick(clock);
            if (runway > WARFRONT_TPS * 6) return;
            // Refill frequently in tiny slices. This keeps the same deterministic
            // runway without a periodic CPU burst interrupting skeletal motion.
            const chunk = adaptivePressure === 0 ? 8 : adaptivePressure === 1 ? 6 : 4;
            if (autoBuy !== "off") { ctl.advanceRoundPartial(chunk); return; }
            const pend = pendingResume.current;
            if (pend) {
                if (ctl.advanceRoundPartial(chunk, pend.choices, pend.stance)) pendingResume.current = null;
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
            if (autoBuy === "off") {
                clock.current.playing = false;
                setCouncil({ round: ctl.round });
            } else {
                ctl.advanceRound();
                clock.current.playing = true;
                boundaryBusy.current = false;
            }
        };
    });
    const resumeFromCouncil = (choices: WarfrontChoice[], stancePick?: WfStance) => {
        setCouncil(null);
        // Streamed, not synchronous — the pump applies these on its next call.
        pendingResume.current = { choices, stance: stancePick };
        clock.current.playing = true;
        boundaryBusy.current = false;
    };

    useEffect(() => { if (ended) onResult?.(result); }, [ended]);   // eslint-disable-line react-hooks/exhaustive-deps -- fire once on the end edge

    // Preload EVERY rig the match will mount — roster, hounds, the four camp
    // bosses and both sentinel bodies. Camp bosses used to lazy-load at their
    // 90 s spawn and drop a frame spike mid-match.
    useEffect(() => {
        let cancelled = false;
        let releaseTimer = 0;
        let timeoutTimer = 0;
        const started = performance.now();
        const timeout = new Promise<void>((resolve) => {
            timeoutTimer = window.setTimeout(resolve, 4500);
        });
        const preload = import("../lib/pet-model-preload")
            .then((m) => m.preloadPetColiseumModels([
                ...roster.map((r) => r.pet),
                ...[HOLLOW_BEAST_ID, "legendary-2", "legendary-6", "legendary-10", "legendary-14", "mythic-0", "mythic-2"].map((id) => ({ id } as Pet)),
            ]))
            .catch(() => { /* fallbacks keep the match playable */ });
        void Promise.race([preload, timeout]).then(() => {
            if (cancelled) return;
            const remaining = Math.max(0, 650 - (performance.now() - started));
            releaseTimer = window.setTimeout(() => {
                if (!cancelled) setAssetsReady(true);
            }, remaining);
        });
        return () => {
            cancelled = true;
            window.clearTimeout(releaseTimer);
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
    const winLabel = result.winner === "draw" ? "Stalemate"
        : sealBroken ? `${result.winner === "blue" ? "Blue" : "Red"} Shatters the Ward Seal`
        : `${result.winner === "blue" ? "Blue" : "Red"} Wins the Judgment`;

    // ⟲/↻/🎲 controls: Replay rewinds the clock (the director re-fires events
    // and later councils reopen on schedule); Restart rebuilds the sim on the
    // SAME seed; New match rolls a fresh deterministic seed (vs-AI/harness only).
    const resetTransient = () => {
        clock.current = { t: 0, playing: true, slow: 0, rate: safePlaybackRate };
        storyCam.current = null;
        setFocusPetId(null);
        setIntro(true);
        setAdaptivePressure(0);
        pendingResume.current = null;
        shake.current = 0;
        boundaryBusy.current = false;
        setEnded(false);
        setCouncil(null);
        setFeed([]);
        bannerQueue.current = [];
        bannerBusy.current = false;
        setBanner(null);
        setFlash(null);
        setFxList([]);
        setShots([]);
        setFloaters([]);
    };
    const doReplay = () => resetTransient();
    const doRestart = () => { setRun((r) => r + 1); resetTransient(); };
    const doNewMatch = () => { setSeedBump((b) => b + 1); setRun((r) => r + 1); resetTransient(); };

    const btn: CSSProperties = { padding: "5px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", cursor: "pointer", font: "700 12px Inter, system-ui, sans-serif" };

    return createPortal((
        <div style={{ position: "fixed", inset: 0, zIndex: 200, width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#05060a" }}>
            <style>{`@keyframes arenaFloat{0%{transform:translateY(4px);opacity:0}15%{opacity:1}100%{transform:translateY(-30px);opacity:0}}@keyframes wfLoad{from{transform:translateX(-10%);opacity:.55}to{transform:translateX(120%);opacity:1}}@keyframes wfFeedIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}@keyframes wfFlash{0%{opacity:0}12%{opacity:0.85}100%{opacity:0}}@keyframes wfBanner{0%{opacity:0;transform:translate(-50%,-50%) scale(0.72)}12%{opacity:1;transform:translate(-50%,-50%) scale(1.05)}22%{transform:translate(-50%,-50%) scale(1)}84%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-56%) scale(1)}}@keyframes wfShine{0%{transform:translateX(-140%) skewX(-18deg)}60%,100%{transform:translateX(260%) skewX(-18deg)}}@keyframes wfTilePulse{0%,100%{box-shadow:0 0 6px rgba(251,113,133,0.35)}50%{box-shadow:0 0 20px rgba(251,113,133,0.95)}}@keyframes wfIntro{0%{opacity:0;transform:scale(0.94)}10%{opacity:1;transform:scale(1)}82%{opacity:1}100%{opacity:0;transform:scale(1.02)}}@keyframes wfEndIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}`}</style>
            <div style={{ position: "absolute", inset: 0 }}>
                <Canvas dpr={canvasDpr} shadows={quality.id === "high" && adaptivePressure === 0 ? "percentage" : false} camera={{ fov: A3D_FOV, near: 0.5, far: 160, position: [0, 20, 24] }} gl={{ antialias: true }}>
                    <color attach="background" args={[spec.voidColor]} />
                    <fog attach="fog" args={[spec.fogColor, 26, 64]} />
                    {/* Warm key + cool fill: the warm/cool contrast that makes
                        painted environments read as LIT instead of flat. */}
                    <hemisphereLight args={[spec.skyLight, spec.groundLight, 1.15]} />
                    <directionalLight position={[-12, 10, -9]} intensity={0.5} color="#7ea8c4" />
                    {quality.dynamicPetLight && adaptivePressure === 0 && <pointLight position={[0, 2.6, 0]} color={spec.breachGlow} intensity={3.4} distance={18} decay={2} />}
                    <directionalLight
                        position={[10, 17, 7]} intensity={1.85} color={spec.sunColor} castShadow={quality.modelShadows && adaptivePressure === 0}
                        shadow-mapSize-width={quality.id === "high" ? 2048 : 1024} shadow-mapSize-height={quality.id === "high" ? 2048 : 1024}
                        shadow-camera-left={-24} shadow-camera-right={24} shadow-camera-top={15} shadow-camera-bottom={-15} shadow-camera-far={60}
                    />
                    <WfFloor theme={theme} />
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
                            <WfCore result={result} clock={clock} team={team} />
                        </group>
                    ))}
                    <WfWarden result={result} clock={clock} />
                    {WF_PADS.map((_, i) => (
                        <WfMini key={i} result={result} clock={clock} idx={i} name={WF_MINI_NAMES[i]} glow={spec.breachGlow} />
                    ))}
                    {fxList.map((fx) => (
                        <Fx3D key={fx.id} frames={fx.frames} pos={fx.pos} scale={fx.scale} durationMs={fx.dur} onDone={() => setFxList((p) => p.filter((x) => x.id !== fx.id))} />
                    ))}
                    {shots.map((sh) => (
                        <Shot3D key={sh.id} from={sh.from} to={sh.to} visual={sh.visual} durationMs={sh.dur} arc={sh.arc} onDone={() => setShots((p) => p.filter((x) => x.id !== sh.id))} />
                    ))}
                    {floaters.map((f) => (<Floater3D key={f.id} pos={f.pos} text={f.text} color={f.color} big={f.big} />))}
                    <Sparkles count={adaptivePressure === 0 ? Math.max(12, quality.ambientParticles) : adaptivePressure === 1 ? 10 : 5} scale={[42, 7, 21]} position={[0, 3, 0]} size={2} speed={0.14} opacity={0.24} color={spec.sunColor} noise={2} />
                    <WfCameraRig result={result} clock={clock} shake={shake} camViewRef={camView} camCtlRef={camCtl} storyRef={storyCam} modeRef={camModeRef} focusPetRef={focusPetRef} />
                    <WfCameraControls camCtlRef={camCtl} onModeChange={(m) => setFreeCam(m === "free")} />
                    <WfTicker result={result} clockRef={clock} shakeRef={shake} onFrontier={onFrontier} pumpRef={pumpSim} playbackRate={safePlaybackRate} />
                    <WfFrameGovernor value={adaptivePressure} onPressure={setAdaptivePressure} />
                    <WfDirector result={result} clockRef={clock} nameOf={nameOf} pushFeed={pushFeed} pushBanner={pushBanner} triggerFlash={triggerFlash} shakeRef={shake} spawnFx={spawnFx} spawnShot={spawnShot} spawnFloater={spawnFloater} storyRef={storyCam} camViewRef={camView} onEnd={() => setEnded(true)} />
                    <WfHudWriter result={result} clock={clock} timerRef={timerRef} coinBlueRef={coinBlueRef} coinRedRef={coinRedRef} scoreBlueRef={scoreBlueRef} scoreRedRef={scoreRedRef} killBlueRef={killBlueRef} killRedRef={killRedRef} momentumRef={momentumRef} structsBlueRef={structsBlueRef} structsRedRef={structsRedRef} stanceBlueRef={stanceBlueRef} stanceRedRef={stanceRedRef} phaseRef={phaseRef} phaseClockRef={phaseClockRef} objectiveRef={objectiveRef} wardenWrapRef={wardenWrapRef} wardenHpRef={wardenHpRef} wardenStatusRef={wardenStatusRef} wardenDamageRef={wardenDamageRef} buffRef={buffRef} campsRef={campsRef} phaseOverlayRef={phaseOverlayRef} />
                    {multiCamOn && (
                        <WfMultiCam
                            result={result}
                            clock={clock}
                            petIds={myPetIds}
                            tileW={tileW}
                            tileH={tileH}
                            margin={10}
                            gap={8}
                            renderEvery={presentationBudget.squadCameraRenderEvery}
                            statusRefs={tileStatusRefs}
                            hpRefs={tileHpRefs}
                            tileRefs={tileBoxRefs}
                            selectedRef={focusPetRef}
                            camViewRef={camView}
                        />
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
                        <div style={{ color: "#d8b4fe", font: "900 13px Inter, system-ui, sans-serif", letterSpacing: 3 }}>PREPARING WARFRONT</div>
                        <div style={{ height: 4, marginTop: 12, overflow: "hidden", borderRadius: 999, background: "#1e1b2e" }}>
                            <div style={{ width: "48%", height: "100%", borderRadius: 999, background: "linear-gradient(90deg,#7c3aed,#e879f9)", animation: "wfLoad 1.1s ease-in-out infinite alternate" }} />
                        </div>
                        <div style={{ marginTop: 9, color: "#94a3b8", font: "600 11px Inter, system-ui, sans-serif" }}>Warming rigs, materials, and the Gate Warden</div>
                    </div>
                </div>
            )}

            {/* Opening VS card — team lineups + declared formations. */}
            {intro && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "radial-gradient(ellipse at center, rgba(3,6,14,0.55) 30%, rgba(3,6,14,0.9) 100%)", zIndex: 58, pointerEvents: "none", animation: "wfIntro 4.2s ease-in-out forwards" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ color: "#d8b4fe", font: "900 15px Inter, system-ui, sans-serif", letterSpacing: 6 }}>HOLLOW WARFRONT</div>
                        <div style={{ color: "#64748b", font: "700 11px Inter, system-ui, sans-serif", letterSpacing: 2, marginTop: 2 }}>{spec.label.toUpperCase()} · BREAK THE WARD SEAL</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 18 }}>
                            <div style={{ textAlign: "right" }}>
                                {result.snapshots[0].actors.filter((a) => a.team === "blue").map((a) => (
                                    <div key={a.id} style={{ color: "#93c5fd", font: "800 15px Inter, system-ui, sans-serif", textShadow: "0 2px 8px #000" }}>{roster.find((r) => r.id === a.id)?.pet.name ?? a.id} <span style={{ color: "#475569", fontSize: 10 }}>{ROLE_TAG[a.role] ?? ""}</span></div>
                                ))}
                                <div style={{ color: "#60a5fa", font: "700 11px Inter, system-ui, sans-serif", marginTop: 6 }}>{WF_STANCES.find((st2) => st2.id === result.snapshots[0].stances.blue)?.icon} {WF_STANCES.find((st2) => st2.id === result.snapshots[0].stances.blue)?.label}</div>
                            </div>
                            <div style={{ color: "#fde047", font: "900 34px Inter, system-ui, sans-serif", textShadow: "0 0 24px rgba(250,204,21,0.5)" }}>VS</div>
                            <div style={{ textAlign: "left" }}>
                                {result.snapshots[0].actors.filter((a) => a.team === "red").map((a) => (
                                    <div key={a.id} style={{ color: "#fca5a5", font: "800 15px Inter, system-ui, sans-serif", textShadow: "0 2px 8px #000" }}><span style={{ color: "#475569", fontSize: 10 }}>{ROLE_TAG[a.role] ?? ""}</span> {roster.find((r) => r.id === a.id)?.pet.name ?? a.id}</div>
                                ))}
                                <div style={{ color: "#f87171", font: "700 11px Inter, system-ui, sans-serif", marginTop: 6 }}>{WF_STANCES.find((st2) => st2.id === result.snapshots[0].stances.red)?.icon} {WF_STANCES.find((st2) => st2.id === result.snapshots[0].stances.red)?.label}</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            <div ref={phaseOverlayRef} style={{ position: "absolute", inset: 0, opacity: 0, pointerEvents: "none", transition: "opacity 1.2s ease" }} />
            {/* Broadcast vignette — pulls the eye to the action and hides the
                hard viewport edge; pure CSS, zero render cost. */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 54%, rgba(2,4,10,0.42) 100%)" }} />
            {flash && <div key={flash.id} style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, transparent 38%, ${flash.color} 100%)`, pointerEvents: "none", animation: "wfFlash 0.4s ease-out forwards", mixBlendMode: "screen" }} />}
            {/* Broadcast ribbon banner: dark gradient bar, team-color hairlines,
                a shine sweep, queued display (big moments sit higher + longer). */}
            {banner && (
                <div key={banner.id} style={{ position: "absolute", top: banner.big ? "26%" : "16%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none", animation: `wfBanner ${banner.big ? 2.3 : 1.6}s cubic-bezier(.2,.8,.2,1) forwards`, maxWidth: "96vw" }}>
                    <div style={{ position: "relative", overflow: "hidden", padding: banner.big ? "12px 58px" : "7px 38px", background: "linear-gradient(90deg, transparent 0%, rgba(6,9,20,0.92) 13%, rgba(6,9,20,0.92) 87%, transparent 100%)" }}>
                        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, background: `linear-gradient(90deg, transparent, ${banner.color}, transparent)` }} />
                        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, background: `linear-gradient(90deg, transparent, ${banner.color}, transparent)` }} />
                        <div style={{ color: banner.color, font: `900 ${banner.big ? 40 : 24}px Inter, system-ui, sans-serif`, letterSpacing: banner.big ? 3 : 2, textShadow: "0 2px 18px #000, 0 0 30px currentColor", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}>{banner.text}</div>
                        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "38%", background: "linear-gradient(105deg, transparent, rgba(255,255,255,0.16), transparent)", animation: "wfShine 1.25s ease-out forwards" }} />
                    </div>
                </div>
            )}

            {/* Top bar: exit · replay/restart · timer · coins · mode badge */}
            <div style={{ position: "absolute", top: 10, left: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={onExit} style={btn}>✕ Exit</button>
                <button onClick={doReplay} style={btn} title="Rewatch this match from the start">⟲ Replay</button>
                <button onClick={doRestart} style={btn} title="Fresh match, same seed">↻ Restart</button>
                {allowReseed && <button onClick={doNewMatch} style={btn} title="Fresh match, new seed">🎲 New match</button>}
                <button
                    onClick={() => {
                        const next = !sfxMuted;
                        setSfxMuted(next);
                        setPetSfxMuted(next);
                        if (!next) { primePetSfx(); playPetSfx("buff"); }
                    }}
                    style={btn}
                    title={sfxMuted ? "Enable objective and combat cues" : "Mute Warfront cues"}
                    aria-label={sfxMuted ? "Enable Warfront sound" : "Mute Warfront sound"}
                >{sfxMuted ? "🔇" : "🔊"}</button>
            </div>
            {/* SCORE STRIP — the win condition at a glance: ⛩ points (statues +
                seal broken, the exact timer-verdict formula), kills, coins, and
                the momentum bar underneath. */}
            <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "grid", gap: 4, justifyItems: "center", padding: "6px 16px 7px", background: "rgba(8,12,24,0.82)", border: "1px solid rgba(148,163,184,0.4)", borderRadius: 14, font: "800 14px Inter, system-ui, sans-serif" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, whiteSpace: "nowrap" }}>
                    <span ref={stanceBlueRef} style={{ fontSize: 13 }} />
                    <span style={{ color: "#93c5fd" }} title="Structures broken (statues + Ward Seal) — how this mode is won">⛩ <span ref={scoreBlueRef}>0</span></span>
                    <span style={{ color: "#93c5fd", fontSize: 12 }} title="Kills">⚔ <span ref={killBlueRef}>0</span></span>
                    <span style={{ color: "#60a5fa", fontSize: 12 }}>🪙 <span ref={coinBlueRef}>0</span></span>
                    <span ref={timerRef} style={{ color: "#e2e8f0", fontSize: 13, padding: "0 4px" }}>10:00</span>
                    <span style={{ color: "#fca5a5", fontSize: 12 }}><span ref={coinRedRef}>0</span> 🪙</span>
                    <span style={{ color: "#fca5a5", fontSize: 12 }} title="Kills"><span ref={killRedRef}>0</span> ⚔</span>
                    <span style={{ color: "#fca5a5" }} title="Structures broken (statues + Ward Seal) — how this mode is won"><span ref={scoreRedRef}>0</span> ⛩</span>
                    <span ref={stanceRedRef} style={{ fontSize: 13 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span ref={structsBlueRef} title="Blue's remaining sentinels · totems · Ward Seal" style={{ fontSize: 9, letterSpacing: 1, opacity: 0.9 }} />
                    <div title="Momentum — structure damage, points, kills and gold" style={{ position: "relative", width: 250, height: 5, borderRadius: 4, background: "#7f1d1d", overflow: "hidden", border: "1px solid rgba(0,0,0,0.6)" }}>
                        <div ref={momentumRef} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "50%", background: "linear-gradient(90deg,#1d4ed8,#60a5fa)", transition: "width 0.4s ease" }} />
                        <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.55)" }} />
                    </div>
                    <span ref={structsRedRef} title="Red's remaining Ward Seal · totems · sentinels" style={{ fontSize: 9, letterSpacing: 1, opacity: 0.9 }} />
                </div>
            </div>
            {/* Objective ribbon — phase clock, current instruction and live
                neutral-objective state. Refs keep it cheap at 60fps. */}
            <div style={{ position: "absolute", top: 70, left: "50%", transform: "translateX(-50%)", width: "min(610px, 58vw)", display: "grid", gap: 4, padding: "5px 10px 6px", background: "linear-gradient(90deg, transparent, rgba(8,12,24,0.9) 10%, rgba(8,12,24,0.9) 90%, transparent)", pointerEvents: "none", fontFamily: "Inter, system-ui, sans-serif" }}>
                <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 9, whiteSpace: "nowrap" }}>
                    <span ref={phaseRef} style={{ color: "#93c5fd", fontSize: 11, fontWeight: 900, letterSpacing: 1.8 }}>LANING</span>
                    <span ref={phaseClockRef} style={{ color: "#64748b", fontSize: 9, fontWeight: 800 }}>NEXT 1:00</span>
                    <span style={{ color: "#334155" }}>◆</span>
                    <span ref={objectiveRef} style={{ color: "#f8fafc", fontSize: 10, fontWeight: 900, letterSpacing: 0.7 }}>FARM COINS · SECURE THE LANES</span>
                </div>
                <div ref={wardenWrapRef} style={{ display: "none", gridTemplateColumns: "auto 170px auto", justifyContent: "center", alignItems: "center", columnGap: 8, rowGap: 2 }}>
                    <span ref={wardenStatusRef} style={{ color: "#e9d5ff", fontSize: 9, fontWeight: 800, minWidth: 102, textAlign: "right" }}>PHASE I</span>
                    <div style={{ height: 6, background: "#1e1b2e", border: "1px solid rgba(216,180,254,0.4)", borderRadius: 5, overflow: "hidden" }}>
                        <div ref={wardenHpRef} style={{ height: "100%", width: "100%", background: "#a78bfa", transition: "width 0.15s linear" }} />
                    </div>
                    <span ref={wardenDamageRef} style={{ color: "#94a3b8", fontSize: 8, fontWeight: 800, minWidth: 102 }}>BLUE 50% · 50% RED</span>
                    <span ref={buffRef} style={{ gridColumn: "1 / 3", color: "#64748b", fontSize: 8, fontWeight: 800, textAlign: "right" }}>⚡ Gate's Wrath unclaimed</span>
                    <span ref={campsRef} style={{ gridColumn: "3", color: "#d8b4fe", fontSize: 8, fontWeight: 800, whiteSpace: "nowrap" }}>🛡 READY · ✚ READY · 👁 READY · 🔥 READY</span>
                </div>
            </div>
            <div style={{ position: "absolute", top: 10, right: 12, display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ padding: "4px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(168,85,247,0.6)", borderRadius: 999, color: "#d8b4fe", font: "700 11px Inter, system-ui, sans-serif" }}>⛩ Hollow Warfront · {spec.label} (beta)</div>
                <label style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 7px", background: "rgba(15,23,42,0.9)", border: "1px solid #334155", borderRadius: 999, color: "#94a3b8", font: "700 10px Inter, system-ui, sans-serif" }}>
                    FX
                    <select
                        aria-label="Warfront visual quality"
                        value={qualityId}
                        onChange={(event) => chooseQuality(event.target.value as PetVisualQuality)}
                        style={{ background: "#0f172a", border: 0, color: "#e2e8f0", font: "700 10px Inter, system-ui, sans-serif", cursor: "pointer" }}
                    >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                    </select>
                </label>
            </div>
            {/* Camera modes: 📺 director's broadcast · 🎬 calm wide · 🛡 my team. */}
            <div style={{ position: "absolute", top: 42, left: 12, display: "flex", gap: 4 }}>
                {([
                    ["broadcast", "📺", "Broadcast — the director chases fights, kills and objectives"],
                    ["calm", "🎬", "Calm — wide and steady; only the big objective moments cut"],
                    ["team", "🛡", "My Team — stay locked on your squad"],
                ] as const).map(([id, icon, tip]) => (
                    <button
                        key={id}
                        onClick={() => { setCamMode(id); setFocusPetId(null); camCtl.current.mode = "follow"; setFreeCam(false); }}
                        title={tip}
                        style={{ padding: "3px 9px", background: camMode === id && !freeCam ? "rgba(109,40,217,0.9)" : "rgba(15,23,42,0.85)", border: `1px solid ${camMode === id && !freeCam ? "#a78bfa" : "#334155"}`, borderRadius: 999, color: camMode === id && !freeCam ? "#fff" : "#94a3b8", cursor: "pointer", font: "700 12px Inter, system-ui, sans-serif" }}
                    >{icon}</button>
                ))}
            </div>
            {freeCam && (
                <button
                    onClick={() => { camCtl.current.mode = "follow"; setFreeCam(false); }}
                    style={{ position: "absolute", top: 74, left: 12, padding: "4px 10px", background: "rgba(109,40,217,0.9)", border: "1px solid #a78bfa", borderRadius: 999, color: "#fff", cursor: "pointer", font: "700 11px Inter, system-ui, sans-serif" }}
                >📍 Free cam — tap to follow</button>
            )}

            {/* Kill feed + minimap (right column) */}
            <div style={{ position: "absolute", top: 46, right: 12, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", pointerEvents: "none" }}>
                <WfMinimap result={result} clock={clock} theme={theme} camViewRef={camView} camCtlRef={camCtl} onModeChange={(m) => setFreeCam(m === "free")} />
                {feed.map((f) => (<div key={f.id} style={{ padding: "3px 9px", background: "rgba(8,12,24,0.82)", border: `1px solid ${f.color}66`, borderRadius: 6, color: f.color, font: "700 11px Inter, system-ui, sans-serif", animation: "wfFeedIn 0.2s ease-out", maxWidth: "44vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.text}</div>))}
            </div>

            {/* MULTI-CAM WALL — one screen per pet; click to feature it. */}
            {multiCamOn && (
                <div style={{ position: "absolute", left: 10, bottom: 10, display: "flex", gap: 8, zIndex: 55 }}>
                    {myPets.map((mp, i) => (
                        <div
                            key={mp.id}
                            ref={(el) => { tileBoxRefs.current[i] = el; }}
                            onClick={() => setFocusPetId((cur) => (cur === mp.id ? null : mp.id))}
                            title={focusPetId === mp.id ? "Swap back — broadcast returns to the main screen" : `Feature ${mp.name} on the main screen (the broadcast moves here)`}
                            style={{ position: "relative", width: tileW, height: tileH, border: `2px solid ${focusPetId === mp.id ? "#fbbf24" : "rgba(96,165,250,0.5)"}`, borderRadius: 10, cursor: "pointer", overflow: "hidden", boxShadow: focusPetId === mp.id ? "0 0 16px rgba(251,191,36,0.45)" : "0 4px 18px rgba(0,0,0,0.5)" }}
                        >
                            <div style={{ position: "absolute", left: 0, right: 0, top: 0, padding: "2px 7px", background: "linear-gradient(rgba(5,8,16,0.85), transparent)", color: focusPetId === mp.id ? "#fde047" : "#93c5fd", font: "700 10px Inter, system-ui, sans-serif", display: "flex", justifyContent: "space-between", pointerEvents: "none" }}>
                                <span>{focusPetId === mp.id ? "📺 Broadcast" : `📷 ${mp.name}`}</span>
                                <span ref={(el) => { tileStatusRefs.current[i] = el; }} style={{ color: "#fca5a5" }} />
                            </div>
                            {/* Squad-health strip — the wall doubles as team frames. */}
                            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: "rgba(5,8,16,0.75)", pointerEvents: "none" }}>
                                <div ref={(el) => { tileHpRefs.current[i] = el; }} style={{ height: "100%", width: "100%", background: "#60a5fa" }} />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* WAR COUNCIL — a fast tactical order + build checkpoint. */}
            {council && (
                <WfWarCouncil
                    key={council.round}
                    round={council.round}
                    buyState={ctl.buyState("blue")}
                    coins={ctl.coins("blue")}
                    initialStance={ctl.stances().blue}
                    onResume={resumeFromCouncil}
                />
            )}

            {ended && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,7,18,0.55)", zIndex: 70 }}>
                    <div style={{ textAlign: "center", animation: "wfEndIn 0.5s ease-out" }}>
                        <div style={{ font: "900 34px Inter, system-ui, sans-serif", color: result.winner === "blue" ? "#60a5fa" : result.winner === "red" ? "#f87171" : "#facc15", textShadow: "0 2px 12px #000" }}>{winLabel}</div>
                        {(() => {
                            const last = result.snapshots[result.snapshots.length - 1];
                            const score = wfVerdictScore(last);
                            let kb = 0, kr = 0;
                            for (const e of result.events) if (e.type === "kill") { if (e.team === "blue") kb++; else kr++; }
                            const sb = last.guardians.red.filter((g) => !g.alive).length;
                            const sr = last.guardians.blue.filter((g) => !g.alive).length;
                            return (
                                <div style={{ marginTop: 6, display: "grid", gap: 2 }}>
                                    <div style={{ color: "#e2e8f0", font: "800 14px Inter, system-ui, sans-serif" }}>
                                        ⛩ Points <span style={{ color: "#93c5fd" }}>{score.blue}</span> — <span style={{ color: "#fca5a5" }}>{score.red}</span>
                                        <span style={{ color: "#64748b" }}> · </span>⚔ Kills <span style={{ color: "#93c5fd" }}>{kb}</span> — <span style={{ color: "#fca5a5" }}>{kr}</span>
                                        <span style={{ color: "#64748b" }}> · </span>🛡 Sentinels <span style={{ color: "#93c5fd" }}>{sb}</span> — <span style={{ color: "#fca5a5" }}>{sr}</span>
                                        <span style={{ color: "#64748b" }}> · </span>🪙 <span style={{ color: "#93c5fd" }}>{result.coins.blue}</span> — <span style={{ color: "#fca5a5" }}>{result.coins.red}</span>
                                        <span style={{ color: "#64748b" }}> · </span>Warden <span style={{ color: "#93c5fd" }}>{Math.round(last.warden.damage.blue)}</span> — <span style={{ color: "#fca5a5" }}>{Math.round(last.warden.damage.red)}</span>
                                    </div>
                                    <div style={{ color: "#64748b", font: "600 11px Inter, system-ui, sans-serif" }}>
                                        {sealBroken ? "Victory by Ward Seal destruction" : "Timer verdict — points (statues + seal broken), then coins"}
                                    </div>
                                </div>
                            );
                        })()}
                        {(() => {
                            const beats = result.events
                                .map((event) => ({ event, label: objectiveEventLabel(event) }))
                                .filter((beat): beat is { event: WarfrontResult["events"][number]; label: string } => !!beat.label)
                                .slice(-8);
                            if (!beats.length) return null;
                            return (
                                <div style={{ margin: "10px auto 0", maxWidth: 620, display: "flex", alignItems: "stretch", justifyContent: "center", gap: 3 }}>
                                    {beats.map(({ event, label }, index) => (
                                        <div key={warfrontEventKey(event, index)} style={{ flex: "1 1 0", minWidth: 0, padding: "5px 6px", background: "rgba(8,12,24,0.82)", borderTop: `2px solid ${objectiveEventColor(event)}`, color: "#cbd5e1", textAlign: "left" }}>
                                            <div style={{ color: objectiveEventColor(event), font: "900 9px Inter, system-ui, sans-serif" }}>{mmss(event.t / WARFRONT_TPS)}</div>
                                            <div style={{ font: "700 9px/1.25 Inter, system-ui, sans-serif" }}>{label}</div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                        {result.petStats && (() => {
                            const rows = [...result.petStats].sort((a, b) => b.dmg - a.dmg);
                            const mvp = warfrontMvpId(rows);
                            const mvpRow = rows.find((row) => row.id === mvp);
                            return (
                                <div style={{ margin: "12px auto 0", maxWidth: 460, background: "rgba(8,12,24,0.85)", border: "1px solid rgba(148,163,184,0.35)", borderRadius: 10, padding: "8px 10px", textAlign: "left" }}>
                                    {mvpRow && (
                                        <div style={{ margin: "-1px 0 7px", color: mvpRow.team === "blue" ? "#93c5fd" : "#fca5a5", font: "900 11px Inter, system-ui, sans-serif" }}>
                                            👑 MVP · {mvpRow.name} · {mvpRow.kills} K / {mvpRow.assists ?? 0} A · {mvpRow.dmg} damage
                                        </div>
                                    )}
                                    <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.55fr 0.5fr 0.5fr 0.85fr 0.85fr", gap: 4, font: "800 10px Inter, system-ui, sans-serif", color: "#64748b", padding: "0 2px 4px" }}>
                                        <span>PET</span><span>LV</span><span>K</span><span>A</span><span>DMG</span><span>🪙</span>
                                    </div>
                                    {rows.map((r) => (
                                        <div key={`${r.team}:${r.id}`} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.55fr 0.5fr 0.5fr 0.85fr 0.85fr", gap: 4, font: "700 12px Inter, system-ui, sans-serif", color: r.team === "blue" ? "#93c5fd" : "#fca5a5", padding: "2px" }}>
                                            <span>{r.id === mvp ? "👑 " : ""}{r.name}</span>
                                            <span>★{r.level}</span>
                                            <span>{r.kills}</span>
                                            <span>{r.assists ?? 0}</span>
                                            <span>{r.dmg}</span>
                                            <span>{r.coins}</span>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                            <button onClick={doReplay} style={{ ...btn, padding: "8px 14px" }}>⟲ Replay</button>
                            <button onClick={doRestart} style={{ ...btn, padding: "8px 14px" }}>↻ Restart</button>
                            {allowReseed && <button onClick={doNewMatch} style={{ ...btn, background: "#6d28d9", border: "1px solid #a78bfa", padding: "8px 14px" }}>🎲 New match</button>}
                            <button onClick={onExit} style={{ ...btn, background: "#1e3a8a", border: "1px solid #3b82f6", padding: "8px 14px" }}>Exit</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    ), document.body);
}
