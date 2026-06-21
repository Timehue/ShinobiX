/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef, type CSSProperties } from "react";

/**
 * Isolated per-turn countdown for the battle screens (PvP + PvE arena).
 *
 * It owns its own 1-second tick, so the decrement re-renders ONLY this small
 * element instead of the battle screen's ~120-tile hex board. Previously the
 * countdown lived in each battle screen's own state, so every tick rebuilt the
 * whole board (all the per-render tile sets + 120 tile nodes) once per second —
 * the dominant cause of continuous combat stutter on mobile.
 *
 * Behavior-preserving vs. the old inline timers:
 *   • starts at `seconds` (default 45),
 *   • resets to full whenever `active` flips true or `resetSignal` changes
 *     (turn start / action taken — the screens bump a key on each action),
 *   • holds frozen at full while inactive (not the player's turn / prefight),
 *   • fires `onExpire` exactly once when it reaches 0 (the screen's auto-pass).
 *
 * `onExpire` is read through a ref so a changing callback identity never
 * re-arms the interval (which would otherwise restart the countdown).
 */
export function CombatRoundTimer({
    active,
    resetSignal,
    seconds = 45,
    onExpire,
}: {
    active: boolean;
    resetSignal: number;
    seconds?: number;
    onExpire: () => void;
}) {
    const [remaining, setRemaining] = useState(seconds);
    // Keep the latest onExpire in a ref (synced after each commit) so a changing
    // callback identity never re-arms the interval — which would restart the
    // countdown on every parent render.
    const onExpireRef = useRef(onExpire);
    useEffect(() => { onExpireRef.current = onExpire; });

    useEffect(() => {
        if (!active) { setRemaining(seconds); return; }
        let secs = seconds;
        setRemaining(secs);
        const iv = window.setInterval(() => {
            secs -= 1;
            setRemaining(secs);
            if (secs <= 0) { window.clearInterval(iv); onExpireRef.current(); }
        }, 1000);
        return () => window.clearInterval(iv);
    }, [active, resetSignal, seconds]);

    return (
        <div className={`round-timer-display${remaining <= 10 ? " round-timer-urgent" : ""}`}>
            <div className="round-timer-ring" style={{ "--rt-pct": `${(remaining / seconds) * 100}%` } as CSSProperties}>
                <span className="round-timer-num">{remaining}</span>
            </div>
            <small>Turn timer</small>
        </div>
    );
}
