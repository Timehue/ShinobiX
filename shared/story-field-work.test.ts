import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORY_FIELD_JOURNEYS, advanceStoryField, newStoryFieldProgress, parseStoryFieldProgress, parseStoryFieldRecords, storyFieldPointId, storyFieldTraits } from './story-field-work.js';

for (const [questId, journey] of Object.entries(STORY_FIELD_JOURNEYS)) {
    for (const [openingChoice, branch] of Object.entries(journey.points[journey.startPointId].choices)) {
        test(`${questId}: ${openingChoice} completes only its own route and earns its own callback`, () => {
            let progress = newStoryFieldProgress();
            let pointId: string | null = journey.startPointId;
            while (pointId) {
                const point = journey.points[pointId];
                const choiceId = progress.visits.length ? Object.keys(point.choices)[0] : openingChoice;
                assert.deepEqual(storyFieldTraits({ [questId]: progress }), []);
                const result = advanceStoryField(questId, progress, pointId, choiceId, { sector: point.sector }, 0);
                assert.equal(result.ok, true);
                if (!result.ok) throw new Error(result.reason);
                progress = result.progress;
                pointId = storyFieldPointId(questId, progress);
            }
            assert.deepEqual(storyFieldTraits({ [questId]: progress }), [branch.trait]);
            assert.deepEqual(parseStoryFieldProgress(questId, progress), progress);
            assert.ok(progress.visits.length >= 3 && progress.visits.length <= 4);
            const first = progress.visits[0];
            assert.deepEqual(advanceStoryField(questId, progress, first.pointId, first.choiceId, null, 0), { ok: true, replayed: true, progress });
            const alternative = Object.keys(journey.points[first.pointId].choices).find((id) => id !== first.choiceId)!;
            assert.deepEqual(advanceStoryField(questId, progress, first.pointId, alternative, { sector: 1 }, 0), { ok: false, reason: 'choice-locked' });
        });
    }
}

test('routes refuse skipped locations, unrelated actions, moving/battling actors, and fabricated chains', () => {
    const id = 'story-reckoning-mira-marker', start = 'sv-ridge-gate', choice = 'sv-take-high-line';
    const progress = newStoryFieldProgress();
    assert.deepEqual(advanceStoryField(id, progress, 'sv-signal-cairn', 'sv-signal-cairn-recover', { sector: 4 }, 0), { ok: false, reason: 'out-of-order' });
    assert.deepEqual(advanceStoryField(id, progress, start, choice, { sector: 2 }, 0), { ok: false, reason: 'wrong-place' });
    assert.deepEqual(advanceStoryField(id, progress, start, choice, { sector: 1, travelingUntil: 10 }, 0), { ok: false, reason: 'traveling' });
    assert.deepEqual(advanceStoryField(id, progress, start, choice, { sector: 1, inBattle: true }, 0), { ok: false, reason: 'in-battle' });
    assert.deepEqual(advanceStoryField(id, progress, start, '__proto__', { sector: 1 }, 0), { ok: false, reason: 'invalid' });
    assert.equal(parseStoryFieldProgress(id, { version: 1, visits: [{ pointId: 'sv-signal-cairn', choiceId: 'sv-signal-cairn-recover' }] }), null);
    assert.equal(parseStoryFieldProgress(id, { version: 2, visits: [] }), null);
    assert.deepEqual(parseStoryFieldRecords({ ['__proto__']: progress, unknown: progress, [id]: { version: 1, visits: Array(99).fill({}) } }), {});
});

test('recovery choices never change the existing reward or inventory contract', () => {
    for (const journey of Object.values(STORY_FIELD_JOURNEYS)) {
        for (const point of Object.values(journey.points)) {
            assert.ok(Number.isInteger(point.sector) && point.sector >= 1 && point.sector <= 34);
            assert.ok(Number.isInteger(point.tile) && point.tile >= 0 && point.tile < 144);
            for (const choice of Object.values(point.choices)) {
                assert.ok(choice.nextPointId === null || journey.points[choice.nextPointId]);
                assert.deepEqual(Object.keys(choice).filter((key) => !['nextPointId', 'trait'].includes(key)), []);
            }
        }
    }
});
