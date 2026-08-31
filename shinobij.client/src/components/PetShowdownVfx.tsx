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
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { projectileVisual } from "../lib/pet-projectile-vfx";
import { showdownAttackRhythm, showdownMeleeContact } from "../lib/pet-showdown-choreography";
import type { PetVisualQualityConfig } from "../lib/pet-visual-quality";
import type { PetSignaturePerformance } from "../lib/pet-signature-performance";
import { VolumetricSetPiece } from "./PetShowdownVfx3d";
import type { ShowdownEvent } from "../lib/pet-showdown-api";

const ADDITIVE_MATERIAL_PROPS = {
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
} as const;

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

function flipbookTextures(key: string, smooth = false): THREE.Texture[] | null {
    const cacheKey = smooth ? `${key}|smooth` : key;
    if (flipbookCache.has(cacheKey)) return flipbookCache.get(cacheKey)!;
    const frames = bundledJutsuFxFrames(key);
    if (!frames) {
        flipbookCache.set(cacheKey, null);
        return null;
    }
    const loader = new THREE.TextureLoader();
    const textures = frames.map((url) => {
        const t = loader.load(url);
        t.colorSpace = THREE.SRGBColorSpace;
        // Impact-scale bursts keep crisp pixel-art edges (Nearest); the big
        // SET-PIECE layers span several world units, where nearest-neighbour
        // reads as chunky staircase pixels — they filter smooth instead.
        t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
        t.minFilter = THREE.LinearFilter;
        return t;
    });
    flipbookCache.set(cacheKey, textures);
    return textures;
}

const PROJECTILE_SPRITES: Record<string, string> = {
    fire: new URL("../assets/fx/projectiles-v2/fire.webp", import.meta.url).href,
    water: new URL("../assets/fx/projectiles-v2/water.webp", import.meta.url).href,
    wind: new URL("../assets/fx/projectiles-v2/wind.webp", import.meta.url).href,
    earth: new URL("../assets/fx/projectiles-v2/earth.webp", import.meta.url).href,
    lightning: new URL("../assets/fx/projectiles-v2/lightning.webp", import.meta.url).href,
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

// ─── Epic hero sprites (the Champions-scale painted art) ─────────────────────
// Large single-sprite paintings (gen-showdown-vfx.mjs → assets/fx/epic/) that
// the set-piece layer stages as billboards and floor discs: a tsunami wall that
// actually fills the frame, a firewall, a full-height tornado, erupting stone,
// a sky-splitting bolt — plus per-element "the arena floor becomes the element"
// takeover discs. Painted art renders NORMAL-blended (additive would blow the
// foam whites and flame cores out to pure white); only the bolts opt into
// additive glow.

const EPIC_SPRITES: Record<string, string> = {
    tsunami: new URL("../assets/fx/epic/tsunami.webp", import.meta.url).href,
    firewall: new URL("../assets/fx/epic/firewall.webp", import.meta.url).href,
    tornado: new URL("../assets/fx/epic/tornado.webp", import.meta.url).href,
    quake: new URL("../assets/fx/epic/quake.webp", import.meta.url).href,
    stormbolt: new URL("../assets/fx/epic/stormbolt.webp", import.meta.url).href,
    "floor-water": new URL("../assets/fx/epic/floor-water.webp", import.meta.url).href,
    "floor-lava": new URL("../assets/fx/epic/floor-lava.webp", import.meta.url).href,
    "floor-wind": new URL("../assets/fx/epic/floor-wind.webp", import.meta.url).href,
    "floor-earth": new URL("../assets/fx/epic/floor-earth.webp", import.meta.url).href,
    "floor-storm": new URL("../assets/fx/epic/floor-storm.webp", import.meta.url).href,
};

const epicTexCache = new Map<string, THREE.Texture>();
export function epicTexture(slug: string): THREE.Texture | null {
    const url = EPIC_SPRITES[slug];
    if (!url) return null;
    let t = epicTexCache.get(slug);
    if (!t) {
        t = new THREE.TextureLoader().load(url);
        t.colorSpace = THREE.SRGBColorSpace;
        epicTexCache.set(slug, t);
    }
    return t;
}

/** Impact/one-shot flipbook key for a move — kind identity first (every
 *  buff/debuff/heal family has its own painted burst), element fallback. */
export { castFlipbookKey, impactFlipbookKey, vfxElementTint, VFX_ELEMENT_TINT } from "../lib/showdown-vfx-map";


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
    /** Render normal-blended instead of additive. Required by the baked
     *  simulation atlases: additive erases their dark smoke body entirely,
     *  which is exactly what happened to the set-piece layers in round 42. */
    normalBlend?: boolean;
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
                    {...ADDITIVE_MATERIAL_PROPS}
                    color={spawn.tint ?? "#ffffff"}
                    blending={spawn.normalBlend ? THREE.NormalBlending : THREE.AdditiveBlending}
                />
            </mesh>
        </Billboard>
    );
}

