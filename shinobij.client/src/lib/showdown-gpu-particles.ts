/*
 * showdown-gpu-particles — vertex-shader particle clouds for Pet Showdown.
 *
 * The CPU Points clouds top out around forty particles before the per-frame
 * attribute writes show up in profiles. These clouds move EVERYTHING to the
 * vertex shader: each particle's whole trajectory is a pure function of its
 * seed attributes and the piece clock uniform, so a thousand-droplet spray
 * costs one uniform write per frame.
 *
 * Determinism: seeds are generated once from the spawn key (mulberry32) and
 * uTime is the piece-relative clock — replays and fast-forward identical.
 */

import * as THREE from "three";

export type GpuParticleMode = "spray" | "embers" | "sparks" | "dust";

const MODE_INDEX: Record<GpuParticleMode, number> = { spray: 0, embers: 1, sparks: 2, dust: 3 };

const PARTICLE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uMode;
uniform float uRadius;
uniform float uHeight;
uniform float uSize;
attribute vec4 aSeed; // angle, radiusFrac, speed, phase
varying float vLife;

void main() {
    float angle = aSeed.x;
    float rFrac = aSeed.y;
    float speed = aSeed.z;
    float phase = aSeed.w;
    // Each particle loops its own sub-life inside the cloud's window.
    float life = fract(uTime * speed + phase);
    vLife = life;
    vec3 p = vec3(0.0);
    if (uMode < 0.5) {
        // SPRAY: ballistic — out and up, arcing down under gravity.
        float d = uRadius * rFrac * life * 1.8;
        p.x = cos(angle) * d;
        p.z = sin(angle) * d;
        p.y = 0.25 + uHeight * (life * (0.9 + rFrac * 0.8) - life * life * 1.25);
    } else if (uMode < 1.5) {
        // EMBERS: climb with wobble, drifting outward as they rise.
        float rise = life * uHeight;
        p.x = cos(angle) * uRadius * rFrac * (0.5 + life * 0.7) + sin(life * 11.0 + phase * 8.0) * 0.16;
        p.z = sin(angle) * uRadius * rFrac * (0.5 + life * 0.7) + cos(life * 9.0 + phase * 7.0) * 0.16;
        p.y = 0.15 + rise;
    } else if (uMode < 2.5) {
        // SPARKS: hard radial burst, dying fast.
        float d = uRadius * (0.15 + life * 2.2) * (0.5 + rFrac);
        p.x = cos(angle) * d;
        p.z = sin(angle) * d;
        p.y = 0.4 + sin(min(1.0, life) * 3.14159) * uHeight * rFrac * 0.8 - life * life * 0.9;
    } else {
        // DUST: low outward billow, hanging.
        float d = uRadius * rFrac * (0.3 + life * 1.4);
        p.x = cos(angle) * d;
        p.z = sin(angle) * d;
        p.y = 0.12 + sin(min(1.0, life) * 3.14159) * uHeight * (0.25 + rFrac * 0.5);
    }
    p.y = max(p.y, 0.05);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float sizeJitter = 0.55 + rFrac * 0.9;
    // uSize is authored in screen-pixel territory. The old 240 multiplier
    // expanded an 8px mote into 100–300px translucent discs in normal battle
    // shots, so particles read as cheap bokeh bubbles and covered the move.
    // Keep perspective falloff, but bound every mote to a crisp support scale.
    gl_PointSize = clamp(uSize * sizeJitter * (18.0 / max(6.0, -mv.z)), 1.5, 12.0);
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
uniform vec3 uTint;
uniform float uOpacity;
varying float vLife;

void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d) * 2.0;
    float dot = smoothstep(1.0, 0.15, r);
    // Bright young, fading out through the sub-life.
    float fade = (1.0 - smoothstep(0.55, 1.0, vLife));
    gl_FragColor = vec4(uTint, dot * fade * uOpacity);
    if (gl_FragColor.a < 0.01) discard;
}
`;

function mulberry(seed: number): () => number {
    let a = (seed >>> 0) || 1;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export interface GpuCloud {
    geometry: THREE.BufferGeometry;
    material: THREE.ShaderMaterial;
    dispose: () => void;
}

/** Build one GPU cloud. Caller mounts `<points geometry material>` and drives
 *  uTime/uOpacity through the mesh ref each frame. */
export function makeGpuCloud(opts: {
    mode: GpuParticleMode;
    count: number;
    seed: number;
    tint: string;
    radius: number;
    height: number;
    size?: number;
}): GpuCloud {
    const rand = mulberry(opts.seed);
    const geometry = new THREE.BufferGeometry();
    // Positions are computed in the shader; the attribute only needs to exist.
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(opts.count * 3), 3));
    const seeds = new Float32Array(opts.count * 4);
    for (let i = 0; i < opts.count; i++) {
        seeds[i * 4] = rand() * Math.PI * 2;
        seeds[i * 4 + 1] = 0.25 + rand() * 0.75;
        seeds[i * 4 + 2] = 0.5 + rand() * 1.4;
        seeds[i * 4 + 3] = rand();
    }
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    // The GPU positions run wider than the zeroed attribute; a huge static
    // sphere keeps frustum culling from blinking the cloud out at the edges.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, opts.height / 2, 0), opts.radius * 3 + opts.height);
    const material = new THREE.ShaderMaterial({
        vertexShader: PARTICLE_VERTEX,
        fragmentShader: PARTICLE_FRAGMENT,
        uniforms: {
            uTime: { value: 0 },
            uMode: { value: MODE_INDEX[opts.mode] },
            uRadius: { value: opts.radius },
            uHeight: { value: opts.height },
            uSize: { value: opts.size ?? 9 },
            uTint: { value: new THREE.Color(opts.tint) },
            uOpacity: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
    } as THREE.ShaderMaterialParameters & { toneMapped: boolean });
    return {
        geometry,
        material,
        dispose: () => {
            geometry.dispose();
            material.dispose();
        },
    };
}
