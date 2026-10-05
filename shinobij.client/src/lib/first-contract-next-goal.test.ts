import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Character } from '../types/character';
import { baseStats } from './stats';
import { firstContractNextGoal } from './first-contract-next-goal';

function character(patch: Partial<Character> = {}): Character {
    return { name: 'Rill', village: 'Frostfang', level: 2, stats: baseStats(), elements: [], element: '', equippedJutsuIds: [], examsPassed: [], academyChecklistClaimed: true, onboardingStep: 'done', ...patch } as Character;
}
test('the completed journal uses current progress and skips an active training timer', () => {
    const save = character({ totalAiKills: 1 });
    assert.equal(firstContractNextGoal(save).screen, 'training');
    const goal = firstContractNextGoal(save, true);
    assert.equal(goal.screen, 'missions');
    assert.match(goal.detail, /Win 3 AI battles: 1\/3/);
    assert.match(firstContractNextGoal(character({ totalAiKills: 3 }), true).detail, /Complete 3 missions/);
});
test('completed requirements route to the Logbook for the claim', () => {
    const goal = firstContractNextGoal(character({ level: 3, academyChecklistClaimed: false, academyTrialClaimed: true, academySectorVisited: true, elements: ['Fire'], totalAiKills: 30, totalMissionsCompleted: 30, totalStatsTrained: 500, equippedJutsuIds: ['a', 'b', 'c', 'd'], jutsuMastery: [{ jutsuId: 'a', level: 3, xp: 0 }] }));
    assert.equal(goal.screen, 'logbook');
    assert.match(goal.detail, /requirements are complete/);
});
test('a veteran with no outstanding hold can choose a goal without a stale rookie task', () => {
    const goal = firstContractNextGoal(character({ level: 50, examsPassed: ['genin', 'chunin'] }));
    assert.equal(goal.screen, 'logbook');
    assert.equal(goal.title, 'Choose your next milestone');
});
