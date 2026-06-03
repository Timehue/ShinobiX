/*
 * OnboardingCoach — the forced first-session sequence shown to brand-new
 * shinobi right after the Village Lore screen. Three beats, each advancing on
 * the REAL action (teach-by-doing), not a click-through:
 *
 *   tour     → explain the village menu (modal), then send to Stat Training
 *   training → "start your first training"; advances when activeTraining is set
 *   jutsu    → "unlock your first jutsu (free)"; advances when a new jutsuMastery
 *              entry appears (the player free-unlocks Flicker at the Jutsu Hall)
 *
 * State lives on character.onboardingStep (persisted). A "Skip" link is always
 * available so a player can never be trapped. Rendered as an overlay alongside
 * the ProfessionPicker in App.tsx; uses inline styles so it has no CSS-class
 * dependency.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Character, Screen } from "../App";

const MENU_TOUR: { icon: string; name: string; blurb: string }[] = [
    { icon: "📜", name: "Mission Hall", blurb: "Take missions for XP, ryo, and your Academy goals." },
    { icon: "💪", name: "Stat Training", blurb: "Train your stats over time to grow stronger." },
    { icon: "🔥", name: "Jutsu Training", blurb: "Learn and level your jutsu — your first unlock is free." },
    { icon: "⚔️", name: "Battle Arena", blurb: "Fight to test your build and complete missions." },
    { icon: "🗺️", name: "World Map", blurb: "Explore sectors and hunt for materials." },
    { icon: "🛒", name: "Shop", blurb: "Buy gear and consumables with ryo." },
    { icon: "🏥", name: "Hospital", blurb: "Recover after a tough loss." },
];

const overlayStyle: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 9000, padding: 16,
};
const cardStyle: React.CSSProperties = {
    maxWidth: 460, width: "100%", maxHeight: "86vh", overflowY: "auto",
    textAlign: "center",
};
const bannerStyle: React.CSSProperties = {
    position: "fixed", left: "50%", bottom: 16, transform: "translateX(-50%)",
    maxWidth: 560, width: "calc(100% - 24px)", background: "#1f2937",
    border: "1px solid #facc15", borderRadius: 12, padding: "12px 16px",
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
    zIndex: 9000, boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
};
const skipStyle: React.CSSProperties = {
    background: "none", border: "none", color: "#9ca3af",
    textDecoration: "underline", cursor: "pointer", fontSize: 12, marginLeft: "auto",
};

export function OnboardingCoach({
    character, screen, activeTraining, setScreen, updateCharacter,
}: {
    character: Character;
    screen: Screen;
    activeTraining: unknown;
    setScreen: (s: Screen) => void;
    updateCharacter: (c: Character) => void;
}) {
    const step = character.onboardingStep;
    const jutsuBaselineRef = useRef<number | null>(null);

    // Advance the "training" beat once the player has actually started a training.
    useEffect(() => {
        if (step === "training" && activeTraining) {
            updateCharacter({ ...character, onboardingStep: "jutsu" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, activeTraining]);

    // Capture the jutsu-mastery count when the "jutsu" beat starts, then advance
    // once it grows (the player free-unlocked a new jutsu).
    useEffect(() => {
        if (step !== "jutsu") { jutsuBaselineRef.current = null; return; }
        const count = character.jutsuMastery?.length ?? 0;
        if (jutsuBaselineRef.current === null) { jutsuBaselineRef.current = count; return; }
        if (count > jutsuBaselineRef.current) {
            updateCharacter({ ...character, onboardingStep: "done" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, character.jutsuMastery]);

    if (!step || step === "done") return null;

    const skip = () => updateCharacter({ ...character, onboardingStep: "done" });

    if (step === "tour") {
        return createPortal(
            <div style={overlayStyle}>
                <div className="card" style={cardStyle}>
                    <h2 style={{ marginTop: 0 }}>Welcome, {character.name}!</h2>
                    <p>This is your village. Here's where everything is:</p>
                    <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
                        {MENU_TOUR.map((m) => (
                            <li key={m.name} style={{ marginBottom: 8, lineHeight: 1.35 }}>
                                <span style={{ marginRight: 6 }}>{m.icon}</span>
                                <strong>{m.name}</strong> — {m.blurb}
                            </li>
                        ))}
                    </ul>
                    <button
                        className="start-primary-btn"
                        style={{ width: "100%" }}
                        onClick={() => { updateCharacter({ ...character, onboardingStep: "training" }); setScreen("training"); }}
                    >
                        Start my first training →
                    </button>
                    <button style={{ ...skipStyle, marginLeft: 0, marginTop: 10, display: "inline-block" }} onClick={skip}>
                        Skip tutorial
                    </button>
                </div>
            </div>,
            document.body,
        );
    }

    if (step === "training") {
        return createPortal(
            <div style={bannerStyle}>
                <span>📍 <strong>Tutorial:</strong> pick a stat and a timer, then start your first training.</span>
                {screen !== "training" && (
                    <button className="start-primary-btn" onClick={() => setScreen("training")}>Go to Stat Training</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    if (step === "jutsu") {
        return createPortal(
            <div style={bannerStyle}>
                <span>📍 <strong>Tutorial:</strong> unlock your first jutsu — it's free. Pick one and press Unlock.</span>
                {screen !== "jutsuTraining" && (
                    <button className="start-primary-btn" onClick={() => setScreen("jutsuTraining")}>Go to Jutsu Training</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    return null;
}
