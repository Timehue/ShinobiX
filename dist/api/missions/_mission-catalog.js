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
exports.HUNT_MISSION_IDS = exports.ACADEMY_TRIAL = exports.FIELD_MISSIONS = exports.COMBAT_MISSIONS = exports.CURRENCY_KEYS = exports.HUNT_MISSION_SCROLLS = exports.FIELD_MISSION_SCROLLS = exports.VILLAGE_UPGRADE_MAX_LEVEL = exports.DAILY_HUNT_LIMIT = exports.DAILY_MISSION_LIMIT = exports.AURA_SPHERE_ITEM_ID = exports.TERRITORY_CONTROL_SCROLL_ID = void 0;
exports.combatMissionByKey = combatMissionByKey;
exports.fieldMissionById = fieldMissionById;
exports.huntMissionById = huntMissionById;
exports.missionRewardBonusPct = missionRewardBonusPct;
exports.boostAmount = boostAmount;
exports.dailyMissionsCompleted = dailyMissionsCompleted;
exports.hasDailyMissionSlot = hasDailyMissionSlot;
exports.dailyHuntsCompleted = dailyHuntsCompleted;
exports.hasDailyHuntSlot = hasDailyHuntSlot;
exports.markHuntCompletedFields = markHuntCompletedFields;
exports.markMissionCompletedFields = markMissionCompletedFields;
exports.applyCurrencyRewardFields = applyCurrencyRewardFields;
exports.grantTerritoryScrollsToInventory = grantTerritoryScrollsToInventory;
exports.grantItemsToInventory = grantItemsToInventory;
exports.TERRITORY_CONTROL_SCROLL_ID = 'territory-control-scroll';
exports.AURA_SPHERE_ITEM_ID = 'aura-sphere';
exports.DAILY_MISSION_LIMIT = 20;
// Hunter Guild contracts use a daily pool independent of missions (own counter
// + reset key), so 20 hunts and 20 missions can be done in the same day. Mirror
// of constants/game.ts DAILY_HUNT_LIMIT. (audit M-1)
exports.DAILY_HUNT_LIMIT = 20;
exports.VILLAGE_UPGRADE_MAX_LEVEL = 50;
// Field missions always grant a flat 3 Territory Control Scrolls on claim
// (matches Logbook.claimMission's grantTerritoryScrolls(..., 3)). Hunts grant
// the same flat 3 (matches HunterBoard.claimHunt's grantTerritoryScrolls(..., 3)).
exports.FIELD_MISSION_SCROLLS = 3;
exports.HUNT_MISSION_SCROLLS = 3;
exports.CURRENCY_KEYS = [
    'fateShards', 'honorSeals', 'boneCharms', 'auraStones', 'auraDust', 'mythicSeals',
];
// ── COMBAT_MISSIONS — mirror of data/combat-missions.ts ─────────────────────
exports.COMBAT_MISSIONS = [
    { key: 'combat-e-drill', min: 1, xp: 15, ryo: 10, territoryScrolls: 1, aiProfileId: 'builtin-ai-academy-sparring' },
    { key: 'combat-d-errand', min: 5, xp: 25, ryo: 20, territoryScrolls: 1, aiProfileId: 'builtin-ai-mist-sentinel' },
    { key: 'combat-c-patrol', min: 15, xp: 75, ryo: 60, territoryScrolls: 1, aiProfileId: 'builtin-ai-ember-duelist' },
    { key: 'combat-b-escort', min: 30, xp: 150, ryo: 125, territoryScrolls: 1, aiProfileId: 'builtin-ai-frost-sealer' },
    { key: 'combat-a-hunt', min: 50, xp: 300, ryo: 250, territoryScrolls: 1, aiProfileId: 'builtin-ai-shadow-weaver' },
    { key: 'combat-s-crisis', min: 70, xp: 700, ryo: 600, territoryScrolls: 1, aiProfileId: 'builtin-ai-central-champion' },
];
// ── FIELD_MISSIONS — mirror of data/missions.ts (hunt + fetch builtins) ──────
// hunt-* entries carry itemRewards (Hunter-Guild materials) and are claimed via
// the 'hunt' missionType (own daily cap); fetch-* entries via 'field'.
exports.FIELD_MISSIONS = [
    // builtinHuntMissions
    { id: 'hunt-wild-boar', levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, itemRewards: ['hunt-beast-meat', 'hunt-beast-meat', 'hunt-torn-hide'] },
    { id: 'hunt-forest-hawk', levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, itemRewards: ['hunt-beast-meat', 'hunt-wild-feather', 'hunt-small-fang'] },
    { id: 'hunt-frost-wolf', levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, itemRewards: ['hunt-wolf-fang', 'hunt-wolf-fang', 'hunt-frost-pelt'] },
    { id: 'hunt-ash-lizard', levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, itemRewards: ['hunt-ash-scale', 'hunt-ash-scale', 'hunt-cracked-horn'] },
    { id: 'hunt-shadow-panther', levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 }, itemRewards: ['hunt-shadow-pelt', 'hunt-shadow-claw', 'hunt-shadow-claw'] },
    { id: 'hunt-ironback-bear', levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 }, itemRewards: ['hunt-beast-meat', 'hunt-beast-meat', 'hunt-cracked-horn', 'hunt-cracked-horn'] },
    { id: 'hunt-ember-drake', levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 }, itemRewards: ['hunt-ash-scale', 'hunt-ash-scale', 'hunt-ember-scale', 'hunt-wolf-fang'] },
    { id: 'hunt-moon-serpent', levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 }, itemRewards: ['hunt-shadow-pelt', 'hunt-shadow-pelt', 'hunt-shadow-claw', 'hunt-shadow-claw'] },
    { id: 'hunt-ancient-chakra-beast', levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 }, itemRewards: ['hunt-legendary-material', 'hunt-legendary-material', 'hunt-ancient-beast-core'] },
    { id: 'hunt-worldstorm-dragon', levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 }, itemRewards: ['hunt-legendary-material', 'hunt-legendary-material', 'hunt-titan-bone'] },
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
// The built-in hunt ids (every FIELD_MISSIONS entry that carries itemRewards).
// The 'hunt' claim path resolves rewards through fieldMissionById but only for
// ids in this set, so a fetch mission can't be claimed against the hunt cap.
exports.HUNT_MISSION_IDS = new Set(exports.FIELD_MISSIONS.filter((m) => Array.isArray(m.itemRewards)).map((m) => m.id));
function huntMissionById(id) {
    return exports.HUNT_MISSION_IDS.has(id) ? fieldMissionById(id) : undefined;
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
// ── Hunt daily-cap accounting — mirror of character-progress.ts (hunt pool).
//    The hunt cap lives on its own counter (dailyHuntsCompleted + lastHuntReset),
//    independent of the mission cap. (audit M-1)
function dailyHuntsCompleted(char, todayKey) {
    return char.lastHuntReset === todayKey ? Number(char.dailyHuntsCompleted ?? 0) : 0;
}
function hasDailyHuntSlot(char, todayKey) {
    return dailyHuntsCompleted(char, todayKey) < exports.DAILY_HUNT_LIMIT;
}
// Mirror of character-progress.markHuntCompleted — caller spreads these onto the
// char. Bumps the clan/lifetime aggregates like a mission, plus the hunt counter.
function markHuntCompletedFields(char, todayKey, monthKey) {
    return {
        clanMissionContrib: Number(char.clanMissionContrib ?? 0) + 1,
        totalMissionsCompleted: Number(char.totalMissionsCompleted ?? 0) + 1,
        dailyHuntsCompleted: dailyHuntsCompleted(char, todayKey) + 1,
        lastHuntReset: todayKey,
        clanContribMonth: monthKey,
    };
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
// Append literal item ids (e.g. hunt material drops) onto the inventory array.
function grantItemsToInventory(char, items) {
    const inventory = Array.isArray(char.inventory) ? char.inventory : [];
    const add = Array.isArray(items) ? items.filter((i) => typeof i === 'string' && !!i) : [];
    return [...inventory, ...add];
}
