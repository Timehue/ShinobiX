import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PetCombatModelConfig } from "../lib/pet-3d-models";
import type { PetVisualQualityConfig } from "../lib/pet-visual-quality";
import type { PetModelFrame } from "./PetModel3D";

function makeRibbonGeometry(points: readonly THREE.Vector3[], width: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const t = i / Math.max(1, points.length - 1);
        const taper = width * (1 - t * 0.42);
        positions.push(p.x - taper, p.y, p.z, p.x + taper, p.y, p.z);
        uvs.push(0, t, 1, t);
        if (i < points.length - 1) {
            const a = i * 2;
            indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function makeShardGeometry(): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.46);
    shape.lineTo(0.17, 0.05);
    shape.lineTo(0.08, -0.42);
    shape.lineTo(-0.14, -0.12);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.09,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.025,
        bevelThickness: 0.025,
        curveSegments: 2,
        steps: 1,
    });
    geometry.center();
    geometry.computeVertexNormals();
    return geometry;
}

function makeTaperedTailGeometry(points: readonly THREE.Vector3[], baseRadius: number, taperPower = 1): THREE.BufferGeometry {
    const curve = new THREE.CatmullRomCurve3([...points], false, "catmullrom", 0.6);
    const rings = 17;
    const radial = 10;
    const positions: number[] = [];
    const indices: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (let ring = 0; ring < rings; ring += 1) {
        const t = ring / (rings - 1);
        const p = curve.getPoint(t);
        const tangent = curve.getTangent(t).normalize();
        const side = new THREE.Vector3().crossVectors(tangent, up);
        if (side.lengthSq() < 0.001) side.set(1, 0, 0);
        side.normalize();
        const normal = new THREE.Vector3().crossVectors(side, tangent).normalize();
        const taper = 0.03 + Math.pow(1 - t, taperPower) * 0.97;
        const radius = baseRadius * taper * (0.92 + Math.sin(t * Math.PI) * 0.08);
        for (let j = 0; j < radial; j += 1) {
            const a = (j / radial) * Math.PI * 2;
            positions.push(
                p.x + side.x * Math.cos(a) * radius + normal.x * Math.sin(a) * radius,
                p.y + side.y * Math.cos(a) * radius + normal.y * Math.sin(a) * radius,
                p.z + side.z * Math.cos(a) * radius + normal.z * Math.sin(a) * radius,
            );
        }
    }
    for (let ring = 0; ring < rings - 1; ring += 1) for (let j = 0; j < radial; j += 1) {
        const next = (j + 1) % radial;
        const a = ring * radial + j, b = ring * radial + next;
        const c = (ring + 1) * radial + j, d = (ring + 1) * radial + next;
        indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function makeRockGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const positions = geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index += 1) {
        const x = positions.getX(index);
        const y = positions.getY(index);
        const z = positions.getZ(index);
        const irregularity = 0.88 + Math.sin(x * 8.3 + y * 5.7 + z * 9.1) * 0.09;
        positions.setXYZ(index, x * 0.86 * irregularity, y * 0.68 * irregularity, z * 0.76 * irregularity);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
}

function EmberNinjaIdentity({ config, frame, quality }: {
    config: PetCombatModelConfig;
    frame: MutableRefObject<PetModelFrame>;
    quality: PetVisualQualityConfig;
}) {
    const h = config.targetHeight;
    const emberMat = useRef<THREE.PointsMaterial>(null);
    const motes = useRef<THREE.Points>(null);
    const shardRoot = useRef<THREE.Group>(null);
    const shardRefs = useRef<THREE.Mesh[]>([]);
    const tailEnergy = useRef<THREE.Mesh>(null);
    const tailEnergyMat = useRef<THREE.MeshToonMaterial>(null);
    const shardGeometry = useMemo(() => makeShardGeometry(), []);
    const tailEnergyGeometry = useMemo(() => makeRibbonGeometry([
        new THREE.Vector3(0, h * 0.34, -h * 0.28),
        new THREE.Vector3(-h * 0.03, h * 0.37, -h * 0.44),
        new THREE.Vector3(h * 0.04, h * 0.34, -h * 0.61),
        new THREE.Vector3(-h * 0.02, h * 0.3, -h * 0.78),
    ], h * 0.045), [h]);
    const motePositions = useMemo(() => {
        const count = quality.identityParticles;
        const values = new Float32Array(count * 3);
        for (let i = 0; i < count; i += 1) {
            const side = i % 2 ? 1 : -1;
            values[i * 3] = side * h * (0.08 + (i % 3) * 0.055);
            values[i * 3 + 1] = h * (0.12 + ((i * 7) % 11) * 0.04);
            values[i * 3 + 2] = -h * (0.08 + ((i * 5) % 9) * 0.045);
        }
        return values;
    }, [h, quality.identityParticles]);
    useEffect(() => () => { tailEnergyGeometry.dispose(); shardGeometry.dispose(); }, [tailEnergyGeometry, shardGeometry]);

    useFrame((state, delta) => {
        const f = frame.current;
        const t = state.clock.elapsedTime;
        const speed = Math.min(1, f.speed / 4.5);
        if (tailEnergy.current) tailEnergy.current.rotation.z = Math.sin(t * 4.2) * (0.025 + speed * 0.065);
        if (tailEnergyMat.current) tailEnergyMat.current.opacity = f.motion === "dead" ? 0 : 0.18 + speed * 0.18 + (f.casting ? 0.16 : 0);
        if (motes.current) {
            motes.current.rotation.y += delta * (0.08 + speed * 0.16);
            motes.current.position.z = THREE.MathUtils.lerp(motes.current.position.z, f.moving ? -h * 0.08 : 0, Math.min(1, delta * 5));
        }
        if (emberMat.current) emberMat.current.opacity = f.motion === "dead" ? 0 : f.casting ? 0.78 : 0.25 + speed * 0.28;
        const attackFormation = f.casting || f.motion === "windup" || f.motion === "strike";
        if (shardRoot.current) {
            shardRoot.current.rotation.y += delta * (attackFormation ? 1.15 : 0.22);
            const targetScale = f.motion === "dead" ? 0.01 : 1;
            const scaleEase = Math.min(1, delta * 7);
            shardRoot.current.scale.x = THREE.MathUtils.lerp(shardRoot.current.scale.x, targetScale, scaleEase);
            shardRoot.current.scale.y = THREE.MathUtils.lerp(shardRoot.current.scale.y, targetScale, scaleEase);
            shardRoot.current.scale.z = THREE.MathUtils.lerp(shardRoot.current.scale.z, targetScale, scaleEase);
        }
        shardRefs.current.forEach((shard, i) => {
            shard.rotation.x += delta * (0.18 + i * 0.07);
            shard.rotation.z -= delta * (0.12 + i * 0.05);
            const targetY = h * (attackFormation ? 0.48 + i * 0.045 : 0.36 + i * 0.055);
            shard.position.y = THREE.MathUtils.lerp(shard.position.y, targetY, Math.min(1, delta * 6));
        });
    });

    const shardCount = quality.id === "low" ? 1 : quality.id === "medium" ? 2 : 3;
    return (
        <group scale={0.62}>
            {/* The approved rig already contains a connected fur collar. Keep that
                authored surface visible and reserve this system for elemental
                secondary motion instead of stacking a second neck silhouette. */}
            <mesh ref={tailEnergy} geometry={tailEnergyGeometry}>
                <meshToonMaterial ref={tailEnergyMat} color="#ff5a22" emissive="#ff3d12" emissiveIntensity={0.24} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <points ref={motes} position={[0, h * 0.18, -h * 0.18]}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[motePositions, 3]} />
                </bufferGeometry>
                <pointsMaterial ref={emberMat} color="#ff8a32" size={quality.id === "high" ? 0.075 : 0.06} transparent opacity={0.28} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} sizeAttenuation />
            </points>
            <group ref={shardRoot}>
                {Array.from({ length: shardCount }, (_, i) => {
                    const side = i % 2 ? 1 : -1;
                    return (
                        <mesh
                            key={i}
                            ref={(mesh) => { if (mesh) shardRefs.current[i] = mesh; }}
                            geometry={shardGeometry}
                            position={[side * h * (0.25 + i * 0.035), h * (0.36 + i * 0.055), -h * (0.03 + i * 0.09)]}
                            rotation={[0.2 + i * 0.2, i * 0.7, side * 0.18]}
                            scale={h * (0.16 - i * 0.018)}
                            castShadow={quality.modelShadows}
                        >
                            <meshToonMaterial color={i === 0 ? "#ff4a22" : "#b8212d"} emissive="#ff6a22" emissiveIntensity={0.16} />
                        </mesh>
                    );
                })}
            </group>
        </group>
    );
}

