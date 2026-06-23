/*
 * PetBoardArena — the Pet Gauntlet BOARD fight view, rendered in 3D (r3f).
 *
 * A real tilted game board (Dota-Underlords style): the generated flagstone floor
 * is a 3D plane, and both squads stand on it as GROUNDED billboard standees at
 * their grid cells (3 deep × 5 across per side), viewed by a perspective camera
 * looking down at the board. It plays a deterministic BoardResult
 * (lib/pet-board-sim) round-by-round — HP bars ease down, hits flash, faints
 * topple. It is its OWN renderer (not the 2v2 PetColiseumDuel); pure presentation
 * over the deterministic stream, so it never touches combat.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import type { BoardResult } from "../lib/pet-board-sim";
import { BOARD_COLS } from "../lib/pet-board-sim";
import { petCardImage, elementVfxKey } from "../lib/pet-battle-anim";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import gauntletHero from "../assets/coliseum/gauntlet-hero.webp";
import gauntletBoard from "../assets/coliseum/gauntlet-board.webp";

const ROUND_MS = 820;
const CELL = 2.15;            // world units per grid cell
const ROWS = 6;              // 3 enemy + 3 player
const SPRITE_H = 2.5;        // standee height (world units)
const cx = (col: number) => (col - (BOARD_COLS - 1) / 2) * CELL;
const cz = (boardRow: number) => (boardRow - (ROWS - 1) / 2) * CELL;
// unit grid row (0 front … 2 back) → board row. Enemy fronts face player fronts at centre.
const boardRowOf = (u: BoardResult["roster"][number]) => (u.team === "enemy" ? 2 - Math.min(2, u.row) : 3 + Math.min(2, u.row));

/** Load an image URL into an sRGB THREE texture (async; null until ready). */
function useTex(url: string | undefined): THREE.Texture | null {
    const [tex, setTex] = useState<THREE.Texture | null>(null);
    useEffect(() => {
        if (!url) return;
        let live = true;
        new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; if (live) setTex(t); });
        return () => { live = false; };
    }, [url]);
    return tex;
}

// ── Element VFX: a tinted orb flies attacker→target, then the element's burst
// animation (the bundled jutsu FX frames) plays on impact. ───────────────────
const EL_GLOW: Record<string, string> = { Fire: "#ff7a2f", Water: "#39b6ff", Wind: "#74f0d0", Lightning: "#ffe14d", Earth: "#caa46a" };
const elGlow = (el?: string | null) => (el && EL_GLOW[el]) || "#cbd5e1";

const fxTexCache = new Map<string, THREE.Texture>();
function fxTex(url: string): THREE.Texture {
    let t = fxTexCache.get(url);
    if (!t) { t = new THREE.TextureLoader().load(url); t.colorSpace = THREE.SRGBColorSpace; fxTexCache.set(url, t); }
    return t;
}
let _orb: THREE.Texture | null = null;
function orbTex(): THREE.Texture {
    if (_orb) return _orb;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(32, 32, 1, 32, 32, 31);
    grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.45, "rgba(255,255,255,0.8)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    _orb = new THREE.CanvasTexture(c); _orb.colorSpace = THREE.SRGBColorSpace; return _orb;
}
// Discard near-black background pixels so pose sprites with a dark (non-alpha)
// background stand cleanly on the board instead of showing a dark box.
const blackKey = (shader: { fragmentShader: string }) => {
    shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        "#include <map_fragment>\n  if (dot(diffuseColor.rgb, vec3(0.299,0.587,0.114)) < 0.07) discard;",
    );
};

type Vec3 = [number, number, number];

function BoardProjectile({ from, to, color, onArrive }: { from: Vec3; to: Vec3; color: string; onArrive: () => void }) {
    const grp = useRef<THREE.Group>(null);
    const born = useRef<number | null>(null);
    const fired = useRef(false);
    useFrame((state) => {
        if (born.current === null) born.current = state.clock.elapsedTime;
        const t = Math.min(1, (state.clock.elapsedTime - born.current) / 0.26);
        const g = grp.current;
        if (g) g.position.set(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * 0.7, from[2] + (to[2] - from[2]) * t);
        if (t >= 1 && !fired.current) { fired.current = true; onArrive(); }
    });
    return (
        <group ref={grp} position={from}>
            <Billboard><mesh><planeGeometry args={[0.85, 0.85]} /><meshBasicMaterial map={orbTex()} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></mesh></Billboard>
        </group>
    );
}

function BoardBurst({ pos, frames, onDone }: { pos: Vec3; frames: string[]; onDone: () => void }) {
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const born = useRef<number | null>(null);
    const texes = useMemo(() => frames.map(fxTex), [frames]);
    useFrame((state) => {
        if (born.current === null) born.current = state.clock.elapsedTime;
        const t = (state.clock.elapsedTime - born.current) / 0.48;
        if (t >= 1) { onDone(); return; }
        const m = mat.current; if (!m) return;
        m.map = texes[Math.min(texes.length - 1, Math.floor(t * texes.length))];
        m.opacity = 1 - t * t;
        m.needsUpdate = true;
    });
    return <Billboard position={pos}><mesh><planeGeometry args={[2.7, 2.7]} /><meshBasicMaterial ref={mat} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></mesh></Billboard>;
}

