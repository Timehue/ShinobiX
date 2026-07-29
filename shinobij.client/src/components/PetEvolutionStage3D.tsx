/*
 * Pet evolution cutscene — the 3D STAGE (a shinobi summoning ground).
 *
 * Both forms are the game's REAL rigged combat GLBs (the same models the Pet
 * Coliseum fights with, via petCombatModel + PetModel3D), standing on a glowing
 * fuinjutsu summoning seal. The outgoing form blows out to a white silhouette as
 * it charges into the chakra pillar; the evolved form emerges, takes a true 360°
 * turntable — real geometry, so edge-on is fine — and lands facing the player as
 * its colour floods back in over a shock-ring + smoke boom.
 *
 * Two things this layer deliberately owns, because combat does not need them:
 *   • a per-model HERO YAW, since each GLB is authored facing a different way
 *     (battle re-aims every pet at its opponent, so it never notices), and
 *   • grounding/sizing measured from the RENDERED creature — each GLB ships an
 *     oversized proxy mesh that the combat normalisation includes, which would
 *     otherwise leave a pet hovering or mis-scaled on a hero stage.
 * Both are presentation-only; battle proportions and facing are untouched.
 *
 * Driven by the deterministic timeline in lib/pet-evolution-cutscene.ts. Falls
 * back to a flat <img> when WebGL is unavailable, so the cutscene never hard-fails,
 * and to the 2D standee for any pet without an approved model.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import type { Pet } from "../types/pet";
import {
    type EvolutionPhase,
    isNewFormVisible,
    isOldFormVisible,
    evolutionStageMotion,
    evolutionSpin,
    morphProgress,
    whiteness,
    gridIntensity,
    ringBurst,
    floorRayIntensity,
} from "../lib/pet-evolution-cutscene";
import { petCombatModel } from "../lib/pet-3d-models";
import { petVisualId } from "../data/pet-evolutions";
import { PetModel3D, DEFAULT_PET_MODEL_FRAME } from "./PetModel3D";
import {
    groundedSpriteLayout,
    spriteBoundsFromAlpha,
    DEFAULT_SPRITE_BOUNDS,
    lerp,
    type SpriteBounds,
} from "../lib/pet-coliseum-scene";
import { petStripVariant } from "../lib/pet-battle-anim";
import { POSED_PET_IDS } from "../assets/coliseum/pet-poses-manifest";

const DEG2RAD = Math.PI / 180;
// Visible content height (world units) the form is grounded to — a touch under
// the coliseum's 2.3 so the hero pet sits inside the square stage with headroom
// for the name caption + room to rise into the tube of light.
const TARGET_SPRITE_H = 1.85;

// Element → aura tint (mirrors the coliseum palette). Chakra-cyan fallback.
const ELEMENT_TINT: Record<string, string> = {
    fire: "#fb923c", water: "#38bdf8", wind: "#a7f3d0", lightning: "#fde047",
    earth: "#d6a45a", ice: "#bae6fd", lava: "#fb923c", blood: "#ef4444",
    shadow: "#a78bfa", iron: "#cbd5e1",
};
const elementTint = (el?: string | null) => ELEMENT_TINT[String(el ?? "").toLowerCase()] ?? "#a5f3fc";

const poseIdleUrl = (id: string) => `/pet-poses/${id}-idle.webp`;
const heroUrl = (visualId: string) => `/pet-evos/${visualId}.webp`;
/** The posed-asset id for a visual id (itself, or its variant-stripped base), or
 *  null when no pose set exists → the renderer falls back to the portrait. */
function posedId(visualId: string): string | null {
    if (POSED_PET_IDS.has(visualId)) return visualId;
    const base = petStripVariant(visualId);
    return POSED_PET_IDS.has(base) ? base : null;
}
/** Pick the cleanest art source for a form. EVOLVED forms (…-r / …-l) have a
 *  dedicated hero portrait under /pet-evos with the full, intact creature — the
 *  pose flipbooks are inconsistently damaged by the background-removal pass (some
 *  bodies were faded to a translucent ghost). Those portraits sit on a flat card
 *  that loadCleanSprite knocks out. Base/unknown forms fall back to the passed
 *  portrait, then the idle pose. */
function spriteSrc(visualId: string, portrait?: string): string {
    if (/-(r|l)$/.test(visualId)) return heroUrl(visualId);
    if (portrait) return portrait;
    const id = posedId(visualId);
    return id ? poseIdleUrl(id) : "";
}

// ── Sprite load + flat-card knock-out ────────────────────────────────────────
// The hero portraits center the creature on a flat light "card". We remove it
// with a BORDER flood-fill keyed to the sampled card color: starting only from
// the image edges and matching against a FIXED seed color (never the moving
// frontier), the fill can't gradient-walk through anti-aliasing into the
// creature — so it strips the card without eating the (well-separated) subject.
// Pure pixel work; cached per src. No card present (transparent border) ⇒ no-op.
type Sprite = { texture: THREE.Texture; bounds: SpriteBounds; aspect: number };
const _spriteCache = new Map<string, Sprite>();
const _spriteInflight = new Map<string, Promise<Sprite | null>>();

