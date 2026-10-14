import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { petCollarVisual } from '../data/pet-config';
import { petCollarPreviewColor } from '../lib/pet-yard-interactions';

let glowTexture: THREE.DataTexture | undefined;
function auraTexture() {
    if (glowTexture) return glowTexture;
    const size = 32, pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const radius = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1);
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
        pixels[i + 3] = Math.round(Math.max(0, 1 - radius) ** 2 * 255);
    }
    glowTexture = new THREE.DataTexture(pixels, size, size);
    glowTexture.minFilter = glowTexture.magFilter = THREE.LinearFilter;
    glowTexture.needsUpdate = true;
    return glowTexture;
}

/** Catalog collars are glow auras. One tiny shared gradient and two unlit
 * surfaces preview them without bloom, lights, shadows or another skeleton. */
export function PetCollarAura({ collarId, timeline, haloVisible = true }: { collarId: string; timeline: { current: number }; haloVisible?: boolean }) {
    const glow = petCollarVisual(collarId);
    const ring = useRef<THREE.MeshBasicMaterial>(null), halo = useRef<THREE.SpriteMaterial>(null);
    useFrame(() => {
        if (!glow?.prismatic) return;
        ring.current?.color.setHSL((timeline.current * .09) % 1, .85, .63);
        halo.current?.color.copy(ring.current?.color ?? halo.current.color);
    });
    if (!glow) return null;
    // A paused viewer may render only the mount frame. Give the rainbow collar
    // a colored starting state before its first animation callback.
    const color = glow.prismatic ? '#f17070' : petCollarPreviewColor(glow.glow);
    return <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .005, 0]}>
            <ringGeometry args={[1.14, 1.28, 48]} />
            <meshBasicMaterial ref={ring} color={color} transparent opacity={.7} depthWrite={false} />
        </mesh>
        {haloVisible && <sprite position={[0, 1.1, -.5]} scale={[3.2, 3.2, 1]}>
            <spriteMaterial ref={halo} color={color} map={auraTexture()} transparent opacity={.4} depthWrite={false} />
        </sprite>}
    </group>;
}
