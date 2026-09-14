// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GameIcon } from ".././icons/GameIcon";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html } from "@react-three/drei";
import type { Pet } from "../../types/pet";
import type { PetArenaFrame, PetBattleRecord } from "../../types/pet-arena";
import { petArchetypeFor, petHighGroundTiles, petBushTiles, type ArenaTile } from "../../lib/pet-tactics";
import { PET_SPAWN_1V1 } from "../../constants/pet-arena";
import { PetBattleAvatar } from ".././PetBattleAvatar";
import type { PetVisualState, PetBattleAnimationEventType } from "../../types/pet-battle";
import { buildPetAnimationEvents, petPoseForAvatar, elementVfxKey, extractPetMoveName } from "../../lib/pet-battle-anim";
import { petBattleCamera, petCameraHoldMs } from "../../lib/pet-battle-camera";
import { petFxSpriteKey } from "../../lib/jutsu-vfx";
import { bundledJutsuFxFrames } from "../../lib/jutsu-fx-assets";
import { projectileVisual } from "../../lib/pet-projectile-vfx";
import { petFramePace, tileDistance } from "../../lib/pet-battle-sim";
import { beatTimeline, beatChoreoMs, lerp, shakeAmpForBeat, lungeReach, tileToWorld, spreadPositions, arenaObstaclePlacements, cameraForCombatants, TILE_WORLD_W, TILE_WORLD_D, groundedSpriteLayout, type SpriteBounds, type ObstaclePlacement } from "../../lib/pet-coliseum-scene";
import { petVisualId } from "../../data/pet-evolutions";
import { usePetBattleFrameSfx } from "../../lib/use-pet-battle-sfx";
import { SceneAmbience } from ".././SceneAmbience";
import { isPetSfxMuted, setPetSfxMuted } from "../../lib/pet-sfx";
import { PetOrbitControls } from ".././PetOrbitControls";
import { makeGhostMaterial, elementColor, usePetPoses, poseCategory, shadowTexture, dustTexture, decalTexture, projSpriteTexture, projRoundTexture, loadSceneTexture, usePetSprite } from "./sprite-resources";
import { TARGET_SPRITE_H, FLOOR_Y, type Vec3, CAM_LOOK, type PetBattleSettlementStatus, COLISEUM_FLOOR_URL, COLISEUM_BG_URL, COLISEUM_ENGAGE_GAP, FX_Y, CAM_POS, CAM_FOV, resultBtn } from "./stage";
import { ResponsiveCamera, FxAnim, BloomFx } from "./stage-components";


// ── Afterimage trail — element-tinted ghost copies behind a fast-moving pet ───
// A flat-color SILHOUETTE (the sprite's alpha masked to the element glow color),
// not a tint of the sprite's RGB — so dark creatures (e.g. the black kitsune)
// still leave a bright, readable speed-streak. Additive over the floor → glow.
const GHOSTS = 3;
            // ghost copies per standee
const TRAIL_STRIDE = 2;


// One afterimage ghost: positions itself at an older trail sample and fades in
// with the pet's speed. Owns its material via a ref so the per-frame uniform
// writes are idiomatic r3f ref-mutation (not a flagged memo mutation).
function Afterimage({ index, trail, fastRef, tex, color, L, fainted }: {
    index: number;
    trail: { current: Array<[number, number, number]> };
    fastRef: { current: number };
    tex: THREE.Texture;
    color: string;
    L: ReturnType<typeof groundedSpriteLayout>;
    fainted: boolean;
}) {
    const grp = useRef<THREE.Group>(null);
    const mat = useRef<THREE.ShaderMaterial>(null);
    const material = useMemo(() => makeGhostMaterial(color), [color]);
    useEffect(() => () => material.dispose(), [material]);
    useFrame(() => {
        const g = grp.current, m = mat.current;
        if (!g || !m) return;
        const buf = trail.current;
        const sample = buf[Math.min(buf.length - 1, (index + 1) * TRAIL_STRIDE)];
        if (sample) g.position.set(sample[0], sample[1], sample[2]);
        m.uniforms.map.value = tex;
        const targetOp = fainted ? 0 : fastRef.current * 0.5 * (1 - index / GHOSTS);
        m.uniforms.uOpacity.value = lerp(m.uniforms.uOpacity.value as number, targetOp, 0.5);
    });
    return (
        <group ref={grp}>
            <Billboard lockX lockZ>
                <mesh position={[L.meshX, L.meshY, -0.02 - index * 0.01]}>
                    <planeGeometry args={[L.planeW, L.planeH]} />
                    <primitive object={material} ref={mat} attach="material" />
                </mesh>
            </Billboard>
        </group>
    );
}


