// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Sparkles } from "@react-three/drei";
import type { Pet } from "../../types/pet";
import { elementVfxKey } from "../../lib/pet-battle-anim";
import { arenaAbilityFxKey, arenaKillFxKey, multiKillLabel } from "../../lib/jutsu-vfx";
import { bundledJutsuFxFrames } from "../../lib/jutsu-fx-assets";
import { projectileVisual, type ProjectileVisual } from "../../lib/pet-projectile-vfx";
import { lerp, groundedSpriteLayout } from "../../lib/pet-coliseum-scene";
import { runPetArenaMatch, ARENA_TPS, BASE_SCORE_RANGE, BOSS_RADIUS, BOSS_ATK_RADIUS, type ArenaResult, type ArenaSnapshot, type ArenaState, type ArenaRole, type ArenaSlot, type ShrineKind } from "../../lib/pet-arena-sim";
import { petVisualId } from "../../data/pet-evolutions";
import { petArenaV2Enabled, petArena3dEnabled } from "../../lib/pet-coliseum-flag";
import { petCombatModel } from "../../lib/pet-3d-models";
import { PetArena3DStage } from ".././PetArena3DStage";
import { type PoseCat, makeGhostMaterial, usePetSprite, usePetPoses, shadowTexture, glowTexture, shrineTexture, type WardenFrame, wardenFrame } from "./sprite-resources";
import { type DuelClock, elementTint, arenaPlace, type Vec3, STAGE, DIORAMA_URL, duelBtn, resultBtn } from "./stage";
import { ProjectileBody, StageCamera, FxAnim, BloomFx } from "./stage-components";


// ═════════════════════════════════════════════════════════════════════════════
// PetArenaMatch — the Tactical Pet Arena game mode (docs/pet-arena-mode-plan.md):
// capture-the-scroll, 2v2/4v4: first to 5 CAPTURES wins (kills don't score — they
// remove a pet for a ~7s respawn window). Plays the deterministic match sim
// (pet-arena-sim.ts) on the same diorama stage, reusing the projection + pose
// flipbook + FX. Also the engine behind the Tactical ranked ladder.
// ═════════════════════════════════════════════════════════════════════════════
const ARENA_SPRITE_H = 1.05;

// Render-side motion smoothing factor (per frame) for the drawn sprite position —
// a light low-pass that rounds the deterministic sim's piecewise-linear corners
// and damps clump-jitter without touching the sim. Higher = snappier/less lag.
const ARENA_POS_SMOOTH = 0.4;

const ROLE_COLOR: Record<ArenaRole, string> = { defender: "#60a5fa", tracker: "#34d399", assassin: "#f87171", sage: "#fbbf24" };

const ROLE_TAG: Record<ArenaRole, string> = { defender: "DEF", tracker: "TRK", assassin: "ASN", sage: "SGE" };

const findArenaActor = (s: ArenaSnapshot, id: string) => s.actors.find((a) => a.id === id);

function arenaPoseCat(st: ArenaState): PoseCat {
    if (st === "attack" || st === "dash") return "attack";
    if (st === "channel") return "cast";
    if (st === "respawning" || st === "dead") return "hurt";
    return "idle";
}


/** One arena fighter — pose flipbook + facing + HP/lives/role nameplate + carrier
 *  aura, faded while respawning/dead. Driven by the match snapshot stream. */
// One arena dash-trail ghost — element-flat silhouette behind the sprite, faded in
// by the parent's speed gate. Owns its material via a ref so the per-frame uniform
// writes are compiler-safe (mutating a memo from a parent useFrame is not).
function ArenaGhost({ index, offsetX, fastRef, tex, color, L }: {
    index: number; offsetX: number; fastRef: { current: number }; tex: THREE.Texture; color: string; L: ReturnType<typeof groundedSpriteLayout>;
}) {
    const mat = useRef<THREE.ShaderMaterial>(null);
    const material = useMemo(() => makeGhostMaterial(color), [color]);
    useEffect(() => () => material.dispose(), [material]);
    useFrame(() => {
        const m = mat.current; if (!m) return;
        m.uniforms.map.value = tex;
        m.uniforms.uOpacity.value = lerp(m.uniforms.uOpacity.value as number, fastRef.current * 0.42, 0.4);
    });
    return (
        <mesh position={[L.meshX + offsetX, L.meshY, -0.04 - index * 0.01]}>
            <planeGeometry args={[L.planeW, L.planeH]} />
            <primitive object={material} ref={mat} attach="material" />
        </mesh>
    );
}


