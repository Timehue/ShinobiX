// Server-authoritative mission reward catalog + the small pure reward helpers
// the claim endpoint needs. This is the trusted source of payout values for the
// built-in missions; the client never sends reward amounts.
//
// VERBATIM MIRROR of the client data â€” keep in lockstep:
//   â€¢ COMBAT_MISSIONS  â† shinobij.client/src/data/combat-missions.ts
//   â€¢ FIELD_MISSIONS    â† shinobij.client/src/data/missions.ts
//                         (builtinHuntMissions + builtinFetchMissions)
//   â€¢ the reward-bonus math â† shinobij.client/src/lib/{village-upgrades,
//                              aura-sphere}.ts (missionHall upgrade + aura sphere)
//   â€¢ DAILY_MISSION_LIMIT / AURA_SPHERE_ITEM_ID
//                         â† shinobij.client/src/constants/game.ts
// The colocated _mission-catalog.test.ts pins these against an inline replica,
// and scripts/mission-reward-parity.test.ts against the real client modules; a
// drift on either side must change both (that's the point).
import { economyDial } from '../_economy-dials.js';
import { advanceLastDailyReset } from '../_daily-reset-stamp.js';
import { grantItemIds } from '../../shared/stacked-materials.js';

export const AURA_SPHERE_ITEM_ID = 'aura-sphere';
export const DAILY_MISSION_LIMIT = 20;
// Hunter Guild contracts use a daily pool independent of missions (own counter
// + reset key), so 20 hunts and 20 missions can be done in the same day. Mirror
// of constants/game.ts DAILY_HUNT_LIMIT. (audit M-1)
export const DAILY_HUNT_LIMIT = 20;
export const VILLAGE_UPGRADE_MAX_LEVEL = 50;
// Retired reward fields kept at zero for rolling-deploy/API compatibility.
// Territory Control Scrolls are minted only by finalized Clan War shinobi PvP.
export const FIELD_MISSION_SCROLLS = 0;
export const HUNT_MISSION_SCROLLS = 0;

// â”€â”€ Mission stat grants (docs/leveling-without-xp-map.md Â§4) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Character XP is retired: every hunt and field claim pays stat-POOL points
// instead, boosted by the mission bonuses, and reserves them against the ONE
// shared daily stat-point budget (DAILY_STAT_POINT_CAP, default 60, owner ruling
// A1) that PvE and PvP wins also draw from; a claim pays what is left of it.
// Profession dailies stay on their own profession-XP track. Repeatable
// combat-mission slots pay ryo only. The one-time academy capstones below are
// outside the budget and unboosted.
export const FIELD_MISSION_STAT_POINTS = 3;
export const ACADEMY_TRIAL_STAT_POINTS = 5;
export const ACADEMY_CHECKLIST_STAT_POINTS = 10;

export const FETCH_S_MISSION_ID = 'fetch-s-shadow-front';

export type CurrencyKey = 'fateShards' | 'honorSeals' | 'boneCharms' | 'auraStones' | 'auraDust' | 'mythicSeals';
export const CURRENCY_KEYS: readonly CurrencyKey[] = [
    'fateShards', 'honorSeals', 'boneCharms', 'auraStones', 'auraDust', 'mythicSeals',
];

export type CombatMissionDef = {
    key: string;
    min: number;
    xp: number;
    ryo: number;
    territoryScrolls: number;
    aiProfileId: string;
};

export type FieldMissionDef = {
    id: string;
    targetSector: number;
    exploreCount: number;
    raidCount?: number;
    /** Server-authored outpost encounter. Never selected by the client. */
    raidAiProfileId?: string;
    aiProfileId?: string;
    levelReq: number;
    xpReward: number;
    ryoReward: number;
    staminaReward: number;
    currencyRewards?: Partial<Record<CurrencyKey, number>>;
    // Hunter-Guild material drops (used for Hunter-Rank advancement). Only the
    // hunt-* entries carry these; fetch missions grant none. Server-granted on
    // a 'hunt' claim so the materials can't be minted client-side (audit M-1).
    itemRewards?: string[];
};

