import { useCallback, useEffect, useState } from "react";
import {
    MASTERY_FOCUS_OPTIONS,
    normalizeMasteryFocus,
    type ActivityHorizon,
    type ActivitySpine as ActivitySpineData,
    type ActivitySpineItem,
    type MasteryFocus,
} from "../../../shared/activity-spine";
import { PUBLIC_CAPABILITY_IDS } from "../../../shared/public-capabilities";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { captureProductEvent } from "../lib/analytics";
import { useLiveCapabilities } from "../lib/live-capabilities-context";

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
    const storedFocus = normalizeMasteryFocus(character.masteryFocus);
    const [spine, setSpine] = useState<ActivitySpineData | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "offline" | "error">("loading");
    const [retry, setRetry] = useState(0);
    const { availability, snapshot } = useLiveCapabilities();
    const legacyFocusAvailable = availability("legacy") === "available";
    const focus = storedFocus === "legacy" && !legacyFocusAvailable ? "auto" : storedFocus;
    const focusOptions = MASTERY_FOCUS_OPTIONS.filter((option) => option.id !== "legacy" || legacyFocusAvailable);
    const projectedAdmissionAllowed = (capabilityIds: ActivitySpineItem["requiredCapabilityIds"]): boolean =>
        !!capabilityIds?.length && capabilityIds.every((id) => availability(id) === "available");
    const focusAdmissionAllowed = (["gameplay", "gameplayMutations"] as const)
        .every((id) => availability(id) === "available");
    const capabilityStateSignature = [
        snapshot.freshness,
        ...PUBLIC_CAPABILITY_IDS.map((id) => `${id}:${availability(id)}`),
    ].join("|");

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
    }, [character.name, focus, retry, capabilityStateSignature]);

    const chooseFocus = (next: MasteryFocus) => {
        if (next === "legacy" && !legacyFocusAvailable) return;
        if (!(["gameplay", "gameplayMutations"] as const).every((id) => availability(id) === "available")) return;
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
                <select
                    aria-label="Mastery focus"
                    value={focus}
                    disabled={!focusAdmissionAllowed}
                    onChange={(event) => chooseFocus(normalizeMasteryFocus(event.target.value))}
                >
                    {focusOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
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
                            const liveAdmissionAllowed = projectedAdmissionAllowed(activity.requiredCapabilityIds);
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
                                navigate(activity.screen, activity.context, horizon);
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
