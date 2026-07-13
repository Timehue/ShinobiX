"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _pass_js_1 = require("./_pass.js");
(0, node_test_1.describe)('rank exam authority', () => {
    const ready = { level: 20, elements: ['Fire'], totalStatsTrained: 400, totalMissionsCompleted: 20, totalAiKills: 20, totalTilesExplored: 50, jutsuMastery: [{ level: 3 }], examsPassed: [] };
    (0, node_test_1.it)('requires every canonical Genin condition', () => {
        node_assert_1.strict.equal((0, _pass_js_1.passRankExam)(ready, 'genin').ok, true);
        node_assert_1.strict.equal((0, _pass_js_1.passRankExam)({ ...ready, totalStatsTrained: 399 }, 'genin').ok, false);
    });
    (0, node_test_1.it)('enforces exam order and proof-backed leadership', () => {
        const special = { level: 80, totalPvpKills: 100, examsPassed: ['genin', 'chunin', 'jonin'] };
        node_assert_1.strict.equal((0, _pass_js_1.passRankExam)(special, 'specialJonin').ok, false);
        node_assert_1.strict.equal((0, _pass_js_1.passRankExam)(special, 'specialJonin', { isElder: true }).ok, true);
        node_assert_1.strict.equal((0, _pass_js_1.passRankExam)({ level: 50, totalPvpKills: 10, totalVillageRaids: 20, defeatedAiIds: ['builtin-ai-rogue-ninja'], examsPassed: [] }, 'jonin').ok, false);
    });
});