// â”€â”€ COMBAT_MISSIONS â€” mirror of data/combat-missions.ts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Ryo re-tiered in the 2026-10 rebalance (framework #24) to 0.29-0.66x the
// anchor A(L) per 5-minute fight at the regular +10% bonus: a side loop that
// pays no stat points and shares the 20-claim cap with fetch work. `xp` is dead
// but stays: missionCombatRewardFingerprint hashes it.
export const COMBAT_MISSIONS: CombatMissionDef[] = [
    { key: 'combat-e-drill', min: 1, xp: 15, ryo: 40, territoryScrolls: 0, aiProfileId: 'builtin-ai-academy-sparring' },
    { key: 'combat-d-errand', min: 5, xp: 25, ryo: 80, territoryScrolls: 0, aiProfileId: 'builtin-ai-mist-sentinel' },
    { key: 'combat-c-patrol', min: 15, xp: 75, ryo: 200, territoryScrolls: 0, aiProfileId: 'builtin-ai-ember-duelist' },
    { key: 'combat-b-escort', min: 30, xp: 150, ryo: 380, territoryScrolls: 0, aiProfileId: 'builtin-ai-frost-sealer' },
    { key: 'combat-a-hunt', min: 50, xp: 300, ryo: 600, territoryScrolls: 0, aiProfileId: 'builtin-ai-shadow-weaver' },
    { key: 'combat-s-crisis', min: 70, xp: 700, ryo: 900, territoryScrolls: 0, aiProfileId: 'builtin-ai-central-champion' },
];

// â”€â”€ FIELD_MISSIONS â€” mirror of data/missions.ts (hunt + fetch builtins) â”€â”€â”€â”€â”€â”€
// hunt-* entries carry itemRewards (Hunter-Guild materials) and are claimed via
// the 'hunt' missionType (own daily cap); fetch-* entries via 'field'.
// 2026-10 rebalance: hunt contract ryo re-anchored to ~1.05-1.17x A(L) per
// 6-minute hunt with the kill purse (framework #5), fetch ryo to ~0.85x (#18),
// and the L50 / L70 hunt Bone Charms trimmed 2 -> 1 / 3 -> 2 (#16). The flat
// Fate Shard on the L70 hunts and fetch-S became the chance drop in
// missionDropCurrency below.
export const FIELD_MISSIONS: FieldMissionDef[] = [
    // builtinHuntMissions
    { id: 'hunt-wild-boar', targetSector: 25, exploreCount: 3, aiProfileId: 'hunt-ai-wild-boar', levelReq: 1, xpReward: 80, ryoReward: 280, staminaReward: 8, itemRewards: ['hunt-beast-meat', 'hunt-beast-meat', 'hunt-torn-hide'] },
    { id: 'hunt-forest-hawk', targetSector: 28, exploreCount: 3, aiProfileId: 'hunt-ai-forest-hawk', levelReq: 1, xpReward: 80, ryoReward: 280, staminaReward: 8, itemRewards: ['hunt-beast-meat', 'hunt-wild-feather', 'hunt-small-fang'] },
    { id: 'hunt-frost-wolf', targetSector: 50, exploreCount: 4, aiProfileId: 'hunt-ai-frost-wolf', levelReq: 15, xpReward: 200, ryoReward: 480, staminaReward: 12, itemRewards: ['hunt-wolf-fang', 'hunt-wolf-fang', 'hunt-frost-pelt'] },
    { id: 'hunt-ash-lizard', targetSector: 40, exploreCount: 4, aiProfileId: 'hunt-ai-ash-lizard', levelReq: 15, xpReward: 200, ryoReward: 480, staminaReward: 12, itemRewards: ['hunt-ash-scale', 'hunt-ash-scale', 'hunt-cracked-horn'] },
    { id: 'hunt-shadow-panther', targetSector: 12, exploreCount: 4, aiProfileId: 'hunt-ai-shadow-panther', levelReq: 30, xpReward: 420, ryoReward: 660, staminaReward: 20, currencyRewards: { boneCharms: 1 }, itemRewards: ['hunt-shadow-pelt', 'hunt-shadow-claw', 'hunt-shadow-claw'] },
    { id: 'hunt-ironback-bear', targetSector: 30, exploreCount: 5, aiProfileId: 'hunt-ai-ironback-bear', levelReq: 30, xpReward: 420, ryoReward: 660, staminaReward: 20, currencyRewards: { boneCharms: 1 }, itemRewards: ['hunt-beast-meat', 'hunt-beast-meat', 'hunt-cracked-horn', 'hunt-cracked-horn'] },
    { id: 'hunt-ember-drake', targetSector: 42, exploreCount: 5, aiProfileId: 'hunt-ai-ember-drake', levelReq: 50, xpReward: 900, ryoReward: 1020, staminaReward: 30, currencyRewards: { boneCharms: 1, auraDust: 20 }, itemRewards: ['hunt-ash-scale', 'hunt-ash-scale', 'hunt-ember-scale', 'hunt-wolf-fang'] },
    { id: 'hunt-moon-serpent', targetSector: 8, exploreCount: 5, aiProfileId: 'hunt-ai-moon-serpent', levelReq: 50, xpReward: 900, ryoReward: 1020, staminaReward: 30, currencyRewards: { boneCharms: 1, auraDust: 20 }, itemRewards: ['hunt-shadow-pelt', 'hunt-shadow-pelt', 'hunt-shadow-claw', 'hunt-shadow-claw'] },
    { id: 'hunt-ancient-chakra-beast', targetSector: 60, exploreCount: 6, aiProfileId: 'hunt-ai-ancient-chakra-beast', levelReq: 70, xpReward: 2000, ryoReward: 1450, staminaReward: 40, currencyRewards: { boneCharms: 2, auraDust: 40 }, itemRewards: ['hunt-legendary-material', 'hunt-legendary-material', 'hunt-ancient-beast-core'] },
    { id: 'hunt-worldstorm-dragon', targetSector: 59, exploreCount: 6, aiProfileId: 'hunt-ai-worldstorm-dragon', levelReq: 70, xpReward: 2000, ryoReward: 1450, staminaReward: 40, currencyRewards: { boneCharms: 2, auraDust: 40 }, itemRewards: ['hunt-legendary-material', 'hunt-legendary-material', 'hunt-titan-bone'] },
    // builtinFetchMissions
    { id: 'fetch-d-supply-trail', targetSector: 18, exploreCount: 3, raidCount: 1, raidAiProfileId: 'mission-outpost-d-supply-trail', levelReq: 1, xpReward: 90, ryoReward: 100, staminaReward: 8 },
    { id: 'fetch-c-border-scout', targetSector: 32, exploreCount: 5, raidCount: 2, raidAiProfileId: 'mission-outpost-c-border-scout', levelReq: 15, xpReward: 240, ryoReward: 540, staminaReward: 14 },
    { id: 'fetch-b-enemy-cache', targetSector: 47, exploreCount: 7, raidCount: 3, raidAiProfileId: 'mission-outpost-b-enemy-cache', levelReq: 30, xpReward: 520, ryoReward: 1320, staminaReward: 22, currencyRewards: { boneCharms: 1 } },
    { id: 'fetch-a-black-route', targetSector: 58, exploreCount: 9, raidCount: 4, raidAiProfileId: 'mission-outpost-a-black-route', levelReq: 50, xpReward: 1100, ryoReward: 3050, staminaReward: 32, currencyRewards: { boneCharms: 1, auraDust: 20 } },
    { id: 'fetch-s-shadow-front', targetSector: 60, exploreCount: 12, raidCount: 5, raidAiProfileId: 'mission-outpost-s-shadow-front', levelReq: 70, xpReward: 2400, ryoReward: 5630, staminaReward: 45, currencyRewards: { boneCharms: 2, auraDust: 45 } },
];

