/**
 * NextGoalPin — a persistent "what should I do next" breadcrumb.
 *
 * Once the guided OnboardingCoach beats end, a new player is handed a hub full of
 * buttons with no signpost. This pin consumes the server-authored Activity
 * Spine's single `Now` recommendation, the same authority rendered by Daily
 * Briefing. The permanent Logbook objective is used only as an explicit offline
 * fallback, so the product never presents two competing live recommendations.
 *
 * Two presentations:
 *   • default (full)  — a banner; rendered on the Village / Central hubs. CSS hides
 *     it on desktop (≥981px) so it only shows on mobile, where there is no left rail.
 *   • compact         — a slim strip tucked under the Lv/XP bar in the desktop
 *     left-profile rail, so the "next step" rides along with the stat panel instead
 *     of taking the top of the hub.
 *
 * Dismissable: a "×" hides the CURRENT objective's pin (remembered per device).
 * It reappears once a *new* objective becomes active — so "hide" silences the
 * current nag without killing the wayfinding for the next milestone.
 *
 * Renders nothing once every unlocked objective is complete (veterans see no
 * clutter). Self-contained inline styles; presentation only.
 */
import { useState } from "react";
import { buildAcademyHandoff } from "../lib/academy-handoff";
import { preferredNowActivity, useActivitySpine } from "../lib/activity-spine-client";
import { captureProductEvent } from "../lib/analytics";
import { currentLogbookObjective } from "../lib/logbook-objectives";
import { isAcademyOnboardingActive } from "../lib/onboarding-step";
import { GameIcon } from "./icons/GameIcon";
import { Button } from "./ui/Button";
import { ProgressBar } from "./ui/ProgressBar";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";

const DISMISS_KEY = "nextGoalDismissedObjective";
function readDismissed(): string | null {
    try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
}

