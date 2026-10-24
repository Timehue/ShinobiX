import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    aiFightReward, AI_FIGHT_SOFT_CAP_PER_DAY, AI_FIGHT_HARD_CAP_PER_DAY, AI_FIGHT_REDUCED_MULT,
    MAX_AI_FIGHT_XP, MAX_AI_FIGHT_RYO,
    AI_FIGHT_PURSE_BASE, AI_FIGHT_PURSE_PER_LEVEL, AI_FIGHT_LUCKY_BONUS,
    aiFightPurseBase, aiFightPurseForLevel, aiFightPursePerLevel,
} from './_ai-fight-reward.js';
import { petTraitDescriptions } from '../_pet-sim/pet-config.js';
import { PVP_LUCKY_BONUS_RYO } from '../pvp/_valid-fight.js';

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
    const prior = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
    for (const [name, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    try { fn(); } finally {
        for (const [name, value] of Object.entries(prior)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
}
const NO_DIALS = { AI_FIGHT_PURSE_BASE: undefined, AI_FIGHT_PURSE_PER_LEVEL: undefined };

// Character XP is retired (leveling-without-xp map): raw AI wins are the
// unlimited-repeat channel and pay ryo only — xp is always 0 in the shape.
describe('_ai-fight-reward — daily soft-cap (P0.2b)', () => {
    it('first win of the day pays full ryo and zero xp', () => {
        const r = aiFightReward(125, 90, 1);
        assert.deepEqual(r, { xp: 0, ryo: 90, capped: false });
    });

    it('pays full ryo up to (and including) the soft cap', () => {
        const r = aiFightReward(100, 75, AI_FIGHT_SOFT_CAP_PER_DAY);
        assert.deepEqual(r, { xp: 0, ryo: 75, capped: false });
    });

    it('reduces the ryo past the soft cap', () => {
        const r = aiFightReward(100, 80, AI_FIGHT_SOFT_CAP_PER_DAY + 1);
        assert.equal(r.xp, 0);
        assert.equal(r.ryo, Math.floor(80 * AI_FIGHT_REDUCED_MULT));
        assert.equal(r.capped, true);
    });

    it('pays zero beyond the daily hard cap', () => {
        assert.deepEqual(
            aiFightReward(125, 90, AI_FIGHT_HARD_CAP_PER_DAY + 1),
            { xp: 0, ryo: 0, capped: true },
        );
    });

    it('clamps the per-fight base (anti-inflation) and ignores the claimed xp entirely', () => {
        const r = aiFightReward(99999, 99999, 1);
        assert.equal(r.xp, 0);
        assert.ok(MAX_AI_FIGHT_XP >= 0, 'legacy clamp constant retained for old-client shapes');
        assert.equal(r.ryo, MAX_AI_FIGHT_RYO);
    });

    it('handles non-numeric / negative input safely', () => {
        assert.deepEqual(aiFightReward('x', -50, 1), { xp: 0, ryo: 0, capped: false });
    });
});

// 2026-10 economy rebalance, framework #25: the purse is min(150, 60 + L), +15
// for an active Lucky pet under the same clamp.
describe('_ai-fight-reward — level-scaled purse (#25)', () => {
    it('pays 60 + level up to the 150 clamp', () => withEnv(NO_DIALS, () => {
        assert.equal(AI_FIGHT_PURSE_BASE, 60);
        assert.equal(AI_FIGHT_PURSE_PER_LEVEL, 1);
        assert.equal(AI_FIGHT_LUCKY_BONUS, 15);
        assert.deepEqual([1, 10, 15, 30, 50, 70, 90, 100].map((l) => aiFightPurseForLevel(l)), [61, 70, 75, 90, 110, 130, 150, 150]);
        assert.deepEqual([1, 10, 50, 75, 76, 90].map((l) => aiFightPurseForLevel(l, 'Lucky')), [76, 85, 125, 150, 150, 150]);
        assert.equal(aiFightPurseForLevel(30, 'Swift'), 90, 'only Lucky moves the purse');
    }));

    it('reads a missing or invalid level as L1 and an oversized one as L100', () => withEnv(NO_DIALS, () => {
        for (const bad of [undefined, null, 0, -5, NaN, 'x']) assert.equal(aiFightPurseForLevel(bad), 61, String(bad));
        assert.equal(aiFightPurseForLevel(250), 150);
        assert.equal(aiFightPurseForLevel('42.9'), 102, 'a fractional level floors');
    }));

    it('never seals more than the per-fight clamp, Lucky included', () => withEnv(NO_DIALS, () => {
        for (let l = 1; l <= 100; l++) assert.ok(aiFightPurseForLevel(l, 'Lucky') <= MAX_AI_FIGHT_RYO, `L${l}`);
    }));

    it('bounds a farmed L90 day at 50 x 150 + 50 x 37', () => withEnv(NO_DIALS, () => {
        let day = 0;
        for (let n = 1; n <= 120; n++) day += aiFightReward(0, aiFightPurseForLevel(90), n).ryo;
        assert.equal(day, 9_350);
        assert.equal(aiFightReward(0, aiFightPurseForLevel(50), AI_FIGHT_SOFT_CAP_PER_DAY + 1).ryo, 27, 'the 51st win pays a quarter');
    }));

    it('the env kill value 75 / 0 restores the flat 75 (90 with Lucky)', () => {
        withEnv({ AI_FIGHT_PURSE_BASE: '75', AI_FIGHT_PURSE_PER_LEVEL: '0' }, () => {
            assert.equal(aiFightPurseBase(), 75);
            assert.equal(aiFightPursePerLevel(), 0);
            for (const level of [1, 30, 90, 100]) {
                assert.equal(aiFightPurseForLevel(level), 75, `L${level}`);
                assert.equal(aiFightPurseForLevel(level, 'Lucky'), 90, `L${level} Lucky`);
            }
        });
    });

    it('ignores an invalid dial and falls back to the code default', () => {
        for (const raw of ['-1', '151', '60.5', 'lots', '']) {
            withEnv({ AI_FIGHT_PURSE_BASE: raw, AI_FIGHT_PURSE_PER_LEVEL: undefined }, () => assert.equal(aiFightPurseBase(), 60, `base '${raw}'`));
        }
        for (const raw of ['-1', '4', '0.5', 'steep', '']) {
            withEnv({ AI_FIGHT_PURSE_BASE: undefined, AI_FIGHT_PURSE_PER_LEVEL: raw }, () => assert.equal(aiFightPursePerLevel(), 1, `per-level '${raw}'`));
        }
        withEnv({ AI_FIGHT_PURSE_BASE: '150', AI_FIGHT_PURSE_PER_LEVEL: '3' }, () => {
            assert.equal(aiFightPurseForLevel(100, 'Lucky'), MAX_AI_FIGHT_RYO, 'the clamp holds at the top of both dials');
        });
    });

    it('the pet trait copy states the bonus the purses actually pay', () => {
        // Lucky: one flat bonus on the AI purse and the PvP purse, and the copy
        // names it. The clamp is described in words, not as a number, so turning
        // MAX_AI_FIGHT_RYO cannot leave the copy wrong.
        assert.equal(PVP_LUCKY_BONUS_RYO, AI_FIGHT_LUCKY_BONUS);
        assert.ok(petTraitDescriptions.Lucky.includes(`${AI_FIGHT_LUCKY_BONUS} extra ryo`), petTraitDescriptions.Lucky);
        assert.ok(!petTraitDescriptions.Lucky.includes(String(MAX_AI_FIGHT_RYO)), petTraitDescriptions.Lucky);
        assert.doesNotMatch(petTraitDescriptions.Lucky, /%/, 'Lucky is a flat bonus, not a percentage');
        // Swift: AI wins pay no character XP (aiFightReward always returns xp 0),
        // so the copy must not promise an XP bonus.
        assert.equal(aiFightReward(125, 75, 1).xp, 0);
        assert.doesNotMatch(petTraitDescriptions.Swift, /\bXP\b/, petTraitDescriptions.Swift);
    });
});
