/*
 * Hollow Warfront — the Rite.
 *
 * FOUR PETS A SIDE, ALL FIGHTING AT ONCE, best of three clashes. You set the
 * FORMATION — which pets hold the front line and which stay back — and the
 * clash resolves on the shipped cinematic engine with every fighter live.
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
    RITE_FRONT_SLOTS,
    RITE_MAX_CLASHES,
    aiRitePlan,
    riteBandProblem,
    runWarfrontRite,
    type RiteClash,
    type RiteCombatant,
    type RitePlan,
    type RiteResult,
} from "../lib/pet-warfront-rite";
import { petBattleSprite } from "../lib/pet-battle-anim";
import { petVisualQuality } from "../lib/pet-visual-quality";
import { playPetSfx, primePetSfx } from "../lib/pet-sfx";
import { startBattleMusic, stopBattleMusic } from "../lib/pet-music";
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
    reformAfterClash: null,
    reform: null,
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
     * spectator takes no decisions at all: no formation panel, no re-form, and
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

function DeployPanel({ band, enemyBand, enemyFormation, sharedImages, onBegin, onExit }: {
    band: Pet[];
    enemyBand: Pet[];
    enemyFormation: number[];
    sharedImages: Record<string, string>;
    onBegin: (plan: RitePlan) => void;
    onExit: () => void;
}) {
    const [formation, setFormation] = useState<number[]>(() => band.map((_, i) => i));
    const problem = useMemo(() => riteBandProblem(band), [band]);

    const move = (from: number, delta: number) => {
        const to = from + delta;
        if (to < 0 || to >= formation.length) return;
        setFormation((current) => {
            const next = [...current];
            [next[from], next[to]] = [next[to], next[from]];
            return next;
        });
    };

    const enemyFront = enemyFormation.slice(0, RITE_FRONT_SLOTS).map((slot) => enemyBand[slot]).filter(Boolean);

    return (
        <div className="wfr-deploy">
            <header className="wfr-deploy-head">
                <p className="wfr-eyebrow">Hollow Warfront</p>
                <h2>Set your formation</h2>
                <p className="wfr-deploy-copy">
                    All four pets fight at once. <strong>Your front line meets them first</strong> and takes the
                    opening. Best of {RITE_MAX_CLASHES} clashes — first to {RITE_CLASHES_TO_WIN} takes the Rite.
                </p>
            </header>

            <section className="wfr-scout" aria-label="Enemy front line">
                <h3>They hold the front with</h3>
                <div className="wfr-scout-body">
                    {enemyFront.map((pet) => (
                        <span key={pet.id} className="wfr-scout-pet">
                            <PetPortrait pet={pet} sharedImages={sharedImages} size={54} />
                            <span className="wfr-el" style={{ color: elColor(pet.element) }}>{pet.element ?? "None"}</span>
                        </span>
                    ))}
                </div>
                <p className="wfr-scout-note">Their back line is sealed. Answer the front, or go around it.</p>
            </section>

            <ol className="wfr-order" aria-label="Your formation">
                {formation.map((petIndex, lane) => {
                    const pet = band[petIndex];
                    const front = lane < RITE_FRONT_SLOTS;
                    return (
                        <li key={pet.id} className={front ? "is-lead" : undefined}>
                            <span className="wfr-slot-no">{front ? "FRONT" : "BACK"}</span>
                            <PetPortrait pet={pet} sharedImages={sharedImages} />
                            <div className="wfr-order-id">
                                <strong>{pet.name}</strong>
                                <span className="wfr-el" style={{ color: elColor(pet.element) }}>{pet.element ?? "None"}</span>
                            </div>
                            <span className="wfr-order-moves">
                                <button type="button" onClick={() => move(lane, -1)} disabled={lane === 0} aria-label={`Move ${pet.name} forward`}>▲</button>
                                <button type="button" onClick={() => move(lane, 1)} disabled={lane === formation.length - 1} aria-label={`Move ${pet.name} back`}>▼</button>
                            </span>
                        </li>
                    );
                })}
            </ol>

            <p className="wfr-formation-hint">
                The front line absorbs the opening and draws focus. A Defender there holds; a Sage there dies —
                but a Sage that survives the front is a Sage the enemy never reached.
            </p>

            {problem ? <p className="wfr-problem" role="alert">{problem}</p> : null}

            <div className="wfr-deploy-actions">
                <button type="button" className="wfr-btn-ghost" onClick={onExit}>Withdraw</button>
                <button
                    type="button"
                    className="wfr-btn-primary"
                    disabled={Boolean(problem)}
                    onClick={() => onBegin({ formation, reformAfterClash: null, reform: null })}
                >
                    Begin the Rite
                </button>
            </div>
        </div>
    );
}

// ── Live HUD ────────────────────────────────────────────────────────────────

/**
 * Eight health bars and the clock, driven by ONE rAF that writes straight to the
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
                return (
                    <li key={`${team}-${c.lane}`} className={c.lane < RITE_FRONT_SLOTS ? "is-front" : undefined}>
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
                <span className="wfr-duel-no">CLASH {clash.index + 1}</span>
                <span className="wfr-rounds" aria-label="Clashes won">
                    <b>{rounds.blue}</b><i>—</i><b>{rounds.red}</b>
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
    // whether their formation needs changing.
    const survivors = clash.blue
        .filter((c) => c.exitHp > 0)
        .map((c) => ({ pet: blueBand[c.slot], hp: c.exitHp }))
        .filter((entry) => Boolean(entry.pet));
    const won = clash.winner === "blue";
    return (
        <div className="wfr-interlude">
            <div className="wfr-interlude-victor">
                <p className="wfr-eyebrow">Clash {clash.index + 1}</p>
                <h3 className={won ? "is-win" : clash.winner === "red" ? "is-loss" : undefined}>
                    {clash.winner === null ? "The clash is drawn" : won ? "The ring is yours" : "They hold the ring"}
                </h3>
                <p>{clash.blueStanding} standing &middot; {clash.redStanding} of theirs</p>
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
 * same seed and the same opening formation reproduces clash one byte for byte —
 * pinned by a test — so the player sees exactly the fight they already watched,
 * and only what follows changes.
 */
