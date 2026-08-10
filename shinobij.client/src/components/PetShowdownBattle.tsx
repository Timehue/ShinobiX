/*
 * PetShowdownBattle — the cinematic playback layer for Pet Showdown.
 *
 * The battle is resolved ON THE SERVER (api/_pet-showdown/engine.ts): this
 * component only (1) collects one round of commands through the command deck +
 * timing needle, (2) POSTs them, and (3) plays back the returned turn script
 * beat by beat — camera cuts, lunges, projectiles, damage numbers, banners.
 * It never computes a combat number; every figure on screen arrived in an event.
 *
 * Presentation is the product here (the Stadium lesson): one action at a time,
 * each sold with a camera move, a windup→strike→recover clip, an impact flash,
 * a popped damage number and an effectiveness banner. The 3D layer is the
 * proven Coliseum stack — PetModel3D + PetModelBoundary + the projectile visual
 * spec — driven by per-fighter PetModelFrame refs.
 *
 * Fullscreen overlay contract (project rule): portals to document.body with the
 * .pet-combat-takeover class, locks body scroll via .pet-combat-active, and
 * reports the two SEPARATE lifted signals (fullscreen presentation vs
 * unresolved battle) through callbacks the host screen owns.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard, Html, Sparkles } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { petBloomEnabled } from "../lib/pet-coliseum-flag";
import * as THREE from "three";
import { PetModel3D, DEFAULT_PET_MODEL_FRAME, type PetModelFrame } from "./PetModel3D";
import { PetModelBoundary } from "./PetModelBoundary";
import { petCombatModel, type PetCombatModelConfig } from "../lib/pet-3d-models";
import { petCardImage } from "../lib/pet-battle-anim";
import { startBattleMusic, stopBattleMusic, setBattleMusicIntensity, isAudioMuted, setAudioMuted } from "../lib/pet-music";
import { playPetSfx, primePetSfx } from "../lib/pet-sfx";
import { petDuelImpactStrength } from "../lib/pet-duel-presentation";
import { prefersReducedMotion } from "../lib/device-tier";
import {
    ShowdownVfxLayer,
    StatusAuraFx,
    BeatDrivenVfx,
    SuperPillar,
    impactFlipbookKey,
    type VfxSpawn,
    type PillarDrive,
} from "./PetShowdownVfx";
import { SHOWDOWN_ELEMENT_BEATS } from "../../../shared/pet-showdown-contract";
import type { Pet } from "../types/pet";
import type {
    ShowdownCommand,
    ShowdownEvent,
    ShowdownPetView,
    ShowdownStateView,
    ShowdownTurnResponse,
    ShowdownTurnResult,
} from "../lib/pet-showdown-api";

// ─── Staging constants ───────────────────────────────────────────────────────

const PLAYER_Z = 3.6;
const ENEMY_Z = -3.6;
const SLOT_SPACING = 2.7;
const FLOOR_Y = 0;

// ── Arena roster: five painted stages, picked per session. ──────────────────
const STAGES = {
    coliseum: {
        floor: new URL("../assets/coliseum/coliseum-floor.webp", import.meta.url).href,
        bg: new URL("../assets/coliseum/coliseum-bg.webp", import.meta.url).href,
        ember: "#ff7a35", ambient: "#8fc7ff",
    },
    grove: {
        floor: new URL("../assets/coliseum/grove-floor.webp", import.meta.url).href,
        bg: new URL("../assets/coliseum/grove-bg.webp", import.meta.url).href,
        ember: "#9fe7a0", ambient: "#bfe9c9",
    },
    frost: {
        floor: new URL("../assets/coliseum/frost-floor.webp", import.meta.url).href,
        bg: new URL("../assets/coliseum/frost-bg.webp", import.meta.url).href,
        ember: "#9fd8ff", ambient: "#cfe9ff",
    },
    storm: {
        floor: new URL("../assets/coliseum/storm-floor.webp", import.meta.url).href,
        bg: new URL("../assets/coliseum/storm-bg.webp", import.meta.url).href,
        ember: "#ffe24a", ambient: "#9aa7d8",
    },
    volcano: {
        floor: new URL("../assets/coliseum/volcano-floor.webp", import.meta.url).href,
        bg: new URL("../assets/coliseum/volcano-bg.webp", import.meta.url).href,
        ember: "#ff5a2c", ambient: "#ffb08a",
    },
} as const;
type StageKey = keyof typeof STAGES;
const STAGE_KEYS = Object.keys(STAGES) as StageKey[];

function stageForSession(sessionId: string): StageKey {
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) hash = (hash * 31 + sessionId.charCodeAt(i)) | 0;
    return STAGE_KEYS[Math.abs(hash) % STAGE_KEYS.length];
}

const ELEMENT_TINT: Record<string, string> = {
    Fire: "#ff7a35", Water: "#38bdf8", Wind: "#5eead4", Lightning: "#fde047", Earth: "#d6a76a", None: "#a5b4fc",
};

const KIND_ICON: Record<string, string> = {
    damage: "⚔️", crush: "💥", lifesteal: "🩸", burn: "🔥", dot: "☠️", freeze: "❄️", stun: "🌀",
    confuse: "😵", debuff: "📉", buff: "📈", heal: "💚", shield: "🛡️", barrier: "🛡️", absorb: "🛡️",
    mark: "🎯", wound: "🗡️", slow: "🐌", movelock: "🐌", haste: "💨", move: "💨", taunt: "📢",
    push: "🌊", pull: "🪝", guard: "🛡️", rest: "💤",
};

const STATUS_LABEL: Record<string, string> = {
    burn: "🔥", wound: "🗡️", stun: "🌀", freeze: "❄️", confuse: "😵", debuff: "📉", buff: "📈",
    shield: "🛡️", mark: "🎯", slow: "🐌", haste: "💨", crush: "💥", taunt: "📢", steadfast: "💪",
};

/** Plain English for every status the view can actually carry. `movelock` and
 *  `tauntGuard` are unreachable (the engine renames/filters them). */
const STATUS_TITLE: Record<string, string> = {
    burn: "Burning — takes damage each round",
    wound: "Wounded — bleeds each round and heals for less",
    stun: "Stunned — loses its next action",
    freeze: "Frozen — may lose its next action",
    confuse: "Confused — may hit itself instead",
    debuff: "Weakened — deals less damage",
    buff: "Empowered — deals more damage",
    shield: "Shielded — absorbs incoming damage",
    mark: "Marked — the next hit lands harder",
    slow: "Slowed — acts later in the round",
    haste: "Hastened — acts earlier in the round",
    crush: "Crushed — defence lowered",
    taunt: "Taunting — draws single-target attacks",
    steadfast: "Steadfast — immune to stun and freeze",
};

function statusTitle(s: { kind: string; rounds: number; magnitude: number }): string {
    const base = STATUS_TITLE[s.kind] ?? s.kind;
    const pool = s.kind === "shield" && s.magnitude > 0 ? ` (${s.magnitude} left)` : "";
    return `${base}${pool} · ${s.rounds} round${s.rounds === 1 ? "" : "s"}`;
}

// Moves that never point at an enemy (mirror of the server's routing).
const SELF_MOVE_KINDS = new Set(["buff", "haste", "move", "shield", "barrier", "absorb", "taunt"]);
const ALLY_MOVE_KINDS = new Set(["heal"]);

type ActionEvent = Extract<ShowdownEvent, { t: "action" }>;

function beatDurationMs(event: ShowdownEvent, speed: number): number {
    const base = event.t === "action" ? (event.super ? 3300 : (event.moveKind === "guard" || event.moveKind === "rest") ? 1200 : 2300)
        : event.t === "roundStart" ? 950
        : event.t === "skip" ? 900
        : event.t === "switch" ? 1500
        : event.t === "confused" ? 1200
        : event.t === "dot" ? 850
        // A judge ending shows two banners in sequence — at speed 2 a 1700ms
        // beat collides them.
        : event.t === "end" ? (event.byJudge ? 2900 : 1700)
        : 350;
    return base / speed;
}

/** Fraction of an action beat at which the hit lands (damage pops, camera kicks). */
const STRIKE_FRAC = 0.55;

// ─── Shared mutable scene state (refs — read per frame inside the Canvas) ────

interface SceneBeat {
    event: ShowdownEvent | null;
    startedAt: number;
    durationMs: number;
}

interface SceneFx {
    /** petId → timestamp of the last landed hit (drives stagger + hit flash). */
    hitAt: Map<string, number>;
    /** petId → damage-scaled recoil weight for that hit. PetModel3D reads
     *  this as impactPower (0.45-1.25) to drive pitch, squash and weight —
     *  left unset it pinned every hit to the same restrained flinch. */
    hitPower: Map<string, number>;
    shakeUntil: number;
    shakeAmp: number;
    /** Skeletal animation freezes until this timestamp — damage-scaled
     *  hit-stop (the fighting-game contact freeze). */
    hitStopUntil: number;
    superFocus: boolean;
}

interface FighterSlotInfo {
    view: ShowdownPetView;
    side: "player" | "enemy";
    basePos: [number, number, number];
    model: PetCombatModelConfig | null;
    fallbackImage: string;
}

function slotPositions(count: number, side: "player" | "enemy"): [number, number, number][] {
    const z = side === "player" ? PLAYER_Z : ENEMY_Z;
    return Array.from({ length: count }, (_, i) => {
        const x = (i - (count - 1) / 2) * SLOT_SPACING * (side === "player" ? 1 : -1);
        return [x, FLOOR_Y, z] as [number, number, number];
    });
}

