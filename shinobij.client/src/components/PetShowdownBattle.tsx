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
import { Billboard, Html } from "@react-three/drei";
import * as THREE from "three";
import { PetModel3D, DEFAULT_PET_MODEL_FRAME, type PetModelFrame } from "./PetModel3D";
import { PetModelBoundary } from "./PetModelBoundary";
import { petCombatModel, type PetCombatModelConfig } from "../lib/pet-3d-models";
import { projectileVisual } from "../lib/pet-projectile-vfx";
import { petCardImage } from "../lib/pet-battle-anim";
import { startBattleMusic, stopBattleMusic, setBattleMusicIntensity } from "../lib/pet-music";
import type { Pet } from "../types/pet";
import type {
    ShowdownCommand,
    ShowdownEvent,
    ShowdownPetView,
    ShowdownStateView,
    ShowdownTurnResponse,
} from "../lib/pet-showdown-api";

// ─── Staging constants ───────────────────────────────────────────────────────

const PLAYER_Z = 3.6;
const ENEMY_Z = -3.6;
const SLOT_SPACING = 2.7;
const FLOOR_Y = 0;

const COLISEUM_FLOOR_URL = new URL("../assets/coliseum/coliseum-floor.webp", import.meta.url).href;
const COLISEUM_BG_URL = new URL("../assets/coliseum/coliseum-bg.webp", import.meta.url).href;

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
    shield: "🛡️", mark: "🎯", slow: "🐌", haste: "💨", crush: "💥", taunt: "📢",
};

// Moves that never point at an enemy (mirror of the server's routing).
const SELF_MOVE_KINDS = new Set(["buff", "haste", "move", "shield", "barrier", "absorb", "taunt"]);
const ALLY_MOVE_KINDS = new Set(["heal"]);

type ActionEvent = Extract<ShowdownEvent, { t: "action" }>;

