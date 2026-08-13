/*
 * PetShowdownVfx3d — VOLUMETRIC element set-pieces for Pet Showdown.
 *
 * The flat painted billboards read as cardboard from off-axis cameras (owner:
 * "okay from one angle and awful from another"). This layer builds each
 * element as actual 3D structure that parallaxes from EVERY angle:
 *
 *   Water     — a curved wave SHELL (open cylinder arc) that sweeps the lane
 *               and curls over the victim, scrolling water texture, spray.
 *   Fire      — a crown of flame cards ringing the victim (u-slices of the
 *               painted firewall), rising embers.
 *   Wind      — two counter-rotating open CONES with climbing spiral bands,
 *               orbiting debris.
 *   Earth     — real rock meshes (flat-shaded cones) tearing out of the
 *               ground, lit by the arena lights, dust.
 *   Lightning — a procedurally jagged 3D bolt (tube core + glow) that
 *               STROBES down onto the victim, sparks.
 *
 * Every piece also fires a transient element-colored POINT LIGHT (the single
 * biggest "it's really in the scene" tell — the pets and floor catch the
 * glow) and an expanding ground shock ring at the strike.
 *
 * Deterministic: all shapes/particles seed from spawn.key, so replays and
 * fast-forward render identically. Presentation-only, same contract as the
 * flat layer: everything derives from a server event that already happened.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { epicTexture, type SetPieceSpawn } from "./PetShowdownVfx";

// ─── Deterministic helpers ───────────────────────────────────────────────────

/** mulberry32 — same generator family the engine uses; seeded per spawn. */
function seededRand(seed: number): () => number {
    let a = (seed >>> 0) || 1;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const ELEMENT_GLOW: Record<string, string> = {
    Fire: "#ff9a4d",
    Water: "#6fd8ff",
    Wind: "#b8ffd9",
    Earth: "#e8b877",
    Lightning: "#cfe0ff",
};

/** Piece-life clock: 0..1 across the spawn, matching the flat layer. */
function pieceT(spawn: SetPieceSpawn): number {
    return (performance.now() - spawn.startedAt) / spawn.durationMs;
}

// ─── Procedural canvas textures (cached per key) ─────────────────────────────

const canvasTexCache = new Map<string, THREE.CanvasTexture>();

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
    let t = canvasTexCache.get(key);
    if (t) return t;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    draw(cv.getContext("2d")!, w, h);
    t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    canvasTexCache.set(key, t);
    return t;
}

/** Soft edge fade along the canvas Y axis — a hard texture edge on a curved
 *  mesh reads as a paper cut; a dissolve reads as the element thinning out. */
function fadeEdgesY(ctx: CanvasRenderingContext2D, w: number, h: number, frac = 0.16) {
    ctx.globalCompositeOperation = "destination-out";
    const top = ctx.createLinearGradient(0, 0, 0, h * frac);
    top.addColorStop(0, "rgba(0,0,0,1)");
    top.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, h * frac);
    const bottom = ctx.createLinearGradient(0, h * (1 - frac), 0, h);
    bottom.addColorStop(0, "rgba(0,0,0,0)");
    bottom.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = bottom;
    ctx.fillRect(0, h * (1 - frac), w, h * frac);
    ctx.globalCompositeOperation = "source-over";
}

/** Water shell: base→crest gradient along U with streaks and a foam crest. */
function waterShellTexture(): THREE.CanvasTexture {
    return canvasTexture("water-shell", 256, 256, (ctx, w, h) => {
        const rand = seededRand(7);
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, "rgba(10,60,84,0.92)");
        g.addColorStop(0.55, "rgba(23,110,140,0.95)");
        g.addColorStop(0.82, "rgba(84,196,214,0.95)");
        g.addColorStop(1, "rgba(228,250,255,0.98)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        // Flow streaks along the climb.
        for (let i = 0; i < 46; i++) {
            const y = rand() * h;
            const x = rand() * w;
            const len = 30 + rand() * 90;
            ctx.strokeStyle = `rgba(255,255,255,${0.05 + rand() * 0.12})`;
            ctx.lineWidth = 1 + rand() * 2;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + len, y + (rand() - 0.5) * 8);
            ctx.stroke();
        }
        // Foam boil at the crest edge.
        for (let i = 0; i < 130; i++) {
            const x = w - rand() * rand() * 70;
            const y = rand() * h;
            const r = 1.5 + rand() * 5;
            ctx.fillStyle = `rgba(255,255,255,${0.25 + rand() * 0.55})`;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // The shell's lane-width ends dissolve into spray instead of cutting.
        fadeEdgesY(ctx, w, h, 0.14);
    });
}