function ArenaStandee({ result, clock, id, pet, sharedImages }: {
    result: ArenaResult; clock: { current: DuelClock }; id: string; pet: Pet; sharedImages: Record<string, string>;
}) {
    const sprite = usePetSprite(pet, sharedImages, false);
    const poses = usePetPoses(petVisualId(pet), false);
    const group = useRef<THREE.Group>(null);
    const flip = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const shadow = useRef<THREE.Mesh>(null);
    const shadowMat = useRef<THREE.MeshBasicMaterial>(null);
    const glowMat = useRef<THREE.MeshBasicMaterial>(null);
    const aura = useRef<THREE.Mesh>(null);
    const auraMat = useRef<THREE.MeshBasicMaterial>(null);
    const carryMark = useRef<HTMLSpanElement>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const nameWrap = useRef<HTMLDivElement>(null);
    const facing = useRef(id.startsWith("blue") ? 1 : -1);
    const lastPos = useRef<[number, number]>([0, 0]);
    const wasMoving = useRef(false);   // hysteresis on the move/idle gate → a pet hovering near the threshold can't flicker idle↔run pose (which amplified any residual jitter)
    const scaleSm = useRef(0);   // smoothed depth-scale → absorbs any residual position jitter so the sprite never pulses big↔small (snaps on a teleport)
    const smX = useRef<number | null>(null), smY = useRef<number | null>(null);   // smoothed DRAW position (render-side low-pass; snaps on a teleport)
    const prevDown = useRef(false);   // was the pet hidden (respawning/dead) last frame → snap, never lerp, across the off-screen respawn jump (robust at any framerate)
    const reviveRef = useRef<HTMLDivElement>(null);     // "↻ Ns" respawn countdown shown while down
    const abilityPipRef = useRef<HTMLSpanElement>(null); // role-ability-ready glow dot
    const runClock = useRef(0);
    const fast = useRef(0);   // speed gate 0..1 → dash-trail opacity (read by the ArenaGhost children)
    const tint = useMemo(() => elementTint(pet.element), [pet.element]);
    const bobPhase = useMemo(() => (id.charCodeAt(id.length - 1) % 7) * 0.9, [id]);
    const [poseCat, setPoseCat] = useState<PoseCat>("idle");
    const [lives, setLives] = useState(3);
    const team = id.startsWith("blue") ? "blue" : "red";
    const auraColor = team === "blue" ? "#3b82f6" : "#ef4444";   // team-colored ground glow → parse teams at a glance
    const role = (result.snapshots[0] && findArenaActor(result.snapshots[0], id)?.role) || "tracker";

    const useTex = poses ? poses.tex[poseCat] : sprite.texture;
    const useBounds = poses ? poses.scan[poseCat].bounds : sprite.bounds;
    const useAspect = poses ? poses.scan[poseCat].aspect : sprite.aspect;
    const L = useMemo(() => groundedSpriteLayout(useBounds, useAspect, ARENA_SPRITE_H, false), [useBounds, useAspect]);
    const shadowW = Math.max(0.55, L.contentWorldW * 0.95);

    useFrame((state, delta) => {
        const g = group.current, m = mat.current; if (!g || !m) return;
        const snaps = result.snapshots;
        const tf = Math.max(0, Math.min(snaps.length - 1, clock.current.t));
        const i0 = Math.floor(tf), i1 = Math.min(snaps.length - 1, i0 + 1), f = tf - i0;
        const a0 = findArenaActor(snaps[i0], id); if (!a0) return;
        const a1 = findArenaActor(snaps[i1], id) ?? a0;
        const down = a0.state === "respawning" || a0.state === "dead";
        // Snap (don't interpolate) across a respawn TELEPORT: a >3-field-unit jump in a
        // single tick is never real movement, and lerping it slides the sprite across the
        // whole board while the perspective scale sweeps — the "grows huge then small"
        // glitch. Hard-cut at the tick midpoint instead.
        const tdx = a1.x - a0.x, tdy = a1.y - a0.y;
        const teleport = (tdx * tdx + tdy * tdy) > 9;
        const ff = teleport ? (f < 0.5 ? 0 : 1) : f;
        const p = arenaPlace(lerp(a0.x, a1.x, ff), lerp(a0.y, a1.y, ff));
        const dx = p.wx - lastPos.current[0], dy = p.wy - lastPos.current[1];
        // Zero "speed" while hidden AND on the first frame back — a respawn teleports the
        // body across the board, so the reappear must never read as a dash (trail / run pose).
        const justBack = prevDown.current && !down;
        const spd = (down || justBack) ? 0 : Math.sqrt(dx * dx + dy * dy); lastPos.current = [p.wx, p.wy];
        // Hysteresis: a higher turn-on than turn-off speed, so a pet sitting at the
        // edge of "moving" stays committed to idle OR run instead of toggling every
        // frame (the toggle made run/idle poses strobe and amplified any tiny jitter).
        const moving = !down && (wasMoving.current ? spd > 0.006 : spd > 0.016);
        wasMoving.current = moving;
        // Smooth the depth-scale: snap on a teleport (which already hard-cuts position)
        // or across a respawn, else ease toward the target so a jittery tick can't pop size.
        scaleSm.current = (teleport || down || prevDown.current || scaleSm.current === 0) ? p.depth : lerp(scaleSm.current, p.depth, 0.25);
        // Render-side motion smoothing: ease the DRAWN position toward the interpolated
        // sim position so the sim's piecewise-linear heading changes (separation nudges,
        // path replans) round off and clump-jitter is damped — never touches the sim.
        // Snap (don't lerp) on a teleport AND while hidden / on the first frame back, so the
        // across-the-board respawn jump never slides the body in — robust at any framerate.
        if (smX.current === null || smY.current === null || teleport || down || prevDown.current) { smX.current = p.wx; smY.current = p.wy; }
        else { smX.current += (p.wx - smX.current) * ARENA_POS_SMOOTH; smY.current += (p.wy - smY.current) * ARENA_POS_SMOOTH; }
        const drawX = smX.current, drawY = smY.current;
        prevDown.current = down;
        // Dash trail: a single element-flat ghost that fades in ONLY at genuine dash speed
        // (an assassin dive streaks; an ordinary stroll doesn't). Gate raised so routine
        // movement no longer leaves a constant smear of afterimages.
        fast.current = down ? 0 : Math.max(0, Math.min(1, (spd - 0.07) / 0.13));
        const bob = moving ? Math.abs(Math.sin(state.clock.elapsedTime * 13 + bobPhase)) * 0.16 : 0;
        g.position.set(drawX, drawY + bob * p.depth, p.zo);
        g.scale.setScalar(scaleSm.current);
        // Hide downed/respawning pets entirely — a faded corpse frozen at the death spot
        // read as a "spawn freeze". The scorch decal + kill FX already mark where it fell.
        g.visible = !down;

        if (Math.abs(a0.faceX) > 0.12) facing.current = a0.faceX < 0 ? -1 : 1;
        if (flip.current) { flip.current.scale.x = facing.current; flip.current.rotation.z = lerp(flip.current.rotation.z, moving ? -0.12 : 0, 0.2); }

        let cat = arenaPoseCat(a0.state);
        if (moving && poses?.hasRun) { runClock.current += delta * 8.5; cat = Math.floor(runClock.current) % 2 === 0 ? "run-a" : "run-b"; }
        if (cat !== poseCat) setPoseCat(cat);
        m.opacity = down ? 0.28 : 1;

        if (a0.lives !== lives) setLives(a0.lives);
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, (a0.hp / Math.max(1, a0.maxHp)) * 100))}%`;
        // Readouts (sim emits these for display only): a respawn countdown so a downed
        // pet reads "back in Ns" instead of just vanishing, + an ability-ready glow dot.
        const respawning = a0.state === "respawning";
        if (nameWrap.current) nameWrap.current.style.opacity = respawning ? "0.92" : a0.state === "dead" ? "0.3" : "1";
        if (reviveRef.current) { reviveRef.current.style.display = respawning ? "block" : "none"; if (respawning) reviveRef.current.textContent = `↻ ${a0.respawnSecs}s`; }
        if (abilityPipRef.current) abilityPipRef.current.style.opacity = (!down && a0.abilityReady) ? "1" : "0";
        if (glowMat.current) glowMat.current.opacity = a0.carrying ? 0.55 + Math.abs(Math.sin(state.clock.elapsedTime * 5)) * 0.35 : 0;
        if (carryMark.current) carryMark.current.style.display = a0.carrying ? "inline" : "none";
        if (shadow.current && shadowMat.current) {
            shadow.current.position.set(drawX, drawY - 0.08 * p.depth, p.zo - 0.1);
            shadow.current.scale.set(shadowW * scaleSm.current, shadowW * 0.32 * scaleSm.current, 1);
            shadowMat.current.opacity = down ? 0 : 0.4;
        }
        if (aura.current && auraMat.current) {   // team-colored ground glow (brighter while carrying)
            aura.current.position.set(drawX, drawY - 0.05 * p.depth, p.zo - 0.12);
            const aw = shadowW * 1.6 * scaleSm.current; aura.current.scale.set(aw, aw * 0.46, 1);
            auraMat.current.opacity = down ? 0 : (a0.carrying ? 0.85 : 0.5);
        }
    });

    return (
        <group>
            <mesh ref={aura} renderOrder={-2}><planeGeometry args={[1, 1]} /><meshBasicMaterial ref={auraMat} map={shadowTexture()} color={auraColor} transparent opacity={0.5} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
            <mesh ref={shadow} renderOrder={-1}><planeGeometry args={[1, 1]} /><meshBasicMaterial ref={shadowMat} map={shadowTexture()} transparent opacity={0.4} depthWrite={false} depthTest={false} toneMapped={false} /></mesh>
            <group ref={group}>
                <mesh position={[0, shadowW * 0.5, -0.05]}><planeGeometry args={[shadowW * 2.6, shadowW * 2.6]} /><meshBasicMaterial ref={glowMat} map={shadowTexture()} color="#fde047" transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
                <group ref={flip}>
                    {/* A single dash-trail ghost BEHIND the sprite (local -x = behind facing), faded in only at dash speed. */}
                    <ArenaGhost index={0} offsetX={-0.55} fastRef={fast} tex={useTex} color={tint} L={L} />
                    <mesh position={[L.meshX, L.meshY, 0]}>
                        <planeGeometry args={[L.planeW, L.planeH]} />
                        <meshBasicMaterial ref={mat} map={useTex} transparent alphaTest={0.4} depthWrite={false} toneMapped={false} />
                    </mesh>
                </group>
                {/* Idle elemental aura — a few drifting element-tinted wisps so the creature reads ALIVE, not a static cutout. */}
                <Sparkles count={5} scale={[1.0, 1.5, 0.6]} position={[0, 0.95, 0.05]} size={2.6} speed={0.25} opacity={0.5} color={tint} noise={1.2} />
                <Html position={[0, L.contentWorldH + 0.4, 0]} center pointerEvents="none" zIndexRange={[6, 0]}>
                    <div ref={nameWrap} style={{ textAlign: "center", font: "700 10px Inter, system-ui, sans-serif", whiteSpace: "nowrap", userSelect: "none", transform: "scale(0.78)" }}>
                        <div style={{ display: "flex", gap: 3, alignItems: "center", justifyContent: "center", marginBottom: 2 }}>
                            <span ref={carryMark} style={{ display: "none", filter: "drop-shadow(0 0 3px #fde047)" }}>📜</span>
                            <span style={{ color: ROLE_COLOR[role], border: `1px solid ${ROLE_COLOR[role]}`, borderRadius: 3, padding: "0 2px", fontSize: 8 }}>{ROLE_TAG[role]}</span>
                            <span ref={abilityPipRef} title="ability charged" style={{ width: 5, height: 5, borderRadius: 5, background: ROLE_COLOR[role], boxShadow: `0 0 5px ${ROLE_COLOR[role]}`, opacity: 0 }} />
                            <span style={{ color: "#fff", textShadow: "0 1px 2px #000" }}>{pet.name}</span>
                        </div>
                        <div style={{ width: 56, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ width: "100%", height: "100%", background: team === "blue" ? "#4ade80" : "#f87171" }} />
                        </div>
                        <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 2 }}>
                            {[0, 1, 2].map((i) => (<span key={i} style={{ width: 5, height: 5, borderRadius: 5, background: i < lives ? (team === "blue" ? "#60a5fa" : "#fca5a5") : "#334155" }} />))}
                        </div>
                        <div ref={reviveRef} style={{ display: "none", marginTop: 2, color: "#fde047", font: "800 10px Inter, system-ui, sans-serif", textShadow: "0 1px 3px #000" }} />
                    </div>
                </Html>
            </group>
        </group>
    );
}


/** The center scroll — a floating relic, with a channel ring while being picked up. */
function ArenaScroll({ result, clock }: { result: ArenaResult; clock: { current: DuelClock } }) {
    const grp = useRef<THREE.Group>(null);
    const beacon = useRef<THREE.Mesh>(null);
    const beaconMat = useRef<THREE.MeshBasicMaterial>(null);
    const ringRef = useRef<HTMLDivElement>(null);
    const capRef = useRef<HTMLDivElement>(null);   // "Capturing…" label while a pet channels the pickup
    const [visible, setVisible] = useState(false);
    useFrame((state) => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const sc = snaps[i].scroll;
        const vis = sc.state !== "inactive";
        if (vis !== visible) setVisible(vis);
        if (!vis) return;
        const p = arenaPlace(sc.x, sc.y);
        if (grp.current) { grp.current.position.set(p.wx, p.wy + 0.9 * p.depth + Math.abs(Math.sin(state.clock.elapsedTime * 2)) * 0.18, 8.5); grp.current.scale.setScalar(p.depth); }
        // Pulsing ground beacon — marks WHERE the scroll is even when pets cover it
        // (the whole game is fought here). Off while it's being carried (the carrier glows instead).
        if (beacon.current && beaconMat.current) {
            const pulse = 0.5 + Math.abs(Math.sin(state.clock.elapsedTime * 3)) * 0.5;
            beacon.current.position.set(p.wx, p.wy - 0.04 * p.depth, p.zo - 0.1);
            const bw = (2.6 + pulse * 0.7) * p.depth; beacon.current.scale.set(bw, bw * 0.5, 1);
            beaconMat.current.opacity = sc.state === "carried" ? 0 : 0.4 + pulse * 0.4;
        }
        if (ringRef.current) { ringRef.current.style.opacity = sc.channelFrac > 0 ? "1" : "0"; ringRef.current.style.background = `conic-gradient(#fde047 ${sc.channelFrac * 360}deg, rgba(0,0,0,0.35) 0deg)`; }
        if (capRef.current) capRef.current.style.opacity = sc.channelFrac > 0 ? "1" : "0";   // "hold to capture" cue
    });
    if (!visible) return null;
    return (
        <group>
            <mesh ref={beacon} renderOrder={-1}><planeGeometry args={[1, 1]} /><meshBasicMaterial ref={beaconMat} map={shadowTexture()} color="#fde047" transparent opacity={0.5} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
            <group ref={grp}>
                <Html center pointerEvents="none" zIndexRange={[30, 0]}>
                    <div style={{ position: "relative", width: 42, height: 42, display: "grid", placeItems: "center" }}>
                        <div ref={ringRef} style={{ position: "absolute", inset: -7, borderRadius: "50%", opacity: 0 }} />
                        <div style={{ fontSize: 34, filter: "drop-shadow(0 0 12px #fde047) drop-shadow(0 0 5px #fff)" }}>📜</div>
                        <div ref={capRef} style={{ position: "absolute", top: 44, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", font: "800 9px Inter, system-ui, sans-serif", color: "#fde047", textShadow: "0 1px 3px #000", opacity: 0, pointerEvents: "none" }}>Capturing…</div>
                    </div>
                </Html>
            </group>
        </group>
    );
}


/** The rotating buff SHRINE — a grounded glowing relic (Chakra Font = orange power,
 *  Mending Spring = green heal) with a type-tinted ground glow, a claim ring that fills
 *  while a pet channels it, a floating label, and a pop-in on (re)spawn. Reads
 *  snap.shrine, never the sim. */
function ArenaShrine({ result, clock }: { result: ArenaResult; clock: { current: DuelClock } }) {
    const grp = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const glow = useRef<THREE.Mesh>(null);
    const glowMat = useRef<THREE.MeshBasicMaterial>(null);
    const ringRef = useRef<HTMLDivElement>(null);
    const labelRef = useRef<HTMLDivElement>(null);
    const [kind, setKind] = useState<ShrineKind>("power");
    const [visible, setVisible] = useState(false);
    const spawnAt = useRef<number | null>(null);
    const prevActive = useRef(false);
    const H = ARENA_SPRITE_H * 1.45;
    useFrame((state) => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const sh = snaps[i].shrine;
        const vis = sh.state === "active";
        if (vis !== visible) setVisible(vis);
        if (sh.kind !== kind) setKind(sh.kind);
        const now = state.clock.elapsedTime;
        if (vis && !prevActive.current) spawnAt.current = now;     // pop-in each time it (re)appears
        prevActive.current = vis;
        if (!vis || !grp.current) return;
        const sp = spawnAt.current !== null ? Math.min(1, (now - spawnAt.current) / 0.4) : 1;
        const p = arenaPlace(sh.x, sh.y);
        const bob = Math.abs(Math.sin(now * 2)) * 0.08 * p.depth;
        grp.current.position.set(p.wx, p.wy + H * 0.5 * p.depth + bob, p.zo + 0.02);
        grp.current.scale.setScalar(p.depth * (0.55 + 0.45 * sp));   // grow in
        const color = RELIC_COLOR[sh.kind] ?? "#fb923c";
        if (mat.current) mat.current.opacity = sp;
        if (glow.current && glowMat.current) {
            const pulse = 0.5 + Math.abs(Math.sin(now * 2.6)) * 0.5;
            const fr = arenaPlace(sh.x + 1.0, sh.y); const worldR = Math.max(0.7, Math.abs(fr.wx - p.wx));
            glow.current.position.set(p.wx, p.wy - 0.04 * p.depth, p.zo - 0.1);
            const gw = worldR * (2.0 + pulse * 0.6) * p.depth; glow.current.scale.set(gw, gw * 0.5, 1);
            glowMat.current.color.set(color);
            glowMat.current.opacity = sp * (0.28 + pulse * 0.22 + sh.channelFrac * 0.45);   // brighter while being claimed
        }
        if (ringRef.current) { ringRef.current.style.opacity = sh.channelFrac > 0 ? "1" : "0"; ringRef.current.style.background = `conic-gradient(${color} ${sh.channelFrac * 360}deg, rgba(0,0,0,0.35) 0deg)`; }
        if (labelRef.current) labelRef.current.style.color = color;
    });
    if (!visible) return null;
    const color = RELIC_COLOR[kind] ?? "#fb923c";
    return (
        <group>
            <mesh ref={glow} renderOrder={-1}><planeGeometry args={[1, 1]} /><meshBasicMaterial ref={glowMat} map={glowTexture()} color={color} transparent opacity={0.4} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
            <group ref={grp}>
                <mesh><planeGeometry args={[H, H]} /><meshBasicMaterial ref={mat} map={shrineTexture(kind)} transparent alphaTest={0.02} depthWrite={false} toneMapped={false} /></mesh>
                <Html center position={[0, H * 0.6, 0]} pointerEvents="none" zIndexRange={[29, 0]}>
                    <div style={{ position: "relative", width: 56, height: 44, display: "grid", placeItems: "center" }}>
                        <div ref={ringRef} style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 26, height: 26, borderRadius: "50%", opacity: 0 }} />
                        <div ref={labelRef} style={{ position: "absolute", bottom: 0, whiteSpace: "nowrap", font: "800 9px Inter, system-ui, sans-serif", color, textShadow: "0 1px 3px #000" }}>{`${RELIC_ICON[kind] ?? "◆"} ${RELIC_LABEL[kind] ?? "Relic"}`}</div>
                    </div>
                </Html>
            </group>
        </group>
    );
}


