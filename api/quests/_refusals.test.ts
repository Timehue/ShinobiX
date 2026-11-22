import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { QUEST_REFUSAL_SENTENCES } from './_refusals.js';

test('a refused quest action is told to the player as a sentence', () => {
    assert.equal(QUEST_REFUSAL_SENTENCES['wrong-place'], 'You are not there yet.');
    assert.equal(QUEST_REFUSAL_SENTENCES.committed, 'This quest has already taken what you gave it. It has to be finished.');
    for (const [reason, line] of Object.entries(QUEST_REFUSAL_SENTENCES)) {
        assert.match(line, /^[A-Z].*\.$/, `${reason} is a whole sentence`);
        assert.doesNotMatch(line, /[–—]/, `${reason}: no dash pauses`);
    }
});

test('every reason the engine refuses with is worded, here or in the refusal itself', () => {
    // The client holds no sentences of its own, so a reason with neither would
    // reach the player as "That could not be done right now."
    const engine = readFileSync(join(process.cwd(), 'api/quests/_engine.ts'), 'utf8');
    const named = new Set([...engine.matchAll(/refuse\('([a-z-]+)'/g)].map(match => match[1]));
    assert.ok(named.size >= 15, 'the scan still finds the engine’s refusals');
    // These always carry their own `error`, written where they are refused.
    const selfWorded = new Set(['clan-left', 'clan-tenure', 'landing', 'reserved', 'wrong-answer']);
    for (const reason of named) assert.ok(selfWorded.has(reason) || QUEST_REFUSAL_SENTENCES[reason], `${reason} has no sentence`);
    for (const reason of selfWorded) {
        const calls = [...engine.matchAll(new RegExp(`refuse\\('${reason}',[^;]*;`, 'g'))].map(match => match[0]);
        assert.ok(calls.length > 0 && calls.every(call => call.includes('error')), `${reason} must carry its own words`);
    }
    // Reasons the engine reaches through a gate or a presence check rather than a literal are read from
    // where they are declared, so a reason added there later cannot reach a player unworded.
    const record = readFileSync(join(process.cwd(), 'api/quests/_record.ts'), 'utf8');
    const gate = /export type QuestLineGateReason =([^;]+);/.exec(record)?.[1].match(/'([a-z-]+)'/g)?.map(word => word.slice(1, -1)) ?? [];
    assert.ok(gate.includes('done') && gate.includes('active') && gate.length >= 9, 'the scan still finds the gate’s reasons');
    const presence = /export function questPresenceReason[\s\S]*?\n}/.exec(engine)?.[0].match(/return '([a-z-]+)'/g)?.map(word => word.slice(8, -1)) ?? [];
    assert.ok(presence.includes('wrong-place') && new Set(presence).size >= 4, 'the scan still finds the presence reasons');
    for (const reason of new Set([...gate.filter(value => value !== 'ok'), ...presence])) {
        assert.ok(QUEST_REFUSAL_SENTENCES[reason], `${reason} has no sentence`);
    }
});

test('the handler’s source still adds the sentence to a refusal that has no words of its own', () => {
    // A source pin, not a behaviour test: the reply itself is exercised in coast-playthrough.test.ts.
    const handler = readFileSync(join(process.cwd(), 'api/quests/lines.ts'), 'utf8');
    assert.match(handler, /const REFUSAL_SENTENCES = QUEST_REFUSAL_SENTENCES;/);
    assert.match(handler, /decision\.reason && !decision\.body\?\.error \? REFUSAL_SENTENCES\[decision\.reason\]/);
});