function AquaSpiritIdentity({ config, frame, quality }: {
    config: PetCombatModelConfig;
    frame: MutableRefObject<PetModelFrame>;
    quality: PetVisualQualityConfig;
}) {
    const h = config.targetHeight;
    // The rebuilt rare Selkie owns complete seal anatomy, including its rear
    // flippers and tail. The legacy procedural tail was designed to complete the
    // old upright blob mesh; on the new body it reads as a second giant cyan sail.
    const isRareSelkie = config.visualId === "starter-water-r";
    const needsProceduralTail = !isRareSelkie;
    const ribbon = useRef<THREE.Mesh>(null);
    const bodyTail = useRef<THREE.Group>(null);
    const selkieRear = useRef<THREE.Group>(null);
    const selkieFlippers = useRef<Array<THREE.Group | null>>([]);
    const ribbonMat = useRef<THREE.MeshToonMaterial>(null);
    const droplets = useRef<THREE.Points>(null);
    const dropletMat = useRef<THREE.PointsMaterial>(null);
    const geometry = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, h * 0.22, -h * 0.08),
        new THREE.Vector3(-h * 0.06, h * 0.24, -h * 0.28),
        new THREE.Vector3(h * 0.08, h * 0.2, -h * 0.5),
        new THREE.Vector3(0, h * 0.15, -h * 0.72),
    ]), 28, h * 0.018, 6, false), [h]);
    const bodyTailGeometry = useMemo(() => makeTaperedTailGeometry([
        new THREE.Vector3(0, h * 0.36, -h * 0.01),
        new THREE.Vector3(-h * 0.07, h * 0.3, -h * 0.1),
        new THREE.Vector3(-h * 0.25, h * 0.23, -h * 0.25),
        new THREE.Vector3(-h * 0.42, h * 0.31, -h * 0.42),
    ], h * 0.155), [h]);
    const selkieTorsoGeometry = useMemo(() => {
        const torso = makeTaperedTailGeometry([
            new THREE.Vector3(0, h * 0.25, -h * 0.12),
            new THREE.Vector3(0, h * 0.22, -h * 0.34),
            new THREE.Vector3(0, h * 0.16, -h * 0.57),
            new THREE.Vector3(0, h * 0.1, -h * 0.79),
        ], h * 0.245, 0.62);
        const position = torso.getAttribute("position");
        const colors: number[] = [];
        // The reconstruction's atlas reads as a cool pearl-blue in arena light.
        // Keep the entire anatomy extension in that same coat family; the former
        // cyan rear gradient made the tail look like a separate VFX prop.
        const coat = new THREE.Color("#849b9e");
        const water = new THREE.Color("#849b9e");
        const mixed = new THREE.Color();
        for (let i = 0; i < position.count; i += 1) {
            const rearward = -position.getZ(i) / h;
            // Keep the generated white coat through the overlap. The old early
            // transition exposed a cyan triangle immediately behind the source
            // mesh and made the rear look grafted on rather than anatomical.
            const blend = THREE.MathUtils.smoothstep(rearward, 0.52, 0.92);
            mixed.copy(coat).lerp(water, blend);
            colors.push(mixed.r, mixed.g, mixed.b);
        }
        torso.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        return torso;
    }, [h]);
    const selkieHaunchGeometry = useMemo(() => {
        const haunch = new THREE.SphereGeometry(1, 24, 16);
        const position = haunch.getAttribute("position");
        const colors: number[] = [];
        const coat = new THREE.Color("#849b9e");
        const water = new THREE.Color("#849b9e");
        const mixed = new THREE.Color();
        for (let i = 0; i < position.count; i += 1) {
            const rearward = THREE.MathUtils.clamp((-position.getZ(i) + 1) * 0.5, 0, 1);
            const blend = THREE.MathUtils.smoothstep(rearward, 0.42, 0.94);
            mixed.copy(coat).lerp(water, blend);
            colors.push(mixed.r, mixed.g, mixed.b);
        }
        haunch.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        return haunch;
    }, []);
    const dropletPositions = useMemo(() => {
        const values = new Float32Array(quality.identityParticles * 3);
        for (let i = 0; i < quality.identityParticles; i += 1) {
            const a = (i / Math.max(1, quality.identityParticles)) * Math.PI * 2;
            values[i * 3] = Math.cos(a) * h * (0.22 + (i % 3) * 0.035);
            values[i * 3 + 1] = h * (0.32 + (i % 4) * 0.08);
            values[i * 3 + 2] = Math.sin(a) * h * 0.2;
        }
        return values;
    }, [h, quality.identityParticles]);
    useEffect(() => () => {
        geometry.dispose();
        bodyTailGeometry.dispose();
        selkieTorsoGeometry.dispose();
        selkieHaunchGeometry.dispose();
    }, [geometry, bodyTailGeometry, selkieTorsoGeometry, selkieHaunchGeometry]);
    useFrame((state, delta) => {
        const f = frame.current;
        const speed = Math.min(1, f.speed / 4.5);
        if (bodyTail.current) bodyTail.current.rotation.y = Math.sin(state.clock.elapsedTime * 2.7) * (0.025 + speed * 0.055);
        if (selkieRear.current) selkieRear.current.rotation.set(0, 0, 0);
        selkieFlippers.current.forEach((flipper, index) => {
            if (!flipper) return;
            const side = index === 0 ? -1 : 1;
            const stroke = Math.sin(state.clock.elapsedTime * 3.4 + index * Math.PI) * (0.025 + speed * 0.1);
            flipper.rotation.y = side * 1.02 + stroke;
            flipper.rotation.z = side * 0.12 + (f.motion === "strike" ? side * 0.07 : f.motion === "stagger" ? -side * 0.055 : 0);
        });
        if (ribbon.current) {
            ribbon.current.rotation.z = Math.sin(state.clock.elapsedTime * 3.2) * (0.025 + speed * 0.055);
            ribbon.current.scale.y = THREE.MathUtils.lerp(ribbon.current.scale.y, f.motion === "dead" ? 0.01 : 0.82 + speed * 0.35, Math.min(1, delta * 6));
        }
        if (ribbonMat.current) {
            const activeWake = f.moving || f.motion === "dash" || f.casting;
            ribbonMat.current.opacity = f.motion === "dead" || !activeWake
                ? 0
                : quality.id === "low" ? 0.08 : 0.1 + speed * 0.14 + (f.casting ? 0.12 : 0);
        }
        if (droplets.current) droplets.current.rotation.y += delta * (0.16 + speed * 0.28);
        if (dropletMat.current) dropletMat.current.opacity = f.motion === "dead" ? 0 : 0.18 + speed * 0.22 + (f.casting ? 0.22 : 0);
    });
    return (
        <group>
            {needsProceduralTail && (
                <group ref={bodyTail}>
                    {quality.outline && (
                        <mesh geometry={bodyTailGeometry} scale={1.025}>
                            <meshBasicMaterial color="#071b2b" side={THREE.BackSide} toneMapped={false} />
                        </mesh>
                    )}
                    <mesh geometry={bodyTailGeometry} castShadow={quality.modelShadows} receiveShadow={quality.modelShadows}>
                        <meshToonMaterial color="#29b8c9" emissive="#11758c" emissiveIntensity={0.13} />
                    </mesh>
                </group>
            )}
            {isRareSelkie && (
                <group ref={selkieRear}>
                    {/* Solid, low rear anatomy for the rare Selkie. These overlap
                        the reconstruction's trimmed tail seam and stay close to
                        the floor, so every angle reads as hind flippers—not a
                        floating VFX ribbon or a second body. */}
                    {quality.outline && (
                        <mesh geometry={selkieTorsoGeometry} scale={[1.035, 0.82, 1.035]}>
                            <meshBasicMaterial color="#071b2b" side={THREE.BackSide} toneMapped={false} />
                        </mesh>
                    )}
                    <mesh geometry={selkieTorsoGeometry} scale={[1, 0.79, 1]} castShadow={quality.modelShadows} receiveShadow={quality.modelShadows}>
                        <meshToonMaterial vertexColors />
                    </mesh>
                    {/* A compact coat-coloured haunch overlaps the reconstruction's
                        flat rear cut and the procedural taper. It rounds the back
                        line without recreating the oversized snowball from the
                        rejected first pass. */}
                    {quality.outline && (
                        <mesh geometry={selkieHaunchGeometry} position={[0, h * 0.23, -h * 0.18]} scale={[h * 0.252, h * 0.252, h * 0.39]}>
                            <meshBasicMaterial color="#071b2b" side={THREE.BackSide} toneMapped={false} />
                        </mesh>
                    )}
                    <mesh geometry={selkieHaunchGeometry} position={[0, h * 0.23, -h * 0.18]} scale={[h * 0.242, h * 0.242, h * 0.375]} castShadow={quality.modelShadows} receiveShadow={quality.modelShadows}>
                        <meshToonMaterial vertexColors />
                    </mesh>
                    {([-1, 1] as const).map((side) => (
                        <group
                            key={`selkie-tail-lobe-${side}`}
                            ref={(group) => { selkieFlippers.current[side < 0 ? 0 : 1] = group; }}
                            position={[side * h * 0.13, h * 0.075, -h * 0.79]}
                            rotation={[0.03, side * 1.02, side * 0.12]}
                        >
                            {quality.outline && (
                                <mesh scale={[h * 0.108, h * 0.057, h * 0.235]}>
                                    <sphereGeometry args={[1, 18, 10]} />
                                    <meshBasicMaterial color="#071b2b" side={THREE.BackSide} toneMapped={false} />
                                </mesh>
                            )}
                            <mesh scale={[h * 0.098, h * 0.049, h * 0.222]} castShadow={quality.modelShadows} receiveShadow={quality.modelShadows}>
                                <sphereGeometry args={[1, 18, 10]} />
                                <meshToonMaterial color="#849b9e" />
                            </mesh>
                        </group>
                    ))}
                </group>
            )}
            {quality.translucentLayers > 0 && (
                <mesh ref={ribbon} geometry={geometry}>
                    <meshToonMaterial ref={ribbonMat} color="#63dcf2" emissive="#159fc8" emissiveIntensity={0.16} transparent opacity={0.2} depthWrite={false} />
                </mesh>
            )}
            <points ref={droplets}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[dropletPositions, 3]} />
                </bufferGeometry>
                <pointsMaterial ref={dropletMat} color="#a7f3ff" size={quality.id === "high" ? 0.075 : 0.055} transparent opacity={0.2} depthWrite={false} toneMapped={false} sizeAttenuation />
            </points>
        </group>
    );
}

