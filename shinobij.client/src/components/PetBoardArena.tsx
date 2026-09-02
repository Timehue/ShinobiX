/*
 * PetBoardArena — the Pet Gauntlet BOARD fight view, rendered in 3D (r3f).
 *
 * A real tilted game board (Dota-Underlords style): the approved roster GLBs
 * fight on raised flagstone cells in their actual formation (3 deep × 5 across
 * per side), with pose-art standees retained only as a resilient fallback. It
 * plays a deterministic BoardResult
 * (lib/pet-board-sim) round-by-round — HP bars ease down, hits flash, faints
 * topple. It is its OWN renderer (not the 2v2 PetColiseumDuel); pure presentation
 * over the deterministic stream, so it never touches combat.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, Sparkles, useTexture } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import type { BoardResult } from "../lib/pet-board-sim";
import { BOARD_COLS } from "../lib/pet-board-sim";
import { petPoseImage, elementVfxKey } from "../lib/pet-battle-anim";
import { spriteBoundsFromAlpha, groundedSpriteLayout, DEFAULT_SPRITE_BOUNDS, type SpriteBounds } from "../lib/pet-coliseum-scene";
import type { Pet } from "../types/pet";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { petCombatModel, type PetCombatModelConfig } from "../lib/pet-3d-models";
import { petModelVariantSurface } from "../lib/pet-visual-variant";
import { petVisualQuality, type PetVisualQualityConfig } from "../lib/pet-visual-quality";
import { gauntletPetPresentationKey, gauntletTeamFacing, resolveGauntletBoardQuality } from "../lib/pet-gauntlet-presentation";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import { PetModelBoundary } from "./PetModelBoundary";
import { PetBattleRenderBoundary } from "./PetBattleRenderBoundary";
import gauntletHero from "../assets/coliseum/gauntlet-hero.webp";
import gauntletBoard from "../assets/coliseum/gauntlet-board.webp";
import "./PetBoardArena.css";

// PetGauntlet imports this renderer while the player is drafting/positioning.
// Warm the approved arena texture during that setup time so entering combat does
// not spend its first frames waiting on a cold image decode/upload.
useTexture.preload(gauntletBoard);

const STEP_STAGGER = 150;    // ms between sequential impacts within a round (so hits read one-by-one)
const ROWS = 6;              // 3 enemy + 3 player
// Pet positions are INSET from the floor plane so squads stand on the playable
// stone (the lit zones), not out on the fire border / corners. Columns spread
// across the width; the two sides sit either side of a centre no-man's-land gap
// (enemy in the far half, player in the near half). COL_SP > sprite width so
// adjacent pets in a row don't overlap into a blob.
const COL_SP = 1.8;          // horizontal spacing between columns → cols span ±3.6
const ROW_SP = 1.45;         // depth spacing between rows on one side
const CENTER_GAP = 1.0;      // half the empty gap between the two front lines
const cx = (col: number) => (col - (BOARD_COLS - 1) / 2) * COL_SP;
// boardRows 0..2 = enemy (far → centre); 3..5 = player (centre → near).
const cz = (boardRow: number) => (boardRow <= 2 ? -CENTER_GAP - (2 - boardRow) * ROW_SP : CENTER_GAP + (boardRow - 3) * ROW_SP);
// unit grid row (0 front … 2 back) → board row. Enemy fronts face player fronts at centre.
const boardRowOf = (u: BoardResult["roster"][number]) => (u.team === "enemy" ? 2 - Math.min(2, u.row) : 3 + Math.min(2, u.row));

// ── Pet sprite sizing ────────────────────────────────────────────────────────
// Each pose webp frames its creature at a DIFFERENT scale (a drake fills its
// frame; an otter is tiny in its margin). Drawing them on one fixed plane made
// pets wildly different sizes. We scan each sprite's alpha bounding box and size
// it so the VISIBLE creature is a consistent world height — then scale by rarity
// so rarer pets (dragons etc.) stand bigger than commons. Feet are grounded via
// groundedSpriteLayout (same math the Pet Coliseum uses).
const BASE_SUBJECT_H = 1.35;   // on-board height of a standard pet's body (world units)
const RARITY_SCALE: Record<string, number> = { standard: 0.9, rare: 1.0, legendary: 1.16, mythic: 1.32 };
const subjectHeightFor = (pet: Pet) => BASE_SUBJECT_H * (RARITY_SCALE[pet.rarity as string] ?? 1);
const boardModelHeight = (pet: Pet) => subjectHeightFor(pet) * 1.08;

type BoardSprite = { texture: THREE.Texture; bounds: SpriteBounds; aspect: number };
const _spriteCache = new Map<string, BoardSprite>();
/** Load a pose image, scan its alpha bbox (for sizing/grounding), build a texture. */
function loadBoardSprite(url: string): Promise<BoardSprite> {
    const cached = _spriteCache.get(url);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const w = img.naturalWidth || 96, h = img.naturalHeight || 96;
            let bounds = DEFAULT_SPRITE_BOUNDS;
            try {
                const S = 96;
                const cw = Math.max(8, Math.round(S * Math.min(1, w / Math.max(w, h))));
                const ch = Math.max(8, Math.round(S * Math.min(1, h / Math.max(w, h))));
                const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
                const ctx = cv.getContext("2d", { willReadFrequently: true })!;
                ctx.drawImage(img, 0, 0, cw, ch);
                bounds = spriteBoundsFromAlpha(ctx.getImageData(0, 0, cw, ch).data, cw, ch);
            } catch { /* keep default bounds */ }
            const texture = new THREE.Texture(img);
            texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; texture.needsUpdate = true;
            const out: BoardSprite = { texture, bounds, aspect: w / Math.max(1, h) };
            _spriteCache.set(url, out);
            resolve(out);
        };
        img.onerror = () => resolve({ texture: new THREE.Texture(), bounds: DEFAULT_SPRITE_BOUNDS, aspect: 1 });
        img.src = url;
    });
}