/** V2 closing ring — a pulsing purple boundary on the ground that shrinks toward centre
 *  from ~2:30. Driven entirely by snapshot.ringR (0 when inactive), so a spectator SEES why
 *  pets stampede inward and why anyone caught outside is taking damage. Purely additive (no
 *  sim coupling); inert unless the match is v2 and the ring has engaged. */
function ArenaRing({ result, clock }: { result: ArenaResult; clock: { current: DuelClock } }) {
    const grp = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    useFrame((state) => {
        if (!grp.current) return;
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const rr = result.v2 ? snaps[i].ringR : 0;
        if (rr <= 0) { grp.current.visible = false; return; }
        grp.current.visible = true;
        const c = arenaPlace(result.center[0], result.center[1]);
        const edge = arenaPlace(result.center[0] + rr, result.center[1]);
        const worldR = Math.max(0.5, Math.abs(edge.wx - c.wx));
        grp.current.position.set(c.wx, c.wy, c.zo - 0.05);
        grp.current.scale.set(worldR, worldR * 0.5, 1);   // squash to sit on the top-down ground plane
        if (mat.current) mat.current.opacity = 0.22 + Math.abs(Math.sin(state.clock.elapsedTime * 3)) * 0.18;
    });
    return (
        <group ref={grp} visible={false}>
            <mesh renderOrder={-2}><ringGeometry args={[0.93, 1, 72]} /><meshBasicMaterial ref={mat} color="#a78bfa" transparent opacity={0.3} depthWrite={false} depthTest={false} toneMapped={false} side={THREE.DoubleSide} /></mesh>
        </group>
    );
}


/** The neutral boss (Arena Warden, B4). A big grounded billboard at the centre pit, now
 *  ALIVE: it faces its quarry, lumbers with a walk-bob, REARS UP (with a hot ground
 *  warning ring) before each telegraphed slam and SQUASHES on impact, rises from the
 *  earth on spawn, and topples on death. Drives all of this off snap.boss
 *  (faceX / winding / state) + the bossslam timing — never the sim. */