export function NextGoalPin({
    character,
    navigate,
    compact = false,
    onOpenAwakening,
}: {
    character: Character;
    navigate: (s: Screen) => void;
    compact?: boolean;
    onOpenAwakening?: () => void;
}) {
    const [dismissedId, setDismissedId] = useState<string | null>(readDismissed);
    const onboardingActive = isAcademyOnboardingActive(character.onboardingStep ?? "");
    const handoff = onboardingActive ? null : buildAcademyHandoff(character);
    const liveEnabled = !onboardingActive && !handoff;
    const { spine, status } = useActivitySpine(character.name, character.masteryFocus, liveEnabled);
    const activity = status === "ready" ? preferredNowActivity(spine) : null;
    const offlineFallback = status === "offline" || status === "error";
    const objective = liveEnabled && offlineFallback ? currentLogbookObjective(character) : null;

    // The companion coach already owns wayfinding during the Academy tutorial.
    // Hiding the broader Logbook pin here prevents two valid but conflicting
    // "do this next" instructions from appearing at the same time.
    if (onboardingActive) return null;
    // Do not flash a Logbook recommendation while the live authority is loading.
    if (liveEnabled && status === "loading") return null;
    const activeId = handoff?.id ?? (activity ? `activity:${activity.id}` : objective?.id) ?? null;
    if (!activeId) return null;
    if (dismissedId === activeId || dismissedId === objective?.title) return null;
    const req = activity
        ? {
            label: activity.why,
            progress: 0,
            target: 1,
            detail: [activity.commitment, activity.progress, activity.reward, activity.blocker].filter(Boolean).join(" · "),
            goScreen: activity.screen as Screen,
            goLabel: activity.cta,
        }
        : objective?.requirements.find((r) => r.progress < r.target) ?? (
            objective?.kind === "academy" && !character.academyChecklistClaimed
                ? {
                    label: "Claim Academy Reward",
                    progress: 0,
                    target: 1,
                    detail: "Open the Logbook and claim your Academy reward.",
                    goScreen: "logbook" as Screen,
                    goLabel: "Open Logbook",
                }
                : null
        );
    const goalTitle = activity?.title ?? objective?.title ?? "Current objective";
    const goalLabel = activity ? "Now" : "Offline goal";

    const dismiss = () => {
        try { localStorage.setItem(DISMISS_KEY, activeId); } catch { /* private mode — just hide for the session */ }
        setDismissedId(activeId);
    };
    const runHandoffAction = (action: NonNullable<typeof handoff>["primary"]) => {
        if (action.intent === "openAwakening" && onOpenAwakening) {
            onOpenAwakening();
            return;
        }
        navigate(action.screen);
    };
    const runGoalAction = () => {
        if (!req?.goScreen) return;
        if (activity?.context === "clan-boss") {
            try { sessionStorage.setItem("clan.initialView", "boss"); } catch { /* optional navigation hint */ }
        }
        if (activity) {
            captureProductEvent("activity_recommendation_viewed", {
                screenId: "persistent-next-goal",
                mode: "recommendation-opened",
                horizon: "now",
                focus: spine?.resolvedFocus,
            });
        }
        navigate(req.goScreen);
    };
    const closeBtn = (size: number, compactButton = false) => (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={dismiss}
            aria-label="Hide this goal"
            title="Hide — returns on your next goal"
            className={`next-goal-pin__close${compactButton ? " next-goal-pin-compact__close" : ""}`}
            style={{
                alignSelf: "flex-start",
                color: "var(--sj-text-muted)",
                fontSize: size,
            }}
        >
            ✕
        </Button>
    );

    if (handoff && compact) {
        return (
            <div
                className="next-goal-pin-compact academy-handoff-compact"
                style={{
                    margin: "8px 0 0", padding: "8px 9px", borderRadius: 8,
                    background: "linear-gradient(90deg, rgba(56,189,248,.12), rgba(250,204,21,.05))",
                    border: "1px solid rgba(125,211,252,.34)",
                    boxSizing: "border-box", minWidth: 0, width: "auto", maxWidth: "none",
                    alignSelf: "stretch", overflow: "hidden", position: "relative",
                }}
            >
                <div className="next-goal-pin-compact__heading" style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 5, paddingRight: 48, minWidth: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: "#7dd3fc", textTransform: "uppercase" }}>
                    <GameIcon name="target" size={11} />
                    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>Academy handoff</span>
                    {closeBtn(12, true)}
                </div>
                <strong style={{ display: "block", marginTop: 4, color: "#f8fafc", fontSize: 12, lineHeight: 1.3 }}>
                    {handoff.title}
                </strong>
                <div style={{ display: "grid", gap: 5, marginTop: 7 }}>
                    {[handoff.primary, handoff.secondary].map((action, index) => (
                        <Button
                            type="button"
                            variant={index === 0 ? "primary" : "info"}
                            size="sm"
                            key={action.screen}
                            onClick={() => runHandoffAction(action)}
                            title={action.detail}
                            className="next-goal-pin-compact__action"
                            style={{
                                justifyContent: "flex-start",
                                textAlign: "left",
                            }}
                        >
                            {action.label} →
                        </Button>
                    ))}
                </div>
            </div>
        );
    }

    if (handoff) {
        return (
            <section
                className="next-goal-pin academy-handoff-pin"
                aria-labelledby="academy-handoff-title"
                style={{
                    display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12,
                    margin: "0 0 12px", padding: "12px 14px", borderRadius: 10,
                    background: "linear-gradient(100deg, rgba(56,189,248,.12), rgba(250,204,21,.07))",
                    border: "1px solid rgba(125,211,252,.36)",
                }}
            >
                <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, color: "#7dd3fc", textTransform: "uppercase" }}>
                        <GameIcon name="target" size={13} /> Academy complete · Choose your next focus
                    </div>
                    <h3 id="academy-handoff-title" style={{ margin: "4px 0 2px", color: "#f8fafc", fontSize: 17 }}>
                        {handoff.title}
                    </h3>
                    <p style={{ margin: 0, color: "#aebbd0", fontSize: 12.5, lineHeight: 1.4 }}>{handoff.summary}</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                        {[handoff.primary, handoff.secondary].map((action, index) => (
                            <Button
                                type="button"
                                variant={index === 0 ? "primary" : "info"}
                                size="sm"
                                key={action.screen}
                                onClick={() => runHandoffAction(action)}
                                title={action.detail}
                                className="next-goal-pin__action"
                                style={{
                                    whiteSpace: "normal",
                                }}
                            >
                                {action.label} →
                            </Button>
                        ))}
                    </div>
                </div>
                {closeBtn(16)}
            </section>
        );
    }

    if ((!objective && !activity) || !req) return null;
    if (compact) {
        return (
            <div
                className="next-goal-pin-compact"
                style={{
                    margin: "8px 0 0", padding: "7px 9px", borderRadius: 8,
                    background: "linear-gradient(90deg, rgba(250,204,21,.10), rgba(250,204,21,.03))",
                    border: "1px solid rgba(250,204,21,.28)",
                    boxSizing: "border-box", minWidth: 0, width: "auto", maxWidth: "none",
                    alignSelf: "stretch",
                    overflow: "hidden", position: "relative",
                }}
            >
                <div className="next-goal-pin-compact__heading" style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 5, paddingRight: 48, minWidth: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box", overflow: "hidden", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: "#facc15", textTransform: "uppercase" }}>
                    <GameIcon name="target" size={11} />
                    <span style={{ display: "block", minWidth: 0, maxWidth: "100%", lineHeight: 1.25, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                        {goalLabel} · {goalTitle}
                    </span>
                    {closeBtn(12, true)}
                </div>
                <div className="next-goal-pin-compact__body" style={{ display: "grid", minWidth: 0, gap: 4, fontSize: 12, fontWeight: 600, color: "#f8fafc", marginTop: 2 }}>
                    <span style={{ display: "block", minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                        {req.label}
                        {req.target > 1 && <span style={{ color: "#94a3b8", fontWeight: 500 }}> {Math.min(req.progress, req.target)}/{req.target}</span>}
                    </span>
                    {req.goScreen && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={runGoalAction}
                            className="next-goal-pin-compact__action"
                            style={{ color: "var(--sj-gold-bright)", fontSize: 11, whiteSpace: "normal", textAlign: "left", overflowWrap: "anywhere" }}
                        >
                            {req.goLabel ?? "Go"} →
                        </Button>
                    )}
                </div>
                {req.target > 1 && (
                    <ProgressBar
                        className="next-goal-pin__progress"
                        label={`${req.label} progress`}
                        value={req.progress}
                        max={req.target}
                        showValue={false}
                    />
                )}
            </div>
        );
    }

    return (
        <div
            className="next-goal-pin"
            style={{
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                margin: "0 0 12px", padding: "10px 14px", borderRadius: 10,
                background: "linear-gradient(90deg, rgba(250,204,21,.10), rgba(250,204,21,.03))",
                border: "1px solid rgba(250,204,21,.32)",
            }}
        >
            <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, color: "#facc15", textTransform: "uppercase" }}>
                    <GameIcon name="target" size={13} /> {goalLabel} · {goalTitle}
                </div>
                <div style={{ fontWeight: 600, color: "#f8fafc", marginTop: 2 }}>
                    {req.label}
                    {req.target > 1 && <span style={{ color: "#94a3b8", fontWeight: 500 }}> · {Math.min(req.progress, req.target)}/{req.target}</span>}
                </div>
                {req.detail && <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 1 }}>{req.detail}</div>}
                {req.target > 1 && (
                    <ProgressBar
                        className="next-goal-pin__progress"
                        label={`${req.label} progress`}
                        value={req.progress}
                        max={req.target}
                        showValue={false}
                    />
                )}
            </div>
            {req.goScreen && (
                <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={runGoalAction}
                    className="next-goal-pin__action"
                    style={{ fontSize: 13, whiteSpace: "nowrap" }}
                >
                    {req.goLabel ?? "Go"} →
                </Button>
            )}
            {closeBtn(16)}
        </div>
    );
}
