"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _merc_auto_js_1 = require("./_merc-auto.js");
(0, node_test_1.test)('pickSnipeTarget picks the LOWEST-HP defender at/under the snipe threshold', () => {
    const cands = [
        { name: 'full', village: 'D Village', hp: 100, maxHp: 100 }, // full HP — safe
        { name: 'half', village: 'D Village', hp: 50, maxHp: 100 }, // exactly at threshold — eligible
        { name: 'low', village: 'D Village', hp: 12, maxHp: 100 }, // lowest — the prey
        { name: 'enemy', village: 'Other Village', hp: 5, maxHp: 100 }, // wrong village — ignored
        { name: 'dead', village: 'D Village', hp: 0, maxHp: 100 }, // already down — ignored
    ];
    strict_1.default.equal((0, _merc_auto_js_1.pickSnipeTarget)(cands, 'D Village')?.name, 'low');
    strict_1.default.equal(_merc_auto_js_1.MERC_SNIPE_HP_FRACTION, 0.5);
});
(0, node_test_1.test)('pickSnipeTarget returns null when nobody is low enough / no defenders', () => {
    strict_1.default.equal((0, _merc_auto_js_1.pickSnipeTarget)([{ name: 'a', village: 'D Village', hp: 90, maxHp: 100 }], 'D Village'), null);
    strict_1.default.equal((0, _merc_auto_js_1.pickSnipeTarget)([], 'D Village'), null);
    // a defender at exactly the threshold IS eligible
    strict_1.default.ok((0, _merc_auto_js_1.pickSnipeTarget)([{ name: 'a', village: 'D Village', hp: 50, maxHp: 100 }], 'D Village'));
});
(0, node_test_1.test)('pickSnipeTarget breaks ties by name (deterministic)', () => {
    const cands = [
        { name: 'zed', village: 'D Village', hp: 10, maxHp: 100 },
        { name: 'amy', village: 'D Village', hp: 10, maxHp: 100 },
    ];
    strict_1.default.equal((0, _merc_auto_js_1.pickSnipeTarget)(cands, 'D Village')?.name, 'amy');
});
(0, node_test_1.test)('runMercAutoDeploy is a no-op unless ENABLE_VILLAGE_WAR=1', async () => {
    const prev = process.env.ENABLE_VILLAGE_WAR;
    delete process.env.ENABLE_VILLAGE_WAR;
    // listContests would throw if it ran — proves the gate short-circuits first.
    const r = await (0, _merc_auto_js_1.runMercAutoDeploy)({ listContests: async () => { throw new Error('gate should short-circuit'); } });
    strict_1.default.equal(r.enabled, false);
    strict_1.default.equal(r.deployed, 0);
    if (prev !== undefined)
        process.env.ENABLE_VILLAGE_WAR = prev;
    else
        delete process.env.ENABLE_VILLAGE_WAR;
});
(0, node_test_1.test)('runMercAutoDeploy skips contests with no eligible target (deploy never called)', async () => {
    const prev = process.env.ENABLE_VILLAGE_WAR;
    process.env.ENABLE_VILLAGE_WAR = '1';
    let deployCalls = 0;
    const r = await (0, _merc_auto_js_1.runMercAutoDeploy)({
        listContests: async () => [
            { id: 'x', sector: 5, attackerVillage: 'A Village', defenderVillage: 'D Village', winCondition: 'card', flipped: false }, // not combat
            { id: 'y', sector: 6, attackerVillage: 'A Village', defenderVillage: 'D Village', winCondition: 'combat', flipped: true }, // already flipped
        ],
        onlineNames: () => [],
        deploy: async () => { deployCalls++; return { winner: 'merc', captured: false, controlHp: 100, mercsRemaining: 1 }; },
    });
    strict_1.default.equal(r.enabled, true);
    strict_1.default.equal(deployCalls, 0, 'a card/flipped contest is never sniped');
    if (prev !== undefined)
        process.env.ENABLE_VILLAGE_WAR = prev;
    else
        delete process.env.ENABLE_VILLAGE_WAR;
});
