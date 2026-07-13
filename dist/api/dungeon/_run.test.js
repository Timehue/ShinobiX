"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _run_js_1 = require("./_run.js");
(0, node_test_1.describe)('dungeon run authority', () => {
    (0, node_test_1.it)('consumes one key and settles once after the sealed duration', () => {
        const start = (0, _run_js_1.mutateDungeonRun)({ inventory: ['dungeon-key'], itemStacks: [] }, 'start', '', 'token12345', 1000);
        node_assert_1.strict.equal(start.ok, true);
        if (!start.ok)
            return;
        node_assert_1.strict.deepEqual(start.character.inventory, []);
        node_assert_1.strict.equal((0, _run_js_1.mutateDungeonRun)(start.character, 'settle', 'token12345', 'x', 1000 + _run_js_1.DUNGEON_MIN_RUN_MS - 1).ok, false);
        const settled = (0, _run_js_1.mutateDungeonRun)(start.character, 'settle', 'token12345', 'x', 1000 + _run_js_1.DUNGEON_MIN_RUN_MS);
        node_assert_1.strict.equal(settled.ok, true);
        if (!settled.ok)
            return;
        node_assert_1.strict.equal(settled.character.fateShards, 5);
        node_assert_1.strict.deepEqual(settled.character.inventory, ['dungeon-legendary-relic']);
        const replay = (0, _run_js_1.mutateDungeonRun)(settled.character, 'settle', 'token12345', 'x', 999999);
        node_assert_1.strict.equal(replay.ok, true);
        if (replay.ok)
            node_assert_1.strict.equal(replay.alreadyApplied, true);
    });
    (0, node_test_1.it)('rejects keyless starts and supports abandon without payout', () => {
        node_assert_1.strict.equal((0, _run_js_1.mutateDungeonRun)({ inventory: [] }, 'start', '', 'token12345').ok, false);
        const start = (0, _run_js_1.mutateDungeonRun)({ itemStacks: [{ itemId: 'dungeon-key', count: 2 }] }, 'start', '', 'token12345', 1);
        node_assert_1.strict.equal(start.ok, true);
        if (!start.ok)
            return;
        const abandoned = (0, _run_js_1.mutateDungeonRun)(start.character, 'abandon', 'token12345', 'x', 2);
        node_assert_1.strict.equal(abandoned.ok, true);
        if (abandoned.ok)
            node_assert_1.strict.equal(abandoned.character.activeDungeonRun, null);
    });
});
