// Extracted from PetColiseum; presentation behavior and resource lifetimes are unchanged.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { lerp, classifyMoveChoreo, moveFxKey, type MoveChoreoKind } from "../../lib/pet-coliseum-scene";
import { DUEL_TPS, type DuelResult } from "../../lib/pet-duel-sim";
import { playPetSfx } from "../../lib/pet-sfx";
import { type PetCombatModelProfile } from "../../lib/pet-3d-models";
import { PARTY_SPOTLIGHT_COOLDOWN_SECONDS, PET_DUEL_COMMAND_CATCHUP_SCALE, PET_DUEL_COMMAND_CATCHUP_SECONDS, PET_DUEL_NEUTRAL_PLAYBACK_SCALE, duelAttackDashBeats, duelFinisherOutcome, duelHeroCutEligible, duelHeroCutEventIndexes, duelMoveOutcome, petDuelContactTiming, precedingNamedMove, selectDuelSpotlightEvent } from "../../lib/pet-duel-presentation";
import { petHeroMoveStyle, type PetHeroMoveStyle } from "../../lib/pet-hero-moves";
import { duelCameraComposition } from "../../lib/pet-duel-camera";
import { petColiseumWeatherForMove, type PetColiseumWeather } from "../../lib/pet-coliseum-weather";
import { type DuelClock, CAM_LOOK, CAM_POS } from "./stage";
import { elementColor } from "./sprite-resources";
import { duelCmdFocus, duelCmdRush, duelFovKick, duelCmdKick } from "./playback-state";
import { type DuelImpactMode, type DuelSupportKind, type DuelAttackWeight, type DuelMoveCalloutTone, findActor, duelFieldToFloor, arenaScaleMove, duelSetPieceKind, duelSetPieceTiming, DUEL_FLOOR_Z0, DUEL_LOOK_Y, INTRO_TOTAL, INTRO_WIDE_DOLLY, introWideHold, DUEL_CAMERA_Y } from "./duel-stage";



export function DuelDirector({ duel, clock, advanceClock, onEnd, canEnd = true, spawnNumber, spawnImpact, spawnElementBurst, spawnAftermath, spawnFx, spawnSupport, spawnShock, spawnDust, spawnScorch, spawnPowerUp, spawnTrail, spawnDash, spawnPressure, spawnSetPiece, elementById, nameById, speciesNameById, petIdById, profileById, ultById, heroMoveById, onCutIn, onFlash, onCallout, onCombo, onAnnounce, onMoveCallout, onWeather, onClashResult, onFinisher }: {
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



export function DuelAiDebugHud({ duel, clock, nameById }: { duel: DuelResult; clock: { current: DuelClock }; nameById: Record<string, string> }) {
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