// â”€â”€ Hunt Fate Shard / Aura Stone drops (owner rulings A2 / A3, 2026-10) â”€â”€â”€â”€â”€
// Server-rolled on every claim, with no daily cap and no pity:
//   â€¢ Fate Shard: every hunt claim and every fetch-S claim from L20,
//     HUNT_FS_CHANCE (default 0.25). L20 is the Genin exam hold and the same
//     "established account" line the PvP rules use (PVP_ESTABLISHED_LEVEL), so
//     no separate account-age check applies and a reset week pays as normal.
//   â€¢ Aura Stone: every hunt claim from L50, HUNT_AS_CHANCE (default 0.2). It is
//     the casual source of Aura Stones outside the Rifts.
// The chances are env dials in [0, 1]; 0 turns a drop off.
export const HUNT_FS_MIN_LEVEL = 20;
export const HUNT_AS_MIN_LEVEL = 50;
export const HUNT_FS_CHANCE_DEFAULT = 0.25;
export const HUNT_AS_CHANCE_DEFAULT = 0.2;
/** A roll is an integer in [0, DROP_ROLL_SCALE); it drops when below chance x scale. */
export const DROP_ROLL_SCALE = 10_000;

export function huntFsChance(): number {
    return economyDial('HUNT_FS_CHANCE', HUNT_FS_CHANCE_DEFAULT, { min: 0, max: 1 });
}

export function huntAsChance(): number {
    return economyDial('HUNT_AS_CHANCE', HUNT_AS_CHANCE_DEFAULT, { min: 0, max: 1 });
}

