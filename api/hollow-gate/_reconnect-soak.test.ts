import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createHollowGateCombatBinding,
    settleHollowGateCombatBinding,
    validateHollowGatePetClaim,
    validateHollowGatePveClaim,
    type HollowGateActiveEncounter,
} from './_combat-session.js';

/**
 * Deterministic reconnect storm: 500 encounters × 100 duplicate result posts.
 * This targets the exact one-use binding primitive used before combat-settle
 * reads its durable hg-combat-paid receipt. A duplicate may reconcile state,
 * but can never reopen the binding or change its first settlement.
 */
test('Hollow Gate survives 50,000 mixed PvE/pet reconnect settlement replays', () => {
    const attemptsPerEncounter = 100;
    const encounters = 500;
    let acceptedFirstSettlements = 0;
    let rejectedReplays = 0;

    for (let encounter = 0; encounter < encounters; encounter += 1) {
        const combatMode = encounter % 2 === 0 ? 'pve' as const : 'pet' as const;
        const won = encounter % 3 !== 0;
        const token = `sealed-token-${encounter}`;
        const binding = createHollowGateCombatBinding({
            playerName: 'reconnect-soak-player',
            token,
            floor: encounter % 5 + 1,
            nodeId: `floor:${encounter % 5 + 1}:tile:${encounter}`,
            kind: encounter % 5 === 4 ? 'boss' : encounter % 4 === 0 ? 'elite' : 'battle',
            combatMode,
            now: 1_000 + encounter,
            runId: `hgcombat-soak-${encounter}`,
        });
        const activeEncounter: HollowGateActiveEncounter = {
            runId: binding.runId,
            nodeId: binding.nodeId,
            floor: binding.floor,
            kind: binding.kind,
            enemyProfileId: binding.enemyProfileId,
            createdAt: binding.createdAt,
        };
        const validate = combatMode === 'pve' ? validateHollowGatePveClaim : validateHollowGatePetClaim;
        assert.equal(validate({
            binding,
            activeEncounter,
            playerName: binding.playerName,
            token,
        }).ok, true);

        const settledAt = 10_000 + encounter;
        const first = settleHollowGateCombatBinding(binding, won, settledAt);
        acceptedFirstSettlements += 1;

        for (let attempt = 0; attempt < attemptsPerEncounter; attempt += 1) {
            const replay = settleHollowGateCombatBinding(first, !won, settledAt + attempt + 1);
            assert.strictEqual(replay, first, 'a replay returns the immutable first settlement');
            const validation = validate({
                binding: replay,
                activeEncounter,
                playerName: binding.playerName,
                token,
            });
            assert.equal(validation.ok, false);
            if (!validation.ok) assert.equal(validation.reason, 'already-settled');
            rejectedReplays += 1;
        }
    }

    assert.equal(acceptedFirstSettlements, encounters);
    assert.equal(rejectedReplays, encounters * attemptsPerEncounter);
});
