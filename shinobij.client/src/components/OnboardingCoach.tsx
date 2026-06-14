/*
 * OnboardingCoach — the forced first-session "Academy Path" shown to brand-new
 * shinobi. Every beat advances on the REAL action (teach-by-doing), never a
 * click-through, and the player can always Skip. Canonical flow:
 *
 *   academyIntro  → framing modal ("Begin Academy Training" / "Skip Tutorial")
 *   starter       → choose-your-companion (handled by StarterPetSelect overlay)
 *   academySpar   → "Your First Spar" modal; the win advances to "training"
 *                   (the in-battle SparCoach guides the fight itself)
 *   training      → "start your first training"; advances when activeTraining set
 *   jutsu         → "unlock or equip a jutsu"; advances when jutsuMastery OR
 *                   equippedJutsuIds grows
 *   firstMission  → "claim your first mission"; advances when academyTrialClaimed
 *   logbook       → "open your Logbook"; advances when the Logbook is opened
 *   storyUnlocked → "village story unlocked"; advances when Story Hall is opened
 *                   (or the player dismisses) → "done"
 *
 * State lives on character.onboardingStep (persisted, normalized via
 * normalizeOnboardingStep so legacy "spar"/"tour" saves keep working). Rendered
 * as an overlay alongside the ProfessionPicker in App.tsx; inline styles so it
 * has no CSS-class dependency.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import { normalizeOnboardingStep } from "../lib/onboarding-step";
import type { Character, Screen } from "../App";

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
    character, screen, activeTraining, setScreen, updateCharacter, onStartSpar,
}: {
    character: Character;
    screen: Screen;
    activeTraining: unknown;
    setScreen: (s: Screen) => void;
    updateCharacter: (c: Character) => void;
    onStartSpar: () => void;
}) {
    const step = normalizeOnboardingStep(character.onboardingStep);
    const jutsuBaselineRef = useRef<{ mastery: number; equipped: number } | null>(null);

    // Advance the "training" beat once the player has actually started a training.
    useEffect(() => {
        if (step === "training" && activeTraining) {
            updateCharacter({ ...character, onboardingStep: "jutsu" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, activeTraining]);

    // Capture the jutsu-mastery + equipped counts when the "jutsu" beat starts,
    // then advance to "firstMission" once EITHER grows (the player unlocked a new
    // jutsu — the free Flicker — or equipped their 4th loadout slot).
    useEffect(() => {
        if (step !== "jutsu") { jutsuBaselineRef.current = null; return; }
        const mastery = character.jutsuMastery?.length ?? 0;
        const equipped = character.equippedJutsuIds?.length ?? 0;
        if (jutsuBaselineRef.current === null) { jutsuBaselineRef.current = { mastery, equipped }; return; }
        if (mastery > jutsuBaselineRef.current.mastery || equipped > jutsuBaselineRef.current.equipped) {
            updateCharacter({ ...character, onboardingStep: "firstMission" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, character.jutsuMastery, character.equippedJutsuIds]);

    // Advance the "firstMission" beat once the Academy Trial is claimed (the claim
    // is server-authoritative and sets academyTrialClaimed on the returned save).
    useEffect(() => {
        if (step === "firstMission" && character.academyTrialClaimed) {
            updateCharacter({ ...character, onboardingStep: "logbook" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, character.academyTrialClaimed]);

    // Open the Logbook (where the Academy Training checklist lives) → reveal the
    // village story as the final beat.
    useEffect(() => {
        if (step === "logbook" && screen === "logbook") {
            updateCharacter({ ...character, onboardingStep: "storyUnlocked" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, screen]);

    // Finish onboarding once the player visits the Story Hall (or dismisses the
    // final banner via "Got it").
    useEffect(() => {
        if (step === "storyUnlocked" && screen === "storyHall") {
            updateCharacter({ ...character, onboardingStep: "done" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, screen]);

    // The "academyIntro" and "academySpar" beats are full-screen modals; lock scroll.
    useBodyScrollLock(step === "academyIntro" || step === "academySpar");

    // "starter" is handled by the StarterPetSelect overlay; "done" needs no coach.
    if (step === "done" || step === "starter") return null;

    const skip = () => updateCharacter({ ...character, onboardingStep: "done" });

    if (step === "academyIntro") {
        return createPortal(
            <div style={overlayStyle}>
                <div className="card" style={cardStyle}>
                    <h2 style={{ marginTop: 0 }}>🎓 Welcome to the Academy</h2>
                    <p style={{ lineHeight: 1.5 }}>
                        Welcome to Shinobi Journey, {character.name}. Before the village
                        trusts you with real missions, you'll complete <strong>Academy
                        Training</strong> — learn to fight, train your body, unlock a jutsu,
                        and claim your first mission reward. It only takes a few minutes.
                    </p>
                    <button
                        className="start-primary-btn"
                        style={{ width: "100%" }}
                        onClick={() => updateCharacter({ ...character, onboardingStep: "starter" })}
                    >
                        Begin Academy Training →
                    </button>
                    <button style={{ ...skipStyle, marginLeft: 0, marginTop: 10, display: "inline-block" }} onClick={skip}>
                        Skip Tutorial
                    </button>
                </div>
            </div>,
            document.body,
        );
    }

    if (step === "academySpar") {
        return createPortal(
            <div style={overlayStyle}>
                <div className="card" style={cardStyle}>
                    <h2 style={{ marginTop: 0 }}>⚔️ Your First Spar</h2>
                    <p style={{ lineHeight: 1.5 }}>
                        Time to learn combat. A training dummy is waiting at the Academy.
                        Each turn you spend <strong>AP</strong> (action points): use
                        <strong> Basic Attack</strong> and your <strong>Jutsu</strong> to
                        deal damage, then <strong>End Turn</strong> when your AP runs low.
                        Drop the dummy's <strong>HP</strong> to zero to win — you've got this.
                    </p>
                    <button
                        className="start-primary-btn"
                        style={{ width: "100%" }}
                        onClick={onStartSpar}
                    >
                        Begin your first spar ⚔️
                    </button>
                    <button style={{ ...skipStyle, marginLeft: 0, marginTop: 10, display: "inline-block" }} onClick={skip}>
                        Skip Tutorial
                    </button>
                </div>
            </div>,
            document.body,
        );
    }

    if (step === "training") {
        return createPortal(
            <div className="onboarding-coach-banner" style={bannerStyle}>
                <span>📍 <strong>Academy Goal:</strong> start your first stat training. Pick any stat and timer, then start.</span>
                {screen !== "training" && (
                    <button className="start-primary-btn" onClick={() => setScreen("training")}>Go to Training Grounds</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    if (step === "jutsu") {
        return createPortal(
            <div className="onboarding-coach-banner" style={bannerStyle}>
                <span>📍 <strong>Academy Goal:</strong> unlock or equip a jutsu — your first unlock is free.</span>
                {screen !== "jutsuTraining" && (
                    <button className="start-primary-btn" onClick={() => setScreen("jutsuTraining")}>Go to Jutsu Training</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    if (step === "firstMission") {
        return createPortal(
            <div className="onboarding-coach-banner" style={bannerStyle}>
                <span>📍 <strong>Academy Goal:</strong> claim your first mission reward at the Mission Hall.</span>
                {screen !== "missions" && (
                    <button className="start-primary-btn" onClick={() => setScreen("missions")}>Go to Mission Hall</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    if (step === "logbook") {
        return createPortal(
            <div className="onboarding-coach-banner" style={bannerStyle}>
                <span>📍 <strong>Academy Goal:</strong> open your <strong>Logbook</strong> — your Academy goals live there.</span>
                {screen !== "logbook" && (
                    <button className="start-primary-btn" onClick={() => setScreen("logbook")}>Open Logbook</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    if (step === "storyUnlocked") {
        return createPortal(
            <div className="onboarding-coach-banner" style={bannerStyle}>
                <span>📜 <strong>Village Story unlocked!</strong> Visit the Story Hall when you're ready — your village's tale begins.</span>
                {screen !== "storyHall" && (
                    <button className="start-primary-btn" onClick={() => setScreen("storyHall")}>Go to Story Hall</button>
                )}
                <button style={skipStyle} onClick={() => updateCharacter({ ...character, onboardingStep: "done" })}>Got it</button>
            </div>,
            document.body,
        );
    }

    return null;
}
