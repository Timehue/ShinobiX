// ─────────────────────────────────────────────────────────────────────────────
// PetDuelCommandDeck.tsx — the player's controls during a live Pet Coliseum duel
// (docs/pet-coliseum-player-control-plan.md §7).
//
// Three layers, in the order a player learns them:
//   1. STANCE     — a zero-APM strategic dial. Even a player who touches nothing
//                   else can express a plan and win or lose on it.
//   2. ORDERS     — tap a move to command it. Tapping nothing leaves the pet's own
//                   AI in charge, which is what keeps the "it's a pet" fantasy.
//   3. BOND BREAK — the earned signature. The gauge fills the button itself, so
//                   the payoff and the progress toward it are the same object, and
//                   it is the only control on screen that ever glows.
//
// Layout is a single anchored HUD bar with three zones — stance left, moves centre,
// Bond Break right — so the eye always finds the same control in the same place
// mid-fight. A phone cannot fit all three on one line, and letting them wrap cost
// 289 px of a 720 px screen, so `compact` splits them deliberately into two rows:
// plan and payoff on top, moves in the thumb arc below (167 px).
//
// Purely presentational: it renders a DuelControlSnap and emits callbacks. All
// simulation state lives in pet-duel-live.ts, so this file can be restyled freely
// without touching combat.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
import type { DuelControlSnap } from "../lib/pet-duel-cinematic";
import { BOND_FULL } from "../lib/pet-bond-meter";

export type PetDuelCommandDeckProps = {
    control: DuelControlSnap | null;
    petName: string;
    /** 0–BOND_FULL. At BOND_FULL the Bond Break button arms. */
    bond: number;
    /** The commanded pet's element colours, so the deck wears its identity. */
    accent?: { base: string; glow: string };
    compact?: boolean;
    /** Desktop only: show and bind 1–4 / Q W E / Space. */
    keyboard?: boolean;
    onAbility: (idx: number) => void;
    onBreak: () => void;
    onStance: (stance: number) => void;
    onAuto: (on: boolean) => void;
};

const STANCE_LABELS = ["Press", "Balance", "Guard"] as const;
const STANCE_HINTS = [
    "Press — close the distance and commit",
    "Balance — fight to its own judgement",
    "Guard — hold range, read the telegraph",
] as const;
const STANCE_KEYS = ["Q", "W", "E"] as const;
const STANCE_COLORS = ["#f87171", "#93c5fd", "#5eead4"] as const;
const MOVE_KEYS = ["1", "2", "3", "4", "5"] as const;

/** Button tint by move family, so the deck reads at a glance mid-fight. */
function kindColor(kind: string, support: boolean, isMove: boolean): string {
    if (isMove) return "#a78bfa";
    if (support) return "#34d399";
    if (kind === "burn" || kind === "dot" || kind === "wound") return "#fb923c";
    if (kind === "stun" || kind === "freeze" || kind === "confuse" || kind === "movelock" || kind === "slow") return "#60a5fa";
    return "#fbbf24";
}