/** The chance drops for THIS claim. `roll` returns an integer in [0, DROP_ROLL_SCALE)
 *  and is called once per drop the claim is eligible for (Fate Shard first). */
export function missionDropCurrency(p: {
    char: CatalogChar;
    missionType: 'hunt' | 'field';
    missionId: string;
    now: number;
    roll: () => number;
    fsChance?: number;
    asChance?: number;
}): Partial<Record<CurrencyKey, number>> {
    const level = Math.max(1, Math.floor(Number(p.char.level) || 1));
    const drops = (chance: number) => p.roll() < Math.round(Math.max(0, Math.min(1, chance)) * DROP_ROLL_SCALE);
    const fsClaim = p.missionType === 'hunt' || p.missionId === FETCH_S_MISSION_ID;
    // Rolled in this order (Fate Shard, then Aura Stone), each only when eligible.
    const fateShard = fsClaim && level >= HUNT_FS_MIN_LEVEL && drops(p.fsChance ?? huntFsChance());
    const auraStone = p.missionType === 'hunt' && level >= HUNT_AS_MIN_LEVEL && drops(p.asChance ?? huntAsChance());
    return { ...(fateShard ? { fateShards: 1 } : {}), ...(auraStone ? { auraStones: 1 } : {}) };
}

/** A new currency map: the catalog reward plus the claim's drops. Never mutates the catalog. */
export function withMissionDrops(
    base: Partial<Record<CurrencyKey, number>> | undefined,
    drops: Partial<Record<CurrencyKey, number>>,
): Partial<Record<CurrencyKey, number>> {
    const out: Partial<Record<CurrencyKey, number>> = { ...(base ?? {}) };
    for (const key of CURRENCY_KEYS) {
        const extra = Math.max(0, Math.floor(Number(drops[key] ?? 0)));
        if (extra > 0) out[key] = (out[key] ?? 0) + extra;
    }
    return out;
}

// â”€â”€ Academy Trial â€” the one-time onboarding mission (no client equivalent) â”€â”€â”€
// One-time (gated by character.academyTrialClaimed and the server-stamped
// academySparClaimed latch), off the daily cap, no premium currency. Its ryo is
// sized to the first required lesson spend, jutsu Lv1 -> 3 (3,000 + 3,500 =
// 6,500, api/training/_jutsu-ryo.ts): with the 100 starting ryo, the spar's 30
// and the post-graduation login it covers those lessons (framework #8).
export const ACADEMY_TRIAL = {
    id: 'academy-trial',
    xp: 40,
    ryo: 6000,
    stamina: 5,
} as const;

// â”€â”€ Academy Checklist â€” the one-time capstone reward for finishing the Academy
// Training goals (the new-shinobi checklist in the Logbook). Off the daily cap,
// one-time (gated by character.academyChecklistClaimed and the server-owned
// goals in academyChecklistGoalsMet). Its ryo pays the next lesson, jutsu
// Lv3 -> 4 (4,000), plus a small Fate Shard bonus.
export const ACADEMY_CHECKLIST = {
    id: 'academy-checklist',
    xp: 150,
    ryo: 4000,
    stamina: 10,
    fateShards: 2,
} as const;

// The two Academy grants are env dials so the owner can pull the faucet without
// a deploy if the new-account transfer telemetry fires: ACADEMY_TRIAL_RYO and
// ACADEMY_CHECKLIST_RYO, whole ryo in [0, 20,000]. Kill values 30 / 120 restore
// the pre-rebalance grants. Both pay unboosted.
export const ACADEMY_RYO_DIAL_MAX = 20_000;

function academyRyoDial(name: string, fallback: number): number {
    const value = economyDial(name, fallback, { min: 0, max: ACADEMY_RYO_DIAL_MAX });
    return Number.isInteger(value) ? value : fallback;
}

export function academyTrialRyo(): number {
    return academyRyoDial('ACADEMY_TRIAL_RYO', ACADEMY_TRIAL.ryo);
}

export function academyChecklistRyo(): number {
    return academyRyoDial('ACADEMY_CHECKLIST_RYO', ACADEMY_CHECKLIST.ryo);
}

/**
 * The server-owned subset of the Academy Training goals (client:
 * shinobij.client/src/lib/logbook-objectives.ts): a jutsu at mastery Lv3, one AI
 * win and one completed mission. Loadout and stat-growth goals stay client-only,
 * so this never refuses a player the Logbook shows as done. Every field read here
 * is server-owned (api/save/_state-ownership.ts).
 */