export function ShowdownVfxLayer({ spawns }: { spawns: VfxSpawn[] }) {
    return <group>{spawns.map((s) => <FlipbookOnce key={s.key} spawn={s} />)}</group>;
}

// ─── Elemental set-pieces ────────────────────────────────────────────────────
// The spectacle tier above the impact burst: heavy and signature casts stage
// their element as an EVENT in the arena — a wave that actually travels, a
// tornado that actually spins — instead of one more billboard popping on the
// victim. Purely presentational; the wire carries only element/weight and the
// battle component decides when a cast earned one.

export interface SetPieceSpawn {
    key: number;
    element: string;
    /** Caster's position — where a traveling piece starts. */
    from: readonly [number, number, number];
    /** Victim's position — where every piece lands. */
    to: readonly [number, number, number];
    startedAt: number;
    durationMs: number;
    /** Signature cast: the element stages its SUPER choreography — the bigger
     *  multi-layer sequence under the letterbox — instead of the heavy piece. */
    superCast?: boolean;
}

/** One animated layer of a set-piece. All motion derives from the normalized
 *  clock, so fast-forward scales everything together. A layer is either a
 *  flipbook accent (`frames`) or a painted EPIC sprite (`sprite`) — the hero
 *  art carries the spectacle, the flipbooks add spray/embers/debris texture. */
interface SetPieceLayer {
    /** Flipbook key (assets/fx/<key>/NNN.png) — accent tier. */
    frames?: string;
    /** Epic sprite slug (assets/fx/epic/<slug>.webp) — hero tier. */
    sprite?: string;
    /** Width in world units; height = width × aspect. */
    scale: number;
    aspect: number;
    /** Fraction of the piece's life before this layer joins in. */
    delay: number;
    /** Fraction of the piece's life this layer lives (default: the rest).
     *  Short-dur layers strobe — the storm's staggered bolt strikes. */
    dur?: number;
    /** Vertical ride: start → end height above the floor. */
    y0: number;
    y1: number;
    /** 1 = travels from→to (the wave); 0 = sits on the victim. */
    travel: number;
    /** Full view-axis turns over the layer's life (flipbook vortices only —
     *  spinning a painted tornado sprite reads as the column tumbling). */
    spin: number;
    tint?: string;
    /** Growth over life: rendered scale goes scale → scale×grow. */
    grow: number;
    /** Stationary layers only: park at this fraction of the caster→victim
     *  lane instead of on the victim (marching eruptions, walking bolts). */
    lane?: number;
    /** Sideways offset in world units, perpendicular-ish via X (bolt spread). */
    offsetX?: number;
    /** Gentle z-rock in radians — the wave crest rolling, flames licking. */
    sway?: number;
    /** Scale flicker amplitude — fire shimmer, bolt crackle. */
    puls?: number;
    /** Mirror the art horizontally so repeated sprites don't read as clones. */
    flip?: boolean;
    /** Painted sprites render normal-blended by default; bolts opt back into
     *  additive so they FLASH. (Flipbook accents are additive unless
     *  normalBlend is set — the Blender-baked smoke/mist atlases carry DARK
     *  body that additive blending would erase.) */
    add?: boolean;
    normalBlend?: boolean;
}

/** "The arena floor becomes the element" — the single biggest ingredient of
 *  the Champions look. A painted disc laid flat over the whole arena floor
 *  while the set-piece plays: ocean under the tsunami, magma under the
 *  firestorm, a flattened cyclone under the tornado. */
interface FloorTakeover {
    sprite: string;
    /** Disc diameter in world units (arena floor is r14). */
    scale: number;
    opacity: number;
    /** Slow turns over the piece's life — the cyclone spins, cracks don't. */
    spin: number;
    /** Growth over life — spreading cracks, rising flood. */
    grow: number;
    /** Multiply tint over the painted disc — the reference water reads DEEP
     *  blue under its foam, not turquoise; a darkening tint buys that depth
     *  without regenerating the art. */
    tint?: string;
}

const FLOOR_TAKEOVERS: Record<string, FloorTakeover> = {
    // Scale 30: the square plane's edge midpoints land at r15, past the r14
    // floor circle, so the painted disc's own soft fade is the only edge the
    // camera can ever see (26 left a straight texture cut on the near floor).
    Water: { sprite: "floor-water", scale: 30, opacity: 0.92, spin: 0.06, grow: 1.06, tint: "#9cc4de" },
    Fire: { sprite: "floor-lava", scale: 30, opacity: 0.88, spin: 0, grow: 1.1 },
    Wind: { sprite: "floor-wind", scale: 30, opacity: 0.72, spin: 0.45, grow: 1.08 },
    Earth: { sprite: "floor-earth", scale: 30, opacity: 0.92, spin: 0, grow: 1.12 },
    Lightning: { sprite: "floor-storm", scale: 30, opacity: 0.82, spin: 0.05, grow: 1.06 },
};

