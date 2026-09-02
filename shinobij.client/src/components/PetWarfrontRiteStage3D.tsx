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
 * Hollow Warfront — Kage Tactics.
 *
 * Eight pets fight on a deterministic formation board: hard cell ownership,
 * sight-blocking shoji, roof cover, smoke, range and role-driven abilities. The
 * camera is deliberately fixed. A tactical choice is only learnable when the
 * board remains a trustworthy frame of reference from start to finish.
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
import { Html, Sparkles } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Pet } from "../types/pet";
import { DUEL_TPS, type DuelEvent, type DuelObjectiveId, type DuelObjectiveSnap, type DuelResult } from "../lib/pet-duel-sim";
import {
    WARFRONT_ARENA_X,
    WARFRONT_ARENA_Y,
    WARFRONT_MAZE_WALLS,
    WARFRONT_RELIC_HOME_X,
    WARFRONT_SEAL_POSITIONS,
    WARFRONT_SIGIL_RADIUS,
    WARFRONT_WARD_Y,
} from "../lib/pet-duel-cinematic";
import { petCombatModel } from "../lib/pet-3d-models";
import { petModelVariantSurface } from "../lib/pet-visual-variant";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import { fitDistance } from "../lib/showdown-camera";
import {
    RITE_TEAM_COLOR as TEAM_COLOR,
    RITE_WORLD_SCALE as WORLD_SCALE,
    bucketEvents,
    elementColor,
    sampleActor,
    sampleProjectiles,
    squadFocusAt,
} from "../lib/pet-warfront-rite-presentation";
import type { PetVisualQualityConfig } from "../lib/pet-visual-quality";

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
    const combatAura = useRef<THREE.Group>(null);
    const frame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const lastHp = useRef(1);
    const lastPos = useRef<{ x: number; z: number; t: number } | null>(null);
    const smoothedSpeed = useRef(0);
    const locomotionActive = useRef(false);
    const lastMoveFacing = useRef<{ x: number; z: number }>({ x: team === "player" ? 1 : -1, z: 0 });
    const lastFacing = useRef<{ x: number; z: number }>({ x: team === "player" ? 1 : -1, z: 0 });
    const deathAt = useRef<number | null>(null);
    const visualTick = useRef(-1);
    // Four active pets need a little negative space between adjacent cells. Keep
    // the shipped rigs heroic, but never let long tails erase formation reads.
    const scale = config ? Math.min(1.08, 1.7 / Math.max(0.1, config.targetHeight)) : 0.94;
    const height = config ? config.targetHeight * scale : 1.25;
    const facing = team === "player" ? 1 : -1;

    useFrame((_state, delta) => {
        const group = root.current;
        if (!group) return;
        const t = clockRef.current;
        const restarted = visualTick.current >= 0 && t < visualTick.current - 0.5;
        visualTick.current = t;
        if (restarted) {
            deathAt.current = null;
            lastHp.current = 1;
            lastPos.current = null;
            smoothedSpeed.current = 0;
            locomotionActive.current = false;
            lastMoveFacing.current = { x: facing, z: 0 };
            lastFacing.current = { x: facing, z: 0 };
        }
        const pose = sampleActor(result, team, lane, t);
        const targetX = pose.x * WORLD_SCALE;
        const targetZ = pose.z * WORLD_SCALE;
        // sampleActor already returns the exact fractional position between the
        // authoritative 30 Hz snapshots. A second chasing spring lagged behind
        // that curve and exposed every direction change as a correction. Render
        // the interpolated path directly: one owner, no rubber-banding.
        group.position.x = targetX;
        group.position.z = targetZ;

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
        const rawSpeed = Math.hypot(vx, vz);
        if (rawSpeed > 0.05) lastMoveFacing.current = { x: vx / rawSpeed, z: vz / rawSpeed };
        const speedResponse = 1 - Math.exp(-10 * Math.min(delta, 1 / 15));
        smoothedSpeed.current = THREE.MathUtils.lerp(smoothedSpeed.current, rawSpeed, speedResponse);
        const speed = smoothedSpeed.current;
        let targetFacingX = pose.faceX;
        let targetFacingZ = pose.faceZ;
        if (pose.targetId) {
            const [targetTeam, targetLaneText] = pose.targetId.split("-");
            const targetLane = Number(targetLaneText);
            if ((targetTeam === "player" || targetTeam === "enemy") && Number.isInteger(targetLane)) {
                const targetPose = sampleActor(result, targetTeam, targetLane, t);
                const dx = targetPose.x - pose.x;
                const dz = targetPose.z - pose.z;
                const length = Math.hypot(dx, dz);
                if (length > 0.02) {
                    targetFacingX = dx / length;
                    targetFacingZ = dz / length;
                    lastFacing.current = { x: targetFacingX, z: targetFacingZ };
                }
            }
        }
        if (Math.hypot(targetFacingX, targetFacingZ) < 0.05) {
            targetFacingX = lastFacing.current.x;
            targetFacingZ = lastFacing.current.z;
        }

        const striking = pose.state === "strike" || pose.state === "windup";
        // Hysteresis stops the run clip from restarting every time a tiny steering
        // correction crosses one raw-speed threshold.
        if (down || striking) locomotionActive.current = false;
        else if (speed > 0.58) locomotionActive.current = true;
        else if (speed < 0.16) locomotionActive.current = false;
        const moving = !down && !striking && locomotionActive.current;
        const f = frame.current;
        f.motion = down ? "dead"
            : striking ? "strike"
            : pose.state === "dash" ? "dash"
            : pose.state === "stagger" ? "stagger"
            : pose.state === "dodge" ? "dodge"
            : moving ? "run" : "idle";
        f.moving = moving;
        f.speed = Math.min(9, speed);
        f.moveX = lastMoveFacing.current.x;
        f.moveZ = lastMoveFacing.current.z;
        // Target facing owns the entire combat phrase. Allowing ordinary running
        // to replace it with travel heading is what left pets beside an opponent
        // while visibly looking away from the fight.
        f.faceX = targetFacingX;
        f.faceZ = targetFacingZ;
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

        if (combatAura.current) {
            const charged = !down && (striking || pose.state === "dash");
            combatAura.current.visible = charged;
            combatAura.current.rotation.y = t * 0.13 * facing;
            combatAura.current.scale.setScalar(1 + Math.sin(t * 0.55) * 0.12);
        }

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
            {/* Every committed move gets a readable anticipation/strike aura.
                This is intentionally unlit geometry, so it survives Low quality
                on phones instead of disappearing with bloom or dynamic lights. */}
            <group ref={combatAura} visible={false} position={[0, height * 0.08, 0]}>
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[height * 0.54, height * 0.68, 36]} />
                    <meshBasicMaterial color={elementColor(pet.element)} transparent opacity={0.72} depthWrite={false} blending={THREE.AdditiveBlending} />
                </mesh>
                <mesh position={[0, height * 0.54, 0]} rotation={[Math.PI / 2, 0, Math.PI * 0.12]}>
                    <torusGeometry args={[height * 0.42, height * 0.045, 6, 28, Math.PI * 1.32]} />
                    <meshBasicMaterial color={elementColor(pet.element)} transparent opacity={0.62} depthWrite={false} blending={THREE.AdditiveBlending} />
                </mesh>
                {([-1, 1] as const).map((side) => (
                    <mesh key={side} position={[side * height * 0.38, height * 0.48, 0]} rotation={[0.2, 0, side * 0.72]}>
                        <octahedronGeometry args={[height * 0.08, 0]} />
                        <meshBasicMaterial color={elementColor(pet.element)} transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                ))}
            </group>
            {/* TEAM IDENTITY is the hardest read in a squad clash: six bodies
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
    const ring = useRef<THREE.MeshBasicMaterial>(null);
    const shock = useRef<THREE.MeshBasicMaterial>(null);
    const disc = useRef<THREE.MeshBasicMaterial>(null);
    const core = useRef<THREE.MeshBasicMaterial>(null);
    const beam = useRef<THREE.MeshBasicMaterial>(null);
    const linkMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const shield = useRef<THREE.MeshBasicMaterial>(null);
    const shards = useRef<Array<THREE.Mesh | null>>([]);
    const shardMaterials = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const label = useRef<HTMLDivElement>(null);
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
        for (const mat of [ring.current, shock.current, disc.current, core.current, beam.current, shield.current]) {
            if (!mat) continue;
            mat.color.set(s.color);
            mat.opacity = (1 - k) * (ultimate ? 0.68 : emphatic ? 0.78 : restorative ? 0.68 : 0.6);
        }
        if (disc.current) disc.current.opacity *= cast ? 0.52 : 0.24;
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

        for (let i = 0; i < shards.current.length; i++) {
            const shard = shards.current[i];
            const material = shardMaterials.current[i];
            if (!shard || !material) continue;
            const show = !cast && s.kind !== "dodge" && i < sparkCount;
            shard.visible = show;
            if (!show) continue;
            const angle = (i / Math.max(1, sparkCount)) * Math.PI * 2 + s.seed * 0.71;
            const radius = restorative ? 0.22 + (i % 2) * 0.12 : (0.16 + k * (emphatic ? 1.9 : 1.25));
            const rise = restorative ? 0.12 + k * (1.5 + (i % 3) * 0.22) : 0.28 + Math.sin(k * Math.PI) * (0.7 + (i % 2) * 0.25);
            shard.position.set(Math.cos(angle) * radius, rise, Math.sin(angle) * radius);
            shard.rotation.set(k * 5 + i, angle, k * 3.2);
            shard.scale.setScalar(Math.max(0.02, (1 - k) * (emphatic ? 0.16 : 0.11)));
            material.color.set(s.color);
            material.opacity = Math.min(1, (1 - k) * 1.8);
        }
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
                    {([0, 1, 2, 3] as const).map((blade) => (
                        <mesh key={blade} rotation={[0, 0, blade * Math.PI / 2]} position={[0.31, 0, 0]}>
                            <coneGeometry args={[0.18, 0.66, 3]} />
                            <meshBasicMaterial color="#ffffff" transparent opacity={0.42} depthWrite={false} blending={THREE.AdditiveBlending} />
                        </mesh>
                    ))}
                </group>
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <circleGeometry args={[0.58, 40]} />
                    <meshBasicMaterial ref={disc} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                </mesh>
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.34, 0.58, 40]} />
                    <meshBasicMaterial ref={ring} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                </mesh>
                <mesh rotation={[-Math.PI / 2, 0, 0]} scale={1.75}>
                    <ringGeometry args={[0.43, 0.49, 40]} />
                    <meshBasicMaterial ref={shock} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                </mesh>
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
                {Array.from({ length: 8 }, (_, i) => (
                    <mesh key={i} ref={(node) => { shards.current[i] = node; }} visible={false}>
                        <octahedronGeometry args={[1, 0]} />
                        <meshBasicMaterial ref={(material) => { shardMaterials.current[i] = material; }} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                ))}
            </group>
            <group ref={link} visible={false}>
                <mesh>
                    <boxGeometry args={[0.08, 0.08, 1]} />
                    <meshBasicMaterial ref={linkMaterial} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
                </mesh>
            </group>
            <Html center position={[0, 1.55, 0]} distanceFactor={13} zIndexRange={[8, 0]}>
                <div ref={label} className="wfr-fx-label" />
            </Html>
        </group>
    );
}

function SquadOrderLayer({ result, clockRef, team }: {
    result: DuelResult;
    clockRef: MutableRefObject<number>;
    team: "player" | "enemy";
}) {
    const root = useRef<THREE.Group>(null);
    const ring = useRef<THREE.Mesh>(null);
    const links = useRef<Array<THREE.Mesh | null>>([]);
    const label = useRef<HTMLDivElement>(null);
    const orderTick = useRef(-1);
    const orderRef = useRef<ReturnType<typeof squadFocusAt>>(null);
    const color = team === "player" ? "#4cc9f0" : "#ff5470";

    useFrame(() => {
        const tick = Math.floor(clockRef.current);
        if (tick !== orderTick.current) {
            orderTick.current = tick;
            orderRef.current = squadFocusAt(result, team, tick);
        }
        const order = orderRef.current;
        if (!root.current || !order) {
            if (root.current) root.current.visible = false;
            return;
        }
        const target = sampleActor(result, order.target.team, order.target.lane, clockRef.current);
        root.current.visible = true;
        root.current.position.set(target.x * WORLD_SCALE, 0.06, target.z * WORLD_SCALE);
        const pulse = 1 + Math.sin(clockRef.current * 0.22) * 0.08;
        ring.current?.scale.setScalar(pulse);
        if (label.current) label.current.textContent = order.attackers.length >= 3
            ? `COLLAPSE ×${order.attackers.length}`
            : team === "player" ? "FOCUS FIRE" : "ENEMY FOCUS";

        for (let i = 0; i < links.current.length; i++) {
            const link = links.current[i];
            const attacker = order.attackers[i];
            if (!link || !attacker) { if (link) link.visible = false; continue; }
            const pose = sampleActor(result, attacker.team, attacker.lane, clockRef.current);
            const ax = pose.x * WORLD_SCALE - root.current.position.x;
            const az = pose.z * WORLD_SCALE - root.current.position.z;
            const distance = Math.hypot(ax, az);
            link.visible = distance > 0.2;
            link.position.set(ax * 0.5, 0.08, az * 0.5);
            link.rotation.y = Math.atan2(ax, az);
            link.scale.set(1, 1, distance);
        }
    });

    return (
        <group ref={root} visible={false}>
            <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.9, 0.07, 8, 32]} />
                <meshBasicMaterial color={color} transparent opacity={0.82} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            {Array.from({ length: 4 }, (_, i) => (
                <mesh key={i} ref={(node) => { links.current[i] = node; }} position={[0, 0.08, 0]}>
                    <boxGeometry args={[0.07, 0.025, 1]} />
                    <meshBasicMaterial color={color} transparent opacity={0.52} depthWrite={false} blending={THREE.AdditiveBlending} />
                </mesh>
            ))}
            <Html center position={[0, team === "player" ? 1.42 : 1.86, 0]} distanceFactor={12} zIndexRange={[7, 0]}>
                <div ref={label} className={`wfr-squad-order is-${team}`} />
            </Html>
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
function ImpactLayer({ result, clockRef, quality }: {
    result: DuelResult;
    clockRef: MutableRefObject<number>;
    quality: PetVisualQualityConfig;
}) {
    const capacity = quality.impactSparks >= 7 ? 16 : 9;
    const sparkCount = quality.id === "low" ? 4 : quality.id === "medium" ? 6 : 8;
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
                    : kind === "ultimate" ? "#ffe37a"
                    : event.crit ? "#fff3c4" : elementColor(event.element);
            }
        }
        lastTick.current = tick;
    });

    return <>{slots.map((slot, i) => <CombatPulse key={i} slot={slot} clockRef={clockRef} sparkCount={sparkCount} />)}</>;
}

/** Snapshot-native projectile bolts. A small fixed pool keeps the phone path
 *  allocation-free while making ranged attacks physically travel to targets. */
function ProjectileLayer({ result, clockRef, quality }: {
    result: DuelResult;
    clockRef: MutableRefObject<number>;
    quality: PetVisualQualityConfig;
}) {
    const capacity = quality.id === "low" ? 10 : 18;
    const nodes = useRef<Array<THREE.Group | null>>([]);
    const cores = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const trails = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const previous = useRef(new Map<number, THREE.Vector3>());

    useFrame(() => {
        const projectiles = sampleProjectiles(result, clockRef.current).slice(0, capacity);
        const seen = new Set<number>();
        for (let i = 0; i < capacity; i++) {
            const node = nodes.current[i];
            const projectile = projectiles[i];
            if (!node) continue;
            if (!projectile) { node.visible = false; continue; }
            seen.add(projectile.id);
            const x = projectile.x * WORLD_SCALE;
            const z = projectile.y * WORLD_SCALE;
            const old = previous.current.get(projectile.id);
            node.visible = true;
            node.position.set(x, 0.82, z);
            if (old) node.lookAt(x + (x - old.x), 0.82, z + (z - old.z));
            else node.rotation.y = projectile.team === "player" ? Math.PI / 2 : -Math.PI / 2;
            previous.current.set(projectile.id, new THREE.Vector3(x, 0.82, z));
            const color = elementColor(projectile.element);
            cores.current[i]?.color.set(color);
            trails.current[i]?.color.set(color);
        }
        for (const id of previous.current.keys()) if (!seen.has(id)) previous.current.delete(id);
    });

    return <>{Array.from({ length: capacity }, (_, i) => (
        <group key={i} ref={(node) => { nodes.current[i] = node; }} visible={false}>
            <mesh>
                <sphereGeometry args={[0.2, 10, 8]} />
                <meshBasicMaterial ref={(material) => { cores.current[i] = material; }} color="#fff" depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh position={[0, 0, -0.46]} scale={[1, 1, 2.8]}>
                <sphereGeometry args={[0.13, 8, 6]} />
                <meshBasicMaterial ref={(material) => { trails.current[i] = material; }} color="#fff" transparent opacity={0.42} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
        </group>
    ))}</>;
}

// ── Camera ──────────────────────────────────────────────────────────────────

/** A tactical autobattler needs a trustworthy board. Orientation and lens never
 * cut or rotate; only the look point glides slowly toward the active scroll run.
 * The full labyrinth remains framed, including on a tall Galaxy viewport. */
function ClashCamera({ result, fighters, clockRef, reducedMotion }: {
    result: DuelResult;
    fighters: StageFighter[];
    clockRef: MutableRefObject<number>;
    reducedMotion: boolean;
}) {
    const camera = useThree((state) => state.camera);
    const viewport = useThree((state) => state.size);
    const look = useRef(new THREE.Vector3(0, 0.08, 0));
    const pos = useRef(new THREE.Vector3(0, 9, 13));
    const initialized = useRef(false);
    const portrait = viewport.height > viewport.width;

    useFrame((_state, delta) => {
        const perspective = camera as THREE.PerspectiveCamera;
        const desiredFov = portrait ? 50 : 40;
        if (Math.abs(perspective.fov - desiredFov) > 0.1) {
            perspective.fov = desiredFov;
            perspective.updateProjectionMatrix();
        }

        // Landscape looks across the long field. Portrait looks down that axis,
        // so the maze's width—not its full length—owns the phone's narrow side.
        const viewX = portrait ? -1 : 0;
        const viewZ = portrait ? 0 : 1;
        const elevation = portrait ? 1.06 : 0.84;
        const pitchSin = elevation / Math.sqrt(1 + elevation * elevation);
        const rightX = -viewZ;
        const rightZ = viewX;
        const halfX = WARFRONT_ARENA_X * WORLD_SCALE * 1.02;
        const halfZ = WARFRONT_ARENA_Y * WORLD_SCALE * 1.04;
        // A phone shows a moving tactical window rather than shrinking the full
        // sixty-unit maze into postage-stamp pets. The objective tracker below
        // glides that window far enough to retain the active shrine.
        const frameX = halfX * (portrait ? 0.78 : 1);
        const frameZ = halfZ * (portrait ? 0.78 : 1);
        const horiz = Math.abs(rightX) * frameX + Math.abs(rightZ) * frameZ + (portrait ? 1.75 : 1.65);
        const vert = (Math.abs(viewX) * frameX + Math.abs(viewZ) * frameZ) * pitchSin + (portrait ? 2.35 : 2.35);
        const aspect = Math.max(0.35, viewport.width / Math.max(1, viewport.height));
        const cameraDistance = fitDistance(horiz, vert, desiredFov, aspect) * 1.015;
        const groundDistance = cameraDistance / Math.sqrt(1 + elevation * elevation);
        // Formation decisions only read if the board itself is a stable frame of
        // reference. No target tracking, KO zoom or objective chase.
        const focusX = 0, focusZ = 0;
        const targetX = focusX + viewX * groundDistance;
        const targetZ = focusZ + viewZ * groundDistance;
        const targetY = groundDistance * elevation;

        if (!initialized.current) {
            pos.current.set(targetX, targetY, targetZ);
            look.current.set(focusX, 0.08, focusZ);
            initialized.current = true;
        } else {
            const response = 50;
            const frameDelta = Math.min(0.05, delta);
            pos.current.x = THREE.MathUtils.damp(pos.current.x, targetX, response, frameDelta);
            pos.current.y = THREE.MathUtils.damp(pos.current.y, targetY, response, frameDelta);
            pos.current.z = THREE.MathUtils.damp(pos.current.z, targetZ, response, frameDelta);
            look.current.x = THREE.MathUtils.damp(look.current.x, focusX, response, frameDelta);
            look.current.z = THREE.MathUtils.damp(look.current.z, focusZ, response, frameDelta);
        }
        camera.position.copy(pos.current);
        camera.lookAt(look.current);
    });
    return null;
}

// ── Stage ───────────────────────────────────────────────────────────────────

function PaperLantern({ color = "#ffb45c", position = [0, 0, 0] }: {
    color?: string;
    position?: [number, number, number];
}) {
    return (
        <group position={position}>
            <mesh position={[0, 0.34, 0]} castShadow>
                <cylinderGeometry args={[0.13, 0.16, 0.46, 10]} />
                <meshStandardMaterial color="#f2c98a" emissive={color} emissiveIntensity={2.1} roughness={0.72} />
            </mesh>
            <mesh position={[0, 0.61, 0]}><cylinderGeometry args={[0.08, 0.08, 0.07, 8]} /><meshStandardMaterial color="#24160f" roughness={0.9} /></mesh>
            <mesh position={[0, 0.08, 0]}><cylinderGeometry args={[0.08, 0.08, 0.07, 8]} /><meshStandardMaterial color="#24160f" roughness={0.9} /></mesh>
        </group>
    );
}

function ShinobiMazeWall({ wall }: {
    wall: (typeof WARFRONT_MAZE_WALLS)[number];
}) {
    const width = wall.halfX * WORLD_SCALE * 2;
    const depth = wall.halfY * WORLD_SCALE * 2;
    const runsAlongX = width > depth;
    const length = Math.max(width, depth);
    const thickness = Math.min(width, depth);
    const panelCount = 3;
    const panelLength = Math.max(0.28, (length - 0.28) / panelCount);
    const accent = wall.y < 0 ? "#65d9ee" : "#ff7766";
    return (
        <group position={[wall.x * WORLD_SCALE, 0, wall.y * WORLD_SCALE]}>
            <mesh position={[0, 0.07, 0]} receiveShadow castShadow>
                <boxGeometry args={runsAlongX ? [length * 1.12, 0.14, thickness * 1.55] : [thickness * 1.55, 0.14, length * 1.12]} />
                <meshStandardMaterial color="#121717" roughness={0.88} metalness={0.12} />
            </mesh>
            {/* Warm translucent washi and an unmistakable timber lattice keep
                the collision silhouette readable without looking like a black
                sci-fi blocker. */}
            {Array.from({ length: panelCount }, (_, index) => {
                const along = -length / 2 + 0.14 + panelLength / 2 + index * panelLength;
                const position: [number, number, number] = runsAlongX ? [along, 0.67, 0] : [0, 0.67, along];
                return (
                    <group key={index} position={position}>
                        <mesh castShadow receiveShadow>
                            <boxGeometry args={runsAlongX ? [panelLength * 0.92, 1.04, thickness * 0.62] : [thickness * 0.62, 1.04, panelLength * 0.92]} />
                            <meshStandardMaterial color="#d8cab0" emissive="#6f593b" emissiveIntensity={0.08} transparent opacity={0.88} roughness={0.98} />
                        </mesh>
                        {([-0.23, 0.23] as const).map((offset) => (
                            <mesh key={offset} position={runsAlongX ? [0, offset, thickness * 0.36] : [thickness * 0.36, offset, 0]} castShadow>
                                <boxGeometry args={runsAlongX ? [panelLength * 0.94, 0.045, 0.045] : [0.045, 0.045, panelLength * 0.94]} />
                                <meshStandardMaterial color="#42251a" roughness={0.75} />
                            </mesh>
                        ))}
                        <mesh position={runsAlongX ? [0, 0, thickness * 0.37] : [thickness * 0.37, 0, 0]} castShadow>
                            <boxGeometry args={runsAlongX ? [0.045, 1.02, 0.045] : [0.045, 1.02, 0.045]} />
                            <meshStandardMaterial color="#42251a" roughness={0.75} />
                        </mesh>
                    </group>
                );
            })}
            {Array.from({ length: panelCount + 1 }, (_, index) => {
                const along = -length / 2 + 0.12 + index * panelLength;
                return (
                    <mesh key={`post-${index}`} position={runsAlongX ? [along, 0.66, 0] : [0, 0.66, along]} castShadow>
                        <boxGeometry args={[0.105, 1.3, 0.105]} />
                        <meshStandardMaterial color="#2b1711" roughness={0.72} />
                    </mesh>
                );
            })}
            {([0.16, 1.18] as const).map((height) => (
                <mesh key={height} position={[0, height, 0]} castShadow>
                    <boxGeometry args={runsAlongX ? [length * 1.08, 0.11, thickness * 1.18] : [thickness * 1.18, 0.11, length * 1.08]} />
                    <meshStandardMaterial color="#301a12" roughness={0.7} />
                </mesh>
            ))}
            {([-1, 1] as const).map((side) => (
                <mesh key={`eave-${side}`} position={runsAlongX ? [0, 1.31, side * thickness * 0.46] : [side * thickness * 0.46, 1.31, 0]} rotation={runsAlongX ? [side * -0.34, 0, 0] : [0, 0, side * 0.34]} castShadow>
                    <boxGeometry args={runsAlongX ? [length * 1.14, 0.1, thickness] : [thickness, 0.1, length * 1.14]} />
                    <meshStandardMaterial color="#141c1d" roughness={0.58} metalness={0.1} />
                </mesh>
            ))}
            <mesh position={[0, 1.42, 0]} castShadow>
                <boxGeometry args={runsAlongX ? [length * 1.18, 0.1, 0.08] : [0.08, 0.1, length * 1.18]} />
                <meshStandardMaterial color="#0f1516" roughness={0.52} />
            </mesh>
            <pointLight position={[runsAlongX ? 0 : thickness * 1.2, 1.05, runsAlongX ? thickness * 1.2 : 0]} color={accent} intensity={1.8} distance={3.4} decay={2} />
        </group>
    );
}

function ToriiGate({ team, position, rotation = 0 }: {
    team: "player" | "enemy" | "neutral";
    position: [number, number, number];
    rotation?: number;
}) {
    const cloth = team === "player" ? "#174f68" : team === "enemy" ? "#742d27" : "#493261";
    return (
        <group position={position} rotation={[0, rotation, 0]}>
            {([-1, 1] as const).map((side) => (
                <mesh key={side} position={[side * 0.95, 1.05, 0]} castShadow>
                    <cylinderGeometry args={[0.12, 0.17, 2.1, 10]} />
                    <meshStandardMaterial color="#5b1c15" roughness={0.72} />
                </mesh>
            ))}
            <mesh position={[0, 1.9, 0]} castShadow><boxGeometry args={[2.55, 0.2, 0.24]} /><meshStandardMaterial color="#741f18" roughness={0.68} /></mesh>
            <mesh position={[0, 2.17, 0]} castShadow><boxGeometry args={[2.95, 0.16, 0.3]} /><meshStandardMaterial color="#9b3427" roughness={0.62} /></mesh>
            <mesh position={[0, 1.52, 0.03]}><boxGeometry args={[0.82, 0.38, 0.06]} /><meshStandardMaterial color={cloth} roughness={0.9} /></mesh>
            <PaperLantern position={[-1.28, 1.45, 0]} color={team === "enemy" ? "#ff654f" : "#63cfe2"} />
            <PaperLantern position={[1.28, 1.45, 0]} color={team === "enemy" ? "#ff654f" : "#63cfe2"} />
        </group>
    );
}

function BambooGrove({ x, z, mirror = 1 }: { x: number; z: number; mirror?: number }) {
    return (
        <group position={[x, 0, z]}>
            {Array.from({ length: 7 }, (_, index) => {
                const px = ((index % 3) - 1) * 0.34 * mirror;
                const pz = (Math.floor(index / 3) - 0.8) * 0.38;
                const height = 1.25 + (index % 3) * 0.24;
                return (
                    <group key={index} position={[px, 0, pz]}>
                        <mesh position={[0, height / 2, 0]} castShadow><cylinderGeometry args={[0.045, 0.065, height, 7]} /><meshStandardMaterial color="#31543a" roughness={0.88} /></mesh>
                        <mesh position={[0.16 * mirror, height * 0.82, 0]} rotation={[0, 0, -0.65 * mirror]}><coneGeometry args={[0.18, 0.48, 5]} /><meshStandardMaterial color="#456d46" roughness={0.96} /></mesh>
                    </group>
                );
            })}
        </group>
    );
}

function StealthGarden({ x, z, rotation = 0 }: { x: number; z: number; rotation?: number }) {
    return (
        <group position={[x, 0.04, z]} rotation={[0, rotation, 0]}>
            <mesh position={[0, 0.05, 0]} receiveShadow>
                <boxGeometry args={[2.2, 0.1, 1.15]} />
                <meshStandardMaterial color="#1b2820" roughness={1} />
            </mesh>
            {Array.from({ length: 12 }, (_, index) => {
                const px = ((index % 6) - 2.5) * 0.34;
                const pz = (Math.floor(index / 6) - 0.5) * 0.52 + (index % 2) * 0.08;
                return (
                    <mesh key={index} position={[px, 0.27 + (index % 3) * 0.04, pz]} rotation={[0, index * 1.7, (index % 2 ? 0.24 : -0.24)]} castShadow>
                        <coneGeometry args={[0.16, 0.62, 5]} />
                        <meshStandardMaterial color={index % 3 ? "#35563b" : "#496b46"} roughness={0.96} />
                    </mesh>
                );
            })}
        </group>
    );
}

function ClanHall({ team, x, z }: { team: "player" | "enemy"; x: number; z: number }) {
    const glow = team === "player" ? "#6ed8ee" : "#ff795f";
    const banner = team === "player" ? "#164c65" : "#752c27";
    return (
        <group position={[x, 0, z]}>
            <mesh position={[0, 0.18, 0]} receiveShadow><boxGeometry args={[4.6, 0.36, 2.8]} /><meshStandardMaterial color="#303934" roughness={0.96} /></mesh>
            <mesh position={[0, 1.02, 0]} castShadow><boxGeometry args={[3.9, 1.42, 2.25]} /><meshStandardMaterial color="#291a14" roughness={0.86} /></mesh>
            {([-1, 0, 1] as const).map((window) => (
                <mesh key={window} position={[window * 1.05, 1.05, 1.14]}>
                    <boxGeometry args={[0.62, 0.66, 0.035]} />
                    <meshStandardMaterial color="#ead6aa" emissive={glow} emissiveIntensity={0.52} roughness={0.9} />
                </mesh>
            ))}
            <mesh position={[0, 2.0, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1.72, 0.7, 1.02]} castShadow>
                <coneGeometry args={[2.0, 1.05, 4]} />
                <meshStandardMaterial color="#131c1f" roughness={0.58} metalness={0.14} />
            </mesh>
            <mesh position={[0, 1.15, 1.19]}><boxGeometry args={[0.5, 1.05, 0.05]} /><meshStandardMaterial color={banner} roughness={0.9} /></mesh>
            <PaperLantern position={[-2.0, 0.34, 1.3]} color={glow} />
            <PaperLantern position={[2.0, 0.34, 1.3]} color={glow} />
        </group>
    );
}

function StoneLantern({ position, glow = "#ffc974" }: { position: [number, number, number]; glow?: string }) {
    return (
        <group position={position}>
            <mesh position={[0, 0.08, 0]} castShadow><boxGeometry args={[0.48, 0.16, 0.48]} /><meshStandardMaterial color="#343a36" roughness={0.98} /></mesh>
            <mesh position={[0, 0.42, 0]} castShadow><cylinderGeometry args={[0.11, 0.16, 0.62, 7]} /><meshStandardMaterial color="#555d55" roughness={0.98} /></mesh>
            <mesh position={[0, 0.78, 0]} castShadow><boxGeometry args={[0.46, 0.42, 0.46]} /><meshStandardMaterial color="#404943" roughness={0.94} /></mesh>
            <mesh position={[0, 0.79, 0.235]}><planeGeometry args={[0.24, 0.22]} /><meshStandardMaterial color="#f0d99e" emissive={glow} emissiveIntensity={2.3} roughness={0.82} /></mesh>
            <mesh position={[0, 1.06, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[0.43, 0.27, 4]} /><meshStandardMaterial color="#242d2d" roughness={0.72} /></mesh>
        </group>
    );
}

function ShinobiWatchtower({ team, x, z }: { team: "player" | "enemy"; x: number; z: number }) {
    const glow = team === "player" ? "#65d6ed" : "#ff6d58";
    const banner = team === "player" ? "#164d66" : "#752d27";
    return (
        <group position={[x, 0, z]}>
            <mesh position={[0, 0.18, 0]} receiveShadow><cylinderGeometry args={[1.35, 1.55, 0.36, 8]} /><meshStandardMaterial color="#343b38" roughness={0.98} /></mesh>
            {([-1, 1] as const).flatMap((px) => ([-1, 1] as const).map((pz) => (
                <mesh key={`${px}:${pz}`} position={[px * 0.78, 1.22, pz * 0.68]} castShadow>
                    <boxGeometry args={[0.16, 2.0, 0.16]} />
                    <meshStandardMaterial color="#291710" roughness={0.82} />
                </mesh>
            )))}
            <mesh position={[0, 1.85, 0]} castShadow><boxGeometry args={[2.15, 0.22, 1.85]} /><meshStandardMaterial color="#3d281d" roughness={0.86} /></mesh>
            <mesh position={[0, 2.58, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1.5, 0.58, 1.12]} castShadow>
                <coneGeometry args={[1.28, 0.86, 4]} />
                <meshStandardMaterial color="#111a1d" roughness={0.58} metalness={0.12} />
            </mesh>
            <mesh position={[0, 1.3, 0.95]}><boxGeometry args={[0.5, 0.82, 0.045]} /><meshStandardMaterial color={banner} emissive={glow} emissiveIntensity={0.12} roughness={0.88} /></mesh>
            <PaperLantern position={[-0.72, 1.68, 0.92]} color={glow} />
            <PaperLantern position={[0.72, 1.68, 0.92]} color={glow} />
        </group>
    );
}

function CentralCrossroads() {
    return (
        <group position={[0, 0.025, 0]}>
            <mesh position={[0, 0.055, 0]} receiveShadow>
                <cylinderGeometry args={[1.58, 1.72, 0.11, 12]} />
                <meshStandardMaterial color="#3f4742" roughness={0.92} metalness={0.06} />
            </mesh>
            <mesh position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[1.08, 0.045, 7, 40]} />
                <meshStandardMaterial color="#aa8551" emissive="#60421f" emissiveIntensity={0.24} roughness={0.58} metalness={0.35} />
            </mesh>
            {([[2.15, 2.15], [-2.15, 2.15], [2.15, -2.15], [-2.15, -2.15]] as const).map(([x, z]) => (
                <StoneLantern key={`${x}:${z}`} position={[x, 0, z]} glow="#c49aff" />
            ))}
        </group>
    );
}

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

function ExtractionGate({ team, result, clockRef }: {
    team: "player" | "enemy";
    result: DuelResult;
    clockRef: MutableRefObject<number>;
}) {
    const color = TEAM_COLOR[team];
    const homeX = (team === "player" ? -WARFRONT_RELIC_HOME_X : WARFRONT_RELIC_HOME_X) * WORLD_SCALE;
    const root = useRef<THREE.Group>(null);
    const beam = useRef<THREE.MeshBasicMaterial>(null);
    const id: DuelObjectiveId = team === "player" ? "player-extraction" : "enemy-extraction";
    useFrame(() => {
        const gate = sampleObjective(result, clockRef.current, id);
        const on = gate?.active === true;
        if (root.current) root.current.scale.setScalar(on ? 1 + Math.sin(clockRef.current * 0.1) * 0.035 : 0.88);
        if (beam.current) beam.current.opacity = on ? 0.32 + Math.sin(clockRef.current * 0.08) * 0.08 : 0.025;
    });
    return (
        <group ref={root}>
            <group position={[homeX, 0, 0]}>
                <mesh position={[0, 0.1, 0]} receiveShadow>
                    <cylinderGeometry args={[1.38, 1.56, 0.2, 12]} />
                    <meshStandardMaterial color="#242b29" roughness={0.9} />
                </mesh>
                <mesh position={[0, 0.22, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[0.92, 0.075, 8, 32]} />
                    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} roughness={0.38} />
                </mesh>
                <mesh position={[team === "player" ? -0.72 : 0.72, 0.65, 0]} castShadow>
                    <boxGeometry args={[0.62, 1.05, 0.82]} />
                    <meshStandardMaterial color="#291913" roughness={0.82} />
                </mesh>
                <mesh position={[team === "player" ? -0.72 : 0.72, 1.18, 0]} castShadow>
                    <boxGeometry args={[0.9, 0.12, 1.0]} />
                    <meshStandardMaterial color="#20292b" roughness={0.56} />
                </mesh>
                <mesh position={[0, 2.9, 0]}>
                    <cylinderGeometry args={[0.34, 1.16, 5.6, 18, 1, true]} />
                    <meshBasicMaterial ref={beam} color={color} transparent opacity={0.025} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
                </mesh>
            </group>
            <ToriiGate team={team} position={[homeX, 0, 0]} rotation={Math.PI / 2} />
        </group>
    );
}

function CipherSeal({ id, x, y, result, clockRef }: {
    id: "seal-veil" | "seal-tide" | "seal-cinder";
    x: number;
    y: number;
    result: DuelResult;
    clockRef: MutableRefObject<number>;
}) {
    const core = useRef<THREE.Mesh>(null);
    const ring = useRef<THREE.MeshBasicMaterial>(null);
    const beam = useRef<THREE.MeshBasicMaterial>(null);
    useFrame(() => {
        const seal = sampleObjective(result, clockRef.current, id);
        if (!seal) return;
        const color = seal.owner ? TEAM_COLOR[seal.owner] : seal.progress > 0.015 ? TEAM_COLOR.player : seal.progress < -0.015 ? TEAM_COLOR.enemy : "#b886ff";
        if (ring.current) { ring.current.color.set(color); ring.current.opacity = seal.state === "captured" ? 0.94 : 0.52 + Math.abs(seal.progress) * 0.34; }
        if (beam.current) {
            beam.current.color.set(color);
            beam.current.opacity = seal.state === "captured" ? 0.17 : 0.035 + Math.abs(seal.progress) * 0.08;
        }
        const scale = 0.2 + Math.max(0, Math.abs(seal.progress)) * 0.8;
        if (core.current) { core.current.scale.setScalar(scale); core.current.rotation.z = clockRef.current * 0.008; }
    });
    return (
        <group position={[x * WORLD_SCALE, 0.03, y * WORLD_SCALE]}>
            <mesh position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[WARFRONT_SIGIL_RADIUS * WORLD_SCALE, 0.085, 10, 48]} />
                <meshBasicMaterial ref={ring} color="#b886ff" transparent opacity={0.56} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh ref={core} position={[0, 0.075, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
                <ringGeometry args={[0.38, 1.12, 4]} />
                <meshBasicMaterial color="#efe4ff" transparent opacity={0.24} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh position={[0, 1.8, 0]}>
                <cylinderGeometry args={[0.18, 0.72, 3.5, 12, 1, true]} />
                <meshBasicMaterial ref={beam} color="#b886ff" transparent opacity={0.04} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
            </mesh>
        </group>
    );
}

function ForbiddenScrollRelic({ result, clockRef }: { result: DuelResult; clockRef: MutableRefObject<number> }) {
    const token = useRef<THREE.Group>(null);
    const field = useRef<THREE.Group>(null);
    const beam = useRef<THREE.MeshBasicMaterial>(null);
    const halo = useRef<THREE.MeshBasicMaterial>(null);
    useFrame(() => {
        const scroll = sampleObjective(result, clockRef.current, "forbidden-scroll");
        if (!scroll || !token.current) return;
        const carrierColor = scroll.carrierId?.startsWith("player-") ? TEAM_COLOR.player
            : scroll.carrierId?.startsWith("enemy-") ? TEAM_COLOR.enemy
                : scroll.owner ? TEAM_COLOR[scroll.owner] : "#bd83ff";
        token.current.visible = scroll.state !== "sealed";
        token.current.position.set(scroll.x * WORLD_SCALE, scroll.state === "carried" ? 2.5 : scroll.state === "dropped" ? 0.7 : 1.65, scroll.y * WORLD_SCALE);
        token.current.rotation.y += scroll.state === "carried" ? 0.018 : 0.007;
        const pulse = 1 + Math.sin(clockRef.current * 0.08) * 0.09;
        token.current.scale.setScalar(scroll.state === "carried" ? pulse * 0.86 : pulse);
        if (field.current) { field.current.visible = scroll.state !== "sealed"; field.current.position.set(scroll.x * WORLD_SCALE, 0.02, scroll.y * WORLD_SCALE); }
        if (beam.current) { beam.current.color.set(carrierColor); beam.current.opacity = scroll.state === "carried" ? 0.045 : 0.22; }
        if (halo.current) { halo.current.color.set(carrierColor); halo.current.opacity = scroll.state === "dropped" ? 1 : 0.68; }
    });
    return (
        <>
            <group ref={field} visible={false}>
                <mesh position={[0, 2.9, 0]}><cylinderGeometry args={[0.32, 0.92, 5.6, 14, 1, true]} /><meshBasicMaterial ref={beam} color="#bd83ff" transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} /></mesh>
                <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.15, 0.09, 10, 40]} /><meshBasicMaterial ref={halo} color="#bd83ff" transparent opacity={0.68} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
            </group>
            <group ref={token} visible={false} position={[0, 1.65, 0]}>
                <mesh castShadow>
                    <boxGeometry args={[1.2, 0.62, 0.1]} />
                    <meshStandardMaterial color="#f0ddb0" emissive="#8a4cc4" emissiveIntensity={0.7} roughness={0.72} />
                </mesh>
                {([-1, 1] as const).map((side) => (
                    <mesh key={side} position={[side * 0.6, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                        <cylinderGeometry args={[0.11, 0.11, 0.72, 10]} />
                        <meshStandardMaterial color="#3b1e13" roughness={0.66} />
                    </mesh>
                ))}
                <mesh position={[0, 0, 0.068]}><boxGeometry args={[0.13, 0.7, 0.045]} /><meshStandardMaterial color="#8d4ac2" emissive="#bd83ff" emissiveIntensity={1.1} roughness={0.5} /></mesh>
                <mesh position={[0, 0, 0.098]} rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.2, 0.2, 0.025]} /><meshStandardMaterial color="#2e211c" roughness={0.78} /></mesh>
                {Array.from({ length: 7 }, (_, index) => {
                    const angle = index / 7 * Math.PI * 2;
                    return <mesh key={index} position={[Math.cos(angle) * 1.05, (index % 3) * 0.18 - 0.05, Math.sin(angle) * 1.05]} rotation={[0.2, -angle, angle * 0.35]}><planeGeometry args={[0.2, 0.5]} /><meshBasicMaterial color="#fff3c8" transparent opacity={0.78} side={THREE.DoubleSide} /></mesh>;
                })}
            </group>
        </>
    );
}

