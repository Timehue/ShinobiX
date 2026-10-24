import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    VILLAGE_WAR_REWARD_MIN_DURATION_MS,
    villageWarAgreementPayFraction,
    villageWarEndedByAgreement,
    villageWarEndedEarlyByAgreement,
    villageWarLiveFrom,
    warMinDurationMs,
} from './_early-end.js';
import { VILLAGE_CAMPAIGN_DURATION_MS } from '../../shared/village-war-campaign.js';
import { VILLAGE_WAR_REWARD_MIN_DURATION_HOURS } from '../../shared/village-war-reward-floor.js';

/*
 * The collusive-surrender floor (2026-10 rebalance, framework I-5): a village war
 * that ends BY AGREEMENT (a surrender, or both Kages' peace offers) before 72 h
 * of live war pays no crates, purses or MVP rewards.
 */

const HOUR = 60 * 60 * 1000;
const A = 'Ashen Leaf Village';
const B = 'Moonshadow Village';
const LIVE = 1_000_000_000;

function war(over: Record<string, unknown> = {}) {
    return { villages: [A, B] as const, startedAt: LIVE - HOUR, pendingUntil: LIVE, ...over };
}

describe('villageWarEndedEarlyByAgreement', () => {
    it('is 72 hours by default and the dial moves it', () => {
        assert.equal(VILLAGE_WAR_REWARD_MIN_DURATION_HOURS, 72);
        assert.equal(VILLAGE_WAR_REWARD_MIN_DURATION_MS, 72 * HOUR);
        assert.equal(warMinDurationMs(), 72 * HOUR);
        process.env.WAR_MIN_DURATION_HOURS = '48';
        try {
            assert.equal(warMinDurationMs(), 48 * HOUR);
        } finally {
            delete process.env.WAR_MIN_DURATION_HOURS;
        }
        process.env.WAR_MIN_DURATION_HOURS = '500';
        try {
            assert.equal(warMinDurationMs(), 72 * HOUR, 'an out-of-range value falls back to the default');
        } finally {
            delete process.env.WAR_MIN_DURATION_HOURS;
        }
    });

    it('counts from the end of the pre-war window, else the start', () => {
        assert.equal(villageWarLiveFrom({ startedAt: 5, pendingUntil: 9 }), 9);
        assert.equal(villageWarLiveFrom({ startedAt: 5 }), 5);
    });

    it('an early surrender and an early peace are early; the boundary is exclusive at exactly 72 h', () => {
        assert.equal(villageWarEndedEarlyByAgreement(war({ endedAt: LIVE + 2 * HOUR, winnerVillage: A, surrenderedBy: B })), true);
        assert.equal(villageWarEndedEarlyByAgreement(war({ endedAt: LIVE + 2 * HOUR, peaceProposals: { [A]: LIVE, [B]: LIVE + 1 } })), true);
        assert.equal(villageWarEndedEarlyByAgreement(war({ endedAt: LIVE + 72 * HOUR - 1, winnerVillage: A, surrenderedBy: B })), true);
        assert.equal(villageWarEndedEarlyByAgreement(war({ endedAt: LIVE + 72 * HOUR, winnerVillage: A, surrenderedBy: B })), false, 'exactly 72 h is not early');
        assert.equal(villageWarEndedEarlyByAgreement(war({ endedAt: LIVE + 73 * HOUR, peaceProposals: { [A]: 1, [B]: 2 } })), false);
    });

    it('a score, timeout or HP ending is never early, however short', () => {
        assert.equal(villageWarEndedByAgreement(war({ endedAt: LIVE + HOUR, winnerVillage: A })), false);
        assert.equal(villageWarEndedEarlyByAgreement(war({ endedAt: LIVE + HOUR, winnerVillage: A })), false);
        assert.equal(villageWarEndedEarlyByAgreement(war({ endedAt: LIVE + 14 * 24 * HOUR })), false, 'a 14-day timeout');
        // One standing offer does not end a war: it is not an agreement.
        assert.equal(villageWarEndedEarlyByAgreement(war({ endedAt: LIVE + HOUR, peaceProposals: { [A]: LIVE } })), false);
        // A war that has not ended is not early.
        assert.equal(villageWarEndedEarlyByAgreement(war({ surrenderedBy: B })), false);
    });

    it('a floor of 0 turns the rule off', () => {
        assert.equal(villageWarEndedEarlyByAgreement(war({ endedAt: LIVE + 1, winnerVillage: A, surrenderedBy: B }), 0), false);
    });
});

describe('villageWarAgreementPayFraction', () => {
    it('pays an agreement ending for the share of the five-day campaign fought, and every other ending in full', () => {
        assert.equal(VILLAGE_CAMPAIGN_DURATION_MS, 120 * HOUR);
        assert.equal(villageWarAgreementPayFraction(war({ endedAt: LIVE + 72 * HOUR, winnerVillage: A, surrenderedBy: B })), 0.6);
        assert.equal(villageWarAgreementPayFraction(war({ endedAt: LIVE + 120 * HOUR, peaceProposals: { [A]: 1, [B]: 2 } })), 1);
        assert.equal(villageWarAgreementPayFraction(war({ endedAt: LIVE + 200 * HOUR, winnerVillage: A, surrenderedBy: B })), 1, 'capped at 1');
        assert.equal(villageWarAgreementPayFraction(war({ endedAt: LIVE + 10 * HOUR, winnerVillage: A })), 1, 'a score ending pays in full');
    });
});
