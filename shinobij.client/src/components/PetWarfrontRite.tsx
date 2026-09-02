/*
 * Hollow Warfront — the Rite.
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
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
    riteBandProblem,
    runWarfrontRite,
    type RiteClash,
    type RiteCombatant,
    type RitePlan,
    type RiteResult,
} from "../lib/pet-warfront-rite";
import { petBattleSprite } from "../lib/pet-battle-anim";
import { PET_VISUAL_QUALITY_PRESETS, petVisualQuality } from "../lib/pet-visual-quality";
import { playPetSfx, primePetSfx } from "../lib/pet-sfx";
import { startBattleMusic, stopBattleMusic } from "../lib/pet-music";
import { explainSquadClash } from "../lib/pet-warfront-rite-presentation";
import type { StageFighter } from "./PetWarfrontRiteStage3D";
import "../styles/pet-warfront-rite.css";

const PetWarfrontRiteStage3D = lazy(() => import("./PetWarfrontRiteStage3D").then((m) => ({ default: m.PetWarfrontRiteStage3D })));

const ELEMENT_COLOR: Readonly<Record<string, string>> = {
    Fire: "#ff7a45", Water: "#4cc2ff", Wind: "#6ff0c8",
    Lightning: "#ffe066", Earth: "#d9a566", None: "#c9d6de",
};
const elColor = (element: string | null | undefined) => ELEMENT_COLOR[String(element ?? "None")] ?? ELEMENT_COLOR.None;

/** The handoff between clashes, beat by beat. A budget, not a guideline: three
 *  slack transitions turn a 2.5-minute match into loading screens. */
const OPENING_CARD_MS = 2200;
const INTERLUDE_MS = 4200;

type Phase = "deploy" | "clash" | "interlude" | "result";