const SET_PIECES: Record<string, SetPieceLayer[]> = {
    // ACCENT layers only — the volumetric structures (PetShowdownVfx3d) carry
    // the read from every angle; the painted art stays where a flat plane
    // still earns its place: the distant mother-wave behind the 3D shell, the
    // grounded dust and spray, the spark pops between real bolt strikes.
    Water: [
        { sprite: "tsunami", scale: 7.6, aspect: 0.667, delay: 0.08, y0: 0.5, y1: 0.95, travel: 1, spin: 0, grow: 1.2, sway: 0.03, tint: "#dcf2ff" },
    ],
    Fire: [
        { frames: "lava", scale: 3.2, aspect: 0.6, delay: 0.3, y0: 0.25, y1: 0.3, travel: 0, spin: 0, grow: 1.35 },
    ],
    Wind: [
        { frames: "vortex", scale: 2.6, aspect: 0.9, delay: 0.1, y0: 0.25, y1: 0.45, travel: 0, spin: 2.4, grow: 1.3, tint: "#c8ffe9" },
    ],
    Earth: [
        { frames: "impact", scale: 2.8, aspect: 0.6, delay: 0.3, y0: 0.25, y1: 0.55, travel: 0, spin: 0, grow: 1.3, tint: "#d8a86a" },
    ],
    Lightning: [
        { frames: "spark", scale: 2.6, aspect: 0.8, delay: 0.16, dur: 0.3, y0: 0.7, y1: 0.9, travel: 0, spin: 0, grow: 1.35, tint: "#fff6c0" },
    ],
};

/** The SIGNATURE choreography — what plays under the letterbox, now on the
 *  painted hero art at full frame-filling scale WITH the floor takeover. The
 *  flood comes as two sweeping crests and a final breaking wall; the firestorm
 *  builds in mirrored sheets until the whole line is engulfed; the storm WALKS
 *  three strikes down the lane onto the victim. The one moment per fight that
 *  is allowed to shout. */
const SUPER_SET_PIECES: Record<string, SetPieceLayer[]> = {
    // Signature ACCENTS over the volumetric choreography: the mother wave
    // towering behind the 3D shell, the overhead fire bloom, the debris skirt,
    // the grounded dust, the final spark pop. The structures themselves live
    // in PetShowdownVfx3d.
    Fire: [
        // Painted firewall is the silhouette/read layer. Keep it first so it
        // survives every quality tier's translucent-layer budget.
        { sprite: "firewall", scale: 10.2, aspect: 0.667, delay: 0.02, y0: 0.55, y1: 1.15, travel: 0, spin: 0, grow: 1.22, sway: 0.02, tint: "#fff0dc" },
        // Blender-baked Mantaflow plume: real simulated smoke with a burning
        // core rises over the shader flame crown (normal-blended — the dark
        // smoke body would vanish under additive).
        { frames: "plume", scale: 4.2, aspect: 1.0, delay: 0.3, y0: 1.4, y1: 2.7, travel: 0, spin: 0, grow: 1.35, normalBlend: true },
        { frames: "lava", scale: 4.0, aspect: 0.6, delay: 0.3, y0: 0.25, y1: 0.3, travel: 0, spin: 0, grow: 1.45 },
    ],
    Water: [
        { sprite: "tsunami", scale: 10.5, aspect: 0.667, delay: 0, y0: 0.6, y1: 1.2, travel: 1, spin: 0, grow: 1.26, sway: 0.03, tint: "#e6f6ff" },
        { sprite: "tsunami", scale: 7.2, aspect: 0.667, delay: 0.22, y0: 0.45, y1: 0.9, travel: 1, spin: 0, grow: 1.2, flip: true, tint: "#bfe6ff" },
        // Blender-baked Mantaflow spray: the torn white water a breaking crest
        // throws forward. The painted tsunami gives the wave its SHAPE and the
        // shader volume its body, but neither can produce foam — which is why
        // the surf read as a translucent dome instead of water. Normal-blended
        // and travelling with the crest, so it sweeps rather than sits.
        { frames: "surf", scale: 6.4, aspect: 1.0, delay: 0.26, y0: 0.35, y1: 0.95, travel: 1, spin: 0, grow: 1.4, normalBlend: true, tint: "#eaf9ff" },
        { frames: "water", scale: 4.2, aspect: 0.5, delay: 0.52, y0: 0.3, y1: 0.7, travel: 0, spin: 0, grow: 1.5, tint: "#e8f8ff" },
        { frames: "mist", scale: 3.6, aspect: 1.0, delay: 0.5, y0: 0.5, y1: 1.7, travel: 0, spin: 0, grow: 1.45, normalBlend: true },
    ],
    Wind: [
        // The authored tornado supplies a readable column behind the shader
        // vortex; it stays upright while the accent flipbook does the spin.
        { sprite: "tornado", scale: 7.8, aspect: 1.5, delay: 0.02, y0: 0.45, y1: 1.3, travel: 0, spin: 0, grow: 1.2, sway: 0.025, tint: "#e0fff1" },
        { frames: "vortex", scale: 3.2, aspect: 0.9, delay: 0.08, y0: 0.3, y1: 0.5, travel: 0, spin: 3.2, grow: 1.5, tint: "#c8ffe9" },
        { frames: "wind", scale: 4.6, aspect: 0.8, delay: 0.4, y0: 0.5, y1: 1.1, travel: 0, spin: 0, grow: 1.35 },
    ],
    Earth: [
        // The large quake painting restores the arena-scale fissure/read that
        // was authored but previously unreachable from the live renderer.
        { sprite: "quake", scale: 10.2, aspect: 0.667, delay: 0.03, y0: 0.38, y1: 0.78, travel: 0, spin: 0, grow: 1.24, tint: "#f0d2a0" },
        { frames: "impact", scale: 3.2, aspect: 0.6, delay: 0.55, y0: 0.3, y1: 0.6, travel: 0, spin: 0, grow: 1.35, tint: "#d8a86a" },
    ],
    Lightning: [
        // Keep the authored branching and blue-violet values. Additive
        // compositing turned its pale canvas into a featureless white slab
        // once the point light and bloom arrived on the same frame.
        { sprite: "stormbolt", scale: 7.8, aspect: 1.5, delay: 0.02, dur: 0.72, y0: 0.85, y1: 1.25, travel: 0, spin: 0, grow: 1.18, puls: 0.025, tint: "#dce8ff" },
        { frames: "spark", scale: 3.4, aspect: 0.8, delay: 0.52, dur: 0.35, y0: 0.8, y1: 1.1, travel: 0, spin: 0, grow: 1.45, tint: "#fff6c0" },
    ],
};

