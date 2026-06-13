/*
 * SectorScene3DScene — the lazy react-three-fiber half of the sector depth pass
 * (gated by <SectorScene3D>). Turns the flat painted biome into a shallow 3D
 * diorama you parallax through as you walk.
 *
 * HOW (and why it's $0): the biome image is mapped onto a subdivided plane that
 * is *displaced* by a depth map derived procedurally in-browser — a vertical
 * gradient (bottom = near, top = far) with a little per-scene relief from the
 * image's own luminance. No AI generation, no new assets. The camera glides
 * with the player's grid position (`focus`) plus a gentle idle drift, so near
 * parts of the scene parallax against far parts. A tinted haze plane + a
 * vignette (CSS) finish the atmosphere. Real AI depth maps can replace the
 * procedural one later for more relief.
 *
 * Unlit on purpose: the painting already has its lighting baked in, so the plane
 * uses emissiveMap (color black + emissive white = the texture shown flat),
 * which also keeps three's colour-space + displacement pipeline correct.
 */
import { useEffect, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Biome } from "../types/core";

const CAM_Z = 10;       // camera distance
const FOV = 45;
const OVERSHOOT = 1.5;  // plane is bigger than the view so parallax never reveals an edge
const AMP = 0.5;        // how far the camera travels across the grid (world units)
const DISPLACE = 0.7;   // depth relief (world units toward the camera)
const GRID_W = 12;

// Atmospheric haze tint per biome (light = distance haze).
const HAZE: Record<Biome, string> = {
    snow: "#e6f2ff",
    volcano: "#f3a972",
    shadow: "#c2aee6",
    forest: "#cfeecf",
    central: "#fff0c8",
};

// A procedural depth map for the backdrop: bottom of the scene reads as near,
// the top as far, with a little extra relief from the image's own luminance.
// Reading pixels can throw on a cross-origin (tainted) image — fall back to the
// pure vertical gradient if so.
// Downsample the source image and return its pixel data, or null if reading is
// blocked (a cross-origin / tainted canvas).
function sampleSource(ctx: CanvasRenderingContext2D, img: CanvasImageSource, N: number): Uint8ClampedArray | null {
    try {
        ctx.drawImage(img, 0, 0, N, N);
        return ctx.getImageData(0, 0, N, N).data;
    } catch {
        return null;
    }
}

function buildDepthTexture(img: CanvasImageSource): THREE.CanvasTexture {
    const N = 80;
    const c = document.createElement("canvas");
    c.width = N;
    c.height = N;
    const ctx = c.getContext("2d");
    const lum = ctx ? sampleSource(ctx, img, N) : null;
    if (ctx) {
        const out = ctx.createImageData(N, N);
        for (let y = 0; y < N; y++) {
            const vert = y / (N - 1); // 0 at top (far) → 1 at bottom (near)
            for (let x = 0; x < N; x++) {
                const i = (y * N + x) * 4;
                let d = vert;
                if (lum) {
                    const L = (0.299 * lum[i] + 0.587 * lum[i + 1] + 0.114 * lum[i + 2]) / 255;
                    d = vert * 0.8 + L * 0.2;
                }
                const v = Math.max(0, Math.min(1, d)) * 255;
                out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
                out.data[i + 3] = 255;
            }
        }
        ctx.putImageData(out, 0, 0);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace; // displacement reads raw values, not colour
    tex.needsUpdate = true;
    return tex;
}

// A soft vertical haze gradient (tinted, fades out toward the ground) drawn to a
// canvas and shown on a transparent plane in front of the backdrop.
function buildHazeTexture(color: string): THREE.CanvasTexture {
    const w = 4;
    const h = 128;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (ctx) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        const col = new THREE.Color(color);
        const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
        g.addColorStop(0, `rgba(${rgb},0.42)`);
        g.addColorStop(0.55, `rgba(${rgb},0.06)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function Backdrop({ image, biome, focus, depth }: { image: string; biome: Biome; focus: number; depth?: string }) {
    // Load the colour painting and, when present, a baked AI depth map together.
    const urls = useMemo(() => (depth ? [image, depth] : [image]), [image, depth]);
    const textures = useTexture(urls);
    const colorSrc = textures[0];
    const depthSrc = depth ? textures[1] : null;
    const { size } = useThree();

    // Clone the loaded textures so we can set their colour space without mutating
    // the shared (hook-owned) results; dispose our clones on unmount.
    const colorTex = useMemo(() => {
        const t = colorSrc.clone();
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        return t;
    }, [colorSrc]);

    // Prefer the baked AI depth map (raw values, not colour); otherwise derive a
    // procedural depth from the painting itself.
    const depthTex = useMemo(() => {
        if (depthSrc) {
            const t = depthSrc.clone();
            t.colorSpace = THREE.NoColorSpace;
            t.needsUpdate = true;
            return t;
        }
        return buildDepthTexture(colorSrc.image as CanvasImageSource);
    }, [depthSrc, colorSrc]);

    const hazeTex = useMemo(() => buildHazeTexture(HAZE[biome]), [biome]);
    useEffect(() => () => { colorTex.dispose(); depthTex.dispose(); hazeTex.dispose(); }, [colorTex, depthTex, hazeTex]);

    // Plane sized to fill the view (plus overshoot) at the backdrop's depth.
    const visH = 2 * CAM_Z * Math.tan((FOV * Math.PI) / 180 / 2);
    const visW = visH * (size.width / Math.max(1, size.height));
    const pw = visW * OVERSHOOT;
    const ph = visH * OVERSHOOT;

    useFrame((state) => {
        // r3f always invokes the latest callback, so `focus` here is current.
        const col = focus % GRID_W;
        const row = Math.floor(focus / GRID_W);
        const drift = Math.sin(state.clock.elapsedTime * 0.25) * 0.12;
        const tx = ((col - 5.5) / 5.5) * AMP + drift;
        const ty = -((row - 5.5) / 5.5) * AMP * 0.6;
        const cam = state.camera;
        cam.position.x += (tx - cam.position.x) * 0.05;
        cam.position.y += (ty - cam.position.y) * 0.05;
        cam.position.z = CAM_Z;
        cam.lookAt(0, 0, 0);
    });

    return (
        <group>
            <mesh>
                <planeGeometry args={[pw, ph, 64, 64]} />
                <meshStandardMaterial
                    color="#000000"
                    emissive="#ffffff"
                    emissiveMap={colorTex}
                    displacementMap={depthTex}
                    displacementScale={DISPLACE}
                    roughness={1}
                    metalness={0}
                    fog={false}
                />
            </mesh>
            <mesh position={[0, 0, 3]} renderOrder={1}>
                <planeGeometry args={[pw, ph]} />
                <meshBasicMaterial map={hazeTex} transparent depthWrite={false} />
            </mesh>
        </group>
    );
}

export default function SectorScene3DScene({ image, biome, focus, depth }: { image: string; biome: Biome; focus: number; depth?: string }) {
    return (
        <Canvas
            className="sector-scene-3d-canvas"
            dpr={[1, 1.5]}
            camera={{ position: [0, 0, CAM_Z], fov: FOV, near: 0.1, far: 100 }}
            gl={{ alpha: true, antialias: false, powerPreference: "low-power" }}
            frameloop="always"
        >
            <Backdrop image={image} biome={biome} focus={focus} depth={depth} />
        </Canvas>
    );
}
