import { useCallback, useEffect, useState } from "react";
import {
    MASTERY_FOCUS_OPTIONS,
    normalizeMasteryFocus,
    type ActivityHorizon,
    type ActivitySpine as ActivitySpineData,
    type MasteryFocus,
} from "../../../shared/activity-spine";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { captureProductEvent } from "../lib/analytics";

const HORIZON_LABEL: Record<ActivityHorizon, string> = {
    now: "Now",
    today: "Today",
    "this-week": "This Week",
    "long-term": "Long Term",
};

export function ActivitySpine({
    character,
    updateCharacter,
    onNavigate,
}: {
    character: Character;
    updateCharacter: (c: Character | ((prev: Character | null) => Character | null)) => void;
    onNavigate: (screen: Screen) => void;
}) {
    const focus = normalizeMasteryFocus(character.masteryFocus);
    const [spine, setSpine] = useState<ActivitySpineData | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "offline" | "error">("loading");
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        fetch(`/api/player/activity-spine?player=${encodeURIComponent(character.name)}&focus=${encodeURIComponent(focus)}`, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json() as { spine?: ActivitySpineData };
            })
            .then((data) => {
                if (!data.spine) throw new Error("Missing activity spine");
                setSpine(data.spine);
                setStatus("ready");
                captureProductEvent("activity_recommendation_viewed", { screenId: "daily-briefing", horizon: "all", focus: data.spine.resolvedFocus });
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
                if (import.meta.env.DEV) console.warn("[activity-spine]", error);
            });
        return () => controller.abort();
    }, [character.name, focus, retry]);

    const chooseFocus = (next: MasteryFocus) => {
        setSpine(null);
        setStatus("loading");
        updateCharacter((prev) => prev ? { ...prev, masteryFocus: next } : prev);
        captureProductEvent("activity_recommendation_viewed", { screenId: "daily-briefing", mode: "focus-selected", focus: next });
    };

    const navigate = useCallback((screen: string, context?: string, horizon?: ActivityHorizon) => {
        if (context === "clan-boss") {
            try { sessionStorage.setItem("clan.initialView", "boss"); } catch { /* optional navigation hint */ }
        }
        captureProductEvent("activity_recommendation_viewed", { screenId: "daily-briefing", mode: "recommendation-opened", focus, horizon: horizon ?? "all" });
        onNavigate(screen as Screen);
    }, [focus, onNavigate]);

    const heading = (
        <div className="activity-spine-heading">
            <div>
                <h3>Your Activity Spine</h3>
                {focus === "auto" && spine?.selectedFocus === "auto" ? <small>Auto focus: {MASTERY_FOCUS_OPTIONS.find((option) => option.id === spine.resolvedFocus)?.label}</small> : null}
            </div>
            <label className="activity-focus-select">
                <span>Mastery focus</span>
                <select aria-label="Mastery focus" value={focus} onChange={(event) => chooseFocus(normalizeMasteryFocus(event.target.value))}>
                    {MASTERY_FOCUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
            </label>
            {spine?.returningPlayer ? <span className="activity-spine-returner">Returner plan</span> : null}
        </div>
    );

    if (status === "loading") {
        return <section className="db-section activity-spine" aria-busy="true">{heading}<div className="activity-spine-loading">Building your current plan…</div></section>;
    }
    if (!spine || status !== "ready") {
        return (
            <section className="db-section activity-spine" role="status">
                {heading}
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
            {heading}
            <div className="activity-spine-grid">
                {(Object.keys(HORIZON_LABEL) as ActivityHorizon[]).map((horizon) => (
                    <div className={`activity-horizon activity-horizon-${horizon}`} key={horizon}>
                        <h4>{HORIZON_LABEL[horizon]}</h4>
                        {spine.horizons[horizon].map((activity) => {
                            const blockerId = `${activity.id}-blocker`;
                            return <article className={`activity-card is-${activity.eligibility}`} key={activity.id}>
                                <div className="activity-card-topline"><strong>{activity.title}</strong><span>{activity.commitment}</span></div>
                                <p>{activity.why}</p>
                                {activity.progress ? <p className="activity-card-progress">Progress: {activity.progress}</p> : null}
                                {activity.blocker ? <p id={blockerId} className="activity-card-blocker">Blocked: {activity.blocker}</p> : null}
                                {activity.reward ? <small>Use / reward: {activity.reward}</small> : null}
                                <button type="button" aria-describedby={activity.blocker ? blockerId : undefined} onClick={() => navigate(activity.screen, activity.context, horizon)}>
                                    {activity.cta}
                                </button>
                            </article>;
                        })}
                    </div>
                ))}
            </div>
        </section>
    );
}
