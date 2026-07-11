"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const _anbu_infiltration_js_1 = require("./_anbu-infiltration.js");
const _anbu_infiltration_js_2 = require("./_anbu-infiltration.js");
// Fixed wall-clock so date keys are stable: 2026-07-10T12:00Z.
const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);
const TODAY = '2026-07-10';
const YESTERDAY = '2026-07-09';
(0, node_test_1.test)('rollRewardPools: "both" is the rare leading band, singles split the rest', () => {
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rollRewardPools)(0), { supply: true, wr: true });
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rollRewardPools)(0.05), { supply: true, wr: true });
    // 0.10 is the both/supply boundary — not < 0.10, so supply-only.
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rollRewardPools)(0.10), { supply: true, wr: false });
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rollRewardPools)(0.50), { supply: true, wr: false });
    // 0.55 is the supply/wr boundary — not < 0.55, so wr-only.
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rollRewardPools)(0.55), { supply: false, wr: true });
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rollRewardPools)(0.90), { supply: false, wr: true });
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rollRewardPools)(0.9999999), { supply: false, wr: true });
    // out-of-range rolls clamp, never throw.
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rollRewardPools)(-1), { supply: true, wr: true });
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rollRewardPools)(2), { supply: false, wr: true });
});
(0, node_test_1.test)('rolloverLedger: resets on a new/blank day, preserves same-day', () => {
    // null → fresh ledger anchored to current balance.
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rolloverLedger)(null, 4000, NOW), { date: TODAY, openingBalance: 4000, lostToday: 0 });
    // stale (yesterday) → reset, opening re-anchors to current balance.
    const stale = { date: YESTERDAY, openingBalance: 9999, lostToday: 4000 };
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rolloverLedger)(stale, 4000, NOW), { date: TODAY, openingBalance: 4000, lostToday: 0 });
    // same day → preserved (clamped to ints ≥ 0).
    const fresh = { date: TODAY, openingBalance: 4000, lostToday: 1200 };
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.rolloverLedger)(fresh, 3000, NOW), fresh);
});
(0, node_test_1.test)('applySkim: 1% of balance on a fresh ledger', () => {
    const { skim, ledger } = (0, _anbu_infiltration_js_2.applySkim)(null, 4000, NOW);
    strict_1.default.equal(skim, 40); // 1% of 4000
    strict_1.default.equal(ledger.openingBalance, 4000);
    strict_1.default.equal(ledger.lostToday, 40);
    strict_1.default.equal(ledger.date, TODAY);
});
(0, node_test_1.test)('applySkim: clamps to the 50%/day remaining allowance', () => {
    // opening 4000 → daily allowance = 2000 (50%). Already lost 1990 → only 10 left.
    const near = { date: TODAY, openingBalance: 4000, lostToday: 1990 };
    const { skim, ledger } = (0, _anbu_infiltration_js_2.applySkim)(near, 4000, NOW);
    strict_1.default.equal(skim, 10); // min(40 raw, 4000 bal, 10 remaining)
    strict_1.default.equal(ledger.lostToday, 2000);
});
(0, node_test_1.test)('applySkim: fully tapped for the day → skim 0', () => {
    const tapped = { date: TODAY, openingBalance: 4000, lostToday: 2000 };
    const { skim, ledger } = (0, _anbu_infiltration_js_2.applySkim)(tapped, 4000, NOW);
    strict_1.default.equal(skim, 0);
    strict_1.default.equal(ledger.lostToday, 2000);
    // 50% cap is exactly half the opening balance.
    strict_1.default.equal(ledger.lostToday, Math.floor((ledger.openingBalance * _anbu_infiltration_js_2.DAILY_LOSS_CAP_PCT) / 100));
});
(0, node_test_1.test)('applySkim: never negative; tiny pools floor to 0', () => {
    strict_1.default.equal((0, _anbu_infiltration_js_2.applySkim)(null, 0, NOW).skim, 0);
    strict_1.default.equal((0, _anbu_infiltration_js_2.applySkim)(null, 50, NOW).skim, 0); // 1% of 50 floors to 0
    strict_1.default.equal((0, _anbu_infiltration_js_2.applySkim)(null, 99, NOW).skim, 0);
    strict_1.default.equal((0, _anbu_infiltration_js_2.applySkim)(null, 100, NOW).skim, 1); // first whole unit
});
(0, node_test_1.test)('applySkim: a new day re-anchors the opening balance and resets the loss', () => {
    // Yesterday the sector was bled to its cap; today it opens fresh at its current balance.
    const yday = { date: YESTERDAY, openingBalance: 8000, lostToday: 4000 };
    const { skim, ledger } = (0, _anbu_infiltration_js_2.applySkim)(yday, 4000, NOW);
    strict_1.default.equal(ledger.openingBalance, 4000); // re-anchored to today's balance
    strict_1.default.equal(skim, 40); // 1% of 4000, fresh allowance
    strict_1.default.equal(ledger.lostToday, 40);
});
(0, node_test_1.test)('cachesForSkim: 1 cache per unit, floored, never negative', () => {
    strict_1.default.equal((0, _anbu_infiltration_js_2.cachesForSkim)(40), 40);
    strict_1.default.equal((0, _anbu_infiltration_js_2.cachesForSkim)(0), 0);
    strict_1.default.equal((0, _anbu_infiltration_js_2.cachesForSkim)(-5), 0);
    strict_1.default.equal((0, _anbu_infiltration_js_2.cachesForSkim)(3.9), 3);
});
(0, node_test_1.test)('turnInDestination: type-locked (supply→clan, resource→village)', () => {
    strict_1.default.equal((0, _anbu_infiltration_js_2.turnInDestination)('warSupply'), 'clan');
    strict_1.default.equal((0, _anbu_infiltration_js_2.turnInDestination)('warResources'), 'village');
});
(0, node_test_1.test)('turnInCaches: clan 2:1 leaves the odd remainder; village 1:1', () => {
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.turnInCaches)('warSupply', 5), { points: 2, consumed: 4, dest: 'clan' });
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.turnInCaches)('warSupply', 4), { points: 2, consumed: 4, dest: 'clan' });
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.turnInCaches)('warSupply', 1), { points: 0, consumed: 0, dest: 'clan' });
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.turnInCaches)('warResources', 5), { points: 5, consumed: 5, dest: 'village' });
    strict_1.default.deepEqual((0, _anbu_infiltration_js_2.turnInCaches)('warResources', 0), { points: 0, consumed: 0, dest: 'village' });
});
(0, node_test_1.test)('computeRaidReward: "both" roll skims both pools + mints both caches', () => {
    const r = (0, _anbu_infiltration_js_2.computeRaidReward)({
        roll: 0.05, // both
        now: NOW,
        supply: { balance: 4000, ledger: null },
        wr: { balance: 5000, ledger: null },
    });
    strict_1.default.deepEqual(r.rolled, { supply: true, wr: true });
    strict_1.default.equal(r.supplySkim, 40);
    strict_1.default.equal(r.wrSkim, 50);
    strict_1.default.equal(r.supplyCaches, 40);
    strict_1.default.equal(r.wrCaches, 50);
    strict_1.default.equal(r.supplyLedger.lostToday, 40);
    strict_1.default.equal(r.wrLedger.lostToday, 50);
    strict_1.default.equal(r.ryo, _anbu_infiltration_js_2.RAID_RYO_REWARD);
});
(0, node_test_1.test)('computeRaidReward: single-pool rolls leave the other pool untouched', () => {
    const supplyOnly = (0, _anbu_infiltration_js_2.computeRaidReward)({ roll: 0.30, now: NOW, supply: { balance: 4000, ledger: null }, wr: { balance: 5000, ledger: null } });
    strict_1.default.equal(supplyOnly.supplySkim, 40);
    strict_1.default.equal(supplyOnly.wrSkim, 0);
    strict_1.default.equal(supplyOnly.wrCaches, 0);
    strict_1.default.equal(supplyOnly.wrLedger.lostToday, 0); // untouched
    const wrOnly = (0, _anbu_infiltration_js_2.computeRaidReward)({ roll: 0.70, now: NOW, supply: { balance: 4000, ledger: null }, wr: { balance: 5000, ledger: null } });
    strict_1.default.equal(wrOnly.wrSkim, 50);
    strict_1.default.equal(wrOnly.supplySkim, 0);
    strict_1.default.equal(wrOnly.supplyCaches, 0);
});
(0, node_test_1.test)('computeRaidReward: a selected-but-tapped pool skims 0 (ryo still paid)', () => {
    const tapped = { date: TODAY, openingBalance: 4000, lostToday: 2000 };
    const r = (0, _anbu_infiltration_js_2.computeRaidReward)({ roll: 0.30, now: NOW, supply: { balance: 4000, ledger: tapped }, wr: { balance: 5000, ledger: null } });
    strict_1.default.equal(r.supplySkim, 0);
    strict_1.default.equal(r.supplyCaches, 0);
    strict_1.default.equal(r.ryo, _anbu_infiltration_js_2.RAID_RYO_REWARD); // still granted
});
(0, node_test_1.test)('cache item ids: client mirror matches the server (KEEP IN SYNC guard)', () => {
    // The client lib duplicates the ids for inventory display + turn-in; any
    // drift would strand caches the sanitizer/turn-in no longer recognize.
    // STATIC text check (the server-routes.test.ts style) — importing the client
    // module here would cross the server/client module systems (nodenext vs
    // bundler) and break the cpanel tsc.
    // The suite always runs from the repo root (scripts/run-tests.mjs), and
    // import.meta is barred here (the cpanel build compiles api/** as CJS).
    const clientLib = (0, node_path_1.join)(process.cwd(), 'shinobij.client', 'src', 'lib', 'anbu-infiltration-api.ts');
    const src = (0, node_fs_1.readFileSync)(clientLib, 'utf8');
    strict_1.default.match(src, new RegExp(`warSupply:\\s*'${_anbu_infiltration_js_1.CACHE_ITEM_IDS.warSupply}'`), 'client warSupply id drifted');
    strict_1.default.match(src, new RegExp(`warResources:\\s*'${_anbu_infiltration_js_1.CACHE_ITEM_IDS.warResources}'`), 'client warResources id drifted');
});
(0, node_test_1.test)('computeRaidReward: ryo override is honored and floored ≥ 0', () => {
    const r = (0, _anbu_infiltration_js_2.computeRaidReward)({ roll: 0.05, now: NOW, supply: { balance: 100, ledger: null }, wr: { balance: 100, ledger: null }, ryo: 250 });
    strict_1.default.equal(r.ryo, 250);
    const neg = (0, _anbu_infiltration_js_2.computeRaidReward)({ roll: 0.05, now: NOW, supply: { balance: 100, ledger: null }, wr: { balance: 100, ledger: null }, ryo: -5 });
    strict_1.default.equal(neg.ryo, 0);
});
