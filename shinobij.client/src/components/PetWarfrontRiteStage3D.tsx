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
 * Hollow Warfront — the Rite clash stage.
 *
 * EIGHT pets fight at once here, four a side, and the camera's job is to keep
 * that readable rather than to admire it from orbit. The retired lane war fitted
 * an orthographic camera to a 70x39 plate and rendered every pet at ~2% of
 * screen height, so the rigs, the toon shader and every VFX in the project were
 * below the resolution of the shot.
 *
 * The camera therefore tracks the LIVING cloud: it frames the fighters still
 * standing and tightens as they fall, so the end of a clash becomes a close
 * two-body shot on its own without anyone scripting a cut. Framing uses the same
 * `fitDistance` solver the Showdown camera uses — a hand-tuned distance put the
 * lens inside a fighter.
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
import { Suspense, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sparkles, useTexture } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Pet } from "../types/pet";
import { ARENA_X, DUEL_TPS, type DuelResult } from "../lib/pet-duel-sim";
import { petCombatModel } from "../lib/pet-3d-models";
import { petModelVariantSurface } from "../lib/pet-visual-variant";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import { fitDistance } from "../lib/showdown-camera";
import {
    RITE_TEAM_COLOR as TEAM_COLOR,
    RITE_WORLD_SCALE as WORLD_SCALE,
    actionFocus,
    bucketEvents,
    elementColor,
    lethalTick,
    sampleActor,
} from "../lib/pet-warfront-rite-presentation";
import type { PetVisualQualityConfig } from "../lib/pet-visual-quality";
import riteFloorArt from "../assets/warfront-rite/warfront-rite-floor.webp";

/** One rendered fighter: which side, which lane, and the pet standing in it. */
export type StageFighter = {
    team: "player" | "enemy";
    lane: number;
    pet: Pet;
    /** 0..1 health it walked in with — the bar starts here and drains. */
    entryHp: number;
};

// ── Fighter ─────────────────────────────────────────────────────────────────

function PetFallback({ height, color }: { height: number; color: string }) {
    return (
        <mesh position={[0, height * 0.48, 0]} castShadow>
            <capsuleGeometry args={[height * 0.22, height * 0.5, 6, 12]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.34} roughness={0.5} />
        </mesh>
    );
}

