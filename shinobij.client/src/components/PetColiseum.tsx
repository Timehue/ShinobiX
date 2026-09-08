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


import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "../styles/pet-skin.css";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Html, PerformanceMonitor, Sparkles } from "@react-three/drei";
import type { Pet } from "../types/pet";
import { PetBattleAvatar } from "./PetBattleAvatar";
import { elementVfxKey } from "../lib/pet-battle-anim";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { type MoveChoreoKind } from "../lib/pet-coliseum-scene";
import { runPetDuel, runPetPartyDuel, DUEL_TPS, type DuelResult } from "../lib/pet-duel-sim";
import { petVisualId } from "../data/pet-evolutions";
import { playPetSfx, primePetSfx } from "../lib/pet-sfx";
import { duckBattleMusic, isAudioMuted, setAudioMuted, setBattleMusicIntensity, startBattleMusic, stopBattleMusic, subscribeAudioMute } from "../lib/pet-music";
import { petCloseupPresentationModel, petCombatModel, type PetCombatModelProfile } from "../lib/pet-3d-models";
import { directPetDuelPresentation } from "../lib/pet-duel-stage-director";
import { commandedActorId } from "../lib/pet-duel-live";
import type { LiveDuel, DuelCommand } from "../lib/pet-duel-live";
import { bondCharge } from "../lib/pet-bond-meter";
import { PetDuelCommandDeck } from "./PetDuelCommandDeck";
import { PetDuelClashPrompt } from "./PetDuelClashPrompt";
import { PET_OPENING_TACTICS, appendCapped } from "../lib/pet-duel-presentation";
import { PET_VISUAL_QUALITY_PRESETS, petVisualQuality, savePetVisualQuality, type PetVisualQuality } from "../lib/pet-visual-quality";
import { PetRenderStatsProbe } from "./PetRenderStatsProbe";
import { PetGraphicsQualityControl } from "./PetGraphicsQualityControl";
import { petHeroMoveStyle, type PetHeroMoveStyle } from "../lib/pet-hero-moves";
import { petDuelModelCalibration } from "../lib/pet-duel-model-presentation";
import { resolvePetDuelVisualLayers } from "../lib/pet-duel-visual-layers";
import { petCombatFamilyPresentation } from "../lib/pet-combat-family";
import { petDisplayName } from "../lib/pet";
import { petDuelBroadcastRead, petDuelRecap } from "../lib/pet-duel-broadcast";
import { petColiseumWeatherDurationTicks, type PetColiseumWeather } from "../lib/pet-coliseum-weather";
import { type DuelClock, TARGET_SPRITE_H, FLOOR_Y, FX_Y, type Vec3, CAM_LOOK, CAM_POS, type PetBattleSettlementStatus, COLISEUM_FLOOR_URL, COLISEUM_BG_URL, CAM_FOV, duelBtn, resultBtn } from "./pet-coliseum/stage";
import { elementColor, loadSceneTexture, posedId, poseUrl } from "./pet-coliseum/sprite-resources";
import { duelCmdFocus, duelCmdRush, requestDuelCommandFocus, requestDuelCommandJolt, requestDuelCommandRush } from "./pet-coliseum/playback-state";
import { ResponsiveCamera, FxAnim, BloomFx } from "./pet-coliseum/stage-components";
import { Arena, DustPuff } from "./pet-coliseum/frame-battle";
import { hollowHoundSurface, duelElementBurstKind, type DuelImpactMode, type DuelElementBurstKind, type DuelSupportKind, type DuelAttackWeight, type DuelDashCue, type DuelPressureCue, type DuelSetPieceKind, type DuelWeatherCue, type DuelMoveCalloutTone, INTRO_SPLASH_END, INTRO_TOTAL, duelFieldToFloor, duelSetPieceKind, INTRO_PAUSE_END, findActor, MOVE_CALLOUT_STYLE } from "./pet-coliseum/duel-stage";
import { scheduleDuelFxGeometryPrewarm } from "./pet-coliseum/duel-resources";
import { DuelBattlefieldWeather } from "./pet-coliseum/duel-weather";
import { DuelStandee, DuelCutInModelPortrait } from "./pet-coliseum/duel-actors";
import { DuelCommandFocusMarker, DuelProjectile } from "./pet-coliseum/duel-projectiles";
import { DuelImpact, DuelElementVolume, DuelSupportEffect, DuelShockwaveV2, DuelElementDecal, DuelPowerUpAura, DuelMeleeTrail } from "./pet-coliseum/duel-element-effects";
import { DuelDashEffectV2, DuelPressureClashV2 } from "./pet-coliseum/duel-dash-effects";
import { DuelSignatureSetPiece } from "./pet-coliseum/duel-set-pieces";
import { DuelDirector, DuelAiDebugHud } from "./pet-coliseum/duel-director";
export type { PetBattleSettlementStatus } from "./pet-coliseum/stage";
export type { PetColiseumProps } from "./pet-coliseum/frame-battle";
export { PetColiseum } from "./pet-coliseum/frame-battle";
export type { PetArenaMatchProps } from "./pet-coliseum/arena-match";
export { PetArenaMatch } from "./pet-coliseum/arena-match";


/** Real seconds a player gets to call a CLASH before their pet answers on instinct.
 *  Independent of the sim's own bind window: playback is frozen while the prompt is
 *  up, so this is a human-comfort budget, not a simulation deadline. */
const CLASH_ANSWER_SECONDS = 3.5;



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
