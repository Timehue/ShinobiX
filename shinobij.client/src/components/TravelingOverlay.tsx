import { useEffect, useState } from "react";

/*
 * The "Traveling" mask, with its own 100ms heartbeat.
 *
 * The countdown used to be computed inline in WorldMap from `Date.now()` at
 * render time, and nothing re-rendered during the trip: App deliberately wakes
 * only ONCE, at the arrival instant, so that the heaviest screen in the game
 * (WorldMap: 144 sector buttons, per-wanderer rAF loops, up to two WebGL
 * canvases) is not re-rendered four times a second just to move a progress bar.
 * The bar therefore froze on its first frame and the seconds text sat on "3s"
 * for the whole trip — unless some unrelated poll or socket message happened to
 * re-render App inside that window, which is why it looked intermittent.
 *
 * Owning the timer here keeps both properties: the mask ticks, and the tick
 * re-renders only these four nodes. App's arrival timeout is untouched, so it
 * is still the single source of truth for when travel actually ends.
 */
export function TravelingOverlay({ arrivalAt }: { arrivalAt: number }) {
    // Captured on mount so the bar fills over the time the player will really
    // sit here. On a mid-travel remount (a refresh restoring pendingTravel)
    // that is the REMAINING trip, which is exactly what the bar should show.
    const [startedAt] = useState(() => Date.now());
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 100);
        return () => window.clearInterval(id);
    }, [arrivalAt]);

    const totalMs = Math.max(1, arrivalAt - startedAt);
    const remainingMs = Math.max(0, arrivalAt - now);
    const secondsLeft = Math.max(1, Math.ceil(remainingMs / 1000));
    const percent = Math.max(0, Math.min(100, ((totalMs - remainingMs) / totalMs) * 100));

    return (
        <div className="map-instance">
            <div className="card" style={{ maxWidth: 520, margin: "4rem auto", textAlign: "center" }}>
                <h2>Traveling</h2>
                <p className="hint">Moving between sectors. You cannot be attacked during travel.</p>
                <div className="bar ap-bar"><span style={{ width: `${percent}%` }} /></div>
                <p aria-live="off">{secondsLeft}s</p>
            </div>
        </div>
    );
}