function RiteFighter3D({ result, fighter, clockRef, victorious }: {
    result: DuelResult;
    fighter: StageFighter;
    clockRef: MutableRefObject<number>;
    victorious: MutableRefObject<{ player: boolean; enemy: boolean }>;
}) {
    const { team, lane, pet, entryHp } = fighter;
    const config = useMemo(() => petCombatModel(pet), [pet]);
    const root = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const frame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const lastHp = useRef(1);
    const lastPos = useRef<{ x: number; z: number; t: number } | null>(null);
    const deathAt = useRef<number | null>(null);
    // Eight rigs share one frame, so each is a little smaller than a duel's two
    // would be — they still read individually, and the squad fits the shot.
    const scale = config ? Math.min(1.15, 2.0 / Math.max(0.1, config.targetHeight)) : 1;
    const height = config ? config.targetHeight * scale : 1.5;
    const facing = team === "player" ? 1 : -1;

    useFrame(() => {
        const group = root.current;
        if (!group) return;
        const t = clockRef.current;
        const pose = sampleActor(result, team, lane, t);
        group.position.x = pose.x * WORLD_SCALE;
        group.position.z = pose.z * WORLD_SCALE;

        const previous = lastHp.current;
        const hpFrac = pose.maxHp > 0 ? pose.hp / pose.maxHp : 0;
        const down = pose.hp <= 0 || pose.state === "dead";
        if (down && deathAt.current === null) deathAt.current = t;

        // Locomotion is NOT a sim state — a fighter walks and circles while it is
        // nominally idle or recovering. Speed therefore comes from the
        // interpolated positions, which is exact because the interpolation is.
        const prior = lastPos.current;
        let vx = 0;
        let vz = 0;
        if (prior && t > prior.t) {
            const dt = (t - prior.t) / DUEL_TPS;
            if (dt > 1e-4) {
                vx = (pose.x - prior.x) / dt;
                vz = (pose.z - prior.z) / dt;
            }
        }
        lastPos.current = { x: pose.x, z: pose.z, t };
        const speed = Math.hypot(vx, vz);

        const striking = pose.state === "strike" || pose.state === "windup";
        const moving = !down && !striking && speed > 0.45;
        const f = frame.current;
        f.motion = down ? "dead"
            : striking ? "strike"
            : pose.state === "dash" ? "dash"
            : pose.state === "stagger" ? "stagger"
            : pose.state === "dodge" ? "dodge"
            : moving ? "run" : "idle";
        f.moving = moving;
        f.speed = Math.min(9, speed);
        f.moveX = speed > 0.05 ? vx : pose.faceX || facing;
        f.moveZ = speed > 0.05 ? vz : pose.faceZ;
        f.faceX = Math.abs(pose.faceX) > 0.05 ? pose.faceX : facing;
        f.faceZ = pose.faceZ;
        f.lockTargetFacing = true;
        f.hit = hpFrac < previous - 0.0005 ? 1 : Math.max(0, f.hit * 0.86);
        f.impactPower = pose.state === "strike" ? 0.92 : 0.58;
        // "windup" is the telegraph beat — the half-second the camera cuts on.
        f.casting = pose.state === "windup";
        // The wound a pet walked in with counts toward desperation, or a fighter
        // returning at 45% would look fresh until it was nearly dead again.
        f.desperate = !down && hpFrac * entryHp < 0.3;
        f.statuses = pose.statuses;
        f.victorious = victorious.current[team] && !down;
        f.timeline = t / DUEL_TPS;
        lastHp.current = hpFrac;

        if (body.current) {
            // Death is the loudest event in the mode: sink and shrink the rig
            // over ~0.9s rather than popping it out of existence.
            const fade = deathAt.current === null ? 0 : Math.min(1, Math.max(0, (t - deathAt.current) / (DUEL_TPS * 0.9)));
            body.current.position.y = -fade * height * 0.45;
            body.current.scale.setScalar(Math.max(0.001, 1 - fade * 0.35));
            body.current.visible = fade < 0.995;
        }
    });

    return (
        <group ref={root}>
            <group ref={body}>
                {config ? (
                    <Suspense fallback={<PetFallback height={height} color={TEAM_COLOR[team]} />}>
                        <group scale={scale}>
                            <PetModel3D
                                config={config}
                                frame={frame as MutableRefObject<PetModelFrame>}
                                element={pet.element}
                                surfaceTreatment={petModelVariantSurface(pet)}
                            />
                        </group>
                    </Suspense>
                ) : <PetFallback height={height} color={TEAM_COLOR[team]} />}
            </group>
            {/* TEAM IDENTITY is the hardest read in a squad clash: eight bodies
                interleave, and the player has a fraction of a second to tell
                theirs from the enemy's. A thin ring was not enough, so each pet
                stands on a filled team-coloured pool with a bright rim, and takes
                a team-coloured rim light from below. Element colour moved to a
                dimmer overhead light so it flavours the body without ever
                competing with whose side it is on. */}
            <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[height * 0.46, 28]} />
                <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={0.16} depthWrite={false} />
            </mesh>
            <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[height * 0.4, height * 0.5, 32]} />
                <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={0.85} depthWrite={false} />
            </mesh>
            {/* NO per-fighter lights. Eight rigs each carrying a team light and an
                element light put TWENTY-TWO dynamic lights in the scene, and every
                material is evaluated against all of them: measured playback
                collapsed to 3.6 sim-ticks per second against a 30-tick budget —
                eight-times slow motion. The unlit ground pool, the ring and the
                two side lights already carry team and element identity, and they
                cost nothing per fighter. */}
        </group>
    );
}

// ── Impact VFX ──────────────────────────────────────────────────────────────

type ImpactSlot = { active: boolean; t: number; x: number; z: number; color: string; crit: boolean };

