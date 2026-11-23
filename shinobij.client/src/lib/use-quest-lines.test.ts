import test from 'node:test';
import assert from 'node:assert/strict';
import { coastSageWaiting } from './use-quest-lines';
import type { QuestLinesList } from './quest-lines-api';

const list = (lines: { id: string; state: string; giver: string }[]) => ({ lines }) as unknown as QuestLinesList;

test('the Wandering Sage stands in the field while his quest is on offer, and not after it is taken', () => {
    assert.equal(coastSageWaiting(null), false, 'no list yet (or below the coast level): no sage');
    assert.equal(coastSageWaiting(list([{ id: 'shuttered-boat', state: 'open', giver: 'wandering-sage' }])), true);
    assert.equal(coastSageWaiting(list([{ id: 'shuttered-boat', state: 'active', giver: 'wandering-sage' }])), false, 'taken');
    assert.equal(coastSageWaiting(list([{ id: 'shuttered-boat', state: 'done', giver: 'wandering-sage' }])), false, 'finished');
    assert.equal(coastSageWaiting(list([{ id: 'first-footing', state: 'open', giver: 'urabe' }])), false, 'another keeper offers at a counter');
});
