import { useEffect, useState } from "react";
import { loadBoostEvent } from "../lib/world-state";
import { serverNow } from "../lib/server-clock";
import { BOOST_TARGET_INFO, defaultBoostTitle, formatBoostMultiplier, formatBoostTimeLeft, type BoostEvent } from "../../../shared/boost-event";

const DISMISSED_KEY = "boostEvent.dismissed";
const REFRESH_MS = 15_000;

function readDismissed(): string {
    try { return localStorage.getItem(DISMISSED_KEY) ?? ""; } catch { return ""; }
}

/**
 * The strip shown while an admin-started boost event runs (shared/boost-event.ts).
 * Rendered by LiveServiceNotice when nothing more urgent is on screen. It
 * re-reads the polled world-state copy on a slow timer, so it appears within a
 * poll of the event starting and disappears on its own when the event ends.
 * Dismissing hides it for that event only.
 */
export function BoostEventBanner() {
    const [now, setNow] = useState(() => serverNow());
    const [dismissed, setDismissed] = useState(readDismissed);
    useEffect(() => {
        const id = window.setInterval(() => setNow(serverNow()), REFRESH_MS);
        return () => window.clearInterval(id);
    }, []);
    const event: BoostEvent | null = loadBoostEvent(now);
    if (!event || dismissed === event.id) return null;
    const dismiss = () => {
        try { localStorage.setItem(DISMISSED_KEY, event.id); } catch { /* best effort */ }
        setDismissed(event.id);
    };
    return (
        <aside role="status" aria-live="polite" aria-label="Boost event" className="boost-event-banner">
            <span className="boost-event-banner__mult" aria-hidden="true">{formatBoostMultiplier(event.multiplier)}</span>
            <div>
                <strong>{event.title}</strong>
                <span>
                    {/* The default title already names the targets; list them only under a custom title. */}
                    {event.title === defaultBoostTitle(event.multiplier, event.targets)
                        ? formatBoostTimeLeft(event.endsAt, now)
                        : `${event.targets.map((t) => BOOST_TARGET_INFO[t].label).join(" · ")} · ${formatBoostTimeLeft(event.endsAt, now)}`}
                </span>
            </div>
            <button type="button" className="boost-event-banner__close" onClick={dismiss} aria-label="Hide boost event banner">×</button>
        </aside>
    );
}
