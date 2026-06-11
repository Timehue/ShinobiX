/*
 * ── PetColiseum — HD-2D coliseum battle renderer (Phase 1+2) ──────────────────
 * A react-three-fiber drop-in alternative to PetArenaBattlefield: the pets are
 * 2D BILLBOARD sprites standing on a 3D arena floor at an angled camera, and
 * they actually FIGHT — lunge to engage, recoil on hit, guard, topple on KO —
 * with elemental VFX flying between them and camera shake on heavy blows.
 *
 * CRITICAL: this is a pure PRESENTATION layer. It consumes the SAME inputs the
 * DOM renderer does — the deterministic frame, the buildPetAnimationEvents()
 * queue, petPoseForAvatar(), petBattleCamera(), petFxSpriteKey() — and drives
 * motion off them. It never resolves combat, so balance / odds / ranked-replay
 * determinism are untouched. Motion easing + camera shake use a clock/sin only
 * (no RNG) and never feed back into the sim.
 *
 * Today the billboard texture is the pet's existing portrait when published
 * (via petBattleSprite → sharedImages), else a procedural placeholder so it runs
 * with no backend (the /petvfx.html harness). Real transparent full-body art +
 * a generated coliseum backdrop are the next asset step; the renderer is ready.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, OrbitControls } from "@react-three/drei";
import type { Pet, PetArenaFrame, PetBattleRecord } from "../App";
import { petArchetypeFor, petHighGroundTiles, petBushTiles, type ArenaTile } from "../lib/pet-tactics";
import { PetBattleAvatar } from "./PetBattleAvatar";
import type { PetVisualState, PetBattleAnimationEventType } from "../types/pet-battle";
import {
    buildPetAnimationEvents,
    petPoseForAvatar,
    petBattleSprite,
    elementVfxKey,
    extractPetMoveName,
} from "../lib/pet-battle-anim";
import { petBattleCamera, petCameraHoldMs } from "../lib/pet-battle-camera";
import { petFxSpriteKey } from "../lib/jutsu-vfx";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { petFramePace, tileDistance } from "../lib/pet-battle-sim";
import { beatTimeline, beatChoreoMs, lerp, shakeAmpForBeat, lungeReach, tileToWorld, spreadPositions, arenaObstaclePlacements, TILE_WORLD_W, TILE_WORLD_D, spriteBoundsFromAlpha, groundedSpriteLayout, DEFAULT_SPRITE_BOUNDS, type SpriteBounds, type ObstaclePlacement } from "../lib/pet-coliseum-scene";
import { usePetBattleFrameSfx } from "../lib/use-pet-battle-sfx";
import { isPetSfxMuted, setPetSfxMuted } from "../lib/pet-sfx";

type Vec3 = [number, number, number];
const FLOOR_Y = 0;
const FX_Y = 1.0; // mid-body height for impacts / casts

// Camera framing — fairly LEVEL (Z-A-style over-the-arena view) so the coliseum
// backdrop's stands/crowd/sky fill the upper frame while the floor + grounded
// pets sit lower. Shared so the Canvas, onCreated, CameraRig + OrbitControls
// all agree on the same look target.
// Pulled back + raised a touch vs the original [0,4.1,10.8] so more of the
// designed battle-map floor shows and the pets read as crossing a field (the
// "camera back" map framing). Tunable — nudge y/z if it's too wide/tight.
const CAM_POS: Vec3 = [0, 4.7, 11.7];
const CAM_LOOK: Vec3 = [0, 1.7, -2.2];
const CAM_FOV = 36;

// Generated coliseum scene art (OpenAI gpt-image-1 → WebP, bundled). Resolved
// via new URL(...) so Vite rewrites them to hashed asset URLs at build time —
// no .webp module-type declaration needed.
const COLISEUM_FLOOR_URL = new URL("../assets/coliseum/coliseum-floor.webp", import.meta.url).href;
const COLISEUM_BG_URL = new URL("../assets/coliseum/coliseum-bg.webp", import.meta.url).href;

/** Load a bundled scene texture (sRGB). */
function loadSceneTexture(url: string): THREE.Texture {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

// ── Procedural placeholder + floor textures (used until real art is published) ─
const ELEMENT_COLOR: Record<string, { base: string; glow: string }> = {
    Fire: { base: "#ff6a2c", glow: "#ffb066" },
    Water: { base: "#38bdf8", glow: "#bae6fd" },
    Wind: { base: "#5eead4", glow: "#ccfbf1" },
    Lightning: { base: "#facc15", glow: "#fef08a" },
    Earth: { base: "#d6a76a", glow: "#f0d9b5" },
};
function elementColor(element?: string | null) {
    return ELEMENT_COLOR[String(element ?? "")] ?? { base: "#c4b5fd", glow: "#e9d5ff" };
}

function makePlaceholderTexture(pet: Pet): THREE.CanvasTexture {
    const W = 512, H = 640;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    const { base, glow } = elementColor(pet.element);
    const halo = g.createRadialGradient(W / 2, H * 0.55, 20, W / 2, H * 0.55, W * 0.62);
    halo.addColorStop(0, glow + "cc"); halo.addColorStop(0.5, base + "55"); halo.addColorStop(1, "#00000000");
    g.fillStyle = halo; g.fillRect(0, 0, W, H);
    const bx = W * 0.22, by = H * 0.2, bw = W * 0.56, bh = H * 0.62, r = 64;
    const body = g.createLinearGradient(0, by, 0, by + bh);
    body.addColorStop(0, glow); body.addColorStop(0.5, base); body.addColorStop(1, "#1f2937");
    g.beginPath();
    g.moveTo(bx + r, by);
    g.arcTo(bx + bw, by, bx + bw, by + bh, r);
    g.arcTo(bx + bw, by + bh, bx, by + bh, r);
    g.arcTo(bx, by + bh, bx, by, r);
    g.arcTo(bx, by, bx + bw, by, r);
    g.closePath();
    g.fillStyle = body; g.fill();
    g.lineWidth = 8; g.strokeStyle = "#0b1020"; g.stroke();
    g.fillStyle = "#0b1020";
    g.font = "800 150px Inter, system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(pet.name.slice(0, 2).toUpperCase(), W / 2, H * 0.5);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return tex;
}

// ── Sprite alpha-bounds scan (grounding) ─────────────────────────────────────
// gpt-image-1 centers each creature in a square frame with transparent margin,
// so the "feet" sit at a per-sprite fraction up from the image bottom. We scan
// the alpha bounding box once per src (cached) so the renderer can anchor the
// VISIBLE feet to the floor instead of the plane's literal bottom edge.
type SpriteScan = { bounds: SpriteBounds; aspect: number };
const _scanCache = new Map<string, SpriteScan>();
const _scanInflight = new Map<string, Promise<SpriteScan>>();
function loadSpriteBounds(src: string): Promise<SpriteScan> {
    const cached = _scanCache.get(src);
    if (cached) return Promise.resolve(cached);
    const inflight = _scanInflight.get(src);
    if (inflight) return inflight;
    const p = new Promise<SpriteScan>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                // Downscale for a cheap scan — bbox fractions are scale-invariant.
                const S = 96;
                const w = img.naturalWidth || S, h = img.naturalHeight || S;
                const cw = Math.max(8, Math.round(S * Math.min(1, w / Math.max(w, h))));
                const ch = Math.max(8, Math.round(S * Math.min(1, h / Math.max(w, h))));
                const cv = document.createElement("canvas");
                cv.width = cw; cv.height = ch;
                const ctx = cv.getContext("2d", { willReadFrequently: true })!;
                ctx.drawImage(img, 0, 0, cw, ch);
                const data = ctx.getImageData(0, 0, cw, ch).data;
                const scan: SpriteScan = { bounds: spriteBoundsFromAlpha(data, cw, ch), aspect: w / Math.max(1, h) };
                _scanCache.set(src, scan);
                resolve(scan);
            } catch {
                resolve({ bounds: DEFAULT_SPRITE_BOUNDS, aspect: 1 });
            }
            _scanInflight.delete(src);
        };
        img.onerror = () => { _scanInflight.delete(src); resolve({ bounds: DEFAULT_SPRITE_BOUNDS, aspect: 1 }); };
        img.src = src;
    });
    _scanInflight.set(src, p);
    return p;
}

