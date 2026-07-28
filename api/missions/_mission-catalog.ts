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

export const TERRITORY_CONTROL_SCROLL_ID = 'territory-control-scroll';
export const AURA_SPHERE_ITEM_ID = 'aura-sphere';
export const DAILY_MISSION_LIMIT = 20;
// Hunter Guild contracts use a daily pool independent of missions (own counter
// + reset key), so 20 hunts and 20 missions can be done in the same day. Mirror
// of constants/game.ts DAILY_HUNT_LIMIT. (audit M-1)
export const DAILY_HUNT_LIMIT = 20;
export const VILLAGE_UPGRADE_MAX_LEVEL = 50;
// Field missions always grant a flat 3 Territory Control Scrolls on claim
// (matches Logbook.claimMission's grantTerritoryScrolls(..., 3)). Hunts grant
// the same flat 3 (matches HunterBoard.claimHunt's grantTerritoryScrolls(..., 3)).
export const FIELD_MISSION_SCROLLS = 3;
export const HUNT_MISSION_SCROLLS = 3;

// ── Daily-checklist stat grants (docs/leveling-without-xp-map.md §4) ────────
// Character XP is retired: each ONCE-PER-DAY field/hunt claim pays stat-POOL
// points instead — the "daily checklist". Flat per claim: 10 hunt + 5 fetch
// dailies = 45/day at full unlock = the dailies slice of the daily growth
// budget (PvP slice 18 lives in _stat-growth.ts; profession dailies stay on
// their own profession-XP track). Repeatable combat-mission slots pay ryo
// only. The one-time academy capstones below are outside the checklist and
// unboosted. Pinned by the daily-checklist invariant in _mission-catalog.test.
export const FIELD_MISSION_STAT_POINTS = 3;
export const ACADEMY_TRIAL_STAT_POINTS = 5;
export const ACADEMY_CHECKLIST_STAT_POINTS = 10;
// The full-unlock daily-checklist target (dailies slice). The invariant test
// asserts the real catalog sums to this ±10% so a new daily can't silently
// inflate the day's growth.
export const DAILY_PVE_GROWTH_TARGET = 45;

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

// ── COMBAT_MISSIONS — mirror of data/combat-missions.ts ─────────────────────
export const COMBAT_MISSIONS: CombatMissionDef[] = [
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
export const FIELD_MISSIONS: FieldMissionDef[] = [
    // builtinHuntMissions
    { id: 'hunt-wild-boar', targetSector: 25, exploreCount: 3, aiProfileId: 'hunt-ai-wild-boar', levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, itemRewards: ['hunt-beast-meat', 'hunt-beast-meat', 'hunt-torn-hide'] },
    { id: 'hunt-forest-hawk', targetSector: 28, exploreCount: 3, aiProfileId: 'hunt-ai-forest-hawk', levelReq: 1, xpReward: 80, ryoReward: 60, staminaReward: 8, itemRewards: ['hunt-beast-meat', 'hunt-wild-feather', 'hunt-small-fang'] },
    { id: 'hunt-frost-wolf', targetSector: 50, exploreCount: 4, aiProfileId: 'hunt-ai-frost-wolf', levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, itemRewards: ['hunt-wolf-fang', 'hunt-wolf-fang', 'hunt-frost-pelt'] },
    { id: 'hunt-ash-lizard', targetSector: 40, exploreCount: 4, aiProfileId: 'hunt-ai-ash-lizard', levelReq: 15, xpReward: 200, ryoReward: 160, staminaReward: 12, itemRewards: ['hunt-ash-scale', 'hunt-ash-scale', 'hunt-cracked-horn'] },
    { id: 'hunt-shadow-panther', targetSector: 12, exploreCount: 4, aiProfileId: 'hunt-ai-shadow-panther', levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 }, itemRewards: ['hunt-shadow-pelt', 'hunt-shadow-claw', 'hunt-shadow-claw'] },
    { id: 'hunt-ironback-bear', targetSector: 30, exploreCount: 5, aiProfileId: 'hunt-ai-ironback-bear', levelReq: 30, xpReward: 420, ryoReward: 340, staminaReward: 20, currencyRewards: { boneCharms: 1 }, itemRewards: ['hunt-beast-meat', 'hunt-beast-meat', 'hunt-cracked-horn', 'hunt-cracked-horn'] },
    { id: 'hunt-ember-drake', targetSector: 42, exploreCount: 5, aiProfileId: 'hunt-ai-ember-drake', levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 }, itemRewards: ['hunt-ash-scale', 'hunt-ash-scale', 'hunt-ember-scale', 'hunt-wolf-fang'] },
    { id: 'hunt-moon-serpent', targetSector: 8, exploreCount: 5, aiProfileId: 'hunt-ai-moon-serpent', levelReq: 50, xpReward: 900, ryoReward: 750, staminaReward: 30, currencyRewards: { boneCharms: 2, auraDust: 20 }, itemRewards: ['hunt-shadow-pelt', 'hunt-shadow-pelt', 'hunt-shadow-claw', 'hunt-shadow-claw'] },
    { id: 'hunt-ancient-chakra-beast', targetSector: 60, exploreCount: 6, aiProfileId: 'hunt-ai-ancient-chakra-beast', levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 }, itemRewards: ['hunt-legendary-material', 'hunt-legendary-material', 'hunt-ancient-beast-core'] },
    { id: 'hunt-worldstorm-dragon', targetSector: 59, exploreCount: 6, aiProfileId: 'hunt-ai-worldstorm-dragon', levelReq: 70, xpReward: 2000, ryoReward: 1800, staminaReward: 40, currencyRewards: { boneCharms: 3, auraDust: 40, fateShards: 1 }, itemRewards: ['hunt-legendary-material', 'hunt-legendary-material', 'hunt-titan-bone'] },
    // builtinFetchMissions
    { id: 'fetch-d-supply-trail', targetSector: 18, exploreCount: 3, raidCount: 1, levelReq: 1, xpReward: 90, ryoReward: 75, staminaReward: 8 },
    { id: 'fetch-c-border-scout', targetSector: 32, exploreCount: 5, raidCount: 2, levelReq: 15, xpReward: 240, ryoReward: 190, staminaReward: 14 },
    { id: 'fetch-b-enemy-cache', targetSector: 47, exploreCount: 7, raidCount: 3, levelReq: 30, xpReward: 520, ryoReward: 420, staminaReward: 22, currencyRewards: { boneCharms: 1 } },
    { id: 'fetch-a-black-route', targetSector: 58, exploreCount: 9, raidCount: 4, levelReq: 50, xpReward: 1100, ryoReward: 900, staminaReward: 32, currencyRewards: { boneCharms: 2, auraDust: 20 } },
    { id: 'fetch-s-shadow-front', targetSector: 60, exploreCount: 12, raidCount: 5, levelReq: 70, xpReward: 2400, ryoReward: 2100, staminaReward: 45, currencyRewards: { boneCharms: 3, auraDust: 45, fateShards: 1 } },
];