// ── One grounded pet standee — Y-locked billboard, feet on the floor ─────────
function Standee({
    pet, side, pos, reach, toward, pose, hitPower, beatKey, fainted, texture, bounds, aspect,
}: {
    pet: Pet;
    side: "player" | "enemy";
    /** Separation-adjusted world position (faceOffPositions). */
    pos: { x: number; z: number };
    /** Gap-aware lunge distance (lungeReach) — stops at contact, never through. */
    reach: number;
    /** +1 if the opponent is to this pet's +x, -1 otherwise — drives motion
     *  direction (lunge toward / recoil away) from ACTUAL positions, so it
     *  stays correct even if the pets cross sides mid-fight. */
    toward: number;
    pose: PetVisualState;
    /** This beat's damage as a fraction of THIS pet's maxHp (0 unless it's the
     *  one being hit) — scales the recoil knockback so big hits hit harder. */
    hitPower: number;
    /** The active beat index — changes every sub-hit so a reactive pose
     *  (recoil/hit) re-jolts on each hit of a multi-hit flurry. */
    beatKey: number;
    fainted: boolean;
    texture: THREE.Texture;
    /** Alpha-scanned content box + image aspect → grounds the visible feet. */
    bounds: SpriteBounds;
    aspect: number;
}) {
    const group = useRef<THREE.Group>(null);    // lane position + pose offset
    const poseG = useRef<THREE.Group>(null);    // squash + topple, pivots at feet
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const flashMat = useRef<THREE.MeshBasicMaterial>(null);
    const shadow = useRef<THREE.Mesh>(null);
    const shadowMat = useRef<THREE.MeshBasicMaterial>(null);
    const sclX = useRef(1), sclY = useRef(1), rotZ = useRef(0);
    const prevHurt = useRef(0);
    const prevPose = useRef<PetVisualState | null>(null); // beat-clock: stamps on pose change
    const prevBeat = useRef(-1);                           // …and per-beat for flurry re-jolts
    const poseStart = useRef(0);
    // Afterimage trail: a ring buffer of recent WORLD positions + a speed gate,
    // both refs. The <Afterimage> children read them to place + fade the ghosts.
    const trail = useRef<Array<[number, number, number]>>([]);
    const lastWX = useRef(0);
    const fastRef = useRef(0);
    const ghostColor = useMemo(() => elementColor(pet.element).glow, [pet.element]);
    const base = pos;
    const mirrored = side === "enemy";
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Flipbook: swap to the pose frame matching the active beat (else the single
    // sprite). The pose category derives from the SAME state the choreography
    // uses, so the attack POSE lands together with the lunge MOTION.
    const poses = usePetPoses(petVisualId(pet), mirrored);
    const poseCat = poseCategory(fainted ? "ko" : pose);
    const useTex = poses ? poses.tex[poseCat] : texture;
    const useBounds = poses ? poses.scan[poseCat].bounds : bounds;
    const useAspect = poses ? poses.scan[poseCat].aspect : aspect;

    // Foot-anchored plane size + offset from the alpha bounds of the active pose.
    const L = useMemo(() => groundedSpriteLayout(useBounds, useAspect, TARGET_SPRITE_H, mirrored), [useBounds, useAspect, mirrored]);
    const shadowW = Math.max(0.9, L.contentWorldW * 0.95);

    useFrame((state) => {
        const g = group.current, pg = poseG.current, material = mat.current;
        if (!g || !pg || !material) return;
        const t = state.clock.elapsedTime;
        // Beat clock: stamp the start so the choreography plays from progress 0.
        // Re-stamp on pose change AND — for reactive poses (recoil/hit) — on each
        // new beat, so every sub-hit of a multi-hit flurry re-jolts the target
        // (a fresh flinch per jab) instead of one held knockback.
        const activePose: PetVisualState = fainted ? "ko" : pose;
        const reactive = activePose === "recoil" || activePose === "hit";
        if (prevPose.current !== activePose || (reactive && prevBeat.current !== beatKey)) {
            prevPose.current = activePose; prevBeat.current = beatKey; poseStart.current = t;
        }
        const choreoS = beatChoreoMs(activePose) / 1000;
        const progress = reduce ? 1 : choreoS <= 0.002 ? 1 : Math.min(1, (t - poseStart.current) / choreoS);
        const target = beatTimeline(activePose, toward, reach, progress, { power: hitPower });
        // Snappier on the reactive beats (the hit must read on the contact frame,
        // not slide in); gentle on the settle/idle so grounding stays calm.
        const k = reduce ? 1
            : activePose === "hit" || activePose === "recoil" ? 0.8
            : activePose === "lunge" ? 0.5
            : activePose === "windup" || activePose === "charge" || activePose === "rangedCast" || activePose === "projectileFire" || activePose === "dodge" ? 0.35
            : 0.2;
        // Idle aggression: a waiting pet holds a coiled fighting stance — leans
        // toward the foe + a slow weight-shift sway — so it never just stands.
        const idling = activePose === "idle" && !fainted;
        const facing = toward >= 0 ? 1 : -1;
        const stanceX = idling ? facing * 0.18 + Math.sin(t * 3.1 + (side === "enemy" ? Math.PI : 0)) * 0.06 : 0;
        // Lane position + pose offset (NO y-bob — grounding stays planted; idle
        // life comes from the stance sway + the energetic breathe-bob below).
        g.position.x = lerp(g.position.x, base.x + target.dx + stanceX, k);
        g.position.y = lerp(g.position.y, FLOOR_Y + target.dy, k);
        g.position.z = lerp(g.position.z, base.z + target.dz, k);
        // Squash/stretch + topple, eased on stored bases so the breathe can
        // multiply on top without compounding. Pose group pivots at the feet.
        sclX.current = lerp(sclX.current, target.sx, k);
        sclY.current = lerp(sclY.current, target.sy, k);
        rotZ.current = lerp(rotZ.current, target.rot, k);
        // Energetic stance-bob for an idling pet (a coiled bounce); a calm breathe
        // for victory. Math.abs(sin) gives a punchy double-rate bounce.
        const phase = side === "enemy" ? Math.PI : 0;
        const breathe = idling ? 1 + Math.abs(Math.sin(t * 5.2 + phase)) * 0.05 - 0.02
            : (pose === "victory" && !fainted ? 1 + Math.sin(t * 2 + phase) * 0.022 : 1);
        pg.scale.set(sclX.current, sclY.current * breathe, 1);
        pg.rotation.z = rotZ.current;
        // Hit feedback: white flash overlay (snap on the hit edge, fast decay)
        // over a soft red tint dip.
        material.color.g = lerp(material.color.g, 1 - 0.3 * target.hurt, k);
        material.color.b = lerp(material.color.b, 1 - 0.3 * target.hurt, k);
        material.opacity = lerp(material.opacity, target.opacity, k);
        if (flashMat.current) {
            const f = flashMat.current;
            if (target.hurt > 0 && prevHurt.current === 0) f.opacity = 0.9;
            else f.opacity = f.opacity < 0.01 ? 0 : f.opacity * 0.82;
            prevHurt.current = target.hurt;
        }
        // Blob shadow stays on the floor, tracks x/z, fades + shrinks as the pet
        // leaves the ground (lunge arc / KO sink reads off it).
        if (shadow.current && shadowMat.current) {
            shadow.current.position.x = g.position.x;
            shadow.current.position.z = g.position.z;
            const lift = Math.max(0, g.position.y);
            const f = Math.max(0, 1 - lift * 1.4);
            shadowMat.current.opacity = 0.42 * f * target.opacity;
            const s = 0.85 + 0.15 * f;
            shadow.current.scale.set(shadowW * s, shadowW * 0.5 * s, 1);
        }
        // Afterimage trail: record the world position each frame + a speed gate
        // (≈0 when holding a stance, strong during a lunge). The <Afterimage>
        // children read trail+fastRef to place + fade the ghost copies.
        const speed = Math.abs(g.position.x - lastWX.current);
        lastWX.current = g.position.x;
        const buf = trail.current;
        buf.unshift([g.position.x, g.position.y, g.position.z]);
        if (buf.length > GHOSTS * TRAIL_STRIDE + 1) buf.length = GHOSTS * TRAIL_STRIDE + 1;
        fastRef.current = reduce ? 0 : Math.max(0, Math.min(1, (speed - 0.03) / 0.10));
    });

    return (
        <group>
            <group ref={group} position={[base.x, 0, base.z]}>
                {/* Y-axis-locked billboard: yaws to face the camera but stays
                    vertical, so feet never lift off the floor at the angled cam. */}
                <Billboard lockX lockZ>
                    <group ref={poseG}>
                        {/* Plane lifted so the VISIBLE feet (alpha bottom) sit at the
                            feet pivot (poseG origin, y=0); width tracks art aspect. */}
                        <mesh position={[L.meshX, L.meshY, 0]}>
                            <planeGeometry args={[L.planeW, L.planeH]} />
                            <meshBasicMaterial ref={mat} map={useTex} transparent alphaTest={0.02} depthWrite={false} toneMapped={false} />
                            <mesh position={[0, 0, 0.01]}>
                                <planeGeometry args={[L.planeW, L.planeH]} />
                                <meshBasicMaterial ref={flashMat} map={useTex} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                            </mesh>
                        </mesh>
                    </group>
                </Billboard>
                <Html position={[0, L.contentWorldH + 0.12, 0]} center distanceFactor={11} pointerEvents="none" zIndexRange={[6, 0]}>
                    {/* Just the name now — HP lives in the fixed corner cards (no
                        redundant floating bar). */}
                    <div style={{ textAlign: "center", font: "700 13px Inter, system-ui, sans-serif", whiteSpace: "nowrap", userSelect: "none", opacity: fainted ? 0.5 : 1 }}>
                        <div style={{ color: "#fff", textShadow: "0 1px 3px #000" }}>Lv.{pet.level} {pet.name}</div>
                    </div>
                </Html>
            </group>
            {/* Per-pet contact shadow — flat on the floor, follows the pet. */}
            <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} position={[base.x, 0.02, base.z]}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial ref={shadowMat} map={shadowTexture()} transparent opacity={0.42} depthWrite={false} toneMapped={false} />
            </mesh>
            {/* Afterimage ghosts — world-positioned at older trail samples, faded
                in only during fast motion. Same grounded layout + active texture
                as the sprite, so they align exactly. */}
            {Array.from({ length: GHOSTS }).map((_, i) => (
                <Afterimage key={i} index={i} trail={trail} fastRef={fastRef} tex={useTex} color={ghostColor} L={L} fainted={fainted} />
            ))}
        </group>
    );
}


export function DustPuff({ at, onDone }: { at: Vec3; onDone: () => void }) {
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const grp = useRef<THREE.Group>(null);
    const start = useRef<number | null>(null);
    const DUR = 0.45; // seconds
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / DUR);
        if (grp.current) {
            const s = 0.7 + p * 1.1;
            grp.current.scale.set(s, s * 0.7, s);
            grp.current.position.y = at[1] + p * 0.25;
        }
        if (mat.current) mat.current.opacity = 0.65 * (1 - p);
        if (p >= 1) onDone();
    });
    return (
        <group ref={grp} position={at}>
            <Billboard>
                <mesh>
                    <planeGeometry args={[1.1, 0.8]} />
                    <meshBasicMaterial ref={mat} map={dustTexture()} transparent opacity={0.65} depthWrite={false} toneMapped={false} />
                </mesh>
            </Billboard>
        </group>
    );
}


