/*
 * The quest-line catalogue the game is running on.
 *
 * Production always reads the shipped catalogue (api/quests/_catalog.ts). Tests
 * swap in a small one so they can prove the plumbing without depending on any
 * shipped quest's content. The route and the fight settlement both read it from
 * here, so a swapped catalogue is seen by both.
 */
import { QUEST_LINE_CATALOGUE } from './_catalog.js';
import type { QuestLineCatalogue } from './_catalog-rules.js';

let active: QuestLineCatalogue = QUEST_LINE_CATALOGUE;

export function activeQuestCatalogue(): QuestLineCatalogue {
    return active;
}

/** Tests only. Pass null to return to the shipped catalogue. */
export function setQuestLineCatalogueForTest(next: QuestLineCatalogue | null): void {
    active = next ?? QUEST_LINE_CATALOGUE;
}