function SetPieceLayerMesh({ spawn, layer }: { spawn: SetPieceSpawn; layer: SetPieceLayer }) {
    const textures = useMemo(() => (layer.frames ? flipbookTextures(layer.frames, true) : null), [layer.frames]);
    const sprite = useMemo(() => (layer.sprite ? epicTexture(layer.sprite) : null), [layer.sprite]);
    const offsetX = layer.offsetX ?? 0;
    const group = useRef<THREE.Group>(null);
    const mesh = useRef<THREE.Mesh>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    useFrame((state) => {
        if ((!textures && !sprite) || !group.current || !mesh.current || !mat.current) return;
        const life = (performance.now() - spawn.startedAt) / spawn.durationMs;
        // The layer's own clock starts after its stagger and fills its `dur`
        // (default: the rest of the piece). Short durs strobe — bolt strikes.
        const span = Math.max(0.05, layer.dur ?? (1 - layer.delay));
        const t = (life - layer.delay) / span;
        if (t < 0 || t >= 1) {
            mesh.current.visible = false;
            return;
        }
        mesh.current.visible = true;
        if (textures) {
            const frame = textures[Math.min(textures.length - 1, Math.floor(t * textures.length))];
            if (mat.current.map !== frame) {
                mat.current.map = frame;
                mat.current.needsUpdate = true;
            }
        } else if (sprite && mat.current.map !== sprite) {
            mat.current.map = sprite;
            mat.current.needsUpdate = true;
        }
        // Ease-out travel: the wave arrives fast and breaks slow. Stationary
        // layers park on the victim, or at their `lane` fraction of the
        // caster→victim line — the marching eruptions and walking bolts.
        const ease = 1 - (1 - t) * (1 - t);
        const parkFrac = layer.travel ? ease : (layer.lane ?? 1);
        const x = spawn.from[0] + (spawn.to[0] - spawn.from[0]) * parkFrac + offsetX;
        const z = spawn.from[2] + (spawn.to[2] - spawn.from[2]) * parkFrac;
        const y = layer.y0 + (layer.y1 - layer.y0) * ease;
        // Move the BILLBOARD GROUP, not the mesh inside it. The billboard
        // rotates about its own origin — a mesh offset inside it ORBITS when
        // the camera goes off-axis, which detached every piece from its victim
        // in side/high shots (the art drifted to mid-arena while the pet only
        // wore the small burst). Group at the world point, mesh at local zero:
        // the painting pivots in place, pinned to the pet it is hitting.
        group.current.position.set(x, y, z);
        const flick = layer.puls ? 1 + Math.sin(t * 43) * layer.puls : 1;
        const s = (1 + (layer.grow - 1) * ease) * flick;
        mesh.current.scale.set(layer.flip ? -s : s, s, 1);
        mesh.current.rotation.z = layer.spin * t * Math.PI * 2 + (layer.sway ? Math.sin(t * 11) * layer.sway : 0);
        // NEAR-FADE: an action-camera cut can land INSIDE a big piece, where a
        // textured plane reads as a hard-edged pane of glass. Pieces dissolve
        // as the lens closes in, so no cut can ever show a plane's edge.
        const camD = state.camera.position.distanceTo(group.current.position);
        const nearFade = Math.min(1, Math.max(0, (camD - 1.6) / 2.4));
        const opacityCap = layer.sprite === "tornado" ? 0.66 : layer.sprite ? 0.8 : layer.normalBlend ? 0.72 : 0.68;
        mat.current.opacity = (t < 0.14 ? t / 0.14 : t > 0.72 ? Math.max(0, (1 - t) / 0.28) : 1) * nearFade * opacityCap;
    });
    if (!textures && !sprite) return null;
    // Hero sprites face the lens FULLY (no axis lock): the action camera's high
    // enemy-side shots looked at yaw-locked planes edge-on and the painting
    // collapsed into a smear on the floor. Small flipbook accents keep the
    // yaw-only lock — they're ground-anchored texture, not the picture.
    const billboardProps = layer.sprite ? {} : { lockX: true, lockZ: true };
    return (
        <Billboard ref={group} {...billboardProps}>
            <mesh ref={mesh} visible={false}>
                <planeGeometry args={[layer.scale, layer.scale * layer.aspect]} />
                <meshBasicMaterial
                    ref={mat}
                    {...ADDITIVE_MATERIAL_PROPS}
                    color={layer.tint ?? "#ffffff"}
                    // Painted hero art keeps its true values (foam whites, flame
                    // cores) under normal blending; flipbook accents and bolts
                    // glow additive.
                    blending={(layer.sprite || layer.normalBlend) && !layer.add ? THREE.NormalBlending : THREE.AdditiveBlending}
                    side={THREE.DoubleSide}
                />
            </mesh>
        </Billboard>
    );
}

