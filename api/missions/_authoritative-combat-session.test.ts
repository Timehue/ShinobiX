import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TowerSession } from '../towers/_tower-session.js';
import { combatMissionByKey } from './_mission-catalog.js';
import {
    createMissionCombatBinding,
    missionCombatRewardFingerprint,
    settleMissionCombatBinding,
    validateCompletedMissionCombatSession,
} from './_authoritative-combat-session.js';

function rejectionReason(result: ReturnType<typeof validateCompletedMissionCombatSession>): string {
    assert.equal(result.ok, false);
    return result.ok ? 'unexpected-success' : result.reason;
}

const mission = combatMissionByKey('combat-c-patrol')!;
const now = Date.UTC(2026, 6, 14, 12);
const session = {
    runId: 'tower-mission-run-1',
    status: 'done',
    winner: 'squad',
    actors: [{ side: 'squad', ownerSlug: 'beta-cert-player' }],
} as TowerSession;

test('sealed mission binding accepts only its completed winning server session', () => {
    const binding = createMissionCombatBinding({
        runId: session.runId,
        playerName: 'beta-cert-player',
        mission,
        now,
        sessionId: 'mcombat-fixed',
    });
    const result = validateCompletedMissionCombatSession({ binding, session, playerName: 'beta-cert-player', mission, now: now + 1000 });
    assert.equal(result.ok, true);
    assert.equal(binding.rewardFingerprint, missionCombatRewardFingerprint(mission));
});

test('mission binding rejects wrong player, mission, run, expiry, unfinished and losing sessions', () => {
    const binding = createMissionCombatBinding({ runId: session.runId, playerName: 'beta-cert-player', mission, now });
    const otherMission = combatMissionByKey('combat-b-escort')!;
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session, playerName: 'attacker', mission, now })), 'wrong-player');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session, playerName: 'beta-cert-player', mission: otherMission, now })), 'wrong-mission');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session: { ...session, runId: 'other' }, playerName: 'beta-cert-player', mission, now })), 'wrong-run');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session, playerName: 'beta-cert-player', mission, now: binding.expiresAt })), 'expired');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session: { ...session, status: 'active' }, playerName: 'beta-cert-player', mission, now })), 'not-complete');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session: { ...session, winner: 'enemy' }, playerName: 'beta-cert-player', mission, now })), 'not-won');
});

test('mission binding rejects non-member settlement, reward drift, and replay', () => {
    const binding = createMissionCombatBinding({ runId: session.runId, playerName: 'beta-cert-player', mission, now });
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({
        binding,
        session: { ...session, actors: [{ side: 'squad', ownerSlug: 'someone-else' }] } as TowerSession,
        playerName: 'beta-cert-player', mission, now,
    })), 'not-a-member');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({
        binding: { ...binding, rewardFingerprint: 'forged' }, session, playerName: 'beta-cert-player', mission, now,
    })), 'reward-drift');
    const settled = settleMissionCombatBinding(binding, now + 5);
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding: settled, session, playerName: 'beta-cert-player', mission, now: now + 6 })), 'already-settled');
    assert.deepEqual(settleMissionCombatBinding(settled, now + 7), settled);
});
