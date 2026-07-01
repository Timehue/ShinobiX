import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyClaimedMissionState } from './claim-mission.js';

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