/** Vortex bands: slanted pale streaks on transparency — spiral when spun. */
function vortexBandTexture(): THREE.CanvasTexture {
    return canvasTexture("vortex-bands", 256, 256, (ctx, w, h) => {
        const rand = seededRand(11);
        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < 26; i++) {
            const y = rand() * h;
            const slant = 26 + rand() * 20;
            const thick = 3 + rand() * 9;
            const grad = ctx.createLinearGradient(0, y, w, y - slant);
            const a = 0.1 + rand() * 0.3;
            grad.addColorStop(0, "rgba(214,255,240,0)");
            grad.addColorStop(0.35, `rgba(214,255,240,${a})`);
            grad.addColorStop(0.7, `rgba(255,255,255,${a * 1.25})`);
            grad.addColorStop(1, "rgba(214,255,240,0)");
            ctx.strokeStyle = grad as unknown as string;
            ctx.lineWidth = thick;
            ctx.beginPath();
            ctx.moveTo(-20, y + slant * 0.5);
            ctx.bezierCurveTo(w * 0.33, y - slant * 0.2, w * 0.66, y + slant * 0.2, w + 20, y - slant * 0.5);
            ctx.stroke();
        }
        // The funnel's mouth and skirt dissolve — a hard cone rim reads as a
        // lampshade, a fading one as wind thinning into air.
        fadeEdgesY(ctx, w, h, 0.2);
    });
}

/** Soft radial dot for point sprites (spray/embers/dust/sparks). */
function dotTexture(): THREE.CanvasTexture {
    return canvasTexture("fx-dot", 64, 64, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.35, "rgba(255,255,255,0.85)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    });
}

// ─── Shared pieces: light, shock ring, particle burst ────────────────────────

/** Transient element-colored point light — the cast lights the SCENE. With
 *  `strobeWindows` (the bolt strikes), the light SLAMS inside each window and
 *  falls to an ambient charge between them, so the arena flashes with every
 *  strike instead of glowing evenly through the storm. */
function PieceLight({ spawn, color, intensity, strobeWindows }: { spawn: SetPieceSpawn; color: string; intensity: number; strobeWindows?: Array<readonly [number, number]> }) {
    const light = useRef<THREE.PointLight>(null);
    useFrame(() => {
        if (!light.current) return;
        const t = pieceT(spawn);
        if (t < 0 || t >= 1) {
            light.current.intensity = 0;
            return;
        }
        let env = t < 0.1 ? t / 0.1 : Math.max(0, 1 - (t - 0.1) / 0.7);
        if (strobeWindows) {
            const inWindow = strobeWindows.some(([a, b]) => t >= a && t <= b);
            env = inWindow ? 1 + Math.sin(t * 90) * 0.25 : 0.18;
        }
        light.current.intensity = intensity * env;
        light.current.position.set(spawn.to[0], 1.6, spawn.to[2]);
    });
    return <pointLight ref={light} intensity={0} distance={13} decay={2} color={color} />;
}

/** Expanding ground ring at the strike point — reads from every angle. */
function ShockRing({ spawn, color, size = 4.6 }: { spawn: SetPieceSpawn; color: string; size?: number }) {
    const mesh = useRef<THREE.Mesh>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    useFrame(() => {
        if (!mesh.current || !mat.current) return;
        const t = pieceT(spawn);
        // The ring rides the first 45% of the piece.
        const k = t / 0.45;
        if (t < 0 || k >= 1) {
            mesh.current.visible = false;
            return;
        }
        mesh.current.visible = true;
        const ease = 1 - (1 - k) * (1 - k);
        const s = 0.7 + ease * size;
        mesh.current.position.set(spawn.to[0], 0.09, spawn.to[2]);
        mesh.current.scale.set(s, s, s);
        mat.current.opacity = 0.75 * (1 - ease);
    });
    return (
        <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
            <ringGeometry args={[0.78, 1, 48]} />
            <meshBasicMaterial ref={mat} color={color} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
    );
}

interface ParticleSpec {
    count: number;
    color: string;
    size: number;
    /** Emitter behavior. */
    mode: "rise" | "orbit" | "burst" | "spray";
    /** Particle window inside the piece life. */
    t0: number;
    t1: number;
    /** Base emitter radius. */
    radius: number;
    /** Vertical span. */
    height: number;
}

/** One THREE.Points cloud driven by seeded per-particle params. Points always
 *  face the camera, so the cloud is angle-proof by construction. */
function ParticleCloud({ spawn, spec }: { spawn: SetPieceSpawn; spec: ParticleSpec }) {
    const points = useRef<THREE.Points>(null);
    const mat = useRef<THREE.PointsMaterial>(null);
    const params = useMemo(() => {
        const rand = seededRand(spawn.key * 31 + spec.count);
        return Array.from({ length: spec.count }, () => ({
            angle: rand() * Math.PI * 2,
            speed: 0.5 + rand() * 1.1,
            r: spec.radius * (0.4 + rand() * 0.9),
            phase: rand(),
            lift: 0.4 + rand() * 1.2,
        }));
    }, [spawn.key, spec.count, spec.radius]);
    const tex = useMemo(() => dotTexture(), []);
    useFrame(() => {
        if (!points.current || !mat.current) return;
        const t = pieceT(spawn);
        const k = (t - spec.t0) / Math.max(0.05, spec.t1 - spec.t0);
        if (t < 0 || k < 0 || k >= 1) {
            points.current.visible = false;
            return;
        }
        points.current.visible = true;
        // Geometry reached through the ref, never a render-scope binding —
        // the react-compiler rule that shapes every drive in this layer.
        const attr = points.current.geometry.attributes.position as THREE.BufferAttribute;
        const pos = attr.array as Float32Array;
        const [tx, , tz] = spawn.to;
        for (let i = 0; i < params.length; i++) {
            const p = params[i];
            // Each particle loops its own sub-life inside the window.
            const life = (k * p.speed + p.phase) % 1;
            let x = tx, z = tz;
            let y: number;
            if (spec.mode === "rise") {
                x += Math.cos(p.angle) * p.r + Math.sin(life * 9 + p.phase * 6) * 0.15;
                z += Math.sin(p.angle) * p.r + Math.cos(life * 8 + p.phase * 5) * 0.15;
                y = 0.15 + life * spec.height * p.lift;
            } else if (spec.mode === "orbit") {
                const a = p.angle + life * Math.PI * 2 * 1.6;
                const r = p.r * (1 - life * 0.25);
                x += Math.cos(a) * r;
                z += Math.sin(a) * r;
                y = 0.2 + life * spec.height;
            } else if (spec.mode === "burst") {
                const d = p.r * (0.2 + life * 1.6);
                x += Math.cos(p.angle) * d;
                z += Math.sin(p.angle) * d;
                y = 0.18 + Math.sin(Math.min(1, life) * Math.PI) * spec.height * p.lift * 0.6;
            } else { // spray — up and outward, arcing down
                const d = p.r * life * 1.7;
                x += Math.cos(p.angle) * d;
                z += Math.sin(p.angle) * d;
                y = 0.3 + spec.height * (life * p.lift * 1.4 - life * life * 1.1);
            }
            pos[i * 3] = x;
            pos[i * 3 + 1] = Math.max(0.05, y);
            pos[i * 3 + 2] = z;
        }
        attr.needsUpdate = true;
        mat.current.opacity = k < 0.15 ? k / 0.15 : k > 0.7 ? Math.max(0, (1 - k) / 0.3) : 1;
    });
    return (
        <points ref={points} visible={false}>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[new Float32Array(spec.count * 3), 3]} />
            </bufferGeometry>
            <pointsMaterial ref={mat} map={tex} color={spec.color} size={spec.size} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
        </points>
    );
}

