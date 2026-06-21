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
import { createPortal } from "react-dom";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, OrbitControls, OrthographicCamera, Sparkles } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import type { Pet, PetArenaFrame, PetBattleRecord } from "../App";
import { petArchetypeFor, petHighGroundTiles, petBushTiles, type ArenaTile } from "../lib/pet-tactics";
import { PET_SPAWN_1V1 } from "../constants/pet-arena";
import { PetBattleAvatar } from "./PetBattleAvatar";
import type { PetVisualState, PetBattleAnimationEventType } from "../types/pet-battle";
import {
    buildPetAnimationEvents,
    petPoseForAvatar,
    petBattleSprite,
    petStripVariant,
    elementVfxKey,
    extractPetMoveName,
} from "../lib/pet-battle-anim";
import { petBattleCamera, petCameraHoldMs } from "../lib/pet-battle-camera";
import { petFxSpriteKey, arenaAbilityFxKey, arenaKillFxKey, multiKillLabel } from "../lib/jutsu-vfx";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { projectileVisual, type ProjectileVisual, type ProjTexKind } from "../lib/pet-projectile-vfx";
import { petFramePace, tileDistance } from "../lib/pet-battle-sim";
import { beatTimeline, beatChoreoMs, lerp, shakeAmpForBeat, lungeReach, tileToWorld, spreadPositions, arenaObstaclePlacements, cameraForCombatants, TILE_WORLD_W, TILE_WORLD_D, spriteBoundsFromAlpha, groundedSpriteLayout, DEFAULT_SPRITE_BOUNDS, type SpriteBounds, type ObstaclePlacement } from "../lib/pet-coliseum-scene";
import { runPetDuel, runPetPartyDuel, DUEL_TPS, ARENA_X, ARENA_Y, type DuelResult, type DuelState, type DuelActorSnap } from "../lib/pet-duel-sim";
import { runPetArenaMatch, ARENA_TPS, WIN_SCORE, type ArenaResult, type ArenaSnapshot, type ArenaState, type ArenaRole, type ArenaSlot } from "../lib/pet-arena-sim";
import { POSED_PET_IDS, POSED_RUN_IDS } from "../assets/coliseum/pet-poses-manifest";
import { petVisualId } from "../data/pet-evolutions";
import { usePetBattleFrameSfx } from "../lib/use-pet-battle-sfx";
import { isPetSfxMuted, setPetSfxMuted } from "../lib/pet-sfx";
import { petBloomEnabled } from "../lib/pet-coliseum-flag";

type Vec3 = [number, number, number];
const FLOOR_Y = 0;
const FX_Y = 1.0; // mid-body height for impacts / casts

/** Optional HDR-glow pass (default OFF, behind petBloom.v1). Threshold bloom makes the
 *  bright, additive signature / ultimate / KO effects GLOW so big moves read bigger, while
 *  basic hits stay below the luminance threshold and don't bloom. Costs one fullscreen pass
 *  (a real mobile/low-end hit) so it's opt-in pending a perf + visual review — and on the
 *  transparent arena Canvas the alpha compositing needs eyeballing. Read once per mount,
 *  same as the other coliseum flags. */
function BloomFx() {
    if (!petBloomEnabled()) return null;
    return (
        <EffectComposer>
            <Bloom luminanceThreshold={0.55} luminanceSmoothing={0.22} intensity={0.9} mipmapBlur />
        </EffectComposer>
    );
}

// Camera framing — fairly LEVEL (Z-A-style over-the-arena view) so the coliseum
// backdrop's stands/crowd/sky fill the upper frame while the floor + grounded
// pets sit lower. Shared so the Canvas, onCreated, CameraRig + OrbitControls
// all agree on the same look target.
// Pulled back + raised to frame the ENLARGED arena (7.0×4.0 footprint) so the
// whole tactical battlefield + four pets fit without cropping. Scales with the
// footprint so pets stay readable. Tunable — nudge y/z if it's too wide/tight.
const CAM_POS: Vec3 = [0, 5.9, 14.8];
const CAM_LOOK: Vec3 = [0, 1.65, -2.6];
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
    // Free the GPU texture when the source changes or the component unmounts.
    // Each texture is a fresh per-instance TextureLoader/placeholder (THREE.Cache
    // is off), so disposing here can never free a shared/aliased texture.
    useEffect(() => () => { texture.dispose(); }, [texture]);

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

// ── Animated pose frames (fal-generated) — flipbook ──────────────────────────
// A pet's battle sprite redrawn into combat POSES (idle/attack/hurt/cast); the
// renderer swaps the billboard to the pose matching the active beat and the
// procedural choreography supplies the motion (attack POSE + lunge MOTION = a
// real strike). Pilot: 2 pets; everyone else falls back to the single sprite.
type PoseCat = "idle" | "attack" | "hurt" | "cast" | "run-a" | "run-b";
const POSE_CATS: PoseCat[] = ["idle", "attack", "hurt", "cast"];
const RUN_CATS: PoseCat[] = ["run-a", "run-b"]; // 2-frame run cycle (kills gliding)
// Poses are served as STATIC files (public/pet-poses/) and loaded on demand per
// fighting pet — the manifest says which of the 148 pets have a generated set.
const poseUrl = (id: string, cat: PoseCat) => `/pet-poses/${id}-${cat}.webp`;
/** The posed-asset id for a pet (its own id, or the stripped base id), or null
 *  if no pose set was generated for it. */
function posedId(petId: string): string | null {
    if (POSED_PET_IDS.has(petId)) return petId;
    const base = petStripVariant(petId);
    return POSED_PET_IDS.has(base) ? base : null;
}
/** The run-cycle id for a pet (same posed base, gated by the run manifest), or
 *  null when no 2-frame run cycle was generated → renderer falls back to idle. */
function posedRunId(petId: string): string | null {
    if (POSED_RUN_IDS.has(petId)) return petId;
    const base = petStripVariant(petId);
    return POSED_RUN_IDS.has(base) ? base : null;
}
/** The pose-frame category for a visual state. */
function poseCategory(s: PetVisualState): PoseCat {
    switch (s) {
        case "windup": case "lunge": return "attack";
        case "hit": case "recoil": case "ko": return "hurt";
        case "charge": case "rangedCast": case "projectileFire": return "cast";
        default: return "idle"; // idle / guard / dodge / victory
    }
}
type PoseSet = { tex: Record<PoseCat, THREE.Texture>; scan: Record<PoseCat, SpriteScan>; hasRun: boolean };
/** Load a pet's pose textures + alpha bounds (mirror-aware) from the static pose
 *  store: the 4 combat poses always, plus the 2-frame run cycle when one was
 *  generated (else run-a/run-b alias idle, so every cat is always defined).
 *  null when the pet has no generated set (→ single-sprite fallback). Hooks run
 *  unconditionally (rules-of-hooks). */
function usePetPoses(petId: string, mirror: boolean): PoseSet | null {
    const id = posedId(petId);
    const runId = posedRunId(petId);
    const tex = useMemo(() => {
        if (!id) return null;
        const mk = (loadId: string, cat: PoseCat) => {
            const t = new THREE.TextureLoader().load(poseUrl(loadId, cat));
            t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
            if (mirror) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; }
            return t;
        };
        const out = {} as Record<PoseCat, THREE.Texture>;
        for (const c of POSE_CATS) out[c] = mk(id, c);
        for (const c of RUN_CATS) out[c] = runId ? mk(runId, c) : out.idle;
        return out;
    }, [id, runId, mirror]);
    // Dispose pose textures on change/unmount. run-a/run-b may ALIAS `idle`
    // (when no run cycle was generated), so dispose each UNIQUE texture once.
    useEffect(() => {
        if (!tex) return;
        return () => {
            const seen = new Set<THREE.Texture>();
            for (const t of Object.values(tex)) {
                if (seen.has(t)) continue;
                seen.add(t);
                t.dispose();
            }
        };
    }, [tex]);
    const [scan, setScan] = useState<Record<PoseCat, SpriteScan> | null>(null);
    useEffect(() => {
        if (!id) return;
        let live = true;
        const jobs = POSE_CATS.map((c) => loadSpriteBounds(poseUrl(id, c)).then((s) => [c, s] as const));
        for (const c of RUN_CATS) jobs.push(loadSpriteBounds(poseUrl(runId ?? id, runId ? c : "idle")).then((s) => [c, s] as const));
        Promise.all(jobs).then((entries) => { if (live) setScan(Object.fromEntries(entries) as Record<PoseCat, SpriteScan>); });
        return () => { live = false; };
    }, [id, runId]);
    if (!id || !tex) return null;
    const sc = scan ?? (Object.fromEntries([...POSE_CATS, ...RUN_CATS].map((c) => [c, { bounds: DEFAULT_SPRITE_BOUNDS, aspect: 1 }])) as Record<PoseCat, SpriteScan>);
    return { tex, scan: sc, hasRun: !!runId };
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
// Trimmed from 2.6 so pets sit IN the full-screen arena instead of looming over it.
const TARGET_SPRITE_H = 2.3;

// Element → a bright tint for idle aura wisps + dash-trail streaks (mirrors the
// particle palette). Falls back to chakra-cyan for None/unknown.
const ELEMENT_TINT: Record<string, string> = {
    fire: "#fb923c", water: "#38bdf8", wind: "#a7f3d0", lightning: "#fde047",
    earth: "#d6a45a", ice: "#bae6fd", lava: "#fb923c", blood: "#ef4444",
    shadow: "#a78bfa", iron: "#cbd5e1",
};
const elementTint = (el?: string | null) => ELEMENT_TINT[String(el ?? "").toLowerCase()] ?? "#a5f3fc";

// ── Afterimage trail — element-tinted ghost copies behind a fast-moving pet ───
// A flat-color SILHOUETTE (the sprite's alpha masked to the element glow color),
// not a tint of the sprite's RGB — so dark creatures (e.g. the black kitsune)
// still leave a bright, readable speed-streak. Additive over the floor → glow.
const GHOSTS = 3;            // ghost copies per standee
const TRAIL_STRIDE = 2;     // frames between trail samples (longer streak)
function makeGhostMaterial(color: string): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            map: { value: null as THREE.Texture | null },
            uColor: { value: new THREE.Color(color) },
            uOpacity: { value: 0 },
        },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform sampler2D map; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; void main(){ float a = texture2D(map, vUv).a; if (a < 0.1) discard; gl_FragColor = vec4(uColor, a * uOpacity); }",
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
    });
}

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
    const start = useRef<number | null>(null);
    const visual = useMemo(() => projectileVisual({ element }), [element]);
    const tex = projSpriteTexture(visual.spriteKey);
    const flip = to[0] < from[0] ? -1 : 1;   // base art faces +x → mirror for a leftward shot
    useFrame((state) => {
        const g = group.current; if (!g) return;
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) * 1000 / durationMs);
        g.position.set(lerp(from[0], to[0], p), lerp(from[1], to[1], p), lerp(from[2], to[2], p));
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
                <mesh scale={[scale * flip, scale, 1]}>
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

