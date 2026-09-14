// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import * as THREE from "three";
import { lerp } from "../../lib/pet-coliseum-scene";
import { type PetVisualQuality, type PetVisualQualityConfig } from "../../lib/pet-visual-quality";
import { type PetHeroMoveStyle } from "../../lib/pet-hero-moves";
import { FLOOR_Y, type Vec3 } from "./stage";
import { type DuelElementBurstKind, type DuelDashCue, dashPathPoint } from "./duel-stage";


type DuelFxPalette = { dark: string; body: string; accent: string; core: string };


export function duelFxPalette(kind: DuelElementBurstKind, fallback: string): DuelFxPalette {
    if (kind === "fire") return { dark: "#421008", body: "#d92d12", accent: "#ff7a18", core: "#ffd36a" };
    if (kind === "water") return { dark: "#042b55", body: "#0877bd", accent: "#21c7e6", core: "#d8fbff" };
    if (kind === "wind") return { dark: "#073b3d", body: "#14796f", accent: "#50d9b8", core: "#e0fff3" };
    if (kind === "lightning") return { dark: "#211047", body: "#5c38c4", accent: "#b48cff", core: "#fff3a3" };
    if (kind === "earth") return { dark: "#2c190e", body: "#754321", accent: "#ce8f38", core: "#ffe0a1" };
    if (kind === "abyss") return { dark: "#15081d", body: "#47102f", accent: "#e5224f", core: "#ffad86" };
    const base = new THREE.Color(fallback);
    return {
        dark: base.clone().multiplyScalar(0.28).getStyle(),
        body: base.clone().multiplyScalar(0.72).getStyle(),
        accent: base.getStyle(),
        core: base.clone().lerp(new THREE.Color("#fff1d4"), 0.7).getStyle(),
    };
}



/** A beveled, tapered brush stroke. These opaque silhouettes replace the flat
 * rings/orbs that made combat effects look like UI laid over sculpted pets. */
export function makeAnimeStrokeGeometry(length: number, width: number, curl: number, jagged = 0): THREE.ExtrudeGeometry {
    const steps = 24;
    const upper: THREE.Vector2[] = [];
    const lower: THREE.Vector2[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = (t - 0.18) * length;
        const tooth = jagged > 0 && i > 0 && i < steps ? (i % 2 ? 1 : -1) * jagged * (0.45 + Math.sin(Math.PI * t) * 0.55) : 0;
        const centerY = Math.sin(Math.PI * t) * curl + Math.sin(Math.PI * 2 * t) * curl * 0.16 + tooth;
        const nextT = Math.min(1, t + 1 / steps);
        const nextTooth = jagged > 0 && i < steps - 1 ? ((i + 1) % 2 ? 1 : -1) * jagged * (0.45 + Math.sin(Math.PI * nextT) * 0.55) : 0;
        const nextY = Math.sin(Math.PI * nextT) * curl + Math.sin(Math.PI * 2 * nextT) * curl * 0.16 + nextTooth;
        const tangentX = length / steps;
        const tangentY = nextY - centerY;
        const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentY));
        const nx = -tangentY / tangentLength;
        const ny = tangentX / tangentLength;
        const envelope = Math.pow(Math.sin(Math.PI * t), 0.48) * (1 - t * 0.52) + 0.018;
        const half = width * envelope;
        upper.push(new THREE.Vector2(x + nx * half, centerY + ny * half));
        lower.push(new THREE.Vector2(x - nx * half, centerY - ny * half));
    }
    const shape = new THREE.Shape();
    shape.moveTo(upper[0].x, upper[0].y);
    for (let i = 1; i < upper.length; i++) shape.lineTo(upper[i].x, upper[i].y);
    for (let i = lower.length - 1; i >= 0; i--) shape.lineTo(lower[i].x, lower[i].y);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.065, steps: 1, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.018, bevelThickness: 0.02 });
    geometry.translate(0, 0, -0.0375);
    geometry.computeVertexNormals();
    return geometry;
}



