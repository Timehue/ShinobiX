import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldApplyBreedingStatus } from './pet-breeding-status-guard.js';

test('older overlapping status responses are ignored', () => {
    assert.equal(shouldApplyBreedingStatus({ requestNo: 1, latestRequestNo: 2, responseVersion: 8, latestAcceptedVersion: 7 }), false);
    assert.equal(shouldApplyBreedingStatus({ requestNo: 2, latestRequestNo: 2, responseVersion: 8, latestAcceptedVersion: 7 }), true);
});

test('lower authoritative save versions cannot regress newer local state', () => {
    assert.equal(shouldApplyBreedingStatus({ requestNo: 3, latestRequestNo: 3, responseVersion: 10, latestAcceptedVersion: 11 }), false);
    assert.equal(shouldApplyBreedingStatus({ requestNo: 4, latestRequestNo: 4, responseVersion: 0, latestAcceptedVersion: 11 }), true, 'legacy unversioned responses remain usable only when current');
    assert.equal(shouldApplyBreedingStatus({ requestNo: 5, latestRequestNo: 5, responseVersion: 10, latestAcceptedVersion: 11, aborted: true }), false);
});