function removeCard(data: Uint8ClampedArray, w: number, h: number): void {
    let sr = 0, sg = 0, sb = 0, sn = 0, bn = 0;
    const sample = (x: number, y: number) => { const i = (y * w + x) * 4; bn++; if (data[i + 3] > 40) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; sn++; } };
    for (let x = 0; x < w; x++) { sample(x, 0); sample(x, h - 1); }
    for (let y = 0; y < h; y++) { sample(0, y); sample(w - 1, y); }
    if (sn < bn * 0.5) return; // border isn't a solid card → already transparent
    const cr = sr / sn, cg = sg / sn, cb = sb / sn;
    const TOL2 = 66 * 66; // squared RGB distance to the card color
    const isCard = (i: number) => { const dr = data[i] - cr, dg = data[i + 1] - cg, db = data[i + 2] - cb; return dr * dr + dg * dg + db * db < TOL2; };
    const seen = new Uint8Array(w * h);
    const xs: number[] = [], ys: number[] = [];
    const consider = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const p = y * w + x; if (seen[p]) return;
        const i = p * 4;
        if (data[i + 3] <= 40 || isCard(i)) { seen[p] = 1; data[i + 3] = 0; xs.push(x); ys.push(y); }
    };
    for (let x = 0; x < w; x++) { consider(x, 0); consider(x, h - 1); }
    for (let y = 0; y < h; y++) { consider(0, y); consider(w - 1, y); }
    while (xs.length) {
        const x = xs.pop()!, y = ys.pop()!;
        consider(x + 1, y); consider(x - 1, y); consider(x, y + 1); consider(x, y - 1);
    }
    // Soften the thin AA fringe left where the card met the creature: any opaque
    // pixel touching a knocked-out one that is still light & desaturated (a card
    // remnant, not creature paint) gets faded so no bright halo rings the sprite.
    const faded: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y * w + x, i = p * 4;
        if (seen[p] || data[i + 3] < 40) continue;
        const touchesBg = (x > 0 && seen[p - 1]) || (x < w - 1 && seen[p + 1]) || (y > 0 && seen[p - w]) || (y < h - 1 && seen[p + w]);
        if (!touchesBg) continue;
        const mx = Math.max(data[i], data[i + 1], data[i + 2]), mn = Math.min(data[i], data[i + 1], data[i + 2]);
        const L = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
        const S = mx === 0 ? 0 : (mx - mn) / mx;
        if (L > 0.6 && S < 0.22) faded.push(i);
    }
    for (const i of faded) data[i + 3] = Math.round(data[i + 3] * 0.35);
}

function loadCleanSprite(src: string): Promise<Sprite | null> {
    if (!src) return Promise.resolve(null);
    const cached = _spriteCache.get(src);
    if (cached) return Promise.resolve(cached);
    const inflight = _spriteInflight.get(src);
    if (inflight) return inflight;
    const p = new Promise<Sprite | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const MAX = 512;
                const w0 = img.naturalWidth || MAX, h0 = img.naturalHeight || MAX;
                const k = Math.min(1, MAX / Math.max(w0, h0));
                const w = Math.max(8, Math.round(w0 * k)), h = Math.max(8, Math.round(h0 * k));
                const cv = document.createElement("canvas");
                cv.width = w; cv.height = h;
                const ctx = cv.getContext("2d", { willReadFrequently: true })!;
                ctx.drawImage(img, 0, 0, w, h);
                const imgData = ctx.getImageData(0, 0, w, h);
                removeCard(imgData.data, w, h);
                ctx.putImageData(imgData, 0, 0);
                const texture = new THREE.CanvasTexture(cv);
                texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
                const sprite: Sprite = { texture, bounds: spriteBoundsFromAlpha(imgData.data, w, h), aspect: w0 / Math.max(1, h0) };
                _spriteCache.set(src, sprite);
                resolve(sprite);
            } catch {
                resolve(null);
            }
            _spriteInflight.delete(src);
        };
        img.onerror = () => { _spriteInflight.delete(src); resolve(null); };
        img.src = src;
    });
    _spriteInflight.set(src, p);
    return p;
}

// One shared WHITE radial — element-tinted via material color under additive
// blending to paint the aura halo + the soft contact glow at the feet.
let _glowTex: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
    if (_glowTex) return _glowTex;
    const S = 128;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    const rad = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
    rad.addColorStop(0, "rgba(255,255,255,1)");
    rad.addColorStop(0.45, "rgba(255,255,255,0.5)");
    rad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rad; g.fillRect(0, 0, S, S);
    _glowTex = new THREE.CanvasTexture(c);
    _glowTex.colorSpace = THREE.SRGBColorSpace;
    return _glowTex;
}

// A bright thin ANNULUS (transparent core + outer) for the shock-ring — scaled up
// on the boom so it reads as an expanding electric torus. White so a material
// color can tint it under additive blending.
let _ringTex: THREE.CanvasTexture | null = null;
function ringTexture(): THREE.CanvasTexture {
    if (_ringTex) return _ringTex;
    const S = 256;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    const rad = g.createRadialGradient(S / 2, S / 2, S * 0.30, S / 2, S / 2, S * 0.5);
    rad.addColorStop(0, "rgba(255,255,255,0)");
    rad.addColorStop(0.62, "rgba(255,255,255,0.15)");
    rad.addColorStop(0.82, "rgba(255,255,255,1)");
    rad.addColorStop(0.92, "rgba(255,255,255,0.5)");
    rad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rad; g.fillRect(0, 0, S, S);
    _ringTex = new THREE.CanvasTexture(c);
    _ringTex.colorSpace = THREE.SRGBColorSpace;
    return _ringTex;
}

