import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { storyFieldScenes } from './story-field-scenes';
import { storyInterludesByVillage } from './story-interludes';
import { ECHOES_SCENES } from './echoes-of-war-scenes';

const approved = JSON.parse(readFileSync(new URL('./story-regressions.expected.json', import.meta.url), 'utf8'));
const generated = new URL('../generated/story-content/', import.meta.url);
function payload(prefix: string) {
    const files = readdirSync(generated).filter(f => f.startsWith(prefix + '-') && f.endsWith('.json'));
    assert.equal(files.length, 1);
    return JSON.parse(readFileSync(new URL(files[0], generated), 'utf8'));
}
for (const expected of approved) test(`${expected.id}: approved wording survives authoring and generation`, () => {
    const level = expected.id === 'W01' ? 70 : 88;
    const source = expected.kind === 'field' ? storyFieldScenes[expected.key].points[expected.point].pages[expected.page]
        : expected.kind === 'echoes' ? ECHOES_SCENES[expected.key].firstVictory[expected.page]
        : storyInterludesByVillage[expected.key].find(s => s.levelReq === level)!.pages[expected.page];
    const output = expected.kind === 'field' ? payload('field-scenes').scenes[expected.key].points[expected.point].pages[expected.page]
        : expected.kind === 'echoes' ? payload('echoes-of-war').scenes[expected.key].firstVictory[expected.page]
        : payload(expected.id === 'W01' ? 'stormveil' : 'ashen-leaf').interludes.find((s: { levelReq: number }) => s.levelReq === level).pages[expected.page];
    assert.equal(source.title, expected.title);
    assert.equal(source.speaker, expected.speaker);
    assert.deepEqual(output, JSON.parse(JSON.stringify(source)));
    if (expected.id === 'W01') {
        const choice = source.choices!.find(c => c.trait === 'sv70-fell-on-schedule')!;
        assert.equal(choice.text, expected.choices[0].text);
        assert.equal(choice.conclusion, expected.choices[0].conclusion);
        assert.equal(choice.nextPage, 8);
    } else {
        const dialogue = expected.id === 'R03' || expected.id === 'W02' ? source.dialogue.slice(-2)
            : expected.id === 'R04' ? [source.dialogue[1]] : source.dialogue;
        assert.deepEqual(dialogue, expected.dialogue);
        if (expected.id === 'R01' || expected.id === 'R02') assert.equal(source.choices![expected.id === 'R01' ? 1 : 0].text, expected.choices[0].text);
        if (expected.id === 'R04') {
            assert.equal(source.dialogue[0], 'Then here is what the Court left out.');
            assert.equal(source.dialogue[2], 'The sabotage charge was false. The three years I wasted were real.');
        }
        if (expected.id === 'W02') {
            assert.equal(source.dialogue.length, 4);
            assert.equal(source.dialogue.join(' ').match(/Thank you/g)?.length, 1);
            assert.equal(source.choices![0].nextPage, 11);
        }
    }
});
