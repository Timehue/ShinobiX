import { useCallback, useEffect } from "react";
import {
    MASTERY_FOCUS_OPTIONS,
    normalizeMasteryFocus,
    type ActivityHorizon,
    type MasteryFocus,
} from "../../../shared/activity-spine";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { captureProductEvent } from "../lib/analytics";
import { useActivitySpine } from "../lib/activity-spine-client";
import { Button } from "./ui/Button";

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
    const { spine, status, retry } = useActivitySpine(character.name, focus);

    useEffect(() => {
        if (!spine || status !== "ready") return;
        captureProductEvent("activity_recommendation_viewed", { screenId: "daily-briefing", horizon: "all", focus: spine.resolvedFocus });
    }, [spine, status]);

    const chooseFocus = (next: MasteryFocus) => {
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
                    <Button type="button" variant="ghost" size="sm" onClick={retry}>Retry</Button>
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
                                <Button type="button" variant="primary" size="sm" aria-describedby={activity.blocker ? blockerId : undefined} onClick={() => navigate(activity.screen, activity.context, horizon)}>
                                    {activity.cta}
                                </Button>
                            </article>;
                        })}
                    </div>
                ))}
            </div>
        </section>
    );
}