// Radial STARBURST rays for the boom — thin spokes fanning from the core. Faces
// the camera; scales + fades with the ring.
let _raysTex: THREE.CanvasTexture | null = null;
function raysTexture(): THREE.CanvasTexture {
    if (_raysTex) return _raysTex;
    const S = 256;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    g.translate(S / 2, S / 2);
    const N = 20;
    for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + (i % 2) * 0.06;
        const len = S * (0.32 + (i % 3) * 0.06);
        const grad = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
        grad.addColorStop(0, "rgba(255,255,255,0.95)");
        grad.addColorStop(0.5, "rgba(255,255,255,0.35)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.strokeStyle = grad;
        g.lineWidth = 2 + (i % 2);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        g.stroke();
    }
    // soft hot core
    const core = g.createRadialGradient(0, 0, 1, 0, 0, S * 0.12);
    core.addColorStop(0, "rgba(255,255,255,0.9)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = core; g.fillRect(-S / 2, -S / 2, S, S);
    _raysTex = new THREE.CanvasTexture(c);
    _raysTex.colorSpace = THREE.SRGBColorSpace;
    return _raysTex;
}

// A puffy SMOKE ring for the ninja "poof" at the boom — soft overlapping lobes
// arranged in a ring, alpha-blended grey (not additive) so it reads as smoke.
let _smokeTex: THREE.CanvasTexture | null = null;
function smokeTexture(): THREE.CanvasTexture {
    if (_smokeTex) return _smokeTex;
    const S = 256;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d")!;
    g.translate(S / 2, S / 2);
    const lobes = 13;
    for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * Math.PI * 2;
        const rr = S * (0.30 + (i % 3) * 0.03);
        const cx = Math.cos(a) * rr, cy = Math.sin(a) * rr;
        const rad = S * (0.14 + (i % 2) * 0.04);
        const grd = g.createRadialGradient(cx, cy, 1, cx, cy, rad);
        grd.addColorStop(0, "rgba(255,255,255,0.9)");
        grd.addColorStop(0.55, "rgba(235,240,250,0.5)");
        grd.addColorStop(1, "rgba(220,228,240,0)");
        g.fillStyle = grd;
        g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
    }
    _smokeTex = new THREE.CanvasTexture(c);
    _smokeTex.colorSpace = THREE.SRGBColorSpace;
    return _smokeTex;
}

