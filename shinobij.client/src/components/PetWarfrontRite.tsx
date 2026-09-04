/*
 * Beastbound Warfront — the Rite.
 *
 * FOUR PETS PER BAND, all active, best of three formation clashes. You assign
 * ten open cells on your half; every pet can use every cell. Combat is resolved
 * on a deterministic grid with hard occupancy, cover and line of sight.
 *
 * Kills are the scoreboard: pets standing decides the clash, clashes decide the
 * match. That is the one thing the two lane-war versions never were, and the
 * reason they were boring to watch — `wfVerdictScore` counted only towers, so
 * every takedown on screen was worth zero.
 *
 * Rendering rules inherited from the post-mortem:
 *   - React NEVER re-renders per tick. The playback clock is a ref; the HUD
 *     mutates DOM directly from one rAF loop; the 3D stage reads the same ref
 *     inside useFrame. The old mode re-rendered a 1,100-line component 30x a
 *     second and it cost frame pacing.
 *   - Playback speed EASES. The old director snapped world speed by 2.3x on
 *     every kill with no easing, which reads as a bug rather than a flourish.
 */
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    type TransitionEvent as ReactTransitionEvent,
} from "react";
import type { Pet } from "../types/pet";
import type { ArenaSlot } from "../lib/pet-arena-sim";
import { DUEL_TPS } from "../lib/pet-duel-sim";
import {
    RITE_BAND_SIZE,
    RITE_CLASHES_TO_WIN,
    RITE_MAX_CLASHES,
    RITE_SCOUTED_JOBS,
    WARFRONT_DEFAULT_DEPLOYMENT,
    WARFRONT_DEPLOYMENT_NODES,
    aiRitePlan,
    deterministicRiteCounterMove,
    riteBandProblem,
    runWarfrontRite,
    tryMoveRitePet,
    type RiteClash,
    type RiteCombatant,
    type RitePlan,
    type RiteResult,
} from "../lib/pet-warfront-rite";
import { petBattleSprite, petCardImage } from "../lib/pet-battle-anim";
import { PET_VISUAL_QUALITY_PRESETS, petVisualQuality } from "../lib/pet-visual-quality";
import { playPetSfx, primePetSfx } from "../lib/pet-sfx";
import { startBattleMusic, stopBattleMusic } from "../lib/pet-music";
import { buildWarfrontAudioPlan } from "../lib/pet-warfront-spectacle";
import {
    advanceRitePlaybackTick,
    boundedRitePlaybackDelta,
    startRitePlaybackPulses,
} from "../lib/pet-rite-playback";
import { createActorPoseSample, RITE_REVEAL_FIGHTER_COUNT, riteTacticalReport, sampleActorInto } from "../lib/pet-warfront-rite-presentation";
import { PetWarfrontRiteStage, preloadRitePetModels, type StageFighter } from "./PetWarfrontRiteStage";
import "../styles/pet-warfront-rite.css";

const ELEMENT_COLOR: Readonly<Record<string, string>> = {
    Fire: "#ff7a45", Water: "#4cc2ff", Wind: "#6ff0c8",
    Lightning: "#ffe066", Earth: "#d9a566", None: "#c9d6de",
};
const elColor = (element: string | null | undefined) => ELEMENT_COLOR[String(element ?? "None")] ?? ELEMENT_COLOR.None;

/** The handoff between clashes, beat by beat. A budget, not a guideline: three
 *  slack transitions turn a 2.5-minute match into loading screens. */
const FORMATION_HOLD_MS = 1350;
const INTERLUDE_MS = 4200;

type Phase = "deploy" | "clash" | "interlude" | "result";

/** The line a band takes when nobody chose one — roster order. */
const defaultRitePlan = (): RitePlan => ({
    formation: Array.from({ length: RITE_BAND_SIZE }, (_, i) => i),
    deployment: [...WARFRONT_DEFAULT_DEPLOYMENT],
    reformAfterClash: null,
    reform: null,
    reformDeployment: null,
    reforms: [],
});

export type PetWarfrontRiteProps = {
    blue: ArenaSlot[];
    red: ArenaSlot[];
    seed: number;
    sharedImages?: Record<string, string>;
    onResult?: (result: RiteResult, plan: RitePlan) => void;
    onExit: () => void;
    resultSupplement?: ReactNode;
    resultActionsLocked?: boolean;
    settlementPending?: boolean;
    /**
     * SHARED REPLAY (co-op). Every client must render the identical match, so a
     * spectator takes no decisions at all: no deployment panel, no re-form, and
     * no settlement. The Rite becomes a pure function of {blue, red, seed} —
     * the same determinism contract the retired co-op renderer relied on.
     */
    spectator?: boolean;
    /**
     * DEV-HARNESS SCRUB ONLY. Multiplies playback speed so a QA run does not have
     * to sit through a real clash; the simulation is already resolved, so this
     * changes nothing about the outcome. Live callers omit it.
     */
    playbackRate?: number;
};

// ── Small presentational pieces ─────────────────────────────────────────────

function PetPortrait({ pet, sharedImages, size = 56, placementArt = false }: {
    pet: Pet;
    sharedImages: Record<string, string>;
    size?: number;
    placementArt?: boolean;
}) {
    const source = useMemo(
        () => placementArt ? petCardImage(pet, sharedImages) : petBattleSprite(pet, sharedImages).src,
        [pet, placementArt, sharedImages],
    );
    const [failedSource, setFailedSource] = useState<string | null>(null);
    const visibleSource = source && source !== failedSource ? source : "";
    const needsContrastRim = pet.element === "Wind" || pet.element === "Earth";
    return (
        <span
            className={`wfr-portrait${placementArt ? " is-placement-art" : ""}${needsContrastRim ? " has-neutral-rim" : ""}`}
            data-wfr-portrait-kind={visibleSource ? "image" : "fallback"}
            data-wfr-pet-id={pet.id}
            style={{ width: size, height: size, borderColor: `${elColor(pet.element)}88` }}
        >
            {visibleSource
                ? <img src={visibleSource} alt="" aria-hidden="true" draggable={false} loading={placementArt ? "eager" : "lazy"} decoding="async" onError={() => setFailedSource(visibleSource)} />
                : <span className="wfr-portrait-glyph" style={{ color: elColor(pet.element) }}>{pet.name.slice(0, 1)}</span>}
        </span>
    );
}

/** Health carried into a clash, drawn as a partial bar. A pet that returns at
 *  45% must LOOK like it returns at 45% before the fighting starts. */
function EntryPip({ hp }: { hp: number }) {
    const pct = Math.round(hp * 100);
    const tone = hp > 0.6 ? "#5fdc93" : hp > 0.3 ? "#ffd166" : "#ff6b6b";
    return (
        <span className="wfr-pip" title={`${pct}% health`}>
            <span className="wfr-pip-fill" style={{ width: `${Math.max(4, pct)}%`, background: tone }} />
        </span>
    );
}

