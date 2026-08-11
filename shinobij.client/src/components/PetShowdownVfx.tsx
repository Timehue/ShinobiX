/*
 * PetShowdownVfx — the painted-effects layer for Pet Showdown.
 *
 * Plays the bundled hand-painted FX flipbooks (src/assets/fx/<key>/NNN.png via
 * lib/jutsu-fx-assets — Foozle / Ninja Adventure / CodeManu, see CREDITS.txt)
 * as additive billboards inside the r3f scene, plus the painted projectile
 * sprites (assets/fx/projectiles/<element>.webp) with a fading trail, melee
 * afterimage streaks, and the signature light pillar. This is what turns a
 * turn-based action from "a sphere flew" into a real anime beat.
 *
 * CLIENT-ONLY (the flipbook loader uses import.meta.glob) and presentation-
 * only: every number rendered here arrived in a server event; nothing feeds
 * back into combat.
 */

/* eslint-disable react-refresh/only-export-components -- the FX layer exports
   its spawn/drive types and the flipbook-key helper alongside the components;
   HMR granularity is irrelevant for a purely visual module. */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { projectileVisual } from "../lib/pet-projectile-vfx";
import type { ShowdownEvent } from "../lib/pet-showdown-api";

/** The slice of the battle's beat/slot state this layer needs. */
export interface VfxBeat {
    event: ShowdownEvent | null;
    startedAt: number;
    durationMs: number;
}
/** petId → current world position map maintained by the battle component. */
export type VfxPositions = ReadonlyMap<string, readonly [number, number, number]>;

// ─── Texture caches ──────────────────────────────────────────────────────────

const flipbookCache = new Map<string, THREE.Texture[] | null>();

function flipbookTextures(key: string): THREE.Texture[] | null {
    if (flipbookCache.has(key)) return flipbookCache.get(key)!;
    const frames = bundledJutsuFxFrames(key);
    if (!frames) {
        flipbookCache.set(key, null);
        return null;
    }
    const loader = new THREE.TextureLoader();
    const textures = frames.map((url) => {
        const t = loader.load(url);
        t.colorSpace = THREE.SRGBColorSpace;
        // Crisp pixel-art frames — no mip smear at billboard scale.
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.LinearFilter;
        return t;
    });
    flipbookCache.set(key, textures);
    return textures;
}

const PROJECTILE_SPRITES: Record<string, string> = {
    fire: new URL("../assets/fx/projectiles/fire.webp", import.meta.url).href,
    water: new URL("../assets/fx/projectiles/water.webp", import.meta.url).href,
    wind: new URL("../assets/fx/projectiles/wind.webp", import.meta.url).href,
    earth: new URL("../assets/fx/projectiles/earth.webp", import.meta.url).href,
    lightning: new URL("../assets/fx/projectiles/lightning.webp", import.meta.url).href,
};

const projectileTexCache = new Map<string, THREE.Texture>();
function projectileTexture(element: string): THREE.Texture | null {
    const key = element.toLowerCase();
    const url = PROJECTILE_SPRITES[key];
    if (!url) return null;
    let t = projectileTexCache.get(key);
    if (!t) {
        t = new THREE.TextureLoader().load(url);
        t.colorSpace = THREE.SRGBColorSpace;
        projectileTexCache.set(key, t);
    }
    return t;
}

/** Impact/one-shot flipbook key for a move — kind identity first (every
 *  buff/debuff/heal family has its own painted burst), element fallback. */
export { impactFlipbookKey, vfxElementTint, VFX_ELEMENT_TINT } from "../lib/showdown-vfx-map";


// ─── One-shot flipbook billboard ─────────────────────────────────────────────

export interface VfxSpawn {
    /** Element tint applied to the painted frames (additive-blended). */
    tint?: string;
    key: number;
    frames: string;
    pos: [number, number, number];
    scale: number;
    startedAt: number;
    durationMs: number;
    /** Height multiplier — sky bolts are tall, impacts are square. */
    aspect?: number;
}