/** Sprite for a pet: the (optionally UV-mirrored) texture plus the alpha-scanned
 *  bounds + image aspect needed to ground it. `mirror` flips the IMAGE
 *  horizontally (UV-level, pose math untouched) — battle art faces RIGHT, so
 *  the enemy side flips to face inward. Bounds load async; until then a
 *  centered default keeps the sprite grounded-ish (no pop). The procedural
 *  placeholder (no src) uses a fixed bounds (its body capsule) + 0.8 aspect. */
function usePetSprite(pet: Pet, sharedImages: Record<string, string>, mirror = false): { texture: THREE.Texture; bounds: SpriteBounds; aspect: number } {
    const { src } = petBattleSprite(pet, sharedImages);
    const texture = useMemo(() => {
        const t = src ? new THREE.TextureLoader().load(src) : makePlaceholderTexture(pet);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        // Mirror only real art — the placeholder carries the pet's INITIALS,
        // which would render backwards if flipped.
        if (mirror && src) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; }
        return t;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, pet.id, pet.element, mirror]);

    const PLACEHOLDER_SCAN: SpriteScan = { bounds: { left: 0.18, right: 0.82, top: 0.12, bottom: 0.86 }, aspect: 512 / 640 };
    const [scan, setScan] = useState<SpriteScan>(src ? (_scanCache.get(src) ?? { bounds: DEFAULT_SPRITE_BOUNDS, aspect: 1 }) : PLACEHOLDER_SCAN);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- rare src→placeholder reset; async path below is the common case
        if (!src) { setScan(PLACEHOLDER_SCAN); return; }
        let live = true;
        void loadSpriteBounds(src).then((s) => { if (live) setScan(s); });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src]);

    return { texture, bounds: scan.bounds, aspect: scan.aspect };
}

