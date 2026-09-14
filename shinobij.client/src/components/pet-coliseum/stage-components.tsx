// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard, OrthographicCamera } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { type ProjectileVisual } from "../../lib/pet-projectile-vfx";
import { lerp } from "../../lib/pet-coliseum-scene";
import { petBloomEnabled } from "../../lib/pet-coliseum-flag";
import { petVisualQuality, type PetVisualQualityConfig } from "../../lib/pet-visual-quality";
import { duelCameraComposition } from "../../lib/pet-duel-camera";
import { type Vec3, STAGE } from "./stage";
import { duelFovKick } from "./playback-state";
import { projSpriteTexture, projHeadTexture, projRoundTexture } from "./sprite-resources";


/** Optional HDR-glow pass (default OFF, behind petBloom.v1). Threshold bloom makes the
 *  bright, additive signature / ultimate / KO effects GLOW so big moves read bigger, while
 *  basic hits stay below the luminance threshold and don't bloom. Costs one fullscreen pass
 *  (a real mobile/low-end hit) so it's opt-in pending a perf + visual review — and on the
 *  transparent arena Canvas the alpha compositing needs eyeballing. Read once per mount,
 *  same as the other coliseum flags. */
export function BloomFx({ quality = petVisualQuality(), isolated = false }: { quality?: PetVisualQualityConfig; isolated?: boolean }) {
    if (quality.bloomIntensity <= 0 || (!petBloomEnabled() && quality.id !== "high")) return null;
    return (
        <EffectComposer>
            {/* Only explicitly-authored HDR VFX exceed 1.0. Textured pet materials
                stay below this gate, so quality bloom cannot bleach their atlases. */}
            <Bloom
                luminanceThreshold={isolated ? 1.05 : 0.72}
                luminanceSmoothing={isolated ? 0.1 : 0.18}
                intensity={isolated ? quality.bloomIntensity : quality.id === "high" ? 0.48 : 0.32}
                mipmapBlur
            />
        </EffectComposer>
    );
}


// ── A frame-sequence VFX sprite (stationary, or travelling from→to) ───────────
export function FxAnim({
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


export function ResponsiveCamera() {
    const { camera, size } = useThree();
    useFrame(() => {
        const aspect = size.width / Math.max(1, size.height);
        const composition = duelCameraComposition(aspect);
        const fov = composition.fov - duelFovKick.current;   // narrower FOV = zoom-in punch (decayed by DuelDirector)
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


/** Orthographic camera fit to the stage rect — matches the CSS background fit so
 *  the sprite layer is pixel-locked to the painting at any size. `cover` fills +
 *  crops (duel/coliseum); `contain` shows the WHOLE map centred (arena — so the
 *  full board is always visible + the side panels don't crop the action). */
export function StageCamera({ fit = "cover", worldW = STAGE.worldW, worldH = STAGE.worldH }: { fit?: "cover" | "contain"; worldW?: number; worldH?: number }) {
    const size = useThree((s) => s.size);
    const zoom = fit === "contain"
        ? Math.min(size.width / worldW, size.height / worldH)
        : Math.max(size.width / worldW, size.height / worldH);
    return <OrthographicCamera makeDefault position={[0, 0, 100]} zoom={zoom} near={0.1} far={1000} />;
}


/** The shared element/role-distinct projectile body — a glowing head (round
 *  fireball / undulating water ball / spinning wind crescent / tumbling rock /
 *  jagged bolt) with a comet tail and, for signature/crit shots, a pulsing aura
 *  ring. Self-animates flicker + spin off the clock (no rng → replay-safe). The
 *  PARENT group owns world position, the travel-direction rotation (so the head
 *  always points where it's going — both stages look straight down −z, so world
 *  xy == screen) and the perspective depth-scale. */
export function ProjectileBody({ visual }: { visual: ProjectileVisual }) {
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
