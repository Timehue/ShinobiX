/*
 * ── PetColiseum — hybrid 3D coliseum battle renderer ──────────────────────────
 * A react-three-fiber drop-in alternative to PetArenaBattlefield. Approved pets
 * fight as lit, shadow-casting GLB models with real floor movement and facing;
 * the rest retain their HD-2D full-body standee until their model is ready.
 * Both paths lunge, recoil, guard, dodge and topple on KO, with elemental VFX
 * and a cinematic camera selling the heavy blows.
 *
 * CRITICAL: this is a pure PRESENTATION layer. It consumes the SAME inputs the
 * DOM renderer does — the deterministic frame, the buildPetAnimationEvents()
 * queue, petPoseForAvatar(), petBattleCamera(), petFxSpriteKey() — and drives
 * motion off them. It never resolves combat, so balance / odds / ranked-replay
 * determinism are untouched. Motion easing + camera shake use a clock/sin only
 * (no RNG) and never feed back into the sim.
 *
 * The fallback billboard texture is the pet's published battle art (via
 * petBattleSprite → sharedImages), or a procedural placeholder in the dev
 * harness. Model availability is gated by lib/pet-3d-models.ts.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/pet-skin.css";
import { GameIcon } from "./icons/GameIcon";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, OrbitControls, OrthographicCamera, PerformanceMonitor, Sparkles } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import type { Pet } from "../types/pet";
import type { PetArenaFrame, PetBattleRecord } from "../types/pet-arena";
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
import { beatTimeline, beatChoreoMs, lerp, shakeAmpForBeat, lungeReach, tileToWorld, spreadPositions, arenaObstaclePlacements, cameraForCombatants, TILE_WORLD_W, TILE_WORLD_D, spriteBoundsFromAlpha, groundedSpriteLayout, DEFAULT_SPRITE_BOUNDS, classifyMoveChoreo, moveChoreoMods, moveFxKey, meleeTrailSpec, meleeLungeReach, type MoveChoreoKind, type MoveChoreoMods, type SpriteBounds, type ObstaclePlacement } from "../lib/pet-coliseum-scene";
import { runPetDuel, runPetPartyDuel, DUEL_TPS, ARENA_X, ARENA_Y, type DuelResult, type DuelState, type DuelActorSnap } from "../lib/pet-duel-sim";
import { runPetArenaMatch, ARENA_TPS, BASE_SCORE_RANGE, BOSS_RADIUS, BOSS_ATK_RADIUS, type ArenaResult, type ArenaSnapshot, type ArenaState, type ArenaRole, type ArenaSlot, type ShrineKind } from "../lib/pet-arena-sim";
import { POSED_PET_IDS, POSED_RUN_IDS, POSED_MOVE_IDS } from "../assets/coliseum/pet-poses-manifest";
import { petVisualId } from "../data/pet-evolutions";
import { usePetBattleFrameSfx } from "../lib/use-pet-battle-sfx";
import { SceneAmbience } from "./SceneAmbience";
import { isPetSfxMuted, setPetSfxMuted, playPetSfx } from "../lib/pet-sfx";
import { petBloomEnabled, petArenaV2Enabled } from "../lib/pet-coliseum-flag";
import { petCombatModel, type PetCombatModelProfile } from "../lib/pet-3d-models";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import { directPetDuelPresentation } from "../lib/pet-duel-stage-director";
import { boundedBurstStep, duelAttackDashBeats, duelHeroCutEligible, duelHeroCutEventIndexes, duelMoveOutcome, precedingNamedMove } from "../lib/pet-duel-presentation";
import { petVisualQuality, type PetVisualQuality, type PetVisualQualityConfig } from "../lib/pet-visual-quality";
import { PetRenderStatsProbe } from "./PetRenderStatsProbe";
import { petHeroMoveAt, petHeroMoveStyle, petHeroMoveWindows, type PetHeroMoveStyle } from "../lib/pet-hero-moves";

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
    const quality = petVisualQuality();
    if (quality.id === "low" || (!petBloomEnabled() && quality.id !== "high")) return null;
    return (
        <EffectComposer>
            <Bloom luminanceThreshold={0.72} luminanceSmoothing={0.18} intensity={quality.id === "high" ? 0.48 : 0.32} mipmapBlur />
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
// High three-quarter "tactical broadcast" view. A literal overhead camera makes
// the pets read like board-game pieces; this angle still shows their faces and
// silhouettes while making the depth lanes, flanks, and breakaways obvious.
const CAM_POS: Vec3 = [0, 8.6, 14.6];
const CAM_LOOK: Vec3 = [0, 0.5, -1.9];
const CAM_FOV = 38;

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
    Fire: { base: "#ef4d24", glow: "#ffb066" },
    Water: { base: "#148fc4", glow: "#bae6fd" },
    Wind: { base: "#26b88f", glow: "#ccfbf1" },
    Lightning: { base: "#facc15", glow: "#fef08a" },
    Earth: { base: "#b9854d", glow: "#f0d9b5" },
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
type PoseCat = "idle" | "attack" | "hurt" | "cast" | "run-a" | "run-b" | "windup" | "lunge" | "impact" | "recover";
const POSE_CATS: PoseCat[] = ["idle", "attack", "hurt", "cast"];
const RUN_CATS: PoseCat[] = ["run-a", "run-b"]; // 2-frame run cycle (kills gliding)
const MOVE_CATS: PoseCat[] = ["windup", "lunge", "impact", "recover"]; // generated attack sequence
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
/** The move-sequence id (windup/lunge/impact/recover) for a pet, gated by the move
 *  manifest, or null → renderer falls back to the single "attack" pose. */
function posedMoveId(petId: string): string | null {
    if (POSED_MOVE_IDS.has(petId)) return petId;
    const base = petStripVariant(petId);
    return POSED_MOVE_IDS.has(base) ? base : null;
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
type PoseSet = { tex: Record<PoseCat, THREE.Texture>; scan: Record<PoseCat, SpriteScan>; hasRun: boolean; hasMove: boolean };
/** Load a pet's pose textures + alpha bounds (mirror-aware) from the static pose
 *  store: the 4 combat poses always, plus the 2-frame run cycle when one was
 *  generated (else run-a/run-b alias idle, so every cat is always defined).
 *  null when the pet has no generated set (→ single-sprite fallback). Hooks run
 *  unconditionally (rules-of-hooks). */
function usePetPoses(petId: string, mirror: boolean): PoseSet | null {
    const id = posedId(petId);
    const runId = posedRunId(petId);
    const moveId = posedMoveId(petId);
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
        for (const c of MOVE_CATS) out[c] = moveId ? mk(moveId, c) : out.attack;
        return out;
    }, [id, runId, moveId, mirror]);
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
        for (const c of MOVE_CATS) jobs.push(loadSpriteBounds(poseUrl(moveId ?? id, moveId ? c : "attack")).then((s) => [c, s] as const));
        Promise.all(jobs).then((entries) => { if (live) setScan(Object.fromEntries(entries) as Record<PoseCat, SpriteScan>); });
        return () => { live = false; };
    }, [id, runId, moveId]);
    if (!id || !tex) return null;
    const sc = scan ?? (Object.fromEntries([...POSE_CATS, ...RUN_CATS, ...MOVE_CATS].map((c) => [c, { bounds: DEFAULT_SPRITE_BOUNDS, aspect: 1 }])) as Record<PoseCat, SpriteScan>);
    return { tex, scan: sc, hasRun: !!runId, hasMove: !!moveId };
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

// A WHITE soft radial — usable with additive blending + a material color to paint a
// glowing aura/shockwave (the black shadowTexture contributes nothing under additive).
let _glowTexture: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
    if (_glowTexture) return _glowTexture;
    const S = 128;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    const rad = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
    rad.addColorStop(0, "rgba(255,255,255,1)");
    rad.addColorStop(0.45, "rgba(255,255,255,0.55)");
    rad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rad;
    g.fillRect(0, 0, S, S);
    _glowTexture = new THREE.CanvasTexture(c);
    _glowTexture.colorSpace = THREE.SRGBColorSpace;
    return _glowTexture;
}

// Painted golden aura used by the 3D buff column. A soft alpha silhouette reads
// like hand-authored anime energy; the previous open cone geometry exposed its
// polygon edges and looked like a prototype spotlight.
let _powerAuraTexture: THREE.CanvasTexture | null = null;
function _makePowerAuraTexture(): THREE.CanvasTexture {
    if (_powerAuraTexture) return _powerAuraTexture;
    const W = 512, H = 768;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    const flamePath = (inset: number) => {
        const cx = W / 2, base = H - 24;
        const sx = inset > 0 ? 0.66 : 1;
        const sy = inset > 0 ? 0.86 : 1;
        // Alternating shoulders and needle tips give the aura a deliberate
        // cel-animation silhouette instead of a soft oval or VFX cone.
        const points: readonly (readonly [number, number])[] = [
            [256, 744], [88, 726], [126, 656], [72, 596], [146, 542],
            [96, 466], [172, 412], [126, 334], [202, 286], [166, 196],
            [230, 230], [256, 24], [282, 230], [346, 196], [310, 286],
            [386, 334], [340, 412], [416, 466], [366, 542], [440, 596],
            [386, 656], [424, 726], [256, 744],
        ];
        g.beginPath();
        points.forEach(([x, y], index) => {
            const px = cx + (x - cx) * sx;
            const py = base - (base - y) * sy;
            if (index === 0) g.moveTo(px, py); else g.lineTo(px, py);
        });
        g.closePath();
    };
    g.save();
    g.shadowColor = "rgba(255,205,40,0.7)"; g.shadowBlur = 42;
    const outer = g.createLinearGradient(0, H, 0, 30);
    outer.addColorStop(0, "rgba(255,252,202,0.88)");
    outer.addColorStop(0.35, "rgba(255,207,42,0.78)");
    outer.addColorStop(0.72, "rgba(255,137,14,0.54)");
    outer.addColorStop(1, "rgba(255,192,32,0.12)");
    flamePath(0); g.fillStyle = outer; g.fill();
    g.strokeStyle = "rgba(255,239,126,0.72)"; g.lineWidth = 4; g.lineJoin = "round"; g.stroke();
    g.shadowBlur = 20;
    const inner = g.createLinearGradient(0, H, 0, 180);
    inner.addColorStop(0, "rgba(255,255,245,0.94)");
    inner.addColorStop(0.5, "rgba(255,239,130,0.55)");
    inner.addColorStop(1, "rgba(255,205,40,0)");
    flamePath(58); g.fillStyle = inner; g.fill();
    g.restore();
    _powerAuraTexture = new THREE.CanvasTexture(c);
    _powerAuraTexture.colorSpace = THREE.SRGBColorSpace;
    _powerAuraTexture.minFilter = THREE.LinearFilter;
    _powerAuraTexture.magFilter = THREE.LinearFilter;
    return _powerAuraTexture;
}


// Base visible-content height in world units — every creature is grounded to
// this VISIBLE height (consistent silhouettes; padding no longer varies size).
// Trimmed from 2.6 so pets sit IN the full-screen arena instead of looming over it.
const TARGET_SPRITE_H = 2.3;
// 3D coliseum: hold OPPOSING combatants this far apart (screen-x, world units) so a
// melee strike reads as a DASH across the gap, not a point-blank poke. The gap-aware
// lunge (lungeReach) auto-scales to cross it. Render-only / tunable.
const COLISEUM_ENGAGE_GAP = 3.2;

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
        const tex = textures[idx] ?? null;
        if (mat.current) mat.current.map = tex;
        // Hide until the frame's texture has actually DECODED — `tex.image` is set
        // the instant load starts (before pixels exist), so a too-eager check flashes
        // an opaque quad; gate on the image being complete with real dimensions.
        const img = tex?.image as HTMLImageElement | undefined;
        if (group.current) group.current.visible = !!(img && img.complete && (img.naturalWidth || 0) > 0);
        if (group.current && to) {
            group.current.position.x = lerp(from[0], to[0], p);
            group.current.position.y = lerp(from[1], to[1], p);
            group.current.position.z = lerp(from[2], to[2], p);
        }
        if (elapsed >= durationMs) onDone();
    });

    return (
        <group ref={group} position={from} visible={false}>
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

/** Adapt the camera to the canvas aspect: portrait/narrow screens widen the
 *  FOV so both sides of the arena stay in frame on mobile. Applied per-frame
 *  (no-op unless it changed) — the idiomatic r3f mutation point. */
// Transient FOV punch-IN on crit/KO, set by DuelDirector and applied + decayed by
// ResponsiveCamera (the single owner of camera.fov, so nothing fights it). A lens
// snap layered on top of the existing dolly zoom. Safe as a module singleton:
// only one duel mounts at a time, and it decays to 0 every frame, so a stale
// value from a prior fight is gone within a few frames.
const duelFovKick = { current: 0 };
function ResponsiveCamera() {
    const { camera, size } = useThree();
    useFrame(() => {
        const aspect = size.width / Math.max(1, size.height);
        const baseFov = aspect < 0.8 ? 60 : aspect < 1.2 ? 47 : CAM_FOV;
        const fov = baseFov - duelFovKick.current;   // narrower FOV = zoom-in punch (decayed by DuelDirector)
        const cam = camera as THREE.PerspectiveCamera;
        if (Math.abs(cam.fov - fov) > 0.001) {
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
        <div style={{ position: "fixed", inset: 0, zIndex: 200, width: "100vw", height: "100vh", overflow: "hidden", background: "linear-gradient(#3a2a16, #1a1206 60%, #0a0703)" }}>
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
                {orbit && <OrbitControls target={CAM_LOOK} />}
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
type DuelClock = { t: number; playing: boolean; intro?: number };
const findActor = (snap: { actors: DuelActorSnap[] }, id: string) => snap.actors.find((a) => a.id === id);
// ── Tactical STAGE: a fixed painted diorama backdrop (Final-Fantasy-style
// pre-rendered background) with the fighters composited on top. The diorama is a
// CSS `cover` background; the sprites live in a TRANSPARENT, orthographic r3f
// layer whose cover-fit projection stays pixel-locked to that background at every
// viewport — because both cover the SAME logical rect and worldW:worldH ==
// imgW:imgH, a sim field point lands on the same screen pixel as the painting it
// represents. (No 3D floor: the painting already has all the depth.)
const DIORAMA_URL = new URL("../assets/coliseum/tactics-diorama.webp", import.meta.url).href;
// The rotating buff shrines — transparent cutouts (gpt-image-1), one per flavour.
const SHRINE_URLS: Record<"power" | "mend", string> = {
    power: new URL("../assets/coliseum/shrine-power.webp", import.meta.url).href,
    mend: new URL("../assets/coliseum/shrine-mend.webp", import.meta.url).href,
};
const _shrineTex: Partial<Record<"power" | "mend", THREE.Texture>> = {};
function shrineTexture(kind: ShrineKind): THREE.Texture {
    // v2 relics reuse the two base shrine sprites (offensive→power art, sustain→mend art);
    // their identity is carried by colour + label + claim FX, so no new asset is needed.
    const key: "power" | "mend" = kind === "mend" || kind === "favor" ? "mend" : "power";
    let t = _shrineTex[key];
    if (!t) { t = new THREE.TextureLoader().load(SHRINE_URLS[key]); t.colorSpace = THREE.SRGBColorSpace; _shrineTex[key] = t; }
    return t;
}
// The Warden's animation frames (fal Nano-Banana img2img off the base sprite) — a
// flipbook the renderer swaps by state (idle / walk / wind-up / slam), the "pet treatment".
type WardenFrame = "idle" | "walk" | "windup" | "slam";
const WARDEN_FRAME_URLS: Record<WardenFrame, string> = {
    idle: new URL("../assets/coliseum/warden-idle.webp", import.meta.url).href,
    walk: new URL("../assets/coliseum/warden-walk.webp", import.meta.url).href,
    windup: new URL("../assets/coliseum/warden-windup.webp", import.meta.url).href,
    slam: new URL("../assets/coliseum/warden-slam.webp", import.meta.url).href,
};
const _wardenTex: Partial<Record<WardenFrame, THREE.Texture>> = {};
function wardenFrame(f: WardenFrame): THREE.Texture {
    let t = _wardenTex[f];
    if (!t) { t = new THREE.TextureLoader().load(WARDEN_FRAME_URLS[f]); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; _wardenTex[f] = t; }
    return t;
}
// The diorama is a fixed 1536×1024 MAP-SPACE reference (the SpriteFlow arena).
// All pet positions are computed in map-space, then projected to the world layer
// — which cover-fits the SAME image as the CSS backdrop, so map-space (mx,my)
// lands on the exact painted pixel at any viewport. worldW:worldH == image aspect.
const MAP_W = 1536, MAP_H = 1024;
const STAGE = { worldW: 30, worldH: 20 };
// The forward strike-pulse duration (s): the sim's `strike` state is a single
// ~33ms tick, so the render thrust is self-timed off the windup→exit edge instead.
const STRIKE_PULSE_S = 0.26;
// Perspective scale for the TACTICAL ARENA's top-down diorama (front bigger, back
// smaller). The duel no longer uses this — it stands its fighters on a real 3D floor.
function getPerspectiveScale(my: number, mapH: number = MAP_H): number {
    const t = Math.min(1, Math.max(0, my / mapH));
    return 0.65 + (1.15 - 0.65) * t;
}
type StagePos = { wx: number; wy: number; depth: number; zo: number };

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
function StageCamera({ fit = "cover", worldW = STAGE.worldW, worldH = STAGE.worldH }: { fit?: "cover" | "contain"; worldW?: number; worldH?: number }) {
    const size = useThree((s) => s.size);
    const zoom = fit === "contain"
        ? Math.min(size.width / worldW, size.height / worldH)
        : Math.max(size.width / worldW, size.height / worldH);
    return <OrthographicCamera makeDefault position={[0, 0, 100]} zoom={zoom} near={0.1} far={1000} />;
}

// ── Grounded 3D-coliseum duel placement ──────────────────────────────────────
// The duel now plays INSIDE the round renderer's 3D Arena (curved wall + lit
// floor + perspective camera), so fighters STAND on the floor with real contact
// shadows instead of floating over a painted wall. Map the sim field (±ARENA_X,
// ±ARENA_Y) onto the floor plane (x = left↔right, z = depth toward/away camera);
// perspective + grounding then come from the scene, not a faked projection.
const DUEL_FLOOR_HALF_W = 7.2;   // use more of the physical coliseum for crossfield runs
const DUEL_FLOOR_HALF_D = 4.25;  // deeper lanes make cover wraps and re-entry angles readable
const DUEL_FLOOR_Z0 = -0.4;      // centre the action near the camera's look point
const DUEL_MIN_WORLD_X = 3.7;    // min world-x gap so two big fighters never merge / cross
const DUEL_SEP_BAND_Z = 1.7;     // only separate a pair within this depth band
const DUEL_CONTACT_GAP = 1.7;    // world-x left between sprites at the peak of a melee lunge (close but not overlapping)
const DUEL_3D_BODY_GAP = 5.45;   // neutral guard range: enough runway for a readable approach, evade, or cast
const DUEL_3D_CONTACT_GAP = 2.55; // committed hits enter a tight pocket; the elemental contact reaches the defender
const DUEL_3D_READABLE_X_GAP = 2.65; // stop depth-aligned pets collapsing into one camera silhouette
// ── Opening choreography (render-only) — a still ranged face-off and restrained
// power gather. Movement begins only when the combat simulation starts.
const INTRO_SPLASH_END = 1.05;   // s — establish the matchup without delaying the first exchange
const INTRO_PAUSE_END = 1.18;    // s — one clean still face-off before the gather
const INTRO_SIZEUP_END = 2.15;   // s — readable power gather at the real starting positions
const INTRO_TOTAL = 2.35;        // s — brief lock-in beat, then FIGHT
const INTRO_WIDE_DOLLY = 15.6;   // camera pull-back distance for the wide size-up shot
const DUEL_CAMERA_Y = 5.75;
const DUEL_LOOK_Y = 0.9;
const introWideHold = (introSec: number): number => introSec < INTRO_TOTAL ? 1 : 0;
function duelFieldToFloor(fx: number, fy: number): { wx: number; wz: number } {
    return { wx: (fx / ARENA_X) * DUEL_FLOOR_HALF_W, wz: DUEL_FLOOR_Z0 + (fy / ARENA_Y) * DUEL_FLOOR_HALF_D };
}

/** One GROUNDED fighter on the 3D coliseum floor — a Y-locked billboard standing
 *  on the floor with a real contact shadow, driven by the interpolated duel tick
 *  stream + the anime strike choreography (ability-distinct strikes, recoil,
 *  status tints, KO topple). Same grounded rig as the round renderer's Standee. */
function DuelStandee({ duel, clock, id, pet, mirror, sharedImages, freeRoam3d, dashCue }: {
    duel: DuelResult; clock: { current: DuelClock }; id: string; pet: Pet; mirror: boolean; sharedImages: Record<string, string>; freeRoam3d: boolean; dashCue?: DuelDashCue;
}) {
    const sprite = usePetSprite(pet, sharedImages, mirror);   // mirror flips the art so the enemy faces the player
    const poses = usePetPoses(petVisualId(pet), mirror);
    const combatModel = useMemo(() => petCombatModel(pet), [pet]);
    const heroMoveWindows = useMemo(() => petHeroMoveWindows(duel.events, id, { ...pet, profile: combatModel?.profile }), [combatModel?.profile, duel.events, id, pet]);
    const modelFrame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const group = useRef<THREE.Group>(null);     // floor position + lunge offset
    const poseG = useRef<THREE.Group>(null);      // squash/stretch + topple, pivots at the feet
    // Deform "rig": a meshBasicMaterial whose vertex shader is patched
    // (onBeforeCompile) to BEND the sprite up its body — the creature leans into a
    // lunge, arches on the hop, and its body/tail follow through with a travelling
    // sine — so it ANIMATES instead of sliding as a flat image. Cheap; scales to all
    // pets; texture/tint/flash stay on the standard material so colour is correct.
    const deformU = useRef<Record<string, { value: number }> | null>(null);
    const baseMat = useMemo(() => {
        const m = new THREE.MeshBasicMaterial({ map: sprite.texture, transparent: true, alphaTest: 0.4, depthWrite: false, toneMapped: false });
        m.onBeforeCompile = (shader) => {
            shader.uniforms.uLean = { value: 0 };
            shader.uniforms.uArch = { value: 0 };
            shader.uniforms.uWave = { value: 0 };
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uHalfH = { value: 1 };
            deformU.current = shader.uniforms as unknown as Record<string, { value: number }>;
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", "uniform float uLean,uArch,uWave,uTime,uHalfH;\n#include <common>")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat _h=clamp(transformed.y/(uHalfH*2.0)+0.5,0.0,1.0);\ntransformed.x += uLean*_h*_h + uArch*sin(_h*3.14159) + sin(_h*5.0 - uTime*6.0)*uWave*_h;");
        };
        return m;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => () => baseMat.dispose(), [baseMat]);
    const matRef = useRef<THREE.MeshBasicMaterial>(null);   // primitive ref → mutated in useFrame (r3f escape hatch)
    const shadow = useRef<THREE.Mesh>(null);
    const shadowMat = useRef<THREE.MeshBasicMaterial>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const hpChip = useRef<HTMLDivElement>(null);   // lagging "damage-taken" chip behind the fill
    const nameWrap = useRef<HTMLDivElement>(null);
    const [poseCat, setPoseCat] = useState<PoseCat>("idle");
    const prevHp = useRef(Infinity);
    const flash = useRef(0);
    const visualPos = useRef<[number, number] | null>(null);
    const lastPos = useRef<[number, number] | null>(null);
    const smoothedSpeed = useRef(0);
    const locomotionActive = useRef(false);
    const dashRecoveryUntil = useRef(0);
    const dashRouteId = useRef<number | null>(null);
    const dashEntryOffset = useRef<[number, number]>([0, 0]);
    const travelFacing = useRef<[number, number]>([mirror ? -1 : 1, 0]);
    const combatFacing = useRef<[number, number]>([mirror ? -1 : 1, 0]);
    const runClock = useRef(0);
    const terminalTimeline = useRef<{ wall: number; base: number } | null>(null);
    // Anime strike choreography (render-only): eased offsets + phase clocks. The LONG sim
    // states (windup/stagger/dodge) drive beatTimeline directly; the 1-tick `strike` drives
    // a self-timed forward pulse off the windup-exit edge.
    const choX = useRef(0), choY = useRef(0), choZ = useRef(0), choSX = useRef(1), choSY = useRef(1), choRot = useRef(0);
    const choKind = useRef<PetVisualState>("idle");
    const choStart = useRef(0);
    const prevSimState = useRef<DuelState>("idle");
    const strikeStart = useRef(-999);
    const buffPoseStart = useRef(-999);
    const buffWasActive = useRef(false);
    // Per-strike choreography params, set on the windup→strike edge from the
    // resolution that's about to land (melee lunge vs ranged kick, how hard).
    const strikeKind = useRef<"melee" | "ranged">("melee");
    const strikePow = useRef(0.4);
    const strikeCrit = useRef(false);
    const strikeHeavy = useRef(false);   // rhythm read: this strike is a heavy/charged blow (vs a quick jab)
    const strikeMods = useRef<MoveChoreoMods>(moveChoreoMods("lightMelee"));   // per-move motion tuning (slam/drain/beam/support/…)
    const pulseS = useRef(STRIKE_PULSE_S);
    const recoilPow = useRef(0.55);   // set on stagger-entry from the incoming hit's weight
    const bobPhase = useMemo(() => (id.charCodeAt(id.length - 1) % 7) * 0.9, [id]);
    // Damage-aware choreography lookup (render-only): this pet's OUTGOING
    // resolutions (a melee `hit` with how hard it landed, vs a ranged `cast`) and
    // the INCOMING hits that stagger it. Lets a light poke read as a quick jab and
    // a heavy blow as a deep, committed lunge with real knockback — all derived
    // from the deterministic event stream, never fed back into it.
    const { outResolves, inHits } = useMemo(() => {
        const outR: { t: number; kind: "melee" | "ranged"; power: number; crit: boolean; choreo: MoveChoreoKind }[] = [];
        const inH: { t: number; power: number; crit: boolean }[] = [];
        const snaps = duel.snapshots; const last = snaps.length - 1;
        for (const e of duel.events) {
            if (e.type === "hit" && e.dmg && e.actorId === id && e.targetId && !e.ranged) {
                const tgt = findActor(snaps[Math.min(last, e.t)], e.targetId);
                // The move's KIND + ELEMENT decide the melee staging: a crush/push slams,
                // a lifesteal drains back, a Wind hit double-slashes, a Lightning hit
                // thrusts. Projectile hits (e.ranged) are EXCLUDED — a ranged attacker
                // plants + kicks off its `cast`, it must never lunge on a stray land tick.
                // Render-only classification.
                outR.push({ t: e.t, kind: "melee", power: tgt ? Math.min(1, e.dmg / Math.max(1, tgt.maxHp)) : 0.4, crit: !!e.crit, choreo: classifyMoveChoreo(e.kind, false, e.element ?? pet.element) });
            } else if (e.type === "cast" && e.actorId === id) {
                // A cast → ranged offensive, control beam, or a support gather, by kind.
                outR.push({ t: e.t, kind: "ranged", power: 0, crit: false, choreo: classifyMoveChoreo(e.kind, true) });
            }
            if (e.type === "hit" && e.dmg && e.targetId === id) {
                const me = findActor(snaps[Math.min(last, e.t)], id);
                inH.push({ t: e.t, power: me ? Math.min(1, e.dmg / Math.max(1, me.maxHp)) : 0.4, crit: !!e.crit });
            }
        }
        outR.sort((a, b) => a.t - b.t); inH.sort((a, b) => a.t - b.t);
        return { outResolves: outR, inHits: inH };
    }, [duel, id, pet.element]);

    const useTex = poses ? poses.tex[poseCat] : sprite.texture;
    const useBounds = poses ? poses.scan[poseCat].bounds : sprite.bounds;
    const useAspect = poses ? poses.scan[poseCat].aspect : sprite.aspect;
    const L = useMemo(() => groundedSpriteLayout(useBounds, useAspect, TARGET_SPRITE_H, mirror), [useBounds, useAspect, mirror]);
    const shadowW = Math.max(0.9, L.contentWorldW * 0.95);
    const side = mirror ? "enemy" : "player";

    useFrame((state, delta) => {
        const g = group.current, pg = poseG.current, m = matRef.current;
        if (!g || !pg || (!m && !combatModel)) return;
        const snaps = duel.snapshots;
        const tf = Math.max(0, Math.min(snaps.length - 1, clock.current.t));
        const i0 = Math.floor(tf), i1 = Math.min(snaps.length - 1, i0 + 1), f = tf - i0;
        const a0 = findActor(snaps[i0], id);
        if (!a0) return;
        const a1 = findActor(snaps[i1], id) ?? a0;
        // A >3-field-unit jump is normally a reserve swap. Dash/dodge states are
        // explicitly locomotion, though: hard-cutting those states was the reason
        // an authored dash still looked like a teleport even with a speed trail.
        const tdx = a1.x - a0.x, tdy = a1.y - a0.y;
        const burstTravel = a0.state === "dash" || a1.state === "dash" || a0.state === "dodge" || a1.state === "dodge";
        // Active 3D fighters must never hard-cut across the floor. Even a large
        // director correction is blended as very fast locomotion; only the legacy
        // standee/reserve presentation retains a true discontinuity cut.
        const teleport = !freeRoam3d && !burstTravel && (tdx * tdx + tdy * tdy) > 9;
        const ff = teleport ? (f < 0.5 ? 0 : 1) : f;
        const fp = duelFieldToFloor(lerp(a0.x, a1.x, ff), lerp(a0.y, a1.y, ff));
        let wx = fp.wx, wz = fp.wz;

        // World-space spacing: statically mirrored standees stay left/right so their
        // art cannot turn backward. All-model fights retain the sim's free-roaming
        // floor path and true facing. Presentation only — never fed back to the sim.
        const myEnemy = id.startsWith("enemy");
        const actors = snaps[i0].actors;
        let foeWX: number | null = null;   // nearest opposing fighter's world-x → legacy standee lunge target
        let foeDistance: number | null = null; // true floor distance → 3D free-roam lunge target
        let faceTargetWX: number | null = null;
        let faceTargetWZ: number | null = null;
        for (let k = 0; k < actors.length; k++) {
            const other = actors[k];
            if (other.id === id || other.state === "dead") continue;
            const oa0 = findActor(snaps[i0], other.id); if (!oa0) continue;
            const oa1 = findActor(snaps[i1], other.id) ?? oa0;
            const of = duelFieldToFloor(lerp(oa0.x, oa1.x, ff), lerp(oa0.y, oa1.y, ff));
            if (other.id.startsWith("enemy") === myEnemy) {
                // Same team (2v2 reserve) — a modest symmetric gap, same-depth only.
                if (!freeRoam3d) {
                    if (Math.abs(wz - of.wz) > DUEL_SEP_BAND_Z) continue;
                    const gapX = wx - of.wx, need = DUEL_MIN_WORLD_X * 0.7;
                    if (Math.abs(gapX) < need) { const dir = gapX >= 0 ? 1 : -1; wx += dir * (need - Math.abs(gapX)) * 0.5; }
                } else {
                    const gx = wx - of.wx, gz = wz - of.wz, gap = Math.hypot(gx, gz), need = DUEL_3D_BODY_GAP * 0.78;
                    if (gap < need) {
                        const ux = gap > 1e-4 ? gx / gap : (myEnemy ? 1 : -1), uz = gap > 1e-4 ? gz / gap : 0;
                        wx += ux * (need - gap) * 0.5; wz += uz * (need - gap) * 0.5;
                    }
                }
            } else {
                // OPPOSING — enforce ordering (player left of enemy) + the full gap,
                // centred on the pair midpoint so neither can pass through the other.
                if (!freeRoam3d) {
                    const mid = (wx + of.wx) / 2;
                    wx = myEnemy ? Math.max(wx, mid + DUEL_MIN_WORLD_X / 2) : Math.min(wx, mid - DUEL_MIN_WORLD_X / 2);
                }
                if (foeWX === null || Math.abs(of.wx - wx) < Math.abs(foeWX - wx)) foeWX = of.wx;
                // Preserve a modest lateral lane as well as radial spacing. Pets can
                // be far apart in depth yet still collapse into one camera silhouette.
                const xGap = wx - of.wx;
                if (freeRoam3d && Math.abs(xGap) < DUEL_3D_READABLE_X_GAP) {
                    const laneDir = Math.abs(xGap) > 0.15 ? Math.sign(xGap) : (myEnemy ? 1 : -1);
                    wx += laneDir * (DUEL_3D_READABLE_X_GAP - Math.abs(xGap)) * 0.5;
                }
                let distance = Math.hypot(of.wx - wx, of.wz - wz);
                if (freeRoam3d && distance < DUEL_3D_BODY_GAP) {
                    // Resolve presentation-space body overlap along the actual 3D line
                    // between the pets. Both standees apply half the correction, so they
                    // remain centred on the simulation contact while their meshes stay apart.
                    const gx = wx - of.wx, gz = wz - of.wz;
                    const ux = distance > 1e-4 ? gx / distance : (myEnemy ? 1 : -1);
                    const uz = distance > 1e-4 ? gz / distance : 0;
                    wx += ux * (DUEL_3D_BODY_GAP - distance) * 0.5;
                    wz += uz * (DUEL_3D_BODY_GAP - distance) * 0.5;
                    distance = DUEL_3D_BODY_GAP;
                }
                if (foeDistance === null || distance < foeDistance) {
                    foeDistance = distance;
                    faceTargetWX = of.wx;
                    faceTargetWZ = of.wz;
                }
            }
        }

        // A dash is one authored phrase shared by the creature and its VFX. The
        // previous renderer advanced the model from snapshots while a separate
        // comet advanced on wall time, which let the streak travel while the pet
        // appeared to pop directly to its destination. During an active cue this
        // world-space route owns the model position as well.
        let dashActive = false;
        let dashTravelFacing: [number, number] | null = null;
        if (dashCue) {
            const travelP = dashCueTravelProgress(dashCue, clock.current.t);
            if (clock.current.t >= dashCue.startTick && clock.current.t <= dashCue.contactTick) {
                dashActive = true;
                dashRecoveryUntil.current = performance.now() + 720;
                const routePoint = dashPathPoint(dashCue, travelP);
                if (dashRouteId.current !== dashCue.id) {
                    const routeStart = dashPathPoint(dashCue, 0);
                    const visibleStart = visualPos.current ?? [wx, wz];
                    dashRouteId.current = dashCue.id;
                    dashEntryOffset.current = [visibleStart[0] - routeStart[0], visibleStart[1] - routeStart[2]];
                }
                // Join the authored route from the creature's CURRENT rendered
                // position, then bleed the seam out before contact. This prevents
                // the first dash frame from popping back to an old snapshot.
                const seam = Math.pow(1 - travelP, 2);
                wx = routePoint[0] + dashEntryOffset.current[0] * seam;
                wz = routePoint[2] + dashEntryOffset.current[1] * seam;
                // The creature and its elemental trail share the route tangent.
                // Deriving heading from the lagged visual snapshot made zig-zag
                // dashes briefly point backward at each bend (and could leave a
                // Kitsune facing away on contact).
                const routeAhead = dashPathPoint(dashCue, Math.min(1, travelP + 0.025));
                const dashDx = routeAhead[0] - routePoint[0];
                const dashDz = routeAhead[2] - routePoint[2];
                const dashLength = Math.hypot(dashDx, dashDz);
                if (dashLength > 1e-4) dashTravelFacing = [dashDx / dashLength, dashDz / dashLength];
            }
        }

        // Dash routing runs after the neutral spacing pass, so it needs its own
        // contact guard. Without this final projection the authored S-curve could
        // finish at the opponent's simulation origin and visually merge both
        // meshes even though ordinary locomotion respected the body gap. Keep the
        // route tangent and all of its visible travel; only compress the last few
        // feet into a readable VFX-bridged contact pocket.
        if (freeRoam3d && dashActive && faceTargetWX !== null && faceTargetWZ !== null) {
            const gapX = wx - faceTargetWX;
            const gapZ = wz - faceTargetWZ;
            const contactDistance = Math.hypot(gapX, gapZ);
            if (contactDistance < DUEL_3D_CONTACT_GAP) {
                const fallbackX = myEnemy ? 1 : -1;
                const ux = contactDistance > 1e-4 ? gapX / contactDistance : fallbackX;
                const uz = contactDistance > 1e-4 ? gapZ / contactDistance : 0;
                wx = faceTargetWX + ux * DUEL_3D_CONTACT_GAP;
                wz = faceTargetWZ + uz * DUEL_3D_CONTACT_GAP;
            }
        }

        // Opening choreography stays at the simulation's real starting positions.
        // The old render-only charge made both pets sprint together before either
        // fighter had made a tactical decision.
        const introSec = clock.current.intro ?? 999;

        // The sim publishes at 30 Hz while the renderer normally runs at 60–144 Hz.
        // Interpolate the presentation target again with a frame-rate-independent
        // response so a slow capture/GPU frame cannot expose snapshot stair-steps.
        // Dashes stay snappy; neutral travel is slightly softer. Teleports still cut.
        const dashRecovering = !dashActive && performance.now() < dashRecoveryUntil.current;
        if (!visualPos.current || (teleport && !dashRecovering)) visualPos.current = [wx, wz];
        else if (dashActive) {
            // Keep an anime-fast burst, but never let a slow render frame collapse
            // several feet of its route into one visible update.
            visualPos.current = boundedBurstStep(visualPos.current, [wx, wz], delta);
        } else {
            // Let the eye track a burst over several render frames. A response of
            // 20 caught up in roughly one frame after a large snapshot jump.
            const response = dashRecovering ? 8.5 : a0.state === "dash" ? 10.5 : a0.state === "dodge" ? 12 : a0.state === "idle" ? 14 : 17;
            const alpha = 1 - Math.exp(-response * Math.min(delta, 1 / 15));
            visualPos.current[0] = lerp(visualPos.current[0], wx, alpha);
            visualPos.current[1] = lerp(visualPos.current[1], wz, alpha);
        }
        wx = visualPos.current[0];
        wz = visualPos.current[1];

        // Speed (world units per render frame) → drives the run cycle + bob.
        const dwx = lastPos.current ? wx - lastPos.current[0] : 0;
        const dwz = lastPos.current ? wz - lastPos.current[1] : 0;
        const rawSpeed = Math.hypot(dwx, dwz) / Math.max(1 / 240, delta);
        const travelStep = Math.hypot(dwx, dwz);
        if (dashTravelFacing) {
            travelFacing.current[0] = dashTravelFacing[0];
            travelFacing.current[1] = dashTravelFacing[1];
        } else if (!teleport && travelStep > 0.003) {
            // Preserve locomotion direction independently from target-facing.
            // Quadrupeds consume this so a lateral kite becomes a real turn-and-run
            // instead of a forward walk animation sliding sideways across the floor.
            // Filter the direction itself: tiny curved-path corrections otherwise
            // flip the yaw target every frame and make a running model shake.
            const directionAlpha = 1 - Math.exp(-5 * Math.min(delta, 1 / 15));
            const targetX = dwx / travelStep;
            const targetZ = dwz / travelStep;
            const filteredX = lerp(travelFacing.current[0], targetX, directionAlpha);
            const filteredZ = lerp(travelFacing.current[1], targetZ, directionAlpha);
            const filteredLength = Math.hypot(filteredX, filteredZ) || 1;
            travelFacing.current[0] = filteredX / filteredLength;
            travelFacing.current[1] = filteredZ / filteredLength;
        }
        const speedAlpha = 1 - Math.exp(-11 * Math.min(delta, 1 / 15));
        smoothedSpeed.current = teleport ? 0 : lerp(smoothedSpeed.current, rawSpeed, speedAlpha);
        lastPos.current = [wx, wz];
        // The duel snapshots arrive at 30 Hz while render frames arrive much faster.
        // Per-frame displacement therefore pulses between a larger snapshot step and
        // tiny interpolation tails. Hysteresis keeps the locomotion clip engaged
        // through those tails instead of restarting idle/run several times per tick.
        if (a0.state === "dead") locomotionActive.current = false;
        else if (smoothedSpeed.current > 0.22) locomotionActive.current = true;
        else if (smoothedSpeed.current < 0.075) locomotionActive.current = false;
        const moving = locomotionActive.current;
        // Face/lunge toward the foe: player (left) → +x, enemy (right) → −x. With the
        // non-crossing clamp above, this always matches the statically-mirrored art.
        const mappedFaceX = a0.faceX * (DUEL_FLOOR_HALF_W / ARENA_X);
        const mappedFaceZ = a0.faceY * (DUEL_FLOOR_HALF_D / ARENA_Y);
        let desiredFaceX = mappedFaceX;
        let desiredFaceZ = mappedFaceZ;
        // Navigation briefly points the sim-facing vector along a maneuver. For
        // presentation, keep the creature's eyes and attack axis on its nearest
        // live opponent while it circles, side-steps, or backs away.
        if (freeRoam3d && faceTargetWX !== null && faceTargetWZ !== null) {
            desiredFaceX = faceTargetWX - wx;
            desiredFaceZ = faceTargetWZ - wz;
        }
        const desiredFaceLength = Math.hypot(desiredFaceX, desiredFaceZ) || 1;
        const targetFaceX = freeRoam3d ? desiredFaceX / desiredFaceLength : (myEnemy ? -1 : 1);
        const targetFaceZ = freeRoam3d ? desiredFaceZ / desiredFaceLength : 0;
        const faceResponse = a0.state === "windup" || a0.state === "strike" || a0.state === "recover" ? 18 : 10;
        const faceAlpha = 1 - Math.exp(-faceResponse * Math.min(delta, 1 / 15));
        const blendedFaceX = lerp(combatFacing.current[0], targetFaceX, faceAlpha);
        const blendedFaceZ = lerp(combatFacing.current[1], targetFaceZ, faceAlpha);
        const blendedFaceLength = Math.hypot(blendedFaceX, blendedFaceZ) || 1;
        combatFacing.current[0] = blendedFaceX / blendedFaceLength;
        combatFacing.current[1] = blendedFaceZ / blendedFaceLength;
        const faceWX = combatFacing.current[0];
        const faceWZ = combatFacing.current[1];
        const facing = faceWX < 0 ? -1 : 1;

        // ── Anime strike choreography (render-only — never touches the sim) ──────
        // The LONG sim states drive beatTimeline (windup coils back, stagger recoils,
        // dodge slips); the 1-tick `strike` drives a self-timed forward pulse off the
        // windup→exit edge. On the real 3D floor the melee lunge ARCS (a small hop).
        let basePose: PetVisualState =
            a0.state === "windup" ? "windup" : a0.state === "stagger" ? "recoil" : a0.state === "dodge" ? "dodge" : "idle";
        // Opening: after a still face-off pause, both pets gather power without
        // closing distance. Actual locomotion begins when the simulation starts.
        const sizingUp = introSec >= INTRO_PAUSE_END && introSec < INTRO_SIZEUP_END;
        if (sizingUp) basePose = "charge";
        const curTick = Math.floor(clock.current.t);
        const activeHeroMove = petHeroMoveAt(heroMoveWindows, clock.current.t);
        // A SUPPORT cast (heal/shield/buff) winds up as a GATHER/RISE, not the melee
        // coil-back, so a healer reads as drawing power up — not flinching to strike.
        if (a0.state === "windup") {
            for (let k = 0; k < outResolves.length; k++) {
                const it = outResolves[k]; if (it.t > curTick + 8) break;
                if (it.t >= curTick - 1) { if (it.choreo === "support") basePose = "charge"; break; }
            }
        }
        // Status activation gets its own planted power-up beat after the tactical
        // disengage. The cast windup gathers the energy; this short pose is the
        // visible release/stance change when buff or haste actually comes online.
        const buffActive = a0.statuses.includes("buff") || a0.statuses.includes("haste");
        if (buffActive && !buffWasActive.current) buffPoseStart.current = state.clock.elapsedTime;
        buffWasActive.current = buffActive;
        const buffPoseElapsed = state.clock.elapsedTime - buffPoseStart.current;
        const buffPosing = buffPoseElapsed >= 0 && buffPoseElapsed < 0.82;
        if (basePose !== choKind.current) { choKind.current = basePose; choStart.current = state.clock.elapsedTime; }
        const baseProg = basePose === "idle" ? 1 : Math.min(1, (state.clock.elapsedTime - choStart.current) / (beatChoreoMs(basePose) / 1000));
        // Stagger ENTRY → scale this recoil's knockback by how hard the incoming blow landed.
        if (a0.state === "stagger" && prevSimState.current !== "stagger") {
            let rp = 0.55;
            for (let k = 0; k < inHits.length; k++) {
                const it = inHits[k];
                if (it.t > curTick + 4) break;
                if (it.t >= curTick - 1) {
                    // Damage fractions are usually small, so feeding them through
                    // directly produced a barely visible flinch. Remap them into a
                    // readable recoil range and give crits a decisive snap.
                    rp = Math.min(1.25, 0.48 + it.power * 1.55 + (it.crit ? 0.24 : 0));
                    break;
                }
            }
            recoilPow.current = rp;
        }
        const base = beatTimeline(basePose, facing, 1.0, baseProg, { power: basePose === "recoil" ? recoilPow.current : 0.6 });
        // Fire the forward strike pulse when windup completes into strike/recover.
        // Read the resolution about to land so the pulse is ability-distinct: a melee
        // HIT → a power-scaled lunge (heavier = deeper, overhead chop on crits); a
        // ranged CAST → a plant + recoil-kick so ranged pets never slide into melee.
        if (prevSimState.current === "windup" && (a0.state === "strike" || a0.state === "recover")) {
            strikeStart.current = state.clock.elapsedTime;
            let kind: "melee" | "ranged" = "melee", pow = 0.4, crit = false, choreo: MoveChoreoKind = "lightMelee";
            for (let k = 0; k < outResolves.length; k++) {
                const it = outResolves[k]; if (it.t > curTick + 8) break;
                if (it.t >= curTick - 1) { kind = it.kind; pow = it.power; crit = it.crit; choreo = it.choreo; break; }
            }
            strikeKind.current = kind; strikePow.current = pow; strikeCrit.current = crit;
            const mods = moveChoreoMods(choreo); strikeMods.current = mods;
            // RHYTHM VARIETY (R1): a heavy/crit blow reads as a CHARGED slam (longer telegraph +
            // deep thrust); a light poke as a QUICK jab — so the exchange skeleton isn't uniform.
            const heavy = crit || pow >= 0.55;
            const quick = !heavy && pow <= 0.28;
            strikeHeavy.current = heavy;
            const rhythmMul = heavy ? 1.5 : quick ? 0.74 : 1.0;
            pulseS.current = STRIKE_PULSE_S * (1 + 0.45 * pow) * mods.pulseMul * rhythmMul;
        }
        prevSimState.current = a0.state;
        const pe = state.clock.elapsedTime - strikeStart.current;
        let dxT = base.dx, dyT = base.dy, dzT = 0, sxT = base.sx, syT = base.sy, rotT = base.rot;
        if (pe >= 0 && pe < pulseS.current) {
            const pp = pe / pulseS.current;
            const thrust = pp < 0.32 ? pp / 0.32 : 1 - (pp - 0.32) / 0.68;
            const e = thrust * thrust * (3 - 2 * thrust);   // smoothstep
            const mods = strikeMods.current;
            if (mods.plant) {
                // Planted archetypes never gap-close, so a ranged/support pet never
                // slides into melee. Three distinct reads off the SAME pulse:
                if (mods.kickAway) {
                    // Ranged offensive — plant + recoil-kick away; the projectile carries it.
                    dxT = -0.5 * e * facing; sxT = 1 - 0.04 * e; syT = 1 + 0.06 * e; rotT = 0;
                } else if (mods.rise > 0) {
                    // Support cast — a stationary gather/rise (no kick, no lunge).
                    dxT = 0; dyT = mods.rise * Math.sin(Math.PI * pp); sxT = 1 - 0.03 * e; syT = 1 + 0.10 * e; rotT = 0;
                } else {
                    // Control beam — a braced plant (no kick, no travel).
                    dxT = 0; sxT = 1 + 0.05 * e; syT = 1 + 0.02 * e; rotT = 0;
                }
            } else {
                const pw = strikePow.current, ct = strikeCrit.current;
                // CLOSE THE GAP: lunge most of the way to the foe so the strike actually
                // CONNECTS across the resting spacer (rush in → hit → recoil back), instead
                // of a hop into empty air. A heavy slam commits a hair closer (closeMul<1);
                // stop short (DUEL_CONTACT_GAP) so the big sprites never overlap. Falls back
                // to a fixed reach if no foe is tracked.
                const gapToFoe = freeRoam3d && foeDistance !== null
                    ? foeDistance
                    : foeWX !== null ? Math.abs(foeWX - wx) : DUEL_MIN_WORLD_X;
                // Clamped so a single lunge can never overshoot the contact line into the foe.
                const reach = meleeLungeReach(gapToFoe, pw, ct, freeRoam3d ? DUEL_3D_CONTACT_GAP : DUEL_CONTACT_GAP, mods.closeMul);
                // Crit OR a slash archetype → a quick 2-tap flurry overlaid on the lunge;
                // else one thrust (a pierce / heavy slam commits as a single deep blow).
                const jab = (ct || mods.doubleTap) ? 0.72 + 0.28 * Math.abs(Math.cos(pp * Math.PI * 2)) : 1;
                let dx = reach * e * jab * facing;
                // Lifesteal → after contact, retract toward self (yank the life home).
                if (mods.drainBack > 0 && pp > 0.5) dx -= mods.drainBack * reach * 0.4 * ((pp - 0.5) / 0.5) * facing;
                dxT = dx;
                // GROUNDED — feet stay on the floor; only a slight lift on the crit/slam chop.
                // (The old big arc read as "dashing in the air".)
                dyT = (ct ? 0.16 : 0.035) * Math.sin(Math.PI * Math.min(1, pp / 0.72)) * (0.7 + 0.3 * pw);
                sxT = 1 + (0.10 + 0.14 * pw) * e + mods.chop * 0.05 * e;
                syT = 1 - (0.07 + 0.09 * pw) * e - mods.chop * 0.04 * e;
                rotT = -(0.05 + 0.16 * pw + mods.chop * 0.16) * e * facing * (ct ? 1.35 : 1);   // deeper overhead chop on slam/crit
            }
        }
        if (buffPosing) {
            const bp = Math.min(1, buffPoseElapsed / 0.82);
            const surge = Math.sin(Math.PI * Math.min(1, bp / 0.62));
            const plant = 1 - Math.pow(1 - Math.min(1, bp / 0.2), 3);
            // Brace on the floor and rise through the torso while the golden energy
            // column climbs. No hopping or side rotation: this is a planted power-up.
            dxT = 0;
            dyT = Math.max(dyT, 0.035 * surge);
            sxT = 1 + 0.08 * plant - 0.025 * surge;
            syT = 1 - 0.1 * plant + 0.13 * surge;
            rotT = 0;
        }
        // KO finisher — topple + sink when down (the dead pose fades; this lands it
        // with weight instead of just blinking out).
        if (a0.state === "dead") { dxT = -0.4 * facing; dyT = 0; rotT = 1.1 * facing; sxT = 1.05; syT = 0.7; }
        // The old billboard rig can only lunge on screen-x. A model can commit along
        // its actual facing vector, so attacks still connect after a flank or crossover.
        if (freeRoam3d) {
            const longitudinal = dxT * facing;
            dxT = longitudinal * faceWX;
            dzT = longitudinal * faceWZ;
        }
        const choreoResponse = (a0.state === "strike" || a0.state === "stagger" || pe < pulseS.current || buffPosing) ? 28 : 18;
        const ck = 1 - Math.exp(-choreoResponse * Math.min(delta, 1 / 15));
        choX.current = lerp(choX.current, dxT, ck);
        choY.current = lerp(choY.current, dyT, ck);
        choZ.current = lerp(choZ.current, dzT, ck);
        choSX.current = lerp(choSX.current, sxT, ck);
        choSY.current = lerp(choSY.current, syT, ck);
        choRot.current = lerp(choRot.current, rotT, ck);

        // Stand ON the floor: lane position + lunge offset + a tiny run-bob; a gentle
        // idle stance lean + breathe so a waiting pet never just stands stock-still.
        const idling = a0.state === "idle" && !moving;
        // Low-HP DESPERATION read (R3): below 26% HP a pet breathes harder/faster + gains a
        // rage aura + red rim (below), so the climax of a long fight actually looks like one.
        const frac = a0.hp / Math.max(1, a0.maxHp);
        const desperate = a0.state !== "dead" && frac > 0 && frac < 0.26;
        // Authored skeletal clips already contain their vertical cadence. Adding
        // the billboard run-bob and squash rig on top makes a real 3D pet judder
        // at every snapshot/state transition, so models receive only world-space
        // repositioning/lunge offsets here.
        const bob = moving && !combatModel ? Math.abs(Math.sin(state.clock.elapsedTime * 12 + bobPhase)) * 0.06 : 0;
        // A planted guard reads as intention; translating both pets during every idle
        // frame looked like synchronized dancing. Keep only a rare, tiny body feint.
        const neutralT = state.clock.elapsedTime * 0.6 + bobPhase;
        const feint = idling ? Math.max(0, Math.sin(neutralT * 1.35) - 0.96) * 0.45 * facing : 0;
        const bFreq = desperate ? 7.4 : 5.2, bAmp = desperate ? 0.075 : 0.04;
        const breathe = idling && !combatModel ? 1 + Math.abs(Math.sin(state.clock.elapsedTime * bFreq + bobPhase)) * bAmp : 1;
        // The authored dash route is already a complete launch → S-step → contact
        // phrase. Suppress the ordinary melee-lunge offset until its short recovery
        // window clears; adding both translations made the pet overshoot and snap.
        const routeOwnsPosition = dashActive || dashRecovering;
        // The 3D stage track already contains approach, contact, recoil and exit
        // displacement. Adding the legacy billboard lunge on top caused a second
        // horizontal shove followed by a correction (the remaining stiff slide).
        // Keep vertical anticipation/hops, but give horizontal ownership to one
        // system. An authored dash owns all three axes because its S-route has its
        // own hop arc.
        const presentationChoX = (freeRoam3d || routeOwnsPosition) ? 0 : choX.current;
        const presentationChoY = routeOwnsPosition ? 0 : choY.current;
        const presentationChoZ = (freeRoam3d || routeOwnsPosition) ? 0 : choZ.current;
        g.position.set(wx + presentationChoX, FLOOR_Y + Math.max(0, presentationChoY) + bob, wz + presentationChoZ);
        if (combatModel) {
            const settle = 1 - Math.exp(-16 * Math.min(delta, 1 / 15));
            pg.scale.x = lerp(pg.scale.x, 1, settle);
            pg.scale.y = lerp(pg.scale.y, 1, settle);
            pg.scale.z = lerp(pg.scale.z, 1, settle);
            pg.rotation.z = lerp(pg.rotation.z, 0, settle);
        } else {
            pg.scale.set(choSX.current, choSY.current * breathe, 1);
            pg.rotation.z = lerp(pg.rotation.z, choRot.current + feint, 0.4);
        }

        // Pose: alternate the 2-frame run cycle while traversing (if the pet has
        // one), else the state pose (attack / hurt / cast / idle).
        let cat = poseCategory(DUEL_STATE_POSE[a0.state]);
        if (sizingUp) cat = "cast";   // the buff / power-up sprite pose during the size-up
        if (buffPosing) cat = "cast";
        // Generated ATTACK SEQUENCE: a windup frame during the wind-up, then
        // lunge→impact→recover across the strike pulse (melee only) — so the
        // creature really swings. Falls back to the single "attack" pose for pets
        // without generated move frames (poses.hasMove === false).
        if (poses?.hasMove) {
            if (a0.state === "windup") cat = "windup";
            else if (strikeKind.current === "melee" && pe >= 0 && pe < pulseS.current) {
                const pp = pe / pulseS.current;
                // Heavy blows DWELL on the wind/impact frames; quick jabs blow through them (R1).
                const p0 = strikeHeavy.current ? 0.30 : 0.42, p1 = strikeHeavy.current ? 0.60 : 0.78;
                cat = pp < p0 ? "lunge" : pp < p1 ? "impact" : "recover";
            }
        }
        if (moving && poses?.hasRun && (a0.state === "idle" || a0.state === "dash")) {
            runClock.current += delta * 12.5;
            cat = Math.floor(runClock.current) % 2 === 0 ? "run-a" : "run-b";
        }
        if (cat !== poseCat) setPoseCat(cat);

        // Hit flash on HP drop (folded into the material colour); status tint while
        // afflicted; fade out when down.
        if (a0.hp < prevHp.current - 0.5) flash.current = 1;
        prevHp.current = a0.hp;
        flash.current *= 0.86;
        let fl = flash.current < 0.02 ? 0 : flash.current * 0.9;
        // Power-up GLOW while sizing up — a pulsing brightness so both pets visibly "buff".
        if (sizingUp) fl = Math.max(fl, 0.22 + 0.16 * Math.abs(Math.sin(state.clock.elapsedTime * 6)));
        // DESPERATION rage aura (R3) — a pulsing glow when a pet is bloodied (< 26% HP).
        if (desperate) fl = Math.max(fl, 0.10 + 0.10 * Math.abs(Math.sin(state.clock.elapsedTime * 8)));
        // Status TINT (burn = ember-warm, stun = icy-blue) pulses on the sprite so
        // afflictions read at a glance; the stagger hurt-flash deepens it to red.
        const hurt = a0.state === "stagger" ? 0.5 : 0;
        let tr = 1, tg = 1, tb = 1;
        const st = a0.statuses;
        if (st.length) {
            if (st.includes("burn")) { tg = 0.74; tb = 0.55; }
            else if (st.includes("stun")) { tr = 0.74; tg = 0.88; }
            const pulse = 0.88 + 0.12 * Math.sin(state.clock.elapsedTime * 7 + bobPhase);
            tr = 1 - (1 - tr) * pulse; tg = 1 - (1 - tg) * pulse; tb = 1 - (1 - tb) * pulse;
        }
        tg -= 0.3 * hurt; tb -= 0.3 * hurt;
        if (desperate) { tr = Math.min(1.25, tr + 0.14); tg *= 0.93; tb *= 0.88; }   // bloodied red-rage rim (R3)
        const mf = modelFrame.current;
        // The simulator's strike state is intentionally only one tick long, but a
        // production animation needs a complete anticipation -> contact -> follow-
        // through phrase. Keep the authored attack clip alive for the render-side
        // strike pulse instead of replacing it with `recover` after ~33 ms. This is
        // the difference between a creature visibly attacking and a model merely
        // sliding forward while its attack clip flashes for a single frame.
        const striking = pe >= 0 && pe < pulseS.current;
        mf.motion = a0.state === "dead"
            ? "dead"
            : dashActive
                ? "dash"
                : dashRecovering && dashCue && !dashCue.impact
                    // A missed gap-closer plants and turns after crossing the empty
                    // lane. Leaving the simulator's one-tick strike here made the
                    // fox instantly change from gallop to idle at its new position.
                    ? "recover"
                : striking
                ? "strike"
                : a0.state === "idle" && moving ? "run" : a0.state;
        mf.moving = moving;
        mf.speed = smoothedSpeed.current;
        mf.moveX = travelFacing.current[0];
        mf.moveZ = travelFacing.current[1];
        mf.faceX = faceWX;
        mf.faceZ = faceWZ;
        mf.hit = flash.current;
        const atTerminal = clock.current.t >= snaps.length - 1 - 0.001;
        const winnerTeam = myEnemy ? "enemy" : "player";
        const defeated = atTerminal && duel.winner !== null && duel.winner !== winnerTeam;
        const victorious = atTerminal && a0.state !== "dead" && duel.winner === winnerTeam;
        if (defeated) mf.motion = "dead";
        mf.casting = sizingUp || buffPosing || victorious || (a0.state === "windup" && strikeKind.current === "ranged");
        mf.desperate = desperate;
        mf.statuses = st;
        mf.victorious = victorious;
        mf.moveStyle = activeHeroMove?.style ?? "generic";
        mf.moveName = activeHeroMove?.move;
        const battleTimeline = (clock.current.intro ?? 0) >= INTRO_TOTAL
            ? INTRO_TOTAL + clock.current.t / DUEL_TPS
            : (clock.current.intro ?? 0);
        if (atTerminal) {
            if (!terminalTimeline.current) terminalTimeline.current = { wall: state.clock.elapsedTime, base: battleTimeline };
            mf.timeline = terminalTimeline.current.base + (state.clock.elapsedTime - terminalTimeline.current.wall);
        } else {
            terminalTimeline.current = null;
            mf.timeline = battleTimeline;
        }
        if (m) {
            m.color.setRGB(Math.min(2, tr + fl), Math.min(2, Math.max(0, tg) + fl), Math.min(2, Math.max(0, tb) + fl));
            m.opacity = a0.state === "dead" ? lerp(m.opacity, 0.25, 0.1) : 1;
            if (m.map !== useTex) m.map = useTex;
            // Drive the deform "rig": lean into the lunge, arch on the hop, body/tail
            // follow-through wave (stronger while moving / striking, gentle idle sway).
            if (deformU.current) {
                deformU.current.uHalfH.value = L.planeH * 0.5;
                deformU.current.uTime.value = state.clock.elapsedTime;
                // Lean into the lunge — clamped so the now-deeper gap-closing reach doesn't shear the sprite.
                deformU.current.uLean.value = lerp(deformU.current.uLean.value, Math.max(-0.6, Math.min(0.6, choX.current * (strikeHeavy.current ? 0.4 : 0.3))), 0.4);   // heavier lean on a charged blow (R1)
                deformU.current.uArch.value = Math.max(0, choY.current) * 0.5;
                deformU.current.uWave.value = 0.025 + Math.min(0.14, smoothedSpeed.current * 0.12) + (pe >= 0 && pe < pulseS.current ? 0.12 : 0) + (desperate ? 0.04 : 0);   // bloodied jitter (R3)
            }
        }

        // HP bar + dead dim via DOM refs (no React re-render).
        if (hpFill.current) {
            const pct = Math.max(0, Math.min(100, (a0.hp / Math.max(1, a0.maxHp)) * 100));
            hpFill.current.style.width = `${pct}%`;
            // Trailing "chip" drains DOWN slowly behind the fill (the classic damage read);
            // snaps up instantly on a heal so it never sits above true HP.
            if (hpChip.current) { const chip = parseFloat(hpChip.current.style.width) || pct; hpChip.current.style.width = `${chip <= pct ? pct : lerp(chip, pct, 0.12)}%`; }
        }
        if (nameWrap.current) nameWrap.current.style.opacity = a0.state === "dead" ? "0.5" : "1";

        // Contact shadow — flat on the floor, tracks x/z, fades + shrinks as the pet lifts.
        if (shadow.current && shadowMat.current) {
            shadow.current.position.set(wx + presentationChoX, 0.02, wz + presentationChoZ);
            const lift = Math.max(0, presentationChoY);
            const sf = Math.max(0, 1 - lift * 0.7);
            shadowMat.current.opacity = 0.42 * sf * (a0.state === "dead" ? 0.4 : 1);
            const s = 0.85 + 0.15 * sf;
            shadow.current.scale.set(shadowW * s, shadowW * 0.5 * s, 1);
        }
    });

    return (
        <group>
            <group ref={group}>
                {combatModel ? (
                    <group ref={poseG}>
                        <Suspense fallback={(
                            <Billboard lockX lockZ>
                                <mesh position={[L.meshX, L.meshY, 0]}>
                                    <planeGeometry args={[L.planeW, L.planeH, 6, 20]} />
                                    <primitive object={baseMat} ref={matRef} attach="material" />
                                </mesh>
                            </Billboard>
                        )}>
                            <PetModel3D config={combatModel} frame={modelFrame} element={pet.element} />
                        </Suspense>
                    </group>
                ) : (
                    /* Y-axis-locked billboard: yaws to face the camera but stays vertical,
                       so the feet never lift off the floor at the angled camera. */
                    <Billboard lockX lockZ>
                        <group ref={poseG}>
                            <mesh position={[L.meshX, L.meshY, 0]}>
                                <planeGeometry args={[L.planeW, L.planeH, 6, 20]} />
                                <primitive object={baseMat} ref={matRef} attach="material" />
                            </mesh>
                        </group>
                    </Billboard>
                )}
                <Html position={[0, combatModel ? combatModel.targetHeight + 0.5 : L.contentWorldH + 0.4, 0]} center distanceFactor={11} pointerEvents="none" zIndexRange={[6, 0]}>
                    <div ref={nameWrap} style={{ textAlign: "center", font: "700 12px Inter, system-ui, sans-serif", whiteSpace: "nowrap", userSelect: "none" }}>
                        <div style={{ color: "#fff", textShadow: "0 1px 3px #000", marginBottom: 2 }}>Lv.{pet.level} {pet.name}</div>
                        <div style={{ position: "relative", width: 64, height: 6, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpChip} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: "#fbbf24", opacity: 0.75 }} />
                            <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: side === "player" ? "#4ade80" : "#f87171" }} />
                        </div>
                    </div>
                </Html>
            </group>
            {/* Per-pet contact shadow — flat on the floor, follows the pet. */}
            <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial ref={shadowMat} map={shadowTexture()} transparent opacity={0.42} depthWrite={false} toneMapped={false} />
            </mesh>
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
let _trailStreakTex: THREE.CanvasTexture | null = null;
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

/** A thin horizontal glowing LENS — a forward thrust streak (used for the pierce
 *  weapon trail). Glow-on-transparent; the element tint colours it, additive blend. */
function trailStreakTexture(): THREE.CanvasTexture {
    if (_trailStreakTex) return _trailStreakTex;
    const S = 128, c = document.createElement("canvas"); c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    // Stretch a radial glow into a thin horizontal lens (bright core → soft ends/edges).
    g.translate(S / 2, S / 2); g.scale(1, 0.26);
    const rad = g.createRadialGradient(0, 0, 1, 0, 0, S / 2);
    rad.addColorStop(0, "rgba(255,255,255,1)");
    rad.addColorStop(0.45, "rgba(255,255,255,0.72)");
    rad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rad; g.beginPath(); g.arc(0, 0, S / 2, 0, Math.PI * 2); g.fill();
    _trailStreakTex = new THREE.CanvasTexture(c); _trailStreakTex.colorSpace = THREE.SRGBColorSpace;
    return _trailStreakTex;
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
// Warm + decode every painted projectile texture at module load so they're ready
// long before the first bolt spawns — a freshly-loaded alpha-blended sprite would
// otherwise render an opaque black box for the frames before its WebP decodes.
if (typeof window !== "undefined") for (const k of Object.keys(PROJ_SPRITE_URL)) projSpriteTexture(k);

/** The shared element/role-distinct projectile body — a glowing head (round
 *  fireball / undulating water ball / spinning wind crescent / tumbling rock /
 *  jagged bolt) with a comet tail and, for signature/crit shots, a pulsing aura
 *  ring. Self-animates flicker + spin off the clock (no rng → replay-safe). The
 *  PARENT group owns world position, the travel-direction rotation (so the head
 *  always points where it's going — both stages look straight down −z, so world
 *  xy == screen) and the perspective depth-scale. */
function ProjectileBody({ visual }: { visual: ProjectileVisual }) {
    const paintedGrp = useRef<THREE.Group>(null);
    const procGrp = useRef<THREE.Group>(null);
    const core = useRef<THREE.Mesh>(null);        // painted-sprite quad
    const procCore = useRef<THREE.Mesh>(null);    // procedural head
    const ring = useRef<THREE.Mesh>(null);
    const ringMat = useRef<THREE.MeshBasicMaterial>(null);
    const procRing = useRef<THREE.Mesh>(null);
    const procRingMat = useRef<THREE.MeshBasicMaterial>(null);
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
        // The painted sprite is ALPHA-blended, so its quad renders as an opaque BLACK
        // box until the WebP has actually decoded (`image.complete` + real dimensions).
        // Until then — and forever, if the texture fails to load — show the (additive)
        // procedural projectile instead, which can never flash a black box.
        const im = spriteTex?.image as HTMLImageElement | undefined;
        const painted = !!spriteTex && !!im && im.complete && (im.naturalWidth || 0) > 0;
        if (paintedGrp.current) paintedGrp.current.visible = painted;
        if (procGrp.current) procGrp.current.visible = !painted;
        const fl = visual.flicker ? 1 + Math.sin(t * 38 + visual.size * 60) * 0.5 * visual.flicker : 1;
        if (painted) {
            // Real art is already aimed by the parent; only fire/lightning pulse.
            if (core.current) core.current.scale.set(spriteScale * fl, spriteScale * fl, 1);
            if (ring.current && ringMat.current) {
                const p = (t * 1.7) % 1; const rs = ringBase * (1 + p * 2.4);
                ring.current.scale.set(rs, rs, 1); ringMat.current.opacity = (1 - p) * 0.45;
            }
        } else {
            if (procCore.current) {
                procCore.current.scale.set(baseW * 2.2 * fl, baseH * 2.2 * fl, 1);
                if (visual.spin) procCore.current.rotation.z = t * visual.spin;
            }
            if (procRing.current && procRingMat.current) {
                const p = (t * 1.7) % 1; const rs = ringBase * (1 + p * 2.4);
                procRing.current.scale.set(rs, rs, 1); procRingMat.current.opacity = (1 - p) * 0.45;
            }
        }
    });

    return (
        <group>
            {/* REAL painted element sprite (fireball / water ball / wind cut / boulder /
                bolt): alpha-blended so true colours composite over the scene — hidden
                until decoded (see useFrame) so it never flashes a black box. */}
            {spriteTex && (
                <group ref={paintedGrp} visible={false}>
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
            )}

            {/* Procedural fallback — all additive (never a black box). Shown while the
                painted sprite decodes, and as the only body for heal-comet / shadow /
                neutral shots that have no painted art. */}
            <group ref={procGrp}>
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
                <mesh ref={procCore}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial map={headTex} color={visual.core} transparent opacity={0.97} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </mesh>
                {visual.charged && (
                    <mesh ref={procRing} position={[0, 0, 0.01]}>
                        <ringGeometry args={[0.4, 0.5, 24]} />
                        <meshBasicMaterial ref={procRingMat} color={visual.glow} transparent opacity={0.45} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                    </mesh>
                )}
            </group>
        </group>
    );
}

/** Volumetric projectile used when both combatants are real models.  It is built
 * from solid toon cores, translucent energy shells and receding trail geometry,
 * so it belongs to the same lit 3D space as the pets instead of reading like a
 * flat icon pasted between them. */
function NativeProjectileBody({ visual, quality }: { visual: ProjectileVisual; quality: PetVisualQualityConfig }) {
    const root = useRef<THREE.Group>(null);
    const shell = useRef<THREE.Mesh>(null);
    const light = useRef<THREE.PointLight>(null);
    const trail = useRef<THREE.Group>(null);
    const key = visual.spriteKey ?? (visual.tex === "crescent" ? "wind" : visual.tex === "bolt" ? "lightning" : visual.tex === "rock" ? "earth" : "arcane");
    const flameHead = useMemo(() => key === "fire" ? makeFlamePetalGeometry(0.92, 0.28, 0.32) : null, [key]);
    const flameInner = useMemo(() => key === "fire" ? makeFlamePetalGeometry(0.68, 0.17, 0.2) : null, [key]);
    const lightningBolts = useMemo(() => key === "lightning" ? Array.from({ length: 3 }, (_, i) => makeElementVolumeCurve("lightning", i, "contact")) : [], [key]);
    const energyTrails = useMemo(() => key === "earth" ? [] : Array.from({ length: 3 }, (_, i) => makeFlameRibbonGeometry(
        0.9 - i * 0.14,
        0.07 - i * 0.01,
        0.18 + i * 0.04,
        i * 1.7,
    )), [key]);
    useEffect(() => () => {
        flameHead?.dispose();
        flameInner?.dispose();
        lightningBolts.forEach((geometry) => geometry.dispose());
        energyTrails.forEach((geometry) => geometry.dispose());
    }, [energyTrails, flameHead, flameInner, lightningBolts]);
    const coreColor = key === "fire" ? "#ff5a18" : key === "water" ? "#168fda" : key === "wind" ? "#49cdb7" : key === "earth" ? "#9a5a2d" : key === "lightning" ? "#8d63ff" : visual.core;
    const edgeColor = key === "fire" ? "#ffd65a" : key === "water" ? "#52cbe0" : key === "wind" ? "#73dfc4" : key === "earth" ? "#e8ad5d" : key === "lightning" ? "#fff6a9" : visual.glow;
    useFrame((state) => {
        const t = state.clock.elapsedTime;
        const pulse = 1 + Math.sin(t * (key === "lightning" ? 34 : 15)) * (key === "earth" ? 0.035 : 0.075);
        if (root.current) {
            root.current.scale.setScalar((visual.charged ? 1.28 : 1) * pulse);
            root.current.rotation.x = key === "earth" ? t * 4.2 : Math.sin(t * 7) * 0.12;
        }
        if (shell.current) {
            shell.current.rotation.x = t * 2.1;
            shell.current.rotation.y = t * (key === "wind" ? 8 : 3.4);
            shell.current.scale.setScalar(1.05 + Math.sin(t * 18) * 0.06);
        }
        if (trail.current) trail.current.rotation.x = Math.sin(t * 9) * 0.16;
        if (light.current) light.current.intensity = (visual.charged ? 3.8 : 2.3) + Math.abs(Math.sin(t * 21)) * 0.9;
    });
    const energyLayer = (opacity: number, color = edgeColor) => (
        <meshToonMaterial color={color} emissive={color} emissiveIntensity={0.16} transparent opacity={Math.min(0.92, opacity * 1.45)} depthWrite={false} side={THREE.DoubleSide} />
    );
    return (
        <group ref={root} scale={visual.size * 1.55}>
            {/* Solid identity core. */}
            {key === "earth" ? (
                <group rotation={[0.18, -0.32, 0.12]}>
                    <mesh castShadow scale={[1.22, 0.88, 1]}><icosahedronGeometry args={[0.34, 1]} /><meshToonMaterial color={coreColor} emissive="#2b1309" emissiveIntensity={0.08} /></mesh>
                    <mesh position={[-0.18, 0.2, 0.2]} rotation={[0.6, 0.2, -0.4]} scale={0.34}><icosahedronGeometry args={[0.34, 1]} /><meshToonMaterial color="#c27a3c" emissive="#2b1309" emissiveIntensity={0.06} /></mesh>
                    <mesh position={[0.15, -0.18, -0.18]} rotation={[-0.5, 0.7, 0.2]} scale={0.27}><icosahedronGeometry args={[0.34, 1]} /><meshToonMaterial color="#704128" emissive="#2b1309" emissiveIntensity={0.05} /></mesh>
                </group>
            ) : key === "water" ? (
                <group position={[-0.08, 0, 0]}>
                    <mesh scale={[1.38, 0.64, 0.64]} castShadow><sphereGeometry args={[0.36, 22, 14]} /><meshToonMaterial color="#075f9b" emissive="#042b55" emissiveIntensity={0.06} /></mesh>
                    <mesh position={[0.09, 0.03, 0.03]} scale={[1.08, 0.46, 0.46]}><sphereGeometry args={[0.34, 20, 12]} /><meshToonMaterial color={coreColor} emissive="#21c7e6" emissiveIntensity={0.1} transparent opacity={0.88} depthWrite={false} /></mesh>
                    <mesh position={[-0.47, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.78, 1.1, 0.78]}><coneGeometry args={[0.25, 0.72, 14]} /><meshToonMaterial color="#075f9b" emissive="#042b55" emissiveIntensity={0.05} /></mesh>
                    <mesh position={[0.03, 0, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[0.31, 0.043, 8, 30, Math.PI * 1.62]} /><meshToonMaterial color={edgeColor} emissive={coreColor} emissiveIntensity={0.1} transparent opacity={0.74} depthWrite={false} /></mesh>
                    <mesh position={[-0.24, 0.02, 0]} rotation={[0, Math.PI / 2, 0.64]} scale={0.72}><torusGeometry args={[0.31, 0.035, 8, 26, Math.PI * 1.38]} /><meshToonMaterial color="#d8fbff" transparent opacity={0.58} depthWrite={false} /></mesh>
                </group>
            ) : key === "fire" && flameHead && flameInner ? (
                <group position={[-0.28, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                    <mesh geometry={flameHead} rotation={[0, 0, 0.12]}>
                        <meshToonMaterial color="#e63712" emissive="#7f1308" emissiveIntensity={0.32} transparent opacity={0.94} depthWrite={false} />
                    </mesh>
                    <mesh geometry={flameInner} position={[0, 0.05, 0.025]} rotation={[0, 0.18, -0.08]}>
                        <meshToonMaterial color="#ffd957" emissive="#ff6318" emissiveIntensity={0.58} transparent opacity={0.92} depthWrite={false} />
                    </mesh>
                </group>
            ) : key === "wind" ? (
                <group>
                    <mesh rotation={[Math.PI / 2, 0, 0.36]}><torusGeometry args={[0.34, 0.085, 8, 28, Math.PI * 1.32]} /><meshToonMaterial color={coreColor} emissive="#0c4e48" emissiveIntensity={0.18} transparent opacity={0.88} depthWrite={false} /></mesh>
                    <mesh rotation={[-Math.PI / 2, 0, -0.38]} scale={0.74}><torusGeometry args={[0.34, 0.065, 8, 24, Math.PI * 1.16]} /><meshToonMaterial color={edgeColor} transparent opacity={0.74} depthWrite={false} /></mesh>
                </group>
            ) : key === "lightning" ? (
                <group rotation={[0, 0, -Math.PI / 2]} scale={0.5} position={[-0.15, 0, 0]}>
                    {lightningBolts.map((geometry, i) => (
                        <mesh key={i} geometry={geometry} rotation={[i * 0.18, i * 0.42, i * 0.22]}>
                            <meshToonMaterial color={i === 0 ? edgeColor : coreColor} emissive={edgeColor} emissiveIntensity={0.24} transparent opacity={i === 0 ? 0.96 : 0.72} depthWrite={false} />
                        </mesh>
                    ))}
                </group>
            ) : (
                <mesh scale={[1.18, 0.88, 0.88]}><icosahedronGeometry args={[0.36, 1]} /><meshToonMaterial color={coreColor} emissive={edgeColor} emissiveIntensity={key === "fire" ? 0.48 : 0.28} /></mesh>
            )}

            {/* Energy envelope catches the silhouette without whitening the core. */}
            <mesh ref={shell} scale={key === "wind" ? 1.35 : 1.15}>
                {key === "wind" ? <torusGeometry args={[0.34, 0.045, 7, 30, Math.PI * 1.7]} /> : key === "water" ? <torusGeometry args={[0.38, 0.055, 8, 30, Math.PI * 1.78]} /> : <sphereGeometry args={[0.43, 20, 12]} />}
                {energyLayer(key === "earth" ? 0.12 : key === "water" ? 0.18 : 0.26)}
            </mesh>

            {/* Receding volumes give real travel direction and speed. */}
            <group ref={trail}>
                {[0, 1, 2].map((i) => key === "earth" ? (
                    <mesh key={i} position={[-0.5 - i * 0.28, (i - 1) * 0.1, (i % 2 ? -1 : 1) * 0.11]} scale={0.13 - i * 0.02} rotation={[i, i * 0.8, 0]}><dodecahedronGeometry args={[1, 0]} /><meshToonMaterial color={i ? "#6f3d22" : edgeColor} /></mesh>
                ) : (
                    <mesh key={i} geometry={energyTrails[i]} position={[-0.42 - i * 0.18, (i - 1) * 0.11, (i % 2 ? -1 : 1) * 0.09]} rotation={[0, i * 0.42, -Math.PI / 2]} scale={[0.8 - i * 0.12, 0.78 - i * 0.1, 0.78 - i * 0.1]}>
                        {energyLayer(0.4 - i * 0.1, i === 0 ? edgeColor : coreColor)}
                    </mesh>
                ))}
            </group>
            {quality.dynamicPetLight && <pointLight ref={light} color={edgeColor} intensity={2.4} distance={visual.charged ? 5.4 : 3.8} decay={2} />}
        </group>
    );
}

/** One in-flight projectile — an element-distinct flying attack (fireball /
 *  water ball / wind cut / rock throw / lightning bolt) that points where it's
 *  going. Driven by the sim's homing projectile in `snapshots[t].projectiles`. */
function DuelProjectile({ index, duel, clock, quality, native = false }: { index: number; duel: DuelResult; clock: { current: DuelClock }; quality: PetVisualQualityConfig; native?: boolean }) {
    const grp = useRef<THREE.Group>(null);
    const inner = useRef<THREE.Group>(null);
    const curId = useRef<number | null>(null);
    const lastAngle = useRef(0);
    const [visual, setVisual] = useState<ProjectileVisual>(() => projectileVisual({ element: null }));
    useFrame(() => {
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
        const pp = duelFieldToFloor(sx, sy);
        g.position.set(pp.wx, FX_Y, pp.wz);
        // Point the head along its travel direction, projected into the screen plane.
        if (nxt) {
            const p1 = duelFieldToFloor(nxt.x, nxt.y);
            const dxw = p1.wx - pp.wx, dzw = p1.wz - pp.wz;
            if (dxw * dxw + dzw * dzw > 1e-5) lastAngle.current = Math.atan2(-dzw, dxw);
        }
        if (inner.current) {
            if (native) inner.current.rotation.y = lastAngle.current;
            else inner.current.rotation.z = lastAngle.current;
        }
    });
    if (native) return (
        <group ref={grp} visible={false}>
            <group ref={inner}><NativeProjectileBody visual={visual} quality={quality} /></group>
        </group>
    );
    return (
        <group ref={grp} visible={false}>
            <Billboard lockX lockZ>
                <group ref={inner}>
                    <ProjectileBody visual={visual} />
                </group>
            </Billboard>
        </group>
    );
}

/** Playback driver: advances the shared clock (with HIT-STOP on impact), spawns
 *  damage numbers + impact bursts + elemental VFX as the clock crosses events,
 *  nudges the fixed stage camera for screen-shake, and fires onEnd once. */
type DuelSetPieceKind = "flameBurst" | "abyssBurst" | "tidalWave" | "tornado" | "lightningStorm" | "earthBurst" | "lunarBurst" | "elemental";
type DuelElementBurstKind = "fire" | "water" | "wind" | "lightning" | "earth" | "abyss" | "arcane";
type DuelMoveCalloutTone = "attack" | "support" | "maneuver" | "combo";
type DuelImpactMode = "impact" | "tell" | "dodge";
type DuelSupportKind = "heal" | "shield";
type DuelAttackWeight = "basic" | "ability" | "heavy";
type DuelDashCue = {
    id: number;
    actorId?: string;
    from: Vec3;
    to: Vec3;
    /** The attacker lands at `to`; damage and the contact burst resolve on the
     * defender at `impactAt`. Keeping these separate prevents a safe body gap
     * from turning a successful hit into VFX that visibly detonates in empty air. */
    impactAt: Vec3;
    color: string;
    kind: DuelElementBurstKind;
    move?: string;
    style: PetHeroMoveStyle;
    impact: boolean;
    createdAt: number;
    duration: number;
    travelDuration: number;
    /** Simulation-clock ownership keeps the model, trail and contact on one
     * timeline instead of skipping travel frames during a slow render. */
    startTick: number;
    contactTick: number;
    endTick: number;
    /** Signed lateral bow plus a smaller counter-sweep. Both return to zero at contact. */
    bend: number;
    weave: number;
};
function dashCueTravelProgress(cue: Pick<DuelDashCue, "startTick" | "contactTick">, tick: number): number {
    return Math.min(1, Math.max(0, (tick - cue.startTick) / Math.max(1, cue.contactTick - cue.startTick)));
}
type DuelPressureCue = { id: number; from: Vec3; to: Vec3; leftColor: string; rightColor: string; leftKind: DuelElementBurstKind; rightKind: DuelElementBurstKind };
function dashTravelEase(progress: number): number {
    const p = Math.min(1, Math.max(0, progress));
    // Cubic smoothstep keeps the burst fast but spreads its displacement across
    // more visible frames than the old quadratic ease, whose steep midpoint read
    // like a teleport at 50-60 fps.
    return p * p * (3 - 2 * p);
}
function dashPathPoint(cue: Pick<DuelDashCue, "from" | "to" | "bend" | "weave" | "impact">, progress: number, y = FLOOR_Y): Vec3 {
    const p = dashTravelEase(progress);
    const dx = cue.to[0] - cue.from[0], dz = cue.to[2] - cue.from[2];
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const sideX = -dz / length, sideZ = dx / length;
    // The first sine bows into a lane; the second crosses that lane once, creating
    // an authored anime S-step rather than random locomotion noise. Both are zero
    // at launch/contact, so the deterministic simulation endpoints stay exact.
    const lateral = Math.sin(Math.PI * p) * cue.bend + Math.sin(Math.PI * 2 * p) * cue.weave;
    const hop = Math.sin(Math.PI * p) * (cue.impact ? 0.3 : 0.42);
    return [
        lerp(cue.from[0], cue.to[0], p) + sideX * lateral,
        y + hop,
        lerp(cue.from[2], cue.to[2], p) + sideZ * lateral,
    ];
}
type DuelFxPalette = { dark: string; body: string; accent: string; core: string };
function duelFxPalette(kind: DuelElementBurstKind, fallback: string): DuelFxPalette {
    if (kind === "fire") return { dark: "#421008", body: "#d92d12", accent: "#ff7a18", core: "#ffd36a" };
    if (kind === "water") return { dark: "#042b55", body: "#0877bd", accent: "#21c7e6", core: "#d8fbff" };
    if (kind === "wind") return { dark: "#073b3d", body: "#14796f", accent: "#50d9b8", core: "#e0fff3" };
    if (kind === "lightning") return { dark: "#211047", body: "#5c38c4", accent: "#b48cff", core: "#fff3a3" };
    if (kind === "earth") return { dark: "#2c190e", body: "#754321", accent: "#ce8f38", core: "#ffe0a1" };
    if (kind === "abyss") return { dark: "#15081d", body: "#47102f", accent: "#e5224f", core: "#ffad86" };
    const base = new THREE.Color(fallback);
    return {
        dark: base.clone().multiplyScalar(0.28).getStyle(),
        body: base.clone().multiplyScalar(0.72).getStyle(),
        accent: base.getStyle(),
        core: base.clone().lerp(new THREE.Color("#fff1d4"), 0.7).getStyle(),
    };
}

/** A beveled, tapered brush stroke. These opaque silhouettes replace the flat
 * rings/orbs that made combat effects look like UI laid over sculpted pets. */
function makeAnimeStrokeGeometry(length: number, width: number, curl: number, jagged = 0): THREE.ExtrudeGeometry {
    const steps = 24;
    const upper: THREE.Vector2[] = [];
    const lower: THREE.Vector2[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = (t - 0.18) * length;
        const tooth = jagged > 0 && i > 0 && i < steps ? (i % 2 ? 1 : -1) * jagged * (0.45 + Math.sin(Math.PI * t) * 0.55) : 0;
        const centerY = Math.sin(Math.PI * t) * curl + Math.sin(Math.PI * 2 * t) * curl * 0.16 + tooth;
        const nextT = Math.min(1, t + 1 / steps);
        const nextTooth = jagged > 0 && i < steps - 1 ? ((i + 1) % 2 ? 1 : -1) * jagged * (0.45 + Math.sin(Math.PI * nextT) * 0.55) : 0;
        const nextY = Math.sin(Math.PI * nextT) * curl + Math.sin(Math.PI * 2 * nextT) * curl * 0.16 + nextTooth;
        const tangentX = length / steps;
        const tangentY = nextY - centerY;
        const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentY));
        const nx = -tangentY / tangentLength;
        const ny = tangentX / tangentLength;
        const envelope = Math.pow(Math.sin(Math.PI * t), 0.48) * (1 - t * 0.52) + 0.018;
        const half = width * envelope;
        upper.push(new THREE.Vector2(x + nx * half, centerY + ny * half));
        lower.push(new THREE.Vector2(x - nx * half, centerY - ny * half));
    }
    const shape = new THREE.Shape();
    shape.moveTo(upper[0].x, upper[0].y);
    for (let i = 1; i < upper.length; i++) shape.lineTo(upper[i].x, upper[i].y);
    for (let i = lower.length - 1; i >= 0; i--) shape.lineTo(lower[i].x, lower[i].y);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.065, steps: 1, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.018, bevelThickness: 0.02 });
    geometry.translate(0, 0, -0.0375);
    geometry.computeVertexNormals();
    return geometry;
}

function makeDashRibbonGeometry(cue: DuelDashCue, bodyY: number, halfHeight: number, lateralOffset = 0): THREE.BufferGeometry {
    const segments = 36;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const at = dashPathPoint(cue, t, bodyY);
        const envelope = Math.max(0.018, Math.pow(Math.sin(Math.PI * t), 0.58));
        const ahead = dashPathPoint(cue, Math.min(1, t + 1 / segments), bodyY);
        const tangentX = ahead[0] - at[0], tangentZ = ahead[2] - at[2];
        const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentZ));
        const sideX = -tangentZ / tangentLength, sideZ = tangentX / tangentLength;
        const offset = lateralOffset * envelope;
        const x = at[0] + sideX * offset, z = at[2] + sideZ * offset;
        positions.push(x, at[1] + halfHeight * envelope, z, x, at[1] - halfHeight * envelope, z);
        uvs.push(t, 1, t, 0);
        if (i < segments) {
            const n = i * 2;
            indices.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.setDrawRange(0, 0);
    return geometry;
}

/** A short, solid elemental stroke between the attacker's planted body position
 * and the defender's actual hurt point. The pets never have to overlap to sell
 * contact, and the player can read exactly where a successful dash connected. */
function makeDashContactGeometry(cue: DuelDashCue, radius: number, lateral = 0): THREE.TubeGeometry {
    const from = new THREE.Vector3(cue.to[0], FLOOR_Y + 0.82, cue.to[2]);
    const to = new THREE.Vector3(cue.impactAt[0], FLOOR_Y + 0.86, cue.impactAt[2]);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const sideX = -dz / length;
    const sideZ = dx / length;
    const arc = Math.min(0.34, length * 0.12) * lateral;
    const middle = from.clone().lerp(to, 0.5);
    middle.x += sideX * arc;
    middle.y += 0.2 + Math.min(0.18, length * 0.04);
    middle.z += sideZ * arc;
    if (length < 0.08) to.z += 0.08;
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([from, middle, to]), 10, radius, 7, false);
}
function duelElementBurstKind(element?: string | null, move?: string): DuelElementBurstKind {
    const name = String(move ?? "").toLowerCase();
    // Some pets deliberately subvert their roster element. The Oni Hound is an
    // Earth-slot assassin, but a move named Hellhound Execution should erupt in
    // abyssal hellfire instead of throwing generic tan rocks at the opponent.
    if (/hell|oni|abyss|demon|soul|corruption/.test(name)) return "abyss";
    // Move identity takes precedence over the roster element. Eclipse Kitsune is
    // catalogued as Wind, but a lunar signature should carry the same violet,
    // celestial language through anticipation, dash trail and contact payoff.
    if (/lunar|eclipse|moon|ninetail|kitsune/.test(name)) return "arcane";
    const key = String(element ?? "").toLowerCase();
    if (key === "fire" || key === "water" || key === "wind" || key === "lightning" || key === "earth") return key;
    return "arcane";
}
function liveDuelEffectPosition(duel: DuelResult, clock: { current: DuelClock }, actorId?: string): { wx: number; wz: number } | null {
    if (!actorId || duel.snapshots.length === 0) return null;
    const snapshot = duel.snapshots[Math.min(duel.snapshots.length - 1, Math.max(0, Math.floor(clock.current.t)))];
    const actor = snapshot?.actors.find((candidate) => candidate.id === actorId);
    return actor ? duelFieldToFloor(actor.x, actor.y) : null;
}
function duelSetPieceKind(element?: string | null, move?: string): DuelSetPieceKind {
    const name = String(move ?? "").toLowerCase();
    if (/hell|oni|abyss|demon|soul|corruption/.test(name)) return "abyssBurst";
    if (/lunar|eclipse|moon|ninetail|kitsune/.test(name)) return "lunarBurst";
    if (/tidal|wave|tsunami|torrent|undertow/.test(name) || element === "Water") return "tidalWave";
    if (/tornado|cyclone|tempest|gale|vortex/.test(name) || element === "Wind") return "tornado";
    if (/flame|fire|inferno|blaze|cinder|burst/.test(name) || element === "Fire") return "flameBurst";
    if (/lightning|thunder|volt|storm|static/.test(name) || element === "Lightning") return "lightningStorm";
    if (/earth|stone|rock|quake|cataclysm/.test(name) || element === "Earth") return "earthBurst";
    return "elemental";
}
function arenaScaleMove(move?: string): boolean {
    // Do not promote ordinary attacks just because an elemental word appears in
    // the pet's prefixed move name (for example "Tempest Hawk Force Pulse").
    // Ultimate events already receive a set piece; this gate is only for the few
    // explicitly arena-scale named attacks that arrive through a regular hit.
    return /\b(tidal wave|tsunami|maelstrom|tornado|cyclone|flame burst|inferno|eruption|cataclysm|thunderstorm|hellhound execution|hellgate|soul devour)\b/i.test(String(move ?? ""));
}

function duelSetPieceTiming(kind: DuelSetPieceKind): { durationSec: number; contactDelayMs: number } {
    if (kind === "tidalWave") return { durationSec: 1.95, contactDelayMs: 560 };
    if (kind === "tornado") return { durationSec: 2.05, contactDelayMs: 280 };
    if (kind === "lunarBurst") return { durationSec: 1.86, contactDelayMs: 230 };
    return { durationSec: 1.86, contactDelayMs: 180 };
}

function DuelDirector({ duel, clock, advanceClock, onEnd, spawnNumber, spawnImpact, spawnElementBurst, spawnAftermath, spawnFx, spawnSupport, spawnShock, spawnDust, spawnScorch, spawnPowerUp, spawnTrail, spawnDash, spawnPressure, spawnSetPiece, elementById, nameById, profileById, ultById, heroMoveById, onCutIn, onFlash, onCallout, onCombo, onAnnounce, onMoveCallout }: {
    duel: DuelResult; clock: { current: DuelClock }; advanceClock: (maxT: number, delta: number) => void;
    onEnd: () => void;
    spawnNumber: (n: { x: number; z: number; text: string; crit: boolean; heal: boolean }) => void;
    spawnImpact: (n: { x: number; z: number; color: string; big: boolean; mode?: DuelImpactMode }) => void;
    spawnElementBurst: (n: { x: number; z: number; element?: string | null; move?: string; color: string; big: boolean; heading?: number; style?: PetHeroMoveStyle }) => void;
    spawnAftermath: (n: { x: number; z: number; element?: string | null; move?: string; color: string; big: boolean }) => void;
    spawnFx: (n: { x: number; z: number; element?: string | null; key?: string; scale: number; dur: number }) => void;
    spawnSupport: (n: { x: number; z: number; color: string; kind: DuelSupportKind; actorId?: string }) => void;
    spawnShock: (n: { x: number; z: number; color: string; big: boolean }) => void;
    spawnDust: (n: { x: number; z: number }) => void;
    spawnScorch: (n: { x: number; z: number; big?: boolean }) => void;
    spawnPowerUp: (n: { x: number; z: number; color: string; actorId?: string; style?: PetHeroMoveStyle }) => void;
    spawnTrail: (n: { x: number; z: number; toward: number; kind: MoveChoreoKind; color: string; weight: DuelAttackWeight; style: PetHeroMoveStyle }) => void;
    spawnDash: (n: { actorId?: string; fromX: number; fromZ: number; toX: number; toZ: number; impactX?: number; impactZ?: number; color: string; element?: string | null; move?: string; style?: PetHeroMoveStyle; impact: boolean; startTick?: number; contactTick?: number }) => void;
    spawnPressure: (n: { fromX: number; fromZ: number; toX: number; toZ: number; leftColor: string; rightColor: string; leftElement?: string | null; rightElement?: string | null }) => void;
    spawnSetPiece: (n: { actorId?: string; targetId?: string; fromX: number; fromZ: number; toX: number; toZ: number; element?: string | null; move?: string }) => void;
    elementById: Record<string, string | null | undefined>;
    nameById: Record<string, string>;
    profileById: Record<string, PetCombatModelProfile | undefined>;
    ultById: Record<string, string>;
    heroMoveById: Record<string, string>;
    onCutIn: (actorId: string, move: string) => void;
    onFlash: (color: string, intensity: number) => void;     // full-screen element flash
    onCallout: (text: string) => void;                       // big "CRITICAL!/FINISH!" banner
    onCombo: (n: number) => void;                            // combo counter pop
    onAnnounce: (text: string, tone: "danger" | "reversal" | "ultimate" | "ko") => void;  // play-by-play commentary
    onMoveCallout: (text: string, side: "player" | "enemy", tone?: DuelMoveCalloutTone) => void;
}) {
    const { camera, size } = useThree();
    // The QA harness can open a replay at an arbitrary tick. Treat that tick as
    // established history so effects do not fire underneath the intro curtain;
    // normal replays still start at tick zero and consume every subsequent beat.
    const lastTick = useRef(Math.max(-1, Math.floor(clock.current.t)));
    const ended = useRef(false);
    const endHold = useRef(0);
    const shake = useRef(0);
    const hitStop = useRef(0);
    const timeScale = useRef(1.45);   // brisk opening release; authored beats temporarily slow this lane
    const zoomKick = useRef(0);    // transient dolly-IN punch on heavy hits (decays)
    const koPull = useRef(0);      // camera pull-BACK on KO (eases out slowly)
    const comboN = useRef(0);      // consecutive-hit combo counter
    const comboT = useRef(0);      // wall-time the combo window expires
    const lowHp = useRef<Set<string>>(new Set());   // actors already called "on the ropes" (re-arms on heal)
    const leadSide = useRef<"player" | "enemy" | "even">("even");   // who holds the HP lead — a swap = a reversal
    const lastReversal = useRef(0);                  // wall-time of the last reversal call (debounce)
    const holdUntil = useRef(0);                     // wall-time to HOLD the current slow-mo until (savor beat)
    const lastMoveCall = useRef(0);                  // wall-time of the last move-name callout (debounce)
    const heroCutActors = useRef<Set<string>>(new Set()); // every showcase fighter earns one marquee reveal
    const lastElementChain = useRef(-999);           // elemental payoff banner throttle
    // All arena-scale techniques share one presentation lane. Raw simulator
    // events can legitimately overlap (counter-ultimate, buff during pressure),
    // but launching their long-lived VFX independently produces an unreadable
    // stack. The lane serializes only presentation; combat truth is untouched.
    const majorVfxUntilWall = useRef(0);
    const majorVfxTimers = useRef<number[]>([]);
    useEffect(() => () => majorVfxTimers.current.forEach((timer) => window.clearTimeout(timer)), []);
    const majorVfxBusy = () => performance.now() / 1000 < majorVfxUntilWall.current;
    const occupyMajorVfxLane = (durationSec: number) => {
        majorVfxUntilWall.current = Math.max(majorVfxUntilWall.current, performance.now() / 1000 + durationSec);
    };
    const scheduleDirectorCue = (run: () => void, delayMs: number) => {
        const timer = window.setTimeout(run, delayMs);
        majorVfxTimers.current.push(timer);
    };
    // ── Cinematic camera (render-only): a live look target eased toward the fighters'
    // midpoint, briefly OVERRIDDEN by cuts (attacker on wind-up / defender on impact /
    // victim on KO), plus an adaptive dolly that tightens when they plant close.
    const camAim = useRef<[number, number, number]>([CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2]]);
    // `camAim` is the authored shot target; these are the actually rendered eye
    // and look positions. Keeping them separate turns a cue change into a quick
    // camera move instead of making the entire arena appear to teleport.
    const camLook = useRef<[number, number, number]>([CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2]]);
    const camEye = useRef<[number, number, number]>([CAM_POS[0], CAM_POS[1], CAM_POS[2]]);
    const camAimHold = useRef(0);      // seconds a cut aim is held before easing back to the midpoint
    const camDolly = useRef(CAM_POS[2]); // eased dolly distance (adaptive on the leads' spread)
    const camDollyBias = useRef(0);    // transient extra push-in during a wind-up cut (decays)
    const shotDolly = useRef(0);       // held shot-size offset: + pushes in, - reveals the arena
    const shotDollyHold = useRef(0);   // preserve the composition through anticipation / reaction
    const camPosBias = useRef<[number, number, number]>([0, 0, 0]);   // transient eye offset (low crit / overhead KO angle), eases back to 0
    const camBiasHold = useRef(0);
    const introLocked = useRef(false); // fires the "lock-in" shake once when the opening charge completes
    const primaryPresentationTicks = useMemo(() => [...new Set(duel.events
        .filter((event) => event.type === "windup" || event.type === "cast" || event.type === "ultimate" || event.type === "hit" || event.type === "whiff")
        .map((event) => event.t))].sort((a, b) => a - b), [duel]);
    const breatherBeats = useMemo(() => {
        if ((duel.snapshots[0]?.actors.length ?? 0) !== 2) return [] as number[];
        const beats: number[] = [];
        const minimumGap = Math.round(DUEL_TPS * 2.05);
        for (let i = 1; i < primaryPresentationTicks.length; i++) {
            const previous = primaryPresentationTicks[i - 1], next = primaryPresentationTicks[i];
            if (next - previous < minimumGap) continue;
            const cue = previous + Math.round(DUEL_TPS * 0.62);
            if (next - cue > Math.round(DUEL_TPS * 0.95)) beats.push(cue);
        }
        return beats;
    }, [duel, primaryPresentationTicks]);
    const pressureBeats = useMemo(() => {
        if ((duel.snapshots[0]?.actors.length ?? 0) !== 2) return [] as number[];
        const beats: number[] = [];
        const minimumGap = Math.round(DUEL_TPS * 3.25);
        for (let i = 1; i < primaryPresentationTicks.length; i++) {
            const previous = primaryPresentationTicks[i - 1], next = primaryPresentationTicks[i];
            if (next - previous < minimumGap) continue;
            const cue = Math.round(lerp(previous, next, 0.58));
            if (cue - previous >= Math.round(DUEL_TPS * 1.15) && next - cue >= Math.round(DUEL_TPS * 1.1)) beats.push(cue);
        }
        return beats.slice(0, 5);
    }, [duel, primaryPresentationTicks]);
    // Hits and genuinely moving whiffs share the same authored launch/travel
    // track. The outcome branches only at resolution: a hit gets contact VFX;
    // a miss keeps the trail, wide camera, empty lane, and recovery without
    // inventing damage. This closes the last "teleport" hole in melee playback.
    const attackDashBeats = useMemo(() => duelAttackDashBeats(duel.events, duel.snapshots), [duel]);
    // Direct the completed deterministic timeline like an edited fight scene:
    // every fighter gets exactly one identity reveal. Prefer its true signature,
    // but promote a successful named technique when a short match would otherwise
    // end before that signature becomes available.
    const heroCutEventByActor = useMemo(
        () => duelHeroCutEventIndexes(duel.events, heroMoveById),
        [duel.events, heroMoveById],
    );
    const pressureCount = useRef(0);
    useFrame((state, delta) => {
        const snaps = duel.snapshots;
        const maxT = snaps.length - 1;
        const now = state.clock.elapsedTime;
        // ── Dramatic time control (render-only — scales the clock advance, never the
        // sim). Neutral runs a touch FAST so dead approach time doesn't drag; each
        // hit/cast SAVOR-slows playback and HOLDS it (holdUntil) so the exchange
        // reads like a staged anime beat, then eases back. Hit-stop FREEZES on impact.
        // Cover neutral travel briskly, then spend the saved screen time on the
        // attack itself. Anime action feels fast because setup/repositioning is
        // economical while anticipation, contact, and reaction are deliberately
        // readable—not because every phase runs at one uniformly high speed.
        // Presentation target: this 1,424-tick showcase should land near 38 s,
        // not the previous 56.7 s. Neutral geography moves briskly while the
        // authored tells, contacts and signatures still own readable wall time.
        const BASE_SCALE = 1.72;
        // Limit simulation catch-up to one 30 Hz step per rendered frame. A slow
        // GPU frame now slows the replay gracefully instead of skipping across a
        // dash or named-move release. This does not alter deterministic combat.
        const frameDelta = Math.min(delta, 1 / DUEL_TPS);
        // One scale owns the phrase. The old stack multiplied base speed, dash
        // speed, arena-VFX slow-mo and savor slow-mo, creating abrupt 1.42x ->
        // 0.015x -> 0x changes that looked like lag even on a steady frame rate.
        const authoredDashInFlight = attackDashBeats.some((cue) => clock.current.t >= cue.startTick && clock.current.t < cue.resolveTick);
        let phraseScale = timeScale.current;
        if (authoredDashInFlight) phraseScale = Math.min(phraseScale, 1.08);
        if (majorVfxBusy()) phraseScale = Math.min(phraseScale, 0.92);
        // Cap the amount of *simulation time* exposed by one render frame. The
        // previous delta cap was applied before playback scaling, so neutral play
        // could still jump 1.72 simulation ticks in a single 30 fps frame.
        const maxTickAdvance = authoredDashInFlight ? 0.78 : majorVfxBusy() ? 0.82 : 1.05;
        let dt = Math.min(frameDelta * phraseScale, maxTickAdvance / DUEL_TPS);
        if (hitStop.current > 0) { hitStop.current = Math.max(0, hitStop.current - delta); dt = 0; }
        if (now >= holdUntil.current) timeScale.current = lerp(timeScale.current, BASE_SCALE, 1 - Math.exp(-7.2 * frameDelta));
        // A savor beat: slow to `scale` and hold it for `holdSec` before easing back.
        const savor = (scale: number, holdSec: number) => { timeScale.current = Math.min(timeScale.current, scale); holdUntil.current = Math.max(holdUntil.current, now + holdSec); };
        advanceClock(maxT, dt);
        const cur = Math.floor(clock.current.t);
        if (cur > lastTick.current) {
            for (const cue of attackDashBeats) {
                if (cue.startTick <= lastTick.current || cue.startTick > cur) continue;
                const launchSnap = snaps[Math.min(maxT, cue.startTick)];
                const contactSnap = snaps[Math.min(maxT, cue.resolveTick)];
                const attacker = findActor(launchSnap, cue.actorId);
                const landing = findActor(contactSnap, cue.actorId);
                const defender = findActor(contactSnap, cue.targetId);
                if (!attacker || !landing || Math.hypot(landing.x - attacker.x, landing.y - attacker.y) < 0.42) continue;
                const dashColor = elementColor(elementById[cue.actorId]).base;
                const style = petHeroMoveStyle({ petName: nameById[cue.actorId], move: cue.move, profile: profileById[cue.actorId] });
                spawnDash({
                    actorId: cue.actorId,
                    fromX: attacker.x,
                    fromZ: attacker.y,
                    toX: landing.x,
                    toZ: landing.y,
                    impactX: cue.outcome === "hit" && defender ? defender.x : landing.x,
                    impactZ: cue.outcome === "hit" && defender ? defender.y : landing.y,
                    color: dashColor,
                    element: cue.element ?? elementById[cue.actorId],
                    move: cue.move,
                    style,
                    impact: cue.outcome === "hit",
                    startTick: cue.startTick,
                    contactTick: cue.resolveTick,
                });
                const ap = duelFieldToFloor(attacker.x, attacker.y);
                const lp = duelFieldToFloor(landing.x, landing.y);
                const fp = cue.outcome === "hit" && defender ? duelFieldToFloor(defender.x, defender.y) : lp;
                // Compose from launch to the defender, not merely launch to the
                // attacker's simulated landing. The latter can stop short of the
                // model's visual contact point and strand the target at the edge.
                camAim.current = [(ap.wx + fp.wx) * 0.46, 1.3, CAM_LOOK[2] + (ap.wz + fp.wz) * 0.24];
                const heroRouteHold = style !== "generic" && /lunar|eclipse|moon|ninetail/i.test(String(cue.move ?? ""));
                // A portrait card freezes simulation time but not the render
                // camera's wall clock. Keep a hero route's wide composition alive
                // through that card so the pet releases into a visible lane rather
                // than emerging from the cut-in already at contact.
                const routeHold = heroRouteHold ? 1.72 : 0.66;
                camAimHold.current = Math.max(camAimHold.current, routeHold);
                // Keep the entire travel lane readable. A close launch shot made the
                // attacker cross the lens faster than the camera could settle, which
                // visually collapsed a real traversal back into a teleport.
                camPosBias.current = [0, 0.32, 1.28];
                camBiasHold.current = Math.max(camBiasHold.current, routeHold);
                shotDolly.current = -2.15;
                shotDollyHold.current = Math.max(shotDollyHold.current, routeHold);
            }
            for (const cue of breatherBeats) {
                if (cue <= lastTick.current || cue > cur) continue;
                const breatherSnap = snaps[Math.min(maxT, cue)];
                const player = breatherSnap?.actors.find((actor) => actor.team === "player" && actor.hp > 0);
                const enemy = breatherSnap?.actors.find((actor) => actor.team === "enemy" && actor.hp > 0);
                if (!player || !enemy) continue;
                const pp = duelFieldToFloor(player.x, player.y);
                const ep = duelFieldToFloor(enemy.x, enemy.y);
                // Dead air becomes a deliberate geography beat: reveal both pets,
                // their new lanes, and the open arena while the stage director owns
                // the repositioning. No extra attack VFX is invented here.
                camAim.current = [(pp.wx + ep.wx) * 0.46, 1.62, CAM_LOOK[2] + (pp.wz + ep.wz) * 0.22];
                camAimHold.current = Math.max(camAimHold.current, 0.82);
                camPosBias.current = [0, 0.78, 1.2];
                camBiasHold.current = Math.max(camBiasHold.current, 0.78);
                shotDolly.current = -1.9;
                shotDollyHold.current = Math.max(shotDollyHold.current, 0.84);
            }
            for (const cue of pressureBeats) {
                if (cue <= lastTick.current || cue > cur) continue;
                if (majorVfxBusy()) continue;
                const pressureSnap = snaps[Math.min(maxT, cue)];
                const player = pressureSnap?.actors.find((actor) => actor.team === "player" && actor.hp > 0);
                const enemy = pressureSnap?.actors.find((actor) => actor.team === "enemy" && actor.hp > 0);
                if (!player || !enemy) continue;
                spawnPressure({
                    fromX: player.x,
                    fromZ: player.y,
                    toX: enemy.x,
                    toZ: enemy.y,
                    leftColor: elementColor(elementById[player.id]).base,
                    rightColor: elementColor(elementById[enemy.id]).base,
                    leftElement: elementById[player.id],
                    rightElement: elementById[enemy.id],
                });
                majorVfxUntilWall.current = Math.max(majorVfxUntilWall.current, performance.now() / 1000 + 1.05);
                pressureCount.current += 1;
                if (pressureCount.current === 1) onCallout("ELEMENTAL CLASH!");
                const pp = duelFieldToFloor(player.x, player.y);
                const ep = duelFieldToFloor(enemy.x, enemy.y);
                camAim.current = [(pp.wx + ep.wx) * 0.46, 1.28, CAM_LOOK[2] + (pp.wz + ep.wz) * 0.22];
                camAimHold.current = Math.max(camAimHold.current, 0.58);
                shotDolly.current = -0.62;
                shotDollyHold.current = Math.max(shotDollyHold.current, 0.56);
                shake.current = Math.max(shake.current, 0.26);
            }
            for (const e of duel.events) {
                if (e.t <= lastTick.current || e.t > cur) continue;
                const snapAt = snaps[Math.min(maxT, e.t)];
                if (e.type === "hit" && e.dmg && e.targetId) {
                    const a = findActor(snapAt, e.targetId);
                    if (a) {
                        const frac = Math.min(1, e.dmg / Math.max(1, a.maxHp));
                        const heavy = !!e.crit || frac > 0.12;
                        const attacker = findActor(snapAt, e.actorId);
                        // A hit that arrives immediately after the same actor crossed
                        // from a farther maneuver pocket is a dash-in combo. Sell the
                        // whole phrase at CONTACT instead of making the traversal and
                        // attack look like unrelated, weightless actions.
                        const dashCombo = !!attacker && duel.events.some((m) => {
                            if (m.type !== "maneuver" || m.actorId !== e.actorId || !m.targetId || m.t >= e.t
                                || e.t - m.t > Math.round(DUEL_TPS * 1.45)) return false;
                            const startSnap = snaps[Math.min(maxT, m.t)];
                            const startActor = findActor(startSnap, m.actorId);
                            const startTarget = findActor(startSnap, m.targetId);
                            if (!startActor || !startTarget) return false;
                            const before = Math.hypot(startTarget.x - startActor.x, startTarget.y - startActor.y);
                            const after = Math.hypot(a.x - attacker.x, a.y - attacker.y);
                            return before - after > 1.15;
                        });
                        const impactHeavy = heavy || dashCombo;
                        // World-space combat bodies use the saturated element base.
                        // The previous pastel `glow` palette was then screen-blended
                        // again, bleaching every hit toward white beside the textured
                        // pets and making distinct elements look like the same VFX.
                        const col = elementColor(e.element).base;
                        const heroStyle = petHeroMoveStyle({ petName: nameById[e.actorId], move: e.move, kind: e.kind, profile: profileById[e.actorId] });
                        const followsUltimate = !!e.move && duel.events.some((u) => u.type === "ultimate" && u.actorId === e.actorId && u.move === e.move && u.t < e.t && e.t - u.t <= Math.round(DUEL_TPS * 2));
                        const authoredDashContact = attackDashBeats.some((cue) => cue.outcome === "hit" && cue.resolveTick === e.t && cue.actorId === e.actorId && cue.targetId === e.targetId);
                        let setPieceOwnsContact = false;
                        let setPieceContactDelayMs = 0;
                        if (attacker && e.move && (followsUltimate || arenaScaleMove(e.move))) {
                            const setPieceKind = duelSetPieceKind(e.element, e.move);
                            const timing = duelSetPieceTiming(setPieceKind);
                            spawnSetPiece({ actorId: attacker.id, targetId: a.id, fromX: attacker.x, fromZ: attacker.y, toX: a.x, toZ: a.y, element: e.element, move: e.move });
                            occupyMajorVfxLane(timing.durationSec);
                            setPieceOwnsContact = true;
                            setPieceContactDelayMs = timing.contactDelayMs;
                        }
                        const longFormOwnsContact = setPieceOwnsContact || authoredDashContact || majorVfxBusy();
                        const heading = attacker ? Math.atan2(a.x - attacker.x, a.y - attacker.y) : (e.actorId.startsWith("enemy") ? -Math.PI / 2 : Math.PI / 2);
                        // Named techniques deserve a larger elemental silhouette even
                        // when their balance damage is modest. This keeps presentation
                        // weight independent from tuning and prevents special moves
                        // looking like recolored basic attacks.
                        const cinematicBurst = impactHeavy || !!e.move;
                        // Contact is followed by a persistent world-space residue.
                        // This supplies the missing payoff after the projectile or
                        // dash disappears: scorched flame tongues, water ripples,
                        // wind curls, lightning shards, or broken earth remain long
                        // enough for the defender's recoil to read against them.
                        const heavyKind = e.kind === "crush" || e.kind === "push";
                        const fxKey = moveFxKey(e.kind);   // themed burst (blood/shadow/poison/spark/ice/…) or "" → element combo
                        // Keep only the authored status glyphs from the legacy sprite
                        // library. Plain elemental contacts are now fully owned by the
                        // toon-shaded 3D burst + residue above. Layering the old white
                        // flipbook combo on top created the large flat orb that hid the
                        // defender and caused the pet/VFX art mismatch.
                        // One visual owns contact. Authored dashes and arena-scale
                        // techniques already include their collision payoff; stacking
                        // a burst, shockwave, sprite, and residue on that same frame was
                        // the main source of the choppy "three VFX in a row" rhythm.
                        if (!longFormOwnsContact) {
                            if (fxKey) spawnFx({ x: a.x, z: a.y, key: fxKey, scale: impactHeavy ? 2.9 : 1.9, dur: impactHeavy ? 540 : 400 });
                            else spawnElementBurst({ x: a.x, z: a.y, element: e.element, move: e.move, color: col, big: cinematicBurst || heroStyle !== "generic", heading, style: heroStyle });
                            if (e.crit) {
                                const aftermath = { x: a.x, z: a.y, element: e.element, move: e.move, color: col, big: cinematicBurst };
                                scheduleDirectorCue(() => spawnAftermath(aftermath), 180);
                            }
                        }
                        // Weapon TRAIL — the swing itself, at the ATTACKER, per archetype
                        // (pierce stab / slash sweep / slam overhead chop / drain rake).
                        // Melee only — a ranged projectile has no melee swing.
                        if (!e.ranged && !longFormOwnsContact) {
                            const att = findActor(snapAt, e.actorId);
                            if (att) spawnTrail({
                                x: att.x,
                                z: att.y,
                                toward: e.actorId.startsWith("enemy") ? -1 : 1,
                                kind: classifyMoveChoreo(e.kind, false, e.element),
                                color: col,
                                weight: impactHeavy ? "heavy" : e.move ? "ability" : "basic",
                                style: heroStyle,
                            });
                        }
                        const contactFeedback = () => {
                            // Sound rides the contact frame (immediate, or delayed with a
                            // set-piece), so the hit/crit lands on the same beat as the
                            // shake + flash. The whole SFX bank already existed; the 3D
                            // duel simply never called it.
                            playPetSfx(e.crit ? "crit" : "hit");
                            spawnNumber({ x: a.x, z: a.y, text: `${e.crit ? "CRIT " : ""}-${e.dmg}`, crit: !!e.crit, heal: false });
                            hitStop.current = Math.max(hitStop.current, Math.min(0.18, 0.045 + frac * 0.5) + (e.crit ? 0.04 : 0) + (heavyKind ? 0.05 : 0) + (dashCombo ? 0.075 : 0));
                            shake.current = Math.max(shake.current, 0.5 + frac * 2.4 + (e.crit ? 0.7 : 0) + (heavyKind ? 0.9 : 0) + (dashCombo ? 1.15 : 0));
                            if (impactHeavy || e.move) {
                                const contactFlash = new THREE.Color(col).lerp(new THREE.Color("#fff4d2"), 0.26).getStyle();
                                const contactFrame = Math.min(0.34, 0.1 + frac * 0.62 + (e.crit ? 0.08 : 0) + (dashCombo ? 0.06 : 0));
                                onFlash(contactFlash, contactFrame);
                                scheduleDirectorCue(() => onFlash(col, Math.min(0.2, 0.035 + frac * 0.34) + (e.crit ? 0.05 : 0)), 62);
                            }
                        };
                        if (setPieceOwnsContact) scheduleDirectorCue(contactFeedback, setPieceContactDelayMs);
                        else contactFeedback();
                        // Reserve the extra ground displacement ring for genuinely
                        // heavy contacts. Basic hits already have a swing trail and
                        // elemental contact volume; a third effect on every hit made
                        // the action stutter visually even when frame time was stable.
                        if (!longFormOwnsContact && impactHeavy) spawnShock({ x: a.x, z: a.y, color: col, big: true });
                        // Dramatic SAVOR — slow the moment so the swing reads; deeper on a
                        // signature, then a crit/heavy slam, then any named ability, then a basic.
                        const isSig = !!e.signature, isAbility = !!e.move;
                        if (isSig) savor(0.48, 0.22);
                        else if (e.crit || heavyKind) savor(0.72, 0.12);
                        else if (authoredDashContact || dashCombo) savor(0.62, 0.22);
                        else if (isAbility || heavy) savor(0.98, 0.04);
                        // Camera ZOOM-PUNCH — every meaningful blow pushes in; abilities/crits/signatures harder.
                        zoomKick.current = Math.max(zoomKick.current, isSig ? 3.2 : e.crit ? 2.8 : dashCombo ? 2.5 : (isAbility || heavy) ? 1.45 : 0.42);
                        // Camera CUT to whoever got hit — the impact reads on the defender.
                        if (impactHeavy || isAbility) {
                            const cp = duelFieldToFloor(a.x, a.y);
                            const ap = attacker ? duelFieldToFloor(attacker.x, attacker.y) : cp;
                            const pairX = (ap.wx + cp.wx) * 0.5;
                            const pairZ = (ap.wz + cp.wz) * 0.5;
                            // Keep both silhouettes in the impact composition. The
                            // old defender-only cut combined with three independent
                            // dolly pushes and routinely cropped the attacker.
                            camAim.current = [lerp(pairX, cp.wx, 0.2) * 0.88, 1.4, CAM_LOOK[2] + lerp(pairZ, cp.wz, 0.2) * 0.46];
                            camAimHold.current = Math.max(camAimHold.current, impactHeavy ? 0.44 : 0.28);
                            // Cut across the line of action to the defender, low and
                            // close. The following stagger event releases to a wider
                            // reaction shot, producing setup -> contact -> recovery
                            // instead of one camera continuously following the pair.
                            const impactSide = cp.wx < 0 ? 1 : -1;
                            camPosBias.current = [impactSide * (impactHeavy ? 0.82 : 0.64), impactHeavy ? -0.82 : -0.58, impactHeavy ? -0.86 : -0.58];
                            camBiasHold.current = Math.max(camBiasHold.current, impactHeavy ? 0.36 : 0.2);
                            shotDolly.current = Math.max(shotDolly.current, impactHeavy ? 1.35 : 0.72);
                            shotDollyHold.current = Math.max(shotDollyHold.current, impactHeavy ? 0.34 : 0.18);
                            if (setPieceOwnsContact) {
                                // Arena-scale VFX need geography, not a defender
                                // close-up. Hold both caster and target around the
                                // complete effect silhouette; the contact flash and
                                // damage number still provide the punch-in read.
                                camAim.current = [pairX * 0.66, 1.48, CAM_LOOK[2] + pairZ * 0.42];
                                camAimHold.current = Math.max(camAimHold.current, 0.72);
                                camPosBias.current = [0, 0.5, 1.25];
                                camBiasHold.current = Math.max(camBiasHold.current, 0.68);
                                shotDolly.current = -1.55;
                                shotDollyHold.current = Math.max(shotDollyHold.current, 0.72);
                                // Establish the full arena-scale silhouette first,
                                // then glide into the defender as the set piece lands.
                                // The old shot stayed wide through contact, so the
                                // cut-in promised a finisher but its payoff felt tiny.
                                scheduleDirectorCue(() => {
                                    camAim.current = [lerp(pairX, cp.wx, 0.34) * 0.9, 1.28, CAM_LOOK[2] + lerp(pairZ, cp.wz, 0.34) * 0.48];
                                    camAimHold.current = Math.max(camAimHold.current, 0.4);
                                    camPosBias.current = [impactSide * 0.92, -0.56, -0.72];
                                    camBiasHold.current = Math.max(camBiasHold.current, 0.38);
                                    shotDolly.current = 1.26;
                                    shotDollyHold.current = Math.max(shotDollyHold.current, 0.36);
                                    zoomKick.current = Math.max(zoomKick.current, 2.35);
                                }, Math.max(0, setPieceContactDelayMs - 45));
                            } else if (authoredDashContact || dashCombo) {
                                // Contact completes the same wide dash composition.
                                // Do not cut to a tight defender close-up while the
                                // attacker is still resolving its authored route.
                                camAim.current = [pairX * 0.9, 1.36, CAM_LOOK[2] + pairZ * 0.46];
                                camAimHold.current = Math.max(camAimHold.current, 0.58);
                                camPosBias.current = [0, 0.32, 1.05];
                                camBiasHold.current = Math.max(camBiasHold.current, 0.54);
                                shotDolly.current = -1.55;
                                shotDollyHold.current = Math.max(shotDollyHold.current, 0.58);
                            }
                        }
                        // A pet's HERO move (its signature, else its strongest jutsu) triggers the
                        // anime freeze-frame CUT-IN (throttled so it stays special); other named
                        // abilities show the smaller banner. (Signatures also cut in via 'ultimate'.)
                        if (e.move && !isSig && now - lastMoveCall.current > 0.4) {
                            lastMoveCall.current = now; onMoveCallout(e.move, e.actorId.startsWith("enemy") ? "enemy" : "player", "attack");
                        }
                        // Combo counter — consecutive hits inside a 1.1s window.
                        comboN.current = now < comboT.current ? comboN.current + 1 : 1;
                        comboT.current = now + 1.1;
                        if (comboN.current >= 2) onCombo(comboN.current);
                        if (e.combo && now - lastElementChain.current > 2.2) {
                            lastElementChain.current = now;
                            onMoveCallout(e.combo, e.actorId.startsWith("enemy") ? "enemy" : "player", "combo");
                            onFlash(col, 0.22);
                        }
                        if (e.crit) onCallout("CRITICAL!");
                        if (e.crit) duelFovKick.current = Math.max(duelFovKick.current, 2);   // small lens snap on crit
                        if (e.crit) spawnScorch({ x: a.x, z: a.y });   // a crit leaves a scorch on the floor
                        if (e.crit) camPosBias.current[1] = -0.9;   // dip to a low hero angle on a crit (R4), eases back
                    }
                } else if (e.type === "heal" && e.dmg && e.targetId) {
                    const a = findActor(snapAt, e.targetId);
                    if (a) {
                        playPetSfx("heal");
                        spawnNumber({ x: a.x, z: a.y, text: `+${e.dmg}`, crit: false, heal: true });
                        // A real 3D restoration column keeps healing in the same visual
                        // language as the models instead of dropping a flat flipbook on them.
                        if (!majorVfxBusy()) spawnSupport({ x: a.x, z: a.y, color: "#8ff7c5", kind: "heal", actorId: a.id });
                    }
                } else if (e.type === "shield" && e.targetId) {
                    // A protective 3D dome and orbit rings make a ward readable from the
                    // arena camera without obscuring the pet silhouette.
                    const a = findActor(snapAt, e.targetId);
                    if (a) {
                        playPetSfx("shield");
                        if (!majorVfxBusy()) {
                            spawnSupport({ x: a.x, z: a.y, color: elementColor(elementById[e.targetId]).glow, kind: "shield", actorId: a.id });
                            onFlash("#bfe3ff", 0.14);
                        }
                    }
                } else if (e.type === "buff" && e.actorId) {
                    // Dedicated Super-Saiyan-style power column. This deliberately
                    // avoids the generic aura/element flipbooks, which looked like
                    // an attack had landed on the pet rather than a self-buff.
                    const c = findActor(snapAt, e.actorId);
                    if (c) playPetSfx("buff");
                    if (c && !majorVfxBusy()) {
                        const el = elementById[e.actorId];
                        // Use the saturated elemental body colour as the aura's
                        // authored ink. Feeding the pale highlight colour into a
                        // translucent shell produced the frosted geometric cage
                        // seen in the preview instead of an elemental power-up.
                        const color = elementColor(el).base;
                        const priorCast = [...duel.events].reverse().find((candidate) => candidate.actorId === e.actorId
                            && candidate.type === "cast" && candidate.move && candidate.t <= e.t
                            && e.t - candidate.t <= Math.round(DUEL_TPS * 1.1));
                        const style = petHeroMoveStyle({ petName: nameById[e.actorId], move: priorCast?.move, kind: priorCast?.kind ?? e.kind, profile: profileById[e.actorId] });
                        spawnPowerUp({ x: c.x, z: c.y, color: style.startsWith("kitsune") ? "#8f62ff" : color, actorId: c.id, style });
                        const buffPos = duelFieldToFloor(c.x, c.y);
                        camAim.current = [buffPos.wx * 1.14, 1.32, CAM_LOOK[2] + buffPos.wz * 0.52];
                        camAimHold.current = Math.max(camAimHold.current, 0.68);
                        camPosBias.current = [buffPos.wx < 0 ? -0.56 : 0.56, -0.34, -0.28];
                        camBiasHold.current = Math.max(camBiasHold.current, 0.62);
                        shotDolly.current = Math.max(shotDolly.current, 0.82);
                        shotDollyHold.current = Math.max(shotDollyHold.current, 0.62);
                        zoomKick.current = Math.max(zoomKick.current, 0.92);
                        savor(1.04, 0.02);
                        onFlash(color, 0.09);
                    }
                } else if (e.type === "windup" && e.actorId) {
                    // Element TELL — a charge ring at the attacker a beat before the blow,
                    // scaled UP for a real (damaging) move so a heavy hit reads as dangerous,
                    // plus a camera CUT + gentle push-in to the attacker ("here it comes").
                    const c = findActor(snapAt, e.actorId);
                    if (c) {
                        const heavyTell = e.kind !== "buff" && e.kind !== "heal" && e.kind !== "shield" && e.kind !== "barrier" && e.kind !== "absorb" && e.kind !== "haste";
                        const opensDashRoute = attackDashBeats.some((cue) => cue.startTick === e.t && cue.actorId === e.actorId && cue.move === e.move);
                        spawnImpact({ x: c.x, z: c.y, color: elementColor(elementById[e.actorId]).glow, big: heavyTell, mode: "tell" });
                        if (heavyTell) { savor(0.9, 0.04); }
                        if (heavyTell && !opensDashRoute) {
                            const p = duelFieldToFloor(c.x, c.y);
                            camAim.current = [p.wx * 0.66, 1.45, CAM_LOOK[2] + p.wz * 0.42];
                            camAimHold.current = Math.max(camAimHold.current, 0.4);
                            // Anticipation shot: favor the attacker's face/silhouette
                            // from its own side of the axis, then cut across the line
                            // only when contact lands. This mirrors the reference's
                            // eye/pose close-up -> committed strike construction.
                            const attackerSide = p.wx < 0 ? -1 : 1;
                            camPosBias.current = [attackerSide * 1.25, -0.78, -0.9];
                            camBiasHold.current = Math.max(camBiasHold.current, 0.34);
                            shotDolly.current = Math.max(shotDolly.current, 1.05);
                            shotDollyHold.current = Math.max(shotDollyHold.current, 0.32);
                        } else if (heavyTell && opensDashRoute) {
                            // Do not overwrite the dash director's wide lane with
                            // the ordinary windup close-up on the same tick. That
                            // close -> wide -> close camera reversal was making
                            // continuous travel look like three position cuts.
                            const launch = duelFieldToFloor(c.x, c.y);
                            const route = attackDashBeats.find((cue) => cue.startTick === e.t && cue.actorId === e.actorId && cue.move === e.move);
                            const landingActor = route ? findActor(snaps[Math.min(maxT, route.resolveTick)], e.actorId) : null;
                            const landing = landingActor ? duelFieldToFloor(landingActor.x, landingActor.y) : launch;
                            camAim.current = [(launch.wx + landing.wx) * 0.46, 1.34, CAM_LOOK[2] + (launch.wz + landing.wz) * 0.23];
                            camAimHold.current = Math.max(camAimHold.current, 0.66);
                            camPosBias.current = [0, 0.38, 1.42];
                            camBiasHold.current = Math.max(camBiasHold.current, 0.66);
                            shotDolly.current = -2.15;
                            shotDollyHold.current = Math.max(shotDollyHold.current, 0.66);
                        }
                    }
                } else if (e.type === "whiff" && e.actorId) {
                    const eventIndex = duel.events.indexOf(e);
                    const namedOpener = precedingNamedMove(duel.events, eventIndex);
                    const attacker = findActor(snapAt, e.actorId);
                    const target = attacker
                        ? snapAt.actors.find((candidate) => candidate.hp > 0 && candidate.team !== attacker.team)
                        : null;
                    const evaded = duel.events.some((candidate) => candidate.type === "dodge"
                        && candidate.side !== e.side && candidate.t <= e.t && e.t - candidate.t <= Math.round(DUEL_TPS * 0.8));
                    if (attacker && target) {
                        const missX = lerp(attacker.x, target.x, 0.86);
                        const missZ = lerp(attacker.y, target.y, 0.86);
                        spawnImpact({ x: missX, z: missZ, color: elementColor(elementById[e.actorId]).base, big: false, mode: "dodge" });
                        const ap = duelFieldToFloor(attacker.x, attacker.y);
                        const tp = duelFieldToFloor(target.x, target.y);
                        camAim.current = [(ap.wx + tp.wx) * 0.46, 1.36, CAM_LOOK[2] + (ap.wz + tp.wz) * 0.22];
                        camAimHold.current = Math.max(camAimHold.current, 0.42);
                        // A miss is about the empty lane between two silhouettes.
                        // Clear any inherited impact close-up and reveal both the
                        // projectile path and the defender's landing point.
                        zoomKick.current = Math.min(zoomKick.current, 0.25);
                        camDollyBias.current = 0;
                        camPosBias.current = [0, 0.35, 1.35];
                        camBiasHold.current = Math.max(camBiasHold.current, 0.44);
                        shotDolly.current = -1.85;
                        shotDollyHold.current = Math.max(shotDollyHold.current, 0.42);
                    }
                    if (namedOpener?.move && now - lastMoveCall.current > 0.35) {
                        lastMoveCall.current = now;
                        onMoveCallout(namedOpener.move, e.actorId.startsWith("enemy") ? "enemy" : "player", "attack");
                    }
                    // The motion and empty contact lane should sell the evade.
                    // Keep the text as a restrained tactical caption instead of a
                    // full-screen verdict that hides the actual body performance.
                    onMoveCallout(evaded ? "Clean Evade" : "Attack Missed", target?.id.startsWith("enemy") ? "enemy" : "player", "maneuver");
                    savor(0.9, 0.06);
                } else if (e.type === "dodge" && e.actorId) {
                    // The model performs the vertical hop; short world-space speed
                    // accents make the evade readable without a floor UI reticle.
                    const d = findActor(snapAt, e.actorId);
                    if (d) {
                        playPetSfx("dodge");
                        spawnDust({ x: d.x, z: d.y });   // foot-dust as the evader lands
                        const evadeColor = elementColor(elementById[e.actorId]).base;
                        spawnImpact({ x: d.x, z: d.y, color: evadeColor, big: false, mode: "dodge" });
                        const dp = duelFieldToFloor(d.x, d.y);
                        const opponent = snapAt.actors.find((candidate) => candidate.hp > 0 && candidate.team !== d.team);
                        const op = opponent ? duelFieldToFloor(opponent.x, opponent.y) : dp;
                        camAim.current = [(dp.wx + op.wx) * 0.46, 1.32, CAM_LOOK[2] + (dp.wz + op.wz) * 0.24];
                        camAimHold.current = Math.max(camAimHold.current, 0.34);
                        zoomKick.current = Math.min(zoomKick.current, 0.2);
                        camDollyBias.current = 0;
                        camPosBias.current = [0, 0.5, 1.55];
                        camBiasHold.current = Math.max(camBiasHold.current, 0.3);
                        shotDolly.current = -2.05; // reveal the launch, empty lane, and landing
                        shotDollyHold.current = Math.max(shotDollyHold.current, 0.34);
                        // The authored dodge state already contains a lateral hop.
                        // Driving another wall-clock route over it made the body pop
                        // out and back, so the real snapshot path now owns the pet.
                    }
                } else if (e.type === "maneuver" && e.kind === "move" && e.move && e.actorId) {
                    // A short elemental range-shift: afterimages carry the motion; no
                    // floor ring is needed because this is not an impact.
                    const runner = findActor(snapAt, e.actorId);
                    if (runner) {
                        const style = petHeroMoveStyle({ petName: nameById[e.actorId], move: e.move, kind: e.kind, profile: profileById[e.actorId] });
                        if (style !== "generic") {
                            const arrivalTick = Math.min(maxT, e.t + Math.round(DUEL_TPS * 0.52));
                            const arrival = findActor(snaps[arrivalTick], e.actorId);
                            if (arrival && Math.hypot(arrival.x - runner.x, arrival.y - runner.y) > 0.35) {
                                spawnDash({
                                    actorId: e.actorId,
                                    fromX: runner.x,
                                    fromZ: runner.y,
                                    toX: arrival.x,
                                    toZ: arrival.y,
                                    color: elementColor(elementById[e.actorId]).base,
                                    element: elementById[e.actorId],
                                    move: e.move,
                                    style,
                                    impact: false,
                                    startTick: e.t,
                                    contactTick: arrivalTick,
                                });
                            }
                        }
                        // A normal range shift is locomotion, not an attack. The old
                        // presentation spawned a second dash for every maneuver and
                        // overlapped the real pre-hit cue, creating purposeless pops.
                        zoomKick.current = Math.max(zoomKick.current, 0.35);
                        // Range changes must be seen in a wide composition. Holding
                        // the previous close-up during a breakaway made purposeful
                        // movement read as a pet simply wandering off-screen.
                        shotDolly.current = -1.35;
                        shotDollyHold.current = Math.max(shotDollyHold.current, 0.3);
                        camAimHold.current = 0;
                        camBiasHold.current = 0;
                        shake.current = Math.max(shake.current, 0.72);
                    }
                    if (now - lastMoveCall.current > 0.4) {
                        lastMoveCall.current = now;
                        onMoveCallout(e.move, e.actorId.startsWith("enemy") ? "enemy" : "player", "maneuver");
                    }
                } else if ((e.type === "cast" || e.type === "ultimate") && e.actorId) {
                    // The UNLEASH at the caster. A status cast wears its themed muzzle glow
                    // (poison gathers GREEN, a stun SPARKS); a support cast gathers a soft AURA
                    // (the heal/shield/buff bloom lands on its target separately); an offensive
                    // cast / ultimate channels the pet's element in a 2-stage bloom.
                    const c = findActor(snapAt, e.actorId);
                    const el = elementById[e.actorId];
                    const supportCast = e.type === "cast" && classifyMoveChoreo(e.kind, true) === "support";
                    const castHeroStyle = petHeroMoveStyle({ petName: nameById[e.actorId], move: e.move, kind: e.kind, profile: profileById[e.actorId] });
                    const powerUpCast = e.type === "cast" && (e.kind === "buff" || e.kind === "haste");
                    const majorLaneWasBusy = majorVfxBusy();
                    const foldedUltimateCast = e.type === "cast" && !!e.move && duel.events.some((ultimate) => ultimate.type === "ultimate" && ultimate.actorId === e.actorId && ultimate.move === e.move && ultimate.t <= e.t && e.t - ultimate.t <= Math.round(DUEL_TPS * 0.65));
                    const eventIndex = duel.events.indexOf(e);
                    const moveOutcome = duelMoveOutcome(duel.events, eventIndex);
                    const plannedHeroCut = heroCutEventByActor[e.actorId] === eventIndex;
                    const ultimateGetsCutIn = plannedHeroCut || duelHeroCutEligible({
                        actorId: e.actorId,
                        eventType: e.type,
                        move: e.move,
                        heroMove: heroMoveById[e.actorId],
                        outcomeKind: moveOutcome.kind,
                        shownActors: heroCutActors.current,
                    });
                    if (c && !foldedUltimateCast) {
                        if (supportCast && !majorLaneWasBusy) {
                            // Buff/haste own the dedicated golden 3D power column in
                            // their `buff` event. The generic cyan support flipbook made
                            // those moves look like an incoming hit and visually doubled
                            // the effect. Heal/shield support casts keep this soft gather.
                            if (!powerUpCast) {
                                if (castHeroStyle === "kitsune-tail-cast") spawnPowerUp({ x: c.x, z: c.y, color: "#8f62ff", actorId: c.id, style: castHeroStyle });
                                else spawnImpact({ x: c.x, z: c.y, color: elementColor(el).base, big: false, mode: "tell" });
                            }
                        } else if (!majorLaneWasBusy) {
                            const castKey = e.type === "ultimate" ? "" : moveFxKey(e.kind);
                            if (castKey) spawnFx({ x: c.x, z: c.y, key: castKey, scale: 1.5, dur: 320 });
                            else spawnImpact({ x: c.x, z: c.y, color: elementColor(el).base, big: e.type === "ultimate", mode: "tell" });
                            if (e.type === "ultimate") {
                                spawnPowerUp({ x: c.x, z: c.y, color: elementColor(el).base, actorId: e.actorId, style: castHeroStyle });
                            }
                        }
                    }
                    if (e.type === "ultimate") {
                        if (ultimateGetsCutIn) {
                            // Each fighter owns one marquee reveal. The UI queues
                            // overlapping cards, so an earlier enemy ultimate can no
                            // longer permanently suppress this actor's showcase beat.
                            heroCutActors.current.add(e.actorId);
                            shake.current = Math.max(shake.current, 1.8);
                            zoomKick.current = Math.max(zoomKick.current, 3.0);
                            onFlash(elementColor(el).glow, 0.42);
                            hitStop.current = Math.max(hitStop.current, 0.18);
                            // Preserve a clean cut -> release -> reaction phrase.
                            // Without this hold the next simulator event could start
                            // before the arena-scale payoff cleared the portrait band.
                            savor(0.14, 0.48);
                            onCutIn(e.actorId, e.move ?? ultById[e.actorId] ?? "");  // anime portrait cut-in
                            if (c) {
                                const p = duelFieldToFloor(c.x, c.y);
                                camAim.current = [p.wx * 0.58, 1.35, CAM_LOOK[2] + p.wz * 0.42];
                                camAimHold.current = Math.max(camAimHold.current, 0.62);
                                camPosBias.current = [p.wx < 0 ? -1.05 : 1.05, -0.82, -0.78];
                                camBiasHold.current = Math.max(camBiasHold.current, 0.48);
                                shotDolly.current = Math.max(shotDolly.current, 1.45);
                                shotDollyHold.current = Math.max(shotDollyHold.current, 0.58);
                            }
                            onAnnounce(`${nameById[e.actorId] ?? "A challenger"} unleashes ${ultById[e.actorId] ?? "their ultimate"}!`, "ultimate");
                        } else if (!majorLaneWasBusy) {
                            // A quick REPEAT unleash — lighter beat, no cut-in / heavy shake.
                            shake.current = Math.max(shake.current, 0.6);
                            onFlash(elementColor(el).glow, 0.18);
                            savor(0.72, 0.08);
                        }
                    } else if (e.type === "cast" && e.move && !foldedUltimateCast && now - lastMoveCall.current > 0.4) {
                        const heroC = heroMoveById[e.actorId];
                        if (plannedHeroCut || duelHeroCutEligible({ actorId: e.actorId, eventType: e.type, move: e.move, heroMove: heroC, outcomeKind: moveOutcome.kind, shownActors: heroCutActors.current })) {
                            // A ranged / support HERO move → the anime cut-in freeze-frame.
                            heroCutActors.current.add(e.actorId); lastMoveCall.current = now;
                            hitStop.current = Math.max(hitStop.current, 0.12); savor(0.14, 0.48);
                            shake.current = Math.max(shake.current, 1.4); zoomKick.current = Math.max(zoomKick.current, 2.8);
                            onFlash(elementColor(elementById[e.actorId]).glow, 0.38); onCutIn(e.actorId, e.move);
                        } else {
                            // A lesser named ability — the smaller banner + a short savor beat.
                            lastMoveCall.current = now;
                            onMoveCallout(e.move, e.actorId.startsWith("enemy") ? "enemy" : "player", supportCast ? "support" : "attack");
                            savor(supportCast ? 1.08 : 1.02, 0.035);
                        }
                    }
                } else if (e.type === "ko") {
                    // KO finisher: a big element blast on the victim + a hard freeze → deep
                    // slow-mo → camera PULL-BACK reveal. A knockout decides the fight.
                    // The terminal ko event carries no
                    // actorId, so find the downed fighter from the snapshot (this also fixes
                    // the final KO previously showing no blast / no "is down!" line).
                    const dead = e.actorId ? findActor(snapAt, e.actorId) : (snapAt.actors.find((ac) => ac.hp <= 0) ?? null);
                    if (dead) {
                        // The resolving hit already owns the elemental contact.
                        // Do not stack the old expanding cylinder/ring on the KO;
                        // it hid the falling model inside an abstract translucent
                        // dome and made the finisher appear to land twice.
                        // Frame the winner and the fallen pet together. The previous
                        // single-target aim pushed the loser off-screen and made the
                        // victory pose feel disconnected from the finishing blow.
                        spawnScorch({ x: dead.x, z: dead.y, big: true });   // the fallen fighter leaves a big scorch
                        spawnDust({ x: dead.x, z: dead.y });
                        const fallen = duelFieldToFloor(dead.x, dead.y);
                        const survivor = snapAt.actors.find((actor) => actor.hp > 0 && actor.id !== dead.id);
                        const standing = survivor ? duelFieldToFloor(survivor.x, survivor.y) : fallen;
                        const pairX = (fallen.wx + standing.wx) * 0.5;
                        const pairZ = (fallen.wz + standing.wz) * 0.5;
                        camAim.current = [pairX * 0.62, 1.08, CAM_LOOK[2] + pairZ * 0.46];
                        camAimHold.current = Math.max(camAimHold.current, 1.15);
                    }
                    shake.current = Math.max(shake.current, 3.0);
                    hitStop.current = Math.max(hitStop.current, 0.34);
                    savor(0.44, 0.62);
                    koPull.current = 3.4;
                    duelFovKick.current = Math.max(duelFovKick.current, 3.5);   // stronger lens snap on the finish
                    shotDolly.current = -2.2;
                    shotDollyHold.current = Math.max(shotDollyHold.current, 0.82);
                    camPosBias.current[1] = 2.4;
                    playPetSfx("ko");
                    onFlash("#fff7e6", 0.5);
                    onCallout("FINISH!");
                    if (dead) onAnnounce(`${nameById[dead.id] ?? "A fighter"} is eliminated!`, "ko");
                } else if (e.type === "stagger" && e.actorId) {
                    // A recoil puff where a fighter got knocked out of its wind-up.
                    const c = findActor(snapAt, e.actorId);
                    if (c) {
                        spawnImpact({ x: c.x, z: c.y, color: "#fca5a5", big: false });
                        const reaction = duelFieldToFloor(c.x, c.y);
                        // Let the white contact frame land, then reveal the knockback
                        // and recovery pose. The small delay is presentation-only and
                        // matches the reference's impact flash -> reaction cut.
                        window.setTimeout(() => {
                            camAim.current = [reaction.wx * 0.58, 1.25, CAM_LOOK[2] + reaction.wz * 0.42];
                            camAimHold.current = Math.max(camAimHold.current, 0.34);
                            camPosBias.current = [reaction.wx < 0 ? 1.15 : -1.15, 0.2, 0.85];
                            camBiasHold.current = Math.max(camBiasHold.current, 0.3);
                            shotDolly.current = -0.7;
                            shotDollyHold.current = Math.max(shotDollyHold.current, 0.32);
                        }, 145);
                    }
                }
            }
            // ── Play-by-play momentum (render-only; reads the deterministic
            // stream). Commentary fires on narrative beats only: a fighter dropping
            // to the ropes, and the HP lead SWAPPING (a reversal / comeback).
            const snapNow = snaps[Math.min(maxT, cur)];
            if (snapNow) {
                let pHp = 0, pMax = 0, eHp = 0, eMax = 0;
                for (const ac of snapNow.actors) {
                    if (ac.team === "player") { pHp += ac.hp; pMax += ac.maxHp; } else { eHp += ac.hp; eMax += ac.maxHp; }
                    const frac = ac.hp / Math.max(1, ac.maxHp);
                    if (ac.hp > 0 && frac < 0.26 && !lowHp.current.has(ac.id)) {
                        lowHp.current.add(ac.id);
                        onAnnounce(`${nameById[ac.id] ?? "A fighter"} is on the ropes!`, "danger");
                    } else if (frac > 0.5 && lowHp.current.has(ac.id)) {
                        lowHp.current.delete(ac.id);   // healed back up — re-arm the call
                    }
                }
                const pFrac = pHp / Math.max(1, pMax), eFrac = eHp / Math.max(1, eMax);
                const lead = pFrac - eFrac > 0.14 ? "player" : eFrac - pFrac > 0.14 ? "enemy" : "even";
                if (lead !== "even" && leadSide.current !== "even" && lead !== leadSide.current && now - lastReversal.current > 3) {
                    lastReversal.current = now;
                    const who = nameById[lead === "player" ? "player-0" : "enemy-0"] ?? "The underdog";
                    onAnnounce(`Reversal — ${who} storms back!`, "reversal");
                }
                if (lead !== "even") leadSide.current = lead;
            }
            lastTick.current = cur;
        }
        // Perspective hero camera: adaptive framing of the LIVING leads (tighter when
        // they plant close, wider when spread) + per-frame RE-AIM (cuts ease back to the
        // live midpoint) + decaying shake, zoom-punch, and KO pull-back. All render-only.
        const a = shake.current; shake.current *= 0.85;
        const sx = a > 0.01 ? Math.sin(now * 53) * a * 0.1 : 0;
        const sy = a > 0.01 ? Math.sin(now * 61) * a * 0.06 : 0;
        const zk = zoomKick.current; zoomKick.current *= 0.86;
        duelFovKick.current = duelFovKick.current > 0.01 ? duelFovKick.current * 0.86 : 0;   // decay the shared FOV punch (ResponsiveCamera applies it)
        koPull.current = lerp(koPull.current, 0, 0.025);
        // Live framing target from the fighters still standing (midpoint + x spread).
        const camTick = Math.max(0, Math.min(maxT, clock.current.t));
        const camI0 = Math.floor(camTick);
        const camI1 = Math.min(maxT, camI0 + 1);
        const camF = camTick - camI0;
        const camSnap = snaps[camI0];
        const camNext = snaps[camI1] ?? camSnap;
        let cmx = 0, cmz = 0, cn = 0, xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
        const terminalFraming = clock.current.t >= maxT - Math.round(DUEL_TPS * 0.45);
        if (camSnap) for (const ac of camSnap.actors) {
            const nextActor = findActor(camNext, ac.id) ?? ac;
            if (ac.hp <= 0 && nextActor.hp <= 0 && !terminalFraming) continue;
            const p = duelFieldToFloor(lerp(ac.x, nextActor.x, camF), lerp(ac.y, nextActor.y, camF));
            cmx += p.wx; cmz += p.wz; cn++;
            if (p.wx < xmin) xmin = p.wx;
            if (p.wx > xmax) xmax = p.wx;
            if (p.wz < zmin) zmin = p.wz;
            if (p.wz > zmax) zmax = p.wz;
        }
        const midX = cn > 0 ? cmx / cn : 0;
        const midZ = cn > 0 ? cmz / cn : DUEL_FLOOR_Z0;
        // Depth separation matters just as much as left/right separation now that
        // the tactical camera exposes the entire floor instead of flattening it.
        const spread = cn > 1 ? Math.max(xmax - xmin, (zmax - zmin) * 1.35) : 4;
        // Neutral look eases to the live midpoint; a cut HOLDS its own aim until camAimHold decays.
        if (camAimHold.current > 0) camAimHold.current = Math.max(0, camAimHold.current - delta);
        else {
            camAim.current[0] = midX * 0.7;
            camAim.current[1] = DUEL_LOOK_Y;
            camAim.current[2] = CAM_LOOK[2] + midZ * 0.5;
        }
        const lookResponse = camAimHold.current > 0 ? 11.5 : 6.5;
        const lookAlpha = 1 - Math.exp(-lookResponse * Math.min(delta, 1 / 15));
        camLook.current[0] = lerp(camLook.current[0], camAim.current[0], lookAlpha);
        camLook.current[1] = lerp(camLook.current[1], camAim.current[1], lookAlpha);
        camLook.current[2] = lerp(camLook.current[2], camAim.current[2], lookAlpha);
        // Adaptive dolly: pull back to fit the current spread, eased slowly (a gentle
        // breathing zoom, never jitter). Clamped so it never crops or over-tightens.
        // Ordinary exchanges stay close enough to read eyes, paws and recoil.
        // Wide geography still pulls back, but no longer leaves two small pets in
        // a mostly empty stadium during every neutral beat.
        let dollyTarget = Math.max(11.7, Math.min(15.2, 10.0 + spread * 0.8));
        // Opening: pull WIDE for the size-up, then punch in as the pets charge to the face-off,
        // and give a "lock-in" shake the instant they arrive.
        const dollyIntro = clock.current.intro ?? 999;
        if (dollyIntro < INTRO_TOTAL) dollyTarget = lerp(dollyTarget, INTRO_WIDE_DOLLY, introWideHold(dollyIntro));
        else if (dollyIntro < 900 && !introLocked.current) { introLocked.current = true; shake.current = Math.max(shake.current, 1.4); }
        camDolly.current = lerp(camDolly.current, dollyTarget, dollyIntro < INTRO_TOTAL ? 0.1 : 0.03);
        const db = camDollyBias.current; camDollyBias.current *= 0.9;
        if (shotDollyHold.current > 0) shotDollyHold.current = Math.max(0, shotDollyHold.current - delta);
        else shotDolly.current = lerp(shotDolly.current, 0, 0.075);
        const heldShotDolly = shotDolly.current;
        // Ease the transient angle bias (crit low / KO overhead) back to neutral so it reads as
        // a deliberate camera MOVE, not a teleport (R4 — angle variety).
        const pb = camPosBias.current;
        if (camBiasHold.current > 0) camBiasHold.current = Math.max(0, camBiasHold.current - delta);
        else { pb[0] = lerp(pb[0], 0, 0.045); pb[1] = lerp(pb[1], 0, 0.045); pb[2] = lerp(pb[2], 0, 0.045); }
        // A portrait canvas has less than half the horizontal field of the desktop
        // shot. Preserve the camera pitch while pulling the physical camera back;
        // relying on FOV alone produced severe fisheye and still cropped the pets.
        const viewportAspect = size.width / Math.max(1, size.height);
        const portraitPull = viewportAspect < 0.8 ? (0.8 - viewportAspect) * 27 : 0;
        const portraitCutScale = viewportAspect < 0.8 ? 0.32 : 1;
        // A hit can set zoomKick, shotDolly, camDollyBias and a positional Z bias
        // on the same frame. Treat them as one authored camera move and clamp the
        // result, otherwise the combined push crops a fighter and the giant VFX.
        const requestedCinematicZ = -(zk + db + heldShotDolly) + pb[2];
        const maxPushIn = viewportAspect < 0.8 ? 0.52 : 0.88;
        const maxPullBack = viewportAspect < 0.8 ? 1.9 : 4.2;
        const safeCinematicZ = THREE.MathUtils.clamp(requestedCinematicZ, -maxPushIn, maxPullBack);
        const desiredEye: [number, number, number] = [
            CAM_POS[0] + midX * 0.24 + pb[0] * portraitCutScale,
            // Portrait needs horizontal room much more than extra elevation. Pull
            // mostly backward so both silhouettes and their Html nameplates stay
            // inside the narrow frame without turning the arena into a fisheye view.
            DUEL_CAMERA_Y + pb[1] * portraitCutScale + portraitPull * 0.42,
            camDolly.current + safeCinematicZ * portraitCutScale + koPull.current + portraitPull * 1.38,
        ];
        const eyeResponse = (camBiasHold.current > 0 || shotDollyHold.current > 0) ? 10.5 : 6.2;
        const eyeAlpha = 1 - Math.exp(-eyeResponse * Math.min(delta, 1 / 15));
        camEye.current[0] = lerp(camEye.current[0], desiredEye[0], eyeAlpha);
        camEye.current[1] = lerp(camEye.current[1], desiredEye[1], eyeAlpha);
        camEye.current[2] = lerp(camEye.current[2], desiredEye[2], eyeAlpha);
        camera.position.set(camEye.current[0] + sx, camEye.current[1] + sy, camEye.current[2]);
        camera.lookAt(camLook.current[0], camLook.current[1], camLook.current[2]);
        if (!ended.current && clock.current.t >= maxT) {
            if (!endHold.current) endHold.current = now + 1.95;
            else if (now >= endHold.current) { ended.current = true; onEnd(); }
        }
    });
    return null;
}

/** Element-colored impact burst — an expanding additive ring + flash core. */
function DuelImpact({ at, color, big, mode = "impact", onDone }: { at: Vec3; color: string; big: boolean; mode?: DuelImpactMode; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const core = useRef<THREE.Mesh>(null);
    const coreMat = useRef<THREE.MeshToonMaterial>(null);
    const haloMat = useRef<THREE.MeshBasicMaterial>(null);
    const ringOne = useRef<THREE.MeshBasicMaterial>(null);
    const ringTwo = useRef<THREE.MeshBasicMaterial>(null);
    const slashMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const start = useRef<number | null>(null);
    const duration = mode === "tell" ? 0.46 : mode === "dodge" ? 0.3 : big ? 0.56 : 0.38;
    const contactCore = useMemo(() => new THREE.Color(color).lerp(new THREE.Color("#fff1b8"), 0.08).getStyle(), [color]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / duration);
        const rise = 1 - Math.pow(1 - p, 2);
        const fade = 1 - p;
        if (root.current) {
            const scale = mode === "tell" ? 0.46 + rise * (big ? 1.08 : 0.72) : mode === "dodge" ? 0.28 + rise * 0.52 : 0.34 + rise * (big ? 2.18 : 1.28);
            root.current.scale.setScalar(scale);
            root.current.rotation.y = p * (mode === "dodge" ? -1.35 : 1.9);
        }
        if (core.current) {
            core.current.rotation.x = p * 4.2;
            core.current.rotation.y = p * 5.6;
            core.current.scale.setScalar(mode === "impact" ? 0.42 + (1 - Math.abs(p - 0.33) * 2) * (big ? 0.46 : 0.32) : 0.42 + rise * 0.2);
        }
        if (coreMat.current) coreMat.current.opacity = mode === "impact" ? Math.max(0, (1 - p * 1.42)) * 0.5 : fade * 0.2;
        if (haloMat.current) haloMat.current.opacity = fade * (mode === "impact" ? 0.48 : 0.32);
        if (ringOne.current) ringOne.current.opacity = fade * (mode === "tell" ? 0.36 : 0.3);
        if (ringTwo.current) ringTwo.current.opacity = Math.max(0, fade - 0.16) * (mode === "dodge" ? 0.38 : 0.2);
        slashMats.current.forEach((material, index) => {
            if (!material) return;
            const contact = Math.max(0, 1 - p * (index === 1 ? 2.9 : 2.35));
            material.opacity = contact * (big ? 0.94 : 0.76) * (index === 2 ? 0.72 : 1);
        });
        if (p >= 1) onDone();
    });
    const floorOnly = mode !== "impact";
    return (
        <group ref={root} position={at}>
            {floorOnly ? (
                <group>
                    <mesh position={mode === "dodge" ? [-0.46, 0.22, 0.08] : [-0.34, 0.38, 0.12]} rotation={[0, 0, mode === "dodge" ? -1.08 : -0.16]} scale={[1, mode === "dodge" ? 1.45 : 1, 1]}>
                        <coneGeometry args={[0.05, 0.74, 5]} />
                        <meshBasicMaterial ref={ringOne} color={color} transparent opacity={0.38} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                    <mesh position={mode === "dodge" ? [0.4, 0.34, -0.08] : [0.36, 0.48, -0.12]} rotation={[0, 0, mode === "dodge" ? 1.02 : 0.14]} scale={[0.78, mode === "dodge" ? 1.3 : 0.82, 0.78]}>
                        <coneGeometry args={[0.045, 0.68, 5]} />
                        <meshBasicMaterial ref={ringTwo} color={mode === "dodge" ? "#dff9ff" : color} transparent opacity={0.28} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                </group>
            ) : (
                <>
                    <mesh ref={core} position={[0, 0.12, 0]}>
                        <icosahedronGeometry args={[0.28, 1]} />
                        <meshToonMaterial ref={coreMat} color={contactCore} emissive={color} emissiveIntensity={0.34} transparent opacity={0.88} depthWrite={false} />
                    </mesh>
                    {/* Graphic contact frame: three camera-facing saber streaks
                        form the asymmetric white X seen in strong hand-drawn hits.
                        It exists for only the first few frames; the colored 3D
                        element burst then supplies mass and dissipation. */}
                    <Billboard position={[0, 0.12, 0.05]}>
                        {[0.7, -0.72, 0.04].map((rotation, index) => (
                            <mesh key={`contact-slash-${index}`} rotation={[0, 0, rotation]} scale={index === 2 ? [0.76, 1, 1] : [1, 1, 1]}>
                                <planeGeometry args={[big ? 3.55 : 2.15, big ? 0.15 : 0.095]} />
                                <meshBasicMaterial
                                    ref={(material) => { slashMats.current[index] = material; }}
                                    color={index === 2 ? color : contactCore}
                                    transparent
                                    opacity={0.9}
                                    depthWrite={false}
                                    toneMapped={false}
                                    blending={THREE.AdditiveBlending}
                                />
                            </mesh>
                        ))}
                    </Billboard>
                    <mesh position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
                        <torusGeometry args={[0.5, 0.032, 6, 24]} />
                        <meshBasicMaterial ref={haloMat} color={color} transparent opacity={0.7} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                </>
            )}
        </group>
    );
}

/** Element contact rendered as layered, beveled anime brushwork. Every element
 * has its own silhouette while the shared dark/body/highlight stack matches the
 * outlined, sculpted pet materials. Rings, spheres, and crystals are secondary. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelElementBurst({ at, kind, color, big, heading, onDone }: { at: Vec3; kind: DuelElementBurstKind; color: string; big: boolean; heading: number; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const pieces = useRef<Array<THREE.Group | null>>([]);
    const materials = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const palette = useMemo(() => duelFxPalette(kind, color), [kind, color]);
    const specs = useMemo(() => {
        const count = big ? 4 : 3;
        return Array.from({ length: count }, (_, i) => {
            const lane = i - (count - 1) * 0.5;
            const fireLike = kind === "fire" || kind === "abyss";
            return {
                lane,
                length: (big ? 1.34 : 1.0) * (0.82 + (i % 3) * 0.11),
                width: (big ? 0.25 : 0.19) * (0.88 + (i % 2) * 0.16),
                curl: fireLike ? 0.44 + (i % 3) * 0.12 : kind === "water" ? 0.66 + (i % 2) * 0.18 : kind === "wind" ? 0.3 : kind === "earth" ? 0.12 : 0.2,
                jagged: kind === "lightning" ? 0.2 : kind === "earth" ? 0.075 : 0,
                lift: 0.34 + (i % 3) * 0.28 + Math.abs(lane) * 0.05,
                roll: (-0.68 + i * (1.36 / Math.max(1, count - 1))) + (fireLike ? lane * 0.07 : 0),
                yaw: lane * (kind === "water" ? 0.16 : 0.11),
            };
        });
    }, [big, kind]);
    const geometries = useMemo(() => specs.map((spec) => makeAnimeStrokeGeometry(spec.length, spec.width, spec.curl, spec.jagged)), [specs]);
    useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
    const duration = big ? 0.82 : 0.62;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / duration);
        const open = 1 - Math.pow(1 - Math.min(1, p / 0.34), 3);
        const settle = Math.sin(Math.PI * Math.min(1, p / 0.72));
        const fade = p < 0.68 ? 1 : Math.max(0, 1 - (p - 0.68) / 0.32);
        if (root.current) {
            root.current.rotation.y = heading;
            root.current.scale.setScalar((big ? 0.92 : 0.74) * (0.3 + open * 0.82));
        }
        pieces.current.forEach((piece, i) => {
            if (!piece) return;
            const spec = specs[i];
            piece.position.set(open * (0.18 + i % 2 * 0.12), spec.lift + settle * (0.12 + i % 3 * 0.05), spec.lane * (big ? 0.25 : 0.19) * open);
            piece.rotation.set(kind === "water" ? -0.08 : lanePitch(kind, i), spec.yaw, spec.roll);
        });
        materials.current.forEach((material) => {
            if (material) material.opacity = Number(material.userData.baseOpacity ?? 1) * fade;
        });
        if (light.current) light.current.intensity = fade * settle * (big ? 4.2 : 2.3);
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });
    return (
        <group ref={root} position={[at[0], at[1] + 0.06, at[2]]} scale={0.01}>
            {specs.map((spec, i) => (
                <group key={`anime-strike-${i}`} ref={(group) => { pieces.current[i] = group; }}>
                    <mesh geometry={geometries[i]} position={[0, 0, -0.025]} scale={[1.035, 1.035, 1.06]}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.24; materials.current[i * 3] = material; } }} color={palette.dark} transparent opacity={0.24} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={geometries[i]}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.94; materials.current[i * 3 + 1] = material; } }} color={i % 3 === 0 ? palette.accent : palette.body} emissive={palette.accent} emissiveIntensity={0.08} transparent opacity={0.94} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={geometries[i]} position={[spec.length * 0.14, spec.width * 0.08, 0.07]} scale={[0.66, 0.34, 0.7]}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.84; materials.current[i * 3 + 2] = material; } }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.12} transparent opacity={0.84} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            ))}
            {kind === "earth" && Array.from({ length: big ? 7 : 4 }, (_, i) => (
                <mesh key={`earth-chip-${i}`} position={[0.15 + (i % 2) * 0.25, 0.22 + (i % 3) * 0.24, (i - 2) * 0.24]} rotation={[i * 0.7, i * 0.9, i * 0.44]} scale={[0.16, 0.28, 0.18]}>
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshToonMaterial color={i % 2 ? palette.body : palette.accent} />
                </mesh>
            ))}
            <Sparkles count={big ? 14 : 8} scale={big ? [3.8, 2.8, 3.4] : [2.6, 1.9, 2.4]} size={big ? 1.8 : 1.35} speed={2.2} opacity={0.4} color={palette.core} noise={1.25} />
            <pointLight ref={light} color={palette.accent} intensity={0} distance={big ? 7.5 : 4.8} decay={2} />
        </group>
    );
}

function lanePitch(kind: DuelElementBurstKind, index: number): number {
    if (kind === "water") return -0.08;
    if (kind === "wind") return (index % 2 ? 1 : -1) * 0.12;
    if (kind === "earth") return 0.1 + (index % 3) * 0.09;
    return (index % 2 ? 1 : -1) * 0.06;
}

/** The consequence after contact. Immediate flashes sell the exact hit frame;
 * this lower, toon-shaded residue stays underneath the defender's recoil so the
 * viewer sees that the launched ability actually changed the space it struck. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelElementAftermath({ at, kind, color, big, onDone }: { at: Vec3; kind: DuelElementBurstKind; color: string; big: boolean; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const pieces = useRef<Array<THREE.Mesh | null>>([]);
    const materials = useRef<Array<THREE.Material & { opacity: number }>>([]);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const count = big ? 9 : 6;
    const flames = useMemo(() => kind === "fire" || kind === "abyss"
        ? Array.from({ length: count }, (_, i) => makeFlameRibbonGeometry(0.58 + (i % 3) * 0.16, 0.11 + (i % 2) * 0.025, 0.18 + (i % 3) * 0.07, i * 0.83))
        : [], [kind, count]);
    useEffect(() => () => flames.forEach((geometry) => geometry.dispose()), [flames]);
    const palette = kind === "fire"
        ? { body: "#d93616", accent: "#ff9418", core: "#ffe895", dark: "#45140c" }
        : kind === "water"
            ? { body: "#0877bd", accent: "#35cae6", core: "#d8fbff", dark: "#062f5d" }
            : kind === "wind"
                ? { body: "#14796f", accent: "#54d8bd", core: "#dcfff5", dark: "#083f43" }
                : kind === "lightning"
                    ? { body: "#6244cb", accent: "#c5a9ff", core: "#fff4a8", dark: "#211549" }
                    : kind === "earth"
                        ? { body: "#754321", accent: "#d39a45", core: "#ffe0a1", dark: "#301b11" }
                        : kind === "abyss"
                            ? { body: "#481036", accent: "#e42250", core: "#ffb092", dark: "#16091f" }
                            : { body: color, accent: "#bb9cff", core: "#fff1d4", dark: "#241538" };
    const register = (material: (THREE.Material & { opacity: number }) | null) => {
        if (!material || materials.current.includes(material)) return;
        material.userData.baseOpacity = material.opacity;
        materials.current.push(material);
    };
    const duration = big ? 1.48 : 1.08;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / duration);
        const arrive = 1 - Math.pow(1 - Math.min(1, p / 0.18), 3);
        const fade = p < 0.58 ? 1 : Math.max(0, 1 - (p - 0.58) / 0.42);
        if (root.current) {
            root.current.scale.setScalar((big ? 1.62 : 1.14) * (0.72 + arrive * 0.34));
            root.current.rotation.y = elapsed * (kind === "wind" ? 0.72 : kind === "water" ? 0.22 : 0.08);
        }
        pieces.current.forEach((piece, i) => {
            if (!piece) return;
            piece.rotation.y += (kind === "wind" ? 0.045 : 0.014) * (i % 2 ? -1 : 1);
            piece.position.y = 0.05 + Math.sin(elapsed * (5 + i % 3) + i) * (kind === "water" || kind === "wind" ? 0.045 : 0.018);
        });
        for (const material of materials.current) material.opacity = Number(material.userData.baseOpacity ?? 0.6) * fade;
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });
    return (
        <group ref={root} position={[at[0], FLOOR_Y + 0.04, at[2]]}>
            {/* Dark normal-blended footing anchors the saturated toon pieces to the
                arena instead of making them look like unrelated glowing UI. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[big ? 1.28 : 0.92, 48]} />
                <meshBasicMaterial ref={register} color={palette.dark} transparent opacity={0.34} depthWrite={false} blending={THREE.NormalBlending} />
            </mesh>
            {[0, 1].map((i) => (
                <mesh key={`aftermath-ring-${i}`} position={[0, 0.018 + i * 0.012, 0]} rotation={[Math.PI / 2, i * 0.6, 0]} scale={1 + i * 0.28}>
                    <torusGeometry args={[0.62, i === 0 ? 0.055 : 0.025, 7, 40, Math.PI * (i === 0 ? 1.55 : 1.2)]} />
                    <meshToonMaterial ref={register} color={i === 0 ? palette.body : palette.core} emissive={palette.accent} emissiveIntensity={0.12} transparent opacity={i === 0 ? 0.72 : 0.46} depthWrite={false} />
                </mesh>
            ))}
            {Array.from({ length: count }, (_, i) => {
                const a = (i / count) * Math.PI * 2 + (i % 2) * 0.18;
                const radius = 0.42 + (i % 3) * 0.2;
                const common = {
                    ref: (mesh: THREE.Mesh | null) => { pieces.current[i] = mesh; },
                    position: [Math.cos(a) * radius, 0.05, Math.sin(a) * radius] as [number, number, number],
                    rotation: [0, -a, (i % 2 ? -1 : 1) * 0.22] as [number, number, number],
                };
                if (kind === "fire" || kind === "abyss") return (
                    <mesh key={`aftermath-piece-${i}`} {...common} geometry={flames[i]} scale={0.78 + (i % 3) * 0.12}>
                        <meshToonMaterial ref={register} color={i % 3 === 0 ? palette.accent : palette.body} emissive={palette.accent} emissiveIntensity={0.18} transparent opacity={0.84} depthWrite={false} />
                    </mesh>
                );
                if (kind === "water") return (
                    <mesh key={`aftermath-piece-${i}`} {...common} rotation={[Math.PI / 2, a, 0]} scale={[0.72 + (i % 2) * 0.2, 0.72, 0.42]}>
                        <torusGeometry args={[0.34, 0.07, 7, 24, Math.PI * 1.25]} />
                        <meshToonMaterial ref={register} color={i % 3 === 0 ? palette.core : palette.body} emissive={palette.accent} emissiveIntensity={0.14} transparent opacity={0.8} depthWrite={false} />
                    </mesh>
                );
                if (kind === "wind") return (
                    <mesh key={`aftermath-piece-${i}`} {...common} rotation={[Math.PI / 2, a, i * 0.31]} scale={0.72 + (i % 3) * 0.12}>
                        <torusGeometry args={[0.42, 0.055, 7, 26, Math.PI * 1.1]} />
                        <meshToonMaterial ref={register} color={i % 3 === 0 ? palette.core : palette.body} emissive={palette.accent} emissiveIntensity={0.14} transparent opacity={0.76} depthWrite={false} />
                    </mesh>
                );
                if (kind === "earth") return (
                    <mesh key={`aftermath-piece-${i}`} {...common} rotation={[i * 0.47, a, i * 0.31]} scale={[0.24, 0.38 + (i % 3) * 0.09, 0.24]}>
                        <dodecahedronGeometry args={[1, 0]} />
                        <meshToonMaterial ref={register} color={i % 3 === 0 ? palette.accent : palette.body} emissive={palette.dark} emissiveIntensity={0.08} transparent opacity={0.92} depthWrite={false} />
                    </mesh>
                );
                return (
                    <mesh key={`aftermath-piece-${i}`} {...common} rotation={[i * 0.38, a, i * 0.62]} scale={[0.15, 0.42 + (i % 3) * 0.12, 0.15]}>
                        <octahedronGeometry args={[1, 0]} />
                        <meshToonMaterial ref={register} color={i % 3 === 0 ? palette.core : palette.body} emissive={palette.accent} emissiveIntensity={0.24} transparent opacity={0.88} depthWrite={false} />
                    </mesh>
                );
            })}
            <Sparkles count={big ? 24 : 13} scale={big ? [3.8, 1.8, 3.8] : [2.8, 1.2, 2.8]} position={[0, 0.58, 0]} size={big ? 2.1 : 1.6} speed={0.9} opacity={0.46} color={palette.core} noise={1.25} />
        </group>
    );
}

type DuelElementVolumePhase = "contact" | "aftermath" | "signature" | "dash";

const ELEMENT_VOLUME_CURVE_CACHE = new Map<string, readonly THREE.TubeGeometry[]>();
const HERO_MOVE_STROKE_CACHE = new Map<string, readonly THREE.ExtrudeGeometry[]>();

function duelElementCurveCount(kind: DuelElementBurstKind, phase: DuelElementVolumePhase, big: boolean, quality: PetVisualQuality): number {
    const signature = phase === "signature";
    const low = quality === "low";
    const medium = quality === "medium";
    if (kind === "earth") return 0;
    if (kind === "water" && !signature) return low ? 2 : big ? 4 : 3;
    if (low) return signature ? 5 : 2;
    if (medium) return signature ? 7 : big ? 5 : 3;
    return signature ? 10 : big ? 7 : 5;
}

/** Curved, round-section elemental motion. These tubes catch the same arena
 * lighting as the pet models, so an ability reads as an object occupying the
 * scene instead of a flat decal composited in front of it. */
function makeElementVolumeCurve(kind: DuelElementBurstKind, index: number, phase: DuelElementVolumePhase): THREE.TubeGeometry {
    const signature = phase === "signature";
    const aftermath = phase === "aftermath";
    const pointCount = signature ? 18 : 13;
    const points = Array.from({ length: pointCount }, (_, pointIndex) => {
        const u = pointIndex / Math.max(1, pointCount - 1);
        const angle = kind === "water" && !signature ? -0.92 + index * 0.58 : index * 2.17;
        if (kind === "water") {
            const reach = (signature ? 2.45 : aftermath ? 0.72 : 0.94) * u;
            const lift = Math.sin(Math.PI * u) * (signature ? 2.2 : aftermath ? 0.34 : 0.74);
            return new THREE.Vector3(Math.cos(angle) * reach, lift, Math.sin(angle) * reach);
        }
        if (kind === "wind") {
            const height = signature ? 3.8 : aftermath ? 0.9 : 1.72;
            const radius = (0.16 + u * (signature ? 1.35 : 0.64)) * (aftermath ? 1.25 : 1);
            const turn = angle + u * Math.PI * (signature ? 5.4 : 3.2);
            return new THREE.Vector3(Math.cos(turn) * radius, u * height, Math.sin(turn) * radius);
        }
        if (kind === "lightning") {
            const height = signature ? 4.7 : aftermath ? 1.15 : 2.05;
            const direction = signature ? 1 - u : u - 0.5;
            const jag = Math.sin((pointIndex + index * 3) * 2.37) * (signature ? 0.34 : 0.22);
            const branch = index === 0 ? 0 : u * (0.18 + index * 0.055);
            return new THREE.Vector3(jag + Math.cos(angle) * branch, direction * height, Math.cos((pointIndex + index) * 1.73) * (signature ? 0.24 : 0.16) + Math.sin(angle) * branch);
        }
        if (kind === "arcane") {
            const radius = (signature ? 1.65 : aftermath ? 0.78 : 0.92) * (0.82 + index % 3 * 0.12);
            const orbit = u * Math.PI * 1.72 + angle;
            return new THREE.Vector3(Math.cos(orbit) * radius, Math.sin(orbit) * radius * 0.58, Math.sin(orbit) * radius * 0.76);
        }
        // Fire and abyss both rise as tapered, corkscrewing plumes. Abyss is
        // made visually distinct through its palette, smoke volume and orbiting
        // embers in the renderer below rather than a separate flat glyph.
        const height = signature ? 3.45 : aftermath ? 1.05 : 1.82;
        const radius = (signature ? 0.7 : aftermath ? 0.34 : 0.44) * (1 - u * 0.72);
        const turn = angle + u * Math.PI * (signature ? 2.7 : 1.8);
        return new THREE.Vector3(Math.cos(turn) * radius, u * height, Math.sin(turn) * radius);
    });
    const radius = phase === "signature" ? 0.075 + (index % 3) * 0.012 : kind === "water" ? phase === "aftermath" ? 0.026 : 0.035 : phase === "aftermath" ? 0.043 : 0.058 + (index % 2) * 0.009;
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), signature ? 52 : 34, radius, 6, false);
}

function cachedElementVolumeCurves(kind: DuelElementBurstKind, phase: DuelElementVolumePhase, count: number): readonly THREE.TubeGeometry[] {
    const key = `${kind}:${phase}:${count}`;
    const cached = ELEMENT_VOLUME_CURVE_CACHE.get(key);
    if (cached) return cached;
    const geometries = Object.freeze(Array.from({ length: count }, (_, index) => makeElementVolumeCurve(kind, index, phase)));
    ELEMENT_VOLUME_CURVE_CACHE.set(key, geometries);
    return geometries;
}

function cachedHeroMoveStrokes(style: PetHeroMoveStyle, quality: PetVisualQuality): readonly THREE.ExtrudeGeometry[] {
    if (style === "generic") return [];
    const key = `${style}:${quality}`;
    const cached = HERO_MOVE_STROKE_CACHE.get(key);
    if (cached) return cached;
    const water = style.startsWith("selkie") || style === "serpentine-surge";
    const pounce = style === "kitsune-eclipse-pounce" || style === "selkie-tail-strike" || style === "quadruped-rush";
    const avian = style === "avian-dive";
    const heavy = style === "heavy-slam";
    const biped = style === "biped-combo";
    const count = quality === "low" ? 2 : quality === "medium" ? 3 : 4;
    const geometries = Object.freeze(Array.from({ length: count }, (_, index) => makeAnimeStrokeGeometry(
        (heavy ? 1.58 : avian ? 1.52 : water ? 1.46 : 1.34) * (1 - index * 0.12),
        (heavy ? 0.3 : pounce ? 0.24 : biped ? 0.215 : 0.19) * (1 - index * 0.08),
        (avian ? 0.86 : water ? 0.72 : heavy ? 0.6 : 0.5) * (1 - index * 0.13),
        style === "kitsune-shadow-step" || style === "avian-dive" || style === "serpentine-surge" ? 0.055 : 0,
    )));
    HERO_MOVE_STROKE_CACHE.set(key, geometries);
    return geometries;
}

function scheduleDuelFxGeometryPrewarm(kinds: readonly DuelElementBurstKind[], quality: PetVisualQualityConfig): () => void {
    const uniqueKinds = [...new Set(kinds)];
    const tasks: Array<() => void> = [];
    for (const kind of uniqueKinds) {
        for (const phase of ["contact", "aftermath", "dash"] as const) {
            for (const big of [false, true]) {
                const count = duelElementCurveCount(kind, phase, big, quality.id);
                const key = `${kind}:${phase}:${count}`;
                if (!ELEMENT_VOLUME_CURVE_CACHE.has(key)) tasks.push(() => { cachedElementVolumeCurves(kind, phase, count); });
            }
        }
    }
    let cancelled = false;
    let timer = 0;
    const runOne = () => {
        if (cancelled) return;
        tasks.shift()?.();
        if (tasks.length) timer = window.setTimeout(runOne, 18);
    };
    // Spend the otherwise static VS/size-up beat preparing immutable effect
    // geometry in small slices, instead of compiling it on the contact frame.
    timer = window.setTimeout(runOne, 80);
    return () => {
        cancelled = true;
        window.clearTimeout(timer);
    };
}

/** One coherent 3D material language for every live elemental contact. It is
 * intentionally shape-led: fire rises and curls, water splashes, wind funnels,
 * lightning branches, earth displaces mass, abyss smolders, and arcane energy
 * orbits. The effect scales from a quick hit to an arena signature without
 * falling back to the old beveled brush cards. */
function DuelElementVolume({ at, kind, color, big, heading = 0, phase, quality, heroStyle = "generic", delay = 0, onDone }: {
    at: Vec3;
    kind: DuelElementBurstKind;
    color: string;
    big: boolean;
    heading?: number;
    phase: DuelElementVolumePhase;
    quality: PetVisualQualityConfig;
    heroStyle?: PetHeroMoveStyle;
    delay?: number;
    onDone: () => void;
}) {
    const root = useRef<THREE.Group>(null);
    const core = useRef<THREE.Group>(null);
    const arenaSeal = useRef<THREE.Group>(null);
    const motifs = useRef<Array<THREE.Group | null>>([]);
    const particles = useRef<THREE.InstancedMesh>(null);
    const materials = useRef<Array<(THREE.Material & { opacity: number }) | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const palette = useMemo(() => duelFxPalette(kind, color), [kind, color]);
    const signature = phase === "signature";
    const aftermath = phase === "aftermath";
    const low = quality.id === "low";
    const curveCount = duelElementCurveCount(kind, phase, big, quality.id);
    const heroMove = heroStyle !== "generic";
    const particleCount = low ? (signature ? 8 : 5) : quality.id === "medium" ? (signature ? 12 : heroMove ? 8 : big ? 9 : 6) : signature ? 18 : heroMove ? 10 : big ? 13 : 9;
    // Curves are immutable and shared by every repeat of the same move class.
    // Rebuilding TubeGeometry synchronously on each hit was the largest visible
    // CPU hitch in effect-heavy exchanges.
    const curves = useMemo(() => cachedElementVolumeCurves(kind, phase, curveCount), [curveCount, kind, phase]);
    const heroStrokes = useMemo(() => cachedHeroMoveStrokes(heroStyle, quality.id), [heroStyle, quality.id]);
    const particleDummy = useMemo(() => new THREE.Object3D(), []);
    const particleGeometry = useMemo<THREE.BufferGeometry>(() => {
        if (kind === "water") return new THREE.IcosahedronGeometry(signature ? 0.13 : 0.085, 0);
        if (kind === "earth") return new THREE.DodecahedronGeometry(signature ? 0.16 : 0.11, 0);
        if (kind === "lightning") return new THREE.TetrahedronGeometry(signature ? 0.13 : 0.085, 0);
        if (kind === "abyss") return new THREE.IcosahedronGeometry(signature ? 0.18 : 0.11, 0);
        return new THREE.OctahedronGeometry(signature ? 0.12 : 0.08, 0);
    }, [kind, signature]);
    useEffect(() => () => particleGeometry.dispose(), [particleGeometry]);
    useEffect(() => {
        const mesh = particles.current;
        if (!mesh) return;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let index = 0; index < particleCount; index++) {
            const isSmoke = kind === "abyss" && index % 3 === 0;
            const particleColor = isSmoke ? palette.dark : index % 4 === 0 ? palette.core : index % 2 ? palette.accent : palette.body;
            mesh.setColorAt(index, new THREE.Color(particleColor));
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, [kind, palette, particleCount]);
    const duration = signature ? 1.86 : aftermath ? (big ? 1.34 : 1.08) : phase === "dash" ? (heroMove ? 1.02 : 0.9) : heroMove ? 0.96 : big ? 0.9 : 0.64;
    // Named abilities occupy the missing middle tier: clearly larger than a basic
    // contact, but still well below an arena-owning tsunami or tornado.
    const basePhaseScale = signature ? 1.8 : aftermath ? (big ? 1.34 : 1.04) : phase === "dash" ? (big ? 1.34 : 0.86) : big ? 1.56 : 0.98;
    const phaseScale = basePhaseScale * (heroMove ? phase === "dash" ? 1.34 : 1.42 : 1);
    const register = (material: (THREE.Material & { opacity: number }) | null, index: number, baseOpacity: number) => {
        if (!material) return;
        material.userData.baseOpacity = baseOpacity;
        materials.current[index] = material;
    };
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current - delay;
        if (elapsed < 0) {
            // Keep the subtree renderable at an effectively invisible scale so
            // WebGL compiles the materials during anticipation, never on impact.
            if (root.current) {
                root.current.visible = true;
                root.current.scale.setScalar(0.001);
            }
            materials.current.forEach((material) => { if (material) material.opacity = 0; });
            return;
        }
        if (root.current) root.current.visible = true;
        const p = Math.min(1, elapsed / duration);
        const open = 1 - Math.pow(1 - Math.min(1, p / (signature ? 0.2 : 0.25)), 3);
        const fadeStart = aftermath ? 0.52 : signature ? 0.76 : 0.62;
        const fade = p < fadeStart ? 1 : Math.max(0, 1 - (p - fadeStart) / (1 - fadeStart));
        const impactPulse = 0.92 + Math.sin(Math.min(1, p / 0.3) * Math.PI) * (signature ? 0.12 : 0.18);
        if (root.current) {
            // Authored brush accents are staged toward the broadcast camera.
            // Rotating their thin profile into the world-space travel heading
            // made them read as tall rectangular slabs from common shot angles.
            root.current.rotation.y = heroMove ? 0 : heading + (kind === "wind" || kind === "arcane" ? elapsed * (kind === "wind" ? 1.8 : 0.72) : 0);
            root.current.scale.setScalar(Math.max(0.001, phaseScale * open * impactPulse));
        }
        if (core.current) {
            const corePulse = 0.76 + Math.sin(elapsed * (kind === "lightning" ? 26 : 12)) * 0.08;
            core.current.scale.setScalar(corePulse * (aftermath ? 0.62 : 1));
            core.current.rotation.set(elapsed * 0.7, elapsed * 1.4, -elapsed * 0.52);
        }
        if (arenaSeal.current) {
            arenaSeal.current.rotation.y = elapsed * 0.82;
            const sealPulse = 0.78 + open * 0.22 + Math.sin(elapsed * 8.4) * 0.025;
            arenaSeal.current.scale.setScalar(Math.max(0.001, sealPulse));
        }
        motifs.current.forEach((group, index) => {
            if (!group) return;
            const direction = index % 2 ? -1 : 1;
            group.rotation.y = elapsed * (kind === "wind" ? 3.4 : kind === "arcane" ? 1.45 : 0.42) * direction + index * 0.37;
            group.scale.setScalar(0.72 + open * 0.28 + Math.sin(elapsed * 7 + index) * 0.035);
        });
        const particleMesh = particles.current;
        if (particleMesh) for (let index = 0; index < particleCount; index++) {
            const angle = index * 2.399 + heading;
            const speed = 0.42 + (index % 4) * 0.13;
            const travel = Math.min(1, p * (signature ? 1.3 : 1.65));
            const radius = (signature ? 0.58 : 0.32) + travel * speed * (signature ? 2.3 : 1.45);
            const lift = kind === "earth"
                ? Math.sin(Math.PI * travel) * (signature ? 1.35 : 0.62)
                : kind === "water"
                    ? Math.sin(Math.PI * travel) * (signature ? 2.0 : 0.95)
                    : travel * (signature ? 2.1 : 0.92);
            particleDummy.position.set(Math.cos(angle) * radius, (aftermath ? 0.08 : 0.16) + lift, Math.sin(angle) * radius);
            particleDummy.rotation.set(elapsed * (1.8 + index % 3), angle, elapsed * (2.4 + index % 2));
            particleDummy.scale.setScalar((0.68 + (index % 3) * 0.16) * fade * (0.5 + open * 0.5));
            particleDummy.updateMatrix();
            particleMesh.setMatrixAt(index, particleDummy.matrix);
        }
        if (particleMesh) particleMesh.instanceMatrix.needsUpdate = true;
        materials.current.forEach((material) => {
            if (material) material.opacity = Number(material.userData.baseOpacity ?? 1) * fade;
        });
        if (light.current) light.current.intensity = fade * Math.sin(Math.PI * Math.min(1, p * 1.65)) * (signature ? 6.4 : big ? 3.5 : 2.2);
        if (p >= 1 && !completed.current) {
            completed.current = true;
            onDone();
        }
    });

    const curveMaterial = (index: number) => (
        <meshToonMaterial
            ref={(material) => register(material, index, aftermath ? 0.62 : heroMove ? (index % 3 === 0 ? 0.68 : 0.52) : index % 3 === 0 ? 0.94 : 0.78)}
            color={index % 4 === 0 ? palette.core : index % 2 ? palette.accent : palette.body}
            emissive={palette.accent}
            emissiveIntensity={signature ? 0.18 : 0.09}
            transparent
            opacity={0}
            depthWrite={false}
        />
    );
    const coreMaterialIndex = curveCount;
    const particleMaterialOffset = coreMaterialIndex + 2;
    const coreShape = kind === "water" ? <sphereGeometry args={[0.56, low ? 16 : 24, low ? 10 : 16]} />
        : kind === "wind" ? <sphereGeometry args={[0.38, low ? 12 : 18, low ? 8 : 12]} />
            : kind === "earth" ? <dodecahedronGeometry args={[0.66, 0]} />
                : kind === "lightning" ? <octahedronGeometry args={[0.58, 0]} />
                    : <icosahedronGeometry args={[0.58, 1]} />;
    return (
        <group ref={root} position={at} visible={delay <= 0} scale={0.001}>
            <group ref={core} position={[0, aftermath ? 0.12 : kind === "lightning" && signature ? 0.42 : 0.36, 0]} scale={0.01}>
                <mesh scale={kind === "water" ? [1.25, 0.72, 1.05] : kind === "earth" ? [1.1, 0.76, 1.15] : kind === "wind" ? [0.76, 1.45, 0.76] : [1, 1, 1]} castShadow={kind === "earth"}>
                    {coreShape}
                    <meshToonMaterial ref={(material) => register(material, coreMaterialIndex, aftermath ? 0.38 : heroMove ? 0.68 : 0.88)} color={palette.body} emissive={palette.accent} emissiveIntensity={signature ? 0.26 : 0.12} transparent opacity={0} depthWrite={kind === "earth"} />
                </mesh>
                {!aftermath && kind !== "earth" && (
                    <mesh scale={kind === "water" ? [0.78, 0.52, 0.72] : [0.62, 0.62, 0.62]}>
                        {coreShape}
                        <meshToonMaterial ref={(material) => register(material, coreMaterialIndex + 1, heroMove ? 0.48 : 0.74)} color={palette.core} emissive={palette.accent} emissiveIntensity={0.24} transparent opacity={0} depthWrite={false} />
                    </mesh>
                )}
            </group>

            {curves.map((geometry, index) => (
                <group key={`element-volume-curve-${index}`} ref={(group) => { motifs.current[index] = group; }} rotation={[0, index * 0.31, kind === "arcane" ? (index % 3 - 1) * 0.64 : 0]}>
                    <mesh geometry={geometry} position={kind === "lightning" && signature ? [0, 0.02, 0] : [0, aftermath ? 0.04 : -0.18, 0]} renderOrder={34 + index % 2}>
                        {curveMaterial(index)}
                    </mesh>
                </group>
            ))}

            {kind === "earth" && Array.from({ length: low ? (signature ? 7 : 4) : signature ? 13 : big ? 8 : 6 }, (_, index) => {
                const angle = index * 2.399;
                const radius = 0.28 + (index % 4) * (signature ? 0.36 : 0.2);
                const height = (signature ? 1.55 : aftermath ? 0.52 : 0.9) * (0.75 + (index % 3) * 0.18);
                return (
                    <group key={`earth-spire-${index}`} ref={(group) => { motifs.current[index] = group; }} position={[Math.cos(angle) * radius, height * 0.42, Math.sin(angle) * radius]} rotation={[0.08 * (index % 2), -angle, (index % 2 ? -1 : 1) * 0.12]}>
                        <mesh scale={[0.32 + (index % 2) * 0.08, height, 0.34 + (index % 3) * 0.035]} castShadow>
                            <dodecahedronGeometry args={[0.62, 0]} />
                            <meshToonMaterial ref={(material) => register(material, particleMaterialOffset + particleCount + 10 + index, index % 4 === 0 ? 0.96 : 0.86)} color={index % 4 === 0 ? palette.accent : index % 2 ? palette.body : palette.dark} emissive={palette.accent} emissiveIntensity={0.04} transparent opacity={0} />
                        </mesh>
                    </group>
                );
            })}

            {(kind === "wind" || kind === "arcane" || kind === "abyss") && [0, 1, 2].map((index) => (
                <group key={`element-orbit-${index}`} ref={(group) => { motifs.current[curveCount + index] = group; }} rotation={[(index - 1) * 0.58, index * 0.92, index * 0.44]}>
                    <mesh scale={signature ? 1.52 + index * 0.28 : 0.72 + index * 0.18}>
                        <torusGeometry args={[0.72, kind === "abyss" ? 0.055 : 0.038, 7, low ? 28 : 48, kind === "wind" ? Math.PI * 1.55 : Math.PI * 1.86]} />
                        <meshToonMaterial ref={(material) => register(material, particleMaterialOffset + particleCount + index, index === 0 ? 0.72 : 0.48)} color={index === 0 ? palette.accent : index === 1 ? palette.body : palette.core} emissive={palette.accent} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} />
                    </mesh>
                </group>
            ))}

            {heroStrokes.map((geometry, index) => {
                const water = kind === "water" || heroStyle.startsWith("selkie");
                const avian = heroStyle === "avian-dive";
                const heavy = heroStyle === "heavy-slam";
                const lateral = heroStyle === "selkie-tail-strike"
                    || heroStyle === "kitsune-eclipse-pounce"
                    || heroStyle === "quadruped-rush"
                    || heroStyle === "biped-combo"
                    || heavy;
                return (
                    <group
                        key={`hero-move-accent-${index}`}
                        ref={(group) => { motifs.current[curveCount + 4 + index] = group; }}
                        position={avian
                            ? [-0.1 + index * 0.1, 0.28 + index * 0.34, (index - 1) * 0.16]
                            : lateral
                                ? [-0.12 + index * 0.12, 0.16 + index * 0.25, (index - 1) * 0.18]
                                : [-0.18 + index * 0.1, 0.2 + index * 0.22, (index - 1) * 0.2]}
                        rotation={avian
                            ? [0.12, -0.14 + index * 0.1, -1.04 + index * 0.18]
                            : lateral
                                ? [0.04, -0.08 + index * 0.07, (heavy ? -0.42 : -0.62) + index * 0.34]
                                : [0.08, -0.16 + index * 0.14, -0.42 + index * 0.3]}
                    >
                        <mesh geometry={geometry} scale={[1.62, water ? 1.48 : 1.36, 1.56]}>
                            <meshToonMaterial
                                ref={(material) => register(material, particleMaterialOffset + particleCount + 40 + index, index === 0 ? 0.76 : 0.56)}
                                color={index === 0 ? palette.core : index === 1 ? palette.accent : palette.body}
                                emissive={palette.accent}
                                emissiveIntensity={0.16}
                                transparent
                                opacity={0}
                                depthWrite={false}
                            />
                        </mesh>
                    </group>
                );
            })}

            <instancedMesh ref={particles} args={[particleGeometry, undefined, particleCount]} frustumCulled={false} renderOrder={35} castShadow={kind === "earth"}>
                <meshToonMaterial
                    ref={(material) => register(material, particleMaterialOffset, kind === "abyss" ? 0.7 : 0.86)}
                    color="#ffffff"
                    vertexColors
                    emissive={palette.accent}
                    emissiveIntensity={kind === "abyss" ? 0.05 : 0.12}
                    transparent
                    opacity={0}
                    depthWrite={kind === "earth"}
                />
            </instancedMesh>

            {(signature || big) && (
                <group ref={arenaSeal} position={[0, 0.018, 0]}>
                    <mesh rotation={[-Math.PI / 2, 0, 0]} scale={signature ? 1 : 0.72} renderOrder={31}>
                        <ringGeometry args={[0.54, 1.28, low ? 28 : 52]} />
                        <meshToonMaterial ref={(material) => register(material, particleMaterialOffset + particleCount + 70, signature ? 0.3 : 0.2)} color={palette.dark} emissive={palette.body} emissiveIntensity={0.08} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh rotation={[-Math.PI / 2, 0, Math.PI / 5]} scale={signature ? 1 : 0.72} renderOrder={32}>
                        <ringGeometry args={[1.42, 1.52, low ? 28 : 52]} />
                        <meshToonMaterial ref={(material) => register(material, particleMaterialOffset + particleCount + 71, signature ? 0.62 : 0.4)} color={palette.accent} emissive={palette.accent} emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            )}

            {kind === "earth" && (
                <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={signature ? 1.8 : big ? 1.2 : 0.9}>
                    <circleGeometry args={[0.82, low ? 18 : 32]} />
                    <meshToonMaterial ref={(material) => register(material, particleMaterialOffset + particleCount + 5, 0.34)} color={palette.dark} transparent opacity={0} depthWrite={false} />
                </mesh>
            )}
            {quality.dynamicPetLight && <pointLight ref={light} position={[0, signature ? 1.35 : 0.55, 0]} color={palette.accent} intensity={0} distance={signature ? 10.5 : 5.5} decay={2} />}
        </group>
    );
}

function DuelSupportEffect({ at, color, kind, actorId, duel, clock, onDone }: { at: Vec3; color: string; kind: DuelSupportKind; actorId?: string; duel: DuelResult; clock: { current: DuelClock }; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const strokes = useRef<Array<THREE.Mesh | null>>([]);
    const strokeMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const start = useRef<number | null>(null);
    const duration = kind === "shield" ? 0.84 : 0.76;
    const strokeCount = kind === "shield" ? 7 : 8;
    const strokeGeometries = useMemo(() => Array.from({ length: strokeCount }, (_, i) => makeAnimeStrokeGeometry(
        kind === "shield" ? 0.82 + (i % 3) * 0.08 : 0.72 + (i % 4) * 0.07,
        kind === "shield" ? 0.18 + (i % 2) * 0.025 : 0.14 + (i % 3) * 0.018,
        kind === "shield" ? 0.2 + (i % 3) * 0.04 : 0.28 + (i % 2) * 0.05,
        kind === "shield" ? 0 : 0.006,
    )), [kind, strokeCount]);
    const coreColor = useMemo(() => new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.48).getStyle(), [color]);
    useEffect(() => () => strokeGeometries.forEach((geometry) => geometry.dispose()), [strokeGeometries]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / duration);
        const settle = p < 0.22 ? p / 0.22 : 1;
        const fade = p < 0.7 ? 1 : Math.max(0, 1 - (p - 0.7) / 0.3);
        if (root.current) {
            const live = liveDuelEffectPosition(duel, clock, actorId);
            if (live) root.current.position.set(live.wx, at[1], live.wz);
            root.current.scale.setScalar(0.68 + settle * 0.32);
        }
        strokes.current.forEach((stroke, i) => {
            if (!stroke) return;
            const u = i / Math.max(1, strokeCount);
            if (kind === "shield") {
                const angle = u * Math.PI * 2 + elapsed * 0.72;
                const radius = 0.76 + (i % 2) * 0.12;
                stroke.position.set(Math.cos(angle) * radius, 0.48 + (i % 3) * 0.38, Math.sin(angle) * radius);
                stroke.rotation.set(-0.08 + Math.sin(angle) * 0.12, 0, 1.06 + (i % 2) * 0.14);
                const bloom = settle * (0.78 + (i % 3) * 0.08);
                stroke.scale.setScalar(bloom);
            } else {
                const cycle = (p * 1.35 + u) % 1;
                const angle = u * Math.PI * 2 - elapsed * 0.9;
                const radius = 0.28 + (i % 3) * 0.13 + cycle * 0.2;
                stroke.position.set(Math.cos(angle) * radius, 0.16 + cycle * 1.85, Math.sin(angle) * radius);
                stroke.rotation.set(0.02, 0, 1.12 + Math.sin(angle * 2) * 0.18);
                stroke.scale.setScalar((0.46 + Math.sin(Math.PI * cycle) * 0.4) * settle);
            }
            const material = strokeMats.current[i];
            if (material) material.opacity = fade * (kind === "shield" ? 0.72 : Math.sin(Math.PI * ((p * 1.35 + u) % 1)) * 0.82);
        });
        if (p >= 1) onDone();
    });
    return (
        <group ref={root} position={at}>
            {strokeGeometries.map((geometry, i) => (
                <mesh key={`${kind}-brush-${i}`} ref={(mesh) => { strokes.current[i] = mesh; }} geometry={geometry} renderOrder={31}>
                    <meshToonMaterial
                        ref={(material) => { strokeMats.current[i] = material; }}
                        color={i % 3 === 0 ? coreColor : color}
                        emissive={color}
                        emissiveIntensity={0.14}
                        transparent
                        opacity={0}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            ))}
        </group>
    );
}

/** A swept melee weapon TRAIL — an additive blade/streak that arcs through the strike
 *  so each move reads as a distinct SWING: a pierce STABS forward (streak), a slash
 *  SWEEPS, a heavy slam CHOPS overhead, a drain RAKES back. Procedural texture, tinted
 *  by the attacker's element; self-timed; mirrored by `toward` (the attacker's facing).
 *  Render-only — spawned off the deterministic hit stream, never fed back. */
function DuelMeleeTrail({ at, toward, kind, color, weight = "basic", heroStyle = "generic", native = false, onDone }: {
    at: Vec3;
    toward: number;
    kind: MoveChoreoKind;
    color: string;
    weight?: DuelAttackWeight;
    heroStyle?: PetHeroMoveStyle;
    native?: boolean;
    onDone: () => void;
}) {
    const spec = useMemo(() => meleeTrailSpec(kind), [kind]);
    const tex = useMemo(() => (spec.tex === "streak" ? trailStreakTexture() : projCrescentTexture()), [spec.tex]);
    const mesh = useRef<THREE.Mesh>(null);
    const nativeArc = useRef<THREE.Group>(null);
    const followArc = useRef<THREE.Group>(null);
    const finishArc = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshToonMaterial>(null);
    const darkMat = useRef<THREE.MeshToonMaterial>(null);
    const edgeMat = useRef<THREE.MeshToonMaterial>(null);
    const followMat = useRef<THREE.MeshToonMaterial>(null);
    const finishMat = useRef<THREE.MeshToonMaterial>(null);
    const chips = useRef<Array<THREE.Mesh | null>>([]);
    const chipMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const scale = weight === "heavy" ? 1.72 : weight === "ability" ? 1.5 : 1.28;
    const avian = heroStyle === "avian-dive";
    const serpent = heroStyle === "serpentine-surge";
    const biped = heroStyle === "biped-combo";
    const rush = heroStyle === "quadruped-rush" || heroStyle === "kitsune-eclipse-pounce";
    const heavyProfile = heroStyle === "heavy-slam" || kind === "heavySlam";
    const dark = useMemo(() => new THREE.Color(color).multiplyScalar(0.28).getStyle(), [color]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const duration = Math.max(spec.life / 1000, weight === "basic" ? 0.42 : weight === "ability" ? 0.5 : 0.58);
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / duration);
        const e = p * p * (3 - 2 * p);   // smoothstep through the swing
        const grow = 0.7 + 0.5 * Math.sin(Math.PI * Math.min(1, p / 0.72));   // swell, then settle
        const fade = p < 0.14 ? p / 0.14 : Math.max(0, 1 - (p - 0.58) / 0.42);
        const followP = Math.min(1, Math.max(0, (p - 0.1) / 0.9));
        const followE = followP * followP * (3 - 2 * followP);
        const followFade = followP <= 0 ? 0 : followP < 0.14 ? followP / 0.14 : Math.max(0, 1 - (followP - 0.62) / 0.38);
        const finishP = Math.min(1, Math.max(0, (p - 0.23) / 0.77));
        const finishE = finishP * finishP * (3 - 2 * finishP);
        const finishFade = finishP <= 0 ? 0 : finishP < 0.16 ? finishP / 0.16 : Math.max(0, 1 - (finishP - 0.56) / 0.44);
        if (native && nativeArc.current) {
            // The primary stroke establishes direction; the two delayed strokes
            // turn even a basic attack into a short species-shaped combination.
            nativeArc.current.position.set(rush ? e * 0.16 : 0, 0.12 + Math.sin(Math.PI * e) * (avian ? 0.34 : 0.2), 0);
            nativeArc.current.rotation.set(heavyProfile ? 0.06 : avian ? -0.2 : 0.28 + e * 0.46, serpent ? e * 0.72 : (toward < 0 ? -1 : 1) * e * 0.42, lerp(heavyProfile ? -1.42 : -1.08, heavyProfile ? 0.42 : 1.02, e));
            nativeArc.current.scale.setScalar(grow * scale * (heavyProfile ? 1.16 : 1));
        }
        if (native && followArc.current) {
            followArc.current.visible = followP > 0;
            followArc.current.position.set(rush ? 0.16 + followE * 0.12 : 0, 0.2 + Math.sin(Math.PI * followE) * (avian ? 0.42 : 0.16), serpent ? Math.sin(followE * Math.PI) * 0.18 : 0);
            followArc.current.rotation.set(avian ? -0.46 : biped ? 0.48 : 0.16, serpent ? followE * 1.65 : biped ? -0.42 : 0.18, lerp(avian ? 0.94 : biped ? 0.78 : -0.72, avian ? -0.9 : biped ? -0.88 : 0.86, followE));
            followArc.current.scale.setScalar(scale * (0.72 + Math.sin(Math.PI * followE) * 0.2));
        }
        if (native && finishArc.current) {
            finishArc.current.visible = finishP > 0;
            finishArc.current.position.set(rush ? 0.26 + finishE * 0.16 : 0, 0.05 + Math.sin(Math.PI * finishE) * (heavyProfile ? 0.46 : 0.24), 0);
            finishArc.current.rotation.set(heavyProfile ? -0.28 : avian ? 0.62 : 0.2, serpent ? -finishE * 1.3 : biped ? 0.55 : -0.2, lerp(heavyProfile ? -1.5 : -0.52, heavyProfile ? 0.18 : 0.72, finishE));
            finishArc.current.scale.setScalar(scale * (weight === "basic" ? 0.62 : 0.82) * (0.84 + Math.sin(Math.PI * finishE) * 0.16));
        }
        if (!native && mesh.current) {
            mesh.current.position.set(lerp(spec.dx0, spec.dx1, e), lerp(spec.dy0, spec.dy1, e), 0);
            mesh.current.rotation.z = lerp(spec.rot0, spec.rot1, e);
            mesh.current.scale.set(spec.w * grow * scale, spec.h * grow * scale, 1);
        }
        if (mat.current) mat.current.opacity = fade * 0.94;
        if (darkMat.current) darkMat.current.opacity = fade * 0.68;
        if (edgeMat.current) edgeMat.current.opacity = fade * 0.76;
        if (followMat.current) followMat.current.opacity = followFade * (weight === "basic" ? 0.72 : 0.86);
        if (finishMat.current) finishMat.current.opacity = finishFade * (weight === "basic" ? 0.62 : 0.82);
        chips.current.forEach((chip, index) => {
            if (!chip) return;
            const angle = index * 2.399 + (toward < 0 ? Math.PI : 0);
            const travel = Math.max(0, Math.min(1, (p - 0.1 - index * 0.018) / 0.7));
            const radius = 0.62 + travel * (0.45 + (index % 3) * 0.16);
            chip.position.set(Math.cos(angle) * radius, 0.34 + Math.sin(Math.PI * travel) * (0.42 + (index % 2) * 0.18), Math.sin(angle) * radius * 0.48);
            chip.rotation.set(travel * (4.2 + index * 0.3), angle, -travel * (3.6 + index * 0.2));
            chip.scale.setScalar((0.065 + (index % 3) * 0.014) * scale * (0.72 + Math.sin(Math.PI * travel) * 0.34));
            if (chipMats.current[index]) chipMats.current[index]!.opacity = fade * Math.max(0.22, 0.78 - index * 0.065);
        });
        if (p >= 1 && !completed.current) {
            completed.current = true;
            onDone();
        }
    });
    if (native) return (
        <group position={at} scale={[toward, 1, 1]}>
            <group ref={nativeArc}>
                <mesh scale={1.08} position={[0, 0, -0.026]}>
                    <torusGeometry args={[0.86, heavyProfile ? 0.145 : 0.11, 10, 40, Math.PI * (heavyProfile ? 0.82 : 0.96)]} />
                    <meshToonMaterial ref={darkMat} color={dark} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh ref={mesh}>
                    <torusGeometry args={[0.86, heavyProfile ? 0.112 : 0.084, 10, 40, Math.PI * (heavyProfile ? 0.82 : 0.96)]} />
                    <meshToonMaterial ref={mat} color={color} emissive={color} emissiveIntensity={0.16} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0, 0.018]} scale={0.985}>
                    <torusGeometry args={[0.86, 0.027, 8, 40, Math.PI * (heavyProfile ? 0.82 : 0.96)]} />
                    <meshToonMaterial ref={edgeMat} color="#fff6dc" emissive={color} emissiveIntensity={0.1} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            <group ref={followArc} visible={false}>
                <mesh>
                    <torusGeometry args={[0.78, biped || avian ? 0.075 : 0.064, 9, 36, Math.PI * (serpent ? 1.34 : 0.78)]} />
                    <meshToonMaterial ref={followMat} color={heroStyle.startsWith("selkie") ? "#d8fbff" : color} emissive={color} emissiveIntensity={0.14} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            <group ref={finishArc} visible={false}>
                <mesh>
                    <torusGeometry args={[heavyProfile ? 0.98 : 0.7, heavyProfile ? 0.09 : 0.052, 9, 36, Math.PI * (heavyProfile ? 0.72 : 0.66)]} />
                    <meshToonMaterial ref={finishMat} color="#fff0bd" emissive={color} emissiveIntensity={0.18} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            {Array.from({ length: weight === "basic" ? 4 : 7 }, (_, i) => (
                    <mesh key={`blade-chip-${i}`} ref={(mesh) => { chips.current[i] = mesh; }} rotation={[i * 0.4, i * 0.7, 0.35]} scale={0.01}>
                        <octahedronGeometry args={[1, 0]} />
                        <meshToonMaterial ref={(material) => { chipMats.current[i] = material; }} color={i % 3 === 0 ? "#fff6dc" : color} emissive={color} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} />
                    </mesh>
            ))}
        </group>
    );
    return (
        <group position={at}>
            <Billboard>
                {/* scale.x = toward mirrors the whole swing for the enemy (faces −x). */}
                <group scale={[toward, 1, 1]}>
                    <mesh ref={mesh}>
                        <planeGeometry args={[1, 1]} />
                        <meshToonMaterial ref={mat} map={tex} color={color} emissive={color} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            </Billboard>
        </group>
    );
}

/** A readable anime dash phrase. A body-height ribbon grows behind the actual
 * pet, element-shaped speed fins mark its S-curve, and opaque directional
 * brushwork strikes at arrival. No proxy orb or floor-level arrow leads it. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelDashEffect({ cue, onDone }: { cue: DuelDashCue; onDone: () => void }) {
    const trailMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const wakeGroups = useRef<Array<THREE.Group | null>>([]);
    const wakeMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const landingBurst = useRef<THREE.Group>(null);
    const landingMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const groundRing = useRef<THREE.Mesh>(null);
    const groundMat = useRef<THREE.MeshToonMaterial>(null);
    const landingLight = useRef<THREE.PointLight>(null);
    const finished = useRef(false);
    const { to, color, impact, duration, travelDuration, kind } = cue;
    const dx = to[0] - cue.from[0], dz = to[2] - cue.from[2];
    const angle = Math.atan2(dx, dz);
    const palette = useMemo(() => duelFxPalette(kind, color), [kind, color]);
    const ribbonOuter = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.69, impact ? 0.38 : 0.3), [cue, impact]);
    const ribbonInner = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.705, impact ? 0.23 : 0.18), [cue, impact]);
    const wakeGeometry = useMemo(() => makeAnimeStrokeGeometry(
        impact ? 1.42 : 1.08,
        impact ? 0.24 : 0.19,
        kind === "water" ? 0.42 : kind === "fire" || kind === "abyss" ? 0.31 : 0.18,
        kind === "lightning" ? 0.12 : 0,
    ), [impact, kind]);
    const impactSpecs = useMemo(() => Array.from({ length: impact ? 5 : 3 }, (_, i) => ({
        length: (impact ? 1.3 : 0.96) * (0.85 + (i % 3) * 0.12),
        width: (impact ? 0.25 : 0.19) * (0.88 + (i % 2) * 0.16),
        curl: kind === "water" ? 0.54 : kind === "fire" || kind === "abyss" ? 0.42 : 0.2,
        jagged: kind === "lightning" ? 0.17 : kind === "earth" ? 0.06 : 0,
        roll: -0.78 + i * (1.56 / Math.max(1, (impact ? 5 : 3) - 1)),
        lift: 0.34 + (i % 3) * 0.25,
    })), [impact, kind]);
    const impactGeometries = useMemo(() => impactSpecs.map((spec) => makeAnimeStrokeGeometry(spec.length, spec.width, spec.curl, spec.jagged)), [impactSpecs]);
    useEffect(() => () => {
        ribbonOuter.dispose();
        ribbonInner.dispose();
        wakeGeometry.dispose();
        impactGeometries.forEach((geometry) => geometry.dispose());
    }, [ribbonOuter, ribbonInner, wakeGeometry, impactGeometries]);
    useFrame(() => {
        const elapsed = Math.max(0, (performance.now() - cue.createdAt) / 1000);
        const p = Math.min(1, elapsed / duration);
        const travelP = Math.min(1, elapsed / travelDuration);
        const linger = elapsed <= travelDuration ? 1 : Math.max(0, 1 - (elapsed - travelDuration) / Math.max(0.001, duration - travelDuration));
        const drawCount = Math.max(0, Math.min(36, Math.ceil(travelP * 36))) * 6;
        ribbonOuter.setDrawRange(0, drawCount);
        ribbonInner.setDrawRange(0, drawCount);
        trailMats.current.forEach((material, i) => {
            if (material) material.opacity = Math.min(1, elapsed / 0.06) * linger * (i === 0 ? 0.28 : 0.58);
        });
        wakeGroups.current.forEach((group, i) => {
            if (!group) return;
            const wakeP = travelP - 0.055 - i * 0.075;
            group.visible = wakeP > 0 && wakeP < 1;
            if (!group.visible) return;
            const at = dashPathPoint(cue, wakeP, FLOOR_Y + 0.72);
            const ahead = dashPathPoint(cue, Math.min(1, wakeP + 0.025), FLOOR_Y + 0.72);
            group.position.set(at[0], at[1] + (i % 2 ? 0.13 : -0.06), at[2]);
            group.rotation.set(0, Math.atan2(ahead[0] - at[0], ahead[2] - at[2]), (i % 2 ? -1 : 1) * (0.18 + i * 0.06));
            group.scale.setScalar((impact ? 1 : 0.82) * (1 - i * 0.08));
            const material = wakeMats.current[i];
            if (material) material.opacity = linger * (0.9 - i * 0.12);
        });
        const landingP = Math.min(1, Math.max(0, (elapsed - travelDuration * 0.82) / Math.max(0.001, duration - travelDuration * 0.82)));
        const strikeOpen = 1 - Math.pow(1 - Math.min(1, landingP / 0.28), 3);
        const strikeFade = landingP < 0.54 ? 1 : Math.max(0, 1 - (landingP - 0.54) / 0.46);
        if (landingBurst.current) {
            landingBurst.current.visible = landingP > 0;
            landingBurst.current.scale.setScalar(strikeOpen * (impact ? 1.02 : 0.74));
            landingBurst.current.rotation.y = angle;
        }
        landingMats.current.forEach((material, i) => { if (material) material.opacity = strikeFade * (i % 2 ? 0.96 : 0.38); });
        if (groundRing.current) groundRing.current.scale.setScalar(0.42 + strikeOpen * (impact ? 1.7 : 1.05));
        if (groundMat.current) groundMat.current.opacity = strikeFade * (impact ? 0.66 : 0.42);
        if (landingLight.current) landingLight.current.intensity = strikeFade * Math.sin(Math.PI * landingP) * (impact ? 5.6 : 2.4);
        if (p >= 1 && !finished.current) { finished.current = true; onDone(); }
    });
    return (
        <group>
            <mesh geometry={ribbonOuter}>
                <meshToonMaterial ref={(material) => { trailMats.current[0] = material; }} color={palette.dark} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh geometry={ribbonInner}>
                <meshToonMaterial ref={(material) => { trailMats.current[1] = material; }} color={palette.body} emissive={palette.accent} emissiveIntensity={0.1} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {Array.from({ length: impact ? 5 : 3 }, (_, i) => (
                <group key={`dash-wake-${i}`} ref={(group) => { wakeGroups.current[i] = group; }} visible={false}>
                    <mesh geometry={wakeGeometry} position={[0, 0, -0.035]} scale={[1.12, 1.12, 1.15]}>
                        <meshToonMaterial color={palette.dark} transparent opacity={0.34} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={wakeGeometry}>
                        <meshToonMaterial ref={(material) => { wakeMats.current[i] = material; }} color={i % 2 ? palette.accent : palette.body} emissive={palette.accent} emissiveIntensity={0.08} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            ))}
            <group ref={landingBurst} position={[to[0], FLOOR_Y + 0.08, to[2]]} visible={false} scale={0.01}>
                {impactSpecs.map((spec, i) => (
                    <group key={`dash-contact-${i}`} position={[0.08 + (i % 2) * 0.12, spec.lift, (i - (impactSpecs.length - 1) * 0.5) * 0.2]} rotation={[0, (i - 2) * 0.055, spec.roll]}>
                        <mesh geometry={impactGeometries[i]} position={[0, 0, -0.025]} scale={[1.05, 1.05, 1.08]}>
                            <meshToonMaterial ref={(material) => { landingMats.current[i * 2] = material; }} color={palette.dark} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                        </mesh>
                        <mesh geometry={impactGeometries[i]}>
                            <meshToonMaterial ref={(material) => { landingMats.current[i * 2 + 1] = material; }} color={i % 3 === 0 ? palette.core : i % 2 ? palette.accent : palette.body} emissive={palette.accent} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                        </mesh>
                    </group>
                ))}
            </group>
            <mesh ref={groundRing} position={[to[0], FLOOR_Y + 0.035, to[2]]} rotation={[-Math.PI / 2, 0, angle]} scale={0.01}>
                <ringGeometry args={[0.52, 0.64, 40]} />
                <meshToonMaterial ref={groundMat} color={palette.accent} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <pointLight ref={landingLight} position={[to[0], FLOOR_Y + 1.0, to[2]]} color={palette.accent} intensity={0} distance={impact ? 7.5 : 4.5} decay={2} />
        </group>
    );
}

/** Elemental dash renderer used by the 3D duel. The path is still the authored
 * S-step used by the model, but its wake is now a chain of lit 3D element motes
 * and its arrival is the same volumetric contact system as every other move. */
function DuelDashEffectV2({ cue, clock, quality, onDone }: { cue: DuelDashCue; clock: { current: DuelClock }; quality: PetVisualQualityConfig; onDone: () => void }) {
    const trailMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const wakeMesh = useRef<THREE.InstancedMesh>(null);
    const wakeMat = useRef<THREE.MeshToonMaterial>(null);
    const contactGroup = useRef<THREE.Group>(null);
    const contactMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const completed = useRef(false);
    const { color, impact, kind, style } = cue;
    // Every certified 3D profile now receives a full elemental wake and impact
    // phrase. `generic` remains reserved for an unprofiled 2D fallback.
    const heroDash = style !== "generic";
    const palette = useMemo(() => duelFxPalette(kind, color), [kind, color]);
    const ribbonOuter = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.72, (impact ? 0.32 : 0.22) * (heroDash ? 1.55 : 1)), [cue, impact, heroDash]);
    const ribbonInner = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.73, (impact ? 0.12 : 0.085) * (heroDash ? 1.6 : 1)), [cue, impact, heroDash]);
    const ribbonLeft = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.7, (impact ? 0.105 : 0.075) * (heroDash ? 1.35 : 1), impact ? -0.36 : -0.26), [cue, impact, heroDash]);
    const ribbonRight = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.7, (impact ? 0.105 : 0.075) * (heroDash ? 1.35 : 1), impact ? 0.36 : 0.26), [cue, impact, heroDash]);
    const contactOuter = useMemo(() => makeDashContactGeometry(cue, heroDash ? 0.2 : 0.14, -0.7), [cue, heroDash]);
    const contactInner = useMemo(() => makeDashContactGeometry(cue, heroDash ? 0.085 : 0.06, 0.55), [cue, heroDash]);
    const moteDummy = useMemo(() => new THREE.Object3D(), []);
    const moteGeometry = useMemo<THREE.BufferGeometry>(() => {
        if (kind === "fire" || kind === "abyss") return new THREE.ConeGeometry(0.16, 0.68, 7);
        if (kind === "water") return new THREE.IcosahedronGeometry(0.21, 1);
        if (kind === "wind") return new THREE.TorusGeometry(0.25, 0.056, 6, 18, Math.PI * 1.55);
        if (kind === "lightning") return new THREE.TetrahedronGeometry(0.22, 0);
        if (kind === "earth") return new THREE.DodecahedronGeometry(0.21, 0);
        return new THREE.OctahedronGeometry(0.22, 0);
    }, [kind]);
    useEffect(() => () => {
        ribbonOuter.dispose();
        ribbonInner.dispose();
        ribbonLeft.dispose();
        ribbonRight.dispose();
        contactOuter.dispose();
        contactInner.dispose();
        moteGeometry.dispose();
    }, [contactInner, contactOuter, moteGeometry, ribbonInner, ribbonLeft, ribbonOuter, ribbonRight]);
    const moteCount = quality.id === "low" ? (heroDash ? 9 : 7) : quality.id === "medium" ? (heroDash ? (impact ? 15 : 13) : impact ? 12 : 9) : heroDash ? (impact ? 24 : 20) : impact ? 17 : 12;
    useEffect(() => {
        const mesh = wakeMesh.current;
        if (!mesh) return;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let index = 0; index < moteCount; index++) {
            mesh.setColorAt(index, new THREE.Color(index % 3 === 0 ? palette.core : index % 2 ? palette.accent : palette.body));
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, [moteCount, palette]);
    useFrame(() => {
        const tick = clock.current.t;
        const elapsed = Math.max(0, tick - cue.startTick) / DUEL_TPS;
        const travelP = dashCueTravelProgress(cue, tick);
        const linger = tick <= cue.contactTick ? 1 : Math.max(0, 1 - (tick - cue.contactTick) / Math.max(1, cue.endTick - cue.contactTick));
        // Draw a moving tail behind the pet instead of leaving a static beam
        // across the whole route. The moving head now makes the travel readable.
        const headSegments = Math.max(0, Math.min(36, Math.ceil(travelP * 36)));
        const tailSegments = impact ? 18 : 13;
        const startSegment = Math.max(0, headSegments - tailSegments);
        ribbonOuter.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        ribbonInner.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        ribbonLeft.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        ribbonRight.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        trailMats.current.forEach((material, index) => {
            if (!material) return;
            const layerOpacity = index === 0
                ? (heroDash ? 0.42 : 0.24)
                : index === 1
                    ? (heroDash ? 0.84 : 0.58)
                    : (heroDash ? 0.58 : 0.38);
            material.opacity = Math.min(1, elapsed / 0.055) * linger * layerOpacity;
        });
        const wake = wakeMesh.current;
        if (wake) for (let index = 0; index < moteCount; index++) {
            const wakeP = travelP - 0.025 - index * (impact ? 0.036 : 0.052);
            const visible = wakeP > 0.02 && wakeP < 1;
            if (visible) {
                const at = dashPathPoint(cue, wakeP, FLOOR_Y + 0.72);
                const ahead = dashPathPoint(cue, Math.min(1, wakeP + 0.018), FLOOR_Y + 0.72);
                moteDummy.position.set(at[0], at[1] + Math.sin(index * 2.1) * 0.27, at[2]);
                moteDummy.rotation.set(index * 0.42, Math.atan2(ahead[0] - at[0], ahead[2] - at[2]), elapsed * (4.2 + index * 0.18));
                const taper = Math.max(0.18, 1 - index / moteCount * 0.58);
                const pulse = 0.82 + Math.sin(elapsed * 15 + index) * 0.12;
                moteDummy.scale.setScalar((impact ? 1.34 : 1.02) * (heroDash ? 1.34 : 1) * taper * pulse);
            } else {
                moteDummy.position.set(0, -50, 0);
                moteDummy.rotation.set(0, 0, 0);
                moteDummy.scale.setScalar(0.001);
            }
            moteDummy.updateMatrix();
            wake.setMatrixAt(index, moteDummy.matrix);
        }
        if (wake) wake.instanceMatrix.needsUpdate = true;
        if (wakeMat.current) wakeMat.current.opacity = linger * (heroDash ? 0.78 : 0.64);
        const contactAge = Math.max(0, tick - cue.contactTick);
        const contactLife = impact && tick >= cue.contactTick && contactAge <= 8;
        if (contactGroup.current) contactGroup.current.visible = contactLife;
        if (contactLife) {
            const contactP = Math.min(1, contactAge / 8);
            const punch = Math.sin(Math.PI * Math.min(1, contactP * 1.65));
            contactMats.current.forEach((material, index) => {
                if (material) material.opacity = (index === 0 ? 0.62 : 0.98) * Math.max(0, 1 - contactP) * (0.72 + punch * 0.28);
            });
        }
        if (tick >= cue.endTick && !completed.current) {
            completed.current = true;
            onDone();
        }
    });
    const impactDelay = Math.max(0, cue.contactTick - cue.startTick) / DUEL_TPS;
    return (
        <group>
            <mesh geometry={ribbonOuter} renderOrder={28}>
                <meshToonMaterial ref={(material) => { trailMats.current[0] = material; }} color={palette.dark} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh geometry={ribbonInner} renderOrder={29}>
                <meshToonMaterial ref={(material) => { trailMats.current[1] = material; }} color={palette.accent} emissive={palette.body} emissiveIntensity={0.18} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh geometry={ribbonLeft} renderOrder={29}>
                <meshToonMaterial ref={(material) => { trailMats.current[2] = material; }} color={palette.body} emissive={palette.accent} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh geometry={ribbonRight} renderOrder={29}>
                <meshToonMaterial ref={(material) => { trailMats.current[3] = material; }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.1} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <instancedMesh ref={wakeMesh} args={[moteGeometry, undefined, moteCount]} frustumCulled={false} renderOrder={30}>
                <meshToonMaterial ref={wakeMat} color="#ffffff" vertexColors emissive={palette.accent} emissiveIntensity={0.14} transparent opacity={0} depthWrite={kind === "earth"} />
            </instancedMesh>
            <group ref={contactGroup} visible={false}>
                <mesh geometry={contactOuter} renderOrder={34}>
                    <meshToonMaterial ref={(material) => { contactMats.current[0] = material; }} color={palette.body} emissive={palette.accent} emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} />
                </mesh>
                <mesh geometry={contactInner} renderOrder={35}>
                    <meshToonMaterial ref={(material) => { contactMats.current[1] = material; }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.28} transparent opacity={0} depthWrite={false} />
                </mesh>
            </group>
            {impact && <DuelElementVolume at={[cue.impactAt[0], FLOOR_Y + 0.08, cue.impactAt[2]]} kind={kind} color={color} big heading={Math.atan2(cue.impactAt[0] - cue.to[0], cue.impactAt[2] - cue.to[2])} phase="dash" quality={quality} heroStyle={style} delay={impactDelay} onDone={() => undefined} />}
        </group>
    );
}

/** A presentation-only elemental exchange used inside genuinely empty replay
 * pockets. Each pet fires a short, solid-color toon bolt and the two techniques
 * collide at center. It adds combat intent without inventing damage or changing
 * the deterministic duel result. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelPressureClash({ from, to, leftColor, rightColor, onDone }: { from: Vec3; to: Vec3; leftColor: string; rightColor: string; onDone: () => void }) {
    const leftBolt = useRef<THREE.Group>(null);
    const rightBolt = useRef<THREE.Group>(null);
    const burst = useRef<THREE.Group>(null);
    const boltMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const burstMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const arcMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const duration = 0.92;
    const midpoint = useMemo<Vec3>(() => [(from[0] + to[0]) * 0.5, FLOOR_Y + 0.86, (from[2] + to[2]) * 0.5], [from, to]);
    const leftStart = useMemo<Vec3>(() => [from[0], FLOOR_Y + 0.72, from[2]], [from]);
    const rightStart = useMemo<Vec3>(() => [to[0], FLOOR_Y + 0.72, to[2]], [to]);
    const leftBody = useMemo(() => new THREE.Color(leftColor).multiplyScalar(0.56).getStyle(), [leftColor]);
    const rightBody = useMemo(() => new THREE.Color(rightColor).multiplyScalar(0.56).getStyle(), [rightColor]);
    const coreColor = useMemo(() => new THREE.Color(leftColor).lerp(new THREE.Color(rightColor), 0.5).multiplyScalar(0.72).getStyle(), [leftColor, rightColor]);
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const leftHeading = Math.atan2(dx, dz);

    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / duration);
        const travelP = Math.min(1, p / 0.54);
        const travel = 1 - Math.pow(1 - travelP, 3);
        const collisionP = Math.max(0, (p - 0.46) / 0.54);
        const boltFade = p < 0.48 ? 1 : Math.max(0, 1 - (p - 0.48) / 0.13);
        const burstRise = 1 - Math.pow(1 - Math.min(1, collisionP * 2.25), 3);
        const burstFade = collisionP < 0.58 ? 1 : Math.max(0, 1 - (collisionP - 0.58) / 0.42);
        const placeBolt = (group: THREE.Group | null, origin: Vec3, heading: number, arc: number) => {
            if (!group) return;
            group.position.set(
                lerp(origin[0], midpoint[0], travel),
                lerp(origin[1], midpoint[1], travel) + Math.sin(Math.PI * travelP) * arc,
                lerp(origin[2], midpoint[2], travel),
            );
            group.rotation.y = heading;
            group.scale.setScalar(0.56 + Math.sin(Math.PI * travelP) * 0.22);
        };
        placeBolt(leftBolt.current, leftStart, leftHeading, 0.38);
        placeBolt(rightBolt.current, rightStart, leftHeading + Math.PI, -0.12);
        boltMats.current.forEach((material) => { if (material) material.opacity = boltFade * 0.94; });
        if (burst.current) {
            burst.current.scale.setScalar(Math.max(0.001, burstRise * (0.88 + collisionP * 0.42)));
            burst.current.rotation.y = collisionP * 2.1;
        }
        burstMats.current.forEach((material, index) => { if (material) material.opacity = burstFade * (index === 0 ? 0.96 : 0.78); });
        arcMats.current.forEach((material, index) => { if (material) material.opacity = burstFade * (0.72 - index * 0.11); });
        if (light.current) light.current.intensity = burstFade * burstRise * 3.4;
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });

    const renderBolt = (side: "left" | "right", body: string, accent: string, ref: React.RefObject<THREE.Group | null>, offset: number) => (
        <group ref={ref} key={`pressure-${side}`}>
            <mesh scale={[0.44, 0.54, 0.82]}>
                <octahedronGeometry args={[1, 0]} />
                <meshToonMaterial ref={(material) => { boltMats.current[offset] = material; }} color={body} emissive={accent} emissiveIntensity={0.18} transparent opacity={0} depthWrite={false} />
            </mesh>
            <mesh scale={[0.29, 0.36, 0.9]}>
                <octahedronGeometry args={[1, 0]} />
                <meshToonMaterial ref={(material) => { boltMats.current[offset + 1] = material; }} color={accent} emissive={accent} emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} />
            </mesh>
            {[-1, 1].map((direction, index) => (
                <mesh key={`${side}-pressure-fin-${index}`} position={[direction * 0.23, 0, -0.08]} rotation={[Math.PI / 2, direction * 0.28, direction * 0.64]} scale={[0.64, 0.8, 0.64]}>
                    <torusGeometry args={[0.34, 0.05, 7, 24, Math.PI * 0.88]} />
                    <meshToonMaterial ref={(material) => { boltMats.current[offset + 2 + index] = material; }} color={index === 0 ? accent : body} emissive={accent} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} />
                </mesh>
            ))}
            {[0, 1].map((index) => (
                <mesh key={`${side}-pressure-tail-${index}`} position={[0, 0, -0.62 - index * 0.42]} rotation={[Math.PI / 2, 0, 0]} scale={1 - index * 0.24}>
                    <coneGeometry args={[0.3, 1.15 + index * 0.34, 7, 1, true]} />
                    <meshToonMaterial ref={(material) => { boltMats.current[offset + index + 4] = material; }} color={index === 0 ? accent : body} emissive={accent} emissiveIntensity={0.1} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            ))}
        </group>
    );

    return (
        <group>
            {renderBolt("left", leftBody, leftColor, leftBolt, 0)}
            {renderBolt("right", rightBody, rightColor, rightBolt, 6)}
            <group ref={burst} position={midpoint} scale={0.001}>
                <mesh scale={[1.12, 0.92, 0.78]}>
                    <octahedronGeometry args={[0.74, 0]} />
                    <meshToonMaterial ref={(material) => { burstMats.current[0] = material; }} color={coreColor} emissive={coreColor} emissiveIntensity={0.3} transparent opacity={0} depthWrite={false} />
                </mesh>
                {[0, 1].map((index) => (
                    <mesh key={`pressure-arc-${index}`} rotation={[Math.PI / 2 + index * 0.42, index * 1.24, index * 0.68]} scale={1 + index * 0.32}>
                        <torusGeometry args={[0.9, 0.085 - index * 0.016, 7, 28, Math.PI * 1.42]} />
                        <meshToonMaterial ref={(material) => { arcMats.current[index] = material; }} color={index === 0 ? leftColor : rightColor} emissive={index === 0 ? leftColor : rightColor} emissiveIntensity={0.18} transparent opacity={0} depthWrite={false} />
                    </mesh>
                ))}
                {Array.from({ length: 10 }, (_, index) => {
                    const angle = (index / 10) * Math.PI * 2;
                    const radius = 0.82 + (index % 3) * 0.18;
                    return (
                        <mesh key={`pressure-shard-${index}`} position={[Math.cos(angle) * radius, (index % 4 - 1.5) * 0.23, Math.sin(angle) * radius]} rotation={[angle * 0.4, -angle, (index % 2 ? -1 : 1) * 0.72]} scale={[0.11, 0.38 + (index % 3) * 0.09, 0.11]}>
                            <octahedronGeometry args={[1, 0]} />
                            <meshToonMaterial ref={(material) => { burstMats.current[index + 1] = material; }} color={index % 2 === 0 ? leftColor : rightColor} emissive={index % 2 === 0 ? leftColor : rightColor} emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} />
                        </mesh>
                    );
                })}
            </group>
            <pointLight ref={light} position={midpoint} color={coreColor} intensity={0} distance={6.5} decay={2} />
        </group>
    );
}

function makePressureStreamGeometry(from: Vec3, to: Vec3, side: number, radius: number): THREE.TubeGeometry {
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const sideX = -dz / length, sideZ = dx / length;
    const points = Array.from({ length: 30 }, (_, index) => {
        const u = index / 29;
        const braid = Math.sin(u * Math.PI * 4 + side * 0.8) * Math.sin(Math.PI * u) * 0.13;
        const bow = Math.sin(Math.PI * u) * side * 0.34;
        return new THREE.Vector3(
            lerp(from[0], to[0], u) + sideX * (bow + braid),
            lerp(from[1], to[1], u) + Math.sin(Math.PI * u) * (0.32 + Math.abs(side) * 0.08),
            lerp(from[2], to[2], u) + sideZ * (bow + braid),
        );
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, radius, 7, false);
}

/** Presentation-only neutral exchange rebuilt as two braided 3D energy streams.
 * The previous octahedron at center was the most obvious surviving “fake icon”
 * in the fight; this version grows through world space and throws physical
 * fragments out of its collision volume. */
function DuelPressureClashV2({ from, to, leftColor, rightColor, leftKind, rightKind, quality, onDone }: { from: Vec3; to: Vec3; leftColor: string; rightColor: string; leftKind: DuelElementBurstKind; rightKind: DuelElementBurstKind; quality: PetVisualQualityConfig; onDone: () => void }) {
    const streamMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const collision = useRef<THREE.Group>(null);
    const leftProjectile = useRef<THREE.Group>(null);
    const rightProjectile = useRef<THREE.Group>(null);
    const fragments = useRef<Array<THREE.Mesh | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const midpoint = useMemo<Vec3>(() => [(from[0] + to[0]) * 0.5, FLOOR_Y + 0.9, (from[2] + to[2]) * 0.5], [from, to]);
    const leftStart = useMemo<Vec3>(() => [from[0], FLOOR_Y + 0.72, from[2]], [from]);
    const rightStart = useMemo<Vec3>(() => [to[0], FLOOR_Y + 0.72, to[2]], [to]);
    const streams = useMemo(() => [
        makePressureStreamGeometry(leftStart, midpoint, 1, 0.075),
        makePressureStreamGeometry(leftStart, midpoint, -0.6, 0.034),
        makePressureStreamGeometry(rightStart, midpoint, -1, 0.075),
        makePressureStreamGeometry(rightStart, midpoint, 0.6, 0.034),
    ], [leftStart, midpoint, rightStart]);
    useEffect(() => () => streams.forEach((geometry) => geometry.dispose()), [streams]);
    const coreColor = useMemo(() => new THREE.Color(leftColor).lerp(new THREE.Color(rightColor), 0.5).getStyle(), [leftColor, rightColor]);
    const leftVisual = useMemo(() => projectileVisual({ element: leftKind, charged: true }), [leftKind]);
    const rightVisual = useMemo(() => projectileVisual({ element: rightKind, charged: true }), [rightKind]);
    const leftHeading = Math.atan2(-(midpoint[2] - leftStart[2]), midpoint[0] - leftStart[0]);
    const rightHeading = Math.atan2(-(midpoint[2] - rightStart[2]), midpoint[0] - rightStart[0]);
    const fragmentCount = quality.id === "low" ? 6 : 12;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / 1.0);
        const travel = Math.min(1, p / 0.48);
        const streamFade = p < 0.52 ? 1 : Math.max(0, 1 - (p - 0.52) / 0.18);
        streams.forEach((geometry) => geometry.setDrawRange(0, Math.ceil((geometry.index?.count ?? 0) * travel)));
        streamMats.current.forEach((material, index) => { if (material) material.opacity = streamFade * (index % 2 ? 0.72 : 0.94); });
        const placeProjectile = (group: THREE.Group | null, origin: Vec3, heading: number, bow: number) => {
            if (!group) return;
            group.visible = p < 0.56;
            group.position.set(lerp(origin[0], midpoint[0], travel), lerp(origin[1], midpoint[1], travel) + Math.sin(Math.PI * travel) * bow, lerp(origin[2], midpoint[2], travel));
            group.rotation.y = heading;
            // Keep the physical cores secondary to the painted pressure streams.
            // The former near-unit spheres read as detached cyan blobs.
            group.scale.setScalar(0.46 + Math.sin(Math.PI * travel) * 0.14);
        };
        placeProjectile(leftProjectile.current, leftStart, leftHeading, 0.28);
        placeProjectile(rightProjectile.current, rightStart, rightHeading, -0.06);
        const hitP = Math.max(0, (p - 0.42) / 0.58);
        const open = 1 - Math.pow(1 - Math.min(1, hitP * 2.2), 3);
        const fade = hitP < 0.58 ? 1 : Math.max(0, 1 - (hitP - 0.58) / 0.42);
        if (collision.current) {
            collision.current.visible = hitP > 0;
            collision.current.rotation.set(hitP * 0.72, hitP * 2.4, -hitP * 0.48);
            collision.current.scale.setScalar(Math.max(0.001, open * (0.92 + hitP * 0.46)));
        }
        fragments.current.forEach((fragment, index) => {
            if (!fragment) return;
            const angle = index * 2.399;
            fragment.position.set(Math.cos(angle) * hitP * (0.7 + index % 3 * 0.18), Math.sin(Math.PI * hitP) * (0.45 + index % 4 * 0.13), Math.sin(angle) * hitP * (0.7 + index % 3 * 0.18));
            fragment.rotation.set(hitP * (4 + index), angle, -hitP * (3 + index % 4));
            fragment.scale.setScalar(fade * (0.08 + index % 3 * 0.025));
        });
        if (light.current) light.current.intensity = fade * open * 4.2;
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });
    return (
        <group>
            {streams.map((geometry, index) => (
                <mesh key={`pressure-stream-${index}`} geometry={geometry} renderOrder={29 + index % 2}>
                    <meshToonMaterial ref={(material) => { streamMats.current[index] = material; }} color={index < 2 ? (index % 2 ? "#fff3d0" : leftColor) : index % 2 ? "#e7f7ff" : rightColor} emissive={index < 2 ? leftColor : rightColor} emissiveIntensity={0.16} transparent opacity={0} depthWrite={false} />
                </mesh>
            ))}
            <group ref={leftProjectile}><NativeProjectileBody visual={leftVisual} quality={quality} /></group>
            <group ref={rightProjectile}><NativeProjectileBody visual={rightVisual} quality={quality} /></group>
            <group ref={collision} position={midpoint} visible={false} scale={0.001}>
                {Array.from({ length: fragmentCount }, (_, index) => (
                    <mesh key={`pressure-volume-fragment-${index}`} ref={(mesh) => { fragments.current[index] = mesh; }} scale={0.01}>
                        <tetrahedronGeometry args={[1, 0]} />
                        <meshToonMaterial color={index % 2 ? rightColor : leftColor} emissive={coreColor} emissiveIntensity={0.08} />
                    </mesh>
                ))}
            </group>
            <DuelElementVolume at={midpoint} kind={leftKind} color={leftColor} big={false} heading={leftHeading} phase="contact" quality={quality} delay={0.42} onDone={() => undefined} />
            <DuelElementVolume at={midpoint} kind={rightKind} color={rightColor} big={false} heading={rightHeading} phase="contact" quality={quality} delay={0.42} onDone={() => undefined} />
            {quality.dynamicPetLight && <pointLight ref={light} position={midpoint} color={coreColor} intensity={0} distance={7} decay={2} />}
        </group>
    );
}

/** Ground SHOCKWAVE — flat expanding rings on the floor at the impact point that
 *  drive force into the arena; bigger + brighter on heavy/crit blows. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelShockwave({ at, color, big, onDone }: { at: Vec3; color: string; big: boolean; onDone: () => void }) {
    const r1 = useRef<THREE.Mesh>(null);
    const m1 = useRef<THREE.MeshToonMaterial>(null);
    const r2 = useRef<THREE.Mesh>(null);
    const m2 = useRef<THREE.MeshToonMaterial>(null);
    const start = useRef<number | null>(null);
    const DUR = big ? 0.62 : 0.4;
    const maxR = big ? 3.05 : 1.55;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / DUR);
        const ease = 1 - (1 - p) * (1 - p);
        if (r1.current) r1.current.scale.setScalar(0.3 + ease * maxR);
        if (m1.current) m1.current.opacity = (1 - p) * 0.46;
        if (r2.current) r2.current.scale.setScalar(0.2 + Math.max(0, ease - 0.15) * maxR * 0.7);
        if (m2.current) m2.current.opacity = (1 - p) * 0.3;
        if (p >= 1) onDone();
    });
    return (
        <group position={[at[0], 0.05, at[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh ref={r1}>
                <torusGeometry args={[0.94, 0.065, 7, 40]} />
                <meshToonMaterial ref={m1} color={color} emissive={color} emissiveIntensity={0.18} transparent opacity={0.46} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={r2}>
                <torusGeometry args={[0.94, 0.034, 6, 40]} />
                <meshToonMaterial ref={m2} color={color} emissive={color} emissiveIntensity={0.1} transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
        </group>
    );
}

/** A restrained 3D anime power-up column. Short faceted flame tongues rise
 * around the pet while leaving its silhouette readable. Their compact volume
 * avoids both the old glass cage and edge-on brush cards. */
function DuelPowerUpAura({ at, color, quality, actorId, duel, clock, heroStyle = "generic", onDone }: { at: Vec3; color: string; quality: PetVisualQualityConfig; actorId?: string; duel: DuelResult; clock: { current: DuelClock }; heroStyle?: PetHeroMoveStyle; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const floorPulse = useRef<THREE.Group>(null);
    const floorMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const auraStrokes = useRef<Array<THREE.Mesh | null>>([]);
    const auraStrokeMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const kitsuneCast = heroStyle === "kitsune-tail-cast";
    const duration = kitsuneCast ? 1.24 : 1.14;
    const auraCount = quality.id === "low" ? 8 : quality.id === "medium" ? 11 : 13;
    // Keep the body color saturated. A large white mix plus additive blending
    // turned water and wind buffs into the same frosted-glass cage.
    const auraCore = useMemo(() => new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.32).getStyle(), [color]);
    const auraDark = useMemo(() => new THREE.Color(color).multiplyScalar(0.28).getStyle(), [color]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / duration);
        const arrive = 1 - Math.pow(1 - Math.min(1, p / 0.16), 3);
        const fade = p < 0.72 ? 1 : Math.max(0, 1 - (p - 0.72) / 0.28);
        const pulse = 0.94 + Math.sin(elapsed * 28) * 0.045;
        if (root.current) {
            const live = liveDuelEffectPosition(duel, clock, actorId);
            if (live) root.current.position.set(live.wx, at[1], live.wz);
            const heroScale = kitsuneCast ? 1.22 : 1;
            root.current.scale.set(pulse * arrive * heroScale, arrive * (0.82 + 0.18 * pulse) * heroScale, pulse * arrive * heroScale);
        }
        if (floorPulse.current) {
            floorPulse.current.rotation.y = elapsed * 1.12;
            const floorScale = 0.7 + arrive * 0.38 + Math.sin(elapsed * 11) * 0.025;
            floorPulse.current.scale.setScalar(Math.max(0.001, floorScale));
        }
        floorMats.current.forEach((material, index) => {
            if (material) material.opacity = fade * arrive * (index === 0 ? 0.28 : 0.66);
        });
        auraStrokes.current.forEach((stroke, index) => {
            if (!stroke) return;
            const u = index / Math.max(1, auraCount);
            const lift = (p * 1.72 + u) % 1;
            const angle = u * Math.PI * 2 + elapsed * (index % 2 ? -0.62 : 0.52);
            const radius = 0.54 + (index % 3) * 0.13 + Math.sin(elapsed * 9 + index) * 0.035;
            stroke.position.set(Math.cos(angle) * radius, 0.2 + lift * 1.82, Math.sin(angle) * radius);
            stroke.rotation.set(Math.sin(angle) * 0.12, angle, Math.cos(angle) * -0.18);
            const widthPulse = 0.72 + Math.sin(elapsed * 15 + index * 1.7) * 0.1;
            stroke.scale.set(widthPulse * (0.94 - lift * 0.2), 0.68 + Math.sin(Math.PI * lift) * 0.78, widthPulse * (0.94 - lift * 0.2));
            const material = auraStrokeMats.current[index];
            if (material) material.opacity = fade * (0.28 + Math.sin(Math.PI * lift) * 0.72) * (index % 3 === 0 ? 0.94 : 0.8);
        });
        if (light.current) light.current.intensity = fade * arrive * (1.7 + Math.abs(Math.sin(elapsed * 18)) * 0.9);
        if (p >= 1) onDone();
    });
    return (
        <group ref={root} position={[at[0], 0.03, at[2]]} scale={0.01}>
            <group ref={floorPulse} position={[0, 0.018, 0]}>
                <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={27}>
                    <ringGeometry args={[0.2, 1.14, quality.id === "low" ? 28 : 48]} />
                    <meshToonMaterial ref={(material) => { floorMats.current[0] = material; }} color={auraDark} emissive={color} emissiveIntensity={0.05} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh rotation={[-Math.PI / 2, 0, Math.PI / 6]} renderOrder={28}>
                    <ringGeometry args={[1.27, 1.38, quality.id === "low" ? 28 : 48]} />
                    <meshToonMaterial ref={(material) => { floorMats.current[1] = material; }} color={auraCore} emissive={color} emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            {Array.from({ length: auraCount }, (_, index) => (
                <mesh key={`power-flame-${index}`} ref={(mesh) => { auraStrokes.current[index] = mesh; }} renderOrder={30}>
                    <coneGeometry args={[0.27 + (index % 3) * 0.035, 1.08 + (index % 2) * 0.16, 5]} />
                    <meshToonMaterial
                        ref={(material) => { auraStrokeMats.current[index] = material; }}
                        color={index % 3 === 0 ? auraCore : color}
                        emissive={color}
                        emissiveIntensity={0.2}
                        transparent
                        opacity={0}
                        depthWrite={false}
                    />
                </mesh>
            ))}
            <Sparkles count={Math.max(8, Math.round(quality.setPieceParticles * 0.5))} scale={[2.6, 3.7, 2.6]} position={[0, 1.7, 0]} size={2.5} speed={1.72} opacity={0.66} color={color} noise={0.5} />
            {quality.translucentLayers > 1 && <Sparkles count={Math.max(4, Math.round(quality.setPieceParticles * 0.2))} scale={[3.0, 0.38, 3.0]} position={[0, 0.17, 0]} size={1.8} speed={0.48} opacity={0.34} color={auraCore} noise={0.65} />}
            {quality.dynamicPetLight && <pointLight ref={light} color={color} intensity={0} distance={6.4} decay={2} position={[0, 1.25, 0]} />}
        </group>
    );
}

function _makeWaveVolumeGeometry(): THREE.BufferGeometry {
    const sx = 30, sy = 14;
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let iy = 0; iy <= sy; iy++) {
        const v = iy / sy;
        for (let ix = 0; ix <= sx; ix++) {
            const u = ix / sx;
            const x = (u - 0.5) * 5.2;
            // A broad shoulder reads as a wall of water. The former single sharp
            // peak made the mesh look like a triangular shield from the broadcast
            // camera, especially after it was enlarged.
            const crestProfile = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.48);
            const curlShoulder = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, u * 1.18))), 1.8);
            const height = 1.12 + 1.52 * crestProfile + 0.42 * curlShoulder;
            const curl = v < 0.62 ? v * 0.18 : 0.11 + ((v - 0.62) / 0.38) * (0.72 + 0.38 * curlShoulder);
            const ripple = Math.sin(u * Math.PI * 7 + v * 3.2) * 0.055 * (0.3 + v);
            positions.push(x, 0.03 + v * height, -0.28 + curl + ripple);
            uvs.push(u, v);
        }
    }
    for (let iy = 0; iy < sy; iy++) for (let ix = 0; ix < sx; ix++) {
        const a = iy * (sx + 1) + ix, b = a + 1, c = a + sx + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function _makeWaveCrestGeometry(): THREE.TubeGeometry {
    const points = Array.from({ length: 13 }, (_, i) => {
        const u = i / 12;
        const x = (u - 0.5) * 5.2;
        const crestProfile = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.48);
        const curlShoulder = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, u * 1.18))), 1.8);
        return new THREE.Vector3(x, 1.16 + 1.52 * crestProfile + 0.42 * curlShoulder, 0.72 + Math.sin(u * Math.PI * 4) * 0.06);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 0.115, 7, false);
}

function makeFlamePetalGeometry(height: number, radius: number, bend: number): THREE.BufferGeometry {
    // Enough curvature to keep the flame silhouette stylized, without the visibly
    // faceted paper-shard look from the first arena-scale burst.
    const rings = 10, sides = 10;
    const positions: number[] = [], indices: number[] = [];
    for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings;
        const rr = Math.max(0.025, radius * Math.pow(1 - t, 0.72));
        const centerZ = bend * t * t;
        for (let side = 0; side < sides; side++) {
            const a = (side / sides) * Math.PI * 2;
            positions.push(Math.cos(a) * rr, t * height, centerZ + Math.sin(a) * rr);
        }
    }
    for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
        const next = (side + 1) % sides;
        const a = ring * sides + side, b = ring * sides + next;
        const c = (ring + 1) * sides + side, d = (ring + 1) * sides + next;
        indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/** A tapered, curling energy tongue. Unlike a cone or a straight radial petal,
 * its centreline changes direction as it rises, so a cluster reads as flowing
 * flame/ki from every camera angle instead of a crown of rigid crystals. */
function makeFlameRibbonGeometry(height: number, radius: number, sway: number, phase: number): THREE.BufferGeometry {
    const rings = 16, sides = 9;
    const positions: number[] = [], indices: number[] = [];
    for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings;
        const envelope = Math.pow(1 - t, 0.72) * (0.58 + Math.sin(Math.PI * t) * 0.52);
        const rr = Math.max(0.012, radius * envelope);
        const turn = phase + t * (2.4 + (phase % 0.7));
        const cx = Math.sin(turn) * sway * t * t;
        const cz = Math.cos(turn * 0.86) * sway * t * t;
        for (let side = 0; side < sides; side++) {
            const a = (side / sides) * Math.PI * 2;
            positions.push(cx + Math.cos(a) * rr, t * height, cz + Math.sin(a) * rr);
        }
    }
    for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
        const next = (side + 1) % sides;
        const a = ring * sides + side, b = ring * sides + next;
        const c = (ring + 1) * sides + side, d = (ring + 1) * sides + next;
        indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

// The tornado mist sheet is deterministic (no args, no RNG); build it once and
// reuse it across every tornado set-piece instead of rasterizing a fresh 128x256
// canvas + a GL upload on the exact frame each cyclone spawns.
let _tornadoMistTexture: THREE.CanvasTexture | null = null;
function tornadoMistTexture(): THREE.CanvasTexture { return (_tornadoMistTexture ??= makeTornadoMistTexture()); }
function makeTornadoMistTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128; canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const fade = ctx.createLinearGradient(0, 0, 0, canvas.height);
    fade.addColorStop(0, "rgba(218,255,248,0.72)");
    fade.addColorStop(0.45, "rgba(79,216,191,0.34)");
    fade.addColorStop(1, "rgba(11,102,100,0.02)");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fade;
    ctx.lineCap = "round";
    for (let i = 0; i < 7; i++) {
        ctx.lineWidth = 3 + (i % 3) * 1.5;
        ctx.beginPath();
        const y = 20 + i * 35;
        ctx.moveTo(-16, y + 12);
        ctx.bezierCurveTo(30, y - 18, 94, y + 28, 145, y - 7);
        ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

/** A pressure volume rather than two floor decals: the leading edge is a short
 * vertical wall with lifted arena debris, while a thin floor rim only anchors
 * it to the point of contact. */
function DuelShockwaveV2({ at, color, big, quality, onDone }: { at: Vec3; color: string; big: boolean; quality: PetVisualQualityConfig; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const wall = useRef<THREE.Mesh>(null);
    const wallMat = useRef<THREE.MeshToonMaterial>(null);
    const rim = useRef<THREE.Mesh>(null);
    const rimMat = useRef<THREE.MeshToonMaterial>(null);
    const debris = useRef<Array<THREE.Mesh | null>>([]);
    const debrisMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const duration = big ? 0.68 : 0.46;
    const count = quality.id === "low" ? 5 : big ? 12 : 8;
    const dark = useMemo(() => new THREE.Color(color).multiplyScalar(0.3).getStyle(), [color]);
    const core = useMemo(() => new THREE.Color(color).lerp(new THREE.Color("#fff0c4"), 0.26).getStyle(), [color]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / duration);
        const open = 1 - Math.pow(1 - p, 2);
        const fade = Math.pow(1 - p, 1.25);
        if (root.current) root.current.rotation.y = p * 0.42;
        if (wall.current) wall.current.scale.set((0.18 + open * (big ? 3.4 : 1.85)), 0.4 + Math.sin(Math.PI * p) * (big ? 1.2 : 0.72), (0.18 + open * (big ? 3.4 : 1.85)));
        if (rim.current) rim.current.scale.setScalar(0.2 + open * (big ? 3.15 : 1.72));
        if (wallMat.current) wallMat.current.opacity = fade * (big ? 0.42 : 0.32);
        if (rimMat.current) rimMat.current.opacity = fade * 0.56;
        debris.current.forEach((piece, index) => {
            if (!piece) return;
            const angle = index * 2.399;
            const radius = open * (0.38 + (index % 4) * (big ? 0.42 : 0.24));
            piece.position.set(Math.cos(angle) * radius, 0.08 + Math.sin(Math.PI * p) * (0.32 + (index % 3) * 0.16), Math.sin(angle) * radius);
            piece.rotation.set(p * (4 + index), angle, -p * (5 + index % 3));
            piece.scale.setScalar((big ? 0.16 : 0.105) * fade * (0.74 + index % 3 * 0.16));
            if (debrisMats.current[index]) debrisMats.current[index]!.opacity = fade * 0.78;
        });
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });
    return (
        <group ref={root} position={[at[0], FLOOR_Y + 0.035, at[2]]}>
            <mesh ref={wall} position={[0, 0.2, 0]} scale={0.01} renderOrder={26}>
                <cylinderGeometry args={[1, 0.84, 0.52, quality.id === "low" ? 24 : 42, 1, true]} />
                <meshToonMaterial ref={wallMat} color={dark} emissive={color} emissiveIntensity={0.08} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={rim} rotation={[-Math.PI / 2, 0, 0]} scale={0.01} renderOrder={27}>
                <torusGeometry args={[0.92, big ? 0.055 : 0.042, 7, quality.id === "low" ? 28 : 48]} />
                <meshToonMaterial ref={rimMat} color={core} emissive={color} emissiveIntensity={0.14} transparent opacity={0} depthWrite={false} />
            </mesh>
            {Array.from({ length: count }, (_, index) => (
                <mesh key={`shock-debris-${index}`} ref={(mesh) => { debris.current[index] = mesh; }} scale={0.01} castShadow>
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshToonMaterial ref={(material) => { debrisMats.current[index] = material; }} color={index % 3 === 0 ? core : index % 2 ? color : dark} transparent opacity={0} />
                </mesh>
            ))}
        </group>
    );
}

function makeTornadoTube(phase: number): THREE.TubeGeometry {
    // A fast, clean tapered spiral. Fewer turns and a thinner cross-section keep
    // the silhouette readable; the earlier dense spring plus transparent cones
    // looked like a stack of overlapping primitives from the broadcast camera.
    const points = Array.from({ length: 34 }, (_, i) => {
        const t = i / 33;
        const a = phase + t * Math.PI * 3.25;
        const radius = 0.12 + Math.pow(t, 0.72) * 1.34;
        return new THREE.Vector3(Math.cos(a) * radius, 0.08 + t * 3.8, Math.sin(a) * radius);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, 0.062, 8, false);
}

/** Arena-scale signature spectacle. These are procedural 3D shapes rather than a
 * billboard enlarged until it blurs: Water travels as a cresting wall, Wind owns
 * vertical space as a rotating funnel, and Fire blooms outward in layered flame
 * petals. They remain translucent so the pets stay readable through the effect. */
// Retained temporarily as a comparison/fallback while the live coliseum uses
// DuelAnimeSetPiece. Keeping the component name uppercase preserves hook rules.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DuelElementSetPiece({ kind, from, to, color, quality, onDone }: {
    kind: DuelSetPieceKind; from: Vec3; to: Vec3; color: string; quality: PetVisualQualityConfig; onDone: () => void;
}) {
    const root = useRef<THREE.Group>(null);
    const materials = useRef<Array<THREE.Material & { opacity: number }>>([]);
    const flameMeshes = useRef<THREE.Mesh[]>([]);
    const flameLight = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const abyssal = kind === "abyssBurst";
    const flameLike = kind === "flameBurst";
    const tornadoMist = useMemo(() => kind === "tornado" ? tornadoMistTexture() : null, [kind]);
    const flamePetalCount = quality.id === "low" ? 6 : quality.id === "medium" ? 7 : 8;
    // The full-height helix tubes looked like luminous springs in motion. The
    // textured volume plus horizontal calligraphic bands below reads as a real
    // funnel and costs less on mobile, so no vertical tube cage is needed.
    const tornadoTubeCount = 0;
    const flamePetals = useMemo(() => flameLike
        ? Array.from({ length: flamePetalCount }, (_, i) => makeFlameRibbonGeometry(
            1.28 + (i % 4) * 0.24,
            0.17 + (i % 3) * 0.025,
            0.52 + (i % 3) * 0.18,
            (i / flamePetalCount) * Math.PI * 2,
        ))
        : [], [flameLike, flamePetalCount]);
    const waveTongues = useMemo(() => kind === "tidalWave"
        ? Array.from({ length: quality.id === "low" ? 4 : 6 }, (_, i) => makeFlameRibbonGeometry(
            0.9 + (i % 3) * 0.18,
            0.14 + (i % 2) * 0.018,
            0.3 + (i % 3) * 0.08,
            0.7 + i * 0.86,
        ))
        : [], [kind, quality.id]);
    const tornadoTubes = useMemo(() => kind === "tornado"
        ? Array.from({ length: tornadoTubeCount }, (_, i) => (i / tornadoTubeCount) * Math.PI * 2).map(makeTornadoTube)
        : [], [kind, tornadoTubeCount]);
    useEffect(() => () => {
        tornadoMist?.dispose();
        flamePetals.forEach((geometry) => geometry.dispose());
        waveTongues.forEach((geometry) => geometry.dispose());
        tornadoTubes.forEach((geometry) => geometry.dispose());
    }, [tornadoMist, flamePetals, waveTongues, tornadoTubes]);
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const angle = Math.atan2(dx, dz);
    // The cut-in supplies the anticipation; the set piece itself arrives fast,
    // then holds its full arena silhouette for the payoff instead of drifting in.
    const duration = kind === "tornado" ? 1.55 : kind === "tidalWave" ? 1.62 : flameLike || abyssal ? 1.5 : kind === "lightningStorm" ? 1.45 : kind === "earthBurst" ? 1.5 : 1.4;
    const registerMaterial = (material: (THREE.Material & { opacity: number }) | null) => {
        if (!material || materials.current.includes(material)) return;
        material.userData.baseOpacity = material.opacity;
        materials.current.push(material);
    };
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / duration);
        const rise = Math.min(1, p / 0.18);
        const fade = p < 0.82 ? rise : Math.max(0, 1 - (p - 0.82) / 0.18);
        const g = root.current;
        if (g) {
            if (kind === "tidalWave") {
                // Cross the lane in about 0.8s, then hold the full crest past the
                // cut-in so speed never costs the player the actual water payoff.
                const travel = 1 - Math.pow(1 - Math.min(1, p / 0.3), 2);
                g.position.set(lerp(from[0], to[0], travel), 0.15, lerp(from[2], to[2], travel));
                // Keep the advancing crest readable from the broadcast camera.
                // A fully heading-aligned wall turns edge-on during horizontal
                // attacks and reads as a flat polygon instead of water volume.
                g.rotation.y = angle * 0.24;
                g.scale.set(0.9 + p * 0.34, 0.9 + Math.sin(Math.PI * p) * 0.38, 1.04 + p * 0.22);
            } else {
                g.position.set(to[0], 0.08, to[2]);
                // Only a tornado should continuously spin. Rotating every signature
                // made grounded attacks orbit the target like a decorative carousel.
                g.rotation.y = kind === "tornado" ? angle + p * Math.PI * 5.5 : angle;
                // Snap large, then HOLD the arena silhouette until the final fade.
                // The previous sine swell collapsed back to half-size while the
                // cut-in was still clearing, which made the actual payoff look tiny.
                const grow = 1 - Math.pow(1 - Math.min(1, p / 0.22), 3);
                const fullScale = flameLike || abyssal ? 1.88 : kind === "tornado" ? 1.72 : kind === "lightningStorm" ? 1.86 : kind === "earthBurst" ? 1.78 : 1.7;
                const settle = p < 0.82 ? 1 : 1 - Math.min(1, (p - 0.82) / 0.18) * 0.16;
                g.scale.setScalar((0.45 + grow * (fullScale - 0.45)) * settle);
            }
        }
        if (flameLike) {
            flameMeshes.current.forEach((mesh, i) => {
                const flicker = Math.sin(state.clock.elapsedTime * (8.5 + (i % 3)) + i * 1.7);
                mesh.scale.y = 0.9 + flicker * 0.13;
                mesh.scale.x = mesh.scale.z = 1.02 - flicker * 0.055;
                mesh.rotation.z = flicker * 0.045;
            });
        }
        if (flameLight.current) flameLight.current.intensity = fade * ((abyssal ? 3.2 : 5) + Math.abs(Math.sin(state.clock.elapsedTime * 11)) * (abyssal ? 1.4 : 3));
        if (tornadoMist) tornadoMist.offset.set(p * 0.42, -p * 1.4);
        for (const material of materials.current) material.opacity = Number(material.userData.baseOpacity ?? 0.5) * fade;
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });

    const setPieceColor = abyssal ? "#d51d56" : kind === "flameBurst" ? "#ff4b18"
        : kind === "tidalWave" ? "#2fc9ea"
            : kind === "tornado" ? "#50d9be"
                : kind === "lightningStorm" ? "#9b7cff"
                    : kind === "earthBurst" ? "#c88b43" : color;
    const mat = (opacity: number, white = false) => (
        <meshToonMaterial ref={registerMaterial} color={white ? "#effcff" : setPieceColor} emissive={setPieceColor} emissiveIntensity={white ? 0.16 : 0.1} transparent opacity={Math.min(0.92, opacity * 1.75)} depthWrite={false} side={THREE.DoubleSide} />
    );
    return (
        <group ref={root}>
            {kind === "tidalWave" && (
                <group>
                    {/* Tapered water tongues ride the outer curl instead of standing
                        in a row. This gives the signature a hand-drawn breaking-wave
                        silhouette without a translucent backplate or shield fan. */}
                    {waveTongues.map((geometry, i) => {
                        const u = i / Math.max(1, waveTongues.length - 1);
                        const a = 0.08 + u * Math.PI * 1.02;
                        const x = Math.cos(a) * 1.5 - 0.08;
                        const y = 0.5 + Math.sin(a) * 1.28;
                        return (
                            <mesh key={`wave-tongue-${i}`} geometry={geometry} position={[x, y, 0.42 + (i % 2) * 0.12]} rotation={[0.08, -0.38 + i * 0.14, a - 1.42]} scale={0.68 + (i % 3) * 0.09}>
                                <meshToonMaterial ref={registerMaterial} color={i % 3 === 0 ? "#9ce9ef" : i % 2 ? "#1598bf" : "#36c1d2"} emissive="#087ca6" emissiveIntensity={0.12} transparent opacity={0.88} depthWrite={false} />
                            </mesh>
                        );
                    })}
                    {/* Thick partial toruses form a real 3D curl. The previous
                        filled surface was technically a crest but read as a flat
                        blue card whenever its heading crossed the camera axis. */}
                    <mesh position={[-0.05, 0.5, -0.15]} rotation={[0.06, 0, -0.18]} scale={[1.26, 1.06, 0.76]}>
                        <torusGeometry args={[1.45, 0.54, 14, 52, Math.PI * 1.28]} />
                        <meshToonMaterial ref={registerMaterial} color="#043a62" emissive="#02243f" emissiveIntensity={0.06} transparent opacity={0.9} depthWrite={false} />
                    </mesh>
                    <mesh position={[-0.05, 0.5, -0.1]} rotation={[0.06, 0, -0.18]} scale={[1.18, 1.0, 0.72]}>
                        <torusGeometry args={[1.45, 0.46, 14, 52, Math.PI * 1.28]} />
                        <meshToonMaterial ref={registerMaterial} color="#087fb8" emissive="#043a67" emissiveIntensity={0.16} transparent opacity={0.9} depthWrite={false} />
                    </mesh>
                    <mesh position={[-0.02, 0.54, -0.06]} rotation={[0.06, 0, -0.18]} scale={[1.2, 1.02, 0.74]}>
                        <torusGeometry args={[1.46, 0.13, 10, 54, Math.PI * 1.28]} />
                        <meshToonMaterial ref={registerMaterial} color="#e8ffff" emissive="#59cfe4" emissiveIntensity={0.22} transparent opacity={0.95} depthWrite={false} />
                    </mesh>
                    <mesh position={[-0.55, 0.28, 0.34]} rotation={[0.16, 0.22, -0.5]} scale={[0.72, 0.68, 0.54]}>
                        <torusGeometry args={[1.18, 0.28, 12, 44, Math.PI * 1.1]} />
                        <meshToonMaterial ref={registerMaterial} color="#25b9d6" emissive="#075b89" emissiveIntensity={0.16} transparent opacity={0.82} depthWrite={false} />
                    </mesh>
                    <mesh position={[0.72, 0.22, 0.18]} rotation={[0.08, -0.18, 0.45]} scale={[0.55, 0.48, 0.42]}>
                        <torusGeometry args={[1.08, 0.2, 10, 40, Math.PI]} />
                        <meshToonMaterial ref={registerMaterial} color="#57d6e7" emissive="#087ba8" emissiveIntensity={0.18} transparent opacity={0.78} depthWrite={false} />
                    </mesh>
                    {Array.from({ length: 9 }, (_, i) => {
                        const a = -1.15 + i * 0.23;
                        const r = 0.72 + (i % 4) * 0.18;
                        return (
                            <mesh key={`water-spray-${i}`} position={[Math.sin(a) * r, 1.0 + (i % 5) * 0.25, 1.5 + Math.cos(a) * 0.2]} rotation={[a, i * 0.61, -a]} scale={[0.1 + (i % 3) * 0.025, 0.24 + (i % 4) * 0.04, 0.1]}>
                                <sphereGeometry args={[1, 10, 7]} />
                                <meshToonMaterial ref={registerMaterial} color={i % 3 ? "#78ddea" : "#efffff"} emissive="#4abbd0" emissiveIntensity={0.1} transparent opacity={0.88} depthWrite={false} />
                            </mesh>
                        );
                    })}
                    <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <ringGeometry args={[0.75, 2.3, 48]} />
                        <meshBasicMaterial ref={registerMaterial} color="#0876ae" transparent opacity={0.24} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
                    </mesh>
                    <Sparkles count={Math.max(8, Math.round(quality.setPieceParticles * 0.7))} position={[0, 1.25, 0.2]} scale={[3.2, 2.8, 3.8]} size={2.1} speed={1.55} opacity={0.42} color="#d8fbff" noise={1.35} />
                </group>
            )}
            {kind === "tornado" && (
                <group>
                    {/* A broad, softly textured funnel gives the move real volume;
                        the thinner toon spirals are highlights, not the whole effect. */}
                    {tornadoMist && (
                        <mesh position={[0, 1.92, 0]} rotation={[0, 0, Math.PI]}>
                            <coneGeometry args={[1.5, 3.82, 48, 4, true]} />
                            <meshBasicMaterial ref={registerMaterial} map={tornadoMist} color="#55cdbd" transparent opacity={0.4} depthWrite={false} toneMapped={false} blending={THREE.NormalBlending} side={THREE.DoubleSide} />
                        </mesh>
                    )}
                    <mesh position={[0, 1.62, 0]} rotation={[0, 0, Math.PI]} scale={[0.72, 0.84, 0.72]}>
                        <coneGeometry args={[1.5, 3.82, 40, 3, true]} />
                        <meshBasicMaterial ref={registerMaterial} color="#168a84" transparent opacity={0.2} depthWrite={false} toneMapped={false} blending={THREE.NormalBlending} side={THREE.DoubleSide} />
                    </mesh>
                    {tornadoTubes.map((geometry, i) => (
                        <mesh key={i} geometry={geometry}>
                            <meshToonMaterial
                                ref={registerMaterial}
                                color={i === 0 ? "#d8fff7" : i === 1 ? "#55d9c4" : "#168a84"}
                                emissive={i === 0 ? "#58d8c5" : "#0b514f"}
                                emissiveIntensity={i === 0 ? 0.24 : 0.12}
                                transparent
                                opacity={i === 0 ? 0.94 : 0.82}
                                depthWrite={false}
                            />
                        </mesh>
                    ))}
                    {Array.from({ length: 5 }, (_, i) => (
                        <mesh key={`vortex-band-${i}`} position={[0, 0.42 + i * 0.78, 0]} rotation={[Math.PI / 2, i * 1.08, i % 2 ? 0.16 : -0.12]} scale={[1, 0.76 + (i % 2) * 0.12, 1]}>
                            <torusGeometry args={[0.4 + i * 0.27, 0.055 + i * 0.007, 8, 40, Math.PI * (0.92 + (i % 2) * 0.18)]} />
                            <meshToonMaterial ref={registerMaterial} color={i > 1 ? "#c8fff2" : "#38bda9"} emissive="#17665f" emissiveIntensity={0.16} transparent opacity={0.9 - i * 0.08} depthWrite={false} />
                        </mesh>
                    ))}
                    {Array.from({ length: 9 }, (_, i) => {
                        const a = (i / 9) * Math.PI * 2;
                        const r = 0.9 + (i % 3) * 0.58;
                        return (
                            <mesh key={`debris-${i}`} position={[Math.cos(a) * r, 0.35 + (i % 4) * 0.58, Math.sin(a) * r]} scale={0.1 + (i % 3) * 0.045}>
                                <dodecahedronGeometry args={[1, 0]} />
                                <meshToonMaterial ref={registerMaterial} color="#708078" transparent opacity={0.72} depthWrite={false} />
                            </mesh>
                        );
                    })}
                    <Sparkles count={Math.max(12, quality.setPieceParticles)} scale={[4.8, 5.4, 4.8]} position={[0, 2.15, 0]} size={2.45} speed={1.9} opacity={0.42} color="#d7fff4" noise={2.0} />
                </group>
            )}
            {flameLike && (
                <group>
                    <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <ringGeometry args={[1.08, 1.42, 48]} />
                        {mat(0.22)}
                    </mesh>
                    {flamePetals.map((geometry, i) => {
                        const a = (i / flamePetals.length) * Math.PI * 2;
                        const r = i < 2 ? 0.22 : 0.58 + (i % 3) * 0.18;
                        const inner = i < 2;
                        return (
                            <mesh
                                key={i}
                                ref={(mesh) => { if (mesh) flameMeshes.current[i] = mesh; }}
                                geometry={geometry}
                                position={[Math.cos(a) * r, 0.04, Math.sin(a) * r]}
                                rotation={[0, a, 0]}
                                castShadow
                            >
                                <meshToonMaterial
                                    ref={registerMaterial}
                                    color={abyssal
                                        ? inner ? "#ffb4d1" : i % 2 ? "#d5164f" : "#551056"
                                        : inner ? "#ffe777" : i % 2 ? "#ff5a18" : "#c92319"}
                                    emissive={abyssal ? (inner ? "#ff335f" : "#26082f") : (inner ? "#ff9d00" : "#681018")}
                                    emissiveIntensity={inner ? 0.42 : 0.2}
                                    transparent
                                    opacity={inner ? 0.86 : 0.74}
                                    depthWrite={false}
                                />
                            </mesh>
                        );
                    })}
                    <mesh position={[0, 0.42, 0]} scale={[0.68, 0.46, 0.68]}>
                        <sphereGeometry args={[1, 22, 14]} />
                        <meshToonMaterial ref={registerMaterial} color={abyssal ? "#b71b59" : "#ffb426"} emissive={abyssal ? "#54105f" : "#ff3d12"} emissiveIntensity={0.38} transparent opacity={0.4} depthWrite={false} />
                    </mesh>
                    {quality.dynamicPetLight && <pointLight ref={flameLight} position={[0, 1.4, 0]} color={abyssal ? "#ef2b67" : "#ff6a22"} intensity={0} distance={8} decay={2} />}
                    <Sparkles count={quality.setPieceParticles} scale={[5.2, 4.3, 5.2]} position={[0, 1.5, 0]} size={3.4} speed={1.35} opacity={0.6} color="#fff1c2" noise={2.0} />
                </group>
            )}
            {abyssal && (
                <group>
                    {/* Hellgate is an aimed attack, not a radial flame crown. The
                        dark floor seal establishes the origin while three offset
                        claw trails continue through the victim along the attack
                        heading. Normal blending keeps the shadows dark instead of
                        bleaching both pets with additive magenta. */}
                    <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.24, 1.24, 1]}>
                        <circleGeometry args={[1.12, 48]} />
                        <meshBasicMaterial ref={registerMaterial} color="#160b24" transparent opacity={0.72} depthWrite={false} blending={THREE.NormalBlending} />
                    </mesh>
                    {[0, 1].map((i) => (
                        <mesh key={`hellgate-ring-${i}`} position={[0, 0.045 + i * 0.012, 0]} rotation={[-Math.PI / 2, 0, i * 0.38]}>
                            <torusGeometry args={[0.7 + i * 0.34, 0.045 - i * 0.008, 8, 48, Math.PI * (1.52 + i * 0.2)]} />
                            <meshBasicMaterial ref={registerMaterial} color={i === 0 ? "#dc1839" : "#68112f"} transparent opacity={i === 0 ? 0.7 : 0.52} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                        </mesh>
                    ))}
                    {[0, 1, 2].map((i) => (
                        <group key={`abyss-claw-${i}`} position={[(i - 1) * 0.34, 0.085 + i * 0.012, 0.05 + (i - 1) * 0.12]} rotation={[-Math.PI / 2, 0, -0.54 + i * 0.08]}>
                            <mesh>
                                <torusGeometry args={[0.86 + i * 0.09, 0.085 - i * 0.008, 8, 42, Math.PI * 0.72]} />
                                <meshToonMaterial ref={registerMaterial} color={i === 1 ? "#ef2846" : "#7f1435"} emissive="#3c091f" emissiveIntensity={0.3} transparent opacity={0.88 - i * 0.08} depthWrite={false} side={THREE.DoubleSide} />
                            </mesh>
                            <mesh position={[0, 0, -0.055]} scale={1.18}>
                                <torusGeometry args={[0.86 + i * 0.09, 0.035, 6, 38, Math.PI * 0.72]} />
                                <meshBasicMaterial ref={registerMaterial} color="#ff8a68" transparent opacity={0.5} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                            </mesh>
                        </group>
                    ))}
                    <mesh position={[0, 0.68, 0.08]} scale={[0.54, 0.72, 0.42]}>
                        <icosahedronGeometry args={[1, 2]} />
                        <meshBasicMaterial ref={registerMaterial} color="#db1938" transparent opacity={0.3} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                    {Array.from({ length: quality.id === "low" ? 6 : 9 }, (_, i) => {
                        const lane = (i % 3) - 1;
                        const row = Math.floor(i / 3);
                        return (
                            <mesh key={`abyss-fragment-${i}`} position={[lane * (0.48 + row * 0.12), 0.34 + row * 0.43 + (i % 2) * 0.11, 0.28 + row * 0.38]} rotation={[i * 0.72, i * 0.41, i * 0.93]} scale={[0.08, 0.18 + (i % 2) * 0.05, 0.08]}>
                                <octahedronGeometry args={[1, 0]} />
                                <meshToonMaterial ref={registerMaterial} color={i % 3 === 1 ? "#d91d3d" : "#261024"} emissive="#8e1639" emissiveIntensity={0.16} transparent opacity={0.82} depthWrite={false} />
                            </mesh>
                        );
                    })}
                    {quality.dynamicPetLight && <pointLight ref={flameLight} position={[0, 1.05, 0.15]} color="#db263f" intensity={0} distance={6.5} decay={2} />}
                    <Sparkles count={Math.max(8, Math.round(quality.setPieceParticles * 0.62))} scale={[3.7, 2.8, 3.8]} position={[0, 1.05, 0.3]} size={2.1} speed={1.05} opacity={0.34} color="#ff8069" noise={1.7} />
                </group>
            )}
            {kind === "lightningStorm" && (
                <group>
                    {[0, 1, 2, 3].map((i) => (
                        <mesh key={`cloud-${i}`} position={[(i - 1.5) * 0.48, 3.35 + (i % 2) * 0.18, (i % 2 ? -1 : 1) * 0.28]} scale={[0.92, 0.48, 0.72]}>
                            <icosahedronGeometry args={[0.72, 1]} />
                            <meshToonMaterial ref={registerMaterial} color={i % 2 ? "#34255f" : "#21163e"} emissive="#5b3db0" emissiveIntensity={0.16} transparent opacity={0.86} depthWrite={false} />
                        </mesh>
                    ))}
                    {Array.from({ length: 9 }, (_, i) => {
                        const zig = i % 2 ? 0.34 : -0.28;
                        return (
                            <mesh key={`bolt-${i}`} position={[zig + (i > 5 ? 0.28 : 0), 3.12 - i * 0.36, (i % 3 - 1) * 0.08]} rotation={[0, 0, (i % 2 ? -1 : 1) * 0.42]} scale={[0.13, 0.48, 0.13]}>
                                <octahedronGeometry args={[0.5, 0]} />
                                <meshToonMaterial ref={registerMaterial} color={i % 3 === 0 ? "#fff3a3" : "#b89cff"} emissive={i % 3 === 0 ? "#ffd83d" : "#7b4fff"} emissiveIntensity={0.5} transparent opacity={0.96} depthWrite={false} />
                            </mesh>
                        );
                    })}
                    <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <ringGeometry args={[0.8, 2.25, 46]} />
                        <meshBasicMaterial ref={registerMaterial} color="#7657dc" transparent opacity={0.32} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                    </mesh>
                    <Sparkles count={quality.setPieceParticles} scale={[4.8, 5.2, 4.8]} position={[0, 2.0, 0]} size={2.5} speed={1.8} opacity={0.52} color="#e4d8ff" noise={2.4} />
                </group>
            )}
            {kind === "earthBurst" && (
                <group>
                    <mesh position={[0, 0.42, 0]} scale={[1.28, 0.66, 1.28]} castShadow>
                        <dodecahedronGeometry args={[1.15, 0]} />
                        <meshToonMaterial ref={registerMaterial} color="#6b4026" emissive="#2f1c12" emissiveIntensity={0.06} transparent opacity={0.94} depthWrite />
                    </mesh>
                    {Array.from({ length: 12 }, (_, i) => {
                        const a = (i / 12) * Math.PI * 2;
                        const r = 0.9 + (i % 3) * 0.38;
                        return (
                            <mesh key={`stone-${i}`} position={[Math.cos(a) * r, 0.45 + (i % 4) * 0.38, Math.sin(a) * r]} rotation={[a * 0.4, -a, a * 0.22]} scale={0.22 + (i % 3) * 0.08} castShadow>
                                <dodecahedronGeometry args={[1, 0]} />
                                <meshToonMaterial ref={registerMaterial} color={i % 3 === 0 ? "#d49a4a" : i % 2 ? "#83512e" : "#533520"} emissive="#3a2416" emissiveIntensity={0.05} transparent opacity={0.96} depthWrite />
                            </mesh>
                        );
                    })}
                    <mesh position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <ringGeometry args={[1.1, 2.65, 12]} />
                        <meshToonMaterial ref={registerMaterial} color="#c38b47" emissive="#5c3821" emissiveIntensity={0.12} transparent opacity={0.58} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <Sparkles count={Math.max(10, Math.round(quality.setPieceParticles * 0.7))} scale={[5.4, 2.8, 5.4]} position={[0, 1.15, 0]} size={3.2} speed={0.72} opacity={0.42} color="#d8b17a" noise={2.1} />
                </group>
            )}
            {kind === "elemental" && (
                <group>
                    {[0, 1, 2].map((i) => (
                        <mesh key={i} position={[0, 0.35 + i * 0.75, 0]} rotation={[Math.PI / 2, i * 0.6, 0]}>
                            <torusGeometry args={[0.8 + i * 0.55, 0.1, 8, 40, Math.PI * 1.7]} />
                            {mat(0.52 - i * 0.08, i === 2)}
                        </mesh>
                    ))}
                    <Sparkles count={38} scale={[4.6, 4.2, 4.6]} position={[0, 1.5, 0]} size={3} speed={0.9} opacity={0.55} color="#ffffff" noise={1.7} />
                </group>
            )}
        </group>
    );
}

const _TSUNAMI_VERTEX = `
varying vec2 vUv;
uniform float uTime;
uniform float uBuild;
void main() {
    vUv = uv;
    vec3 p = position;
    float crest = smoothstep(0.48, 1.0, uv.y);
    float curl = crest * crest * (0.58 + 0.18 * sin(uv.x * 8.0 + uTime * 4.2));
    p.z += curl * uBuild;
    p.x += sin(uv.y * 7.0 + uTime * 3.0) * 0.08 * crest;
    p.y += sin(uv.x * 10.0 - uTime * 3.4) * 0.13 * (0.25 + crest);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const _TSUNAMI_FRAGMENT = `
varying vec2 vUv;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uDeep;
uniform vec3 uWater;
uniform vec3 uFoam;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
void main() {
    float edge = smoothstep(0.0, 0.07, vUv.x) * smoothstep(0.0, 0.07, 1.0 - vUv.x);
    float flow = sin(vUv.x * 18.0 - uTime * 5.2 + noise(vUv * 9.0) * 3.0) * 0.5 + 0.5;
    float foamLine = 0.91 + noise(vec2(vUv.x * 12.0, uTime * 1.8)) * 0.045;
    float foam = smoothstep(foamLine - 0.025, foamLine + 0.035, vUv.y);
    foam += smoothstep(0.7, 0.98, vUv.y) * smoothstep(0.84, 1.0, flow) * 0.24;
    vec3 body = mix(uDeep, uWater, min(0.72, vUv.y * 0.5 + flow * 0.12));
    vec3 color = mix(body, uFoam, clamp(foam, 0.0, 0.84));
    float floorFade = smoothstep(0.0, 0.16, vUv.y);
    float alpha = edge * floorFade * uOpacity * (0.74 + foam * 0.24);
    gl_FragColor = vec4(color, alpha);
}`;

const TORNADO_VERTEX = `
varying vec2 vUv;
varying float vTwist;
uniform float uTime;
uniform float uPhase;
void main() {
    vUv = uv;
    vec3 p = position;
    float sway = (0.06 + uv.y * 0.22);
    p.x += sin(uv.y * 12.0 + uTime * 4.8 + uPhase) * sway;
    p.z += cos(uv.y * 10.0 + uTime * 4.1 + uPhase) * sway;
    vTwist = atan(p.z, p.x) + uv.y * 11.0 - uTime * 7.2 + uPhase;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const TORNADO_FRAGMENT = `
varying vec2 vUv;
varying float vTwist;
uniform float uOpacity;
uniform vec3 uDark;
uniform vec3 uWind;
uniform vec3 uCore;
void main() {
    float strand = sin(vTwist * 3.2 + vUv.y * 31.0) * 0.5 + 0.5;
    float fine = sin(vTwist * 7.0 - vUv.y * 53.0) * 0.5 + 0.5;
    float bands = smoothstep(0.33, 0.83, strand) + smoothstep(0.68, 0.98, fine) * 0.48;
    float taperFade = smoothstep(0.0, 0.08, vUv.y) * smoothstep(0.0, 0.09, 1.0 - vUv.y);
    vec3 color = mix(uDark, uWind, vUv.y * 0.65 + bands * 0.2);
    color = mix(color, uCore, smoothstep(0.96, 1.34, bands));
    gl_FragColor = vec4(color, clamp(bands, 0.0, 1.0) * taperFade * uOpacity);
}`;

/** Thin flow lines sit on the water shell and make its direction readable.
 * They are accents only—the old large-radius tubes became separate rainbow-like
 * arches and made the attack feel assembled instead of like one body of water. */
function _makeTsunamiFlowLineGeometry(index: number, count: number): THREE.TubeGeometry {
    const layer = count <= 1 ? 0 : index / (count - 1);
    const width = 5.35 - layer * 0.34;
    const points = Array.from({ length: 29 }, (_, pointIndex) => {
        const u = pointIndex / 28;
        const envelope = Math.pow(Math.max(0, Math.sin(u * Math.PI)), 0.5);
        const scallop = Math.sin(u * Math.PI * (3 + index)) * 0.035 * envelope;
        const v = 0.34 + layer * 0.4;
        const curl = Math.max(0, (v - 0.62) / 0.38);
        return new THREE.Vector3(
            (u - 0.5) * width,
            0.1 + envelope * (v < 0.62 ? (v / 0.62) * 2.72 : 2.72 - Math.sin(curl * Math.PI * 0.5) * 0.56) + scallop,
            -0.42 + v * 0.52 + envelope * Math.sin(curl * Math.PI * 0.5) * 1.05 + 0.58,
        );
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.035 + layer * 0.012, 6, false);
}

/** Vertical C-shaped ribs reveal the overhanging lip even in the high broadcast
 * camera. They sit inside the translucent shell, so they read as moving currents
 * rather than a wireframe laid over the effect. */
function _makeTsunamiCurlRibGeometry(index: number, count: number): THREE.TubeGeometry {
    const across = count <= 1 ? 0 : index / (count - 1);
    const x = lerp(-2.62, 2.62, across);
    const edge = Math.sin(across * Math.PI);
    const localHeight = 1.12 + edge * 1.82 + Math.sin(across * Math.PI * 5) * 0.08;
    const points = Array.from({ length: 24 }, (_, pointIndex) => {
        const v = pointIndex / 23;
        const curlPhase = Math.max(0, (v - 0.6) / 0.4);
        const y = v < 0.6
            ? 0.08 + (v / 0.6) * localHeight * 0.9
            : localHeight * 0.9 - Math.sin(curlPhase * Math.PI * 0.5) * (0.52 + edge * 0.18);
        const z = -0.28 + v * 0.28 + Math.sin(curlPhase * Math.PI * 0.5) * (0.72 + edge * 0.48);
        return new THREE.Vector3(x, y, z);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 0.045 + edge * 0.018, 6, false);
}

function _makeTsunamiVolumeGeometry(width: number, height: number, depth: number, xSegments: number, ySegments: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const row = xSegments + 1;
    for (let side = 0; side < 2; side++) {
        const sideOffset = side * row * (ySegments + 1);
        for (let y = 0; y <= ySegments; y++) {
            const v = y / ySegments;
            for (let x = 0; x <= xSegments; x++) {
                const u = x / xSegments;
                const px = (u - 0.5) * width;
                // A broad vertical rectangle still reads like a billboard even if
                // it technically has depth. Taper the height and thickness down at
                // both shoulders, then curl the upper third forward so the outline
                // reads as a breaking mass of water from every broadcast angle.
                const envelope = 0.25 + Math.pow(Math.sin(u * Math.PI), 0.48) * 0.75 + Math.sin(u * Math.PI * 5) * 0.045;
                const curlPhase = Math.max(0, (v - 0.62) / 0.38);
                const topBreak = Math.sin(u * Math.PI * 5.0) * 0.1 * envelope;
                const localHeight = 0.38 + (height - 0.38) * envelope + topBreak;
                const belly = Math.sin(v * Math.PI);
                // Rise as a solid swell, then fold the upper third forward and
                // slightly downward. This hooked cross-section is what makes the
                // silhouette read as a breaking tsunami instead of a blue card.
                const rise = v < 0.62
                    ? (v / 0.62) * localHeight * 0.87
                    : localHeight * 0.87 - Math.sin(curlPhase * Math.PI * 0.5) * (0.48 + envelope * 0.24);
                const curl = -0.46 + v * 0.48 - belly * 0.08 + Math.sin(curlPhase * Math.PI * 0.5) * (0.5 + envelope * 0.92);
                const thickness = 0.12 + depth * (0.18 + envelope * 0.82) * (0.38 + belly * 0.62);
                positions.push(px, Math.max(0.02, rise), curl + (side === 0 ? -thickness : thickness) * 0.5);
                uvs.push(u, v);
            }
        }
        for (let y = 0; y < ySegments; y++) {
            for (let x = 0; x < xSegments; x++) {
                const a = sideOffset + y * row + x;
                const b = a + 1;
                const c = a + row;
                const d = c + 1;
                if (side === 0) indices.push(a, c, b, b, c, d);
                else indices.push(a, b, c, b, d, c);
            }
        }
    }
    const backOffset = row * (ySegments + 1);
    for (let x = 0; x < xSegments; x++) {
        const frontBottom = x;
        const backBottom = backOffset + x;
        const frontTop = ySegments * row + x;
        const backTop = backOffset + ySegments * row + x;
        indices.push(frontBottom, frontBottom + 1, backBottom, frontBottom + 1, backBottom + 1, backBottom);
        indices.push(frontTop, backTop, frontTop + 1, frontTop + 1, backTop, backTop + 1);
    }
    for (let y = 0; y < ySegments; y++) {
        const frontLeft = y * row;
        const backLeft = backOffset + y * row;
        const frontRight = y * row + xSegments;
        const backRight = backOffset + y * row + xSegments;
        indices.push(frontLeft, backLeft, frontLeft + row, frontLeft + row, backLeft, backLeft + row);
        indices.push(frontRight, frontRight + row, backRight, frontRight + row, backRight + row, backRight);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function makeTornadoRibbonGeometry(index: number): THREE.TubeGeometry {
    const turns = 2.1 + index * 0.24;
    const points = Array.from({ length: 38 }, (_, i) => {
        const u = i / 37;
        const radius = 0.22 + Math.pow(u, 0.82) * (1.15 + index * 0.08);
        const a = u * Math.PI * 2 * turns + index * 1.7;
        return new THREE.Vector3(Math.cos(a) * radius, u * 3.5, Math.sin(a) * radius);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.022 + index * 0.004, 5, false);
}

function DuelTsunamiSetPiece({ from, to, color, quality, onDone }: {
    from: Vec3; to: Vec3; color: string; quality: PetVisualQualityConfig; onDone: () => void;
}) {
    const { camera } = useThree();
    const root = useRef<THREE.Group>(null);
    const curlMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const sheetMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const wash = useRef<THREE.MeshToonMaterial>(null);
    const washMesh = useRef<THREE.Mesh>(null);
    const crest = useRef<THREE.Group>(null);
    const trailingSwells = useRef<THREE.Group>(null);
    const spray = useRef<Array<THREE.Mesh | null>>([]);
    const start = useRef<number | null>(null);
    const complete = useRef(false);
    const palette = useMemo(() => duelFxPalette("water", color), [color]);
    // The former translucent heightfield and polyhedral foam read as a glass
    // dome full of white rocks. These opaque extruded brush masses share the
    // same dark/body/highlight hierarchy as the pet models and produce one clean
    // breaking-wave silhouette from the broadcast camera.
    const waveSheets = useMemo(() => [
        makeAnimeStrokeGeometry(5.2, 0.88, 1.55),
        makeAnimeStrokeGeometry(4.55, 0.48, 1.36),
        makeAnimeStrokeGeometry(3.75, 0.2, 1.16),
    ], []);
    useEffect(() => () => waveSheets.forEach((geometry) => geometry.dispose()), [waveSheets]);
    const sprayCount = quality.id === "low" ? 12 : quality.id === "medium" ? 20 : 28;
    const spraySpecs = useMemo(() => Array.from({ length: sprayCount }, (_, i) => ({
        x: -2.75 + (i / Math.max(1, sprayCount - 1)) * 5.5,
        lift: 0.28 + (i % 5) * 0.09,
        drift: ((i % 3) - 1) * 0.18,
        phase: (i * 0.173) % 1,
        size: 0.035 + (i % 4) * 0.012,
    })), [sprayCount]);
    const distance = Math.hypot(to[0] - from[0], to[2] - from[2]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / 1.95);
        const build = Math.min(1, p / 0.2);
        // The crest reaches contact in ~0.56 s, matching the director's delayed
        // damage number/flash. The former 1.31 s crossing made the HP change look
        // unrelated to the wave even though the simulator had already resolved it.
        const travel = 1 - Math.pow(1 - Math.min(1, p / 0.29), 3);
        const fade = p < 0.76 ? 1 : Math.max(0, 1 - (p - 0.76) / 0.24);
        const foamFade = p < 0.84 ? 1 : Math.max(0, 1 - (p - 0.84) / 0.16);
        const breakupP = Math.max(0, Math.min(1, (p - 0.58) / 0.42));
        const breakup = 1 - (1 - breakupP) * (1 - breakupP);
        if (root.current) {
            const overshoot = distance > 0.001 ? 0.52 / distance : 0;
            root.current.position.set(lerp(from[0], to[0] + (to[0] - from[0]) * overshoot, travel), FLOOR_Y + 0.02, lerp(from[2], to[2] + (to[2] - from[2]) * overshoot, travel));
            // Keep the broad silhouette readable to the broadcast camera. The
            // geometry itself owns the forward curl and thickness; its root still
            // travels along the true combat lane toward the target.
            const laneAngle = Math.atan2(to[0] - from[0], to[2] - from[2]);
            const cameraAngle = Math.atan2(camera.position.x - root.current.position.x, camera.position.z - root.current.position.z);
            // Bias toward the lane so the overhanging C-profile is visible, while
            // retaining enough broadcast-facing width to read as a wall of water.
            root.current.rotation.y = laneAngle * 0.74 + cameraAngle * 0.26;
            const volume = 0.72 + build * 0.38;
            root.current.scale.set(volume * (1 + breakup * 0.18), (0.2 + build * 0.8) * (1 - breakup * 0.28), volume * (1 + breakup * 0.3));
        }
        if (crest.current) {
            crest.current.position.set(0.48, 1.02 - breakup * 0.72, 0.32 + breakup * 0.9);
            crest.current.rotation.set(0.08 + breakup * 0.16, 0, -0.64 - breakup * 0.38);
            crest.current.scale.set(1 + breakup * 0.22, 1 - breakup * 0.52, 1 + breakup * 0.14);
        }
        if (trailingSwells.current) {
            trailingSwells.current.position.set(-breakup * 0.46, -breakup * 0.18, breakup * 0.5);
            trailingSwells.current.scale.set(1 + breakup * 0.28, 1 - breakup * 0.36, 1 + breakup * 0.2);
        }
        curlMats.current.forEach((material, index) => {
            if (material) material.opacity = fade * (index === 0 ? 0.24 : index === 1 ? 0.92 : index === 2 ? 0.96 : index === 3 ? 0.78 : 0.9);
        });
        sheetMats.current.forEach((material, index) => {
            if (material) material.opacity = fade * (index === 0 ? 0.96 : index === 1 ? 0.9 : 0.82);
        });
        if (wash.current) wash.current.opacity = foamFade * (0.22 + breakup * 0.12);
        if (washMesh.current) washMesh.current.scale.set(1 + breakup * 0.72, 1.45 + breakup * 0.86, 1);
        spray.current.forEach((drop, i) => {
            if (!drop) return;
            const spec = spraySpecs[i];
            const cycle = (p * 2.7 + spec.phase) % 1;
            const u = i / Math.max(1, spraySpecs.length - 1);
            const envelope = Math.pow(Math.max(0, Math.sin(u * Math.PI)), 0.5);
            const side = Math.sign(spec.x) || (i % 2 ? 1 : -1);
            drop.position.set(spec.x + spec.drift * cycle + side * breakup * 0.62, 0.5 + envelope * 2.75 + Math.sin(cycle * Math.PI) * spec.lift - cycle * 0.22 - breakup * 0.72, 0.5 + envelope * 0.72 + cycle * 0.54 + breakup * 0.9);
            drop.scale.setScalar(spec.size * (0.5 + build) * foamFade * (1 + breakup * 0.7));
        });
        if (p >= 1 && !complete.current) { complete.current = true; onDone(); }
    });
    return (
        <group ref={root}>
            <group position={[-0.25, 0.12, -0.18]} rotation={[0.02, -0.04, -0.08]}>
                {waveSheets.map((geometry, index) => (
                    <mesh
                        key={`tidal-solid-sheet-${index}`}
                        geometry={geometry}
                        position={[index * 0.22, index * 0.12, index * 0.2]}
                        scale={[1 - index * 0.1, 1 - index * 0.08, 1.35 + index * 0.22]}
                        renderOrder={32 + index}
                        castShadow={quality.modelShadows && index === 0}
                    >
                        <meshToonMaterial
                            ref={(material) => { sheetMats.current[index] = material; }}
                            color={index === 0 ? palette.dark : index === 1 ? palette.body : palette.core}
                            emissive={index === 2 ? palette.accent : palette.dark}
                            emissiveIntensity={index === 2 ? 0.12 : 0.035}
                            transparent
                            opacity={index === 0 ? 0.96 : index === 1 ? 0.9 : 0.82}
                            depthWrite={index === 0}
                            side={THREE.DoubleSide}
                        />
                    </mesh>
                ))}
            </group>
            {/* The crest is an asymmetric forward hook, not a centered arch. Its
                diagonal break gives the effect a direction and keeps the target
                readable through the hollow during the damage frame. */}
            <group ref={crest} position={[0.48, 1.02, 0.32]} rotation={[0.08, 0, -0.64]}>
                <mesh scale={[1.46, 1.02, 0.86]} renderOrder={34} castShadow={quality.modelShadows}>
                    <torusGeometry args={[1.28, 0.42, quality.id === "low" ? 9 : 13, quality.id === "low" ? 34 : 52, Math.PI * 0.94]} />
                    <meshToonMaterial ref={(material) => { curlMats.current[1] = material; }} color={palette.body} emissive={palette.dark} emissiveIntensity={0.08} transparent opacity={0.92} depthWrite side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0.03, 0.04, 0.13]} scale={[1.42, 0.98, 0.8]} renderOrder={36}>
                    <torusGeometry args={[1.28, 0.085, quality.id === "low" ? 7 : 10, quality.id === "low" ? 36 : 54, Math.PI * 0.94]} />
                    <meshToonMaterial ref={(material) => { curlMats.current[2] = material; }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.18} transparent opacity={0.96} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            {/* Lower trailing swells make this a moving body of water rather than
                one upright shield-shaped curl. They remain offset behind the lip
                along the local travel axis, so the target stays readable. */}
            <group ref={trailingSwells}>
                <mesh position={[-1.18, 0.27, -0.68]} rotation={[0.12, 0.08, -0.42]} scale={[0.9, 0.48, 0.72]} renderOrder={31}>
                    <torusGeometry args={[1.18, 0.3, quality.id === "low" ? 9 : 12, quality.id === "low" ? 32 : 46, Math.PI * 1.02]} />
                    <meshToonMaterial ref={(material) => { curlMats.current[3] = material; }} color={palette.body} emissive={palette.dark} emissiveIntensity={0.06} transparent opacity={0.78} depthWrite side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[-1.14, 0.31, -0.56]} rotation={[0.12, 0.08, -0.42]} scale={[0.86, 0.44, 0.68]} renderOrder={34}>
                    <torusGeometry args={[1.18, 0.075, quality.id === "low" ? 7 : 10, quality.id === "low" ? 34 : 48, Math.PI * 1.02]} />
                    <meshToonMaterial ref={(material) => { curlMats.current[4] = material; }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.16} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            <mesh ref={washMesh} position={[0, 0.045, -0.35]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.0, 1.45, 1]} renderOrder={30}>
                <circleGeometry args={[2.35, quality.id === "low" ? 24 : 48]} />
                <meshToonMaterial ref={wash} color={palette.dark} emissive={palette.accent} emissiveIntensity={0.045} transparent opacity={0.16} depthWrite={false} />
            </mesh>
            {spraySpecs.map((spec, i) => (
                <mesh key={`wave-spray-${i}`} ref={(mesh) => { spray.current[i] = mesh; }} position={[spec.x, 3.25, 0.25]} renderOrder={34}>
                    <icosahedronGeometry args={[1, 0]} />
                    <meshToonMaterial color={i % 3 === 0 ? palette.core : palette.accent} transparent opacity={0.78} depthWrite={false} />
                </mesh>
            ))}
            {quality.dynamicPetLight && <pointLight position={[0, 2.0, 0.6]} color={palette.accent} intensity={2.7} distance={8} decay={2} />}
        </group>
    );
}

function DuelTornadoSetPiece({ to, targetId, duel, clock, color, quality, onDone }: {
    to: Vec3; targetId?: string; duel: DuelResult; clock: { current: DuelClock }; color: string; quality: PetVisualQualityConfig; onDone: () => void;
}) {
    const root = useRef<THREE.Group>(null);
    const shells = useRef<Array<THREE.Mesh | null>>([]);
    const materials = useRef<Array<THREE.ShaderMaterial | null>>([]);
    const ribbons = useRef<Array<THREE.Mesh | null>>([]);
    const debris = useRef<Array<THREE.Mesh | null>>([]);
    const start = useRef<number | null>(null);
    const complete = useRef(false);
    const palette = useMemo(() => duelFxPalette("wind", color), [color]);
    const ribbonCount = quality.id === "low" ? 3 : quality.id === "medium" ? 4 : 5;
    const ribbonGeometries = useMemo(() => Array.from({ length: ribbonCount }, (_, i) => makeTornadoRibbonGeometry(i)), [ribbonCount]);
    useEffect(() => () => ribbonGeometries.forEach((geometry) => geometry.dispose()), [ribbonGeometries]);
    const debrisCount = quality.id === "low" ? 8 : quality.id === "medium" ? 12 : 16;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / 2.05);
        const build = 1 - Math.pow(1 - Math.min(1, p / 0.22), 3);
        const fade = p < 0.8 ? 1 : Math.max(0, 1 - (p - 0.8) / 0.2);
        if (root.current) {
            // A trapping funnel belongs to the defender for its full readable
            // beat. If it remains at the release mark while both pets reposition,
            // the caster can cross that point and make the move read as self-cast.
            const liveTarget = liveDuelEffectPosition(duel, clock, targetId);
            root.current.position.set(liveTarget?.wx ?? to[0], FLOOR_Y + 0.035, liveTarget?.wz ?? to[2]);
            root.current.scale.setScalar((0.24 + build * 0.86) * fade);
        }
        shells.current.forEach((shell, i) => {
            if (shell) shell.rotation.y = elapsed * (i % 2 ? -2.6 : 3.2) + i * 1.2;
        });
        materials.current.forEach((material, i) => {
            if (!material) return;
            material.uniforms.uTime.value = elapsed;
            material.uniforms.uOpacity.value = fade * (i === 1 ? 0.62 : 0.82);
        });
        ribbons.current.forEach((ribbon, i) => {
            if (!ribbon) return;
            ribbon.rotation.y = elapsed * (2.8 + i * 0.4) * (i % 2 ? -1 : 1);
            const pulse = 0.86 + Math.sin(elapsed * 8 + i) * 0.08;
            ribbon.scale.set(pulse, 1, pulse);
            const material = ribbon.material as THREE.MeshToonMaterial;
            material.opacity = fade * (0.36 + (i % 2) * 0.08);
        });
        debris.current.forEach((piece, i) => {
            if (!piece) return;
            const u = (elapsed * (0.62 + (i % 4) * 0.08) + i / debrisCount) % 1;
            const radius = 0.45 + u * 1.15;
            const a = elapsed * 5.4 + i * 2.13;
            piece.position.set(Math.cos(a) * radius, 0.12 + u * 1.35, Math.sin(a) * radius);
            piece.rotation.set(a * 0.6, a, -a * 0.4);
            piece.scale.setScalar((0.055 + (i % 3) * 0.018) * fade);
        });
        if (p >= 1 && !complete.current) { complete.current = true; onDone(); }
    });
    const tornadoUniforms = (phase: number, opacity: number) => ({
        uTime: { value: 0 }, uPhase: { value: phase }, uOpacity: { value: opacity },
        uDark: { value: new THREE.Color(palette.dark) }, uWind: { value: new THREE.Color(palette.body) }, uCore: { value: new THREE.Color(palette.accent) },
    });
    return (
        <group ref={root}>
            {[0, 1, 2].map((i) => (
                <mesh key={`funnel-shell-${i}`} ref={(mesh) => { shells.current[i] = mesh; }} position={[0, 1.78, 0]} scale={[1 + i * 0.13, 1 - i * 0.025, 1 + i * 0.13]} renderOrder={30 + i}>
                    <cylinderGeometry args={[1.58, 0.16, 3.55, quality.id === "low" ? 24 : 42, quality.id === "low" ? 12 : 24, true]} />
                    <shaderMaterial ref={(material) => { materials.current[i] = material; }} vertexShader={TORNADO_VERTEX} fragmentShader={TORNADO_FRAGMENT} uniforms={tornadoUniforms(i * 2.17, i === 1 ? 0.62 : 0.82)} transparent depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            ))}
            {ribbonGeometries.map((geometry, i) => (
                <mesh key={`funnel-ribbon-${i}`} ref={(mesh) => { ribbons.current[i] = mesh; }} geometry={geometry} position={[0, 0.05, 0]} renderOrder={34}>
                    <meshToonMaterial color={i % 2 ? palette.body : palette.accent} emissive={palette.dark} emissiveIntensity={0.06} transparent opacity={0.42} depthWrite={false} />
                </mesh>
            ))}
            {Array.from({ length: debrisCount }, (_, i) => (
                <mesh key={`funnel-debris-${i}`} ref={(mesh) => { debris.current[i] = mesh; }} castShadow>
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshToonMaterial color={i % 3 === 0 ? "#d9c49a" : i % 2 ? "#726657" : palette.dark} />
                </mesh>
            ))}
            <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.22, 1.72, quality.id === "low" ? 24 : 48]} />
                <meshToonMaterial color={palette.dark} transparent opacity={0.32} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {quality.dynamicPetLight && <pointLight position={[0, 1.8, 0]} color={palette.accent} intensity={3.1} distance={7} decay={2} />}
        </group>
    );
}

function DuelLunarSetPiece({ to, targetId, duel, clock, quality, onDone }: {
    to: Vec3; targetId?: string; duel: DuelResult; clock: { current: DuelClock }; quality: PetVisualQualityConfig; onDone: () => void;
}) {
    const root = useRef<THREE.Group>(null);
    const eclipse = useRef<THREE.Mesh>(null);
    const corona = useRef<THREE.Mesh>(null);
    const halo = useRef<THREE.Group>(null);
    const arenaSeal = useRef<THREE.Group>(null);
    const light = useRef<THREE.PointLight>(null);
    const slashes = useRef<Array<THREE.Mesh | null>>([]);
    const shards = useRef<Array<THREE.Mesh | null>>([]);
    const start = useRef<number | null>(null);
    const complete = useRef(false);
    const slashCount = quality.id === "low" ? 5 : quality.id === "medium" ? 7 : 8;
    const shardCount = quality.id === "low" ? 10 : quality.id === "medium" ? 16 : 22;
    const moonGeometry = useMemo(() => makeAnimeStrokeGeometry(3, 0.42, 1.08), []);
    const moonAccentGeometry = useMemo(() => makeAnimeStrokeGeometry(2.52, 0.11, 0.88), []);
    const slashGeometries = useMemo(() => Array.from({ length: slashCount }, (_, index) => makeAnimeStrokeGeometry(
        2.7 + (index % 3) * 0.34,
        0.2 + (index % 2) * 0.045,
        0.48 + (index % 3) * 0.1,
    )), [slashCount]);
    useEffect(() => () => {
        moonGeometry.dispose();
        moonAccentGeometry.dispose();
        slashGeometries.forEach((geometry) => geometry.dispose());
    }, [moonAccentGeometry, moonGeometry, slashGeometries]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / 1.86);
        const build = 1 - Math.pow(1 - Math.min(1, p / 0.18), 3);
        const strike = Math.min(1, Math.max(0, (p - 0.1) / 0.26));
        const fade = p < 0.72 ? 1 : Math.max(0, 1 - (p - 0.72) / 0.28);
        const liveTarget = liveDuelEffectPosition(duel, clock, targetId);
        if (root.current) {
            root.current.position.set(liveTarget?.wx ?? to[0], FLOOR_Y + 0.04, liveTarget?.wz ?? to[2]);
            root.current.scale.setScalar((0.12 + build * 0.96) * fade);
            root.current.rotation.y = 0;
        }
        if (eclipse.current) {
            const pulse = 0.94 + Math.sin(elapsed * 10) * 0.035;
            eclipse.current.scale.setScalar(pulse);
        }
        if (corona.current) {
            corona.current.rotation.z = 0.23 + Math.sin(elapsed * 2.4) * 0.08;
            corona.current.scale.setScalar(0.9 + Math.sin(elapsed * 8) * 0.045);
        }
        if (halo.current) {
            halo.current.rotation.z = elapsed * -0.72;
            const haloPulse = 0.84 + build * 0.16 + Math.sin(elapsed * 9) * 0.025;
            halo.current.scale.set(haloPulse, haloPulse * 1.08, haloPulse * 0.88);
        }
        if (arenaSeal.current) {
            arenaSeal.current.rotation.y = elapsed * 0.62;
            arenaSeal.current.scale.setScalar(0.74 + build * 0.26);
        }
        slashes.current.forEach((slash, index) => {
            if (!slash) return;
            const lane = index % 4 - 1.5;
            const opposingBundle = index >= Math.ceil(slashCount / 2);
            const localPhase = strike * 2.05 - index * 0.24;
            const stagger = localPhase > 0 && localPhase < 1 ? Math.sin(Math.PI * localPhase) : 0;
            slash.position.set(lane * 0.42, 0.44 + (index % 4) * 0.43, (opposingBundle ? -0.14 : 0.16) + stagger * 0.18);
            slash.rotation.set(0.04, lane * 0.08, (opposingBundle ? -0.64 : 0.64) + lane * 0.08);
            slash.scale.setScalar(Math.max(0.001, stagger * (0.78 + (index % 2) * 0.07)));
            (slash.material as THREE.MeshToonMaterial).opacity = fade * stagger * (index % 3 === 0 ? 0.86 : 0.74);
        });
        shards.current.forEach((shard, index) => {
            if (!shard) return;
            const u = index / Math.max(1, shardCount);
            const angle = elapsed * (1.8 + (index % 3) * 0.24) + u * Math.PI * 2;
            const radius = 1.5 + (index % 4) * 0.17;
            shard.position.set(Math.cos(angle) * radius, 0.3 + (index % 6) * 0.4 + Math.sin(angle * 1.4) * 0.18, Math.sin(angle) * radius);
            shard.rotation.set(angle, -angle * 0.7, angle * 0.4);
            shard.scale.setScalar((0.085 + (index % 3) * 0.022) * fade);
        });
        if (light.current) light.current.intensity = fade * Math.sin(Math.PI * Math.min(1, p * 1.6)) * 5.8;
        if (p >= 1 && !complete.current) { complete.current = true; onDone(); }
    });
    return (
        <group ref={root}>
            <group ref={arenaSeal} position={[0, 0.018, 0]}>
                <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={31}>
                    <ringGeometry args={[0.58, 2.08, quality.id === "low" ? 32 : 60]} />
                    <meshToonMaterial color="#261744" emissive="#6344bd" emissiveIntensity={0.12} transparent opacity={0.26} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]} renderOrder={32}>
                    <ringGeometry args={[2.22, 2.34, quality.id === "low" ? 32 : 60]} />
                    <meshToonMaterial color="#c5adff" emissive="#9d7cff" emissiveIntensity={0.28} transparent opacity={0.68} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            <group ref={halo} position={[0, 2.08, -0.44]} rotation={[0.08, -0.12, 0]} scale={[1, 1.08, 0.88]}>
                <mesh renderOrder={33}>
                    <torusGeometry args={[1.52, 0.115, quality.id === "low" ? 6 : 10, quality.id === "low" ? 32 : 56]} />
                    <meshToonMaterial color="#6c49cc" emissive="#4f2ba8" emissiveIntensity={0.22} transparent opacity={0.82} depthWrite={false} />
                </mesh>
                <mesh renderOrder={34}>
                    <torusGeometry args={[1.29, 0.035, 6, quality.id === "low" ? 28 : 48]} />
                    <meshToonMaterial color="#f1e9ff" emissive="#b79bff" emissiveIntensity={0.38} transparent opacity={0.9} depthWrite={false} />
                </mesh>
            </group>
            {/* Layered brush crescents anchor the move without the floating
                black sphere that made the old eclipse read as placeholder art. */}
            <mesh ref={eclipse} geometry={moonGeometry} position={[-0.08, 2.7, -0.4]} rotation={[0.06, -0.16, 0.2]} scale={0.62} renderOrder={35}>
                <meshToonMaterial color="#7350d2" emissive="#452492" emissiveIntensity={0.2} transparent opacity={0.96} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={corona} geometry={moonAccentGeometry} position={[-0.02, 2.74, -0.42]} rotation={[0.06, -0.16, 0.23]} scale={0.57} renderOrder={36}>
                <meshToonMaterial color="#f2e9ff" emissive="#a27cff" emissiveIntensity={0.34} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {Array.from({ length: slashCount }, (_, index) => (
                <mesh key={`lunar-tail-${index}`} ref={(mesh) => { slashes.current[index] = mesh; }} geometry={slashGeometries[index]} renderOrder={36}>
                    <meshToonMaterial color={index % 3 === 0 ? "#f4eaff" : index % 2 ? "#b99bff" : "#8259ef"} emissive="#7044df" emissiveIntensity={0.18} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            ))}
            {Array.from({ length: shardCount }, (_, index) => (
                <mesh key={`lunar-shard-${index}`} ref={(mesh) => { shards.current[index] = mesh; }} renderOrder={37}>
                    <octahedronGeometry args={[1, 0]} />
                    <meshToonMaterial color={index % 3 === 0 ? "#efe4ff" : "#9d7cff"} emissive="#6f44d8" emissiveIntensity={0.26} />
                </mesh>
            ))}
            {quality.dynamicPetLight && <pointLight ref={light} position={[0, 1.6, 0.2]} color="#9d7cff" intensity={0} distance={11} decay={2} />}
        </group>
    );
}

function DuelSignatureSetPiece(props: { kind: DuelSetPieceKind; from: Vec3; to: Vec3; targetId?: string; duel: DuelResult; clock: { current: DuelClock }; color: string; quality: PetVisualQualityConfig; onDone: () => void }) {
    if (props.kind === "tidalWave") return <DuelTsunamiSetPiece from={props.from} to={props.to} color={props.color} quality={props.quality} onDone={props.onDone} />;
    if (props.kind === "tornado") return <DuelTornadoSetPiece to={props.to} targetId={props.targetId} duel={props.duel} clock={props.clock} color={props.color} quality={props.quality} onDone={props.onDone} />;
    if (props.kind === "lunarBurst") return <DuelLunarSetPiece to={props.to} targetId={props.targetId} duel={props.duel} clock={props.clock} quality={props.quality} onDone={props.onDone} />;
    const kind: DuelElementBurstKind = props.kind === "flameBurst" ? "fire"
        : props.kind === "abyssBurst" ? "abyss"
            : props.kind === "lightningStorm" ? "lightning"
                : props.kind === "earthBurst" ? "earth"
                    : "arcane";
    const heading = Math.atan2(props.to[0] - props.from[0], props.to[2] - props.from[2]);
    return <DuelElementVolume at={[props.to[0], FLOOR_Y + 0.06, props.to[2]]} kind={kind} color={props.color} big heading={heading} phase="signature" quality={props.quality} onDone={props.onDone} />;
}

/** Studio-style signature renderer used by the live coliseum. Fire, earth,
 * lightning and abyss retain the cel-shaded impact language; water and wind are
 * routed to dedicated animated volumes above because their silhouettes must read
 * unmistakably as a tsunami and a tornado. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelAnimeSetPiece({ kind, from, to, color, quality, onDone }: {
    kind: DuelSetPieceKind; from: Vec3; to: Vec3; color: string; quality: PetVisualQualityConfig; onDone: () => void;
}) {
    const root = useRef<THREE.Group>(null);
    const strokes = useRef<Array<THREE.Group | null>>([]);
    const materials = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const fxKind: DuelElementBurstKind = kind === "tidalWave" ? "water"
        : kind === "tornado" ? "wind"
            : kind === "flameBurst" ? "fire"
                : kind === "abyssBurst" ? "abyss"
                    : kind === "lightningStorm" ? "lightning"
                        : kind === "earthBurst" ? "earth" : "arcane";
    const palette = useMemo(() => duelFxPalette(fxKind, color), [fxKind, color]);
    const count = quality.id === "low" ? 5 : quality.id === "medium" ? 7 : 8;
    const specs = useMemo(() => Array.from({ length: count }, (_, i) => {
        const u = i / Math.max(1, count - 1);
        if (fxKind === "water") {
            const a = -0.18 + u * Math.PI * 1.12;
            return { x: Math.cos(a) * 1.22 - 0.18, y: 0.32 + Math.sin(a) * 1.3, z: (i % 2) * 0.15, pitch: 0.02, yaw: -0.12 + i * 0.035, roll: a - 1.48, length: 1.52 + (i % 3) * 0.18, width: 0.25 + (i % 2) * 0.04, curl: 0.64 + (i % 3) * 0.1, jagged: 0 };
        }
        if (fxKind === "wind") {
            const a = i * 1.38;
            const radius = 0.28 + u * 0.82;
            return { x: Math.cos(a) * radius, y: 0.28 + u * 3.0, z: Math.sin(a) * radius, pitch: Math.PI / 2, yaw: a, roll: i % 2 ? 0.12 : -0.12, length: 1.45 + u * 1.72, width: 0.21 + u * 0.11, curl: 0.3 + u * 0.16, jagged: 0 };
        }
        if (fxKind === "lightning") {
            return { x: (i % 2 ? 0.26 : -0.26) + (i > count * 0.6 ? 0.24 : 0), y: 0.18 + u * 3.5, z: ((i % 3) - 1) * 0.17, pitch: 0, yaw: (i % 3 - 1) * 0.14, roll: i % 2 ? -0.72 : 0.72, length: 1.25 + (i % 3) * 0.24, width: 0.22, curl: 0.12, jagged: 0.24 };
        }
        if (fxKind === "earth") {
            const a = -1.08 + u * 2.16;
            return { x: Math.cos(a) * (0.45 + u * 0.75), y: 0.08 + (i % 3) * 0.15, z: Math.sin(a) * (0.45 + u * 0.75), pitch: 0.12, yaw: -a, roll: -0.52 + u * 1.04, length: 1.25 + (i % 3) * 0.22, width: 0.38 + (i % 2) * 0.08, curl: 0.1, jagged: 0.09 };
        }
        const lane = i - (count - 1) * 0.5;
        const flame = fxKind === "fire";
        return { x: flame ? Math.sin(i * 1.7) * (0.34 + u * 0.5) : 0.06 + (i % 2) * 0.16, y: 0.08 + (i % 3) * 0.18, z: flame ? Math.cos(i * 1.7) * (0.34 + u * 0.5) : lane * 0.22, pitch: 0, yaw: flame ? i * 1.7 : lane * 0.06, roll: flame ? 0.88 + (i % 3) * 0.28 : -0.76 + u * 1.52, length: 1.58 + (i % 3) * 0.28, width: 0.34 + (i % 2) * 0.07, curl: flame ? 0.56 + (i % 3) * 0.13 : fxKind === "abyss" ? 0.36 : 0.28, jagged: 0 };
    }), [count, fxKind]);
    const geometries = useMemo(() => specs.map((spec) => makeAnimeStrokeGeometry(spec.length, spec.width, spec.curl, spec.jagged)), [specs]);
    useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const heading = Math.atan2(dx, dz);
    const duration = fxKind === "water" ? 1.58 : fxKind === "wind" ? 1.5 : 1.42;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / duration);
        const arrive = 1 - Math.pow(1 - Math.min(1, p / 0.22), 3);
        const fade = p < 0.78 ? 1 : Math.max(0, 1 - (p - 0.78) / 0.22);
        const travel = fxKind === "water" ? 1 - Math.pow(1 - Math.min(1, p / 0.34), 2) : 1;
        if (root.current) {
            root.current.position.set(lerp(from[0], to[0], travel), FLOOR_Y + 0.06, lerp(from[2], to[2], travel));
            // A crest still travels down the attack lane, but presents at a
            // three-quarter broadcast angle. Fully aligning a broad wave to the
            // lane turns it edge-on and reads as a vertical board.
            root.current.rotation.y = fxKind === "wind" ? heading + p * Math.PI * 2.4 : fxKind === "water" ? heading * 0.2 : heading;
            root.current.scale.setScalar((0.24 + arrive * 1.04) * (fxKind === "wind" ? 1.06 : fxKind === "water" ? 0.8 : 1));
        }
        strokes.current.forEach((stroke, i) => {
            if (!stroke) return;
            const spec = specs[i];
            const stagger = Math.max(0, Math.min(1, arrive * 1.35 - i * 0.035));
            stroke.position.set(spec.x * stagger, spec.y * stagger, spec.z * stagger);
            stroke.rotation.set(spec.pitch, spec.yaw + (fxKind === "wind" ? p * 0.9 : 0), spec.roll);
            stroke.scale.setScalar(0.35 + stagger * 0.75);
        });
        materials.current.forEach((material) => { if (material) material.opacity = Number(material.userData.baseOpacity ?? 1) * fade; });
        if (light.current) light.current.intensity = fade * Math.sin(Math.PI * Math.min(1, p * 1.35)) * 5.2;
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });
    return (
        <group ref={root}>
            {specs.map((spec, i) => (
                <group key={`signature-brush-${i}`} ref={(group) => { strokes.current[i] = group; }}>
                    <mesh geometry={geometries[i]} position={[0, 0, -0.05]} scale={[1.07, 1.07, 1.12]} castShadow={fxKind === "earth"}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.8; materials.current[i * 3] = material; } }} color={palette.dark} transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={geometries[i]} castShadow={fxKind === "earth"}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.96; materials.current[i * 3 + 1] = material; } }} color={i % 3 === 0 ? palette.accent : palette.body} emissive={palette.accent} emissiveIntensity={0.08} transparent opacity={0.96} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={geometries[i]} position={[spec.length * 0.13, spec.width * 0.08, 0.075]} scale={[0.64, 0.3, 0.7]}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.84; materials.current[i * 3 + 2] = material; } }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.11} transparent opacity={0.84} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            ))}
            {fxKind === "earth" && Array.from({ length: quality.id === "low" ? 6 : 10 }, (_, i) => {
                const a = (i / 10) * Math.PI * 2;
                return <mesh key={`signature-rock-${i}`} position={[Math.cos(a) * (0.65 + i % 3 * 0.25), 0.24 + i % 4 * 0.24, Math.sin(a) * (0.65 + i % 3 * 0.25)]} rotation={[i * 0.7, i * 0.4, i * 0.9]} scale={0.14 + i % 3 * 0.045} castShadow><dodecahedronGeometry args={[1, 0]} /><meshToonMaterial color={i % 2 ? palette.body : palette.accent} /></mesh>;
            })}
            <Sparkles count={Math.max(8, Math.round(quality.setPieceParticles * 0.48))} position={[0, fxKind === "wind" ? 1.8 : 1.0, 0]} scale={fxKind === "wind" ? [3.6, 4.2, 3.6] : [3.8, 3.1, 3.8]} size={1.8} speed={1.5} opacity={0.34} color={palette.core} noise={1.4} />
            {quality.dynamicPetLight && <pointLight ref={light} position={[0, 1.3, 0]} color={palette.accent} intensity={0} distance={8} decay={2} />}
        </group>
    );
}

function DuelAiDebugHud({ duel, clock, nameById }: { duel: DuelResult; clock: { current: DuelClock }; nameById: Record<string, string> }) {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const timer = window.setInterval(() => setTick(Math.max(0, Math.floor(clock.current.t))), 100);
        return () => window.clearInterval(timer);
    }, [clock]);
    const snap = duel.snapshots[Math.min(duel.snapshots.length - 1, tick)];
    if (!snap) return null;
    const recent = duel.events.filter((event) => event.type === "hit" && event.t <= tick && event.t >= tick - DUEL_TPS * 2).slice(-4);
    return (
        <div data-testid="pet-duel-ai-debug" style={{ position: "absolute", top: 52, right: 12, zIndex: 50, width: "min(390px,45vw)", maxHeight: "70vh", overflow: "auto", pointerEvents: "none", padding: 10, borderRadius: 10, border: "1px solid rgba(125,211,252,0.55)", background: "rgba(2,6,23,0.88)", color: "#e2e8f0", boxShadow: "0 10px 30px rgba(0,0,0,0.45)", font: "600 10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7, color: "#7dd3fc", fontWeight: 900 }}><span>AI TRUTH TRACE</span><span>t {(tick / DUEL_TPS).toFixed(1)}s</span></div>
            {snap.actors.map((actor) => (
                <div key={actor.id} style={{ padding: "7px 0", borderTop: "1px solid rgba(148,163,184,0.18)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", color: actor.team === "player" ? "#86efac" : "#fca5a5", fontWeight: 900 }}>
                        <span>{nameById[actor.id] ?? actor.id}</span><span>{Math.round(actor.hp)}/{actor.maxHp} HP</span>
                    </div>
                    <div><span style={{ color: "#fef08a" }}>{actor.ai?.state ?? "trace unavailable"}</span> → {actor.ai?.targetId ? (nameById[actor.ai.targetId] ?? actor.ai.targetId) : "none"} · R* {actor.ai?.desiredRange ?? "—"}</div>
                    <div>plan: {actor.ai?.plan ?? "—"}</div>
                    <div style={{ color: "#94a3b8" }}>why: {actor.ai?.reason ?? "—"}</div>
                    <div style={{ color: "#c4b5fd" }}>element: {actor.ai?.elementalSetup ?? "—"}</div>
                    <div>status: {actor.statuses.join(", ") || "clear"}</div>
                    {actor.ai?.path && actor.ai.path.length > 1 && <div>path: {actor.ai.path.map((point) => `(${point.x.toFixed(1)},${point.y.toFixed(1)})`).join(" → ")}</div>}
                    {actor.ai?.cooldownPriorities?.length ? <div style={{ color: "#bae6fd" }}>cd: {actor.ai.cooldownPriorities.join(" · ")}</div> : null}
                </div>
            ))}
            <div style={{ borderTop: "1px solid rgba(148,163,184,0.18)", paddingTop: 6, color: "#fda4af" }}>recent damage: {recent.length ? recent.map((event) => `${nameById[event.actorId] ?? event.actorId} ${event.dmg ?? 0}`).join(" · ") : "none"}</div>
        </div>
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
    /** Dev-harness scrub point for deterministic VFX screenshots. Live callers omit it. */
    initialTick?: number;
    onFightAgain?: () => void;
    onExit: () => void;
};

export function PetColiseumDuel({ playerPet, enemyPet, playerReservePet, enemyReservePet, seed, result, sharedImages = {}, initialTick = 0, onFightAgain, onExit }: PetColiseumDuelProps) {
    const quality = useMemo(() => petVisualQuality(), []);
    // Adaptive resolution: start at the tier's normal DPR (the device ratio clamped
    // into [min,max] — exactly what the static preset rendered) and let
    // PerformanceMonitor drop it toward the floor under sustained load, restoring
    // with headroom. This can only ever render FEWER pixels than before, never
    // more, so it relieves fill-rate pressure without changing the resting look.
    const dprBase = useMemo(() => Math.min(Math.max(quality.dpr[0], typeof window !== "undefined" ? window.devicePixelRatio : 1), quality.dpr[1]), [quality]);
    const [dpr, setDpr] = useState(dprBase);
    const perfQa = useMemo(() => new URLSearchParams(window.location.search).get("petPerf") === "1", []);
    const mobileQa = useMemo(() => new URLSearchParams(window.location.search).get("mobileqa") === "1", []);
    const duel = useMemo(
        () => directPetDuelPresentation(result
            ?? ((playerReservePet || enemyReservePet)
                ? runPetPartyDuel(playerPet, playerReservePet ?? null, enemyPet, enemyReservePet ?? null, seed)
                : runPetDuel(playerPet, enemyPet, seed))),
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
    const freeRoam3d = useMemo(() => roster.every((fighter) => petCombatModel(fighter.pet) !== null), [roster]);
    const debugAi = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debugAI") === "1", []);
    // 3D coliseum scene textures (curved wall + lit floor) — same as the round
    // renderer, so the duel inherits the grounded look the owner liked.
    const floor = useMemo(() => loadSceneTexture(COLISEUM_FLOOR_URL), []);
    const backdrop = useMemo(() => loadSceneTexture(COLISEUM_BG_URL), []);
    useEffect(() => () => { floor.dispose(); backdrop.dispose(); }, [floor, backdrop]);
    useEffect(() => scheduleDuelFxGeometryPrewarm(
        roster.map((fighter) => duelElementBurstKind(fighter.pet.element)),
        quality,
    ), [quality, roster]);

    const clock = useRef<DuelClock>({ t: Math.max(0, initialTick), playing: false, intro: 0 });   // starts paused for the VS intro + opening choreography
    const seqRef = useRef(0);
    const [runId, setRunId] = useState(0);
    const [ended, setEnded] = useState(false);
    const [paused, setPaused] = useState(false);
    const [numbers, setNumbers] = useState<Array<{ id: number; text: string; pos: Vec3; crit: boolean; heal: boolean }>>([]);
    const [impacts, setImpacts] = useState<Array<{ id: number; pos: Vec3; color: string; big: boolean; mode: DuelImpactMode }>>([]);
    const [elementBursts, setElementBursts] = useState<Array<{ id: number; pos: Vec3; kind: DuelElementBurstKind; color: string; big: boolean; heading: number; style: PetHeroMoveStyle }>>([]);
    const [aftermathFx, setAftermathFx] = useState<Array<{ id: number; pos: Vec3; kind: DuelElementBurstKind; color: string; big: boolean }>>([]);
    const [supportFx, setSupportFx] = useState<Array<{ id: number; pos: Vec3; color: string; kind: DuelSupportKind; actorId?: string }>>([]);
    const [fxList, setFxList] = useState<Array<{ id: number; frames: string[]; pos: Vec3; scale: number; dur: number }>>([]);
    const [cutInQueue, setCutInQueue] = useState<Array<{ id: number; pet: Pet; side: "player" | "enemy"; move: string }>>([]);
    const cutIn = cutInQueue[0] ?? null;
    const [shocks, setShocks] = useState<Array<{ id: number; pos: Vec3; color: string; big: boolean }>>([]);
    const [powerUps, setPowerUps] = useState<Array<{ id: number; pos: Vec3; color: string; actorId?: string; style: PetHeroMoveStyle }>>([]);
    const [trails, setTrails] = useState<Array<{ id: number; pos: Vec3; toward: number; kind: MoveChoreoKind; color: string; weight: DuelAttackWeight; style: PetHeroMoveStyle }>>([]);
    const [dashFx, setDashFx] = useState<DuelDashCue[]>([]);
    const [pressureFx, setPressureFx] = useState<DuelPressureCue[]>([]);
    const [setPieces, setSetPieces] = useState<Array<{ id: number; from: Vec3; to: Vec3; targetId?: string; color: string; kind: DuelSetPieceKind }>>([]);
    const [dusts, setDusts] = useState<Array<{ id: number; at: Vec3 }>>([]);   // transient foot-dust on dodge landings / KO impact
    const [scorches, setScorches] = useState<Array<{ id: number; pos: Vec3; w: number }>>([]);   // accumulating scorch marks — the arena remembers the fight
    const [flash, setFlash] = useState<{ id: number; color: string; intensity: number } | null>(null);
    const [callout, setCallout] = useState<{ id: number; text: string } | null>(null);
    const [combo, setCombo] = useState<{ id: number; n: number } | null>(null);
    const [announce, setAnnounce] = useState<{ id: number; text: string; tone: "danger" | "reversal" | "ultimate" | "ko" } | null>(null);  // play-by-play broadcast line
    const [moveCallout, setMoveCallout] = useState<{ id: number; text: string; side: "player" | "enemy"; tone: DuelMoveCalloutTone } | null>(null);  // tiered move ID
    const [intro, setIntro] = useState(true);   // VS splash held before the fight plays
    useEffect(() => {
        if (!cutIn) return;
        const timer = window.setTimeout(() => setCutInQueue((queue) => queue.slice(1)), 1020);
        return () => window.clearTimeout(timer);
    }, [cutIn]);
    const elementById = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, r.pet.element])) as Record<string, string | null | undefined>, [roster]);
    const nameById = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, r.pet.name])) as Record<string, string>, [roster]);
    const profileById = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, petCombatModel(r.pet)?.profile])) as Record<string, PetCombatModelProfile | undefined>, [roster]);
    const ultById = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, r.pet.jutsus?.find((j) => j.signature)?.name ?? "Ultimate"])) as Record<string, string>, [roster]);
    // Each pet's HERO move — its signature jutsu if flagged, else its strongest by power —
    // the move that earns the anime freeze-frame CUT-IN, so every fight gets epic moments
    // even when no jutsu is formally flagged "signature" (most aren't).
    const heroMoveById = useMemo(() => Object.fromEntries(roster.map((r) => {
        const js = r.pet.jutsus ?? [];
        const sig = js.find((j) => j.signature);
        const strongest = js.reduce<(typeof js)[number] | undefined>((best, j) => ((j.power ?? 0) > (best?.power ?? -1) ? j : best), undefined);
        return [r.id, (sig ?? strongest)?.name ?? ""];
    })) as Record<string, string>, [roster]);
    // VS intro: hold on the face-off (clock paused) for a beat, then start. Re-runs
    // on replay / fight-again (runId bump).
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIntro(true);
        clock.current.playing = false;
        clock.current.intro = 0;   // restart the still size-up / power-gather choreography
        // Clear the VS splash first, then let the gather play in the clear while the
        // simulation remains paused for the full opening.
        const splashT = window.setTimeout(() => setIntro(false), INTRO_SPLASH_END * 1000);
        const fightT = window.setTimeout(() => {
            clock.current.intro = INTRO_TOTAL;
            clock.current.playing = true;
            setPaused(false);
        }, INTRO_TOTAL * 1000);
        return () => { window.clearTimeout(splashT); window.clearTimeout(fightT); };
    }, [runId]);

    // FX map through the SAME field→floor placement as the fighters, at mid-body
    // height, so impacts / numbers / casts land on the right pet in the 3D scene.
    const spawnNumber = (n: { x: number; z: number; text: string; crit: boolean; heal: boolean }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setNumbers((arr) => [...arr.slice(-3), { id, text: n.text, pos: [fp.wx, FLOOR_Y + TARGET_SPRITE_H * 1.05, fp.wz], crit: n.crit, heal: n.heal }]);
        window.setTimeout(() => setNumbers((arr) => arr.filter((x) => x.id !== id)), 850);
    };
    const spawnImpact = (n: { x: number; z: number; color: string; big: boolean; mode?: DuelImpactMode }) => {
        const mode = n.mode ?? "impact";
        // In the 3D presentation, ordinary contacts are fully owned by the
        // element brush burst and dash-arrival renderer. Keeping the legacy
        // graphic impact on top reintroduced pale rings and visual clutter.
        if (freeRoam3d && mode === "impact") return;
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setImpacts((arr) => [...arr.slice(-2), { id, pos: [fp.wx, mode === "impact" ? FX_Y : FLOOR_Y + 0.035, fp.wz], color: n.color, big: n.big, mode }]);
    };
    const spawnElementBurst = (n: { x: number; z: number; element?: string | null; move?: string; color: string; big: boolean; heading?: number; style?: PetHeroMoveStyle }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setElementBursts((arr) => [...arr.slice(-1), { id, pos: [fp.wx, FX_Y, fp.wz], kind: duelElementBurstKind(n.element, n.move), color: n.color, big: n.big, heading: n.heading ?? 0, style: n.style ?? "generic" }]);
    };
    const spawnAftermath = (n: { x: number; z: number; element?: string | null; move?: string; color: string; big: boolean }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setAftermathFx(() => [{ id, pos: [fp.wx, FLOOR_Y, fp.wz], kind: duelElementBurstKind(n.element, n.move), color: n.color, big: n.big }]);
    };
    const spawnSupport = (n: { x: number; z: number; color: string; kind: DuelSupportKind; actorId?: string }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setSupportFx((arr) => [...arr.slice(-1), { id, pos: [fp.wx, FLOOR_Y + 0.035, fp.wz], color: n.color, kind: n.kind, actorId: n.actorId }]);
    };
    // Element-distinct ability VFX — an explicit fx-folder `key` (the tactical-arena
    // assets: kaboom/explosion/vortex/spark/bighit) when given, else the plain
    // element burst (fire/water/lightning/earth/wind).
    const spawnFx = (n: { x: number; z: number; element?: string | null; key?: string; scale: number; dur: number }) => {
        // High-quality models use native scene effects above. Retaining the old
        // flipbook sprites here only for fallback/2D pets avoids mixing visual
        // languages in the professional 3D presentation.
        if (freeRoam3d) return;
        const frames = bundledJutsuFxFrames(n.key || elementVfxKey(n.element));
        if (!frames) return;
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setFxList((arr) => [...arr, { id, frames, pos: [fp.wx, FX_Y, fp.wz], scale: n.scale * 1.1, dur: n.dur }]);
    };
    // Ground shockwave rings on the floor at the impact point.
    const spawnShock = (n: { x: number; z: number; color: string; big: boolean }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setShocks((arr) => [...arr.slice(-1), { id, pos: [fp.wx, 0, fp.wz], color: n.color, big: n.big }]);
    };
    const spawnDust = (n: { x: number; z: number }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setDusts((arr) => [...arr.slice(-4), { id, at: [fp.wx, FLOOR_Y + 0.02, fp.wz] as Vec3 }]);
    };
    const spawnScorch = (n: { x: number; z: number; big?: boolean }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        // Flat on the 3D floor with the renderer's own decal convention (rotate to XZ,
        // just above FLOOR_Y, no depth write); keep only the last 8 so a long fight
        // does not tile the whole arena.
        setScorches((arr) => [...arr, { id, pos: [fp.wx, FLOOR_Y + 0.025, fp.wz] as Vec3, w: n.big ? 2.3 : 1.55 }].slice(-8));
    };
    const spawnPowerUp = (n: { x: number; z: number; color: string; actorId?: string; style?: PetHeroMoveStyle }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setPowerUps((arr) => [...arr.slice(-1), { id, pos: [fp.wx, FLOOR_Y, fp.wz], color: n.color, actorId: n.actorId, style: n.style ?? "generic" }]);
    };
    // Swept melee weapon trail at the ATTACKER (mid-body), per choreography archetype.
    const spawnTrail = (n: { x: number; z: number; toward: number; kind: MoveChoreoKind; color: string; weight: DuelAttackWeight; style: PetHeroMoveStyle }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setTrails((arr) => [...arr.slice(-1), { id, pos: [fp.wx, FLOOR_Y + TARGET_SPRITE_H * 0.42, fp.wz], toward: n.toward, kind: n.kind, color: n.color, weight: n.weight, style: n.style }]);
    };
    const spawnDash = (n: { actorId?: string; fromX: number; fromZ: number; toX: number; toZ: number; impactX?: number; impactZ?: number; color: string; element?: string | null; move?: string; style?: PetHeroMoveStyle; impact: boolean; startTick?: number; contactTick?: number }) => {
        const id = seqRef.current++;
        const from = duelFieldToFloor(n.fromX, n.fromZ);
        const to = duelFieldToFloor(n.toX, n.toZ);
        const impact = duelFieldToFloor(n.impactX ?? n.toX, n.impactZ ?? n.toZ);
        const travelDuration = n.impact ? 0.48 : 0.42;
        const duration = n.impact ? 1.04 : 0.82;
        const startTick = n.startTick ?? clock.current.t;
        const contactTick = Math.max(startTick + 1, n.contactTick ?? startTick + Math.round(DUEL_TPS * 0.5));
        const endTick = contactTick + Math.round(DUEL_TPS * (n.impact ? 1.15 : 0.8));
        // Alternate the authored lane per cue/actor. This is deterministic visual
        // choreography, not navigation: the pet still starts and lands at the
        // simulator's exact positions, but cuts across an S-shaped attack lane.
        const side = ((id + (n.actorId?.length ?? 0)) & 1) === 0 ? 1 : -1;
        const kind = duelElementBurstKind(n.element, n.move);
        const lunarMove = /lunar|eclipse|moon|ninetail|kitsune/i.test(String(n.move ?? ""));
        const cue: DuelDashCue = {
            id,
            actorId: n.actorId,
            from: [from.wx, FLOOR_Y, from.wz],
            to: [to.wx, FLOOR_Y, to.wz],
            impactAt: [impact.wx, FLOOR_Y, impact.wz],
            color: lunarMove ? "#9d7cff" : n.color,
            kind,
            move: n.move,
            style: n.style ?? "generic",
            impact: n.impact,
            createdAt: performance.now(),
            duration,
            travelDuration,
            startTick,
            contactTick,
            endTick,
            bend: side * (n.impact ? 0.56 : 0.42) * (n.style && n.style !== "generic" ? 1.32 : 1),
            weave: -side * (n.impact ? 0.24 : 0.18) * (n.style && n.style !== "generic" ? 1.38 : 1),
        };
        // At most one authored route can own a fighter. Overlapping cues were
        // the direct cause of the dash popping between two paths.
        setDashFx((arr) => [...arr.filter((existing) => !n.actorId || existing.actorId !== n.actorId), cue]);
    };
    const spawnPressure = (n: { fromX: number; fromZ: number; toX: number; toZ: number; leftColor: string; rightColor: string; leftElement?: string | null; rightElement?: string | null }) => {
        const id = seqRef.current++;
        const from = duelFieldToFloor(n.fromX, n.fromZ);
        const to = duelFieldToFloor(n.toX, n.toZ);
        setPressureFx(() => [{
            id,
            from: [from.wx, FLOOR_Y, from.wz],
            to: [to.wx, FLOOR_Y, to.wz],
            leftColor: n.leftColor,
            rightColor: n.rightColor,
            leftKind: duelElementBurstKind(n.leftElement),
            rightKind: duelElementBurstKind(n.rightElement),
        }]);
    };
    const spawnSetPiece = (n: { actorId?: string; targetId?: string; fromX: number; fromZ: number; toX: number; toZ: number; element?: string | null; move?: string }) => {
        const id = seqRef.current++;
        // Signature releases are deliberately delayed until their portrait/charge
        // anticipation clears. Resolve both combatants at RELEASE time instead of
        // replaying the coordinates captured 1.1-1.4 seconds earlier. At the faster
        // presentation clock that stale point could already be occupied by the
        // caster, making a hostile tornado look like a self-cast.
        const snapshot = duel.snapshots[Math.min(duel.snapshots.length - 1, Math.max(0, Math.floor(clock.current.t)))];
        const actor = n.actorId ? snapshot?.actors.find((candidate) => candidate.id === n.actorId && candidate.hp > 0) : null;
        let target = n.targetId && n.targetId !== n.actorId
            ? snapshot?.actors.find((candidate) => candidate.id === n.targetId && candidate.hp > 0)
            : null;
        if (!target && actor) {
            target = snapshot?.actors.find((candidate) => candidate.hp > 0 && candidate.team !== actor.team) ?? null;
        }
        const from = actor ? duelFieldToFloor(actor.x, actor.y) : duelFieldToFloor(n.fromX, n.fromZ);
        const to = target ? duelFieldToFloor(target.x, target.y) : duelFieldToFloor(n.toX, n.toZ);
        const kind = duelSetPieceKind(n.element, n.move);
        setSetPieces(() => [{
            id,
            from: [from.wx, FLOOR_Y, from.wz],
            to: [to.wx, FLOOR_Y, to.wz],
            targetId: target?.id ?? n.targetId,
            color: kind === "lunarBurst" ? "#9d7cff" : elementColor(n.element).base,
            kind,
        }]);
    };
    // Full-screen element flash / big "CRITICAL!/FINISH!" callout / combo-counter pop.
    const triggerFlash = (color: string, intensity: number) => setFlash({ id: seqRef.current++, color, intensity: Math.min(0.6, intensity) });
    const triggerCallout = (text: string) => { const id = seqRef.current++; setCallout({ id, text }); window.setTimeout(() => setCallout((c) => (c && c.id === id ? null : c)), 760); };
    const triggerCombo = (n: number) => { const id = seqRef.current++; setCombo({ id, n }); window.setTimeout(() => setCombo((c) => (c && c.id === id ? null : c)), 820); };
    // Play-by-play broadcast line (lower-third) — narrates the swings of the fight.
    const triggerAnnounce = (text: string, tone: "danger" | "reversal" | "ultimate" | "ko") => { const id = seqRef.current++; setAnnounce({ id, text, tone }); window.setTimeout(() => setAnnounce((a) => (a && a.id === id ? null : a)), 2600); };
    // Named-move flash ("Hellhound Execution!") — a quick stylish callout, side-tinted.
    const triggerMoveCallout = (text: string, side: "player" | "enemy", tone: DuelMoveCalloutTone = "attack") => { const id = seqRef.current++; setMoveCallout({ id, text, side, tone }); window.setTimeout(() => setMoveCallout((c) => (c && c.id === id ? null : c)), tone === "support" ? 900 : 780); };
    // Signature ULTIMATE → an anime portrait cut-in (reuses the round renderer's
    // .pet-cutin CSS slam). The move name is the pet's flagged signature jutsu.
    const triggerCutIn = (actorId: string, move: string) => {
        const r = roster.find((x) => x.id === actorId); if (!r) return;
        const id = seqRef.current++;
        setCutInQueue((queue) => [...queue, { id, pet: r.pet, side: r.mirror ? "enemy" : "player", move: move || (r.pet.jutsus?.find((j) => j.signature)?.name ?? "Special Move") }]);
    };
    const advanceClock = (maxT: number, delta: number) => {
        // Before the fight plays, advance the still size-up / power-gather clock.
        if (!clock.current.playing || cutIn) { clock.current.intro = (clock.current.intro ?? 0) + delta; return; }
        clock.current.t = Math.min(maxT, clock.current.t + delta * DUEL_TPS);
    };
    const finishDuel = () => {
        // The result is its own shot. A late hero cut-in, dash ribbon, or pressure
        // volume must never remain layered over the winner/loser composition.
        setEnded(true);
        setCutInQueue([]);
        setCallout(null);
        setCombo(null);
        setAnnounce(null);
        setMoveCallout(null);
        setPowerUps([]);
        setTrails([]);
        setDashFx([]);
        setPressureFx([]);
        setSetPieces([]);
    };
    const replay = () => { clock.current.t = Math.max(0, initialTick); clock.current.playing = false; setPaused(false); setEnded(false); setNumbers([]); setImpacts([]); setElementBursts([]); setAftermathFx([]); setSupportFx([]); setFxList([]); setCutInQueue([]); setShocks([]); setDusts([]); setScorches([]); setPowerUps([]); setTrails([]); setDashFx([]); setPressureFx([]); setSetPieces([]); setFlash(null); setCallout(null); setCombo(null); setAnnounce(null); setMoveCallout(null); setRunId((r) => r + 1); };
    const togglePause = () => { setPaused((wasPaused) => { clock.current.playing = wasPaused; return !wasPaused; }); };
    const resultLabel = duel.result === "win" ? "Victory" : duel.result === "loss" ? "Defeat" : "Draw";

    return createPortal((
        <div data-testid="pet-duel-root" className={mobileQa ? "pet-duel-mobile-qa" : undefined} style={{ position: "fixed", inset: mobileQa ? undefined : 0, top: mobileQa ? 0 : undefined, left: mobileQa ? "50%" : undefined, transform: mobileQa ? "translateX(-50%)" : undefined, zIndex: 200, width: mobileQa ? 390 : "100vw", height: mobileQa ? "min(844px,100vh)" : "100vh", overflow: "hidden", background: "linear-gradient(#1a1206, #0a0703 70%)" }}>
            <style>{`
                @keyframes petDuelFlash { 0% { opacity: 0; } 14% { opacity: var(--fp, 0.4); } 100% { opacity: 0; } }
                @keyframes petDuelCallout { 0% { opacity: 0; transform: scale(0.5); } 18% { opacity: 1; transform: scale(1.12); } 70% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(0.95); } }
                @keyframes petDuelCombo { 0% { opacity: 0; transform: scale(1.6); } 25% { opacity: 1; transform: scale(1); } 78% { opacity: 1; } 100% { opacity: 0; } }
                @keyframes petDuelCritPop { 0% { transform: scale(0.4); } 40% { transform: scale(1.35); } 100% { transform: scale(1); } }
                @keyframes petDuelVs { 0% { opacity: 0; transform: scale(2.2) rotate(-8deg); } 45% { opacity: 1; transform: scale(0.92) rotate(0deg); } 60% { transform: scale(1.04); } 100% { transform: scale(1); } }
                @keyframes petDuelVsName { 0% { opacity: 0; transform: translateY(14px); } 100% { opacity: 1; transform: translateY(0); } }
                @keyframes petDuelAnnounce { 0% { opacity: 0; transform: translateX(-50%) translateY(16px) scale(0.96); } 12% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } 82% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-6px); } }
                @keyframes petDuelMove { 0% { opacity: 0; transform: translateX(-50%) scale(0.6) skewX(-10deg); } 22% { opacity: 1; transform: translateX(-50%) scale(1.06) skewX(-10deg); } 72% { opacity: 1; transform: translateX(-50%) scale(1) skewX(-10deg); } 100% { opacity: 0; transform: translateX(-50%) scale(1) skewX(-10deg); } }
                @keyframes petDuelTacticalMove { 0% { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.9); } 18% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } 76% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-5px) scale(0.98); } }
                @keyframes petSignatureFocus { 0% { opacity: 0; } 18% { opacity: 1; } 100% { opacity: 0; } }
                @keyframes petSignatureCue { 0% { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.92); } 20% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } 72% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-5px) scale(0.98); } }
                @keyframes petHeroMotif { 0% { opacity: 0; transform: scale(1.65) rotate(-22deg); } 24% { opacity: .2; transform: scale(.94) rotate(4deg); } 100% { opacity: .08; transform: scale(1.08) rotate(0deg); } }
                .pet-duel-hero-cutin { z-index: 16; padding-inline: clamp(22px,8vw,120px); gap: clamp(20px,4vw,64px); background: linear-gradient(100deg,rgba(2,6,23,0.08) 0%,rgba(2,6,23,0.94) 20%,rgba(8,12,28,0.96) 78%,rgba(2,6,23,0.08) 100%); }
                .pet-duel-hero-cutin .pet-cutin-motif { position: absolute; z-index: 1; top: 50%; translate: 0 -50%; color: var(--hero-glow); font: 900 clamp(180px,34vw,470px)/.72 Georgia,serif; text-shadow: 0 0 36px var(--hero-glow); opacity: .08; animation: petHeroMotif 920ms cubic-bezier(.16,.84,.24,1) both; pointer-events: none; }
                .pet-duel-hero-cutin.player .pet-cutin-motif { left: 3%; }
                .pet-duel-hero-cutin.enemy .pet-cutin-motif { right: 3%; }
                .pet-duel-hero-cutin .pet-cutin-portrait { position: relative; z-index: 2; filter: drop-shadow(0 14px 20px rgba(0,0,0,.68)); }
                .pet-duel-hero-cutin .pet-cutin-portrait .pet-battle-avatar { width: clamp(170px,28vw,390px); height: clamp(170px,28vw,390px); overflow: visible; }
                .pet-duel-hero-cutin .pet-cutin-portrait > img { display: block; width: clamp(170px,28vw,390px); height: clamp(170px,28vw,390px); object-fit: contain; }
                .pet-duel-hero-cutin .pet-cutin-text { position: relative; z-index: 2; max-width: min(52vw,760px); gap: 8px; }
                .pet-duel-hero-cutin .pet-cutin-pet { font-size: clamp(12px,1.5vw,19px); color: var(--hero-glow); text-shadow: 0 0 16px var(--hero-glow); }
                .pet-duel-hero-cutin .pet-cutin-move { font-size: clamp(30px,5.4vw,68px); white-space: normal; text-wrap: balance; text-shadow: 0 0 18px var(--hero-glow),0 5px 14px #000; }
                .pet-duel-hero-cutin .pet-cutin-kicker { color: #fff4c7; font: 900 clamp(10px,1.1vw,14px)/1 var(--font-display); letter-spacing: .24em; text-transform: uppercase; }
                .pet-duel-mobile-qa .pet-duel-hero-cutin { padding-inline: 12px; gap: 8px; }
                .pet-duel-mobile-qa .pet-duel-hero-cutin .pet-cutin-portrait .pet-battle-avatar, .pet-duel-mobile-qa .pet-duel-hero-cutin .pet-cutin-portrait > img { width: 145px; height: 145px; }
                .pet-duel-mobile-qa .pet-duel-hero-cutin .pet-cutin-text { flex: 1; min-width: 0; max-width: 213px; }
                .pet-duel-mobile-qa .pet-duel-hero-cutin .pet-cutin-move { font-size: 26px; }
                @media (max-width: 600px) { .pet-duel-hero-cutin { padding-inline: 12px; gap: 8px; } .pet-duel-hero-cutin .pet-cutin-portrait .pet-battle-avatar, .pet-duel-hero-cutin .pet-cutin-portrait > img { width: 145px; height: 145px; } .pet-duel-hero-cutin .pet-cutin-text { flex: 1; min-width: 0; max-width: 213px; } .pet-duel-hero-cutin .pet-cutin-move { font-size: 26px; } }
            `}</style>
            {/* Vignette — darkens the screen edges so the eye stays on the fight. */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 46%, transparent 42%, rgba(0,0,0,0.55) 100%)" }} />
            {/* The duel now plays INSIDE the 3D coliseum (curved wall + lit floor +
                perspective hero camera), so fighters STAND on the floor with real
                contact shadows instead of floating over a painted wall. */}
            <Canvas shadows={quality.modelShadows ? { type: THREE.PCFShadowMap } : false} dpr={dpr} frameloop={paused || ended ? "demand" : "always"} camera={{ position: CAM_POS, fov: CAM_FOV }} onCreated={({ camera }) => camera.lookAt(CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2])}>
                <fog attach="fog" args={["#2a1c10", 26, 54]} />
                <ResponsiveCamera />
                {/* Adaptive DPR: drop to the tier floor under sustained load, restore with
                    headroom; flipflops pins to the floor rather than oscillate. */}
                <PerformanceMonitor onDecline={() => setDpr(quality.dpr[0])} onIncline={() => setDpr(dprBase)} flipflops={3} onFallback={() => setDpr(quality.dpr[0])} />
                <Arena floor={floor} backdrop={backdrop} big />
                {/* Ambient embers drifting through the arena — the world feels alive. */}
                <Sparkles count={quality.ambientParticles} scale={[26, 11, 14]} position={[0, 4.5, -2]} size={2.6} speed={0.16} opacity={0.28} color="#ffb46b" noise={1.6} />
                {roster.map((r) => (
                    <DuelStandee key={r.id} duel={duel} clock={clock} id={r.id} pet={r.pet} mirror={r.mirror} sharedImages={sharedImages} freeRoam3d={freeRoam3d} dashCue={dashFx.find((dash) => dash.actorId === r.id)} />
                ))}
                {Array.from({ length: 8 }).map((_, i) => (
                    <DuelProjectile key={i} index={i} duel={duel} clock={clock} quality={quality} native={freeRoam3d} />
                ))}
                {impacts.map((im) => (
                    <DuelImpact key={im.id} at={im.pos} color={im.color} big={im.big} mode={im.mode} onDone={() => setImpacts((p) => p.filter((x) => x.id !== im.id))} />
                ))}
                {elementBursts.map((burst) => (
                    <DuelElementVolume key={burst.id} at={burst.pos} kind={burst.kind} color={burst.color} big={burst.big} heading={burst.heading} phase="contact" quality={quality} heroStyle={burst.style} onDone={() => setElementBursts((p) => p.filter((x) => x.id !== burst.id))} />
                ))}
                {aftermathFx.map((fx) => (
                    <DuelElementVolume key={fx.id} at={fx.pos} kind={fx.kind} color={fx.color} big={fx.big} phase="aftermath" quality={quality} onDone={() => setAftermathFx((p) => p.filter((x) => x.id !== fx.id))} />
                ))}
                {supportFx.map((fx) => (
                    <DuelSupportEffect key={fx.id} at={fx.pos} color={fx.color} kind={fx.kind} actorId={fx.actorId} duel={duel} clock={clock} onDone={() => setSupportFx((p) => p.filter((x) => x.id !== fx.id))} />
                ))}
                {shocks.map((s) => (
                    <DuelShockwaveV2 key={s.id} at={s.pos} color={s.color} big={s.big} quality={quality} onDone={() => setShocks((p) => p.filter((x) => x.id !== s.id))} />
                ))}
                {/* Accumulating scorch marks (crit/KO) + transient foot-dust — the floor remembers the fight. */}
                {scorches.map((s) => (
                    <mesh key={s.id} position={s.pos} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-2}>
                        <planeGeometry args={[s.w, s.w]} />
                        <meshBasicMaterial map={shadowTexture()} color="#241a12" transparent opacity={0.5} depthWrite={false} toneMapped={false} />
                    </mesh>
                ))}
                {dusts.map((d) => (
                    <DustPuff key={d.id} at={d.at} onDone={() => setDusts((p) => p.filter((x) => x.id !== d.id))} />
                ))}
                {powerUps.map((power) => (
                    <DuelPowerUpAura key={power.id} at={power.pos} color={power.color} quality={quality} actorId={power.actorId} duel={duel} clock={clock} heroStyle={power.style} onDone={() => setPowerUps((p) => p.filter((x) => x.id !== power.id))} />
                ))}
                {trails.map((tr) => (
                    <DuelMeleeTrail key={tr.id} at={tr.pos} toward={tr.toward} kind={tr.kind} color={tr.color} weight={tr.weight} heroStyle={tr.style} native={freeRoam3d} onDone={() => setTrails((p) => p.filter((x) => x.id !== tr.id))} />
                ))}
                {dashFx.map((dash) => (
                    <DuelDashEffectV2 key={dash.id} cue={dash} clock={clock} quality={quality} onDone={() => setDashFx((p) => p.filter((x) => x.id !== dash.id))} />
                ))}
                {pressureFx.map((pressure) => (
                    <DuelPressureClashV2 key={pressure.id} from={pressure.from} to={pressure.to} leftColor={pressure.leftColor} rightColor={pressure.rightColor} leftKind={pressure.leftKind} rightKind={pressure.rightKind} quality={quality} onDone={() => setPressureFx((p) => p.filter((x) => x.id !== pressure.id))} />
                ))}
                {setPieces.map((piece) => (
                    <DuelSignatureSetPiece key={piece.id} kind={piece.kind} from={piece.from} to={piece.to} targetId={piece.targetId} duel={duel} clock={clock} color={piece.color} quality={quality} onDone={() => setSetPieces((p) => p.filter((x) => x.id !== piece.id))} />
                ))}
                {fxList.map((fx) => (
                    <FxAnim key={fx.id} frames={fx.frames} from={fx.pos} durationMs={fx.dur} scale={fx.scale} onDone={() => setFxList((p) => p.filter((x) => x.id !== fx.id))} />
                ))}
                {numbers.map((l) => (
                    <Html key={l.id} position={l.pos} center pointerEvents="none" zIndexRange={[20, 0]}>
                        <span className={l.crit ? "damage-number crit-text" : l.heal ? "heal-number" : "damage-number"} style={{ font: l.crit ? "900 26px Inter, system-ui, sans-serif" : "800 18px Inter, system-ui, sans-serif", display: "inline-block", animation: l.crit ? "petDuelCritPop 360ms ease-out" : undefined }}>{l.text}</span>
                    </Html>
                ))}
                <DuelDirector key={runId} duel={duel} clock={clock} advanceClock={advanceClock} onEnd={finishDuel} spawnNumber={spawnNumber} spawnImpact={spawnImpact} spawnElementBurst={spawnElementBurst} spawnAftermath={spawnAftermath} spawnFx={spawnFx} spawnSupport={spawnSupport} spawnShock={spawnShock} spawnDust={spawnDust} spawnScorch={spawnScorch} spawnPowerUp={spawnPowerUp} spawnTrail={spawnTrail} spawnDash={spawnDash} spawnPressure={spawnPressure} spawnSetPiece={spawnSetPiece} elementById={elementById} nameById={nameById} profileById={profileById} ultById={ultById} heroMoveById={heroMoveById} onCutIn={triggerCutIn} onFlash={triggerFlash} onCallout={triggerCallout} onCombo={triggerCombo} onAnnounce={triggerAnnounce} onMoveCallout={triggerMoveCallout} />
                <BloomFx />
                {perfQa && <PetRenderStatsProbe quality={quality.id} />}
            </Canvas>

            {/* VS pre-fight intro — both fighters hold their face-off while a "VS"
                splash slams in, then the clock starts. */}
            {intro && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "clamp(12px,3vw,40px)", padding: "0 5%" }}>
                        <span style={{ flex: 1, textAlign: "right", font: "800 clamp(18px,3vw,38px) var(--font-display)", color: "#93c5fd", textShadow: "0 2px 10px #000", animation: "petDuelVsName 500ms ease-out both" }}>{playerPet.name}</span>
                        <span style={{ font: "900 clamp(44px,9vw,104px) var(--font-display)", color: "#fff", letterSpacing: "0.02em", textShadow: "0 0 26px rgba(250,204,21,0.9), 0 4px 12px #000", animation: "petDuelVs 700ms cubic-bezier(.2,.9,.2,1) both" }}>VS</span>
                        <span style={{ flex: 1, textAlign: "left", font: "800 clamp(18px,3vw,38px) var(--font-display)", color: "#fca5a5", textShadow: "0 2px 10px #000", animation: "petDuelVsName 500ms ease-out 120ms both" }}>{enemyPet.name}</span>
                    </div>
                </div>
            )}

            {/* Anime signature CUT-IN — the action freeze-frames (hitStop) while a dark slam +
                diagonal speed lines sweep in, the pet's PORTRAIT slams from its side, and the
                move name lands huge. Self-contained (no external CSS) so it always shows. */}
            {cutIn && (() => {
                const isEnemy = cutIn.side === "enemy";
                const { base: elementBase, glow: elementGlow } = elementColor(cutIn.pet.element);
                const cutPoseId = posedId(cutIn.pet.id);
                const lunarHero = /kitsune|eclipse/i.test(cutIn.pet.name);
                const tidalHero = /selkie|tidal/i.test(cutIn.pet.name);
                const heroMotif = lunarHero ? "☾" : tidalHero ? "≋" : "✦";
                const heroKicker = lunarHero ? "Anime Break · Moon Veil" : tidalHero ? "Anime Break · Riptide" : "Anime Break";
                return (
                    <div className={`pet-cutin pet-duel-hero-cutin ${cutIn.side}`} key={`cutin-${cutIn.id}`} style={{ ["--hero-glow" as string]: elementGlow, boxShadow: `inset 0 0 90px ${elementBase}55` } as React.CSSProperties}>
                        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at ${isEnemy ? 72 : 28}% 55%, ${elementGlow}42, transparent 44%)`, mixBlendMode: "screen" }} />
                        <span className="pet-cutin-motif" aria-hidden="true">{heroMotif}</span>
                        <div className="pet-cutin-portrait">
                            {cutPoseId ? (
                                <img src={poseUrl(cutPoseId, "cast")} alt={cutIn.pet.name} style={{ transform: isEnemy ? "scaleX(-1)" : undefined }} />
                            ) : (
                                <PetBattleAvatar pet={cutIn.pet} side={cutIn.side} active sharedImages={sharedImages} visualState="rangedCast" />
                            )}
                        </div>
                        <div className="pet-cutin-text">
                            <span className="pet-cutin-kicker">{heroKicker}</span>
                            <span className="pet-cutin-pet">{cutIn.pet.name}</span>
                            <span className="pet-cutin-move">{cutIn.move}!</span>
                        </div>
                    </div>
                );
            })()}

            {/* Combat-juice overlays: full-screen element flash, big callout, combo. */}
            {flash && (
                <div key={`flash-${flash.id}`} style={{ position: "absolute", inset: 0, background: flash.color, opacity: 0, mixBlendMode: "screen", pointerEvents: "none", animation: "petDuelFlash 340ms ease-out forwards", ["--fp" as string]: flash.intensity } as React.CSSProperties} />
            )}
            {callout && !cutIn && (() => {
                const minor = callout.text === "MISS";
                return <div key={`callout-${callout.id}`} style={{
                    position: "absolute",
                    top: minor ? "23%" : "22%",
                    left: minor ? "50%" : 0,
                    right: minor ? undefined : 0,
                    transform: minor ? "translateX(-50%)" : undefined,
                    width: minor ? "max-content" : undefined,
                    textAlign: "center",
                    pointerEvents: "none",
                    padding: minor ? "4px 14px" : undefined,
                    borderRadius: minor ? 999 : undefined,
                    background: minor ? "rgba(8,11,22,0.72)" : undefined,
                    border: minor ? "1px solid rgba(226,232,240,0.6)" : undefined,
                    font: minor ? "900 clamp(18px,2.5vw,28px)/1 var(--font-display)" : "900 clamp(26px,4.8vw,50px)/1 var(--font-display)",
                    color: "#fff",
                    letterSpacing: "0.05em",
                    textShadow: minor ? "0 2px 8px #000" : "0 0 18px rgba(250,204,21,0.9), 0 4px 10px #000",
                    animation: minor ? "petDuelTacticalMove 740ms ease-out forwards" : "petDuelCallout 740ms cubic-bezier(.2,.9,.2,1) forwards",
                    zIndex: 13,
                }}>{callout.text}</div>;
            })()}
            {combo && combo.n >= 2 && !cutIn && !callout && (
                <div key={`combo-${combo.id}`} style={{ position: "absolute", top: "18%", right: "8%", pointerEvents: "none", textAlign: "center", font: "900 clamp(24px,4vw,44px)/1 Inter, system-ui, sans-serif", color: "#fde68a", textShadow: "0 0 14px rgba(245,158,11,0.85), 0 3px 8px #000", animation: "petDuelCombo 700ms ease-out forwards" }}>{combo.n}<span style={{ fontSize: "0.45em", letterSpacing: "0.15em", display: "block" }}>HIT COMBO</span></div>
            )}
            {/* Named-move flash — the ability's name slams in on cast/hit (signatures
                use the bigger cut-in instead), side-tinted blue (you) / red (foe). */}
            {moveCallout && !cutIn && !callout && (() => {
                const tactical = moveCallout.tone === "support" || moveCallout.tone === "maneuver";
                const sideColor = moveCallout.side === "player" ? "#60a5fa" : "#f87171";
                return <div key={`move-${moveCallout.id}`} style={{
                    position: "absolute",
                    left: "50%",
                    top: "9%",
                    transform: "translateX(-50%)",
                    maxWidth: mobileQa ? "calc(100% - 24px)" : "84%",
                    boxSizing: "border-box",
                    textAlign: "center",
                    pointerEvents: "none",
                    padding: "4px 13px",
                    borderRadius: 999,
                    border: `1px solid ${sideColor}`,
                    background: "rgba(8,11,22,0.78)",
                    boxShadow: `0 5px 18px rgba(0,0,0,0.42), 0 0 14px ${sideColor}22`,
                    color: moveCallout.side === "player" ? "#dbeafe" : "#fee2e2",
                    font: tactical ? "800 clamp(12px,1.6vw,18px)/1 var(--font-display)" : "900 clamp(13px,2vw,21px)/1 var(--font-display)",
                    letterSpacing: tactical ? "0.08em" : "0.04em",
                    textShadow: "0 2px 10px #000",
                    whiteSpace: mobileQa ? "normal" : "nowrap",
                    animation: tactical ? "petDuelTacticalMove 1000ms ease-out forwards" : "petDuelMove 1000ms cubic-bezier(.2,.9,.2,1) forwards",
                    zIndex: 12,
                }}>{moveCallout.tone === "support" ? "POWER UP · " : moveCallout.tone === "maneuver" ? "SHIFT · " : ""}{moveCallout.text}</div>;
            })()}
            {/* Play-by-play broadcast line (lower-third) — narrates the swings:
                a fighter on the ropes, a reversal, an ultimate, the finish. */}
            {announce && !ended && !cutIn && !callout && !moveCallout && (
                <div key={`ann-${announce.id}`} style={{ position: "absolute", left: "50%", bottom: "13%", transform: "translateX(-50%)", width: mobileQa ? "calc(100% - 24px)" : "max-content", maxWidth: "84%", boxSizing: "border-box", textAlign: "center", pointerEvents: "none", padding: mobileQa ? "7px 12px" : "7px 22px", borderRadius: mobileQa ? 18 : 999, background: "rgba(8,11,22,0.74)", border: `1px solid ${announce.tone === "reversal" ? "#f59e0b" : announce.tone === "ultimate" ? "#a855f7" : announce.tone === "ko" ? "#fcd34d" : "#ef4444"}`, boxShadow: "0 6px 22px rgba(0,0,0,0.55)", color: announce.tone === "reversal" ? "#fde68a" : announce.tone === "ultimate" ? "#e9d5ff" : announce.tone === "ko" ? "#fff7e6" : "#fecaca", font: mobileQa ? "800 14px/1.2 var(--font-display)" : "800 clamp(15px,2.6vw,24px)/1.1 var(--font-display)", letterSpacing: "0.02em", textShadow: "0 2px 8px #000", whiteSpace: mobileQa ? "normal" : "nowrap", animation: "petDuelAnnounce 2600ms ease-out forwards" }}>{announce.text}</div>
            )}

            {debugAi && <DuelAiDebugHud duel={duel} clock={clock} nameById={nameById} />}

            {!ended && !cutIn && <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8 }}>
                <button onClick={onExit} style={duelBtn}>✕ Exit</button>
                <button onClick={togglePause} style={duelBtn}>{paused ? "▶ Play" : "❚❚ Pause"}</button>
                <button onClick={replay} style={duelBtn}>⟲ Replay</button>
            </div>}
            {!ended && !cutIn && <div style={{ position: "absolute", top: 12, right: 12, padding: "4px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(168,85,247,0.6)", borderRadius: 999, color: "#fcd34d", font: "700 11px Inter, system-ui, sans-serif" }}>⚔️ {freeRoam3d ? "3D Coliseum" : "Pet Coliseum"}</div>}

            {ended && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,7,18,0.55)" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ font: "900 38px Inter, system-ui, sans-serif", color: resultLabel === "Victory" ? "#4ade80" : resultLabel === "Defeat" ? "#f87171" : "#facc15", textShadow: "0 2px 12px #000" }}>{resultLabel}</div>
                        <div style={{ color: "#94a3b8", font: "600 12px Inter, system-ui, sans-serif", marginTop: 4 }}>Pet Coliseum</div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                            <button onClick={replay} style={resultBtn}>⟲ Replay</button>
                            {onFightAgain && <button onClick={onFightAgain} style={resultBtn}>⚔ Fight again</button>}
                            <button onClick={onExit} style={{ ...resultBtn, background: "#334155" }}>Exit</button>
                        </div>
                    </div>
                </div>
            )}
            <div style={{ position: "absolute", bottom: 12, right: 14, color: "#64748b", font: "600 11px Inter, system-ui, sans-serif" }}>Pet Coliseum</div>
        </div>
    ), document.body);
}

// ═════════════════════════════════════════════════════════════════════════════
// PetArenaMatch — the Tactical Pet Arena game mode (docs/pet-arena-mode-plan.md):
// capture-the-scroll, 2v2/4v4: first to 5 CAPTURES wins (kills don't score — they
// remove a pet for a ~7s respawn window). Plays the deterministic match sim
// (pet-arena-sim.ts) on the same diorama stage, reusing the projection + pose
// flipbook + FX. Also the engine behind the Tactical ranked ladder.
// ═════════════════════════════════════════════════════════════════════════════
const ARENA_SPRITE_H = 1.05;
// Render-side motion smoothing factor (per frame) for the drawn sprite position —
// a light low-pass that rounds the deterministic sim's piecewise-linear corners
// and damps clump-jitter without touching the sim. Higher = snappier/less lag.
const ARENA_POS_SMOOTH = 0.4;
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
    const wasMoving = useRef(false);   // hysteresis on the move/idle gate → a pet hovering near the threshold can't flicker idle↔run pose (which amplified any residual jitter)
    const scaleSm = useRef(0);   // smoothed depth-scale → absorbs any residual position jitter so the sprite never pulses big↔small (snaps on a teleport)
    const smX = useRef<number | null>(null), smY = useRef<number | null>(null);   // smoothed DRAW position (render-side low-pass; snaps on a teleport)
    const prevDown = useRef(false);   // was the pet hidden (respawning/dead) last frame → snap, never lerp, across the off-screen respawn jump (robust at any framerate)
    const reviveRef = useRef<HTMLDivElement>(null);     // "↻ Ns" respawn countdown shown while down
    const abilityPipRef = useRef<HTMLSpanElement>(null); // role-ability-ready glow dot
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
        // Zero "speed" while hidden AND on the first frame back — a respawn teleports the
        // body across the board, so the reappear must never read as a dash (trail / run pose).
        const justBack = prevDown.current && !down;
        const spd = (down || justBack) ? 0 : Math.sqrt(dx * dx + dy * dy); lastPos.current = [p.wx, p.wy];
        // Hysteresis: a higher turn-on than turn-off speed, so a pet sitting at the
        // edge of "moving" stays committed to idle OR run instead of toggling every
        // frame (the toggle made run/idle poses strobe and amplified any tiny jitter).
        const moving = !down && (wasMoving.current ? spd > 0.006 : spd > 0.016);
        wasMoving.current = moving;
        // Smooth the depth-scale: snap on a teleport (which already hard-cuts position)
        // or across a respawn, else ease toward the target so a jittery tick can't pop size.
        scaleSm.current = (teleport || down || prevDown.current || scaleSm.current === 0) ? p.depth : lerp(scaleSm.current, p.depth, 0.25);
        // Render-side motion smoothing: ease the DRAWN position toward the interpolated
        // sim position so the sim's piecewise-linear heading changes (separation nudges,
        // path replans) round off and clump-jitter is damped — never touches the sim.
        // Snap (don't lerp) on a teleport AND while hidden / on the first frame back, so the
        // across-the-board respawn jump never slides the body in — robust at any framerate.
        if (smX.current === null || smY.current === null || teleport || down || prevDown.current) { smX.current = p.wx; smY.current = p.wy; }
        else { smX.current += (p.wx - smX.current) * ARENA_POS_SMOOTH; smY.current += (p.wy - smY.current) * ARENA_POS_SMOOTH; }
        const drawX = smX.current, drawY = smY.current;
        prevDown.current = down;
        // Dash trail: a single element-flat ghost that fades in ONLY at genuine dash speed
        // (an assassin dive streaks; an ordinary stroll doesn't). Gate raised so routine
        // movement no longer leaves a constant smear of afterimages.
        fast.current = down ? 0 : Math.max(0, Math.min(1, (spd - 0.07) / 0.13));
        const bob = moving ? Math.abs(Math.sin(state.clock.elapsedTime * 13 + bobPhase)) * 0.16 : 0;
        g.position.set(drawX, drawY + bob * p.depth, p.zo);
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
        // Readouts (sim emits these for display only): a respawn countdown so a downed
        // pet reads "back in Ns" instead of just vanishing, + an ability-ready glow dot.
        const respawning = a0.state === "respawning";
        if (nameWrap.current) nameWrap.current.style.opacity = respawning ? "0.92" : a0.state === "dead" ? "0.3" : "1";
        if (reviveRef.current) { reviveRef.current.style.display = respawning ? "block" : "none"; if (respawning) reviveRef.current.textContent = `↻ ${a0.respawnSecs}s`; }
        if (abilityPipRef.current) abilityPipRef.current.style.opacity = (!down && a0.abilityReady) ? "1" : "0";
        if (glowMat.current) glowMat.current.opacity = a0.carrying ? 0.55 + Math.abs(Math.sin(state.clock.elapsedTime * 5)) * 0.35 : 0;
        if (carryMark.current) carryMark.current.style.display = a0.carrying ? "inline" : "none";
        if (shadow.current && shadowMat.current) {
            shadow.current.position.set(drawX, drawY - 0.08 * p.depth, p.zo - 0.1);
            shadow.current.scale.set(shadowW * scaleSm.current, shadowW * 0.32 * scaleSm.current, 1);
            shadowMat.current.opacity = down ? 0 : 0.4;
        }
        if (aura.current && auraMat.current) {   // team-colored ground glow (brighter while carrying)
            aura.current.position.set(drawX, drawY - 0.05 * p.depth, p.zo - 0.12);
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
                            <span ref={abilityPipRef} title="ability charged" style={{ width: 5, height: 5, borderRadius: 5, background: ROLE_COLOR[role], boxShadow: `0 0 5px ${ROLE_COLOR[role]}`, opacity: 0 }} />
                            <span style={{ color: "#fff", textShadow: "0 1px 2px #000" }}>{pet.name}</span>
                        </div>
                        <div style={{ width: 56, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ width: "100%", height: "100%", background: team === "blue" ? "#4ade80" : "#f87171" }} />
                        </div>
                        <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 2 }}>
                            {[0, 1, 2].map((i) => (<span key={i} style={{ width: 5, height: 5, borderRadius: 5, background: i < lives ? (team === "blue" ? "#60a5fa" : "#fca5a5") : "#334155" }} />))}
                        </div>
                        <div ref={reviveRef} style={{ display: "none", marginTop: 2, color: "#fde047", font: "800 10px Inter, system-ui, sans-serif", textShadow: "0 1px 3px #000" }} />
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
    const capRef = useRef<HTMLDivElement>(null);   // "Capturing…" label while a pet channels the pickup
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
        if (capRef.current) capRef.current.style.opacity = sc.channelFrac > 0 ? "1" : "0";   // "hold to capture" cue
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
                        <div ref={capRef} style={{ position: "absolute", top: 44, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", font: "800 9px Inter, system-ui, sans-serif", color: "#fde047", textShadow: "0 1px 3px #000", opacity: 0, pointerEvents: "none" }}>Capturing…</div>
                    </div>
                </Html>
            </group>
        </group>
    );
}

/** The rotating buff SHRINE — a grounded glowing relic (Chakra Font = orange power,
 *  Mending Spring = green heal) with a type-tinted ground glow, a claim ring that fills
 *  while a pet channels it, a floating label, and a pop-in on (re)spawn. Reads
 *  snap.shrine, never the sim. */
function ArenaShrine({ result, clock }: { result: ArenaResult; clock: { current: DuelClock } }) {
    const grp = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const glow = useRef<THREE.Mesh>(null);
    const glowMat = useRef<THREE.MeshBasicMaterial>(null);
    const ringRef = useRef<HTMLDivElement>(null);
    const labelRef = useRef<HTMLDivElement>(null);
    const [kind, setKind] = useState<ShrineKind>("power");
    const [visible, setVisible] = useState(false);
    const spawnAt = useRef<number | null>(null);
    const prevActive = useRef(false);
    const H = ARENA_SPRITE_H * 1.45;
    useFrame((state) => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const sh = snaps[i].shrine;
        const vis = sh.state === "active";
        if (vis !== visible) setVisible(vis);
        if (sh.kind !== kind) setKind(sh.kind);
        const now = state.clock.elapsedTime;
        if (vis && !prevActive.current) spawnAt.current = now;     // pop-in each time it (re)appears
        prevActive.current = vis;
        if (!vis || !grp.current) return;
        const sp = spawnAt.current !== null ? Math.min(1, (now - spawnAt.current) / 0.4) : 1;
        const p = arenaPlace(sh.x, sh.y);
        const bob = Math.abs(Math.sin(now * 2)) * 0.08 * p.depth;
        grp.current.position.set(p.wx, p.wy + H * 0.5 * p.depth + bob, p.zo + 0.02);
        grp.current.scale.setScalar(p.depth * (0.55 + 0.45 * sp));   // grow in
        const color = RELIC_COLOR[sh.kind] ?? "#fb923c";
        if (mat.current) mat.current.opacity = sp;
        if (glow.current && glowMat.current) {
            const pulse = 0.5 + Math.abs(Math.sin(now * 2.6)) * 0.5;
            const fr = arenaPlace(sh.x + 1.0, sh.y); const worldR = Math.max(0.7, Math.abs(fr.wx - p.wx));
            glow.current.position.set(p.wx, p.wy - 0.04 * p.depth, p.zo - 0.1);
            const gw = worldR * (2.0 + pulse * 0.6) * p.depth; glow.current.scale.set(gw, gw * 0.5, 1);
            glowMat.current.color.set(color);
            glowMat.current.opacity = sp * (0.28 + pulse * 0.22 + sh.channelFrac * 0.45);   // brighter while being claimed
        }
        if (ringRef.current) { ringRef.current.style.opacity = sh.channelFrac > 0 ? "1" : "0"; ringRef.current.style.background = `conic-gradient(${color} ${sh.channelFrac * 360}deg, rgba(0,0,0,0.35) 0deg)`; }
        if (labelRef.current) labelRef.current.style.color = color;
    });
    if (!visible) return null;
    const color = RELIC_COLOR[kind] ?? "#fb923c";
    return (
        <group>
            <mesh ref={glow} renderOrder={-1}><planeGeometry args={[1, 1]} /><meshBasicMaterial ref={glowMat} map={glowTexture()} color={color} transparent opacity={0.4} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
            <group ref={grp}>
                <mesh><planeGeometry args={[H, H]} /><meshBasicMaterial ref={mat} map={shrineTexture(kind)} transparent alphaTest={0.02} depthWrite={false} toneMapped={false} /></mesh>
                <Html center position={[0, H * 0.6, 0]} pointerEvents="none" zIndexRange={[29, 0]}>
                    <div style={{ position: "relative", width: 56, height: 44, display: "grid", placeItems: "center" }}>
                        <div ref={ringRef} style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 26, height: 26, borderRadius: "50%", opacity: 0 }} />
                        <div ref={labelRef} style={{ position: "absolute", bottom: 0, whiteSpace: "nowrap", font: "800 9px Inter, system-ui, sans-serif", color, textShadow: "0 1px 3px #000" }}>{`${RELIC_ICON[kind] ?? "◆"} ${RELIC_LABEL[kind] ?? "Relic"}`}</div>
                    </div>
                </Html>
            </group>
        </group>
    );
}

/** V2 closing ring — a pulsing purple boundary on the ground that shrinks toward centre
 *  from ~2:30. Driven entirely by snapshot.ringR (0 when inactive), so a spectator SEES why
 *  pets stampede inward and why anyone caught outside is taking damage. Purely additive (no
 *  sim coupling); inert unless the match is v2 and the ring has engaged. */
function ArenaRing({ result, clock }: { result: ArenaResult; clock: { current: DuelClock } }) {
    const grp = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    useFrame((state) => {
        if (!grp.current) return;
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const rr = result.v2 ? snaps[i].ringR : 0;
        if (rr <= 0) { grp.current.visible = false; return; }
        grp.current.visible = true;
        const c = arenaPlace(result.center[0], result.center[1]);
        const edge = arenaPlace(result.center[0] + rr, result.center[1]);
        const worldR = Math.max(0.5, Math.abs(edge.wx - c.wx));
        grp.current.position.set(c.wx, c.wy, c.zo - 0.05);
        grp.current.scale.set(worldR, worldR * 0.5, 1);   // squash to sit on the top-down ground plane
        if (mat.current) mat.current.opacity = 0.22 + Math.abs(Math.sin(state.clock.elapsedTime * 3)) * 0.18;
    });
    return (
        <group ref={grp} visible={false}>
            <mesh renderOrder={-2}><ringGeometry args={[0.93, 1, 72]} /><meshBasicMaterial ref={mat} color="#a78bfa" transparent opacity={0.3} depthWrite={false} depthTest={false} toneMapped={false} side={THREE.DoubleSide} /></mesh>
        </group>
    );
}

/** The neutral boss (Arena Warden, B4). A big grounded billboard at the centre pit, now
 *  ALIVE: it faces its quarry, lumbers with a walk-bob, REARS UP (with a hot ground
 *  warning ring) before each telegraphed slam and SQUASHES on impact, rises from the
 *  earth on spawn, and topples on death. Drives all of this off snap.boss
 *  (faceX / winding / state) + the bossslam timing — never the sim. */
function ArenaBoss({ result, clock }: { result: ArenaResult; clock: { current: DuelClock } }) {
    const grp = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const auraMat = useRef<THREE.MeshBasicMaterial>(null);
    const shadow = useRef<THREE.Mesh>(null);
    const warn = useRef<THREE.Group>(null);
    const warnMat = useRef<THREE.MeshBasicMaterial>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const wrap = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    // animation state (refs so it survives frames without re-rendering)
    const prevState = useRef<string>("inactive");
    const prevWinding = useRef(false);
    const spawnAt = useRef<number | null>(null);
    const deadAt = useRef<number | null>(null);
    const windStart = useRef<number | null>(null);
    const slamAt = useRef<number | null>(null);
    // Flipbook state: the strike ticks (swipe + slam) drive the "slam" attack frame, and a
    // position delta picks walk vs idle. curFrame avoids redundant texture swaps.
    const attackTicks = useMemo(() => result.events.filter((e) => e.type === "bossswipe" || e.type === "bossslam").map((e) => e.t).sort((a, b) => a - b), [result]);
    const prevPos = useRef<{ x: number; y: number } | null>(null);
    const curFrame = useRef<WardenFrame>("idle");
    // The sprite is a near-square cutout; show it big and grounded so it reads as a boss.
    const H = ARENA_SPRITE_H * 2.6;
    useFrame((state) => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const b = snaps[i].boss;
        const vis = b.state !== "inactive";
        if (vis !== visible) setVisible(vis);
        const now = state.clock.elapsedTime;
        // ── state-transition stamps (spawn rise / death topple / slam) ──
        if (b.state !== prevState.current) {
            if (b.state === "active" && prevState.current === "inactive") spawnAt.current = now;
            if (b.state === "dead") deadAt.current = now;
            prevState.current = b.state;
        }
        if (b.winding && !prevWinding.current) windStart.current = now;     // wind-up began
        if (!b.winding && prevWinding.current) slamAt.current = now;        // wind-up ended → the stomp landed
        prevWinding.current = b.winding;
        if (!vis || !grp.current) return;

        const p = arenaPlace(b.x, b.y);
        const sp = spawnAt.current !== null ? Math.min(1, (now - spawnAt.current) / 0.6) : 1;          // 0→1 spawn rise
        const dp = deadAt.current !== null ? Math.min(1, (now - deadAt.current) / 0.8) : 0;            // 0→1 death topple
        const wp = b.winding && windStart.current !== null ? Math.min(1, (now - windStart.current) / 0.45) : 0;  // rear-up progress
        const sq = slamAt.current !== null ? Math.max(0, 1 - (now - slamAt.current) / 0.34) : 0;        // 1→0 slam squash decay

        grp.current.position.set(p.wx, p.wy + H * 0.5 * p.depth, p.zo + 0.02);
        grp.current.scale.setScalar(p.depth);

        if (body.current) {
            const breathe = b.state === "active" && !b.winding ? Math.abs(Math.sin(now * 1.5)) * 0.04 : 0;
            const rear = wp * 0.14;                                  // grows taller as it winds up
            const sx = (1 + sq * 0.26);                              // splat wider on impact
            const sy = (1 + breathe + rear - sq * 0.30) * (0.55 + 0.45 * sp);   // squash on impact, grow in on spawn
            const face = b.faceX < 0 ? -1 : 1;
            body.current.scale.set(face * sx * (0.6 + 0.4 * sp), sy, 1);
            // rear up then stomp DOWN; topple sideways on death; gentle walk sway otherwise.
            const sway = b.state === "active" && !b.winding ? Math.sin(now * 6) * 0.03 : 0;
            body.current.rotation.z = -dp * 1.15 * face + sway * (1 - wp);
            const lift = (1 - sp) * -H * 0.45 + rear * H * 0.18 - sq * H * 0.06 - dp * H * 0.12;   // rise from ground / rear / dip / sink
            body.current.position.y = lift;
        }
        // ── Flipbook: pick the animation frame by state (idle / walk / wind-up / slam) ──
        const tNow = clock.current.t;
        let striking = false;
        for (let k = attackTicks.length - 1; k >= 0; k--) { const at = attackTicks[k]; if (at > tNow) continue; if (tNow - at <= 7) { striking = true; } break; }   // a swipe/slam within ~0.23 s → strike pose
        const moved = prevPos.current ? (Math.abs(b.x - prevPos.current.x) + Math.abs(b.y - prevPos.current.y)) > 0.02 : false;
        prevPos.current = { x: b.x, y: b.y };
        const want: WardenFrame = b.state === "dead" ? "idle" : b.winding ? "windup" : striking ? "slam" : moved ? "walk" : "idle";
        if (mat.current && want !== curFrame.current) { mat.current.map = wardenFrame(want); mat.current.needsUpdate = true; curFrame.current = want; }
        if (mat.current) {
            mat.current.opacity = b.state === "dead" ? Math.max(0, 1 - dp) : sp;
            // flash hot while rearing back, ember-warm normally, ashen on death.
            const r = 1, gC = b.state === "dead" ? 0.42 : 1 - wp * 0.45, bC = b.state === "dead" ? 0.42 : 1 - wp * 0.55;
            mat.current.color.setRGB(r, gC, bC);
        }
        // Aura glow behind the Warden — green menace, flaring orange + bright as it winds up.
        if (auraMat.current) {
            const pulse = 0.5 + Math.abs(Math.sin(now * 2.2)) * 0.5;
            const base = b.state === "dead" ? Math.max(0, 1 - dp) : sp;
            auraMat.current.opacity = base * (0.18 + pulse * 0.12 + wp * 0.5);
            auraMat.current.color.set(wp > 0.05 ? "#fb7a32" : "#34d399");
        }
        // Ground footprint sized to the boss's sim collision radius, parked at its feet.
        const fr = arenaPlace(b.x + BOSS_RADIUS, b.y); const worldR = Math.max(0.8, Math.abs(fr.wx - p.wx));
        if (shadow.current) { shadow.current.position.set(p.wx, p.wy - 0.05 * p.depth, p.zo - 0.1); shadow.current.scale.set(worldR * 2.4 * p.depth, worldR * 0.9 * p.depth, 1); }
        // Hot warning ring on the ground = the slam's AoE footprint, filling in as it winds up
        // so players can read (and the AI's victims sit in) the danger zone before it lands.
        if (warn.current && warnMat.current) {
            const show = wp > 0 || sq > 0;
            warn.current.visible = show;
            if (show) {
                // honest footprint: the actual slam reach (BOSS_ATK_RADIUS + BOSS_RADIUS) in world units
                const aoeR = arenaPlace(b.x + (BOSS_ATK_RADIUS + BOSS_RADIUS), b.y);
                const aoe = Math.max(1, Math.abs(aoeR.wx - p.wx)) * 2;
                const s = (wp > 0 ? 0.5 + 0.5 * wp : 1) + sq * 0.4;        // grow during wind-up, kick out on impact
                warn.current.position.set(p.wx, p.wy - 0.04 * p.depth, p.zo - 0.08);
                warn.current.scale.set(aoe * s * p.depth, aoe * 0.5 * s * p.depth, 1);
                warnMat.current.color.set(sq > 0 ? "#fff1c2" : "#f97316");
                warnMat.current.opacity = (wp > 0 ? 0.25 + 0.5 * wp : 0.6 * sq);
            }
        }
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, b.hpFrac * 100))}%`;
        if (wrap.current) wrap.current.style.opacity = b.state === "active" ? "1" : "0";
    });
    if (!visible) return null;
    return (
        <group>
            <mesh ref={shadow} position={[0, 0, 0]} renderOrder={-2}><planeGeometry args={[1, 1]} /><meshBasicMaterial map={shadowTexture()} transparent opacity={0.45} depthWrite={false} depthTest={false} toneMapped={false} /></mesh>
            {/* slam-AoE warning ring (only visible while winding / on impact) */}
            <group ref={warn} renderOrder={-1}>
                <mesh><planeGeometry args={[1, 1]} /><meshBasicMaterial ref={warnMat} map={glowTexture()} color="#f97316" transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
            </group>
            <group ref={grp}>
                <group ref={body}>
                    {/* aura behind the sprite */}
                    <mesh position={[0, 0, -0.05]}><planeGeometry args={[H * 1.5, H * 1.5]} /><meshBasicMaterial ref={auraMat} map={glowTexture()} color="#34d399" transparent opacity={0.2} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
                    <mesh><planeGeometry args={[H, H]} /><meshBasicMaterial ref={mat} map={wardenFrame("idle")} transparent alphaTest={0.02} depthWrite={false} toneMapped={false} /></mesh>
                </group>
                {/* drifting embers around the Warden while it's up */}
                <Sparkles count={18} scale={[H * 0.8, H * 0.9, 1.5]} position={[0, 0, 0.1]} size={3} speed={0.3} opacity={0.5} color="#7df0c0" noise={1.5} />
                <Html center position={[0, H * 0.62, 0]} pointerEvents="none" zIndexRange={[34, 0]}>
                    <div ref={wrap} style={{ width: 132, textAlign: "center", transition: "opacity 0.3s" }}>
                        <div style={{ font: "800 11px Inter, system-ui, sans-serif", color: "#d6f5e6", textShadow: "0 1px 3px #000", marginBottom: 2, letterSpacing: 0.5 }}>⛰ ARENA WARDEN</div>
                        <div style={{ height: 8, borderRadius: 4, background: "rgba(8,12,12,0.8)", border: "1px solid #14532d", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ height: "100%", width: "100%", background: "linear-gradient(90deg,#34d399,#10b981)" }} />
                        </div>
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
                    const matchPoint = (e.team === "blue" ? snapAt.scoreBlue : snapAt.scoreRed) >= result.winScore;
                    pushFeed(`📜 ${e.team === "blue" ? "Blue" : "Red"} captured the scroll!`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    pushBanner(matchPoint ? `${e.team === "blue" ? "BLUE" : "RED"} WINS! 📜` : `${e.team === "blue" ? "BLUE" : "RED"} SCORES! 📜`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.5)" : "rgba(239,68,68,0.5)");
                    triggerHitstop(90); triggerSlowmo(matchPoint ? 460 : 280, 0.38); triggerShake(1.4);
                } else if (e.type === "pickup" && e.actorId) {
                    pushFeed(`📜 ${nameOf(e.actorId)} took the scroll`, e.team === "blue" ? "#93c5fd" : "#fca5a5");
                } else if (e.type === "shrinespawn") {
                    const sh = snapAt.shrine; const isHeal = sh.kind === "mend" || sh.kind === "favor"; const c = isHeal ? "#34d399" : "#fb923c";
                    spawnFx({ x: sh.x, z: sh.y, key: RELIC_FX[sh.kind] ?? "spark", scale: 2.2, dur: 540 });
                    pushFeed(`${RELIC_ICON[sh.kind] ?? "◆"} A ${RELIC_LABEL[sh.kind] ?? "relic"} rises`, c);
                } else if (e.type === "shrineclaim" && e.team) {
                    // A claimed shrine/relic — a team-colored burst + the flavour's FX. Tactical, not a
                    // score, so a lighter touch than a capture (no banner/slow-mo).
                    const sh = snapAt.shrine; const c = e.team === "blue" ? "#60a5fa" : "#f87171"; const k = e.kind ?? sh.kind;
                    spawnFx({ x: sh.x, z: sh.y, key: "power", scale: 3.0, dur: 600 });
                    spawnFx({ x: sh.x, z: sh.y, key: RELIC_FX[k] ?? "spark", scale: 2.4, dur: 460 });
                    pushFeed(`${RELIC_ICON[k] ?? "◆"} ${e.team === "blue" ? "Blue" : "Red"} claimed the ${RELIC_LABEL[k] ?? "relic"}`, c);
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.26)" : "rgba(239,68,68,0.26)");
                    triggerShake(0.55);
                } else if (e.type === "bossspawn") {
                    const b = snapAt.boss; spawnFx({ x: b.x, z: b.y, key: "power", scale: 4.6, dur: 820 });
                    pushFeed("⛰ The Arena Warden awakens!", "#34d399");
                    pushBanner("⛰ THE WARDEN AWAKENS", "#34d399");
                    triggerHitstop(90); triggerShake(1.6);
                } else if (e.type === "bossswipe") {
                    // The Warden's fast melee swipe — a quick claw-spark + a small jolt. (Damage
                    // floaters on the struck pet carry the rest; per-swipe so no feed spam.)
                    const b = snapAt.boss; spawnFx({ x: b.x, z: b.y, key: "spark", scale: 1.8, dur: 280 });
                    triggerShake(0.4);
                } else if (e.type === "bosslunge") {
                    // The Warden LEAPS to close on a kiter — a launch puff + a quick jolt.
                    const b = snapAt.boss; spawnFx({ x: b.x, z: b.y, key: "power", scale: 2.0, dur: 320 });
                    triggerShake(0.5);
                } else if (e.type === "bosswindup") {
                    // The Warden REARS UP for its slam — a dark anticipatory sigil under it + a
                    // low rumble. ArenaBoss draws the hot AoE warning ring; this adds the weight.
                    const b = snapAt.boss; spawnFx({ x: b.x, z: b.y, key: "shadow", scale: 2.6, dur: 440 });
                    triggerShake(0.35);
                } else if (e.type === "bossslam") {
                    // The Warden stomps the pit — a grounded shockwave + real weight. (No feed
                    // spam: slams fire on a ~1.5 s cadence; the per-pet damage floaters carry it.)
                    const b = snapAt.boss;
                    spawnFx({ x: b.x, z: b.y, key: "power", scale: 3.6, dur: 520 });
                    spawnFx({ x: b.x, z: b.y, key: "spark", scale: 2.2, dur: 300 }); spawnDecal(b.x, b.y);
                    triggerHitstop(70); triggerSlowmo(150, 0.5); triggerShake(1.4);
                } else if (e.type === "bosskill" && e.team) {
                    const b = snapAt.boss; spawnFx({ x: b.x, z: b.y, key: "power", scale: 5.2, dur: 900 }); spawnFx({ x: b.x, z: b.y, key: "spark", scale: 3.0, dur: 460 });
                    pushFeed(`⛰ ${e.team === "blue" ? "Blue" : "Red"} slew the Warden! (+buff)`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    pushBanner(`${e.team === "blue" ? "BLUE" : "RED"} SLAYS THE WARDEN!`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.5)" : "rgba(239,68,68,0.5)");
                    triggerHitstop(110); triggerSlowmo(420, 0.4); triggerShake(1.8);
                } else if (e.type === "overdrive") {
                    pushBanner(`${e.team === "blue" ? "BLUE" : "RED"} OVERDRIVE! ⚡`, e.team === "blue" ? "#93c5fd" : "#fca5a5");
                    pushFeed(`⚡ ${e.team === "blue" ? "Blue" : "Red"} hit Overdrive`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.32)" : "rgba(239,68,68,0.32)"); triggerShake(0.8);
                } else if (e.type === "rampage") {
                    pushBanner(`${e.team === "blue" ? "BLUE" : "RED"} RAMPAGE! 🔥`, e.team === "blue" ? "#93c5fd" : "#fca5a5");
                } else if (e.type === "bossenrage") {
                    pushFeed(`⛰ The Warden enrages (tier ${e.stage})`, "#fb923c"); triggerShake(0.8);
                    if (e.stage >= 2) pushBanner("⛰ WARDEN ENRAGED", "#fb923c");
                } else if (e.type === "ringclose") {
                    pushFeed("◈ The arena is closing in!", "#a78bfa"); pushBanner("◈ CLOSING RING", "#a78bfa"); triggerShake(0.9);
                } else if (e.type === "executewindow") {
                    const a = findArenaActor(snapAt, e.targetId); if (a) spawnFx({ x: a.x, z: a.y, key: "spark", scale: 1.6, dur: 260 });   // "he's going down" flare on the focused target
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
    /** Fired once when the match concludes (the deterministic result is sealed from
     *  the seed). The Tactical Arena uses this to pay the vs-AI win reward. */
    onResult?: (result: ArenaResult) => void;
    /** Force the V2 ruleset on/off, overriding the per-device flag. Set for SHARED replays
     *  (co-op / PvP challenge) so BOTH clients agree regardless of the local kill-switch;
     *  omit for solo/vs-AI so the local flag (default ON) still applies. */
    v2?: boolean;
};
/** Objective line below the scoreboard — a per-frame readout written via DOM refs
 *  (so it never re-renders the HUD): the scroll-spawn countdown while the scroll is
 *  inactive, and the carrier's "returning home" progress while it's carried. Pure
 *  presentation — reads the snapshot + result.bases/center, never the sim. */
function ArenaObjectiveHud({ result, clock, textRef, barWrapRef, barRef }: {
    result: ArenaResult; clock: { current: DuelClock };
    textRef: React.RefObject<HTMLSpanElement | null>;
    barWrapRef: React.RefObject<HTMLDivElement | null>;
    barRef: React.RefObject<HTMLDivElement | null>;
}) {
    const lastText = useRef("");
    // Per-team base centroid + the carry-journey reference length (center→base), both
    // constant (bases + center are fixed), so the return meter reads a stable fraction.
    const home = useMemo(() => {
        const [cx, cy] = result.center;
        // Per-seal carry reference: the (constant) center→seal distance. Progress is
        // measured against the NEAREST seal (mirrors the sim's nearestSeal scoring), so
        // the bar fills to 100% exactly as the carrier enters BASE_SCORE_RANGE of a seal.
        const make = (seals: [number, number][]) => seals.map((s) => ({ s, ref: Math.hypot(s[0] - cx, s[1] - cy) || 1 }));
        return { blue: make(result.bases.blue), red: make(result.bases.red) };
    }, [result]);
    useFrame(() => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const sc = snaps[i].scroll;
        let text = "📜 Capture the scroll to score — defeating pets only buys time";
        let showBar = false, frac = 0, color = "#94a3b8";
        if (sc.state === "inactive" && sc.spawnSecs > 0) {
            text = `📜 Scroll in ${sc.spawnSecs}s`;
        } else if (sc.state === "carried" && sc.carrierId) {
            const carrier = snaps[i].actors.find((a) => a.id === sc.carrierId);
            if (carrier) {
                // Progress toward the closest-to-done seal: 0 at the center pickup, 1 the
                // instant the carrier reaches scoring range (BASE_SCORE_RANGE) of a seal.
                let best = 0;
                for (const { s, ref } of home[carrier.team]) {
                    const f = (ref - Math.hypot(carrier.x - s[0], carrier.y - s[1])) / Math.max(0.001, ref - BASE_SCORE_RANGE);
                    if (f > best) best = f;
                }
                frac = Math.max(0, Math.min(1, best));
                color = carrier.team === "blue" ? "#60a5fa" : "#f87171";
                text = `${carrier.team === "blue" ? "BLUE" : "RED"} returning the scroll`;
                showBar = true;
            }
        }
        if (textRef.current) {
            if (lastText.current !== text) { textRef.current.textContent = text; lastText.current = text; }
            textRef.current.style.color = showBar ? color : "#94a3b8";
        }
        if (barWrapRef.current) barWrapRef.current.style.display = showBar ? "block" : "none";
        if (barRef.current && showBar) { barRef.current.style.width = `${Math.round(frac * 100)}%`; barRef.current.style.background = color; }
    });
    return null;
}

const MODIFIER_LABEL: Record<string, string> = { standard: "Standard Bout", "warden-fury": "Warden's Fury", "scroll-frenzy": "Scroll Frenzy", "blood-ritual": "Blood Ritual" };
const RELIC_LABEL: Record<string, string> = { power: "Chakra Font", mend: "Mending Spring", berserk: "Berserker's Brand", bulwark: "Bulwark Ward", edge: "Executioner's Edge", favor: "Warden's Favor" };
const RELIC_ICON: Record<string, string> = { power: "⚡", mend: "✚", berserk: "🗡", bulwark: "🛡", edge: "☠", favor: "⛰" };
const RELIC_FX: Record<string, string> = { power: "spark", mend: "heal", berserk: "spark", bulwark: "eshield", edge: "shadow", favor: "power" };
const RELIC_COLOR: Record<string, string> = { power: "#fb923c", mend: "#34d399", berserk: "#f87171", bulwark: "#60a5fa", edge: "#a78bfa", favor: "#fbbf24" };

/** V2 (petArenaV2.v1) HUD updater: ref-drives the Overdrive meters + spike glow each frame
 *  from the snapshot stream (no React re-render). Inert unless the match is v2. */
function ArenaV2Hud({ result, clock, momBlueRef, momRedRef, odBlueRef, odRedRef }: {
    result: ArenaResult; clock: { current: DuelClock };
    momBlueRef: React.MutableRefObject<HTMLDivElement | null>; momRedRef: React.MutableRefObject<HTMLDivElement | null>;
    odBlueRef: React.MutableRefObject<HTMLSpanElement | null>; odRedRef: React.MutableRefObject<HTMLSpanElement | null>;
}) {
    useFrame(() => {
        if (!result.v2) return;
        const snaps = result.snapshots; const cur = Math.min(snaps.length - 1, Math.max(0, Math.floor(clock.current.t)));
        const s = snaps[cur]; if (!s) return;
        if (momBlueRef.current) { momBlueRef.current.style.width = s.momBlue + "%"; momBlueRef.current.style.filter = s.odBlue > 0 ? "brightness(1.6) drop-shadow(0 0 4px #fde047)" : "none"; }
        if (momRedRef.current) { momRedRef.current.style.width = s.momRed + "%"; momRedRef.current.style.filter = s.odRed > 0 ? "brightness(1.6) drop-shadow(0 0 4px #fde047)" : "none"; }
        if (odBlueRef.current) odBlueRef.current.style.opacity = s.odBlue > 0 ? "1" : "0";
        if (odRedRef.current) odRedRef.current.style.opacity = s.odRed > 0 ? "1" : "0";
    });
    return null;
}

export function PetArenaMatch({ blue, red, seed, applyItems = false, sharedImages = {}, onExit, onResult, v2 }: PetArenaMatchProps) {
    const arenaV2 = useMemo(() => v2 ?? petArenaV2Enabled(), [v2]);   // explicit prop (shared replays) overrides the per-device flag; else read the local flag (default ON)
    const result = useMemo(() => runPetArenaMatch(blue, red, seed, applyItems, arenaV2), [blue, red, seed, applyItems, arenaV2]);
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
    const objTextRef = useRef<HTMLSpanElement | null>(null);   // objective line: scroll-spawn countdown / carrier return progress (ref-driven, no re-render)
    const objBarWrapRef = useRef<HTMLDivElement | null>(null);
    const objBarRef = useRef<HTMLDivElement | null>(null);
    const momBlueRef = useRef<HTMLDivElement | null>(null);   // V2 Overdrive meters — ref-driven per-frame (no HUD re-render)
    const momRedRef = useRef<HTMLDivElement | null>(null);
    const odBlueRef = useRef<HTMLSpanElement | null>(null);
    const odRedRef = useRef<HTMLSpanElement | null>(null);
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
    // Pay out / report once the match actually concludes (result is sealed from the
    // seed, so this is just the natural moment to surface it). Replaying re-fires with
    // the same seed → the server dedups by reportKey, so no double-claim.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on the ended edge; result is seed-stable and onResult is an inline arrow (adding it would re-fire every render)
    useEffect(() => { if (ended) onResult?.(result); }, [ended]);
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
                    <ArenaBoss result={result} clock={clock} />
                    <ArenaShrine result={result} clock={clock} />
                    <ArenaScroll result={result} clock={clock} />
                    <ArenaRing result={result} clock={clock} />
                    <ArenaObjectiveHud result={result} clock={clock} textRef={objTextRef} barWrapRef={objBarWrapRef} barRef={objBarRef} />
                    <ArenaV2Hud result={result} clock={clock} momBlueRef={momBlueRef} momRedRef={momRedRef} odBlueRef={odBlueRef} odRedRef={odRedRef} />
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
            <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 18px", background: "rgba(8,12,24,0.82)", border: "1px solid rgba(148,163,184,0.4)", borderRadius: arenaV2 ? 14 : 999, font: "800 20px Inter, system-ui, sans-serif" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{ color: "#60a5fa" }}>BLUE {score[0]}</span>
                    <span style={{ color: "#64748b", fontSize: 12, fontWeight: 600 }}>📜 first to {result.winScore}</span>
                    <span style={{ color: "#f87171" }}>{score[1]} RED</span>
                </div>
                {/* V2 Overdrive meters — combat charges them; a full bar fires a spike (captures stay the only score). Both grow toward the centre label. */}
                {arenaV2 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, width: 240 }}>
                        <span ref={odBlueRef} style={{ opacity: 0, color: "#fde047", font: "900 10px Inter, system-ui, sans-serif", transition: "opacity .15s", width: 12, textAlign: "center" }}>⚡</span>
                        <div style={{ flex: 1, height: 6, background: "#0b1020", border: "1px solid #000", borderRadius: 4, overflow: "hidden", transform: "scaleX(-1)" }}><div ref={momBlueRef} style={{ width: "0%", height: "100%", background: "linear-gradient(90deg,#1d4ed8,#60a5fa)", transition: "width .12s linear" }} /></div>
                        <span style={{ color: "#64748b", font: "800 8px Inter, system-ui, sans-serif", letterSpacing: 0.5 }}>OVERDRIVE</span>
                        <div style={{ flex: 1, height: 6, background: "#0b1020", border: "1px solid #000", borderRadius: 4, overflow: "hidden" }}><div ref={momRedRef} style={{ width: "0%", height: "100%", background: "linear-gradient(90deg,#dc2626,#f87171)", transition: "width .12s linear" }} /></div>
                        <span ref={odRedRef} style={{ opacity: 0, color: "#fde047", font: "900 10px Inter, system-ui, sans-serif", transition: "opacity .15s", width: 12, textAlign: "center" }}>⚡</span>
                    </div>
                )}
            </div>
            {/* Captures-only scoring — make the win condition unmistakable (kills don't score). */}
            {/* Dynamic objective line — scroll-spawn countdown / carrier return-progress,
                updated per-frame via refs by <ArenaObjectiveHud> (no HUD re-render). */}
            <div style={{ position: "absolute", top: 50, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, pointerEvents: "none" }}>
                <span ref={objTextRef} style={{ padding: "2px 10px", background: "rgba(8,12,24,0.6)", borderRadius: 999, color: "#94a3b8", font: "700 10px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>📜 Capture the scroll to score — defeating pets only buys time</span>
                <div ref={objBarWrapRef} style={{ display: "none", width: 150, height: 5, background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                    <div ref={objBarRef} style={{ width: "0%", height: "100%", background: "#60a5fa" }} />
                </div>
            </div>

            <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8 }}>
                <button onClick={onExit} style={duelBtn}>✕ Exit</button>
                <button onClick={replay} style={duelBtn}>⟲ Replay</button>
            </div>
            <div style={{ position: "absolute", top: 12, right: 12, padding: "4px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(168,85,247,0.6)", borderRadius: 999, color: "#d8b4fe", font: "700 11px Inter, system-ui, sans-serif" }}>🏟️ Arena{arenaV2 ? " V2" : ""}{arenaV2 && result.modifier !== "standard" ? ` · ${MODIFIER_LABEL[result.modifier] ?? result.modifier}` : ""} (beta)</div>

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