export function academyChecklistGoalsMet(char: CatalogChar): boolean {
    const mastery = Array.isArray(char.jutsuMastery) ? char.jutsuMastery as Array<Record<string, unknown>> : [];
    const highestMastery = Math.max(0, ...mastery.map((row) => Math.floor(Number(row?.level) || 0)));
    const aiKills = Math.floor(Number(char.totalAiKills) || 0);
    const missions = Math.max(Math.floor(Number(char.totalMissionsCompleted) || 0), Math.floor(Number(char.clanMissionContrib) || 0));
    return highestMastery >= 3 && aiKills >= 1 && missions >= 1;
}

export function combatMissionByKey(key: string): CombatMissionDef | undefined {
    return COMBAT_MISSIONS.find((m) => m.key === key);
}

export function fieldMissionById(id: string): FieldMissionDef | undefined {
    return FIELD_MISSIONS.find((m) => m.id === id);
}

// The built-in hunt ids (every FIELD_MISSIONS entry that carries itemRewards).
// The 'hunt' claim path resolves rewards through fieldMissionById but only for
// ids in this set, so a fetch mission can't be claimed against the hunt cap.
export const HUNT_MISSION_IDS: ReadonlySet<string> = new Set(
    FIELD_MISSIONS.filter((m) => Array.isArray(m.itemRewards)).map((m) => m.id),
);

export function huntMissionById(id: string): FieldMissionDef | undefined {
    return HUNT_MISSION_IDS.has(id) ? fieldMissionById(id) : undefined;
}

// The built-in hunt whose beast AI matches the given profile id. Used by the
// hunt-kill producer (report-ai-fight): the ai-fight token seals the opponentId,
// so a validated win against a hunt's beast stamps that hunt's kill receipt.
export function huntMissionByAiProfileId(aiProfileId: string): FieldMissionDef | undefined {
    if (!aiProfileId) return undefined;
    return FIELD_MISSIONS.find((m) => HUNT_MISSION_IDS.has(m.id) && m.aiProfileId === aiProfileId);
}

// â”€â”€ Reward bonus % â€” mirror of Logbook/Missions:
//     getMissionRewardBonus(char) + getActiveAuraSphereBonuses(char).missionRewardPercent
//   getMissionRewardBonus = villageUpgradeBonus(missionHall) + active Scholars doctrine
//   aura sphere mission % = (equipped) ? (lvl>=100 ? 1 : lvl>=50 ? 2 : 0) : 0
type CatalogChar = Record<string, unknown>;

function missionHallBonusPct(char: CatalogChar): number {
    const upgrades = (char.villageUpgrades as Record<string, unknown> | undefined) ?? {};
    const raw = Math.floor(Number(upgrades.missionHall ?? 0));
    const level = Math.min(VILLAGE_UPGRADE_MAX_LEVEL, Math.max(0, Number.isFinite(raw) ? raw : 0));
    return level * 0.5;
}

function auraSphereMissionPct(char: CatalogChar): number {
    const equipment = (char.equipment as Record<string, unknown> | undefined) ?? {};
    const equipped = equipment.aura === AURA_SPHERE_ITEM_ID || equipment.accessory === AURA_SPHERE_ITEM_ID;
    if (!equipped) return 0;
    const level = Math.max(1, Math.floor(Number(char.auraSphereLevel ?? 1)));
    if (level >= 100) return 1;
    if (level >= 50) return 2;
    return 0;
}

export function missionRewardBonusPct(char: CatalogChar): number {
    // Same existing 5% member perk used by the mission preview and training.
    // A retained mirror after leaving a clan is not membership authority.
    const inClan = typeof char.clan === 'string' && char.clan.trim() !== '';
    const scholars = inClan && char.clanDoctrine === 'scholars' ? 5 : 0;
    return missionHallBonusPct(char) + scholars + auraSphereMissionPct(char);
}

// boostAmount â€” verbatim from village-upgrades.ts.
export function boostAmount(amount: number, percent: number): number {
    return Math.max(0, Math.floor(amount * (1 + percent / 100)));
}

// â”€â”€ Daily-cap accounting â€” mirror of character-progress.ts. The cap lives on
//    the character (dailyMissionsCompleted + lastDailyReset), so the server
//    enforces it straight off the saved character. `todayKey` = UTC YYYY-MM-DD.
export function dailyMissionsCompleted(char: CatalogChar, todayKey: string): number {
    return char.lastDailyReset === todayKey ? Number(char.dailyMissionsCompleted ?? 0) : 0;
}

