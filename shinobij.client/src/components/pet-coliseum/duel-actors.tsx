// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard, Html } from "@react-three/drei";
import type { Pet } from "../../types/pet";
import type { PetVisualState } from "../../types/pet-battle";
import { beatTimeline, beatChoreoMs, lerp, groundedSpriteLayout, classifyMoveChoreo, moveChoreoMods, meleeLungeReach, type MoveChoreoKind, type MoveChoreoMods } from "../../lib/pet-coliseum-scene";
import { DUEL_TPS, ARENA_X, ARENA_Y, type DuelResult, type DuelState } from "../../lib/pet-duel-sim";
import { petVisualId } from "../../data/pet-evolutions";
import { petCombatModel } from "../../lib/pet-3d-models";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "../PetModel3D";
import { PetModelBoundary } from "../PetModelBoundary";
import { boundedBurstStep, petDuelAttackRhythm, petDuelImpactStrength } from "../../lib/pet-duel-presentation";
import { petHeroMoveAt, petHeroMoveStyle, petHeroMoveWindows, type PetHeroMoveStyle } from "../../lib/pet-hero-moves";
import { petDuelModelCalibration } from "../../lib/pet-duel-model-presentation";
import { petDisplayName } from "../../lib/pet";
import { petModelVariantSurface } from "../../lib/pet-visual-variant";
import { resolveOpponentFacing } from "../../lib/pet-combat-performance";
import { type DuelClock, STRIKE_PULSE_S, TARGET_SPRITE_H, FLOOR_Y } from "./stage";
import { usePetSprite, usePetPoses, type PoseCat, poseCategory, shadowTexture, elementColor } from "./sprite-resources";
import { type DuelDashCue, findActor, hollowHoundSurface, duelFieldToFloor, dashCueTravelProgress, dashPathPoint, DUEL_FLOOR_HALF_W, DUEL_FLOOR_HALF_D, INTRO_PAUSE_END, INTRO_SIZEUP_END, INTRO_TOTAL } from "./duel-stage";



// ═════════════════════════════════════════════════════════════════════════════
// PetColiseumDuel — Phase C of the combat redesign (docs/pet-combat-redesign-plan.md).
// Renders the new CONTINUOUS duel engine (pet-duel-sim.ts) as a fluid fight: it
// runs runPetDuel / runPetPartyDuel, then plays the per-tick snapshot stream,
// INTERPOLATING between ticks for smooth motion at any framerate. PREVIEW ONLY
// (behind the petDuel.v1 flag) — the real battle outcome + rewards still come
// from the shipped round engine, so this has no gameplay/ranked impact.
// ═════════════════════════════════════════════════════════════════════════════

// duel sim state → the visual pose the flipbook/choreography uses.
const DUEL_STATE_POSE: Record<DuelState, PetVisualState> = {
    idle: "idle", dash: "lunge", windup: "windup", strike: "lunge",
    recover: "idle", stagger: "recoil", dodge: "dodge", dead: "ko",
};

      // centre the action near the camera's look point
const DUEL_MIN_WORLD_X = 3.7;

    // min world-x gap so two big fighters never merge / cross
const DUEL_SEP_BAND_Z = 1.7;

     // only separate a pair within this depth band
const DUEL_CONTACT_GAP = 1.7;

    // world-x left between sprites at the peak of a melee lunge (close but not overlapping)
const DUEL_3D_BODY_GAP = 5.45;

   // neutral guard range: enough runway for a readable approach, evade, or cast
const DUEL_3D_CONTACT_GAP = 2.55;

 // committed hits enter a tight pocket; the elemental contact reaches the defender
const DUEL_3D_READABLE_X_GAP = 2.65;

 // stop depth-aligned pets collapsing into one camera silhouette
const DUEL_3D_CONTACT_X_GAP = 1.3;

   // …but a committed blow is SUPPOSED to overlap silhouettes; hold only enough lane to read two bodies
// States in which a fighter has COMMITTED to (or is absorbing) a blow. While either
// side of a pair is in one, the neutral body gap eases down to the contact pocket —
// see the contact-pocket note in DuelStandee's frame loop.
const DUEL_COMMITTED_STATES: ReadonlySet<DuelState> = new Set<DuelState>(["dash", "windup", "strike", "stagger"]);


/** How fast the pair closes into / releases out of the contact pocket (per second). */
const DUEL_CONTACT_EASE_RATE = 9;



/** One GROUNDED fighter on the 3D coliseum floor — a Y-locked billboard standing
 *  on the floor with a real contact shadow, driven by the interpolated duel tick
 *  stream + the anime strike choreography (ability-distinct strikes, recoil,
 *  status tints, KO topple). Same grounded rig as the round renderer's Standee. */