function ForbiddenVault() {
    return (
        <group position={[0, 0.02, 0]}>
            <mesh position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.75, 0.08, 10, 48]} /><meshStandardMaterial color="#a66be0" emissive="#7c42b7" emissiveIntensity={1.2} roughness={0.38} /></mesh>
            {Array.from({ length: 8 }, (_, index) => {
                const angle = index / 8 * Math.PI * 2;
                return <StoneLantern key={index} position={[Math.cos(angle) * 2.55, 0, Math.sin(angle) * 2.55]} glow="#b886ff" />;
            })}
        </group>
    );
}

function CarrierInkTrail({ result, clockRef }: { result: DuelResult; clockRef: MutableRefObject<number> }) {
    const root = useRef<THREE.Group>(null);
    const wisps = useRef<Array<THREE.Mesh | null>>([]);
    useFrame(() => {
        const scroll = sampleObjective(result, clockRef.current, "forbidden-scroll");
        if (!root.current || !scroll || scroll.state !== "carried") { if (root.current) root.current.visible = false; return; }
        root.current.visible = true;
        root.current.position.set(scroll.x * WORLD_SCALE, 0.34, scroll.y * WORLD_SCALE);
        const teamColor = scroll.carrierId?.startsWith("player-") ? TEAM_COLOR.player : TEAM_COLOR.enemy;
        wisps.current.forEach((wisp, index) => {
            if (!wisp) return;
            const phase = clockRef.current * 0.055 - index * 0.72;
            wisp.position.set(-Math.cos(phase) * (0.34 + index * 0.12), index * 0.13, -Math.sin(phase) * (0.34 + index * 0.12));
            wisp.rotation.z = phase;
            const material = wisp.material as THREE.MeshBasicMaterial;
            material.color.set(teamColor);
            material.opacity = 0.32 * (1 - index / 10);
        });
    });
    return (
        <group ref={root} visible={false}>
            {Array.from({ length: 10 }, (_, index) => (
                <mesh key={index} ref={(node) => { wisps.current[index] = node; }} rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.12 + index * 0.012, 0.23 + index * 0.018, 10]} />
                    <meshBasicMaterial color="#b886ff" transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} />
                </mesh>
            ))}
            <Sparkles count={12} scale={[2.8, 2.2, 2.8]} size={2.2} speed={0.4} opacity={0.72} color="#f1dcff" />
        </group>
    );
}

