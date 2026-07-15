import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hollowGateEnemyTemplate } from './_authoritative-pve.js';

function statTotal(template: ReturnType<typeof hollowGateEnemyTemplate>): number {
    return Object.values(template.stats).reduce((sum, value) => sum + Number(value || 0), 0);
}

test('one-floor event bosses reach the same sealed final-floor strength', () => {
    const oneFloor = hollowGateEnemyTemplate({ playerLevel: 30, floor: 1, maxFloor: 1, kind: 'boss', profileId: 'boss' });
    const standardFinal = hollowGateEnemyTemplate({ playerLevel: 30, floor: 5, maxFloor: 5, kind: 'boss', profileId: 'boss' });
    assert.equal(oneFloor.level, 45);
    assert.equal(oneFloor.level, standardFinal.level);
    assert.equal(oneFloor.hp, standardFinal.hp);
});

test('sealed augments and pet assistance preserve their shipped Hollow Gate combat effects', () => {
    const base = hollowGateEnemyTemplate({ playerLevel: 30, floor: 3, maxFloor: 5, kind: 'battle', profileId: 'mob' });
    const greedy = hollowGateEnemyTemplate({ playerLevel: 30, floor: 3, maxFloor: 5, kind: 'battle', profileId: 'mob', combatEffect: { kind: 'enemyPower', value: 0.3 } });
    const warded = hollowGateEnemyTemplate({ playerLevel: 30, floor: 3, maxFloor: 5, kind: 'battle', profileId: 'mob', combatEffect: { kind: 'roleShield', value: 0.15 } });
    const assisted = hollowGateEnemyTemplate({ playerLevel: 30, floor: 3, maxFloor: 5, kind: 'battle', profileId: 'mob', petLevel: 50 });
    assert.ok(greedy.hp > base.hp);
    assert.ok(statTotal(greedy) > statTotal(base));
    assert.ok(statTotal(warded) < statTotal(base));
    assert.ok(assisted.hp < base.hp);
});

test('rift non-boss encounters keep the shipped gentle scaling', () => {
    const base = hollowGateEnemyTemplate({ playerLevel: 40, floor: 2, maxFloor: 2, kind: 'ambush', profileId: 'mob' });
    const gentle = hollowGateEnemyTemplate({ playerLevel: 40, floor: 2, maxFloor: 2, kind: 'ambush', profileId: 'mob', gentleNonBoss: true });
    assert.ok(gentle.hp < base.hp);
    assert.ok(statTotal(gentle) < statTotal(base));
});
