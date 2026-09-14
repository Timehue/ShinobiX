import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeCharacterSave, combatProjection } from './[name].js';

const questId = 'story-reckoning-mira-marker';
const record = { version: 1, visits: [
    { pointId: 'sv-ridge-gate', choiceId: 'sv-take-high-line' },
    { pointId: 'sv-broken-cable-span', choiceId: 'sv-broken-cable-span-continue' },
    { pointId: 'sv-signal-cairn', choiceId: 'sv-signal-cairn-recover' },
] };

test('generic saves preserve field history and rebuild only server-earned route callbacks', () => {
    const stored = { character: { storyFieldRecords: { [questId]: record }, storyTraits: ['sf-sv-high-line'] } };
    const next = sanitizeCharacterSave({ character: { storyFieldRecords: {}, storyTraits: ['sf-ms-open-witnesses', 'merciful'] } }, stored);
    const char = next.character as Record<string, unknown>;
    assert.deepEqual(char.storyFieldRecords, stored.character.storyFieldRecords);
    assert.deepEqual(char.storyTraits, ['merciful', 'sf-sv-high-line']);
    const projection = combatProjection(next) as Record<string, unknown>;
    assert.equal((projection.character as Record<string, unknown>)?.storyFieldRecords, undefined);
});

test('new/older saves cannot forge a completed field route or its callback', () => {
    const incoming = { character: { storyFieldRecords: { [questId]: record }, storyTraits: ['sf-sv-high-line'] } };
    for (const stored of [null, { character: {} }]) {
        const char = sanitizeCharacterSave(incoming, stored).character as Record<string, unknown>;
        assert.equal(char.storyFieldRecords, undefined);
        assert.deepEqual(char.storyTraits, []);
    }
});

test('stale and partial autosaves cannot erase or advance the active route mirror', () => {
    const active = { id: questId, stage: 'task', metric: 'totalTilesExplored', baseline: 5, target: 12,
        dropItemId: 'event-kesa-marker', fieldWork: { version: 1, visits: record.visits.slice(0, 1) } };
    for (const incoming of [{}, { activeStoryReckoning: null }, { activeStoryReckoning: { ...active, stage: 'return', fieldWork: record } }]) {
        const char = sanitizeCharacterSave({ character: incoming }, { character: { activeStoryReckoning: active } }).character as Record<string, unknown>;
        assert.deepEqual(char.activeStoryReckoning, active);
    }
    const first = sanitizeCharacterSave({ character: { activeStoryReckoning: active } }, null).character as Record<string, unknown>;
    assert.equal(first.activeStoryReckoning, undefined);
});
