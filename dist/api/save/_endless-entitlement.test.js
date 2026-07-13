"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _name__js_1 = require("./[name].js");
const sanitize = (incoming, existing) => (0, _name__js_1.sanitizeCharacterSave)({ character: incoming }, { character: existing }).character;
(0, node_test_1.test)('generic saves cannot forge or erase Endless Tower authority state', () => {
    const run = { runToken: 'server-token-123456', wave: 7, bankedRyo: 800, bankedXp: 300, startedAt: 1 };
    const receipt = { key: 'proof-token-123456', action: 'win', reward: { ryo: 100, xp: 50 } };
    const out = sanitize({
        endlessTowerRun: { ...run, wave: 200, bankedRyo: 100_000, bankedXp: 50_000 },
        endlessTowerBestWave: 200,
        totalEndlessTowerWins: 999,
        dailyTowerXp: 0,
        dailyEndlessRuns: 0,
        dailyEndlessDate: '2099-01-01',
        redeemedEndlessActions: [],
    }, {
        endlessTowerRun: run,
        endlessTowerBestWave: 6,
        totalEndlessTowerWins: 6,
        dailyTowerXp: 300,
        dailyEndlessRuns: 2,
        dailyEndlessDate: '2026-07-12',
        redeemedEndlessActions: [receipt],
    });
    strict_1.default.deepEqual(out.endlessTowerRun, run);
    strict_1.default.equal(out.endlessTowerBestWave, 6);
    strict_1.default.equal(out.totalEndlessTowerWins, 6);
    strict_1.default.equal(out.dailyTowerXp, 300);
    strict_1.default.equal(out.dailyEndlessRuns, 2);
    strict_1.default.equal(out.dailyEndlessDate, '2026-07-12');
    strict_1.default.deepEqual(out.redeemedEndlessActions, [receipt]);
});
