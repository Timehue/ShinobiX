import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHollowGateCombatBinding, settleHollowGateCombatBinding } from './_combat-session.js';

test('Hollow Gate survives 50,000 mixed Solo PvE/pet reconnect settlement replays', () => {
    let accepted = 0, rejected = 0;
    for (let encounter = 0; encounter < 500; encounter += 1) {
        const binding = createHollowGateCombatBinding({
            playerName: 'reconnect-soak-player', token: `sealed-token-${encounter}`,
            floor: encounter % 5 + 1, nodeId: `floor:${encounter % 5 + 1}:tile:${encounter}`,
            kind: encounter % 5 === 4 ? 'boss' : encounter % 4 === 0 ? 'elite' : 'battle',
            combatMode: encounter % 2 === 0 ? 'solo-pve' : 'pet', now: 1_000 + encounter, runId: `hgcombat-soak-${encounter}`,
        });
        const won = encounter % 3 !== 0;
        const first = settleHollowGateCombatBinding(binding, won, 10_000 + encounter);
        accepted += 1;
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const replay = settleHollowGateCombatBinding(first, !won, 20_000 + attempt);
            assert.strictEqual(replay, first);
            rejected += 1;
        }
    }
    assert.equal(accepted, 500);
    assert.equal(rejected, 50_000);
});