function Arena({ floor, backdrop, big = false }: { floor: THREE.Texture; backdrop: THREE.Texture; big?: boolean }) {
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
        if (ambient.current) ambient.current.intensity = 0.95 + Math.sin(t * 7.3) * 0.025 + Math.sin(t * 12.7) * 0.018;
        if (sun.current) sun.current.intensity = 0.9 + Math.sin(t * 9.1) * 0.03;
    });
    return (
        <group>
            <ambientLight ref={ambient} intensity={0.95} />
            <directionalLight ref={sun} position={[3, 8, 5]} intensity={0.9} />
            {/* Curved coliseum wall (inner face of a cylinder arc behind the pit).
                Rings the floor so panning/pull-back never exposes void. */}
            <mesh position={[0, big ? 9 : 6.0, 0]}>
                <cylinderGeometry args={[wallR, wallR, big ? 30 : 21, 48, 1, true, Math.PI * 0.2, Math.PI * 1.6]} />
                <meshBasicMaterial map={wall} side={THREE.BackSide} toneMapped={false} fog={false} />
            </mesh>
            {/* Arena floor (the battle map). Per-pet blob shadows ground the sprites. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]}>
                <circleGeometry args={[floorR, 64]} />
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
            // Look is owned by CameraRig (follow-cam); ResponsiveCamera only adapts FOV.
        }
    });
    return null;
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
    // Dispose the coliseum floor/backdrop textures when the match view unmounts.
    useEffect(() => () => { floor.dispose(); backdrop.dispose(); }, [floor, backdrop]);
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

    return createPortal((
        // Full-screen takeover (like the Tactical Arena) — the duel pops OUT of the
        // page into an immersive fixed overlay instead of a small inline box.
        <div style={{ position: "fixed", inset: 0, zIndex: 200, width: "100vw", height: "100vh", overflow: "hidden", background: "linear-gradient(#3a2a16, #1a1206 60%, #0a0703)" }}>
            {/* Keyframes for the announcer pop. The signature cut-in uses the shared
                .pet-cutin styles + animation from index.css. */}
            <style>{`
                @keyframes colAnnouncerPop { 0% { transform: translateX(-50%) scale(0.6); opacity: 0; } 25% { transform: translateX(-50%) scale(1.08); opacity: 1; } 75% { transform: translateX(-50%) scale(1); opacity: 1; } 100% { transform: translateX(-50%) scale(0.95); opacity: 0; } }
                @media (prefers-reduced-motion: reduce) { .col-announcer { animation: none !important; opacity: 1 !important; transform: none !important; } }
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
                {orbit && <OrbitControls target={CAM_LOOK} />}
                <BloomFx />
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

            {/* Always-visible Exit so a full-screen duel can be left mid-fight (the
                result is already computed + applied, so leaving just skips the replay). */}
            <button
                onClick={onExit}
                title="Exit battle"
                style={{ position: "absolute", top: 14, right: 56, width: 34, height: 34, display: "grid", placeItems: "center", background: "rgba(15,23,42,0.85)", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", cursor: "pointer", fontSize: 16, fontWeight: 700 }}
            >
                ✕
            </button>

            <div style={{ position: "absolute", bottom: 12, right: 14, color: "#64748b", font: "600 11px Inter, system-ui, sans-serif" }}>HD-2D coliseum · ?orbit=1 to rotate</div>
        </div>
    ), document.body);
}

const resultBtn: React.CSSProperties = { padding: "8px 14px", background: "#1e3a8a", color: "#fff", border: "1px solid #3b82f6", borderRadius: 8, cursor: "pointer", font: "700 13px Inter, system-ui, sans-serif" };
const duelBtn: React.CSSProperties = { padding: "5px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", cursor: "pointer", font: "700 12px Inter, system-ui, sans-serif" };

// ═════════════════════════════════════════════════════════════════════════════
// PetColiseumDuel — Phase C of the combat redesign (docs/pet-combat-redesign-plan.md).
// Renders the new CONTINUOUS duel engine (pet-duel-sim.ts) as a fluid fight: it
// runs runPetDuel / runPetPartyDuel, then plays the per-tick snapshot stream,
// INTERPOLATING between ticks for smooth motion at any framerate. PREVIEW ONLY
// (behind the petDuel.v1 flag) — the real battle outcome + rewards still come
// from the shipped round engine, so this has no gameplay/ranked impact.
// ═════════════════════════════════════════════════════════════════════════════

// duel sim state → the visual pose the flipbook/choreography uses.
const DUEL_STATE_POSE: Record<DuelState, PetVisualState> = {
    idle: "idle", dash: "lunge", windup: "windup", strike: "lunge",
    recover: "idle", stagger: "recoil", dodge: "dodge", dead: "ko",
};
type DuelClock = { t: number; playing: boolean };
const findActor = (snap: { actors: DuelActorSnap[] }, id: string) => snap.actors.find((a) => a.id === id);
// ── Tactical STAGE: a fixed painted diorama backdrop (Final-Fantasy-style
// pre-rendered background) with the fighters composited on top. The diorama is a
// CSS `cover` background; the sprites live in a TRANSPARENT, orthographic r3f
// layer whose cover-fit projection stays pixel-locked to that background at every
// viewport — because both cover the SAME logical rect and worldW:worldH ==
// imgW:imgH, a sim field point lands on the same screen pixel as the painting it
// represents. (No 3D floor: the painting already has all the depth.)
const DIORAMA_URL = new URL("../assets/coliseum/tactics-diorama.webp", import.meta.url).href;
// The diorama is a fixed 1536×1024 MAP-SPACE reference (the SpriteFlow arena).
// All pet positions are computed in map-space, then projected to the world layer
// — which cover-fits the SAME image as the CSS backdrop, so map-space (mx,my)
// lands on the exact painted pixel at any viewport. worldW:worldH == image aspect.
const MAP_W = 1536, MAP_H = 1024;
const STAGE = { worldW: 30, worldH: 20 };
// Pets are SMALL tactical units (~60px content height @ scale 1 on a 1536-ref),
// never the oversized sprites from before. (1 world unit = MAP_H/worldH px.)
const STAGE_SPRITE_H = 1.2;
// The action band: the sim field maps onto this open lower-middle rectangle of the
// arena (on the paths, off the decorative back/walls), so the fight reads across
// the battlefield in front of the camera.
const PLAY = { x0: 292, x1: 1244, y0: 452, y1: 800 };
// Perspective: front (high map-Y) units larger, back units smaller — so they sit
// in the painting's depth instead of looking pasted on.
function getPerspectiveScale(my: number): number {
    const t = Math.min(1, Math.max(0, my / MAP_H));
    return 0.65 + (1.15 - 0.65) * t;
}
/** sim field (x∈±ARENA_X, y∈±ARENA_Y) → map-space (px in the 1536×1024 image). */
function fieldToMap(fx: number, fy: number): { mx: number; my: number } {
    return {
        mx: lerp(PLAY.x0, PLAY.x1, (fx + ARENA_X) / (2 * ARENA_X)),
        my: lerp(PLAY.y0, PLAY.y1, (fy + ARENA_Y) / (2 * ARENA_Y)),
    };
}
type StagePos = { wx: number; wy: number; depth: number; zo: number };
/** sim field → world position (feet pivot) + perspective scale + draw-order. */
function stagePlace(sx: number, sy: number): StagePos {
    const { mx, my } = fieldToMap(sx, sy);
    return {
        wx: (mx / MAP_W - 0.5) * STAGE.worldW,
        wy: (0.5 - my / MAP_H) * STAGE.worldH,
        depth: getPerspectiveScale(my),
        zo: (my / MAP_H) * 8,   // depth-sort: front (high map-Y) drawn over back
    };
}

// The ARENA mode uses the FULL inner arena (reaches all four corner seals), not
// the lower band — must match gen-walkmask.mjs --full (pet-arena-fullmask.ts).
const ARENA_PLAY = { x0: 150, x1: 1386, y0: 96, y1: 930 };
function arenaPlace(sx: number, sy: number): StagePos {
    const u = (sx + ARENA_X) / (2 * ARENA_X), v = (sy + ARENA_Y) / (2 * ARENA_Y);
    const mx = lerp(ARENA_PLAY.x0, ARENA_PLAY.x1, u), my = lerp(ARENA_PLAY.y0, ARENA_PLAY.y1, v);
    return { wx: (mx / MAP_W - 0.5) * STAGE.worldW, wy: (0.5 - my / MAP_H) * STAGE.worldH, depth: getPerspectiveScale(my), zo: (my / MAP_H) * 8 };
}

/** Orthographic camera fit to the stage rect — matches the CSS background fit so
 *  the sprite layer is pixel-locked to the painting at any size. `cover` fills +
 *  crops (duel/coliseum); `contain` shows the WHOLE map centred (arena — so the
 *  full board is always visible + the side panels don't crop the action). */
function StageCamera({ fit = "cover" }: { fit?: "cover" | "contain" }) {
    const size = useThree((s) => s.size);
    const zoom = fit === "contain"
        ? Math.min(size.width / STAGE.worldW, size.height / STAGE.worldH)
        : Math.max(size.width / STAGE.worldW, size.height / STAGE.worldH);
    return <OrthographicCamera makeDefault position={[0, 0, 100]} zoom={zoom} near={0.1} far={1000} />;
}

/** One fighter composited onto the stage: the pose flipbook + a 2-frame RUN cycle
 *  while traversing (no more gliding), depth-scaled into the painted space, with a
 *  soft ground oval + afterimage streak. Driven by the interpolated tick stream. */
function DuelStandee({ duel, clock, id, pet, mirror, sharedImages }: {
    duel: DuelResult; clock: { current: DuelClock }; id: string; pet: Pet; mirror: boolean; sharedImages: Record<string, string>;
}) {
    const sprite = usePetSprite(pet, sharedImages, false);   // base art faces RIGHT; facing is flipped per-frame
    const poses = usePetPoses(petVisualId(pet), false);
    const group = useRef<THREE.Group>(null);
    const flip = useRef<THREE.Group>(null);                   // sprite flips here to face the target (nameplate stays unflipped)
    const facing = useRef(mirror ? -1 : 1);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const flashMat = useRef<THREE.MeshBasicMaterial>(null);
    const shadow = useRef<THREE.Mesh>(null);
    const shadowMat = useRef<THREE.MeshBasicMaterial>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const nameWrap = useRef<HTMLDivElement>(null);
    const [poseCat, setPoseCat] = useState<PoseCat>("idle");
    const prevHp = useRef(Infinity);
    const flash = useRef(0);
    const lastPos = useRef<[number, number]>([0, 0]);
    const scaleSm = useRef(0);   // smoothed depth-scale → no size pop from a jittery tick or a reserve swap-in teleport
    const runClock = useRef(0);
    const bobPhase = useMemo(() => (id.charCodeAt(id.length - 1) % 7) * 0.9, [id]);

    const useTex = poses ? poses.tex[poseCat] : sprite.texture;
    const useBounds = poses ? poses.scan[poseCat].bounds : sprite.bounds;
    const useAspect = poses ? poses.scan[poseCat].aspect : sprite.aspect;
    const L = useMemo(() => groundedSpriteLayout(useBounds, useAspect, STAGE_SPRITE_H, false), [useBounds, useAspect]);
    const shadowW = Math.max(0.7, L.contentWorldW * 0.95);
    const side = mirror ? "enemy" : "player";

    useFrame((state, delta) => {
        const g = group.current, m = mat.current;
        if (!g || !m) return;
        const snaps = duel.snapshots;
        const tf = Math.max(0, Math.min(snaps.length - 1, clock.current.t));
        const i0 = Math.floor(tf), i1 = Math.min(snaps.length - 1, i0 + 1), f = tf - i0;
        const a0 = findActor(snaps[i0], id);
        if (!a0) return;
        const a1 = findActor(snaps[i1], id) ?? a0;
        // A >3-field-unit jump in one tick is a teleport (reserve swap-in), never real
        // travel — hard-cut at the tick midpoint instead of sliding (+ scaling) across.
        const tdx = a1.x - a0.x, tdy = a1.y - a0.y;
        const teleport = (tdx * tdx + tdy * tdy) > 9;
        const ff = teleport ? (f < 0.5 ? 0 : 1) : f;
        const p = stagePlace(lerp(a0.x, a1.x, ff), lerp(a0.y, a1.y, ff));

        // Speed in stage units → drives the run cycle + bob + trail.
        const dx = p.wx - lastPos.current[0], dy = p.wy - lastPos.current[1];
        const spd = Math.sqrt(dx * dx + dy * dy);
        lastPos.current = [p.wx, p.wy];
        const moving = spd > 0.012 && a0.state !== "dead";

        // run-bob + a forward lean make the locomotion READ; depth scales it all.
        const bob = moving ? Math.abs(Math.sin(state.clock.elapsedTime * 13 + bobPhase)) * 0.18 : 0;
        scaleSm.current = (teleport || scaleSm.current === 0) ? p.depth : lerp(scaleSm.current, p.depth, 0.25);
        g.position.set(p.wx, p.wy + bob * p.depth, p.zo);
        g.scale.setScalar(scaleSm.current);
        // Turn to FACE the target (flip by the sim's facing) so a pet never fights
        // with its back to the enemy; the forward run-lean flips along with it.
        if (Math.abs(a0.faceX) > 0.12) facing.current = a0.faceX < 0 ? -1 : 1;
        if (flip.current) {
            flip.current.scale.x = facing.current;
            flip.current.rotation.z = lerp(flip.current.rotation.z, moving ? -0.12 : 0, 0.2);
        }

        // Pose: alternate the 2-frame run cycle while traversing (if the pet has
        // one), else the state pose (attack / hurt / cast / idle).
        let cat = poseCategory(DUEL_STATE_POSE[a0.state]);
        if (moving && poses?.hasRun && (a0.state === "idle" || a0.state === "dash")) {
            runClock.current += delta * 8.5;
            cat = Math.floor(runClock.current) % 2 === 0 ? "run-a" : "run-b";
        }
        if (cat !== poseCat) setPoseCat(cat);

        // Hit flash on HP drop; hurt tint while staggered; fade out when down.
        if (a0.hp < prevHp.current - 0.5) flash.current = 1;
        prevHp.current = a0.hp;
        flash.current *= 0.86;
        if (flashMat.current) flashMat.current.opacity = flash.current < 0.02 ? 0 : flash.current * 0.9;
        const hurt = a0.state === "stagger" ? 0.5 : 0;
        m.color.g = lerp(m.color.g, 1 - 0.3 * hurt, 0.4);
        m.color.b = lerp(m.color.b, 1 - 0.3 * hurt, 0.4);
        m.opacity = a0.state === "dead" ? lerp(m.opacity, 0.25, 0.1) : 1;

        // HP bar + dead dim via DOM refs (no React re-render).
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, (a0.hp / Math.max(1, a0.maxHp)) * 100))}%`;
        if (nameWrap.current) nameWrap.current.style.opacity = a0.state === "dead" ? "0.5" : "1";

        if (shadow.current && shadowMat.current) {
            shadow.current.position.set(p.wx, p.wy - 0.08 * p.depth, p.zo - 0.1);
            shadow.current.scale.set(shadowW * scaleSm.current, shadowW * 0.32 * scaleSm.current, 1);
            shadowMat.current.opacity = 0.4 * (a0.state === "dead" ? 0.4 : 1);
        }
    });

    return (
        <group>
            {/* soft ground oval — drawn first (renderOrder −1) so it sits under the pet */}
            <mesh ref={shadow} renderOrder={-1}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial ref={shadowMat} map={shadowTexture()} transparent opacity={0.4} depthWrite={false} depthTest={false} toneMapped={false} />
            </mesh>
            <group ref={group}>
                <group ref={flip}>
                    <mesh position={[L.meshX, L.meshY, 0]}>
                        <planeGeometry args={[L.planeW, L.planeH]} />
                        <meshBasicMaterial ref={mat} map={useTex} transparent alphaTest={0.4} depthWrite={false} toneMapped={false} />
                        <mesh position={[0, 0, 0.01]}>
                            <planeGeometry args={[L.planeW, L.planeH]} />
                            <meshBasicMaterial ref={flashMat} map={useTex} transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                        </mesh>
                    </mesh>
                </group>
                <Html position={[0, L.contentWorldH + 0.35, 0]} center pointerEvents="none" zIndexRange={[6, 0]}>
                    <div ref={nameWrap} style={{ textAlign: "center", font: "700 11px Inter, system-ui, sans-serif", whiteSpace: "nowrap", userSelect: "none", transform: "scale(0.8)" }}>
                        <div style={{ color: "#fff", textShadow: "0 1px 2px #000", marginBottom: 2 }}>Lv.{pet.level} {pet.name}</div>
                        <div style={{ width: 62, height: 6, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ width: "100%", height: "100%", background: side === "player" ? "#4ade80" : "#f87171" }} />
                        </div>
                    </div>
                </Html>
            </group>
        </group>
    );
}