// A vertical LIGHT SHAFT (bright center column, fading to the sides + top) for
// the light that streams UP off the floor. Anchored at the floor, billboarded.
let _shaftTex: THREE.CanvasTexture | null = null;
function shaftTexture(): THREE.CanvasTexture {
    if (_shaftTex) return _shaftTex;
    const W = 128, H = 256;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    const lin = g.createLinearGradient(0, 0, W, 0);
    lin.addColorStop(0, "rgba(255,255,255,0)");
    lin.addColorStop(0.5, "rgba(255,255,255,1)");
    lin.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = lin; g.fillRect(0, 0, W, H);
    // fade toward the top so the shaft dissolves upward, hottest at the floor
    const vert = g.createLinearGradient(0, H, 0, 0);
    vert.addColorStop(0, "rgba(0,0,0,0)");
    vert.addColorStop(0.15, "rgba(0,0,0,0)");
    vert.addColorStop(1, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = vert; g.fillRect(0, 0, W, H);
    _shaftTex = new THREE.CanvasTexture(c);
    _shaftTex.colorSpace = THREE.SRGBColorSpace;
    return _shaftTex;
}

/** Load a form's clean sprite (hero portrait with its card knocked out, or a
 *  fallback pose). Returns null until the async pixel work finishes — a frame or
 *  two, imperceptible against the cutscene's fade-in. Cached, so the reveal swap
 *  to the new form is instant. */
function useCleanSprite(visualId: string, portrait?: string): Sprite | null {
    // `src` is stable for a mounted standee (each form has a fixed visual id), so
    // the cache hit is resolved once in the initializer and the async load runs
    // only on a cold cache — no setState directly inside the effect.
    const src = spriteSrc(visualId, portrait);
    const [sprite, setSprite] = useState<Sprite | null>(() => _spriteCache.get(src) ?? null);
    useEffect(() => {
        if (_spriteCache.has(src)) return;
        let live = true;
        loadCleanSprite(src).then((s) => { if (live) setSprite(s); });
        return () => { live = false; };
    }, [src]);
    return sprite;
}

/** One evolving form rendered as a grounded, lit billboard. Eases toward the
 *  pure stage-motion targets and layers clock-driven breathing on top. */
function EvoStandee({ visualId, portrait, element, isNew, phase, reduced }: {
    visualId: string;
    portrait?: string;
    element?: string | null;
    isNew: boolean;
    /** Read in the per-frame loop; the standee re-renders each frame, so r3f's
     *  useFrame picks up the latest phase (same pattern as the coliseum Standee). */
    phase: EvolutionPhase;
    reduced: boolean;
}) {
    const group = useRef<THREE.Group>(null);   // lane + rise
    const poseG = useRef<THREE.Group>(null);    // scale + hero turn (pivots at feet)
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const flashMat = useRef<THREE.MeshBasicMaterial>(null);
    const auraMat = useRef<THREE.MeshBasicMaterial>(null);
    const footMat = useRef<THREE.MeshBasicMaterial>(null);

    const sprite = useCleanSprite(visualId, portrait);
    const bounds = sprite?.bounds ?? DEFAULT_SPRITE_BOUNDS;
    const aspect = sprite?.aspect ?? 1;
    const L = useMemo(
        () => groundedSpriteLayout(bounds, aspect, TARGET_SPRITE_H, false),
        [bounds, aspect],
    );
    const tint = useMemo(() => new THREE.Color(elementTint(element)), [element]);

    const yRot = useRef(0);
    const lift = useRef(0);
    const scl = useRef(isNew ? 0.6 : 1);

    useFrame((state) => {
        const g = group.current, pg = poseG.current, m = mat.current;
        if (!g || !pg || !m) return;
        const t = state.clock.elapsedTime;
        const motion = evolutionStageMotion(phase, isNew);
        // Hard-hide the off-stage form so NOTHING of it bleeds through (additive
        // overlays / alpha edges) while the other form owns the beat.
        const onStage = motion.opacity > 0.001;
        g.visible = onStage;
        if (!onStage) return;

        // During the white energy phase, fake a full spin with fast squash/flip
        // instead of letting the flat billboard vanish edge-on. Once color
        // returns, ease back into the front-facing 2.5D stance.
        const targetRot = motion.spinDeg * DEG2RAD;
        const energySpin = motion.flash > 0.9 && Math.abs(motion.spinDeg) > 1;
        yRot.current = energySpin ? Math.sin(targetRot) * 0.36 : lerp(yRot.current, targetRot, reduced ? 1 : 0.22);
        lift.current = lerp(lift.current, motion.riseY, reduced ? 1 : 0.3);
        scl.current = lerp(scl.current, motion.scale, reduced ? 1 : 0.3);
        const breathe = !reduced && motion.opacity > 0.5
            ? 1 + Math.abs(Math.sin(t * 4.4)) * 0.035
            : 1;
        const spinSquash = energySpin ? 0.24 + 0.76 * Math.abs(Math.cos(targetRot)) : 1;
        const spinFlip = energySpin && Math.cos(targetRot) < 0 ? -1 : 1;
        g.position.y = lift.current;
        pg.rotation.y = yRot.current;
        pg.scale.set(scl.current * spinSquash * spinFlip, scl.current * breathe, 1);

        m.opacity = motion.opacity; // white material ⇒ the sprite keeps its own art colors
        if (flashMat.current) { flashMat.current.opacity = motion.flash * motion.opacity; }
        if (auraMat.current) {
            const pulse = reduced ? motion.glow : motion.glow * (0.92 + 0.08 * Math.sin(t * 2.3));
            auraMat.current.opacity = pulse * 0.62 * motion.opacity;
        }
        if (footMat.current) { footMat.current.opacity = motion.glow * 0.38 * motion.opacity; }
    });

    // Hold off until the cleaned sprite is ready (a frame or two) so the card
    // knock-out never flashes the raw portrait.
    if (!sprite) return null;
    const useTex = sprite.texture;
    const auraScale = Math.max(L.contentWorldW, L.contentWorldH) * 1.5;
    return (
        <group ref={group}>
            {/* Element aura — additive halo centered on the body, behind the sprite. */}
            <Billboard>
                <mesh position={[0, L.contentWorldH * 0.5, -0.05]}>
                    <planeGeometry args={[auraScale, auraScale]} />
                    <meshBasicMaterial ref={auraMat} map={glowTexture()} color={tint} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </mesh>
            </Billboard>
            {/* The grounded billboard sprite + an additive self-flash overlay. */}
            <Billboard lockX lockZ>
                <group ref={poseG}>
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
            {/* Soft element-tinted contact glow on the floor for grounding. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <planeGeometry args={[L.contentWorldW * 1.4, L.contentWorldW * 0.7]} />
                <meshBasicMaterial ref={footMat} map={glowTexture()} color={tint} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
        </group>
    );
}

// ── The TRON GRID FLOOR ──────────────────────────────────────────────────────
// A large flat plane rendered with a procedural glowing-grid shader. Perspective
// does the receding-to-horizon convergence; a radial fade melts the plane edges
// into the DOM backdrop so there is never a hard rectangle. Additive so the dark
// cells contribute nothing (no visible plane box on the transparent canvas).
const SEAL_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// A shinobi SUMMONING SEAL (fuinjutsu array): concentric rings, radial spokes and
// a rotating outer band of seal ticks glowing on the ground, with a soft chakra
// pool under the pet. Reads as a ninja summoning circle — not a Tron grid.
const SEAL_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uIntensity;
uniform float uSize;
uniform vec3 uCore;
uniform vec3 uEdge;
void main(){
  vec2 P = (vUv - 0.5) * uSize;              // world XZ (units)
  float R = length(P);
  float ang = atan(P.y, P.x) + uTime * 0.14; // the whole array turns slowly
  // Concentric rings of the seal.
  float rings = 0.0;
  rings += smoothstep(0.06, 0.0, abs(R - 1.5));
  rings += smoothstep(0.06, 0.0, abs(R - 3.1));
  rings += smoothstep(0.05, 0.0, abs(R - 4.7));
  rings += smoothstep(0.08, 0.0, abs(R - 5.2));
  // Radial spokes between the inner and outer rings.
  float spokes = pow(0.5 + 0.5 * cos(ang * 12.0), 42.0) * smoothstep(5.2, 3.0, R) * step(2.9, R);
  // Outer band of fine "seal script" ticks (counter-rotating for life).
  float ticks = pow(0.5 + 0.5 * cos((ang * -2.0) * 48.0), 16.0) * smoothstep(0.28, 0.0, abs(R - 4.95));
  // Inner rune ticks.
  float inner = pow(0.5 + 0.5 * cos(ang * 8.0), 24.0) * smoothstep(0.22, 0.0, abs(R - 2.3));
  float seal = rings + spokes * 0.7 + ticks * 0.95 + inner * 0.6;
  float fade = smoothstep(6.4, 4.2, R);      // seal lives within ~6 units, then gone
  float pool = smoothstep(6.2, 0.0, R) * 0.22; // soft chakra pool under the pet
  vec3 col = mix(uCore, uEdge, clamp(R / 5.5, 0.0, 1.0));
  float bright = (seal * fade + pool) * uIntensity;
  gl_FragColor = vec4(col, bright);
}
`;
function SummoningSeal({ phase, element }: { phase: EvolutionPhase; element?: string | null }) {
    const mat = useRef<THREE.ShaderMaterial>(null);
    // Template uniforms — three CLONES these into the material, so the live values
    // are updated through mat.current.uniforms below (never this memoized object).
    const initialUniforms = useMemo(() => ({
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uSize: { value: 15 },
        uCore: { value: new THREE.Color("#dbeafe") },   // chakra-white core
        uEdge: { value: new THREE.Color("#5b8cff") },   // chakra-blue outer
    }), []);
    // A whisper of element tint on the outer band keeps each element distinct.
    const edgeColor = useMemo(
        () => new THREE.Color("#5b8cff").lerp(new THREE.Color(elementTint(element)), 0.28),
        [element],
    );
    useFrame((state) => {
        const u = mat.current?.uniforms;
        if (!u) return;
        u.uTime.value = state.clock.elapsedTime;
        u.uIntensity.value = gridIntensity(phase);
        (u.uEdge.value as THREE.Color).copy(edgeColor);
    });
    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} renderOrder={-10}>
            <planeGeometry args={[15, 15]} />
            <shaderMaterial
                ref={mat}
                args={[{ uniforms: initialUniforms, vertexShader: SEAL_VERT, fragmentShader: SEAL_FRAG }]}
                transparent
                depthWrite={false}
                toneMapped={false}
                blending={THREE.AdditiveBlending}
            />
        </mesh>
    );
}

// ── Light SHAFTS streaming up off the floor ──────────────────────────────────
// Two billboarded vertical planes (a hot narrow core + a broad soft halo) planted
// at the floor and fading upward, so the reveal reads as light bursting up around
// the pet. Opacity follows floorRayIntensity.
function UpRays({ phase, element }: { phase: EvolutionPhase; element?: string | null }) {
    const hot = useRef<THREE.MeshBasicMaterial>(null);
    const soft = useRef<THREE.MeshBasicMaterial>(null);
    const tint = useMemo(() => new THREE.Color(elementTint(element)).lerp(new THREE.Color("#ffffff"), 0.55), [element]);
    useFrame(() => {
        const i = floorRayIntensity(phase);
        if (hot.current) hot.current.opacity = i * 0.85;
        if (soft.current) soft.current.opacity = i * 0.4;
    });
    return (
        <Billboard lockX lockZ position={[0, 0, -0.15]} renderOrder={-2}>
            <mesh position={[0, 1.7, 0]}>
                <planeGeometry args={[3.4, 3.4]} />
                <meshBasicMaterial ref={soft} map={shaftTexture()} color={tint} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh position={[0, 1.6, 0.01]}>
                <planeGeometry args={[1.15, 3.2]} />
                <meshBasicMaterial ref={hot} map={shaftTexture()} color={"#eef2ff"} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
        </Billboard>
    );
}

// ── The BOOM shock-ring + starburst rays ─────────────────────────────────────
// A horizontal expanding torus around the pet's midsection plus a camera-facing
// radial starburst — the reference's climax that replaces a flat white wash.
function RingBurstFx({ phase, element }: { phase: EvolutionPhase; element?: string | null }) {
    const ring = useRef<THREE.Mesh>(null);
    const ringMat = useRef<THREE.MeshBasicMaterial>(null);
    const rays = useRef<THREE.Mesh>(null);
    const raysMat = useRef<THREE.MeshBasicMaterial>(null);
    const smoke = useRef<THREE.Mesh>(null);
    const smokeMat = useRef<THREE.MeshBasicMaterial>(null);
    const grp = useRef<THREE.Group>(null);
    const tint = useMemo(() => new THREE.Color(elementTint(element)).lerp(new THREE.Color("#ffffff"), 0.5), [element]);
    useFrame(() => {
        const { radius, opacity } = ringBurst(phase);
        const on = opacity > 0.001;
        if (grp.current) grp.current.visible = on;
        if (!on) return;
        const s = 0.4 + radius * 5.2;
        if (ring.current) ring.current.scale.set(s, s, s);
        if (ringMat.current) ringMat.current.opacity = opacity;
        const rs = 0.6 + radius * 4.6;
        if (rays.current) rays.current.scale.set(rs, rs, rs);
        if (raysMat.current) raysMat.current.opacity = opacity * 0.9;
        // Ninja "poof": a bigger, slower smoke ring that lingers as it expands.
        const ss = 0.8 + radius * 4.0;
        if (smoke.current) smoke.current.scale.set(ss, ss, ss);
        if (smokeMat.current) smokeMat.current.opacity = opacity * 0.75;
    });
    return (
        <group ref={grp} position={[0, 0.95, 0]} visible={false} renderOrder={10}>
            {/* Ninja smoke poof (alpha-blended grey, behind the bright FX). */}
            <Billboard>
                <mesh ref={smoke} renderOrder={9}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial ref={smokeMat} map={smokeTexture()} color={"#e6ecf5"} transparent opacity={0} depthWrite={false} toneMapped={false} />
                </mesh>
            </Billboard>
            {/* Horizontal shock ring (tilted toward camera so it reads as a disc). */}
            <mesh ref={ring} rotation={[-Math.PI * 0.38, 0, 0]}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial ref={ringMat} map={ringTexture()} color={tint} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
            </mesh>
            {/* Camera-facing starburst rays. */}
            <Billboard>
                <mesh ref={rays}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial ref={raysMat} map={raysTexture()} color={"#eef2ff"} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </mesh>
            </Billboard>
        </group>
    );
}

// ── Ambient DATA MOTES ───────────────────────────────────────────────────────
// A small cloud of glowing particles drifting up around the pet — sells the
// "grounded in a cyberspace" read the grid floor sets up. Brightness follows the
// grid so they fade in and out with the stage. Deterministic scatter (no RNG).
function DataMotes({ phase, element }: { phase: EvolutionPhase; element?: string | null }) {
    const pts = useRef<THREE.Points>(null);
    const mat = useRef<THREE.PointsMaterial>(null);
    const N = 46;
    const geo = useMemo(() => {
        const g = new THREE.BufferGeometry();
        const pos = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
            // golden-angle scatter in a tall cylinder around the pet
            const a = i * 2.399963;
            const rad = 0.5 + ((i * 7) % 11) / 11 * 1.7;
            pos[i * 3] = Math.cos(a) * rad;
            pos[i * 3 + 1] = ((i * 13) % 30) / 10;        // 0..3
            pos[i * 3 + 2] = Math.sin(a) * rad * 0.6;
        }
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        return g;
    }, []);
    const tint = useMemo(() => new THREE.Color(elementTint(element)).lerp(new THREE.Color("#ffffff"), 0.4), [element]);
    useFrame((state) => {
        const p = pts.current;
        if (!p) return;
        const t = state.clock.elapsedTime;
        p.position.y = (t * 0.35) % 1.0;   // gentle continuous updraft, wraps softly
        p.rotation.y = t * 0.12;
        if (mat.current) mat.current.opacity = Math.min(1, gridIntensity(phase) * 0.75);
    });
    useEffect(() => () => geo.dispose(), [geo]);
    return (
        <points ref={pts} geometry={geo} renderOrder={-5}>
            <pointsMaterial ref={mat} map={glowTexture()} color={tint} size={0.14} sizeAttenuation transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
        </points>
    );
}