/** Who stands where. Fielded pets hold the front slots; the bench waits in a
 *  back row and pets physically RUN between rows on switches. */
interface Lineup {
    playerField: string[];
    playerBench: string[];
    enemyField: string[];
    enemyBench: string[];
}

function lineupFromState(state: ShowdownStateView): Lineup {
    return {
        playerField: state.player.filter((p) => !p.benched).map((p) => p.id),
        playerBench: state.player.filter((p) => p.benched).map((p) => p.id),
        enemyField: state.enemy.filter((p) => !p.benched).map((p) => p.id),
        enemyBench: state.enemy.filter((p) => p.benched).map((p) => p.id),
    };
}

function computeArrangement(lineup: Lineup): Map<string, [number, number, number]> {
    const out = new Map<string, [number, number, number]>();
    const place = (ids: string[], side: "player" | "enemy", bench: boolean) => {
        if (bench) {
            // The bench waits in the WINGS (player left, enemy right), slightly
            // behind its side's line — visible at the frame edge in wide shots,
            // never looming in the camera foreground.
            ids.forEach((id, i) => {
                const wing = side === "player" ? -1 : 1;
                out.set(id, [wing * (6.8 + i * 1.9), FLOOR_Y, side === "player" ? 4.4 : -4.4]);
            });
            return;
        }
        const positions = slotPositions(ids.length, side);
        ids.forEach((id, i) => out.set(id, positions[i]));
    };
    place(lineup.playerField, "player", false);
    place(lineup.playerBench, "player", true);
    place(lineup.enemyField, "enemy", false);
    place(lineup.enemyBench, "enemy", true);
    return out;
}

/** Moves a pet between the field and bench lists of its side. On a voluntary
 *  switch the outgoing pet walks to the bench row; on a reinforcement the
 *  fallen pet simply drops out of the arrangement (the body stays where it
 *  fell — fighters freeze when their id has no assigned position). */
function lineupAfterSwitch(lineup: Lineup, side: "player" | "enemy", outId: string, inId: string, reinforcement: boolean): Lineup {
    const fieldKey = side === "player" ? "playerField" : "enemyField";
    const benchKey = side === "player" ? "playerBench" : "enemyBench";
    const field = lineup[fieldKey].map((id) => (id === outId ? inId : id));
    if (!field.includes(inId)) field.push(inId);
    return {
        ...lineup,
        [fieldKey]: field,
        [benchKey]: lineup[benchKey]
            .filter((id) => id !== inId)
            .concat(!reinforcement && outId !== inId ? [outId] : []),
    };
}

// ─── Stage environment (lifted from the proven Coliseum recipe) ──────────────

