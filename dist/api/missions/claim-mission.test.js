"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const claim_mission_js_1 = require("./claim-mission.js");
(0, node_test_1.test)('applyClaimedMissionState clears claimed field missions from accepted ids and progress', () => {
    const record = {
        acceptedMissionIds: ['fetch-d-supply-trail', 'other-mission'],
        missionProgress: {
            'fetch-d-supply-trail': 3,
            'fetch-d-supply-trail:raids': 1,
            'other-mission': 2,
        },
        character: { name: 'Akira' },
    };
    const updated = (0, claim_mission_js_1.applyClaimedMissionState)(record, 'field', 'fetch-d-supply-trail');
    strict_1.default.deepEqual(updated.acceptedMissionIds, ['other-mission']);
    strict_1.default.equal(updated.missionProgress['fetch-d-supply-trail'], 0);
    strict_1.default.equal(updated.missionProgress['fetch-d-supply-trail:raids'], 0);
    strict_1.default.equal(updated.missionProgress['other-mission'], 2);
    strict_1.default.deepEqual(record.acceptedMissionIds, ['fetch-d-supply-trail', 'other-mission']);
});
(0, node_test_1.test)('applyClaimedMissionState clears claimed hunts without touching unrelated progress', () => {
    const record = {
        acceptedMissionIds: ['hunt-wild-boar', 'fetch-d-supply-trail'],
        missionProgress: {
            'hunt-wild-boar': 3,
            'fetch-d-supply-trail': 1,
            'fetch-d-supply-trail:raids': 1,
        },
    };
    const updated = (0, claim_mission_js_1.applyClaimedMissionState)(record, 'hunt', 'hunt-wild-boar');
    strict_1.default.deepEqual(updated.acceptedMissionIds, ['fetch-d-supply-trail']);
    strict_1.default.equal(updated.missionProgress['hunt-wild-boar'], 0);
    strict_1.default.equal(updated.missionProgress['fetch-d-supply-trail'], 1);
    strict_1.default.equal(updated.missionProgress['fetch-d-supply-trail:raids'], 1);
});
(0, node_test_1.test)('applyClaimedMissionState leaves combat claims alone', () => {
    const record = {
        acceptedMissionIds: ['fetch-d-supply-trail'],
        missionProgress: { 'fetch-d-supply-trail': 3 },
    };
    strict_1.default.equal((0, claim_mission_js_1.applyClaimedMissionState)(record, 'combat', 'combat-d-rank-bandit'), record);
});
