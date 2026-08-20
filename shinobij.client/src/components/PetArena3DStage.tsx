/*
 * ── Tactical Pet Arena — TRUE-3D spectator stage (LoL-broadcast style) ───────
 * Replaces the top-down painted diorama with a real perspective scene: the
 * walkmask extruded into floating stone-path tiles over a chasm, the approved
 * roster GLBs (PetModel3D) running/dashing/striking on it, a pitched follow
 * camera that frames the action like a MOBA caster cam, and a corner
 * picture-in-picture chase camera the player can tap to cycle through pets.
 *
 * Purely presentational: it plays the SAME deterministic snapshot stream as the
 * classic renderer (PetColiseum's PetArenaMatch owns the sim, clock, HUD, feed
 * and director — this stage only draws). World space is 1:1 with sim space
 * (x = sim x, z = sim y, floor at y = 0), so snapshot coordinates land on the
 * floor with no projection math, and the floor is generated from the very mask
 * the sim paths on — the visible world can never disagree with the gameplay.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard, Html, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import type { Pet } from "../types/pet";
import { BOSS_ATK_RADIUS, type ArenaResult } from "../lib/pet-arena-sim";
import {
    arenaWalkTiles, arenaCameraFocus, arenaCameraDist, arenaModelHeight, arenaModelMotion, pipCycleIds,
    A3D_TILE_W, A3D_TILE_D, A3D_FOV, A3D_PITCH,
} from "../lib/pet-arena-3d";
import { petCombatModel, type PetCombatModelConfig } from "../lib/pet-3d-models";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import { petVisualQuality } from "../lib/pet-visual-quality";
import { petModelVariantSurface } from "../lib/pet-visual-variant";
import { projectileVisual, type ProjectileVisual } from "../lib/pet-projectile-vfx";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { elementVfxKey } from "../lib/pet-battle-anim";
import { lerp } from "../lib/pet-coliseum-scene";

type Vec3 = [number, number, number];
type ArenaClockRef = MutableRefObject<{ t: number; playing: boolean }>;

/** World-space spawn callbacks handed to <ArenaDirector> in 3D mode — the same
 * shape PetArenaMatch's classic (diorama) implementations have, so the director
 * itself needs zero changes. All inputs are sim coordinates (== world x/z). */
export type Arena3DSpawns = {
    spawnFx: (n: { x: number; z: number; element?: string | null; key?: string; scale: number; dur: number }) => void;
    spawnShot: (n: { fromX: number; fromY: number; toX: number; toY: number; element?: string | null; role?: string | null; kind?: string | null; support?: boolean; charged?: boolean }) => void;
    spawnFloater: (x: number, z: number, text: string, color: string, big: boolean) => void;
    spawnDecal: (x: number, z: number) => void;
};

const TEAM_COLOR: Record<"blue" | "red", string> = { blue: "#3b82f6", red: "#ef4444" };
const ELEMENT_TINT_3D: Record<string, string> = { fire: "#fb923c", water: "#38bdf8", wind: "#86efac", lightning: "#fde047", earth: "#d3a05f" };
const tint3d = (el?: string | null) => ELEMENT_TINT_3D[String(el ?? "").toLowerCase()] ?? "#a5f3fc";
const FX_Y3D = 0.8;           // mid-body height for impact bursts / casts
const ROLE_TAG_3D: Record<string, string> = { defender: "DEF", tracker: "TRK", assassin: "ASN", sage: "SGE" };

// ── Shared canvas textures (module-cached; tinted per-use via material color) ─
let _radial3d: THREE.CanvasTexture | null = null;
// eslint-disable-next-line react-refresh/only-export-components -- shared cached texture used by the Warfront stage too.
export function radialTexture3d(): THREE.CanvasTexture {
    if (_radial3d) return _radial3d;
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.55, "rgba(255,255,255,0.42)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    _radial3d = new THREE.CanvasTexture(c);
    return _radial3d;
}

const WARDEN3D_URLS = {
    idle: new URL("../assets/coliseum/warden-idle.webp", import.meta.url).href,
    walk: new URL("../assets/coliseum/warden-walk.webp", import.meta.url).href,
    windup: new URL("../assets/coliseum/warden-windup.webp", import.meta.url).href,
    slam: new URL("../assets/coliseum/warden-slam.webp", import.meta.url).href,
} as const;
type Warden3dFrame = keyof typeof WARDEN3D_URLS;
const _warden3dTex: Partial<Record<Warden3dFrame, THREE.Texture>> = {};
function warden3dTex(f: Warden3dFrame): THREE.Texture {
    const hit = _warden3dTex[f]; if (hit) return hit;
    const t = new THREE.TextureLoader().load(WARDEN3D_URLS[f]);
    t.colorSpace = THREE.SRGBColorSpace;
    _warden3dTex[f] = t;
    return t;
}

// Monotonic FX-instance ids. Module-scoped (not a ref) so the spawn closures
// below stay free of ref access — purely cosmetic keys, never sim-facing.
let fx3dSeq = 0;

const findActor3d = (result: ArenaResult, clock: ArenaClockRef, id: string) => {
    const snaps = result.snapshots;
    const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
    return { snap: snaps[i], actor: snaps[i].actors.find((a) => a.id === id) };
};

