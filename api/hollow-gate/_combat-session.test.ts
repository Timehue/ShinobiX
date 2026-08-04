import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';
import {
    createHollowGateCombatBinding,
    hollowGateCombatReward,
    hollowGateEncounterKey,
    hollowGatePostWinHp,
    normalizeHollowGateNodeId,
    settleHollowGateCombatBinding,
    validateHollowGatePetClaim,
    validateHollowGateSoloPveSession,
} from './_combat-session.js';

const token = 'sealed-hollow-gate-token';
const playerName = 'beta-player';
const binding = createHollowGateCombatBinding({ playerName, token, floor: 3, nodeId: 'floor:3:tile:127', kind: 'elite', now: 1_000, runId: 'hgcombat-fixed' });
const activeEncounter = { runId: binding.runId, nodeId: binding.nodeId, floor: binding.floor, kind: binding.kind, enemyProfileId: binding.enemyProfileId, createdAt: binding.createdAt };
const fighter = (name: string) => ({ name, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, shield: 0, statuses: [], character: { name, level: 10, stats: {}, jutsu: [] }, pos: name === playerName ? 62 : 33 });
function terminalSession(overrides: Partial<SoloPveSession> = {}): SoloPveSession {
    const base = createSoloPveSession({
        sessionId: binding.runId,
        ownerSlug: playerName,
        encounter: { kind: 'hollow-gate', id: 'sealed', sourceId: binding.enemyProfileId, bindingId: binding.runId, metadata: { floor: binding.floor, nodeId: binding.nodeId, combatKind: binding.kind } },
        player: fighter(playerName), enemy: fighter('hound'), now: 1_000,
    });
    return { ...base, status: 'done', winner: 'player', outcome: 'win', terminalEvidence: { finishedAt: 2_000, finalMoveToken: 'move-token', finalVersion: 2, finalEventSeq: 1, winner: 'player', outcome: 'win', itemsUsed: {}, settlementState: 'pending' }, ...overrides };
}
const reason = (result: ReturnType<typeof validateHollowGateSoloPveSession>): string => result.ok ? 'unexpected-success' : result.reason;

test('Hollow Gate validates exact terminal Solo PvE player, token, run, node, floor, kind, and enemy binding', () => {
    const session = terminalSession();
    assert.equal(validateHollowGateSoloPveSession({ binding, session, activeEncounter, playerName, token }).ok, true);
    assert.equal(reason(validateHollowGateSoloPveSession({ binding, session, activeEncounter, playerName: 'attacker', token })), 'wrong-player');
    assert.equal(reason(validateHollowGateSoloPveSession({ binding, session, activeEncounter, playerName, token: 'forged' })), 'wrong-token');
    assert.equal(reason(validateHollowGateSoloPveSession({ binding, session: { ...session, sessionId: 'other' }, activeEncounter, playerName, token })), 'wrong-run');
    assert.equal(reason(validateHollowGateSoloPveSession({ binding, session, activeEncounter: { ...activeEncounter, nodeId: 'floor:3:tile:128' }, playerName, token })), 'binding-drift');
    assert.equal(reason(validateHollowGateSoloPveSession({ binding, session: { ...session, status: 'active', terminalEvidence: undefined }, activeEncounter, playerName, token })), 'not-complete');
    assert.equal(reason(validateHollowGateSoloPveSession({ binding, session: { ...session, ownerSlug: 'attacker' }, activeEncounter, playerName, token })), 'not-a-member');
});

test('Hollow Gate combat binding and Solo receipt settle once', () => {
    const session = terminalSession();
    const settled = settleHollowGateCombatBinding(binding, true, 2_000);
    assert.equal(settled.status, 'won');
    assert.equal(settled.settledAt, 2_000);
    assert.equal(reason(validateHollowGateSoloPveSession({ binding: settled, session, activeEncounter, playerName, token })), 'already-settled');
    assert.equal(reason(validateHollowGateSoloPveSession({ binding, session: { ...session, settlementState: 'settled' }, activeEncounter, playerName, token })), 'already-settled');
    assert.deepEqual(settleHollowGateCombatBinding(settled, false, 3_000), settled);
});

test('pet Hollow Hound receipts remain a separate server-verified branch', () => {
    const pet = createHollowGateCombatBinding({ playerName, token, floor: 4, nodeId: 'floor:4:tile:18', kind: 'beast', combatMode: 'pet', runId: 'hgcombat-pet' });
    const active = { runId: pet.runId, nodeId: pet.nodeId, floor: pet.floor, kind: pet.kind, enemyProfileId: pet.enemyProfileId, createdAt: pet.createdAt };
    assert.equal(validateHollowGatePetClaim({ binding: pet, activeEncounter: active, playerName, token }).ok, true);
    assert.equal(validateHollowGatePetClaim({ binding: { ...pet, combatMode: 'solo-pve' }, activeEncounter: active, playerName, token }).ok, false);
});

test('node ids and encounter keys reject identity reuse', () => {
    assert.equal(normalizeHollowGateNodeId('floor:5:tile:321'), 'floor:5:tile:321');
    assert.equal(normalizeHollowGateNodeId('floor:5:ambush:threat-1'), 'floor:5:ambush:threat-1');
    assert.equal(normalizeHollowGateNodeId('../tower:attacker'), '');
    assert.notEqual(hollowGateEncounterKey(5, 'boss', 'floor:5:tile:1'), hollowGateEncounterKey(5, 'battle', 'floor:5:tile:1'));
});

test('server reward table preserves floor scaling and profession rules', () => {
    assert.deepEqual(hollowGateCombatReward(1, 'battle'), { xp: 0, ryo: 485, auraDust: 5, honorSeals: 0, boneCharms: 0, fateShards: 0, hollowShards: 0, fragments: 0, veils: 0 });
    const boss = hollowGateCombatReward(5, 'boss', 'vanguard');
    assert.deepEqual({ xp: boss.xp, ryo: boss.ryo, auraDust: boss.auraDust, honorSeals: boss.honorSeals, boneCharms: boss.boneCharms, fateShards: boss.fateShards, hollowShards: boss.hollowShards, fragments: boss.fragments, veils: boss.veils }, { xp: 0, ryo: Math.floor(2850 * 1.8), auraDust: 54, honorSeals: 120, boneCharms: 14, fateShards: 5, hollowShards: 40, fragments: 2, veils: 1 });
});

test('Second Wind is sealed at start and post-win HP is the server session HP', () => {
    const armed = createHollowGateCombatBinding({ playerName, token, floor: 2, nodeId: 'floor:2:tile:9', kind: 'battle', secondWindArmed: true });
    assert.equal(armed.secondWindArmed, true);
    assert.equal(hollowGatePostWinHp(500, 120, 'battle'), 120);
    assert.equal(hollowGatePostWinHp(500, 120, 'boss'), 120);
});