// ── Soft contact-shadow blob texture (one shared canvas) ──────────────────────
let _shadowTexture: THREE.CanvasTexture | null = null;
function shadowTexture(): THREE.CanvasTexture {
    if (_shadowTexture) return _shadowTexture;
    const S = 128;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    const rad = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    rad.addColorStop(0, "rgba(0,0,0,0.55)");
    rad.addColorStop(0.6, "rgba(0,0,0,0.28)");
    rad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rad;
    g.fillRect(0, 0, S, S);
    _shadowTexture = new THREE.CanvasTexture(c);
    _shadowTexture.colorSpace = THREE.SRGBColorSpace;
    return _shadowTexture;
}

// Base visible-content height in world units — every creature is grounded to
// this VISIBLE height (consistent silhouettes; padding no longer varies size).
const TARGET_SPRITE_H = 2.35;

// ── One grounded pet standee — Y-locked billboard, feet on the floor ─────────
function Standee({
    pet, side, pos, reach, toward, pose, hitPower, fainted, hp, maxHp, texture, bounds, aspect,
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
    fainted: boolean;
    /** Live HP for the overhead nameplate bar (per-slot in 2v2). */
    hp: number;
    maxHp: number;
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
    const poseStart = useRef(0);
    const base = pos;
    const mirrored = side === "enemy";
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Foot-anchored plane size + offset from the alpha bounds.
    const L = useMemo(() => groundedSpriteLayout(bounds, aspect, TARGET_SPRITE_H, mirrored), [bounds, aspect, mirrored]);
    const shadowW = Math.max(0.9, L.contentWorldW * 0.95);

    useFrame((state) => {
        const g = group.current, pg = poseG.current, material = mat.current;
        if (!g || !pg || !material) return;
        const t = state.clock.elapsedTime;
        // Beat clock: when the pose changes, stamp the start so the choreography
        // (anticipation → leap → contact → recover) plays from progress 0. Two
        // beats can share a pose (impact then recoil both = "recoil"); keying on
        // the pose VALUE keeps it one continuous reaction, never a double-jolt.
        const activePose: PetVisualState = fainted ? "ko" : pose;
        if (prevPose.current !== activePose) { prevPose.current = activePose; poseStart.current = t; }
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
        // Lane position + pose offset (NO y-bob — grounding stays planted; idle
        // life comes from the squash breathe below, which pivots at the feet).
        g.position.x = lerp(g.position.x, base.x + target.dx, k);
        g.position.y = lerp(g.position.y, FLOOR_Y + target.dy, k);
        g.position.z = lerp(g.position.z, base.z + target.dz, k);
        // Squash/stretch + topple, eased on stored bases so the breathe can
        // multiply on top without compounding. Pose group pivots at the feet.
        sclX.current = lerp(sclX.current, target.sx, k);
        sclY.current = lerp(sclY.current, target.sy, k);
        rotZ.current = lerp(rotZ.current, target.rot, k);
        const breathe = (pose === "idle" || pose === "victory") && !fainted ? 1 + Math.sin(t * 2 + (side === "enemy" ? Math.PI : 0)) * 0.022 : 1;
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
    });

    const safeMax = Math.max(1, maxHp);
    const hpPct = Math.max(0, Math.min(100, (hp / safeMax) * 100));
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
                            <meshBasicMaterial ref={mat} map={texture} transparent alphaTest={0.02} depthWrite={false} toneMapped={false} />
                            <mesh position={[0, 0, 0.01]}>
                                <planeGeometry args={[L.planeW, L.planeH]} />
                                <meshBasicMaterial ref={flashMat} map={texture} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                            </mesh>
                        </mesh>
                    </group>
                </Billboard>
                <Html position={[0, L.contentWorldH + 0.35, 0]} center distanceFactor={9} pointerEvents="none" zIndexRange={[6, 0]}>
                    <div style={{ textAlign: "center", font: "700 13px Inter, system-ui, sans-serif", whiteSpace: "nowrap", userSelect: "none", opacity: fainted ? 0.5 : 1 }}>
                        <div style={{ color: "#fff", textShadow: "0 1px 3px #000", marginBottom: 3 }}>Lv.{pet.level} {pet.name}</div>
                        <div style={{ width: 96, height: 8, margin: "0 auto", background: "#0b1020", borderRadius: 5, border: "1px solid #000", overflow: "hidden" }}>
                            <div data-hp={side} style={{ width: `${hpPct}%`, height: "100%", background: side === "player" ? "#4ade80" : "#f87171", transition: "width .35s" }} />
                        </div>
                        <div style={{ color: "#cbd5e1", fontSize: 10, marginTop: 2 }} data-hpnum={side}>{Math.max(0, Math.round(hp))}/{safeMax}</div>
                    </div>
                </Html>
            </group>
            {/* Per-pet contact shadow — flat on the floor, follows the pet. */}
            <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} position={[base.x, 0.02, base.z]}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial ref={shadowMat} map={shadowTexture()} transparent opacity={0.42} depthWrite={false} toneMapped={false} />
            </mesh>
        </group>
    );
}

