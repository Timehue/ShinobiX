// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Billboard, Sparkles } from "@react-three/drei";
import { lerp, meleeTrailSpec, type MoveChoreoKind } from "../../lib/pet-coliseum-scene";
import { DUEL_TPS, type DuelResult } from "../../lib/pet-duel-sim";
import { type PetVisualQualityConfig } from "../../lib/pet-visual-quality";
import { type PetHeroMoveStyle } from "../../lib/pet-hero-moves";
import { type DuelClock, FLOOR_Y, type Vec3 } from "./stage";
import { trailStreakTexture, projCrescentTexture } from "./sprite-resources";
import { type DuelImpactMode, type DuelElementBurstKind, type DuelSupportKind, liveDuelEffectPosition, type DuelAttackWeight } from "./duel-stage";
import { duelFxPalette, makeAnimeStrokeGeometry, makeFlameRibbonGeometry, type DuelElementVolumePhase, duelElementCurveCount, cachedElementVolumeCurves, cachedHeroMoveStrokes } from "./duel-resources";



/** Element-colored impact burst — an expanding additive ring + flash core. */
export function DuelImpact({ at, color, big, mode = "impact", onDone }: { at: Vec3; color: string; big: boolean; mode?: DuelImpactMode; onDone: () => void }) {
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



/** One coherent 3D material language for every live elemental contact. It is
 * intentionally shape-led: fire rises and curls, water splashes, wind funnels,
 * lightning branches, earth displaces mass, abyss smolders, and arcane energy
 * orbits. The effect scales from a quick hit to an arena signature without
 * falling back to the old beveled brush cards. */
export function DuelElementVolume({ at, kind, color, big, heading = 0, phase, quality, heroStyle = "generic", delay = 0, simClock, simStartTick, onDone }: {
    at: Vec3;
    kind: DuelElementBurstKind;
    color: string;
    big: boolean;
    heading?: number;
    phase: DuelElementVolumePhase;
    quality: PetVisualQualityConfig;
    heroStyle?: PetHeroMoveStyle;
    delay?: number;
    simClock?: { current: DuelClock };
    simStartTick?: number;
    onDone: () => void;
}) {
    const root = useRef<THREE.Group>(null);
    const core = useRef<THREE.Group>(null);
    const arenaSeal = useRef<THREE.Group>(null);
    const motifs = useRef<Array<THREE.Group | null>>([]);
    const particles = useRef<THREE.InstancedMesh>(null);
    const sparks = useRef<THREE.InstancedMesh>(null);
    const sparkMat = useRef<THREE.MeshBasicMaterial>(null);
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
    const particleCount = signature
        ? Math.max(quality.impactDebris, Math.ceil(quality.setPieceParticles * 0.34))
        : aftermath
            ? Math.max(3, Math.round(quality.impactDebris * 0.65))
            : heroMove || big
                ? quality.impactDebris
                : Math.max(3, Math.round(quality.impactDebris * 0.72));
    const sparkCount = aftermath ? 0 : signature ? Math.ceil(quality.impactSparks * 1.4) : quality.impactSparks;
    const earthSpireCount = signature ? Math.max(4, quality.impactDebris) : Math.max(3, Math.round(quality.impactDebris * (big ? 0.72 : 0.5)));
    // Curves are immutable and shared by every repeat of the same move class.
    // Rebuilding TubeGeometry synchronously on each hit was the largest visible
    // CPU hitch in effect-heavy exchanges.
    const curves = useMemo(() => cachedElementVolumeCurves(kind, phase, curveCount), [curveCount, kind, phase]);
    // Ordinary contacts already own curved element volumes, particles, body
    // posing and camera response. The extruded hero cards are reserved for a
    // true signature set piece; layering them onto buffs, hits or dashes created
    // fighter-sized opaque wedges that read as broken model geometry.
    const heroStrokes = useMemo(
        () => phase === "signature" ? cachedHeroMoveStrokes(heroStyle, quality.id) : [],
        [heroStyle, phase, quality.id],
    );
    const particleDummy = useMemo(() => new THREE.Object3D(), []);
    const sparkDummy = useMemo(() => new THREE.Object3D(), []);
    const hdrSparkColor = useMemo(() => new THREE.Color(palette.core).multiplyScalar(2.4), [palette.core]);
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
    useEffect(() => {
        if (sparks.current) sparks.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }, [sparkCount]);
    const duration = signature ? 1.86 : aftermath ? (big ? 1.34 : 1.08) : phase === "dash" ? (heroMove ? 1.02 : 0.9) : heroMove ? 0.96 : big ? 0.9 : 0.64;
    // Named abilities occupy the missing middle tier: clearly larger than a basic
    // contact, but still well below an arena-owning tsunami or tornado.
    const basePhaseScale = signature ? 1.8 : aftermath ? (big ? 1.34 : 1.04) : phase === "dash" ? (big ? 1.06 : 0.82) : big ? 1.56 : 0.98;
    const phaseScale = basePhaseScale * (heroMove ? phase === "dash" ? 1.08 : 1.28 : 1);
    const register = (material: (THREE.Material & { opacity: number }) | null, index: number, baseOpacity: number) => {
        if (!material) return;
        material.userData.baseOpacity = baseOpacity;
        materials.current[index] = material;
    };
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        // Dash contact shares the replay clock with the travelling pet, so
        // hit-stop freezes the volume on the same bright collision frame. Other
        // effects retain their wall-clock lifetime.
        const elapsed = simClock && simStartTick !== undefined
            ? (simClock.current.t - simStartTick) / DUEL_TPS
            : state.clock.elapsedTime - start.current - delay;
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
        const sparkMesh = sparks.current;
        if (sparkMesh) {
            for (let index = 0; index < sparkCount; index++) {
                const delayed = Math.max(0, Math.min(1, (p - (index % 4) * 0.018) / 0.38));
                const angle = index * 2.399 + heading + (index % 2) * 0.22;
                const radius = delayed * (0.54 + (index % 4) * 0.16) * (signature ? 1.8 : big ? 1.25 : 1);
                sparkDummy.position.set(Math.sin(angle) * radius, 0.22 + delayed * (0.42 + (index % 3) * 0.16), Math.cos(angle) * radius);
                sparkDummy.rotation.set(-0.18 + (index % 3) * 0.13, angle, angle * 0.18);
                const sparkFade = Math.max(0, 1 - delayed);
                sparkDummy.scale.set(sparkFade, sparkFade, (0.65 + (index % 3) * 0.22) * sparkFade);
                sparkDummy.updateMatrix();
                sparkMesh.setMatrixAt(index, sparkDummy.matrix);
            }
            sparkMesh.instanceMatrix.needsUpdate = true;
        }
        if (sparkMat.current) sparkMat.current.opacity = Math.max(0, Math.min(1, p / 0.06, (0.46 - p) / 0.18)) * (signature ? 0.96 : 0.78);
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
                    <meshToonMaterial ref={(material) => register(material, coreMaterialIndex, aftermath ? 0.38 : phase === "dash" ? (heroMove ? 0.42 : 0.54) : heroMove ? 0.68 : 0.88)} color={palette.body} emissive={palette.accent} emissiveIntensity={signature ? 0.26 : 0.12} transparent opacity={0} depthWrite={kind === "earth"} />
                </mesh>
                {!aftermath && kind !== "earth" && (
                    <mesh scale={kind === "water" ? [0.78, 0.52, 0.72] : [0.62, 0.62, 0.62]}>
                        {coreShape}
                        <meshToonMaterial ref={(material) => register(material, coreMaterialIndex + 1, phase === "dash" ? (heroMove ? 0.28 : 0.4) : heroMove ? 0.48 : 0.74)} color={palette.core} emissive={palette.accent} emissiveIntensity={0.24} transparent opacity={0} depthWrite={false} />
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

            {kind === "earth" && Array.from({ length: earthSpireCount }, (_, index) => {
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

            {sparkCount > 0 && (
                <instancedMesh ref={sparks} args={[undefined, undefined, sparkCount]} frustumCulled={false} renderOrder={38}>
                    <boxGeometry args={[0.035, 0.035, signature ? 0.92 : 0.68]} />
                    <meshBasicMaterial ref={sparkMat} color={hdrSparkColor} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </instancedMesh>
            )}

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



/** A low, persistent element-specific floor mark. It records where decisive
 * contacts happened without adding another translucent volume around a pet. */
export function DuelElementDecal({ at, kind, color, size }: { at: Vec3; kind: DuelElementBurstKind; color: string; size: number }) {
    const palette = useMemo(() => duelFxPalette(kind, color), [kind, color]);
    const shardCount = kind === "earth" ? 7 : kind === "lightning" ? 6 : kind === "fire" || kind === "abyss" ? 5 : 3;
    return (
        <group position={at} scale={size}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-2}>
                <circleGeometry args={[0.5, 36]} />
                <meshBasicMaterial color={palette.dark} transparent opacity={kind === "water" || kind === "wind" ? 0.18 : 0.3} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
                <ringGeometry args={[kind === "water" ? 0.29 : 0.34, kind === "water" ? 0.32 : 0.38, 40]} />
                <meshBasicMaterial color={palette.accent} transparent opacity={0.42} depthWrite={false} toneMapped={false} />
            </mesh>
            {(kind === "water" || kind === "wind" || kind === "arcane") && (
                <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 4]} renderOrder={0}>
                    <ringGeometry args={[0.17, 0.195, 36, 1, 0.25, kind === "wind" ? Math.PI * 1.35 : Math.PI * 2]} />
                    <meshBasicMaterial color={palette.core} transparent opacity={0.46} depthWrite={false} toneMapped={false} />
                </mesh>
            )}
            {(kind === "earth" || kind === "lightning" || kind === "fire" || kind === "abyss") && Array.from({ length: shardCount }, (_, index) => {
                const angle = index * (Math.PI * 2 / shardCount) + (index % 2) * 0.18;
                return (
                    <mesh key={`decal-shard-${index}`} position={[Math.sin(angle) * 0.25, 0.008, Math.cos(angle) * 0.25]} rotation={[0, angle, 0]} renderOrder={0}>
                        <boxGeometry args={[index % 2 ? 0.026 : 0.038, 0.012, 0.34 + (index % 3) * 0.08]} />
                        <meshBasicMaterial color={index % 3 === 0 ? palette.core : palette.accent} transparent opacity={kind === "earth" ? 0.42 : 0.58} depthWrite={false} toneMapped={false} />
                    </mesh>
                );
            })}
        </group>
    );
}



export function DuelSupportEffect({ at, color, kind, actorId, duel, clock, onDone }: { at: Vec3; color: string; kind: DuelSupportKind; actorId?: string; duel: DuelResult; clock: { current: DuelClock }; onDone: () => void }) {
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
export function DuelMeleeTrail({ at, toward, kind, color, weight = "basic", heroStyle = "generic", native = false, onDone }: {
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
export function DuelPowerUpAura({ at, color, quality, actorId, duel, clock, heroStyle = "generic", onDone }: { at: Vec3; color: string; quality: PetVisualQualityConfig; actorId?: string; duel: DuelResult; clock: { current: DuelClock }; heroStyle?: PetHeroMoveStyle; onDone: () => void }) {
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



/** A pressure volume rather than two floor decals: the leading edge is a short
 * vertical wall with lifted arena debris, while a thin floor rim only anchors
 * it to the point of contact. */
export function DuelShockwaveV2({ at, color, big, quality, onDone }: { at: Vec3; color: string; big: boolean; quality: PetVisualQualityConfig; onDone: () => void }) {
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
