import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    cashOutEndless, endlessMilestoneReward, endlessRewardFactor, endlessScaleFactor, endlessWaveReward, recordEndlessWin, startEndlessRun,
    ENDLESS_BC_FIRST_RUN_OF_DAY, ENDLESS_FACTOR_CAP_WAVE, ENDLESS_FS_LIFETIME_FIRST, ENDLESS_LEVEL_CAP, ENDLESS_REWARD_MULT,
    type EndlessRun,
} from './_run.js';

const DIAL_ENVS = ['ENDLESS_REWARD_MULT', 'ENDLESS_FACTOR_CAP_WAVE', 'ENDLESS_LEVEL_CAP', 'ENDLESS_FS_LIFETIME_FIRST', 'ENDLESS_BC_FIRST_RUN_OF_DAY'] as const;
for (const name of DIAL_ENVS) delete process.env[name];
const runAt = (wave: number, highestMilestoneClaimed = 0): EndlessRun => ({ runToken: 't', wave, bankedRyo: 0, bankedXp: 0, startedAt: 1, highestMilestoneClaimed });
const fighter = (extra: Record<string, unknown> = {}) => ({ level: 50, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, boneCharms: 0, fateShards: 0, ...extra });
const vitals = { hp: 50, chakra: 50, stamina: 50 };
const ryoSum = (level: number, from: number, to: number) => {
    let total = 0;
    for (let wave = from; wave <= to; wave++) total += endlessWaveReward(wave, level).ryo;
    return total;
};

describe('Endless Tower server run', () => {
    it('charges canonical escalating entry fees and resumes tokened runs for free', () => {
        const free = startEndlessRun({ ryo: 10_000 }, 'token', '2026-07-12', 1); assert.equal(free.ok, true); if (!free.ok) return;
        assert.equal(free.cost, 0); assert.equal(free.character.dailyEndlessRuns, 1);
        assert.equal(startEndlessRun(free.character, 'other', '2026-07-12').resumed, true);
        const paid = startEndlessRun({ ...free.character, endlessTowerRun: null }, 'two', '2026-07-12'); assert.equal(paid.ok, true); if (paid.ok) assert.equal(paid.cost, 3000);
    });
    it('mirrors wave and milestone rewards and rejects skipped/replayed waves', () => {
        assert.deepEqual(endlessMilestoneReward(20), { boneCharms: 5, fateShards: 5 });
        const run = { runToken: 't', wave: 5, bankedRyo: 0, bankedXp: 0, startedAt: 1, highestMilestoneClaimed: 0 };
        const char = { level: 50, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, boneCharms: 0, fateShards: 0 };
        assert.equal(recordEndlessWin(char, run, 6, { hp: 50, chakra: 50, stamina: 50 }), null);
        const won = recordEndlessWin(char, run, 5, { hp: 50, chakra: 50, stamina: 50 })!;
        assert.deepEqual(won.reward, endlessWaveReward(5, 50)); assert.equal((won.character.endlessTowerRun as any).wave, 6); assert.equal(won.character.boneCharms, 5);
    });
    it('cashout banks ryo only (XP retired — legacy bankedXp folds to ryo) and clears the run', () => {
        // Character XP is gone, and with it the whole daily-XP-softcap
        // subsystem. An in-flight run minted before the deploy may still carry
        // bankedXp — it converts at the same ~0.75:1 fold as the wave rewards.
        const out = cashOutEndless({ level: 10, xp: 0, ryo: 100, stats: {}, lastDailyReset: '2026-07-12', dailyTowerXp: 1000 }, { runToken: 't', wave: 2, bankedRyo: 500, bankedXp: 1000, startedAt: 1 }, '2026-07-12');
        assert.equal(out.creditedRyo, 500 + 750); assert.equal(out.character.ryo, 100 + 1250); assert.equal(out.character.endlessTowerRun, null); assert.equal(out.creditedXp, 0);
        assert.equal((out.character as Record<string, unknown>).xp, 0, 'frozen xp untouched');
        // New-model waves bank ryo only.
        assert.equal(endlessWaveReward(3, 50).xp, 0);
        assert.ok(endlessWaveReward(3, 50).ryo > 0);
    });
});

