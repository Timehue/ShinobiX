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
 * Renders nothing once every unlocked objective is complete (veterans see no
 * clutter). Self-contained inline styles; presentation only.
 */
import { currentLogbookObjective } from "../lib/logbook-objectives";
import { GameIcon } from "./icons/GameIcon";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";

export function NextGoalPin({ character, navigate, compact = false }: { character: Character; navigate: (s: Screen) => void; compact?: boolean }) {
    const objective = currentLogbookObjective(character);
    if (!objective) return null;
    const req = objective.requirements.find((r) => r.progress < r.target);
    if (!req) return null;
    const pct = req.target > 0 ? Math.min(100, Math.round((req.progress / req.target) * 100)) : 0;

    if (compact) {
        return (
            <div
                className="next-goal-pin-compact"
                style={{
                    margin: "8px 0 0", padding: "7px 9px", borderRadius: 8,
                    background: "linear-gradient(90deg, rgba(250,204,21,.10), rgba(250,204,21,.03))",
                    border: "1px solid rgba(250,204,21,.28)",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: "#facc15", textTransform: "uppercase" }}>
                    <GameIcon name="target" size={11} /> Next goal · {objective.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontSize: 12, fontWeight: 600, color: "#f8fafc", marginTop: 2 }}>
                    <span>
                        {req.label}
                        {req.target > 1 && <span style={{ color: "#94a3b8", fontWeight: 500 }}> {Math.min(req.progress, req.target)}/{req.target}</span>}
                    </span>
                    {req.goScreen && (
                        <button
                            onClick={() => navigate(req.goScreen as Screen)}
                            style={{ cursor: "pointer", background: "none", color: "#facc15", fontWeight: 700, fontSize: 11, border: "none", padding: 0, whiteSpace: "nowrap" }}
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
                    onClick={() => navigate(req.goScreen as Screen)}
                    style={{ cursor: "pointer", background: "linear-gradient(180deg, #facc15, #eab308)", color: "#1a1306", fontWeight: 700, fontSize: 13, border: "none", borderRadius: 8, padding: "8px 16px", whiteSpace: "nowrap" }}
                >
                    {req.goLabel ?? "Go"} →
                </button>
            )}
        </div>
    );
}
