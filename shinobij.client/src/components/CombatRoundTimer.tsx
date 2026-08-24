/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, type CSSProperties } from "react";
import { PVP_TURN_SECONDS, pvpTurnRemainingSeconds } from "../../../shared/pvp-turn";
import { serverNow } from "../lib/server-clock";

/** How long an un-started match waits before the timer admits it may not start. */
export const WAITING_HINT_MS = 30_000;

/**
 * Isolated per-turn countdown for the battle screens (PvP + PvE arena).
 *
 * The default length is the SHARED `PVP_TURN_SECONDS` (shared/pvp-turn.ts),
 * which the server also reads to enforce the deadline itself
 * (api/pvp/_turn-deadline.ts). This countdown is a courtesy display plus a
 * self-report (`onExpire` → `wait` with `auto: true`); it is NOT the
 * authority — a closed tab's turn lapses server-side regardless.
 *
 * It owns its own 1-second tick, so the decrement re-renders ONLY this small
 * element instead of the battle screen's ~120-tile hex board. Previously the
 * countdown lived in each battle screen's own state, so every tick rebuilt the
 * whole board (all the per-render tile sets + 120 tile nodes) once per second —
 * the dominant cause of continuous combat stutter on mobile.
 *
 * ## Two modes
 *
 * **Local (default, no `anchor` prop)** — the original behaviour, still used by
 * the PvE arena, whose transport has no shared turn stamp:
 *   • starts at `seconds` (default 45),
 *   • resets to full whenever `active` flips true or `resetSignal` changes
 *     (turn start / action taken — the screens bump a key on each action),
 *   • holds frozen at full while inactive (not the player's turn / prefight),
 *   • fires `onExpire` exactly once when it reaches 0 (the screen's auto-pass).
 *
 * **Server-anchored (`anchor={{ turnStartedAt }}`)** — used by PvP, where a
 * server deadline can actually pass the turn. The countdown is derived from the
 * session's `turnStartedAt` on the SERVER's clock instead of from when this
 * component happened to mount, which fixes three real regressions:
 *   • a refresh mid-turn used to remount at a full 45 and get auto-passed
 *     seconds later, because the server was still measuring the real turn;
 *   • a backgrounded tab's throttled interval used to drift arbitrarily far
 *     behind — an absolute anchor simply lands on the true value on resume;
 *   • `turnStartedAt` being absent (the second fighter has not been seated yet,
 *     so the server has not started any clock) renders a waiting state instead
 *     of counting an imaginary turn down to a stuck 0.
 * In this mode the ring hits zero at `PVP_TURN_MS`, which is
 * `PVP_TURN_CLIENT_LEAD_MS` + the grace ahead of the server's own deadline, so
 * the client's polite `auto: true` wait is structurally always first.
 *
 * `onExpire` is read through a ref so a changing callback identity never
 * re-arms the interval (which would otherwise restart the countdown).
 */
