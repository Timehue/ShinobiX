import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
    COMBAT_MISSIONS, FIELD_MISSIONS, ACADEMY_TRIAL, ACADEMY_CHECKLIST,
    combatMissionByKey, fieldMissionById, huntMissionById, huntMissionByAiProfileId, HUNT_MISSION_IDS,
    missionRewardBonusPct, boostAmount,
    hasDailyMissionSlot, dailyMissionsCompleted, markMissionCompletedFields,
    hasDailyHuntSlot, dailyHuntsCompleted, dailyHuntCap, markHuntCompletedFields,
    applyCurrencyRewardFields, grantItemsToInventory, grantItemsToCharacter,
    DAILY_MISSION_LIMIT, DAILY_HUNT_LIMIT, FIELD_MISSION_SCROLLS, HUNT_MISSION_SCROLLS, COMBAT_MISSION_STAT_POINTS,
    FETCH_S_MISSION_ID, DROP_ROLL_SCALE, HUNT_FS_CHANCE_DEFAULT, HUNT_AS_CHANCE_DEFAULT,
    huntFsChance, huntAsChance, missionDropCurrency, withMissionDrops,
    academyTrialRyo, academyChecklistRyo, academyChecklistGoalsMet,
} from './_mission-catalog.js';
import { jutsuRyoTrainingCost } from '../training/_jutsu-ryo.js';
import { dailyLoginRyo } from '../player/_daily-login.js';
import { ACADEMY_LEVEL_FLOORS } from '../_tutorial-progression.js';
import { FIRST_SAVE_RYO } from '../save/_first-save-baseline.js';
import { anchorRyoPerMinute } from '../../shared/economy-anchor.js';

// ─── Inline replica of the CLIENT mission reward data ───────────────────────
// Transcribed from shinobij.client/src/data/combat-missions.ts (COMBAT_MISSIONS)
// and shinobij.client/src/data/missions.ts (builtinHuntMissions +
// builtinFetchMissions). This is a SEPARATE copy from api/missions/_mission-
// catalog.ts so a drift on either side fails the sweep below — if the client
// reward table changes, BOTH this replica and the server catalog must change in
// lockstep (the "server == client" rule, same convention as _xp-engine.test.ts).

const C_COMBAT = [
    { key: 'combat-e-drill', min: 1, xp: 15, ryo: 40, territoryScrolls: 0, aiProfileId: 'builtin-ai-academy-sparring' },
    { key: 'combat-d-errand', min: 5, xp: 25, ryo: 80, territoryScrolls: 0, aiProfileId: 'builtin-ai-mist-sentinel' },
    { key: 'combat-c-patrol', min: 15, xp: 75, ryo: 200, territoryScrolls: 0, aiProfileId: 'builtin-ai-ember-duelist' },
    { key: 'combat-b-escort', min: 30, xp: 150, ryo: 380, territoryScrolls: 0, aiProfileId: 'builtin-ai-frost-sealer' },
    { key: 'combat-a-hunt', min: 50, xp: 300, ryo: 600, territoryScrolls: 0, aiProfileId: 'builtin-ai-shadow-weaver' },
    { key: 'combat-s-crisis', min: 70, xp: 700, ryo: 900, territoryScrolls: 0, aiProfileId: 'builtin-ai-central-champion' },
];