// ── Scene lighting ───────────────────────────────────────────────────────────
// The 3D pet is a PBR model, so it needs real lights. They stay DIM while the pet
// spins inside the chakra pillar (it reads as a backlit silhouette), then blaze up
// across the boom so the evolved form is revealed in full colour.
function revealLight(phase: EvolutionPhase): number {
    // Tied to the wash rather than the beat: the pet is FULLY LIT while it is still
    // in colour (the opening hold — the player has to see who is evolving), and the
    // key dims away only as the silhouette takes over, which is self-lit anyway.
    // Colour returning on the reveal brings the lights straight back up.
    return 1 - whiteness(phase) * 0.68;
}
function SceneLights({ phase, element }: { phase: EvolutionPhase; element?: string | null }) {
    const amb = useRef<THREE.AmbientLight>(null);
    const dir = useRef<THREE.DirectionalLight>(null);
    const rim = useRef<THREE.PointLight>(null);
    const tint = useMemo(() => new THREE.Color(elementTint(element)), [element]);
    useFrame(() => {
        const k = revealLight(phase);
        if (amb.current) amb.current.intensity = 0.22 + k * 0.5;
        if (dir.current) dir.current.intensity = 0.25 + k * 1.15;
        // A chakra-blue rim from behind keeps the silhouette lit while the key is dim.
        if (rim.current) rim.current.intensity = 3.5 - k * 1.5;
    });
    return (
        <group>
            <ambientLight ref={amb} intensity={0.3} />
            <hemisphereLight args={["#bcd8ff", "#111834", 0.5]} />
            <directionalLight ref={dir} position={[4, 8, 6]} intensity={0.4} color="#ffe9cf" />
            <directionalLight position={[-6, 4, -6]} intensity={0.4} color="#6ea8ff" />
            {/* Behind-the-pet chakra rim (blends a little element colour). */}
            <pointLight ref={rim} position={[0, 1.8, -2.4]} color={tint} intensity={2} distance={9} decay={2} />
        </group>
    );
}