// ── Element VFX: a tinted orb flies attacker→target, then the element's burst
// animation (the bundled jutsu FX frames) plays on impact. ───────────────────
const EL_GLOW: Record<string, string> = { Fire: "#ff7a2f", Water: "#39b6ff", Wind: "#74f0d0", Lightning: "#ffe14d", Earth: "#caa46a" };
const elGlow = (el?: string | null) => (el && EL_GLOW[el]) || "#cbd5e1";
const EL_FX: Record<string, { primary: string; secondary: string; shape: "fire" | "water" | "wind" | "lightning" | "earth" | "neutral" }> = {
    Fire: { primary: "#ff6a2b", secondary: "#ffd166", shape: "fire" },
    Water: { primary: "#38bdf8", secondary: "#bff8ff", shape: "water" },
    Wind: { primary: "#5eead4", secondary: "#e0fff8", shape: "wind" },
    Lightning: { primary: "#fde047", secondary: "#ffffff", shape: "lightning" },
    Earth: { primary: "#c89b62", secondary: "#f2d29b", shape: "earth" },
};
const elementFx = (element?: string | null) => (element && EL_FX[element]) || { primary: "#cbd5e1", secondary: "#ffffff", shape: "neutral" as const };

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
type Vec3 = [number, number, number];

function BoardProjectile({ from, to, element, onArrive }: { from: Vec3; to: Vec3; element?: string | null; onArrive: () => void }) {
    const grp = useRef<THREE.Group>(null);
    const core = useRef<THREE.Group>(null);
    const born = useRef<number | null>(null);
    const fired = useRef(false);
    const fx = elementFx(element);
    useFrame((state) => {
        if (born.current === null) born.current = state.clock.elapsedTime;
        const t = Math.min(1, (state.clock.elapsedTime - born.current) / 0.26);
        const g = grp.current;
        if (g) g.position.set(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + Math.sin(t * Math.PI) * 0.7, from[2] + (to[2] - from[2]) * t);
        if (core.current) {
            core.current.scale.setScalar(0.82 + Math.sin(state.clock.elapsedTime * 28) * 0.16);
            core.current.rotation.x += 0.08;
            core.current.rotation.y += fx.shape === "lightning" ? 0.22 : 0.12;
        }
        if (t >= 1 && !fired.current) { fired.current = true; onArrive(); }
    });
    return (
        <group ref={grp} position={from}>
            <group ref={core}>
                {fx.shape === "fire" ? <mesh scale={[0.78, 1.35, 0.78]}><dodecahedronGeometry args={[0.18, 0]} /><meshBasicMaterial color={fx.primary} toneMapped={false} /></mesh>
                    : fx.shape === "water" ? <mesh scale={[0.86, 1.18, 0.86]}><sphereGeometry args={[0.17, 12, 8]} /><meshBasicMaterial color={fx.primary} transparent opacity={0.9} toneMapped={false} /></mesh>
                        : fx.shape === "wind" ? <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.18, 0.055, 6, 18]} /><meshBasicMaterial color={fx.primary} toneMapped={false} /></mesh>
                            : fx.shape === "lightning" ? <mesh scale={[0.7, 1.65, 0.7]}><octahedronGeometry args={[0.18, 0]} /><meshBasicMaterial color={fx.secondary} toneMapped={false} /></mesh>
                                : fx.shape === "earth" ? <mesh><dodecahedronGeometry args={[0.19, 0]} /><meshStandardMaterial color={fx.primary} emissive={fx.primary} emissiveIntensity={0.45} roughness={0.8} /></mesh>
                                    : <mesh><icosahedronGeometry args={[0.16, 1]} /><meshBasicMaterial color={fx.primary} toneMapped={false} /></mesh>}
            </group>
            <Billboard>
                <mesh><planeGeometry args={[1.05, 1.05]} /><meshBasicMaterial map={orbTex()} color={fx.primary} transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></mesh>
                <mesh position={[0, 0, -0.02]} scale={[2.15, 0.36, 1]}><planeGeometry args={[1, 1]} /><meshBasicMaterial map={orbTex()} color={fx.secondary} transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></mesh>
            </Billboard>
        </group>
    );
}

function BoardBurst({ pos, frames, element, onDone }: { pos: Vec3; frames: string[]; element?: string | null; onDone: () => void }) {
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const ring = useRef<THREE.Mesh>(null);
    const ringMat = useRef<THREE.MeshBasicMaterial>(null);
    const fragments = useRef<THREE.Group>(null);
    const born = useRef<number | null>(null);
    const texes = useMemo(() => frames.map(fxTex), [frames]);
    const fx = elementFx(element);
    useFrame((state) => {
        if (born.current === null) born.current = state.clock.elapsedTime;
        const t = (state.clock.elapsedTime - born.current) / 0.48;
        if (t >= 1) { onDone(); return; }
        const m = mat.current;
        if (m && texes.length) {
            m.map = texes[Math.min(texes.length - 1, Math.floor(t * texes.length))];
            m.opacity = 1 - t * t;
            m.needsUpdate = true;
        }
        if (ring.current) ring.current.scale.setScalar(0.3 + t * 1.75);
        if (ringMat.current) ringMat.current.opacity = (1 - t) * 0.78;
        if (fragments.current) {
            fragments.current.scale.setScalar(0.25 + t * 1.9);
            fragments.current.rotation.y += 0.08;
        }
    });
    return (
        <group>
            {texes.length ? <Billboard position={pos}><mesh><planeGeometry args={[3.2, 3.2]} /><meshBasicMaterial ref={mat} color={fx.secondary} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></mesh></Billboard> : null}
            <mesh ref={ring} position={[pos[0], 0.08, pos[2]]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.54, 0.72, 36]} />
                <meshBasicMaterial ref={ringMat} color={fx.primary} transparent opacity={0.75} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            <group ref={fragments} position={pos}>
                {[0, 1, 2, 3, 4, 5].map((i) => {
                    const angle = i / 6 * Math.PI * 2;
                    return (
                        <mesh key={i} position={[Math.cos(angle) * 0.45, 0.12 + (i % 2) * 0.22, Math.sin(angle) * 0.45]} rotation={[angle, angle * 0.7, 0]}>
                            {fx.shape === "wind" ? <torusGeometry args={[0.08, 0.025, 4, 8]} /> : <tetrahedronGeometry args={[0.08, 0]} />}
                            <meshBasicMaterial color={i % 2 ? fx.secondary : fx.primary} transparent opacity={0.82} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
                        </mesh>
                    );
                })}
            </group>
        </group>
    );
}

