import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    COMBAT_MISSIONS, FIELD_MISSIONS, ACADEMY_TRIAL,
    combatMissionByKey, fieldMissionById,
    missionRewardBonusPct, boostAmount,
    hasDailyMissionSlot, dailyMissionsCompleted, markMissionCompletedFields,
    applyCurrencyRewardFields, grantTerritoryScrollsToInventory,
    DAILY_MISSION_LIMIT, FIELD_MISSION_SCROLLS, TERRITORY_CONTROL_SCROLL_ID,
} from './_mission-catalog.js';

// ─── Inline replica of the CLIENT mission reward data ───────────────────────
// Transcribed from shinobij.client/src/data/combat-missions.ts (COMBAT_MISSIONS)
// and shinobij.client/src/data/missions.ts (builtinHuntMissions +
// builtinFetchMissions). This is a SEPARATE copy from api/missions/_mission-
// catalog.ts so a drift on either side fails the sweep below — if the client
// reward table changes, BOTH this replica and the server catalog must change in
// lockstep (the "server == client" rule, same convention as _xp-engine.test.ts).

const C_COMBAT = [
    { key: 'combat-d-errand', min: 1, xp: 25, ryo: 20, territoryScrolls: 1, aiProfileId: 'builtin-ai-mist-sentinel' },
    { key: 'combat-c-patrol', min: 10, xp: 75, ryo: 60, territoryScrolls: 1, aiProfileId: 'builtin-ai-ember-duelist' },
    { key: 'combat-b-escort', min: 30, xp: 150, ryo: 125, territoryScrolls: 1, aiProfileId: 'builtin-ai-frost-sealer' },
    { key: 'combat-a-hunt', min: 50, xp: 300, ryo: 250, territoryScrolls: 1, aiProfileId: 'builtin-ai-shadow-weaver' },
    { key: 'combat-s-crisis', min: 70, xp: 700, ryo: 600, territoryScrolls: 1, aiProfileId: 'builtin-ai-central-champion' },
];

const C_FIELD = [
    { id: 'hunt-wild-boar', levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, currencyRewards: {} },
    { id: 'hunt-forest-hawk', levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, currencyRewards: {} },
    { id: 'hunt-frost-wolf', levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, currencyRewards: {} },
    { id: 'hunt-ash-lizard', levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, currencyRewards: {} },
    { id: 'hunt-shadow-panther', levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 } },
    { id: 'hunt-ironback-bear', levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 } },
    { id: 'hunt-ember-drake', levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 } },
    { id: 'hunt-moon-serpent', levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 } },
    { id: 'hunt-ancient-chakra-beast', levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 } },
    { id: 'hunt-worldstorm-dragon', levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 } },
    { id: 'fetch-d-supply-trail', levelReq: 1, xpReward: 90, ryoReward: 75, staminaReward: 8, currencyRewards: {} },
    { id: 'fetch-c-border-scout', levelReq: 15, xpReward: 240, ryoReward: 190, staminaReward: 14, currencyRewards: {} },
    { id: 'fetch-b-enemy-cache', levelReq: 30, xpReward: 520, ryoReward: 420, staminaReward: 22, currencyRewards: { boneCharms: 1 } },
    { id: 'fetch-a-black-route', levelReq: 50, xpReward: 1100, ryoReward: 900, staminaReward: 32, currencyRewards: { boneCharms: 2, auraDust: 20 } },
    { id: 'fetch-s-shadow-front', levelReq: 70, xpReward: 2400, ryoReward: 2100, staminaReward: 45, currencyRewards: { boneCharms: 3, auraDust: 45, fateShards: 1 } },
];

describe('mission catalog matches the client reward tables', () => {
    it('COMBAT_MISSIONS — same set, same rewards, same AI', () => {
        assert.equal(COMBAT_MISSIONS.length, C_COMBAT.length);
        for (const want of C_COMBAT) {
            const got = combatMissionByKey(want.key);
            assert.ok(got, `missing combat mission ${want.key}`);
            assert.deepEqual(got, want, `combat mission ${want.key}`);
        }
    });

    it('FIELD_MISSIONS — same set, same rewards (incl. currency)', () => {
        assert.equal(FIELD_MISSIONS.length, C_FIELD.length);
        for (const want of C_FIELD) {
            const got = fieldMissionById(want.id);
            assert.ok(got, `missing field mission ${want.id}`);
            assert.equal(got.levelReq, want.levelReq, `${want.id} levelReq`);
            assert.equal(got.xpReward, want.xpReward, `${want.id} xpReward`);
            assert.equal(got.ryoReward, want.ryoReward, `${want.id} ryoReward`);
            assert.equal(got.staminaReward, want.staminaReward, `${want.id} staminaReward`);
            assert.deepEqual(got.currencyRewards ?? {}, want.currencyRewards, `${want.id} currency`);
        }
    });

    it('Academy Trial is tiny, one-time, no premium currency', () => {
        assert.equal(ACADEMY_TRIAL.id, 'academy-trial');
        assert.ok(ACADEMY_TRIAL.xp > 0 && ACADEMY_TRIAL.xp <= 100);
        assert.ok(ACADEMY_TRIAL.ryo > 0 && ACADEMY_TRIAL.ryo <= 100);
    });
});