// ── Deploy ──────────────────────────────────────────────────────────────────

const DEPLOYMENT_DISPLAY_ORDER = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const deploymentLabel = (nodeId: number): string => {
    const node = WARFRONT_DEPLOYMENT_NODES[nodeId];
    if (!node) return "Unplaced";
    const file = node[1] <= -5 ? "North edge" : node[1] < -1 ? "North" : node[1] > 5 ? "South edge" : node[1] > 1 ? "South" : "Center";
    const depth = node[0] > 8 ? "rear" : "forward";
    return `${file} ${depth}`;
};

function PlacementBoard({ band, deployment, onChange, sharedImages, healthBySlot }: {
    band: Pet[];
    deployment: number[];
    onChange: (next: number[]) => void;
    sharedImages: Record<string, string>;
    healthBySlot?: Map<number, number>;
}) {
    const [selectedSlot, setSelectedSlot] = useState(0);
    const [draggingSlot, setDraggingSlot] = useState<number | null>(null);
    const [dragOverNode, setDragOverNode] = useState<number | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const shellRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{
        pointerId: number;
        slot: number;
        startX: number;
        startY: number;
        lastX: number;
        lastY: number;
        active: boolean;
    } | null>(null);
    const suppressClickRef = useRef(false);
    const occupied = useMemo(
        () => new Map(deployment.map((node, slot) => [node, slot] as const)),
        [deployment],
    );
    const move = useCallback((slot: number, nodeId: number) => {
        if (occupied.has(nodeId)) return false;
        const next = tryMoveRitePet(deployment, slot, nodeId, band.length);
        if (!next) return false;
        onChange(next);
        setSelectedSlot(slot);
        setAnnouncement(`${band[slot]?.name ?? "Pet"} moved to ${deploymentLabel(nodeId)}.`);
        return true;
    }, [band, deployment, occupied, onChange]);
    const place = (nodeId: number) => {
        const otherSlot = occupied.get(nodeId);
        // Occupied cells select their owner; only a clearly open cell performs
        // a move. This keeps one tap equal to one pet move and prevents a second
        // pet being silently displaced.
        if (otherSlot !== undefined) { setSelectedSlot(otherSlot); return; }
        move(selectedSlot, nodeId);
    };
    const openNodeAt = useCallback((clientX: number, clientY: number): number | null => {
        const hit = document.elementFromPoint(clientX, clientY);
        const cell = hit?.closest<HTMLElement>("[data-wfr-node-id]");
        if (!cell || !shellRef.current?.contains(cell)) return null;
        const nodeId = Number(cell.dataset.wfrNodeId);
        return Number.isInteger(nodeId) && !occupied.has(nodeId) ? nodeId : null;
    }, [occupied]);
    const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, slot: number) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        setSelectedSlot(slot);
        dragRef.current = {
            pointerId: event.pointerId,
            slot,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            active: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const updateDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 8) {
            drag.active = true;
            setDraggingSlot(drag.slot);
        }
        if (!drag.active) return;
        event.preventDefault();
        setDragOverNode(openNodeAt(event.clientX, event.clientY));
    };
    const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.active) {
            event.preventDefault();
            // Chromium reports (0, 0) for a synthetic touchEnd because that
            // event has no active touch point. The last touchMove is the true
            // drop coordinate for both device and release-harness gestures.
            const nodeId = openNodeAt(drag.lastX, drag.lastY);
            if (nodeId !== null) move(drag.slot, nodeId);
            suppressClickRef.current = true;
            window.setTimeout(() => { suppressClickRef.current = false; }, 0);
        }
        dragRef.current = null;
        setDraggingSlot(null);
        setDragOverNode(null);
    };
    const cancelDrag = () => {
        const drag = dragRef.current;
        // Mobile Chromium may end a captured touch stream with pointercancel
        // (for example after a compositor handoff). If the last sampled point
        // is still a legal highlighted cell, honour the player's clear drop
        // instead of creating a touch-only dead zone.
        if (drag?.active) {
            const nodeId = openNodeAt(drag.lastX, drag.lastY);
            if (nodeId !== null) move(drag.slot, nodeId);
        }
        dragRef.current = null;
        setDraggingSlot(null);
        setDragOverNode(null);
    };

    return (
        <div
            ref={shellRef}
            className={`wfr-placement-shell${draggingSlot !== null ? " is-dragging" : ""}`}
            onPointerMove={updateDrag}
            onPointerUp={finishDrag}
            onPointerCancel={cancelDrag}
        >
            <div className="wfr-pet-picker" aria-label="Choose a pet to place">
                {band.map((pet, slot) => (
                    <button
                        key={pet.id}
                        type="button"
                        className={`${slot === selectedSlot ? "is-selected" : ""} ${slot === draggingSlot ? "is-dragging" : ""}`.trim() || undefined}
                        aria-pressed={slot === selectedSlot}
                        data-wfr-drag-slot={slot}
                        draggable={false}
                        onPointerDown={(event) => beginDrag(event, slot)}
                        onClick={(event) => {
                            if (suppressClickRef.current) { event.preventDefault(); return; }
                            setSelectedSlot(slot);
                        }}
                    >
                        <PetPortrait pet={pet} sharedImages={sharedImages} size={42} placementArt />
                        <span><strong>{pet.name}</strong><small>{deploymentLabel(deployment[slot])}</small></span>
                        {healthBySlot ? <EntryPip hp={healthBySlot.get(slot) ?? 0} /> : null}
                    </button>
                ))}
            </div>

            <div className="wfr-placement-board" aria-label="Your deployment grid">
                <div className="wfr-depth-labels" aria-hidden="true">
                    <span>Rear guard</span><span>Forward line</span>
                </div>
                <div className="wfr-placement-grid">
                    {DEPLOYMENT_DISPLAY_ORDER.map((nodeId) => {
                        const slot = occupied.get(nodeId);
                        const pet = slot === undefined ? null : band[slot];
                        const selected = slot === selectedSlot;
                        return (
                            <button
                                key={nodeId}
                                type="button"
                                className={`${pet ? "is-occupied" : ""} ${selected ? "is-selected" : ""} ${dragOverNode === nodeId ? "is-drag-over" : ""}`.trim()}
                                aria-label={pet
                                    ? `${deploymentLabel(nodeId)} occupied by ${pet.name}${selected ? ", selected" : ", tap to select"}`
                                    : `Place ${band[selectedSlot]?.name ?? "selected pet"} at ${deploymentLabel(nodeId)}`}
                                data-wfr-node-id={nodeId}
                                data-wfr-legal-drop={pet ? "false" : "true"}
                                draggable={false}
                                onPointerDown={pet && slot !== undefined ? (event) => beginDrag(event, slot) : undefined}
                                onClick={(event) => {
                                    if (suppressClickRef.current) { event.preventDefault(); return; }
                                    place(nodeId);
                                }}
                            >
                                {pet ? <PetPortrait pet={pet} sharedImages={sharedImages} size={38} placementArt /> : <span className="wfr-empty-node" />}
                            </button>
                        );
                    })}
                </div>
                <div className="wfr-route-labels" aria-hidden="true"><span>North edge</span><span>North</span><span>Center</span><span>South</span><span>South edge</span></div>
            </div>
            <output className="wfr-placement-status" aria-live="polite">{announcement}</output>
        </div>
    );
}

