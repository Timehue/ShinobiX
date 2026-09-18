import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Character } from '../types/character';
import type { CreatorEvent } from '../types/vn';
import { storylines } from '../data/storylines';
import { storyInterludesByVillage } from '../data/story-interludes';
import { STORY_CONTENT_VILLAGES, type StoryContentVillage } from './story-content-contract';
import { storyToCreatorEvent, interludeToCreatorEvent } from './story-trigger';
import { makeStoryChoiceReceipt, isReusableChoiceHub } from './story-choice-history';
import { applyStoryChoiceReceipt } from './story-choice-mutations';
import { buildCompletedStoryArchive } from './story-archive';
import { isChoiceAvailable } from './vn';
import { resolveVnPresentation } from './vn-presentation';

type Route = { character: Character; path: number[] };
function routes(event: CreatorEvent, character: Character, index = 0, path: number[] = []): Route[] {
    if (path.length > 64) throw new Error(`Unbounded fixture: ${event.id}`);
    const page = event.vnPages?.[index];
    if (!page) return [{ character, path }];
    const nextPath = [...path, index];
    if (!page.choices?.length) return routes(event, character, index + 1, nextPath);
    return page.choices.flatMap((choice, choiceIndex) => {
        if (!isChoiceAvailable(choice, character.storyTraits ?? [])) return [];
        const receipt = makeStoryChoiceReceipt(event, index, choiceIndex, choice);
        if (isReusableChoiceHub(page) && character.storyChoices?.some(row => row.eventId === event.id && row.pageId === receipt.pageId && row.choiceId === receipt.choiceId)) return [];
        const next = applyStoryChoiceReceipt(character, receipt);
        if (choice.battle || choice.nextPage === index) return [{ character: next, path: nextPath }];
        return routes(event, next, choice.nextPage, nextPath);
    });
}
function fixture(village: StoryContentVillage, progress: number): Character {
    return { name: 'Journey fixture', village, storyVillage: village, level: 100, storyProgress: progress, storyTraits: [], storyChoices: [] } as unknown as Character;
}
function content(village: StoryContentVillage) {
    return { schemaVersion: 1 as const, village, chapters: storylines[village], interludes: storyInterludesByVillage[village] };
}
function verifyArchive(event: CreatorEvent, route: Route, village: StoryContentVillage, completedProgress: number) {
    const recorded = { ...route.character, storyProgress: completedProgress };
    const before = JSON.stringify(recorded);
    const archive = buildCompletedStoryArchive(recorded, content(village)).find(entry => entry.replayEvent.id === event.id)!;
    assert.ok(archive, event.id);
    assert.equal(archive.historyComplete, true, event.id);
    assert.deepEqual(archive.pages.map(p => p.title), route.path.map(i => event.vnPages![i].title));
    assert.deepEqual(archive.pages.flatMap(p => p.lines.map(l => l.text)), archive.replayEvent.vnPages!.flatMap(p => p.lines?.map(l => l.text) ?? p.dialogue));
    assert.ok(archive.replayEvent.vnPages!.every(p => !p.choices));
    assert.equal(archive.replayEvent.ryoReward, 0);
    assert.equal(archive.replayEvent.aiProfileId, undefined);
    assert.equal(JSON.stringify(recorded), before);
    for (const [replayIndex, sourceIndex] of route.path.entries()) {
        const page = event.vnPages![sourceIndex];
        for (let lineIndex = 0; lineIndex < page.dialogue.length; lineIndex++) {
            const input = { page, pageIndex: sourceIndex, lineIndex, speaker: page.lines?.[lineIndex]?.speaker ?? page.speaker ?? 'Narrator', speakingSide: null, pageImage: page.image || event.image || '', reducedMotion: true } as const;
            const live = resolveVnPresentation({ ...input, event });
            const replay = resolveVnPresentation({ ...input, event: archive.replayEvent, page: archive.replayEvent.vnPages![replayIndex], pageIndex: replayIndex });
            assert.equal(replay.backgroundImage, live.backgroundImage, `${event.id}:${page.title}:${lineIndex} replay artwork`);
        }
    }
}