// ── Travelling-projectile textures + body ────────────────────────────────────
// White-luminance shapes (the material `color` tints them) for the element-
// distinct flying attacks: a round fire/water orb, a wind crescent blade, a
// jagged lightning bolt, a faceted earth boulder. Lazy singletons (one each),
// mirroring shadowTexture(). The renderer rotates the whole projectile to its
// travel direction, so each shape is authored pointing along +x.
let _projRoundTex: THREE.CanvasTexture | null = null;
let _projCrescentTex: THREE.CanvasTexture | null = null;
let _projBoltTex: THREE.CanvasTexture | null = null;
let _projRockTex: THREE.CanvasTexture | null = null;

function projRoundTexture(): THREE.CanvasTexture {
    if (_projRoundTex) return _projRoundTex;
    const S = 128, c = document.createElement("canvas"); c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    const rad = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
    rad.addColorStop(0, "rgba(255,255,255,1)");
    rad.addColorStop(0.35, "rgba(255,255,255,0.92)");
    rad.addColorStop(0.7, "rgba(255,255,255,0.32)");
    rad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rad; g.fillRect(0, 0, S, S);
    _projRoundTex = new THREE.CanvasTexture(c); _projRoundTex.colorSpace = THREE.SRGBColorSpace;
    return _projRoundTex;
}

