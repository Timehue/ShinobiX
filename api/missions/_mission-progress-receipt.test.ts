import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyMissionProgressEvent,
    cleanMissionProgressEvidence,
    cleanMissionProgressEvidenceToken,
    cleanMissionProgressEventKind,
    missionProgressEvidenceBundleKey,
    validateMissionProgressEvidence,
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

    it('server producer flow: N-1 tracks + a kill build a claimable hunt receipt', () => {
        // Mirrors the live producer: record-progress self-authorizes each hunt-track
        // (server-travel), then report-ai-fight stamps the sealed-opponent hunt-kill.
        const exploreTarget = 4;
        const mission = { exploreCount: exploreTarget, raidCount: 0 };
        const expected = { playerName: 'Rill', missionId: 'hunt-frost-wolf', missionType: 'hunt' as const, mission };
        let receipt: MissionProgressReceipt | null = null;
        for (let i = 0; i < exploreTarget - 1; i += 1) {
            receipt = applyMissionProgressEvent(receipt, {
                playerName: 'Rill', missionId: 'hunt-frost-wolf', missionType: 'hunt', kind: 'hunt-track',
                exploreTarget, raidTarget: 0, evidenceId: `track-${i}-aaaaaaaaaaaaaaaa`,
            });
        }
        // Tracking alone never completes a hunt — the verified kill is the proof.
        assert.equal(receipt!.exploreCount, exploreTarget - 1);
        assert.equal(reasonOf(validateMissionProgressReceipt(receipt, expected)), 'missing-hunt-kill-receipt');
        // The kill: sealed-opponent win via report-ai-fight.
        receipt = applyMissionProgressEvent(receipt, {
            playerName: 'Rill', missionId: 'hunt-frost-wolf', missionType: 'hunt', kind: 'hunt-kill',
            exploreTarget, raidTarget: 0, evidenceId: 'huntkill_frostwolftoken12345678',
        });
        assert.equal(receipt.huntKill, true);
        assert.equal(receipt.exploreCount, exploreTarget);
        assert.equal(receipt.evidenceIds.length, exploreTarget);
        assert.equal(validateMissionProgressReceipt(receipt, expected).ok, true, 'now claimable');
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
                evidenceId: `evidence-explore-${i}`,
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
            evidenceId: 'evidence-field-raid',
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
            evidenceId: 'evidence-hunt-track-1',
        });
        assert.equal(reasonOf(validateMissionProgressReceipt(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            mission: { exploreCount: 3 },
        })), 'missing-hunt-kill-receipt');

        receipt = applyMissionProgressEvent(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            kind: 'hunt-track',
            exploreTarget: 3,
            raidTarget: 0,
            evidenceId: 'evidence-hunt-track-2',
        });
        receipt = applyMissionProgressEvent(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            kind: 'hunt-kill',
            exploreTarget: 3,
            raidTarget: 0,
            evidenceId: 'evidence-hunt-kill',
        });
        assert.deepEqual(validateMissionProgressReceipt(receipt, {
            playerName: 'Player',
            missionId: 'hunt-boar',
            missionType: 'hunt',
            mission: { exploreCount: 3 },
        }), { ok: true });
    });

    it('a verified kill completes a hunt even when every tracking ping was dropped', () => {
        // The failure this guards: hunt-track pings are fire-and-forget, so a flaky
        // network can leave the receipt with zero tracking evidence while the client
        // shows a full bar. The server-verified kill (sealed opponentId, accepted
        // hunt) must still make the contract claimable on its own — otherwise the
        // hunt bricks permanently with no way to re-earn the dropped tracks.
        const receipt = applyMissionProgressEvent(null, {
            playerName: 'Player',
            missionId: 'hunt-forest-hawk',
            missionType: 'hunt',
            kind: 'hunt-kill',
            exploreTarget: 3,
            raidTarget: 0,
            evidenceId: 'huntkill_foresthawktoken1234567',
        });
        assert.equal(receipt.huntKill, true);
        assert.deepEqual(validateMissionProgressReceipt(receipt, {
            playerName: 'Player',
            missionId: 'hunt-forest-hawk',
            missionType: 'hunt',
            mission: { exploreCount: 3 },
        }), { ok: true });
    });

    it('requires server evidence ids even when legacy counters claim completion', () => {
        const forgedLegacy = {
            playerName: 'Player',
            missionId: 'fetch-d',
            missionType: 'field' as const,
            exploreCount: 3,
            raidCount: 1,
            huntKill: false,
            evidenceIds: [],
            updatedAt: 10,
        };
        assert.equal(reasonOf(validateMissionProgressReceipt(forgedLegacy, {
            playerName: 'Player',
            missionId: 'fetch-d',
            missionType: 'field',
            mission: { exploreCount: 3, raidCount: 1 },
        })), 'missing-server-evidence');
    });

    it('does not increment twice when the same evidence is replayed', () => {
        const first = applyMissionProgressEvent(null, {
            playerName: 'Player',
            missionId: 'fetch-d',
            missionType: 'field',
            kind: 'field-explore',
            exploreTarget: 3,
            raidTarget: 0,
            evidenceId: 'evidence-replay-0001',
            now: 10,
        });
        const replay = applyMissionProgressEvent(first, {
            playerName: 'Player',
            missionId: 'fetch-d',
            missionType: 'field',
            kind: 'field-explore',
            exploreTarget: 3,
            raidTarget: 0,
            evidenceId: 'evidence-replay-0001',
            now: 20,
        });
        assert.equal(replay.exploreCount, 1);
        assert.deepEqual(replay.evidenceIds, ['evidence-replay-0001']);
        assert.equal(replay.updatedAt, 10);
    });

    it('validates a private server evidence record and rejects wrong/expired evidence', () => {
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
        const evidence = cleanMissionProgressEvidence(raw);
        assert.deepEqual(validateMissionProgressEvidence(evidence, {
            evidenceId: raw.evidenceId,
            playerName: 'player',
            missionId: raw.missionId,
            kind: 'hunt-kill',
            now: 2_000,
        }), { ok: true });
        assert.deepEqual(validateMissionProgressEvidence(evidence, {
            evidenceId: raw.evidenceId,
            playerName: 'player',
            missionId: raw.missionId,
            kind: 'hunt-track',
            now: 2_000,
        }), { ok: false, reason: 'wrong-server-evidence-event' });
        assert.deepEqual(validateMissionProgressEvidence(evidence, {
            evidenceId: raw.evidenceId,
            playerName: 'player',
            missionId: raw.missionId,
            kind: 'hunt-kill',
            now: 61_001,
        }), { ok: false, reason: 'expired-server-evidence' });
    });

    it('rejects missing and caller-shaped evidence tokens', () => {
        assert.equal(cleanMissionProgressEvidenceToken(undefined), '');
        assert.equal(cleanMissionProgressEvidenceToken('short'), '');
        assert.equal(cleanMissionProgressEvidenceToken('colon:can:escape:keyspace'), '');
        assert.deepEqual(validateMissionProgressEvidence(null, {
            evidenceId: 'evidence-server-0001',
            playerName: 'player',
            missionId: 'fetch-d',
            kind: 'field-explore',
            now: 2_000,
        }), { ok: false, reason: 'invalid-server-evidence' });
    });

    it('derives a stable consumed-bundle key independent of evidence order', () => {
        const receipt: MissionProgressReceipt = {
            playerName: 'Player', missionId: 'fetch-d', missionType: 'field',
            exploreCount: 2, raidCount: 0, huntKill: false, updatedAt: 1,
            evidenceIds: ['evidence-server-0002', 'evidence-server-0001'],
        };
        const reversed = { ...receipt, evidenceIds: [...receipt.evidenceIds].reverse() };
        assert.equal(missionProgressEvidenceBundleKey('Player', receipt), missionProgressEvidenceBundleKey('Player', reversed));
    });
});
