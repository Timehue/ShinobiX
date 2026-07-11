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
 * The chosen companion IS the guide, presented as a talking character: the
 * pet's full-body 2.5D pose standee (the coliseum cutout art via petPoseImage)
 * stands beside a speech bubble with a typewriter line — not a flat menu bar.
 * guidePet is resolved by App from activePetId; with no pet (skipped grant /
 * legacy save) the bubble runs alone under a plain "Academy Guide" label.
 *
 * State lives on character.onboardingStep (persisted, normalized via
 * normalizeOnboardingStep so legacy "spar"/"tour"/"storyUnlocked" saves keep
 * working). Rendered as an overlay alongside the ProfessionPicker in App.tsx.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import { normalizeOnboardingStep, type CanonicalOnboardingStep } from "../lib/onboarding-step";
import { petPoseImage } from "../lib/pet-battle-anim";
import { prefersReducedMotion } from "../lib/device-tier";
import type { Pet } from "../types/pet";
import type { Character, Screen } from "../App";
import "./onboarding-coach.css";

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

// Fixed anchor for the talking-companion banner. Centered like the old pill
// bar (the left edge belongs to the desktop profile rail, z 10000 > our 9000);
// index.css's `.onboarding-coach-banner` mobile override lifts `bottom` above
// the bottom nav.
const guideWrapStyle: React.CSSProperties = {
    position: "fixed",
    left: "50%",
    bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
    transform: "translateX(-50%)",
    maxWidth: 620,
    width: "calc(100% - 24px)",
    zIndex: 9000,
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
    const [confirmingSkip, setConfirmingSkip] = useState(false);
    const jutsuBaselineRef = useRef<number | null>(null);
    const loadoutBaselineRef = useRef<number | null>(null);
    const equipmentBaselineRef = useRef<number | null>(null);
    const sectorVisitedRef = useRef(false);
    const reduced = prefersReducedMotion();

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

    // While the bottom coaching banner is on screen, reserve space under the
    // scroll area on mobile so the current screen's OWN bottom controls (e.g.
    // Training's timer tiles) sit ABOVE the banner — visible and tappable, not
    // hidden behind it. The modal steps (spar / skip-confirm) don't need it.
    const bannerVisible =
        !confirmingSkip &&
        (step === "training" || step === "jutsu" || step === "jutsuLoadout" ||
         step === "inventory" || step === "cafeteria" || step === "firstMission" ||
         step === "logbook" || step === "sectorReturn");
    useEffect(() => {
        if (!bannerVisible) return;
        document.body.classList.add("coach-banner-open");
        return () => document.body.classList.remove("coach-banner-open");
    }, [bannerVisible]);

    const visitedSector = screen === "worldMap" && currentSector >= 1;

    // The companion's coaching line for the current banner step. Plain strings
    // so the speech-bubble typewriter can slice them.
    const bannerText: string | null = (() => {
        switch (step) {
            case "training": return "Let's grow stronger together! Start your first stat training — pick any stat and any timer.";
            case "jutsu": return "Now train one more jutsu. Pick an untrained jutsu and use the free Level 1 unlock.";
            case "jutsuLoadout": return "Put that trained jutsu in your loadout from your Profile so it appears in battle.";
            case "inventory": return "Equip a starter item from your Inventory. Your kunai or vest will help in the spar.";
            case "cafeteria": return "Oh no, you've been hurt! Heal yourself in the Cafeteria before we move on.";
            case "firstMission": return "Claim your one-time Academy Trial reward at the Mission Hall.";
            case "logbook": return "Open your Logbook to see our Academy goals.";
            case "sectorReturn": return visitedSector
                ? "Well done! Return to the village to complete Academy Training."
                : "Open the World Map and travel to any numbered sector.";
            default: return null;
        }
    })();

    // Speech-bubble typewriter, keyed to the line it belongs to (same
    // interval-only pattern as the intro cinematic — no setState in the effect
    // body). Step changes re-type; reduced motion shows lines whole.
    const [typed, setTyped] = useState<{ text: string; count: number }>({ text: "", count: 0 });
    useEffect(() => {
        if (!bannerText || reduced) return;
        let c = 0;
        const id = window.setInterval(() => {
            c = Math.min(bannerText.length, c + 2);
            setTyped({ text: bannerText, count: c });
            if (c >= bannerText.length) window.clearInterval(id);
        }, 18);
        return () => window.clearInterval(id);
    }, [bannerText, reduced]);
    const typedCount = !bannerText || reduced
        ? bannerText?.length ?? 0
        : typed.text === bannerText ? typed.count : 0;

    // academyIntro/starter/companionIntro belong to the intro cinematic and
    // the companion's village-intro beat, not the coach.
    if (step === "done" || step === "starter" || step === "academyIntro" || step === "companionIntro") return null;

    // Skipping wipes the WHOLE tutorial, so it always goes through a confirm —
    // an accidental tap (e.g. reaching for a control the banner overlaps on
    // mobile) must never silently end onboarding.
    const doSkip = () => updateCharacter({ ...character, onboardingStep: "done" });
    const requestSkip = () => setConfirmingSkip(true);
    const guideArt = guidePet ? petPoseImage(guidePet, sharedImages) : "";
    const guideLabel = guidePet ? `${guidePet.name} — your companion` : "Academy Guide";
    const talking = bannerText !== null && typedCount < bannerText.length;

    if (confirmingSkip) {
        return createPortal(
            <div style={overlayStyle}>
                <div className="card" style={{ ...cardStyle, maxWidth: 380 }}>
                    <h2 style={{ marginTop: 0 }}>Skip the Academy tutorial?</h2>
                    <p style={{ lineHeight: 1.5, color: "#cbd5e1" }}>
                        It walks you through your first training, jutsu, gear, spar, and
                        rewards. You can’t easily restart it once it’s skipped.
                    </p>
                    <button className="start-primary-btn" style={{ width: "100%" }} onClick={() => setConfirmingSkip(false)}>
                        Keep going
                    </button>
                    <button style={{ ...skipStyle, marginLeft: 0, marginTop: 10, display: "inline-block" }} onClick={doSkip}>
                        Yes, skip the tutorial
                    </button>
                </div>
            </div>,
            document.body,
        );
    }

    // The talking-companion banner: pose standee + speech bubble + actions.
    const renderGuideBanner = (action?: React.ReactNode) => createPortal(
        <div className="onboarding-coach-banner coach-guide" style={guideWrapStyle}>
            {guideArt && (
                <img
                    src={guideArt}
                    alt=""
                    className={`coach-guide-pet ${talking ? "is-talking" : ""}`}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
            )}
            <div className="coach-guide-bubble">
                <div className="coach-guide-head">
                    <span className="coach-guide-label">{guideLabel} · {stepProgress[step]}</span>
                    {/* Skip lives up here, clear of the primary button below, and
                        opens a confirm — so it can't be fat-fingered into ending
                        the whole tutorial. */}
                    <button className="coach-skip-link" onClick={requestSkip}>Skip</button>
                </div>
                <p className="coach-guide-line">{(bannerText ?? "").slice(0, typedCount)}</p>
                {action && <div className="coach-guide-actions">{action}</div>}
            </div>
        </div>,
        document.body,
    );

    if (step === "training") {
        return renderGuideBanner(screen !== "training" && (
            <button className="start-primary-btn" onClick={() => setScreen("training")}>Go to Training Grounds</button>
        ));
    }

    if (step === "jutsu") {
        return renderGuideBanner(screen !== "jutsuTraining" && (
            <button className="start-primary-btn" onClick={() => setScreen("jutsuTraining")}>Go to Jutsu Training</button>
        ));
    }

    if (step === "jutsuLoadout") {
        return renderGuideBanner(screen !== "profile" && (
            <button className="start-primary-btn" onClick={() => setScreen("profile")}>Open Profile</button>
        ));
    }

    if (step === "inventory") {
        return renderGuideBanner(screen !== "inventory" && (
            <button className="start-primary-btn" onClick={() => setScreen("inventory")}>Open Inventory</button>
        ));
    }

    if (step === "academySpar") {
        return createPortal(
            <div style={overlayStyle}>
                <div className="card" style={cardStyle}>
                    {guideArt && (
                        <img
                            src={guideArt}
                            alt=""
                            style={{ width: 96, height: 96, objectFit: "contain", display: "block", margin: "0 auto 4px", filter: "drop-shadow(0 8px 10px rgba(0,0,0,0.5))" }}
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
                    <button style={{ ...skipStyle, marginLeft: 0, marginTop: 10, display: "inline-block" }} onClick={requestSkip}>
                        Skip Tutorial
                    </button>
                </div>
            </div>,
            document.body,
        );
    }

    if (step === "cafeteria") {
        return renderGuideBanner(screen !== "cafeteria" && (
            <button className="start-primary-btn" onClick={() => setScreen("cafeteria")}>Go to Cafeteria</button>
        ));
    }

    if (step === "firstMission") {
        return renderGuideBanner(screen !== "missions" && (
            <button className="start-primary-btn" onClick={() => setScreen("missions")}>Go to Mission Hall</button>
        ));
    }

    if (step === "logbook") {
        return renderGuideBanner(screen !== "logbook" && (
            <button className="start-primary-btn" onClick={() => setScreen("logbook")}>Open Logbook</button>
        ));
    }

    if (step === "sectorReturn") {
        return renderGuideBanner(
            <>
                {!visitedSector && screen !== "worldMap" && (
                    <button className="start-primary-btn" onClick={() => setScreen("worldMap")}>Open World Map</button>
                )}
                {visitedSector && (
                    <button className="start-primary-btn" onClick={() => setScreen("village")}>Return to Village</button>
                )}
            </>,
        );
    }

    return null;
}