// ─── Water: the curling wave shell ───────────────────────────────────────────

function WaveVolume({ spawn }: { spawn: SetPieceSpawn }) {
    const group = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const mat2 = useRef<THREE.MeshBasicMaterial>(null);
    const tex = useMemo(() => {
        const t = waterShellTexture().clone();
        t.needsUpdate = true;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        return t;
    }, []);
    const width = spawn.superCast ? 9.5 : 6.8;
    const radius = spawn.superCast ? 2.6 : 2.0;
    useFrame(() => {
        if (!group.current || !mat.current) return;
        const t = pieceT(spawn);
        if (t < 0 || t >= 1) {
            group.current.visible = false;
            return;
        }
        group.current.visible = true;
        const ease = 1 - (1 - t) * (1 - t);
        const x = spawn.from[0] + (spawn.to[0] - spawn.from[0]) * ease;
        const z = spawn.from[2] + (spawn.to[2] - spawn.from[2]) * ease;
        group.current.position.set(x, 0, z);
        // Face the travel direction; the open curl leads. A gentle pitch rock
        // as it sweeps — a perfectly rigid curl reads as a sliding prop.
        const yaw = Math.atan2(spawn.to[0] - spawn.from[0], spawn.to[2] - spawn.from[2]);
        group.current.rotation.set(Math.sin(t * 7) * 0.025, yaw, 0);
        const s = (0.65 + ease * 0.5) * (1 + Math.sin(t * 9) * 0.02);
        group.current.scale.set(s, s, s);
        // Water climbs the curl — the texture is reached through the material
        // ref (mutating the useMemo binding trips react-hooks/immutability).
        const shellMap = mat.current.map;
        if (shellMap) shellMap.offset.x = -t * 2.2;
        mat.current.opacity = t < 0.12 ? t / 0.12 : t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 0.96;
        if (mat2.current) mat2.current.opacity = mat.current.opacity * 0.55;
    });
    return (
        <group ref={group} visible={false}>
            {/* Axis along X (across the lane); arc curls forward over +Z. A
                second shell crossed at a slight yaw keeps the wave a VOLUME
                when the camera looks down the lane (one shell alone collapsed
                to a thin fin edge-on). */}
            <mesh rotation={[0, 0, Math.PI / 2]} position={[0, radius * 0.92, 0]}>
                <cylinderGeometry args={[radius, radius, width, 30, 1, true, Math.PI * 0.92, Math.PI * 0.86]} />
                <meshBasicMaterial ref={mat} map={tex} transparent opacity={0} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh rotation={[0, 0.55, Math.PI / 2]} position={[0, radius * 0.8, 0.25]} scale={[0.82, 0.82, 0.82]}>
                <cylinderGeometry args={[radius, radius, width * 0.8, 26, 1, true, Math.PI * 0.95, Math.PI * 0.8]} />
                <meshBasicMaterial ref={mat2} map={tex} color="#cfeeff" transparent opacity={0} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
        </group>
    );
}

