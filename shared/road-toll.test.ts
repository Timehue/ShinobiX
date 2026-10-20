import assert from 'node:assert/strict';
import test from 'node:test';
import { BANDIT_TOLL_RYO, offersBanditToll } from './road-toll.js';

test('only natural bandits offer the 500 ryo toll; other hostile choices keep their own rules', () => {
    const w = { id: 'w-12-5000-0', archetype: 'bandit' };
    assert.equal(BANDIT_TOLL_RYO, 500);
    assert.equal(offersBanditToll({ w }), true);
    assert.equal(offersBanditToll({ w, ambush: { requestId: 'an-ambush' } }), false);
    assert.equal(offersBanditToll({ w, nemesis: true }), false);
    assert.equal(offersBanditToll({ w: { ...w, archetype: 'nightblade' } }), false);
    assert.equal(offersBanditToll({ w: { ...w, id: 'nemesis' } }), false);
});