function projCrescentTexture(): THREE.CanvasTexture {
    if (_projCrescentTex) return _projCrescentTex;
    const S = 128, c = document.createElement("canvas"); c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    // A crescent blade: a disc with an offset disc carved out, convex edge leading
    // (+x). Soft white so the wind tint glows on the blade.
    g.fillStyle = "rgba(255,255,255,1)";
    g.beginPath(); g.arc(S * 0.46, S / 2, S * 0.42, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.arc(S * 0.30, S / 2, S * 0.40, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
    // Bright leading rim.
    g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 3;
    g.beginPath(); g.arc(S * 0.46, S / 2, S * 0.42, -1.1, 1.1); g.stroke();
    _projCrescentTex = new THREE.CanvasTexture(c); _projCrescentTex.colorSpace = THREE.SRGBColorSpace;
    return _projCrescentTex;
}

function projBoltTexture(): THREE.CanvasTexture {
    if (_projBoltTex) return _projBoltTex;
    const S = 128, c = document.createElement("canvas"); c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    // A jagged horizontal streak (travels along +x) with a couple of forks. Fixed
    // zig pattern (no rng) so it's stable; flicker is applied at render time.
    const midY = S / 2, zig = [0, -16, 12, -8, 16, -12, 0];
    const drawBolt = (w: number, alpha: number) => {
        g.strokeStyle = `rgba(255,255,255,${alpha})`; g.lineWidth = w; g.lineJoin = "round"; g.lineCap = "round";
        g.beginPath();
        zig.forEach((dy, i) => { const x = 8 + (i / (zig.length - 1)) * (S - 16); const y = midY + dy; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.stroke();
    };
    drawBolt(11, 0.28); drawBolt(5, 0.7); drawBolt(2, 1);   // glow → core
    // A short fork.
    g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(S * 0.55, midY + 4); g.lineTo(S * 0.66, midY + 22); g.stroke();
    _projBoltTex = new THREE.CanvasTexture(c); _projBoltTex.colorSpace = THREE.SRGBColorSpace;
    return _projBoltTex;
}

function projRockTexture(): THREE.CanvasTexture {
    if (_projRockTex) return _projRockTex;
    const S = 128, c = document.createElement("canvas"); c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    const cx = S / 2, cy = S / 2, R = S * 0.40;
    // Soft glow under the rock so the earth tint reads even on dark floors.
    const rad = g.createRadialGradient(cx, cy, 2, cx, cy, S / 2);
    rad.addColorStop(0, "rgba(255,255,255,0.5)"); rad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rad; g.fillRect(0, 0, S, S);
    // A faceted boulder — a fixed irregular heptagon (no rng).
    const verts = [0.12, -0.5, 0.62, -0.32, 0.55, 0.28, 0.1, 0.6, -0.42, 0.42, -0.62, -0.1, -0.28, -0.5];
    g.beginPath();
    for (let i = 0; i < verts.length; i += 2) { const x = cx + verts[i] * R * 2, y = cy + verts[i + 1] * R * 2; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.closePath();
    g.fillStyle = "rgba(255,255,255,0.95)"; g.fill();
    // A couple of darker facet seams for a chiselled read.
    g.strokeStyle = "rgba(120,120,120,0.55)"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx + 0.12 * R * 2, cy - 0.5 * R * 2); g.lineTo(cx - 0.28 * R * 2, cy - 0.5 * R * 2); g.lineTo(cx + 0.1 * R * 2, cy + 0.6 * R * 2); g.stroke();
    _projRockTex = new THREE.CanvasTexture(c); _projRockTex.colorSpace = THREE.SRGBColorSpace;
    return _projRockTex;
}

function projHeadTexture(tex: ProjTexKind): THREE.CanvasTexture {
    switch (tex) {
        case "crescent": return projCrescentTexture();
        case "bolt": return projBoltTexture();
        case "rock": return projRockTexture();
        default: return projRoundTexture();
    }
}

// Real painted element projectile sprites (gpt-image-1 → transparent WebP, in
// src/assets/fx/projectiles/). Drawn ALPHA-blended (not additive) so the actual
// fireball / water ball / wind cut / boulder / bolt reads as art over the scene
// — only the genuinely-bright bits (fire & lightning cores) cross the bloom
// threshold and glow, so rock/water stay solid instead of washing to light.
// Base art faces +x (travelling right) with its tail to −x; the parent group
// rotates it to the travel direction.
const PROJ_SPRITE_URL: Record<string, string> = {
    fire: new URL("../assets/fx/projectiles/fire.webp", import.meta.url).href,
    water: new URL("../assets/fx/projectiles/water.webp", import.meta.url).href,
    wind: new URL("../assets/fx/projectiles/wind.webp", import.meta.url).href,
    earth: new URL("../assets/fx/projectiles/earth.webp", import.meta.url).href,
    lightning: new URL("../assets/fx/projectiles/lightning.webp", import.meta.url).href,
};
const _projSpriteTex: Record<string, THREE.Texture> = {};
function projSpriteTexture(key?: string): THREE.Texture | null {
    if (!key) return null;
    const url = PROJ_SPRITE_URL[key];
    if (!url) return null;
    if (_projSpriteTex[key]) return _projSpriteTex[key];
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    _projSpriteTex[key] = t;
    return t;
}

/** The shared element/role-distinct projectile body — a glowing head (round
 *  fireball / undulating water ball / spinning wind crescent / tumbling rock /
 *  jagged bolt) with a comet tail and, for signature/crit shots, a pulsing aura
 *  ring. Self-animates flicker + spin off the clock (no rng → replay-safe). The
 *  PARENT group owns world position, the travel-direction rotation (so the head
 *  always points where it's going — both stages look straight down −z, so world
 *  xy == screen) and the perspective depth-scale. */
function ProjectileBody({ visual }: { visual: ProjectileVisual }) {
    const core = useRef<THREE.Mesh>(null);
    const ring = useRef<THREE.Mesh>(null);
    const ringMat = useRef<THREE.MeshBasicMaterial>(null);
    const spriteTex = projSpriteTexture(visual.spriteKey);
    const headTex = projHeadTexture(visual.tex);
    const baseW = visual.size * visual.stretch;   // head half-extent along travel
    const baseH = visual.size;                     // head half-extent across travel
    const tailLen = baseW * visual.tail * 3.2;
    // Real painted sprite → a square plane scaled so the projectile body reads at
    // ~the procedural size (the art carries its own tail/splash/dust).
    const spriteScale = visual.size * 5.4;
    const ringBase = spriteTex ? spriteScale * 0.42 : visual.size;
    useFrame((s) => {
        const t = s.clock.elapsedTime;
        const c = core.current;
        if (c) {
            const fl = visual.flicker ? 1 + Math.sin(t * 38 + visual.size * 60) * 0.5 * visual.flicker : 1;
            if (spriteTex) {
                // Real art is already aimed by the parent; only fire/lightning pulse.
                c.scale.set(spriteScale * fl, spriteScale * fl, 1);
            } else {
                c.scale.set(baseW * 2.2 * fl, baseH * 2.2 * fl, 1);
                if (visual.spin) c.rotation.z = t * visual.spin;
            }
        }
        if (ring.current && ringMat.current) {
            const p = (t * 1.7) % 1;
            const rs = ringBase * (1 + p * 2.4);
            ring.current.scale.set(rs, rs, 1);
            ringMat.current.opacity = (1 - p) * 0.45;
        }
    });

    // REAL painted element sprite (fireball / water ball / wind cut / boulder /
    // bolt): alpha-blended so true colours composite over the scene — no white-out.
    if (spriteTex) {
        return (
            <group>
                {/* faint additive halo so the shot still pops a touch + blooms */}
                <mesh position={[0, 0, -0.01]} scale={[spriteScale * 0.85, spriteScale * 0.85, 1]}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial map={projRoundTexture()} color={visual.glow} transparent opacity={0.18} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </mesh>
                <mesh ref={core}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial map={spriteTex} transparent opacity={1} depthWrite={false} toneMapped={false} />
                </mesh>
                {visual.charged && (
                    <mesh ref={ring} position={[0, 0, 0.01]}>
                        <ringGeometry args={[0.4, 0.5, 24]} />
                        <meshBasicMaterial ref={ringMat} color={visual.glow} transparent opacity={0.45} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                    </mesh>
                )}
            </group>
        );
    }

    // Procedural fallback — support heal-comet, shadow, neutral (no painted art).
    return (
        <group>
            {/* comet tail — soft glow stretched BEHIND the head (parent faces +x = travel) */}
            <mesh position={[-tailLen * 0.5 - baseW * 0.3, 0, -0.02]} scale={[tailLen, baseH * 2.6, 1]}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial map={projRoundTexture()} color={visual.glow} transparent opacity={0.5} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            {/* soft outer glow */}
            <mesh position={[0, 0, -0.01]} scale={[baseW * 3, baseH * 3, 1]}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial map={projRoundTexture()} color={visual.glow} transparent opacity={0.42} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            {/* bright head */}
            <mesh ref={core}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial map={headTex} color={visual.core} transparent opacity={0.97} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            {visual.charged && (
                <mesh ref={ring} position={[0, 0, 0.01]}>
                    <ringGeometry args={[0.4, 0.5, 24]} />
                    <meshBasicMaterial ref={ringMat} color={visual.glow} transparent opacity={0.45} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                </mesh>
            )}
        </group>
    );
}

/** One in-flight projectile — an element-distinct flying attack (fireball /
 *  water ball / wind cut / rock throw / lightning bolt) that points where it's
 *  going. Driven by the sim's homing projectile in `snapshots[t].projectiles`. */
function DuelProjectile({ index, duel, clock }: { index: number; duel: DuelResult; clock: { current: DuelClock } }) {
    const grp = useRef<THREE.Group>(null);
    const curId = useRef<number | null>(null);
    const lastAngle = useRef(0);
    const [visual, setVisual] = useState<ProjectileVisual>(() => projectileVisual({ element: null }));
    useFrame((state) => {
        const g = grp.current;
        if (!g) return;
        const snaps = duel.snapshots;
        const tf = Math.max(0, Math.min(snaps.length - 1, clock.current.t));
        const i0 = Math.floor(tf), i1 = Math.min(snaps.length - 1, i0 + 1), f = tf - i0;
        const pr = snaps[i0].projectiles[index];
        if (!pr) { g.visible = false; curId.current = null; return; }
        const nxt = snaps[i1].projectiles.find((q) => q.id === pr.id);
        // A new bolt took this slot → reselect its element-distinct look.
        if (pr.id !== curId.current) {
            curId.current = pr.id;
            setVisual(projectileVisual({ element: pr.element, kind: pr.kind, charged: pr.kind === "crush" }));
        }
        g.visible = true;
        const sx = nxt ? lerp(pr.x, nxt.x, f) : pr.x;
        const sy = nxt ? lerp(pr.y, nxt.y, f) : pr.y;
        const pp = stagePlace(sx, sy);
        g.position.set(pp.wx, pp.wy + pp.depth, 7);
        g.scale.setScalar(pp.depth);
        // Point the head along its WORLD travel direction (world xy == screen here).
        if (nxt) {
            const p1 = stagePlace(nxt.x, nxt.y);
            const dxw = p1.wx - pp.wx, dyw = p1.wy - pp.wy;
            if (dxw * dxw + dyw * dyw > 1e-5) lastAngle.current = Math.atan2(dyw, dxw);
        }
        // Water undulates a touch in flight (perpendicular sine).
        if (visual.wobble) {
            const wob = Math.sin(state.clock.elapsedTime * 9 + index) * visual.wobble * pp.depth;
            g.position.x += -Math.sin(lastAngle.current) * wob;
            g.position.y += Math.cos(lastAngle.current) * wob;
        }
        g.rotation.z = lastAngle.current;
    });
    return (
        <group ref={grp} visible={false}>
            <ProjectileBody visual={visual} />
        </group>
    );
}

/** Playback driver: advances the shared clock (with HIT-STOP on impact), spawns
 *  damage numbers + impact bursts + elemental VFX as the clock crosses events,
 *  nudges the fixed stage camera for screen-shake, and fires onEnd once. */
function DuelDirector({ duel, clock, advanceClock, onEnd, spawnNumber, spawnImpact, spawnFx, elementById }: {
    duel: DuelResult; clock: { current: DuelClock }; advanceClock: (maxT: number, delta: number) => void;
    onEnd: () => void;
    spawnNumber: (n: { x: number; z: number; text: string; crit: boolean; heal: boolean }) => void;
    spawnImpact: (n: { x: number; z: number; color: string; big: boolean }) => void;
    spawnFx: (n: { x: number; z: number; element?: string | null; scale: number; dur: number }) => void;
    elementById: Record<string, string | null | undefined>;
}) {
    const { camera } = useThree();
    const lastTick = useRef(-1);
    const ended = useRef(false);
    const shake = useRef(0);
    const hitStop = useRef(0);
    useFrame((state, delta) => {
        const snaps = duel.snapshots;
        const maxT = snaps.length - 1;
        // Hit-stop: freeze playback for a beat on impact so the blow lands with
        // weight, then resume. (delta→0 while frozen.)
        let dt = delta;
        if (hitStop.current > 0) { hitStop.current = Math.max(0, hitStop.current - delta); dt = 0; }
        advanceClock(maxT, dt);
        const cur = Math.floor(clock.current.t);
        if (cur > lastTick.current) {
            for (const e of duel.events) {
                if (e.t <= lastTick.current || e.t > cur) continue;
                const snapAt = snaps[Math.min(maxT, e.t)];
                if (e.type === "hit" && e.dmg && e.targetId) {
                    const a = findActor(snapAt, e.targetId);
                    if (a) {
                        const frac = Math.min(1, e.dmg / Math.max(1, a.maxHp));
                        const heavy = !!e.crit || frac > 0.12;
                        spawnNumber({ x: a.x, z: a.y, text: `${e.crit ? "CRIT " : ""}-${e.dmg}`, crit: !!e.crit, heal: false });
                        spawnImpact({ x: a.x, z: a.y, color: elementColor(e.element).glow, big: heavy });
                        // The elemental BURST on contact — fire/water/lightning/etc.
                        spawnFx({ x: a.x, z: a.y, element: e.element, scale: heavy ? 1.9 : 1.4, dur: heavy ? 420 : 320 });
                        hitStop.current = Math.max(hitStop.current, Math.min(0.18, 0.045 + frac * 0.5) + (e.crit ? 0.04 : 0));
                        shake.current = Math.max(shake.current, 0.5 + frac * 2.4 + (e.crit ? 0.7 : 0));
                    }
                } else if (e.type === "heal" && e.dmg && e.targetId) {
                    const a = findActor(snapAt, e.targetId);
                    if (a) spawnNumber({ x: a.x, z: a.y, text: `+${e.dmg}`, crit: false, heal: true });
                } else if ((e.type === "cast" || e.type === "ultimate") && e.actorId) {
                    // The elemental UNLEASH at the caster (ability tell).
                    const c = findActor(snapAt, e.actorId);
                    if (c) spawnFx({ x: c.x, z: c.y, element: elementById[e.actorId], scale: e.type === "ultimate" ? 2.4 : 1.3, dur: e.type === "ultimate" ? 520 : 300 });
                    if (e.type === "ultimate") shake.current = Math.max(shake.current, 1.8);
                } else if (e.type === "ko") {
                    shake.current = Math.max(shake.current, 2.8);
                    hitStop.current = Math.max(hitStop.current, 0.22);
                }
            }
            lastTick.current = cur;
        }
        // Fixed ortho stage camera + a decaying screen-shake offset (world units).
        const t = state.clock.elapsedTime;
        const a = shake.current; shake.current *= 0.85;
        const sx = a > 0.01 ? Math.sin(t * 53) * a * 0.12 : 0;
        const sy = a > 0.01 ? Math.sin(t * 61) * a * 0.08 : 0;
        camera.position.set(sx, sy, 100);
        if (!ended.current && clock.current.t >= maxT) { ended.current = true; onEnd(); }
    });
    return null;
}

/** Element-colored impact burst — an expanding additive ring + flash core. */
function DuelImpact({ at, color, big, onDone }: { at: Vec3; color: string; big: boolean; onDone: () => void }) {
    const grp = useRef<THREE.Group>(null);
    const ringMat = useRef<THREE.MeshBasicMaterial>(null);
    const coreMat = useRef<THREE.MeshBasicMaterial>(null);
    const start = useRef<number | null>(null);
    const DUR = big ? 0.42 : 0.3;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / DUR);
        if (grp.current) { const s = (big ? 0.85 : 0.6) * (0.35 + p * 1.5); grp.current.scale.set(s, s, s); }
        if (ringMat.current) ringMat.current.opacity = (1 - p) * 0.9;
        if (coreMat.current) coreMat.current.opacity = (1 - Math.min(1, p * 1.8)) * 0.85;
        if (p >= 1) onDone();
    });
    return (
        <group ref={grp} position={at}>
            <Billboard>
                <mesh>
                    <ringGeometry args={[0.42, 0.6, 24]} />
                    <meshBasicMaterial ref={ringMat} color={color} transparent opacity={0.9} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0, -0.01]}>
                    <circleGeometry args={[0.34, 16]} />
                    <meshBasicMaterial ref={coreMat} color={color} transparent opacity={0.85} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </mesh>
            </Billboard>
        </group>
    );
}

export type PetColiseumDuelProps = {
    playerPet: Pet;
    enemyPet: Pet;
    playerReservePet?: Pet;
    enemyReservePet?: Pet;
    seed: number;
    /** Precomputed duel result. When provided, the renderer PLAYS it instead of
     *  re-running the sim — so the mounting screen owns the authoritative result
     *  (for reward posting) and the sim runs exactly once. Omit only in the
     *  /petvfx.html preview harness, where the renderer self-runs from the seed. */
    result?: DuelResult;
    sharedImages?: Record<string, string>;
    onFightAgain: () => void;
    onExit: () => void;
};