export function PetDuelCommandDeck({
    control, petName, bond, accent, compact = false, keyboard = false,
    onAbility, onBreak, onStance, onAuto,
}: PetDuelCommandDeckProps) {
    const ready = bond >= BOND_FULL;
    // Arm exactly once per fill so the Break button pulses when it BECOMES
    // available rather than pulsing forever and turning into wallpaper.
    const [justArmed, setJustArmed] = useState(false);
    const wasReady = useRef(false);
    useEffect(() => {
        if (ready && !wasReady.current) {
            wasReady.current = true;
            setJustArmed(true);
            const timer = window.setTimeout(() => setJustArmed(false), 1700);
            return () => window.clearTimeout(timer);
        }
        if (!ready) wasReady.current = false;
    }, [ready]);

    // Keyboard bindings. Kept in a ref-free effect that re-binds on every relevant
    // change, so the handler always closes over the current control snapshot.
    const auto = !!control?.auto;
    // The signature is spent through Bond Break, so it never sits in the deck
    // competing with the meter. Memoised because the keyboard effect depends on it.
    const orderable = useMemo(
        () => control?.abilities.map((a, i) => ({ a, i })).filter(({ a }) => !a.signature) ?? [],
        [control?.abilities],
    );
    useEffect(() => {
        if (!keyboard || !control || auto) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            const key = e.key.toUpperCase();
            const stance = STANCE_KEYS.indexOf(key as typeof STANCE_KEYS[number]);
            if (stance >= 0) { e.preventDefault(); onStance(stance); return; }
            if (key === " " || e.code === "Space") {
                if (ready && !control.breakPending) { e.preventDefault(); onBreak(); }
                return;
            }
            if (key === "0") { e.preventDefault(); onAbility(-1); return; }
            const slot = MOVE_KEYS.indexOf(e.key as typeof MOVE_KEYS[number]);
            if (slot === 0) { e.preventDefault(); onAbility(-1); return; }          // 1 = basic
            if (slot > 0 && orderable[slot - 1]) { e.preventDefault(); onAbility(orderable[slot - 1].i); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [keyboard, control, auto, ready, orderable, onAbility, onBreak, onStance]);

    if (!control) return null;
    const glow = accent?.glow ?? "#e9d5ff";
    const breakPending = control.breakPending;
    const hasSignature = control.abilities.some((a) => a.signature);
    const bondPct = Math.max(0, Math.min(100, (bond / BOND_FULL) * 100));
    const staminaPct = Math.max(0, Math.min(100, control.stamina));
    const hpPct = control.maxHp > 0 ? Math.max(0, Math.min(100, (control.hp / control.maxHp) * 100)) : 0;
    const orderedName = control.orderedIdx === -1
        ? "Strike"
        : control.orderedIdx >= 0
            ? control.abilities[control.orderedIdx]?.name ?? "Technique"
            : null;

    return (
        <div
            data-testid="pet-duel-command-deck"
            style={{
                position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 14,
                display: "flex", flexDirection: "column", alignItems: "center",
                padding: compact ? "10px 8px 10px" : "12px clamp(12px,3vw,30px) 14px",
                background: "linear-gradient(transparent, rgba(2,5,14,0.5) 30%, rgba(2,5,14,0.86) 100%)",
                pointerEvents: "none",
            }}
        >
            <style>{`
                @keyframes petDeckArm { 0%,100% { transform: scale(1); } 45% { transform: scale(1.07); } }
                @keyframes petDeckOrdered { 0%,100% { opacity: 1; } 50% { opacity: 0.62; } }
                @keyframes petDeckHeld { 0%,100% { opacity: 0.9; } 50% { opacity: 0.66; } }
                @keyframes petDeckSheen { 0% { transform: translateX(-120%); } 100% { transform: translateX(240%); } }
                .pet-deck { pointer-events: auto; }
                .pet-deck button { transition: transform 90ms ease, border-color 140ms ease, background 140ms ease, box-shadow 160ms ease, filter 90ms ease; }
                .pet-deck button:active:not(:disabled) { transform: translateY(4px) scale(0.93); filter: brightness(1.42) saturate(1.25); box-shadow: inset 0 3px 10px rgba(0,0,0,.68) !important; }
                .pet-deck button:disabled { cursor: default; }
                .pet-deck button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
                @media (prefers-reduced-motion: reduce) {
                    .pet-deck button, .pet-deck .pet-deck-anim { animation: none !important; transition: none !important; }
                }
            `}</style>

            {/* Vitals strip — HP and stamina for the pet you are commanding, so the
                two numbers that gate every decision sit with the controls. */}
            <div className="pet-deck" style={{ width: compact ? "100%" : "min(560px,92%)", display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Gauge label="Vigour" pct={hpPct} color={hpPct > 45 ? "#4ade80" : hpPct > 20 ? "#fbbf24" : "#f87171"} height={6} />
                <Gauge label="Stamina" pct={staminaPct} color="#22d3ee" height={6} />
            </div>
            <div
                className="pet-deck"
                role="status"
                aria-live="polite"
                style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    minHeight: 20, marginBottom: 7, padding: "4px 11px", borderRadius: 999,
                    background: auto ? "rgba(250,204,21,.1)" : orderedName ? `${glow}16` : "rgba(15,23,42,.68)",
                    border: `1px solid ${auto ? "rgba(250,204,21,.45)" : orderedName ? `${glow}66` : "rgba(148,163,184,.22)"}`,
                    color: auto ? "#fde68a" : orderedName ? "#f8fafc" : "#94a3b8",
                    font: "800 9px/1 Inter,system-ui,sans-serif", letterSpacing: ".1em", textTransform: "uppercase",
                    boxShadow: orderedName && !auto ? `0 0 16px ${glow}22` : undefined,
                }}
            >
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: 99, background: auto ? "#facc15" : orderedName ? glow : "#64748b", boxShadow: orderedName ? `0 0 8px ${glow}` : undefined }} />
                <span>{auto ? "Instinct mode" : "Command link"}</span>
                <span style={{ opacity: .55 }}>·</span>
                <strong style={{ color: "inherit", maxWidth: compact ? 170 : 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {auto
                        ? `${petName} decides`
                        : orderedName
                            ? `${petName}: ${orderedName} locked`
                            : compact
                                ? `${petName}: awaiting order`
                                : `${petName} awaits your order`}
                </strong>
            </div>

            {/* Desktop puts all three zones on one line. A phone cannot fit them
                without wrapping into a four-row wall that eats 40% of the screen, so
                compact splits deliberately: plan + payoff on top, moves in the thumb
                arc underneath. */}
            <div
                className="pet-deck"
                style={{
                    display: "flex",
                    flexDirection: compact ? "column" : "row",
                    alignItems: compact ? "center" : "flex-end",
                    justifyContent: "center",
                    gap: compact ? 7 : 14, flexWrap: compact ? "nowrap" : "wrap", maxWidth: "100%",
                }}
            >
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: compact ? 7 : 14, order: compact ? 1 : 0 }}>
                {/* ── Zone 1: stance, a segmented control ───────────────────── */}
                <div
                    role="group"
                    aria-label="Stance"
                    style={{
                        display: "flex", borderRadius: 12, overflow: "hidden",
                        border: "1px solid rgba(148,163,184,0.36)", background: "rgba(4,8,18,0.86)",
                        opacity: auto ? 0.45 : 1,
                    }}
                >
                    {STANCE_LABELS.map((label, i) => {
                        const active = !auto && control.stance === i;
                        return (
                            <button
                                key={label}
                                type="button"
                                aria-pressed={active}
                                title={STANCE_HINTS[i] + (keyboard ? ` (${STANCE_KEYS[i]})` : "")}
                                disabled={auto}
                                onClick={() => onStance(i)}
                                style={{
                                    minWidth: compact ? 46 : 72, minHeight: 44,
                                    padding: compact ? "6px 4px" : "6px 10px", border: "none",
                                    borderRight: i < 2 ? "1px solid rgba(148,163,184,0.24)" : undefined,
                                    background: active ? `${STANCE_COLORS[i]}2e` : "transparent",
                                    color: active ? STANCE_COLORS[i] : "#94a3b8",
                                    font: `800 ${compact ? 10 : 11}px/1.15 var(--font-display), Inter, system-ui, sans-serif`,
                                    letterSpacing: compact ? "0.02em" : "0.07em", textTransform: "uppercase",
                                    whiteSpace: "nowrap",
                                    boxShadow: active ? `inset 0 -2px 0 ${STANCE_COLORS[i]}` : undefined,
                                    cursor: auto ? "default" : "pointer",
                                }}
                            >
                                {label}
                                {keyboard && <span style={{ display: "block", marginTop: 2, font: "700 8px/1 Inter, system-ui, sans-serif", opacity: 0.6 }}>{STANCE_KEYS[i]}</span>}
                            </button>
                        );
                    })}
                </div>

                {/* On a phone the payoff sits beside the plan on the top row; on
                    desktop it stays on the right of the single line. */}
                {compact && <BreakZone compact={compact} auto={auto} ready={ready} breakPending={breakPending}
                    bondPct={bondPct} glow={glow} accentBase={accent?.base} hasSignature={hasSignature}
                    keyboard={keyboard} justArmed={justArmed} onBreak={onBreak} onAuto={onAuto} />}
                </div>

                {/* ── Zone 2: the moves ─────────────────────────────────────── */}
                <div role="group" aria-label="Moves" style={{ display: "flex", alignItems: "flex-end", gap: compact ? 4 : 7, flexWrap: "wrap", justifyContent: "center", order: compact ? 2 : 0 }}>
                    <MoveButton
                        label="Strike"
                        sub="basic"
                        hint={keyboard ? "1" : undefined}
                        color="#e2e8f0"
                        compact={compact}
                        disabled={auto}
                        ordered={!auto && control.orderedIdx === -1}
                        onClick={() => onAbility(-1)}
                    />
                    {orderable.map(({ a, i }, slot) => {
                        const onCd = a.cdLeft > 0;
                        const lowStam = control.stamina < a.cost;
                        // A standing order that cannot fire yet is HELD, not dropped —
                        // the engine keeps poking with basics and unleashes it the moment
                        // it comes up (pet-duel-cinematic commandedOffensive). Say so, so a
                        // tap on a charging move reads as "locked in, waiting" instead of
                        // "ignored — nothing happened".
                        const isOrdered = !auto && control.orderedIdx === i;
                        const waiting = isOrdered ? (onCd ? "queued" : lowStam ? "low stam" : null) : null;
                        return (
                            <MoveButton
                                key={`${a.name}-${i}`}
                                label={a.name}
                                sub={a.isMove ? "reposition" : a.support ? "support" : `${a.cost} stam`}
                                hint={keyboard ? MOVE_KEYS[slot + 1] : undefined}
                                color={kindColor(a.kind, a.support, a.isMove)}
                                compact={compact}
                                disabled={auto}
                                dim={onCd || lowStam}
                                cooldown={a.cdTicks > 0 ? a.cdLeft / a.cdTicks : 0}
                                ordered={isOrdered}
                                waiting={waiting}
                                onClick={() => onAbility(i)}
                            />
                        );
                    })}
                </div>

                {/* ── Zone 3: Bond Break (the gauge IS the button) + Auto ────── */}
                {!compact && <BreakZone compact={compact} auto={auto} ready={ready} breakPending={breakPending}
                    bondPct={bondPct} glow={glow} accentBase={accent?.base} hasSignature={hasSignature}
                    keyboard={keyboard} justArmed={justArmed} onBreak={onBreak} onAuto={onAuto} />}
            </div>
        </div>
    );
}