describe('Endless economy rebalance (2026-10)', () => {
    afterEach(() => { for (const name of DIAL_ENVS) delete process.env[name]; });

    it('ships the framework dial defaults', () => {
        assert.equal(ENDLESS_REWARD_MULT, 0.55);
        assert.equal(ENDLESS_FACTOR_CAP_WAVE, 20);
        assert.equal(ENDLESS_LEVEL_CAP, 70);
        assert.equal(ENDLESS_FS_LIFETIME_FIRST, true);
        assert.equal(ENDLESS_BC_FIRST_RUN_OF_DAY, true);
    });

    it('caps the wave factor at 20 and the level term at 70, then applies x0.55', () => {
        assert.equal(endlessWaveReward(1, 50).ryo, 234);
        assert.equal(endlessWaveReward(20, 50).ryo, 2264);
        assert.equal(endlessWaveReward(21, 50).ryo, 754);
        assert.equal(endlessWaveReward(200, 50).ryo, 2264);
        assert.equal(endlessWaveReward(20, 70).ryo, 3060);
        assert.equal(endlessWaveReward(20, 90).ryo, 3060);
        assert.equal(endlessWaveReward(200, 100).ryo, 3060);
        assert.equal(endlessWaveReward(1, 1).ryo, 31);
    });

    it('banks the framework run totals', () => {
        assert.equal(ryoSum(90, 1, 50), 57_179);
        assert.equal(ryoSum(90, 1, 100), 123_479);
        assert.equal(ryoSum(30, 1, 20), 8_333);
    });

    it('caps pay only: opponent difficulty keeps the uncapped factor', () => {
        assert.ok(Math.abs(endlessScaleFactor(200) - 23.92) < 1e-9);
        assert.equal(endlessRewardFactor(200), endlessScaleFactor(20));
        assert.equal(endlessRewardFactor(7), endlessScaleFactor(7));
    });

    it('restores the pre-rebalance pay at the documented kill values', () => {
        process.env.ENDLESS_REWARD_MULT = '1';
        process.env.ENDLESS_FACTOR_CAP_WAVE = '200';
        process.env.ENDLESS_LEVEL_CAP = '1000';
        assert.equal(ryoSum(90, 1, 50), 181_192);
        assert.equal(ryoSum(90, 1, 100), 633_820);
    });

    it('ignores out-of-range dial values and falls back to the defaults', () => {
        process.env.ENDLESS_REWARD_MULT = '0';
        process.env.ENDLESS_FACTOR_CAP_WAVE = '500';
        process.env.ENDLESS_LEVEL_CAP = 'abc';
        assert.equal(endlessWaveReward(20, 90).ryo, 3060);
    });

    it('pays Fate Shard milestones only on a wave beyond the lifetime best', () => {
        const best20 = fighter({ endlessTowerBestWave: 20, dailyEndlessRuns: 1 });
        const at15 = recordEndlessWin(best20, runAt(15, 10), 15, vitals)!;
        assert.equal(at15.milestone.fateShards, 0);
        assert.equal(at15.lifetimeFirst, false);
        assert.equal((at15.character.endlessTowerRun as EndlessRun).highestMilestoneClaimed, 15,
            'a milestone that pays 0 still advances, so it can never pay later in the same run');
        const at20 = recordEndlessWin(best20, runAt(20, 15), 20, vitals)!;
        assert.equal(at20.milestone.fateShards, 0);
        assert.equal(at20.milestone.boneCharms, 5);

        const best30 = fighter({ endlessTowerBestWave: 30, dailyEndlessRuns: 1 });
        const at35 = recordEndlessWin(best30, runAt(35, 30), 35, vitals)!;
        assert.equal(at35.milestone.fateShards, 5);
        assert.equal(at35.lifetimeFirst, true);
        assert.equal(at35.character.fateShards, 5);
        assert.equal(at35.character.endlessTowerBestWave, 35);
    });

    it('re-arms Fate Shards every run when the lifetime-first switch is killed', () => {
        process.env.ENDLESS_FS_LIFETIME_FIRST = 'off';
        const out = recordEndlessWin(fighter({ endlessTowerBestWave: 40, dailyEndlessRuns: 1 }), runAt(15, 10), 15, vitals)!;
        assert.equal(out.milestone.fateShards, 5);
        assert.equal(out.lifetimeFirst, false);
    });

    it('pays Bone Charm milestones only on the first run of the UTC day', () => {
        const free = recordEndlessWin(fighter({ dailyEndlessRuns: 1 }), runAt(5), 5, vitals)!;
        assert.equal(free.milestone.boneCharms, 5);
        assert.equal(free.character.boneCharms, 5);
        const paid = recordEndlessWin(fighter({ dailyEndlessRuns: 2 }), runAt(5), 5, vitals)!;
        assert.equal(paid.milestone.boneCharms, 0);
        assert.equal(paid.character.boneCharms, 0);
        assert.equal((paid.character.endlessTowerRun as EndlessRun).highestMilestoneClaimed, 5);
        const olderThanCounter = recordEndlessWin(fighter(), runAt(5), 5, vitals)!;
        assert.equal(olderThanCounter.milestone.boneCharms, 5);
        process.env.ENDLESS_BC_FIRST_RUN_OF_DAY = '0';
        assert.equal(recordEndlessWin(fighter({ dailyEndlessRuns: 3 }), runAt(5), 5, vitals)!.milestone.boneCharms, 5);
    });

    it('a free run started today counts as the BC-eligible run; a paid second run does not', () => {
        const day = '2026-10-17';
        const first = startEndlessRun({ ryo: 10_000 }, 'firstruntoken', day, 1);
        assert.equal(first.ok, true); if (!first.ok) return;
        assert.equal(first.cost, 0);
        const firstFifth = recordEndlessWin(fighter({ ...first.character }), { ...first.run, wave: 5 }, 5, vitals)!;
        assert.equal(firstFifth.milestone.boneCharms, 5);
        const second = startEndlessRun({ ...first.character, endlessTowerRun: null }, 'secondruntoken', day, 2);
        assert.equal(second.ok, true); if (!second.ok) return;
        assert.equal(second.cost, 3000);
        const fifth = recordEndlessWin(fighter({ ...second.character }), { ...second.run, wave: 5 }, 5, vitals)!;
        assert.equal(fifth.milestone.boneCharms, 0);
    });

    it('cash-out stamps the highest wave actually won, never the unfought next wave', () => {
        const out = cashOutEndless({ level: 10, ryo: 0, stats: {} }, { ...runAt(15), bankedRyo: 100 }, '2026-10-17');
        assert.equal(out.character.endlessTowerBestWave, 14);
        const kept = cashOutEndless({ level: 10, ryo: 0, stats: {}, endlessTowerBestWave: 40 }, { ...runAt(15), bankedRyo: 100 }, '2026-10-17');
        assert.equal(kept.character.endlessTowerBestWave, 40);
        const unplayed = cashOutEndless({ level: 10, ryo: 0, stats: {} }, runAt(1), '2026-10-17');
        assert.equal(unplayed.character.endlessTowerBestWave, 0);
    });

    it('a cash-out after wave 14 leaves the wave-15 Fate Shard milestone earnable next run', () => {
        const banked = cashOutEndless(fighter({ ryo: 0, stats: {} }), { ...runAt(15, 10), bankedRyo: 100 }, '2026-10-17');
        const next = recordEndlessWin(fighter({ ...banked.character, dailyEndlessRuns: 1 }), runAt(15, 10), 15, vitals)!;
        assert.equal(next.milestone.fateShards, 5);
    });
});
