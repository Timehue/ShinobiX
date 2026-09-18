import assert from 'node:assert/strict';
import test from 'node:test';
import { dungeonEventForRun } from './dungeon-presentation';
import { craftDungeonEvents, hiddenDungeonVnEvent } from '../data/vn-events';
import { mutateDungeonRunServer } from './dungeon-api';
import type { Character } from '../types/character';

test('every crafted dungeon keeps its scene and biome across serialized run recovery', () => {
    for (const event of craftDungeonEvents) {
        const run = JSON.parse(JSON.stringify({ token: 'run12345678', startedAt: 1, entry: 'key', presentationEventId: event.id }));
        assert.equal(dungeonEventForRun(run, []).id, event.id);
        assert.equal(dungeonEventForRun(run, []).biome, event.biome);
        const edit = { ...event, name: 'Edited vault' };
        assert.equal(dungeonEventForRun(run, [edit]), edit);
        assert.equal(dungeonEventForRun(run, [], craftDungeonEvents.find(e => e.id !== event.id)), event,
            'another selected dungeon must not retheme an existing sealed run');
    }
    const free = { token: 'free12345678', startedAt: 1, entry: 'free' as const, presentationEventId: 'craft-dungeon-snow' };
    assert.equal(dungeonEventForRun(free, []), hiddenDungeonVnEvent);
    assert.equal(dungeonEventForRun({ ...free, entry: 'key', presentationEventId: 'unrecognized' }, []), hiddenDungeonVnEvent);
    assert.equal(dungeonEventForRun({ token: 'old12345678', startedAt: 1 }, [], craftDungeonEvents[0]), craftDungeonEvents[0]);
});

test('only start requests send the cosmetic dungeon identity', async () => {
    const realFetch = globalThis.fetch, bodies: Record<string, unknown>[] = [];
    globalThis.fetch = async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ character: { name: 'QA' } as Character, token: 'run12345678', _saveVersion: 2 }));
    };
    try {
        await mutateDungeonRunServer('QA', 'start', '', 'craft-dungeon-snow');
        await mutateDungeonRunServer('QA', 'settle', 'run12345678', 'craft-dungeon-snow');
        assert.equal(bodies[0].presentationEventId, 'craft-dungeon-snow');
        assert.equal('presentationEventId' in bodies[1], false);
    } finally { globalThis.fetch = realFetch; }
});