function ArenaBoss({ result, clock }: { result: ArenaResult; clock: { current: DuelClock } }) {
    const grp = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);
    const auraMat = useRef<THREE.MeshBasicMaterial>(null);
    const shadow = useRef<THREE.Mesh>(null);
    const warn = useRef<THREE.Group>(null);
    const warnMat = useRef<THREE.MeshBasicMaterial>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const wrap = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    // animation state (refs so it survives frames without re-rendering)
    const prevState = useRef<string>("inactive");
    const prevWinding = useRef(false);
    const spawnAt = useRef<number | null>(null);
    const deadAt = useRef<number | null>(null);
    const windStart = useRef<number | null>(null);
    const slamAt = useRef<number | null>(null);
    // Flipbook state: the strike ticks (swipe + slam) drive the "slam" attack frame, and a
    // position delta picks walk vs idle. curFrame avoids redundant texture swaps.
    const attackTicks = useMemo(() => result.events.filter((e) => e.type === "bossswipe" || e.type === "bossslam").map((e) => e.t).sort((a, b) => a - b), [result]);
    const prevPos = useRef<{ x: number; y: number } | null>(null);
    const curFrame = useRef<WardenFrame>("idle");
    // The sprite is a near-square cutout; show it big and grounded so it reads as a boss.
    const H = ARENA_SPRITE_H * 2.6;
    useFrame((state) => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const b = snaps[i].boss;
        const vis = b.state !== "inactive";
        if (vis !== visible) setVisible(vis);
        const now = state.clock.elapsedTime;
        // ── state-transition stamps (spawn rise / death topple / slam) ──
        if (b.state !== prevState.current) {
            if (b.state === "active" && prevState.current === "inactive") spawnAt.current = now;
            if (b.state === "dead") deadAt.current = now;
            prevState.current = b.state;
        }
        if (b.winding && !prevWinding.current) windStart.current = now;     // wind-up began
        if (!b.winding && prevWinding.current) slamAt.current = now;        // wind-up ended → the stomp landed
        prevWinding.current = b.winding;
        if (!vis || !grp.current) return;

        const p = arenaPlace(b.x, b.y);
        const sp = spawnAt.current !== null ? Math.min(1, (now - spawnAt.current) / 0.6) : 1;          // 0→1 spawn rise
        const dp = deadAt.current !== null ? Math.min(1, (now - deadAt.current) / 0.8) : 0;            // 0→1 death topple
        const wp = b.winding && windStart.current !== null ? Math.min(1, (now - windStart.current) / 0.45) : 0;  // rear-up progress
        const sq = slamAt.current !== null ? Math.max(0, 1 - (now - slamAt.current) / 0.34) : 0;        // 1→0 slam squash decay

        grp.current.position.set(p.wx, p.wy + H * 0.5 * p.depth, p.zo + 0.02);
        grp.current.scale.setScalar(p.depth);

        if (body.current) {
            const breathe = b.state === "active" && !b.winding ? Math.abs(Math.sin(now * 1.5)) * 0.04 : 0;
            const rear = wp * 0.14;                                  // grows taller as it winds up
            const sx = (1 + sq * 0.26);                              // splat wider on impact
            const sy = (1 + breathe + rear - sq * 0.30) * (0.55 + 0.45 * sp);   // squash on impact, grow in on spawn
            const face = b.faceX < 0 ? -1 : 1;
            body.current.scale.set(face * sx * (0.6 + 0.4 * sp), sy, 1);
            // rear up then stomp DOWN; topple sideways on death; gentle walk sway otherwise.
            const sway = b.state === "active" && !b.winding ? Math.sin(now * 6) * 0.03 : 0;
            body.current.rotation.z = -dp * 1.15 * face + sway * (1 - wp);
            const lift = (1 - sp) * -H * 0.45 + rear * H * 0.18 - sq * H * 0.06 - dp * H * 0.12;   // rise from ground / rear / dip / sink
            body.current.position.y = lift;
        }
        // ── Flipbook: pick the animation frame by state (idle / walk / wind-up / slam) ──
        const tNow = clock.current.t;
        let striking = false;
        for (let k = attackTicks.length - 1; k >= 0; k--) { const at = attackTicks[k]; if (at > tNow) continue; if (tNow - at <= 7) { striking = true; } break; }   // a swipe/slam within ~0.23 s → strike pose
        const moved = prevPos.current ? (Math.abs(b.x - prevPos.current.x) + Math.abs(b.y - prevPos.current.y)) > 0.02 : false;
        prevPos.current = { x: b.x, y: b.y };
        const want: WardenFrame = b.state === "dead" ? "idle" : b.winding ? "windup" : striking ? "slam" : moved ? "walk" : "idle";
        if (mat.current && want !== curFrame.current) { mat.current.map = wardenFrame(want); mat.current.needsUpdate = true; curFrame.current = want; }
        if (mat.current) {
            mat.current.opacity = b.state === "dead" ? Math.max(0, 1 - dp) : sp;
            // flash hot while rearing back, ember-warm normally, ashen on death.
            const r = 1, gC = b.state === "dead" ? 0.42 : 1 - wp * 0.45, bC = b.state === "dead" ? 0.42 : 1 - wp * 0.55;
            mat.current.color.setRGB(r, gC, bC);
        }
        // Aura glow behind the Warden — green menace, flaring orange + bright as it winds up.
        if (auraMat.current) {
            const pulse = 0.5 + Math.abs(Math.sin(now * 2.2)) * 0.5;
            const base = b.state === "dead" ? Math.max(0, 1 - dp) : sp;
            auraMat.current.opacity = base * (0.18 + pulse * 0.12 + wp * 0.5);
            auraMat.current.color.set(wp > 0.05 ? "#fb7a32" : "#34d399");
        }
        // Ground footprint sized to the boss's sim collision radius, parked at its feet.
        const fr = arenaPlace(b.x + BOSS_RADIUS, b.y); const worldR = Math.max(0.8, Math.abs(fr.wx - p.wx));
        if (shadow.current) { shadow.current.position.set(p.wx, p.wy - 0.05 * p.depth, p.zo - 0.1); shadow.current.scale.set(worldR * 2.4 * p.depth, worldR * 0.9 * p.depth, 1); }
        // Hot warning ring on the ground = the slam's AoE footprint, filling in as it winds up
        // so players can read (and the AI's victims sit in) the danger zone before it lands.
        if (warn.current && warnMat.current) {
            const show = wp > 0 || sq > 0;
            warn.current.visible = show;
            if (show) {
                // honest footprint: the actual slam reach (BOSS_ATK_RADIUS + BOSS_RADIUS) in world units
                const aoeR = arenaPlace(b.x + (BOSS_ATK_RADIUS + BOSS_RADIUS), b.y);
                const aoe = Math.max(1, Math.abs(aoeR.wx - p.wx)) * 2;
                const s = (wp > 0 ? 0.5 + 0.5 * wp : 1) + sq * 0.4;        // grow during wind-up, kick out on impact
                warn.current.position.set(p.wx, p.wy - 0.04 * p.depth, p.zo - 0.08);
                warn.current.scale.set(aoe * s * p.depth, aoe * 0.5 * s * p.depth, 1);
                warnMat.current.color.set(sq > 0 ? "#fff1c2" : "#f97316");
                warnMat.current.opacity = (wp > 0 ? 0.25 + 0.5 * wp : 0.6 * sq);
            }
        }
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, b.hpFrac * 100))}%`;
        if (wrap.current) wrap.current.style.opacity = b.state === "active" ? "1" : "0";
    });
    if (!visible) return null;
    return (
        <group>
            <mesh ref={shadow} position={[0, 0, 0]} renderOrder={-2}><planeGeometry args={[1, 1]} /><meshBasicMaterial map={shadowTexture()} transparent opacity={0.45} depthWrite={false} depthTest={false} toneMapped={false} /></mesh>
            {/* slam-AoE warning ring (only visible while winding / on impact) */}
            <group ref={warn} renderOrder={-1}>
                <mesh><planeGeometry args={[1, 1]} /><meshBasicMaterial ref={warnMat} map={glowTexture()} color="#f97316" transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
            </group>
            <group ref={grp}>
                <group ref={body}>
                    {/* aura behind the sprite */}
                    <mesh position={[0, 0, -0.05]}><planeGeometry args={[H * 1.5, H * 1.5]} /><meshBasicMaterial ref={auraMat} map={glowTexture()} color="#34d399" transparent opacity={0.2} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} /></mesh>
                    <mesh><planeGeometry args={[H, H]} /><meshBasicMaterial ref={mat} map={wardenFrame("idle")} transparent alphaTest={0.02} depthWrite={false} toneMapped={false} /></mesh>
                </group>
                {/* drifting embers around the Warden while it's up */}
                <Sparkles count={18} scale={[H * 0.8, H * 0.9, 1.5]} position={[0, 0, 0.1]} size={3} speed={0.3} opacity={0.5} color="#7df0c0" noise={1.5} />
                <Html center position={[0, H * 0.62, 0]} pointerEvents="none" zIndexRange={[34, 0]}>
                    <div ref={wrap} style={{ width: 132, textAlign: "center", transition: "opacity 0.3s" }}>
                        <div style={{ font: "800 11px Inter, system-ui, sans-serif", color: "#d6f5e6", textShadow: "0 1px 3px #000", marginBottom: 2, letterSpacing: 0.5 }}>⛰ ARENA WARDEN</div>
                        <div style={{ height: 8, borderRadius: 4, background: "rgba(8,12,12,0.8)", border: "1px solid #14532d", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ height: "100%", width: "100%", background: "linear-gradient(90deg,#34d399,#10b981)" }} />
                        </div>
                    </div>
                </Html>
            </group>
        </group>
    );
}


/** A synthesised travelling projectile for the tactical arena. The arena sim has
 *  NO projectiles — ranged hits/heals resolve at the target — so the renderer
 *  flies a cosmetic element/role-distinct streak from the shooter to the victim
 *  that lands just as the impact FX fires. Pure presentation; never read by the
 *  sim (no balance / determinism tie). */
function ArenaShot({ from, to, visual, dur, depth, arc, onDone }: {
    from: Vec3; to: Vec3; visual: ProjectileVisual; dur: number; depth: number; arc: number; onDone: () => void;
}) {
    const grp = useRef<THREE.Group>(null);
    const start = useRef<number | null>(null);
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);   // world xy == screen here
    useFrame((state) => {
        const g = grp.current; if (!g) return;
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) * 1000 / dur);
        const x = lerp(from[0], to[0], p);
        const y = lerp(from[1], to[1], p) + (arc ? Math.sin(p * Math.PI) * arc * depth : 0);   // a small lob for thrown rock
        g.position.set(x, y, from[2]);
        g.rotation.z = angle;
        g.scale.setScalar(depth * (0.55 + 0.45 * Math.min(1, p / 0.12)));   // quick scale-in at the muzzle
        if (p >= 1) onDone();
    });
    return (<group ref={grp}><ProjectileBody visual={visual} /></group>);
}


/** Advances the clock, spawns elemental FX on hits/abilities, updates the score HUD. */
function ArenaDirector({ result, clock, advanceClock, onEnd, spawnFx, spawnShot, spawnFloater, spawnDecal, pushFeed, triggerHitstop, triggerShake, triggerSlowmo, triggerFlash, pushBanner, nameOf, setScore }: {
    result: ArenaResult; clock: { current: DuelClock }; advanceClock: (maxT: number, delta: number) => void; onEnd: () => void;
    spawnFx: (n: { x: number; z: number; element?: string | null; key?: string; scale: number; dur: number }) => void;
    spawnShot: (n: { fromX: number; fromY: number; toX: number; toY: number; element?: string | null; role?: string | null; kind?: string | null; support?: boolean; charged?: boolean }) => void;
    spawnFloater: (x: number, z: number, text: string, color: string, big: boolean) => void;
    spawnDecal: (x: number, z: number) => void;
    pushFeed: (text: string, color: string) => void;
    triggerHitstop: (ms: number) => void;
    triggerShake: (amp: number) => void;
    triggerSlowmo: (ms: number, factor: number) => void;
    triggerFlash: (color: string) => void;
    pushBanner: (text: string, color: string) => void;
    nameOf: (id: string) => string;
    setScore: (b: number, r: number) => void;
}) {
    const lastTick = useRef(-1); const ended = useRef(false);
    const streak = useRef<{ blue: number; red: number; lastT: number }>({ blue: 0, red: 0, lastT: -999 });
    useFrame((_s, delta) => {
        const snaps = result.snapshots; const maxT = snaps.length - 1;
        advanceClock(maxT, delta);
        const cur = Math.floor(clock.current.t);
        if (cur < lastTick.current) { lastTick.current = -1; streak.current = { blue: 0, red: 0, lastT: -999 }; }   // clock rewound (replay) → re-fire events
        if (cur > lastTick.current) {
            for (const e of result.events) {
                if (e.t <= lastTick.current || e.t > cur) continue;
                const snapAt = snaps[Math.min(maxT, e.t)];
                if (e.type === "hit") {
                    const a = findArenaActor(snapAt, e.targetId);
                    const src = findArenaActor(snapAt, e.actorId);
                    if (a) {
                        // An ABILITY-tagged hit is the tracker's MARK (only it deals ability damage) → a dark sigil; else the element burst.
                        if (e.ability) spawnFx({ x: a.x, z: a.y, key: "shadow", scale: 1.8, dur: 430 });
                        else spawnFx({ x: a.x, z: a.y, element: e.element, scale: e.crit ? 2.2 : 1.3, dur: 300 });
                        spawnFloater(a.x, a.y, `${e.dmg}`, e.crit ? "#fde047" : "#fecaca", e.crit);
                        if (e.crit) { spawnFx({ x: a.x, z: a.y, key: "spark", scale: 2.0, dur: 240 }); triggerHitstop(45); triggerShake(0.5); }   // crits land with a flash + a little weight
                        // A ranged blow / tracker mark / assassin lunge flies a projectile in from the shooter
                        // (melee swings at point-blank skip it — the impact burst is enough).
                        if (src) {
                            const gap = Math.hypot(a.x - src.x, a.y - src.y);
                            if (gap >= 1.6 || e.ability || (src.role === "assassin" && gap >= 0.6))
                                spawnShot({ fromX: src.x, fromY: src.y, toX: a.x, toY: a.y, element: e.element, role: src.role, kind: e.ability ? "mark" : "damage", charged: e.crit });
                        }
                    }
                } else if (e.type === "ability") {
                    // Each role ability reads distinctly (mend glow / guard dome / mark gather / assassin dash-flash).
                    const a = findArenaActor(snapAt, e.actorId);
                    if (a) { const pick = arenaAbilityFxKey(e.kind); if (pick.key) spawnFx({ x: a.x, z: a.y, key: pick.key, scale: e.kind === "guard" ? 2.1 : 1.7, dur: 440 }); }
                } else if (e.type === "heal") {
                    const a = findArenaActor(snapAt, e.targetId);
                    const src = findArenaActor(snapAt, e.actorId);
                    if (a) {
                        spawnFx({ x: a.x, z: a.y, key: "heal", scale: 1.7, dur: 470 }); spawnFloater(a.x, a.y, `+${e.amount}`, "#86efac", false);
                        // The sage floats a soft heal-comet to the ally it mends.
                        if (src && src.id !== a.id && Math.hypot(a.x - src.x, a.y - src.y) >= 1.2)
                            spawnShot({ fromX: src.x, fromY: src.y, toX: a.x, toY: a.y, element: src.element, role: src.role, support: true });
                    }
                } else if (e.type === "shield") {
                    const a = findArenaActor(snapAt, e.targetId);
                    const src = findArenaActor(snapAt, e.actorId);
                    if (a) {
                        spawnFx({ x: a.x, z: a.y, key: "eshield", scale: 2.0, dur: 480 });
                        // A shield cast ONTO an ally (not the defender's self-guard) flies a ward-comet over.
                        if (src && src.id !== a.id && Math.hypot(a.x - src.x, a.y - src.y) >= 1.2)
                            spawnShot({ fromX: src.x, fromY: src.y, toX: a.x, toY: a.y, element: src.element, role: src.role, support: true });
                    }
                } else if (e.type === "kill") {
                    const a = findArenaActor(snapAt, e.targetId);
                    if (a) { spawnFx({ x: a.x, z: a.y, key: arenaKillFxKey(a.element), scale: 3.0, dur: 560 }); spawnFx({ x: a.x, z: a.y, key: "spark", scale: 2.4, dur: 360 }); spawnDecal(a.x, a.y); }
                    pushFeed(`☠ ${nameOf(e.targetId)}`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    triggerHitstop(70); triggerSlowmo(220, 0.42); triggerShake(1.1);   // freeze the contact frame, then ease through the kill in slow-mo
                    const w = ARENA_TPS * 3.5;
                    if (e.t - streak.current.lastT > w) { streak.current.blue = 0; streak.current.red = 0; }
                    streak.current.lastT = e.t; streak.current[e.team] += 1;
                    const label = multiKillLabel(streak.current[e.team]);
                    if (label) pushBanner(label, e.team === "blue" ? "#93c5fd" : "#fca5a5");   // Double/Triple/… as the squad chain-kills
                } else if (e.type === "capture") {
                    const c = e.actorId ? findArenaActor(snapAt, e.actorId) : null;
                    if (c) spawnFx({ x: c.x, z: c.y, key: "power", scale: 4.0, dur: 720 });   // the apex burst at the scoring base
                    const matchPoint = (e.team === "blue" ? snapAt.scoreBlue : snapAt.scoreRed) >= result.winScore;
                    pushFeed(`📜 ${e.team === "blue" ? "Blue" : "Red"} captured the scroll!`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    pushBanner(matchPoint ? `${e.team === "blue" ? "BLUE" : "RED"} WINS! 📜` : `${e.team === "blue" ? "BLUE" : "RED"} SCORES! 📜`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.5)" : "rgba(239,68,68,0.5)");
                    triggerHitstop(90); triggerSlowmo(matchPoint ? 460 : 280, 0.38); triggerShake(1.4);
                } else if (e.type === "pickup" && e.actorId) {
                    pushFeed(`📜 ${nameOf(e.actorId)} took the scroll`, e.team === "blue" ? "#93c5fd" : "#fca5a5");
                } else if (e.type === "shrinespawn") {
                    const sh = snapAt.shrine; const isHeal = sh.kind === "mend" || sh.kind === "favor"; const c = isHeal ? "#34d399" : "#fb923c";
                    spawnFx({ x: sh.x, z: sh.y, key: RELIC_FX[sh.kind] ?? "spark", scale: 2.2, dur: 540 });
                    pushFeed(`${RELIC_ICON[sh.kind] ?? "◆"} A ${RELIC_LABEL[sh.kind] ?? "relic"} rises`, c);
                } else if (e.type === "shrineclaim" && e.team) {
                    // A claimed shrine/relic — a team-colored burst + the flavour's FX. Tactical, not a
                    // score, so a lighter touch than a capture (no banner/slow-mo).
                    const sh = snapAt.shrine; const c = e.team === "blue" ? "#60a5fa" : "#f87171"; const k = e.kind ?? sh.kind;
                    spawnFx({ x: sh.x, z: sh.y, key: "power", scale: 3.0, dur: 600 });
                    spawnFx({ x: sh.x, z: sh.y, key: RELIC_FX[k] ?? "spark", scale: 2.4, dur: 460 });
                    pushFeed(`${RELIC_ICON[k] ?? "◆"} ${e.team === "blue" ? "Blue" : "Red"} claimed the ${RELIC_LABEL[k] ?? "relic"}`, c);
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.26)" : "rgba(239,68,68,0.26)");
                    triggerShake(0.55);
                } else if (e.type === "bossspawn") {
                    const b = snapAt.boss; spawnFx({ x: b.x, z: b.y, key: "power", scale: 4.6, dur: 820 });
                    pushFeed("⛰ The Arena Warden awakens!", "#34d399");
                    pushBanner("⛰ THE WARDEN AWAKENS", "#34d399");
                    triggerHitstop(90); triggerShake(1.6);
                } else if (e.type === "bossswipe") {
                    // The Warden's fast melee swipe — a quick claw-spark + a small jolt. (Damage
                    // floaters on the struck pet carry the rest; per-swipe so no feed spam.)
                    const b = snapAt.boss; spawnFx({ x: b.x, z: b.y, key: "spark", scale: 1.8, dur: 280 });
                    triggerShake(0.4);
                } else if (e.type === "bosslunge") {
                    // The Warden LEAPS to close on a kiter — a launch puff + a quick jolt.
                    const b = snapAt.boss; spawnFx({ x: b.x, z: b.y, key: "power", scale: 2.0, dur: 320 });
                    triggerShake(0.5);
                } else if (e.type === "bosswindup") {
                    // The Warden REARS UP for its slam — a dark anticipatory sigil under it + a
                    // low rumble. ArenaBoss draws the hot AoE warning ring; this adds the weight.
                    const b = snapAt.boss; spawnFx({ x: b.x, z: b.y, key: "shadow", scale: 2.6, dur: 440 });
                    triggerShake(0.35);
                } else if (e.type === "bossslam") {
                    // The Warden stomps the pit — a grounded shockwave + real weight. (No feed
                    // spam: slams fire on a ~1.5 s cadence; the per-pet damage floaters carry it.)
                    const b = snapAt.boss;
                    spawnFx({ x: b.x, z: b.y, key: "power", scale: 3.6, dur: 520 });
                    spawnFx({ x: b.x, z: b.y, key: "spark", scale: 2.2, dur: 300 }); spawnDecal(b.x, b.y);
                    triggerHitstop(70); triggerSlowmo(150, 0.5); triggerShake(1.4);
                } else if (e.type === "bosskill" && e.team) {
                    const b = snapAt.boss; spawnFx({ x: b.x, z: b.y, key: "power", scale: 5.2, dur: 900 }); spawnFx({ x: b.x, z: b.y, key: "spark", scale: 3.0, dur: 460 });
                    pushFeed(`⛰ ${e.team === "blue" ? "Blue" : "Red"} slew the Warden! (+buff)`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    pushBanner(`${e.team === "blue" ? "BLUE" : "RED"} SLAYS THE WARDEN!`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.5)" : "rgba(239,68,68,0.5)");
                    triggerHitstop(110); triggerSlowmo(420, 0.4); triggerShake(1.8);
                } else if (e.type === "overdrive") {
                    pushBanner(`${e.team === "blue" ? "BLUE" : "RED"} OVERDRIVE! ⚡`, e.team === "blue" ? "#93c5fd" : "#fca5a5");
                    pushFeed(`⚡ ${e.team === "blue" ? "Blue" : "Red"} hit Overdrive`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.32)" : "rgba(239,68,68,0.32)"); triggerShake(0.8);
                } else if (e.type === "rampage") {
                    pushBanner(`${e.team === "blue" ? "BLUE" : "RED"} RAMPAGE! 🔥`, e.team === "blue" ? "#93c5fd" : "#fca5a5");
                } else if (e.type === "bossenrage") {
                    pushFeed(`⛰ The Warden enrages (tier ${e.stage})`, "#fb923c"); triggerShake(0.8);
                    if (e.stage >= 2) pushBanner("⛰ WARDEN ENRAGED", "#fb923c");
                } else if (e.type === "ringclose") {
                    pushFeed("◈ The arena is closing in!", "#a78bfa"); pushBanner("◈ CLOSING RING", "#a78bfa"); triggerShake(0.9);
                } else if (e.type === "executewindow") {
                    const a = findArenaActor(snapAt, e.targetId); if (a) spawnFx({ x: a.x, z: a.y, key: "spark", scale: 1.6, dur: 260 });   // "he's going down" flare on the focused target
                }
            }
            const s = snaps[Math.min(maxT, cur)]; setScore(s.scoreBlue, s.scoreRed);
            lastTick.current = cur;
        }
        if (!ended.current && clock.current.t >= maxT) { ended.current = true; onEnd(); }
    });
    return null;
}


/** A short-lived floating combat number (damage / heal) that rises + fades. */
function ArenaFloater({ pos, text, color, big }: { pos: Vec3; text: string; color: string; big: boolean }) {
    return (
        <Html position={pos} center pointerEvents="none" zIndexRange={[45, 0]}>
            <div style={{ font: `${big ? 900 : 800} ${big ? 22 : 13}px Inter, system-ui, sans-serif`, color, textShadow: "0 1px 2px #000, 0 0 5px rgba(0,0,0,0.7)", whiteSpace: "nowrap", animation: "arenaFloat 0.9s ease-out forwards" }}>{text}</div>
        </Html>
    );
}


/** Camera. DEFAULT = the whole map (z=1, identity) so you read the full board.
 *  Only when the scroll is being CARRIED does it ease in a touch and follow the
 *  carrier (the dramatic "will they make it home?" moment), then ease back out
 *  when the carry ends. Drives a CSS transform on the whole stage (backdrop +
 *  canvas + Html scale as one → pets stay locked to the painted paths). */
function ArenaCamera({ result, clock, stageRef, shake }: { result: ArenaResult; clock: { current: DuelClock }; stageRef: React.MutableRefObject<HTMLDivElement | null>; shake: React.MutableRefObject<number> }) {
    const size = useThree((s) => s.size);
    const sm = useRef({ cx: 0, cy: 0, z: 1, init: true });
    const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
    useFrame((state) => {
        const el = stageRef.current; if (!el || size.height < 1) return;
        const snaps = result.snapshots; const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const snap = snaps[i];
        let tcx = 0, tcy = 0, tz = 1;   // default: centered, WHOLE map (contain)
        if (snap.scroll.state === "carried" && snap.scroll.carrierId) {
            const c = snap.actors.find((a) => a.id === snap.scroll.carrierId);
            if (c) { const p = arenaPlace(c.x, c.y); tcx = p.wx; tcy = p.wy; tz = 1.35; }   // ease in on the carrier ("will they make it home?")
        } else {
            // No carry → frame the ACTION: centroid of living pets, and push in when they
            // cluster (a teamfight), stay wide when they're spread out (laning/traversal).
            let n = 0, mx = 0, my = 0; const live: Array<{ x: number; y: number }> = [];
            for (const a of snap.actors) { if (a.state === "dead" || a.state === "respawning") continue; mx += a.x; my += a.y; n++; live.push(a); }
            if (n > 0) {
                mx /= n; my /= n;
                let span = 0; for (const a of live) { const dx = a.x - mx, dy = a.y - my; const d = Math.sqrt(dx * dx + dy * dy); if (d > span) span = d; }
                const p = arenaPlace(mx, my); tcx = p.wx; tcy = p.wy;
                tz = clamp(1.28 - span * 0.03, 1, 1.28);   // tight cluster → push in (~1.28); spread → whole map (1.0)
            }
        }
        const s = sm.current;
        s.cx += (tcx - s.cx) * 0.04; s.cy += (tcy - s.cy) * 0.04; s.z += (tz - s.z) * 0.04;   // gentle glide (no jerk)
        const zoomCam = Math.min(size.width / STAGE.worldW, size.height / STAGE.worldH);   // contain-fit (matches StageCamera + bg)
        const fx = size.width / 2 + s.cx * zoomCam, fy = size.height / 2 - s.cy * zoomCam;
        let tx = size.width / 2 - fx * s.z, ty = size.height / 2 - fy * s.z;
        tx = clamp(tx, size.width * (1 - s.z), 0); ty = clamp(ty, size.height * (1 - s.z), 0);   // keep the diorama covering the frame
        // Impact shake — decaying screen jolt on crits / kills / captures (read-only here;
        // advanceClock owns + decays the ref). Cosmetic, additive on top of the framing.
        const amp = shake.current;
        if (amp > 0.01) { tx += Math.sin(state.clock.elapsedTime * 92) * amp * 6; ty += Math.cos(state.clock.elapsedTime * 77) * amp * 6; }
        el.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.z.toFixed(3)})`;
    });
    return null;
}