const C_FIELD = [
    { id: 'hunt-wild-boar', exploreCount: 3, levelReq: 1, xpReward: 80, ryoReward: 280, staminaReward: 8, currencyRewards: {}, itemRewards: ['hunt-beast-meat', 'hunt-beast-meat', 'hunt-torn-hide'] },
    { id: 'hunt-forest-hawk', exploreCount: 3, levelReq: 1, xpReward: 80, ryoReward: 280, staminaReward: 8, currencyRewards: {}, itemRewards: ['hunt-beast-meat', 'hunt-wild-feather', 'hunt-small-fang'] },
    { id: 'hunt-frost-wolf', exploreCount: 4, levelReq: 15, xpReward: 200, ryoReward: 480, staminaReward: 12, currencyRewards: {}, itemRewards: ['hunt-wolf-fang', 'hunt-wolf-fang', 'hunt-frost-pelt'] },
    { id: 'hunt-ash-lizard', exploreCount: 4, levelReq: 15, xpReward: 200, ryoReward: 480, staminaReward: 12, currencyRewards: {}, itemRewards: ['hunt-ash-scale', 'hunt-ash-scale', 'hunt-cracked-horn'] },
    { id: 'hunt-shadow-panther', exploreCount: 4, levelReq: 30, xpReward: 420, ryoReward: 660, staminaReward: 20, currencyRewards: { boneCharms: 1 }, itemRewards: ['hunt-shadow-pelt', 'hunt-shadow-claw', 'hunt-shadow-claw'] },
    { id: 'hunt-ironback-bear', exploreCount: 5, levelReq: 30, xpReward: 420, ryoReward: 660, staminaReward: 20, currencyRewards: { boneCharms: 1 }, itemRewards: ['hunt-beast-meat', 'hunt-beast-meat', 'hunt-cracked-horn', 'hunt-cracked-horn'] },
    { id: 'hunt-ember-drake', exploreCount: 5, levelReq: 50, xpReward: 900, ryoReward: 1020, staminaReward: 30, currencyRewards: { boneCharms: 1, auraDust: 20 }, itemRewards: ['hunt-ash-scale', 'hunt-ash-scale', 'hunt-ember-scale', 'hunt-wolf-fang'] },
    { id: 'hunt-moon-serpent', exploreCount: 5, levelReq: 50, xpReward: 900, ryoReward: 1020, staminaReward: 30, currencyRewards: { boneCharms: 1, auraDust: 20 }, itemRewards: ['hunt-shadow-pelt', 'hunt-shadow-pelt', 'hunt-shadow-claw', 'hunt-shadow-claw'] },
    { id: 'hunt-ancient-chakra-beast', exploreCount: 6, levelReq: 70, xpReward: 2000, ryoReward: 1450, staminaReward: 40, currencyRewards: { boneCharms: 2, auraDust: 40 }, itemRewards: ['hunt-legendary-material', 'hunt-legendary-material', 'hunt-ancient-beast-core'] },
    { id: 'hunt-worldstorm-dragon', exploreCount: 6, levelReq: 70, xpReward: 2000, ryoReward: 1450, staminaReward: 40, currencyRewards: { boneCharms: 2, auraDust: 40 }, itemRewards: ['hunt-legendary-material', 'hunt-legendary-material', 'hunt-titan-bone'] },
    { id: 'fetch-d-supply-trail', exploreCount: 3, raidCount: 1, levelReq: 1, xpReward: 90, ryoReward: 100, staminaReward: 8, currencyRewards: {} },
    { id: 'fetch-c-border-scout', exploreCount: 5, raidCount: 2, levelReq: 15, xpReward: 240, ryoReward: 540, staminaReward: 14, currencyRewards: {} },
    { id: 'fetch-b-enemy-cache', exploreCount: 7, raidCount: 3, levelReq: 30, xpReward: 520, ryoReward: 1320, staminaReward: 22, currencyRewards: { boneCharms: 1 } },
    { id: 'fetch-a-black-route', exploreCount: 9, raidCount: 4, levelReq: 50, xpReward: 1100, ryoReward: 3050, staminaReward: 32, currencyRewards: { boneCharms: 1, auraDust: 20 } },
    { id: 'fetch-s-shadow-front', exploreCount: 12, raidCount: 5, levelReq: 70, xpReward: 2400, ryoReward: 5630, staminaReward: 45, currencyRewards: { boneCharms: 2, auraDust: 45 } },
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
            assert.equal(got.exploreCount, want.exploreCount, `${want.id} exploreCount`);
            assert.equal(got.raidCount ?? 0, want.raidCount ?? 0, `${want.id} raidCount`);
            assert.equal(got.levelReq, want.levelReq, `${want.id} levelReq`);
            assert.equal(got.xpReward, want.xpReward, `${want.id} xpReward`);
            assert.equal(got.ryoReward, want.ryoReward, `${want.id} ryoReward`);
            assert.equal(got.staminaReward, want.staminaReward, `${want.id} staminaReward`);
            assert.deepEqual(got.currencyRewards ?? {}, want.currencyRewards, `${want.id} currency`);
            assert.deepEqual(got.itemRewards ?? [], want.itemRewards ?? [], `${want.id} itemRewards`);
        }
    });

    it('HUNT_MISSION_IDS = exactly the hunt-* entries (those carrying itemRewards)', () => {
        const huntIds = C_FIELD.filter((m) => Array.isArray(m.itemRewards)).map((m) => m.id);
        assert.equal(HUNT_MISSION_IDS.size, huntIds.length);
        for (const id of huntIds) assert.ok(HUNT_MISSION_IDS.has(id), `HUNT_MISSION_IDS missing ${id}`);
        // huntMissionById resolves hunts but NOT fetches (so a fetch id can't be
        // claimed against the hunt cap).
        assert.ok(huntMissionById('hunt-wild-boar'), 'hunt resolves');
        assert.equal(huntMissionById('fetch-d-supply-trail'), undefined, 'fetch is not a hunt');
        // huntMissionByAiProfileId (hunt-kill producer): resolve a hunt by its beast AI.
        assert.equal(huntMissionByAiProfileId('hunt-ai-wild-boar')?.id, 'hunt-wild-boar');
        assert.equal(huntMissionByAiProfileId('hunt-ai-frost-wolf')?.id, 'hunt-frost-wolf');
        assert.equal(huntMissionByAiProfileId('builtin-ai-frost-sealer'), undefined, 'a combat-mission AI is not a hunt beast');
        assert.equal(huntMissionByAiProfileId(''), undefined);
        assert.equal(huntMissionById('nope'), undefined, 'unknown is not a hunt');
    });

    it('hunt contract ryo rises strictly with the tier (framework #5)', () => {
        const byTier = [1, 15, 30, 50, 70].map((levelReq) => {
            const tier = FIELD_MISSIONS.filter((m) => HUNT_MISSION_IDS.has(m.id) && m.levelReq === levelReq);
            assert.equal(tier.length, 2, `two hunts at L${levelReq}`);
            assert.equal(tier[0].ryoReward, tier[1].ryoReward, `both L${levelReq} hunts pay the same`);
            return tier[0].ryoReward;
        });
        assert.deepEqual(byTier, [280, 480, 660, 1020, 1450]);
        // Per 6-minute hunt at the regular +10% bonus and the band's Hunter Rank,
        // with the AI kill purse min(150, 60 + L): every band lands in the core
        // 0.85-1.20x anchor band. (The step tiers dip below it at the top of a
        // band, e.g. L25-29 and L40-49, and the L15 tier opens at ~1.26x.)
        const sweep: Array<[number, number, number]> = [[10, 1, 0], [30, 30, 2], [50, 50, 3], [70, 70, 4], [90, 70, 5]];
        for (const [level, tierLevel, rank] of sweep) {
            const contract = byTier[[1, 15, 30, 50, 70].indexOf(tierLevel)];
            const perMinute = (boostAmount(contract, 10 + rank * 5) + Math.min(150, 60 + level)) / 6;
            const ratio = perMinute / anchorRyoPerMinute(level);
            assert.ok(ratio >= 0.85 && ratio <= 1.2, `L${level} hunt ${ratio.toFixed(2)}x A(L)`);
        }
    });

    it('fetch mission ryo is the framework #18 table', () => {
        assert.deepEqual(
            ['fetch-d-supply-trail', 'fetch-c-border-scout', 'fetch-b-enemy-cache', 'fetch-a-black-route', 'fetch-s-shadow-front']
                .map((id) => fieldMissionById(id)!.ryoReward),
            [100, 540, 1320, 3050, 5630],
        );
    });

    it('combat mission ryo is the framework #24 table and stays an AI side loop (<= 0.70x A)', () => {
        assert.deepEqual(COMBAT_MISSIONS.map((m) => m.ryo), [40, 80, 200, 380, 600, 900]);
        // A 5-minute fight at the regular +10% bonus, at each rank's band level.
        for (const [key, level] of [['combat-e-drill', 1], ['combat-d-errand', 10], ['combat-c-patrol', 15], ['combat-b-escort', 30], ['combat-a-hunt', 50], ['combat-s-crisis', 70]] as const) {
            const ratio = boostAmount(combatMissionByKey(key)!.ryo, 10) / 5 / anchorRyoPerMinute(level);
            assert.ok(ratio <= 0.7, `${key} at L${level}: ${ratio.toFixed(2)}x A(L)`);
        }
    });

    it('no hunt or fetch row carries a flat Fate Shard any more (they are chance drops)', () => {
        for (const mission of FIELD_MISSIONS) {
            assert.equal(mission.currencyRewards?.fateShards, undefined, `${mission.id} has a flat Fate Shard`);
            assert.equal(mission.currencyRewards?.auraStones, undefined, `${mission.id} has a flat Aura Stone`);
        }
    });

    it('Academy Trial is one-time, has no premium currency, and is sized to the first lessons', () => {
        assert.equal(ACADEMY_TRIAL.id, 'academy-trial');
        assert.ok(ACADEMY_TRIAL.xp > 0 && ACADEMY_TRIAL.xp <= 100);
        assert.equal(ACADEMY_TRIAL.ryo, 6000);
        assert.equal('fateShards' in ACADEMY_TRIAL, false);
        // Day-1 money before the Lv1 -> 3 jutsu lessons (6,500): the starting
        // ryo, the sealed spar's 30, minus the 100-ryo Noodle Den Feast the
        // onboarding sends the player to, plus the Trial and the first daily
        // login, which only opens after graduation (the L10 floor).
        const spendable = FIRST_SAVE_RYO + 30 - 100 + ACADEMY_TRIAL.ryo + dailyLoginRyo(ACADEMY_LEVEL_FLOORS.graduation);
        assert.ok(spendable >= jutsuRyoTrainingCost(1) + jutsuRyoTrainingCost(2), `day-1 ryo ${spendable}`);
    });

    it('Academy Checklist pays exactly the Lv3 -> 4 lesson plus 2 Fate Shards', () => {
        assert.equal(ACADEMY_CHECKLIST.ryo, jutsuRyoTrainingCost(3));
        assert.equal(ACADEMY_CHECKLIST.ryo, 4000);
        assert.equal(ACADEMY_CHECKLIST.fateShards, 2);
    });
});