/** Bond Break plus the Auto toggle. Its own component because the two layouts
 *  place it in different rows — desktop on the right of the single bar, compact
 *  beside the stance dial on the top row — and duplicating the markup to do that
 *  would be two things to keep in sync. */
function BreakZone({ compact, auto, ready, breakPending, bondPct, glow, accentBase, hasSignature, keyboard, justArmed, onBreak, onAuto }: {
    compact: boolean; auto: boolean; ready: boolean; breakPending: boolean;
    bondPct: number; glow: string; accentBase?: string; hasSignature: boolean;
    keyboard: boolean; justArmed: boolean; onBreak: () => void; onAuto: (on: boolean) => void;
}) {
    return (
        <div style={{ display: "flex", alignItems: "flex-end", gap: compact ? 6 : 8 }}>
            {hasSignature && (
                <button
                    type="button"
                    data-testid="pet-duel-bond-break"
                    aria-label={`Bond Break, ${Math.round(bondPct)} percent charged`}
                    title={ready ? `Unleash the signature${keyboard ? " (Space)" : ""}` : `Bond ${Math.round(bondPct)}% — land hits and dodges to charge`}
                    disabled={auto || !ready || breakPending}
                    onClick={onBreak}
                    style={{
                        position: "relative", overflow: "hidden",
                        minWidth: compact ? 82 : 118, minHeight: 62,
                        padding: compact ? "8px 7px" : "8px 12px", borderRadius: 14,
                        border: `2px solid ${ready ? "#fbbf24" : "rgba(148,163,184,0.34)"}`,
                        background: "rgba(4,8,18,0.9)",
                        color: ready ? "#fff7e6" : "#7c8798",
                        font: `900 ${compact ? 11 : 12}px/1.15 var(--font-display), Inter, system-ui, sans-serif`,
                        letterSpacing: compact ? "0.04em" : "0.07em", textTransform: "uppercase",
                        whiteSpace: "nowrap",
                        boxShadow: ready ? `0 0 26px ${glow}66, inset 0 0 18px rgba(245,158,11,0.25)` : undefined,
                        cursor: ready && !auto ? "pointer" : "default",
                        opacity: auto ? 0.45 : 1,
                        animation: justArmed ? "petDeckArm 700ms ease-out 2" : undefined,
                    }}
                >
                    {/* The charge rises INSIDE the button: progress and payoff
                        are one object, so there is no separate bar to read. */}
                    <span aria-hidden="true" style={{
                        position: "absolute", left: 0, right: 0, bottom: 0, height: `${bondPct}%`,
                        background: ready
                            ? "linear-gradient(0deg,#b45309,#f59e0b)"
                            : `linear-gradient(0deg, ${accentBase ?? "#6366f1"}, ${glow}55)`,
                        opacity: ready ? 0.92 : 0.42,
                        transition: "height 200ms linear",
                        pointerEvents: "none",
                    }} />
                    {ready && (
                        <span aria-hidden="true" className="pet-deck-anim" style={{
                            position: "absolute", top: 0, bottom: 0, width: "38%",
                            background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.32),transparent)",
                            animation: "petDeckSheen 1900ms linear infinite", pointerEvents: "none",
                        }} />
                    )}
                    {/* A phone cannot spare the ~45 px the full name costs on
                        the top row, and the gauge already says what it is. */}
                    <span style={{ position: "relative", display: "block" }}>
                        {breakPending ? (compact ? "Unleash" : "Unleashing") : compact ? "Break" : "Bond Break"}
                    </span>
                    <span style={{ position: "relative", display: "block", marginTop: 3, font: "800 9px/1 Inter, system-ui, sans-serif", letterSpacing: "0.1em", opacity: 0.85 }}>
                        {breakPending ? "…" : ready ? (keyboard ? "READY · SPACE" : "READY") : `${Math.round(bondPct)}%`}
                    </span>
                </button>
            )}
            <button
                type="button"
                aria-pressed={auto}
                onClick={() => onAuto(!auto)}
                title={auto ? "Take back control of your pet" : "Let your pet fight on its own"}
                style={{
                    minWidth: compact ? 52 : 62, minHeight: 44, padding: compact ? "6px 6px" : "6px 10px", borderRadius: 12,
                    border: `1px solid ${auto ? "#facc15" : "rgba(148,163,184,0.36)"}`,
                    background: auto ? "rgba(250,204,21,0.16)" : "rgba(4,8,18,0.86)",
                    color: auto ? "#facc15" : "#94a3b8",
                    font: `800 ${compact ? 10 : 11}px/1.15 var(--font-display), Inter, system-ui, sans-serif`,
                    letterSpacing: compact ? "0.02em" : "0.07em", textTransform: "uppercase", cursor: "pointer",
                }}
            >
                Auto
                <span style={{ display: "block", marginTop: 2, font: "700 8px/1 Inter, system-ui, sans-serif", opacity: 0.75 }}>{auto ? "ON" : "OFF"}</span>
            </button>
        </div>
    );
}