// ── The pet as a REAL 3D MODEL, with a material-level WHITE-OUT ───────────────
// Both the base (old) and evolved (new) forms are the game's actual combat GLBs,
// doing a TRUE 360° turntable (real models, so edge-on is fine). The `whiteness`
// curve drives each mesh's material to a pure white glow (the classic before/after
// silhouette): the old form blows out to white going into the pillar, the new form
// spins white inside it, then its COLOUR floods back in on the reveal. PetModel3D
// clones its materials per instance, so recolouring here never touches the shared
// GLTF cache (the coliseum's models are safe).
// The production starter GLBs are each authored facing a different way (the
// combat renderer never notices, because it re-aims every pet at its opponent
// anyway). The cutscene DOES care: the turntable has to land with the pet looking
// at the player. These are the per-model yaws that do that, measured off the
// rendered art — presentation only, and independent of the combat facing code.
// All five stage-0 bases came out of one authoring pass and share −72°; the
// evolved forms were rebuilt per species and each landed somewhere different.
const HERO_YAW_DEG: Readonly<Record<string, number>> = {
    "starter-fire": -72, "starter-fire-r": 144, "starter-fire-l": 144,
    "starter-water": -72, "starter-water-r": -72, "starter-water-l": -72,
    "starter-wind": -72, "starter-wind-r": -144, "starter-wind-l": -144,
    "starter-lightning": -72, "starter-lightning-r": 0, "starter-lightning-l": 0,
    "starter-earth": -72, "starter-earth-r": -72, "starter-earth-l": -72,
};
const DEG2RAD_YAW = Math.PI / 180;
const heroYaw = (visualId?: string): number => (HERO_YAW_DEG[visualId ?? ""] ?? 0) * DEG2RAD_YAW;
const WHITE = new THREE.Color("#ffffff");
type WOState = { color: THREE.Color; emissive: THREE.Color; emissiveIntensity: number };
/** Drive every mesh material in `root` toward a white glow by `w` (0..1). Caches
 *  each material's original colour/emissive on first touch so w→0 restores it.
 *  PetModel3D clones its materials per instance, so this never leaks into the
 *  shared GLTF cache (the coliseum's copies are untouched). */