// Hues mirror the classic grid renderer's tile palette (index.css).
const OBSTACLE_COLOR: Record<ObstaclePlacement["kind"], string> = {
    blocked: "#5b6b80",
    cover: "#3b5168",
    hazard: "#dc3c28",
    healing: "#3cdc78",
    slow: "#5a7090",
};


function ObstacleMesh({ p }: { p: ObstaclePlacement }) {
    const w = TILE_WORLD_W * 0.82, d = TILE_WORLD_D * 0.66;
    const decalMat = useRef<THREE.MeshBasicMaterial>(null);
    const isWall = p.kind === "blocked" || p.kind === "cover";
    const pulse = p.kind === "hazard" || p.kind === "healing";
    useFrame((state) => {
        if (pulse && decalMat.current) {
            const t = state.clock.elapsedTime;
            decalMat.current.opacity = 0.5 + Math.sin(t * (p.kind === "hazard" ? 3.6 : 2.4)) * 0.16;
        }
    });
    if (isWall) {
        const cover = p.kind === "cover";
        const h = cover ? 1.0 : 1.85;     // cover = low rock you shoot over; blocked = tall boulder
        const ww = TILE_WORLD_W * 0.99, wd = TILE_WORLD_D * 0.99;
        // Deterministic per-tile variation (no RNG → replays stay identical).
        const spin = p.x * 1.7 + p.z * 2.3;
        return (
            <group position={[p.x, 0, p.z]}>
                {/* Mossy dark-stone boulder cluster — a shinobi rock-garden obstacle that
                    reads as natural cover, not a grey dungeon block. Faceted flat-shaded
                    geometry catches the lantern light; a smaller accent rock + moss cap
                    break the silhouette so it never looks like a cube. */}
                <mesh position={[0, h * 0.44, 0]} rotation={[0.06, spin, 0.05]} scale={[ww * 0.56, h * 0.52, wd * 0.56]}>
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshStandardMaterial color={cover ? "#6b7568" : "#586054" } roughness={0.98} metalness={0.02} flatShading />
                </mesh>
                <mesh position={[ww * 0.33, h * 0.2, wd * 0.25]} rotation={[0.4, spin * 1.6, 0.25]} scale={[ww * 0.32, h * 0.3, wd * 0.32]}>
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshStandardMaterial color={cover ? "#5c6659" : "#4a5247"} roughness={1} metalness={0} flatShading />
                </mesh>
                <mesh position={[-ww * 0.18, h * 0.46, -wd * 0.2]} rotation={[0.6, spin * 0.7, 0.12]} scale={[ww * 0.24, h * 0.16, wd * 0.22]}>
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshStandardMaterial color="#55663f" roughness={1} metalness={0} flatShading />
                </mesh>
                {/* Contact shadow blob so the rocks read as planted, not floating. */}
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, wd * 0.18]}>
                    <planeGeometry args={[ww * 1.6, wd * 1.5]} />
                    <meshBasicMaterial map={shadowTexture()} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
                </mesh>
            </group>
        );
    }
    // Flat floor decal (hazard / healing / slow) — passable effect tiles.
    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.03, p.z]}>
            <planeGeometry args={[w * 1.3, d * 1.05]} />
            <meshBasicMaterial ref={decalMat} map={decalTexture()} color={OBSTACLE_COLOR[p.kind]} transparent opacity={0.55} depthWrite={false} toneMapped={false} />
        </mesh>
    );
}


