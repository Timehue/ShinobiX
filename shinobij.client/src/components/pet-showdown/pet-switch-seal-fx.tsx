import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SceneBeat } from "../PetShowdownBattle";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
};

/** Two physical Beast Seals make the switch legible: one draws the outgoing
 *  companion into its paper, then a second arrives and releases the reserve
 *  into that exact field mark. The server switch remains authoritative. */
export function PetSwitchSealFx({ beatRef, reducedMotion }: {
    beatRef: React.MutableRefObject<SceneBeat>;
    reducedMotion: boolean;
}) {
    const root = useRef<THREE.Group>(null);
    const outgoingScroll = useRef<THREE.Sprite>(null);
    const outgoingMaterial = useRef<THREE.SpriteMaterial>(null);
    const incomingScroll = useRef<THREE.Sprite>(null);
    const incomingMaterial = useRef<THREE.SpriteMaterial>(null);
    const ground = useRef<THREE.Mesh>(null);
    const groundMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const orbit = useRef<THREE.Group>(null);
    const orbitMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const upperOrbit = useRef<THREE.Group>(null);
    const upperMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const beam = useRef<THREE.Mesh>(null);
    const beamMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const burst = useRef<THREE.Mesh>(null);
    const burstMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const trail = useRef<THREE.Mesh>(null);
    const trailMaterial = useRef<THREE.MeshBasicMaterial>(null);
    const sparks = useRef<THREE.Points>(null);
    const sparksMaterial = useRef<THREE.PointsMaterial>(null);
    const light = useRef<THREE.PointLight>(null);

    const sealTexture = useMemo(() => {
        const texture = new THREE.TextureLoader().load("/items/beast-seal-reinforced.webp");
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }, []);
    useEffect(() => () => sealTexture.dispose(), [sealTexture]);

    const trailGeometry = useMemo(() => {
        const source = new THREE.Vector3(-3.05, 3.95, 1.15);
        const end = new THREE.Vector3(0, 4.1, .2);
        const control = source.clone().lerp(end, .5).add(new THREE.Vector3(0, .6, 0));
        const curve = new THREE.QuadraticBezierCurve3(source, control, end);
        return new THREE.TubeGeometry(curve, 32, .018, 6, false);
    }, []);
    useEffect(() => () => trailGeometry.dispose(), [trailGeometry]);

    const sparksGeometry = useMemo(() => {
        const positions = new Float32Array(72 * 3);
        for (let index = 0; index < 72; index++) {
            const angle = index * 2.399963;
            const radius = .42 + ((index * 37) % 71) / 71 * .86;
            positions[index * 3] = Math.cos(angle) * radius;
            positions[index * 3 + 1] = .2 + ((index * 29) % 83) / 83 * 1.75;
            positions[index * 3 + 2] = Math.sin(angle) * radius;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        return geometry;
    }, []);
    useEffect(() => () => sparksGeometry.dispose(), [sparksGeometry]);

    useFrame(() => {
        const beat = beatRef.current;
        const event = beat.event;
        if (!event || event.t !== "switch") {
            if (root.current) root.current.visible = false;
            return;
        }
        const cue = beat.switches?.get(event.inId) ?? beat.switches?.get(event.outId);
        if (!cue) {
            if (root.current) root.current.visible = false;
            return;
        }

        const t = clamp01((performance.now() - beat.startedAt) / Math.max(1, beat.durationMs));
        const [x, y, z] = cue.position;
        const side = event.side === "player" ? -1 : 1;
        const handoff = event.reinforcement ? .17 : .56;
        const inboundFlight = smooth((t - handoff) / (event.reinforcement ? .28 : .2));
        const releaseAt = handoff + (event.reinforcement ? .3 : .22);
        const releaseFadeStart = event.reinforcement ? .69 : .91;
        const release = smooth((t - releaseAt) / .18);
        const trailFade = smooth((t - handoff) / .08) * (1 - smooth((t - releaseAt - .09) / .12));
        const captureGlow = event.reinforcement ? 0 : smooth(t / .11) * (1 - smooth((t - .42) / .1));
        const releaseGlow = smooth((t - releaseAt) / .08) * (1 - smooth((t - releaseFadeStart) / .08));
        const glow = Math.max(captureGlow, releaseGlow);

        if (root.current) {
            root.current.visible = t < 1;
            root.current.position.set(x, y, z);
        }

        if (outgoingScroll.current && outgoingMaterial.current) {
            // Bring the capture seal over the pet early, so the first beam
            // contact reads as an absorb instead of a pillar beside it.
            const arrive = smooth(t / .05);
            const seal = smooth((t - .2) / .28);
            const launch = smooth((t - .5) / .12);
            const fold = smooth((t - .34) / .12);
            outgoingScroll.current.visible = !event.reinforcement && t < .64;
            outgoingScroll.current.position.set(
                side * 1.15 * (1 - arrive),
                3.35 + arrive * .55 + seal * .2 + launch * (1.6 + 2.5 * launch),
                .18 + .06 * Math.sin(arrive * Math.PI),
            );
            const scrollPulse = reducedMotion ? 1 : 1 + Math.sin(t * 15) * .025;
            const flightScale = 1 - launch * .62;
            // Cinch the paper shut as the companion disappears, then carry the
            // closed seal upward for a few frames before it fades.
            outgoingScroll.current.scale.set(
                1.65 * flightScale * (1 - fold * .78) * scrollPulse,
                1.65 * flightScale * scrollPulse,
                1,
            );
            outgoingMaterial.current.rotation = reducedMotion ? 0 : side * (.2 + arrive * .22 - launch * .5);
            outgoingMaterial.current.opacity = event.reinforcement ? 0 : smooth(t / .06) * (1 - smooth((t - .53) / .1));
        }

        if (incomingScroll.current && incomingMaterial.current) {
            const sourceX = -side * 3.05;
            const sourceZ = 1.15;
            const arc = reducedMotion ? 0 : Math.sin(inboundFlight * Math.PI) * .24;
            incomingScroll.current.visible = t >= handoff && t < .98;
            incomingScroll.current.position.set(
                THREE.MathUtils.lerp(sourceX, 0, inboundFlight),
                THREE.MathUtils.lerp(3.9, 4.1, inboundFlight) + arc,
                THREE.MathUtils.lerp(sourceZ, .2, inboundFlight),
            );
            const openProgress = smooth((t - (releaseAt - .14)) / .14);
            const openPulse = releaseGlow * .28;
            const scale = (reducedMotion ? 1 : .92 + .12 * Math.sin(inboundFlight * Math.PI)) * (1 + openPulse);
            incomingScroll.current.scale.set(
                1.65 * scale * (reducedMotion ? 1 : .22 + .78 * openProgress),
                1.65 * scale,
                1,
            );
            incomingMaterial.current.rotation = reducedMotion ? 0 : -side * (.42 * (1 - inboundFlight) - release * .16);
            incomingMaterial.current.opacity = smooth((t - handoff) / .07) * (1 - smooth((t - releaseFadeStart) / .07));
        }

        if (ground.current && groundMaterial.current) {
            ground.current.visible = t < .97;
            ground.current.scale.setScalar(.52 + glow * .3 + releaseGlow * .14);
            ground.current.rotation.z = reducedMotion ? 0 : t * 2.8;
            groundMaterial.current.color.set(releaseGlow > captureGlow ? "#9bffe2" : "#f5d591");
            groundMaterial.current.opacity = reducedMotion ? .12 : glow * (.14 + releaseGlow * .17);
        }
        if (orbit.current && orbitMaterial.current) {
            orbit.current.rotation.set(Math.PI / 2 + .1, reducedMotion ? 0 : t * 5.2, .08);
            orbit.current.position.y = .84 + captureGlow * .44 + releaseGlow * .62;
            orbit.current.scale.setScalar(.9 + glow * .14);
            orbitMaterial.current.opacity = reducedMotion ? .14 : glow * .34;
            orbitMaterial.current.color.set(releaseGlow > captureGlow ? "#a3ffe5" : "#f5d591");
        }
        if (upperOrbit.current && upperMaterial.current) {
            upperOrbit.current.rotation.set(Math.PI / 2 - .2, reducedMotion ? 0 : -t * 4.4, -.16);
            upperOrbit.current.position.y = 1.46 + releaseGlow * .48;
            upperOrbit.current.scale.setScalar(.78 + glow * .12);
            upperMaterial.current.opacity = reducedMotion ? .08 : glow * .3;
        }
        if (beam.current && beamMaterial.current) {
            const linkedScroll = captureGlow > releaseGlow ? outgoingScroll.current : incomingScroll.current;
            // Keep one continuous energy tether between the pet and the
            // camera-facing seal. A vertical pillar under the scroll detached
            // as soon as the scroll flew in from the wing; aim the tapered
            // beam from the field mark to the scroll's glyph instead.
            const tetherStart = new THREE.Vector3(0, .32, 0);
            const tetherEnd = linkedScroll?.position.clone() ?? new THREE.Vector3(0, 4.1, .2);
            tetherEnd.y += .16; // cross the seal plane so its paper masks the join
            const tetherAxis = tetherEnd.sub(tetherStart);
            const tetherLength = Math.max(.12, tetherAxis.length());
            beam.current.position.copy(tetherStart).addScaledVector(tetherAxis, .5);
            beam.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tetherAxis.normalize());
            beam.current.visible = !reducedMotion && (captureGlow > .01 || releaseGlow > .01 || trailFade > .01);
            beam.current.scale.set(1.12 + glow * .08, tetherLength / 2.35, 1.12 + glow * .08);
            beamMaterial.current.color.set(releaseGlow > captureGlow ? "#c7fff0" : "#f5d591");
            beamMaterial.current.opacity = reducedMotion ? 0 : Math.max(glow * .2, trailFade * .13);
        }
        if (burst.current && burstMaterial.current) {
            burst.current.visible = !reducedMotion && releaseGlow > .01;
            burst.current.scale.setScalar(.45 + releaseGlow * 5.2);
            burstMaterial.current.opacity = releaseGlow * .72;
        }
        if (trail.current && trailMaterial.current) {
            trail.current.visible = !reducedMotion && trailFade > .01;
            trail.current.scale.x = side;
            trailMaterial.current.opacity = trailFade * .46;
            trailMaterial.current.color.set(releaseGlow > 0 ? "#a5ffe5" : "#f5d591");
        }
        if (sparks.current && sparksMaterial.current) {
            sparks.current.rotation.y = reducedMotion ? 0 : t * 3.6;
            sparks.current.position.y = releaseGlow * .42;
            sparksMaterial.current.opacity = reducedMotion ? 0 : glow * .62;
        }
        if (light.current) light.current.intensity = reducedMotion ? .35 : glow * (1.5 + releaseGlow * 2.4);

        if (light.current) light.current.position.set(0, 2.1, 0);
        if (sparks.current) sparks.current.visible = !reducedMotion && t < .98;
        if (root.current && t >= 1) root.current.visible = false;
    });

    return <group ref={root}>
        <mesh ref={trail} visible={false} geometry={trailGeometry}>
            <meshBasicMaterial ref={trailMaterial} color="#f5d591" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <sprite ref={outgoingScroll} visible={false} scale={[1.4, 1.4, 1]}>
            <spriteMaterial ref={outgoingMaterial} map={sealTexture} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </sprite>
        <sprite ref={incomingScroll} visible={false} scale={[1.4, 1.4, 1]}>
            <spriteMaterial ref={incomingMaterial} map={sealTexture} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </sprite>
        <pointLight ref={light} color="#c4ffe7" intensity={0} distance={8} decay={2} position={[0, 2.1, 0]} />
        <mesh ref={ground} rotation={[-Math.PI / 2, 0, 0]} position={[0, .08, 0]}>
            <ringGeometry args={[.82, .9, 72]} />
            <meshBasicMaterial ref={groundMaterial} color="#f5d591" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <group ref={orbit} position={[0, .84, 0]}>
            <mesh><torusGeometry args={[1.02, .018, 8, 90]} /><meshBasicMaterial ref={orbitMaterial} color="#f5d591" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
        </group>
        <group ref={upperOrbit} position={[0, 1.46, 0]}>
            <mesh><torusGeometry args={[.76, .014, 8, 90]} /><meshBasicMaterial ref={upperMaterial} color="#a3ffe5" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
        </group>
        <mesh ref={beam} position={[0, 1.9, 0]} visible={false}>
            <cylinderGeometry args={[.68, 1.22, 2.35, 32, 1, true]} />
            <meshBasicMaterial ref={beamMaterial} color="#c7fff0" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh ref={burst} rotation={[-Math.PI / 2, 0, 0]} position={[0, .12, 0]} visible={false}>
            <ringGeometry args={[.78, .9, 64]} />
            <meshBasicMaterial ref={burstMaterial} color="#fff1bb" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <points ref={sparks} geometry={sparksGeometry}>
            <pointsMaterial ref={sparksMaterial} color="#c7ffe1" size={.07} sizeAttenuation transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
        </points>
    </group>;
}