export function makeDashRibbonGeometry(cue: DuelDashCue, bodyY: number, halfHeight: number, lateralOffset = 0): THREE.BufferGeometry {
    const segments = 36;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const at = dashPathPoint(cue, t, bodyY);
        const envelope = Math.max(0.018, Math.pow(Math.sin(Math.PI * t), 0.58));
        const ahead = dashPathPoint(cue, Math.min(1, t + 1 / segments), bodyY);
        const tangentX = ahead[0] - at[0], tangentZ = ahead[2] - at[2];
        const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentZ));
        const sideX = -tangentZ / tangentLength, sideZ = tangentX / tangentLength;
        const offset = lateralOffset * envelope;
        const x = at[0] + sideX * offset, z = at[2] + sideZ * offset;
        positions.push(x, at[1] + halfHeight * envelope, z, x, at[1] - halfHeight * envelope, z);
        uvs.push(t, 1, t, 0);
        if (i < segments) {
            const n = i * 2;
            indices.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.setDrawRange(0, 0);
    return geometry;
}



/** A short, solid elemental stroke between the attacker's planted body position
 * and the defender's actual hurt point. The pets never have to overlap to sell
 * contact, and the player can read exactly where a successful dash connected. */
export function makeDashContactGeometry(cue: DuelDashCue, radius: number, lateral = 0): THREE.TubeGeometry {
    const from = new THREE.Vector3(cue.to[0], FLOOR_Y + 0.82, cue.to[2]);
    const to = new THREE.Vector3(cue.impactAt[0], FLOOR_Y + 0.86, cue.impactAt[2]);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const sideX = -dz / length;
    const sideZ = dx / length;
    const arc = Math.min(0.34, length * 0.12) * lateral;
    const middle = from.clone().lerp(to, 0.5);
    middle.x += sideX * arc;
    middle.y += 0.2 + Math.min(0.18, length * 0.04);
    middle.z += sideZ * arc;
    if (length < 0.08) to.z += 0.08;
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([from, middle, to]), 10, radius, 7, false);
}



export type DuelElementVolumePhase = "contact" | "aftermath" | "signature" | "dash";



const ELEMENT_VOLUME_CURVE_CACHE = new Map<string, readonly THREE.TubeGeometry[]>();


const HERO_MOVE_STROKE_CACHE = new Map<string, readonly THREE.ExtrudeGeometry[]>();



export function duelElementCurveCount(kind: DuelElementBurstKind, phase: DuelElementVolumePhase, big: boolean, quality: PetVisualQuality): number {
    const signature = phase === "signature";
    const low = quality === "low";
    const medium = quality === "medium";
    if (kind === "earth") return 0;
    if (kind === "water" && !signature) return low ? 2 : big ? 4 : 3;
    if (low) return signature ? 5 : 2;
    if (medium) return signature ? 7 : big ? 5 : 3;
    return signature ? 10 : big ? 7 : 5;
}



/** Curved, round-section elemental motion. These tubes catch the same arena
 * lighting as the pet models, so an ability reads as an object occupying the
 * scene instead of a flat decal composited in front of it. */