function StageEnvironment({ stage }: { stage: StageKey }) {
    const art = STAGES[stage];
    const textures = useMemo(() => {
        const loader = new THREE.TextureLoader();
        const floor = loader.load(art.floor);
        floor.colorSpace = THREE.SRGBColorSpace;
        const backdrop = loader.load(art.bg);
        backdrop.colorSpace = THREE.SRGBColorSpace;
        backdrop.wrapS = THREE.MirroredRepeatWrapping;
        backdrop.repeat.set(2, 1);
        return { floor, backdrop };
    }, [art]);
    const ambient = useRef<THREE.AmbientLight>(null);
    const sun = useRef<THREE.DirectionalLight>(null);
    useFrame((state) => {
        const t = state.clock.elapsedTime;
        if (ambient.current) ambient.current.intensity = 0.5 + Math.sin(t * 7.3) * 0.02 + Math.sin(t * 12.7) * 0.014;
        if (sun.current) sun.current.intensity = 1.15 + Math.sin(t * 9.1) * 0.035;
    });
    return (
        <group>
            <ambientLight ref={ambient} intensity={0.5} />
            <hemisphereLight args={[art.ambient, "#4a210d", 0.56]} />
            <directionalLight
                ref={sun}
                position={[5, 10, 6]}
                intensity={1.15}
                color="#ffe0b5"
                castShadow
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
                shadow-camera-near={1}
                shadow-camera-far={30}
                shadow-camera-left={-12}
                shadow-camera-right={12}
                shadow-camera-top={12}
                shadow-camera-bottom={-12}
            />
            <directionalLight position={[-7, 5, -7]} intensity={0.6} color="#79aaff" />
            <pointLight position={[0, 3.5, 2]} intensity={12} distance={15} decay={2} color={art.ember} />
            <mesh position={[0, 6.0, 0]}>
                <cylinderGeometry args={[19, 19, 21, 48, 1, true, Math.PI * 0.2, Math.PI * 1.6]} />
                <meshBasicMaterial map={textures.backdrop} side={THREE.BackSide} toneMapped={false} fog={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
                <circleGeometry args={[14, 64]} />
                <meshStandardMaterial map={textures.floor} roughness={0.95} />
            </mesh>
            {/* Stage-tinted drifting motes — living air (embers/spores/snow). */}
            <Sparkles count={38} scale={[16, 6, 14]} position={[0, 3, 0]} size={2.6} speed={0.28} color={art.ember} opacity={0.5} />
        </group>
    );
}

// ─── Camera director ─────────────────────────────────────────────────────────

function CameraDirector({ beatRef, fxRef, posRef }: {
    beatRef: React.MutableRefObject<SceneBeat>;
    fxRef: React.MutableRefObject<SceneFx>;
    posRef: React.MutableRefObject<Map<string, [number, number, number]>>;
}) {
    const pos = useRef(new THREE.Vector3(0, 5.2, 9.6));
    const look = useRef(new THREE.Vector3(0, 1.1, -0.4));
    /** Shot identity — when it changes, the camera CUTS (snaps) instead of
     *  lerping: the Pokémon Colosseum grammar. */
    const shotKey = useRef("");
    // Camera + size come from the frame-callback state (not render-scope
    // useThree destructuring) so the mutation stays outside render.
    useFrame((frameState) => {
        const camera = frameState.camera;
        const size = frameState.size;
        const beat = beatRef.current;
        const fx = fxRef.current;
        const now = performance.now();
        // Default: wide broadcast shot from behind the player's line.
        let targetPos = new THREE.Vector3(0, 5.2, 10.2);
        let targetLook = new THREE.Vector3(0, 1.0, -0.4);
        let nextShot = "wide";
        let cutOnChange = false;
        if (beat.event && beat.event.t === "action" && beat.event.moveKind !== "guard" && beat.event.moveKind !== "rest") {
            const actorPos = posRef.current.get(beat.event.actorId);
            const victimPos = beat.event.targets[0] ? posRef.current.get(beat.event.targets[0].id) : undefined;
            if (actorPos) {
                const a = new THREE.Vector3(...actorPos);
                const b = victimPos ? new THREE.Vector3(...victimPos) : a;
                const frac = Math.min(1, (now - beat.startedAt) / beat.durationMs);
                if (beat.event.super) {
                    // Signature: swoop from the actor's shoulder into the impact
                    // (kept as a continuous move — the letterbox moment).
                    nextShot = `super:${beat.startedAt}`;
                    const behind = a.clone().sub(b).normalize().multiplyScalar(3.4);
                    targetPos = a.clone().add(behind).add(new THREE.Vector3(1.6 - frac * 1.1, 2.0 + frac * 0.6, 0));
                    targetLook = frac < 0.45 ? a.clone().setY(1.2) : b.clone().setY(1.1);
                } else {
                    // Colosseum cut sequence: (1) low behind-the-shoulder shot
                    // for the windup, (2) HARD CUT to a side-on shot of the
                    // victim for the strike.
                    cutOnChange = true;
                    const dir = b.clone().sub(a);
                    dir.y = 0;
                    if (dir.lengthSq() < 0.05) dir.set(0, 0, -1);
                    dir.normalize();
                    if (frac < STRIKE_FRAC * 0.92) {
                        nextShot = `windup:${beat.startedAt}`;
                        const lateral = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(1.5);
                        targetPos = a.clone().sub(dir.clone().multiplyScalar(3.4)).add(lateral).setY(1.9);
                        targetLook = b.clone().setY(1.2);
                    } else {
                        nextShot = `strike:${beat.startedAt}`;
                        const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(4.8);
                        targetPos = b.clone().add(side).add(dir.clone().multiplyScalar(-1.6)).setY(2.3);
                        targetLook = b.clone().setY(1.05);
                    }
                }
            }
        }
        // The CUT: on a shot change, snap into the new framing instantly.
        if (nextShot !== shotKey.current) {
            shotKey.current = nextShot;
            if (cutOnChange || nextShot === "wide") {
                if (nextShot !== "wide") {
                    pos.current.copy(targetPos);
                    look.current.copy(targetLook);
                }
            }
        }
        // Idle drift: a slow broadcast-crane sway so the wide shot never sits
        // dead still between actions.
        if (!beat.event || beat.event.t === "roundStart" || beat.event.t === "roundEnd") {
            targetPos.x += Math.sin(now * 0.00013) * 1.1;
            targetPos.y += Math.sin(now * 0.00009 + 1.7) * 0.35;
        }
        // Portrait phones: pull back so both lines stay in frame.
        const aspect = size.width / Math.max(1, size.height);
        if (aspect < 0.9) targetPos.multiplyScalar(1.3);
        pos.current.lerp(targetPos, 0.055);
        look.current.lerp(targetLook, 0.075);
        camera.position.copy(pos.current);
        // Impact shake — decaying, deterministic-feel sin mix.
        if (now < fx.shakeUntil) {
            const t = (fx.shakeUntil - now) / 320;
            const amp = fx.shakeAmp * t * t;
            camera.position.x += Math.sin(now * 0.09) * amp;
            camera.position.y += Math.sin(now * 0.117 + 2.1) * amp * 0.7;
        }
        camera.lookAt(look.current);
    });
    return null;
}

// ─── One fighter ─────────────────────────────────────────────────────────────

interface PopupEntry { key: number; petId: string; text: string; cls: string }

function ShowdownFighter({ info, displayHp, ko, guarding, statuses, victorious, beatRef, fxRef, posRef, popups, highlight }: {
    info: FighterSlotInfo;
    displayHp: number;
    ko: boolean;
    guarding: boolean;
    statuses: readonly { kind: string }[];
    victorious: boolean;
    beatRef: React.MutableRefObject<SceneBeat>;
    fxRef: React.MutableRefObject<SceneFx>;
    /** petId → assigned home position (field slot or bench row). A pet with no
     *  entry (a fallen body after reinforcement) freezes where it stands. */
    posRef: React.MutableRefObject<Map<string, [number, number, number]>>;
    popups: PopupEntry[];
    highlight: "none" | "commander" | "targeted";
}) {
    const group = useRef<THREE.Group>(null);
    const impactRing = useRef<THREE.Mesh>(null);
    const impactMat = useRef<THREE.MeshBasicMaterial>(null);
    const guardBubble = useRef<THREE.Mesh>(null);
    const guardMat = useRef<THREE.MeshBasicMaterial>(null);
    /** Where this fighter currently stands — walks toward its assigned home. */
    const standing = useRef<[number, number, number] | null>(null);
    /** Hit-stop-aware presentation clock fed to the skeletal mixer. */
    const timeline = useRef(0);
    const [modelFailed, setModelFailed] = useState(false);
    const frame = useRef<PetModelFrame>({
        ...DEFAULT_PET_MODEL_FRAME,
        faceX: 0,
        faceZ: info.side === "player" ? -1 : 1,
        statuses: [],
    });
    const fallbackTexture = useMemo(() => {
        if (info.model && !modelFailed) return null;
        const t = new THREE.TextureLoader().load(info.fallbackImage);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }, [info.model, modelFailed, info.fallbackImage]);

    useFrame((_, delta) => {
        const f = frame.current;
        const beat = beatRef.current;
        const fx = fxRef.current;
        const now = performance.now();
        // Home = assigned slot; standing = where the body actually is. Living
        // pets WALK home (switch-ins gallop across the arena); the fallen stay
        // where they dropped.
        const home = posRef.current.get(info.view.id) ?? standing.current ?? info.basePos;
        if (!standing.current) standing.current = [home[0], home[1], home[2]];
        const stand = standing.current;
        let walkX = 0, walkZ = 0, walking = false;
        if (!ko) {
            const dx = home[0] - stand[0];
            const dz = home[2] - stand[2];
            const dist = Math.hypot(dx, dz);
            if (dist > 0.06) {
                walking = true;
                const step = Math.min(dist, delta * 7.2);
                walkX = dx / dist; walkZ = dz / dist;
                stand[0] += walkX * step;
                stand[2] += walkZ * step;
            } else {
                stand[0] = home[0]; stand[2] = home[2];
            }
        }
        let px = stand[0], pz = stand[2];
        const py = home[1];
        let faceX = 0, faceZ = info.side === "player" ? -1 : 1;
        f.moving = false;
        f.speed = 0;
        f.casting = false;

        // Hit-stop-aware presentation clock: skeletal time crawls during the
        // contact freeze, so impacts have fighting-game weight.
        timeline.current += delta * (now < fx.hitStopUntil ? 0.06 : 1);
        f.timeline = timeline.current;

        const lastHit = fx.hitAt.get(info.view.id) ?? 0;
        const sinceHit = now - lastHit;

        if (ko) {
            f.motion = "dead";
            f.victorious = false;
        } else if (beat.event && beat.event.t === "action" && beat.event.actorId === info.view.id
            && beat.event.moveKind !== "guard" && beat.event.moveKind !== "rest") {
            const ev = beat.event as ActionEvent;
            const frac = Math.min(1, (now - beat.startedAt) / beat.durationMs);
            const targetPos = ev.targets[0] ? posRef.current.get(ev.targets[0].id) : undefined;
            if (targetPos && ev.targets[0].id !== info.view.id) {
                const dx = targetPos[0] - stand[0];
                const dz = targetPos[2] - stand[2];
                const len = Math.hypot(dx, dz) || 1;
                faceX = dx / len; faceZ = dz / len;
                if (ev.delivery === "melee") {
                    // Approach → strike at contact → spring back.
                    const reach = Math.max(0, len - 1.4);
                    const drive = frac < 0.32 ? 0
                        : frac < 0.5 ? (frac - 0.32) / 0.18
                        : frac < 0.68 ? 1
                        : Math.max(0, 1 - (frac - 0.68) / 0.24);
                    px = stand[0] + faceX * reach * drive;
                    pz = stand[2] + faceZ * reach * drive;
                    f.motion = frac < 0.32 ? "windup" : frac < 0.5 ? "dash" : frac < 0.7 ? "strike" : "recover";
                    if (f.motion === "dash") { f.moving = true; f.speed = 9; f.moveX = faceX; f.moveZ = faceZ; }
                } else {
                    f.motion = frac < 0.4 ? "windup" : frac < 0.62 ? "strike" : "recover";
                    f.casting = frac < 0.4;
                }
            } else {
                f.motion = frac < 0.4 ? "windup" : frac < 0.62 ? "strike" : "recover";
            }
        } else if (sinceHit >= 0 && sinceHit < 480) {
            f.motion = "stagger";
            f.hit = Math.max(0, 1 - sinceHit / 480);
            f.impactPower = fx.hitPower.get(info.view.id) ?? 0.55;
        } else if (walking) {
            f.motion = "run";
            f.moving = true;
            f.speed = 7.2;
            f.moveX = walkX; f.moveZ = walkZ;
            faceX = walkX; faceZ = walkZ;
        } else {
            f.motion = "idle";
            f.hit = 0;
        }
        f.faceX = faceX;
        f.faceZ = faceZ;
        f.victorious = victorious && !ko;
        f.desperate = !ko && displayHp / Math.max(1, info.view.maxHp) < 0.25;
        if (group.current) group.current.position.set(px, py, pz);

        // Impact burst: an expanding, fading shockwave ring at the feet for
        // ~0.45s after a landed hit. Driven entirely off fx.hitAt — no re-render.
        if (impactRing.current && impactMat.current) {
            const t = sinceHit / 450;
            const active = lastHit > 0 && t >= 0 && t < 1;
            impactRing.current.visible = active;
            if (active) {
                const s = 0.5 + t * 1.9;
                impactRing.current.scale.set(s, s, s);
                impactMat.current.opacity = 0.85 * (1 - t) * (1 - t);
            }
        }
        // Guard bubble: a soft breathing shell while the pet holds Guard.
        if (guardBubble.current && guardMat.current) {
            guardBubble.current.visible = guarding && !ko;
            if (guarding && !ko) {
                const pulse = 1 + Math.sin(now * 0.006) * 0.03;
                guardBubble.current.scale.set(pulse, pulse, pulse);
                guardMat.current.opacity = 0.16 + Math.sin(now * 0.006) * 0.04;
            }
        }
    });

    const tint = ELEMENT_TINT[info.view.element] ?? ELEMENT_TINT.None;
    const myPopups = popups.filter((p) => p.petId === info.view.id);

    return (
        <group ref={group} position={info.basePos}>
            {info.model && !modelFailed ? (
                <PetModelBoundary onFail={() => setModelFailed(true)}>
                    <Suspense fallback={null}>
                        <PetModel3D config={info.model} frame={frame} element={info.view.element} />
                    </Suspense>
                </PetModelBoundary>
            ) : (
                // No approved 3D model: full-body card art on a grounded billboard.
                <Billboard lockX lockZ>
                    <mesh position={[0, 1.05, 0]}>
                        <planeGeometry args={[2.0, 2.0]} />
                        <meshBasicMaterial map={fallbackTexture} transparent alphaTest={0.06} toneMapped={false} />
                    </mesh>
                </Billboard>
            )}
            {/* Contact blob shadow grounds the silhouette. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <circleGeometry args={[0.85, 24]} />
                <meshBasicMaterial color="#000" transparent opacity={ko ? 0.14 : 0.34} />
            </mesh>
            {/* Impact shockwave ring (visibility driven per-frame). */}
            <mesh ref={impactRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} visible={false}>
                <ringGeometry args={[0.7, 0.92, 40]} />
                <meshBasicMaterial ref={impactMat} color={tint} transparent opacity={0} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
            {/* Guard shell. */}
            <mesh ref={guardBubble} position={[0, 1.0, 0]} visible={false}>
                <sphereGeometry args={[1.35, 20, 14]} />
                <meshBasicMaterial ref={guardMat} color="#8ecdf7" transparent opacity={0.16} toneMapped={false} depthWrite={false} />
            </mesh>
            {/* Persistent painted status auras: burning pets burn, frozen pets frost. */}
            {!ko && <StatusAuraFx statuses={statuses} />}
            {highlight !== "none" && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
                    <ringGeometry args={[0.95, 1.12, 32]} />
                    <meshBasicMaterial color={highlight === "commander" ? "#fbbf24" : "#f87171"} transparent opacity={0.85} toneMapped={false} />
                </mesh>
            )}
            {!ko && highlight === "none" && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
                    <ringGeometry args={[0.9, 0.97, 32]} />
                    <meshBasicMaterial color={tint} transparent opacity={0.35} toneMapped={false} />
                </mesh>
            )}
            {myPopups.map((p) => (
                <Html key={p.key} center position={[0, 2.5, 0]} zIndexRange={[30, 0]} wrapperClass="showdown-popup-anchor">
                    <div className={`showdown-popup ${p.cls}`}>{p.text}</div>
                </Html>
            ))}
        </group>
    );
}