function applyWhiteout(root: THREE.Object3D, w: number): void {
    root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
            const mat = m as THREE.MeshStandardMaterial;
            if (!mat.color) continue;
            const store = mat.userData as { __wo?: WOState };
            if (!store.__wo) {
                store.__wo = {
                    color: mat.color.clone(),
                    emissive: mat.emissive ? mat.emissive.clone() : new THREE.Color(0, 0, 0),
                    emissiveIntensity: mat.emissiveIntensity ?? 1,
                };
            }
            const o0 = store.__wo;
            mat.color.copy(o0.color).lerp(WHITE, w);
            if (mat.emissive) {
                mat.emissive.copy(o0.emissive).lerp(WHITE, w);
                mat.emissiveIntensity = o0.emissiveIntensity + w * 2.4; // self-lit white glow
            }
        }
    });
}

/** The pet as it was BEFORE this evolution. A starter evolves twice, so the outgoing
 *  form is whatever `oldVisualId` names (…-r = rare stage 1, …-l = legendary stage 2,
 *  bare id = the stage-0 base) — never assume the base. */
function priorForm(pet: Pet, oldVisualId: string): Pet {
    if (oldVisualId.endsWith("-l")) return { ...pet, evolutionStage: 2, rarity: "legendary" } as Pet;
    if (oldVisualId.endsWith("-r")) return { ...pet, evolutionStage: 1, rarity: "rare" } as Pet;
    return { ...pet, evolutionStage: 0, rarity: "standard" } as Pet;
}

