"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _grant_js_1 = require("./_grant.js");
(0, node_test_1.describe)('server training grant', () => {
    (0, node_test_1.it)('applies sealed XP and stat gain to the stored character', () => {
        const out = (0, _grant_js_1.applyTrainingGrant)({ level: 1, xp: 0, stats: { strength: 10 }, unspentStats: 20 }, 'strength', 12, 6);
        node_assert_1.strict.equal(out.character.level, 2);
        node_assert_1.strict.equal(out.character.xp, 0);
        node_assert_1.strict.equal(out.character.stats.strength, 22);
        node_assert_1.strict.equal(out.character.totalStatsTrained, 12);
    });
    (0, node_test_1.it)('caps the applied stat at the character rank ceiling', () => {
        const out = (0, _grant_js_1.applyTrainingGrant)({ level: 1, xp: 0, stats: { strength: 349 }, totalStatsTrained: 5 }, 'strength', 50, 0);
        node_assert_1.strict.equal(out.character.stats.strength, 350);
        node_assert_1.strict.equal(out.applied, 1);
        node_assert_1.strict.equal(out.character.totalStatsTrained, 6);
    });
});
