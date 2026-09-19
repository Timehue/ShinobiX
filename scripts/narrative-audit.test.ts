import test from 'node:test';
import assert from 'node:assert/strict';
import { auditScenes, sampleScenes } from './narrative-audit.mts';
import { buildCorpus, type Page, type Scene } from './narrative-corpus.mts';
import { LEGACY_DEFS } from '../api/_legacy-defs.ts';
import { CHRONICLE_LEGACY_SOURCES } from '../shared/legacy-card-sources.ts';
const page = (choices: Page['choices']): Page => ({ title: 'A door', scene: 'A locked room', speaker: 'Keeper', dialogue: ['Run!'], choices });
const scene = (pages: Page[]): Scene => ({ id: 'test', family: 'test', source: 'fixture', context: '', graph: true, pages });
const errors = (s: Scene) => auditScenes([s]).filter(f => f.severity === 'error').map(f => f.code);
test('Chronicle Legacy descriptions match the authoritative deed records', () => {
    for (const source of CHRONICLE_LEGACY_SOURCES) {
        assert.equal(source.flavor, LEGACY_DEFS.find(def => def.id === source.id)?.flavor, source.id);
    }
});
test('audit rejects dangling targets, closed loops, hidden choices and orphan pages', () => {
    assert.ok(errors(scene([page([{ text: 'Leave', nextPage: 2 }])])).includes('branch-reference'));
    assert.ok(errors(scene([page([{ text: 'Next', nextPage: 1 }]), page([{ text: 'Back', nextPage: 0 }])])).includes('closed-branch'));
    assert.ok(errors(scene([page([{ text: 'Leave', nextPage: 0, requireTrait: 'key' }])])).includes('gated-dead-end'));
    assert.ok(errors(scene([page([{ text: 'Leave', nextPage: 0 }]), page(undefined)])).includes('unreachable-page'));
});
test('audit follows earned traits and allows a conversation hub with an exit', () => {
    assert.deepEqual(errors(scene([page([{ text: 'Take key', nextPage: 1, trait: 'key' }]), page([{ text: 'Leave', nextPage: 1, requireTrait: 'key' }])])), []);
    assert.deepEqual(errors(scene([page([{ text: 'Ask', nextPage: 1, requireTrait: 'memory' }, { text: 'Leave', nextPage: 0 }]), page([{ text: 'Back', nextPage: 0 }])])), []);
    // Each incoming key state has one visible choice; no false dead-end warning.
    assert.deepEqual(errors(scene([page([{ text: 'Open', nextPage: 0, requireTrait: 'key' }, { text: 'Knock', nextPage: 0, forbidTrait: 'key' }])])), []);
});
test('short dialogue stays advisory; unresolved variables and duplicate identities fail', () => {
    const s = scene([page(undefined)]);
    assert.deepEqual(errors(s), []);
    assert.ok(auditScenes([s]).some(f => f.code === 'short-line' && f.severity === 'warning'));
    s.pages[0].dialogue = ['Hello {nam}.'];
    assert.ok(errors(s).includes('unknown-variable'));
    assert.ok(auditScenes([s, s]).some(f => f.code === 'duplicate-scene'));
});
test('whole corpus passes structural checks; sampling is repeatable and spans families and villages', () => {
    const corpus = buildCorpus();
    assert.deepEqual(auditScenes(corpus).filter(f => f.severity === 'error'), []);
    const sample = sampleScenes(corpus, 26, 20260919);
    assert.deepEqual(sample.map(s => s.id), sampleScenes(corpus, 26, 20260919).map(s => s.id));
    assert.equal(new Set(sample.map(s => s.family)).size, new Set(corpus.map(s => s.family)).size);
    assert.equal(new Set(sample.filter(s => s.family === 'campaign').map(s => s.village)).size, 4);
});