function ImpactRing({ slot, clockRef }: { slot: MutableRefObject<ImpactSlot>; clockRef: MutableRefObject<number> }) {
    const mesh = useRef<THREE.Mesh>(null);
    const material = useRef<THREE.MeshBasicMaterial>(null);
    useFrame(() => {
        const node = mesh.current;
        const mat = material.current;
        const s = slot.current;
        if (!node || !mat) return;
        if (!s.active) { node.visible = false; return; }
        const age = (clockRef.current - s.t) / DUEL_TPS;
        const life = s.crit ? 0.52 : 0.34;
        if (age < 0 || age > life) { node.visible = false; s.active = false; return; }
        const k = age / life;
        node.visible = true;
        node.position.set(s.x, 0.55, s.z);
        node.scale.setScalar((s.crit ? 1.5 : 0.85) * (0.25 + k * 1.5));
        mat.color.set(s.color);
        mat.opacity = (1 - k) * (s.crit ? 0.95 : 0.7);
    });
    return (
        <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
            <ringGeometry args={[0.32, 0.5, 24]} />
            <meshBasicMaterial ref={material} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
        </mesh>
    );
}

/** Drives the impact pool from the event stream, one bucket lookup per frame.
 *  A squad clash lands far more hits than a duel, so the pool is deeper. */
function ImpactLayer({ result, clockRef, quality }: {
    result: DuelResult;
    clockRef: MutableRefObject<number>;
    quality: PetVisualQualityConfig;
}) {
    const capacity = quality.impactSparks > 0 ? 12 : 6;
    const slots = useMemo<MutableRefObject<ImpactSlot>[]>(
        () => Array.from({ length: capacity }, () => ({ current: { active: false, t: -1, x: 0, z: 0, color: "#fff", crit: false } })),
        [capacity],
    );
    const byTick = useMemo(() => bucketEvents(result.events), [result]);
    const lastTick = useRef(-1);
    const cursor = useRef(0);

    useFrame(() => {
        const tick = Math.floor(clockRef.current);
        if (tick === lastTick.current) return;
        // Catch up over any ticks the frame skipped, so a dropped frame never
        // silently swallows a hit's VFX.
        const from = lastTick.current < 0 || tick < lastTick.current ? tick : lastTick.current + 1;
        for (let t = from; t <= tick; t++) {
            const events = byTick.get(t);
            if (!events) continue;
            for (const event of events) {
                if (event.type !== "hit" || !event.dmg || !event.targetId) continue;
                const [team, laneText] = String(event.targetId).split("-");
                const lane = Number(laneText);
                if ((team !== "player" && team !== "enemy") || !Number.isInteger(lane)) continue;
                const pose = sampleActor(result, team, lane, t);
                const slot = slots[cursor.current % slots.length];
                cursor.current++;
                slot.current.active = true;
                slot.current.t = t;
                slot.current.x = pose.x * WORLD_SCALE;
                slot.current.z = pose.z * WORLD_SCALE;
                slot.current.color = event.crit ? "#fff3c4" : elementColor(event.element);
                slot.current.crit = Boolean(event.crit);
            }
        }
        lastTick.current = tick;
    });

    return <>{slots.map((slot, i) => <ImpactRing key={i} slot={slot} clockRef={clockRef} />)}</>;
}

// ── Camera ──────────────────────────────────────────────────────────────────

/**
 * The director. A squad clash has no single pair to shoot, so the camera frames
 * the cloud of fighters still STANDING and tightens as they fall — the finish of
 * a clash becomes a close two-body shot on its own, without a scripted cut.
 *
 * It also orbits perpendicular to the battle line. A camera on a fixed axis sees
 * separate bodies only while they happen to be spread across it; the moment the
 * lines interleave along the view direction they read as one mass.
 */
