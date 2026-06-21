"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _name__js_1 = require("./[name].js");
const wrap = (character) => ({ character });
const sanitize = (incoming, existing) => (0, _name__js_1.sanitizeCharacterSave)(wrap(incoming), existing ? wrap(existing) : null).character;
(0, node_test_1.test)('attunement: each node clamped to its catalog maxRank; unknown ids dropped', () => {
    const out = sanitize({ hollowGateAttunement: { 'extra-dive': 3, 'seasoned-delver': 9, 'key-forge': 2, 'made-up-node': 5 } }, { hollowGateAttunement: {} });
    strict_1.default.equal(out.hollowGateAttunement['extra-dive'], 1, 'extra-dive maxRank 1');
    strict_1.default.equal(out.hollowGateAttunement['seasoned-delver'], 2, 'seasoned-delver maxRank 2');
    strict_1.default.equal(out.hollowGateAttunement['key-forge'], 1, 'key-forge maxRank 1');
    strict_1.default.equal(out.hollowGateAttunement['made-up-node'], undefined, 'unknown node dropped');
});
(0, node_test_1.test)('hollowGateRun: a spendable-currency entry above current is preserved (legit mid-run spend not over-penalised)', () => {
    // Hollow Shards are spendable mid-run, so the entry snapshot can legitimately
    // exceed the current balance. The sanitizer must NOT clamp entry down to current
    // (that would over-claw-back on a later reload-path death). floor/keys ARE bounded.
    const out = sanitize({ hollowShards: 70, hollowGateRun: { floor: 9999, keys: 9999, entryCurrencies: { hollowShards: 100 } } }, { hollowShards: 70 });
    strict_1.default.equal(out.hollowGateRun.entryCurrencies.hollowShards, 100, 'entry shards preserved above current');
    strict_1.default.ok(out.hollowGateRun.floor <= 50, 'floor bounded');
    strict_1.default.ok(out.hollowGateRun.keys <= 99, 'keys bounded');
});
(0, node_test_1.test)('hollowGateRun: absurd floor / keys clamped to sane ceilings', () => {
    const out = sanitize({ hollowGateRun: { floor: 9999, keys: 9999, entryCurrencies: {} } }, {});
    strict_1.default.ok(out.hollowGateRun.floor <= 50, 'floor clamped');
    strict_1.default.ok(out.hollowGateRun.keys <= 99, 'keys clamped');
});
(0, node_test_1.test)('hollow-gate-key: per-save GAIN capped above the existing stack', () => {
    const out = sanitize({ itemStacks: [{ itemId: 'hollow-gate-key', count: 9999 }] }, { itemStacks: [{ itemId: 'hollow-gate-key', count: 2 }] });
    const keys = out.itemStacks.find(s => s.itemId === 'hollow-gate-key');
    strict_1.default.equal(keys?.count, 12, '2 existing + 10 per-save gain cap');
});
(0, node_test_1.test)('legit HollowGate save passes through unchanged', () => {
    const out = sanitize({
        ryo: 5000,
        hollowGateAttunement: { 'greedy-hands': 2 },
        hollowGateRun: { floor: 3, keys: 1, entryCurrencies: { ryo: 4000 } },
        itemStacks: [{ itemId: 'hollow-gate-key', count: 3 }],
    }, { ryo: 4000, itemStacks: [{ itemId: 'hollow-gate-key', count: 1 }] });
    strict_1.default.equal(out.hollowGateAttunement['greedy-hands'], 2, 'legit rank (<= maxRank 3) untouched');
    strict_1.default.equal(out.hollowGateRun.entryCurrencies.ryo, 4000, 'legit entry snapshot untouched');
    const keys = out.itemStacks.find(s => s.itemId === 'hollow-gate-key');
    strict_1.default.equal(keys?.count, 3, 'legit key gain 1->3 within cap, untouched');
});
const TODAY = new Date().toISOString().slice(0, 10); // matches the sanitizer's SERVER_UTC_DATE
(0, node_test_1.test)('dailyHollowGateRuns: a forged reset to 0 within the same UTC day is floored to the server count', () => {
    const out = sanitize({ lastDailyReset: TODAY, dailyHollowGateRuns: 0 }, // forged: zero the counter to farm more runs
    { lastDailyReset: TODAY, dailyHollowGateRuns: 2 });
    strict_1.default.equal(out.dailyHollowGateRuns, 2, 'cannot drop below the server-recorded count for today');
});
(0, node_test_1.test)('dailyHollowGateRuns: legit same-day increment kept; genuine new-day reset untouched', () => {
    const inc = sanitize({ lastDailyReset: TODAY, dailyHollowGateRuns: 3 }, { lastDailyReset: TODAY, dailyHollowGateRuns: 2 });
    strict_1.default.equal(inc.dailyHollowGateRuns, 3, 'legit increment 2->3 kept');
    // existing save was last written on a prior day -> floor is 0, reset is allowed
    const reset = sanitize({ lastDailyReset: TODAY, dailyHollowGateRuns: 0 }, { lastDailyReset: '2000-01-01', dailyHollowGateRuns: 2 });
    strict_1.default.equal(reset.dailyHollowGateRuns, 0, 'new-day reset is not clamped');
});
// ── Core anti-tamper clamps ─────────────────────────────────────────────────
// The broadest reward surface in the repo — EVERY player save POST flows through
// sanitizeCharacterSave. These lock the level/ryo/currency caps so a future
// refactor that drops a floor or loosens a cap fails the build, not in prod.
(0, node_test_1.test)('level: cannot regress below the existing level (anti-rollback)', () => {
    strict_1.default.equal(sanitize({ level: 40 }, { level: 50 }).level, 50, 'a save reporting a lower level is floored to existing');
});
(0, node_test_1.test)('level: per-save gain capped at +5 and hard-capped at 100', () => {
    strict_1.default.equal(sanitize({ level: 999 }, { level: 50 }).level, 55, 'gain capped to +MAX_LEVEL_GAIN (5)');
    strict_1.default.equal(sanitize({ level: 999 }, { level: 98 }).level, 100, 'hard-capped at LEVEL_CAP (100)');
});
(0, node_test_1.test)('ryo: per-save gain capped at +1,000,000 over existing', () => {
    strict_1.default.equal(sanitize({ ryo: 9_999_999 }, { ryo: 1000 }).ryo, 1_001_000, 'capped to exRyo + MAX_RYO_GAIN');
});
(0, node_test_1.test)('soft currencies: per-save gain capped (fateShards +50, honorSeals +200)', () => {
    strict_1.default.equal(sanitize({ fateShards: 9999 }, { fateShards: 10 }).fateShards, 60, 'fateShards capped to +50');
    strict_1.default.equal(sanitize({ honorSeals: 9999 }, { honorSeals: 5 }).honorSeals, 205, 'honorSeals capped to +200');
});
// ── audit #1: mission/hunt daily-cap flooring + reset monotonicity + academy latch ──
// claim-mission writes ryo + premium currency under the save lock (bypassing the
// per-save ryo/currency caps), so the daily counter is the ONLY payout bound. These
// lock it server-side the way dailyHollowGateRuns already is.
(0, node_test_1.test)('dailyMissionsCompleted: a forged reset to 0 within the same UTC day is floored to the server count', () => {
    const out = sanitize({ lastDailyReset: TODAY, dailyMissionsCompleted: 0 }, // forged: zero the counter to re-claim
    { lastDailyReset: TODAY, dailyMissionsCompleted: 12 });
    strict_1.default.equal(out.dailyMissionsCompleted, 12, 'cannot drop below the server mission count for today');
});
(0, node_test_1.test)('dailyMissionsCompleted: legit same-day increment kept; genuine new-day reset untouched', () => {
    strict_1.default.equal(sanitize({ lastDailyReset: TODAY, dailyMissionsCompleted: 5 }, { lastDailyReset: TODAY, dailyMissionsCompleted: 4 }).dailyMissionsCompleted, 5, 'legit increment 4->5 kept');
    strict_1.default.equal(sanitize({ lastDailyReset: TODAY, dailyMissionsCompleted: 0 }, { lastDailyReset: '2000-01-01', dailyMissionsCompleted: 19 }).dailyMissionsCompleted, 0, 'new-day reset (stored stamp is a prior day) is not clamped');
});
(0, node_test_1.test)('dailyHuntsCompleted: floored to the server count within the same UTC day (own lastHuntReset key)', () => {
    strict_1.default.equal(sanitize({ lastHuntReset: TODAY, dailyHuntsCompleted: 0 }, { lastHuntReset: TODAY, dailyHuntsCompleted: 8 }).dailyHuntsCompleted, 8, 'cannot drop below the server hunt count for today');
});
(0, node_test_1.test)('lastDailyReset/lastHuntReset: a backdated stamp is reverted (monotonic-forward), defeating the counter-reset vector', () => {
    const out = sanitize({ lastDailyReset: '2000-01-01', dailyMissionsCompleted: 0, lastHuntReset: '2000-01-01', dailyHuntsCompleted: 0 }, { lastDailyReset: TODAY, dailyMissionsCompleted: 15, lastHuntReset: TODAY, dailyHuntsCompleted: 9 });
    strict_1.default.equal(out.lastDailyReset, TODAY, 'backdated lastDailyReset reverted to stored');
    strict_1.default.equal(out.lastHuntReset, TODAY, 'backdated lastHuntReset reverted to stored');
    strict_1.default.equal(out.dailyMissionsCompleted, 15, 'mission counter still floored after backdate attempt');
    strict_1.default.equal(out.dailyHuntsCompleted, 9, 'hunt counter still floored after backdate attempt');
});
(0, node_test_1.test)('academyTrialClaimed: latched true — a forged save cannot un-claim the one-time onboarding reward', () => {
    strict_1.default.equal(sanitize({ academyTrialClaimed: false }, { academyTrialClaimed: true }).academyTrialClaimed, true, 'cannot revert to false');
    strict_1.default.equal(sanitize({ academyTrialClaimed: false }, { academyTrialClaimed: false }).academyTrialClaimed, false, 'not-yet-claimed stays false');
});
(0, node_test_1.test)('hollowGateWardenKills: per-save gain clamped to +3 (audit #10 — weekly-board counter)', () => {
    strict_1.default.equal(sanitize({ hollowGateWardenKills: 9999 }, { hollowGateWardenKills: 4 }).hollowGateWardenKills, 7, 'capped to existing + 3');
});
// ── audit #3 / #14: bloodline jutsu effectPower clamped to the legit ceiling (50), AP floored at 40 ──
// Legit bloodline effectPower is always {0, 40, 50} (lib/bloodline-templates.ts:87)
// and AP is 40/60/80 — so the clamp neutralizes a forged ~4x nuke while leaving every
// honest bloodline untouched.
(0, node_test_1.test)('savedBloodlines: a forged jutsu effectPower 200 / ap 1 is clamped to 50 / 40', () => {
    const out = sanitize({ savedBloodlines: [{ rank: 'A Rank', jutsus: [{ id: 'bl-1', effectPower: 200, ap: 1 }] }] }, {});
    const j = out.savedBloodlines[0].jutsus[0];
    strict_1.default.equal(j.effectPower, 50, 'effectPower clamped to the legit nuke ceiling 50');
    strict_1.default.equal(j.ap, 40, 'ap floored to 40');
});
(0, node_test_1.test)('savedBloodlines: legit jutsu (nuke 50@60, standard 40@60, utility 0@40, 40@80) pass through unchanged', () => {
    const out = sanitize({ savedBloodlines: [{ rank: 'S Rank', jutsus: [
                    { id: 'n', effectPower: 50, ap: 60 },
                    { id: 's', effectPower: 40, ap: 60 },
                    { id: 'u', effectPower: 0, ap: 40 },
                    { id: 'big', effectPower: 40, ap: 80 },
                ] }] }, {});
    const js = out.savedBloodlines[0].jutsus;
    strict_1.default.deepEqual([js[0].effectPower, js[0].ap], [50, 60], 'nuke untouched');
    strict_1.default.deepEqual([js[1].effectPower, js[1].ap], [40, 60], 'standard untouched');
    strict_1.default.deepEqual([js[2].effectPower, js[2].ap], [0, 40], 'utility untouched');
    strict_1.default.deepEqual([js[3].effectPower, js[3].ap], [40, 80], '80-AP jutsu untouched (not nerfed)');
});