export function DuelStandee({ duel, clock, id, pet, mirror, sharedImages, freeRoam3d, dashCue, showIdentity, acknowledgingCommand }: {
    duel: DuelResult; clock: { current: DuelClock }; id: string; pet: Pet; mirror: boolean; sharedImages: Record<string, string>; freeRoam3d: boolean; dashCue?: DuelDashCue; showIdentity: boolean; acknowledgingCommand: boolean;
}) {
    const sprite = usePetSprite(pet, sharedImages, mirror);   // mirror flips the art so the enemy faces the player
    const poses = usePetPoses(petVisualId(pet), mirror);
    const approvedModel = useMemo(() => petCombatModel(pet), [pet]);
    // A model that 404s or fails to parse drops this ONE fighter to the 2D
    // standee instead of throwing past <Suspense> and taking the whole screen
    // down (see PetModelBoundary). Nulling combatModel routes every consumer
    // below — the frame loop, the layout and the render — down the same path a
    // pet with no approved model already takes, so there is no second code path
    // to keep working. Recovery is DERIVED from the failed url rather than a
    // boolean plus a reset effect: a pet whose model differs is simply not the
    // failed one, so the 3D path is live again with no setState in an effect.
    //
    // `freeRoam3d` is deliberately left alone. It is a MATCH-level mode (true
    // only when every fighter resolved a model) owned by the parent, so a
    // mid-fight failure leaves this one billboard moving under free-roam spacing.
    // That reads fine — the billboard is Y-locked and camera-facing — and is far
    // better than swapping the whole match's movement rules mid-duel.
    const [failedModelUrl, setFailedModelUrl] = useState<string | null>(null);
    const combatModel = approvedModel && approvedModel.url === failedModelUrl ? null : approvedModel;
    const modelCalibration = useMemo(
        () => approvedModel ? petDuelModelCalibration(approvedModel) : null,
        [approvedModel],
    );
    const heroMoveWindows = useMemo(() => petHeroMoveWindows(duel.events, id, { ...pet, profile: combatModel?.profile }), [combatModel?.profile, duel.events, id, pet]);
    const modelFrame = useRef<PetModelFrame>({
        ...DEFAULT_PET_MODEL_FRAME,
        // Child frame callbacks can run before this standee's first update. Seed
        // the correct side immediately so neither model ever initializes from the
        // shared +X default and spends its opening frames turning around.
        faceX: mirror ? -1 : 1,
        faceZ: 0,
        lockTargetFacing: true,
    });
    const group = useRef<THREE.Group>(null);     // floor position + lunge offset
    const poseG = useRef<THREE.Group>(null);      // squash/stretch + topple, pivots at the feet
    // Deform "rig": a meshBasicMaterial whose vertex shader is patched
    // (onBeforeCompile) to BEND the sprite up its body — the creature leans into a
    // lunge, arches on the hop, and its body/tail follow through with a travelling
    // sine — so it ANIMATES instead of sliding as a flat image. Cheap; scales to all
    // pets; texture/tint/flash stay on the standard material so colour is correct.
    const deformU = useRef<Record<string, { value: number }> | null>(null);
    const baseMat = useMemo(() => {
        const m = new THREE.MeshBasicMaterial({ map: sprite.texture, transparent: true, alphaTest: 0.4, depthWrite: false, toneMapped: false });
        m.onBeforeCompile = (shader) => {
            shader.uniforms.uLean = { value: 0 };
            shader.uniforms.uArch = { value: 0 };
            shader.uniforms.uWave = { value: 0 };
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uHalfH = { value: 1 };
            deformU.current = shader.uniforms as unknown as Record<string, { value: number }>;
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", "uniform float uLean,uArch,uWave,uTime,uHalfH;\n#include <common>")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat _h=clamp(transformed.y/(uHalfH*2.0)+0.5,0.0,1.0);\ntransformed.x += uLean*_h*_h + uArch*sin(_h*3.14159) + sin(_h*5.0 - uTime*6.0)*uWave*_h;");
        };
        return m;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => () => baseMat.dispose(), [baseMat]);
    const matRef = useRef<THREE.MeshBasicMaterial>(null);   // primitive ref → mutated in useFrame (r3f escape hatch)
    const shadow = useRef<THREE.Mesh>(null);
    const shadowMat = useRef<THREE.MeshBasicMaterial>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const hpChip = useRef<HTMLDivElement>(null);   // lagging "damage-taken" chip behind the fill
    const nameWrap = useRef<HTMLDivElement>(null);
    const [poseCat, setPoseCat] = useState<PoseCat>("idle");
    const prevHp = useRef(Infinity);
    const flash = useRef(0);
    const visualPos = useRef<[number, number] | null>(null);
    const lastPos = useRef<[number, number] | null>(null);
    const smoothedSpeed = useRef(0);
    const locomotionActive = useRef(false);
    const dashRecoveryUntil = useRef(0);
    const dashRouteId = useRef<number | null>(null);
    const dashEntryOffset = useRef<[number, number]>([0, 0]);
    const travelFacing = useRef<[number, number]>([mirror ? -1 : 1, 0]);
    const runClock = useRef(0);
    const terminalTimeline = useRef<{ wall: number; base: number } | null>(null);
    // Anime strike choreography (render-only): eased offsets + phase clocks. The LONG sim
    // states (windup/stagger/dodge) drive beatTimeline directly; the 1-tick `strike` drives
    // a self-timed forward pulse off the windup-exit edge.
    const choX = useRef(0), choY = useRef(0), choZ = useRef(0), choSX = useRef(1), choSY = useRef(1), choRot = useRef(0);
    const choKind = useRef<PetVisualState>("idle");
    const choStart = useRef(0);
    const prevSimState = useRef<DuelState>("idle");
    const contactEase = useRef(0);   // 0 = neutral guard spacing, 1 = committed contact pocket
    const strikeStart = useRef(-999);
    const buffPoseStart = useRef(-999);
    const buffWasActive = useRef(false);
    // Per-strike choreography params, set on the windup→strike edge from the
    // resolution that's about to land (melee lunge vs ranged kick, how hard).
    const strikeKind = useRef<"melee" | "ranged">("melee");
    const strikePow = useRef(0.4);
    const strikeCrit = useRef(false);
    const strikeHeavy = useRef(false);   // rhythm read: this strike is a heavy/charged blow (vs a quick jab)
    const strikeMods = useRef<MoveChoreoMods>(moveChoreoMods("lightMelee"));   // per-move motion tuning (slam/drain/beam/support/…)
    const pulseS = useRef(STRIKE_PULSE_S);
    const strikeAnticipationShare = useRef(0.23);
    const strikeContactShare = useRef(0.18);
    const recoilPow = useRef(0.55);   // set on stagger-entry from the incoming hit's weight
    const bobPhase = useMemo(() => (id.charCodeAt(id.length - 1) % 7) * 0.9, [id]);
    // Damage-aware choreography lookup (render-only): this pet's OUTGOING
    // resolutions (a melee `hit` with how hard it landed, vs a ranged `cast`) and
    // the INCOMING hits that stagger it. Lets a light poke read as a quick jab and
    // a heavy blow as a deep, committed lunge with real knockback — all derived
    // from the deterministic event stream, never fed back into it.
    const { outResolves, inHits } = useMemo(() => {
        const outR: { t: number; kind: "melee" | "ranged"; power: number; crit: boolean; choreo: MoveChoreoKind }[] = [];
        const inH: { t: number; power: number; crit: boolean }[] = [];
        const snaps = duel.snapshots; const last = snaps.length - 1;
        for (const e of duel.events) {
            if (e.type === "hit" && e.dmg && e.actorId === id && e.targetId && !e.ranged) {
                const tgt = findActor(snaps[Math.min(last, e.t)], e.targetId);
                // The move's KIND + ELEMENT decide the melee staging: a crush/push slams,
                // a lifesteal drains back, a Wind hit double-slashes, a Lightning hit
                // thrusts. Projectile hits (e.ranged) are EXCLUDED — a ranged attacker
                // plants + kicks off its `cast`, it must never lunge on a stray land tick.
                // Render-only classification.
                outR.push({ t: e.t, kind: "melee", power: tgt ? Math.min(1, e.dmg / Math.max(1, tgt.maxHp)) : 0.4, crit: !!e.crit, choreo: classifyMoveChoreo(e.kind, false, e.element ?? pet.element) });
            } else if (e.type === "cast" && e.actorId === id) {
                // A cast → ranged offensive, control beam, or a support gather, by kind.
                outR.push({ t: e.t, kind: "ranged", power: 0, crit: false, choreo: classifyMoveChoreo(e.kind, true) });
            }
            if (e.type === "hit" && e.dmg && e.targetId === id) {
                const me = findActor(snaps[Math.min(last, e.t)], id);
                inH.push({ t: e.t, power: me ? Math.min(1, e.dmg / Math.max(1, me.maxHp)) : 0.4, crit: !!e.crit });
            }
        }
        outR.sort((a, b) => a.t - b.t); inH.sort((a, b) => a.t - b.t);
        return { outResolves: outR, inHits: inH };
    }, [duel, id, pet.element]);

    // The roster Oni pose atlas is the rig source, not the Hollow Hound's
    // visible identity. During model loading or 2D fallback, keep the authored
    // spectral portrait instead of briefly flashing the black/red Oni frames.
    const useSpectralHoundSprite = hollowHoundSurface(pet) !== undefined;
    const useTex = !useSpectralHoundSprite && poses ? poses.tex[poseCat] : sprite.texture;
    const useBounds = !useSpectralHoundSprite && poses ? poses.scan[poseCat].bounds : sprite.bounds;
    const useAspect = !useSpectralHoundSprite && poses ? poses.scan[poseCat].aspect : sprite.aspect;
    const L = useMemo(() => groundedSpriteLayout(useBounds, useAspect, TARGET_SPRITE_H, mirror), [useBounds, useAspect, mirror]);
    const shadowW = combatModel && modelCalibration
        ? Math.max(0.9, combatModel.targetHeight * 0.72 * modelCalibration.shadowWidth)
        : Math.max(0.9, L.contentWorldW * 0.95);
    const side = mirror ? "enemy" : "player";

    useFrame((state, delta) => {
        const g = group.current, pg = poseG.current, m = matRef.current;
        if (!g || !pg || (!m && !combatModel)) return;
        const snaps = duel.snapshots;
        const tf = Math.max(0, Math.min(snaps.length - 1, clock.current.t));
        const i0 = Math.floor(tf), i1 = Math.min(snaps.length - 1, i0 + 1), f = tf - i0;
        const a0 = findActor(snaps[i0], id);
        if (!a0) return;
        const a1 = findActor(snaps[i1], id) ?? a0;
        // A >3-field-unit jump is normally a reserve swap. Dash/dodge states are
        // explicitly locomotion, though: hard-cutting those states was the reason
        // an authored dash still looked like a teleport even with a speed trail.
        const tdx = a1.x - a0.x, tdy = a1.y - a0.y;
        const burstTravel = a0.state === "dash" || a1.state === "dash" || a0.state === "dodge" || a1.state === "dodge";
        // Active 3D fighters must never hard-cut across the floor. Even a large
        // director correction is blended as very fast locomotion; only the legacy
        // standee/reserve presentation retains a true discontinuity cut.
        const teleport = !freeRoam3d && !burstTravel && (tdx * tdx + tdy * tdy) > 9;
        const ff = teleport ? (f < 0.5 ? 0 : 1) : f;
        const fp = duelFieldToFloor(lerp(a0.x, a1.x, ff), lerp(a0.y, a1.y, ff));
        let wx = fp.wx, wz = fp.wz;

        // World-space spacing: statically mirrored standees stay left/right so their
        // art cannot turn backward. All-model fights retain the sim's free-roaming
        // floor path and true facing. Presentation only — never fed back to the sim.
        const myEnemy = id.startsWith("enemy");
        const actors = snaps[i0].actors;

        // ── CONTACT POCKET ──────────────────────────────────────────────────────
        // The neutral body gap is a READABILITY device for two big silhouettes
        // circling each other — it is not a collision volume. Enforcing it through a
        // committed attack was the reason a landed melee blow was drawn swinging at
        // empty air: the simulation had the pets at contact range (~2 units) and this
        // pass shoved them back out to 5.45 every frame, so the strike animation
        // played with the target well outside reach. While either side of the pair is
        // committed — mid-pounce, winding up, striking, or absorbing a hit — the floor
        // eases down to a true contact pocket so blows land ON the opponent.
        //
        // Eased rather than switched: a hard floor change pops the pair sideways by
        // ~1.5 units in one frame, which reads as a teleport. The ease-in doubles as
        // the closing motion of the attack.
        const committedPair = DUEL_COMMITTED_STATES.has(a0.state)
            || actors.some((o) => o.id !== id && o.state !== "dead"
                && o.id.startsWith("enemy") !== myEnemy && DUEL_COMMITTED_STATES.has(o.state));
        contactEase.current += ((committedPair ? 1 : 0) - contactEase.current)
            * Math.min(1, delta * DUEL_CONTACT_EASE_RATE);
        const ce = contactEase.current;
        const bodyGap = DUEL_3D_BODY_GAP + (DUEL_3D_CONTACT_GAP - DUEL_3D_BODY_GAP) * ce;
        const readableXGap = DUEL_3D_READABLE_X_GAP + (DUEL_3D_CONTACT_X_GAP - DUEL_3D_READABLE_X_GAP) * ce;

        let foeWX: number | null = null;   // nearest opposing fighter's world-x → legacy standee lunge target
        let foeDistance: number | null = null; // true floor distance → 3D free-roam lunge target
        let faceTargetWX: number | null = null;
        let faceTargetWZ: number | null = null;
        for (let k = 0; k < actors.length; k++) {
            const other = actors[k];
            if (other.id === id || other.state === "dead") continue;
            const oa0 = findActor(snaps[i0], other.id); if (!oa0) continue;
            const oa1 = findActor(snaps[i1], other.id) ?? oa0;
            const of = duelFieldToFloor(lerp(oa0.x, oa1.x, ff), lerp(oa0.y, oa1.y, ff));
            if (other.id.startsWith("enemy") === myEnemy) {
                // Same team (2v2 reserve) — a modest symmetric gap, same-depth only.
                if (!freeRoam3d) {
                    if (Math.abs(wz - of.wz) > DUEL_SEP_BAND_Z) continue;
                    const gapX = wx - of.wx, need = DUEL_MIN_WORLD_X * 0.7;
                    if (Math.abs(gapX) < need) { const dir = gapX >= 0 ? 1 : -1; wx += dir * (need - Math.abs(gapX)) * 0.5; }
                } else {
                    const gx = wx - of.wx, gz = wz - of.wz, gap = Math.hypot(gx, gz), need = DUEL_3D_BODY_GAP * 0.78;
                    if (gap < need) {
                        const ux = gap > 1e-4 ? gx / gap : (myEnemy ? 1 : -1), uz = gap > 1e-4 ? gz / gap : 0;
                        wx += ux * (need - gap) * 0.5; wz += uz * (need - gap) * 0.5;
                    }
                }
            } else {
                // OPPOSING — enforce ordering (player left of enemy) + the full gap,
                // centred on the pair midpoint so neither can pass through the other.
                if (!freeRoam3d) {
                    const mid = (wx + of.wx) / 2;
                    wx = myEnemy ? Math.max(wx, mid + DUEL_MIN_WORLD_X / 2) : Math.min(wx, mid - DUEL_MIN_WORLD_X / 2);
                }
                if (foeWX === null || Math.abs(of.wx - wx) < Math.abs(foeWX - wx)) foeWX = of.wx;
                // Preserve a modest lateral lane as well as radial spacing. Pets can
                // be far apart in depth yet still collapse into one camera silhouette.
                const xGap = wx - of.wx;
                if (freeRoam3d && Math.abs(xGap) < readableXGap) {
                    const laneDir = Math.abs(xGap) > 0.15 ? Math.sign(xGap) : (myEnemy ? 1 : -1);
                    wx += laneDir * (readableXGap - Math.abs(xGap)) * 0.5;
                }
                let distance = Math.hypot(of.wx - wx, of.wz - wz);
                if (freeRoam3d && distance < bodyGap) {
                    // Resolve presentation-space body overlap along the actual 3D line
                    // between the pets. Both standees apply half the correction, so they
                    // remain centred on the simulation contact while their meshes stay apart.
                    const gx = wx - of.wx, gz = wz - of.wz;
                    const ux = distance > 1e-4 ? gx / distance : (myEnemy ? 1 : -1);
                    const uz = distance > 1e-4 ? gz / distance : 0;
                    wx += ux * (bodyGap - distance) * 0.5;
                    wz += uz * (bodyGap - distance) * 0.5;
                    distance = bodyGap;
                }
                if (foeDistance === null || distance < foeDistance) {
                    foeDistance = distance;
                    faceTargetWX = of.wx;
                    faceTargetWZ = of.wz;
                }
            }
        }

        // A dash is one authored phrase shared by the creature and its VFX. The
        // previous renderer advanced the model from snapshots while a separate
        // comet advanced on wall time, which let the streak travel while the pet
        // appeared to pop directly to its destination. During an active cue this
        // world-space route owns the model position as well.
        let dashActive = false;
        let dashTravelFacing: [number, number] | null = null;
        if (dashCue) {
            const travelP = dashCueTravelProgress(dashCue, clock.current.t);
            if (clock.current.t >= dashCue.startTick && clock.current.t <= dashCue.contactTick) {
                dashActive = true;
                dashRecoveryUntil.current = performance.now() + 720;
                const routePoint = dashPathPoint(dashCue, travelP);
                if (dashRouteId.current !== dashCue.id) {
                    const routeStart = dashPathPoint(dashCue, 0);
                    const visibleStart = visualPos.current ?? [wx, wz];
                    dashRouteId.current = dashCue.id;
                    dashEntryOffset.current = [visibleStart[0] - routeStart[0], visibleStart[1] - routeStart[2]];
                }
                // Join the authored route from the creature's CURRENT rendered
                // position, then bleed the seam out before contact. This prevents
                // the first dash frame from popping back to an old snapshot.
                const seam = Math.pow(1 - travelP, 2);
                wx = routePoint[0] + dashEntryOffset.current[0] * seam;
                wz = routePoint[2] + dashEntryOffset.current[1] * seam;
                // The creature and its elemental trail share the route tangent.
                // Deriving heading from the lagged visual snapshot made zig-zag
                // dashes briefly point backward at each bend (and could leave a
                // Kitsune facing away on contact).
                const routeAhead = dashPathPoint(dashCue, Math.min(1, travelP + 0.025));
                const dashDx = routeAhead[0] - routePoint[0];
                const dashDz = routeAhead[2] - routePoint[2];
                const dashLength = Math.hypot(dashDx, dashDz);
                if (dashLength > 1e-4) dashTravelFacing = [dashDx / dashLength, dashDz / dashLength];
            }
        }

        // Dash routing runs after the neutral spacing pass, so it needs its own
        // contact guard. Without this final projection the authored S-curve could
        // finish at the opponent's simulation origin and visually merge both
        // meshes even though ordinary locomotion respected the body gap. Keep the
        // route tangent and all of its visible travel; only compress the last few
        // feet into a readable VFX-bridged contact pocket.
        if (freeRoam3d && dashActive && faceTargetWX !== null && faceTargetWZ !== null) {
            const gapX = wx - faceTargetWX;
            const gapZ = wz - faceTargetWZ;
            const contactDistance = Math.hypot(gapX, gapZ);
            if (contactDistance < DUEL_3D_CONTACT_GAP) {
                const fallbackX = myEnemy ? 1 : -1;
                const ux = contactDistance > 1e-4 ? gapX / contactDistance : fallbackX;
                const uz = contactDistance > 1e-4 ? gapZ / contactDistance : 0;
                wx = faceTargetWX + ux * DUEL_3D_CONTACT_GAP;
                wz = faceTargetWZ + uz * DUEL_3D_CONTACT_GAP;
            }
        }

        // Opening choreography stays at the simulation's real starting positions.
        // The old render-only charge made both pets sprint together before either
        // fighter had made a tactical decision.
        const introSec = clock.current.intro ?? 999;

        // The sim publishes at 30 Hz while the renderer normally runs at 60–144 Hz.
        // Interpolate the presentation target again with a frame-rate-independent
        // response so a slow capture/GPU frame cannot expose snapshot stair-steps.
        // Dashes stay snappy; neutral travel is slightly softer. Teleports still cut.
        const dashRecovering = !dashActive && performance.now() < dashRecoveryUntil.current;
        if (!visualPos.current || (teleport && !dashRecovering)) visualPos.current = [wx, wz];
        else if (dashActive) {
            // Keep an anime-fast burst, but never let a slow render frame collapse
            // several feet of its route into one visible update.
            visualPos.current = boundedBurstStep(visualPos.current, [wx, wz], delta);
        } else {
            // Let the eye track a burst over several render frames. A response of
            // 20 caught up in roughly one frame after a large snapshot jump.
            const response = dashRecovering ? 8.5 : a0.state === "dash" ? 10.5 : a0.state === "dodge" ? 12 : a0.state === "idle" ? 14 : 17;
            const alpha = 1 - Math.exp(-response * Math.min(delta, 1 / 15));
            visualPos.current[0] = lerp(visualPos.current[0], wx, alpha);
            visualPos.current[1] = lerp(visualPos.current[1], wz, alpha);
        }
        wx = visualPos.current[0];
        wz = visualPos.current[1];

        // Speed (world units per render frame) → drives the run cycle + bob.
        const dwx = lastPos.current ? wx - lastPos.current[0] : 0;
        const dwz = lastPos.current ? wz - lastPos.current[1] : 0;
        const rawSpeed = Math.hypot(dwx, dwz) / Math.max(1 / 240, delta);
        const travelStep = Math.hypot(dwx, dwz);
        if (dashTravelFacing) {
            travelFacing.current[0] = dashTravelFacing[0];
            travelFacing.current[1] = dashTravelFacing[1];
        } else if (!teleport && travelStep > 0.003) {
            // Preserve locomotion direction independently from target-facing.
            // Quadrupeds consume this so a lateral kite becomes a real turn-and-run
            // instead of a forward walk animation sliding sideways across the floor.
            // Filter the direction itself: tiny curved-path corrections otherwise
            // flip the yaw target every frame and make a running model shake.
            const directionAlpha = 1 - Math.exp(-5 * Math.min(delta, 1 / 15));
            const targetX = dwx / travelStep;
            const targetZ = dwz / travelStep;
            const filteredX = lerp(travelFacing.current[0], targetX, directionAlpha);
            const filteredZ = lerp(travelFacing.current[1], targetZ, directionAlpha);
            const filteredLength = Math.hypot(filteredX, filteredZ) || 1;
            travelFacing.current[0] = filteredX / filteredLength;
            travelFacing.current[1] = filteredZ / filteredLength;
        }
        const speedAlpha = 1 - Math.exp(-11 * Math.min(delta, 1 / 15));
        smoothedSpeed.current = teleport ? 0 : lerp(smoothedSpeed.current, rawSpeed, speedAlpha);
        lastPos.current = [wx, wz];
        // The duel snapshots arrive at 30 Hz while render frames arrive much faster.
        // Per-frame displacement therefore pulses between a larger snapshot step and
        // tiny interpolation tails. Hysteresis keeps the locomotion clip engaged
        // through those tails instead of restarting idle/run several times per tick.
        if (a0.state === "dead") locomotionActive.current = false;
        else if (smoothedSpeed.current > 0.22) locomotionActive.current = true;
        else if (smoothedSpeed.current < 0.075) locomotionActive.current = false;
        const moving = locomotionActive.current;
        // Face/lunge toward the foe: player (left) → +x, enemy (right) → −x. With the
        // non-crossing clamp above, this always matches the statically-mirrored art.
        const mappedFaceX = a0.faceX * (DUEL_FLOOR_HALF_W / ARENA_X);
        const mappedFaceZ = a0.faceY * (DUEL_FLOOR_HALF_D / ARENA_Y);
        let desiredFaceX = mappedFaceX;
        let desiredFaceZ = mappedFaceZ;
        // Navigation briefly points the sim-facing vector along a maneuver. For
        // presentation, keep the creature's eyes and attack axis on its nearest
        // live opponent while it circles, side-steps, or backs away.
        if (freeRoam3d && faceTargetWX !== null && faceTargetWZ !== null) {
            desiredFaceX = faceTargetWX - wx;
            desiredFaceZ = faceTargetWZ - wz;
        }
        // Pass the exact eye-line into the model. PetModel3D owns angular easing;
        // easing this vector here as well made command holds preserve a stale
        // diagonal and left both pets looking past one another.
        const [faceWX, faceWZ] = resolveOpponentFacing(
            0,
            0,
            freeRoam3d ? desiredFaceX : (myEnemy ? -1 : 1),
            freeRoam3d ? desiredFaceZ : 0,
            myEnemy ? -1 : 1,
            0,
        );
        const facing = faceWX < 0 ? -1 : 1;

        // ── Anime strike choreography (render-only — never touches the sim) ──────
        // The LONG sim states drive beatTimeline (windup coils back, stagger recoils,
        // dodge slips); the 1-tick `strike` drives a self-timed forward pulse off the
        // windup→exit edge. On the real 3D floor the melee lunge ARCS (a small hop).
        let basePose: PetVisualState =
            a0.state === "windup" ? "windup" : a0.state === "stagger" ? "recoil" : a0.state === "dodge" ? "dodge" : "idle";
        // Opening: after a still face-off pause, both pets gather power without
        // closing distance. Actual locomotion begins when the simulation starts.
        const sizingUp = introSec >= INTRO_PAUSE_END && introSec < INTRO_SIZEUP_END;
        if (sizingUp) basePose = "charge";
        const curTick = Math.floor(clock.current.t);
        const activeHeroMove = petHeroMoveAt(heroMoveWindows, clock.current.t);
        // A SUPPORT cast (heal/shield/buff) winds up as a GATHER/RISE, not the melee
        // coil-back, so a healer reads as drawing power up — not flinching to strike.
        if (a0.state === "windup") {
            for (let k = 0; k < outResolves.length; k++) {
                const it = outResolves[k]; if (it.t > curTick + 8) break;
                if (it.t >= curTick - 1) { if (it.choreo === "support") basePose = "charge"; break; }
            }
        }
        // Status activation gets its own planted power-up beat after the tactical
        // disengage. The cast windup gathers the energy; this short pose is the
        // visible release/stance change when buff or haste actually comes online.
        const buffActive = a0.statuses.includes("buff") || a0.statuses.includes("haste");
        if (buffActive && !buffWasActive.current) buffPoseStart.current = state.clock.elapsedTime;
        buffWasActive.current = buffActive;
        const buffPoseElapsed = state.clock.elapsedTime - buffPoseStart.current;
        const buffPosing = buffPoseElapsed >= 0 && buffPoseElapsed < 0.82;
        if (basePose !== choKind.current) { choKind.current = basePose; choStart.current = state.clock.elapsedTime; }
        const baseProg = basePose === "idle" ? 1 : Math.min(1, (state.clock.elapsedTime - choStart.current) / (beatChoreoMs(basePose) / 1000));
        // Stagger ENTRY → scale this recoil's knockback by how hard the incoming blow landed.
        if (a0.state === "stagger" && prevSimState.current !== "stagger") {
            let rp = 0.55;
            for (let k = 0; k < inHits.length; k++) {
                const it = inHits[k];
                if (it.t > curTick + 4) break;
                if (it.t >= curTick - 1) {
                    // Damage fractions are usually small, so feeding them through
                    // directly produced a barely visible flinch. Remap them into a
                    // readable recoil range and give crits a decisive snap.
                    rp = petDuelImpactStrength(it.power, it.crit);
                    break;
                }
            }
            recoilPow.current = rp;
        }
        const base = beatTimeline(basePose, facing, 1.0, baseProg, { power: basePose === "recoil" ? recoilPow.current : 0.6 });
        // Fire the forward strike pulse when windup completes into strike/recover.
        // Read the resolution about to land so the pulse is ability-distinct: a melee
        // HIT → a power-scaled lunge (heavier = deeper, overhead chop on crits); a
        // ranged CAST → a plant + recoil-kick so ranged pets never slide into melee.
        if (prevSimState.current === "windup" && (a0.state === "strike" || a0.state === "recover")) {
            strikeStart.current = state.clock.elapsedTime;
            let kind: "melee" | "ranged" = "melee", pow = 0.4, crit = false, choreo: MoveChoreoKind = "lightMelee";
            for (let k = 0; k < outResolves.length; k++) {
                const it = outResolves[k]; if (it.t > curTick + 8) break;
                if (it.t >= curTick - 1) { kind = it.kind; pow = it.power; crit = it.crit; choreo = it.choreo; break; }
            }
            strikeKind.current = kind; strikePow.current = pow; strikeCrit.current = crit;
            const mods = moveChoreoMods(choreo); strikeMods.current = mods;
            // RHYTHM VARIETY (R1): a heavy/crit blow reads as a CHARGED slam (longer telegraph +
            // deep thrust); a light poke as a QUICK jab — so the exchange skeleton isn't uniform.
            const heavy = crit || pow >= 0.55;
            strikeHeavy.current = heavy;
            const rhythm = petDuelAttackRhythm(pow, crit, choreo === "heavySlam");
            pulseS.current = STRIKE_PULSE_S * (1 + 0.45 * pow) * mods.pulseMul * rhythm.pulseMultiplier;
            strikeAnticipationShare.current = rhythm.anticipationShare;
            strikeContactShare.current = rhythm.contactShare;
        }
        prevSimState.current = a0.state;
        const pe = state.clock.elapsedTime - strikeStart.current;
        let dxT = base.dx, dyT = base.dy, dzT = 0, sxT = base.sx, syT = base.sy, rotT = base.rot;
        if (pe >= 0 && pe < pulseS.current) {
            const pp = pe / pulseS.current;
            const anticipationEnd = strikeAnticipationShare.current;
            const contactEnd = Math.min(0.88, anticipationEnd + strikeContactShare.current);
            const thrust = pp < anticipationEnd
                ? pp / Math.max(0.01, anticipationEnd)
                : pp < contactEnd
                    ? 1
                    : 1 - (pp - contactEnd) / Math.max(0.01, 1 - contactEnd);
            const e = thrust * thrust * (3 - 2 * thrust);   // smoothstep
            const mods = strikeMods.current;
            if (mods.plant) {
                // Planted archetypes never gap-close, so a ranged/support pet never
                // slides into melee. Three distinct reads off the SAME pulse:
                if (mods.kickAway) {
                    // Ranged offensive — plant + recoil-kick away; the projectile carries it.
                    dxT = -0.5 * e * facing; sxT = 1 - 0.04 * e; syT = 1 + 0.06 * e; rotT = 0;
                } else if (mods.rise > 0) {
                    // Support cast — a stationary gather/rise (no kick, no lunge).
                    dxT = 0; dyT = mods.rise * Math.sin(Math.PI * pp); sxT = 1 - 0.03 * e; syT = 1 + 0.10 * e; rotT = 0;
                } else {
                    // Control beam — a braced plant (no kick, no travel).
                    dxT = 0; sxT = 1 + 0.05 * e; syT = 1 + 0.02 * e; rotT = 0;
                }
            } else {
                const pw = strikePow.current, ct = strikeCrit.current;
                // CLOSE THE GAP: lunge most of the way to the foe so the strike actually
                // CONNECTS across the resting spacer (rush in → hit → recoil back), instead
                // of a hop into empty air. A heavy slam commits a hair closer (closeMul<1);
                // stop short (DUEL_CONTACT_GAP) so the big sprites never overlap. Falls back
                // to a fixed reach if no foe is tracked.
                const gapToFoe = freeRoam3d && foeDistance !== null
                    ? foeDistance
                    : foeWX !== null ? Math.abs(foeWX - wx) : DUEL_MIN_WORLD_X;
                // Clamped so a single lunge can never overshoot the contact line into the foe.
                const reach = meleeLungeReach(gapToFoe, pw, ct, freeRoam3d ? DUEL_3D_CONTACT_GAP : DUEL_CONTACT_GAP, mods.closeMul);
                // Crit OR a slash archetype → a quick 2-tap flurry overlaid on the lunge;
                // else one thrust (a pierce / heavy slam commits as a single deep blow).
                const jab = (ct || mods.doubleTap) ? 0.72 + 0.28 * Math.abs(Math.cos(pp * Math.PI * 2)) : 1;
                let dx = reach * e * jab * facing;
                // Lifesteal → after contact, retract toward self (yank the life home).
                if (mods.drainBack > 0 && pp > 0.5) dx -= mods.drainBack * reach * 0.4 * ((pp - 0.5) / 0.5) * facing;
                dxT = dx;
                // GROUNDED — feet stay on the floor; only a slight lift on the crit/slam chop.
                // (The old big arc read as "dashing in the air".)
                dyT = (ct ? 0.16 : 0.035) * Math.sin(Math.PI * Math.min(1, pp / 0.72)) * (0.7 + 0.3 * pw);
                sxT = 1 + (0.10 + 0.14 * pw) * e + mods.chop * 0.05 * e;
                syT = 1 - (0.07 + 0.09 * pw) * e - mods.chop * 0.04 * e;
                rotT = -(0.05 + 0.16 * pw + mods.chop * 0.16) * e * facing * (ct ? 1.35 : 1);   // deeper overhead chop on slam/crit
            }
        }
        if (buffPosing) {
            const bp = Math.min(1, buffPoseElapsed / 0.82);
            const surge = Math.sin(Math.PI * Math.min(1, bp / 0.62));
            const plant = 1 - Math.pow(1 - Math.min(1, bp / 0.2), 3);
            // Brace on the floor and rise through the torso while the golden energy
            // column climbs. No hopping or side rotation: this is a planted power-up.
            dxT = 0;
            dyT = Math.max(dyT, 0.035 * surge);
            sxT = 1 + 0.08 * plant - 0.025 * surge;
            syT = 1 - 0.1 * plant + 0.13 * surge;
            rotT = 0;
        }
        // KO finisher — topple + sink when down (the dead pose fades; this lands it
        // with weight instead of just blinking out).
        if (a0.state === "dead") { dxT = -0.4 * facing; dyT = 0; rotT = 1.1 * facing; sxT = 1.05; syT = 0.7; }
        // The old billboard rig can only lunge on screen-x. A model can commit along
        // its actual facing vector, so attacks still connect after a flank or crossover.
        if (freeRoam3d) {
            const longitudinal = dxT * facing;
            dxT = longitudinal * faceWX;
            dzT = longitudinal * faceWZ;
        }
        const choreoResponse = (a0.state === "strike" || a0.state === "stagger" || pe < pulseS.current || buffPosing) ? 28 : 18;
        const ck = 1 - Math.exp(-choreoResponse * Math.min(delta, 1 / 15));
        choX.current = lerp(choX.current, dxT, ck);
        choY.current = lerp(choY.current, dyT, ck);
        choZ.current = lerp(choZ.current, dzT, ck);
        choSX.current = lerp(choSX.current, sxT, ck);
        choSY.current = lerp(choSY.current, syT, ck);
        choRot.current = lerp(choRot.current, rotT, ck);

        // Stand ON the floor: lane position + lunge offset + a tiny run-bob; a gentle
        // idle stance lean + breathe so a waiting pet never just stands stock-still.
        const idling = a0.state === "idle" && !moving;
        // Low-HP DESPERATION read (R3): below 26% HP a pet breathes harder/faster + gains a
        // rage aura + red rim (below), so the climax of a long fight actually looks like one.
        const frac = a0.hp / Math.max(1, a0.maxHp);
        const desperate = a0.state !== "dead" && frac > 0 && frac < 0.26;
        // Authored skeletal clips already contain their vertical cadence. Adding
        // the billboard run-bob and squash rig on top makes a real 3D pet judder
        // at every snapshot/state transition, so models receive only world-space
        // repositioning/lunge offsets here.
        const bob = moving && !combatModel ? Math.abs(Math.sin(state.clock.elapsedTime * 12 + bobPhase)) * 0.06 : 0;
        // A planted guard reads as intention; translating both pets during every idle
        // frame looked like synchronized dancing. Keep only a rare, tiny body feint.
        const neutralT = state.clock.elapsedTime * 0.6 + bobPhase;
        const feint = idling ? Math.max(0, Math.sin(neutralT * 1.35) - 0.96) * 0.45 * facing : 0;
        const bFreq = desperate ? 7.4 : 5.2, bAmp = desperate ? 0.075 : 0.04;
        const breathe = idling && !combatModel ? 1 + Math.abs(Math.sin(state.clock.elapsedTime * bFreq + bobPhase)) * bAmp : 1;
        // The authored dash route is already a complete launch → S-step → contact
        // phrase. Suppress the ordinary melee-lunge offset until its short recovery
        // window clears; adding both translations made the pet overshoot and snap.
        const routeOwnsPosition = dashActive || dashRecovering;
        // The 3D stage track already contains approach, contact, recoil and exit
        // displacement. Adding the legacy billboard lunge on top caused a second
        // horizontal shove followed by a correction (the remaining stiff slide).
        // Keep vertical anticipation/hops, but give horizontal ownership to one
        // system. An authored dash owns all three axes because its S-route has its
        // own hop arc.
        // A landed hit must move the creature, not only brighten its material.
        // The deterministic floor position remains authoritative; this short,
        // damage-scaled root displacement releases during recovery.
        const reactionOwnsPosition = basePose === "recoil" && !routeOwnsPosition;
        const presentationChoX = reactionOwnsPosition ? choX.current * 0.58 : (freeRoam3d || routeOwnsPosition) ? 0 : choX.current;
        const presentationChoY = routeOwnsPosition ? 0 : choY.current;
        const presentationChoZ = reactionOwnsPosition ? choZ.current * 0.58 : (freeRoam3d || routeOwnsPosition) ? 0 : choZ.current;
        const calibratedGround = combatModel && modelCalibration ? modelCalibration.groundOffset : 0;
        g.position.set(wx + presentationChoX, FLOOR_Y + calibratedGround + Math.max(0, presentationChoY) + bob, wz + presentationChoZ);
        if (combatModel) {
            const settle = 1 - Math.exp(-16 * Math.min(delta, 1 / 15));
            const calibratedScale = modelCalibration?.modelScale ?? 1;
            pg.scale.x = lerp(pg.scale.x, calibratedScale, settle);
            pg.scale.y = lerp(pg.scale.y, calibratedScale, settle);
            pg.scale.z = lerp(pg.scale.z, calibratedScale, settle);
            pg.rotation.z = lerp(pg.rotation.z, 0, settle);
        } else {
            pg.scale.set(choSX.current, choSY.current * breathe, 1);
            pg.rotation.z = lerp(pg.rotation.z, choRot.current + feint, 0.4);
        }

        // Pose: alternate the 2-frame run cycle while traversing (if the pet has
        // one), else the state pose (attack / hurt / cast / idle).
        let cat = poseCategory(DUEL_STATE_POSE[a0.state]);
        if (sizingUp) cat = "cast";   // the buff / power-up sprite pose during the size-up
        if (buffPosing) cat = "cast";
        if (acknowledgingCommand && a0.state === "idle") cat = poses?.hasMove ? "windup" : "cast";
        // Generated ATTACK SEQUENCE: a windup frame during the wind-up, then
        // lunge→impact→recover across the strike pulse (melee only) — so the
        // creature really swings. Falls back to the single "attack" pose for pets
        // without generated move frames (poses.hasMove === false).
        if (poses?.hasMove) {
            if (a0.state === "windup") cat = "windup";
            else if (strikeKind.current === "melee" && pe >= 0 && pe < pulseS.current) {
                const pp = pe / pulseS.current;
                // Heavy blows DWELL on the wind/impact frames; quick jabs blow through them (R1).
                const p0 = strikeAnticipationShare.current;
                const p1 = Math.min(0.88, p0 + strikeContactShare.current);
                cat = pp < p0 ? "lunge" : pp < p1 ? "impact" : "recover";
            }
        }
        if (moving && poses?.hasRun && (a0.state === "idle" || a0.state === "dash")) {
            runClock.current += delta * 12.5;
            cat = Math.floor(runClock.current) % 2 === 0 ? "run-a" : "run-b";
        }
        if (cat !== poseCat) setPoseCat(cat);

        // Hit flash on HP drop (folded into the material colour); status tint while
        // afflicted; fade out when down.
        if (a0.hp < prevHp.current - 0.5) flash.current = 1;
        prevHp.current = a0.hp;
        flash.current *= 0.86;
        let fl = flash.current < 0.02 ? 0 : flash.current * 0.9;
        // Power-up GLOW while sizing up — a pulsing brightness so both pets visibly "buff".
        if (sizingUp) fl = Math.max(fl, 0.22 + 0.16 * Math.abs(Math.sin(state.clock.elapsedTime * 6)));
        // DESPERATION rage aura (R3) — a pulsing glow when a pet is bloodied (< 26% HP).
        if (desperate) fl = Math.max(fl, 0.10 + 0.10 * Math.abs(Math.sin(state.clock.elapsedTime * 8)));
        // Status TINT (burn = ember-warm, stun = icy-blue) pulses on the sprite so
        // afflictions read at a glance; the stagger hurt-flash deepens it to red.
        const hurt = a0.state === "stagger" ? 0.5 : 0;
        let tr = 1, tg = 1, tb = 1;
        const st = a0.statuses;
        if (st.length) {
            if (st.includes("burn")) { tg = 0.74; tb = 0.55; }
            else if (st.includes("stun")) { tr = 0.74; tg = 0.88; }
            const pulse = 0.88 + 0.12 * Math.sin(state.clock.elapsedTime * 7 + bobPhase);
            tr = 1 - (1 - tr) * pulse; tg = 1 - (1 - tg) * pulse; tb = 1 - (1 - tb) * pulse;
        }
        tg -= 0.3 * hurt; tb -= 0.3 * hurt;
        if (desperate) { tr = Math.min(1.25, tr + 0.14); tg *= 0.93; tb *= 0.88; }   // bloodied red-rage rim (R3)
        const mf = modelFrame.current;
        // The simulator's strike state is intentionally only one tick long, but a
        // production animation needs a complete anticipation -> contact -> follow-
        // through phrase. Keep the authored attack clip alive for the render-side
        // strike pulse instead of replacing it with `recover` after ~33 ms. This is
        // the difference between a creature visibly attacking and a model merely
        // sliding forward while its attack clip flashes for a single frame.
        const striking = pe >= 0 && pe < pulseS.current;
        mf.motion = a0.state === "dead"
            ? "dead"
            : dashActive
                ? "dash"
                : dashRecovering && dashCue && !dashCue.impact
                    // A missed gap-closer plants and turns after crossing the empty
                    // lane. Leaving the simulator's one-tick strike here made the
                    // fox instantly change from gallop to idle at its new position.
                    ? "recover"
                : acknowledgingCommand && a0.state === "idle"
                    ? "windup"
                : striking
                ? "strike"
                : a0.state === "idle" && moving ? "run" : a0.state;
        mf.moving = moving;
        mf.speed = smoothedSpeed.current;
        mf.moveX = travelFacing.current[0];
        mf.moveZ = travelFacing.current[1];
        mf.faceX = faceWX;
        mf.faceZ = faceWZ;
        // Duel locomotion is authored as circling/pressure movement. Preserve the
        // exact opponent eye-line above instead of letting PetModel3D replace it
        // with the last travel tangent (the source of both pets facing away).
        mf.lockTargetFacing = true;
        mf.hit = flash.current;
        mf.impactPower = recoilPow.current;
        const atTerminal = clock.current.t >= snaps.length - 1 - 0.001;
        const winnerTeam = myEnemy ? "enemy" : "player";
        const defeated = atTerminal && duel.winner !== null && duel.winner !== winnerTeam;
        const victorious = atTerminal && a0.state !== "dead" && duel.winner === winnerTeam;
        if (defeated) mf.motion = "dead";
        mf.casting = sizingUp || buffPosing || victorious || (a0.state === "windup" && strikeKind.current === "ranged");
        mf.desperate = desperate;
        mf.statuses = st;
        mf.victorious = victorious;
        // Even a neutral pause carries species intent: a wolf circles, a stag
        // braces, and a turtle withdraws. Named moves temporarily override this
        // baseline with their authored hero package.
        mf.moveStyle = activeHeroMove?.style ?? petHeroMoveStyle({
            petId: pet.id,
            petName: pet.name,
            profile: combatModel?.profile,
        });
        mf.moveName = activeHeroMove?.move;
        const battleTimeline = (clock.current.intro ?? 0) >= INTRO_TOTAL
            ? INTRO_TOTAL + clock.current.t / DUEL_TPS
            : (clock.current.intro ?? 0);
        if (atTerminal) {
            if (!terminalTimeline.current) terminalTimeline.current = { wall: state.clock.elapsedTime, base: battleTimeline };
            mf.timeline = terminalTimeline.current.base + (state.clock.elapsedTime - terminalTimeline.current.wall);
        } else {
            terminalTimeline.current = null;
            mf.timeline = battleTimeline;
        }
        if (m) {
            m.color.setRGB(Math.min(2, tr + fl), Math.min(2, Math.max(0, tg) + fl), Math.min(2, Math.max(0, tb) + fl));
            m.opacity = a0.state === "dead" ? lerp(m.opacity, 0.25, 0.1) : 1;
            if (m.map !== useTex) m.map = useTex;
            // Drive the deform "rig": lean into the lunge, arch on the hop, body/tail
            // follow-through wave (stronger while moving / striking, gentle idle sway).
            if (deformU.current) {
                deformU.current.uHalfH.value = L.planeH * 0.5;
                deformU.current.uTime.value = state.clock.elapsedTime;
                // Lean into the lunge — clamped so the now-deeper gap-closing reach doesn't shear the sprite.
                deformU.current.uLean.value = lerp(deformU.current.uLean.value, Math.max(-0.6, Math.min(0.6, choX.current * (strikeHeavy.current ? 0.4 : 0.3))), 0.4);   // heavier lean on a charged blow (R1)
                deformU.current.uArch.value = Math.max(0, choY.current) * 0.5;
                deformU.current.uWave.value = 0.025 + Math.min(0.14, smoothedSpeed.current * 0.12) + (pe >= 0 && pe < pulseS.current ? 0.12 : 0) + (desperate ? 0.04 : 0);   // bloodied jitter (R3)
            }
        }

        // HP bar + dead dim via DOM refs (no React re-render).
        if (hpFill.current) {
            const pct = Math.max(0, Math.min(100, (a0.hp / Math.max(1, a0.maxHp)) * 100));
            hpFill.current.style.width = `${pct}%`;
            // Trailing "chip" drains DOWN slowly behind the fill (the classic damage read);
            // snaps up instantly on a heal so it never sits above true HP.
            if (hpChip.current) { const chip = parseFloat(hpChip.current.style.width) || pct; hpChip.current.style.width = `${chip <= pct ? pct : lerp(chip, pct, 0.12)}%`; }
        }
        if (nameWrap.current) nameWrap.current.style.opacity = a0.state === "dead" ? "0.5" : "1";

        // Contact shadow — flat on the floor, tracks x/z, fades + shrinks as the pet lifts.
        if (shadow.current && shadowMat.current) {
            shadow.current.position.set(wx + presentationChoX, 0.02, wz + presentationChoZ);
            const lift = Math.max(0, presentationChoY);
            const sf = Math.max(0, 1 - lift * 0.7);
            const calibratedOpacity = combatModel && modelCalibration ? modelCalibration.shadowOpacity : 0.42;
            const calibratedDepth = combatModel && modelCalibration ? modelCalibration.shadowDepth : 0.5;
            shadowMat.current.opacity = calibratedOpacity * sf * (a0.state === "dead" ? 0.4 : 1);
            const s = 0.85 + 0.15 * sf;
            shadow.current.scale.set(shadowW * s, shadowW * calibratedDepth * s, 1);
        }
    });

    return (
        <group>
            <group ref={group}>
                {combatModel ? (
                    <group ref={poseG}>
                        <PetModelBoundary onFail={() => setFailedModelUrl(combatModel.url)}>
                            <Suspense fallback={(
                                <Billboard lockX lockZ>
                                    <mesh position={[L.meshX, L.meshY, 0]}>
                                        <planeGeometry args={[L.planeW, L.planeH, 6, 20]} />
                                        <primitive object={baseMat} ref={matRef} attach="material" />
                                    </mesh>
                                </Billboard>
                            )}>
                                <PetModel3D config={combatModel} frame={modelFrame} element={pet.element} showIdentity={showIdentity} surfaceTreatment={petModelVariantSurface(pet, hollowHoundSurface(pet))} />
                            </Suspense>
                        </PetModelBoundary>
                    </group>
                ) : (
                    /* Y-axis-locked billboard: yaws to face the camera but stays vertical,
                       so the feet never lift off the floor at the angled camera. */
                    <Billboard lockX lockZ>
                        <group ref={poseG}>
                            <mesh position={[L.meshX, L.meshY, 0]}>
                                <planeGeometry args={[L.planeW, L.planeH, 6, 20]} />
                                <primitive object={baseMat} ref={matRef} attach="material" />
                            </mesh>
                        </group>
                    </Billboard>
                )}
                {showIdentity && <Html position={[0, combatModel ? combatModel.targetHeight * (modelCalibration?.modelScale ?? 1) + (modelCalibration?.labelOffset ?? 0.5) : L.contentWorldH + 0.4, 0]} center distanceFactor={11} pointerEvents="none" zIndexRange={[6, 0]}>
                    <div ref={nameWrap} style={{ textAlign: "center", font: "700 12px Inter, system-ui, sans-serif", whiteSpace: "nowrap", userSelect: "none" }}>
                        <div style={{ color: "#fff", textShadow: "0 1px 3px #000", marginBottom: 2 }}>Lv.{pet.level} {petDisplayName(pet)}</div>
                        <div style={{ position: "relative", width: 64, height: 6, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpChip} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: "#fbbf24", opacity: 0.75 }} />
                            <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: side === "player" ? "#4ade80" : "#f87171" }} />
                        </div>
                    </div>
                </Html>}
            </group>
            {/* Per-pet contact shadow — flat on the floor, follows the pet. */}
            <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial ref={shadowMat} map={shadowTexture()} transparent opacity={0.42} depthWrite={false} toneMapped={false} />
            </mesh>
        </group>
    );
}



