import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { simFloor } from './spire-balance-sim.js';

// Production Spire entry is an exact-four contract. We still exercise undersized legacy/practice
// squads here so a catalog change cannot accidentally make fewer actors stronger, wedge the
// engine, or bypass the intended full-squad difficulty. Every weekly blessing is sealed and run.
const MILESTONES = [
    { tier: 12, fullSquadBand: [82, 95] as const },
    { tier: 16, fullSquadBand: [55, 80] as const },
    { tier: 20, fullSquadBand: [20, 55] as const },
] as const;

describe('Spire authored milestone balance matrix', () => {
    for (const milestone of MILESTONES) {
        it(`keeps tier ${milestone.tier} ordered across 2/3/4 actors and all blessing weeks`, () => {
            for (let blessingWeek = 0; blessingWeek < 5; blessingWeek++) {
                const byParty = [2, 3, 4].map(partySize => ({
                    partySize,
                    result: simFloor(milestone.tier, partySize, 16, { blessingWeek }),
                }));
                for (const { partySize, result } of byParty) {
                    assert.ok(result.win >= 0 && result.win <= 100, `T${milestone.tier} P${partySize} W${blessingWeek} resolves`);
                    if (result.win < 100) assert.ok(result.failCause === 'timeout' || result.failCause === 'wiped');
                }
                assert.ok(byParty[0]!.result.win <= byParty[1]!.result.win, `T${milestone.tier} W${blessingWeek}: P2 <= P3`);
                assert.ok(byParty[1]!.result.win <= byParty[2]!.result.win, `T${milestone.tier} W${blessingWeek}: P3 <= P4`);
                const full = byParty[2]!.result.win;
                assert.ok(
                    full >= milestone.fullSquadBand[0] && full <= milestone.fullSquadBand[1],
                    `T${milestone.tier} P4 W${blessingWeek} ${full}% outside [${milestone.fullSquadBand.join(', ')}]%`,
                );
            }
        });
    }
});
