import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import type * as React from "react";
import "./index.css";
import { installAuthFetch, setActivePlayer, setActiveToken, SESSION_EXPIRED_EVENT } from "./authFetch";
import { GameAlertHost } from "./components/GameAlert";
import { SaveErrorBanner } from "./components/SaveErrorBanner";
import { ScreenErrorBoundary } from "./components/ScreenErrorBoundary";
import { NextGoalPin } from "./components/NextGoalPin";
import { subscribeKvKey, realtimeAvailable } from "./lib/realtime";
import { claimBountyOnWin } from "./lib/pvp-bounty";
import { strikeDownSleeper } from "./lib/sleeper-kill";
import { payEndlessEntry, endlessEntryCost } from "./lib/entry-fee";
import { setBootKind as perfSetBootKind, notifyScreen as perfNotifyScreen, notifyRestoreComplete as perfNotifyRestoreComplete } from "./lib/perfTelemetry";
import { connectRealtime, disconnectRealtime, updatePresence, onSector as onPresenceSector, onGone as onPresenceGone, onKick as onPresenceKick, onStatus as onPresenceStatus } from "./lib/presence-socket";
import { pushLiveSectorPlayers, removeLiveSectorPlayers, resetLiveSectorPlayers, getLiveSectorPlayers, setLiveAvatarPrefetch, getLocalSectorTile } from "./lib/presence-store";
import { presenceCharacter } from "./lib/presence-character";
import {
    percentageTags,
    cappedDamageTags,
    binaryTags,
    allTags,
    tagCapForRank,
} from "./lib/tags";
import {
    getBloodlineMultiplier,
} from "./lib/combat-math";
import {
    getActiveAuraSphereBonuses,
} from "./lib/aura-sphere";
import {
    applyCurrencyRewards,
} from "./lib/currency";
import {
    defaultVillageUpgrades,
    normalizeVillageUpgrades,
    discountCost,
    getBankInterestPercent,
    getHospitalDiscountPercent,
} from "./lib/village-upgrades";
import {
    getAllItems,
    getItemById,
    addInventoryItems,
} from "./lib/items";
import { removeItem, countItem, ownsItem, normalizeInventory } from "./lib/inventory";
import { getAllTileCards, type TileCard } from "./data/tile-cards";
import type {
} from "./types/clan";
import {
    scaleJutsuTagsForDisplay,
} from "./lib/jutsu-scaling";
import { useJutsuTrainingQueueRunner } from "./lib/jutsu-training-queue";
import {
    jutsuEffectInfo,
    jutsuDisplayAtLevel,
} from "./lib/jutsu-effects";
import {
} from "./lib/jutsu-points";
import { normalizeJutsu } from "./lib/jutsu";
import { normalizeOnboardingStep } from "./lib/onboarding-step";
import {
    starterBloodlineOffense,
    rebalanceNonBloodlineJutsu,
    starterJutsus,
    starterSavedBloodlines,
} from "./data/jutsu";
export { starterBloodlines } from "./data/jutsu";
export { starterBloodlineOffense, starterSavedBloodlines };
import {
    endlessScaleFactor,
    endlessWaveReward,
    endlessTowerMilestoneReward,
    applyTowerCashOut,
} from "./lib/endless-tower";
export { endlessScaleFactor, endlessWaveReward, endlessTowerMilestoneReward };
import {
    baseStats,
    normalizeStats,
    allocatedStatPoints,
    addToAllStats,
    maxedStats,
    xpNeeded,
    maxHpForLevel,
    maxChakraForLevel,
    maxStaminaForLevel,
    rankFromLevel,
    statPointBudgetForProgress,
    progressAfterXp,
    reconcileCharacterStatBudget,
} from "./lib/stats";
export { xpNeeded };
import {
    dailyMissionsCompleted,
    dailyHuntsCompleted,
    rankTitleForLevel,
    addStoryTrait,
} from "./lib/character-progress";
export { dailyMissionsCompleted, dailyHuntsCompleted };
import {
    aiStatsForLevel,
    aiHpForLevel,
    aiRawDamageReductionForLevel,
    aiArmorFactorFromRaw,
} from "./lib/ai-stats";

// Install the global fetch interceptor once at module load. From here on,
// every fetch('/api/...') call automatically picks up x-player-name and
// x-player-password from the active session (managed via setActivePlayer).
installAuthFetch();
import castleImg from "./assets/castle.webp";
import houseImg from "./assets/house1.webp";
import moonshadowImage from "./assets/moonshadow.webp";
import stormveilVillageImg from "./assets/sectors/stormveil-village.webp";
import shinobiBanner from './assets/shinobi-banner.webp'
// rightMenuBg + sectorBanner asset imports moved into ./components/RightMenu
// and ./components/SectorBanner alongside the components that use them.
import backgroundImage from "./assets/background-image.webp";
// Route-based code-splitting: heavy/rarely-used screens load on demand so
// they stay out of the initial JS bundle. The eager imports below are kept
// for the screens that render on first paint or are tiny / common.
// (Wrapped in a <Suspense> boundary inside <main> further down.)
const Inventory = lazyWithRetry(() => import("./screens/Inventory").then(m => ({ default: m.Inventory })));
const Hospital = lazyWithRetry(() => import("./screens/Hospital").then(m => ({ default: m.Hospital })));
const VillageTavern = lazyWithRetry(() => import("./screens/VillageTavern").then(m => ({ default: m.VillageTavern })));
const AdminLogin = lazyWithRetry(() => import("./screens/AdminLogin").then(m => ({ default: m.AdminLogin })));
const Cafeteria = lazyWithRetry(() => import("./screens/Cafeteria").then(m => ({ default: m.Cafeteria })));
const VillageLoreScreen = lazyWithRetry(() => import("./screens/VillageLoreScreen").then(m => ({ default: m.VillageLoreScreen })));
const HallOfLegends = lazyWithRetry(() => import("./screens/HallOfLegends").then(m => ({ default: m.HallOfLegends })));
const ProfessionPicker = lazyWithRetry(() => import("./screens/ProfessionPicker").then(m => ({ default: m.ProfessionPicker })));
const Professions = lazyWithRetry(() => import("./screens/Professions").then(m => ({ default: m.Professions })));
const StarterPetSelect = lazyWithRetry(() => import("./screens/StarterPetSelect").then(m => ({ default: m.StarterPetSelect })));

const Bank = lazyWithRetry(() => import("./screens/Bank").then(m => ({ default: m.Bank })));
const EndlessTowerLobby = lazyWithRetry(() => import("./screens/EndlessTowerLobby").then(m => ({ default: m.EndlessTowerLobby })));
const VillageWarScreen = lazyWithRetry(() => import("./screens/VillageWarScreen").then(m => ({ default: m.VillageWarScreen })));
const VillageWarMap = lazyWithRetry(() => import("./screens/VillageWarMap").then(m => ({ default: m.VillageWarMap })));
const SectorWarCardBattle = lazyWithRetry(() => import("./screens/SectorWarCardBattle").then(m => ({ default: m.SectorWarCardBattle })));
const WeeklyBossArena = lazyWithRetry(() => import("./screens/WeeklyBossArena").then(m => ({ default: m.WeeklyBossArena })));
const BloodlineMaker = lazyWithRetry(() => import("./screens/BloodlineMaker").then(m => ({ default: m.BloodlineMaker })));
const Profile = lazyWithRetry(() => import("./screens/Profile").then(m => ({ default: m.Profile })));
const Logbook = lazyWithRetry(() => import("./screens/Logbook").then(m => ({ default: m.Logbook })));
const HunterBoard = lazyWithRetry(() => import("./screens/HunterBoard").then(m => ({ default: m.HunterBoard })));
const Missions = lazyWithRetry(() => import("./screens/Missions").then(m => ({ default: m.Missions })));
const StoryHall = lazyWithRetry(() => import("./screens/StoryBoss").then(m => ({ default: m.StoryHall })));
const StoryBoss = lazyWithRetry(() => import("./screens/StoryBoss").then(m => ({ default: m.StoryBoss })));
const TownHall = lazyWithRetry(() => import("./screens/TownHall").then(m => ({ default: m.TownHall })));
const ClanHall = lazyWithRetry(() => import("./screens/ClanHall").then(m => ({ default: m.ClanHall })));
import { BATTLE_LOCK_ID_KEY, BATTLE_LOCK_RESOLVED_KEY, postBattleLock, endlessCtxKey, arenaStoryCtxKey, fetchBattleLockStatus, battleResumeStateExists, readEndlessContext, readArenaStoryContext, type ClientBattleLock } from "./lib/battle-save";
import { allProgressMissions, builtinHuntMissions, missionRaidProgressKey, missionRaidRequirement } from "./data/missions";
import { postPlayerChallengeNotice } from "./lib/player-api";
import { EXAM_LEVEL_GATES } from "./constants/game";
const WorldMap = lazyWithRetry(() => import("./screens/WorldMap").then(m => ({ default: m.WorldMap })));
import { fetchPlayerCombatSave, stringifyPvpSessionPayload, pvpSessionEnvironment } from "./lib/pvp-session";
import { lazyWithRetry } from "./lib/lazyWithRetry"; const CentralHub = lazyWithRetry(() => import("./screens/CentralHub").then(m => ({ default: m.CentralHub })));
const BattleTowers = lazyWithRetry(() => import("./screens/BattleTowers").then(m => ({ default: m.BattleTowers })));
const SunscarFestival = lazyWithRetry(() => import("./screens/SunscarFestival").then(m => ({ default: m.SunscarFestival })));
const PetArena = lazyWithRetry(() => import("./screens/PetArena").then(m => ({ default: m.PetArena })));
const PetLadder = lazyWithRetry(() => import("./screens/PetLadder").then(m => ({ default: m.PetLadder })));
import { type PetArenaOpponent } from "./data/pet-arena-opponents";
const PetYard = lazyWithRetry(() => import("./screens/PetYard").then(m => ({ default: m.PetYard })));
const ClanWarTileCardDuel = lazyWithRetry(() => import("./screens/ClanWarTileCardDuel").then(m => ({ default: m.ClanWarTileCardDuel })));
const ShinobiCouncilHall = lazyWithRetry(() => import("./screens/ShinobiCouncilHall").then(m => ({ default: m.ShinobiCouncilHall })));
const CardClashDuel = lazyWithRetry(() => import("./screens/CardClashDuel").then(m => ({ default: m.CardClashDuel })));
const CardHall = lazyWithRetry(() => import("./screens/CardHall").then(m => ({ default: m.CardHall })));
const GuidesLibrary = lazyWithRetry(() => import("./components/GuidesLibrary").then(m => ({ default: m.GuidesLibrary })));
import { buildPlayableDeck, deriveCardClashCard, validateDeck as validateClashDeck } from "./lib/card-clash";
const DungeonEncounter = lazyWithRetry(() => import("./screens/Dungeon").then(m => ({ default: m.DungeonEncounter })));
const DungeonPetBattle = lazyWithRetry(() => import("./screens/Dungeon").then(m => ({ default: m.DungeonPetBattle })));
import { sharedClanWarCache, cwListWars, type CwChallenge, type CwChallengeResult } from "./lib/clan-war-api";
const PvpBattleScreen = lazyWithRetry(() => import("./screens/PvpBattleScreen").then(m => ({ default: m.PvpBattleScreen })));
const Arena = lazyWithRetry(() => import("./screens/Arena").then(m => ({ default: m.Arena })));
import { JutsuSpriteFx } from "./components/JutsuSpriteFx";
import { BattleLockKeeper } from "./components/BattleLockKeeper";
import { DEEP_LINKABLE_SCREENS, RESTORABLE_SCREENS, BATTLE_SCREENS, isUnresolvedBattle, hasActiveTowerFight } from "./lib/screen-guards";
import { mergePlayerRoster } from "./lib/roster-merge";
const AdminPanel = lazyWithRetry(() => import("./screens/AdminPanel").then(m => ({ default: m.AdminPanel })));
import { builtinAis, balanceExistingAiProfiles, aiJutsuLoadout, buildBasicCombatAiRules } from "./lib/combat-ai";
import { claimPendingWarCrates, damageSectorTerritory, extendHollowGateUnlock, grantTerritoryScrolls, hydrateSharedGameState, hydrateSharedWorldState, isHollowGateUnlocked, loadVillageState, normalizeVillageState, persistSharedGameState, recordVillageWarPvp, recordVillageWarRaid, saveVillageState, sectorRaidDamageAmount, setSharedGameStateOwnerName, unlockVillageKageSystem } from "./lib/world-state";
import { masteryBonus } from "./lib/profession-mastery";
import { StartScreen } from "./screens/StartScreen";
import { PetBattleAvatar } from "./components/PetBattleAvatar";
import { OnboardingCoach } from "./components/OnboardingCoach";
import { ScreenHint } from "./components/ScreenHint";
import { Village } from "./screens/Village";

// ─── Core game types ─────────────────────────────────────────────────────
// Extracted to src/types/core.ts so screens / components can reach them
// without dragging in the full App.tsx import surface. We re-export the
// public ones below so existing `import { Profession } from "../App"` call
// sites keep resolving identically.
import {
    type Profession,
    type Screen,
    type Rank,
    type Biome,
    type JutsuType,
    type JutsuElement,
    type JutsuTarget,
    type WeatherType,
    type AdminAccount,
    type AdminRole,
} from "./types/core";
import {
    type PetRarity,
    type Pet,
} from "./types/pet";
import {
    type Stats,
    type Jutsu,
    type EquipmentSlot,
    type ArmorQuality,
    type GameItem,
    type SavedBloodline,
    type ReviewBloodline,
    type ActiveTraining,
    type ActiveJutsuTraining,
} from "./types/combat";
import type { CreatorEvent, StoryStep } from "./types/vn";
import {
    type HollowGateTileKind,
    type HollowGateTerrain,
    type HollowGateTile,
    type HollowGateShrineRun,
    type EndlessTowerRun,
    type Character,
    type PlayerRecord,
    type ServerPlayerSummary,
} from "./types/character";
import {
    type AiLoadoutId,
    type CreatorAi,
} from "./types/creator-ai";
import {
    type CreatorMission,
    type CreatorRaid,
} from "./types/missions";
export type {
    Profession,
    Screen,
    Rank,
    JutsuTarget,
    AdminAccount,
    AdminRole,
    Pet,
    Stats,
    Jutsu,
    EquipmentSlot,
    ArmorQuality,
    GameItem,
    Character,
    PlayerRecord,
    EndlessTowerRun,
};

// ─── Game constants ──────────────────────────────────────────────────────
// Extracted to src/constants/game.ts. Re-exported here so existing
// "../App" imports keep working.
import {
    WORLD_STATE_API,
    GAME_STATE_API,
    MAX_LEVEL,
    STARTING_STAT_POINTS,
    JUTSU_MAX_LEVEL,
    STORAGE,
    PLAYER_ACCOUNTS_STORAGE,
    AWAKENING_VN_ID,
    AURA_SPHERE_VN_ID,
    AURA_SPHERE_ITEM_ID,
    DUNGEON_VN_ID,
    DUNGEON_KEY_ID,
    DUNGEON_LEGENDARY_RELIC_ID,
    DUNGEON_LEGENDARY_FRAGMENT_ID,
    VEIL_OF_THE_HOLLOW_ID,
    HOLLOW_GATE_KEY_ID,
    HOLLOW_GATE_MAX_FLOOR,
    WARFORGED_RELIC_ID,
    LEGENDARY_WAR_CRATE_ID,
    PROTECTED_ADMIN_USERNAME,
    isProtectedAdminName,
} from "./constants/game";
export {
    PROTECTED_ADMIN_USERNAME,
    isProtectedAdminName,
    JUTSU_MAX_LEVEL,
    DUNGEON_KEY_ID,
    WARFORGED_RELIC_ID,
    LEGENDARY_WAR_CRATE_ID,
};

// Profession + Vanguard constants extracted to src/constants/profession.ts.
import {
    VANGUARD_SEALS_PER_KILL,
    VANGUARD_DAILY_SEAL_CAP,
    VANGUARD_PER_TARGET_DAILY_CAP,
    ANTI_ALT_ACCOUNT_AGE_MS,
    PROFESSION_XP_BASELINE,
    PROFESSION_XP_HEALER,
    PROFESSION_MAX_RANK,
} from "./constants/profession";
export {
    VANGUARD_DAILY_SEAL_CAP,
    VANGUARD_PER_TARGET_DAILY_CAP,
    PROFESSION_MAX_RANK,
};

// Hunter rank tables extracted to src/constants/hunter.ts.
import {
} from "./constants/hunter";

// Clan-war lookup tables (CW_HP_MAX / CW_DAMAGE) live in src/constants/clan.ts;
// consumed directly by components/ClanWarsPanel now, no longer by App.

// Achievement table extracted to src/constants/achievements.ts.
import { type Achievement, ACHIEVEMENTS, achievementReward } from "./constants/achievements";
import { nextEarnedTitles } from "./lib/earned-titles";

// Pet Arena grid + obstacle layouts + type-effectiveness moved to
// src/constants/pet-arena.ts.
import {
    PET_GRID_COLS,
    PET_GRID_SIZE,
    PET_SPAWN_1V1,
} from "./constants/pet-arena";

// Tiny presentational mark / portrait components moved to ./components/Marks.

// Pure element/awakening helpers extracted to ./lib/elements.
import {
    getCharacterElements,
} from "./lib/elements";
// hasCharacterElement is imported above for internal use; external callers
// (screens/Inventory) now import it directly from ./lib/elements.

// Pure pet helpers extracted to ./lib/pet (imported below for internal use;
// external callers import petDisplayName directly from ./lib/pet).
import {
    isPetOnExpedition,
} from "./lib/pet";
import { buildAcceptedArenaMatch } from "./lib/arena-challenge";
import { isPetSfxMuted, setPetSfxMuted } from "./lib/pet-sfx";
import { stopBattleMusic } from "./lib/pet-music";
import { buildPetAnimationEvents, petPoseForAvatar, elementVfxKey } from "./lib/pet-battle-anim";
import { petBattleCamera, petCameraHoldMs } from "./lib/pet-battle-camera";
import { usePetBattleFrameSfx } from "./lib/use-pet-battle-sfx";
import { PetParticleField, vfxBurstForEvent } from "./lib/pet-vfx-particles";
import { petFxSpriteKey } from "./lib/jutsu-vfx";
import { bundledJutsuFxFrames } from "./lib/jutsu-fx-assets";
import { petArchetypeFor, petTacticalZone, type ArenaTile } from "./lib/pet-tactics";
import { collectActorStatuses, BATTLE_STATUS_DEFS } from "./lib/pet-moves";

// Pet autobattler simulation engine (BFS pathfinding, action AI, seeded
// combat math, 1v1 + 2v2 simulators) extracted to ./lib/pet-battle-sim.
// runPetArenaBattle + petFramePace were exported from App.tsx directly and
// are consumed by petvfx.tsx via "./App" — re-exported so those keep resolving.
import {
    tileDistance,
    petFramePace,
    runPetArenaBattle,
    pickBestPartyOrder,
} from "./lib/pet-battle-sim";
export { runPetArenaBattle, petFramePace };
export type { PetPartyBattleMatch, PetPartyBattleResult } from "./lib/pet-battle-sim";

// Equipment helpers + tables extracted to ./lib/equipment (imported above for
// internal use). armorReductionForQuality + consolidateItemBonuses stay
// re-exported for the screens/Inventory "../App" import site; the slot
// normalize/label helpers are imported directly from ./lib/equipment.
import {
    armorReductionForQuality,
    consolidateItemBonuses,
} from "./lib/equipment";
export { armorReductionForQuality, consolidateItemBonuses };

// Generic utility helpers (clamp, time format, date keys) extracted to ./lib/utils.
import {
    clampNumber,
    currentMonthKey,
    currentDateKey,
    makeId,
    playerSlug,
} from "./lib/utils";

// XP / ranked progression helpers extracted to ./lib/progression. The
// bigger gainXp driver stays in App.tsx because it chains through other
// App-scope helpers (xpNeeded, maxHpForLevel, etc.) not yet extracted.
import {
    effectiveCharacterXpGain,
    rankedDelta, applyServerBaseReward, type PvpWinBaseSummary,
} from "./lib/progression";

// All-users directory screen moved to ./screens/UserHub. Lazy-loaded — accessed
// from the Central Hub menu, not on first paint.
const UserHub = lazyWithRetry(() => import("./screens/UserHub").then(m => ({ default: m.UserHub })));
const Messages = lazyWithRetry(() => import("./screens/Messages").then(m => ({ default: m.Messages })));
// Read-only profile screen for viewing other players moved to ./screens/UserView.
// Lazy-loaded — only mounts when the player clicks into another player's profile.
const UserView = lazyWithRetry(() => import("./screens/UserView").then(m => ({ default: m.UserView })));
// Mobile banner timer widget moved to ./components/BannerMobileTimers.
import { BannerMobileTimers } from "./components/BannerMobileTimers";
// Mobile-only persistent top status HUD (avatar + bars + Ryo/Shards).
import { MobileStatusHUD } from "./components/MobileStatusHUD";
import { HollowGateShardBar } from "./components/HollowGateShardBar";
// Desktop left-rail profile card moved to ./components/LeftProfileCard.
import { LeftProfileCard } from "./components/LeftProfileCard";
// Static world-map side banner moved to ./components/SectorBanner.
import { SectorBanner } from "./components/SectorBanner";
// Desktop right-rail navigation + mobile bottom nav moved out.
import { RightMenu } from "./components/RightMenu";
import { MobileNav } from "./components/MobileNav";
// Filterable jutsu technique browser moved to ./components/JutsuDropdownList.
// Triggered visual-novel reader moved to ./components/TriggeredVisualNovel.
import { TriggeredVisualNovel } from "./components/TriggeredVisualNovel";
// Hollow Gate atlas tile picker (admin) moved to ./components/KenneyAtlasPicker.
// Training screens (stat + jutsu training) moved to ./screens/Training.
const Training = lazyWithRetry(() => import("./screens/Training").then(m => ({ default: m.Training })));
const JutsuTrainingHall = lazyWithRetry(() => import("./screens/Training").then(m => ({ default: m.JutsuTrainingHall })));
// Shop / Grand Marketplace / card packs moved to ./components/Shop.
const Shop = lazyWithRetry(() => import("./components/Shop").then(m => ({ default: m.Shop })));
const GrandMarketplace = lazyWithRetry(() => import("./components/Shop").then(m => ({ default: m.GrandMarketplace })));

// Canonical game-item catalog moved to ./data/starter-items.
import { starterItems } from "./data/starter-items";
// Raw pet templates moved to ./data/pet-pool. The balancer transform that
// scales them against the global stat caps stays in App.tsx and is
// applied below where petPool is defined.
import { rawPetPool } from "./data/pet-pool";
import { STARTER_PETS } from "./data/starter-pets";
import { STARTER_EVOLUTIONS } from "./data/pet-evolutions";
// Per-village storyline arc + milestone constructors moved to ./data/storylines.
import { storylines, villageBiomeMap, getCurrentStory } from "./data/storylines";
// Built-in VN event templates moved to ./data/vn-events.
import {
    awakeningLv2VnEvent,
    auraSphereLv9VnEvent,
    hiddenDungeonVnEvent,
} from "./data/vn-events";
// World terrain + weather tables moved to ./data/world.
import {
    weatherEffects,
} from "./data/world";
// Pet config tables (traits, training, expedition, feed items) moved to ./data/pet-config.
import {
    petRarityOrder,
    petTrainingOptions,
    petTreatItems,
    stackableItemIds,
    petFeedXpForItem,
} from "./data/pet-config";
// Keep external-import compatibility — petTrainingOptions + petFeedXpForItem
// were previously exported from App.tsx directly and consumed via "../App".
// petTraitDescriptions is now imported directly from ./data/pet-config by
// components/PetBattleAvatar.
export { petTrainingOptions, petFeedXpForItem };

// Hollow Gate atlas configuration moved to ./data/hollow-gate-atlas.
import {
    HOLLOW_GATE_ICON_ROLES,
    HOLLOW_GATE_ICON_KEY,
} from "./data/hollow-gate-atlas";


// weatherForBiome + biomeForWorldSector moved to ./data/sectors. They're
// pure lookups so they relocate cleanly. weatherForSector stays here
// because it reads dynamic territory state via loadSectorTerritory.
import {
    villages,
    weatherForBiome,
} from "./data/sectors";
// villages + weatherForBiome imported above for internal use; external callers
// (screens/CharacterCreator) import villages directly from ./data/sectors.

export type DuelChallenge = {
    id: string;
    fromName: string;
    toName: string;
    challenger: Character;
    challengerJutsus?: Jutsu[];
    challengerBloodlineMult?: number;
    challengerPetId?: string; // which pet the challenger is using for pet battles
    petBattleSeed?: number;
    responderPetId?: string;
    responderPet?: Pet;
    // ── 2v2 Pet Party extensions ──────────────────────────────────────
    // When set, the pet battle resolves as a 2-pet party set (lead + reserve)
    // via runPetArenaParty. Both fields are optional so old 1v1 challenges
    // remain valid. The responder's two pets are auto-selected at accept
    // time (top two by level) — no protocol change needed for them.
    petParty?: boolean;
    challengerPetIds?: [string, string];
    responderPetIds?: [string, string];
    responderParty?: [Pet, Pet];
    // Tactical Arena PvP challenge — deterministic teams + seed; see lib/arena-challenge.
    arenaMatch?: boolean;
    arenaSize?: 2 | 4;
    challengerTeamIds?: string[];
    responderTeam?: Pet[];
    createdAt: number;
    mode?: "standard" | "ranked" | "clanWar1v1" | "clanWar2v2" | "clanWarPet" | "rankedPet";
    clanWarPoints?: number;
    // Pet ranked 1v1 — each side's account-level petRankedRating snapshot at
    // challenge time, so the winner/loser can compute symmetric Elo deltas
    // without an extra round-trip. challengerPetRating = the challenge sender.
    challengerPetRating?: number;
    responderPetRating?: number;
    // Server-minted pet-ranked match token (/api/pet/ranked-start). Minted by
    // the challenger and carried to both sides (rides the accepted-notice
    // spread) so the petRankedRating swing settles server-side exactly once
    // (server NX-dedups per token). Absent → local Elo fallback.
    petRankedToken?: string;
    sectorAttack?: boolean; // true = initiated from world-map sector, auto-routes defender
    kageChallengeId?: string;
    kageVillage?: string;
    battleId?: string;     // if set, both players join a shared PvP session instead of separate arenas
    accepted?: boolean;    // true = defender accepted spar/ranked, routes original challenger to pvpBattle as p1
    declined?: boolean;
};

export type SharedPvpBattleContext = {
    mode?: DuelChallenge["mode"];
    clanWarPoints?: number;
    sectorAttack?: boolean;
    raidKind?: "raidPlayer" | "defense";
    sector?: number;
    kageChallengeId?: string;
    kageVillage?: string;
    // Set when the PvP session was launched via a new-system clan-war
    // challenge so the battle screen can wire the post-battle report.
    clanWarChallengeId?: string;
};

// Creator AI definition types (AiCondition, AiAction, AiLoadoutId, AiRule,
// CreatorAi) moved to ./types/creator-ai and imported back near the top of
// this file.

// JutsuTag / Jutsu / EquipmentSlot moved to ./types/combat.
// itemSectionOptions / normalizeEquipmentSlot / equipmentSlotLabel /
// armorQualityTiers / armorReductionForQuality moved to ./lib/equipment.

// Equipment/armor-derived combat stats (armor factor, raw DR, item-bonus sum,
// PvP loadout) + the active-pet trait helper extracted to ./lib/equipment-stats.
import {
    getActivePetTrait,
    getCharacterArmorFactor,
    getCharacterArmorRawDR,
    getEquippedItemBonus,
    getPvpItemLoadout,
} from "./lib/equipment-stats";

// GameItem / EquipmentSlots / SavedBloodline / ReviewBloodline /
// ActiveTraining / ActiveJutsuTraining moved to ./types/combat.

// CreatorEvent + StoryStep (the VN content types) moved to ./types/vn —
// imported at the top of this file and re-exported here so the many
// `import { ... CreatorEvent ... } from "../App"` sites keep working unchanged.
export type { CreatorEvent, StoryStep };

// Creator mission/raid content types (MissionRank, CreatorMission, CreatorRaid)
// moved to ./types/missions and imported back near the top of this file.

type PlayerAccountSave = {
    // Legacy: plaintext password (no-token deployments only). Token-issuing
    // servers store `token` instead and never persist this (audit M5).
    password?: string;
    // Per-account session token (24h). Present once the account has logged into
    // a token-issuing server; supersedes `password`.
    token?: string;
    snapshot?: {
        character: Character;
        currentBiome: Biome;
        activeTraining: ActiveTraining | null;
        activeJutsuTraining?: ActiveJutsuTraining | null;
        acceptedMissionIds: string[];
        missionProgress: Record<string, number>;
        triggeredEvents: string[];
        pendingAiProfileId: string;
        currentSector?: number;
    };
};

type PlayerAccounts = Record<string, PlayerAccountSave>;

// StoryStep moved to ./types/vn (re-exported with CreatorEvent above).

export type PendingArenaStoryBattle =
    | {
        kind: "storyBoss";
        step: StoryStep;
        returnScreen: Screen;
    }
    | {
        kind: "triggeredEvent";
        event: CreatorEvent;
        battle?: NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>[number]["battle"];
        returnScreen: Screen;
    }
    | {
        kind: "dungeonAi";
        returnScreen: Screen;
    }
    | {
        kind: "hollowGateShrine";
        returnScreen: Screen;
        isBoss?: boolean;
        isAmbush?: boolean;
    }
    | {
        // Weekly Boss arena fight. Boss has an effectively unlimited HP
        // pool (set at fight start) so the player can never win — they
        // fight until KO/flee, then the damage dealt this round is
        // posted to /api/weekly-boss as a logFight entry.
        kind: "weeklyBoss";
        returnScreen: Screen;
        bossInitialHp: number;
    }
    | {
        // Academy Sparring Match — the onboarding "guaranteed first win".
        // A deliberately weak Lv-1 training dummy (low HP, Lv-1 offense) so a
        // combat-ready new player wins in a few hits. On win the spar branch in
        // completePendingArenaStoryBattle advances onboardingStep → "training".
        kind: "academySparring";
        returnScreen: Screen;
    };

// ── Hollow Gate Shrine — crawler dungeon ──────────────────────────────────────
// A tile-based exploration screen revealed by the Kage's one-time Hollow Gate
// unlock. The grid is procedurally generated each entry/floor. Each tile fires
// its event exactly once on reveal; movement bumps a threat meter that can
// trigger an ambush battle at 100. Boss tile fires the Hollow Gate Warden.

// HollowGateTileKind / HollowGateTerrain / HollowGateTile / HollowGateShrineRun
// moved to ./types/character (co-located with Character.hollowGateRun) and
// imported at the top of this file.

// HOLLOW_GATE_SHRINE_W / H moved to ./constants/game.
// Runtime-tunable from the admin panel.
export let HOLLOW_GATE_THREAT_PER_STEP = 7;
export let HOLLOW_GATE_THREAT_AMBUSH = 100;
// HOLLOW_GATE_MAX_FLOOR moved to ./constants/game so ./lib/hollow-gate-dungeon
// can read it without importing App (keeps the generator unit-testable).
// Admin-tuned at runtime from screens/AdminPanel (an imported binding cannot be
// reassigned cross-module, so the setters live beside the lets).
export function setHollowGateThreatPerStep(v: number) { HOLLOW_GATE_THREAT_PER_STEP = v; }
export function setHollowGateThreatAmbush(v: number) { HOLLOW_GATE_THREAT_AMBUSH = v; }

// Hollow Gate intro pages + flavor + tile-icon helpers from
// ./data/hollow-gate-flavor (imported for internal use). External callers
// (KenneyAtlasPicker) import hollowGateTileIconForKind directly from the
// data module.
import {
    hollowGateIntroPages,
    hollowGateFlavorFor,
    hollowGateTileIconForKind,
} from "./data/hollow-gate-flavor";

// hollowGateReachableSet + bsp* geometry helpers (./lib/hollow-gate-bsp) are
// now consumed directly by ./lib/hollow-gate-dungeon, not App.tsx.

// Hollow Gate shrine dungeon generation (ASCII-layout parser, BSP fallback,
// visibility, ancient-chest loot, encounter-pet roll) extracted to
// ./lib/hollow-gate-dungeon. It reads HOLLOW_GATE_MAX_FLOOR from ./constants/game
// (a live, admin-tunable binding) so the generator stays App-free + testable.
import {
    generateHollowGateShrineRun,
    computeHollowGateVisible,
    rollHollowGateAncientChest,
    pickHollowGateEncounterPet,
} from "./lib/hollow-gate-dungeon";
import { snapshotHollowGateCurrencies, clawBackHollowGateLoot, hollowShardDrop, hollowGateClawBackPreview } from "./lib/hollow-gate-run";
import { beginHollowGateServerRun, resumeHollowGateServerRun, finalizeHollowGateRunEnd, settleHollowGateRunOnly, hollowGateAugmentEffects, hollowGateServerEnabled, startHollowGateServerRun, attachStartedRun } from "./lib/hollow-gate-server";
import { wingEntryEffect, wingThemeAt, WING_TINT, WING_GLYPH } from "./lib/hollow-gate-wings";
import { tryHollowGateSecondWind } from "./lib/hollow-gate-shards";
import { applyAttunementToRun, attunementLootRetention, attunementDailyBonus } from "./lib/hollow-gate-attunement";
// Hollow Gate ASCII layouts + shrine dungeon generators moved to
// ./lib/hollow-gate-dungeon — imported above.

// hollowGateTileIconForKind moved to ./data/hollow-gate-flavor.

// ── Atlas icon slots ───────────────────────────────────────────────────────
// Maps a "role" in the dungeon UI to a KV key under which an atlas sprite
// can be stored. When the renderer / legend find the corresponding image in
// `sharedImages`, they overlay it instead of the emoji fallback above.
//
// Each content role can have multiple variants (battle-1, battle-2, ...) so
// the dungeon stops looking like 6 photocopies of the same monster. The
// renderer picks one of the assigned variants deterministically by tile
// index hash — so each cell is stable across renders, but adjacent cells of
// the same role show different sprites.
//
// Slots are filled via the Atlas Tile Picker (admin panel): the admin
// selects a slot, clicks a tile in the atlas, and the picker slices that
// 16×16 tile out of the atlas and publishes it under shrine:icon-<id>.

export type EventEncounterBattle = NonNullable<NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>[number]["battle"]>;
type PendingEventEncounter = {
    event: CreatorEvent;
    battle?: EventEncounterBattle;
};

// MAX_LEVEL / MAX_STAT moved to ./constants/game.

// defaultVnPortrait + defaultVnScene moved to ./lib/vn.

// Achievement / AchievementCategory types + ACHIEVEMENTS table moved to
// ./constants/achievements — imported at the top of this file.
// STARTING_STAT_POINTS / CHARACTER_XP_GAIN_MULTIPLIER / AWAKENING_*_ID /
// AWAKENING_ELEMENTS / STUN_AP_PENALTY moved to ./constants/game.
// STAT_KEYS + the character stat/level math moved to ./lib/stats (imported
// back above; xpNeeded re-exported).
// rollAwakeningElement / elementIcon / uniqueElements /
// getCharacterElements / hasCharacterElement moved to ./lib/elements.
// Bloodline lookup + access-control helpers moved to ./lib/bloodline.
// They import starterSavedBloodlines back from this file (re-exported
// above the table). All call sites in App.tsx keep the same names.
import {
} from "./lib/bloodline";
// rollNewAwakeningElement / rollAwakeningElements moved to ./lib/elements.
// JUTSU_MAX_LEVEL / JUTSU_TRAINING_CAP / STORAGE / PLAYER_ACCOUNTS_STORAGE /
// HP_CAP / CHAKRA_CAP / STAMINA_CAP moved to ./constants/game.
// jutsuResourceCostPercentByAp + jutsu mastery/cost/scaling helpers moved to
// ./lib/jutsu-scaling.

// villages + villageOutskirtsSectorNumber + villageForOutskirtsSector moved
// to ./data/sectors. villagePageImage stays here because it pulls in image
// asset imports that the lib shouldn't pollute.
export function villagePageImage(villageName: string): string {
    if (villageName === "Stormveil Village") return stormveilVillageImg;
    if (villageName === "Ashen Leaf Village") return houseImg;
    if (villageName === "Frostfang Village") return castleImg;
    if (villageName === "Moonshadow Village") return moonshadowImage;
    return stormveilVillageImg;
}
// villageLore lives in ./data/village-lore; screens/VillageLoreScreen imports
// it directly from there. villagePageImage above stays — it pulls in
// image-asset imports the data module shouldn't.
// specialties + jutsuElements live in ./data/jutsu (imported above for internal
// use; JutsuDropdownList imports them directly from ./data/jutsu).
// adminIconOptions moved to ./data/admin-icons; re-exported for existing importers.
export { adminIconOptions } from "./data/admin-icons";
// worldSectorOptions moved to ./data/sectors (imported at top).
// starterBloodlines + starterBloodlineOffense + the starter jutsu/bloodline
// catalog (starterJutsus, starterSavedBloodlines, nonBloodlineTagTable +
// rebalanceNonBloodlineJutsu) moved to ./data/jutsu (imported/re-exported above).
// petDisplayName / petHappiness / isPetOnExpedition / petCombatDamage /
// increasePetHappiness / petVariantIndex moved to ./lib/pet.
// Pet balance + training + XP + cloning + event scaling helpers moved to
// ./lib/pet-balance. petPool / mergeMissingBuiltInPets / normalizePet
// stay here because they close over the petPool array (which itself is
// derived via balanceBuiltInPetTemplate from the imported lib).
import {
    balanceBuiltInPetTemplate,
    registerPublishedPetTemplates, normalizePetTemplate, renormalizedIfChanged,
    rollPetTrait,
    applyPetTraitBonuses,
    collectPetTraining,
    gainPetXp,
    scaleEventPetOpponent,
} from "./lib/pet-balance";
export { gainPetXp, collectPetTraining };
// Pet element/special jutsu tables + balance/training/XP helpers all
// moved to ./lib/pet-balance — imported above. See that file for the
// element → effect mapping and the per-rarity special jutsu spec tables.
// useSharedNow + the shared-now ticker moved to ./lib/use-shared-now;
// re-exported for existing importers (BannerMobileTimers, LeftProfileCard).
export { useSharedNow } from "./lib/use-shared-now";

// formatPetTimer moved to ./lib/utils.
// Raw pet templates (./data/pet-pool) are scaled by the balancer; the 5 starter
// companions AND their 10 evolved templates (data/starter-pets, pet-evolutions)
// are appended UNBALANCED (hand-authored stats/kits). Both are surfaced in the
// admin Pet Editor for imaging and seeded into editablePets, but excluded from
// wild encounters by isWildSpawnable — a starter or evolution never shows up as
// a random wild beast.
const petPool: Pet[] = [
    ...rawPetPool.map(balanceBuiltInPetTemplate),
    ...STARTER_PETS.map((option) => option.pet),
    ...STARTER_EVOLUTIONS,
];

function mergeMissingBuiltInPets(currentPets: Pet[]): Pet[] {
    const currentIds = new Set(currentPets.map((pet) => pet.id));
    const missingBuiltInPets = petPool.filter((pet) => !currentIds.has(pet.id));

    return [...currentPets, ...missingBuiltInPets];
}

// normalizePet's logic lives in ./lib/pet-balance (normalizePetTemplate); here we
// only bind the App-local petPool (balanced rawPetPool + starters/evolutions) as
// its baseline fallback. cloneEncounterPet + the published-template registry also
// live in ./lib/pet-balance.
function normalizePet(pet: Pet): Pet {
    return normalizePetTemplate(pet, petPool);
}
// eventPetDifficultyMultiplier + scaleEventPetOpponent moved to ./lib/pet-balance.
// starterBloodlineOffense moved to ./data/jutsu (imported back above).

// Tag tables + tag-name/effect helpers extracted to ./lib/tags. They are
// imported back near the top of this file for internal use; the public symbols
// are re-exported here so existing `import { ... } from "../App"` sites keep
// resolving unchanged.
export { percentageTags, cappedDamageTags, binaryTags, allTags, tagCapForRank };

// ── Non-bloodline (starter) balance table ────────────────────────────────
// Every element owns one of all 13 offense effects + Shield + Increase Heal,
// each discipline carries an identical offense load, and Siphon + Wound — the
// two tags that compute off THIS jutsu's hit damage — live only on the 60AP
// (single-tag) variant, since 40AP jutsu deal 0 base damage and would render
// them inert.
//
// Variant suffix → AP tier: a 1-tag entry is the 60AP damage variant; a 2-tag
// entry is a 40AP utility pair. Move stays on the two movement jutsu.
// (starter jutsu/bloodline catalog moved to ./data/jutsu — see note above.)

export const defaultPetEncounterVn: CreatorEvent = {
    id: "sys-pet-encounter",
    name: "Pet Encounter",
    biome: "forest",
    icon: "⚔",
    eventKind: "visualNovel",
    trigger: "manual",
    levelReq: 1,
    xpReward: 0,
    ryoReward: 0,
    staminaReward: 0,
    dialogue: [],
    vnTitle: "A Presence in the Shadows",
    vnScene: "The rustling of leaves breaks the silence of the sector.",
    vnSpeaker: "Narrator",
    vnPages: [
        {
            title: "A Presence in the Shadows",
            scene: "The rustling of leaves breaks the silence of the sector.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: Something stirs at the edge of your senses.",
                "Narrator: A warmth — not from fire, but from living breath nearby.",
                "Narrator: You stop moving. So does it.",
            ],
            choices: [],
        },
        {
            title: "The Creature Reveals Itself",
            scene: "A creature emerges from the undergrowth, watching you carefully.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: Eyes catch yours — ancient, curious, unafraid.",
                "Narrator: It does not run. It does not attack.",
                "Narrator: It simply waits.",
            ],
            choices: [],
        },
        {
            title: "A Choice Before You",
            scene: "The creature tilts its head as if asking a question only it understands.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: Shinobi learn to read animals the way they read the wind.",
                "Narrator: This one is not lost. It chose to find you.",
                "Narrator: The question is — will you let it stay?",
            ],
            choices: [],
        },
    ],
};

export const defaultAncientChestVn: CreatorEvent = {
    id: "sys-ancient-chest",
    name: "Ancient Chest",
    biome: "forest",
    icon: "⚔",
    eventKind: "visualNovel",
    trigger: "manual",
    levelReq: 1,
    xpReward: 0,
    ryoReward: 0,
    staminaReward: 0,
    dialogue: [],
    vnTitle: "Something Stirs in the Ruins",
    vnScene: "Deep within the wilderness, a faint shimmer catches your eye.",
    vnSpeaker: "Narrator",
    vnPages: [
        {
            title: "Something Stirs in the Ruins",
            scene: "Deep within the wilderness, a faint shimmer catches your eye.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: You pause. Something between the rubble is glowing.",
                "Narrator: Half-buried under centuries of earth and stone — an ancient chest.",
                "Narrator: These runes... pre-war era seals. This thing has been here a long time.",
                "Narrator: The chakra lock flickers as you approach, as if recognizing your presence.",
                "Narrator: Whoever left this... they wanted someone strong enough to find it.",
                "Narrator: You press your hand to the seal. It dissolves at your touch.",
            ],
            choices: [],
        },
        {
            title: "The Chest Opens",
            scene: "Golden light spills from the ancient chest as the seal breaks.",
            speaker: "Narrator",
            dialogue: [
                "Narrator: The lid swings open with a low resonant hum.",
                "Narrator: Inside — preserved by chakra for decades — the chest reveals its contents.",
                "Narrator: ...I wasn't expecting this.",
                "Narrator: The ancient shinobi who sealed this chest left something worth finding.",
            ],
            choices: [],
        },
    ],
};

// starterItems moved to ./data/starter-items — imported at the top of this file.

// Item catalog + treasury/inventory helpers (getAllItems, getItemById,
// itemDisplayName, armor sanitizers, treasury + inventory mutators) extracted
// to ./lib/items. The symbols still referenced here are imported back near the
// top of this file; getAllItems and getItemById are re-exported for the
// Inventory screen's "../App" import site.
export { getAllItems, getItemById };


// Item ID constants moved to ./constants/game.
// HOLLOW_GATE_KEY_DUNGEON_KEY_COST / FATE_SHARD_COST / TRAP_DMG_PCT /
// BOSS_FLOOR_REWARD_MULT are MUTABLE (admin-tunable via let) so they stay
// in App.tsx — moving them to a constants file would break the admin
// panel's runtime mutation.
export let HOLLOW_GATE_KEY_DUNGEON_KEY_COST = 5;
export let HOLLOW_GATE_KEY_FATE_SHARD_COST = 10;
export function setHollowGateKeyDungeonKeyCost(v: number) { HOLLOW_GATE_KEY_DUNGEON_KEY_COST = v; }
export function setHollowGateKeyFateShardCost(v: number) { HOLLOW_GATE_KEY_FATE_SHARD_COST = v; }
// Damage taken per trap tile (and "Cursed Bind" sealed-door outcome), as a
// percent of the player's max HP. Lethal-capable.
export let HOLLOW_GATE_TRAP_DMG_PCT = 0.33;
export function setHollowGateTrapDmgPct(v: number) { HOLLOW_GATE_TRAP_DMG_PCT = v; }
// Per-floor reward multiplier for boss kills: total mult = 1 + (floor - 1) * this.
export let HOLLOW_GATE_BOSS_FLOOR_REWARD_MULT = 0.2;
export function setHollowGateBossFloorRewardMult(v: number) { HOLLOW_GATE_BOSS_FLOOR_REWARD_MULT = v; }

/**
 * Check both clan war history and the village war cache for unclaimed war crates.
 * Returns an updated character with any newly-found crates added, plus a count.
 * Safe to call repeatedly — already-claimed IDs are tracked in claimedWarCrateIds.
 */

export function statPointsEarnedFromXp(character: Character, amount: number) {
    const before = statPointBudgetForProgress(character.level, character.xp);
    const after = progressAfterXp(character.level, character.xp, effectiveCharacterXpGain(character, amount));
    return Math.max(0, statPointBudgetForProgress(after.level, after.xp) - before);
}

// normalizeStats / allocatedStatPoints / formatStatName /
// reconcileCharacterStatBudget / scaleStat moved to ./lib/stats.

// AI opponent stat scaling (aiStatsForLevel, aiHpForLevel, armor factors,
// aiPrimaryJutsuType) moved to ./lib/ai-stats (imported back above).

// addToAllStats / maxedStats moved to ./lib/stats (imported back above).

export function isAdminAccountName(name?: string): name is AdminAccount {
    return name === "Admin 1" || name === "Admin 2";
}

function normalizeAdminCharacter(character: Character): Character {
    const normalized = normalizeCharacter(character);
    if (!isAdminAccountName(normalized.name)) return normalized;
    return {
        ...normalized,
        stats: maxedStats(),
        unspentStats: 0,
    };
}

function examLevelCap(character: Character): number {
    const passed = character.examsPassed ?? [];
    for (const gate of EXAM_LEVEL_GATES) {
        if (!passed.includes(gate.exam)) return gate.level;
    }
    return MAX_LEVEL;
}

export function gainXp(character: Character, amount: number): Character {
    const totalAmount = effectiveCharacterXpGain(character, amount);
    const levelCap = examLevelCap(character);
    let updated: Character = reconcileCharacterStatBudget(character);
    updated = { ...updated, xp: updated.level >= MAX_LEVEL ? 0 : updated.xp + totalAmount };
    while (updated.level < MAX_LEVEL && updated.level < levelCap && updated.xp >= xpNeeded(updated.level)) {
        const needed = xpNeeded(updated.level);
        const newLevel = updated.level + 1;
        const nextMaxHp = maxHpForLevel(newLevel);
        const nextMaxChakra = maxChakraForLevel(newLevel);
        const nextMaxStamina = maxStaminaForLevel(newLevel);
        updated = {
            ...updated,
            xp: updated.xp - needed,
            level: newLevel,
            rankTitle: rankTitleForLevel(updated, newLevel),
            maxHp: nextMaxHp,
            maxChakra: nextMaxChakra,
            maxStamina: nextMaxStamina,
            hp: nextMaxHp,
            chakra: nextMaxChakra,
            stamina: nextMaxStamina,
        };
    }
    // If capped by exam gate, clamp XP so it doesn't overflow past the level threshold
    if (updated.level >= levelCap && updated.level < MAX_LEVEL) {
        updated = { ...updated, xp: Math.min(updated.xp, xpNeeded(updated.level) - 1) };
    }
    if (updated.level >= MAX_LEVEL) {
        updated = { ...updated, level: MAX_LEVEL, xp: 0, rankTitle: rankTitleForLevel(updated, MAX_LEVEL) };
    }
    return reconcileCharacterStatBudget(updated);
}

// Honor Seals are exclusively a Vanguard reward. Every grant site (PvP,
// raids, village agenda, map control, Hollow Gate, etc.) wraps the would-be
// gain in this helper so non-Vanguards always earn 0.
export function vanguardOnlyHonorSeals(character: Character | null | undefined, amount: number): number {
    if (!character || character.profession !== "vanguard") return 0;
    return Math.max(0, Math.floor(amount));
}

// Companion grants for any site that pays Honor Seals. Honor Seals are
// Vanguard-only, but the bone-charm and fate-shard bonuses apply to
// EVERY profession: Honor Seals end up being used for everyone in some
// way, so Vanguards also receive the same charm + shard payout. The
// `character` parameter is kept for signature stability with older
// call sites but no longer filters by profession.
//   • Bone Charms: 8:1 with a minimum of 1 if any seals were earned,
//     so even tiny grants (daily Village Agenda) leave something
//     behind.
//   • Fate Shards: 25:1 with NO minimum, so small grants don't mint
//     shards and inflate the rare-currency pile; big payouts
//     (war MVP at 50 seals, boss kills, full-village map control)
//     actually feed it.
export function bonusBoneCharmsForHonor(_character: Character | null | undefined, honorSealAmount: number): number {
    const n = Math.max(0, Math.floor(honorSealAmount));
    if (n === 0) return 0;
    return Math.max(1, Math.floor(n / 8));
}

export function bonusFateShardsForHonor(_character: Character | null | undefined, honorSealAmount: number): number {
    const n = Math.max(0, Math.floor(honorSealAmount));
    if (n === 0) return 0;
    return Math.floor(n / 25);
}

// Legacy aliases — preserved so prior call sites keep compiling while
// the codebase migrates. New code should use the `bonus...` names.
export const nonVanguardCharmSubstitute = bonusBoneCharmsForHonor;
export const nonVanguardShardSubstitute = bonusFateShardsForHonor;

// ── Profession combat bonuses ────────────────────────────────────────────
// Pet Tamer PvE pet damage mult (+5% unlock, +1.5%/rank, +Savagery mastery); PvE only.
export function petTamerPveMultiplier(character: Character | null | undefined): number {
    if (!character || character.profession !== "petTamer") return 1;
    const rank = Math.max(0, Math.min(PROFESSION_MAX_RANK, character.professionRank ?? 1));
    // Unlock = +5%; rank 1 = +6.5%; rank 10 = +20%.
    const bonusPct = 5 + rank * 1.5 + masteryBonus(character, "petPveDamagePct");
    return 1 + bonusPct / 100;
}

// VANGUARD_SEALS_PER_KILL / VANGUARD_DAILY_SEAL_CAP /
// VANGUARD_PER_TARGET_DAILY_CAP moved to ./constants/profession.

// Vanguard XP per PvP kill: 100 base + 10 per target level above 30.
export function vanguardXpForKill(opponent: Character | null | undefined): number {
    if (!opponent) return 0;
    const lvl = Number(opponent.level ?? 1);
    return 100 + 10 * Math.max(0, lvl - 30);
}

// ANTI_ALT_ACCOUNT_AGE_MS moved to ./constants/profession.
function targetTooYoungForRewards(opponent: Character | null | undefined): boolean {
    if (!opponent?.createdAt) return false;
    return (Date.now() - opponent.createdAt) < ANTI_ALT_ACCOUNT_AGE_MS;
}

// Apply level-gap rule from docs/professions.md anti-abuse table:
//   within 10 levels = full reward; 10-20 below = 50%; >20 below = 0.
// "Below" is from the attacker's perspective.
function levelGapSealMultiplier(attackerLevel: number, opponentLevel: number): number {
    const gap = attackerLevel - opponentLevel;
    if (gap > 20) return 0;
    if (gap > 10) return 0.5;
    return 1;
}

// Pet Tamer Phase 2 bonuses (client-side). Training speed % faster, expedition
// reward multiplier, daily First Expedition 2x flag.
export function petTamerTrainingSpeedPct(character: Character | null | undefined): number {
    if (!character || character.profession !== "petTamer") return 0;
    const rank = Math.max(0, Math.min(PROFESSION_MAX_RANK, character.professionRank ?? 1));
    // Unlock 10%; +1%/rank to 20% at L10; +Drill Sergeant mastery (PvE/utility).
    return 10 + rank + masteryBonus(character, "petTrainTimePct");
}

export function petTamerExpeditionMult(character: Character | null | undefined): number {
    if (!character || character.profession !== "petTamer") return 1;
    const rank = Math.max(0, Math.min(PROFESSION_MAX_RANK, character.professionRank ?? 1));
    // Unlock +10%; +1.5% per rank to +25% at rank 10.
    return 1 + (10 + rank * 1.5) / 100;
}

// Returns true if this is the first expedition the player has claimed today
// (UTC). Updates `lastExpeditionClaimDate` and `expeditionsClaimedToday` on
// the returned character.
export function petTamerClaimFirstExpeditionToday(character: Character, todayKey: string): { isFirst: boolean; nextCharacter: Character } {
    const sameDay = character.lastExpeditionClaimDate === todayKey;
    const count = sameDay ? (character.expeditionsClaimedToday ?? 0) : 0;
    const isFirst = character.profession === "petTamer" && count === 0;
    return {
        isFirst,
        nextCharacter: {
            ...character,
            lastExpeditionClaimDate: todayKey,
            expeditionsClaimedToday: count + 1,
        },
    };
}

// Compute Honor Seals earned for a PvP kill given Vanguard rank, level gap,
// daily cap, and per-target cap. Returns {amount, byTarget} where byTarget is
// the new count for that target today.
export function vanguardSealsForKill(
    killer: Character,
    opponent: Character,
    todayKey: string,
): { amount: number; updatedByTarget: Record<string, number> } {
    if (killer.profession !== "vanguard") return { amount: 0, updatedByTarget: killer.dailyHonorSealsByTarget ?? {} };

    // Anti-alt: zero rewards for targets whose account is brand new.
    if (targetTooYoungForRewards(opponent)) {
        return { amount: 0, updatedByTarget: killer.dailyHonorSealsByTarget ?? {} };
    }

    const rank = Math.max(1, Math.min(PROFESSION_MAX_RANK, killer.professionRank ?? 1));
    const baseSeals = VANGUARD_SEALS_PER_KILL[rank];

    const gapMult = levelGapSealMultiplier(killer.level, opponent.level);
    let amount = Math.floor(baseSeals * gapMult);
    if (amount <= 0) return { amount: 0, updatedByTarget: killer.dailyHonorSealsByTarget ?? {} };

    // Daily cap.
    const todayActive = killer.vanguardDailyResetDate === todayKey;
    const dailySoFar = todayActive ? (killer.dailyHonorSealsEarned ?? 0) : 0;
    const remainingDaily = Math.max(0, VANGUARD_DAILY_SEAL_CAP - dailySoFar);
    amount = Math.min(amount, remainingDaily);

    // Per-target daily cap.
    const byTarget = todayActive ? (killer.dailyHonorSealsByTarget ?? {}) : {};
    const targetName = opponent.name.toLowerCase();
    const targetSoFar = byTarget[targetName] ?? 0;
    const remainingForTarget = Math.max(0, VANGUARD_PER_TARGET_DAILY_CAP - targetSoFar);
    amount = Math.min(amount, remainingForTarget);

    if (amount <= 0) return { amount: 0, updatedByTarget: byTarget };

    const updatedByTarget = { ...byTarget, [targetName]: targetSoFar + amount };
    return { amount, updatedByTarget };
}

// PROFESSION_XP_BASELINE / PROFESSION_XP_HEALER / PROFESSION_MAX_RANK
// moved to ./constants/profession.

export function professionThresholds(profession: Profession): readonly number[] {
    return profession === "healer" ? PROFESSION_XP_HEALER : PROFESSION_XP_BASELINE;
}

export function getProfessionRankForXp(profession: Profession, xp: number): number {
    const t = professionThresholds(profession);
    let rank = 1;
    for (let i = 1; i <= PROFESSION_MAX_RANK; i += 1) {
        if (xp >= t[i]) rank = i + 1;
    }
    return Math.min(PROFESSION_MAX_RANK, rank);
}

// Reward-currency helpers (normalize/apply/format + rewardSummary) extracted to
// ./lib/currency. The symbols still referenced here are imported back near the
// top of this file. None were part of the public "../App" surface.

// Hollow Gate tunables — declared as `let` so the admin panel can override
// them at runtime without rebuilding. Defaults are baked-in canonical values.
export let HOLLOW_GATE_UNLOCK_COST = 10_000;
export function setHollowGateUnlockCost(v: number) { HOLLOW_GATE_UNLOCK_COST = v; }

type VillageLeadershipProfile = { kage: string; elders: string[]; atWar: boolean; pastWars: string[] };
export type VillageLeadershipImages = Record<string, { kage?: string; elders?: string[] }>;

export const villageLeadership: Record<string, VillageLeadershipProfile> = {
    "Stormveil Village": {
        kage: "Kage Raiko Veyr",
        elders: ["Elder Vanta", "Mira Volt", "Tempest Guard Captain"],
        atWar: false,
        pastWars: ["Won the Tempest Border War vs Moonshadow", "Lost the Crimson Dock Raid vs Ashen Leaf", "Draw at the Broken Thunder Pass"],
    },
    "Ashen Leaf Village": {
        kage: "Kage Hoshina Enju",
        elders: ["Elder Mori", "Toma Reed", "Ren Reed"],
        atWar: false,
        pastWars: ["Won the Crimson Dock Raid vs Stormveil", "Won the Ember Road Defense vs Frostfang", "Lost the Old Grove Skirmish vs Moonshadow"],
    },
    "Frostfang Village": {
        kage: "Kage Kael Whitefang",
        elders: ["Elder Sova", "Captain Yura", "Pale Pack Leader"],
        atWar: false,
        pastWars: ["Won the White Ridge Siege vs Moonshadow", "Lost the Ember Road Assault vs Ashen Leaf", "Draw at the Frozen Gate"],
    },
    "Moonshadow Village": {
        kage: "Kage Sable Nocturne",
        elders: ["Shade Master Iro", "Nyx", "Archivist Rei"],
        atWar: false,
        pastWars: ["Won the Old Grove Skirmish vs Ashen Leaf", "Lost the White Ridge Siege vs Frostfang", "Lost the Tempest Border War vs Stormveil"],
    },
};

let sharedVillageLeadershipImagesCache: VillageLeadershipImages | null = null;

export function normalizeVillageLeadershipImages(images?: VillageLeadershipImages): VillageLeadershipImages {
    const normalized: VillageLeadershipImages = {};
    Object.keys(villageLeadership).forEach((village) => {
        const source = images?.[village];
        normalized[village] = {
            kage: source?.kage ?? "",
            elders: Array.from({ length: 3 }, (_, index) => source?.elders?.[index] ?? ""),
        };
    });
    return normalized;
}

export function loadVillageLeadershipImages(): VillageLeadershipImages {
    if (sharedVillageLeadershipImagesCache) return normalizeVillageLeadershipImages(sharedVillageLeadershipImagesCache);
    return normalizeVillageLeadershipImages();
}

export function saveVillageLeadershipImages(images: VillageLeadershipImages) {
    sharedVillageLeadershipImagesCache = normalizeVillageLeadershipImages(images);
    persistSharedGameState({ kind: "villageLeadershipImages", images: sharedVillageLeadershipImagesCache });
}

// Village upgrade system (definitions, levels/bonuses, costs + the derived
// bonus helpers) extracted to ./lib/village-upgrades. The symbols still
// referenced here are imported back near the top of this file; discountCost,
// getBankInterestPercent and getHospitalDiscountPercent are re-exported below
// for the Bank/Hospital "../App" import sites.

// Aura Sphere progression + equipped-bonus helpers extracted to
// ./lib/aura-sphere. The symbols still referenced here are imported back near
// the top of this file; getActiveAuraSphereBonuses is re-exported for the
// LeftProfileCard "../App" import site.
export { getActiveAuraSphereBonuses };

export { discountCost, getBankInterestPercent, getHospitalDiscountPercent };

export { normalizeJutsu };

// presenceCharacter (the heartbeat display-field projection) lives in
// ./lib/presence-character — drained out of App.tsx to keep it under the size
// ratchet. Imported at the top of this file.

export function normalizeCharacter(parsed: Character): Character {
    const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(parsed.level ?? 1)));
    const xp = level >= MAX_LEVEL ? 0 : Math.max(0, Math.min(xpNeeded(level), Math.floor(parsed.xp ?? 0)));
    const currentMonth = currentMonthKey();
    const expectedMaxHp = maxHpForLevel(level);
    const expectedMaxChakra = maxChakraForLevel(level);
    const expectedMaxStamina = maxStaminaForLevel(level);
    const maxHp = Math.max(parsed.maxHp ?? expectedMaxHp, expectedMaxHp);
    const maxChakra = Math.max(parsed.maxChakra ?? expectedMaxChakra, expectedMaxChakra);
    const maxStamina = Math.max(parsed.maxStamina ?? expectedMaxStamina, expectedMaxStamina);
    const stats = normalizeStats(parsed.stats);

    const normalized: Character = {
        ...parsed,
        level,
        xp,
        avatarImage: parsed.avatarImage ?? "",
        specialty: (parsed.specialty ?? "Ninjutsu") as JutsuType,
        storyProgress: parsed.storyProgress ?? 0,
        storyVillage: parsed.storyVillage ?? parsed.village ?? villages[0],
        bankRyo: parsed.bankRyo ?? 0,
        honorSeals: parsed.honorSeals ?? 0,
        auraDust: parsed.auraDust ?? 0,
        auraSphereLevel: Math.max(1, Math.floor(parsed.auraSphereLevel ?? 1)),
        fateShards: parsed.fateShards ?? 0,
        tileCards: parsed.tileCards ?? [],
        savedTileDeck: parsed.savedTileDeck ?? undefined,
        elements: getCharacterElements(parsed),
        hp: Math.min(maxHp, parsed.maxHp && parsed.maxHp < expectedMaxHp ? expectedMaxHp : parsed.hp ?? expectedMaxHp),
        maxHp,
        chakra: Math.min(maxChakra, parsed.maxChakra && parsed.maxChakra < expectedMaxChakra ? expectedMaxChakra : parsed.chakra ?? expectedMaxChakra),
        maxChakra,
        stamina: Math.min(maxStamina, parsed.maxStamina && parsed.maxStamina < expectedMaxStamina ? expectedMaxStamina : parsed.stamina ?? expectedMaxStamina),
        maxStamina,
        rankTitle: parsed.rankTitle ?? rankFromLevel(level),
        storyTitle: parsed.storyTitle ?? "",
        storyTraits: Array.isArray(parsed.storyTraits) ? parsed.storyTraits.filter(Boolean) : [],
        inventory: parsed.inventory ?? [],
        equipment: parsed.equipment ?? {},
        stats,
        unspentStats: Math.max(0, statPointBudgetForProgress(level, xp) - allocatedStatPoints(stats)),
        equippedJutsuIds: (parsed.equippedJutsuIds ?? []).slice(0, 15),
        jutsuMastery: parsed.jutsuMastery ?? [],
        pets: (parsed.pets ?? []).slice(0, 5).map(normalizePet),
        activePetId: parsed.activePetId,
        activePetId2v2: parsed.activePetId2v2,
        boneCharms: parsed.boneCharms ?? 0,
        auraStones: parsed.auraStones ?? 0,
        mythicSeals: parsed.mythicSeals ?? 0,
        clan: parsed.clan,
        clanFounder: parsed.clanFounder ?? false,
        clanBattleContrib: parsed.clanBattleContrib ?? 0,
        clanEventContrib: parsed.clanEventContrib ?? 0,
        clanMissionContrib: parsed.clanMissionContrib ?? 0,
        totalStatsTrained: parsed.totalStatsTrained ?? 0,
        totalMissionsCompleted: parsed.totalMissionsCompleted ?? parsed.clanMissionContrib ?? 0,
        totalAiKills: parsed.totalAiKills ?? 0,
        totalPvpKills: parsed.totalPvpKills ?? 0,
        monthlyPvpKills: parsed.pvpKillMonth === currentMonth ? parsed.monthlyPvpKills ?? 0 : 0,
        pvpKillMonth: parsed.pvpKillMonth === currentMonth ? parsed.pvpKillMonth : currentMonth,
        totalVillageRaids: parsed.totalVillageRaids ?? 0,
        villageWarMissionDate: parsed.villageWarMissionDate === currentDateKey() ? parsed.villageWarMissionDate : currentDateKey(),
        villageWarRaidProgress: parsed.villageWarMissionDate === currentDateKey() ? parsed.villageWarRaidProgress ?? 0 : 0,
        villageWarMissionsCompleted: parsed.villageWarMissionDate === currentDateKey() ? parsed.villageWarMissionsCompleted ?? 0 : 0,
        totalTilesExplored: parsed.totalTilesExplored ?? 0,
        totalTournamentsCompleted: parsed.totalTournamentsCompleted ?? 0,
        totalEndlessTowerWins: parsed.totalEndlessTowerWins ?? 0,
        endlessTowerBestWave: parsed.endlessTowerBestWave ?? 0,
        endlessTowerRun: parsed.endlessTowerRun ?? null,
        battleTowerBestFloor: parsed.battleTowerBestFloor ?? 0,
        battleTowerRating: parsed.battleTowerRating ?? 0,
        battleTowerClearedFloors: Array.isArray(parsed.battleTowerClearedFloors) ? parsed.battleTowerClearedFloors : [],
        battleTowerClaimedRewards: Array.isArray(parsed.battleTowerClaimedRewards) ? parsed.battleTowerClaimedRewards : [],
        battleTowerAssistRewardsClaimed: Array.isArray(parsed.battleTowerAssistRewardsClaimed) ? parsed.battleTowerAssistRewardsClaimed : [],
        totalPetWins: parsed.totalPetWins ?? 0,
        defeatedAiIds: Array.isArray(parsed.defeatedAiIds) ? parsed.defeatedAiIds.filter(Boolean) : [],
        rankedRating: parsed.rankedRating ?? 1000,
        rankedWins: parsed.rankedWins ?? 0,
        rankedLosses: parsed.rankedLosses ?? 0,
        petRankedRating: parsed.petRankedRating ?? 1000,
        petRankedWins: parsed.petRankedWins ?? 0,
        petRankedLosses: parsed.petRankedLosses ?? 0,
        weeklyBossKills: parsed.weeklyBossKills ?? {},
        claimedWarCrateIds: Array.isArray(parsed.claimedWarCrateIds) ? parsed.claimedWarCrateIds : [],
        clanContribMonth: parsed.clanContribMonth,
        guardQueued: parsed.guardQueued ?? false,
        hospitalized: parsed.hospitalized ?? false,
        villageUpgrades: normalizeVillageUpgrades(parsed.villageUpgrades),
        // Clan member-passive snapshot + per-AI kill counts — explicitly typed +
        // validated here. (normalize spreads ...parsed first, so unlisted fields
        // are preserved, not dropped; these just get an explicit shape check.)
        clanUpgradeLevels: (parsed.clanUpgradeLevels && typeof parsed.clanUpgradeLevels === "object" && !Array.isArray(parsed.clanUpgradeLevels)) ? parsed.clanUpgradeLevels : undefined,
        aiKills: (parsed.aiKills && typeof parsed.aiKills === "object" && !Array.isArray(parsed.aiKills)) ? parsed.aiKills : {},
        lastBankInterestAt: parsed.lastBankInterestAt ?? 0,
        lastDailyReset: currentDateKey(),
        dailyTilesExplored: parsed.lastDailyReset === currentDateKey() ? (parsed.dailyTilesExplored ?? 0) : 0,
        dailyMissionsCompleted: parsed.lastDailyReset === currentDateKey() ? (parsed.dailyMissionsCompleted ?? 0) : 0,
        dailyHuntsCompleted: parsed.lastHuntReset === currentDateKey() ? (parsed.dailyHuntsCompleted ?? 0) : 0,
        lastHuntReset: currentDateKey(),
        dailyFateSpins: parsed.lastDailyReset === currentDateKey() ? (parsed.dailyFateSpins ?? 0) : 0,
        dailyAiKills: parsed.lastDailyReset === currentDateKey() ? (parsed.dailyAiKills ?? 0) : 0,
        dailyPetWins: parsed.lastDailyReset === currentDateKey() ? (parsed.dailyPetWins ?? 0) : 0,
        dailyHollowGateRuns: parsed.lastDailyReset === currentDateKey() ? (parsed.dailyHollowGateRuns ?? 0) : 0,
        dailyTowerXp: parsed.lastDailyReset === currentDateKey() ? (parsed.dailyTowerXp ?? 0) : 0,
        hollowGateRun: parsed.hollowGateRun ?? null,
        hollowGateWardenKills: parsed.hollowGateWardenKills ?? 0,
        hollowGateIntroSeen: parsed.hollowGateIntroSeen ?? false,
        claimedVillageAgendaDate: parsed.claimedVillageAgendaDate,
        claimedMapControlDate: parsed.claimedMapControlDate,
        examsPassed: Array.isArray(parsed.examsPassed) ? parsed.examsPassed.filter(Boolean) : [],
    };
    return normalizeInventory(normalized); // migrate inline stackables → itemStacks (idempotent)
}

function accountKey(name: string) {
    return name.trim().toLowerCase();
}

function loadPlayerAccounts(): PlayerAccounts {
    try {
        const raw = localStorage.getItem(PLAYER_ACCOUNTS_STORAGE);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function savePlayerAccounts(accounts: PlayerAccounts) {
    // Local account cache is only a legacy name list. Server KV is the save/auth source of truth.
    function noImages(_key: string, value: unknown) {
        if (_key === "password") return undefined;
        if (_key === "snapshot") return undefined;
        if (typeof value === "string" && value.startsWith("data:image")) return "";
        return value;
    }
    try {
        localStorage.setItem(PLAYER_ACCOUNTS_STORAGE, JSON.stringify(accounts, noImages));
    } catch {
        // If it still fails for some reason, silently skip — server save is the source of truth
    }
}

// ─── Save-preview cache ───────────────────────────────────────────────────
// Lightweight per-account snapshot stored in localStorage so login can paint
// the character UI *instantly* on the next visit instead of waiting on the
// auth + save round-trip (which can be 5-15s when Supabase is cold). The
// shape mirrors a server save payload but with all base64 images stripped
// so the cache stays small (typically <50 KB per account).
//
// Source of truth is still the server: applyServerSnapshot replaces the
// preview-painted state once the real save arrives. The 30s sector guard
// added in the rubber-banding fix prevents the reconcile from rolling
// back a fresh travel.
const SAVE_PREVIEW_STORAGE_PREFIX = "ninjav-save-preview-v1:";

function savePreviewKey(name: string) {
    return SAVE_PREVIEW_STORAGE_PREFIX + accountKey(name);
}

function stripImagesForPreview(_key: string, value: unknown) {
    return typeof value === "string" && value.startsWith("data:image") ? "" : value;
}

function writeSavePreview(name: string, payload: unknown) {
    if (!name) return;
    try {
        localStorage.setItem(savePreviewKey(name), JSON.stringify(payload, stripImagesForPreview));
    } catch {
        // Quota exceeded or SSR — server save is still authoritative.
    }
}

function readSavePreview(name: string): Record<string, unknown> | null {
    if (!name) return null;
    try {
        const raw = localStorage.getItem(savePreviewKey(name));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        // Defense: the preview key includes the account name, but the
        // payload's character.name MUST match — otherwise something is
        // very wrong and we'd rather block than paint the wrong avatar.
        const charRecord = (parsed.character && typeof parsed.character === "object")
            ? parsed.character as Record<string, unknown>
            : null;
        if (!charRecord || accountKey(String(charRecord.name ?? "")) !== accountKey(name)) return null;
        return parsed;
    } catch {
        return null;
    }
}

// Combat damage math (getOffenseStat/getDefenseStat, multiplier + status
// helpers, the unified calculateDamage formula, PvP-formula constants, tagPower)
// extracted to ./lib/combat-math. The symbols still referenced here are imported
// back near the top of this file. None were part of the public "../App" surface,
// so no re-exports are needed.

// The discipline used to label a player's own damage effects across the jutsu
// screens (Profile lens default + overview, Training Hall, combat inspect).
// Derives from the chosen bloodline, then specialty; "Any"/missing → Ninjutsu.
export function playerLensDiscipline(character: Character): JutsuType {
    const fromBloodline = starterBloodlineOffense[character.bloodline];
    if (fromBloodline && fromBloodline !== "Any") return fromBloodline;
    return character.specialty && character.specialty !== "Any" ? character.specialty : "Ninjutsu";
}

// Jutsu effect descriptions + level-aware display (jutsuEffectInfo,
// jutsuDisplayAtLevel, describeJutsuEffects) extracted to ./lib/jutsu-effects.
// All three are imported back near the top of this file; jutsuEffectInfo and
// jutsuDisplayAtLevel are re-exported for the JutsuEffectCards + TagPicker
// "../App" import sites.
export { jutsuEffectInfo, jutsuDisplayAtLevel };

// Jutsu mastery/XP, resource-cost and level-scaling helpers extracted to
// ./lib/jutsu-scaling. The referenced helpers are imported back near the top of
// this file; scaleJutsuTagsForDisplay is re-exported for the JutsuEffectCards
// "../App" import site.
export { scaleJutsuTagsForDisplay };

// Jutsu point-budget + rank rules (jutsuCountForRank, pointBudgetForRank,
// bloodlineTagPercentChoices/normalize, tagPointValue, jutsuPoints,
// bloodlinePoints) extracted to ./lib/jutsu-points. Referenced helpers are
// imported back near the top of this file.

// biomeLabel moved to ./data/world (imported back near the top).

export function createCharacter(name: string, village: string, specialty: JutsuType, bloodline: string): Character {
    // New shinobi auto-learn their chosen bloodline's jutsu (mastery level 1) so
    // they spawn combat-ready instead of with an empty loadout. The universal
    // "Flicker" is intentionally NOT seeded here — the guided first-session
    // sequence has the player free-unlock it (the "first jutsu is free" beat).
    const starterBloodlineName = bloodline === "Blue Blade Eyes" ? "Ashen Eyes" : bloodline;
    const starterBloodline = starterSavedBloodlines.find((b) => b.name === starterBloodlineName);
    const bloodlineJutsuIds = starterBloodline ? starterBloodline.jutsus.map((j) => j.id) : [];
    return {
        name,
        village,
        specialty,
        bloodline,
        avatarImage: "",
        storyProgress: 0,
        storyVillage: village,
        storyTraits: [],
        level: 1,
        xp: 0,
        ryo: 100,
        bankRyo: 0,
        honorSeals: 0,
        auraDust: 0,
        auraSphereLevel: 1,
        fateShards: 0,
        tileCards: [],
        elements: [],
        hp: maxHpForLevel(1),
        maxHp: maxHpForLevel(1),
        chakra: maxChakraForLevel(1),
        maxChakra: maxChakraForLevel(1),
        stamina: maxStaminaForLevel(1),
        maxStamina: maxStaminaForLevel(1),
        rankTitle: "Academy Student",
        // Begin onboarding at the Academy intro modal; "Begin Academy Training"
        // hands off to the choose-your-companion overlay (StarterPetSelect).
        onboardingStep: "academyIntro",
        stats: baseStats(),
        unspentStats: STARTING_STAT_POINTS,
        equippedJutsuIds: bloodlineJutsuIds.slice(0, 3),
        inventory: ["rustfang-kunai", "shinobi-vest"],
        equipment: {},
        jutsuMastery: bloodlineJutsuIds.map((id) => ({ jutsuId: id, level: 1, xp: 0 })),
        pets: [],
        activePetId: undefined,
        activePetId2v2: undefined,
        boneCharms: 0,
        auraStones: 0,
        mythicSeals: 0,
        clanBattleContrib: 0,
        clanEventContrib: 0,
        clanMissionContrib: 0,
        totalStatsTrained: 0,
        totalMissionsCompleted: 0,
        totalAiKills: 0,
        totalPvpKills: 0,
        monthlyPvpKills: 0,
        pvpKillMonth: currentMonthKey(),
        totalVillageRaids: 0,
        villageWarMissionDate: currentDateKey(),
        villageWarRaidProgress: 0,
        villageWarMissionsCompleted: 0,
        totalTilesExplored: 0,
        totalTournamentsCompleted: 0,
        totalEndlessTowerWins: 0,
        endlessTowerBestWave: 0,
        endlessTowerRun: null,
        battleTowerBestFloor: 0,
        battleTowerRating: 0,
        battleTowerClearedFloors: [],
        battleTowerClaimedRewards: [],
        battleTowerAssistRewardsClaimed: [],
        totalPetWins: 0,
        dailyAiKills: 0,
        dailyPetWins: 0,
        defeatedAiIds: [],
        aiKills: {},
        rankedRating: 1000,
        rankedWins: 0,
        rankedLosses: 0,
        petRankedRating: 1000,
        petRankedWins: 0,
        petRankedLosses: 0,
        villageUpgrades: defaultVillageUpgrades(),
        lastBankInterestAt: 0,
        createdAt: Date.now(),
    };
}

function createAdminCharacter(adminName: AdminAccount = "Admin 1"): Character {
    return {
        ...createCharacter(adminName, "Stormveil Village", "Ninjutsu", "Admin Core"),
        level: 100,
        xp: 0,
        ryo: 999999,
        honorSeals: 9999,
        auraDust: 99999,
        auraSphereLevel: 300,
        fateShards: 9999,
        hp: maxHpForLevel(100),
        maxHp: maxHpForLevel(100),
        chakra: maxChakraForLevel(100),
        maxChakra: maxChakraForLevel(100),
        stamina: maxStaminaForLevel(100),
        maxStamina: maxStaminaForLevel(100),
        rankTitle: "Admin",
        stats: maxedStats(),
        unspentStats: 0,
        boneCharms: 9999,
        auraStones: 9999,
        mythicSeals: 9999,
    };
}

function allStarterBloodlineJutsus() {
    return starterSavedBloodlines.flatMap((bloodline) => bloodline.jutsus.map((jutsu) => ({ jutsu, rank: bloodline.rank })));
}

function starterBloodlineJutsuRank(jutsuId: string): Rank | undefined {
    return allStarterBloodlineJutsus().find(({ jutsu }) => jutsu.id === jutsuId)?.rank;
}

export function getAllJutsus(savedBloodlines: SavedBloodline[], creatorJutsus: Jutsu[], character?: Character | null) {
    const starterBloodlineName = character?.bloodline === "Blue Blade Eyes" ? "Ashen Eyes" : character?.bloodline;
    const starterBloodline = starterSavedBloodlines.find((b) => b.name === starterBloodlineName);
    const equippedBloodline = savedBloodlines.find((b) => b.id === character?.equippedBloodlineId);
    const merged = new Map<string, Jutsu>();
    const markRank = (jutsus: Jutsu[], rank: Rank) => jutsus.map(j => ({ ...j, bloodlineRank: rank }));
    const includeAllStarterBloodlines = !character || isAdminAccountName(character.name);
    [
        ...starterJutsus,
        ...(includeAllStarterBloodlines ? allStarterBloodlineJutsus().map(({ jutsu, rank }) => ({ ...jutsu, bloodlineRank: rank })) : []),
        ...markRank(starterBloodline?.jutsus ?? [], starterBloodline?.rank ?? "B Rank"),
        ...markRank(equippedBloodline?.jutsus ?? [], equippedBloodline?.rank ?? "B Rank"),
        ...creatorJutsus.map((jutsu) => {
            const starterBloodlineRank = starterBloodlineJutsuRank(jutsu.id);
            // Do NOT rebalance here — admin-saved values must be preserved as-is.
            return starterBloodlineRank ? { ...normalizeJutsu(jutsu), bloodlineRank: starterBloodlineRank } : normalizeJutsu(jutsu);
        }),
    ].map(normalizeJutsu).forEach((jutsu) => {
        merged.set(jutsu.id, jutsu);
    });
    return [...merged.values()];
}

export function getPvpJutsuLoadout(savedBloodlines: SavedBloodline[], creatorJutsus: Jutsu[], character: Character) {
    return getAllJutsus(savedBloodlines, creatorJutsus, character)
        .filter((jutsu) => character.equippedJutsuIds.includes(jutsu.id));
}

export function stringifyServerSavePayload(payload: unknown) {
    return JSON.stringify(payload, (_key, value) => typeof value === "string" && value.startsWith("data:image") ? "" : value);
}

export function storyToCreatorEvent(step: StoryStep, village: string, index: number): CreatorEvent {
    const slug = village.toLowerCase().replace(/\W+/g, "-");
    const pages = step.pages?.length ? step.pages : [{
        title: step.cinematicTitle,
        scene: step.scene,
        speaker: "Narrator",
        dialogue: step.dialogue,
        choices: [],
    }];
    return {
        id: `story-${slug}-${step.levelReq}-${index}`,
        name: `${village}: ${step.title}`,
        biome: step.biome ?? villageBiomeMap[village] ?? "central",
        icon: step.bossIcon,
        eventKind: "visualNovel",
        trigger: "manual",
        vnTitle: step.title,
        vnScene: step.scene,
        vnSpeaker: pages[0]?.speaker ?? "Narrator",
        image: "",
        aiProfileId: step.aiProfileId,
        village,
        kageFinale: step.kageFinale,
        liberatorTitle: step.liberatorTitle,
        vnPages: pages,
        levelReq: step.levelReq,
        xpReward: step.rewardXp,
        ryoReward: step.rewardRyo,
        staminaReward: 0,
        dialogue: step.dialogue,
    };
}

export default function App() {
    const [screen, setScreen] = useState<Screen>("start");
    // Battle music is only ever STARTED from startBattle() (pet arena + dungeon
    // beast duel). Catch the exit here: leaving the Pet Arena fades the loop
    // out. Screen doesn't change mid-battle, so this never cuts music during a
    // fight; "Fight Again" restarts it with a fresh track.
    useEffect(() => {
        if (screen !== "petArena") stopBattleMusic();
    }, [screen]);
    // ── Mobile back-navigation history stack ─────────────────────────────
    // Captures every screen change so the MobileStatusHUD can render a
    // back button. We track via a useEffect (below) rather than wrapping
    // setScreen because there are ~50 direct setScreen() call sites
    // scattered through this file — a single effect catches them all.
    // The ref blocks the effect from re-pushing the target screen we just
    // popped during a back navigation (which would create an infinite loop).
    const [screenHistory, setScreenHistory] = useState<Screen[]>([]);
    const isGoingBackRef = useRef(false);
    const [worldMapKey, setWorldMapKey] = useState(0);
    const [character, setCharacter] = useState<Character | null>(null);
    const [currentAccountName, setCurrentAccountName] = useState("");
    const [viewingUserName, setViewingUserName] = useState<string | null>(null);

    // Session-expiry handling (audit #14 + data-loss fix). A token-first client
    // that dropped its stored password can't re-mint an expired 24h token (or one
    // invalidated by a SESSION_SECRET rotation); authFetch fires
    // SESSION_EXPIRED_EVENT in that case.
    //
    // The DANGEROUS reaction (and the cause of the "refresh and lose levels" bug)
    // is to wipe the session and force a full re-login: every autosave since the
    // token died silently 401'd, so the SERVER save is stale, and re-login reloads
    // that stale save — discarding all progress made since expiry. Instead we keep
    // the live in-memory state, prompt for the password, mint a fresh token
    // WITHOUT reloading, and immediately persist. Nothing is lost. (Token-first is
    // preserved: no plaintext password is stored — this is a one-shot re-auth.)
    const [sessionExpired, setSessionExpired] = useState(false);
    const [reauthPw, setReauthPw] = useState("");
    const [reauthError, setReauthError] = useState("");
    const [reauthBusy, setReauthBusy] = useState(false);

    // ── Session restore on refresh/restart ──────────────────────────────
    // A hard refresh re-inits `screen` to "start" and the snapshot restore in
    // the boot effect below is async. Without a gate we flash the login form on
    // every refresh — and STRAND the player on it if the save pull is slow,
    // retrying, or the 24h token has expired (token-first: no password is kept
    // to silently re-mint with). `restoringSession` starts true whenever a
    // previously-logged-in account is on disk, so we show a "restoring"
    // placeholder instead of the login form until the boot load resolves. On
    // failure we fall back to the login form — pre-filled with the name and a
    // notice — instead of a silent dead-end. Pure UX around the existing load
    // path: no credentials are read or stored here, and the no-token fallback
    // is untouched.
    const [bootAccountName] = useState<string>(() => {
        try {
            const raw = localStorage.getItem(STORAGE);
            return raw ? String((JSON.parse(raw) as { currentAccountName?: string })?.currentAccountName ?? "") : "";
        } catch { return ""; }
    });
    const [restoringSession, setRestoringSession] = useState<boolean>(() => Boolean(bootAccountName));
    const [restoreFailed, setRestoreFailed] = useState(false);
    // Phase 1.3 (see docs/load-and-refresh-perf-audit-2026-06-08.md): true while
    // a refresh has optimistically painted the cached HUB screen and is
    // reconciling against the server in the background. A blocking overlay sits
    // on top until reconcile completes, so the paint is visually instant but
    // behaviourally identical to the old "Restoring…" gate. Only ever set for
    // hub-screen refreshes — battle/encounter refreshes never trigger it.
    const [optimisticRestore, setOptimisticRestore] = useState(false);
    useEffect(() => {
        const onExpired = () => {
            if (!characterRef.current) return; // not logged in → start screen already handles it
            setSessionExpired(true);
        };
        window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
        return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    }, []);

    // ── Last-screen persistence ─────────────────────────────────────────
    // Refresh used to dump the player back to the village every time because
    // (1) the initial state is "start" and (2) the snapshot loader hard-codes
    // setScreen("village") after login. Persisting the active screen to
    // localStorage and letting the snapshot loader read it back keeps the
    // player roughly where they left off after a refresh.
    //
    // Mid-encounter screens (arena, petArena, hollowGateTiles) hold ephemeral
    // React state that can't actually resume from disk; for those we route to
    // the safest parent (hollowGateShrine when a run is in progress; village
    // otherwise) so the player never lands in a broken half-loaded battle.
    const LAST_SCREEN_KEY = "lastScreen.v1";
    useEffect(() => {
        // Skip "start" for the same reason the hash writer below does: every
        // page load initializes `screen` to "start", and this effect fires on
        // mount BEFORE the async snapshot restore reads the key back. Writing
        // "start" here clobbers the genuine last screen, so any screen that the
        // restore resolves via this key (every screen not deep-linkable from the
        // hash — i.e. all battle/encounter screens) falls back to "start" and is
        // routed to the village. That was the bug that let players refresh-flee a
        // fight. Leaving the prior value intact lets the restore read the real
        // last screen.
        if (screen === "start") return;
        try { localStorage.setItem(LAST_SCREEN_KEY, screen); } catch { /* quota / SSR */ }
    }, [screen]);
    // ── Shareable URL hash ──────────────────────────────────────────────
    // Reflect the active screen in the URL (e.g. #/village) so links are
    // visible, bookmarkable, and shareable. replaceState only — no new history
    // entries and no popstate — so it never conflicts with the localStorage
    // restore or the mobile back-stack. We deliberately skip the "start" (login)
    // screen so a bookmarked deep-link hash isn't wiped before the post-login
    // restore can read it.
    useEffect(() => {
        if (screen === "start") return;
        try {
            const want = `#/${screen}`;
            if (window.location.hash !== want) window.history.replaceState(null, "", want);
        } catch { /* sandboxed / SSR */ }
    }, [screen]);
    // ── Phase 0 load/refresh telemetry ──────────────────────────────────
    // Stamp boot milestones for the perf beacon (see
    // docs/load-and-refresh-perf-audit-2026-06-08.md). All three calls are
    // best-effort no-ops if the Performance API is unavailable, and never throw.
    // bootKind is set first (before notifyScreen) so a refresh isn't misread as
    // a cold-start. notifyRestoreComplete only fires for an actual restore
    // (a previously-logged-in account was on disk).
    useEffect(() => { perfSetBootKind(bootAccountName ? "refresh" : "cold-start"); }, []);
    useEffect(() => { perfNotifyScreen(screen); }, [screen]);
    useEffect(() => { if (bootAccountName && !restoringSession) perfNotifyRestoreComplete(); }, [restoringSession]);
    // ── PvP session persistence ─────────────────────────────────────────
    // PvP keys are declared / used here, but the useEffect that consumes
    // pvpBattleId is registered AFTER the pvp state hooks are declared
    // (further down the App body — see "PvP session storage hook" below).
    const PVP_SESSION_KEY = "pvpSession.v1";
    // Pet PvP battles are fully client-deterministic (same battleSeed →
    // same outcome on both clients), so a refresh just means re-running the
    // simulation locally. We persist the pending opponent + seed so the
    // refresher can resume their pet PvP fight instead of vanishing.
    // 5-min TTL: a 2v2 pet battle is ≤30 rounds × ~150ms per frame = <10s
    // of animation, so anything past 5 min is stale.
    const PENDING_PET_PVP_KEY = "pendingPetPvp.v1";
    // Strip image data URLs from anywhere in the serialized resume payload
    // before writing to localStorage. The opponent + party objects carry full
    // Pet records, and a 2MB data URL × N pets will blow the ~5MB quota — the
    // try/catch around setItem swallowed the failure silently so the player
    // had no idea their other localStorage writes were also failing. Images
    // are recoverable from sharedImages on remount anyway.
    function stripDataUrlImages(value: unknown): unknown {
        if (typeof value === "string") {
            return value.startsWith("data:image") ? "" : value;
        }
        if (Array.isArray(value)) return value.map(stripDataUrlImages);
        if (value && typeof value === "object") {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                out[k] = stripDataUrlImages(v);
            }
            return out;
        }
        return value;
    }
    const PENDING_PET_PVP_TTL_MS = 5 * 60 * 1000;

    // ── Tab visibility: pause all polling when the browser tab is hidden ──
    const [tabVisible, setTabVisible] = useState(() => typeof document !== "undefined" ? document.visibilityState === "visible" : true);
    useEffect(() => {
        const handler = () => setTabVisible(document.visibilityState === "visible");
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
    }, []);
    // Mirror the active player into sessionStorage so the global authFetch
    // interceptor (installed at module load) can pick up the correct
    // x-player-name / x-player-password headers for every /api/ request.
    useEffect(() => {
        setActivePlayer(character?.name ?? currentAccountName ?? null);
    }, [character?.name, currentAccountName]);

    // ── Achievement unlock detection ───────────────────────────────────────
    // Re-runs whenever character state changes. Silently backfills on first
    // load (so existing players don't get a flood of toasts). After that, any
    // newly-eligible achievement fires a toast and is persisted.
    const [achievementToasts, setAchievementToasts] = useState<Achievement[]>([]);
    useEffect(() => {
        if (!character) return;
        const eligibleIds = ACHIEVEMENTS.filter(a => a.check(character)).map(a => a.id);
        const prior = character.unlockedAchievements;

        // Earned titles — union-sync with unlocked title achievements (lib/earned-titles).
        const newTitles = nextEarnedTitles(character, eligibleIds);
        if (newTitles) setCharacter(c => c ? { ...c, earnedTitles: newTitles } : c);
        if (!prior) {
            // First load — silent backfill, no toasts
            const now = Date.now();
            const stamps: Record<string, number> = {};
            for (const id of eligibleIds) stamps[id] = now;
            setCharacter(c => c ? { ...c, unlockedAchievements: eligibleIds, achievementUnlockedAt: stamps } : c);
            return;
        }

        const priorSet = new Set(prior);
        const newlyUnlocked = eligibleIds.filter(id => !priorSet.has(id));
        if (newlyUnlocked.length === 0) return;

        const now = Date.now();
        const stamps = { ...(character.achievementUnlockedAt ?? {}) };
        for (const id of newlyUnlocked) stamps[id] = now;
        // One-time reward payout for each newly-unlocked achievement. Only fires
        // here (the `prior`-exists branch), never on the first-load backfill
        // above — so existing players don't get a retroactive windfall.
        let rewardRyo = 0, rewardShards = 0;
        for (const id of newlyUnlocked) {
            const a = ACHIEVEMENTS.find(x => x.id === id);
            if (!a) continue;
            const r = achievementReward(a);
            rewardRyo += r.ryo; rewardShards += r.fateShards;
        }
        setCharacter(c => c ? {
            ...c,
            unlockedAchievements: [...prior, ...newlyUnlocked],
            achievementUnlockedAt: stamps,
            ryo: c.ryo + rewardRyo,
            fateShards: (c.fateShards ?? 0) + rewardShards,
        } : c);

        const unlocked = newlyUnlocked
            .map(id => ACHIEVEMENTS.find(a => a.id === id))
            .filter((a): a is Achievement => !!a);
        setAchievementToasts(prev => [...prev, ...unlocked]);
    }, [character]);

    // Auto-dismiss toasts one at a time so a flood doesn't pile up forever.
    useEffect(() => {
        if (achievementToasts.length === 0) return;
        const t = setTimeout(() => setAchievementToasts(prev => prev.slice(1)), 4500);
        return () => clearTimeout(t);
    }, [achievementToasts]);

    // ── Profession mission completion toasts ──────────────────────────────
    // Any component (Hospital heal response, DailyProfessionMissions poll,
    // handlePvpWin) emits a `profession-mission-complete` CustomEvent; we
    // collect and render them with the same auto-dismiss as achievements.
    const [missionToasts, setMissionToasts] = useState<Array<{ id: string; name: string; xp: number; profession?: string; label?: string }>>([]);
    useEffect(() => {
        function handler(e: Event) {
            const detail = (e as CustomEvent<{ name: string; xp: number; profession?: string; label?: string }>).detail;
            if (!detail?.name) return;
            setMissionToasts(prev => [...prev, {
                id: `${detail.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name: detail.name,
                xp: detail.xp ?? 0,
                profession: detail.profession,
                label: detail.label,
            }]);
        }
        window.addEventListener('profession-mission-complete', handler);
        return () => window.removeEventListener('profession-mission-complete', handler);
    }, []);
    useEffect(() => {
        if (missionToasts.length === 0) return;
        const t = setTimeout(() => setMissionToasts(prev => prev.slice(1)), 4500);
        return () => clearTimeout(t);
    }, [missionToasts]);

    // ── Profession picker: rendered as an unconditional fullscreen overlay
    // whenever Level >= 13 with no profession set. No screen trigger here —
    // the render block at the bottom handles it. The picker cannot be skipped.

    // ── Viewport size detector ──────────────────────────────────────────────
    // Sets data-vp="xs|sm|md|lg|xl" on <html> so CSS can use attribute
    // selectors for fine-grained layout control between media-query breakpoints.
    useLayoutEffect(() => {
        const vp = (w: number) =>
            w < 560 ? "xs" : w < 980 ? "sm" : w < 1180 ? "md" : w < 1400 ? "lg" : w < 2200 ? "xl" : "xxl";
        const apply = () =>
            document.documentElement.setAttribute("data-vp", vp(window.innerWidth));
        apply();
        let raf = 0;
        const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(apply); };
        window.addEventListener("resize", onResize, { passive: true });
        return () => { window.removeEventListener("resize", onResize); cancelAnimationFrame(raf); };
    }, []);

    // Toggle body class during battle so CSS can hide the left sidebar
    useEffect(() => {
        const isBattle = screen === "arena" || screen === "storyBoss" || screen === "pvpBattle" || screen === "battleTowers";
        document.body.classList.toggle("in-battle", isBattle);
        return () => { document.body.classList.remove("in-battle"); };
    }, [screen]);

    const [sharedImages, setSharedImages] = useState<Record<string, string>>({});
    const [savedBloodlines, setSavedBloodlines] = useState<SavedBloodline[]>([]);
    const [publicPlayerBloodlines, setPublicPlayerBloodlines] = useState<ReviewBloodline[]>([]);
    const [worldStateVersion, setWorldStateVersion] = useState(0);
    // Bumped whenever the clan-war list is refreshed. Drives the
    // reward auto-claim effect below (parallel to worldStateVersion
    // for village wars).
    const [clanWarStateVersion, setClanWarStateVersion] = useState(0);
    // Village war crates — check whenever the shared world state refreshes.
    // Also covers clan war crates now that claimPendingWarCrates scans
    // sharedClanWarCache; ClanHall fires its own claim too once clanData
    // is loaded.
    useEffect(() => {
        if (!character) return;
        const { character: updated, count, mvp, consolation } = claimPendingWarCrates(character, null);
        if (count === 0 && !mvp && !consolation) return;
        setCharacter(updated);
        if (count > 0) {
            alert(`You received ${count} Legendary War Crate${count > 1 ? "s" : ""} from a recent war victory! Check your inventory.`);
        } else if (mvp) {
            alert(`MVP rewards delivered: bonus ryo, honor seals, and fate shards added to your account.`);
        } else if (consolation) {
            alert(`Consolation rewards from a recent war loss have been added to your account.`);
        }
    }, [worldStateVersion, clanWarStateVersion]);

    // Light-weight clan war polling — keeps sharedClanWarCache fresh so
    // ended-war rewards auto-claim. 30s cadence is enough (7-day claim window).
    // Clan-less players are skipped: claimPendingWarCrates short-circuits on an
    // empty `clan`, so polling the uncached endpoint for them is pure waste.
    useEffect(() => {
        if (!tabVisible) return;
        if (!character) return;
        if (!character.clan) return;
        let alive = true;
        async function refreshClanWars() {
            try {
                const before = JSON.stringify(sharedClanWarCache);
                await cwListWars();
                if (!alive) return;
                if (JSON.stringify(sharedClanWarCache) !== before) setClanWarStateVersion(v => v + 1);
            } catch { /* dev/offline fallback */ }
        }
        refreshClanWars();
        const id = setInterval(refreshClanWars, 30_000);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, [tabVisible, character?.name, character?.clan]);

    const [, setSharedGameStateVersion] = useState(0);
    const [currentBiome, setCurrentBiome] = useState<Biome>("central");
    const [currentWeather, setCurrentWeather] =
        useState<WeatherType>("clear");
    const [activeTraining, setActiveTraining] = useState<ActiveTraining | null>(null);
    const [adminLoggedIn, setAdminLoggedIn] = useState(false);
    const [adminAccount, setAdminAccount] = useState<AdminAccount | "">("");
    const [adminPw, setAdminPw] = useState(() => sessionStorage.getItem("admin:pw") ?? "");
    // Admin role. "full" = Admin 1 (every tab). "content" = Admin 2
    // (restricted tabs hidden). Restored from sessionStorage on reload so a
    // page refresh doesn't downgrade an Admin 1 session or vice versa.
    const [adminRole, setAdminRole] = useState<AdminRole>(() =>
        (sessionStorage.getItem("admin:role") as AdminRole | null) ?? "full"
    );
    const [creatorJutsus, setCreatorJutsus] = useState<Jutsu[]>([]);
    const [creatorEvents, setCreatorEvents] = useState<CreatorEvent[]>([]);
    const [creatorItems, setCreatorItems] = useState<GameItem[]>([]);
    const [creatorAis, setCreatorAis] = useState<CreatorAi[]>([]);
    const [creatorMissions, setCreatorMissions] = useState<CreatorMission[]>([]);
    const [creatorRaids, setCreatorRaids] = useState<CreatorRaid[]>([]);
    const [creatorCards, setCreatorCards] = useState<TileCard[]>([]);
    const [petEncounterVn, setPetEncounterVn] = useState<CreatorEvent>(defaultPetEncounterVn);
    const [ancientChestVn, setAncientChestVn] = useState<CreatorEvent>(defaultAncientChestVn);
    const [editablePets, setEditablePets] = useState<Pet[]>(petPool);
    const [selectedPetId, setSelectedPetId] = useState(petPool[0]?.id ?? "");
    // Admin pet-editor edits are AUTHORITATIVE in-session: when the admin changes a
    // pet template (fresh updatedAt), publish it + re-normalize owned pets so the Pet
    // Yard / combat match the editor at once — not after a save → pull round-trip.
    // (Other clients still adopt it via pullSharedAdminContent.) Idempotent + guarded,
    // so pull paths that set editablePets and edits to unowned pets are cheap no-ops.
    useEffect(() => {
        if (!registerPublishedPetTemplates(editablePets)) return;
        setCharacter((prev) => {
            const pets = prev && renormalizedIfChanged(prev.pets, normalizePet);
            return pets ? { ...prev!, pets } : prev;
        });
    }, [editablePets]);
    useEffect(() => {
        if (!tabVisible) return; // pause when tab hidden
        let alive = true;
        async function refreshWorldState() {
            try {
                const response = await fetch(WORLD_STATE_API, { cache: "no-cache" }); // no-cache: revalidate via the api/world-state.ts ETag, 304 on unchanged polls → no re-download. Freshness identical.
                if (!response.ok) return;
                const data = await response.json();
                if (!alive) return;
                if (hydrateSharedWorldState(data)) setWorldStateVersion(version => version + 1);
            } catch {
                // Offline/dev fallback keeps the current in-memory world state until the API is available.
            }
        }
        refreshWorldState(); // fetch fresh data on tab return
        const id = setInterval(refreshWorldState, 15000);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, [tabVisible]);
    useEffect(() => {
        if (!tabVisible) return; // pause when tab hidden
        let alive = true;
        async function refreshSharedGameState() {
            try {
                const owner = characterRef.current?.name ?? currentAccountName;
                setSharedGameStateOwnerName(owner); // seeds the POST (pendingClanPetBattle) owner; NOT sent as a GET query (would fragment the CDN cache key)
                const response = await fetch(GAME_STATE_API, { cache: "no-cache" }); // no-cache (not no-store): browser revalidates via the api/game-state.ts ETag, gets 304 on unchanged frames → no re-download. Freshness identical.
                if (!response.ok) return;
                const data = await response.json();
                if (!alive) return;
                if (hydrateSharedGameState(data)) setSharedGameStateVersion(version => version + 1);
            } catch {
                // Shared game state will refresh again on the next heartbeat-sized poll.
            }
        }
        refreshSharedGameState(); // fetch fresh data on tab return
        const id = setInterval(refreshSharedGameState, 5000);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, [currentAccountName, character?.name, tabVisible]);
    // Village leadership portraits are large base64 images that change rarely,
    // so they ride a separate slow poll (api/game-state.ts ?images=1) instead of
    // the 5s game-state frame — keeping the hot frame ~355KB lighter per poll.
    // Only logged-in players need them (Town Hall / admin), so this stays idle
    // pre-login. Bumps the shared version itself when the portraits actually change.
    useEffect(() => {
        if (!tabVisible || !character?.name) return;
        let alive = true;
        let lastSig = "";
        async function refreshLeadershipImages() {
            try {
                const response = await fetch(`${GAME_STATE_API}?images=1`, { cache: "no-store" });
                if (!response.ok) return;
                const data = await response.json() as { villageLeadershipImages?: VillageLeadershipImages | null };
                if (!alive) return;
                const normalized = normalizeVillageLeadershipImages(data.villageLeadershipImages ?? undefined);
                const sig = JSON.stringify(normalized);
                if (sig === lastSig) return;
                lastSig = sig;
                sharedVillageLeadershipImagesCache = normalized;
                setSharedGameStateVersion(version => version + 1);
            } catch {
                // Portraits will refresh on the next slow tick.
            }
        }
        refreshLeadershipImages();
        const id = setInterval(refreshLeadershipImages, 5 * 60_000); // every 5 min — portraits change rarely
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, [character?.name, tabVisible]);
    useEffect(() => {
        setEditablePets((currentPets) => {
            const mergedPets = mergeMissingBuiltInPets(currentPets);

            if (mergedPets.length === currentPets.length) {
                return currentPets;
            }

            return mergedPets;
        });
    }, []);
    const [acceptedMissionIds, setAcceptedMissionIds] = useState<string[]>([]);
    const [missionProgress, setMissionProgress] = useState<Record<string, number>>({});
    const [activeJutsuTraining, setActiveJutsuTraining] = useState<ActiveJutsuTraining | null>(null);
    const [pendingAiProfileId, setPendingAiProfileId] = useState("");
    const [pendingPvpOpponent, setPendingPvpOpponent] = useState<Character | null>(null);
    const [pvpBattleId, setPvpBattleId] = useState<string | null>(null);
    // Tracks when the current PvP battle began, used for the <15s "quick
    // surrender" anti-abuse check on Vanguard Seal rewards.
    const pvpBattleStartedAtRef = useRef<number>(0);
    useEffect(() => {
        if (pvpBattleId) pvpBattleStartedAtRef.current = Date.now();
        else pvpBattleStartedAtRef.current = 0;
    }, [pvpBattleId]);
    const [pvpRole, setPvpRole] = useState<"p1" | "p2" | null>(null);
    const [pvpBattleContext, setPvpBattleContext] = useState<SharedPvpBattleContext | null>(null);
    // Seeds PvpBattleScreen with the freshly created session payload so it
    // can render the grid on first paint instead of showing the "Connecting
    // to battle session..." card while a redundant GET round trip resolves.
    // The /api/pvp/session POST now returns the full session alongside the
    // battleId; the call sites that initiate a fight stash the response
    // here. PvpBattleScreen only consumes the seed when its battleId
    // matches, so a stale seed left over from a previous fight is ignored.
    const [pvpSeedSession, setPvpSeedSession] = useState<PvpSessionState | null>(null);
    // PvP session storage hook — see PVP_SESSION_KEY note above. Saves a
    // breadcrumb whenever the local client enters/exits a PvP battle, so a
    // browser refresh can re-fetch the server-side session and resume.
    // Also stores pvpBattleContext (mode/sector/clanWar/kage metadata) so
    // win-handlers compute correct rewards on resume.
    useEffect(() => {
        try {
            if (pvpBattleId) {
                localStorage.setItem(PVP_SESSION_KEY, JSON.stringify({
                    pvpBattleId,
                    pvpRole,
                    pvpBattleContext,
                    savedAt: Date.now(),
                }));
            } else {
                localStorage.removeItem(PVP_SESSION_KEY);
            }
        } catch { /* quota / SSR */ }
    }, [pvpBattleId, pvpRole, pvpBattleContext]);
    const [temporaryStoryAi, setTemporaryStoryAi] = useState<CreatorAi | null>(null);
    // Transient, non-persisted AI(s) for one-off sector-wanderer fights. Merged
    // into the arena's AI list only (never into the saved creatorAis).
    const [wandererAis, setWandererAis] = useState<CreatorAi[]>([]);
    // Set when a sector "gambler" wanderer deals the player into Card Clash.
    const [cardAutoStart, setCardAutoStart] = useState(false);
    const [raidBattleKind, setRaidBattleKind] = useState<"none" | "raidAi" | "raidPlayer" | "defense">("none");
    // Lifted "fight in progress" flags (fed by Arena/PetArena onBattleActiveChange)
    // so the nav lock can block leaving arena ranked / pet matches whose active
    // state otherwise lives only inside the screen component.
    const [arenaBattleActive, setArenaBattleActive] = useState(false);
    const [petBattleActive, setPetBattleActive] = useState(false);
    // True while the player is in a mission AI fight launched from the Missions
    // screen. Mission completion (markMissionCompleted) is credited ONLY on a win
    // in winBattle and the flag is cleared on any battle end — so losing/fleeing a
    // mission no longer burns the daily slot or inflates clan contribution.
    const [missionBattleActive, setMissionBattleActive] = useState(false);
    // Sector of a deferred explore-mission credit while the player fights a tile
    // ambush. recordMissionExplore is called only if the ambush is WON (winBattle)
    // and cleared on any battle end — so losing the ambush no longer counts the tile.
    const [pendingExploreSector, setPendingExploreSector] = useState<number | null>(null);

    // Active AI-raid token issued by /api/missions/raid-start. Held in a
    // ref (not state) because changes don't need to trigger re-renders —
    // recordMissionRaid reads it at the end of the battle. Cleared on
    // use by the server (and locally cleared after a report is fired).
    const activeRaidTokenRef = useRef<string | null>(null);
    // Effect that mints the token lives below currentSector's declaration
    // so it can read the latest sector value in its closure.
    const [endlessBattleActive, setEndlessBattleActive] = useState(false);
    const [endlessBattleWave, setEndlessBattleWave] = useState(0);

    // ── Hollow Gate Shrine crawler state ──────────────────────────────────────
    const [hollowGateRun, setHollowGateRun] = useState<HollowGateShrineRun | null>(null);
    const [hollowGateLog, setHollowGateLog] = useState<string[]>([]);
    type HollowGateEventModal = {
        title: string;
        body: string;
        kind: HollowGateTileKind;
        choices: Array<{ label: string; onSelect: () => void; tone?: "danger" | "safe" | "primary" }>;
    } | null;
    const [hollowGateEvent, setHollowGateEvent] = useState<HollowGateEventModal>(null);
    type HiddenChamberState = {
        searched: boolean;
        relicTaken: boolean;
    } | null;
    const [hollowGateHiddenChamber, setHollowGateHiddenChamber] = useState<HiddenChamberState>(null);
    // Intro VN page index — null = not showing, 0..N = pages of the intro sequence.
    const [hollowGateIntroPage, setHollowGateIntroPage] = useState<number | null>(null);

    // Hollow Gate Shrine — WASD / Arrow keys move the player one tile.
    // Only active while the shrine screen is open, no event/chamber modal is up,
    // and focus is not in a text field.
    useEffect(() => {
        if (screen !== "hollowGateShrine") return;
        function handleKey(e: KeyboardEvent) {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === "input" || tag === "textarea" || tag === "select") return;
            const k = e.key.toLowerCase();
            if (k === "w" || k === "arrowup") { e.preventDefault(); moveHollowGatePlayer(0, -1); return; }
            if (k === "s" || k === "arrowdown") { e.preventDefault(); moveHollowGatePlayer(0, 1); return; }
            if (k === "a" || k === "arrowleft") { e.preventDefault(); moveHollowGatePlayer(-1, 0); return; }
            if (k === "d" || k === "arrowright") { e.preventDefault(); moveHollowGatePlayer(1, 0); return; }
        }
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    // moveHollowGatePlayer reads current state via closure — re-bind when run / modal state changes
    // so the closure always sees the freshest values.
     
    }, [screen, hollowGateRun, hollowGateEvent, hollowGateHiddenChamber]);

    // Persist the in-progress shrine run to the character so it survives refresh:
    // mirror local hollowGateRun into character.hollowGateRun whenever it changes inside the shrine.
    useEffect(() => {
        if (!character) return;
        if (screen !== "hollowGateShrine") return;
        if (character.hollowGateRun === hollowGateRun) return;
        setCharacter({ ...character, hollowGateRun });
     
    }, [hollowGateRun]);

    function savedJutsuPool(source: Partial<ReturnType<typeof buildPlayerSavePayload>>) {
        return [
            ...starterJutsus,
            ...(((source.creatorJutsus ?? []) as Jutsu[]).map(normalizeJutsu).map(rebalanceNonBloodlineJutsu)),
        ];
    }
    const [arenaKey, setArenaKey] = useState(0);
    const [bloodlineMakerInitialRank, setBloodlineMakerInitialRank] = useState<Rank>("A Rank");
    const [bloodlineMakerInitialElement, setBloodlineMakerInitialElement] = useState("");
    const [bloodlineMakerRankLocked, setBloodlineMakerRankLocked] = useState(false);
    const [bloodlineMakerEditingBloodline, setBloodlineMakerEditingBloodline] = useState<SavedBloodline | null>(null);
    const [currentSector, setCurrentSector] = useState(40);

    // Mint a raid token when an AI raid kicks off. Watches raidBattleKind
    // transitions to "raidAi". Falls back to a null token on network errors
    // — the server then takes the legacy rate-limit-only path, same as a
    // stale client. Placed here (rather than next to the raidBattleKind
    // state above) so `currentSector` is in scope.
    const prevRaidKindRef = useRef<typeof raidBattleKind>("none");
    useEffect(() => {
        const prev = prevRaidKindRef.current;
        prevRaidKindRef.current = raidBattleKind;
        if (prev === raidBattleKind) return;
        if (raidBattleKind !== "raidAi") return;
        if (!character || character.profession !== "vanguard") return;
        void (async () => {
            try {
                const r = await fetch("/api/missions/raid-start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        playerName: character.name,
                        aiId: pendingAiProfileId || undefined,
                        sector: currentSector || undefined,
                    }),
                });
                if (!r.ok) { activeRaidTokenRef.current = null; return; }
                const data = await r.json() as { token?: string | null };
                activeRaidTokenRef.current = typeof data.token === "string" ? data.token : null;
            } catch {
                activeRaidTokenRef.current = null;
            }
        })();
    }, [raidBattleKind, character, pendingAiProfileId, currentSector]);

    const [travelingUntil, setTravelingUntil] = useState(0);
    const [travelNow, setTravelNow] = useState(Date.now());
    const [playerRoster, setPlayerRoster] = useState<PlayerRecord[]>([]);
    const [allServerPlayers, setAllServerPlayers] = useState<ServerPlayerSummary[]>([]);
    const [duelChallenges, setDuelChallenges] = useState<DuelChallenge[]>([]);

    // Auto-cancel stale challenges after 3 minutes. The server inbox + outgoing
    // slot expire via their TTL, but nothing pruned the client list by age — so
    // an un-answered challenge lingered in the recipient's inbox and kept the
    // sender's "pending challenge" guard tripped (e.g. after challenging an
    // offline player who never responds). Sweep every 20s and drop anything
    // older than 3 minutes that isn't tied to a live battle.
    useEffect(() => {
        const CHALLENGE_TIMEOUT_MS = 180000; // 3 minutes — keep in sync with CHALLENGE_TTL in api/player/challenge.ts
        const id = setInterval(() => {
            setDuelChallenges((current) => {
                const fresh = current.filter((c) => c.battleId || Date.now() - (c.createdAt ?? 0) < CHALLENGE_TIMEOUT_MS);
                return fresh.length === current.length ? current : fresh;
            });
        }, 20000);
        return () => clearInterval(id);
    }, []);

    // Realtime push for incoming duel challenges. Listens on the
    // KV key `challenges:<myName>` and merges new entries the
    // moment Postgres commits the write — instead of waiting up
    // to the heartbeat interval (3-15s depending on screen). The
    // heartbeat continues to handle presence + roster + pendingAttacker
    // since those need separate logic; this is a parallel low-latency
    // channel just for incoming challenges.
    useEffect(() => {
        if (!character?.name || !realtimeAvailable()) return;
        // Must match the server's `challenges:<safeName slug>` key (heartbeat /
        // player-challenge write it through safeName), so subscribe via playerSlug.
        const myKey = `challenges:${playerSlug(character.name)}`;
        const unsubscribe = subscribeKvKey<DuelChallenge[]>(myKey, (next) => {
            if (!Array.isArray(next)) return;
            const myNameLower = character.name.toLowerCase();
            const incoming = next
                .filter((c) => (c?.toName ?? "").toLowerCase() === myNameLower)
                .filter((c) => !dismissedChallengeIdsRef.current.has(c.id))
                .map((c) => ({ ...c, challenger: normalizeCharacter(c.challenger) }));
            setDuelChallenges((current) => {
                const merged = current.filter((existing) => !incoming.some((c) => c.id === existing.id));
                return [...merged, ...incoming];
            });
        });
        return () => { if (unsubscribe) unsubscribe(); };
    }, [character?.name]);
    const [processingChallengeIds, setProcessingChallengeIds] = useState<string[]>([]);
    const [pendingPetBattleOpponent, setPendingPetBattleOpponent] = useState<PetArenaOpponent | null>(null);
    const [pendingArenaMatch, setPendingArenaMatch] = useState<{ blue: Pet[]; red: Pet[]; size: 2 | 4; seed: number } | null>(null); // Tactical Arena PvP match → PetArena
    const [pendingArenaResponse, setPendingArenaResponse] = useState<DuelChallenge | null>(null); // incoming arena challenge → PetArena responder picker
    // IDs of challenges the user already handled (accepted / declined /
    // consumed an accepted-or-declined notice). Both the realtime push and the
    // heartbeat poll re-merge from the server, which keeps each challenge for a
    // 120s TTL and NEVER signals removal — so without this guard a stale
    // server snapshot resurrects a challenge the user already dealt with,
    // making accepted challenges "hang around" and block sending/accepting new
    // ones. Any id here is filtered out of every incoming merge. A ref (not
    // state) so the long-lived realtime subscription closure sees it live.
    const dismissedChallengeIdsRef = useRef<Set<string>>(new Set<string>());
    const dismissChallengeLocally = useCallback((id: string) => {
        if (!id) return;
        dismissedChallengeIdsRef.current.add(id);
        setDuelChallenges(prev => prev.filter(c => c.id !== id));
    }, []);

    // Auto-report a clan-war battle result on behalf of the actual
    // battle systems. Reads the clan-war stash placed in
    // sessionStorage by launchClanWarBattle; computes the canonical
    // 'from-wins' / 'to-wins' / 'draw' result based on which side
    // the current player is on. Both the winner's and the loser's
    // clients call this when their respective battle screen
    // resolves — the two-phase tentative+confirm logic on the
    // server merges the matching reports into a single finalized
    // outcome and only applies HP damage once. Players never need
    // to click an "I won" button; the report flows through the
    // game's own win/loss handlers.
    const autoReportClanWarBattleResult = useCallback(async (youWon: boolean | "draw", opponentName?: string) => {
        if (!character) return;
        let stashed: unknown;
        try {
            const raw = sessionStorage.getItem("clanWarChallenge.v1");
            if (!raw) return;
            stashed = JSON.parse(raw);
        } catch { return; }
        const s = stashed as {
            warId?: string;
            challengeId?: string;
            fromClan?: string;
            fromPlayer?: string;
            fromPlayer2?: string | null;
            acceptedPlayer?: string | null;
            acceptedPlayer2?: string | null;
            stashedAt?: number;
        } | null;
        if (!s?.warId || !s.challengeId || !s.fromClan) return;
        // Safety: discard stale stashes (> 24h) so a forgotten
        // sessionStorage entry can't auto-report against an unrelated
        // future battle.
        if (s.stashedAt && Date.now() - s.stashedAt > 24 * 60 * 60 * 1000) {
            try { sessionStorage.removeItem("clanWarChallenge.v1"); } catch { /* ignore */ }
            return;
        }
        const me = character.name.toLowerCase();
        const onFromSide = (s.fromPlayer ?? "").toLowerCase() === me
            || (s.fromPlayer2 ?? "").toLowerCase() === me;
        // Opponent-match check: when the battle screen knows who the
        // opponent was (pet arena passes this), require them to be one
        // of the expected clan-war participants on the opposing side.
        // Stops a stale stash from booking a false report against an
        // unrelated random battle.
        if (opponentName) {
            const opp = opponentName.toLowerCase();
            const expected = onFromSide
                ? [s.acceptedPlayer, s.acceptedPlayer2]
                : [s.fromPlayer, s.fromPlayer2];
            const matches = expected.some(n => (n ?? "").toLowerCase() === opp);
            if (!matches) return;
        }
        let result: CwChallengeResult;
        if (youWon === "draw") {
            result = "draw";
        } else if (youWon) {
            result = onFromSide ? "from-wins" : "to-wins";
        } else {
            result = onFromSide ? "to-wins" : "from-wins";
        }
        try {
            const r = await fetch("/api/clan/war/report", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ warId: s.warId, challengeId: s.challengeId, result }),
            });
            const data = await r.json().catch(() => ({}));
            // Only clear the stash on a finalized report (both sides
            // matched, or the tentative auto-confirmed). Leave it in
            // place during the tentative phase so the OTHER side's
            // client gets a chance to confirm/dispute without the
            // launching player losing context.
            if (r.ok && data?.tentative === false) {
                try { sessionStorage.removeItem("clanWarChallenge.v1"); } catch { /* ignore */ }
            }
        } catch { /* network blip; the other side's report will still finalize */ }
    }, [character]);

    // Launch helper for clan-war challenges. ClanBattlesTab calls this
    // when the player clicks "Launch Battle" on an accepted challenge.
    // We thread it through ShinobiCouncilHall → ClanBattlesTab so the
    // battle screen state is set BEFORE navigation (avoids the blank-
    // screen bug from the audit). PvP routing maps fromPlayer→p1,
    // acceptedPlayer→p2. Pet modes stash the shared seed in
    // sessionStorage for the PetArena screen to pick up. Tile cards
    // currently route to the tavern for manual play; cross-confirmation
    // on report still keeps the result honest.
    const launchClanWarBattle = useCallback((ch: CwChallenge, warId?: string) => {
        if (!character) return;
        const me = character.name.toLowerCase();
        const onFromSide = (ch.fromPlayer ?? "").toLowerCase() === me
            || (ch.fromPlayer2 ?? "").toLowerCase() === me;
        // Stash the clan-war context for the battle screen + any return
        // path. Kept in sessionStorage so it survives a tab refresh.
        // warId is supplied by the caller (ClanBattlesTab knows it from
        // myWar.id); on refresh we look it up via the cache.
        const inferredWarId = warId ?? Object.values(sharedClanWarCache).find(w => w.pendingChallenges.some(c => c.id === ch.id))?.id ?? "";
        try {
            sessionStorage.setItem("clanWarChallenge.v1", JSON.stringify({
                warId: inferredWarId,
                challengeId: ch.id,
                mode: ch.mode,
                fromClan: ch.fromClan,
                fromPlayer: ch.fromPlayer,
                fromPlayer2: ch.fromPlayer2 ?? null,
                acceptedPlayer: ch.acceptedPlayer ?? null,
                acceptedPlayer2: ch.acceptedPlayer2 ?? null,
                battleId: ch.battleId ?? null,
                petBattleSeed: ch.petBattleSeed ?? null,
                stashedAt: Date.now(),
            }));
        } catch { /* sessionStorage may be unavailable */ }

        switch (ch.mode) {
            case "pvp1v1":
            case "pvp2v2": {
                if (!ch.battleId) {
                    alert("Battle session not ready yet — refresh and try again.");
                    return;
                }
                // Determine role: senders are p1, defenders are p2.
                setPvpBattleId(ch.battleId);
                setPvpRole(onFromSide ? "p1" : "p2");
                setPvpBattleContext({
                    mode: ch.mode === "pvp2v2" ? "clanWar2v2" : "clanWar1v1",
                    clanWarChallengeId: ch.id,
                });
                setScreen("pvpBattle");
                break;
            }
            case "pet1v1":
            case "pet2v2":
                // PetArena reads sessionStorage on mount (Phase D) to
                // configure the opponent + deterministic seed.
                setScreen("petArena");
                break;
            case "tilecards": {
                // PvP Shinobi Card Clash duel — server-managed session, auto-join
                // with a legal 12-card FALLBACK deck (the player's saved Card Hall
                // deck if valid, else an auto-built one). The duel screen lets them
                // customise during the 30s picking phase; on timeout the fallback
                // is promoted. Both clients race to join; the server is idempotent.
                const allCards = getAllTileCards([]);
                const clash = allCards.map(deriveCardClashCard);
                const byId = Object.fromEntries(clash.map(c => [c.id, c]));
                const saved = character.cardClashDeck ?? [];
                const deckIds = validateClashDeck(saved, byId).valid
                    ? saved
                    : buildPlayableDeck(character.tileCards ?? [], byId, clash);
                const deckPayload = deckIds.map(id => {
                    const c = byId[id];
                    const ability = c.abilityType === "ongoingElementBoostHere" ? "none" : c.abilityType;
                    return { id: c.id, element: c.element, rarity: c.rarity, cost: c.cost, power: c.power, ability };
                });
                void fetch("/api/clan/war/tilecards", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "join",
                        warId: inferredWarId,
                        challengeId: ch.id,
                        defaultDeck: deckPayload,
                    }),
                }).catch(() => { /* the duel screen polls + retries */ });
                setScreen("tilecardsDuel");
                break;
            }
        }
    }, [character]);

    // Clan-war auto-launch: when a challenge in sharedClanWarCache
    // flips to 'accepted' and the current player is a participant,
    // pull them into the appropriate battle screen automatically.
    // Both sides hit this path — the accepter at the moment they
    // accept (via the refresh that handleAccept triggers) and the
    // challenger when the next polling tick brings the cache up to
    // date. The ref prevents re-launching the same challenge twice
    // in one session; on hard refresh the ref resets, which is
    // correct (the player needs to be put back in the fight if it
    // hasn't completed yet — server status is the source of truth).
    const autoLaunchedClanWarChallenges = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!character) return;
        // Don't yank players out of an active battle / story / boss
        // screen — they're already committed to something.
        const inBattleScreen = BATTLE_SCREENS.has(screen);
        if (inBattleScreen) return;

        const me = character.name.toLowerCase();
        for (const war of Object.values(sharedClanWarCache)) {
            if (war.endedAt) continue;
            for (const ch of war.pendingChallenges) {
                if (ch.status !== "accepted") continue;
                if (autoLaunchedClanWarChallenges.current.has(ch.id)) continue;
                const iAmParticipant = (ch.fromPlayer ?? "").toLowerCase() === me
                    || (ch.fromPlayer2 ?? "").toLowerCase() === me
                    || (ch.acceptedPlayer ?? "").toLowerCase() === me
                    || (ch.acceptedPlayer2 ?? "").toLowerCase() === me;
                if (!iAmParticipant) continue;
                autoLaunchedClanWarChallenges.current.add(ch.id);
                launchClanWarBattle(ch, war.id);
                return; // launch one at a time
            }
        }
    }, [character, screen, clanWarStateVersion, launchClanWarBattle]);

    // Tracks whether the player is mid-Shinobi-Tile card game launched from a
    // Hollow Gate tile_game tile. Used to apply the -20% maxHp penalty on
    // loss + route back to the shrine afterwards. Now also read: it drives the
    // App-level battle-lock keeper for the hollow-gate tile seal so a refresh
    // can't flee the seal back to the shrine.
    const [hollowGateTileGameActive, setHollowGateTileGameActive] = useState(false);
    const [triggeredEvents, setTriggeredEvents] = useState<string[]>([]);
    // liveSectorPlayers now lives in lib/presence-store (external store) so the
    // ~1s heartbeat updates only the sector view, not the whole App tree. Read it
    // with useLiveSectorPlayers(); write it with pushLiveSectorPlayers()/etc.
    const [incomingAttackBanner, setIncomingAttackBanner] = useState("");
    const [activeTriggeredEvent, setActiveTriggeredEvent] = useState<CreatorEvent | null>(null);
    const [activeTriggerReturnScreen, setActiveTriggerReturnScreen] = useState<Screen>("village");
    const [pendingArenaStoryBattle, setPendingArenaStoryBattle] = useState<PendingArenaStoryBattle | null>(null);
    const [triggerPage, setTriggerPage] = useState(0);
    const [triggerLine, setTriggerLine] = useState(0);
    const [activeDungeonEvent, setActiveDungeonEvent] = useState<CreatorEvent | null>(null);
    const [pendingEventEncounter, setPendingEventEncounter] = useState<PendingEventEncounter | null>(null);
    const [dungeonStage, setDungeonStage] = useState<"intro" | "tile" | "pet" | "complete">("intro");
    const [dungeonPage, setDungeonPage] = useState(0);
    const [dungeonLine, setDungeonLine] = useState(0);
    const [dungeonReturnScreen, setDungeonReturnScreen] = useState<Screen>("worldMap");
    // Warn before refresh/close during battle or while hospitalized
    useEffect(() => {
        function handleBeforeUnload(e: BeforeUnloadEvent) {
            if (raidBattleKind !== "none" || (character?.hospitalized && screen === "hospital")) {
                e.preventDefault();
            }
        }
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [raidBattleKind, character?.hospitalized, screen]);

    // Multiplayer heartbeat — keeps server presence alive and detects incoming attacks
    const characterRef = useRef<Character | null>(null);
    useEffect(() => { characterRef.current = character; }, [character]);
    const screenRef = useRef<Screen>(screen);
    useEffect(() => { screenRef.current = screen; }, [screen]);
    // Step 3 realtime: true while the Socket.IO presence channel is connected.
    // When connected, the HTTP heartbeat can poll slowly (the socket pushes live
    // sector presence and kicks an immediate poll on incoming attack/challenge);
    // when disconnected we fall straight back to the fast adaptive poll.
    const [socketConnected, setSocketConnected] = useState(false);
    // Lets the socket "kick" handler trigger an off-cycle heartbeat without the
    // heartbeat being in scope (it's redefined each effect run).
    const heartbeatRef = useRef<() => void>(() => {});
    // Throttles the per-beat roster ingest (see heartbeat) so the cross-device
    // player list isn't re-normalized + re-set on the hot 1s combat/explore beat.
    const lastRosterMergeAt = useRef(0);
    // Travel rubber-banding guard — applySnapshot used to clobber a freshly
    // travelled-to sector with the server's stale value (409 refetch, admin
    // forceReload, etc.). Two refs work together to fix it:
    //   - currentSectorRef: lets the snapshot appliers compare against the
    //     live value without going through stale closures.
    //   - lastLocalSectorChangeRef: timestamp of the most recent local
    //     sector change; the snapshot appliers honor a 30s "local wins"
    //     guard so a save round-trip can't replace your new sector with
    //     the server's previous one.
    //   - lastSnapshotAppliedSectorRef: tag set by applySnapshot/
    //     applyServerSnapshot right before they call setCurrentSector, so
    //     the dirty-mark effect below can distinguish a snapshot-driven
    //     sector change from a real user-initiated one.
    const currentSectorRef = useRef(currentSector);
    useEffect(() => { currentSectorRef.current = currentSector; }, [currentSector]);
    const lastLocalSectorChangeRef = useRef(0);
    const lastSnapshotAppliedSectorRef = useRef<number | null>(null);
    // (The save-dirty effect that consumes these refs is defined further
    // down where charDirtyRef is in scope — see "Mark the save dirty when
    // sector changes locally" below.)
    // 30s window during which a fresh local sector change overrides a
    // snapshot's stored sector. Long enough to ride out a save round-trip
    // (autosave 3-15s + network latency), short enough that legitimate
    // multi-tab/admin reset snapshots still apply within a few seconds of
    // the player being idle.
    const SECTOR_LOCAL_GUARD_MS = 30_000;
    function applySnapshotSectorWithGuard(snapshotSector: number) {
        const localFresh = (Date.now() - lastLocalSectorChangeRef.current) < SECTOR_LOCAL_GUARD_MS;
        if (localFresh && snapshotSector !== currentSectorRef.current) {
            // Local change wins — keep current value, refresh the timestamp
            // so the guard slides forward as long as snapshots keep arriving.
            lastLocalSectorChangeRef.current = Date.now();
            return;
        }
        // No fresh local change (or values already aligned) — adopt the
        // server's view. Tag the change so the dirty-mark effect skips it.
        lastSnapshotAppliedSectorRef.current = snapshotSector;
        setCurrentSector(snapshotSector);
    }
    // Clear the pet-PvP resume breadcrumb whenever the player leaves the
    // pet arena. Combined with the server-side reportKey dedup, this means
    // refreshing mid-fight restores correctly, but refreshing AFTER the
    // user navigates away can't re-trigger a stale battle replay.
    useEffect(() => {
        if (screen === "petArena") return;
        try { localStorage.removeItem(PENDING_PET_PVP_KEY); } catch { /* ignore */ }
    }, [screen]);
    const isTraveling = travelingUntil > travelNow;

    useEffect(() => {
        if (!isTraveling) return;
        const id = window.setInterval(() => setTravelNow(Date.now()), 250);
        return () => window.clearInterval(id);
    }, [isTraveling]);

    useEffect(() => {
        if (!character) return;

        async function heartbeat() {
            const char = characterRef.current;
            if (!char) return;
            // inBattle covers screens where the player is ACTUALLY mid-fight (PvP +
            // PvE) so attack.ts/challenge.ts can reject double-battle requests and
            // Healers can't heal an active fighter. The opponent-search HUBS
            // ('arena' = spar/PvP search, 'petArena' = pet search) are deliberately
            // EXCLUDED: a player browsing them to send/receive a challenge is not in
            // a battle, and flagging them made every incoming challenge fail with
            // "Target is already in a battle." The live PvP fight runs on 'pvpBattle';
            // pet battles are local sims that a queued challenge doesn't interrupt.
            const inBattleNow = ['pvpBattle', 'storyBoss', 'hollowGateShrine', 'weeklyBoss', 'eventPetBattle', 'dungeon'].includes(screenRef.current ?? '')
                || (screenRef.current === 'battleTowers' && hasActiveTowerFight()); // tower lobby stays challengeable; only an on-board fight flags in-battle
            // Upload only the display fields the roster surfaces, not the full
            // character blob — see presenceCharacter(). Gameplay/PvP paths read the
            // presence row's sector/inBattle/travel flags, not this character; combat
            // hydrates opponents from save:<name>.
            const presenceBody = {
                name: char.name,
                sector: currentSector,
                character: presenceCharacter(char),
                travelingUntil: isTraveling ? travelingUntil : 0,
                inBattle: inBattleNow,
                tile: getLocalSectorTile(),
            };
            // Mirror the same frame onto the Socket.IO presence channel (no-op when
            // the socket isn't connected). Because a sector change re-runs this
            // effect and fires heartbeat() immediately, the move propagates to
            // sector-mates instantly; the 20s+ keepalive ping rides along too.
            updatePresence({
                sector: currentSector,
                character: presenceBody.character,
                travelingUntil: presenceBody.travelingUntil,
                inBattle: inBattleNow,
                displayName: char.name,
                tile: presenceBody.tile,
            });
            try {
                const res = await fetch('/api/player/heartbeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(presenceBody),
                });
                if (!res.ok) return;
                const data: { sectorMates?: PlayerRecord[]; allPlayers?: PlayerRecord[]; pendingAttacker?: Character | null; pendingChallenges?: DuelChallenge[]; pendingHeal?: { by?: string } | null; forceReload?: boolean } = await res.json();
                // Admin reset this account — wipe local state and reload from server
                if (data.forceReload) {
                    const accountName = currentAccountName || char.name.toLowerCase();
                    // Admin accounts never respond to force-reload signals — admin writes
                    // to player keys, not their own, so a signal on "admin1" should not
                    // disrupt the admin session. Just ack and continue.
                    if (adminLoggedIn) {
                        await fetch(`/api/save/${encodeURIComponent(accountName)}?ack=1`, { method: "POST" });
                        return;
                    }
                    const saveRes = await fetch(`/api/save/${encodeURIComponent(accountName)}`);
                    if (saveRes.ok) {
                        const snap = await saveRes.json() as ReturnType<typeof buildPlayerSavePayload>;
                        // Apply full snapshot so all admin-given changes (pets, currencies,
                        // items, etc.) are reflected across the entire player state.
                        applyServerSnapshot(snap);
                        await fetch(`/api/save/${encodeURIComponent(accountName)}?ack=1`, { method: "POST" });
                    } else {
                        // Save was deleted (account reset) — also clear localStorage so the
                        // stale level-100 snapshot can't be reloaded on the next login.
                        const lsKey = accountKey(accountName);
                        if (lsKey) {
                            const accounts = loadPlayerAccounts();
                            delete accounts[lsKey];
                            savePlayerAccounts(accounts);
                        }
                        setCharacter(null);
                        setCurrentAccountName("");
                        setScreen("start");
                        await fetch(`/api/save/${encodeURIComponent(accountName)}?ack=1`, { method: "POST" });
                    }
                    return;
                }
                // Live sector-mates → the presence store (external store) so the ~1s
                // heartbeat updates only the sector view, not all of App (Phase 1A).
                if (data.sectorMates) pushLiveSectorPlayers(data.sectorMates);
                // Roster feeds non-urgent social screens (search/spar/pet arena), never
                // combat (which re-hydrates from save:<name>). Throttle the ingest — the
                // per-beat path normalizes up to 100 characters + re-renders all of App,
                // pure waste on the hot 1s beat; every ~12s is plenty. (mergePlayerRoster)
                if (data.allPlayers?.length && Date.now() - lastRosterMergeAt.current > 12000) {
                    lastRosterMergeAt.current = Date.now();
                    setPlayerRoster(prev => mergePlayerRoster(prev, data.allPlayers!, normalizeCharacter));
                }
                if (data.pendingChallenges?.length) {
                    setDuelChallenges((current) => {
                        const myNameLower = char.name.toLowerCase();
                        const incoming = data.pendingChallenges!
                            .filter((challenge) => challenge.toName.toLowerCase() === myNameLower)
                            .filter((challenge) => !dismissedChallengeIdsRef.current.has(challenge.id))
                            .map((challenge) => ({ ...challenge, challenger: normalizeCharacter(challenge.challenger) }));
                        if (!incoming.length) return current;
                        const merged = current.filter((existing) => !incoming.some((challenge) => challenge.id === existing.id));
                        return [...merged, ...incoming];
                    });
                }
                if (data.pendingAttacker && !isTraveling) {
                    // Heartbeat says someone is attacking us, but we haven't received the
                    // DuelChallenge with the server battleId yet (it arrives a beat
                    // later). Just show the banner — when the challenge lands, the
                    // duelChallenges effect routes us to PvpBattleScreen with the real
                    // battleId. Previously we set pendingPvpOpponent + setScreen('arena')
                    // here, which dropped the defender into the local-sim arena where a
                    // "win" was client-decided (honor seals, ryo, kill counters, etc.).
                    // The session-backed PvpBattleScreen is the only correct path.
                    const attacker = normalizeCharacter(data.pendingAttacker);
                    setIncomingAttackBanner(`${attacker.name} is attacking you!`);
                    setTimeout(() => setIncomingAttackBanner(""), 4000);
                }
                // A Healer discharged us from the hospital — sync local state, toast
                // who healed us, and leave the admitted screen (we're hard-locked there
                // otherwise). Server already cleared hospitalized; mirror it locally.
                if (data.pendingHeal && characterRef.current?.hospitalized) {
                    const by = data.pendingHeal.by || "a Healer";
                    setCharacter(c => c ? { ...c, hp: c.maxHp, chakra: c.maxChakra, stamina: c.maxStamina, hospitalized: false, hospitalizedUntil: 0, hospitalizedAt: 0 } : c);
                    window.dispatchEvent(new CustomEvent('profession-mission-complete', { detail: { name: `Healed by ${by}`, xp: 0, profession: 'healer', label: '✚ You\'ve been healed' } }));
                    if (screenRef.current === "hospital") setScreen("village");
                }
            } catch {
                // Server unavailable — silently skip
            }
        }

        // Expose the latest heartbeat so the socket "kick" handler can fire an
        // immediate off-cycle poll on an incoming attack/challenge.
        heartbeatRef.current = heartbeat;

        if (!tabVisible) return; // pause heartbeat when tab hidden
        heartbeat();
        // Adaptive heartbeat interval. When the Socket.IO presence channel is
        // CONNECTED it owns liveness: it pushes live sector presence and kicks an
        // immediate poll on incoming attack/challenge, so the HTTP poll only needs
        // to be a slow (~20s) reconcile + forceReload backstop — this is the win
        // that removes the bulk of the request volume. When the socket is DOWN we
        // fall straight back to the original fast adaptive cadence so nothing
        // regresses: 1s in combat/arena AND while exploring sectors, 15s in the
        // village (sector 0). Village-queued guards also stay fast so a raider's
        // attack reaches the defender within ~1s.
        const currentScreen = screenRef.current;
        const SOCKET_RECONCILE_MS = 20000;
        const interval = socketConnected
            ? SOCKET_RECONCILE_MS
            : currentScreen === "pvpBattle" || currentScreen === "arena" || currentScreen === "petArena"
            ? 1000   // in combat — fast challenge/attack delivery
            : character?.guardQueued
            ? 1000   // queued for village defense — must respond to raids fast
            : currentSector === 0
            ? 15000  // village — no urgent combat needs
            : 1000;  // exploring sectors — live presence
        const id = setInterval(heartbeat, interval);
        return () => clearInterval(id);
    }, [character?.name, character?.guardQueued, currentSector, isTraveling, travelingUntil, screen, tabVisible, socketConnected]);

    // Step 3 realtime: open the Socket.IO presence channel for the logged-in
    // player and wire its pushes into the same state the HTTP heartbeat feeds.
    // Connects once per login (deps: character?.name) and lets the heartbeat keep
    // the presence frame fresh via updatePresence(). All four subscriptions are
    // additive — if the socket never connects, these simply never fire and the
    // HTTP heartbeat path is unchanged.
    useEffect(() => {
        if (!character?.name) return;
        const char = characterRef.current;
        if (!char) return;
        const inBattleNow = ['pvpBattle', 'storyBoss', 'hollowGateShrine', 'weeklyBoss', 'eventPetBattle', 'dungeon'].includes(screenRef.current ?? '')
            || (screenRef.current === 'battleTowers' && hasActiveTowerFight()); // see heartbeat note: lobby challengeable, on-board fight not
        // Place us immediately; the heartbeat (which fires now and on every sector
        // change) supersedes this frame with the authoritative travel/battle state.
        connectRealtime({
            sector: currentSectorRef.current,
            character: presenceCharacter(char),
            travelingUntil: 0,
            inBattle: inBattleNow,
            displayName: char.name,
            tile: getLocalSectorTile(),
        });
        const offStatus = onPresenceStatus((connected) => setSocketConnected(connected));
        const offSector = onPresenceSector((sector, players) => {
            // Only adopt a snapshot for the sector we're actually standing in.
            if (sector === currentSectorRef.current) pushLiveSectorPlayers(players);
        });
        const offGone = onPresenceGone((names) => {
            removeLiveSectorPlayers(names);
        });
        // A kick means an attack/challenge is queued — run an immediate off-cycle
        // heartbeat (the authoritative carrier) so it lands without poll latency.
        const offKick = onPresenceKick(() => { heartbeatRef.current?.(); });
        return () => {
            offStatus();
            offSector();
            offGone();
            offKick();
            disconnectRealtime();
            resetLiveSectorPlayers();
            setSocketConnected(false);
        };
    }, [character?.name]);

    async function clearChallengeOnServer(challenge: DuelChallenge) {
        await fetch('/api/player/challenge', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetName: challenge.toName,
                fromName: challenge.fromName,
                challengeId: challenge.id,
            }),
        }).catch(() => {});
    }

    function declineChallengeGlobal(challenge: DuelChallenge) {
        dismissChallengeLocally(challenge.id);
        void clearChallengeOnServer(challenge);
        fetch('/api/player/challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetName: challenge.fromName,
                challenge: {
                    ...challenge,
                    declined: true,
                    fromName: character?.name ?? challenge.toName,
                    toName: challenge.fromName,
                },
            }),
        }).catch(() => {});
    }

    async function acceptPetChallengeGlobal(challenge: DuelChallenge) {
        if (!character) return;
        if (processingChallengeIds.includes(challenge.id)) return;

        if (challenge.arenaMatch) { // Tactical Arena PvP — route to PetArena's responder team picker
            dismissChallengeLocally(challenge.id);
            void clearChallengeOnServer(challenge);
            setPendingArenaResponse(challenge);
            setScreen("petArena");
            return;
        }

        const myPet = character.pets.find(pet => pet.id === character.activePetId && !isPetOnExpedition(pet)) ?? character.pets.find(pet => !isPetOnExpedition(pet));
        const challengerPet = challenge.challenger.pets.find(pet => pet.id === challenge.challengerPetId && !isPetOnExpedition(pet)) ?? challenge.challenger.pets.find(pet => !isPetOnExpedition(pet));
        if (!myPet || !challengerPet || isPetOnExpedition(challengerPet)) {
            alert("Both players need a pet before this pet battle can start.");
            return;
        }

        // ── 2v2 party path ─────────────────────────────────────────────
        // If the challenger flagged petParty, we auto-pick our top two
        // available pets (highest level, not on expedition) so the player
        // doesn't have to scramble through a picker mid-notification. We
        // also need the challenger's reserve pet (sent as challengerPetIds).
        const wantsParty = challenge.petParty === true && Array.isArray(challenge.challengerPetIds);
        const myAvailable = character.pets.filter(p => !isPetOnExpedition(p));
        let myParty: [Pet, Pet] | null = null;
        let challengerParty: [Pet, Pet] | null = null;
        if (wantsParty && myAvailable.length >= 2) {
            const [chId1, chId2] = challenge.challengerPetIds!;
            const ch1 = challenge.challenger.pets.find(p => p.id === chId1) ?? challengerPet;
            const ch2 = challenge.challenger.pets.find(p => p.id === chId2 && p.id !== ch1.id)
                ?? challenge.challenger.pets.find(p => p.id !== ch1.id);
            if (ch1 && ch2) {
                challengerParty = [ch1, ch2] as [Pet, Pet];
                // Smart 2v2 picker: given the challenger's locked-in lead+reserve,
                // pick MY lead+reserve to maximize summed matchup score (stat
                // ratio × element edge × trait counter penalty). Falls back to
                // top-2-by-level if the picker can't decide (shouldn't happen
                // with 2+ available pets).
                const smart = pickBestPartyOrder(myAvailable, challengerParty);
                if (smart) {
                    myParty = smart;
                } else {
                    const sortedByLvl = [...myAvailable].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
                    myParty = [sortedByLvl[0], sortedByLvl[1]] as [Pet, Pet];
                }
            }
        }
        const doParty = !!(wantsParty && myParty && challengerParty);

        setProcessingChallengeIds(prev => [...prev, challenge.id]);
        dismissChallengeLocally(challenge.id);
        await clearChallengeOnServer(challenge);
        const isRanked = challenge.mode === "rankedPet";
        const acceptedNotice: DuelChallenge = {
            ...challenge,
            accepted: true,
            fromName: character.name,
            toName: challenge.fromName,
            responderPetId: myPet.id,
            responderPet: myPet,
            // Stamp my pet-ranked rating so the challenger can compute its
            // symmetric Elo delta when the accepted notice routes it in.
            ...(isRanked ? { responderPetRating: character.petRankedRating ?? 1000 } : {}),
            ...(doParty && myParty ? {
                petParty: true,
                responderPetIds: [myParty[0].id, myParty[1].id] as [string, string],
                responderParty: myParty,
            } : {}),
        };
        const notified = await postPlayerChallengeNotice(challenge.fromName, acceptedNotice);
        const opponentForResume: PetArenaOpponent = {
            owner: challenge.fromName,
            pet: challengerPet,
            battleSeed: challenge.petBattleSeed,
            // For ranked, the challenger is my opponent — carry their rating
            // snapshot so my own Elo math has both sides. selfPet locks MY
            // combatant to the exact pet I just sent as responderPet so the
            // canonical sim matches the challenger's view of it.
            ...(isRanked ? { ranked: true, opponentRating: challenge.challengerPetRating ?? 1000, selfPet: myPet, petRankedToken: challenge.petRankedToken } : {}),
            ...(doParty && challengerParty && myParty ? {
                opponentParty: challengerParty,
                challengerParty: myParty,
            } : {}),
        };
        // Persist so a mid-fight refresh restores the same deterministic
        // battle on remount instead of silently abandoning it. 5-min TTL.
        // stripDataUrlImages keeps the payload bounded — pet/avatar art
        // gets re-hydrated from sharedImages on remount.
        //
        // Ranked battles are NOT persisted: the resume path re-runs
        // startBattle, and ranked applies the Elo delta purely client-side
        // (no server-deduped reportKey like the clan-war/PvE win path), so a
        // refresh would re-award rating. Better to abandon an interrupted
        // ranked fight than to open a refresh-to-farm-Elo exploit.
        if (!isRanked) {
            try {
                localStorage.setItem(PENDING_PET_PVP_KEY, JSON.stringify({ opponent: stripDataUrlImages(opponentForResume), savedAt: Date.now() }));
            } catch { /* private mode / quota — battle will just not resume on refresh */ }
        }
        setPendingPetBattleOpponent(opponentForResume);
        setScreen("petArena");
        setProcessingChallengeIds(prev => prev.filter(id => id !== challenge.id));
        if (!notified) alert(`${challenge.fromName} may not be pulled in automatically. Ask them to open the Pet Coliseum if they do not see the fight.`);
    }

    // Fetch full server player list (includes offline players from registry)
    useEffect(() => {
        if (!character?.name) return;
        async function fetchRoster(fresh = false) {
            try {
                const res = await fetch(fresh ? `/api/player/roster?fresh=${Date.now()}` : '/api/player/roster');
                if (!res.ok) return;
                const data = await res.json() as { players?: ServerPlayerSummary[] };
                if (data.players?.length) {
                    const serverPlayers = data.players.filter(p => p.name.toLowerCase() !== character!.name.toLowerCase());
                    setAllServerPlayers(serverPlayers);
                    setPlayerRoster((prev) => {
                        const merged = [...prev];
                        for (const incoming of serverPlayers) {
                            if (!incoming.character) continue;
                            const normalized = normalizeCharacter(incoming.character);
                            const record: PlayerRecord = {
                                name: incoming.name || normalized.name,
                                level: incoming.level ?? normalized.level,
                                village: incoming.village || normalized.village,
                                specialty: (incoming.specialty as JutsuType | undefined) ?? normalized.specialty,
                                character: normalized,
                                currentSector: incoming.currentSector ?? 40,
                                lastSeenAt: incoming.lastSeenAt ?? Date.now(),
                            };
                            const idx = merged.findIndex(p => p.name.toLowerCase() === record.name.toLowerCase());
                            if (idx >= 0) merged[idx] = { ...merged[idx], ...record };
                            else merged.push(record);
                        }
                        return merged;
                    });
                }
            } catch { /* silently skip */ }
        }
        fetchRoster(currentSector >= 1);
        // Poll at the roster endpoint's CDN TTL (s-maxage=60). The old 5-min
        // cadence left the search's 🟢/⚫ online dot up to 5 min stale, so a
        // player who was actually online showed "Offline". Polling every 60s
        // makes the dot as fresh as the cache allows; because the response is
        // CDN-cached for 60s, the extra client polls are absorbed by the edge
        // (the serverless function still runs ~once per 60s globally), so this
        // is a freshness win at negligible origin cost.
        const id = setInterval(fetchRoster, 60000); // refresh every 60s (matches CDN TTL)
        return () => clearInterval(id);
    }, [character?.name, currentSector]);

    useEffect(() => {
        // /api/bloodlines/list is auth-gated (it scans every save), so it 401s
        // for anonymous visitors. The public-bloodline gallery only shows inside
        // the logged-in codex anyway, so skip the fetch until a character is
        // active — this drops a wasted 401 on every cold landing.
        if (!character?.name) return;
        async function fetchPublicBloodlines() {
            try {
                const res = await fetch('/api/bloodlines/list');
                if (!res.ok) return;
                const data = await res.json() as { bloodlines?: ReviewBloodline[] };
                setPublicPlayerBloodlines((data.bloodlines ?? []).map((bloodline) => ({
                    ...bloodline,
                    rank: bloodline.rank as Rank,
                    jutsus: (bloodline.jutsus ?? []).map(normalizeJutsu),
                })));
            } catch { /* silently skip */ }
        }
        fetchPublicBloodlines();
        const id = setInterval(fetchPublicBloodlines, 300000);
        return () => clearInterval(id);
    }, [character?.name]);

    // Sector-attack auto-routing: if a sectorAttack challenge arrives, route defender to
    // the shared PvP battle (battleId present) or legacy arena as fallback.
    useEffect(() => {
        if (!character) return;
        const incoming = duelChallenges.find(c => c.toName.toLowerCase() === character.name.toLowerCase() && c.sectorAttack);
        if (!incoming) return;
        if (isTraveling) {
            declineChallengeGlobal(incoming);
            return;
        }
        setDuelChallenges(prev => prev.filter(c => c.id !== incoming.id));
        if (incoming.battleId) {
            setPvpBattleId(incoming.battleId);
            setPvpRole("p2");
            setPvpBattleContext({ mode: incoming.mode, clanWarPoints: incoming.clanWarPoints, sectorAttack: true, raidKind: "defense", sector: currentSector, kageChallengeId: incoming.kageChallengeId, kageVillage: incoming.kageVillage });
            setScreen("pvpBattle");
        } else {
            // Legacy challenge missing a server battleId — refuse to fall through
            // to local-sim arena. All current attacker paths create a server
            // session BEFORE notifying the defender, so this branch only fires
            // for stale/pre-session-creation clients. A "defense win" in the
            // local sim used to grant honor seals + kill counters from a
            // client-decided outcome; drop the challenge instead of routing.
            alert(`${incoming.challenger?.name ?? "Someone"} tried to attack you but their client is out of date — ask them to reload.`);
        }
    }, [duelChallenges, character?.name, isTraveling]);

    // Accepted-challenge routing: when the defender accepts a spar/ranked challenge they push back
    // an accepted:true notification with a battleId — auto-route the original challenger to pvpBattle as p1.
    useEffect(() => {
        if (!character) return;
        const accepted = duelChallenges.find(c => c.accepted && c.toName.toLowerCase() === character.name.toLowerCase());
        if (!accepted) return;
        // Mark dismissed AND delete from the server inbox — otherwise the
        // accepted notice (120s TTL) keeps getting re-pushed and this effect
        // re-fires, re-routing to battle / re-alerting forever.
        dismissChallengeLocally(accepted.id);
        void clearChallengeOnServer(accepted);
        if (accepted.arenaMatch) { // Tactical Arena PvP — challenger side
            const match = buildAcceptedArenaMatch(accepted);
            if (match) setPendingArenaMatch(match);
            else alert(`${accepted.fromName} accepted your Tactical Pet Arena challenge. Open the Pet Coliseum if it doesn't start.`);
            setScreen("petArena");
            return;
        }
        if (accepted.mode === "clanWarPet" || accepted.mode === "rankedPet") {
            if (accepted.responderPet) {
                // Reconstruct the challenger's own party from the IDs they
                // originally sent — character.pets is the authoritative source.
                const myParty: [Pet, Pet] | undefined = (accepted.petParty && accepted.challengerPetIds && character)
                    ? (() => {
                        const [a, b] = accepted.challengerPetIds!;
                        const p1 = character.pets.find(p => p.id === a);
                        const p2 = character.pets.find(p => p.id === b && p.id !== a);
                        return (p1 && p2) ? [p1, p2] as [Pet, Pet] : undefined;
                    })()
                    : undefined;
                const opponentForResume: PetArenaOpponent = {
                    owner: accepted.fromName,
                    pet: accepted.responderPet,
                    battleSeed: accepted.petBattleSeed,
                    // Ranked: the responder is my opponent — carry the rating
                    // they stamped on the accepted notice for my Elo math, and
                    // lock MY combatant to the pet I originally challenged with
                    // (challengerPetId) so the canonical sim stays in sync.
                    ...(accepted.mode === "rankedPet"
                        ? { ranked: true, opponentRating: accepted.responderPetRating ?? 1000, selfPet: character.pets.find(p => p.id === accepted.challengerPetId), petRankedToken: accepted.petRankedToken }
                        : {}),
                    ...(accepted.petParty && accepted.responderParty && myParty ? {
                        opponentParty: accepted.responderParty,
                        challengerParty: myParty,
                    } : {}),
                };
                // Mirror of the accept-side persistence: store enough state
                // so a refresh restores the deterministic battle. Strip data
                // URLs before serializing — pet art rehydrates from sharedImages.
                // Ranked is excluded (see acceptPetChallengeGlobal): its Elo
                // delta is applied client-side without a deduped reportKey, so
                // a refresh-resume would re-award rating.
                if (accepted.mode !== "rankedPet") {
                    try {
                        localStorage.setItem(PENDING_PET_PVP_KEY, JSON.stringify({ opponent: stripDataUrlImages(opponentForResume), savedAt: Date.now() }));
                    } catch { /* ignore */ }
                }
                setPendingPetBattleOpponent(opponentForResume);
                setScreen("petArena");
            } else {
                alert(`${accepted.fromName} accepted your pet battle. Open the Pet Coliseum if it does not start automatically.`);
                setScreen("petArena");
            }
            return;
        }
        if (!accepted.battleId) {
            alert(`${accepted.fromName} accepted your challenge.`);
            return;
        }
        setPvpBattleId(accepted.battleId!);
        setPvpRole("p1");
        setPvpBattleContext({ mode: accepted.mode, clanWarPoints: accepted.clanWarPoints, sectorAttack: accepted.sectorAttack, sector: currentSector, kageChallengeId: accepted.kageChallengeId, kageVillage: accepted.kageVillage });
        setScreen("pvpBattle");
    }, [duelChallenges, character?.name]);

    useEffect(() => {
        if (!character) return;
        const declined = duelChallenges.find(c => c.declined && c.toName.toLowerCase() === character.name.toLowerCase());
        if (!declined) return;
        dismissChallengeLocally(declined.id);
        void clearChallengeOnServer(declined);
        alert(`${declined.fromName} declined your challenge.`);
    }, [duelChallenges, character?.name]);

    // App-level accept for spar/ranked challenges — allows accepting from any screen,
    // not just when the player has already navigated to the Arena.
    async function acceptChallengeGlobal(challenge: DuelChallenge) {
        if (!character) return;
        if (processingChallengeIds.includes(challenge.id)) return;
        setProcessingChallengeIds(prev => [...prev, challenge.id]);
        const challenger = normalizeCharacter(challenge.challenger);
        dismissChallengeLocally(challenge.id);
        try {
            const [p1CombatSave, p2CombatSave] = await Promise.all([
                fetchPlayerCombatSave(challenge.fromName),
                fetchPlayerCombatSave(character.name),
            ]);
            const p1SavedBloodlines = p1CombatSave?.savedBloodlines ?? savedBloodlines;
            const p1CreatorJutsus = p1CombatSave?.creatorJutsus ?? creatorJutsus;
            const p2SavedBloodlines = p2CombatSave?.savedBloodlines ?? savedBloodlines;
            const p2CreatorJutsus = p2CombatSave?.creatorJutsus ?? creatorJutsus;
            const p1Character = p1CombatSave?.character ?? challenger;
            const p2Character = p2CombatSave?.character ?? character;
            const p1AllItems = getAllItems(p1CombatSave?.creatorItems ?? creatorItems);
            const p2AllItems = getAllItems(p2CombatSave?.creatorItems ?? creatorItems);
            const p1Jutsus = p1CombatSave?.character
                ? getPvpJutsuLoadout(p1SavedBloodlines, p1CreatorJutsus, p1Character)
                : challenge.challengerJutsus?.length
                    ? challenge.challengerJutsus.map(normalizeJutsu)
                    : getPvpJutsuLoadout(p1SavedBloodlines, p1CreatorJutsus, p1Character);
            const p2Jutsus = getPvpJutsuLoadout(p2SavedBloodlines, p2CreatorJutsus, p2Character);
            const res = await fetch('/api/pvp/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: stringifyPvpSessionPayload({
                    // Sector attacks bring current vitals; spar/ranked reset to full.
                    useCurrentVitals: !!challenge.sectorAttack,
                    // Ranked-match markers (audit #7 / Stage 3). When ranked, the
                    // server snapshots BOTH fighters' pre-match Elo from their
                    // saves and claim-rewards credits the rating server-side; the
                    // client still self-applies for now (the two converge — same
                    // formula, same snapshot). Only the ranked ladder (queue +
                    // ranked challenges) sets this — never spar / clan-war / sector.
                    ranked: challenge.mode === "ranked",
                    rankedKind: "player",
                    // Server-authoritative base PvP-win reward (audit #7 / Stage 3
                    // Phase 3; PvP-audit #1/#3): the server credits the winner's
                    // base ryo + XP on claim-rewards and the client DEFERS to that
                    // value (handlePvpWin → applyServerBaseReward), so the repeat-
                    // opponent decay actually sticks and a tampered client can't
                    // inflate the payout. Enabled for ALL PvP wins — including
                    // practice spars — so spar round-robins are throttled by the
                    // same decay instead of paying full ryo/XP every rematch (the
                    // honest first win/hour is unchanged). rewardSector feeds ONLY
                    // the Death's Gate (99) 2× bonus and mirrors handlePvpWin.
                    baseRewards: true,
                    rewardSector: currentSector,
                    // Biome + weather. Ranked forces neutral; everything else
                    // ships the live values so terrainMultiplier/weatherMultiplier
                    // actually fire server-side (they were dead before this).
                    ...pvpSessionEnvironment(challenge.mode === "ranked", currentBiome, weatherEffects[currentWeather]?.positiveElement, weatherEffects[currentWeather]?.negativeElement),
                    p1Character: {
                        ...p1Character,
                        jutsu: p1Jutsus,
                        pvpItems: getPvpItemLoadout(p1Character, p1AllItems),
                        bloodlineMult: challenge.challengerBloodlineMult ?? getBloodlineMultiplier(p1Character, p1SavedBloodlines),
                        armorFactor: getCharacterArmorFactor(p1Character, p1AllItems),
                        armorRawDR: getCharacterArmorRawDR(p1Character, p1AllItems),
                        itemDamagePct: getEquippedItemBonus(p1Character, p1AllItems, "damagePercent"),
                        // Named-armor passives — server clamps these in session.ts.
                        itemAbsorbPct:    getEquippedItemBonus(p1Character, p1AllItems, "absorbPercent"),
                        itemReflectPct:   getEquippedItemBonus(p1Character, p1AllItems, "reflectPercent"),
                        itemLifeStealPct: getEquippedItemBonus(p1Character, p1AllItems, "lifeStealPercent"),
                        itemShield:       getEquippedItemBonus(p1Character, p1AllItems, "shield"),
                    },
                    p2Character: {
                        ...p2Character,
                        jutsu: p2Jutsus,
                        pvpItems: getPvpItemLoadout(p2Character, p2AllItems),
                        bloodlineMult: getBloodlineMultiplier(p2Character, p2SavedBloodlines),
                        armorFactor: getCharacterArmorFactor(p2Character, p2AllItems),
                        armorRawDR: getCharacterArmorRawDR(p2Character, p2AllItems),
                        itemDamagePct: getEquippedItemBonus(p2Character, p2AllItems, "damagePercent"),
                        itemAbsorbPct:    getEquippedItemBonus(p2Character, p2AllItems, "absorbPercent"),
                        itemReflectPct:   getEquippedItemBonus(p2Character, p2AllItems, "reflectPercent"),
                        itemLifeStealPct: getEquippedItemBonus(p2Character, p2AllItems, "lifeStealPercent"),
                        itemShield:       getEquippedItemBonus(p2Character, p2AllItems, "shield"),
                    },
                }),
            });
            if (!res.ok) throw new Error('Session create failed');
            // Capture both battleId and the full session payload — POST returns
            // the freshly-created session so PvpBattleScreen can render the
            // grid on first paint instead of flashing the "Connecting…" card.
            // Same pattern wired into sectorAttackPlayer / startPvpRaid; this
            // brings ranked / clan-war / spar / standard accepts to the same
            // bar.
            const acceptData = await res.json() as { battleId: string; session?: PvpSessionState };
            const battleId = acceptData.battleId;
            if (acceptData.session) setPvpSeedSession(acceptData.session);
            // Push acceptance back so challenger's heartbeat routes them to pvpBattle as p1
            const notified = await postPlayerChallengeNotice(challenge.fromName, { ...challenge, battleId, accepted: true, fromName: character.name, toName: challenge.fromName });
            setPvpBattleId(battleId);
            setPvpRole("p2");
            setPvpBattleContext({ mode: challenge.mode, clanWarPoints: challenge.clanWarPoints, sectorAttack: challenge.sectorAttack, sector: currentSector, kageChallengeId: challenge.kageChallengeId, kageVillage: challenge.kageVillage });
            if (challenge.kageVillage) {
                // Kage engaged — halt the challenger's accept-obligation clock.
                fetch("/api/village/kage-challenge", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "accept", village: challenge.kageVillage, playerName: character.name, battleId }),
                }).catch(() => {});
            }
            setScreen("pvpBattle");
            if (!notified) alert(`${challenge.fromName} may not be pulled in automatically. Ask them to reopen the game or wait for heartbeat.`);
        } catch {
            setDuelChallenges(prev => prev.some(c => c.id === challenge.id) ? prev : [challenge, ...prev]);
            alert(`${challenge.fromName}'s challenge could not be accepted. Try again if it is still pending.`);
        } finally {
            setProcessingChallengeIds(prev => prev.filter(id => id !== challenge.id));
        }
    }

    useEffect(() => {
        // Helper: apply a full server/local snapshot to state
        function applySnapshot(snap: ReturnType<typeof buildPlayerSavePayload>, bootLock?: ClientBattleLock | null) {
            // Seed prevCharRef so the auto-save interval treats this load as clean
            // (no local changes yet). Without this, a second logged-in device would
            // immediately auto-save the just-loaded snapshot, overwriting progress
            // made by a more recently active device.
            const normalized = normalizeAdminCharacter(snap.character);
            prevCharRef.current = normalized;
            charDirtyRef.current = false;
            // Capture the server-issued save version on the refresh/boot load too
            // (applyServerSnapshot already does this on the login/409 paths). Without
            // it, latestSaveVersionRef stays 0 after a refresh, so the first autosave
            // echoes _baseSaveVersion:0, 409s against the stored version, and the
            // player visibly rubber-bands a few seconds of progress before it heals.
            const snapVersion = (snap as Record<string, unknown>)._saveVersion;
            if (typeof snapVersion === "number" && Number.isFinite(snapVersion)) {
                latestSaveVersionRef.current = snapVersion;
            }
            setCharacter(normalized);
            setCurrentAccountName(snap.character.name);
            setCurrentBiome(snap.currentBiome ?? "central");
            setActiveTraining(snap.activeTraining ?? null);
            setActiveJutsuTraining(snap.activeJutsuTraining ?? null);
            setAcceptedMissionIds(snap.acceptedMissionIds ?? []);
            setMissionProgress(snap.missionProgress ?? {});
            setTriggeredEvents(snap.triggeredEvents ?? []);
            setPendingAiProfileId(snap.pendingAiProfileId ?? "");
            lastSnapshotMissionSigRef.current = JSON.stringify([snap.acceptedMissionIds ?? [], snap.missionProgress ?? {}, snap.triggeredEvents ?? [], snap.currentBiome ?? "central"]);
            applySnapshotSectorWithGuard(snap.currentSector ?? 40);
            if (snap.savedBloodlines) setSavedBloodlines(snap.savedBloodlines.map((bloodline: SavedBloodline) => ({ ...bloodline, jutsus: bloodline.jutsus.map(normalizeJutsu) })));
            if (snap.creatorJutsus) setCreatorJutsus(snap.creatorJutsus.map(normalizeJutsu));
            if (snap.creatorAis) setCreatorAis(balanceExistingAiProfiles(snap.creatorAis, savedJutsuPool(snap)));
            if (snap.creatorEvents) setCreatorEvents(snap.creatorEvents);
            if (snap.creatorMissions) setCreatorMissions(snap.creatorMissions);
            if (snap.creatorRaids) setCreatorRaids(snap.creatorRaids);
            if (snap.creatorCards) setCreatorCards(snap.creatorCards);
            if (snap.creatorItems) setCreatorItems(snap.creatorItems);
            if (snap.petEncounterVn) setPetEncounterVn(snap.petEncounterVn);
            if (snap.ancientChestVn) setAncientChestVn(snap.ancientChestVn);
            if (snap.editablePets) setEditablePets(mergeMissingBuiltInPets(snap.editablePets));
            // Restore the screen the player left off on instead of always
            // dumping them back into the village. Mid-encounter screens are
            // remapped because their React-only ephemeral state (battle
            // frames, pending opponents, pending modals) can't actually
            // resume from disk.
            // Restore PvP session breadcrumb if any — lets the pvpBattle
            // screen re-query the server's authoritative session state.
            // Stale-check at 1hr in case the player walked away from a
            // crashed match. The PvpBattle component's mount fetches the
            // session and resyncs from server state.
            //
            // Forced re-entry rule: if the breadcrumb restores AND the
            // server confirms the session is still alive, the player is
            // FORCED back into the pvpBattle screen regardless of which
            // screen they were on. PvP fairness — you can't refresh-flee
            // a duel.
            let restoredPvpBattleId: string | null = null;
            let pvpSessionAliveOnServer = false;
            try {
                const raw = localStorage.getItem(PVP_SESSION_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw) as {
                        pvpBattleId?: string;
                        pvpRole?: "p1" | "p2";
                        pvpBattleContext?: SharedPvpBattleContext;
                        savedAt?: number;
                    };
                    const age = Date.now() - (parsed.savedAt ?? 0);
                    if (parsed.pvpBattleId && age < 60 * 60 * 1000) {
                        restoredPvpBattleId = parsed.pvpBattleId;
                        setPvpBattleId(parsed.pvpBattleId);
                        if (parsed.pvpRole) setPvpRole(parsed.pvpRole);
                        if (parsed.pvpBattleContext) setPvpBattleContext(parsed.pvpBattleContext);
                        // Best-effort server check (non-blocking) — if the
                        // session no longer exists or is "done", clear the
                        // breadcrumb so a stale crash doesn't trap them.
                        void fetch(`/api/pvp/session?id=${encodeURIComponent(parsed.pvpBattleId)}`)
                            .then((r) => r.ok ? r.json() : null)
                            .then((data: { status?: string } | null) => {
                                if (!data || data.status === "done") {
                                    try { localStorage.removeItem(PVP_SESSION_KEY); } catch { /* ignore */ }
                                    setPvpBattleId(null);
                                    setPvpRole(null);
                                    setPvpBattleContext(null);
                                }
                            })
                            .catch(() => { /* network blip; leave breadcrumb in place */ });
                        // For routing purposes we trust the breadcrumb at
                        // boot — server check is async and may resolve
                        // after we've rendered. If it's stale, the
                        // PvpBattleScreen itself will fall back.
                        pvpSessionAliveOnServer = true;
                    } else {
                        localStorage.removeItem(PVP_SESSION_KEY);
                    }
                }
            } catch { /* corrupt or missing — ignore */ }

            // Pet PvP refresh-resilience: a pet PvP battle is fully
            // client-deterministic (same seed → same outcome on both
            // clients) but lives only in React state. Without this
            // restore, refreshing mid-fight silently abandons the battle
            // and the player vanishes from the opponent's screen. We
            // persist the pending opponent + seed on accept and restore
            // it here so the simulation re-runs and the player still
            // gets their win recorded.
            let restoredPendingPetPvp: PetArenaOpponent | null = null;
            try {
                const raw = localStorage.getItem(PENDING_PET_PVP_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw) as { opponent?: PetArenaOpponent; savedAt?: number };
                    const age = Date.now() - (parsed.savedAt ?? 0);
                    if (parsed.opponent && age < PENDING_PET_PVP_TTL_MS) {
                        restoredPendingPetPvp = parsed.opponent;
                        setPendingPetBattleOpponent(parsed.opponent);
                    } else {
                        localStorage.removeItem(PENDING_PET_PVP_KEY);
                    }
                }
            } catch { /* corrupt or missing — ignore */ }

            (() => {
                let target: Screen = "village";
                // FORCE re-entry into a live PvP battle — overrides whatever
                // the persisted screen was. Players cannot refresh-flee.
                if (pvpSessionAliveOnServer && restoredPvpBattleId) {
                    setScreen("pvpBattle");
                    return;
                }
                // FORCE re-entry into pet PvP if we restored a fresh
                // pending battle. Same fairness rule as duel — refreshing
                // shouldn't let you skip the fight.
                if (restoredPendingPetPvp) {
                    setScreen("petArena");
                    return;
                }
                // Server battle lock: an unresolved PvE fight cannot be fled by a
                // refresh, even one that wiped localStorage.
                if (bootLock && bootLock.screen) {
                    let recentlyResolved = "";
                    try { recentlyResolved = localStorage.getItem(BATTLE_LOCK_RESOLVED_KEY) ?? ""; } catch { /* ignore */ }
                    if (recentlyResolved && recentlyResolved === bootLock.battleId) {
                        // The fight already ended on this client; the server
                        // resolve just didn't land (network). Retry the clear and
                        // do NOT re-punish — fall through to normal restore routing.
                        try { localStorage.removeItem(BATTLE_LOCK_RESOLVED_KEY); } catch { /* ignore */ }
                        void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId });
                    } else if (battleResumeStateExists(bootLock, normalized.name, normalized)) {
                        // Resume state intact → drop back into the same fight; the
                        // screen's persister rehydrates it at the same HP/turn.
                        if (bootLock.kind === "endless") {
                            // Rebuild the endless app-context (wave + scaled enemy)
                            // BEFORE the Arena mounts so it sets up the endless fight;
                            // the scaled clone goes back into the AI pool and the
                            // saved pendingAiProfileId resolves to it. ArenaBattle-
                            // Persister then restores the HP/turn snapshot.
                            const ctx = readEndlessContext(normalized.name);
                            if (ctx) {
                                setTemporaryStoryAi(ctx.ai);
                                setEndlessBattleActive(true);
                                setEndlessBattleWave(ctx.wave);
                                setPendingAiProfileId(ctx.aiId);
                            }
                        } else if (bootLock.kind === "arenaStory") {
                            // Same, for a pendingArenaStoryBattle fight (weekly boss /
                            // dungeon-AI / arena story boss / triggered event / hollow
                            // gate): restore the battle context + scaled enemy first.
                            const ctx = readArenaStoryContext(normalized.name);
                            if (ctx) {
                                setTemporaryStoryAi(ctx.ai);
                                setPendingArenaStoryBattle(ctx.battle as PendingArenaStoryBattle);
                                setPendingAiProfileId(ctx.aiId);
                            }
                        } else if (bootLock.kind === "hollowGateTiles") {
                            // Re-enter the hollow-gate tile seal (fresh game). Hydrate
                            // the run + biome (like the shrine restore) and re-arm the
                            // active flag so the App-level keeper re-establishes/clears
                            // the lock.
                            if (normalized.hollowGateRun) {
                                setHollowGateRun(normalized.hollowGateRun);
                                setCurrentBiome("shadow");
                                setCurrentWeather(weatherForBiome("shadow"));
                            }
                            setHollowGateTileGameActive(true);
                        }
                        setScreen(bootLock.screen as Screen);
                        return;
                    } else {
                        // Resume state is GONE (localStorage wiped) → counts as a
                        // loss, applied with each fight's own defeat semantics.
                        try { localStorage.removeItem(BATTLE_LOCK_ID_KEY); } catch { /* ignore */ }
                        if (bootLock.kind === "storyBoss") {
                            // A story-boss defeat just downs you (hp 0) — no
                            // hospitalization, and no story progress. hp is already
                            // live-saved during the fight, so this is a small
                            // correction; just clear the lock.
                            setCharacter({ ...normalized, hp: 0 });
                            void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId });
                            setScreen("storyHall");
                        } else if (bootLock.kind === "endless") {
                            // Endless death = forfeit the run (banked ryo/XP lost)
                            // + downed/hospitalized, mirroring endEndlessBattle. The
                            // server applies hp:0 + hospitalized atomically; the run
                            // is cleared client-side (already live-saved each wave).
                            try { localStorage.removeItem(endlessCtxKey(normalized.name)); } catch { /* ignore */ }
                            setEndlessBattleActive(false);
                            setEndlessBattleWave(0);
                            setTemporaryStoryAi(null);
                            setCharacter({ ...normalized, hp: 0, hospitalized: true, endlessTowerRun: null });
                            void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId, outcome: "loss" });
                            setScreen("hospital");
                        } else if (bootLock.kind === "arenaStory") {
                            // Arena story fights hospitalize on defeat (server applies
                            // it atomically). A HollowGate KO also claws back the haul +
                            // clears the run (matching the live death path) so a lost-
                            // snapshot refresh can't heal-and-resume the run for free.
                            try { localStorage.removeItem(arenaStoryCtxKey(normalized.name)); } catch { /* ignore */ }
                            setPendingArenaStoryBattle(null);
                            setTemporaryStoryAi(null);
                            const hgRun = normalized.hollowGateRun && !normalized.hollowGateRun.completed ? normalized.hollowGateRun : null;
                            if (hgRun) { setHollowGateRun(null); setHollowGateEvent(null); setHollowGateHiddenChamber(null); setHollowGateLog([]); }
                            const downed = hgRun ? { ...clawBackHollowGateLoot(normalized, hgRun, 1 - attunementLootRetention(normalized)), hollowGateRun: null } : normalized;
                            setCharacter({ ...downed, hp: 0, hospitalized: true });
                            // If this KO recovery is the first to settle the run's token, reconcile
                            // to the server credit (single-use → a no-op if the live device already did).
                            if (hgRun) settleHollowGateRunOnly(hgRun, "death", normalized, setCharacter);
                            void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId, outcome: "loss" });
                            setScreen("hospital");
                        } else if (bootLock.kind === "hollowGateTiles") {
                            // Hollow-gate seal but no active run (it ended) — the seal
                            // is moot; just clear the lock and route to a safe screen.
                            // No penalty: the run is already over.
                            void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId });
                            setScreen(normalized.hollowGateRun && !normalized.hollowGateRun.completed ? "hollowGateShrine" : "village");
                        } else {
                            // arena (and other hospitalizing fights): the server
                            // applies hp:0 + hospitalized atomically with the unlock,
                            // so it can't be dodged by a fast double-refresh.
                            setCharacter({ ...normalized, hp: 0, hospitalized: true });
                            void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId, outcome: "loss" });
                            setScreen("hospital");
                        }
                        return;
                    }
                }
                try {
                    // A bookmarked/shared URL hash (#/village) takes precedence
                    // over the last-visited screen — but only for deep-linkable
                    // hub screens; mid-encounter screens fall back to localStorage
                    // and the safe-screen routing below. DEEP_LINKABLE_SCREENS /
                    // RESTORABLE_SCREENS live in lib/screen-guards (shared with the
                    // navigation lock so the two never drift).
                    const hashRaw = (() => { try { return window.location.hash.replace(/^#\/?/, ""); } catch { return ""; } })();
                    const persisted = (DEEP_LINKABLE_SCREENS.has(hashRaw as Screen) ? (hashRaw as Screen) : null) ?? (localStorage.getItem(LAST_SCREEN_KEY) as Screen | null);
                    if (persisted) {
                        const inHollowGateRun = Boolean(normalized.hollowGateRun && !normalized.hollowGateRun.completed);
                        // RESTORABLE_SCREENS = save-only hubs + the arena lobby
                        // family. Anything else is transient/mid-encounter (state
                        // lives only in React) and routes to a safe parent — the
                        // Hollow Gate shrine during a run, otherwise the village —
                        // so the player never lands on a blank/half-loaded screen.
                        // Live battle re-entry is forced earlier and never reaches
                        // here.
                        target = RESTORABLE_SCREENS.has(persisted)
                            ? persisted
                            : inHollowGateRun ? "hollowGateShrine" : "village";
                    }
                } catch { /* localStorage unavailable — default to village */ }
                // If we're landing back on the shrine, hydrate the local run
                // state from the character's saved run. Otherwise the screen
                // renders blank because the gate guard requires hollowGateRun.
                if (target === "hollowGateShrine" && normalized.hollowGateRun && !normalized.hollowGateRun.completed) {
                    setHollowGateRun(normalized.hollowGateRun);
                    setCurrentBiome("shadow");
                    setCurrentWeather(weatherForBiome("shadow"));
                } else if (target === "hollowGateShrine") {
                    // No active run — bounce back to village rather than
                    // staring at an empty shrine screen.
                    target = "village";
                }
                setScreen(target);
            })();
            // Re-hydrate images after KV restore — clears the loaded-cats guard so
            // loadCategory fires again and overwrites the empty image strings that
            // pushSaveToServer strips before sending to KV.
            // Also clear sessionStorage image cache so we always get fresh KV data
            // after login rather than serving stale cached images.
            loadedCatsRef.current.clear();
            clearImgCache();
            setTimeout(() => {
                void loadCategory('item'); void loadCategory('pet');
                void loadCategory('card'); void loadCategory('jutsu');
                void loadCategory('event'); void loadCategory('avatar');
                void loadCategory('ai'); void loadCategory('bloodline');
            }, 0);
        }

        let localAccountName = "";

        try {
            const raw = localStorage.getItem(STORAGE);
            if (raw) {
                const data = JSON.parse(raw);
                localAccountName = data.currentAccountName ?? "";
            }
        } catch {
            console.warn("Could not load local save data.");
        }

        // Always try to pull full save from server (images live here, not in localStorage).
        // Re-prime the authFetch interceptor from localStorage so the auto-load fetch
        // has credentials even on a fresh tab / mobile tab restore / browser restart
        // (sessionStorage is tab-scoped and can be cleared, but the localStorage fallback
        // in authFetch now makes credentials available; setActivePlayer here syncs them
        // back into sessionStorage for the rest of this session).
        if (localAccountName) {
            // getActivePlayer/Password already read from localStorage via the fallback,
            // but we call setActivePlayer here to populate sessionStorage for the session.
            const persistedPw = localStorage.getItem('shinobix:activePasswordPersist');
            // Token-first (M5): when a session token is persisted (localStorage),
            // auth rides on it and no password is stored — this call just re-syncs
            // the name into sessionStorage. When no token exists (legacy / no-token
            // server) the persisted password is restored as the credential.
            setActivePlayer(localAccountName, persistedPw ?? undefined);

            // ── Phase 1.3: optimistic instant-paint for HUB refreshes ──────────
            // If the URL hash says the player was on a deep-linkable HUB screen
            // (village / shop / profile / …) and we have a valid local save
            // preview, paint that screen immediately from cache while the
            // authoritative server pull + battle-lock fetch run below. A blocking
            // overlay (see optimisticRestore in the render) prevents interaction
            // until applySnapshot reconciles, so this is visually instant but
            // behaviourally identical to the old "Restoring…" gate.
            //
            // SAFETY: gated on the hash being a HUB screen. Battle/encounter
            // screens (arena, petArena, dungeon, …) are NOT deep-linkable, so
            // their hash never matches here — those refreshes fall through
            // UNCHANGED to the gate + applySnapshot(snap, lock) battle
            // re-entry/loss path. A hub refresh also can't coincide with a server
            // battle lock (you can't be mid-fight on a hub), and the reconcile
            // (applySnapshot) stays fully authoritative and overrides this paint,
            // so a rare stale lock still routes correctly once it lands. The hub
            // set is a subset of applySnapshot's DEEP_LINKABLE so the reconcile
            // always agrees on the same target via the hash branch; if they ever
            // diverge the worst case is a cosmetic re-route under the overlay,
            // never a broken screen or a battle escape.
            let didOptimisticPaint = false;
            try {
                const hubHash = (() => { try { return window.location.hash.replace(/^#\/?/, ""); } catch { return ""; } })();
                const OPTIMISTIC_HUB_SCREENS = new Set<string>(["village", "villageLore", "profile", "inventory", "logbook", "training", "jutsuTraining", "missions", "bloodlineMaker", "clan", "worldMap", "townHall", "bank", "shop", "grandMarketplace", "hospital", "cafeteria", "storyHall", "centralHub", "pets", "hunting", "tavern", "hallOfLegends", "shinobiCouncil", "messages"]);
                if (OPTIMISTIC_HUB_SCREENS.has(hubHash)) {
                    const preview = readSavePreview(localAccountName);
                    if (preview && preview.character) {
                        applyServerSnapshot(preview as ReturnType<typeof buildPlayerSavePayload>);
                        // applyServerSnapshot routes a "start" screen to village;
                        // override to the exact hub the player was on so the
                        // hash/lastScreen writers stay no-ops and the reconcile
                        // lands on the same screen (no jump).
                        setScreen(hubHash as Screen);
                        setOptimisticRestore(true);
                        didOptimisticPaint = true;
                    }
                }
            } catch { /* stale/incompatible cache — fall through to the gate below */ }

            // Revert a (possibly optimistic) paint back to the login form on a
            // failed restore, so the failure path looks EXACTLY like pre-1.3
            // (login form, no half-applied character left in state). For the
            // non-optimistic case this is just setRestoreFailed(true), unchanged.
            const revertRestoreToLogin = () => {
                setRestoreFailed(true);
                if (didOptimisticPaint) {
                    setScreen("start");
                    setCharacter(null);
                    setCurrentAccountName("");
                    setOptimisticRestore(false);
                }
            };

            // Safety backstop: pullSaveFromServer has no request timeout, so a
            // connection that hangs with no response would pin the "restoring"
            // gate forever. After 12s, drop to the login fallback.
            const restoreTimer = window.setTimeout(() => {
                revertRestoreToLogin();
                setRestoringSession(false);
            }, 12000);
            // Pull the save AND the server battle-lock together so the restore
            // routing can force re-entry into an unresolved PvE fight (a refresh
            // must not let a player flee a battle). The lock fetch never rejects.
            Promise.all([
                pullSaveFromServer(localAccountName),
                fetchBattleLockStatus(localAccountName),
            ]).then(([snap, lock]) => {
                if (snap) applySnapshot(snap, lock);
                // Stored account but the pull failed (expired token / 4xx /
                // network after retries) — surface the pre-filled login instead
                // of silently sitting on the start screen (or on a stale
                // optimistic paint).
                else revertRestoreToLogin();
            }).finally(() => {
                window.clearTimeout(restoreTimer);
                setRestoringSession(false);
                void pullSharedAdminContent();
            });
        } else {
            // No stored account → brand-new / anonymous visitor: show the login
            // form immediately, nothing to restore.
            setRestoringSession(false);
        }
        // No stored account = anonymous visitor on the landing screen. The shared
        // admin content (custom jutsu/items/events) pulls Admin 1 / Admin 2 saves,
        // which 401 without auth — so skip it here. It loads as soon as they log in
        // or create a character (both call pullSharedAdminContent), dropping two
        // wasted 401s on every cold landing.
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(
                STORAGE,
                JSON.stringify({
                    currentAccountName,
                })
            );
        } catch (error) {
            console.warn("localStorage save failed:", error);
        }
    }, [
        currentAccountName,
    ]);

    function buildPlayerSavePayload(characterToSave: Character, overrides: Partial<{
        savedBloodlines: SavedBloodline[];
    }> = {}) {
        return {
            // Compact stackables into itemStacks before the server cap (save-side migration).
            character: normalizeInventory(characterToSave),
            currentBiome,
            activeTraining,
            activeJutsuTraining,
            acceptedMissionIds,
            missionProgress,
            triggeredEvents,
            pendingAiProfileId,
            currentSector,
            savedBloodlines,
            creatorJutsus,
            creatorAis,
            creatorEvents,
            creatorMissions,
            creatorRaids,
            creatorCards,
            creatorItems,
            petEncounterVn,
            ancientChestVn,
            editablePets,
            ...overrides,
        };
    }

    async function pushSaveToServer(
        characterToSave: Character,
        name: string,
        overrides?: Parameters<typeof buildPlayerSavePayload>[1],
        opts?: { echoVersion?: boolean },
    ) {
        // Strip base64 images before sending — keeps the payload small so it fits
        // within Vercel's request body limit. Images persist separately via
        // publishSharedImage ? shared:images:{cat} and are hydrated on load.
        function stripImages(_k: string, v: unknown) {
            return typeof v === 'string' && v.startsWith('data:image') ? '' : v;
        }
        // Echo the optimistic-concurrency version on the player's OWN save so the
        // multi-tab guard covers these immediate saves too (the autosave timers
        // already do). Without it, new-character / pet / bloodline saves bypass
        // the version check — and once the guard is required for player saves
        // they'd be rejected. Admin saves to ANOTHER player's slot pass
        // echoVersion:false: our version ref tracks THIS player, not the target,
        // so echoing it would false-conflict against the target's stored version.
        const echoVersion = opts?.echoVersion ?? true;
        const payload = buildPlayerSavePayload(characterToSave, overrides);
        const body = echoVersion
            ? { ...payload, _baseSaveVersion: latestSaveVersionRef.current }
            : payload;
        const res = await fetch(`/api/save/${encodeURIComponent(name.toLowerCase())}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body, stripImages),
        });
        if (res.status === 409 && echoVersion) {
            // Another tab/device wrote first — reconcile instead of clobbering,
            // exactly as the autosave timers do on 409.
            void refetchAfterSaveConflict(name);
            return;
        }
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        // Keep the version ref current so the next autosave doesn't echo a stale
        // base version and spuriously conflict.
        if (echoVersion) {
            try {
                const data = await res.json() as { _saveVersion?: number };
                if (typeof data._saveVersion === "number") latestSaveVersionRef.current = data._saveVersion;
            } catch { /* server may return 200 with an empty body; ignore */ }
            // #25: this immediate save just committed `characterToSave` at the
            // version we advanced above. If no NEWER local change has landed since
            // (live ref still points at the saved object), clear the dirty flag and
            // cancel the pending debounced autosave so it doesn't re-POST the same
            // state and self-409 against our just-advanced version. If a newer
            // change DID land mid-flight, leave dirty set so it still saves.
            if (characterRef.current === characterToSave) {
                charDirtyRef.current = false;
                if (saveSoonTimerRef.current) { clearTimeout(saveSoonTimerRef.current); saveSoonTimerRef.current = null; }
            }
        }
    }

    // Re-authenticate after a session-expiry WITHOUT reloading game state, then
    // persist the live in-memory save. This is what prevents the "refresh and
    // lose levels" data loss: the player's unsaved progress is still in memory,
    // so once a fresh token is minted the immediate save below commits it. We
    // deliberately do NOT call applyServerSnapshot here (that would overwrite the
    // live state with the stale server save the expiry left behind).
    async function reauthKeepState() {
        const name = currentAccountName;
        const char = characterRef.current;
        if (!name || !char) { setSessionExpired(false); return; }
        setReauthError("");
        setReauthBusy(true);
        try {
            const res = await fetch('/api/player-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'verify', name: name.toLowerCase(), password: reauthPw }),
            });
            const data = await res.json().catch(() => null) as { ok?: boolean; token?: string } | null;
            if (res.ok && data?.ok) {
                if (data.token) {
                    // Fresh token → future requests authenticate again, and
                    // setActiveToken re-arms the expiry latch in authFetch.
                    setActiveToken(data.token);
                } else {
                    // SESSION_SECRET unset server-side — no token issued. Re-seed
                    // the password fallback so requests keep authenticating.
                    setActivePlayer(name, reauthPw);
                }
                // Persist the live state NOW so progress made since the token died
                // is saved, rather than waiting on the 15s autosave tick. On a 409
                // (another device wrote first) pushSaveToServer reconciles instead.
                try {
                    await pushSaveToServer(char, name);
                } catch {
                    charDirtyRef.current = true; // immediate save failed — let the autosave retry
                }
                setSessionExpired(false);
                setReauthPw("");
                return;
            }
            setReauthError("Incorrect password. Try again.");
        } catch {
            setReauthError("Couldn't reach the server. Check your connection and try again.");
        } finally {
            setReauthBusy(false);
        }
    }

    // Escape hatch from the re-auth prompt: if the player can't recall the
    // password, fall back to the old wipe-and-return-to-login behavior. Any
    // unsaved progress is forfeited (the server save is the source of truth),
    // but they're never trapped behind the modal.
    function logoutFromExpiry() {
        setSessionExpired(false);
        setReauthPw("");
        setReauthError("");
        setActivePlayer(null);
        setCharacter(null);
        setCurrentAccountName("");
        setScreen("start");
    }

    async function pullSaveFromServer(name: string): Promise<ReturnType<typeof buildPlayerSavePayload> | null> {
        // Retry once on a TRANSIENT failure (network blip or a Supabase cold-start
        // 5xx) — mirrors the login path's cold-start handling so a refresh/restore
        // doesn't silently strand the player on stale localStorage state with no
        // recovery until they manually refresh again. A 4xx (401/404) is
        // authoritative (logged out / no save) and is never retried.
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const res = await fetch(`/api/save/${encodeURIComponent(name.toLowerCase())}`);
                if (res.ok) return await res.json();
                if (res.status < 500) return null; // not transient — don't retry
            } catch {
                // network error — fall through and retry once
            }
            if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
        }
        return null;
    }

    function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
        const merged = new Map(current.map((item) => [item.id, item]));
        incoming.forEach((item) => merged.set(item.id, item));
        return Array.from(merged.values());
    }

    // Recency-aware variant of mergeById for the shared-admin-content pull. When
    // the SAME jutsu id lives in more than one admin save (both admins pull each
    // other's catalog, so a created jutsu ends up persisted in both), a plain
    // last-writer-wins merge lets whichever snapshot is applied last clobber a
    // freshly-edited local copy — so removing a tag and saving "comes back" after
    // reload. Keep the local copy only when it is STRICTLY newer; otherwise take
    // the incoming one so genuine balance pushes / new content still propagate.
    function mergeJutsusByRecency(current: Jutsu[], incoming: Jutsu[]) {
        const merged = new Map(current.map((jutsu) => [jutsu.id, jutsu]));
        incoming.forEach((jutsu) => {
            const existing = merged.get(jutsu.id);
            if (existing && (existing.updatedAt ?? 0) > (jutsu.updatedAt ?? 0)) return;
            merged.set(jutsu.id, jutsu);
        });
        return Array.from(merged.values());
    }

    // Returns true if the published-pet-template registry changed (caller re-normalizes).
    function applySharedAdminContentSnapshot(snap: ReturnType<typeof buildPlayerSavePayload>): boolean {
        const sharedCreatorJutsus = ((snap.creatorJutsus as Jutsu[] | undefined) ?? []).map(normalizeJutsu);
        // Bloodlines are intentionally NOT synced from admin saves — each player sees only their own bloodlines.
        if (snap.creatorJutsus) setCreatorJutsus((prev) => mergeJutsusByRecency(prev, sharedCreatorJutsus));
        if (snap.creatorAis) setCreatorAis((prev) => mergeById(prev, balanceExistingAiProfiles(snap.creatorAis as CreatorAi[], [...starterJutsus, ...sharedCreatorJutsus])));
        if (snap.creatorEvents) setCreatorEvents((prev) => mergeById(prev, snap.creatorEvents as CreatorEvent[]));
        if (snap.creatorMissions) setCreatorMissions((prev) => mergeById(prev, snap.creatorMissions as CreatorMission[]));
        if (snap.creatorRaids) setCreatorRaids((prev) => mergeById(prev, snap.creatorRaids as CreatorRaid[]));
        if (snap.creatorCards) setCreatorCards((prev) => mergeById(prev, snap.creatorCards as TileCard[]));
        if (snap.creatorItems) setCreatorItems((prev) => mergeById(prev, snap.creatorItems as GameItem[]));
        if (snap.petEncounterVn) setPetEncounterVn(snap.petEncounterVn as CreatorEvent);
        if (snap.ancientChestVn) setAncientChestVn(snap.ancientChestVn as CreatorEvent);
        // Publish admin-edited pet kits globally (normalizePet adopts authored templates).
        return snap.editablePets ? registerPublishedPetTemplates(snap.editablePets as Pet[]) : false;
    }

    async function pullSharedAdminContent() {
        const snapshots = await Promise.all([
            pullSaveFromServer("Admin 1"),
            pullSaveFromServer("Admin 2"),
        ]);
        const available = snapshots.filter((snap): snap is ReturnType<typeof buildPlayerSavePayload> => Boolean(snap));
        if (!available.length) return;
        const petTemplatesChanged = available.map(applySharedAdminContentSnapshot).some(Boolean);
        // Re-normalize the live roster so loaded pets adopt freshly-pulled admin kits.
        if (petTemplatesChanged) setCharacter((prev) => prev ? { ...prev, pets: prev.pets.map(normalizePet) } : prev);
        loadedCatsRef.current.delete('jutsu');
        loadedCatsRef.current.delete('bloodline');
        loadedCatsRef.current.delete('event');
        loadedCatsRef.current.delete('ai');
        loadedCatsRef.current.delete('item');
        loadedCatsRef.current.delete('card');
        clearImgCache();
        setTimeout(() => {
            void loadCategory('jutsu');
            void loadCategory('bloodline');
            void loadCategory('event');
            void loadCategory('ai');
            void loadCategory('item');
            void loadCategory('card');
        }, 0);
    }

    function saveAccountProgress(characterToSave: Character, accountName = currentAccountName) {
        const key = accountKey(accountName || characterToSave.name);
        if (!key) return;
        const accounts = loadPlayerAccounts();
        accounts[key] = accounts[key] ?? {};
        savePlayerAccounts(accounts);
    }

    useEffect(() => {
        if (!character || !currentAccountName) return;
        saveAccountProgress(character, currentAccountName);
    }, [
        character,
        currentAccountName,
        currentBiome,
        activeTraining,
        activeJutsuTraining,
        acceptedMissionIds,
        missionProgress,
        triggeredEvents,
        pendingAiProfileId,
        currentSector,
    ]);

    useEffect(() => {
        if (!character) return;
        setPlayerRoster((current) => {
            const record: PlayerRecord = {
                name: character.name,
                level: character.level,
                village: character.village,
                specialty: character.specialty,
                character,
                currentSector,
                lastSeenAt: Date.now(),
            };
            return [record, ...current.filter((player) => player.name !== character.name)].slice(0, 30);
        });
    }, [character, currentSector]);

    useEffect(() => {
        const inField = screen === "worldMap" || screen === "arena" || screen === "arenaDistrict" || screen === "battleArena";
        if (!inField) setCurrentSector(0);
    }, [screen]);

    useEffect(() => {
        if (!character || activeTriggeredEvent) return;
        if (character.level < 9 || triggeredEvents.includes(AURA_SPHERE_VN_ID)) return;
        const alreadyHasAuraSphere = character.inventory.includes(AURA_SPHERE_ITEM_ID) || Object.values(character.equipment).includes(AURA_SPHERE_ITEM_ID);
        if (alreadyHasAuraSphere) {
            setTriggeredEvents((ids) => ids.includes(AURA_SPHERE_VN_ID) ? ids : [...ids, AURA_SPHERE_VN_ID]);
            return;
        }
        setTriggeredEvents((ids) => ids.includes(AURA_SPHERE_VN_ID) ? ids : [...ids, AURA_SPHERE_VN_ID]);
        setActiveTriggeredEvent(creatorEvents.find(e => e.id === AURA_SPHERE_VN_ID) ?? auraSphereLv9VnEvent);
        setActiveTriggerReturnScreen(screen);
        setTriggerPage(0);
        setTriggerLine(0);
    }, [activeTriggeredEvent, character, screen, triggeredEvents]);

    // Auto-trigger level-gated creator VN events (eventKind === "visualNovel", no special trigger)
    useEffect(() => {
        if (!character || activeTriggeredEvent) return;
        const candidate = creatorEvents.find(
            (ev) =>
                ev.eventKind === "visualNovel" &&
                !ev.trigger &&
                !triggeredEvents.includes(ev.id) &&
                character.level >= ev.levelReq
        );
        if (!candidate) return;
        setTriggeredEvents((ids) => [...ids, candidate.id]);
        setActiveTriggeredEvent(candidate);
        setActiveTriggerReturnScreen(screen);
        setTriggerPage(0);
        setTriggerLine(0);
    }, [activeTriggeredEvent, character, creatorEvents, screen, triggeredEvents]);

    // Auto-trigger the multi-page story chapter VN when a player first reaches the required level.
    // Uses TriggeredVisualNovel (full vnPages reader) instead of the flat StoryHall dialogue.
    // Rewards are 0 here — XP/ryo come from beating the boss after the VN.
    useEffect(() => {
        if (!character || activeTriggeredEvent) return;
        // Don't interrupt battle screens — let the VN fire after the player returns
        if (screen === "arena" || screen === "storyBoss" || screen === "pvpBattle") return;
        // Gate the village story behind tutorial completion (skip sets "done").
        if (normalizeOnboardingStep(character.onboardingStep) !== "done") return;
        const step = getCurrentStory(character);
        if (!step || character.level < step.levelReq) return;
        const village = character.storyVillage || character.village;
        const storyLine = storylines[village] || [];
        const index = storyLine.findIndex(s => s.levelReq === step.levelReq);
        if (index < 0) return;
        const eventId = `story-${village.toLowerCase().replace(/\W+/g, "-")}-${step.levelReq}-${index}`;
        if (triggeredEvents.includes(eventId)) return;
        // Prefer the admin-edited version from creatorEvents (contains uploaded images,
        // custom dialogue, etc.) over the hardcoded storyToCreatorEvent fallback.
        // Then overlay any KV-stored images that landed in sharedImages.
        const edited = creatorEvents.find(e => e.id === eventId);
        const base = edited ?? storyToCreatorEvent(step, village, index);
        const vnEvent: CreatorEvent = {
            ...base,
            xpReward: 0,
            ryoReward: 0,
            ...(sharedImages['event:' + eventId + ':bg']     ? { image:       sharedImages['event:' + eventId + ':bg'] }     : {}),
            ...(sharedImages['event:' + eventId + ':avatar'] ? { avatarImage: sharedImages['event:' + eventId + ':avatar'] } : {}),
            ...(base.vnPages ? {
                vnPages: base.vnPages.map((p, i) => ({
                    ...p,
                    ...(sharedImages[`vn:${eventId}:page:${i}`]       ? { image:      sharedImages[`vn:${eventId}:page:${i}`] }       : {}),
                    ...(sharedImages[`vn:${eventId}:page:${i}:left`]  ? { leftImage:  sharedImages[`vn:${eventId}:page:${i}:left`] }  : {}),
                    ...(sharedImages[`vn:${eventId}:page:${i}:right`] ? { rightImage: sharedImages[`vn:${eventId}:page:${i}:right`] } : {}),
                }))
            } : {}),
        };
        setTriggeredEvents(ids => [...ids, eventId]);
        setActiveTriggeredEvent(vnEvent);
        setActiveTriggerReturnScreen("storyHall");
        setTriggerPage(0);
        setTriggerLine(0);
    }, [activeTriggeredEvent, character, creatorEvents, screen, sharedImages, triggeredEvents]);

    // When sharedImages updates while any VN is open (images loaded after trigger fired),
    // patch the live activeTriggeredEvent so images appear without re-triggering the whole flow.
    useEffect(() => {
        setActiveTriggeredEvent(prev => {
            if (!prev) return prev;
            const id = prev.id;
            const hasNewImages =
                (sharedImages['event:' + id + ':bg']     && prev.image       !== sharedImages['event:' + id + ':bg'])     ||
                (sharedImages['event:' + id + ':avatar'] && prev.avatarImage !== sharedImages['event:' + id + ':avatar']) ||
                prev.vnPages?.some((p, i) =>
                    (sharedImages[`vn:${id}:page:${i}`]       && p.image      !== sharedImages[`vn:${id}:page:${i}`])       ||
                    (sharedImages[`vn:${id}:page:${i}:left`]  && p.leftImage  !== sharedImages[`vn:${id}:page:${i}:left`])  ||
                    (sharedImages[`vn:${id}:page:${i}:right`] && p.rightImage !== sharedImages[`vn:${id}:page:${i}:right`])
                );
            if (!hasNewImages) return prev;
            return {
                ...prev,
                ...(sharedImages['event:' + id + ':bg']     ? { image:       sharedImages['event:' + id + ':bg'] }     : {}),
                ...(sharedImages['event:' + id + ':avatar'] ? { avatarImage: sharedImages['event:' + id + ':avatar'] } : {}),
                vnPages: prev.vnPages?.map((p, i) => ({
                    ...p,
                    ...(sharedImages[`vn:${id}:page:${i}`]       ? { image:      sharedImages[`vn:${id}:page:${i}`] }       : {}),
                    ...(sharedImages[`vn:${id}:page:${i}:left`]  ? { leftImage:  sharedImages[`vn:${id}:page:${i}:left`] }  : {}),
                    ...(sharedImages[`vn:${id}:page:${i}:right`] ? { rightImage: sharedImages[`vn:${id}:page:${i}:right`] } : {}),
                })),
            };
        });
    }, [sharedImages]);

    useEffect(() => {
        const interval = setInterval(() => {
            setCharacter((prev) => {
                if (!prev) return prev;
                if (screen === "arena" || screen === "storyBoss" || screen === "pvpBattle") return prev;
                // No passive recovery inside the Hollow Gate — the shrine forbids healing.
                if (screen === "hollowGateShrine") return prev;
                if (prev.hp >= prev.maxHp && prev.chakra >= prev.maxChakra && prev.stamina >= prev.maxStamina) return prev; // idle at full vitals (common): same-ref no-op skips the per-second full-App reconcile; values are Math.min-clamped so identical — no gameplay change
                const auraBonuses = getActiveAuraSphereBonuses(prev);
                return {
                    ...prev,
                    hp: Math.min(prev.maxHp, prev.hp + 1 + auraBonuses.regen),
                    chakra: Math.min(prev.maxChakra, prev.chakra + 1 + auraBonuses.regen),
                    stamina: Math.min(prev.maxStamina, prev.stamina + 1 + auraBonuses.regen),
                };
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [screen]);

    // Image category loader — fetches from shared KV store and hydrates
    // embedded image fields so all existing display code works without changes.
    // A ref prevents duplicate fetches even when called from multiple effects.
    const loadedCatsRef = useRef<Set<string>>(new Set());

    // Applies fetched images into the relevant React state arrays.
    // Extracted so applySnapshot can call it after the KV restore to avoid
    // the race condition where applySnapshot (empty images) lands after loadCategory.
    function hydrateImages(cat: string, images: Record<string, string>) {
        setSharedImages(prev => ({ ...prev, ...images }));
        if (cat === 'item')
            setCreatorItems(prev => {
                // Patch images on; keep a fresh inline data: image rather than clobber it with the 5-min-stale /api/img ref (same guard as the pet branch).
                const patched = prev.map(item => images['item:' + item.id] && !String(item.image ?? '').startsWith('data:') ? { ...item, image: images['item:' + item.id] } : item);
                // For starter items whose image is in KV but whose creatorItems entry
                // doesn't exist yet on this player (e.g. admin uploaded after their last
                // save), auto-create a minimal entry so getAllItems can apply the override.
                const existingIds = new Set(prev.map(i => i.id));
                const seeded: GameItem[] = [];
                for (const [key, img] of Object.entries(images)) {
                    if (!key.startsWith('item:')) continue;
                    const id = key.slice(5);
                    if (existingIds.has(id)) continue;
                    const base = starterItems.find(s => s.id === id);
                    if (base) seeded.push({ ...base, image: img });
                }
                return seeded.length ? [...patched, ...seeded] : patched;
            });
        else if (cat === 'pet') {
            setEditablePets(prev => prev.map(pet => {
                const fetched = images['pet:' + pet.id];
                if (!fetched) return pet;
                // Don't clobber a freshly-set INLINE image with a cached /api/img
                // reference URL. The per-image endpoint serves a 5-min stale copy
                // (Cache-Control max-age=300), so when this hydrate ran after an
                // admin avatar change it replaced the just-made base64 with the
                // old cached URL — making the change appear to "revert". A data:
                // URL is already displayable, so keep the local edit. Reference-
                // URL images (the normal hydrated state) still refresh normally.
                if (typeof pet.image === 'string' && pet.image.startsWith('data:')) return pet;
                return { ...pet, image: fetched };
            }));
            // Also patch images onto the pets stored on each player's character.
            // cloneEncounterPet appends -Date.now() to the pool ID (e.g. "standard-1"
            // becomes "standard-1-1747482312345"), so we strip the timestamp suffix
            // (always >= 10 digits) when looking up the KV image key.
            setCharacter(prev => {
                if (!prev || !prev.pets?.length) return prev;
                const patchedPets = prev.pets.map(p => {
                    const baseId = p.id.replace(/-\d{10,}$/, '');
                    const img = images['pet:' + p.id] || images['pet:' + baseId];
                    return img ? { ...p, image: img } : p;
                });
                return { ...prev, pets: patchedPets };
            });
        }
        else if (cat === 'card')
            setCreatorCards(prev => prev.map(card =>
                images['card:' + card.id] ? { ...card, image: images['card:' + card.id] } : card));
        else if (cat === 'jutsu') {
            setCreatorJutsus(prev => {
                // Patch images onto existing creatorJutsus entries.
                const patched = prev.map(j =>
                    Object.prototype.hasOwnProperty.call(images, 'jutsu:' + j.id) && !String(j.image ?? '').startsWith('data:') ? { ...j, image: images['jutsu:' + j.id] } : j);
                // Seed starter jutsu and starter bloodline jutsu images into creatorJutsus
                // so getAllJutsus (which processes creatorJutsus last in its Map) overrides
                // the no-image global-const version. Without this, non-admin players never
                // see images on starter jutsus because the global starterJutsus array is
                // not React state and cannot be patched by hydrateImages.
                const existingIds = new Set(prev.map(j => j.id));
                const seeded: Jutsu[] = [];
                for (const [key, img] of Object.entries(images)) {
                    if (!key.startsWith('jutsu:')) continue;
                    const id = key.slice(6);
                    if (existingIds.has(id)) continue;
                    // Check starter jutsus
                    const starterMatch = starterJutsus.find(j => j.id === id);
                    if (starterMatch) { seeded.push({ ...starterMatch, image: img }); continue; }
                    // Check starter bloodline jutsus
                    for (const bl of starterSavedBloodlines) {
                        const blMatch = bl.jutsus.find(j => j.id === id);
                        if (blMatch) { seeded.push({ ...blMatch, image: img }); break; }
                    }
                }
                return seeded.length ? [...patched, ...seeded] : patched;
            });
            // Also hydrate jutsu images stored inside bloodlines — the save strips base64
            // so these need the same KV lookup as creatorJutsus.
            setSavedBloodlines((prev: SavedBloodline[]) => prev.map(b => ({
                ...b,
                jutsus: b.jutsus.map(j =>
                    Object.prototype.hasOwnProperty.call(images, 'jutsu:' + j.id) && !String(j.image ?? '').startsWith('data:') ? { ...j, image: images['jutsu:' + j.id] } : j),
            })));
        }
        else if (cat === 'event') {
            // Helper: apply KV images onto a single event's vnPages
            function patchEventImages(e: CreatorEvent): CreatorEvent {
                return {
                    ...e,
                    ...(images['event:' + e.id + ':bg']     ? { image: images['event:' + e.id + ':bg'] }         : {}),
                    ...(images['event:' + e.id + ':avatar'] ? { avatarImage: images['event:' + e.id + ':avatar'] } : {}),
                    ...(e.vnPages ? {
                        vnPages: e.vnPages.map((p, i) => ({
                            ...p,
                            ...(images[`vn:${e.id}:page:${i}`]       ? { image:      images[`vn:${e.id}:page:${i}`] }       : {}),
                            ...(images[`vn:${e.id}:page:${i}:left`]  ? { leftImage:  images[`vn:${e.id}:page:${i}:left`] }  : {}),
                            ...(images[`vn:${e.id}:page:${i}:right`] ? { rightImage: images[`vn:${e.id}:page:${i}:right`] } : {}),
                            choices: p.choices?.map((choice, choiceIndex) => ({
                                ...choice,
                                ...(images[`vn:${e.id}:page:${i}:choice:${choiceIndex}:bg`] ? { battle: { ...(choice.battle ?? {}), backgroundImage: images[`vn:${e.id}:page:${i}:choice:${choiceIndex}:bg`] } } : {}),
                            })),
                        }))
                    } : {}),
                };
            }
            setCreatorEvents(prev => {
                const patched = prev.map(patchEventImages);
                // Seed builtin VN events that have KV images but are not yet in
                // creatorEvents. Without seeding, non-admin players fall through to
                // the hardcoded no-image fallback when these events trigger.
                const builtinVns = [awakeningLv2VnEvent, auraSphereLv9VnEvent, hiddenDungeonVnEvent];
                const existingIds = new Set(prev.map(e => e.id));
                const seeded: CreatorEvent[] = [];
                for (const builtin of builtinVns) {
                    if (existingIds.has(builtin.id)) continue;
                    // Check if KV has any image for this builtin VN
                    const hasImage = builtin.vnPages?.some((_, i) =>
                        images[`vn:${builtin.id}:page:${i}`] ||
                        images[`vn:${builtin.id}:page:${i}:left`] ||
                        images[`vn:${builtin.id}:page:${i}:right`]
                    );
                    if (hasImage) seeded.push(patchEventImages(builtin));
                }
                return seeded.length ? [...patched, ...seeded] : patched;
            });
            setPetEncounterVn(prev => prev.vnPages ? {
                ...prev,
                ...(images['event:pet-encounter:bg'] || images['event:sys-pet-encounter:bg'] ? { image: images['event:pet-encounter:bg'] || images['event:sys-pet-encounter:bg'] } : {}),
                ...(images['event:pet-encounter:avatar'] || images['event:sys-pet-encounter:avatar'] ? { avatarImage: images['event:pet-encounter:avatar'] || images['event:sys-pet-encounter:avatar'] } : {}),
                vnPages: prev.vnPages.map((p, i) => ({
                    ...p,
                    ...(images[`vn:pet-encounter:page:${i}`]        ? { image:      images[`vn:pet-encounter:page:${i}`] }        : {}),
                    ...(images[`vn:pet-encounter:page:${i}:left`]   ? { leftImage:  images[`vn:pet-encounter:page:${i}:left`] }   : {}),
                    ...(images[`vn:pet-encounter:page:${i}:right`]  ? { rightImage: images[`vn:pet-encounter:page:${i}:right`] }  : {}),
                    ...(images[`vn:sys-pet-encounter:page:${i}`]        ? { image:      images[`vn:sys-pet-encounter:page:${i}`] }        : {}),
                    ...(images[`vn:sys-pet-encounter:page:${i}:left`]   ? { leftImage:  images[`vn:sys-pet-encounter:page:${i}:left`] }   : {}),
                    ...(images[`vn:sys-pet-encounter:page:${i}:right`]  ? { rightImage: images[`vn:sys-pet-encounter:page:${i}:right`] }  : {}),
                })),
            } : prev);
            setAncientChestVn(prev => prev.vnPages ? {
                ...prev,
                ...(images['event:ancient-chest:bg'] || images['event:sys-ancient-chest:bg'] ? { image: images['event:ancient-chest:bg'] || images['event:sys-ancient-chest:bg'] } : {}),
                ...(images['event:ancient-chest:avatar'] || images['event:sys-ancient-chest:avatar'] ? { avatarImage: images['event:ancient-chest:avatar'] || images['event:sys-ancient-chest:avatar'] } : {}),
                vnPages: prev.vnPages.map((p, i) => ({
                    ...p,
                    ...(images[`vn:ancient-chest:page:${i}`]        ? { image:      images[`vn:ancient-chest:page:${i}`] }        : {}),
                    ...(images[`vn:ancient-chest:page:${i}:left`]   ? { leftImage:  images[`vn:ancient-chest:page:${i}:left`] }   : {}),
                    ...(images[`vn:ancient-chest:page:${i}:right`]  ? { rightImage: images[`vn:ancient-chest:page:${i}:right`] }  : {}),
                    ...(images[`vn:sys-ancient-chest:page:${i}`]        ? { image:      images[`vn:sys-ancient-chest:page:${i}`] }        : {}),
                    ...(images[`vn:sys-ancient-chest:page:${i}:left`]   ? { leftImage:  images[`vn:sys-ancient-chest:page:${i}:left`] }   : {}),
                    ...(images[`vn:sys-ancient-chest:page:${i}:right`]  ? { rightImage: images[`vn:sys-ancient-chest:page:${i}:right`] }  : {}),
                })),
            } : prev);
        }
        else if (cat === 'bloodline')
            // Restore the cover image (stripped on save); keep a fresh inline data:
            // image rather than clobber it with the 5-min-stale /api/img reference.
            setSavedBloodlines((prev: SavedBloodline[]) => prev.map(b =>
                images['bloodline:' + b.id] && !String(b.image ?? '').startsWith('data:') ? { ...b, image: images['bloodline:' + b.id] } : b
            ));
        else if (cat === 'avatar')
            setCharacter(prev => {
                if (!prev) return prev;
                const img = images['avatar:' + prev.name.toLowerCase()];
                return img ? { ...prev, avatarImage: img } : prev;
            });
        else if (cat === 'ai')
            setCreatorAis(prev => {
                // Patch images onto existing creatorAis entries.
                const patched = prev.map(ai =>
                    images['ai:' + ai.id] ? { ...ai, image: images['ai:' + ai.id] } : ai);
                // For builtin AIs whose image is in KV but for which there is no
                // creatorAis override entry yet, auto-create one so that playableAis
                // (which prefers creatorAis over builtinAis) picks up the image.
                const existingIds = new Set(prev.map(a => a.id));
                const seeded: CreatorAi[] = [];
                for (const [key, img] of Object.entries(images)) {
                    if (!key.startsWith('ai:')) continue;
                    const id = key.slice(3);
                    if (existingIds.has(id)) continue;
                    const base = builtinAis.find(b => b.id === id);
                    if (base) seeded.push({ ...base, image: img });
                }
                return seeded.length ? [...patched, ...seeded] : patched;
            });
    }

    // SessionStorage cache helpers — images don't change often so 10-min local
    // cache eliminates most repeat KV reads on page refresh / screen changes.
    const IMG_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
    function imgCacheKey(cat: string) { return `imgcat:${cat}`; }
    function clearImgCache() {
        try {
            ['item','pet','card','jutsu','event','avatar','ai','bloodline','misc'].forEach(c =>
                sessionStorage.removeItem(imgCacheKey(c)));
        } catch { /* private browsing — ignore */ }
    }

    // Phase 2 (image-as-files): categories served via per-image `/api/img` URLs
    // instead of one giant base64 bucket. For these, loadCategory fetches only the
    // lightweight id MANIFEST (`?ids=1`) and hydrates sharedImages with `/api/img`
    // URLs — the browser then fetches each image individually (CDN/browser-cached)
    // only when a screen shows it, and the multi-MB base64 blob is NEVER pulled.
    // Roll out one category at a time, verifying each in-browser. To REVERT a
    // category, remove it from this set (it falls back to the base64 path below).
    // ALL loadCategory buckets serve via per-image /api/img URLs (image-as-files
    // complete). Combat avatar/ai opponent portraits render via the widened
    // guards; everything else via plain <img>/background. avatar/pet/bloodline
    // also overwrite player-owned saved fields (character.avatarImage /
    // character.pets[].image / savedBloodlines[].image) with the URL — that's
    // fine: the URL is stable + tiny, renders directly, re-hydrates on load, and
    // publishSharedImage skips re-publishing it (see lib/shared-images.ts). We
    // deliberately do NOT strip "/api/img" from the localStorage preview, so the
    // own avatar instant-paints instead of flickering. ('leader' village
    // portraits ride the separate game-state?images=1 poll, not loadCategory.)
    // Revert any single category by removing it here.
    const URL_MODE_CATEGORIES = new Set<string>(['event', 'card', 'item', 'jutsu', 'ai', 'shrine', 'landmark', 'avatar', 'pet', 'bloodline']);

    async function loadCategory(cat: string) {
        if (loadedCatsRef.current.has(cat)) return;
        const urlMode = URL_MODE_CATEGORIES.has(cat);
        // Do NOT mark loaded yet — only mark after a successful fetch so that
        // transient failures (Supabase cold start, timeout) allow retry.

        // 1. Try sessionStorage first — avoids a KV round-trip on page refresh.
        //    (For url-mode this caches the tiny {id: url} map, not base64, so it
        //    never hits the quota that the old base64 buckets did.)
        try {
            const raw = sessionStorage.getItem(imgCacheKey(cat));
            if (raw) {
                const { ts, data } = JSON.parse(raw) as { ts: number; data: Record<string, string> };
                // Only use cache if it has actual entries (not an empty timeout result)
                if (Date.now() - ts < IMG_CACHE_TTL && Object.keys(data).length > 0) {
                    hydrateImages(cat, data);
                    loadedCatsRef.current.add(cat);
                    return; // served from cache — zero KV reads
                }
            }
        } catch { /* sessionStorage unavailable or parse error */ }

        // 2. Fetch from KV — retry once after 2s on failure (handles Supabase cold starts)
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                if (attempt > 0) await new Promise(r => setTimeout(r, 2000));

                // 5-minute time-bucket cache-buster. Cloudflare's Browser-Cache-TTL
                // zone setting rewrites this endpoint's max-age from 60s to 4 HOURS,
                // so without this a browser can hold a stale id-manifest (e.g. one
                // predating newly published petbody: battle sprites) for hours and
                // the renderers silently fall back to old art. Rotating the URL
                // every 5 min bounds staleness at ~5 min while still letting the
                // ~5 KB manifest cache within each bucket.
                const cb = Math.floor(Date.now() / 300_000);
                let entries: Record<string, string>;
                if (urlMode) {
                    // Manifest mode: fetch just the id list and map each to a
                    // per-image URL. The actual bytes load lazily via <img src>.
                    const r = await fetch(`/api/images?cat=${encodeURIComponent(cat)}&ids=1&cb=${cb}`);
                    if (!r.ok) continue;
                    const ids = await r.json() as unknown;
                    if (!Array.isArray(ids)) continue;
                    entries = {};
                    for (const id of ids) {
                        if (typeof id === 'string') entries[id] = `/api/img?id=${encodeURIComponent(id)}`;
                    }
                } else {
                    const r = await fetch(`/api/images?cat=${encodeURIComponent(cat)}&cb=${cb}`);
                    if (!r.ok) continue;
                    const data = await r.json() as unknown;
                    if (!data || typeof data !== 'object') continue;
                    entries = data as Record<string, string>;
                }

                // Only cache and mark done if we actually got images back.
                // An empty {} from a Supabase timeout would poison the cache.
                if (Object.keys(entries).length > 0) {
                    hydrateImages(cat, entries);
                    try {
                        sessionStorage.setItem(imgCacheKey(cat), JSON.stringify({ ts: Date.now(), data: entries }));
                    } catch { /* quota exceeded — skip caching */ }
                }
                // Mark loaded even if empty — the category genuinely has no images yet
                loadedCatsRef.current.add(cat);
                return;
            } catch { /* network error — retry */ }
        }
        // Both attempts failed — leave loadedCatsRef unset so next screen visit retries
    }

    // Preload ALL image categories so they're warm regardless of which screen
    // the player visits first. GATED so the ~30MB of base64 buckets are NOT
    // pulled on an anonymous cold landing: every pre-login surface
    // (StartScreen, CharacterCreator, the public leaderboard, AdminLogin) renders
    // NO sharedImages, so nothing visible depends on these before the player is
    // entering the game. We preload as soon as EITHER a character exists (logged
    // in / created / admin — admin login sets a character) OR a session restore
    // is in flight (a logged-in refresh, in-game momentarily). Because
    // restoringSession is already true at mount on a logged-in refresh, those
    // players get the EXACT same eager-preload timing as before — only true cold
    // landings (which never render these images) are spared the download. The
    // per-screen loader below, plus the login / restore / admin reload paths,
    // independently guarantee a screen never lacks an image it would otherwise
    // show, so this gate can only DELAY the anonymous case, never drop a load.
    useEffect(() => {
        if (!character?.name && !restoringSession) return;
        void loadCategory('item'); void loadCategory('pet'); void loadCategory('card'); void loadCategory('jutsu'); void loadCategory('event'); void loadCategory('avatar'); void loadCategory('ai'); void loadCategory('bloodline'); void loadCategory('shrine'); void loadCategory('landmark');
    }, [character?.name, restoringSession]);

    // ── Avatar cache-fill for live players ────────────────────────────────
    // The presence heartbeat no longer ships avatar data URLs (they were the
    // bulk of its egress). Instead the client resolves other players' avatars
    // from sharedImages['avatar:<name>'], hydrated by loadCategory('avatar')
    // (which fetches the whole avatar bucket from /api/images?cat=avatar in one
    // CDN-cached request). That bucket is loaded at startup, but a player who
    // sets an avatar AFTER we loaded — or who joins mid-session — wouldn't be in
    // it yet, so their sector dot / roster entry would show the 🥷 emoji.
    //
    // This refreshes the avatar bucket (at most once per AVATAR_REFRESH_MS) when
    // we encounter a live player name we don't have a cached avatar for. The
    // refresh re-fetches the WHOLE bucket, not per-name, so N unknown players
    // cost one request, not N. Throttled so a churny sector can't spam /api/images.
    const lastAvatarRefreshRef = useRef(0);
    const AVATAR_REFRESH_MS = 30_000;
    function ensureAvatarsCached(names: Array<string | undefined | null>) {
        // Any live player whose avatar isn't in the cache yet?
        const missing = names.some((n) => {
            if (!n) return false;
            const lower = n.toLowerCase();
            if (lower === (characterRef.current?.name ?? '').toLowerCase()) return false; // self: uses own field
            return !sharedImages['avatar:' + lower];
        });
        if (!missing) return;
        const now = Date.now();
        if (now - lastAvatarRefreshRef.current < AVATAR_REFRESH_MS) return; // throttle
        lastAvatarRefreshRef.current = now;
        // Force loadCategory('avatar') to actually re-fetch: clear the in-memory
        // "already loaded" guard and the sessionStorage copy so it bypasses both
        // short-circuits and pulls the freshest bucket.
        loadedCatsRef.current.delete('avatar');
        try { sessionStorage.removeItem(imgCacheKey('avatar')); } catch { /* ignore */ }
        void loadCategory('avatar');
    }

    // Keep a fresh reference to ensureAvatarsCached so the presence-store prefetch
    // callback (registered once below) always closes over the latest sharedImages.
    const ensureAvatarsCachedRef = useRef(ensureAvatarsCached);
    useEffect(() => { ensureAvatarsCachedRef.current = ensureAvatarsCached; });
    // Live-sector roster now lives in the presence store; have it push the live
    // names here whenever they change so a newly-seen player's avatar loads at
    // once — without re-rendering App. Registered once.
    useEffect(() => {
        setLiveAvatarPrefetch((names) => ensureAvatarsCachedRef.current(names));
        return () => setLiveAvatarPrefetch(null);
    }, []);
    // Drive the cache-fill from the player lists. Runs whenever playerRoster changes
    // OR sharedImages updates — so it always re-evaluates "is anyone's avatar
    // missing?" against fresh state (no stale closure). The live-sector roster is
    // read non-reactively from the store here too, so a sharedImages update also
    // re-checks live players; the internal throttle keeps it from spamming /api/images.
    useEffect(() => {
        const names = [
            ...getLiveSectorPlayers().map((p) => p.name),
            ...playerRoster.map((p) => p.name),
        ];
        if (names.length) ensureAvatarsCached(names);
    }, [playerRoster, sharedImages]);

    // ── Hollow Gate Shrine terrain ────────────────────────────────────────
    // The dungeon's wall / floor / corridor / door textures are published AI
    // art under shrine:tile-<role>-<variant> (+ per-theme shrine:icon-theme-*),
    // loaded via loadCategory('shrine'). The old Kenney tilemap auto-slicer was
    // retired when the torch-lit catacomb terrain set landed — it canvas-sliced
    // the brown-brick pack over those keys and clobbered the published door.

    // Screen ? image categories map
    useEffect(() => {
        if (screen === 'worldMap')                              { void loadCategory('avatar'); void loadCategory('event'); }
        else if (screen === 'pets' || screen === 'petArena')    { void loadCategory('pet'); }
        else if (screen === 'jutsuTraining')                    { void loadCategory('jutsu'); }
        else if (screen === 'shop' || screen === 'profile' || screen === 'inventory' || screen === 'adminPanel') {
            void loadCategory('item');
            void loadCategory('ai');
            void loadCategory('bloodline');
        }
        else if (screen === 'shinobiTiles')                     { void loadCategory('card'); }
        else if (screen === 'arena' || screen === 'battleArena'){ void loadCategory('avatar'); void loadCategory('jutsu'); void loadCategory('ai'); }
        else if (screen === 'bloodlineMaker')                   { void loadCategory('bloodline'); void loadCategory('jutsu'); }
        else if (screen === 'storyHall')                        { void loadCategory('event'); }
        else if (screen === 'logbook')                          { void loadCategory('event'); void loadCategory('ai'); }

    }, [screen]);

    // The choose-your-companion overlay (onboardingStep === "starter") renders
    // starter portraits from sharedImages['pet:<id>'], but it's not a
    // 'pets'/'petArena' screen, so the screen→category effect above never
    // hydrates the pet bucket for a brand-new player. Load it when the overlay
    // is active so the uploaded art shows instead of the emoji fallback.
    // Idempotent — loadCategory's loadedCatsRef guard skips a re-fetch.
    useEffect(() => {
        // academyIntro preloads a beat early so portraits are ready at "Begin".
        if (character?.onboardingStep === "starter" || character?.onboardingStep === "academyIntro") void loadCategory('pet');
    }, [character?.onboardingStep]);

    // Keep a ref to the latest save payload so the interval always uses current data.
    const latestSaveRef = useRef<{ character: Character; name: string; payload: ReturnType<typeof buildPlayerSavePayload> } | null>(null);

    // Server-issued monotonic version of the last save we loaded or wrote.
    // We echo this back as `_baseSaveVersion` in autosave POSTs so the server
    // can detect when a second tab/device wrote in between and reject the
    // stale overwrite (HTTP 409). On 409 we refetch + reapply the server's
    // newer snapshot. Defaults to 0 = "no version known" which the server
    // treats as an allow (preserves backwards compat for stale tabs).
    const latestSaveVersionRef = useRef<number>(0);
    // Guard so we only run one conflict-recovery refetch at a time even if
    // multiple autosave timers fire 409s in close succession.
    const conflictRefetchInFlightRef = useRef<boolean>(false);
    // #23: surface a banner when a save is persistently rejected (a payload too
    // large [413] or a sustained 5xx) so the player knows before they refresh —
    // persistSave otherwise retries silently forever. Cleared on the next success.
    const saveFailCountRef = useRef(0);
    const [saveBlocked, setSaveBlocked] = useState(false);

    async function refetchAfterSaveConflict(accountName: string) {
        if (conflictRefetchInFlightRef.current) return;
        conflictRefetchInFlightRef.current = true;
        try {
            const res = await fetch(`/api/save/${encodeURIComponent(accountName.toLowerCase())}`, { cache: "no-store" });
            if (!res.ok) return;
            const snap = await res.json() as ReturnType<typeof buildPlayerSavePayload> & { _saveVersion?: number };
            // Apply the server's newer snapshot. Clears charDirtyRef so the
            // autosave loop doesn't immediately re-clobber the freshly loaded
            // state — same reasoning as the post-login load.
            applyServerSnapshot(snap);
            if (typeof snap._saveVersion === "number") {
                latestSaveVersionRef.current = snap._saveVersion;
            }
        } catch {
            // Network error — autosave loop will retry; nothing to do here.
        } finally {
            conflictRefetchInFlightRef.current = false;
        }
    }

    // Shared autosave POST used by the debounced save, the 15s interval, and the
    // immediate training flush. The caller clears charDirtyRef before invoking;
    // persistSave re-arms it on failure so the next tick retries. Base64 image
    // strings are stripped from the body (server stores them separately).
    async function persistSave(snap: NonNullable<typeof latestSaveRef.current>) {
        const bodyWithVersion = { ...snap.payload, _baseSaveVersion: latestSaveVersionRef.current };
        const accountName = snap.name;
        try {
            const res = await fetch(`/api/save/${encodeURIComponent(accountName.toLowerCase())}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyWithVersion, (_k: string, v: unknown) => typeof v === "string" && v.startsWith("data:image") ? "" : v),
            });
            if (res.status === 409) {
                // Another tab/device wrote first. Refetch + reapply rather than
                // overwriting their work — better than silently losing the other
                // tab's progress.
                void refetchAfterSaveConflict(accountName);
                return;
            }
            if (res.ok) {
                try {
                    const data = await res.json() as { _saveVersion?: number };
                    if (typeof data._saveVersion === "number") latestSaveVersionRef.current = data._saveVersion;
                } catch { /* server may return 200 with empty body; ignore */ }
                // Mirror to localStorage so the next login can paint instantly.
                writeSavePreview(accountName, { ...snap.payload, _saveVersion: latestSaveVersionRef.current });
                // Recovered — clear any save-error banner + failure streak.
                if (saveFailCountRef.current) { saveFailCountRef.current = 0; setSaveBlocked(false); }
            } else {
                // Rejected (401/403/413/426/5xx). Don't silently drop it — warn
                // and re-arm the dirty flag so the next tick retries. A 413 (too
                // large) or a sustained streak won't self-recover, so surface a
                // banner rather than retrying invisibly forever (#23).
                console.warn(`[autosave] server rejected save (status ${res.status})`);
                charDirtyRef.current = true;
                saveFailCountRef.current += 1;
                if (res.status === 413 || saveFailCountRef.current >= 4) setSaveBlocked(true);
            }
        } catch {
            charDirtyRef.current = true; // restore so next tick retries
            saveFailCountRef.current += 1;
            if (saveFailCountRef.current >= 6) setSaveBlocked(true);
        }
    }

    // Dirty-tracking: only auto-save when character state actually changed locally.
    // This prevents a second device (e.g. desktop) from continuously re-uploading the
    // snapshot it loaded from the server, which would overwrite progress made on the
    // primary device (e.g. mobile still in the village).
    //
    // How it works: we compare character object references (React immutable pattern).
    // Refs only change when setCharacter() is called with new data. After a server load
    // we seed prevCharRef so the load itself isn't counted as a local change.
    const prevCharRef = useRef<Character | null>(null);
    const charDirtyRef = useRef(false);
    // Signature of the last snapshot-applied mission/biome state — lets the
    // standalone-state dirty effect tell a local change from a snapshot reapply.
    const lastSnapshotMissionSigRef = useRef<string | null>(null);
    // Set by the training screens (via the *Now setters below) to request an
    // immediate save on the next commit rather than waiting for the 3s/15s
    // autosave. Players reported starting a training on one device and not
    // seeing it on another because they switched/closed before the debounced
    // save fired. Snapshot loads use the raw setters so they never flush.
    const flushSaveRef = useRef(false);
    const setActiveTrainingNow = useCallback((t: ActiveTraining | null) => {
        setActiveTraining(t);
        flushSaveRef.current = true;
    }, []);
    const setActiveJutsuTrainingNow = useCallback((t: ActiveJutsuTraining | null) => {
        setActiveJutsuTraining(t);
        flushSaveRef.current = true;
    }, []);
    // Global wiring: auto-promote a queued 2nd jutsu training (activeJutsuTraining.next)
    // the instant the active one finishes — works on any screen. Logic in lib/jutsu-training-queue.
    useJutsuTrainingQueueRunner(activeJutsuTraining, setActiveJutsuTrainingNow, setCharacter);

    useEffect(() => {
        if (!character || !currentAccountName) { latestSaveRef.current = null; return; }
        // Detect genuine local character changes (reference inequality = new React state).
        if (character !== prevCharRef.current) {
            charDirtyRef.current = true;
            prevCharRef.current = character;
        }
        latestSaveRef.current = { character, name: currentAccountName, payload: buildPlayerSavePayload(character) };
    });

    // Mark the save dirty when sector changes locally. Without this the
    // 15s/3s autosave only fires on character-reference changes, so a fresh
    // sector wasn't persisted promptly — a 409 refetch returned the server's
    // stale value and the player visibly rubber-banded to the previous sector.
    // Snapshot-driven changes are tagged via lastSnapshotAppliedSectorRef so
    // they don't falsely flip charDirtyRef.
    useEffect(() => {
        if (!character || !currentAccountName) return;
        if (lastSnapshotAppliedSectorRef.current === currentSector) {
            lastSnapshotAppliedSectorRef.current = null;
            return;
        }
        charDirtyRef.current = true;
        lastLocalSectorChangeRef.current = Date.now();
    }, [currentSector, character, currentAccountName]);

    // Mark the save dirty when standalone top-level state (acceptedMissionIds /
    // missionProgress / triggeredEvents / currentBiome) changes locally — these
    // are in buildPlayerSavePayload but touch neither the character ref nor
    // currentSector, so the autosave timers never scheduled a save (accept a
    // contract then close the tab → lost it). The signature guard skips changes a
    // server snapshot just reapplied so a load doesn't falsely flip dirty.
    useEffect(() => {
        if (!character || !currentAccountName) return;
        const sig = JSON.stringify([acceptedMissionIds, missionProgress, triggeredEvents, currentBiome]);
        if (lastSnapshotMissionSigRef.current === sig) { lastSnapshotMissionSigRef.current = null; return; }
        charDirtyRef.current = true;
    }, [acceptedMissionIds, missionProgress, triggeredEvents, currentBiome, character, currentAccountName]);

    // Debounced auto-save — whenever the character state changes, schedule a
    // server save within 3 seconds. This ensures currency gains, mission
    // completions, PvP wins, etc. are persisted quickly rather than waiting
    // for the 15-second interval. The debounce prevents rapid-fire saves when
    // multiple updates happen in quick succession (e.g. battle rewards).
    const saveSoonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!character || !currentAccountName) return;
        if (!charDirtyRef.current) return;
        if (saveSoonTimerRef.current) clearTimeout(saveSoonTimerRef.current);
        saveSoonTimerRef.current = setTimeout(() => {
            saveSoonTimerRef.current = null;
            if (!charDirtyRef.current) return;
            const snap = latestSaveRef.current;
            if (!snap) return;
            charDirtyRef.current = false;
            void persistSave(snap);
        }, 3000);
        return () => { if (saveSoonTimerRef.current) clearTimeout(saveSoonTimerRef.current); };
    }, [character, currentAccountName]);

    useEffect(() => {
        const id = setInterval(() => {
            // Only save if the character actually changed locally since the last server sync.
            // A second logged-in device that loaded from server and did nothing will have
            // charDirtyRef=false and skip the save entirely — preserving the other device's progress.
            if (!charDirtyRef.current) return;
            const snap = latestSaveRef.current;
            if (!snap) return;
            charDirtyRef.current = false; // optimistically clear; restored on failure
            void persistSave(snap);
        }, 15_000);
        return () => clearInterval(id);
    }, []);

    // Immediate flush on training start/stop OR a fresh KO (hospitalized
    // false→true while charDirtyRef, not a load-while-admitted): losses set
    // hospitalized client-side only, so without this, clicking "Pay & Discharge"
    // inside the 3s debounce hit "not hospitalized" until autosave landed.
    useEffect(() => {
        if (!flushSaveRef.current && !(character?.hospitalized && charDirtyRef.current)) return;
        flushSaveRef.current = false;
        if (!character || !currentAccountName) return;
        const snap = latestSaveRef.current;
        if (!snap) return;
        if (saveSoonTimerRef.current) { clearTimeout(saveSoonTimerRef.current); saveSoonTimerRef.current = null; }
        charDirtyRef.current = false;
        void persistSave(snap);
    }, [activeTraining, activeJutsuTraining, character?.hospitalized]);

    // Save on page unload (F5 / tab close / navigation away) so that progress
    // made since the last auto-save is not lost.
    // keepalive: true tells the browser to complete the fetch even after the
    // page has been torn down. Auth headers are injected automatically by the
    // global authFetch interceptor (window.fetch is patched at app boot and
    // spreads all RequestInit properties — including keepalive — to the real fetch).
    // The 64 KB keepalive body limit is respected because stripImages removes
    // all base64 image strings before serialising.
    useEffect(() => {
        function stripImages(_key: string, value: unknown) {
            return typeof value === 'string' && value.startsWith('data:image') ? '' : value;
        }
        function handleBeforeUnload() {
            if (!charDirtyRef.current) return; // nothing changed — skip
            const snap = latestSaveRef.current;
            if (!snap) return;
            // Page is unloading — we can't recover from a 409 here (no chance
            // to refetch), but we still send the version so the server can
            // reject and preserve the other tab's progress rather than letting
            // a stale unload-time write clobber newer state.
            const bodyWithVersion = { ...snap.payload, _baseSaveVersion: latestSaveVersionRef.current };
            fetch(`/api/save/${encodeURIComponent(snap.name.toLowerCase())}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                body: JSON.stringify(bodyWithVersion, stripImages),
            });
        }
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    async function createPlayerAccount(newCharacter: Character, password: string) {
        const key = accountKey(newCharacter.name);
        let regToken: string | undefined;
        try {
            const authRes = await fetch('/api/player-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'register', name: newCharacter.name.toLowerCase(), password }),
            });
            if (authRes.status === 409) {
                alert("A player with that name already exists. Log in instead or choose another name.");
                return;
            }
            if (!authRes.ok) {
                alert("Could not create the server account. Try again.");
                return;
            }
            // Capture the session token from registration so the first
            // requests use the cheap HMAC path right away.
            const regData = await authRes.json().catch(() => null) as { token?: string } | null;
            regToken = regData?.token ?? undefined;
            if (regToken) setActiveToken(regToken);
        } catch {
            alert("Could not reach the server to create the account. Check your connection and try again.");
            return;
        }

        const accounts = loadPlayerAccounts();
        // M5: on a token-issuing server, store the per-account token and DROP the
        // plaintext password. Only persist the password when no token was issued
        // (SESSION_SECRET unset), since then it's the only credential available.
        accounts[key] = regToken
            ? { ...(accounts[key] ?? {}), token: regToken, password: undefined }
            : { ...(accounts[key] ?? {}), password };
        savePlayerAccounts(accounts);
        // Pass the password so the global authFetch interceptor can attach
        // x-player-name / x-player-password to every /api/ request from now on.
        // (The token captured above is preferred; password is the fallback.)
        setActivePlayer(newCharacter.name, password);

        setCurrentAccountName(newCharacter.name);
        setCharacter(newCharacter);
        setCurrentBiome("central");
        setActiveTraining(null);
        setActiveJutsuTraining(null);
        setAcceptedMissionIds([]);
        setMissionProgress({});
        setTriggeredEvents([]);
        setPendingAiProfileId("");
        setCurrentSector(40);
        setScreen("villageLore");
        // Surface a failed FIRST save instead of swallowing it. A silent first-save
        // failure is the precondition for total character loss: the character lives
        // only in memory, and on the next refresh the login save-GET 404s and the
        // account gets cleared. The 3s autosave will also retry (charDirtyRef is set
        // by setCharacter above), but warn the player so they don't refresh on a
        // dropped connection before the retry lands.
        try {
            await pushSaveToServer(newCharacter, newCharacter.name);
        } catch (err) {
            console.error("[createPlayerAccount] first save failed", err);
            alert("Your character was created, but the first save to the server didn't go through. Keep this tab open — it will retry automatically. Don't refresh yet, or your new character could be lost.");
        }
        void pullSharedAdminContent();
    }

    // Apply a full server snapshot to all game state
    function applyServerSnapshot(snap: ReturnType<typeof buildPlayerSavePayload>) {
        // Seed prevCharRef so the auto-save interval treats this load as clean —
        // same reasoning as applySnapshot above (prevent stale re-upload).
        const normalized = normalizeAdminCharacter(snap.character);
        prevCharRef.current = normalized;
        charDirtyRef.current = false;
        // Capture server-issued save version (for multi-tab clobber detection).
        const snapVersion = (snap as Record<string, unknown>)._saveVersion;
        if (typeof snapVersion === "number" && Number.isFinite(snapVersion)) {
            latestSaveVersionRef.current = snapVersion;
        }
        setCurrentAccountName(snap.character.name);
        setCharacter(normalized);
        setCurrentBiome(snap.currentBiome ?? "central");
        setActiveTraining(snap.activeTraining ?? null);
        setActiveJutsuTraining(snap.activeJutsuTraining ?? null);
        setAcceptedMissionIds(snap.acceptedMissionIds ?? []);
        setMissionProgress(snap.missionProgress ?? {});
        setTriggeredEvents(snap.triggeredEvents ?? []);
        setPendingAiProfileId(snap.pendingAiProfileId ?? "");
        lastSnapshotMissionSigRef.current = JSON.stringify([snap.acceptedMissionIds ?? [], snap.missionProgress ?? {}, snap.triggeredEvents ?? [], snap.currentBiome ?? "central"]);
        applySnapshotSectorWithGuard(snap.currentSector ?? 40);
        if (snap.savedBloodlines) setSavedBloodlines(snap.savedBloodlines.map((bloodline: SavedBloodline) => ({ ...bloodline, jutsus: bloodline.jutsus.map(normalizeJutsu) })));
        if (snap.creatorJutsus) setCreatorJutsus(snap.creatorJutsus.map(normalizeJutsu));
        if (snap.creatorAis) setCreatorAis(balanceExistingAiProfiles(snap.creatorAis, savedJutsuPool(snap)));
        if (snap.creatorEvents) setCreatorEvents(snap.creatorEvents);
        if (snap.creatorMissions) setCreatorMissions(snap.creatorMissions);
        if (snap.creatorRaids) setCreatorRaids(snap.creatorRaids);
        if (snap.creatorCards) setCreatorCards(snap.creatorCards);
        if (snap.creatorItems) setCreatorItems(snap.creatorItems);
        if (snap.petEncounterVn) setPetEncounterVn(snap.petEncounterVn);
        if (snap.ancientChestVn) setAncientChestVn(snap.ancientChestVn);
        if (snap.editablePets) setEditablePets(mergeMissingBuiltInPets(snap.editablePets));
        // Preserve the current screen across in-session snapshot reapplies
        // (409 save-conflict refetch + admin forceReload heartbeat) so a
        // stale base-version or a deploy-time chunk reload doesn't yank the
        // player out of the shop / inventory / hospital / world map / etc.
        // Only route to village on a fresh login (current screen is "start");
        // every other call site is mid-session and already has a screen
        // worth keeping — including battle screens, which used to be the
        // only ones preserved here.
        if (screenRef.current === "start") {
            setScreen("village");
        }
        // Mirror the freshly-applied state to the localStorage preview cache
        // so the next login can paint instantly before the save round-trip.
        writeSavePreview(snap.character.name, snap);
        // Re-hydrate images after login — server save strips base64 images to stay
        // within payload limits. Clear the loaded-cats guard and sessionStorage cache
        // so loadCategory re-fetches from KV and patches image fields back in.
        loadedCatsRef.current.clear();
        clearImgCache();
        setTimeout(() => {
            void loadCategory('item'); void loadCategory('pet');
            void loadCategory('card'); void loadCategory('jutsu');
            void loadCategory('event'); void loadCategory('avatar');
            void loadCategory('ai'); void loadCategory('bloodline');
        }, 0);
    }

    async function loginPlayerAccount(name: string, password: string) {
        const accounts = loadPlayerAccounts();
        const account = accounts[accountKey(name)];

        async function loginFetch(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 15000) {
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
            try {
                return await fetch(input, { ...init, signal: controller.signal });
            } finally {
                window.clearTimeout(timeoutId);
            }
        }

        // Always verify password against the server first — this is the authoritative check.
        // Local localStorage only provides a fast-path pre-check.
        let authOk = false;
        let legacy = false;
        let authVerified = false;
        // Retry up to 2 times — handles Supabase cold starts (first call often slow)
        for (let attempt = 0; attempt < 2 && !authVerified; attempt++) {
            try {
                if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
                const authRes = await loginFetch('/api/player-auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'verify', name: name.trim().toLowerCase(), password }),
                }, 15000);
                if (authRes.status === 503) continue; // storage unavailable — retry
                if (authRes.status === 403) {
                    // Account is banned. Show the ban detail and bail out — don't
                    // fall back to local cache, the server explicitly refused.
                    const banData = await authRes.json().catch(() => ({})) as { ban?: { until: number; reason: string; permanent?: boolean } };
                    const b = banData.ban;
                    if (b) {
                        const when = b.permanent ? "permanently" : `until ${new Date(b.until).toLocaleString()}`;
                        alert(`⛔ Your account is banned ${when}.\n\nReason: ${b.reason || "(no reason given)"}`);
                    } else {
                        alert("⛔ Your account is banned.");
                    }
                    return;
                }
                if (authRes.ok) {
                    const authData = await authRes.json() as { ok: boolean; legacy?: boolean; token?: string };
                    authOk = authData.ok;
                    legacy = authData.legacy ?? false;
                    authVerified = true;
                    // Store the session token so every later /api/ request uses
                    // the cheap HMAC path instead of re-running scrypt server-side.
                    if (authData.ok && authData.token) {
                        setActiveToken(authData.token);
                        // M5: migrate this account to token-only — drop any
                        // previously-persisted plaintext password from the blob.
                        // (Only runs on a successful ONLINE login; the offline
                        // fallback below never reaches here, so it keeps its
                        // password until the next successful online login.)
                        const mk = accountKey(name);
                        if (mk) {
                            const maccs = loadPlayerAccounts();
                            if (maccs[mk]) {
                                maccs[mk] = { ...maccs[mk], token: authData.token, password: undefined };
                                savePlayerAccounts(maccs);
                            }
                        }
                    }
                } else {
                    // Non-retriable HTTP error — stop
                    authVerified = true;
                }
            } catch {
                // Network/timeout error — retry once, then fall back to local cache
            }
        }
        if (!authVerified) {
            // Both attempts failed (network down / persistent timeout)
            if (account?.password) {
                authOk = account.password === password;
            } else {
                alert("Could not reach server to verify password. Check your connection and try again.");
                return;
            }
        }

        if (!authOk) {
            alert("Player name or password is incorrect.");
            return;
        }

        // Legacy account verified (no server hash yet) AND we have local data proving
        // this is the real owner — silently upgrade to server-side password now.
        if (legacy && account && account.password === password) {
            void fetch('/api/player-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'register', name: name.trim().toLowerCase(), password }),
            });
        }

        // Prime the authFetch interceptor *before* the save GET fires.
        // Without this, the interceptor has no credentials and the backend
        // returns 401, which the UI mistranslates as "no save found".
        setActivePlayer(name, password);

        // Instant-paint from localStorage while the save fetch is in flight.
        // The cached preview is written on every successful server save (both
        // autosave paths) and after every applyServerSnapshot, so it mirrors
        // the most-recent known state. The real save will arrive within a
        // few seconds and applyServerSnapshot will reconcile any drift. Skip
        // silently if no cache exists (first-time login on this device) or if
        // the cache's character.name doesn't match (handled inside readSavePreview).
        const cachedPreview = readSavePreview(name);
        if (cachedPreview && cachedPreview.character) {
            try {
                applyServerSnapshot(cachedPreview as ReturnType<typeof buildPlayerSavePayload>);
            } catch {
                // Cache may be from an older schema — silently skip the
                // instant-paint and let the server load take over.
            }
        }

        // Always pull the full server save - this is where the real character state lives.
        // Retry once on failure to handle transient Supabase cold starts.
        let saveRes: Response | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
                // Explicit auth headers — belt-and-suspenders alongside the interceptor.
                saveRes = await loginFetch(
                    `/api/save/${encodeURIComponent(name.toLowerCase())}`,
                    { headers: { 'x-player-name': name, 'x-player-password': password } },
                    20000,
                );
                if (saveRes.status !== 503) break; // 503 = storage unavailable, retry
            } catch { /* timeout/network — retry */ }
        }
        if (!saveRes) {
            alert("Could not load your save from the server. Try again in a moment.");
            return;
        }
        if (saveRes.ok) {
            const serverSnapshot = await saveRes.json() as ReturnType<typeof buildPlayerSavePayload>;
            applyServerSnapshot(serverSnapshot);
            void pullSharedAdminContent();
        } else if (saveRes.status === 404) {
            // Save is missing but auth passed — clear the stale localStorage snapshot and
            // also delete the auth record (password already verified above) so the player
            // can immediately re-register and create a fresh character without getting
            // a 409 "already exists" block. This handles the deadlock where auth:name exists
            // but save:name does not (e.g. initial save failed on account creation).
            const lsKey = accountKey(name);
            if (lsKey) {
                const accs = loadPlayerAccounts();
                delete accs[lsKey];
                savePlayerAccounts(accs);
            }
            // Best-effort auth clear — if it fails they'll need admin help, but try.
            void fetch('/api/player-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete', name: name.trim().toLowerCase(), password }),
            });
            setCharacter(null);
            setCurrentAccountName("");
            setScreen("start");
            alert(`No save data was found for "${name}". Your login lock has been cleared — please create a new character with the same name and password.`);
        } else if (!account) {
            alert("No save found for that name. Check spelling or create a new character.");
        }
    }

    async function deleteCharacter() {
        if (!character) return;
        if (!window.confirm(`Delete "${character.name}"? This permanently removes your character and all save data. This cannot be undone.`)) return;
        const accountName = currentAccountName || character.name;
        const localAccounts = loadPlayerAccounts();
        const localPw = localAccounts[accountKey(accountName)]?.password
            ?? window.prompt("Enter your password to delete this character from the server.")?.trim()
            ?? "";
        if (!localPw) {
            alert("Password required to delete a server account.");
            return;
        }
        await fetch(`/api/save/${encodeURIComponent(accountName.toLowerCase())}`, {
            method: "DELETE",
            headers: localPw ? { "x-player-password": localPw } : {},
        }).catch(() => {});
        // Also remove the server-side auth record so the name can be reused.
        void fetch('/api/player-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(localPw ? { 'x-player-password': localPw } : {}) },
            body: JSON.stringify({ action: 'delete', name: accountName.toLowerCase(), password: localPw }),
        }).catch(() => {});
        const accounts = loadPlayerAccounts();
        delete accounts[accountKey(accountName)];
        savePlayerAccounts(accounts);
        setCharacter(null);
        setCurrentAccountName("");
        // Account deleted — also wipe the persisted password + session token
        // (same credential-clear as logoutPlayer; the account no longer exists).
        setActivePlayer(null);
        setActiveTraining(null);
        setActiveJutsuTraining(null);
        setAcceptedMissionIds([]);
        setMissionProgress({});
        setTriggeredEvents([]);
        setPendingAiProfileId("");
        setPendingPvpOpponent(null);
        setCurrentSector(40);
        setActiveTriggeredEvent(null);
        setScreen("start");
    }

    function logoutPlayer() {
        if (character) {
            saveAccountProgress(character);
            pushSaveToServer(character, currentAccountName || character.name);
        }
        setCharacter(null);
        setCurrentAccountName("");
        // Clear the persisted player password + session token from local/session
        // storage on logout. Without this they survive logout (the sync effect
        // only ever passes "" — never null — so it never triggers the clear),
        // leaving a reusable plaintext password readable on a shared machine.
        setActivePlayer(null);
        setActiveTraining(null);
        setActiveJutsuTraining(null);
        setAcceptedMissionIds([]);
        setMissionProgress({});
        setTriggeredEvents([]);
        setPendingAiProfileId("");
        setPendingPvpOpponent(null);
        setCurrentSector(40);
        setActiveTriggeredEvent(null);
        setScreen("start");
    }

    function recordMissionExplore(sector: number) {
        const matchingMissions = allProgressMissions(creatorMissions).filter((mission) =>
            acceptedMissionIds.includes(mission.id) &&
            mission.type === "fetchExplore" &&
            !mission.id.startsWith("hunt-") &&
            mission.targetSector === sector
        );

        if (matchingMissions.length === 0) return;

        setMissionProgress((current) => {
            const next = { ...current };
            matchingMissions.forEach((mission) => {
                next[mission.id] = Math.min(mission.exploreCount, (next[mission.id] ?? 0) + 1);
            });
            return next;
        });
    }

    function completeHuntForAi(defeatedAiId: string) {
        if (!defeatedAiId) return;
        // Find the accepted hunt contract whose beast matches the AI just killed.
        const mission = builtinHuntMissions.find(
            (m) => m.aiProfileId === defeatedAiId && acceptedMissionIds.includes(m.id)
        );
        if (!mission) return;
        const required = mission.exploreCount ?? 1;
        // Only complete if the player finished tracking (huntSector holds the
        // counter at required-1 going into the fight). This marks the contract
        // claimable; claimHunt() pays out. Prevents claiming a hunt reward after
        // dying or fleeing the beast.
        setMissionProgress((current) =>
            (current[mission.id] ?? 0) >= required - 1
                ? { ...current, [mission.id]: required }
                : current
        );
    }

    function recordMissionRaid(_sector: number, battleId?: string) {
        // Sector filter removed: village territory raids use a virtual offset sector that
        // doesn't match mission.targetSector, so any raid win counts toward accepted raid
        // missions. The explore requirement still pins the player to the correct location.
        const matchingMissions = allProgressMissions(creatorMissions).filter((mission) =>
            acceptedMissionIds.includes(mission.id) &&
            mission.type === "fetchExplore" &&
            missionRaidRequirement(mission) > 0
        );

        if (matchingMissions.length > 0) {
            setMissionProgress((current) => {
                const next = { ...current };
                matchingMissions.forEach((mission) => {
                    const key = missionRaidProgressKey(mission.id);
                    next[key] = Math.min(missionRaidRequirement(mission), (next[key] ?? 0) + 1);
                });
                return next;
            });
        }

        // Vanguard daily raid-mission progress — every successful raid (human
        // OR AI defender) counts. Server endpoint is rate-limited so a retry
        // can't double-count.
        //
        // PvP raid: pass `battleId` so the server cross-validates the win
        // against the actual PvpSession record.
        // AI raid: pass `raidToken` minted by /api/missions/raid-start when
        // the raid began (held in activeRaidTokenRef). The server consumes
        // the token atomically, so each minted token grants at most one
        // mission credit.
        if (character?.profession === "vanguard") {
            const requestBody: { playerName: string; battleId?: string; raidToken?: string } = { playerName: character.name };
            if (battleId) {
                requestBody.battleId = battleId;
            } else if (activeRaidTokenRef.current) {
                requestBody.raidToken = activeRaidTokenRef.current;
            }
            // Clear the token locally regardless of report success — the
            // server's single-use consume means a retry won't help.
            activeRaidTokenRef.current = null;
            fetch('/api/missions/report-raid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            }).then(r => r.ok ? r.json() : null).then(data => {
                const completed: Array<{ id: string; name: string; xpReward: number }> = Array.isArray(data?.missionsCompleted) ? data.missionsCompleted : [];
                for (const m of completed) {
                    window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                        detail: { name: m.name, xp: m.xpReward, profession: 'vanguard' },
                    }));
                }
            }).catch(() => { /* best-effort */ });
        }
    }

    function scaleEndlessAiClone(baseAi: CreatorAi, wave: number): CreatorAi {
        const factor = endlessScaleFactor(wave);
        // Clone stats and multiply offensive/defensive stats; cap HP/chakra/stamina at ×4 baseline.
        const scaledStats: Stats = { ...baseAi.stats };
        (Object.keys(scaledStats) as (keyof Stats)[]).forEach((k) => {
            scaledStats[k] = Math.floor(scaledStats[k] * Math.min(4, factor));
        });
        return {
            ...baseAi,
            id: `endless-${baseAi.id}-w${wave}`,
            name: wave % 10 === 0 ? `★ ${baseAi.name} (Floor ${wave})` : `${baseAi.name} (Floor ${wave})`,
            hp: Math.floor(baseAi.hp * Math.min(5, factor)),
            chakra: Math.floor(baseAi.chakra * Math.min(3, factor * 0.8)),
            stamina: Math.floor(baseAi.stamina * Math.min(3, factor * 0.8)),
            stats: scaledStats,
        };
    }

    function pickRandomEndlessAi(wave: number): string {
        if (playableAis.length === 0) return "";
        // Scale difficulty: allow AIs up to player level + 5 per wave, capped at 100.
        // Boss AIs only appear on milestone floors (every 10).
        const cap = Math.min(100, (character?.level ?? 1) + wave * 5);
        const allowBoss = wave % 10 === 0;
        const candidates = playableAis.filter(ai => allowBoss || !ai.isBossAi);
        const pool = candidates.filter(ai => (ai.level ?? 1) <= cap);
        const fallback = candidates.length > 0 ? candidates : playableAis;
        const chosen = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : fallback[Math.floor(Math.random() * fallback.length)];
        // Build a scaled clone, register it as the temporary AI so the arena uses it.
        const scaled = scaleEndlessAiClone(chosen, wave);
        setTemporaryStoryAi(scaled);
        return scaled.id;
    }

    function startEndlessBattle() {
        if (!character) return;
        // Restore in-progress run, or start a new one at wave 1.
        const existing = character.endlessTowerRun;
        // Fresh-run entry fee (first Endless run each day is free; resuming is free).
        let base = character;
        if (!existing || existing.wave <= 0) {
            const paid = payEndlessEntry(character);
            if (!paid) return alert(`Entry costs ${endlessEntryCost(character).toLocaleString()} ryo — your first Endless run each day is free. Not enough ryo.`);
            base = paid;
        }
        const wave = existing && existing.wave > 0 ? existing.wave : 1;
        const run: EndlessTowerRun = existing ?? {
            wave: 1,
            bankedRyo: 0,
            bankedXp: 0,
            startedAt: Date.now(),
        };
        setCharacter({ ...base, endlessTowerRun: run });
        setEndlessBattleActive(true);
        setEndlessBattleWave(wave);
        setPendingAiProfileId(pickRandomEndlessAi(wave));
        setArenaKey(k => k + 1);
        navigate("arena");
    }

    function handleEndlessWin(currentWave: number) {
        const reward = endlessWaveReward(currentWave, character?.level ?? 1);
        // Kill-milestone payouts (bone charms / fate shards every 5 kills,
        // 4-step cycle) and the per-10-kill heal/restore. Both are credited
        // directly to the player's character — no banking, no death-loss.
        const milestonePayout = endlessTowerMilestoneReward(currentWave);
        const isHealMilestone = currentWave > 0 && currentWave % 10 === 0;
        const milestoneNotices: string[] = [];
        setCharacter((current) => {
            if (!current) return current;
            const nextWave = currentWave + 1;
            const prevRun = current.endlessTowerRun ?? { wave: 1, bankedRyo: 0, bankedXp: 0, startedAt: Date.now(), highestMilestoneClaimed: 0 };
            const alreadyClaimed = prevRun.highestMilestoneClaimed ?? 0;
            // Only grant the 5-kill payout if this wave is a new milestone
            // (guards against accidental re-fires from save reloads).
            const milestoneIsNew = currentWave > 0 && currentWave % 5 === 0 && currentWave > alreadyClaimed;
            const grantedBone = milestoneIsNew ? milestonePayout.boneCharms : 0;
            const grantedFate = milestoneIsNew ? milestonePayout.fateShards : 0;
            if (milestoneIsNew && grantedBone > 0) milestoneNotices.push(`+${grantedBone} Bone Charms`);
            if (milestoneIsNew && grantedFate > 0) milestoneNotices.push(`+${grantedFate} Fate Shards`);
            const updatedRun: EndlessTowerRun = {
                ...prevRun,
                wave: nextWave,
                bankedRyo: prevRun.bankedRyo + reward.ryo,
                bankedXp: prevRun.bankedXp + reward.xp,
                highestMilestoneClaimed: milestoneIsNew ? currentWave : alreadyClaimed,
            };
            // 10-kill rest stop: top HP up by 33% and refill 50% of
            // chakra/stamina. Stacks with the wave's regular HP carry —
            // we just bump current vitals (capped at max).
            const healHp = isHealMilestone ? Math.floor((current.maxHp ?? 0) * 0.33) : 0;
            const refillChakra = isHealMilestone ? Math.floor((current.maxChakra ?? 0) * 0.5) : 0;
            const refillStamina = isHealMilestone ? Math.floor((current.maxStamina ?? 0) * 0.5) : 0;
            if (isHealMilestone) milestoneNotices.push("33% HP heal · 50% chakra & stamina refill");
            return {
                ...current,
                totalEndlessTowerWins: (current.totalEndlessTowerWins ?? 0) + 1,
                endlessTowerBestWave: Math.max(current.endlessTowerBestWave ?? 0, currentWave),
                endlessTowerRun: updatedRun,
                boneCharms: (current.boneCharms ?? 0) + grantedBone,
                fateShards: (current.fateShards ?? 0) + grantedFate,
                hp: Math.min(current.maxHp ?? 0, Math.max(0, (current.hp ?? 0) + healHp)),
                chakra: Math.min(current.maxChakra ?? 0, Math.max(0, (current.chakra ?? 0) + refillChakra)),
                stamina: Math.min(current.maxStamina ?? 0, Math.max(0, (current.stamina ?? 0) + refillStamina)),
            };
        });
        if (milestoneNotices.length > 0) {
            // Defer the alert so the state update commits first — otherwise
            // the next render that React queues can flicker the pre-credit
            // values into the milestone toast.
            setTimeout(() => alert(`⭐ ${currentWave}-Kill Milestone! ${milestoneNotices.join(" · ")}.`), 30);
        }
        const next = currentWave + 1;
        setEndlessBattleWave(next);
        setPendingAiProfileId(pickRandomEndlessAi(next));
        setArenaKey(k => k + 1);
    }

    // Called when the player loses — banked rewards are lost on death.
    function endEndlessBattle() {
        setEndlessBattleActive(false);
        setEndlessBattleWave(0);
        setTemporaryStoryAi(null);
        setCharacter((current) => current ? { ...current, endlessTowerRun: null } : current);
    }

    // Retreat & bank: convert banked ryo/xp into actual progress, clear the run.
    function bankEndlessRewards() {
        if (!character) return;
        const run = character.endlessTowerRun;
        if (!run || (run.bankedRyo === 0 && run.bankedXp === 0)) {
            setEndlessBattleActive(false);
            setEndlessBattleWave(0);
            setTemporaryStoryAi(null);
            setCharacter({ ...character, endlessTowerRun: null });
            return;
        }
        // Credit via gainXp + daily tower-XP soft cap (a raw xp+= would be clamped
        // away by the new curve, and uncapped tower XP would bypass the level curve).
        setCharacter(applyTowerCashOut(character, run, currentDateKey(), gainXp));
        setEndlessBattleActive(false);
        setEndlessBattleWave(0);
        setTemporaryStoryAi(null);
    }

    // ── Endless-tower context persistence (battle-lock resume) ──────────
    // Mirror the live endless wave/flag + scaled enemy to localStorage so a
    // refresh can rebuild the fight (the combat snapshot itself is saved by
    // ArenaBattlePersister). Cleared the moment the run ends. data:image strings
    // are stripped so a big enemy portrait can't blow the localStorage quota.
    useEffect(() => {
        const name = character?.name;
        if (!name) return;
        const key = endlessCtxKey(name);
        try {
            if (endlessBattleActive && temporaryStoryAi) {
                const stripImages = (_k: string, v: unknown) => (typeof v === "string" && v.startsWith("data:image") ? "" : v);
                const ctx = { wave: endlessBattleWave, aiId: pendingAiProfileId, ai: temporaryStoryAi, savedAt: Date.now() };
                localStorage.setItem(key, JSON.stringify(ctx, stripImages));
            } else {
                localStorage.removeItem(key);
            }
        } catch { /* quota / SSR — ignore */ }
    }, [endlessBattleActive, endlessBattleWave, temporaryStoryAi, pendingAiProfileId, character?.name]);

    // ── Arena story-fight context persistence (battle-lock resume) ──────
    // Same idea as endless, for every pendingArenaStoryBattle fight (weekly
    // boss / dungeon-AI / arena story boss / triggered event / hollow-gate
    // arena). Persisted only while the fight is actually on the arena screen.
    useEffect(() => {
        const name = character?.name;
        if (!name) return;
        const key = arenaStoryCtxKey(name);
        try {
            if (pendingArenaStoryBattle && screen === "arena") {
                const stripImages = (_k: string, v: unknown) => (typeof v === "string" && v.startsWith("data:image") ? "" : v);
                const ctx = { battle: pendingArenaStoryBattle, aiId: pendingAiProfileId, ai: temporaryStoryAi, savedAt: Date.now() };
                localStorage.setItem(key, JSON.stringify(ctx, stripImages));
            } else {
                localStorage.removeItem(key);
            }
        } catch { /* quota / SSR — ignore */ }
    }, [pendingArenaStoryBattle, temporaryStoryAi, pendingAiProfileId, screen, character?.name]);

    // ── Back-navigation history capture ─────────────────────────────────
    // Pushes the current screen onto a capped 20-deep stack whenever it
    // changes, EXCEPT during a back-navigation (the ref short-circuits the
    // push so we don't immediately re-record the screen we just popped).
    // "start" resets history — login means a fresh session.
    useEffect(() => {
        if (isGoingBackRef.current) {
            isGoingBackRef.current = false;
            return;
        }
        if (screen === "start") {
            setScreenHistory([]);
            return;
        }
        setScreenHistory(prev => {
            const last = prev[prev.length - 1];
            if (last === screen) return prev; // dedupe consecutive
            return [...prev.slice(-19), screen];
        });
    }, [screen]);

    const canGoBack = screenHistory.length > 1;

    // "In an unresolved fight" snapshot for the nav lock (isUnresolvedBattle in
    // lib/screen-guards), kept in a ref so navigate()/goBack() read the latest.
    // Battle screens drive their own exits, so this mainly blocks the global bar.
    const inBattleRef = useRef(false);
    useEffect(() => {
        inBattleRef.current = isUnresolvedBattle({
            screen, raidBattleKind, pvpBattleId, endlessBattleActive, arenaBattleActive, petBattleActive,
            pendingArenaStoryBattle: !!pendingArenaStoryBattle, pendingEventEncounter: !!pendingEventEncounter,
            activeDungeonEvent: !!activeDungeonEvent, hollowGateTileGameActive, pendingPetBattle: !!pendingPetBattleOpponent,
        });
    }, [screen, raidBattleKind, pvpBattleId, endlessBattleActive, pendingArenaStoryBattle, pendingEventEncounter, activeDungeonEvent, hollowGateTileGameActive, pendingPetBattleOpponent, arenaBattleActive, petBattleActive]);

    // Pop history and navigate to the previous screen. The same locks as
    // navigate() apply — can't back-out of an active battle or hospital
    // admission.
    const goBack = useCallback(() => {
        if (inBattleRef.current) {
            alert("⚔️ You cannot leave during a battle. Finish the fight first!");
            return;
        }
        if (character?.hospitalized && screen === "hospital") {
            alert("🏥 You're still admitted — pay the discharge fee to be released now, or wait for the free check-out timer.");
            return;
        }
        setScreenHistory(prev => {
            if (prev.length <= 1) { setScreen("village"); return prev; }
            const target = prev[prev.length - 2];
            isGoingBackRef.current = true;
            setScreen(target);
            return prev.slice(0, -1);
        });
    }, [raidBattleKind, character?.hospitalized, screen]);

    // Stable identities for the memo'd RightMenu/MobileNav: navigate/logoutPlayer get a
    // fresh identity each render, defeating their memo. These latest-ref wrappers delegate
    // to the current fn — stable identity, no stale closure, behavior identical.
    const navigateRef = useRef(navigate);
    navigateRef.current = navigate;
    const stableNavigate = useCallback((nextScreen: Screen) => navigateRef.current(nextScreen), []);
    const logoutPlayerRef = useRef(logoutPlayer);
    logoutPlayerRef.current = logoutPlayer;
    const stableLogout = useCallback(() => logoutPlayerRef.current(), []);

    function navigate(nextScreen: Screen) {
        // Lock: cannot leave during an active battle (any type — isUnresolvedBattle).
        if (inBattleRef.current) {
            alert("⚔️ You cannot leave during a battle. Finish the fight first!");
            return;
        }
        // Lock: cannot leave hospital while still admitted
        if (character?.hospitalized && screen === "hospital" && nextScreen !== "hospital") {
            alert("🏥 You're still admitted — pay the discharge fee to be released now, or wait for the free check-out timer.");
            return;
        }
        // (Hollow Gate "no retreat" lock now lives in isUnresolvedBattle.)
        // Hospital admission timer is server-authoritative (character.hospitalizedUntil,
        // read by the Hospital screen) — no client entry-time stamp needed here.
        if (character && nextScreen === "battleArena") {
            const event = creatorEvents.find(
                (candidate) =>
                    candidate.eventKind === "visualNovel" &&
                    candidate.trigger === "firstBattleArena" &&
                    !triggeredEvents.includes(candidate.id) &&
                    character.level >= candidate.levelReq
            );

            if (event) {
                setTriggeredEvents((ids) => [...ids, event.id]);
                setActiveTriggeredEvent(event);
                setActiveTriggerReturnScreen("battleArena");
                setTriggerPage(0);
                setTriggerLine(0);
                return;
            }
        }

        if (character && screen === "village" && nextScreen !== "village") {
            // Built-in: Awakening Stone VN fires first time leaving village at level 2+
            if (character.level >= 2 && !triggeredEvents.includes(AWAKENING_VN_ID)) {
                setTriggeredEvents((ids) => [...ids, AWAKENING_VN_ID]);
                setActiveTriggeredEvent(creatorEvents.find(e => e.id === AWAKENING_VN_ID) ?? awakeningLv2VnEvent);
                setActiveTriggerReturnScreen(nextScreen);
                setTriggerPage(0);
                setTriggerLine(0);
                return;
            }

            const event = creatorEvents.find(
                (candidate) =>
                    candidate.eventKind === "visualNovel" &&
                    candidate.trigger === "firstLeaveVillage" &&
                    !triggeredEvents.includes(candidate.id) &&
                    character.level >= candidate.levelReq
            );

            if (event) {
                setTriggeredEvents((ids) => [...ids, event.id]);
                setActiveTriggeredEvent(event);
                setActiveTriggerReturnScreen(nextScreen);
                setTriggerPage(0);
                setTriggerLine(0);
                return;
            }
        }

        if (nextScreen === "worldMap") setWorldMapKey((k) => k + 1);
        setScreen(nextScreen);
    }

    function completeTriggeredEvent(event: CreatorEvent) {
        if (character) {
            const leveled = gainXp(character, event.xpReward);
            const isRewardEvent = event.eventKind !== "visualNovel";
            const rewardInventory = event.id === AURA_SPHERE_VN_ID && !leveled.inventory.includes(AURA_SPHERE_ITEM_ID) && !Object.values(leveled.equipment).includes(AURA_SPHERE_ITEM_ID)
                ? [...leveled.inventory, AURA_SPHERE_ITEM_ID]
                : leveled.inventory;
            let nextCharacter: Character = {
                ...applyCurrencyRewards(leveled, event.currencyRewards),
                ryo: leveled.ryo + event.ryoReward,
                stamina: Math.min(leveled.maxStamina, leveled.stamina + event.staminaReward),
                clanEventContrib: (leveled.clanEventContrib ?? 0) + (isRewardEvent ? 1 : 0),
                clanContribMonth: new Date().toISOString().slice(0, 7),
                inventory: rewardInventory,
            };
            if (event.kageFinale && event.village === character.village) {
                unlockVillageKageSystem(character.village, character.name);
                nextCharacter = {
                    ...nextCharacter,
                    storyTitle: event.liberatorTitle ?? nextCharacter.storyTitle,
                    rankTitle: event.liberatorTitle ?? nextCharacter.rankTitle,
                };
                alert(`The false Kage of ${character.village} has fallen. ${character.name} has broken the Hollow Gate Pact. The Kage seat is now open.`);
            }
            setCharacter(nextCharacter);
        }

        setActiveTriggeredEvent(null);
        setScreen(activeTriggerReturnScreen);
    }

    function dungeonEventTemplate() {
        return creatorEvents.find((event) => event.id === DUNGEON_VN_ID) ?? hiddenDungeonVnEvent;
    }

    function triggerDungeonEncounter(returnScreen: Screen = "worldMap", dungeonOverride?: CreatorEvent) {
        if (!character) return;
        const event = dungeonOverride ?? dungeonEventTemplate();
        if (character.level < event.levelReq) return;
        // The explore-tile Hidden Dungeon (no override) is free to enter; only the
        // Central Hub relic dungeons (passed as an override) stay gated behind a key.
        if (dungeonOverride) {
            if (!ownsItem(character, DUNGEON_KEY_ID)) return alert("You need a Dungeon Key to open this relic dungeon.");
            setCharacter(removeItem(character, DUNGEON_KEY_ID, 1));
        }
        setActiveDungeonEvent(event);
        setDungeonStage("intro");
        setDungeonPage(0);
        setDungeonLine(0);
        setDungeonReturnScreen(returnScreen);
        setScreen("dungeon");
    }

    function startDungeonAiFight() {
        if (!character || !activeDungeonEvent) return;
        const level = [50, 75, 100][Math.floor(Math.random() * 3)];
        // L100 dungeon warden is peer-band (uncapped burst); 0.55 toughness pushed
        // it to ~22.7k HP — a kage-style unwinnable grind. 0.15 lands it ~16.8k
        // (armor barely moves — it's near the DR clamp at L100). L75/L50 are
        // hard-band and stay as-is.
        const toughness = level === 100 ? 0.15 : level === 75 ? 0.42 : 0.30;
        const statBoost = level === 100 ? 230 : level === 75 ? 175 : 130;
        const dungeonJutsus = starterJutsus
            .filter((jutsu) => jutsu.ap >= 40)
            .slice(level === 100 ? 8 : level === 75 ? 6 : 4, level === 100 ? 14 : level === 75 ? 12 : 10);
        const armorRawDR = aiRawDamageReductionForLevel(level, toughness);
        const dungeonLoadoutId: AiLoadoutId = level === 100 ? "boss" : level === 75 ? "control" : "defender";
        const aiProfileId = `temp-dungeon-ai-${level}-${Date.now()}`;
        // Admin-uploaded warden portrait wins if present, falling back to the
        // event's static avatar/scene art. Key shape mirrors the rest of the
        // event-asset overlay system used by the Visual Novel editor.
        const wardenImage = sharedImages[`event:${activeDungeonEvent.id}:warden`]
            || activeDungeonEvent.avatarImage
            || activeDungeonEvent.image;
        setTemporaryStoryAi({
            id: aiProfileId,
            name: level === 100 ? "Abyssal Dungeon Warden" : level === 75 ? "Sealed Dungeon Warden" : "Dungeon Warden",
            icon: "DG",
            image: wardenImage,
            level,
            village: "Hidden Dungeon",
            hp: aiHpForLevel(level, toughness),
            chakra: Math.floor(maxChakraForLevel(level) * 1.8),
            stamina: Math.floor(maxStaminaForLevel(level) * 1.8),
            stats: addToAllStats(aiStatsForLevel(level, dungeonJutsus), statBoost),
            armorRawDR,
            armorFactor: aiArmorFactorFromRaw(armorRawDR),
            loadoutId: dungeonLoadoutId,
            jutsuIds: dungeonJutsus.map((jutsu) => jutsu.id),
            rules: buildBasicCombatAiRules(dungeonJutsus, dungeonLoadoutId),
        });
        setPendingPvpOpponent(null);
        setRaidBattleKind("none");
        setPendingArenaStoryBattle({ kind: "dungeonAi", returnScreen: "dungeon" });
        setPendingAiProfileId(aiProfileId);
        setCurrentBiome(activeDungeonEvent.biome);
        setCurrentWeather(weatherForBiome(activeDungeonEvent.biome));
        setArenaKey((key) => key + 1);
        setScreen("arena");
    }

    // Onboarding "guaranteed first win" — launch a scripted spar against a
    // deliberately weak Lv-1 training dummy via the existing story-battle infra
    // (temporaryStoryAi + pendingArenaStoryBattle). The dummy has tiny HP and
    // Lv-1 offense, so a new player (who spawns combat-ready with 3 bloodline
    // jutsu) wins in a few hits. The win advances onboardingStep → "training" in
    // completePendingArenaStoryBattle; a loss just returns to the village and
    // re-prompts. Fully client-side (AI fight) — no server/PvP path.
    function startAcademySparringMatch() {
        if (!character) return;
        const sparLevel = 1;
        // A couple of weak basic jutsu so the dummy pokes back (teaches that
        // enemies act), but Lv-1 stats mean it can't threaten the player.
        const sparJutsus = aiJutsuLoadout("balanced", starterJutsus).slice(0, 2);
        const sparAiId = `temp-academy-spar-${Date.now()}`;
        const sparBiome = villageBiomeMap[character.village] ?? "central";
        setTemporaryStoryAi({
            id: sparAiId,
            name: "Academy Training Dummy",
            icon: "🎯",
            level: sparLevel,
            village: character.village,
            hp: 50, // deliberately tiny — falls in a few hits for a sub-60s first win
            chakra: maxChakraForLevel(sparLevel),
            stamina: maxStaminaForLevel(sparLevel),
            stats: aiStatsForLevel(sparLevel, sparJutsus),
            armorRawDR: 0,
            armorFactor: aiArmorFactorFromRaw(0),
            loadoutId: "balanced",
            jutsuIds: sparJutsus.map((jutsu) => jutsu.id),
            rules: buildBasicCombatAiRules(sparJutsus, "balanced"),
        });
        setPendingPvpOpponent(null);
        setRaidBattleKind("none");
        setPendingArenaStoryBattle({ kind: "academySparring", returnScreen: "village" });
        setPendingAiProfileId(sparAiId);
        setCurrentBiome(sparBiome);
        setCurrentWeather(weatherForBiome(sparBiome));
        setArenaKey((key) => key + 1);
        setScreen("arena");
    }

    function leaveDungeon() {
        setActiveDungeonEvent(null);
        setDungeonStage("intro");
        setDungeonPage(0);
        setDungeonLine(0);
        setTemporaryStoryAi(null);
        setPendingArenaStoryBattle(null);
        setPendingAiProfileId("");
        setScreen(dungeonReturnScreen);
    }

    // Loss path for the dungeon Warden fight. Without this the player
    // gets sent to Hospital with activeDungeonEvent still set, then
    // returning to the dungeon screen drops them back at the intro VN
    // with no usable progression (the key was already consumed). Clears
    // all dungeon state and routes them to their village.
    function failDungeon() {
        if (!character) return;
        setActiveDungeonEvent(null);
        setDungeonStage("intro");
        setDungeonPage(0);
        setDungeonLine(0);
        setTemporaryStoryAi(null);
        setPendingArenaStoryBattle(null);
        setPendingAiProfileId("");
        alert("The dungeon seal rejected you. Your Dungeon Key was consumed. You return to your village empty-handed.");
        setScreen("village");
    }

    function completeDungeon() {
        if (!character || !activeDungeonEvent) return;
        const rewarded = addInventoryItems(applyCurrencyRewards(character, activeDungeonEvent.currencyRewards), [DUNGEON_LEGENDARY_RELIC_ID]);
        setCharacter(rewarded);
        alert(`${activeDungeonEvent.name} cleared. +10 Bone Charms, +5 Aura Stones, +5 Fate Shards, +1 Dungeon Legendary Relic.`);
        setActiveDungeonEvent(null);
        setDungeonStage("complete");
        setScreen(dungeonReturnScreen);
    }

    // ── Weekly Boss arena launch ─────────────────────────────────────────────
    // Spawns the admin-picked weekly boss AI as a temporary opponent with a
    // sentinel HP value (effectively unkillable). The player fights until
    // KO/flee — at that point logWeeklyBossFightDamage() POSTs the damage
    // dealt to /api/weekly-boss so it lands on the shared leaderboard.
    const WEEKLY_BOSS_SENTINEL_HP = 99_999_999;
    function launchWeeklyBossFight(bossAiId: string, bossDisplayName?: string) {
        if (!character) return;
        const bossAi = playableAis.find(ai => ai.id === bossAiId);
        if (!bossAi) {
            alert("Couldn't find the weekly boss AI. An admin needs to set or re-set the override.");
            return;
        }
        if ((character.stamina ?? 0) < 20) {
            alert("You need at least 20 stamina to challenge the weekly boss.");
            return;
        }
        const tempId = `temp-weekly-boss-${Date.now()}`;
        // Copy the picked AI but force HP to the sentinel value so the
        // arena can never reduce it to 0. The boss is meant to outlast
        // the player every time — damage dealt is what matters.
        setTemporaryStoryAi({
            ...bossAi,
            id: tempId,
            name: bossDisplayName || bossAi.name,
            hp: WEEKLY_BOSS_SENTINEL_HP,
            isBossAi: true,
        });
        setPendingPvpOpponent(null);
        setRaidBattleKind("none");
        setPendingArenaStoryBattle({
            kind: "weeklyBoss",
            returnScreen: "weeklyBoss",
            bossInitialHp: WEEKLY_BOSS_SENTINEL_HP,
        });
        setPendingAiProfileId(tempId);
        // Weekly boss fight uses central neutral terrain — matches the
        // ranked-fight convention of no biome bias for shared content.
        setCurrentBiome("central");
        setCurrentWeather(weatherForBiome("central"));
        setArenaKey((key) => key + 1);
        setScreen("arena");
    }

    async function logWeeklyBossFightDamage(damageDealt: number) {
        if (!character || damageDealt < 0) return;
        try {
            const r = await fetch("/api/weekly-boss", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: "logFight", amount: Math.floor(damageDealt) }),
            });
            const data = await r.json();
            if (!r.ok) {
                // Surface server-side rejection (locked out / despawned) but
                // still proceed with the post-fight transition so the player
                // isn't trapped in the arena.
                console.warn("[weekly-boss] logFight rejected:", data?.error);
                alert(data?.error ?? "Failed to log weekly boss damage.");
            } else {
                const dealt = data?.dealt ?? Math.floor(damageDealt);
                const used = data?.attemptsUsed ?? 0;
                alert(`Damage logged: ${dealt.toLocaleString()} added to the leaderboard. Attempts used: ${used}/3.`);
            }
        } catch (err) {
            console.warn("[weekly-boss] logFight error:", err);
        } finally {
            setPendingArenaStoryBattle(null);
            setTemporaryStoryAi(null);
            setPendingAiProfileId("");
            setScreen("weeklyBoss");
        }
    }

    function startStoryArenaBattle(step: StoryStep) {
        setTemporaryStoryAi(null);
        setPendingPvpOpponent(null);
        setRaidBattleKind("none");
        setPendingArenaStoryBattle({ kind: "storyBoss", step, returnScreen: "storyHall" });
        setPendingAiProfileId(step.aiProfileId ?? "");
        setCurrentBiome(step.biome ?? villageBiomeMap[character?.village ?? ""] ?? "central");
        setCurrentWeather(weatherForBiome(step.biome ?? villageBiomeMap[character?.village ?? ""] ?? "central"));
        setArenaKey((key) => key + 1);
        setScreen("arena");
    }

    function startTriggeredEventArenaBattle(
        event: CreatorEvent,
        battle?: NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>[number]["battle"]
    ) {
        if (battle?.encounterType === "pet") {
            setPendingEventEncounter({ event, battle });
            setActiveTriggeredEvent(null);
            setScreen("eventPetBattle");
            return;
        }
        if (battle?.encounterType === "tiles") {
            setPendingEventEncounter({ event, battle });
            setActiveTriggeredEvent(null);
            setScreen("eventTiles");
            return;
        }
        let aiProfileId = battle?.aiProfileId || event.aiProfileId || "";
        if (!aiProfileId && battle) {
            aiProfileId = `temp-vn-ai-${event.id}-${Date.now()}`;
            const level = Math.max(1, character?.level ?? event.levelReq ?? 1);
            const eventJutsus = starterJutsus.slice(0, 4);
            const toughness = battle.bossHp ? 0.25 : 0.12;
            const armorRawDR = aiRawDamageReductionForLevel(level, toughness);
            const vnLoadoutId: AiLoadoutId = battle.bossHp ? "boss" : "balanced";
            const vnRules = buildBasicCombatAiRules(eventJutsus, vnLoadoutId);
            setTemporaryStoryAi({
                id: aiProfileId,
                name: battle.bossName || event.name,
                icon: battle.bossIcon || event.icon || "AI",
                image: event.avatarImage || event.image,
                level,
                village: event.village || "AI",
                hp: Math.max(battle.bossHp || 0, aiHpForLevel(level, toughness)),
                chakra: maxChakraForLevel(level),
                stamina: maxStaminaForLevel(level),
                stats: addToAllStats(aiStatsForLevel(level, eventJutsus), Math.floor(level * 0.8)),
                armorRawDR,
                armorFactor: aiArmorFactorFromRaw(armorRawDR),
                loadoutId: vnLoadoutId,
                jutsuIds: eventJutsus.map((jutsu) => jutsu.id),
                rules: vnRules,
            });
        } else {
            setTemporaryStoryAi(null);
        }
        setPendingPvpOpponent(null);
        setRaidBattleKind("none");
        setPendingArenaStoryBattle({ kind: "triggeredEvent", event, battle, returnScreen: activeTriggerReturnScreen });
        setPendingAiProfileId(aiProfileId);
        setCurrentBiome(event.biome);
        setCurrentWeather(weatherForBiome(event.biome));
        setActiveTriggeredEvent(null);
        setArenaKey((key) => key + 1);
        setScreen("arena");
    }

    function completePendingArenaStoryBattle(survivingHp: number) {
        if (!pendingArenaStoryBattle || !character) return "Story battle complete.";

        if (pendingArenaStoryBattle.kind === "storyBoss") {
            const { step } = pendingArenaStoryBattle;
            const leveled = gainXp({ ...character, hp: survivingHp }, step.rewardXp);
            let nextCharacter: Character = {
                ...leveled,
                ryo: leveled.ryo + step.rewardRyo,
                auraDust: (leveled.auraDust ?? 0) + 12,
                hp: Math.min(leveled.maxHp, survivingHp + 25),
                stamina: Math.min(leveled.maxStamina, leveled.stamina + 20),
                chakra: Math.min(leveled.maxChakra, leveled.chakra + 20),
                storyProgress: character.storyProgress + 1,
                clanBattleContrib: (leveled.clanBattleContrib ?? 0) + 1,
                clanContribMonth: new Date().toISOString().slice(0, 7),
            };
            if (step.kageFinale) {
                unlockVillageKageSystem(character.village, character.name);
                // Story finale grants a Hollow Gate Key — a personal shrine pass
                // that bypasses the village unlock and the daily run cap.
                nextCharacter = addInventoryItems({
                    ...nextCharacter,
                    storyTitle: step.liberatorTitle ?? nextCharacter.storyTitle,
                    rankTitle: step.liberatorTitle ?? nextCharacter.rankTitle,
                }, [HOLLOW_GATE_KEY_ID]);
            }
            setCharacter(nextCharacter);
            setPendingAiProfileId("");
            return `${step.bossName} defeated. +${effectiveCharacterXpGain(character, step.rewardXp)} XP, +${step.rewardRyo} ryo, +12 Aura Dust${step.kageFinale ? ", +1 Hollow Gate Key" : ""}. Story advanced.`;
        }

        if (pendingArenaStoryBattle.kind === "dungeonAi") {
            setCharacter({ ...character, hp: Math.min(character.maxHp, survivingHp + 50) });
            setDungeonStage("tile");
            setTemporaryStoryAi(null);
            setPendingAiProfileId("");
            return "Dungeon Warden defeated. The second seal opens: win the shinobi tile game to continue.";
        }

        if (pendingArenaStoryBattle.kind === "academySparring") {
            // First-win dopamine: modest one-time XP/ryo + full heal, then go train.
            const SPAR_XP = 60;
            const leveled = gainXp({ ...character, hp: survivingHp }, SPAR_XP);
            setCharacter({
                ...leveled,
                ryo: leveled.ryo + 30,
                hp: leveled.maxHp,
                stamina: leveled.maxStamina,
                chakra: leveled.maxChakra,
                onboardingStep: "training",
            });
            setTemporaryStoryAi(null);
            setPendingAiProfileId("");
            return `Sparring match won! You bested the Academy training dummy. +${effectiveCharacterXpGain(character, SPAR_XP)} XP, +30 ryo. Time to start your training.`;
        }

        if (pendingArenaStoryBattle.kind === "hollowGateShrine") {
            const isBoss = pendingArenaStoryBattle.isBoss;
            const isAmbush = pendingArenaStoryBattle.isAmbush;
            // Reward scales with role AND with floor depth for bosses.
            //   Boss multiplier (tunable HOLLOW_GATE_BOSS_FLOOR_REWARD_MULT):
            //   floor 1 = 1.0, floor 5 with default 0.2 = 1.8 (per-floor +0.2)
            const runFloor = hollowGateRun?.floor ?? 1;
            const bossFloorMult = isBoss ? 1 + Math.max(0, runFloor - 1) * HOLLOW_GATE_BOSS_FLOOR_REWARD_MULT : 1;
            const xpReward = Math.floor((isBoss ? 600 : isAmbush ? 220 : 140) * bossFloorMult);
            const ryoReward = Math.floor((isBoss ? 2400 : isAmbush ? 900 : 380) * bossFloorMult);
            const auraDustReward = Math.floor((isBoss ? 30 : isAmbush ? 10 : 5) * bossFloorMult);
            const honorReward = Math.floor((isBoss ? 25 : 0) * bossFloorMult);
            const bossShards = isBoss ? hollowShardDrop(runFloor, "boss") : 0;
            const leveled = gainXp({ ...character, hp: survivingHp }, xpReward);
            // Boss drops a Dungeon Legendary Fragment + Hollow Shards; both boss
            // and non-boss wins restore some HP (boss is a roadblock, not a death).
            let nextCharacter: Character = {
                ...leveled,
                ryo: leveled.ryo + ryoReward,
                auraDust: (leveled.auraDust ?? 0) + auraDustReward,
                honorSeals: (leveled.honorSeals ?? 0) + vanguardOnlyHonorSeals(leveled, honorReward),
                boneCharms: (leveled.boneCharms ?? 0) + nonVanguardCharmSubstitute(leveled, honorReward),
                fateShards: (leveled.fateShards ?? 0) + nonVanguardShardSubstitute(leveled, honorReward),
                hollowShards: (leveled.hollowShards ?? 0) + bossShards,
                hp: Math.min(leveled.maxHp, survivingHp + (isBoss ? 60 : 20)),
            };
            if (isBoss) {
                nextCharacter = addInventoryItems(nextCharacter, [DUNGEON_LEGENDARY_FRAGMENT_ID]);
                nextCharacter = {
                    ...nextCharacter,
                    hollowGateWardenKills: (nextCharacter.hollowGateWardenKills ?? 0) + 1,
                };
            }
            setCharacter(nextCharacter);
            setTemporaryStoryAi(null);
            setPendingAiProfileId("");
            onHollowGateBattleWin();
            return isBoss
                ? `Hollow Gate Warden defeated. +${effectiveCharacterXpGain(character, xpReward)} XP, +${ryoReward} ryo, +${auraDustReward} Aura Dust, +${honorReward} Honor Seals, +${bossShards} Hollow Shards, +1 Dungeon Legendary Fragment.`
                : `Corrupted shinobi defeated. +${effectiveCharacterXpGain(character, xpReward)} XP, +${ryoReward} ryo, +${auraDustReward} Aura Dust.`;
        }

        if (pendingArenaStoryBattle.kind === "weeklyBoss") {
            // Weekly Boss fights are designed to be unwinnable — the boss
            // is spawned with a sentinel HP (~100M) so the player can only
            // KO or flee, never deal a finishing blow. If somehow the win
            // path fires (e.g. boss damage cap regression, save edit) we
            // just bail without granting story rewards — the logFight call
            // on the loss/flee path is what credits the leaderboard.
            setTemporaryStoryAi(null);
            setPendingAiProfileId("");
            return "Weekly Boss collapsed unexpectedly. Damage logged on your next attempt.";
        }

        const { event, battle } = pendingArenaStoryBattle;
        const xpReward = battle?.xpReward ?? event.xpReward;
        const ryoReward = battle?.ryoReward ?? event.ryoReward;
        const leveled = gainXp({ ...character, hp: survivingHp }, xpReward);
        const isRewardEvent = event.eventKind !== "visualNovel";
        const rewardInventory = event.id === AURA_SPHERE_VN_ID && !leveled.inventory.includes(AURA_SPHERE_ITEM_ID) && !Object.values(leveled.equipment).includes(AURA_SPHERE_ITEM_ID)
            ? [...leveled.inventory, AURA_SPHERE_ITEM_ID]
            : leveled.inventory;
        let nextCharacter: Character = {
            ...applyCurrencyRewards(leveled, event.currencyRewards),
            ryo: leveled.ryo + ryoReward,
            stamina: Math.min(leveled.maxStamina, leveled.stamina + event.staminaReward),
            clanEventContrib: (leveled.clanEventContrib ?? 0) + (isRewardEvent ? 1 : 0),
            clanBattleContrib: (leveled.clanBattleContrib ?? 0) + 1,
            clanContribMonth: new Date().toISOString().slice(0, 7),
            inventory: rewardInventory,
        };
        if (event.kageFinale && event.village === character.village) {
            unlockVillageKageSystem(character.village, character.name);
            // Story finale grants a Hollow Gate Key — a personal shrine pass.
            nextCharacter = addInventoryItems({
                ...nextCharacter,
                storyTitle: event.liberatorTitle ?? nextCharacter.storyTitle,
                rankTitle: event.liberatorTitle ?? nextCharacter.rankTitle,
            }, [HOLLOW_GATE_KEY_ID]);
        }
        // Story chapter battles (triggered via auto-VN) must advance storyProgress just
        // like kind:"storyBoss" does. The event id always starts with "story-" for these.
        const isStoryChapterBattle = event.id.startsWith("story-");
        if (isStoryChapterBattle) {
            nextCharacter = {
                ...nextCharacter,
                storyProgress: character.storyProgress + 1,
                auraDust: (nextCharacter.auraDust ?? 0) + 12,
                hp: Math.min(nextCharacter.maxHp, survivingHp + 25),
                stamina: Math.min(nextCharacter.maxStamina, nextCharacter.stamina + 20),
                chakra: Math.min(nextCharacter.maxChakra, nextCharacter.chakra + 20),
            };
        }
        setCharacter(nextCharacter);
        setPendingAiProfileId("");
        const displayedXpReward = effectiveCharacterXpGain(character, xpReward);
        const kageFinaleBonus = event.kageFinale && event.village === character.village ? ", +1 Hollow Gate Key" : "";
        return isStoryChapterBattle
            ? `${battle?.bossName ?? event.name} defeated. +${displayedXpReward} XP, +${ryoReward} ryo, +12 Aura Dust${kageFinaleBonus}. Story advanced.`
            : `${battle?.bossName ?? event.name} defeated. +${displayedXpReward} XP, +${ryoReward} ryo${kageFinaleBonus}. Event reward claimed.`;
    }

    function continuePendingArenaStoryBattle() {
        const pending = pendingArenaStoryBattle;
        const returnScreen = pending?.returnScreen ?? "storyHall";
        setPendingArenaStoryBattle(null);
        setTemporaryStoryAi(null);
        setPendingAiProfileId("");
        // Battle KO: a Second Wind (if armed) revives at half HP and the run continues; else claw back the haul, clear the run, forfeit the Key.
        if (pending?.kind === "hollowGateShrine" && character && (character.hospitalized || character.hp <= 0)) {
            const deadRun = hollowGateRun;
            const wind = deadRun ? tryHollowGateSecondWind(deadRun, character) : null;
            if (wind) {
                setHollowGateRun(wind.run);
                setCharacter({ ...wind.character, hollowGateRun: wind.run });
                pushHollowGateLog(wind.log);
            } else {
                setHollowGateRun(null);
                setHollowGateEvent(null);
                setHollowGateHiddenChamber(null);
                setHollowGateLog([]);
                if (character) finalizeHollowGateRunEnd({ run: deadRun, outcome: "death", character, lootRetention: attunementLootRetention(character), setCharacter });
                setScreen("hospital"); // run cleared → the shrine would render blank, so send the downed delver to the hospital, not the empty Gate
                return;
            }
        }
        setScreen(returnScreen);
    }

    // ── Hollow Gate Shrine — actions ──────────────────────────────────────────
    function pushHollowGateLog(line: string) {
        setHollowGateLog(prev => [line, ...prev].slice(0, 30));
    }
    function isActivePetEligibleForHollowGate(): boolean {
        if (!character) return false;
        const pet = character.pets?.find(p => p.id === character.activePetId);
        if (!pet) return false;
        if (isPetOnExpedition(pet)) return false;
        return Boolean(pet.unlockedForPve);
    }
    async function enterHollowGateShrine() {
        if (!character) return;
        // Restore an in-progress run, if any. Resuming a run is always free —
        // the key was already consumed when the run was started. The Character
        // normalizer resets daily counters at midnight UTC.
        if (character.hollowGateRun && !character.hollowGateRun.completed) {
            setHollowGateRun(character.hollowGateRun);
            setHollowGateLog(prev => prev.length ? prev : ["You return to your unfinished run. The Hollow Gate echoes have not forgotten you."]);
            setHollowGateEvent(null);
            setHollowGateHiddenChamber(null);
            setCurrentBiome("shadow");
            setCurrentWeather(weatherForBiome("shadow"));
            setScreen("hollowGateShrine");
            // Refreshed mid-pick? re-present the augment picker (never re-mints the token).
            resumeHollowGateServerRun({ playerName: character.name, run: character.hollowGateRun, setRun: setHollowGateRun, setCharacter, setEvent: setHollowGateEvent, pushLog: pushHollowGateLog });
            return;
        }

        // Entry rules — BOTH conditions required to start a new run:
        //   (1) The Kage has purchased the Hollow Gate upgrade for this village.
        //   (2) The player owns a Hollow Gate Key, which is consumed on entry.
        const village = loadVillageState(character.village);
        if (!isHollowGateUnlocked(village)) {
            alert("The Hollow Gate seal is still bound. Your village Kage must purchase the Hollow Gate upgrade from the Town Hall before anyone can enter.");
            return;
        }
        const ownedKeys = countItem(character, HOLLOW_GATE_KEY_ID);
        if (ownedKeys <= 0) {
            alert("You need a Hollow Gate Key to enter the shrine. Forge one at the Crafter (5 Dungeon Keys or 10 Fate Shards), or complete your village story.");
            return;
        }
        // Daily run cap — hard-capped at 2 regardless of key inventory. The
        // shrine itself refuses to open more than twice between dawns.
        // Counter is reset when lastDailyReset != today.
        const todayKey = currentDateKey();
        const runsToday = character.lastDailyReset === todayKey ? (character.dailyHollowGateRuns ?? 0) : 0;
        const DAILY_HOLLOW_GATE_CAP = 2 + attunementDailyBonus(character);
        if (runsToday >= DAILY_HOLLOW_GATE_CAP) {
            alert(`The Hollow Gate Shrine refuses to open again today. You've already entered ${runsToday}/${DAILY_HOLLOW_GATE_CAP} times. Return at dawn.`);
            return;
        }
        const ok = window.confirm(`Enter the Hollow Gate Shrine?\n\nThis consumes 1 Hollow Gate Key (${ownedKeys} owned). Keys are one-time use.\nDaily runs: ${runsToday}/${DAILY_HOLLOW_GATE_CAP}.`);
        if (!ok) return;

        // Server daily-cap HARD-block (audit #7): with the server-auth flag on, ask the
        // server BEFORE spending the Key — a 'daily-cap' reply (e.g. a backdated reset
        // that beat the client gate) blocks the dive. Unreachable / SESSION unset → null
        // → token-less fallback (the dive opens client-authoritative, as today).
        let serverStart: Awaited<ReturnType<typeof startHollowGateServerRun>> = null;
        if (hollowGateServerEnabled()) {
            serverStart = await startHollowGateServerRun(character.name, HOLLOW_GATE_MAX_FLOOR);
            if (serverStart?.reason === "daily-cap") {
                alert("The Hollow Gate has already taken its measure of you today. Return at dawn.");
                return;
            }
        }

        // Consume exactly one Hollow Gate Key (drains the counted stack).
        const afterKey = removeItem(character, HOLLOW_GATE_KEY_ID, 1);

        const run = applyAttunementToRun({ ...generateHollowGateShrineRun(1), entryCurrencies: snapshotHollowGateCurrencies(character) }, character, true);
        setHollowGateRun(run);
        setHollowGateLog([
            "You press a Hollow Gate Key against the broken torii. The seal bends. You descend.",
        ]);
        setHollowGateEvent(null);
        setHollowGateHiddenChamber(null);
        // First-time entry shows the intro VN (3 pages) before the grid is interactable.
        const isFirstEntry = !character.hollowGateIntroSeen;
        setHollowGateIntroPage(isFirstEntry ? 0 : null);
        setCharacter({
            ...afterKey,
            hollowGateRun: run,
            hollowGateIntroSeen: true,
            dailyHollowGateRuns: runsToday + 1,
            lastDailyReset: todayKey,
        });
        setCurrentBiome("shadow");
        setCurrentWeather(weatherForBiome("shadow"));
        setScreen("hollowGateShrine");
        // Attach the server token (already minted above, pre-Key) + present the augment
        // picker. No-op without a token (flag off / unreachable) — the token-first fallback.
        attachStartedRun(serverStart, { playerName: character.name, setRun: setHollowGateRun, setCharacter, setEvent: setHollowGateEvent, pushLog: pushHollowGateLog });
    }
    // ── Admin-only ops for the Hollow Gate panel ──────────────────────────
    function adminHollowGateForceUnlock(unlock: boolean) {
        if (!character) return;
        const v = loadVillageState(character.village);
        saveVillageState(character.village, normalizeVillageState(character.village, { ...v, hollowGateUnlockedUntil: unlock ? extendHollowGateUnlock(v.hollowGateUnlockedUntil) : 0 }));
    }
    function adminHollowGateResetIntro() {
        if (!character) return;
        setCharacter({ ...character, hollowGateIntroSeen: false });
    }
    function adminHollowGateClearRun() {
        if (!character) return;
        setHollowGateRun(null);
        setHollowGateEvent(null);
        setHollowGateHiddenChamber(null);
        setHollowGateLog([]);
        setHollowGateIntroPage(null);
        setCharacter({ ...character, hollowGateRun: null });
    }
    function adminHollowGateGrantKey() {
        if (!character) return;
        setCharacter(addInventoryItems(character, [HOLLOW_GATE_KEY_ID]));
    }

    // Admin-only test entry: bypasses the village-unlock check AND the
    // Hollow Gate Key requirement. Used by the Admin Panel's Hollow Gate tab
    // to playtest the shrine without burning a real key or waiting for a Kage.
    // Still uses the same generator / state setup as the normal entry, and
    // still records the run on the character so resume / persistence works.
    function adminTestEnterHollowGateShrine() {
        if (!character) return;
        // Resume an existing run if the admin has one — same behavior as
        // the live entry. Otherwise start a fresh run with no gates.
        if (character.hollowGateRun && !character.hollowGateRun.completed) {
            setHollowGateRun(character.hollowGateRun);
            setHollowGateLog(prev => prev.length ? prev : ["(Admin test) Resuming the unfinished run."]);
            setHollowGateEvent(null);
            setHollowGateHiddenChamber(null);
            setCurrentBiome("shadow");
            setCurrentWeather(weatherForBiome("shadow"));
            setScreen("hollowGateShrine");
            resumeHollowGateServerRun({ playerName: character.name, run: character.hollowGateRun, setRun: setHollowGateRun, setCharacter, setEvent: setHollowGateEvent, pushLog: pushHollowGateLog });
            return;
        }
        const run = applyAttunementToRun({ ...generateHollowGateShrineRun(1), entryCurrencies: snapshotHollowGateCurrencies(character) }, character, true);
        setHollowGateRun(run);
        setHollowGateLog([
            "(Admin test) You step through the broken torii — no seal, no key. The Hollow Gate echoes greet you anyway.",
        ]);
        setHollowGateEvent(null);
        setHollowGateHiddenChamber(null);
        setCharacter({
            ...character,
            hollowGateRun: run,
            lastDailyReset: currentDateKey(),
        });
        setCurrentBiome("shadow");
        setCurrentWeather(weatherForBiome("shadow"));
        setScreen("hollowGateShrine");
        // Same server run layer as the live entry (flag-gated; no-op when off).
        void beginHollowGateServerRun({ playerName: character.name, floorDepth: HOLLOW_GATE_MAX_FLOOR, setRun: setHollowGateRun, setCharacter, setEvent: setHollowGateEvent, pushLog: pushHollowGateLog });
    }
    // Weighted-random ambush — triggered when the threat meter hits the
    // ambush threshold (default 100). Picks one of three encounter types:
    //   50% — shinobi AI battle (the classic ambush)
    //   35% — pet duel (wild Hollow Beast) via PetArena autobattler
    //   15% — Shinobi Tile card-game duel
    // Each branch falls back to the shinobi battle if its prerequisites
    // aren't met (no eligible pet / fewer than 5 cards) so the ambush
    // ALWAYS fires something — the player never gets a free pass.
    function triggerHollowGateAmbush() {
        if (!character) return;
        // F5 ambush → boss fight. Avoids the climax getting cheated by a
        // random ambush firing before the Warden tile. The player still
        // sees the boss fight + the F5 shrine-cleared modal on win.
        if ((hollowGateRun?.floor ?? 1) >= HOLLOW_GATE_MAX_FLOOR) {
            pushHollowGateLog("The corridor itself tears open — the Hollow Gate Warden steps through the seal!");
            startHollowGateBattle({ isBoss: true });
            return;
        }
        pushHollowGateLog("The Hollow Gate echoes converge — an ambush!");
        const roll = Math.random() * 100;
        // ── Branch A: Pet duel (35% slot, rolls 50-84) ────────────────
        if (roll >= 50 && roll < 85) {
            const activePet = (character.pets ?? []).find(p => p.id === character.activePetId);
            const petReady = activePet && activePet.unlockedForPve && !isPetOnExpedition(activePet);
            if (petReady) {
                // Use the same wild-pet picker / handicap rules as the
                // pet_battle tile, including the shrine:tile-hollow-beast
                // image override.
                const floor = hollowGateRun?.floor ?? 1;
                const playerRarityIdx = petRarityOrder.indexOf(activePet.rarity);
                const maxRarityIdx = Math.min(petRarityOrder.length - 1, playerRarityIdx + 1);
                const bumpChance = Math.min(0.45, 0.10 + (floor - 1) * 0.05);
                const targetIdx = Math.random() < bumpChance ? maxRarityIdx : playerRarityIdx;
                const wildBase = pickHollowGateEncounterPet(petPool, petRarityOrder[targetIdx]);
                if (wildBase) {
                    const handicap = floor >= 4 ? 0.90 : 1.00;
                    const hollowBeastImg = sharedImages["shrine:tile-hollow-beast"];
                    const wild: Pet = {
                        ...wildBase,
                        id: `hg-beast-${Date.now()}`,
                        level: Math.max(1, activePet.level),
                        name: `Ambush: Hollow ${wildBase.name}`,
                        hp: Math.max(1, Math.floor(wildBase.hp * handicap)),
                        attack: Math.max(1, Math.floor(wildBase.attack * handicap)),
                        defense: Math.max(1, Math.floor(wildBase.defense * handicap)),
                        image: hollowBeastImg || wildBase.image,
                    };
                    pushHollowGateLog(`[Ambush — Hollow Beast] ${activePet.name} squares off against ${wild.name}.`);
                    // Threat / torch reset upfront (matches normal ambush behaviour).
                    setHollowGateRun(prev => prev ? { ...prev, threat: 0 } : prev);
                    setPendingPetBattleOpponent({
                        owner: "Hollow Gate",
                        pet: wild,
                        battleSeed: Date.now(),
                        returnScreen: "hollowGateShrine",
                    });
                    setScreen("petArena");
                    return;
                }
                // Couldn't pick a pet → fall through to shinobi.
            }
            // No eligible pet → fall through to shinobi.
            pushHollowGateLog("No pet stands at your side — corrupted shinobi close in instead.");
        }
        // ── Branch B: Tile-game duel (15% slot, rolls 85-99) ──────────
        if (roll >= 85) {
            const ownedCardCount = character.tileCards?.length ?? 0;
            if (ownedCardCount >= 5) {
                pushHollowGateLog("[Ambush — Tile Seal] A shadow opponent slams a stone table into the corridor.");
                setHollowGateRun(prev => prev ? { ...prev, threat: 0 } : prev);
                setHollowGateTileGameActive(true);
                setScreen("hollowGateTiles");
                return;
            }
            pushHollowGateLog("Your deck is too thin to seal the shadow — corrupted shinobi close in instead.");
        }
        // ── Default: Shinobi AI battle (50% slot, rolls 0-49 + all fallbacks) ──
        startHollowGateBattle({ isAmbush: true });
    }
    function startHollowGateBattle(opts: { isBoss?: boolean; isAmbush?: boolean; isBeast?: boolean; isElite?: boolean }) {
        if (!character) return;
        // Elite-tile affixes: a tougher, flavored variant rolled for elite
        // encounters. Build-time HP/stat modifiers only (no battle-engine
        // changes) applied to the cloned shrine AI below, plus a nameplate tag.
        const HOLLOW_GATE_AFFIXES = [
            { name: "Colossal", hpMult: 1.4, statMult: 1.0 },
            { name: "Brutish", hpMult: 1.25, statMult: 1.05 },
            { name: "Savage", hpMult: 1.1, statMult: 1.12 },
            { name: "Frenzied", hpMult: 0.9, statMult: 1.2 },
        ] as const;
        const eliteAffix = opts.isElite ? HOLLOW_GATE_AFFIXES[Math.floor(Math.random() * HOLLOW_GATE_AFFIXES.length)] : null;
        const scaleAffixStats = (stats: CreatorAi["stats"], mult: number): CreatorAi["stats"] =>
            mult === 1 ? stats : (Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Math.max(1, Math.round(Number(v) * mult))])) as CreatorAi["stats"]);
        const LEVEL_BAND = 15;
        const playerLevel = character.level;
        const inBand = (ai: CreatorAi) => Math.abs((ai.level ?? 1) - playerLevel) <= LEVEL_BAND;

        const normalAis = playableAis.filter(ai => !ai.isBossAi);
        const bossAis = playableAis.filter(ai => ai.isBossAi);

        // Boss tile prefers the dedicated Hollow Gate Warden; falls back to any
        // boss-type AI within ±15 levels; finally to closest boss overall.
        // Ambush + normal battles pick a random non-boss AI within ±15 levels.
        let chosen: CreatorAi | undefined;
        if (opts.isBoss) {
            const warden = bossAis.find(ai => ai.id === "boss-hollow-gate-warden");
            const bossBand = bossAis.filter(inBand);
            if (warden) {
                // Use the warden but rebase its level to the player's level so the
                // fight scales to the player. The encounter wrapper below clones the AI.
                chosen = warden;
            } else if (bossBand.length > 0) {
                chosen = bossBand[Math.floor(Math.random() * bossBand.length)];
            } else if (bossAis.length > 0) {
                // Fall back to the boss closest in level.
                chosen = [...bossAis].sort((a, b) =>
                    Math.abs((a.level ?? 1) - playerLevel) - Math.abs((b.level ?? 1) - playerLevel)
                )[0];
            }
        } else {
            const normalBand = normalAis.filter(inBand);
            if (normalBand.length > 0) {
                chosen = normalBand[Math.floor(Math.random() * normalBand.length)];
            } else if (normalAis.length > 0) {
                chosen = [...normalAis].sort((a, b) =>
                    Math.abs((a.level ?? 1) - playerLevel) - Math.abs((b.level ?? 1) - playerLevel)
                )[0];
            }
        }

        if (!chosen) {
            alert("The shrine refuses to reveal an opponent right now.");
            return;
        }
        const baseAi = chosen;

        // Wrap as a Hollow Gate themed encounter and rebase the AI's level
        // to within the band of the player so the battle is fair.
        const encounterName = opts.isBoss
            ? "Hollow Gate Warden"
            : opts.isAmbush
                ? "Hollow Gate Ambush"
                : opts.isBeast
                    ? `Hollow Beast: ${baseAi.name}`
                    : eliteAffix
                        ? `${eliteAffix.name} ${baseAi.name}`
                        : `Corrupted ${baseAi.name}`;
        // Boss difficulty scales with the floor of the run:
        //   Floor 1 -> playerLevel - 5
        //   Floor 2 -> playerLevel
        //   Floor 3 -> playerLevel + 5
        //   Floor 4 -> playerLevel + 10
        //   Floor 5 -> playerLevel + 15
        // (Currently bosses only exist on Floor 5 in fresh runs, but a legacy
        // save with a non-final-floor boss tile still scales correctly.)
        const floor = hollowGateRun?.floor ?? 1;
        const bossFloorOffset = opts.isBoss ? Math.min(LEVEL_BAND, -5 + (floor - 1) * 5) : 0;
        const targetLevel = playerLevel + bossFloorOffset;
        const rebasedLevel = opts.isBoss
            ? clampNumber(targetLevel, 1, MAX_LEVEL)
            : clampNumber(baseAi.level ?? playerLevel, Math.max(1, playerLevel - LEVEL_BAND), playerLevel + LEVEL_BAND);
        // Bosses also scale HP by floor (1.0x .. 1.4x).
        const bossHpMultiplier = opts.isBoss ? 1 + Math.max(0, floor - 1) * 0.1 : 1;

        // PET CO-COMBAT — multi-pronged simulation since Arena doesn't support
        // a co-combatant slot. When the player has a battle-ready pet, we:
        //   1) Restore player HP / chakra / stamina to full at battle start
        //      (the pet "preps" the shinobi before the encounter).
        //   2) Pre-damage the AI by 15-25% (normal fights, scaled by pet level)
        //      or 10-15% (boss, scaled by pet level). Pet level / 10, capped at
        //      1.5x, plus an extra 0.5x flat bond bump for being level-50+
        //      eligible.
        //   3) Log a clear "Pet assists in battle" line so the contribution is
        //      visible. The shrine flavor reflects the pet's name.
        const pet = character.pets?.find(p => p.id === character.activePetId);
        const petAssists = pet && pet.unlockedForPve && !isPetOnExpedition(pet);
        const baseHpShavePct = opts.isBoss ? 0.10 : 0.15;
        const bondFactor = petAssists && pet ? Math.min(1.5, Math.max(0.5, pet.level / 10)) : 0;
        const hpShavePct = petAssists ? baseHpShavePct * bondFactor : 0;
        // Pre-battle player buff: full restore when pet assists.
        if (petAssists && pet) {
            setCharacter({
                ...character,
                hp: character.maxHp,
                chakra: character.maxChakra,
                stamina: character.maxStamina,
            });
        }
        // Augment combat-feel (HG-only; no-op without a chosen augment) — applied
        // ONLY to this per-dive enemy clone, never the shared engine. Composes with
        // the elite affix + pet pre-damage already factored above.
        const aug = hollowGateAugmentEffects(hollowGateRun);
        const augStatMult = (eliteAffix?.statMult ?? 1) * aug.enemyStatMult;
        const totalHpShave = Math.min(0.9, hpShavePct + aug.enemyHpShavePct);
        const scaledHp = Math.max(1, Math.floor(baseAi.hp * bossHpMultiplier * (eliteAffix?.hpMult ?? 1) * aug.enemyHpMult));
        const shrineAi: CreatorAi = {
            ...baseAi,
            id: `hollow-gate-${baseAi.id}-${Date.now()}`,
            name: encounterName,
            level: rebasedLevel,
            isBossAi: Boolean(opts.isBoss),
            stats: augStatMult !== 1 ? scaleAffixStats(baseAi.stats, augStatMult) : baseAi.stats,
            hp: totalHpShave > 0 ? Math.max(1, Math.floor(scaledHp * (1 - totalHpShave))) : scaledHp,
        } as CreatorAi;
        if (petAssists && pet) {
            pushHollowGateLog(`${pet.name} steadies you — HP, chakra, and stamina restored to full.`);
            pushHollowGateLog(`${pet.name} draws first blood — the enemy enters with ${(hpShavePct * 100).toFixed(0)}% less HP.`);
        }

        setTemporaryStoryAi(shrineAi);
        setPendingAiProfileId(shrineAi.id);
        setPendingPvpOpponent(null);
        setRaidBattleKind("none");
        setPendingArenaStoryBattle({
            kind: "hollowGateShrine",
            returnScreen: "hollowGateShrine",
            isBoss: opts.isBoss,
            isAmbush: opts.isAmbush,
        });
        setCurrentBiome("shadow");
        setCurrentWeather(weatherForBiome("shadow"));
        setArenaKey((key) => key + 1);
        const petLine = isActivePetEligibleForHollowGate()
            ? ` ${character.pets.find(p => p.id === character.activePetId)?.name ?? "Your pet"} bristles beside you, ready to assist.`
            : "";
        pushHollowGateLog(`Encounter: ${encounterName}.${petLine}`);
        if (eliteAffix) pushHollowGateLog(`Elite affix: ${eliteAffix.name} — this foe is tougher than a normal corrupted shinobi.`);
        setScreen("arena");
    }
    // Shared run-summary builder — counts resolved tiles by kind and
    // packs them into the multi-line summary block used by the Leave
    // tile modal, the trap-death modal, and the F5 victory modal so a
    // player gets a consistent post-run report regardless of how they
    // exited.
    function buildHollowGateRunSummary(): string {
        if (!hollowGateRun || !character) return "";
        const t = hollowGateRun.tiles;
        const stats = {
            floors: hollowGateRun.floor,
            chests: t.filter(x => x.kind === "chest" && x.resolved).length,
            battles: t.filter(x => (x.kind === "battle" || x.kind === "elite") && x.resolved).length,
            beasts: t.filter(x => x.kind === "pet_battle" && x.resolved).length,
            tileSeals: t.filter(x => x.kind === "tile_game" && x.resolved).length,
            hiddenChambers: t.filter(x => x.kind === "shrine" && x.resolved).length,
            traps: t.filter(x => x.kind === "trap" && x.resolved).length,
            keepers: t.filter(x => x.kind === "npc" && x.resolved).length,
        };
        return [
            `Floor reached: ${stats.floors} / ${HOLLOW_GATE_MAX_FLOOR}`,
            `Chests opened: ${stats.chests}`,
            `Shinobi defeated: ${stats.battles}`,
            `Hollow Beasts felled: ${stats.beasts}`,
            `Tile Seals claimed: ${stats.tileSeals}`,
            `Hidden Chambers: ${stats.hiddenChambers}`,
            `Keepers blessed by: ${stats.keepers}`,
            `Traps survived: ${stats.traps}`,
            `HP remaining: ${character.hp} / ${character.maxHp}`,
        ].join("\n");
    }

    function resolveHollowGateTile(tile: HollowGateTile, x: number, y: number) {
        if (!hollowGateRun || !character) return;
        const idx = y * hollowGateRun.width + x;
        const flavor = hollowGateFlavorFor(tile.kind);
        // Mark resolved immediately so re-entering the tile doesn't fire it again.
        // CRITICAL: this MUST use the functional setHollowGateRun(prev => ...) form
        // and apply only the patch fields you actually want to change. The earlier
        // version of this helper accepted a full HollowGateShrineRun and spread it,
        // which silently overwrote the player's CURRENT position with whatever
        // position was in the closure at the time the deferred resolver ran. That
        // produced the "WASD teleports back" bug — the move took, then a stale
        // setTimeout fired markResolved with closure.hollowGateRun, snapping the
        // player back. Patches now only touch resolved/keys/torch.
        function markResolved(patch?: { keysDelta?: number; setKeys?: number; torchDelta?: number; setTorch?: number }) {
            setHollowGateRun(prev => {
                if (!prev) return prev;
                const tiles = prev.tiles.slice();
                if (tiles[idx]) tiles[idx] = { ...tiles[idx], resolved: true };
                const keys = patch?.setKeys != null
                    ? patch.setKeys
                    : prev.keys + (patch?.keysDelta ?? 0);
                const torchRaw = patch?.setTorch != null
                    ? patch.setTorch
                    : prev.torch + (patch?.torchDelta ?? 0);
                return {
                    ...prev,
                    keys,
                    torch: Math.max(0, Math.min(10, torchRaw)),
                    tiles,
                };
            });
        }
        switch (tile.kind) {
            case "empty": {
                pushHollowGateLog(flavor);
                markResolved();
                return;
            }
            case "battle": {
                pushHollowGateLog(flavor);
                startHollowGateBattle({});
                markResolved();
                return;
            }
            case "elite": {
                pushHollowGateLog(`[Elite] ${flavor}`);
                startHollowGateBattle({ isElite: true });
                markResolved();
                return;
            }
            case "tile_game": {
                // Shinobi Tile card-game encounter. Pre-modal shows the
                // shadow-opponent scene art (shrine:tile-tile-game); Begin
                // dives into the 3x3 card duel. Resolution callbacks back
                // in the App body handle win/lose/abandon.
                pushHollowGateLog(`[Tile Seal] ${flavor}`);
                markResolved();
                setHollowGateEvent({
                    title: "Shinobi Card Clash Seal",
                    body: `${flavor}\n\nA shadow opponent waits across the stone table. Defeat them in a Shinobi Card Clash duel to claim the seal. Loss costs 20% of your max HP. You can step away with no penalty before the result is reached.`,
                    kind: "tile_game",
                    choices: [
                        {
                            label: "Begin Tile Duel",
                            tone: "primary",
                            onSelect: () => {
                                setHollowGateEvent(null);
                                setHollowGateTileGameActive(true);
                                setScreen("hollowGateTiles");
                            },
                        },
                        {
                            label: "Step Away",
                            onSelect: () => {
                                setHollowGateEvent(null);
                                pushHollowGateLog("You leave the tile table untouched. The shadow opponent fades.");
                            },
                        },
                    ],
                });
                return;
            }
            case "pet_battle": {
                // Wild Hollow Beast — pet vs pet autobattler using the existing
                // PetArena. The player's active pet duels a random wild pet
                // scaled to the player's level. Falls back to a themed shinobi
                // fight if the player has no battle-ready pet (so the tile is
                // never a dead-end).
                const activePet = (character.pets ?? []).find(p => p.id === character.activePetId);
                const petReady = activePet && activePet.unlockedForPve && !isPetOnExpedition(activePet);
                if (!petReady) {
                    // No pet → fall back to the themed shinobi version of the
                    // encounter so the tile still fires something on step.
                    pushHollowGateLog(`[Hollow Beast] ${flavor} You have no pet ready — the beast comes for you instead.`);
                    startHollowGateBattle({ isBeast: true });
                    markResolved();
                    return;
                }
                // Pick a wild pet rarity capped to one tier above the player's
                // pet — never a mythic vs standard mismatch. Floor weighting
                // pushes toward the cap on deeper floors but still allows
                // mirror / lower-tier matches so easier fights remain possible.
                const floor = hollowGateRun?.floor ?? 1;
                const playerRarityIdx = petRarityOrder.indexOf(activePet.rarity);
                const maxRarityIdx = Math.min(petRarityOrder.length - 1, playerRarityIdx + 1);
                // bumpChance: F1=10%, F2=15%, ..., F5=30%. Probability of using
                // the +1 tier; otherwise stay at player tier (or lower for
                // standard players when bump isn't picked).
                const bumpChance = Math.min(0.45, 0.10 + (floor - 1) * 0.05);
                const targetIdx = Math.random() < bumpChance ? maxRarityIdx : playerRarityIdx;
                const targetRarity: PetRarity = petRarityOrder[targetIdx];
                const wildBase = pickHollowGateEncounterPet(petPool, targetRarity);
                if (!wildBase) {
                    // Shouldn't happen with the canonical pool, but defensive.
                    pushHollowGateLog(`[Hollow Beast] ${flavor} The beast melts back into the mist.`);
                    startHollowGateBattle({ isBeast: true });
                    markResolved();
                    return;
                }
                // Rebase wild pet to the player's pet level so the duel is
                // balanced on stats. On the hardest floors (F4-5) trim 10%
                // off hp/attack/defense so the fight stays winnable —
                // mythic-template stats can otherwise steamroll a standard
                // player pet even at matched level.
                const handicap = floor >= 4 ? 0.90 : 1.00;
                // Override the wild pet's image with the shrine beast portrait,
                // and give it an "hg-beast-" id so the image-lookup chain falls
                // through to pet.image instead of a user-generated pet template.
                const hollowBeastImg = sharedImages["shrine:tile-hollow-beast"];
                const wild: Pet = {
                    ...wildBase,
                    id: `hg-beast-${Date.now()}`,
                    level: Math.max(1, activePet.level),
                    name: `Hollow ${wildBase.name}`,
                    hp: Math.max(1, Math.floor(wildBase.hp * handicap)),
                    attack: Math.max(1, Math.floor(wildBase.attack * handicap)),
                    defense: Math.max(1, Math.floor(wildBase.defense * handicap)),
                    image: hollowBeastImg || wildBase.image,
                };
                pushHollowGateLog(`[Hollow Beast] ${flavor} ${activePet.name} squares off against ${wild.name}.`);
                // Pre-encounter modal — shows the Hollow Beast scene art
                // (shrine:tile-hollow-beast) before the player commits to
                // the duel. Begin transitions to PetArena. Step Away bails
                // with no penalty. Threat / torch reset applies whether the
                // player engages (so leaving is the safer path).
                markResolved({ setTorch: 10 });
                setHollowGateRun(prev => prev ? { ...prev, threat: 0 } : prev);
                setHollowGateEvent({
                    title: `Hollow Beast: ${wild.name}`,
                    body: `${flavor}\n\n${activePet.name} (Lv ${activePet.level} ${activePet.rarity}) faces ${wild.name} (Lv ${wild.level} ${wild.rarity ?? "wild"}). Win to claim victory; lose to take 20% HP damage. Either way your run continues.`,
                    kind: "pet_battle",
                    choices: [
                        {
                            label: "Send Pet to Duel",
                            tone: "primary",
                            onSelect: () => {
                                setHollowGateEvent(null);
                                setPendingPetBattleOpponent({
                                    owner: "Hollow Gate",
                                    pet: wild,
                                    battleSeed: Date.now(),
                                    returnScreen: "hollowGateShrine",
                                });
                                setScreen("petArena");
                            },
                        },
                        {
                            label: "Step Away",
                            onSelect: () => {
                                setHollowGateEvent(null);
                                pushHollowGateLog(`${activePet.name} pulls back. The Hollow Beast fades into mist.`);
                            },
                        },
                    ],
                });
                return;
            }
            case "trap": {
                // Hollow Gate traps deal a flat percent of the player's max HP
                // (tunable: HOLLOW_GATE_TRAP_DMG_PCT). Healing is forbidden inside the
                // shrine, so this damage is permanent until you leave or descend.
                // A trap CAN kill you if HP is already low.
                const dmgPct = HOLLOW_GATE_TRAP_DMG_PCT;
                const dmg = Math.max(1, Math.floor(character.maxHp * dmgPct));
                const nextHp = Math.max(0, character.hp - dmg);
                const willDie = nextHp <= 0;
                const trapWind = willDie && hollowGateRun?.secondWindArmed ? tryHollowGateSecondWind(hollowGateRun, character) : null;
                if (trapWind) {
                    setCharacter(trapWind.character);
                    setHollowGateRun(prev => prev ? trapWind.run : prev);
                    markResolved();
                    pushHollowGateLog(`${flavor} The trap's killing blow lands — then ${trapWind.log}`);
                    setHollowGateEvent({ title: "Second Wind", body: trapWind.log, kind: "trap", choices: [{ label: "Press On", tone: "primary", onSelect: () => setHollowGateEvent(null) }] });
                    return;
                }
                // On death, match the Arena-loss pipeline: hp:0 + hospitalized.
                setCharacter({
                    ...character,
                    hp: willDie ? 0 : nextHp,
                    hospitalized: willDie ? true : character.hospitalized,
                });
                pushHollowGateLog(`${flavor} The seals tear ${dmg} HP from you (${Math.round(dmgPct * 100)}% of max).${willDie ? " You collapse — admitted to the village hospital." : ""}`);
                if (willDie) {
                    setHollowGateEvent({
                        title: "You Have Fallen",
                        body: `${flavor}\n\nThe trap drains your final breath. You are admitted to the village hospital and your shrine run ends.\n\n— RUN SUMMARY —\n${buildHollowGateRunSummary()}`,
                        kind: "trap",
                        choices: [{
                            label: "Leave Shrine",
                            tone: "danger",
                            onSelect: () => {
                                setHollowGateEvent(null);
                                leaveHollowGateShrine({ death: true });
                                setScreen("hospital");
                            },
                        }],
                    });
                } else {
                    setHollowGateEvent({
                        title: "Ancient Seal Trap",
                        body: `${flavor}\n\nYou take ${dmg} HP damage (${Math.round(dmgPct * 100)}% of max).`,
                        kind: "trap",
                        choices: [{ label: "Press On", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                    });
                }
                markResolved();
                return;
            }
            case "chest": {
                const ryoGain = 80 + Math.floor(Math.random() * 200);
                const xpGain = 25 + Math.floor(Math.random() * 30);
                const auraDustGain = Math.random() < 0.4 ? 5 + Math.floor(Math.random() * 8) : 0;
                // Hollow Gate Shrine chests always yield aura stones and bone charms.
                const auraStoneGain = 1 + Math.floor(Math.random() * 10);  // 1..10
                const boneCharmGain = 5 + Math.floor(Math.random() * 11);  // 5..15
                const keyGain = Math.random() < 0.3 ? 1 : 0;
                const shardGain = hollowShardDrop(hollowGateRun.floor, "chest");
                const leveled = gainXp(character, xpGain);
                setCharacter({
                    ...leveled,
                    ryo: leveled.ryo + ryoGain,
                    auraDust: (leveled.auraDust ?? 0) + auraDustGain,
                    auraStones: (leveled.auraStones ?? 0) + auraStoneGain,
                    boneCharms: (leveled.boneCharms ?? 0) + boneCharmGain,
                    hollowShards: (leveled.hollowShards ?? 0) + shardGain,
                });
                // Chests also refill the Torch of Reiki by 2.
                const torchRefill = 2;
                pushHollowGateLog(`Chest opened. +${ryoGain} ryo, +${effectiveCharacterXpGain(character, xpGain)} XP${auraDustGain ? `, +${auraDustGain} Aura Dust` : ""}, +${auraStoneGain} Aura Stones, +${boneCharmGain} Bone Charms, +${shardGain} Hollow Shards${keyGain ? ", +1 Shrine Key" : ""}, +${torchRefill} Torch.`);
                markResolved({ keysDelta: keyGain, torchDelta: torchRefill });
                setHollowGateEvent({
                    title: "Shrine Offering Chest",
                    body: `${flavor}\n\n+${ryoGain} ryo\n+${effectiveCharacterXpGain(character, xpGain)} XP${auraDustGain ? `\n+${auraDustGain} Aura Dust` : ""}\n+${auraStoneGain} Aura Stones\n+${boneCharmGain} Bone Charms\n+${shardGain} Hollow Shards${keyGain ? "\n+1 Shrine Key" : ""}`,
                    kind: "chest",
                    choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                });
                return;
            }
            case "shard_vein": {
                const gain = hollowShardDrop(hollowGateRun.floor, "shardVein");
                setCharacter(prev => prev ? { ...prev, hollowShards: (prev.hollowShards ?? 0) + gain } : prev);
                pushHollowGateLog(`${flavor} You pry ${gain} Hollow Shards loose.`);
                markResolved();
                return;
            }
            case "pet_event": {
                // Flavor only — pet pawprints are atmosphere, not a reward source.
                // Real pet encounters are gated behind sealed doors (the "secret room"
                // reward path) where the rare/legendary/mythic rolls live.
                const pet = character.pets.find(p => p.id === character.activePetId);
                pushHollowGateLog(flavor);
                setHollowGateEvent({
                    title: "Glowing Pawprints",
                    body: pet
                        ? `${flavor}\n\n${pet.name} sniffs the air, then the trail fades into the dark.`
                        : `${flavor}\n\nThe trail fades into the dark.`,
                    kind: "pet_event",
                    choices: [{ label: "Onward", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                });
                markResolved();
                return;
            }
            case "shrine": {
                // Shrine tile fully refills the Torch of Reiki.
                pushHollowGateLog(`${flavor} The Torch of Reiki flares to full.`);
                setHollowGateHiddenChamber({ searched: false, relicTaken: false });
                markResolved({ setTorch: 10 });
                return;
            }
            case "story": {
                // Flavor only — story tiles teach you about the shrine. No rewards
                // (rewards come from chests, secret doors, and the Warden).
                pushHollowGateLog(flavor);
                setHollowGateEvent({
                    title: "Hollow Gate Echo",
                    body: `${flavor}\n\nYou study the engraving. The shrine watches.`,
                    kind: "story",
                    choices: [{ label: "Move On", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                });
                markResolved();
                return;
            }
            case "boss": {
                pushHollowGateLog(flavor);
                startHollowGateBattle({ isBoss: true });
                // Do NOT mark resolved here — boss tile is resolved on victory by the battle complete handler.
                return;
            }
            case "descend": {
                // Staircase to the next floor. Carries torch + keys forward and
                // gives a small torch refill. Resolved on use.
                pushHollowGateLog(flavor);
                if (hollowGateRun.floor >= HOLLOW_GATE_MAX_FLOOR) {
                    // Defensive — shouldn't happen since Floor 5 never spawns a
                    // descend tile, but if it somehow does, treat as exit.
                    setHollowGateEvent({
                        title: "Bottomless Staircase",
                        body: "The staircase coils into the dark, leading nowhere.\n\nThis is the deepest floor.",
                        kind: "descend",
                        choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                    });
                    markResolved();
                    return;
                }
                setHollowGateEvent({
                    title: "Descend the Staircase",
                    body: `${flavor}\n\nDescend to Floor ${hollowGateRun.floor + 1}? You carry your keys and torch forward, with a small Reiki refill.`,
                    kind: "descend",
                    choices: [
                        {
                            label: "Descend Deeper",
                            tone: "primary",
                            onSelect: () => {
                                const next = applyAttunementToRun(generateHollowGateShrineRun(hollowGateRun.floor + 1), character, false);
                                setHollowGateRun({ ...next, keys: hollowGateRun.keys, torch: Math.min(10, hollowGateRun.torch + 4), entryCurrencies: hollowGateRun.entryCurrencies });
                                pushHollowGateLog(`You descend to Floor ${next.floor}. Torch flares: +4.`);
                                setHollowGateEvent(null);
                            },
                        },
                        { label: "Hold Position", onSelect: () => setHollowGateEvent(null) },
                    ],
                });
                // Don't markResolved — player can stay on the floor and come back to the staircase.
                return;
            }
            case "npc": {
                // Shrine Keeper — one per floor. Offers a one-time blessing.
                pushHollowGateLog(flavor);
                setHollowGateEvent({
                    title: "The Shrine Keeper",
                    body: `${flavor}\n\n"Choose your gift, traveler. The shrine offers what it can spare."`,
                    kind: "npc",
                    choices: [
                        // Treasure Sense ("fewer healing tiles") seals the Keeper's heal — HG-only.
                        ...(hollowGateAugmentEffects(hollowGateRun).noKeeperHeal ? [] : [{
                            label: "Restore HP (33% of max)",
                            tone: "primary" as const,
                            onSelect: () => {
                                if (!character) return;
                                // NOTE: healing is normally forbidden in the shrine, but a
                                // Shrine Keeper blessing is the canonical exception.
                                const heal = Math.floor(character.maxHp * 0.33);
                                setCharacter({ ...character, hp: Math.min(character.maxHp, character.hp + heal) });
                                pushHollowGateLog(`The Shrine Keeper restores ${heal} HP.`);
                                setHollowGateEvent(null);
                            },
                        }]),
                        {
                            label: "Refill Torch of Reiki",
                            onSelect: () => {
                                // Functional form preserves markResolved()'s
                                // resolved:true (closure-spread re-armed this tile).
                                setHollowGateRun(prev => prev ? { ...prev, torch: 10 } : prev);
                                pushHollowGateLog("The Shrine Keeper rekindles the Torch of Reiki to full.");
                                setHollowGateEvent(null);
                            },
                        },
                        {
                            label: "Gift a Shrine Key",
                            onSelect: () => {
                                // Functional form — see the Refill Torch note above:
                                // the closure-spread form reverted markResolved()'s
                                // resolved:true and let this tile be farmed for keys.
                                setHollowGateRun(prev => prev ? { ...prev, keys: prev.keys + 1 } : prev);
                                pushHollowGateLog("The Shrine Keeper presses a Shrine Key into your palm. +1 Shrine Key.");
                                setHollowGateEvent(null);
                            },
                        },
                    ],
                });
                markResolved();
                return;
            }
            case "exit": {
                // The Exit tile is the LEAVE tile — the only voluntary way out of
                // the shrine. Stepping on it ends the run and returns to worldMap.
                // The saved run is cleared; re-entering costs another Hollow Gate Key.
                pushHollowGateLog(flavor);
                // Berserker's Gamble ("no retreat") seals the Leave tile for the run (HG-only).
                const noRetreat = hollowGateAugmentEffects(hollowGateRun).noRetreat;
                setHollowGateEvent({
                    title: noRetreat ? "The Gate Holds You" : "Leave the Hollow Gate",
                    body: noRetreat
                        ? `${flavor}\n\nBerserker's Gamble binds you — the torii will not open backward. Clear the Hollow Gate or fall.`
                        : `${flavor}\n\nThe broken torii on this tile opens back to the world map.\n\n— RUN SUMMARY —\n${buildHollowGateRunSummary()}\n\nLeaving ends this run — your progress is forfeit and you'll need another Hollow Gate Key to return.`,
                    kind: "exit",
                    choices: noRetreat
                        ? [{ label: "Press On", tone: "primary", onSelect: () => setHollowGateEvent(null) }]
                        : [
                            {
                                label: "Leave Shrine",
                                tone: "danger",
                                onSelect: () => {
                                    setHollowGateEvent(null);
                                    leaveHollowGateShrine();
                                },
                            },
                            { label: "Step Back", onSelect: () => setHollowGateEvent(null) },
                        ],
                });
                // Don't mark resolved — players can step back and approach later
                // (the tile still works on re-entry).
                return;
            }
            case "locked": {
                if (hollowGateRun.keys > 0) {
                    pushHollowGateLog(`${flavor} You spend a Shrine Key to open it.`);
                    markResolved({ keysDelta: -1 });
                    // Sealed-door table: 50% Ancient Chest, 25% Trap (lethal-capable),
                    // 24% rare / 0.8% legendary / 0.2% mythic pet encounter.
                    const roll = Math.random();
                    if (roll < 0.50) {
                        // ANCIENT CHEST
                        const loot = rollHollowGateAncientChest(hollowGateRun.floor);
                        const leveled = gainXp(character, loot.xp);
                        const lockedShards = hollowShardDrop(hollowGateRun.floor, "lockedChest");
                        // Stack only flagged-stackable items; skip non-stackable dups.
                        const shouldAddItem = loot.itemId && (
                            stackableItemIds.has(loot.itemId) || !character.inventory.includes(loot.itemId)
                        );
                        const next: Character = {
                            ...leveled,
                            ryo: leveled.ryo + (loot.ryo ?? 0),
                            fateShards: (leveled.fateShards ?? 0) + (loot.fateShards ?? 0),
                            boneCharms: (leveled.boneCharms ?? 0) + (loot.boneCharms ?? 0),
                            auraStones: (leveled.auraStones ?? 0) + (loot.auraStones ?? 0),
                            auraDust: (leveled.auraDust ?? 0) + (loot.auraDust ?? 0),
                            hollowShards: (leveled.hollowShards ?? 0) + lockedShards,
                            inventory: shouldAddItem && loot.itemId ? [...leveled.inventory, loot.itemId] : leveled.inventory,
                        };
                        setCharacter(next);
                        const lootLines: string[] = [
                            `+${effectiveCharacterXpGain(character, loot.xp)} XP`,
                        ];
                        if (loot.ryo) lootLines.push(`+${loot.ryo} ryo`);
                        if (loot.itemId && shouldAddItem) {
                            const item = starterItems.find(it => it.id === loot.itemId) ?? petTreatItems.find(t => t.id === loot.itemId);
                            lootLines.push(`+1 ${item?.name ?? loot.itemId}`);
                        }
                        if (loot.fateShards) lootLines.push(`+${loot.fateShards} Fate Shard`);
                        if (loot.boneCharms) lootLines.push(`+${loot.boneCharms} Bone Charm`);
                        if (loot.auraStones) lootLines.push(`+${loot.auraStones} Aura Stone`);
                        if (loot.auraDust) lootLines.push(`+${loot.auraDust} Aura Dust`);
                        lootLines.push(`+${lockedShards} Hollow Shards`);
                        pushHollowGateLog(`Ancient Chest opened. ${lootLines.join(", ")}.`);
                        setHollowGateEvent({
                            title: "Ancient Chest",
                            body: `Behind the chains, an ancient chest creaks open.\n\n${lootLines.join("\n")}`,
                            kind: "chest",
                            choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                        });
                    } else if (roll < 0.75) {
                        // TRAP — same formula as the trap tile (tunable HOLLOW_GATE_TRAP_DMG_PCT).
                        const dmgPct = HOLLOW_GATE_TRAP_DMG_PCT;
                        const dmg = Math.max(1, Math.floor(character.maxHp * dmgPct));
                        const nextHp = Math.max(0, character.hp - dmg);
                        const willDie = nextHp <= 0;
                        const doorWind = willDie && hollowGateRun?.secondWindArmed ? tryHollowGateSecondWind(hollowGateRun, character) : null;
                        if (doorWind) {
                            setCharacter(doorWind.character);
                            setHollowGateRun(prev => prev ? doorWind.run : prev);
                            pushHollowGateLog(`The cursed seal drains your last breath — then ${doorWind.log}`);
                            setHollowGateEvent({ title: "Second Wind", body: doorWind.log, kind: "trap", choices: [{ label: "Press On", tone: "primary", onSelect: () => setHollowGateEvent(null) }] });
                            return;
                        }
                        setCharacter({
                            ...character,
                            hp: willDie ? 0 : nextHp,
                            hospitalized: willDie ? true : character.hospitalized,
                        });
                        pushHollowGateLog(`Trap behind the door! You take ${dmg} HP damage (${Math.round(dmgPct * 100)}% of max).${willDie ? " You collapse — admitted to the hospital." : ""}`);
                        if (willDie) {
                            setHollowGateEvent({
                                title: "Cursed Trap Door",
                                body: `The chains were a binding seal. They drain the last of your chakra. You are admitted to the village hospital and your shrine run ends.`,
                                kind: "trap",
                                choices: [{
                                    label: "Leave Shrine",
                                    tone: "danger",
                                    onSelect: () => {
                                        setHollowGateEvent(null);
                                        leaveHollowGateShrine({ death: true });
                                        setScreen("hospital");
                                    },
                                }],
                            });
                        } else {
                            setHollowGateEvent({
                                title: "Trap Door",
                                body: `Behind the chains, a cursed seal lashes out.\n\nYou take ${dmg} HP damage (${Math.round(dmgPct * 100)}% of max).`,
                                kind: "trap",
                                choices: [{ label: "Press On", onSelect: () => setHollowGateEvent(null), tone: "danger" }],
                            });
                        }
                    } else {
                        // PET ENCOUNTER — rare (24%), legendary (0.8%), mythic (0.2%).
                        // Roll within the [0.75, 1.0] band for relative weights:
                        //   0.75 .. 0.99 (24%)  rare
                        //   0.99 .. 0.998 (0.8%) legendary
                        //   0.998 .. 1.0 (0.2%) mythic
                        let rarity: PetRarity;
                        if (roll < 0.99) rarity = "rare";
                        else if (roll < 0.998) rarity = "legendary";
                        else rarity = "mythic";

                        // Use the canonical petPool (full built-in pool) rather than editablePets
                        // so each rarity band always has variety even if admins haven't seeded
                        // the editable pool yet.
                        const encounter = pickHollowGateEncounterPet(petPool, rarity);
                        if (!encounter) {
                            // Defensive — should never happen with the standard pet pool, but bail safely.
                            pushHollowGateLog("A presence stirs behind the door, then fades away.");
                            setHollowGateEvent({
                                title: "Empty Chamber",
                                body: "Behind the chains, an empty chamber. The presence retreats.",
                                kind: "locked",
                                choices: [{ label: "Continue", onSelect: () => setHollowGateEvent(null), tone: "primary" }],
                            });
                        } else {
                            pushHollowGateLog(`A ${rarity} pet emerges from behind the sealed door: ${encounter.name}.`);
                            const rarityColor = rarity === "mythic" ? "#fbbf24" : rarity === "legendary" ? "#a855f7" : "#60a5fa";
                            setHollowGateEvent({
                                title: `${rarity.charAt(0).toUpperCase() + rarity.slice(1)} Pet Encounter`,
                                body: `Behind the chains, a ${rarity} spirit-bound creature studies you.\n\n${encounter.name} — Lv. ${encounter.level}\nHP ${encounter.hp} | ATK ${encounter.attack} | DEF ${encounter.defense} | SPD ${encounter.speed}\n\nBefriend it? (Pet Yard ${character.pets.length}/5)`,
                                kind: "pet_event",
                                choices: [
                                    {
                                        label: `Befriend ${encounter.name}`,
                                        tone: "primary",
                                        onSelect: () => {
                                            if (character.pets.length >= 5) {
                                                alert("Your Pet Yard is full (5/5). Release a pet before befriending another.");
                                                return;
                                            }
                                            const trait = rollPetTrait(encounter.rarity);
                                            const petWithTrait = applyPetTraitBonuses({ ...encounter, trait }, trait);
                                            const updated = { ...character, pets: [...character.pets, petWithTrait] };
                                            setCharacter(updated);
                                            // Flush now (mirrors starter-pet path) so a refresh/close inside the 3s
                                            // autosave debounce can't lose a freshly befriended rare/mythic pet.
                                            void pushSaveToServer(updated, currentAccountName || character.name).catch(() => {});
                                            pushHollowGateLog(`${encounter.name} joined you! Trait: ${trait}.`);
                                            setHollowGateEvent(null);
                                        },
                                    },
                                    { label: "Leave it", onSelect: () => { pushHollowGateLog(`You leave the ${rarity} spirit be.`); setHollowGateEvent(null); } },
                                ],
                            });
                            // Subtle color hint via log
                            pushHollowGateLog(`%c${rarity.toUpperCase()} aura detected.`);
                            void rarityColor; // referenced for clarity; actual coloring not in this simple log
                        }
                    }
                } else {
                    pushHollowGateLog(`${flavor} Without a Shrine Key, the door will not open.`);
                    setHollowGateEvent({
                        title: "Sealed Door",
                        body: `${flavor}\n\nYou need a Shrine Key to open this door.`,
                        kind: "locked",
                        choices: [{ label: "Step Back", onSelect: () => setHollowGateEvent(null) }],
                    });
                    // Don't mark resolved — player can try again with a key later.
                }
                return;
            }
        }
    }
    function moveHollowGatePlayer(dx: number, dy: number) {
        if (hollowGateEvent || hollowGateHiddenChamber) return;
        if (hollowGateIntroPage !== null) return;

        // Functional state update so rapid WASD presses queue against the latest
        // run state (the closure form lost presses within a single render tick).
        let outcome: {
            wallBump: boolean;
            blockMessage?: string;       // sealed-wing block reason (overrides the wall-bump log)
            committedTheme?: string;     // wing theme just committed to (for the seal log)
            torchSputtered: boolean;
            justResolved: { tile: HollowGateTile; nx: number; ny: number; nextThreat: number } | null;
            ambushImmediate: boolean;
        } = { wallBump: false, torchSputtered: false, justResolved: null, ambushImmediate: false };

        setHollowGateRun(prev => {
            if (!prev) return prev;
            const nx = prev.playerX + dx;
            const ny = prev.playerY + dy;
            if (nx < 0 || ny < 0 || nx >= prev.width || ny >= prev.height) return prev;
            const idx = ny * prev.width + nx;
            const tile = prev.tiles[idx];
            // Walls are impassable. No state change, no threat/torch cost.
            const isWall = tile.kind === "wall" || tile.terrain === "wall";
            if (isWall) {
                outcome = { ...outcome, wallBump: true };
                return prev;
            }
            // Branching wings: block entry to a sealed wing; entering a detour
            // commits to it (sealing the other). Trial/hub are always open.
            const wingEff = wingEntryEffect(prev, tile.wing);
            if (wingEff.blocked) {
                outcome = { ...outcome, wallBump: true, blockMessage: wingEff.message };
                return prev;
            }
            if (wingEff.committedTheme) outcome = { ...outcome, committedTheme: wingEff.committedTheme };
            const tiles = prev.tiles.slice();
            tiles[idx] = { ...tile, revealed: true, flavor: tile.flavor ?? hollowGateFlavorFor(tile.kind) };
            // Torch of Reiki: drains 1 every ~3 moves. At 0 torch, threat fills 2x faster.
            const torchDrain = Math.random() < 0.33 ? 1 : 0;
            const nextTorch = Math.max(0, prev.torch - torchDrain);
            const threatMultiplier = nextTorch === 0 ? 2 : 1;
            // Hollow Ward holds Threat still while its steps last (then it ticks down).
            const warded = (prev.wardSteps ?? 0) > 0;
            const nextThreat = warded ? prev.threat : Math.min(100, prev.threat + HOLLOW_GATE_THREAT_PER_STEP * threatMultiplier);
            // Fire the tile's event on every step onto an UNRESOLVED tile (gate on
            // `resolved` only, never on revealed — so Leave/descend/locked/boss
            // re-fire when re-entered; markResolved() still prevents double-grants).
            const justResolved = !tile.resolved;
            outcome = {
                ...outcome,
                torchSputtered: nextTorch === 0 && prev.torch > 0,
                justResolved: justResolved ? { tile: { ...tile, revealed: true }, nx, ny, nextThreat } : null,
                ambushImmediate: !justResolved && nextThreat >= HOLLOW_GATE_THREAT_AMBUSH,
            };
            return {
                ...prev,
                ...(wingEff.patch ?? {}),
                playerX: nx,
                playerY: ny,
                tiles,
                threat: nextThreat,
                torch: nextTorch,
                wardSteps: Math.max(0, (prev.wardSteps ?? 0) - 1),
            };
        });

        // ── Side effects ──────────────────────────────────────────────────
        if (outcome.wallBump) {
            pushHollowGateLog(outcome.blockMessage ?? "Solid shrine stone. You cannot pass.");
            return;
        }
        if (outcome.committedTheme) {
            pushHollowGateLog(`You commit to the ${outcome.committedTheme === "treasure" ? "Treasure" : "Beast"} wing — the other detour seals behind you. The Trial path remains open.`);
        }
        if (outcome.torchSputtered) {
            pushHollowGateLog("The Torch of Reiki sputters out. Threat builds faster in the dark.");
        }
        if (outcome.justResolved) {
            const { tile, nx, ny, nextThreat } = outcome.justResolved;
            const modalFiringKinds: HollowGateTileKind[] = [
                "battle", "elite", "boss",
                "trap", "chest", "shrine", "pet_event", "pet_battle", "tile_game", "story",
                "locked", "exit", "npc", "descend",
            ];
            const tileWillOpenModal = modalFiringKinds.includes(tile.kind);
            // Deferred via 0ms so state commits first (resolveHollowGateTile uses
            // markResolved's functional form, preserving the player's position).
            setTimeout(() => {
                resolveHollowGateTile(tile, nx, ny);
                if (!tileWillOpenModal && nextThreat >= HOLLOW_GATE_THREAT_AMBUSH) {
                    triggerHollowGateAmbush();   // ambush at max threat (see triggerHollowGateAmbush)
                }
            }, 0);
        } else if (outcome.ambushImmediate) {
            setTimeout(() => triggerHollowGateAmbush(), 0);
        }
    }
    function leaveHollowGateShrine(opts?: { death?: boolean }) {
        // Death claws back the run's haul; a voluntary exit keeps it all.
        // finalizeHollowGateRunEnd applies that locally (functional setState — a stale
        // closure can't revert hp:0) + reconciles to the server settle credit if tokened.
        const endingRun = hollowGateRun;
        setHollowGateRun(null);
        setHollowGateEvent(null);
        setHollowGateHiddenChamber(null);
        setHollowGateLog([]);
        if (character) finalizeHollowGateRunEnd({ run: endingRun, outcome: opts?.death ? "death" : "extract", character, lootRetention: attunementLootRetention(character), setCharacter });
        setScreen("worldMap");
    }
    function onHollowGateBattleWin() {
        if (!hollowGateRun) return;
        const isBoss = pendingArenaStoryBattle?.kind === "hollowGateShrine" && pendingArenaStoryBattle.isBoss;
        const isAmbush = pendingArenaStoryBattle?.kind === "hollowGateShrine" && pendingArenaStoryBattle.isAmbush;
        if (isBoss) {
            // Boss only appears on Floor 5 now — defeating it clears the shrine.
            // (Boss-defeat on earlier floors would only fire if a legacy run still
            // had a boss tile on Floor 1-4; defensively we still handle it.)
            const tiles = hollowGateRun.tiles.map(t => t.kind === "boss" ? { ...t, resolved: true } : t);
            const isFinalFloor = hollowGateRun.floor >= HOLLOW_GATE_MAX_FLOOR;
            // Surviving a fight resets threat (a fresh window) but NOT the Torch
            // — the Torch is the run clock, refilled only by chests/shrines/Keeper.
            const nextRun: HollowGateShrineRun = { ...hollowGateRun, tiles, completed: isFinalFloor, threat: 0 };
            setHollowGateRun(nextRun);
            pushHollowGateLog(`The Hollow Gate Warden falls on Floor ${hollowGateRun.floor}. ${isFinalFloor ? "The shrine is cleared!" : "A staircase opens below."}`);
            if (isFinalFloor) {
                // Shrine-cleared bonus — extra fragment + honor seals + fate shard.
                // No "Leave" choice — auto-returns to world map after rewards are claimed.
                setHollowGateEvent({
                    title: "Hollow Gate Shrine Cleared",
                    body: `Floor ${hollowGateRun.floor} of ${HOLLOW_GATE_MAX_FLOOR} cleared.\n\nThe Hollow Gate echoes scatter. The shrine surrenders its final relic to you.\n\n— RUN SUMMARY —\n${buildHollowGateRunSummary()}`,
                    kind: "boss",
                    choices: [
                        {
                            label: "Take Final Rewards + Leave",
                            tone: "primary",
                            onSelect: () => {
                                if (!character) return;
                                const bonusHonor = vanguardOnlyHonorSeals(character, 75);
                                const bonusCharms = nonVanguardCharmSubstitute(character, 75);
                                const bonusShardSub = nonVanguardShardSubstitute(character, 75);
                                const bonusFate = 1 + bonusShardSub;
                                const next = addInventoryItems({
                                    ...character,
                                    honorSeals: (character.honorSeals ?? 0) + bonusHonor,
                                    boneCharms: (character.boneCharms ?? 0) + bonusCharms,
                                    fateShards: (character.fateShards ?? 0) + bonusFate,
                                }, [DUNGEON_LEGENDARY_FRAGMENT_ID, VEIL_OF_THE_HOLLOW_ID]);
                                setCharacter(next);
                                pushHollowGateLog(`Shrine cleared bonus: ${bonusHonor > 0 ? `+${bonusHonor} Honor Seals, ` : bonusCharms > 0 ? `+${bonusCharms} Bone Charms, ` : ""}+${bonusFate} Fate Shard${bonusFate === 1 ? "" : "s"}, +1 Dungeon Legendary Fragment, +1 Veil of the Hollow.`);
                                setHollowGateEvent(null);
                                leaveHollowGateShrine();
                            },
                        },
                    ],
                });
            } else {
                // Legacy / defensive: boss on a non-final floor auto-advances.
                const nextGen = generateHollowGateShrineRun(hollowGateRun.floor + 1);
                const next = character ? applyAttunementToRun(nextGen, character, false) : nextGen;
                setHollowGateRun({ ...next, keys: hollowGateRun.keys, torch: Math.min(10, hollowGateRun.torch + 4), entryCurrencies: hollowGateRun.entryCurrencies });
                pushHollowGateLog(`You descend to Floor ${next.floor}. Torch flares: +4.`);
            }
        } else if (isAmbush) {
            // Ambush survived → full reset of both meters.
            setHollowGateRun({ ...hollowGateRun, threat: 0 });
            pushHollowGateLog("The ambush ends. Threat dissipates — but the Torch of Reiki keeps burning down. Find a chest or shrine to rekindle it.");
        } else {
            // Regular battle / elite / pet_battle (themed-shinobi fallback)
            // — also full reset. The previous "threat -= 25" partial reset
            // made fights feel less rewarding than they should.
            setHollowGateRun({ ...hollowGateRun, threat: 0 });
            pushHollowGateLog("Corrupted shinobi defeated. Threat dissipates — the Torch of Reiki, though, keeps burning down.");
        }
    }

    function completeEventEncounter() {
        const event = pendingEventEncounter?.event;
        setPendingEventEncounter(null);
        if (event) completeTriggeredEvent(event);
        else setScreen(activeTriggerReturnScreen);
    }

    function leaveEventEncounter() {
        setPendingEventEncounter(null);
        setScreen(activeTriggerReturnScreen);
    }

    const playableAis = [
        ...builtinAis.map((builtin) => { const o = creatorAis.find((ai) => ai.id === builtin.id); return o ? { ...builtin, image: o.image ?? builtin.image } : builtin; }), // built-in/story AIs source-authoritative; same-id override = image only (see AdminPanel allAdminAis)
        ...creatorAis.filter((ai) => !builtinAis.some((builtin) => builtin.id === ai.id)),
        ...(temporaryStoryAi ? [temporaryStoryAi] : []),
    ];

    return (
        <div
            className={`app-shell shell-biome-${currentBiome} screen-${screen}`}
            style={{
                // Darkening overlay only — the full-bleed scene is painted once by
                // the fixed `.app-background` layer below (cover/no-repeat). Tiling the
                // image here too made the portrait art repeat across wide viewports.
                backgroundImage: `linear-gradient(rgba(2, 6, 23, 0.38), rgba(2, 6, 23, 0.76))`,
            }}
        >
            <GameAlertHost />
            <SaveErrorBanner visible={saveBlocked} />
            {sessionExpired && (
                <div
                    style={{
                        position: "fixed", inset: 0, zIndex: 100000,
                        display: "grid", placeItems: "center",
                        background: "rgba(2, 6, 23, 0.82)", padding: "1rem",
                    }}
                >
                    <div
                        style={{
                            background: "#0f172a", border: "1px solid #475569",
                            borderRadius: 12, padding: "1.5rem", maxWidth: 380, width: "100%",
                            boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
                        }}
                    >
                        <h3 style={{ marginTop: 0, color: "#e2e8f0" }}>Session timed out</h3>
                        <p style={{ color: "#cbd5e1", fontSize: "0.95rem" }}>
                            Your login session expired. Enter your password to keep playing —{" "}
                            <strong>your progress is safe and will be saved.</strong>
                        </p>
                        <input
                            type="password"
                            value={reauthPw}
                            onChange={(e) => setReauthPw(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && !reauthBusy) void reauthKeepState(); }}
                            placeholder="Password"
                            autoFocus
                            style={{
                                width: "100%", padding: "0.55rem 0.7rem", marginBottom: "0.5rem",
                                borderRadius: 8, border: "1px solid #475569",
                                background: "#1e293b", color: "#e2e8f0", boxSizing: "border-box",
                            }}
                        />
                        {reauthError && (
                            <p style={{ color: "#f87171", fontSize: "0.85rem", margin: "0 0 0.5rem" }}>{reauthError}</p>
                        )}
                        <button
                            onClick={() => { if (!reauthBusy) void reauthKeepState(); }}
                            disabled={reauthBusy}
                            style={{
                                width: "100%", padding: "0.6rem", borderRadius: 8, border: "none",
                                background: reauthBusy ? "#334155" : "linear-gradient(#15803d,#0a4019)",
                                color: "#fff", cursor: reauthBusy ? "default" : "pointer", fontWeight: 600,
                            }}
                        >
                            {reauthBusy ? "Signing in…" : "Continue playing"}
                        </button>
                        <button
                            onClick={logoutFromExpiry}
                            disabled={reauthBusy}
                            style={{
                                width: "100%", padding: "0.5rem", marginTop: "0.5rem",
                                borderRadius: 8, border: "1px solid #475569",
                                background: "transparent", color: "#94a3b8", cursor: "pointer",
                            }}
                        >
                            Log out instead
                        </button>
                    </div>
                </div>
            )}
            <div
                className="app-background"
                style={{ backgroundImage: `url(${backgroundImage})` }}
            />

            {character &&
                screen !== "start" &&
                screen !== "arena" &&
                screen !== "storyBoss" &&
                screen !== "battleTowers" &&
                screen !== "pvpBattle" && (
                    <LeftProfileCard
                        character={character}
                        updateCharacter={setCharacter}
                        currentSector={currentSector}
                        setScreen={setScreen}
                        activeTraining={activeTraining}
                        activeJutsuTraining={activeJutsuTraining}
                    />
                )}

            {/* Portal target for battle HUD — rendered outside center-game to escape stacking context */}
            <div id="battle-hud-portal" />

            {screen !== "start" && character && (screen === "arena" || screen === "storyBoss") && <SectorBanner />}

            {screen !== "start" && character && (
                <RightMenu
                    navigate={stableNavigate}
                    adminLoggedIn={adminLoggedIn}
                    logoutPlayer={stableLogout}
                    characterName={character?.name ?? ""}
                    characterVillage={character?.village ?? ""} characterClan={character?.clan ?? ""}
                    profession={character?.profession ?? null}
                    screen={screen}
                />
            )}

            {screen !== "start" && character && (
                <MobileNav
                    navigate={stableNavigate}
                    adminLoggedIn={adminLoggedIn}
                    logoutPlayer={stableLogout}
                    character={character}
                    currentSector={currentSector}
                    screen={screen}
                />
            )}

            {incomingAttackBanner && (
                <div className="incoming-attack-banner">{incomingAttackBanner}</div>
            )}

            {/* Global incoming challenge notification — visible from any screen */}
            {character && (() => {
                const pending = duelChallenges.filter(c =>
                    !c.accepted &&
                    !c.declined &&
                    !c.sectorAttack &&
                    c.toName.toLowerCase() === character.name.toLowerCase()
                );
                if (!pending.length) return null;
                const c = pending[0];
                const isPet = c.mode === "clanWarPet" || c.mode === "rankedPet";
                const isRanked = c.mode === "ranked";
                const label = c.mode === "rankedPet" ? "ranked pet battle" : isPet ? "pet battle" : isRanked ? "ranked duel" : "spar";
                const busy = processingChallengeIds.includes(c.id);
                return (
                    <div className="incoming-attack-banner" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                        <span>⚔️ <strong>{c.fromName}</strong> challenged you to a {label}!</span>
                        <div style={{ display: "flex", gap: 6 }}>
                            <button
                                style={{ padding: "4px 14px", background: "#22c55e", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}
                                disabled={busy}
                                onClick={() => {
                                    if (isPet) {
                                        void acceptPetChallengeGlobal(c);
                                    } else {
                                        void acceptChallengeGlobal(c);
                                    }
                                }}
                            >{busy ? "Opening..." : "✅ Accept"}</button>
                            <button
                                style={{ padding: "4px 14px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}
                                disabled={busy}
                                onClick={() => declineChallengeGlobal(c)}
                            >❌ Decline</button>
                        </div>
                        {pending.length > 1 && <span style={{ opacity: 0.7, fontSize: "0.85em" }}>+{pending.length - 1} more</span>}
                    </div>
                );
            })()}

            <main
                className={`center-game screen-${screen}`}
                style={{
                    // Darkening overlay only — the scene comes from `.app-background`.
                    // (Re-tiling the image here was the second source of the repeat.)
                    backgroundImage: `linear-gradient(rgba(2, 6, 23, 0.30), rgba(2, 6, 23, 0.72))`,
                }}
            >
                {/* Suspense for lazy screens; the per-screen ErrorBoundary (keyed by screen) isolates a render crash to one view so the nav stays usable and navigating away clears it. */}
                <Suspense fallback={<div className="lazy-screen-fallback" style={{ padding: "2rem", textAlign: "center", color: "#94a3b8" }}>Loading…</div>}>
                <ScreenErrorBoundary key={screen}>
                {character && screen !== "start" && (
                    <MobileStatusHUD
                        character={character}
                        onBack={canGoBack ? goBack : undefined}
                    />
                )}
                <div
                    className="journey-banner"
                    style={{ backgroundImage: `url(${shinobiBanner})` }}
                >
                    {character && screen !== "start" && (
                        <BannerMobileTimers
                            activeTraining={activeTraining}
                            activeJutsuTraining={activeJutsuTraining}
                            pets={character.pets ?? []}
                        />
                    )}
                    {character && (
                        <div className="journey-live-stats">
                            <div className="stat-box">
                                <span>RANK</span>
                                <strong>{character.rankTitle}</strong>
                            </div>

                            <div className="stat-box">
                                <span>LVL</span>
                                <strong>{character.level}/100</strong>
                            </div>

                            <div className="stat-box">
                                <span>XP</span>
                                <strong>
                                    {character.level >= MAX_LEVEL
                                        ? "MAX"
                                        : `${character.xp}/${xpNeeded(character.level)}`}
                                </strong>
                            </div>

                            <div className="stat-box">
                                <span>RYO</span>
                                <strong>{character.ryo}</strong>
                            </div>
                            <div className="stat-box" style={{ color: "#ce93d8" }}>
                                <span>💎 SHARDS</span>
                                <strong>{character.fateShards}</strong>
                            </div>
                        </div>
                    )}
                </div>

                {screen === "start" && restoringSession && (
                    <div className="start-screen">
                        <div className="start-title-block">
                            <h1 className="start-title">
                                Shinobi<span className="start-title-mark">✦</span>Journey
                            </h1>
                            <p className="start-subtitle">
                                Restoring {bootAccountName || "your session"}…
                            </p>
                        </div>
                        <p className="start-hint">Reconnecting to your save — this only takes a moment.</p>
                    </div>
                )}
                {/* Phase 1.3: while an optimistic hub paint reconciles with the
                    server, the cached screen is rendered underneath but a
                    transparent overlay blocks all interaction — preserving the
                    old gate's "no actions until the save loads" invariant (so a
                    rare stale battle lock can't be acted around). Lifts the
                    instant restoringSession flips false (reconcile / timeout). */}
                {optimisticRestore && restoringSession && (
                    <div
                        className="restore-reconcile-overlay"
                        aria-busy="true"
                        aria-label="Syncing your save"
                        onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        style={{
                            position: "fixed", inset: 0, zIndex: 99999,
                            background: "rgba(8,12,24,0.18)",
                            display: "flex", alignItems: "flex-end", justifyContent: "center",
                            pointerEvents: "auto", cursor: "progress",
                        }}
                    >
                        <div style={{ marginBottom: "1.5rem", padding: "0.4rem 0.9rem", borderRadius: "999px", background: "rgba(15,23,42,0.85)", color: "#cbd5e1", fontSize: "0.8rem", border: "1px solid rgba(148,163,184,0.25)" }}>
                            Syncing…
                        </div>
                    </div>
                )}
                {screen === "start" && !restoringSession && (
                    <StartScreen
                        onCreate={createPlayerAccount}
                        onLogin={loginPlayerAccount}
                        initialName={restoreFailed ? bootAccountName : ""}
                        notice={restoreFailed ? "Your session timed out — log back in to restore your save. No progress is lost." : ""}
                        onAdmin={(prefilledPassword) => {
                            // If the user typed "Admin 1" / "Admin 2" in the
                            // player login form, the StartScreen forwards the
                            // password they typed so they don't have to retype
                            // it on the admin screen. Stash it in
                            // sessionStorage where AdminLogin reads it.
                            if (prefilledPassword) {
                                sessionStorage.setItem("admin:prefill-pw", prefilledPassword);
                            }
                            navigate(adminLoggedIn ? "adminPanel" : "adminLogin");
                        }}
                    />
                )}

                {/* App-level battle-lock keeper for the Hollow Gate tile seal.
                    Lives here (not inside the duel screen, which has many render
                    branches + leave paths) and is driven by the App-level
                    hollowGateTileGameActive flag, so it reliably locks while the
                    seal is in progress and resolves on win/lose/leave. A refresh
                    is forced back into the seal instead of escaping to the shrine.
                    (The tile board itself isn't persisted — re-entry starts a
                    fresh seal; exact board-resume isn't worth the risk for a card
                    game.) */}
                {character && (
                    <BattleLockKeeper
                        active={hollowGateTileGameActive}
                        kind="hollowGateTiles"
                        screen="hollowGateTiles"
                        playerName={character.name}
                    />
                )}

                {screen === "adminLogin" && (
                    <AdminLogin
                        onLogin={async (account, pw, role) => {
                            setAdminLoggedIn(true);
                            setAdminAccount(account);
                            sessionStorage.setItem("admin:pw", pw);
                            // Persist the role so a refresh doesn't lose it
                            // and re-show restricted tabs to Admin 2.
                            sessionStorage.setItem("admin:role", role);
                            setAdminPw(pw);
                            setAdminRole(role);
                            setCurrentAccountName(account); // needed for save button + auto-save
                            const adminChar = createAdminCharacter(account);
                            setCharacter(adminChar);
                            setScreen("adminPanel");
                            // Restore admin content only — do NOT call applyServerSnapshot here
                            // because it overrides setScreen("adminPanel") with setScreen("village")
                            // and can corrupt currentAccountName if the save contains unexpected data.
                            const snap = await pullSaveFromServer(account);
                            if (snap) {
                                if (snap.creatorJutsus) setCreatorJutsus((snap.creatorJutsus as Jutsu[]).map(normalizeJutsu));
                                if (snap.creatorAis) setCreatorAis(balanceExistingAiProfiles(snap.creatorAis as CreatorAi[], savedJutsuPool(snap)));
                                if (snap.creatorEvents) setCreatorEvents(snap.creatorEvents as CreatorEvent[]);
                                if (snap.creatorMissions) setCreatorMissions(snap.creatorMissions as CreatorMission[]);
                                if (snap.creatorRaids) setCreatorRaids(snap.creatorRaids as CreatorRaid[]);
                                if (snap.creatorCards) setCreatorCards(snap.creatorCards as TileCard[]);
                                if (snap.creatorItems) setCreatorItems(snap.creatorItems as GameItem[]);
                                if (snap.editablePets) setEditablePets(mergeMissingBuiltInPets(snap.editablePets as Pet[]));
                                if (snap.savedBloodlines) setSavedBloodlines((snap.savedBloodlines as SavedBloodline[]).map((b) => ({ ...b, jutsus: b.jutsus.map(normalizeJutsu) })));
                                if (snap.petEncounterVn) setPetEncounterVn(snap.petEncounterVn as CreatorEvent);
                                if (snap.ancientChestVn) setAncientChestVn(snap.ancientChestVn as CreatorEvent);
                                loadedCatsRef.current.clear();
                                clearImgCache();
                                setTimeout(() => {
                                    void loadCategory('item'); void loadCategory('pet');
                                    void loadCategory('card'); void loadCategory('jutsu');
                                    void loadCategory('event'); void loadCategory('avatar');
                                    void loadCategory('ai'); void loadCategory('bloodline');
                                }, 0);
                            }
                        }}
                        setScreen={setScreen}
                    />
                )}

                {screen === "adminPanel" && character && (
                    <AdminPanel
                        character={character}
                        creatorItems={creatorItems}
                        setCreatorItems={setCreatorItems}
                        updateCharacter={setCharacter}
                        creatorJutsus={creatorJutsus}
                        setCreatorJutsus={setCreatorJutsus}
                        creatorAis={creatorAis}
                        setCreatorAis={setCreatorAis}
                        creatorEvents={creatorEvents}
                        setCreatorEvents={setCreatorEvents}
                        creatorMissions={creatorMissions}
                        setCreatorMissions={setCreatorMissions}
                        creatorRaids={creatorRaids}
                        setCreatorRaids={setCreatorRaids}
                        creatorCards={creatorCards}
                        setCreatorCards={setCreatorCards}
                        petEncounterVn={petEncounterVn}
                        setPetEncounterVn={setPetEncounterVn}
                        ancientChestVn={ancientChestVn}
                        setAncientChestVn={setAncientChestVn}
                        editablePets={editablePets}
                        setEditablePets={setEditablePets}
                        selectedPetId={selectedPetId}
                        setSelectedPetId={setSelectedPetId}
                        currentSector={currentSector}
                        savedBloodlines={savedBloodlines}
                        setSavedBloodlines={setSavedBloodlines}
                        setAdminLoggedIn={setAdminLoggedIn}
                        setScreen={setScreen}
                        onEditBloodline={(bl) => {
                            setBloodlineMakerEditingBloodline(bl);
                            setBloodlineMakerInitialRank(bl.rank);
                            setBloodlineMakerInitialElement(bl.specialElement ?? "");
                            setBloodlineMakerRankLocked(false);
                            setScreen("bloodlineMaker");
                        }}
                        playerRoster={playerRoster}
                        allServerPlayers={allServerPlayers}
                        adminPw={adminPw}
                        adminRole={adminRole}
                        onSave={async () => {
                            const adminSaveName = adminAccount || currentAccountName;
                            if (!adminSaveName) return;
                            // Admin may be editing another player's slot — don't echo
                            // THIS player's version ref against the target's save.
                            await pushSaveToServer(character, adminSaveName, undefined, { echoVersion: false });
                        }}
                        onTestHollowGate={adminTestEnterHollowGateShrine}
                        onHollowGateForceUnlock={adminHollowGateForceUnlock}
                        onHollowGateResetIntro={adminHollowGateResetIntro}
                        onHollowGateClearRun={adminHollowGateClearRun}
                        onHollowGateGrantKey={adminHollowGateGrantKey}
                        sharedImages={sharedImages}
                        setSharedImages={setSharedImages}
                        hollowGateVillageUnlocked={isHollowGateUnlocked(loadVillageState(character.village))}
                        onReloadImages={() => {
                            loadedCatsRef.current.clear();
                            clearImgCache();
                            setTimeout(() => {
                                void loadCategory('item'); void loadCategory('pet');
                                void loadCategory('card'); void loadCategory('jutsu');
                                void loadCategory('event'); void loadCategory('avatar');
                                void loadCategory('ai'); void loadCategory('bloodline');
                            }, 0);
                        }}
                    />
                )}

                {activeTriggeredEvent && character && (
                    <TriggeredVisualNovel
                        event={activeTriggeredEvent}
                        character={character}
                        pageIndex={triggerPage}
                        lineIndex={triggerLine}
                        setPageIndex={setTriggerPage}
                        setLineIndex={setTriggerLine}
                        onCancel={() => setActiveTriggeredEvent(null)}
                        onComplete={() => completeTriggeredEvent(activeTriggeredEvent)}
                        onBattle={startTriggeredEventArenaBattle}
                        onChoice={(c) => { const t = c.trait; if (t) setCharacter(prev => prev ? addStoryTrait(prev, t) : prev); }}
                        sharedImages={sharedImages}
                    />
                )}

                {!activeTriggeredEvent && screen === "dungeon" && character && activeDungeonEvent && (
                    <DungeonEncounter
                        event={activeDungeonEvent}
                        character={character}
                        updateCharacter={setCharacter}
                        creatorCards={creatorCards}
                        editablePets={editablePets}
                        stage={dungeonStage}
                        pageIndex={dungeonPage}
                        lineIndex={dungeonLine}
                        setPageIndex={setDungeonPage}
                        setLineIndex={setDungeonLine}
                        onStartAiFight={startDungeonAiFight}
                        onTileWin={() => { setDungeonStage("pet"); setDungeonPage(2); setDungeonLine(0); }}
                        onPetWin={completeDungeon}
                        onLeave={leaveDungeon}
                        sharedImages={sharedImages}
                    />
                )}

                {/* ═══════════════════════════════════════════════════════════
                    ⛩  HOLLOW GATE SHRINE VIEW  (start)
                    ═══════════════════════════════════════════════════════════
                    Inline view because it closes over many App-scoped values
                    (state setters, helper functions, sharedImages, character).
                    A true file extraction would require exporting 15+ types
                    and helpers from App — deferred to avoid that churn.
                    Sections inside this block:
                      • Intro VN overlay (first-time-only)
                      • Header (floor, threat, keys, torch)
                      • Grid + side panel (objectives, legend, pet status)
                      • Movement controls
                      • Event log
                      • Event modal overlay (per-tile)
                      • Hidden Chamber overlay
                    ═══════════════════════════════════════════════════════════ */}
                {!activeTriggeredEvent && screen === "hollowGateShrine" && character && hollowGateRun && (() => {
                    const run = hollowGateRun;
                    const pet = character.pets.find(p => p.id === character.activePetId);
                    const petEligible = isActivePetEligibleForHollowGate();
                    // Image keys served from the shared KV by the Hollow Gate admin tab.
                    const shrineBg = sharedImages["shrine:hollow-gate-background"];
                    const cardBackground = shrineBg
                        ? `linear-gradient(180deg, rgba(15,9,28,0.78), rgba(8,4,18,0.88)), url(${shrineBg}) center/cover no-repeat`
                        : "linear-gradient(180deg, rgba(15,9,28,0.92), rgba(8,4,18,0.95))";
                    return (
                        <div className="card hollow-gate-shrine" style={{ background: cardBackground, color: "#e9d5ff", padding: 16, borderRadius: 12 }}>
                            {/* First-entry Intro VN overlay — blocks interaction until dismissed. */}
                            {hollowGateIntroPage !== null && (() => {
                                const page = hollowGateIntroPages[hollowGateIntroPage] ?? hollowGateIntroPages[0];
                                const introImage = sharedImages[page.imageKey];
                                const isLast = hollowGateIntroPage >= hollowGateIntroPages.length - 1;
                                return (
                                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.86)", overflowY: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1100, padding: "16px 12px max(16px, env(safe-area-inset-bottom, 16px))" }}>
                                        <div style={{ background: "linear-gradient(180deg, rgba(15,9,28,0.97), rgba(8,4,18,0.99))", border: "2px solid rgba(168,85,247,0.6)", borderRadius: 12, padding: 24, maxWidth: 640, width: "92%", color: "#e9d5ff", boxShadow: "0 0 70px rgba(168,85,247,0.4)" }}>
                                            <p className="act-label" style={{ color: "#a855f7", letterSpacing: 2 }}>HOLLOW GATE — INTRODUCTION</p>
                                            <h2 style={{ margin: "0 0 12px", color: "#faf5ff" }}>{page.title}</h2>
                                            {introImage && (
                                                <img src={introImage} alt={page.title} style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 8, marginBottom: 12 }} />
                                            )}
                                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                                                {page.lines.map((line, i) => (
                                                    <p key={i} style={{ margin: 0, lineHeight: 1.55 }}>{line}</p>
                                                ))}
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <small style={{ color: "#a78bfa" }}>Page {hollowGateIntroPage + 1} / {hollowGateIntroPages.length}</small>
                                                <div style={{ display: "flex", gap: 8 }}>
                                                    {hollowGateIntroPage > 0 && (
                                                        <button onClick={() => setHollowGateIntroPage(hollowGateIntroPage - 1)}>Back</button>
                                                    )}
                                                    <button
                                                        onClick={() => {
                                                            if (isLast) setHollowGateIntroPage(null);
                                                            else setHollowGateIntroPage(hollowGateIntroPage + 1);
                                                        }}
                                                        style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)", borderColor: "#c4b5fd" }}
                                                    >
                                                        {isLast ? "Enter the Shrine" : "Next"}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                                <div>
                                    <p className="act-label" style={{ color: "#a855f7", letterSpacing: 2 }}>⛩ HOLLOW GATE SHRINE</p>
                                    <h2 style={{ margin: 0, color: "#faf5ff" }}>Floor {run.floor} / {HOLLOW_GATE_MAX_FLOOR} · {run.completed ? "Warden Defeated" : "Shadow Miasma"}</h2>
                                </div>
                                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                                    <div style={{ minWidth: 200 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, alignItems: "center" }}>
                                            <span>Threat{run.threat >= 80 && (
                                                <span style={{
                                                    marginLeft: 6,
                                                    fontSize: 11,
                                                    color: "#fda4af",
                                                    fontWeight: 700,
                                                    animation: "hgPulse 1s ease-in-out infinite",
                                                }}>⚠ AMBUSH IMMINENT</span>
                                            )}</span>
                                            <span style={{ color: run.threat >= 80 ? "#fda4af" : "#c4b5fd" }}>{run.threat}%</span>
                                        </div>
                                        <div style={{
                                            height: 8,
                                            background: "rgba(168,85,247,0.18)",
                                            borderRadius: 4,
                                            overflow: "hidden",
                                            border: run.threat >= 80 ? "1px solid #fda4af" : undefined,
                                            boxShadow: run.threat >= 80 ? "0 0 8px rgba(248,113,113,0.55)" : undefined,
                                        }}>
                                            <div style={{ width: `${run.threat}%`, height: "100%", background: run.threat >= 80 ? "linear-gradient(90deg,#a855f7,#fda4af)" : "linear-gradient(90deg,#7c3aed,#a855f7)" }} />
                                        </div>
                                        <style>{`@keyframes hgPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
                                    </div>
                                    <div style={{ fontSize: 13 }}>
                                        <span title="Shrine Keys">🔑 {run.keys}</span>
                                        <span style={{ marginLeft: 12 }} title="Torch of Reiki">🔥 {run.torch}/10</span>
                                        <span style={{ marginLeft: 12 }} title="Banked Hollow Shards">💎 {character.hollowShards ?? 0}</span>
                                        {(() => { const ar = hollowGateClawBackPreview(character, run); const rr = ar.ryo ?? 0; const rs = ar.hollowShards ?? 0; return (rr || rs) ? <span style={{ marginLeft: 12, color: "#fda4af" }} title="Lost if you die now — Sanctify Loot to protect it">⚠ {[rr ? `${rr} ryo` : "", rs ? `${rs}💎` : ""].filter(Boolean).join(" · ")} at risk</span> : null; })()}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 16 }}>
                                {/* Grid: room-flood visibility lights the room you're in; walls always
                                    read as stone; surprise tiles stay disguised until stepped on. */}
                                {(() => {
                                    // Room-flood visibility (whole floor when Diviner's Eye is active).
                                    const visibleSet = run.diviner
                                        ? new Set(run.tiles.map((_, i) => i))   // Diviner's Eye — whole floor lit
                                        : computeHollowGateVisible(run);
                                    // Pull all admin-generated terrain textures once per render. Each is
                                    // optional — the renderer falls through to a CSS gradient if missing.
                                    const doorTexture = sharedImages["shrine:tile-door"];
                                    // Variant texture banks: per-terrain arrays. The atlas slicer fills
                                    // `shrine:tile-X-0..N` entries; this fallback gathers them. If only
                                    // the base (no -0 suffix) exists, we use that single tile everywhere.
                                    function gatherVariants(prefix: string, limit = 4): string[] {
                                        const variants: string[] = [];
                                        for (let i = 0; i < limit; i += 1) {
                                            const v = sharedImages[`${prefix}-${i}`];
                                            if (v) variants.push(v);
                                        }
                                        if (variants.length === 0) {
                                            const base = sharedImages[prefix];
                                            if (base) variants.push(base);
                                        }
                                        return variants;
                                    }
                                    const wallVariants = gatherVariants("shrine:tile-wall", 4);
                                    const roomFloorVariants = gatherVariants("shrine:tile-room-floor", 4);
                                    const corridorFloorVariants = gatherVariants("shrine:tile-corridor-floor", 4);
                                    // Decoration sprites — sprinkled on top of room floors by the generator.
                                    // Legacy 4 atlas decos (shrine:deco-0..3) — kept for back-compat with old
                                    // saved runs that stored a 0-3 decoration index on tiles. New runs use
                                    // the combined pool below.
                                    const legacyDecorations = [
                                        sharedImages["shrine:deco-0"],
                                        sharedImages["shrine:deco-1"],
                                        sharedImages["shrine:deco-2"],
                                        sharedImages["shrine:deco-3"],
                                    ];
                                    // User-picker decorations (shrine:icon-deco-1..8) — always available.
                                    const userDecorations: string[] = [];
                                    for (let i = 1; i <= 8; i += 1) {
                                        const v = sharedImages[HOLLOW_GATE_ICON_KEY(`deco-${i}`)];
                                        if (v) userDecorations.push(v);
                                    }
                                    // Per-theme decorations — preferred when the tile sits in a themed room.
                                    function themedDecorations(theme: string | undefined): string[] {
                                        if (!theme) return [];
                                        const out: string[] = [];
                                        for (const role of ["deco-1", "deco-2"]) {
                                            const v = sharedImages[`shrine:icon-theme-${theme}-${role}`];
                                            if (v) out.push(v);
                                        }
                                        return out;
                                    }
                                    // Build the decoration pool for a given cell: themed first (so themed
                                    // rooms feel cohesive), then user picks, then atlas defaults. Returns
                                    // the chosen image url or undefined if no decoration art exists at all.
                                    function pickDecorationFor(idx: number, theme: string | undefined, hintIndex: number): string | undefined {
                                        const pool = [
                                            ...themedDecorations(theme),
                                            ...userDecorations,
                                            ...legacyDecorations.filter((x): x is string => Boolean(x)),
                                        ];
                                        if (pool.length === 0) return undefined;
                                        // Mix the tile index with the legacy hint so old runs (which stamped
                                        // a 0-3 index per tile) still get stable picks; new runs just pass 0.
                                        const seed = ((idx * 2654435761) ^ (hintIndex * 16777619)) >>> 0;
                                        return pool[seed % pool.length];
                                    }
                                    // Deterministic cell-index hash so a given cell always picks the same
                                    // variant (no flicker between renders). Standard 32-bit mixing constant.
                                    function variantPick(idx: number, count: number): number {
                                        if (count <= 1) return 0;
                                        return ((idx * 2654435761) >>> 0) % count;
                                    }
                                    // Helper: layered background for a terrain texture (returns CSS string).
                                    function bgFromTexture(image: string | undefined, fallback: string, overlay = "rgba(15,9,28,0.35)") {
                                        return image
                                            ? `linear-gradient(135deg, ${overlay}, rgba(8,4,18,0.55)), url(${image}) center/cover no-repeat`
                                            : fallback;
                                    }
                                    // Room theme tile lookup. Each room has a theme stamped on it; for a
                                    // given (theme, role) try shrine:icon-theme-<theme>-<role>. If absent
                                    // we fall back to the base atlas tile. Themes only apply to tiles that
                                    // belong to a room (room_floor + doors); corridors stay default.
                                    function themedTileFor(role: "wall" | "floor" | "corridor" | "door", theme: string | undefined): string | undefined {
                                        if (!theme) return undefined;
                                        return sharedImages[`shrine:icon-theme-${theme}-${role}`];
                                    }
                                    function bgForTerrain(terrainKind: HollowGateTerrain, idx: number, theme?: string): string {
                                        if (terrainKind === "wall") {
                                            const themed = themedTileFor("wall", theme);
                                            const v = themed ?? wallVariants[variantPick(idx, wallVariants.length)];
                                            return v
                                                ? `linear-gradient(135deg, rgba(15,9,28,0.35), rgba(8,4,18,0.55)), url(${v}) center/cover no-repeat`
                                                : "linear-gradient(135deg, #1c1430 0%, #0e0820 40%, #2a1f3e 100%)";
                                        }
                                        if (terrainKind === "corridor_floor") {
                                            const themed = themedTileFor("corridor", theme);
                                            const v = themed ?? corridorFloorVariants[variantPick(idx, corridorFloorVariants.length)];
                                            return bgFromTexture(v, "linear-gradient(135deg, rgba(40,28,72,0.7), rgba(28,18,54,0.85))");
                                        }
                                        if (terrainKind === "door") {
                                            const themed = themedTileFor("door", theme);
                                            return bgFromTexture(themed ?? doorTexture, "linear-gradient(135deg, rgba(120,72,32,0.5), rgba(64,40,18,0.75))", "rgba(40,20,8,0.3)");
                                        }
                                        // room_floor (default)
                                        const themed = themedTileFor("floor", theme);
                                        const v = themed ?? roomFloorVariants[variantPick(idx, roomFloorVariants.length)];
                                        return bgFromTexture(v, "linear-gradient(135deg, rgba(50,38,82,0.7), rgba(34,24,60,0.85))");
                                    }
                                    // Per-cell theme resolver — null roomId (wall / corridor outside a room)
                                    // gets the room theme of the nearest 4-neighbour room cell, so walls
                                    // bordering a themed room pick up that theme. Falls back to "" if no
                                    // neighbour has a theme.
                                    function tileTheme(idx: number): string | undefined {
                                        const tile = run.tiles[idx];
                                        if (!tile) return undefined;
                                        if (tile.roomId != null && run.roomThemes) return run.roomThemes[tile.roomId];
                                        if (!run.roomThemes) return undefined;
                                        // Look at 4-cardinal neighbours; first room neighbour wins.
                                        const cx = idx % run.width;
                                        const cy = Math.floor(idx / run.width);
                                        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                                            const nx = cx + dx, ny = cy + dy;
                                            if (nx < 0 || ny < 0 || nx >= run.width || ny >= run.height) continue;
                                            const nTile = run.tiles[ny * run.width + nx];
                                            if (nTile?.roomId != null && run.roomThemes[nTile.roomId]) {
                                                return run.roomThemes[nTile.roomId];
                                            }
                                        }
                                        return undefined;
                                    }
                                    // Variant-aware icon lookup for a content role (chest, battle, etc.).
                                    // Tries shrine:icon-<role>-1..N in deterministic hash order, falls back
                                    // to shrine:icon-<role> (legacy single-icon assignments).
                                    function pickRoleIconImage(role: string, idx: number): string | undefined {
                                        const cfg = HOLLOW_GATE_ICON_ROLES[role];
                                        if (!cfg) return undefined;
                                        if (cfg.count === 1) return sharedImages[HOLLOW_GATE_ICON_KEY(role)];
                                        const assigned: string[] = [];
                                        for (let i = 1; i <= cfg.count; i += 1) {
                                            const v = sharedImages[HOLLOW_GATE_ICON_KEY(`${role}-${i}`)];
                                            if (v) assigned.push(v);
                                        }
                                        if (assigned.length === 0) return sharedImages[HOLLOW_GATE_ICON_KEY(role)];
                                        return assigned[variantPick(idx, assigned.length)];
                                    }
                                    return (
                                <div className="hollow-gate-grid" style={{ display: "grid", gridTemplateColumns: `repeat(${run.width}, 1fr)`, gap: 3, background: "rgba(0,0,0,0.55)", padding: 8, borderRadius: 8 }}>
                                    {run.tiles.map((tile, i) => {
                                        const x = i % run.width;
                                        const y = Math.floor(i / run.width);
                                        const isPlayer = x === run.playerX && y === run.playerY;
                                        const revealed = tile.revealed;
                                        // Lit when the room-flood visibility set includes this index.
                                        const visible = visibleSet.has(i);
                                        // Wall test prefers terrain; falls back to kind for legacy runs.
                                        const wall = tile.terrain === "wall" || (tile.terrain == null && tile.kind === "wall");
                                        const terrainKind: HollowGateTerrain =
                                            tile.terrain ?? (tile.kind === "wall" ? "wall" : "room_floor");

                                        // Background by tile state: only currently-visible tiles draw
                                        // their terrain (via bgForTerrain variant banks); the rest = fog.
                                        const cellTheme = tileTheme(i);
                                        let bg: string;
                                        if (wall) {
                                            bg = visible ? bgForTerrain("wall", i, cellTheme) : "rgba(7,4,15,0.92)";
                                        } else if (isPlayer) {
                                            bg = "linear-gradient(135deg, #2563eb, #7c3aed)";
                                        } else if (visible) {
                                            // Terrain base layer, then optional decoration sprite, then content tint.
                                            let terrainBase = bgForTerrain(terrainKind, i, cellTheme);
                                            // Wing color-coding: tint floors/doors by their wing (Treasure/Beast/Trial).
                                            const wTheme = wingThemeAt(run, i);
                                            if (wTheme && WING_TINT[wTheme]) terrainBase = `linear-gradient(${WING_TINT[wTheme]}, ${WING_TINT[wTheme]}), ${terrainBase}`;
                                            if (tile.decoration != null) {
                                                const decoImg = pickDecorationFor(i, cellTheme, tile.decoration);
                                                if (decoImg) {
                                                    terrainBase = `url(${decoImg}) center/80% no-repeat, ${terrainBase}`;
                                                }
                                            }
                                            // Surprise tiles (trap/battle/elite/pet) stay disguised as
                                            // floor until actually stepped on (revealed) — tint hidden.
                                            const isSurpriseKind = tile.kind === "trap"
                                                || tile.kind === "battle"
                                                || tile.kind === "elite"
                                                || tile.kind === "pet_event"
                                                || tile.kind === "pet_battle";
                                            const hideContent = isSurpriseKind && !revealed;
                                            const contentTint = hideContent ? null
                                                : tile.kind === "boss" ? "linear-gradient(135deg, rgba(127,29,29,0.7), rgba(185,28,28,0.7))"
                                                : tile.kind === "trap" ? "rgba(239,68,68,0.22)"
                                                : tile.kind === "chest" ? "rgba(234,179,8,0.22)"
                                                : tile.kind === "shrine" ? "rgba(168,85,247,0.26)"
                                                : tile.kind === "exit" ? "rgba(34,197,94,0.22)"
                                                : tile.kind === "locked" ? "rgba(148,163,184,0.22)"
                                                : tile.kind === "npc" ? "rgba(56,189,248,0.22)"
                                                : tile.kind === "descend" ? "rgba(192,132,252,0.26)"
                                                : tile.kind === "battle" ? "rgba(248,113,113,0.18)"
                                                : tile.kind === "elite" ? "rgba(220,38,38,0.26)"
                                                : tile.kind === "pet_event" ? "rgba(96,165,250,0.18)"
                                                : tile.kind === "pet_battle" ? "rgba(251,146,60,0.24)"  // beast orange
                                                : tile.kind === "tile_game" ? "rgba(45,212,191,0.22)"   // tile-game teal
                                                : tile.kind === "story" ? "rgba(250,204,21,0.18)"
                                                : tile.kind === "shard_vein" ? "rgba(167,139,250,0.24)"
                                                : null;
                                            bg = contentTint
                                                ? `linear-gradient(${contentTint}, ${contentTint}), ${terrainBase}`
                                                : terrainBase;
                                        } else {
                                            bg = "rgba(7,4,15,0.92)"; // deep fog
                                        }

                                        // Wall styling: brick-ish pattern via inset shadow.
                                        // Only walls that are CURRENTLY visible (perimeter of the lit
                                        // room) get the shadow detail — fog walls stay flat dark.
                                        const wallShadow = wall && visible ? "inset 0 0 0 1px rgba(168,85,247,0.18), inset 2px 2px 0 rgba(0,0,0,0.4)" : undefined;

                                        // Icon shows only on visible tiles; surprise tiles also need
                                        // `revealed` (stay disguised as floor until stepped on).
                                        const isSurpriseKind = tile.kind === "trap"
                                            || tile.kind === "battle"
                                            || tile.kind === "elite"
                                            || tile.kind === "pet_event"
                                            || tile.kind === "pet_battle";
                                        // Icon = atlas image (shrine:icon-<slot>) if assigned, else emoji.
                                        // Slot id mirrors HOLLOW_GATE_ICON_SLOTS (a few kinds remap below).
                                        function iconSlotIdFor(k: HollowGateTileKind): string | null {
                                            if (k === "pet_event") return "pet";
                                            if (k === "pet_battle") return "petbattle";
                                            if (k === "tile_game") return "tilegame";
                                            if (k === "shard_vein") return "shardvein";
                                            if (k === "empty" || k === "wall") return null;
                                            return k;
                                        }
                                        const showIcon =
                                            isPlayer ? true
                                            : wall ? false
                                            : !visible ? false
                                            : isSurpriseKind && !revealed ? false
                                            : true;
                                        const iconSlotId = isPlayer ? "you" : iconSlotIdFor(tile.kind);
                                        // Variant-aware icon pick (shrine:icon-<role>-1..N). Player tile
                                        // falls back to the player's own avatar if no "you" slot is assigned.
                                        const playerAvatar = isPlayer
                                            ? (character.avatarImage || sharedImages[`avatar:${character.name.toLowerCase()}`])
                                            : undefined;
                                        const iconImage = showIcon && iconSlotId
                                            ? (pickRoleIconImage(iconSlotId, i) ?? playerAvatar)
                                            : undefined;
                                        let icon: string;
                                        if (!showIcon) icon = !visible && !wall ? "·" : "";       // fog dot or blank
                                        else if (isPlayer) icon = "🥷";
                                        else {
                                            icon = hollowGateTileIconForKind(tile.kind);
                                            // Label wing doors with their destination (🏆/🐺/⚔) for an informed choice.
                                            if (tile.terrain === "door") { const dt = wingThemeAt(run, i); if (dt && WING_GLYPH[dt]) icon = WING_GLYPH[dt]; }
                                        }

                                        // Opacity: player = full, visible cells = full so the lit
                                        // room reads clearly, anything else = dim fog dot.
                                        const iconOpacity = isPlayer || visible ? 1 : 0.30;

                                        return (
                                            <div
                                                key={i}
                                                title={wall ? "Wall" : visible ? tile.kind : "Out of sight"}
                                                style={{
                                                    aspectRatio: "1 / 1",
                                                    background: bg,
                                                    border: isPlayer ? "2px solid #60a5fa"
                                                        : wall && visible ? "1px solid rgba(0,0,0,0.5)"
                                                        : visible ? "1px solid rgba(168,85,247,0.5)"
                                                        : "1px solid rgba(168,85,247,0.08)",
                                                    borderRadius: 4,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    fontSize: "clamp(16px, 2.6vw, 28px)",
                                                    color: isPlayer || visible ? "#f5f3ff" : "rgba(196,181,253,0.85)",
                                                    opacity: iconOpacity,
                                                    boxShadow: isPlayer ? "0 0 12px rgba(96,165,250,0.6)" : wallShadow,
                                                    transition: "background 200ms, opacity 200ms",
                                                }}
                                            >
                                                {iconImage ? (
                                                    <img
                                                        src={iconImage}
                                                        alt={iconSlotId ?? ""}
                                                        style={{
                                                            width: "78%",
                                                            height: "78%",
                                                            objectFit: "contain",
                                                            imageRendering: "pixelated",
                                                            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.7))",
                                                            pointerEvents: "none",
                                                        }}
                                                    />
                                                ) : icon}
                                            </div>
                                        );
                                    })}
                                </div>
                                    );
                                })()}

                                {/* Side panel */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    {/* Objectives panel — updates as the run progresses. */}
                                    {(() => {
                                        const reachedFloor5 = run.floor >= HOLLOW_GATE_MAX_FLOOR;
                                        const wardenDefeated = Boolean(run.completed) || run.tiles.some(t => t.kind === "boss" && t.resolved);
                                        const hiddenChamberFound = run.tiles.some(t => t.kind === "shrine" && t.resolved);
                                        const objectives = [
                                            { label: "Reach Floor 5", done: reachedFloor5 },
                                            { label: "Defeat the Hollow Gate Warden", done: wardenDefeated },
                                            { label: "Find a Hidden Chamber (optional)", done: hiddenChamberFound },
                                        ];
                                        return (
                                            <div style={{ background: "rgba(15,9,28,0.7)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 8, padding: 10, fontSize: 12 }}>
                                                <h4 style={{ margin: "0 0 6px", color: "#c4b5fd" }}>Objectives</h4>
                                                {objectives.map((obj, i) => (
                                                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                                                        <span style={{ color: obj.done ? "#86efac" : "#fda4af" }}>{obj.done ? "✓" : "○"}</span>
                                                        <span style={{ textDecoration: obj.done ? "line-through" : undefined, color: obj.done ? "#86efac" : "#e9d5ff" }}>{obj.label}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                    <div style={{ background: "rgba(15,9,28,0.7)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 8, padding: 10, fontSize: 12 }}>
                                        <h4 style={{ margin: "0 0 6px", color: "#c4b5fd" }}>Map Legend</h4>
                                        {/* Legend uses the same atlas icon as the dungeon when the admin
                                            assigned one via the Atlas Tile Picker. Falls back to the
                                            emoji glyph from hollowGateTileIconForKind otherwise. The
                                            "wall" slot uses the room-floor/wall atlas tile instead since
                                            walls render as terrain, not an icon. */}
                                        {(() => {
                                            // Map slot id → emoji fallback. Keeps the legend self-contained.
                                            const fallbackEmoji: Record<string, string> = {
                                                you: "🥷", battle: "⚔", elite: "☠", boss: "👹", trap: "▲",
                                                chest: "▣", shrine: "⛩", story: "📜", pet: "🐾", petbattle: "🐺",
                                                tilegame: "🀄", npc: "👤",
                                                descend: "▼", exit: "⇩", locked: "🔒", wall: "▦",
                                            };
                                            // Walls use the atlas wall tile (terrain), not an icon slot.
                                            const wallTileImg = sharedImages["shrine:tile-wall"] ?? sharedImages["shrine:tile-wall-0"];
                                            // Legend picks any-variant: shrine:icon-<role>-1 first, then
                                            // shrine:icon-<role>-2..N, then the legacy un-suffixed key.
                                            // This way the legend reflects "an assignment exists" without
                                            // caring which specific variant the admin filled.
                                            const anyAssignedVariant = (role: string): string | undefined => {
                                                const cfg = HOLLOW_GATE_ICON_ROLES[role];
                                                if (cfg && cfg.count > 1) {
                                                    for (let i = 1; i <= cfg.count; i += 1) {
                                                        const v = sharedImages[HOLLOW_GATE_ICON_KEY(`${role}-${i}`)];
                                                        if (v) return v;
                                                    }
                                                }
                                                return sharedImages[HOLLOW_GATE_ICON_KEY(role)];
                                            };
                                            const legendCell = (slotId: string, label: string) => {
                                                const img = slotId === "wall" ? wallTileImg : anyAssignedVariant(slotId);
                                                return (
                                                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                        {img ? (
                                                            <img src={img} alt="" style={{ width: 18, height: 18, objectFit: "contain", imageRendering: "pixelated" }} />
                                                        ) : (
                                                            <span style={{ width: 18, textAlign: "center" }}>{fallbackEmoji[slotId]}</span>
                                                        )}
                                                        <span>{label}</span>
                                                    </span>
                                                );
                                            };
                                            return (
                                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                                                    {legendCell("you",     "You")}      {legendCell("battle",  "Battle")}
                                                    {legendCell("elite",   "Elite")}    {legendCell("boss",    "Boss")}
                                                    {legendCell("trap",    "Trap")}     {legendCell("chest",   "Chest")}
                                                    {legendCell("shrine",  "Shrine")}   {legendCell("story",   "Story")}
                                                    {legendCell("pet",      "Pet")}        {legendCell("petbattle", "Hollow Beast")}
                                                    {legendCell("tilegame", "Tile Game")}  {legendCell("npc",       "Keeper")}
                                                    {legendCell("descend",  "Descend")}    {legendCell("exit",      "Leave")}
                                                    {legendCell("locked",   "Locked Door")}{legendCell("wall",      "Wall")}
                                                    <span>· Unexplored</span><span style={{ opacity: 0.55 }}>· In view (dim)</span>
                                                </div>
                                            );
                                        })()}
                                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(168,85,247,0.2)", fontSize: 11, color: "#a78bfa" }}>
                                            Layout: rooms connected by corridors; loot &amp; NPCs in rooms, ambushes in corridors.
                                        </div>
                                    </div>
                                    <div style={{ background: "rgba(15,9,28,0.7)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 8, padding: 10, fontSize: 12 }}>
                                        <h4 style={{ margin: "0 0 6px", color: "#c4b5fd" }}>Active Pet</h4>
                                        {pet ? (
                                            <>
                                                <div><strong>{pet.name}</strong> · Lv. {pet.level}</div>
                                                <div style={{ color: petEligible ? "#86efac" : "#fda4af" }}>
                                                    {petEligible ? "Joins shrine battles" : isPetOnExpedition(pet) ? "On expedition" : "Not PvE-ready (needs Lv. 50)"}
                                                </div>
                                            </>
                                        ) : <div className="hint">No active pet selected.</div>}
                                    </div>
                                </div>
                            </div>

                            {/* Movement controls — note: there is no voluntary "Leave Shrine"
                                button. You can only exit by stepping on the Exit (Leave) tile
                                or by dying. Each entry consumes 1 Hollow Gate Key. */}
                            <div style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                                <div style={{ fontSize: 12, color: "#c4b5fd" }}>WASD / Arrow Keys to move · or tap:</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 44px)", gap: 4 }}>
                                    <div />
                                    <button onClick={() => moveHollowGatePlayer(0, -1)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▲</button>
                                    <div />
                                    <button onClick={() => moveHollowGatePlayer(-1, 0)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>◀</button>
                                    <div />
                                    <button onClick={() => moveHollowGatePlayer(1, 0)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▶</button>
                                    <div />
                                    <button onClick={() => moveHollowGatePlayer(0, 1)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▼</button>
                                    <div />
                                </div>
                                <div style={{ fontSize: 11, color: "#fda4af", textAlign: "center" }}>
                                    No retreat. Reach the<br/>Leave tile (⇩) or die.
                                </div>
                            </div>

                            <HollowGateShardBar run={run} character={character} setRun={setHollowGateRun} setCharacter={setCharacter} pushLog={pushHollowGateLog} />

                            {/* Event log */}
                            <div style={{ marginTop: 12, background: "rgba(0,0,0,0.45)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 8, padding: 10, maxHeight: 140, overflowY: "auto", fontSize: 13 }}>
                                <h4 style={{ margin: "0 0 6px", color: "#c4b5fd" }}>Event Log</h4>
                                {hollowGateLog.length === 0 ? <p className="hint">The shrine watches in silence.</p> : hollowGateLog.map((line, i) => (
                                    <p key={i} style={{ margin: "2px 0" }}>• {line}</p>
                                ))}
                            </div>

                            {/* Event modal overlay — shows a generated tile image header
                                when the relevant 'shrine:tile-*' key has art. */}
                            {hollowGateEvent && (() => {
                                const tileImageKey =
                                    hollowGateEvent.kind === "trap" ? "shrine:tile-trap"
                                    : hollowGateEvent.kind === "chest" ? "shrine:tile-ancient-chest"
                                    : hollowGateEvent.kind === "pet_event" ? "shrine:tile-pet-encounter"
                                    : hollowGateEvent.kind === "pet_battle" ? "shrine:tile-hollow-beast"
                                    : hollowGateEvent.kind === "tile_game" ? "shrine:tile-tile-game"
                                    : hollowGateEvent.kind === "locked" ? "shrine:tile-sealed-door"
                                    : hollowGateEvent.kind === "npc" ? "shrine:tile-shrine-keeper"
                                    : hollowGateEvent.kind === "story" ? "shrine:tile-story"
                                    : hollowGateEvent.kind === "battle" || hollowGateEvent.kind === "elite" ? "shrine:tile-corrupted-shinobi"
                                    : null;
                                const tileImage = tileImageKey ? sharedImages[tileImageKey] : null;
                                return (
                                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", overflowY: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: "16px 12px max(16px, env(safe-area-inset-bottom, 16px))" }} onClick={() => {}}>
                                        <div style={{ background: "linear-gradient(180deg, rgba(15,9,28,0.97), rgba(8,4,18,0.99))", border: "2px solid rgba(168,85,247,0.5)", borderRadius: 12, padding: 24, maxWidth: 520, width: "90%", color: "#e9d5ff" }}>
                                            {tileImage && (
                                                <img src={tileImage} alt={hollowGateEvent.title} style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 8, marginBottom: 12 }} />
                                            )}
                                            <h3 style={{ margin: "0 0 12px", color: "#faf5ff" }}>{hollowGateEvent.title}</h3>
                                            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{hollowGateEvent.body}</p>
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                                                {hollowGateEvent.choices.map((c, i) => (
                                                    <button key={i} className={c.tone === "danger" ? "danger-button" : ""} onClick={c.onSelect}>{c.label}</button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Hidden Chamber overlay — wears the chamber background art if generated. */}
                            {hollowGateHiddenChamber && (() => {
                                const chamberBg = sharedImages["shrine:hidden-chamber-background"];
                                const chamberStyle = chamberBg
                                    ? `linear-gradient(180deg, rgba(30,15,50,0.82), rgba(15,5,30,0.92)), url(${chamberBg}) center/cover no-repeat`
                                    : "linear-gradient(180deg, rgba(30,15,50,0.97), rgba(15,5,30,0.99))";
                                return (
                                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", overflowY: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1001, padding: "16px 12px max(16px, env(safe-area-inset-bottom, 16px))" }}>
                                    <div style={{ background: chamberStyle, border: "2px solid rgba(168,85,247,0.6)", borderRadius: 12, padding: 28, maxWidth: 620, width: "92%", color: "#e9d5ff", boxShadow: "0 0 50px rgba(168,85,247,0.35)" }}>
                                        <p className="act-label" style={{ color: "#a855f7", letterSpacing: 2 }}>HIDDEN CHAMBER</p>
                                        <h2 style={{ margin: "0 0 12px", color: "#faf5ff" }}>Secret Area Discovered</h2>
                                        <p style={{ lineHeight: 1.6 }}>A ritual circle pulses violet at the chamber's center. Spirit lanterns hover above a cracked altar. An ancient tablet hums with sealed chakra, and a shrine relic floats untouched within the seal.</p>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, margin: "16px 0", fontSize: 13 }}>
                                            <div style={{ background: "rgba(168,85,247,0.12)", padding: 10, borderRadius: 6 }}><strong>Shrine Relic</strong><br/>{hollowGateHiddenChamber.relicTaken ? "Claimed" : "Available"}</div>
                                            <div style={{ background: "rgba(168,85,247,0.12)", padding: 10, borderRadius: 6 }}><strong>Spirit Lantern</strong><br/>Active</div>
                                            <div style={{ background: "rgba(168,85,247,0.12)", padding: 10, borderRadius: 6 }}><strong>Ancient Tablet</strong><br/>{hollowGateHiddenChamber.searched ? "Read" : "Readable"}</div>
                                        </div>
                                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                            <button disabled={hollowGateHiddenChamber.searched} onClick={() => {
                                                if (!hollowGateHiddenChamber) return;
                                                const xp = 60 + Math.floor(Math.random() * 50);
                                                const dust = 10 + Math.floor(Math.random() * 15);
                                                const leveled = gainXp(character, xp);
                                                setCharacter({ ...leveled, auraDust: (leveled.auraDust ?? 0) + dust });
                                                pushHollowGateLog(`You decipher the Ancient Tablet. +${effectiveCharacterXpGain(character, xp)} XP, +${dust} Aura Dust.`);
                                                setHollowGateHiddenChamber({ ...hollowGateHiddenChamber, searched: true });
                                            }}>🔍 Search Chamber</button>
                                            <button disabled={hollowGateHiddenChamber.relicTaken} onClick={() => {
                                                if (!hollowGateHiddenChamber || !hollowGateRun) return;
                                                const rawHonor = 15 + Math.floor(Math.random() * 20);
                                                const honor = vanguardOnlyHonorSeals(character, rawHonor);
                                                const charms = nonVanguardCharmSubstitute(character, rawHonor);
                                                const shardSub = nonVanguardShardSubstitute(character, rawHonor);
                                                const fate = (Math.random() < 0.5 ? 1 : 0) + shardSub;
                                                // Grant the Veil of the Hollow as a real inventory item
                                                // (stacking duplicates is allowed — chamber relics are
                                                // a meta progression resource, like dungeon relics).
                                                const next = addInventoryItems({
                                                    ...character,
                                                    honorSeals: (character.honorSeals ?? 0) + honor,
                                                    boneCharms: (character.boneCharms ?? 0) + charms,
                                                    fateShards: (character.fateShards ?? 0) + fate,
                                                }, [VEIL_OF_THE_HOLLOW_ID]);
                                                setCharacter(next);
                                                setHollowGateRun({ ...hollowGateRun, keys: hollowGateRun.keys + 1 });
                                                pushHollowGateLog(`You claim the Veil of the Hollow.${honor > 0 ? ` +${honor} Honor Seals` : charms > 0 ? ` +${charms} Bone Charms` : ""}${fate ? `, +${fate} Fate Shard${fate === 1 ? "" : "s"}` : ""}, +1 Shrine Key, +1 Veil of the Hollow.`);
                                                setHollowGateHiddenChamber({ ...hollowGateHiddenChamber, relicTaken: true });
                                            }}>🏺 Take Relic</button>
                                            <button onClick={() => setHollowGateHiddenChamber(null)} className="danger-button">Return to Shrine</button>
                                        </div>
                                    </div>
                                </div>
                                );
                            })()}
                        </div>
                    );
                })()}
                {/* ═══════════════════════════════════════════════════════════
                    ⛩  HOLLOW GATE SHRINE VIEW  (end)
                    ═══════════════════════════════════════════════════════════ */}

                {!activeTriggeredEvent && screen === "villageLore" && character && (
                    <VillageLoreScreen
                        character={character}
                        onBack={() => {
                            setCharacter(null);
                            setScreen("start");
                        }}
                        onContinue={() => setScreen("village")}
                    />
                )}

                {/* Choose-your-companion overlay — the first onboarding beat after the
                    Village Lore screen. Gated on onboardingStep === "starter" (set by
                    createCharacter), so it shows exactly once for new players and never
                    for veterans. Forced overlay (not a screen) so it survives a refresh
                    mid-selection. Hidden during villageLore so the lore screen reads
                    first; admins skip it (no real game role). */}
                {character
                    && character.onboardingStep === "starter"
                    && screen !== "villageLore"
                    && character.name !== "Admin 1"
                    && character.name !== "Admin 2"
                    && (
                    <StarterPetSelect
                        character={character}
                        sharedImages={sharedImages}
                        onChoose={(pet) => {
                            // Apply the pet's trait spawn-bonus exactly like a befriended
                            // encounter pet (applyPetTraitBonuses), then add it to the
                            // roster, set it active, and advance onboarding to the tour.
                            const trait = pet.trait ?? "Loyal";
                            const granted = applyPetTraitBonuses({ ...pet, trait }, trait);
                            const updated: Character = {
                                ...character,
                                pets: [...character.pets, granted],
                                activePetId: granted.id,
                                // Hand off to the guaranteed-first-win spar; the spar
                                // win advances to the first stat-training objective.
                                onboardingStep: "academySpar",
                            };
                            setCharacter(updated);
                            // Push immediately so the starter isn't lost on a fast refresh
                            // before the 3s autosave fires (mirrors the befriend path).
                            void pushSaveToServer(updated, updated.name);
                        }}
                    />
                )}

                {character
                    && character.level >= 13
                    && !character.profession
                    // Admin accounts (Admin 1 / Admin 2) skip the picker
                    // entirely. They're seeded at Level 100 with no real
                    // game role, so forcing them into a profession would
                    // lock them out of admin tooling whenever the picker
                    // overlay fires.
                    && character.name !== "Admin 1"
                    && character.name !== "Admin 2"
                    && (
                    <ProfessionPicker
                        character={character}
                        sharedImages={sharedImages}
                        onProfessionChosen={(profession) => {
                            setCharacter({
                                ...character,
                                profession,
                                professionRank: 1,
                                professionXp: 0,
                                professionChosenAt: Date.now(),
                            });
                        }}
                    />
                )}

                {character
                    && normalizeOnboardingStep(character.onboardingStep) !== "done"
                    && screen !== "villageLore"
                    // Coach is hidden during the spar (the in-battle SparCoach handles it).
                    && screen !== "arena"
                    && character.name !== "Admin 1"
                    && character.name !== "Admin 2"
                    && (
                    <OnboardingCoach
                        character={character}
                        screen={screen}
                        activeTraining={activeTraining}
                        setScreen={navigate}
                        updateCharacter={setCharacter}
                        onStartSpar={startAcademySparringMatch}
                    />
                )}

                {/* One-time contextual hints for free-roam systems (post-onboarding). */}
                {character && character.name !== "Admin 1" && character.name !== "Admin 2" && (
                    <ScreenHint screen={screen} character={character} updateCharacter={setCharacter} />
                )}

                {!activeTriggeredEvent && screen === "village" && character && (<>
                    <NextGoalPin character={character} navigate={navigate} />
                    <Village characterVillage={character.village} setScreen={navigate} />
                </>)}
                {!activeTriggeredEvent && screen === "worldMap" && character && (
                    <WorldMap
                        key={worldMapKey}
                        setCurrentBiome={setCurrentBiome}
                        setScreen={navigate}
                        character={character}
                        updateCharacter={setCharacter}
                        creatorEvents={creatorEvents}
                        creatorRaids={creatorRaids}
                        petEncounterVn={petEncounterVn}
                        ancientChestVn={ancientChestVn}
                        editablePets={editablePets}
                        setPendingAiProfileId={setPendingAiProfileId}
                            setPendingPvpOpponent={(c) => setPendingPvpOpponent(c ? normalizeCharacter(c) : null)}
                        setRaidBattleKind={setRaidBattleKind}
                        registerWandererAi={(ai) => setWandererAis([ai])}
                        setPendingPetBattleOpponent={setPendingPetBattleOpponent}
                        requestCardChallenge={() => setCardAutoStart(true)}
                        recordMissionExplore={recordMissionExplore}
                        setPendingExploreSector={setPendingExploreSector}
                        playableAis={playableAis}
                        setCurrentWeather={setCurrentWeather}
                        playerRoster={playerRoster}
                        currentSector={currentSector}
                        setCurrentSector={setCurrentSector}
                        isTraveling={isTraveling}
                        travelingUntil={travelingUntil}
                        setTravelingUntil={setTravelingUntil}
                        acceptedMissionIds={acceptedMissionIds}
                        missionProgress={missionProgress}
                        setMissionProgress={setMissionProgress}
                        sharedImages={sharedImages}
                        onStartEventEncounter={(event, battle) => {
                            setActiveTriggerReturnScreen("worldMap");
                            startTriggeredEventArenaBattle(event, battle);
                        }}
                        onDungeonFound={() => triggerDungeonEncounter("worldMap")}
                        onEnterHollowGate={enterHollowGateShrine}
                        setPvpBattleId={setPvpBattleId}
                        setPvpRole={setPvpRole}
                        setPvpBattleContext={setPvpBattleContext}
                        setPvpSeedSession={setPvpSeedSession}
                        savedBloodlines={savedBloodlines}
                        creatorJutsus={creatorJutsus}
                        creatorItems={creatorItems}
                        onImmediateSave={(char) => { void pushSaveToServer(char, currentAccountName).catch(() => {}); }} attackSleeper={(opponent) => { void strikeDownSleeper({ opponent, attackerName: character.name, isTraveling, setCharacter, setPlayerRoster }); }}
                        sectorAttackPlayer={async (opponent) => {
                            if (isTraveling) {
                                alert("You cannot attack while traveling.");
                                return;
                            }
                            if (opponent.travelingUntil && opponent.travelingUntil > Date.now()) {
                                alert(`${opponent.name} is traveling and cannot be attacked right now.`);
                                return;
                            }
                            // Use local character data — the server hydrates both
                            // fighters from their KV save records directly (see
                            // api/pvp/session.ts ~line 502), so the redundant
                            // fetchPlayerCombatSave round trips that used to gate
                            // this flow are unnecessary. The payload below is
                            // only consulted as a fallback for fighters without
                            // a save (NPCs).
                            const selfChar = character;
                            const selfAllItems = getAllItems(creatorItems);
                            const p1Jutsus = getPvpJutsuLoadout(savedBloodlines, creatorJutsus, selfChar);

                            // Optimistic navigation — flip to the pvpBattle screen
                            // immediately so the player sees the proper battle
                            // backdrop + a "Connecting to battle session..." card
                            // instead of staring at the sector view for 1–3
                            // seconds while the session POST resolves. The
                            // PvpBattleScreen session-fetch effect is keyed on
                            // battleId, so the empty id just renders the
                            // loading card; once we set the real id below the
                            // effect re-runs and loads the grid.
                            setPvpBattleId('');
                            setPvpRole("p1");
                            setPvpBattleContext({ mode: "standard", sectorAttack: true, raidKind: "raidPlayer", sector: currentSector });
                            setScreen("pvpBattle");

                            // Sector-mate records from /api/player/heartbeat only carry { avatarImage }
                            // (the full character is intentionally stripped for bandwidth). Fetch the
                            // opponent's combat save and resolve their FULL loadout — stats, armor,
                            // weapons + consumables/throwables (pvpItems), jutsu and bloodline — from
                            // THEIR own bloodlines + creator content. fetchPlayerCombatSave returns null
                            // (never throws) on failure, so the optimistic navigation above stays safe;
                            // the server also re-hydrates authoritatively from the save by p2Character.name.
                            const oppSave = await fetchPlayerCombatSave(opponent.name);
                            const oppChar = oppSave?.character ?? normalizeCharacter(opponent.character as Character);
                            const oppBloodlines = oppSave?.savedBloodlines?.length ? oppSave.savedBloodlines : savedBloodlines;
                            const oppCreatorJutsus = oppSave?.creatorJutsus?.length ? [...creatorJutsus, ...oppSave.creatorJutsus] : creatorJutsus;
                            const opponentAllItems = getAllItems(oppSave?.creatorItems?.length ? [...creatorItems, ...oppSave.creatorItems] : creatorItems);
                            const p2Jutsus = getPvpJutsuLoadout(oppBloodlines, oppCreatorJutsus, oppChar);

                            let battleId = '';
                            try {
                                const sr = await fetch('/api/pvp/session', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: stringifyPvpSessionPayload({
                                        // Sector attack — fighters bring current vitals.
                                        useCurrentVitals: true,
                                        // Phase 3: server credits base ryo + XP on the win.
                                        baseRewards: true,
                                        rewardSector: currentSector,
                                        // Sector attacks ride the live biome/weather (not ranked).
                                        ...pvpSessionEnvironment(false, currentBiome, weatherEffects[currentWeather]?.positiveElement, weatherEffects[currentWeather]?.negativeElement),
                                        p1Character: { ...selfChar, jutsu: p1Jutsus, pvpItems: getPvpItemLoadout(selfChar, selfAllItems), bloodlineMult: getBloodlineMultiplier(selfChar, savedBloodlines), armorFactor: getCharacterArmorFactor(selfChar, selfAllItems), armorRawDR: getCharacterArmorRawDR(selfChar, selfAllItems), itemDamagePct: getEquippedItemBonus(selfChar, selfAllItems, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(selfChar, selfAllItems, "absorbPercent"), itemReflectPct: getEquippedItemBonus(selfChar, selfAllItems, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(selfChar, selfAllItems, "lifeStealPercent"), itemShield: getEquippedItemBonus(selfChar, selfAllItems, "shield") },
                                        p2Character: { ...oppChar, name: opponent.name, jutsu: p2Jutsus, pvpItems: getPvpItemLoadout(oppChar, opponentAllItems), bloodlineMult: getBloodlineMultiplier(oppChar, oppBloodlines), armorFactor: getCharacterArmorFactor(oppChar, opponentAllItems), armorRawDR: getCharacterArmorRawDR(oppChar, opponentAllItems), itemDamagePct: getEquippedItemBonus(oppChar, opponentAllItems, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(oppChar, opponentAllItems, "absorbPercent"), itemReflectPct: getEquippedItemBonus(oppChar, opponentAllItems, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(oppChar, opponentAllItems, "lifeStealPercent"), itemShield: getEquippedItemBonus(oppChar, opponentAllItems, "shield") },
                                    }),
                                });
                                if (sr.ok) {
                                    const data = await sr.json() as { battleId: string; session?: PvpSessionState };
                                    battleId = data.battleId;
                                    // Stash the session payload so PvpBattleScreen
                                    // can render the grid on first paint instead
                                    // of flashing the "Connecting..." card.
                                    if (data.session) setPvpSeedSession(data.session);
                                }
                            } catch { /* fallback below */ }

                            if (!battleId) {
                                // Session creation failed — refuse to fall through
                                // to the local-sim arena. That fallback used to
                                // award PvP-win counters / Vanguard seals / ryo /
                                // XP from a CLIENT-decided outcome, with no server
                                // session to cross-check. Better UX: route back to
                                // the world map with an error so the player can
                                // retry rather than have rewards quietly inflated
                                // (or denied) by a transient outage.
                                setPvpBattleId('');
                                setPvpSeedSession(null);
                                setPendingPvpOpponent(null);
                                setRaidBattleKind("none");
                                setScreen("worldMap");
                                alert("Couldn't reach the battle server. Please try the attack again in a moment.");
                                return;
                            }

                            // Surface the real battleId — PvpBattleScreen
                            // re-renders with both the matching seed session
                            // and the right id, so the battle grid appears
                            // without the loading card showing.
                            setPvpBattleId(battleId);

                            // Notify defender via DuelChallenge with battleId.
                            // Fire-and-forget: the session is already live on
                            // the server; if the defender's challenge POST
                            // fails (e.g. they just started traveling) we
                            // alert and bounce the attacker back to the world
                            // map so they aren't stuck waiting on an empty
                            // session that'll time out server-side.
                            const challenge: DuelChallenge = {
                                id: makeId(),
                                fromName: character.name,
                                toName: opponent.name,
                                challenger: character,
                                challengerJutsus: p1Jutsus,
                                challengerBloodlineMult: getBloodlineMultiplier(character, savedBloodlines),
                                createdAt: Date.now(),
                                mode: "standard" as const,
                                sectorAttack: true,
                                battleId,
                            };
                            fetch('/api/player/challenge', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ targetName: opponent.name, challenge }),
                            }).then((res) => {
                                if (!res.ok) {
                                    alert(`${opponent.name} is traveling and cannot be attacked right now.`);
                                    setPvpBattleId('');
                                    setScreen("worldMap");
                                }
                            }).catch(() => { /* defender notification is best-effort; session is live regardless */ });
                        }}
                    />
                )}
                {!activeTriggeredEvent && screen === "sunscarFestival" && character && (
                    <SunscarFestival
                        character={character}
                        updateCharacter={setCharacter}
                        creatorCards={creatorCards}
                    />
                )}
                {!activeTriggeredEvent && screen === "centralHub" && character && (
                    <CentralHub
                        character={character}
                        updateCharacter={setCharacter}
                        setScreen={setScreen}
                        savedBloodlines={savedBloodlines}
                        publicPlayerBloodlines={publicPlayerBloodlines}
                        triggeredEvents={triggeredEvents}
                        setTriggeredEvents={setTriggeredEvents}
                        onStartEndlessBattle={startEndlessBattle}
                        onStartDungeon={(event) => triggerDungeonEncounter("centralHub", event)}
                        creatorItems={creatorItems}
                        setCreatorItems={setCreatorItems}
                        playableAis={playableAis}
                        sharedImages={sharedImages}
                        onOpenBloodlineMaker={(rank) => {
                            setBloodlineMakerInitialRank(rank);
                            setBloodlineMakerInitialElement(getCharacterElements(character)[0] ?? "");
                            setBloodlineMakerRankLocked(true);
                            setScreen("bloodlineMaker");
                        }}
                    />
                )}
                {!activeTriggeredEvent && screen === "storyHall" && character && (
                    <StoryHall
                        character={character}
                        setScreen={setScreen}
                        onStartBattle={startStoryArenaBattle}
                        creatorEvents={creatorEvents}
                        sharedImages={sharedImages}
                        onStartVisualNovel={(event) => {
                            const alreadyRead = triggeredEvents.includes(event.id);
                            if (!alreadyRead) {
                                setTriggeredEvents((ids) => ids.includes(event.id) ? ids : [...ids, event.id]);
                            }
                            setActiveTriggeredEvent(alreadyRead
                                ? { ...event, xpReward: 0, ryoReward: 0, staminaReward: 0, currencyRewards: undefined }
                                : event);
                            setActiveTriggerReturnScreen("storyHall");
                            setTriggerPage(0);
                            setTriggerLine(0);
                        }}
                    />
                )}
                {!activeTriggeredEvent && screen === "storyBoss" && character && <StoryBoss character={character} updateCharacter={setCharacter} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "training" && character && <Training character={character} updateCharacter={setCharacter} activeTraining={activeTraining} setActiveTraining={setActiveTrainingNow} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "pets" && character && <PetYard character={character} updateCharacter={setCharacter} setScreen={navigate} onBack={goBack} onImmediateSave={(char) => { void pushSaveToServer(char, currentAccountName).catch(() => {}); }} />}
                {!activeTriggeredEvent && screen === "petArena" && character && <PetArena character={character} updateCharacter={setCharacter} playerRoster={playerRoster} allServerPlayers={allServerPlayers} setScreen={setScreen} sharedImages={sharedImages} duelChallenges={duelChallenges} setDuelChallenges={setDuelChallenges} pendingPetBattleOpponent={pendingPetBattleOpponent} onPendingPetBattleStarted={() => setPendingPetBattleOpponent(null)} pendingArenaMatch={pendingArenaMatch} onPendingArenaMatchStarted={() => setPendingArenaMatch(null)} pendingArenaResponse={pendingArenaResponse} onArenaResponseHandled={() => setPendingArenaResponse(null)} onClanWarBattleEnd={autoReportClanWarBattleResult} onBattleActiveChange={setPetBattleActive} />}
                {!activeTriggeredEvent && screen === "petLadder" && character && <PetLadder character={character} setScreen={setScreen} sharedImages={sharedImages} />}
                {!activeTriggeredEvent && screen === "eventPetBattle" && character && pendingEventEncounter && (() => {
                    const sourcePet = editablePets.find((pet) => pet.id === pendingEventEncounter.battle?.petId) ?? editablePets[0] ?? petPool[0];
                    const enemyPet = scaleEventPetOpponent(sourcePet, pendingEventEncounter.battle);
                    return <DungeonPetBattle character={character} updateCharacter={setCharacter} editablePets={editablePets} enemyOverride={enemyPet} enemyOwner={pendingEventEncounter.event.name} onWin={completeEventEncounter} onLeave={leaveEventEncounter} sharedImages={sharedImages} />;
                })()}
                {!activeTriggeredEvent && screen === "jutsuTraining" && character && <JutsuTrainingHall character={character} updateCharacter={setCharacter} savedBloodlines={savedBloodlines} creatorJutsus={creatorJutsus} activeJutsuTraining={activeJutsuTraining} setActiveJutsuTraining={setActiveJutsuTrainingNow} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "missions" && character && <Missions character={character} updateCharacter={setCharacter} creatorAis={playableAis} creatorMissions={creatorMissions} acceptedMissionIds={acceptedMissionIds} setAcceptedMissionIds={setAcceptedMissionIds} missionProgress={missionProgress} setMissionProgress={setMissionProgress} setPendingAiProfileId={setPendingAiProfileId} setScreen={setScreen} onBack={goBack} onMissionBattleStart={() => setMissionBattleActive(true)} />}
                {!activeTriggeredEvent && screen === "hunting" && character && <HunterBoard character={character} updateCharacter={setCharacter} creatorAis={playableAis} acceptedMissionIds={acceptedMissionIds} setAcceptedMissionIds={setAcceptedMissionIds} missionProgress={missionProgress} setMissionProgress={setMissionProgress} setPendingAiProfileId={setPendingAiProfileId} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "logbook" && character && <Logbook character={character} updateCharacter={setCharacter} creatorAis={playableAis} creatorMissions={creatorMissions} creatorEvents={creatorEvents} creatorRaids={creatorRaids} acceptedMissionIds={acceptedMissionIds} setAcceptedMissionIds={setAcceptedMissionIds} missionProgress={missionProgress} setMissionProgress={setMissionProgress} savedBloodlines={savedBloodlines} setPendingAiProfileId={setPendingAiProfileId} setRaidBattleKind={setRaidBattleKind} setCurrentSector={setCurrentSector} setCurrentBiome={setCurrentBiome} setCurrentWeather={setCurrentWeather} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "townHall" && character && <TownHall character={character} updateCharacter={setCharacter} creatorItems={creatorItems} allServerPlayers={allServerPlayers} savedBloodlines={savedBloodlines} creatorJutsus={creatorJutsus} sharedImages={sharedImages} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "clan" && character && <ClanHall character={character} updateCharacter={setCharacter} creatorItems={creatorItems} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "bank" && character && <Bank character={character} updateCharacter={setCharacter} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "shop" && character && <Shop character={character} updateCharacter={setCharacter} creatorItems={creatorItems} creatorCards={creatorCards} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "grandMarketplace" && character && <GrandMarketplace character={character} updateCharacter={setCharacter} creatorItems={creatorItems} creatorCards={creatorCards} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "shinobiTiles" && character && <CardHall character={character} updateCharacter={setCharacter} creatorCards={creatorCards} onBack={goBack} autoStart={cardAutoStart} onAutoStartConsumed={() => setCardAutoStart(false)} />}
                {!activeTriggeredEvent && screen === "guides" && <GuidesLibrary onExit={goBack} />}
                {!activeTriggeredEvent && screen === "eventTiles" && character && pendingEventEncounter && <CardClashDuel character={character} creatorCards={creatorCards} tileDifficulty={pendingEventEncounter.battle?.tileDifficulty ?? "normal"} onDungeonWin={completeEventEncounter} onDungeonLeave={leaveEventEncounter} />}
                {/* Hollow Gate Shinobi Tile card-game tile. Win/lose/leave
                    callbacks all route back to the shrine; loss applies
                    the 20% maxHp penalty. Difficulty scales with floor. */}
                {!activeTriggeredEvent && screen === "hollowGateTiles" && character && hollowGateRun && (
                    <CardClashDuel
                        character={character}
                        creatorCards={creatorCards}
                        dungeonSceneImage={sharedImages["shrine:tile-tile-game"]}
                        tileDifficulty={hollowGateRun.floor >= 4 ? "normal" : "easy"}
                        onDungeonWin={() => {
                            // Win → small reward + back to shrine. Rewards
                            // are intentionally modest since chests cover the
                            // big loot. Floor-scaled ryo + aura dust.
                            // Threat + torch reset per the post-encounter rule.
                            if (character) {
                                const floor = hollowGateRun.floor;
                                const ryoGain = 120 + floor * 40;
                                const auraDustGain = 4 + floor * 2;
                                setCharacter({
                                    ...character,
                                    ryo: character.ryo + ryoGain,
                                    auraDust: (character.auraDust ?? 0) + auraDustGain,
                                });
                                pushHollowGateLog(`Tile Seal claimed. +${ryoGain} ryo, +${auraDustGain} Aura Dust. Threat dissipates; the Torch keeps burning down.`);
                            }
                            setHollowGateRun(prev => prev ? { ...prev, threat: 0 } : prev);
                            setHollowGateTileGameActive(false);
                            setScreen("hollowGateShrine");
                        }}
                        onDungeonLose={() => {
                            // Loss → 20% maxHp penalty + back to shrine.
                            // Run continues; not hospitalized. Threat/torch
                            // still reset — engaging counts as a battle.
                            if (character) {
                                const dmg = Math.max(1, Math.floor(character.maxHp * 0.20));
                                const nextHp = Math.max(1, character.hp - dmg);
                                setCharacter({ ...character, hp: nextHp });
                                pushHollowGateLog(`Tile Seal failed. The shadow opponent claims its price — ${dmg} HP torn from you (20% of max). Threat dissipates.`);
                            }
                            setHollowGateRun(prev => prev ? { ...prev, threat: 0 } : prev);
                            setHollowGateTileGameActive(false);
                            setScreen("hollowGateShrine");
                        }}
                        onDungeonLeave={() => {
                            // Abandoned before result → no penalty, no
                            // reset (player didn't actually engage).
                            pushHollowGateLog("You step away from the stone table. The tiles dim.");
                            setHollowGateTileGameActive(false);
                            setScreen("hollowGateShrine");
                        }}
                    />
                )}
                {!activeTriggeredEvent && screen === "hospital" && character && <Hospital character={character} updateCharacter={setCharacter} setScreen={navigate} playerRoster={playerRoster} />}
                {!activeTriggeredEvent && screen === "professions" && character && <Professions character={character} updateCharacter={setCharacter} setScreen={navigate} onBack={goBack} playerRoster={playerRoster} />}
                {!activeTriggeredEvent && screen === "cafeteria" && character && <Cafeteria character={character} updateCharacter={setCharacter} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "tavern" && character && <VillageTavern character={character} onBack={goBack} sharedImages={sharedImages} onViewProfile={(name) => { setViewingUserName(name); navigate("userView"); }} />}
                {!activeTriggeredEvent && screen === "messages" && character && <Messages character={character} onBack={goBack} initialWith={viewingUserName} />}
                {!activeTriggeredEvent && screen === "hallOfLegends" && character && <HallOfLegends character={character} setScreen={setScreen} playerRoster={playerRoster} updateCharacter={setCharacter} />}
                {!activeTriggeredEvent && screen === "endlessTower" && character && (
                    <EndlessTowerLobby
                        character={character}
                        onEnter={startEndlessBattle}
                        onBank={bankEndlessRewards}
                        onBack={goBack}
                    />
                )}
                {!activeTriggeredEvent && screen === "battleTowers" && character && (
                    <BattleTowers character={character} updateCharacter={setCharacter} sharedImages={sharedImages} hostLoadout={(() => { const it = getAllItems(creatorItems); return { pvpItems: getPvpItemLoadout(character, it), bloodlineMult: getBloodlineMultiplier(character, savedBloodlines), armorFactor: getCharacterArmorFactor(character, it), armorRawDR: getCharacterArmorRawDR(character, it), itemDamagePct: getEquippedItemBonus(character, it, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(character, it, "absorbPercent"), itemReflectPct: getEquippedItemBonus(character, it, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(character, it, "lifeStealPercent"), itemShield: getEquippedItemBonus(character, it, "shield") }; })()} onExit={goBack} />
                )}
                {!activeTriggeredEvent && screen === "weeklyBoss" && character && (
                    <WeeklyBossArena
                        character={character}
                        updateCharacter={setCharacter}
                        creatorAis={playableAis}
                        setScreen={setScreen}
                        playerRoster={playerRoster}
                        sharedImages={sharedImages}
                        onLaunchFight={launchWeeklyBossFight}
                    />
                )}
                {!activeTriggeredEvent && screen === "villageWar" && character && <VillageWarScreen character={character} updateCharacter={setCharacter} playerRoster={playerRoster} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "villageWarMap" && character && <VillageWarMap character={character} onBack={goBack} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "sectorCard" && character && <SectorWarCardBattle character={character} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "shinobiCouncil" && character && <ShinobiCouncilHall character={character} setScreen={setScreen} playerRoster={playerRoster} launchClanWarBattle={launchClanWarBattle} />}
                {!activeTriggeredEvent && screen === "tilecardsDuel" && character && <ClanWarTileCardDuel character={character} setScreen={setScreen} sharedImages={sharedImages} />}
                {!activeTriggeredEvent && screen === "userHub" && character && (
                    <UserHub
                        currentName={character.name}
                        allServerPlayers={allServerPlayers}
                        playerRoster={playerRoster}
                        sharedImages={sharedImages}
                        onSelect={(name) => { setViewingUserName(name); navigate("userView"); }}
                        onBack={goBack}
                    />
                )}
                {!activeTriggeredEvent && screen === "userView" && character && viewingUserName && (
                    <UserView
                        viewingName={viewingUserName}
                        viewerCharacter={character}
                        allServerPlayers={allServerPlayers}
                        playerRoster={playerRoster}
                        savedBloodlines={savedBloodlines}
                        creatorJutsus={creatorJutsus}
                        sharedImages={sharedImages}
                        onMessage={() => setScreen("messages")}
                        onBack={goBack}
                    />
                )}
                {!activeTriggeredEvent && screen === "profile" && character && (
                    <Profile
                        character={character}
                        updateCharacter={setCharacter}
                        savedBloodlines={savedBloodlines}
                        creatorJutsus={creatorJutsus}
                        creatorItems={creatorItems}
                        onDeleteCharacter={deleteCharacter}
                    />
                )}
                {!activeTriggeredEvent && screen === "inventory" && character && (
                    <Inventory
                        character={character}
                        updateCharacter={setCharacter}
                        creatorItems={creatorItems}
                        creatorCards={creatorCards}
                    />
                )}

                {!activeTriggeredEvent && (screen === "arena" || screen === "battleArena" || screen === "arenaDistrict") && character && (
                    <Arena
                        key={arenaKey}
                        lobbyMode={screen === "arenaDistrict" ? "arenaDistrict" : "battleArena"}
                        character={character}
                        updateCharacter={setCharacter}
                        savedBloodlines={savedBloodlines}
                        creatorJutsus={creatorJutsus}
                        creatorAis={wandererAis.length ? [...wandererAis, ...playableAis] : playableAis}
                        pendingAiProfileId={pendingAiProfileId}
                        setPendingAiProfileId={setPendingAiProfileId}
                        currentBiome={currentBiome}
                        currentSector={currentSector}
                        currentWeather={currentWeather}
                        playerRoster={playerRoster}
                        duelChallenges={duelChallenges}
                        setDuelChallenges={setDuelChallenges}
                        pendingPvpOpponent={pendingPvpOpponent}
                        setPendingPvpOpponent={setPendingPvpOpponent}
                        raidBattleKind={raidBattleKind}
                        setRaidBattleKind={setRaidBattleKind}
                        creatorItems={creatorItems}
                        setScreen={navigate}
                        sharedImages={sharedImages}
                        endlessBattleActive={endlessBattleActive}
                        endlessBattleWave={endlessBattleWave}
                        onEndlessWin={handleEndlessWin}
                        onEndlessBattleEnd={endEndlessBattle}
                        pendingStoryBattle={pendingArenaStoryBattle}
                        onPendingStoryBattleWin={completePendingArenaStoryBattle}
                        onPendingStoryBattleContinue={continuePendingArenaStoryBattle}
                        onDungeonFail={failDungeon}
                        onWeeklyBossLogDamage={logWeeklyBossFightDamage}
                        onMissionRaidComplete={recordMissionRaid}
                        onHuntBeastDefeated={completeHuntForAi}
                        missionBattleActive={missionBattleActive}
                        onMissionBattleResolved={() => { setMissionBattleActive(false); setPendingExploreSector(null); }}
                        onBattleActiveChange={setArenaBattleActive} directCombat={screen === "arena"} onReturnFromCombat={goBack}
                        exploreAmbushActive={pendingExploreSector !== null}
                        onExploreAmbushWon={() => { if (pendingExploreSector !== null) recordMissionExplore(pendingExploreSector); setPendingExploreSector(null); }}
                        setPvpBattleId={setPvpBattleId}
                        setPvpRole={setPvpRole}
                        setPvpBattleContext={setPvpBattleContext}
                        setPvpSeedSession={setPvpSeedSession}
                        setPendingPetBattleOpponent={setPendingPetBattleOpponent}
                    />
                )}

                {screen === "pvpBattle" && character && pvpBattleId && pvpRole && (() => {
                    const pvpJutsus = getPvpJutsuLoadout(savedBloodlines, creatorJutsus, character);
                    const pvpAllItems = getAllItems(creatorItems);
                    const pvpItems = (["hand", "weapon", "thrown", "item1", "item2", "item3", "item", "potion"] as EquipmentSlot[])
                        .map(slot => character.equipment[slot])
                        .filter((id): id is string => Boolean(id))
                        .map(id => getItemById(pvpAllItems, id))
                        .filter((item): item is GameItem => Boolean(item));
                    function handlePvpWin(_opponentName: string, opponent?: Character, serverRating?: { field: string; value: number; delta: number }, serverBase?: PvpWinBaseSummary) {
                        if (!character) return;
                        const context = pvpBattleContext;
                        const rewardSector = context?.sector ?? currentSector;
                        const deathsGate = rewardSector === 99;
                        const activeTrait = getActivePetTrait(character);
                        const xpGain = (activeTrait === "Swift" ? 125 : 100) * (deathsGate ? 2 : 1);
                        const ryoGain = (activeTrait === "Lucky" ? 90 : 75) * (deathsGate ? 2 : 1);
                        const ratingGain = context?.mode === "ranked" && opponent
                            ? rankedDelta(character.rankedRating ?? 1000, opponent.rankedRating ?? 1000)
                            : 0;
                        // Old point-based clan war system removed — see autoReportClanWarBattleResult below.
                        if (context?.raidKind === "raidPlayer") {
                            damageSectorTerritory(rewardSector, sectorRaidDamageAmount(rewardSector));
                        }
                        if (context?.kageVillage) {
                            // Server-authoritative Kage succession: the winner reports;
                            // resolve reads the PvpSession and transfers/defends the seat.
                            fetch("/api/village/kage-challenge", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "resolve", village: context.kageVillage, playerName: character.name, battleId: pvpBattleId }),
                            }).catch(() => {});
                        }
                        if (pvpBattleId) void claimBountyOnWin(character.name, pvpBattleId).then(b => { if (b) { setCharacter(c => c ? { ...c, ryo: (c.ryo ?? 0) + b.amount } : c); alert(`💰 Bounty: +${b.amount.toLocaleString()} ryo for defeating ${b.target}!`); } });
                        const villageWarRaid = context?.raidKind === "raidPlayer"
                            ? recordVillageWarRaid(character, rewardSector, playerRoster)
                            : { note: "", characterPatch: {} as Partial<Character>, warCrate: false, warCrateId: undefined as string | undefined, bountyRyo: 0, bountyFateShards: 0 };
                        const villageWarPvpPatch = opponent ? recordVillageWarPvp(character, opponent, rewardSector, playerRoster) : "";
                        const leveled = serverBase ? applyServerBaseReward(character, serverBase) : gainXp(character, xpGain);
                        const rewarded = grantTerritoryScrolls(leveled, 5);
                        // Spar/friendly-duel detection for non-Vanguard local effects
                        // (e.g., ranked rating still uses isFriendlyDuel implicitly).
                        const isFriendlyDuel = !context?.mode
                            || (context.mode === "standard" && !context.clanWarPoints && !context.sectorAttack);
                        // Vanguard rewards (Honor Seals + profession XP + all the
                        // daily-tracking fields) are granted server-side in
                        // api/pvp/move.ts via grantVanguardRewardsForSession. The
                        // server enforces level-gap, daily caps, per-target caps,
                        // same-IP, account-age, quick-surrender, and pet-escort
                        // bonus rules. Client doesn't touch those fields here —
                        // the explicit refetch below pulls the server's values.
                        setCharacter({
                            ...rewarded,
                            ...villageWarRaid.characterPatch,
                            // ryo / fateShards include the war-ground bounty
                            // when it fires; bountyRyo+bountyFateShards are 0
                            // for non-raid wins or when already claimed today.
                            ryo: (serverBase ? rewarded.ryo : rewarded.ryo + ryoGain) + villageWarRaid.bountyRyo,
                            fateShards: (rewarded.fateShards ?? 0) + villageWarRaid.bountyFateShards,
                            auraDust: (rewarded.auraDust ?? 0) + 6,
                            inventory: villageWarRaid.warCrate ? [...rewarded.inventory, LEGENDARY_WAR_CRATE_ID] : rewarded.inventory,
                            // Stamp the canonical crate ID so claimPendingWarCrates'
                            // next sweep skips this war (already credited inline).
                            claimedWarCrateIds: villageWarRaid.warCrate && villageWarRaid.warCrateId
                                ? [...(rewarded.claimedWarCrateIds ?? []), villageWarRaid.warCrateId]
                                : (rewarded.claimedWarCrateIds ?? []),
                            totalPvpKills: (rewarded.totalPvpKills ?? 0) + 1,
                            monthlyPvpKills: (rewarded.monthlyPvpKills ?? 0) + 1,
                            pvpKillMonth: currentMonthKey(),
                            // Read-back (audit #7 / Stage 3): when the session is
                            // ranked the server credits the rating via claim-rewards
                            // and returns it; use that authoritative value. Fall back
                            // to the local delta only when the server didn't return
                            // one (claim 503 / offline) so the rating still updates.
                            // The win counter still increments locally (it converges —
                            // server +1 from the same base).
                            rankedRating: serverRating?.field === "rankedRating" ? serverRating.value : (rewarded.rankedRating ?? 1000) + ratingGain,
                            rankedWins: (rewarded.rankedWins ?? 0) + (ratingGain > 0 ? 1 : 0),
                        });
                        // Refetch the player's own save to pick up server-side
                        // Vanguard reward updates (honorSeals, professionXp,
                        // professionRank, daily-cap counters, petEscortBonusReady
                        // for clan-mates is on their saves not ours).
                        if (rewarded.profession === "vanguard") {
                            fetch(`/api/save/${encodeURIComponent(character.name)}`)
                                .then(r => r.ok ? r.json() : null)
                                .then(data => {
                                    const serverChar = data?.character as Character | undefined;
                                    if (!serverChar) return;
                                    setCharacter(prev => prev ? ({
                                        ...prev,
                                        honorSeals: serverChar.honorSeals ?? prev.honorSeals,
                                        professionXp: serverChar.professionXp ?? prev.professionXp,
                                        professionRank: serverChar.professionRank ?? prev.professionRank,
                                        dailyHonorSealsEarned: serverChar.dailyHonorSealsEarned ?? prev.dailyHonorSealsEarned,
                                        dailyHonorSealsByTarget: serverChar.dailyHonorSealsByTarget ?? prev.dailyHonorSealsByTarget,
                                        vanguardDailyResetDate: serverChar.vanguardDailyResetDate ?? prev.vanguardDailyResetDate,
                                    }) : prev);
                                })
                                .catch(() => { /* server is still source of truth; brief UI lag is OK */ });
                        }
                        // PvP raid completion — pass pvpBattleId so the server
                        // can cross-validate the win against the real PvpSession.
                        if (rewardSector > 0) recordMissionRaid(rewardSector, pvpBattleId ?? undefined);
                        if (villageWarPvpPatch) console.info(villageWarPvpPatch.trim());
                        // Clan-war auto-report on win: if this PvP session
                        // was launched from a clan-war challenge (set by
                        // launchClanWarBattle), tell the server we won.
                        // The loser's client fires the matching call from
                        // its onLoss handler; the two-phase report on the
                        // server merges them into a single damage event.
                        // Clear clanWarChallengeId after reporting so the
                        // next PvP fight on the same screen doesn't fire
                        // a stale clan-war report.
                        if (context?.clanWarChallengeId) {
                            void autoReportClanWarBattleResult(true, opponent?.name);
                            setPvpBattleContext(prev => prev ? { ...prev, clanWarChallengeId: undefined } : prev);
                        }
                        // Vanguard daily mission progress — server validates the
                        // win against the actual PvpSession and enforces its own
                        // anti-abuse rules (quick-surrender, account age, IP),
                        // so the client only needs to skip the spar case.
                        if (!isFriendlyDuel && opponent && rewarded.profession === "vanguard") {
                            fetch('/api/missions/report-pvp-win', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    playerName: character.name,
                                    battleId: pvpBattleId,
                                    opponentName: opponent.name,
                                }),
                            }).then(r => r.json()).then(data => {
                                const completed: Array<{ id: string; name: string; xpReward: number }> = Array.isArray(data?.missionsCompleted) ? data.missionsCompleted : [];
                                for (const m of completed) {
                                    window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                                        detail: { name: m.name, xp: m.xpReward, profession: 'vanguard' },
                                    }));
                                }
                            }).catch(() => { /* mission progress is best-effort */ });
                        }
                    }
                    return (
                        <PvpBattleScreen
                            character={character}
                            battleId={pvpBattleId}
                            role={pvpRole}
                            setScreen={navigate}
                            equippedJutsu={pvpJutsus}
                            equippedItems={pvpItems}
                            currentBiome={currentBiome}
                            currentWeather={currentWeather}
                            currentSector={currentSector}
                            sharedImages={sharedImages}
                            // Pass the seed only when its battleId matches the
                            // current pvpBattleId — a stale seed left over
                            // from a previous fight should be ignored so the
                            // mount fetches fresh state.
                            seedSession={pvpSeedSession && pvpSeedSession.battleId === pvpBattleId ? pvpSeedSession : null}
                            isSpar={!pvpBattleContext?.mode || (pvpBattleContext.mode === "standard" && !pvpBattleContext.clanWarPoints && !pvpBattleContext.sectorAttack)}
                            battleMode={pvpBattleContext?.mode ?? "standard"}
                            onWin={handlePvpWin}
                            onLoss={(opponent, serverRating) => {
                                // Clan-war auto-report on loss — mirror of
                                // handlePvpWin's call so both clients
                                // confirm the same outcome on the server.
                                // Clear clanWarChallengeId after reporting so
                                // the next PvP fight doesn't fire a stale
                                // clan-war report.
                                if (pvpBattleContext?.clanWarChallengeId) {
                                    void autoReportClanWarBattleResult(false, opponent?.name);
                                    setPvpBattleContext(prev => prev ? { ...prev, clanWarChallengeId: undefined } : prev);
                                }
                                if (pvpBattleContext?.mode !== "ranked" || !opponent) return;
                                const loss = rankedDelta(opponent.rankedRating ?? 1000, character.rankedRating ?? 1000);
                                setCharacter({
                                    ...character,
                                    // Read-back: prefer the server-credited rating
                                    // (claim-rewards), fall back to the local delta if
                                    // it wasn't returned. Loss counter stays local.
                                    rankedRating: serverRating?.field === "rankedRating" ? serverRating.value : Math.max(0, (character.rankedRating ?? 1000) - loss),
                                    rankedLosses: (character.rankedLosses ?? 0) + 1,
                                });
                            }}
                        />
                    );
                })()}

                {!activeTriggeredEvent && screen === "bloodlineMaker" && character && (
                    <BloodlineMaker
                        initialRank={bloodlineMakerInitialRank}
                        initialSpecialElement={bloodlineMakerInitialElement}
                        character={character}
                        updateCharacter={setCharacter}
                        savedBloodlines={savedBloodlines}
                        setSavedBloodlines={setSavedBloodlines}
                        lockedRank={bloodlineMakerRankLocked}
                        editingBloodline={bloodlineMakerEditingBloodline}
                        onSaveBloodlines={(nextBloodlines, nextCharacter) => {
                            if (!character || !currentAccountName) return;
                            void pushSaveToServer(nextCharacter ?? character, currentAccountName, { savedBloodlines: nextBloodlines }).catch(() => {});
                        }}
                        onClose={() => { setBloodlineMakerRankLocked(false); setBloodlineMakerEditingBloodline(null); setScreen(isAdminAccountName(character.name) ? "adminPanel" : "centralHub"); }}
                    />
                )}
                </ScreenErrorBoundary>
                </Suspense>
            </main>

            {achievementToasts.length > 0 && (
                <div className="achievement-toast-stack">
                    {achievementToasts.slice(0, 3).map((a, i) => (
                        <div
                            key={`${a.id}-${i}`}
                            className={`achievement-toast ${a.hidden ? "secret" : ""}`}
                            onClick={() => setAchievementToasts(prev => prev.filter(x => x !== a))}
                        >
                            <div className="achievement-toast-icon">
                                <img
                                    src={`/badges/${a.id}.png`}
                                    alt=""
                                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                                />
                                <span className="achievement-toast-emoji" aria-hidden>{a.icon}</span>
                            </div>
                            <div className="achievement-toast-body">
                                <span className="achievement-toast-label">
                                    {a.hidden ? "Secret Unlocked" : "Achievement Unlocked"}
                                </span>
                                <strong>{a.name}</strong>
                                <small>{a.desc}</small>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {missionToasts.length > 0 && (
                <div className="achievement-toast-stack" style={{ bottom: 80 }}>
                    {missionToasts.slice(0, 3).map((t) => {
                        const accent = t.profession === "healer" ? "#22d3ee" : t.profession === "vanguard" ? "#f97316" : "#facc15";
                        return (
                            <div
                                key={t.id}
                                className="achievement-toast"
                                style={{ borderColor: accent, boxShadow: `0 0 20px ${accent}55` }}
                                onClick={() => setMissionToasts(prev => prev.filter(x => x.id !== t.id))}
                            >
                                <div className="achievement-toast-icon">
                                    <span className="achievement-toast-emoji" aria-hidden style={{ color: accent }}>📜</span>
                                </div>
                                <div className="achievement-toast-body">
                                    <span className="achievement-toast-label" style={{ color: accent }}>
                                        {t.label ?? "Mission Complete"}
                                    </span>
                                    <strong>{t.name}</strong>
                                    {t.xp > 0 && <small>+{t.xp} {t.profession ? `${t.profession.charAt(0).toUpperCase() + t.profession.slice(1)} ` : ""}XP</small>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ── Mobile banner timer widget ──────────────────────────────────────
   Shown in the top-right corner of the journey banner on xs/sm screens
   only. Desktop already has the left profile card for this information.
   ──────────────────────────────────────────────────────────────────── */
// BannerMobileTimers moved to ./components/BannerMobileTimers.

// LeftProfileCard moved to ./components/LeftProfileCard.

// SectorBanner moved to ./components/SectorBanner.
// villageBiomes (village → home-biome lookup) moved to ./data/village-biomes;
// components import it directly from there.

// RightMenu + MobileNav moved to ./components/RightMenu and ./components/MobileNav.

// TriggeredVisualNovel moved to ./components/TriggeredVisualNovel (imported back near the top).

export type PetBattleFighter = {
    owner: string;
    pet: Pet;
    hp: number;
    pos: number;
    attackBuff: number;
    defenseBuff: number;
    cooldowns: Record<string, number>;
    dotDamage: number;
    dotRounds: number;
    shieldHp: number;     // absorbs incoming damage before HP is reduced
    moveLocked: number;   // rounds remaining that this fighter cannot move
    absorbRounds: number; // rounds of damage-reduction stance active
    absorbPercent: number;// fraction of incoming damage reduced (0–1)
    // Extended status effects. Each is a round counter; 0 = inactive.
    burnRounds: number;   // burn = DoT each round + small ATK debuff
    burnDamage: number;   // per-round burn damage applied during tick
    freezeRounds: number; // each round of freeze, 50% chance to skip turn
    confuseRounds: number;// each turn while confused, 50% chance to hit self
    stunRounds: number;   // next N turns are auto-skip
    // Base tactical actions (Phases 7-8) — a pet doesn't attack every turn.
    guardRounds: number;  // Guard: incoming damage ×0.6 while active
    evadeRounds: number;  // Evade: +25% dodge while active
    braceRounds: number;  // Brace: reduced crit damage taken (+ push/pull immunity)
    focusReady: boolean;  // Focus: next offensive move ×1.3 damage, then consumed
    defensiveCd: number;  // throttles base defensive actions so the pet still mostly attacks
    // Phase 12 archetype-identity statuses (pet battles only).
    woundRounds: number;  // wound = DoT each round
    woundDamage: number;  // per-round wound damage; also halves healing received while > 0
    markedRounds: number; // next damage hit on this fighter deals +bonus, then clears
    slowRounds: number;   // −1 move step + reduced dodge while active
    hasteRounds: number;  // +1 move step + extra dodge while active
    tauntedRounds: number;// forced to target the taunter in 2v2 while active
    tauntById: string;    // owner id of the taunter ("You" / opponentOwner / "")
    // Reactive battle-consumable charges (one-shot, from loadout.consumable).
    consDodge?: number;   // negate the next N incoming attacks
    consMitigate?: number;// reduce the next incoming attack by this %
    consEndure?: number;  // survive one lethal blow (→ 1 HP)
    consThorns?: number;  // reflect this % of the next attack (0 once spent)
    consLifeline?: number;// heal this % max HP the first time below threshold
    consCleanse?: number; // purge all statuses once
};

// Win/loss record shown on the 5-second pre-fight card. Wins/losses are the
// player's account-level pet-ranked tallies; rating is the current pet-ranked
// Elo. All optional so an AI/wild opponent can show a rating only, or nothing.
export interface PetBattleRecord {
    wins?: number;
    losses?: number;
    rating?: number;
}

// Per-fighter status snapshot carried on each frame for the HP-bar badges
// (Phases 7-9). atk/def buffs + shield are value/flag badges; the rest map to
// BattleStatusId icons via collectActorStatuses in the renderer.
type PetFrameStatus = {
    poisoned?: number; atkBuff?: boolean; defBuff?: boolean; shield?: number;
    moveLocked?: boolean; absorbing?: boolean;
    burn?: number; freeze?: number; confuse?: number; stun?: number;
    guarding?: boolean; focused?: boolean; evading?: boolean; bracing?: boolean;
    // Phase 12 archetype statuses.
    wound?: number; marked?: boolean; slow?: number; haste?: number; taunted?: boolean;
};

export type PetArenaFrame = {
    round: number;
    message: string;
    playerHp: number;
    enemyHp: number;
    playerPos: number;
    enemyPos: number;
    actor: "player" | "enemy" | "system";
    actionKind?: "damage" | "buff" | "basic" | "result" | "heal" | "debuff" | "dot" | "move" | "barrier" | "movelock" | "lifesteal" | "shield" | "absorb";
    damage?: number;
    crit?: boolean;
    // rich visual fields
    traitFlash?: { actor: "player" | "enemy"; trait: string };
    combo?: number;
    isPrefight?: boolean;
    isKO?: boolean;
    // Set when a pet unleashes its signature jutsu — drives the anime cut-in.
    // `flagship` marks an apex-tier (mythic) signature so the arena plays the
    // over-the-top `power` burst instead of the element-heavy hit (cosmetic only,
    // derived deterministically from the pet's rarity).
    signatureMove?: { name: string; petName: string; side: "player" | "enemy"; flagship?: boolean };
    playerStatus?: PetFrameStatus;
    enemyStatus?: PetFrameStatus;
    /** Remaining un-claimed power-pickup tiles (terrain depth) — the renderer
     *  draws a glowing shrine orb on each; they vanish as pets claim them. */
    pickups?: number[];
    // ── 4-pet simultaneous fields (Pokémon-doubles style 2v2) ────────
    // When present, the renderer shows 4 pet cards instead of 2, and
    // places all 4 pets on the grid. The 1v1 fields above stay populated
    // (with the most recently-acting pet of each side) so the existing
    // status/trail logic keeps working.
    party4v4?: {
        playerLead:    { hp: number; maxHp: number; pos: number; name: string; rarity?: PetRarity; element?: JutsuElement; ko: boolean; status: { poisoned?: number; burn?: number; freeze?: number; confuse?: number; stun?: number; shield?: number; absorbing?: boolean } };
        playerReserve: { hp: number; maxHp: number; pos: number; name: string; rarity?: PetRarity; element?: JutsuElement; ko: boolean; status: { poisoned?: number; burn?: number; freeze?: number; confuse?: number; stun?: number; shield?: number; absorbing?: boolean } };
        enemyLead:     { hp: number; maxHp: number; pos: number; name: string; rarity?: PetRarity; element?: JutsuElement; ko: boolean; status: { poisoned?: number; burn?: number; freeze?: number; confuse?: number; stun?: number; shield?: number; absorbing?: boolean } };
        enemyReserve:  { hp: number; maxHp: number; pos: number; name: string; rarity?: PetRarity; element?: JutsuElement; ko: boolean; status: { poisoned?: number; burn?: number; freeze?: number; confuse?: number; stun?: number; shield?: number; absorbing?: boolean } };
        // Identifies which of the 4 slots just acted, for the actor halo.
        actorSlot?: "playerLead" | "playerReserve" | "enemyLead" | "enemyReserve";
        // Identifies which slot was the target, for the target glow.
        targetSlot?: "playerLead" | "playerReserve" | "enemyLead" | "enemyReserve";
    };
};

// PET_GRID_COLS / ROWS / SIZE / PET_OBSTACLE_LAYOUTS moved to ./constants/pet-arena.

// Pet autobattler simulation engine (BFS, action AI, seeded combat math,
// 1v1 + 2v2 simulators) moved to ./lib/pet-battle-sim — imported at top.

// Trivial helper so the forfeit log line doesn't fight with a global safeName.
// Pet names are already user-facing strings; we just guard against undefined.
// Currently unreferenced — kept for potential future use. Prefixed `_` to silence lint.
function _character_safeName(s: string | undefined): string { return s ?? "Pet"; }
void _character_safeName;

export function PetArenaBattlefield({ playerPet, enemyPet, enemyOwner, playerReservePet, enemyReservePet, frame, recentFrames, result, obstacles, tiles, onReplay, onFightAgain, onExit, sharedImages = {}, playerRecord, enemyRecord }: { playerPet: Pet; enemyPet: Pet; enemyOwner: string; playerReservePet?: Pet; enemyReservePet?: Pet; frame?: PetArenaFrame; recentFrames?: PetArenaFrame[]; result: string; obstacles?: number[]; tiles?: ArenaTile[]; onReplay: () => void; onFightAgain: () => void; onExit: () => void; sharedImages?: Record<string, string>; playerRecord?: PetBattleRecord; enemyRecord?: PetBattleRecord }) {
    // Tactical tile-type lookup (Phases 5-6). Built once per tiles change so the
    // grid renderer can tint cover / hazard / healing / slow tiles.
    const tileTypeByIndex = useMemo(() => {
        const m = new Map<number, ArenaTile["type"]>();
        for (const t of tiles ?? []) m.set(t.row * PET_GRID_COLS + t.col, t.type);
        return m;
    }, [tiles]);
    const playerHp = frame?.playerHp ?? playerPet.hp;
    const enemyHp  = frame?.enemyHp  ?? enemyPet.hp;
    const playerPercent = Math.max(0, Math.min(100, (playerHp / Math.max(1, playerPet.hp)) * 100));
    const enemyPercent  = Math.max(0, Math.min(100, (enemyHp  / Math.max(1, enemyPet.hp))  * 100));
    const [playerShake, setPlayerShake] = useState(false);
    const [enemyShake,  setEnemyShake]  = useState(false);
    // Pre-fight 5-second countdown for the face-off overlay. Starts at 5 when an
    // isPrefight frame is current and ticks 5→4→3→2→1→"FIGHT!"; the overlay's
    // own 5s fade then dismisses it. Cosmetic only — drives no battle logic.
    const [prefightCount, setPrefightCount] = useState<number | null>(null);
    useEffect(() => {
        if (!frame?.isPrefight) { setPrefightCount(null); return; }
        setPrefightCount(5);
        const id = window.setInterval(() => {
            setPrefightCount((c) => (c === null || c <= 0 ? c : c - 1));
        }, 1000);
        return () => window.clearInterval(id);
    }, [frame?.isPrefight, frame?.message]);

    // ── Movement glide (FLIP) ───────────────────────────────────────────────
    // The simulator already relocates pets between grid tiles on "move" frames
    // (BFS pathfinding around obstacles), but the renderer mounts each avatar
    // fresh in its new tile cell — so without this the pet teleports. After
    // every frame we compare each pet's tile to its previous tile; if it moved
    // we measure the old + new cell centres and play a FLIP: snap the mover to
    // where it came from, then transition to zero so the pet visibly walks
    // across the board. The tile is lifted in z during transit so the gliding
    // pet passes OVER intervening tiles. Prefight frames just record positions
    // (no glide) so a replay doesn't slingshot from the previous fight's end.
    const petArenaGridRef = useRef<HTMLDivElement>(null);
    const moverPrevTile = useRef<Map<string, number>>(new Map());
    // Canvas particle layer (Phase A "juice") — sits over the stage and sprays
    // sparks/embers/shards on impact/KO/charge. Cosmetic-only; it never reads or
    // affects the sim, so its particle RNG can't desync a ranked replay.
    const vfxCanvasRef = useRef<HTMLCanvasElement>(null);
    const vfxFieldRef = useRef<PetParticleField | null>(null);
    useEffect(() => {
        const canvas = vfxCanvasRef.current;
        if (!canvas) return;
        let field: PetParticleField | null = null;
        try { field = new PetParticleField(canvas); } catch { return; }
        vfxFieldRef.current = field;
        const onResize = () => field?.resize();
        window.addEventListener("resize", onResize);
        return () => { window.removeEventListener("resize", onResize); field?.dispose(); vfxFieldRef.current = null; };
    }, []);
    // Elemental sprite-effect overlay (CC0 frames) played on the focal tile for
    // elemental hit/beam/status beats — layered OVER the particle burst. Purely
    // cosmetic; resolved from the active beat's vfxKey, never the pet art (pets
    // keep their existing portraits/sprites). Falls back to particles when the
    // element has no bundled sprite (poison/shadow/chakra/blood/none).
    const petSpriteFxSeq = useRef(0);
    const [petSpriteFx, setPetSpriteFx] = useState<{ id: number; frames: string[]; x: number; y: number; variant?: string } | null>(null);
    useLayoutEffect(() => {
        const grid = petArenaGridRef.current;
        if (!grid) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        grid.querySelectorAll<HTMLElement>(".pet-avatar-mover[data-petid]").forEach((mover) => {
            const petId = mover.dataset.petid;
            if (!petId) return;
            const tileEl = mover.closest<HTMLElement>(".pet-park-tile");
            const curIdx = tileEl?.dataset.tile != null ? Number(tileEl.dataset.tile) : NaN;
            if (Number.isNaN(curIdx)) return;
            const prevIdx = moverPrevTile.current.get(petId);
            moverPrevTile.current.set(petId, curIdx);
            if (reduce || frame?.isPrefight || prevIdx === undefined || prevIdx === curIdx || !tileEl) return;
            const oldTile = grid.querySelector<HTMLElement>(`.pet-park-tile[data-tile="${prevIdx}"]`);
            if (!oldTile) return;
            const o = oldTile.getBoundingClientRect();
            const n = tileEl.getBoundingClientRect();
            const dx = (o.left + o.right - n.left - n.right) / 2;
            const dy = (o.top + o.bottom - n.top - n.bottom) / 2;
            if (!dx && !dy) return;
            tileEl.style.zIndex = "8";
            mover.style.transition = "none";
            mover.style.transform = `translate(${dx}px, ${dy}px)`;
            void mover.offsetWidth; // force reflow so the start transform applies before the glide
            mover.style.transition = "transform 520ms cubic-bezier(.34, .1, .2, 1)";
            mover.style.transform = "translate(0px, 0px)";
            const done = () => { tileEl.style.zIndex = ""; mover.removeEventListener("transitionend", done); };
            mover.addEventListener("transitionend", done);
        });
    }, [frame?.message]);

    useEffect(() => {
        if (!frame?.damage) return;
        const hitPlayer = frame.actor === "enemy";
        if (hitPlayer) { setPlayerShake(true); const t = window.setTimeout(() => setPlayerShake(false), 420); return () => window.clearTimeout(t); }
        else           { setEnemyShake(true);  const t = window.setTimeout(() => setEnemyShake(false),  420); return () => window.clearTimeout(t); }
    }, [frame?.message]);

    // ── Battle sound — one synthesized SFX per frame. Extracted to a shared hook
    // (lib/use-pet-battle-sfx) so the HD-2D PetColiseum renderer reuses the exact
    // same picker. Covers every caller of this component (Pet Arena, Hollow Gate
    // beast duels, PvP). Behaviour unchanged from the old inline effect.
    const [sfxMuted, setSfxMuted] = useState(isPetSfxMuted());
    usePetBattleFrameSfx(frame, sfxMuted);

    const playerPos = frame?.playerPos ?? PET_SPAWN_1V1.player;
    const enemyPos  = frame?.enemyPos  ?? PET_SPAWN_1V1.enemy;

    const selfTile   = frame?.actor === "enemy" ? enemyPos : playerPos;
    const targetTile = frame?.actor === "enemy" ? playerPos : enemyPos;
    const effectTile =
        frame?.actionKind === "buff"      ? selfTile   :
        frame?.actionKind === "heal"      ? selfTile   :
        frame?.actionKind === "barrier"   ? selfTile   :
        frame?.actionKind === "shield"    ? selfTile   :
        frame?.actionKind === "absorb"    ? selfTile   :
        frame?.actionKind === "damage"    ? targetTile :
        frame?.actionKind === "basic"     ? targetTile :
        frame?.actionKind === "lifesteal" ? targetTile :
        frame?.actionKind === "debuff"    ? targetTile :
        frame?.actionKind === "dot"       ? targetTile :
        frame?.actionKind === "movelock"  ? targetTile :
        frame?.actionKind === "result"    ? selfTile   : -1;
    const effectLabel =
        frame?.actionKind === "buff"      ? "⬆️ Boost!"    :
        frame?.actionKind === "basic"     ? (frame.damage ? `-${frame.damage}` : "👊 Hit!") :
        frame?.actionKind === "damage"    ? (frame.crit ? `💥 ${frame.damage}!` : frame.damage ? `-${frame.damage}` : "💥 Strike!") :
        frame?.actionKind === "lifesteal" ? (frame.damage ? `-${frame.damage}` : "🩸 Drain!") :
        frame?.actionKind === "heal"      ? "💚 Heal!"    :
        frame?.actionKind === "dot"       ? "☠️ Poison!"   :
        frame?.actionKind === "move"      ? "💨 Dash!"    :
        frame?.actionKind === "barrier"   ? "🛡️ Barrier!" :
        frame?.actionKind === "shield"    ? "🛡️ Shield!"  :
        frame?.actionKind === "absorb"    ? "🌀 Absorb!"  :
        frame?.actionKind === "movelock"  ? "⛓️ Root!"    :
        frame?.actionKind === "debuff"    ? "⬇️ Weaken!"  :
        frame?.actionKind === "result"    ? result        : "";
    // User-facing floating-number / text-pop class for the per-tile label, so
    // damage / heal / shield / status numbers read in their own color near the
    // target sprite (not only in the log). Crit damage also gets the crit-text
    // class for the gold punch styling.
    const effectNumberClass =
        (frame?.actionKind === "damage" || frame?.actionKind === "basic" || frame?.actionKind === "lifesteal")
            ? (frame?.crit ? "damage-number crit-text" : "damage-number")
        : frame?.actionKind === "heal" ? "heal-number"
        : (frame?.actionKind === "shield" || frame?.actionKind === "barrier" || frame?.actionKind === "absorb") ? "shield-number"
        : (frame?.actionKind === "dot" || frame?.actionKind === "debuff" || frame?.actionKind === "movelock") ? "status-pop"
        : "";

    const winnerPet   = result === "Victory" ? playerPet : result === "Defeat" ? enemyPet : null;
    const winnerSide: "player" | "enemy" = result === "Victory" ? "player" : "enemy";
    const winnerOwner = result === "Victory" ? "You" : enemyOwner;
    // Element-typed impact VFX: tint the impact flash to the acting pet's chakra
    // nature, and surface the sim's already-applied "Super effective!" matchup
    // (read from the frame message) as a slam banner. Visual only.
    const actingElement = frame?.actor === "player" ? playerPet.element : frame?.actor === "enemy" ? enemyPet.element : undefined;
    const elName = actingElement ? String(actingElement).toLowerCase() : "";
    const elClass = elName && elName !== "none" && elName !== "neutral" ? ` pet-el-${elName}` : "";
    const superEffective = !!frame && !winnerPet && /super effective/i.test(frame.message ?? "") && (frame.actionKind === "damage" || frame.actionKind === "basic" || frame.actionKind === "lifesteal");

    // Trait flash label (also carries reactive battle-consumable flashes).
    const traitLabel =
        frame?.traitFlash?.trait === "Lucky"      ? "🍀 LUCKY DODGE!"      :
        frame?.traitFlash?.trait === "Aggressive" ? "🔥 AGGRESSIVE CRIT!"  :
        frame?.traitFlash?.trait === "Guardian"   ? "🛡️ GUARDIAN BLOCK!"  :
        frame?.traitFlash?.trait === "guardBlock" ? "🛡️ BLOCK!"           :
        frame?.traitFlash?.trait === "Battleborn" ? "⚔️ BATTLEBORN BONUS!" :
        frame?.traitFlash?.trait === "Swift"      ? "⚡ SWIFT STRIKE!"     :
        frame?.traitFlash?.trait === "petEvade"       ? "⚡ EVADED!"        :
        frame?.traitFlash?.trait === "consumDodge"    ? "💨 DODGED!"        :
        frame?.traitFlash?.trait === "consumBlock"    ? "🛡️ SMOKE SCREEN!"  :
        frame?.traitFlash?.trait === "consumReflect"  ? "🌵 THORNS!"        :
        frame?.traitFlash?.trait === "consumEndure"   ? "💪 SECOND WIND!"   :
        frame?.traitFlash?.trait === "consumLifeline" ? "✨ LIFELINE!"      :
        frame?.traitFlash?.trait === "consumCleanse"  ? "🧹 CLEANSED!"      : "";

    // Float color class — lifesteal shows a green +drain on the attacker's bar
    const playerFloatClass =
        frame?.actor === "enemy" && frame.damage && frame.actionKind !== "lifesteal"
            ? ` pet-damage-float${frame.crit ? " crit" : ""}${frame.actionKind === "dot" ? " dot" : ""}`
        : frame?.actor === "player" && frame.actionKind === "heal" ? " pet-damage-float heal"
        : frame?.actor === "player" && frame.actionKind === "lifesteal" ? " pet-damage-float lifesteal"
        : "";
    const enemyFloatClass =
        frame?.actor === "player" && frame.damage && frame.actionKind !== "lifesteal"
            ? ` pet-damage-float${frame.crit ? " crit" : ""}${frame.actionKind === "dot" ? " dot" : ""}`
        : frame?.actor === "enemy" && frame.actionKind === "heal" ? " pet-damage-float heal"
        : frame?.actor === "enemy" && frame.actionKind === "lifesteal" ? " pet-damage-float lifesteal"
        : "";

    // ── Commentator — a reactive hype caller for the dramatic beats. Empty on
    // routine frames so it only shouts when something worth shouting happens. ──
    const commentary: string = (() => {
        if (!frame || frame.isPrefight || frame.actionKind === "result") return "";
        if (frame.isKO) return "DOWN IT GOES!";
        if (frame.signatureMove) return "SIGNATURE MOVE!";
        if (/endures at 1 HP/.test(frame.message)) return "IT REFUSES TO FALL!";
        if (/Lifeline heals/.test(frame.message)) return "CLUTCH RECOVERY!";
        if (/dodges|evades/.test(frame.message)) return "NOTHING BUT AIR!";
        if (frame.crit) return "CRITICAL HIT!";
        if ((frame.combo ?? 0) >= 3) return `COMBO ×${frame.combo}!`;
        const low = Math.min(playerPercent, enemyPercent);
        if (low <= 12) return "ONE HIT FROM DEFEAT!";
        if (low <= 30) return "ON THE ROPES!";
        if (Math.abs(playerPercent - enemyPercent) <= 8 && (frame.round ?? 0) >= 3) return "NECK AND NECK!";
        return "";
    })();

    // ── Tension flags + momentum (HP tug-of-war) ──
    // In 2v2 the legacy playerHp/enemyHp track the PRIMARY fighter, which
    // stays pinned at 0 after it's KO'd — so the brink warning would stick
    // forever once one pet falls. Base the warning on LIVING fighters only:
    // a knocked-out slot (already dead) must not keep "ONE HIT LEFT" lit.
    const lowestPct = (() => {
        if (frame?.party4v4) {
            const p = frame.party4v4;
            const living = [p.playerLead, p.playerReserve, p.enemyLead, p.enemyReserve]
                .filter(s => s && !s.ko)
                .map(s => (s.hp / Math.max(1, s.maxHp)) * 100);
            return living.length ? Math.min(...living) : 100;
        }
        return Math.min(playerPercent, enemyPercent);
    })();
    const dangerZone = lowestPct <= 25 && !winnerPet;   // red vignette + heartbeat
    const oneHitWarn = lowestPct <= 12 && !winnerPet;   // "1 HIT LEFT" pulse
    const momentumPlayer = (playerPercent / Math.max(1, playerPercent + enemyPercent)) * 100;

    // ── Phase 2: animation event queue ──────────────────────────────────────
    // Combat is no longer shown by sliding one avatar into the other. Each
    // resolved frame is turned into an ordered queue of presentation events
    // (windup → lunge / rangedCast → projectile → impact → recoil; guard,
    // dodge, charge, KO, victory). A lightweight scheduler walks the queue
    // within the frame's pacing budget, and every pet sprite holds the pose of
    // whichever event is currently playing. Purely derived from the (already
    // deterministic) frame, so ranked replays animate identically and no
    // balance/RNG/clock is touched.
    const battleDist = tileDistance(playerPos, enemyPos);
    const animVfxKey = elementVfxKey(actingElement);
    const slotPetId = (slot?: string): string =>
        slot === "playerLead" ? playerPet.id
        : slot === "playerReserve" ? (playerReservePet?.id ?? "")
        : slot === "enemyLead" ? enemyPet.id
        : slot === "enemyReserve" ? (enemyReservePet?.id ?? "")
        : "";
    const animActorId = frame?.party4v4?.actorSlot
        ? slotPetId(frame.party4v4.actorSlot)
        : frame?.actor === "enemy" ? enemyPet.id : playerPet.id;
    const animTargetId = frame?.party4v4?.targetSlot
        ? slotPetId(frame.party4v4.targetSlot)
        : frame?.actor === "enemy" ? playerPet.id : enemyPet.id;
    const resolvedWinnerId = winnerPet ? (winnerSide === "player" ? playerPet.id : enemyPet.id) : null;
    const animEvents = useMemo(() => {
        if (!frame) return [];
        return buildPetAnimationEvents({
            frame: {
                actor: frame.actor,
                actionKind: frame.actionKind,
                damage: frame.damage,
                crit: frame.crit,
                isKO: frame.isKO,
                isPrefight: frame.isPrefight,
                message: frame.message,
                signatureMove: frame.signatureMove ?? null,
            },
            dist: battleDist,
            actorId: animActorId,
            targetId: animTargetId,
            vfxKey: animVfxKey,
            isResultFrame: frame.actionKind === "result" && !frame.isKO,
            winnerId: resolvedWinnerId,
            loserId: animTargetId,
        });
    }, [frame?.message]);

    const [animIdx, setAnimIdx] = useState(0);
    useEffect(() => {
        setAnimIdx(0);
        if (animEvents.length <= 1) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduce) { setAnimIdx(animEvents.length - 1); return; }
        const pace = petFramePace(frame);
        const total = animEvents.reduce((sum, e) => sum + e.durationMs, 0) || 1;
        // Hit-stop: freeze the timeline a beat on the heaviest blows. We RESERVE
        // budget for the holds out of the per-frame pace so the base beats just
        // compress to fit the remainder — the whole queue still finishes within
        // pace*0.9, keeping the outer frame cadence (and ranked sync) untouched.
        const hVictimMaxHp = Math.max(1, frame?.actor === "enemy" ? playerPet.hp : enemyPet.hp);
        const holdOpts = { crit: !!frame?.crit, signature: !!frame?.signatureMove, isKO: !!frame?.isKO, heavyHit: !!frame?.damage && frame.damage >= hVictimMaxHp * 0.18 };
        const rawHolds = animEvents.map((e) => petCameraHoldMs(e.type, holdOpts));
        const rawHoldTotal = rawHolds.reduce((sum, h) => sum + h, 0);
        const holdBudget = Math.min(pace * 0.35, rawHoldTotal);
        const holdScale = rawHoldTotal > 0 ? holdBudget / rawHoldTotal : 0;
        const scale = Math.min(1, Math.max(0, pace * 0.9 - holdBudget) / total);
        const timers: number[] = [];
        let acc = 0;
        for (let i = 1; i < animEvents.length; i++) {
            acc += animEvents[i - 1].durationMs * scale + rawHolds[i - 1] * holdScale;
            timers.push(window.setTimeout(() => setAnimIdx(i), acc));
        }
        return () => timers.forEach((t) => window.clearTimeout(t));
    }, [animEvents]);
    const activeAnimEvent = animEvents[animIdx];

    // ── Camera + background (stage-level) ───────────────────────────────────
    // Screen shake is reserved for crits / heavy hits / KO (never routine
    // hits). A signature charge dims + zooms the stage while the wind-up glow
    // plays, then releases with a heavy shake on impact.
    const victimMaxHp = Math.max(1, frame?.actor === "enemy" ? playerPet.hp : enemyPet.hp);
    const heavyHit = !!frame?.damage && frame.damage >= victimMaxHp * 0.18;
    // Stage camera treatment (shake / focus+dim) for this beat — centralized in
    // the pure, tested pet-battle-camera director (which also drives hit-stop).
    const camera = petBattleCamera({
        resolved: !!winnerPet,
        isKO: !!frame?.isKO,
        crit: !!frame?.crit,
        signature: !!frame?.signatureMove,
        heavyHit,
        activeType: activeAnimEvent?.type,
        sigCharge: !!frame?.signatureMove && activeAnimEvent?.type === "charge",
    });
    const cameraClass = camera.className ? ` ${camera.className}` : "";

    // Fire a particle burst at the active beat's focal tile (target for a hit,
    // self for a charge). Positions read from the live tile DOM rect — same
    // approach the FLIP glide uses. Skipped under reduced-motion + once resolved.
    useEffect(() => {
        if (winnerPet || !activeAnimEvent) return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        const grid = petArenaGridRef.current;
        const canvas = vfxCanvasRef.current;
        if (!grid || !canvas) return;
        const focusTile = activeAnimEvent.type === "charge" ? selfTile : (effectTile >= 0 ? effectTile : selfTile);
        if (focusTile < 0) return;
        const tileEl = grid.querySelector<HTMLElement>(`.pet-park-tile[data-tile="${focusTile}"]`);
        if (!tileEl) return;
        const t = tileEl.getBoundingClientRect();
        const c = canvas.getBoundingClientRect();
        const cx = (t.left + t.right) / 2 - c.left;
        const cy = (t.top + t.bottom) / 2 - c.top;
        // Particle burst (Phase A).
        const field = vfxFieldRef.current;
        if (field) {
            const spec = vfxBurstForEvent(activeAnimEvent, { crit: !!frame?.crit, isKO: !!frame?.isKO, signature: !!frame?.signatureMove, flagship: !!frame?.signatureMove?.flagship });
            if (spec.kind !== "none") field.burst(cx, cy, spec);
        }
        // Sprite overlay (CC0 frames), chosen by beat × ability-kind × element via
        // the shared petFxSpriteKey picker so each ability reads distinctly: basics
        // slash; elemental/DoT hits use their own sheet (blood/shadow/poison now
        // have folders); heals/buffs/shields their support sheets; and KOs +
        // signature unleashes get the cinematic kaboom/charge tier. Beats with no
        // bundled sheet fall back to the particle burst above.
        const beat = activeAnimEvent.type;
        const sigSide = frame?.signatureMove?.side;
        const actorElement = (sigSide ?? frame?.actor) === "enemy" ? enemyPet.element : playerPet.element;
        const pick = petFxSpriteKey({
            beat,
            actionKind: frame?.actionKind,
            vfxKey: activeAnimEvent.vfxKey,
            signature: !!frame?.signatureMove,
            flagship: !!frame?.signatureMove?.flagship,
            element: actorElement,
            isKO: !!frame?.isKO,
        });
        if (pick.key) {
            const frames = bundledJutsuFxFrames(pick.key);
            if (frames) setPetSpriteFx({ id: petSpriteFxSeq.current++, frames, x: cx, y: cy, variant: pick.variant });
        }
    }, [animIdx, frame?.message]);

    // Status badges near the HP bar (Phases 7-9): the BattleStatusId set via the
    // shared registry (icon + remaining rounds), plus the value/flag badges
    // (ATK/DEF buff, shield amount, absorb, brace) that fall outside that set.
    const statusBadges = (st?: PetFrameStatus) => (
        <>
            {collectActorStatuses({ ...(st ?? {}), shield: undefined }).map((s) => {
                const def = BATTLE_STATUS_DEFS[s.id];
                return (
                    <span key={s.id} className={`pet-status-badge pet-status-${def.kind}`} title={`${def.label} — ${def.description}`}>
                        {def.icon}{s.rounds > 1 ? `×${s.rounds}` : ""}
                    </span>
                );
            })}
            {st?.atkBuff   && <span className="pet-status-badge atk" title="Attack up">⚔️ATK↑</span>}
            {st?.defBuff   && <span className="pet-status-badge def" title="Defense up">🛡️DEF↑</span>}
            {st?.shield    && <span className="pet-status-badge shield" title="Shield — absorbs damage before HP">🔰{st.shield}</span>}
            {st?.absorbing && <span className="pet-status-badge absorb" title="Absorb stance">✨ABSORB</span>}
            {st?.bracing   && <span className="pet-status-badge" title="Bracing — resists knockback and crits">🧱</span>}
        </>
    );

    return (
        <section className="pet-arena-battlefield">
            {/* Pre-fight face-off overlay — sprites flank the VS badge for a
                cinematic intro instead of a bare text "Pet A VS Pet B" line.
                Sliding-in avatars + a tagline make the start of a fight feel
                like an actual event. The overlay's existing 1.4s fade keeps
                it from blocking the battle. */}
            {frame?.isPrefight && (
                <div className="pet-prefight-overlay">
                    <div className="pet-prefight-vs">
                        <div className="pet-prefight-side player">
                            <div className="pet-prefight-portrait">
                                <PetBattleAvatar pet={playerPet} side="player" active sharedImages={sharedImages} />
                            </div>
                            <div className="pet-prefight-name player">{playerPet.name}</div>
                            <div className="pet-prefight-sub">Lv {playerPet.level} · {playerPet.rarity}{playerPet.element && playerPet.element !== "None" ? ` · ${playerPet.element}` : ""}</div>
                            <div className="pet-prefight-archetype">{petArchetypeFor(playerPet)}</div>
                            <div className="pet-prefight-stats">
                                <span>❤ {playerPet.hp}</span><span>⚔ {playerPet.attack}</span><span>🛡 {playerPet.defense}</span><span>⚡ {playerPet.speed}</span>
                            </div>
                            {playerRecord && (
                                <div className="pet-prefight-record">
                                    {playerRecord.wins !== undefined && <><span className="rec-w">{playerRecord.wins}W</span> <span className="rec-l">{playerRecord.losses ?? 0}L</span></>}
                                    {playerRecord.rating !== undefined && <span className="rec-elo">{playerRecord.wins !== undefined ? " · " : ""}{playerRecord.rating} Elo</span>}
                                </div>
                            )}
                        </div>
                        <span className="pet-prefight-vs-label">VS</span>
                        <div className="pet-prefight-side enemy">
                            <div className="pet-prefight-portrait">
                                <PetBattleAvatar pet={enemyPet} side="enemy" active sharedImages={sharedImages} />
                            </div>
                            <div className="pet-prefight-name enemy">{enemyPet.name}</div>
                            <div className="pet-prefight-sub">Lv {enemyPet.level} · {enemyPet.rarity}{enemyPet.element && enemyPet.element !== "None" ? ` · ${enemyPet.element}` : ""}</div>
                            <div className="pet-prefight-archetype">{petArchetypeFor(enemyPet)}</div>
                            <div className="pet-prefight-stats">
                                <span>❤ {enemyPet.hp}</span><span>⚔ {enemyPet.attack}</span><span>🛡 {enemyPet.defense}</span><span>⚡ {enemyPet.speed}</span>
                            </div>
                            {enemyRecord && (
                                <div className="pet-prefight-record">
                                    {enemyRecord.wins !== undefined && <><span className="rec-w">{enemyRecord.wins}W</span> <span className="rec-l">{enemyRecord.losses ?? 0}L</span></>}
                                    {enemyRecord.rating !== undefined && <span className="rec-elo">{enemyRecord.wins !== undefined ? " · " : ""}{enemyRecord.rating} Elo</span>}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="pet-prefight-tagline">
                        {prefightCount !== null && prefightCount > 0
                            ? <span className="pet-prefight-count" key={prefightCount}>{prefightCount}</span>
                            : <span className="pet-prefight-go">FIGHT!</span>}
                    </div>
                </div>
            )}

            {/* Trait flash banner */}
            {frame?.traitFlash && traitLabel && (
                <div key={frame.message} className={`pet-trait-flash ${frame.traitFlash.actor}`}>{traitLabel}</div>
            )}

            {/* Combo counter */}
            {frame?.combo && frame.combo >= 3 && (
                <div key={`combo-${frame.message}`} className={`pet-combo-counter ${frame.actor}`}>COMBO ×{frame.combo}</div>
            )}

            {/* Momentum tug-of-war — who's winning at a glance (player HP share). */}
            {!frame?.isPrefight && (
                <div className="pet-momentum-bar" aria-label="Momentum">
                    <div className="pet-momentum-fill-player" style={{ width: `${momentumPlayer}%` }} />
                    <div className="pet-momentum-fill-enemy" style={{ width: `${100 - momentumPlayer}%` }} />
                    <span className="pet-momentum-label player">{playerPet.name}</span>
                    <span className="pet-momentum-label enemy">{enemyPet.name}</span>
                </div>
            )}

            {/* Commentator — hype caller for the dramatic beats. */}
            {commentary && (
                <div key={`comm-${frame?.round}-${frame?.message}`} className="pet-commentary">{commentary}</div>
            )}

            {/* "1 HIT LEFT" — flashes when a fighter is on the brink. */}
            {oneHitWarn && <div className="pet-onehit-warn">⚠ ONE HIT LEFT ⚠</div>}

            {/* HP bars with status badges. 4-pet mode (simultaneous 2v2)
                renders four compact bars (lead + reserve per side). 1v1
                mode keeps the original two big bars below. */}
            {frame?.party4v4 ? (
                <div className="pet-arena-bars" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div style={{ display: "grid", gap: "0.3rem" }}>
                        {([
                            { slot: "playerLead",    pet: playerPet,        snap: frame.party4v4.playerLead },
                            { slot: "playerReserve", pet: playerReservePet, snap: frame.party4v4.playerReserve },
                        ] as const).map(({ slot, pet, snap }) => pet && (
                            <div key={slot} className={`pet-arena-fighter-bar${snap.ko ? " pet-arena-fighter-bar-ko" : ""}`} style={snap.ko ? { opacity: 0.45 } : undefined}>
                                <strong>{pet.name}{pet.element && pet.element !== "None" ? ` · ${pet.element}` : ""}{snap.ko ? " 💀" : ""}</strong>
                                <div className="pet-status-badges">
                                    {snap.status.poisoned && <span className="pet-status-badge poison">☠️×{snap.status.poisoned}</span>}
                                    {snap.status.burn     && <span className="pet-status-badge poison">🔥×{snap.status.burn}</span>}
                                    {snap.status.freeze   && <span className="pet-status-badge movelock">🧊×{snap.status.freeze}</span>}
                                    {snap.status.confuse  && <span className="pet-status-badge movelock">🌀×{snap.status.confuse}</span>}
                                    {snap.status.stun     && <span className="pet-status-badge movelock">💤×{snap.status.stun}</span>}
                                    {snap.status.shield   && <span className="pet-status-badge shield">🔰{snap.status.shield}</span>}
                                    {snap.status.absorbing && <span className="pet-status-badge absorb">✨ABSORB</span>}
                                </div>
                                <span>{snap.hp}/{snap.maxHp} HP</span>
                                <div className={`pet-arena-hpbar${!winnerPet && (snap.hp / snap.maxHp * 100) <= 30 ? " pet-arena-hpbar-low" : ""}`}>
                                    <i style={{ width: `${Math.max(0, Math.min(100, (snap.hp / snap.maxHp) * 100))}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: "grid", gap: "0.3rem" }}>
                        {([
                            { slot: "enemyLead",    pet: enemyPet,        snap: frame.party4v4.enemyLead },
                            { slot: "enemyReserve", pet: enemyReservePet, snap: frame.party4v4.enemyReserve },
                        ] as const).map(({ slot, pet, snap }) => pet && (
                            <div key={slot} className={`pet-arena-fighter-bar enemy${snap.ko ? " pet-arena-fighter-bar-ko" : ""}`} style={snap.ko ? { opacity: 0.45 } : undefined}>
                                <strong>{enemyOwner}: {pet.name}{pet.element && pet.element !== "None" ? ` · ${pet.element}` : ""}{snap.ko ? " 💀" : ""}</strong>
                                <div className="pet-status-badges">
                                    {snap.status.poisoned && <span className="pet-status-badge poison">☠️×{snap.status.poisoned}</span>}
                                    {snap.status.burn     && <span className="pet-status-badge poison">🔥×{snap.status.burn}</span>}
                                    {snap.status.freeze   && <span className="pet-status-badge movelock">🧊×{snap.status.freeze}</span>}
                                    {snap.status.confuse  && <span className="pet-status-badge movelock">🌀×{snap.status.confuse}</span>}
                                    {snap.status.stun     && <span className="pet-status-badge movelock">💤×{snap.status.stun}</span>}
                                    {snap.status.shield   && <span className="pet-status-badge shield">🔰{snap.status.shield}</span>}
                                    {snap.status.absorbing && <span className="pet-status-badge absorb">✨ABSORB</span>}
                                </div>
                                <span>{snap.hp}/{snap.maxHp} HP</span>
                                <div className={`pet-arena-hpbar${!winnerPet && (snap.hp / snap.maxHp * 100) <= 30 ? " pet-arena-hpbar-low" : ""}`}>
                                    <i style={{ width: `${Math.max(0, Math.min(100, (snap.hp / snap.maxHp) * 100))}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
            <div className="pet-arena-bars">
                <div className={`pet-arena-fighter-bar${playerShake ? " pet-hp-shaking" : ""}`}>
                    <strong>{playerPet.name}</strong>
                    <div className="pet-status-badges">{statusBadges(frame?.playerStatus)}</div>
                    <span>{playerHp}/{playerPet.hp} HP</span>
                    <div className={`pet-arena-hpbar${!winnerPet && playerPercent <= 30 ? " pet-arena-hpbar-low" : ""}`}>
                        <i style={{ width: `${playerPercent}%` }} />
                        {playerFloatClass && frame && (
                            <span key={frame.message} className={playerFloatClass}>
                                {frame.actionKind === "lifesteal" ? `🩸 +${frame.damage}` : frame.crit ? `💥 CRIT -${frame.damage}` : frame.actionKind === "dot" ? `☠️ -${frame.damage}` : frame.actionKind === "heal" ? `💚 +${frame.damage ?? "heal"}` : `-${frame.damage}`}
                            </span>
                        )}
                    </div>
                </div>

                <div className={`pet-arena-fighter-bar enemy${enemyShake ? " pet-hp-shaking" : ""}`}>
                    <strong>{enemyOwner}: {enemyPet.name}</strong>
                    <div className="pet-status-badges">{statusBadges(frame?.enemyStatus)}</div>
                    <span>{enemyHp}/{enemyPet.hp} HP</span>
                    <div className={`pet-arena-hpbar${!winnerPet && enemyPercent <= 30 ? " pet-arena-hpbar-low" : ""}`}>
                        <i style={{ width: `${enemyPercent}%` }} />
                        {enemyFloatClass && frame && (
                            <span key={frame.message} className={enemyFloatClass}>
                                {frame.actionKind === "lifesteal" ? `🩸 +${frame.damage}` : frame.crit ? `💥 CRIT -${frame.damage}` : frame.actionKind === "dot" ? `☠️ -${frame.damage}` : frame.actionKind === "heal" ? `💚 +${frame.damage ?? "heal"}` : `-${frame.damage}`}
                            </span>
                        )}
                    </div>
                </div>
            </div>
            )}

            <div className={`pet-park-stage${cameraClass}${dangerZone ? " pet-stage-danger" : ""}`}>
                {/* Particle VFX layer (Phase A) — overlays the stage; driven by
                    the animation-event queue via vfxFieldRef. Cosmetic only. */}
                <canvas ref={vfxCanvasRef} className="pet-vfx-canvas" aria-hidden="true" />
                {/* Elemental sprite effect (CC0 frames) over the struck tile, above
                    the particle canvas. Re-keyed per beat so it restarts cleanly.
                    Pets themselves are untouched — this is an effect overlay only. */}
                {petSpriteFx && (
                    <JutsuSpriteFx
                        key={petSpriteFx.id}
                        frames={petSpriteFx.frames}
                        single={false}
                        x={petSpriteFx.x}
                        y={petSpriteFx.y}
                        variant={petSpriteFx.variant}
                        onDone={() => setPetSpriteFx((s) => (s && s.id === petSpriteFx.id ? null : s))}
                    />
                )}
                {/* Mute toggle for the synthesized battle SFX. */}
                <button
                    type="button"
                    className="pet-sfx-toggle"
                    onClick={() => { const next = !sfxMuted; setSfxMuted(next); setPetSfxMuted(next); }}
                    title={sfxMuted ? "Unmute battle sounds" : "Mute battle sounds"}
                    aria-label={sfxMuted ? "Unmute battle sounds" : "Mute battle sounds"}
                >{sfxMuted ? "🔇" : "🔊"}</button>
                {/* Impact flash — a brief full-stage colour pop at the moment of
                    contact. Keyed per frame so it restarts on every blow even
                    when two hits of the same kind land back-to-back. */}
                {frame && !winnerPet && (frame.actionKind === "damage" || frame.actionKind === "basic" || frame.actionKind === "lifesteal" || frame.isKO) && (
                    <div
                        key={`flash-${frame.message}`}
                        className={`pet-impact-flash${frame.isKO ? " ko" : frame.crit ? " crit" : ""}${frame.isKO ? "" : elClass}`}
                        aria-hidden="true"
                    />
                )}
                {/* Super-effective slam — surfaces the element matchup the sim already applied. */}
                {superEffective && (
                    <div key={`se-${frame!.message}`} className="pet-super-effective" aria-hidden="true">Super Effective!</div>
                )}
                {/* Low-HP danger vignette — red pulse closes in as a fighter nears death. */}
                {dangerZone && <div className="pet-danger-vignette" aria-hidden="true" />}
                {/* Signature jutsu cut-in — anime-style portrait + move-name slam. */}
                {frame?.signatureMove && (
                    <div className={`pet-cutin ${frame.signatureMove.side}`} key={`cutin-${frame.round}-${frame.message}`}>
                        <div className="pet-cutin-portrait">
                            <PetBattleAvatar pet={frame.signatureMove.side === "player" ? playerPet : enemyPet} side={frame.signatureMove.side} active sharedImages={sharedImages} />
                        </div>
                        <div className="pet-cutin-text">
                            <span className="pet-cutin-pet">{frame.signatureMove.petName}</span>
                            <span className="pet-cutin-move">{frame.signatureMove.name}!</span>
                        </div>
                    </div>
                )}
                {/* Move-name callout — brief banner as a (non-signature) move
                    fires; the signature cut-in above announces its own name. */}
                {!winnerPet && activeAnimEvent?.type === "moveCallout" && activeAnimEvent.text && (
                    <div className="move-callout" key={`callout-${frame?.message}-${animIdx}`}>{activeAnimEvent.text}</div>
                )}
                {/* KO freeze overlay */}
                {frame?.isKO && !winnerPet && (
                    <div className="pet-ko-overlay">K.O. ??</div>
                )}

                <div ref={petArenaGridRef} className={`pet-park-grid pet-vfx-${winnerPet ? "idle" : (frame?.actionKind ?? "idle")} pet-vfx-actor-${frame?.actor ?? "system"}`} aria-label="Pet arena park battlefield">
                    {(() => {
                        // 4-pet mode: build a position→pet map covering all
                        // living party members. 1v1 mode keeps the old 2-pet
                        // layout via playerPos / enemyPos.
                        // isTarget flags the pet receiving an incoming hit
                        // so PetBattleAvatar can play the recoil/flash. For
                        // 2v2 the simulator names a slot via party4v4.targetSlot;
                        // for 1v1 the target is just the opposite side of the
                        // actor on damage-class actions.
                        const HIT_ACTIONS = new Set(["damage", "basic", "dot", "lifesteal"] as const);
                        const isHitFrame = !!frame?.actionKind && (HIT_ACTIONS as Set<string>).has(frame.actionKind);
                        type GridPet = { pet: Pet; side: "player" | "enemy"; ko: boolean; isActor: boolean; isTarget: boolean };
                        const positionMap = new Map<number, GridPet>();
                        if (frame?.party4v4) {
                            const p4 = frame.party4v4;
                            // Place ALL fielded party pets — including KO'd ones,
                            // which stay on the grid toppled/greyed (see `faint`
                            // below) instead of vanishing. This is what 1v1
                            // already does for the loser, and it means a 2v2
                            // always shows both pets per side, not just the
                            // survivor. Each entry carries its OWN ko flag so a
                            // downed ally never drags its still-standing partner
                            // into the faint pose.
                            const partySlots = [
                                { pet: playerPet,        side: "player" as const, slot: "playerLead"    as const, snap: p4.playerLead },
                                { pet: playerReservePet, side: "player" as const, slot: "playerReserve" as const, snap: p4.playerReserve },
                                { pet: enemyPet,         side: "enemy"  as const, slot: "enemyLead"     as const, snap: p4.enemyLead },
                                { pet: enemyReservePet,  side: "enemy"  as const, slot: "enemyReserve"  as const, snap: p4.enemyReserve },
                            ];
                            // Two passes: add KO'd pets first, living pets second,
                            // so a living pet that has stepped onto a freed square
                            // wins the cell instead of being hidden under a corpse.
                            for (const koPass of [true, false]) {
                                for (const s of partySlots) {
                                    if (!s.pet || s.snap.ko !== koPass) continue;
                                    positionMap.set(s.snap.pos, { pet: s.pet, side: s.side, ko: s.snap.ko, isActor: p4.actorSlot === s.slot, isTarget: isHitFrame && p4.targetSlot === s.slot });
                                }
                            }
                        } else {
                            positionMap.set(playerPos, { pet: playerPet, side: "player", ko: false, isActor: frame?.actor === "player", isTarget: isHitFrame && frame?.actor === "enemy" });
                            positionMap.set(enemyPos,  { pet: enemyPet,  side: "enemy",  ko: false, isActor: frame?.actor === "enemy",  isTarget: isHitFrame && frame?.actor === "player" });
                        }
                        return Array.from({ length: PET_GRID_SIZE }, (_, index) => {
                            const here = positionMap.get(index);
                            // Tactical tile type (Phases 5-6). Blocked + cover are both
                            // impassable obstacles (pets path around them); cover renders
                            // as a lower wall. Hazard / healing / slow are passable but
                            // tinted. Falls back to the legacy obstacles list (all blocked).
                            const tileType = tileTypeByIndex.get(index);
                            const isCover     = tileType === "cover";
                            const isObstacle  = isCover || tileType === "blocked" || (tileTypeByIndex.size === 0 && (obstacles ?? []).includes(index));
                            const tileFxClass = tileType === "hazard" ? " pet-tile-hazard" : tileType === "healing" ? " pet-tile-healing" : tileType === "slow" ? " pet-tile-slow" : "";
                            // Tactical zone (Phase 10-14) — a faint highlight on the
                            // contested centre columns focuses the eye on where pets
                            // actually fight, without using the whole oversized grid.
                            const zoneClass = !isObstacle && petTacticalZone(index % PET_GRID_COLS, tileType) === "frontline" ? " pet-zone-frontline" : "";
                            // Target-tile highlight during an offensive beat.
                            const isTargetTile = !winnerPet && index === targetTile && (frame?.actionKind === "damage" || frame?.actionKind === "basic" || frame?.actionKind === "lifesteal" || frame?.actionKind === "dot" || frame?.actionKind === "debuff" || frame?.actionKind === "movelock");
                            const isTrail     = index >= 42 && index <= 55; // row 3 of 14-col, 7-row grid (centre lane)
                            // Once a winner is decided, stop firing per-tile glows and
                            // the centre-tile vfx burst. Otherwise the result frame's
                            // tile pulse + victory ring + sparks fire UNDER the winner
                            // card, which reads as a broken end-of-fight flicker.
                            const isActionTile = !winnerPet && frame?.actionKind && !!here;
                            const hasEffect   = !winnerPet && index === effectTile && frame?.actionKind;
                            // Pseudo-3D depth + loser faint ride a wrapper BETWEEN the
                            // glide-mover and the avatar, so neither collides with the
                            // FLIP translate (mover) nor the lunge/walk (avatar). Depth:
                            // scale/brighten by grid row so up-field reads as farther
                            // (row 3 = centre lane = neutral 1.0). Faint: the pet that
                            // just hit 0 HP topples, sinks, and desaturates in place.
                            const depthRow = Math.floor(index / PET_GRID_COLS);
                            const depthScale = 1 + (depthRow - 3) * 0.04;
                            // In 2v2 the side-wide playerHp/enemyHp track only the
                            // lead pet, so they can't decide faint per pet — a downed
                            // lead would otherwise topple its living reserve too
                            // (the "2nd pet glitches after a KO" bug). Use the slot's
                            // own KO flag in party mode; in 1v1 there's a single pet
                            // per side, so the side HP is the right signal.
                            const faint = !!here && (frame?.party4v4 ? here.ko : (here.side === "player" ? (frame?.playerHp ?? 1) <= 0 : (frame?.enemyHp ?? 1) <= 0));
                            const depthStyle: React.CSSProperties = {
                                transform: faint
                                    ? `scale(${depthScale}) translateY(15px) rotate(${here!.side === "player" ? -68 : 68}deg)`
                                    : `scale(${depthScale})`,
                                filter: faint ? "grayscale(0.85) brightness(0.5)" : `brightness(${(1 + (depthRow - 3) * 0.03).toFixed(3)})`,
                                opacity: faint ? 0.62 : 1,
                            };
                            return (
                                <div
                                    key={index}
                                    data-tile={index}
                                    className={`pet-park-tile${isObstacle ? " pet-obstacle" : ""}${isCover ? " pet-tile-cover" : ""}${tileFxClass}${zoneClass}${isTargetTile && !isObstacle ? " pet-target-tile" : ""}${isTrail && !isObstacle ? " pet-path" : ""}${isActionTile && !isObstacle ? " pet-action-tile" : ""}${hasEffect && !isObstacle ? ` pet-vfx-tile pet-vfx-tile-${frame?.actionKind}` : ""}${here && !isObstacle ? " pet-occupied" : ""}`}
                                >
                                    {isObstacle && (
                                        <div className={`pet-obstacle-block${isCover ? " pet-obstacle-cover" : ""}`}>
                                            <div className="pet-obstacle-top" />
                                            <div className="pet-obstacle-face" />
                                            <div className="pet-obstacle-side" />
                                        </div>
                                    )}
                                    {hasEffect && (
                                        <span className={`pet-battle-vfx${frame?.crit ? " crit" : ""}${frame?.isKO ? " ko" : ""}${frame?.isKO ? "" : elClass}`} key={`${frame?.message}-${index}`}>
                                            <i />
                                            <b className={effectNumberClass}>{effectLabel}</b>
                                            <em />
                                        </span>
                                    )}
                                    {/* Grounding — an impact ring expands on the floor at the
                                        moment of contact (Phase A increment 2). Fires on the
                                        impact beat at the struck tile; element-tinted, brighter
                                        on a crit. Sits on the ground plane (tile-local). */}
                                    {!winnerPet && activeAnimEvent?.type === "impact" && index === effectTile && !isObstacle && (
                                        <span className={`pet-impact-ring${frame?.crit ? " crit" : ""}${elClass}`} key={`ring-${frame?.message}-${animIdx}`} aria-hidden="true" />
                                    )}
                                    {/* Per-frame key forces a fresh mount each tick so the
                                        CSS lunge / hit animations restart cleanly on every
                                        successive blow — without this, two back-to-back
                                        damage frames against the same target would only
                                        animate once (CSS quirk: animation-name doesn't
                                        restart when the same class persists). */}
                                    {here && (
                                        <div className="pet-avatar-mover" data-petid={here.pet.id}>
                                            <div className={`pet-avatar-depth${faint ? " pet-fainted" : ""}`} style={depthStyle}>
                                                <PetBattleAvatar key={`${here.pet.id}-${frame?.message ?? "idle"}`} pet={here.pet} side={here.side} active={here.isActor} hit={here.isTarget && !faint} status={here.side === "player" ? frame?.playerStatus : frame?.enemyStatus} sharedImages={sharedImages} visualState={petPoseForAvatar(activeAnimEvent, here.pet.id, !!winnerPet && here.side === winnerSide, faint)} />
                                            </div>
                                        </div>
                                    )}
                                    {/* Ranged projectile — fired from the acting pet's tile
                                        toward its target across `--pdist` tile-widths. Keyed
                                        per event so it restarts; player fires right (+1),
                                        enemy fires left (−1). Element drives the VFX look. */}
                                    {here && !winnerPet && activeAnimEvent && (activeAnimEvent.type === "projectile" || activeAnimEvent.type === "beam") && activeAnimEvent.actorId === here.pet.id && (
                                        <span
                                            key={`proj-${frame?.message ?? ""}-${animIdx}`}
                                            className={`pet-projectile pet-proj-${activeAnimEvent.type} ${
                                                activeAnimEvent.vfxKey === "fire"      ? "vfx-fire-projectile" :
                                                activeAnimEvent.vfxKey === "shadow"    ? "vfx-shadow-slash" :
                                                activeAnimEvent.vfxKey === "lightning" ? "vfx-lightning-bolt" :
                                                activeAnimEvent.vfxKey === "poison"    ? "vfx-poison-cloud" :
                                                `pet-pvfx-${activeAnimEvent.vfxKey ?? "none"}`
                                            }`}
                                            style={{ ["--face" as string]: here.side === "player" ? 1 : -1, ["--pdist" as string]: Math.max(1, Math.min(11, battleDist)) }}
                                            aria-hidden="true"
                                        />
                                    )}
                                    {/* Localized VFX layer — impact flash + dust on the target,
                                        shield aura / heal glow on the actor, status pop on the
                                        afflicted pet, DODGE text on the dodger. Event-driven, so
                                        each beat fires at its moment in the timeline. */}
                                    {here && !winnerPet && activeAnimEvent && (() => {
                                        const ae = activeAnimEvent;
                                        const evtActor = ae.actorId === here.pet.id;
                                        const evtTarget = ae.targetId === here.pet.id;
                                        const k = `${frame?.message ?? ""}-${animIdx}`;
                                        return (
                                            <>
                                                {ae.type === "impact" && evtTarget && <span key={`imp-${k}`} className="vfx-impact-flash" aria-hidden="true" />}
                                                {ae.type === "impact" && evtTarget && <span key={`dust-${k}`} className="vfx-dust-burst" aria-hidden="true" />}
                                                {ae.type === "guard" && evtActor && <span key={`shld-${k}`} className="vfx-shield-aura" aria-hidden="true" />}
                                                {ae.type === "charge" && evtActor && ae.vfxKey === "chakra" && <span key={`heal-${k}`} className="vfx-heal-glow" aria-hidden="true" />}
                                                {ae.type === "statusApply" && evtTarget && <span key={`stat-${k}`} className="vfx-status-pop" aria-hidden="true" />}
                                                {ae.type === "dodge" && evtActor && <span key={`dodge-${k}`} className="dodge-text">DODGE</span>}
                                            </>
                                        );
                                    })()}
                                </div>
                            );
                        });
                    })()}
                </div>

                {winnerPet && (
                    <div className={`pet-victory-screen ${winnerSide}`}>
                        {/* Removed the rotating <pet-victory-burst /> sparkle ring —
                            its 1.8s infinite spin read as a broken-looking flicker
                            against the static winner card. The card now sits calm. */}
                        <PetBattleAvatar pet={winnerPet} side={winnerSide} active sharedImages={sharedImages} visualState="victory" />
                        <div>
                            <span>Arena Winner</span>
                            <strong>{winnerPet.name}</strong>
                            <p>{winnerOwner} wins the match.</p>
                        </div>
                        <div className="pet-victory-actions">
                            <button type="button" onClick={onFightAgain}>Fight Again</button>
                            <button type="button" className="danger-button" onClick={onExit}>Exit</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Round event ticker — last 3 non-system events */}
            {recentFrames && recentFrames.length > 0 && (
                <div className="pet-event-ticker">
                    {[...recentFrames].reverse().map((f, i) => (
                        <span key={`${f.message}-${i}`} className={`pet-event-chip ${f.actor} ${f.actionKind ?? ""} ${i === 0 ? "latest" : ""}`}>
                            {f.actionKind === "dot" ? "☠" : f.actionKind === "buff" ? "⬆" : f.actionKind === "heal" ? "✚" : f.actionKind === "move" ? "➡" : f.actionKind === "debuff" ? "⬇" : f.actionKind === "lifesteal" ? "🧛" : f.actionKind === "shield" ? "🛡" : f.actionKind === "absorb" ? "🌀" : f.actionKind === "barrier" ? "◇" : f.actionKind === "movelock" ? "⛓" : f.crit ? "💥" : "⚔"}
                            {" "}{f.message.replace(/^Round \d+: /, "").slice(0, 42)}
                        </span>
                    ))}
                </div>
            )}

            <div className={`pet-arena-current-action ${frame?.actor ?? "system"}`}>
                <span>{frame?.round ? `Round ${frame.round}` : "Ready"}</span>
                <strong>{frame?.message ?? "Pick two pets and start the match."}</strong>
                {result && frame?.actionKind === "result" && <button onClick={onReplay}>Replay</button>}
            </div>
        </section>
    );
}

// PvP-battle + leaderboard/tavern shared UI types moved to ./types/pvp-ui.
// FestivalPortrait moved to ./components/Pills.
import type { PvpSessionState } from "./types/pvp-ui";
export type { LbTab, TavernMessage, PvpGroundEffectState } from "./types/pvp-ui";
export type { PvpSessionState };
