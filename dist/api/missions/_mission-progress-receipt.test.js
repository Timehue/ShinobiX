"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _mission_progress_receipt_js_1 = require("./_mission-progress-receipt.js");
function reasonOf(result) {
    node_assert_1.strict.equal(result.ok, false);
    return result.reason;
}
(0, node_test_1.describe)('_mission-progress-receipt', () => {
    (0, node_test_1.it)('cleans supported progress event kinds', () => {
        node_assert_1.strict.equal((0, _mission_progress_receipt_js_1.cleanMissionProgressEventKind)('field-explore'), 'field-explore');
        node_assert_1.strict.equal((0, _mission_progress_receipt_js_1.cleanMissionProgressEventKind)('hunt-kill'), 'hunt-kill');
        node_assert_1.strict.equal((0, _mission_progress_receipt_js_1.cleanMissionProgressEventKind)('bogus'), '');
    });
    (0, node_test_1.it)('increments field progress only to the sealed requirements', () => {
        let receipt = null;
        for (let i = 0; i < 5; i += 1) {
            receipt = (0, _mission_progress_receipt_js_1.applyMissionProgressEvent)(receipt, {
                playerName: 'Player',
                missionId: 'fetch-d',
                missionType: 'field',
                kind: 'field-explore',
                exploreTarget: 3,
                raidTarget: 1,
                now: 100 + i,
            });
        }
        receipt = (0, _mission_progress_receipt_js_1.applyMissionProgressEvent)(receipt, {
            playerName: 'Player',
            missionId: 'fetch-d',
            missionType: 'field',
            kind: 'field-raid',
            exploreTarget: 3,
            raidTarget: 1,
            now: 200,
        });
        node_assert_1.strict.equal(receipt.exploreCount, 3);
        node_assert_1.strict.equal(receipt.raidCount, 1);
        node_assert_1.strict.deepEqual((0, _mission_progress_receipt_js_1.validateMissionProgressReceipt)(receipt, {
            playerName: 'player',
            missionId: 'fetch-d',
            missionType: 'field',
            mission: { exploreCount: 3, raidCount: 1 },
        }), { ok: true });
    });
    (0, node_test_1.it)('requires a tracked hunt kill before hunt payout', () => {
        let receipt = null;
        receipt = (0, _mission_progress_receipt_js_1.applyMissionProgressEvent)(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            kind: 'hunt-track',
            exploreTarget: 3,
            raidTarget: 0,
        });
        node_assert_1.strict.equal(reasonOf((0, _mission_progress_receipt_js_1.validateMissionProgressReceipt)(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            mission: { exploreCount: 3 },
        })), 'incomplete-progress-receipt');
        receipt = (0, _mission_progress_receipt_js_1.applyMissionProgressEvent)(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            kind: 'hunt-track',
            exploreTarget: 3,
            raidTarget: 0,
        });
        receipt = (0, _mission_progress_receipt_js_1.applyMissionProgressEvent)(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            kind: 'hunt-kill',
            exploreTarget: 3,
            raidTarget: 0,
        });
        node_assert_1.strict.deepEqual((0, _mission_progress_receipt_js_1.validateMissionProgressReceipt)(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            mission: { exploreCount: 3 },
        }), { ok: true });
    });
});