function ArenaObstacles({ obstacles, tiles }: { obstacles?: number[]; tiles?: ArenaTile[] }) {
    const placements = useMemo(() => arenaObstaclePlacements(obstacles, tiles), [obstacles, tiles]);
    // Central high ground — derived from the obstacles (both 1v1 + 2v2), drawn as
    // glowing amber pads so the contested centre reads as a prize worth holding.
    const highGround = useMemo(() => [...petHighGroundTiles(obstacles ?? [])], [obstacles]);
    // Bushes / tall grass — flank concealment, drawn as forest-green clumps.
    const bushes = useMemo(() => [...petBushTiles(obstacles ?? [])], [obstacles]);
    if (!placements.length && !highGround.length && !bushes.length) return null;
    const hgW = TILE_WORLD_W * 0.98, hgD = TILE_WORLD_D * 0.86;
    return (
        <group>
            {placements.map((p, i) => <ObstacleMesh key={`${p.kind}-${i}`} p={p} />)}
            {highGround.map((t) => {
                const { x, z } = tileToWorld(t);
                return (
                    <mesh key={`hg-${t}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.035, z]}>
                        <planeGeometry args={[hgW, hgD]} />
                        <meshBasicMaterial map={decalTexture()} color="#e8b94a" transparent opacity={0.5} depthWrite={false} toneMapped={false} />
                    </mesh>
                );
            })}
            {bushes.map((t) => {
                const { x, z } = tileToWorld(t);
                return (
                    <group key={`bush-${t}`} position={[x, 0.28, z]}>
                        <Billboard>
                            <mesh>
                                <planeGeometry args={[TILE_WORLD_W * 1.15, 0.66]} />
                                <meshBasicMaterial map={decalTexture()} color="#2f7d3a" transparent opacity={0.62} depthWrite={false} toneMapped={false} />
                            </mesh>
                        </Billboard>
                    </group>
                );
            })}
        </group>
    );
}


// ── Power-pickup shrine orbs — float above their tile, vanish when claimed ────
function PickupOrb({ tile }: { tile: number }) {
    const grp = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const { x, z } = tileToWorld(tile);
    useFrame((state) => {
        const t = state.clock.elapsedTime;
        if (grp.current) grp.current.position.y = 0.85 + Math.sin(t * 2.2 + tile) * 0.13;
        if (mat.current) mat.current.opacity = 0.7 + Math.sin(t * 3 + tile) * 0.2;
    });
    return (
        <group ref={grp} position={[x, 0.85, z]}>
            <Billboard>
                <mesh>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial ref={mat} map={decalTexture()} color="#ffd66a" transparent opacity={0.85} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </mesh>
            </Billboard>
        </group>
    );
}


function PickupOrbs({ pickups }: { pickups?: number[] }) {
    if (!pickups?.length) return null;
    return <group>{pickups.map((t) => <PickupOrb key={t} tile={t} />)}</group>;
}


/** A REAL painted element projectile for the cinematic coliseum duel (PetColiseum,
 *  the live "battle" view). The fireball / water ball / wind cut / boulder / bolt
 *  flies caster→target as an alpha-blended billboard, mirrored to face its travel
 *  direction (the camera is angled, so we key off the dominant horizontal axis).
 *  Returns null for elements with no painted sprite — the caller falls back to the
 *  element flipbook. */
function ColiseumProjectile({ element, from, to, durationMs, scale, onDone }: {
    element?: string | null; from: Vec3; to: Vec3; durationMs: number; scale: number; onDone: () => void;
}) {
    const group = useRef<THREE.Group>(null);
    const sprite = useRef<THREE.Mesh>(null);
    const start = useRef<number | null>(null);
    const visual = useMemo(() => projectileVisual({ element }), [element]);
    const tex = projSpriteTexture(visual.spriteKey);
    const flip = to[0] < from[0] ? -1 : 1;   // base art faces +x → mirror for a leftward shot
    useFrame((state) => {
        const g = group.current; if (!g) return;
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) * 1000 / durationMs);
        g.position.set(lerp(from[0], to[0], p), lerp(from[1], to[1], p), lerp(from[2], to[2], p));
        // The alpha-blended sprite renders an opaque black box until its WebP decodes —
        // keep it hidden until the texture has real pixels (the halo still shows).
        if (sprite.current) {
            const im = tex?.image as HTMLImageElement | undefined;
            sprite.current.visible = !!(im && im.complete && (im.naturalWidth || 0) > 0);
        }
        if (p >= 1) onDone();
    });
    if (!tex) return null;
    return (
        <group ref={group} position={from}>
            <Billboard>
                {/* faint additive glow so the shot still pops + blooms a touch */}
                <mesh position={[0, 0, -0.01]} scale={[scale * 0.85, scale * 0.85, 1]}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial map={projRoundTexture()} color={visual.glow} transparent opacity={0.18} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </mesh>
                {/* the real painted element sprite (alpha-blended → true colours) */}
                <mesh ref={sprite} scale={[scale * flip, scale, 1]} visible={false}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
                </mesh>
            </Billboard>
        </group>
    );
}


// ── Camera shake rig — decaying sinusoid offset on contact beats (no RNG) ─────
function CameraRig({ amp, shakeKey, target }: { amp: number; shakeKey: number; target: { pos: Vec3; look: Vec3 } }) {
    const base = useRef<THREE.Vector3 | null>(null);
    const look = useRef(new THREE.Vector3(CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2]));
    const cur = useRef(0);
    const { camera } = useThree();
    useEffect(() => {
        cur.current = Math.max(cur.current, amp);
    }, [shakeKey, amp]);
    useFrame((state) => {
        if (!base.current) base.current = camera.position.clone();
        // Glide the base pose toward the follow-cam target (frames the living
        // combatants) — slow lerp so the camera tracks the action without jitter.
        const k = 0.045;
        base.current.x = lerp(base.current.x, target.pos[0], k);
        base.current.y = lerp(base.current.y, target.pos[1], k);
        base.current.z = lerp(base.current.z, target.pos[2], k);
        look.current.x = lerp(look.current.x, target.look[0], k);
        look.current.y = lerp(look.current.y, target.look[1], k);
        look.current.z = lerp(look.current.z, target.look[2], k);
        cur.current *= 0.86;
        const a = cur.current;
        const t = state.clock.elapsedTime;
        // Slow idle drift keeps the shot alive between beats; the decaying
        // high-frequency sinusoid on top is the impact shake.
        const swayX = Math.sin(t * 0.45) * 0.12;
        const swayY = Math.sin(t * 0.3) * 0.05;
        camera.position.set(
            base.current.x + swayX + (a > 0.001 ? Math.sin(t * 53) * a : 0),
            base.current.y + swayY + (a > 0.001 ? Math.sin(t * 61) * a * 0.6 : 0),
            base.current.z,
        );
        camera.lookAt(look.current.x, look.current.y, look.current.z);
    });
    return null;
}


export function Arena({ floor, backdrop, big = false }: { floor: THREE.Texture; backdrop: THREE.Texture; big?: boolean }) {
    const ambient = useRef<THREE.AmbientLight>(null);
    const sun = useRef<THREE.DirectionalLight>(null);
    const floorR = big ? 22 : 14;
    const wallR = big ? 30 : 19;
    // Wrap the painted backdrop around a cylinder arc so the coliseum wall
    // CURVES around the arena instead of sitting flat behind it. Mirrored
    // 2× repeat keeps the stands from stretching across the long arc.
    const wall = useMemo(() => {
        const t = backdrop.clone();
        t.wrapS = THREE.MirroredRepeatWrapping;
        t.repeat.set(2, 1);
        t.needsUpdate = true;
        return t;
    }, [backdrop]);
    // Torch/firelight flicker — a subtle, deterministic-feel (pure sin mix)
    // modulation of the scene lights so the whole arena breathes like firelight.
    useFrame((state) => {
        const t = state.clock.elapsedTime;
        const ambientBase = big ? 0.42 : 0.5;
        const sunBase = big ? 0.94 : 1.2;
        if (ambient.current) ambient.current.intensity = ambientBase + Math.sin(t * 7.3) * 0.02 + Math.sin(t * 12.7) * 0.014;
        if (sun.current) sun.current.intensity = sunBase + Math.sin(t * 9.1) * 0.035;
    });
    return (
        <group>
            <ambientLight ref={ambient} intensity={big ? 0.42 : 0.5} />
            <hemisphereLight args={["#8fc7ff", "#4a210d", big ? 0.46 : 0.56]} />
            <directionalLight
                ref={sun}
                position={[5, 10, 6]}
                intensity={big ? 0.94 : 1.2}
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
            <directionalLight position={[-7, 5, -7]} intensity={big ? 0.38 : 0.64} color="#79aaff" />
            <pointLight position={[0, 3.5, 2]} intensity={big ? 7 : 14} distance={15} decay={2} color="#ff7a35" />
            {/* Curved coliseum wall (inner face of a cylinder arc behind the pit).
                Rings the floor so panning/pull-back never exposes void. */}
            <mesh position={[0, big ? 9 : 6.0, 0]}>
                <cylinderGeometry args={[wallR, wallR, big ? 30 : 21, 48, 1, true, Math.PI * 0.2, Math.PI * 1.6]} />
                <meshBasicMaterial map={wall} side={THREE.BackSide} toneMapped={false} fog={false} />
            </mesh>
            {/* Arena floor (the battle map). Per-pet blob shadows ground the sprites. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
                <circleGeometry args={[floorR, 64]} />
                <meshStandardMaterial map={floor} roughness={0.95} />
            </mesh>
        </group>
    );
}


type FxInstance = { id: number; frames: string[]; from: Vec3; to?: Vec3; durationMs: number; scale: number; projElement?: string | null };

type LabelInstance = { id: number; text: string; className: string; pos: Vec3 };


export type PetColiseumProps = {
    playerPet: Pet;
    enemyPet: Pet;
    enemyOwner: string;
    playerReservePet?: Pet;
    enemyReservePet?: Pet;
    frame?: PetArenaFrame;
    recentFrames?: PetArenaFrame[];
    result: string;
    obstacles?: number[];
    tiles?: ArenaTile[];
    onReplay: () => void;
    onFightAgain?: () => void;
    onExit: () => void;
    settlementStatus?: PetBattleSettlementStatus;
    onRetrySettlement?: () => void;
    resultSupplement?: ReactNode;
    sharedImages?: Record<string, string>;
    playerRecord?: PetBattleRecord;
    enemyRecord?: PetBattleRecord;
};


export function PetColiseum({
    playerPet, enemyPet, enemyOwner, playerReservePet, enemyReservePet, frame, result,
    obstacles, tiles, onReplay, onFightAgain, onExit, settlementStatus, onRetrySettlement,
    resultSupplement, sharedImages = {}, playerRecord, enemyRecord,
}: PetColiseumProps) {
    const floor = useMemo(() => loadSceneTexture(COLISEUM_FLOOR_URL), []);
    const backdrop = useMemo(() => loadSceneTexture(COLISEUM_BG_URL), []);
    // Dispose the coliseum floor/backdrop textures when the match view unmounts.
    useEffect(() => () => { floor.dispose(); backdrop.dispose(); }, [floor, backdrop]);
    const playerSprite = usePetSprite(playerPet, sharedImages);
    const enemySprite = usePetSprite(enemyPet, sharedImages, true);
    // Reserve sprites (2v2). Hooks must run unconditionally, so absent reserves
    // fall back to the lead pet's art — never rendered in that case.
    const playerResSprite = usePetSprite(playerReservePet ?? playerPet, sharedImages);
    const enemyResSprite = usePetSprite(enemyReservePet ?? enemyPet, sharedImages, true);
    const orbit = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("orbit") === "1";
    // Desktop fine-pointer only — mirrors the bloom gate; keeps the extra ambient-ember
    // rAF canvas off low-end/touch devices (the team is actively trimming mobile VFX cost).
    const desktopPointer = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches;
    // Battle SFX — reuses the shared per-frame picker so sound matches the DOM
    // renderer exactly (only one renderer is mounted at a time → no double-play).
    const [sfxMuted, setSfxMuted] = useState(isPetSfxMuted());
    usePetBattleFrameSfx(frame, sfxMuted);

    // Pre-fight 5-second face-off countdown — same behaviour as the DOM
    // renderer's overlay (5→4→3→2→1→"FIGHT!"). Cosmetic only.
    const [prefightCount, setPrefightCount] = useState<number | null>(null);
    useEffect(() => {
        // Mirrors the accepted countdown effect in PetArenaBattlefield verbatim.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!frame?.isPrefight) { setPrefightCount(null); return; }
        setPrefightCount(5);
        const id = window.setInterval(() => {
            setPrefightCount((c) => (c === null || c <= 0 ? c : c - 1));
        }, 1000);
        return () => window.clearInterval(id);
    }, [frame?.isPrefight, frame?.message]);

    // ── Frame derivations — mirror PetArenaBattlefield exactly so behaviour and
    //    determinism match the DOM renderer. In 2v2 (frame.party4v4 present) the
    //    frame names the exact acting/target SLOTS; 1v1 derives from actor side. ──
    const party = frame?.party4v4;
    const slotPet = (slot?: string): Pet | undefined =>
        slot === "playerLead" ? playerPet
        : slot === "playerReserve" ? playerReservePet
        : slot === "enemyLead" ? enemyPet
        : slot === "enemyReserve" ? enemyReservePet
        : undefined;
    const playerPos = frame?.playerPos ?? PET_SPAWN_1V1.player;
    const enemyPos = frame?.enemyPos ?? PET_SPAWN_1V1.enemy;
    const selfTile = party?.actorSlot ? party[party.actorSlot].pos : frame?.actor === "enemy" ? enemyPos : playerPos;
    const targetTile = party?.targetSlot ? party[party.targetSlot].pos : frame?.actor === "enemy" ? playerPos : enemyPos;
    const actingPet = party?.actorSlot ? slotPet(party.actorSlot) : frame?.actor === "player" ? playerPet : frame?.actor === "enemy" ? enemyPet : undefined;
    const actingElement = frame?.actor === "system" ? undefined : actingPet?.element;

    const playerHp = frame?.playerHp ?? playerPet.hp;
    const enemyHp = frame?.enemyHp ?? enemyPet.hp;
    const playerPct = Math.max(0, Math.min(100, (playerHp / Math.max(1, playerPet.hp)) * 100));
    const enemyPct = Math.max(0, Math.min(100, (enemyHp / Math.max(1, enemyPet.hp)) * 100));

    const winnerSide: "player" | "enemy" | null = result === "Victory" ? "player" : result === "Defeat" ? "enemy" : null;
    const resolvedWinnerId = winnerSide === "player" ? playerPet.id : winnerSide === "enemy" ? enemyPet.id : null;

    const battleDist = tileDistance(selfTile, targetTile);
    const animActorId = party?.actorSlot ? (slotPet(party.actorSlot)?.id ?? "") : frame?.actor === "enemy" ? enemyPet.id : playerPet.id;
    const animTargetId = party?.targetSlot ? (slotPet(party.targetSlot)?.id ?? "") : frame?.actor === "enemy" ? playerPet.id : enemyPet.id;
    const animVfxKey = elementVfxKey(actingElement);

    const animEvents = useMemo(() => {
        if (!frame) return [];
        return buildPetAnimationEvents({
            frame: {
                actor: frame.actor, actionKind: frame.actionKind, damage: frame.damage,
                crit: frame.crit, isKO: frame.isKO, isPrefight: frame.isPrefight,
                message: frame.message, signatureMove: frame.signatureMove ?? null,
            },
            dist: battleDist, actorId: animActorId, targetId: animTargetId, vfxKey: animVfxKey,
            isResultFrame: frame.actionKind === "result" && !frame.isKO,
            winnerId: resolvedWinnerId, loserId: animTargetId,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frame?.message]);

    // ── Hit-stop scheduler — identical budgeting to the DOM renderer. ──
    const [animIdx, setAnimIdx] = useState(0);
    useEffect(() => {
        // Reset + schedule the per-beat timeline. This mirrors the accepted
        // scheduler in PetArenaBattlefield (App.tsx) verbatim; the synchronous
        // reset is intentional (a fresh frame restarts its queue at beat 0).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAnimIdx(0);
        if (animEvents.length <= 1) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduce) { setAnimIdx(animEvents.length - 1); return; }
        const pace = petFramePace(frame);
        const total = animEvents.reduce((s, e) => s + e.durationMs, 0) || 1;
        const victimMaxHp = Math.max(1, frame?.actor === "enemy" ? playerPet.hp : enemyPet.hp);
        const holdOpts = { crit: !!frame?.crit, signature: !!frame?.signatureMove, isKO: !!frame?.isKO, heavyHit: !!frame?.damage && frame.damage >= victimMaxHp * 0.18 };
        const rawHolds = animEvents.map((e) => petCameraHoldMs(e.type, holdOpts));
        const rawHoldTotal = rawHolds.reduce((s, h) => s + h, 0);
        const holdBudget = Math.min(pace * 0.35, rawHoldTotal);
        const holdScale = rawHoldTotal > 0 ? holdBudget / rawHoldTotal : 0;
        const scale = Math.min(1, Math.max(0, pace * 0.9 - holdBudget) / total);
        const timers: number[] = [];
        let acc = 0;
        for (let i = 1; i < animEvents.length; i++) {
            acc += animEvents[i - 1].durationMs * scale + rawHolds[i - 1] * holdScale;
            timers.push(window.setTimeout(() => setAnimIdx(i), acc));
        }
        return () => timers.forEach((t) => window.clearTimeout(t));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animEvents]);
    const activeAnimEvent = animEvents[animIdx];

    // ── Per-pet fainted flags (1v1; 2v2 uses per-slot ko in the render). Poses
    //    resolve per-combatant in the render block via petPoseForAvatar. ──
    const playerFainted = !winnerSide ? playerHp <= 0 : winnerSide === "enemy";
    const enemyFainted = !winnerSide ? enemyHp <= 0 : winnerSide === "player";

    // ── Combatant placement (tactical grid) ──────────────────────────────────
    // Bodies stand on their REAL sim-grid tiles (tileToWorld), so the engine's
    // pathfinding around obstacles + advance/retreat is VISIBLE — pets walk the
    // board and weave past walls instead of lining up on fixed lanes. A light
    // separation pass keeps a depth-stacked pair from hiding one behind the
    // other at the camera angle. Motion direction + gap-aware reach derive from
    // the nearest LIVING foe. Computed top-level so VFX spawn from real bodies.
    const placed = (() => {
        const list = party
            ? ([
                { side: "player" as const, snap: party.playerLead, pet: playerPet as Pet | undefined, sprite: playerSprite },
                { side: "player" as const, snap: party.playerReserve, pet: playerReservePet, sprite: playerResSprite },
                { side: "enemy" as const, snap: party.enemyLead, pet: enemyPet as Pet | undefined, sprite: enemySprite },
                { side: "enemy" as const, snap: party.enemyReserve, pet: enemyReservePet, sprite: enemyResSprite },
            ])
                .filter((e) => e.pet && e.snap)
                .map((e) => ({ pet: e.pet!, side: e.side, tile: e.snap.pos, sprite: e.sprite, hp: e.snap.hp, maxHp: e.snap.maxHp, fainted: e.snap.ko || e.snap.hp <= 0 }))
            : [
                { pet: playerPet, side: "player" as const, tile: playerPos, sprite: playerSprite, hp: playerHp, maxHp: Math.max(1, playerPet.hp), fainted: playerFainted },
                { pet: enemyPet, side: "enemy" as const, tile: enemyPos, sprite: enemySprite, hp: enemyHp, maxHp: Math.max(1, enemyPet.hp), fainted: enemyFainted },
            ];
        const positions = spreadPositions(list.map((c) => tileToWorld(c.tile)));
        // Engagement spacing — hold OPPOSING pets a clear screen-x gap apart so a melee
        // strike reads as a DASH across the gap, not a point-blank poke (the gap-aware
        // `reach` below auto-scales to cross it). Render-only; allies untouched, bodies
        // still derive from their sim tiles — just nudged to face off cleanly.
        for (let iter = 0; iter < 2; iter++) {
            for (let i = 0; i < positions.length; i++) {
                for (let j = i + 1; j < positions.length; j++) {
                    if (list[i].side === list[j].side) continue;
                    const dx = positions[j].x - positions[i].x, ax = Math.abs(dx);
                    if (ax < COLISEUM_ENGAGE_GAP) {
                        const dir = dx >= 0 ? 1 : -1, push = (COLISEUM_ENGAGE_GAP - ax) / 2;
                        positions[i].x -= dir * push; positions[j].x += dir * push;
                    }
                }
            }
        }
        return list.map((c, i) => {
            const pos = positions[i];
            // toward + gap-aware reach from the nearest LIVING foe.
            const foes = positions.map((p, j) => ({ p, foe: list[j] })).filter((e) => e.foe.side !== c.side);
            const live = foes.filter((e) => !e.foe.fainted);
            const pool = live.length ? live : foes;
            let toward = c.side === "player" ? 1 : -1;
            let reach = lungeReach(2.5);
            if (pool.length) {
                let bd = Infinity, bp = pool[0].p;
                for (const e of pool) { const d = Math.hypot(e.p.x - pos.x, e.p.z - pos.z); if (d < bd) { bd = d; bp = e.p; } }
                toward = (bp.x - pos.x) >= 0 ? 1 : -1;
                reach = lungeReach(bd);
            }
            return { ...c, pos, toward, reach };
        });
    })();
    const posById = (id: string): { x: number; z: number } => placed.find((c) => c.pet.id === id)?.pos ?? { x: 0, z: 0 };
    // Follow-cam target — frame the living combatants (fall back to all if every
    // pet is down). The CameraRig glides toward this so the shot tracks the fight.
    const camFollow = (() => {
        const living = placed.filter((c) => !c.fainted).map((c) => c.pos);
        // Tight stage: cap the spread so the camera stays close on the clash.
        return cameraForCombatants(living.length ? living : placed.map((c) => c.pos), { maxSpan: 14 });
    })();

    // ── Camera shake amplitude for this beat. ──
    const victimMaxHp = Math.max(1, frame?.actor === "enemy" ? playerPet.hp : enemyPet.hp);
    const heavyHit = !!frame?.damage && frame.damage >= victimMaxHp * 0.18;
    const camState = petBattleCamera({
        resolved: !!winnerSide, isKO: !!frame?.isKO, crit: !!frame?.crit,
        signature: !!frame?.signatureMove, heavyHit,
        activeType: activeAnimEvent?.type, sigCharge: !!frame?.signatureMove && activeAnimEvent?.type === "charge",
    });
    const shakeAmp = camState.className ? shakeAmpForBeat(activeAnimEvent?.type, { isKO: !!frame?.isKO, crit: !!frame?.crit, signature: !!frame?.signatureMove, heavyHit }) : 0;

    // ── VFX + floating-number spawns, keyed on the active beat (mirrors the DOM
    //    renderer's fx effect; uses world coords from the sim tiles). ──
    const [fx, setFx] = useState<FxInstance[]>([]);
    const [labels, setLabels] = useState<LabelInstance[]>([]);
    const [dusts, setDusts] = useState<{ id: number; at: Vec3 }[]>([]);
    const [flash, setFlash] = useState<{ id: number; ko: boolean } | null>(null);   // crit/KO impact-flash overlay
    const seq = useRef(0);
    const flashedMsg = useRef<string | null>(null);   // de-dupes the crit flash to ONE per frame (a flurry emits many damageNumber beats)
    useEffect(() => {
        if (winnerSide || !activeAnimEvent) return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        const beat = activeAnimEvent.type as PetBattleAnimationEventType;
        // Spawn from the acting/target pets' real FORMATION positions (Phase 2),
        // not the sim grid — so VFX land on the bodies, not empty floor.
        const self3 = posById(animActorId); const tgt3 = posById(animTargetId);
        const fromV: Vec3 = [self3.x, FX_Y, self3.z];
        const toV: Vec3 = [tgt3.x, FX_Y, tgt3.z];
        const sigSide = frame?.signatureMove?.side;
        const actorElement = (sigSide ?? frame?.actor) === "enemy" ? enemyPet.element : playerPet.element;

        if (beat === "projectile") {
            // A REAL painted element projectile (fireball / water ball / wind cut /
            // boulder / bolt) flies between them; non-roster elements (None/Shadow/
            // bloodline-only) fall back to the element flipbook.
            const sk = projectileVisual({ element: actorElement }).spriteKey;
            if (sk) {
                const id = seq.current++;
                setFx((p) => [...p, { id, frames: [], from: fromV, to: toV, durationMs: 360, scale: 2.5, projElement: actorElement }]);
            } else {
                const f = bundledJutsuFxFrames(String(activeAnimEvent.vfxKey ?? "none"));
                if (f) { const id = seq.current++; setFx((p) => [...p, { id, frames: f, from: fromV, to: toV, durationMs: 320, scale: 1.1 }]); }
            }
        } else if (beat === "impact" || beat === "beam" || beat === "statusApply" || beat === "charge" || beat === "guard") {
            const focal = beat === "charge" || beat === "guard" ? fromV : toV;
            const pick = petFxSpriteKey({
                beat, actionKind: frame?.actionKind, vfxKey: activeAnimEvent.vfxKey,
                signature: !!frame?.signatureMove, flagship: !!frame?.signatureMove?.flagship,
                element: actorElement, isKO: !!frame?.isKO,
            });
            const f = pick.key ? bundledJutsuFxFrames(pick.key) : null;
            // Combo escalation — each chained hit lands a bigger burst (caps at 6) so a
            // flurry reads as building momentum, not flat repeats. Cosmetic scale only.
            if (f) { const id = seq.current++; const comboMul = 1 + Math.min(frame?.combo ?? 0, 6) * 0.1; setFx((p) => [...p, { id, frames: f, from: focal, durationMs: 360, scale: 1.7 * comboMul }]); }
        }

        // Dust kick-up at the mover's feet on lunges and dodges.
        if (beat === "lunge" || beat === "dodge") {
            const id = seq.current++;
            setDusts((p) => [...p, { id, at: [self3.x, 0.06, self3.z] }]);
        }

        // Floating number on the damage beat.
        if (beat === "damageNumber" && activeAnimEvent.text) {
            const id = seq.current++;
            const cls = frame?.crit ? "damage-number crit-text" : frame?.actionKind === "heal" ? "heal-number" : "damage-number";
            setLabels((p) => [...p, { id, text: activeAnimEvent.text!, className: cls, pos: [toV[0], FX_Y + 0.6, toV[2]] }]);
            window.setTimeout(() => setLabels((p) => p.filter((l) => l.id !== id)), 900);
        }

        // Crit flash synced to the damage reveal — exactly ONE light wash per frame. A
        // crit is a multi-hit flurry (many damageNumber beats), so latch on frame.message
        // to avoid re-pulsing 3-5× per crit. Pure overlay; the whole effect is already
        // gated off under prefers-reduced-motion above. (KO gets its own gold burst below.)
        if (beat === "damageNumber" && frame?.crit && frame?.message !== flashedMsg.current) {
            flashedMsg.current = frame?.message ?? null;
            const id = seq.current++;
            setFlash({ id, ko: false });
            window.setTimeout(() => setFlash((cur) => (cur && cur.id === id ? null : cur)), 170);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animIdx, frame?.message]);

    // KO money-moment — a gold burst on the topple beat. Its OWN effect so it fires even
    // on the result/KO frame (the main VFX effect early-returns once the winner is set,
    // and a KO emits a `ko` beat, never a damageNumber). Off under prefers-reduced-motion.
    useEffect(() => {
        if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        if (activeAnimEvent?.type !== "ko") return;
        const id = seq.current++;
        setFlash({ id, ko: true });
        const t = window.setTimeout(() => setFlash((cur) => (cur && cur.id === id ? null : cur)), 340);
        return () => window.clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animIdx, frame?.message]);

    // ── Per-move toast ("X used Y!"). ──
    const moveName = extractPetMoveName(frame?.message);
    const actorName = frame?.actor === "enemy" ? enemyPet.name : playerPet.name;
    const toast = frame && !frame.isPrefight && frame.actionKind && frame.actionKind !== "result" && moveName
        ? `${actorName} used ${moveName}!` : null;

    // ── Announcer — the DOM renderer's reactive hype caller, ported verbatim.
    //    Empty on routine frames so it only shouts when something earns it. ──
    const commentary: string = (() => {
        if (!frame || frame.isPrefight || frame.actionKind === "result" || winnerSide) return "";
        if (frame.isKO) return "DOWN IT GOES!";
        if (frame.signatureMove) return "SIGNATURE MOVE!";
        if (/endures at 1 HP/.test(frame.message)) return "IT REFUSES TO FALL!";
        if (/Lifeline heals/.test(frame.message)) return "CLUTCH RECOVERY!";
        if (/dodges|evades/.test(frame.message)) return "NOTHING BUT AIR!";
        if (frame.crit) return "CRITICAL HIT!";
        if ((frame.combo ?? 0) >= 3) return `COMBO ×${frame.combo}!`;
        const low = Math.min(playerPct, enemyPct);
        if (low <= 12) return "ONE HIT FROM DEFEAT!";
        if (low <= 30) return "ON THE ROPES!";
        return "";
    })();
    // Signature cut-in banner — shown for the whole signature frame.
    const sigCutin = frame && !winnerSide && frame.signatureMove
        ? { pet: frame.signatureMove.petName, move: frame.signatureMove.name, enemy: frame.signatureMove.side === "enemy" }
        : null;

    return createPortal((
        // Full-screen takeover (like the Tactical Arena) — the duel pops OUT of the
        // page into an immersive fixed overlay instead of a small inline box.
        <div className="pet-combat-takeover" style={{ background: "linear-gradient(#3a2a16, #1a1206 60%, #0a0703)" }}>
            {/* Keyframes for the announcer pop. The signature cut-in uses the shared
                .pet-cutin styles + animation from index.css. */}
            <style>{`
                @keyframes colAnnouncerPop { 0% { transform: translateX(-50%) scale(0.6); opacity: 0; } 25% { transform: translateX(-50%) scale(1.08); opacity: 1; } 75% { transform: translateX(-50%) scale(1); opacity: 1; } 100% { transform: translateX(-50%) scale(0.95); opacity: 0; } }
                @keyframes colFlash { 0% { opacity: 0; } 12% { opacity: 1; } 100% { opacity: 0; } }
                @media (prefers-reduced-motion: reduce) { .col-announcer { animation: none !important; opacity: 1 !important; transform: none !important; } .col-flash { animation: none !important; opacity: 0 !important; } }
            `}</style>
            <Canvas dpr={[1, 2]} camera={{ position: CAM_POS, fov: CAM_FOV }} onCreated={({ camera }) => camera.lookAt(CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2])}>
                <fog attach="fog" args={["#2a1c10", 26, 54]} />
                <ResponsiveCamera />
                <Arena floor={floor} backdrop={backdrop} />
                <ArenaObstacles obstacles={obstacles} tiles={tiles} />
                <PickupOrbs pickups={frame?.pickups} />
                {placed.map((c) => {
                    const pose = petPoseForAvatar(activeAnimEvent, c.pet.id, !!winnerSide && winnerSide === c.side && !c.fainted, c.fainted);
                    // Knockback scales with the hit's damage vs THIS pet's maxHp,
                    // only for the pet currently being struck.
                    const hitPower = c.pet.id === animTargetId
                        ? Math.max(0, Math.min(1, (frame?.damage ?? 0) / Math.max(1, c.maxHp)))
                        : 0;
                    return (
                        <Standee key={c.pet.id} pet={c.pet} side={c.side} pos={c.pos} reach={c.reach} toward={c.toward}
                            pose={pose} hitPower={hitPower} beatKey={animIdx} fainted={c.fainted}
                            texture={c.sprite.texture} bounds={c.sprite.bounds} aspect={c.sprite.aspect} />
                    );
                })}
                {fx.map((f) => (
                    f.projElement !== undefined && f.to
                        ? <ColiseumProjectile key={f.id} element={f.projElement} from={f.from} to={f.to} durationMs={f.durationMs} scale={f.scale}
                            onDone={() => setFx((p) => p.filter((x) => x.id !== f.id))} />
                        : <FxAnim key={f.id} frames={f.frames} from={f.from} to={f.to} durationMs={f.durationMs} scale={f.scale}
                            onDone={() => setFx((p) => p.filter((x) => x.id !== f.id))} />
                ))}
                {dusts.map((d) => (
                    <DustPuff key={d.id} at={d.at} onDone={() => setDusts((p) => p.filter((x) => x.id !== d.id))} />
                ))}
                {labels.map((l) => (
                    <Html key={l.id} position={l.pos} center distanceFactor={9} pointerEvents="none" zIndexRange={[20, 0]}>
                        <span className={l.className} style={{ font: "800 18px Inter, system-ui, sans-serif" }}>{l.text}</span>
                    </Html>
                ))}
                {!orbit && <CameraRig amp={shakeAmp} shakeKey={animIdx} target={camFollow} />}
                {orbit && <PetOrbitControls target={CAM_LOOK} />}
                <BloomFx />
            </Canvas>

            {/* Warm embers drifting over the arena — a "living coliseum". Wrapped in a
                z-index:0 stacking context so the embers paint OVER the 3D canvas but
                UNDER the (z-auto) HUD + result screen (.scene-ambience is z-index:4 on its
                own; the wrapper contains it). Perf-guarded (pauses tab-hidden, off under
                reduced-motion), pointer-events:none. */}
            {desktopPointer && (
                <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
                    <SceneAmbience biome="volcano" intensity={0.55} />
                </div>
            )}
            {/* Impact flash on the money hits — crit = light wash, KO = gold burst. */}
            {flash && <div key={flash.id} className="col-flash" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 6, mixBlendMode: "screen", background: flash.ko ? "radial-gradient(circle at 50% 45%, rgba(255,255,255,0.85), rgba(255,238,196,0.4) 45%, transparent 75%)" : "rgba(255,255,255,0.3)", animation: `colFlash ${flash.ko ? 340 : 170}ms ease-out forwards` }} />}

            {/* ── DOM overlays (not in 3D) ─────────────────────────────────── */}
            {/* Pre-fight VS face-off — reuses the DOM renderer's prefight CSS
                (overlay, slide-ins, countdown pop) over the dimmed 3D arena.
                In 2v2 each side also introduces its reserve as a small chip. */}
            {frame?.isPrefight && (() => {
                const miniSrc = (p?: Pet) => p
                    ? (sharedImages["pet:" + p.id] || sharedImages["pet:" + p.id.replace(/-\d{10,}$/, "")] || p.image || "")
                    : "";
                const reserveChip = (p?: Pet) => p && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, color: "#cbd5e1", font: "600 12px Inter, system-ui, sans-serif" }}>
                        <span style={{ color: "#94a3b8" }}>＋</span>
                        {miniSrc(p) ? <img src={miniSrc(p)} alt={p.name} style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", border: "1px solid #334155" }} /> : null}
                        <span>{p.name} · Lv {p.level}</span>
                    </div>
                );
                const sideCard = (pet: Pet, side: "player" | "enemy", record?: PetBattleRecord, reserve?: Pet) => (
                    <div className={`pet-prefight-side ${side}`}>
                        <div className="pet-prefight-portrait">
                            <PetBattleAvatar pet={pet} side={side} active sharedImages={sharedImages} />
                        </div>
                        <div className={`pet-prefight-name ${side}`}>{pet.name}</div>
                        <div className="pet-prefight-sub">Lv {pet.level} · {pet.rarity}{pet.element && pet.element !== "None" ? ` · ${pet.element}` : ""}</div>
                        <div className="pet-prefight-archetype">{petArchetypeFor(pet)}</div>
                        <div className="pet-prefight-stats">
                            <span><GameIcon name="hp" size={13} /> {pet.hp}</span><span><GameIcon name="sword" size={13} /> {pet.attack}</span><span><GameIcon name="shield" size={13} /> {pet.defense}</span><span><GameIcon name="bolt" size={13} /> {pet.speed}</span>
                        </div>
                        {record && (
                            <div className="pet-prefight-record">
                                {record.wins !== undefined && <><span className="rec-w">{record.wins}W</span> <span className="rec-l">{record.losses ?? 0}L</span></>}
                                {record.rating !== undefined && <span className="rec-elo">{record.wins !== undefined ? " · " : ""}{record.rating} Elo</span>}
                            </div>
                        )}
                        {reserveChip(reserve)}
                    </div>
                );
                return (
                    <div className="pet-prefight-overlay">
                        <div className="pet-prefight-vs">
                            {sideCard(playerPet, "player", playerRecord, playerReservePet)}
                            <span className="pet-prefight-vs-label">VS</span>
                            {sideCard(enemyPet, "enemy", enemyRecord, enemyReservePet)}
                        </div>
                        <div className="pet-prefight-tagline">
                            {prefightCount !== null && prefightCount > 0
                                ? <span className="pet-prefight-count" key={prefightCount}>{prefightCount}</span>
                                : <span className="pet-prefight-go">FIGHT!</span>}
                        </div>
                    </div>
                );
            })()}

            {/* Announcer hype line — top-centre pop, only on dramatic beats. */}
            {commentary && (
                <div key={`ann-${frame?.message}`} className="col-announcer" style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", padding: "7px 18px", background: "rgba(15,23,42,0.88)", border: "1px solid rgba(250,204,21,0.55)", borderRadius: 999, color: "#fde68a", font: "900 15px Inter, system-ui, sans-serif", letterSpacing: "0.06em", textShadow: "0 0 12px rgba(250,204,21,0.45)", whiteSpace: "nowrap", animation: "colAnnouncerPop 1.6s ease-out both", pointerEvents: "none", zIndex: 5 }}>
                    {commentary}
                </div>
            )}

            {/* Signature cut-in — the anime-style PORTRAIT + move-name slam (the rich
                cut-in from the classic renderer; reuses the shared .pet-cutin CSS /
                speed-lines / slam animation from index.css). Full-screen at last. */}
            {sigCutin && (() => {
                const side = sigCutin.enemy ? "enemy" : "player";
                // Use the ACTUAL caster's portrait (correct even when a 2v2 reserve
                // casts), falling back to the lead on that side.
                const sigPet = placed.find((c) => c.side === side && c.pet.name === sigCutin.pet)?.pet
                    ?? (sigCutin.enemy ? enemyPet : playerPet);
                return (
                    <div className={`pet-cutin ${side}`} key={`cutin-${frame?.message}`}>
                        <div className="pet-cutin-portrait">
                            <PetBattleAvatar pet={sigPet} side={side} active sharedImages={sharedImages} />
                        </div>
                        <div className="pet-cutin-text">
                            <span className="pet-cutin-pet">{sigCutin.pet}</span>
                            <span className="pet-cutin-move">{sigCutin.move}!</span>
                        </div>
                    </div>
                );
            })()}

            {toast && (
                <div key={frame?.message} style={{ position: "absolute", top: 56, right: 14, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(15,23,42,0.92)", border: "1px solid #334155", borderRadius: 10, color: "#e2e8f0", font: "700 13px Inter, system-ui, sans-serif", boxShadow: "0 4px 16px #0008" }}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, background: elementColor(actingElement).base }} />
                    {toast}
                </div>
            )}

            <div style={{ position: "absolute", bottom: 14, left: 14, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "rgba(15,23,42,0.92)", border: "1px solid #334155", borderRadius: 10, color: "#e2e8f0", font: "700 13px Inter, system-ui, sans-serif" }}>
                <span style={{ width: 38, height: 38, borderRadius: 8, background: elementColor(playerPet.element).base, display: "grid", placeItems: "center", color: "#0b1020", fontWeight: 800 }}>{playerPet.name.slice(0, 2).toUpperCase()}</span>
                <div>
                    <div>Lv.{playerPet.level} {playerPet.name}</div>
                    <div style={{ width: 150, height: 9, marginTop: 4, background: "#0b1020", borderRadius: 5, overflow: "hidden", border: "1px solid #000" }}>
                        <div style={{ width: `${playerPct}%`, height: "100%", background: "#4ade80", transition: "width .35s" }} />
                    </div>
                </div>
            </div>

            {/* Enemy mini HP (top-left) so both bars read even at distance. */}
            <div style={{ position: "absolute", top: 14, left: 14, padding: "6px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", font: "700 12px Inter, system-ui, sans-serif" }}>
                <div>{enemyPet.name} · {enemyOwner}</div>
                <div style={{ width: 130, height: 8, marginTop: 3, background: "#0b1020", borderRadius: 5, overflow: "hidden", border: "1px solid #000" }}>
                    <div style={{ width: `${enemyPct}%`, height: "100%", background: "#f87171", transition: "width .35s" }} />
                </div>
            </div>

            {result && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(5,7,13,0.55)" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ font: "900 38px Inter, system-ui, sans-serif", color: result === "Victory" ? "#4ade80" : result === "Defeat" ? "#f87171" : "#facc15", textShadow: "0 2px 12px #000" }}>{result}</div>
                        {resultSupplement}
                        {settlementStatus === "pending" && <p style={{ color: "#fde68a", fontWeight: 800 }}>Sealing the Hollow Hound result…</p>}
                        {settlementStatus === "error" && (
                            <div style={{ marginTop: 10 }}>
                                <p style={{ color: "#fecaca", fontWeight: 800 }}>Gate verification paused. Your completed duel is safe to retry.</p>
                                <button onClick={onRetrySettlement} style={resultBtn}>Retry Gate Settlement</button>
                            </div>
                        )}
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                            <button onClick={onReplay} style={resultBtn}>⟲ Replay</button>
                            {onFightAgain && <button onClick={onFightAgain} style={resultBtn}>⚔ Fight again</button>}
                            <button
                                onClick={onExit}
                                disabled={!!settlementStatus && settlementStatus !== "settled"}
                                style={{ ...resultBtn, background: "#334155", opacity: settlementStatus && settlementStatus !== "settled" ? 0.55 : 1 }}
                            >
                                {settlementStatus === "settled" ? "Return to Gate" : "Exit"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <button
                onClick={() => { const next = !sfxMuted; setSfxMuted(next); setPetSfxMuted(next); }}
                title={sfxMuted ? "Unmute battle sound" : "Mute battle sound"}
                style={{ position: "absolute", top: 14, right: 14, width: 34, height: 34, display: "grid", placeItems: "center", background: "rgba(15,23,42,0.85)", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", cursor: "pointer", fontSize: 15 }}
            >
                {sfxMuted ? "🔇" : "🔊"}
            </button>

            {/* Always-visible Exit so a full-screen duel can be left mid-fight (the
                result is already computed + applied, so leaving just skips the replay). */}
            <button
                onClick={onExit}
                disabled={settlementStatus === "pending" || settlementStatus === "error"}
                title={settlementStatus === "pending" || settlementStatus === "error" ? "Waiting for Gate settlement" : "Exit battle"}
                style={{ position: "absolute", top: 14, right: 56, width: 34, height: 34, display: "grid", placeItems: "center", background: "rgba(15,23,42,0.85)", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", cursor: "pointer", fontSize: 16, fontWeight: 700 }}
            >
                ✕
            </button>

            <div style={{ position: "absolute", bottom: 12, right: 14, color: "#64748b", font: "600 11px Inter, system-ui, sans-serif" }}>HD-2D coliseum · ?orbit=1 to rotate</div>
        </div>
    ), document.body);
}
