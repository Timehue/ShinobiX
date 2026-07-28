import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TowerSession } from '../towers/_tower-session.js';
import {
    createHollowGateCombatBinding,
    hollowGateCombatReward,
    hollowGateEncounterKey,
    hollowGatePostWinHp,
    normalizeHollowGateNodeId,
    settleHollowGateCombatBinding,
    validateHollowGateCombatSession,
} from './_combat-session.js';

const token = 'sealed-hollow-gate-token';
const playerName = 'beta-player';
const binding = createHollowGateCombatBinding({
    playerName,
    token,
    floor: 3,
    nodeId: 'floor:3:tile:127',
    kind: 'elite',
    now: 1_000,
    runId: 'hgcombat-fixed',
});
const activeEncounter = {
    runId: binding.runId,
    nodeId: binding.nodeId,
    floor: binding.floor,
    kind: binding.kind,
    enemyProfileId: binding.enemyProfileId,
    createdAt: binding.createdAt,
};
const session = {
    runId: binding.runId,
    status: 'done',
    winner: 'squad',
    actors: [{ side: 'squad', ownerSlug: playerName }],
} as TowerSession;

function reason(result: ReturnType<typeof validateHollowGateCombatSession>): string {
    assert.equal(result.ok, false);
    return result.ok ? 'unexpected-success' : result.reason;
}

test('Hollow Gate combat validates the exact player, token, run, node, floor, kind and enemy binding', () => {
    assert.equal(validateHollowGateCombatSession({ binding, session, activeEncounter, playerName, token }).ok, true);
    assert.equal(reason(validateHollowGateCombatSession({ binding, session, activeEncounter, playerName: 'attacker', token })), 'wrong-player');
    assert.equal(reason(validateHollowGateCombatSession({ binding, session, activeEncounter, playerName, token: 'forged' })), 'wrong-token');
    assert.equal(reason(validateHollowGateCombatSession({ binding, session: { ...session, runId: 'other' }, activeEncounter, playerName, token })), 'wrong-run');
    assert.equal(reason(validateHollowGateCombatSession({ binding, session, activeEncounter: { ...activeEncounter, nodeId: 'floor:3:tile:128' }, playerName, token })), 'binding-drift');
    assert.equal(reason(validateHollowGateCombatSession({ binding, session: { ...session, status: 'active' }, activeEncounter, playerName, token })), 'not-complete');
    assert.equal(reason(validateHollowGateCombatSession({ binding, session: { ...session, actors: [] }, activeEncounter, playerName, token })), 'not-a-member');
});

test('Hollow Gate combat binding settles once and rejects replay', () => {
    const settled = settleHollowGateCombatBinding(binding, true, 2_000);
    assert.equal(settled.status, 'won');
    assert.equal(settled.settledAt, 2_000);
    assert.equal(reason(validateHollowGateCombatSession({ binding: settled, session, activeEncounter, playerName, token })), 'already-settled');
    assert.deepEqual(settleHollowGateCombatBinding(settled, false, 3_000), settled);
});

test('node ids are bounded and encounter receipts include kind to prevent boss replay on a second node', () => {
    assert.equal(normalizeHollowGateNodeId('floor:5:tile:321'), 'floor:5:tile:321');
    assert.equal(normalizeHollowGateNodeId('floor:5:ambush:threat-1'), 'floor:5:ambush:threat-1');
    assert.equal(normalizeHollowGateNodeId('../tower:attacker'), '');
    assert.notEqual(hollowGateEncounterKey(5, 'boss', 'floor:5:tile:1'), hollowGateEncounterKey(5, 'battle', 'floor:5:tile:1'));
});

test('server reward table preserves the shipped floor scaling and profession rules', () => {
    // Character XP retired: the old xp line folds into ryo at ~0.75:1
    // (battle 380 + 105 = 485; boss 2400 + 450 = 2850 base before depth).
    assert.deepEqual(hollowGateCombatReward(1, 'battle'), {
        xp: 0, ryo: 485, auraDust: 5, honorSeals: 0, boneCharms: 0,
        fateShards: 0, hollowShards: 0, fragments: 0, veils: 0,
    });
    const boss = hollowGateCombatReward(5, 'boss', 'vanguard');
    assert.equal(boss.xp, 0);
    assert.equal(boss.ryo, Math.floor(2850 * 1.8)); // depth ×1.8 on floor 5
    assert.equal(boss.auraDust, 54);
    assert.equal(boss.honorSeals, 120);
    assert.equal(boss.boneCharms, 14);
    assert.equal(boss.fateShards, 5);
    assert.equal(boss.hollowShards, 40);
    assert.equal(boss.fragments, 2);
    assert.equal(boss.veils, 1);
});

test('Second Wind is sealed into one combat binding and cannot be added at settlement', () => {
    assert.equal(binding.secondWindArmed, undefined);
    const armed = createHollowGateCombatBinding({
        playerName, token, floor: 2, nodeId: 'floor:2:tile:9', kind: 'battle', secondWindArmed: true,
    });
    assert.deepEqual(hollowGateCombatReward(4, 'elite'), hollowGateCombatReward(4, 'battle'));
    assert.deepEqual(hollowGateCombatReward(4, 'beast'), hollowGateCombatReward(4, 'battle'));
    assert.equal(armed.secondWindArmed, true);
    assert.equal(settleHollowGateCombatBinding(armed, false).secondWindArmed, true);
});

test('server settlement preserves the shipped post-win HP recovery', () => {
    assert.equal(hollowGatePostWinHp(500, 120, 'battle'), 140);
    assert.equal(hollowGatePostWinHp(500, 120, 'boss'), 180);
    assert.equal(hollowGatePostWinHp(150, 140, 'boss'), 150);
});