function VaultBreachVfx({ result, clockRef }: { result: DuelResult; clockRef: MutableRefObject<number> }) {
    const root = useRef<THREE.Group>(null);
    const rings = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const openTick = useMemo(() => result.events.find((event) => event.type === "vault_open")?.t ?? -1, [result]);
    useFrame(() => {
        if (!root.current || openTick < 0) return;
        const age = (clockRef.current - openTick) / DUEL_TPS;
        root.current.visible = age >= 0 && age < 2.4;
        if (!root.current.visible) return;
        root.current.rotation.y = age * 1.8;
        rings.current.forEach((material, index) => {
            if (!material) return;
            material.opacity = Math.max(0, 0.92 - age * 0.34 - index * 0.08);
        });
        const scale = 0.45 + age * 1.55;
        root.current.scale.setScalar(scale);
    });
    return (
        <group ref={root} visible={false} position={[0, 0.18, 0]}>
            {[0, 1, 2].map((index) => (
                <mesh key={index} position={[0, index * 0.32, 0]} rotation={[Math.PI / 2, 0, index * Math.PI / 6]}>
                    <torusGeometry args={[1.1 + index * 0.42, 0.07, 8, 36]} />
                    <meshBasicMaterial ref={(material) => { rings.current[index] = material; }} color={index === 1 ? "#fff0b5" : "#c27cff"} transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} />
                </mesh>
            ))}
            <Sparkles count={34} scale={[4, 4.8, 4]} size={3.2} speed={1.1} opacity={0.9} color="#dcb3ff" />
        </group>
    );
}