// ── Academy Trial — the one-time onboarding mission (no client equivalent) ───
// Tiny, off the daily cap, one-time (gated by character.academyTrialClaimed).
// No premium currency, no territory scrolls.
export const ACADEMY_TRIAL = {
    id: 'academy-trial',
    xp: 40,
    ryo: 30,
    stamina: 5,
} as const;

// ── Academy Checklist — the one-time capstone reward for finishing ALL of the
// Academy Training goals (the 6-goal new-shinobi checklist in the Logbook).
// Bigger than the trial, off the daily cap, one-time (gated by
// character.academyChecklistClaimed). Grants a small premium (Fate Shards) bonus
// so the graduation moment actually pays out instead of being a dead-end button.
export const ACADEMY_CHECKLIST = {
    id: 'academy-checklist',
    xp: 150,
    ryo: 120,
    stamina: 10,
    fateShards: 2,
} as const;

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

// ── Reward bonus % — mirror of Logbook/Missions:
//     getMissionRewardBonus(char) + getActiveAuraSphereBonuses(char).missionRewardPercent
//   getMissionRewardBonus = villageUpgradeBonus(missionHall) = level × 0.5
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
    return missionHallBonusPct(char) + auraSphereMissionPct(char);
}

// boostAmount — verbatim from village-upgrades.ts.
export function boostAmount(amount: number, percent: number): number {
    return Math.max(0, Math.floor(amount * (1 + percent / 100)));
}

// ── Daily-cap accounting — mirror of character-progress.ts. The cap lives on
//    the character (dailyMissionsCompleted + lastDailyReset), so the server
//    enforces it straight off the saved character. `todayKey` = UTC YYYY-MM-DD.
export function dailyMissionsCompleted(char: CatalogChar, todayKey: string): number {
    return char.lastDailyReset === todayKey ? Number(char.dailyMissionsCompleted ?? 0) : 0;
}

export function hasDailyMissionSlot(char: CatalogChar, todayKey: string): boolean {
    return dailyMissionsCompleted(char, todayKey) < DAILY_MISSION_LIMIT;
}

// ── Hunt daily-cap accounting — mirror of character-progress.ts (hunt pool).
//    The hunt cap lives on its own counter (dailyHuntsCompleted + lastHuntReset),
//    independent of the mission cap. (audit M-1)
export function dailyHuntsCompleted(char: CatalogChar, todayKey: string): number {
    return char.lastHuntReset === todayKey ? Number(char.dailyHuntsCompleted ?? 0) : 0;
}

// Hunter Rank QoL perk: base cap + 1 hunt/day per rank (20 → 25 at Warden).
// hunterRank is a server-trusted entitlement (the save sanitizer re-injects it),
// so this cap can't be inflated by a tampered client. Clamped to the 0..5 ladder.
export function dailyHuntCap(char: CatalogChar): number {
    return DAILY_HUNT_LIMIT + Math.max(0, Math.min(5, Math.floor(Number((char as { hunterRank?: unknown }).hunterRank ?? 0))));
}

export function hasDailyHuntSlot(char: CatalogChar, todayKey: string): boolean {
    return dailyHuntsCompleted(char, todayKey) < dailyHuntCap(char);
}

// Mirror of character-progress.markHuntCompleted — caller spreads these onto the
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
// character-progress.markMissionCompleted) — caller spreads these onto the char.
export function markMissionCompletedFields(char: CatalogChar, todayKey: string, monthKey: string) {
    return {
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

// Push `count` territory scrolls onto the character's inventory array.
export function grantTerritoryScrollsToInventory(char: CatalogChar, count: number): string[] {
    const inventory = Array.isArray(char.inventory) ? (char.inventory as string[]) : [];
    const n = Math.max(0, Math.floor(count));
    return [...inventory, ...Array.from({ length: n }, () => TERRITORY_CONTROL_SCROLL_ID)];
}

// Append literal item ids (e.g. hunt material drops) onto the inventory array.
export function grantItemsToInventory(char: CatalogChar, items?: readonly string[]): string[] {
    const inventory = Array.isArray(char.inventory) ? (char.inventory as string[]) : [];
    const add = Array.isArray(items) ? items.filter((i): i is string => typeof i === 'string' && !!i) : [];
    return [...inventory, ...add];
}
