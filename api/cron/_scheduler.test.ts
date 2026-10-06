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

test('sector wars settle on their own leased 5-minute tick, not only at 03:00', () => {
    // A 72h war ends at whatever hour it was declared; waiting for the daily
    // pass left a finished war unflipped for up to a day.
    const source = readFileSync('api/cron/_scheduler.ts', 'utf8');
    assert.match(source, /const SECTOR_WAR_SETTLE_TICK_MS = 5 \* 60_000;/);
    assert.match(source, /setInterval\(\(\) => void fireSectorWarSettlement\(\), SECTOR_WAR_SETTLE_TICK_MS\)/);
    assert.match(source, /withScheduledJobLease\(\s*'sector-war-settle',\s*\(\) => settleDueSectorWars\(\),/);
    assert.match(source, /if \(_sectorWarSettleRunning \|\| !villageWarMapEnabled\(\)\) return;/);
    assert.match(source, /clearInterval\(_sectorWarSettleInterval\)/);
});

test('stuck player trades are recovered on the leased settlement tick', () => {
    // Behaviour is covered through recoverPendingPlayerTrades in
    // api/player/_trade-settlement.test.ts; this pins that the always-on server
    // runs it, inside the same lease as the other settlement recoveries.
    const source = readFileSync('api/cron/_scheduler.ts', 'utf8');
    const lease = source.search(/withScheduledJobLease\(\s*'settlement-reconciliation',/);
    assert.ok(lease >= 0, 'the settlement-reconciliation lease exists');
    const tick = source.slice(lease, source.indexOf('return runSettlementReconciliation(', lease));
    assert.match(tick, /await recoverPendingPlayerTrades\(\)/);
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
