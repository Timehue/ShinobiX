import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    mercHireCost, addOrRefreshLease, hasActiveLease, consumeLease, claimMercFromBand, MERC_LEASE_MS,
    MERC_HIRE_RECEIPT_GRACE_MS, mercHireAllowance, mercHireId, newBoundBand, claimMercFromBandKey,
    leaseServes, bandsServing, mercBandKey, pruneMercHires,
} from './_war-merc.js';
import { normalizeVillageWarRecord, type MercLease, type MercLeaseContext, type MercHireReceipt } from './_war-state.js';
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

// ── Owner redesign 2026-10-08: bands hired for one war, per-war allowances ──

const VWAR: MercLeaseContext = { kind: 'village', warId: 'avillage-vs-bvillage', generation: 2 };
const NEXT_VWAR: MercLeaseContext = { kind: 'village', warId: 'avillage-vs-bvillage', generation: 3 };
const SIEGE: MercLeaseContext = { kind: 'sector', contestId: '23:avillage-vs-bvillage', instance: 'g1.s100', sector: 23 };

function hired(context: MercLeaseContext, seat: string, n: number): MercHireReceipt[] {
    return Array.from({ length: n }, (_, i) => newBoundBand({
        id: `mh_${seat}-${i}-xxxxxx`, tierId: 'merc-ronin', player: 'p', seat, context, contextEndsAt: 10_000_000, cost: 60, now: 1_000 + i,
    }).receipt);
}

test('village war: the Kage seat hires 3 and each Elder seat 1, counted per seat', () => {
    assert.deepEqual(
        { ...mercHireAllowance([], VWAR, ['kage']), seats: undefined },
        { seat: 'kage', used: 0, limit: 6, callerLeft: 3, seats: undefined },
    );
    const kageDone = hired(VWAR, 'kage', 3);
    assert.equal(mercHireAllowance(kageDone, VWAR, ['kage']).seat, null, 'the Kage seat is spent');
    assert.equal(mercHireAllowance(kageDone, VWAR, ['elder-2']).seat, 'elder-2', 'an Elder seat is not');
    const elderDone = [...kageDone, ...hired(VWAR, 'elder-2', 1)];
    assert.equal(mercHireAllowance(elderDone, VWAR, ['elder-2']).seat, null, 'one per Elder seat');
    // A leader holding both seats spends the Kage allowance first, then the Elder one.
    assert.equal(mercHireAllowance(hired(VWAR, 'kage', 2), VWAR, ['kage', 'elder-1']).seat, 'kage');
    assert.equal(mercHireAllowance(kageDone, VWAR, ['kage', 'elder-1']).seat, 'elder-1');
    assert.equal(mercHireAllowance(kageDone, VWAR, ['kage', 'elder-1']).callerLeft, 1);
    // A non-leader holds no seat.
    assert.equal(mercHireAllowance([], VWAR, []).seat, null);
});

test('the allowance belongs to ONE war instance: a rematch starts fresh', () => {
    assert.equal(mercHireAllowance(hired(VWAR, 'kage', 3), NEXT_VWAR, ['kage']).seat, 'kage');
    assert.equal(mercHireAllowance(hired(SIEGE, 'kage', 3), VWAR, ['kage']).callerLeft, 3, 'a sector war never eats the village-war allowance');
});

test('sector war: 3 hires per contest in all, by any leader', () => {
    const two = [...hired(SIEGE, 'kage', 1), ...hired(SIEGE, 'elder-3', 1)];
    assert.deepEqual(mercHireAllowance(two, SIEGE, ['elder-1']), { seat: 'elder-1', used: 2, limit: 3, callerLeft: 1 });
    assert.equal(mercHireAllowance([...two, ...hired(SIEGE, 'elder-1', 1)], SIEGE, ['kage']).seat, null);
    assert.equal(mercHireAllowance([], SIEGE, []).callerLeft, 0, 'a non-leader never hires');
});

test('mercHireId maps a per-click request id to a stable hire id, and refuses junk', () => {
    assert.equal(mercHireId('click-0001-abcdef'), 'mh_click-0001-abcdef');
    assert.equal(mercHireId('short'), null);
    assert.equal(mercHireId('has spaces in it!!'), null);
    assert.equal(mercHireId(undefined), null);
    assert.equal(mercHireId('x'.repeat(65)), null);
});

test('newBoundBand: a 2-day contract, cut short by its war\'s end; the receipt outlives the war', () => {
    const long = newBoundBand({ id: 'mh_long-000001', tierId: 'merc-warlord', player: 'kage', seat: 'kage', context: SIEGE, contextEndsAt: 10 * MERC_LEASE_MS, cost: 420, now: 0 });
    assert.equal(long.lease.expiresAt, MERC_LEASE_MS);
    assert.equal(long.lease.count, mercBandSize('merc-warlord'));
    assert.deepEqual(long.lease.context, SIEGE);
    const short = newBoundBand({ id: 'mh_short-00001', tierId: 'merc-ronin', player: 'kage', seat: 'kage', context: SIEGE, contextEndsAt: 5_000, cost: 60, now: 1_000 });
    assert.equal(short.lease.expiresAt, 5_000);
    assert.equal(short.receipt.keepUntil, 5_000 + MERC_HIRE_RECEIPT_GRACE_MS);
    assert.deepEqual(pruneMercHires([short.receipt], 5_000 + MERC_HIRE_RECEIPT_GRACE_MS), []);
    assert.equal(pruneMercHires([short.receipt], 5_000).length, 1);
});

test('a band serves only its own war; a legacy band serves village wars only', () => {
    const bound: MercLease = { tierId: 'merc-ronin', player: 'kage', expiresAt: 9_000, count: 2, id: 'mh_bound-00001', context: SIEGE };
    const legacy: MercLease = { tierId: 'merc-ronin', player: 'kage', expiresAt: 9_000, count: 2 };
    assert.equal(leaseServes(bound, SIEGE), true);
    assert.equal(leaseServes(bound, { ...SIEGE, instance: 'g2.s999' }), false);
    assert.equal(leaseServes(bound, VWAR), false);
    assert.equal(leaseServes(legacy, VWAR), true);
    assert.equal(leaseServes(legacy, SIEGE), false);
    assert.deepEqual(bandsServing([bound, legacy, { ...bound, id: 'mh_spent-00001', count: 0 }], SIEGE, 1_000), [bound]);
    assert.deepEqual(bandsServing([bound], SIEGE, 9_000), [], 'an expired band serves nothing');
});

test('claimMercFromBandKey spends from ONE band; the legacy helpers never touch a bound band', () => {
    const a: MercLease = { tierId: 'merc-ronin', player: 'kage', expiresAt: 9_000, count: 2, id: 'mh_a-000000001', context: SIEGE };
    const b: MercLease = { tierId: 'merc-ronin', player: 'kage', expiresAt: 9_000, count: 1, id: 'mh_b-000000001', context: VWAR };
    const out = claimMercFromBandKey([a, b], mercBandKey(b), 1_000);
    assert.equal(out.claimed, true);
    assert.deepEqual(out.leases, [a], 'b emptied and dropped; a untouched');
    // The (tier, hirer) helpers address legacy leases only.
    assert.equal(claimMercFromBand([a, b], 'merc-ronin', 'kage', 1_000).claimed, false);
    assert.deepEqual(consumeLease([a, b], 'merc-ronin', 'kage'), [a, b]);
    assert.equal(addOrRefreshLease([a], 'merc-ronin', 'kage', 1_000).length, 2);
});
