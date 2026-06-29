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
    | "pet_battle" // LEGACY: Hollow Beast walk-on tile — no longer placed (ambush
                   // still spawns these); kind kept for saved-run compatibility.
    | "tile_game"  // LEGACY: Card Clash walk-on tile — no longer placed (ambush
                   // still spawns these); kind kept for saved-run compatibility.
    | "shard_vein" // Findable Hollow Shard cache (depth-scaled payout).
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
    // Branching-wings membership: which wing this cell belongs to (index into
    // run.wingThemes). Hub/shared cells are undefined. Used by the runtime to
    // seal off the detour you didn't pick. Absent on pre-wings saved runs.
    wing?: number;
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
    // Clawback-eligible currency balances captured at run entry. On a run death
    // the player loses 50% of (current − entry) per currency; see
    // lib/hollow-gate-run. Absent on legacy in-progress runs → no claw-back.
    entryCurrencies?: Partial<Record<string, number>>;
    // Branching wings (see lib/hollow-gate-wings + docs/hollow-gate-loop.md §8).
    // wingThemes[k] is the theme of wing k ("treasure" | "beast" | "trial").
    // Only the trial wing holds the descend/boss; entering one detour seals the
    // other (sealedWings). committedDetour is the detour wing the player chose
    // (null = none yet). Absent on pre-wings / BSP-fallback runs → no gating.
    wingThemes?: Record<number, string>;
    sealedWings?: number[];
    committedDetour?: number | null;
    // Hollow Shard in-run consumables (Phase 3, see lib/hollow-gate-shards):
    //   wardSteps      — remaining steps where Threat does not build (Hollow Ward)
    //   diviner        — the floor map has been fully revealed (Diviner's Eye)
    //   secondWindArmed — a Second Wind revive charge is held; auto-spent on death
    wardSteps?: number;
    diviner?: boolean;
    secondWindArmed?: boolean;
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
    // Hollow Gate-only currency (earned in the shrine, spent only on shrine
    // consumables + the Shrine Attunement tree). Optional: absent on legacy
    // saves → treated as 0. See lib/hollow-gate-run + docs/hollow-gate-loop.md.
    hollowShards?: number;
    // Shrine Attunement — permanent Hollow Gate upgrades bought with shards
    // (nodeId → rank). Server-clamped in api/save. See lib/hollow-gate-attunement.
    hollowGateAttunement?: Record<string, number>;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    rankTitle: string;
    customTitle?: string;
    storyTitle?: string;
    // Player-authored "Nindo" — a customizable profile creed written in a safe
    // BBCode subset ([b]/[i]/[color]/[img]/[url]/…), rendered to React nodes by
    // lib/nindo-bbcode (never raw HTML). Shown on the player's own Profile and on
    // every viewer's UserView. Public by default (not in ROSTER_STRIP_CHAR_FIELDS);
    // moderated + length-capped server-side in api/save.
    nindo?: string;
    // Chosen Nindo banner preset id (see lib/nindo-backgrounds). Cosmetic + public;
    // server allowlists it in api/save. Absent/"" = plain card.
    nindoBg?: string;
    storyTraits?: string[];
    storyProgress: number;
    storyVillage: string;
    equippedBloodlineId?: string;
    stats: Stats;
    unspentStats: number;
    equippedJutsuIds: string[];
    inventory: string[];
    // Counted stacks for non-unique items (consumables, throwables, scrolls,
    // pet food/gear, dungeon shards — see `stackableItemIds`). One entry per
    // distinct item id with a quantity, so bulk consumables don't burn one
    // `inventory` array slot per copy (which used to silently overflow the
    // server-side inventory cap). MUST stay an array (not a Record) so the
    // save merge in api/_utils.ts `mergePreservingImages` takes it verbatim —
    // a keyed object would resurrect deleted stacks. See lib/inventory.ts.
    itemStacks?: { itemId: string; count: number }[];
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
    // ── Shinobi Card Clash (Card Hall 3-location card game) ──────────────────
    // Its own 12-card deck field, kept separate from savedTileDeck so the legacy
    // Shinobi Tiles encounters (Hollow Gate / clan war) keep working untouched.
    // All additive/optional: legacy saves treat missing values as "never played".
    cardClashDeck?: string[];
    cardClashWins?: number;
    cardClashLosses?: number;
    cardClashDraws?: number;
    // UTC date (YYYY-MM-DD) of the most recent Card Clash win — gates the
    // once-per-day first-win ryo bonus.
    cardClashDailyWinDate?: string;
    // One-time "seen the Card Clash tutorial" flag (matches hollowGateIntroSeen).
    cardClashTutorialSeen?: boolean;
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
    // Active sector-wanderer quest (display mirror; server seals the real baseline
    // + reward in KV). Additive/optional — old saves read it as "no quest".
    activeWandererQuest?: { id: string; target: number; baseline: number } | null;
    // Consecutive sector-wanderer robbers fended off. At 5 the next bandit springs
    // an ambush (3 robbers + a boss); resets to 0 on a loss or after the ambush.
    robberStreak?: number;
    // A bandit who beat you becomes your rival — it returns (escalating with each
    // win over you) until you put it down. Additive/optional. tier = times it bested you.
    wandererNemesis?: { name: string; level: number; tier: number } | null;
    // War mercenaries hired this war (display mirror; the server's NX marker is the
    // real once-per-war-per-tier guard). When warId ≠ the active war, the contract
    // has reset and the client shows none hired. Additive/optional.
    warMercs?: { warId: string; tiers: string[] } | null;
    // Active multi-stage "epic" from the Quest Book (display mirror; api/sector/questbook.ts
    // seals the real stage + baseline + branch choices + timer deadline in KV). One epic
    // at a time. Additive/optional. `deadline` (ms epoch) is set on timed stages;
    // `choices` maps a branch stage key → the chosen option key.
    activeQuestbook?: { id: string; stage: number; baseline: number; target: number; deadline?: number | null; choices?: Record<string, string> } | null;
    // Cosmetic titles earned from completing Quest Book epics. Additive/optional.
    questTitles?: string[];
    // Persistent world-standing flags from epic branch choices (e.g. "goro-spared").
    // Additive/optional — drives later flavor reactions.
    questStandings?: string[];
    // Per-NPC anti-spam cooldowns for sector wanderers (wanderer id → expiry ms).
    // Set when you take a repeatable reward from a wanderer (fight/gift/pet/card) so
    // that NPC vanishes for a few hours. Additive/optional; expired entries are pruned.
    wandererCooldowns?: Record<string, number>;
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
    // Per-AI defeat counts (id → kills), powering the Bestiary kill-count tiers.
    aiKills?: Record<string, number>;
    rankedRating?: number;
    rankedWins?: number;
    rankedLosses?: number;
    // Pet ranked 1v1 ladder — account-level (one rating per player, not
    // per-pet). Mirrors the player ranked fields above. Default 1000 Elo.
    petRankedRating?: number;
    petRankedWins?: number;
    petRankedLosses?: number;
    // Ranked seasons: count of ranked seasons finished #1 (player OR pet ladder),
    // stamped by the season-rollover job. Drives the "Season Champion" achievement.
    rankedSeasonsWon?: number;
    // Profession mastery: points spent per mastery-tree node (nodeId → ranks).
    // Mastery LEVEL (the point budget) is derived from profession XP earned past
    // rank 10; this only records how the player has allocated those points.
    // PvE/utility only — see lib/profession-mastery.ts. Validated server-side.
    masterySpec?: Record<string, number>;
    clanContribMonth?: string;
    guardQueued?: boolean;
    hospitalized?: boolean;
    // Server-authoritative hospital admission timestamps (epoch ms). Stamped by
    // api/save/[name].ts when hospitalized flips false→true and enforced by
    // api/player/heal.ts on discharge. The Hospital screen reads hospitalizedUntil
    // to drive the free-checkout countdown so it survives a refresh (the old
    // ephemeral client-only entry-time was lost on reload, trapping admitted
    // players). Kept in sync server-side; the client never re-stamps them.
    hospitalizedUntil?: number;
    hospitalizedAt?: number;
    villageUpgrades: VillageUpgrades;
    // Snapshot of the player's clan's upgrade-building levels, refreshed when the
    // Clan Hall loads clan data. Lets the per-character bonus helpers apply clan
    // member-passive effects (training/pet XP, shop/hospital discounts) without a
    // live clan fetch at every reward site. Eventual-consistency by design.
    clanUpgradeLevels?: Record<string, number>;
    // Snapshot of the clan's chosen Doctrine, stamped at Clan Hall load so the
    // per-character bonus helpers can apply the doctrine perk (same pattern as
    // clanUpgradeLevels above).
    clanDoctrine?: import("../lib/clan-doctrines").ClanDoctrine;
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
    // Raw (pre-decay) Endless-Tower character-XP banked today. Beyond a daily soft
    // cap (towerDailyXpSoftCap) further tower XP is sharply diminished so the tower
    // can't bypass the level curve. Tied to lastDailyReset.
    dailyTowerXp?: number;
    lastDailyReset?: string;
    // Daily login-streak reward (server-authoritative, api/player/daily-login.ts).
    // loginStreak = consecutive UTC days claimed; lastLoginRewardDate = the UTC
    // date (YYYY-MM-DD) of the last grant, which gates the once-per-day payout.
    // Written by the server inside the save lock; the client mirrors them after a
    // claim so a follow-up autosave preserves them.
    loginStreak?: number;
    lastLoginRewardDate?: string;
    // Combat missions (Mission Hall → Combat tab) are fought in the Arena but
    // their reward is *claimed* back in the Mission Hall. Each won-but-unclaimed
    // mission's stable key (see data/combat-missions) sits here until the player
    // returns and clicks "Claim Reward". Additive/optional — legacy saves treat
    // a missing value as "no pending claims".
    pendingCombatMissionClaims?: string[];
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
    // onboardingStep drives the forced first-session "Academy Path" coach; the
    // others are one-time "seen/claimed" gates matching the hollowGateIntroSeen
    // convention. Canonical order:
    //   "academyIntro" (framing modal) → "starter" (choose-your-companion) →
    //   "academySpar" (guaranteed first-win spar) → "training" → "jutsu" →
    //   "firstMission" (claim the Academy Trial) → "logbook" (open the goals) →
    //   "storyUnlocked" (village story now available) → "done". Each beat
    //   advances on the real action.
    // Legacy values "spar"/"tour" still appear in older saves and are mapped via
    // normalizeOnboardingStep() (lib/onboarding-step.ts) — never compare against
    // them directly for routing; normalize first.
    onboardingStep?:
        | "academyIntro"
        | "starter"
        | "academySpar"
        | "training"
        | "jutsu"
        | "firstMission"
        | "logbook"
        | "storyUnlocked"
        | "done"
        // legacy (older saves) — normalized away by normalizeOnboardingStep()
        | "spar"
        | "tour";
    academyChecklistClaimed?: boolean;
    // One-time claim gate for the onboarding "Academy Trial" mission (Workstream F).
    academyTrialClaimed?: boolean;
    // Dismissed one-time contextual screen hints (Shop/Hospital/World Map/etc.).
    seenHints?: string[];
    geninCeremonySeen?: boolean;
    endlessTowerRun?: EndlessTowerRun | null;
    endlessTowerBestWave?: number;
    // ── Battle Towers (4-player curated squad tower) ──────────────────────────
    // All additive/optional: legacy saves treat missing values as "never played".
    // Live combat state lives in a dedicated KV session (tower:<runId>), NOT here;
    // only durable, leak-safe progress persists on the save (no banked currency).
    battleTowerBestFloor?: number;              // lifetime deepest floor cleared (monotonic; leaderboard)
    battleTowerRating?: number;                 // all-time Floor Clear Score aggregate (server-authoritative)
    battleTowerClearedFloors?: number[];        // floor ids first-cleared (permanent; one-time-reward gate)
    battleTowerClaimedRewards?: string[];       // per-floor reward claim-gate keys
    battleTowerAssistRewardsClaimed?: string[]; // borrowed-ally assist claim gates
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
    clan?: string; // surfaced from presence for the Scout Network war overlay
    tile?: number; // within-sector tile (0..143) for live peer rendering; display-only
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