// ─── Fire: crown of flame cards ──────────────────────────────────────────────

function FlameVolume({ spawn }: { spawn: SetPieceSpawn }) {
    const group = useRef<THREE.Group>(null);
    const cardRefs = useRef<Array<THREE.Mesh | null>>([]);
    const matRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const fireTex = useMemo(() => epicTexture("firewall"), []);
    const count = spawn.superCast ? 9 : 6;
    const ring = spawn.superCast ? 1.7 : 1.25;
    const cards = useMemo(() => {
        const rand = seededRand(spawn.key * 17 + 3);
        return Array.from({ length: count }, (_, i) => ({
            angle: (i / count) * Math.PI * 2 + rand() * 0.5,
            h: 2.1 + rand() * 1.3 + (spawn.superCast ? 0.8 : 0),
            w: 1.5 + rand() * 0.9,
            phase: rand(),
            slice: Math.floor(rand() * 5),
        }));
    }, [spawn.key, count, spawn.superCast]);
    // Each card samples a different u-slice of the painted firewall so the
    // crown doesn't read as nine clones.
    const geos = useMemo(() => cards.map((c) => {
        const g = new THREE.PlaneGeometry(1, 1);
        const uv = g.attributes.uv.array as Float32Array;
        const u0 = c.slice * 0.2, u1 = u0 + 0.2;
        for (let i = 0; i < uv.length; i += 2) uv[i] = uv[i] === 0 ? u0 : u1;
        return g;
    }), [cards]);
    useFrame(() => {
        if (!group.current) return;
        const t = pieceT(spawn);
        if (t < 0 || t >= 1) {
            group.current.visible = false;
            return;
        }
        group.current.visible = true;
        group.current.position.set(spawn.to[0], 0, spawn.to[2]);
        cards.forEach((c, i) => {
            const m = cardRefs.current[i];
            const mm = matRefs.current[i];
            if (!m || !mm) return;
            const rise = Math.min(1, t * 2.6 + c.phase * 0.2);
            const flick = 1 + Math.sin(t * 40 + c.phase * 9) * 0.09;
            m.position.set(Math.cos(c.angle) * ring, (c.h / 2) * rise - 0.15, Math.sin(c.angle) * ring);
            m.scale.set(c.w * flick, c.h * rise * flick, 1);
            m.rotation.y = c.angle + Math.PI / 2 + Math.sin(t * 7 + c.phase * 5) * 0.08;
            mm.opacity = (t < 0.1 ? t / 0.1 : t > 0.72 ? Math.max(0, (1 - t) / 0.28) : 1) * 0.96;
        });
    });
    return (
        <group ref={group} visible={false}>
            {cards.map((c, i) => (
                <mesh key={i} ref={(el) => { cardRefs.current[i] = el; }} geometry={geos[i]}>
                    <meshBasicMaterial
                        ref={(el) => { matRefs.current[i] = el; }}
                        map={fireTex ?? undefined}
                        // Warm tint ladder — nine identical whites read as one
                        // flat texture; staggered heat depths read as a blaze.
                        color={fireTex ? ["#ffffff", "#ffd9a0", "#ffb27a"][i % 3] : "#ff7a35"}
                        transparent
                        opacity={0}
                        depthWrite={false}
                        toneMapped={false}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            ))}
        </group>
    );
}

// ─── Wind: counter-rotating vortex cones ─────────────────────────────────────

function VortexVolume({ spawn }: { spawn: SetPieceSpawn }) {
    const group = useRef<THREE.Group>(null);
    const outer = useRef<THREE.Mesh>(null);
    const inner = useRef<THREE.Mesh>(null);
    const outerMat = useRef<THREE.MeshBasicMaterial>(null);
    const innerMat = useRef<THREE.MeshBasicMaterial>(null);
    const tex = useMemo(() => {
        const t = vortexBandTexture().clone();
        t.needsUpdate = true;
        t.wrapS = THREE.RepeatWrapping;
        t.repeat.set(2, 1);
        return t;
    }, []);
    const h = spawn.superCast ? 6.4 : 4.6;
    useFrame(() => {
        if (!group.current || !outer.current || !inner.current || !outerMat.current || !innerMat.current) return;
        const t = pieceT(spawn);
        if (t < 0 || t >= 1) {
            group.current.visible = false;
            return;
        }
        group.current.visible = true;
        const rise = Math.min(1, t * 2.2);
        group.current.position.set(spawn.to[0], (h / 2) * rise - 0.1, spawn.to[2]);
        group.current.rotation.z = Math.sin(t * 5.2) * 0.05;
        group.current.scale.setScalar(0.7 + rise * 0.35);
        // REAL rotation about the column axis — parallax from every angle.
        outer.current.rotation.y = t * Math.PI * 9;
        inner.current.rotation.y = -t * Math.PI * 12;
        const env = t < 0.12 ? t / 0.12 : t > 0.72 ? Math.max(0, (1 - t) / 0.28) : 1;
        outerMat.current.opacity = env * 0.85;
        innerMat.current.opacity = env * 0.6;
    });
    return (
        <group ref={group} visible={false}>
            <mesh ref={outer}>
                <cylinderGeometry args={[0.55, 2.1, h, 26, 1, true]} />
                <meshBasicMaterial ref={outerMat} map={tex} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={inner} scale={[0.62, 0.94, 0.62]}>
                <cylinderGeometry args={[0.4, 1.5, h, 22, 1, true]} />
                <meshBasicMaterial ref={innerMat} map={tex} color="#d6fff0" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
        </group>
    );
}

