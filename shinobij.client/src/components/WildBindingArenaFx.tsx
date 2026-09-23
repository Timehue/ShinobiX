import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type WildBindingCinematic = {
    playerId: string;
    enemyId: string;
    sealId: string;
    startedAt: number;
    durationMs: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
};

/** Presentation only. The server has already decided the binding result. */
export function WildBindingArenaFx({ cinematic, player, enemy, reduced }: {
    cinematic: WildBindingCinematic;
    player: readonly [number, number, number];
    enemy: readonly [number, number, number];
    reduced: boolean;
}) {
    const [playerX, playerY, playerZ] = player;
    const [enemyX, enemyY, enemyZ] = enemy;
    const root = useRef<THREE.Group>(null);
    const scroll = useRef<THREE.Sprite>(null);
    const ground = useRef<THREE.Mesh>(null);
    const groundMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const orbit = useRef<THREE.Group>(null);
    const orbitMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const upperOrbit = useRef<THREE.Group>(null);
    const upperMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const beam = useRef<THREE.Mesh>(null);
    const beamMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const tether = useRef<THREE.Mesh>(null);
    const tetherMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const burst = useRef<THREE.Mesh>(null);
    const burstMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const sparks = useRef<THREE.Points>(null);
    const sparksMaterial = useRef<THREE.PointsMaterial>(null);
    const light = useRef<THREE.PointLight>(null);

    const sealTexture = useMemo(() => {
        const texture = new THREE.TextureLoader().load(`/items/${cinematic.sealId}.webp`);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }, [cinematic.sealId]);
    useEffect(() => () => sealTexture.dispose(), [sealTexture]);

    const tetherGeometry = useMemo(() => {
        const start = new THREE.Vector3(playerX, playerY + 1.7, playerZ);
        const end = new THREE.Vector3(enemyX, enemyY + 2.4, enemyZ);
        const control = start.clone().lerp(end, .5).add(new THREE.Vector3(0, 2.1, 0));
        return new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, control, end), 40, .014, 6, false);
    }, [playerX, playerY, playerZ, enemyX, enemyY, enemyZ]);
    useEffect(() => () => tetherGeometry.dispose(), [tetherGeometry]);

    const sparksGeometry = useMemo(() => {
        const positions = new Float32Array(96 * 3);
        for (let index = 0; index < 96; index++) {
            const angle = index * 2.399963;
            const radius = .5 + ((index * 37) % 71) / 71 * 1.45;
            positions[index * 3] = Math.cos(angle) * radius;
            positions[index * 3 + 1] = .25 + ((index * 29) % 83) / 83 * 2.8;
            positions[index * 3 + 2] = Math.sin(angle) * radius;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return geometry;
    }, []);
    useEffect(() => () => sparksGeometry.dispose(), [sparksGeometry]);

    useFrame(() => {
        const t = clamp01((performance.now() - cinematic.startedAt) / cinematic.durationMs);
        // A slow capture response can hold this scene past the last visible frame.
        // At t=1 every mesh is already faded/hidden, so skip idle VFX work.
        if (t >= 1) return;
        const summon = smooth(t / .2);
        const flight = smooth((t - .12) / .35);
        const bind = smooth((t - .47) / .36);
        const impact = smooth((t - .78) / .08) * (1 - smooth((t - .88) / .12));
        const fade = 1 - smooth((t - .83) / .12);
        if (root.current) root.current.position.set(enemy[0], enemy[1], enemy[2]);
        if (scroll.current) {
            scroll.current.visible = t < .96;
            const arc = Math.sin(flight * Math.PI) * 1.4;
            scroll.current.position.set(
                THREE.MathUtils.lerp(player[0], enemy[0], flight),
                THREE.MathUtils.lerp(player[1] + 1.8, enemy[1] + 3.15, flight) + arc,
                THREE.MathUtils.lerp(player[2], enemy[2], flight),
            );
            const scale = (reduced ? 1 : .65 + summon * .45) * (1 + impact * .38);
            scroll.current.scale.set(1.3 * scale, 1.3 * scale, 1);
            (scroll.current.material as THREE.SpriteMaterial).rotation = reduced ? 0 : (1 - flight) * -.5 + bind * .14;
            (scroll.current.material as THREE.SpriteMaterial).opacity = summon * fade;
        }
        if (ground.current && groundMaterial.current) {
            ground.current.scale.setScalar(.6 + summon * 1.9 + impact * 1.1);
            ground.current.rotation.z = t * 2.8;
            groundMaterial.current.opacity = reduced ? .25 : summon * (.2 + bind * .35) * fade;
        }
        if (orbit.current && orbitMaterial.current) {
            orbit.current.position.y = 1.05 + bind * .9;
            orbit.current.rotation.set(.2 + bind * .35, t * 5, .15);
            orbit.current.scale.setScalar(.45 + summon * .8 - bind * .48);
            orbitMaterial.current.opacity = reduced ? .3 : summon * (.32 + bind * .55) * fade;
        }
        if (upperOrbit.current && upperMaterial.current) {
            upperOrbit.current.position.y = 1.5 + bind * .85;
            upperOrbit.current.rotation.set(-.3, -t * 4.2, .5);
            upperOrbit.current.scale.setScalar(.75 + summon * .4 - bind * .55);
            upperMaterial.current.opacity = reduced ? .2 : summon * .62 * fade;
        }
        if (tether.current && tetherMaterial.current) {
            tether.current.visible = !reduced && t > .15 && t < .66;
            tetherMaterial.current.opacity = smooth((t - .15) / .12) * (1 - smooth((t - .52) / .14)) * .45;
        }
        if (beam.current && beamMaterial.current) {
            beam.current.visible = !reduced && t > .44 && t < .9;
            beam.current.scale.set(1 + bind * .75, 1, 1 + bind * .75);
            beamMaterial.current.opacity = smooth((t - .44) / .12) * (1 - smooth((t - .79) / .1)) * .22;
        }
        if (burst.current && burstMaterial.current) {
            burst.current.visible = !reduced && impact > 0;
            burst.current.scale.setScalar(.5 + impact * 5.8);
            burstMaterial.current.opacity = impact * .78;
        }
        if (sparks.current && sparksMaterial.current) {
            sparks.current.rotation.y = t * 3.5;
            sparks.current.position.y = bind * .55;
            sparksMaterial.current.opacity = reduced ? 0 : summon * (.32 + bind * .5) * fade;
        }
        if (light.current) light.current.intensity = reduced ? .9 : summon * (1 + bind * 1.6 + impact * 3.2) * fade;
    });

    return <>
        <mesh ref={tether} geometry={tetherGeometry} visible={false}>
            <meshBasicMaterial ref={tetherMaterial} color="#b5ffeb" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <sprite ref={scroll} scale={[1.5, 1.5, 1]}>
            <spriteMaterial map={sealTexture} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </sprite>
        <group ref={root}>
            <pointLight ref={light} color="#b9ffe1" intensity={0} distance={8} decay={2} position={[0, 2.1, 0]} />
            <mesh ref={ground} rotation={[-Math.PI / 2, 0, 0]} position={[0, .08, 0]}>
                <ringGeometry args={[.82, .89, 72]} />
                <meshBasicMaterial ref={groundMaterial} color="#86f4d7" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <group ref={orbit} position={[0, 1.05, 0]}>
                <mesh><torusGeometry args={[1.48, .026, 8, 90]} /><meshBasicMaterial ref={orbitMaterial} color="#f8dca0" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
            </group>
            <group ref={upperOrbit} position={[0, 1.5, 0]}>
                <mesh><torusGeometry args={[1.18, .018, 8, 90]} /><meshBasicMaterial ref={upperMaterial} color="#89ffe2" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
            </group>
            <mesh ref={beam} position={[0, 2, 0]} visible={false}>
                <cylinderGeometry args={[.07, .38, 2.5, 18, 1, true]} />
                <meshBasicMaterial ref={beamMaterial} color="#b6fff0" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh ref={burst} rotation={[-Math.PI / 2, 0, 0]} position={[0, .12, 0]} visible={false}>
                <ringGeometry args={[.78, .9, 64]} />
                <meshBasicMaterial ref={burstMaterial} color="#fff1bb" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <points ref={sparks} geometry={sparksGeometry}>
                <pointsMaterial ref={sparksMaterial} color="#c7ffe1" size={.07} sizeAttenuation transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </points>
        </group>
    </>;
}
