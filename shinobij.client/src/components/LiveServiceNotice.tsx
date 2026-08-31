import { useEffect, useState } from "react";
import { liveServiceNotice } from "../lib/live-service-notice";
import { visiblePoll } from "../lib/poll";
import { useLiveCapabilities } from "../lib/live-capabilities-context";
import { fetchWorldCrisis } from "../lib/world-crisis";
import { fetchWorldCrisis80 } from "../lib/world-crisis-80";
import type { Screen } from "../types/core";
import type { WorldCrisisProjection } from "../../../shared/world-crisis";
import type { WorldCrisis80Projection } from "../../../shared/world-crisis-80";
import "./LiveServiceNotice.css";

const CRISIS_HERALD_SEEN = "worldCrisis.herald.seen";
const CRISIS_80_HERALD_SEEN = "worldCrisis80.herald.seen";

export function LiveServiceNotice({ screen, onNavigate }: { screen: Screen; onNavigate: (screen: Screen) => void }) {
    const { snapshot: { capabilities } } = useLiveCapabilities();
    const notice = capabilities ? liveServiceNotice(screen, capabilities) : null;
    const [crisis, setCrisis] = useState<WorldCrisisProjection | null>(null);
    const [reckoning, setReckoning] = useState<WorldCrisis80Projection | null>(null);
    const [dismissedRun, setDismissedRun] = useState("");
    useEffect(() => {
        let alive = true;
        const refresh = () => { void Promise.all([fetchWorldCrisis(), fetchWorldCrisis80()]).then(([next, next80]) => { if (!alive) return; if (next) setCrisis(next); if (next80) setReckoning(next80); }); };
        refresh();
        const stop = visiblePoll(refresh, 15_000);
        return () => { alive = false; stop(); };
    }, []);
    if (notice) return (
        <aside role="status" aria-live="polite" aria-label="Live service status" className="live-service-notice">
            <strong>{notice.title}</strong><span>{notice.body}</span>
        </aside>
    );
    const current = reckoning?.status === "active" ? reckoning : crisis?.status === "active" ? crisis : null;
    const level80 = current === reckoning;
    const seenKey = level80 ? CRISIS_80_HERALD_SEEN : CRISIS_HERALD_SEEN;
    const seen = (() => { try { return localStorage.getItem(seenKey) === current?.runId; } catch { return false; } })();
    if (!current || dismissedRun === current.runId || seen) return null;
    function dismiss() {
        try { localStorage.setItem(seenKey, current!.runId); } catch { /* best effort */ }
        setDismissedRun(current!.runId);
    }
    function openNews() {
        try { window.sessionStorage?.setItem("hall.initialTab", "news"); } catch { /* best effort */ }
        dismiss();
        onNavigate("hallOfLegends");
    }
    return (
        <aside role="alert" aria-live="assertive" aria-label="Global world crisis announcement" className="world-crisis-herald">
            <span className="world-crisis-herald__seal" aria-hidden="true">◇</span>
            <div><small>GLOBAL ANNOUNCEMENT · {level80 ? "THE FIRST WITNESS" : "THE FIRST OMEN"}</small><strong>{current.awakenedBy} awakened {level80 ? "The Hollow Gate Reckoning" : "The Fourfold Breach"}</strong><span>{level80 ? "Collection Cells and pursuit packs are converging on every witness ledger." : "Recall wardens are attacking every village outskirts."} The World Herald report is ready.</span></div>
            <button type="button" onClick={openNews}>Watch report</button>
            <button type="button" className="world-crisis-herald__close" onClick={dismiss} aria-label="Dismiss announcement">×</button>
        </aside>
    );
}
