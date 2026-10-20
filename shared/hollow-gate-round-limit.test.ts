import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_ROUNDS } from '../api/combat-core/constants.js';
import { HOLLOW_GATE_SHINOBI_ROUND_LIMIT, hollowGateShinobiRoundLimit } from './hollow-gate-round-limit.js';

test('shrine shinobi cap certification keeps the shared default and unrelated runtimes unchanged', () => {
    assert.equal(MAX_ROUNDS, 25); assert.equal(HOLLOW_GATE_SHINOBI_ROUND_LIMIT, 40);
    for (const stored of [undefined, 25, 40]) {
        const active = { runtime: 'solo-pve', encounter: { kind: 'hollow-gate' }, status: 'active', hollowGateRoundLimit: stored };
        assert.equal(hollowGateShinobiRoundLimit(active), 40);
        assert.equal(hollowGateShinobiRoundLimit({ ...active, status: 'done' }), stored === 40 ? 40 : 25);
    }
    for (const runtime of ['pvp', 'card-clash', 'pet-colosseum', 'hunt-battle'])
        assert.equal(hollowGateShinobiRoundLimit({ runtime, encounter: { kind: 'hollow-gate' }, status: 'active' }), undefined);
    for (const kind of ['mission', 'generic-ai', 'world-ai', 'weekly-boss', 'tower'])
        assert.equal(hollowGateShinobiRoundLimit({ runtime: 'solo-pve', encounter: { kind }, status: 'active' }), undefined);
});
