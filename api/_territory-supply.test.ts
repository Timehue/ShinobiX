import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { collectTerritorySupply, TERRITORY_DAILY_WAR_SUPPLY, TERRITORY_SUPPLY_INTERVAL_MS } from './_territory-supply.js';

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
