// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { Pet } from "../../types/pet";
import type { PetVisualState } from "../../types/pet-battle";
import { petBattleSprite, petStripVariant } from "../../lib/pet-battle-anim";
import { type ProjTexKind } from "../../lib/pet-projectile-vfx";
import { spriteBoundsFromAlpha, DEFAULT_SPRITE_BOUNDS, type SpriteBounds } from "../../lib/pet-coliseum-scene";
import { type ShrineKind } from "../../lib/pet-arena-sim";
import { POSED_PET_IDS, POSED_RUN_IDS, POSED_MOVE_IDS } from "../../assets/coliseum/pet-poses-manifest";


/** Load a bundled scene texture (sRGB). */
export function loadSceneTexture(url: string): THREE.Texture {
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

export function elementColor(element?: string | null) {
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
export function usePetSprite(pet: Pet, sharedImages: Record<string, string>, mirror = false): { texture: THREE.Texture; bounds: SpriteBounds; aspect: number } {
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
export type PoseCat = "idle" | "attack" | "hurt" | "cast" | "run-a" | "run-b" | "windup" | "lunge" | "impact" | "recover";

const POSE_CATS: PoseCat[] = ["idle", "attack", "hurt", "cast"];

const RUN_CATS: PoseCat[] = ["run-a", "run-b"];
 // 2-frame run cycle (kills gliding)
const MOVE_CATS: PoseCat[] = ["windup", "lunge", "impact", "recover"];
 // generated attack sequence
// Poses are served as STATIC files (public/pet-poses/) and loaded on demand per
// fighting pet — the manifest says which of the 148 pets have a generated set.
export const poseUrl = (id: string, cat: PoseCat) => `/pet-poses/${id}-${cat}.webp`;

/** The posed-asset id for a pet (its own id, or the stripped base id), or null
 *  if no pose set was generated for it. */
export function posedId(petId: string): string | null {
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
export function poseCategory(s: PetVisualState): PoseCat {
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
export function usePetPoses(petId: string, mirror: boolean): PoseSet | null {
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

export function shadowTexture(): THREE.CanvasTexture {
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

export function glowTexture(): THREE.CanvasTexture {
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
     // frames between trail samples (longer streak)
export function makeGhostMaterial(color: string): THREE.ShaderMaterial {
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


// ── Dust kick-up — a soft procedural puff at a pet's feet on lunges/dodges ────
let _dustTexture: THREE.CanvasTexture | null = null;

export function dustTexture(): THREE.CanvasTexture {
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


// ── Arena obstacles — the sim's tactical grid made VISIBLE ────────────────────
// The engine already routes pets around these (BFS) + blocks ranged line-of-
// sight; the 3D renderer never drew them, so the tactics were invisible. blocked
// = full stone wall, cover = half-height wall pets shoot over, hazard/healing/
// slow = flat tinted floor decals (the passable effect tiles). Placements come
// from the pure arenaObstaclePlacements (same tileToWorld the pets stand on).
let _decalTexture: THREE.CanvasTexture | null = null;

export function decalTexture(): THREE.CanvasTexture {
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

// The rotating buff shrines — transparent cutouts (gpt-image-1), one per flavour.
const SHRINE_URLS: Record<"power" | "mend", string> = {
    power: new URL("../../assets/coliseum/shrine-power.webp", import.meta.url).href,
    mend: new URL("../../assets/coliseum/shrine-mend.webp", import.meta.url).href,
};

const _shrineTex: Partial<Record<"power" | "mend", THREE.Texture>> = {};

export function shrineTexture(kind: ShrineKind): THREE.Texture {
    // v2 relics reuse the two base shrine sprites (offensive→power art, sustain→mend art);
    // their identity is carried by colour + label + claim FX, so no new asset is needed.
    const key: "power" | "mend" = kind === "mend" || kind === "favor" ? "mend" : "power";
    let t = _shrineTex[key];
    if (!t) { t = new THREE.TextureLoader().load(SHRINE_URLS[key]); t.colorSpace = THREE.SRGBColorSpace; _shrineTex[key] = t; }
    return t;
}

// The Warden's animation frames (fal Nano-Banana img2img off the base sprite) — a
// flipbook the renderer swaps by state (idle / walk / wind-up / slam), the "pet treatment".
export type WardenFrame = "idle" | "walk" | "windup" | "slam";

const WARDEN_FRAME_URLS: Record<WardenFrame, string> = {
    idle: new URL("../../assets/coliseum/warden-idle.webp", import.meta.url).href,
    walk: new URL("../../assets/coliseum/warden-walk.webp", import.meta.url).href,
    windup: new URL("../../assets/coliseum/warden-windup.webp", import.meta.url).href,
    slam: new URL("../../assets/coliseum/warden-slam.webp", import.meta.url).href,
};

const _wardenTex: Partial<Record<WardenFrame, THREE.Texture>> = {};

export function wardenFrame(f: WardenFrame): THREE.Texture {
    let t = _wardenTex[f];
    if (!t) { t = new THREE.TextureLoader().load(WARDEN_FRAME_URLS[f]); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; _wardenTex[f] = t; }
    return t;
}


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


export function projRoundTexture(): THREE.CanvasTexture {
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


export function projCrescentTexture(): THREE.CanvasTexture {
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
export function trailStreakTexture(): THREE.CanvasTexture {
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


export function projHeadTexture(tex: ProjTexKind): THREE.CanvasTexture {
    switch (tex) {
        case "crescent": return projCrescentTexture();
        case "bolt": return projBoltTexture();
        case "rock": return projRockTexture();
        default: return projRoundTexture();
    }
}


// Real painted element projectile sprites (gpt-image-1 → transparent WebP, in
// src/assets/fx/projectiles-v2/). Drawn ALPHA-blended (not additive) so the actual
// fireball / water ball / wind cut / boulder / bolt reads as art over the scene
// — only the genuinely-bright bits (fire & lightning cores) cross the bloom
// threshold and glow, so rock/water stay solid instead of washing to light.
// Base art faces +x (travelling right) with its tail to −x; the parent group
// rotates it to the travel direction.
const PROJ_SPRITE_URL: Record<string, string> = {
    fire: new URL("../../assets/fx/projectiles-v2/fire.webp", import.meta.url).href,
    water: new URL("../../assets/fx/projectiles-v2/water.webp", import.meta.url).href,
    wind: new URL("../../assets/fx/projectiles-v2/wind.webp", import.meta.url).href,
    earth: new URL("../../assets/fx/projectiles-v2/earth.webp", import.meta.url).href,
    lightning: new URL("../../assets/fx/projectiles-v2/lightning.webp", import.meta.url).href,
};

const _projSpriteTex: Record<string, THREE.Texture> = {};

export function projSpriteTexture(key?: string): THREE.Texture | null {
    if (!key) return null;
    const url = PROJ_SPRITE_URL[key];
    if (!url) return null;
    if (_projSpriteTex[key]) return _projSpriteTex[key];
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    _projSpriteTex[key] = t;
    return t;
}
