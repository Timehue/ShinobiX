import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildCorpus } from '../../../scripts/narrative-corpus.mts';
import { canonicalNarrativeEvent } from '../lib/canonical-narrative';
import type { CreatorEvent } from '../types/vn';

type Passage = { id: string; scene: string; page: number; field: string; before: string; after: string; event: string };
const approved: Passage[] = JSON.parse(readFileSync(new URL('./narration-polish.expected.json', import.meta.url), 'utf8'));
const corpus = buildCorpus();
const clean = (value: unknown) => JSON.parse(JSON.stringify(value));
const generated = new URL('../generated/story-content/', import.meta.url);
function payload(prefix: string) {
    const files = readdirSync(generated).filter(f => f.startsWith(prefix + '-') && f.endsWith('.json'));
    assert.equal(files.length, 1, prefix + ': one current payload');
    return JSON.parse(readFileSync(new URL(files[0], generated), 'utf8'));
}

for (const item of approved) test(`${item.id}: approved passage survives generation and stale saved prose`, () => {
    const scene = corpus.find(s => s.id === item.scene)!;
    assert.ok(scene, item.scene);
    const page = scene.pages[item.page];
    const keys = item.field.split('.');
    const field = (value: unknown) => keys.reduce<unknown>((v, key) => (v as Record<string, unknown>)[key], value);
    assert.equal(field(page), item.after);
    if (scene.family !== 'rift') {
        const output = scene.family === 'reckoning'
            ? payload('field-scenes').reckonings.find((q: { id: string }) => item.scene === `reckoning/${q.id}/payoff`).payoff[item.page]
            : (() => {
                const data = payload(scene.village!.toLowerCase().replace(' village', '').replaceAll(' ', '-'));
                return (scene.family === 'campaign' ? data.chapters : data.interludes)
                    .find((s: { levelReq: number }) => s.levelReq === scene.level).pages[item.page];
            })();
        assert.deepEqual(output, clean(page));
    }
    // Rift text is exercised through the production repeat-event builder in the corpus.
    const base = { id: item.event.split(':')[0], vnPages: [page] } as CreatorEvent;
    const stale = structuredClone(base);
    const parent = keys.slice(0, -1).reduce<unknown>((v, key) => (v as Record<string, unknown>)[key], stale.vnPages![0]);
    (parent as Record<string, unknown>)[keys.at(-1)!] = item.before;
    assert.deepEqual(clean(canonicalNarrativeEvent(base, stale).vnPages![0]), clean(page));
});

test('Mira and Yura retain their existing choice effects and destinations', () => {
    const mira = corpus.find(s => s.id === 'interlude/story-interlude-stormveil-village-30')!.pages[3].choices![1];
    assert.deepEqual({ lane: mira.lane, trait: mira.trait, nextPage: mira.nextPage }, { lane: 'neutral', trait: 'mira-respect', nextPage: 3 });
    const yura = corpus.find(s => s.id === 'campaign/Frostfang Village/25')!;
    assert.equal(yura.pages[2].choices!.find(c => c.nextPage === 3)!.requireTrait, 'ff20-read-her-license');
    assert.deepEqual(yura.pages[3].choices, [{ text: 'Draw your weapon.', nextPage: 4 }]);
    assert.equal(yura.pages[3].dialogue.at(-1), 'Move. The ice is coming up.');
    assert.equal(yura.pages[4].title, 'The Frost Seal Guardian');
    assert.ok(yura.pages[4].choices!.every(c => c.battle));
});

test('the two deliberate stylistic preservation controls remain intact', () => {
    const vanta = corpus.find(s => s.id === 'interlude/story-interlude-stormveil-village-58')!;
    const neutral = vanta.pages.flatMap(p => p.choices ?? []).find(c => c.trait === 'sv58-copied-the-column')!;
    assert.ok(neutral.conclusion!.includes("'Insurance,' he says at the door, 'is what we call fear with good handwriting.'"));
    const toma = corpus.find(s => s.id === 'field/story-reckoning-toma-cinders/al-collapsed-footbridge')!;
    const page = toma.pages.find(p => p.title === 'Sound Before Pretty')!;
    assert.ok(page.choices!.some(c => c.conclusion === 'The repaired span settles without a groan. Toma crosses twice before he trusts it once.'));
});