export function makeElementVolumeCurve(kind: DuelElementBurstKind, index: number, phase: DuelElementVolumePhase): THREE.TubeGeometry {
    const signature = phase === "signature";
    const aftermath = phase === "aftermath";
    const pointCount = signature ? 18 : 13;
    const points = Array.from({ length: pointCount }, (_, pointIndex) => {
        const u = pointIndex / Math.max(1, pointCount - 1);
        const angle = kind === "water" && !signature ? -0.92 + index * 0.58 : index * 2.17;
        if (kind === "water") {
            const reach = (signature ? 2.45 : aftermath ? 0.72 : 0.94) * u;
            const lift = Math.sin(Math.PI * u) * (signature ? 2.2 : aftermath ? 0.34 : 0.74);
            return new THREE.Vector3(Math.cos(angle) * reach, lift, Math.sin(angle) * reach);
        }
        if (kind === "wind") {
            const height = signature ? 3.8 : aftermath ? 0.9 : 1.72;
            const radius = (0.16 + u * (signature ? 1.35 : 0.64)) * (aftermath ? 1.25 : 1);
            const turn = angle + u * Math.PI * (signature ? 5.4 : 3.2);
            return new THREE.Vector3(Math.cos(turn) * radius, u * height, Math.sin(turn) * radius);
        }
        if (kind === "lightning") {
            const height = signature ? 4.7 : aftermath ? 1.15 : 2.05;
            const direction = signature ? 1 - u : u - 0.5;
            const jag = Math.sin((pointIndex + index * 3) * 2.37) * (signature ? 0.34 : 0.22);
            const branch = index === 0 ? 0 : u * (0.18 + index * 0.055);
            return new THREE.Vector3(jag + Math.cos(angle) * branch, direction * height, Math.cos((pointIndex + index) * 1.73) * (signature ? 0.24 : 0.16) + Math.sin(angle) * branch);
        }
        if (kind === "arcane") {
            const radius = (signature ? 1.65 : aftermath ? 0.78 : 0.92) * (0.82 + index % 3 * 0.12);
            const orbit = u * Math.PI * 1.72 + angle;
            return new THREE.Vector3(Math.cos(orbit) * radius, Math.sin(orbit) * radius * 0.58, Math.sin(orbit) * radius * 0.76);
        }
        // Fire and abyss both rise as tapered, corkscrewing plumes. Abyss is
        // made visually distinct through its palette, smoke volume and orbiting
        // embers in the renderer below rather than a separate flat glyph.
        const height = signature ? 3.45 : aftermath ? 1.05 : 1.82;
        const radius = (signature ? 0.7 : aftermath ? 0.34 : 0.44) * (1 - u * 0.72);
        const turn = angle + u * Math.PI * (signature ? 2.7 : 1.8);
        return new THREE.Vector3(Math.cos(turn) * radius, u * height, Math.sin(turn) * radius);
    });
    const radius = phase === "signature" ? 0.075 + (index % 3) * 0.012 : kind === "water" ? phase === "aftermath" ? 0.026 : 0.035 : phase === "aftermath" ? 0.043 : 0.058 + (index % 2) * 0.009;
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), signature ? 52 : 34, radius, 6, false);
}



export function cachedElementVolumeCurves(kind: DuelElementBurstKind, phase: DuelElementVolumePhase, count: number): readonly THREE.TubeGeometry[] {
    const key = `${kind}:${phase}:${count}`;
    const cached = ELEMENT_VOLUME_CURVE_CACHE.get(key);
    if (cached) return cached;
    const geometries = Object.freeze(Array.from({ length: count }, (_, index) => makeElementVolumeCurve(kind, index, phase)));
    ELEMENT_VOLUME_CURVE_CACHE.set(key, geometries);
    return geometries;
}



export function cachedHeroMoveStrokes(style: PetHeroMoveStyle, quality: PetVisualQuality): readonly THREE.ExtrudeGeometry[] {
    if (style === "generic") return [];
    const key = `${style}:${quality}`;
    const cached = HERO_MOVE_STROKE_CACHE.get(key);
    if (cached) return cached;
    const water = style.startsWith("selkie") || style === "serpentine-surge" || style === "amphibious-slide";
    const pounce = style === "kitsune-eclipse-pounce"
        || style === "selkie-tail-strike"
        || style === "quadruped-rush"
        || style === "pouncer-stalk"
        || style === "pack-hunter-pressure"
        || style === "charger-drive";
    const avian = style === "avian-dive";
    const heavy = style === "heavy-slam" || style === "armored-counter" || style === "burrow-grapple";
    const biped = style === "biped-combo";
    const count = quality === "low" ? 2 : quality === "medium" ? 3 : 4;
    const geometries = Object.freeze(Array.from({ length: count }, (_, index) => makeAnimeStrokeGeometry(
        (heavy ? 1.58 : avian ? 1.52 : water ? 1.46 : 1.34) * (1 - index * 0.12),
        (heavy ? 0.3 : pounce ? 0.24 : biped ? 0.215 : 0.19) * (1 - index * 0.08),
        (avian ? 0.86 : water ? 0.72 : heavy ? 0.6 : 0.5) * (1 - index * 0.13),
        style === "kitsune-shadow-step" || style === "avian-dive" || style === "serpentine-surge" ? 0.055 : 0,
    )));
    HERO_MOVE_STROKE_CACHE.set(key, geometries);
    return geometries;
}



