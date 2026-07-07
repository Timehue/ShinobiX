import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairDailyMissionsForEligibility, type DailyMissionsState } from './_progress.js';

function impossibleState(): DailyMissionsState {
    return {
        date: '2026-05-25',
        profession: 'healer',
        missions: [
            {
                id: 'custom-warden:2026-05-25',
                templateId: 'custom-warden',
                kind: 'healer-heal-count',
                name: 'Kill Hollow Gate Warden',
                description: 'Defeat the Hollow Gate Warden.',
                target: 1,
                progress: 0,
                xpReward: 999,
                completedAt: null,
                claimed: false,
            },
            {
                id: 'healer-triage-run:2026-05-25',
                templateId: 'healer-triage-run',
                kind: 'healer-heal-unique',
                name: 'Triage Run',
                description: 'Heal 3 different patients.',
                target: 3,
                progress: 3,
                xpReward: 50,
                completedAt: 1,
                claimed: true,
            },
        ],
    };
}

test('stored impossible mission is replaced on mission load', () => {
    const repaired = repairDailyMissionsForEligibility({
        state: impossibleState(),
        playerName: 'aya',
        today: '2026-05-25',
        slotCount: 3,
        character: { level: 20, profession: 'healer', professionRank: 1, village: 'Leaf' },
    });
    assert.equal(repaired.replacements.length, 1);
    assert.equal(repaired.replacements[0].replacedTemplateId, 'custom-warden');
    assert.notEqual(repaired.state.missions[0].templateId, 'custom-warden');
});

test('completed and claimed missions remain untouched during repair', () => {
    const repaired = repairDailyMissionsForEligibility({
        state: impossibleState(),
        playerName: 'aya',
        today: '2026-05-25',
        slotCount: 3,
        character: { level: 20, profession: 'healer', professionRank: 1, village: 'Leaf' },
    });
    const completed = repaired.state.missions.find((mission) => mission.id === 'healer-triage-run:2026-05-25');
    assert.equal(completed?.completedAt, 1);
    assert.equal(completed?.claimed, true);
});

test('claimed impossible mission does not become claimable again', () => {
    const state = impossibleState();
    state.missions[0] = { ...state.missions[0], completedAt: 1, claimed: true };
    const repaired = repairDailyMissionsForEligibility({
        state,
        playerName: 'aya',
        today: '2026-05-25',
        slotCount: 3,
        character: { level: 20, profession: 'healer', professionRank: 1, village: 'Leaf' },
    });
    assert.equal(repaired.replacements.length, 0);
    assert.equal(repaired.state.missions[0].templateId, 'custom-warden');
    assert.equal(repaired.state.missions[0].claimed, true);
});

test('stored impossible mission replacement is deterministic', () => {
    const opts = {
        state: impossibleState(),
        playerName: 'aya',
        today: '2026-05-25',
        slotCount: 3,
        character: { level: 20, profession: 'healer', professionRank: 1, village: 'Leaf' },
    };
    const first = repairDailyMissionsForEligibility(opts);
    const second = repairDailyMissionsForEligibility({ ...opts, state: impossibleState() });
    assert.equal(first.replacements[0].replacementTemplateId, second.replacements[0].replacementTemplateId);
});
