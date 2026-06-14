/*
 * ScreenHint — one-time, dismissible contextual tips that replace the old
 * overwhelming village-menu tour. The first time a player opens one of the
 * mapped systems (Shop, Hospital, World Map, Pet Yard, Clan, Town Hall) they get
 * a single short line explaining it; "Got it" records the dismissal in
 * character.seenHints (persisted via the normal save).
 *
 * Driven from ONE mount in App.tsx keyed on the current `screen`. Only shows
 * once onboarding is finished (or skipped) so it never collides with the
 * OnboardingCoach banner during the guided Academy Path — and those guided beats
 * already cover Training/Jutsu/Missions/Logbook/Story, leaving exactly these six
 * "free roam" systems for ambient hints. Pinned bottom (reuses the coach
 * banner's mobile safe-area offset); never blocks interaction.
 */
import { createPortal } from "react-dom";
import { normalizeOnboardingStep } from "../lib/onboarding-step";
import type { Character, Screen } from "../App";

const HINTS: Partial<Record<Screen, string>> = {
    shop: "🛒 Shop — buy gear and consumables here with ryo.",
    hospital: "🏥 Hospital — heal up here after a hard fight.",
    worldMap: "🗺️ World Map — explore sectors for missions, pets, and materials.",
    pets: "🐾 Pet Yard — manage pets, expeditions, and your active companion.",
    clan: "🤝 Clan Hall — join a clan later when you want group progression.",
    townHall: "🏯 Town Hall — village upgrades improve your rewards and services.",
};

const bannerStyle: React.CSSProperties = {
    position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)",
    maxWidth: 520, width: "calc(100% - 24px)", background: "#0f172a",
    border: "1px solid #38bdf8", borderRadius: 12, padding: "10px 14px",
    display: "flex", alignItems: "center", gap: 10, color: "#e0f2fe",
    zIndex: 8500, boxShadow: "0 6px 24px rgba(0,0,0,0.5)", fontSize: 14,
};

export function ScreenHint({
    screen, character, updateCharacter,
}: {
    screen: Screen;
    character: Character;
    updateCharacter: (c: Character) => void;
}) {
    const text = HINTS[screen];
    if (!text) return null;
    // Don't compete with the guided coach; only ambient-hint once roaming freely.
    if (normalizeOnboardingStep(character.onboardingStep) !== "done") return null;
    if ((character.seenHints ?? []).includes(screen)) return null;

    const dismiss = () => updateCharacter({ ...character, seenHints: [...(character.seenHints ?? []), screen] });

    return createPortal(
        <div className="onboarding-coach-banner" style={bannerStyle}>
            <span style={{ flex: 1, lineHeight: 1.4 }}>{text}</span>
            <button
                className="start-primary-btn"
                style={{ flexShrink: 0 }}
                onClick={dismiss}
            >
                Got it
            </button>
        </div>,
        document.body,
    );
}