function WindRaptorIdentity({ config, frame, quality }: {
    config: PetCombatModelConfig;
    frame: MutableRefObject<PetModelFrame>;
    quality: PetVisualQualityConfig;
}) {
    const h = config.targetHeight;
    const root = useRef<THREE.Group>(null);
    const material = useRef<THREE.MeshToonMaterial>(null);
    const materialB = useRef<THREE.MeshToonMaterial>(null);
    const flowA = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(-h * 0.42, h * 0.33, -h * 0.2),
        new THREE.Vector3(-h * 0.2, h * 0.57, -h * 0.12),
        new THREE.Vector3(h * 0.16, h * 0.54, -h * 0.18),
        new THREE.Vector3(h * 0.43, h * 0.35, -h * 0.28),
    ]), 28, h * 0.012, 6, false), [h]);
    const flowB = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(h * 0.34, h * 0.23, h * 0.08),
        new THREE.Vector3(h * 0.2, h * 0.44, h * 0.18),
        new THREE.Vector3(-h * 0.12, h * 0.48, h * 0.12),
        new THREE.Vector3(-h * 0.36, h * 0.29, h * 0.02),
    ]), 24, h * 0.009, 5, false), [h]);
    useEffect(() => () => { flowA.dispose(); flowB.dispose(); }, [flowA, flowB]);
    useFrame((state, delta) => {
        const f = frame.current;
        const speed = Math.min(1, f.speed / 4.5);
        if (root.current) {
            root.current.rotation.y += delta * (0.2 + speed * 0.4);
            root.current.position.y = Math.sin(state.clock.elapsedTime * 2.4) * h * 0.015;
            root.current.scale.setScalar(f.motion === "dead" ? 0.01 : 1);
        }
        if (material.current) material.current.opacity = f.motion === "dead" ? 0 : f.casting ? 0.34 : 0.025 + speed * 0.1;
        if (materialB.current) materialB.current.opacity = f.motion === "dead" ? 0 : f.casting ? 0.24 : 0.015 + speed * 0.07;
    });
    return (
        <group ref={root}>
            <mesh geometry={flowA}>
                <meshToonMaterial ref={material} color="#9cf7df" emissive="#39d9bf" emissiveIntensity={0.15} transparent opacity={0.14} depthWrite={false} />
            </mesh>
            {quality.translucentLayers > 1 && (
                <mesh geometry={flowB}>
                    <meshToonMaterial ref={materialB} color="#d6fff3" emissive="#5eead4" emissiveIntensity={0.1} transparent opacity={0.02} depthWrite={false} />
                </mesh>
            )}
        </group>
    );
}

