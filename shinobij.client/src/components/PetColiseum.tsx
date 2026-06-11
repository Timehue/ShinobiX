/*
 * ── PetColiseum — HD-2D coliseum battle renderer (Phase 1+2) ──────────────────
 * A react-three-fiber drop-in alternative to PetArenaBattlefield: the pets are
 * 2D BILLBOARD sprites standing on a 3D arena floor at an angled camera, and
 * they actually FIGHT — lunge to engage, recoil on hit, guard, topple on KO —
 * with elemental VFX flying between them and camera shake on heavy blows.
 *
 * CRITICAL: this is a pure PRESENTATION layer. It consumes the SAME inputs the
 * DOM renderer does — the deterministic frame, the buildPetAnimationEvents()
 * queue, petPoseForAvatar(), petBattleCamera(), petFxSpriteKey() — and drives
 * motion off them. It never resolves combat, so balance / odds / ranked-replay
 * determinism are untouched. Motion easing + camera shake use a clock/sin only
 * (no RNG) and never feed back into the sim.
 *
 * Today the billboard texture is the pet's existing portrait when published
 * (via petBattleSprite → sharedImages), else a procedural placeholder so it runs
 * with no backend (the /petvfx.html harness). Real transparent full-body art +
 * a generated coliseum backdrop are the next asset step; the renderer is ready.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, ContactShadows, Html, OrbitControls } from "@react-three/drei";
import type { Pet, PetArenaFrame, PetBattleRecord } from "../App";
import { petArchetypeFor, type ArenaTile } from "../lib/pet-tactics";
import { PetBattleAvatar } from "./PetBattleAvatar";
import type { PetVisualState, PetBattleAnimationEventType } from "../types/pet-battle";
import {
    buildPetAnimationEvents,
    petPoseForAvatar,
    petBattleSprite,
    elementVfxKey,
    extractPetMoveName,
} from "../lib/pet-battle-anim";
import { petBattleCamera, petCameraHoldMs } from "../lib/pet-battle-camera";
import { petFxSpriteKey } from "../lib/jutsu-vfx";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { petFramePace, tileDistance } from "../lib/pet-battle-sim";
import { tileToWorld, poseMotion, lerp, shakeAmpForBeat, spreadPositions, lungeReach } from "../lib/pet-coliseum-scene";
import { usePetBattleFrameSfx } from "../lib/use-pet-battle-sfx";
import { isPetSfxMuted, setPetSfxMuted } from "../lib/pet-sfx";

type Vec3 = [number, number, number];
const FLOOR_Y = 0;
const FX_Y = 1.0; // mid-body height for impacts / casts

// Camera framing — fairly LEVEL (Z-A-style over-the-arena view) so the coliseum
// backdrop's stands/crowd/sky fill the upper frame while the floor + grounded
// pets sit lower. Shared so the Canvas, onCreated, CameraRig + OrbitControls
// all agree on the same look target.
const CAM_POS: Vec3 = [0, 3.4, 8.9];
const CAM_LOOK: Vec3 = [0, 1.9, -2.5];
const CAM_FOV = 34;

// Generated coliseum scene art (OpenAI gpt-image-1 → WebP, bundled). Resolved
// via new URL(...) so Vite rewrites them to hashed asset URLs at build time —
// no .webp module-type declaration needed.
const COLISEUM_FLOOR_URL = new URL("../assets/coliseum/coliseum-floor.webp", import.meta.url).href;
const COLISEUM_BG_URL = new URL("../assets/coliseum/coliseum-bg.webp", import.meta.url).href;

/** Load a bundled scene texture (sRGB). */
function loadSceneTexture(url: string): THREE.Texture {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

// ── Procedural placeholder + floor textures (used until real art is published) ─
const ELEMENT_COLOR: Record<string, { base: string; glow: string }> = {
    Fire: { base: "#ff6a2c", glow: "#ffb066" },
    Water: { base: "#38bdf8", glow: "#bae6fd" },
    Wind: { base: "#5eead4", glow: "#ccfbf1" },
    Lightning: { base: "#facc15", glow: "#fef08a" },
    Earth: { base: "#d6a76a", glow: "#f0d9b5" },
};
function elementColor(element?: string | null) {
    return ELEMENT_COLOR[String(element ?? "")] ?? { base: "#c4b5fd", glow: "#e9d5ff" };
}

function makePlaceholderTexture(pet: Pet): THREE.CanvasTexture {
    const W = 512, H = 640;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    const { base, glow } = elementColor(pet.element);
    const halo = g.createRadialGradient(W / 2, H * 0.55, 20, W / 2, H * 0.55, W * 0.62);
    halo.addColorStop(0, glow + "cc"); halo.addColorStop(0.5, base + "55"); halo.addColorStop(1, "#00000000");
    g.fillStyle = halo; g.fillRect(0, 0, W, H);
    const bx = W * 0.22, by = H * 0.2, bw = W * 0.56, bh = H * 0.62, r = 64;
    const body = g.createLinearGradient(0, by, 0, by + bh);
    body.addColorStop(0, glow); body.addColorStop(0.5, base); body.addColorStop(1, "#1f2937");
    g.beginPath();
    g.moveTo(bx + r, by);
    g.arcTo(bx + bw, by, bx + bw, by + bh, r);
    g.arcTo(bx + bw, by + bh, bx, by + bh, r);
    g.arcTo(bx, by + bh, bx, by, r);
    g.arcTo(bx, by, bx + bw, by, r);
    g.closePath();
    g.fillStyle = body; g.fill();
    g.lineWidth = 8; g.strokeStyle = "#0b1020"; g.stroke();
    g.fillStyle = "#0b1020";
    g.font = "800 150px Inter, system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(pet.name.slice(0, 2).toUpperCase(), W / 2, H * 0.5);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return tex;
}

/** Portrait texture if published (petBattleSprite → sharedImages/pet.image),
 *  else a procedural placeholder. Disposed on change. `mirror` flips the IMAGE
 *  horizontally (UV-level, so pose/rotation math is untouched) — battle-sprite
 *  art faces RIGHT by convention, and the enemy side flips to face inward
 *  (same convention as the DOM renderer's .pet-sprite-fullbody mirror). */
function usePetTexture(pet: Pet, sharedImages: Record<string, string>, mirror = false): THREE.Texture {
    const { src } = petBattleSprite(pet, sharedImages);
    return useMemo(() => {
        const t = src ? new THREE.TextureLoader().load(src) : makePlaceholderTexture(pet);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        // Mirror only real art — the procedural placeholder carries the pet's
        // INITIALS, which would render backwards if flipped.
        if (mirror && src) {
            t.wrapS = THREE.RepeatWrapping;
            t.repeat.x = -1;
            t.offset.x = 1;
        }
        return t;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, pet.id, pet.element, mirror]);
}

// ── One billboarded pet standee — eases toward the active pose each frame ─────
function Standee({
    pet, side, pos, reach, toward, pose, fainted, hp, maxHp, texture,
}: {
    pet: Pet;
    side: "player" | "enemy";
    /** Separation-adjusted world position (faceOffPositions). */
    pos: { x: number; z: number };
    /** Gap-aware lunge distance (lungeReach) — stops at contact, never through. */
    reach: number;
    /** +1 if the opponent is to this pet's +x, -1 otherwise — drives motion
     *  direction (lunge toward / recoil away) from ACTUAL positions, so it
     *  stays correct even if the pets cross sides mid-fight. */
    toward: number;
    pose: PetVisualState;
    fainted: boolean;
    /** Live HP for the overhead nameplate bar (per-slot in 2v2). */
    hp: number;
    maxHp: number;
    texture: THREE.Texture;
}) {
    const group = useRef<THREE.Group>(null);
    const mesh = useRef<THREE.Mesh>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const planeH = 2.5;
    const planeW = 2.3;
    const base = pos;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    useFrame((state) => {
        const g = group.current, m = mesh.current, material = mat.current;
        if (!g || !m || !material) return;
        const target = poseMotion(fainted ? "ko" : pose, toward, reach);
        const k = reduce ? 1 : pose === "lunge" || pose === "recoil" ? 0.32 : 0.2;
        const t = state.clock.elapsedTime;
        const breathe = (pose === "idle" || pose === "victory") && !fainted ? Math.sin(t * 2 + (side === "enemy" ? Math.PI : 0)) * 0.05 : 0;
        // Position eases toward base tile + pose offset.
        g.position.x = lerp(g.position.x, base.x + target.dx, k);
        g.position.y = lerp(g.position.y, FLOOR_Y + target.dy, k) + breathe;
        g.position.z = lerp(g.position.z, base.z + target.dz, k);
        // Sprite squash/stretch + topple tilt.
        m.scale.x = lerp(m.scale.x, target.sx, k);
        m.scale.y = lerp(m.scale.y, target.sy, k);
        m.rotation.z = lerp(m.rotation.z, target.rot, k);
        // Damage tint (red dip) + fade.
        material.color.g = lerp(material.color.g, 1 - 0.5 * target.hurt, k);
        material.color.b = lerp(material.color.b, 1 - 0.5 * target.hurt, k);
        material.opacity = lerp(material.opacity, target.opacity, k);
    });

    const safeMax = Math.max(1, maxHp);
    const hpPct = Math.max(0, Math.min(100, (hp / safeMax) * 100));
    return (
        <group ref={group} position={[base.x, 0, base.z]}>
            <Billboard>
                {/* Mesh centred at half-height so the sprite's feet meet the floor. */}
                <mesh ref={mesh} position={[0, planeH / 2, 0]}>
                    <planeGeometry args={[planeW, planeH]} />
                    <meshBasicMaterial ref={mat} map={texture} transparent alphaTest={0.02} depthWrite={false} toneMapped={false} />
                </mesh>
            </Billboard>
            <Html position={[0, planeH + 0.15, 0]} center distanceFactor={9} pointerEvents="none" zIndexRange={[6, 0]}>
                <div style={{ textAlign: "center", font: "700 13px Inter, system-ui, sans-serif", whiteSpace: "nowrap", userSelect: "none", opacity: fainted ? 0.5 : 1 }}>
                    <div style={{ color: "#fff", textShadow: "0 1px 3px #000", marginBottom: 3 }}>Lv.{pet.level} {pet.name}</div>
                    <div style={{ width: 96, height: 8, margin: "0 auto", background: "#0b1020", borderRadius: 5, border: "1px solid #000", overflow: "hidden" }}>
                        <div data-hp={side} style={{ width: `${hpPct}%`, height: "100%", background: side === "player" ? "#4ade80" : "#f87171", transition: "width .35s" }} />
                    </div>
                    <div style={{ color: "#cbd5e1", fontSize: 10, marginTop: 2 }} data-hpnum={side}>{Math.max(0, Math.round(hp))}/{safeMax}</div>
                </div>
            </Html>
        </group>
    );
}

// ── A frame-sequence VFX sprite (stationary, or travelling from→to) ───────────
function FxAnim({
    frames, from, to, durationMs, scale = 1.5, onDone,
}: {
    frames: string[];
    from: Vec3;
    to?: Vec3;
    durationMs: number;
    scale?: number;
    onDone: () => void;
}) {
    const group = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const start = useRef<number | null>(null);
    const textures = useMemo(() => frames.map((u) => {
        const t = new THREE.TextureLoader().load(u);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }), [frames]);
    useEffect(() => () => { textures.forEach((t) => t.dispose()); }, [textures]);

    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = (state.clock.elapsedTime - start.current) * 1000;
        const p = Math.min(1, elapsed / durationMs);
        const idx = Math.min(textures.length - 1, Math.floor(p * textures.length));
        if (mat.current) mat.current.map = textures[idx] ?? null;
        if (group.current && to) {
            group.current.position.x = lerp(from[0], to[0], p);
            group.current.position.y = lerp(from[1], to[1], p);
            group.current.position.z = lerp(from[2], to[2], p);
        }
        if (elapsed >= durationMs) onDone();
    });

    return (
        <group ref={group} position={from}>
            <Billboard>
                <mesh scale={[scale, scale, scale]}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial ref={mat} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </mesh>
            </Billboard>
        </group>
    );
}

