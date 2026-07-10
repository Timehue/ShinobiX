/*
 * OnboardingCoach - the forced first-session "Academy Path" shown to brand-new
 * shinobi. Every beat advances on the REAL action (teach-by-doing), never a
 * click-through, and the player can always Skip. Canonical flow:
 *
 *   academyIntro  -> the intro cinematic (features/intro-cinematic): the spirit
 *                    fox summons the player and gifts the starter companion,
 *                    then advances straight to "training". The coach renders
 *                    nothing for it (and for the legacy "starter" beat, which
 *                    the cinematic also absorbs).
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
 * The chosen companion IS the guide: every banner/modal shows the starter pet's
 * pose portrait + name (guidePet, resolved by App from activePetId) and the
 * coaching lines are voiced by it. Falls back to a plain "Academy Guide" label
 * when no pet exists (skipped grant / legacy save).
 *
 * State lives on character.onboardingStep (persisted, normalized via
 * normalizeOnboardingStep so legacy "spar"/"tour"/"storyUnlocked" saves keep
 * working). Rendered as an overlay alongside the ProfessionPicker in App.tsx.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import { normalizeOnboardingStep, type CanonicalOnboardingStep } from "../lib/onboarding-step";
import { petPoseImage } from "../lib/pet-battle-anim";
import type { Pet } from "../types/pet";
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

// Circular chip for the companion's transparent pose cutout.
const guidePortraitStyle: React.CSSProperties = {
    width: 46,
    height: 46,
    borderRadius: "50%",
    objectFit: "contain",
    background: "radial-gradient(circle, rgba(30,41,59,0.95), rgba(2,6,23,0.9))",
    border: "1px solid #facc15",
    flexShrink: 0,
    padding: 2,
};

const stepProgress: Partial<Record<CanonicalOnboardingStep, string>> = {
    training: "Academy Training - Step 1/9",
    jutsu: "Academy Training - Step 2/9",
    jutsuLoadout: "Academy Training - Step 3/9",
    inventory: "Academy Training - Step 4/9",
    academySpar: "Academy Training - Step 5/9",
    cafeteria: "Academy Training - Step 6/9",
    firstMission: "Academy Training - Step 7/9",
    logbook: "Academy Training - Step 8/9",
    sectorReturn: "Academy Training - Step 9/9",
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
    guidePet = null,
    sharedImages = {},
    setScreen,
    updateCharacter,
    onStartSpar,
}: {
    character: Character;
    screen: Screen;
    activeTraining: unknown;
    currentSector: number;
    guidePet?: Pet | null;
    sharedImages?: Record<string, string>;
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

    useBodyScrollLock(step === "academySpar");

    // academyIntro + starter belong to the intro cinematic, not the coach.
    if (step === "done" || step === "starter" || step === "academyIntro") return null;

    const skip = () => updateCharacter({ ...character, onboardingStep: "done" });
    const guideArt = guidePet ? petPoseImage(guidePet, sharedImages) : "";
    const guideLabel = guidePet ? `${guidePet.name} — your companion` : "Academy Guide";

    // Banner body: companion portrait + "who's talking" strip + the coaching line.
    const renderGuide = (text: React.ReactNode) => (
        <>
            {guideArt && (
                <img
                    src={guideArt}
                    alt=""
                    style={guidePortraitStyle}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
            )}
            <span style={{ flex: "1 1 220px", lineHeight: 1.4 }}>
                <span style={{ display: "block", color: "#facc15", fontWeight: 800, fontSize: 10.5, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 }}>
                    {guideLabel} · {stepProgress[step]}
                </span>
                {text}
            </span>
        </>
    );

    if (step === "training") {
        return createPortal(
            <div className="onboarding-coach-banner" style={bannerStyle}>
                {renderGuide(<>Let&apos;s grow stronger together! Start your first stat training — pick any stat and any timer.</>)}
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
                {renderGuide(<>Now train one more jutsu. Pick an untrained jutsu and use the free Level 1 unlock.</>)}
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
                {renderGuide(<>Put that trained jutsu in your loadout from your Profile so it appears in battle.</>)}
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
                {renderGuide(<>Equip a starter item from your Inventory. Your kunai or vest will help in the spar.</>)}
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
                    {guideArt && (
                        <img
                            src={guideArt}
                            alt=""
                            style={{ ...guidePortraitStyle, width: 64, height: 64, margin: "0 auto 6px", display: "block" }}
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                    )}
                    <div style={{ color: "#facc15", fontWeight: 800, fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                        {guideLabel} · {stepProgress[step]}
                    </div>
                    <h2 style={{ marginTop: 0 }}>Your First Spar</h2>
                    <p style={{ lineHeight: 1.5 }}>
                        Time to test the loadout we prepared. A training dummy is waiting
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
                {renderGuide(<>Oh no, you&apos;ve been hurt! Heal yourself in the Cafeteria before we move on.</>)}
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
                {renderGuide(<>Claim your one-time Academy Trial reward at the Mission Hall.</>)}
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
                {renderGuide(<>Open your <strong>Logbook</strong> to see our Academy goals.</>)}
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
                {renderGuide(visitedSector
                    ? <>Well done! Return to the village to complete Academy Training.</>
                    : <>Open the World Map and travel to any numbered sector.</>)}
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
