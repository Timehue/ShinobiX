"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const sleeper_camps_js_1 = require("./sleeper-camps.js");
const NOW = 50_000;
function player(patch = {}) {
    return {
        name: 'rill', displayName: 'Rill', sector: 12, character: null,
        lastSeenAt: NOW, connectedAt: 1, pendingAttacker: null,
        ...patch,
    };
}
(0, node_test_1.test)('wild idle disconnect becomes an explicit sleeper camp', () => {
    strict_1.default.deepEqual((0, sleeper_camps_js_1.sleeperCampForPresence)(player(), NOW), {
        name: 'rill', displayName: 'Rill', sector: 12, createdAt: NOW,
    });
});
(0, node_test_1.test)('safe-zone, traveling, and fighting disconnects do not mint camps', () => {
    strict_1.default.equal((0, sleeper_camps_js_1.sleeperCampForPresence)(player({ sector: 0 }), NOW), null);
    strict_1.default.equal((0, sleeper_camps_js_1.sleeperCampForPresence)(player({ travelingUntil: NOW + 1 }), NOW), null);
    strict_1.default.equal((0, sleeper_camps_js_1.sleeperCampForPresence)(player({ inBattle: true }), NOW), null);
});
