import { useCallback, useEffect, useState } from "react";
import type { ActivityHorizon, ActivitySpine as ActivitySpineData } from "../../../shared/activity-spine";
import type { Screen } from "../types/core";
import { captureProductEvent } from "../lib/analytics";

const HORIZON_LABEL: Record<ActivityHorizon, string> = {
    now: "Now",
    today: "Today",
    "this-week": "This Week",
    "long-term": "Long Term",
};

export function ActivitySpine({ playerName, onNavigate }: { playerName: string; onNavigate: (screen: Screen) => void }) {
    const [spine, setSpine] = useState<ActivitySpineData | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "offline" | "error">("loading");
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        fetch(`/api/player/activity-spine?player=${encodeURIComponent(playerName)}`, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json() as { spine?: ActivitySpineData };
            })
            .then((data) => {
                if (!data.spine) throw new Error("Missing activity spine");
                setSpine(data.spine);
                setStatus("ready");
                captureProductEvent("activity_recommendation_viewed", { screenId: "daily-briefing", horizon: "all" });
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
                if (import.meta.env.DEV) console.warn("[activity-spine]", error);
            });
        return () => controller.abort();
    }, [playerName, retry]);

    const navigate = useCallback((screen: string, context?: string) => {
        if (context === "clan-boss") {
            try { sessionStorage.setItem("clan.initialView", "boss"); } catch { /* optional navigation hint */ }
        }
        onNavigate(screen as Screen);
    }, [onNavigate]);

    if (status === "loading") {
        return <section className="db-section activity-spine" aria-busy="true"><h3>Your Activity Spine</h3><div className="activity-spine-loading">Building your current plan…</div></section>;
    }
    if (!spine || status !== "ready") {
        return (
            <section className="db-section activity-spine" role="status">
                <h3>Your Activity Spine</h3>
                <div className="activity-spine-error">
                    <strong>{status === "offline" ? "You appear to be offline." : "Your live plan could not be loaded."}</strong>
                    <span>Your saved progress is safe. Reconnect and retry for current eligibility.</span>
                    <button type="button" onClick={() => { setStatus("loading"); setRetry((value) => value + 1); }}>Retry</button>
                </div>
            </section>
        );
    }

    return (
        <section className="db-section activity-spine" aria-label="Activity recommendations by time horizon">
            <div className="activity-spine-heading">
                <h3>Your Activity Spine</h3>
                {spine.returningPlayer ? <span className="activity-spine-returner">Returner plan</span> : null}
            </div>
            <div className="activity-spine-grid">
                {(Object.keys(HORIZON_LABEL) as ActivityHorizon[]).map((horizon) => (
                    <div className={`activity-horizon activity-horizon-${horizon}`} key={horizon}>
                        <h4>{HORIZON_LABEL[horizon]}</h4>
                        {spine.horizons[horizon].map((activity) => (
                            <article className={`activity-card is-${activity.eligibility}`} key={activity.id}>
                                <div className="activity-card-topline">
                                    <strong>{activity.title}</strong>
                                    <span>{activity.commitment}</span>
                                </div>
                                <p>{activity.why}</p>
                                {activity.blocker ? <p className="activity-card-blocker">Blocked: {activity.blocker}</p> : null}
                                {activity.reward ? <small>Use / reward: {activity.reward}</small> : null}
                                <button type="button" disabled={activity.eligibility === "blocked"} onClick={() => navigate(activity.screen, activity.context)}>
                                    {activity.eligibility === "complete" ? "Review" : activity.cta}
                                </button>
                            </article>
                        ))}
                    </div>
                ))}
            </div>
        </section>
    );
}
