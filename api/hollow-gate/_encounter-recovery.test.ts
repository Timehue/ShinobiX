import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHollowGateCombatBinding } from './_combat-session.js';
import { hollowGateEncounterRecovery } from './_encounter-recovery.js';

test('a pending threat ambush remains recoverable after the browser loses its pointer', () => {
    const pendingAmbush = { nodeId: 'floor:2:ambush:threat-v25', kind: 'ambush' as const };
    assert.deepEqual(hollowGateEncounterRecovery({ pendingAmbush }, null, 'shinobi', 'token'), { pendingAmbush });
});

test('only the matching active binding can restore a combat pointer', () => {
    const binding = createHollowGateCombatBinding({
        playerName: 'shinobi', token: 'token', floor: 2,
        nodeId: 'floor:2:ambush:threat-v25', kind: 'ambush', combatMode: 'pet',
    });
    const activeEncounter = {
        runId: binding.runId, nodeId: binding.nodeId, floor: binding.floor,
        kind: binding.kind, enemyProfileId: binding.enemyProfileId, createdAt: binding.createdAt,
    };
    const recovered = hollowGateEncounterRecovery({ activeEncounter }, binding, 'shinobi', 'token');
    assert.deepEqual(recovered.activeCombat, {
        runId: binding.runId, nodeId: binding.nodeId, floor: binding.floor,
        kind: binding.kind, mode: 'pet',
    });
    assert.equal(hollowGateEncounterRecovery({ activeEncounter }, binding, 'shinobi', 'wrong').activeCombat, undefined);
    assert.equal(hollowGateEncounterRecovery({ activeEncounter }, binding, 'other', 'token').activeCombat, undefined);
    assert.equal(hollowGateEncounterRecovery({ activeEncounter }, { ...binding, status: 'won' }, 'shinobi', 'token').activeCombat, undefined);
});
