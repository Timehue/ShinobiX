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
                evidenceId: `evidence-explore-${i}`,
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
            evidenceId: 'evidence-field-raid',
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
            evidenceId: 'evidence-hunt-track-1',
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
            evidenceId: 'evidence-hunt-track-2',
        });
        receipt = (0, _mission_progress_receipt_js_1.applyMissionProgressEvent)(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            kind: 'hunt-kill',
            exploreTarget: 3,
            raidTarget: 0,
            evidenceId: 'evidence-hunt-kill',
        });
        node_assert_1.strict.deepEqual((0, _mission_progress_receipt_js_1.validateMissionProgressReceipt)(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            mission: { exploreCount: 3 },
        }), { ok: true });
    });
    (0, node_test_1.it)('requires server evidence ids even when legacy counters claim completion', () => {
        const forgedLegacy = {
            playerName: 'Player',
            missionId: 'fetch-d',
            missionType: 'field',
            exploreCount: 3,
            raidCount: 1,
            huntKill: false,
            evidenceIds: [],
            updatedAt: 10,
        };
        node_assert_1.strict.equal(reasonOf((0, _mission_progress_receipt_js_1.validateMissionProgressReceipt)(forgedLegacy, {
            playerName: 'Player',
            missionId: 'fetch-d',
            missionType: 'field',
            mission: { exploreCount: 3, raidCount: 1 },
        })), 'missing-server-evidence');
    });
    (0, node_test_1.it)('does not increment twice when the same evidence is replayed', () => {
        const first = (0, _mission_progress_receipt_js_1.applyMissionProgressEvent)(null, {
            playerName: 'Player',
            missionId: 'fetch-d',
            missionType: 'field',
            kind: 'field-explore',
            exploreTarget: 3,
            raidTarget: 0,
            evidenceId: 'evidence-replay-0001',
            now: 10,
        });
        const replay = (0, _mission_progress_receipt_js_1.applyMissionProgressEvent)(first, {
            playerName: 'Player',
            missionId: 'fetch-d',
            missionType: 'field',
            kind: 'field-explore',
            exploreTarget: 3,
            raidTarget: 0,
            evidenceId: 'evidence-replay-0001',
            now: 20,
        });
        node_assert_1.strict.equal(replay.exploreCount, 1);
        node_assert_1.strict.deepEqual(replay.evidenceIds, ['evidence-replay-0001']);
        node_assert_1.strict.equal(replay.updatedAt, 10);
    });
    (0, node_test_1.it)('validates a private server evidence record and rejects wrong/expired evidence', () => {
        const raw = {
            version: 1,
            evidenceId: 'evidence-server-0001',
            playerName: 'Player',
            missionId: 'hunt-boar',
            kind: 'hunt-kill',
            source: 'server-ai-combat',
            issuedAt: 1_000,
            expiresAt: 61_000,
        };
        const evidence = (0, _mission_progress_receipt_js_1.cleanMissionProgressEvidence)(raw);
        node_assert_1.strict.deepEqual((0, _mission_progress_receipt_js_1.validateMissionProgressEvidence)(evidence, {
            evidenceId: raw.evidenceId,
            playerName: 'player',
            missionId: raw.missionId,
            kind: 'hunt-kill',
            now: 2_000,
        }), { ok: true });
        node_assert_1.strict.deepEqual((0, _mission_progress_receipt_js_1.validateMissionProgressEvidence)(evidence, {
            evidenceId: raw.evidenceId,
            playerName: 'player',
            missionId: raw.missionId,
            kind: 'hunt-track',
            now: 2_000,
        }), { ok: false, reason: 'wrong-server-evidence-event' });
        node_assert_1.strict.deepEqual((0, _mission_progress_receipt_js_1.validateMissionProgressEvidence)(evidence, {
            evidenceId: raw.evidenceId,
            playerName: 'player',
            missionId: raw.missionId,
            kind: 'hunt-kill',
            now: 61_001,
        }), { ok: false, reason: 'expired-server-evidence' });
    });
    (0, node_test_1.it)('rejects missing and caller-shaped evidence tokens', () => {
        node_assert_1.strict.equal((0, _mission_progress_receipt_js_1.cleanMissionProgressEvidenceToken)(undefined), '');
        node_assert_1.strict.equal((0, _mission_progress_receipt_js_1.cleanMissionProgressEvidenceToken)('short'), '');
        node_assert_1.strict.equal((0, _mission_progress_receipt_js_1.cleanMissionProgressEvidenceToken)('colon:can:escape:keyspace'), '');
        node_assert_1.strict.deepEqual((0, _mission_progress_receipt_js_1.validateMissionProgressEvidence)(null, {
            evidenceId: 'evidence-server-0001',
            playerName: 'player',
            missionId: 'fetch-d',
            kind: 'field-explore',
            now: 2_000,
        }), { ok: false, reason: 'invalid-server-evidence' });
    });
    (0, node_test_1.it)('derives a stable consumed-bundle key independent of evidence order', () => {
        const receipt = {
            playerName: 'Player', missionId: 'fetch-d', missionType: 'field',
            exploreCount: 2, raidCount: 0, huntKill: false, updatedAt: 1,
            evidenceIds: ['evidence-server-0002', 'evidence-server-0001'],
        };
        const reversed = { ...receipt, evidenceIds: [...receipt.evidenceIds].reverse() };
        node_assert_1.strict.equal((0, _mission_progress_receipt_js_1.missionProgressEvidenceBundleKey)('Player', receipt), (0, _mission_progress_receipt_js_1.missionProgressEvidenceBundleKey)('Player', reversed));
    });
});