/** The floor-takeover disc: painted element laid flat over the arena floor,
 *  fading in under the choreography and out with it. */
function FloorTakeoverMesh({ spawn, floor, presence }: { spawn: SetPieceSpawn; floor: FloorTakeover; presence: number }) {
    const sprite = useMemo(() => epicTexture(floor.sprite), [floor.sprite]);
    const mesh = useRef<THREE.Mesh>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    useFrame(() => {
        if (!sprite || !mesh.current || !mat.current) return;
        const t = (performance.now() - spawn.startedAt) / spawn.durationMs;
        if (t < 0 || t >= 1) {
            mesh.current.visible = false;
            return;
        }
        mesh.current.visible = true;
        if (mat.current.map !== sprite) {
            mat.current.map = sprite;
            mat.current.needsUpdate = true;
        }
        const ease = 1 - (1 - t) * (1 - t);
        const s = floor.scale * (1 + (floor.grow - 1) * ease) * presence;
        mesh.current.scale.set(s, s, 1);
        mesh.current.rotation.z = floor.spin * t * Math.PI * 2;
        const env = t < 0.18 ? t / 0.18 : t > 0.74 ? Math.max(0, (1 - t) / 0.26) : 1;
        mat.current.opacity = floor.opacity * presence * env;
    });
    if (!sprite) return null;
    return (
        <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]} visible={false}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial ref={mat} color={floor.tint ?? "#ffffff"} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
    );
}

function SetPieceOnce({ spawn, quality }: { spawn: SetPieceSpawn; quality: PetVisualQualityConfig }) {
    const layers = (spawn.superCast ? SUPER_SET_PIECES[spawn.element] : undefined) ?? SET_PIECES[spawn.element];
    if (!layers) return null;
    const floor = FLOOR_TAKEOVERS[spawn.element];
    return (
        <group>
            {floor && <FloorTakeoverMesh spawn={spawn} floor={floor} presence={spawn.superCast ? 1 : 0.55} />}
            {/* The 3D structure (wave shell / flame crown / vortex cones /
                real rocks / procedural bolt + particles + light + shock ring)
                — reads from every camera; the flat layers are accents now. */}
            <VolumetricSetPiece spawn={spawn} quality={quality} />
            {layers.slice(0, quality.translucentLayers).map((layer, i) => (
                <SetPieceLayerMesh key={i} spawn={spawn} layer={layer} />
            ))}
        </group>
    );
}

export function ShowdownSetPieceLayer({ spawns, quality }: { spawns: SetPieceSpawn[]; quality: PetVisualQualityConfig }) {
    return <group>{spawns.map((s) => <SetPieceOnce key={s.key} spawn={s} quality={quality} />)}</group>;
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
    movelock: { frames: "magma", scale: 1.45, y: 0.42, opacity: 0.62 },
    confuse: { frames: "vortex", scale: 1.1, y: 1.9, opacity: 0.65 },
    mark: { frames: "spark", scale: 1.2, y: 1.9, opacity: 0.7 },
    stun: { frames: "spark", scale: 1.4, y: 1.7, opacity: 0.75 },
    // The absorb pool, the redirect and the CC immunity are all things the
    // player has to be able to SEE on a foe; none of them had an aura.
    shield: { frames: "shield", scale: 1.7, y: 0.95, opacity: 0.6 },
    protect: { frames: "eshield", scale: 1.85, y: 0.95, opacity: 0.68 },
    taunt: { frames: "power", scale: 1.5, y: 1.0, opacity: 0.55 },
    steadfast: { frames: "eshield", scale: 1.35, y: 0.8, opacity: 0.45 },
};

