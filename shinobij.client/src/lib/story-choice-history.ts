import type { Character, StoryChoiceReceipt } from "../types/character";
import type { CreatorEvent } from "../types/vn";
import { sanitizeStoryChoices } from "./story-history";

type VnPage = NonNullable<CreatorEvent["vnPages"]>[number];
export type VnChoice = NonNullable<VnPage["choices"]>[number];
const cleanId = (value: unknown, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const whole = (value: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));

export function storyPageId(page: VnPage | undefined, pageIndex: number): string {
    return cleanId(page?.id) || `v1:p${whole(pageIndex, 999)}`;
}

export function storyChoiceId(choice: VnChoice | undefined, choiceIndex: number): string {
    return cleanId(choice?.id) || `v1:c${whole(choiceIndex, 99)}`;
}

export function isReusableChoiceHub(page: VnPage | undefined): boolean {
    const choices = page?.choices ?? [];
    return choices.some((choice) => !!choice.battle) && choices.some((choice) => !choice.battle);
}

export function makeStoryChoiceReceipt(event: CreatorEvent, pageIndex: number, choiceIndex: number, choice: VnChoice): StoryChoiceReceipt {
    const page = event.vnPages?.[pageIndex];
    return {
        version: 1, eventId: cleanId(event.id), pageId: storyPageId(page, pageIndex), choiceId: storyChoiceId(choice, choiceIndex),
        pageIndex: whole(pageIndex, 999), choiceIndex: whole(choiceIndex, 99), nextPage: whole(choice.nextPage, 999),
        ...(cleanId(choice.trait) ? { trait: cleanId(choice.trait) } : {}),
        ...(choice.battle ? { battle: true } : {}),
        ...(isReusableChoiceHub(page) ? { revisitable: true } : {}),
    };
}

export function recordedStoryChoices(character: Pick<Character, "storyChoices">, event: CreatorEvent, pageIndex: number): StoryChoiceReceipt[] {
    const pageId = storyPageId(event.vnPages?.[pageIndex], pageIndex);
    return sanitizeStoryChoices(character.storyChoices).filter((row) => row.eventId === event.id && row.pageId === pageId);
}
