/**
 * NextGoalPin — a persistent "what should I do next" breadcrumb.
 *
 * Once the guided OnboardingCoach beats end, a new player is handed a hub full of
 * buttons with no signpost. This pin reuses currentLogbookObjective() (the same
 * source the Daily Briefing uses) to surface the single active objective's first
 * INCOMPLETE requirement as a compact, tappable card that deep-links to the right
 * screen.
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
import { currentLogbookObjective } from "../lib/logbook-objectives";
import { isAcademyOnboardingActive } from "../lib/onboarding-step";
import { GameIcon } from "./icons/GameIcon";
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
    // The companion coach already owns wayfinding during the Academy tutorial.
    // Hiding the broader Logbook pin here prevents two valid but conflicting
    // "do this next" instructions from appearing at the same time.
    if (isAcademyOnboardingActive(character.onboardingStep ?? "")) return null;
    const handoff = buildAcademyHandoff(character);
    const objective = handoff ? null : currentLogbookObjective(character);
    const activeId = handoff?.id ?? objective?.id ?? null;
    if (!activeId) return null;
    if (dismissedId === activeId || dismissedId === objective?.title) return null;
    const req = objective?.requirements.find((r) => r.progress < r.target) ?? (
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
    const closeBtn = (size: number, compactButton = false) => (
        <button
            type="button"
            onClick={dismiss}
            aria-label="Hide this goal"
            title="Hide — returns on your next goal"
            className={compactButton ? "next-goal-pin-compact__close" : undefined}
            style={{
                alignSelf: "flex-start",
                background: "none",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
                fontSize: size,
                lineHeight: 1,
                minWidth: compactButton ? 20 : 44,
                minHeight: compactButton ? 20 : 44,
                padding: 0,
            }}
        >
            ✕
        </button>
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
                <div className="next-goal-pin-compact__heading" style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 5, paddingRight: 24, minWidth: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: "#7dd3fc", textTransform: "uppercase" }}>
                    <GameIcon name="target" size={11} />
                    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>Academy handoff</span>
                    {closeBtn(12, true)}
                </div>
                <strong style={{ display: "block", marginTop: 4, color: "#f8fafc", fontSize: 12, lineHeight: 1.3 }}>
                    {handoff.title}
                </strong>
                <div style={{ display: "grid", gap: 5, marginTop: 7 }}>
                    {[handoff.primary, handoff.secondary].map((action, index) => (
                        <button
                            type="button"
                            key={action.screen}
                            onClick={() => runHandoffAction(action)}
                            title={action.detail}
                            style={{
                                cursor: "pointer",
                                border: index === 0 ? "1px solid rgba(250,204,21,.42)" : "1px solid rgba(125,211,252,.28)",
                                borderRadius: 6,
                                padding: "5px 7px",
                                background: index === 0 ? "rgba(250,204,21,.12)" : "rgba(56,189,248,.08)",
                                color: index === 0 ? "#facc15" : "#bae6fd",
                                fontSize: 10.5,
                                fontWeight: 700,
                                textAlign: "left",
                            }}
                        >
                            {action.label} →
                        </button>
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
                            <button
                                type="button"
                                key={action.screen}
                                onClick={() => runHandoffAction(action)}
                                title={action.detail}
                                style={{
                                    cursor: "pointer",
                                    border: index === 0 ? "1px solid #eab308" : "1px solid rgba(125,211,252,.42)",
                                    borderRadius: 8,
                                    padding: "8px 12px",
                                    background: index === 0 ? "linear-gradient(180deg, #facc15, #eab308)" : "rgba(56,189,248,.10)",
                                    color: index === 0 ? "#1a1306" : "#e0f2fe",
                                    fontWeight: 700,
                                    fontSize: 12.5,
                                }}
                            >
                                {action.label} →
                            </button>
                        ))}
                    </div>
                </div>
                {closeBtn(16)}
            </section>
        );
    }

    if (!objective || !req) return null;
    const pct = req.target > 0 ? Math.min(100, Math.round((req.progress / req.target) * 100)) : 0;

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
                <div className="next-goal-pin-compact__heading" style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 5, paddingRight: 24, minWidth: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box", overflow: "hidden", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: "#facc15", textTransform: "uppercase" }}>
                    <GameIcon name="target" size={11} />
                    <span style={{ display: "block", minWidth: 0, maxWidth: "100%", lineHeight: 1.25, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                        Next goal · {objective.title}
                    </span>
                    {closeBtn(12, true)}
                </div>
                <div className="next-goal-pin-compact__body" style={{ display: "grid", minWidth: 0, gap: 4, fontSize: 12, fontWeight: 600, color: "#f8fafc", marginTop: 2 }}>
                    <span style={{ display: "block", minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                        {req.label}
                        {req.target > 1 && <span style={{ color: "#94a3b8", fontWeight: 500 }}> {Math.min(req.progress, req.target)}/{req.target}</span>}
                    </span>
                    {req.goScreen && (
                        <button
                            type="button"
                            onClick={() => navigate(req.goScreen as Screen)}
                            style={{ justifySelf: "start", maxWidth: "100%", cursor: "pointer", background: "none", color: "#facc15", fontWeight: 700, fontSize: 11, border: "none", padding: 0, whiteSpace: "normal", textAlign: "left", overflowWrap: "anywhere" }}
                        >
                            {req.goLabel ?? "Go"} →
                        </button>
                    )}
                </div>
                {req.target > 1 && (
                    <div style={{ height: 3, borderRadius: 3, background: "rgba(148,163,184,.25)", marginTop: 5, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: "#facc15" }} />
                    </div>
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
                    <GameIcon name="target" size={13} /> Next goal · {objective.title}
                </div>
                <div style={{ fontWeight: 600, color: "#f8fafc", marginTop: 2 }}>
                    {req.label}
                    {req.target > 1 && <span style={{ color: "#94a3b8", fontWeight: 500 }}> · {Math.min(req.progress, req.target)}/{req.target}</span>}
                </div>
                {req.detail && <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 1 }}>{req.detail}</div>}
                {req.target > 1 && (
                    <div style={{ height: 4, borderRadius: 4, background: "rgba(148,163,184,.25)", marginTop: 6, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: "#facc15" }} />
                    </div>
                )}
            </div>
            {req.goScreen && (
                <button
                    type="button"
                    onClick={() => navigate(req.goScreen as Screen)}
                    style={{ cursor: "pointer", background: "linear-gradient(180deg, #facc15, #eab308)", color: "#1a1306", fontWeight: 700, fontSize: 13, border: "none", borderRadius: 8, padding: "8px 16px", whiteSpace: "nowrap" }}
                >
                    {req.goLabel ?? "Go"} →
                </button>
            )}
            {closeBtn(16)}
        </div>
    );
}
