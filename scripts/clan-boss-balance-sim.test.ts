import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { CLAN_BOSSES } from '../api/clan-boss/_storage.js';
import { simulateClanBossBalance } from './clan-boss-balance-sim.js';

describe('Clan Boss deterministic low-population balance ratchet', () => {
    it('lets a geared solo fallback bank meaningful progress against every boss', () => {
        for (let bossIndex = 0; bossIndex < CLAN_BOSSES.length; bossIndex += 1) {
            const result = simulateClanBossBalance(bossIndex, 1, 6);
            assert.ok(result.avgDamagePct >= 50, `${CLAN_BOSSES[bossIndex]!.name} solo progress fell to ${result.avgDamagePct}%`);
        }
    });

    it('keeps a coordinated four-player squad within the authored round budget', () => {
        for (let bossIndex = 0; bossIndex < CLAN_BOSSES.length; bossIndex += 1) {
            const result = simulateClanBossBalance(bossIndex, 4, 6);
            assert.ok(result.clearPct >= 80, `${CLAN_BOSSES[bossIndex]!.name} full-party clear rate fell to ${result.clearPct}%`);
            assert.ok(result.avgRounds >= 6 && result.avgRounds <= 16, `${CLAN_BOSSES[bossIndex]!.name} full-party round pacing drifted to ${result.avgRounds}`);
        }
    });
});
