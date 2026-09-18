import { useCallback, useState } from "react";
import {
    type ActivityHorizon,
    type ActivitySpineItem,
} from "../../../shared/activity-spine";
import { PUBLIC_CAPABILITY_IDS } from "../../../shared/public-capabilities";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { captureProductEvent } from "../lib/analytics";
import { useLiveCapabilities } from "../lib/live-capabilities-context";

import { activityDestination, openActivityDestination } from "../lib/activity-spine-navigation";
import { activitySourceKey } from "../lib/activity-spine-source";
import { useActivitySpine } from "../lib/use-activity-spine";

const HORIZON_LABEL: Record<ActivityHorizon, string> = {
    now: "Now",
    today: "Today",
    "this-week": "This Week",
    "long-term": "Long Term",
};

export function ActivitySpine({
    character,
    onNavigate,
    trainingState = "",
}: {
    character: Character;
    trainingState?: string;
    onNavigate: (screen: Screen) => void;
}) {
    const [retry, setRetry] = useState(0);
    const { availability, snapshot } = useLiveCapabilities();
    const focus = "auto";
    const projectedAdmissionAllowed = (capabilityIds: ActivitySpineItem["requiredCapabilityIds"]): boolean =>
        !!capabilityIds?.length && capabilityIds.every((id) => availability(id) === "available");
    const capabilityStateSignature = [
        snapshot.freshness,
        ...PUBLIC_CAPABILITY_IDS.map((id) => `${id}:${availability(id)}`),
    ].join("|");

    const source = activitySourceKey(character, trainingState);
    const { spine, status } = useActivitySpine(character.name, focus, source, capabilityStateSignature, retry);
    const navigate = useCallback((activity: ActivitySpineItem, horizon: ActivityHorizon) => {
        if (openActivityDestination(activity, onNavigate)) {
            captureProductEvent("activity_recommendation_viewed", { screenId: "daily-briefing", mode: "recommendation-opened", focus: spine?.resolvedFocus ?? focus, horizon });
        }
    }, [focus, spine?.resolvedFocus, onNavigate]);

    const heading = (
        <div className="activity-spine-heading">
            <h3>Your priorities</h3>
            {spine?.returningPlayer ? <span className="activity-spine-returner">Welcome back</span> : null}
        </div>
    );

    if (status === "loading") {
        return <section className="db-section activity-spine" aria-busy="true">{heading}<div className="activity-spine-loading">Checking your priorities…</div></section>;
    }
    if (!spine || status !== "ready") {
        return (
            <section className="db-section activity-spine" role="status">
                {heading}
                <div className="activity-spine-error">
                    <strong>{status === "offline" ? "You appear to be offline." : "Current priorities could not be loaded."}</strong>
                    <span>Your saved progress is safe. Reconnect and retry for current eligibility.</span>
                    <button type="button" onClick={() => { setRetry((value) => value + 1); }}>Retry</button>
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
                            const liveAdmissionAllowed = projectedAdmissionAllowed(activity.requiredCapabilityIds) && !!activityDestination(activity.screen);
                            const blocked = activity.eligibility === "blocked" || !liveAdmissionAllowed;
                            const effectiveBlocker = activity.blocker ?? (!liveAdmissionAllowed
                                ? "Live eligibility is unavailable. Wait for capability refresh before starting this activity."
                                : undefined);
                            const effectiveEligibility = blocked ? "blocked" : activity.eligibility;
                            const openActivity = () => {
                                // Re-evaluate against wall-clock freshness at the
                                // click boundary; a long-idle render must not admit
                                // an action from an expired capability snapshot.
                                if (!projectedAdmissionAllowed(activity.requiredCapabilityIds)) return;
                                navigate(activity, horizon);
                            };
                            return <article className={`activity-card is-${effectiveEligibility}`} key={activity.id}>
                                <div className="activity-card-topline"><strong>{activity.title}</strong><span>{activity.commitment}</span></div>
                                <p>{activity.why}</p>
                                {activity.progress ? <p className="activity-card-progress">Progress: {activity.progress}</p> : null}
                                {effectiveBlocker ? <p id={blockerId} className="activity-card-blocker">{blocked ? "Blocked" : "Prerequisite"}: {effectiveBlocker}</p> : null}
                                {activity.recoveryOnly ? <small>Recovery-only record: new actions are disabled.</small> : null}
                                {activity.reward ? <small>Use / reward: {activity.reward}</small> : null}
                                <button
                                    type="button"
                                    aria-describedby={effectiveBlocker ? blockerId : undefined}
                                    disabled={blocked}
                                    onClick={blocked ? undefined : openActivity}
                                >
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