export function hasDailyMissionSlot(char: CatalogChar, todayKey: string): boolean {
    return dailyMissionsCompleted(char, todayKey) < DAILY_MISSION_LIMIT;
}

// â”€â”€ Hunt daily-cap accounting â€” mirror of character-progress.ts (hunt pool).
//    The hunt cap lives on its own counter (dailyHuntsCompleted + lastHuntReset),
//    independent of the mission cap. (audit M-1)
export function dailyHuntsCompleted(char: CatalogChar, todayKey: string): number {
    return char.lastHuntReset === todayKey ? Number(char.dailyHuntsCompleted ?? 0) : 0;
}

// Hunter Rank QoL perk: base cap + 1 hunt/day per rank (20 â†’ 25 at Warden).
// hunterRank is a server-trusted entitlement (the save sanitizer re-injects it),
// so this cap can't be inflated by a tampered client. Clamped to the 0..5 ladder.
export function dailyHuntCap(char: CatalogChar): number {
    return DAILY_HUNT_LIMIT + Math.max(0, Math.min(5, Math.floor(Number((char as { hunterRank?: unknown }).hunterRank ?? 0))));
}

export function hasDailyHuntSlot(char: CatalogChar, todayKey: string): boolean {
    return dailyHuntsCompleted(char, todayKey) < dailyHuntCap(char);
}

// Mirror of character-progress.markHuntCompleted â€” caller spreads these onto the
// char. Bumps the clan/lifetime aggregates like a mission, plus the hunt counter.
export function markHuntCompletedFields(char: CatalogChar, todayKey: string, monthKey: string) {
    return {
        clanMissionContrib: Number(char.clanMissionContrib ?? 0) + 1,
        totalMissionsCompleted: Number(char.totalMissionsCompleted ?? 0) + 1,
        dailyHuntsCompleted: dailyHuntsCompleted(char, todayKey) + 1,
        lastHuntReset: todayKey,
        clanContribMonth: monthKey,
    };
}

// Returns the character fields that markMissionCompleted bumps (mirror of
// character-progress.markMissionCompleted) â€” caller spreads these onto the char.
// A claim that rolls the day also zeroes the other counters keyed to
// lastDailyReset (api/_daily-reset-stamp.ts), or yesterday's arena wins would
// read as today's.
export function markMissionCompletedFields(char: CatalogChar, todayKey: string, monthKey: string) {
    return {
        ...advanceLastDailyReset(char, todayKey),
        clanMissionContrib: Number(char.clanMissionContrib ?? 0) + 1,
        totalMissionsCompleted: Number(char.totalMissionsCompleted ?? 0) + 1,
        dailyMissionsCompleted: dailyMissionsCompleted(char, todayKey) + 1,
        lastDailyReset: todayKey,
        clanContribMonth: monthKey,
    };
}

// Apply currency rewards onto a character (mirror of currency.applyCurrencyRewards).
export function applyCurrencyRewardFields(char: CatalogChar, rewards?: Partial<Record<CurrencyKey, number>>) {
    const out: Partial<Record<CurrencyKey, number>> = {};
    if (!rewards) return out;
    for (const key of CURRENCY_KEYS) {
        const amount = Math.max(0, Math.floor(Number(rewards[key] ?? 0)));
        if (amount > 0) out[key] = Number(char[key] ?? 0) + amount;
    }
    return out;
}

// Append literal item ids onto the inventory array. Kept for callers that only
// hold the array; reward grants go through grantItemsToCharacter.
export function grantItemsToInventory(char: CatalogChar, items?: readonly string[]): string[] {
    const inventory = Array.isArray(char.inventory) ? (char.inventory as string[]) : [];
    const add = Array.isArray(items) ? items.filter((i): i is string => typeof i === 'string' && !!i) : [];
    return [...inventory, ...add];
}

// Grant reward item ids onto both stores: hunt materials and the Weekly Boss
// Core join their itemStacks entry (owner ruling A12), anything else is
// appended to inventory[]. Returns only the two store fields to spread on; a
// malformed stored itemStacks is handed back untouched.
export function grantItemsToCharacter(char: CatalogChar, items?: readonly string[]): { inventory: unknown[]; itemStacks: unknown } {
    const granted = grantItemIds({ inventory: Array.isArray(char.inventory) ? char.inventory : [], itemStacks: char.itemStacks }, items);
    return { inventory: granted.inventory as unknown[], itemStacks: granted.itemStacks ?? [] };
}