// ─── Earth: real rocks out of the ground ─────────────────────────────────────

/** Jagged stone shard: a cone with seeded radial displacement — perfect cones
 *  read as paper pyramids in close-ups; broken silhouettes read as granite. */
function rockGeometry(seed: number, r: number, h: number): THREE.ConeGeometry {
    const g = new THREE.ConeGeometry(r, h, 6, 2);
    const rand = seededRand(seed);
    const posAttr = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
        const y = posAttr.getY(i);
        if (Math.abs(y) < h / 2 - 0.01) {
            const k = 0.75 + rand() * 0.6;
            posAttr.setX(i, posAttr.getX(i) * k);
            posAttr.setZ(i, posAttr.getZ(i) * k);
            posAttr.setY(i, y + (rand() - 0.5) * h * 0.12);
        }
    }
    return g;
}

function EruptionVolume({ spawn }: { spawn: SetPieceSpawn }) {
    const group = useRef<THREE.Group>(null);
    const rockRefs = useRef<Array<THREE.Mesh | null>>([]);
    const count = spawn.superCast ? 7 : 5;
    const rocks = useMemo(() => {
        const rand = seededRand(spawn.key * 23 + 5);
        return Array.from({ length: count }, (_, i) => ({
            x: (rand() - 0.5) * (spawn.superCast ? 3.4 : 2.2),
            z: (rand() - 0.5) * (spawn.superCast ? 2.6 : 1.8),
            h: 1.3 + rand() * (spawn.superCast ? 2.6 : 1.7),
            r: 0.38 + rand() * 0.5,
            tilt: (rand() - 0.5) * 0.55,
            yaw: rand() * Math.PI * 2,
            delay: (i / count) * 0.35 * rand(),
            dark: 0.75 + rand() * 0.25,
            geoSeed: spawn.key * 41 + i * 13 + 7,
        }));
    }, [spawn.key, count, spawn.superCast]);
    const geos = useMemo(() => rocks.map((r) => rockGeometry(r.geoSeed, r.r, r.h)), [rocks]);
    useFrame(() => {
        if (!group.current) return;
        const t = pieceT(spawn);
        if (t < 0 || t >= 1) {
            group.current.visible = false;
            return;
        }
        group.current.visible = true;
        group.current.position.set(spawn.to[0], 0, spawn.to[2]);
        rocks.forEach((r, i) => {
            const m = rockRefs.current[i];
            if (!m) return;
            const k = Math.min(1, Math.max(0, (t - r.delay) / 0.3));
            const up = 1 - (1 - k) * (1 - k);
            // Rocks stay risen; the whole cluster sinks back in the last 15%.
            const sink = t > 0.85 ? (t - 0.85) / 0.15 : 0;
            m.visible = k > 0;
            m.position.set(r.x, r.h * (up * 0.9 - 0.9) + 0.35 - sink * r.h, r.z);
            m.rotation.set(r.tilt * up, r.yaw, r.tilt * 0.4 * up);
        });
    });
    return (
        <group ref={group} visible={false}>
            {rocks.map((r, i) => (
                <mesh key={i} ref={(el) => { rockRefs.current[i] = el; }} geometry={geos[i]} castShadow>
                    {/* Standard material ON PURPOSE: the arena's directional +
                        hemisphere lights shade the facets, which is what makes
                        the rocks read as solid from every camera. Dark granite
                        base — pale stone read as paper in close-ups. */}
                    <meshStandardMaterial color={new THREE.Color(0.42 * r.dark, 0.35 * r.dark, 0.27 * r.dark)} roughness={0.95} flatShading emissive="#8a4f16" emissiveIntensity={0.22} />
                </mesh>
            ))}
        </group>
    );
}

// ─── Lightning: procedural jagged bolt ───────────────────────────────────────

interface BoltStrike {
    /** Lane fraction from caster→victim where the bolt lands. */
    frac: number;
    t0: number;
    t1: number;
    scale: number;
    seed: number;
}

function boltGeometry(seed: number, forks: boolean): { core: THREE.TubeGeometry; glow: THREE.TubeGeometry; forkCore: THREE.TubeGeometry | null } {
    const rand = seededRand(seed);
    const pts: THREE.Vector3[] = [];
    const SEGS = 8;
    for (let i = 0; i <= SEGS; i++) {
        const v = i / SEGS;
        const spread = Math.sin(v * Math.PI) * 0.7;
        pts.push(new THREE.Vector3(
            (rand() - 0.5) * spread * 1.4,
            7.4 * (1 - v),
            (rand() - 0.5) * spread * 1.1,
        ));
    }
    pts[SEGS].set(0, 0.05, 0);
    const path = new THREE.CatmullRomCurve3(pts);
    const core = new THREE.TubeGeometry(path, 22, 0.05, 5, false);
    const glow = new THREE.TubeGeometry(path, 22, 0.17, 5, false);
    let forkCore: THREE.TubeGeometry | null = null;
    if (forks) {
        const at = pts[3].clone();
        const fpts = [at, at.clone().add(new THREE.Vector3((rand() - 0.5) * 2.4, -1.4, (rand() - 0.5) * 2)), at.clone().add(new THREE.Vector3((rand() - 0.5) * 3.4, -2.9, (rand() - 0.5) * 2.6))];
        forkCore = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fpts), 10, 0.03, 4, false);
    }
    return { core, glow, forkCore };
}