function LightningHoundIdentity({ config, frame, quality }: {
    config: PetCombatModelConfig;
    frame: MutableRefObject<PetModelFrame>;
    quality: PetVisualQualityConfig;
}) {
    const h = config.targetHeight;
    const root = useRef<THREE.Group>(null);
    const arcMat = useRef<THREE.MeshBasicMaterial>(null);
    const arcMatB = useRef<THREE.MeshBasicMaterial>(null);
    const arcA = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(-h * 0.3, h * 0.2, -h * 0.25), new THREE.Vector3(-h * 0.16, h * 0.4, -h * 0.17),
        new THREE.Vector3(-h * 0.03, h * 0.32, -h * 0.03), new THREE.Vector3(h * 0.12, h * 0.53, h * 0.02),
        new THREE.Vector3(h * 0.29, h * 0.4, h * 0.13),
    ]), 22, h * 0.011, 5, false), [h]);
    const arcB = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(h * 0.28, h * 0.25, -h * 0.28), new THREE.Vector3(h * 0.13, h * 0.46, -h * 0.2),
        new THREE.Vector3(0, h * 0.37, -h * 0.05), new THREE.Vector3(-h * 0.18, h * 0.58, h * 0.06),
    ]), 18, h * 0.008, 5, false), [h]);
    useEffect(() => () => { arcA.dispose(); arcB.dispose(); }, [arcA, arcB]);
    useFrame((state, delta) => {
        const f = frame.current;
        if (root.current) {
            root.current.rotation.y += delta * (f.casting ? 1.3 : 0.16);
            root.current.scale.setScalar(f.motion === "dead" ? 0.01 : 1);
        }
        if (arcMat.current) {
            const pulse = Math.abs(Math.sin(state.clock.elapsedTime * 12));
            arcMat.current.opacity = f.motion === "dead" ? 0 : f.casting ? 0.62 : f.moving ? 0.04 + pulse * 0.06 : 0;
            if (arcMatB.current) arcMatB.current.opacity = f.motion === "dead" ? 0 : f.casting ? 0.42 : f.moving ? 0.025 + pulse * 0.04 : 0;
        }
    });
    return (
        <group ref={root}>
            <mesh geometry={arcA}>
                <meshBasicMaterial ref={arcMat} color="#fff39a" transparent opacity={0.13} depthWrite={false} toneMapped={false} />
            </mesh>
            {quality.translucentLayers > 1 && (
                <mesh geometry={arcB}>
                    <meshBasicMaterial ref={arcMatB} color="#ffd51f" transparent opacity={0} depthWrite={false} toneMapped={false} />
                </mesh>
            )}
        </group>
    );
}

