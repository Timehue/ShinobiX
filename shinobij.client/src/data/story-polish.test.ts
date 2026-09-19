import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storylines } from './storylines';
import { storyInterludesByVillage } from './story-interludes';

test("Dren's letter quotation and Kael's repetition agree on voluntary rescue", () => {
    const pages = storylines['Frostfang Village'].find(s => s.levelReq === 100)!.pages!;
    const yura = pages.find(p => p.title === 'She Answers His Roll')!;
    const kael = pages.find(p => p.title === 'The Door, Answered')!;
    const quoted = yura.dialogue.find(line => line.startsWith('His letter says:'))!;
    const sentence = quoted.slice("His letter says: 'Tell Yura: ".length, -1);
    assert.equal(sentence[0].toUpperCase() + sentence.slice(1), kael.dialogue[1]);
    assert.match(sentence, /name on the roll doesn't mean someone will come back for you/);
    assert.match(yura.dialogue.join(' '), /came back for me without a mark or an order/);
    assert.match(kael.dialogue.join(' '), /I changed the report/);
});

test('all three Mira presentation offers keep their distinct relationship gates and shared effect', () => {
    const scene = storyInterludesByVillage['Stormveil Village'].find(s => s.levelReq === 88)!;
    const choices = scene.pages.flatMap(p => p.choices ?? []).filter(c => c.trait === 'sv88-reason-proof-deferred');
    assert.equal(choices.length, 3);
    assert.deepEqual(choices.map(c => c.requireTrait), ['mira-trust', 'mira-respect', 'sv88-repaired-trust']);
    for (const choice of choices) {
        assert.equal(choice.nextPage, 7);
        assert.match(choice.text, /present your mother's grievance and plans to Raiko/);
        assert.match(scene.pages[choice.nextPage].dialogue[0], /I'll take the slate and the plans/);
    }
});
