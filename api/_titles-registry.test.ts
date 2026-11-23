import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_QUEST_LINE_TITLES } from '../shared/quest-line-titles.js';
import { LIBERATOR_TITLES } from './story/_settle.js';
import { ECHOES_TITLES, ERA_TRIGGER_TITLES, KEEPER_PATH_TITLE, KNOWN_EARNED_TITLES, LEGACY_ONLY_TITLES } from './_titles-registry.js';

/*
 * A quest-line title is server-credited: only the title vault may hold it. A
 * Legacy title is verified against the Legacy record instead. If one name were
 * granted by both, one system's rule would decide who may wear the other's
 * title, and a player who earned it the other way could lose it. The first
 * draft of the coast's titles had exactly that clash ("Tidebreaker").
 */

const lower = (titles: Iterable<string>) => [...titles].map(title => title.toLowerCase());

test('every quest-line title is known, and no two quests grant the same one', () => {
    const titles = lower(ALL_QUEST_LINE_TITLES);
    assert.equal(new Set(titles).size, titles.length);
    for (const title of titles) assert.ok(KNOWN_EARNED_TITLES.has(title), title);
});

test('no quest-line title repeats one another system grants', () => {
    const others = new Set([
        ...LEGACY_ONLY_TITLES, ...ERA_TRIGGER_TITLES,
        ...lower(Object.values(LIBERATOR_TITLES)), ...lower(Object.values(ECHOES_TITLES)), KEEPER_PATH_TITLE.toLowerCase(),
    ]);
    assert.ok(others.has('tidebreaker'), 'the Legacy title this guards against is still in the game');
    for (const title of lower(ALL_QUEST_LINE_TITLES)) assert.equal(others.has(title), false, `${title} is already granted elsewhere`);
});