export function CombatRoundTimer({
    active,
    resetSignal,
    seconds = PVP_TURN_SECONDS,
    onExpire,
    anchor,
    opponentName,
}: {
    active: boolean;
    resetSignal: number;
    seconds?: number;
    onExpire: () => void;
    /** Who the waiting state is waiting FOR. Falls back to "your opponent". */
    opponentName?: string;
    /**
     * Opt in to the server-anchored countdown. Pass the session's
     * `turnStartedAt` — `undefined` when the server has not started a clock yet
     * (e.g. P1 is on the board but P2 has not joined), which renders a waiting
     * state rather than a countdown. Omit the whole prop for the local mode.
     */
    anchor?: { turnStartedAt: number | undefined };
}) {
    const anchored = anchor !== undefined;
    const anchorStartedAt = anchor?.turnStartedAt;
    const [remaining, setRemaining] = useState(() => (
        anchored && active && anchorStartedAt !== undefined
            ? pvpTurnRemainingSeconds(anchorStartedAt, serverNow(), seconds)
            : seconds
    ));
    // Keep the latest onExpire in a ref (synced after each commit) so a changing
    // callback identity never re-arms the interval — which would restart the
    // countdown on every parent render.
    const onExpireRef = useRef(onExpire);
    useEffect(() => { onExpireRef.current = onExpire; });

    // An open-ended wait with no subject and no bound is the worst state this
    // component can show: the player cannot tell a stalled match from a slow
    // one, and does not know whether leaving forfeits. After WAITING_HINT_MS
    // the wait says so, and says leaving is safe.
    const waiting = anchored && active && anchorStartedAt === undefined;
    const [waitedLong, setWaitedLong] = useState(false);
    useEffect(() => {
        if (!waiting) { setWaitedLong(false); return; }
        setWaitedLong(false);
        const t = window.setTimeout(() => setWaitedLong(true), WAITING_HINT_MS);
        return () => window.clearTimeout(t);
    }, [waiting, resetSignal]);

    // ── Local mode ───────────────────────────────────────────────────────────
    useEffect(() => {
        if (anchored) return;
        if (!active) { setRemaining(seconds); return; }
        let secs = seconds;
        setRemaining(secs);
        const iv = window.setInterval(() => {
            secs -= 1;
            setRemaining(secs);
            if (secs <= 0) { window.clearInterval(iv); onExpireRef.current(); }
        }, 1000);
        return () => window.clearInterval(iv);
    }, [anchored, active, resetSignal, seconds]);

    // ── Server-anchored mode ─────────────────────────────────────────────────
    useEffect(() => {
        if (!anchored) return;
        if (!active || anchorStartedAt === undefined) { setRemaining(seconds); return; }
        let fired = false;
        const tick = () => {
            const next = pvpTurnRemainingSeconds(anchorStartedAt, serverNow(), seconds);
            setRemaining(next);
            if (next <= 0 && !fired) { fired = true; onExpireRef.current(); }
        };
        tick();
        const iv = window.setInterval(tick, 1000);
        // A background tab throttles the interval; recompute the instant it is
        // shown again so the ring never displays a stale (too generous) number.
        const onVisible = () => { if (document.visibilityState === "visible") tick(); };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            window.clearInterval(iv);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [anchored, active, anchorStartedAt, resetSignal, seconds]);

    // The server has not started a clock for this fight yet — say so instead of
    // showing a countdown that would run to a stuck 0 and queue a `wait` the
    // server rejects with "Waiting for both fighters to join".
    if (waiting) {
        const who = opponentName?.trim() || "your opponent";
        return (
            <div className="round-timer-display round-timer-inactive" role="timer" aria-label={`Waiting for ${who} to join the match`}>
                {/* One glyph for "no number here": the sibling inactive rings in
                    the battle screens use an em dash, and the digit slot is
                    styled for digits, so an ellipsis sat wrong in it. */}
                <div className="round-timer-ring" style={{ "--rt-pct": "100%" } as CSSProperties}>
                    <span className="round-timer-num">—</span>
                </div>
                <small aria-live="polite">
                    {waitedLong
                        ? `${who} hasn't joined. You can leave — the match will resolve on its own.`
                        : `Waiting for ${who}`}
                </small>
            </div>
        );
    }

    return (
        <div
            className={`round-timer-display${remaining <= 10 ? " round-timer-urgent" : ""}`}
            role="timer"
            aria-label={`Turn timer — ${remaining} second${remaining === 1 ? "" : "s"} left`}
        >
            <div className="round-timer-ring" style={{ "--rt-pct": `${(remaining / seconds) * 100}%` } as CSSProperties}>
                <span className="round-timer-num">{remaining}</span>
            </div>
            <small>Turn timer</small>
            {/* Urgency was colour + animation only, which is invisible to a
                screen reader. This live region carries it without touching the
                visible layout, and its text changes exactly ONCE — at the
                threshold — rather than once per second. */}
            <span className="round-timer-sr" aria-live="polite">
                {remaining <= 10 ? "Under ten seconds left in your turn" : ""}
            </span>
        </div>
    );
}
