import type { Screen } from "../types/core";
import type { Character } from "../types/character";
import { baseStats, rankFromLevel } from "./stats";
import {
    normalizeOnboardingStep,
    onboardingStepAtLeast,
    type CanonicalOnboardingStep,
} from "./onboarding-step";

// ── Companion guided steps ───────────────────────────────────────────────────
// While the Academy tutorial is running, the village panel shows the starter
// companion's step checklist (one source of truth with the OnboardingCoach
// bubble — same 9 beats, status-only, no duplicate action buttons) instead of
// the old Journey Guide objectives, which repeated the coach's instructions.

export type CompanionStepState = "done" | "now" | "upNext" | "later";
export type CompanionPhaseId = "prepare" | "prove" | "direction";

export type CompanionPhase = {
    id: CompanionPhaseId;
    title: string;
    summary: string;
    index: number;
    total: number;
};

export type CompanionStep = {
    id: CanonicalOnboardingStep;
    title: string;
    detail: string;
    phase: CompanionPhase;
    index: number;
    total: number;
    state: CompanionStepState;
};

const COMPANION_PHASES: Record<CompanionPhaseId, Omit<CompanionPhase, "index" | "total">> = {
    prepare: {
        id: "prepare",
        title: "Prepare",
        summary: "Begin long-running growth and ready a complete battle kit.",
    },
    prove: {
        id: "prove",
        title: "Prove Yourself",
        summary: "Use the real combat and reward loop in a safe Academy trial.",
    },
    direction: {
        id: "direction",
        title: "Find Direction",
        summary: "Learn where progression lives, then step into the wider world.",
    },
};

const COMPANION_PHASE_ORDER: CompanionPhaseId[] = ["prepare", "prove", "direction"];

type CompanionStepDefinition = {
    id: CanonicalOnboardingStep;
    title: string;
    detail: string;
    phaseId: CompanionPhaseId;
};

const COMPANION_STEP_DEFINITIONS: CompanionStepDefinition[] = [
    { id: "training", title: "Start your first stat training", detail: "Start a timer that keeps building your shinobi while you play.", phaseId: "prepare" },
    { id: "jutsu", title: "Train a new jutsu", detail: "Learn one technique beyond your four inherited bloodline jutsu.", phaseId: "prepare" },
    { id: "jutsuLoadout", title: "Equip your jutsu loadout", detail: "Put four techniques on the action bar you will use in battle.", phaseId: "prepare" },
    { id: "inventory", title: "Equip your starter gear", detail: "Ready both Academy items so their combat stats apply.", phaseId: "prepare" },
    { id: "academySpar", title: "Win your first spar", detail: "Practice AP, targeting, jutsu, and Wait against a training dummy.", phaseId: "prove" },
    { id: "cafeteria", title: "Recover in the Cafeteria", detail: "Learn where to restore HP after a fight.", phaseId: "prove" },
    { id: "firstMission", title: "Claim the Academy Trial", detail: "Complete the fight-to-claim reward loop at the Mission Hall.", phaseId: "prove" },
    { id: "logbook", title: "Open your Logbook", detail: "See the persistent goals that replace tutorial instructions.", phaseId: "direction" },
    { id: "sectorReturn", title: "Visit a sector and return", detail: "Practice safe travel before choosing your first field objective.", phaseId: "direction" },
];

/** The tutorial checklist, or null when the tutorial isn't in a coach beat
 *  (cinematic steps and "done" both return null → panel hidden). */
function companionPhase(phaseId: CompanionPhaseId): CompanionPhase {
    const phase = COMPANION_PHASES[phaseId];
    return {
        ...phase,
        index: COMPANION_PHASE_ORDER.indexOf(phaseId) + 1,
        total: COMPANION_PHASE_ORDER.length,
    };
}

export type CompanionJourney = {
    steps: CompanionStep[];
    current: CompanionStep;
    completedCount: number;
    totalCount: number;
    phases: CompanionPhase[];
};

/** Complete presentation metadata for the nine interactive Academy beats. */
export function buildCompanionJourney(character: Pick<Character, "onboardingStep">): CompanionJourney | null {
    const currentStep = normalizeOnboardingStep(character.onboardingStep ?? "");
    const currentIndex = COMPANION_STEP_DEFINITIONS.findIndex((definition) => definition.id === currentStep);
    if (currentIndex < 0) return null;

    const totalCount = COMPANION_STEP_DEFINITIONS.length;
    const steps = COMPANION_STEP_DEFINITIONS.map((definition, index): CompanionStep => ({
        id: definition.id,
        title: definition.title,
        detail: definition.detail,
        phase: companionPhase(definition.phaseId),
        index: index + 1,
        total: totalCount,
        state:
            index < currentIndex
                ? "done"
                : index === currentIndex
                    ? "now"
                    : index === currentIndex + 1
                        ? "upNext"
                        : "later",
    }));

    return {
        steps,
        current: steps[currentIndex],
        completedCount: currentIndex,
        totalCount,
        phases: COMPANION_PHASE_ORDER.map(companionPhase),
    };
}

/** Compatibility selector for the village checklist. */
export function buildCompanionSteps(character: Pick<Character, "onboardingStep">): CompanionStep[] | null {
    return buildCompanionJourney(character)?.steps ?? null;
}