function DeployPanel({ band, enemyBand, enemyPlan, sharedImages, onBegin, onExit }: {
    band: Pet[];
    enemyBand: Pet[];
    enemyPlan: RitePlan;
    sharedImages: Record<string, string>;
    onBegin: (plan: RitePlan) => void;
    onExit: () => void;
}) {
    const [deployment, setDeployment] = useState<number[]>(() => [...WARFRONT_DEFAULT_DEPLOYMENT]);
    const [formation, setFormation] = useState<number[]>(() => Array.from({ length: RITE_BAND_SIZE }, (_, index) => index));
    const [landscapeInspectAcknowledged, setLandscapeInspectAcknowledged] = useState(false);
    const [landscapeDrawer, setLandscapeDrawer] = useState<"guide" | "scout" | null>(null);
    const problem = useMemo(() => riteBandProblem(band), [band]);
    const toggleLandscapeDrawer = (drawer: "guide" | "scout") => {
        setLandscapeDrawer((current) => current === drawer ? null : drawer);
    };

    return (
        <div
            className={`wfr-deploy${landscapeInspectAcknowledged ? " is-landscape-compact" : ""}`}
            data-landscape-inspect-state={landscapeInspectAcknowledged ? "acknowledged" : "pending"}
            data-landscape-open-drawer={landscapeDrawer ?? "none"}
        >
            <button
                type="button"
                className="wfr-landscape-drawer-trigger is-guide"
                aria-label={`${landscapeDrawer === "guide" ? "Close" : "Open"} deployment guide`}
                aria-controls="wfr-deploy-guide"
                aria-expanded={landscapeDrawer === "guide"}
                onClick={() => toggleLandscapeDrawer("guide")}
            >
                <span aria-hidden="true">?</span>
                <span>Guide</span>
            </button>

            <div
                id="wfr-deploy-guide"
                className={`wfr-guide-drawer${landscapeDrawer === "guide" ? " is-open" : ""}`}
                aria-hidden={landscapeInspectAcknowledged ? landscapeDrawer !== "guide" : undefined}
            >
                <header className="wfr-deploy-head">
                    <p className="wfr-eyebrow">Beastbound Warfront</p>
                    <h2>Set your formation</h2>
                    <p className="wfr-deploy-copy">
                        <strong>Starting cells decide first contact.</strong> Forward brings pressure sooner; rear protects range and support; split files blunt area hits. Every open cell is legal. First to {RITE_CLASHES_TO_WIN} clashes wins.
                    </p>
                </header>

                <ol className="wfr-onboarding" aria-label="Deployment steps">
                    <li><span>1</span><span><strong>Inspect matchup</strong><small>Read their two revealed starts.</small></span></li>
                    <li className="is-current"><span>2</span><span><strong>Drag or tap any pet</strong><small>Drop it on any glowing open cell.</small></span></li>
                    <li><span>3</span><span><strong>Lock formation</strong><small>The clash proves your read.</small></span></li>
                </ol>
            </div>

            <section
                id="wfr-deploy-scout"
                className={`wfr-scout${landscapeDrawer === "scout" ? " is-open" : ""}`}
                aria-label="Enemy revealed deployment"
                aria-hidden={landscapeInspectAcknowledged ? landscapeDrawer !== "scout" : undefined}
            >
                <h3>Inspect matchup <span>2 starts revealed</span></h3>
                <div className="wfr-scout-body">
                    {enemyPlan.formation.slice(0, RITE_SCOUTED_JOBS).map((slot) => {
                        const pet = enemyBand[slot];
                        if (!pet) return null;
                        return (
                            <span key={pet.id} className="wfr-scout-pet">
                                <PetPortrait pet={pet} sharedImages={sharedImages} size={42} placementArt />
                                <span className="wfr-scout-meta">
                                    <strong>{pet.name}</strong>
                                    <small className="wfr-scout-job">{deploymentLabel(enemyPlan.deployment?.[slot] ?? -1)}</small>
                                    <small className="wfr-el" style={{ color: elColor(pet.element) }}>{pet.element ?? "None"}</small>
                                </span>
                            </span>
                        );
                    })}
                </div>
                <p className="wfr-scout-note">Two starts are public; two stay sealed until combat.</p>
                <button
                    type="button"
                    className="wfr-inspect-ack"
                    aria-label="Acknowledge matchup and position your band"
                    onClick={() => {
                        setLandscapeInspectAcknowledged(true);
                        setLandscapeDrawer(null);
                    }}
                >
                    <span>Matchup read</span>
                    <strong>Position band</strong>
                </button>
            </section>

            <button
                type="button"
                className="wfr-landscape-drawer-trigger is-scout"
                aria-label={`${landscapeDrawer === "scout" ? "Close" : "Open"} matchup scout`}
                aria-controls="wfr-deploy-scout"
                aria-expanded={landscapeDrawer === "scout"}
                onClick={() => toggleLandscapeDrawer("scout")}
            >
                <span aria-hidden="true">◎</span>
                <span>Scout</span>
            </button>

            <PlacementBoard band={band} deployment={deployment} onChange={setDeployment} sharedImages={sharedImages} />

            {problem ? <p className="wfr-problem" role="alert">{problem}</p> : null}

            <div className="wfr-deploy-actions">
                <button type="button" className="wfr-btn-ghost" onClick={onExit}>Withdraw</button>
                <button
                    type="button"
                    className="wfr-btn-primary"
                    disabled={Boolean(problem)}
                    onClick={() => onBegin({
                        formation,
                        deployment,
                        reformAfterClash: null,
                        reform: null,
                        reformDeployment: null,
                        reforms: [],
                    })}
                >
                    Lock formation
                </button>
            </div>
        </div>
    );
}

// ── Live HUD ────────────────────────────────────────────────────────────────

/**
 * Eight active health bars and the clock, driven by ONE rAF that writes straight to the
 * DOM. Putting these in React state would re-render the whole match tree 30+
 * times a second, which is the mistake that cost the lane war its frame pacing.
 */