function ClashCamera({ result, clockRef, quality, reducedMotion }: {
    result: DuelResult;
    clockRef: MutableRefObject<number>;
    quality: PetVisualQualityConfig;
    reducedMotion: boolean;
}) {
    const camera = useThree((state) => state.camera);
    const viewport = useThree((state) => state.size);
    const look = useRef(new THREE.Vector3(0, 0.85, 0));
    const pos = useRef(new THREE.Vector3(0, 6, 12));
    const shake = useRef(0);
    const lastHp = useRef(99);
    const lastPerp = useRef({ x: 0, z: 1 });
    const ko = useMemo(() => lethalTick(result), [result]);
    const portrait = viewport.height > viewport.width;

    useFrame((_state, delta) => {
        const t = clockRef.current;
        const focus = actionFocus(result, t);
        const midX = focus.x * WORLD_SCALE;
        const midZ = focus.z * WORLD_SCALE;
        const spread = focus.radius * WORLD_SCALE;

        const nearLethal = ko !== null && t > ko - DUEL_TPS * 0.6 && t < ko + DUEL_TPS * 1.6;
        // Half-extents about the look point: the living cloud's radius plus a
        // body either side, and a pet's height plus headroom for element work.
        const horiz = spread + 1.5;
        const vert = 2.1;
        const fov = (camera as THREE.PerspectiveCamera).fov ?? 42;
        const aspect = Math.max(0.35, viewport.width / Math.max(1, viewport.height));
        const framing = fitDistance(horiz, vert, fov, aspect) * (portrait ? 1.2 : 1);
        const dist = framing * (nearLethal ? 0.92 : 1);

        // Orbit perpendicular to the battle line so the two sides never stack
        // along the view axis and collapse into one silhouette.
        const blue = sampleActor(result, "player", 0, t);
        const red = sampleActor(result, "enemy", 0, t);
        const dx = (red.x - blue.x) * WORLD_SCALE;
        const dz = (red.z - blue.z) * WORLD_SCALE;
        const span = Math.hypot(dx, dz);
        if (span > 0.35) {
            let nextX = -dz / span;
            let nextZ = dx / span;
            if (nextZ < 0) { nextX = -nextX; nextZ = -nextZ; }
            lastPerp.current = { x: nextX, z: nextZ };
        }
        const perpX = lastPerp.current.x;
        const perpZ = lastPerp.current.z;

        const targetX = midX + perpX * dist;
        const targetZ = midZ + perpZ * dist;
        // Elevation is a fraction of the fitted distance, so the down-angle
        // stays constant instead of steepening as the shot tightens.
        const targetY = dist * (nearLethal ? 0.3 : 0.36);

        // Frame-rate independent easing; NEVER a snap. The lane war rescaled
        // world speed by 2.3x with no easing on every kill and it read as a bug.
        const ease = 1 - Math.pow(0.006, Math.min(0.05, delta));
        pos.current.x += (targetX - pos.current.x) * ease;
        pos.current.y += (targetY - pos.current.y) * ease;
        pos.current.z += (targetZ - pos.current.z) * ease;
        look.current.x += (midX - look.current.x) * ease;
        look.current.y += (0.95 - look.current.y) * ease;
        look.current.z += (midZ - look.current.z) * ease;

        // Impact shake, driven by total health lost across the whole board.
        let totalHp = 0;
        const snap = result.snapshots[Math.max(0, Math.min(result.snapshots.length - 1, Math.floor(t)))];
        for (const actor of snap?.actors ?? []) totalHp += actor.maxHp > 0 ? actor.hp / actor.maxHp : 0;
        if (totalHp < lastHp.current - 0.02) shake.current = Math.min(1, shake.current + 0.5);
        lastHp.current = totalHp;
        shake.current = Math.max(0, shake.current - delta * 3.4);

        camera.position.copy(pos.current);
        if (!reducedMotion && shake.current > 0.001 && quality.bloomIntensity > 0) {
            const amp = shake.current * 0.075;
            const now = t * 0.9;
            camera.position.x += Math.sin(now * 2.7) * amp;
            camera.position.y += Math.sin(now * 3.3 + 1.7) * amp * 0.8;
        }
        camera.lookAt(look.current);
    });
    return null;
}

// ── Stage ───────────────────────────────────────────────────────────────────