export function scheduleDuelFxGeometryPrewarm(kinds: readonly DuelElementBurstKind[], quality: PetVisualQualityConfig): () => void {
    const uniqueKinds = [...new Set(kinds)];
    const tasks: Array<() => void> = [];
    for (const kind of uniqueKinds) {
        for (const phase of ["contact", "aftermath", "dash"] as const) {
            for (const big of [false, true]) {
                const count = duelElementCurveCount(kind, phase, big, quality.id);
                const key = `${kind}:${phase}:${count}`;
                if (!ELEMENT_VOLUME_CURVE_CACHE.has(key)) tasks.push(() => { cachedElementVolumeCurves(kind, phase, count); });
            }
        }
    }
    let cancelled = false;
    let timer = 0;
    const runOne = () => {
        if (cancelled) return;
        tasks.shift()?.();
        if (tasks.length) timer = window.setTimeout(runOne, 18);
    };
    // Spend the otherwise static VS/size-up beat preparing immutable effect
    // geometry in small slices, instead of compiling it on the contact frame.
    timer = window.setTimeout(runOne, 80);
    return () => {
        cancelled = true;
        window.clearTimeout(timer);
    };
}



export function makePressureStreamGeometry(from: Vec3, to: Vec3, side: number, radius: number): THREE.TubeGeometry {
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const sideX = -dz / length, sideZ = dx / length;
    const points = Array.from({ length: 30 }, (_, index) => {
        const u = index / 29;
        const braid = Math.sin(u * Math.PI * 4 + side * 0.8) * Math.sin(Math.PI * u) * 0.13;
        const bow = Math.sin(Math.PI * u) * side * 0.34;
        return new THREE.Vector3(
            lerp(from[0], to[0], u) + sideX * (bow + braid),
            lerp(from[1], to[1], u) + Math.sin(Math.PI * u) * (0.32 + Math.abs(side) * 0.08),
            lerp(from[2], to[2], u) + sideZ * (bow + braid),
        );
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, radius, 7, false);
}



function _makeWaveVolumeGeometry(): THREE.BufferGeometry {
    const sx = 30, sy = 14;
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let iy = 0; iy <= sy; iy++) {
        const v = iy / sy;
        for (let ix = 0; ix <= sx; ix++) {
            const u = ix / sx;
            const x = (u - 0.5) * 5.2;
            // A broad shoulder reads as a wall of water. The former single sharp
            // peak made the mesh look like a triangular shield from the broadcast
            // camera, especially after it was enlarged.
            const crestProfile = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.48);
            const curlShoulder = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, u * 1.18))), 1.8);
            const height = 1.12 + 1.52 * crestProfile + 0.42 * curlShoulder;
            const curl = v < 0.62 ? v * 0.18 : 0.11 + ((v - 0.62) / 0.38) * (0.72 + 0.38 * curlShoulder);
            const ripple = Math.sin(u * Math.PI * 7 + v * 3.2) * 0.055 * (0.3 + v);
            positions.push(x, 0.03 + v * height, -0.28 + curl + ripple);
            uvs.push(u, v);
        }
    }
    for (let iy = 0; iy < sy; iy++) for (let ix = 0; ix < sx; ix++) {
        const a = iy * (sx + 1) + ix, b = a + 1, c = a + sx + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}



function _makeWaveCrestGeometry(): THREE.TubeGeometry {
    const points = Array.from({ length: 13 }, (_, i) => {
        const u = i / 12;
        const x = (u - 0.5) * 5.2;
        const crestProfile = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.48);
        const curlShoulder = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, u * 1.18))), 1.8);
        return new THREE.Vector3(x, 1.16 + 1.52 * crestProfile + 0.42 * curlShoulder, 0.72 + Math.sin(u * Math.PI * 4) * 0.06);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 0.115, 7, false);
}



export function makeFlamePetalGeometry(height: number, radius: number, bend: number): THREE.BufferGeometry {
    // Enough curvature to keep the flame silhouette stylized, without the visibly
    // faceted paper-shard look from the first arena-scale burst.
    const rings = 10, sides = 10;
    const positions: number[] = [], indices: number[] = [];
    for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings;
        const rr = Math.max(0.025, radius * Math.pow(1 - t, 0.72));
        const centerZ = bend * t * t;
        for (let side = 0; side < sides; side++) {
            const a = (side / sides) * Math.PI * 2;
            positions.push(Math.cos(a) * rr, t * height, centerZ + Math.sin(a) * rr);
        }
    }
    for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
        const next = (side + 1) % sides;
        const a = ring * sides + side, b = ring * sides + next;
        const c = (ring + 1) * sides + side, d = (ring + 1) * sides + next;
        indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}



