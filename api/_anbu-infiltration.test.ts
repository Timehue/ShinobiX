import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_ITEM_IDS } from './_anbu-infiltration.js';
import {
    rollRewardPools,
    rolloverLedger,
    applySkim,
    cachesForSkim,
    turnInCaches,
    turnInDestination,
    computeRaidReward,
    DAILY_LOSS_CAP_PCT,
    RAID_RYO_REWARD,
    type DailyLossLedger,
} from './_anbu-infiltration.js';

// Fixed wall-clock so date keys are stable: 2026-07-10T12:00Z.
const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);
const TODAY = '2026-07-10';
const YESTERDAY = '2026-07-09';

test('rollRewardPools: "both" is the rare leading band, singles split the rest', () => {
    assert.deepEqual(rollRewardPools(0), { supply: true, wr: true });
    assert.deepEqual(rollRewardPools(0.05), { supply: true, wr: true });
    // 0.10 is the both/supply boundary — not < 0.10, so supply-only.
    assert.deepEqual(rollRewardPools(0.10), { supply: true, wr: false });
    assert.deepEqual(rollRewardPools(0.50), { supply: true, wr: false });
    // 0.55 is the supply/wr boundary — not < 0.55, so wr-only.
    assert.deepEqual(rollRewardPools(0.55), { supply: false, wr: true });
    assert.deepEqual(rollRewardPools(0.90), { supply: false, wr: true });
    assert.deepEqual(rollRewardPools(0.9999999), { supply: false, wr: true });
    // out-of-range rolls clamp, never throw.
    assert.deepEqual(rollRewardPools(-1), { supply: true, wr: true });
    assert.deepEqual(rollRewardPools(2), { supply: false, wr: true });
});

test('rolloverLedger: resets on a new/blank day, preserves same-day', () => {
    // null → fresh ledger anchored to current balance.
    assert.deepEqual(rolloverLedger(null, 4000, NOW), { date: TODAY, openingBalance: 4000, lostToday: 0 });
    // stale (yesterday) → reset, opening re-anchors to current balance.
    const stale: DailyLossLedger = { date: YESTERDAY, openingBalance: 9999, lostToday: 4000 };
    assert.deepEqual(rolloverLedger(stale, 4000, NOW), { date: TODAY, openingBalance: 4000, lostToday: 0 });
    // same day → preserved (clamped to ints ≥ 0).
    const fresh: DailyLossLedger = { date: TODAY, openingBalance: 4000, lostToday: 1200 };
    assert.deepEqual(rolloverLedger(fresh, 3000, NOW), fresh);
});

test('applySkim: 1% of balance on a fresh ledger', () => {
    const { skim, ledger } = applySkim(null, 4000, NOW);
    assert.equal(skim, 40); // 1% of 4000
    assert.equal(ledger.openingBalance, 4000);
    assert.equal(ledger.lostToday, 40);
    assert.equal(ledger.date, TODAY);
});

test('applySkim: clamps to the 50%/day remaining allowance', () => {
    // opening 4000 → daily allowance = 2000 (50%). Already lost 1990 → only 10 left.
    const near: DailyLossLedger = { date: TODAY, openingBalance: 4000, lostToday: 1990 };
    const { skim, ledger } = applySkim(near, 4000, NOW);
    assert.equal(skim, 10); // min(40 raw, 4000 bal, 10 remaining)
    assert.equal(ledger.lostToday, 2000);
});

test('applySkim: fully tapped for the day → skim 0', () => {
    const tapped: DailyLossLedger = { date: TODAY, openingBalance: 4000, lostToday: 2000 };
    const { skim, ledger } = applySkim(tapped, 4000, NOW);
    assert.equal(skim, 0);
    assert.equal(ledger.lostToday, 2000);
    // 50% cap is exactly half the opening balance.
    assert.equal(ledger.lostToday, Math.floor((ledger.openingBalance * DAILY_LOSS_CAP_PCT) / 100));
});

test('applySkim: never negative; tiny pools floor to 0', () => {
    assert.equal(applySkim(null, 0, NOW).skim, 0);
    assert.equal(applySkim(null, 50, NOW).skim, 0);   // 1% of 50 floors to 0
    assert.equal(applySkim(null, 99, NOW).skim, 0);
    assert.equal(applySkim(null, 100, NOW).skim, 1);  // first whole unit
});

test('applySkim: a new day re-anchors the opening balance and resets the loss', () => {
    // Yesterday the sector was bled to its cap; today it opens fresh at its current balance.
    const yday: DailyLossLedger = { date: YESTERDAY, openingBalance: 8000, lostToday: 4000 };
    const { skim, ledger } = applySkim(yday, 4000, NOW);
    assert.equal(ledger.openingBalance, 4000); // re-anchored to today's balance
    assert.equal(skim, 40);                     // 1% of 4000, fresh allowance
    assert.equal(ledger.lostToday, 40);
});