export type PetArenaMatchProps = {
    blue: ArenaSlot[]; red: ArenaSlot[]; seed: number;
    /** PvP-ladder replay: equip both teams' PVP gear + consumables so the cinematic
     *  matches the server's item-aware resolution. Default off → casual unchanged. */
    applyItems?: boolean;
    sharedImages?: Record<string, string>; onExit: () => void;
    /** Fired once when the match concludes (the deterministic result is sealed from
     *  the seed). The Tactical Arena uses this to pay the vs-AI win reward. */
    onResult?: (result: ArenaResult) => void;
    /** Force the V2 ruleset on/off, overriding the per-device flag. Set for SHARED replays
     *  (co-op / PvP challenge) so BOTH clients agree regardless of the local kill-switch;
     *  omit for solo/vs-AI so the local flag (default ON) still applies. */
    v2?: boolean;
};

/** Objective line below the scoreboard — a per-frame readout written via DOM refs
 *  (so it never re-renders the HUD): the scroll-spawn countdown while the scroll is
 *  inactive, and the carrier's "returning home" progress while it's carried. Pure
 *  presentation — reads the snapshot + result.bases/center, never the sim. */
function ArenaObjectiveHud({ result, clock, textRef, barWrapRef, barRef }: {
    result: ArenaResult; clock: { current: DuelClock };
    textRef: React.RefObject<HTMLSpanElement | null>;
    barWrapRef: React.RefObject<HTMLDivElement | null>;
    barRef: React.RefObject<HTMLDivElement | null>;
}) {
    const lastText = useRef("");
    // Per-team base centroid + the carry-journey reference length (center→base), both
    // constant (bases + center are fixed), so the return meter reads a stable fraction.
    const home = useMemo(() => {
        const [cx, cy] = result.center;
        // Per-seal carry reference: the (constant) center→seal distance. Progress is
        // measured against the NEAREST seal (mirrors the sim's nearestSeal scoring), so
        // the bar fills to 100% exactly as the carrier enters BASE_SCORE_RANGE of a seal.
        const make = (seals: [number, number][]) => seals.map((s) => ({ s, ref: Math.hypot(s[0] - cx, s[1] - cy) || 1 }));
        return { blue: make(result.bases.blue), red: make(result.bases.red) };
    }, [result]);
    useFrame(() => {
        const snaps = result.snapshots;
        const i = Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)));
        const sc = snaps[i].scroll;
        let text = "📜 Capture the scroll to score — defeating pets only buys time";
        let showBar = false, frac = 0, color = "#94a3b8";
        if (sc.state === "inactive" && sc.spawnSecs > 0) {
            text = `📜 Scroll in ${sc.spawnSecs}s`;
        } else if (sc.state === "carried" && sc.carrierId) {
            const carrier = snaps[i].actors.find((a) => a.id === sc.carrierId);
            if (carrier) {
                // Progress toward the closest-to-done seal: 0 at the center pickup, 1 the
                // instant the carrier reaches scoring range (BASE_SCORE_RANGE) of a seal.
                let best = 0;
                for (const { s, ref } of home[carrier.team]) {
                    const f = (ref - Math.hypot(carrier.x - s[0], carrier.y - s[1])) / Math.max(0.001, ref - BASE_SCORE_RANGE);
                    if (f > best) best = f;
                }
                frac = Math.max(0, Math.min(1, best));
                color = carrier.team === "blue" ? "#60a5fa" : "#f87171";
                text = `${carrier.team === "blue" ? "BLUE" : "RED"} returning the scroll`;
                showBar = true;
            }
        }
        if (textRef.current) {
            if (lastText.current !== text) { textRef.current.textContent = text; lastText.current = text; }
            textRef.current.style.color = showBar ? color : "#94a3b8";
        }
        if (barWrapRef.current) barWrapRef.current.style.display = showBar ? "block" : "none";
        if (barRef.current && showBar) { barRef.current.style.width = `${Math.round(frac * 100)}%`; barRef.current.style.background = color; }
    });
    return null;
}


