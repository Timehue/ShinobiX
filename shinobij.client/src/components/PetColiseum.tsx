/*
 * ── PetColiseum — hybrid 3D coliseum battle renderer ──────────────────────────
 * A react-three-fiber drop-in alternative to PetArenaBattlefield. Approved pets
 * fight as lit, shadow-casting GLB models with real floor movement and facing;
 * the rest retain their HD-2D full-body standee until their model is ready.
 * Both paths lunge, recoil, guard, dodge and topple on KO, with elemental VFX
 * and a cinematic camera selling the heavy blows.
 *
 * CRITICAL: this is a pure PRESENTATION layer. It consumes the SAME inputs the
 * DOM renderer does — the deterministic frame, the buildPetAnimationEvents()
 * queue, petPoseForAvatar(), petBattleCamera(), petFxSpriteKey() — and drives
 * motion off them. It never resolves combat, so balance / odds / ranked-replay
 * determinism are untouched. Motion easing + camera shake use a clock/sin only
 * (no RNG) and never feed back into the sim.
 *
 * The fallback billboard texture is the pet's published battle art (via
 * petBattleSprite → sharedImages), or a procedural placeholder in the dev
 * harness. Model availability is gated by lib/pet-3d-models.ts.
 */

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "../styles/pet-skin.css";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, PerformanceMonitor, Sparkles } from "@react-three/drei";
import type { Pet } from "../types/pet";
import { PetBattleAvatar } from "./PetBattleAvatar";
import type { PetVisualState } from "../types/pet-battle";
import { elementVfxKey } from "../lib/pet-battle-anim";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { projectileVisual, type ProjectileVisual } from "../lib/pet-projectile-vfx";
import { beatTimeline, beatChoreoMs, lerp, groundedSpriteLayout, classifyMoveChoreo, moveChoreoMods, moveFxKey, meleeTrailSpec, meleeLungeReach, type MoveChoreoKind, type MoveChoreoMods } from "../lib/pet-coliseum-scene";
import { runPetDuel, runPetPartyDuel, DUEL_TPS, ARENA_X, ARENA_Y, type DuelResult, type DuelState, type DuelActorSnap } from "../lib/pet-duel-sim";
import { petVisualId } from "../data/pet-evolutions";
import { playPetSfx, primePetSfx } from "../lib/pet-sfx";
import { duckBattleMusic, isAudioMuted, setAudioMuted, setBattleMusicIntensity, startBattleMusic, stopBattleMusic, subscribeAudioMute } from "../lib/pet-music";
import { petCloseupPresentationModel, petCombatModel, type PetCombatModelProfile } from "../lib/pet-3d-models";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import { PetModelBoundary } from "./PetModelBoundary";
import { directPetDuelPresentation } from "../lib/pet-duel-stage-director";
import { commandedActorId } from "../lib/pet-duel-live";
import type { LiveDuel, DuelCommand } from "../lib/pet-duel-live";
import { bondCharge } from "../lib/pet-bond-meter";
import { PetDuelCommandDeck } from "./PetDuelCommandDeck";
import { PetDuelClashPrompt } from "./PetDuelClashPrompt";
import { PARTY_SPOTLIGHT_COOLDOWN_SECONDS, PET_DUEL_COMMAND_CATCHUP_SCALE, PET_DUEL_COMMAND_CATCHUP_SECONDS, PET_DUEL_NEUTRAL_PLAYBACK_SCALE, PET_OPENING_TACTICS, appendCapped, boundedBurstStep, duelAttackDashBeats, duelFinisherOutcome, duelHeroCutEligible, duelHeroCutEventIndexes, duelMoveOutcome, petDuelAttackRhythm, petDuelContactTiming, petDuelImpactStrength, precedingNamedMove, selectDuelSpotlightEvent } from "../lib/pet-duel-presentation";
import { PET_VISUAL_QUALITY_PRESETS, petVisualQuality, savePetVisualQuality, type PetVisualQuality, type PetVisualQualityConfig } from "../lib/pet-visual-quality";
import { PetRenderStatsProbe } from "./PetRenderStatsProbe";
import { PetGraphicsQualityControl } from "./PetGraphicsQualityControl";
import { petHeroMoveAt, petHeroMoveStyle, petHeroMoveWindows, type PetHeroMoveStyle } from "../lib/pet-hero-moves";
import { duelCameraComposition } from "../lib/pet-duel-camera";
import { petDuelModelCalibration } from "../lib/pet-duel-model-presentation";
import { resolvePetDuelVisualLayers } from "../lib/pet-duel-visual-layers";
import { petCombatFamilyPresentation } from "../lib/pet-combat-family";
import { petDisplayName } from "../lib/pet";
import { petDuelBroadcastRead, petDuelRecap } from "../lib/pet-duel-broadcast";
import { HOLLOW_HOUND_SURFACE } from "../lib/pet-model-surface";
import { petModelVariantSurface } from "../lib/pet-visual-variant";
import { resolveOpponentFacing } from "../lib/pet-combat-performance";
import { isHollowHoundEncounterPet } from "../../../shared/hollow-gate-contract";
import { petColiseumWeatherDurationTicks, petColiseumWeatherForMove, type PetColiseumWeather } from "../lib/pet-coliseum-weather";
import { type DuelClock, STRIKE_PULSE_S, TARGET_SPRITE_H, FLOOR_Y, FX_Y, type Vec3, CAM_LOOK, CAM_POS, type PetBattleSettlementStatus, COLISEUM_FLOOR_URL, COLISEUM_BG_URL, CAM_FOV, duelBtn, resultBtn } from "./pet-coliseum/stage";
import { usePetSprite, usePetPoses, type PoseCat, poseCategory, shadowTexture, elementColor, trailStreakTexture, projCrescentTexture, loadSceneTexture, posedId, poseUrl } from "./pet-coliseum/sprite-resources";
import { duelCmdFocus, duelCmdRush, duelFovKick, duelCmdKick, requestDuelCommandFocus, requestDuelCommandJolt, requestDuelCommandRush } from "./pet-coliseum/playback-state";
import { ProjectileBody, ResponsiveCamera, FxAnim, BloomFx } from "./pet-coliseum/stage-components";
import { Arena, DustPuff } from "./pet-coliseum/frame-battle";
export type { PetBattleSettlementStatus } from "./pet-coliseum/stage";
export type { PetColiseumProps } from "./pet-coliseum/frame-battle";
export { PetColiseum } from "./pet-coliseum/frame-battle";
export type { PetArenaMatchProps } from "./pet-coliseum/arena-match";
export { PetArenaMatch } from "./pet-coliseum/arena-match";
 // mid-body height for impacts / casts

function hollowHoundSurface(pet: Pick<Pet, "id" | "name">) {
    return isHollowHoundEncounterPet(pet)
        ? HOLLOW_HOUND_SURFACE
        : undefined;
}


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

const findActor = (snap: { actors: DuelActorSnap[] }, id: string) => snap.actors.find((a) => a.id === id);


// ── Grounded 3D-coliseum duel placement ──────────────────────────────────────
// The duel now plays INSIDE the round renderer's 3D Arena (curved wall + lit
// floor + perspective camera), so fighters STAND on the floor with real contact
// shadows instead of floating over a painted wall. Map the sim field (±ARENA_X,
// ±ARENA_Y) onto the floor plane (x = left↔right, z = depth toward/away camera);
// perspective + grounding then come from the scene, not a faked projection.
const DUEL_FLOOR_HALF_W = 7.2;
   // use more of the physical coliseum for crossfield runs
const DUEL_FLOOR_HALF_D = 4.25;
  // deeper lanes make cover wraps and re-entry angles readable
const DUEL_FLOOR_Z0 = -0.4;
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

/** Real seconds a player gets to call a CLASH before their pet answers on instinct.
 *  Independent of the sim's own bind window: playback is frozen while the prompt is
 *  up, so this is a human-comfort budget, not a simulation deadline. */
const CLASH_ANSWER_SECONDS = 3.5;

// ── Opening choreography (render-only) — a still ranged face-off and restrained
// power gather. Movement begins only when the combat simulation starts.
const INTRO_SPLASH_END = 1.05;
   // s — establish the matchup without delaying the first exchange
const INTRO_PAUSE_END = 1.18;
    // s — one clean still face-off before the gather
const INTRO_SIZEUP_END = 2.15;
   // s — readable power gather at the real starting positions
const INTRO_TOTAL = 2.35;
        // s — brief lock-in beat, then FIGHT
const INTRO_WIDE_DOLLY = 14.2;
   // camera pull-back distance for the wide size-up shot
const DUEL_CAMERA_Y = 5.15;
      // eye height — lower + closer than the old 5.75 so the pets read BIG, near-side-on, not a tiny top-down diorama
const DUEL_LOOK_Y = 0.9;

const introWideHold = (introSec: number): number => introSec < INTRO_TOTAL ? 1 : 0;

function duelFieldToFloor(fx: number, fy: number): { wx: number; wz: number } {
    return { wx: (fx / ARENA_X) * DUEL_FLOOR_HALF_W, wz: DUEL_FLOOR_Z0 + (fy / ARENA_Y) * DUEL_FLOOR_HALF_D };
}


/** One GROUNDED fighter on the 3D coliseum floor — a Y-locked billboard standing
 *  on the floor with a real contact shadow, driven by the interpolated duel tick
 *  stream + the anime strike choreography (ability-distinct strikes, recoil,
 *  status tints, KO topple). Same grounded rig as the round renderer's Standee. */
function DuelStandee({ duel, clock, id, pet, mirror, sharedImages, freeRoam3d, dashCue, showIdentity, acknowledgingCommand }: {
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
function DuelCutInModelPortrait({ pet, config, style, move, mirror }: {
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


/** Volumetric projectile used when both combatants are real models.  It is built
 * from solid toon cores, translucent energy shells and receding trail geometry,
 * so it belongs to the same lit 3D space as the pets instead of reading like a
 * flat icon pasted between them. */
function NativeProjectileBody({ visual, quality }: { visual: ProjectileVisual; quality: PetVisualQualityConfig }) {
    const root = useRef<THREE.Group>(null);
    const shell = useRef<THREE.Mesh>(null);
    const light = useRef<THREE.PointLight>(null);
    const trail = useRef<THREE.Group>(null);
    const key = visual.spriteKey ?? (visual.tex === "crescent" ? "wind" : visual.tex === "bolt" ? "lightning" : visual.tex === "rock" ? "earth" : "arcane");
    const flameHead = useMemo(() => key === "fire" ? makeFlamePetalGeometry(0.92, 0.28, 0.32) : null, [key]);
    const flameInner = useMemo(() => key === "fire" ? makeFlamePetalGeometry(0.68, 0.17, 0.2) : null, [key]);
    const lightningBolts = useMemo(() => key === "lightning" ? Array.from({ length: 3 }, (_, i) => makeElementVolumeCurve("lightning", i, "contact")) : [], [key]);
    const energyTrails = useMemo(() => key === "earth" ? [] : Array.from({ length: 3 }, (_, i) => makeFlameRibbonGeometry(
        0.9 - i * 0.14,
        0.07 - i * 0.01,
        0.18 + i * 0.04,
        i * 1.7,
    )), [key]);
    useEffect(() => () => {
        flameHead?.dispose();
        flameInner?.dispose();
        lightningBolts.forEach((geometry) => geometry.dispose());
        energyTrails.forEach((geometry) => geometry.dispose());
    }, [energyTrails, flameHead, flameInner, lightningBolts]);
    const coreColor = key === "fire" ? "#ff5a18" : key === "water" ? "#168fda" : key === "wind" ? "#49cdb7" : key === "earth" ? "#9a5a2d" : key === "lightning" ? "#8d63ff" : visual.core;
    const edgeColor = key === "fire" ? "#ffd65a" : key === "water" ? "#52cbe0" : key === "wind" ? "#73dfc4" : key === "earth" ? "#e8ad5d" : key === "lightning" ? "#fff6a9" : visual.glow;
    useFrame((state) => {
        const t = state.clock.elapsedTime;
        const pulse = 1 + Math.sin(t * (key === "lightning" ? 34 : 15)) * (key === "earth" ? 0.035 : 0.075);
        if (root.current) {
            root.current.scale.setScalar((visual.charged ? 1.28 : 1) * pulse);
            root.current.rotation.x = key === "earth" ? t * 4.2 : Math.sin(t * 7) * 0.12;
        }
        if (shell.current) {
            shell.current.rotation.x = t * 2.1;
            shell.current.rotation.y = t * (key === "wind" ? 8 : 3.4);
            shell.current.scale.setScalar(1.05 + Math.sin(t * 18) * 0.06);
        }
        if (trail.current) trail.current.rotation.x = Math.sin(t * 9) * 0.16;
        if (light.current) light.current.intensity = (visual.charged ? 3.8 : 2.3) + Math.abs(Math.sin(t * 21)) * 0.9;
    });
    const energyLayer = (opacity: number, color = edgeColor) => (
        <meshToonMaterial color={color} emissive={color} emissiveIntensity={0.16} transparent opacity={Math.min(0.92, opacity * 1.45)} depthWrite={false} side={THREE.DoubleSide} />
    );
    return (
        <group ref={root} scale={visual.size * 1.55}>
            {/* Solid identity core. */}
            {key === "earth" ? (
                <group rotation={[0.18, -0.32, 0.12]}>
                    <mesh castShadow scale={[1.22, 0.88, 1]}><icosahedronGeometry args={[0.34, 1]} /><meshToonMaterial color={coreColor} emissive="#2b1309" emissiveIntensity={0.08} /></mesh>
                    <mesh position={[-0.18, 0.2, 0.2]} rotation={[0.6, 0.2, -0.4]} scale={0.34}><icosahedronGeometry args={[0.34, 1]} /><meshToonMaterial color="#c27a3c" emissive="#2b1309" emissiveIntensity={0.06} /></mesh>
                    <mesh position={[0.15, -0.18, -0.18]} rotation={[-0.5, 0.7, 0.2]} scale={0.27}><icosahedronGeometry args={[0.34, 1]} /><meshToonMaterial color="#704128" emissive="#2b1309" emissiveIntensity={0.05} /></mesh>
                </group>
            ) : key === "water" ? (
                <group position={[-0.08, 0, 0]}>
                    <mesh scale={[1.38, 0.64, 0.64]} castShadow><sphereGeometry args={[0.36, 22, 14]} /><meshToonMaterial color="#075f9b" emissive="#042b55" emissiveIntensity={0.06} /></mesh>
                    <mesh position={[0.09, 0.03, 0.03]} scale={[1.08, 0.46, 0.46]}><sphereGeometry args={[0.34, 20, 12]} /><meshToonMaterial color={coreColor} emissive="#21c7e6" emissiveIntensity={0.1} transparent opacity={0.88} depthWrite={false} /></mesh>
                    <mesh position={[-0.47, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.78, 1.1, 0.78]}><coneGeometry args={[0.25, 0.72, 14]} /><meshToonMaterial color="#075f9b" emissive="#042b55" emissiveIntensity={0.05} /></mesh>
                    <mesh position={[0.03, 0, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[0.31, 0.043, 8, 30, Math.PI * 1.62]} /><meshToonMaterial color={edgeColor} emissive={coreColor} emissiveIntensity={0.1} transparent opacity={0.74} depthWrite={false} /></mesh>
                    <mesh position={[-0.24, 0.02, 0]} rotation={[0, Math.PI / 2, 0.64]} scale={0.72}><torusGeometry args={[0.31, 0.035, 8, 26, Math.PI * 1.38]} /><meshToonMaterial color="#d8fbff" transparent opacity={0.58} depthWrite={false} /></mesh>
                </group>
            ) : key === "fire" && flameHead && flameInner ? (
                <group position={[-0.28, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                    <mesh geometry={flameHead} rotation={[0, 0, 0.12]}>
                        <meshToonMaterial color="#e63712" emissive="#7f1308" emissiveIntensity={0.32} transparent opacity={0.94} depthWrite={false} />
                    </mesh>
                    <mesh geometry={flameInner} position={[0, 0.05, 0.025]} rotation={[0, 0.18, -0.08]}>
                        <meshToonMaterial color="#ffd957" emissive="#ff6318" emissiveIntensity={0.58} transparent opacity={0.92} depthWrite={false} />
                    </mesh>
                </group>
            ) : key === "wind" ? (
                <group>
                    <mesh rotation={[Math.PI / 2, 0, 0.36]}><torusGeometry args={[0.34, 0.085, 8, 28, Math.PI * 1.32]} /><meshToonMaterial color={coreColor} emissive="#0c4e48" emissiveIntensity={0.18} transparent opacity={0.88} depthWrite={false} /></mesh>
                    <mesh rotation={[-Math.PI / 2, 0, -0.38]} scale={0.74}><torusGeometry args={[0.34, 0.065, 8, 24, Math.PI * 1.16]} /><meshToonMaterial color={edgeColor} transparent opacity={0.74} depthWrite={false} /></mesh>
                </group>
            ) : key === "lightning" ? (
                <group rotation={[0, 0, -Math.PI / 2]} scale={0.5} position={[-0.15, 0, 0]}>
                    {lightningBolts.map((geometry, i) => (
                        <mesh key={i} geometry={geometry} rotation={[i * 0.18, i * 0.42, i * 0.22]}>
                            <meshToonMaterial color={i === 0 ? edgeColor : coreColor} emissive={edgeColor} emissiveIntensity={0.24} transparent opacity={i === 0 ? 0.96 : 0.72} depthWrite={false} />
                        </mesh>
                    ))}
                </group>
            ) : (
                <mesh scale={[1.18, 0.88, 0.88]}><icosahedronGeometry args={[0.36, 1]} /><meshToonMaterial color={coreColor} emissive={edgeColor} emissiveIntensity={key === "fire" ? 0.48 : 0.28} /></mesh>
            )}

            {/* Energy envelope catches the silhouette without whitening the core. */}
            <mesh ref={shell} scale={key === "wind" ? 1.35 : 1.15}>
                {key === "wind" ? <torusGeometry args={[0.34, 0.045, 7, 30, Math.PI * 1.7]} /> : key === "water" ? <torusGeometry args={[0.38, 0.055, 8, 30, Math.PI * 1.78]} /> : <sphereGeometry args={[0.43, 20, 12]} />}
                {energyLayer(key === "earth" ? 0.12 : key === "water" ? 0.18 : 0.26)}
            </mesh>

            {/* Receding volumes give real travel direction and speed. */}
            <group ref={trail}>
                {[0, 1, 2].map((i) => key === "earth" ? (
                    <mesh key={i} position={[-0.5 - i * 0.28, (i - 1) * 0.1, (i % 2 ? -1 : 1) * 0.11]} scale={0.13 - i * 0.02} rotation={[i, i * 0.8, 0]}><dodecahedronGeometry args={[1, 0]} /><meshToonMaterial color={i ? "#6f3d22" : edgeColor} /></mesh>
                ) : (
                    <mesh key={i} geometry={energyTrails[i]} position={[-0.42 - i * 0.18, (i - 1) * 0.11, (i % 2 ? -1 : 1) * 0.09]} rotation={[0, i * 0.42, -Math.PI / 2]} scale={[0.8 - i * 0.12, 0.78 - i * 0.1, 0.78 - i * 0.1]}>
                        {energyLayer(0.4 - i * 0.1, i === 0 ? edgeColor : coreColor)}
                    </mesh>
                ))}
            </group>
            {quality.dynamicPetLight && <pointLight ref={light} color={edgeColor} intensity={2.4} distance={visual.charged ? 5.4 : 3.8} decay={2} />}
        </group>
    );
}


/** One in-flight projectile — an element-distinct flying attack (fireball /
 *  water ball / wind cut / rock throw / lightning bolt) that points where it's
 *  going. Driven by the sim's homing projectile in `snapshots[t].projectiles`. */
function DuelCommandFocusMarker({ duel, clock }: { duel: DuelResult; clock: { current: DuelClock } }) {
    const group = useRef<THREE.Group>(null);
    const material = useRef<THREE.MeshBasicMaterial>(null);
    useFrame((state) => {
        const root = group.current;
        if (!root) return;
        const remaining = duelCmdFocus.expiresAt - performance.now();
        if (remaining <= 0 || !duelCmdFocus.targetId) {
            root.visible = false;
            return;
        }
        const tick = Math.max(0, Math.min(duel.snapshots.length - 1, Math.floor(clock.current.t)));
        const target = findActor(duel.snapshots[tick], duelCmdFocus.targetId);
        if (!target || target.hp <= 0) {
            root.visible = false;
            return;
        }
        const floor = duelFieldToFloor(target.x, target.y);
        const pulse = 1 + Math.sin(state.clock.elapsedTime * 15) * 0.075;
        root.visible = true;
        root.position.set(floor.wx, FLOOR_Y + 0.055, floor.wz);
        root.scale.setScalar(pulse);
        if (material.current) {
            material.current.color.set(duelCmdFocus.color);
            material.current.opacity = Math.min(0.82, remaining / 260);
        }
    });
    return (
        <group ref={group} visible={false}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.88, 0.038, 8, 48]} />
                <meshBasicMaterial ref={material} color="#fbbf24" transparent opacity={0.72} depthWrite={false} toneMapped={false} />
            </mesh>
            {[
                [0, 0, -1.03, 0],
                [0, 0, 1.03, 0],
                [-1.03, 0, 0, Math.PI / 2],
                [1.03, 0, 0, Math.PI / 2],
            ].map(([x, y, z, rotation], index) => (
                <mesh key={index} position={[x, y + 0.018, z]} rotation={[0, rotation, 0]}>
                    <boxGeometry args={[0.32, 0.035, 0.055]} />
                    <meshBasicMaterial color="#fff7d6" transparent opacity={0.88} depthWrite={false} toneMapped={false} />
                </mesh>
            ))}
        </group>
    );
}


function DuelProjectile({ index, duel, clock, quality, native = false }: { index: number; duel: DuelResult; clock: { current: DuelClock }; quality: PetVisualQualityConfig; native?: boolean }) {
    const grp = useRef<THREE.Group>(null);
    const inner = useRef<THREE.Group>(null);
    const curId = useRef<number | null>(null);
    const lastAngle = useRef(0);
    const [visual, setVisual] = useState<ProjectileVisual>(() => projectileVisual({ element: null }));
    useFrame(() => {
        const g = grp.current;
        if (!g) return;
        const snaps = duel.snapshots;
        const tf = Math.max(0, Math.min(snaps.length - 1, clock.current.t));
        const i0 = Math.floor(tf), i1 = Math.min(snaps.length - 1, i0 + 1), f = tf - i0;
        const pr = snaps[i0].projectiles[index];
        if (!pr) { g.visible = false; curId.current = null; return; }
        const nxt = snaps[i1].projectiles.find((q) => q.id === pr.id);
        // A new bolt took this slot → reselect its element-distinct look.
        if (pr.id !== curId.current) {
            curId.current = pr.id;
            setVisual(projectileVisual({ element: pr.element, kind: pr.kind, charged: pr.kind === "crush" }));
        }
        g.visible = true;
        const sx = nxt ? lerp(pr.x, nxt.x, f) : pr.x;
        const sy = nxt ? lerp(pr.y, nxt.y, f) : pr.y;
        const pp = duelFieldToFloor(sx, sy);
        g.position.set(pp.wx, FX_Y, pp.wz);
        // Point the head along its travel direction, projected into the screen plane.
        if (nxt) {
            const p1 = duelFieldToFloor(nxt.x, nxt.y);
            const dxw = p1.wx - pp.wx, dzw = p1.wz - pp.wz;
            if (dxw * dxw + dzw * dzw > 1e-5) lastAngle.current = Math.atan2(-dzw, dxw);
        }
        if (inner.current) {
            if (native) inner.current.rotation.y = lastAngle.current;
            else inner.current.rotation.z = lastAngle.current;
        }
    });
    if (native) return (
        <group ref={grp} visible={false}>
            <group ref={inner}><NativeProjectileBody visual={visual} quality={quality} /></group>
        </group>
    );
    return (
        <group ref={grp} visible={false}>
            <Billboard lockX lockZ>
                <group ref={inner}>
                    <ProjectileBody visual={visual} />
                </group>
            </Billboard>
        </group>
    );
}


/** Playback driver: advances the shared clock (with HIT-STOP on impact), spawns
 *  damage numbers + impact bursts + elemental VFX as the clock crosses events,
 *  nudges the fixed stage camera for screen-shake, and fires onEnd once. */
type DuelSetPieceKind = "flameBurst" | "abyssBurst" | "tidalWave" | "tornado" | "lightningStorm" | "earthBurst" | "lunarBurst" | "elemental";

type DuelElementBurstKind = "fire" | "water" | "wind" | "lightning" | "earth" | "abyss" | "arcane";

type DuelMoveCalloutTone = "attack" | "support" | "maneuver" | "combo";

/** The move banner's visual grammar, keyed by what the move DOES.
 *
 *  This used to be keyed by side — blue for your pet, red for theirs — which meant a
 *  heal, a shield, a sidestep and a fireball were the same banner with different
 *  words. Owner feedback was exactly that: "you can't tell what is a buff or an
 *  attack". Colour and glyph now carry the category, so one glance classifies the
 *  beat; the actor's name carries the side. */
const MOVE_CALLOUT_STYLE: Record<DuelMoveCalloutTone, { color: string; text: string; glyph: string; label: string }> = {
    attack: { color: "#fbbf24", text: "#fef3c7", glyph: "⚔", label: "" },
    support: { color: "#34d399", text: "#d1fae5", glyph: "▲", label: "POWER UP ·" },
    maneuver: { color: "#a78bfa", text: "#ede9fe", glyph: "↷", label: "SHIFT ·" },
    combo: { color: "#f472b6", text: "#fce7f3", glyph: "✦", label: "COMBO ·" },
};

type DuelImpactMode = "impact" | "tell" | "dodge";

type DuelSupportKind = "heal" | "shield";

type DuelAttackWeight = "basic" | "ability" | "heavy";

type DuelDashCue = {
    id: number;
    actorId?: string;
    from: Vec3;
    to: Vec3;
    /** The attacker lands at `to`; damage and the contact burst resolve on the
     * defender at `impactAt`. Keeping these separate prevents a safe body gap
     * from turning a successful hit into VFX that visibly detonates in empty air. */
    impactAt: Vec3;
    color: string;
    kind: DuelElementBurstKind;
    move?: string;
    style: PetHeroMoveStyle;
    impact: boolean;
    createdAt: number;
    duration: number;
    travelDuration: number;
    /** Simulation-clock ownership keeps the model, trail and contact on one
     * timeline instead of skipping travel frames during a slow render. */
    startTick: number;
    contactTick: number;
    endTick: number;
    /** Signed lateral bow plus a smaller counter-sweep. Both return to zero at contact. */
    bend: number;
    weave: number;
};

function dashCueTravelProgress(cue: Pick<DuelDashCue, "startTick" | "contactTick">, tick: number): number {
    return Math.min(1, Math.max(0, (tick - cue.startTick) / Math.max(1, cue.contactTick - cue.startTick)));
}

type DuelPressureCue = { id: number; from: Vec3; to: Vec3; leftColor: string; rightColor: string; leftKind: DuelElementBurstKind; rightKind: DuelElementBurstKind };

type DuelWeatherCue = {
    id: number;
    weather: PetColiseumWeather;
    actorId: string;
    move: string;
    startTick: number;
    endTick: number;
};

function dashTravelEase(progress: number): number {
    const p = Math.min(1, Math.max(0, progress));
    // Cubic smoothstep keeps the burst fast but spreads its displacement across
    // more visible frames than the old quadratic ease, whose steep midpoint read
    // like a teleport at 50-60 fps.
    return p * p * (3 - 2 * p);
}

function dashPathPoint(cue: Pick<DuelDashCue, "from" | "to" | "bend" | "weave" | "impact">, progress: number, y = FLOOR_Y): Vec3 {
    const p = dashTravelEase(progress);
    const dx = cue.to[0] - cue.from[0], dz = cue.to[2] - cue.from[2];
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const sideX = -dz / length, sideZ = dx / length;
    // The first sine bows into a lane; the second crosses that lane once, creating
    // an authored anime S-step rather than random locomotion noise. Both are zero
    // at launch/contact, so the deterministic simulation endpoints stay exact.
    const lateral = Math.sin(Math.PI * p) * cue.bend + Math.sin(Math.PI * 2 * p) * cue.weave;
    const hop = Math.sin(Math.PI * p) * (cue.impact ? 0.3 : 0.42);
    return [
        lerp(cue.from[0], cue.to[0], p) + sideX * lateral,
        y + hop,
        lerp(cue.from[2], cue.to[2], p) + sideZ * lateral,
    ];
}

type DuelFxPalette = { dark: string; body: string; accent: string; core: string };

function duelFxPalette(kind: DuelElementBurstKind, fallback: string): DuelFxPalette {
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
function makeAnimeStrokeGeometry(length: number, width: number, curl: number, jagged = 0): THREE.ExtrudeGeometry {
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


function makeDashRibbonGeometry(cue: DuelDashCue, bodyY: number, halfHeight: number, lateralOffset = 0): THREE.BufferGeometry {
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
function makeDashContactGeometry(cue: DuelDashCue, radius: number, lateral = 0): THREE.TubeGeometry {
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

function duelElementBurstKind(element?: string | null, move?: string): DuelElementBurstKind {
    const name = String(move ?? "").toLowerCase();
    // Some pets deliberately subvert their roster element. The Oni Hound is an
    // Earth-slot assassin, but a move named Hellhound Execution should erupt in
    // abyssal hellfire instead of throwing generic tan rocks at the opponent.
    if (/hell|oni|abyss|demon|soul|corruption/.test(name)) return "abyss";
    // Move identity takes precedence over the roster element. Eclipse Kitsune is
    // catalogued as Wind, but a lunar signature should carry the same violet,
    // celestial language through anticipation, dash trail and contact payoff.
    if (/lunar|eclipse|moon|ninetail|kitsune/.test(name)) return "arcane";
    const key = String(element ?? "").toLowerCase();
    if (key === "fire" || key === "water" || key === "wind" || key === "lightning" || key === "earth") return key;
    return "arcane";
}

function liveDuelEffectPosition(duel: DuelResult, clock: { current: DuelClock }, actorId?: string): { wx: number; wz: number } | null {
    if (!actorId || duel.snapshots.length === 0) return null;
    const snapshot = duel.snapshots[Math.min(duel.snapshots.length - 1, Math.max(0, Math.floor(clock.current.t)))];
    const actor = snapshot?.actors.find((candidate) => candidate.id === actorId);
    return actor ? duelFieldToFloor(actor.x, actor.y) : null;
}

function duelSetPieceKind(element?: string | null, move?: string): DuelSetPieceKind {
    const name = String(move ?? "").toLowerCase();
    if (/hell|oni|abyss|demon|soul|corruption/.test(name)) return "abyssBurst";
    if (/lunar|eclipse|moon|ninetail|kitsune/.test(name)) return "lunarBurst";
    if (/tidal|wave|tsunami|torrent|undertow/.test(name) || element === "Water") return "tidalWave";
    if (/tornado|cyclone|tempest|gale|vortex/.test(name) || element === "Wind") return "tornado";
    if (/flame|fire|inferno|blaze|cinder|burst/.test(name) || element === "Fire") return "flameBurst";
    if (/lightning|thunder|volt|storm|static/.test(name) || element === "Lightning") return "lightningStorm";
    if (/earth|stone|rock|quake|cataclysm/.test(name) || element === "Earth") return "earthBurst";
    return "elemental";
}

function arenaScaleMove(move?: string): boolean {
    // Do not promote ordinary attacks just because an elemental word appears in
    // the pet's prefixed move name (for example "Tempest Hawk Force Pulse").
    // Ultimate events already receive a set piece; this gate is only for the few
    // explicitly arena-scale named attacks that arrive through a regular hit.
    return /\b(tidal wave|tsunami|maelstrom|tornado|cyclone|flame burst|inferno|eruption|cataclysm|thunderstorm|hellhound execution|hellgate|soul devour)\b/i.test(String(move ?? ""));
}


function duelSetPieceTiming(kind: DuelSetPieceKind): { durationSec: number; contactDelayMs: number } {
    if (kind === "tidalWave") return { durationSec: 1.95, contactDelayMs: 560 };
    if (kind === "tornado") return { durationSec: 2.05, contactDelayMs: 280 };
    if (kind === "lunarBurst") return { durationSec: 1.86, contactDelayMs: 230 };
    return { durationSec: 1.86, contactDelayMs: 180 };
}


function weatherHash(index: number, salt: number): number {
    const n = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return n - Math.floor(n);
}


function weatherCycle(value: number): number {
    return ((value % 1) + 1) % 1;
}


function makeWeatherBoltGeometry(index: number): THREE.TubeGeometry {
    const points = Array.from({ length: 9 }, (_, point) => {
        const u = point / 8;
        const fork = point === 0 || point === 8 ? 0 : (weatherHash(index * 11 + point, 9) - 0.5) * (0.72 - Math.abs(u - 0.5) * 0.44);
        return new THREE.Vector3(
            (index - 1) * 4.4 + fork,
            7.4 - u * (5.4 + index * 0.35),
            -3.5 + index * 1.7 + (weatherHash(point, index + 4) - 0.5) * 0.42,
        );
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.026 + index * 0.005, 5, false);
}


/** Arena-wide climate volume. Unlike a contact burst, this owns the sky, fog,
 * light, floor and airborne particles for a full combat phrase. It reads only
 * the replay clock and never changes simulation state or elemental damage. */
function DuelBattlefieldWeather({ cue, clock, quality, onDone }: {
    cue: DuelWeatherCue;
    clock: { current: DuelClock };
    quality: PetVisualQualityConfig;
    onDone: () => void;
}) {
    const weatherFog = useRef<THREE.Fog>(null);
    const particleMesh = useRef<THREE.InstancedMesh>(null);
    const particleMat = useRef<THREE.MeshBasicMaterial>(null);
    const cloudRoot = useRef<THREE.Group>(null);
    const cloudMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const skyMat = useRef<THREE.MeshBasicMaterial>(null);
    const floorMat = useRef<THREE.MeshBasicMaterial>(null);
    const weatherLight = useRef<THREE.DirectionalLight>(null);
    const flashLight = useRef<THREE.PointLight>(null);
    const boltMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const eclipse = useRef<THREE.Group>(null);
    const eclipseMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const completed = useRef(false);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const { kind, color, fog, particle } = cue.weather;
    const count = quality.id === "low" ? 28 : quality.id === "medium" ? 58 : 92;
    // Hashing is deterministic but needlessly expensive when repeated for every
    // particle on every frame. Cache the authored distribution once per quality
    // tier so the weather budget is spent on motion, not pseudo-random setup.
    const particleSeeds = useMemo(() => Array.from({ length: count }, (_, index) => ({
        x: weatherHash(index, 1),
        z: weatherHash(index, 2),
        phase: weatherHash(index, 3),
        variance: weatherHash(index, 7),
    })), [count]);
    const neutralFogColor = useMemo(() => new THREE.Color("#2a1c10"), []);
    const weatherFogColor = useMemo(() => new THREE.Color(fog), [fog]);
    const particleGeometry = useMemo<THREE.BufferGeometry>(() => {
        if (kind === "thunderstorm" || kind === "downpour") return new THREE.BoxGeometry(kind === "downpour" ? 0.025 : 0.018, kind === "downpour" ? 0.62 : 0.46, 0.018);
        if (kind === "gale") return new THREE.TorusGeometry(0.16, 0.026, 4, 10, Math.PI * 1.25);
        if (kind === "firestorm") return new THREE.ConeGeometry(0.075, 0.34, 5);
        if (kind === "blizzard") return new THREE.OctahedronGeometry(0.09, 0);
        return new THREE.IcosahedronGeometry(0.065, 0);
    }, [kind]);
    const bolts = useMemo(() => kind === "thunderstorm" ? [0, 1, 2].map(makeWeatherBoltGeometry) : [], [kind]);
    useEffect(() => () => {
        particleGeometry.dispose();
        bolts.forEach((geometry) => geometry.dispose());
    }, [bolts, particleGeometry]);
    useEffect(() => {
        const mesh = particleMesh.current;
        if (!mesh) return;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const base = new THREE.Color(particle);
        for (let index = 0; index < count; index++) {
            const tint = index % 5 === 0 ? base.clone().lerp(new THREE.Color("#ffffff"), 0.72) : base;
            mesh.setColorAt(index, tint);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, [count, particle]);
    useFrame((state) => {
        const tick = clock.current.t;
        const age = tick - cue.startTick;
        const remaining = cue.endTick - tick;
        const enter = Math.max(0, Math.min(1, age / Math.max(1, DUEL_TPS * 0.7)));
        const leave = Math.max(0, Math.min(1, remaining / Math.max(1, DUEL_TPS * 1.05)));
        const strength = Math.min(enter * enter * (3 - 2 * enter), leave * leave * (3 - 2 * leave));
        const elapsed = state.clock.elapsedTime;
        const stormPulse = kind === "thunderstorm"
            ? Math.pow(Math.max(0, Math.sin(elapsed * 1.73 + 0.8) + Math.sin(elapsed * 0.47) * 0.42 - 0.82) / 0.6, 2)
            : 0;
        const mesh = particleMesh.current;
        if (mesh) for (let index = 0; index < count; index++) {
            const seed = particleSeeds[index];
            const hx = seed.x, hz = seed.z, hs = seed.phase;
            if (kind === "thunderstorm" || kind === "downpour") {
                const fall = weatherCycle(hs - elapsed * (kind === "downpour" ? 0.62 : 0.48) * (0.72 + seed.variance * 0.48));
                dummy.position.set((hx - 0.5) * 23 + elapsed * (kind === "downpour" ? -0.9 : -0.42), 0.22 + fall * 9.2, (hz - 0.5) * 15 - 1.6);
                dummy.rotation.set(0, 0, kind === "downpour" ? -0.24 : -0.12);
                dummy.scale.set(0.72 + hs * 0.55, 0.72 + hs * 0.78, 0.72 + hs * 0.55);
            } else if (kind === "gale") {
                const radius = 1.8 + hx * 9.2;
                const angle = hz * Math.PI * 2 + elapsed * (0.72 + hs * 0.58) + Math.sin(elapsed * 0.7 + index) * 0.18;
                dummy.position.set(Math.cos(angle) * radius, 0.35 + weatherCycle(hs + elapsed * 0.12) * 5.6, -1.5 + Math.sin(angle) * radius * 0.58);
                dummy.rotation.set(Math.PI / 2, -angle, angle * 0.24);
                dummy.scale.setScalar(0.68 + hs * 0.72);
            } else if (kind === "firestorm") {
                const rising = weatherCycle(hs + elapsed * (0.18 + hz * 0.2));
                const drift = Math.sin(elapsed * 1.7 + index * 1.91);
                dummy.position.set((hx - 0.5) * 22 + drift * 0.8, 0.16 + rising * 7.3, (hz - 0.5) * 14 - 1.1);
                dummy.rotation.set(index * 0.7, elapsed * (1.2 + hs), drift * 0.32);
                dummy.scale.setScalar(0.62 + hs * 1.12);
            } else if (kind === "blizzard") {
                const fall = weatherCycle(hs - elapsed * (0.12 + hz * 0.1));
                const drift = elapsed * 1.8 + index * 0.77;
                dummy.position.set((hx - 0.5) * 23 + Math.sin(drift) * 1.3, 0.2 + fall * 8.4, (hz - 0.5) * 15 - 1.3 + Math.cos(drift * 0.72) * 0.9);
                dummy.rotation.set(drift * 0.5, drift, -drift * 0.32);
                dummy.scale.setScalar(0.58 + hs * 0.92);
            } else {
                const radius = 1.8 + hx * 9.5;
                const angle = hz * Math.PI * 2 + elapsed * (0.18 + hs * 0.18);
                dummy.position.set(Math.cos(angle) * radius, 0.5 + weatherCycle(hs + elapsed * 0.055) * 6.6, -1.6 + Math.sin(angle) * radius * 0.62);
                dummy.rotation.set(angle, -angle * 0.7, elapsed + index);
                dummy.scale.setScalar(0.56 + hs * 0.88);
            }
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
        }
        if (mesh) mesh.instanceMatrix.needsUpdate = true;
        if (particleMat.current) particleMat.current.opacity = strength * (kind === "downpour" ? 0.66 : kind === "blizzard" ? 0.82 : 0.72);
        if (cloudRoot.current) {
            cloudRoot.current.visible = strength > 0.002;
            cloudRoot.current.rotation.y = elapsed * (kind === "gale" ? 0.085 : 0.018);
            cloudRoot.current.position.x = Math.sin(elapsed * 0.18) * (kind === "gale" ? 1.2 : 0.35);
        }
        cloudMats.current.forEach((material, index) => {
            if (material) material.opacity = strength * (kind === "blizzard" ? 0.28 : kind === "eclipse" ? 0.42 : 0.56) * (0.84 + (index % 3) * 0.08);
        });
        if (skyMat.current) skyMat.current.opacity = strength * (kind === "blizzard" ? 0.17 : kind === "gale" ? 0.24 : 0.42);
        if (floorMat.current) floorMat.current.opacity = strength * (kind === "blizzard" ? 0.22 : kind === "downpour" ? 0.2 : 0.12);
        if (weatherLight.current) weatherLight.current.intensity = strength * (kind === "blizzard" ? 1.2 : 0.76) + stormPulse * strength * 2.8;
        if (flashLight.current) flashLight.current.intensity = stormPulse * strength * 12;
        boltMats.current.forEach((material, index) => {
            if (material) material.opacity = strength * stormPulse * (index === 1 ? 0.96 : 0.54);
        });
        if (eclipse.current) {
            eclipse.current.rotation.z = elapsed * -0.035;
            eclipse.current.scale.setScalar((0.88 + strength * 0.12) * (0.98 + Math.sin(elapsed * 1.5) * 0.025));
            eclipse.current.visible = strength > 0.002;
        }
        eclipseMats.current.forEach((material) => {
            if (material) material.opacity = strength * Number(material.userData.baseOpacity ?? 0);
        });
        const liveFog = weatherFog.current;
        if (liveFog) {
            liveFog.color.copy(neutralFogColor).lerp(weatherFogColor, strength * (kind === "blizzard" ? 0.72 : 0.86));
            liveFog.near = lerp(26, kind === "blizzard" ? 9 : kind === "downpour" ? 13 : 16, strength);
            liveFog.far = lerp(54, kind === "blizzard" ? 31 : kind === "downpour" ? 37 : 42, strength);
        }
        if (tick > cue.endTick + 2 && !completed.current) {
            completed.current = true;
            onDone();
        }
    });

    const canopyColor = kind === "blizzard" ? "#b9d5e7" : kind === "firestorm" ? "#26100b" : kind === "eclipse" ? "#130d22" : "#111827";
    return (
        <>
            <fog ref={weatherFog} attach="fog" args={["#2a1c10", 26, 54]} />
            <group>
            <mesh scale={34} renderOrder={-6}>
                <sphereGeometry args={[1, 24, 14]} />
                <meshBasicMaterial ref={skyMat} color={fog} transparent opacity={0} depthWrite={false} side={THREE.BackSide} />
            </mesh>
            <group ref={cloudRoot} position={[0, 7.2, -2]}>
                {Array.from({ length: quality.id === "low" ? 6 : 10 }, (_, index) => {
                    const angle = index * 2.399;
                    const radius = 2.2 + (index % 4) * 2.45;
                    return (
                        <mesh key={`weather-cloud-${index}`} position={[Math.cos(angle) * radius, (index % 3) * 0.32, Math.sin(angle) * radius * 0.58]} scale={[3.2 + (index % 3) * 0.8, 0.52 + (index % 2) * 0.18, 2.1 + (index % 4) * 0.38]}>
                            <dodecahedronGeometry args={[1, 1]} />
                            <meshBasicMaterial ref={(material) => { cloudMats.current[index] = material; }} color={canopyColor} transparent opacity={0} depthWrite={false} />
                        </mesh>
                    );
                })}
            </group>
            <mesh position={[0, FLOOR_Y + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-3}>
                <circleGeometry args={[22, 64]} />
                <meshBasicMaterial ref={floorMat} color={color} transparent opacity={0} depthWrite={false} blending={THREE.NormalBlending} />
            </mesh>
            <instancedMesh ref={particleMesh} args={[particleGeometry, undefined, count]} frustumCulled={false} renderOrder={24}>
                <meshBasicMaterial ref={particleMat} color="#ffffff" vertexColors transparent opacity={0} depthWrite={false} toneMapped={false} />
            </instancedMesh>
            {bolts.map((geometry, index) => (
                <mesh key={`weather-bolt-${index}`} geometry={geometry} renderOrder={25}>
                    <meshBasicMaterial ref={(material) => { boltMats.current[index] = material; }} color={index === 1 ? "#ffffff" : "#bca9ff"} transparent opacity={0} depthWrite={false} toneMapped={false} />
                </mesh>
            ))}
            {kind === "eclipse" && (
                <Billboard position={[0, 6.8, -12]}>
                    <group ref={eclipse} visible={false}>
                        {/* Layered corona: a low, broad aura behind the occluding
                            disc, two hot rims, and sparse radial prominences. */}
                        <mesh position={[0, 0, -0.06]}>
                            <circleGeometry args={[2.82, 64]} />
                            <meshBasicMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.14; eclipseMats.current[0] = material; } }} color="#7658d9" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                        </mesh>
                        <mesh position={[0, 0, -0.045]}>
                            <ringGeometry args={[2.08, 2.62, 72]} />
                            <meshBasicMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.28; eclipseMats.current[1] = material; } }} color="#9c7cff" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                        </mesh>
                        {Array.from({ length: 8 }, (_, index) => {
                            const angle = index * Math.PI / 4;
                            return (
                                <mesh key={`eclipse-ray-${index}`} position={[Math.cos(angle) * 2.72, Math.sin(angle) * 2.72, -0.07]} rotation={[0, 0, Math.PI / 2 - angle]} scale={[1, 0.72 + (index % 3) * 0.2, 1]}>
                                    <planeGeometry args={[0.13 + (index % 2) * 0.035, 1.05]} />
                                    <meshBasicMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.11 + (index % 3) * 0.025; eclipseMats.current[4 + index] = material; } }} color={index % 2 ? "#c9b6ff" : "#8768ee"} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                                </mesh>
                            );
                        })}
                        <mesh>
                            <circleGeometry args={[2.08, 64]} />
                            <meshBasicMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.985; eclipseMats.current[2] = material; } }} color="#08060d" transparent opacity={0} toneMapped={false} />
                        </mesh>
                        <mesh position={[0, 0, -0.02]}>
                            <ringGeometry args={[2.1, 2.28, 72]} />
                            <meshBasicMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.92; eclipseMats.current[3] = material; } }} color="#d4c5ff" transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                        </mesh>
                    </group>
                </Billboard>
            )}
            <directionalLight ref={weatherLight} position={[-5, 9, 2]} color={kind === "blizzard" ? "#e5f5ff" : color} intensity={0} />
            <pointLight ref={flashLight} position={[0, 7, -1]} color="#dcd7ff" intensity={0} distance={28} decay={1.4} />
            </group>
        </>
    );
}


function DuelDirector({ duel, clock, advanceClock, onEnd, canEnd = true, spawnNumber, spawnImpact, spawnElementBurst, spawnAftermath, spawnFx, spawnSupport, spawnShock, spawnDust, spawnScorch, spawnPowerUp, spawnTrail, spawnDash, spawnPressure, spawnSetPiece, elementById, nameById, speciesNameById, petIdById, profileById, ultById, heroMoveById, onCutIn, onFlash, onCallout, onCombo, onAnnounce, onMoveCallout, onWeather, onClashResult, onFinisher }: {
    duel: DuelResult; clock: { current: DuelClock }; advanceClock: (maxT: number, delta: number) => void;
    onEnd: () => void;
    /** False while a live duel is still simulating — see the end check below. */
    canEnd?: boolean;
    spawnNumber: (n: { x: number; z: number; text: string; crit: boolean; heal: boolean }) => void;
    spawnImpact: (n: { x: number; z: number; color: string; big: boolean; mode?: DuelImpactMode }) => void;
    spawnElementBurst: (n: { x: number; z: number; element?: string | null; move?: string; color: string; big: boolean; heading?: number; style?: PetHeroMoveStyle }) => void;
    spawnAftermath: (n: { x: number; z: number; element?: string | null; move?: string; color: string; big: boolean }) => void;
    spawnFx: (n: { x: number; z: number; element?: string | null; key?: string; scale: number; dur: number }) => void;
    spawnSupport: (n: { x: number; z: number; color: string; kind: DuelSupportKind; actorId?: string }) => void;
    spawnShock: (n: { x: number; z: number; color: string; big: boolean }) => void;
    spawnDust: (n: { x: number; z: number }) => void;
    spawnScorch: (n: { x: number; z: number; big?: boolean; element?: string | null; color?: string }) => void;
    spawnPowerUp: (n: { x: number; z: number; color: string; actorId?: string; style?: PetHeroMoveStyle }) => void;
    spawnTrail: (n: { x: number; z: number; toward: number; kind: MoveChoreoKind; color: string; weight: DuelAttackWeight; style: PetHeroMoveStyle }) => void;
    spawnDash: (n: { actorId?: string; fromX: number; fromZ: number; toX: number; toZ: number; impactX?: number; impactZ?: number; color: string; element?: string | null; move?: string; style?: PetHeroMoveStyle; impact: boolean; startTick?: number; contactTick?: number }) => void;
    spawnPressure: (n: { fromX: number; fromZ: number; toX: number; toZ: number; leftColor: string; rightColor: string; leftElement?: string | null; rightElement?: string | null }) => void;
    spawnSetPiece: (n: { actorId?: string; targetId?: string; fromX: number; fromZ: number; toX: number; toZ: number; element?: string | null; move?: string }) => void;
    elementById: Record<string, string | null | undefined>;
    nameById: Record<string, string>;
    speciesNameById: Record<string, string>;
    petIdById: Record<string, string>;
    profileById: Record<string, PetCombatModelProfile | undefined>;
    ultById: Record<string, string>;
    heroMoveById: Record<string, string>;
    onCutIn: (actorId: string, move: string) => void;
    onFlash: (color: string, intensity: number) => void;     // full-screen element flash
    onCallout: (text: string) => void;                       // big "CRITICAL!/FINISH!" banner
    onCombo: (n: number) => void;                            // combo counter pop
    onAnnounce: (text: string, tone: "danger" | "reversal" | "ultimate" | "ko") => void;  // play-by-play commentary
    onWeather: (n: { weather: PetColiseumWeather; actorId: string; move: string; atTick: number }) => void;
    onClashResult: (winnerId: string | null, loserId: string | null) => void;
    onFinisher: (actorId: string, targetId: string, move: string | undefined, resolveTick: number) => void;
    onMoveCallout: (text: string, side: "player" | "enemy", tone?: DuelMoveCalloutTone, who?: string, element?: string | null) => void;
}) {
    const { camera, size } = useThree();
    // The QA harness can open a replay at an arbitrary tick. Treat that tick as
    // established history so effects do not fire underneath the intro curtain;
    // normal replays still start at tick zero and consume every subsequent beat.
    const lastTick = useRef(Math.max(-1, Math.floor(clock.current.t)));
    const ended = useRef(false);
    const endHold = useRef(0);
    const shake = useRef(0);
    const hitStop = useRef(0);
    const timeScale = useRef(PET_DUEL_NEUTRAL_PLAYBACK_SCALE);
    const zoomKick = useRef(0);    // transient dolly-IN punch on heavy hits (decays)
    const koPull = useRef(0);      // camera pull-BACK on KO (eases out slowly)
    const comboN = useRef(0);      // consecutive-hit combo counter
    const comboT = useRef(0);      // wall-time the combo window expires
    const lowHp = useRef<Set<string>>(new Set());   // actors already called "on the ropes" (re-arms on heal)
    const leadSide = useRef<"player" | "enemy" | "even">("even");   // who holds the HP lead — a swap = a reversal
    const lastReversal = useRef(0);                  // wall-time of the last reversal call (debounce)
    const holdUntil = useRef(0);                     // wall-time to HOLD the current slow-mo until (savor beat)
    const lastMoveCall = useRef(0);                  // wall-time of the last move-name callout (debounce)
    const heroCutActors = useRef<Set<string>>(new Set()); // every showcase fighter earns one marquee reveal
    const finisherResolveTicks = useRef<Set<number>>(new Set());
    const lastElementChain = useRef(-999);           // elemental payoff banner throttle
    const lastWeatherCue = useRef<Record<string, number>>({}); // de-dupe windup/cast/ultimate copies of one release
    const partyMode = (duel.snapshots[0]?.actors.length ?? 0) > 2;
    const spotlightUntil = useRef(0);                // one global 2v2 spectacle lane; local combat continues underneath
    // All arena-scale techniques share one presentation lane. Raw simulator
    // events can legitimately overlap (counter-ultimate, buff during pressure),
    // but launching their long-lived VFX independently produces an unreadable
    // stack. The lane serializes only presentation; combat truth is untouched.
    const majorVfxUntilWall = useRef(0);
    const majorVfxTimers = useRef<number[]>([]);
    useEffect(() => () => majorVfxTimers.current.forEach((timer) => window.clearTimeout(timer)), []);
    const majorVfxBusy = () => performance.now() / 1000 < majorVfxUntilWall.current;
    const occupyMajorVfxLane = (durationSec: number) => {
        majorVfxUntilWall.current = Math.max(majorVfxUntilWall.current, performance.now() / 1000 + durationSec);
    };
    const scheduleDirectorCue = (run: () => void, delayMs: number) => {
        const timer = window.setTimeout(run, delayMs);
        majorVfxTimers.current.push(timer);
    };
    // ── Cinematic camera (render-only): a live look target eased toward the fighters'
    // midpoint, briefly OVERRIDDEN by cuts (attacker on wind-up / defender on impact /
    // victim on KO), plus an adaptive dolly that tightens when they plant close.
    const camAim = useRef<[number, number, number]>([CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2]]);
    // `camAim` is the authored shot target; these are the actually rendered eye
    // and look positions. Keeping them separate turns a cue change into a quick
    // camera move instead of making the entire arena appear to teleport.
    const camLook = useRef<[number, number, number]>([CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2]]);
    const camEye = useRef<[number, number, number]>([CAM_POS[0], CAM_POS[1], CAM_POS[2]]);
    const camAimHold = useRef(0);      // seconds a cut aim is held before easing back to the midpoint
    const camDolly = useRef(CAM_POS[2]); // eased dolly distance (adaptive on the leads' spread)
    const camDollyBias = useRef(0);    // transient extra push-in during a wind-up cut (decays)
    const shotDolly = useRef(0);       // held shot-size offset: + pushes in, - reveals the arena
    const shotDollyHold = useRef(0);   // preserve the composition through anticipation / reaction
    const camPosBias = useRef<[number, number, number]>([0, 0, 0]);   // transient eye offset (low crit / overhead KO angle), eases back to 0
    const camBiasHold = useRef(0);
    const introLocked = useRef(false); // fires the "lock-in" shake once when the opening charge completes
    const primaryPresentationTicks = useMemo(() => [...new Set(duel.events
        .filter((event) => event.type === "windup" || event.type === "cast" || event.type === "ultimate" || event.type === "hit" || event.type === "whiff")
        .map((event) => event.t))].sort((a, b) => a - b), [duel]);
    const breatherBeats = useMemo(() => {
        if ((duel.snapshots[0]?.actors.length ?? 0) !== 2) return [] as number[];
        const beats: number[] = [];
        const minimumGap = Math.round(DUEL_TPS * 2.05);
        for (let i = 1; i < primaryPresentationTicks.length; i++) {
            const previous = primaryPresentationTicks[i - 1], next = primaryPresentationTicks[i];
            if (next - previous < minimumGap) continue;
            const cue = previous + Math.round(DUEL_TPS * 0.62);
            if (next - cue > Math.round(DUEL_TPS * 0.95)) beats.push(cue);
        }
        return beats;
    }, [duel, primaryPresentationTicks]);
    const pressureBeats = useMemo(() => {
        if ((duel.snapshots[0]?.actors.length ?? 0) !== 2) return [] as number[];
        const beats: number[] = [];
        const minimumGap = Math.round(DUEL_TPS * 3.25);
        for (let i = 1; i < primaryPresentationTicks.length; i++) {
            const previous = primaryPresentationTicks[i - 1], next = primaryPresentationTicks[i];
            if (next - previous < minimumGap) continue;
            const cue = Math.round(lerp(previous, next, 0.58));
            if (cue - previous >= Math.round(DUEL_TPS * 1.15) && next - cue >= Math.round(DUEL_TPS * 1.1)) beats.push(cue);
        }
        return beats.slice(0, 5);
    }, [duel, primaryPresentationTicks]);
    // Hits and genuinely moving whiffs share the same authored launch/travel
    // track. The outcome branches only at resolution: a hit gets contact VFX;
    // a miss keeps the trail, wide camera, empty lane, and recovery without
    // inventing damage. This closes the last "teleport" hole in melee playback.
    const attackDashBeats = useMemo(() => duelAttackDashBeats(duel.events, duel.snapshots), [duel]);
    // Direct the completed deterministic timeline like an edited fight scene:
    // every fighter gets exactly one identity reveal. Prefer its true signature,
    // but promote a successful named technique when a short match would otherwise
    // end before that signature becomes available.
    const heroCutEventByActor = useMemo(
        () => duelHeroCutEventIndexes(duel.events, heroMoveById),
        [duel.events, heroMoveById],
    );
    const pressureCount = useRef(0);
    useFrame((state, delta) => {
        const snaps = duel.snapshots;
        const maxT = snaps.length - 1;
        const now = state.clock.elapsedTime;
        // ── Dramatic time control (render-only — scales the clock advance, never the
        // sim). Neutral runs a touch FAST so dead approach time doesn't drag; each
        // hit/cast SAVOR-slows playback and HOLDS it (holdUntil) so the exchange
        // reads like a staged anime beat, then eases back. Hit-stop FREEZES on impact.
        // Cover neutral travel briskly, then spend the saved screen time on the
        // attack itself. Anime action feels fast because setup/repositioning is
        // economical while anticipation, contact, and reaction are deliberately
        // readable—not because every phase runs at one uniformly high speed.
        // Neutral play is deliberately only a little faster than real time.
        // Readability now wins over the old runtime target; empty travel can still
        // catch up gently after a command without turning the exchange into a skip.
        const BASE_SCALE = PET_DUEL_NEUTRAL_PLAYBACK_SCALE;
        // Limit simulation catch-up to one 30 Hz step per rendered frame. A slow
        // GPU frame now slows the replay gracefully instead of skipping across a
        // dash or named-move release. This does not alter deterministic combat.
        const frameDelta = Math.min(delta, 1 / DUEL_TPS);
        // One scale owns the phrase. The old stack multiplied base speed, dash
        // speed, arena-VFX slow-mo and savor slow-mo, creating abrupt 1.42x ->
        // 0.015x -> 0x changes that looked like lag even on a steady frame rate.
        const authoredDashInFlight = attackDashBeats.some((cue) => clock.current.t >= cue.startTick && clock.current.t < cue.resolveTick);
        // Command rush: blow through the dead standoff after the player orders a move so
        // the strike reaches the screen fast. Never while a dash / big VFX / hit-stop is
        // playing (those ARE the payoff — don't skip them), so it only compresses the
        // eventless staring gap.
        const rushing = duelCmdRush.active && hitStop.current <= 0 && !authoredDashInFlight && !majorVfxBusy();
        let phraseScale = rushing ? Math.max(timeScale.current, PET_DUEL_COMMAND_CATCHUP_SCALE) : timeScale.current;
        if (authoredDashInFlight) phraseScale = Math.min(phraseScale, 1.02);
        if (majorVfxBusy()) phraseScale = Math.min(phraseScale, 0.88);
        // Cap the amount of *simulation time* exposed by one render frame. The
        // previous delta cap was applied before playback scaling, so neutral play
        // could jump across a pose in one 30 fps frame. Catch-up receives only a
        // modest allowance and remains well below the old 4× skip.
        const maxTickAdvance = rushing ? 1.15 : authoredDashInFlight ? 0.74 : majorVfxBusy() ? 0.78 : 0.96;
        let dt = Math.min(frameDelta * phraseScale, maxTickAdvance / DUEL_TPS);
        if (hitStop.current > 0) { hitStop.current = Math.max(0, hitStop.current - delta); dt = 0; }
        if (now >= holdUntil.current) timeScale.current = lerp(timeScale.current, BASE_SCALE, 1 - Math.exp(-7.2 * frameDelta));
        // A savor beat: slow to `scale` and hold it for `holdSec` before easing back.
        const savor = (scale: number, holdSec: number) => { timeScale.current = Math.min(timeScale.current, scale); holdUntil.current = Math.max(holdUntil.current, now + holdSec); };
        advanceClock(maxT, dt);
        const cur = Math.floor(clock.current.t);
        if (cur > lastTick.current) {
            const crossedEvents = duel.events.filter((event) => event.t > lastTick.current && event.t <= cur);
            // End the command rush the instant a real beat arrives — the player's ordered
            // move landing (its windup / cast / hit), any KO, or any crit — so the
            // fast-forward only ever eats the empty staring gap and always hands the
            // contact itself to full-speed savor. A safety cap ends it regardless.
            if (duelCmdRush.active) {
                const reachedBeat = crossedEvents.some((e) =>
                    (typeof e.actorId === "string" && e.actorId.startsWith("player")
                        && (e.type === "windup" || e.type === "cast" || e.type === "hit" || e.type === "ultimate"))
                    || e.type === "ko"
                    || (e.type === "hit" && e.crit));
                if (reachedBeat || cur - duelCmdRush.fromTick > DUEL_TPS * PET_DUEL_COMMAND_CATCHUP_SECONDS) duelCmdRush.active = false;
            }
            const spotlightCandidate = partyMode ? selectDuelSpotlightEvent(crossedEvents) : null;
            const spotlightEvent = spotlightCandidate
                && (spotlightCandidate.type === "ko" || now >= spotlightUntil.current)
                ? spotlightCandidate
                : null;
            if (spotlightEvent) spotlightUntil.current = now + PARTY_SPOTLIGHT_COOLDOWN_SECONDS;
            for (const cue of attackDashBeats) {
                if (cue.startTick <= lastTick.current || cue.startTick > cur) continue;
                const dashOwnsSpotlight = !partyMode || (spotlightEvent?.actorId === cue.actorId && spotlightEvent.t === cue.startTick);
                if (!dashOwnsSpotlight) continue;
                const launchSnap = snaps[Math.min(maxT, cue.startTick)];
                const contactSnap = snaps[Math.min(maxT, cue.resolveTick)];
                const attacker = findActor(launchSnap, cue.actorId);
                const landing = findActor(contactSnap, cue.actorId);
                const defender = findActor(contactSnap, cue.targetId);
                if (!attacker || !landing || Math.hypot(landing.x - attacker.x, landing.y - attacker.y) < 0.42) continue;
                const dashColor = elementColor(elementById[cue.actorId]).base;
                const style = petHeroMoveStyle({ petId: petIdById[cue.actorId], petName: speciesNameById[cue.actorId], move: cue.move, profile: profileById[cue.actorId] });
                spawnDash({
                    actorId: cue.actorId,
                    fromX: attacker.x,
                    fromZ: attacker.y,
                    toX: landing.x,
                    toZ: landing.y,
                    impactX: cue.outcome === "hit" && defender ? defender.x : landing.x,
                    impactZ: cue.outcome === "hit" && defender ? defender.y : landing.y,
                    color: dashColor,
                    element: cue.element ?? elementById[cue.actorId],
                    move: cue.move,
                    style,
                    impact: cue.outcome === "hit",
                    startTick: cue.startTick,
                    contactTick: cue.resolveTick,
                });
                const ap = duelFieldToFloor(attacker.x, attacker.y);
                const lp = duelFieldToFloor(landing.x, landing.y);
                const fp = cue.outcome === "hit" && defender ? duelFieldToFloor(defender.x, defender.y) : lp;
                // Compose from launch to the defender, not merely launch to the
                // attacker's simulated landing. The latter can stop short of the
                // model's visual contact point and strand the target at the edge.
                camAim.current = [(ap.wx + fp.wx) * 0.46, 1.3, CAM_LOOK[2] + (ap.wz + fp.wz) * 0.24];
                const heroRouteHold = style !== "generic" && /lunar|eclipse|moon|ninetail/i.test(String(cue.move ?? ""));
                // A portrait card freezes simulation time but not the render
                // camera's wall clock. Keep a hero route's wide composition alive
                // through that card so the pet releases into a visible lane rather
                // than emerging from the cut-in already at contact.
                const routeHold = heroRouteHold ? 1.72 : 0.66;
                camAimHold.current = Math.max(camAimHold.current, routeHold);
                // Keep the entire travel lane readable. A close launch shot made the
                // attacker cross the lens faster than the camera could settle, which
                // visually collapsed a real traversal back into a teleport.
                camPosBias.current = [0, 0.32, 1.28];
                camBiasHold.current = Math.max(camBiasHold.current, routeHold);
                shotDolly.current = -2.15;
                shotDollyHold.current = Math.max(shotDollyHold.current, routeHold);
            }
            for (const cue of breatherBeats) {
                if (cue <= lastTick.current || cue > cur) continue;
                const breatherSnap = snaps[Math.min(maxT, cue)];
                const player = breatherSnap?.actors.find((actor) => actor.team === "player" && actor.hp > 0);
                const enemy = breatherSnap?.actors.find((actor) => actor.team === "enemy" && actor.hp > 0);
                if (!player || !enemy) continue;
                const pp = duelFieldToFloor(player.x, player.y);
                const ep = duelFieldToFloor(enemy.x, enemy.y);
                // Dead air becomes a deliberate geography beat: reveal both pets,
                // their new lanes, and the open arena while the stage director owns
                // the repositioning. No extra attack VFX is invented here.
                camAim.current = [(pp.wx + ep.wx) * 0.46, 1.62, CAM_LOOK[2] + (pp.wz + ep.wz) * 0.22];
                camAimHold.current = Math.max(camAimHold.current, 0.82);
                camPosBias.current = [0, 0.78, 1.2];
                camBiasHold.current = Math.max(camBiasHold.current, 0.78);
                shotDolly.current = -1.9;
                shotDollyHold.current = Math.max(shotDollyHold.current, 0.84);
            }
            for (const cue of pressureBeats) {
                if (cue <= lastTick.current || cue > cur) continue;
                if (majorVfxBusy()) continue;
                const pressureSnap = snaps[Math.min(maxT, cue)];
                const player = pressureSnap?.actors.find((actor) => actor.team === "player" && actor.hp > 0);
                const enemy = pressureSnap?.actors.find((actor) => actor.team === "enemy" && actor.hp > 0);
                if (!player || !enemy) continue;
                spawnPressure({
                    fromX: player.x,
                    fromZ: player.y,
                    toX: enemy.x,
                    toZ: enemy.y,
                    leftColor: elementColor(elementById[player.id]).base,
                    rightColor: elementColor(elementById[enemy.id]).base,
                    leftElement: elementById[player.id],
                    rightElement: elementById[enemy.id],
                });
                majorVfxUntilWall.current = Math.max(majorVfxUntilWall.current, performance.now() / 1000 + 1.05);
                pressureCount.current += 1;
                if (pressureCount.current === 1) onCallout("ELEMENTAL CLASH!");
                const pp = duelFieldToFloor(player.x, player.y);
                const ep = duelFieldToFloor(enemy.x, enemy.y);
                camAim.current = [(pp.wx + ep.wx) * 0.46, 1.28, CAM_LOOK[2] + (pp.wz + ep.wz) * 0.22];
                camAimHold.current = Math.max(camAimHold.current, 0.58);
                shotDolly.current = -0.62;
                shotDollyHold.current = Math.max(shotDollyHold.current, 0.56);
                shake.current = Math.max(shake.current, 0.26);
            }
            for (const e of crossedEvents) {
                const spotlight = !partyMode || e === spotlightEvent;
                const snapAt = snaps[Math.min(maxT, e.t)];
                // Weather owns the battlefield, not the current camera lane. In a
                // party duel a real climate technique must still change the arena
                // even when another simultaneous action wins the spotlight edit.
                if (e.actorId && e.move && (e.type === "windup" || e.type === "cast" || e.type === "ultimate")) {
                    const weather = petColiseumWeatherForMove(e.move, e.kind);
                    const cueKey = `${e.actorId}:${weather?.kind ?? "none"}:${e.move}`;
                    const lastCueTick = lastWeatherCue.current[cueKey] ?? -Infinity;
                    if (weather && e.t - lastCueTick > Math.round(DUEL_TPS * 0.8)) {
                        lastWeatherCue.current[cueKey] = e.t;
                        onWeather({ weather, actorId: e.actorId, move: e.move, atTick: e.t });
                    }
                }
                if (spotlight && (e.type === "windup" || e.type === "cast" || e.type === "ultimate")) {
                    const openerIndex = duel.events.indexOf(e);
                    const finisher = duelFinisherOutcome(duel.events, snaps, openerIndex);
                    if (finisher && !finisherResolveTicks.current.has(finisher.resolveTick)) {
                        finisherResolveTicks.current.add(finisher.resolveTick);
                        onFinisher(e.actorId, finisher.targetId, e.move, finisher.resolveTick);
                        const attacker = findActor(snapAt, e.actorId);
                        const targetAtContact = findActor(snaps[Math.min(maxT, finisher.resolveTick)], finisher.targetId);
                        if (attacker && targetAtContact) {
                            const ap = duelFieldToFloor(attacker.x, attacker.y);
                            const tp = duelFieldToFloor(targetAtContact.x, targetAtContact.y);
                            camAim.current = [lerp(ap.wx, tp.wx, 0.28) * 0.92, 1.24, CAM_LOOK[2] + lerp(ap.wz, tp.wz, 0.28) * 0.48];
                            camAimHold.current = Math.max(camAimHold.current, 0.72);
                            camPosBias.current = [ap.wx <= tp.wx ? -1.05 : 1.05, -0.88, -0.94];
                            camBiasHold.current = Math.max(camBiasHold.current, 0.64);
                            shotDolly.current = Math.max(shotDolly.current, 1.42);
                            shotDollyHold.current = Math.max(shotDollyHold.current, 0.68);
                        }
                        // A brief held breath before a known lethal contact creates
                        // contrast; the resolving hit and KO still own the explosion.
                        savor(0.34, 0.34);
                    }
                }
                if (e.type === "hit" && e.dmg && e.targetId) {
                    const a = findActor(snapAt, e.targetId);
                    if (a) {
                        const frac = Math.min(1, e.dmg / Math.max(1, a.maxHp));
                        const heavy = !!e.crit || frac > 0.12;
                        const attacker = findActor(snapAt, e.actorId);
                        // A hit that arrives immediately after the same actor crossed
                        // from a farther maneuver pocket is a dash-in combo. Sell the
                        // whole phrase at CONTACT instead of making the traversal and
                        // attack look like unrelated, weightless actions.
                        const dashCombo = !!attacker && duel.events.some((m) => {
                            if (m.type !== "maneuver" || m.actorId !== e.actorId || !m.targetId || m.t >= e.t
                                || e.t - m.t > Math.round(DUEL_TPS * 1.45)) return false;
                            const startSnap = snaps[Math.min(maxT, m.t)];
                            const startActor = findActor(startSnap, m.actorId);
                            const startTarget = findActor(startSnap, m.targetId);
                            if (!startActor || !startTarget) return false;
                            const before = Math.hypot(startTarget.x - startActor.x, startTarget.y - startActor.y);
                            const after = Math.hypot(a.x - attacker.x, a.y - attacker.y);
                            return before - after > 1.15;
                        });
                        const authoredDashContact = attackDashBeats.some((cue) => cue.outcome === "hit" && cue.resolveTick === e.t && cue.actorId === e.actorId && cue.targetId === e.targetId);
                        const dashImpact = authoredDashContact || dashCombo;
                        const impactHeavy = heavy || dashImpact || !!e.perfect;
                        // World-space combat bodies use the saturated element base.
                        // The previous pastel `glow` palette was then screen-blended
                        // again, bleaching every hit toward white beside the textured
                        // pets and making distinct elements look like the same VFX.
                        const col = elementColor(e.element).base;
                        const heroStyle = petHeroMoveStyle({ petId: petIdById[e.actorId], petName: speciesNameById[e.actorId], move: e.move, kind: e.kind, profile: profileById[e.actorId] });
                        const followsUltimate = !!e.move && duel.events.some((u) => u.type === "ultimate" && u.actorId === e.actorId && u.move === e.move && u.t < e.t && e.t - u.t <= Math.round(DUEL_TPS * 2));
                        let setPieceOwnsContact = false;
                        let setPieceContactDelayMs = 0;
                        if (spotlight && attacker && e.move && (followsUltimate || arenaScaleMove(e.move))) {
                            const setPieceKind = duelSetPieceKind(e.element, e.move);
                            const timing = duelSetPieceTiming(setPieceKind);
                            spawnSetPiece({ actorId: attacker.id, targetId: a.id, fromX: attacker.x, fromZ: attacker.y, toX: a.x, toZ: a.y, element: e.element, move: e.move });
                            occupyMajorVfxLane(timing.durationSec);
                            setPieceOwnsContact = true;
                            setPieceContactDelayMs = timing.contactDelayMs;
                        }
                        const longFormOwnsContact = spotlight && (setPieceOwnsContact || authoredDashContact || majorVfxBusy());
                        const heading = attacker ? Math.atan2(a.x - attacker.x, a.y - attacker.y) : (e.actorId.startsWith("enemy") ? -Math.PI / 2 : Math.PI / 2);
                        // Named techniques deserve a larger elemental silhouette even
                        // when their balance damage is modest. This keeps presentation
                        // weight independent from tuning and prevents special moves
                        // looking like recolored basic attacks.
                        // Large contact volumes are reserved for genuinely heavy
                        // outcomes. A named but lightly tuned move still gets its
                        // authored color/shape, just not a screen-filling explosion.
                        const cinematicBurst = spotlight && (impactHeavy || !!e.signature || !!e.perfect);
                        // Contact is followed by a persistent world-space residue.
                        // This supplies the missing payoff after the projectile or
                        // dash disappears: scorched flame tongues, water ripples,
                        // wind curls, lightning shards, or broken earth remain long
                        // enough for the defender's recoil to read against them.
                        const heavyKind = e.kind === "crush" || e.kind === "push";
                        const fxKey = moveFxKey(e.kind);   // themed burst (blood/shadow/poison/spark/ice/…) or "" → element combo
                        // Keep only the authored status glyphs from the legacy sprite
                        // library. Plain elemental contacts are now fully owned by the
                        // toon-shaded 3D burst + residue above. Layering the old white
                        // flipbook combo on top created the large flat orb that hid the
                        // defender and caused the pet/VFX art mismatch.
                        // One visual owns contact. Authored dashes and arena-scale
                        // techniques already include their collision payoff; stacking
                        // a burst, shockwave, sprite, and residue on that same frame was
                        // the main source of the choppy "three VFX in a row" rhythm.
                        const playerHit = e.actorId.startsWith("player");
                        const contactNeedsVolume = impactHeavy || !!e.move || playerHit;
                        if (!longFormOwnsContact && contactNeedsVolume) {
                            if (fxKey) spawnFx({ x: a.x, z: a.y, key: fxKey, scale: spotlight ? (impactHeavy ? 2.9 : 1.9) : 1.25, dur: spotlight && impactHeavy ? 540 : 360 });
                            else spawnElementBurst({ x: a.x, z: a.y, element: e.element, move: e.move, color: col, big: cinematicBurst, heading, style: heroStyle });
                            if (spotlight && e.crit) {
                                const aftermath = { x: a.x, z: a.y, element: e.element, move: e.move, color: col, big: cinematicBurst };
                                scheduleDirectorCue(() => spawnAftermath(aftermath), 180);
                            }
                        }
                        // Weapon TRAIL — the swing itself, at the ATTACKER, per archetype
                        // (pierce stab / slash sweep / slam overhead chop / drain rake).
                        // Melee only — a ranged projectile has no melee swing.
                        if (spotlight && !e.ranged && !longFormOwnsContact) {
                            const att = findActor(snapAt, e.actorId);
                            if (att) spawnTrail({
                                x: att.x,
                                z: att.y,
                                toward: e.actorId.startsWith("enemy") ? -1 : 1,
                                kind: classifyMoveChoreo(e.kind, false, e.element),
                                color: col,
                                weight: impactHeavy ? "heavy" : e.move ? "ability" : "basic",
                                style: heroStyle,
                            });
                        }
                        // A blow landed BY the pet the player is driving. The player's
                        // own agency has to read every time — a light poke from your pet
                        // should still land with weight, or commanding it feels inert.
                        // So a player-side contact gets a feedback FLOOR (a guaranteed
                        // contact flash + a touch more shake/hit-stop) even when its
                        // balance damage is small. Render-only; the sim is untouched.
                        if (e.move === "Clash Break") onClashResult(e.actorId, e.targetId ?? null);
                        const isSig = !!e.signature, isAbility = !!e.move;
                        const contactTiming = petDuelContactTiming({
                            damageFraction: frac,
                            critical: !!e.crit,
                            heavy: heavyKind || heavy,
                            dash: dashImpact,
                            perfect: !!e.perfect,
                            playerAuthored: playerHit,
                            signature: isSig,
                            ability: isAbility,
                        });
                        const contactFeedback = () => {
                            // Sound rides the contact frame (immediate, or delayed with a
                            // set-piece), so the hit/crit lands on the same beat as the
                            // shake + flash. The whole SFX bank already existed; the 3D
                            // duel simply never called it.
                            // A Clash Break is the payoff for winning the read, so it
                            // always lands with the heavy cue even when the roll was not
                            // a crit — it is the loudest thing a player earns in the mode.
                            playPetSfx(e.crit || e.move === "Clash Break" || e.perfect ? "crit" : "hit");
                            spawnNumber({ x: a.x, z: a.y, text: `${e.crit ? "CRIT " : ""}-${e.dmg}`, crit: !!e.crit, heal: false });
                            if (!spotlight) return;
                            hitStop.current = Math.max(hitStop.current, contactTiming.hitStop);
                            shake.current = Math.max(shake.current, contactTiming.shake);
                            if (impactHeavy || e.move || playerHit) {
                                const contactFlash = new THREE.Color(col).lerp(new THREE.Color("#fff4d2"), 0.26).getStyle();
                                const contactFrame = Math.min(0.4, (playerHit ? 0.12 : 0.1) + frac * 0.62 + (e.crit ? 0.08 : 0) + (dashImpact ? 0.1 : 0));
                                onFlash(contactFlash, contactFrame);
                                scheduleDirectorCue(() => onFlash(col, Math.min(0.2, 0.035 + frac * 0.34) + (e.crit ? 0.05 : 0)), 62);
                            }
                        };
                        if (setPieceOwnsContact) scheduleDirectorCue(contactFeedback, setPieceContactDelayMs);
                        else contactFeedback();
                        if (spotlight && e.perfect && e.verdict) {
                            onCallout(e.verdict);
                            onMoveCallout("PERFECT EXECUTION", e.side, "combo", nameById[e.actorId], elementById[e.actorId]);
                            spawnShock({ x: a.x, z: a.y, color: col, big: true });
                            spawnScorch({ x: a.x, z: a.y, big: true, element: e.element, color: col });
                            zoomKick.current = Math.max(zoomKick.current, 3.4);
                            savor(0.34, 0.32);
                        }
                        // Reserve the extra ground displacement ring for genuinely
                        // heavy contacts. Basic hits already have a swing trail and
                        // elemental contact volume; a third effect on every hit made
                        // the action stutter visually even when frame time was stable.
                        if (spotlight && ((!longFormOwnsContact && impactHeavy) || (authoredDashContact && !setPieceOwnsContact))) {
                            spawnShock({ x: a.x, z: a.y, color: col, big: true });
                        }
                        if (spotlight && authoredDashContact && !setPieceOwnsContact) {
                            // The dash renderer owns the sharp collision frame. A
                            // lower residue then stays behind the defender's recoil,
                            // making the crossed distance feel like it displaced the
                            // arena instead of vanishing with the trail.
                            spawnAftermath({ x: a.x, z: a.y, element: e.element, move: e.move, color: col, big: impactHeavy });
                        }
                        // Dramatic SAVOR — slow the moment so the swing reads; deeper on a
                        // signature, then a crit/heavy slam, then any named ability, then a basic.
                        if (spotlight && contactTiming.savorHold > 0) savor(contactTiming.savorScale, contactTiming.savorHold);
                        // Camera ZOOM-PUNCH — every meaningful blow pushes in; abilities/crits/signatures harder.
                        if (spotlight) zoomKick.current = Math.max(zoomKick.current, contactTiming.zoomKick);
                        // Camera CUT to whoever got hit — the impact reads on the defender.
                        if (spotlight && (impactHeavy || isAbility)) {
                            const cp = duelFieldToFloor(a.x, a.y);
                            const ap = attacker ? duelFieldToFloor(attacker.x, attacker.y) : cp;
                            const pairX = (ap.wx + cp.wx) * 0.5;
                            const pairZ = (ap.wz + cp.wz) * 0.5;
                            // Keep both silhouettes in the impact composition. The
                            // old defender-only cut combined with three independent
                            // dolly pushes and routinely cropped the attacker.
                            camAim.current = [lerp(pairX, cp.wx, 0.2) * 0.88, 1.4, CAM_LOOK[2] + lerp(pairZ, cp.wz, 0.2) * 0.46];
                            camAimHold.current = Math.max(camAimHold.current, contactTiming.aimHold);
                            // Cut across the line of action to the defender, low and
                            // close. The following stagger event releases to a wider
                            // reaction shot, producing setup -> contact -> recovery
                            // instead of one camera continuously following the pair.
                            const impactSide = cp.wx < 0 ? 1 : -1;
                            camPosBias.current = [impactSide * (impactHeavy ? 0.82 : 0.64), impactHeavy ? -0.82 : -0.58, impactHeavy ? -0.86 : -0.58];
                            camBiasHold.current = Math.max(camBiasHold.current, contactTiming.cameraBiasHold);
                            shotDolly.current = Math.max(shotDolly.current, impactHeavy ? 1.35 : 0.72);
                            shotDollyHold.current = Math.max(shotDollyHold.current, impactHeavy ? 0.34 : 0.18);
                            if (setPieceOwnsContact) {
                                // Arena-scale VFX need geography, not a defender
                                // close-up. Hold both caster and target around the
                                // complete effect silhouette; the contact flash and
                                // damage number still provide the punch-in read.
                                camAim.current = [pairX * 0.66, 1.48, CAM_LOOK[2] + pairZ * 0.42];
                                camAimHold.current = Math.max(camAimHold.current, 0.72);
                                camPosBias.current = [0, 0.5, 1.25];
                                camBiasHold.current = Math.max(camBiasHold.current, 0.68);
                                shotDolly.current = -1.55;
                                shotDollyHold.current = Math.max(shotDollyHold.current, 0.72);
                                // Establish the full arena-scale silhouette first,
                                // then glide into the defender as the set piece lands.
                                // The old shot stayed wide through contact, so the
                                // cut-in promised a finisher but its payoff felt tiny.
                                scheduleDirectorCue(() => {
                                    camAim.current = [lerp(pairX, cp.wx, 0.34) * 0.9, 1.28, CAM_LOOK[2] + lerp(pairZ, cp.wz, 0.34) * 0.48];
                                    camAimHold.current = Math.max(camAimHold.current, 0.4);
                                    camPosBias.current = [impactSide * 0.92, -0.56, -0.72];
                                    camBiasHold.current = Math.max(camBiasHold.current, 0.38);
                                    shotDolly.current = 1.26;
                                    shotDollyHold.current = Math.max(shotDollyHold.current, 0.36);
                                    zoomKick.current = Math.max(zoomKick.current, 2.35);
                                }, Math.max(0, setPieceContactDelayMs - 45));
                            } else if (dashImpact) {
                                // Contact completes the same wide dash composition.
                                // Do not cut to a tight defender close-up while the
                                // attacker is still resolving its authored route.
                                camAim.current = [pairX * 0.9, 1.36, CAM_LOOK[2] + pairZ * 0.46];
                                camAimHold.current = Math.max(camAimHold.current, 0.58);
                                camPosBias.current = [0, 0.08, 0.42];
                                camBiasHold.current = Math.max(camBiasHold.current, 0.54);
                                shotDolly.current = -0.58;
                                shotDollyHold.current = Math.max(shotDollyHold.current, 0.58);
                                duelFovKick.current = Math.max(duelFovKick.current, 1.35);
                            }
                        }
                        // A pet's HERO move (its signature, else its strongest jutsu) triggers the
                        // anime freeze-frame CUT-IN (throttled so it stays special); other named
                        // abilities show the smaller banner. (Signatures also cut in via 'ultimate'.)
                        if (spotlight && e.move && !e.perfect && !isSig && now - lastMoveCall.current > 0.4) {
                            lastMoveCall.current = now; onMoveCallout(e.move, e.actorId.startsWith("enemy") ? "enemy" : "player", "attack", nameById[e.actorId], elementById[e.actorId]);
                        }
                        // Combo counter — consecutive hits inside a 1.1s window.
                        if (spotlight) {
                            comboN.current = now < comboT.current ? comboN.current + 1 : 1;
                            comboT.current = now + 1.1;
                            if (comboN.current >= 2) onCombo(comboN.current);
                        }
                        if (spotlight && e.combo && now - lastElementChain.current > 2.2) {
                            lastElementChain.current = now;
                            onMoveCallout(e.combo, e.actorId.startsWith("enemy") ? "enemy" : "player", "combo", nameById[e.actorId], elementById[e.actorId]);
                            onFlash(col, 0.22);
                        }
                        if (spotlight && e.crit && !e.perfect) onCallout("CRITICAL!");
                        if (spotlight && e.crit) duelFovKick.current = Math.max(duelFovKick.current, 2);   // small lens snap on crit
                        if (e.crit) spawnScorch({ x: a.x, z: a.y, element: e.element, color: col });   // a crit leaves an elemental mark on the floor
                        if (spotlight && e.crit) camPosBias.current[1] = -0.9;   // dip to a low hero angle on a crit (R4), eases back
                    }
                } else if (e.type === "heal" && e.dmg && e.targetId) {
                    const a = findActor(snapAt, e.targetId);
                    if (a) {
                        playPetSfx("heal");
                        spawnNumber({ x: a.x, z: a.y, text: `+${e.dmg}`, crit: false, heal: true });
                        // A real 3D restoration column keeps healing in the same visual
                        // language as the models instead of dropping a flat flipbook on them.
                        if (!majorVfxBusy()) spawnSupport({ x: a.x, z: a.y, color: "#8ff7c5", kind: "heal", actorId: a.id });
                    }
                } else if (e.type === "shield" && e.targetId) {
                    // A protective 3D dome and orbit rings make a ward readable from the
                    // arena camera without obscuring the pet silhouette.
                    const a = findActor(snapAt, e.targetId);
                    if (a) {
                        playPetSfx("shield");
                        if (spotlight && e.perfect && e.verdict) {
                            playPetSfx("crit");
                            onCallout(e.verdict);
                            onMoveCallout("PERFECT EXECUTION", e.side, "support", nameById[e.actorId], elementById[e.actorId]);
                            shake.current = Math.max(shake.current, 1.25);
                            onFlash("#dff7ff", 0.3);
                            savor(0.42, 0.32);
                        }
                        if (!majorVfxBusy()) {
                            spawnSupport({ x: a.x, z: a.y, color: elementColor(elementById[e.targetId]).glow, kind: "shield", actorId: a.id });
                            if (spotlight) onFlash("#bfe3ff", 0.14);
                        }
                    }
                } else if (e.type === "buff" && e.actorId) {
                    // Dedicated Super-Saiyan-style power column. This deliberately
                    // avoids the generic aura/element flipbooks, which looked like
                    // an attack had landed on the pet rather than a self-buff.
                    const c = findActor(snapAt, e.actorId);
                    if (c) playPetSfx("buff");
                    if (c && !majorVfxBusy() && spotlight) {
                        const el = elementById[e.actorId];
                        // Use the saturated elemental body colour as the aura's
                        // authored ink. Feeding the pale highlight colour into a
                        // translucent shell produced the frosted geometric cage
                        // seen in the preview instead of an elemental power-up.
                        const color = elementColor(el).base;
                        const priorCast = [...duel.events].reverse().find((candidate) => candidate.actorId === e.actorId
                            && candidate.type === "cast" && candidate.move && candidate.t <= e.t
                            && e.t - candidate.t <= Math.round(DUEL_TPS * 1.1));
                        const style = petHeroMoveStyle({ petId: petIdById[e.actorId], petName: speciesNameById[e.actorId], move: priorCast?.move, kind: priorCast?.kind ?? e.kind, profile: profileById[e.actorId] });
                        spawnPowerUp({ x: c.x, z: c.y, color: style.startsWith("kitsune") ? "#8f62ff" : color, actorId: c.id, style });
                        const buffPos = duelFieldToFloor(c.x, c.y);
                        camAim.current = [buffPos.wx * 1.14, 1.32, CAM_LOOK[2] + buffPos.wz * 0.52];
                        camAimHold.current = Math.max(camAimHold.current, 0.68);
                        camPosBias.current = [buffPos.wx < 0 ? -0.56 : 0.56, -0.34, -0.28];
                        camBiasHold.current = Math.max(camBiasHold.current, 0.62);
                        shotDolly.current = Math.max(shotDolly.current, 0.82);
                        shotDollyHold.current = Math.max(shotDollyHold.current, 0.62);
                        zoomKick.current = Math.max(zoomKick.current, 0.92);
                        savor(1.04, 0.02);
                        onFlash(color, 0.09);
                    } else if (c && !majorVfxBusy()) {
                        spawnImpact({ x: c.x, z: c.y, color: elementColor(elementById[e.actorId]).base, big: false, mode: "tell" });
                    }
                } else if (e.type === "windup" && e.actorId) {
                    // Element TELL — a charge ring at the attacker a beat before the blow,
                    // scaled UP for a real (damaging) move so a heavy hit reads as dangerous,
                    // plus a camera CUT + gentle push-in to the attacker ("here it comes").
                    const c = findActor(snapAt, e.actorId);
                    if (c) {
                        if (spotlight && e.perfect) {
                            playPetSfx("buff");
                            onMoveCallout("PERFECT EXECUTION", e.side, "combo", nameById[e.actorId], elementById[e.actorId]);
                            onFlash(elementColor(elementById[e.actorId]).base, 0.24);
                            hitStop.current = Math.max(hitStop.current, 0.1);
                            shake.current = Math.max(shake.current, 0.9);
                            savor(0.3, 0.28);
                        }
                        const heavyTell = e.kind !== "buff" && e.kind !== "heal" && e.kind !== "shield" && e.kind !== "barrier" && e.kind !== "absorb" && e.kind !== "haste";
                        const opensDashRoute = attackDashBeats.some((cue) => cue.startTick === e.t && cue.actorId === e.actorId && cue.move === e.move);
                        spawnImpact({ x: c.x, z: c.y, color: elementColor(elementById[e.actorId]).glow, big: spotlight && heavyTell, mode: "tell" });
                        if (spotlight && heavyTell) { savor(0.9, 0.04); }
                        if (spotlight && heavyTell && !opensDashRoute) {
                            const p = duelFieldToFloor(c.x, c.y);
                            camAim.current = [p.wx * 0.66, 1.45, CAM_LOOK[2] + p.wz * 0.42];
                            camAimHold.current = Math.max(camAimHold.current, 0.4);
                            // Anticipation shot: favor the attacker's face/silhouette
                            // from its own side of the axis, then cut across the line
                            // only when contact lands. This mirrors the reference's
                            // eye/pose close-up -> committed strike construction.
                            const attackerSide = p.wx < 0 ? -1 : 1;
                            camPosBias.current = [attackerSide * 1.25, -0.78, -0.9];
                            camBiasHold.current = Math.max(camBiasHold.current, 0.34);
                            shotDolly.current = Math.max(shotDolly.current, 1.05);
                            shotDollyHold.current = Math.max(shotDollyHold.current, 0.32);
                        } else if (spotlight && heavyTell && opensDashRoute) {
                            // Do not overwrite the dash director's wide lane with
                            // the ordinary windup close-up on the same tick. That
                            // close -> wide -> close camera reversal was making
                            // continuous travel look like three position cuts.
                            const launch = duelFieldToFloor(c.x, c.y);
                            const route = attackDashBeats.find((cue) => cue.startTick === e.t && cue.actorId === e.actorId && cue.move === e.move);
                            const landingActor = route ? findActor(snaps[Math.min(maxT, route.resolveTick)], e.actorId) : null;
                            const landing = landingActor ? duelFieldToFloor(landingActor.x, landingActor.y) : launch;
                            camAim.current = [(launch.wx + landing.wx) * 0.46, 1.34, CAM_LOOK[2] + (launch.wz + landing.wz) * 0.23];
                            camAimHold.current = Math.max(camAimHold.current, 0.66);
                            camPosBias.current = [0, 0.38, 1.42];
                            camBiasHold.current = Math.max(camBiasHold.current, 0.66);
                            shotDolly.current = -2.15;
                            shotDollyHold.current = Math.max(shotDollyHold.current, 0.66);
                        }
                    }
                } else if (e.type === "whiff" && e.actorId) {
                    const eventIndex = duel.events.indexOf(e);
                    const namedOpener = precedingNamedMove(duel.events, eventIndex);
                    const attacker = findActor(snapAt, e.actorId);
                    const target = attacker
                        ? snapAt.actors.find((candidate) => candidate.hp > 0 && candidate.team !== attacker.team)
                        : null;
                    const evaded = duel.events.some((candidate) => candidate.type === "dodge"
                        && candidate.side !== e.side && candidate.t <= e.t && e.t - candidate.t <= Math.round(DUEL_TPS * 0.8));
                    if (attacker && target) {
                        const missX = lerp(attacker.x, target.x, 0.86);
                        const missZ = lerp(attacker.y, target.y, 0.86);
                        spawnImpact({ x: missX, z: missZ, color: elementColor(elementById[e.actorId]).base, big: false, mode: "dodge" });
                        if (spotlight) {
                            const ap = duelFieldToFloor(attacker.x, attacker.y);
                            const tp = duelFieldToFloor(target.x, target.y);
                            camAim.current = [(ap.wx + tp.wx) * 0.46, 1.36, CAM_LOOK[2] + (ap.wz + tp.wz) * 0.22];
                            camAimHold.current = Math.max(camAimHold.current, 0.42);
                            // A miss is about the empty lane between two silhouettes.
                            // Clear any inherited impact close-up and reveal both the
                            // projectile path and the defender's landing point.
                            zoomKick.current = Math.min(zoomKick.current, 0.25);
                            camDollyBias.current = 0;
                            camPosBias.current = [0, 0.35, 1.35];
                            camBiasHold.current = Math.max(camBiasHold.current, 0.44);
                            shotDolly.current = -1.85;
                            shotDollyHold.current = Math.max(shotDollyHold.current, 0.42);
                        }
                    }
                    if (spotlight && namedOpener?.move && now - lastMoveCall.current > 0.35) {
                        lastMoveCall.current = now;
                        onMoveCallout(namedOpener.move, e.actorId.startsWith("enemy") ? "enemy" : "player", "attack", nameById[e.actorId], elementById[e.actorId]);
                    }
                    // The motion and empty contact lane should sell the evade.
                    // Keep the text as a restrained tactical caption instead of a
                    // full-screen verdict that hides the actual body performance.
                    if (spotlight) {
                        onMoveCallout(evaded ? "Clean Evade" : "Attack Missed", target?.id.startsWith("enemy") ? "enemy" : "player", "maneuver", target ? nameById[target.id] : undefined, target ? elementById[target.id] : undefined);
                        savor(0.9, 0.06);
                    }
                } else if (e.type === "dodge" && e.actorId) {
                    // The model performs the vertical hop; short world-space speed
                    // accents make the evade readable without a floor UI reticle.
                    const d = findActor(snapAt, e.actorId);
                    if (d) {
                        playPetSfx("dodge");
                        spawnDust({ x: d.x, z: d.y });   // foot-dust as the evader lands
                        const evadeColor = elementColor(elementById[e.actorId]).base;
                        spawnImpact({ x: d.x, z: d.y, color: evadeColor, big: false, mode: "dodge" });
                        if (spotlight) {
                            const dp = duelFieldToFloor(d.x, d.y);
                            const opponent = snapAt.actors.find((candidate) => candidate.hp > 0 && candidate.team !== d.team);
                            const op = opponent ? duelFieldToFloor(opponent.x, opponent.y) : dp;
                            camAim.current = [(dp.wx + op.wx) * 0.46, 1.32, CAM_LOOK[2] + (dp.wz + op.wz) * 0.24];
                            camAimHold.current = Math.max(camAimHold.current, 0.34);
                            zoomKick.current = Math.min(zoomKick.current, 0.2);
                            camDollyBias.current = 0;
                            camPosBias.current = [0, 0.5, 1.55];
                            camBiasHold.current = Math.max(camBiasHold.current, 0.3);
                            shotDolly.current = -2.05; // reveal the launch, empty lane, and landing
                            shotDollyHold.current = Math.max(shotDollyHold.current, 0.34);
                        }
                        // The authored dodge state already contains a lateral hop.
                        // Driving another wall-clock route over it made the body pop
                        // out and back, so the real snapshot path now owns the pet.
                    }
                } else if (e.type === "maneuver" && e.kind === "move" && e.move && e.actorId) {
                    // A short elemental range-shift: afterimages carry the motion; no
                    // floor ring is needed because this is not an impact.
                    const runner = findActor(snapAt, e.actorId);
                    if (runner) {
                        const style = petHeroMoveStyle({ petId: petIdById[e.actorId], petName: speciesNameById[e.actorId], move: e.move, kind: e.kind, profile: profileById[e.actorId] });
                        if (spotlight && style !== "generic") {
                            const arrivalTick = Math.min(maxT, e.t + Math.round(DUEL_TPS * 0.52));
                            const arrival = findActor(snaps[arrivalTick], e.actorId);
                            if (arrival && Math.hypot(arrival.x - runner.x, arrival.y - runner.y) > 0.35) {
                                spawnDash({
                                    actorId: e.actorId,
                                    fromX: runner.x,
                                    fromZ: runner.y,
                                    toX: arrival.x,
                                    toZ: arrival.y,
                                    color: elementColor(elementById[e.actorId]).base,
                                    element: elementById[e.actorId],
                                    move: e.move,
                                    style,
                                    impact: false,
                                    startTick: e.t,
                                    contactTick: arrivalTick,
                                });
                            }
                        }
                        // A normal range shift is locomotion, not an attack. The old
                        // presentation spawned a second dash for every maneuver and
                        // overlapped the real pre-hit cue, creating purposeless pops.
                        if (spotlight) zoomKick.current = Math.max(zoomKick.current, 0.35);
                        // Range changes must be seen in a wide composition. Holding
                        // the previous close-up during a breakaway made purposeful
                        // movement read as a pet simply wandering off-screen.
                        if (spotlight) {
                            shotDolly.current = -1.35;
                            shotDollyHold.current = Math.max(shotDollyHold.current, 0.3);
                            camAimHold.current = 0;
                            camBiasHold.current = 0;
                            shake.current = Math.max(shake.current, 0.72);
                        }
                    }
                    if (spotlight && now - lastMoveCall.current > 0.4) {
                        lastMoveCall.current = now;
                        onMoveCallout(e.move, e.actorId.startsWith("enemy") ? "enemy" : "player", "maneuver", nameById[e.actorId], elementById[e.actorId]);
                    }
                    if (spotlight && e.perfect && e.verdict) {
                        playPetSfx("crit");
                        onCallout(e.verdict);
                        onMoveCallout("PERFECT EXECUTION", e.side, "combo", nameById[e.actorId], elementById[e.actorId]);
                        onFlash(elementColor(elementById[e.actorId]).base, 0.32);
                        shake.current = Math.max(shake.current, 1.4);
                        savor(0.36, 0.3);
                    }
                } else if ((e.type === "cast" || e.type === "ultimate") && e.actorId) {
                    // The UNLEASH at the caster. A status cast wears its themed muzzle glow
                    // (poison gathers GREEN, a stun SPARKS); a support cast gathers a soft AURA
                    // (the heal/shield/buff bloom lands on its target separately); an offensive
                    // cast / ultimate channels the pet's element in a 2-stage bloom.
                    const c = findActor(snapAt, e.actorId);
                    const el = elementById[e.actorId];
                    const supportCast = e.type === "cast" && classifyMoveChoreo(e.kind, true) === "support";
                    const castHeroStyle = petHeroMoveStyle({ petId: petIdById[e.actorId], petName: speciesNameById[e.actorId], move: e.move, kind: e.kind, profile: profileById[e.actorId] });
                    const powerUpCast = e.type === "cast" && (e.kind === "buff" || e.kind === "haste");
                    const majorLaneWasBusy = majorVfxBusy();
                    const foldedUltimateCast = e.type === "cast" && !!e.move && duel.events.some((ultimate) => ultimate.type === "ultimate" && ultimate.actorId === e.actorId && ultimate.move === e.move && ultimate.t <= e.t && e.t - ultimate.t <= Math.round(DUEL_TPS * 0.65));
                    if (spotlight && e.perfect) {
                        playPetSfx("buff");
                        onMoveCallout("PERFECT EXECUTION", e.side, supportCast ? "support" : "combo", nameById[e.actorId], el);
                        onFlash(elementColor(el).base, 0.24);
                        hitStop.current = Math.max(hitStop.current, 0.1);
                        shake.current = Math.max(shake.current, 0.9);
                        savor(0.3, 0.28);
                    }
                    const eventIndex = duel.events.indexOf(e);
                    const moveOutcome = duelMoveOutcome(duel.events, eventIndex);
                    const plannedHeroCut = heroCutEventByActor[e.actorId] === eventIndex;
                    const ultimateGetsCutIn = spotlight && (plannedHeroCut || duelHeroCutEligible({
                        actorId: e.actorId,
                        eventType: e.type,
                        move: e.move,
                        heroMove: heroMoveById[e.actorId],
                        outcomeKind: moveOutcome.kind,
                        shownActors: heroCutActors.current,
                    }));
                    if (c && !foldedUltimateCast) {
                        if (supportCast && !majorLaneWasBusy) {
                            // Buff/haste own the dedicated golden 3D power column in
                            // their `buff` event. The generic cyan support flipbook made
                            // those moves look like an incoming hit and visually doubled
                            // the effect. Heal/shield support casts keep this soft gather.
                            if (!powerUpCast) {
                                if (castHeroStyle === "kitsune-tail-cast") spawnPowerUp({ x: c.x, z: c.y, color: "#8f62ff", actorId: c.id, style: castHeroStyle });
                                else spawnImpact({ x: c.x, z: c.y, color: elementColor(el).base, big: false, mode: "tell" });
                            }
                        } else if (!majorLaneWasBusy) {
                            const castKey = e.type === "ultimate" ? "" : moveFxKey(e.kind);
                            if (castKey) spawnFx({ x: c.x, z: c.y, key: castKey, scale: 1.5, dur: 320 });
                            else spawnImpact({ x: c.x, z: c.y, color: elementColor(el).base, big: spotlight && e.type === "ultimate", mode: "tell" });
                            if (spotlight && e.type === "ultimate") {
                                spawnPowerUp({ x: c.x, z: c.y, color: elementColor(el).base, actorId: e.actorId, style: castHeroStyle });
                            }
                        }
                    }
                    if (e.type === "ultimate") {
                        if (ultimateGetsCutIn) {
                            // Each fighter owns one marquee reveal. The UI queues
                            // overlapping cards, so an earlier enemy ultimate can no
                            // longer permanently suppress this actor's showcase beat.
                            heroCutActors.current.add(e.actorId);
                            shake.current = Math.max(shake.current, 1.8);
                            zoomKick.current = Math.max(zoomKick.current, 3.0);
                            onFlash(elementColor(el).glow, 0.42);
                            hitStop.current = Math.max(hitStop.current, 0.18);
                            // Preserve a clean cut -> release -> reaction phrase.
                            // Without this hold the next simulator event could start
                            // before the arena-scale payoff cleared the portrait band.
                            savor(0.14, 0.48);
                            onCutIn(e.actorId, e.move ?? ultById[e.actorId] ?? "");  // anime portrait cut-in
                            if (c) {
                                const p = duelFieldToFloor(c.x, c.y);
                                camAim.current = [p.wx * 0.58, 1.35, CAM_LOOK[2] + p.wz * 0.42];
                                camAimHold.current = Math.max(camAimHold.current, 0.62);
                                camPosBias.current = [p.wx < 0 ? -1.05 : 1.05, -0.82, -0.78];
                                camBiasHold.current = Math.max(camBiasHold.current, 0.48);
                                shotDolly.current = Math.max(shotDolly.current, 1.45);
                                shotDollyHold.current = Math.max(shotDollyHold.current, 0.58);
                            }
                            onAnnounce(`${nameById[e.actorId] ?? "A challenger"} unleashes ${ultById[e.actorId] ?? "their ultimate"}!`, "ultimate");
                        } else if (spotlight && !majorLaneWasBusy) {
                            // A quick REPEAT unleash — lighter beat, no cut-in / heavy shake.
                            shake.current = Math.max(shake.current, 0.6);
                            onFlash(elementColor(el).glow, 0.18);
                            savor(0.72, 0.08);
                        }
                    } else if (spotlight && e.type === "cast" && e.move && !foldedUltimateCast && now - lastMoveCall.current > 0.4) {
                        const heroC = heroMoveById[e.actorId];
                        if (plannedHeroCut || duelHeroCutEligible({ actorId: e.actorId, eventType: e.type, move: e.move, heroMove: heroC, outcomeKind: moveOutcome.kind, shownActors: heroCutActors.current })) {
                            // A ranged / support HERO move → the anime cut-in freeze-frame.
                            heroCutActors.current.add(e.actorId); lastMoveCall.current = now;
                            hitStop.current = Math.max(hitStop.current, 0.12); savor(0.14, 0.48);
                            shake.current = Math.max(shake.current, 1.4); zoomKick.current = Math.max(zoomKick.current, 2.8);
                            onFlash(elementColor(elementById[e.actorId]).glow, 0.38); onCutIn(e.actorId, e.move);
                        } else {
                            // A lesser named ability — the smaller banner + a short savor beat.
                            lastMoveCall.current = now;
                            onMoveCallout(e.move, e.actorId.startsWith("enemy") ? "enemy" : "player", supportCast ? "support" : "attack", nameById[e.actorId], elementById[e.actorId]);
                            savor(supportCast ? 1.08 : 1.02, 0.035);
                        }
                    }
                } else if (e.type === "ko") {
                    // KO finisher: a big element blast on the victim + a hard freeze → deep
                    // slow-mo → camera PULL-BACK reveal. A knockout decides the fight.
                    // The terminal ko event carries no
                    // actorId, so find the downed fighter from the snapshot (this also fixes
                    // the final KO previously showing no blast / no "is down!" line).
                    const dead = e.actorId ? findActor(snapAt, e.actorId) : (snapAt.actors.find((ac) => ac.hp <= 0) ?? null);
                    if (dead) {
                        // The resolving hit already owns the elemental contact.
                        // Do not stack the old expanding cylinder/ring on the KO;
                        // it hid the falling model inside an abstract translucent
                        // dome and made the finisher appear to land twice.
                        // Frame the winner and the fallen pet together. The previous
                        // single-target aim pushed the loser off-screen and made the
                        // victory pose feel disconnected from the finishing blow.
                        const survivor = snapAt.actors.find((actor) => actor.hp > 0 && actor.id !== dead.id);
                        const finisherElement = survivor ? elementById[survivor.id] : elementById[dead.id];
                        spawnScorch({ x: dead.x, z: dead.y, big: true, element: finisherElement, color: elementColor(finisherElement).base });
                        spawnDust({ x: dead.x, z: dead.y });
                        const fallen = duelFieldToFloor(dead.x, dead.y);
                        spawnShock({
                            x: dead.x,
                            z: dead.y,
                            color: elementColor(survivor ? elementById[survivor.id] : elementById[dead.id]).base,
                            big: true,
                        });
                        const standing = survivor ? duelFieldToFloor(survivor.x, survivor.y) : fallen;
                        const pairX = (fallen.wx + standing.wx) * 0.5;
                        const pairZ = (fallen.wz + standing.wz) * 0.5;
                        if (spotlight) {
                            camAim.current = [pairX * 0.62, 1.08, CAM_LOOK[2] + pairZ * 0.46];
                            camAimHold.current = Math.max(camAimHold.current, 1.15);
                        }
                    }
                    if (spotlight) {
                        shake.current = Math.max(shake.current, 3.0);
                        hitStop.current = Math.max(hitStop.current, 0.34);
                        savor(0.44, 0.62);
                        koPull.current = 3.4;
                        duelFovKick.current = Math.max(duelFovKick.current, 3.5);   // stronger lens snap on the finish
                        shotDolly.current = -2.2;
                        shotDollyHold.current = Math.max(shotDollyHold.current, 0.82);
                        camPosBias.current[1] = 2.4;
                    }
                    playPetSfx("ko");
                    if (spotlight) {
                        onFlash("#fff7e6", 0.5);
                        onCallout("FINISH!");
                        if (dead) onAnnounce(`${nameById[dead.id] ?? "A fighter"} is eliminated!`, "ko");
                    }
                } else if (e.type === "stagger" && e.actorId) {
                    // A recoil puff where a fighter got knocked out of its wind-up.
                    const c = findActor(snapAt, e.actorId);
                    if (c) {
                        // THE BIND / THE DEFLECT. These are the loudest beats in the mode
                        // and they were shipping silent — the SFX bank and the impact
                        // system were both already here, the clash simply never called
                        // them. Only the FIRST of the paired staggers sounds, or the
                        // collision double-fires a frame apart and flams.
                        const isBind = e.move === "Clash Bind";
                        const isDeflect = e.move === "Clash";
                        if ((isBind || isDeflect) && e.actorId < String(e.targetId ?? "")) {
                            playPetSfx("crit");
                            spawnShock({ x: c.x, z: c.y, color: "#ffffff", big: isBind });
                            shake.current = Math.max(shake.current, isBind ? 1.5 : 1.1);
                            hitStop.current = Math.max(hitStop.current, isBind ? 0.2 : 0.12);
                            if (isDeflect) onClashResult(null, null);
                        }
                        spawnImpact({ x: c.x, z: c.y, color: "#fca5a5", big: false });
                        const reaction = duelFieldToFloor(c.x, c.y);
                        // Let the white contact frame land, then reveal the knockback
                        // and recovery pose. The small delay is presentation-only and
                        // matches the reference's impact flash -> reaction cut.
                        if (spotlight) window.setTimeout(() => {
                            camAim.current = [reaction.wx * 0.58, 1.25, CAM_LOOK[2] + reaction.wz * 0.42];
                            camAimHold.current = Math.max(camAimHold.current, 0.34);
                            camPosBias.current = [reaction.wx < 0 ? 1.15 : -1.15, 0.2, 0.85];
                            camBiasHold.current = Math.max(camBiasHold.current, 0.3);
                            shotDolly.current = -0.7;
                            shotDollyHold.current = Math.max(shotDollyHold.current, 0.32);
                        }, 145);
                    }
                }
            }
            // ── Play-by-play momentum (render-only; reads the deterministic
            // stream). Commentary fires on narrative beats only: a fighter dropping
            // to the ropes, and the HP lead SWAPPING (a reversal / comeback).
            const snapNow = snaps[Math.min(maxT, cur)];
            if (snapNow) {
                let pHp = 0, pMax = 0, eHp = 0, eMax = 0;
                for (const ac of snapNow.actors) {
                    if (ac.team === "player") { pHp += ac.hp; pMax += ac.maxHp; } else { eHp += ac.hp; eMax += ac.maxHp; }
                    const frac = ac.hp / Math.max(1, ac.maxHp);
                    if (ac.hp > 0 && frac < 0.26 && !lowHp.current.has(ac.id)) {
                        lowHp.current.add(ac.id);
                        onAnnounce(`${nameById[ac.id] ?? "A fighter"} is on the ropes!`, "danger");
                    } else if (frac > 0.5 && lowHp.current.has(ac.id)) {
                        lowHp.current.delete(ac.id);   // healed back up — re-arm the call
                    }
                }
                const pFrac = pHp / Math.max(1, pMax), eFrac = eHp / Math.max(1, eMax);
                const lead = pFrac - eFrac > 0.14 ? "player" : eFrac - pFrac > 0.14 ? "enemy" : "even";
                if (lead !== "even" && leadSide.current !== "even" && lead !== leadSide.current && now - lastReversal.current > 3) {
                    lastReversal.current = now;
                    const who = nameById[lead === "player" ? "player-0" : "enemy-0"] ?? "The underdog";
                    onAnnounce(`Reversal — ${who} storms back!`, "reversal");
                }
                if (lead !== "even") leadSide.current = lead;
            }
            lastTick.current = cur;
        }
        // Perspective hero camera: adaptive framing of the LIVING leads (tighter when
        // they plant close, wider when spread) + per-frame RE-AIM (cuts ease back to the
        // live midpoint) + decaying shake, zoom-punch, and KO pull-back. All render-only.
        // A player command jolts the camera on the frame it lands (bridged from the
        // onClick via the module singleton), so choosing a move is FELT immediately —
        // before the sim resolves it. Consumed once, then decays with the rest.
        if (duelCmdKick.shake > 0) { shake.current = Math.max(shake.current, duelCmdKick.shake); duelCmdKick.shake = 0; }
        if (duelCmdKick.zoom > 0) { zoomKick.current = Math.max(zoomKick.current, duelCmdKick.zoom); duelCmdKick.zoom = 0; }
        const a = shake.current; shake.current *= 0.85;
        const sx = a > 0.01 ? Math.sin(now * 53) * a * 0.1 : 0;
        const sy = a > 0.01 ? Math.sin(now * 61) * a * 0.06 : 0;
        const zk = zoomKick.current; zoomKick.current *= 0.86;
        duelFovKick.current = duelFovKick.current > 0.01 ? duelFovKick.current * 0.86 : 0;   // decay the shared FOV punch (ResponsiveCamera applies it)
        koPull.current = lerp(koPull.current, 0, 0.025);
        // Live framing target from the fighters still standing (midpoint + x spread).
        const camTick = Math.max(0, Math.min(maxT, clock.current.t));
        const camI0 = Math.floor(camTick);
        const camI1 = Math.min(maxT, camI0 + 1);
        const camF = camTick - camI0;
        const camSnap = snaps[camI0];
        const camNext = snaps[camI1] ?? camSnap;
        let cmx = 0, cmz = 0, cn = 0, xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
        const terminalFraming = clock.current.t >= maxT - Math.round(DUEL_TPS * 0.45);
        if (camSnap) for (const ac of camSnap.actors) {
            const nextActor = findActor(camNext, ac.id) ?? ac;
            if (ac.hp <= 0 && nextActor.hp <= 0 && !terminalFraming) continue;
            const p = duelFieldToFloor(lerp(ac.x, nextActor.x, camF), lerp(ac.y, nextActor.y, camF));
            cmx += p.wx; cmz += p.wz; cn++;
            if (p.wx < xmin) xmin = p.wx;
            if (p.wx > xmax) xmax = p.wx;
            if (p.wz < zmin) zmin = p.wz;
            if (p.wz > zmax) zmax = p.wz;
        }
        const midX = cn > 0 ? cmx / cn : 0;
        const midZ = cn > 0 ? cmz / cn : DUEL_FLOOR_Z0;
        // Depth separation matters just as much as left/right separation now that
        // the tactical camera exposes the entire floor instead of flattening it.
        const spread = cn > 1 ? Math.max(xmax - xmin, (zmax - zmin) * 1.35) : 4;
        // A command briefly owns the camera before the authoritative windup takes
        // over. Frame the pet from its side of the axis with the selected target
        // still readable, creating order -> acknowledgement -> execution.
        if (performance.now() < duelCmdFocus.expiresAt && camSnap) {
            const commander = findActor(camSnap, duelCmdFocus.actorId);
            const target = findActor(camSnap, duelCmdFocus.targetId);
            if (commander && target && commander.hp > 0 && target.hp > 0) {
                const cp = duelFieldToFloor(commander.x, commander.y);
                const tp = duelFieldToFloor(target.x, target.y);
                camAim.current = [lerp(cp.wx, tp.wx, 0.32) * 0.9, 1.34, CAM_LOOK[2] + lerp(cp.wz, tp.wz, 0.32) * 0.48];
                camAimHold.current = Math.max(camAimHold.current, 0.08);
                camPosBias.current = [cp.wx <= tp.wx ? -0.72 : 0.72, -0.42, -0.52];
                camBiasHold.current = Math.max(camBiasHold.current, 0.08);
                shotDolly.current = Math.max(shotDolly.current, 0.74);
                shotDollyHold.current = Math.max(shotDollyHold.current, 0.08);
            }
        }
        // Neutral look eases to the live midpoint; a cut HOLDS its own aim until camAimHold decays.
        if (camAimHold.current > 0) camAimHold.current = Math.max(0, camAimHold.current - delta);
        else {
            camAim.current[0] = midX * 0.7;
            camAim.current[1] = DUEL_LOOK_Y;
            camAim.current[2] = CAM_LOOK[2] + midZ * 0.5;
        }
        const lookResponse = camAimHold.current > 0 ? 11.5 : 6.5;
        const lookAlpha = 1 - Math.exp(-lookResponse * Math.min(delta, 1 / 15));
        camLook.current[0] = lerp(camLook.current[0], camAim.current[0], lookAlpha);
        camLook.current[1] = lerp(camLook.current[1], camAim.current[1], lookAlpha);
        camLook.current[2] = lerp(camLook.current[2], camAim.current[2], lookAlpha);
        // Adaptive dolly: pull back to fit the current spread, eased slowly (a gentle
        // breathing zoom, never jitter). Clamped so it never crops or over-tightens.
        // Ordinary exchanges stay close enough to read eyes, paws and recoil.
        // Wide geography still pulls back, but no longer leaves two small pets in
        // a mostly empty stadium during every neutral beat.
        let dollyTarget = Math.max(9.4, Math.min(13.0, 8.2 + spread * 0.66));
        // Opening: pull WIDE for the size-up, then punch in as the pets charge to the face-off,
        // and give a "lock-in" shake the instant they arrive.
        const dollyIntro = clock.current.intro ?? 999;
        if (dollyIntro < INTRO_TOTAL) dollyTarget = lerp(dollyTarget, INTRO_WIDE_DOLLY, introWideHold(dollyIntro));
        else if (dollyIntro < 900 && !introLocked.current) { introLocked.current = true; shake.current = Math.max(shake.current, 1.4); }
        camDolly.current = lerp(camDolly.current, dollyTarget, dollyIntro < INTRO_TOTAL ? 0.1 : 0.03);
        const db = camDollyBias.current; camDollyBias.current *= 0.9;
        if (shotDollyHold.current > 0) shotDollyHold.current = Math.max(0, shotDollyHold.current - delta);
        else shotDolly.current = lerp(shotDolly.current, 0, 0.075);
        const heldShotDolly = shotDolly.current;
        // Ease the transient angle bias (crit low / KO overhead) back to neutral so it reads as
        // a deliberate camera MOVE, not a teleport (R4 — angle variety).
        const pb = camPosBias.current;
        if (camBiasHold.current > 0) camBiasHold.current = Math.max(0, camBiasHold.current - delta);
        else { pb[0] = lerp(pb[0], 0, 0.045); pb[1] = lerp(pb[1], 0, 0.045); pb[2] = lerp(pb[2], 0, 0.045); }
        // A portrait canvas has less than half the horizontal field of the desktop
        // shot. Preserve the camera pitch while pulling the physical camera back;
        // relying on FOV alone produced severe fisheye and still cropped the pets.
        const viewportAspect = size.width / Math.max(1, size.height);
        const responsiveShot = duelCameraComposition(viewportAspect);
        // A hit can set zoomKick, shotDolly, camDollyBias and a positional Z bias
        // on the same frame. Treat them as one authored camera move and clamp the
        // result, otherwise the combined push crops a fighter and the giant VFX.
        const requestedCinematicZ = -(zk + db + heldShotDolly) + pb[2];
        const safeCinematicZ = THREE.MathUtils.clamp(requestedCinematicZ, -responsiveShot.maxPushIn, responsiveShot.maxPullBack);
        const desiredEye: [number, number, number] = [
            CAM_POS[0] + midX * 0.24 + pb[0] * responsiveShot.cinematicScale,
            // Portrait needs horizontal room much more than extra elevation. Pull
            // mostly backward so both silhouettes and their Html nameplates stay
            // inside the narrow frame without turning the arena into a fisheye view.
            DUEL_CAMERA_Y + pb[1] * responsiveShot.cinematicScale + responsiveShot.elevation,
            camDolly.current + safeCinematicZ * responsiveShot.cinematicScale + koPull.current + responsiveShot.pullBack,
        ];
        const eyeResponse = (camBiasHold.current > 0 || shotDollyHold.current > 0) ? 10.5 : 6.2;
        const eyeAlpha = 1 - Math.exp(-eyeResponse * Math.min(delta, 1 / 15));
        camEye.current[0] = lerp(camEye.current[0], desiredEye[0], eyeAlpha);
        camEye.current[1] = lerp(camEye.current[1], desiredEye[1], eyeAlpha);
        camEye.current[2] = lerp(camEye.current[2], desiredEye[2], eyeAlpha);
        camera.position.set(camEye.current[0] + sx, camEye.current[1] + sy, camEye.current[2]);
        camera.lookAt(camLook.current[0], camLook.current[1], camLook.current[2]);
        // `canEnd` guards the LIVE (player-controlled) duel: there, maxT is the edge
        // of the simulated buffer, not the end of the fight, so catching up to it
        // mid-match must never be mistaken for the finish.
        if (!ended.current && canEnd && clock.current.t >= maxT) {
            if (!endHold.current) endHold.current = now + 1.95;
            else if (now >= endHold.current) { ended.current = true; onEnd(); }
        }
    });
    return null;
}


/** Element-colored impact burst — an expanding additive ring + flash core. */
function DuelImpact({ at, color, big, mode = "impact", onDone }: { at: Vec3; color: string; big: boolean; mode?: DuelImpactMode; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const core = useRef<THREE.Mesh>(null);
    const coreMat = useRef<THREE.MeshToonMaterial>(null);
    const haloMat = useRef<THREE.MeshBasicMaterial>(null);
    const ringOne = useRef<THREE.MeshBasicMaterial>(null);
    const ringTwo = useRef<THREE.MeshBasicMaterial>(null);
    const slashMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const start = useRef<number | null>(null);
    const duration = mode === "tell" ? 0.46 : mode === "dodge" ? 0.3 : big ? 0.56 : 0.38;
    const contactCore = useMemo(() => new THREE.Color(color).lerp(new THREE.Color("#fff1b8"), 0.08).getStyle(), [color]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / duration);
        const rise = 1 - Math.pow(1 - p, 2);
        const fade = 1 - p;
        if (root.current) {
            const scale = mode === "tell" ? 0.46 + rise * (big ? 1.08 : 0.72) : mode === "dodge" ? 0.28 + rise * 0.52 : 0.34 + rise * (big ? 2.18 : 1.28);
            root.current.scale.setScalar(scale);
            root.current.rotation.y = p * (mode === "dodge" ? -1.35 : 1.9);
        }
        if (core.current) {
            core.current.rotation.x = p * 4.2;
            core.current.rotation.y = p * 5.6;
            core.current.scale.setScalar(mode === "impact" ? 0.42 + (1 - Math.abs(p - 0.33) * 2) * (big ? 0.46 : 0.32) : 0.42 + rise * 0.2);
        }
        if (coreMat.current) coreMat.current.opacity = mode === "impact" ? Math.max(0, (1 - p * 1.42)) * 0.5 : fade * 0.2;
        if (haloMat.current) haloMat.current.opacity = fade * (mode === "impact" ? 0.48 : 0.32);
        if (ringOne.current) ringOne.current.opacity = fade * (mode === "tell" ? 0.36 : 0.3);
        if (ringTwo.current) ringTwo.current.opacity = Math.max(0, fade - 0.16) * (mode === "dodge" ? 0.38 : 0.2);
        slashMats.current.forEach((material, index) => {
            if (!material) return;
            const contact = Math.max(0, 1 - p * (index === 1 ? 2.9 : 2.35));
            material.opacity = contact * (big ? 0.94 : 0.76) * (index === 2 ? 0.72 : 1);
        });
        if (p >= 1) onDone();
    });
    const floorOnly = mode !== "impact";
    return (
        <group ref={root} position={at}>
            {floorOnly ? (
                <group>
                    <mesh position={mode === "dodge" ? [-0.46, 0.22, 0.08] : [-0.34, 0.38, 0.12]} rotation={[0, 0, mode === "dodge" ? -1.08 : -0.16]} scale={[1, mode === "dodge" ? 1.45 : 1, 1]}>
                        <coneGeometry args={[0.05, 0.74, 5]} />
                        <meshBasicMaterial ref={ringOne} color={color} transparent opacity={0.38} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                    <mesh position={mode === "dodge" ? [0.4, 0.34, -0.08] : [0.36, 0.48, -0.12]} rotation={[0, 0, mode === "dodge" ? 1.02 : 0.14]} scale={[0.78, mode === "dodge" ? 1.3 : 0.82, 0.78]}>
                        <coneGeometry args={[0.045, 0.68, 5]} />
                        <meshBasicMaterial ref={ringTwo} color={mode === "dodge" ? "#dff9ff" : color} transparent opacity={0.28} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                </group>
            ) : (
                <>
                    <mesh ref={core} position={[0, 0.12, 0]}>
                        <icosahedronGeometry args={[0.28, 1]} />
                        <meshToonMaterial ref={coreMat} color={contactCore} emissive={color} emissiveIntensity={0.34} transparent opacity={0.88} depthWrite={false} />
                    </mesh>
                    {/* Graphic contact frame: three camera-facing saber streaks
                        form the asymmetric white X seen in strong hand-drawn hits.
                        It exists for only the first few frames; the colored 3D
                        element burst then supplies mass and dissipation. */}
                    <Billboard position={[0, 0.12, 0.05]}>
                        {[0.7, -0.72, 0.04].map((rotation, index) => (
                            <mesh key={`contact-slash-${index}`} rotation={[0, 0, rotation]} scale={index === 2 ? [0.76, 1, 1] : [1, 1, 1]}>
                                <planeGeometry args={[big ? 3.55 : 2.15, big ? 0.15 : 0.095]} />
                                <meshBasicMaterial
                                    ref={(material) => { slashMats.current[index] = material; }}
                                    color={index === 2 ? color : contactCore}
                                    transparent
                                    opacity={0.9}
                                    depthWrite={false}
                                    toneMapped={false}
                                    blending={THREE.AdditiveBlending}
                                />
                            </mesh>
                        ))}
                    </Billboard>
                    <mesh position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
                        <torusGeometry args={[0.5, 0.032, 6, 24]} />
                        <meshBasicMaterial ref={haloMat} color={color} transparent opacity={0.7} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                </>
            )}
        </group>
    );
}


/** Element contact rendered as layered, beveled anime brushwork. Every element
 * has its own silhouette while the shared dark/body/highlight stack matches the
 * outlined, sculpted pet materials. Rings, spheres, and crystals are secondary. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelElementBurst({ at, kind, color, big, heading, onDone }: { at: Vec3; kind: DuelElementBurstKind; color: string; big: boolean; heading: number; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const pieces = useRef<Array<THREE.Group | null>>([]);
    const materials = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const palette = useMemo(() => duelFxPalette(kind, color), [kind, color]);
    const specs = useMemo(() => {
        const count = big ? 4 : 3;
        return Array.from({ length: count }, (_, i) => {
            const lane = i - (count - 1) * 0.5;
            const fireLike = kind === "fire" || kind === "abyss";
            return {
                lane,
                length: (big ? 1.34 : 1.0) * (0.82 + (i % 3) * 0.11),
                width: (big ? 0.25 : 0.19) * (0.88 + (i % 2) * 0.16),
                curl: fireLike ? 0.44 + (i % 3) * 0.12 : kind === "water" ? 0.66 + (i % 2) * 0.18 : kind === "wind" ? 0.3 : kind === "earth" ? 0.12 : 0.2,
                jagged: kind === "lightning" ? 0.2 : kind === "earth" ? 0.075 : 0,
                lift: 0.34 + (i % 3) * 0.28 + Math.abs(lane) * 0.05,
                roll: (-0.68 + i * (1.36 / Math.max(1, count - 1))) + (fireLike ? lane * 0.07 : 0),
                yaw: lane * (kind === "water" ? 0.16 : 0.11),
            };
        });
    }, [big, kind]);
    const geometries = useMemo(() => specs.map((spec) => makeAnimeStrokeGeometry(spec.length, spec.width, spec.curl, spec.jagged)), [specs]);
    useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
    const duration = big ? 0.82 : 0.62;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / duration);
        const open = 1 - Math.pow(1 - Math.min(1, p / 0.34), 3);
        const settle = Math.sin(Math.PI * Math.min(1, p / 0.72));
        const fade = p < 0.68 ? 1 : Math.max(0, 1 - (p - 0.68) / 0.32);
        if (root.current) {
            root.current.rotation.y = heading;
            root.current.scale.setScalar((big ? 0.92 : 0.74) * (0.3 + open * 0.82));
        }
        pieces.current.forEach((piece, i) => {
            if (!piece) return;
            const spec = specs[i];
            piece.position.set(open * (0.18 + i % 2 * 0.12), spec.lift + settle * (0.12 + i % 3 * 0.05), spec.lane * (big ? 0.25 : 0.19) * open);
            piece.rotation.set(kind === "water" ? -0.08 : lanePitch(kind, i), spec.yaw, spec.roll);
        });
        materials.current.forEach((material) => {
            if (material) material.opacity = Number(material.userData.baseOpacity ?? 1) * fade;
        });
        if (light.current) light.current.intensity = fade * settle * (big ? 4.2 : 2.3);
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });
    return (
        <group ref={root} position={[at[0], at[1] + 0.06, at[2]]} scale={0.01}>
            {specs.map((spec, i) => (
                <group key={`anime-strike-${i}`} ref={(group) => { pieces.current[i] = group; }}>
                    <mesh geometry={geometries[i]} position={[0, 0, -0.025]} scale={[1.035, 1.035, 1.06]}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.24; materials.current[i * 3] = material; } }} color={palette.dark} transparent opacity={0.24} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={geometries[i]}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.94; materials.current[i * 3 + 1] = material; } }} color={i % 3 === 0 ? palette.accent : palette.body} emissive={palette.accent} emissiveIntensity={0.08} transparent opacity={0.94} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={geometries[i]} position={[spec.length * 0.14, spec.width * 0.08, 0.07]} scale={[0.66, 0.34, 0.7]}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.84; materials.current[i * 3 + 2] = material; } }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.12} transparent opacity={0.84} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            ))}
            {kind === "earth" && Array.from({ length: big ? 7 : 4 }, (_, i) => (
                <mesh key={`earth-chip-${i}`} position={[0.15 + (i % 2) * 0.25, 0.22 + (i % 3) * 0.24, (i - 2) * 0.24]} rotation={[i * 0.7, i * 0.9, i * 0.44]} scale={[0.16, 0.28, 0.18]}>
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshToonMaterial color={i % 2 ? palette.body : palette.accent} />
                </mesh>
            ))}
            <Sparkles count={big ? 14 : 8} scale={big ? [3.8, 2.8, 3.4] : [2.6, 1.9, 2.4]} size={big ? 1.8 : 1.35} speed={2.2} opacity={0.4} color={palette.core} noise={1.25} />
            <pointLight ref={light} color={palette.accent} intensity={0} distance={big ? 7.5 : 4.8} decay={2} />
        </group>
    );
}


function lanePitch(kind: DuelElementBurstKind, index: number): number {
    if (kind === "water") return -0.08;
    if (kind === "wind") return (index % 2 ? 1 : -1) * 0.12;
    if (kind === "earth") return 0.1 + (index % 3) * 0.09;
    return (index % 2 ? 1 : -1) * 0.06;
}


/** The consequence after contact. Immediate flashes sell the exact hit frame;
 * this lower, toon-shaded residue stays underneath the defender's recoil so the
 * viewer sees that the launched ability actually changed the space it struck. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelElementAftermath({ at, kind, color, big, onDone }: { at: Vec3; kind: DuelElementBurstKind; color: string; big: boolean; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const pieces = useRef<Array<THREE.Mesh | null>>([]);
    const materials = useRef<Array<THREE.Material & { opacity: number }>>([]);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const count = big ? 9 : 6;
    const flames = useMemo(() => kind === "fire" || kind === "abyss"
        ? Array.from({ length: count }, (_, i) => makeFlameRibbonGeometry(0.58 + (i % 3) * 0.16, 0.11 + (i % 2) * 0.025, 0.18 + (i % 3) * 0.07, i * 0.83))
        : [], [kind, count]);
    useEffect(() => () => flames.forEach((geometry) => geometry.dispose()), [flames]);
    const palette = kind === "fire"
        ? { body: "#d93616", accent: "#ff9418", core: "#ffe895", dark: "#45140c" }
        : kind === "water"
            ? { body: "#0877bd", accent: "#35cae6", core: "#d8fbff", dark: "#062f5d" }
            : kind === "wind"
                ? { body: "#14796f", accent: "#54d8bd", core: "#dcfff5", dark: "#083f43" }
                : kind === "lightning"
                    ? { body: "#6244cb", accent: "#c5a9ff", core: "#fff4a8", dark: "#211549" }
                    : kind === "earth"
                        ? { body: "#754321", accent: "#d39a45", core: "#ffe0a1", dark: "#301b11" }
                        : kind === "abyss"
                            ? { body: "#481036", accent: "#e42250", core: "#ffb092", dark: "#16091f" }
                            : { body: color, accent: "#bb9cff", core: "#fff1d4", dark: "#241538" };
    const register = (material: (THREE.Material & { opacity: number }) | null) => {
        if (!material || materials.current.includes(material)) return;
        material.userData.baseOpacity = material.opacity;
        materials.current.push(material);
    };
    const duration = big ? 1.48 : 1.08;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / duration);
        const arrive = 1 - Math.pow(1 - Math.min(1, p / 0.18), 3);
        const fade = p < 0.58 ? 1 : Math.max(0, 1 - (p - 0.58) / 0.42);
        if (root.current) {
            root.current.scale.setScalar((big ? 1.62 : 1.14) * (0.72 + arrive * 0.34));
            root.current.rotation.y = elapsed * (kind === "wind" ? 0.72 : kind === "water" ? 0.22 : 0.08);
        }
        pieces.current.forEach((piece, i) => {
            if (!piece) return;
            piece.rotation.y += (kind === "wind" ? 0.045 : 0.014) * (i % 2 ? -1 : 1);
            piece.position.y = 0.05 + Math.sin(elapsed * (5 + i % 3) + i) * (kind === "water" || kind === "wind" ? 0.045 : 0.018);
        });
        for (const material of materials.current) material.opacity = Number(material.userData.baseOpacity ?? 0.6) * fade;
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });
    return (
        <group ref={root} position={[at[0], FLOOR_Y + 0.04, at[2]]}>
            {/* Dark normal-blended footing anchors the saturated toon pieces to the
                arena instead of making them look like unrelated glowing UI. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[big ? 1.28 : 0.92, 48]} />
                <meshBasicMaterial ref={register} color={palette.dark} transparent opacity={0.34} depthWrite={false} blending={THREE.NormalBlending} />
            </mesh>
            {[0, 1].map((i) => (
                <mesh key={`aftermath-ring-${i}`} position={[0, 0.018 + i * 0.012, 0]} rotation={[Math.PI / 2, i * 0.6, 0]} scale={1 + i * 0.28}>
                    <torusGeometry args={[0.62, i === 0 ? 0.055 : 0.025, 7, 40, Math.PI * (i === 0 ? 1.55 : 1.2)]} />
                    <meshToonMaterial ref={register} color={i === 0 ? palette.body : palette.core} emissive={palette.accent} emissiveIntensity={0.12} transparent opacity={i === 0 ? 0.72 : 0.46} depthWrite={false} />
                </mesh>
            ))}
            {Array.from({ length: count }, (_, i) => {
                const a = (i / count) * Math.PI * 2 + (i % 2) * 0.18;
                const radius = 0.42 + (i % 3) * 0.2;
                const common = {
                    ref: (mesh: THREE.Mesh | null) => { pieces.current[i] = mesh; },
                    position: [Math.cos(a) * radius, 0.05, Math.sin(a) * radius] as [number, number, number],
                    rotation: [0, -a, (i % 2 ? -1 : 1) * 0.22] as [number, number, number],
                };
                if (kind === "fire" || kind === "abyss") return (
                    <mesh key={`aftermath-piece-${i}`} {...common} geometry={flames[i]} scale={0.78 + (i % 3) * 0.12}>
                        <meshToonMaterial ref={register} color={i % 3 === 0 ? palette.accent : palette.body} emissive={palette.accent} emissiveIntensity={0.18} transparent opacity={0.84} depthWrite={false} />
                    </mesh>
                );
                if (kind === "water") return (
                    <mesh key={`aftermath-piece-${i}`} {...common} rotation={[Math.PI / 2, a, 0]} scale={[0.72 + (i % 2) * 0.2, 0.72, 0.42]}>
                        <torusGeometry args={[0.34, 0.07, 7, 24, Math.PI * 1.25]} />
                        <meshToonMaterial ref={register} color={i % 3 === 0 ? palette.core : palette.body} emissive={palette.accent} emissiveIntensity={0.14} transparent opacity={0.8} depthWrite={false} />
                    </mesh>
                );
                if (kind === "wind") return (
                    <mesh key={`aftermath-piece-${i}`} {...common} rotation={[Math.PI / 2, a, i * 0.31]} scale={0.72 + (i % 3) * 0.12}>
                        <torusGeometry args={[0.42, 0.055, 7, 26, Math.PI * 1.1]} />
                        <meshToonMaterial ref={register} color={i % 3 === 0 ? palette.core : palette.body} emissive={palette.accent} emissiveIntensity={0.14} transparent opacity={0.76} depthWrite={false} />
                    </mesh>
                );
                if (kind === "earth") return (
                    <mesh key={`aftermath-piece-${i}`} {...common} rotation={[i * 0.47, a, i * 0.31]} scale={[0.24, 0.38 + (i % 3) * 0.09, 0.24]}>
                        <dodecahedronGeometry args={[1, 0]} />
                        <meshToonMaterial ref={register} color={i % 3 === 0 ? palette.accent : palette.body} emissive={palette.dark} emissiveIntensity={0.08} transparent opacity={0.92} depthWrite={false} />
                    </mesh>
                );
                return (
                    <mesh key={`aftermath-piece-${i}`} {...common} rotation={[i * 0.38, a, i * 0.62]} scale={[0.15, 0.42 + (i % 3) * 0.12, 0.15]}>
                        <octahedronGeometry args={[1, 0]} />
                        <meshToonMaterial ref={register} color={i % 3 === 0 ? palette.core : palette.body} emissive={palette.accent} emissiveIntensity={0.24} transparent opacity={0.88} depthWrite={false} />
                    </mesh>
                );
            })}
            <Sparkles count={big ? 24 : 13} scale={big ? [3.8, 1.8, 3.8] : [2.8, 1.2, 2.8]} position={[0, 0.58, 0]} size={big ? 2.1 : 1.6} speed={0.9} opacity={0.46} color={palette.core} noise={1.25} />
        </group>
    );
}


type DuelElementVolumePhase = "contact" | "aftermath" | "signature" | "dash";


const ELEMENT_VOLUME_CURVE_CACHE = new Map<string, readonly THREE.TubeGeometry[]>();

const HERO_MOVE_STROKE_CACHE = new Map<string, readonly THREE.ExtrudeGeometry[]>();


function duelElementCurveCount(kind: DuelElementBurstKind, phase: DuelElementVolumePhase, big: boolean, quality: PetVisualQuality): number {
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
function makeElementVolumeCurve(kind: DuelElementBurstKind, index: number, phase: DuelElementVolumePhase): THREE.TubeGeometry {
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


function cachedElementVolumeCurves(kind: DuelElementBurstKind, phase: DuelElementVolumePhase, count: number): readonly THREE.TubeGeometry[] {
    const key = `${kind}:${phase}:${count}`;
    const cached = ELEMENT_VOLUME_CURVE_CACHE.get(key);
    if (cached) return cached;
    const geometries = Object.freeze(Array.from({ length: count }, (_, index) => makeElementVolumeCurve(kind, index, phase)));
    ELEMENT_VOLUME_CURVE_CACHE.set(key, geometries);
    return geometries;
}


function cachedHeroMoveStrokes(style: PetHeroMoveStyle, quality: PetVisualQuality): readonly THREE.ExtrudeGeometry[] {
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


function scheduleDuelFxGeometryPrewarm(kinds: readonly DuelElementBurstKind[], quality: PetVisualQualityConfig): () => void {
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


/** One coherent 3D material language for every live elemental contact. It is
 * intentionally shape-led: fire rises and curls, water splashes, wind funnels,
 * lightning branches, earth displaces mass, abyss smolders, and arcane energy
 * orbits. The effect scales from a quick hit to an arena signature without
 * falling back to the old beveled brush cards. */
function DuelElementVolume({ at, kind, color, big, heading = 0, phase, quality, heroStyle = "generic", delay = 0, simClock, simStartTick, onDone }: {
    at: Vec3;
    kind: DuelElementBurstKind;
    color: string;
    big: boolean;
    heading?: number;
    phase: DuelElementVolumePhase;
    quality: PetVisualQualityConfig;
    heroStyle?: PetHeroMoveStyle;
    delay?: number;
    simClock?: { current: DuelClock };
    simStartTick?: number;
    onDone: () => void;
}) {
    const root = useRef<THREE.Group>(null);
    const core = useRef<THREE.Group>(null);
    const arenaSeal = useRef<THREE.Group>(null);
    const motifs = useRef<Array<THREE.Group | null>>([]);
    const particles = useRef<THREE.InstancedMesh>(null);
    const sparks = useRef<THREE.InstancedMesh>(null);
    const sparkMat = useRef<THREE.MeshBasicMaterial>(null);
    const materials = useRef<Array<(THREE.Material & { opacity: number }) | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const palette = useMemo(() => duelFxPalette(kind, color), [kind, color]);
    const signature = phase === "signature";
    const aftermath = phase === "aftermath";
    const low = quality.id === "low";
    const curveCount = duelElementCurveCount(kind, phase, big, quality.id);
    const heroMove = heroStyle !== "generic";
    const particleCount = signature
        ? Math.max(quality.impactDebris, Math.ceil(quality.setPieceParticles * 0.34))
        : aftermath
            ? Math.max(3, Math.round(quality.impactDebris * 0.65))
            : heroMove || big
                ? quality.impactDebris
                : Math.max(3, Math.round(quality.impactDebris * 0.72));
    const sparkCount = aftermath ? 0 : signature ? Math.ceil(quality.impactSparks * 1.4) : quality.impactSparks;
    const earthSpireCount = signature ? Math.max(4, quality.impactDebris) : Math.max(3, Math.round(quality.impactDebris * (big ? 0.72 : 0.5)));
    // Curves are immutable and shared by every repeat of the same move class.
    // Rebuilding TubeGeometry synchronously on each hit was the largest visible
    // CPU hitch in effect-heavy exchanges.
    const curves = useMemo(() => cachedElementVolumeCurves(kind, phase, curveCount), [curveCount, kind, phase]);
    // Ordinary contacts already own curved element volumes, particles, body
    // posing and camera response. The extruded hero cards are reserved for a
    // true signature set piece; layering them onto buffs, hits or dashes created
    // fighter-sized opaque wedges that read as broken model geometry.
    const heroStrokes = useMemo(
        () => phase === "signature" ? cachedHeroMoveStrokes(heroStyle, quality.id) : [],
        [heroStyle, phase, quality.id],
    );
    const particleDummy = useMemo(() => new THREE.Object3D(), []);
    const sparkDummy = useMemo(() => new THREE.Object3D(), []);
    const hdrSparkColor = useMemo(() => new THREE.Color(palette.core).multiplyScalar(2.4), [palette.core]);
    const particleGeometry = useMemo<THREE.BufferGeometry>(() => {
        if (kind === "water") return new THREE.IcosahedronGeometry(signature ? 0.13 : 0.085, 0);
        if (kind === "earth") return new THREE.DodecahedronGeometry(signature ? 0.16 : 0.11, 0);
        if (kind === "lightning") return new THREE.TetrahedronGeometry(signature ? 0.13 : 0.085, 0);
        if (kind === "abyss") return new THREE.IcosahedronGeometry(signature ? 0.18 : 0.11, 0);
        return new THREE.OctahedronGeometry(signature ? 0.12 : 0.08, 0);
    }, [kind, signature]);
    useEffect(() => () => particleGeometry.dispose(), [particleGeometry]);
    useEffect(() => {
        const mesh = particles.current;
        if (!mesh) return;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let index = 0; index < particleCount; index++) {
            const isSmoke = kind === "abyss" && index % 3 === 0;
            const particleColor = isSmoke ? palette.dark : index % 4 === 0 ? palette.core : index % 2 ? palette.accent : palette.body;
            mesh.setColorAt(index, new THREE.Color(particleColor));
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, [kind, palette, particleCount]);
    useEffect(() => {
        if (sparks.current) sparks.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }, [sparkCount]);
    const duration = signature ? 1.86 : aftermath ? (big ? 1.34 : 1.08) : phase === "dash" ? (heroMove ? 1.02 : 0.9) : heroMove ? 0.96 : big ? 0.9 : 0.64;
    // Named abilities occupy the missing middle tier: clearly larger than a basic
    // contact, but still well below an arena-owning tsunami or tornado.
    const basePhaseScale = signature ? 1.8 : aftermath ? (big ? 1.34 : 1.04) : phase === "dash" ? (big ? 1.06 : 0.82) : big ? 1.56 : 0.98;
    const phaseScale = basePhaseScale * (heroMove ? phase === "dash" ? 1.08 : 1.28 : 1);
    const register = (material: (THREE.Material & { opacity: number }) | null, index: number, baseOpacity: number) => {
        if (!material) return;
        material.userData.baseOpacity = baseOpacity;
        materials.current[index] = material;
    };
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        // Dash contact shares the replay clock with the travelling pet, so
        // hit-stop freezes the volume on the same bright collision frame. Other
        // effects retain their wall-clock lifetime.
        const elapsed = simClock && simStartTick !== undefined
            ? (simClock.current.t - simStartTick) / DUEL_TPS
            : state.clock.elapsedTime - start.current - delay;
        if (elapsed < 0) {
            // Keep the subtree renderable at an effectively invisible scale so
            // WebGL compiles the materials during anticipation, never on impact.
            if (root.current) {
                root.current.visible = true;
                root.current.scale.setScalar(0.001);
            }
            materials.current.forEach((material) => { if (material) material.opacity = 0; });
            return;
        }
        if (root.current) root.current.visible = true;
        const p = Math.min(1, elapsed / duration);
        const open = 1 - Math.pow(1 - Math.min(1, p / (signature ? 0.2 : 0.25)), 3);
        const fadeStart = aftermath ? 0.52 : signature ? 0.76 : 0.62;
        const fade = p < fadeStart ? 1 : Math.max(0, 1 - (p - fadeStart) / (1 - fadeStart));
        const impactPulse = 0.92 + Math.sin(Math.min(1, p / 0.3) * Math.PI) * (signature ? 0.12 : 0.18);
        if (root.current) {
            // Authored brush accents are staged toward the broadcast camera.
            // Rotating their thin profile into the world-space travel heading
            // made them read as tall rectangular slabs from common shot angles.
            root.current.rotation.y = heroMove ? 0 : heading + (kind === "wind" || kind === "arcane" ? elapsed * (kind === "wind" ? 1.8 : 0.72) : 0);
            root.current.scale.setScalar(Math.max(0.001, phaseScale * open * impactPulse));
        }
        if (core.current) {
            const corePulse = 0.76 + Math.sin(elapsed * (kind === "lightning" ? 26 : 12)) * 0.08;
            core.current.scale.setScalar(corePulse * (aftermath ? 0.62 : 1));
            core.current.rotation.set(elapsed * 0.7, elapsed * 1.4, -elapsed * 0.52);
        }
        if (arenaSeal.current) {
            arenaSeal.current.rotation.y = elapsed * 0.82;
            const sealPulse = 0.78 + open * 0.22 + Math.sin(elapsed * 8.4) * 0.025;
            arenaSeal.current.scale.setScalar(Math.max(0.001, sealPulse));
        }
        motifs.current.forEach((group, index) => {
            if (!group) return;
            const direction = index % 2 ? -1 : 1;
            group.rotation.y = elapsed * (kind === "wind" ? 3.4 : kind === "arcane" ? 1.45 : 0.42) * direction + index * 0.37;
            group.scale.setScalar(0.72 + open * 0.28 + Math.sin(elapsed * 7 + index) * 0.035);
        });
        const particleMesh = particles.current;
        if (particleMesh) for (let index = 0; index < particleCount; index++) {
            const angle = index * 2.399 + heading;
            const speed = 0.42 + (index % 4) * 0.13;
            const travel = Math.min(1, p * (signature ? 1.3 : 1.65));
            const radius = (signature ? 0.58 : 0.32) + travel * speed * (signature ? 2.3 : 1.45);
            const lift = kind === "earth"
                ? Math.sin(Math.PI * travel) * (signature ? 1.35 : 0.62)
                : kind === "water"
                    ? Math.sin(Math.PI * travel) * (signature ? 2.0 : 0.95)
                    : travel * (signature ? 2.1 : 0.92);
            particleDummy.position.set(Math.cos(angle) * radius, (aftermath ? 0.08 : 0.16) + lift, Math.sin(angle) * radius);
            particleDummy.rotation.set(elapsed * (1.8 + index % 3), angle, elapsed * (2.4 + index % 2));
            particleDummy.scale.setScalar((0.68 + (index % 3) * 0.16) * fade * (0.5 + open * 0.5));
            particleDummy.updateMatrix();
            particleMesh.setMatrixAt(index, particleDummy.matrix);
        }
        if (particleMesh) particleMesh.instanceMatrix.needsUpdate = true;
        const sparkMesh = sparks.current;
        if (sparkMesh) {
            for (let index = 0; index < sparkCount; index++) {
                const delayed = Math.max(0, Math.min(1, (p - (index % 4) * 0.018) / 0.38));
                const angle = index * 2.399 + heading + (index % 2) * 0.22;
                const radius = delayed * (0.54 + (index % 4) * 0.16) * (signature ? 1.8 : big ? 1.25 : 1);
                sparkDummy.position.set(Math.sin(angle) * radius, 0.22 + delayed * (0.42 + (index % 3) * 0.16), Math.cos(angle) * radius);
                sparkDummy.rotation.set(-0.18 + (index % 3) * 0.13, angle, angle * 0.18);
                const sparkFade = Math.max(0, 1 - delayed);
                sparkDummy.scale.set(sparkFade, sparkFade, (0.65 + (index % 3) * 0.22) * sparkFade);
                sparkDummy.updateMatrix();
                sparkMesh.setMatrixAt(index, sparkDummy.matrix);
            }
            sparkMesh.instanceMatrix.needsUpdate = true;
        }
        if (sparkMat.current) sparkMat.current.opacity = Math.max(0, Math.min(1, p / 0.06, (0.46 - p) / 0.18)) * (signature ? 0.96 : 0.78);
        materials.current.forEach((material) => {
            if (material) material.opacity = Number(material.userData.baseOpacity ?? 1) * fade;
        });
        if (light.current) light.current.intensity = fade * Math.sin(Math.PI * Math.min(1, p * 1.65)) * (signature ? 6.4 : big ? 3.5 : 2.2);
        if (p >= 1 && !completed.current) {
            completed.current = true;
            onDone();
        }
    });

    const curveMaterial = (index: number) => (
        <meshToonMaterial
            ref={(material) => register(material, index, aftermath ? 0.62 : heroMove ? (index % 3 === 0 ? 0.68 : 0.52) : index % 3 === 0 ? 0.94 : 0.78)}
            color={index % 4 === 0 ? palette.core : index % 2 ? palette.accent : palette.body}
            emissive={palette.accent}
            emissiveIntensity={signature ? 0.18 : 0.09}
            transparent
            opacity={0}
            depthWrite={false}
        />
    );
    const coreMaterialIndex = curveCount;
    const particleMaterialOffset = coreMaterialIndex + 2;
    const coreShape = kind === "water" ? <sphereGeometry args={[0.56, low ? 16 : 24, low ? 10 : 16]} />
        : kind === "wind" ? <sphereGeometry args={[0.38, low ? 12 : 18, low ? 8 : 12]} />
            : kind === "earth" ? <dodecahedronGeometry args={[0.66, 0]} />
                : kind === "lightning" ? <octahedronGeometry args={[0.58, 0]} />
                    : <icosahedronGeometry args={[0.58, 1]} />;
    return (
        <group ref={root} position={at} visible={delay <= 0} scale={0.001}>
            <group ref={core} position={[0, aftermath ? 0.12 : kind === "lightning" && signature ? 0.42 : 0.36, 0]} scale={0.01}>
                <mesh scale={kind === "water" ? [1.25, 0.72, 1.05] : kind === "earth" ? [1.1, 0.76, 1.15] : kind === "wind" ? [0.76, 1.45, 0.76] : [1, 1, 1]} castShadow={kind === "earth"}>
                    {coreShape}
                    <meshToonMaterial ref={(material) => register(material, coreMaterialIndex, aftermath ? 0.38 : phase === "dash" ? (heroMove ? 0.42 : 0.54) : heroMove ? 0.68 : 0.88)} color={palette.body} emissive={palette.accent} emissiveIntensity={signature ? 0.26 : 0.12} transparent opacity={0} depthWrite={kind === "earth"} />
                </mesh>
                {!aftermath && kind !== "earth" && (
                    <mesh scale={kind === "water" ? [0.78, 0.52, 0.72] : [0.62, 0.62, 0.62]}>
                        {coreShape}
                        <meshToonMaterial ref={(material) => register(material, coreMaterialIndex + 1, phase === "dash" ? (heroMove ? 0.28 : 0.4) : heroMove ? 0.48 : 0.74)} color={palette.core} emissive={palette.accent} emissiveIntensity={0.24} transparent opacity={0} depthWrite={false} />
                    </mesh>
                )}
            </group>

            {curves.map((geometry, index) => (
                <group key={`element-volume-curve-${index}`} ref={(group) => { motifs.current[index] = group; }} rotation={[0, index * 0.31, kind === "arcane" ? (index % 3 - 1) * 0.64 : 0]}>
                    <mesh geometry={geometry} position={kind === "lightning" && signature ? [0, 0.02, 0] : [0, aftermath ? 0.04 : -0.18, 0]} renderOrder={34 + index % 2}>
                        {curveMaterial(index)}
                    </mesh>
                </group>
            ))}

            {kind === "earth" && Array.from({ length: earthSpireCount }, (_, index) => {
                const angle = index * 2.399;
                const radius = 0.28 + (index % 4) * (signature ? 0.36 : 0.2);
                const height = (signature ? 1.55 : aftermath ? 0.52 : 0.9) * (0.75 + (index % 3) * 0.18);
                return (
                    <group key={`earth-spire-${index}`} ref={(group) => { motifs.current[index] = group; }} position={[Math.cos(angle) * radius, height * 0.42, Math.sin(angle) * radius]} rotation={[0.08 * (index % 2), -angle, (index % 2 ? -1 : 1) * 0.12]}>
                        <mesh scale={[0.32 + (index % 2) * 0.08, height, 0.34 + (index % 3) * 0.035]} castShadow>
                            <dodecahedronGeometry args={[0.62, 0]} />
                            <meshToonMaterial ref={(material) => register(material, particleMaterialOffset + particleCount + 10 + index, index % 4 === 0 ? 0.96 : 0.86)} color={index % 4 === 0 ? palette.accent : index % 2 ? palette.body : palette.dark} emissive={palette.accent} emissiveIntensity={0.04} transparent opacity={0} />
                        </mesh>
                    </group>
                );
            })}

            {(kind === "wind" || kind === "arcane" || kind === "abyss") && [0, 1, 2].map((index) => (
                <group key={`element-orbit-${index}`} ref={(group) => { motifs.current[curveCount + index] = group; }} rotation={[(index - 1) * 0.58, index * 0.92, index * 0.44]}>
                    <mesh scale={signature ? 1.52 + index * 0.28 : 0.72 + index * 0.18}>
                        <torusGeometry args={[0.72, kind === "abyss" ? 0.055 : 0.038, 7, low ? 28 : 48, kind === "wind" ? Math.PI * 1.55 : Math.PI * 1.86]} />
                        <meshToonMaterial ref={(material) => register(material, particleMaterialOffset + particleCount + index, index === 0 ? 0.72 : 0.48)} color={index === 0 ? palette.accent : index === 1 ? palette.body : palette.core} emissive={palette.accent} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} />
                    </mesh>
                </group>
            ))}

            {heroStrokes.map((geometry, index) => {
                const water = kind === "water" || heroStyle.startsWith("selkie");
                const avian = heroStyle === "avian-dive";
                const heavy = heroStyle === "heavy-slam";
                const lateral = heroStyle === "selkie-tail-strike"
                    || heroStyle === "kitsune-eclipse-pounce"
                    || heroStyle === "quadruped-rush"
                    || heroStyle === "biped-combo"
                    || heavy;
                return (
                    <group
                        key={`hero-move-accent-${index}`}
                        ref={(group) => { motifs.current[curveCount + 4 + index] = group; }}
                        position={avian
                            ? [-0.1 + index * 0.1, 0.28 + index * 0.34, (index - 1) * 0.16]
                            : lateral
                                ? [-0.12 + index * 0.12, 0.16 + index * 0.25, (index - 1) * 0.18]
                                : [-0.18 + index * 0.1, 0.2 + index * 0.22, (index - 1) * 0.2]}
                        rotation={avian
                            ? [0.12, -0.14 + index * 0.1, -1.04 + index * 0.18]
                            : lateral
                                ? [0.04, -0.08 + index * 0.07, (heavy ? -0.42 : -0.62) + index * 0.34]
                                : [0.08, -0.16 + index * 0.14, -0.42 + index * 0.3]}
                    >
                        <mesh geometry={geometry} scale={[1.62, water ? 1.48 : 1.36, 1.56]}>
                            <meshToonMaterial
                                ref={(material) => register(material, particleMaterialOffset + particleCount + 40 + index, index === 0 ? 0.76 : 0.56)}
                                color={index === 0 ? palette.core : index === 1 ? palette.accent : palette.body}
                                emissive={palette.accent}
                                emissiveIntensity={0.16}
                                transparent
                                opacity={0}
                                depthWrite={false}
                            />
                        </mesh>
                    </group>
                );
            })}

            <instancedMesh ref={particles} args={[particleGeometry, undefined, particleCount]} frustumCulled={false} renderOrder={35} castShadow={kind === "earth"}>
                <meshToonMaterial
                    ref={(material) => register(material, particleMaterialOffset, kind === "abyss" ? 0.7 : 0.86)}
                    color="#ffffff"
                    vertexColors
                    emissive={palette.accent}
                    emissiveIntensity={kind === "abyss" ? 0.05 : 0.12}
                    transparent
                    opacity={0}
                    depthWrite={kind === "earth"}
                />
            </instancedMesh>

            {sparkCount > 0 && (
                <instancedMesh ref={sparks} args={[undefined, undefined, sparkCount]} frustumCulled={false} renderOrder={38}>
                    <boxGeometry args={[0.035, 0.035, signature ? 0.92 : 0.68]} />
                    <meshBasicMaterial ref={sparkMat} color={hdrSparkColor} transparent opacity={0} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                </instancedMesh>
            )}

            {(signature || big) && (
                <group ref={arenaSeal} position={[0, 0.018, 0]}>
                    <mesh rotation={[-Math.PI / 2, 0, 0]} scale={signature ? 1 : 0.72} renderOrder={31}>
                        <ringGeometry args={[0.54, 1.28, low ? 28 : 52]} />
                        <meshToonMaterial ref={(material) => register(material, particleMaterialOffset + particleCount + 70, signature ? 0.3 : 0.2)} color={palette.dark} emissive={palette.body} emissiveIntensity={0.08} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh rotation={[-Math.PI / 2, 0, Math.PI / 5]} scale={signature ? 1 : 0.72} renderOrder={32}>
                        <ringGeometry args={[1.42, 1.52, low ? 28 : 52]} />
                        <meshToonMaterial ref={(material) => register(material, particleMaterialOffset + particleCount + 71, signature ? 0.62 : 0.4)} color={palette.accent} emissive={palette.accent} emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            )}

            {kind === "earth" && (
                <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={signature ? 1.8 : big ? 1.2 : 0.9}>
                    <circleGeometry args={[0.82, low ? 18 : 32]} />
                    <meshToonMaterial ref={(material) => register(material, particleMaterialOffset + particleCount + 5, 0.34)} color={palette.dark} transparent opacity={0} depthWrite={false} />
                </mesh>
            )}
            {quality.dynamicPetLight && <pointLight ref={light} position={[0, signature ? 1.35 : 0.55, 0]} color={palette.accent} intensity={0} distance={signature ? 10.5 : 5.5} decay={2} />}
        </group>
    );
}


/** A low, persistent element-specific floor mark. It records where decisive
 * contacts happened without adding another translucent volume around a pet. */
function DuelElementDecal({ at, kind, color, size }: { at: Vec3; kind: DuelElementBurstKind; color: string; size: number }) {
    const palette = useMemo(() => duelFxPalette(kind, color), [kind, color]);
    const shardCount = kind === "earth" ? 7 : kind === "lightning" ? 6 : kind === "fire" || kind === "abyss" ? 5 : 3;
    return (
        <group position={at} scale={size}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-2}>
                <circleGeometry args={[0.5, 36]} />
                <meshBasicMaterial color={palette.dark} transparent opacity={kind === "water" || kind === "wind" ? 0.18 : 0.3} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
                <ringGeometry args={[kind === "water" ? 0.29 : 0.34, kind === "water" ? 0.32 : 0.38, 40]} />
                <meshBasicMaterial color={palette.accent} transparent opacity={0.42} depthWrite={false} toneMapped={false} />
            </mesh>
            {(kind === "water" || kind === "wind" || kind === "arcane") && (
                <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 4]} renderOrder={0}>
                    <ringGeometry args={[0.17, 0.195, 36, 1, 0.25, kind === "wind" ? Math.PI * 1.35 : Math.PI * 2]} />
                    <meshBasicMaterial color={palette.core} transparent opacity={0.46} depthWrite={false} toneMapped={false} />
                </mesh>
            )}
            {(kind === "earth" || kind === "lightning" || kind === "fire" || kind === "abyss") && Array.from({ length: shardCount }, (_, index) => {
                const angle = index * (Math.PI * 2 / shardCount) + (index % 2) * 0.18;
                return (
                    <mesh key={`decal-shard-${index}`} position={[Math.sin(angle) * 0.25, 0.008, Math.cos(angle) * 0.25]} rotation={[0, angle, 0]} renderOrder={0}>
                        <boxGeometry args={[index % 2 ? 0.026 : 0.038, 0.012, 0.34 + (index % 3) * 0.08]} />
                        <meshBasicMaterial color={index % 3 === 0 ? palette.core : palette.accent} transparent opacity={kind === "earth" ? 0.42 : 0.58} depthWrite={false} toneMapped={false} />
                    </mesh>
                );
            })}
        </group>
    );
}


function DuelSupportEffect({ at, color, kind, actorId, duel, clock, onDone }: { at: Vec3; color: string; kind: DuelSupportKind; actorId?: string; duel: DuelResult; clock: { current: DuelClock }; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const strokes = useRef<Array<THREE.Mesh | null>>([]);
    const strokeMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const start = useRef<number | null>(null);
    const duration = kind === "shield" ? 0.84 : 0.76;
    const strokeCount = kind === "shield" ? 7 : 8;
    const strokeGeometries = useMemo(() => Array.from({ length: strokeCount }, (_, i) => makeAnimeStrokeGeometry(
        kind === "shield" ? 0.82 + (i % 3) * 0.08 : 0.72 + (i % 4) * 0.07,
        kind === "shield" ? 0.18 + (i % 2) * 0.025 : 0.14 + (i % 3) * 0.018,
        kind === "shield" ? 0.2 + (i % 3) * 0.04 : 0.28 + (i % 2) * 0.05,
        kind === "shield" ? 0 : 0.006,
    )), [kind, strokeCount]);
    const coreColor = useMemo(() => new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.48).getStyle(), [color]);
    useEffect(() => () => strokeGeometries.forEach((geometry) => geometry.dispose()), [strokeGeometries]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / duration);
        const settle = p < 0.22 ? p / 0.22 : 1;
        const fade = p < 0.7 ? 1 : Math.max(0, 1 - (p - 0.7) / 0.3);
        if (root.current) {
            const live = liveDuelEffectPosition(duel, clock, actorId);
            if (live) root.current.position.set(live.wx, at[1], live.wz);
            root.current.scale.setScalar(0.68 + settle * 0.32);
        }
        strokes.current.forEach((stroke, i) => {
            if (!stroke) return;
            const u = i / Math.max(1, strokeCount);
            if (kind === "shield") {
                const angle = u * Math.PI * 2 + elapsed * 0.72;
                const radius = 0.76 + (i % 2) * 0.12;
                stroke.position.set(Math.cos(angle) * radius, 0.48 + (i % 3) * 0.38, Math.sin(angle) * radius);
                stroke.rotation.set(-0.08 + Math.sin(angle) * 0.12, 0, 1.06 + (i % 2) * 0.14);
                const bloom = settle * (0.78 + (i % 3) * 0.08);
                stroke.scale.setScalar(bloom);
            } else {
                const cycle = (p * 1.35 + u) % 1;
                const angle = u * Math.PI * 2 - elapsed * 0.9;
                const radius = 0.28 + (i % 3) * 0.13 + cycle * 0.2;
                stroke.position.set(Math.cos(angle) * radius, 0.16 + cycle * 1.85, Math.sin(angle) * radius);
                stroke.rotation.set(0.02, 0, 1.12 + Math.sin(angle * 2) * 0.18);
                stroke.scale.setScalar((0.46 + Math.sin(Math.PI * cycle) * 0.4) * settle);
            }
            const material = strokeMats.current[i];
            if (material) material.opacity = fade * (kind === "shield" ? 0.72 : Math.sin(Math.PI * ((p * 1.35 + u) % 1)) * 0.82);
        });
        if (p >= 1) onDone();
    });
    return (
        <group ref={root} position={at}>
            {strokeGeometries.map((geometry, i) => (
                <mesh key={`${kind}-brush-${i}`} ref={(mesh) => { strokes.current[i] = mesh; }} geometry={geometry} renderOrder={31}>
                    <meshToonMaterial
                        ref={(material) => { strokeMats.current[i] = material; }}
                        color={i % 3 === 0 ? coreColor : color}
                        emissive={color}
                        emissiveIntensity={0.14}
                        transparent
                        opacity={0}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            ))}
        </group>
    );
}


/** A swept melee weapon TRAIL — an additive blade/streak that arcs through the strike
 *  so each move reads as a distinct SWING: a pierce STABS forward (streak), a slash
 *  SWEEPS, a heavy slam CHOPS overhead, a drain RAKES back. Procedural texture, tinted
 *  by the attacker's element; self-timed; mirrored by `toward` (the attacker's facing).
 *  Render-only — spawned off the deterministic hit stream, never fed back. */
function DuelMeleeTrail({ at, toward, kind, color, weight = "basic", heroStyle = "generic", native = false, onDone }: {
    at: Vec3;
    toward: number;
    kind: MoveChoreoKind;
    color: string;
    weight?: DuelAttackWeight;
    heroStyle?: PetHeroMoveStyle;
    native?: boolean;
    onDone: () => void;
}) {
    const spec = useMemo(() => meleeTrailSpec(kind), [kind]);
    const tex = useMemo(() => (spec.tex === "streak" ? trailStreakTexture() : projCrescentTexture()), [spec.tex]);
    const mesh = useRef<THREE.Mesh>(null);
    const nativeArc = useRef<THREE.Group>(null);
    const followArc = useRef<THREE.Group>(null);
    const finishArc = useRef<THREE.Group>(null);
    const mat = useRef<THREE.MeshToonMaterial>(null);
    const darkMat = useRef<THREE.MeshToonMaterial>(null);
    const edgeMat = useRef<THREE.MeshToonMaterial>(null);
    const followMat = useRef<THREE.MeshToonMaterial>(null);
    const finishMat = useRef<THREE.MeshToonMaterial>(null);
    const chips = useRef<Array<THREE.Mesh | null>>([]);
    const chipMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const scale = weight === "heavy" ? 1.72 : weight === "ability" ? 1.5 : 1.28;
    const avian = heroStyle === "avian-dive";
    const serpent = heroStyle === "serpentine-surge";
    const biped = heroStyle === "biped-combo";
    const rush = heroStyle === "quadruped-rush" || heroStyle === "kitsune-eclipse-pounce";
    const heavyProfile = heroStyle === "heavy-slam" || kind === "heavySlam";
    const dark = useMemo(() => new THREE.Color(color).multiplyScalar(0.28).getStyle(), [color]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const duration = Math.max(spec.life / 1000, weight === "basic" ? 0.42 : weight === "ability" ? 0.5 : 0.58);
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / duration);
        const e = p * p * (3 - 2 * p);   // smoothstep through the swing
        const grow = 0.7 + 0.5 * Math.sin(Math.PI * Math.min(1, p / 0.72));   // swell, then settle
        const fade = p < 0.14 ? p / 0.14 : Math.max(0, 1 - (p - 0.58) / 0.42);
        const followP = Math.min(1, Math.max(0, (p - 0.1) / 0.9));
        const followE = followP * followP * (3 - 2 * followP);
        const followFade = followP <= 0 ? 0 : followP < 0.14 ? followP / 0.14 : Math.max(0, 1 - (followP - 0.62) / 0.38);
        const finishP = Math.min(1, Math.max(0, (p - 0.23) / 0.77));
        const finishE = finishP * finishP * (3 - 2 * finishP);
        const finishFade = finishP <= 0 ? 0 : finishP < 0.16 ? finishP / 0.16 : Math.max(0, 1 - (finishP - 0.56) / 0.44);
        if (native && nativeArc.current) {
            // The primary stroke establishes direction; the two delayed strokes
            // turn even a basic attack into a short species-shaped combination.
            nativeArc.current.position.set(rush ? e * 0.16 : 0, 0.12 + Math.sin(Math.PI * e) * (avian ? 0.34 : 0.2), 0);
            nativeArc.current.rotation.set(heavyProfile ? 0.06 : avian ? -0.2 : 0.28 + e * 0.46, serpent ? e * 0.72 : (toward < 0 ? -1 : 1) * e * 0.42, lerp(heavyProfile ? -1.42 : -1.08, heavyProfile ? 0.42 : 1.02, e));
            nativeArc.current.scale.setScalar(grow * scale * (heavyProfile ? 1.16 : 1));
        }
        if (native && followArc.current) {
            followArc.current.visible = followP > 0;
            followArc.current.position.set(rush ? 0.16 + followE * 0.12 : 0, 0.2 + Math.sin(Math.PI * followE) * (avian ? 0.42 : 0.16), serpent ? Math.sin(followE * Math.PI) * 0.18 : 0);
            followArc.current.rotation.set(avian ? -0.46 : biped ? 0.48 : 0.16, serpent ? followE * 1.65 : biped ? -0.42 : 0.18, lerp(avian ? 0.94 : biped ? 0.78 : -0.72, avian ? -0.9 : biped ? -0.88 : 0.86, followE));
            followArc.current.scale.setScalar(scale * (0.72 + Math.sin(Math.PI * followE) * 0.2));
        }
        if (native && finishArc.current) {
            finishArc.current.visible = finishP > 0;
            finishArc.current.position.set(rush ? 0.26 + finishE * 0.16 : 0, 0.05 + Math.sin(Math.PI * finishE) * (heavyProfile ? 0.46 : 0.24), 0);
            finishArc.current.rotation.set(heavyProfile ? -0.28 : avian ? 0.62 : 0.2, serpent ? -finishE * 1.3 : biped ? 0.55 : -0.2, lerp(heavyProfile ? -1.5 : -0.52, heavyProfile ? 0.18 : 0.72, finishE));
            finishArc.current.scale.setScalar(scale * (weight === "basic" ? 0.62 : 0.82) * (0.84 + Math.sin(Math.PI * finishE) * 0.16));
        }
        if (!native && mesh.current) {
            mesh.current.position.set(lerp(spec.dx0, spec.dx1, e), lerp(spec.dy0, spec.dy1, e), 0);
            mesh.current.rotation.z = lerp(spec.rot0, spec.rot1, e);
            mesh.current.scale.set(spec.w * grow * scale, spec.h * grow * scale, 1);
        }
        if (mat.current) mat.current.opacity = fade * 0.94;
        if (darkMat.current) darkMat.current.opacity = fade * 0.68;
        if (edgeMat.current) edgeMat.current.opacity = fade * 0.76;
        if (followMat.current) followMat.current.opacity = followFade * (weight === "basic" ? 0.72 : 0.86);
        if (finishMat.current) finishMat.current.opacity = finishFade * (weight === "basic" ? 0.62 : 0.82);
        chips.current.forEach((chip, index) => {
            if (!chip) return;
            const angle = index * 2.399 + (toward < 0 ? Math.PI : 0);
            const travel = Math.max(0, Math.min(1, (p - 0.1 - index * 0.018) / 0.7));
            const radius = 0.62 + travel * (0.45 + (index % 3) * 0.16);
            chip.position.set(Math.cos(angle) * radius, 0.34 + Math.sin(Math.PI * travel) * (0.42 + (index % 2) * 0.18), Math.sin(angle) * radius * 0.48);
            chip.rotation.set(travel * (4.2 + index * 0.3), angle, -travel * (3.6 + index * 0.2));
            chip.scale.setScalar((0.065 + (index % 3) * 0.014) * scale * (0.72 + Math.sin(Math.PI * travel) * 0.34));
            if (chipMats.current[index]) chipMats.current[index]!.opacity = fade * Math.max(0.22, 0.78 - index * 0.065);
        });
        if (p >= 1 && !completed.current) {
            completed.current = true;
            onDone();
        }
    });
    if (native) return (
        <group position={at} scale={[toward, 1, 1]}>
            <group ref={nativeArc}>
                <mesh scale={1.08} position={[0, 0, -0.026]}>
                    <torusGeometry args={[0.86, heavyProfile ? 0.145 : 0.11, 10, 40, Math.PI * (heavyProfile ? 0.82 : 0.96)]} />
                    <meshToonMaterial ref={darkMat} color={dark} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh ref={mesh}>
                    <torusGeometry args={[0.86, heavyProfile ? 0.112 : 0.084, 10, 40, Math.PI * (heavyProfile ? 0.82 : 0.96)]} />
                    <meshToonMaterial ref={mat} color={color} emissive={color} emissiveIntensity={0.16} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0, 0, 0.018]} scale={0.985}>
                    <torusGeometry args={[0.86, 0.027, 8, 40, Math.PI * (heavyProfile ? 0.82 : 0.96)]} />
                    <meshToonMaterial ref={edgeMat} color="#fff6dc" emissive={color} emissiveIntensity={0.1} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            <group ref={followArc} visible={false}>
                <mesh>
                    <torusGeometry args={[0.78, biped || avian ? 0.075 : 0.064, 9, 36, Math.PI * (serpent ? 1.34 : 0.78)]} />
                    <meshToonMaterial ref={followMat} color={heroStyle.startsWith("selkie") ? "#d8fbff" : color} emissive={color} emissiveIntensity={0.14} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            <group ref={finishArc} visible={false}>
                <mesh>
                    <torusGeometry args={[heavyProfile ? 0.98 : 0.7, heavyProfile ? 0.09 : 0.052, 9, 36, Math.PI * (heavyProfile ? 0.72 : 0.66)]} />
                    <meshToonMaterial ref={finishMat} color="#fff0bd" emissive={color} emissiveIntensity={0.18} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            {Array.from({ length: weight === "basic" ? 4 : 7 }, (_, i) => (
                    <mesh key={`blade-chip-${i}`} ref={(mesh) => { chips.current[i] = mesh; }} rotation={[i * 0.4, i * 0.7, 0.35]} scale={0.01}>
                        <octahedronGeometry args={[1, 0]} />
                        <meshToonMaterial ref={(material) => { chipMats.current[i] = material; }} color={i % 3 === 0 ? "#fff6dc" : color} emissive={color} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} />
                    </mesh>
            ))}
        </group>
    );
    return (
        <group position={at}>
            <Billboard>
                {/* scale.x = toward mirrors the whole swing for the enemy (faces −x). */}
                <group scale={[toward, 1, 1]}>
                    <mesh ref={mesh}>
                        <planeGeometry args={[1, 1]} />
                        <meshToonMaterial ref={mat} map={tex} color={color} emissive={color} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            </Billboard>
        </group>
    );
}


/** A readable anime dash phrase. A body-height ribbon grows behind the actual
 * pet, element-shaped speed fins mark its S-curve, and opaque directional
 * brushwork strikes at arrival. No proxy orb or floor-level arrow leads it. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelDashEffect({ cue, onDone }: { cue: DuelDashCue; onDone: () => void }) {
    const trailMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const wakeGroups = useRef<Array<THREE.Group | null>>([]);
    const wakeMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const landingBurst = useRef<THREE.Group>(null);
    const landingMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const groundRing = useRef<THREE.Mesh>(null);
    const groundMat = useRef<THREE.MeshToonMaterial>(null);
    const landingLight = useRef<THREE.PointLight>(null);
    const finished = useRef(false);
    const { to, color, impact, duration, travelDuration, kind } = cue;
    const dx = to[0] - cue.from[0], dz = to[2] - cue.from[2];
    const angle = Math.atan2(dx, dz);
    const palette = useMemo(() => duelFxPalette(kind, color), [kind, color]);
    const ribbonOuter = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.69, impact ? 0.38 : 0.3), [cue, impact]);
    const ribbonInner = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.705, impact ? 0.23 : 0.18), [cue, impact]);
    const wakeGeometry = useMemo(() => makeAnimeStrokeGeometry(
        impact ? 1.42 : 1.08,
        impact ? 0.24 : 0.19,
        kind === "water" ? 0.42 : kind === "fire" || kind === "abyss" ? 0.31 : 0.18,
        kind === "lightning" ? 0.12 : 0,
    ), [impact, kind]);
    const impactSpecs = useMemo(() => Array.from({ length: impact ? 5 : 3 }, (_, i) => ({
        length: (impact ? 1.3 : 0.96) * (0.85 + (i % 3) * 0.12),
        width: (impact ? 0.25 : 0.19) * (0.88 + (i % 2) * 0.16),
        curl: kind === "water" ? 0.54 : kind === "fire" || kind === "abyss" ? 0.42 : 0.2,
        jagged: kind === "lightning" ? 0.17 : kind === "earth" ? 0.06 : 0,
        roll: -0.78 + i * (1.56 / Math.max(1, (impact ? 5 : 3) - 1)),
        lift: 0.34 + (i % 3) * 0.25,
    })), [impact, kind]);
    const impactGeometries = useMemo(() => impactSpecs.map((spec) => makeAnimeStrokeGeometry(spec.length, spec.width, spec.curl, spec.jagged)), [impactSpecs]);
    useEffect(() => () => {
        ribbonOuter.dispose();
        ribbonInner.dispose();
        wakeGeometry.dispose();
        impactGeometries.forEach((geometry) => geometry.dispose());
    }, [ribbonOuter, ribbonInner, wakeGeometry, impactGeometries]);
    useFrame(() => {
        const elapsed = Math.max(0, (performance.now() - cue.createdAt) / 1000);
        const p = Math.min(1, elapsed / duration);
        const travelP = Math.min(1, elapsed / travelDuration);
        const linger = elapsed <= travelDuration ? 1 : Math.max(0, 1 - (elapsed - travelDuration) / Math.max(0.001, duration - travelDuration));
        const drawCount = Math.max(0, Math.min(36, Math.ceil(travelP * 36))) * 6;
        ribbonOuter.setDrawRange(0, drawCount);
        ribbonInner.setDrawRange(0, drawCount);
        trailMats.current.forEach((material, i) => {
            if (material) material.opacity = Math.min(1, elapsed / 0.06) * linger * (i === 0 ? 0.28 : 0.58);
        });
        wakeGroups.current.forEach((group, i) => {
            if (!group) return;
            const wakeP = travelP - 0.055 - i * 0.075;
            group.visible = wakeP > 0 && wakeP < 1;
            if (!group.visible) return;
            const at = dashPathPoint(cue, wakeP, FLOOR_Y + 0.72);
            const ahead = dashPathPoint(cue, Math.min(1, wakeP + 0.025), FLOOR_Y + 0.72);
            group.position.set(at[0], at[1] + (i % 2 ? 0.13 : -0.06), at[2]);
            group.rotation.set(0, Math.atan2(ahead[0] - at[0], ahead[2] - at[2]), (i % 2 ? -1 : 1) * (0.18 + i * 0.06));
            group.scale.setScalar((impact ? 1 : 0.82) * (1 - i * 0.08));
            const material = wakeMats.current[i];
            if (material) material.opacity = linger * (0.9 - i * 0.12);
        });
        const landingP = Math.min(1, Math.max(0, (elapsed - travelDuration * 0.82) / Math.max(0.001, duration - travelDuration * 0.82)));
        const strikeOpen = 1 - Math.pow(1 - Math.min(1, landingP / 0.28), 3);
        const strikeFade = landingP < 0.54 ? 1 : Math.max(0, 1 - (landingP - 0.54) / 0.46);
        if (landingBurst.current) {
            landingBurst.current.visible = landingP > 0;
            landingBurst.current.scale.setScalar(strikeOpen * (impact ? 1.02 : 0.74));
            landingBurst.current.rotation.y = angle;
        }
        landingMats.current.forEach((material, i) => { if (material) material.opacity = strikeFade * (i % 2 ? 0.96 : 0.38); });
        if (groundRing.current) groundRing.current.scale.setScalar(0.42 + strikeOpen * (impact ? 1.7 : 1.05));
        if (groundMat.current) groundMat.current.opacity = strikeFade * (impact ? 0.66 : 0.42);
        if (landingLight.current) landingLight.current.intensity = strikeFade * Math.sin(Math.PI * landingP) * (impact ? 5.6 : 2.4);
        if (p >= 1 && !finished.current) { finished.current = true; onDone(); }
    });
    return (
        <group>
            <mesh geometry={ribbonOuter}>
                <meshToonMaterial ref={(material) => { trailMats.current[0] = material; }} color={palette.dark} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh geometry={ribbonInner}>
                <meshToonMaterial ref={(material) => { trailMats.current[1] = material; }} color={palette.body} emissive={palette.accent} emissiveIntensity={0.1} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {Array.from({ length: impact ? 5 : 3 }, (_, i) => (
                <group key={`dash-wake-${i}`} ref={(group) => { wakeGroups.current[i] = group; }} visible={false}>
                    <mesh geometry={wakeGeometry} position={[0, 0, -0.035]} scale={[1.12, 1.12, 1.15]}>
                        <meshToonMaterial color={palette.dark} transparent opacity={0.34} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={wakeGeometry}>
                        <meshToonMaterial ref={(material) => { wakeMats.current[i] = material; }} color={i % 2 ? palette.accent : palette.body} emissive={palette.accent} emissiveIntensity={0.08} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            ))}
            <group ref={landingBurst} position={[to[0], FLOOR_Y + 0.08, to[2]]} visible={false} scale={0.01}>
                {impactSpecs.map((spec, i) => (
                    <group key={`dash-contact-${i}`} position={[0.08 + (i % 2) * 0.12, spec.lift, (i - (impactSpecs.length - 1) * 0.5) * 0.2]} rotation={[0, (i - 2) * 0.055, spec.roll]}>
                        <mesh geometry={impactGeometries[i]} position={[0, 0, -0.025]} scale={[1.05, 1.05, 1.08]}>
                            <meshToonMaterial ref={(material) => { landingMats.current[i * 2] = material; }} color={palette.dark} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                        </mesh>
                        <mesh geometry={impactGeometries[i]}>
                            <meshToonMaterial ref={(material) => { landingMats.current[i * 2 + 1] = material; }} color={i % 3 === 0 ? palette.core : i % 2 ? palette.accent : palette.body} emissive={palette.accent} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                        </mesh>
                    </group>
                ))}
            </group>
            <mesh ref={groundRing} position={[to[0], FLOOR_Y + 0.035, to[2]]} rotation={[-Math.PI / 2, 0, angle]} scale={0.01}>
                <ringGeometry args={[0.52, 0.64, 40]} />
                <meshToonMaterial ref={groundMat} color={palette.accent} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <pointLight ref={landingLight} position={[to[0], FLOOR_Y + 1.0, to[2]]} color={palette.accent} intensity={0} distance={impact ? 7.5 : 4.5} decay={2} />
        </group>
    );
}


/** The dash collision stack is simulation-clocked, so hit-stop freezes it on
 * its brightest contact frame. Directional shards continue the attack vector,
 * a compressed core shows body-on-body force, and two floor impulses make the
 * arena itself answer the blow. */
function DuelDashCollision({ cue, clock, quality }: {
    cue: DuelDashCue;
    clock: { current: DuelClock };
    quality: PetVisualQualityConfig;
}) {
    const root = useRef<THREE.Group>(null);
    const core = useRef<THREE.Mesh>(null);
    const coreMat = useRef<THREE.MeshBasicMaterial>(null);
    const ringMeshes = useRef<Array<THREE.Mesh | null>>([]);
    const ringMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const crackMeshes = useRef<Array<THREE.Mesh | null>>([]);
    const crackMats = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const shards = useRef<THREE.InstancedMesh>(null);
    const shardMat = useRef<THREE.MeshToonMaterial>(null);
    const light = useRef<THREE.PointLight>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const palette = useMemo(() => duelFxPalette(cue.kind, cue.color), [cue.color, cue.kind]);
    const shardCount = quality.id === "low" ? 8 : quality.id === "medium" ? 16 : 24;
    const shardGeometry = useMemo(() => cue.kind === "earth"
        ? new THREE.DodecahedronGeometry(0.12, 0)
        : cue.kind === "wind"
            ? new THREE.ConeGeometry(0.055, 0.52, 5)
            : new THREE.TetrahedronGeometry(0.13, 0), [cue.kind]);
    const dx = cue.impactAt[0] - cue.to[0], dz = cue.impactAt[2] - cue.to[2];
    const heading = Math.atan2(dx, dz);
    useEffect(() => () => shardGeometry.dispose(), [shardGeometry]);
    useEffect(() => {
        const mesh = shards.current;
        if (!mesh) return;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let index = 0; index < shardCount; index++) {
            mesh.setColorAt(index, new THREE.Color(index % 4 === 0 ? palette.core : index % 2 ? palette.accent : palette.body));
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, [palette, shardCount]);
    useFrame(() => {
        const ageTicks = clock.current.t - cue.contactTick;
        const age = ageTicks / DUEL_TPS;
        const active = cue.impact && age >= 0 && age <= 0.92;
        if (root.current) root.current.visible = active;
        if (!active) return;
        const p = Math.min(1, age / 0.92);
        const hit = 1 - Math.pow(1 - Math.min(1, p / 0.16), 4);
        const fade = p < 0.46 ? 1 : Math.max(0, 1 - (p - 0.46) / 0.54);
        const compression = 0.55 + Math.sin(Math.PI * Math.min(1, p / 0.34)) * 0.76;
        if (root.current) root.current.rotation.y = heading;
        if (core.current) {
            core.current.scale.set(1.25 + hit * 0.52, 0.62 + compression * 0.32, 0.7 + compression * 0.2);
            core.current.rotation.set(p * 1.4, p * 2.1, -0.18 + p * 0.34);
        }
        if (coreMat.current) coreMat.current.opacity = fade * (0.5 + hit * 0.5);
        ringMeshes.current.forEach((ring, index) => {
            if (!ring) return;
            const delay = index * 0.06;
            const waveP = Math.max(0, Math.min(1, (p - delay) / Math.max(0.01, 1 - delay)));
            const scale = 0.42 + waveP * (index === 0 ? 2.6 : 3.55);
            ring.scale.set(scale, scale, scale);
            ring.rotation.z = index * 0.72 + waveP * (index ? -0.42 : 0.3);
            if (ringMats.current[index]) ringMats.current[index]!.opacity = fade * (1 - waveP) * (index === 0 ? 0.9 : 0.62);
        });
        crackMeshes.current.forEach((crack, index) => {
            if (!crack) return;
            const u = index / Math.max(1, crackMeshes.current.length);
            const angle = u * Math.PI * 2 + (index % 2 ? 0.14 : -0.12);
            const reach = hit * (0.72 + (index % 3) * 0.28);
            crack.position.set(Math.sin(angle) * reach, 0.016, Math.cos(angle) * reach);
            crack.rotation.set(-Math.PI / 2, 0, -angle + (index % 2 ? 0.18 : -0.16));
            crack.scale.set(0.08 + hit * 0.05, 0.5 + hit * (0.82 + (index % 3) * 0.26), 1);
            if (crackMats.current[index]) crackMats.current[index]!.opacity = fade * 0.74;
        });
        const shardMesh = shards.current;
        if (shardMesh) for (let index = 0; index < shardCount; index++) {
            const angle = index * 2.399 + (index % 4 - 1.5) * 0.12;
            const travel = Math.max(0, Math.min(1, (p - index * 0.006) / 0.74));
            const forward = 0.25 + travel * (1.18 + (index % 4) * 0.24);
            const lateral = Math.sin(angle) * travel * (0.72 + (index % 3) * 0.14);
            dummy.position.set(lateral, 0.42 + Math.sin(Math.PI * travel) * (0.48 + (index % 3) * 0.18), Math.cos(angle) * 0.26 + forward);
            dummy.rotation.set(travel * (4.2 + index * 0.16), angle, -travel * (3.8 + index * 0.12));
            dummy.scale.set(0.66 + (index % 3) * 0.13, 0.9 + travel * 0.55, 0.66 + (index % 2) * 0.14);
            dummy.updateMatrix();
            shardMesh.setMatrixAt(index, dummy.matrix);
        }
        if (shardMesh) shardMesh.instanceMatrix.needsUpdate = true;
        if (shardMat.current) shardMat.current.opacity = fade * 0.94;
        if (light.current) light.current.intensity = fade * Math.sin(Math.PI * Math.min(1, p * 1.7)) * 8.5;
    });
    return (
        <group ref={root} position={[cue.impactAt[0], FLOOR_Y + 0.025, cue.impactAt[2]]} visible={false}>
            <mesh ref={core} position={[0, 0.82, 0.05]} renderOrder={38}>
                <icosahedronGeometry args={[0.48, 1]} />
                <meshBasicMaterial ref={coreMat} color={palette.core} transparent opacity={0} depthWrite={false} toneMapped={false} />
            </mesh>
            {[0, 1].map((index) => (
                <mesh key={`dash-impulse-${index}`} ref={(mesh) => { ringMeshes.current[index] = mesh; }} position={[0, 0.018 + index * 0.014, 0]} rotation={[-Math.PI / 2, 0, index * 0.72]} renderOrder={36}>
                    <ringGeometry args={[0.34 + index * 0.08, 0.47 + index * 0.08, quality.id === "low" ? 28 : 52]} />
                    <meshBasicMaterial ref={(material) => { ringMats.current[index] = material; }} color={index === 0 ? palette.core : palette.accent} transparent opacity={0} depthWrite={false} toneMapped={false} />
                </mesh>
            ))}
            {Array.from({ length: quality.id === "low" ? 5 : 8 }, (_, index) => (
                <mesh key={`dash-crack-${index}`} ref={(mesh) => { crackMeshes.current[index] = mesh; }} renderOrder={35}>
                    <planeGeometry args={[1, 1]} />
                    <meshBasicMaterial ref={(material) => { crackMats.current[index] = material; }} color={index % 3 === 0 ? palette.accent : palette.dark} transparent opacity={0} depthWrite={false} blending={THREE.NormalBlending} />
                </mesh>
            ))}
            <instancedMesh ref={shards} args={[shardGeometry, undefined, shardCount]} frustumCulled={false} renderOrder={39}>
                <meshToonMaterial ref={shardMat} color="#ffffff" vertexColors emissive={palette.accent} emissiveIntensity={0.28} transparent opacity={0} depthWrite={cue.kind === "earth"} />
            </instancedMesh>
            <pointLight ref={light} position={[0, 1.05, 0]} color={palette.accent} intensity={0} distance={7.5} decay={2} />
        </group>
    );
}


/** Elemental dash renderer used by the 3D duel. The path is still the authored
 * S-step used by the model, but its wake is now a chain of lit 3D element motes
 * and its arrival is the same volumetric contact system as every other move. */
function DuelDashEffectV2({ cue, clock, quality, onDone }: { cue: DuelDashCue; clock: { current: DuelClock }; quality: PetVisualQualityConfig; onDone: () => void }) {
    const trailMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const wakeMesh = useRef<THREE.InstancedMesh>(null);
    const wakeMat = useRef<THREE.MeshToonMaterial>(null);
    const contactGroup = useRef<THREE.Group>(null);
    const contactMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const completed = useRef(false);
    const { color, impact, kind, style } = cue;
    // Every certified 3D profile now receives a full elemental wake and impact
    // phrase. `generic` remains reserved for an unprofiled 2D fallback.
    const heroDash = style !== "generic";
    const palette = useMemo(() => duelFxPalette(kind, color), [kind, color]);
    // A trail is punctuation, never a second fighter-sized silhouette. Earlier
    // hero multipliers stacked four half-body ribbons, oversized motes, two
    // contact tubes and a `big` element volume; from the portrait camera this
    // became the long cyan/red wedge that hid both animals.
    const ribbonOuter = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.72, (impact ? 0.28 : 0.19) * (heroDash ? 1.15 : 1)), [cue, impact, heroDash]);
    const ribbonInner = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.73, (impact ? 0.105 : 0.075) * (heroDash ? 1.2 : 1)), [cue, impact, heroDash]);
    const ribbonLeft = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.7, (impact ? 0.08 : 0.06) * (heroDash ? 1.1 : 1), impact ? -0.29 : -0.22), [cue, impact, heroDash]);
    const ribbonRight = useMemo(() => makeDashRibbonGeometry(cue, FLOOR_Y + 0.7, (impact ? 0.08 : 0.06) * (heroDash ? 1.1 : 1), impact ? 0.29 : 0.22), [cue, impact, heroDash]);
    const contactOuter = useMemo(() => makeDashContactGeometry(cue, heroDash ? 0.16 : 0.13, -0.7), [cue, heroDash]);
    const contactInner = useMemo(() => makeDashContactGeometry(cue, heroDash ? 0.068 : 0.055, 0.55), [cue, heroDash]);
    const moteDummy = useMemo(() => new THREE.Object3D(), []);
    const moteGeometry = useMemo<THREE.BufferGeometry>(() => {
        if (kind === "fire" || kind === "abyss") return new THREE.ConeGeometry(0.16, 0.68, 7);
        if (kind === "water") return new THREE.IcosahedronGeometry(0.21, 1);
        if (kind === "wind") return new THREE.TorusGeometry(0.25, 0.056, 6, 18, Math.PI * 1.55);
        if (kind === "lightning") return new THREE.TetrahedronGeometry(0.22, 0);
        if (kind === "earth") return new THREE.DodecahedronGeometry(0.21, 0);
        return new THREE.OctahedronGeometry(0.22, 0);
    }, [kind]);
    useEffect(() => () => {
        ribbonOuter.dispose();
        ribbonInner.dispose();
        ribbonLeft.dispose();
        ribbonRight.dispose();
        contactOuter.dispose();
        contactInner.dispose();
        moteGeometry.dispose();
    }, [contactInner, contactOuter, moteGeometry, ribbonInner, ribbonLeft, ribbonOuter, ribbonRight]);
    const moteCount = quality.id === "low" ? (heroDash ? 4 : 3) : quality.id === "medium" ? (heroDash ? (impact ? 8 : 7) : impact ? 7 : 5) : heroDash ? (impact ? 14 : 11) : impact ? 10 : 8;
    useEffect(() => {
        const mesh = wakeMesh.current;
        if (!mesh) return;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let index = 0; index < moteCount; index++) {
            mesh.setColorAt(index, new THREE.Color(index % 3 === 0 ? palette.core : index % 2 ? palette.accent : palette.body));
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, [moteCount, palette]);
    useFrame(() => {
        const tick = clock.current.t;
        const elapsed = Math.max(0, tick - cue.startTick) / DUEL_TPS;
        const travelP = dashCueTravelProgress(cue, tick);
        const linger = tick <= cue.contactTick ? 1 : Math.max(0, 1 - (tick - cue.contactTick) / Math.max(1, cue.endTick - cue.contactTick));
        // Draw a moving tail behind the pet instead of leaving a static beam
        // across the whole route. The moving head now makes the travel readable.
        const headSegments = Math.max(0, Math.min(36, Math.ceil(travelP * 36)));
        const tailSegments = impact ? 12 : 9;
        const startSegment = Math.max(0, headSegments - tailSegments);
        ribbonOuter.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        ribbonInner.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        ribbonLeft.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        ribbonRight.setDrawRange(startSegment * 6, Math.max(0, headSegments - startSegment) * 6);
        trailMats.current.forEach((material, index) => {
            if (!material) return;
            const layerOpacity = index === 0
                ? (heroDash ? 0.28 : 0.22)
                : index === 1
                    ? (heroDash ? 0.62 : 0.52)
                    : (heroDash ? 0.38 : 0.32);
            material.opacity = Math.min(1, elapsed / 0.055) * linger * layerOpacity;
        });
        const wake = wakeMesh.current;
        if (wake) for (let index = 0; index < moteCount; index++) {
            const wakeP = travelP - 0.025 - index * (impact ? 0.036 : 0.052);
            const visible = wakeP > 0.02 && wakeP < 1;
            if (visible) {
                const at = dashPathPoint(cue, wakeP, FLOOR_Y + 0.72);
                const ahead = dashPathPoint(cue, Math.min(1, wakeP + 0.018), FLOOR_Y + 0.72);
                moteDummy.position.set(at[0], at[1] + Math.sin(index * 2.1) * 0.27, at[2]);
                moteDummy.rotation.set(index * 0.42, Math.atan2(ahead[0] - at[0], ahead[2] - at[2]), elapsed * (4.2 + index * 0.18));
                const taper = Math.max(0.18, 1 - index / moteCount * 0.58);
                const pulse = 0.82 + Math.sin(elapsed * 15 + index) * 0.12;
                moteDummy.scale.setScalar((impact ? 1.18 : 0.96) * (heroDash ? 1.1 : 1) * taper * pulse);
            } else {
                moteDummy.position.set(0, -50, 0);
                moteDummy.rotation.set(0, 0, 0);
                moteDummy.scale.setScalar(0.001);
            }
            moteDummy.updateMatrix();
            wake.setMatrixAt(index, moteDummy.matrix);
        }
        if (wake) wake.instanceMatrix.needsUpdate = true;
        if (wakeMat.current) wakeMat.current.opacity = linger * (heroDash ? 0.78 : 0.64);
        const contactAge = Math.max(0, tick - cue.contactTick);
        const contactLife = impact && tick >= cue.contactTick && contactAge <= 8;
        if (contactGroup.current) contactGroup.current.visible = contactLife;
        if (contactLife) {
            const contactP = Math.min(1, contactAge / 8);
            const punch = Math.sin(Math.PI * Math.min(1, contactP * 1.65));
            contactMats.current.forEach((material, index) => {
                if (material) material.opacity = (index === 0 ? 0.62 : 0.98) * Math.max(0, 1 - contactP) * (0.72 + punch * 0.28);
            });
        }
        if (tick >= cue.endTick && !completed.current) {
            completed.current = true;
            onDone();
        }
    });
    return (
        <group>
            {quality.id !== "low" && (
                <mesh geometry={ribbonOuter} renderOrder={28}>
                    <meshToonMaterial ref={(material) => { trailMats.current[0] = material; }} color={palette.dark} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            )}
            <mesh geometry={ribbonInner} renderOrder={29}>
                <meshToonMaterial ref={(material) => { trailMats.current[1] = material; }} color={palette.accent} emissive={palette.body} emissiveIntensity={0.18} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {quality.id === "high" && (
                <>
                    <mesh geometry={ribbonLeft} renderOrder={29}>
                        <meshToonMaterial ref={(material) => { trailMats.current[2] = material; }} color={palette.body} emissive={palette.accent} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={ribbonRight} renderOrder={29}>
                        <meshToonMaterial ref={(material) => { trailMats.current[3] = material; }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.1} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </>
            )}
            <instancedMesh ref={wakeMesh} args={[moteGeometry, undefined, moteCount]} frustumCulled={false} renderOrder={30}>
                <meshToonMaterial ref={wakeMat} color="#ffffff" vertexColors emissive={palette.accent} emissiveIntensity={0.14} transparent opacity={0} depthWrite={kind === "earth"} />
            </instancedMesh>
            <group ref={contactGroup} visible={false}>
                {quality.id !== "low" && (
                    <mesh geometry={contactOuter} renderOrder={34}>
                        <meshToonMaterial ref={(material) => { contactMats.current[0] = material; }} color={palette.body} emissive={palette.accent} emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} />
                    </mesh>
                )}
                <mesh geometry={contactInner} renderOrder={35}>
                    <meshToonMaterial ref={(material) => { contactMats.current[1] = material; }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.28} transparent opacity={0} depthWrite={false} />
                </mesh>
            </group>
            {impact && <DuelDashCollision cue={cue} clock={clock} quality={quality} />}
            {impact && <DuelElementVolume at={[cue.impactAt[0], FLOOR_Y + 0.08, cue.impactAt[2]]} kind={kind} color={color} big={heroDash} heading={Math.atan2(cue.impactAt[0] - cue.to[0], cue.impactAt[2] - cue.to[2])} phase="dash" quality={quality} heroStyle={style} simClock={clock} simStartTick={cue.contactTick} onDone={() => undefined} />}
        </group>
    );
}


/** A presentation-only elemental exchange used inside genuinely empty replay
 * pockets. Each pet fires a short, solid-color toon bolt and the two techniques
 * collide at center. It adds combat intent without inventing damage or changing
 * the deterministic duel result. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelPressureClash({ from, to, leftColor, rightColor, onDone }: { from: Vec3; to: Vec3; leftColor: string; rightColor: string; onDone: () => void }) {
    const leftBolt = useRef<THREE.Group>(null);
    const rightBolt = useRef<THREE.Group>(null);
    const burst = useRef<THREE.Group>(null);
    const boltMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const burstMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const arcMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const duration = 0.92;
    const midpoint = useMemo<Vec3>(() => [(from[0] + to[0]) * 0.5, FLOOR_Y + 0.86, (from[2] + to[2]) * 0.5], [from, to]);
    const leftStart = useMemo<Vec3>(() => [from[0], FLOOR_Y + 0.72, from[2]], [from]);
    const rightStart = useMemo<Vec3>(() => [to[0], FLOOR_Y + 0.72, to[2]], [to]);
    const leftBody = useMemo(() => new THREE.Color(leftColor).multiplyScalar(0.56).getStyle(), [leftColor]);
    const rightBody = useMemo(() => new THREE.Color(rightColor).multiplyScalar(0.56).getStyle(), [rightColor]);
    const coreColor = useMemo(() => new THREE.Color(leftColor).lerp(new THREE.Color(rightColor), 0.5).multiplyScalar(0.72).getStyle(), [leftColor, rightColor]);
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const leftHeading = Math.atan2(dx, dz);

    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / duration);
        const travelP = Math.min(1, p / 0.54);
        const travel = 1 - Math.pow(1 - travelP, 3);
        const collisionP = Math.max(0, (p - 0.46) / 0.54);
        const boltFade = p < 0.48 ? 1 : Math.max(0, 1 - (p - 0.48) / 0.13);
        const burstRise = 1 - Math.pow(1 - Math.min(1, collisionP * 2.25), 3);
        const burstFade = collisionP < 0.58 ? 1 : Math.max(0, 1 - (collisionP - 0.58) / 0.42);
        const placeBolt = (group: THREE.Group | null, origin: Vec3, heading: number, arc: number) => {
            if (!group) return;
            group.position.set(
                lerp(origin[0], midpoint[0], travel),
                lerp(origin[1], midpoint[1], travel) + Math.sin(Math.PI * travelP) * arc,
                lerp(origin[2], midpoint[2], travel),
            );
            group.rotation.y = heading;
            group.scale.setScalar(0.56 + Math.sin(Math.PI * travelP) * 0.22);
        };
        placeBolt(leftBolt.current, leftStart, leftHeading, 0.38);
        placeBolt(rightBolt.current, rightStart, leftHeading + Math.PI, -0.12);
        boltMats.current.forEach((material) => { if (material) material.opacity = boltFade * 0.94; });
        if (burst.current) {
            burst.current.scale.setScalar(Math.max(0.001, burstRise * (0.88 + collisionP * 0.42)));
            burst.current.rotation.y = collisionP * 2.1;
        }
        burstMats.current.forEach((material, index) => { if (material) material.opacity = burstFade * (index === 0 ? 0.96 : 0.78); });
        arcMats.current.forEach((material, index) => { if (material) material.opacity = burstFade * (0.72 - index * 0.11); });
        if (light.current) light.current.intensity = burstFade * burstRise * 3.4;
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });

    const renderBolt = (side: "left" | "right", body: string, accent: string, ref: React.RefObject<THREE.Group | null>, offset: number) => (
        <group ref={ref} key={`pressure-${side}`}>
            <mesh scale={[0.44, 0.54, 0.82]}>
                <octahedronGeometry args={[1, 0]} />
                <meshToonMaterial ref={(material) => { boltMats.current[offset] = material; }} color={body} emissive={accent} emissiveIntensity={0.18} transparent opacity={0} depthWrite={false} />
            </mesh>
            <mesh scale={[0.29, 0.36, 0.9]}>
                <octahedronGeometry args={[1, 0]} />
                <meshToonMaterial ref={(material) => { boltMats.current[offset + 1] = material; }} color={accent} emissive={accent} emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} />
            </mesh>
            {[-1, 1].map((direction, index) => (
                <mesh key={`${side}-pressure-fin-${index}`} position={[direction * 0.23, 0, -0.08]} rotation={[Math.PI / 2, direction * 0.28, direction * 0.64]} scale={[0.64, 0.8, 0.64]}>
                    <torusGeometry args={[0.34, 0.05, 7, 24, Math.PI * 0.88]} />
                    <meshToonMaterial ref={(material) => { boltMats.current[offset + 2 + index] = material; }} color={index === 0 ? accent : body} emissive={accent} emissiveIntensity={0.12} transparent opacity={0} depthWrite={false} />
                </mesh>
            ))}
            {[0, 1].map((index) => (
                <mesh key={`${side}-pressure-tail-${index}`} position={[0, 0, -0.62 - index * 0.42]} rotation={[Math.PI / 2, 0, 0]} scale={1 - index * 0.24}>
                    <coneGeometry args={[0.3, 1.15 + index * 0.34, 7, 1, true]} />
                    <meshToonMaterial ref={(material) => { boltMats.current[offset + index + 4] = material; }} color={index === 0 ? accent : body} emissive={accent} emissiveIntensity={0.1} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            ))}
        </group>
    );

    return (
        <group>
            {renderBolt("left", leftBody, leftColor, leftBolt, 0)}
            {renderBolt("right", rightBody, rightColor, rightBolt, 6)}
            <group ref={burst} position={midpoint} scale={0.001}>
                <mesh scale={[1.12, 0.92, 0.78]}>
                    <octahedronGeometry args={[0.74, 0]} />
                    <meshToonMaterial ref={(material) => { burstMats.current[0] = material; }} color={coreColor} emissive={coreColor} emissiveIntensity={0.3} transparent opacity={0} depthWrite={false} />
                </mesh>
                {[0, 1].map((index) => (
                    <mesh key={`pressure-arc-${index}`} rotation={[Math.PI / 2 + index * 0.42, index * 1.24, index * 0.68]} scale={1 + index * 0.32}>
                        <torusGeometry args={[0.9, 0.085 - index * 0.016, 7, 28, Math.PI * 1.42]} />
                        <meshToonMaterial ref={(material) => { arcMats.current[index] = material; }} color={index === 0 ? leftColor : rightColor} emissive={index === 0 ? leftColor : rightColor} emissiveIntensity={0.18} transparent opacity={0} depthWrite={false} />
                    </mesh>
                ))}
                {Array.from({ length: 10 }, (_, index) => {
                    const angle = (index / 10) * Math.PI * 2;
                    const radius = 0.82 + (index % 3) * 0.18;
                    return (
                        <mesh key={`pressure-shard-${index}`} position={[Math.cos(angle) * radius, (index % 4 - 1.5) * 0.23, Math.sin(angle) * radius]} rotation={[angle * 0.4, -angle, (index % 2 ? -1 : 1) * 0.72]} scale={[0.11, 0.38 + (index % 3) * 0.09, 0.11]}>
                            <octahedronGeometry args={[1, 0]} />
                            <meshToonMaterial ref={(material) => { burstMats.current[index + 1] = material; }} color={index % 2 === 0 ? leftColor : rightColor} emissive={index % 2 === 0 ? leftColor : rightColor} emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} />
                        </mesh>
                    );
                })}
            </group>
            <pointLight ref={light} position={midpoint} color={coreColor} intensity={0} distance={6.5} decay={2} />
        </group>
    );
}


function makePressureStreamGeometry(from: Vec3, to: Vec3, side: number, radius: number): THREE.TubeGeometry {
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


/** Presentation-only neutral exchange rebuilt as two braided 3D energy streams.
 * The previous octahedron at center was the most obvious surviving “fake icon”
 * in the fight; this version grows through world space and throws physical
 * fragments out of its collision volume. */
function DuelPressureClashV2({ from, to, leftColor, rightColor, leftKind, rightKind, quality, onDone }: { from: Vec3; to: Vec3; leftColor: string; rightColor: string; leftKind: DuelElementBurstKind; rightKind: DuelElementBurstKind; quality: PetVisualQualityConfig; onDone: () => void }) {
    const streamMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const collision = useRef<THREE.Group>(null);
    const leftProjectile = useRef<THREE.Group>(null);
    const rightProjectile = useRef<THREE.Group>(null);
    const fragments = useRef<Array<THREE.Mesh | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const midpoint = useMemo<Vec3>(() => [(from[0] + to[0]) * 0.5, FLOOR_Y + 0.9, (from[2] + to[2]) * 0.5], [from, to]);
    const leftStart = useMemo<Vec3>(() => [from[0], FLOOR_Y + 0.72, from[2]], [from]);
    const rightStart = useMemo<Vec3>(() => [to[0], FLOOR_Y + 0.72, to[2]], [to]);
    const streams = useMemo(() => [
        makePressureStreamGeometry(leftStart, midpoint, 1, 0.075),
        makePressureStreamGeometry(leftStart, midpoint, -0.6, 0.034),
        makePressureStreamGeometry(rightStart, midpoint, -1, 0.075),
        makePressureStreamGeometry(rightStart, midpoint, 0.6, 0.034),
    ], [leftStart, midpoint, rightStart]);
    useEffect(() => () => streams.forEach((geometry) => geometry.dispose()), [streams]);
    const coreColor = useMemo(() => new THREE.Color(leftColor).lerp(new THREE.Color(rightColor), 0.5).getStyle(), [leftColor, rightColor]);
    const leftVisual = useMemo(() => projectileVisual({ element: leftKind, charged: true }), [leftKind]);
    const rightVisual = useMemo(() => projectileVisual({ element: rightKind, charged: true }), [rightKind]);
    const leftHeading = Math.atan2(-(midpoint[2] - leftStart[2]), midpoint[0] - leftStart[0]);
    const rightHeading = Math.atan2(-(midpoint[2] - rightStart[2]), midpoint[0] - rightStart[0]);
    const fragmentCount = quality.id === "low" ? 6 : 12;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / 1.0);
        const travel = Math.min(1, p / 0.48);
        const streamFade = p < 0.52 ? 1 : Math.max(0, 1 - (p - 0.52) / 0.18);
        streams.forEach((geometry) => geometry.setDrawRange(0, Math.ceil((geometry.index?.count ?? 0) * travel)));
        streamMats.current.forEach((material, index) => { if (material) material.opacity = streamFade * (index % 2 ? 0.72 : 0.94); });
        const placeProjectile = (group: THREE.Group | null, origin: Vec3, heading: number, bow: number) => {
            if (!group) return;
            group.visible = p < 0.56;
            group.position.set(lerp(origin[0], midpoint[0], travel), lerp(origin[1], midpoint[1], travel) + Math.sin(Math.PI * travel) * bow, lerp(origin[2], midpoint[2], travel));
            group.rotation.y = heading;
            // Keep the physical cores secondary to the painted pressure streams.
            // The former near-unit spheres read as detached cyan blobs.
            group.scale.setScalar(0.46 + Math.sin(Math.PI * travel) * 0.14);
        };
        placeProjectile(leftProjectile.current, leftStart, leftHeading, 0.28);
        placeProjectile(rightProjectile.current, rightStart, rightHeading, -0.06);
        const hitP = Math.max(0, (p - 0.42) / 0.58);
        const open = 1 - Math.pow(1 - Math.min(1, hitP * 2.2), 3);
        const fade = hitP < 0.58 ? 1 : Math.max(0, 1 - (hitP - 0.58) / 0.42);
        if (collision.current) {
            collision.current.visible = hitP > 0;
            collision.current.rotation.set(hitP * 0.72, hitP * 2.4, -hitP * 0.48);
            collision.current.scale.setScalar(Math.max(0.001, open * (0.92 + hitP * 0.46)));
        }
        fragments.current.forEach((fragment, index) => {
            if (!fragment) return;
            const angle = index * 2.399;
            fragment.position.set(Math.cos(angle) * hitP * (0.7 + index % 3 * 0.18), Math.sin(Math.PI * hitP) * (0.45 + index % 4 * 0.13), Math.sin(angle) * hitP * (0.7 + index % 3 * 0.18));
            fragment.rotation.set(hitP * (4 + index), angle, -hitP * (3 + index % 4));
            fragment.scale.setScalar(fade * (0.08 + index % 3 * 0.025));
        });
        if (light.current) light.current.intensity = fade * open * 4.2;
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });
    return (
        <group>
            {streams.map((geometry, index) => (
                <mesh key={`pressure-stream-${index}`} geometry={geometry} renderOrder={29 + index % 2}>
                    <meshToonMaterial ref={(material) => { streamMats.current[index] = material; }} color={index < 2 ? (index % 2 ? "#fff3d0" : leftColor) : index % 2 ? "#e7f7ff" : rightColor} emissive={index < 2 ? leftColor : rightColor} emissiveIntensity={0.16} transparent opacity={0} depthWrite={false} />
                </mesh>
            ))}
            <group ref={leftProjectile}><NativeProjectileBody visual={leftVisual} quality={quality} /></group>
            <group ref={rightProjectile}><NativeProjectileBody visual={rightVisual} quality={quality} /></group>
            <group ref={collision} position={midpoint} visible={false} scale={0.001}>
                {Array.from({ length: fragmentCount }, (_, index) => (
                    <mesh key={`pressure-volume-fragment-${index}`} ref={(mesh) => { fragments.current[index] = mesh; }} scale={0.01}>
                        <tetrahedronGeometry args={[1, 0]} />
                        <meshToonMaterial color={index % 2 ? rightColor : leftColor} emissive={coreColor} emissiveIntensity={0.08} />
                    </mesh>
                ))}
            </group>
            <DuelElementVolume at={midpoint} kind={leftKind} color={leftColor} big={false} heading={leftHeading} phase="contact" quality={quality} delay={0.42} onDone={() => undefined} />
            <DuelElementVolume at={midpoint} kind={rightKind} color={rightColor} big={false} heading={rightHeading} phase="contact" quality={quality} delay={0.42} onDone={() => undefined} />
            {quality.dynamicPetLight && <pointLight ref={light} position={midpoint} color={coreColor} intensity={0} distance={7} decay={2} />}
        </group>
    );
}


/** Ground SHOCKWAVE — flat expanding rings on the floor at the impact point that
 *  drive force into the arena; bigger + brighter on heavy/crit blows. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelShockwave({ at, color, big, onDone }: { at: Vec3; color: string; big: boolean; onDone: () => void }) {
    const r1 = useRef<THREE.Mesh>(null);
    const m1 = useRef<THREE.MeshToonMaterial>(null);
    const r2 = useRef<THREE.Mesh>(null);
    const m2 = useRef<THREE.MeshToonMaterial>(null);
    const start = useRef<number | null>(null);
    const DUR = big ? 0.62 : 0.4;
    const maxR = big ? 3.05 : 1.55;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / DUR);
        const ease = 1 - (1 - p) * (1 - p);
        if (r1.current) r1.current.scale.setScalar(0.3 + ease * maxR);
        if (m1.current) m1.current.opacity = (1 - p) * 0.46;
        if (r2.current) r2.current.scale.setScalar(0.2 + Math.max(0, ease - 0.15) * maxR * 0.7);
        if (m2.current) m2.current.opacity = (1 - p) * 0.3;
        if (p >= 1) onDone();
    });
    return (
        <group position={[at[0], 0.05, at[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh ref={r1}>
                <torusGeometry args={[0.94, 0.065, 7, 40]} />
                <meshToonMaterial ref={m1} color={color} emissive={color} emissiveIntensity={0.18} transparent opacity={0.46} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={r2}>
                <torusGeometry args={[0.94, 0.034, 6, 40]} />
                <meshToonMaterial ref={m2} color={color} emissive={color} emissiveIntensity={0.1} transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
        </group>
    );
}


/** A restrained 3D anime power-up column. Short faceted flame tongues rise
 * around the pet while leaving its silhouette readable. Their compact volume
 * avoids both the old glass cage and edge-on brush cards. */
function DuelPowerUpAura({ at, color, quality, actorId, duel, clock, heroStyle = "generic", onDone }: { at: Vec3; color: string; quality: PetVisualQualityConfig; actorId?: string; duel: DuelResult; clock: { current: DuelClock }; heroStyle?: PetHeroMoveStyle; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const floorPulse = useRef<THREE.Group>(null);
    const floorMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const auraStrokes = useRef<Array<THREE.Mesh | null>>([]);
    const auraStrokeMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const kitsuneCast = heroStyle === "kitsune-tail-cast";
    const duration = kitsuneCast ? 1.24 : 1.14;
    const auraCount = quality.id === "low" ? 8 : quality.id === "medium" ? 11 : 13;
    // Keep the body color saturated. A large white mix plus additive blending
    // turned water and wind buffs into the same frosted-glass cage.
    const auraCore = useMemo(() => new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.32).getStyle(), [color]);
    const auraDark = useMemo(() => new THREE.Color(color).multiplyScalar(0.28).getStyle(), [color]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / duration);
        const arrive = 1 - Math.pow(1 - Math.min(1, p / 0.16), 3);
        const fade = p < 0.72 ? 1 : Math.max(0, 1 - (p - 0.72) / 0.28);
        const pulse = 0.94 + Math.sin(elapsed * 28) * 0.045;
        if (root.current) {
            const live = liveDuelEffectPosition(duel, clock, actorId);
            if (live) root.current.position.set(live.wx, at[1], live.wz);
            const heroScale = kitsuneCast ? 1.22 : 1;
            root.current.scale.set(pulse * arrive * heroScale, arrive * (0.82 + 0.18 * pulse) * heroScale, pulse * arrive * heroScale);
        }
        if (floorPulse.current) {
            floorPulse.current.rotation.y = elapsed * 1.12;
            const floorScale = 0.7 + arrive * 0.38 + Math.sin(elapsed * 11) * 0.025;
            floorPulse.current.scale.setScalar(Math.max(0.001, floorScale));
        }
        floorMats.current.forEach((material, index) => {
            if (material) material.opacity = fade * arrive * (index === 0 ? 0.28 : 0.66);
        });
        auraStrokes.current.forEach((stroke, index) => {
            if (!stroke) return;
            const u = index / Math.max(1, auraCount);
            const lift = (p * 1.72 + u) % 1;
            const angle = u * Math.PI * 2 + elapsed * (index % 2 ? -0.62 : 0.52);
            const radius = 0.54 + (index % 3) * 0.13 + Math.sin(elapsed * 9 + index) * 0.035;
            stroke.position.set(Math.cos(angle) * radius, 0.2 + lift * 1.82, Math.sin(angle) * radius);
            stroke.rotation.set(Math.sin(angle) * 0.12, angle, Math.cos(angle) * -0.18);
            const widthPulse = 0.72 + Math.sin(elapsed * 15 + index * 1.7) * 0.1;
            stroke.scale.set(widthPulse * (0.94 - lift * 0.2), 0.68 + Math.sin(Math.PI * lift) * 0.78, widthPulse * (0.94 - lift * 0.2));
            const material = auraStrokeMats.current[index];
            if (material) material.opacity = fade * (0.28 + Math.sin(Math.PI * lift) * 0.72) * (index % 3 === 0 ? 0.94 : 0.8);
        });
        if (light.current) light.current.intensity = fade * arrive * (1.7 + Math.abs(Math.sin(elapsed * 18)) * 0.9);
        if (p >= 1) onDone();
    });
    return (
        <group ref={root} position={[at[0], 0.03, at[2]]} scale={0.01}>
            <group ref={floorPulse} position={[0, 0.018, 0]}>
                <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={27}>
                    <ringGeometry args={[0.2, 1.14, quality.id === "low" ? 28 : 48]} />
                    <meshToonMaterial ref={(material) => { floorMats.current[0] = material; }} color={auraDark} emissive={color} emissiveIntensity={0.05} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh rotation={[-Math.PI / 2, 0, Math.PI / 6]} renderOrder={28}>
                    <ringGeometry args={[1.27, 1.38, quality.id === "low" ? 28 : 48]} />
                    <meshToonMaterial ref={(material) => { floorMats.current[1] = material; }} color={auraCore} emissive={color} emissiveIntensity={0.2} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            {Array.from({ length: auraCount }, (_, index) => (
                <mesh key={`power-flame-${index}`} ref={(mesh) => { auraStrokes.current[index] = mesh; }} renderOrder={30}>
                    <coneGeometry args={[0.27 + (index % 3) * 0.035, 1.08 + (index % 2) * 0.16, 5]} />
                    <meshToonMaterial
                        ref={(material) => { auraStrokeMats.current[index] = material; }}
                        color={index % 3 === 0 ? auraCore : color}
                        emissive={color}
                        emissiveIntensity={0.2}
                        transparent
                        opacity={0}
                        depthWrite={false}
                    />
                </mesh>
            ))}
            <Sparkles count={Math.max(8, Math.round(quality.setPieceParticles * 0.5))} scale={[2.6, 3.7, 2.6]} position={[0, 1.7, 0]} size={2.5} speed={1.72} opacity={0.66} color={color} noise={0.5} />
            {quality.translucentLayers > 1 && <Sparkles count={Math.max(4, Math.round(quality.setPieceParticles * 0.2))} scale={[3.0, 0.38, 3.0]} position={[0, 0.17, 0]} size={1.8} speed={0.48} opacity={0.34} color={auraCore} noise={0.65} />}
            {quality.dynamicPetLight && <pointLight ref={light} color={color} intensity={0} distance={6.4} decay={2} position={[0, 1.25, 0]} />}
        </group>
    );
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


function makeFlamePetalGeometry(height: number, radius: number, bend: number): THREE.BufferGeometry {
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
function makeFlameRibbonGeometry(height: number, radius: number, sway: number, phase: number): THREE.BufferGeometry {
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

function tornadoMistTexture(): THREE.CanvasTexture { return (_tornadoMistTexture ??= makeTornadoMistTexture()); }

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


/** A pressure volume rather than two floor decals: the leading edge is a short
 * vertical wall with lifted arena debris, while a thin floor rim only anchors
 * it to the point of contact. */
function DuelShockwaveV2({ at, color, big, quality, onDone }: { at: Vec3; color: string; big: boolean; quality: PetVisualQualityConfig; onDone: () => void }) {
    const root = useRef<THREE.Group>(null);
    const wall = useRef<THREE.Mesh>(null);
    const wallMat = useRef<THREE.MeshToonMaterial>(null);
    const rim = useRef<THREE.Mesh>(null);
    const rimMat = useRef<THREE.MeshToonMaterial>(null);
    const debris = useRef<Array<THREE.Mesh | null>>([]);
    const debrisMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const duration = big ? 0.68 : 0.46;
    const count = quality.id === "low" ? 5 : big ? 12 : 8;
    const dark = useMemo(() => new THREE.Color(color).multiplyScalar(0.3).getStyle(), [color]);
    const core = useMemo(() => new THREE.Color(color).lerp(new THREE.Color("#fff0c4"), 0.26).getStyle(), [color]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / duration);
        const open = 1 - Math.pow(1 - p, 2);
        const fade = Math.pow(1 - p, 1.25);
        if (root.current) root.current.rotation.y = p * 0.42;
        if (wall.current) wall.current.scale.set((0.18 + open * (big ? 3.4 : 1.85)), 0.4 + Math.sin(Math.PI * p) * (big ? 1.2 : 0.72), (0.18 + open * (big ? 3.4 : 1.85)));
        if (rim.current) rim.current.scale.setScalar(0.2 + open * (big ? 3.15 : 1.72));
        if (wallMat.current) wallMat.current.opacity = fade * (big ? 0.42 : 0.32);
        if (rimMat.current) rimMat.current.opacity = fade * 0.56;
        debris.current.forEach((piece, index) => {
            if (!piece) return;
            const angle = index * 2.399;
            const radius = open * (0.38 + (index % 4) * (big ? 0.42 : 0.24));
            piece.position.set(Math.cos(angle) * radius, 0.08 + Math.sin(Math.PI * p) * (0.32 + (index % 3) * 0.16), Math.sin(angle) * radius);
            piece.rotation.set(p * (4 + index), angle, -p * (5 + index % 3));
            piece.scale.setScalar((big ? 0.16 : 0.105) * fade * (0.74 + index % 3 * 0.16));
            if (debrisMats.current[index]) debrisMats.current[index]!.opacity = fade * 0.78;
        });
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });
    return (
        <group ref={root} position={[at[0], FLOOR_Y + 0.035, at[2]]}>
            <mesh ref={wall} position={[0, 0.2, 0]} scale={0.01} renderOrder={26}>
                <cylinderGeometry args={[1, 0.84, 0.52, quality.id === "low" ? 24 : 42, 1, true]} />
                <meshToonMaterial ref={wallMat} color={dark} emissive={color} emissiveIntensity={0.08} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={rim} rotation={[-Math.PI / 2, 0, 0]} scale={0.01} renderOrder={27}>
                <torusGeometry args={[0.92, big ? 0.055 : 0.042, 7, quality.id === "low" ? 28 : 48]} />
                <meshToonMaterial ref={rimMat} color={core} emissive={color} emissiveIntensity={0.14} transparent opacity={0} depthWrite={false} />
            </mesh>
            {Array.from({ length: count }, (_, index) => (
                <mesh key={`shock-debris-${index}`} ref={(mesh) => { debris.current[index] = mesh; }} scale={0.01} castShadow>
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshToonMaterial ref={(material) => { debrisMats.current[index] = material; }} color={index % 3 === 0 ? core : index % 2 ? color : dark} transparent opacity={0} />
                </mesh>
            ))}
        </group>
    );
}


function makeTornadoTube(phase: number): THREE.TubeGeometry {
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


/** Arena-scale signature spectacle. These are procedural 3D shapes rather than a
 * billboard enlarged until it blurs: Water travels as a cresting wall, Wind owns
 * vertical space as a rotating funnel, and Fire blooms outward in layered flame
 * petals. They remain translucent so the pets stay readable through the effect. */
// Retained temporarily as a comparison/fallback while the live coliseum uses
// DuelAnimeSetPiece. Keeping the component name uppercase preserves hook rules.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DuelElementSetPiece({ kind, from, to, color, quality, onDone }: {
    kind: DuelSetPieceKind; from: Vec3; to: Vec3; color: string; quality: PetVisualQualityConfig; onDone: () => void;
}) {
    const root = useRef<THREE.Group>(null);
    const materials = useRef<Array<THREE.Material & { opacity: number }>>([]);
    const flameMeshes = useRef<THREE.Mesh[]>([]);
    const flameLight = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const abyssal = kind === "abyssBurst";
    const flameLike = kind === "flameBurst";
    const tornadoMist = useMemo(() => kind === "tornado" ? tornadoMistTexture() : null, [kind]);
    const flamePetalCount = quality.id === "low" ? 6 : quality.id === "medium" ? 7 : 8;
    // The full-height helix tubes looked like luminous springs in motion. The
    // textured volume plus horizontal calligraphic bands below reads as a real
    // funnel and costs less on mobile, so no vertical tube cage is needed.
    const tornadoTubeCount = 0;
    const flamePetals = useMemo(() => flameLike
        ? Array.from({ length: flamePetalCount }, (_, i) => makeFlameRibbonGeometry(
            1.28 + (i % 4) * 0.24,
            0.17 + (i % 3) * 0.025,
            0.52 + (i % 3) * 0.18,
            (i / flamePetalCount) * Math.PI * 2,
        ))
        : [], [flameLike, flamePetalCount]);
    const waveTongues = useMemo(() => kind === "tidalWave"
        ? Array.from({ length: quality.id === "low" ? 4 : 6 }, (_, i) => makeFlameRibbonGeometry(
            0.9 + (i % 3) * 0.18,
            0.14 + (i % 2) * 0.018,
            0.3 + (i % 3) * 0.08,
            0.7 + i * 0.86,
        ))
        : [], [kind, quality.id]);
    const tornadoTubes = useMemo(() => kind === "tornado"
        ? Array.from({ length: tornadoTubeCount }, (_, i) => (i / tornadoTubeCount) * Math.PI * 2).map(makeTornadoTube)
        : [], [kind, tornadoTubeCount]);
    useEffect(() => () => {
        tornadoMist?.dispose();
        flamePetals.forEach((geometry) => geometry.dispose());
        waveTongues.forEach((geometry) => geometry.dispose());
        tornadoTubes.forEach((geometry) => geometry.dispose());
    }, [tornadoMist, flamePetals, waveTongues, tornadoTubes]);
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const angle = Math.atan2(dx, dz);
    // The cut-in supplies the anticipation; the set piece itself arrives fast,
    // then holds its full arena silhouette for the payoff instead of drifting in.
    const duration = kind === "tornado" ? 1.55 : kind === "tidalWave" ? 1.62 : flameLike || abyssal ? 1.5 : kind === "lightningStorm" ? 1.45 : kind === "earthBurst" ? 1.5 : 1.4;
    const registerMaterial = (material: (THREE.Material & { opacity: number }) | null) => {
        if (!material || materials.current.includes(material)) return;
        material.userData.baseOpacity = material.opacity;
        materials.current.push(material);
    };
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const p = Math.min(1, (state.clock.elapsedTime - start.current) / duration);
        const rise = Math.min(1, p / 0.18);
        const fade = p < 0.82 ? rise : Math.max(0, 1 - (p - 0.82) / 0.18);
        const g = root.current;
        if (g) {
            if (kind === "tidalWave") {
                // Cross the lane in about 0.8s, then hold the full crest past the
                // cut-in so speed never costs the player the actual water payoff.
                const travel = 1 - Math.pow(1 - Math.min(1, p / 0.3), 2);
                g.position.set(lerp(from[0], to[0], travel), 0.15, lerp(from[2], to[2], travel));
                // Keep the advancing crest readable from the broadcast camera.
                // A fully heading-aligned wall turns edge-on during horizontal
                // attacks and reads as a flat polygon instead of water volume.
                g.rotation.y = angle * 0.24;
                g.scale.set(0.9 + p * 0.34, 0.9 + Math.sin(Math.PI * p) * 0.38, 1.04 + p * 0.22);
            } else {
                g.position.set(to[0], 0.08, to[2]);
                // Only a tornado should continuously spin. Rotating every signature
                // made grounded attacks orbit the target like a decorative carousel.
                g.rotation.y = kind === "tornado" ? angle + p * Math.PI * 5.5 : angle;
                // Snap large, then HOLD the arena silhouette until the final fade.
                // The previous sine swell collapsed back to half-size while the
                // cut-in was still clearing, which made the actual payoff look tiny.
                const grow = 1 - Math.pow(1 - Math.min(1, p / 0.22), 3);
                const fullScale = flameLike || abyssal ? 1.88 : kind === "tornado" ? 1.72 : kind === "lightningStorm" ? 1.86 : kind === "earthBurst" ? 1.78 : 1.7;
                const settle = p < 0.82 ? 1 : 1 - Math.min(1, (p - 0.82) / 0.18) * 0.16;
                g.scale.setScalar((0.45 + grow * (fullScale - 0.45)) * settle);
            }
        }
        if (flameLike) {
            flameMeshes.current.forEach((mesh, i) => {
                const flicker = Math.sin(state.clock.elapsedTime * (8.5 + (i % 3)) + i * 1.7);
                mesh.scale.y = 0.9 + flicker * 0.13;
                mesh.scale.x = mesh.scale.z = 1.02 - flicker * 0.055;
                mesh.rotation.z = flicker * 0.045;
            });
        }
        if (flameLight.current) flameLight.current.intensity = fade * ((abyssal ? 3.2 : 5) + Math.abs(Math.sin(state.clock.elapsedTime * 11)) * (abyssal ? 1.4 : 3));
        if (tornadoMist) tornadoMist.offset.set(p * 0.42, -p * 1.4);
        for (const material of materials.current) material.opacity = Number(material.userData.baseOpacity ?? 0.5) * fade;
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });

    const setPieceColor = abyssal ? "#d51d56" : kind === "flameBurst" ? "#ff4b18"
        : kind === "tidalWave" ? "#2fc9ea"
            : kind === "tornado" ? "#50d9be"
                : kind === "lightningStorm" ? "#9b7cff"
                    : kind === "earthBurst" ? "#c88b43" : color;
    const mat = (opacity: number, white = false) => (
        <meshToonMaterial ref={registerMaterial} color={white ? "#effcff" : setPieceColor} emissive={setPieceColor} emissiveIntensity={white ? 0.16 : 0.1} transparent opacity={Math.min(0.92, opacity * 1.75)} depthWrite={false} side={THREE.DoubleSide} />
    );
    return (
        <group ref={root}>
            {kind === "tidalWave" && (
                <group>
                    {/* Tapered water tongues ride the outer curl instead of standing
                        in a row. This gives the signature a hand-drawn breaking-wave
                        silhouette without a translucent backplate or shield fan. */}
                    {waveTongues.map((geometry, i) => {
                        const u = i / Math.max(1, waveTongues.length - 1);
                        const a = 0.08 + u * Math.PI * 1.02;
                        const x = Math.cos(a) * 1.5 - 0.08;
                        const y = 0.5 + Math.sin(a) * 1.28;
                        return (
                            <mesh key={`wave-tongue-${i}`} geometry={geometry} position={[x, y, 0.42 + (i % 2) * 0.12]} rotation={[0.08, -0.38 + i * 0.14, a - 1.42]} scale={0.68 + (i % 3) * 0.09}>
                                <meshToonMaterial ref={registerMaterial} color={i % 3 === 0 ? "#9ce9ef" : i % 2 ? "#1598bf" : "#36c1d2"} emissive="#087ca6" emissiveIntensity={0.12} transparent opacity={0.88} depthWrite={false} />
                            </mesh>
                        );
                    })}
                    {/* Thick partial toruses form a real 3D curl. The previous
                        filled surface was technically a crest but read as a flat
                        blue card whenever its heading crossed the camera axis. */}
                    <mesh position={[-0.05, 0.5, -0.15]} rotation={[0.06, 0, -0.18]} scale={[1.26, 1.06, 0.76]}>
                        <torusGeometry args={[1.45, 0.54, 14, 52, Math.PI * 1.28]} />
                        <meshToonMaterial ref={registerMaterial} color="#043a62" emissive="#02243f" emissiveIntensity={0.06} transparent opacity={0.9} depthWrite={false} />
                    </mesh>
                    <mesh position={[-0.05, 0.5, -0.1]} rotation={[0.06, 0, -0.18]} scale={[1.18, 1.0, 0.72]}>
                        <torusGeometry args={[1.45, 0.46, 14, 52, Math.PI * 1.28]} />
                        <meshToonMaterial ref={registerMaterial} color="#087fb8" emissive="#043a67" emissiveIntensity={0.16} transparent opacity={0.9} depthWrite={false} />
                    </mesh>
                    <mesh position={[-0.02, 0.54, -0.06]} rotation={[0.06, 0, -0.18]} scale={[1.2, 1.02, 0.74]}>
                        <torusGeometry args={[1.46, 0.13, 10, 54, Math.PI * 1.28]} />
                        <meshToonMaterial ref={registerMaterial} color="#e8ffff" emissive="#59cfe4" emissiveIntensity={0.22} transparent opacity={0.95} depthWrite={false} />
                    </mesh>
                    <mesh position={[-0.55, 0.28, 0.34]} rotation={[0.16, 0.22, -0.5]} scale={[0.72, 0.68, 0.54]}>
                        <torusGeometry args={[1.18, 0.28, 12, 44, Math.PI * 1.1]} />
                        <meshToonMaterial ref={registerMaterial} color="#25b9d6" emissive="#075b89" emissiveIntensity={0.16} transparent opacity={0.82} depthWrite={false} />
                    </mesh>
                    <mesh position={[0.72, 0.22, 0.18]} rotation={[0.08, -0.18, 0.45]} scale={[0.55, 0.48, 0.42]}>
                        <torusGeometry args={[1.08, 0.2, 10, 40, Math.PI]} />
                        <meshToonMaterial ref={registerMaterial} color="#57d6e7" emissive="#087ba8" emissiveIntensity={0.18} transparent opacity={0.78} depthWrite={false} />
                    </mesh>
                    {Array.from({ length: 9 }, (_, i) => {
                        const a = -1.15 + i * 0.23;
                        const r = 0.72 + (i % 4) * 0.18;
                        return (
                            <mesh key={`water-spray-${i}`} position={[Math.sin(a) * r, 1.0 + (i % 5) * 0.25, 1.5 + Math.cos(a) * 0.2]} rotation={[a, i * 0.61, -a]} scale={[0.1 + (i % 3) * 0.025, 0.24 + (i % 4) * 0.04, 0.1]}>
                                <sphereGeometry args={[1, 10, 7]} />
                                <meshToonMaterial ref={registerMaterial} color={i % 3 ? "#78ddea" : "#efffff"} emissive="#4abbd0" emissiveIntensity={0.1} transparent opacity={0.88} depthWrite={false} />
                            </mesh>
                        );
                    })}
                    <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <ringGeometry args={[0.75, 2.3, 48]} />
                        <meshBasicMaterial ref={registerMaterial} color="#0876ae" transparent opacity={0.24} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
                    </mesh>
                    <Sparkles count={Math.max(8, Math.round(quality.setPieceParticles * 0.7))} position={[0, 1.25, 0.2]} scale={[3.2, 2.8, 3.8]} size={2.1} speed={1.55} opacity={0.42} color="#d8fbff" noise={1.35} />
                </group>
            )}
            {kind === "tornado" && (
                <group>
                    {/* A broad, softly textured funnel gives the move real volume;
                        the thinner toon spirals are highlights, not the whole effect. */}
                    {tornadoMist && (
                        <mesh position={[0, 1.92, 0]} rotation={[0, 0, Math.PI]}>
                            <coneGeometry args={[1.5, 3.82, 48, 4, true]} />
                            <meshBasicMaterial ref={registerMaterial} map={tornadoMist} color="#55cdbd" transparent opacity={0.4} depthWrite={false} toneMapped={false} blending={THREE.NormalBlending} side={THREE.DoubleSide} />
                        </mesh>
                    )}
                    <mesh position={[0, 1.62, 0]} rotation={[0, 0, Math.PI]} scale={[0.72, 0.84, 0.72]}>
                        <coneGeometry args={[1.5, 3.82, 40, 3, true]} />
                        <meshBasicMaterial ref={registerMaterial} color="#168a84" transparent opacity={0.2} depthWrite={false} toneMapped={false} blending={THREE.NormalBlending} side={THREE.DoubleSide} />
                    </mesh>
                    {tornadoTubes.map((geometry, i) => (
                        <mesh key={i} geometry={geometry}>
                            <meshToonMaterial
                                ref={registerMaterial}
                                color={i === 0 ? "#d8fff7" : i === 1 ? "#55d9c4" : "#168a84"}
                                emissive={i === 0 ? "#58d8c5" : "#0b514f"}
                                emissiveIntensity={i === 0 ? 0.24 : 0.12}
                                transparent
                                opacity={i === 0 ? 0.94 : 0.82}
                                depthWrite={false}
                            />
                        </mesh>
                    ))}
                    {Array.from({ length: 5 }, (_, i) => (
                        <mesh key={`vortex-band-${i}`} position={[0, 0.42 + i * 0.78, 0]} rotation={[Math.PI / 2, i * 1.08, i % 2 ? 0.16 : -0.12]} scale={[1, 0.76 + (i % 2) * 0.12, 1]}>
                            <torusGeometry args={[0.4 + i * 0.27, 0.055 + i * 0.007, 8, 40, Math.PI * (0.92 + (i % 2) * 0.18)]} />
                            <meshToonMaterial ref={registerMaterial} color={i > 1 ? "#c8fff2" : "#38bda9"} emissive="#17665f" emissiveIntensity={0.16} transparent opacity={0.9 - i * 0.08} depthWrite={false} />
                        </mesh>
                    ))}
                    {Array.from({ length: 9 }, (_, i) => {
                        const a = (i / 9) * Math.PI * 2;
                        const r = 0.9 + (i % 3) * 0.58;
                        return (
                            <mesh key={`debris-${i}`} position={[Math.cos(a) * r, 0.35 + (i % 4) * 0.58, Math.sin(a) * r]} scale={0.1 + (i % 3) * 0.045}>
                                <dodecahedronGeometry args={[1, 0]} />
                                <meshToonMaterial ref={registerMaterial} color="#708078" transparent opacity={0.72} depthWrite={false} />
                            </mesh>
                        );
                    })}
                    <Sparkles count={Math.max(12, quality.setPieceParticles)} scale={[4.8, 5.4, 4.8]} position={[0, 2.15, 0]} size={2.45} speed={1.9} opacity={0.42} color="#d7fff4" noise={2.0} />
                </group>
            )}
            {flameLike && (
                <group>
                    <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <ringGeometry args={[1.08, 1.42, 48]} />
                        {mat(0.22)}
                    </mesh>
                    {flamePetals.map((geometry, i) => {
                        const a = (i / flamePetals.length) * Math.PI * 2;
                        const r = i < 2 ? 0.22 : 0.58 + (i % 3) * 0.18;
                        const inner = i < 2;
                        return (
                            <mesh
                                key={i}
                                ref={(mesh) => { if (mesh) flameMeshes.current[i] = mesh; }}
                                geometry={geometry}
                                position={[Math.cos(a) * r, 0.04, Math.sin(a) * r]}
                                rotation={[0, a, 0]}
                                castShadow
                            >
                                <meshToonMaterial
                                    ref={registerMaterial}
                                    color={abyssal
                                        ? inner ? "#ffb4d1" : i % 2 ? "#d5164f" : "#551056"
                                        : inner ? "#ffe777" : i % 2 ? "#ff5a18" : "#c92319"}
                                    emissive={abyssal ? (inner ? "#ff335f" : "#26082f") : (inner ? "#ff9d00" : "#681018")}
                                    emissiveIntensity={inner ? 0.42 : 0.2}
                                    transparent
                                    opacity={inner ? 0.86 : 0.74}
                                    depthWrite={false}
                                />
                            </mesh>
                        );
                    })}
                    <mesh position={[0, 0.42, 0]} scale={[0.68, 0.46, 0.68]}>
                        <sphereGeometry args={[1, 22, 14]} />
                        <meshToonMaterial ref={registerMaterial} color={abyssal ? "#b71b59" : "#ffb426"} emissive={abyssal ? "#54105f" : "#ff3d12"} emissiveIntensity={0.38} transparent opacity={0.4} depthWrite={false} />
                    </mesh>
                    {quality.dynamicPetLight && <pointLight ref={flameLight} position={[0, 1.4, 0]} color={abyssal ? "#ef2b67" : "#ff6a22"} intensity={0} distance={8} decay={2} />}
                    <Sparkles count={quality.setPieceParticles} scale={[5.2, 4.3, 5.2]} position={[0, 1.5, 0]} size={3.4} speed={1.35} opacity={0.6} color="#fff1c2" noise={2.0} />
                </group>
            )}
            {abyssal && (
                <group>
                    {/* Hellgate is an aimed attack, not a radial flame crown. The
                        dark floor seal establishes the origin while three offset
                        claw trails continue through the victim along the attack
                        heading. Normal blending keeps the shadows dark instead of
                        bleaching both pets with additive magenta. */}
                    <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.24, 1.24, 1]}>
                        <circleGeometry args={[1.12, 48]} />
                        <meshBasicMaterial ref={registerMaterial} color="#160b24" transparent opacity={0.72} depthWrite={false} blending={THREE.NormalBlending} />
                    </mesh>
                    {[0, 1].map((i) => (
                        <mesh key={`hellgate-ring-${i}`} position={[0, 0.045 + i * 0.012, 0]} rotation={[-Math.PI / 2, 0, i * 0.38]}>
                            <torusGeometry args={[0.7 + i * 0.34, 0.045 - i * 0.008, 8, 48, Math.PI * (1.52 + i * 0.2)]} />
                            <meshBasicMaterial ref={registerMaterial} color={i === 0 ? "#dc1839" : "#68112f"} transparent opacity={i === 0 ? 0.7 : 0.52} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                        </mesh>
                    ))}
                    {[0, 1, 2].map((i) => (
                        <group key={`abyss-claw-${i}`} position={[(i - 1) * 0.34, 0.085 + i * 0.012, 0.05 + (i - 1) * 0.12]} rotation={[-Math.PI / 2, 0, -0.54 + i * 0.08]}>
                            <mesh>
                                <torusGeometry args={[0.86 + i * 0.09, 0.085 - i * 0.008, 8, 42, Math.PI * 0.72]} />
                                <meshToonMaterial ref={registerMaterial} color={i === 1 ? "#ef2846" : "#7f1435"} emissive="#3c091f" emissiveIntensity={0.3} transparent opacity={0.88 - i * 0.08} depthWrite={false} side={THREE.DoubleSide} />
                            </mesh>
                            <mesh position={[0, 0, -0.055]} scale={1.18}>
                                <torusGeometry args={[0.86 + i * 0.09, 0.035, 6, 38, Math.PI * 0.72]} />
                                <meshBasicMaterial ref={registerMaterial} color="#ff8a68" transparent opacity={0.5} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                            </mesh>
                        </group>
                    ))}
                    <mesh position={[0, 0.68, 0.08]} scale={[0.54, 0.72, 0.42]}>
                        <icosahedronGeometry args={[1, 2]} />
                        <meshBasicMaterial ref={registerMaterial} color="#db1938" transparent opacity={0.3} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                    {Array.from({ length: quality.id === "low" ? 6 : 9 }, (_, i) => {
                        const lane = (i % 3) - 1;
                        const row = Math.floor(i / 3);
                        return (
                            <mesh key={`abyss-fragment-${i}`} position={[lane * (0.48 + row * 0.12), 0.34 + row * 0.43 + (i % 2) * 0.11, 0.28 + row * 0.38]} rotation={[i * 0.72, i * 0.41, i * 0.93]} scale={[0.08, 0.18 + (i % 2) * 0.05, 0.08]}>
                                <octahedronGeometry args={[1, 0]} />
                                <meshToonMaterial ref={registerMaterial} color={i % 3 === 1 ? "#d91d3d" : "#261024"} emissive="#8e1639" emissiveIntensity={0.16} transparent opacity={0.82} depthWrite={false} />
                            </mesh>
                        );
                    })}
                    {quality.dynamicPetLight && <pointLight ref={flameLight} position={[0, 1.05, 0.15]} color="#db263f" intensity={0} distance={6.5} decay={2} />}
                    <Sparkles count={Math.max(8, Math.round(quality.setPieceParticles * 0.62))} scale={[3.7, 2.8, 3.8]} position={[0, 1.05, 0.3]} size={2.1} speed={1.05} opacity={0.34} color="#ff8069" noise={1.7} />
                </group>
            )}
            {kind === "lightningStorm" && (
                <group>
                    {[0, 1, 2, 3].map((i) => (
                        <mesh key={`cloud-${i}`} position={[(i - 1.5) * 0.48, 3.35 + (i % 2) * 0.18, (i % 2 ? -1 : 1) * 0.28]} scale={[0.92, 0.48, 0.72]}>
                            <icosahedronGeometry args={[0.72, 1]} />
                            <meshToonMaterial ref={registerMaterial} color={i % 2 ? "#34255f" : "#21163e"} emissive="#5b3db0" emissiveIntensity={0.16} transparent opacity={0.86} depthWrite={false} />
                        </mesh>
                    ))}
                    {Array.from({ length: 9 }, (_, i) => {
                        const zig = i % 2 ? 0.34 : -0.28;
                        return (
                            <mesh key={`bolt-${i}`} position={[zig + (i > 5 ? 0.28 : 0), 3.12 - i * 0.36, (i % 3 - 1) * 0.08]} rotation={[0, 0, (i % 2 ? -1 : 1) * 0.42]} scale={[0.13, 0.48, 0.13]}>
                                <octahedronGeometry args={[0.5, 0]} />
                                <meshToonMaterial ref={registerMaterial} color={i % 3 === 0 ? "#fff3a3" : "#b89cff"} emissive={i % 3 === 0 ? "#ffd83d" : "#7b4fff"} emissiveIntensity={0.5} transparent opacity={0.96} depthWrite={false} />
                            </mesh>
                        );
                    })}
                    <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <ringGeometry args={[0.8, 2.25, 46]} />
                        <meshBasicMaterial ref={registerMaterial} color="#7657dc" transparent opacity={0.32} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                    </mesh>
                    <Sparkles count={quality.setPieceParticles} scale={[4.8, 5.2, 4.8]} position={[0, 2.0, 0]} size={2.5} speed={1.8} opacity={0.52} color="#e4d8ff" noise={2.4} />
                </group>
            )}
            {kind === "earthBurst" && (
                <group>
                    <mesh position={[0, 0.42, 0]} scale={[1.28, 0.66, 1.28]} castShadow>
                        <dodecahedronGeometry args={[1.15, 0]} />
                        <meshToonMaterial ref={registerMaterial} color="#6b4026" emissive="#2f1c12" emissiveIntensity={0.06} transparent opacity={0.94} depthWrite />
                    </mesh>
                    {Array.from({ length: 12 }, (_, i) => {
                        const a = (i / 12) * Math.PI * 2;
                        const r = 0.9 + (i % 3) * 0.38;
                        return (
                            <mesh key={`stone-${i}`} position={[Math.cos(a) * r, 0.45 + (i % 4) * 0.38, Math.sin(a) * r]} rotation={[a * 0.4, -a, a * 0.22]} scale={0.22 + (i % 3) * 0.08} castShadow>
                                <dodecahedronGeometry args={[1, 0]} />
                                <meshToonMaterial ref={registerMaterial} color={i % 3 === 0 ? "#d49a4a" : i % 2 ? "#83512e" : "#533520"} emissive="#3a2416" emissiveIntensity={0.05} transparent opacity={0.96} depthWrite />
                            </mesh>
                        );
                    })}
                    <mesh position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <ringGeometry args={[1.1, 2.65, 12]} />
                        <meshToonMaterial ref={registerMaterial} color="#c38b47" emissive="#5c3821" emissiveIntensity={0.12} transparent opacity={0.58} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <Sparkles count={Math.max(10, Math.round(quality.setPieceParticles * 0.7))} scale={[5.4, 2.8, 5.4]} position={[0, 1.15, 0]} size={3.2} speed={0.72} opacity={0.42} color="#d8b17a" noise={2.1} />
                </group>
            )}
            {kind === "elemental" && (
                <group>
                    {[0, 1, 2].map((i) => (
                        <mesh key={i} position={[0, 0.35 + i * 0.75, 0]} rotation={[Math.PI / 2, i * 0.6, 0]}>
                            <torusGeometry args={[0.8 + i * 0.55, 0.1, 8, 40, Math.PI * 1.7]} />
                            {mat(0.52 - i * 0.08, i === 2)}
                        </mesh>
                    ))}
                    <Sparkles count={38} scale={[4.6, 4.2, 4.6]} position={[0, 1.5, 0]} size={3} speed={0.9} opacity={0.55} color="#ffffff" noise={1.7} />
                </group>
            )}
        </group>
    );
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


const TORNADO_VERTEX = `
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


const TORNADO_FRAGMENT = `
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


function makeTornadoRibbonGeometry(index: number): THREE.TubeGeometry {
    const turns = 2.1 + index * 0.24;
    const points = Array.from({ length: 38 }, (_, i) => {
        const u = i / 37;
        const radius = 0.22 + Math.pow(u, 0.82) * (1.15 + index * 0.08);
        const a = u * Math.PI * 2 * turns + index * 1.7;
        return new THREE.Vector3(Math.cos(a) * radius, u * 3.5, Math.sin(a) * radius);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.022 + index * 0.004, 5, false);
}


function DuelTsunamiSetPiece({ from, to, color, quality, onDone }: {
    from: Vec3; to: Vec3; color: string; quality: PetVisualQualityConfig; onDone: () => void;
}) {
    const { camera } = useThree();
    const root = useRef<THREE.Group>(null);
    const curlMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const sheetMats = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const wash = useRef<THREE.MeshToonMaterial>(null);
    const washMesh = useRef<THREE.Mesh>(null);
    const crest = useRef<THREE.Group>(null);
    const trailingSwells = useRef<THREE.Group>(null);
    const spray = useRef<Array<THREE.Mesh | null>>([]);
    const start = useRef<number | null>(null);
    const complete = useRef(false);
    const palette = useMemo(() => duelFxPalette("water", color), [color]);
    // The former translucent heightfield and polyhedral foam read as a glass
    // dome full of white rocks. These opaque extruded brush masses share the
    // same dark/body/highlight hierarchy as the pet models and produce one clean
    // breaking-wave silhouette from the broadcast camera.
    const waveSheets = useMemo(() => [
        makeAnimeStrokeGeometry(5.2, 0.88, 1.55),
        makeAnimeStrokeGeometry(4.55, 0.48, 1.36),
        makeAnimeStrokeGeometry(3.75, 0.2, 1.16),
    ], []);
    useEffect(() => () => waveSheets.forEach((geometry) => geometry.dispose()), [waveSheets]);
    const sprayCount = quality.id === "low" ? 12 : quality.id === "medium" ? 20 : 28;
    const spraySpecs = useMemo(() => Array.from({ length: sprayCount }, (_, i) => ({
        x: -2.75 + (i / Math.max(1, sprayCount - 1)) * 5.5,
        lift: 0.28 + (i % 5) * 0.09,
        drift: ((i % 3) - 1) * 0.18,
        phase: (i * 0.173) % 1,
        size: 0.035 + (i % 4) * 0.012,
    })), [sprayCount]);
    const distance = Math.hypot(to[0] - from[0], to[2] - from[2]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / 1.95);
        const build = Math.min(1, p / 0.2);
        // The crest reaches contact in ~0.56 s, matching the director's delayed
        // damage number/flash. The former 1.31 s crossing made the HP change look
        // unrelated to the wave even though the simulator had already resolved it.
        const travel = 1 - Math.pow(1 - Math.min(1, p / 0.29), 3);
        const fade = p < 0.76 ? 1 : Math.max(0, 1 - (p - 0.76) / 0.24);
        const foamFade = p < 0.84 ? 1 : Math.max(0, 1 - (p - 0.84) / 0.16);
        const breakupP = Math.max(0, Math.min(1, (p - 0.58) / 0.42));
        const breakup = 1 - (1 - breakupP) * (1 - breakupP);
        if (root.current) {
            const overshoot = distance > 0.001 ? 0.52 / distance : 0;
            root.current.position.set(lerp(from[0], to[0] + (to[0] - from[0]) * overshoot, travel), FLOOR_Y + 0.02, lerp(from[2], to[2] + (to[2] - from[2]) * overshoot, travel));
            // Keep the broad silhouette readable to the broadcast camera. The
            // geometry itself owns the forward curl and thickness; its root still
            // travels along the true combat lane toward the target.
            const laneAngle = Math.atan2(to[0] - from[0], to[2] - from[2]);
            const cameraAngle = Math.atan2(camera.position.x - root.current.position.x, camera.position.z - root.current.position.z);
            // Bias toward the lane so the overhanging C-profile is visible, while
            // retaining enough broadcast-facing width to read as a wall of water.
            root.current.rotation.y = laneAngle * 0.74 + cameraAngle * 0.26;
            const volume = 0.72 + build * 0.38;
            root.current.scale.set(volume * (1 + breakup * 0.18), (0.2 + build * 0.8) * (1 - breakup * 0.28), volume * (1 + breakup * 0.3));
        }
        if (crest.current) {
            crest.current.position.set(0.48, 1.02 - breakup * 0.72, 0.32 + breakup * 0.9);
            crest.current.rotation.set(0.08 + breakup * 0.16, 0, -0.64 - breakup * 0.38);
            crest.current.scale.set(1 + breakup * 0.22, 1 - breakup * 0.52, 1 + breakup * 0.14);
        }
        if (trailingSwells.current) {
            trailingSwells.current.position.set(-breakup * 0.46, -breakup * 0.18, breakup * 0.5);
            trailingSwells.current.scale.set(1 + breakup * 0.28, 1 - breakup * 0.36, 1 + breakup * 0.2);
        }
        curlMats.current.forEach((material, index) => {
            if (material) material.opacity = fade * (index === 0 ? 0.24 : index === 1 ? 0.92 : index === 2 ? 0.96 : index === 3 ? 0.78 : 0.9);
        });
        sheetMats.current.forEach((material, index) => {
            if (material) material.opacity = fade * (index === 0 ? 0.96 : index === 1 ? 0.9 : 0.82);
        });
        if (wash.current) wash.current.opacity = foamFade * (0.22 + breakup * 0.12);
        if (washMesh.current) washMesh.current.scale.set(1 + breakup * 0.72, 1.45 + breakup * 0.86, 1);
        spray.current.forEach((drop, i) => {
            if (!drop) return;
            const spec = spraySpecs[i];
            const cycle = (p * 2.7 + spec.phase) % 1;
            const u = i / Math.max(1, spraySpecs.length - 1);
            const envelope = Math.pow(Math.max(0, Math.sin(u * Math.PI)), 0.5);
            const side = Math.sign(spec.x) || (i % 2 ? 1 : -1);
            drop.position.set(spec.x + spec.drift * cycle + side * breakup * 0.62, 0.5 + envelope * 2.75 + Math.sin(cycle * Math.PI) * spec.lift - cycle * 0.22 - breakup * 0.72, 0.5 + envelope * 0.72 + cycle * 0.54 + breakup * 0.9);
            drop.scale.setScalar(spec.size * (0.5 + build) * foamFade * (1 + breakup * 0.7));
        });
        if (p >= 1 && !complete.current) { complete.current = true; onDone(); }
    });
    return (
        <group ref={root}>
            <group position={[-0.25, 0.12, -0.18]} rotation={[0.02, -0.04, -0.08]}>
                {waveSheets.map((geometry, index) => (
                    <mesh
                        key={`tidal-solid-sheet-${index}`}
                        geometry={geometry}
                        position={[index * 0.22, index * 0.12, index * 0.2]}
                        scale={[1 - index * 0.1, 1 - index * 0.08, 1.35 + index * 0.22]}
                        renderOrder={32 + index}
                        castShadow={quality.modelShadows && index === 0}
                    >
                        <meshToonMaterial
                            ref={(material) => { sheetMats.current[index] = material; }}
                            color={index === 0 ? palette.dark : index === 1 ? palette.body : palette.core}
                            emissive={index === 2 ? palette.accent : palette.dark}
                            emissiveIntensity={index === 2 ? 0.12 : 0.035}
                            transparent
                            opacity={index === 0 ? 0.96 : index === 1 ? 0.9 : 0.82}
                            depthWrite={index === 0}
                            side={THREE.DoubleSide}
                        />
                    </mesh>
                ))}
            </group>
            {/* The crest is an asymmetric forward hook, not a centered arch. Its
                diagonal break gives the effect a direction and keeps the target
                readable through the hollow during the damage frame. */}
            <group ref={crest} position={[0.48, 1.02, 0.32]} rotation={[0.08, 0, -0.64]}>
                <mesh scale={[1.46, 1.02, 0.86]} renderOrder={34} castShadow={quality.modelShadows}>
                    <torusGeometry args={[1.28, 0.42, quality.id === "low" ? 9 : 13, quality.id === "low" ? 34 : 52, Math.PI * 0.94]} />
                    <meshToonMaterial ref={(material) => { curlMats.current[1] = material; }} color={palette.body} emissive={palette.dark} emissiveIntensity={0.08} transparent opacity={0.92} depthWrite side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[0.03, 0.04, 0.13]} scale={[1.42, 0.98, 0.8]} renderOrder={36}>
                    <torusGeometry args={[1.28, 0.085, quality.id === "low" ? 7 : 10, quality.id === "low" ? 36 : 54, Math.PI * 0.94]} />
                    <meshToonMaterial ref={(material) => { curlMats.current[2] = material; }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.18} transparent opacity={0.96} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            {/* Lower trailing swells make this a moving body of water rather than
                one upright shield-shaped curl. They remain offset behind the lip
                along the local travel axis, so the target stays readable. */}
            <group ref={trailingSwells}>
                <mesh position={[-1.18, 0.27, -0.68]} rotation={[0.12, 0.08, -0.42]} scale={[0.9, 0.48, 0.72]} renderOrder={31}>
                    <torusGeometry args={[1.18, 0.3, quality.id === "low" ? 9 : 12, quality.id === "low" ? 32 : 46, Math.PI * 1.02]} />
                    <meshToonMaterial ref={(material) => { curlMats.current[3] = material; }} color={palette.body} emissive={palette.dark} emissiveIntensity={0.06} transparent opacity={0.78} depthWrite side={THREE.DoubleSide} />
                </mesh>
                <mesh position={[-1.14, 0.31, -0.56]} rotation={[0.12, 0.08, -0.42]} scale={[0.86, 0.44, 0.68]} renderOrder={34}>
                    <torusGeometry args={[1.18, 0.075, quality.id === "low" ? 7 : 10, quality.id === "low" ? 34 : 48, Math.PI * 1.02]} />
                    <meshToonMaterial ref={(material) => { curlMats.current[4] = material; }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.16} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            <mesh ref={washMesh} position={[0, 0.045, -0.35]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.0, 1.45, 1]} renderOrder={30}>
                <circleGeometry args={[2.35, quality.id === "low" ? 24 : 48]} />
                <meshToonMaterial ref={wash} color={palette.dark} emissive={palette.accent} emissiveIntensity={0.045} transparent opacity={0.16} depthWrite={false} />
            </mesh>
            {spraySpecs.map((spec, i) => (
                <mesh key={`wave-spray-${i}`} ref={(mesh) => { spray.current[i] = mesh; }} position={[spec.x, 3.25, 0.25]} renderOrder={34}>
                    <icosahedronGeometry args={[1, 0]} />
                    <meshToonMaterial color={i % 3 === 0 ? palette.core : palette.accent} transparent opacity={0.78} depthWrite={false} />
                </mesh>
            ))}
            {quality.dynamicPetLight && <pointLight position={[0, 2.0, 0.6]} color={palette.accent} intensity={2.7} distance={8} decay={2} />}
        </group>
    );
}


function DuelTornadoSetPiece({ to, targetId, duel, clock, color, quality, onDone }: {
    to: Vec3; targetId?: string; duel: DuelResult; clock: { current: DuelClock }; color: string; quality: PetVisualQualityConfig; onDone: () => void;
}) {
    const root = useRef<THREE.Group>(null);
    const shells = useRef<Array<THREE.Mesh | null>>([]);
    const materials = useRef<Array<THREE.ShaderMaterial | null>>([]);
    const ribbons = useRef<Array<THREE.Mesh | null>>([]);
    const debris = useRef<Array<THREE.Mesh | null>>([]);
    const start = useRef<number | null>(null);
    const complete = useRef(false);
    const palette = useMemo(() => duelFxPalette("wind", color), [color]);
    const ribbonCount = quality.id === "low" ? 3 : quality.id === "medium" ? 4 : 5;
    const ribbonGeometries = useMemo(() => Array.from({ length: ribbonCount }, (_, i) => makeTornadoRibbonGeometry(i)), [ribbonCount]);
    useEffect(() => () => ribbonGeometries.forEach((geometry) => geometry.dispose()), [ribbonGeometries]);
    const debrisCount = quality.id === "low" ? 8 : quality.id === "medium" ? 12 : 16;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / 2.05);
        const build = 1 - Math.pow(1 - Math.min(1, p / 0.22), 3);
        const fade = p < 0.8 ? 1 : Math.max(0, 1 - (p - 0.8) / 0.2);
        if (root.current) {
            // A trapping funnel belongs to the defender for its full readable
            // beat. If it remains at the release mark while both pets reposition,
            // the caster can cross that point and make the move read as self-cast.
            const liveTarget = liveDuelEffectPosition(duel, clock, targetId);
            root.current.position.set(liveTarget?.wx ?? to[0], FLOOR_Y + 0.035, liveTarget?.wz ?? to[2]);
            root.current.scale.setScalar((0.24 + build * 0.86) * fade);
        }
        shells.current.forEach((shell, i) => {
            if (shell) shell.rotation.y = elapsed * (i % 2 ? -2.6 : 3.2) + i * 1.2;
        });
        materials.current.forEach((material, i) => {
            if (!material) return;
            material.uniforms.uTime.value = elapsed;
            material.uniforms.uOpacity.value = fade * (i === 1 ? 0.62 : 0.82);
        });
        ribbons.current.forEach((ribbon, i) => {
            if (!ribbon) return;
            ribbon.rotation.y = elapsed * (2.8 + i * 0.4) * (i % 2 ? -1 : 1);
            const pulse = 0.86 + Math.sin(elapsed * 8 + i) * 0.08;
            ribbon.scale.set(pulse, 1, pulse);
            const material = ribbon.material as THREE.MeshToonMaterial;
            material.opacity = fade * (0.36 + (i % 2) * 0.08);
        });
        debris.current.forEach((piece, i) => {
            if (!piece) return;
            const u = (elapsed * (0.62 + (i % 4) * 0.08) + i / debrisCount) % 1;
            const radius = 0.45 + u * 1.15;
            const a = elapsed * 5.4 + i * 2.13;
            piece.position.set(Math.cos(a) * radius, 0.12 + u * 1.35, Math.sin(a) * radius);
            piece.rotation.set(a * 0.6, a, -a * 0.4);
            piece.scale.setScalar((0.055 + (i % 3) * 0.018) * fade);
        });
        if (p >= 1 && !complete.current) { complete.current = true; onDone(); }
    });
    const tornadoUniforms = (phase: number, opacity: number) => ({
        uTime: { value: 0 }, uPhase: { value: phase }, uOpacity: { value: opacity },
        uDark: { value: new THREE.Color(palette.dark) }, uWind: { value: new THREE.Color(palette.body) }, uCore: { value: new THREE.Color(palette.accent) },
    });
    return (
        <group ref={root}>
            {[0, 1, 2].map((i) => (
                <mesh key={`funnel-shell-${i}`} ref={(mesh) => { shells.current[i] = mesh; }} position={[0, 1.78, 0]} scale={[1 + i * 0.13, 1 - i * 0.025, 1 + i * 0.13]} renderOrder={30 + i}>
                    <cylinderGeometry args={[1.58, 0.16, 3.55, quality.id === "low" ? 24 : 42, quality.id === "low" ? 12 : 24, true]} />
                    <shaderMaterial ref={(material) => { materials.current[i] = material; }} vertexShader={TORNADO_VERTEX} fragmentShader={TORNADO_FRAGMENT} uniforms={tornadoUniforms(i * 2.17, i === 1 ? 0.62 : 0.82)} transparent depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            ))}
            {ribbonGeometries.map((geometry, i) => (
                <mesh key={`funnel-ribbon-${i}`} ref={(mesh) => { ribbons.current[i] = mesh; }} geometry={geometry} position={[0, 0.05, 0]} renderOrder={34}>
                    <meshToonMaterial color={i % 2 ? palette.body : palette.accent} emissive={palette.dark} emissiveIntensity={0.06} transparent opacity={0.42} depthWrite={false} />
                </mesh>
            ))}
            {Array.from({ length: debrisCount }, (_, i) => (
                <mesh key={`funnel-debris-${i}`} ref={(mesh) => { debris.current[i] = mesh; }} castShadow>
                    <dodecahedronGeometry args={[1, 0]} />
                    <meshToonMaterial color={i % 3 === 0 ? "#d9c49a" : i % 2 ? "#726657" : palette.dark} />
                </mesh>
            ))}
            <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.22, 1.72, quality.id === "low" ? 24 : 48]} />
                <meshToonMaterial color={palette.dark} transparent opacity={0.32} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {quality.dynamicPetLight && <pointLight position={[0, 1.8, 0]} color={palette.accent} intensity={3.1} distance={7} decay={2} />}
        </group>
    );
}


function DuelLunarSetPiece({ to, targetId, duel, clock, quality, onDone }: {
    to: Vec3; targetId?: string; duel: DuelResult; clock: { current: DuelClock }; quality: PetVisualQualityConfig; onDone: () => void;
}) {
    const root = useRef<THREE.Group>(null);
    const eclipse = useRef<THREE.Mesh>(null);
    const corona = useRef<THREE.Mesh>(null);
    const halo = useRef<THREE.Group>(null);
    const arenaSeal = useRef<THREE.Group>(null);
    const light = useRef<THREE.PointLight>(null);
    const slashes = useRef<Array<THREE.Mesh | null>>([]);
    const shards = useRef<Array<THREE.Mesh | null>>([]);
    const start = useRef<number | null>(null);
    const complete = useRef(false);
    const slashCount = quality.id === "low" ? 5 : quality.id === "medium" ? 7 : 8;
    const shardCount = quality.id === "low" ? 10 : quality.id === "medium" ? 16 : 22;
    const moonGeometry = useMemo(() => makeAnimeStrokeGeometry(3, 0.42, 1.08), []);
    const moonAccentGeometry = useMemo(() => makeAnimeStrokeGeometry(2.52, 0.11, 0.88), []);
    const slashGeometries = useMemo(() => Array.from({ length: slashCount }, (_, index) => makeAnimeStrokeGeometry(
        2.7 + (index % 3) * 0.34,
        0.2 + (index % 2) * 0.045,
        0.48 + (index % 3) * 0.1,
    )), [slashCount]);
    useEffect(() => () => {
        moonGeometry.dispose();
        moonAccentGeometry.dispose();
        slashGeometries.forEach((geometry) => geometry.dispose());
    }, [moonAccentGeometry, moonGeometry, slashGeometries]);
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / 1.86);
        const build = 1 - Math.pow(1 - Math.min(1, p / 0.18), 3);
        const strike = Math.min(1, Math.max(0, (p - 0.1) / 0.26));
        const fade = p < 0.72 ? 1 : Math.max(0, 1 - (p - 0.72) / 0.28);
        const liveTarget = liveDuelEffectPosition(duel, clock, targetId);
        if (root.current) {
            root.current.position.set(liveTarget?.wx ?? to[0], FLOOR_Y + 0.04, liveTarget?.wz ?? to[2]);
            root.current.scale.setScalar((0.12 + build * 0.96) * fade);
            root.current.rotation.y = 0;
        }
        if (eclipse.current) {
            const pulse = 0.94 + Math.sin(elapsed * 10) * 0.035;
            eclipse.current.scale.setScalar(pulse);
        }
        if (corona.current) {
            corona.current.rotation.z = 0.23 + Math.sin(elapsed * 2.4) * 0.08;
            corona.current.scale.setScalar(0.9 + Math.sin(elapsed * 8) * 0.045);
        }
        if (halo.current) {
            halo.current.rotation.z = elapsed * -0.72;
            const haloPulse = 0.84 + build * 0.16 + Math.sin(elapsed * 9) * 0.025;
            halo.current.scale.set(haloPulse, haloPulse * 1.08, haloPulse * 0.88);
        }
        if (arenaSeal.current) {
            arenaSeal.current.rotation.y = elapsed * 0.62;
            arenaSeal.current.scale.setScalar(0.74 + build * 0.26);
        }
        slashes.current.forEach((slash, index) => {
            if (!slash) return;
            const lane = index % 4 - 1.5;
            const opposingBundle = index >= Math.ceil(slashCount / 2);
            const localPhase = strike * 2.05 - index * 0.24;
            const stagger = localPhase > 0 && localPhase < 1 ? Math.sin(Math.PI * localPhase) : 0;
            slash.position.set(lane * 0.42, 0.44 + (index % 4) * 0.43, (opposingBundle ? -0.14 : 0.16) + stagger * 0.18);
            slash.rotation.set(0.04, lane * 0.08, (opposingBundle ? -0.64 : 0.64) + lane * 0.08);
            slash.scale.setScalar(Math.max(0.001, stagger * (0.78 + (index % 2) * 0.07)));
            (slash.material as THREE.MeshToonMaterial).opacity = fade * stagger * (index % 3 === 0 ? 0.86 : 0.74);
        });
        shards.current.forEach((shard, index) => {
            if (!shard) return;
            const u = index / Math.max(1, shardCount);
            const angle = elapsed * (1.8 + (index % 3) * 0.24) + u * Math.PI * 2;
            const radius = 1.5 + (index % 4) * 0.17;
            shard.position.set(Math.cos(angle) * radius, 0.3 + (index % 6) * 0.4 + Math.sin(angle * 1.4) * 0.18, Math.sin(angle) * radius);
            shard.rotation.set(angle, -angle * 0.7, angle * 0.4);
            shard.scale.setScalar((0.085 + (index % 3) * 0.022) * fade);
        });
        if (light.current) light.current.intensity = fade * Math.sin(Math.PI * Math.min(1, p * 1.6)) * 5.8;
        if (p >= 1 && !complete.current) { complete.current = true; onDone(); }
    });
    return (
        <group ref={root}>
            <group ref={arenaSeal} position={[0, 0.018, 0]}>
                <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={31}>
                    <ringGeometry args={[0.58, 2.08, quality.id === "low" ? 32 : 60]} />
                    <meshToonMaterial color="#261744" emissive="#6344bd" emissiveIntensity={0.12} transparent opacity={0.26} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
                <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]} renderOrder={32}>
                    <ringGeometry args={[2.22, 2.34, quality.id === "low" ? 32 : 60]} />
                    <meshToonMaterial color="#c5adff" emissive="#9d7cff" emissiveIntensity={0.28} transparent opacity={0.68} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            </group>
            <group ref={halo} position={[0, 2.08, -0.44]} rotation={[0.08, -0.12, 0]} scale={[1, 1.08, 0.88]}>
                <mesh renderOrder={33}>
                    <torusGeometry args={[1.52, 0.115, quality.id === "low" ? 6 : 10, quality.id === "low" ? 32 : 56]} />
                    <meshToonMaterial color="#6c49cc" emissive="#4f2ba8" emissiveIntensity={0.22} transparent opacity={0.82} depthWrite={false} />
                </mesh>
                <mesh renderOrder={34}>
                    <torusGeometry args={[1.29, 0.035, 6, quality.id === "low" ? 28 : 48]} />
                    <meshToonMaterial color="#f1e9ff" emissive="#b79bff" emissiveIntensity={0.38} transparent opacity={0.9} depthWrite={false} />
                </mesh>
            </group>
            {/* Layered brush crescents anchor the move without the floating
                black sphere that made the old eclipse read as placeholder art. */}
            <mesh ref={eclipse} geometry={moonGeometry} position={[-0.08, 2.7, -0.4]} rotation={[0.06, -0.16, 0.2]} scale={0.62} renderOrder={35}>
                <meshToonMaterial color="#7350d2" emissive="#452492" emissiveIntensity={0.2} transparent opacity={0.96} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={corona} geometry={moonAccentGeometry} position={[-0.02, 2.74, -0.42]} rotation={[0.06, -0.16, 0.23]} scale={0.57} renderOrder={36}>
                <meshToonMaterial color="#f2e9ff" emissive="#a27cff" emissiveIntensity={0.34} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {Array.from({ length: slashCount }, (_, index) => (
                <mesh key={`lunar-tail-${index}`} ref={(mesh) => { slashes.current[index] = mesh; }} geometry={slashGeometries[index]} renderOrder={36}>
                    <meshToonMaterial color={index % 3 === 0 ? "#f4eaff" : index % 2 ? "#b99bff" : "#8259ef"} emissive="#7044df" emissiveIntensity={0.18} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                </mesh>
            ))}
            {Array.from({ length: shardCount }, (_, index) => (
                <mesh key={`lunar-shard-${index}`} ref={(mesh) => { shards.current[index] = mesh; }} renderOrder={37}>
                    <octahedronGeometry args={[1, 0]} />
                    <meshToonMaterial color={index % 3 === 0 ? "#efe4ff" : "#9d7cff"} emissive="#6f44d8" emissiveIntensity={0.26} />
                </mesh>
            ))}
            {quality.dynamicPetLight && <pointLight ref={light} position={[0, 1.6, 0.2]} color="#9d7cff" intensity={0} distance={11} decay={2} />}
        </group>
    );
}


function DuelSignatureSetPiece(props: { kind: DuelSetPieceKind; from: Vec3; to: Vec3; targetId?: string; duel: DuelResult; clock: { current: DuelClock }; color: string; quality: PetVisualQualityConfig; onDone: () => void }) {
    if (props.kind === "tidalWave") return <DuelTsunamiSetPiece from={props.from} to={props.to} color={props.color} quality={props.quality} onDone={props.onDone} />;
    if (props.kind === "tornado") return <DuelTornadoSetPiece to={props.to} targetId={props.targetId} duel={props.duel} clock={props.clock} color={props.color} quality={props.quality} onDone={props.onDone} />;
    if (props.kind === "lunarBurst") return <DuelLunarSetPiece to={props.to} targetId={props.targetId} duel={props.duel} clock={props.clock} quality={props.quality} onDone={props.onDone} />;
    const kind: DuelElementBurstKind = props.kind === "flameBurst" ? "fire"
        : props.kind === "abyssBurst" ? "abyss"
            : props.kind === "lightningStorm" ? "lightning"
                : props.kind === "earthBurst" ? "earth"
                    : "arcane";
    const heading = Math.atan2(props.to[0] - props.from[0], props.to[2] - props.from[2]);
    return <DuelElementVolume at={[props.to[0], FLOOR_Y + 0.06, props.to[2]]} kind={kind} color={props.color} big heading={heading} phase="signature" quality={props.quality} onDone={props.onDone} />;
}


/** Studio-style signature renderer used by the live coliseum. Fire, earth,
 * lightning and abyss retain the cel-shaded impact language; water and wind are
 * routed to dedicated animated volumes above because their silhouettes must read
 * unmistakably as a tsunami and a tornado. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyDuelAnimeSetPiece({ kind, from, to, color, quality, onDone }: {
    kind: DuelSetPieceKind; from: Vec3; to: Vec3; color: string; quality: PetVisualQualityConfig; onDone: () => void;
}) {
    const root = useRef<THREE.Group>(null);
    const strokes = useRef<Array<THREE.Group | null>>([]);
    const materials = useRef<Array<THREE.MeshToonMaterial | null>>([]);
    const light = useRef<THREE.PointLight>(null);
    const start = useRef<number | null>(null);
    const completed = useRef(false);
    const fxKind: DuelElementBurstKind = kind === "tidalWave" ? "water"
        : kind === "tornado" ? "wind"
            : kind === "flameBurst" ? "fire"
                : kind === "abyssBurst" ? "abyss"
                    : kind === "lightningStorm" ? "lightning"
                        : kind === "earthBurst" ? "earth" : "arcane";
    const palette = useMemo(() => duelFxPalette(fxKind, color), [fxKind, color]);
    const count = quality.id === "low" ? 5 : quality.id === "medium" ? 7 : 8;
    const specs = useMemo(() => Array.from({ length: count }, (_, i) => {
        const u = i / Math.max(1, count - 1);
        if (fxKind === "water") {
            const a = -0.18 + u * Math.PI * 1.12;
            return { x: Math.cos(a) * 1.22 - 0.18, y: 0.32 + Math.sin(a) * 1.3, z: (i % 2) * 0.15, pitch: 0.02, yaw: -0.12 + i * 0.035, roll: a - 1.48, length: 1.52 + (i % 3) * 0.18, width: 0.25 + (i % 2) * 0.04, curl: 0.64 + (i % 3) * 0.1, jagged: 0 };
        }
        if (fxKind === "wind") {
            const a = i * 1.38;
            const radius = 0.28 + u * 0.82;
            return { x: Math.cos(a) * radius, y: 0.28 + u * 3.0, z: Math.sin(a) * radius, pitch: Math.PI / 2, yaw: a, roll: i % 2 ? 0.12 : -0.12, length: 1.45 + u * 1.72, width: 0.21 + u * 0.11, curl: 0.3 + u * 0.16, jagged: 0 };
        }
        if (fxKind === "lightning") {
            return { x: (i % 2 ? 0.26 : -0.26) + (i > count * 0.6 ? 0.24 : 0), y: 0.18 + u * 3.5, z: ((i % 3) - 1) * 0.17, pitch: 0, yaw: (i % 3 - 1) * 0.14, roll: i % 2 ? -0.72 : 0.72, length: 1.25 + (i % 3) * 0.24, width: 0.22, curl: 0.12, jagged: 0.24 };
        }
        if (fxKind === "earth") {
            const a = -1.08 + u * 2.16;
            return { x: Math.cos(a) * (0.45 + u * 0.75), y: 0.08 + (i % 3) * 0.15, z: Math.sin(a) * (0.45 + u * 0.75), pitch: 0.12, yaw: -a, roll: -0.52 + u * 1.04, length: 1.25 + (i % 3) * 0.22, width: 0.38 + (i % 2) * 0.08, curl: 0.1, jagged: 0.09 };
        }
        const lane = i - (count - 1) * 0.5;
        const flame = fxKind === "fire";
        return { x: flame ? Math.sin(i * 1.7) * (0.34 + u * 0.5) : 0.06 + (i % 2) * 0.16, y: 0.08 + (i % 3) * 0.18, z: flame ? Math.cos(i * 1.7) * (0.34 + u * 0.5) : lane * 0.22, pitch: 0, yaw: flame ? i * 1.7 : lane * 0.06, roll: flame ? 0.88 + (i % 3) * 0.28 : -0.76 + u * 1.52, length: 1.58 + (i % 3) * 0.28, width: 0.34 + (i % 2) * 0.07, curl: flame ? 0.56 + (i % 3) * 0.13 : fxKind === "abyss" ? 0.36 : 0.28, jagged: 0 };
    }), [count, fxKind]);
    const geometries = useMemo(() => specs.map((spec) => makeAnimeStrokeGeometry(spec.length, spec.width, spec.curl, spec.jagged)), [specs]);
    useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const heading = Math.atan2(dx, dz);
    const duration = fxKind === "water" ? 1.58 : fxKind === "wind" ? 1.5 : 1.42;
    useFrame((state) => {
        if (start.current === null) start.current = state.clock.elapsedTime;
        const elapsed = state.clock.elapsedTime - start.current;
        const p = Math.min(1, elapsed / duration);
        const arrive = 1 - Math.pow(1 - Math.min(1, p / 0.22), 3);
        const fade = p < 0.78 ? 1 : Math.max(0, 1 - (p - 0.78) / 0.22);
        const travel = fxKind === "water" ? 1 - Math.pow(1 - Math.min(1, p / 0.34), 2) : 1;
        if (root.current) {
            root.current.position.set(lerp(from[0], to[0], travel), FLOOR_Y + 0.06, lerp(from[2], to[2], travel));
            // A crest still travels down the attack lane, but presents at a
            // three-quarter broadcast angle. Fully aligning a broad wave to the
            // lane turns it edge-on and reads as a vertical board.
            root.current.rotation.y = fxKind === "wind" ? heading + p * Math.PI * 2.4 : fxKind === "water" ? heading * 0.2 : heading;
            root.current.scale.setScalar((0.24 + arrive * 1.04) * (fxKind === "wind" ? 1.06 : fxKind === "water" ? 0.8 : 1));
        }
        strokes.current.forEach((stroke, i) => {
            if (!stroke) return;
            const spec = specs[i];
            const stagger = Math.max(0, Math.min(1, arrive * 1.35 - i * 0.035));
            stroke.position.set(spec.x * stagger, spec.y * stagger, spec.z * stagger);
            stroke.rotation.set(spec.pitch, spec.yaw + (fxKind === "wind" ? p * 0.9 : 0), spec.roll);
            stroke.scale.setScalar(0.35 + stagger * 0.75);
        });
        materials.current.forEach((material) => { if (material) material.opacity = Number(material.userData.baseOpacity ?? 1) * fade; });
        if (light.current) light.current.intensity = fade * Math.sin(Math.PI * Math.min(1, p * 1.35)) * 5.2;
        if (p >= 1 && !completed.current) { completed.current = true; onDone(); }
    });
    return (
        <group ref={root}>
            {specs.map((spec, i) => (
                <group key={`signature-brush-${i}`} ref={(group) => { strokes.current[i] = group; }}>
                    <mesh geometry={geometries[i]} position={[0, 0, -0.05]} scale={[1.07, 1.07, 1.12]} castShadow={fxKind === "earth"}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.8; materials.current[i * 3] = material; } }} color={palette.dark} transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={geometries[i]} castShadow={fxKind === "earth"}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.96; materials.current[i * 3 + 1] = material; } }} color={i % 3 === 0 ? palette.accent : palette.body} emissive={palette.accent} emissiveIntensity={0.08} transparent opacity={0.96} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh geometry={geometries[i]} position={[spec.length * 0.13, spec.width * 0.08, 0.075]} scale={[0.64, 0.3, 0.7]}>
                        <meshToonMaterial ref={(material) => { if (material) { material.userData.baseOpacity = 0.84; materials.current[i * 3 + 2] = material; } }} color={palette.core} emissive={palette.accent} emissiveIntensity={0.11} transparent opacity={0.84} depthWrite={false} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            ))}
            {fxKind === "earth" && Array.from({ length: quality.id === "low" ? 6 : 10 }, (_, i) => {
                const a = (i / 10) * Math.PI * 2;
                return <mesh key={`signature-rock-${i}`} position={[Math.cos(a) * (0.65 + i % 3 * 0.25), 0.24 + i % 4 * 0.24, Math.sin(a) * (0.65 + i % 3 * 0.25)]} rotation={[i * 0.7, i * 0.4, i * 0.9]} scale={0.14 + i % 3 * 0.045} castShadow><dodecahedronGeometry args={[1, 0]} /><meshToonMaterial color={i % 2 ? palette.body : palette.accent} /></mesh>;
            })}
            <Sparkles count={Math.max(8, Math.round(quality.setPieceParticles * 0.48))} position={[0, fxKind === "wind" ? 1.8 : 1.0, 0]} scale={fxKind === "wind" ? [3.6, 4.2, 3.6] : [3.8, 3.1, 3.8]} size={1.8} speed={1.5} opacity={0.34} color={palette.core} noise={1.4} />
            {quality.dynamicPetLight && <pointLight ref={light} position={[0, 1.3, 0]} color={palette.accent} intensity={0} distance={8} decay={2} />}
        </group>
    );
}


function DuelAiDebugHud({ duel, clock, nameById }: { duel: DuelResult; clock: { current: DuelClock }; nameById: Record<string, string> }) {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const timer = window.setInterval(() => setTick(Math.max(0, Math.floor(clock.current.t))), 100);
        return () => window.clearInterval(timer);
    }, [clock]);
    const snap = duel.snapshots[Math.min(duel.snapshots.length - 1, tick)];
    if (!snap) return null;
    const recent = duel.events.filter((event) => event.type === "hit" && event.t <= tick && event.t >= tick - DUEL_TPS * 2).slice(-4);
    return (
        <div data-testid="pet-duel-ai-debug" style={{ position: "absolute", top: 52, right: 12, zIndex: 50, width: "min(390px,45vw)", maxHeight: "70vh", overflow: "auto", pointerEvents: "none", padding: 10, borderRadius: 10, border: "1px solid rgba(125,211,252,0.55)", background: "rgba(2,6,23,0.88)", color: "#e2e8f0", boxShadow: "0 10px 30px rgba(0,0,0,0.45)", font: "600 10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7, color: "#7dd3fc", fontWeight: 900 }}><span>AI TRUTH TRACE</span><span>t {(tick / DUEL_TPS).toFixed(1)}s</span></div>
            {snap.actors.map((actor) => (
                <div key={actor.id} style={{ padding: "7px 0", borderTop: "1px solid rgba(148,163,184,0.18)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", color: actor.team === "player" ? "#86efac" : "#fca5a5", fontWeight: 900 }}>
                        <span>{nameById[actor.id] ?? actor.id}</span><span>{Math.round(actor.hp)}/{actor.maxHp} HP</span>
                    </div>
                    <div><span style={{ color: "#fef08a" }}>{actor.ai?.state ?? "trace unavailable"}</span> → {actor.ai?.targetId ? (nameById[actor.ai.targetId] ?? actor.ai.targetId) : "none"} · R* {actor.ai?.desiredRange ?? "—"}</div>
                    <div>plan: {actor.ai?.plan ?? "—"}</div>
                    <div style={{ color: "#94a3b8" }}>why: {actor.ai?.reason ?? "—"}</div>
                    <div style={{ color: "#c4b5fd" }}>element: {actor.ai?.elementalSetup ?? "—"}</div>
                    <div>status: {actor.statuses.join(", ") || "clear"}</div>
                    {actor.ai?.path && actor.ai.path.length > 1 && <div>path: {actor.ai.path.map((point) => `(${point.x.toFixed(1)},${point.y.toFixed(1)})`).join(" → ")}</div>}
                    {actor.ai?.cooldownPriorities?.length ? <div style={{ color: "#bae6fd" }}>cd: {actor.ai.cooldownPriorities.join(" · ")}</div> : null}
                </div>
            ))}
            <div style={{ borderTop: "1px solid rgba(148,163,184,0.18)", paddingTop: 6, color: "#fda4af" }}>recent damage: {recent.length ? recent.map((event) => `${nameById[event.actorId] ?? event.actorId} ${event.dmg ?? 0}`).join(" · ") : "none"}</div>
        </div>
    );
}


/** Placeholder timeline for the first frame of a live duel, before the controller
 *  has produced a snapshot. Every consumer indexes snapshots defensively, so this
 *  simply renders nothing for one frame rather than needing a separate branch. */
const EMPTY_SNAPSHOTS: DuelResult["snapshots"] = [];

const EMPTY_EVENTS: DuelResult["events"] = [];

const EMPTY_DUEL: DuelResult = { result: "draw", winner: null, ticks: 0, snapshots: EMPTY_SNAPSHOTS, events: EMPTY_EVENTS };


export type PetColiseumDuelProps = {
    playerPet: Pet;
    enemyPet: Pet;
    playerReservePet?: Pet;
    enemyReservePet?: Pet;
    seed: number;
    /** Precomputed duel result. When provided, the renderer PLAYS it instead of
     *  re-running the sim — so the mounting screen owns the authoritative result
     *  (for reward posting) and the sim runs exactly once. Omit only in the
     *  /petvfx.html preview harness, where the renderer self-runs from the seed. */
    result?: DuelResult;
    /** PLAYER-CONTROLLED duel (docs/pet-coliseum-player-control-plan.md). When set,
     *  the fight is simulated live a beat ahead of playback and the command deck is
     *  shown; `result` is ignored and the outcome arrives through `onOutcome` when
     *  the fight actually finishes. Casual PvE only — every other caller passes a
     *  precomputed `result` and gets the unchanged watch-only duel. */
    live?: LiveDuel;
    /** Fired once, with the settled DuelResult, when a live duel finishes. The
     *  mounting screen owns reward posting, exactly as it does for `result`. */
    onOutcome?: (result: DuelResult) => void;
    /** Two-player (lockstep) duels only: report playback progress upstream so the
     *  shared watermark can advance. Omitted for single-player fights. */
    onProgress?: (playbackTick: number) => void;
    sharedImages?: Record<string, string>;
    /** Dev-harness scrub point for deterministic VFX screenshots. Live callers omit it. */
    initialTick?: number;
    onFightAgain?: () => void;
    settlementStatus?: PetBattleSettlementStatus;
    onRetrySettlement?: () => void;
    settlementCopy?: {
        pending: string;
        error: string;
        retry: string;
        settledExit: string;
    };
    /** Optional server-settled reward ceremony, mounted only with the result. */
    resultSupplement?: ReactNode;
    onExit: () => void;
    /** Lockstep only: offered when a stall has lasted long past the server's own
     *  drop window, i.e. THIS client's connection is the dead one. Unlike onExit
     *  it must not forfeit — the server may have settled the fight already, so
     *  the handler asks it for the authoritative result before settling. */
    onConnectionLost?: () => void;
};


/** A lockstep session reports when it is waiting on its opponent. Single-player
 *  duels never stall, so the absence of the field reads as "not waiting". */
const isStalledDuel = (d: LiveDuel): boolean => (d as { stalled?: boolean }).stalled === true;


/** A stall that outlives this is no longer "the opponent is slow": the SERVER
 *  drops a silent peer at 15s and immediately unblocks the watermark, so any
 *  stall an intact connection can experience clears well inside that window.
 *  One that does not means the missing syncs are ours — this client's own
 *  connection is dead — and the banner escalates to say so. */
const CONNECTION_LOST_AFTER_MS = 20_000;


/** True for a LOCKSTEP (two-human) duel. Only a lockstep session carries a
 *  watermark, so its presence is the honest structural test — the controlled ids
 *  cannot tell the two apart, since a p1 client commands "player-0" either way. */
const isVersusPlayer = (d: LiveDuel | undefined | null): boolean =>
    !!d && typeof (d as { safeTick?: number }).safeTick === "number";


export function PetColiseumDuel({ playerPet, enemyPet, playerReservePet, enemyReservePet, seed, result, live, onOutcome, onProgress, sharedImages = {}, initialTick = 0, onFightAgain, settlementStatus, onRetrySettlement, settlementCopy, resultSupplement, onExit, onConnectionLost }: PetColiseumDuelProps) {
    const [qualityId, setQualityId] = useState<PetVisualQuality>(() => petVisualQuality().id);
    const quality = PET_VISUAL_QUALITY_PRESETS[qualityId];
    const [audioMuted, setAudioMutedState] = useState(() => isAudioMuted());
    const battleMusicTheme = hollowHoundSurface(enemyPet) ? "hollow-gate" as const : "standard" as const;
    useEffect(() => subscribeAudioMute(() => setAudioMutedState(isAudioMuted())), []);
    useEffect(() => {
        if (!isAudioMuted()) {
            setBattleMusicIntensity("calm");
            startBattleMusic(battleMusicTheme);
        }
        return () => stopBattleMusic();
    }, [battleMusicTheme]);
    // Adaptive resolution: start at the tier's normal DPR (the device ratio clamped
    // into [min,max] — exactly what the static preset rendered) and let
    // PerformanceMonitor drop it toward the floor under sustained load, restoring
    // with headroom. This can only ever render FEWER pixels than before, never
    // more, so it relieves fill-rate pressure without changing the resting look.
    const dprBase = useMemo(() => Math.min(Math.max(quality.dpr[0], typeof window !== "undefined" ? window.devicePixelRatio : 1), quality.dpr[1]), [quality]);
    const [dpr, setDpr] = useState(dprBase);
    const changeQuality = (next: PetVisualQuality) => {
        const nextQuality = PET_VISUAL_QUALITY_PRESETS[next];
        const nextDpr = Math.min(Math.max(nextQuality.dpr[0], typeof window !== "undefined" ? window.devicePixelRatio : 1), nextQuality.dpr[1]);
        savePetVisualQuality(next);
        setQualityId(next);
        setDpr(nextDpr);
    };
    const perfQa = useMemo(() => new URLSearchParams(window.location.search).get("petPerf") === "1", []);
    const mobileQa = useMemo(() => new URLSearchParams(window.location.search).get("mobileqa") === "1", []);
    const visualLayers = useMemo(() => resolvePetDuelVisualLayers(new URLSearchParams(window.location.search).get("petLayers")), []);
    // Keyboard shortcuts on the command deck are offered only where there is a real
    // pointer; on touch they would just be dead hint glyphs cluttering the buttons.
    const canHover = useMemo(() => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: fine)").matches, []);
    const staticDuel = useMemo(
        () => live ? EMPTY_DUEL : directPetDuelPresentation(result
            ?? ((playerReservePet || enemyReservePet)
                ? runPetPartyDuel(playerPet, playerReservePet ?? null, enemyPet, enemyReservePet ?? null, seed)
                : runPetDuel(playerPet, enemyPet, seed))),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [live, result, seed, playerPet.id, enemyPet.id, playerReservePet?.id, enemyReservePet?.id],
    );
    // ── LIVE (player-controlled) duel ────────────────────────────────────────
    // The view is a GROWING DuelResult: the settled prefix of the simulation, cut
    // short of the look-ahead buffer the presentation layer needs. Its identity
    // changes as it grows, so every memo below (dash beats, hero cuts, breathers)
    // recomputes against the new timeline exactly as it would for a finished fight.
    const [liveView, setLiveView] = useState<DuelResult | null>(() => live ? live.advance(Math.max(0, initialTick)) : null);
    const [deckTick, setDeckTick] = useState(0);
    // Lockstep only: playback has caught up to the shared watermark and is waiting
    // on the opponent. Surfaced rather than hidden — a silent freeze reads as a
    // crash, and the player needs to know it is the connection, not the game.
    const [waitingOnPeer, setWaitingOnPeer] = useState(false);
    // …and for how long, continuously. A stall that outlasts the server's own
    // 15s drop-and-unblock window means the missing syncs are OURS — the banner
    // escalates from "waiting" to "connection lost" with a non-forfeit exit.
    const stallStartedAt = useRef<number | null>(null);
    const [connectionLost, setConnectionLost] = useState(false);
    // The tick a Bond Break was spent on — the meter counts events after it.
    const [bondSpentAt, setBondSpentAt] = useState(-1);
    // Optimistic echo of the most recent command, so a tap lights its button on the
    // same frame instead of waiting for playback to reach the re-simulated tick.
    const [pendingIntent, setPendingIntent] = useState<{
        atTick: number; stance: number | null; auto: boolean | null; orderedIdx: number | null; breakPending: boolean | null;
    }>({ atTick: -1, stance: null, auto: null, orderedIdx: null, breakPending: null });
    const duel = live ? (liveView ?? EMPTY_DUEL) : staticDuel;
    const battlePressureRatio = useMemo(() => {
        if (duel.snapshots.length === 0) return 1;
        const snapshot = duel.snapshots[Math.min(duel.snapshots.length - 1, Math.max(0, deckTick))];
        if (!snapshot?.actors.length) return 1;
        return snapshot.actors.reduce(
            (lowest, actor) => Math.min(lowest, Math.max(0, Math.min(1, actor.hp / Math.max(1, actor.maxHp)))),
            1,
        );
    }, [duel.snapshots, deckTick]);
    useEffect(() => {
        setBattleMusicIntensity(battlePressureRatio <= 0.32 ? "climax" : battlePressureRatio <= 0.68 ? "pressure" : "calm");
    }, [battlePressureRatio]);
    const roster = useMemo(() => {
        const r: Array<{ id: string; pet: Pet; mirror: boolean }> = [{ id: "player-0", pet: playerPet, mirror: false }];
        if (playerReservePet) r.push({ id: "player-1", pet: playerReservePet, mirror: false });
        r.push({ id: "enemy-0", pet: enemyPet, mirror: true });
        if (enemyReservePet) r.push({ id: "enemy-1", pet: enemyReservePet, mirror: true });
        return r;
    }, [playerPet, enemyPet, playerReservePet, enemyReservePet]);
    const visualAudit = useMemo(() => JSON.stringify({
        quality: quality.id,
        budgets: {
            impactDebris: quality.impactDebris,
            impactSparks: quality.impactSparks,
            aftermathLayers: quality.aftermathLayers,
            decalLimit: quality.decalLimit,
            bloomIntensity: quality.bloomIntensity,
        },
        fighters: roster.map(({ id, pet }) => {
            const model = petCombatModel(pet);
            return {
                id,
                petId: pet.id,
                rarity: pet.rarity,
                element: pet.element,
                modelUrl: model?.url ?? null,
                profile: model?.profile ?? null,
                targetHeight: model?.targetHeight ?? null,
                calibration: model ? petDuelModelCalibration(model) : null,
            };
        }),
    }), [quality, roster]);
    const partyDuel = roster.length > 2;
    const freeRoam3d = useMemo(() => roster.every((fighter) => petCombatModel(fighter.pet) !== null), [roster]);
    const playerFamily = useMemo(() => petCombatFamilyPresentation({
        name: playerPet.name,
        profile: petCombatModel(playerPet)?.profile,
    }), [playerPet]);
    const enemyFamily = useMemo(() => petCombatFamilyPresentation({
        name: enemyPet.name,
        profile: petCombatModel(enemyPet)?.profile,
    }), [enemyPet]);
    const debugAi = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debugAI") === "1", []);
    // 3D coliseum scene textures (curved wall + lit floor) — same as the round
    // renderer, so the duel inherits the grounded look the owner liked.
    const floor = useMemo(() => loadSceneTexture(COLISEUM_FLOOR_URL), []);
    const backdrop = useMemo(() => loadSceneTexture(COLISEUM_BG_URL), []);
    useEffect(() => () => { floor.dispose(); backdrop.dispose(); }, [floor, backdrop]);
    useEffect(() => scheduleDuelFxGeometryPrewarm(
        roster.map((fighter) => duelElementBurstKind(fighter.pet.element)),
        quality,
    ), [quality, roster]);

    const clock = useRef<DuelClock>({ t: Math.max(0, initialTick), playing: false, intro: 0 });   // starts paused for the VS intro + opening choreography
    const seqRef = useRef(0);
    const [runId, setRunId] = useState(0);
    // A live duel must hand its outcome over EXACTLY once — Replay remounts the
    // director and the exit forfeit is a second path into the same settlement.
    const outcomeSent = useRef(false);
    const [ended, setEnded] = useState(false);
    const [resultVisible, setResultVisible] = useState(false);
    const resultDialogRef = useRef<HTMLDivElement>(null);
    const finishScheduled = useRef(false);
    const resultTimer = useRef<number | null>(null);
    useEffect(() => () => {
        if (resultTimer.current !== null) window.clearTimeout(resultTimer.current);
    }, []);
    useEffect(() => {
        if (!resultVisible) return;
        const dialog = resultDialogRef.current;
        const combatRoot = dialog?.closest<HTMLElement>("[data-testid='pet-duel-root']");
        if (!dialog || !combatRoot) return;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const background = Array.from(combatRoot.children)
            .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== dialog)
            .map((element) => ({ element, inert: element.inert, ariaHidden: element.getAttribute("aria-hidden") }));
        for (const snapshot of background) {
            snapshot.element.inert = true;
            snapshot.element.setAttribute("aria-hidden", "true");
        }
        const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
        const focusDialog = () => (focusables()[0] ?? dialog).focus();
        const frame = window.requestAnimationFrame(focusDialog);
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            if (event.key !== "Tab") return;
            const items = focusables();
            if (!items.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };
        const onFocusIn = (event: FocusEvent) => {
            if (!dialog.contains(event.target as Node)) focusDialog();
        };
        window.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("focusin", onFocusIn, true);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener("keydown", onKeyDown, true);
            document.removeEventListener("focusin", onFocusIn, true);
            for (const snapshot of background) {
                snapshot.element.inert = snapshot.inert;
                if (snapshot.ariaHidden === null) snapshot.element.removeAttribute("aria-hidden");
                else snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
            }
            queueMicrotask(() => { if (previouslyFocused?.isConnected) previouslyFocused.focus(); });
        };
    }, [resultVisible]);
    const [paused, setPaused] = useState(false);
    const [numbers, setNumbers] = useState<Array<{ id: number; text: string; pos: Vec3; crit: boolean; heal: boolean }>>([]);
    const [impacts, setImpacts] = useState<Array<{ id: number; pos: Vec3; color: string; big: boolean; mode: DuelImpactMode }>>([]);
    const [elementBursts, setElementBursts] = useState<Array<{ id: number; pos: Vec3; kind: DuelElementBurstKind; color: string; big: boolean; heading: number; style: PetHeroMoveStyle }>>([]);
    const [aftermathFx, setAftermathFx] = useState<Array<{ id: number; pos: Vec3; kind: DuelElementBurstKind; color: string; big: boolean }>>([]);
    const [supportFx, setSupportFx] = useState<Array<{ id: number; pos: Vec3; color: string; kind: DuelSupportKind; actorId?: string }>>([]);
    const [fxList, setFxList] = useState<Array<{ id: number; frames: string[]; pos: Vec3; scale: number; dur: number }>>([]);
    const [cutInQueue, setCutInQueue] = useState<Array<{ id: number; pet: Pet; side: "player" | "enemy"; move: string; hold?: number }>>([]);
    const cutIn = cutInQueue[0] ?? null;
    const [shocks, setShocks] = useState<Array<{ id: number; pos: Vec3; color: string; big: boolean }>>([]);
    const [powerUps, setPowerUps] = useState<Array<{ id: number; pos: Vec3; color: string; actorId?: string; style: PetHeroMoveStyle }>>([]);
    const [trails, setTrails] = useState<Array<{ id: number; pos: Vec3; toward: number; kind: MoveChoreoKind; color: string; weight: DuelAttackWeight; style: PetHeroMoveStyle }>>([]);
    const [dashFx, setDashFx] = useState<DuelDashCue[]>([]);
    const [pressureFx, setPressureFx] = useState<DuelPressureCue[]>([]);
    const [setPieces, setSetPieces] = useState<Array<{ id: number; from: Vec3; to: Vec3; targetId?: string; color: string; kind: DuelSetPieceKind }>>([]);
    const [weatherCue, setWeatherCue] = useState<DuelWeatherCue | null>(null);
    const [dusts, setDusts] = useState<Array<{ id: number; at: Vec3 }>>([]);   // transient foot-dust on dodge landings / KO impact
    const [scorches, setScorches] = useState<Array<{ id: number; pos: Vec3; w: number; kind: DuelElementBurstKind; color: string }>>([]);   // elemental floor marks — the arena remembers the fight
    const [flash, setFlash] = useState<{ id: number; color: string; intensity: number } | null>(null);
    // The player's LAST order, echoed as an instant ribbon on their side. The deck
    // buttons already confirm at the bottom of the screen, but a command has to read
    // as an ACT — so the moment you tap, a labelled flourish fires in the play area,
    // before the sim even resolves the move. This is what turns "did that do
    // anything?" into "I just called that shot." Purely presentational.
    const [commandEcho, setCommandEcho] = useState<{ id: number; label: string; tone: "attack" | "signature" | "plan" } | null>(null);
    const [clashResult, setClashResult] = useState<{ id: number; winner: string | null; loser: string | null; side: "player" | "enemy" | "draw" } | null>(null);
    const [finisherCue, setFinisherCue] = useState<{ id: number; actorId: string; targetId: string; move?: string; side: "player" | "enemy" } | null>(null);
    const finisherTimer = useRef<number | null>(null);
    const crowdTimer = useRef<number | null>(null);
    const [callout, setCallout] = useState<{ id: number; text: string } | null>(null);
    const [combo, setCombo] = useState<{ id: number; n: number } | null>(null);
    const [announce, setAnnounce] = useState<{ id: number; text: string; tone: "danger" | "reversal" | "ultimate" | "ko" } | null>(null);  // play-by-play broadcast line
    const [moveCallout, setMoveCallout] = useState<{ id: number; text: string; side: "player" | "enemy"; tone: DuelMoveCalloutTone; who?: string; element?: string | null } | null>(null);  // tiered move ID
    const [intro, setIntro] = useState(true);   // VS splash held before the fight plays
    const [tacticLocked, setTacticLocked] = useState(!live || live.settled);
    const [openingTactic, setOpeningTactic] = useState<0 | 1 | 2 | null>(null);
    const [tacticCommitting, setTacticCommitting] = useState(false);
    const tacticCommitTimer = useRef<number | null>(null);
    const [commandAck, setCommandAck] = useState<{ id: number; actorIds: readonly string[] } | null>(null);
    useEffect(() => {
        if (!cutIn) return;
        const timer = window.setTimeout(() => setCutInQueue((queue) => queue.slice(1)), cutIn.hold ?? 1320);
        return () => window.clearTimeout(timer);
    }, [cutIn]);
    useEffect(() => {
        if (!commandEcho) return;
        const timer = window.setTimeout(() => setCommandEcho((cur) => (cur && cur.id === commandEcho.id ? null : cur)), 1050);
        return () => window.clearTimeout(timer);
    }, [commandEcho]);
    useEffect(() => {
        if (!commandAck) return;
        const timer = window.setTimeout(() => setCommandAck((current) => current?.id === commandAck.id ? null : current), 680);
        return () => window.clearTimeout(timer);
    }, [commandAck]);
    useEffect(() => () => {
        if (tacticCommitTimer.current !== null) window.clearTimeout(tacticCommitTimer.current);
        if (finisherTimer.current !== null) window.clearTimeout(finisherTimer.current);
        if (crowdTimer.current !== null) window.clearTimeout(crowdTimer.current);
    }, []);
    const elementById = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, r.pet.element])) as Record<string, string | null | undefined>, [roster]);
    // Keep the canonical species name separate from the player's display name:
    // animation classification must survive nicknames, while commentary and HUD
    // should honor the companion identity the player paid to set.
    const speciesNameById = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, r.pet.name])) as Record<string, string>, [roster]);
    const nameById = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, petDisplayName(r.pet)])) as Record<string, string>, [roster]);
    const petIdById = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, r.pet.id])) as Record<string, string>, [roster]);
    const profileById = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, petCombatModel(r.pet)?.profile])) as Record<string, PetCombatModelProfile | undefined>, [roster]);
    const ultById = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, r.pet.jutsus?.find((j) => j.signature)?.name ?? "Ultimate"])) as Record<string, string>, [roster]);
    // Each pet's HERO move — its signature jutsu if flagged, else its strongest by power —
    // the move that earns the anime freeze-frame CUT-IN, so every fight gets epic moments
    // even when no jutsu is formally flagged "signature" (most aren't).
    const heroMoveById = useMemo(() => Object.fromEntries(roster.map((r) => {
        const js = r.pet.jutsus ?? [];
        const sig = js.find((j) => j.signature);
        const strongest = js.reduce<(typeof js)[number] | undefined>((best, j) => ((j.power ?? 0) > (best?.power ?? -1) ? j : best), undefined);
        return [r.id, (sig ?? strongest)?.name ?? ""];
    })) as Record<string, string>, [roster]);
    // VS intro: hold on the face-off (clock paused) for a beat, then start. Re-runs
    // on replay / fight-again (runId bump).
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIntro(true);
        clock.current.playing = false;
        clock.current.intro = 0;   // restart the still size-up / power-gather choreography
        // A live fight begins with a real strategic choice. Hold the face-off until
        // the player briefs the pet; replay/watch-only paths already have a result
        // and flow through the authored intro without controls.
        if (live && !tacticLocked) return;
        // Clear the VS splash first, then let the gather play in the clear while the
        // simulation remains paused for the full opening.
        const splashT = window.setTimeout(() => setIntro(false), INTRO_SPLASH_END * 1000);
        const fightT = window.setTimeout(() => {
            clock.current.intro = INTRO_TOTAL;
            clock.current.playing = true;
            setPaused(false);
        }, INTRO_TOTAL * 1000);
        return () => { window.clearTimeout(splashT); window.clearTimeout(fightT); };
    }, [runId, live, tacticLocked]);

    // FX map through the SAME field→floor placement as the fighters, at mid-body
    // height, so impacts / numbers / casts land on the right pet in the 3D scene.
    const spawnNumber = (n: { x: number; z: number; text: string; crit: boolean; heal: boolean }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setNumbers((arr) => appendCapped(arr, { id, text: n.text, pos: [fp.wx, FLOOR_Y + TARGET_SPRITE_H * 1.05, fp.wz], crit: n.crit, heal: n.heal }, 4));
        window.setTimeout(() => setNumbers((arr) => arr.filter((x) => x.id !== id)), 850);
    };
    const spawnImpact = (n: { x: number; z: number; color: string; big: boolean; mode?: DuelImpactMode }) => {
        const mode = n.mode ?? "impact";
        // In the 3D presentation, ordinary contacts are fully owned by the
        // element brush burst and dash-arrival renderer. Keeping the legacy
        // graphic impact on top reintroduced pale rings and visual clutter.
        if (freeRoam3d && mode === "impact") return;
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setImpacts((arr) => appendCapped(arr, { id, pos: [fp.wx, mode === "impact" ? FX_Y : FLOOR_Y + 0.035, fp.wz], color: n.color, big: n.big, mode }, partyDuel ? 3 : 4));
    };
    const spawnElementBurst = (n: { x: number; z: number; element?: string | null; move?: string; color: string; big: boolean; heading?: number; style?: PetHeroMoveStyle }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setElementBursts((arr) => appendCapped(arr, { id, pos: [fp.wx, FX_Y, fp.wz], kind: duelElementBurstKind(n.element, n.move), color: n.color, big: n.big, heading: n.heading ?? 0, style: n.style ?? "generic" }, partyDuel ? 1 : 2));
    };
    const spawnAftermath = (n: { x: number; z: number; element?: string | null; move?: string; color: string; big: boolean }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setAftermathFx((arr) => appendCapped(arr, { id, pos: [fp.wx, FLOOR_Y, fp.wz], kind: duelElementBurstKind(n.element, n.move), color: n.color, big: n.big }, quality.aftermathLayers));
    };
    const spawnSupport = (n: { x: number; z: number; color: string; kind: DuelSupportKind; actorId?: string }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setSupportFx((arr) => appendCapped(arr, { id, pos: [fp.wx, FLOOR_Y + 0.035, fp.wz], color: n.color, kind: n.kind, actorId: n.actorId }, 2));
    };
    // Element-distinct ability VFX — an explicit fx-folder `key` (the tactical-arena
    // assets: kaboom/explosion/vortex/spark/bighit) when given, else the plain
    // element burst (fire/water/lightning/earth/wind).
    const spawnFx = (n: { x: number; z: number; element?: string | null; key?: string; scale: number; dur: number }) => {
        // High-quality models use native scene effects above. Retaining the old
        // flipbook sprites here only for fallback/2D pets avoids mixing visual
        // languages in the professional 3D presentation.
        if (freeRoam3d) return;
        const frames = bundledJutsuFxFrames(n.key || elementVfxKey(n.element));
        if (!frames) return;
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setFxList((arr) => appendCapped(arr, { id, frames, pos: [fp.wx, FX_Y, fp.wz], scale: n.scale * 1.1, dur: n.dur }, partyDuel ? 3 : 4));
    };
    // Ground shockwave rings on the floor at the impact point.
    const spawnShock = (n: { x: number; z: number; color: string; big: boolean }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setShocks((arr) => appendCapped(arr, { id, pos: [fp.wx, 0, fp.wz], color: n.color, big: n.big }, 2));
    };
    const spawnDust = (n: { x: number; z: number }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setDusts((arr) => appendCapped(arr, { id, at: [fp.wx, FLOOR_Y + 0.02, fp.wz] as Vec3 }, partyDuel ? 5 : 6));
    };
    const spawnScorch = (n: { x: number; z: number; big?: boolean; element?: string | null; color?: string }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setScorches((arr) => appendCapped(arr, {
            id,
            pos: [fp.wx, FLOOR_Y + 0.025, fp.wz] as Vec3,
            w: n.big ? 2.3 : 1.55,
            kind: duelElementBurstKind(n.element),
            color: n.color ?? elementColor(n.element).base,
        }, quality.decalLimit));
    };
    const spawnPowerUp = (n: { x: number; z: number; color: string; actorId?: string; style?: PetHeroMoveStyle }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setPowerUps((arr) => appendCapped(arr, { id, pos: [fp.wx, FLOOR_Y, fp.wz], color: n.color, actorId: n.actorId, style: n.style ?? "generic" }, 2));
    };
    // Swept melee weapon trail at the ATTACKER (mid-body), per choreography archetype.
    const spawnTrail = (n: { x: number; z: number; toward: number; kind: MoveChoreoKind; color: string; weight: DuelAttackWeight; style: PetHeroMoveStyle }) => {
        const id = seqRef.current++;
        const fp = duelFieldToFloor(n.x, n.z);
        setTrails((arr) => appendCapped(arr, { id, pos: [fp.wx, FLOOR_Y + TARGET_SPRITE_H * 0.42, fp.wz], toward: n.toward, kind: n.kind, color: n.color, weight: n.weight, style: n.style }, 2));
    };
    const spawnDash = (n: { actorId?: string; fromX: number; fromZ: number; toX: number; toZ: number; impactX?: number; impactZ?: number; color: string; element?: string | null; move?: string; style?: PetHeroMoveStyle; impact: boolean; startTick?: number; contactTick?: number }) => {
        const id = seqRef.current++;
        const from = duelFieldToFloor(n.fromX, n.fromZ);
        const to = duelFieldToFloor(n.toX, n.toZ);
        const impact = duelFieldToFloor(n.impactX ?? n.toX, n.impactZ ?? n.toZ);
        const travelDuration = n.impact ? 0.48 : 0.42;
        const duration = n.impact ? 1.04 : 0.82;
        const startTick = n.startTick ?? clock.current.t;
        const contactTick = Math.max(startTick + 1, n.contactTick ?? startTick + Math.round(DUEL_TPS * 0.5));
        const endTick = contactTick + Math.round(DUEL_TPS * (n.impact ? 1.15 : 0.8));
        // Alternate the authored lane per cue/actor. This is deterministic visual
        // choreography, not navigation: the pet still starts and lands at the
        // simulator's exact positions, but cuts across an S-shaped attack lane.
        const side = ((id + (n.actorId?.length ?? 0)) & 1) === 0 ? 1 : -1;
        const kind = duelElementBurstKind(n.element, n.move);
        const lunarMove = /lunar|eclipse|moon|ninetail|kitsune/i.test(String(n.move ?? ""));
        const cue: DuelDashCue = {
            id,
            actorId: n.actorId,
            from: [from.wx, FLOOR_Y, from.wz],
            to: [to.wx, FLOOR_Y, to.wz],
            impactAt: [impact.wx, FLOOR_Y, impact.wz],
            color: lunarMove ? "#9d7cff" : n.color,
            kind,
            move: n.move,
            style: n.style ?? "generic",
            impact: n.impact,
            // eslint-disable-next-line react-hooks/purity -- spawnDash is only ever called from DuelDirector's useFrame (it is passed down as a prop), never during render; the wall-clock stamp is what DuelDashArc eases the authored lane against
            createdAt: performance.now(),
            duration,
            travelDuration,
            startTick,
            contactTick,
            endTick,
            bend: side * (n.impact ? 0.56 : 0.42) * (n.style && n.style !== "generic" ? 1.32 : 1),
            weave: -side * (n.impact ? 0.24 : 0.18) * (n.style && n.style !== "generic" ? 1.38 : 1),
        };
        // At most one authored route can own a fighter. Overlapping cues were
        // the direct cause of the dash popping between two paths.
        setDashFx((arr) => appendCapped(arr.filter((existing) => !n.actorId || existing.actorId !== n.actorId), cue, 2));
    };
    const spawnPressure = (n: { fromX: number; fromZ: number; toX: number; toZ: number; leftColor: string; rightColor: string; leftElement?: string | null; rightElement?: string | null }) => {
        const id = seqRef.current++;
        const from = duelFieldToFloor(n.fromX, n.fromZ);
        const to = duelFieldToFloor(n.toX, n.toZ);
        setPressureFx(() => [{
            id,
            from: [from.wx, FLOOR_Y, from.wz],
            to: [to.wx, FLOOR_Y, to.wz],
            leftColor: n.leftColor,
            rightColor: n.rightColor,
            leftKind: duelElementBurstKind(n.leftElement),
            rightKind: duelElementBurstKind(n.rightElement),
        }]);
    };
    const spawnSetPiece = (n: { actorId?: string; targetId?: string; fromX: number; fromZ: number; toX: number; toZ: number; element?: string | null; move?: string }) => {
        const id = seqRef.current++;
        // Signature releases are deliberately delayed until their portrait/charge
        // anticipation clears. Resolve both combatants at RELEASE time instead of
        // replaying the coordinates captured 1.1-1.4 seconds earlier. At the faster
        // presentation clock that stale point could already be occupied by the
        // caster, making a hostile tornado look like a self-cast.
        const snapshot = duel.snapshots[Math.min(duel.snapshots.length - 1, Math.max(0, Math.floor(clock.current.t)))];
        const actor = n.actorId ? snapshot?.actors.find((candidate) => candidate.id === n.actorId && candidate.hp > 0) : null;
        let target = n.targetId && n.targetId !== n.actorId
            ? snapshot?.actors.find((candidate) => candidate.id === n.targetId && candidate.hp > 0)
            : null;
        if (!target && actor) {
            target = snapshot?.actors.find((candidate) => candidate.hp > 0 && candidate.team !== actor.team) ?? null;
        }
        const from = actor ? duelFieldToFloor(actor.x, actor.y) : duelFieldToFloor(n.fromX, n.fromZ);
        const to = target ? duelFieldToFloor(target.x, target.y) : duelFieldToFloor(n.toX, n.toZ);
        const kind = duelSetPieceKind(n.element, n.move);
        setSetPieces(() => [{
            id,
            from: [from.wx, FLOOR_Y, from.wz],
            to: [to.wx, FLOOR_Y, to.wz],
            targetId: target?.id ?? n.targetId,
            color: kind === "lunarBurst" ? "#9d7cff" : elementColor(n.element).base,
            kind,
        }]);
    };
    const triggerWeather = (n: { weather: PetColiseumWeather; actorId: string; move: string; atTick: number }) => {
        // `petLayers` is a QA-only isolation switch. Do not create a hidden cue
        // whose renderer cannot mount and therefore cannot release arena fog.
        if (!visualLayers.elements) return;
        const id = seqRef.current++;
        setWeatherCue({
            id,
            weather: n.weather,
            actorId: n.actorId,
            move: n.move,
            startTick: n.atTick,
            endTick: n.atTick + petColiseumWeatherDurationTicks(DUEL_TPS),
        });
    };
    // Full-screen element flash / big "CRITICAL!/FINISH!" callout / combo-counter pop.
    const triggerFlash = (color: string, intensity: number) => setFlash({ id: seqRef.current++, color, intensity: Math.min(0.6, intensity) });
    const triggerCallout = (text: string) => { const id = seqRef.current++; setCallout({ id, text }); window.setTimeout(() => setCallout((c) => (c && c.id === id ? null : c)), 760); };
    const triggerCombo = (n: number) => { const id = seqRef.current++; setCombo({ id, n }); window.setTimeout(() => setCombo((c) => (c && c.id === id ? null : c)), 820); };
    // Play-by-play broadcast line (lower-third) — narrates the swings of the fight.
    const triggerAnnounce = (text: string, tone: "danger" | "reversal" | "ultimate" | "ko") => { const id = seqRef.current++; setAnnounce({ id, text, tone }); window.setTimeout(() => setAnnounce((a) => (a && a.id === id ? null : a)), 2600); };
    // Named-move flash ("Hellhound Execution!") — a quick stylish callout, side-tinted.
    const triggerMoveCallout = (text: string, side: "player" | "enemy", tone: DuelMoveCalloutTone = "attack", who?: string, element?: string | null) => {
        const id = seqRef.current++;
        setMoveCallout({ id, text, side, tone, who, element });
        // The old 780 ms pill vanished before the eye could parse actor + move.
        // A named technique now owns a complete release beat; tactical reads stay
        // slightly shorter so they never compete with the next contact.
        window.setTimeout(
            () => setMoveCallout((current) => current?.id === id ? null : current),
            tone === "attack" || tone === "combo" ? 1180 : 980,
        );
    };
    const triggerClashResult = (winnerId: string | null, loserId: string | null) => {
        const id = seqRef.current++;
        const next = {
            id,
            winner: winnerId ? (nameById[winnerId] ?? "A fighter") : null,
            loser: loserId ? (nameById[loserId] ?? "the opponent") : null,
            side: winnerId ? (winnerId.startsWith("player") ? "player" : "enemy") : "draw",
        } as const;
        setClashResult(next);
        window.setTimeout(() => setClashResult((current) => current?.id === id ? null : current), 1850);
    };
    const triggerFinisher = (actorId: string, targetId: string, move: string | undefined) => {
        const id = seqRef.current++;
        if (finisherTimer.current !== null) window.clearTimeout(finisherTimer.current);
        // One beat owns the screen: clear informational overlays before the
        // finishing windup rather than stacking them beneath a larger banner.
        setCommandEcho(null);
        setMoveCallout(null);
        setAnnounce(null);
        setCombo(null);
        setCallout(null);
        setFinisherCue({ id, actorId, targetId, move, side: actorId.startsWith("enemy") ? "enemy" : "player" });
        duckBattleMusic(0.16, 860);
        playPetSfx("finisher");
        finisherTimer.current = window.setTimeout(() => {
            setFinisherCue((current) => current?.id === id ? null : current);
            finisherTimer.current = null;
        }, 1450);
    };
    // Signature ULTIMATE → an anime portrait cut-in (reuses the round renderer's
    // .pet-cutin CSS slam). The move name is the pet's flagged signature jutsu.
    const triggerCutIn = (actorId: string, move: string) => {
        const r = roster.find((x) => x.id === actorId); if (!r) return;
        const id = seqRef.current++;
        playPetSfx("buff");
        setCutInQueue((queue) => appendCapped(queue, { id, pet: r.pet, side: r.mirror ? "enemy" : "player", move: move || (r.pet.jutsus?.find((j) => j.signature)?.name ?? "Special Move") }, partyDuel ? 2 : 1));
    };
    // Set during render; read from the frame loop. A ref rather than the state value
    // because advanceClock is declared above the clash block and is only ever called
    // from DuelDirector's useFrame.
    const clashHold = useRef(false);
    const advanceClock = (maxT: number, delta: number) => {
        // Before the fight plays, advance the still size-up / power-gather clock.
        if (!clock.current.playing || cutIn) {
            // The tactical briefing is a real decision screen, not a countdown.
            // Hold the face-off composition until the player explicitly locks in,
            // then restart the authored opening from frame zero.
            if (live && !tacticLocked) clock.current.intro = Math.min(clock.current.intro ?? 0, INTRO_PAUSE_END * 0.58);
            else clock.current.intro = (clock.current.intro ?? 0) + delta;
            return;
        }
        // A CLASH stops playback outright while the player owns the read. Same proven
        // mechanism as the hero cut-in: only the presentation clock is held, the
        // simulation and its buffer are untouched, so determinism and the server
        // replay are unaffected. It releases the moment a call is made or the
        // real-time window lapses.
        if (clashHold.current) return;
        clock.current.t = Math.min(maxT, clock.current.t + delta * DUEL_TPS);
    };
    // ── Command deck plumbing ────────────────────────────────────────────────
    // Every order goes through live.command(), which rewinds to the last tick the
    // player has actually seen and re-simulates — so a tap is obeyed on the next
    // frame despite the look-ahead buffer.
    const issueCommand = (cmd: DuelCommand, moveName?: string) => {
        if (!live) return;
        live.command(cmd);
        const tick = Math.max(0, Math.floor(clock.current.t));
        setLiveView(live.advance(tick));
        // Acknowledge the decision immediately, but reserve premium feedback for
        // the authoritative windup and contact. This keeps cause and effect honest:
        // the button says "order received"; the pet and opponent sell the result.
        seqRef.current += 1;
        const echoId = seqRef.current;
        const accent = elementColor(playerPet.element);
        const visibleSnapshot = duel.snapshots[Math.min(duel.snapshots.length - 1, tick)];
        const commandedActor = visibleSnapshot ? findActor(visibleSnapshot, cmd.actorId) : null;
        const commandTarget = visibleSnapshot?.actors.find((actor) => actor.hp > 0 && actor.team !== commandedActor?.team);
        const stageCommandFocus = () => {
            if (commandTarget) requestDuelCommandFocus(cmd.actorId, commandTarget.id, accent.glow);
            duckBattleMusic(0.38, 620);
            playPetSfx("command");
        };
        if (cmd.kind === "ability") {
            const moveLabel = cmd.idx === -1 ? "Strike" : (moveName ?? "Attack");
            setCommandEcho({ id: echoId, label: `ORDERED · ${moveLabel}`, tone: "attack" });
            setCommandAck({ id: echoId, actorIds: [cmd.actorId] });
            stageCommandFocus();
            requestDuelCommandJolt(0.14, 0.18, 0.2);
            requestDuelCommandRush(tick);
            // The button owns confirmation, not the release cinematic. A Clash,
            // target change, or other authoritative event can still intervene
            // before the queued technique executes. The director will fire the
            // move slate / hero cut-in on the real cast event, keeping the title,
            // world-space VFX, contact sound, and damage on one honest timeline.
        } else if (cmd.kind === "technique") {
            const moveLabel = moveName ?? "Technique";
            setCommandEcho({ id: echoId, label: `CALLED · ${moveLabel}`, tone: "signature" });
            setCommandAck({ id: echoId, actorIds: [cmd.actorId] });
            stageCommandFocus();
            requestDuelCommandJolt(0.18, 0.24, 0.26);
            requestDuelCommandRush(tick);
        } else if (cmd.kind === "break") {
            setCommandEcho({ id: echoId, label: "BOND BREAK · READY", tone: "signature" });
            setCommandAck({ id: echoId, actorIds: [cmd.actorId] });
            stageCommandFocus();
            playPetSfx("buff");
            setFlash({ id: echoId, color: "#fbbf24", intensity: 0.14 });
            requestDuelCommandJolt(0.22, 0.28, 0.32);
            requestDuelCommandRush(tick);
        } else if (cmd.kind === "stance") {
            setCommandEcho({ id: echoId, label: `${["Press", "Balance", "Guard"][cmd.stance] ?? "Balance"} stance`, tone: "plan" });
            playPetSfx("move");
        } else if (cmd.kind === "auto") {
            setCommandEcho({ id: echoId, label: cmd.on ? "Auto — pet decides" : "You have the reins", tone: "plan" });
        } else if (cmd.kind === "clash") {
            // The bind breaks the instant you call it — name the read and hit the
            // camera, because this is the highest-stakes tap in the fight.
            const label = ["Strike", "Guard", "Dodge"][cmd.pick] ?? "Strike";
            setCommandEcho({ id: echoId, label: `${label}!`, tone: "signature" });
            playPetSfx("move");
            setFlash({ id: echoId, color: accent.glow, intensity: 0.62 });
            requestDuelCommandJolt(1.3, 2, 2.6);
        }
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
            const pattern = cmd.kind === "clash" || cmd.kind === "break"
                ? [18, 18, 34]
                : cmd.kind === "technique"
                    ? [16, 12, 30]
                    : cmd.kind === "ability" ? 16 : 8;
            navigator.vibrate(pattern);
        }
        // Optimistic echo: the control log is a record of what was TRUE at each
        // played tick, so it cannot show an order issued for the tick after this
        // one. Without this the button would take a beat to light up and the deck
        // would feel unresponsive even though the pet already has its orders.
        setPendingIntent((prev) => ({
            atTick: tick,
            stance: cmd.kind === "stance" ? cmd.stance : prev.atTick === tick ? prev.stance : null,
            auto: cmd.kind === "auto" ? cmd.on : prev.atTick === tick ? prev.auto : null,
            orderedIdx: cmd.kind === "ability" || cmd.kind === "technique" ? cmd.idx : cmd.kind === "auto" && cmd.on ? -2 : prev.atTick === tick ? prev.orderedIdx : null,
            breakPending: cmd.kind === "break" ? true : cmd.kind === "auto" && cmd.on ? false : prev.atTick === tick ? prev.breakPending : null,
        }));
    };
    // WHICH pet this client commands — see commandedActorId for why this is not
    // the constant "player-0" it used to be. Derived in pet-duel-live.ts so the
    // contract it rests on is pinned by tests rather than by this component.
    const meId = commandedActorId(live);
    const chooseOpeningTactic = (stance: 0 | 1 | 2) => {
        if (!live || tacticLocked || tacticCommitting) return;
        setOpeningTactic(stance);
        playPetSfx("move");
    };
    const confirmOpeningTactic = () => {
        if (!live || tacticLocked || tacticCommitting || openingTactic === null) return;
        setTacticCommitting(true);
        clock.current.intro = 0;
        live.controlledIds.forEach((id) => issueCommand({ kind: "stance", actorId: id, stance: openingTactic }));
        const selected = PET_OPENING_TACTICS[openingTactic];
        const id = seqRef.current++;
        setCommandAck({ id, actorIds: [...live.controlledIds] });
        setCommandEcho({ id, label: `${selected.name.toUpperCase()} PLAN LOCKED`, tone: "plan" });
        setFlash({ id, color: selected.color, intensity: 0.18 });
        tacticCommitTimer.current = window.setTimeout(() => {
            setTacticLocked(true);
            setTacticCommitting(false);
            tacticCommitTimer.current = null;
        }, 720);
    };
    const versusPlayer = isVersusPlayer(live);
    const loggedControl = live ? live.controlAt(deckTick, meId) : null;
    // ── CLASH ────────────────────────────────────────────────────────────────
    // Read at the PLAYED tick. The sim is a look-ahead ahead, so the bind on screen
    // has already been settled in the buffer with the pet's instinctive read; a call
    // rewinds past it and re-simulates (see LiveDuel.clashAt). `clashAnswered` keeps
    // the overlay up for a beat after the tap so the choice is seen to register, and
    // `clashOpenedAt` bounds the freeze in REAL time — a player who never answers
    // must not stall the fight forever.
    const clash = live ? live.clashAt(deckTick, meId) : null;
    const clashKey = clash ? `${clash.startT}` : null;
    const [clashAnswered, setClashAnswered] = useState<{ key: string; pick: number } | null>(null);
    // One interval owns the whole countdown: it stamps the bind it belongs to along
    // with the start and current times, so nothing has to be written synchronously
    // during render or from an effect body. A reading left over from a previous bind
    // is ignored by the key check, and the first tick lands 60 ms in — so the bar
    // starts full the moment the prompt appears.
    const [clashTimer, setClashTimer] = useState<{ key: string; started: number; now: number } | null>(null);
    useEffect(() => {
        if (!clashKey) return;
        const started = performance.now();
        const timer = window.setInterval(() => setClashTimer({ key: clashKey, started, now: performance.now() }), 60);
        return () => window.clearInterval(timer);
    }, [clashKey]);
    const clashPick = clashAnswered?.key === clashKey ? clashAnswered.pick : (clash?.pick ?? -1);
    const clashElapsed = clashTimer && clashTimer.key === clashKey ? (clashTimer.now - clashTimer.started) / 1000 : 0;
    // The prompt STAYS UP for as long as the bind is open, even after this player
    // has called it. That matters in live PvP, where your call is scheduled a few
    // ticks out and the bind does not break until your opponent has answered too —
    // so the overlay becomes the "waiting on them" state rather than vanishing and
    // leaving the fight looking hung.
    const clashVisible = !!clash && !ended;
    // …but the FREEZE only lasts while the read is still yours to make. Once you
    // have called it, playback must resume: in PvP the simulation has to reach the
    // tick your call was scheduled for before the bind can resolve at all, and a
    // client that stayed frozen would deadlock the watermark against its peer.
    // The real-time lapse is the other half of that guarantee — a player who never
    // answers must not hold their opponent hostage.
    const clashOpen = clashVisible && clashPick < 0 && clashElapsed < CLASH_ANSWER_SECONDS;
    const clashRemaining = 1 - Math.min(1, clashElapsed / CLASH_ANSWER_SECONDS);
    const answerClash = (pick: number) => {
        if (!live || !clash || !clashKey || clashPick >= 0) return;
        setClashAnswered({ key: clashKey, pick });
        issueCommand({ kind: "clash", actorId: meId, pick });
    };
    useEffect(() => { clashHold.current = clashOpen; }, [clashOpen]);
    // Trust the optimistic echo only until playback passes the tick it was issued
    // on; from there the re-simulated log is authoritative again.
    const echo = pendingIntent.atTick >= deckTick ? pendingIntent : null;
    // Leaving a live fight early is a FORFEIT. A watch-only duel was already
    // settled before it played, so quitting cost nothing; a live one would
    // otherwise let a player walk away from a loss — and from the Hollow Gate HP
    // penalty — by closing the screen.
    const exitDuel = () => {
        if (live && onOutcome && !outcomeSent.current) {
            outcomeSent.current = true;
            onOutcome({ ...live.outcome(), result: "loss", winner: "enemy" });
        }
        stopBattleMusic();
        onExit();
    };
    const deckControl = loggedControl && echo ? {
        ...loggedControl,
        stance: echo.stance ?? loggedControl.stance,
        auto: echo.auto ?? loggedControl.auto,
        orderedIdx: echo.orderedIdx ?? loggedControl.orderedIdx,
        breakPending: echo.breakPending ?? loggedControl.breakPending,
    } : loggedControl;
    // The meter is folded from the VISIBLE events, so it fills in step with the
    // hits the player is watching rather than with the buffered ones.
    const bond = live ? bondCharge(duel.events, meId, deckTick, bondSpentAt) : 0;
    const finishDuel = () => {
        if (finishScheduled.current) return;
        finishScheduled.current = true;
        // A live duel owns its own outcome: the mounting screen has not seen a
        // result yet, so hand it over here for reward posting. Guarded because
        // Replay remounts the director, which would otherwise settle a second time.
        if (live && onOutcome && !outcomeSent.current) { outcomeSent.current = true; onOutcome(live.outcome()); }
        // The result is its own shot. A late hero cut-in, dash ribbon, or pressure
        // volume must never remain layered over the winner/loser composition.
        setEnded(true);
        setResultVisible(false);
        setCutInQueue([]);
        setCallout(null);
        setCombo(null);
        setAnnounce(null);
        setMoveCallout(null);
        setClashResult(null);
        setFinisherCue(null);
        setPowerUps([]);
        setTrails([]);
        setDashFx([]);
        setPressureFx([]);
        setSetPieces([]);
        setWeatherCue(null);
        duckBattleMusic(0.24, 1050);
        if (duel.result === "win") playPetSfx("victory");
        crowdTimer.current = window.setTimeout(() => {
            playPetSfx("crowd");
            crowdTimer.current = null;
        }, 320);
        resultTimer.current = window.setTimeout(() => {
            setResultVisible(true);
            stopBattleMusic();
        }, 2350);
    };
    const replay = () => {
        if (resultTimer.current !== null) window.clearTimeout(resultTimer.current);
        resultTimer.current = null;
        finishScheduled.current = false;
        clock.current.t = Math.max(0, initialTick);
        clock.current.playing = false;
        duelCmdRush.active = false;
        duelCmdFocus.expiresAt = 0;
        setPaused(false);
        setEnded(false);
        setResultVisible(false);
        setNumbers([]);
        setImpacts([]);
        setElementBursts([]);
        setAftermathFx([]);
        setSupportFx([]);
        setFxList([]);
        setCutInQueue([]);
        setShocks([]);
        setDusts([]);
        setScorches([]);
        setPowerUps([]);
        setTrails([]);
        setDashFx([]);
        setPressureFx([]);
        setSetPieces([]);
        setWeatherCue(null);
        setFlash(null);
        setCallout(null);
        setCombo(null);
        setAnnounce(null);
        setMoveCallout(null);
        setClashResult(null);
        setFinisherCue(null);
        if (!isAudioMuted()) startBattleMusic(battleMusicTheme);
        setRunId((r) => r + 1);
    };
    const toggleAudio = () => {
        const nextMuted = !audioMuted;
        setAudioMuted(nextMuted);
        if (!nextMuted) {
            primePetSfx();
            startBattleMusic(battleMusicTheme);
            playPetSfx("buff");
        } else {
            stopBattleMusic();
        }
    };
    const togglePause = () => { setPaused((wasPaused) => { clock.current.playing = wasPaused; return !wasPaused; }); };
    // The live pump. Declared AFTER every clock mutation above on purpose: the
    // immutability lint treats a ref read inside an effect as pinning that ref, so
    // an earlier declaration would flag the existing playback controls.
    // A timer rather than useFrame — the simulation only has to stay AHEAD of
    // playback, and pumping React state at the render rate would be wasted work.
    useEffect(() => {
        if (!live) return;
        const timer = window.setInterval(() => {
            const tick = Math.max(0, Math.floor(clock.current.t));
            const next = live.advance(tick);
            setLiveView((prev) => (prev === next ? prev : next));
            setDeckTick(tick);
            // Two-player duels report playback upstream (throttled inside) — the
            // shared watermark is min(both players' progress), so a client that
            // stops reporting freezes its opponent as well as itself.
            if (onProgress) onProgress(tick);
            const stalled = isStalledDuel(live);
            if (!stalled) stallStartedAt.current = null;
            else if (stallStartedAt.current === null) stallStartedAt.current = Date.now();
            setWaitingOnPeer(stalled);
            setConnectionLost(stalled && Date.now() - (stallStartedAt.current ?? Date.now()) >= CONNECTION_LOST_AFTER_MS);
        }, 66);
        return () => window.clearInterval(timer);
    }, [live, onProgress]);
    useEffect(() => {
        if (live) return;
        const timer = window.setInterval(() => setDeckTick(Math.max(0, Math.floor(clock.current.t))), 100);
        return () => window.clearInterval(timer);
    }, [live]);
    const resultLabel = duel.result === "win" ? "Victory" : duel.result === "loss" ? "Defeat" : "Draw";
    const battleWinnerName = duel.result === "win"
        ? petDisplayName(playerPet)
        : duel.result === "loss"
            ? petDisplayName(enemyPet)
            : null;
    const broadcast = useMemo(() => petDuelBroadcastRead(duel, deckTick), [deckTick, duel]);
    const recap = useMemo(() => petDuelRecap(duel), [duel]);
    const selectedOpeningTactic = openingTactic === null ? null : PET_OPENING_TACTICS[openingTactic];

    return createPortal((
        <div data-testid="pet-duel-root" data-pet-visual-audit={visualAudit} className={mobileQa ? "pet-duel-mobile-qa" : "pet-combat-takeover"} style={{ position: "fixed", inset: mobileQa ? undefined : 0, top: mobileQa ? 0 : undefined, left: mobileQa ? "50%" : undefined, transform: mobileQa ? "translateX(-50%)" : undefined, zIndex: "var(--z-combat)", width: mobileQa ? 390 : undefined, height: mobileQa ? "min(844px,100dvh)" : undefined, overflow: "hidden", background: "linear-gradient(#1a1206, #0a0703 70%)" }}>
            <style>{`
                @keyframes petDuelFlash { 0% { opacity: 0; } 14% { opacity: var(--fp, 0.4); } 100% { opacity: 0; } }
                @keyframes petDuelCallout { 0% { opacity: 0; transform: scale(0.5); } 18% { opacity: 1; transform: scale(1.12); } 70% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(0.95); } }
                @keyframes petDuelCombo { 0% { opacity: 0; transform: scale(1.6); } 25% { opacity: 1; transform: scale(1); } 78% { opacity: 1; } 100% { opacity: 0; } }
                @keyframes petDuelCritPop { 0% { transform: scale(0.4); } 40% { transform: scale(1.35); } 100% { transform: scale(1); } }
                @keyframes petDuelVs { 0% { opacity: 0; transform: scale(2.2) rotate(-8deg); } 45% { opacity: 1; transform: scale(0.92) rotate(0deg); } 60% { transform: scale(1.04); } 100% { transform: scale(1); } }
                @keyframes petDuelVsName { 0% { opacity: 0; transform: translateY(14px); } 100% { opacity: 1; transform: translateY(0); } }
                @keyframes petDuelAnnounce { 0% { opacity: 0; transform: translateX(-50%) translateY(16px) scale(0.96); } 12% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } 82% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-6px); } }
                @keyframes petDuelCmdEcho { 0% { opacity: 0; transform: translateY(10px) scale(0.82); } 16% { opacity: 1; transform: translateY(0) scale(1.06); } 30% { transform: translateY(0) scale(1); } 78% { opacity: 1; } 100% { opacity: 0; transform: translateY(-6px) scale(0.98); } }
                @keyframes petDuelBriefIn { 0% { opacity: 0; transform: translateY(18px) scale(.96); } 65% { opacity: 1; transform: translateY(-3px) scale(1.01); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
                @keyframes petDuelMoveScene {
                    0% { opacity: 0; transform: translate3d(var(--move-entry),8px,0) scale(.94); filter: blur(5px); }
                    15% { opacity: 1; transform: translate3d(0,0,0) scale(1.015); filter: blur(0); }
                    24%,76% { opacity: 1; transform: translate3d(0,0,0) scale(1); filter: blur(0); }
                    100% { opacity: 0; transform: translate3d(var(--move-exit),-5px,0) scale(1.01); filter: blur(1px); }
                }
                @keyframes petDuelMoveRail { 0% { transform: scaleX(0); opacity: 0; } 16% { transform: scaleX(1); opacity: 1; } 78% { opacity: 1; } 100% { transform: scaleX(.72); opacity: 0; } }
                @keyframes petDuelMoveStreak { 0% { opacity: 0; transform: translateX(var(--streak-start)) skewX(-18deg); } 22% { opacity: .58; } 100% { opacity: 0; transform: translateX(var(--streak-end)) skewX(-18deg); } }
                @keyframes petDuelMoveWord { 0% { opacity: 0; transform: translateY(9px); letter-spacing: .16em; } 20% { opacity: 1; transform: translateY(0); letter-spacing: .035em; } 78% { opacity: 1; } 100% { opacity: 0; transform: translateY(-3px); } }
                @keyframes petDuelTacticalMove { 0% { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.9); } 18% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } 76% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-5px) scale(0.98); } }
                @keyframes petClashResult {
                    0% { opacity: 0; transform: translate(-50%,-50%) scale(1.65); filter: blur(4px); }
                    16% { opacity: 1; transform: translate(-50%,-50%) scale(0.92); filter: blur(0); }
                    25%,72% { opacity: 1; transform: translate(-50%,-50%) scale(1); }
                    100% { opacity: 0; transform: translate(-50%,-58%) scale(1.04); }
                }
                @keyframes petBattleResult {
                    0% { opacity: 0; transform: translateY(26px) scale(0.86); }
                    20% { opacity: 1; transform: translateY(0) scale(1.04); }
                    32%,100% { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes petBroadcastIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
                @keyframes petWeatherGradeIn { from { opacity: 0; } to { opacity: .58; } }
                @keyframes petWeatherReadIn { 0% { opacity: 0; transform: translateX(-28px); filter: blur(7px); } 28% { opacity: 1; transform: translateX(0); filter: blur(0); } 100% { opacity: 1; transform: translateX(0); } }
                @keyframes petWinnerHold { 0% { opacity: 0; transform: translate(-50%,-50%) scale(.72); } 28% { opacity: 1; transform: translate(-50%,-50%) scale(1.08); } 42%,100% { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
                @keyframes petFinisherFrame { 0% { opacity:0; transform:scaleY(.15); } 18% { opacity:1; transform:scaleY(1); } 78% { opacity:1; } 100% { opacity:0; transform:scaleY(.82); } }
                @keyframes petFinisherTitle { 0% { opacity:0; transform:translateY(12px) scale(1.3); letter-spacing:.32em; } 24% { opacity:1; transform:translateY(0) scale(1); letter-spacing:.16em; } 78% { opacity:1; } 100% { opacity:0; transform:translateY(-5px) scale(1.02); } }
                @keyframes petSignatureFocus { 0% { opacity: 0; } 18% { opacity: 1; } 100% { opacity: 0; } }
                @keyframes petSignatureCue { 0% { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.92); } 20% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } 72% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-5px) scale(0.98); } }
                @keyframes petHeroMotif { 0% { opacity: 0; transform: scale(1.65) rotate(-22deg); } 24% { opacity: .2; transform: scale(.94) rotate(4deg); } 100% { opacity: .08; transform: scale(1.08) rotate(0deg); } }
                @keyframes petCutinBars { 0% { transform: scaleY(0); } 14%,82% { transform: scaleY(1); } 100% { transform: scaleY(0); } }
                @keyframes petCutinSlab { 0% { opacity: 0; transform: scaleX(.72) skewX(-7deg); } 13% { opacity: 1; transform: scaleX(1.02) skewX(-7deg); } 22%,82% { opacity: 1; transform: scaleX(1) skewX(-7deg); } 100% { opacity: 0; transform: scaleX(.86) skewX(-7deg); } }
                @keyframes petCutinPortrait { 0% { opacity: 0; transform: translateX(var(--portrait-entry)) scale(1.12); filter: contrast(1.8) brightness(1.7) blur(3px); } 18% { opacity: 1; transform: translateX(0) scale(.98); filter: contrast(1.08) brightness(1.08) blur(0); } 28%,82% { opacity: 1; transform: translateX(0) scale(1); filter: contrast(1.04) brightness(1.02) blur(0); } 100% { opacity: 0; transform: translateX(var(--portrait-exit)) scale(1.025); } }
                @keyframes petCutinTitle { 0%,10% { opacity: 0; transform: translateY(18px) scale(.94); letter-spacing: .13em; } 24% { opacity: 1; transform: translateY(0) scale(1.025); letter-spacing: .025em; } 34%,82% { opacity: 1; transform: translateY(0) scale(1); letter-spacing: .025em; } 100% { opacity: 0; transform: translateY(-6px) scale(1.01); } }
                @keyframes petCutinChromatic { 0%,100% { opacity: 0; transform: translateX(-8%); } 17% { opacity: .62; } 72% { opacity: .2; transform: translateX(8%); } }
                .pet-duel-hero-cutin { z-index: 16; padding-inline: clamp(22px,8vw,120px); gap: clamp(20px,4vw,64px); background: transparent; clip-path: none; animation-duration: var(--cutin-duration); }
                .pet-duel-hero-cutin::before { clip-path: polygon(0 22%,100% 8%,100% 78%,0 92%); animation-duration: var(--cutin-duration); z-index: 1; }
                .pet-duel-hero-cutin .pet-cutin-slab { position: absolute; inset: 0; z-index: 0; clip-path: polygon(0 22%,100% 8%,100% 78%,0 92%); background: linear-gradient(100deg,rgba(2,6,23,.12) 0%,rgba(2,6,23,.97) 18%,rgba(8,12,28,.98) 78%,rgba(2,6,23,.12) 100%); box-shadow: inset 0 0 110px var(--hero-base); transform-origin: center; animation: petCutinSlab var(--cutin-duration) cubic-bezier(.16,.84,.24,1) both; }
                .pet-duel-hero-cutin .pet-cutin-slab::after { content:""; position:absolute; inset:22% 0 18%; border-block:1px solid color-mix(in srgb,var(--hero-glow) 72%,transparent); box-shadow:0 0 22px var(--hero-glow),inset 0 0 32px rgba(255,255,255,.04); }
                .pet-duel-hero-cutin .pet-cutin-bar { position:absolute; z-index:7; left:0; right:0; height:clamp(5px,.8vh,10px); background:#02040b; transform-origin:center; animation:petCutinBars var(--cutin-duration) ease both; }
                .pet-duel-hero-cutin .pet-cutin-bar.top { top:0; box-shadow:0 4px 20px rgba(0,0,0,.75); }
                .pet-duel-hero-cutin .pet-cutin-bar.bottom { bottom:0; box-shadow:0 -4px 20px rgba(0,0,0,.75); }
                .pet-duel-hero-cutin .pet-cutin-chroma { position:absolute; z-index:1; inset:18% -12%; opacity:0; background:linear-gradient(94deg,transparent 18%,var(--hero-base) 38%,transparent 48%,var(--hero-glow) 62%,transparent 82%); mix-blend-mode:screen; filter:blur(18px); animation:petCutinChromatic var(--cutin-duration) ease both; }
                .pet-duel-hero-cutin .pet-cutin-motif { position: absolute; z-index: 1; top: 50%; translate: 0 -50%; color: var(--hero-glow); font: 900 clamp(180px,34vw,470px)/.72 Georgia,serif; text-shadow: 0 0 36px var(--hero-glow); opacity: .08; animation: petHeroMotif 920ms cubic-bezier(.16,.84,.24,1) both; pointer-events: none; }
                .pet-duel-hero-cutin.player .pet-cutin-motif { left: 3%; }
                .pet-duel-hero-cutin.enemy .pet-cutin-motif { right: 3%; }
                .pet-duel-hero-cutin .pet-cutin-portrait { --portrait-entry:-90px; --portrait-exit:16px; position: relative; z-index: 2; filter: drop-shadow(0 14px 20px rgba(0,0,0,.68)); animation:petCutinPortrait var(--cutin-duration) cubic-bezier(.16,.84,.24,1) both; }
                .pet-duel-hero-cutin.enemy .pet-cutin-portrait { --portrait-entry:90px; --portrait-exit:-16px; }
                .pet-duel-hero-cutin .pet-cutin-portrait::after { content:""; position:absolute; z-index:-1; left:8%; right:8%; bottom:5%; height:24%; border-radius:50%; background:var(--hero-glow); filter:blur(22px); opacity:.32; transform:perspective(150px) rotateX(68deg); }
                .pet-duel-hero-cutin .pet-cutin-portrait .pet-battle-avatar, .pet-duel-hero-cutin .pet-cutin-model { width: clamp(170px,28vw,390px); height: clamp(170px,28vw,390px); overflow: visible; }
                .pet-duel-hero-cutin .pet-cutin-portrait > img { display: block; width: clamp(170px,28vw,390px); height: clamp(170px,28vw,390px); object-fit: contain; }
                .pet-duel-hero-cutin .pet-cutin-text { position: relative; z-index: 2; max-width: min(52vw,760px); gap: 8px; animation:petCutinTitle var(--cutin-duration) cubic-bezier(.16,.84,.24,1) both; }
                .pet-duel-hero-cutin .pet-cutin-text::before { content:""; width:clamp(78px,12vw,170px); height:3px; margin-bottom:4px; background:linear-gradient(90deg,var(--hero-glow),transparent); box-shadow:0 0 12px var(--hero-glow); }
                .pet-duel-hero-cutin.enemy .pet-cutin-text::before { background:linear-gradient(270deg,var(--hero-glow),transparent); }
                .pet-duel-hero-cutin .pet-cutin-pet { font-size: clamp(12px,1.5vw,19px); color: var(--hero-glow); text-shadow: 0 0 16px var(--hero-glow); }
                .pet-duel-hero-cutin .pet-cutin-move { font-size: clamp(30px,5.4vw,68px); white-space: normal; text-wrap: balance; text-shadow: 0 0 18px var(--hero-glow),0 5px 14px #000; }
                .pet-duel-hero-cutin .pet-cutin-kicker { width:max-content; padding:4px 8px; border:1px solid color-mix(in srgb,var(--hero-glow) 70%,transparent); border-radius:3px; background:rgba(2,6,23,.72); color: #fff4c7; font: 900 clamp(10px,1.1vw,14px)/1 var(--font-display); letter-spacing: .24em; text-transform: uppercase; box-shadow:0 0 14px color-mix(in srgb,var(--hero-glow) 22%,transparent); }
                .pet-duel-hero-cutin.enemy .pet-cutin-kicker { align-self:flex-end; }
                .pet-duel-hero-cutin .pet-cutin-release { color:rgba(226,232,240,.6); font:800 9px/1 Inter,system-ui,sans-serif; letter-spacing:.32em; text-transform:uppercase; }
                .pet-move-scene { --move-entry:-72px; --move-exit:16px; position:absolute; z-index:12; top:12%; left:4.5%; width:min(560px,58vw); pointer-events:none; color:var(--move-text); animation:petDuelMoveScene var(--move-duration) cubic-bezier(.16,.84,.24,1) both; }
                .pet-move-scene.enemy { --move-entry:72px; --move-exit:-16px; left:auto; right:4.5%; text-align:right; }
                .pet-move-scene .pet-move-atmosphere { position:absolute; inset:-38px -60px; z-index:-2; background:radial-gradient(ellipse at 32% 50%,color-mix(in srgb,var(--move-color) 34%,transparent),transparent 66%); filter:blur(10px); opacity:.78; }
                .pet-move-scene.enemy .pet-move-atmosphere { background:radial-gradient(ellipse at 68% 50%,color-mix(in srgb,var(--move-color) 34%,transparent),transparent 66%); }
                .pet-move-scene .pet-move-streaks { --streak-start:-34%; --streak-end:24%; position:absolute; z-index:-1; inset:-26px -11vw; overflow:hidden; mask-image:linear-gradient(90deg,transparent,#000 20% 80%,transparent); }
                .pet-move-scene.enemy .pet-move-streaks { --streak-start:34%; --streak-end:-24%; }
                .pet-move-scene .pet-move-streaks::before { content:""; position:absolute; inset:0; background:repeating-linear-gradient(173deg,transparent 0 13px,color-mix(in srgb,var(--move-color) 58%,transparent) 14px 16px,transparent 17px 28px); animation:petDuelMoveStreak var(--move-duration) ease-out both; }
                .pet-move-scene .pet-move-card { position:relative; overflow:hidden; padding:12px 18px 13px 20px; border-left:4px solid var(--move-color); background:linear-gradient(100deg,rgba(2,6,18,.94),rgba(5,9,22,.82) 72%,transparent); clip-path:polygon(0 0,94% 0,100% 50%,94% 100%,0 100%); box-shadow:0 12px 34px rgba(0,0,0,.58),inset 0 0 32px color-mix(in srgb,var(--move-color) 10%,transparent); }
                .pet-move-scene.enemy .pet-move-card { padding:12px 20px 13px 18px; border-left:0; border-right:4px solid var(--move-color); background:linear-gradient(260deg,rgba(2,6,18,.94),rgba(5,9,22,.82) 72%,transparent); clip-path:polygon(6% 0,100% 0,100% 100%,6% 100%,0 50%); }
                .pet-move-scene .pet-move-card::after { content:""; position:absolute; inset:0; background:linear-gradient(110deg,transparent 22%,rgba(255,255,255,.13) 47%,transparent 61%); transform:translateX(-120%); animation:petDuelMoveStreak var(--move-duration) ease-out both; mix-blend-mode:screen; }
                .pet-move-scene .pet-move-meta { display:flex; align-items:center; gap:8px; color:color-mix(in srgb,var(--move-text) 76%,#94a3b8); font:900 9px/1 Inter,system-ui,sans-serif; letter-spacing:.2em; text-transform:uppercase; }
                .pet-move-scene.enemy .pet-move-meta { justify-content:flex-end; }
                .pet-move-scene .pet-move-glyph { display:grid; place-items:center; width:19px; height:19px; border:1px solid var(--move-color); border-radius:50%; color:var(--move-color); box-shadow:0 0 12px color-mix(in srgb,var(--move-color) 55%,transparent); }
                .pet-move-scene .pet-move-title { margin-top:5px; color:var(--move-text); font:900 clamp(23px,3.5vw,46px)/.94 var(--font-display); letter-spacing:.035em; text-transform:uppercase; text-shadow:0 3px 10px #000,0 0 20px color-mix(in srgb,var(--move-color) 48%,transparent); text-wrap:balance; animation:petDuelMoveWord var(--move-duration) cubic-bezier(.16,.84,.24,1) both; }
                .pet-move-scene.tactical .pet-move-title { font-size:clamp(18px,2.3vw,28px); }
                .pet-move-scene .pet-move-rail { width:78%; height:2px; margin-top:9px; transform-origin:left; background:linear-gradient(90deg,var(--move-color),transparent); box-shadow:0 0 10px var(--move-color); animation:petDuelMoveRail var(--move-duration) ease both; }
                .pet-move-scene.enemy .pet-move-rail { margin-left:auto; transform-origin:right; background:linear-gradient(270deg,var(--move-color),transparent); }
                .pet-duel-mobile-qa .pet-duel-hero-cutin { padding-inline: 12px; gap: 8px; }
                .pet-duel-mobile-qa .pet-duel-hero-cutin .pet-cutin-portrait .pet-battle-avatar, .pet-duel-mobile-qa .pet-duel-hero-cutin .pet-cutin-portrait > img, .pet-duel-mobile-qa .pet-duel-hero-cutin .pet-cutin-model { width: 145px; height: 145px; }
                .pet-duel-mobile-qa .pet-duel-hero-cutin .pet-cutin-text { flex: 1; min-width: 0; max-width: 213px; }
                .pet-duel-mobile-qa .pet-duel-hero-cutin .pet-cutin-move { font-size: 26px; }
                .pet-duel-mobile-qa .pet-move-scene { top:15%; left:12px; right:12px; width:auto; }
                .pet-duel-mobile-qa .pet-move-scene .pet-move-card { padding-block:9px 10px; }
                .pet-duel-mobile-qa .pet-move-scene .pet-move-title { font-size:25px; }
                .pet-duel-weather-grade { position:absolute; inset:0; z-index:3; pointer-events:none; opacity:.58; mix-blend-mode:color; background:radial-gradient(ellipse at 50% 46%,transparent 24%,color-mix(in srgb,var(--weather-color) 18%,transparent) 68%,color-mix(in srgb,var(--weather-color) 42%,#03050b) 100%); animation:petWeatherGradeIn 680ms ease-out both; }
                .pet-duel-weather-grade.thunderstorm,.pet-duel-weather-grade.eclipse { mix-blend-mode:multiply; background:radial-gradient(ellipse at 50% 44%,transparent 22%,rgba(8,6,20,.2) 58%,rgba(4,3,12,.72) 100%); }
                .pet-duel-weather-grade.blizzard { mix-blend-mode:screen; opacity:.24; background:linear-gradient(155deg,rgba(219,243,255,.12),transparent 52%,rgba(172,220,255,.34)); }
                .pet-duel-weather-read { --weather-color:#9d7cff; position:absolute; z-index:10; top:76px; left:18px; display:grid; grid-template-columns:auto auto; align-items:end; gap:3px 9px; max-width:min(360px,42vw); padding:9px 14px 10px 13px; border-left:3px solid var(--weather-color); background:linear-gradient(100deg,rgba(2,6,18,.9),rgba(2,6,18,.52),transparent); box-shadow:-8px 0 28px color-mix(in srgb,var(--weather-color) 18%,transparent); pointer-events:none; animation:petWeatherReadIn 620ms cubic-bezier(.16,.84,.24,1) both; text-transform:uppercase; }
                .pet-duel-weather-read span { color:#94a3b8; font:900 8px/1 Inter,system-ui,sans-serif; letter-spacing:.2em; }
                .pet-duel-weather-read strong { color:#f8fafc; font:900 16px/.95 var(--font-display); letter-spacing:.07em; text-shadow:0 0 16px var(--weather-color); }
                .pet-duel-weather-read em { grid-column:1/-1; color:color-mix(in srgb,var(--weather-color) 76%,#fff); font:800 9px/1.2 Inter,system-ui,sans-serif; font-style:normal; letter-spacing:.12em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
                @media (max-width: 600px) { .pet-duel-hero-cutin { padding-inline: 12px; gap: 8px; } .pet-duel-hero-cutin .pet-cutin-portrait .pet-battle-avatar, .pet-duel-hero-cutin .pet-cutin-portrait > img, .pet-duel-hero-cutin .pet-cutin-model { width: 145px; height: 145px; } .pet-duel-hero-cutin .pet-cutin-text { flex: 1; min-width: 0; max-width: 213px; } .pet-duel-hero-cutin .pet-cutin-move { font-size: 26px; } .pet-duel-hero-cutin .pet-cutin-release { letter-spacing:.18em; } .pet-move-scene { top:15%; left:12px; right:12px; width:auto; } .pet-move-scene .pet-move-card { padding-block:9px 10px; } .pet-move-scene .pet-move-title { font-size:25px; } .pet-duel-mode-badge { display: none; } .pet-duel-top-controls button { padding: 5px 7px !important; font-size: 10px !important; } .pet-duel-weather-read { top:92px;left:10px;max-width:56vw;padding:7px 10px; } .pet-duel-weather-read strong { font-size:13px; } .pet-duel-weather-read span { font-size:7px; } }
                @media (prefers-reduced-motion: reduce) {
                    .pet-duel-hero-cutin,.pet-duel-hero-cutin::before,.pet-duel-hero-cutin .pet-cutin-slab,.pet-duel-hero-cutin .pet-cutin-bar,.pet-duel-hero-cutin .pet-cutin-chroma,.pet-duel-hero-cutin .pet-cutin-portrait,.pet-duel-hero-cutin .pet-cutin-text,.pet-move-scene,.pet-move-scene .pet-move-title,.pet-move-scene .pet-move-rail { animation:none !important; opacity:1; transform:none; filter:none; }
                    .pet-move-scene .pet-move-streaks { display:none; }
                    .pet-duel-weather-grade,.pet-duel-weather-read { animation:none !important; }
                }
            `}</style>
            {/* Vignette — darkens the screen edges so the eye stays on the fight. */}
            {visualLayers.post && <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 50% 46%, transparent 42%, rgba(0,0,0,0.55) 100%)" }} />}
            {/* The duel now plays INSIDE the 3D coliseum (curved wall + lit floor +
                perspective hero camera), so fighters STAND on the floor with real
                contact shadows instead of floating over a painted wall. */}
            <Canvas key={quality.id} shadows={quality.modelShadows ? { type: THREE.PCFShadowMap } : false} dpr={dpr} frameloop={paused || resultVisible ? "demand" : "always"} camera={{ position: CAM_POS, fov: CAM_FOV }} onCreated={({ camera }) => camera.lookAt(CAM_LOOK[0], CAM_LOOK[1], CAM_LOOK[2])}>
                {!weatherCue && <fog attach="fog" args={["#2a1c10", 26, 54]} />}
                <ResponsiveCamera />
                {/* Adaptive DPR: drop to the tier floor under sustained load, restore with
                    headroom; flipflops pins to the floor rather than oscillate. */}
                <PerformanceMonitor onDecline={() => setDpr(quality.dpr[0])} onIncline={() => setDpr(dprBase)} flipflops={3} onFallback={() => setDpr(quality.dpr[0])} />
                <Arena floor={floor} backdrop={backdrop} big />
                {visualLayers.elements && weatherCue && (
                    <DuelBattlefieldWeather
                        key={weatherCue.id}
                        cue={weatherCue}
                        clock={clock}
                        quality={quality}
                        onDone={() => setWeatherCue((current) => current?.id === weatherCue.id ? null : current)}
                    />
                )}
                {/* Ambient embers drifting through the arena — the world feels alive. */}
                {visualLayers.post && !weatherCue && <Sparkles count={quality.ambientParticles} scale={[26, 11, 14]} position={[0, 4.5, -2]} size={2.6} speed={0.16} opacity={0.28} color="#ffb46b" noise={1.6} />}
                {roster.map((r) => (
                    <DuelStandee key={r.id} duel={duel} clock={clock} id={r.id} pet={r.pet} mirror={r.mirror} sharedImages={sharedImages} freeRoam3d={freeRoam3d} dashCue={dashFx.find((dash) => dash.actorId === r.id)} showIdentity={visualLayers.identity && !ended} acknowledgingCommand={commandAck?.actorIds.includes(r.id) ?? false} />
                ))}
                <DuelCommandFocusMarker duel={duel} clock={clock} />
                {visualLayers.elements && Array.from({ length: 8 }).map((_, i) => (
                    <DuelProjectile key={i} index={i} duel={duel} clock={clock} quality={quality} native={freeRoam3d} />
                ))}
                {visualLayers.impacts && impacts.map((im) => (
                    <DuelImpact key={im.id} at={im.pos} color={im.color} big={im.big} mode={im.mode} onDone={() => setImpacts((p) => p.filter((x) => x.id !== im.id))} />
                ))}
                {visualLayers.elements && elementBursts.map((burst) => (
                    <DuelElementVolume key={burst.id} at={burst.pos} kind={burst.kind} color={burst.color} big={burst.big} heading={burst.heading} phase="contact" quality={quality} heroStyle={burst.style} onDone={() => setElementBursts((p) => p.filter((x) => x.id !== burst.id))} />
                ))}
                {visualLayers.aftermath && aftermathFx.map((fx) => (
                    <DuelElementVolume key={fx.id} at={fx.pos} kind={fx.kind} color={fx.color} big={fx.big} phase="aftermath" quality={quality} onDone={() => setAftermathFx((p) => p.filter((x) => x.id !== fx.id))} />
                ))}
                {visualLayers.elements && supportFx.map((fx) => (
                    <DuelSupportEffect key={fx.id} at={fx.pos} color={fx.color} kind={fx.kind} actorId={fx.actorId} duel={duel} clock={clock} onDone={() => setSupportFx((p) => p.filter((x) => x.id !== fx.id))} />
                ))}
                {visualLayers.impacts && shocks.map((s) => (
                    <DuelShockwaveV2 key={s.id} at={s.pos} color={s.color} big={s.big} quality={quality} onDone={() => setShocks((p) => p.filter((x) => x.id !== s.id))} />
                ))}
                {/* Accumulating scorch marks (crit/KO) + transient foot-dust — the floor remembers the fight. */}
                {visualLayers.aftermath && scorches.map((s) => (
                    <DuelElementDecal key={s.id} at={s.pos} kind={s.kind} color={s.color} size={s.w} />
                ))}
                {visualLayers.impacts && dusts.map((d) => (
                    <DustPuff key={d.id} at={d.at} onDone={() => setDusts((p) => p.filter((x) => x.id !== d.id))} />
                ))}
                {visualLayers.elements && powerUps.map((power) => (
                    <DuelPowerUpAura key={power.id} at={power.pos} color={power.color} quality={quality} actorId={power.actorId} duel={duel} clock={clock} heroStyle={power.style} onDone={() => setPowerUps((p) => p.filter((x) => x.id !== power.id))} />
                ))}
                {visualLayers.trails && trails.map((tr) => (
                    <DuelMeleeTrail key={tr.id} at={tr.pos} toward={tr.toward} kind={tr.kind} color={tr.color} weight={tr.weight} heroStyle={tr.style} native={freeRoam3d} onDone={() => setTrails((p) => p.filter((x) => x.id !== tr.id))} />
                ))}
                {visualLayers.trails && dashFx.map((dash) => (
                    <DuelDashEffectV2 key={dash.id} cue={dash} clock={clock} quality={quality} onDone={() => setDashFx((p) => p.filter((x) => x.id !== dash.id))} />
                ))}
                {visualLayers.elements && pressureFx.map((pressure) => (
                    <DuelPressureClashV2 key={pressure.id} from={pressure.from} to={pressure.to} leftColor={pressure.leftColor} rightColor={pressure.rightColor} leftKind={pressure.leftKind} rightKind={pressure.rightKind} quality={quality} onDone={() => setPressureFx((p) => p.filter((x) => x.id !== pressure.id))} />
                ))}
                {visualLayers.elements && setPieces.map((piece) => (
                    <DuelSignatureSetPiece key={piece.id} kind={piece.kind} from={piece.from} to={piece.to} targetId={piece.targetId} duel={duel} clock={clock} color={piece.color} quality={quality} onDone={() => setSetPieces((p) => p.filter((x) => x.id !== piece.id))} />
                ))}
                {visualLayers.impacts && fxList.map((fx) => (
                    <FxAnim key={fx.id} frames={fx.frames} from={fx.pos} durationMs={fx.dur} scale={fx.scale} onDone={() => setFxList((p) => p.filter((x) => x.id !== fx.id))} />
                ))}
                {numbers.map((l) => (
                    <Html key={l.id} position={l.pos} center pointerEvents="none" zIndexRange={[20, 0]}>
                        <span className={l.crit ? "damage-number crit-text" : l.heal ? "heal-number" : "damage-number"} style={{ font: l.crit ? "900 26px Inter, system-ui, sans-serif" : "800 18px Inter, system-ui, sans-serif", display: "inline-block", animation: l.crit ? "petDuelCritPop 360ms ease-out" : undefined }}>{l.text}</span>
                    </Html>
                ))}
                <DuelDirector key={runId} duel={duel} clock={clock} advanceClock={advanceClock} onEnd={finishDuel} canEnd={!live || live.settled} spawnNumber={spawnNumber} spawnImpact={spawnImpact} spawnElementBurst={spawnElementBurst} spawnAftermath={spawnAftermath} spawnFx={spawnFx} spawnSupport={spawnSupport} spawnShock={spawnShock} spawnDust={spawnDust} spawnScorch={spawnScorch} spawnPowerUp={spawnPowerUp} spawnTrail={spawnTrail} spawnDash={spawnDash} spawnPressure={spawnPressure} spawnSetPiece={spawnSetPiece} elementById={elementById} nameById={nameById} speciesNameById={speciesNameById} petIdById={petIdById} profileById={profileById} ultById={ultById} heroMoveById={heroMoveById} onCutIn={triggerCutIn} onFlash={triggerFlash} onCallout={triggerCallout} onCombo={triggerCombo} onAnnounce={triggerAnnounce} onMoveCallout={triggerMoveCallout} onWeather={triggerWeather} onClashResult={triggerClashResult} onFinisher={triggerFinisher} />
                {visualLayers.post && <BloomFx quality={quality} isolated />}
                {perfQa && <PetRenderStatsProbe quality={quality.id} />}
            </Canvas>

            {weatherCue && !ended && (
                <>
                    <div
                        aria-hidden="true"
                        className={`pet-duel-weather-grade ${weatherCue.weather.kind}`}
                        style={{ "--weather-color": weatherCue.weather.color } as React.CSSProperties}
                    />
                    <div className="pet-duel-weather-read" data-testid="pet-duel-weather-state" aria-live="polite" style={{ "--weather-color": weatherCue.weather.color } as React.CSSProperties}>
                        <span>Battlefield weather</span>
                        <strong>{weatherCue.weather.label}</strong>
                        <em>{weatherCue.move}</em>
                    </div>
                </>
            )}

            {/* VS pre-fight intro — both fighters hold their face-off while a "VS"
                splash slams in, then the clock starts. */}
            {/* Persistent broadcast read: spectacle still needs an instantly
                legible answer to "who is winning?" */}
            {!intro && !ended && !cutIn && (
                <div style={{
                    position: "absolute", top: mobileQa ? 52 : 12, left: "50%",
                    transform: "translateX(-50%)", zIndex: 11, pointerEvents: "none",
                    width: mobileQa ? "calc(100% - 24px)" : "min(520px,48vw)",
                    padding: mobileQa ? "7px 10px" : "8px 14px",
                    border: "1px solid rgba(226,232,240,.22)", borderRadius: 14,
                    background: "linear-gradient(180deg,rgba(2,6,18,.88),rgba(2,6,18,.64))",
                    boxShadow: "0 8px 28px rgba(0,0,0,.42)",
                    animation: "petBroadcastIn 360ms ease-out both",
                }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: "#dbeafe", font: "900 11px/1 Inter,system-ui,sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{petDisplayName(playerPet)}</div>
                            <div style={{ height: 5, marginTop: 5, borderRadius: 99, overflow: "hidden", background: "rgba(148,163,184,.2)" }}>
                                <div style={{ width: `${broadcast.player.percent}%`, height: "100%", background: "linear-gradient(90deg,#22c55e,#86efac)", transition: "width 180ms linear" }} />
                            </div>
                        </div>
                        <div style={{ textAlign: "center" }}>
                            <div style={{ color: broadcast.lead === "player" ? "#99f6e4" : broadcast.lead === "enemy" ? "#fecaca" : "#fde68a", font: "900 9px/1 Inter,system-ui,sans-serif", letterSpacing: ".12em", textTransform: "uppercase" }}>{broadcast.call}</div>
                            <div style={{ color: "#94a3b8", font: "800 9px/1 Inter,system-ui,sans-serif", marginTop: 4 }}>{Math.floor(broadcast.elapsedSeconds / 60)}:{String(broadcast.elapsedSeconds % 60).padStart(2, "0")}</div>
                        </div>
                        <div style={{ minWidth: 0, textAlign: "right" }}>
                            <div style={{ color: "#fee2e2", font: "900 11px/1 Inter,system-ui,sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{petDisplayName(enemyPet)}</div>
                            <div style={{ height: 5, marginTop: 5, borderRadius: 99, overflow: "hidden", background: "rgba(148,163,184,.2)" }}>
                                <div style={{ width: `${broadcast.enemy.percent}%`, height: "100%", marginLeft: "auto", background: "linear-gradient(90deg,#fca5a5,#ef4444)", transition: "width 180ms linear" }} />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {intro && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: live && !tacticLocked ? "auto" : "none", zIndex: 12 }}>
                    <div style={{ width: "100%" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "clamp(12px,3vw,40px)", padding: "0 5%" }}>
                            <span style={{ flex: 1, textAlign: "right", font: "800 clamp(18px,3vw,38px) var(--font-display)", color: "#93c5fd", textShadow: "0 2px 10px #000", animation: "petDuelVsName 500ms ease-out both" }}>
                                {petDisplayName(playerPet)}
                                <small style={{ display: "block", marginTop: 5, color: "#dbeafe", font: "800 clamp(9px,1vw,12px)/1.2 Inter,system-ui,sans-serif", letterSpacing: ".13em", textTransform: "uppercase" }}>{playerFamily.label} · {playerFamily.tell}</small>
                            </span>
                            <span style={{ font: "900 clamp(44px,9vw,104px) var(--font-display)", color: "#fff", letterSpacing: "0.02em", textShadow: "0 0 26px rgba(250,204,21,0.9), 0 4px 12px #000", animation: "petDuelVs 700ms cubic-bezier(.2,.9,.2,1) both" }}>VS</span>
                            <span style={{ flex: 1, textAlign: "left", font: "800 clamp(18px,3vw,38px) var(--font-display)", color: "#fca5a5", textShadow: "0 2px 10px #000", animation: "petDuelVsName 500ms ease-out 120ms both" }}>
                                {petDisplayName(enemyPet)}
                                <small style={{ display: "block", marginTop: 5, color: "#fee2e2", font: "800 clamp(9px,1vw,12px)/1.2 Inter,system-ui,sans-serif", letterSpacing: ".13em", textTransform: "uppercase" }}>{enemyFamily.label} · {enemyFamily.tell}</small>
                            </span>
                        </div>
                        {live && !tacticLocked && (
                            <div style={{ width: mobileQa ? "calc(100% - 20px)" : "min(760px,90vw)", margin: "clamp(16px,3vh,30px) auto 0", padding: mobileQa ? "12px" : "17px 20px 19px", borderRadius: 18, background: "linear-gradient(145deg,rgba(5,10,24,.97),rgba(2,5,14,.96))", border: "1px solid rgba(147,197,253,.42)", boxShadow: "0 18px 46px rgba(0,0,0,.68)", textAlign: "center", pointerEvents: "auto", animation: "petDuelBriefIn 620ms cubic-bezier(.16,.84,.24,1) both" }}>
                                <div style={{ color: "#fff", font: `900 ${mobileQa ? 13 : 16}px/1 var(--font-display),Inter,sans-serif`, letterSpacing: ".16em", textTransform: "uppercase" }}>Choose the Fight Plan</div>
                                <div style={{ marginTop: 7, color: "#a9b8cd", font: `700 ${mobileQa ? 9 : 11}px/1.35 Inter,sans-serif` }}>
                                    Select a plan, review its advantage and risk, then lock it in. The fight will wait for you.
                                </div>
                                <div style={{ marginTop: 7, color: "#fcd34d", font: `800 ${mobileQa ? 8 : 10}px/1.25 Inter,sans-serif`, letterSpacing: ".035em" }}>
                                    Scout read: {petDisplayName(enemyPet)} fights as {enemyFamily.label.toLowerCase()} — {enemyFamily.tell}.
                                </div>
                                {audioMuted && (
                                    <button
                                        type="button"
                                        onClick={toggleAudio}
                                        style={{ marginTop: 9, padding: mobileQa ? "6px 10px" : "7px 13px", borderRadius: 999, border: "1px solid rgba(251,191,36,.72)", background: "linear-gradient(180deg,rgba(120,53,15,.84),rgba(69,26,3,.88))", color: "#fef3c7", boxShadow: "0 0 18px rgba(245,158,11,.18)", font: `900 ${mobileQa ? 8 : 10}px/1 var(--font-display),Inter,sans-serif`, letterSpacing: ".1em", textTransform: "uppercase", cursor: "pointer" }}
                                    >
                                        🔊 Enable cinematic audio
                                    </button>
                                )}
                                <div role="group" aria-label="Opening tactic" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: mobileQa ? 6 : 10, marginTop: 13 }}>
                                    {PET_OPENING_TACTICS.map((tactic) => {
                                        const selected = openingTactic === tactic.stance;
                                        return (
                                        <button
                                            key={tactic.name}
                                            type="button"
                                            onClick={() => chooseOpeningTactic(tactic.stance)}
                                            aria-pressed={selected}
                                            disabled={tacticCommitting}
                                            style={{ minWidth: 0, minHeight: mobileQa ? 75 : 94, padding: mobileQa ? "8px 5px" : "11px 10px", borderRadius: 12, border: `${selected ? 2.5 : 1.5}px solid ${tactic.color}`, background: selected ? `linear-gradient(180deg,${tactic.color}48,rgba(4,8,18,.97))` : `linear-gradient(180deg,${tactic.color}1f,rgba(4,8,18,.95))`, color: tactic.color, boxShadow: selected ? `inset 0 -3px 0 ${tactic.color},0 0 24px ${tactic.color}55,0 8px 20px rgba(0,0,0,.48)` : `inset 0 -2px 0 ${tactic.color}66,0 5px 16px rgba(0,0,0,.4)`, transform: selected ? "translateY(-3px)" : undefined, cursor: tacticCommitting ? "default" : "pointer", transition: "transform 150ms ease,border-width 150ms ease,box-shadow 150ms ease,background 150ms ease" }}
                                        >
                                            <span aria-hidden style={{ display: "block", font: `900 ${mobileQa ? 13 : 17}px/1 Inter,sans-serif` }}>{tactic.glyph}</span>
                                            <strong style={{ display: "block", marginTop: 5, font: `900 ${mobileQa ? 9 : 12}px/1 var(--font-display),Inter,sans-serif`, letterSpacing: ".06em", textTransform: "uppercase" }}>{tactic.name}</strong>
                                            <span style={{ display: "block", marginTop: 6, color: "#dbe5f1", font: `700 ${mobileQa ? 7 : 9}px/1.25 Inter,sans-serif` }}>{tactic.short}</span>
                                        </button>
                                    );})}
                                </div>
                                <div aria-live="polite" style={{ minHeight: mobileQa ? 58 : 78, marginTop: 10, padding: mobileQa ? "8px 9px" : "10px 13px", borderRadius: 12, textAlign: "left", background: selectedOpeningTactic ? `${selectedOpeningTactic.color}12` : "rgba(15,23,42,.58)", border: `1px solid ${selectedOpeningTactic ? `${selectedOpeningTactic.color}55` : "rgba(148,163,184,.2)"}` }}>
                                    {selectedOpeningTactic ? (
                                        <>
                                            <div style={{ color: "#e5edf7", font: `700 ${mobileQa ? 8 : 10}px/1.35 Inter,sans-serif` }}>{selectedOpeningTactic.behavior}</div>
                                            <div style={{ display: "grid", gridTemplateColumns: mobileQa ? "1fr" : "1fr 1fr", gap: mobileQa ? 3 : 12, marginTop: 7, font: `800 ${mobileQa ? 7 : 9}px/1.3 Inter,sans-serif` }}>
                                                <span style={{ color: "#86efac" }}>ADVANTAGE · {selectedOpeningTactic.strength}</span>
                                                <span style={{ color: "#fca5a5" }}>RISK · {selectedOpeningTactic.tradeoff}</span>
                                            </div>
                                        </>
                                    ) : (
                                        <div style={{ color: "#94a3b8", textAlign: "center", font: `800 ${mobileQa ? 8 : 10}px/1.35 Inter,sans-serif` }}>Choose a plan to see how it changes your pet’s decisions.</div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={confirmOpeningTactic}
                                    disabled={!selectedOpeningTactic || tacticCommitting}
                                    style={{ width: "100%", minHeight: mobileQa ? 40 : 46, marginTop: 10, border: `1.5px solid ${selectedOpeningTactic?.color ?? "#475569"}`, borderRadius: 11, background: selectedOpeningTactic ? `linear-gradient(180deg,${selectedOpeningTactic.color}dd,${selectedOpeningTactic.color}88)` : "rgba(30,41,59,.78)", color: selectedOpeningTactic ? "#050914" : "#718096", boxShadow: selectedOpeningTactic ? `0 7px 22px ${selectedOpeningTactic.color}3d,inset 0 1px rgba(255,255,255,.35)` : "none", font: `900 ${mobileQa ? 10 : 12}px/1 var(--font-display),Inter,sans-serif`, letterSpacing: ".12em", textTransform: "uppercase", cursor: selectedOpeningTactic && !tacticCommitting ? "pointer" : "default" }}
                                >
                                    {tacticCommitting ? `${selectedOpeningTactic?.name ?? "Plan"} locked — take your stance` : selectedOpeningTactic ? `Lock In ${selectedOpeningTactic.name}` : "Select a Plan"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Anime signature CUT-IN — the action freeze-frames (hitStop) while a dark slam +
                diagonal speed lines sweep in, the pet's PORTRAIT slams from its side, and the
                move name lands huge. Self-contained (no external CSS) so it always shows. */}
            {cutIn && (() => {
                const isEnemy = cutIn.side === "enemy";
                const { base: elementBase, glow: elementGlow } = elementColor(cutIn.pet.element);
                const cutInModel = petCloseupPresentationModel(cutIn.pet);
                const cutPoseId = cutInModel ? null : posedId(petVisualId(cutIn.pet));
                const cutInStyle = petHeroMoveStyle({
                    petId: cutIn.pet.id,
                    petName: cutIn.pet.name,
                    move: cutIn.move,
                    profile: cutInModel?.profile,
                });
                const lunarHero = cutInStyle.startsWith("kitsune-");
                const tidalHero = cutInStyle.startsWith("selkie-");
                const cutInFamily = petCombatFamilyPresentation({
                    name: cutIn.pet.name,
                    profile: cutInModel?.profile,
                });
                const heroMotif = lunarHero ? "☾" : tidalHero ? "≋" : cutInFamily.motif;
                const heroKicker = lunarHero ? "Anime Break · Moon Veil" : tidalHero ? "Anime Break · Riptide" : `Anime Break · ${cutInFamily.label}`;
                return (
                    <div
                        className={`pet-cutin pet-duel-hero-cutin ${cutIn.side}`}
                        key={`cutin-${cutIn.id}`}
                        style={{
                            ["--hero-glow" as string]: elementGlow,
                            ["--hero-base" as string]: elementBase,
                            ["--cutin-duration" as string]: `${cutIn.hold ?? 1320}ms`,
                        } as React.CSSProperties}
                    >
                        <div className="pet-cutin-slab" />
                        <div className="pet-cutin-chroma" />
                        <span className="pet-cutin-bar top" aria-hidden="true" />
                        <span className="pet-cutin-bar bottom" aria-hidden="true" />
                        <div style={{ position: "absolute", zIndex: 1, inset: 0, background: `radial-gradient(circle at ${isEnemy ? 72 : 28}% 55%, ${elementGlow}42, transparent 44%)`, mixBlendMode: "screen" }} />
                        <span className="pet-cutin-motif" aria-hidden="true">{heroMotif}</span>
                        <div className="pet-cutin-portrait">
                            {cutInModel ? (
                                <DuelCutInModelPortrait pet={cutIn.pet} config={cutInModel} style={cutInStyle} move={cutIn.move} mirror={isEnemy} />
                            ) : cutPoseId ? (
                                <img src={poseUrl(cutPoseId, "cast")} alt={cutIn.pet.name} style={{ transform: isEnemy ? "scaleX(-1)" : undefined }} />
                            ) : (
                                <PetBattleAvatar pet={cutIn.pet} side={cutIn.side} active sharedImages={sharedImages} visualState="rangedCast" />
                            )}
                        </div>
                        <div className="pet-cutin-text">
                            <span className="pet-cutin-kicker">{heroKicker}</span>
                            <span className="pet-cutin-pet">{petDisplayName(cutIn.pet)}</span>
                            <span className="pet-cutin-move">{cutIn.move}!</span>
                            <span className="pet-cutin-release">Signature release</span>
                        </div>
                    </div>
                );
            })()}

            {/* Combat-juice overlays: full-screen element flash, big callout, combo. */}
            {flash && (
                <div key={`flash-${flash.id}`} style={{ position: "absolute", inset: 0, background: flash.color, opacity: 0, mixBlendMode: "screen", pointerEvents: "none", animation: "petDuelFlash 340ms ease-out forwards", ["--fp" as string]: flash.intensity } as React.CSSProperties} />
            )}
            {finisherCue && !ended && !cutIn && (
                <div key={`finisher-${finisherCue.id}`} style={{ position: "absolute", inset: 0, zIndex: 24, pointerEvents: "none", animation: "petFinisherFrame 1450ms cubic-bezier(.16,.84,.24,1) both" }}>
                    <div style={{ position: "absolute", inset: "0 0 auto", height: mobileQa ? 42 : 58, background: "linear-gradient(#02040b,rgba(2,4,11,.94))", borderBottom: `2px solid ${finisherCue.side === "player" ? "#fbbf24" : "#fb7185"}`, boxShadow: `0 8px 30px ${finisherCue.side === "player" ? "#f59e0b44" : "#e11d4844"}` }} />
                    <div style={{ position: "absolute", inset: "auto 0 0", height: mobileQa ? 42 : 58, background: "linear-gradient(rgba(2,4,11,.94),#02040b)", borderTop: `2px solid ${finisherCue.side === "player" ? "#fbbf24" : "#fb7185"}`, boxShadow: `0 -8px 30px ${finisherCue.side === "player" ? "#f59e0b44" : "#e11d4844"}` }} />
                    <div style={{ position: "absolute", top: mobileQa ? 52 : 72, left: "50%", transform: "translateX(-50%)", width: "min(720px,88vw)", textAlign: "center", animation: "petFinisherTitle 1450ms cubic-bezier(.16,.84,.24,1) both" }}>
                        <div style={{ color: finisherCue.side === "player" ? "#fde68a" : "#fecdd3", font: `900 ${mobileQa ? 18 : 26}px/1 var(--font-display),Inter,sans-serif`, letterSpacing: ".16em", textTransform: "uppercase", textShadow: "0 3px 12px #000,0 0 18px currentColor" }}>Finishing Window</div>
                        <div style={{ marginTop: 6, color: "#f8fafc", font: `800 ${mobileQa ? 9 : 11}px/1 Inter,sans-serif`, letterSpacing: ".14em", textTransform: "uppercase", textShadow: "0 2px 8px #000" }}>
                            {nameById[finisherCue.actorId] ?? "A fighter"} commits {finisherCue.move ? `· ${finisherCue.move}` : "· final strike"}
                        </div>
                    </div>
                </div>
            )}
            {callout && !cutIn && !finisherCue && (() => {
                const minor = callout.text === "MISS";
                return <div key={`callout-${callout.id}`} style={{
                    position: "absolute",
                    top: minor ? "23%" : "22%",
                    left: minor ? "50%" : 0,
                    right: minor ? undefined : 0,
                    transform: minor ? "translateX(-50%)" : undefined,
                    width: minor ? "max-content" : undefined,
                    textAlign: "center",
                    pointerEvents: "none",
                    padding: minor ? "4px 14px" : undefined,
                    borderRadius: minor ? 999 : undefined,
                    background: minor ? "rgba(8,11,22,0.72)" : undefined,
                    border: minor ? "1px solid rgba(226,232,240,0.6)" : undefined,
                    font: minor ? "900 clamp(18px,2.5vw,28px)/1 var(--font-display)" : "900 clamp(26px,4.8vw,50px)/1 var(--font-display)",
                    color: "#fff",
                    letterSpacing: "0.05em",
                    textShadow: minor ? "0 2px 8px #000" : "0 0 18px rgba(250,204,21,0.9), 0 4px 10px #000",
                    animation: minor ? "petDuelTacticalMove 740ms ease-out forwards" : "petDuelCallout 740ms cubic-bezier(.2,.9,.2,1) forwards",
                    zIndex: 13,
                }}>{callout.text}</div>;
            })()}
            {combo && combo.n >= 2 && !cutIn && !callout && !finisherCue && (
                <div key={`combo-${combo.id}`} style={{ position: "absolute", top: "18%", right: "8%", pointerEvents: "none", textAlign: "center", font: "900 clamp(24px,4vw,44px)/1 Inter, system-ui, sans-serif", color: "#fde68a", textShadow: "0 0 14px rgba(245,158,11,0.85), 0 3px 8px #000", animation: "petDuelCombo 700ms ease-out forwards" }}>{combo.n}<span style={{ fontSize: "0.45em", letterSpacing: "0.15em", display: "block" }}>HIT COMBO</span></div>
            )}
            {/* Named-move flash — the ability's name slams in on cast/hit (signatures
                use the bigger cut-in instead), side-tinted blue (you) / red (foe). */}
            {moveCallout && !cutIn && !callout && !finisherCue && (() => {
                const tactical = moveCallout.tone === "support" || moveCallout.tone === "maneuver";
                // CATEGORY drives the colour and the glyph; SIDE is a secondary cue.
                // It used to be the other way round — every banner was simply blue for
                // you and red for them — so a heal, a buff, a dodge and a fireball were
                // the same object with different words, and the fight read as noise.
                // Now a green ▲ is always something getting stronger and an amber ⚔ is
                // always damage, whoever threw it.
                const cat = MOVE_CALLOUT_STYLE[moveCallout.tone];
                const elemental = elementColor(moveCallout.element);
                const moveColor = moveCallout.tone === "attack" || moveCallout.tone === "combo" ? elemental.base : cat.color;
                const category = moveCallout.tone === "attack"
                    ? "Technique"
                    : moveCallout.tone === "support"
                        ? "Support art"
                        : moveCallout.tone === "maneuver"
                            ? "Combat shift"
                            : "Element chain";
                const elementName = String(moveCallout.element ?? "").trim();
                return (
                    <div
                        key={`move-${moveCallout.id}`}
                        className={`pet-move-scene ${moveCallout.side} ${tactical ? "tactical" : "hero"}`}
                        role="status"
                        aria-live="polite"
                        style={{
                            ["--move-color" as string]: moveColor,
                            ["--move-text" as string]: cat.text,
                            ["--move-duration" as string]: `${moveCallout.tone === "attack" || moveCallout.tone === "combo" ? 1180 : 980}ms`,
                        } as React.CSSProperties}
                    >
                        <div className="pet-move-atmosphere" />
                        <div className="pet-move-streaks" />
                        <div className="pet-move-card">
                            <div className="pet-move-meta">
                                <span className="pet-move-glyph" aria-hidden="true">{cat.glyph}</span>
                                <span>{category}</span>
                                {elementName && <span style={{ opacity: .58 }}>· {elementName}</span>}
                                {moveCallout.who && <span style={{ opacity: .78 }}>· {moveCallout.who}</span>}
                            </div>
                            <div className="pet-move-title">{moveCallout.text}</div>
                            <div className="pet-move-rail" />
                        </div>
                    </div>
                );
            })()}
            {/* Play-by-play broadcast line (lower-third) — narrates the swings:
                a fighter on the ropes, a reversal, an ultimate, the finish. */}
            {announce && !ended && !cutIn && !callout && !moveCallout && !finisherCue && (
                <div key={`ann-${announce.id}`} style={{ position: "absolute", left: "50%", bottom: "13%", transform: "translateX(-50%)", width: mobileQa ? "calc(100% - 24px)" : "max-content", maxWidth: "84%", boxSizing: "border-box", textAlign: "center", pointerEvents: "none", padding: mobileQa ? "7px 12px" : "7px 22px", borderRadius: mobileQa ? 18 : 999, background: "rgba(8,11,22,0.74)", border: `1px solid ${announce.tone === "reversal" ? "#f59e0b" : announce.tone === "ultimate" ? "#a855f7" : announce.tone === "ko" ? "#fcd34d" : "#ef4444"}`, boxShadow: "0 6px 22px rgba(0,0,0,0.55)", color: announce.tone === "reversal" ? "#fde68a" : announce.tone === "ultimate" ? "#e9d5ff" : announce.tone === "ko" ? "#fff7e6" : "#fecaca", font: mobileQa ? "800 14px/1.2 var(--font-display)" : "800 clamp(15px,2.6vw,24px)/1.1 var(--font-display)", letterSpacing: "0.02em", textShadow: "0 2px 8px #000", whiteSpace: mobileQa ? "normal" : "nowrap", animation: "petDuelAnnounce 2600ms ease-out forwards" }}>{announce.text}</div>
            )}

            {/* Command echo — the player's order, named the instant it is issued so a
                tap reads as a called shot. Sits above the deck on the player's side,
                clear of the centre broadcast line. */}
            {commandEcho && !ended && !cutIn && !finisherCue && (() => {
                const accent = elementColor(playerPet.element);
                const sig = commandEcho.tone === "signature";
                const plan = commandEcho.tone === "plan";
                const edge = sig ? "#fbbf24" : plan ? "rgba(148,163,184,0.7)" : accent.glow;
                return (
                    <div key={`cmd-${commandEcho.id}`} style={{
                        position: "absolute", left: mobileQa ? "50%" : "clamp(14px,4vw,54px)",
                        bottom: mobileQa ? "38%" : "26%",
                        transform: mobileQa ? "translateX(-50%)" : undefined,
                        zIndex: 13, pointerEvents: "none",
                    }}>
                        <div style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "6px 14px 6px 12px", borderRadius: 999,
                            background: "rgba(8,11,22,0.82)", border: `1.5px solid ${edge}`,
                            boxShadow: `0 6px 20px rgba(0,0,0,0.5), 0 0 16px ${edge}44`,
                            color: sig ? "#fff7e6" : plan ? "#dbeafe" : "#eaf2ff",
                            font: "900 clamp(12px,1.7vw,17px)/1 var(--font-display), Inter, system-ui, sans-serif",
                            letterSpacing: "0.03em", whiteSpace: "nowrap",
                            animation: "petDuelCmdEcho 1050ms cubic-bezier(.16,.84,.24,1) forwards",
                        }}>
                            <span aria-hidden="true" style={{ color: edge, fontSize: "1.05em", textShadow: `0 0 10px ${edge}` }}>{sig ? "★" : plan ? "◆" : "▶"}</span>
                            <span style={{ textShadow: "0 2px 8px #000" }}>{commandEcho.label}</span>
                        </div>
                    </div>
                );
            })()}

            {/* Announce the resolved read, not merely the player's selection. */}
            {clashResult && !ended && !cutIn && (
                <div
                    key={`clash-result-${clashResult.id}`}
                    role="status"
                    aria-live="assertive"
                    style={{
                        position: "absolute", left: "50%", top: mobileQa ? "29%" : "34%",
                        transform: "translate(-50%,-50%)", zIndex: 28, pointerEvents: "none",
                        width: mobileQa ? "calc(100% - 34px)" : "min(680px,82vw)",
                        padding: mobileQa ? "15px 18px" : "20px 34px",
                        textAlign: "center", boxSizing: "border-box",
                        borderTop: `2px solid ${clashResult.side === "player" ? "#5eead4" : clashResult.side === "enemy" ? "#fb7185" : "#fbbf24"}`,
                        borderBottom: `2px solid ${clashResult.side === "player" ? "#5eead4" : clashResult.side === "enemy" ? "#fb7185" : "#fbbf24"}`,
                        background: "linear-gradient(90deg,transparent,rgba(2,6,18,.94) 15%,rgba(2,6,18,.97) 85%,transparent)",
                        boxShadow: "0 16px 45px rgba(0,0,0,.68)",
                        animation: "petClashResult 1850ms cubic-bezier(.16,.84,.24,1) forwards",
                    }}
                >
                    <div style={{
                        color: clashResult.side === "player" ? "#99f6e4" : clashResult.side === "enemy" ? "#fecdd3" : "#fde68a",
                        font: `900 ${mobileQa ? 27 : 42}px/.95 var(--font-display), Inter, system-ui, sans-serif`,
                        letterSpacing: ".045em", textTransform: "uppercase",
                        textShadow: "0 3px 12px #000",
                    }}>
                        {clashResult.winner ? `${clashResult.winner} wins the Clash!` : "Clash deadlock!"}
                    </div>
                    <div style={{ marginTop: 8, color: "#e2e8f0", font: "800 11px/1 Inter, system-ui, sans-serif", letterSpacing: ".18em", textTransform: "uppercase" }}>
                        {clashResult.loser ? `${clashResult.loser} is broken open` : "Both fighters are thrown back"}
                    </div>
                </div>
            )}

            {debugAi && <DuelAiDebugHud duel={duel} clock={clock} nameById={nameById} />}

            {/* Lockstep stall — the shared watermark has caught up to playback and
                the opponent's client owes us its next progress report. Shown
                rather than swallowed: an unexplained freeze mid-fight reads as a
                crash, and this tells the player it is the connection. */}
            {waitingOnPeer && !ended && !cutIn && (
                <div data-testid="pet-duel-stall-banner" style={{
                    position: "absolute", left: "50%", top: "34%", transform: "translateX(-50%)",
                    zIndex: 15, pointerEvents: connectionLost ? "auto" : "none", textAlign: "center",
                    padding: "8px 18px", borderRadius: 999,
                    background: "rgba(8,11,22,0.82)", border: "1px solid rgba(148,163,184,0.5)",
                    color: "#cbd5e1", font: "800 13px/1.2 var(--font-display), Inter, system-ui, sans-serif",
                    letterSpacing: "0.06em", textTransform: "uppercase",
                    boxShadow: "0 6px 22px rgba(0,0,0,0.5)",
                }}>
                    {connectionLost ? (
                        <>
                            <div style={{ color: "#fde68a" }}>Connection lost — the duel can’t continue here</div>
                            {onConnectionLost && (
                                // NOT the forfeit exit: the handler asks the server for
                                // the authoritative result — which may be a win the
                                // server settled while this client was unreachable.
                                <button
                                    data-testid="pet-duel-connection-lost-exit"
                                    onClick={onConnectionLost}
                                    style={{
                                        marginTop: 8, padding: "6px 14px", borderRadius: 999, cursor: "pointer",
                                        background: "rgba(245,158,11,0.16)", border: "1px solid #f59e0b",
                                        color: "#fde68a", font: "800 12px/1.2 var(--font-display), Inter, system-ui, sans-serif",
                                        letterSpacing: "0.06em", textTransform: "uppercase",
                                    }}
                                >Fetch result &amp; leave</button>
                            )}
                        </>
                    ) : "Waiting for opponent…"}
                </div>
            )}

            {/* The player's controls. Hidden during the VS intro, a cut-in and the
                result screen so they never compete with an authored beat — and once
                the fight has SETTLED, because Replay then re-plays a decided match
                and a deck whose buttons no longer do anything is worse than none. */}
            {live && !live.settled && !ended && !cutIn && !intro && !finisherCue && (
                <PetDuelCommandDeck
                    control={deckControl}
                    petName={petDisplayName(playerPet)}
                    bond={bond}
                    accent={elementColor(playerPet.element)}
                    keyboard={!mobileQa && canHover}
                    compact={mobileQa}
                    onTechnique={(idx) => issueCommand({ kind: "technique", actorId: meId, idx }, deckControl?.abilities[idx]?.name)}
                    onBreak={() => { setBondSpentAt(Math.max(0, Math.floor(clock.current.t))); issueCommand({ kind: "break", actorId: meId }); }}
                />
            )}

            {/* CLASH — the fight is frozen and waiting on this call. Rendered above the
                deck so the read is the only thing on screen that can be answered. */}
            {clashVisible && clash && (
                <PetDuelClashPrompt
                    selfName={nameById[clash.selfId] ?? petDisplayName(playerPet)}
                    foeName={nameById[clash.foeId] ?? petDisplayName(enemyPet)}
                    pick={clashPick}
                    remaining={clashRemaining}
                    foeCommitted={clash.foeCommitted}
                    versusPlayer={versusPlayer}
                    compact={mobileQa}
                    keyboard={!mobileQa && canHover}
                    accent={elementColor(roster.find((r) => r.id === clash.selfId)?.pet.element ?? playerPet.element)}
                    onPick={answerClash}
                />
            )}

            {!ended && !cutIn && <div className="pet-duel-top-controls" style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8 }}>
                <button onClick={exitDuel} style={duelBtn}>✕ Exit</button>
                <button onClick={togglePause} style={duelBtn}>{paused ? "▶ Play" : "❚❚ Pause"}</button>
                <button onClick={toggleAudio} style={{ ...duelBtn, borderColor: audioMuted ? "#475569" : "#fbbf24", color: audioMuted ? "#cbd5e1" : "#fde68a" }} title={audioMuted ? "Turn on Colosseum music and sound" : "Mute Colosseum audio"}>
                    {audioMuted ? "🔇 Sound" : "🔊 Sound"}
                </button>
                <PetGraphicsQualityControl value={qualityId} onChange={changeQuality} compact={mobileQa} />
                {/* Replaying mid-fight would discard a live match, so the control is
                    offered only on the result screen there. */}
                {!live && <button onClick={replay} style={duelBtn}>⟲ Replay</button>}
            </div>}
            {!ended && !cutIn && <div className="pet-duel-mode-badge" style={{ position: "absolute", top: 12, right: 12, padding: "4px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(168,85,247,0.6)", borderRadius: 999, color: "#fcd34d", font: "700 11px Inter, system-ui, sans-serif" }}>⚔️ {freeRoam3d ? "3D Colosseum" : "Pet Colosseum"}</div>}

            {ended && !resultVisible && (
                <div style={{ position: "absolute", inset: 0, zIndex: 30, pointerEvents: "none", background: "radial-gradient(circle at 50% 58%,transparent 0%,rgba(3,7,18,.18) 55%,rgba(3,7,18,.62) 100%)" }}>
                    <div style={{ position: "absolute", left: "50%", top: "32%", transform: "translate(-50%,-50%)", width: "min(760px,90vw)", textAlign: "center", animation: "petWinnerHold 2100ms cubic-bezier(.16,.84,.24,1) both" }}>
                        <div style={{ color: "#fde68a", font: "900 11px/1 Inter,system-ui,sans-serif", letterSpacing: ".28em", textTransform: "uppercase", textShadow: "0 2px 8px #000" }}>The Colosseum has spoken</div>
                        <div style={{ marginTop: 8, color: duel.result === "win" ? "#bbf7d0" : duel.result === "loss" ? "#fecaca" : "#fef3c7", font: `900 ${mobileQa ? 38 : 64}px/.9 var(--font-display),Inter,system-ui,sans-serif`, textTransform: "uppercase", textShadow: "0 0 28px currentColor,0 5px 18px #000" }}>
                            {battleWinnerName ? battleWinnerName : "No victor"}
                        </div>
                        <div style={{ marginTop: 9, color: "#fff", font: "900 14px/1 Inter,system-ui,sans-serif", letterSpacing: ".2em", textTransform: "uppercase" }}>{battleWinnerName ? "Stands victorious" : "Both fighters endure"}</div>
                    </div>
                </div>
            )}

            {resultVisible && (
                <div ref={resultDialogRef} role="dialog" aria-modal="true" aria-label={`${resultLabel}: Pet Colosseum result`} tabIndex={-1} style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", overscrollBehavior: "contain", padding: "max(13px, env(safe-area-inset-top)) max(13px, env(safe-area-inset-right)) max(13px, env(safe-area-inset-bottom)) max(13px, env(safe-area-inset-left))", boxSizing: "border-box", background: "rgba(3,7,18,0.72)" }}>
                    <div style={{ width: "min(620px, 100%)", margin: "auto", padding: mobileQa ? "22px 16px" : "30px 34px", boxSizing: "border-box", textAlign: "center", border: "1px solid rgba(251,191,36,.35)", borderRadius: 22, background: "linear-gradient(180deg,rgba(8,11,22,.98),rgba(15,23,42,.96))", boxShadow: "0 24px 80px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,255,255,.08)", animation: "petBattleResult 850ms cubic-bezier(.16,.84,.24,1) both" }}>
                        <div style={{ color: "#cbd5e1", font: "900 12px/1 Inter, system-ui, sans-serif", letterSpacing: ".22em", textTransform: "uppercase", marginBottom: 8 }}>{resultLabel} · Pet Colosseum</div>
                        <div style={{ font: `900 ${mobileQa ? 42 : 58}px/.95 var(--font-display), Inter, system-ui, sans-serif`, color: resultLabel === "Victory" ? "#4ade80" : resultLabel === "Defeat" ? "#f87171" : "#facc15", textShadow: "0 0 24px currentColor, 0 4px 16px #000", textTransform: "uppercase" }}>
                            {battleWinnerName ? `${battleWinnerName} wins!` : "Draw!"}
                        </div>
                        <div style={{ color: "#e2e8f0", font: "700 13px Inter, system-ui, sans-serif", marginTop: 10 }}>
                            {duel.result === "win" ? "Your bond carried the arena." : duel.result === "loss" ? "The opposing pet claims the arena." : "Neither pet yields the arena."}
                        </div>
                        {resultSupplement}
                        {settlementStatus === "pending" && (
                            <div role="status" style={{ color: "#fde68a", font: "800 13px Inter, system-ui, sans-serif", marginTop: 12 }}>
                                {settlementCopy?.pending ?? "Sealing the Hollow Hound result…"}
                            </div>
                        )}
                        {settlementStatus === "error" && (
                            <div role="alert" style={{ marginTop: 12 }}>
                                <div style={{ color: "#fecaca", font: "800 13px Inter, system-ui, sans-serif" }}>{settlementCopy?.error ?? "Gate verification paused. Your completed duel is safe to retry."}</div>
                                <button onClick={onRetrySettlement} style={{ ...resultBtn, marginTop: 9 }}>{settlementCopy?.retry ?? "Retry Gate Settlement"}</button>
                            </div>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 18 }}>
                            {[
                                ["TIME", `${Math.floor(recap.durationSeconds / 60)}:${String(recap.durationSeconds % 60).padStart(2, "0")}`],
                                ["CLASH", `${recap.playerClashWins}–${recap.enemyClashWins}${recap.clashDeadlocks ? ` · ${recap.clashDeadlocks} tie` : ""}`],
                                ["VICTOR HP", duel.result === "draw" ? "—" : `${recap.winnerHpPercent}%`],
                            ].map(([label, value]) => (
                                <div key={label} style={{ padding: "9px 6px", borderRadius: 10, background: "rgba(2,6,23,.58)", border: "1px solid rgba(148,163,184,.18)" }}>
                                    <div style={{ color: "#64748b", font: "900 8px/1 Inter,system-ui,sans-serif", letterSpacing: ".14em" }}>{label}</div>
                                    <div style={{ color: "#f8fafc", font: "900 15px/1 Inter,system-ui,sans-serif", marginTop: 6 }}>{value}</div>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 18 }}>
                            <button onClick={replay} style={resultBtn}>⟲ Replay</button>
                            {onFightAgain && <button onClick={onFightAgain} style={resultBtn}>⚔ Fight again</button>}
                            <button
                                onClick={exitDuel}
                                disabled={!!settlementStatus && settlementStatus !== "settled"}
                                style={{ ...resultBtn, background: "#334155", opacity: settlementStatus && settlementStatus !== "settled" ? 0.55 : 1 }}
                            >
                                {settlementStatus === "settled" ? (settlementCopy?.settledExit ?? "Return to Gate") : "Exit"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div style={{ position: "absolute", bottom: 12, right: 14, color: "#64748b", font: "600 11px Inter, system-ui, sans-serif" }}>Pet Colosseum</div>
        </div>
    ), document.body);
}