/** Shared coach/checklist metadata so phase, step count, and "up next" copy
 * cannot drift between the bottom speech bubble and village roadmap. */
export function companionStepMeta(step: CanonicalOnboardingStep): {
    current: CompanionStep;
    upNext: CompanionStep | null;
    completedCount: number;
    totalCount: number;
} | null {
    const journey = buildCompanionJourney({ onboardingStep: step });
    if (!journey) return null;
    return {
        current: journey.current,
        upNext: journey.steps[journey.current.index] ?? null,
        completedCount: journey.completedCount,
        totalCount: journey.totalCount,
    };
}

export type JourneyGuideObjective = {
    id: "training" | "jutsu" | "combat" | "mission" | "logbook";
    title: string;
    detail: string;
    actionLabel: string;
    screen: Screen;
    complete: boolean;
};

export type JourneyGuideState = {
    shouldShow: boolean;
    objectives: JourneyGuideObjective[];
    completedCount: number;
    totalCount: number;
    primaryObjective: JourneyGuideObjective | null;
};

function trainedStatPoints(character: Character): number {
    if (typeof character.totalStatsTrained === "number") {
        return Math.max(0, Math.floor(character.totalStatsTrained));
    }
    const baseline = Object.values(baseStats()).reduce((sum, value) => sum + value, 0);
    const current = Object.values(character.stats ?? baseStats()).reduce((sum, value) => sum + value, 0);
    return Math.max(0, current - baseline);
}

function hasStarterLoadout(character: Character): boolean {
    return (character.equippedJutsuIds?.length ?? 0) >= 4;
}

export function buildJourneyGuide(character: Character): JourneyGuideState {
    const trainedPoints = trainedStatPoints(character);
    const pendingCombatClaim = (character.pendingCombatMissionClaims?.length ?? 0) > 0;
    const step = normalizeOnboardingStep(character.onboardingStep ?? "");
    const startedTraining = trainedPoints > 0 || onboardingStepAtLeast(step, "jutsu");
    const hasLoadout = hasStarterLoadout(character) || onboardingStepAtLeast(step, "inventory");
    const wonFirstFight = (character.totalAiKills ?? 0) > 0 || pendingCombatClaim || onboardingStepAtLeast(step, "cafeteria");
    const claimedFirstMission = Boolean(character.academyTrialClaimed) || onboardingStepAtLeast(step, "logbook") || Math.max(character.totalMissionsCompleted ?? 0, character.clanMissionContrib ?? 0) > 0;
    const openedLogbook = Boolean(character.academyChecklistClaimed) || onboardingStepAtLeast(step, "sectorReturn");

    const objectives: JourneyGuideObjective[] = [
        {
            id: "training",
            title: "Start your first training session",
            detail: trainedPoints > 0
                ? `${trainedPoints} stat point${trainedPoints === 1 ? "" : "s"} trained. Keep raising your core stats between missions.`
                : startedTraining
                    ? "Training started. Collect it when the timer finishes; you can keep learning meanwhile."
                : "Start with Strength or Speed if you are unsure. Short timers are easiest while learning.",
            actionLabel: startedTraining ? "View Training" : "Begin Training",
            screen: "training",
            complete: startedTraining,
        },
        {
            id: "jutsu",
            title: "Ready your jutsu loadout",
            detail: hasLoadout
                ? "Your starter loadout is ready for rookie fights."
                : "Unlock or equip enough jutsu to keep a full starter loadout.",
            actionLabel: "Open Jutsu Hall",
            screen: "jutsuTraining",
            complete: hasLoadout,
        },
        {
            id: "combat",
            title: "Win your first fight",
            detail: pendingCombatClaim
                ? "Victory is recorded. Return to the Mission Hall to claim the reward."
                : wonFirstFight
                    ? "First combat cleared. The battle log shows what happened each turn."
                    : "Use the E-Rank Drill when you are ready: Attack or jutsu, then Wait when AP runs low.",
            actionLabel: pendingCombatClaim ? "Claim Mission" : "Find First Fight",
            screen: "missions",
            complete: wonFirstFight,
        },
        {
            id: "mission",
            title: "Claim a first mission reward",
            detail: claimedFirstMission
                ? "You have claimed an early mission reward. Repeat missions for XP and ryo."
                : "After a mission fight, come back to the Mission Hall and claim the posted reward.",
            actionLabel: "Open Mission Hall",
            screen: "missions",
            complete: claimedFirstMission,
        },
        {
            id: "logbook",
            title: "Open your Logbook",
            detail: character.academyChecklistClaimed
                ? "Academy checklist claimed. Your next rank goals live in the Logbook."
                : "The Logbook tracks the next unlocks without forcing you through a tutorial.",
            actionLabel: "Open Logbook",
            screen: "logbook",
            complete: openedLogbook,
        },
    ];

    const completedCount = objectives.filter((objective) => objective.complete).length;
    const primaryObjective = objectives.find((objective) => !objective.complete) ?? null;
    const academyRank = rankFromLevel(character.level) === "Academy Student";
    const shouldShow = academyRank && step !== "done" && Boolean(primaryObjective);

    return {
        shouldShow,
        objectives,
        completedCount,
        totalCount: objectives.length,
        primaryObjective,
    };
}