export function PetColiseumDuel({ playerPet, enemyPet, playerReservePet, enemyReservePet, seed, result, sharedImages = {}, onFightAgain, onExit }: PetColiseumDuelProps) {
    const duel = useMemo(
        () => result
            ?? ((playerReservePet || enemyReservePet)
                ? runPetPartyDuel(playerPet, playerReservePet ?? null, enemyPet, enemyReservePet ?? null, seed)
                : runPetDuel(playerPet, enemyPet, seed)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [result, seed, playerPet.id, enemyPet.id, playerReservePet?.id, enemyReservePet?.id],
    );
    const roster = useMemo(() => {
        const r: Array<{ id: string; pet: Pet; mirror: boolean }> = [{ id: "player-0", pet: playerPet, mirror: false }];
        if (playerReservePet) r.push({ id: "player-1", pet: playerReservePet, mirror: false });
        r.push({ id: "enemy-0", pet: enemyPet, mirror: true });
        if (enemyReservePet) r.push({ id: "enemy-1", pet: enemyReservePet, mirror: true });
        return r;
    }, [playerPet, enemyPet, playerReservePet, enemyReservePet]);

    const clock = useRef<DuelClock>({ t: 0, playing: true });
    const seqRef = useRef(0);
    const [runId, setRunId] = useState(0);
    const [ended, setEnded] = useState(false);
    const [paused, setPaused] = useState(false);
    const [numbers, setNumbers] = useState<Array<{ id: number; text: string; pos: Vec3; crit: boolean; heal: boolean }>>([]);
    const [impacts, setImpacts] = useState<Array<{ id: number; pos: Vec3; color: string; big: boolean }>>([]);
    const [fxList, setFxList] = useState<Array<{ id: number; frames: string[]; pos: Vec3; scale: number; dur: number }>>([]);
    const elementById = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, r.pet.element])) as Record<string, string | null | undefined>, [roster]);

    // FX positions are mapped through the SAME stage projection as the fighters,
    // and pinned to a high z so they layer over every pet on the backdrop.
    const spawnNumber = (n: { x: number; z: number; text: string; crit: boolean; heal: boolean }) => {
        const id = seqRef.current++;
        const p = stagePlace(n.x, n.z);
        setNumbers((arr) => [...arr, { id, text: n.text, pos: [p.wx, p.wy + STAGE_SPRITE_H * 0.85 * p.depth + 0.5, 9], crit: n.crit, heal: n.heal }]);
        window.setTimeout(() => setNumbers((arr) => arr.filter((x) => x.id !== id)), 850);
    };
    const spawnImpact = (n: { x: number; z: number; color: string; big: boolean }) => {
        const id = seqRef.current++;
        const p = stagePlace(n.x, n.z);
        setImpacts((arr) => [...arr, { id, pos: [p.wx, p.wy + STAGE_SPRITE_H * 0.4 * p.depth, 8], color: n.color, big: n.big }]);
    };
    // Element-distinct ability VFX (real fire/water/lightning/earth/wind frames).
    const spawnFx = (n: { x: number; z: number; element?: string | null; scale: number; dur: number }) => {
        const frames = bundledJutsuFxFrames(elementVfxKey(n.element));
        if (!frames) return;
        const id = seqRef.current++;
        const p = stagePlace(n.x, n.z);
        setFxList((arr) => [...arr, { id, frames, pos: [p.wx, p.wy + STAGE_SPRITE_H * 0.4 * p.depth, 8], scale: n.scale * p.depth * 0.6, dur: n.dur }]);
    };
    const advanceClock = (maxT: number, delta: number) => {
        if (clock.current.playing) clock.current.t = Math.min(maxT, clock.current.t + delta * DUEL_TPS);
    };
    const replay = () => { clock.current.t = 0; clock.current.playing = true; setPaused(false); setEnded(false); setNumbers([]); setImpacts([]); setFxList([]); setRunId((r) => r + 1); };
    const togglePause = () => { setPaused((wasPaused) => { clock.current.playing = wasPaused; return !wasPaused; }); };
    const resultLabel = duel.result === "win" ? "Victory" : duel.result === "loss" ? "Defeat" : "Draw";

    return createPortal((
        <div style={{ position: "fixed", inset: 0, zIndex: 200, width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#05060a", backgroundImage: `url(${DIORAMA_URL})`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}>
            {/* Transparent r3f layer composited OVER the CSS diorama backdrop. The
                orthographic, cover-fit camera (StageCamera) keeps every fighter +
                FX pixel-locked to the painting at any viewport size. */}
            <Canvas dpr={[1, 2]} gl={{ alpha: true, antialias: true }} style={{ background: "transparent" }}>
                <StageCamera />
                {roster.map((r) => (
                    <DuelStandee key={r.id} duel={duel} clock={clock} id={r.id} pet={r.pet} mirror={r.mirror} sharedImages={sharedImages} />
                ))}
                {Array.from({ length: 8 }).map((_, i) => (
                    <DuelProjectile key={i} index={i} duel={duel} clock={clock} />
                ))}
                {impacts.map((im) => (
                    <DuelImpact key={im.id} at={im.pos} color={im.color} big={im.big} onDone={() => setImpacts((p) => p.filter((x) => x.id !== im.id))} />
                ))}
                {fxList.map((fx) => (
                    <FxAnim key={fx.id} frames={fx.frames} from={fx.pos} durationMs={fx.dur} scale={fx.scale} onDone={() => setFxList((p) => p.filter((x) => x.id !== fx.id))} />
                ))}
                {numbers.map((l) => (
                    <Html key={l.id} position={l.pos} center pointerEvents="none" zIndexRange={[20, 0]}>
                        <span className={l.crit ? "damage-number crit-text" : l.heal ? "heal-number" : "damage-number"} style={{ font: l.crit ? "900 24px Inter, system-ui, sans-serif" : "800 18px Inter, system-ui, sans-serif" }}>{l.text}</span>
                    </Html>
                ))}
                <DuelDirector key={runId} duel={duel} clock={clock} advanceClock={advanceClock} onEnd={() => setEnded(true)} spawnNumber={spawnNumber} spawnImpact={spawnImpact} spawnFx={spawnFx} elementById={elementById} />
                <BloomFx />
            </Canvas>

            <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8 }}>
                <button onClick={onExit} style={duelBtn}>✕ Exit</button>
                <button onClick={togglePause} style={duelBtn}>{paused ? "▶ Play" : "❚❚ Pause"}</button>
                <button onClick={replay} style={duelBtn}>⟲ Replay</button>
            </div>
            <div style={{ position: "absolute", top: 12, right: 12, padding: "4px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(168,85,247,0.6)", borderRadius: 999, color: "#d8b4fe", font: "700 11px Inter, system-ui, sans-serif" }}>🗺️ Tactical battle (beta)</div>

            {ended && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,7,18,0.55)" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ font: "900 38px Inter, system-ui, sans-serif", color: resultLabel === "Victory" ? "#4ade80" : resultLabel === "Defeat" ? "#f87171" : "#facc15", textShadow: "0 2px 12px #000" }}>{resultLabel}</div>
                        <div style={{ color: "#94a3b8", font: "600 12px Inter, system-ui, sans-serif", marginTop: 4 }}>tactical pet battle</div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                            <button onClick={replay} style={resultBtn}>⟲ Replay</button>
                            <button onClick={onFightAgain} style={resultBtn}>⚔ Fight again</button>
                            <button onClick={onExit} style={{ ...resultBtn, background: "#334155" }}>Exit</button>
                        </div>
                    </div>
                </div>
            )}
            <div style={{ position: "absolute", bottom: 12, right: 14, color: "#64748b", font: "600 11px Inter, system-ui, sans-serif" }}>tactical pet battle · diorama stage (beta)</div>
        </div>
    ), document.body);
}

// ═════════════════════════════════════════════════════════════════════════════
// PetArenaMatch — the Tactical Pet Arena game mode (docs/pet-arena-mode-plan.md):
// deathmatch + capture-the-scroll, 2v2/4v4, first to 10 points, 3 lives + respawns.
// Plays the deterministic match sim (pet-arena-sim.ts) on the same diorama stage,
// reusing the projection + pose flipbook + FX. PREVIEW-ONLY.
// ═════════════════════════════════════════════════════════════════════════════
const ARENA_SPRITE_H = 1.05;
const ROLE_COLOR: Record<ArenaRole, string> = { defender: "#60a5fa", tracker: "#34d399", assassin: "#f87171", sage: "#fbbf24" };
const ROLE_TAG: Record<ArenaRole, string> = { defender: "DEF", tracker: "TRK", assassin: "ASN", sage: "SGE" };
const findArenaActor = (s: ArenaSnapshot, id: string) => s.actors.find((a) => a.id === id);
function arenaPoseCat(st: ArenaState): PoseCat {
    if (st === "attack" || st === "dash") return "attack";
    if (st === "channel") return "cast";
    if (st === "respawning" || st === "dead") return "hurt";
    return "idle";
}

/** One arena fighter — pose flipbook + facing + HP/lives/role nameplate + carrier
 *  aura, faded while respawning/dead. Driven by the match snapshot stream. */
// One arena dash-trail ghost — element-flat silhouette behind the sprite, faded in
// by the parent's speed gate. Owns its material via a ref so the per-frame uniform
// writes are compiler-safe (mutating a memo from a parent useFrame is not).
function ArenaGhost({ index, offsetX, fastRef, tex, color, L }: {
    index: number; offsetX: number; fastRef: { current: number }; tex: THREE.Texture; color: string; L: ReturnType<typeof groundedSpriteLayout>;
}) {
    const mat = useRef<THREE.ShaderMaterial>(null);
    const material = useMemo(() => makeGhostMaterial(color), [color]);
    useEffect(() => () => material.dispose(), [material]);
    useFrame(() => {
        const m = mat.current; if (!m) return;
        m.uniforms.map.value = tex;
        m.uniforms.uOpacity.value = lerp(m.uniforms.uOpacity.value as number, fastRef.current * 0.42, 0.4);
    });
    return (
        <mesh position={[L.meshX + offsetX, L.meshY, -0.04 - index * 0.01]}>
            <planeGeometry args={[L.planeW, L.planeH]} />
            <primitive object={material} ref={mat} attach="material" />
        </mesh>
    );
}