function BoardUnitPlate({ pet, team, hp, maxHp, star, y }: {
    pet: Pet; team: "player" | "enemy"; hp: number; maxHp: number; star?: number; y: number;
}) {
    const pct = Math.max(0, Math.min(100, hp / Math.max(1, maxHp) * 100));
    const element = elGlow(pet.element);
    return (
        <Html position={[0, y, 0]} center distanceFactor={10} pointerEvents="none" zIndexRange={[20, 0]}>
            <div className={`gauntlet-unitplate gauntlet-unitplate--${team}`} style={{ ["--pet-element" as string]: element }}>
                <div className="gauntlet-unitplate__name">
                    <span className="gauntlet-unitplate__team-mark" />
                    <span>{pet.name}</span>
                    {!!star && star > 1 ? <b>{"★".repeat(Math.min(3, star))}</b> : null}
                </div>
                <div className="gauntlet-unitplate__track">
                    <span className="gauntlet-unitplate__hp" style={{ width: `${pct}%` }} />
                </div>
            </div>
        </Html>
    );
}

function Standee({ x, z, sprite, pet, team, hp, maxHp, alive, element, star, pulse, attackPulse }: {
    x: number; z: number; sprite: BoardSprite | undefined; pet: Pet; team: "player" | "enemy"; hp: number; maxHp: number;
    alive: boolean; element?: string | null; star?: number; pulse: number; attackPulse: number;
}) {
    const grp = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const hitAt = useRef(-1);
    const attackAt = useRef(-1);
    const deadAt = useRef<number | null>(null);
    // Flash + recoil each time a hit LANDS on this unit (pulse increments per impact).
    useEffect(() => { if (pulse > 0) hitAt.current = performance.now(); }, [pulse]);
    useEffect(() => { if (attackPulse > 0) attackAt.current = performance.now(); }, [attackPulse]);
    // Stamp the moment of death so the faint can animate (shrink/sink, in place).
    useEffect(() => { if (!alive) { if (deadAt.current === null) deadAt.current = performance.now(); } else deadAt.current = null; }, [alive]);
    useFrame(() => {
        const g = grp.current;
        if (g) {
            const since = (performance.now() - hitAt.current) / 1000;
            const attackSince = (performance.now() - attackAt.current) / 1000;
            const k = hitAt.current > 0 && since < 0.34 ? Math.sin(since / 0.34 * Math.PI) : 0;   // 0→1→0
            const lunge = attackAt.current > 0 && attackSince < 0.42 ? Math.sin(attackSince / 0.42 * Math.PI) * 0.22 : 0;
            if (alive) {
                g.position.x = x + Math.sin(since * 60) * 0.06 * k;   // recoil shake
                g.position.z = z + (team === "player" ? -lunge : lunge) + (team === "player" ? k : -k) * 0.08;
                g.position.y = 0; g.rotation.z = 0; g.scale.setScalar(1);
                if (mat.current) { const tint = 1 - 0.5 * k; mat.current.color.setRGB(1, tint, tint); }   // red flash on hit
            } else {
                // FAINT: shrink + sink straight down IN PLACE (no sideways topple), darkened.
                const dp = deadAt.current !== null ? Math.min(1, (performance.now() - deadAt.current) / 450) : 1;
                g.position.x = x; g.position.z = z; g.rotation.z = 0;
                g.scale.setScalar(1 - 0.72 * dp);
                g.position.y = -0.45 * dp;
                if (mat.current) mat.current.color.setRGB(0.4, 0.4, 0.46);
            }
        }
    });
    const layout = useMemo(
        () => groundedSpriteLayout(sprite?.bounds ?? DEFAULT_SPRITE_BOUNDS, sprite?.aspect ?? 1, subjectHeightFor(pet), false),
        [sprite, pet],
    );
    const glow = (element && { Fire: "#fb923c", Water: "#38bdf8", Wind: "#5eead4", Lightning: "#facc15", Earth: "#a3a380" }[element]) || "#94a3b8";
    const ringR = Math.max(0.5, layout.contentWorldW * 0.5 + 0.12);   // ring tracks the pet's footprint
    return (
        <group ref={grp} position={[x, 0, z]}>
            {/* contact shadow on the floor */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0.08]}>
                <circleGeometry args={[ringR * 0.9, 24]} />
                <meshBasicMaterial color="#000" transparent opacity={0.32} />
            </mesh>
            {/* element ring */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0.08]}>
                <ringGeometry args={[ringR, ringR + 0.12, 28]} />
                <meshBasicMaterial color={glow} transparent opacity={alive ? 0.5 : 0.12} />
            </mesh>
            <Billboard follow lockX lockZ position={[0, 0.06, 0]}>
                {/* Grounded, rarity-scaled cutout: the alpha-scanned bounds size the
                    creature to a consistent world height + sit its feet on the cell.
                    Opaque alpha-test (≥0.4) so the body is solid, not see-through. */}
                <mesh visible={!!sprite} position={[layout.meshX, layout.meshY, 0]}>
                    <planeGeometry args={[layout.planeW, layout.planeH]} />
                    <meshBasicMaterial ref={mat} map={sprite?.texture ?? undefined} alphaTest={0.4} toneMapped={false} />
                </mesh>
            </Billboard>
            <BoardUnitPlate pet={pet} team={team} hp={hp} maxHp={maxHp} star={star} y={layout.contentWorldH + 0.5} />
        </group>
    );
}