// ── Camera shake rig — decaying sinusoid offset on contact beats (no RNG) ─────
function CameraRig({ amp, shakeKey }: { amp: number; shakeKey: number }) {
    const base = useRef<THREE.Vector3 | null>(null);
    const cur = useRef(0);
    const { camera } = useThree();
    useEffect(() => {
        if (!base.current) base.current = camera.position.clone();
        cur.current = Math.max(cur.current, amp);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shakeKey, amp]);
    useFrame((state) => {
        if (!base.current) { base.current = camera.position.clone(); return; }
        cur.current *= 0.86;
        const a = cur.current;
        const t = state.clock.elapsedTime;
        camera.position.set(
            base.current.x + (a > 0.001 ? Math.sin(t * 53) * a : 0),
            base.current.y + (a > 0.001 ? Math.sin(t * 61) * a * 0.6 : 0),
            base.current.z,
        );
        camera.lookAt(CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2]);
    });
    return null;
}

function Arena({ floor, backdrop }: { floor: THREE.Texture; backdrop: THREE.Texture }) {
    return (
        <group>
            <ambientLight intensity={0.95} />
            <directionalLight position={[3, 8, 5]} intensity={0.9} />
            {/* Painted coliseum backdrop — a wide wall of stands/crowd/sky behind
                the arena (unlit + fog-exempt so the art reads as generated). */}
            <mesh position={[0, 4.2, -10.5]}>
                <planeGeometry args={[34, 15]} />
                <meshBasicMaterial map={backdrop} toneMapped={false} depthWrite={false} fog={false} />
            </mesh>
            {/* Generated arena floor. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]}>
                <circleGeometry args={[9, 64]} />
                <meshStandardMaterial map={floor} roughness={0.95} />
            </mesh>
            <ContactShadows position={[0, 0.01, 0]} scale={16} blur={2.4} opacity={0.5} far={6} resolution={512} />
        </group>
    );
}

type FxInstance = { id: number; frames: string[]; from: Vec3; to?: Vec3; durationMs: number; scale: number };
type LabelInstance = { id: number; text: string; className: string; pos: Vec3 };

export type PetColiseumProps = {
    playerPet: Pet;
    enemyPet: Pet;
    enemyOwner: string;
    playerReservePet?: Pet;
    enemyReservePet?: Pet;
    frame?: PetArenaFrame;
    recentFrames?: PetArenaFrame[];
    result: string;
    obstacles?: number[];
    tiles?: ArenaTile[];
    onReplay: () => void;
    onFightAgain: () => void;
    onExit: () => void;
    sharedImages?: Record<string, string>;
    playerRecord?: PetBattleRecord;
    enemyRecord?: PetBattleRecord;
};

export function PetColiseum({
    playerPet, enemyPet, enemyOwner, playerReservePet, enemyReservePet, frame, result,
    onReplay, onFightAgain, onExit, sharedImages = {}, playerRecord, enemyRecord,
}: PetColiseumProps) {
    const floor = useMemo(() => loadSceneTexture(COLISEUM_FLOOR_URL), []);
    const backdrop = useMemo(() => loadSceneTexture(COLISEUM_BG_URL), []);
    const playerTex = usePetTexture(playerPet, sharedImages);
    const enemyTex = usePetTexture(enemyPet, sharedImages, true);
    // Reserve textures (2v2). Hooks must run unconditionally, so absent
    // reserves fall back to the lead pet's art — never rendered in that case.
    const playerResTex = usePetTexture(playerReservePet ?? playerPet, sharedImages);
    const enemyResTex = usePetTexture(enemyReservePet ?? enemyPet, sharedImages, true);
    const orbit = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("orbit") === "1";
    // Battle SFX — reuses the shared per-frame picker so sound matches the DOM
    // renderer exactly (only one renderer is mounted at a time → no double-play).
    const [sfxMuted, setSfxMuted] = useState(isPetSfxMuted());
    usePetBattleFrameSfx(frame, sfxMuted);

    // Pre-fight 5-second face-off countdown — same behaviour as the DOM
    // renderer's overlay (5→4→3→2→1→"FIGHT!"). Cosmetic only.
    const [prefightCount, setPrefightCount] = useState<number | null>(null);
    useEffect(() => {
        // Mirrors the accepted countdown effect in PetArenaBattlefield verbatim.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!frame?.isPrefight) { setPrefightCount(null); return; }
        setPrefightCount(5);
        const id = window.setInterval(() => {
            setPrefightCount((c) => (c === null || c <= 0 ? c : c - 1));
        }, 1000);
        return () => window.clearInterval(id);
    }, [frame?.isPrefight, frame?.message]);

    // ── Frame derivations — mirror PetArenaBattlefield exactly so behaviour and
    //    determinism match the DOM renderer. In 2v2 (frame.party4v4 present) the
    //    frame names the exact acting/target SLOTS; 1v1 derives from actor side. ──
    const party = frame?.party4v4;
    const slotPet = (slot?: string): Pet | undefined =>
        slot === "playerLead" ? playerPet
        : slot === "playerReserve" ? playerReservePet
        : slot === "enemyLead" ? enemyPet
        : slot === "enemyReserve" ? enemyReservePet
        : undefined;
    const playerPos = frame?.playerPos ?? 29;
    const enemyPos = frame?.enemyPos ?? 40;
    const selfTile = party?.actorSlot ? party[party.actorSlot].pos : frame?.actor === "enemy" ? enemyPos : playerPos;
    const targetTile = party?.targetSlot ? party[party.targetSlot].pos : frame?.actor === "enemy" ? playerPos : enemyPos;
    const actingPet = party?.actorSlot ? slotPet(party.actorSlot) : frame?.actor === "player" ? playerPet : frame?.actor === "enemy" ? enemyPet : undefined;
    const actingElement = frame?.actor === "system" ? undefined : actingPet?.element;

    const playerHp = frame?.playerHp ?? playerPet.hp;
    const enemyHp = frame?.enemyHp ?? enemyPet.hp;
    const playerPct = Math.max(0, Math.min(100, (playerHp / Math.max(1, playerPet.hp)) * 100));
    const enemyPct = Math.max(0, Math.min(100, (enemyHp / Math.max(1, enemyPet.hp)) * 100));

    const winnerSide: "player" | "enemy" | null = result === "Victory" ? "player" : result === "Defeat" ? "enemy" : null;
    const resolvedWinnerId = winnerSide === "player" ? playerPet.id : winnerSide === "enemy" ? enemyPet.id : null;

    const battleDist = tileDistance(selfTile, targetTile);
    const animActorId = party?.actorSlot ? (slotPet(party.actorSlot)?.id ?? "") : frame?.actor === "enemy" ? enemyPet.id : playerPet.id;
    const animTargetId = party?.targetSlot ? (slotPet(party.targetSlot)?.id ?? "") : frame?.actor === "enemy" ? playerPet.id : enemyPet.id;
    const animVfxKey = elementVfxKey(actingElement);

    const animEvents = useMemo(() => {
        if (!frame) return [];
        return buildPetAnimationEvents({
            frame: {
                actor: frame.actor, actionKind: frame.actionKind, damage: frame.damage,
                crit: frame.crit, isKO: frame.isKO, isPrefight: frame.isPrefight,
                message: frame.message, signatureMove: frame.signatureMove ?? null,
            },
            dist: battleDist, actorId: animActorId, targetId: animTargetId, vfxKey: animVfxKey,
            isResultFrame: frame.actionKind === "result" && !frame.isKO,
            winnerId: resolvedWinnerId, loserId: animTargetId,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [frame?.message]);

    // ── Hit-stop scheduler — identical budgeting to the DOM renderer. ──
    const [animIdx, setAnimIdx] = useState(0);
    useEffect(() => {
        // Reset + schedule the per-beat timeline. This mirrors the accepted
        // scheduler in PetArenaBattlefield (App.tsx) verbatim; the synchronous
        // reset is intentional (a fresh frame restarts its queue at beat 0).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAnimIdx(0);
        if (animEvents.length <= 1) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduce) { setAnimIdx(animEvents.length - 1); return; }
        const pace = petFramePace(frame);
        const total = animEvents.reduce((s, e) => s + e.durationMs, 0) || 1;
        const victimMaxHp = Math.max(1, frame?.actor === "enemy" ? playerPet.hp : enemyPet.hp);
        const holdOpts = { crit: !!frame?.crit, signature: !!frame?.signatureMove, isKO: !!frame?.isKO, heavyHit: !!frame?.damage && frame.damage >= victimMaxHp * 0.18 };
        const rawHolds = animEvents.map((e) => petCameraHoldMs(e.type, holdOpts));
        const rawHoldTotal = rawHolds.reduce((s, h) => s + h, 0);
        const holdBudget = Math.min(pace * 0.35, rawHoldTotal);
        const holdScale = rawHoldTotal > 0 ? holdBudget / rawHoldTotal : 0;
        const scale = Math.min(1, Math.max(0, pace * 0.9 - holdBudget) / total);
        const timers: number[] = [];
        let acc = 0;
        for (let i = 1; i < animEvents.length; i++) {
            acc += animEvents[i - 1].durationMs * scale + rawHolds[i - 1] * holdScale;
            timers.push(window.setTimeout(() => setAnimIdx(i), acc));
        }
        return () => timers.forEach((t) => window.clearTimeout(t));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animEvents]);
    const activeAnimEvent = animEvents[animIdx];

    // ── Per-pet fainted flags (1v1; 2v2 uses per-slot ko in the render). Poses
    //    resolve per-combatant in the render block via petPoseForAvatar. ──
    const playerFainted = !winnerSide ? playerHp <= 0 : winnerSide === "enemy";
    const enemyFainted = !winnerSide ? enemyHp <= 0 : winnerSide === "player";

    // ── Camera shake amplitude for this beat. ──
    const victimMaxHp = Math.max(1, frame?.actor === "enemy" ? playerPet.hp : enemyPet.hp);
    const heavyHit = !!frame?.damage && frame.damage >= victimMaxHp * 0.18;
    const camState = petBattleCamera({
        resolved: !!winnerSide, isKO: !!frame?.isKO, crit: !!frame?.crit,
        signature: !!frame?.signatureMove, heavyHit,
        activeType: activeAnimEvent?.type, sigCharge: !!frame?.signatureMove && activeAnimEvent?.type === "charge",
    });
    const shakeAmp = camState.className ? shakeAmpForBeat(activeAnimEvent?.type, { isKO: !!frame?.isKO, crit: !!frame?.crit, signature: !!frame?.signatureMove, heavyHit }) : 0;

    // ── VFX + floating-number spawns, keyed on the active beat (mirrors the DOM
    //    renderer's fx effect; uses world coords from the sim tiles). ──
    const [fx, setFx] = useState<FxInstance[]>([]);
    const [labels, setLabels] = useState<LabelInstance[]>([]);
    const seq = useRef(0);
    useEffect(() => {
        if (winnerSide || !activeAnimEvent) return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        const beat = activeAnimEvent.type as PetBattleAnimationEventType;
        const self3 = tileToWorld(selfTile); const tgt3 = tileToWorld(targetTile);
        const fromV: Vec3 = [self3.x, FX_Y, self3.z];
        const toV: Vec3 = [tgt3.x, FX_Y, tgt3.z];
        const sigSide = frame?.signatureMove?.side;
        const actorElement = (sigSide ?? frame?.actor) === "enemy" ? enemyPet.element : playerPet.element;

        if (beat === "projectile") {
            // Elemental VFX flying between them.
            const f = bundledJutsuFxFrames(String(activeAnimEvent.vfxKey ?? "none"));
            if (f) { const id = seq.current++; setFx((p) => [...p, { id, frames: f, from: fromV, to: toV, durationMs: 320, scale: 1.1 }]); }
        } else if (beat === "impact" || beat === "beam" || beat === "statusApply" || beat === "charge" || beat === "guard") {
            const focal = beat === "charge" || beat === "guard" ? fromV : toV;
            const pick = petFxSpriteKey({
                beat, actionKind: frame?.actionKind, vfxKey: activeAnimEvent.vfxKey,
                signature: !!frame?.signatureMove, flagship: !!frame?.signatureMove?.flagship,
                element: actorElement, isKO: !!frame?.isKO,
            });
            const f = pick.key ? bundledJutsuFxFrames(pick.key) : null;
            if (f) { const id = seq.current++; setFx((p) => [...p, { id, frames: f, from: focal, durationMs: 360, scale: 1.7 }]); }
        }

        // Floating number on the damage beat.
        if (beat === "damageNumber" && activeAnimEvent.text) {
            const id = seq.current++;
            const cls = frame?.crit ? "damage-number crit-text" : frame?.actionKind === "heal" ? "heal-number" : "damage-number";
            setLabels((p) => [...p, { id, text: activeAnimEvent.text!, className: cls, pos: [toV[0], FX_Y + 0.6, toV[2]] }]);
            window.setTimeout(() => setLabels((p) => p.filter((l) => l.id !== id)), 900);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animIdx, frame?.message]);

    // ── Per-move toast ("X used Y!"). ──
    const moveName = extractPetMoveName(frame?.message);
    const actorName = frame?.actor === "enemy" ? enemyPet.name : playerPet.name;
    const toast = frame && !frame.isPrefight && frame.actionKind && frame.actionKind !== "result" && moveName
        ? `${actorName} used ${moveName}!` : null;

    return (
        <div style={{ position: "relative", width: "100%", height: 560, borderRadius: 12, overflow: "hidden", background: "linear-gradient(#3a2a16, #1a1206 60%, #0a0703)" }}>
            <Canvas dpr={[1, 2]} camera={{ position: CAM_POS, fov: CAM_FOV }} onCreated={({ camera }) => camera.lookAt(CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2])}>
                <fog attach="fog" args={["#2a1c10", 22, 48]} />
                <Arena floor={floor} backdrop={backdrop} />
                {(() => {
                    // Combatant list: the two leads (1v1), or all four slots when
                    // the frame carries party4v4 (2v2) — each with its OWN tile,
                    // HP and KO state from the slot snapshot. Positions get the
                    // pairwise minimum separation; motion direction + gap-aware
                    // lunge reach derive from the nearest living opponent.
                    const combatants = party
                        ? ([
                            { side: "player" as const, snap: party.playerLead, pet: playerPet as Pet | undefined, tex: playerTex },
                            { side: "player" as const, snap: party.playerReserve, pet: playerReservePet, tex: playerResTex },
                            { side: "enemy" as const, snap: party.enemyLead, pet: enemyPet as Pet | undefined, tex: enemyTex },
                            { side: "enemy" as const, snap: party.enemyReserve, pet: enemyReservePet, tex: enemyResTex },
                        ])
                            .filter((e) => e.pet && e.snap)
                            .map((e) => ({
                                pet: e.pet!, side: e.side, tile: e.snap.pos, tex: e.tex,
                                hp: e.snap.hp, maxHp: e.snap.maxHp,
                                fainted: e.snap.ko || e.snap.hp <= 0,
                            }))
                        : [
                            { pet: playerPet, side: "player" as const, tile: playerPos, tex: playerTex, hp: playerHp, maxHp: Math.max(1, playerPet.hp), fainted: playerFainted },
                            { pet: enemyPet, side: "enemy" as const, tile: enemyPos, tex: enemyTex, hp: enemyHp, maxHp: Math.max(1, enemyPet.hp), fainted: enemyFainted },
                        ];
                    const spread = spreadPositions(combatants.map((c) => tileToWorld(c.tile)));
                    return combatants.map((c, i) => {
                        const pos = spread[i];
                        const foes = combatants
                            .map((o, j) => ({ o, p: spread[j] }))
                            .filter((e) => e.o.side !== c.side);
                        const pool = foes.filter((e) => !e.o.fainted).length ? foes.filter((e) => !e.o.fainted) : foes;
                        let toward = c.side === "player" ? 1 : -1;
                        let reach = lungeReach(2.5);
                        if (pool.length) {
                            let bd = Infinity, bp = pool[0].p;
                            for (const e of pool) {
                                const d = Math.hypot(e.p.x - pos.x, e.p.z - pos.z);
                                if (d < bd) { bd = d; bp = e.p; }
                            }
                            toward = (bp.x - pos.x) >= 0 ? 1 : -1;
                            reach = lungeReach(bd);
                        }
                        const pose = petPoseForAvatar(activeAnimEvent, c.pet.id, !!winnerSide && winnerSide === c.side && !c.fainted, c.fainted);
                        return (
                            <Standee key={c.pet.id} pet={c.pet} side={c.side} pos={pos} reach={reach} toward={toward}
                                pose={pose} fainted={c.fainted} hp={c.hp} maxHp={c.maxHp} texture={c.tex} />
                        );
                    });
                })()}
                {fx.map((f) => (
                    <FxAnim key={f.id} frames={f.frames} from={f.from} to={f.to} durationMs={f.durationMs} scale={f.scale}
                        onDone={() => setFx((p) => p.filter((x) => x.id !== f.id))} />
                ))}
                {labels.map((l) => (
                    <Html key={l.id} position={l.pos} center distanceFactor={9} pointerEvents="none" zIndexRange={[20, 0]}>
                        <span className={l.className} style={{ font: "800 18px Inter, system-ui, sans-serif" }}>{l.text}</span>
                    </Html>
                ))}
                {!orbit && <CameraRig amp={shakeAmp} shakeKey={animIdx} />}
                {orbit && <OrbitControls target={CAM_LOOK} />}
            </Canvas>

            {/* ── DOM overlays (not in 3D) ─────────────────────────────────── */}
            {/* Pre-fight VS face-off — reuses the DOM renderer's prefight CSS
                (overlay, slide-ins, countdown pop) over the dimmed 3D arena.
                In 2v2 each side also introduces its reserve as a small chip. */}
            {frame?.isPrefight && (() => {
                const miniSrc = (p?: Pet) => p
                    ? (sharedImages["pet:" + p.id] || sharedImages["pet:" + p.id.replace(/-\d{10,}$/, "")] || p.image || "")
                    : "";
                const reserveChip = (p?: Pet) => p && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, color: "#cbd5e1", font: "600 12px Inter, system-ui, sans-serif" }}>
                        <span style={{ color: "#94a3b8" }}>＋</span>
                        {miniSrc(p) ? <img src={miniSrc(p)} alt={p.name} style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", border: "1px solid #334155" }} /> : null}
                        <span>{p.name} · Lv {p.level}</span>
                    </div>
                );
                const sideCard = (pet: Pet, side: "player" | "enemy", record?: PetBattleRecord, reserve?: Pet) => (
                    <div className={`pet-prefight-side ${side}`}>
                        <div className="pet-prefight-portrait">
                            <PetBattleAvatar pet={pet} side={side} active sharedImages={sharedImages} />
                        </div>
                        <div className={`pet-prefight-name ${side}`}>{pet.name}</div>
                        <div className="pet-prefight-sub">Lv {pet.level} · {pet.rarity}{pet.element && pet.element !== "None" ? ` · ${pet.element}` : ""}</div>
                        <div className="pet-prefight-archetype">{petArchetypeFor(pet)}</div>
                        <div className="pet-prefight-stats">
                            <span>❤ {pet.hp}</span><span>⚔ {pet.attack}</span><span>🛡 {pet.defense}</span><span>⚡ {pet.speed}</span>
                        </div>
                        {record && (
                            <div className="pet-prefight-record">
                                {record.wins !== undefined && <><span className="rec-w">{record.wins}W</span> <span className="rec-l">{record.losses ?? 0}L</span></>}
                                {record.rating !== undefined && <span className="rec-elo">{record.wins !== undefined ? " · " : ""}{record.rating} Elo</span>}
                            </div>
                        )}
                        {reserveChip(reserve)}
                    </div>
                );
                return (
                    <div className="pet-prefight-overlay">
                        <div className="pet-prefight-vs">
                            {sideCard(playerPet, "player", playerRecord, playerReservePet)}
                            <span className="pet-prefight-vs-label">VS</span>
                            {sideCard(enemyPet, "enemy", enemyRecord, enemyReservePet)}
                        </div>
                        <div className="pet-prefight-tagline">
                            {prefightCount !== null && prefightCount > 0
                                ? <span className="pet-prefight-count" key={prefightCount}>{prefightCount}</span>
                                : <span className="pet-prefight-go">FIGHT!</span>}
                        </div>
                    </div>
                );
            })()}

            {toast && (
                <div key={frame?.message} style={{ position: "absolute", top: 56, right: 14, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(15,23,42,0.92)", border: "1px solid #334155", borderRadius: 10, color: "#e2e8f0", font: "700 13px Inter, system-ui, sans-serif", boxShadow: "0 4px 16px #0008" }}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, background: elementColor(actingElement).base }} />
                    {toast}
                </div>
            )}

            <div style={{ position: "absolute", bottom: 14, left: 14, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "rgba(15,23,42,0.92)", border: "1px solid #334155", borderRadius: 10, color: "#e2e8f0", font: "700 13px Inter, system-ui, sans-serif" }}>
                <span style={{ width: 38, height: 38, borderRadius: 8, background: elementColor(playerPet.element).base, display: "grid", placeItems: "center", color: "#0b1020", fontWeight: 800 }}>{playerPet.name.slice(0, 2).toUpperCase()}</span>
                <div>
                    <div>Lv.{playerPet.level} {playerPet.name}</div>
                    <div style={{ width: 150, height: 9, marginTop: 4, background: "#0b1020", borderRadius: 5, overflow: "hidden", border: "1px solid #000" }}>
                        <div style={{ width: `${playerPct}%`, height: "100%", background: "#4ade80", transition: "width .35s" }} />
                    </div>
                </div>
            </div>

            {/* Enemy mini HP (top-left) so both bars read even at distance. */}
            <div style={{ position: "absolute", top: 14, left: 14, padding: "6px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", font: "700 12px Inter, system-ui, sans-serif" }}>
                <div>{enemyPet.name} · {enemyOwner}</div>
                <div style={{ width: 130, height: 8, marginTop: 3, background: "#0b1020", borderRadius: 5, overflow: "hidden", border: "1px solid #000" }}>
                    <div style={{ width: `${enemyPct}%`, height: "100%", background: "#f87171", transition: "width .35s" }} />
                </div>
            </div>

            {result && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(5,7,13,0.55)" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ font: "900 38px Inter, system-ui, sans-serif", color: result === "Victory" ? "#4ade80" : result === "Defeat" ? "#f87171" : "#facc15", textShadow: "0 2px 12px #000" }}>{result}</div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                            <button onClick={onReplay} style={resultBtn}>⟲ Replay</button>
                            <button onClick={onFightAgain} style={resultBtn}>⚔ Fight again</button>
                            <button onClick={onExit} style={{ ...resultBtn, background: "#334155" }}>Exit</button>
                        </div>
                    </div>
                </div>
            )}

            <button
                onClick={() => { const next = !sfxMuted; setSfxMuted(next); setPetSfxMuted(next); }}
                title={sfxMuted ? "Unmute battle sound" : "Mute battle sound"}
                style={{ position: "absolute", top: 14, right: 14, width: 34, height: 34, display: "grid", placeItems: "center", background: "rgba(15,23,42,0.85)", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", cursor: "pointer", fontSize: 15 }}
            >
                {sfxMuted ? "🔇" : "🔊"}
            </button>

            <div style={{ position: "absolute", bottom: 12, right: 14, color: "#64748b", font: "600 11px Inter, system-ui, sans-serif" }}>HD-2D coliseum · ?orbit=1 to rotate</div>
        </div>
    );
}

const resultBtn: React.CSSProperties = { padding: "8px 14px", background: "#1e3a8a", color: "#fff", border: "1px solid #3b82f6", borderRadius: 8, cursor: "pointer", font: "700 13px Inter, system-ui, sans-serif" };
