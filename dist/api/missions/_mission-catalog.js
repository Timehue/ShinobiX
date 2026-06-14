"use strict";
// Server-authoritative mission reward catalog + the small pure reward helpers
// the claim endpoint needs. This is the trusted source of payout values for the
// built-in missions; the client never sends reward amounts.
//
// VERBATIM MIRROR of the client data — keep in lockstep:
//   • COMBAT_MISSIONS  ← shinobij.client/src/data/combat-missions.ts
//   • FIELD_MISSIONS    ← shinobij.client/src/data/missions.ts
//                         (builtinHuntMissions + builtinFetchMissions)
//   • the reward-bonus math ← shinobij.client/src/lib/{village-upgrades,
//                              aura-sphere}.ts (missionHall upgrade + aura sphere)
//   • TERRITORY_CONTROL_SCROLL_ID / DAILY_MISSION_LIMIT / AURA_SPHERE_ITEM_ID
//                         ← shinobij.client/src/constants/game.ts
// The colocated _mission-catalog.test.ts pins these against an inline replica;
// a drift on either side must change both (that's the point).
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACADEMY_TRIAL = exports.FIELD_MISSIONS = exports.COMBAT_MISSIONS = exports.CURRENCY_KEYS = exports.FIELD_MISSION_SCROLLS = exports.VILLAGE_UPGRADE_MAX_LEVEL = exports.DAILY_MISSION_LIMIT = exports.AURA_SPHERE_ITEM_ID = exports.TERRITORY_CONTROL_SCROLL_ID = void 0;
exports.combatMissionByKey = combatMissionByKey;
exports.fieldMissionById = fieldMissionById;
exports.missionRewardBonusPct = missionRewardBonusPct;
exports.boostAmount = boostAmount;
exports.dailyMissionsCompleted = dailyMissionsCompleted;
exports.hasDailyMissionSlot = hasDailyMissionSlot;
exports.markMissionCompletedFields = markMissionCompletedFields;
exports.applyCurrencyRewardFields = applyCurrencyRewardFields;
exports.grantTerritoryScrollsToInventory = grantTerritoryScrollsToInventory;
exports.TERRITORY_CONTROL_SCROLL_ID = 'territory-control-scroll';
exports.AURA_SPHERE_ITEM_ID = 'aura-sphere';
exports.DAILY_MISSION_LIMIT = 20;
exports.VILLAGE_UPGRADE_MAX_LEVEL = 50;
// Field missions always grant a flat 3 Territory Control Scrolls on claim
// (matches Logbook.claimMission's grantTerritoryScrolls(..., 3)).
exports.FIELD_MISSION_SCROLLS = 3;
exports.CURRENCY_KEYS = [
    'fateShards', 'honorSeals', 'boneCharms', 'auraStones', 'auraDust', 'mythicSeals',
];
// ── COMBAT_MISSIONS — mirror of data/combat-missions.ts ─────────────────────
exports.COMBAT_MISSIONS = [
    { key: 'combat-d-errand', min: 1, xp: 25, ryo: 20, territoryScrolls: 1, aiProfileId: 'builtin-ai-mist-sentinel' },
    { key: 'combat-c-patrol', min: 10, xp: 75, ryo: 60, territoryScrolls: 1, aiProfileId: 'builtin-ai-ember-duelist' },
    { key: 'combat-b-escort', min: 30, xp: 150, ryo: 125, territoryScrolls: 1, aiProfileId: 'builtin-ai-frost-sealer' },
    { key: 'combat-a-hunt', min: 50, xp: 300, ryo: 250, territoryScrolls: 1, aiProfileId: 'builtin-ai-shadow-weaver' },
    { key: 'combat-s-crisis', min: 70, xp: 700, ryo: 600, territoryScrolls: 1, aiProfileId: 'builtin-ai-central-champion' },
];
// ── FIELD_MISSIONS — mirror of data/missions.ts (hunt + fetch builtins) ──────
exports.FIELD_MISSIONS = [
    // builtinHuntMissions
    { id: 'hunt-wild-boar', levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8 },
    { id: 'hunt-forest-hawk', levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8 },
    { id: 'hunt-frost-wolf', levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12 },
    { id: 'hunt-ash-lizard', levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12 },
    { id: 'hunt-shadow-panther', levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 } },
    { id: 'hunt-ironback-bear', levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 } },
    { id: 'hunt-ember-drake', levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 } },
    { id: 'hunt-moon-serpent', levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 } },
    { id: 'hunt-ancient-chakra-beast', levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 } },
    { id: 'hunt-worldstorm-dragon', levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 } },
    // builtinFetchMissions
    { id: 'fetch-d-supply-trail', levelReq: 1, xpReward: 90, ryoReward: 75, staminaReward: 8 },
    { id: 'fetch-c-border-scout', levelReq: 15, xpReward: 240, ryoReward: 190, staminaReward: 14 },
    { id: 'fetch-b-enemy-cache', levelReq: 30, xpReward: 520, ryoReward: 420, staminaReward: 22, currencyRewards: { boneCharms: 1 } },
    { id: 'fetch-a-black-route', levelReq: 50, xpReward: 1100, ryoReward: 900, staminaReward: 32, currencyRewards: { boneCharms: 2, auraDust: 20 } },
    { id: 'fetch-s-shadow-front', levelReq: 70, xpReward: 2400, ryoReward: 2100, staminaReward: 45, currencyRewards: { boneCharms: 3, auraDust: 45, fateShards: 1 } },
];
// ── Academy Trial — the one-time onboarding mission (no client equivalent) ───
// Tiny, off the daily cap, one-time (gated by character.academyTrialClaimed).
// No premium currency, no territory scrolls.
exports.ACADEMY_TRIAL = {
    id: 'academy-trial',
    xp: 40,
    ryo: 30,
    stamina: 5,
};
function combatMissionByKey(key) {
    return exports.COMBAT_MISSIONS.find((m) => m.key === key);
}
function fieldMissionById(id) {
    return exports.FIELD_MISSIONS.find((m) => m.id === id);
}
function missionHallBonusPct(char) {
    const upgrades = char.villageUpgrades ?? {};
    const raw = Math.floor(Number(upgrades.missionHall ?? 0));
    const level = Math.min(exports.VILLAGE_UPGRADE_MAX_LEVEL, Math.max(0, Number.isFinite(raw) ? raw : 0));
    return level * 0.5;
}
function auraSphereMissionPct(char) {
    const equipment = char.equipment ?? {};
    const equipped = equipment.aura === exports.AURA_SPHERE_ITEM_ID || equipment.accessory === exports.AURA_SPHERE_ITEM_ID;
    if (!equipped)
        return 0;
    const level = Math.max(1, Math.floor(Number(char.auraSphereLevel ?? 1)));
    if (level >= 100)
        return 1;
    if (level >= 50)
        return 2;
    return 0;
}
function missionRewardBonusPct(char) {
    return missionHallBonusPct(char) + auraSphereMissionPct(char);
}
// boostAmount — verbatim from village-upgrades.ts.
function boostAmount(amount, percent) {
    return Math.max(0, Math.floor(amount * (1 + percent / 100)));
}
// ── Daily-cap accounting — mirror of character-progress.ts. The cap lives on
//    the character (dailyMissionsCompleted + lastDailyReset), so the server
//    enforces it straight off the saved character. `todayKey` = UTC YYYY-MM-DD.
function dailyMissionsCompleted(char, todayKey) {
    return char.lastDailyReset === todayKey ? Number(char.dailyMissionsCompleted ?? 0) : 0;
}
function hasDailyMissionSlot(char, todayKey) {
    return dailyMissionsCompleted(char, todayKey) < exports.DAILY_MISSION_LIMIT;
}
// Returns the character fields that markMissionCompleted bumps (mirror of
// character-progress.markMissionCompleted) — caller spreads these onto the char.
function markMissionCompletedFields(char, todayKey, monthKey) {
    return {
        clanMissionContrib: Number(char.clanMissionContrib ?? 0) + 1,
        totalMissionsCompleted: Number(char.totalMissionsCompleted ?? 0) + 1,
        dailyMissionsCompleted: dailyMissionsCompleted(char, todayKey) + 1,
        lastDailyReset: todayKey,
        clanContribMonth: monthKey,
    };
}
// Apply currency rewards onto a character (mirror of currency.applyCurrencyRewards).
function applyCurrencyRewardFields(char, rewards) {
    const out = {};
    if (!rewards)
        return out;
    for (const key of exports.CURRENCY_KEYS) {
        const amount = Math.max(0, Math.floor(Number(rewards[key] ?? 0)));
        if (amount > 0)
            out[key] = Number(char[key] ?? 0) + amount;
    }
    return out;
}
// Push `count` territory scrolls onto the character's inventory array.
function grantTerritoryScrollsToInventory(char, count) {
    const inventory = Array.isArray(char.inventory) ? char.inventory : [];
    const n = Math.max(0, Math.floor(count));
    return [...inventory, ...Array.from({ length: n }, () => exports.TERRITORY_CONTROL_SCROLL_ID)];
}
