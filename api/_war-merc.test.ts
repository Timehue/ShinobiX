import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mercHireCost, addOrRefreshLease, hasActiveLease, consumeLease, claimMercFromBand, MERC_LEASE_MS } from './_war-merc.js';
import { normalizeVillageWarRecord } from './_war-state.js';
import { mercBandSize } from './_war-economy.js';

test('mercHireCost applies the comeback discount to the tier base', () => {
    const rec = normalizeVillageWarRecord('Stormveil Village'); // all structures L0 → Barracks mult 1
    assert.equal(mercHireCost('merc-ronin', 8, rec), 60);   // >=2 sectors → full price
    assert.equal(mercHireCost('merc-ronin', 1, rec), 15);   // 1 sector → 75% off (60 × 0.25)
    assert.equal(mercHireCost('merc-ronin', 0, rec), 0);    // 0 sectors → free
    assert.equal(mercHireCost('merc-warlord', 8, rec), 420);
    assert.equal(mercHireCost('merc-nope', 8, rec), 0);     // unknown tier → 0 (caller rejects)
});

test('mercHireCost: Barracks levels reduce the cost', () => {
    const base = normalizeVillageWarRecord('Stormveil Village');
    const withBarracks = normalizeVillageWarRecord('Stormveil Village');
    withBarracks.structures.barracks = 10; // max Barracks
    const full = mercHireCost('merc-warlord', 8, base);
    const discounted = mercHireCost('merc-warlord', 8, withBarracks);
    assert.ok(discounted < full, `Barracks should cut the cost: ${discounted} < ${full}`);
    assert.ok(discounted > 0, 'a max-Barracks discount is bounded, not free');
});

test('mercBandSize escalates 3->5 with tier, 0 for unknown', () => {
    assert.equal(mercBandSize('merc-ronin'), 3);
    assert.equal(mercBandSize('merc-warlord'), 5);
    assert.equal(mercBandSize('merc-nope'), 0);
});

test('addOrRefreshLease keeps one active lease per (tier, player), restarting the clock', () => {
    const now = 1_000_000;
    let leases = addOrRefreshLease([], 'merc-ronin', 'akira', now);
    assert.equal(leases.length, 1);
    assert.equal(leases[0].expiresAt, now + MERC_LEASE_MS);
    assert.equal(leases[0].count, mercBandSize('merc-ronin')); // a 3-merc band
    // Re-hire the SAME tier → still one lease, the 2-day clock restarted.
    leases = addOrRefreshLease(leases, 'merc-ronin', 'akira', now + 5_000);
    assert.equal(leases.length, 1);
    assert.equal(leases[0].expiresAt, now + 5_000 + MERC_LEASE_MS);
    // A different tier → a second, independent lease.
    leases = addOrRefreshLease(leases, 'merc-oni', 'akira', now);
    assert.equal(leases.length, 2);
});

test('hasActiveLease respects expiry + player, consumeLease removes it', () => {
    const now = 1_000_000;
    const rec = normalizeVillageWarRecord('Stormveil Village');
    rec.mercLeases = addOrRefreshLease([], 'merc-shadow', 'rin', now);
    assert.equal(hasActiveLease(rec, 'merc-shadow', 'rin', now), true);
    assert.equal(hasActiveLease(rec, 'merc-shadow', 'rin', now + MERC_LEASE_MS + 1), false); // expired
    assert.equal(hasActiveLease(rec, 'merc-shadow', 'other', now), false);                   // wrong player
    assert.equal(hasActiveLease(rec, 'merc-ronin', 'rin', now), false);                      // wrong tier
    const after = consumeLease(rec.mercLeases, 'merc-shadow', 'rin');
    assert.equal(after.length, 0);
});

test('claimMercFromBand spends one merc per deployment, dropping the lease at 0', () => {
    const now = 1_000_000;
    const leases = addOrRefreshLease([], 'merc-ronin', 'akira', now); // band of 3
    const c1 = claimMercFromBand(leases, 'merc-ronin', 'akira', now);
    assert.equal(c1.claimed, true);
    assert.equal(c1.remaining, 2);
    const c2 = claimMercFromBand(c1.leases, 'merc-ronin', 'akira', now);
    const c3 = claimMercFromBand(c2.leases, 'merc-ronin', 'akira', now);
    assert.equal(c3.remaining, 0);
    assert.equal(c3.leases.length, 0, 'lease is dropped once the band is spent');
    const c4 = claimMercFromBand(c3.leases, 'merc-ronin', 'akira', now);
    assert.equal(c4.claimed, false); // nothing left to deploy
    // An EXPIRED band can't be deployed.
    const exp = claimMercFromBand(addOrRefreshLease([], 'merc-oni', 'b', now), 'merc-oni', 'b', now + MERC_LEASE_MS + 1);
    assert.equal(exp.claimed, false);
});