function ArenaStandee({ result, clock, id, pet, sharedImages }: {
    result: ArenaResult; clock: { current: DuelClock }; id: string; pet: Pet; sharedImages: Record<string, string>;
}) {
    const sprite = usePetSprite(pet, sharedImages, false);
    const poses = usePetPoses(petVisualId(pet), false);
    const group = useRef<THREE.Group>(null);
    const flip = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const shadow = useRef<THREE.Mesh>(null);
    const shadowMat = useRef<THREE.MeshBasicMaterial>(null);
    const glowMat = useRef<THREE.MeshBasicMaterial>(null);
    const aura = useRef<THREE.Mesh>(null);
    const auraMat = useRef<THREE.MeshBasicMaterial>(null);
    const carryMark = useRef<HTMLSpanElement>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const nameWrap = useRef<HTMLDivElement>(null);
    const facing = useRef(id.startsWith("blue") ? 1 : -1);
    const lastPos = useRef<[number, number]>([0, 0]);
    const scaleSm = useRef(0);   // smoothed depth-scale → absorbs any residual position jitter so the sprite never pulses big↔small (snaps on a teleport)
    const runClock = useRef(0);
    const fast = useRef(0);   // speed gate 0..1 → dash-trail opacity (read by the ArenaGhost children)
    const tint = useMemo(() => elementTint(pet.element), [pet.element]);
    const bobPhase = useMemo(() => (id.charCodeAt(id.length - 1) % 7) * 0.9, [id]);
    const [poseCat, setPoseCat] = useState<PoseCat>("idle");
    const [lives, setLives] = useState(3);
    const team = id.startsWith("blue") ? "blue" : "red";
    const auraColor = team === "blue" ? "#3b82f6" : "#ef4444";   // team-colored ground glow → parse teams at a glance
    const role = (result.snapshots[0] && findArenaActor(result.snapshots[0], id)?.role) || "tracker";

    const useTex = poses ? poses.tex[poseCat] : sprite.texture;
    const useBounds = poses ? poses.scan[poseCat].bounds : sprite.bounds;
    const useAspect = poses ? poses.scan[poseCat].aspect : sprite.aspect;
    const L = useMemo(() => groundedSpriteLayout(useBounds, useAspect, ARENA_SPRITE_H, false), [useBounds, useAspect]);
    const shadowW = Math.max(0.55, L.contentWorldW * 0.95);

    useFrame((state, delta) => {
        const g = group.current, m = mat.current; if (!g || !m) return;
        const snaps = result.snapshots;
        const tf = Math.max(0, Math.min(snaps.length - 1, clock.current.t));
        const i0 = Math.floor(tf), i1 = Math.min(snaps.length - 1, i0 + 1), f = tf - i0;
        const a0 = findArenaActor(snaps[i0], id); if (!a0) return;
        const a1 = findArenaActor(snaps[i1], id) ?? a0;
        const down = a0.state === "respawning" || a0.state === "dead";
        // Snap (don't interpolate) across a respawn TELEPORT: a >3-field-unit jump in a
        // single tick is never real movement, and lerping it slides the sprite across the
        // whole board while the perspective scale sweeps — the "grows huge then small"
        // glitch. Hard-cut at the tick midpoint instead.
        const tdx = a1.x - a0.x, tdy = a1.y - a0.y;
        const teleport = (tdx * tdx + tdy * tdy) > 9;
        const ff = teleport ? (f < 0.5 ? 0 : 1) : f;
        const p = arenaPlace(lerp(a0.x, a1.x, ff), lerp(a0.y, a1.y, ff));
        const dx = p.wx - lastPos.current[0], dy = p.wy - lastPos.current[1];
        const spd = Math.sqrt(dx * dx + dy * dy); lastPos.current = [p.wx, p.wy];
        const moving = spd > 0.012 && !down;
        // Smooth the depth-scale: snap on a teleport (which already hard-cuts position),
        // else ease toward the target so a jittery tick can't pop the sprite's size.
        scaleSm.current = (teleport || scaleSm.current === 0) ? p.depth : lerp(scaleSm.current, p.depth, 0.25);
        // Dash trail: a single element-flat ghost that fades in ONLY at genuine dash speed
        // (an assassin dive streaks; an ordinary stroll doesn't). Gate raised so routine
        // movement no longer leaves a constant smear of afterimages.
        fast.current = down ? 0 : Math.max(0, Math.min(1, (spd - 0.07) / 0.13));
        const bob = moving ? Math.abs(Math.sin(state.clock.elapsedTime * 13 + bobPhase)) * 0.16 : 0;
        g.position.set(p.wx, p.wy + bob * p.depth, p.zo);
        g.scale.setScalar(scaleSm.current);
        // Hide downed/respawning pets entirely — a faded corpse frozen at the death spot
        // read as a "spawn freeze". The scorch decal + kill FX already mark where it fell.
        g.visible = !down;

        if (Math.abs(a0.faceX) > 0.12) facing.current = a0.faceX < 0 ? -1 : 1;
        if (flip.current) { flip.current.scale.x = facing.current; flip.current.rotation.z = lerp(flip.current.rotation.z, moving ? -0.12 : 0, 0.2); }

        let cat = arenaPoseCat(a0.state);
        if (moving && poses?.hasRun) { runClock.current += delta * 8.5; cat = Math.floor(runClock.current) % 2 === 0 ? "run-a" : "run-b"; }
        if (cat !== poseCat) setPoseCat(cat);
        m.opacity = down ? 0.28 : 1;

        if (a0.lives !== lives) setLives(a0.lives);
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, (a0.hp / Math.max(1, a0.maxHp)) * 100))}%`;
        if (nameWrap.current) nameWrap.current.style.opacity = down ? "0.4" : "1";
        if (glowMat.current) glowMat.current.opacity = a0.carrying ? 0.55 + Math.abs(Math.sin(state.clock.elapsedTime * 5)) * 0.35 : 0;
        if (carryMark.current) carryMark.current.style.display = a0.carrying ? "inline" : "none";
        if (shadow.current && shadowMat.current) {
            shadow.current.position.set(p.wx, p.wy - 0.08 * p.depth, p.zo - 0.1);
            shadow.current.scale.set(shadowW * scaleSm.current, shadowW * 0.32 * scaleSm.current, 1);
            shadowMat.current.opacity = down ? 0 : 0.4;
        }
        if (aura.current && auraMat.current) {   // team-colored ground glow (brighter while carrying)
            aura.current.position.set(p.wx, p.wy - 0.05 * p.depth, p.zo - 0.12);
            const aw = shadowW * 1.6 * scaleSm.current; aura.current.scale.set(aw, aw * 0.46, 1);
            auraMat.current.opacity = down ? 0 : (a0.carrying ? 0.85 : 0.5);
        }
    });

    return (
        <group>
            <mesh ref={aura} renderOrder={-2}><planeGeometry args={[1, 1]} /><meshBasicMaterial ref={auraMat} map={shadowTexture()} color={auraColor} transparent opacity={0.5} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
            <mesh ref={shadow} renderOrder={-1}><planeGeometry args={[1, 1]} /><meshBasicMaterial ref={shadowMat} map={shadowTexture()} transparent opacity={0.4} depthWrite={false} depthTest={false} toneMapped={false} /></mesh>
            <group ref={group}>
                <mesh position={[0, shadowW * 0.5, -0.05]}><planeGeometry args={[shadowW * 2.6, shadowW * 2.6]} /><meshBasicMaterial ref={glowMat} map={shadowTexture()} color="#fde047" transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
                <group ref={flip}>
                    {/* A single dash-trail ghost BEHIND the sprite (local -x = behind facing), faded in only at dash speed. */}
                    <ArenaGhost index={0} offsetX={-0.55} fastRef={fast} tex={useTex} color={tint} L={L} />
                    <mesh position={[L.meshX, L.meshY, 0]}>
                        <planeGeometry args={[L.planeW, L.planeH]} />
                        <meshBasicMaterial ref={mat} map={useTex} transparent alphaTest={0.4} depthWrite={false} toneMapped={false} />
                    </mesh>
                </group>
                {/* Idle elemental aura — a few drifting element-tinted wisps so the creature reads ALIVE, not a static cutout. */}
                <Sparkles count={5} scale={[1.0, 1.5, 0.6]} position={[0, 0.95, 0.05]} size={2.6} speed={0.25} opacity={0.5} color={tint} noise={1.2} />
                <Html position={[0, L.contentWorldH + 0.4, 0]} center pointerEvents="none" zIndexRange={[6, 0]}>
                    <div ref={nameWrap} style={{ textAlign: "center", font: "700 10px Inter, system-ui, sans-serif", whiteSpace: "nowrap", userSelect: "none", transform: "scale(0.78)" }}>
                        <div style={{ display: "flex", gap: 3, alignItems: "center", justifyContent: "center", marginBottom: 2 }}>
                            <span ref={carryMark} style={{ display: "none", filter: "drop-shadow(0 0 3px #fde047)" }}>📜</span>
                            <span style={{ color: ROLE_COLOR[role], border: `1px solid ${ROLE_COLOR[role]}`, borderRadius: 3, padding: "0 2px", fontSize: 8 }}>{ROLE_TAG[role]}</span>
                            <span style={{ color: "#fff", textShadow: "0 1px 2px #000" }}>{pet.name}</span>
                        </div>
                        <div style={{ width: 56, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ width: "100%", height: "100%", background: team === "blue" ? "#4ade80" : "#f87171" }} />
                        </div>
                        <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 2 }}>
                            {[0, 1, 2].map((i) => (<span key={i} style={{ width: 5, height: 5, borderRadius: 5, background: i < lives ? (team === "blue" ? "#60a5fa" : "#fca5a5") : "#334155" }} />))}
                        </div>
                    </div>
                </Html>
            </group>
        </group>
    );
}

/** The center scroll — a floating relic, with a channel ring while being picked up. */
function ArenaScroll({ result, clock }: { result: ArenaResult; clock: { current: DuelClock } }) {
    const grp = useRef<THREE.Group>(null);
    const beacon = useRef<THREE.Mesh>(null);
    const beaconMat = useRef<THREE.MeshBasicMaterial>(null);
    const ringRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    useFrame((state) => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const sc = snaps[i].scroll;
        const vis = sc.state !== "inactive";
        if (vis !== visible) setVisible(vis);
        if (!vis) return;
        const p = arenaPlace(sc.x, sc.y);
        if (grp.current) { grp.current.position.set(p.wx, p.wy + 0.9 * p.depth + Math.abs(Math.sin(state.clock.elapsedTime * 2)) * 0.18, 8.5); grp.current.scale.setScalar(p.depth); }
        // Pulsing ground beacon — marks WHERE the scroll is even when pets cover it
        // (the whole game is fought here). Off while it's being carried (the carrier glows instead).
        if (beacon.current && beaconMat.current) {
            const pulse = 0.5 + Math.abs(Math.sin(state.clock.elapsedTime * 3)) * 0.5;
            beacon.current.position.set(p.wx, p.wy - 0.04 * p.depth, p.zo - 0.1);
            const bw = (2.6 + pulse * 0.7) * p.depth; beacon.current.scale.set(bw, bw * 0.5, 1);
            beaconMat.current.opacity = sc.state === "carried" ? 0 : 0.4 + pulse * 0.4;
        }
        if (ringRef.current) { ringRef.current.style.opacity = sc.channelFrac > 0 ? "1" : "0"; ringRef.current.style.background = `conic-gradient(#fde047 ${sc.channelFrac * 360}deg, rgba(0,0,0,0.35) 0deg)`; }
    });
    if (!visible) return null;
    return (
        <group>
            <mesh ref={beacon} renderOrder={-1}><planeGeometry args={[1, 1]} /><meshBasicMaterial ref={beaconMat} map={shadowTexture()} color="#fde047" transparent opacity={0.5} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
            <group ref={grp}>
                <Html center pointerEvents="none" zIndexRange={[30, 0]}>
                    <div style={{ position: "relative", width: 42, height: 42, display: "grid", placeItems: "center" }}>
                        <div ref={ringRef} style={{ position: "absolute", inset: -7, borderRadius: "50%", opacity: 0 }} />
                        <div style={{ fontSize: 34, filter: "drop-shadow(0 0 12px #fde047) drop-shadow(0 0 5px #fff)" }}>📜</div>
                    </div>
                </Html>
            </group>
        </group>
    );
}

/** A synthesised travelling projectile for the tactical arena. The arena sim has
 *  NO projectiles — ranged hits/heals resolve at the target — so the renderer
 *  flies a cosmetic element/role-distinct streak from the shooter to the victim
 *  that lands just as the impact FX fires. Pure presentation; never read by the
 *  sim (no balance / determinism tie). */
function ArenaShot({ from, to, visual, dur, depth, arc, onDone }: {
    from: Vec3; to: Vec3; visual: ProjectileVisual; dur: number; depth: number; arc: number; onDone: () => void;
}) {
    const grp = useRef<THREE.Group>(null);
    const start = useRef<number | null>(null);
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);   // world xy == screen here
    useFrame((state) => {
        const g = grp.current; if (!g) return;
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) * 1000 / dur);
        const x = lerp(from[0], to[0], p);
        const y = lerp(from[1], to[1], p) + (arc ? Math.sin(p * Math.PI) * arc * depth : 0);   // a small lob for thrown rock
        g.position.set(x, y, from[2]);
        g.rotation.z = angle;
        g.scale.setScalar(depth * (0.55 + 0.45 * Math.min(1, p / 0.12)));   // quick scale-in at the muzzle
        if (p >= 1) onDone();
    });
    return (<group ref={grp}><ProjectileBody visual={visual} /></group>);
}