// ── The floor — walkmask extruded into path tiles over a chasm ───────────────
function ArenaFloor3D({ result }: { result: ArenaResult }) {
    const tiles = useMemo(() => arenaWalkTiles(), []);
    // Built imperatively: one InstancedMesh (single draw call) with per-tile
    // matrices + stone-tone instance colors derived from the walkmask layout.
    const instMesh = useMemo(() => {
        const geo = new THREE.BoxGeometry(A3D_TILE_W * 0.995, 0.22, A3D_TILE_D * 0.99);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.04 });
        const m = new THREE.InstancedMesh(geo, mat, tiles.length);
        const mat4 = new THREE.Matrix4();
        const col = new THREE.Color();
        tiles.forEach((t, i) => {
            mat4.makeTranslation(t.x, -0.11 - (t.edge ? 0.02 : 0), t.z);
            m.setMatrixAt(i, mat4);
            col.setHSL(0.6, 0.14, 0.14 + t.shade * 0.3);
            m.setColorAt(i, col);
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.receiveShadow = true;
        return m;
    }, [tiles]);
    useLayoutEffect(() => () => {
        instMesh.geometry.dispose();
        (instMesh.material as THREE.Material).dispose();
        instMesh.dispose();
    }, [instMesh]);
    return (
        <group>
            {/* The chasm far below — fog carries the depth read. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.6, 0]}>
                <planeGeometry args={[140, 90]} />
                <meshBasicMaterial color="#0a0e1d" />
            </mesh>
            <primitive object={instMesh} />
            {/* Team spawn seals + the centre scroll dais marker. */}
            {(["blue", "red"] as const).map((team) => result.bases[team].map(([x, y], i) => (
                <mesh key={`${team}-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, y]}>
                    <ringGeometry args={[0.62, 0.92, 40]} />
                    <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={0.5} depthWrite={false} />
                </mesh>
            )))}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[result.center[0], 0.02, result.center[1]]}>
                <ringGeometry args={[1.05, 1.4, 48]} />
                <meshBasicMaterial color="#fde047" transparent opacity={0.32} depthWrite={false} />
            </mesh>
        </group>
    );
}

// ── One fighter — approved GLB driven straight from the snapshot stream ──────
function Fighter3D({ result, clock, id, pet, config }: {
    result: ArenaResult; clock: ArenaClockRef; id: string; pet: Pet; config: PetCombatModelConfig;
}) {
    const root = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const aura = useRef<THREE.Mesh>(null);
    const auraMat = useRef<THREE.MeshBasicMaterial>(null);
    const shadow = useRef<THREE.Mesh>(null);
    const shadowMat = useRef<THREE.MeshBasicMaterial>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const hpChip = useRef<HTMLDivElement>(null);
    const nameWrap = useRef<HTMLDivElement>(null);
    const reviveRef = useRef<HTMLDivElement>(null);
    const carryRef = useRef<HTMLSpanElement>(null);
    const livesRef = useRef<HTMLSpanElement>(null);
    const abilityRef = useRef<HTMLSpanElement>(null);
    const modelFrame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const lastPos = useRef<[number, number]>([0, 0]);
    const smX = useRef<number | null>(null);
    const smZ = useRef<number | null>(null);
    const smSpd = useRef(0);
    const wasMoving = useRef(false);
    const prevDown = useRef(false);
    const prevState = useRef("");
    const strikeAt = useRef(-10);
    const deadAt = useRef<number | null>(null);
    const flash = useRef(0);
    const prevHp = useRef(Number.POSITIVE_INFINITY);
    const faceSm = useRef<[number, number]>([id.startsWith("blue") ? 1 : -1, 0]);
    const travel = useRef<[number, number]>([1, 0]);
    const team: "blue" | "red" = id.startsWith("blue") ? "blue" : "red";
    const h = arenaModelHeight(config.targetHeight);
    const s = h / Math.max(0.001, config.targetHeight);
    const tint = useMemo(() => tint3d(pet.element), [pet.element]);
    const role = useMemo(() => result.snapshots[0]?.actors.find((a) => a.id === id)?.role ?? "tracker", [result, id]);

    useFrame((state) => {
        const g = root.current; if (!g) return;
        const snaps = result.snapshots;
        const tf = Math.max(0, Math.min(snaps.length - 1, clock.current.t));
        const i0 = Math.floor(tf), i1 = Math.min(snaps.length - 1, i0 + 1), f = tf - i0;
        const a0 = snaps[i0].actors.find((a) => a.id === id); if (!a0) return;
        const a1 = snaps[i1].actors.find((a) => a.id === id) ?? a0;
        const down = a0.state === "dead" || a0.state === "respawning";
        // Snap (never lerp) across a respawn teleport — same rule as the classic
        // renderer: a >3-unit jump in one tick is never real movement.
        const tdx = a1.x - a0.x, tdz = a1.y - a0.y;
        const teleport = tdx * tdx + tdz * tdz > 9;
        const ff = teleport ? (f < 0.5 ? 0 : 1) : f;
        const px = lerp(a0.x, a1.x, ff), pz = lerp(a0.y, a1.y, ff);
        const wasDown = prevDown.current;
        const justBack = wasDown && !down;
        if (smX.current === null || smZ.current === null || teleport || down || justBack) { smX.current = px; smZ.current = pz; }
        else { smX.current += (px - smX.current) * 0.38; smZ.current += (pz - smZ.current) * 0.38; }
        const dx = smX.current - lastPos.current[0], dz = smZ.current - lastPos.current[1];
        const spd = (down || justBack) ? 0 : Math.hypot(dx, dz);
        lastPos.current = [smX.current, smZ.current];
        // Hysteresis so a pet at the movement threshold commits to idle OR run.
        const moving = !down && (wasMoving.current ? spd > 0.005 : spd > 0.014);
        wasMoving.current = moving;
        const now = state.clock.elapsedTime;
        if (down && !wasDown) deadAt.current = now;
        if (justBack) deadAt.current = null;
        const showingDeath = down && deadAt.current !== null && now - deadAt.current < 1.25;
        prevDown.current = down;
        g.position.set(smX.current, 0, smZ.current);
        if (body.current) body.current.visible = !down || showingDeath;

        // Strike pulse: the sim's "attack" state spans the whole swing cooldown,
        // so the skeletal strike fires from the state ENTRY edge and self-times.
        if (a0.state === "attack" && prevState.current !== "attack") strikeAt.current = now;
        prevState.current = a0.state;
        const striking = now - strikeAt.current < 0.3;

        // Facing: the sim's facing vector, travel direction as the fallback.
        let fx = a0.faceX, fz = a0.faceY;
        if (Math.hypot(fx, fz) < 0.1) { fx = faceSm.current[0]; fz = faceSm.current[1]; }
        faceSm.current[0] = lerp(faceSm.current[0], fx, 0.25);
        faceSm.current[1] = lerp(faceSm.current[1], fz, 0.25);
        const flen = Math.hypot(faceSm.current[0], faceSm.current[1]) || 1;
        if (moving && spd > 1e-5) { travel.current = [dx / spd, dz / spd]; }

        if (a0.hp < prevHp.current - 0.5) flash.current = 1;
        prevHp.current = a0.hp;
        flash.current *= 0.86;
        const frac = a0.hp / Math.max(1, a0.maxHp);

        const mf = modelFrame.current;
        mf.motion = showingDeath ? "dead" : arenaModelMotion(a0.state, moving, striking);
        mf.moving = moving;
        smSpd.current = lerp(smSpd.current, spd, 0.3);
        mf.speed = smSpd.current;
        mf.moveX = travel.current[0];
        mf.moveZ = travel.current[1];
        mf.faceX = faceSm.current[0] / flen;
        mf.faceZ = faceSm.current[1] / flen;
        mf.hit = flash.current < 0.02 ? 0 : flash.current;
        mf.casting = a0.state === "channel";
        mf.desperate = !down && frac > 0 && frac < 0.26;
        mf.statuses = a0.statuses;

        // Team ground aura (gold + pulsing while carrying the scroll) + contact shadow.
        if (aura.current && auraMat.current) {
            aura.current.visible = !down;
            aura.current.position.set(smX.current, 0.03, smZ.current);
            const carryPulse = a0.carrying ? 1.25 + Math.abs(Math.sin(now * 5)) * 0.3 : 1;
            aura.current.scale.setScalar(1.05 * carryPulse);
            auraMat.current.color.set(a0.carrying ? "#fde047" : TEAM_COLOR[team]);
            auraMat.current.opacity = a0.carrying ? 0.5 : 0.3;
        }
        if (shadow.current && shadowMat.current) {
            shadow.current.visible = !down || showingDeath;
            shadow.current.position.set(smX.current, 0.045, smZ.current);
            shadowMat.current.opacity = 0.36;
        }

        // Nameplate readouts — DOM refs only, no React re-render.
        if (hpFill.current) {
            const pct = Math.max(0, Math.min(100, frac * 100));
            hpFill.current.style.width = `${pct}%`;
            if (hpChip.current) { const chip = parseFloat(hpChip.current.style.width) || pct; hpChip.current.style.width = `${chip <= pct ? pct : lerp(chip, pct, 0.12)}%`; }
        }
        if (nameWrap.current) nameWrap.current.style.opacity = down ? "0.55" : "1";
        if (reviveRef.current) {
            const show = a0.state === "respawning" && a0.respawnSecs > 0;
            reviveRef.current.style.opacity = show ? "1" : "0";
            if (show) reviveRef.current.textContent = `↻ ${a0.respawnSecs}s`;
        }
        if (carryRef.current) carryRef.current.style.opacity = a0.carrying ? "1" : "0";
        if (livesRef.current) livesRef.current.textContent = "●".repeat(Math.max(0, Math.min(3, a0.lives)));
        if (abilityRef.current) abilityRef.current.style.opacity = a0.abilityReady ? "1" : "0.18";
    });

    return (
        <group>
            <group ref={root}>
                <group ref={body}>
                    <Suspense fallback={(
                        <mesh position={[0, h * 0.5, 0]}>
                            <capsuleGeometry args={[h * 0.24, h * 0.5, 4, 10]} />
                            <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.4} transparent opacity={0.9} />
                        </mesh>
                    )}>
                        <group scale={s}>
                            <PetModel3D config={config} frame={modelFrame} element={pet.element} surfaceTreatment={petModelVariantSurface(pet)} />
                        </group>
                    </Suspense>
                </group>
                <Html position={[0, h + 0.5, 0]} center distanceFactor={10} pointerEvents="none" zIndexRange={[6, 0]}>
                    <div ref={nameWrap} style={{ textAlign: "center", font: "700 11px Inter, system-ui, sans-serif", whiteSpace: "nowrap", userSelect: "none" }}>
                        <div style={{ color: "#fff", textShadow: "0 1px 3px #000", marginBottom: 2 }}>
                            <span style={{ color: team === "blue" ? "#93c5fd" : "#fca5a5", fontSize: 8, fontWeight: 800, marginRight: 3 }}>{ROLE_TAG_3D[role] ?? ""}</span>
                            {pet.name}
                            <span ref={carryRef} style={{ opacity: 0, marginLeft: 3 }}>📜</span>
                            <span ref={abilityRef} style={{ opacity: 0.18, marginLeft: 3, color: "#fde047", fontSize: 9 }}>◆</span>
                        </div>
                        <div style={{ position: "relative", width: 58, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpChip} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: "#fbbf24", opacity: 0.75 }} />
                            <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: TEAM_COLOR[team] }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 1 }}>
                            <span ref={livesRef} style={{ color: "#94a3b8", fontSize: 6, letterSpacing: 1 }}>●●●</span>
                        </div>
                        <div ref={reviveRef} style={{ opacity: 0, color: "#fde047", fontSize: 10, fontWeight: 800, marginTop: 1 }} />
                    </div>
                </Html>
            </group>
            <mesh ref={aura} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
                <planeGeometry args={[1.6, 1.6]} />
                <meshBasicMaterial ref={auraMat} map={radialTexture3d()} transparent opacity={0.3} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.95, 0.7]} />
                <meshBasicMaterial ref={shadowMat} map={radialTexture3d()} color="#000000" transparent opacity={0.36} depthWrite={false} />
            </mesh>
        </group>
    );
}

// ── Objectives — scroll, shrine relic, closing ring, the Arena Warden ────────
function Scroll3D({ result, clock }: { result: ArenaResult; clock: ArenaClockRef }) {
    const grp = useRef<THREE.Group>(null);
    const beacon = useRef<THREE.Mesh>(null);
    const beaconMat = useRef<THREE.MeshBasicMaterial>(null);
    const ringRef = useRef<HTMLDivElement>(null);
    const capRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    useFrame((state) => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const sc = snaps[i].scroll;
        const vis = sc.state !== "inactive";
        if (vis !== visible) setVisible(vis);
        if (!vis) return;
        if (grp.current) grp.current.position.set(sc.x, 0.85 + Math.abs(Math.sin(state.clock.elapsedTime * 2)) * 0.18, sc.y);
        if (beacon.current && beaconMat.current) {
            const pulse = 0.5 + Math.abs(Math.sin(state.clock.elapsedTime * 3)) * 0.5;
            beacon.current.position.set(sc.x, 0.035, sc.y);
            beacon.current.scale.setScalar(1.6 + pulse * 0.5);
            beaconMat.current.opacity = sc.state === "carried" ? 0 : 0.35 + pulse * 0.35;
        }
        if (ringRef.current) { ringRef.current.style.opacity = sc.channelFrac > 0 ? "1" : "0"; ringRef.current.style.background = `conic-gradient(#fde047 ${sc.channelFrac * 360}deg, rgba(0,0,0,0.35) 0deg)`; }
        if (capRef.current) capRef.current.style.opacity = sc.channelFrac > 0 ? "1" : "0";
    });
    if (!visible) return null;
    return (
        <group>
            <mesh ref={beacon} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
                <planeGeometry args={[1.4, 1.4]} />
                <meshBasicMaterial ref={beaconMat} map={radialTexture3d()} color="#fde047" transparent opacity={0.5} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <group ref={grp}>
                <Html center pointerEvents="none" zIndexRange={[30, 0]}>
                    <div style={{ position: "relative", width: 40, height: 40, display: "grid", placeItems: "center" }}>
                        <div ref={ringRef} style={{ position: "absolute", inset: -7, borderRadius: "50%", opacity: 0 }} />
                        <div style={{ fontSize: 30, filter: "drop-shadow(0 0 12px #fde047) drop-shadow(0 0 5px #fff)" }}>📜</div>
                        <div ref={capRef} style={{ position: "absolute", top: 42, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", font: "800 9px Inter, system-ui, sans-serif", color: "#fde047", textShadow: "0 1px 3px #000", opacity: 0, pointerEvents: "none" }}>Capturing…</div>
                    </div>
                </Html>
            </group>
        </group>
    );
}

const RELIC_COLOR_3D: Record<string, string> = { power: "#fb923c", mend: "#34d399", berserk: "#f87171", bulwark: "#60a5fa", edge: "#a78bfa", favor: "#fbbf24" };
const RELIC_LABEL_3D: Record<string, string> = { power: "Chakra Font", mend: "Mending Spring", berserk: "Berserker's Brand", bulwark: "Bulwark Ward", edge: "Executioner's Edge", favor: "Warden's Favor" };

function Shrine3D({ result, clock }: { result: ArenaResult; clock: ArenaClockRef }) {
    const grp = useRef<THREE.Group>(null);
    const gem = useRef<THREE.Mesh>(null);
    const glow = useRef<THREE.Mesh>(null);
    const glowMat = useRef<THREE.MeshBasicMaterial>(null);
    const ringRef = useRef<HTMLDivElement>(null);
    const [kind, setKind] = useState("power");
    const [visible, setVisible] = useState(false);
    const spawnAt = useRef<number | null>(null);
    const prevActive = useRef(false);
    useFrame((state) => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const sh = snaps[i].shrine;
        const vis = sh.state === "active";
        if (vis !== visible) setVisible(vis);
        if (sh.kind !== kind) setKind(sh.kind);
        const now = state.clock.elapsedTime;
        if (vis && !prevActive.current) spawnAt.current = now;
        prevActive.current = vis;
        if (!vis || !grp.current) return;
        const sp = spawnAt.current !== null ? Math.min(1, (now - spawnAt.current) / 0.4) : 1;
        grp.current.position.set(sh.x, 0.62 + Math.abs(Math.sin(now * 2)) * 0.08, sh.y);
        grp.current.scale.setScalar(0.55 + 0.45 * sp);
        if (gem.current) gem.current.rotation.y = now * 0.9;
        const color = RELIC_COLOR_3D[sh.kind] ?? "#fb923c";
        if (glow.current && glowMat.current) {
            const pulse = 0.5 + Math.abs(Math.sin(now * 2.6)) * 0.5;
            glow.current.position.set(sh.x, 0.032, sh.y);
            glow.current.scale.setScalar(1.7 + pulse * 0.5);
            glowMat.current.color.set(color);
            glowMat.current.opacity = sp * (0.26 + pulse * 0.2 + sh.channelFrac * 0.4);
        }
        if (ringRef.current) { ringRef.current.style.opacity = sh.channelFrac > 0 ? "1" : "0"; ringRef.current.style.background = `conic-gradient(${color} ${sh.channelFrac * 360}deg, rgba(0,0,0,0.35) 0deg)`; }
    });
    if (!visible) return null;
    const color = RELIC_COLOR_3D[kind] ?? "#fb923c";
    return (
        <group>
            <mesh ref={glow} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
                <planeGeometry args={[1.6, 1.6]} />
                <meshBasicMaterial ref={glowMat} map={radialTexture3d()} color={color} transparent opacity={0.4} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <group ref={grp}>
                <mesh ref={gem}>
                    <octahedronGeometry args={[0.34]} />
                    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.85} roughness={0.35} />
                </mesh>
                <Html center position={[0, 0.72, 0]} pointerEvents="none" zIndexRange={[29, 0]}>
                    <div style={{ position: "relative", width: 60, height: 42, display: "grid", placeItems: "center" }}>
                        <div ref={ringRef} style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 24, height: 24, borderRadius: "50%", opacity: 0 }} />
                        <div style={{ position: "absolute", bottom: 0, whiteSpace: "nowrap", font: "800 9px Inter, system-ui, sans-serif", color, textShadow: "0 1px 3px #000" }}>{RELIC_LABEL_3D[kind] ?? "Relic"}</div>
                    </div>
                </Html>
            </group>
        </group>
    );
}

function Ring3D({ result, clock }: { result: ArenaResult; clock: ArenaClockRef }) {
    const grp = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    useFrame((state) => {
        if (!grp.current) return;
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const rr = result.v2 ? snaps[i].ringR : 0;
        if (rr <= 0) { grp.current.visible = false; return; }
        grp.current.visible = true;
        grp.current.position.set(result.center[0], 0.05, result.center[1]);
        grp.current.scale.setScalar(rr);
        if (mat.current) mat.current.opacity = 0.22 + Math.abs(Math.sin(state.clock.elapsedTime * 3)) * 0.18;
    });
    return (
        <group ref={grp} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh renderOrder={-2}>
                <ringGeometry args={[0.94, 1, 72]} />
                <meshBasicMaterial ref={mat} color="#a78bfa" transparent opacity={0.3} depthWrite={false} depthTest={false} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
        </group>
    );
}

const BOSS_H3D = 3.1;
function Boss3D({ result, clock }: { result: ArenaResult; clock: ArenaClockRef }) {
    const root = useRef<THREE.Group>(null);
    const flip = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const ring = useRef<THREE.Mesh>(null);
    const ringMat = useRef<THREE.MeshBasicMaterial>(null);
    const hpFillRef = useRef<HTMLDivElement>(null);
    const hpWrapRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const spawnAt = useRef<number | null>(null);
    const deadAt = useRef<number | null>(null);
    const slamAt = useRef(-10);
    const prevState = useRef("inactive");
    const prevWinding = useRef(false);
    const lastXY = useRef<[number, number]>([0, 0]);
    useFrame((state) => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const b = snaps[i].boss;
        const now = state.clock.elapsedTime;
        if (b.state === "active" && prevState.current !== "active") { spawnAt.current = now; deadAt.current = null; }
        if (b.state === "dead" && prevState.current === "active") deadAt.current = now;
        prevState.current = b.state;
        if (prevWinding.current && !b.winding) slamAt.current = now;   // wind-up released → the stomp lands
        prevWinding.current = b.winding;
        const dying = deadAt.current !== null && now - deadAt.current < 0.9;
        const vis = b.state === "active" || dying;
        if (vis !== visible) setVisible(vis);
        if (!vis || !root.current) return;
        const rise = spawnAt.current !== null ? Math.min(1, (now - spawnAt.current) / 0.6) : 1;
        const moving = Math.hypot(b.x - lastXY.current[0], b.y - lastXY.current[1]) > 0.004;
        lastXY.current = [b.x, b.y];
        const bob = moving && b.state === "active" ? Math.abs(Math.sin(now * 7)) * 0.1 : 0;
        root.current.position.set(b.x, (rise - 1) * 1.6 + bob, b.y);
        if (flip.current) {
            flip.current.scale.x = b.faceX < 0 ? -1 : 1;
            // Rear up on the wind-up; squash for a beat as the slam lands; topple on death.
            const slamK = Math.max(0, 1 - (now - slamAt.current) / 0.28);
            flip.current.scale.y = b.winding ? 1.14 : 1 - slamK * 0.18;
            flip.current.rotation.z = dying ? Math.min(1.2, (now - (deadAt.current ?? now)) * 2.2) : 0;
        }
        if (mat.current) {
            mat.current.map = warden3dTex(b.winding ? "windup" : now - slamAt.current < 0.3 ? "slam" : moving ? "walk" : "idle");
            mat.current.opacity = dying ? Math.max(0, 1 - (now - (deadAt.current ?? now)) / 0.9) : rise;
        }
        if (ring.current && ringMat.current) {
            ring.current.visible = b.winding;
            ring.current.position.set(b.x, 0.06, b.y);
            ring.current.scale.setScalar(BOSS_ATK_RADIUS);
            ringMat.current.opacity = 0.28 + Math.abs(Math.sin(now * 9)) * 0.3;
        }
        if (hpWrapRef.current) hpWrapRef.current.style.opacity = b.state === "active" ? "1" : "0";
        if (hpFillRef.current) {
            hpFillRef.current.style.width = `${Math.round(b.hpFrac * 100)}%`;
            hpFillRef.current.style.background = b.stage >= 2 ? "#f87171" : b.stage === 1 ? "#fb923c" : "#34d399";
        }
    });
    if (!visible) return null;
    return (
        <group>
            <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
                <ringGeometry args={[0.82, 1, 48]} />
                <meshBasicMaterial ref={ringMat} color="#f87171" transparent opacity={0.3} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <group ref={root}>
                <group ref={flip}>
                    <Billboard lockX lockZ>
                        <mesh position={[0, BOSS_H3D * 0.5, 0]}>
                            <planeGeometry args={[BOSS_H3D, BOSS_H3D]} />
                            <meshBasicMaterial ref={mat} transparent alphaTest={0.03} depthWrite={false} toneMapped={false} />
                        </mesh>
                    </Billboard>
                </group>
                <Html position={[0, BOSS_H3D + 0.4, 0]} center pointerEvents="none" distanceFactor={11} zIndexRange={[8, 0]}>
                    <div ref={hpWrapRef} style={{ textAlign: "center", font: "800 10px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
                        <div style={{ color: "#a7f3d0", textShadow: "0 1px 3px #000", marginBottom: 2 }}>⛰ Arena Warden</div>
                        <div style={{ position: "relative", width: 110, height: 6, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpFillRef} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: "#34d399" }} />
                        </div>
                    </div>
                </Html>
            </group>
        </group>
    );
}

// ── Broadcast FX — flipbook bursts, projectile comets, damage floaters ───────
export function Fx3D({ frames, pos, scale, durationMs, onDone }: {
    frames: string[]; pos: Vec3; scale: number; durationMs: number; onDone: () => void;
}) {
    const group = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const start = useRef<number | null>(null);
    const textures = useMemo(() => frames.map((u) => {
        const t = new THREE.TextureLoader().load(u);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }), [frames]);
    useLayoutEffect(() => () => { textures.forEach((t) => t.dispose()); }, [textures]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = (state.clock.elapsedTime - start.current) * 1000;
        const p = Math.min(1, elapsed / durationMs);
        const idx = Math.min(textures.length - 1, Math.floor(p * textures.length));
        const tex = textures[idx] ?? null;
        if (mat.current) mat.current.map = tex;
        const img = tex?.image as HTMLImageElement | undefined;
        if (group.current) group.current.visible = !!(img && img.complete && (img.naturalWidth || 0) > 0);
        if (elapsed >= durationMs) onDone();
    });
    return (
        <group ref={group} position={pos} visible={false}>
            <Billboard>
                <mesh scale={[scale, scale, scale]}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial ref={mat} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </mesh>
            </Billboard>
        </group>
    );
}

export function Shot3D({ from, to, visual, durationMs, arc, onDone }: {
    from: Vec3; to: Vec3; visual: ProjectileVisual; durationMs: number; arc: number; onDone: () => void;
}) {
    const head = useRef<THREE.Group>(null);
    const g1 = useRef<THREE.Group>(null);
    const g2 = useRef<THREE.Group>(null);
    const start = useRef<number | null>(null);
    const pathAt = (p: number): Vec3 => [
        lerp(from[0], to[0], p),
        lerp(from[1], to[1], p) + arc * Math.sin(Math.PI * Math.max(0, Math.min(1, p))),
        lerp(from[2], to[2], p),
    ];
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = ((state.clock.elapsedTime - start.current) * 1000) / durationMs;
        const set = (g: THREE.Group | null, q: number) => { if (g) { const v = pathAt(q); g.position.set(v[0], v[1], v[2]); g.visible = q > 0; } };
        set(head.current, p);
        set(g1.current, p - 0.08);
        set(g2.current, p - 0.16);
        if (p >= 1) onDone();
    });
    const size = visual.size * 1.7;
    return (
        <group>
            <group ref={head} position={from} visible={false}>
                <mesh><sphereGeometry args={[size * 0.32, 10, 10]} /><meshBasicMaterial color={visual.core} toneMapped={false} /></mesh>
                <Billboard><mesh scale={[size * 2.6, size * 2.6, 1]}><planeGeometry args={[1, 1]} /><meshBasicMaterial map={radialTexture3d()} color={visual.glow} transparent opacity={0.85} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh></Billboard>
            </group>
            <group ref={g1} position={from} visible={false}>
                <Billboard><mesh scale={[size * 1.7, size * 1.7, 1]}><planeGeometry args={[1, 1]} /><meshBasicMaterial map={radialTexture3d()} color={visual.glow} transparent opacity={0.4} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh></Billboard>
            </group>
            <group ref={g2} position={from} visible={false}>
                <Billboard><mesh scale={[size * 1.2, size * 1.2, 1]}><planeGeometry args={[1, 1]} /><meshBasicMaterial map={radialTexture3d()} color={visual.glow} transparent opacity={0.25} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh></Billboard>
            </group>
        </group>
    );
}

