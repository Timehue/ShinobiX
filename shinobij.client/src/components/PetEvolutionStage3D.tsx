/*
 * Pet evolution cutscene — the 2.5D STAGE (the HD-2D standee renderer).
 *
 * Renders the evolving pet as a grounded, lit BILLBOARD sprite in a small
 * react-three-fiber scene — the same flat-sprite-in-a-3D-world tech as the Pet
 * Coliseum — instead of a flat CSS <img>. The pet uses its generated pose
 * flipbook (idle / cast), breathes, glows with an element aura, blows out to
 * white as it charges into the light, and makes a bounded "hero turn" on the
 * reveal. It reuses the SAME exported grounding helpers as the coliseum
 * (groundedSpriteLayout + the alpha-bounds scan) so the feet plant correctly.
 *
 * NOTE on "spinning": these are flat billboards (like every pet in the game),
 * so the hero turn is a CAPPED sway (never ±90°, which would collapse the sprite
 * to a line). A true volumetric 360° turntable needs real .glb models — the
 * planned-but-unbuilt path in docs/pet-starter-evolution-plan.md §4.
 *
 * This is a pure PRESENTATION layer driven by the deterministic timeline in
 * lib/pet-evolution-cutscene.ts (evolutionStageMotion). Degrades to a flat <img>
 * when WebGL is unavailable, so the cutscene never hard-fails.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import {
    type EvolutionPhase,
    isNewFormVisible,
    isOldFormVisible,
    evolutionStageMotion,
} from "../lib/pet-evolution-cutscene";
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

function hasWebGL(): boolean {
    try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch { return false; }
}

/**
 * The 2.5D stage. Mounts both forms (old + new); each shows only on the beats it
 * owns (the off-beat form sits at opacity 0), so the reveal swap never pops. The
 * caller still overlays the DOM tube-of-light, white burst, names and controls.
 */
export function PetEvolutionStage3D({
    phase, oldVisualId, newVisualId, element, oldImage, newImage, reduced,
}: {
    phase: EvolutionPhase;
    oldVisualId: string;
    newVisualId: string;
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
        const src = showNew ? (newImage ?? `/pet-poses/${posedId(newVisualId) ?? newVisualId}-idle.webp`)
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
            camera={{ position: [0, 1.0, 5.7], fov: 34 }}
            onCreated={({ camera }) => camera.lookAt(0, 1.05, 0)}
        >
            {/* No postprocessing Bloom here on purpose: it's a fullscreen pass on
                a TRANSPARENT canvas, which hazes the canvas RECTANGLE for bright
                sprites (a visible "box" behind light-colored evolved forms). The
                additive element aura below gives the glow without that artifact. */}
            <EvoStandee visualId={oldVisualId} portrait={oldImage} element={element} isNew={false} phase={phase} reduced={reduced} />
            <EvoStandee visualId={newVisualId} portrait={newImage} element={element} isNew={true} phase={phase} reduced={reduced} />
        </Canvas>
    );
}