// ── Dust kick-up — a soft procedural puff at a pet's feet on lunges/dodges ────
let _dustTexture: THREE.CanvasTexture | null = null;
function dustTexture(): THREE.CanvasTexture {
    if (_dustTexture) return _dustTexture;
    const S = 128;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    // A few overlapping soft sand-coloured blobs (fixed layout — no RNG).
    const blobs: Array<[number, number, number, number]> = [
        [0.5, 0.62, 0.30, 0.5], [0.32, 0.55, 0.20, 0.4], [0.68, 0.56, 0.22, 0.4], [0.5, 0.42, 0.18, 0.3],
    ];
    for (const [bx, by, br, alpha] of blobs) {
        const rad = g.createRadialGradient(bx * S, by * S, 2, bx * S, by * S, br * S);
        rad.addColorStop(0, `rgba(214, 196, 158, ${alpha})`);
        rad.addColorStop(1, "rgba(214, 196, 158, 0)");
        g.fillStyle = rad;
        g.fillRect(0, 0, S, S);
    }
    _dustTexture = new THREE.CanvasTexture(c);
    _dustTexture.colorSpace = THREE.SRGBColorSpace;
    return _dustTexture;
}

function DustPuff({ at, onDone }: { at: Vec3; onDone: () => void }) {
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

// ── Arena obstacles — the sim's tactical grid made VISIBLE ────────────────────
// The engine already routes pets around these (BFS) + blocks ranged line-of-
// sight; the 3D renderer never drew them, so the tactics were invisible. blocked
// = full stone wall, cover = half-height wall pets shoot over, hazard/healing/
// slow = flat tinted floor decals (the passable effect tiles). Placements come
// from the pure arenaObstaclePlacements (same tileToWorld the pets stand on).
let _decalTexture: THREE.CanvasTexture | null = null;
function decalTexture(): THREE.CanvasTexture {
    if (_decalTexture) return _decalTexture;
    const S = 128;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    const rad = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    rad.addColorStop(0, "rgba(255,255,255,0.92)");
    rad.addColorStop(0.55, "rgba(255,255,255,0.5)");
    rad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rad;
    g.fillRect(0, 0, S, S);
    _decalTexture = new THREE.CanvasTexture(c);
    _decalTexture.colorSpace = THREE.SRGBColorSpace;
    return _decalTexture;
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
        const h = p.kind === "cover" ? 0.62 : 1.35;
        const cover = p.kind === "cover";
        return (
            <group>
                <mesh position={[p.x, h / 2, p.z]}>
                    <boxGeometry args={[w, h, d]} />
                    <meshStandardMaterial
                        color={OBSTACLE_COLOR[p.kind]}
                        emissive={cover ? "#1d3a5c" : "#000000"} emissiveIntensity={cover ? 0.4 : 0}
                        roughness={0.92} metalness={0.04} />
                </mesh>
                {/* Contact shadow blob so the wall reads as planted, not floating. */}
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.02, p.z + d * 0.18]}>
                    <planeGeometry args={[w * 1.5, d * 1.4]} />
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

// ── A frame-sequence VFX sprite (stationary, or travelling from→to) ───────────
function FxAnim({
    frames, from, to, durationMs, scale = 1.5, onDone,
}: {
    frames: string[];
    from: Vec3;
    to?: Vec3;
    durationMs: number;
    scale?: number;
    onDone: () => void;
}) {
    const group = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const start = useRef<number | null>(null);
    const textures = useMemo(() => frames.map((u) => {
        const t = new THREE.TextureLoader().load(u);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }), [frames]);
    useEffect(() => () => { textures.forEach((t) => t.dispose()); }, [textures]);

    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = (state.clock.elapsedTime - start.current) * 1000;
        const p = Math.min(1, elapsed / durationMs);
        const idx = Math.min(textures.length - 1, Math.floor(p * textures.length));
        if (mat.current) mat.current.map = textures[idx] ?? null;
        if (group.current && to) {
            group.current.position.x = lerp(from[0], to[0], p);
            group.current.position.y = lerp(from[1], to[1], p);
            group.current.position.z = lerp(from[2], to[2], p);
        }
        if (elapsed >= durationMs) onDone();
    });

    return (
        <group ref={group} position={from}>
            <Billboard>
                <mesh scale={[scale, scale, scale]}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial ref={mat} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </mesh>
            </Billboard>
        </group>
    );
}

