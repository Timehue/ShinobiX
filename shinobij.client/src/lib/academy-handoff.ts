import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { getCharacterElements } from "./elements";
import { normalizeOnboardingStep } from "./onboarding-step";

export type AcademyHandoffAction = {
    label: string;
    screen: Screen;
    detail: string;
    intent?: "openAwakening";
};

export type AcademyHandoff = {
    id: "academy-handoff-awakening" | "academy-handoff-choice";
    title: string;
    summary: string;
    primary: AcademyHandoffAction;
    secondary: AcademyHandoffAction;
};

type AcademyHandoffCharacter = Pick<
    Character,
    | "academyChecklistClaimed"
    | "academySectorVisited"
    | "academyTrialClaimed"
    | "element"
    | "elements"
    | "level"
    | "onboardingStep"
>;

/**
 * Presentation-only handoff shown after the real Academy route is complete.
 * The persisted trial + sector milestones keep skipped tutorials and legacy
 * saves from receiving a contextless first-session card.
 */
export function buildAcademyHandoff(character: AcademyHandoffCharacter): AcademyHandoff | null {
    const recentlyCompletedAcademy =
        normalizeOnboardingStep(character.onboardingStep ?? "") === "done" &&
        Boolean(character.academyTrialClaimed) &&
        Boolean(character.academySectorVisited) &&
        !character.academyChecklistClaimed &&
        character.level < 15;
    if (!recentlyCompletedAcademy) return null;

    const canAwaken = character.level >= 2 && getCharacterElements(character).length === 0;
    if (canAwaken) {
        return {
            id: "academy-handoff-awakening",
            title: "Academy complete—shape your first build",
            summary: "Your training route is complete. Follow the Awakening Stone's call now, or take a rookie mission and return when you are ready.",
            primary: {
                label: "Visit the Awakening Stone",
                screen: "centralHub",
                detail: "Follow the Level 2 awakening story to Central Hub and reveal your first element.",
                intent: "openAwakening",
            },
            secondary: {
                label: "Take an E-Rank mission",
                screen: "missions",
                detail: "Repeat the fight-and-claim loop for XP and ryo.",
            },
        };
    }

    return {
        id: "academy-handoff-choice",
        title: "Academy complete—choose your next path",
        summary: "The guided route is over. Continue with repeatable field work, or follow your village's story.",
        primary: {
            label: "Take an E-Rank mission",
            screen: "missions",
            detail: "Build levels, ryo, and combat mastery through rookie work.",
        },
        secondary: {
            label: "Continue your story",
            screen: "storyHall",
            detail: "Follow the next authored chapter and village conflict.",
        },
    };
}