function FlipbookOnce({ spawn }: { spawn: VfxSpawn }) {
    const textures = useMemo(() => flipbookTextures(spawn.frames), [spawn.frames]);
    const mesh = useRef<THREE.Mesh>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    useFrame(() => {
        if (!textures || !mesh.current || !mat.current) return;
        const t = (performance.now() - spawn.startedAt) / spawn.durationMs;
        if (t < 0 || t >= 1) {
            mesh.current.visible = false;
            return;
        }
        mesh.current.visible = true;
        const frame = textures[Math.min(textures.length - 1, Math.floor(t * textures.length))];
        if (mat.current.map !== frame) {
            mat.current.map = frame;
            mat.current.needsUpdate = true;
        }
        // Ease in fast, linger, fade at the tail.
        mat.current.opacity = t < 0.12 ? t / 0.12 : t > 0.78 ? (1 - t) / 0.22 : 1;
    });
    if (!textures) return null;
    return (
        <Billboard position={spawn.pos} lockX lockZ>
            <mesh ref={mesh} visible={false}>
                <planeGeometry args={[spawn.scale, spawn.scale * (spawn.aspect ?? 1)]} />
                <meshBasicMaterial
                    ref={mat}
                    transparent
                    opacity={0}
                    color={spawn.tint ?? "#ffffff"}
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                    toneMapped={false}
                />
            </mesh>
        </Billboard>
    );
}

export function ShowdownVfxLayer({ spawns }: { spawns: VfxSpawn[] }) {
    return <group>{spawns.map((s) => <FlipbookOnce key={s.key} spawn={s} />)}</group>;
}

// ─── Looping status aura (burn keeps burning, poison keeps dripping) ─────────

const STATUS_AURA: Record<string, { frames: string; scale: number; y: number; opacity: number }> = {
    burn: { frames: "burn", scale: 1.5, y: 0.9, opacity: 0.75 },
    wound: { frames: "poison", scale: 1.3, y: 0.9, opacity: 0.7 },
    freeze: { frames: "ice", scale: 1.5, y: 0.9, opacity: 0.75 },
    buff: { frames: "aura", scale: 1.9, y: 0.85, opacity: 0.55 },
    haste: { frames: "aura", scale: 1.6, y: 0.85, opacity: 0.45 },
    // The debuff family lingers on its victim too — a weakened pet LOOKS it.
    debuff: { frames: "shadow", scale: 1.6, y: 0.85, opacity: 0.6 },
    crush: { frames: "shadow", scale: 1.4, y: 0.8, opacity: 0.5 },
    slow: { frames: "vortex", scale: 1.5, y: 0.55, opacity: 0.55 },
    confuse: { frames: "vortex", scale: 1.1, y: 1.9, opacity: 0.65 },
    mark: { frames: "spark", scale: 1.2, y: 1.9, opacity: 0.7 },
    stun: { frames: "spark", scale: 1.4, y: 1.7, opacity: 0.75 },
    // The absorb pool, the redirect and the CC immunity are all things the
    // player has to be able to SEE on a foe; none of them had an aura.
    shield: { frames: "shield", scale: 1.7, y: 0.95, opacity: 0.6 },
    taunt: { frames: "power", scale: 1.5, y: 1.0, opacity: 0.55 },
    steadfast: { frames: "eshield", scale: 1.35, y: 0.8, opacity: 0.45 },
};

/** Which auras win when a pet carries more than two. Raw engine push order used
 *  to decide, so a third status was dropped arbitrarily — a stun mattering less
 *  than a buff purely because of insertion order. */
const AURA_PRIORITY = ["stun", "freeze", "confuse", "shield", "burn", "wound", "taunt", "slow", "debuff", "crush", "mark", "steadfast", "buff", "haste"];

export function StatusAuraFx({ statuses }: { statuses: readonly { kind: string }[] }) {
    // At most two auras so a debuff-stacked pet doesn't become a bonfire.
    const active = statuses
        .filter((s) => STATUS_AURA[s.kind])
        // Sort BEFORE mapping: raw engine push order used to decide which two
        // survived, so a stun could lose its aura to a buff purely because of
        // insertion order.
        .sort((a, b) => AURA_PRIORITY.indexOf(a.kind) - AURA_PRIORITY.indexOf(b.kind))
        .slice(0, 2)
        .map((s) => STATUS_AURA[s.kind]);
    return (
        <group>
            {active.map((aura, i) => <StatusAuraLoop key={`${aura.frames}-${i}`} aura={aura} phase={i * 0.5} />)}
        </group>
    );
}