const MODIFIER_LABEL: Record<string, string> = { standard: "Standard Bout", "warden-fury": "Warden's Fury", "scroll-frenzy": "Scroll Frenzy", "blood-ritual": "Blood Ritual" };

const RELIC_LABEL: Record<string, string> = { power: "Chakra Font", mend: "Mending Spring", berserk: "Berserker's Brand", bulwark: "Bulwark Ward", edge: "Executioner's Edge", favor: "Warden's Favor" };

const RELIC_ICON: Record<string, string> = { power: "⚡", mend: "✚", berserk: "🗡", bulwark: "🛡", edge: "☠", favor: "⛰" };

const RELIC_FX: Record<string, string> = { power: "spark", mend: "heal", berserk: "spark", bulwark: "eshield", edge: "shadow", favor: "power" };

const RELIC_COLOR: Record<string, string> = { power: "#fb923c", mend: "#34d399", berserk: "#f87171", bulwark: "#60a5fa", edge: "#a78bfa", favor: "#fbbf24" };


/** V2 (petArenaV2.v1) HUD updater: ref-drives the Overdrive meters + spike glow each frame
 *  from the snapshot stream (no React re-render). Inert unless the match is v2. */
function ArenaV2Hud({ result, clock, momBlueRef, momRedRef, odBlueRef, odRedRef }: {
    result: ArenaResult; clock: { current: DuelClock };
    momBlueRef: React.MutableRefObject<HTMLDivElement | null>; momRedRef: React.MutableRefObject<HTMLDivElement | null>;
    odBlueRef: React.MutableRefObject<HTMLSpanElement | null>; odRedRef: React.MutableRefObject<HTMLSpanElement | null>;
}) {
    useFrame(() => {
        if (!result.v2) return;
        const snaps = result.snapshots; const cur = Math.min(snaps.length - 1, Math.max(0, Math.floor(clock.current.t)));
        const s = snaps[cur]; if (!s) return;
        if (momBlueRef.current) { momBlueRef.current.style.width = s.momBlue + "%"; momBlueRef.current.style.filter = s.odBlue > 0 ? "brightness(1.6) drop-shadow(0 0 4px #fde047)" : "none"; }
        if (momRedRef.current) { momRedRef.current.style.width = s.momRed + "%"; momRedRef.current.style.filter = s.odRed > 0 ? "brightness(1.6) drop-shadow(0 0 4px #fde047)" : "none"; }
        if (odBlueRef.current) odBlueRef.current.style.opacity = s.odBlue > 0 ? "1" : "0";
        if (odRedRef.current) odRedRef.current.style.opacity = s.odRed > 0 ? "1" : "0";
    });
    return null;
}


