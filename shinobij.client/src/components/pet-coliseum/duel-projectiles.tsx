// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { projectileVisual, type ProjectileVisual } from "../../lib/pet-projectile-vfx";
import { lerp } from "../../lib/pet-coliseum-scene";
import { type DuelResult } from "../../lib/pet-duel-sim";
import { type PetVisualQualityConfig } from "../../lib/pet-visual-quality";
import { type DuelClock, FLOOR_Y, FX_Y } from "./stage";
import { duelCmdFocus } from "./playback-state";
import { ProjectileBody } from "./stage-components";
import { makeFlamePetalGeometry, makeElementVolumeCurve, makeFlameRibbonGeometry } from "./duel-resources";
import { findActor, duelFieldToFloor } from "./duel-stage";



/** Volumetric projectile used when both combatants are real models.  It is built
 * from solid toon cores, translucent energy shells and receding trail geometry,
 * so it belongs to the same lit 3D space as the pets instead of reading like a
 * flat icon pasted between them. */
export function NativeProjectileBody({ visual, quality }: { visual: ProjectileVisual; quality: PetVisualQualityConfig }) {
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
export function DuelCommandFocusMarker({ duel, clock }: { duel: DuelResult; clock: { current: DuelClock } }) {
    const group = useRef<THREE.Group>(null);
    const material = useRef<THREE.MeshBasicMaterial>(null);
    useFrame((state) => {
        const root = group.current;
        if (!root) return;
        const remaining = duelCmdFocus.expiresAt - performance.now();
        if (remaining <= 0 || !duelCmdFocus.targetId) {
            root.visible = false;
            return;
        }
        const tick = Math.max(0, Math.min(duel.snapshots.length - 1, Math.floor(clock.current.t)));
        const target = findActor(duel.snapshots[tick], duelCmdFocus.targetId);
        if (!target || target.hp <= 0) {
            root.visible = false;
            return;
        }
        const floor = duelFieldToFloor(target.x, target.y);
        const pulse = 1 + Math.sin(state.clock.elapsedTime * 15) * 0.075;
        root.visible = true;
        root.position.set(floor.wx, FLOOR_Y + 0.055, floor.wz);
        root.scale.setScalar(pulse);
        if (material.current) {
            material.current.color.set(duelCmdFocus.color);
            material.current.opacity = Math.min(0.82, remaining / 260);
        }
    });
    return (
        <group ref={group} visible={false}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.88, 0.038, 8, 48]} />
                <meshBasicMaterial ref={material} color="#fbbf24" transparent opacity={0.72} depthWrite={false} toneMapped={false} />
            </mesh>
            {[
                [0, 0, -1.03, 0],
                [0, 0, 1.03, 0],
                [-1.03, 0, 0, Math.PI / 2],
                [1.03, 0, 0, Math.PI / 2],
            ].map(([x, y, z, rotation], index) => (
                <mesh key={index} position={[x, y + 0.018, z]} rotation={[0, rotation, 0]}>
                    <boxGeometry args={[0.32, 0.035, 0.055]} />
                    <meshBasicMaterial color="#fff7d6" transparent opacity={0.88} depthWrite={false} toneMapped={false} />
                </mesh>
            ))}
        </group>
    );
}



export function DuelProjectile({ index, duel, clock, quality, native = false }: { index: number; duel: DuelResult; clock: { current: DuelClock }; quality: PetVisualQualityConfig; native?: boolean }) {
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
