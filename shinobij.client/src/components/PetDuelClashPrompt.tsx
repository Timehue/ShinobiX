// ─────────────────────────────────────────────────────────────────────────────
// PetDuelClashPrompt.tsx — the CLASH read.
//
// Two pets commit to the same beat, collide, and the duel stops dead. This is the
// one moment in the Coliseum where the fight waits on the player, so it is styled
// as an interruption rather than another HUD element: the arena dims, the two
// fighters are named against each other, and three calls sit under a draining
// timer.
//
// It is rock-paper-scissors, not a reflex test — the triangle is printed on the
// buttons so a first-time player can reason about the read instead of guessing:
//
//     Guard  beats  Strike     Strike  beats  Dodge     Dodge  beats  Guard
//
// Purely presentational. The bind, the timer and the payoff all live in
// pet-duel-cinematic.ts; this renders a ClashPrompt and emits the call.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";

export type PetDuelClashPromptProps = {
    /** Names for the framing line. */
    selfName: string;
    foeName: string;
    /** 0 strike · 1 guard · 2 dodge, or -1 if the call has not been made. */
    pick: number;
    /** 0..1 — how much of the answer window is left. */
    remaining: number;
    /** Live PvP: the opponent has locked a call in (never WHICH one). */
    foeCommitted?: boolean;
    /** Live PvP: there is a second human on the other side of this bind, so the
     *  copy says "waiting for them" rather than "brace for it". */
    versusPlayer?: boolean;
    compact?: boolean;
    /** Desktop only: bind 1/2/3 and ←/↓/→. */
    keyboard?: boolean;
    accent?: { base: string; glow: string };
    onPick: (pick: number) => void;
};

type Call = { label: string; glyph: string; beats: string; color: string; hint: string };

const CALLS: readonly Call[] = [
    { label: "Strike", glyph: "⚔", beats: "beats Dodge", color: "#f87171", hint: "Power through the bind" },
    { label: "Guard", glyph: "🛡", beats: "beats Strike", color: "#5eead4", hint: "Brace and turn it back" },
    { label: "Dodge", glyph: "💨", beats: "beats Guard", color: "#a78bfa", hint: "Slip out and take the angle" },
];

