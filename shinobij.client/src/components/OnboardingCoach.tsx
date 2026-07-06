/*
 * OnboardingCoach - the forced first-session "Academy Path" shown to brand-new
 * shinobi. Every beat advances on the REAL action (teach-by-doing), never a
 * click-through, and the player can always Skip. Canonical flow:
 *
 *   academyIntro  -> framing modal ("Begin Academy Training" / "Skip Tutorial")
 *   starter       -> choose-your-companion (handled by StarterPetSelect overlay)
 *   training      -> start first stat training; advances when activeTraining set
 *   jutsu         -> train a jutsu; advances when jutsuMastery grows
 *   jutsuLoadout  -> equip that jutsu; advances when equippedJutsuIds grows
 *   inventory     -> equip starter gear; advances when any equipment slot is filled
 *   academySpar   -> first spar; the win advances to "cafeteria"
 *   cafeteria     -> "you've been hurt, heal yourself"; advances at full HP
 *   firstMission  -> claim first mission; advances when academyTrialClaimed
 *   logbook       -> open Logbook; advances when the Logbook is opened
 *   sectorReturn  -> visit any sector, then return to the village -> "done"
 *
 * State lives on character.onboardingStep (persisted, normalized via
 * normalizeOnboardingStep so legacy "spar"/"tour"/"storyUnlocked" saves keep
 * working). Rendered as an overlay alongside the ProfessionPicker in App.tsx.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import { normalizeOnboardingStep, type CanonicalOnboardingStep } from "../lib/onboarding-step";
import type { Character, Screen } from "../App";

const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9000,
    padding: 16,
};

const cardStyle: React.CSSProperties = {
    maxWidth: 460,
    width: "100%",
    maxHeight: "86vh",
    overflowY: "auto",
    textAlign: "center",
};

const bannerStyle: React.CSSProperties = {
    position: "fixed",
    left: "50%",
    bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
    transform: "translateX(-50%)",
    maxWidth: 560,
    width: "calc(100% - 24px)",
    background: "#1f2937",
    border: "1px solid #facc15",
    borderRadius: 12,
    padding: "12px 16px",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    zIndex: 9000,
    boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
};

const skipStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    color: "#9ca3af",
    textDecoration: "underline",
    cursor: "pointer",
    fontSize: 12,
    marginLeft: "auto",
};

const stepProgress: Partial<Record<CanonicalOnboardingStep, string>> = {
    academyIntro: "Academy Training - Step 1/10",
    training: "Academy Training - Step 2/10",
    jutsu: "Academy Training - Step 3/10",
    jutsuLoadout: "Academy Training - Step 4/10",
    inventory: "Academy Training - Step 5/10",
    academySpar: "Academy Training - Step 6/10",
    cafeteria: "Academy Training - Step 7/10",
    firstMission: "Academy Training - Step 8/10",
    logbook: "Academy Training - Step 9/10",
    sectorReturn: "Academy Training - Step 10/10",
};

function hasTrainedStarterJutsu(character: Character): boolean {
    return (character.jutsuMastery?.length ?? 0) >= 4;
}

function hasStarterLoadoutComplete(character: Character): boolean {
    return (character.equippedJutsuIds?.length ?? 0) >= 4;
}

function equippedItemCount(character: Character): number {
    return Object.values(character.equipment ?? {}).filter(Boolean).length;
}

export function OnboardingCoach({
    character,
    screen,
    activeTraining,
    currentSector,
    setScreen,
    updateCharacter,
    onStartSpar,
}: {
    character: Character;
    screen: Screen;
    activeTraining: unknown;
    currentSector: number;
    setScreen: (s: Screen) => void;
    updateCharacter: (c: Character) => void;
    onStartSpar: () => void;
}) {
    const step = normalizeOnboardingStep(character.onboardingStep);
    const jutsuBaselineRef = useRef<number | null>(null);
    const loadoutBaselineRef = useRef<number | null>(null);
    const equipmentBaselineRef = useRef<number | null>(null);
    const sectorVisitedRef = useRef(false);

    useEffect(() => {
        if (step === "training" && activeTraining) {
            updateCharacter({ ...character, onboardingStep: "jutsu" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, activeTraining]);

    useEffect(() => {
        if (step !== "jutsu") {
            jutsuBaselineRef.current = null;
            return;
        }
        const mastery = character.jutsuMastery?.length ?? 0;
        if (hasTrainedStarterJutsu(character)) {
            updateCharacter({ ...character, onboardingStep: "jutsuLoadout" });
            return;
        }
        if (jutsuBaselineRef.current === null) {
            jutsuBaselineRef.current = mastery;
            return;
        }
        if (mastery > jutsuBaselineRef.current) {
            updateCharacter({ ...character, onboardingStep: "jutsuLoadout" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, character.jutsuMastery]);

    useEffect(() => {
        if (step !== "jutsuLoadout") {
            loadoutBaselineRef.current = null;
            return;
        }
        const equipped = character.equippedJutsuIds?.length ?? 0;
        if (hasStarterLoadoutComplete(character)) {
            updateCharacter({ ...character, onboardingStep: "inventory" });
            return;
        }
        if (loadoutBaselineRef.current === null) {
            loadoutBaselineRef.current = equipped;
            return;
        }
        if (equipped > loadoutBaselineRef.current) {
            updateCharacter({ ...character, onboardingStep: "inventory" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, character.equippedJutsuIds]);

    useEffect(() => {
        if (step !== "inventory") {
            equipmentBaselineRef.current = null;
            return;
        }
        const equipped = equippedItemCount(character);
        if (equipped > 0) {
            updateCharacter({ ...character, onboardingStep: "academySpar" });
            return;
        }
        if (equipmentBaselineRef.current === null) {
            equipmentBaselineRef.current = equipped;
            return;
        }
        if (equipped > equipmentBaselineRef.current) {
            updateCharacter({ ...character, onboardingStep: "academySpar" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, character.equipment]);

    useEffect(() => {
        if (step === "cafeteria" && character.hp >= character.maxHp) {
            updateCharacter({ ...character, onboardingStep: "firstMission" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, character.hp, character.maxHp]);

    useEffect(() => {
        if (step === "firstMission" && character.academyTrialClaimed) {
            updateCharacter({ ...character, onboardingStep: "logbook" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, character.academyTrialClaimed]);

    useEffect(() => {
        if (step === "logbook" && screen === "logbook") {
            updateCharacter({ ...character, onboardingStep: "sectorReturn" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, screen]);

    useEffect(() => {
        if (step !== "sectorReturn") {
            sectorVisitedRef.current = false;
            return;
        }
        if (screen === "worldMap" && currentSector >= 1) {
            sectorVisitedRef.current = true;
        }
        if (sectorVisitedRef.current && screen === "village") {
            updateCharacter({ ...character, onboardingStep: "done" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, screen, currentSector]);

    useBodyScrollLock(step === "academyIntro" || step === "academySpar");

    if (step === "done" || step === "starter") return null;

    const skip = () => updateCharacter({ ...character, onboardingStep: "done" });
    const renderStepLabel = () => stepProgress[step] ? (
        <div style={{ color: "#facc15", fontWeight: 800, fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
            {stepProgress[step]}
        </div>
    ) : null;

    if (step === "academyIntro") {
        return createPortal(
            <div style={overlayStyle}>
                <div className="card" style={cardStyle}>
                    {renderStepLabel()}
                    <h2 style={{ marginTop: 0 }}>Welcome to {character.village}</h2>
                    <p style={{ lineHeight: 1.5 }}>
                        Welcome to Shinobi Journey, {character.name}. Before the village
                        trusts you with real missions, you&apos;ll complete <strong>Academy
                        Training</strong>: train your body, prepare your jutsu loadout,
                        equip starter gear, learn to fight, recover, and take your first
                        step beyond the village. It only takes a few minutes.
                    </p>
                    <button
                        className="start-primary-btn"
                        style={{ width: "100%" }}
                        onClick={() => updateCharacter({ ...character, onboardingStep: "starter" })}
                    >
                        Begin Academy Training
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
                <span style={{ flex: "1 1 260px", lineHeight: 1.4 }}><strong>{stepProgress[step]}:</strong> start your first stat training. Pick any stat and any timer.</span>
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
                <span style={{ flex: "1 1 260px", lineHeight: 1.4 }}><strong>{stepProgress[step]}:</strong> train one more jutsu. Pick an untrained jutsu and use the free Level 1 unlock.</span>
                {screen !== "jutsuTraining" && (
                    <button className="start-primary-btn" onClick={() => setScreen("jutsuTraining")}>Go to Jutsu Training</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    if (step === "jutsuLoadout") {
        return createPortal(
            <div className="onboarding-coach-banner" style={bannerStyle}>
                <span style={{ flex: "1 1 260px", lineHeight: 1.4 }}><strong>{stepProgress[step]}:</strong> put that trained jutsu in your loadout from Profile so it appears in battle.</span>
                {screen !== "profile" && (
                    <button className="start-primary-btn" onClick={() => setScreen("profile")}>Open Profile</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    if (step === "inventory") {
        return createPortal(
            <div className="onboarding-coach-banner" style={bannerStyle}>
                <span style={{ flex: "1 1 260px", lineHeight: 1.4 }}><strong>{stepProgress[step]}:</strong> equip a starter item from your Inventory. Your kunai or vest will help in the spar.</span>
                {screen !== "inventory" && (
                    <button className="start-primary-btn" onClick={() => setScreen("inventory")}>Open Inventory</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    if (step === "academySpar") {
        return createPortal(
            <div style={overlayStyle}>
                <div className="card" style={cardStyle}>
                    {renderStepLabel()}
                    <h2 style={{ marginTop: 0 }}>Your First Spar</h2>
                    <p style={{ lineHeight: 1.5 }}>
                        Time to test the loadout you prepared. A training dummy is waiting
                        at the Academy. Each turn you spend <strong>AP</strong> (action
                        points): use <strong>Basic Attack</strong> and your <strong>Jutsu</strong>
                        to deal damage, then press <strong>Wait</strong> when your AP runs low.
                        Drop the dummy&apos;s <strong>HP</strong> to zero to win.
                    </p>
                    <button
                        className="start-primary-btn"
                        style={{ width: "100%" }}
                        onClick={onStartSpar}
                    >
                        Begin Your First Spar
                    </button>
                    <button style={{ ...skipStyle, marginLeft: 0, marginTop: 10, display: "inline-block" }} onClick={skip}>
                        Skip Tutorial
                    </button>
                </div>
            </div>,
            document.body,
        );
    }

    if (step === "cafeteria") {
        return createPortal(
            <div className="onboarding-coach-banner" style={bannerStyle}>
                <span style={{ flex: "1 1 260px", lineHeight: 1.4 }}><strong>{stepProgress[step]}:</strong> oh, you&apos;ve been hurt. Heal yourself in the Cafeteria before moving on.</span>
                {screen !== "cafeteria" && (
                    <button className="start-primary-btn" onClick={() => setScreen("cafeteria")}>Go to Cafeteria</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    if (step === "firstMission") {
        return createPortal(
            <div className="onboarding-coach-banner" style={bannerStyle}>
                <span style={{ flex: "1 1 260px", lineHeight: 1.4 }}><strong>{stepProgress[step]}:</strong> claim your one-time Academy Trial reward at the Mission Hall.</span>
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
                <span style={{ flex: "1 1 260px", lineHeight: 1.4 }}><strong>{stepProgress[step]}:</strong> open your <strong>Logbook</strong> to see your Academy goals.</span>
                {screen !== "logbook" && (
                    <button className="start-primary-btn" onClick={() => setScreen("logbook")}>Open Logbook</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    if (step === "sectorReturn") {
        const visitedSector = screen === "worldMap" && currentSector >= 1;
        return createPortal(
            <div className="onboarding-coach-banner" style={bannerStyle}>
                <span style={{ flex: "1 1 260px", lineHeight: 1.4 }}><strong>{stepProgress[step]}:</strong> {visitedSector ? "good. Return to the village to complete Academy Training." : "open the World Map and travel to any numbered sector."}</span>
                {!visitedSector && screen !== "worldMap" && (
                    <button className="start-primary-btn" onClick={() => setScreen("worldMap")}>Open World Map</button>
                )}
                {visitedSector && (
                    <button className="start-primary-btn" onClick={() => setScreen("village")}>Return to Village</button>
                )}
                <button style={skipStyle} onClick={skip}>Skip</button>
            </div>,
            document.body,
        );
    }

    return null;
}