export function PetArenaMatch({ blue, red, seed, applyItems = false, sharedImages = {}, onExit, onResult, v2 }: PetArenaMatchProps) {
    const arenaV2 = useMemo(() => v2 ?? petArenaV2Enabled(), [v2]);   // explicit prop (shared replays) overrides the per-device flag; else read the local flag (default ON)
    const result = useMemo(() => runPetArenaMatch(blue, red, seed, applyItems, arenaV2), [blue, red, seed, applyItems, arenaV2]);
    const roster = useMemo(() => [
        ...blue.map((s, i) => ({ id: `blue-${i}`, pet: s.pet })),
        ...red.map((s, i) => ({ id: `red-${i}`, pet: s.pet })),
    ], [blue, red]);
    // TRUE-3D stage gate — same all-or-nothing rule as the duel's freeRoam3d:
    // every fighter needs an approved GLB, else the classic diorama renders.
    // Purely presentational (same sim/result either way).
    const use3d = useMemo(() => petArena3dEnabled() && roster.every((r) => petCombatModel(r.pet) !== null), [roster]);
    useEffect(() => {
        if (!use3d) return;
        // Fetch + parse the roster GLBs immediately so the Suspense capsule
        // placeholders resolve into real models within the opening seconds.
        import("../../lib/pet-model-preload")
            .then((m) => void m.preloadPetColiseumModels(roster.map((r) => r.pet)))
            .catch(() => { /* preload is best-effort; Suspense still resolves on demand */ });
    }, [use3d, roster]);
    const clock = useRef<DuelClock>({ t: 0, playing: true });
    const seqRef = useRef(0);
    const hitstop = useRef(0);
    const shake = useRef(0);                                   // camera shake amplitude (decays in ArenaCamera)
    const slowmo = useRef({ ms: 0, factor: 1 });               // dramatic slow-mo on kills/captures
    const stageRef = useRef<HTMLDivElement | null>(null);   // the action-camera transforms this (backdrop + canvas together)
    const [ended, setEnded] = useState(false);
    const [flash, setFlash] = useState<{ id: number; color: string } | null>(null);   // screen flash on captures
    const [banner, setBanner] = useState<{ id: number; text: string; color: string } | null>(null);   // multi-kill / SCORES! callout
    const [score, setScoreState] = useState<[number, number]>([0, 0]);
    const [fxList, setFxList] = useState<Array<{ id: number; frames: string[]; pos: Vec3; scale: number; dur: number }>>([]);
    const [shots, setShots] = useState<Array<{ id: number; from: Vec3; to: Vec3; visual: ProjectileVisual; dur: number; depth: number; arc: number }>>([]);   // synthesised travelling projectiles
    const [floaters, setFloaters] = useState<Array<{ id: number; pos: Vec3; text: string; color: string; big: boolean }>>([]);
    const [feed, setFeed] = useState<Array<{ id: number; text: string; color: string }>>([]);
    const [decals, setDecals] = useState<Array<{ id: number; pos: Vec3; w: number }>>([]);   // accumulating scorch marks where pets fell
    const objTextRef = useRef<HTMLSpanElement | null>(null);   // objective line: scroll-spawn countdown / carrier return progress (ref-driven, no re-render)
    const objBarWrapRef = useRef<HTMLDivElement | null>(null);
    const objBarRef = useRef<HTMLDivElement | null>(null);
    const momBlueRef = useRef<HTMLDivElement | null>(null);   // V2 Overdrive meters — ref-driven per-frame (no HUD re-render)
    const momRedRef = useRef<HTMLDivElement | null>(null);
    const odBlueRef = useRef<HTMLSpanElement | null>(null);
    const odRedRef = useRef<HTMLSpanElement | null>(null);
    const nameById = useMemo(() => { const m = new Map<string, string>(); roster.forEach((r) => m.set(r.id, r.pet.name)); return m; }, [roster]);
    const nameOf = (id: string) => nameById.get(id) ?? id;
    const setScore = (b: number, r: number) => setScoreState((p) => (p[0] === b && p[1] === r ? p : [b, r]));
    const spawnFx = (n: { x: number; z: number; element?: string | null; key?: string; scale: number; dur: number }) => {
        const frames = (n.key ? bundledJutsuFxFrames(n.key) : null) ?? bundledJutsuFxFrames(elementVfxKey(n.element)) ?? bundledJutsuFxFrames("none");
        if (!frames) return;
        const id = seqRef.current++; const p = arenaPlace(n.x, n.z);
        setFxList((arr) => [...arr, { id, frames, pos: [p.wx, p.wy + 1.0 * p.depth, 8], scale: n.scale * p.depth * 0.78, dur: n.dur }]);   // beefier FX
    };
    // Fly a cosmetic element/role-distinct projectile from a shooter to its target.
    const spawnShot = (n: { fromX: number; fromY: number; toX: number; toY: number; element?: string | null; role?: string | null; kind?: string | null; support?: boolean; charged?: boolean }) => {
        const visual = projectileVisual({ element: n.element, role: n.role, kind: n.kind, support: n.support, charged: n.charged });
        const a = arenaPlace(n.fromX, n.fromY), b = arenaPlace(n.toX, n.toY);
        const distW = Math.hypot(b.wx - a.wx, b.wy - a.wy);
        // Travel time. The old 120–360ms (÷ speedMul) blinked past too fast to read;
        // slow it down with a firm ~420ms floor so every shot is legible, while
        // longer shots + speed-role pets still scale a little.
        let dur = (260 + distW * 24) / Math.max(0.85, visual.speedMul);
        if (visual.tex === "bolt") dur *= 0.85;   // lightning still snaps, but stays visible
        dur = Math.min(820, Math.max(420, dur));
        const id = seqRef.current++;
        setShots((arr) => [...arr, {
            id,
            from: [a.wx, a.wy + 1.0 * a.depth, 8] as Vec3,
            to: [b.wx, b.wy + 1.0 * b.depth, 8] as Vec3,
            visual, dur, depth: b.depth, arc: visual.tex === "rock" ? 0.8 : 0,
        }]);
    };
    const spawnFloater = (x: number, z: number, text: string, color: string, big: boolean) => {
        const p = arenaPlace(x, z); const id = seqRef.current++;
        setFloaters((arr) => [...arr, { id, pos: [p.wx, p.wy + 1.3 * p.depth, 9], text, color, big }]);
        window.setTimeout(() => setFloaters((arr) => arr.filter((f) => f.id !== id)), 950);
    };
    const pushFeed = (text: string, color: string) => {
        const id = seqRef.current++;
        setFeed((arr) => [{ id, text, color }, ...arr].slice(0, 6));
        window.setTimeout(() => setFeed((arr) => arr.filter((f) => f.id !== id)), 4500);
    };
    const spawnDecal = (x: number, z: number) => {
        const p = arenaPlace(x, z); const id = seqRef.current++;
        setDecals((arr) => [...arr, { id, pos: [p.wx, p.wy - 0.12 * p.depth, 7] as Vec3, w: 1.7 * p.depth }].slice(-12));   // keep the last 12 — the arena testifies a real fight happened
    };
    const triggerHitstop = (ms: number) => { hitstop.current = Math.max(hitstop.current, ms); };
    const triggerShake = (amp: number) => { shake.current = Math.max(shake.current, amp); };
    const triggerSlowmo = (ms: number, factor: number) => { if (ms > slowmo.current.ms) slowmo.current = { ms, factor }; };
    const triggerFlash = (color: string) => { const id = seqRef.current++; setFlash({ id, color }); window.setTimeout(() => setFlash((f) => (f && f.id === id ? null : f)), 380); };
    const pushBanner = (text: string, color: string) => { const id = seqRef.current++; setBanner({ id, text, color }); window.setTimeout(() => setBanner((b) => (b && b.id === id ? null : b)), 1500); };
    const advanceClock = (maxT: number, delta: number) => {
        if (shake.current > 0.01) shake.current *= 0.85;   // decay the screen-shake amplitude (this closure owns the ref; ArenaCamera only reads it)
        if (hitstop.current > 0) { hitstop.current -= delta * 1000; return; }   // brief hard freeze on the contact frame
        let factor = 1;
        if (slowmo.current.ms > 0) { slowmo.current.ms -= delta * 1000; factor = slowmo.current.factor; }   // then ease through the moment in slow-mo (speed CONTRAST sells impact)
        if (clock.current.playing) clock.current.t = Math.min(maxT, clock.current.t + delta * ARENA_TPS * factor);
    };
    const replay = () => { clock.current.t = 0; clock.current.playing = true; hitstop.current = 0; shake.current = 0; slowmo.current = { ms: 0, factor: 1 }; setEnded(false); setFlash(null); setBanner(null); setScoreState([0, 0]); setFxList([]); setShots([]); setFloaters([]); setFeed([]); setDecals([]); };
    // Pay out / report once the match actually concludes (result is sealed from the
    // seed, so this is just the natural moment to surface it). Replaying re-fires with
    // the same seed → the server dedups by reportKey, so no double-claim.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on the ended edge; result is seed-stable and onResult is an inline arrow (adding it would re-fire every render)
    useEffect(() => { if (ended) onResult?.(result); }, [ended]);
    const winLabel = result.winner === "blue" ? "Blue Team Wins" : result.winner === "red" ? "Red Team Wins" : "Draw";

    return createPortal((
        <div className="pet-combat-takeover pet-arena-takeover" style={{ backgroundColor: "#05060a" }}>
            <style>{`@keyframes arenaFloat{0%{transform:translateY(4px);opacity:0}15%{opacity:1}100%{transform:translateY(-30px);opacity:0}}@keyframes arenaFeedIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}@keyframes arenaFlash{0%{opacity:0}12%{opacity:0.85}100%{opacity:0}}@keyframes arenaBanner{0%{opacity:0;transform:translate(-50%,-50%) scale(0.6)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}30%{transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-58%) scale(1)}}`}</style>
            {/* The STAGE. TRUE-3D mode (every pet has an approved GLB): the LoL-style
                spectator scene owns its own camera/FX and receives the SAME director +
                HUD frame-writers as children. Classic mode: backdrop + canvas + Html
                overlays as one layer the CSS action camera scales/pans as a unit. */}
            {use3d ? (
                <div ref={stageRef} style={{ position: "absolute", inset: 0, transformOrigin: "0 0" }}>
                    <PetArena3DStage result={result} roster={roster} clock={clock} shake={shake}>
                        {(sp3d) => (
                            <>
                                <ArenaObjectiveHud result={result} clock={clock} textRef={objTextRef} barWrapRef={objBarWrapRef} barRef={objBarRef} />
                                <ArenaV2Hud result={result} clock={clock} momBlueRef={momBlueRef} momRedRef={momRedRef} odBlueRef={odBlueRef} odRedRef={odRedRef} />
                                <ArenaDirector result={result} clock={clock} advanceClock={advanceClock} onEnd={() => setEnded(true)} spawnFx={sp3d.spawnFx} spawnShot={sp3d.spawnShot} spawnFloater={sp3d.spawnFloater} spawnDecal={sp3d.spawnDecal} pushFeed={pushFeed} triggerHitstop={triggerHitstop} triggerShake={triggerShake} triggerSlowmo={triggerSlowmo} triggerFlash={triggerFlash} pushBanner={pushBanner} nameOf={nameOf} setScore={setScore} />
                            </>
                        )}
                    </PetArena3DStage>
                </div>
            ) : (
            <div ref={stageRef} style={{ position: "absolute", inset: 0, backgroundImage: `url(${DIORAMA_URL})`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat", transformOrigin: "0 0", willChange: "transform" }}>
                <Canvas dpr={[1, 2]} gl={{ alpha: true, antialias: true }} style={{ background: "transparent" }}>
                    <StageCamera fit="contain" />
                    {/* Ambient life — warm dust/embers drifting over the whole arena so the stage breathes. */}
                    <Sparkles count={36} scale={[STAGE.worldW, STAGE.worldH, 4]} position={[0, 2, 4]} size={2} speed={0.12} opacity={0.3} color="#fde9b8" noise={2} />
                    {/* Accumulating scorch decals where pets fell — the board remembers the fight. */}
                    {decals.map((d) => (<mesh key={d.id} position={d.pos} renderOrder={-3}><planeGeometry args={[d.w, d.w * 0.55]} /><meshBasicMaterial map={shadowTexture()} color="#2a1d12" transparent opacity={0.5} depthWrite={false} depthTest={false} toneMapped={false} /></mesh>))}
                    {/* Spawn seals + center paw are painted into the diorama — no ring overlays. */}
                    {roster.map((r) => (<ArenaStandee key={r.id} result={result} clock={clock} id={r.id} pet={r.pet} sharedImages={sharedImages} />))}
                    <ArenaBoss result={result} clock={clock} />
                    <ArenaShrine result={result} clock={clock} />
                    <ArenaScroll result={result} clock={clock} />
                    <ArenaRing result={result} clock={clock} />
                    <ArenaObjectiveHud result={result} clock={clock} textRef={objTextRef} barWrapRef={objBarWrapRef} barRef={objBarRef} />
                    <ArenaV2Hud result={result} clock={clock} momBlueRef={momBlueRef} momRedRef={momRedRef} odBlueRef={odBlueRef} odRedRef={odRedRef} />
                    {fxList.map((fx) => (<FxAnim key={fx.id} frames={fx.frames} from={fx.pos} durationMs={fx.dur} scale={fx.scale} onDone={() => setFxList((p) => p.filter((x) => x.id !== fx.id))} />))}
                    {shots.map((sh) => (<ArenaShot key={sh.id} from={sh.from} to={sh.to} visual={sh.visual} dur={sh.dur} depth={sh.depth} arc={sh.arc} onDone={() => setShots((p) => p.filter((x) => x.id !== sh.id))} />))}
                    {floaters.map((f) => (<ArenaFloater key={f.id} pos={f.pos} text={f.text} color={f.color} big={f.big} />))}
                    <ArenaCamera result={result} clock={clock} stageRef={stageRef} shake={shake} />
                    <ArenaDirector result={result} clock={clock} advanceClock={advanceClock} onEnd={() => setEnded(true)} spawnFx={spawnFx} spawnShot={spawnShot} spawnFloater={spawnFloater} spawnDecal={spawnDecal} pushFeed={pushFeed} triggerHitstop={triggerHitstop} triggerShake={triggerShake} triggerSlowmo={triggerSlowmo} triggerFlash={triggerFlash} pushBanner={pushBanner} nameOf={nameOf} setScore={setScore} />
                    <BloomFx />
                </Canvas>
            </div>
            )}

            {/* Screen wash on captures — a team-colored EDGE vignette (cinematic, not a blinding full flash) */}
            {flash && <div key={flash.id} style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, transparent 38%, ${flash.color} 100%)`, pointerEvents: "none", animation: "arenaFlash 0.4s ease-out forwards", mixBlendMode: "screen" }} />}
            {/* Big centered callout — multi-kills + SCORES! */}
            {banner && <div key={banner.id} style={{ position: "absolute", top: "32%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none", color: banner.color, font: "900 44px Inter, system-ui, sans-serif", letterSpacing: 1, textShadow: "0 3px 16px #000, 0 0 24px currentColor", whiteSpace: "nowrap", animation: "arenaBanner 1.5s cubic-bezier(.2,.8,.2,1) forwards" }}>{banner.text}</div>}

            {/* Kill feed — instant read of what just happened */}
            <div style={{ position: "absolute", top: 52, right: 12, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", pointerEvents: "none" }}>
                {feed.map((f) => (<div key={f.id} style={{ padding: "3px 9px", background: "rgba(8,12,24,0.82)", border: `1px solid ${f.color}66`, borderRadius: 6, color: f.color, font: "700 12px Inter, system-ui, sans-serif", animation: "arenaFeedIn 0.2s ease-out" }}>{f.text}</div>))}
            </div>

            {/* Scoreboard */}
            <div className="pet-arena-scoreboard" style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "6px 18px", background: "rgba(8,12,24,0.82)", border: "1px solid rgba(148,163,184,0.4)", borderRadius: arenaV2 ? 14 : 999, font: "800 20px Inter, system-ui, sans-serif" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{ color: "#60a5fa" }}>BLUE {score[0]}</span>
                    <span style={{ color: "#64748b", fontSize: 12, fontWeight: 600 }}>📜 first to {result.winScore}</span>
                    <span style={{ color: "#f87171" }}>{score[1]} RED</span>
                </div>
                {/* V2 Overdrive meters — combat charges them; a full bar fires a spike (captures stay the only score). Both grow toward the centre label. */}
                {arenaV2 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, width: 240 }}>
                        <span ref={odBlueRef} style={{ opacity: 0, color: "#fde047", font: "900 10px Inter, system-ui, sans-serif", transition: "opacity .15s", width: 12, textAlign: "center" }}>⚡</span>
                        <div style={{ flex: 1, height: 6, background: "#0b1020", border: "1px solid #000", borderRadius: 4, overflow: "hidden", transform: "scaleX(-1)" }}><div ref={momBlueRef} style={{ width: "0%", height: "100%", background: "linear-gradient(90deg,#1d4ed8,#60a5fa)", transition: "width .12s linear" }} /></div>
                        <span style={{ color: "#64748b", font: "800 8px Inter, system-ui, sans-serif", letterSpacing: 0.5 }}>OVERDRIVE</span>
                        <div style={{ flex: 1, height: 6, background: "#0b1020", border: "1px solid #000", borderRadius: 4, overflow: "hidden" }}><div ref={momRedRef} style={{ width: "0%", height: "100%", background: "linear-gradient(90deg,#dc2626,#f87171)", transition: "width .12s linear" }} /></div>
                        <span ref={odRedRef} style={{ opacity: 0, color: "#fde047", font: "900 10px Inter, system-ui, sans-serif", transition: "opacity .15s", width: 12, textAlign: "center" }}>⚡</span>
                    </div>
                )}
            </div>
            {/* Captures-only scoring — make the win condition unmistakable (kills don't score). */}
            {/* Dynamic objective line — scroll-spawn countdown / carrier return-progress,
                updated per-frame via refs by <ArenaObjectiveHud> (no HUD re-render). */}
            <div className="pet-arena-objective" style={{ position: "absolute", top: 50, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, pointerEvents: "none" }}>
                <span ref={objTextRef} style={{ padding: "2px 10px", background: "rgba(8,12,24,0.6)", borderRadius: 999, color: "#94a3b8", font: "700 10px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>📜 Capture the scroll to score — defeating pets only buys time</span>
                <div ref={objBarWrapRef} style={{ display: "none", width: 150, height: 5, background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                    <div ref={objBarRef} style={{ width: "0%", height: "100%", background: "#60a5fa" }} />
                </div>
            </div>

            <div className="pet-arena-controls" style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8 }}>
                <button onClick={onExit} style={duelBtn}>✕ Exit</button>
                <button onClick={replay} style={duelBtn}>⟲ Replay</button>
            </div>
            <div className="pet-arena-mode-badge" style={{ position: "absolute", top: 12, right: 12, padding: "4px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(168,85,247,0.6)", borderRadius: 999, color: "#d8b4fe", font: "700 11px Inter, system-ui, sans-serif" }}>🏟️ Arena{arenaV2 ? " V2" : ""}{use3d ? " · 3D" : ""}{arenaV2 && result.modifier !== "standard" ? ` · ${MODIFIER_LABEL[result.modifier] ?? result.modifier}` : ""} (beta)</div>

            {ended && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,7,18,0.55)" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ font: "900 38px Inter, system-ui, sans-serif", color: result.winner === "blue" ? "#60a5fa" : result.winner === "red" ? "#f87171" : "#facc15", textShadow: "0 2px 12px #000" }}>{winLabel}</div>
                        <div style={{ color: "#94a3b8", font: "700 16px Inter, system-ui, sans-serif", marginTop: 4 }}>{result.scoreBlue} — {result.scoreRed}</div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                            <button onClick={replay} style={resultBtn}>⟲ Replay</button>
                            <button onClick={onExit} style={{ ...resultBtn, background: "#334155" }}>Exit</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    ), document.body);
}