export function Floater3D({ pos, text, color, big }: { pos: Vec3; text: string; color: string; big: boolean }) {
    return (
        <Html position={pos} center pointerEvents="none" zIndexRange={[45, 0]}>
            <div style={{ font: `${big ? 900 : 800} ${big ? 20 : 13}px Inter, system-ui, sans-serif`, color, textShadow: "0 1px 2px #000, 0 0 5px rgba(0,0,0,0.7)", whiteSpace: "nowrap", animation: "arenaFloat 0.9s ease-out forwards" }}>{text}</div>
        </Html>
    );
}

// ── Cameras ──────────────────────────────────────────────────────────────────
function CameraRig3D({ result, clock, shake }: { result: ArenaResult; clock: ArenaClockRef; shake: MutableRefObject<number> }) {
    const sm = useRef({ fx: 0, fz: 0, d: 24, init: true });
    useFrame((state) => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const focus = arenaCameraFocus(snaps[i]);
        const aspect = state.size.width / Math.max(1, state.size.height);
        const targetD = arenaCameraDist(focus.span, aspect);
        const s = sm.current;
        const k = s.init ? 1 : 0.045;
        s.init = false;
        s.fx += (focus.fx - s.fx) * k;
        s.fz += (focus.fz - s.fz) * k;
        s.d += (targetD - s.d) * k;
        let ox = 0, oy = 0;
        const amp = shake.current;
        if (amp > 0.01) { ox = Math.sin(state.clock.elapsedTime * 92) * amp * 0.18; oy = Math.cos(state.clock.elapsedTime * 77) * amp * 0.13; }
        state.camera.position.set(s.fx + ox, Math.sin(A3D_PITCH) * s.d + oy, s.fz + Math.cos(A3D_PITCH) * s.d);
        state.camera.lookAt(s.fx + ox, 0, s.fz);
    });
    return null;
}

