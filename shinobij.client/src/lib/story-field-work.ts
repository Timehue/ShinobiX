import type { Character } from '../types/character';
import type { Biome } from '../types/core';
import type { CreatorEvent } from '../types/vn';
import { parseStoryFieldProgress, parseStoryFieldRecords, storyFieldJourney, storyFieldPointId } from '../../../shared/story-field-work';
import type { StoryReckoningPage } from '../data/story-reckonings';
import { biomeForWorldSector, villageOutskirtsSectorNumber } from '../data/sectors';
import { defaultVnPortrait } from './vn';
import { STORYWIDE_ENVIRONMENTS, type StoryVillageKey } from './vn-storywide-direction';
import { readStoryFieldContent } from './story-field-content-loader';

export const FIELD_STORY_PREFIX = 'story-reckoning-field:';
const FIELD_VILLAGE_KEYS: Record<string, StoryVillageKey> = {
    'Stormveil Village': 'stormveil', 'Ashen Leaf Village': 'ashen', 'Frostfang Village': 'frostfang', 'Moonshadow Village': 'moonshadow',
};

export function storyFieldReckoningRedeemed(character: Character, questId: string): boolean {
    const receipts = (character as Character & { redeemedStoryReckonings?: unknown }).redeemedStoryReckonings;
    return Array.isArray(receipts) && receipts.some((value) => value && typeof value === 'object' && !Array.isArray(value)
        && (value as Record<string, unknown>).questId === questId);
}

export function storyFieldBackdrop(questId: string): string | undefined {
    const village = storyFieldJourney(questId)?.village;
    return village ? STORYWIDE_ENVIRONMENTS[FIELD_VILLAGE_KEYS[village]].threshold : undefined;
}

export function storyFieldPages(pages: readonly StoryReckoningPage[], traits: readonly string[]) {
    return pages.filter((page) => (!page.requireTrait || traits.includes(page.requireTrait))
        && (!page.forbidTrait || !traits.includes(page.forbidTrait)));
}

function fieldEvent(questId: string, id: string, name: string, pages: readonly StoryReckoningPage[], biome: Biome, character: Character): CreatorEvent | null {
    const arc = readStoryFieldContent().reckonings.find((entry) => entry.id === questId);
    if (!arc) return null;
    const visible = storyFieldPages(pages, character.storyTraits ?? []);
    if (!visible.length) return null;
    return {
        id: FIELD_STORY_PREFIX + id, name, biome, village: arc.village, icon: 'SR', eventKind: 'visualNovel', trigger: 'manual',
        vnTitle: name, vnScene: visible[0].scene, vnSpeaker: visible[0].speaker,
        image: storyFieldBackdrop(questId), avatarImage: defaultVnPortrait(arc.npcName),
        levelReq: arc.levelReq, xpReward: 0, ryoReward: 0, staminaReward: 0,
        dialogue: visible.flatMap((page) => page.dialogue),
        vnPages: visible.map((page, index) => ({
            title: page.title, scene: page.scene, speaker: page.speaker, dialogue: page.dialogue,
            rightImage: defaultVnPortrait(page.speaker) || undefined,
            choices: page.choices?.map((choice) => ({
                id: choice.id, text: choice.text, conclusion: choice.conclusion,
                requireTrait: choice.requireTrait, forbidTrait: choice.forbidTrait,
                nextPage: index,
            })),
        })),
    };
}

export function storyFieldPointEvent(questId: string, pointId: string, character: Character, biome: Biome, review = false): CreatorEvent | null {
    const scene = readStoryFieldContent().scenes[questId]?.points[pointId];
    if (!scene) return null;
    const sector = storyFieldJourney(questId)?.points[pointId]?.sector;
    const event = fieldEvent(questId, `${questId}:${pointId}`, scene.name, scene.pages, sector ? biomeForWorldSector(sector) : biome, character);
    if (!event || !review) return event;
    const progress = parseStoryFieldProgress(questId, character.storyFieldRecords?.[questId]);
    const visit = progress?.visits.find((entry) => entry.pointId === pointId);
    if (!visit) return null;
    const selectedChoice = event.vnPages?.flatMap((page) => page.choices ?? []).find((choice) => choice.id === visit.choiceId);
    if (!selectedChoice) return null;
    const pages = event.vnPages?.map((page) => ({ ...page, choices: undefined })) ?? [];
    pages.push({
        title: 'Your Recorded Choice', scene: scene.pages.at(-1)?.scene ?? '', speaker: 'Narrator',
        dialogue: [`Your choice: ${selectedChoice.text}`, ...(selectedChoice.conclusion ? [selectedChoice.conclusion] : [])],
        choices: undefined,
    });
    return { ...event, vnPages: pages, dialogue: pages.flatMap((page) => page.dialogue) };
}