// ─── Timing needle (DOM) ─────────────────────────────────────────────────────

function TimingNeedle({ onGrade }: { onGrade: (grade: number) => void }) {
    const [pos, setPos] = useState(0);
    const raf = useRef(0);
    const start = useRef<number | null>(null);
    const done = useRef(false);
    const btn = useRef<HTMLButtonElement>(null);
    const SWEEP_MS = 1100;
    useEffect(() => {
        // Lazy-init so the sweep clock starts on mount, not in render — and
        // survives parent re-renders mid-sweep without restarting.
        if (start.current === null) start.current = performance.now();
        // The command deck unmounts when the needle appears, so a keyboard
        // player's focus falls to <body> and they can never hit the window —
        // capping them at the base multiplier forever. Take focus explicitly.
        btn.current?.focus({ preventScroll: true });
        const tick = () => {
            const elapsed = performance.now() - (start.current ?? performance.now());
            if (elapsed >= SWEEP_MS) {
                if (!done.current) { done.current = true; onGrade(0); }
                return;
            }
            setPos(elapsed / SWEEP_MS);
            raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf.current);
    }, [onGrade]);
    const tap = () => {
        if (done.current) return;
        done.current = true;
        cancelAnimationFrame(raf.current);
        const dist = Math.abs(pos - 0.5);
        onGrade(dist <= 0.08 ? 2 : dist <= 0.2 ? 1 : 0);
    };
    return (
        // Both handlers: pointer users keep the earlier pointerdown timing,
        // keyboard activation arrives as a click. The done latch makes the
        // double-fire a no-op.
        <button ref={btn} type="button" className="showdown-needle" onPointerDown={tap} onClick={tap}>
            <div className="showdown-needle-track">
                <div className="showdown-needle-zone good" />
                <div className="showdown-needle-zone perfect" />
                <div className="showdown-needle-marker" style={{ left: `${pos * 100}%` }} />
            </div>
            <div className="showdown-needle-hint">TAP in the center!</div>
        </button>
    );
}

// ─── Team panel (DOM) ────────────────────────────────────────────────────────

interface DisplayEntry { hp: number; stamina: number; meter: number; ko: boolean; guarding: boolean; statuses: { kind: string; rounds: number; magnitude: number }[] }

