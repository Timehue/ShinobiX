import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masteryBudget, sanitizeMasterySpec, masteryBonus, masteryHasCapstone } from './_profession-mastery.js';

const VAN_CAP = 32_850;
const HEAL_CAP = 49_275;

test('masteryBudget: 0 below the wall, scales, caps at 10, healer uses 1.5x wall', () => {
    assert.equal(masteryBudget('vanguard', VAN_CAP), 0);
    assert.equal(masteryBudget('vanguard', VAN_CAP + 15_000), 1);
    assert.equal(masteryBudget('vanguard', VAN_CAP + 6 * 15_000), 6);
    assert.equal(masteryBudget('vanguard', VAN_CAP + 999 * 15_000), 10);
    assert.equal(masteryBudget('healer', VAN_CAP + 15_000), 0); // higher wall
    assert.equal(masteryBudget('healer', HEAL_CAP + 15_000), 1);
    assert.equal(masteryBudget('nope', 9e9), 0);
});

test('sanitizeMasterySpec clamps an over-budget forged spec', () => {
    // Forge everything; budget only 4.
    const forged = { 'heal-cooldown': 3, 'heal-tireless': 3, 'mass-triage': 1, 'heal-xp': 3 };
    const out = sanitizeMasterySpec('healer', forged, 4);
    const spent = Object.entries(out).reduce((s, [id, r]) => s + r * (id === 'mass-triage' ? 2 : 1), 0);
    assert.ok(spent <= 4, `spent ${spent} > 4`);
    assert.ok(!out['mass-triage'], 'ungated/over-budget capstone dropped');
});

test('sanitizeMasterySpec keeps a legal full path with capstone', () => {
    const out = sanitizeMasterySpec('petTamer', { 'exp-rewards': 3, 'exp-materials': 3, 'caravan-master': 1 }, 8);
    assert.equal(out['exp-rewards'], 3);
    assert.equal(out['exp-materials'], 3);
    assert.equal(out['caravan-master'], 1);
});

test('sanitizeMasterySpec drops a capstone whose path gate is not met', () => {
    // Only 3 points in the path (gate is 4) → capstone rejected even with budget.
    const out = sanitizeMasterySpec('vanguard', { 'seal-gap': 3, 'warmonger': 1 }, 10);
    assert.equal(out['seal-gap'], 3);
    assert.ok(!out['warmonger']);
});

test('sanitizeMasterySpec rejects unknown ids, bad profession, non-objects', () => {
    assert.deepEqual(sanitizeMasterySpec('healer', { 'not-a-node': 5, 'heal-xp': 2 }, 10), { 'heal-xp': 2 });
    assert.deepEqual(sanitizeMasterySpec('bogus', { 'heal-xp': 2 }, 10), {});
    assert.deepEqual(sanitizeMasterySpec('healer', null, 10), {});
});

test('sanitizeMasterySpec caps node ranks at their max', () => {
    const out = sanitizeMasterySpec('petTamer', { 'pet-damage': 99 }, 10);
    assert.equal(out['pet-damage'], 3);
});

test('masteryBonus sums perRank × ranks for the matching effect key', () => {
    assert.equal(masteryBonus('petTamer', { 'exp-rewards': 3 }, 'expRewardPct'), 15); // 5×3
    assert.equal(masteryBonus('petTamer', { 'exp-materials': 2 }, 'expMaterialPct'), 10);
    assert.equal(masteryBonus('vanguard', { 'seal-train-cost': 3 }, 'sealTrainCostPct'), 15);
    assert.equal(masteryBonus('vanguard', { 'seal-train-cost': 3 }, 'expRewardPct'), 0); // wrong key
    assert.equal(masteryBonus('healer', { 'heal-cooldown': 3 }, 'healCooldownPct'), 15);
    assert.equal(masteryBonus('bogus', { 'exp-rewards': 3 }, 'expRewardPct'), 0);
    // ranks beyond max don't over-count
    assert.equal(masteryBonus('petTamer', { 'exp-rewards': 99 }, 'expRewardPct'), 15);
});

test('masteryHasCapstone reflects the spec', () => {
    assert.equal(masteryHasCapstone('petTamer', { 'caravan-master': 1 }, 'caravan-master'), true);
    assert.equal(masteryHasCapstone('petTamer', {}, 'caravan-master'), false);
    assert.equal(masteryHasCapstone('petTamer', { 'exp-rewards': 3 }, 'exp-rewards'), false); // not a capstone
});