/** Shared by the bolt meshes AND the strobing piece light — one schedule. */
function boltStrikes(key: number, superCast: boolean): BoltStrike[] {
    return superCast
        ? [
            { frac: 0.45, t0: 0.02, t1: 0.2, scale: 0.85, seed: key * 7 + 1 },
            { frac: 0.78, t0: 0.24, t1: 0.42, scale: 0.95, seed: key * 7 + 2 },
            { frac: 1, t0: 0.46, t1: 0.74, scale: 1.25, seed: key * 7 + 3 },
        ]
        : [
            { frac: 1, t0: 0.05, t1: 0.3, scale: 1, seed: key * 7 + 1 },
            { frac: 1, t0: 0.5, t1: 0.72, scale: 0.8, seed: key * 7 + 4 },
        ];
}

function BoltVolume({ spawn }: { spawn: SetPieceSpawn }) {
    const strikes = useMemo<BoltStrike[]>(() => boltStrikes(spawn.key, spawn.superCast === true), [spawn.key, spawn.superCast]);
    return (
        <group>
            {strikes.map((s, i) => <BoltStrikeMesh key={i} spawn={spawn} strike={s} />)}
        </group>
    );
}

function BoltStrikeMesh({ spawn, strike }: { spawn: SetPieceSpawn; strike: BoltStrike }) {
    const group = useRef<THREE.Group>(null);
    const coreMat = useRef<THREE.MeshBasicMaterial>(null);
    const glowMat = useRef<THREE.MeshBasicMaterial>(null);
    const forkMat = useRef<THREE.MeshBasicMaterial>(null);
    const geos = useMemo(() => boltGeometry(strike.seed, spawn.superCast === true), [strike.seed, spawn.superCast]);
    const x = spawn.from[0] + (spawn.to[0] - spawn.from[0]) * strike.frac;
    const z = spawn.from[2] + (spawn.to[2] - spawn.from[2]) * strike.frac;
    useFrame(() => {
        if (!group.current || !coreMat.current || !glowMat.current) return;
        const t = pieceT(spawn);
        const k = (t - strike.t0) / (strike.t1 - strike.t0);
        if (t < 0 || k < 0 || k >= 1) {
            group.current.visible = false;
            return;
        }
        group.current.visible = true;
        group.current.position.set(x, 0, z);
        group.current.scale.setScalar(strike.scale);
        // Bolt STROBES: hard on, flickering, hard off.
        const flicker = 0.72 + Math.sin(k * 90) * 0.28;
        const env = k < 0.08 ? 1 : k > 0.8 ? Math.max(0, (1 - k) / 0.2) : 1;
        coreMat.current.opacity = env * flicker;
        glowMat.current.opacity = env * flicker * 0.55;
        if (forkMat.current) forkMat.current.opacity = env * flicker * 0.8;
    });
    return (
        <group ref={group} visible={false}>
            <mesh geometry={geos.core}>
                <meshBasicMaterial ref={coreMat} color="#ffffff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            <mesh geometry={geos.glow}>
                <meshBasicMaterial ref={glowMat} color="#9db8ff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            {geos.forkCore && (
                <mesh geometry={geos.forkCore}>
                    <meshBasicMaterial ref={forkMat} color="#e8f0ff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
                </mesh>
            )}
        </group>
    );
}

// ─── The volumetric switch ───────────────────────────────────────────────────

const PARTICLES: Record<string, (superCast: boolean) => ParticleSpec> = {
    Water: (s) => ({ count: s ? 34 : 22, color: "#dff6ff", size: 0.34, mode: "spray", t0: 0.45, t1: 1, radius: s ? 2.2 : 1.5, height: 2.4 }),
    Fire: (s) => ({ count: s ? 36 : 24, color: "#ffb066", size: 0.26, mode: "rise", t0: 0.05, t1: 1, radius: s ? 1.9 : 1.4, height: 3.4 }),
    Wind: (s) => ({ count: s ? 30 : 20, color: "#d9ffe9", size: 0.24, mode: "orbit", t0: 0, t1: 1, radius: s ? 2.4 : 1.8, height: 3.8 }),
    Earth: (s) => ({ count: s ? 30 : 20, color: "#d8b083", size: 0.3, mode: "burst", t0: 0, t1: 0.7, radius: s ? 2.4 : 1.7, height: 1.6 }),
    Lightning: (s) => ({ count: s ? 30 : 18, color: "#f4f8ff", size: 0.24, mode: "burst", t0: 0.05, t1: 0.85, radius: s ? 1.9 : 1.4, height: 2.2 }),
};