/** The line a band takes when nobody chose one — roster order. */
const defaultRitePlan = (): RitePlan => ({
    formation: Array.from({ length: RITE_BAND_SIZE }, (_, i) => i),
    deployment: [...WARFRONT_DEFAULT_DEPLOYMENT],
    reformAfterClash: null,
    reform: null,
    reformDeployment: null,
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

function PetPortrait({ pet, sharedImages, size = 56 }: { pet: Pet; sharedImages: Record<string, string>; size?: number }) {
    const sprite = useMemo(() => petBattleSprite(pet, sharedImages), [pet, sharedImages]);
    return (
        <span className="wfr-portrait" style={{ width: size, height: size, borderColor: `${elColor(pet.element)}88` }}>
            {sprite.src
                ? <img src={sprite.src} alt="" aria-hidden="true" loading="lazy" />
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
    const occupied = useMemo(
        () => new Map(deployment.map((node, slot) => [node, slot] as const)),
        [deployment],
    );
    const place = (nodeId: number) => {
        const otherSlot = occupied.get(nodeId);
        if (otherSlot === selectedSlot) return;
        const next = [...deployment];
        if (otherSlot !== undefined) next[otherSlot] = next[selectedSlot];
        next[selectedSlot] = nodeId;
        onChange(next);
    };

    return (
        <div className="wfr-placement-shell">
            <div className="wfr-pet-picker" aria-label="Choose a pet to place">
                {band.map((pet, slot) => (
                    <button
                        key={pet.id}
                        type="button"
                        className={slot === selectedSlot ? "is-selected" : undefined}
                        aria-pressed={slot === selectedSlot}
                        onClick={() => setSelectedSlot(slot)}
                    >
                        <PetPortrait pet={pet} sharedImages={sharedImages} size={42} />
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
                                className={`${pet ? "is-occupied" : ""} ${selected ? "is-selected" : ""}`.trim()}
                                aria-label={pet
                                    ? `${deploymentLabel(nodeId)} occupied by ${pet.name}${selected ? ", selected" : ", tap to swap"}`
                                    : `Place ${band[selectedSlot]?.name ?? "selected pet"} at ${deploymentLabel(nodeId)}`}
                                onClick={() => place(nodeId)}
                            >
                                {pet ? <PetPortrait pet={pet} sharedImages={sharedImages} size={38} /> : <span className="wfr-empty-node" />}
                            </button>
                        );
                    })}
                </div>
                <div className="wfr-route-labels" aria-hidden="true"><span>North edge</span><span>North</span><span>Center</span><span>South</span><span>South edge</span></div>
            </div>
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
    const problem = useMemo(() => riteBandProblem(band), [band]);

    return (
        <div className="wfr-deploy">
            <header className="wfr-deploy-head">
                <p className="wfr-eyebrow">Hollow Warfront</p>
                <h2>Set your formation</h2>
                <p className="wfr-deploy-copy">
                    Deploy all four pets on any open cells. Shoji screens block movement and sight; roof tiles blunt ranged attacks; smoke breaks clean aim.
                    Defenders hold, ranged pets keep real distance, supports protect weak allies, and assassins seek the back line. Nothing is role-locked.
                    Kage Verdict breaks late-round stalls after 28 seconds. First to {RITE_CLASHES_TO_WIN} formation clashes wins.
                </p>
            </header>

            <section className="wfr-scout" aria-label="Enemy revealed deployment">
                <h3>Their revealed positions</h3>
                <div className="wfr-scout-body">
                    {enemyPlan.formation.slice(0, RITE_SCOUTED_JOBS).map((slot) => {
                        const pet = enemyBand[slot];
                        if (!pet) return null;
                        return (
                            <span key={pet.id} className="wfr-scout-pet">
                                <span className="wfr-scout-job">{deploymentLabel(enemyPlan.deployment?.[slot] ?? -1)}</span>
                                <PetPortrait pet={pet} sharedImages={sharedImages} size={54} />
                                <strong>{pet.name}</strong>
                                <span className="wfr-el" style={{ color: elColor(pet.element) }}>{pet.element ?? "None"}</span>
                            </span>
                        );
                    })}
                </div>
                <p className="wfr-scout-note">Two positions are scouted. Their other two placements stay sealed until the clash begins.</p>
            </section>

            <PlacementBoard band={band} deployment={deployment} onChange={setDeployment} sharedImages={sharedImages} />
            <p className="wfr-formation-hint">Tap a pet, then any cell. Forward starts pressure sooner; rear protects range and support. Splitting files reduces area damage, while stacking enables focus fire.</p>

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
 * Six active health bars and the clock, driven by ONE rAF that writes straight to the
 * DOM. Putting these in React state would re-render the whole match tree 30+
 * times a second, which is the mistake that cost the lane war its frame pacing.
 */
function ClashHud({ clash, blueBand, redBand, clockRef, sharedImages, rounds }: {
    clash: RiteClash;
    blueBand: Pet[];
    redBand: Pet[];
    clockRef: { current: number };
    sharedImages: Record<string, string>;
    rounds: { blue: number; red: number };
}) {
    const bars = useRef<Record<string, HTMLSpanElement | null>>({});
    const clockOut = useRef<HTMLOutputElement>(null);

    useEffect(() => {
        let raf = 0;
        const snaps = clash.result.snapshots;
        const paint = () => {
            const t = Math.max(0, Math.min(snaps.length - 1, clockRef.current));
            const snap = snaps[Math.floor(t)];
            if (snap) {
                for (const actor of snap.actors) {
                    const side = actor.team === "player" ? clash.blue : clash.red;
                    const entry = side[actor.slot]?.entryHp ?? 1;
                    const frac = Math.max(0, actor.maxHp > 0 ? actor.hp / actor.maxHp : 0) * entry;
                    const bar = bars.current[`${actor.team}-${actor.slot}`];
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
            raf = requestAnimationFrame(paint);
        };
        raf = requestAnimationFrame(paint);
        return () => cancelAnimationFrame(raf);
    }, [clash, clockRef]);

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
        <div className="wfr-hud">
            <output ref={clockOut} data-testid="wfr-clock" data-tick="0" hidden />
            {row(clash.blue, blueBand, "player", "Your band")}
            <div className="wfr-hud-center">
                <span className="wfr-duel-no">KAGE TACTICS {clash.index + 1}</span>
                <span className="wfr-rounds" aria-label="Clashes won">
                    <b>{rounds.blue}</b><i>—</i><b>{rounds.red}</b>
                </span>
                <span className="wfr-rule-state" aria-label="Formation combat rules">
                    <span className="is-blue">HOLD RANGE</span>
                    <strong>COVER · SIGHT · VERDICT 28s</strong>
                    <span className="is-red">BREAK FORMATION</span>
                </span>
            </div>
            {row(clash.red, redBand, "enemy", "Their band")}
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
    // What the player takes into the next clash — the number that decides
    // whether their deployment needs changing.
    const survivors = clash.blue
        .filter((c) => c.exitHp > 0)
        .map((c) => ({ pet: blueBand[c.slot], hp: c.exitHp }))
        .filter((entry) => Boolean(entry.pet));
    const won = clash.winner === "blue";
    const explanation = explainSquadClash(
        clash.result,
        clash.winner === "blue" ? "player" : clash.winner === "red" ? "enemy" : null,
    );
    return (
        <div className="wfr-interlude">
            <div className="wfr-interlude-victor">
                <p className="wfr-eyebrow">Clash {clash.index + 1}</p>
                <h3 className={won ? "is-win" : clash.winner === "red" ? "is-loss" : undefined}>
                    {clash.winner === null ? "The formation holds" : won ? "Their formation broke" : "Your formation broke"}
                </h3>
                <p>{clash.blueStanding} standing · {clash.redStanding} of theirs</p>
                <div className="wfr-interlude-edge">
                    <span>Deciding edge</span>
                    <strong>{explanation.headline}</strong>
                    <p>{explanation.detail}</p>
                </div>
            </div>
            {fallen.length ? (
                <div className="wfr-interlude-ko">
                    <span className="wfr-next-label">Fallen — they return wounded</span>
                    <div className="wfr-next-pair">
                        {fallen.slice(0, 6).map((pet, i) => (
                            <span key={`${pet.id}-${i}`}><PetPortrait pet={pet} sharedImages={sharedImages} size={44} /></span>
                        ))}
                    </div>
                </div>
            ) : null}
            {survivors.length ? (
                <div className="wfr-interlude-next">
                    <span className="wfr-next-label">Your band regroups</span>
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

/**
 * The one MID-MATCH decision: after the opening clash you may re-form once.
 *
 * This is interactive rather than pre-committed, and it is safe to recompute the
 * match around it because the engine applies a reform only to clashes AFTER the
 * one it is attached to. Re-running `runWarfrontRite` with the same bands, the
 * same seed and the same opening deployment reproduces clash one byte for byte —
 * pinned by a test — so the player sees exactly the fight they already watched,
 * and only what follows changes.
 */
function ReformPanel({ clash, band, formation, deployment, sharedImages, onCommit }: {
    clash: RiteClash;
    band: Pet[];
    formation: number[];
    deployment: number[];
    sharedImages: Record<string, string>;
    onCommit: (next: { formation: number[]; deployment: number[] } | null) => void;
}) {
    const [next, setNext] = useState<number[]>(() => [...deployment]);
    const panelRef = useRef<HTMLDivElement>(null);
    // This dialog HALTS the match until it is answered, so it has to behave like
    // one: it takes focus on open (a keyboard user would otherwise be stranded
    // tabbing a dimmed HUD behind it), and Escape holds the line rather than
    // trapping anyone who does not want to change anything.
    useEffect(() => {
        panelRef.current?.focus();
    }, []);
    const changed = next.some((node, i) => node !== deployment[i]);
    const healthBySlot = useMemo(
        () => new Map(band.map((_, slot) => [slot, clash.blue.find((c) => c.slot === slot)?.exitHp ?? (slot === clash.blueReserveSlot ? 1 : 0)])),
        [band, clash.blue, clash.blueReserveSlot],
    );
    const explanation = useMemo(() => explainSquadClash(
        clash.result,
        clash.winner === "blue" ? "player" : clash.winner === "red" ? "enemy" : null,
    ), [clash]);

    return (
        <div
            ref={panelRef}
            className="wfr-reform"
            role="dialog"
            aria-modal="true"
            aria-label="Re-form your band"
            tabIndex={-1}
            onKeyDown={(event) => { if (event.key === "Escape") onCommit(null); }}
        >
            <p className="wfr-eyebrow">One re-form per Rite</p>
            <h3>Move your pets?</h3>
            <p className="wfr-reform-copy">
                Your band regroups before the next clash. Move any pet to any open cell, change the screen it uses, or hold the field.
            </p>
            <div className="wfr-reform-readout">
                <span>Why that clash turned</span>
                <strong>{explanation.headline}</strong>
                <p>{explanation.detail}</p>
            </div>
            <PlacementBoard
                band={band}
                deployment={next}
                onChange={setNext}
                sharedImages={sharedImages}
                healthBySlot={healthBySlot}
            />
            <div className="wfr-deploy-actions">
                <button type="button" className="wfr-btn-ghost" onClick={() => onCommit(null)}>Hold the line</button>
                <button type="button" className="wfr-btn-primary" disabled={!changed} onClick={() => onCommit({ formation: [...formation], deployment: next })}>
                    Re-form
                </button>
            </div>
        </div>
    );
}

// ── Match ───────────────────────────────────────────────────────────────────

export function PetWarfrontRite({
    blue, red, seed, sharedImages = {}, onResult, onExit,
    resultSupplement, resultActionsLocked = false, settlementPending = false,
    spectator = false, playbackRate = 0.78,
}: PetWarfrontRiteProps) {
    const blueBand = useMemo(() => blue.slice(0, RITE_BAND_SIZE).map((slot) => slot.pet), [blue]);
    const redBand = useMemo(() => red.slice(0, RITE_BAND_SIZE).map((slot) => slot.pet), [red]);
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
    const reducedMotion = useMemo(
        () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
        [],
    );
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

    // A spectator starts mid-match on the default deployment — there is no
    // deploy step to take, and both clients must derive the same one.
    const [phase, setPhase] = useState<Phase>(spectator ? "clash" : "deploy");
    const [result, setResult] = useState<RiteResult | null>(
        () => (spectator ? runWarfrontRite(blue.slice(0, RITE_BAND_SIZE).map((s) => s.pet), red.slice(0, RITE_BAND_SIZE).map((s) => s.pet), seed, defaultRitePlan()) : null),
    );
    const [plan, setPlan] = useState<RitePlan | null>(() => (spectator ? defaultRitePlan() : null));
    const [clashIndex, setClashIndex] = useState(0);
    const [openingCard, setOpeningCard] = useState(spectator);
    const [reformSpent, setReformSpent] = useState(false);

    const clockRef = useRef(0);
    const rateRef = useRef(1);
    const winnerRefs = useRef({ player: false, enemy: false });
    const reportedRef = useRef(false);

    const clash: RiteClash | null = result && phase !== "deploy" ? result.clashes[clashIndex] ?? null : null;

    const fighters: StageFighter[] = useMemo(() => {
        if (!clash) return [];
        return [
            ...clash.blue.map((c) => ({ team: "player" as const, lane: c.lane, pet: blueBand[c.slot], entryHp: c.entryHp })),
            ...clash.red.map((c) => ({ team: "enemy" as const, lane: c.lane, pet: redBand[c.slot], entryHp: c.entryHp })),
        ].filter((f) => Boolean(f.pet));
    }, [clash, blueBand, redBand]);

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
        primePetSfx();
        const outcome = runWarfrontRite(blueBand, redBand, seed, chosen);
        setPlan(chosen);
        setResult(outcome);
        setClashIndex(0);
        setReformSpent(false);
        clockRef.current = 0;
        winnerRefs.current.player = false;
        winnerRefs.current.enemy = false;
        setOpeningCard(true);
        setPhase("clash");
        startBattleMusic?.();
    }, [blueBand, redBand, seed]);

    /**
     * Commit (or decline) the re-form, then continue into the next clash.
     *
     * Recomputing the whole match here is safe and deliberate: the engine
     * applies a reform only to clashes AFTER the one it is attached to, so
     * clash one is reproduced byte for byte from the same bands, seed and
     * opening deployment. The player never sees the fight they just watched
     * change underneath them.
     */
    const commitReform = useCallback((nextChoice: { formation: number[]; deployment: number[] } | null) => {
        setReformSpent(true);
        if (!nextChoice || !plan) {
            setClashIndex((i) => i + 1);
            clockRef.current = 0;
            rateRef.current = 1;
            winnerRefs.current.player = false;
            winnerRefs.current.enemy = false;
            setPhase("clash");
            return;
        }
        const nextPlan: RitePlan = {
            ...plan,
            reformAfterClash: 0,
            reform: nextChoice.formation,
            reformDeployment: nextChoice.deployment,
        };
        setPlan(nextPlan);
        setResult(runWarfrontRite(blueBand, redBand, seed, nextPlan));
        setClashIndex((i) => i + 1);
        clockRef.current = 0;
        rateRef.current = 1;
        winnerRefs.current.player = false;
        winnerRefs.current.enemy = false;
        setPhase("clash");
    }, [plan, blueBand, redBand, seed]);

    useEffect(() => {
        if (!openingCard) return;
        const id = window.setTimeout(() => setOpeningCard(false), OPENING_CARD_MS);
        return () => window.clearTimeout(id);
    }, [openingCard]);

    // ── Playback clock ──────────────────────────────────────────────────────
    // Fractional ticks in a ref. Nothing here calls setState per frame.
    useEffect(() => {
        if (phase !== "clash" || !clash || openingCard) return;
        const total = clash.result.ticks;
        let koTick: number | null = null;
        for (let i = clash.result.events.length - 1; i >= 0; i--) {
            if (clash.result.events[i].type === "ko") { koTick = clash.result.events[i].t; break; }
        }
        let raf = 0;
        let last = 0;
        const step = (now: number) => {
            const delta = last ? Math.min(0.05, (now - last) / 1000) : 0;
            last = now;
            // Savour the final knockout, and EASE into it — never a step change.
            const nearLethal = koTick !== null
                && clockRef.current > koTick - DUEL_TPS * 0.55
                && clockRef.current < koTick + DUEL_TPS * 1.1;
            const target = reducedMotion ? 1 : nearLethal ? 0.45 : 1;
            rateRef.current += (target - rateRef.current) * (1 - Math.pow(0.02, delta));
            const scrub = effectivePlaybackRate;
            clockRef.current = Math.min(total, clockRef.current + delta * DUEL_TPS * rateRef.current * scrub);
            if (clockRef.current >= total) {
                winnerRefs.current.player = clash.winner === "blue";
                winnerRefs.current.enemy = clash.winner === "red";
                playPetSfx(clash.winner === "blue" ? "victory" : "hit");
                setPhase("interlude");
                return;
            }
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [phase, clash, openingCard, reducedMotion, effectivePlaybackRate]);

    // ── The handoff between clashes ─────────────────────────────────────────
    // Offered once, after the opening clash, and only while the match is still
    // live — there is nothing to re-form for if this clash ended it.
    const reformOpen = !spectator
        && phase === "interlude"
        && !reformSpent
        && clashIndex === 0
        && Boolean(result)
        && result!.clashes.length > 1;

    useEffect(() => {
        if (phase !== "interlude" || !result || reformOpen) return;
        const isLast = clashIndex >= result.clashes.length - 1;
        const id = window.setTimeout(() => {
            if (isLast) { setPhase("result"); return; }
            clockRef.current = 0;
            rateRef.current = 1;
            winnerRefs.current.player = false;
            winnerRefs.current.enemy = false;
            setClashIndex((i) => i + 1);
            setPhase("clash");
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
                    <p className="wfr-eyebrow">Hollow Warfront</p>
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
                <Suspense fallback={<div className="wfr-loading">Entering the ring…</div>}>
                    <PetWarfrontRiteStage3D
                        key={clash.index}
                        result={clash.result}
                        fighters={fighters}
                        clockRef={clockRef}
                        quality={quality}
                        winnerRef={winnerRefs}
                        reducedMotion={reducedMotion}
                    />
                </Suspense>
            </div>

            <ClashHud
                key={`hud-${clash.index}`}
                clash={clash}
                blueBand={blueBand}
                redBand={redBand}
                clockRef={clockRef}
                sharedImages={sharedImages}
                rounds={rounds}
            />

            {openingCard ? (
                <div className="wfr-vs-card" role="status">
                    <div className="wfr-vs-side">
                        {clash.blue.slice(0, RITE_SCOUTED_JOBS).map((c) => blueBand[c.slot]).filter(Boolean).map((pet) => (
                            <PetPortrait key={pet.id} pet={pet} sharedImages={sharedImages} size={72} />
                        ))}
                        <strong>Your revealed positions</strong>
                    </div>
                    <div className="wfr-vs-mid">
                        <span className="wfr-vs-word">CLASH {clash.index + 1}</span>
                        <span className="wfr-matchup">{clash.blue.length} v {clash.red.length}</span>
                    </div>
                    <div className="wfr-vs-side">
                        {clash.red.slice(0, RITE_SCOUTED_JOBS).map((c) => redBand[c.slot]).filter(Boolean).map((pet) => (
                            <PetPortrait key={pet.id} pet={pet} sharedImages={sharedImages} size={72} />
                        ))}
                        <strong>Their revealed positions</strong>
                    </div>
                </div>
            ) : null}

            {phase === "interlude" ? (
                reformOpen && plan ? (
                    <div className="wfr-interlude">
                        <ReformPanel
                            clash={clash}
                            band={blueBand}
                            formation={[...plan.formation]}
                            deployment={[...(plan.deployment ?? WARFRONT_DEFAULT_DEPLOYMENT)]}
                            sharedImages={sharedImages}
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