function EvoModel({ pet, isNew, oldVisualId, element, phase, reduced }: {
    pet: Pet; isNew: boolean; oldVisualId: string; element?: string | null; phase: EvolutionPhase; reduced: boolean;
}) {
    const group = useRef<THREE.Group>(null);  // turntable + rise
    const scaleG = useRef<THREE.Group>(null);  // emerge / boom pop
    const modelG = useRef<THREE.Group>(null);  // white-out target
    // The evolved pet drives its own model; the old form is the same pet at stage 0.
    const config = useMemo(
        () => petCombatModel(isNew ? pet : priorForm(pet, oldVisualId)),
        [pet, isNew, oldVisualId],
    );
    const scl = useRef(isNew ? 0.0001 : 1);
    // PetModel3D reads frame.current live each render frame — mutate, don't replace.
    const frame = useRef({ ...DEFAULT_PET_MODEL_FRAME });
    // All 15 starter GLBs now come from one grounded, rigged production pipeline
    // (STARTER_MODEL_ASSET_REVISION) and are fully volumetric, so the evolved form
    // can take the dramatic full 360° turntable without ever going paper-thin.
    const front = heroYaw(config?.visualId);

    useFrame(() => {
        const g = group.current, sg = scaleG.current;
        if (!g || !sg) return;
        // Plant the creature (not its proxy sphere) on the seal. Re-measured every
        // frame: the gap is computed in modelG's own local space, so it is unaffected
        // by the correction we apply here (idempotent) and it picks up the combat
        // renderer's scale/offset whenever those settle in after the GLB loads.
        const show = isNew ? isNewFormVisible(phase.beat) : isOldFormVisible(phase.beat);
        g.visible = show;
        if (!show) return;
        // NEW: emerge from nothing across the morph + a small boom pop. OLD: full
        // size, shrinking away as the morph hands off to the evolved form.
        const target = isNew
            ? (phase.beat === "morph" ? morphProgress(phase) : 1) * (phase.beat === "reveal" ? 1 + (1 - phase.progress) * 0.12 : 1)
            : (phase.beat === "morph" ? 1 - morphProgress(phase) * 0.4 : 1);
        scl.current = reduced ? target : lerp(scl.current, target, 0.35);
        sg.scale.setScalar(Math.max(0.0001, scl.current));
        // ONE continuous turntable, shared by BOTH forms so the hand-off inside the
        // pillar is seamless: it eases up from a slow turn while the pet is still in
        // colour, runs fast through the white morph, decelerates, and lands on a
        // whole number of turns — i.e. facing the player — for the colour reveal,
        // which then holds perfectly still. Safe for every form now that these are
        // real volumetric models (the old sway existed only for flat relief art).
        g.rotation.y = front + (reduced ? 0 : evolutionSpin(phase));
        // Ride the light column on the way in, planted for the colour reveal.
        // Grounding, horizontal centring and scale all come from PetModel3D's shared
        // presentation bounds (lib/pet-model-bounds.ts), which measures a percentile
        // envelope of the creature — so sparse proxy/tip geometry can neither
        // levitate nor shrink the pet, and this stage does not second-guess it.
        g.position.y = phase.beat === "reveal" || phase.beat === "settle"
            ? 0 : floorRayIntensity(phase) * 0.12;
        // Deliberately NOT `victorious` on settle: that drives PetModel3D's victory
        // leap arc, which lifts the pet off the seal exactly when the hero shot
        // wants it planted. The reveal holds a grounded idle instead.
        // The white-out: silhouette going in, colour flooding back on the reveal.
        if (modelG.current) applyWhiteout(modelG.current, reduced ? (isNew ? 0 : 1) : whiteness(phase));
    });

    if (!config) {
        // No approved GLB → 2D standee fallback so the beat still lands.
        return <EvoStandee visualId={petVisualId(isNew ? pet : priorForm(pet, oldVisualId))} element={element} isNew={isNew} phase={phase} reduced={reduced} />;
    }
    return (
        <group ref={group}>
            <group ref={scaleG}>
                <group ref={modelG}>
                    <PetModel3D config={config} frame={frame} element={pet.element ?? element ?? undefined} />
                </group>
            </group>
        </group>
    );
}

function hasWebGL(): boolean {
    try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch { return false; }
}

/**
 * The evolution stage. The OLD form dissolves as a 2D standee; the EVOLVED form
 * emerges as the game's REAL rigged 3D combat model and does a true 360° turntable
 * on the ninja summoning-seal stage, revealed in colour as the lights blaze. The
 * caller still overlays the DOM chakra pillar, flash, names and controls.
 */
export function PetEvolutionStage3D({
    phase, pet, oldVisualId, element, oldImage, newImage, reduced,
}: {
    phase: EvolutionPhase;
    /** The evolved pet — drives its real 3D combat model. */
    pet: Pet;
    oldVisualId: string;
    element?: string | null;
    oldImage?: string;
    newImage?: string;
    reduced: boolean;
}) {
    // Graceful fallback: no WebGL → a flat sprite of the active form (no hard
    // fail). Reduced-motion still uses the 3D stage (the parent parks it on the
    // settled frame), so the evolved pet still gets the lit, grounded treatment.
    const webgl = useMemo(() => hasWebGL(), []);
    if (!webgl) {
        const showNew = isNewFormVisible(phase.beat) || (!isOldFormVisible(phase.beat) && phase.beat !== "charge");
        const src = showNew ? (newImage ?? `/pet-evos/${petVisualId(pet)}.webp`)
                            : (oldImage ?? `/pet-poses/${posedId(oldVisualId) ?? oldVisualId}-idle.webp`);
        return (
            <img
                src={src}
                alt=""
                draggable={false}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", filter: "drop-shadow(0 0 24px rgba(167,139,250,0.6))" }}
            />
        );
    }

    return (
        <Canvas
            gl={{ alpha: true, antialias: true }}
            dpr={[1, 2]}
            style={{ width: "100%", height: "100%", background: "transparent" }}
            camera={{ position: [0, 2.7, 11.4], fov: 38 }}
            onCreated={({ camera }) => camera.lookAt(0, 1.7, 0)}
        >
            {/* No postprocessing Bloom on purpose: a fullscreen pass on a TRANSPARENT
                canvas hazes the canvas RECTANGLE (a visible "box"). Lights + additive
                FX give the glow instead. */}
            {/* Ninja summoning stage: a glowing seal floor, drifting chakra motes,
                up-rays and the boom shock-ring; the evolved 3D pet stands ON it. */}
            <SceneLights phase={phase} element={element} />
            <SummoningSeal phase={phase} element={element} />
            <DataMotes phase={phase} element={element} />
            <UpRays phase={phase} element={element} />
            {/* Both forms are real 3D models with a material white-out: the base
                blows out to white going in, the evolved spins white then floods
                to colour on the reveal. */}
            <Suspense fallback={null}>
                <EvoModel pet={pet} isNew={false} oldVisualId={oldVisualId} element={element} phase={phase} reduced={reduced} />
                <EvoModel pet={pet} isNew oldVisualId={oldVisualId} element={element} phase={phase} reduced={reduced} />
            </Suspense>
            <RingBurstFx phase={phase} element={element} />
        </Canvas>
    );
}
