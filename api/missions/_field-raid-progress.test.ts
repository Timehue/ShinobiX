import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { acceptedRaidFetchMissions, fieldRaidEvidenceId } from './_field-raid-progress.js';
import { fieldMissionById } from './_mission-catalog.js';
import {
    applyMissionProgressEvent,
    cleanMissionProgressEvidenceToken,
    validateMissionProgressReceipt,
    type MissionProgressReceipt,
} from './_mission-progress-receipt.js';

function charAt(level: number, accepted: string[]): Record<string, unknown> {
    return { level, acceptedMissionIds: accepted };
}

/** The live save shape: accepted ids top-level, level on the nested character. */
function saveAt(level: number, accepted: string[]): Record<string, unknown> {
    return { acceptedMissionIds: accepted, currentSector: 47, character: { level } };
}

describe('_field-raid-progress', () => {
    it('REGRESSION: reads accepted ids off the save record, level off its character', () => {
        // report-raid passes the whole save record. acceptedMissionIds lives at its
        // top level while the eligibility gate reads the nested character — the old
        // code looked for BOTH on the character, found no accepted missions, and so
        // never credited a single raid. Every fetch-* mission stayed unclaimable.
        const ids = acceptedRaidFetchMissions(saveAt(80, ['fetch-b-enemy-cache', 'hunt-wild-boar'])).map((m) => m.id);
        assert.deepEqual(ids, ['fetch-b-enemy-cache']);
        // The character-side level gate still applies through the record.
        assert.deepEqual(acceptedRaidFetchMissions(saveAt(10, ['fetch-s-shadow-front'])), []);
    });

    it('derives a receipt-legal, stable, proof-specific evidence id', () => {
        // battleIds are unconstrained strings, so the id must survive characters
        // the receipt token charset rejects (':' in particular).
        const fromBattle = fieldRaidEvidenceId('pvp:battle:abc/123');
        assert.equal(cleanMissionProgressEvidenceToken(fromBattle), fromBattle, 'must pass the token charset');
        assert.equal(fieldRaidEvidenceId('pvp:battle:abc/123'), fromBattle, 'stable for a replayed proof');
        assert.notEqual(fieldRaidEvidenceId('pvp:battle:abc/124'), fromBattle, 'distinct per proof');
    });

    it('selects only accepted fetch missions that actually ask for raids', () => {
        const ids = acceptedRaidFetchMissions(
            charAt(80, ['fetch-d-supply-trail', 'fetch-s-shadow-front', 'hunt-wild-boar', 'not-a-mission']),
        ).map((m) => m.id);
        assert.deepEqual(ids, ['fetch-d-supply-trail', 'fetch-s-shadow-front']);
    });

    it('excludes hunts, unaccepted missions, and level-ineligible fetches', () => {
        // hunt-* share FIELD_MISSIONS but claim on the 'hunt' path with no raidCount.
        assert.deepEqual(acceptedRaidFetchMissions(charAt(80, ['hunt-frost-wolf'])), []);
        assert.deepEqual(acceptedRaidFetchMissions(charAt(80, [])), []);
        assert.deepEqual(acceptedRaidFetchMissions(null), []);
        // fetch-s-shadow-front is levelReq 70 — a level-10 player can't claim it,
        // so building a receipt for it would be dead weight.
        assert.deepEqual(acceptedRaidFetchMissions(charAt(10, ['fetch-s-shadow-front'])), []);
        assert.deepEqual(
            acceptedRaidFetchMissions(charAt(10, ['fetch-d-supply-trail'])).map((m) => m.id),
            ['fetch-d-supply-trail'],
        );
    });

    it('dedupes a mission accepted twice', () => {
        const ids = acceptedRaidFetchMissions(
            charAt(80, ['fetch-d-supply-trail', 'fetch-d-supply-trail']),
        ).map((m) => m.id);
        assert.deepEqual(ids, ['fetch-d-supply-trail']);
    });

    it('REGRESSION: explores alone leave a fetch mission unclaimable; the raid completes it', () => {
        // The live bug: every builtin fetch-* requires raidCount raids, record-progress
        // refuses combat kinds, and nothing else stamped field-raid — so the receipt
        // could never satisfy validateMissionProgressReceipt.
        const mission = fieldMissionById('fetch-d-supply-trail')!;
        const expected = {
            playerName: 'Rill',
            missionId: mission.id,
            missionType: 'field' as const,
            mission,
        };
        const exploreTarget = mission.exploreCount;
        const raidTarget = mission.raidCount!;
        assert.ok(raidTarget > 0, 'fixture must actually require a raid');

        let receipt: MissionProgressReceipt | null = null;
        for (let i = 0; i < exploreTarget; i += 1) {
            receipt = applyMissionProgressEvent(receipt, {
                playerName: 'Rill', missionId: mission.id, missionType: 'field', kind: 'field-explore',
                exploreTarget, raidTarget, evidenceId: `explore-${i}-aaaaaaaaaaaaaaaa`,
            });
        }
        assert.equal(receipt!.exploreCount, exploreTarget);
        const stuck = validateMissionProgressReceipt(receipt, expected);
        assert.equal(stuck.ok, false);
        assert.equal(stuck.ok === false && stuck.reason, 'incomplete-progress-receipt');

        // The raid proof, as report-raid now stamps it.
        for (let i = 0; i < raidTarget; i += 1) {
            receipt = applyMissionProgressEvent(receipt, {
                playerName: 'Rill', missionId: mission.id, missionType: 'field', kind: 'field-raid',
                exploreTarget, raidTarget, evidenceId: fieldRaidEvidenceId(`raid-token-${i}`),
            });
        }
        assert.equal(receipt!.raidCount, raidTarget);
        assert.equal(validateMissionProgressReceipt(receipt, expected).ok, true, 'now claimable');
    });

    it('a replayed raid proof cannot double-count raidCount', () => {
        // report-raid's battleId NX gate short-circuits replays, but the stamp is
        // idempotent on its own: the same proof derives the same evidence id.
        const mission = fieldMissionById('fetch-c-border-scout')!;
        const evidenceId = fieldRaidEvidenceId('one-and-the-same-battle');
        let receipt: MissionProgressReceipt | null = null;
        for (let i = 0; i < 3; i += 1) {
            receipt = applyMissionProgressEvent(receipt, {
                playerName: 'Rill', missionId: mission.id, missionType: 'field', kind: 'field-raid',
                exploreTarget: mission.exploreCount, raidTarget: mission.raidCount!, evidenceId,
            });
        }
        assert.equal(receipt!.raidCount, 1, 'three reports of one raid credit one raid');
        assert.equal(receipt!.evidenceIds.length, 1);
    });

    it('every builtin fetch mission stays inside the 32-evidence receipt cap', () => {
        // validateMissionProgressReceipt wants exploreTarget + raidTarget distinct
        // evidence ids, but the receipt only retains 32 — so a mission needing more
        // would be unclaimable for a different reason.
        for (const id of ['fetch-d-supply-trail', 'fetch-c-border-scout', 'fetch-b-enemy-cache', 'fetch-a-black-route', 'fetch-s-shadow-front']) {
            const m = fieldMissionById(id)!;
            assert.ok(m.exploreCount + (m.raidCount ?? 0) <= 32, `${id} exceeds the evidence cap`);
        }
    });
});
