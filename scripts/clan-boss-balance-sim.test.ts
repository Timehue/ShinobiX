import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { CLAN_BOSSES } from '../api/clan-boss/_storage.js';
import { simulateClanBossBalance } from './clan-boss-balance-sim.js';

describe('Clan Boss deterministic three-player balance ratchet', () => {
    it('keeps a strong legal solo below one third of the assault while coordinated trios make serious progress', () => {
        for (let bossIndex = 0; bossIndex < CLAN_BOSSES.length; bossIndex += 1) {
            const solo = simulateClanBossBalance(bossIndex, 1, 6);
            const trio = simulateClanBossBalance(bossIndex, 3, 6);
            const boss = CLAN_BOSSES[bossIndex]!.name;
            assert.equal(solo.clearPct, 0, `${boss} solo cleared a full assault`);
            assert.ok(solo.avgDamagePct >= 10 && solo.avgDamagePct <= 33, `${boss} strong solo contribution drifted to ${solo.avgDamagePct}%`);
            assert.ok(trio.avgDamagePct >= 60, `${boss} trio contribution fell to ${trio.avgDamagePct}%`);
            assert.ok(trio.avgDamage >= solo.avgDamage * 2.5, `${boss} trio lost its cooperative advantage`);
            assert.equal(trio.wipePct, 0, `${boss} strong trio unexpectedly wiped`);
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