function KageSmoke({ x }: { x: number }) {
    const root = useRef<THREE.Group>(null);
    useFrame(({ clock }) => {
        if (!root.current) return;
        root.current.rotation.y = clock.elapsedTime * (x < 0 ? 0.08 : -0.08);
        root.current.position.y = 0.2 + Math.sin(clock.elapsedTime * 0.7 + x) * 0.05;
    });
    return (
        <group ref={root} position={[x, 0.2, 0]}>
            {[0, 1, 2].map((index) => (
                <mesh key={index} position={[(index - 1) * 0.34, 0.25 + index * 0.16, (index % 2 ? 0.28 : -0.18)]} rotation={[0, index * 0.9, 0]}>
                    <sphereGeometry args={[0.62 + index * 0.12, 10, 7]} />
                    <meshStandardMaterial color="#81909a" emissive="#304652" emissiveIntensity={0.18} transparent opacity={0.13} depthWrite={false} roughness={1} />
                </mesh>
            ))}
            <Sparkles count={8} scale={[2.2, 1.1, 2.2]} size={1.8} speed={0.12} opacity={0.18} color="#a9c6cd" />
        </group>
    );
}

/** A true 3D board: thirty-five individually modelled stone cells, low roof
 * cover, two sight-blocking shoji screens and smoke lanes. The generated art is
 * used only as the distant page backdrop, never baked onto the playable floor. */
