import assert from 'node:assert/strict';
import test from 'node:test';
import { NPC_VILLAGE_ROSTER } from '../../../shared/npc-village-roster';
import { peerStandingKind } from './peer-standing-kind';

test('each reserved resident has a standing figure even with only a name in presence', () => {
    for (const resident of NPC_VILLAGE_ROSTER) {
        assert.equal(peerStandingKind(resident.name, 'starter-one'), 'cinderhold-' + resident.id);
        assert.equal(peerStandingKind(resident.id, 'starter-two'), 'cinderhold-' + resident.id);
    }
    assert.equal(peerStandingKind('Sayo Ridge', 'starter-two'), 'starter-two');
    assert.equal(peerStandingKind('Sayo', 'underground-medic'), 'underground-medic');
});
