"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const _stat_entitlement_js_1 = require("./_stat-entitlement.js");
(0, node_test_1.default)('paid stat respec atomically resets stats, refunds points, and debits shards', () => {
    const character = { stats: { strength: 25, speed: 17 }, unspentStats: 4, fateShards: 70 };
    const next = (0, _stat_entitlement_js_1.applyPaidStatRespec)(character);
    strict_1.default.ok(next);
    strict_1.default.equal(next.stats.strength, 10);
    strict_1.default.equal(next.stats.speed, 10);
    strict_1.default.equal(next.unspentStats, 26);
    strict_1.default.equal(next.fateShards, 70 - _stat_entitlement_js_1.STAT_RESPEC_FATE_COST);
});
(0, node_test_1.default)('paid stat respec rejects empty allocations and insufficient shards', () => {
    strict_1.default.equal((0, _stat_entitlement_js_1.applyPaidStatRespec)({ stats: {}, unspentStats: 0, fateShards: 500 }), null);
    strict_1.default.equal((0, _stat_entitlement_js_1.applyPaidStatRespec)({ stats: { strength: 11 }, unspentStats: 0, fateShards: 49 }), null);
});
