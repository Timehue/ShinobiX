import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Character } from '../types/character';
import { STORY_FIELD_JOURNEYS, storyFieldPointId, storyFieldTraits, type StoryFieldProgress } from '../../../shared/story-field-work';
import { storyFieldScenes } from '../data/story-field-scenes';
import { storyReckoningById, storyReckonings } from '../data/story-reckonings';
import { biomeForWorldSector } from '../data/sectors';
import { storyReckoningPayoffEvent, visibleStoryReckonings } from './story-reckonings';
import { storyFieldAftermathEvent, storyFieldHistories, storyFieldObjective, storyFieldPointEvent } from './story-field-work';
import { STORY_FIELD_CONTENT_SCHEMA_VERSION } from './story-field-content-contract';
import { seedStoryFieldContentForTests } from './story-field-content-loader';

seedStoryFieldContentForTests({ schemaVersion: STORY_FIELD_CONTENT_SCHEMA_VERSION, scenes: storyFieldScenes, reckonings: storyReckonings });

function characterFor(questId: string, progress: StoryFieldProgress, completed = false): Character {
    const quest = storyReckoningById(questId)!;
    return {
        name: 'Field Reader', level: 95, storyVillage: quest.village, storyProgress: 15,
        storyFieldRecords: { [questId]: progress },
        storyTraits: [...storyFieldTraits({ [questId]: progress }), ...(completed ? [quest.completionTrait] : [])],
        activeStoryReckoning: completed ? null : { id: questId, stage: storyFieldPointId(questId, progress) ? 'task' : 'return', fieldWork: progress },
    } as Character;
}

test('all eight routes deliver only their earned return and aftermath, with no replay mutation', () => {
    for (const [questId, graph] of Object.entries(STORY_FIELD_JOURNEYS)) {
        for (const firstChoice of Object.keys(graph.points[graph.startPointId].choices)) {
            const progress: StoryFieldProgress = { version: 1, visits: [] };
            let pointId: string | null = graph.startPointId;
            while (pointId) {
                const chosen = progress.visits.length ? Object.keys(graph.points[pointId].choices)[0] : firstChoice;
                const live = storyFieldPointEvent(questId, pointId, characterFor(questId, progress), 'central')!;
                assert.equal(live.biome, biomeForWorldSector(graph.points[pointId].sector));
                assert.ok(existsSync(fileURLToPath(new URL(`../../public${live.image}`, import.meta.url))), live.image);
                assert.equal(live.ryoReward, 0);
                assert.equal(live.staminaReward, 0);
                assert.ok(live.vnPages!.at(-1)!.choices!.some((choice) => choice.id === chosen));
                progress.visits.push({ pointId, choiceId: chosen });
                const replay = storyFieldPointEvent(questId, pointId, characterFor(questId, progress), 'lava', true)!;
                assert.ok(replay.vnPages!.every((page) => !page.choices?.length));
                const options = live.vnPages!.flatMap((page) => page.choices ?? []);
                const selected = options.find((option) => option.id === chosen)!;
                assert.ok(replay.dialogue!.includes(`Your choice: ${selected.text}`));
                for (const option of options) {
                    assert.equal(replay.dialogue!.includes(`Your choice: ${option.text}`), option.id === chosen);
                    if (option.conclusion) assert.equal(replay.dialogue!.includes(option.conclusion), option.id === chosen);
                }
                pointId = storyFieldPointId(questId, progress);
            }
            const character = characterFor(questId, progress, true);
            const quest = storyReckoningById(questId)!;
            const payoff = storyReckoningPayoffEvent(quest, 'central', character);
            const aftermath = storyFieldAftermathEvent(questId, character, 'central')!;
            for (const page of [...quest.payoff, ...storyFieldScenes[questId].aftermath]) {
                if (!page.requireTrait?.startsWith('sf-')) continue;
                const includes = character.storyTraits!.includes(page.requireTrait);
                const delivered = [...payoff.dialogue!, ...aftermath.dialogue!];
                assert.equal(page.dialogue.every((line) => delivered.includes(line)), includes, page.requireTrait);
            }
            assert.ok(aftermath.vnPages!.every((page) => !page.choices?.length));
            assert.equal(storyFieldHistories(character)[0].history.length, progress.visits.length);
            assert.equal(storyFieldObjective(character), null);
            assert.ok(visibleStoryReckonings(character, graph.points[graph.startPointId].sector).some((giver) => giver.id === questId));
        }
    }
});

test('legacy returns and unfinished routes never invent a completed branch', () => {
    for (const [questId, graph] of Object.entries(STORY_FIELD_JOURNEYS)) {
        const progress: StoryFieldProgress = { version: 1, visits: [] };
        const character = characterFor(questId, progress);
        assert.equal(storyFieldAftermathEvent(questId, character, 'central'), null);
        assert.equal(storyFieldPointEvent(questId, graph.startPointId, character, 'central', true), null);
        assert.deepEqual(storyFieldHistories(character), []);
        const legacy = { ...character, activeStoryReckoning: null, storyFieldRecords: undefined, storyTraits: [storyReckoningById(questId)!.completionTrait] } as Character;
        const event = storyFieldAftermathEvent(questId, legacy, 'central')!;
        assert.deepEqual(event.dialogue, storyFieldScenes[questId].legacyAftermath!.flatMap((page) => page.dialogue));
    }
});

test('a durable redemption receipt restores the appropriate readonly aftermath without inventing a route', () => {
    const questId = 'story-reckoning-mira-marker';
    const completeProgress: StoryFieldProgress = { version: 1, visits: [
        { pointId: 'sv-ridge-gate', choiceId: 'sv-take-high-line' },
        { pointId: 'sv-broken-cable-span', choiceId: 'sv-broken-cable-span-continue' },
        { pointId: 'sv-signal-cairn', choiceId: 'sv-signal-cairn-recover' },
    ] };
    const completed = characterFor(questId, completeProgress, true) as Character & { redeemedStoryReckonings?: unknown };
    completed.storyTraits = completed.storyTraits!.filter((trait) => trait !== storyReckoningById(questId)!.completionTrait);
    completed.redeemedStoryReckonings = [{ questId }];
    const routed = storyFieldAftermathEvent(questId, completed, 'central')!;
    assert.ok(routed.dialogue!.includes('The west mast is still waiting for the coil on this span. I told the crew where it went. They were polite enough to save their opinion for my face.'));

    const legacy = { ...completed, storyFieldRecords: undefined } as Character & { redeemedStoryReckonings?: unknown };
    const fallback = storyFieldAftermathEvent(questId, legacy, 'central')!;
    assert.deepEqual(fallback.dialogue, storyFieldScenes[questId].legacyAftermath!.flatMap((page) => page.dialogue));
});

test('the cart-first route keeps the owed bridge repair as a playable destination', () => {
    const questId = 'story-reckoning-toma-cinders';
    const progress: StoryFieldProgress = { version: 1, visits: [
        { pointId: 'al-ash-line', choiceId: 'al-follow-cart-first' },
        { pointId: 'al-charcoal-yard', choiceId: 'al-charcoal-yard-continue' },
        { pointId: 'al-silted-sluice', choiceId: 'al-silted-sluice-continue' },
    ] };
    const objective = storyFieldObjective(characterFor(questId, progress))!;
    assert.equal(objective.pointId, 'al-bridge-after-dark');
    assert.equal(objective.sector, 10);
    assert.equal(objective.history.length, 3);
    assert.deepEqual(storyFieldTraits({ [questId]: progress }), []);
});