function StatusAuraLoop({ aura, phase }: { aura: { frames: string; scale: number; y: number; opacity: number }; phase: number }) {
    const textures = useMemo(() => flipbookTextures(aura.frames), [aura.frames]);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const LOOP_MS = 900;
    useFrame(() => {
        if (!textures || !mat.current) return;
        const t = ((performance.now() / LOOP_MS + phase) % 1);
        const frame = textures[Math.floor(t * textures.length) % textures.length];
        if (mat.current.map !== frame) {
            mat.current.map = frame;
            mat.current.needsUpdate = true;
        }
    });
    if (!textures) return null;
    return (
        <Billboard position={[0, aura.y, 0]} lockX lockZ>
            <mesh>
                <planeGeometry args={[aura.scale, aura.scale]} />
                <meshBasicMaterial
                    ref={mat}
                    transparent
                    opacity={aura.opacity}
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                    toneMapped={false}
                />
            </mesh>
        </Billboard>
    );
}

// ─── Beat-driven travel FX (projectile + melee streaks) ──────────────────────
// Owns its drive refs (the react-compiler rule forbids mutating prop-passed
// refs), translates the current beat into them each frame, and renders the
// painted projectile + afterimage streaks.

/** Fraction of an action beat at which the hit lands — keep in sync with the
 *  battle component's STRIKE_FRAC. */
const VFX_STRIKE_FRAC = 0.55;

export function BeatDrivenVfx({ beatRef, posRef }: {
    beatRef: React.MutableRefObject<VfxBeat>;
    posRef: React.MutableRefObject<VfxPositions>;
}) {
    const projectileDrive = useRef<ProjectileDrive>({ active: false, x: 0, y: 0, z: 0, element: "None", kind: "damage", charged: false, progress: 0, fan: 1, dirX: 0, dirZ: 1 });
    const meleeDrive = useRef<MeleeStreakDrive>({ active: false, fromX: 0, fromZ: 0, toX: 0, toZ: 0, element: "None", progress: 0 });

    useFrame(() => {
        const beat = beatRef.current;
        const proj = projectileDrive.current;
        const melee = meleeDrive.current;
        proj.active = false;
        melee.active = false;
        if (beat.event?.t !== "action" || !beat.event.targets.length) return;
        const ev = beat.event;
        const actor = posRef.current.get(ev.actorId);
        const target = posRef.current.get(ev.targets[0].id);
        if (!actor || !target || ev.targets[0].id === ev.actorId) return;
        const frac = (performance.now() - beat.startedAt) / beat.durationMs;

        if (ev.delivery === "ranged" && ev.moveKind !== "heal") {
            const travel = ELEMENT_TRAVEL[ev.element] ?? ELEMENT_TRAVEL.None;
            const t0 = 0.36, t1 = VFX_STRIKE_FRAC;
            if (!travel.instant && frac >= t0 && frac <= t1) {
                const p = (frac - t0) / (t1 - t0);
                const ax = actor[0], az = actor[2];
                const bx = target[0], bz = target[2];
                proj.active = true;
                proj.x = ax + (bx - ax) * p;
                proj.y = 1.2 + Math.sin(p * Math.PI) * travel.arc;
                proj.z = az + (bz - az) * p;
                proj.element = ev.element;
                proj.kind = ev.moveKind;
                proj.charged = ev.super;
                proj.progress = p;
                proj.fan = travel.fan;
                const len = Math.hypot(bx - ax, bz - az) || 1;
                proj.dirX = (bx - ax) / len;
                proj.dirZ = (bz - az) / len;
            }
        } else if (ev.delivery === "melee") {
            // Mirror the fighter's dash window (0.32 → 0.5 of the beat).
            if (frac >= 0.3 && frac <= 0.62) {
                melee.active = true;
                melee.fromX = actor[0];
                melee.fromZ = actor[2];
                melee.toX = target[0];
                melee.toZ = target[2];
                melee.element = ev.element;
                melee.progress = Math.min(1, Math.max(0, (frac - 0.32) / 0.18));
            }
        }
    });

    return (
        <group>
            <PaintedProjectile drive={projectileDrive} />
            <MeleeStreaks drive={meleeDrive} />
        </group>
    );
}

// ─── Painted projectile with trail ───────────────────────────────────────────

const TRAIL_LEN = 7;
const FAN_MAX = 3;

export interface ProjectileDrive {
    /** Current head position, written per-frame by the caller; null = hidden. */
    active: boolean;
    x: number;
    y: number;
    z: number;
    element: string;
    kind: string;
    charged: boolean;
    /** Travel progress 0..1 — drives spin phase so replays look identical. */
    progress: number;
    /** Crescents flying in a fan (Wind); 1 = a single head. */
    fan: number;
    /** Normalized travel direction on the ground plane (for fan spread). */
    dirX: number;
    dirZ: number;
}

/** Per-element travel identity — each element THROWS differently.
 *  arc = peak height of the flight parabola; fan = simultaneous heads;
 *  instant = no travel at all (the sky strikes for you). */