function Gauge({ label, pct, color, height }: { label: string; pct: number; color: string; height: number }) {
    return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ font: "800 8px/1 Inter, system-ui, sans-serif", letterSpacing: "0.12em", color: "#64748b", textTransform: "uppercase", minWidth: 44, textAlign: "right" }}>{label}</span>
            <div
                role="progressbar"
                aria-label={label}
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{ flex: 1, height, borderRadius: 999, background: "rgba(2,6,23,0.85)", border: "1px solid rgba(148,163,184,0.22)", overflow: "hidden" }}
            >
                <div style={{ width: `${pct}%`, height: "100%", background: color, opacity: 0.85, transition: "width 140ms linear" }} />
            </div>
        </div>
    );
}

function MoveButton({ label, sub, hint, color, compact, disabled, dim = false, cooldown = 0, ordered, waiting = null, onClick }: {
    label: string; sub: string; hint?: string; color: string; compact: boolean;
    disabled: boolean; dim?: boolean; cooldown?: number; ordered: boolean; waiting?: string | null; onClick: () => void;
}) {
    // An ordered move that is still charging keeps the "you locked this in" identity
    // (border + glow) but swaps the pulse for a slower breathe and says WHY it hasn't
    // fired, so the deck never looks unresponsive while the pet poks with basics.
    const held = ordered && !!waiting;
    return (
        <button
            type="button"
            aria-pressed={ordered}
            aria-label={`${label} — ${sub}${ordered ? (waiting ? `, ordered, ${waiting}` : ", ordered") : ""}`}
            disabled={disabled}
            onClick={onClick}
            title={`${label} · ${sub}${hint ? ` (${hint})` : ""}`}
            style={{
                position: "relative", overflow: "hidden",
                // Compact must fit a basic plus up to four moves across 390 px.
                minWidth: compact ? 60 : 92, minHeight: 62, maxWidth: compact ? 68 : 132,
                flex: compact ? "0 1 auto" : undefined,
                padding: compact ? "7px 5px" : "7px 9px", borderRadius: 12,
                border: `1px solid ${ordered ? color : "rgba(148,163,184,0.36)"}`,
                background: ordered ? `${color}2e` : "rgba(4,8,18,0.86)",
                color: dim && !ordered ? "#64748b" : "#e8eef7",
                font: "800 11px/1.2 Inter, system-ui, sans-serif",
                textAlign: "center", cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.45 : 1,
                boxShadow: ordered ? `0 0 16px ${color}59, inset 0 -2px 0 ${color}` : undefined,
                animation: ordered ? (held ? "petDeckHeld 1300ms ease-in-out infinite" : "petDeckOrdered 950ms ease-in-out infinite") : undefined,
            }}
        >
            {/* Cooldown wipe — drains downward as the move comes back. */}
            {cooldown > 0 && (
                <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: `${Math.min(100, cooldown * 100)}%`, background: "rgba(2,6,23,0.74)", pointerEvents: "none", transition: "height 120ms linear" }} />
            )}
            {hint && (
                <span aria-hidden="true" style={{ position: "absolute", top: 3, left: 5, font: "800 8px/1 Inter, system-ui, sans-serif", color: "#64748b" }}>{hint}</span>
            )}
            <span style={{ position: "relative", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{label}</span>
            <span style={{ position: "relative", display: "block", marginTop: 4, font: "800 9px/1 Inter, system-ui, sans-serif", letterSpacing: "0.06em", color: held ? "#fbbf24" : ordered ? color : dim ? "#475569" : "#8b98ab", textTransform: "uppercase" }}>
                {held ? waiting : ordered ? "ordered" : sub}
            </span>
        </button>
    );
}
