import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { clanBossLeaseName } from './_scheduler.js';

test('clan-boss lease changes at the Monday UTC week boundary', () => {
    const sundayBoot = Date.UTC(2026, 7, 9, 23, 50);
    const mondayTick = Date.UTC(2026, 7, 10, 3, 0);
    assert.notEqual(clanBossLeaseName(sundayBoot), clanBossLeaseName(mondayTick));
});

test('clan-boss replicas share the same lease within one logical week', () => {
    const monday = Date.UTC(2026, 7, 10, 3, 0);
    const friday = Date.UTC(2026, 7, 14, 18, 0);
    assert.equal(clanBossLeaseName(monday), clanBossLeaseName(friday));
});