export const ELEMENT_TRAVEL: Record<string, { arc: number; fan: number; instant?: boolean }> = {
    Fire: { arc: 0.35, fan: 1 },          // straight searing fastball
    Water: { arc: 0.12, fan: 1 },         // low skimming wave
    Wind: { arc: 0.55, fan: 3 },          // a fan of three crescents
    Earth: { arc: 1.7, fan: 1 },          // high lobbed boulder
    Lightning: { arc: 0, fan: 1, instant: true },   // sky bolt at the strike
    None: { arc: 0.55, fan: 1 },
};

export function PaintedProjectile({ drive }: { drive: React.MutableRefObject<ProjectileDrive> }) {
    const heads = useRef<Array<THREE.Mesh | null>>([]);
    const headMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const glows = useRef<Array<THREE.Mesh | null>>([]);
    const glowMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const trailRefs = useRef<Array<THREE.Mesh | null>>([]);
    const trail = useRef<Array<{ x: number; y: number; z: number }>>([]);

    useFrame(() => {
        const d = drive.current;
        if (!d.active) {
            for (const m of heads.current) if (m) m.visible = false;
            for (const m of glows.current) if (m) m.visible = false;
            for (const m of trailRefs.current) if (m) m.visible = false;
            trail.current.length = 0;
            return;
        }
        const visual = projectileVisual({ element: d.element, kind: d.kind, charged: d.charged });
        const tex = projectileTexture(d.element);
        const size = visual.size * (d.charged ? 2.4 : 1.8);
        const wobble = Math.sin(d.progress * 24) * visual.wobble * 0.35;
        const flicker = 1 + Math.sin(d.progress * 90) * visual.flicker * 0.3;
        // Fan spread: perpendicular to travel, opens mid-flight, converges at
        // the target (sin envelope). A single head sits at offset 0.
        const fan = Math.max(1, Math.min(FAN_MAX, d.fan));
        const spread = Math.sin(d.progress * Math.PI) * 1.0;
        const perpX = -d.dirZ, perpZ = d.dirX;
        for (let i = 0; i < FAN_MAX; i++) {
            const h = heads.current[i];
            const g = glows.current[i];
            if (!h || !g) continue;
            if (i >= fan) { h.visible = false; g.visible = false; continue; }
            const lane = fan === 1 ? 0 : (i - (fan - 1) / 2) * spread;
            const px = d.x + perpX * lane;
            const pz = d.z + perpZ * lane;
            h.visible = !!tex;
            g.visible = true;
            const mat = headMats.current[i];
            if (mat && tex && mat.map !== tex) {
                mat.map = tex;
                mat.needsUpdate = true;
            }
            h.position.set(px, d.y + wobble, pz);
            h.scale.set(size * visual.stretch * flicker, size * flicker, 1);
            h.rotation.z = visual.spin ? d.progress * visual.spin * 1.2 + i * 2.1 : 0;
            g.position.copy(h.position);
            g.scale.setScalar(size * 1.9 * flicker);
            glowMats.current[i]?.color.set(visual.glow);
        }

        // Trail follows the CENTER head — shrinking fading dots.
        trail.current.unshift({ x: d.x, y: d.y + wobble, z: d.z });
        if (trail.current.length > TRAIL_LEN) trail.current.length = TRAIL_LEN;
        trailRefs.current.forEach((m, i) => {
            if (!m) return;
            const p = trail.current[i + 1];
            if (!p) { m.visible = false; return; }
            m.visible = true;
            m.position.set(p.x, p.y, p.z);
            const f = 1 - (i + 1) / (TRAIL_LEN + 1);
            m.scale.setScalar(size * 0.85 * f * visual.tail);
            (m.material as THREE.MeshBasicMaterial).opacity = 0.4 * f;
            (m.material as THREE.MeshBasicMaterial).color.set(visual.glow);
        });
    });

    return (
        <group>
            {Array.from({ length: FAN_MAX }, (_, i) => (
                <group key={i}>
                    <Billboard>
                        <mesh ref={(el) => { heads.current[i] = el; }} visible={false}>
                            <planeGeometry args={[1, 1]} />
                            <meshBasicMaterial ref={(el) => { headMats.current[i] = el; }} transparent depthWrite={false} toneMapped={false} alphaTest={0.05} />
                        </mesh>
                    </Billboard>
                    <mesh ref={(el) => { glows.current[i] = el; }} visible={false}>
                        <sphereGeometry args={[1, 12, 12]} />
                        <meshBasicMaterial ref={(el) => { glowMats.current[i] = el; }} transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
                    </mesh>
                </group>
            ))}
            {Array.from({ length: TRAIL_LEN }, (_, i) => (
                <mesh key={i} ref={(el) => { trailRefs.current[i] = el; }} visible={false}>
                    <sphereGeometry args={[1, 8, 8]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
                </mesh>
            ))}
        </group>
    );
}

// ─── Melee afterimage streaks ────────────────────────────────────────────────

export interface MeleeStreakDrive {
    active: boolean;
    /** Streak line from → to (the dash path), tinted by element. */
    fromX: number; fromZ: number;
    toX: number; toZ: number;
    element: string;
    /** 0..1 along the dash. */
    progress: number;
}

const STREAK_COUNT = 4;

export function MeleeStreaks({ drive }: { drive: React.MutableRefObject<MeleeStreakDrive> }) {
    const refs = useRef<Array<THREE.Mesh | null>>([]);
    useFrame(() => {
        const d = drive.current;
        refs.current.forEach((m, i) => {
            if (!m) return;
            if (!d.active) { m.visible = false; return; }
            const lag = (i + 1) * 0.12;
            const p = Math.max(0, d.progress - lag);
            if (p <= 0) { m.visible = false; return; }
            m.visible = true;
            const x = d.fromX + (d.toX - d.fromX) * p;
            const z = d.fromZ + (d.toZ - d.fromZ) * p;
            m.position.set(x, 0.9, z);
            const angle = Math.atan2(d.toX - d.fromX, d.toZ - d.fromZ);
            m.rotation.y = angle;
            const fade = (1 - lag * 1.6) * (d.progress < 0.9 ? 1 : (1 - d.progress) / 0.1);
            (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.34 * fade);
            const tint = { Fire: "#ff9a4d", Water: "#67c7ff", Wind: "#8df5d3", Lightning: "#ffe86b", Earth: "#e0b477" }[d.element] ?? "#cbd5f5";
            (m.material as THREE.MeshBasicMaterial).color.set(tint);
        });
    });
    return (
        <group>
            {Array.from({ length: STREAK_COUNT }, (_, i) => (
                <mesh key={i} ref={(el) => { refs.current[i] = el; }} visible={false}>
                    <planeGeometry args={[0.32, 1.5]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
                </mesh>
            ))}
        </group>
    );
}

// ─── Signature light pillar ──────────────────────────────────────────────────

export interface PillarDrive {
    activeUntil: number;
    startedAt: number;
    x: number;
    z: number;
    color: string;
}

export function SuperPillar({ drive }: { drive: React.MutableRefObject<PillarDrive> }) {
    const beam = useRef<THREE.Mesh>(null);
    const beamMat = useRef<THREE.MeshBasicMaterial>(null);
    const ring = useRef<THREE.Mesh>(null);
    const ringMat = useRef<THREE.MeshBasicMaterial>(null);
    useFrame(() => {
        const d = drive.current;
        const now = performance.now();
        const active = now >= d.startedAt && now < d.activeUntil;
        if (beam.current && beamMat.current) {
            beam.current.visible = active;
            if (active) {
                const t = (now - d.startedAt) / Math.max(1, d.activeUntil - d.startedAt);
                beam.current.position.set(d.x, 4.2, d.z);
                const w = 0.9 + Math.sin(now * 0.02) * 0.12;
                beam.current.scale.set(w * (1 - t * 0.4), 1, w * (1 - t * 0.4));
                beamMat.current.color.set(d.color);
                beamMat.current.opacity = 0.5 * (1 - t);
            }
        }
        if (ring.current && ringMat.current) {
            ring.current.visible = active;
            if (active) {
                const t = (now - d.startedAt) / Math.max(1, d.activeUntil - d.startedAt);
                ring.current.position.set(d.x, 0.08, d.z);
                const s = 0.8 + t * 4.2;
                ring.current.scale.set(s, s, s);
                ringMat.current.color.set(d.color);
                ringMat.current.opacity = 0.7 * (1 - t);
            }
        }
    });
    return (
        <group>
            <mesh ref={beam} visible={false}>
                <cylinderGeometry args={[1, 1.25, 8.5, 20, 1, true]} />
                <meshBasicMaterial ref={beamMat} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
                <ringGeometry args={[0.82, 1, 48]} />
                <meshBasicMaterial ref={ringMat} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
        </group>
    );
}