// ─── Battle scars — the arena remembers the whole fight ──────────────────────
// Every signature and killing blow leaves a mark where it landed: scorch,
// fracture, frost-burn. Flat decals that fade in at the strike and linger,
// so round nine looks like a battlefield instead of round one.

export interface BattleScar {
    key: number;
    x: number;
    z: number;
    element: string;
    bornAt: number;
}

const SCAR_RIM: Record<string, string> = {
    Fire: "rgba(255,120,50,0.5)",
    Water: "rgba(120,200,255,0.42)",
    Wind: "rgba(160,240,200,0.4)",
    Earth: "rgba(220,170,100,0.48)",
    Lightning: "rgba(190,210,255,0.5)",
};

/** Ragged dark blotch with a faint element-colored rim — drawn once per
 *  element and cached. */
function scarTexture(element: string): THREE.CanvasTexture {
    return canvasTexture(`scar-${element}`, 128, 128, (ctx, w, h) => {
        const rand = seededRand(element.length * 97 + 13);
        const cx = w / 2, cy = h / 2;
        // Ragged char blotch: many overlapping dark arcs of varying radius.
        for (let i = 0; i < 46; i++) {
            const a = rand() * Math.PI * 2;
            const d = rand() * rand() * w * 0.3;
            const r = 6 + rand() * 20;
            ctx.fillStyle = `rgba(16,11,9,${0.1 + rand() * 0.16})`;
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // Radial cracks.
        ctx.strokeStyle = "rgba(10,7,6,0.5)";
        for (let i = 0; i < 7; i++) {
            const a = rand() * Math.PI * 2;
            ctx.lineWidth = 1 + rand() * 1.6;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6);
            ctx.lineTo(cx + Math.cos(a + (rand() - 0.5) * 0.5) * (26 + rand() * 30), cy + Math.sin(a + (rand() - 0.5) * 0.5) * (26 + rand() * 30));
            ctx.stroke();
        }
        // Element rim glow.
        const rim = ctx.createRadialGradient(cx, cy, w * 0.16, cx, cy, w * 0.42);
        rim.addColorStop(0, "rgba(0,0,0,0)");
        rim.addColorStop(0.75, SCAR_RIM[element] ?? "rgba(255,255,255,0.3)");
        rim.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = rim;
        ctx.beginPath();
        ctx.arc(cx, cy, w * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
    });
}

function ScarDecal({ scar }: { scar: BattleScar }) {
    const mesh = useRef<THREE.Mesh>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const tex = useMemo(() => scarTexture(scar.element), [scar.element]);
    const rand = useMemo(() => seededRand(scar.key * 61 + 3), [scar.key]);
    const spin = useMemo(() => rand() * Math.PI * 2, [rand]);
    const size = useMemo(() => 2.2 + rand() * 1.4, [rand]);
    useFrame(() => {
        if (!mesh.current || !mat.current) return;
        const age = (performance.now() - scar.bornAt) / 1000;
        // Fade in with the strike, hold, then bleach out over ~100s.
        const env = age < 0.4 ? age / 0.4 : Math.max(0, 1 - (age - 0.4) / 100);
        mesh.current.visible = env > 0.01;
        mat.current.opacity = 0.46 * env;
    });
    return (
        <mesh ref={mesh} rotation={[-Math.PI / 2, 0, spin]} position={[scar.x, 0.045, scar.z]} visible={false}>
            <planeGeometry args={[size, size]} />
            <meshBasicMaterial ref={mat} map={tex} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
    );
}

export function ScarLayer({ scars }: { scars: readonly BattleScar[] }) {
    return <group>{scars.map((s) => <ScarDecal key={s.key} scar={s} />)}</group>;
}

// ─── Element residue — the arena remembers for a few beats ───────────────────
// After a signature detonates, its element does not simply vanish: embers
// drift where the firestorm stood, the flooded boards keep a wet sheen, charge
// crackles off the storm's victim. A low-key ambient loop, spawned when the
// set-piece ends and fading out on its own.

export interface ResidueSpawn {
    key: number;
    element: string;
    x: number;
    z: number;
    startedAt: number;
    durationMs: number;
}

const RESIDUE_STYLE: Record<string, { color: string; count: number; size: number; mode: "rise" | "orbit" | "burst"; height: number; floor?: string; floorOpacity?: number }> = {
    Fire: { color: "#ff9a55", count: 14, size: 0.2, mode: "rise", height: 2.4, floor: "floor-lava", floorOpacity: 0.16 },
    Water: { color: "#a5e2ff", count: 10, size: 0.18, mode: "orbit", height: 0.7, floor: "floor-water", floorOpacity: 0.2 },
    Wind: { color: "#c9f5df", count: 12, size: 0.18, mode: "orbit", height: 2.2 },
    Earth: { color: "#d8b083", count: 10, size: 0.2, mode: "rise", height: 1.1, floor: "floor-earth", floorOpacity: 0.16 },
    Lightning: { color: "#dfe8ff", count: 12, size: 0.18, mode: "burst", height: 1.6, floor: "floor-storm", floorOpacity: 0.14 },
};

export function ResidueFx({ spawn }: { spawn: ResidueSpawn }) {
    const style = RESIDUE_STYLE[spawn.element];
    const points = useRef<THREE.Points>(null);
    const mat = useRef<THREE.PointsMaterial>(null);
    const floorMesh = useRef<THREE.Mesh>(null);
    const floorMat = useRef<THREE.MeshBasicMaterial>(null);
    const params = useMemo(() => {
        const rand = seededRand(spawn.key * 53 + 9);
        const count = style?.count ?? 10;
        return Array.from({ length: count }, () => ({
            angle: rand() * Math.PI * 2,
            r: 0.5 + rand() * 1.6,
            speed: 0.25 + rand() * 0.5,
            phase: rand(),
        }));
    }, [spawn.key, style]);
    const dot = useMemo(() => dotTexture(), []);
    const floorTex = useMemo(() => (style?.floor ? epicTexture(style.floor) : null), [style]);
    useFrame(() => {
        if (!style) return;
        const t = (performance.now() - spawn.startedAt) / spawn.durationMs;
        const env = t < 0.2 ? t / 0.2 : t > 0.65 ? Math.max(0, (1 - t) / 0.35) : 1;
        if (points.current && mat.current) {
            if (t < 0 || t >= 1) points.current.visible = false;
            else {
                points.current.visible = true;
                const attr = points.current.geometry.attributes.position as THREE.BufferAttribute;
                const pos = attr.array as Float32Array;
                for (let i = 0; i < params.length; i++) {
                    const p = params[i];
                    const life = (t * p.speed * 3 + p.phase) % 1;
                    let x = spawn.x, z = spawn.z;
                    let y: number;
                    if (style.mode === "rise") {
                        x += Math.cos(p.angle) * p.r;
                        z += Math.sin(p.angle) * p.r;
                        y = 0.12 + life * style.height;
                    } else if (style.mode === "orbit") {
                        const a = p.angle + life * Math.PI * 2;
                        x += Math.cos(a) * p.r;
                        z += Math.sin(a) * p.r;
                        y = 0.15 + Math.sin(life * Math.PI) * style.height * 0.5;
                    } else {
                        x += Math.cos(p.angle) * p.r * life;
                        z += Math.sin(p.angle) * p.r * life;
                        y = 0.12 + Math.sin(life * Math.PI) * style.height * 0.6;
                    }
                    pos[i * 3] = x;
                    pos[i * 3 + 1] = y;
                    pos[i * 3 + 2] = z;
                }
                attr.needsUpdate = true;
                mat.current.opacity = env * 0.65;
            }
        }
        if (floorMesh.current && floorMat.current) {
            if (t < 0 || t >= 1 || !floorTex) floorMesh.current.visible = false;
            else {
                floorMesh.current.visible = true;
                if (floorMat.current.map !== floorTex) {
                    floorMat.current.map = floorTex;
                    floorMat.current.needsUpdate = true;
                }
                floorMesh.current.position.set(spawn.x, 0.055, spawn.z);
                floorMesh.current.rotation.z = t * 0.4;
                floorMat.current.opacity = (style.floorOpacity ?? 0.15) * env;
            }
        }
    });
    if (!style) return null;
    return (
        <group>
            <points ref={points} visible={false}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[new Float32Array((style.count) * 3), 3]} />
                </bufferGeometry>
                <pointsMaterial ref={mat} map={dot} color={style.color} size={style.size} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
            </points>
            {floorTex && (
                <mesh ref={floorMesh} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
                    <planeGeometry args={[7.5, 7.5]} />
                    <meshBasicMaterial ref={floorMat} transparent opacity={0} depthWrite={false} toneMapped={false} />
                </mesh>
            )}
        </group>
    );
}

