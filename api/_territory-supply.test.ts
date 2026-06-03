import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { collectTerritorySupply, resolveClaimedWarSupply, TERRITORY_DAILY_WAR_SUPPLY, TERRITORY_SUPPLY_INTERVAL_MS } from './_territory-supply.js';

const DAY = TERRITORY_SUPPLY_INTERVAL_MS;
const NOW = 1_000 * DAY; // a fixed "now" well past epoch so deltas are clean

describe('collectTerritorySupply', () => {
    it('collects stored supply plus whole-cycle accrual for an owned sector', () => {
        // 3 full days since lastSupplyAt, plus 250 already stored.
        const out = collectTerritorySupply({ ownerClan: 'Storm', warSupply: 250, lastSupplyAt: NOW - 3 * DAY }, NOW);
        assert.equal(out.collected, 250 + 3 * TERRITORY_DAILY_WAR_SUPPLY); // 250 + 300
        assert.equal(out.nextLastSupplyAt, NOW); // advanced by exactly 3 whole cycles
    });

    it('preserves the partial-period remainder when advancing lastSupplyAt', () => {
        const out = collectTerritorySupply({ ownerClan: 'Storm', warSupply: 0, lastSupplyAt: NOW - (2 * DAY + DAY / 3) }, NOW);
        assert.equal(out.collected, 2 * TERRITORY_DAILY_WAR_SUPPLY); // only 2 whole cycles
        assert.equal(out.nextLastSupplyAt, NOW - DAY / 3); // remainder (1/3 day) carried forward
    });

    it('collects only stored supply when less than a full cycle has elapsed', () => {
        const out = collectTerritorySupply({ ownerClan: 'Storm', warSupply: 70, lastSupplyAt: NOW - DAY / 2 }, NOW);
        assert.equal(out.collected, 70); // no new cycle yet
        assert.equal(out.nextLastSupplyAt, NOW - DAY / 2); // unchanged (0 cycles)
    });

    it('never accrues for an unowned sector', () => {
        const out = collectTerritorySupply({ warSupply: 999, lastSupplyAt: NOW - 10 * DAY }, NOW);
        assert.equal(out.collected, 0);
    });

    it('falls back to updatedAt then now when lastSupplyAt is absent', () => {
        const viaUpdatedAt = collectTerritorySupply({ ownerClan: 'Storm', warSupply: 0, updatedAt: NOW - 2 * DAY }, NOW);
        assert.equal(viaUpdatedAt.collected, 2 * TERRITORY_DAILY_WAR_SUPPLY);
        const viaNow = collectTerritorySupply({ ownerClan: 'Storm', warSupply: 40 }, NOW);
        assert.equal(viaNow.collected, 40); // base defaults to now → 0 cycles
    });
});

describe('resolveClaimedWarSupply', () => {
    it('carries prev warSupply + lastSupplyAt when the same clan keeps owning', () => {
        const prev = { ownerClan: 'Storm', ownerVillage: 'Leaf', warSupply: 250, lastSupplyAt: NOW - 3 * DAY };
        const out = resolveClaimedWarSupply(prev, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        assert.equal(out.warSupply, 250);
        assert.equal(out.lastSupplyAt, NOW - 3 * DAY);
    });

    it('drives the result entirely from prev — the client never supplies warSupply (anti-mint)', () => {
        // `incoming` only carries the owner identity; there is no field through
        // which a client could inject a warSupply value on a same-owner write.
        const prev = { ownerClan: 'Storm', ownerVillage: 'Leaf', warSupply: 80, lastSupplyAt: NOW - DAY };
        const out = resolveClaimedWarSupply(prev, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        assert.equal(out.warSupply, 80);
        assert.equal(out.lastSupplyAt, NOW - DAY);
    });

    it('resets to 0 and re-anchors on a cross-village ownership flip', () => {
        const prev = { ownerClan: 'Old', ownerVillage: 'Sand', warSupply: 9999, lastSupplyAt: NOW - 50 * DAY };
        const out = resolveClaimedWarSupply(prev, { ownerClan: 'New', ownerVillage: 'Leaf' }, NOW);
        assert.equal(out.warSupply, 0);
        assert.equal(out.lastSupplyAt, NOW);
    });

    it('resets on a within-village clan capture (clan changes, village same)', () => {
        const prev = { ownerClan: 'Alpha', ownerVillage: 'Leaf', warSupply: 5000, lastSupplyAt: NOW - 9 * DAY };
        const out = resolveClaimedWarSupply(prev, { ownerClan: 'Bravo', ownerVillage: 'Leaf' }, NOW);
        assert.equal(out.warSupply, 0);
        assert.equal(out.lastSupplyAt, NOW);
    });

    it('resets on a village-war capture (village changes, clan field stale)', () => {
        const prev = { ownerClan: 'Alpha', ownerVillage: 'Leaf', warSupply: 5000, lastSupplyAt: NOW - 9 * DAY };
        const out = resolveClaimedWarSupply(prev, { ownerClan: 'Alpha', ownerVillage: 'Sand' }, NOW);
        assert.equal(out.warSupply, 0);
        assert.equal(out.lastSupplyAt, NOW);
    });

    it('resets when the sector was previously unowned', () => {
        const prev = { warSupply: 500, lastSupplyAt: NOW - 10 * DAY };
        const out = resolveClaimedWarSupply(prev, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        assert.equal(out.warSupply, 0);
        assert.equal(out.lastSupplyAt, NOW);
    });

    it('resets on a first write (no prev record)', () => {
        const out = resolveClaimedWarSupply(null, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        assert.equal(out.warSupply, 0);
        assert.equal(out.lastSupplyAt, NOW);
    });

    it('carries (no supply loss) when the owner write omits the village field', () => {
        const prev = { ownerClan: 'Storm', ownerVillage: 'Leaf', warSupply: 120, lastSupplyAt: NOW - 2 * DAY };
        const out = resolveClaimedWarSupply(prev, { ownerClan: 'Storm' }, NOW);
        assert.equal(out.warSupply, 120);
        assert.equal(out.lastSupplyAt, NOW - 2 * DAY);
    });

    it('floors a negative/NaN prev warSupply and falls back to updatedAt for the anchor', () => {
        const prev = { ownerClan: 'Storm', ownerVillage: 'Leaf', warSupply: -5, updatedAt: NOW - DAY };
        const out = resolveClaimedWarSupply(prev, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        assert.equal(out.warSupply, 0);
        assert.equal(out.lastSupplyAt, NOW - DAY);
    });

    it('end-to-end: a same-owner write cannot inflate the eventual collect', () => {
        // Owner claimed 4 days ago, never collected. A malicious settings write
        // tries to set a huge warSupply — the server carries prev (0) + the old
        // anchor, so collect still yields only the true 4-day accrual.
        const claimedAt = NOW - 4 * DAY;
        const prev = { ownerClan: 'Storm', ownerVillage: 'Leaf', warSupply: 0, lastSupplyAt: claimedAt };
        const owned = resolveClaimedWarSupply(prev, { ownerClan: 'Storm', ownerVillage: 'Leaf' }, NOW);
        const collected = collectTerritorySupply(
            { ownerClan: 'Storm', warSupply: owned.warSupply, lastSupplyAt: owned.lastSupplyAt },
            NOW,
        );
        assert.equal(collected.collected, 4 * TERRITORY_DAILY_WAR_SUPPLY);
    });
});
