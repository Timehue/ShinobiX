import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyMissionProgressEvent,
    cleanMissionProgressEvidence,
    cleanMissionProgressEvidenceToken,
    cleanMissionProgressEventKind,
    missionProgressEvidenceBundleKey,
    savedAcceptedMissionIds,
    savedCurrentSector,
    savedMissionProgress,
    validateMissionProgressEvidence,
    validateMissionProgressReceipt,
    type MissionProgressReceipt,
} from './_mission-progress-receipt.js';

/**
 * The shape a real save actually has in Postgres: acceptedMissionIds,
 * missionProgress and currentSector sit at the TOP LEVEL, beside `character` —
 * never inside it. Verified against production: of 108 saves, 102 carried these
 * fields top-level and ZERO carried them on the character.
 */
function liveSaveRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        acceptedMissionIds: ['fetch-b-enemy-cache', 'hunt-wild-boar'],
        missionProgress: { 'fetch-b-enemy-cache': 7, 'fetch-b-enemy-cache:raids': 3 },
        currentSector: 47,
        character: { name: 'Dopey', level: 39 },
        ...over,
    };
}

function reasonOf(result: ReturnType<typeof validateMissionProgressReceipt>): string {
    assert.equal(result.ok, false);
    return result.reason;
}

describe('_mission-progress-receipt save readers', () => {
    it('REGRESSION: reads accepted missions off the RECORD, not the character', () => {
        // The live bug. Every progress producer (record-progress, report-raid via
        // _field-raid-progress, report-ai-fight) read acceptedMissionIds off
        // `record.character`, where it does not exist. `accepted` was therefore
        // always false, no receipt was ever minted for any player, and every
        // built-in field mission and Hunter contract failed to claim with
        // "missing-progress-receipt" on a card whose bar was already full.
        const record = liveSaveRecord();
        assert.equal((record.character as Record<string, unknown>).acceptedMissionIds, undefined,
            'fixture must match the live shape: character carries NO accepted ids');
        assert.deepEqual(savedAcceptedMissionIds(record), ['fetch-b-enemy-cache', 'hunt-wild-boar']);
        assert.deepEqual(savedMissionProgress(record), { 'fetch-b-enemy-cache': 7, 'fetch-b-enemy-cache:raids': 3 });
        assert.equal(savedCurrentSector(record), 47);
    });

    it('still reads a bare character, so a caller holding only that works', () => {
        assert.deepEqual(savedAcceptedMissionIds({ level: 39, acceptedMissionIds: ['fetch-d-supply-trail'] }), ['fetch-d-supply-trail']);
        assert.deepEqual(savedMissionProgress({ level: 39, missionProgress: { 'fetch-d-supply-trail': 2 } }), { 'fetch-d-supply-trail': 2 });
        assert.equal(savedCurrentSector({ level: 39, currentSector: 12 }), 12);
    });

    it('prefers the record over a nested character when both carry the field', () => {
        const record = liveSaveRecord({ character: { level: 39, acceptedMissionIds: ['stale-id'], missionProgress: { 'stale-id': 99 }, currentSector: 3 } });
        assert.deepEqual(savedAcceptedMissionIds(record), ['fetch-b-enemy-cache', 'hunt-wild-boar']);
        assert.deepEqual(savedMissionProgress(record), { 'fetch-b-enemy-cache': 7, 'fetch-b-enemy-cache:raids': 3 });
        assert.equal(savedCurrentSector(record), 47);
    });

    it('is total on missing, null and malformed saves', () => {
        assert.deepEqual(savedAcceptedMissionIds(null), []);
        assert.deepEqual(savedAcceptedMissionIds(undefined), []);
        assert.deepEqual(savedAcceptedMissionIds({}), []);
        assert.deepEqual(savedAcceptedMissionIds({ acceptedMissionIds: 'not-an-array' }), []);
        assert.deepEqual(savedAcceptedMissionIds({ character: null }), []);
        assert.deepEqual(savedMissionProgress(null), {});
        assert.deepEqual(savedMissionProgress({ missionProgress: [] }), {});
        assert.equal(savedCurrentSector(null), 0);
        assert.equal(savedCurrentSector({}), 0);
        assert.equal(savedCurrentSector({ currentSector: 'nope' }), 0);
        // Sector 0 is the village and a legitimate value — it must not be mistaken
        // for "absent" and then resolved from a stale nested character.
        assert.equal(savedCurrentSector({ currentSector: 0, character: { currentSector: 47 } }), 0);
    });
});

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