function EarthGuardianIdentity({ config, frame, quality }: {
    config: PetCombatModelConfig;
    frame: MutableRefObject<PetModelFrame>;
    quality: PetVisualQualityConfig;
}) {
    const h = config.targetHeight;
    const root = useRef<THREE.Group>(null);
    const rocks = useRef<THREE.Mesh[]>([]);
    const geometry = useMemo(() => makeRockGeometry(), []);
    useEffect(() => () => geometry.dispose(), [geometry]);
    useFrame((state, delta) => {
        const f = frame.current;
        if (root.current) {
            root.current.rotation.y += delta * (f.casting ? 0.9 : 0.14);
            root.current.scale.setScalar(f.motion === "dead" ? 0.01 : 1);
        }
        rocks.current.forEach((rock, index) => {
            rock.rotation.x += delta * (0.15 + index * 0.07);
            rock.rotation.z -= delta * (0.1 + index * 0.05);
            rock.position.y += Math.sin(state.clock.elapsedTime * (1.5 + index * 0.18) + index) * delta * h * 0.012;
        });
    });
    const count = quality.id === "low" ? 1 : quality.id === "medium" ? 2 : 3;
    return (
        <group ref={root}>
            {Array.from({ length: count }, (_, index) => {
                const side = index % 2 ? 1 : -1;
                return (
                    <mesh
                        key={index}
                        ref={(mesh) => { if (mesh) rocks.current[index] = mesh; }}
                        geometry={geometry}
                        position={[side * h * (0.34 + index * 0.04), h * (0.34 + index * 0.12), -h * (0.06 + index * 0.08)]}
                        scale={h * (0.075 + index * 0.012)}
                        castShadow={quality.modelShadows}
                    >
                        <meshToonMaterial color={index === 0 ? "#8b7651" : "#596a43"} emissive="#423723" emissiveIntensity={0.025} />
                    </mesh>
                );
            })}
        </group>
    );
}

