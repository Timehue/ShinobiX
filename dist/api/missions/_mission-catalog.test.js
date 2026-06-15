"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _mission_catalog_js_1 = require("./_mission-catalog.js");
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
    { id: 'hunt-wild-boar', levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, currencyRewards: {}, itemRewards: ['hunt-beast-meat', 'hunt-beast-meat', 'hunt-torn-hide'] },
    { id: 'hunt-forest-hawk', levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, currencyRewards: {}, itemRewards: ['hunt-beast-meat', 'hunt-wild-feather', 'hunt-small-fang'] },
    { id: 'hunt-frost-wolf', levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, currencyRewards: {}, itemRewards: ['hunt-wolf-fang', 'hunt-wolf-fang', 'hunt-frost-pelt'] },
    { id: 'hunt-ash-lizard', levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, currencyRewards: {}, itemRewards: ['hunt-ash-scale', 'hunt-ash-scale', 'hunt-cracked-horn'] },
    { id: 'hunt-shadow-panther', levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 }, itemRewards: ['hunt-shadow-pelt', 'hunt-shadow-claw', 'hunt-shadow-claw'] },
    { id: 'hunt-ironback-bear', levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 }, itemRewards: ['hunt-beast-meat', 'hunt-beast-meat', 'hunt-cracked-horn', 'hunt-cracked-horn'] },
    { id: 'hunt-ember-drake', levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 }, itemRewards: ['hunt-ash-scale', 'hunt-ash-scale', 'hunt-ember-scale', 'hunt-wolf-fang'] },
    { id: 'hunt-moon-serpent', levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 }, itemRewards: ['hunt-shadow-pelt', 'hunt-shadow-pelt', 'hunt-shadow-claw', 'hunt-shadow-claw'] },
    { id: 'hunt-ancient-chakra-beast', levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 }, itemRewards: ['hunt-legendary-material', 'hunt-legendary-material', 'hunt-ancient-beast-core'] },
    { id: 'hunt-worldstorm-dragon', levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 }, itemRewards: ['hunt-legendary-material', 'hunt-legendary-material', 'hunt-titan-bone'] },
    { id: 'fetch-d-supply-trail', levelReq: 1, xpReward: 90, ryoReward: 75, staminaReward: 8, currencyRewards: {} },
    { id: 'fetch-c-border-scout', levelReq: 15, xpReward: 240, ryoReward: 190, staminaReward: 14, currencyRewards: {} },
    { id: 'fetch-b-enemy-cache', levelReq: 30, xpReward: 520, ryoReward: 420, staminaReward: 22, currencyRewards: { boneCharms: 1 } },
    { id: 'fetch-a-black-route', levelReq: 50, xpReward: 1100, ryoReward: 900, staminaReward: 32, currencyRewards: { boneCharms: 2, auraDust: 20 } },
    { id: 'fetch-s-shadow-front', levelReq: 70, xpReward: 2400, ryoReward: 2100, staminaReward: 45, currencyRewards: { boneCharms: 3, auraDust: 45, fateShards: 1 } },
];
(0, node_test_1.describe)('mission catalog matches the client reward tables', () => {
    (0, node_test_1.it)('COMBAT_MISSIONS — same set, same rewards, same AI', () => {
        node_assert_1.strict.equal(_mission_catalog_js_1.COMBAT_MISSIONS.length, C_COMBAT.length);
        for (const want of C_COMBAT) {
            const got = (0, _mission_catalog_js_1.combatMissionByKey)(want.key);
            node_assert_1.strict.ok(got, `missing combat mission ${want.key}`);
            node_assert_1.strict.deepEqual(got, want, `combat mission ${want.key}`);
        }
    });
    (0, node_test_1.it)('FIELD_MISSIONS — same set, same rewards (incl. currency)', () => {
        node_assert_1.strict.equal(_mission_catalog_js_1.FIELD_MISSIONS.length, C_FIELD.length);
        for (const want of C_FIELD) {
            const got = (0, _mission_catalog_js_1.fieldMissionById)(want.id);
            node_assert_1.strict.ok(got, `missing field mission ${want.id}`);
            node_assert_1.strict.equal(got.levelReq, want.levelReq, `${want.id} levelReq`);
            node_assert_1.strict.equal(got.xpReward, want.xpReward, `${want.id} xpReward`);
            node_assert_1.strict.equal(got.ryoReward, want.ryoReward, `${want.id} ryoReward`);
            node_assert_1.strict.equal(got.staminaReward, want.staminaReward, `${want.id} staminaReward`);
            node_assert_1.strict.deepEqual(got.currencyRewards ?? {}, want.currencyRewards, `${want.id} currency`);
            node_assert_1.strict.deepEqual(got.itemRewards ?? [], want.itemRewards ?? [], `${want.id} itemRewards`);
        }
    });
    (0, node_test_1.it)('HUNT_MISSION_IDS = exactly the hunt-* entries (those carrying itemRewards)', () => {
        const huntIds = C_FIELD.filter((m) => Array.isArray(m.itemRewards)).map((m) => m.id);
        node_assert_1.strict.equal(_mission_catalog_js_1.HUNT_MISSION_IDS.size, huntIds.length);
        for (const id of huntIds)
            node_assert_1.strict.ok(_mission_catalog_js_1.HUNT_MISSION_IDS.has(id), `HUNT_MISSION_IDS missing ${id}`);
        // huntMissionById resolves hunts but NOT fetches (so a fetch id can't be
        // claimed against the hunt cap).
        node_assert_1.strict.ok((0, _mission_catalog_js_1.huntMissionById)('hunt-wild-boar'), 'hunt resolves');
        node_assert_1.strict.equal((0, _mission_catalog_js_1.huntMissionById)('fetch-d-supply-trail'), undefined, 'fetch is not a hunt');
        node_assert_1.strict.equal((0, _mission_catalog_js_1.huntMissionById)('nope'), undefined, 'unknown is not a hunt');
    });
    (0, node_test_1.it)('Academy Trial is tiny, one-time, no premium currency', () => {
        node_assert_1.strict.equal(_mission_catalog_js_1.ACADEMY_TRIAL.id, 'academy-trial');
        node_assert_1.strict.ok(_mission_catalog_js_1.ACADEMY_TRIAL.xp > 0 && _mission_catalog_js_1.ACADEMY_TRIAL.xp <= 100);
        node_assert_1.strict.ok(_mission_catalog_js_1.ACADEMY_TRIAL.ryo > 0 && _mission_catalog_js_1.ACADEMY_TRIAL.ryo <= 100);
    });
});
(0, node_test_1.describe)('reward-bonus math mirrors the client', () => {
    (0, node_test_1.it)('boostAmount = floor(amount * (1 + pct/100)), never negative', () => {
        node_assert_1.strict.equal((0, _mission_catalog_js_1.boostAmount)(100, 0), 100);
        node_assert_1.strict.equal((0, _mission_catalog_js_1.boostAmount)(100, 5), 105);
        node_assert_1.strict.equal((0, _mission_catalog_js_1.boostAmount)(80, 2.5), 82); // floor(80 * 1.025) = floor(82) = 82
        node_assert_1.strict.equal((0, _mission_catalog_js_1.boostAmount)(25, 7.5), 26); // floor(25 * 1.075) = floor(26.875) = 26
        node_assert_1.strict.equal((0, _mission_catalog_js_1.boostAmount)(0, 50), 0);
    });
    (0, node_test_1.it)('missionRewardBonusPct = missionHall(level×0.5) + auraSphere(equipped)', () => {
        node_assert_1.strict.equal((0, _mission_catalog_js_1.missionRewardBonusPct)({}), 0);
        node_assert_1.strict.equal((0, _mission_catalog_js_1.missionRewardBonusPct)({ villageUpgrades: { missionHall: 10 } }), 5);
        // aura sphere only counts when equipped
        node_assert_1.strict.equal((0, _mission_catalog_js_1.missionRewardBonusPct)({ auraSphereLevel: 100 }), 0);
        node_assert_1.strict.equal((0, _mission_catalog_js_1.missionRewardBonusPct)({ auraSphereLevel: 100, equipment: { aura: 'aura-sphere' } }), 1);
        node_assert_1.strict.equal((0, _mission_catalog_js_1.missionRewardBonusPct)({ auraSphereLevel: 60, equipment: { accessory: 'aura-sphere' } }), 2);
        node_assert_1.strict.equal((0, _mission_catalog_js_1.missionRewardBonusPct)({ villageUpgrades: { missionHall: 20 }, auraSphereLevel: 100, equipment: { aura: 'aura-sphere' } }), 11);
        // missionHall clamps at 50
        node_assert_1.strict.equal((0, _mission_catalog_js_1.missionRewardBonusPct)({ villageUpgrades: { missionHall: 999 } }), 25);
    });
});
(0, node_test_1.describe)('daily-cap accounting matches character-progress.ts', () => {
    (0, node_test_1.it)('hasDailyMissionSlot honours the 20/day cap keyed on lastDailyReset', () => {
        node_assert_1.strict.equal(_mission_catalog_js_1.DAILY_MISSION_LIMIT, 20);
        node_assert_1.strict.equal((0, _mission_catalog_js_1.dailyMissionsCompleted)({}, '2026-06-13'), 0);
        node_assert_1.strict.equal((0, _mission_catalog_js_1.dailyMissionsCompleted)({ lastDailyReset: '2026-06-12', dailyMissionsCompleted: 19 }, '2026-06-13'), 0); // stale day → reset
        node_assert_1.strict.equal((0, _mission_catalog_js_1.dailyMissionsCompleted)({ lastDailyReset: '2026-06-13', dailyMissionsCompleted: 19 }, '2026-06-13'), 19);
        node_assert_1.strict.ok((0, _mission_catalog_js_1.hasDailyMissionSlot)({ lastDailyReset: '2026-06-13', dailyMissionsCompleted: 19 }, '2026-06-13'));
        node_assert_1.strict.ok(!(0, _mission_catalog_js_1.hasDailyMissionSlot)({ lastDailyReset: '2026-06-13', dailyMissionsCompleted: 20 }, '2026-06-13'));
    });
    (0, node_test_1.it)('markMissionCompletedFields bumps total + daily + clan, stamps day/month', () => {
        const fields = (0, _mission_catalog_js_1.markMissionCompletedFields)({ lastDailyReset: '2026-06-13', dailyMissionsCompleted: 4, totalMissionsCompleted: 10, clanMissionContrib: 2 }, '2026-06-13', '2026-06');
        node_assert_1.strict.equal(fields.totalMissionsCompleted, 11);
        node_assert_1.strict.equal(fields.dailyMissionsCompleted, 5);
        node_assert_1.strict.equal(fields.clanMissionContrib, 3);
        node_assert_1.strict.equal(fields.lastDailyReset, '2026-06-13');
        node_assert_1.strict.equal(fields.clanContribMonth, '2026-06');
    });
});
(0, node_test_1.describe)('hunt daily-cap accounting matches character-progress.ts (hunt pool)', () => {
    (0, node_test_1.it)('hasDailyHuntSlot honours the 20/day cap keyed on lastHuntReset (independent of missions)', () => {
        node_assert_1.strict.equal(_mission_catalog_js_1.DAILY_HUNT_LIMIT, 20);
        node_assert_1.strict.equal((0, _mission_catalog_js_1.dailyHuntsCompleted)({}, '2026-06-13'), 0);
        node_assert_1.strict.equal((0, _mission_catalog_js_1.dailyHuntsCompleted)({ lastHuntReset: '2026-06-12', dailyHuntsCompleted: 19 }, '2026-06-13'), 0); // stale day → reset
        node_assert_1.strict.equal((0, _mission_catalog_js_1.dailyHuntsCompleted)({ lastHuntReset: '2026-06-13', dailyHuntsCompleted: 19 }, '2026-06-13'), 19);
        node_assert_1.strict.ok((0, _mission_catalog_js_1.hasDailyHuntSlot)({ lastHuntReset: '2026-06-13', dailyHuntsCompleted: 19 }, '2026-06-13'));
        node_assert_1.strict.ok(!(0, _mission_catalog_js_1.hasDailyHuntSlot)({ lastHuntReset: '2026-06-13', dailyHuntsCompleted: 20 }, '2026-06-13'));
        // Mission counter does NOT consume hunt slots (separate pools).
        node_assert_1.strict.ok((0, _mission_catalog_js_1.hasDailyHuntSlot)({ lastDailyReset: '2026-06-13', dailyMissionsCompleted: 20 }, '2026-06-13'));
    });
    (0, node_test_1.it)('markHuntCompletedFields bumps the hunt counter + clan/lifetime totals, stamps day/month', () => {
        const fields = (0, _mission_catalog_js_1.markHuntCompletedFields)({ lastHuntReset: '2026-06-13', dailyHuntsCompleted: 4, totalMissionsCompleted: 10, clanMissionContrib: 2 }, '2026-06-13', '2026-06');
        node_assert_1.strict.equal(fields.totalMissionsCompleted, 11);
        node_assert_1.strict.equal(fields.dailyHuntsCompleted, 5);
        node_assert_1.strict.equal(fields.clanMissionContrib, 3);
        node_assert_1.strict.equal(fields.lastHuntReset, '2026-06-13');
        node_assert_1.strict.equal(fields.clanContribMonth, '2026-06');
    });
});
(0, node_test_1.describe)('reward application helpers', () => {
    (0, node_test_1.it)('grantItemsToInventory appends literal item ids, dropping blanks/non-strings', () => {
        node_assert_1.strict.deepEqual((0, _mission_catalog_js_1.grantItemsToInventory)({ inventory: ['a'] }, ['x', 'y']), ['a', 'x', 'y']);
        node_assert_1.strict.deepEqual((0, _mission_catalog_js_1.grantItemsToInventory)({}, ['x']), ['x']);
        node_assert_1.strict.deepEqual((0, _mission_catalog_js_1.grantItemsToInventory)({ inventory: ['a'] }, undefined), ['a']);
        node_assert_1.strict.deepEqual((0, _mission_catalog_js_1.grantItemsToInventory)({ inventory: [] }, ['x', '', 'y']), ['x', 'y']);
    });
    (0, node_test_1.it)('applyCurrencyRewardFields adds only positive amounts onto existing balances', () => {
        const fields = (0, _mission_catalog_js_1.applyCurrencyRewardFields)({ boneCharms: 5, auraDust: 1 }, { boneCharms: 2, auraDust: 20, fateShards: 0 });
        node_assert_1.strict.deepEqual(fields, { boneCharms: 7, auraDust: 21 });
        node_assert_1.strict.deepEqual((0, _mission_catalog_js_1.applyCurrencyRewardFields)({}, undefined), {});
    });
    (0, node_test_1.it)('grantTerritoryScrollsToInventory appends N scroll ids', () => {
        const inv = (0, _mission_catalog_js_1.grantTerritoryScrollsToInventory)({ inventory: ['x'] }, _mission_catalog_js_1.FIELD_MISSION_SCROLLS);
        node_assert_1.strict.equal(inv.length, 1 + _mission_catalog_js_1.FIELD_MISSION_SCROLLS);
        node_assert_1.strict.equal(inv.filter((i) => i === _mission_catalog_js_1.TERRITORY_CONTROL_SCROLL_ID).length, _mission_catalog_js_1.FIELD_MISSION_SCROLLS);
    });
});