function KageTacticsArena() {
    const halfX = WARFRONT_ARENA_X * WORLD_SCALE * 1.08;
    const halfZ = WARFRONT_ARENA_Y * WORLD_SCALE * 1.12;
    const cellX = 3.2 * WORLD_SCALE;
    const cellZ = 3.0 * WORLD_SCALE;
    return (
        <group>
            <mesh position={[0, -0.46, 0]} receiveShadow castShadow>
                <boxGeometry args={[halfX * 2.12, 0.78, halfZ * 2.18]} />
                <meshStandardMaterial color="#0c1214" roughness={0.9} metalness={0.1} />
            </mesh>
            <mesh position={[0, -0.07, 0]} receiveShadow>
                <boxGeometry args={[halfX * 2.02, 0.16, halfZ * 2.06]} />
                <meshStandardMaterial color="#1a2327" roughness={0.84} metalness={0.13} />
            </mesh>
            {/* Two inset lacquer frames give the board a crafted temple-floor
                silhouette instead of a floating rectangular slab. */}
            {([1, 0.965] as const).map((scale, index) => (
                <mesh key={scale} position={[0, 0.025 + index * 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[scale, scale, 1]}>
                    <ringGeometry args={[halfZ * 1.56, halfZ * 1.6, 4]} />
                    <meshBasicMaterial color={index ? "#896944" : "#161f22"} transparent opacity={index ? 0.44 : 0.8} depthWrite={false} />
                </mesh>
            ))}
            {Array.from({ length: 35 }, (_, index) => {
                const col = index % 7, row = Math.floor(index / 7);
                const x = (col - 3) * cellX, z = (row - 2) * cellZ;
                const blocked = col === 3 && (row === 1 || row === 3);
                const blue = col < 2, red = col > 4;
                return (
                    <group key={index} position={[x, 0, z]}>
                        <mesh position={[0, blocked ? 0.02 : 0, 0]} receiveShadow>
                            <boxGeometry args={[cellX * 0.97, 0.12, cellZ * 0.965]} />
                            <meshStandardMaterial color={blocked ? "#171d1f" : (index + row) % 2 ? "#2a3438" : "#252e32"} roughness={0.9} metalness={0.06} />
                        </mesh>
                        <mesh position={[0, 0.064, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                            <planeGeometry args={[cellX * 0.82, cellZ * 0.78]} />
                            <meshBasicMaterial color={blue ? "#234651" : red ? "#4a2928" : "#4a4032"} transparent opacity={blue || red ? 0.11 : 0.08} depthWrite={false} />
                        </mesh>
                        <mesh position={[0, 0.067, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                            <ringGeometry args={[0.31, 0.345, 6]} />
                            <meshBasicMaterial color={blue ? "#54d8ee" : red ? "#ff7766" : "#c3a16a"} transparent opacity={blue || red ? 0.28 : 0.14} depthWrite={false} />
                        </mesh>
                    </group>
                );
            })}
            {WARFRONT_MAZE_WALLS.map((wall) => <ShinobiMazeWall key={`${wall.x}:${wall.y}`} wall={wall} />)}
            {([[-3.2, -6], [3.2, 6]] as const).map(([x, z], index) => (
                <group key={index} position={[x * WORLD_SCALE, 0, z * WORLD_SCALE]}>
                    <mesh position={[0, 0.12, 0]} receiveShadow castShadow><cylinderGeometry args={[1.02, 1.14, 0.24, 8]} /><meshStandardMaterial color="#242d2b" roughness={0.86} /></mesh>
                    {([-1, 1] as const).map((side) => (
                        <mesh key={side} position={[side * 0.44, 0.34, 0]} rotation={[0, 0, side * 0.12]} castShadow>
                            <boxGeometry args={[1.08, 0.12, 1.68]} />
                            <meshStandardMaterial color="#182124" roughness={0.58} metalness={0.1} />
                        </mesh>
                    ))}
                    <mesh position={[0, 0.45, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.48, 0.78, 8]} /><meshStandardMaterial color="#a17f4c" emissive="#4d3519" emissiveIntensity={0.2} roughness={0.62} metalness={0.24} /></mesh>
                    <PaperLantern position={[0, 0.45, 0]} color={index === 0 ? "#66d8ec" : "#ff7867"} />
                </group>
            ))}
            {/* Central Kage crest: navigation landmark, not an objective. */}
            <group position={[0, 0.075, 0]}>
                <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.72, 0.77, 40]} /><meshBasicMaterial color="#c19a61" transparent opacity={0.62} depthWrite={false} /></mesh>
                <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]}><ringGeometry args={[0.3, 0.37, 4]} /><meshBasicMaterial color="#b785ff" transparent opacity={0.45} depthWrite={false} /></mesh>
                {([0, 1, 2, 3] as const).map((quarter) => (
                    <mesh key={quarter} rotation={[-Math.PI / 2, 0, quarter * Math.PI / 2]} position={[Math.cos(quarter * Math.PI / 2) * 0.52, 0.004, Math.sin(quarter * Math.PI / 2) * 0.52]}>
                        <planeGeometry args={[0.08, 0.32]} /><meshBasicMaterial color="#9272ba" transparent opacity={0.34} depthWrite={false} />
                    </mesh>
                ))}
            </group>
            <KageSmoke x={-3.2 * WORLD_SCALE} />
            <KageSmoke x={3.2 * WORLD_SCALE} />
            {([-1, 1] as const).map((side) => (
                <group key={side} position={[side * halfX * 0.98, 0.08, 0]}>
                    <mesh castShadow><boxGeometry args={[0.3, 0.62, halfZ * 2.02]} /><meshStandardMaterial color={side < 0 ? "#173b48" : "#522521"} roughness={0.76} /></mesh>
                    {([-0.72, 0, 0.72] as const).map((z) => <PaperLantern key={z} position={[0, 0.3, z * halfZ]} color={side < 0 ? TEAM_COLOR.player : TEAM_COLOR.enemy} />)}
                </group>
            ))}
            <ToriiGate team="player" position={[-halfX * 0.82, 0.02, -halfZ * 0.9]} />
            <ToriiGate team="enemy" position={[halfX * 0.82, 0.02, halfZ * 0.9]} rotation={Math.PI} />
        </group>
    );
}

function Scene({ result, fighters, clockRef, quality, winnerRef, reducedMotion }: PetWarfrontRiteStage3DProps) {
    const blueLight = elementColor(fighters.find((f) => f.team === "player")?.pet.element);
    const redLight = elementColor(fighters.find((f) => f.team === "enemy")?.pet.element);
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
            <ambientLight intensity={0.68} color="#bfd0d2" />
            <hemisphereLight intensity={0.48} color="#8eb9d0" groundColor="#20150f" />
            <directionalLight position={[3.5, 11, 5]} intensity={2.35} color="#e7edf0" castShadow={quality.modelShadows} />
            <directionalLight position={[-5, 6, 2]} intensity={0.42} color="#7db9cb" />
            <directionalLight position={[0, 6, -8]} intensity={1.05} color="#afc5db" />
            <pointLight position={[-15, 3, 0]} color={blueLight} intensity={10} distance={22} decay={2} />
            <pointLight position={[15, 3, 0]} color={redLight} intensity={10} distance={22} decay={2} />
            <pointLight position={[0, 4, -7]} color="#ffb45c" intensity={5} distance={16} decay={2} />
            <pointLight position={[0, 3, 7]} color="#b58cff" intensity={4} distance={15} decay={2} />

            <KageTacticsArena />
            <ClashCamera result={result} fighters={fighters} clockRef={clockRef} reducedMotion={reducedMotion} />
            {fighters.map((fighter) => (
                <RiteFighter3D
                    key={`${fighter.team}-${fighter.lane}`}
                    result={result}
                    fighter={fighter}
                    clockRef={clockRef}
                    victorious={winnerRef}
                />
            ))}
            <ProjectileLayer result={result} clockRef={clockRef} quality={quality} />
            <ImpactLayer result={result} clockRef={clockRef} quality={quality} />
            {quality.ambientParticles > 0 ? (
                <Sparkles count={Math.min(42, quality.ambientParticles)} scale={[38, 5, 24]} position={[0, 2, 0]} size={1.35} speed={0.16} opacity={0.22} color="#d8c69d" />
            ) : null}
            {quality.bloomIntensity > 0 ? (
                <EffectComposer>
                    <Bloom intensity={1.45 * quality.bloomIntensity} luminanceThreshold={0.72} luminanceSmoothing={0.32} mipmapBlur />
                </EffectComposer>
            ) : null}
        </>
    );
}