function Ground({ quality }: { quality: PetVisualQualityConfig }) {
    const r = ARENA_X * WORLD_SCALE;
    // The authored arena plate. It is a radial composition with a centred sigil,
    // so it maps onto the flat circle without a seam; the code-authored rings
    // below stay on top because they are the ones that must read at any zoom.
    const source = useTexture(riteFloorArt);
    const texture = useMemo(() => {
        const next = source.clone();
        next.colorSpace = THREE.SRGBColorSpace;
        next.anisotropy = quality.textureAnisotropy;
        next.needsUpdate = true;
        return next;
    }, [source, quality.textureAnisotropy]);
    useEffect(() => () => texture.dispose(), [texture]);
    return (
        <group>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
                <circleGeometry args={[r * 1.02, 64]} />
                <meshStandardMaterial map={texture} color="#8fa6b4" roughness={0.94} metalness={0.04} />
            </mesh>
            {/* The Rite seal: the ring the clash is fought inside. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
                <ringGeometry args={[r * 0.76, r * 0.8, 72]} />
                <meshBasicMaterial color="#6fd7ef" transparent opacity={0.22} depthWrite={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
                <ringGeometry args={[r * 0.95, r * 0.98, 72]} />
                <meshBasicMaterial color="#6fd7ef" transparent opacity={0.12} depthWrite={false} />
            </mesh>
            {/* The seam the two bands meet across. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
                <planeGeometry args={[0.06, r * 1.7]} />
                <meshBasicMaterial color="#6fd7ef" transparent opacity={0.1} depthWrite={false} />
            </mesh>
        </group>
    );
}

function Scene({ result, fighters, clockRef, quality, winnerRef, reducedMotion }: PetWarfrontRiteStage3DProps) {
    const blueLight = elementColor(fighters.find((f) => f.team === "player")?.pet.element);
    const redLight = elementColor(fighters.find((f) => f.team === "enemy")?.pet.element);
    return (
        <>
            <color attach="background" args={["#070d14"]} />
            <fog attach="fog" args={["#070d14", 16, 34]} />
            {/* A dark-furred pet against a dark void is the readability trap this
                mode exists to avoid, so the rigs are lit from four sides: a
                bright ambient floor, a warm key, a cool opposing fill, and a back
                rim that separates silhouettes from the background. */}
            <ambientLight intensity={1.05} />
            <directionalLight position={[3.5, 9, 5]} intensity={1.7} castShadow={quality.modelShadows} />
            <directionalLight position={[-4.5, 6, 3]} intensity={0.75} color="#9fd8ec" />
            <directionalLight position={[0, 5, -8]} intensity={1.1} color="#cfe6ff" />
            <pointLight position={[-7, 3, 0]} color={blueLight} intensity={14} distance={18} decay={2} />
            <pointLight position={[7, 3, 0]} color={redLight} intensity={14} distance={18} decay={2} />

            <Suspense fallback={null}><Ground quality={quality} /></Suspense>
            <ClashCamera result={result} clockRef={clockRef} quality={quality} reducedMotion={reducedMotion} />
            {fighters.map((fighter) => (
                <RiteFighter3D
                    key={`${fighter.team}-${fighter.lane}`}
                    result={result}
                    fighter={fighter}
                    clockRef={clockRef}
                    victorious={winnerRef}
                />
            ))}
            <ImpactLayer result={result} clockRef={clockRef} quality={quality} />
            {quality.ambientParticles > 0 ? (
                <Sparkles count={Math.min(46, quality.ambientParticles)} scale={[14, 4, 12]} position={[0, 2, 0]} size={1.6} speed={0.24} opacity={0.32} color="#7fd8ef" />
            ) : null}
            {quality.bloomIntensity > 0 ? (
                <EffectComposer>
                    <Bloom intensity={2.6 * quality.bloomIntensity} luminanceThreshold={0.62} luminanceSmoothing={0.28} mipmapBlur />
                </EffectComposer>
            ) : null}
        </>
    );
}

export type PetWarfrontRiteStage3DProps = {
    result: DuelResult;
    /** Every rig on the field — four a side. */
    fighters: StageFighter[];
    /** FRACTIONAL sim tick. A ref, never state — see the header. */
    clockRef: MutableRefObject<number>;
    quality: PetVisualQualityConfig;
    /** Set once the clash resolves so the winning side plays its victory clip. */
    winnerRef: MutableRefObject<{ player: boolean; enemy: boolean }>;
    reducedMotion: boolean;
    onReady?: () => void;
};

export function PetWarfrontRiteStage3D(props: PetWarfrontRiteStage3DProps) {
    const { quality, onReady } = props;
    useEffect(() => { onReady?.(); }, [onReady]);
    return (
        <Canvas
            className="wfr-canvas"
            dpr={quality.dpr}
            shadows={quality.modelShadows}
            camera={{ fov: 42, position: [0, 6, 12], near: 0.1, far: 80 }}
            gl={{ antialias: quality.bloomIntensity > 0, powerPreference: "high-performance" }}
        >
            <Scene {...props} />
        </Canvas>
    );
}