function ClashHud({ clash, blueBand, redBand, clockRef, sharedImages, rounds, audioArmed, audioDispatches, onArmAudio }: {
    clash: RiteClash;
    blueBand: Pet[];
    redBand: Pet[];
    clockRef: { current: number };
    sharedImages: Record<string, string>;
    rounds: { blue: number; red: number };
    audioArmed: boolean;
    audioDispatches: { current: number };
    onArmAudio: () => void;
}) {
    const bars = useRef<Record<string, HTMLSpanElement | null>>({});
    const clockOut = useRef<HTMLOutputElement>(null);
    const audioProbe = useRef<HTMLButtonElement>(null);
    const poseSlots = useMemo(() => Array.from({ length: 8 }, createActorPoseSample), []);

    useEffect(() => {
        let raf = 0;
        const snaps = clash.result.snapshots;
        const paint = () => {
            const t = Math.max(0, Math.min(snaps.length - 1, clockRef.current));
            let poseIndex = 0;
            for (const [team, side] of [["player", clash.blue], ["enemy", clash.red]] as const) {
                for (const combatant of side) {
                    const actor = sampleActorInto(clash.result, team, combatant.lane, t, poseSlots[poseIndex++]);
                    const frac = Math.max(0, actor.maxHp > 0 ? actor.hp / actor.maxHp : 0) * combatant.entryHp;
                    const bar = bars.current[`${team}-${combatant.lane}`];
                    if (bar) {
                        bar.style.width = `${(frac * 100).toFixed(1)}%`;
                        bar.style.background = frac > 0.5 ? "" : frac > 0.2 ? "#ffd166" : "#ff5470";
                    }
                }
            }
            // The playback clock, surfaced for tests. A frozen tick is the single
            // clearest symptom of the mode breaking, and it is otherwise
            // invisible because everything it drives is painted imperatively.
            if (clockOut.current) clockOut.current.dataset.tick = t.toFixed(2);
            if (audioProbe.current) audioProbe.current.dataset.riteAudioEvents = String(audioDispatches.current);
            raf = requestAnimationFrame(paint);
        };
        raf = requestAnimationFrame(paint);
        return () => cancelAnimationFrame(raf);
    }, [audioDispatches, clash, clockRef, poseSlots]);

    const row = (side: RiteCombatant[], band: Pet[], team: "player" | "enemy", label: string) => (
        <ul className={`wfr-roster is-${team === "player" ? "blue" : "red"}`} aria-label={label}>
            {side.map((c) => {
                const pet = band[c.slot];
                if (!pet) return null;
                const position = deploymentLabel(c.node);
                return (
                    <li key={`${team}-${c.lane}`} title={`Deployed ${position}`}>
                        <span className="wfr-roster-job" aria-label={position}>{position.slice(0, 1)}</span>
                        <PetPortrait pet={pet} sharedImages={sharedImages} size={34} />
                        <span className="wfr-roster-meta">
                            <strong>{pet.name}</strong>
                            <span className="wfr-bar">
                                <span
                                    ref={(node) => { bars.current[`${team}-${c.lane}`] = node; }}
                                    className={`wfr-bar-fill is-${team === "player" ? "blue" : "red"}`}
                                    style={{ width: `${c.entryHp * 100}%` }}
                                />
                            </span>
                        </span>
                    </li>
                );
            })}
        </ul>
    );

    return (
        <div className="wfr-hud" data-testid="wfr-premium-hud" data-audio-armed={audioArmed ? "true" : "false"}>
            <output ref={clockOut} data-testid="wfr-clock" data-tick="0" hidden />
            {row(clash.blue, blueBand, "player", "Your band")}
            <div className="wfr-hud-center">
                <span className="wfr-duel-no">BEASTBOUND · CLASH {clash.index + 1}</span>
                <span className="wfr-rounds" aria-label="Clashes won">
                    <b>{rounds.blue}</b><i>—</i><b>{rounds.red}</b>
                </span>
                <span className="wfr-rule-state" aria-label="Formation combat rules">
                    <strong>FORMATION LIVE · 28s VERDICT</strong>
                </span>
            </div>
            {row(clash.red, redBand, "enemy", "Their band")}
            <button
                ref={audioProbe}
                type="button"
                className={`wfr-sound-gate${audioArmed ? " is-armed" : ""}`}
                data-testid="wfr-audio-gate"
                data-rite-audio-events="0"
                data-rite-audio-overlap-cap="1"
                onClick={onArmAudio}
                aria-label={audioArmed ? "Combat sound armed" : "Enable combat sound"}
                title={audioArmed ? "Combat sound armed" : "Tap to enable combat sound"}
            >{audioArmed ? "SOUND ON" : "TAP FOR SOUND"}</button>
        </div>
    );
}

// ── Interlude ───────────────────────────────────────────────────────────────

