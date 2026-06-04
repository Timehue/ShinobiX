/*
 * Character — the player avatar. Aggregates everything else: stats,
 * equipment, jutsu mastery, pets, currencies, progression flags, daily/
 * weekly counters, story/exam progress, hollow-gate + endless-tower run
 * state.
 *
 * Co-located here:
 *   • HollowGateTileKind / HollowGateTerrain / HollowGateTile /
 *     HollowGateShrineRun — needed by Character.hollowGateRun.
 *   • EndlessTowerRun — needed by Character.endlessTowerRun.
 *   • RewardCurrencyKey / CurrencyRewards — referenced by mission/event
 *     reward payloads but small enough to live next to Character.
 *   • PlayerRecord / ServerPlayerSummary — they embed Character.
 *
 * Extracted from App.tsx.
 */

import type { Profession, JutsuType, VillageUpgrades } from "./core";
import type { Stats, EquipmentSlots, JutsuMastery } from "./combat";
import type { Pet } from "./pet";

// ── Hollow Gate Shrine run state ──────────────────────────────────────────

export type HollowGateTileKind =
    | "empty"
    | "wall"       // impassable stone — gives the dungeon real geometry
    | "battle"
    | "elite"
    | "trap"
    | "chest"
    | "pet_event"
    | "pet_battle" // Wild Hollow Beast — animal/pet-themed PvE combat encounter
    | "tile_game"  // Shinobi Tile card-game encounter; loss costs 20% maxHp
    | "shrine"
    | "story"
    | "boss"
    | "exit"
    | "locked"
    | "npc"        // Shrine Keeper — once-per-floor blessing
    | "descend";   // Staircase to next floor (Floors 1-4 only)

// Geometry layer — how a cell is *drawn*. Independent of `kind` (the event/
// content on the cell). The BSP generator labels every walkable cell as one
// of room_floor / corridor_floor / door; non-walkable cells get terrain:"wall".
//
// Old saved runs from the blob-wall generator don't have this field. The
// renderer falls back to deriving terrain from `kind === "wall"` when
// `terrain` is undefined, so saved-run resume still works.
export type HollowGateTerrain = "wall" | "room_floor" | "corridor_floor" | "door";

export type HollowGateTile = {
    kind: HollowGateTileKind;
    terrain?: HollowGateTerrain;
    // BSP room membership — every floor cell inside a room shares the same
    // roomId so the renderer can light up the entire room when the player
    // steps inside. Corridors and walls get roomId = null.
    roomId?: number | null;
    // Optional decoration sprite index (0-3). Purely visual — does not block
    // movement, no event fires. Sprinkled by the generator into ~12% of empty
    // room cells to break up the floor-texture monotony.
    decoration?: number;
    revealed: boolean;
    resolved: boolean;
    flavor?: string;
};

export type HollowGateShrineRun = {
    width: number;
    height: number;
    playerX: number;
    playerY: number;
    tiles: HollowGateTile[]; // length = width * height, row-major
    floor: number;
    threat: number; // 0..100
    torch: number; // 0..10
    keys: number;
    completed: boolean;
    // Theme assignment per roomId — the renderer uses this to pick which
    // shrine:icon-theme-<theme>-<role> tile to draw for room_floor / door /
    // corridor / wall cells. Old saved runs without this field fall back to
    // the base atlas tiles for terrain.
    roomThemes?: Record<number, string>;
    // Random seed baked into the run on creation. Used so the theme picker
    // gives different rooms different themes per-run.
    seed?: number;
};

// ── Endless Tower run state ───────────────────────────────────────────────

export type EndlessTowerRun = {
    wave: number;
    bankedRyo: number;
    bankedXp: number;
    startedAt: number;
    // Highest 5-kill milestone (5, 10, 15, 20, ...) already credited
    // during this run. Reset to 0 each new run. Lets the milestone
    // grant survive client reloads without double-paying when the same
    // wave is re-confirmed.
    highestMilestoneClaimed?: number;
};

// ── Reward currencies ─────────────────────────────────────────────────────

export type RewardCurrencyKey =
    | "fateShards"
    | "honorSeals"
    | "boneCharms"
    | "auraStones"
    | "auraDust"
    | "mythicSeals";

export type CurrencyRewards = Partial<Record<RewardCurrencyKey, number>>;

// ── Character ─────────────────────────────────────────────────────────────

