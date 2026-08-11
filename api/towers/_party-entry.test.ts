import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { refundTowerPartyEntryReservation, reserveTowerPartyEntry } from './_party-entry.js';

const PARTY = `tparty-${'a'.repeat(32)}`;
const RUN = `tower-${'b'.repeat(32)}`;
const DAY = '2027-01-15';
const FLOOR = 5;

describe('Tower party entry reservation receipts', () => {
    it('reserves once and makes a lost-response retry a no-op', () => {
        const first = reserveTowerPartyEntry({
            character: { ryo: 5_000, dailyBattleDate: DAY, dailyBattleFloors: 3 },
            partyId: PARTY, runId: RUN, day: DAY, floorId: FLOOR, now: 1,
        });
        assert.equal(first.ok, true);
        if (!first.ok) return;
        assert.equal(first.charged, 1_500);
        assert.equal(first.character.ryo, 3_500);
        assert.equal(first.character.dailyBattleFloors, 4);

        const retry = reserveTowerPartyEntry({ character: first.character, partyId: PARTY, runId: RUN, day: DAY, floorId: FLOOR, now: 2 });
        assert.equal(retry.ok, true);
        if (retry.ok) {
            assert.equal(retry.changed, false);
            assert.equal(retry.replayed, true);
            assert.equal(retry.character.ryo, 3_500);
            assert.equal(retry.character.dailyBattleFloors, 4);
        }
    });

    it('compensates exactly once and safely re-reserves the same run after retry', () => {
        const first = reserveTowerPartyEntry({
            character: { ryo: 5_000, dailyBattleDate: DAY, dailyBattleFloors: 3 },
            partyId: PARTY, runId: RUN, day: DAY, floorId: FLOOR, now: 1,
        });
        assert.equal(first.ok, true);
        if (!first.ok) return;
        const refunded = refundTowerPartyEntryReservation({ character: first.character, partyId: PARTY, runId: RUN, now: 2 });
        assert.equal(refunded.ok, true);
        if (!refunded.ok) return;
        assert.equal(refunded.character.ryo, 5_000);
        assert.equal(refunded.character.dailyBattleFloors, 3);

        const duplicateRefund = refundTowerPartyEntryReservation({ character: refunded.character, partyId: PARTY, runId: RUN, now: 3 });
        assert.equal(duplicateRefund.ok, true);
        if (duplicateRefund.ok) assert.equal(duplicateRefund.changed, false);

        const reservedAgain = reserveTowerPartyEntry({ character: refunded.character, partyId: PARTY, runId: RUN, day: DAY, floorId: FLOOR, now: 4 });
        assert.equal(reservedAgain.ok, true);
        if (reservedAgain.ok) {
            assert.equal(reservedAgain.changed, true);
            assert.equal(reservedAgain.character.ryo, 3_500);
            assert.equal(reservedAgain.character.dailyBattleFloors, 4);
        }
    });

    it('never mints a refund without the durable reservation receipt', () => {
        assert.deepEqual(refundTowerPartyEntryReservation({ character: { ryo: 10 }, partyId: PARTY, runId: RUN, now: 1 }), {
            ok: false,
            code: 'missing-receipt',
        });
    });

    it('returns an explicit affordability failure without stamping a receipt', () => {
        const result = reserveTowerPartyEntry({
            character: { ryo: 1_499, dailyBattleDate: DAY, dailyBattleFloors: 3 },
            partyId: PARTY, runId: RUN, day: DAY, floorId: FLOOR, now: 1,
        });
        assert.deepEqual(result, { ok: false, code: 'insufficient-ryo', required: 1_500 });
    });

    it('keeps an already-cleared Story replay free across reserve, refund, and retry', () => {
        const initial = { ryo: 100, dailyBattleDate: DAY, dailyBattleFloors: 99, battleTowerClearedFloors: [FLOOR] };
        const first = reserveTowerPartyEntry({
            character: initial,
            partyId: PARTY, runId: RUN, day: DAY, floorId: FLOOR, now: 1,
        });
        assert.equal(first.ok, true);
        if (!first.ok) return;
        assert.equal(first.charged, 0);
        assert.equal(first.counted, false);
        assert.equal(first.replayFree, true);
        assert.equal(first.character.ryo, 100);
        assert.equal(first.character.dailyBattleFloors, 99);

        const refunded = refundTowerPartyEntryReservation({ character: first.character, partyId: PARTY, runId: RUN, now: 2 });
        assert.equal(refunded.ok, true);
        if (!refunded.ok) return;
        assert.equal(refunded.character.ryo, 100);
        assert.equal(refunded.character.dailyBattleFloors, 99);

        const retry = reserveTowerPartyEntry({
            character: refunded.character,
            partyId: PARTY, runId: RUN, day: DAY, floorId: FLOOR, now: 3,
        });
        assert.equal(retry.ok, true);
        if (!retry.ok) return;
        assert.equal(retry.charged, 0);
        assert.equal(retry.counted, false);
        assert.equal(retry.character.dailyBattleFloors, 99);
    });

    it('rejects a retry that tries to reuse a run receipt for another floor', () => {
        const first = reserveTowerPartyEntry({
            character: { ryo: 5_000 },
            partyId: PARTY, runId: RUN, day: DAY, floorId: FLOOR, now: 1,
        });
        assert.equal(first.ok, true);
        if (!first.ok) return;
        const mismatch = reserveTowerPartyEntry({
            character: first.character,
            partyId: PARTY, runId: RUN, day: DAY, floorId: FLOOR + 1, now: 2,
        });
        assert.deepEqual(mismatch, { ok: false, code: 'invalid-receipt' });
    });
});