function Interlude({ clash, blueBand, redBand, sharedImages }: {
    clash: RiteClash;
    blueBand: Pet[];
    redBand: Pet[];
    sharedImages: Record<string, string>;
}) {
    const fallen = [
        ...clash.blue.filter((c) => c.exitHp <= 0).map((c) => blueBand[c.slot]),
        ...clash.red.filter((c) => c.exitHp <= 0).map((c) => redBand[c.slot]),
    ].filter(Boolean);
    // Final-clash survivors and their exact exit health.
    const survivors = clash.blue
        .filter((c) => c.exitHp > 0)
        .map((c) => ({ pet: blueBand[c.slot], hp: c.exitHp }))
        .filter((entry) => Boolean(entry.pet));
    const won = clash.winner === "blue";
    const report = riteTacticalReport(clash);
    const firstKo = report.firstKo
        ? (report.firstKo.team === "player" ? blueBand : redBand)[report.firstKo.slot]
        : null;
    return (
        <div className="wfr-interlude">
            <div className="wfr-interlude-victor">
                <p className="wfr-eyebrow">Clash {clash.index + 1}</p>
                <h3 className={won ? "is-win" : clash.winner === "red" ? "is-loss" : undefined}>
                    {clash.winner === null ? "The formation holds" : won ? "Their formation broke" : "Your formation broke"}
                </h3>
                <p>{clash.blueStanding} standing · {clash.redStanding} of theirs</p>
                <div className="wfr-interlude-edge">
                    <span>Authoritative result</span>
                    <strong>{won ? "Your band won the final clash" : clash.winner === "red" ? "Their band won the final clash" : "The final clash was drawn"}</strong>
                    <p>{firstKo ? `First KO: ${firstKo.name} at tick ${report.firstKo?.tick}` : "No knockout was recorded before the verdict."}</p>
                </div>
            </div>
            {fallen.length ? (
                <div className="wfr-interlude-ko">
                    <span className="wfr-next-label">Fallen in final clash</span>
                    <div className="wfr-next-pair">
                        {fallen.slice(0, 6).map((pet, i) => (
                            <span key={`${pet.id}-${i}`}><PetPortrait pet={pet} sharedImages={sharedImages} size={44} /></span>
                        ))}
                    </div>
                </div>
            ) : null}
            {survivors.length ? (
                <div className="wfr-interlude-next">
                    <span className="wfr-next-label">Your band · final health</span>
                    {survivors.map((entry) => (
                        <span key={entry.pet.id} className="wfr-survivor">
                            <PetPortrait pet={entry.pet} sharedImages={sharedImages} size={34} />
                            <EntryPip hp={entry.hp} />
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/** The evidence → re-form → explicit rematch decision after every non-terminal
 * clash. Facts come straight from the clash transcript and the panel makes no
 * forecast; the next authoritative clash is still the only outcome authority. */
function ReformPanel({ clash, band, enemyBand, formation, deployment, sharedImages, automatic = false, onCommit }: {
    clash: RiteClash;
    band: Pet[];
    enemyBand: Pet[];
    formation: number[];
    deployment: number[];
    sharedImages: Record<string, string>;
    automatic?: boolean;
    onCommit: (next: { formation: number[]; deployment: number[] }) => void;
}) {
    const [next, setNext] = useState<number[]>(() => [...deployment]);
    const [reportAcknowledged, setReportAcknowledged] = useState(false);
    const [reportOpen, setReportOpen] = useState(true);
    const panelRef = useRef<HTMLDivElement>(null);
    const reportTriggerRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!automatic) panelRef.current?.focus();
    }, [automatic]);
    const changed = next.some((node, i) => node !== deployment[i]);
    const changes = band.flatMap((pet, slot) => next[slot] === deployment[slot] ? [] : [{
        pet,
        from: deploymentLabel(deployment[slot]),
        to: deploymentLabel(next[slot]),
    }]);
    const healthBySlot = useMemo(
        () => new Map(band.map((_, slot) => [slot, clash.blue.find((c) => c.slot === slot)?.exitHp ?? (slot === clash.blueReserveSlot ? 1 : 0)])),
        [band, clash.blue, clash.blueReserveSlot],
    );
    const report = useMemo(() => riteTacticalReport(clash), [clash]);
    const firstKoPet = report.firstKo
        ? (report.firstKo.team === "player" ? band : enemyBand)[report.firstKo.slot]
        : null;
    const threatPet = report.highestDamageThreat ? enemyBand[report.highestDamageThreat.slot] : null;
    const winnerLabel = report.winner === "player" ? "Your band" : report.winner === "enemy" ? "Their band" : "Draw";
    const reportId = `wfr-reform-report-${clash.index}`;
    const closeInitialReport = () => {
        setReportAcknowledged(true);
        setReportOpen(false);
        window.requestAnimationFrame(() => reportTriggerRef.current?.focus());
    };

    return (
        <div
            ref={panelRef}
            className={`wfr-reform${reportAcknowledged ? " is-report-acknowledged" : ""}`}
            role={automatic ? "status" : "dialog"}
            aria-modal={automatic ? undefined : "true"}
            aria-label="Tactical report and re-form"
            data-mobile-report-state={reportAcknowledged ? (reportOpen ? "open" : "available") : "required"}
            tabIndex={-1}
            onKeyDown={(event) => { if (event.key === "Escape" && changed) setNext([...deployment]); }}
        >
            <section
                id={reportId}
                className={`wfr-reform-evidence${reportOpen ? " is-open" : ""}`}
                aria-label={`Clash ${clash.index + 1} tactical report`}
                aria-hidden={!automatic && reportAcknowledged ? !reportOpen : undefined}
            >
                <p className="wfr-eyebrow">Tactical report · Clash {clash.index + 1}</p>
                <h3>Read. Re-form. Rematch.</h3>
                <div className="wfr-report-facts" aria-label="Authoritative clash facts">
                    <span><small>Winner</small><strong>{winnerLabel}</strong></span>
                    <span><small>First KO</small><strong>{firstKoPet?.name ?? "None"}</strong></span>
                    <span><small>Highest damage threat</small><strong>{threatPet ? `${threatPet.name} · ${Math.round(report.highestDamageThreat?.damage ?? 0)}` : "None"}</strong></span>
                </div>
                <section className="wfr-fought-formation" aria-label="Opponent formation just fought">
                    <span className="wfr-next-label">Opponent formation just fought</span>
                    <ul>
                        {report.opponentFormation.map((entry) => {
                            const pet = enemyBand[entry.slot];
                            return pet ? (
                                <li key={entry.petId}>
                                    <PetPortrait pet={pet} sharedImages={sharedImages} size={30} placementArt />
                                    <span><strong>{pet.name}</strong><small>{deploymentLabel(entry.node)}</small></span>
                                </li>
                            ) : null;
                        })}
                    </ul>
                </section>
                <p className="wfr-reform-copy">Move any pet to any open cell, or hold this formation. Occupied cells select that pet; they never move a second pet for you.</p>
                <p className="wfr-no-prediction">No outcome prediction. Locking seals your formation; the authoritative rematch decides the result.</p>
                {!automatic ? (
                    <button type="button" className="wfr-report-ack" aria-label="Report read, re-form band" onClick={closeInitialReport}>
                        <span>Report read</span>
                        <strong>Re-form band</strong>
                    </button>
                ) : null}
            </section>
            {automatic ? (
                <p className="wfr-auto-reform">AUTO RE-FORM · locking a deterministic response from this public clash…</p>
            ) : (
                <>
                    <button
                        ref={reportTriggerRef}
                        type="button"
                        className="wfr-reform-drawer-trigger"
                        aria-label={`${reportOpen ? "Close" : "Open"} tactical report`}
                        aria-controls={reportId}
                        aria-expanded={reportOpen}
                        onClick={() => setReportOpen((current) => !current)}
                    >
                        <span aria-hidden="true">≡</span>
                        <span>Report</span>
                    </button>
                    <PlacementBoard
                        band={band}
                        deployment={next}
                        onChange={setNext}
                        sharedImages={sharedImages}
                        healthBySlot={healthBySlot}
                    />
                    <div className="wfr-reform-footer">
                        <output className="wfr-formation-diff" aria-live="polite">
                            <span>Changes vs previous formation</span>
                            {changes.length ? changes.map((entry) => <strong key={entry.pet.id}>{entry.pet.name}: {entry.from} → {entry.to}</strong>) : <strong>No changes — holding the line</strong>}
                        </output>
                        <div className="wfr-deploy-actions">
                            <button type="button" className="wfr-btn-ghost" disabled={!changed} onClick={() => setNext([...deployment])}>Reset changes</button>
                            <button type="button" className="wfr-btn-primary" onClick={() => onCommit({ formation: [...formation], deployment: next })}>
                                Lock &amp; rematch
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

// ── Match ───────────────────────────────────────────────────────────────────

function useReducedMotionPreference(): boolean {
    const [reduced, setReduced] = useState(
        () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
    );
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const sync = () => setReduced(media.matches);
        sync();
        media.addEventListener?.("change", sync);
        return () => media.removeEventListener?.("change", sync);
    }, []);
    return reduced;
}

export function PetWarfrontRite({
    blue, red, seed, sharedImages = {}, onResult, onExit,
    resultSupplement, resultActionsLocked = false, settlementPending = false,
    spectator = false, playbackRate = 0.78,
}: PetWarfrontRiteProps) {
    const blueBand = useMemo(() => blue.slice(0, RITE_BAND_SIZE).map((slot) => slot.pet), [blue]);
    const redBand = useMemo(() => red.slice(0, RITE_BAND_SIZE).map((slot) => slot.pet), [red]);
    useEffect(() => {
        void preloadRitePetModels([...blueBand, ...redBand]).catch(() => undefined);
    }, [blueBand, redBand]);
    const quality = useMemo(() => {
        const requested = petVisualQuality();
        if (typeof window === "undefined") return requested;
        const compactTouch = window.innerWidth <= 720 && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
        const params = new URLSearchParams(window.location.search);
        const explicitQaOverride = params.has("petQuality") && params.get("riteqa") === "1";
        // Six animated rigs plus postprocessing are a different workload from
        // a Coliseum duel. Phone Warfront defaults to the low scene profile even
        // if the global pet setting—or a shared desktop preview URL—says High.
        // Only the release harness's explicit riteqa=1 flag may override this.
        if (compactTouch && !explicitQaOverride && requested.id !== "low") return PET_VISUAL_QUALITY_PRESETS.low;
        return requested;
    }, []);
    const reducedMotion = useReducedMotionPreference();
    const effectivePlaybackRate = useMemo(() => {
        const requested = Math.max(0.1, Math.min(30, playbackRate));
        if (typeof window === "undefined") return Math.min(1, requested);
        // Production and normal visual previews never exceed real-time. The old
        // `ritespeed=3` share URL compressed dashes into apparent teleports and
        // made the VFX live for only a few frames. Fast scrub remains available
        // only to the explicit release-test harness.
        const qaScrub = new URLSearchParams(window.location.search).get("riteqa") === "1";
        return qaScrub ? requested : Math.min(1, requested);
    }, [playbackRate]);

    // Two enemy positions are public while the remaining placements stay sealed.
    const enemyPlan = useMemo(() => aiRitePlan(redBand, seed), [redBand, seed]);
    const automaticPlan = useMemo(() => aiRitePlan(blueBand, seed), [blueBand, seed]);

    // A spectator starts mid-match on the default deployment — there is no
    // deploy step to take, and both clients must derive the same one.
    const [phase, setPhase] = useState<Phase>(spectator ? "clash" : "deploy");
    const [result, setResult] = useState<RiteResult | null>(
        () => (spectator ? runWarfrontRite(blue.slice(0, RITE_BAND_SIZE).map((s) => s.pet), red.slice(0, RITE_BAND_SIZE).map((s) => s.pet), seed, automaticPlan) : null),
    );
    const [plan, setPlan] = useState<RitePlan | null>(() => (spectator ? automaticPlan : null));
    const [clashIndex, setClashIndex] = useState(0);
    const [formationHold, setFormationHold] = useState(spectator);
    const [stageReady, setStageReady] = useState(false);
    const [formationRevealed, setFormationRevealed] = useState(false);
    const [modelsReady, setModelsReady] = useState(0);
    const [rendererAvailable, setRendererAvailable] = useState(true);

    const clockRef = useRef(0);
    const rateRef = useRef(1);
    const winnerRefs = useRef({ player: false, enemy: false });
    const reportedRef = useRef(false);
    const audioCursorRef = useRef(0);
    const audioDispatchesRef = useRef(0);
    const [audioArmed, setAudioArmed] = useState(false);

    const clash: RiteClash | null = result && phase !== "deploy" ? result.clashes[clashIndex] ?? null : null;
    const audioPlan = useMemo(() => buildWarfrontAudioPlan(clash?.result.events ?? []), [clash]);

    const armAudio = useCallback(() => {
        primePetSfx();
        setAudioArmed(true);
    }, []);

    useEffect(() => {
        audioCursorRef.current = 0;
        audioDispatchesRef.current = 0;
    }, [clash]);

    const fighters: StageFighter[] = useMemo(() => {
        if (!clash) return [];
        return [
            ...clash.blue.map((c) => ({ team: "player" as const, lane: c.lane, pet: blueBand[c.slot], entryHp: c.entryHp })),
            ...clash.red.map((c) => ({ team: "enemy" as const, lane: c.lane, pet: redBand[c.slot], entryHp: c.entryHp })),
        ].filter((f) => Boolean(f.pet));
    }, [clash, blueBand, redBand]);
    const currentFormation = useMemo(() => clash
        ? [...clash.blue].sort((a, b) => a.lane - b.lane).map((combatant) => combatant.slot)
        : [...(plan?.formation ?? defaultRitePlan().formation)], [clash, plan]);
    const currentDeployment = useMemo(() => Array.from({ length: RITE_BAND_SIZE }, (_, slot) =>
        clash?.blue.find((combatant) => combatant.slot === slot)?.node
            ?? plan?.deployment?.[slot]
            ?? WARFRONT_DEFAULT_DEPLOYMENT[slot],
    ), [clash, plan]);

    const rounds = useMemo(() => {
        if (!result) return { blue: 0, red: 0 };
        let b = 0;
        let r = 0;
        for (let i = 0; i < Math.min(clashIndex + (phase === "interlude" || phase === "result" ? 1 : 0), result.clashes.length); i++) {
            if (result.clashes[i].winner === "blue") b++;
            else if (result.clashes[i].winner === "red") r++;
        }
        return { blue: b, red: r };
    }, [result, clashIndex, phase]);

    const begin = useCallback((chosen: RitePlan) => {
        armAudio();
        const outcome = runWarfrontRite(blueBand, redBand, seed, chosen);
        setPlan(chosen);
        setResult(outcome);
        setClashIndex(0);
        clockRef.current = 0;
        winnerRefs.current.player = false;
        winnerRefs.current.enemy = false;
        setStageReady(false);
        setFormationRevealed(false);
        setModelsReady(0);
        setFormationHold(true);
        setPhase("clash");
        startBattleMusic?.();
    }, [armAudio, blueBand, redBand, seed]);

    /** Lock the current decision, then and only then start the rematch. A changed
     * layout is appended to the replay transcript; a hold needs no combat
     * command but still passes through this explicit lock boundary. */
    const commitReform = useCallback((nextChoice: { formation: number[]; deployment: number[] }) => {
        if (!plan || !clash) return;
        const previousDeployment = Array.from({ length: blueBand.length }, (_, slot) =>
            clash.blue.find((combatant) => combatant.slot === slot)?.node ?? (plan.deployment?.[slot] ?? WARFRONT_DEFAULT_DEPLOYMENT[slot]),
        );
        const changed = nextChoice.deployment.some((node, slot) => node !== previousDeployment[slot]);
        let nextPlan = plan;
        let nextResult = result;
        if (changed) {
            const nextReform = {
                afterClash: clashIndex,
                formation: [...nextChoice.formation],
                deployment: [...nextChoice.deployment],
            };
            const reforms = [...(plan.reforms ?? [])]
                .filter((entry) => entry.afterClash !== clashIndex)
                .concat(nextReform)
                .sort((a, b) => a.afterClash - b.afterClash);
            const hasLegacyReform = plan.reformAfterClash !== null && plan.reformAfterClash !== undefined;
            nextPlan = {
                ...plan,
                reforms,
                reformAfterClash: hasLegacyReform ? plan.reformAfterClash : clashIndex,
                reform: hasLegacyReform ? plan.reform : [...nextChoice.formation],
                reformDeployment: hasLegacyReform ? plan.reformDeployment : [...nextChoice.deployment],
            };
            nextResult = runWarfrontRite(blueBand, redBand, seed, nextPlan);
            setPlan(nextPlan);
            setResult(nextResult);
        }
        if (!nextResult || clashIndex >= nextResult.clashes.length - 1) { setPhase("result"); return; }
        setClashIndex(clashIndex + 1);
        clockRef.current = 0;
        rateRef.current = 1;
        winnerRefs.current.player = false;
        winnerRefs.current.enemy = false;
        setStageReady(false);
        setFormationRevealed(false);
        setModelsReady(0);
        setFormationHold(true);
        setPhase("clash");
    }, [plan, clash, blueBand, redBand, seed, result, clashIndex]);

    const handleStageReady = useCallback(() => {
        setStageReady(true);
        if (reducedMotion) setFormationRevealed(true);
    }, [reducedMotion]);
    const handleModelProgress = useCallback((readyCount: number) => setModelsReady(readyCount), []);
    const handleRouteTransition = useCallback(() => {
        // Pause at the current authoritative tick and put the opaque formation
        // veil back before Stage swaps all eight presentation actors. The clock
        // resumes from this same tick once the replacement family has painted.
        setStageReady(false);
        setFormationRevealed(false);
    }, []);
    const handleRendererAvailability = useCallback((available: boolean) => setRendererAvailable(available), []);
    const handleCurtainTransitionEnd = useCallback((event: ReactTransitionEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && event.propertyName === "opacity" && stageReady) {
            setFormationRevealed(true);
        }
    }, [stageReady]);

    // CSS transition events can be coalesced while a software WebGL renderer is
    // monopolising the main thread. Stage readiness still means all eight rigs
    // painted atomically, so this bounded fallback completes that same reveal.
    useEffect(() => {
        if (!stageReady || formationRevealed) return;
        const id = window.setTimeout(() => setFormationRevealed(true), reducedMotion ? 0 : 360);
        return () => window.clearTimeout(id);
    }, [stageReady, formationRevealed, reducedMotion]);

    useEffect(() => {
        // The tableau is part of the match contract, not a loading screen. Hold
        // tick zero for a full beat AFTER the atomic reveal, then let the player
        // read the cells they committed before any route begins.
        if (!formationHold || !formationRevealed) return;
        const id = window.setTimeout(() => setFormationHold(false), reducedMotion ? 500 : FORMATION_HOLD_MS);
        return () => window.clearTimeout(id);
    }, [formationHold, formationRevealed, reducedMotion]);

    // ── Playback clock ──────────────────────────────────────────────────────
    // Fractional ticks in a ref. Nothing here calls setState per frame.
    useEffect(() => {
        if (phase !== "clash" || !clash || formationHold || !formationRevealed || !rendererAvailable) return;
        const total = clash.result.ticks;
        let koTick: number | null = null;
        for (let i = clash.result.events.length - 1; i >= 0; i--) {
            if (clash.result.events[i].type === "ko") { koTick = clash.result.events[i].t; break; }
        }
        let last = performance.now();
        let stopPulses = () => {};
        const step = (now: number) => {
            if (document.visibilityState !== "visible") {
                last = now;
                return;
            }
            const delta = boundedRitePlaybackDelta(now - last);
            last = now;
            // Savour the final knockout, and EASE into it — never a step change.
            const nearLethal = koTick !== null
                && clockRef.current > koTick - DUEL_TPS * 0.55
                && clockRef.current < koTick + DUEL_TPS * 1.1;
            const target = reducedMotion ? 1 : nearLethal ? 0.45 : 1;
            rateRef.current += (target - rateRef.current) * (1 - Math.pow(0.02, delta));
            const scrub = effectivePlaybackRate;
            clockRef.current = advanceRitePlaybackTick(
                clockRef.current,
                total,
                delta,
                DUEL_TPS,
                rateRef.current,
                scrub,
            );
            while (audioCursorRef.current < audioPlan.length
                && audioPlan[audioCursorRef.current].tick <= clockRef.current) {
                const cue = audioPlan[audioCursorRef.current++];
                if (audioArmed) {
                    playPetSfx(cue.sfx, {
                        gain: cue.gain,
                        playbackRate: cue.playbackRate,
                        pan: cue.pan,
                        channel: "warfront-combat",
                        priority: cue.priority,
                    });
                    audioDispatchesRef.current++;
                }
            }
            if (clockRef.current >= total) {
                winnerRefs.current.player = clash.winner === "blue";
                winnerRefs.current.enemy = clash.winner === "red";
                playPetSfx(clash.winner === "blue" ? "victory" : "hit");
                setPhase("interlude");
                stopPulses();
            }
        };
        const resetBaseline = () => { last = performance.now(); };
        document.addEventListener("visibilitychange", resetBaseline);
        stopPulses = startRitePlaybackPulses({
            now: () => performance.now(),
            requestFrame: (callback) => requestAnimationFrame(callback),
            cancelFrame: (handle) => cancelAnimationFrame(handle),
            setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
            clearTimer: (handle) => window.clearTimeout(handle),
        }, step);
        return () => {
            stopPulses();
            document.removeEventListener("visibilitychange", resetBaseline);
        };
    }, [phase, clash, formationHold, formationRevealed, rendererAvailable, reducedMotion, effectivePlaybackRate, audioArmed, audioPlan]);

    // Every non-terminal clash enters the same decision state. Interactive play
    // has no timeout; spectator/autostart traverses it through the deterministic
    // short auto-lock effect below.
    const reformOpen = phase === "interlude"
        && Boolean(result)
        && clashIndex < result!.clashes.length - 1;

    useEffect(() => {
        if (!spectator || !reformOpen || !clash) return;
        const counter = deterministicRiteCounterMove(clash, "blue");
        const choice = counter
            ? { formation: counter.formation, deployment: counter.deployment }
            : { formation: currentFormation, deployment: currentDeployment };
        const id = window.setTimeout(() => commitReform(choice), reducedMotion ? 350 : 900);
        return () => window.clearTimeout(id);
    }, [spectator, reformOpen, clash, currentFormation, currentDeployment, commitReform, reducedMotion]);

    useEffect(() => {
        if (phase !== "interlude" || !result || reformOpen) return;
        const id = window.setTimeout(() => {
            setPhase("result");
        }, reducedMotion ? 900 : INTERLUDE_MS);
        return () => window.clearTimeout(id);
    }, [phase, clashIndex, result, reducedMotion, reformOpen]);

    // Settlement is reported exactly once, with the plan the player committed.
    useEffect(() => {
        // A shared co-op replay settles nowhere — it has no reward token and no
        // per-client authority, so reporting from it would be meaningless.
        if (spectator || phase !== "result" || !result || !plan || reportedRef.current) return;
        reportedRef.current = true;
        stopBattleMusic?.();
        playPetSfx(result.winner === "blue" ? "victory" : "crowd");
        onResult?.(result, plan);
    }, [phase, result, plan, onResult, spectator]);

    useEffect(() => () => { stopBattleMusic?.(); }, []);

    if (phase === "deploy") {
        return (
            <div className="wfr-root">
                <DeployPanel
                    band={blueBand}
                    enemyBand={redBand}
                    enemyPlan={enemyPlan}
                    sharedImages={sharedImages}
                    onBegin={begin}
                    onExit={onExit}
                />
            </div>
        );
    }

    if (phase === "result" && result) {
        const won = result.winner === "blue";
        const mvp = result.mvpSlot === null ? null : blueBand[result.mvpSlot] ?? null;
        return (
            <div className="wfr-root">
                <div className="wfr-result">
                    <p className="wfr-eyebrow">Beastbound Warfront</p>
                    <h2 className={won ? "is-win" : "is-loss"}>{won ? "The Rite is yours" : "The Rite is lost"}</h2>
                    <p className="wfr-result-line">
                        Clashes {result.blueRounds}&ndash;{result.redRounds} &middot; {result.clashes.length} fought &middot; {Math.round(result.totalSeconds)}s
                    </p>
                    {mvp ? (
                        <div className="wfr-mvp">
                            <PetPortrait pet={mvp} sharedImages={sharedImages} size={64} />
                            <div>
                                <span className="wfr-eyebrow">Took the most down</span>
                                <strong>{mvp.name}</strong>
                            </div>
                        </div>
                    ) : null}
                    <ol className="wfr-recap">
                        {result.clashes.map((c) => (
                            <li key={c.index} className={c.winner === "blue" ? "is-win" : c.winner === "red" ? "is-loss" : undefined}>
                                <span className="wfr-recap-no">{c.index + 1}</span>
                                <span className="wfr-recap-pair">
                                    {c.blueStanding} <em>vs</em> {c.redStanding} standing
                                </span>
                                <span className="wfr-recap-out">
                                    {c.winner === "blue" ? "won" : c.winner === "red" ? "lost" : "drawn"} &middot; {c.seconds.toFixed(0)}s
                                </span>
                            </li>
                        ))}
                    </ol>
                    {resultSupplement}
                    {settlementPending ? <p className="wfr-settling">Sealing the result…</p> : null}
                    <div className="wfr-deploy-actions">
                        <button type="button" className="wfr-btn-primary" onClick={onExit} disabled={resultActionsLocked}>
                            Leave the Warfront
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!clash || !result) return null;

    return (
        <div className="wfr-root">
            <div className="wfr-stage">
                <PetWarfrontRiteStage
                    sceneKey={clash.index}
                    result={clash.result}
                    fighters={fighters}
                    clockRef={clockRef}
                    quality={quality}
                    winnerRef={winnerRefs}
                    reducedMotion={reducedMotion}
                    onReady={handleStageReady}
                    onLoadProgress={handleModelProgress}
                    onRouteTransition={handleRouteTransition}
                    onRendererAvailability={handleRendererAvailability}
                />
            </div>

            <ClashHud
                key={`hud-${clash.index}`}
                clash={clash}
                blueBand={blueBand}
                redBand={redBand}
                clockRef={clockRef}
                sharedImages={sharedImages}
                rounds={rounds}
                audioArmed={audioArmed}
                audioDispatches={audioDispatchesRef}
                onArmAudio={armAudio}
            />

            <div
                className={`wfr-stage-curtain${stageReady ? " is-open" : ""}`}
                role="status"
                data-testid="wfr-stage-curtain"
                data-models-ready={modelsReady}
                data-stage-ready={stageReady ? "true" : "false"}
                aria-hidden={stageReady ? "true" : undefined}
                onTransitionEnd={handleCurtainTransitionEnd}
                onTransitionCancel={handleCurtainTransitionEnd}
            >
                <div>
                    <strong>PREPARING BOTH FORMATIONS</strong>
                    <span>{modelsReady}/{RITE_REVEAL_FIGHTER_COUNT} combatants ready</span>
                </div>
            </div>

            {formationHold && formationRevealed ? (
                <div className="wfr-formation-hold" role="status" data-stage-ready="true">
                    <strong>CLASH {clash.index + 1} · FORMATIONS LOCKED</strong>
                    <span>Eight committed cells · routes begin here</span>
                </div>
            ) : null}

            {phase === "interlude" ? (
                reformOpen && plan ? (
                    <div className="wfr-interlude">
                        <ReformPanel
                            key={`reform-${clash.index}`}
                            clash={clash}
                            band={blueBand}
                            enemyBand={redBand}
                            formation={currentFormation}
                            deployment={currentDeployment}
                            sharedImages={sharedImages}
                            automatic={spectator}
                            onCommit={commitReform}
                        />
                    </div>
                ) : (
                    <Interlude clash={clash} blueBand={blueBand} redBand={redBand} sharedImages={sharedImages} />
                )
            ) : null}

            <button type="button" className="wfr-exit" onClick={onExit} aria-label="Leave the Warfront">✕</button>
        </div>
    );
}