/** Every avian uses a real aerial combat phrase rather than the quadruped dash
 * shorthand. The skinned `gallop_jump` clip supplies the wing beat; these restrained
 * toon air-rings and feather wakes sell lift, speed and the dive line without hiding
 * the authored bird model behind a generic gust billboard. */
function AvianDiveAccent({ config, frame, quality, elementColor }: {
    config: PetCombatModelConfig;
    frame: MutableRefObject<PetModelFrame>;
    quality: PetVisualQualityConfig;
    elementColor: string;
}) {
    const h = config.targetHeight;
    const root = useRef<THREE.Group>(null);
    const ringMaterials = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const featherMaterials = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const dashStarted = useRef(-999);
    const wasDiving = useRef(false);
    const featherCount = quality.id === "low" ? 3 : quality.id === "medium" ? 5 : 7;
    const bodyColor = useMemo(() => new THREE.Color(elementColor).lerp(new THREE.Color("#eaffff"), 0.5).getStyle(), [elementColor]);

    useFrame((state) => {
        const diving = frame.current.motion === "dash";
        if (diving && !wasDiving.current) dashStarted.current = state.clock.elapsedTime;
        wasDiving.current = diving;
        const p = THREE.MathUtils.clamp((state.clock.elapsedTime - dashStarted.current) / 0.58, 0, 1);
        const envelope = diving ? Math.sin(Math.PI * Math.min(1, p * 0.92)) : 0;
        if (root.current) {
            root.current.visible = envelope > 0.005;
            root.current.position.z = -h * (0.22 + p * 0.25);
            root.current.rotation.z = Math.sin(p * Math.PI * 2) * 0.055;
            root.current.scale.setScalar(0.78 + p * 0.5);
        }
        ringMaterials.current.forEach((material, index) => {
            if (material) material.opacity = envelope * (0.5 - index * 0.11);
        });
        featherMaterials.current.forEach((material, index) => {
            if (material) material.opacity = envelope * (0.68 - index / featherCount * 0.24);
        });
    });

    return (
        <group ref={root} position={[0, h * 0.5, -h * 0.24]} visible={false}>
            {[0, 1, 2].slice(0, quality.translucentLayers + 1).map((index) => (
                <mesh key={`avian-dive-ring-${index}`} position={[0, index * h * 0.035, -index * h * 0.14]} rotation={[0, 0, index * 0.42]} scale={0.82 + index * 0.27}>
                    <torusGeometry args={[h * 0.22, h * (0.018 - index * 0.0025), 6, 28]} />
                    <meshToonMaterial
                        ref={(material) => { ringMaterials.current[index] = material; }}
                        color={index === 0 ? "#f4ffff" : bodyColor}
                        emissive={elementColor}
                        emissiveIntensity={0.12}
                        transparent
                        opacity={0}
                        depthWrite={false}
                    />
                </mesh>
            ))}
            {Array.from({ length: featherCount }, (_, index) => {
                const side = index % 2 === 0 ? -1 : 1;
                const lane = Math.floor(index / 2);
                return (
                    <mesh
                        key={`avian-dive-feather-${index}`}
                        position={[side * h * (0.16 + lane * 0.045), (index % 3 - 1) * h * 0.065, -h * (0.12 + lane * 0.105)]}
                        rotation={[Math.PI / 2, side * 0.2, side * (0.48 + lane * 0.07)]}
                        scale={[h * 0.038, h * (0.12 + lane * 0.018), h * 0.025]}
                    >
                        <coneGeometry args={[1, 2.4, 5]} />
                        <meshToonMaterial
                            ref={(material) => { featherMaterials.current[index] = material; }}
                            color={index % 3 === 0 ? "#ffffff" : bodyColor}
                            emissive={elementColor}
                            emissiveIntensity={0.09}
                            transparent
                            opacity={0}
                            depthWrite={false}
                        />
                    </mesh>
                );
            })}
        </group>
    );
}

export function PetIdentityEffects3D({ config, frame, quality, elementColor = "#b9f6ff" }: {
    config: PetCombatModelConfig;
    frame: MutableRefObject<PetModelFrame>;
    quality: PetVisualQualityConfig;
    elementColor?: string;
}) {
    const identityVisualId = config.identityVisualId ?? config.visualId;
    const identity = identityVisualId.startsWith("starter-fire")
        ? <EmberNinjaIdentity config={config} frame={frame} quality={quality} />
        : identityVisualId.startsWith("starter-water")
            ? <AquaSpiritIdentity config={config} frame={frame} quality={quality} />
            : identityVisualId.startsWith("starter-wind")
                ? <WindRaptorIdentity config={config} frame={frame} quality={quality} />
                : identityVisualId.startsWith("starter-lightning")
                    ? <LightningHoundIdentity config={config} frame={frame} quality={quality} />
                    : identityVisualId.startsWith("starter-earth")
                        ? <EarthGuardianIdentity config={config} frame={frame} quality={quality} />
                        : null;
    return (
        <>
            {identity}
            {config.profile === "avian" && <AvianDiveAccent config={config} frame={frame} quality={quality} elementColor={elementColor} />}
        </>
    );
}