for (const village of STORY_CONTENT_VILLAGES) {
    test(`${village}: every opening motivation and terminal battle choice preserves its complete archive path`, () => {
        const event = storyToCreatorEvent(storylines[village][0], village, 0);
        const paths = routes(event, fixture(village, 0));
        assert.equal(paths.length, 15);
        for (const route of paths) verifyArchive(event, route, village, 1);
    });
    test(`${village}: recorded relationship choices drive every reachable authored level-88 reaction`, () => {
        const original = interludeToCreatorEvent(storyInterludesByVillage[village].find(i => i.levelReq === 30)!);
        const payoff = interludeToCreatorEvent(storyInterludesByVillage[village].find(i => i.levelReq === 88)!);
        const proofs = {
            'Ashen Leaf Village': ['al65-saved-the-screw'],
            'Stormveil Village': ['sv65-saved-the-reason', 'sv65-gave-mira-the-page'],
            'Frostfang Village': ['ff65-saved-the-letter', 'ff65-gave-yura-the-letter'],
            'Moonshadow Village': ['ms65-saved-the-file', 'ms65-gave-nyx-the-file'],
        }[village];
        const fieldCallbacks = payoff.vnPages![0].choices!.flatMap(choice => choice.requireTrait ? [choice.requireTrait] : []);
        for (const originalRoute of routes(original, fixture(village, 3))) {
            verifyArchive(original, originalRoute, village, 3);
            // Later-game fixture: only the surviving proof object and milestone
            // eligibility are seeded. Relationship state comes from live choice mutation.
            for (const proof of ['', ...proofs]) for (const field of ['', ...fieldCallbacks]) {
                const later = { ...originalRoute.character, storyProgress: 8, storyTraits: [...originalRoute.character.storyTraits!, ...[proof, field].filter(Boolean)] };
                const paths = routes(payoff, later);
                assert.ok(paths.length >= 3);
                for (const route of paths) verifyArchive(payoff, route, village, 8);
                const repair = payoff.vnPages!.flatMap(p => p.choices ?? []).find(c => c.trait?.endsWith('repaired-trust'))!;
                assert.equal(paths.some(route => route.character.storyTraits?.includes(repair.trait!)), later.storyTraits.includes(repair.requireTrait!));
            }
        }
    });
}

test('Ashen Leaf finale: all terminal lanes and reusable proof/testimony orders remain read-only in replay', () => {
    const village = 'Ashen Leaf Village';
    const event = storyToCreatorEvent(storylines[village][8], village, 8);
    const variants = [
        [], ['al88-water-proven'], ['al88-unfinished-answer'],
        ['al88-better-winter-ready', 'al88-better-winter-deferred', 'al88-reed-proof-any'],
        ...['al88-proved-the-winter', 'al88-held-the-proof', 'al88-baited-the-survey'].map(trait =>
            ['al88-better-winter-ready', 'al88-better-winter-carried', 'al88-reed-proof-any', trait]),
    ];
    const seen = new Set<number>();
    for (const traits of variants) {
        const seed = fixture(village, 8);
        seed.storyTraits = [...traits, 'al92-mori-present', 'al58-took-the-knowledge', 'al70-claimed-the-name'];
        const paths = routes(event, seed);
        assert.ok(paths.length >= 3);
        assert.equal(new Set(paths.map(route => route.character.storyChoices!.findLast(row => row.battle)?.trait)).size, 3);
        for (const route of paths) {
            verifyArchive(event, route, village, 9);
            route.path.forEach(index => seen.add(index));
        }
    }
    assert.equal(seen.size, event.vnPages!.length, 'all finale pages, proof presentations and terminal lanes are reachable');
});