/** Corner picture-in-picture chase camera. Subscribing at render-priority 1
 * takes over the frame: we draw the main broadcast view first, then scissor
 * the corner rect and draw the same scene again through the chase camera. */
function PipRenderer({ result, clock, focusId, statusRef, pipW, pipH, margin }: {
    result: ArenaResult; clock: ArenaClockRef; focusId: string;
    statusRef: MutableRefObject<HTMLSpanElement | null>; pipW: number; pipH: number; margin: number;
}) {
    // The chase camera is created lazily INSIDE the frame callback (never
    // touched during render) so the per-frame mutation is compiler-safe.
    const camRef = useRef<THREE.PerspectiveCamera | null>(null);
    const sm = useRef<{ x: number; z: number; init: boolean }>({ x: 0, z: 0, init: true });
    const lastStatus = useRef("");
    useFrame((state) => {
        const { gl, scene, camera, size } = state;
        // Main broadcast pass (full frame).
        gl.setScissorTest(false);
        gl.setViewport(0, 0, size.width, size.height);
        gl.autoClear = true;
        gl.render(scene, camera);
        // Chase target.
        const { actor } = findActor3d(result, clock, focusId);
        const down = !actor || actor.state === "dead" || actor.state === "respawning";
        if (actor) {
            const s = sm.current;
            const jump = Math.hypot(actor.x - s.x, actor.y - s.z) > 5;
            if (s.init || jump) { s.x = actor.x; s.z = actor.y; s.init = false; }
            else { s.x += (actor.x - s.x) * 0.14; s.z += (actor.y - s.z) * 0.14; }
        }
        if (!camRef.current) camRef.current = new THREE.PerspectiveCamera(46, 1.6, 0.4, 70);
        const cam = camRef.current;
        cam.aspect = pipW / Math.max(1, pipH);
        cam.updateProjectionMatrix();
        cam.position.set(sm.current.x, 2.15, sm.current.z + 3.2);
        cam.lookAt(sm.current.x, 0.6, sm.current.z);
        const status = down ? (actor && actor.respawnSecs > 0 ? ` ↻ ${actor.respawnSecs}s` : " ↻") : "";
        if (statusRef.current && status !== lastStatus.current) { statusRef.current.textContent = status; lastStatus.current = status; }
        // PiP pass (bottom-left corner; three multiplies by pixelRatio internally).
        gl.autoClear = false;
        gl.setScissorTest(true);
        gl.setViewport(margin, margin, pipW, pipH);
        gl.setScissor(margin, margin, pipW, pipH);
        gl.setClearColor("#05070f", 1);
        gl.clear(true, true);
        gl.render(scene, cam);
        gl.setScissorTest(false);
        gl.setViewport(0, 0, size.width, size.height);
        gl.autoClear = true;
    }, 1);
    return null;
}

