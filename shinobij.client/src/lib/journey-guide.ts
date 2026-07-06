import type { Screen } from "../types/core";
import type { Character } from "../types/character";
import { baseStats, rankFromLevel } from "./stats";
import { normalizeOnboardingStep, onboardingStepAtLeast } from "./onboarding-step";

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
    return (character.equippedJutsuIds?.length ?? 0) >= 4 || (character.jutsuMastery?.length ?? 0) >= 4;
}

export function buildJourneyGuide(character: Character): JourneyGuideState {
    const trainedPoints = trainedStatPoints(character);
    const pendingCombatClaim = (character.pendingCombatMissionClaims?.length ?? 0) > 0;
    const step = normalizeOnboardingStep(character.onboardingStep ?? "");
    const startedTraining = trainedPoints > 0 || onboardingStepAtLeast(step, "jutsu");
    const hasLoadout = hasStarterLoadout(character) || onboardingStepAtLeast(step, "firstMission");
    const wonFirstFight = (character.totalAiKills ?? 0) > 0 || pendingCombatClaim || onboardingStepAtLeast(step, "training");
    const claimedFirstMission = Boolean(character.academyTrialClaimed) || onboardingStepAtLeast(step, "logbook") || Math.max(character.totalMissionsCompleted ?? 0, character.clanMissionContrib ?? 0) > 0;
    const openedLogbook = Boolean(character.academyChecklistClaimed) || onboardingStepAtLeast(step, "storyUnlocked");

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
