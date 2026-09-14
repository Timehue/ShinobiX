// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { lerp } from "../../lib/pet-coliseum-scene";
import { DUEL_TPS } from "../../lib/pet-duel-sim";
import { type PetVisualQualityConfig } from "../../lib/pet-visual-quality";
import { type DuelClock, FLOOR_Y } from "./stage";
import { type DuelWeatherCue } from "./duel-stage";



function weatherHash(index: number, salt: number): number {
    const n = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return n - Math.floor(n);
}



function weatherCycle(value: number): number {
    return ((value % 1) + 1) % 1;
}



function makeWeatherBoltGeometry(index: number): THREE.TubeGeometry {
    const points = Array.from({ length: 9 }, (_, point) => {
        const u = point / 8;
        const fork = point === 0 || point === 8 ? 0 : (weatherHash(index * 11 + point, 9) - 0.5) * (0.72 - Math.abs(u - 0.5) * 0.44);
        return new THREE.Vector3(
            (index - 1) * 4.4 + fork,
            7.4 - u * (5.4 + index * 0.35),
            -3.5 + index * 1.7 + (weatherHash(point, index + 4) - 0.5) * 0.42,
        );
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.026 + index * 0.005, 5, false);
}



/** Arena-wide climate volume. Unlike a contact burst, this owns the sky, fog,
 * light, floor and airborne particles for a full combat phrase. It reads only
 * the replay clock and never changes simulation state or elemental damage. */
export function DuelBattlefieldWeather({ cue, clock, quality, onDone }: {
    cue: DuelWeatherCue;
    clock: { current: DuelClock };
    quality: PetVisualQualityConfig;
    onDone: () => void;
}) {
    const weatherFog = useRef<THREE.Fog>(null);
    const particleMesh = useRef<THREE.InstancedMesh>(null);
    const particleMat = useRef<THREE.MeshBasicMaterial>(null);
    const cloudRoot = useRef<THREE.Group>(null);
    const cloudMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const skyMat = useRef<THREE.MeshBasicMaterial>(null);
    const floorMat = useRef<THREE.MeshBasicMaterial>(null);
    const weatherLight = useRef<THREE.DirectionalLight>(null);
    const flashLight = useRef<THREE.PointLight>(null);
    const boltMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const eclipse = useRef<THREE.Group>(null);
    const eclipseMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const completed = useRef(false);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const { kind, color, fog, particle } = cue.weather;
    const count = quality.id === "low" ? 28 : quality.id === "medium" ? 58 : 92;
    // Hashing is deterministic but needlessly expensive when repeated for every
    // particle on every frame. Cache the authored distribution once per quality
    // tier so the weather budget is spent on motion, not pseudo-random setup.
    const particleSeeds = useMemo(() => Array.from({ length: count }, (_, index) => ({
        x: weatherHash(index, 1),
        z: weatherHash(index, 2),
        phase: weatherHash(index, 3),
        variance: weatherHash(index, 7),
    })), [count]);
    const neutralFogColor = useMemo(() => new THREE.Color("#2a1c10"), []);
    const weatherFogColor = useMemo(() => new THREE.Color(fog), [fog]);
    const particleGeometry = useMemo<THREE.BufferGeometry>(() => {
        if (kind === "thunderstorm" || kind === "downpour") return new THREE.BoxGeometry(kind === "downpour" ? 0.025 : 0.018, kind === "downpour" ? 0.62 : 0.46, 0.018);
        if (kind === "gale") return new THREE.TorusGeometry(0.16, 0.026, 4, 10, Math.PI * 1.25);
        if (kind === "firestorm") return new THREE.ConeGeometry(0.075, 0.34, 5);
        if (kind === "blizzard") return new THREE.OctahedronGeometry(0.09, 0);
        return new THREE.IcosahedronGeometry(0.065, 0);
    }, [kind]);
    const bolts = useMemo(() => kind === "thunderstorm" ? [0, 1, 2].map(makeWeatherBoltGeometry) : [], [kind]);
    useEffect(() => () => {
        particleGeometry.dispose();
        bolts.forEach((geometry) => geometry.dispose());
    }, [bolts, particleGeometry]);
    useEffect(() => {
        const mesh = particleMesh.current;
        if (!mesh) return;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const base = new THREE.Color(particle);
        for (let index = 0; index < count; index++) {
            const tint = index % 5 === 0 ? base.clone().lerp(new THREE.Color("#ffffff"), 0.72) : base;
            mesh.setColorAt(index, tint);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, [count, particle]);
    useFrame((state) => {
        const tick = clock.current.t;
        const age = tick - cue.startTick;
        const remaining = cue.endTick - tick;
        const enter = Math.max(0, Math.min(1, age / Math.max(1, DUEL_TPS * 0.7)));
        const leave = Math.max(0, Math.min(1, remaining / Math.max(1, DUEL_TPS * 1.05)));
        const strength = Math.min(enter * enter * (3 - 2 * enter), leave * leave * (3 - 2 * leave));
        const elapsed = state.clock.elapsedTime;
        const stormPulse = kind === "thunderstorm"
            ? Math.pow(Math.max(0, Math.sin(elapsed * 1.73 + 0.8) + Math.sin(elapsed * 0.47) * 0.42 - 0.82) / 0.6, 2)
            : 0;
        const mesh = particleMesh.current;
        if (mesh) for (let index = 0; index < count; index++) {
            const seed = particleSeeds[index];
            const hx = seed.x, hz = seed.z, hs = seed.phase;
            if (kind === "thunderstorm" || kind === "downpour") {
                const fall = weatherCycle(hs - elapsed * (kind === "downpour" ? 0.62 : 0.48) * (0.72 + seed.variance * 0.48));
                dummy.position.set((hx - 0.5) * 23 + elapsed * (kind === "downpour" ? -0.9 : -0.42), 0.22 + fall * 9.2, (hz - 0.5) * 15 - 1.6);
                dummy.rotation.set(0, 0, kind === "downpour" ? -0.24 : -0.12);
                dummy.scale.set(0.72 + hs * 0.55, 0.72 + hs * 0.78, 0.72 + hs * 0.55);
            } else if (kind === "gale") {
                const radius = 1.8 + hx * 9.2;
                const angle = hz * Math.PI * 2 + elapsed * (0.72 + hs * 0.58) + Math.sin(elapsed * 0.7 + index) * 0.18;
                dummy.position.set(Math.cos(angle) * radius, 0.35 + weatherCycle(hs + elapsed * 0.12) * 5.6, -1.5 + Math.sin(angle) * radius * 0.58);
                dummy.rotation.set(Math.PI / 2, -angle, angle * 0.24);
                dummy.scale.setScalar(0.68 + hs * 0.72);
            } else if (kind === "firestorm") {
                const rising = weatherCycle(hs + elapsed * (0.18 + hz * 0.2));
                const drift = Math.sin(elapsed * 1.7 + index * 1.91);
                dummy.position.set((hx - 0.5) * 22 + drift * 0.8, 0.16 + rising * 7.3, (hz - 0.5) * 14 - 1.1);
                dummy.rotation.set(index * 0.7, elapsed * (1.2 + hs), drift * 0.32);
                dummy.scale.setScalar(0.62 + hs * 1.12);
            } else if (kind === "blizzard") {
                const fall = weatherCycle(hs - elapsed * (0.12 + hz * 0.1));
                const drift = elapsed * 1.8 + index * 0.77;
                dummy.position.set((hx - 0.5) * 23 + Math.sin(drift) * 1.3, 0.2 + fall * 8.4, (hz - 0.5) * 15 - 1.3 + Math.cos(drift * 0.72) * 0.9);
                dummy.rotation.set(drift * 0.5, drift, -drift * 0.32);
                dummy.scale.setScalar(0.58 + hs * 0.92);
            } else {
                const radius = 1.8 + hx * 9.5;
                const angle = hz * Math.PI * 2 + elapsed * (0.18 + hs * 0.18);
                dummy.position.set(Math.cos(angle) * radius, 0.5 + weatherCycle(hs + elapsed * 0.055) * 6.6, -1.6 + Math.sin(angle) * radius * 0.62);
                dummy.rotation.set(angle, -angle * 0.7, elapsed + index);
                dummy.scale.setScalar(0.56 + hs * 0.88);
            }
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
        }
        if (mesh) mesh.instanceMatrix.needsUpdate = true;
        if (particleMat.current) particleMat.current.opacity = strength * (kind === "downpour" ? 0.66 : kind === "blizzard" ? 0.82 : 0.72);
        if (cloudRoot.current) {
            cloudRoot.current.visible = strength > 0.002;
            cloudRoot.current.rotation.y = elapsed * (kind === "gale" ? 0.085 : 0.018);
            cloudRoot.current.position.x = Math.sin(elapsed * 0.18) * (kind === "gale" ? 1.2 : 0.35);
        }
        cloudMats.current.forEach((material, index) => {
            if (material) material.opacity = strength * (kind === "blizzard" ? 0.28 : kind === "eclipse" ? 0.42 : 0.56) * (0.84 + (index % 3) * 0.08);
        });
        if (skyMat.current) skyMat.current.opacity = strength * (kind === "blizzard" ? 0.17 : kind === "gale" ? 0.24 : 0.42);
        if (floorMat.current) floorMat.current.opacity = strength * (kind === "blizzard" ? 0.22 : kind === "downpour" ? 0.2 : 0.12);
        if (weatherLight.current) weatherLight.current.intensity = strength * (kind === "blizzard" ? 1.2 : 0.76) + stormPulse * strength * 2.8;
        if (flashLight.current) flashLight.current.intensity = stormPulse * strength * 12;
        boltMats.current.forEach((material, index) => {
            if (material) material.opacity = strength * stormPulse * (index === 1 ? 0.96 : 0.54);
        });
        if (eclipse.current) {
            eclipse.current.rotation.z = elapsed * -0.035;
            eclipse.current.scale.setScalar((0.88 + strength * 0.12) * (0.98 + Math.sin(elapsed * 1.5) * 0.025));
            eclipse.current.visible = strength > 0.002;
        }
        eclipseMats.current.forEach((material) => {
            if (material) material.opacity = strength * Number(material.userData.baseOpacity ?? 0);
        });
        const liveFog = weatherFog.current;
        if (liveFog) {
            liveFog.color.copy(neutralFogColor).lerp(weatherFogColor, strength * (kind === "blizzard" ? 0.72 : 0.86));
            liveFog.near = lerp(26, kind === "blizzard" ? 9 : kind === "downpour" ? 13 : 16, strength);
            liveFog.far = lerp(54, kind === "blizzard" ? 31 : kind === "downpour" ? 37 : 42, strength);
        }
        if (tick > cue.endTick + 2 && !completed.current) {
            completed.current = true;
            onDone();
        }
    });

    const canopyColor = kind === "blizzard" ? "#b9d5e7" : kind === "firestorm" ? "#26100b" : kind === "eclipse" ? "#130d22" : "#111827";
    return (
        <>
            <fog ref={weatherFog} attach="fog" args={["#2a1c10", 26, 54]} />
            <group>
            <mesh scale={34} renderOrder={-6}>
                <sphereGeometry args={[1, 24, 14]} />
                <meshBasicMaterial ref={skyMat} color={fog} transparent opacity={0} depthWrite={false} side={THREE.BackSide} />
            </mesh>
            <group ref={cloudRoot} position={[0, 7.2, -2]}>
                {Array.from({ length: quality.id === "low" ? 6 : 10 }, (_, index) => {
                    const angle = index * 2.399;
                    const radius = 2.2 + (index % 4) * 2.45;
                    return (
                        <mesh key={`weather-cloud-${index}`} position={[Math.cos(angle) * radius, (index % 3) * 0.32, Math.sin(angle) * radius * 0.58]} scale={[3.2 + (index % 3) * 0.8, 0.52 + (index % 2) * 0.18, 2.1 + (index % 4) * 0.38]}>
                            <dodecahedronGeometry args={[1, 1]} />
                            <meshBasicMaterial ref={(material) => { cloudMats.current[index] = material; }} color={canopyColor} transparent opacity={0} depthWrite={false} />
                        </mesh>
                    );
                })}
            </group>
            <mesh position={[0, FLOOR_Y + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-3}>
                <circleGeometry args={[22, 64]} />
                <meshBasicMaterial ref={floorMat} color={color} transparent opacity={0} depthWrite={false} blending={THREE.NormalBlending} />
            </mesh>
            <instancedMesh ref={particleMesh} args={[particleGeometry, undefined, count]} frustumCulled={false} renderOrder={24}>
                <meshBasicMaterial ref={particleMat} color="#ffffff" vertexColors transparent opacity={0} depthWrite={false} toneMapped={false} />
            </instancedMesh>
            {bolts.map((geometry, index) => (
                <mesh key={`weather-bolt-${index}`} geometry={geometry} renderOrder={25}>
                    <meshBasicMaterial ref={(material) => { boltMats.current[index] = material; }} color={index === 1 ? "#ffffff" : "#bca9ff"} transparent opacity={0} depthWrite={false} toneMapped={false} />
                </mesh>
            ))}
            {kind === "eclipse" && (
                <Billboard position={[0, 6.8, -12]}>
                    <group ref={eclipse} visible={false}>
                        {/* Layered corona: a low, broad aura behind the occluding
                            disc, two hot rims, and sparse radial prominences. */}
                        <mesh position={[0, 0, -0.06]}>
                            <circleGeometry args={[2.82, 64]} />
                            <meshBasicMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.14; eclipseMats.current[0] = material; } }} color="#7658d9" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                        </mesh>
                        <mesh position={[0, 0, -0.045]}>
                            <ringGeometry args={[2.08, 2.62, 72]} />
                            <meshBasicMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.28; eclipseMats.current[1] = material; } }} color="#9c7cff" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                        </mesh>
                        {Array.from({ length: 8 }, (_, index) => {
                            const angle = index * Math.PI / 4;
                            return (
                                <mesh key={`eclipse-ray-${index}`} position={[Math.cos(angle) * 2.72, Math.sin(angle) * 2.72, -0.07]} rotation={[0, 0, Math.PI / 2 - angle]} scale={[1, 0.72 + (index % 3) * 0.2, 1]}>
                                    <planeGeometry args={[0.13 + (index % 2) * 0.035, 1.05]} />
                                    <meshBasicMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.11 + (index % 3) * 0.025; eclipseMats.current[4 + index] = material; } }} color={index % 2 ? "#c9b6ff" : "#8768ee"} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                                </mesh>
                            );
                        })}
                        <mesh>
                            <circleGeometry args={[2.08, 64]} />
                            <meshBasicMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.985; eclipseMats.current[2] = material; } }} color="#08060d" transparent opacity={0} toneMapped={false} />
                        </mesh>
                        <mesh position={[0, 0, -0.02]}>
                            <ringGeometry args={[2.1, 2.28, 72]} />
                            <meshBasicMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.92; eclipseMats.current[3] = material; } }} color="#d4c5ff" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                        </mesh>
                    </group>
                </Billboard>
            )}
            <directionalLight ref={weatherLight} position={[-5, 9, 2]} color={kind === "blizzard" ? "#e5f5ff" : color} intensity={0} />
            <pointLight ref={flashLight} position={[0, 7, -1]} color="#dcd7ff" intensity={0} distance={28} decay={1.4} />
            </group>
        </>
    );
}