/** A tapered, curling energy tongue. Unlike a cone or a straight radial petal,
 * its centreline changes direction as it rises, so a cluster reads as flowing
 * flame/ki from every camera angle instead of a crown of rigid crystals. */
export function makeFlameRibbonGeometry(height: number, radius: number, sway: number, phase: number): THREE.BufferGeometry {
    const rings = 16, sides = 9;
    const positions: number[] = [], indices: number[] = [];
    for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings;
        const envelope = Math.pow(1 - t, 0.72) * (0.58 + Math.sin(Math.PI * t) * 0.52);
        const rr = Math.max(0.012, radius * envelope);
        const turn = phase + t * (2.4 + (phase % 0.7));
        const cx = Math.sin(turn) * sway * t * t;
        const cz = Math.cos(turn * 0.86) * sway * t * t;
        for (let side = 0; side < sides; side++) {
            const a = (side / sides) * Math.PI * 2;
            positions.push(cx + Math.cos(a) * rr, t * height, cz + Math.sin(a) * rr);
        }
    }
    for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
        const next = (side + 1) % sides;
        const a = ring * sides + side, b = ring * sides + next;
        const c = (ring + 1) * sides + side, d = (ring + 1) * sides + next;
        indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}



// The tornado mist sheet is deterministic (no args, no RNG); build it once and
// reuse it across every tornado set-piece instead of rasterizing a fresh 128x256
// canvas + a GL upload on the exact frame each cyclone spawns.
let _tornadoMistTexture: THREE.CanvasTexture | null = null;


export function tornadoMistTexture(): THREE.CanvasTexture { return (_tornadoMistTexture ??= makeTornadoMistTexture()); }


function makeTornadoMistTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128; canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const fade = ctx.createLinearGradient(0, 0, 0, canvas.height);
    fade.addColorStop(0, "rgba(218,255,248,0.72)");
    fade.addColorStop(0.45, "rgba(79,216,191,0.34)");
    fade.addColorStop(1, "rgba(11,102,100,0.02)");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fade;
    ctx.lineCap = "round";
    for (let i = 0; i < 7; i++) {
        ctx.lineWidth = 3 + (i % 3) * 1.5;
        ctx.beginPath();
        const y = 20 + i * 35;
        ctx.moveTo(-16, y + 12);
        ctx.bezierCurveTo(30, y - 18, 94, y + 28, 145, y - 7);
        ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}



