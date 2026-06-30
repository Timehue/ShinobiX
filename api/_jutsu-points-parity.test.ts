import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as server from './_jutsu-points.js';
import * as client from '../shinobij.client/src/lib/jutsu-points.js';

// Behavioral cross-build parity: api/_jutsu-points.ts is a hand port of
// shinobij.client/src/lib/jutsu-points.ts (separate build roots). Rather than
// diff source text, run both implementations over the same inputs and assert the
// point values match — so a drift in either the tag table, the rank caps, or the
// structural costs fails npm test. Guards the bloodline-budget enforcement that
// P0.1 sub-1 added on the server.
describe('parity: jutsu-points (api/_jutsu-points.ts ⇄ client lib/jutsu-points.ts)', () => {
    const RANKS = ['B Rank', 'A Rank', 'S Rank'] as const;

    it('pointBudgetForRank matches', () => {
        for (const r of RANKS) {
            assert.equal(server.pointBudgetForRank(r), client.pointBudgetForRank(r), `budget ${r}`);
        }
    });

    it('tagPointValue matches across tags x ranks', () => {
        const tags = [
            { name: 'Copy' }, { name: 'Mirror' }, { name: 'Stun' }, { name: 'Bloodline Seal' },
            { name: 'Lag' }, { name: 'Overclock' }, { name: 'Buff Prevent' }, { name: 'Debuff Prevent' },
            { name: 'Cleanse Prevent' }, { name: 'Clear Prevent' }, { name: 'Elemental Seal' },
            { name: 'Heal' }, { name: 'Shield' }, { name: 'Pierce' }, { name: 'Barrier' }, { name: 'Drain' },
            { name: 'Push' }, { name: 'Pull' }, { name: 'Move' }, { name: 'Poison' },
            { name: 'Increase Damage Given', percent: 30 }, { name: 'Increase Damage Given', percent: 35 },
            { name: 'Increase Damage Given', percent: 40 }, { name: 'Reflect', percent: 35 },
            { name: 'Absorb', percent: 30 }, { name: 'Lifesteal', percent: 35 }, { name: 'Recoil', percent: 40 },
            { name: 'Wound', percent: 25 }, { name: 'Wound', percent: 30 }, { name: 'Wound', percent: 35 },
            { name: 'Seal' }, { name: 'Afterburn' }, { name: 'Vamp', percent: 35 },
        ];
        for (const r of RANKS) {
            for (const t of tags) {
                assert.equal(
                    server.tagPointValue(t as never, r),
                    // client signature is tagPointValue(tag, rank?)
                    (client.tagPointValue as (tag: unknown, rank: unknown) => number)(t, r),
                    `tag ${t.name}@${(t as { percent?: number }).percent ?? '-'} ${r}`,
                );
            }
        }
    });

    it('jutsuPoints matches on representative jutsu', () => {
        const samples = [
            { ap: 60, range: 4, effectPower: 36, cooldown: 7, target: 'OPPONENT', method: 'SINGLE', tags: [{ name: 'Wound', percent: 30 }] },
            { ap: 40, range: 4, effectPower: 0, cooldown: 7, target: 'OPPONENT', method: 'SINGLE', tags: [{ name: 'Increase Damage Given', percent: 35 }, { name: 'Decrease Damage Given', percent: 30 }] },
            { ap: 60, range: 5, effectPower: 50, cooldown: 1, target: 'OPPONENT', method: 'SINGLE', tags: [] },
            { ap: 60, range: 4, effectPower: 36, cooldown: 7, target: 'OPPONENT', method: 'SINGLE', tags: [{ name: 'Stun' }, { name: 'Copy' }] },
            { ap: 40, range: 4, effectPower: 0, cooldown: 7, target: 'EMPTY_GROUND', method: 'INSTANT_EFFECT', tags: [{ name: 'Poison' }] },
        ];
        for (const r of RANKS) {
            for (const j of samples) {
                assert.equal(
                    server.jutsuPoints(j as never, r),
                    (client.jutsuPoints as (jutsu: unknown, rank: unknown) => number)(j, r),
                    `jutsu ${JSON.stringify(j)} ${r}`,
                );
            }
        }
    });
});
