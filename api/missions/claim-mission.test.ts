import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyClaimedMissionState,
    clearStalePendingCombatClaim,
    legacyMissionProgressSpec,
} from './claim-mission.js';

test('applyClaimedMissionState clears claimed field missions from accepted ids and progress', () => {
    const record = {
        acceptedMissionIds: ['fetch-d-supply-trail', 'other-mission'],
        missionProgress: {
            'fetch-d-supply-trail': 3,
            'fetch-d-supply-trail:raids': 1,
            'other-mission': 2,
        },
        character: { name: 'Akira' },
    };

    const updated = applyClaimedMissionState(record, 'field', 'fetch-d-supply-trail');

    assert.deepEqual(updated.acceptedMissionIds, ['other-mission']);
    assert.equal((updated.missionProgress as Record<string, unknown>)['fetch-d-supply-trail'], 0);
    assert.equal((updated.missionProgress as Record<string, unknown>)['fetch-d-supply-trail:raids'], 0);
    assert.equal((updated.missionProgress as Record<string, unknown>)['other-mission'], 2);
    assert.deepEqual(record.acceptedMissionIds, ['fetch-d-supply-trail', 'other-mission']);
});

test('applyClaimedMissionState clears claimed hunts without touching unrelated progress', () => {
    const record = {
        acceptedMissionIds: ['hunt-wild-boar', 'fetch-d-supply-trail'],
        missionProgress: {
            'hunt-wild-boar': 3,
            'fetch-d-supply-trail': 1,
            'fetch-d-supply-trail:raids': 1,
        },
    };

    const updated = applyClaimedMissionState(record, 'hunt', 'hunt-wild-boar');

    assert.deepEqual(updated.acceptedMissionIds, ['fetch-d-supply-trail']);
    assert.equal((updated.missionProgress as Record<string, unknown>)['hunt-wild-boar'], 0);
    assert.equal((updated.missionProgress as Record<string, unknown>)['fetch-d-supply-trail'], 1);
    assert.equal((updated.missionProgress as Record<string, unknown>)['fetch-d-supply-trail:raids'], 1);
});

test('applyClaimedMissionState leaves combat claims alone', () => {
    const record = {
        acceptedMissionIds: ['fetch-d-supply-trail'],
        missionProgress: { 'fetch-d-supply-trail': 3 },
    };

    assert.equal(applyClaimedMissionState(record, 'combat', 'combat-d-rank-bandit'), record);
});

test('clearStalePendingCombatClaim drops the stale key and reports cleared', () => {
    const char = { name: 'Dopey', pendingCombatMissionClaims: ['combat-b-escort', 'combat-c-patrol'] };

    const result = clearStalePendingCombatClaim(char, 'combat-b-escort');

    assert.equal(result.cleared, true);
    assert.deepEqual(result.char.pendingCombatMissionClaims, ['combat-c-patrol']);
    // input is not mutated
    assert.deepEqual(char.pendingCombatMissionClaims, ['combat-b-escort', 'combat-c-patrol']);
});

test('clearStalePendingCombatClaim is a no-op (same ref) when the key is absent', () => {
    const char = { pendingCombatMissionClaims: ['combat-c-patrol'] };

    const result = clearStalePendingCombatClaim(char, 'combat-b-escort');

    assert.equal(result.cleared, false);
    assert.equal(result.char, char);
});

test('clearStalePendingCombatClaim tolerates a missing/invalid pending list', () => {
    const char = { name: 'Dopey' };

    const result = clearStalePendingCombatClaim(char, 'combat-b-escort');

    assert.equal(result.cleared, false);
    assert.equal(result.char, char);
});

test('Legacy mission progress is derived from committed save receipts', () => {
    const date = '2026-09-01';
    assert.equal(legacyMissionProgressSpec('field', 'field-1', date, {
        claimedServerMissions: [],
    }), null);
    assert.deepEqual(legacyMissionProgressSpec('field', 'field-1', date, {
        claimedServerMissions: [`${date}:field:field-1`],
    }), {
        receiptId: `mission:${date}:field:field-1`,
        deltas: { missionCompletions: 1 },
        durableReceipt: false,
    });
    assert.deepEqual(legacyMissionProgressSpec('hunt', 'hunt-1', date, {
        claimedServerMissions: [`${date}:hunt:hunt-1`],
    })?.deltas, { huntCompletions: 1 });
    assert.deepEqual(legacyMissionProgressSpec('academy-trial', 'academy', date, {
        academyTrialClaimed: true,
    }), {
        receiptId: 'mission:academy-trial:once',
        deltas: { missionCompletions: 1 },
        durableReceipt: true,
    });
    assert.equal(legacyMissionProgressSpec('academy-checklist', 'academy', date, {
        academyChecklistClaimed: true,
    }), null);
    assert.equal(legacyMissionProgressSpec('apex', 'apex', date, {}), null);
    assert.equal(legacyMissionProgressSpec('apex', 'apex', date, {
        apexWeekClaimed: '2026-W36',
    })?.receiptId, 'mission:apex:2026-W36');
});
