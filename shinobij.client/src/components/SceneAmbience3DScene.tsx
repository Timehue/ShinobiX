/*
 * SceneAmbience3DScene — the actual react-three-fiber layer for the "living
 * sector" depth field. Lazy-loaded by SceneAmbience3D so three.js only ships
 * when a scene that uses it mounts.
 *
 * It renders a soft, slowly-drifting cloud of glowing depth-particles with real
 * perspective (size-attenuated, so near motes are big and far motes are tiny —
 * genuine parallax depth behind the flat 2D ambience). Colour keys off biome.
 * Non-interactive, transparent canvas, capped DPR for mobile.
 */
import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Biome } from "../types/core";

const BIOME_COLOR: Record<Biome, string> = {
    snow: "#cfe8ff",
    volcano: "#ff8a3d",
    shadow: "#c9a2ff",
    forest: "#bff7c2",
    central: "#ffe9a6",
};

const COUNT = 150;
const SPREAD_X = 14;
const SPREAD_Y = 9;
const SPREAD_Z = 9;

// Deterministic pseudo-random in [0,1) from an integer seed — pure (sin/floor),
// so it's safe to call during render (unlike Math.random, which the React purity
// lint rule forbids). Stable seeding also means no hydration/re-render surprises.
const seeded = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function DepthMotes({ biome }: { biome: Biome }) {
    const ref = useRef<THREE.Points>(null);

    const { geometry, velocities } = useMemo(() => {
        const positions = new Float32Array(COUNT * 3);
        const vel = new Float32Array(COUNT);
        for (let i = 0; i < COUNT; i++) {
            positions[i * 3] = (seeded(i * 4 + 1) - 0.5) * SPREAD_X;
            positions[i * 3 + 1] = (seeded(i * 4 + 2) - 0.5) * SPREAD_Y;
            positions[i * 3 + 2] = (seeded(i * 4 + 3) - 0.5) * SPREAD_Z;
            vel[i] = 0.15 + seeded(i * 4 + 4) * 0.5;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        return { geometry: geo, velocities: vel };
    }, []);

    const material = useMemo(() => {
        const tex = makeGlowTexture();
        return new THREE.PointsMaterial({
            size: 0.5,
            map: tex,
            color: new THREE.Color(BIOME_COLOR[biome] ?? "#ffffff"),
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
        });
    }, [biome]);

    useFrame((_, dt) => {
        const pts = ref.current;
        if (!pts) return;
        const pos = pts.geometry.getAttribute("position") as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        const d = Math.min(dt, 0.05);
        for (let i = 0; i < COUNT; i++) {
            // gentle upward + sideways drift, recycle at the top
            arr[i * 3 + 1] += velocities[i] * d;
            arr[i * 3] += Math.sin((arr[i * 3 + 2] + arr[i * 3 + 1]) * 0.5) * 0.06 * d * 6;
            if (arr[i * 3 + 1] > SPREAD_Y / 2) {
                arr[i * 3 + 1] = -SPREAD_Y / 2;
                arr[i * 3] = (Math.random() - 0.5) * SPREAD_X;
            }
        }
        pos.needsUpdate = true;
        pts.rotation.y += d * 0.02;
    });

    return <points ref={ref} geometry={geometry} material={material} />;
}

/** Soft round radial-gradient sprite so each point reads as a glowing orb. */
function makeGlowTexture(): THREE.Texture {
    const s = 64;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
}

export default function SceneAmbience3DScene({ biome }: { biome: Biome }) {
    return (
        <Canvas
            dpr={[1, 1.5]}
            camera={{ position: [0, 0, 7], fov: 60 }}
            gl={{ alpha: true, antialias: false, powerPreference: "low-power" }}
            style={{ background: "transparent" }}
            frameloop="always"
        >
            <DepthMotes biome={biome} />
        </Canvas>
    );
}
