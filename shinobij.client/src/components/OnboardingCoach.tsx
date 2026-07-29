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
 *   inventory     -> equip both starter gear pieces; advances when both are worn
 *   academySpar   -> first spar; the win advances to "cafeteria"
 *   cafeteria     -> "you've been hurt, heal yourself"; advances at full HP
 *   firstMission  -> claim first mission; advances when academyTrialClaimed
 *   logbook       -> open Logbook; advances when the Logbook is opened
 *   sectorReturn  -> visit any sector (latches character.academySectorVisited),
 *                    then return to the village -> "done". The "visited" milestone
 *                    is PERSISTED on the character rather than an ephemeral ref, so
 *                    it survives a coach remount (a sector-triggered battle hides
 *                    the coach), a refresh, or a snapshot revert of onboardingStep —
 *                    otherwise the beat could never complete and looped forever.
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
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import {
    ACADEMY_STARTER_GEAR_TARGET,
    academyEquippedItemCount,
    hasAcademyJutsuLoadoutComplete,
    hasAcademyStarterGearEquipped,
    hasAcademyTrainedExtraJutsu,
    normalizeOnboardingStep,
} from "../lib/onboarding-step";
import { companionStepMeta } from "../lib/journey-guide";
import { petPoseImage } from "../lib/pet-battle-anim";
import { isLowEndMobile, prefersReducedMotion } from "../lib/device-tier";
import type { Pet } from "../types/pet";
import type { Character, Screen } from "../App";
import "./onboarding-coach.css";

const IntroCompanion3D = lazy(() =>
    import("../features/intro-cinematic/IntroCompanion3D")
        .then((module) => ({ default: module.IntroCompanion3D })),
);

