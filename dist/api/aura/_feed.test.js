"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _feed_js_1 = require("./_feed.js");
(0, node_test_1.describe)('Aura Sphere feed authority', () => {
    const base = { inventory: ['aura-sphere'], auraSphereLevel: 1, auraDust: 100, redeemedAuraFeeds: [] };
    (0, node_test_1.it)('matches the canonical dust curve and atomically spends one level', () => {
        node_assert_1.strict.equal((0, _feed_js_1.auraSphereDustNeeded)(1), 14);
        node_assert_1.strict.equal((0, _feed_js_1.auraSphereDustNeeded)(150), 387);
        const out = (0, _feed_js_1.feedAuraSphere)(base, 'feed_action_001');
        node_assert_1.strict.equal(out.ok, true);
        if (!out.ok)
            return;
        node_assert_1.strict.equal(out.character.auraSphereLevel, 2);
        node_assert_1.strict.equal(out.character.auraDust, 86);
        node_assert_1.strict.deepEqual(out.character.redeemedAuraFeeds, ['feed_action_001']);
    });
    (0, node_test_1.it)('is replay-safe and enforces ownership, funds, and the level cap', () => {
        const once = (0, _feed_js_1.feedAuraSphere)(base, 'feed_action_002');
        node_assert_1.strict.equal(once.ok, true);
        if (!once.ok)
            return;
        const replay = (0, _feed_js_1.feedAuraSphere)(once.character, 'feed_action_002');
        node_assert_1.strict.equal(replay.ok, true);
        if (replay.ok)
            node_assert_1.strict.equal(replay.alreadyApplied, true);
        node_assert_1.strict.equal((0, _feed_js_1.feedAuraSphere)({ ...base, inventory: [] }, 'feed_action_003').ok, false);
        node_assert_1.strict.equal((0, _feed_js_1.feedAuraSphere)({ ...base, auraDust: 0 }, 'feed_action_004').ok, false);
        node_assert_1.strict.equal((0, _feed_js_1.feedAuraSphere)({ ...base, auraSphereLevel: 300 }, 'feed_action_005').ok, false);
    });
});