// ── Camera shake rig — decaying sinusoid offset on contact beats (no RNG) ─────
function CameraRig({ amp, shakeKey }: { amp: number; shakeKey: number }) {
    const base = useRef<THREE.Vector3 | null>(null);
    const cur = useRef(0);
    const { camera } = useThree();
    useEffect(() => {
        if (!base.current) base.current = camera.position.clone();
        cur.current = Math.max(cur.current, amp);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shakeKey, amp]);
    useFrame((state) => {
        if (!base.current) { base.current = camera.position.clone(); return; }
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
        camera.lookAt(CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2]);
    });
    return null;
}

function Arena({ floor, backdrop }: { floor: THREE.Texture; backdrop: THREE.Texture }) {
    const ambient = useRef<THREE.AmbientLight>(null);
    const sun = useRef<THREE.DirectionalLight>(null);
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
        if (ambient.current) ambient.current.intensity = 0.95 + Math.sin(t * 7.3) * 0.025 + Math.sin(t * 12.7) * 0.018;
        if (sun.current) sun.current.intensity = 0.9 + Math.sin(t * 9.1) * 0.03;
    });
    return (
        <group>
            <ambientLight ref={ambient} intensity={0.95} />
            <directionalLight ref={sun} position={[3, 8, 5]} intensity={0.9} />
            {/* Curved coliseum wall (inner face of a cylinder arc behind the pit). */}
            <mesh position={[0, 5.4, 0]}>
                <cylinderGeometry args={[16, 16, 18, 48, 1, true, Math.PI * 0.2, Math.PI * 1.6]} />
                <meshBasicMaterial map={wall} side={THREE.BackSide} toneMapped={false} fog={false} />
            </mesh>
            {/* Generated arena floor. (Per-pet blob shadows ground the sprites —
                the old global ContactShadows read as ambient darkening.) */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]}>
                <circleGeometry args={[11, 64]} />
                <meshStandardMaterial map={floor} roughness={0.95} />
            </mesh>
        </group>
    );
}