function TutorialCompanionModel({
    pet,
    fallbackSrc,
    className,
    label,
    enabled,
}: {
    pet: Pet;
    fallbackSrc: string;
    className: string;
    label: string;
    enabled: boolean;
}) {
    return (
        <Suspense
            fallback={(
                <img
                    className={`${className} coach-guide-pet-fallback`}
                    src={fallbackSrc}
                    alt={label}
                />
            )}
        >
            <IntroCompanion3D
                pet={pet}
                fallbackSrc={fallbackSrc}
                label={label}
                className={className}
                hero
                closeUp
                enabled={enabled}
            />
        </Suspense>
    );
}

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
    const coachMeta = companionStepMeta(step);
    const [confirmingSkip, setConfirmingSkip] = useState(false);
    const jutsuBaselineRef = useRef<number | null>(null);
    const loadoutBaselineRef = useRef<number | null>(null);
    const equipmentBaselineRef = useRef<number | null>(null);
    const reduced = prefersReducedMotion();
    const liteFx = isLowEndMobile();

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
        if (hasAcademyTrainedExtraJutsu(character)) {
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
        if (hasAcademyJutsuLoadoutComplete(character)) {
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
        const equipped = academyEquippedItemCount(character.equipment);
        if (hasAcademyStarterGearEquipped(character.equipment)) {
            updateCharacter({ ...character, onboardingStep: "academySpar" });
            return;
        }
        if (equipmentBaselineRef.current === null) {
            equipmentBaselineRef.current = equipped;
            return;
        }
        if (equipped > equipmentBaselineRef.current && equipped >= ACADEMY_STARTER_GEAR_TARGET) {
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
        if (step !== "sectorReturn") return;
        // Latch the "visited a sector" milestone onto the character the instant the
        // player reaches a numbered sector. Persisting it (vs. a component ref) is
        // what keeps the beat completable after the coach is unmounted mid-visit (a
        // sector-triggered battle sets screen "arena"), after a refresh, or after a
        // snapshot reverts onboardingStep — the old ref reset to false on every such
        // remount, so the return-home step could loop forever.
        if (screen === "worldMap" && currentSector >= 1 && !character.academySectorVisited) {
            updateCharacter({ ...character, academySectorVisited: true });
            return;
        }
        if (character.academySectorVisited && screen === "village") {
            updateCharacter({ ...character, onboardingStep: "done" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, screen, currentSector, character.academySectorVisited]);

    // A knocked-out player gets the non-blocking banner instead of the spar modal (see
    // the academySpar branch below), so they must keep page scroll — the Hospital's free
    // checkout button sits below the fold on a phone, and locking scroll here would put
    // the one recovery action out of reach.
    const sparKnockedOut = character.hospitalized === true || character.hp <= 0;
    useBodyScrollLock(step === "academySpar" && !sparKnockedOut);

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

    // True once the sector has been reached — either live (on the map, in a sector)
    // or from the persisted milestone, so the banner keeps saying "return home" even
    // after a remount/refresh instead of resetting to "go find a sector".
    const visitedSector =
        Boolean(character.academySectorVisited) || (screen === "worldMap" && currentSector >= 1);

    // The companion's coaching line for the current banner step. Plain strings
    // so the speech-bubble typewriter can slice them.
    const bannerText: string | null = (() => {
        switch (step) {
            case "training": return "Let's grow stronger together! Start your first stat training — pick any stat and any timer.";
            case "jutsu": return "Now train one more jutsu. Pick an untrained jutsu and use the free Level 1 unlock.";
            case "jutsuLoadout": {
                // Every new character starts with STARTING_STAT_POINTS (20) unspent, and
                // nothing in the tutorial mentioned them: the only prompt lives in the
                // Daily Briefing, which is suppressed until level 5 AND tutorial-complete,
                // and ScreenHint is gated on tutorial-complete too. So the single largest
                // immediate power spike stayed invisible for the whole first session.
                // This beat already sends the player to the Profile screen, which is where
                // stats are allocated, so it is the natural place to point it out.
                const base = "Put that trained jutsu in your loadout from your Profile so it appears in battle.";
                const points = Math.max(0, Math.floor(Number(character.unspentStats) || 0));
                return points > 0
                    ? `${base} While you are there, spend your ${points} stat point${points === 1 ? "" : "s"} — they do nothing sitting unused.`
                    : base;
            }
            case "inventory": {
                const equipped = academyEquippedItemCount(character.equipment);
                return `Equip both starter items from your Inventory (${Math.min(equipped, ACADEMY_STARTER_GEAR_TARGET)}/${ACADEMY_STARTER_GEAR_TARGET}). Put on the Rustfang Kunai and Shinobi Vest before the spar.`;
            }
            case "academySpar": return "That spar knocked you out. Get patched up at the Hospital — the free checkout only takes a minute — then we'll step back onto the mat.";
            case "cafeteria": return character.hp >= character.maxHp
                ? "You finished the spar at full HP, so there is nothing to heal. We can move on."
                : "The spar cost you HP. Recover in the Cafeteria before we move on.";
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
    const guideProgressLabel = coachMeta
        ? `${guideLabel} · Phase ${coachMeta.current.phase.index}/${coachMeta.current.phase.total}: ${coachMeta.current.phase.title} · Step ${coachMeta.current.index}/${coachMeta.totalCount}`
        : guideLabel;
    const guideProgressPercent = coachMeta
        ? Math.round((coachMeta.completedCount / coachMeta.totalCount) * 100)
        : 0;
    const talking = bannerText !== null && typedCount < bannerText.length;

    if (confirmingSkip) {
        return createPortal(
            <div style={overlayStyle}>
                <div className="card" style={{ ...cardStyle, maxWidth: 380 }}>
                    <h2 style={{ marginTop: 0 }}>Skip the Academy tutorial?</h2>
                    <p style={{ lineHeight: 1.5, color: "var(--slate-300)" }}>
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

    // The talking-companion banner: live model + speech bubble + actions.
    const renderGuideBanner = (action?: React.ReactNode) => createPortal(
        <div className="onboarding-coach-banner coach-guide" style={guideWrapStyle}>
            {guideArt && guidePet && (
                <TutorialCompanionModel
                    pet={guidePet}
                    fallbackSrc={guideArt}
                    label={`${guidePet.name}, your Academy guide`}
                    className={`coach-guide-pet ${talking ? "is-talking" : ""}`}
                    enabled={!liteFx && !reduced}
                />
            )}
            <div className="coach-guide-bubble">
                <div className="coach-guide-head">
                    <span className="coach-guide-label">{guideProgressLabel}</span>
                    {/* Skip lives up here, clear of the primary button below, and
                        opens a confirm — so it can't be fat-fingered into ending
                        the whole tutorial. */}
                    <button className="coach-skip-link" onClick={requestSkip}>Skip</button>
                </div>
                {coachMeta && (
                    <div
                        className="coach-guide-progress"
                        role="progressbar"
                        aria-label={`${coachMeta.completedCount} of ${coachMeta.totalCount} Academy steps complete`}
                        aria-valuemin={0}
                        aria-valuemax={coachMeta.totalCount}
                        aria-valuenow={coachMeta.completedCount}
                    >
                        <i style={{ width: `${guideProgressPercent}%` }} />
                    </div>
                )}
                <p className="coach-guide-line" aria-hidden="true">
                    {(bannerText ?? "").slice(0, typedCount)}
                </p>
                <span className="coach-guide-sr" aria-live="polite">{bannerText}</span>
                {coachMeta?.upNext && (
                    <p className="coach-guide-next"><strong>Up next:</strong> {coachMeta.upNext.title}</p>
                )}
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
        // A knocked-out player cannot spar, so the blocking modal must stand down.
        //
        // This beat is the only hard full-screen overlay in onboarding, and losing the
        // spar sets { hp: 0, hospitalized: true } and returns to the village — where the
        // modal covered everything again, offering only "Begin Your First Spar" (which
        // re-entered at 0 HP and lost again) or "Skip Tutorial" (which permanently ends
        // onboarding and forfeits the Academy Trial). Hospitalized players do not regen,
        // the one recovery hint lives in the Daily Briefing (suppressed for the whole
        // tutorial), and paid discharge costs 2,500 ryo against 100 starting ryo. So the
        // only exit was to abandon the tutorial.
        //
        // Falling back to the NON-blocking banner is what actually unsticks it: the modal
        // is `position: fixed; inset: 0`, so it also covered the Hospital screen the
        // player needed to reach. The banner leaves the Hospital usable (the free
        // 60-second checkout is there), and once HP is back the modal returns for the spar.
        if (sparKnockedOut) {
            return renderGuideBanner(screen !== "hospital" && (
                <button className="start-primary-btn" onClick={() => setScreen("hospital")}>Go to Hospital</button>
            ));
        }
        return createPortal(
            <div style={overlayStyle}>
                <div className="card" style={cardStyle}>
                    {guideArt && guidePet && (
                        <TutorialCompanionModel
                            pet={guidePet}
                            fallbackSrc={guideArt}
                            label={`${guidePet.name}, your Academy sparring guide`}
                            className="coach-guide-pet coach-guide-pet-modal"
                            enabled={!liteFx && !reduced}
                        />
                    )}
                    <div style={{ color: "var(--gold)", fontWeight: 800, fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                        {guideProgressLabel}
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
