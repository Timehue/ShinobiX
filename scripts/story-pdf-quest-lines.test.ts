import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUEST_LINE_CATALOGUE } from '../api/quests/_catalog.ts';
import { questLinePdfScenes } from './story-pdf-quest-lines.mts';

/*
 * The quest section of the story review PDF. It is built from the shipped
 * catalogue, so these only check that nothing in it is left unnamed: a reviewer
 * reading a raw id cannot judge the text beside it.
 */

const scenes = questLinePdfScenes();

test('every quest is a scene: its offer, a page for every stage, and its closing scene', () => {
    const lines = Object.values(QUEST_LINE_CATALOGUE.lines);
    assert.equal(scenes.length, lines.length);
    for (const [index, line] of lines.entries()) {
        const scene = scenes[index];
        assert.ok(scene.title.startsWith(line.title), line.id);
        assert.deepEqual(scene.pages.map(page => page.index), scene.pages.map((_page, at) => at), line.id);
        assert.deepEqual([scene.pages[0].title, scene.pages.at(-1)!.title], ['offer', 'closing'], line.id);
        const steps = scene.pages.slice(1, -1);
        assert.equal(steps.length, line.stages.length, line.id);
        for (const [at, stage] of line.stages.entries()) {
            // Everything said at the step is printed, in order, above the journal's own instruction.
            const said = stage.say ?? [];
            assert.deepEqual(steps[at].lines.slice(0, said.length).map(printed => printed.text.replace(/ \[only if: .*\]$/, '')), said.map(say => say.text), `${line.id}/${stage.key}`);
            assert.equal(steps[at].lines[said.length].text, `Journal: ${stage.text}`, `${line.id}/${stage.key}`);
        }
        // A line that only some players hear says when.
        const conditional = [...(line.scenes?.offer ?? []), ...(line.scenes?.done ?? []), ...line.stages.flatMap(stage => stage.say ?? [])].filter(say => say.when).length;
        const marked = scene.pages.flatMap(page => page.lines).filter(printed => /\[only if: /.test(`${printed.speaker} ${printed.text}`)).length;
        assert.equal(marked, conditional, line.id);
    }
});

test('a caption names people, places and items, never a raw id', () => {
    for (const scene of scenes) {
        assert.doesNotMatch(scene.note, /\bquest-[a-z]|\bgather-[a-z]/, `${scene.title}: ${scene.note}`);
        for (const page of scene.pages) {
            assert.ok(page.scene.length > 0, `${scene.title} / ${page.title}`);
            assert.doesNotMatch(page.scene, /\bquest-[a-z]|\bgather-[a-z]|\btool-[a-z]|-\d{3}\b/, `${scene.title} / ${page.title}: ${page.scene}`);
        }
    }
});

test('a Hold fight says what breaks it, in order for a chain', () => {
    const page = (questId: string) => scenes.find(scene => scene.title.includes(`(${questId})`))!.pages.filter(entry => entry.title.startsWith('boss')).at(-1)!;
    assert.match(page('shuttered-boat').scene, /Smoke Hold, broken by Stormglass Signal Shard/);
    assert.match(page('the-unmoored').scene, /Oath Guard, broken by .+; Beast Bond, broken by .+; Rime Lock, broken by /);
});

test('a choice lists what each option tells the player', () => {
    const choice = scenes.flatMap(scene => scene.pages).find(page => page.choices.length > 0);
    assert.ok(choice, 'the catalogue has at least one choice stage');
    for (const option of choice.choices) assert.ok(choice.lines.some(line => line.text.startsWith(`${option.text}: `)));
});