/** Which auras win when a pet carries more than two. Raw engine push order used
 *  to decide, so a third status was dropped arbitrarily — a stun mattering less
 *  than a buff purely because of insertion order. */
const AURA_PRIORITY = ["stun", "freeze", "confuse", "protect", "shield", "movelock", "burn", "wound", "taunt", "slow", "debuff", "crush", "mark", "steadfast", "buff", "haste"];

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
                    {...ADDITIVE_MATERIAL_PROPS}
                    opacity={aura.opacity}
                />
            </mesh>
        </Billboard>
    );
}

// ─── Beat-driven travel FX (projectile + melee streaks) ──────────────────────
// Owns its drive refs (the react-compiler rule forbids mutating prop-passed
// refs), translates the current beat into them each frame, and renders the
// painted projectile + afterimage streaks.

export function BeatDrivenVfx({ beatRef, posRef, radii, signatures }: {
    beatRef: React.MutableRefObject<VfxBeat>;
    posRef: React.MutableRefObject<VfxPositions>;
    radii: ReadonlyMap<string, number>;
    signatures?: ReadonlyMap<string, PetSignaturePerformance>;
}) {
    const projectileDrive = useRef<ProjectileDrive>({ active: false, x: 0, y: 0, z: 0, element: "None", kind: "damage", charged: false, progress: 0, fan: 1, dirX: 0, dirZ: 1, signature: null });
    const meleeDrive = useRef<MeleeStreakDrive>({ active: false, fromX: 0, fromZ: 0, toX: 0, toZ: 0, contactX: 0, contactZ: 0, element: "None", progress: 0, impactProgress: -1, heavy: false, signature: null });

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
        const signature = signatures?.get(ev.actorId) ?? null;
        const frac = (performance.now() - beat.startedAt) / beat.durationMs;
        const rhythm = showdownAttackRhythm({
            weight: ev.weight,
            superMove: ev.super,
            delivery: ev.delivery,
            moveKind: ev.moveKind,
        });

        if (ev.delivery === "ranged" && ev.moveKind !== "heal") {
            const travel = ELEMENT_TRAVEL[ev.element] ?? ELEMENT_TRAVEL.None;
            const t0 = rhythm.windupStart + (rhythm.contact - rhythm.windupStart) * 0.46;
            const t1 = rhythm.contact;
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
                proj.signature = signature;
            }
        } else if (ev.delivery === "melee") {
            // Mirror the fighter's acceleration/contact/recovery window. The
            // wake terminates at the same profile-sized SURFACE point as the
            // body instead of drawing through the target's centre.
            if (frac >= rhythm.windupStart && frac <= rhythm.contactEnd) {
                const contact = showdownMeleeContact(
                    actor[0], actor[2], target[0], target[2],
                    radii.get(ev.actorId) ?? 0.82,
                    radii.get(ev.targets[0].id) ?? 0.82,
                    signature?.strikeDrive ?? 1,
                );
                melee.active = true;
                melee.fromX = actor[0];
                melee.fromZ = actor[2];
                melee.toX = contact.x;
                melee.toZ = contact.z;
                melee.contactX = contact.impactX;
                melee.contactZ = contact.impactZ;
                melee.element = ev.element;
                melee.progress = Math.min(1, Math.max(0, (frac - rhythm.dashStart) / Math.max(0.01, rhythm.contact - rhythm.dashStart)));
                melee.impactProgress = frac < rhythm.contact ? -1 : Math.min(1, (frac - rhythm.contact) / Math.max(0.01, rhythm.contactEnd - rhythm.contact));
                melee.heavy = ev.super || ev.weight === "heavy";
                melee.signature = signature;
            }
        }
    });

    return (
        <group>
            <PaintedProjectile drive={projectileDrive} />
            <MeleeStreaks drive={meleeDrive} />
            <MeleeContactBurst drive={meleeDrive} />
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
    signature: PetSignaturePerformance | null;
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
        const signatureScale = d.signature?.projectileScale ?? 1;
        const signaturePhase = d.signature?.phase ?? 0;
        const size = visual.size * (d.charged ? 2.4 : 1.8) * signatureScale;
        const wobble = Math.sin(d.progress * 24 + signaturePhase) * visual.wobble * 0.35 * (d.signature?.trailSpread ?? 1);
        const flicker = 1 + Math.sin(d.progress * 90 + signaturePhase * 2) * visual.flicker * 0.3;
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
            h.rotation.z = (visual.spin ? d.progress * visual.spin * 1.2 + i * 2.1 : 0) + (d.signature?.impactTwist ?? 0);
            g.position.copy(h.position);
            g.scale.setScalar(size * 1.9 * flicker);
            glowMats.current[i]?.color.set(d.signature?.highlight ?? visual.glow);
        }

        // Trail follows the CENTER head — shrinking fading dots.
        const signatureDrift = Math.sin(d.progress * Math.PI * 2 + signaturePhase)
            * 0.08 * (d.signature?.trailSpread ?? 1);
        trail.current.unshift({ x: d.x - d.dirZ * signatureDrift, y: d.y + wobble, z: d.z + d.dirX * signatureDrift });
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
            (m.material as THREE.MeshBasicMaterial).color.set(d.signature?.accent ?? visual.glow);
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
                        <meshBasicMaterial ref={(el) => { glowMats.current[i] = el; }} {...ADDITIVE_MATERIAL_PROPS} opacity={0.28} />
                    </mesh>
                </group>
            ))}
            {Array.from({ length: TRAIL_LEN }, (_, i) => (
                <mesh key={i} ref={(el) => { trailRefs.current[i] = el; }} visible={false}>
                    <sphereGeometry args={[1, 8, 8]} />
                    <meshBasicMaterial {...ADDITIVE_MATERIAL_PROPS} />
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
    /** Visible surface collision point — never the target's hidden centre. */
    contactX: number; contactZ: number;
    element: string;
    /** 0..1 along the dash. */
    progress: number;
    /** -1 before arrival, then 0..1 through the contact bloom. */
    impactProgress: number;
    /** Heavy contact dashes push a stronger, wider wake. */
    heavy: boolean;
    signature: PetSignaturePerformance | null;
}

const STREAK_COUNT = 6;

export function MeleeStreaks({ drive }: { drive: React.MutableRefObject<MeleeStreakDrive> }) {
    const refs = useRef<Array<THREE.Mesh | null>>([]);
    const streakGeometry = useMemo(() => {
        // A five-point tapered brush cut. The old PlaneGeometry exposed its
        // rectangular bounds under bloom, especially once several lanes were
        // visible together; this silhouette reads as a speed slash at any tint.
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute([
            0, -0.82, 0,
            0.17, -0.18, 0,
            0.055, 0.82, 0,
            -0.055, 0.82, 0,
            -0.17, -0.18, 0,
        ], 3));
        geometry.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]);
        geometry.computeVertexNormals();
        return geometry;
    }, []);
    useEffect(() => () => streakGeometry.dispose(), [streakGeometry]);
    useFrame(() => {
        const d = drive.current;
        refs.current.forEach((m, i) => {
            if (!m) return;
            if (!d.active) { m.visible = false; return; }
            const laneCount = d.signature?.trailLanes ?? 4;
            if (i >= laneCount) { m.visible = false; return; }
            const lag = (i + 1) * 0.12;
            const p = Math.max(0, d.progress - lag);
            if (p <= 0) { m.visible = false; return; }
            m.visible = true;
            const x = d.fromX + (d.toX - d.fromX) * p;
            const z = d.fromZ + (d.toZ - d.fromZ) * p;
            const pathX = d.toX - d.fromX;
            const pathZ = d.toZ - d.fromZ;
            const pathLength = Math.hypot(pathX, pathZ) || 1;
            const lane = (i - (laneCount - 1) / 2) * 0.075 * (d.signature?.trailSpread ?? 1) * Math.sin(p * Math.PI);
            m.position.set(x - pathZ / pathLength * lane, 0.72 + (i % 3) * 0.16, z + pathX / pathLength * lane);
            const angle = Math.atan2(d.toX - d.fromX, d.toZ - d.fromZ);
            m.rotation.y = angle;
            m.rotation.z = (d.signature?.impactTwist ?? 0) * (0.35 + i * 0.08);
            const fade = (1 - lag * 1.6) * (d.progress < 0.9 ? 1 : (1 - d.progress) / 0.1);
            // An ELEMENTAL contact dash earns a real wake; the neutral jab
            // keeps the faint one. Heavies push wider and brighter still.
            const elemental = d.element !== "None";
            const strength = (elemental ? 0.38 : 0.2) * (d.heavy ? 1.28 : 1) * (d.signature?.aura ?? 1);
            (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, strength * fade);
            const w = (elemental ? 1.3 : 1) * (d.heavy ? 1.25 : 1);
            m.scale.set(w, w, 1);
            const tint = { Fire: "#ff9a4d", Water: "#67c7ff", Wind: "#8df5d3", Lightning: "#ffe86b", Earth: "#e0b477" }[d.element] ?? "#cbd5f5";
            (m.material as THREE.MeshBasicMaterial).color.set(i % 2 && d.signature ? d.signature.accent : tint);
        });
    });
    return (
        <group>
            {Array.from({ length: STREAK_COUNT }, (_, i) => (
                <mesh key={i} ref={(el) => { refs.current[i] = el; }} geometry={streakGeometry} visible={false}>
                    <meshBasicMaterial {...ADDITIVE_MATERIAL_PROPS} side={THREE.DoubleSide} />
                </mesh>
            ))}
        </group>
    );
}

