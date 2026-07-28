import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cashOutEndless, endlessMilestoneReward, endlessWaveReward, recordEndlessWin, startEndlessRun } from './_run.js';

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
        assert.equal(out.character.xp, 0, 'frozen xp untouched');
        // New-model waves bank ryo only.
        assert.equal(endlessWaveReward(3, 50).xp, 0);
        assert.ok(endlessWaveReward(3, 50).ryo > 0);
    });
});