export function PetDuelClashPrompt({
    selfName, foeName, pick, remaining, foeCommitted = false, versusPlayer = false,
    compact = false, keyboard = false, accent, onPick,
}: PetDuelClashPromptProps) {
    const [flash, setFlash] = useState(false);
    // The slam plays once when the bind opens, not on every timer tick.
    const opened = useRef(false);
    useEffect(() => {
        if (opened.current) return;
        opened.current = true;
        setFlash(true);
        const timer = window.setTimeout(() => setFlash(false), 420);
        return () => window.clearTimeout(timer);
    }, []);

    const locked = pick >= 0;
    useEffect(() => {
        if (!keyboard || locked) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            const byDigit = ["1", "2", "3"].indexOf(e.key);
            const byArrow = ["ArrowLeft", "ArrowDown", "ArrowRight"].indexOf(e.key);
            const slot = byDigit >= 0 ? byDigit : byArrow;
            if (slot >= 0) { e.preventDefault(); onPick(slot); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [keyboard, locked, onPick]);

    const glow = accent?.glow ?? "#e9d5ff";
    const pctLeft = useMemo(() => Math.max(0, Math.min(1, remaining)) * 100, [remaining]);

    return (
        <div
            data-testid="pet-duel-clash-prompt"
            role="dialog"
            aria-label="Clash — call your read"
            style={{
                position: "absolute", inset: 0, zIndex: 40,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: compact ? 12 : 18,
                background: "radial-gradient(120% 80% at 50% 50%, rgba(2,6,18,0.42) 0%, rgba(2,6,18,0.82) 70%, rgba(2,6,18,0.93) 100%)",
                backdropFilter: "blur(1.5px)",
                pointerEvents: "auto",
                animation: "petClashIn 220ms ease-out",
            }}
        >
            <style>{`
                @keyframes petClashIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes petClashSlam {
                    0% { transform: scale(2.4) rotate(-6deg); opacity: 0; letter-spacing: 0.5em; }
                    55% { transform: scale(0.94) rotate(0deg); opacity: 1; letter-spacing: 0.16em; }
                    100% { transform: scale(1) rotate(0deg); opacity: 1; letter-spacing: 0.2em; }
                }
                @keyframes petClashPulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
                @keyframes petClashSpark { 0% { opacity: 0.95; transform: scaleX(0.2); } 100% { opacity: 0; transform: scaleX(1.35); } }
                @keyframes petClashLocked { 0% { transform: scale(1.35); opacity: 0; } 35% { transform: scale(.92); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
                .pet-clash-call { transition: transform 110ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease; }
                .pet-clash-call:active:not(:disabled) { transform: translateY(5px) scale(0.91); filter: brightness(1.5) saturate(1.3); }
                .pet-clash-call:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
                @media (prefers-reduced-motion: reduce) {
                    .pet-clash-anim, .pet-clash-call { animation: none !important; transition: none !important; }
                }
            `}</style>

            {/* The collision spark — one horizontal flare across the bind. */}
            {flash && (
                <div
                    className="pet-clash-anim"
                    aria-hidden
                    style={{
                        position: "absolute", left: 0, right: 0, top: "48%", height: 3,
                        background: `linear-gradient(90deg, transparent, ${glow}, #fff, ${glow}, transparent)`,
                        animation: "petClashSpark 420ms ease-out forwards",
                    }}
                />
            )}

            <div
                className="pet-clash-anim"
                style={{
                    fontSize: compact ? 34 : 54, fontWeight: 900, letterSpacing: "0.2em",
                    color: "#fff", textShadow: `0 0 18px ${glow}, 0 0 42px ${glow}, 0 3px 0 rgba(0,0,0,0.55)`,
                    animation: "petClashSlam 420ms cubic-bezier(.2,.9,.2,1) both",
                }}
            >
                CLASH
            </div>

            <div style={{ fontSize: compact ? 12 : 14, color: "#cbd5e1", letterSpacing: "0.08em", textAlign: "center", marginTop: -6 }}>
                <strong style={{ color: "#fff" }}>{selfName}</strong>
                <span style={{ opacity: 0.7 }}> locked against </span>
                <strong style={{ color: "#fff" }}>{foeName}</strong>
            </div>

            {/* Answer window. Drains left-to-right; when it empties your pet calls it
                on instinct (its archetype's read) rather than freezing. */}
            <div style={{ width: compact ? "78%" : 340, height: 5, borderRadius: 99, background: "rgba(148,163,184,0.25)", overflow: "hidden" }}>
                <div
                    style={{
                        width: `${pctLeft}%`, height: "100%", borderRadius: 99,
                        background: pctLeft > 45 ? glow : pctLeft > 20 ? "#fbbf24" : "#f87171",
                        transition: "width 90ms linear",
                    }}
                />
            </div>

            <div style={{ display: "flex", gap: compact ? 8 : 14, flexWrap: "nowrap", padding: "0 8px", maxWidth: "100%" }}>
                {CALLS.map((call, i) => {
                    const chosen = pick === i;
                    const dimmed = locked && !chosen;
                    return (
                        <button
                            key={call.label}
                            className="pet-clash-call"
                            type="button"
                            disabled={locked}
                            aria-pressed={chosen}
                            onClick={() => onPick(i)}
                            style={{
                                flex: "1 1 0", minWidth: 0,
                                width: compact ? 96 : 132, padding: compact ? "10px 6px" : "14px 10px",
                                borderRadius: 14, cursor: locked ? "default" : "pointer",
                                border: `2px solid ${chosen ? call.color : "rgba(148,163,184,0.4)"}`,
                                background: chosen
                                    ? `linear-gradient(180deg, ${call.color}38, rgba(4,8,18,0.9))`
                                    : "rgba(4,8,18,0.88)",
                                boxShadow: chosen ? `0 0 22px ${call.color}88` : "0 6px 18px rgba(0,0,0,0.5)",
                                opacity: dimmed ? 0.35 : 1,
                                color: "#e2e8f0",
                                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                                animation: !locked ? "petClashPulse 1.5s ease-in-out infinite" : undefined,
                                animationDelay: `${i * 0.12}s`,
                            }}
                        >
                            <span aria-hidden style={{ fontSize: compact ? 20 : 26, lineHeight: 1 }}>{call.glyph}</span>
                            <span style={{ fontWeight: 800, fontSize: compact ? 13 : 15, color: call.color, letterSpacing: "0.04em" }}>{call.label}</span>
                            <span style={{ fontSize: compact ? 9 : 10, opacity: 0.72, letterSpacing: "0.03em" }}>{call.beats}</span>
                            {!compact && <span style={{ fontSize: 9, opacity: 0.5, textAlign: "center", lineHeight: 1.25 }}>{call.hint}</span>}
                            {keyboard && !compact && (
                                <span style={{ fontSize: 9, opacity: 0.45, marginTop: 1 }}>{i + 1}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            <div style={{ fontSize: compact ? 10 : 11, color: locked ? "#5eead4" : "#94a3b8", letterSpacing: "0.06em", minHeight: 14 }}>
                {!locked ? "Read your opponent and call it"
                    : versusPlayer
                        ? (foeCommitted ? "Both calls are in — breaking…" : `Call made — waiting on ${foeName}`)
                        : "Call made — brace for it"}
            </div>

            {locked && (
                <div
                    role="status"
                    aria-live="polite"
                    style={{
                        color: CALLS[pick]?.color ?? "#fff",
                        font: `900 ${compact ? 17 : 22}px/1 var(--font-display), Inter, system-ui, sans-serif`,
                        letterSpacing: ".16em", textTransform: "uppercase",
                        textShadow: `0 0 16px ${CALLS[pick]?.color ?? glow}`,
                        animation: "petClashLocked 360ms cubic-bezier(.16,.84,.24,1) both",
                        marginTop: compact ? -6 : -10,
                    }}
                >
                    {CALLS[pick]?.label ?? "Call"} locked!
                </div>
            )}

            {/* PvP only: their call is in, but not what it was. Enough to know the
                break is coming; not enough to turn a simultaneous read into a
                reaction test. */}
            {versusPlayer && !locked && foeCommitted && (
                <div style={{ fontSize: compact ? 9 : 10, color: "#fbbf24", letterSpacing: "0.08em", marginTop: -6 }}>
                    {foeName} has committed
                </div>
            )}
        </div>
    );
}
