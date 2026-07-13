"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _run_js_1 = require("./_run.js");
(0, node_test_1.describe)('Endless Tower server run', () => {
    (0, node_test_1.it)('charges canonical escalating entry fees and resumes tokened runs for free', () => {
        const free = (0, _run_js_1.startEndlessRun)({ ryo: 10_000 }, 'token', '2026-07-12', 1);
        strict_1.default.equal(free.ok, true);
        if (!free.ok)
            return;
        strict_1.default.equal(free.cost, 0);
        strict_1.default.equal(free.character.dailyEndlessRuns, 1);
        strict_1.default.equal((0, _run_js_1.startEndlessRun)(free.character, 'other', '2026-07-12').resumed, true);
        const paid = (0, _run_js_1.startEndlessRun)({ ...free.character, endlessTowerRun: null }, 'two', '2026-07-12');
        strict_1.default.equal(paid.ok, true);
        if (paid.ok)
            strict_1.default.equal(paid.cost, 3000);
    });
    (0, node_test_1.it)('mirrors wave and milestone rewards and rejects skipped/replayed waves', () => {
        strict_1.default.deepEqual((0, _run_js_1.endlessMilestoneReward)(20), { boneCharms: 5, fateShards: 5 });
        const run = { runToken: 't', wave: 5, bankedRyo: 0, bankedXp: 0, startedAt: 1, highestMilestoneClaimed: 0 };
        const char = { level: 50, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, boneCharms: 0, fateShards: 0 };
        strict_1.default.equal((0, _run_js_1.recordEndlessWin)(char, run, 6, { hp: 50, chakra: 50, stamina: 50 }), null);
        const won = (0, _run_js_1.recordEndlessWin)(char, run, 5, { hp: 50, chakra: 50, stamina: 50 });
        strict_1.default.deepEqual(won.reward, (0, _run_js_1.endlessWaveReward)(5, 50));
        strict_1.default.equal(won.character.endlessTowerRun.wave, 6);
        strict_1.default.equal(won.character.boneCharms, 5);
    });
    (0, node_test_1.it)('cashout applies the daily XP soft cap and clears the run', () => {
        const out = (0, _run_js_1.cashOutEndless)({ level: 10, xp: 0, ryo: 100, stats: {}, lastDailyReset: '2026-07-12', dailyTowerXp: 1000 }, { runToken: 't', wave: 2, bankedRyo: 500, bankedXp: 1000, startedAt: 1 }, '2026-07-12');
        strict_1.default.equal(out.creditedRyo, 500);
        strict_1.default.equal(out.character.ryo, 600);
        strict_1.default.equal(out.character.endlessTowerRun, null);
        strict_1.default.equal(out.creditedXp, 240);
    });
});