function ReformPanel({ clash, band, formation, sharedImages, onCommit }: {
    clash: RiteClash;
    band: Pet[];
    formation: number[];
    sharedImages: Record<string, string>;
    onCommit: (next: number[] | null) => void;
}) {
    const [next, setNext] = useState<number[]>(() => [...formation]);
    const panelRef = useRef<HTMLDivElement>(null);
    // This dialog HALTS the match until it is answered, so it has to behave like
    // one: it takes focus on open (a keyboard user would otherwise be stranded
    // tabbing a dimmed HUD behind it), and Escape holds the line rather than
    // trapping anyone who does not want to change anything.
    useEffect(() => {
        panelRef.current?.focus();
    }, []);
    const move = (from: number, delta: number) => {
        const to = from + delta;
        if (to < 0 || to >= next.length) return;
        setNext((current) => {
            const copy = [...current];
            [copy[from], copy[to]] = [copy[to], copy[from]];
            return copy;
        });
    };
    const changed = next.some((slot, i) => slot !== formation[i]);
    const healthOf = (slot: number) => clash.blue.find((c) => c.slot === slot)?.exitHp ?? 0;

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
            <h3>Change your line?</h3>
            <p className="wfr-reform-copy">
                Your band regroups before the next clash. Move a pet forward or back — or hold the line you
                already committed.
            </p>
            <ol className="wfr-order" aria-label="Re-formed line">
                {next.map((slot, lane) => {
                    const pet = band[slot];
                    if (!pet) return null;
                    const front = lane < RITE_FRONT_SLOTS;
                    const hp = healthOf(slot);
                    return (
                        <li key={pet.id} className={front ? "is-lead" : undefined}>
                            <span className="wfr-slot-no">{front ? "FRONT" : "BACK"}</span>
                            <PetPortrait pet={pet} sharedImages={sharedImages} size={40} />
                            <div className="wfr-order-id">
                                <strong>{pet.name}</strong>
                                <EntryPip hp={hp} />
                            </div>
                            <span className="wfr-order-moves">
                                <button type="button" onClick={() => move(lane, -1)} disabled={lane === 0} aria-label={`Move ${pet.name} forward`}>▲</button>
                                <button type="button" onClick={() => move(lane, 1)} disabled={lane === next.length - 1} aria-label={`Move ${pet.name} back`}>▼</button>
                            </span>
                        </li>
                    );
                })}
            </ol>
            <div className="wfr-deploy-actions">
                <button type="button" className="wfr-btn-ghost" onClick={() => onCommit(null)}>Hold the line</button>
                <button type="button" className="wfr-btn-primary" disabled={!changed} onClick={() => onCommit(next)}>
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
    spectator = false, playbackRate = 1,
}: PetWarfrontRiteProps) {
    const blueBand = useMemo(() => blue.slice(0, RITE_BAND_SIZE).map((slot) => slot.pet), [blue]);
    const redBand = useMemo(() => red.slice(0, RITE_BAND_SIZE).map((slot) => slot.pet), [red]);
    const quality = useMemo(() => petVisualQuality(), []);
    const reducedMotion = useMemo(
        () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
        [],
    );

    // Their FRONT LINE is public; the back line is not. That reveal is what
    // turns the opening formation from a guess into a read.
    const enemyFormation = useMemo(() => aiRitePlan(redBand, seed).formation, [redBand, seed]);

    // A spectator starts mid-match on the default formation — there is no
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
     * opening formation. The player never sees the fight they just watched
     * change underneath them.
     */
    const commitReform = useCallback((next: number[] | null) => {
        setReformSpent(true);
        if (!next || !plan) {
            setClashIndex((i) => i + 1);
            clockRef.current = 0;
            rateRef.current = 1;
            winnerRefs.current.player = false;
            winnerRefs.current.enemy = false;
            setPhase("clash");
            return;
        }
        const nextPlan: RitePlan = { ...plan, reformAfterClash: 0, reform: next };
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
            const scrub = Math.max(0.1, Math.min(30, playbackRate));
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
    }, [phase, clash, openingCard, reducedMotion, playbackRate]);

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
                    enemyFormation={enemyFormation}
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
                        {clash.blue.slice(0, RITE_FRONT_SLOTS).map((c) => blueBand[c.slot]).filter(Boolean).map((pet) => (
                            <PetPortrait key={pet.id} pet={pet} sharedImages={sharedImages} size={72} />
                        ))}
                        <strong>Your front</strong>
                    </div>
                    <div className="wfr-vs-mid">
                        <span className="wfr-vs-word">CLASH {clash.index + 1}</span>
                        <span className="wfr-matchup">{clash.blue.length} v {clash.red.length}</span>
                    </div>
                    <div className="wfr-vs-side">
                        {clash.red.slice(0, RITE_FRONT_SLOTS).map((c) => redBand[c.slot]).filter(Boolean).map((pet) => (
                            <PetPortrait key={pet.id} pet={pet} sharedImages={sharedImages} size={72} />
                        ))}
                        <strong>Their front</strong>
                    </div>
                </div>
            ) : null}

            {phase === "interlude" ? (
                reformOpen && plan ? (
                    <div className="wfr-interlude">
                        <ReformPanel
                            clash={clash}
                            band={blueBand}
                            formation={plan.formation}
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
