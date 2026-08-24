import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyTreasuryDonation } from './_treasury-donate.js';
import { routeStoresDonation } from './_treasury-stores-donate.js';
import { CRAFT_POINTS } from './craft/_forge.js';
import { meritForDonation } from './village/_village-merit.js';

const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);
const rules = { allowedCurrencies: ['ryo'], currencyCaps: { ryo: 1000 }, itemCountCap: 1000 };

function donate(treasury: Record<string, unknown>, donor: Record<string, unknown>, itemId: string, count: number, materialPoints = true) {
    const donation = { kind: 'item' as const, itemId, count };
    const outcome = applyTreasuryDonation(treasury, donor, donation, rules);
    assert.ok(outcome.ok, 'base donation must pass');
    return routeStoresDonation(treasury, outcome, donation, CRAFT_POINTS, { materialPoints, now: NOW });
}

describe('routeStoresDonation', () => {
    it('ration-pack lands in provisions 1:1, NOT as a loose treasury item, at 6 ryo each of stores value', () => {
        const r = donate({ provisions: 5, items: [{ itemId: 'scroll', count: 1 }] }, { itemStacks: [{ itemId: 'ration-pack', count: 30 }] }, 'ration-pack', 20);
        assert.ok(r.ok && r.routed);
        assert.equal(r.routed.store, 'provisions');
        assert.deepEqual(r.routed.stores, { provisions: 25, materialPoints: 0 });
        assert.equal(r.routed.ryoValue, 120);
        assert.deepEqual(r.nextTreasury.items, [{ itemId: 'scroll', count: 1 }]);
        assert.equal(r.nextTreasury.provisions, 25);
        assert.deepEqual(r.nextDonorChar.itemStacks, [{ itemId: 'ration-pack', count: 10 }]);
        assert.equal(r.nextDonorChar.storesDonatedDate, '2026-08-22');
        assert.equal(r.nextDonorChar.rationsDonatedToday, 20);
        assert.equal(r.nextDonorChar.craftPointsDonatedToday, 0);
    });

    it('hunt materials + relics credit material points at their CRAFT_POINTS value (4 ryo per point of stores value)', () => {
        const r = donate({}, { itemStacks: [], inventory: ['hunt-ash-scale', 'hunt-ash-scale'] }, 'hunt-ash-scale', 2);
        assert.ok(r.ok && r.routed);
        assert.equal(r.routed.store, 'materialPoints');
        assert.equal(r.routed.amount, 30);
        assert.equal(r.routed.ryoValue, 120);
        assert.equal(r.nextTreasury.materialPoints, 30);
        assert.deepEqual(r.nextTreasury.items, []);
        assert.equal(r.nextDonorChar.craftPointsDonatedToday, 30);
        // `ryoValue` is the STORES' own accounting of what a routed donation was
        // worth (250-point relic -> 1,000 ryo-equivalent). It is NOT the Village
        // Merit basis: api/village/treasury/donate.ts bills every item donation
        // at the flat 500-per-item it always did, routed or not, so routing can
        // never quietly re-balance a Kage challenge.
        const relic = donate({}, { inventory: ['warforged-relic'] }, 'warforged-relic', 1);
        assert.ok(relic.ok && relic.routed);
        assert.equal(relic.routed.ryoValue, 1_000);
        assert.equal(meritForDonation(relic.routed.ryoValue), 1);
    });

    it('enforces the per-donor daily caps (40 rations / 1,500 points) across the UTC day', () => {
        const donor = { itemStacks: [{ itemId: 'ration-pack', count: 100 }], storesDonatedDate: '2026-08-22', rationsDonatedToday: 35, craftPointsDonatedToday: 1_400 };
        const over = donate({}, donor, 'ration-pack', 6);
        assert.equal(over.ok, false);
        if (!over.ok) assert.equal(over.status, 429);
        const fits = donate({}, donor, 'ration-pack', 5);
        assert.ok(fits.ok && fits.routed);
        assert.equal(fits.nextDonorChar.rationsDonatedToday, 40);
        assert.equal(fits.nextDonorChar.craftPointsDonatedToday, 1_400, 'the sibling counter survives');
        const pts = donate({}, { ...donor, inventory: ['warforged-relic'] }, 'warforged-relic', 1);
        assert.equal(pts.ok, false, '1,400 + 250 > 1,500');
        // A new day resets both counters.
        const fresh = donate({}, { ...donor, storesDonatedDate: '2026-08-21' }, 'ration-pack', 40);
        assert.ok(fresh.ok && fresh.routed);
        assert.equal(fresh.nextDonorChar.craftPointsDonatedToday, 0);
    });

    it('the 429 names the CANONICAL player-facing units — never "craft points"', () => {
        // The two stocks are Provisions (rations) and Materials (materials).
        // "craft points" is the internal field's history, and it reached the
        // player through this refusal string.
        const donor = { itemStacks: [{ itemId: 'ration-pack', count: 100 }], inventory: ['warforged-relic'], storesDonatedDate: '2026-08-22', rationsDonatedToday: 35, craftPointsDonatedToday: 1_400 };
        const rations = donate({}, donor, 'ration-pack', 6);
        assert.equal(rations.ok, false);
        if (!rations.ok) {
            assert.equal(rations.error, 'Daily donation limit: 35/40 rations today; this would add 6.');
        }
        const materials = donate({}, donor, 'warforged-relic', 1);
        assert.equal(materials.ok, false);
        if (!materials.ok) {
            assert.equal(materials.error, 'Daily donation limit: 1400/1500 materials today; this would add 250.');
            assert.doesNotMatch(materials.error, /craft point|material point|pts|supplies/i);
        }
    });

    it('materials are not mirrored when the caller disables them (clan), and unrelated items pass through untouched', () => {
        const clan = donate({}, { inventory: ['hunt-ash-scale'] }, 'hunt-ash-scale', 1, false);
        assert.ok(clan.ok);
        assert.equal(clan.routed, null);
        assert.deepEqual(clan.nextTreasury.items, [{ itemId: 'hunt-ash-scale', count: 1 }]);
        const other = donate({}, { inventory: ['legendary-crown'] }, 'legendary-crown', 1);
        assert.ok(other.ok);
        assert.equal(other.routed, null);
        assert.deepEqual(other.nextTreasury.items, [{ itemId: 'legendary-crown', count: 1 }]);
    });
});