interface Beat { hp: number; maxHp: number; alive: boolean; dmg: number; hit: boolean; acted: boolean; }

function Standee({ x, z, tex, beat, element }: { x: number; z: number; tex: THREE.Texture | null; beat: Beat; element?: string | null }) {
    const grp = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const hitAt = useRef(-1);
    // Trigger a flash/recoil when this round's beat marks a hit.
    useEffect(() => { if (beat.hit) hitAt.current = performance.now(); }, [beat.hit, beat.dmg]);
    useFrame(() => {
        const g = grp.current; if (!g) return;
        const since = (performance.now() - hitAt.current) / 1000;
        const k = hitAt.current > 0 && since < 0.34 ? Math.sin(since / 0.34 * Math.PI) : 0;   // 0→1→0
        g.position.x = x + (beat.alive ? Math.sin(since * 60) * 0.06 * k : 0);                 // recoil shake
        g.rotation.z = beat.alive ? 0 : -0.9;                                                   // topple on death
        g.position.y = beat.alive ? 0 : -0.15;
        if (mat.current) {
            const tint = 1 - 0.5 * k;
            mat.current.color.setRGB(1, tint, tint);     // red flash on hit
            mat.current.opacity = beat.alive ? 1 : 0.32;
        }
    });
    const pct = Math.max(0, Math.min(1, beat.hp / Math.max(1, beat.maxHp)));
    const hpColor = pct > 0.5 ? "#4ade80" : pct > 0.22 ? "#facc15" : "#f87171";
    const glow = (element && { Fire: "#fb923c", Water: "#38bdf8", Wind: "#5eead4", Lightning: "#facc15", Earth: "#a3a380" }[element]) || "#94a3b8";
    return (
        <group ref={grp} position={[x, 0, z]}>
            {/* contact shadow on the floor */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0.1]}>
                <circleGeometry args={[0.72, 24]} />
                <meshBasicMaterial color="#000" transparent opacity={0.34} />
            </mesh>
            {/* element ring */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0.1]}>
                <ringGeometry args={[0.74, 0.86, 28]} />
                <meshBasicMaterial color={glow} transparent opacity={beat.alive ? 0.5 : 0.12} />
            </mesh>
            <Billboard follow lockX lockZ position={[0, SPRITE_H / 2 + 0.1, 0]}>
                <mesh>
                    <planeGeometry args={[SPRITE_H * 0.92, SPRITE_H]} />
                    <meshBasicMaterial ref={mat} map={tex ?? undefined} transparent alphaTest={0.12} onBeforeCompile={blackKey} toneMapped={false} />
                </mesh>
                {/* HP bar above the head */}
                <group position={[0, SPRITE_H / 2 + 0.28, 0]}>
                    <mesh><planeGeometry args={[1.5, 0.2]} /><meshBasicMaterial color="#0b1220" /></mesh>
                    <mesh position={[-(1.5 * (1 - pct)) / 2, 0, 0.01]}><planeGeometry args={[Math.max(0.001, 1.5 * pct), 0.14]} /><meshBasicMaterial color={hpColor} toneMapped={false} /></mesh>
                </group>
            </Billboard>
        </group>
    );
}

