import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { showdownBusyIssue } from './_showdown-readiness.js';
import { petCombatBusyReason } from './_pet-busy.js';

describe('Showdown admission busy rule', () => {
    const now = 1_000_000;
    it('refuses a pet still holding a finished expedition, like every other pet battle mode', () => {
        const back = { id: 'p1', name: 'Ember', expedition: { endsAt: now - 1 } };
        assert.match(showdownBusyIssue({}, [back], now) ?? '', /Collect it before battling/);
        assert.equal(petCombatBusyReason({}, back, now), 'pet-is-on-expedition', 'the rule Pet Arena, Ladder and Warfront use');
    });

    it('still names a pet that is away, and admits one with no expedition', () => {
        assert.match(showdownBusyIssue({}, [{ id: 'p1', name: 'Ember', expedition: { endsAt: now + 60_000 } }], now) ?? '', /away on an expedition/);
        assert.equal(showdownBusyIssue({}, [{ id: 'p1', name: 'Ember', expedition: null }], now), null);
    });
});
