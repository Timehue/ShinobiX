// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { lerp } from "../../lib/pet-coliseum-scene";
import { type DuelResult } from "../../lib/pet-duel-sim";
import { type PetVisualQualityConfig } from "../../lib/pet-visual-quality";
import { type DuelClock, FLOOR_Y, type Vec3 } from "./stage";
import { type DuelSetPieceKind, liveDuelEffectPosition, type DuelElementBurstKind } from "./duel-stage";
import { tornadoMistTexture, makeFlameRibbonGeometry, makeTornadoTube, duelFxPalette, makeAnimeStrokeGeometry, makeTornadoRibbonGeometry, TORNADO_VERTEX, TORNADO_FRAGMENT } from "./duel-resources";
import { DuelElementVolume } from "./duel-element-effects";



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



export function DuelSignatureSetPiece(props: { kind: DuelSetPieceKind; from: Vec3; to: Vec3; targetId?: string; duel: DuelResult; clock: { current: DuelClock }; color: string; quality: PetVisualQualityConfig; onDone: () => void }) {
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