/** Immediate melee contact punctuation. Painted element bursts still carry the
 * move identity; this white-hot star, pressure ring and six cut lines make the
 * exact collision frame impossible to lose inside a large target silhouette. */
export function MeleeContactBurst({ drive }: { drive: React.MutableRefObject<MeleeStreakDrive> }) {
    const root = useRef<THREE.Group>(null);
    const coreMat = useRef<THREE.MeshBasicMaterial>(null);
    const groundMat = useRef<THREE.MeshBasicMaterial>(null);
    const shellMat = useRef<THREE.MeshBasicMaterial>(null);
    const rayMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const rayRefs = useRef<Array<THREE.Mesh | null>>([]);
    const rayRoot = useRef<THREE.Group>(null);

    useFrame(() => {
        const d = drive.current;
        const p = d.impactProgress;
        const active = d.active && p >= 0 && p < 1;
        if (!root.current) return;
        root.current.visible = active;
        if (!active) return;

        const tint = { Fire: "#ff9a4d", Water: "#67d7ff", Wind: "#8df5d3", Lightning: "#fff27a", Earth: "#e0b477" }[d.element] ?? "#dbeafe";
        const open = 1 - Math.pow(1 - p, 3);
        const fade = (1 - p) * (1 - p);
        const weight = (d.heavy ? 1.3 : 1) * (d.signature?.impactScale ?? 1);
        root.current.position.set(d.contactX, 0.06, d.contactZ);
        root.current.scale.setScalar((0.5 + open * 1.75) * weight);
        if (rayRoot.current) rayRoot.current.rotation.z = (d.signature?.impactTwist ?? 0) + open * 0.22 * (d.signature?.asymmetry ?? 1);
        if (coreMat.current) {
            coreMat.current.color.set("#ffffff");
            coreMat.current.opacity = 0.98 * fade;
        }
        if (shellMat.current) {
            shellMat.current.color.set(tint);
            shellMat.current.opacity = 0.68 * fade;
        }
        if (groundMat.current) {
            groundMat.current.color.set(tint);
            groundMat.current.opacity = 0.78 * fade;
        }
        rayMats.current.forEach((material, index) => {
            if (!material) return;
            material.color.set(index % 2 ? d.signature?.accent ?? tint : "#ffffff");
            material.opacity = (index % 2 ? 0.68 : 0.92) * fade;
        });
        rayRefs.current.forEach((ray, index) => {
            if (!ray) return;
            ray.visible = index < (d.signature?.impactRays ?? 6);
            ray.scale.x = (d.signature?.trailSpread ?? 1) * (1 + open * 0.15);
        });
    });

    return (
        <group ref={root} visible={false}>
            <Billboard position={[0, 1.05, 0]}>
                <mesh>
                    <circleGeometry args={[0.42, 28]} />
                    <meshBasicMaterial ref={coreMat} {...ADDITIVE_MATERIAL_PROPS} depthTest={false} />
                </mesh>
                <mesh scale={1.7}>
                    <ringGeometry args={[0.34, 0.5, 32]} />
                    <meshBasicMaterial ref={shellMat} {...ADDITIVE_MATERIAL_PROPS} depthTest={false} side={THREE.DoubleSide} />
                </mesh>
                <group ref={rayRoot}>
                    {Array.from({ length: 9 }, (_, index) => (
                        <mesh ref={(mesh) => { rayRefs.current[index] = mesh; }} key={index} rotation={[0, 0, index * Math.PI * 2 / 9]}>
                            <planeGeometry args={[1.7 + (index % 2) * 0.45, 0.065]} />
                            <meshBasicMaterial ref={(material) => { rayMats.current[index] = material; }} {...ADDITIVE_MATERIAL_PROPS} depthTest={false} side={THREE.DoubleSide} />
                        </mesh>
                    ))}
                </group>
            </Billboard>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.44, 0.58, 40]} />
                <meshBasicMaterial ref={groundMat} {...ADDITIVE_MATERIAL_PROPS} side={THREE.DoubleSide} />
            </mesh>
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
                beamMat.current.opacity = 0.3 * (1 - t);
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
                ringMat.current.opacity = 0.45 * (1 - t);
            }
        }
    });
    return (
        <group>
            <mesh ref={beam} visible={false}>
                <cylinderGeometry args={[1, 1.25, 8.5, 20, 1, true]} />
                <meshBasicMaterial ref={beamMat} {...ADDITIVE_MATERIAL_PROPS} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
                <ringGeometry args={[0.82, 1, 48]} />
                <meshBasicMaterial ref={ringMat} {...ADDITIVE_MATERIAL_PROPS} side={THREE.DoubleSide} />
            </mesh>
        </group>
    );
}
