"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _progress_js_1 = require("./_progress.js");
function impossibleState() {
    return {
        date: '2026-05-25',
        profession: 'healer',
        missions: [
            {
                id: 'custom-warden:2026-05-25',
                templateId: 'custom-warden',
                kind: 'healer-heal-count',
                name: 'Kill Hollow Gate Warden',
                description: 'Defeat the Hollow Gate Warden.',
                target: 1,
                progress: 0,
                xpReward: 999,
                completedAt: null,
                claimed: false,
            },
            {
                id: 'healer-triage-run:2026-05-25',
                templateId: 'healer-triage-run',
                kind: 'healer-heal-unique',
                name: 'Triage Run',
                description: 'Heal 3 different patients.',
                target: 3,
                progress: 3,
                xpReward: 50,
                completedAt: 1,
                claimed: true,
            },
        ],
    };
}
(0, node_test_1.test)('stored impossible mission is replaced on mission load', () => {
    const repaired = (0, _progress_js_1.repairDailyMissionsForEligibility)({
        state: impossibleState(),
        playerName: 'aya',
        today: '2026-05-25',
        slotCount: 3,
        character: { level: 20, profession: 'healer', professionRank: 1, village: 'Leaf' },
    });
    strict_1.default.equal(repaired.replacements.length, 1);
    strict_1.default.equal(repaired.replacements[0].replacedTemplateId, 'custom-warden');
    strict_1.default.notEqual(repaired.state.missions[0].templateId, 'custom-warden');
});
(0, node_test_1.test)('completed and claimed missions remain untouched during repair', () => {
    const repaired = (0, _progress_js_1.repairDailyMissionsForEligibility)({
        state: impossibleState(),
        playerName: 'aya',
        today: '2026-05-25',
        slotCount: 3,
        character: { level: 20, profession: 'healer', professionRank: 1, village: 'Leaf' },
    });
    const completed = repaired.state.missions.find((mission) => mission.id === 'healer-triage-run:2026-05-25');
    strict_1.default.equal(completed?.completedAt, 1);
    strict_1.default.equal(completed?.claimed, true);
});
(0, node_test_1.test)('claimed impossible mission does not become claimable again', () => {
    const state = impossibleState();
    state.missions[0] = { ...state.missions[0], completedAt: 1, claimed: true };
    const repaired = (0, _progress_js_1.repairDailyMissionsForEligibility)({
        state,
        playerName: 'aya',
        today: '2026-05-25',
        slotCount: 3,
        character: { level: 20, profession: 'healer', professionRank: 1, village: 'Leaf' },
    });
    strict_1.default.equal(repaired.replacements.length, 0);
    strict_1.default.equal(repaired.state.missions[0].templateId, 'custom-warden');
    strict_1.default.equal(repaired.state.missions[0].claimed, true);
});
(0, node_test_1.test)('stored impossible mission replacement is deterministic', () => {
    const opts = {
        state: impossibleState(),
        playerName: 'aya',
        today: '2026-05-25',
        slotCount: 3,
        character: { level: 20, profession: 'healer', professionRank: 1, village: 'Leaf' },
    };
    const first = (0, _progress_js_1.repairDailyMissionsForEligibility)(opts);
    const second = (0, _progress_js_1.repairDailyMissionsForEligibility)({ ...opts, state: impossibleState() });
    strict_1.default.equal(first.replacements[0].replacementTemplateId, second.replacements[0].replacementTemplateId);
});