export type PetWarfrontRiteStage3DProps = {
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
};

export function PetWarfrontRiteStage3D(props: PetWarfrontRiteStage3DProps) {
    const { quality, onReady } = props;
    useEffect(() => { onReady?.(); }, [onReady]);
    return (
        /* Three 0.184 deprecates the boolean shadow preset as
           PCFSoftShadowMap and logs repeatedly while six rigs render. Select
           the supported percentage-filtered map explicitly. */
        <Canvas
            className="wfr-canvas"
            dpr={quality.dpr}
            shadows={quality.modelShadows ? "percentage" : false}
            camera={{ fov: 44, position: [0, 9, 13], near: 0.1, far: 100 }}
            gl={{ antialias: quality.bloomIntensity > 0, alpha: true, powerPreference: "high-performance" }}
            fallback={(
                <div className="wfr-canvas-fallback" role="img" aria-label="Kage Tactics formation battle view">
                    <div className="wfr-fallback-band is-blue">{props.fighters.filter((fighter) => fighter.team === "player").map((fighter) => <span key={`${fighter.team}-${fighter.lane}`}>{fighter.pet.name.slice(0, 1)}</span>)}</div>
                    <strong>CLASH</strong>
                    <div className="wfr-fallback-band is-red">{props.fighters.filter((fighter) => fighter.team === "enemy").map((fighter) => <span key={`${fighter.team}-${fighter.lane}`}>{fighter.pet.name.slice(0, 1)}</span>)}</div>
                    <small>Reduced graphics mode</small>
                </div>
            )}
        >
            <Scene {...props} />
        </Canvas>
    );
}
