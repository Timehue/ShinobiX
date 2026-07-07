import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    canPlayerClaimMission,
    canPlayerReceiveMission,
    normalizeMissionEligibility,
    validateCreatorMissionEligibility,
} from './_eligibility.js';

test('Hollow Gate Warden missions normalize to level 100 plus Hollow Gate access', () => {
    const eligibility = normalizeMissionEligibility({
        id: 'custom-warden',
        name: 'Kill Hollow Gate Warden',
        levelReq: 1,
    });
    assert.equal(eligibility.minLevel, 100);
    assert.equal(eligibility.requiresHollowGateUnlocked, true);
});

test('level 20 players cannot receive level 100 endgame objectives', () => {
    const result = canPlayerReceiveMission(
        { level: 20, village: 'Leaf' },
        { id: 'custom-warden', name: 'Kill Hollow Gate Warden', levelReq: 1 },
        { systems: { hollowGate: false } },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'level-too-low');
    assert.equal(result.requiredLevel, 100);
});

test('level 100 players still need Hollow Gate access for Warden objectives', () => {
    const result = canPlayerReceiveMission(
        { level: 100, village: 'Leaf' },
        { id: 'custom-warden', name: 'Kill Hollow Gate Warden' },
        { systems: { hollowGate: false } },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'system-locked');
    assert.equal(result.requiredSystem, 'hollowGate');
});

test('level 100 players can receive Warden objectives only with Hollow Gate unlocked', () => {
    const result = canPlayerReceiveMission(
        { level: 100, village: 'Leaf' },
        { id: 'custom-warden', name: 'Kill Hollow Gate Warden' },
        { systems: { hollowGate: true } },
    );
    assert.equal(result.ok, true);
});

test('profession, pet, and ranked gates return machine-readable reasons', () => {
    assert.equal(canPlayerReceiveMission(
        { level: 20, profession: 'vanguard', professionRank: 4 },
        { name: 'Triage Run', eligibility: { minLevel: 13, requiredProfession: 'healer' } },
    ).reason, 'profession-mismatch');

    assert.equal(canPlayerReceiveMission(
        { level: 20, profession: 'petTamer', professionRank: 4, pets: [] },
        { name: 'Coach', eligibility: { minLevel: 13, requiredProfession: 'petTamer', requiresPet: true } },
    ).reason, 'missing-pet');

    assert.equal(canPlayerReceiveMission(
        { level: 20, profession: 'vanguard', professionRank: 4 },
        { name: 'Ranked Grinder', eligibility: { minLevel: 10, requiresRankedUnlocked: true } },
        { systems: { ranked: false } },
    ).reason, 'system-locked');
});

test('claim rejects ineligible weekly Warden mission even if posted manually', () => {
    const result = canPlayerClaimMission(
        { level: 37, village: 'Leaf' },
        { id: 'wk-hollow-warden', name: 'Hollow Gate Warden', eligibility: { minLevel: 100, requiresHollowGateUnlocked: true } },
        { systems: { hollowGate: false } },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'level-too-low');
    assert.equal(result.requiredLevel, 100);
});

test('creator mission validation blocks Warden publishing below level 100', () => {
    const result = validateCreatorMissionEligibility({
        id: 'admin-warden',
        name: 'Kill Hollow Gate Warden',
        description: 'Defeat the endgame shrine keeper.',
        levelReq: 1,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing-hollow-gate-requirement');
    assert.equal(result.requiredLevel, 100);
    assert.equal(result.requiredSystem, 'hollowGate');
});
