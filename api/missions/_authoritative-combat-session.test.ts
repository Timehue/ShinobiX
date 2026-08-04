import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { combatMissionByKey } from './_mission-catalog.js';
import {
    createMissionCombatActivePointer,
    createMissionCombatBinding,
    missionCombatRewardFingerprint,
    resumableMissionCombatSession,
    settleMissionCombatBinding,
    validateCompletedMissionCombatSession,
    validateSettledMissionCombatSession,
} from './_authoritative-combat-session.js';

function rejectionReason(result: ReturnType<typeof validateCompletedMissionCombatSession>): string {
    assert.equal(result.ok, false);
    return result.ok ? 'unexpected-success' : result.reason;
}

const mission = combatMissionByKey('combat-c-patrol')!;
const now = Date.UTC(2026, 6, 14, 12);
const runId = 'mission-run-1';
const session = {
    runtime: 'solo-pve',
    schemaVersion: 1,
    sessionId: runId,
    ownerSlug: 'beta-cert-player',
    encounter: { kind: 'mission', id: mission.key, sourceId: mission.aiProfileId, bindingId: runId },
    status: 'done',
    winner: 'player',
    settlementState: 'pending',
} as SoloPveSession;

test('sealed mission binding accepts only its completed winning solo-PvE session', () => {
    const binding = createMissionCombatBinding({ runId, playerName: 'beta-cert-player', mission, now });
    const result = validateCompletedMissionCombatSession({ binding, session, playerName: 'beta-cert-player', mission, now: now + 1000 });
    assert.equal(result.ok, true);
    assert.equal(binding.rewardFingerprint, missionCombatRewardFingerprint(mission));
});

test('mission binding rejects wrong player, mission, run, expiry, unfinished and losing sessions', () => {
    const binding = createMissionCombatBinding({ runId, playerName: 'beta-cert-player', mission, now });
    const otherMission = combatMissionByKey('combat-b-escort')!;
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session, playerName: 'attacker', mission, now })), 'wrong-player');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session, playerName: 'beta-cert-player', mission: otherMission, now })), 'wrong-mission');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session: { ...session, sessionId: 'other' }, playerName: 'beta-cert-player', mission, now })), 'wrong-run');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session, playerName: 'beta-cert-player', mission, now: binding.expiresAt })), 'expired');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session: { ...session, status: 'active' }, playerName: 'beta-cert-player', mission, now })), 'not-complete');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding, session: { ...session, winner: 'enemy' }, playerName: 'beta-cert-player', mission, now })), 'not-won');
});

test('mission binding rejects non-member settlement, encounter drift, reward drift, and replay', () => {
    const binding = createMissionCombatBinding({ runId, playerName: 'beta-cert-player', mission, now });
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({
        binding,
        session: { ...session, ownerSlug: 'someone-else' },
        playerName: 'beta-cert-player', mission, now,
    })), 'not-a-member');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({
        binding,
        session: { ...session, encounter: { ...session.encounter, bindingId: 'forged' } },
        playerName: 'beta-cert-player', mission, now,
    })), 'wrong-mission');
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({
        binding: { ...binding, rewardFingerprint: 'forged' }, session, playerName: 'beta-cert-player', mission, now,
    })), 'reward-drift');
    const settled = settleMissionCombatBinding(binding, now + 5);
    assert.equal(rejectionReason(validateCompletedMissionCombatSession({ binding: settled, session, playerName: 'beta-cert-player', mission, now: now + 6 })), 'already-settled');
    assert.deepEqual(settleMissionCombatBinding(settled, now + 7), settled);
});

test('mission start recovery reuses only a coherent active unsettled session', () => {
    const activeSession = { ...session, status: 'active', winner: null, expiresAt: now + 60_000 } as SoloPveSession;
    const binding = createMissionCombatBinding({ runId, playerName: 'beta-cert-player', mission, now });
    const active = createMissionCombatActivePointer({ runId, playerName: 'beta-cert-player', mission, now });
    assert.equal(resumableMissionCombatSession({
        active,
        binding,
        session: activeSession,
        playerName: 'beta-cert-player',
        mission,
        now: now + 1_000,
    }), activeSession);

    for (const candidate of [
        { active: { ...active, runId: 'other' }, binding, session: activeSession },
        { active, binding: { ...binding, status: 'won' as const, settledAt: now + 1 }, session: activeSession },
        { active, binding, session: { ...activeSession, ownerSlug: 'other' } },
        { active, binding, session: { ...activeSession, settlementState: 'settled' as const } },
        { active: { ...active, expiresAt: now }, binding, session: activeSession },
        { active, binding, session: { ...activeSession, expiresAt: now } },
    ]) {
        assert.equal(resumableMissionCombatSession({
            ...candidate,
            playerName: 'beta-cert-player',
            mission,
            now,
        }), null);
    }
});

test('mission start recovery also returns terminal evidence pending settlement', () => {
    const terminal = { ...session, expiresAt: now + 60_000 } as SoloPveSession;
    const binding = createMissionCombatBinding({ runId, playerName: 'beta-cert-player', mission, now });
    const active = createMissionCombatActivePointer({ runId, playerName: 'beta-cert-player', mission, now });
    assert.equal(resumableMissionCombatSession({ active, binding, session: terminal, playerName: 'beta-cert-player', mission, now }), terminal);
});

test('a settled mission validates as durable proof for lost-response replay only', () => {
    const active = createMissionCombatBinding({ runId, playerName: 'beta-cert-player', mission, now });
    const binding = settleMissionCombatBinding(active, now + 1);
    const settledSession = { ...session, settlementState: 'settled' as const };
    assert.equal(validateSettledMissionCombatSession({ binding, session: settledSession, playerName: 'beta-cert-player', mission, now: now + 2 }).ok, true);
    assert.deepEqual(validateSettledMissionCombatSession({ binding: active, session, playerName: 'beta-cert-player', mission, now }), { ok: false, reason: 'not-settled' });
    assert.deepEqual(validateSettledMissionCombatSession({ binding, session, playerName: 'other', mission, now }), { ok: false, reason: 'wrong-player' });
    assert.deepEqual(validateSettledMissionCombatSession({ binding, session: { ...settledSession, sessionId: 'other' }, playerName: 'beta-cert-player', mission, now }), { ok: false, reason: 'wrong-run' });
});