export function storyFieldAftermathEvent(questId: string, character: Character, biome: Biome): CreatorEvent | null {
    const content = readStoryFieldContent();
    const authored = content.scenes[questId], arc = content.reckonings.find((entry) => entry.id === questId);
    const completed = arc && ((character.storyTraits ?? []).includes(arc.completionTrait) || storyFieldReckoningRedeemed(character, questId));
    if (!authored || !arc || !completed) return null;
    const progress = parseStoryFieldProgress(questId, character.storyFieldRecords?.[questId]);
    const complete = progress && storyFieldPointId(questId, progress) === null;
    const pages = !complete && authored.legacyAftermath ? authored.legacyAftermath : authored.aftermath;
    // Return visits are conversations, never another turn-in or trait award.
    return fieldEvent(questId, `${questId}:aftermath`, arc.title, pages.map((page) => ({ ...page, choices: undefined })), biome, character);
}

export function storyFieldObjective(character: Character) {
    const active = character.activeStoryReckoning;
    if (!active?.fieldWork) return null;
    const content = readStoryFieldContent();
    const journey = storyFieldJourney(active.id), authored = content.scenes[active.id], arc = content.reckonings.find((entry) => entry.id === active.id);
    const progress = parseStoryFieldProgress(active.id, active.fieldWork);
    if (!journey || !authored || !arc || !progress) return null;
    const pointId = active.stage === 'return' ? null : storyFieldPointId(active.id, progress);
    const point = pointId ? journey.points[pointId] : null;
    const scene = pointId ? authored.points[pointId] : null;
    return {
        questId: active.id, title: arc.title, pointId,
        name: scene?.name ?? arc.npcName,
        objective: scene?.objective ?? `Return to ${arc.npcName} at the village outskirts.`,
        sector: point?.sector ?? villageOutskirtsSectorNumber(arc.village), tile: point?.tile ?? 65,
        history: progress.visits.map((visit) => ({ ...visit, name: authored.points[visit.pointId]?.name ?? arc.title })),
    };
}

export function storyFieldHistories(character: Character) {
    const remembered = Object.entries(parseStoryFieldRecords(character.storyFieldRecords))
        .filter(([questId, progress]) => questId !== character.activeStoryReckoning?.id && progress.visits.length > 0);
    if (!remembered.length) return [];
    const content = readStoryFieldContent();
    return remembered.flatMap(([questId, progress]) => {
        const arc = content.reckonings.find((entry) => entry.id === questId), scenes = content.scenes[questId];
        return !arc || !scenes ? [] : [{
            questId, title: arc.title,
            history: progress.visits.flatMap((visit) => scenes.points[visit.pointId]
                ? [{ ...visit, name: scenes.points[visit.pointId].name }]
                : []),
        }];
    });
}

export type StoryFieldResponse = {
    ok?: boolean; replayed?: boolean; complete?: boolean; reason?: string; error?: string;
    character?: Character; _saveVersion?: number;
};

export async function reportStoryFieldChoice(playerName: string, questId: string, pointId: string, choiceId: string): Promise<StoryFieldResponse> {
    try {
        const response = await fetch('/api/sector/story-reckoning', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'field-act', playerName, questId, pointId, choiceId }),
        });
        const body = await response.json() as StoryFieldResponse;
        return response.ok ? body : { ...body, ok: false };
    } catch { return { ok: false, reason: 'offline' }; }
}
