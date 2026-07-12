"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const _war_crate_js_1 = require("./_war-crate.js");
function base(overrides = {}) {
    return {
        name: 'rill',
        profession: 'vanguard',
        ryo: 100,
        honorSeals: 2,
        boneCharms: 3,
        inventory: [],
        itemStacks: [{ itemId: _war_crate_js_1.LEGENDARY_WAR_CRATE_ID, count: 2 }],
        ...overrides,
    };
}
function count(character, itemId) {
    return character.itemStacks
        .filter((entry) => entry.itemId === itemId)
        .reduce((sum, entry) => sum + entry.count, 0);
}
(0, node_test_1.default)('opening a stacked crate consumes one and grants the sealed Vanguard payout', () => {
    const out = (0, _war_crate_js_1.applyWarCrateOpen)(base(), 0.1);
    strict_1.default.equal(out.ok, true);
    if (!out.ok)
        return;
    strict_1.default.equal(count(out.character, _war_crate_js_1.LEGENDARY_WAR_CRATE_ID), 1);
    strict_1.default.equal(count(out.character, _war_crate_js_1.WARFORGED_RELIC_ID), 1);
    strict_1.default.equal(count(out.character, _war_crate_js_1.DUNGEON_KEY_ID), 1);
    strict_1.default.deepEqual(out.rewards, { ryo: 500, honorSeals: 10, boneCharms: 1, relic: true, dungeonKey: true });
    strict_1.default.equal(out.character.ryo, 600);
    strict_1.default.equal(out.character.honorSeals, 12);
    strict_1.default.equal(out.character.boneCharms, 4);
});
(0, node_test_1.default)('legacy inventory crates are consumed and non-Vanguards receive no Honor Seals', () => {
    const out = (0, _war_crate_js_1.applyWarCrateOpen)(base({
        profession: 'medic',
        inventory: [_war_crate_js_1.LEGENDARY_WAR_CRATE_ID, 'other-item'],
        itemStacks: [],
    }), 0.9);
    strict_1.default.equal(out.ok, true);
    if (!out.ok)
        return;
    strict_1.default.deepEqual(out.character.inventory, ['other-item']);
    strict_1.default.equal(out.rewards.honorSeals, 0);
    strict_1.default.equal(out.rewards.boneCharms, 1);
    strict_1.default.equal(out.rewards.dungeonKey, false);
});
(0, node_test_1.default)('missing crates, malformed storage, and overflowing rewards fail without mutation', () => {
    const missing = base({ itemStacks: [] });
    strict_1.default.equal((0, _war_crate_js_1.applyWarCrateOpen)(missing, 0).ok, false);
    strict_1.default.deepEqual(missing.itemStacks, []);
    strict_1.default.equal((0, _war_crate_js_1.applyWarCrateOpen)(base({ itemStacks: [{ itemId: _war_crate_js_1.LEGENDARY_WAR_CRATE_ID, count: -1 }] }), 0).ok, false);
    strict_1.default.equal((0, _war_crate_js_1.applyWarCrateOpen)(base({ ryo: Number.MAX_SAFE_INTEGER }), 0).ok, false);
    strict_1.default.equal((0, _war_crate_js_1.applyWarCrateOpen)(base({
        itemStacks: [
            { itemId: _war_crate_js_1.LEGENDARY_WAR_CRATE_ID, count: 1 },
            { itemId: _war_crate_js_1.WARFORGED_RELIC_ID, count: 9999 },
        ],
    }), 0.9).ok, false);
});
(0, node_test_1.default)('route and client use authenticated locked settlement with no client random payout', () => {
    const route = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'inventory', 'open-war-crate.ts'), 'utf8');
    const client = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'shinobij.client', 'src', 'lib', 'inventory-settlement.ts'), 'utf8');
    const screen = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'shinobij.client', 'src', 'screens', 'Inventory.tsx'), 'utf8');
    strict_1.default.match(route, /await authedPlayer\(req, playerName\)/);
    strict_1.default.match(route, /await mutatePlayerSave\(playerName/);
    strict_1.default.match(route, /strict: true/);
    strict_1.default.match(client, /fetch\('\/api\/inventory\/open-war-crate'/);
    strict_1.default.doesNotMatch(screen, /Math\.random\(\)/);
    strict_1.default.match(screen, /updateCharacter\(result\.character\)/);
});