export function makeTornadoTube(phase: number): THREE.TubeGeometry {
    // A fast, clean tapered spiral. Fewer turns and a thinner cross-section keep
    // the silhouette readable; the earlier dense spring plus transparent cones
    // looked like a stack of overlapping primitives from the broadcast camera.
    const points = Array.from({ length: 34 }, (_, i) => {
        const t = i / 33;
        const a = phase + t * Math.PI * 3.25;
        const radius = 0.12 + Math.pow(t, 0.72) * 1.34;
        return new THREE.Vector3(Math.cos(a) * radius, 0.08 + t * 3.8, Math.sin(a) * radius);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, 0.062, 8, false);
}



const _TSUNAMI_VERTEX = `
varying vec2 vUv;
uniform float uTime;
uniform float uBuild;
void main() {
    vUv = uv;
    vec3 p = position;
    float crest = smoothstep(0.48, 1.0, uv.y);
    float curl = crest * crest * (0.58 + 0.18 * sin(uv.x * 8.0 + uTime * 4.2));
    p.z += curl * uBuild;
    p.x += sin(uv.y * 7.0 + uTime * 3.0) * 0.08 * crest;
    p.y += sin(uv.x * 10.0 - uTime * 3.4) * 0.13 * (0.25 + crest);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;



const _TSUNAMI_FRAGMENT = `
varying vec2 vUv;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uDeep;
uniform vec3 uWater;
uniform vec3 uFoam;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
void main() {
    float edge = smoothstep(0.0, 0.07, vUv.x) * smoothstep(0.0, 0.07, 1.0 - vUv.x);
    float flow = sin(vUv.x * 18.0 - uTime * 5.2 + noise(vUv * 9.0) * 3.0) * 0.5 + 0.5;
    float foamLine = 0.91 + noise(vec2(vUv.x * 12.0, uTime * 1.8)) * 0.045;
    float foam = smoothstep(foamLine - 0.025, foamLine + 0.035, vUv.y);
    foam += smoothstep(0.7, 0.98, vUv.y) * smoothstep(0.84, 1.0, flow) * 0.24;
    vec3 body = mix(uDeep, uWater, min(0.72, vUv.y * 0.5 + flow * 0.12));
    vec3 color = mix(body, uFoam, clamp(foam, 0.0, 0.84));
    float floorFade = smoothstep(0.0, 0.16, vUv.y);
    float alpha = edge * floorFade * uOpacity * (0.74 + foam * 0.24);
    gl_FragColor = vec4(color, alpha);
}`;



export const TORNADO_VERTEX = `
varying vec2 vUv;
varying float vTwist;
uniform float uTime;
uniform float uPhase;
void main() {
    vUv = uv;
    vec3 p = position;
    float sway = (0.06 + uv.y * 0.22);
    p.x += sin(uv.y * 12.0 + uTime * 4.8 + uPhase) * sway;
    p.z += cos(uv.y * 10.0 + uTime * 4.1 + uPhase) * sway;
    vTwist = atan(p.z, p.x) + uv.y * 11.0 - uTime * 7.2 + uPhase;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;



export const TORNADO_FRAGMENT = `
varying vec2 vUv;
varying float vTwist;
uniform float uOpacity;
uniform vec3 uDark;
uniform vec3 uWind;
uniform vec3 uCore;
void main() {
    float strand = sin(vTwist * 3.2 + vUv.y * 31.0) * 0.5 + 0.5;
    float fine = sin(vTwist * 7.0 - vUv.y * 53.0) * 0.5 + 0.5;
    float bands = smoothstep(0.33, 0.83, strand) + smoothstep(0.68, 0.98, fine) * 0.48;
    float taperFade = smoothstep(0.0, 0.08, vUv.y) * smoothstep(0.0, 0.09, 1.0 - vUv.y);
    vec3 color = mix(uDark, uWind, vUv.y * 0.65 + bands * 0.2);
    color = mix(color, uCore, smoothstep(0.96, 1.34, bands));
    gl_FragColor = vec4(color, clamp(bands, 0.0, 1.0) * taperFade * uOpacity);
}`;



/** Thin flow lines sit on the water shell and make its direction readable.
 * They are accents only—the old large-radius tubes became separate rainbow-like
 * arches and made the attack feel assembled instead of like one body of water. */
function _makeTsunamiFlowLineGeometry(index: number, count: number): THREE.TubeGeometry {
    const layer = count <= 1 ? 0 : index / (count - 1);
    const width = 5.35 - layer * 0.34;
    const points = Array.from({ length: 29 }, (_, pointIndex) => {
        const u = pointIndex / 28;
        const envelope = Math.pow(Math.max(0, Math.sin(u * Math.PI)), 0.5);
        const scallop = Math.sin(u * Math.PI * (3 + index)) * 0.035 * envelope;
        const v = 0.34 + layer * 0.4;
        const curl = Math.max(0, (v - 0.62) / 0.38);
        return new THREE.Vector3(
            (u - 0.5) * width,
            0.1 + envelope * (v < 0.62 ? (v / 0.62) * 2.72 : 2.72 - Math.sin(curl * Math.PI * 0.5) * 0.56) + scallop,
            -0.42 + v * 0.52 + envelope * Math.sin(curl * Math.PI * 0.5) * 1.05 + 0.58,
        );
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.035 + layer * 0.012, 6, false);
}



/** Vertical C-shaped ribs reveal the overhanging lip even in the high broadcast
 * camera. They sit inside the translucent shell, so they read as moving currents
 * rather than a wireframe laid over the effect. */
function _makeTsunamiCurlRibGeometry(index: number, count: number): THREE.TubeGeometry {
    const across = count <= 1 ? 0 : index / (count - 1);
    const x = lerp(-2.62, 2.62, across);
    const edge = Math.sin(across * Math.PI);
    const localHeight = 1.12 + edge * 1.82 + Math.sin(across * Math.PI * 5) * 0.08;
    const points = Array.from({ length: 24 }, (_, pointIndex) => {
        const v = pointIndex / 23;
        const curlPhase = Math.max(0, (v - 0.6) / 0.4);
        const y = v < 0.6
            ? 0.08 + (v / 0.6) * localHeight * 0.9
            : localHeight * 0.9 - Math.sin(curlPhase * Math.PI * 0.5) * (0.52 + edge * 0.18);
        const z = -0.28 + v * 0.28 + Math.sin(curlPhase * Math.PI * 0.5) * (0.72 + edge * 0.48);
        return new THREE.Vector3(x, y, z);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 0.045 + edge * 0.018, 6, false);
}



function _makeTsunamiVolumeGeometry(width: number, height: number, depth: number, xSegments: number, ySegments: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const row = xSegments + 1;
    for (let side = 0; side < 2; side++) {
        const sideOffset = side * row * (ySegments + 1);
        for (let y = 0; y <= ySegments; y++) {
            const v = y / ySegments;
            for (let x = 0; x <= xSegments; x++) {
                const u = x / xSegments;
                const px = (u - 0.5) * width;
                // A broad vertical rectangle still reads like a billboard even if
                // it technically has depth. Taper the height and thickness down at
                // both shoulders, then curl the upper third forward so the outline
                // reads as a breaking mass of water from every broadcast angle.
                const envelope = 0.25 + Math.pow(Math.sin(u * Math.PI), 0.48) * 0.75 + Math.sin(u * Math.PI * 5) * 0.045;
                const curlPhase = Math.max(0, (v - 0.62) / 0.38);
                const topBreak = Math.sin(u * Math.PI * 5.0) * 0.1 * envelope;
                const localHeight = 0.38 + (height - 0.38) * envelope + topBreak;
                const belly = Math.sin(v * Math.PI);
                // Rise as a solid swell, then fold the upper third forward and
                // slightly downward. This hooked cross-section is what makes the
                // silhouette read as a breaking tsunami instead of a blue card.
                const rise = v < 0.62
                    ? (v / 0.62) * localHeight * 0.87
                    : localHeight * 0.87 - Math.sin(curlPhase * Math.PI * 0.5) * (0.48 + envelope * 0.24);
                const curl = -0.46 + v * 0.48 - belly * 0.08 + Math.sin(curlPhase * Math.PI * 0.5) * (0.5 + envelope * 0.92);
                const thickness = 0.12 + depth * (0.18 + envelope * 0.82) * (0.38 + belly * 0.62);
                positions.push(px, Math.max(0.02, rise), curl + (side === 0 ? -thickness : thickness) * 0.5);
                uvs.push(u, v);
            }
        }
        for (let y = 0; y < ySegments; y++) {
            for (let x = 0; x < xSegments; x++) {
                const a = sideOffset + y * row + x;
                const b = a + 1;
                const c = a + row;
                const d = c + 1;
                if (side === 0) indices.push(a, c, b, b, c, d);
                else indices.push(a, b, c, b, d, c);
            }
        }
    }
    const backOffset = row * (ySegments + 1);
    for (let x = 0; x < xSegments; x++) {
        const frontBottom = x;
        const backBottom = backOffset + x;
        const frontTop = ySegments * row + x;
        const backTop = backOffset + ySegments * row + x;
        indices.push(frontBottom, frontBottom + 1, backBottom, frontBottom + 1, backBottom + 1, backBottom);
        indices.push(frontTop, backTop, frontTop + 1, frontTop + 1, backTop, backTop + 1);
    }
    for (let y = 0; y < ySegments; y++) {
        const frontLeft = y * row;
        const backLeft = backOffset + y * row;
        const frontRight = y * row + xSegments;
        const backRight = backOffset + y * row + xSegments;
        indices.push(frontLeft, backLeft, frontLeft + row, frontLeft + row, backLeft, backLeft + row);
        indices.push(frontRight, frontRight + row, backRight, frontRight + row, backRight + row, backRight);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}



export function makeTornadoRibbonGeometry(index: number): THREE.TubeGeometry {
    const turns = 2.1 + index * 0.24;
    const points = Array.from({ length: 38 }, (_, i) => {
        const u = i / 37;
        const radius = 0.22 + Math.pow(u, 0.82) * (1.15 + index * 0.08);
        const a = u * Math.PI * 2 * turns + index * 1.7;
        return new THREE.Vector3(Math.cos(a) * radius, u * 3.5, Math.sin(a) * radius);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.022 + index * 0.004, 5, false);
}