export type Character = {
    name: string;
    village: string;
    specialty: JutsuType;
    bloodline: string;
    avatarImage?: string;
    level: number;
    xp: number;
    ryo: number;
    bankRyo: number;
    honorSeals: number;
    auraDust: number;
    auraSphereLevel: number;
    fateShards: number;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    rankTitle: string;
    customTitle?: string;
    storyTitle?: string;
    storyTraits?: string[];
    storyProgress: number;
    storyVillage: string;
    equippedBloodlineId?: string;
    stats: Stats;
    unspentStats: number;
    equippedJutsuIds: string[];
    inventory: string[];
    equipment: EquipmentSlots;
    jutsuMastery: JutsuMastery[];
    pets: Pet[];
    activePetId?: string;
    // Second active pet — the default 2v2 arena partner (reserve). Unlike
    // activePetId (the PvE summon) this pet is never summoned in PvE; it only
    // pre-fills the 2v2 reserve slot, which stays overridable per battle.
    activePetId2v2?: string;
    tileCards: string[];
    savedTileDeck?: string[];
    element?: string;
    elements?: string[];
    boneCharms: number;
    auraStones: number;
    mythicSeals: number;
    clan?: string;
    clanFounder?: boolean;
    profession?: Profession;
    professionRank?: number;
    professionXp?: number;
    professionChosenAt?: number;
    // Account creation timestamp (ms). Used to gate Vanguard rewards from
    // killing brand-new alt accounts. Backfilled to Date.now() on first
    // save if missing (existing characters get a "now" stamp on rollout).
    createdAt?: number;
    // Vanguard daily tracking (separate reset date so Vanguard counters
    // don't interfere with other daily counter resets).
    dailyHonorSealsEarned?: number;
    dailyHonorSealsByTarget?: Record<string, number>;
    vanguardDailyResetDate?: string;
    // Pet Tamer daily First Expedition tracking (UTC).
    lastExpeditionClaimDate?: string;
    expeditionsClaimedToday?: number;
    // Clan Seal donation per-day cumulative cap tracking (UTC).
    dailyDonatedSeals?: number;
    dailyDonationDate?: string;
    // Pet escort one-shot bonus: when a Vanguard from this Pet Tamer's clan
    // wins a raid with an active pet and this Pet Tamer has an open escort
    // offer, server stamps this flag. Consumed (cleared) on next expedition
    // collect, applying +20% Tamer XP for that one expedition.
    petEscortBonusReady?: boolean;
    clanBattleContrib: number;
    clanEventContrib: number;
    clanMissionContrib: number;
    totalStatsTrained?: number;
    totalMissionsCompleted?: number;
    totalAiKills?: number;
    totalPvpKills?: number;
    monthlyPvpKills?: number;
    pvpKillMonth?: string;
    totalVillageRaids?: number;
    villageWarMissionDate?: string;
    villageWarRaidProgress?: number;
    villageWarMissionsCompleted?: number;
    // Per-day bounty for raiding the war ground. Set on the first
    // war-ground raid of each UTC day; gates the inline +500 ryo +
    // 1 Fate Shard bounty so it can only be claimed once per day.
    warGroundBountyDate?: string;
    // Lifetime village war stats — incremented at war-end claim time
    // by claimPendingWarCrates. Drive the Hall of Legends leaderboards.
    warsWon?: number;             // wars where this player qualified for the winner crate
    warMvpCount?: number;         // wars where this player was MVP on either side
    lifetimeWarDamage?: number;   // sum of contribution damage across all wars touched
    totalTilesExplored?: number;
    totalTournamentsCompleted?: number;
    totalEndlessTowerWins?: number;
    totalPetWins?: number;
    defeatedAiIds?: string[];
    rankedRating?: number;
    rankedWins?: number;
    rankedLosses?: number;
    // Pet ranked 1v1 ladder — account-level (one rating per player, not
    // per-pet). Mirrors the player ranked fields above. Default 1000 Elo.
    petRankedRating?: number;
    petRankedWins?: number;
    petRankedLosses?: number;
    clanContribMonth?: string;
    guardQueued?: boolean;
    hospitalized?: boolean;
    villageUpgrades: VillageUpgrades;
    lastBankInterestAt?: number;
    dailyTilesExplored?: number;
    dailyMissionsCompleted?: number;
    // Hunter Guild contracts claimed today. Capped at DAILY_HUNT_LIMIT and
    // reset off its own key (lastHuntReset) so it never collides with the
    // mission counter's rollover.
    dailyHuntsCompleted?: number;
    lastHuntReset?: string;
    dailyFateSpins?: number;
    dailyAiKills?: number;
    dailyPetWins?: number;
    // Hollow Gate Shrine runs entered today. Hard-capped at 2 regardless of
    // how many Hollow Gate Keys the player has banked — the shrine itself
    // refuses to open more than twice between dawns. Tied to lastDailyReset.
    dailyHollowGateRuns?: number;
    lastDailyReset?: string;
    claimedVillageAgendaDate?: string;
    claimedMapControlDate?: string;
    hunterRank?: number;
    weeklyBossKills?: Record<string, string>;
    claimedWarCrateIds?: string[];
    elderFocus?: "war" | "trade" | "training";
    examsPassed?: string[];
    unlockedAchievements?: string[];
    achievementUnlockedAt?: Record<string, number>;
    // Hollow Gate Shrine — in-progress run saved per-character (so refresh keeps state)
    // and a lifetime Warden-kill counter for telemetry / future achievements.
    hollowGateRun?: HollowGateShrineRun | null;
    hollowGateWardenKills?: number;
    hollowGateIntroSeen?: boolean;
    // Early-game onboarding flags (additive; undefined = not started / legacy).
    // onboardingStep drives the forced first-session coach; the others are
    // one-time "seen/claimed" gates matching the hollowGateIntroSeen convention.
    onboardingStep?: "tour" | "training" | "jutsu" | "done";
    academyChecklistClaimed?: boolean;
    geninCeremonySeen?: boolean;
    endlessTowerRun?: EndlessTowerRun | null;
    endlessTowerBestWave?: number;
};

// ── Player records ────────────────────────────────────────────────────────

export type PlayerRecord = {
    name: string;
    level: number;
    village: string;
    specialty: JutsuType;
    character: Character;
    currentSector?: number;
    lastSeenAt?: number;
    travelingUntil?: number;
};

export type ServerPlayerSummary = {
    name: string;
    level: number;
    village: string;
    specialty?: string;
    online: boolean;
    character?: Character;
    currentSector?: number;
    lastSeenAt?: number;
    travelingUntil?: number;
};