/** Adapt the camera to the canvas aspect: portrait/narrow screens widen the
 *  FOV so both sides of the arena stay in frame on mobile. Applied per-frame
 *  (no-op unless it changed) — the idiomatic r3f mutation point. */
function ResponsiveCamera() {
    const { camera, size } = useThree();
    useFrame(() => {
        const aspect = size.width / Math.max(1, size.height);
        const fov = aspect < 0.8 ? 56 : aspect < 1.2 ? 47 : CAM_FOV;
        const cam = camera as THREE.PerspectiveCamera;
        if (cam.fov !== fov) {
            // eslint-disable-next-line react-hooks/immutability -- the r3f camera is a mutable three.js object; per-frame mutation inside useFrame is the library's idiomatic pattern (same as CameraRig's position writes)
            cam.fov = fov;
            cam.updateProjectionMatrix();
            cam.lookAt(CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2]);
        }
    });
    return null;
}

type FxInstance = { id: number; frames: string[]; from: Vec3; to?: Vec3; durationMs: number; scale: number };
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
    onFightAgain: () => void;
    onExit: () => void;
    sharedImages?: Record<string, string>;
    playerRecord?: PetBattleRecord;
    enemyRecord?: PetBattleRecord;
};

export function PetColiseum({
    playerPet, enemyPet, enemyOwner, playerReservePet, enemyReservePet, frame, result,
    obstacles, tiles, onReplay, onFightAgain, onExit, sharedImages = {}, playerRecord, enemyRecord,
}: PetColiseumProps) {
    const floor = useMemo(() => loadSceneTexture(COLISEUM_FLOOR_URL), []);
    const backdrop = useMemo(() => loadSceneTexture(COLISEUM_BG_URL), []);
    const playerSprite = usePetSprite(playerPet, sharedImages);
    const enemySprite = usePetSprite(enemyPet, sharedImages, true);
    // Reserve sprites (2v2). Hooks must run unconditionally, so absent reserves
    // fall back to the lead pet's art — never rendered in that case.
    const playerResSprite = usePetSprite(playerReservePet ?? playerPet, sharedImages);
    const enemyResSprite = usePetSprite(enemyReservePet ?? enemyPet, sharedImages, true);
    const orbit = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("orbit") === "1";
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
    const playerPos = frame?.playerPos ?? 29;
    const enemyPos = frame?.enemyPos ?? 40;
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
    const seq = useRef(0);
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
            // Elemental VFX flying between them.
            const f = bundledJutsuFxFrames(String(activeAnimEvent.vfxKey ?? "none"));
            if (f) { const id = seq.current++; setFx((p) => [...p, { id, frames: f, from: fromV, to: toV, durationMs: 320, scale: 1.1 }]); }
        } else if (beat === "impact" || beat === "beam" || beat === "statusApply" || beat === "charge" || beat === "guard") {
            const focal = beat === "charge" || beat === "guard" ? fromV : toV;
            const pick = petFxSpriteKey({
                beat, actionKind: frame?.actionKind, vfxKey: activeAnimEvent.vfxKey,
                signature: !!frame?.signatureMove, flagship: !!frame?.signatureMove?.flagship,
                element: actorElement, isKO: !!frame?.isKO,
            });
            const f = pick.key ? bundledJutsuFxFrames(pick.key) : null;
            if (f) { const id = seq.current++; setFx((p) => [...p, { id, frames: f, from: focal, durationMs: 360, scale: 1.7 }]); }
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

    return (
        <div style={{ position: "relative", width: "100%", height: "clamp(380px, 62vh, 700px)", borderRadius: 12, overflow: "hidden", background: "linear-gradient(#3a2a16, #1a1206 60%, #0a0703)" }}>
            {/* Keyframes for the DOM overlays (cut-in sweep, announcer pop). */}
            <style>{`
                @keyframes colCutinSweep { 0% { transform: translateX(var(--from)) skewX(-8deg); opacity: 0; } 18% { transform: translateX(0) skewX(-8deg); opacity: 1; } 82% { transform: translateX(0) skewX(-8deg); opacity: 1; } 100% { transform: translateX(var(--to)) skewX(-8deg); opacity: 0; } }
                @keyframes colAnnouncerPop { 0% { transform: translateX(-50%) scale(0.6); opacity: 0; } 25% { transform: translateX(-50%) scale(1.08); opacity: 1; } 75% { transform: translateX(-50%) scale(1); opacity: 1; } 100% { transform: translateX(-50%) scale(0.95); opacity: 0; } }
                @media (prefers-reduced-motion: reduce) { .col-cutin, .col-announcer { animation: none !important; opacity: 1 !important; transform: none !important; } }
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
                            pose={pose} hitPower={hitPower} fainted={c.fainted} hp={c.hp} maxHp={c.maxHp}
                            texture={c.sprite.texture} bounds={c.sprite.bounds} aspect={c.sprite.aspect} />
                    );
                })}
                {fx.map((f) => (
                    <FxAnim key={f.id} frames={f.frames} from={f.from} to={f.to} durationMs={f.durationMs} scale={f.scale}
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
                {!orbit && <CameraRig amp={shakeAmp} shakeKey={animIdx} />}
                {orbit && <OrbitControls target={CAM_LOOK} />}
            </Canvas>

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
                            <span>❤ {pet.hp}</span><span>⚔ {pet.attack}</span><span>🛡 {pet.defense}</span><span>⚡ {pet.speed}</span>
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

            {/* Signature cut-in — a skewed banner sweeping in from the caster's side. */}
            {sigCutin && (
                <div key={`sig-${frame?.message}`} className="col-cutin" style={{ position: "absolute", top: "34%", left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 6 }}>
                    <div style={{
                        ["--from" as string]: sigCutin.enemy ? "60vw" : "-60vw",
                        ["--to" as string]: sigCutin.enemy ? "-60vw" : "60vw",
                        animation: "colCutinSweep 1.9s cubic-bezier(.22,.9,.3,1) both",
                        padding: "10px 34px",
                        background: "linear-gradient(100deg, rgba(15,23,42,0.95) 0%, rgba(109,40,217,0.92) 50%, rgba(15,23,42,0.95) 100%)",
                        border: "1px solid rgba(196,181,253,0.6)", borderRadius: 8,
                        boxShadow: "0 6px 30px rgba(109,40,217,0.45)",
                        textAlign: "center",
                    }}>
                        <div style={{ color: "#c4b5fd", font: "700 12px Inter, system-ui, sans-serif", letterSpacing: "0.2em", textTransform: "uppercase" }}>{sigCutin.pet}</div>
                        <div style={{ color: "#fff", font: "900 22px Inter, system-ui, sans-serif", textShadow: "0 0 16px rgba(196,181,253,0.8)" }}>{sigCutin.move}!</div>
                    </div>
                </div>
            )}

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
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                            <button onClick={onReplay} style={resultBtn}>⟲ Replay</button>
                            <button onClick={onFightAgain} style={resultBtn}>⚔ Fight again</button>
                            <button onClick={onExit} style={{ ...resultBtn, background: "#334155" }}>Exit</button>
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

            <div style={{ position: "absolute", bottom: 12, right: 14, color: "#64748b", font: "600 11px Inter, system-ui, sans-serif" }}>HD-2D coliseum · ?orbit=1 to rotate</div>
        </div>
    );
}

const resultBtn: React.CSSProperties = { padding: "8px 14px", background: "#1e3a8a", color: "#fff", border: "1px solid #3b82f6", borderRadius: 8, cursor: "pointer", font: "700 13px Inter, system-ui, sans-serif" };