// ── Signature model portrait ─────────────────────────────────────────────────
// The live model portrait sits beside the move title without entering the main
// arena Canvas, so signature hit-stop and the combat camera remain independent.
/** Signature portrait for approved 3D pets. Reusing the actual combat body keeps
 * evolved and roster identities coherent when legacy 2D pose art depicts an
 * older species design. Unapproved pets retain the established artwork path. */
export function DuelCutInModelPortrait({ pet, config, style, move, mirror }: {
    pet: Pet;
    config: NonNullable<ReturnType<typeof petCombatModel>>;
    style: PetHeroMoveStyle;
    move: string;
    mirror: boolean;
}) {
    const frame = useRef<PetModelFrame>({
        ...DEFAULT_PET_MODEL_FRAME,
        motion: "windup",
        casting: true,
        moveStyle: style,
        moveName: move,
        timeline: 0.85,
        faceX: mirror ? -1 : 1,
    });
    useEffect(() => {
        frame.current.moveStyle = style;
        frame.current.moveName = move;
        frame.current.faceX = mirror ? -1 : 1;
    }, [mirror, move, style]);
    const cameraDistance = Math.max(4.5, config.targetHeight * 1.85);
    return (
        <div className="pet-cutin-model" aria-label={`${petDisplayName(pet)} combat model`}>
            {/* Own canvas, so the boundary can wrap it the way IntroCompanion3D
                does: a failed portrait model renders nothing and the rest of the
                signature cut-in still plays. */}
            <PetModelBoundary>
                <Canvas
                    dpr={[1, 2]}
                    camera={{ position: [0, 0, cameraDistance], fov: 32, near: 0.1, far: 30 }}
                    gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
                    style={{ width: "100%", height: "100%", background: "transparent" }}
                    onCreated={({ gl }) => {
                        gl.toneMappingExposure = 0.82;
                    }}
                >
                    <ambientLight intensity={0.76} color="#d8e5ff" />
                    <directionalLight position={mirror ? [-3, 4, 5] : [3, 4, 5]} intensity={1.7} color="#fff4dc" />
                    <directionalLight position={mirror ? [3, 1, -2] : [-3, 1, -2]} intensity={0.68} color={elementColor(pet.element).glow} />
                    <group position={[0, -config.targetHeight * 0.5, 0]} rotation={[0, mirror ? -0.34 : 0.34, 0]}>
                        <Suspense fallback={null}>
                            <PetModel3D config={config} frame={frame} element={pet.element} showIdentity={false} surfaceTreatment={petModelVariantSurface(pet, hollowHoundSurface(pet))} />
                        </Suspense>
                    </group>
                </Canvas>
            </PetModelBoundary>
        </div>
    );
}