test('cachesForSkim: 1 cache per unit, floored, never negative', () => {
    assert.equal(cachesForSkim(40), 40);
    assert.equal(cachesForSkim(0), 0);
    assert.equal(cachesForSkim(-5), 0);
    assert.equal(cachesForSkim(3.9), 3);
});

test('turnInDestination: type-locked (supply→clan, resource→village)', () => {
    assert.equal(turnInDestination('warSupply'), 'clan');
    assert.equal(turnInDestination('warResources'), 'village');
});

test('turnInCaches: clan 2:1 leaves the odd remainder; village 1:1', () => {
    assert.deepEqual(turnInCaches('warSupply', 5), { points: 2, consumed: 4, dest: 'clan' });
    assert.deepEqual(turnInCaches('warSupply', 4), { points: 2, consumed: 4, dest: 'clan' });
    assert.deepEqual(turnInCaches('warSupply', 1), { points: 0, consumed: 0, dest: 'clan' });
    assert.deepEqual(turnInCaches('warResources', 5), { points: 5, consumed: 5, dest: 'village' });
    assert.deepEqual(turnInCaches('warResources', 0), { points: 0, consumed: 0, dest: 'village' });
});

test('computeRaidReward: "both" roll skims both pools + mints both caches', () => {
    const r = computeRaidReward({
        roll: 0.05, // both
        now: NOW,
        supply: { balance: 4000, ledger: null },
        wr: { balance: 5000, ledger: null },
    });
    assert.deepEqual(r.rolled, { supply: true, wr: true });
    assert.equal(r.supplySkim, 40);
    assert.equal(r.wrSkim, 50);
    assert.equal(r.supplyCaches, 40);
    assert.equal(r.wrCaches, 50);
    assert.equal(r.supplyLedger.lostToday, 40);
    assert.equal(r.wrLedger.lostToday, 50);
    assert.equal(r.ryo, RAID_RYO_REWARD);
});

test('computeRaidReward: single-pool rolls leave the other pool untouched', () => {
    const supplyOnly = computeRaidReward({ roll: 0.30, now: NOW, supply: { balance: 4000, ledger: null }, wr: { balance: 5000, ledger: null } });
    assert.equal(supplyOnly.supplySkim, 40);
    assert.equal(supplyOnly.wrSkim, 0);
    assert.equal(supplyOnly.wrCaches, 0);
    assert.equal(supplyOnly.wrLedger.lostToday, 0); // untouched

    const wrOnly = computeRaidReward({ roll: 0.70, now: NOW, supply: { balance: 4000, ledger: null }, wr: { balance: 5000, ledger: null } });
    assert.equal(wrOnly.wrSkim, 50);
    assert.equal(wrOnly.supplySkim, 0);
    assert.equal(wrOnly.supplyCaches, 0);
});

test('computeRaidReward: a selected-but-tapped pool skims 0 (ryo still paid)', () => {
    const tapped: DailyLossLedger = { date: TODAY, openingBalance: 4000, lostToday: 2000 };
    const r = computeRaidReward({ roll: 0.30, now: NOW, supply: { balance: 4000, ledger: tapped }, wr: { balance: 5000, ledger: null } });
    assert.equal(r.supplySkim, 0);
    assert.equal(r.supplyCaches, 0);
    assert.equal(r.ryo, RAID_RYO_REWARD); // still granted
});

test('cache item ids: client mirror matches the server (KEEP IN SYNC guard)', () => {
    // The client lib duplicates the ids for inventory display + turn-in; any
    // drift would strand caches the sanitizer/turn-in no longer recognize.
    // STATIC text check (the server-routes.test.ts style) — importing the client
    // module here would cross the server/client module systems (nodenext vs
    // bundler) and break the cpanel tsc.
    // The suite always runs from the repo root (scripts/run-tests.mjs), and
    // import.meta is barred here (the cpanel build compiles api/** as CJS).
    const clientLib = join(process.cwd(), 'shinobij.client', 'src', 'lib', 'anbu-infiltration-api.ts');
    const src = readFileSync(clientLib, 'utf8');
    assert.match(src, new RegExp(`warSupply:\\s*'${CACHE_ITEM_IDS.warSupply}'`), 'client warSupply id drifted');
    assert.match(src, new RegExp(`warResources:\\s*'${CACHE_ITEM_IDS.warResources}'`), 'client warResources id drifted');
});

test('computeRaidReward: ryo override is honored and floored ≥ 0', () => {
    const r = computeRaidReward({ roll: 0.05, now: NOW, supply: { balance: 100, ledger: null }, wr: { balance: 100, ledger: null }, ryo: 250 });
    assert.equal(r.ryo, 250);
    const neg = computeRaidReward({ roll: 0.05, now: NOW, supply: { balance: 100, ledger: null }, wr: { balance: 100, ledger: null }, ryo: -5 });
    assert.equal(neg.ryo, 0);
});