function BoardScene({ result, round, fx, texMap }: {
    result: BoardResult; round: number; fx: Map<string, { dmg: number; hit: boolean; acted: boolean }>; texMap: Map<string, THREE.Texture | null>;
}) {
    const floor = useTex(gauntletBoard);
    const snap = result.snapshots[Math.min(round, result.snapshots.length - 1)];
    const idRef = useRef(0);
    const [shots, setShots] = useState<Array<{ id: number; from: Vec3; to: Vec3; element?: string | null }>>([]);
    const [bursts, setBursts] = useState<Array<{ id: number; pos: Vec3; frames: string[] }>>([]);
    const worldOf = (id: string): Vec3 | null => {
        const u = result.roster.find((x) => x.id === id); if (!u) return null;
        return [cx(u.col), SPRITE_H * 0.55, cz(boardRowOf(u))];
    };
    const spawnBurst = (pos: Vec3, element?: string | null) => {
        const frames = bundledJutsuFxFrames(elementVfxKey(element));
        if (!frames || !frames.length) return;
        setBursts((b) => [...b, { id: ++idRef.current, pos, frames }]);
    };
    // Each round, fling an element orb attacker→target for every landed hit.
    useEffect(() => {
        const add: Array<{ id: number; from: Vec3; to: Vec3; element?: string | null }> = [];
        for (const e of result.events) {
            if (e.t !== round || e.type !== "hit" || !e.actorId || !e.targetId) continue;
            const from = worldOf(e.actorId); const to = worldOf(e.targetId);
            if (from && to) add.push({ id: ++idRef.current, from, to, element: e.element });
        }
        if (add.length) setShots((s) => [...s, ...add]);   // eslint-disable-line react-hooks/set-state-in-effect
    }, [round, result]);   // eslint-disable-line react-hooks/exhaustive-deps
    return (
        <>
            <ambientLight intensity={1} />
            {/* the board floor */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
                <planeGeometry args={[BOARD_COLS * CELL + 1.4, ROWS * CELL + 1.4]} />
                <meshBasicMaterial key={floor ? "floor-tex" : "floor-plain"} map={floor ?? undefined} color={floor ? "#ffffff" : "#1e293b"} toneMapped={false} />
            </mesh>
            {result.roster.map((u) => {
                const s = snap.units.find((x) => x.id === u.id);
                const f = fx.get(u.id) ?? { dmg: 0, hit: false, acted: false };
                return (
                    <Standee key={u.id} x={cx(u.col)} z={cz(boardRowOf(u))} tex={texMap.get(u.id) ?? null} element={u.pet.element}
                        beat={{ hp: s?.hp ?? 0, maxHp: s?.maxHp ?? u.pet.hp, alive: s?.alive ?? false, dmg: f.dmg, hit: f.hit, acted: f.acted }} />
                );
            })}
            {shots.map((s) => (
                <BoardProjectile key={s.id} from={s.from} to={s.to} color={elGlow(s.element)}
                    onArrive={() => { setShots((x) => x.filter((y) => y.id !== s.id)); spawnBurst(s.to, s.element); }} />
            ))}
            {bursts.map((b) => (
                <BoardBurst key={b.id} pos={b.pos} frames={b.frames} onDone={() => setBursts((x) => x.filter((y) => y.id !== b.id))} />
            ))}
        </>
    );
}

export function PetBoardArena({ result, sharedImages = {}, onDone }: { result: BoardResult; sharedImages?: Record<string, string>; onDone: () => void }) {
    const total = result.snapshots.length;
    const [round, setRound] = useState(0);
    const done = round >= total - 1;

    useEffect(() => {
        if (done) return;
        const t = window.setTimeout(() => setRound((r) => Math.min(total - 1, r + 1)), ROUND_MS);
        return () => window.clearTimeout(t);
    }, [round, total, done]);

    // Preload a pose texture per unit (run-pets carry their idle pose as bodyImage).
    const [texMap, setTexMap] = useState<Map<string, THREE.Texture | null>>(new Map());
    useEffect(() => {
        let live = true;
        const loader = new THREE.TextureLoader();
        for (const u of result.roster) {
            const url = petCardImage(u.pet, sharedImages);
            if (!url) continue;
            loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; if (live) setTexMap((prev) => new Map(prev).set(u.id, t)); });
        }
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result]);

    const fx = useMemo(() => {
        const m = new Map<string, { dmg: number; hit: boolean; acted: boolean }>();
        for (const e of result.events) {
            if (e.t !== round) continue;
            if (e.targetId && e.type === "hit") { const c = m.get(e.targetId) ?? { dmg: 0, hit: false, acted: false }; c.dmg += e.dmg ?? 0; c.hit = true; m.set(e.targetId, c); }
            if (e.actorId && (e.type === "attack" || e.type === "ability")) { const c = m.get(e.actorId) ?? { dmg: 0, hit: false, acted: false }; c.acted = true; m.set(e.actorId, c); }
        }
        return m;
    }, [result.events, round]);

    const resultLabel = result.result === "win" ? "Victory" : result.result === "loss" ? "Defeat" : "Draw";

    return createPortal((
        <div style={{ position: "fixed", inset: 0, zIndex: 200, width: "100vw", height: "100vh", overflow: "hidden", backgroundImage: `linear-gradient(rgba(8,11,20,0.55), rgba(8,11,20,0.82)), url(${gauntletHero})`, backgroundSize: "cover", backgroundPosition: "center" }}>
            <Canvas dpr={[1, 2]} gl={{ alpha: true, antialias: true }} camera={{ position: [0, 12.5, 10.5], fov: 42 }} onCreated={({ camera }) => camera.lookAt(0, 0.6, -0.8)}>
                <BoardScene result={result} round={round} fx={fx} texMap={texMap} />
            </Canvas>

            <div style={{ position: "absolute", top: "5%", left: 0, right: 0, textAlign: "center", color: "#fcd34d", font: "800 clamp(15px,2.4vw,22px) Cinzel, serif", textShadow: "0 2px 8px #000", pointerEvents: "none" }}>
                ⚔️ Round {Math.min(round, result.rounds)} / {result.rounds}
            </div>

            {done && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,7,18,0.5)" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ font: "900 42px Inter, sans-serif", color: resultLabel === "Victory" ? "#4ade80" : resultLabel === "Defeat" ? "#f87171" : "#facc15", textShadow: "0 2px 12px #000" }}>{resultLabel}</div>
                        <button onClick={onDone} style={{ marginTop: 14, padding: "9px 22px", borderRadius: 10, border: "1px solid #475569", background: "#f59e0b", color: "#0b1220", font: "800 0.95rem Inter, sans-serif", cursor: "pointer" }}>Continue →</button>
                    </div>
                </div>
            )}
        </div>
    ), document.body);
}