/** The 3D structure for one staged cast. Rendered alongside the floor
 *  takeover and the slimmed painted accents by SetPieceOnce. */
export function VolumetricSetPiece({ spawn }: { spawn: SetPieceSpawn }) {
    const glow = ELEMENT_GLOW[spawn.element];
    if (!glow) return null;
    const spec = PARTICLES[spawn.element](spawn.superCast === true);
    const strobe = spawn.element === "Lightning"
        ? boltStrikes(spawn.key, spawn.superCast === true).map((s) => [s.t0, s.t1] as const)
        : undefined;
    return (
        <group>
            {spawn.element === "Water" && <WaveVolume spawn={spawn} />}
            {spawn.element === "Fire" && <FlameVolume spawn={spawn} />}
            {spawn.element === "Wind" && <VortexVolume spawn={spawn} />}
            {spawn.element === "Earth" && <EruptionVolume spawn={spawn} />}
            {spawn.element === "Lightning" && <BoltVolume spawn={spawn} />}
            <ParticleCloud spawn={spawn} spec={spec} />
            <ShockRing spawn={spawn} color={glow} size={spawn.superCast ? 5.6 : 4.2} />
            <PieceLight spawn={spawn} color={glow} intensity={spawn.superCast ? 34 : 20} strobeWindows={strobe} />
        </group>
    );
}
