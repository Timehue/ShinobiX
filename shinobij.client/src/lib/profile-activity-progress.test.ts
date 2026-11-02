import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Character } from '../types/character';
import { profileActivityProgress } from './profile-activity-progress';
import { HUNTER_RANKUP } from '../constants/hunter';
const character = (patch: Partial<Character> = {}) => ({ name: 'ProgressPlayer', inventory: [], itemStacks: [], ...patch }) as Character;
test('missing fields start at level one and the first Hunter Rank', () => {
    const rows = profileActivityProgress(character());
    assert.equal(rows[0].value, 'Lv. 1');
    assert.equal(rows[0].detail, '0/100 XP to next level');
    assert.equal(rows[1].value, 'Lv. 1');
    assert.equal(rows[2].value, 'Novice Hunter');
});
test('gathering XP shows progress within the level and maximum status', () => {
    const rows = profileActivityProgress(character({ resourceGathering: { miningXp: 125, fishingXp: 3200 } as Character['resourceGathering'] }));
    assert.equal(rows[0].value, 'Lv. 2');
    assert.equal(rows[0].detail, '25/150 XP to next level');
    assert.equal(rows[1].value, 'Lv. 10');
    assert.match(rows[1].detail, /MAX/);
});
test('Hunter Rank progress sums inventory and stacks without awarding a rank', () => {
    const requirement = HUNTER_RANKUP[1];
    const row = profileActivityProgress(character({ hunterRank: 1, inventory: [requirement.itemId], itemStacks: [{ itemId: requirement.itemId, count: 6 }] }))[2];
    assert.equal(row.value, 'Tracker');
    assert.match(row.detail, /^7\/5 /);
    assert.match(profileActivityProgress(character({ hunterRank: 5 }))[2].detail, /MAX/);
    assert.equal(profileActivityProgress(character({ hunterRank: NaN }))[2].value, 'Novice Hunter');
});