function ModelFighter({ x, z, pet, team, config, quality, hp, maxHp, alive, star, pulse, attackPulse, supportPulse, onModelFail }: {
    x: number; z: number; pet: Pet; team: "player" | "enemy"; config: PetCombatModelConfig; quality: PetVisualQualityConfig;
    hp: number; maxHp: number; alive: boolean; star?: number; pulse: number; attackPulse: number; supportPulse: number; onModelFail: () => void;
}) {
    const body = useRef<THREE.Group>(null);
    const aura = useRef<THREE.MeshBasicMaterial>(null);
    const supportRing = useRef<THREE.Mesh>(null);
    const supportMat = useRef<THREE.MeshBasicMaterial>(null);
    const hitAt = useRef(-10);
    const attackAt = useRef(-10);
    const supportAt = useRef(-10);
    const deathAt = useRef<number | null>(null);
    const [facingX, facingZ] = gauntletTeamFacing(team);
    const height = boardModelHeight(pet);
    const modelScale = height / Math.max(0.001, config.targetHeight);
    const glow = elGlow(pet.element);
    const identityKey = gauntletPetPresentationKey(pet);
    const frame = useRef<PetModelFrame>({
        ...DEFAULT_PET_MODEL_FRAME,
        faceX: facingX,
        faceZ: facingZ,
        lockTargetFacing: true,
        performanceVariant: (Math.abs(identityKey.split("").reduce((n, c) => n + c.charCodeAt(0), 0)) % 3) as 0 | 1 | 2,
    });

    useEffect(() => { if (pulse > 0) hitAt.current = performance.now() / 1000; }, [pulse]);
    useEffect(() => { if (attackPulse > 0) attackAt.current = performance.now() / 1000; }, [attackPulse]);
    useEffect(() => { if (supportPulse > 0) supportAt.current = performance.now() / 1000; }, [supportPulse]);
    useEffect(() => {
        if (!alive && deathAt.current === null) deathAt.current = performance.now() / 1000;
        if (alive) deathAt.current = null;
    }, [alive]);

    useFrame(() => {
        const now = performance.now() / 1000;
        const hitAge = now - hitAt.current;
        const attackAge = now - attackAt.current;
        const supportAge = now - supportAt.current;
        const hitK = hitAge < 0.36 ? Math.sin(hitAge / 0.36 * Math.PI) : 0;
        const attackK = attackAge < 0.64 ? Math.sin(attackAge / 0.64 * Math.PI) : 0;
        const supportK = supportAge < 0.8 ? Math.sin(supportAge / 0.8 * Math.PI) : 0;
        const f = frame.current;
        f.faceX = facingX;
        f.faceZ = facingZ;
        f.hit = hitK;
        f.impactPower = hitK > 0 ? 0.72 : 0.55;
        f.casting = alive && supportK > 0;
        f.desperate = alive && hp / Math.max(1, maxHp) < 0.26;
        f.motion = !alive
            ? "dead"
            : supportAge < 0.62
                ? "windup"
                : attackAge < 0.16
                    ? "windup"
                    : attackAge < 0.5
                        ? "strike"
                        : attackAge < 0.68
                            ? "recover"
                            : hitAge < 0.3
                                ? "stagger"
                                : "idle";
        if (body.current) {
            const deathAge = deathAt.current === null ? 0 : Math.min(1, (now - deathAt.current) / 0.85);
            body.current.position.set(
                Math.sin(hitAge * 58) * hitK * 0.055,
                -deathAge * 0.08,
                facingZ * attackK * 0.2 - facingZ * hitK * 0.1,
            );
            body.current.scale.setScalar(modelScale * (1 - deathAge * 0.18));
        }
        if (aura.current) aura.current.opacity = alive ? 0.26 + Math.sin(now * 2.4 + x) * 0.04 + attackK * 0.22 : 0.08;
        if (supportRing.current) supportRing.current.scale.setScalar(0.6 + supportK * 1.3);
        if (supportMat.current) supportMat.current.opacity = supportK * 0.72;
    });

    return (
        <group position={[x, 0, z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
                <circleGeometry args={[0.54, 32]} />
                <meshBasicMaterial color="#000" transparent opacity={0.4} depthWrite={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
                <ringGeometry args={[0.55, 0.68, 36]} />
                <meshBasicMaterial ref={aura} color={glow} transparent opacity={0.3} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh ref={supportRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.065, 0]}>
                <ringGeometry args={[0.48, 0.62, 36]} />
                <meshBasicMaterial ref={supportMat} color="#8fffd2" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            <group ref={body} scale={modelScale}>
                <PetModelBoundary onFail={onModelFail} fallback={(
                    <mesh position={[0, config.targetHeight * 0.45, 0]}>
                        <capsuleGeometry args={[config.targetHeight * 0.2, config.targetHeight * 0.52, 4, 10]} />
                        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={0.34} roughness={0.56} />
                    </mesh>
                )}>
                    <Suspense fallback={(
                        <mesh position={[0, config.targetHeight * 0.45, 0]}>
                            <capsuleGeometry args={[config.targetHeight * 0.2, config.targetHeight * 0.52, 4, 10]} />
                            <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={0.34} roughness={0.56} />
                        </mesh>
                    )}>
                        <PetModel3D
                            config={config}
                            frame={frame}
                            element={pet.element}
                            showIdentity={quality.id !== "low"}
                            surfaceTreatment={petModelVariantSurface(pet)}
                        />
                    </Suspense>
                </PetModelBoundary>
            </group>
            <BoardUnitPlate pet={pet} team={team} hp={hp} maxHp={maxHp} star={star} y={height + 0.55} />
        </group>
    );
}

function ArenaBrazier({ x, z, quality }: { x: number; z: number; quality: PetVisualQualityConfig }) {
    const flame = useRef<THREE.Mesh>(null);
    useFrame((state) => {
        if (!flame.current) return;
        const pulse = 0.88 + Math.sin(state.clock.elapsedTime * 6 + x) * 0.12;
        flame.current.scale.set(0.9 + pulse * 0.16, pulse, 0.9 + pulse * 0.16);
        flame.current.rotation.y += 0.025;
    });
    return (
        <group position={[x, 0, z]}>
            <mesh position={[0, 0.28, 0]} castShadow={quality.modelShadows}>
                <cylinderGeometry args={[0.23, 0.32, 0.56, 8]} />
                <meshStandardMaterial color="#262838" roughness={0.82} metalness={0.22} />
            </mesh>
            <mesh ref={flame} position={[0, 0.75, 0]}>
                <octahedronGeometry args={[0.23, 1]} />
                <meshBasicMaterial color="#ffb347" transparent opacity={0.92} toneMapped={false} />
            </mesh>
            {quality.dynamicPetLight ? <pointLight color="#ff7a2f" intensity={2.2} distance={5.2} decay={2} position={[0, 1, 0]} /> : null}
        </group>
    );
}

function ArenaFloor({ quality }: { quality: PetVisualQualityConfig }) {
    // The floor is the approved Gauntlet map, not merely a decorative underlay.
    // useTexture participates in R3F Suspense, so the scene cannot flash the old
    // flat fallback board while an ad-hoc TextureLoader is still in flight.
    const sourceFloor = useTexture(gauntletBoard);
    const gl = useThree((state) => state.gl);
    const floor = useMemo(() => {
        // useTexture owns its cached source. Configure a scene-owned clone so
        // repeated Gauntlet mounts share the decode without mutating hook state.
        const texture = sourceFloor.clone();
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        return texture;
    }, [sourceFloor, gl]);
    useEffect(() => () => floor.dispose(), [floor]);
    const cells = useMemo(() => Array.from({ length: ROWS * BOARD_COLS }, (_, i) => ({
        row: Math.floor(i / BOARD_COLS),
        col: i % BOARD_COLS,
    })), []);
    return (
        <group>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.35, 0]}>
                <planeGeometry args={[80, 70]} />
                <meshStandardMaterial color="#03040b" roughness={1} />
            </mesh>
            <mesh position={[0, -0.23, 0]} receiveShadow>
                <boxGeometry args={[11.45, 0.42, 11.45]} />
                <meshStandardMaterial color="#0a0d12" roughness={0.94} metalness={0.03} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
                <planeGeometry args={[11, 11]} />
                <meshBasicMaterial map={floor} color="#ffffff" toneMapped={false} />
            </mesh>
            {/* Unlit art stays faithful to the authored map; this transparent
                catcher adds real-time fighter shadows without washing it out. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
                <planeGeometry args={[10.95, 10.95]} />
                <shadowMaterial transparent opacity={quality.modelShadows ? 0.34 : 0} />
            </mesh>
            {cells.map(({ row, col }) => {
                const team = row <= 2 ? "enemy" : "player";
                const edge = row === 2 || row === 3;
                return (
                    <group key={`${row}-${col}`} position={[cx(col), 0.036, cz(row)]}>
                        <mesh>
                            <boxGeometry args={[1.58, 0.035, 1.14]} />
                            <meshStandardMaterial
                                color={team === "player" ? "#2563eb" : "#dc2626"}
                                emissive={team === "player" ? "#2563eb" : "#dc2626"}
                                emissiveIntensity={edge ? 0.3 : 0.18}
                                roughness={0.58}
                                metalness={0.02}
                                transparent
                                opacity={edge ? 0.17 : 0.105}
                                depthWrite={false}
                            />
                        </mesh>
                        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
                            <ringGeometry args={[0.43, 0.455, 32]} />
                            <meshBasicMaterial color={team === "player" ? "#7dd3fc" : "#fda4af"} transparent opacity={edge ? 0.34 : 0.18} depthWrite={false} toneMapped={false} />
                        </mesh>
                    </group>
                );
            })}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.083, 0]}>
                <ringGeometry args={[0.58, 0.72, 48]} />
                <meshBasicMaterial color="#f8d66d" transparent opacity={0.58} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.075, 0]}>
                <circleGeometry args={[0.3, 6]} />
                <meshBasicMaterial color="#f8d66d" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
            </mesh>
            <ArenaBrazier x={-5.2} z={-4.7} quality={quality} />
            <ArenaBrazier x={5.2} z={-4.7} quality={quality} />
            <ArenaBrazier x={-5.2} z={4.7} quality={quality} />
            <ArenaBrazier x={5.2} z={4.7} quality={quality} />
        </group>
    );
}

function BoardCameraRig({ impactBeat }: { impactBeat: number }) {
    const { camera, size } = useThree();
    const impactAt = useRef(-10);
    const desired = useRef(new THREE.Vector3());
    const look = useRef(new THREE.Vector3(0, 0, 0.45));
    useEffect(() => { if (impactBeat > 0) impactAt.current = performance.now() / 1000; }, [impactBeat]);
    useFrame((state) => {
        const aspect = size.width / Math.max(1, size.height);
        const portraitScale = Math.max(1, 0.78 / Math.max(0.42, aspect));
        const distance = 13.5 * portraitScale;
        const age = performance.now() / 1000 - impactAt.current;
        const shake = age < 0.2 ? (1 - age / 0.2) * 0.085 : 0;
        const drift = Math.sin(state.clock.elapsedTime * 0.18) * 0.18;
        desired.current.set(
            drift + Math.sin(state.clock.elapsedTime * 73) * shake,
            distance * 1.2 + Math.sin(state.clock.elapsedTime * 91) * shake * 0.45,
            distance * 0.84 + Math.cos(state.clock.elapsedTime * 67) * shake,
        );
        camera.position.lerp(desired.current, 0.075);
        look.current.x = drift * 0.18;
        camera.lookAt(look.current);
    });
    return null;
}

function BoardPostFx({ quality }: { quality: PetVisualQualityConfig }) {
    if (quality.id === "low") return null;
    return (
        <EffectComposer>
            <Bloom luminanceThreshold={0.72} luminanceSmoothing={0.2} intensity={quality.id === "high" ? 0.48 : 0.24} mipmapBlur />
        </EffectComposer>
    );
}

function BoardScene({ result, round, spriteMap, modelConfigs, quality, stars }: {
    result: BoardResult;
    round: number;
    spriteMap: Map<string, BoardSprite>;
    modelConfigs: Map<string, PetCombatModelConfig>;
    quality: PetVisualQualityConfig;
    stars?: Record<string, number>;
}) {
    const idRef = useRef(0);
    const [shots, setShots] = useState<Array<{ id: number; from: Vec3; to: Vec3; targetId: string; element?: string | null; dmg: number; crit: boolean }>>([]);
    const [bursts, setBursts] = useState<Array<{ id: number; pos: Vec3; frames: string[]; element?: string | null }>>([]);
    const [pops, setPops] = useState<Array<{ id: number; pos: Vec3; text: string; color: string; size: number }>>([]);
    const [hpView, setHpView] = useState<Record<string, number>>({});   // live, per-impact HP (drives the bars)
    const [pulses, setPulses] = useState<Record<string, number>>({});   // per-unit hit counter (drives the flash)
    const [attackPulses, setAttackPulses] = useState<Record<string, number>>({});
    const [supportPulses, setSupportPulses] = useState<Record<string, number>>({});
    const [failedModels, setFailedModels] = useState<ReadonlySet<string>>(() => new Set());
    const [impactBeat, setImpactBeat] = useState(0);
    const popTimers = useRef(new Set<number>());
    useEffect(() => () => {
        for (const timer of popTimers.current) window.clearTimeout(timer);
        popTimers.current.clear();
    }, []);

    const maxHpMap = useMemo(() => {
        const m: Record<string, number> = {};
        for (const s of result.snapshots[0]?.units ?? []) m[s.id] = s.maxHp;
        return m;
    }, [result]);
    const unitOf = (id?: string) => (id ? result.roster.find((x) => x.id === id) : undefined);
    const worldOf = (id?: string): Vec3 | null => { const u = unitOf(id); return u ? [cx(u.col), boardModelHeight(u.pet) * 0.55, cz(boardRowOf(u))] : null; };
    const headOf = (id?: string): Vec3 | null => { const u = unitOf(id); return u ? [cx(u.col), boardModelHeight(u.pet) + 0.62, cz(boardRowOf(u))] : null; };

    const spawnBurst = (pos: Vec3, element?: string | null) => {
        const frames = bundledJutsuFxFrames(elementVfxKey(element)) ?? [];
        setBursts((b) => [...b, { id: ++idRef.current, pos, frames, element }]);
    };
    const spawnPop = (id: string, text: string, color: string, size: number) => {
        const pos = headOf(id); if (!pos) return;
        const pid = ++idRef.current;
        setPops((p) => [...p, { id: pid, pos, text, color, size }]);
        const timer = window.setTimeout(() => {
            popTimers.current.delete(timer);
            setPops((p) => p.filter((x) => x.id !== pid));
        }, 950);
        popTimers.current.add(timer);
    };
    // A hit LANDS: drop the target's live HP, flash it, pop the damage (gold + "!" on crit).
    const landDamage = (id: string, dmg: number, crit: boolean) => {
        setHpView((m) => ({ ...m, [id]: Math.max(0, (m[id] ?? maxHpMap[id] ?? 0) - dmg) }));
        setPulses((m) => ({ ...m, [id]: (m[id] ?? 0) + 1 }));
        setImpactBeat((n) => n + 1);
        spawnPop(id, crit ? `${dmg}!` : `${dmg}`, crit ? "#fde047" : "#fb7185", crit ? 30 : 21);
    };

    // Seed the live HP at the START of this round, then play the round's impacts in
    // SEQUENCE (staggered) so each hit/heal is readable — projectile → number → bar
    // drain all land together. Presentation only: HP comes straight from sim events,
    // and the per-round snapshot is the authoritative seed, so it can't drift.
    useEffect(() => {
        const start = result.snapshots[Math.max(0, round - 1)];
        const seed: Record<string, number> = {};
        for (const u of start?.units ?? []) seed[u.id] = u.hp;
        setHpView(seed);   // eslint-disable-line react-hooks/set-state-in-effect
        setPulses({});
        setAttackPulses({});
        setSupportPulses({});
        const impacts = result.events.filter((e) => e.t === round && (e.type === "hit" || e.type === "heal" || e.type === "shield"));
        const timers: number[] = [];
        impacts.forEach((e, i) => {
            timers.push(window.setTimeout(() => {
                if (e.type === "hit") {
                    if (e.actorId) setAttackPulses((m) => ({ ...m, [e.actorId!]: (m[e.actorId!] ?? 0) + 1 }));
                    const from = worldOf(e.actorId); const to = worldOf(e.targetId);
                    if (from && to && e.targetId) setShots((s) => [...s, { id: ++idRef.current, from, to, targetId: e.targetId!, element: e.element, dmg: e.dmg ?? 0, crit: !!e.crit }]);
                    else if (e.targetId) landDamage(e.targetId, e.dmg ?? 0, !!e.crit);
                } else if (e.targetId) {
                    const heal = e.type === "heal";
                    if (e.actorId) setSupportPulses((m) => ({ ...m, [e.actorId!]: (m[e.actorId!] ?? 0) + 1 }));
                    if (heal) setHpView((m) => ({ ...m, [e.targetId!]: Math.min(maxHpMap[e.targetId!] ?? Infinity, (m[e.targetId!] ?? 0) + (e.dmg ?? 0)) }));
                    spawnPop(e.targetId, `+${e.dmg ?? 0}`, heal ? "#4ade80" : "#67e8f9", 20);   // green heal / cyan shield
                }
            }, i * STEP_STAGGER));
        });
        return () => timers.forEach((t) => window.clearTimeout(t));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [round, result]);
    return (
        <>
            <fog attach="fog" args={["#070914", 18, 46]} />
            <ambientLight intensity={0.62} />
            <hemisphereLight args={["#8aa9ff", "#2b1720", 1.15]} />
            <directionalLight position={[-7, 13, 8]} intensity={2.2} color="#fff1cf" castShadow={quality.modelShadows} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
            <pointLight position={[0, 4.5, -4]} intensity={2.4} color="#ef445a" distance={13} decay={2} />
            <pointLight position={[0, 4.5, 4]} intensity={2.4} color="#3b82f6" distance={13} decay={2} />
            <Suspense fallback={null}>
                <ArenaFloor quality={quality} />
            </Suspense>
            <Sparkles count={quality.ambientParticles} scale={[12, 3.2, 11]} position={[0, 1.4, 0]} size={1.25} speed={0.22} opacity={0.32} color="#f8d68a" />
            {result.roster.map((u) => {
                const mhp = maxHpMap[u.id] ?? u.pet.hp;
                const hp = hpView[u.id] ?? mhp;
                const config = modelConfigs.get(u.id);
                const common = {
                    x: cx(u.col),
                    z: cz(boardRowOf(u)),
                    pet: u.pet,
                    team: u.team,
                    element: u.pet.element,
                    star: stars?.[u.pet.id],
                    hp,
                    maxHp: mhp,
                    alive: hp > 0,
                    pulse: pulses[u.id] ?? 0,
                    attackPulse: attackPulses[u.id] ?? 0,
                };
                if (config && !failedModels.has(u.id)) {
                    return (
                        <ModelFighter
                            key={u.id}
                            {...common}
                            config={config}
                            quality={quality}
                            supportPulse={supportPulses[u.id] ?? 0}
                            onModelFail={() => setFailedModels((current) => {
                                if (current.has(u.id)) return current;
                                const next = new Set(current);
                                next.add(u.id);
                                return next;
                            })}
                        />
                    );
                }
                return (
                    <Standee key={u.id} {...common} sprite={spriteMap.get(u.id)} />
                );
            })}
            {shots.map((s) => (
                <BoardProjectile key={s.id} from={s.from} to={s.to} element={s.element}
                    onArrive={() => { setShots((x) => x.filter((y) => y.id !== s.id)); spawnBurst(s.to, s.element); landDamage(s.targetId, s.dmg, s.crit); }} />
            ))}
            {bursts.map((b) => (
                <BoardBurst key={b.id} pos={b.pos} frames={b.frames} element={b.element} onDone={() => setBursts((x) => x.filter((y) => y.id !== b.id))} />
            ))}
            {pops.map((p) => (
                <Html key={p.id} position={p.pos} center style={{ pointerEvents: "none", userSelect: "none" }}>
                    <div className="gauntlet-damage-pop" style={{ fontSize: p.size, color: p.color }}>{p.text}</div>
                </Html>
            ))}
            <BoardCameraRig impactBeat={impactBeat} />
            <BoardPostFx quality={quality} />
        </>
    );
}

function BoardContextGuard({ onLost }: { onLost: () => void }) {
    const gl = useThree((state) => state.gl);
    useEffect(() => {
        const canvas = gl.domElement;
        const handleLost = (event: Event) => {
            event.preventDefault();
            onLost();
        };
        canvas.addEventListener("webglcontextlost", handleLost);
        return () => canvas.removeEventListener("webglcontextlost", handleLost);
    }, [gl, onLost]);
    return null;
}

function BoardRenderRecovery() {
    return (
        <div className="gauntlet-board-recovery" role="status" aria-live="polite">
            <strong>Battle resolved safely</strong>
            <span>The 3D arena was released to protect this device. Your Gauntlet run and result are intact.</span>
        </div>
    );
}

export function PetBoardArena({ result, sharedImages = {}, stars, onDone }: { result: BoardResult; sharedImages?: Record<string, string>; stars?: Record<string, number>; onDone: () => void }) {
    const total = result.snapshots.length;
    const [round, setRound] = useState(0);
    const [arenaFailed, setArenaFailed] = useState(false);
    const done = round >= total - 1;
    const quality = useMemo(() => {
        const requested = petVisualQuality();
        if (typeof window === "undefined") return requested;
        // URL overrides are deliberate QA controls. Stored preferences are
        // capped on a model-heavy mobile round because stability wins there.
        if (new URLSearchParams(window.location.search).has("petQuality")) return requested;
        const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8);
        return resolveGauntletBoardQuality(requested, result.roster.length, window.innerWidth, memory);
    }, [result.roster.length]);
    const handleArenaFailure = useCallback(() => setArenaFailed(true), []);
    const modelConfigs = useMemo(() => {
        const configs = new Map<string, PetCombatModelConfig>();
        for (const unit of result.roster) {
            const config = petCombatModel(unit.pet);
            if (config) configs.set(unit.id, config);
        }
        return configs;
    }, [result]);

    // The portal is the only pet-combat takeover mounted by the Gauntlet, so it
    // owns scroll locking while present without disturbing a class another mode
    // may already have installed.
    useEffect(() => {
        const hadClass = document.body.classList.contains("pet-combat-active");
        document.body.classList.add("pet-combat-active");
        return () => { if (!hadClass) document.body.classList.remove("pet-combat-active"); };
    }, []);

    // Start GLB + atlas warm-up immediately. Suspense shows a readable elemental
    // proxy during a cold load, and unsupported identities use pose-art below.
    useEffect(() => {
        void import("../lib/pet-model-preload")
            .then((module) => module.preloadPetColiseumModels(result.roster.map((unit) => unit.pet)))
            .catch(() => undefined);
    }, [result]);

    // How many HP-changing impacts each round has — the round's on-screen dwell
    // scales with it, so a big flurry gets time to read instead of flashing past.
    const impactsByRound = useMemo(() => {
        const m = new Array(total).fill(0);
        for (const e of result.events) if ((e.type === "hit" || e.type === "heal" || e.type === "shield") && e.t < total) m[e.t] += 1;
        return m;
    }, [result, total]);

    useEffect(() => {
        if (done) return;
        const dwell = Math.min(2000, 520 + (impactsByRound[round] ?? 0) * 180);   // adaptive, slower-paced
        const t = window.setTimeout(() => setRound((r) => Math.min(total - 1, r + 1)), dwell);
        return () => window.clearTimeout(t);
    }, [round, total, done, impactsByRound]);

    // Preload the lightweight pose for every unit. Approved GLBs still render by
    // default; this is the immediate, identity-correct fallback if one model
    // fails after Suspense (missing CDN file, corrupt cache, or GPU rejection).
    const [spriteMap, setSpriteMap] = useState<Map<string, BoardSprite>>(new Map());
    useEffect(() => {
        let live = true;
        for (const u of result.roster) {
            const url = petPoseImage(u.pet, sharedImages);
            if (!url) continue;
            void loadBoardSprite(url).then((s) => { if (live) setSpriteMap((prev) => new Map(prev).set(u.id, s)); });
        }
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [result, modelConfigs]);

    const resultLabel = result.result === "win" ? "Victory" : result.result === "loss" ? "Defeat" : "Draw";
    const currentSnapshot = result.snapshots[Math.min(round, total - 1)] ?? result.snapshots[0];
    const teamSummary = (team: "player" | "enemy") => {
        const rosterIds = new Set(result.roster.filter((unit) => unit.team === team).map((unit) => unit.id));
        const units = (currentSnapshot?.units ?? []).filter((unit) => rosterIds.has(unit.id));
        const hp = units.reduce((sum, unit) => sum + Math.max(0, unit.hp), 0);
        const maxHp = units.reduce((sum, unit) => sum + Math.max(1, unit.maxHp), 0) || 1;
        return { alive: units.filter((unit) => unit.alive).length, total: units.length, pct: Math.max(0, Math.min(100, hp / maxHp * 100)) };
    };
    const player = teamSummary("player");
    const enemy = teamSummary("enemy");

    return createPortal((
        <div
            className="pet-combat-takeover gauntlet-board-takeover"
            data-testid="pet-gauntlet-3d-arena"
            data-arena-map="stone-lava"
            data-model-count={modelConfigs.size}
            style={{ backgroundImage: `linear-gradient(rgba(6,8,17,0.48), rgba(5,7,16,0.88)), url(${gauntletHero})` }}
        >
            <PetBattleRenderBoundary fallback={<BoardRenderRecovery />} onFail={handleArenaFailure}>
                {arenaFailed ? <BoardRenderRecovery /> : (
                    <Canvas
                        aria-hidden="true"
                        dpr={quality.dpr}
                        shadows={quality.modelShadows ? "percentage" : false}
                        gl={{ alpha: true, antialias: quality.id !== "low", powerPreference: "high-performance" }}
                        camera={{ position: [0, 16.2, 11.35], fov: 39, near: 0.35, far: 80 }}
                        onCreated={({ camera }) => camera.lookAt(0, 0, 0.6)}
                    >
                        <BoardContextGuard onLost={handleArenaFailure} />
                        <BoardScene result={result} round={round} spriteMap={spriteMap} modelConfigs={modelConfigs} quality={quality} stars={stars} />
                    </Canvas>
                )}
            </PetBattleRenderBoundary>

            <div className="gauntlet-board-vignette" aria-hidden="true" />
            <header className="gauntlet-board-hud" aria-label="Gauntlet battle status">
                <div className="gauntlet-board-team gauntlet-board-team--player">
                    <span className="gauntlet-board-team__eyebrow">Your formation</span>
                    <strong>{player.alive}<small> / {player.total} standing</small></strong>
                    <div className="gauntlet-board-team__bar"><span style={{ width: `${player.pct}%` }} /></div>
                </div>
                <div className="gauntlet-board-round" aria-live="polite">
                    <span>Pet Gauntlet</span>
                    <strong>Round {Math.min(round, result.rounds)} <i>/ {result.rounds}</i></strong>
                    <small>{modelConfigs.size === result.roster.length ? "Full 3D roster" : `${modelConfigs.size}/${result.roster.length} 3D fighters`}</small>
                </div>
                <div className="gauntlet-board-team gauntlet-board-team--enemy">
                    <span className="gauntlet-board-team__eyebrow">Enemy formation</span>
                    <strong>{enemy.alive}<small> / {enemy.total} standing</small></strong>
                    <div className="gauntlet-board-team__bar"><span style={{ width: `${enemy.pct}%` }} /></div>
                </div>
            </header>

            <div className="gauntlet-board-side-label gauntlet-board-side-label--enemy" aria-hidden="true">
                <span>Enemy line</span>
            </div>
            <div className="gauntlet-board-side-label gauntlet-board-side-label--player" aria-hidden="true">
                <span>Your line</span>
            </div>
            <div className="gauntlet-board-build" aria-hidden="true">build g27 · {quality.id}</div>

            {done && (
                <div className="gauntlet-board-result" role="dialog" aria-modal="true" aria-labelledby="gauntlet-result-title">
                    <div className={`gauntlet-board-result__card gauntlet-board-result__card--${result.result}`}>
                        <span className="gauntlet-board-result__kicker">Formation resolved</span>
                        <div className="gauntlet-board-result__crest" aria-hidden="true">{result.result === "win" ? "✦" : result.result === "loss" ? "✕" : "◇"}</div>
                        <h2 id="gauntlet-result-title">{resultLabel}</h2>
                        <p>{result.result === "win" ? "Your squad holds the arena." : result.result === "loss" ? "The enemy line breaks through." : "Neither formation yields."}</p>
                        <button type="button" onClick={onDone}>Continue the run <span aria-hidden="true">→</span></button>
                    </div>
                </div>
            )}
        </div>
    ), document.body);
}