/** Clears the stage-local FX lists when the match clock rewinds (Replay). */
function RewindJanitor3D({ clock, onRewind }: { clock: ArenaClockRef; onRewind: () => void }) {
    const last = useRef(0);
    useFrame(() => {
        const t = clock.current.t;
        if (t < last.current - 5) onRewind();
        last.current = t;
    });
    return null;
}

// ── The stage root ───────────────────────────────────────────────────────────
export function PetArena3DStage({ result, roster, clock, shake, children }: {
    result: ArenaResult;
    roster: Array<{ id: string; pet: Pet }>;
    clock: ArenaClockRef;
    shake: MutableRefObject<number>;
    /** Mounted INSIDE the Canvas with the 3D spawn callbacks — the caller wires
     *  them into its ArenaDirector + HUD frame-writers (which are projection-
     *  agnostic and reused verbatim from the classic renderer). */
    children: (spawns: Arena3DSpawns) => ReactNode;
}) {
    const stageRef = useRef<HTMLDivElement>(null);
    const [stageWidth, setStageWidth] = useState(1200);
    const floaterTimersRef = useRef<Set<number>>(new Set());
    useLayoutEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const measure = () => setStageWidth((current) => {
            const next = stage.clientWidth || current;
            return current === next ? current : next;
        });
        measure();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        observer?.observe(stage);
        return () => {
            observer?.disconnect();
        };
    }, []);
    useEffect(() => {
        const floaterTimers = floaterTimersRef.current;
        return () => {
            for (const timer of floaterTimers) window.clearTimeout(timer);
            floaterTimers.clear();
        };
    }, []);
    const quality = useMemo(() => petVisualQuality(), []);
    const configs = useMemo(() => {
        const m = new Map<string, PetCombatModelConfig>();
        for (const r of roster) { const c = petCombatModel(r.pet); if (c) m.set(r.id, c); }
        return m;
    }, [roster]);
    const [fxList, setFxList] = useState<Array<{ id: number; frames: string[]; pos: Vec3; scale: number; dur: number }>>([]);
    const [shots, setShots] = useState<Array<{ id: number; from: Vec3; to: Vec3; visual: ProjectileVisual; dur: number; arc: number }>>([]);
    const [floaters, setFloaters] = useState<Array<{ id: number; pos: Vec3; text: string; color: string; big: boolean }>>([]);
    const [decals, setDecals] = useState<Array<{ id: number; x: number; z: number }>>([]);
    const [spawns] = useState<Arena3DSpawns>(() => ({
        spawnFx: (n) => {
            const frames = (n.key ? bundledJutsuFxFrames(n.key) : null) ?? bundledJutsuFxFrames(elementVfxKey(n.element)) ?? bundledJutsuFxFrames("none");
            if (!frames) return;
            const id = fx3dSeq++;
            setFxList((arr) => [...arr, { id, frames, pos: [n.x, FX_Y3D, n.z], scale: n.scale * 0.62, dur: n.dur }]);
        },
        spawnShot: (n) => {
            const visual = projectileVisual({ element: n.element, role: n.role, kind: n.kind, support: n.support, charged: n.charged });
            const dist = Math.hypot(n.toX - n.fromX, n.toY - n.fromY);
            let dur = (260 + dist * 24) / Math.max(0.85, visual.speedMul);
            if (visual.tex === "bolt") dur *= 0.85;
            dur = Math.min(820, Math.max(420, dur));
            const id = fx3dSeq++;
            setShots((arr) => [...arr, { id, from: [n.fromX, 0.9, n.fromY], to: [n.toX, 0.9, n.toY], visual, dur, arc: visual.tex === "rock" ? 0.9 : 0.28 }]);
        },
        spawnFloater: (x, z, text, color, big) => {
            const id = fx3dSeq++;
            setFloaters((arr) => [...arr, { id, pos: [x, 1.5, z], text, color, big }]);
            const timer = window.setTimeout(() => {
                floaterTimersRef.current.delete(timer);
                setFloaters((arr) => arr.filter((f) => f.id !== id));
            }, 950);
            floaterTimersRef.current.add(timer);
        },
        spawnDecal: (x, z) => {
            const id = fx3dSeq++;
            setDecals((arr) => [...arr, { id, x, z }].slice(-12));
        },
    }));
    const clearFx = () => { setFxList([]); setShots([]); setFloaters([]); setDecals([]); };

    // Corner PiP — tap to cycle focus (your blue squad first, then red).
    const pipIds = useMemo(() => pipCycleIds(roster.map((r) => r.id)), [roster]);
    const [pipIdx, setPipIdx] = useState(0);
    const pipOn = quality.id !== "low" && pipIds.length > 0;
    const focusId = pipIds[pipIdx % Math.max(1, pipIds.length)] ?? "blue-0";
    const focusPet = roster.find((r) => r.id === focusId);
    const pipW = Math.round(Math.min(230, Math.max(112, stageWidth * 0.22)));
    const pipH = Math.round(pipW * 0.62);
    const pipStatusRef = useRef<HTMLSpanElement>(null);
    const focusTeamColor = focusId.startsWith("blue") ? "#60a5fa" : "#f87171";

    return (
        <div ref={stageRef} style={{ position: "absolute", inset: 0 }}>
            {/* shadows="percentage" = PCFShadowMap explicitly — the boolean form picks
                PCFSoftShadowMap, which three 0.184 deprecates with a PER-FRAME console
                warning (and silently falls back to PCF anyway). */}
            <Canvas dpr={quality.dpr} shadows={quality.modelShadows ? "percentage" : false} camera={{ fov: A3D_FOV, near: 0.5, far: 120, position: [0, 18, 20] }} gl={{ antialias: true }}>
                <color attach="background" args={["#05070f"]} />
                <fog attach="fog" args={["#0a0f1f", 28, 80]} />
                <hemisphereLight args={["#c9ddff", "#2b2440", 0.85]} />
                <directionalLight
                    position={[9, 15, 6]} intensity={1.5} color="#fff2df" castShadow={quality.modelShadows}
                    shadow-mapSize-width={quality.id === "high" ? 2048 : 1024} shadow-mapSize-height={quality.id === "high" ? 2048 : 1024}
                    shadow-camera-left={-17} shadow-camera-right={17} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-camera-far={45}
                />
                <ArenaFloor3D result={result} />
                {roster.map((r) => {
                    const config = configs.get(r.id);
                    return config ? <Fighter3D key={r.id} result={result} clock={clock} id={r.id} pet={r.pet} config={config} /> : null;
                })}
                <Scroll3D result={result} clock={clock} />
                <Shrine3D result={result} clock={clock} />
                <Boss3D result={result} clock={clock} />
                <Ring3D result={result} clock={clock} />
                {decals.map((d) => (
                    <mesh key={d.id} rotation={[-Math.PI / 2, 0, 0]} position={[d.x, 0.025, d.z]} renderOrder={-3}>
                        <planeGeometry args={[1.3, 1.3]} />
                        <meshBasicMaterial map={radialTexture3d()} color="#20150c" transparent opacity={0.55} depthWrite={false} />
                    </mesh>
                ))}
                {fxList.map((fx) => (
                    <Fx3D key={fx.id} frames={fx.frames} pos={fx.pos} scale={fx.scale} durationMs={fx.dur} onDone={() => setFxList((p) => p.filter((x) => x.id !== fx.id))} />
                ))}
                {shots.map((sh) => (
                    <Shot3D key={sh.id} from={sh.from} to={sh.to} visual={sh.visual} durationMs={sh.dur} arc={sh.arc} onDone={() => setShots((p) => p.filter((x) => x.id !== sh.id))} />
                ))}
                {floaters.map((f) => (<Floater3D key={f.id} pos={f.pos} text={f.text} color={f.color} big={f.big} />))}
                <Sparkles count={Math.max(12, quality.ambientParticles)} scale={[30, 6, 18]} position={[0, 2.5, 0]} size={2} speed={0.14} opacity={0.28} color="#ffe9c0" noise={2} />
                <CameraRig3D result={result} clock={clock} shake={shake} />
                {pipOn && <PipRenderer result={result} clock={clock} focusId={focusId} statusRef={pipStatusRef} pipW={pipW} pipH={pipH} margin={10} />}
                <RewindJanitor3D clock={clock} onRewind={clearFx} />
                {children(spawns)}
            </Canvas>
            {pipOn && (
                <div
                    onClick={() => setPipIdx((i) => i + 1)}
                    title="Cycle focused pet"
                    style={{ position: "absolute", left: 10, bottom: 10, width: pipW, height: pipH, border: `1px solid ${focusTeamColor}88`, borderRadius: 10, cursor: "pointer", zIndex: 55, overflow: "hidden", boxShadow: "0 4px 18px rgba(0,0,0,0.5)" }}
                >
                    <div style={{ position: "absolute", left: 0, right: 0, top: 0, padding: "3px 8px", background: "linear-gradient(rgba(5,8,16,0.8), transparent)", color: focusTeamColor, font: "700 10px Inter, system-ui, sans-serif", display: "flex", justifyContent: "space-between", pointerEvents: "none" }}>
                        <span>📷 {focusPet?.pet.name ?? focusId}<span ref={pipStatusRef} /></span>
                        <span style={{ color: "#94a3b8" }}>{(pipIdx % pipIds.length) + 1}/{pipIds.length}</span>
                    </div>
                    <div style={{ position: "absolute", right: 6, bottom: 4, color: "#cbd5e1", font: "700 9px Inter, system-ui, sans-serif", textShadow: "0 1px 2px #000", pointerEvents: "none" }}>tap to cycle ▸</div>
                </div>
            )}
        </div>
    );
}