/** Advances the clock, spawns elemental FX on hits/abilities, updates the score HUD. */
function ArenaDirector({ result, clock, advanceClock, onEnd, spawnFx, spawnShot, spawnFloater, spawnDecal, pushFeed, triggerHitstop, triggerShake, triggerSlowmo, triggerFlash, pushBanner, nameOf, setScore }: {
    result: ArenaResult; clock: { current: DuelClock }; advanceClock: (maxT: number, delta: number) => void; onEnd: () => void;
    spawnFx: (n: { x: number; z: number; element?: string | null; key?: string; scale: number; dur: number }) => void;
    spawnShot: (n: { fromX: number; fromY: number; toX: number; toY: number; element?: string | null; role?: string | null; kind?: string | null; support?: boolean; charged?: boolean }) => void;
    spawnFloater: (x: number, z: number, text: string, color: string, big: boolean) => void;
    spawnDecal: (x: number, z: number) => void;
    pushFeed: (text: string, color: string) => void;
    triggerHitstop: (ms: number) => void;
    triggerShake: (amp: number) => void;
    triggerSlowmo: (ms: number, factor: number) => void;
    triggerFlash: (color: string) => void;
    pushBanner: (text: string, color: string) => void;
    nameOf: (id: string) => string;
    setScore: (b: number, r: number) => void;
}) {
    const lastTick = useRef(-1); const ended = useRef(false);
    const streak = useRef<{ blue: number; red: number; lastT: number }>({ blue: 0, red: 0, lastT: -999 });
    useFrame((_s, delta) => {
        const snaps = result.snapshots; const maxT = snaps.length - 1;
        advanceClock(maxT, delta);
        const cur = Math.floor(clock.current.t);
        if (cur < lastTick.current) { lastTick.current = -1; streak.current = { blue: 0, red: 0, lastT: -999 }; }   // clock rewound (replay) → re-fire events
        if (cur > lastTick.current) {
            for (const e of result.events) {
                if (e.t <= lastTick.current || e.t > cur) continue;
                const snapAt = snaps[Math.min(maxT, e.t)];
                if (e.type === "hit") {
                    const a = findArenaActor(snapAt, e.targetId);
                    const src = findArenaActor(snapAt, e.actorId);
                    if (a) {
                        // An ABILITY-tagged hit is the tracker's MARK (only it deals ability damage) → a dark sigil; else the element burst.
                        if (e.ability) spawnFx({ x: a.x, z: a.y, key: "shadow", scale: 1.8, dur: 430 });
                        else spawnFx({ x: a.x, z: a.y, element: e.element, scale: e.crit ? 2.2 : 1.3, dur: 300 });
                        spawnFloater(a.x, a.y, `${e.dmg}`, e.crit ? "#fde047" : "#fecaca", e.crit);
                        if (e.crit) { spawnFx({ x: a.x, z: a.y, key: "spark", scale: 2.0, dur: 240 }); triggerHitstop(45); triggerShake(0.5); }   // crits land with a flash + a little weight
                        // A ranged blow / tracker mark / assassin lunge flies a projectile in from the shooter
                        // (melee swings at point-blank skip it — the impact burst is enough).
                        if (src) {
                            const gap = Math.hypot(a.x - src.x, a.y - src.y);
                            if (gap >= 1.6 || e.ability || (src.role === "assassin" && gap >= 0.6))
                                spawnShot({ fromX: src.x, fromY: src.y, toX: a.x, toY: a.y, element: e.element, role: src.role, kind: e.ability ? "mark" : "damage", charged: e.crit });
                        }
                    }
                } else if (e.type === "ability") {
                    // Each role ability reads distinctly (mend glow / guard dome / mark gather / assassin dash-flash).
                    const a = findArenaActor(snapAt, e.actorId);
                    if (a) { const pick = arenaAbilityFxKey(e.kind); if (pick.key) spawnFx({ x: a.x, z: a.y, key: pick.key, scale: e.kind === "guard" ? 2.1 : 1.7, dur: 440 }); }
                } else if (e.type === "heal") {
                    const a = findArenaActor(snapAt, e.targetId);
                    const src = findArenaActor(snapAt, e.actorId);
                    if (a) {
                        spawnFx({ x: a.x, z: a.y, key: "heal", scale: 1.7, dur: 470 }); spawnFloater(a.x, a.y, `+${e.amount}`, "#86efac", false);
                        // The sage floats a soft heal-comet to the ally it mends.
                        if (src && src.id !== a.id && Math.hypot(a.x - src.x, a.y - src.y) >= 1.2)
                            spawnShot({ fromX: src.x, fromY: src.y, toX: a.x, toY: a.y, element: src.element, role: src.role, support: true });
                    }
                } else if (e.type === "shield") {
                    const a = findArenaActor(snapAt, e.targetId);
                    const src = findArenaActor(snapAt, e.actorId);
                    if (a) {
                        spawnFx({ x: a.x, z: a.y, key: "eshield", scale: 2.0, dur: 480 });
                        // A shield cast ONTO an ally (not the defender's self-guard) flies a ward-comet over.
                        if (src && src.id !== a.id && Math.hypot(a.x - src.x, a.y - src.y) >= 1.2)
                            spawnShot({ fromX: src.x, fromY: src.y, toX: a.x, toY: a.y, element: src.element, role: src.role, support: true });
                    }
                } else if (e.type === "kill") {
                    const a = findArenaActor(snapAt, e.targetId);
                    if (a) { spawnFx({ x: a.x, z: a.y, key: arenaKillFxKey(a.element), scale: 3.0, dur: 560 }); spawnFx({ x: a.x, z: a.y, key: "spark", scale: 2.4, dur: 360 }); spawnDecal(a.x, a.y); }
                    pushFeed(`☠ ${nameOf(e.targetId)}`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    triggerHitstop(70); triggerSlowmo(220, 0.42); triggerShake(1.1);   // freeze the contact frame, then ease through the kill in slow-mo
                    const w = ARENA_TPS * 3.5;
                    if (e.t - streak.current.lastT > w) { streak.current.blue = 0; streak.current.red = 0; }
                    streak.current.lastT = e.t; streak.current[e.team] += 1;
                    const label = multiKillLabel(streak.current[e.team]);
                    if (label) pushBanner(label, e.team === "blue" ? "#93c5fd" : "#fca5a5");   // Double/Triple/… as the squad chain-kills
                } else if (e.type === "capture") {
                    const c = e.actorId ? findArenaActor(snapAt, e.actorId) : null;
                    if (c) spawnFx({ x: c.x, z: c.y, key: "power", scale: 4.0, dur: 720 });   // the apex burst at the scoring base
                    const matchPoint = (e.team === "blue" ? snapAt.scoreBlue : snapAt.scoreRed) >= WIN_SCORE;
                    pushFeed(`📜 ${e.team === "blue" ? "Blue" : "Red"} captured the scroll!`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    pushBanner(matchPoint ? `${e.team === "blue" ? "BLUE" : "RED"} WINS! 📜` : `${e.team === "blue" ? "BLUE" : "RED"} SCORES! 📜`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.5)" : "rgba(239,68,68,0.5)");
                    triggerHitstop(90); triggerSlowmo(matchPoint ? 460 : 280, 0.38); triggerShake(1.4);
                } else if (e.type === "pickup" && e.actorId) {
                    pushFeed(`📜 ${nameOf(e.actorId)} took the scroll`, e.team === "blue" ? "#93c5fd" : "#fca5a5");
                }
            }
            const s = snaps[Math.min(maxT, cur)]; setScore(s.scoreBlue, s.scoreRed);
            lastTick.current = cur;
        }
        if (!ended.current && clock.current.t >= maxT) { ended.current = true; onEnd(); }
    });
    return null;
}

/** A short-lived floating combat number (damage / heal) that rises + fades. */
function ArenaFloater({ pos, text, color, big }: { pos: Vec3; text: string; color: string; big: boolean }) {
    return (
        <Html position={pos} center pointerEvents="none" zIndexRange={[45, 0]}>
            <div style={{ font: `${big ? 900 : 800} ${big ? 22 : 13}px Inter, system-ui, sans-serif`, color, textShadow: "0 1px 2px #000, 0 0 5px rgba(0,0,0,0.7)", whiteSpace: "nowrap", animation: "arenaFloat 0.9s ease-out forwards" }}>{text}</div>
        </Html>
    );
}

/** Camera. DEFAULT = the whole map (z=1, identity) so you read the full board.
 *  Only when the scroll is being CARRIED does it ease in a touch and follow the
 *  carrier (the dramatic "will they make it home?" moment), then ease back out
 *  when the carry ends. Drives a CSS transform on the whole stage (backdrop +
 *  canvas + Html scale as one → pets stay locked to the painted paths). */
function ArenaCamera({ result, clock, stageRef, shake }: { result: ArenaResult; clock: { current: DuelClock }; stageRef: React.MutableRefObject<HTMLDivElement | null>; shake: React.MutableRefObject<number> }) {
    const size = useThree((s) => s.size);
    const sm = useRef({ cx: 0, cy: 0, z: 1, init: true });
    const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
    useFrame((state) => {
        const el = stageRef.current; if (!el || size.height < 1) return;
        const snaps = result.snapshots; const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const snap = snaps[i];
        let tcx = 0, tcy = 0, tz = 1;   // default: centered, WHOLE map (contain)
        if (snap.scroll.state === "carried" && snap.scroll.carrierId) {
            const c = snap.actors.find((a) => a.id === snap.scroll.carrierId);
            if (c) { const p = arenaPlace(c.x, c.y); tcx = p.wx; tcy = p.wy; tz = 1.35; }   // ease in on the carrier ("will they make it home?")
        } else {
            // No carry → frame the ACTION: centroid of living pets, and push in when they
            // cluster (a teamfight), stay wide when they're spread out (laning/traversal).
            let n = 0, mx = 0, my = 0; const live: Array<{ x: number; y: number }> = [];
            for (const a of snap.actors) { if (a.state === "dead" || a.state === "respawning") continue; mx += a.x; my += a.y; n++; live.push(a); }
            if (n > 0) {
                mx /= n; my /= n;
                let span = 0; for (const a of live) { const dx = a.x - mx, dy = a.y - my; const d = Math.sqrt(dx * dx + dy * dy); if (d > span) span = d; }
                const p = arenaPlace(mx, my); tcx = p.wx; tcy = p.wy;
                tz = clamp(1.28 - span * 0.03, 1, 1.28);   // tight cluster → push in (~1.28); spread → whole map (1.0)
            }
        }
        const s = sm.current;
        s.cx += (tcx - s.cx) * 0.04; s.cy += (tcy - s.cy) * 0.04; s.z += (tz - s.z) * 0.04;   // gentle glide (no jerk)
        const zoomCam = Math.min(size.width / STAGE.worldW, size.height / STAGE.worldH);   // contain-fit (matches StageCamera + bg)
        const fx = size.width / 2 + s.cx * zoomCam, fy = size.height / 2 - s.cy * zoomCam;
        let tx = size.width / 2 - fx * s.z, ty = size.height / 2 - fy * s.z;
        tx = clamp(tx, size.width * (1 - s.z), 0); ty = clamp(ty, size.height * (1 - s.z), 0);   // keep the diorama covering the frame
        // Impact shake — decaying screen jolt on crits / kills / captures (read-only here;
        // advanceClock owns + decays the ref). Cosmetic, additive on top of the framing.
        const amp = shake.current;
        if (amp > 0.01) { tx += Math.sin(state.clock.elapsedTime * 92) * amp * 6; ty += Math.cos(state.clock.elapsedTime * 77) * amp * 6; }
        el.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.z.toFixed(3)})`;
    });
    return null;
}

export type PetArenaMatchProps = {
    blue: ArenaSlot[]; red: ArenaSlot[]; seed: number;
    /** PvP-ladder replay: equip both teams' PVP gear + consumables so the cinematic
     *  matches the server's item-aware resolution. Default off → casual unchanged. */
    applyItems?: boolean;
    sharedImages?: Record<string, string>; onExit: () => void;
};
export function PetArenaMatch({ blue, red, seed, applyItems = false, sharedImages = {}, onExit }: PetArenaMatchProps) {
    const result = useMemo(() => runPetArenaMatch(blue, red, seed, applyItems), [blue, red, seed, applyItems]);
    const roster = useMemo(() => [
        ...blue.map((s, i) => ({ id: `blue-${i}`, pet: s.pet })),
        ...red.map((s, i) => ({ id: `red-${i}`, pet: s.pet })),
    ], [blue, red]);
    const clock = useRef<DuelClock>({ t: 0, playing: true });
    const seqRef = useRef(0);
    const hitstop = useRef(0);
    const shake = useRef(0);                                   // camera shake amplitude (decays in ArenaCamera)
    const slowmo = useRef({ ms: 0, factor: 1 });               // dramatic slow-mo on kills/captures
    const stageRef = useRef<HTMLDivElement | null>(null);   // the action-camera transforms this (backdrop + canvas together)
    const [ended, setEnded] = useState(false);
    const [flash, setFlash] = useState<{ id: number; color: string } | null>(null);   // screen flash on captures
    const [banner, setBanner] = useState<{ id: number; text: string; color: string } | null>(null);   // multi-kill / SCORES! callout
    const [score, setScoreState] = useState<[number, number]>([0, 0]);
    const [fxList, setFxList] = useState<Array<{ id: number; frames: string[]; pos: Vec3; scale: number; dur: number }>>([]);
    const [shots, setShots] = useState<Array<{ id: number; from: Vec3; to: Vec3; visual: ProjectileVisual; dur: number; depth: number; arc: number }>>([]);   // synthesised travelling projectiles
    const [floaters, setFloaters] = useState<Array<{ id: number; pos: Vec3; text: string; color: string; big: boolean }>>([]);
    const [feed, setFeed] = useState<Array<{ id: number; text: string; color: string }>>([]);
    const [decals, setDecals] = useState<Array<{ id: number; pos: Vec3; w: number }>>([]);   // accumulating scorch marks where pets fell
    const nameById = useMemo(() => { const m = new Map<string, string>(); roster.forEach((r) => m.set(r.id, r.pet.name)); return m; }, [roster]);
    const nameOf = (id: string) => nameById.get(id) ?? id;
    const setScore = (b: number, r: number) => setScoreState((p) => (p[0] === b && p[1] === r ? p : [b, r]));
    const spawnFx = (n: { x: number; z: number; element?: string | null; key?: string; scale: number; dur: number }) => {
        const frames = (n.key ? bundledJutsuFxFrames(n.key) : null) ?? bundledJutsuFxFrames(elementVfxKey(n.element)) ?? bundledJutsuFxFrames("none");
        if (!frames) return;
        const id = seqRef.current++; const p = arenaPlace(n.x, n.z);
        setFxList((arr) => [...arr, { id, frames, pos: [p.wx, p.wy + 1.0 * p.depth, 8], scale: n.scale * p.depth * 0.78, dur: n.dur }]);   // beefier FX
    };
    // Fly a cosmetic element/role-distinct projectile from a shooter to its target.
    const spawnShot = (n: { fromX: number; fromY: number; toX: number; toY: number; element?: string | null; role?: string | null; kind?: string | null; support?: boolean; charged?: boolean }) => {
        const visual = projectileVisual({ element: n.element, role: n.role, kind: n.kind, support: n.support, charged: n.charged });
        const a = arenaPlace(n.fromX, n.fromY), b = arenaPlace(n.toX, n.toY);
        const distW = Math.hypot(b.wx - a.wx, b.wy - a.wy);
        // Travel time. The old 120–360ms (÷ speedMul) blinked past too fast to read;
        // slow it down with a firm ~420ms floor so every shot is legible, while
        // longer shots + speed-role pets still scale a little.
        let dur = (260 + distW * 24) / Math.max(0.85, visual.speedMul);
        if (visual.tex === "bolt") dur *= 0.85;   // lightning still snaps, but stays visible
        dur = Math.min(820, Math.max(420, dur));
        const id = seqRef.current++;
        setShots((arr) => [...arr, {
            id,
            from: [a.wx, a.wy + 1.0 * a.depth, 8] as Vec3,
            to: [b.wx, b.wy + 1.0 * b.depth, 8] as Vec3,
            visual, dur, depth: b.depth, arc: visual.tex === "rock" ? 0.8 : 0,
        }]);
    };
    const spawnFloater = (x: number, z: number, text: string, color: string, big: boolean) => {
        const p = arenaPlace(x, z); const id = seqRef.current++;
        setFloaters((arr) => [...arr, { id, pos: [p.wx, p.wy + 1.3 * p.depth, 9], text, color, big }]);
        window.setTimeout(() => setFloaters((arr) => arr.filter((f) => f.id !== id)), 950);
    };
    const pushFeed = (text: string, color: string) => {
        const id = seqRef.current++;
        setFeed((arr) => [{ id, text, color }, ...arr].slice(0, 6));
        window.setTimeout(() => setFeed((arr) => arr.filter((f) => f.id !== id)), 4500);
    };
    const spawnDecal = (x: number, z: number) => {
        const p = arenaPlace(x, z); const id = seqRef.current++;
        setDecals((arr) => [...arr, { id, pos: [p.wx, p.wy - 0.12 * p.depth, 7] as Vec3, w: 1.7 * p.depth }].slice(-12));   // keep the last 12 — the arena testifies a real fight happened
    };
    const triggerHitstop = (ms: number) => { hitstop.current = Math.max(hitstop.current, ms); };
    const triggerShake = (amp: number) => { shake.current = Math.max(shake.current, amp); };
    const triggerSlowmo = (ms: number, factor: number) => { if (ms > slowmo.current.ms) slowmo.current = { ms, factor }; };
    const triggerFlash = (color: string) => { const id = seqRef.current++; setFlash({ id, color }); window.setTimeout(() => setFlash((f) => (f && f.id === id ? null : f)), 380); };
    const pushBanner = (text: string, color: string) => { const id = seqRef.current++; setBanner({ id, text, color }); window.setTimeout(() => setBanner((b) => (b && b.id === id ? null : b)), 1500); };
    const advanceClock = (maxT: number, delta: number) => {
        if (shake.current > 0.01) shake.current *= 0.85;   // decay the screen-shake amplitude (this closure owns the ref; ArenaCamera only reads it)
        if (hitstop.current > 0) { hitstop.current -= delta * 1000; return; }   // brief hard freeze on the contact frame
        let factor = 1;
        if (slowmo.current.ms > 0) { slowmo.current.ms -= delta * 1000; factor = slowmo.current.factor; }   // then ease through the moment in slow-mo (speed CONTRAST sells impact)
        if (clock.current.playing) clock.current.t = Math.min(maxT, clock.current.t + delta * ARENA_TPS * factor);
    };
    const replay = () => { clock.current.t = 0; clock.current.playing = true; hitstop.current = 0; shake.current = 0; slowmo.current = { ms: 0, factor: 1 }; setEnded(false); setFlash(null); setBanner(null); setScoreState([0, 0]); setFxList([]); setShots([]); setFloaters([]); setFeed([]); setDecals([]); };
    const winLabel = result.winner === "blue" ? "Blue Team Wins" : result.winner === "red" ? "Red Team Wins" : "Draw";

    return createPortal((
        <div style={{ position: "fixed", inset: 0, zIndex: 200, width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#05060a" }}>
            <style>{`@keyframes arenaFloat{0%{transform:translateY(4px);opacity:0}15%{opacity:1}100%{transform:translateY(-30px);opacity:0}}@keyframes arenaFeedIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}@keyframes arenaFlash{0%{opacity:0}12%{opacity:0.85}100%{opacity:0}}@keyframes arenaBanner{0%{opacity:0;transform:translate(-50%,-50%) scale(0.6)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}30%{transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-58%) scale(1)}}`}</style>
            {/* The STAGE — backdrop + canvas + Html overlays — is one layer the action camera scales/pans as a unit (everything stays pixel-locked). HUD lives outside it. */}
            <div ref={stageRef} style={{ position: "absolute", inset: 0, backgroundImage: `url(${DIORAMA_URL})`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat", transformOrigin: "0 0", willChange: "transform" }}>
                <Canvas dpr={[1, 2]} gl={{ alpha: true, antialias: true }} style={{ background: "transparent" }}>
                    <StageCamera fit="contain" />
                    {/* Ambient life — warm dust/embers drifting over the whole arena so the stage breathes. */}
                    <Sparkles count={36} scale={[STAGE.worldW, STAGE.worldH, 4]} position={[0, 2, 4]} size={2} speed={0.12} opacity={0.3} color="#fde9b8" noise={2} />
                    {/* Accumulating scorch decals where pets fell — the board remembers the fight. */}
                    {decals.map((d) => (<mesh key={d.id} position={d.pos} renderOrder={-3}><planeGeometry args={[d.w, d.w * 0.55]} /><meshBasicMaterial map={shadowTexture()} color="#2a1d12" transparent opacity={0.5} depthWrite={false} depthTest={false} toneMapped={false} /></mesh>))}
                    {/* Spawn seals + center paw are painted into the diorama — no ring overlays. */}
                    {roster.map((r) => (<ArenaStandee key={r.id} result={result} clock={clock} id={r.id} pet={r.pet} sharedImages={sharedImages} />))}
                    <ArenaScroll result={result} clock={clock} />
                    {fxList.map((fx) => (<FxAnim key={fx.id} frames={fx.frames} from={fx.pos} durationMs={fx.dur} scale={fx.scale} onDone={() => setFxList((p) => p.filter((x) => x.id !== fx.id))} />))}
                    {shots.map((sh) => (<ArenaShot key={sh.id} from={sh.from} to={sh.to} visual={sh.visual} dur={sh.dur} depth={sh.depth} arc={sh.arc} onDone={() => setShots((p) => p.filter((x) => x.id !== sh.id))} />))}
                    {floaters.map((f) => (<ArenaFloater key={f.id} pos={f.pos} text={f.text} color={f.color} big={f.big} />))}
                    <ArenaCamera result={result} clock={clock} stageRef={stageRef} shake={shake} />
                    <ArenaDirector result={result} clock={clock} advanceClock={advanceClock} onEnd={() => setEnded(true)} spawnFx={spawnFx} spawnShot={spawnShot} spawnFloater={spawnFloater} spawnDecal={spawnDecal} pushFeed={pushFeed} triggerHitstop={triggerHitstop} triggerShake={triggerShake} triggerSlowmo={triggerSlowmo} triggerFlash={triggerFlash} pushBanner={pushBanner} nameOf={nameOf} setScore={setScore} />
                    <BloomFx />
                </Canvas>
            </div>

            {/* Screen wash on captures — a team-colored EDGE vignette (cinematic, not a blinding full flash) */}
            {flash && <div key={flash.id} style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, transparent 38%, ${flash.color} 100%)`, pointerEvents: "none", animation: "arenaFlash 0.4s ease-out forwards", mixBlendMode: "screen" }} />}
            {/* Big centered callout — multi-kills + SCORES! */}
            {banner && <div key={banner.id} style={{ position: "absolute", top: "32%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none", color: banner.color, font: "900 44px Inter, system-ui, sans-serif", letterSpacing: 1, textShadow: "0 3px 16px #000, 0 0 24px currentColor", whiteSpace: "nowrap", animation: "arenaBanner 1.5s cubic-bezier(.2,.8,.2,1) forwards" }}>{banner.text}</div>}

            {/* Kill feed — instant read of what just happened */}
            <div style={{ position: "absolute", top: 52, right: 12, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", pointerEvents: "none" }}>
                {feed.map((f) => (<div key={f.id} style={{ padding: "3px 9px", background: "rgba(8,12,24,0.82)", border: `1px solid ${f.color}66`, borderRadius: 6, color: f.color, font: "700 12px Inter, system-ui, sans-serif", animation: "arenaFeedIn 0.2s ease-out" }}>{f.text}</div>))}
            </div>

            {/* Scoreboard */}
            <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 14, padding: "6px 18px", background: "rgba(8,12,24,0.82)", border: "1px solid rgba(148,163,184,0.4)", borderRadius: 999, font: "800 20px Inter, system-ui, sans-serif" }}>
                <span style={{ color: "#60a5fa" }}>BLUE {score[0]}</span>
                <span style={{ color: "#64748b", fontSize: 12, fontWeight: 600 }}>first to {WIN_SCORE}</span>
                <span style={{ color: "#f87171" }}>{score[1]} RED</span>
            </div>

            <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8 }}>
                <button onClick={onExit} style={duelBtn}>✕ Exit</button>
                <button onClick={replay} style={duelBtn}>⟲ Replay</button>
            </div>
            <div style={{ position: "absolute", top: 12, right: 12, padding: "4px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(168,85,247,0.6)", borderRadius: 999, color: "#d8b4fe", font: "700 11px Inter, system-ui, sans-serif" }}>🏟️ Arena: capture + deathmatch (beta)</div>

            {ended && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,7,18,0.55)" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ font: "900 38px Inter, system-ui, sans-serif", color: result.winner === "blue" ? "#60a5fa" : result.winner === "red" ? "#f87171" : "#facc15", textShadow: "0 2px 12px #000" }}>{winLabel}</div>
                        <div style={{ color: "#94a3b8", font: "700 16px Inter, system-ui, sans-serif", marginTop: 4 }}>{result.scoreBlue} — {result.scoreRed}</div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                            <button onClick={replay} style={resultBtn}>⟲ Replay</button>
                            <button onClick={onExit} style={{ ...resultBtn, background: "#334155" }}>Exit</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    ), document.body);
}
