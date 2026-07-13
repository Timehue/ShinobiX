"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _rank_up_js_1 = require("./_rank-up.js");
(0, node_test_1.describe)('Hunter Rank authority', () => {
    (0, node_test_1.it)('atomically consumes inventory and stack materials', () => {
        const out = (0, _rank_up_js_1.rankUpHunter)({ hunterRank: 0, inventory: ['hunt-beast-meat', 'x'], itemStacks: [{ itemId: 'hunt-beast-meat', count: 4 }] }, 'hunter_action_01');
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            return;
        node_assert_1.strict.equal(out.character.hunterRank, 1);
        node_assert_1.strict.deepEqual(out.character.inventory, ['x']);
        node_assert_1.strict.deepEqual(out.character.itemStacks, []);
    });
    (0, node_test_1.it)('rejects missing materials and is replay-safe', () => {
        node_assert_1.strict.equal((0, _rank_up_js_1.rankUpHunter)({ hunterRank: 0, inventory: [] }, 'hunter_action_02').ok, false);
        const once = (0, _rank_up_js_1.rankUpHunter)({ hunterRank: 0, inventory: Array(5).fill('hunt-beast-meat') }, 'hunter_action_03');
        node_assert_1.strict.equal(once.ok, true);
        if (!once.ok)
            return;
        const replay = (0, _rank_up_js_1.rankUpHunter)(once.character, 'hunter_action_03');
        node_assert_1.strict.equal(replay.ok, true);
        if (replay.ok)
            node_assert_1.strict.equal(replay.alreadyApplied, true);
    });
});
