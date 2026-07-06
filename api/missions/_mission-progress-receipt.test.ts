import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyMissionProgressEvent,
    cleanMissionProgressEventKind,
    validateMissionProgressReceipt,
    type MissionProgressReceipt,
} from './_mission-progress-receipt.js';

function reasonOf(result: ReturnType<typeof validateMissionProgressReceipt>): string {
    assert.equal(result.ok, false);
    return result.reason;
}

describe('_mission-progress-receipt', () => {
    it('cleans supported progress event kinds', () => {
        assert.equal(cleanMissionProgressEventKind('field-explore'), 'field-explore');
        assert.equal(cleanMissionProgressEventKind('hunt-kill'), 'hunt-kill');
        assert.equal(cleanMissionProgressEventKind('bogus'), '');
    });

    it('increments field progress only to the sealed requirements', () => {
        let receipt: MissionProgressReceipt | null = null;
        for (let i = 0; i < 5; i += 1) {
            receipt = applyMissionProgressEvent(receipt, {
                playerName: 'Player',
                missionId: 'fetch-d',
                missionType: 'field',
                kind: 'field-explore',
                exploreTarget: 3,
                raidTarget: 1,
                now: 100 + i,
            });
        }
        receipt = applyMissionProgressEvent(receipt, {
            playerName: 'Player',
            missionId: 'fetch-d',
            missionType: 'field',
            kind: 'field-raid',
            exploreTarget: 3,
            raidTarget: 1,
            now: 200,
        });
        assert.equal(receipt.exploreCount, 3);
        assert.equal(receipt.raidCount, 1);
        assert.deepEqual(validateMissionProgressReceipt(receipt, {
            playerName: 'player',
            missionId: 'fetch-d',
            missionType: 'field',
            mission: { exploreCount: 3, raidCount: 1 },
        }), { ok: true });
    });

    it('requires a tracked hunt kill before hunt payout', () => {
        let receipt: MissionProgressReceipt | null = null;
        receipt = applyMissionProgressEvent(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            kind: 'hunt-track',
            exploreTarget: 3,
            raidTarget: 0,
        });
        assert.equal(reasonOf(validateMissionProgressReceipt(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            mission: { exploreCount: 3 },
        })), 'incomplete-progress-receipt');

        receipt = applyMissionProgressEvent(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            kind: 'hunt-track',
            exploreTarget: 3,
            raidTarget: 0,
        });
        receipt = applyMissionProgressEvent(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            kind: 'hunt-kill',
            exploreTarget: 3,
            raidTarget: 0,
        });
        assert.deepEqual(validateMissionProgressReceipt(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            mission: { exploreCount: 3 },
        }), { ok: true });
    });
});
