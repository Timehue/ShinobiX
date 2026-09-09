// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { projectileVisual } from "../../lib/pet-projectile-vfx";
import { lerp } from "../../lib/pet-coliseum-scene";
import { DUEL_TPS } from "../../lib/pet-duel-sim";
import { type PetVisualQualityConfig } from "../../lib/pet-visual-quality";
import { type DuelClock, FLOOR_Y, type Vec3 } from "./stage";
import { type DuelDashCue, dashPathPoint, dashCueTravelProgress, type DuelElementBurstKind } from "./duel-stage";
import { duelFxPalette, makeDashRibbonGeometry, makeAnimeStrokeGeometry, makeDashContactGeometry, makePressureStreamGeometry } from "./duel-resources";
import { DuelElementVolume } from "./duel-element-effects";
import { NativeProjectileBody } from "./duel-projectiles";



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



/** The dash collision stack is simulation-clocked, so hit-stop freezes it on
 * its brightest contact frame. Directional shards continue the attack vector,
 * a compressed core shows body-on-body force, and two floor impulses make the
 * arena itself answer the blow. */
function DuelDashCollision({ cue, clock, quality }: {
    cue: DuelDashCue;
    clock: { current: DuelClock };
    quality: PetVisualQualityConfig;
}) {
    const root = useRef<THREE.Group>(null);
    const core = useRef<THREE.Mesh>(null);
    const coreMat = useRef<THREE.MeshBasicMaterial>(null);
    const ringMeshes = useRef<Array<THREE.Mesh | null>>([]);
    const ringMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const crackMeshes = useRef<Array<THREE.Mesh | null>>([]);
    const crackMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const shards = useRef<THREE.InstancedMesh>(null);
    const shardMat = useRef<THREE.MeshToonMaterial>(null);
    const light = useRef<THREE.PointLight>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const palette = useMemo(() => duelFxPalette(cue.kind, cue.color), [cue.color, cue.kind]);
    const shardCount = quality.id === "low" ? 8 : quality.id === "medium" ? 16 : 24;
    const shardGeometry = useMemo(() => cue.kind === "earth"
        ? new THREE.DodecahedronGeometry(0.12, 0)
        : cue.kind === "wind"
            ? new THREE.ConeGeometry(0.055, 0.52, 5)
            : new THREE.TetrahedronGeometry(0.13, 0), [cue.kind]);
    const dx = cue.impactAt[0] - cue.to[0], dz = cue.impactAt[2] - cue.to[2];
    const heading = Math.atan2(dx, dz);
    useEffect(() => () => shardGeometry.dispose(), [shardGeometry]);
    useEffect(() => {
        const mesh = shards.current;
        if (!mesh) return;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let index = 0; index < shardCount; index++) {
            mesh.setColorAt(index, new THREE.Color(index % 4 === 0 ? palette.core : index % 2 ? palette.accent : palette.body));
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, [palette, shardCount]);
    useFrame(() => {
        const ageTicks = clock.current.t - cue.contactTick;
        const age = ageTicks / DUEL_TPS;
        const active = cue.impact && age >= 0 && age <= 0.92;
        if (root.current) root.current.visible = active;
        if (!active) return;
        const p = Math.min(1, age / 0.92);
        const hit = 1 - Math.pow(1 - Math.min(1, p / 0.16), 4);
        const fade = p < 0.46 ? 1 : Math.max(0, 1 - (p - 0.46) / 0.54);
        const compression = 0.55 + Math.sin(Math.PI * Math.min(1, p / 0.34)) * 0.76;
        if (root.current) root.current.rotation.y = heading;
        if (core.current) {
            core.current.scale.set(1.25 + hit * 0.52, 0.62 + compression * 0.32, 0.7 + compression * 0.2);
            core.current.rotation.set(p * 1.4, p * 2.1, -0.18 + p * 0.34);
        }
        if (coreMat.current) coreMat.current.opacity = fade * (0.5 + hit * 0.5);
        ringMeshes.current.forEach((ring, index) => {
            if (!ring) return;
            const delay = index * 0.06;
            const waveP = Math.max(0, Math.min(1, (p - delay) / Math.max(0.01, 1 - delay)));
            const scale = 0.42 + waveP * (index === 0 ? 2.6 : 3.55);
            ring.scale.set(scale, scale, scale);
            ring.rotation.z = index * 0.72 + waveP * (index ? -0.42 : 0.3);
            if (ringMats.current[index]) ringMats.current[index]!.opacity = fade * (1 - waveP) * (index === 0 ? 0.9 : 0.62);
        });
        crackMeshes.current.forEach((crack, index) => {
            if (!crack) return;
            const u = index / Math.max(1, crackMeshes.current.length);
            const angle = u * Math.PI * 2 + (index % 2 ? 0.14 : -0.12);
            const reach = hit * (0.72 + (index % 3) * 0.28);
            crack.position.set(Math.sin(angle) * reach, 0.016, Math.cos(angle) * reach);
            crack.rotation.set(-Math.PI / 2, 0, -angle + (index % 2 ? 0.18 : -0.16));
            crack.scale.set(0.08 + hit * 0.05, 0.5 + hit * (0.82 + (index % 3) * 0.26), 1);
            if (crackMats.current[index]) crackMats.current[index]!.opacity = fade * 0.74;
        });
        const shardMesh = shards.current;
        if (shardMesh) for (let index = 0; index < shardCount; index++) {
            const angle = index * 2.399 + (index % 4 - 1.5) * 0.12;
            const travel = Math.max(0, Math.min(1, (p - index * 0.006) / 0.74));
            const forward = 0.25 + travel * (1.18 + (index % 4) * 0.24);
            const lateral = Math.sin(angle) * travel * (0.72 + (index % 3) * 0.14);
            dummy.position.set(lateral, 0.42 + Math.sin(Math.PI * travel) * (0.48 + (index % 3) * 0.18), Math.cos(angle) * 0.26 + forward);
            dummy.rotation.set(travel * (4.2 + index * 0.16), angle, -travel * (3.8 + index * 0.12));
            dummy.scale.set(0.66 + (index % 3) * 0.13, 0.9 + travel * 0.55, 0.66 + (index % 2) * 0.14);
            dummy.updateMatrix();
            shardMesh.setMatrixAt(index, dummy.matrix);
        }
        if (shardMesh) shardMesh.instanceMatrix.needsUpdate = true;
        if (shardMat.current) shardMat.current.opacity = fade * 0.94;
        if (light.current) light.current.intensity = fade * Math.sin(Math.PI * Math.min(1, p * 1.7)) * 8.5;
    });
    return (
        <group ref={root} position={[cue.impactAt[0], FLOOR_Y + 0.025, cue.impactAt[2]]} visible={false}>
            <mesh ref={core} position={[0, 0.82, 0.05]} renderOrder={38}>
                <icosahedronGeometry args={[0.48, 1]} />
                <meshBasicMaterial ref={coreMat} color={palette.core} transparent opacity={0} depthWrite={false} toneMapped={false} />
            </mesh>
            {[0, 1].map((index) => (
                <mesh key={`dash-impulse-${index}`} ref={(mesh) => { ringMeshes.current[index] = mesh; }} position={[0, 0.018 + index * 0.014, 0]} rotation={[-Math.PI / 2, 0, index * 0.72]} renderOrder={36}>
                    <ringGeometry args={[0.34 + index * 0.08, 0.47 + index * 0.08, quality.id === "low" ? 28 : 52]} />
                    <meshBasicMaterial ref={(material) => { ringMats.current[index] = material; }} color={index === 0 ? palette.core : palette.accent} transparent opacity={0} depthWrite={false} toneMapped={false} />
                </mesh>
            ))}
            {Array.from({ length: quality.id === "low" ? 5 : 8 }, (_, index) => (
                <mesh key={`dash-crack-${index}`} ref={(mesh) => { crackMeshes.current[index] = mesh; }} renderOrder={35}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial ref={(material) => { crackMats.current[index] = material; }} color={index % 3 === 0 ? palette.accent : palette.dark} transparent opacity={0} depthWrite={false} blending={THREE.NormalBlending} />
                </mesh>
            ))}
            <instancedMesh ref={shards} args={[shardGeometry, undefined, shardCount]} frustumCulled={false} renderOrder={39}>
                <meshToonMaterial ref={shardMat} color="#ffffff" vertexColors emissive={palette.accent} emissiveIntensity={0.28} transparent opacity={0} depthWrite={cue.kind === "earth"} />
            </instancedMesh>
            <pointLight ref={light} position={[0, 1.05, 0]} color={palette.accent} intensity={0} distance={7.5} decay={2} />
        </group>
    );
}



/** Elemental dash renderer used by the 3D duel. The path is still the authored
 * S-step used by the model, but its wake is now a chain of lit 3D element motes
 * and its arrival is the same volumetric contact system as every other move. */
export function DuelDashEffectV2({ cue, clock, quality, onDone }: { cue: DuelDashCue; clock: { current: DuelClock }; quality: PetVisualQualityConfig; onDone: () => void }) {
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
    // A trail is punctuation, never a second fighter-sized silhouette. Earlier
    // hero multipliers stacked four half-body ribbons, oversized motes, two
    // contact tubes and a `big` element volume; from the portrait camera this
    // became the long cyan/red wedge that hid both animals.
    const ribbonOuter = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.72, (impact ? 0.28 : 0.19) * (heroDash ? 1.15 : 1)), [cue, impact, heroDash]);
    const ribbonInner = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.73, (impact ? 0.105 : 0.075) * (heroDash ? 1.2 : 1)), [cue, impact, heroDash]);
    const ribbonLeft = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.7, (impact ? 0.08 : 0.06) * (heroDash ? 1.1 : 1), impact ? -0.29 : -0.22), [cue, impact, heroDash]);
    const ribbonRight = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.7, (impact ? 0.08 : 0.06) * (heroDash ? 1.1 : 1), impact ? 0.29 : 0.22), [cue, impact, heroDash]);
    const contactOuter = useMemo(() => makeDashContactGeometry(cue, heroDash ? 0.16 : 0.13, -0.7), [cue, heroDash]);
    const contactInner = useMemo(() => makeDashContactGeometry(cue, heroDash ? 0.068 : 0.055, 0.55), [cue, heroDash]);
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
    const moteCount = quality.id === "low" ? (heroDash ? 4 : 3) : quality.id === "medium" ? (heroDash ? (impact ? 8 : 7) : impact ? 7 : 5) : heroDash ? (impact ? 14 : 11) : impact ? 10 : 8;
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
        const tailSegments = impact ? 12 : 9;
        const startSegment = Math.max(0, headSegments - tailSegments);
        ribbonOuter.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        ribbonInner.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        ribbonLeft.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        ribbonRight.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        trailMats.current.forEach((material, index) => {
            if (!material) return;
            const layerOpacity = index === 0
                ? (heroDash ? 0.28 : 0.22)
                : index === 1
                    ? (heroDash ? 0.62 : 0.52)
                    : (heroDash ? 0.38 : 0.32);
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
                moteDummy.scale.setScalar((impact ? 1.18 : 0.96) * (heroDash ? 1.1 : 1) * taper * pulse);
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
    return (
        <group>
            {quality.id !== "low" && (
                <mesh geometry={ribbonOuter} renderOrder={28}>
                    <meshToonMaterial ref={(material) => { trailMats.current[0] = material; }} color={palette.dark} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            )}
            <mesh geometry={ribbonInner} renderOrder={29}>
                <meshToonMaterial ref={(material) => { trailMats.current[1] = material; }} color={palette.accent} emissive={palette.body} emissiveIntensity={0.18} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {quality.id === "high" && (
                <>
                    <mesh geometry={ribbonLeft} renderOrder={29}>
                        <meshToonMaterial ref={(material) => { trailMats.current[2] = material; }} color={palette.body} emissive={palette.accent} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={ribbonRight} renderOrder={29}>
                        <meshToonMaterial ref={(material) => { trailMats.current[3] = material; }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.1} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </>
            )}
            <instancedMesh ref={wakeMesh} args={[moteGeometry, undefined, moteCount]} frustumCulled={false} renderOrder={30}>
                <meshToonMaterial ref={wakeMat} color="#ffffff" vertexColors emissive={palette.accent} emissiveIntensity={0.14} transparent opacity={0} depthWrite={kind === "earth"} />
            </instancedMesh>
            <group ref={contactGroup} visible={false}>
                {quality.id !== "low" && (
                    <mesh geometry={contactOuter} renderOrder={34}>
                        <meshToonMaterial ref={(material) => { contactMats.current[0] = material; }} color={palette.body} emissive={palette.accent} emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} />
                    </mesh>
                )}
                <mesh geometry={contactInner} renderOrder={35}>
                    <meshToonMaterial ref={(material) => { contactMats.current[1] = material; }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.28} transparent opacity={0} depthWrite={false} />
                </mesh>
            </group>
            {impact && <DuelDashCollision cue={cue} clock={clock} quality={quality} />}
            {impact && <DuelElementVolume at={[cue.impactAt[0], FLOOR_Y + 0.08, cue.impactAt[2]]} kind={kind} color={color} big={heroDash} heading={Math.atan2(cue.impactAt[0] - cue.to[0], cue.impactAt[2] - cue.to[2])} phase="dash" quality={quality} heroStyle={style} simClock={clock} simStartTick={cue.contactTick} onDone={() => undefined} />}
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



/** Presentation-only neutral exchange rebuilt as two braided 3D energy streams.
 * The previous octahedron at center was the most obvious surviving “fake icon”
 * in the fight; this version grows through world space and throws physical
 * fragments out of its collision volume. */
export function DuelPressureClashV2({ from, to, leftColor, rightColor, leftKind, rightKind, quality, onDone }: { from: Vec3; to: Vec3; leftColor: string; rightColor: string; leftKind: DuelElementBurstKind; rightKind: DuelElementBurstKind; quality: PetVisualQualityConfig; onDone: () => void }) {
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