describe('reward-bonus math mirrors the client', () => {
    it('boostAmount = floor(amount * (1 + pct/100)), never negative', () => {
        assert.equal(boostAmount(100, 0), 100);
        assert.equal(boostAmount(100, 5), 105);
        assert.equal(boostAmount(80, 2.5), 82); // floor(80 * 1.025) = floor(82) = 82
        assert.equal(boostAmount(25, 7.5), 26); // floor(25 * 1.075) = floor(26.875) = 26
        assert.equal(boostAmount(0, 50), 0);
    });

    it('missionRewardBonusPct = missionHall(level×0.5) + auraSphere(equipped)', () => {
        assert.equal(missionRewardBonusPct({}), 0);
        assert.equal(missionRewardBonusPct({ villageUpgrades: { missionHall: 10 } }), 5);
        // aura sphere only counts when equipped
        assert.equal(missionRewardBonusPct({ auraSphereLevel: 100 }), 0);
        assert.equal(
            missionRewardBonusPct({ auraSphereLevel: 100, equipment: { aura: 'aura-sphere' } }),
            1,
        );
        assert.equal(
            missionRewardBonusPct({ auraSphereLevel: 60, equipment: { accessory: 'aura-sphere' } }),
            2,
        );
        assert.equal(
            missionRewardBonusPct({ villageUpgrades: { missionHall: 20 }, auraSphereLevel: 100, equipment: { aura: 'aura-sphere' } }),
            11, // 20*0.5 + 1
        );
        // missionHall clamps at 50
        assert.equal(missionRewardBonusPct({ villageUpgrades: { missionHall: 999 } }), 25);
    });
});

describe('daily-cap accounting matches character-progress.ts', () => {
    it('hasDailyMissionSlot honours the 20/day cap keyed on lastDailyReset', () => {
        assert.equal(DAILY_MISSION_LIMIT, 20);
        assert.equal(dailyMissionsCompleted({}, '2026-06-13'), 0);
        assert.equal(dailyMissionsCompleted({ lastDailyReset: '2026-06-12', dailyMissionsCompleted: 19 }, '2026-06-13'), 0); // stale day → reset
        assert.equal(dailyMissionsCompleted({ lastDailyReset: '2026-06-13', dailyMissionsCompleted: 19 }, '2026-06-13'), 19);
        assert.ok(hasDailyMissionSlot({ lastDailyReset: '2026-06-13', dailyMissionsCompleted: 19 }, '2026-06-13'));
        assert.ok(!hasDailyMissionSlot({ lastDailyReset: '2026-06-13', dailyMissionsCompleted: 20 }, '2026-06-13'));
    });

    it('markMissionCompletedFields bumps total + daily + clan, stamps day/month', () => {
        const fields = markMissionCompletedFields({ lastDailyReset: '2026-06-13', dailyMissionsCompleted: 4, totalMissionsCompleted: 10, clanMissionContrib: 2 }, '2026-06-13', '2026-06');
        assert.equal(fields.totalMissionsCompleted, 11);
        assert.equal(fields.dailyMissionsCompleted, 5);
        assert.equal(fields.clanMissionContrib, 3);
        assert.equal(fields.lastDailyReset, '2026-06-13');
        assert.equal(fields.clanContribMonth, '2026-06');
    });
});

describe('reward application helpers', () => {
    it('applyCurrencyRewardFields adds only positive amounts onto existing balances', () => {
        const fields = applyCurrencyRewardFields({ boneCharms: 5, auraDust: 1 }, { boneCharms: 2, auraDust: 20, fateShards: 0 });
        assert.deepEqual(fields, { boneCharms: 7, auraDust: 21 });
        assert.deepEqual(applyCurrencyRewardFields({}, undefined), {});
    });

    it('grantTerritoryScrollsToInventory appends N scroll ids', () => {
        const inv = grantTerritoryScrollsToInventory({ inventory: ['x'] }, FIELD_MISSION_SCROLLS);
        assert.equal(inv.length, 1 + FIELD_MISSION_SCROLLS);
        assert.equal(inv.filter((i) => i === TERRITORY_CONTROL_SCROLL_ID).length, FIELD_MISSION_SCROLLS);
    });
});
