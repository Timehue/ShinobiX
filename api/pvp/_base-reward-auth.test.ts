import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pvpSessionMayGrantProgress, pvpSessionMayReward, sealBaseRewardStamp } from './session.js';

// Regression for #1A: a non-admin browser must never (a) turn a fight against a
// fabricated no-save NPC into a base-reward battle, nor (b) self-assign the
// Death's Gate (sector 99) 2× multiplier from the request body. sealBaseRewardStamp
// is the extracted, server-side decision that seals the session's base-reward
// policy. `deathsGateVerified` is set by the handler ONLY when presence confirms
// both fighters are actually at sector 99.
const PVP = { isAdmin: false, p1HasSave: true, p2HasSave: true, deathsGateVerified: false } as const;

describe('sealBaseRewardStamp — base-reward authorization', () => {
    it('distinguishes a sanctioned no-reward spar from a progression match', () => {
        const spar = { rewardAuthority: 'challenge' as const, joined: { p1: true, p2: true } };
        assert.equal(pvpSessionMayReward(spar), true);
        assert.equal(pvpSessionMayGrantProgress(spar), false);
        assert.equal(pvpSessionMayGrantProgress({ ...spar, baseRewards: true }), true);
    });

    it('does not stamp base rewards when they were not requested', () => {
        const r = sealBaseRewardStamp({ ...PVP, baseRewards: false, rewardSector: 5 });
        assert.deepEqual(r, { stamp: {}, denied: false });
    });

    it('DENIES base rewards against a fabricated no-save NPC opponent (non-admin)', () => {
        // Attacker is p1 (has save); p2 is an invented NPC with no save.
        const r = sealBaseRewardStamp({ ...PVP, baseRewards: true, rewardSector: 5, p2HasSave: false });
        assert.deepEqual(r.stamp, {}, 'no base rewards stamped');
        assert.equal(r.denied, true, 'flagged as denied so the handler logs it (not silent)');
    });

    it('honors base rewards for a real player-vs-player fight, preserving a normal sector', () => {
        const r = sealBaseRewardStamp({ ...PVP, baseRewards: true, rewardSector: 12 });
        assert.deepEqual(r.stamp, { baseRewards: true, rewardSector: 12 });
        assert.equal(r.denied, false);
    });

    it('neutralizes an UNVERIFIED Death’s Gate (99) to 0 for a non-admin (no 2×)', () => {
        const r = sealBaseRewardStamp({ ...PVP, baseRewards: true, rewardSector: 99, deathsGateVerified: false });
        assert.deepEqual(r.stamp, { baseRewards: true, rewardSector: 0 }, 'unverified 99 → no Death’s Gate 2×');
    });

    it('HONORS Death’s Gate (99) when the server verified both fighters are there', () => {
        const r = sealBaseRewardStamp({ ...PVP, baseRewards: true, rewardSector: 99, deathsGateVerified: true });
        assert.deepEqual(r.stamp, { baseRewards: true, rewardSector: 99 }, 'verified 99 → 2× restored');
    });

    it('neutralizes an unverified 99 supplied as a string, too', () => {
        const r = sealBaseRewardStamp({ ...PVP, baseRewards: true, rewardSector: '99', deathsGateVerified: false });
        assert.equal((r.stamp as { rewardSector?: number }).rewardSector, 0);
    });

    it('coerces a non-finite sector to 0', () => {
        const r = sealBaseRewardStamp({ ...PVP, baseRewards: true, rewardSector: 'not-a-number' });
        assert.equal((r.stamp as { rewardSector?: number }).rewardSector, 0);
    });

    it('admin may create a reward-bearing NPC test fight and keep sector 99 unverified', () => {
        // Admin override: no-save opponent allowed, and the full sector value
        // (incl. Death's Gate) preserved for test flows without presence.
        const r = sealBaseRewardStamp({ baseRewards: true, rewardSector: 99, isAdmin: true, p1HasSave: true, p2HasSave: false, deathsGateVerified: false });
        assert.deepEqual(r.stamp, { baseRewards: true, rewardSector: 99 });
        assert.equal(r.denied, false);
    });

    it('denies when the ATTACKER-as-p2 fights a no-save p1 NPC (order-independent)', () => {
        const r = sealBaseRewardStamp({ ...PVP, baseRewards: true, rewardSector: 5, p1HasSave: false });
        assert.deepEqual(r.stamp, {});
        assert.equal(r.denied, true);
    });
});