function beatDurationMs(event: ShowdownEvent, speed: number): number {
    const base = event.t === "action" ? (event.super ? 3300 : (event.moveKind === "guard" || event.moveKind === "rest") ? 1200 : 2300)
        : event.t === "roundStart" ? 950
        : event.t === "skip" ? 900
        : event.t === "confused" ? 1200
        : event.t === "dot" ? 850
        : event.t === "end" ? 1700
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
    shakeUntil: number;
    shakeAmp: number;
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

// ─── Stage environment (lifted from the proven Coliseum recipe) ──────────────

function StageEnvironment() {
    const textures = useMemo(() => {
        const loader = new THREE.TextureLoader();
        const floor = loader.load(COLISEUM_FLOOR_URL);
        floor.colorSpace = THREE.SRGBColorSpace;
        const backdrop = loader.load(COLISEUM_BG_URL);
        backdrop.colorSpace = THREE.SRGBColorSpace;
        backdrop.wrapS = THREE.MirroredRepeatWrapping;
        backdrop.repeat.set(2, 1);
        return { floor, backdrop };
    }, []);
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
            <hemisphereLight args={["#8fc7ff", "#4a210d", 0.56]} />
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
            <pointLight position={[0, 3.5, 2]} intensity={12} distance={15} decay={2} color="#ff7a35" />
            <mesh position={[0, 6.0, 0]}>
                <cylinderGeometry args={[19, 19, 21, 48, 1, true, Math.PI * 0.2, Math.PI * 1.6]} />
                <meshBasicMaterial map={textures.backdrop} side={THREE.BackSide} toneMapped={false} fog={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
                <circleGeometry args={[14, 64]} />
                <meshStandardMaterial map={textures.floor} roughness={0.95} />
            </mesh>
        </group>
    );
}

// ─── Camera director ─────────────────────────────────────────────────────────

function CameraDirector({ beatRef, fxRef, slots }: {
    beatRef: React.MutableRefObject<SceneBeat>;
    fxRef: React.MutableRefObject<SceneFx>;
    slots: Map<string, FighterSlotInfo>;
}) {
    const pos = useRef(new THREE.Vector3(0, 5.2, 9.6));
    const look = useRef(new THREE.Vector3(0, 1.1, -0.4));
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
        if (beat.event && beat.event.t === "action" && beat.event.moveKind !== "guard" && beat.event.moveKind !== "rest") {
            const actor = slots.get(beat.event.actorId);
            const firstTarget = beat.event.targets[0] ? slots.get(beat.event.targets[0].id) : undefined;
            if (actor) {
                const a = new THREE.Vector3(...actor.basePos);
                const b = firstTarget ? new THREE.Vector3(...firstTarget.basePos) : a;
                const mid = a.clone().lerp(b, 0.5);
                const frac = Math.min(1, (now - beat.startedAt) / beat.durationMs);
                if (beat.event.super) {
                    // Signature: swoop from the actor's shoulder into the impact.
                    const behind = a.clone().sub(b).normalize().multiplyScalar(3.4);
                    targetPos = a.clone().add(behind).add(new THREE.Vector3(1.6 - frac * 1.1, 2.0 + frac * 0.6, 0));
                    targetLook = frac < 0.45 ? a.clone().setY(1.2) : b.clone().setY(1.1);
                } else {
                    // Standard action: pull toward the duel axis, framing both.
                    const sideways = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(5.6);
                    if (sideways.lengthSq() < 0.1) sideways.set(5.6, 0, 0);
                    targetPos = mid.clone().add(sideways).add(new THREE.Vector3(0, 3.1, 2.2));
                    targetLook = mid.clone().setY(1.1);
                }
            }
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

function ShowdownFighter({ info, displayHp, ko, victorious, beatRef, fxRef, slots, popups, highlight }: {
    info: FighterSlotInfo;
    displayHp: number;
    ko: boolean;
    victorious: boolean;
    beatRef: React.MutableRefObject<SceneBeat>;
    fxRef: React.MutableRefObject<SceneFx>;
    slots: Map<string, FighterSlotInfo>;
    popups: PopupEntry[];
    highlight: "none" | "commander" | "targeted";
}) {
    const group = useRef<THREE.Group>(null);
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

    useFrame(() => {
        const f = frame.current;
        const beat = beatRef.current;
        const fx = fxRef.current;
        const now = performance.now();
        const base = info.basePos;
        let px = base[0], pz = base[2];
        const py = base[1];
        let faceX = 0, faceZ = info.side === "player" ? -1 : 1;
        f.moving = false;
        f.speed = 0;
        f.casting = false;

        const lastHit = fx.hitAt.get(info.view.id) ?? 0;
        const sinceHit = now - lastHit;

        if (ko) {
            f.motion = "dead";
            f.victorious = false;
        } else if (beat.event && beat.event.t === "action" && beat.event.actorId === info.view.id
            && beat.event.moveKind !== "guard" && beat.event.moveKind !== "rest") {
            const ev = beat.event as ActionEvent;
            const frac = Math.min(1, (now - beat.startedAt) / beat.durationMs);
            const targetInfo = ev.targets[0] ? slots.get(ev.targets[0].id) : undefined;
            if (targetInfo && targetInfo.view.id !== info.view.id) {
                const dx = targetInfo.basePos[0] - base[0];
                const dz = targetInfo.basePos[2] - base[2];
                const len = Math.hypot(dx, dz) || 1;
                faceX = dx / len; faceZ = dz / len;
                if (ev.delivery === "melee") {
                    // Approach → strike at contact → spring back.
                    const reach = Math.max(0, len - 1.4);
                    const drive = frac < 0.32 ? 0
                        : frac < 0.5 ? (frac - 0.32) / 0.18
                        : frac < 0.68 ? 1
                        : Math.max(0, 1 - (frac - 0.68) / 0.24);
                    px = base[0] + faceX * reach * drive;
                    pz = base[2] + faceZ * reach * drive;
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
        } else {
            f.motion = "idle";
            f.hit = 0;
        }
        f.faceX = faceX;
        f.faceZ = faceZ;
        f.victorious = victorious && !ko;
        f.desperate = !ko && displayHp / Math.max(1, info.view.maxHp) < 0.25;
        if (group.current) group.current.position.set(px, py, pz);
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

// ─── Projectile ──────────────────────────────────────────────────────────────

function ProjectileFx({ beatRef, slots }: {
    beatRef: React.MutableRefObject<SceneBeat>;
    slots: Map<string, FighterSlotInfo>;
}) {
    const mesh = useRef<THREE.Mesh>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const glow = useRef<THREE.Mesh>(null);
    useFrame(() => {
        const beat = beatRef.current;
        const m = mesh.current;
        const g = glow.current;
        if (!m || !g) return;
        let visible = false;
        if (beat.event?.t === "action" && beat.event.delivery === "ranged" && beat.event.targets.length
            && beat.event.moveKind !== "heal") {
            const ev = beat.event as ActionEvent;
            const actor = slots.get(ev.actorId);
            const target = slots.get(ev.targets[0].id);
            if (actor && target) {
                const frac = (performance.now() - beat.startedAt) / beat.durationMs;
                const t0 = 0.36, t1 = STRIKE_FRAC;
                if (frac >= t0 && frac <= t1) {
                    const p = (frac - t0) / (t1 - t0);
                    const a = new THREE.Vector3(actor.basePos[0], 1.25, actor.basePos[2]);
                    const b = new THREE.Vector3(target.basePos[0], 1.15, target.basePos[2]);
                    const pos = a.lerp(b, p);
                    pos.y += Math.sin(p * Math.PI) * 0.55;
                    m.position.copy(pos);
                    g.position.copy(pos);
                    const visual = projectileVisual({ element: ev.element, kind: ev.moveKind, charged: ev.super });
                    if (mat.current) mat.current.color.set(visual.glow);
                    const s = visual.size * (ev.super ? 1.5 : 1.1);
                    m.scale.setScalar(s);
                    g.scale.setScalar(s * 2.4);
                    visible = true;
                }
            }
        }
        m.visible = visible;
        g.visible = visible;
    });
    return (
        <group>
            <mesh ref={mesh} visible={false}>
                <sphereGeometry args={[1, 16, 16]} />
                <meshBasicMaterial ref={mat} color="#ffffff" toneMapped={false} />
            </mesh>
            <mesh ref={glow} visible={false}>
                <sphereGeometry args={[1, 12, 12]} />
                <meshBasicMaterial color="#ffffff" transparent opacity={0.22} toneMapped={false} />
            </mesh>
        </group>
    );
}

// ─── Timing needle (DOM) ─────────────────────────────────────────────────────

function TimingNeedle({ onGrade }: { onGrade: (grade: number) => void }) {
    const [pos, setPos] = useState(0);
    const raf = useRef(0);
    const start = useRef<number | null>(null);
    const done = useRef(false);
    const SWEEP_MS = 1100;
    useEffect(() => {
        // Lazy-init so the sweep clock starts on mount, not in render — and
        // survives parent re-renders mid-sweep without restarting.
        if (start.current === null) start.current = performance.now();
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
        <button type="button" className="showdown-needle" onPointerDown={tap}>
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

interface DisplayEntry { hp: number; stamina: number; meter: number; ko: boolean; statuses: { kind: string; rounds: number }[] }

function TeamPanel({ side, pets, display, targeting, onPickTarget, commanderId }: {
    side: "player" | "enemy";
    pets: ShowdownPetView[];
    display: Record<string, DisplayEntry>;
    targeting: boolean;
    onPickTarget?: (petId: string) => void;
    commanderId?: string | null;
}) {
    return (
        <div className={`showdown-team-panel ${side}`}>
            {pets.map((pet) => {
                const d = display[pet.id] ?? { hp: pet.hp, stamina: pet.stamina, meter: pet.meter, ko: pet.ko, statuses: pet.statuses };
                const clickable = targeting && !d.ko;
                return (
                    <button
                        key={pet.id}
                        type="button"
                        disabled={!clickable}
                        onClick={clickable && onPickTarget ? () => onPickTarget(pet.id) : undefined}
                        className={[
                            "showdown-pet-card",
                            d.ko ? "ko" : "",
                            clickable ? "targetable" : "",
                            commanderId === pet.id ? "commanding" : "",
                        ].join(" ")}
                    >
                        <div className="showdown-pet-card-head">
                            <span className="showdown-pet-name">{pet.name}</span>
                            <span className="showdown-pet-level">Lv {pet.level}</span>
                            <span className="showdown-pet-element" style={{ color: ELEMENT_TINT[pet.element] ?? ELEMENT_TINT.None }}>
                                {pet.element !== "None" ? pet.element : ""}
                            </span>
                        </div>
                        <div className="showdown-bar hp"><div style={{ width: `${Math.max(0, (d.hp / Math.max(1, pet.maxHp)) * 100)}%` }} /></div>
                        <div className="showdown-bar stamina"><div style={{ width: `${Math.max(0, d.stamina)}%` }} /></div>
                        <div className={`showdown-bar meter ${d.meter >= 100 ? "full" : ""}`}><div style={{ width: `${Math.max(0, d.meter)}%` }} /></div>
                        {d.statuses.length > 0 && (
                            <div className="showdown-statuses">
                                {d.statuses.map((s) => <span key={s.kind} title={s.kind}>{STATUS_LABEL[s.kind] ?? "✦"}</span>)}
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
    submitTurn: (commands: ShowdownCommand[]) => Promise<ShowdownTurnResponse | null>;
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
    const [settlement, setSettlement] = useState<ShowdownTurnResponse | null>(null);

    // Command drafting.
    const [draft, setDraft] = useState<ShowdownCommand[]>([]);
    const [pendingMove, setPendingMove] = useState<{ moveIndex: number; super: boolean } | null>(null);
    const [needleFor, setNeedleFor] = useState<{ petId: string; moveIndex: number; super: boolean; targetId: string } | null>(null);

    const settlementRef = useRef<ShowdownTurnResponse | null>(null);
    const finishedNotified = useRef(false);
    const popupKey = useRef(1);
    const timeouts = useRef<number[]>([]);
    const speed = fast ? 2.1 : 1;

    const beatRef = useRef<SceneBeat>({ event: null, startedAt: 0, durationMs: 1 });
    const fxRef = useRef<SceneFx>({ hitAt: new Map(), shakeUntil: 0, shakeAmp: 0, superFocus: false });

    // ── Fullscreen overlay + body scroll lock + music ───────────────────────
    useEffect(() => {
        document.body.classList.add("pet-combat-active");
        startBattleMusic("standard");
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
            showBanner(`Round ${event.round}`, "round", durationMs * 0.8);
        } else if (event.t === "skip") {
            const name = nameOf(stateView, event.actorId);
            showBanner(event.reason === "winded" ? `${name} is winded!` : event.reason === "stun" ? `${name} is stunned!` : `${name} is frozen solid!`, "status", durationMs * 0.85);
        } else if (event.t === "confused") {
            const name = nameOf(stateView, event.actorId);
            showBanner(`${name} hurt itself in confusion!`, "status", durationMs * 0.85);
            later(() => {
                addPopup(event.actorId, `-${event.selfDamage}`, "damage");
                applyToDisplay(setDisplay, event.actorId, (d) => ({ ...d, hp: Math.max(0, d.hp - event.selfDamage), ko: event.ko }));
                fxRef.current.hitAt.set(event.actorId, performance.now());
            }, durationMs * 0.5);
        } else if (event.t === "dot") {
            later(() => {
                addPopup(event.targetId, `-${event.damage}`, "dot");
                applyToDisplay(setDisplay, event.targetId, (d) => ({ ...d, hp: Math.max(0, d.hp - event.damage), ko: event.ko }));
            }, durationMs * 0.35);
        } else if (event.t === "end") {
            later(() => {
                showBanner(event.outcome === "win" ? "VICTORY!" : "DEFEAT", event.outcome === "win" ? "victory" : "defeat", 2400 / speed);
            }, durationMs * 0.2);
        } else if (event.t === "action") {
            if (event.super) {
                showBanner(`⭐ ${event.moveName}!`, "super", durationMs * 0.6);
                setBattleMusicIntensity("climax");
            }
            // Strike moment: damage numbers, HP drains, shake, effectiveness call.
            later(() => {
                let anyKo = false;
                let bestEffect: "super" | "weak" | null = null;
                for (const target of event.targets) {
                    if (target.damage > 0) {
                        addPopup(target.id, `-${target.damage}`, target.guarded ? "guarded" : event.super ? "super" : "damage");
                        fxRef.current.hitAt.set(target.id, performance.now());
                        if (target.effectiveness === "super") bestEffect = "super";
                        else if (target.effectiveness === "weak" && bestEffect !== "super") bestEffect = "weak";
                    }
                    if (target.heal > 0) addPopup(target.id, `+${target.heal}`, "heal");
                    if (target.applied && target.damage === 0 && target.heal === 0) addPopup(target.id, KIND_ICON[target.applied] ?? "✦", "status");
                    anyKo = anyKo || target.ko;
                    applyToDisplay(setDisplay, target.id, (d) => ({
                        ...d,
                        hp: Math.max(0, Math.min(stateMaxHp(stateView, target.id), d.hp - target.damage + target.heal)),
                        ko: target.ko,
                    }));
                }
                applyToDisplay(setDisplay, event.actorId, (d) => ({ ...d, stamina: event.staminaAfter, meter: event.meterAfter }));
                const totalDamage = event.targets.reduce((sum, t) => sum + t.damage, 0);
                if (totalDamage > 0) {
                    fxRef.current.shakeUntil = performance.now() + (event.super ? 460 : 300);
                    fxRef.current.shakeAmp = event.super ? 0.34 : Math.min(0.24, 0.08 + totalDamage / 900);
                }
                if (event.timing === 2 && event.actorSide === "player") showBanner("PERFECT!", "perfect", 750 / speed);
                else if (bestEffect === "super") showBanner("Super effective!", "effective", 900 / speed);
                else if (bestEffect === "weak") showBanner("Not very effective…", "weak", 900 / speed);
                if (anyKo) later(() => showBanner("KO!", "ko", 900 / speed), 220);
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
    const livingPlayer = stateView.player.filter((p) => !(display[p.id]?.ko ?? p.ko));
    const livingEnemies = stateView.enemy.filter((p) => !(display[p.id]?.ko ?? p.ko));
    const commander = phase === "command" ? livingPlayer[draft.length] ?? null : null;
    const commanderDisplay = commander ? display[commander.id] : null;

    // Fire the round: called from the LAST pushCommand (event handler, not an
    // effect — every setState here runs in handler/async context).
    const submitRound = useCallback(async (commands: ShowdownCommand[]) => {
        setPhase("playing");
        setNetError(false);
        const response = await submitTurn(commands);
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
        const nextDraft = [...draft, command];
        setDraft(nextDraft);
        if (nextDraft.length >= livingPlayer.length) void submitRound(nextDraft);
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
    const commanderMoves = commander?.moves.filter((m) => !m.signature) ?? [];
    const commanderSignature = commander?.moves.find((m) => m.signature) ?? null;

    const overlay = (
        <div className="pet-combat-takeover showdown-takeover">
            <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }} camera={{ fov: 48, position: [0, 5.2, 9.6], near: 0.1, far: 80 }}>
                <StageEnvironment />
                <CameraDirector beatRef={beatRef} fxRef={fxRef} slots={slots} />
                <ProjectileFx beatRef={beatRef} slots={slots} />
                {[...slots.values()].map((info) => (
                    <ShowdownFighter
                        key={info.view.id}
                        info={info}
                        displayHp={display[info.view.id]?.hp ?? info.view.hp}
                        ko={display[info.view.id]?.ko ?? info.view.ko}
                        victorious={phase === "finished" && outcome === (info.side === "player" ? "win" : "loss")}
                        beatRef={beatRef}
                        fxRef={fxRef}
                        slots={slots}
                        popups={popups}
                        highlight={commander?.id === info.view.id ? "commander"
                            : pendingMove && ((info.side === "enemy" && !targetingAllies) || (info.side === "player" && targetingAllies)) && !(display[info.view.id]?.ko) ? "targeted"
                            : "none"}
                    />
                ))}
            </Canvas>

            {/* ── HUD ── */}
            <div className="showdown-hud">
                <div className="showdown-topbar">
                    <TeamPanel
                        side="enemy"
                        pets={stateView.enemy}
                        display={display}
                        targeting={!!pendingMove && !targetingAllies}
                        onPickTarget={pickTarget}
                    />
                    <div className="showdown-topbar-right">
                        {/* stateView.round reconciles at playback end, so the round
                            IN PROGRESS (command or playing) is always round + 1. */}
                        <div className="showdown-round">R{stateView.finished ? stateView.round : Math.min(stateView.round + 1, stateView.maxRounds)}/{stateView.maxRounds}</div>
                        <div className="showdown-vs">{stateView.enemyTeamName}</div>
                        <button type="button" className="showdown-chip" onClick={() => setFast((f) => !f)}>{fast ? "▶▶ Fast" : "▶ Normal"}</button>
                        {phase !== "finished" && (
                            <button type="button" className="showdown-chip danger" onClick={() => setConfirmForfeit(true)}>Forfeit</button>
                        )}
                    </div>
                </div>

                {banner && <div key={banner.key} className={`showdown-banner ${banner.cls}`}>{banner.text}</div>}

                <div className="showdown-bottombar">
                    <TeamPanel
                        side="player"
                        pets={stateView.player}
                        display={display}
                        targeting={!!pendingMove && targetingAllies}
                        onPickTarget={pickTarget}
                        commanderId={commander?.id ?? null}
                    />
                    {phase === "command" && commander && !needleFor && (
                        <div className="showdown-deck">
                            <div className="showdown-deck-title">
                                {pendingMove
                                    ? <>Choose a target for <b>{commander.name}</b>…</>
                                    : <><b>{commander.name}</b> — choose an action{netError ? " (connection hiccup — try again)" : ""}</>}
                            </div>
                            {!pendingMove && (
                                <div className="showdown-deck-grid">
                                    {commanderMoves.map((move, i) => {
                                        const cooling = move.currentCooldown > 0;
                                        const willOverexert = (commanderDisplay?.stamina ?? 100) < move.cost;
                                        return (
                                            <button
                                                key={`${move.name}-${i}`}
                                                type="button"
                                                disabled={cooling}
                                                className={`showdown-move ${cooling ? "cooling" : ""} ${willOverexert ? "overexert" : ""}`}
                                                onClick={() => chooseMove(i, false)}
                                            >
                                                <span className="showdown-move-icon">{KIND_ICON[move.kind] ?? "⚔️"}</span>
                                                <span className="showdown-move-name">{move.name}</span>
                                                <span className="showdown-move-sub">
                                                    {cooling ? `Ready in ${move.currentCooldown}` : `${move.power > 0 ? `PWR ${move.power} · ` : ""}${move.cost} STA${willOverexert ? " ⚠" : ""}`}
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
                                        <span className="showdown-move-sub">+45 STA · small heal</span>
                                    </button>
                                    {commanderSignature && (
                                        <button
                                            type="button"
                                            disabled={(commanderDisplay?.meter ?? 0) < 100}
                                            className={`showdown-move signature ${(commanderDisplay?.meter ?? 0) >= 100 ? "ready" : ""}`}
                                            onClick={() => chooseMove(-1, true)}
                                        >
                                            <span className="showdown-move-icon">⭐</span>
                                            <span className="showdown-move-name">{commanderSignature.name}</span>
                                            <span className="showdown-move-sub">{(commanderDisplay?.meter ?? 0) >= 100 ? "SIGNATURE READY!" : "Fill the meter"}</span>
                                        </button>
                                    )}
                                </div>
                            )}
                            {(draft.length > 0 || pendingMove) && (
                                <button type="button" className="showdown-chip" onClick={() => { setPendingMove(null); setDraft((d) => d.slice(0, -1)); }}>
                                    ↩ Undo
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
        out[pet.id] = { hp: pet.hp, stamina: pet.stamina, meter: pet.meter, ko: pet.ko, statuses: pet.statuses };
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
