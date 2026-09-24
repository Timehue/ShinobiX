import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { clanBossLeaseName } from './_scheduler.js';

test('the ranked settlement sweep runs on its own leased tick and stops with the scheduler', () => {
    // Behaviour is covered through fireRankedSettlementSweep in
    // api/pvp/_player-ranked-settlement-recovery.integration.test.ts; this pins
    // that the always-on server actually schedules it.
    const source = readFileSync('api/cron/_scheduler.ts', 'utf8');
    assert.match(source, /setInterval\(\(\) => void fireRankedSettlementSweep\(\), RANKED_SETTLEMENT_TICK_MS\)/);
    assert.match(source, /withScheduledJobLease\(\s*'player-ranked-settlement',/);
    assert.match(source, /clearInterval\(_rankedSettlementInterval\)/);
    assert.match(source, /clearTimeout\(_rankedSettlementBootTimeout\)/);
});

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