function TeamPanel({ side, pets, display, targeting, onPickTarget, commanderId, hintElement, art, benchedIds, benchPicking, onPickBench }: {
    side: "player" | "enemy";
    pets: ShowdownPetView[];
    display: Record<string, DisplayEntry>;
    targeting: boolean;
    onPickTarget?: (petId: string) => void;
    commanderId?: string | null;
    /** While targeting: the commander's element, for ▲/▼ matchup hints. */
    hintElement?: string;
    /** petId → portrait/card art url. */
    art?: Record<string, string>;
    /** Which team members currently wait on the bench. */
    benchedIds?: ReadonlySet<string>;
    /** Switch flow: bench cards become the pick targets. */
    benchPicking?: boolean;
    onPickBench?: (petId: string) => void;
}) {
    return (
        <div className={`showdown-team-panel ${side}`}>
            {pets.map((pet) => {
                const d = display[pet.id] ?? { hp: pet.hp, stamina: pet.stamina, meter: pet.meter, ko: pet.ko, guarding: pet.guarding, statuses: pet.statuses };
                const benched = benchedIds?.has(pet.id) ?? false;
                const clickable = !d.ko && (benchPicking ? benched : targeting && !benched);
                const showHint = !!hintElement && !d.ko && !benched;
                const skipping = pet.skipsNextAction;
                return (
                    <button
                        key={pet.id}
                        type="button"
                        disabled={!clickable}
                        onClick={clickable
                            ? () => (benchPicking ? onPickBench?.(pet.id) : onPickTarget?.(pet.id))
                            : undefined}
                        className={[
                            "showdown-pet-card",
                            d.ko ? "ko" : "",
                            benched ? "benched" : "",
                            clickable ? "targetable" : "",
                            commanderId === pet.id ? "commanding" : "",
                        ].join(" ")}
                    >
                        {art?.[pet.id] && <img className="showdown-pet-portrait" src={art[pet.id]} alt="" loading="lazy" />}
                        <div className="showdown-pet-card-head">
                            <span className="showdown-pet-name">{pet.name}</span>
                            {/* The matchup readout is gated on the ELEMENT being
                                known, never on the card being a click target —
                                it used to require multi-target mode, so in 1v1
                                (the format whose blurb sells the wheel) it could
                                never render at all. */}
                            {showHint && SHOWDOWN_ELEMENT_BEATS[hintElement!] === pet.element && (
                                <span className="showdown-matchup up" title="Your element is strong here">▲ STRONG ×1.5</span>
                            )}
                            {showHint && SHOWDOWN_ELEMENT_BEATS[pet.element] === hintElement && (
                                <span className="showdown-matchup down" title="Your element is weak here">▼ WEAK ×0.75</span>
                            )}
                        </div>
                        <div className="showdown-pet-card-sub">
                            <span className="showdown-pet-level">Lv {pet.level}</span>
                            <span className="showdown-pet-element" style={{ color: ELEMENT_TINT[pet.element] ?? ELEMENT_TINT.None }}>
                                {pet.element !== "None" ? pet.element : ""}
                            </span>
                            {benched && !d.ko && <span className="showdown-bench-tag">BENCH</span>}
                            {skipping && !d.ko && <span className="showdown-skip-tag" title="Loses its next action">💨 SKIP</span>}
                        </div>
                        {side === "player" && (pet.trait || pet.gearName) && (
                            <div className="showdown-pet-kit">
                                {pet.trait && <span className="showdown-kit-chip trait" title="Trait">{pet.trait}</span>}
                                {pet.gearName && <span className="showdown-kit-chip gear" title="Equipped gear">{pet.gearName}</span>}
                            </div>
                        )}
                        <div className="showdown-bar hp">
                            {/* The chip layer drains SLOWLY behind the instant fill —
                                the classic "damage you just took" read. */}
                            <div className="chip" style={{ width: `${Math.max(0, (d.hp / Math.max(1, pet.maxHp)) * 100)}%` }} />
                            <div className="fill" style={{ width: `${Math.max(0, (d.hp / Math.max(1, pet.maxHp)) * 100)}%` }} />
                        </div>
                        <div className="showdown-bar stamina"><div style={{ width: `${Math.max(0, (d.stamina / Math.max(1, pet.maxStamina)) * 100)}%` }} /></div>
                        <div className={`showdown-bar meter ${d.meter >= 100 ? "full" : ""}`}><div style={{ width: `${Math.max(0, d.meter)}%` }} /></div>
                        {d.statuses.length > 0 && (
                            <div className="showdown-statuses">
                                {d.statuses.map((s) => (
                                    <span key={s.kind} className="showdown-status-pip" title={statusTitle(s)}>
                                        {STATUS_LABEL[s.kind] ?? "✦"}
                                        <b>{s.rounds}</b>
                                    </span>
                                ))}
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function PetShowdownBattle({ initialState, playerPets, sharedImages, submitTurn, onForfeit, onFinished, onExit, onRematch }: {
    initialState: ShowdownStateView;
    /** The player's real roster Pets (for 3D model + art resolution). */
    playerPets: Pet[];
    sharedImages: Record<string, string>;
    submitTurn: (commands: ShowdownCommand[]) => Promise<ShowdownTurnResult>;
    onForfeit: () => void;
    /** Fired once when the end event has played; settlement may carry rewards. */
    onFinished: (outcome: "win" | "loss", settlement: ShowdownTurnResponse | null) => void;
    onExit: () => void;
    onRematch: () => void;
}) {
    const [stateView, setStateView] = useState(initialState);
    const [phase, setPhase] = useState<"command" | "playing" | "finished">("command");
    const [display, setDisplay] = useState<Record<string, DisplayEntry>>(() => buildDisplay(initialState));
    const [queue, setQueue] = useState<ShowdownEvent[]>([]);
    const [queueIndex, setQueueIndex] = useState(0);
    const [banner, setBanner] = useState<{ key: number; text: string; cls: string } | null>(null);
    const [popups, setPopups] = useState<PopupEntry[]>([]);
    const [fast, setFast] = useState(false);
    const [confirmForfeit, setConfirmForfeit] = useState(false);
    const [netError, setNetError] = useState(false);
    const [expired, setExpired] = useState(false);
    const [letterbox, setLetterbox] = useState(false);
    const [flash, setFlash] = useState(0);
    const [endedByJudge, setEndedByJudge] = useState(false);
    const [endOutcome, setEndOutcome] = useState<"win" | "loss" | null>(null);
    const [muted, setMuted] = useState(() => isAudioMuted());
    const toggleAudio = useCallback(() => {
        const next = !isAudioMuted();
        setAudioMuted(next);
        setMuted(next);
        // Unmuting must RESTART the loop: startBattleMusic early-returns while
        // muted, so the theme is null and clearing the flag alone resumes
        // nothing.
        if (!next) {
            primePetSfx();
            startBattleMusic("standard");
            setBattleMusicIntensity("pressure");
        }
    }, []);
    const [vfx, setVfx] = useState<VfxSpawn[]>([]);
    const [settlement, setSettlement] = useState<ShowdownTurnResponse | null>(null);

    // Command drafting.
    const [draft, setDraft] = useState<ShowdownCommand[]>([]);
    const [pendingMove, setPendingMove] = useState<{ moveIndex: number; super: boolean } | null>(null);
    const [pickingSwitch, setPickingSwitch] = useState(false);
    const [needleFor, setNeedleFor] = useState<{ petId: string; moveIndex: number; super: boolean; targetId: string } | null>(null);
    // VS intro card over the opening seconds.
    const [intro, setIntro] = useState(true);
    useEffect(() => {
        const timer = window.setTimeout(() => setIntro(false), 2600);
        return () => window.clearTimeout(timer);
    }, []);

    const settlementRef = useRef<ShowdownTurnResponse | null>(null);
    const finishedNotified = useRef(false);
    const popupKey = useRef(1);
    const timeouts = useRef<number[]>([]);
    const speed = fast ? 2.1 : 1;

    const beatRef = useRef<SceneBeat>({ event: null, startedAt: 0, durationMs: 1 });
    const fxRef = useRef<SceneFx>({ hitAt: new Map(), hitPower: new Map(), shakeUntil: 0, shakeAmp: 0, hitStopUntil: 0, superFocus: false });
    const reducedMotion = prefersReducedMotion();
    const pillarDrive = useRef<PillarDrive>({ activeUntil: 0, startedAt: 0, x: 0, z: 0, color: "#fbbf24" });

    // Who stands where — switches and reinforcements move pets between the
    // front line and the bench row; fighters walk to their assigned spot.
    const [lineup, setLineup] = useState<Lineup>(() => lineupFromState(initialState));
    const posRef = useRef<Map<string, [number, number, number]>>(computeArrangement(lineupFromState(initialState)));
    useEffect(() => {
        posRef.current = computeArrangement(lineup);
    }, [lineup]);

    const stage = useMemo(() => stageForSession(initialState.sessionId), [initialState.sessionId]);

    // ── Fullscreen overlay + body scroll lock + music ───────────────────────
    useEffect(() => {
        document.body.classList.add("pet-combat-active");
        startBattleMusic("standard");
        primePetSfx();
        return () => {
            document.body.classList.remove("pet-combat-active");
            stopBattleMusic();
        };
    }, []);

    // ── Fighter slot map (positions + model configs, stable per roster) ─────
    const slots = useMemo(() => {
        const map = new Map<string, FighterSlotInfo>();
        const playerPos = slotPositions(stateView.player.length, "player");
        const enemyPos = slotPositions(stateView.enemy.length, "enemy");
        stateView.player.forEach((view, i) => {
            const realPet = playerPets.find((p) => p.id === view.id) ?? null;
            const petLike = realPet ?? ({ id: view.id, name: view.name, rarity: view.rarity, element: view.element } as unknown as Pet);
            map.set(view.id, {
                view, side: "player", basePos: playerPos[i],
                model: petCombatModel(petLike),
                fallbackImage: petCardImage(petLike, sharedImages),
            });
        });
        stateView.enemy.forEach((view, i) => {
            const petLike = {
                id: view.templateId ?? view.id, templateId: view.templateId,
                name: view.name, rarity: view.rarity, element: view.element,
            } as unknown as Pet;
            map.set(view.id, {
                view, side: "enemy", basePos: enemyPos[i],
                model: petCombatModel(petLike),
                fallbackImage: petCardImage(petLike, sharedImages),
            });
        });
        return map;
        // Rosters never change mid-session; art inputs are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stateView.player.length, stateView.enemy.length]);

    /** Spawn a one-shot painted flipbook at a pet's current position. */
    const spawnFlipbook = useCallback((petId: string, frames: string, scale: number, durationMs: number, yLift = 1.0, aspect = 1) => {
        const at = posRef.current.get(petId);
        if (!at) return;
        const key = popupKey.current++;
        setVfx((list) => [...list.slice(-14), {
            key, frames, scale, durationMs, aspect,
            pos: [at[0], at[1] + yLift, at[2]] as [number, number, number],
            startedAt: performance.now(),
        }]);
        window.setTimeout(() => setVfx((list) => list.filter((s) => s.key !== key)), durationMs + 400);
    }, []);

    const clearTimers = useCallback(() => {
        for (const id of timeouts.current) window.clearTimeout(id);
        timeouts.current = [];
    }, []);
    useEffect(() => () => clearTimers(), [clearTimers]);

    const later = useCallback((fn: () => void, ms: number) => {
        timeouts.current.push(window.setTimeout(fn, ms));
    }, []);

    // Removal timers use RAW setTimeout, NOT later(): later()'s queue is
    // cleared by the beat effect's cleanup on every beat advance, which would
    // strand banners and leak spent popups in state. A removal firing after
    // unmount is a harmless no-op setState.
    const showBanner = useCallback((text: string, cls: string, holdMs = 1100) => {
        const key = popupKey.current++;
        setBanner({ key, text, cls });
        window.setTimeout(() => setBanner((b) => (b?.key === key ? null : b)), holdMs);
    }, []);

    const addPopup = useCallback((petId: string, text: string, cls: string) => {
        const key = popupKey.current++;
        setPopups((p) => [...p, { key, petId, text, cls }]);
        window.setTimeout(() => setPopups((p) => p.filter((e) => e.key !== key)), 1250);
    }, []);

    // ── Beat player ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (phase !== "playing") return;
        if (queueIndex >= queue.length) {
            // Script exhausted: reconcile to the server state and hand control
            // back. Deferred via the timer queue so the effect body itself never
            // sets state synchronously (react-hooks/set-state-in-effect).
            later(() => {
                const response = settlementRef.current;
                if (response?.state) {
                    setStateView(response.state);
                    setDisplay(buildDisplay(response.state));
                    setLineup(lineupFromState(response.state));
                    if (response.state.finished) {
                        setPhase("finished");
                        if (!finishedNotified.current && response.state.outcome) {
                            finishedNotified.current = true;
                            onFinished(response.state.outcome, response);
                        }
                        return;
                    }
                }
                setPhase("command");
                setDraft([]);
                setPendingMove(null);
            }, 0);
            return clearTimers;
        }
        const event = queue[queueIndex];
        const durationMs = beatDurationMs(event, speed);
        beatRef.current = { event, startedAt: performance.now(), durationMs };

        if (event.t === "roundStart") {
            const isFinal = event.round >= stateView.maxRounds;
            showBanner(
                event.round === 1 ? "⚔️ Battle Start!" : isFinal ? "⚡ FINAL ROUND" : `Round ${event.round}`,
                isFinal ? "super" : "round",
                durationMs * 0.8,
            );
            if (isFinal) setBattleMusicIntensity("pressure");
        } else if (event.t === "skip") {
            const name = nameOf(stateView, event.actorId);
            showBanner(event.reason === "winded" ? `${name} is winded!` : event.reason === "stun" ? `${name} is stunned!` : `${name} is frozen solid!`, "status", durationMs * 0.85);
            // The lost turn gets a visual: sparks crackle on a stun, frost
            // flashes on a freeze (winded pets just pant — the banner carries it).
            later(() => {
                if (event.reason === "stun") spawnFlipbook(event.actorId, "spark", 2.2, 620, 1.6);
                else if (event.reason === "freeze") spawnFlipbook(event.actorId, "ice", 2.4, 620);
            }, durationMs * 0.25);
        } else if (event.t === "confused") {
            const name = nameOf(stateView, event.actorId);
            showBanner(`${name} hurt itself in confusion!`, "status", durationMs * 0.85);
            later(() => {
                addPopup(event.actorId, `-${event.selfDamage}`, "damage");
                applyToDisplay(setDisplay, event.actorId, (d) => ({ ...d, hp: Math.max(0, d.hp - event.selfDamage), ko: event.ko }));
                fxRef.current.hitAt.set(event.actorId, performance.now());
            }, durationMs * 0.5);
        } else if (event.t === "switch") {
            later(() => {
                const inName = nameOf(stateView, event.inId);
                showBanner(
                    event.side === "player"
                        ? (event.reinforcement ? `${inName} joins the fight!` : `Go, ${inName}!`)
                        : (event.reinforcement ? `The enemy sends in ${inName}!` : `They swap to ${inName}!`),
                    "status",
                    durationMs * 0.8,
                );
                playPetSfx("move");
                // Reassign slots — the fighters physically run the exchange.
                setLineup((l) => lineupAfterSwitch(l, event.side, event.outId, event.inId, event.reinforcement));
            }, 0);
        } else if (event.t === "dot") {
            later(() => {
                addPopup(event.targetId, `-${event.damage}`, "dot");
                playPetSfx("dot");
                applyToDisplay(setDisplay, event.targetId, (d) => ({ ...d, hp: Math.max(0, d.hp - event.damage), ko: event.ko }));
            }, durationMs * 0.35);
        } else if (event.t === "end") {
            // 11.3% of fights used to end on a rule the player was never told.
            if (event.byJudge) {
                setEndedByJudge(true);
                later(() => showBanner("⚖️ JUDGE'S DECISION", "judge", 1300 / speed), 0);
            }
            setEndOutcome(event.outcome);
            later(() => {
                showBanner(event.outcome === "win" ? "VICTORY!" : "DEFEAT", event.outcome === "win" ? "victory" : "defeat", 2400 / speed);
                playPetSfx(event.outcome === "win" ? "victory" : "ko");
                if (event.outcome === "win") playPetSfx("crowd");
            }, durationMs * (event.byJudge ? 0.5 : 0.2));
        } else if (event.t === "action") {
            if (event.super) {
                later(() => {
                    setLetterbox(true);
                    showBanner(`⭐ ${event.moveName}!`, "super", durationMs * 0.6);
                    setBattleMusicIntensity("climax");
                    playPetSfx("finisher");
                }, 0);
                later(() => setLetterbox(false), durationMs * 0.94);
            }
            // The Colosseum declaration: "Red Fox used Flame Bolt!" opens every
            // non-super action (supers already banner their own name larger).
            if (!event.super && event.moveKind !== "guard" && event.moveKind !== "rest") {
                later(() => showBanner(`${nameOf(stateView, event.actorId)} used ${event.moveName}!`, "declare", durationMs * 0.42), 0);
            }
            // Windup: a charge-gather flipbook on the caster for real attacks.
            if (event.moveKind !== "guard" && event.moveKind !== "rest") {
                later(() => spawnFlipbook(event.actorId, event.super ? "charge" : event.delivery === "ranged" ? "charge" : "aura", event.super ? 2.6 : 1.7, durationMs * (event.delivery === "melee" ? 0.28 : 0.36), 1.05), durationMs * 0.04);
            }
            // Strike moment: damage numbers, HP drains, shake, effectiveness call.
            later(() => {
                let anyKo = false;
                let anyHeal = false;
                let anySynergy = false;
                let bestEffect: "super" | "weak" | null = null;
                for (const target of event.targets) {
                    if (target.damage > 0) {
                        addPopup(target.id, `-${target.damage}`, target.guarded ? "guarded" : event.super ? "super" : "damage");
                        fxRef.current.hitAt.set(target.id, performance.now());
                        // Damage-scaled recoil: a chip flinches, a haymaker folds
                        // the body. Uses the sibling mode's tuned curve — a raw
                        // damage fraction reads as almost no flinch at all.
                        fxRef.current.hitPower.set(
                            target.id,
                            petDuelImpactStrength(target.damage / Math.max(1, stateMaxHp(stateView, target.id)), event.super),
                        );
                        // Painted impact: the element's flipbook detonates on the
                        // victim (splash hits get a smaller wash).
                        spawnFlipbook(
                            target.id,
                            impactFlipbookKey(event.element, event.moveKind, event.super),
                            event.super ? (target.splash ? 2.6 : 3.6) : target.splash ? 1.8 : 2.4,
                            event.super ? 720 : 560,
                        );
                        // Lightning ranged attacks STRIKE FROM THE SKY — a tall
                        // bolt drops on the victim (there was no travel to watch).
                        if (event.element === "Lightning" && event.delivery === "ranged" && !target.splash) {
                            spawnFlipbook(target.id, "lightning", 2.9, 520, 2.6, 2.2);
                        }
                        // A signature also detonates its ELEMENT large over the
                        // kaboom, so every super reads as its nature.
                        if (event.super && !target.splash) {
                            const el = event.element.toLowerCase();
                            if (["fire", "water", "earth", "wind", "lightning"].includes(el)) {
                                spawnFlipbook(target.id, el, 4.4, 820);
                            }
                        }
                        if (target.effectiveness === "super") bestEffect = "super";
                        else if (target.effectiveness === "weak" && bestEffect !== "super") bestEffect = "weak";
                        anySynergy = anySynergy || !!target.synergy;
                    }
                    if (target.heal > 0) {
                        addPopup(target.id, `+${target.heal}`, "heal");
                        spawnFlipbook(target.id, "heal", 2.2, 700);
                        anyHeal = true;
                    }
                    if (target.applied && target.damage === 0 && target.heal === 0) {
                        addPopup(target.id, KIND_ICON[target.applied] ?? "✦", "status");
                        spawnFlipbook(target.id, impactFlipbookKey(event.element, target.applied, false), 1.9, 620);
                    }
                    anyKo = anyKo || target.ko;
                    applyToDisplay(setDisplay, target.id, (d) => ({
                        ...d,
                        hp: Math.max(0, Math.min(stateMaxHp(stateView, target.id), d.hp - target.damage + target.heal)),
                        ko: target.ko,
                    }));
                }
                // Actor resource sync — and the guard shell tracks whoever is
                // actually holding Guard right now.
                applyToDisplay(setDisplay, event.actorId, (d) => ({
                    ...d, stamina: event.staminaAfter, meter: event.meterAfter,
                    guarding: event.moveKind === "guard",
                }));
                const totalDamage = event.targets.reduce((sum, t) => sum + t.damage, 0);
                if (totalDamage > 0) {
                    fxRef.current.shakeUntil = performance.now() + (event.super ? 460 : 300);
                    // Screen shake is motion; hit-stop is a timing freeze and stays.
                    fxRef.current.shakeAmp = reducedMotion
                        ? 0
                        : event.super ? 0.34 : Math.min(0.24, 0.08 + totalDamage / 900);
                    playPetSfx(event.super ? "crit" : "hit");
                    // Damage-scaled hit-stop (fighting-game contact freeze),
                    // heavier for Lightning per the electric-hitlag convention.
                    const stopMs = Math.min(330, 110 + totalDamage * 0.45) * (event.element === "Lightning" ? 1.4 : 1);
                    fxRef.current.hitStopUntil = performance.now() + (event.super ? Math.max(stopMs, 260) : stopMs);
                    if (event.super) {
                        // Signature detonation: light pillar on the primary target
                        // + a full-screen white flash.
                        const primary = posRef.current.get(event.targets[0].id);
                        if (primary) {
                            pillarDrive.current = {
                                startedAt: performance.now(),
                                activeUntil: performance.now() + 750,
                                x: primary[0],
                                z: primary[2],
                                color: ELEMENT_TINT[event.element] ?? "#fbbf24",
                            };
                        }
                        if (!reducedMotion) {
                            setFlash(popupKey.current++);
                            later(() => setFlash(0), 260);
                        }
                    }
                } else if (event.moveKind === "guard") {
                    playPetSfx("shield");
                    spawnFlipbook(event.actorId, "eshield", 2.0, 600);
                } else if (anyHeal) {
                    playPetSfx("heal");
                } else if (event.targets.some((t) => t.applied)) {
                    playPetSfx("buff");
                }
                // Overdraft: the actor bleeds for the deficit (Temtem's chip).
                if (event.overexertDamage) {
                    addPopup(event.actorId, `-${event.overexertDamage}`, "damage");
                    fxRef.current.hitAt.set(event.actorId, performance.now());
                    applyToDisplay(setDisplay, event.actorId, (d) => ({
                        ...d,
                        hp: Math.max(0, d.hp - (event.overexertDamage ?? 0)),
                        ko: d.hp - (event.overexertDamage ?? 0) <= 0,
                    }));
                }
                if (event.timing === 2 && event.actorSide === "player") showBanner("PERFECT!", "perfect", 750 / speed);
                else if (anySynergy && event.actorSide === "player") showBanner("🤝 Synergy!", "effective", 850 / speed);
                else if (bestEffect === "super") { showBanner("Super effective!", "effective", 900 / speed); playPetSfx("superEffective"); }
                else if (bestEffect === "weak") showBanner("Not very effective…", "weak", 900 / speed);
                if (anyKo) later(() => { showBanner("KO!", "ko", 900 / speed); playPetSfx("ko"); }, 220);
                if (event.overexerted) later(() => addPopup(event.actorId, "OVEREXERTED!", "overexert"), 300);
            }, durationMs * STRIKE_FRAC);
        }

        later(() => setQueueIndex((i) => i + 1), durationMs);
        return clearTimers;
        // `speed` is deliberately NOT a dep: re-running this effect mid-beat
        // would re-apply the strike side effects (double damage numbers). A
        // fast-forward toggle takes effect from the next beat's fresh closure.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, queue, queueIndex]);

    // ── Command flow ────────────────────────────────────────────────────────
    // Only FIELD pets act and can be targeted; the bench waits its turn.
    const livingPlayer = lineup.playerField
        .map((id) => stateView.player.find((p) => p.id === id))
        .filter((p): p is ShowdownPetView => !!p && !(display[p.id]?.ko ?? p.ko));
    const livingEnemies = lineup.enemyField
        .map((id) => stateView.enemy.find((p) => p.id === id))
        .filter((p): p is ShowdownPetView => !!p && !(display[p.id]?.ko ?? p.ko));
    const livingBench = lineup.playerBench
        .map((id) => stateView.player.find((p) => p.id === id))
        .filter((p): p is ShowdownPetView => !!p && !(display[p.id]?.ko ?? p.ko));
    // A pet that will lose its next action is not asked for one — it used to
    // get the full deck and a timing needle for a command the engine discards
    // before ever reading it. A STUNNED pet is still prompted (it may switch);
    // an overdraft-winded pet may not rotate away, so it is skipped entirely.
    const promptable = livingPlayer.filter(
        (p) => !p.skipsNextAction || (p.canSwitchOut && livingBench.length > 0),
    );
    const commander = phase === "command" ? promptable[draft.length] ?? null : null;
    const commanderMustSwitch = !!commander && commander.skipsNextAction;
    const commanderDisplay = commander ? display[commander.id] : null;

    // Fire the round: called from the LAST pushCommand (event handler, not an
    // effect — every setState here runs in handler/async context).
    const submitRound = useCallback(async (commands: ShowdownCommand[]) => {
        setPhase("playing");
        setNetError(false);
        const response = await submitTurn(commands);
        if (response && "expired" in response) {
            // Session lapsed (45-min TTL) — a distinct dead end, not a retry.
            setExpired(true);
            return;
        }
        if (!response || !response.ok) {
            setNetError(true);
            setPhase("command");
            setDraft([]);
            return;
        }
        settlementRef.current = response;
        setSettlement(response);
        setQueue(response.events);
        setQueueIndex(0);
        if (!response.events.length && response.state) {
            // Finished session replay (e.g. payout retry) — no script to play.
            setStateView(response.state);
            setDisplay(buildDisplay(response.state));
            setLineup(lineupFromState(response.state));
            if (response.state.finished) {
                setPhase("finished");
                if (!finishedNotified.current && response.state.outcome) {
                    finishedNotified.current = true;
                    onFinished(response.state.outcome, response);
                }
            }
        }
    }, [submitTurn, onFinished]);

    // Plain handlers (not useCallback): they close over render-derived values
    // (draft, livingPlayer) and only ever run from committed-event contexts.
    const pushCommand = (command: ShowdownCommand) => {
        setNeedleFor(null);
        setPendingMove(null);
        setPickingSwitch(false);
        const nextDraft = [...draft, command];
        setDraft(nextDraft);
        // Omitting a skipped pet is safe: the engine defaults any missing
        // command to a guard, which its winded/stun branch discards anyway.
        if (nextDraft.length >= promptable.length) void submitRound(nextDraft);
    };

    const chooseMove = (moveIndex: number, superCast: boolean) => {
        if (!commander) return;
        const move = superCast ? commander.moves.find((m) => m.signature) : commander.moves[moveIndex];
        if (!move) return;
        const needsEnemy = !SELF_MOVE_KINDS.has(move.kind) && !ALLY_MOVE_KINDS.has(move.kind);
        const needsAlly = ALLY_MOVE_KINDS.has(move.kind);
        if (needsEnemy && livingEnemies.length > 1) {
            setPendingMove({ moveIndex, super: superCast });
            return;
        }
        if (needsAlly && livingPlayer.length > 1) {
            setPendingMove({ moveIndex, super: superCast });
            return;
        }
        const targetId = needsEnemy ? (livingEnemies[0]?.id ?? "") : needsAlly ? commander.id : commander.id;
        beginNeedle(commander.id, moveIndex, superCast, targetId, move.kind);
    };

    const beginNeedle = (petId: string, moveIndex: number, superCast: boolean, targetId: string, moveKind: string) => {
        // Timing expression only matters on offense; utility moves skip the needle.
        if (SELF_MOVE_KINDS.has(moveKind) || ALLY_MOVE_KINDS.has(moveKind)) {
            pushCommand(superCast ? { kind: "super", petId, targetId, timing: 0 } : { kind: "move", petId, moveIndex, targetId, timing: 0 });
            return;
        }
        setNeedleFor({ petId, moveIndex, super: superCast, targetId });
    };

    const pickTarget = (targetId: string) => {
        if (!commander || !pendingMove) return;
        const move = pendingMove.super ? commander.moves.find((m) => m.signature) : commander.moves[pendingMove.moveIndex];
        setPendingMove(null);
        beginNeedle(commander.id, pendingMove.moveIndex, pendingMove.super, targetId, move?.kind ?? "damage");
    };

    const onNeedleGrade = (grade: number) => {
        // Closure over the needle that mounted this sweep — the needle unmounts
        // the moment pushCommand clears it, so this fires at most once per sweep.
        if (!needleFor) return;
        if (grade === 2) showBanner("PERFECT!", "perfect", 600);
        pushCommand(needleFor.super
            ? { kind: "super", petId: needleFor.petId, targetId: needleFor.targetId, timing: grade }
            : { kind: "move", petId: needleFor.petId, moveIndex: needleFor.moveIndex, targetId: needleFor.targetId, timing: grade });
    };

    const outcome = stateView.outcome;
    const targetingAllies = !!pendingMove && !!commander && ALLY_MOVE_KINDS.has((pendingMove.super ? commander.moves.find((m) => m.signature) : commander.moves[pendingMove.moveIndex])?.kind ?? "");
    const panelArt = useMemo(
        () => Object.fromEntries([...slots.values()].map((i) => [i.view.id, i.fallbackImage])),
        [slots],
    );
    const playerBenchedIds = useMemo(() => new Set(lineup.playerBench), [lineup.playerBench]);
    const enemyBenchedIds = useMemo(() => new Set(lineup.enemyBench), [lineup.enemyBench]);
    const commanderMoves = commander?.moves.filter((m) => !m.signature) ?? [];
    const commanderSignature = commander?.moves.find((m) => m.signature) ?? null;

    const overlay = (
        <div className="pet-combat-takeover showdown-takeover">
            <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }} camera={{ fov: 48, position: [0, 5.2, 9.6], near: 0.1, far: 80 }}>
                <StageEnvironment stage={stage} />
                <CameraDirector beatRef={beatRef} fxRef={fxRef} posRef={posRef} />
                <BeatDrivenVfx beatRef={beatRef} posRef={posRef} />
                <SuperPillar drive={pillarDrive} />
                <ShowdownVfxLayer spawns={vfx} />
                {petBloomEnabled() && !reducedMotion && (
                    <EffectComposer>
                        <Bloom intensity={0.55} luminanceThreshold={0.62} luminanceSmoothing={0.3} mipmapBlur />
                    </EffectComposer>
                )}
                {[...slots.values()].map((info) => (
                    <ShowdownFighter
                        key={info.view.id}
                        info={info}
                        displayHp={display[info.view.id]?.hp ?? info.view.hp}
                        ko={display[info.view.id]?.ko ?? info.view.ko}
                        guarding={display[info.view.id]?.guarding ?? false}
                        statuses={display[info.view.id]?.statuses ?? []}
                        // Latches off the END EVENT, not the finished phase: the phase
                        // flips a frame AFTER the result panel mounts, so the winner
                        // used to stand in a plain idle for the whole victory beat.
                        victorious={(endOutcome ?? (phase === "finished" ? outcome : null)) === (info.side === "player" ? "win" : "loss")}
                        beatRef={beatRef}
                        fxRef={fxRef}
                        posRef={posRef}
                        popups={popups}
                        highlight={commander?.id === info.view.id ? "commander"
                            : pendingMove && ((info.side === "enemy" && !targetingAllies) || (info.side === "player" && targetingAllies)) && !(display[info.view.id]?.ko) ? "targeted"
                            : "none"}
                    />
                ))}
            </Canvas>

            {/* Cinematic letterbox during signature casts. */}
            {letterbox && (
                <div className="showdown-letterbox">
                    <div className="bar top" />
                    <div className="bar bottom" />
                </div>
            )}
            {/* Full-screen white flash on the signature detonation. */}
            {flash !== 0 && <div key={flash} className="showdown-flash" />}

            {/* Opening VS card. */}
            {intro && (
                <div className="showdown-vs-intro">
                    <div className="showdown-vs-side mine">
                        {stateView.player.map((p) => panelArt[p.id] && <img key={p.id} src={panelArt[p.id]} alt={p.name} />)}
                        <span>Your team</span>
                    </div>
                    <div className="showdown-vs-burst">VS</div>
                    <div className="showdown-vs-side theirs">
                        {stateView.enemy.map((p) => panelArt[p.id] && <img key={p.id} src={panelArt[p.id]} alt={p.name} />)}
                        <span>{stateView.enemyTeamName}</span>
                    </div>
                </div>
            )}

            {/* ── HUD ── */}
            <div className="showdown-hud">
                <div className="showdown-topbar">
                    <TeamPanel
                        side="enemy"
                        pets={stateView.enemy}
                        display={display}
                        targeting={!!pendingMove && !targetingAllies}
                        onPickTarget={pickTarget}
                        hintElement={commander?.element}
                        art={panelArt}
                        benchedIds={enemyBenchedIds}
                    />
                    <div className="showdown-topbar-right">
                        {/* stateView.round reconciles at playback end, so the round
                            IN PROGRESS (command or playing) is always round + 1. */}
                        <div className="showdown-round">R{stateView.finished ? stateView.round : Math.min(stateView.round + 1, stateView.maxRounds)}/{stateView.maxRounds}</div>
                        <div className="showdown-vs">{stateView.enemyTeamName}</div>
                        <button type="button" className="showdown-chip" onClick={() => setFast((f) => !f)}>{fast ? "▶▶ Fast" : "▶ Normal"}</button>
                        {/* The takeover hides the global menu, so this is the
                            only reachable audio control during a fight. */}
                        <button type="button" className="showdown-chip" onClick={toggleAudio}>{muted ? "🔇 Muted" : "🔊 Sound"}</button>
                        {phase !== "finished" && (
                            <button type="button" className="showdown-chip danger" onClick={() => setConfirmForfeit(true)}>Forfeit</button>
                        )}
                    </div>
                </div>

                {banner && <div key={banner.key} className={`showdown-banner ${banner.cls}`}>{banner.text}</div>}

                {/* Temtem-style turn-order strip: who acts next round, fastest first. */}
                {stateView.nextOrder && stateView.nextOrder.length > 0 && phase !== "finished" && (
                    <div className="showdown-order-strip">
                        <span className="showdown-order-label">Next</span>
                        {stateView.nextOrder.map((petId) => {
                            const pet = [...stateView.player, ...stateView.enemy].find((p) => p.id === petId);
                            if (!pet || (display[petId]?.ko ?? pet.ko)) return null;
                            const mine = stateView.player.some((p) => p.id === petId);
                            return (
                                <span
                                    key={petId}
                                    className={`showdown-order-chip ${mine ? "mine" : "theirs"}`}
                                    style={{ borderColor: ELEMENT_TINT[pet.element] ?? ELEMENT_TINT.None }}
                                    title={pet.name}
                                >
                                    {panelArt[petId]
                                        ? <img src={panelArt[petId]} alt={pet.name} />
                                        : pet.name.slice(0, 2)}
                                </span>
                            );
                        })}
                    </div>
                )}

                <div className="showdown-bottombar">
                    <TeamPanel
                        side="player"
                        pets={stateView.player}
                        display={display}
                        targeting={!!pendingMove && targetingAllies}
                        onPickTarget={pickTarget}
                        commanderId={commander?.id ?? null}
                        art={panelArt}
                        benchedIds={playerBenchedIds}
                        benchPicking={pickingSwitch}
                        onPickBench={(benchId) => {
                            if (!commander) return;
                            pushCommand({ kind: "switch", petId: commander.id, benchPetId: benchId });
                        }}
                    />
                    {phase === "command" && commander && !needleFor && (
                        <div className="showdown-deck">
                            <div className="showdown-deck-title">
                                {pickingSwitch
                                    ? <>Who takes <b>{commander.name}</b>'s place? Tap a bench card…</>
                                    : pendingMove
                                        ? <>Choose a target for <b>{commander.name}</b>…</>
                                        : commanderMustSwitch
                                            ? <><b>{commander.name}</b> loses this action — rotate it out, or hold the line.</>
                                            : <><b>{commander.name}</b> — choose an action{netError ? " (connection hiccup — try again)" : ""}</>}
                            </div>
                            {/* A stunned pet cannot act, but it MAY rotate out —
                                so it gets the switch decision and nothing else. */}
                            {!pendingMove && !pickingSwitch && commanderMustSwitch && (
                                <div className="showdown-deck-grid">
                                    <button
                                        type="button"
                                        className="showdown-move utility"
                                        disabled={!livingBench.length}
                                        onClick={() => setPickingSwitch(true)}
                                    >
                                        <span className="showdown-move-icon">🔄</span>
                                        <span className="showdown-move-name">Switch</span>
                                        <span className="showdown-move-sub">{livingBench.length ? "Send in a bench pet" : "No reserves left"}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="showdown-move utility"
                                        onClick={() => pushCommand({ kind: "guard", petId: commander.id })}
                                    >
                                        <span className="showdown-move-icon">⏭️</span>
                                        <span className="showdown-move-name">Hold the line</span>
                                        <span className="showdown-move-sub">Stay in and lose the action</span>
                                    </button>
                                </div>
                            )}
                            {!pendingMove && !pickingSwitch && !commanderMustSwitch && (
                                <div className="showdown-deck-grid">
                                    {commanderMoves.map((move, i) => {
                                        // Temtem gating: stamina + hold only — no cooldowns.
                                        const holding = move.hold > commander.readiness;
                                        const deficit = Math.max(0, move.cost - (commanderDisplay?.stamina ?? 100));
                                        const willOverexert = deficit > 0;
                                        // "acts early/late" in words — a bare ▲/▼ collides with
                                        // the element-matchup arrows on the target cards.
                                        const pace = move.priority > 1 ? "acts early" : move.priority < 1 ? "swings last" : "";
                                        return (
                                            <button
                                                key={`${move.name}-${i}`}
                                                type="button"
                                                disabled={holding}
                                                className={`showdown-move ${holding ? "cooling" : ""} ${willOverexert ? "overexert" : ""}`}
                                                style={{ borderLeft: `3px solid ${ELEMENT_TINT[commander.element] ?? ELEMENT_TINT.None}` }}
                                                onClick={() => chooseMove(i, false)}
                                            >
                                                <span className="showdown-move-icon">{KIND_ICON[move.kind] ?? "⚔️"}</span>
                                                <span className="showdown-move-name">{move.name}</span>
                                                <span className="showdown-move-sub">
                                                    {holding ? `Charging — ready round ${move.hold + 1}`
                                                        : `${move.power > 0 ? `PWR ${move.power} · ` : ""}${move.cost} STA${pace ? ` · ${pace}` : ""}`}
                                                </span>
                                                <span className="showdown-move-effect">
                                                    {willOverexert
                                                        ? `OVERDRAFT · −${deficit * 2} HP · skips next round`
                                                        : move.effect}
                                                </span>
                                            </button>
                                        );
                                    })}
                                    <button type="button" className="showdown-move utility" onClick={() => pushCommand({ kind: "guard", petId: commander.id })}>
                                        <span className="showdown-move-icon">🛡️</span>
                                        <span className="showdown-move-name">Guard</span>
                                        <span className="showdown-move-sub">Halve damage · +meter</span>
                                    </button>
                                    <button type="button" className="showdown-move utility" onClick={() => pushCommand({ kind: "rest", petId: commander.id })}>
                                        <span className="showdown-move-icon">💤</span>
                                        <span className="showdown-move-name">Catch Breath</span>
                                        <span className="showdown-move-sub">+22% STA · small heal</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="showdown-move utility"
                                        disabled={!livingBench.length}
                                        onClick={() => setPickingSwitch(true)}
                                    >
                                        <span className="showdown-move-icon">🔄</span>
                                        <span className="showdown-move-name">Switch</span>
                                        <span className="showdown-move-sub">{livingBench.length ? "Send in a bench pet" : "No reserves left"}</span>
                                    </button>
                                    {commanderSignature && (() => {
                                        const meterFull = (commanderDisplay?.meter ?? 0) >= 100;
                                        const sigHolding = commanderSignature.hold > commander.readiness;
                                        return (
                                            <button
                                                type="button"
                                                disabled={!meterFull || sigHolding}
                                                className={`showdown-move signature ${meterFull && !sigHolding ? "ready" : ""}`}
                                                onClick={() => chooseMove(-1, true)}
                                            >
                                                <span className="showdown-move-icon">⭐</span>
                                                <span className="showdown-move-name">{commanderSignature.name} ▼</span>
                                                <span className="showdown-move-sub">
                                                    {sigHolding ? `Unleashes from round ${commanderSignature.hold + 1}`
                                                        : meterFull ? "SIGNATURE READY!" : "Fill the meter"}
                                                </span>
                                            </button>
                                        );
                                    })()}
                                </div>
                            )}
                            {(draft.length > 0 || pendingMove || pickingSwitch) && (
                                <button type="button" className="showdown-chip" onClick={() => {
                                    if (pickingSwitch) { setPickingSwitch(false); return; }
                                    setPendingMove(null);
                                    setDraft((d) => d.slice(0, -1));
                                }}>
                                    ↩ {pickingSwitch ? "Cancel switch" : "Undo"}
                                </button>
                            )}
                        </div>
                    )}
                    {phase === "playing" && <div className="showdown-deck-title showdown-playing-hint">The exchange unfolds…</div>}
                </div>

                {needleFor && <TimingNeedle key={`${needleFor.petId}:${draft.length}`} onGrade={onNeedleGrade} />}

                {phase === "finished" && (
                    <div className="showdown-result">
                        <div className={`showdown-result-title ${outcome === "win" ? "win" : "loss"}`}>
                            {outcome === "win" ? "🏆 VICTORY" : "💀 DEFEAT"}
                        </div>
                        {endedByJudge && (
                            <div className="showdown-result-reason">
                                Judge's decision — the round limit was reached, so the team with more
                                remaining HP takes it. A tie goes to your opponent.
                            </div>
                        )}
                        {outcome === "win" && (settlement?.reward ?? 0) > 0 && (
                            <div className="showdown-result-reward">+{settlement?.reward} ryo</div>
                        )}
                        {outcome === "win" && settlement?.capped && (
                            <div className="showdown-result-reward capped">Daily arena reward cap reached</div>
                        )}
                        <div className="showdown-result-buttons">
                            <button type="button" className="showdown-cta" onClick={onRematch}>⚔️ Battle Again</button>
                            <button type="button" className="showdown-chip" onClick={onExit}>Leave the Showdown</button>
                        </div>
                    </div>
                )}

                {expired && (
                    <div className="showdown-result">
                        <div className="showdown-result-title loss">⏳ This Showdown expired</div>
                        <div className="showdown-result-reward capped">The session timed out on the server — no result was recorded.</div>
                        <div className="showdown-result-buttons">
                            <button type="button" className="showdown-cta" onClick={onExit}>Back to the lobby</button>
                        </div>
                    </div>
                )}

                {confirmForfeit && (
                    <div className="showdown-result">
                        <div className="showdown-result-title loss">Forfeit the battle?</div>
                        <div className="showdown-result-buttons">
                            <button type="button" className="showdown-cta danger" onClick={onForfeit}>Yes, concede</button>
                            <button type="button" className="showdown-chip" onClick={() => setConfirmForfeit(false)}>Keep fighting</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
}

// ─── Small pure helpers ──────────────────────────────────────────────────────

function buildDisplay(state: ShowdownStateView): Record<string, DisplayEntry> {
    const out: Record<string, DisplayEntry> = {};
    for (const pet of [...state.player, ...state.enemy]) {
        out[pet.id] = { hp: pet.hp, stamina: pet.stamina, meter: pet.meter, ko: pet.ko, guarding: pet.guarding, statuses: pet.statuses };
    }
    return out;
}

function applyToDisplay(
    set: React.Dispatch<React.SetStateAction<Record<string, DisplayEntry>>>,
    petId: string,
    fn: (d: DisplayEntry) => DisplayEntry,
): void {
    set((all) => (all[petId] ? { ...all, [petId]: fn(all[petId]) } : all));
}

function nameOf(state: ShowdownStateView, petId: string): string {
    return [...state.player, ...state.enemy].find((p) => p.id === petId)?.name ?? "The pet";
}

function stateMaxHp(state: ShowdownStateView, petId: string): number {
    return [...state.player, ...state.enemy].find((p) => p.id === petId)?.maxHp ?? 9999;
}