describe('Academy grant dials and the checklist goal gate', () => {
    function withEnv(env: Record<string, string | undefined>, run: () => void) {
        const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
        try {
            for (const [name, value] of Object.entries(env)) {
                if (value === undefined) delete process.env[name]; else process.env[name] = value;
            }
            run();
        } finally {
            for (const [name, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[name]; else process.env[name] = value;
            }
        }
    }

    it('ACADEMY_TRIAL_RYO / ACADEMY_CHECKLIST_RYO default to the catalog and take the 30 / 120 kill values', () => {
        withEnv({ ACADEMY_TRIAL_RYO: undefined, ACADEMY_CHECKLIST_RYO: undefined }, () => {
            assert.equal(academyTrialRyo(), 6000);
            assert.equal(academyChecklistRyo(), 4000);
        });
        withEnv({ ACADEMY_TRIAL_RYO: '30', ACADEMY_CHECKLIST_RYO: '120' }, () => {
            assert.equal(academyTrialRyo(), 30);
            assert.equal(academyChecklistRyo(), 120);
        });
        for (const raw of ['-1', '20001', '12.5', 'lots', '']) {
            withEnv({ ACADEMY_TRIAL_RYO: raw }, () => assert.equal(academyTrialRyo(), 6000, `'${raw}' reads as the default`));
        }
    });

    it('the checklist needs jutsu mastery Lv3, an AI win and a mission, all from server-owned fields', () => {
        const done = { jutsuMastery: [{ jutsuId: 'a', level: 1 }, { jutsuId: 'b', level: 3 }], totalAiKills: 1, totalMissionsCompleted: 1 };
        assert.equal(academyChecklistGoalsMet(done), true);
        assert.equal(academyChecklistGoalsMet({ ...done, jutsuMastery: [{ jutsuId: 'b', level: 2 }] }), false, 'jutsu Lv2');
        assert.equal(academyChecklistGoalsMet({ ...done, jutsuMastery: undefined }), false, 'no mastery rows');
        assert.equal(academyChecklistGoalsMet({ ...done, totalAiKills: 0 }), false, 'no AI win');
        assert.equal(academyChecklistGoalsMet({ ...done, totalMissionsCompleted: 0 }), false, 'no mission');
        assert.equal(academyChecklistGoalsMet({ ...done, totalMissionsCompleted: 0, clanMissionContrib: 1 }), true, 'the clan counter also counts');
        assert.equal(academyChecklistGoalsMet({}), false);
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
        const fields = markMissionCompletedFields({ lastDailyReset: '2026-06-13', dailyMissionsCompleted: 4, totalMissionsCompleted: 10, clanMissionContrib: 2, clanContribMonth: '2026-06' }, '2026-06-13', '2026-06');
        assert.equal(fields.totalMissionsCompleted, 11);
        assert.equal(fields.dailyMissionsCompleted, 5);
        assert.equal(fields.clanMissionContrib, 3);
        assert.equal(fields.lastDailyReset, '2026-06-13');
        assert.equal(fields.clanContribMonth, '2026-06');
    });
});

describe('hunt daily-cap accounting matches character-progress.ts (hunt pool)', () => {
    it('hasDailyHuntSlot honours the 20/day cap keyed on lastHuntReset (independent of missions)', () => {
        assert.equal(DAILY_HUNT_LIMIT, 20);
        assert.equal(dailyHuntsCompleted({}, '2026-06-13'), 0);
        assert.equal(dailyHuntsCompleted({ lastHuntReset: '2026-06-12', dailyHuntsCompleted: 19 }, '2026-06-13'), 0); // stale day → reset
        assert.equal(dailyHuntsCompleted({ lastHuntReset: '2026-06-13', dailyHuntsCompleted: 19 }, '2026-06-13'), 19);
        assert.ok(hasDailyHuntSlot({ lastHuntReset: '2026-06-13', dailyHuntsCompleted: 19 }, '2026-06-13'));
        assert.ok(!hasDailyHuntSlot({ lastHuntReset: '2026-06-13', dailyHuntsCompleted: 20 }, '2026-06-13'));
        // Mission counter does NOT consume hunt slots (separate pools).
        assert.ok(hasDailyHuntSlot({ lastDailyReset: '2026-06-13', dailyMissionsCompleted: 20 }, '2026-06-13'));
    });

    it('dailyHuntCap adds +1 per Hunter Rank (20 base → 25 at Warden), clamped to 0..5', () => {
        assert.equal(dailyHuntCap({}), 20);                       // no rank
        assert.equal(dailyHuntCap({ hunterRank: 0 }), 20);
        assert.equal(dailyHuntCap({ hunterRank: 3 }), 23);
        assert.equal(dailyHuntCap({ hunterRank: 5 }), 25);        // Chakra Beast Warden
        assert.equal(dailyHuntCap({ hunterRank: 99 }), 25);       // clamped to the 5-rank ladder
        assert.equal(dailyHuntCap({ hunterRank: -3 }), 20);       // clamped up
        // A rank-5 hunter gets 5 extra slots past the base cap.
        assert.ok(hasDailyHuntSlot({ lastHuntReset: '2026-06-13', dailyHuntsCompleted: 24, hunterRank: 5 }, '2026-06-13'));
        assert.ok(!hasDailyHuntSlot({ lastHuntReset: '2026-06-13', dailyHuntsCompleted: 25, hunterRank: 5 }, '2026-06-13'));
        assert.ok(!hasDailyHuntSlot({ lastHuntReset: '2026-06-13', dailyHuntsCompleted: 20, hunterRank: 0 }, '2026-06-13'));
    });

    it('markHuntCompletedFields bumps the hunt counter + clan/lifetime totals, stamps day/month', () => {
        const fields = markHuntCompletedFields({ lastHuntReset: '2026-06-13', dailyHuntsCompleted: 4, totalMissionsCompleted: 10, clanMissionContrib: 2, clanContribMonth: '2026-06' }, '2026-06-13', '2026-06');
        assert.equal(fields.totalMissionsCompleted, 11);
        assert.equal(fields.dailyHuntsCompleted, 5);
        assert.equal(fields.clanMissionContrib, 3);
        assert.equal(fields.lastHuntReset, '2026-06-13');
        assert.equal(fields.clanContribMonth, '2026-06');
    });
});

describe('reward application helpers', () => {
    it('server and combat-card stat points agree on exactly one point', () => {
        assert.equal(COMBAT_MISSION_STAT_POINTS, 1);
        const client = readFileSync('shinobij.client/src/constants/game.ts', 'utf8');
        const display = /export const COMBAT_MISSION_STAT_POINTS = (\d+);/.exec(client);
        assert.ok(display);
        assert.equal(Number(display[1]), COMBAT_MISSION_STAT_POINTS);
    });
    it('grantItemsToInventory appends literal item ids, dropping blanks/non-strings', () => {
        assert.deepEqual(grantItemsToInventory({ inventory: ['a'] }, ['x', 'y']), ['a', 'x', 'y']);
        assert.deepEqual(grantItemsToInventory({}, ['x']), ['x']);
        assert.deepEqual(grantItemsToInventory({ inventory: ['a'] }, undefined), ['a']);
        assert.deepEqual(grantItemsToInventory({ inventory: [] }, ['x', '', 'y']), ['x', 'y']);
    });

    it('grantItemsToCharacter stacks every hunt material a contract pays (owner ruling A12)', () => {
        const dragon = huntMissionById('hunt-worldstorm-dragon')!;
        const granted = grantItemsToCharacter({ inventory: ['rustfang-kunai', 'hunt-legendary-material'], itemStacks: [{ itemId: 'hunt-titan-bone', count: 3 }] }, dragon.itemRewards);
        assert.deepEqual(granted.inventory, ['rustfang-kunai'], 'no hunt material takes an inventory slot, and the legacy copy folds');
        const stacks = granted.itemStacks as Array<{ itemId: string; count: number }>;
        const units = (id: string) => stacks.find((s) => s.itemId === id)?.count ?? 0;
        const paid = (id: string) => (dragon.itemRewards ?? []).filter((r) => r === id).length;
        assert.equal(units('hunt-legendary-material'), 1 + paid('hunt-legendary-material'));
        assert.equal(units('hunt-titan-bone'), 3 + paid('hunt-titan-bone'));
        // Every hunt in the catalog pays only stackable materials.
        for (const id of HUNT_MISSION_IDS) {
            const out = grantItemsToCharacter({ inventory: [] }, huntMissionById(id)?.itemRewards);
            assert.deepEqual(out.inventory, [], id);
        }
        assert.deepEqual(grantItemsToCharacter({ inventory: ['a'] }, ['b']).inventory, ['a', 'b'], 'a non-material still lands in inventory[]');
    });

    it('applyCurrencyRewardFields adds only positive amounts onto existing balances', () => {
        const fields = applyCurrencyRewardFields({ boneCharms: 5, auraDust: 1 }, { boneCharms: 2, auraDust: 20, fateShards: 0 });
        assert.deepEqual(fields, { boneCharms: 7, auraDust: 21 });
        assert.deepEqual(applyCurrencyRewardFields({}, undefined), {});
    });

    it('keeps every normal mission Territory Scroll reward disabled', () => {
        assert.equal(FIELD_MISSION_SCROLLS, 0);
        assert.equal(HUNT_MISSION_SCROLLS, 0);
        assert.ok(COMBAT_MISSIONS.every((mission) => mission.territoryScrolls === 0));
    });
});

describe('hunt and fetch-S chance drops (owner rulings A2 / A3)', () => {
    const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
    const HOUR = 3_600_000;
    const veteran = (level: number, extra: Record<string, unknown> = {}) => ({ level, createdAt: NOW - 30 * 24 * HOUR, ...extra });
    // A scripted roll: records each call and answers from the queue.
    const rolls = (...values: number[]) => {
        const calls: number[] = [];
        return { calls, roll: () => { const v = values[calls.length] ?? 0; calls.push(v); return v; } };
    };
    const drop = (char: Record<string, unknown>, missionType: 'hunt' | 'field', missionId: string, roll: () => number) =>
        missionDropCurrency({ char, missionType, missionId, now: NOW, roll, fsChance: 0.25, asChance: 0.2 });

    it('the chance dials default to 0.25 / 0.2 and clamp to [0, 1]', () => {
        const prior = [process.env.HUNT_FS_CHANCE, process.env.HUNT_AS_CHANCE];
        try {
            delete process.env.HUNT_FS_CHANCE; delete process.env.HUNT_AS_CHANCE;
            assert.equal(huntFsChance(), HUNT_FS_CHANCE_DEFAULT);
            assert.equal(huntAsChance(), HUNT_AS_CHANCE_DEFAULT);
            assert.deepEqual([HUNT_FS_CHANCE_DEFAULT, HUNT_AS_CHANCE_DEFAULT], [0.25, 0.2]);
            process.env.HUNT_FS_CHANCE = '0'; process.env.HUNT_AS_CHANCE = '1';
            assert.equal(huntFsChance(), 0);
            assert.equal(huntAsChance(), 1);
            process.env.HUNT_FS_CHANCE = '1.5'; process.env.HUNT_AS_CHANCE = '-0.1';
            assert.equal(huntFsChance(), HUNT_FS_CHANCE_DEFAULT, 'out of range reads as the default');
            assert.equal(huntAsChance(), HUNT_AS_CHANCE_DEFAULT);
        } finally {
            if (prior[0] === undefined) delete process.env.HUNT_FS_CHANCE; else process.env.HUNT_FS_CHANCE = prior[0];
            if (prior[1] === undefined) delete process.env.HUNT_AS_CHANCE; else process.env.HUNT_AS_CHANCE = prior[1];
        }
    });

    it('a hunt claim from L20 drops a Fate Shard when the roll is under 25%', () => {
        assert.deepEqual(drop(veteran(20), 'hunt', 'hunt-wild-boar', () => 2_499), { fateShards: 1 });
        assert.deepEqual(drop(veteran(20), 'hunt', 'hunt-wild-boar', () => 2_500), {});
        const l19 = rolls(0);
        assert.deepEqual(drop(veteran(19), 'hunt', 'hunt-wild-boar', l19.roll), {});
        assert.equal(l19.calls.length, 0, 'an ineligible claim never rolls');
    });

    it('there is no daily cap: every claim rolls on its own', () => {
        for (let i = 0; i < 30; i += 1) assert.deepEqual(drop(veteran(40), 'hunt', 'hunt-frost-wolf', () => 0), { fateShards: 1 });
    });

    it('has no separate account-age gate: L20 is the established line, so a fresh L20+ account rolls', () => {
        assert.deepEqual(drop(veteran(30, { createdAt: NOW - 1 * HOUR }), 'hunt', 'hunt-wild-boar', () => 0), { fateShards: 1 });
        assert.deepEqual(drop(veteran(19, { createdAt: NOW - 1 * HOUR }), 'hunt', 'hunt-wild-boar', () => 0), {});
        assert.deepEqual(drop({ level: 30 }, 'hunt', 'hunt-wild-boar', () => 0), { fateShards: 1 });
    });

    it('fetch-S rolls the Fate Shard; other fetch work and Aura Stones do not', () => {
        assert.deepEqual(drop(veteran(70), 'field', FETCH_S_MISSION_ID, () => 0), { fateShards: 1 }, 'fetch-S never rolls an Aura Stone');
        const fetchD = rolls(0, 0);
        assert.deepEqual(drop(veteran(70), 'field', 'fetch-d-supply-trail', fetchD.roll), {});
        assert.equal(fetchD.calls.length, 0);
    });

    it('a hunt claim from L50 also rolls an Aura Stone at 20%, with no account-age gate', () => {
        assert.deepEqual(drop(veteran(50), 'hunt', 'hunt-ember-drake', rolls(9_999, 1_999).roll), { auraStones: 1 });
        assert.deepEqual(drop(veteran(50), 'hunt', 'hunt-ember-drake', rolls(9_999, 2_000).roll), {});
        assert.deepEqual(drop(veteran(49), 'hunt', 'hunt-ember-drake', rolls(9_999, 0).roll), {}, 'L49 rolls no Aura Stone');
        assert.deepEqual(drop(veteran(60, { createdAt: NOW - HOUR }), 'hunt', 'hunt-ember-drake', rolls(0, 0).roll), { fateShards: 1, auraStones: 1 }, 'a fresh L60 account rolls both');
        assert.deepEqual(drop(veteran(90), 'hunt', 'hunt-ancient-chakra-beast', () => 0), { fateShards: 1, auraStones: 1 });
    });

    it('a chance of 0 never drops and 1 always does', () => {
        const never = missionDropCurrency({ char: veteran(90), missionType: 'hunt', missionId: 'hunt-wild-boar', now: NOW, roll: () => 0, fsChance: 0, asChance: 0 });
        assert.deepEqual(never, {});
        const always = missionDropCurrency({ char: veteran(90), missionType: 'hunt', missionId: 'hunt-wild-boar', now: NOW, roll: () => DROP_ROLL_SCALE - 1, fsChance: 1, asChance: 1 });
        assert.deepEqual(always, { fateShards: 1, auraStones: 1 });
    });

    it('withMissionDrops returns a new map and leaves the catalog row untouched', () => {
        const row = fieldMissionById('hunt-ancient-chakra-beast')!;
        const before = structuredClone(row.currencyRewards);
        const merged = withMissionDrops(row.currencyRewards, { fateShards: 1, auraStones: 1 });
        assert.deepEqual(merged, { boneCharms: 2, auraDust: 40, fateShards: 1, auraStones: 1 });
        assert.notEqual(merged, row.currencyRewards);
        assert.deepEqual(row.currencyRewards, before);
        assert.deepEqual(withMissionDrops(undefined, {}), {});
    });
});
