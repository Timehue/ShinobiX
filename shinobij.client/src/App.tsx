import { retireStalePetDuel } from "./lib/pet-duel-legacy-challenge";
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import type * as React from "react";
import { installAuthFetch, isTokenExpired, setActivePlayer, setActiveToken, setAdminSession, SESSION_EXPIRED_EVENT, SAVE_VERSION_EVENT, type SaveVersionEventDetail } from "./authFetch";
import { isReleaseSafeClientEvent } from "./lib/release-safe-content";
import { GameAlertHost, GameConfirmHost, GamePasswordPromptHost, gameConfirm, gamePasswordPrompt } from "./components/GameAlert";
import { GameToastHost, gameToast } from "./components/GameToast";
import { IncomingChallengeModal } from "./components/IncomingChallengeModal";
import { AdaptiveGameShell } from "./components/layout/AdaptiveGameShell";
import { MaintenanceOperatorBoundary } from "./components/MaintenanceOperatorBoundary";
// (No save-conflict banner import: that component is deleted — it warned about
// ordinary unsaved progress and could not be cleared. Capture is silent now; the
// protection stayed, only the surface went. lib/save-conflict.test.ts forbids
// naming it in this file at all, comments included.)
import { SaveErrorBanner } from "./components/SaveErrorBanner";
import { SessionExpiredModal } from "./components/SessionExpiredModal";
import { startBootGateWatchdog } from "./lib/boot-gate-watchdog";
import { ScreenErrorBoundary } from "./components/ScreenErrorBoundary";
import { ScreenLoadingFallback } from "./components/ScreenLoadingFallback";
import { ScreenReadyProbe } from "./components/ScreenReadyProbe";
import { ToastStacks, type MissionToast } from "./components/ToastStacks";
import { claimBountyOnWin } from "./lib/pvp-bounty";
import { deleteServerAccount, DELETE_ACCOUNT_ERRORS } from "./lib/mission-combat-claim";
import { useClaimOutboxDrain } from "./lib/claim-outbox";
import {
    enqueueRaidReport,
    flushRaidReportOutbox,
    postPvpRaidReport,
    requireRaidReportAcknowledgement,
    type RaidReportDrainResult,
} from "./lib/raid-report-outbox";
import { strikeDownSleeper } from "./lib/sleeper-kill";
import { claimBuiltinEventReward } from "./lib/event-claim-api";
import { requestAiFight } from "./lib/ai-fight-request";
import { creatorEventPracticeOpponent } from "./lib/creator-event-practice";
import type { FieldExploreProgress } from "./lib/world-reward-api";
import { useEndlessTowerActions } from "./lib/use-endless-tower-actions";
import { readSavePreview, writeSavePreview } from "./lib/save-preview";
import { setBootKind as perfSetBootKind, notifyScreen as perfNotifyScreen, notifyRestoreComplete as perfNotifyRestoreComplete } from "./lib/perfTelemetry";
import { lazyWithRetry } from "./lib/lazyWithRetry";
import { runSingleFlight } from "./lib/single-flight";
import { adoptSaveVersion } from "./lib/save-version";
import { accountKey, forgetAccountToken, loadPlayerAccounts, normalizePendingTravel, rememberAccountToken, savePlayerAccounts } from "./lib/player-accounts";
import type { PendingTravelSave } from "./lib/player-accounts";
// Types only — the tile resolver itself is loaded on demand (see
// ./lib/hollow-gate-generator-loader); its one call site already awaits the
// server's step seal first, so the import costs nothing extra.
import type { HiddenChamberState, HollowGateEventModal } from "./lib/hollow-gate-tile";
import {
    createSaveFlightCoordinator,
    nextSavePayloadRevision,
} from "./lib/save-flight";
import { createSavePersistence } from "./lib/save-persistence";
import { protectSaveOnUnload } from "./lib/save-unload";
import { beginSessionLoad, sessionLoadFetch } from "./lib/session-load-authority";
import {
    createSaveConflictDraftStore,
    saveConflictAccountKey,
    type SaveConflictDraft,
} from "./lib/save-conflict";
import { fetchPlayerSave, saveLoadFailure, verifyPlayerCredentials, SAVE_UNREACHABLE_MESSAGE, SESSION_ENDED_MESSAGE, type SaveLoadFailure } from "./lib/player-login";
import { finishGoogleRedirect, forgetGoogleNonce, readGoogleRedirect } from "./lib/google-signin";
import { clearGuestSessionFor, rememberGuestSession, resumeGuestFor, signupRequestBody, type SignupCredential } from "./lib/guest-play";
import { preloadScreen } from "./lib/screen-preload";
import { imageCategoriesForScreen } from "./lib/screen-image-categories";
import { resolveDungeonWardenPortrait } from "./lib/ai-fight-art";
import { STUDIO_SCREEN_PRESENTATION } from "./lib/studio-screen-presentation";
import { updateRealtimePresence, usePresenceSocket } from "./lib/use-presence-socket";
import { useViewportContract } from "./lib/use-viewport-contract";
import {
    useCapabilityMutationAvailability,
    useCapabilityViewAvailability,
    useLiveCapabilities,
} from "./lib/live-capabilities-context";
import {
    capabilityAdmissionAllowed,
    playerSurfaceBlockerMode,
    playerLoginAdmissionMessage,
    registrationAdmissionMessage,
    sectorMapAdmissionMessage,
    settleAdmission,
    villageWarScreenMountAllowed,
} from "./lib/live-capability-admission";
import { useCapabilityGuardedAutosave } from "./lib/use-capability-guarded-autosave";
import { pushLiveSectorPlayers, getLiveSectorPlayers, setLiveAvatarPrefetch, getLocalSectorTile, setLiveSectorContext } from "./lib/presence-store";
import { worldSectorReconcileTarget } from "./lib/sector-reconcile";
import { mergeServerPendingWorldRewards } from "./lib/world-reward-recovery";
import { presenceCharacter, peerIsTraveling } from "./lib/presence-character";
import { noteServerTime } from "./lib/server-clock";
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
import { countItem, ownsItem, normalizeInventory } from "./lib/inventory";
import type { TileCard } from "./data/tile-cards";
import {
    scaleJutsuTagsForDisplay,
} from "./lib/jutsu-scaling";
import { useJutsuTrainingQueueRunner } from "./lib/jutsu-training-queue";
import {
    jutsuEffectInfo,
    jutsuDisplayAtLevel,
} from "./lib/jutsu-effects";
import { normalizeJutsu, orderEquippedJutsus } from "./lib/jutsu";
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
} from "./lib/endless-tower";
export { endlessScaleFactor, endlessWaveReward, endlessTowerMilestoneReward };
import {
    baseStats,
    normalizeStats,
    maxedStats,
    maxHpForLevel,
    maxChakraForLevel,
    maxStaminaForLevel,
    rankFromLevel,
    levelForEarned,
    earnedStatPoints,
    reconcileCharacterStatBudget,
} from "./lib/stats";
import {
    dailyMissionsCompleted,
    dailyHuntsCompleted,
    rankTitleForLevel,
    applyStoryChoice, deriveStoryTraits,
} from "./lib/character-progress";
import { normalizeLoadedVital, regenerateIdleVitals } from "./lib/loaded-vitals";
import { acceptVersionedSnapshot } from "./lib/versioned-snapshot";
export { dailyMissionsCompleted, dailyHuntsCompleted };
// Install the global fetch interceptor once at module load. From here on,
// every fetch('/api/...') call automatically picks up x-player-name and
// x-player-password from the active session (managed via setActivePlayer).
installAuthFetch();
import backgroundImage from "./assets/background-image.webp";
import { academyTrainingDummyImg, withAcademySparringPortrait } from "./lib/academy-ai-art";
const Inventory = lazyWithRetry(() => import("./screens/Inventory").then(m => ({ default: m.Inventory })));
const BattleLogScreen = lazyWithRetry(() => import("./screens/BattleLogScreen").then(m => ({ default: m.BattleLogScreen })));
const Hospital = lazyWithRetry(() => import("./screens/Hospital").then(m => ({ default: m.Hospital })));
const VillageTavern = lazyWithRetry(() => import("./screens/VillageTavern").then(m => ({ default: m.VillageTavern })));
const AdminLogin = lazyWithRetry(() => import("./screens/AdminLogin").then(m => ({ default: m.AdminLogin })));
const Cafeteria = lazyWithRetry(() => import("./screens/Cafeteria").then(m => ({ default: m.Cafeteria })));
const HallOfLegends = lazyWithRetry(() => import("./screens/HallOfLegends").then(m => ({ default: m.HallOfLegends })));
const ProfessionPicker = lazyWithRetry(() => import("./screens/ProfessionPicker").then(m => ({ default: m.ProfessionPicker })));
const Professions = lazyWithRetry(() => import("./screens/Professions").then(m => ({ default: m.Professions })));
const loadIntroCinematic = () => import("./features/intro-cinematic/IntroCinematic").then(m => ({ default: m.IntroCinematic }));
const IntroCinematic = lazyWithRetry(loadIntroCinematic);
const Bank = lazyWithRetry(() => import("./screens/Bank").then(m => ({ default: m.Bank })));
const EndlessTowerLobby = lazyWithRetry(() => import("./screens/EndlessTowerLobby").then(m => ({ default: m.EndlessTowerLobby })));
const EndlessTowerFight = lazyWithRetry(() => import("./screens/EndlessTowerFight").then(m => ({ default: m.EndlessTowerFight })));
const HollowGateFight = lazyWithRetry(() => import("./screens/HollowGateFight").then(m => ({ default: m.HollowGateFight })));
// The sealed PET duel, on the Showdown engine and bound to the run.
const HollowGatePetFight = lazyWithRetry(() => import("./components/HollowGatePetFight").then(m => ({ default: m.HollowGatePetFight })));
const VillageWarScreen = lazyWithRetry(() => import("./screens/VillageWarScreen").then(m => ({ default: m.VillageWarScreen })));
const VillageWarMap = lazyWithRetry(() => import("./screens/VillageWarMap").then(m => ({ default: m.VillageWarMap })));
const SectorWarCardBattle = lazyWithRetry(() => import("./screens/SectorWarCardBattle").then(m => ({ default: m.SectorWarCardBattle })));
const SectorWarPetBattle = lazyWithRetry(() => import("./screens/SectorWarPetBattle").then(m => ({ default: m.SectorWarPetBattle })));
const SectorWarGarrisonAssault = lazyWithRetry(() => import("./screens/SectorWarGarrisonAssault").then(m => ({ default: m.SectorWarGarrisonAssault })));
const ClanWarPetBattle = lazyWithRetry(() => import("./screens/ClanWarPetBattle").then(m => ({ default: m.ClanWarPetBattle })));
const ClanWar2v2Battle = lazyWithRetry(() => import("./screens/ClanWar2v2Battle").then(m => ({ default: m.ClanWar2v2Battle })));
const CardClashFreePlay = lazyWithRetry(() => import("./screens/CardClashFreePlay").then(m => ({ default: m.CardClashFreePlay })));
const WeeklyBossArena = lazyWithRetry(() => import("./screens/WeeklyBossArena").then(m => ({ default: m.WeeklyBossArena })));
const BloodlineMaker = lazyWithRetry(() => import("./screens/BloodlineMaker").then(m => ({ default: m.BloodlineMaker })));
const Profile = lazyWithRetry(() => import("./screens/Profile").then(m => ({ default: m.Profile })));
const Logbook = lazyWithRetry(() => import("./screens/Logbook").then(m => ({ default: m.Logbook })));
const HunterBoard = lazyWithRetry(() => import("./screens/HunterBoard").then(m => ({ default: m.HunterBoard })));
const Missions = lazyWithRetry(() => import("./screens/Missions").then(m => ({ default: m.Missions })));
const StoryHall = lazyWithRetry(() => import("./screens/StoryBoss").then(m => ({ default: m.StoryArchiveHall })));
const StoryBoss = lazyWithRetry(() => import("./screens/StoryBoss").then(m => ({ default: m.StoryBoss })));
const TownHall = lazyWithRetry(() => import("./screens/TownHall").then(m => ({ default: m.TownHall })));
const ClanHall = lazyWithRetry(() => import("./screens/ClanHall").then(m => ({ default: m.ClanHall })));
import { BATTLE_LOCK_ID_KEY, BATTLE_LOCK_RESOLVED_KEY, postBattleLock, arenaStoryCtxKey, fetchBattleLockStatus, battleResumeStateExists, readArenaStoryContext, type ClientBattleLock } from "./lib/battle-save";
import { postFieldTrail } from "./lib/field-trail-api";
import { postPlayerChallengeNotice } from "./lib/player-api";
import { EXAM_LEVEL_GATES } from "./constants/game";
const WorldMap = lazyWithRetry(() => import("./screens/WorldMap").then(m => ({ default: m.WorldMap })));
const WorldCrisis = lazyWithRetry(() => import("./screens/WorldCrisis").then(m => ({ default: m.WorldCrisis })));
const loadMissionCatalog = () => import("./data/missions");
const mutateDungeonRunServer = (playerName: string, action: "start" | "settle" | "abandon", token = "") =>
    import("./lib/dungeon-api").then((api) => api.mutateDungeonRunServer(playerName, action, token));
import { fetchPlayerCombatSave, stringifyPvpSessionPayload, pvpSessionEnvironment } from "./lib/pvp-session";
import { readPvpBrowserBreadcrumb, type PvpRecoveryContext } from "./lib/pvp-pending-session";
const loadPvpSessionCreate = () => import("./lib/pvp-session-create"), loadPvpPendingFetch = () => import("./lib/pvp-pending-fetch");
import { usePvpSessionController } from "./lib/use-pvp-session-controller";
import type { OwnSaveReadAnchor, OwnSaveReadResult } from "./lib/own-save-read"; const loadOwnSaveRead = () => import("./lib/own-save-read");
import { playerRankedAuthorityFromChallenge } from "./lib/player-ranked-authority";
const CentralHub = lazyWithRetry(() => import("./screens/CentralHub").then(m => ({ default: m.CentralHub })));
const BattleTowers = lazyWithRetry(() => import("./screens/BattleTowers").then(m => ({ default: m.BattleTowers })));
const SunscarFestival = lazyWithRetry(() => import("./screens/SunscarFestival").then(m => ({ default: m.SunscarFestival })));
const PetArena = lazyWithRetry(() => import("./screens/PetArena").then(m => ({ default: m.PetArena })));
const PetShowdown = lazyWithRetry(() => import("./screens/PetShowdown").then(m => ({ default: m.PetShowdown })));
const PetLadder = lazyWithRetry(() => import("./screens/PetLadder").then(m => ({ default: m.PetLadder })));
import { type PetArenaOpponent } from "./data/pet-arena-opponents";
const PetYard = lazyWithRetry(() => import("./screens/PetYard").then(m => ({ default: m.PetYard })));
const Home = lazyWithRetry(() => import("./screens/Home").then(m => ({ default: m.Home })));
const ClanWarTileCardDuel = lazyWithRetry(() => import("./screens/ClanWarTileCardDuel").then(m => ({ default: m.ClanWarTileCardDuel })));
const ShinobiCouncilHall = lazyWithRetry(() => import("./screens/ShinobiCouncilHall").then(m => ({ default: m.ShinobiCouncilHall })));
const CardClashDuel = lazyWithRetry(() => import("./screens/CardClashDuel").then(m => ({ default: m.CardClashDuel })));
const CardHall = lazyWithRetry(() => import("./screens/CardHall").then(m => ({ default: m.CardHall })));
const GuidesLibrary = lazyWithRetry(() => import("./components/GuidesLibrary").then(m => ({ default: m.GuidesLibrary })));
const DungeonEncounter = lazyWithRetry(() => import("./screens/Dungeon").then(m => ({ default: m.DungeonEncounter })));
const DungeonPetBattle = lazyWithRetry(() => import("./screens/Dungeon").then(m => ({ default: m.DungeonPetBattle })));
import { sharedClanWarCache, cwListWars, type CwChallenge, type CwChallengeResult } from "./lib/clan-war-api";
const loadPvpBattleScreen = () => import("./screens/PvpBattleScreen").then(m => ({ default: m.PvpBattleScreen }));
const PvpBattleScreen = lazyWithRetry(loadPvpBattleScreen);
const Arena = lazyWithRetry(() => import("./screens/Arena").then(m => ({ default: m.Arena })));
import type { HollowGatePetFightRef } from "./components/HollowGatePetFight";
import { BattleLockKeeper } from "./components/BattleLockKeeper";
import { DEEP_LINKABLE_SCREENS, BATTLE_SCREENS, isHospitalNavigationBlocked, isUnresolvedBattle, hasActiveTowerFight, restoreScreenForSave, safeFallbackScreen, screenResetsSector, isWildSector, setTowerFightRunId, setTowerPvpMatchId } from "./lib/screen-guards";
import { clearImgCache, imgCacheKey, IMG_CACHE_TTL, scheduleImageCategoryRetry, URL_MODE_CATEGORIES } from "./lib/shared-image-cache";
import { useBattleNavigationGuard } from "./lib/use-battle-navigation-guard";
import { isBattleViewScreen, shouldHideBattleChrome } from "./lib/notifications-core";
import { isPetHomeScreen, petHomeReturnLabel } from "./lib/pet-home-navigation";
import { mergePlayerRoster } from "./lib/roster-merge";
import { setOwnAvatarFallback } from "./lib/own-avatar";
import { activeCarriedPets, isPresetAvatar } from "./lib/entitlements";
const AdminPanel = lazyWithRetry(() => import("./screens/AdminPanel").then(m => ({ default: m.AdminPanel })));
import { builtinAis, balanceExistingAiProfiles } from "./lib/combat-ai";
import { extendHollowGateUnlock, hydrateSharedGameState, hydrateSharedWorldState, isHollowGateUnlocked, loadVillageState, normalizeVillageState, saveVillageState, setSharedGameStateOwnerName, subscribeSharedWorldStateLateChanges, unlockVillageKageSystem } from "./lib/world-state";
import { useWarRewardClaims } from "./lib/use-war-reward-claims";
import { useVillageTax } from "./lib/use-village-tax";
import { requireServerSettlement } from "./lib/server-settlement-gate";
import { masteryBonus } from "./lib/profession-mastery";
const StartScreen = lazyWithRetry(() => import("./screens/StartScreen").then(m => ({ default: m.StartScreen })));
const OnboardingCoach = lazyWithRetry(() => import("./components/OnboardingCoach").then(m => ({ default: m.OnboardingCoach })));
const ScreenHint = lazyWithRetry(() => import("./components/ScreenHint").then(m => ({ default: m.ScreenHint })));
const LiveServiceNotice = lazyWithRetry(() => import("./components/LiveServiceNotice").then(m => ({ default: m.LiveServiceNotice })));
const NextGoalPin = lazyWithRetry(() => import("./components/NextGoalPin").then(m => ({ default: m.NextGoalPin })));
const Village = lazyWithRetry(() => import("./screens/Village").then(m => ({ default: m.Village })));
import {
    type Profession,
    type Screen,
    type Rank,
    type Biome,
    type JutsuType,
    type JutsuTarget,
    type WeatherType,
    type AdminAccount,
    type AdminRole,
} from "./types/core";
import { type Pet } from "./types/pet";
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
    type HollowGateTile,
    type HollowGateShrineRun,
    type HollowGateEventConfig,
    type EndlessTowerRun,
    type Character,
    type PlayerRecord,
    type ServerPlayerSummary,
    type BattleHistoryEntry,
} from "./types/character";
import { appendBattleHistory } from "./lib/battle-log-history";
import { type CreatorAi } from "./types/creator-ai";
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

import {
    WORLD_STATE_API,
    GAME_STATE_API,
    MAX_LEVEL,
    STARTING_STAT_POINTS,
    JUTSU_MAX_LEVEL,
    STORAGE,
    AWAKENING_VN_ID,
    AURA_SPHERE_VN_ID,
    AURA_SPHERE_ITEM_ID,
    DUNGEON_VN_ID,
    DUNGEON_KEY_ID,
    HOLLOW_GATE_KEY_ID,
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

import {
} from "./constants/hunter";

import { type Achievement, ACHIEVEMENTS, titlesForAchievementIds } from "./constants/achievements";
import { claimAchievementSync, createAchievementSyncGate, planAchievementSync, releaseAchievementSync, syncedToastIds, versionedAchievementMutationFromSync, type AchievementSyncResponse } from "./lib/achievement-sync";
import { markAchievementsToasted, unseenAchievements } from "./lib/achievement-toast-ledger";

export type { PetArenaFrame, PetBattleFighter, PetBattleRecord } from "./types/pet-arena";

import {
    getCharacterElements,
} from "./lib/elements";

import { isPetOnExpedition, resolveAvailablePetBattlePair } from "./lib/pet";
import { buildAcceptedArenaMatch } from "./lib/arena-challenge";
import { stopBattleMusic } from "./lib/pet-music";

export type { PetPartyBattleMatch, PetPartyBattleResult } from "./lib/pet-battle-sim";

import {
    armorReductionForQuality,
    consolidateItemBonuses,
} from "./lib/equipment";
export { armorReductionForQuality, consolidateItemBonuses };

import {
    currentMonthKey,
    currentDateKey,
    makeId,
    playerSlug,
} from "./lib/utils";

import type { PvpWinBaseSummary } from "./lib/progression";
import {
    readPvpOwnerSaveForContinuation,
    type PvpRewardClaimConfirmed,
    type PvpRewardContinuationContext,
} from "./lib/pvp-reward-claim";

const UserHub = lazyWithRetry(() => import("./screens/UserHub").then(m => ({ default: m.UserHub })));
const Messages = lazyWithRetry(() => import("./screens/Messages").then(m => ({ default: m.Messages })));
const UserView = lazyWithRetry(() => import("./screens/UserView").then(m => ({ default: m.UserView })));
const ScreenTopChrome = lazyWithRetry(() => import("./components/ScreenTopChrome").then(m => ({ default: m.ScreenTopChrome })));
const HollowGateShrineView = lazyWithRetry(() => import("./features/hollowGate/HollowGateShrineView").then(m => ({ default: m.HollowGateShrineView })));
const LeftProfileCard = lazyWithRetry(() => import("./components/LeftProfileCard").then(m => ({ default: m.LeftProfileCard })));
const SectorBanner = lazyWithRetry(() => import("./components/SectorBanner").then(m => ({ default: m.SectorBanner })));
const TriggeredVisualNovel = lazyWithRetry(() => import("./components/TriggeredVisualNovel").then(m => ({ default: m.TriggeredVisualNovel })));
const Training = lazyWithRetry(() => import("./screens/Training").then(m => ({ default: m.Training })));
const JutsuTrainingHall = lazyWithRetry(() => import("./screens/Training").then(m => ({ default: m.JutsuTrainingHall })));
const Shop = lazyWithRetry(() => import("./components/Shop").then(m => ({ default: m.Shop })));
const GrandMarketplace = lazyWithRetry(() => import("./components/Shop").then(m => ({ default: m.GrandMarketplace })));
const RightMenu = lazyWithRetry(() => import("./components/RightMenu").then(m => ({ default: m.RightMenu })));
const MobileNav = lazyWithRetry(() => import("./components/MobileNav").then(m => ({ default: m.MobileNav })));

import { starterItems } from "./data/starter-items";
import { rawPetPool } from "./data/pet-pool";
import { STARTER_PETS } from "./data/starter-pets";
import { STARTER_EVOLUTIONS } from "./data/pet-evolutions";
import { loadStoryTrigger } from "./lib/story-trigger-loader";
import { resolveStoryContinuation } from "./lib/story-load-authority";
import {
    awakeningLv2VnEvent,
    auraSphereLv9VnEvent,
    hiddenDungeonVnEvent,
} from "./data/vn-events";
import {
    weatherEffects,
} from "./data/world";
import {
    petTrainingOptions,
    petFeedXpForItem,
} from "./data/pet-config";
export { petTrainingOptions, petFeedXpForItem };

import {
    villages,
    weatherForBiome,
} from "./data/sectors";

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
    // Exact player-ranked queue capability. All three fields are server-minted,
    // preserved through the challenge inbox, and required by session creation.
    rankedMatchId?: string;
    rankedSeasonId?: number;
    rankedSeasonEpoch?: number;
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

export type SharedPvpBattleContext = PvpRecoveryContext;

// Creator AI definition types (AiCondition, AiAction, AiLoadoutId, AiRule,
// CreatorAi) moved to ./types/creator-ai and imported back near the top of
// this file.

// JutsuTag / Jutsu / EquipmentSlot moved to ./types/combat.
// itemSectionOptions / normalizeEquipmentSlot / equipmentSlotLabel /
// armorQualityTiers / armorReductionForQuality moved to ./lib/equipment.

// Equipment/armor-derived combat stats (armor factor, raw DR, item-bonus sum,
// PvP loadout) + the active-pet trait helper extracted to ./lib/equipment-stats.
import {
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

// normalizePendingTravel moved to ./lib/player-accounts, next to the
// PendingTravelSave type it returns — imported back at the top of this file.

// StoryStep moved to ./types/vn (re-exported with CreatorEvent above).

// (The old "storyBoss" member is gone — story bosses are sealed server sessions
// hosted inside StoryHall, not Arena battles. See api/story/boss-start.)
export type PendingArenaStoryBattle =
    | {
        kind: "triggeredEvent";
        event: CreatorEvent;
        battle?: NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>[number]["battle"];
        returnScreen: Screen;
    }
    | {
        kind: "dungeonAi";
        returnScreen: Screen;
        eventId: string;
    }
    | {
        // Academy Sparring Match — the onboarding "guaranteed first win".
        // A deliberately weak Lv-1 training dummy (low HP, Lv-1 offense) so a
        // combat-ready new player wins in a few hits. Its sealed story
        // settlement advances onboardingStep -> "cafeteria".
        kind: "academySparring";
        returnScreen: Screen;
    };

// ── Hollow Gate Shrine — crawler dungeon ──────────────────────────────────────
// A tile-based exploration screen revealed by the Kage's one-time Hollow Gate
// unlock. The grid is procedurally generated each entry/floor. Each tile fires
// its event exactly once on reveal; movement bumps a threat meter that can
// trigger an ambush battle at 100. Boss tile fires the Hollow Hound Alpha.

// HollowGateTileKind / HollowGateTerrain / HollowGateTile / HollowGateShrineRun
// moved to ./types/character (co-located with Character.hollowGateRun) and
// imported at the top of this file.

// HOLLOW_GATE_SHRINE_W / H moved to ./constants/game.
// HOLLOW_GATE_MAX_FLOOR moved to ./constants/game so ./lib/hollow-gate-dungeon
// can read it without importing App (keeps the generator unit-testable).

// Hollow Gate intro pages + flavor + tile-icon helpers from
// ./data/hollow-gate-flavor (imported for internal use). External callers
// (KenneyAtlasPicker) import hollowGateTileIconForKind directly from the
// data module.
import {
    hollowGateFlavorFor,
} from "./data/hollow-gate-flavor";

// Shrine floor generation (ASCII layouts + BSP + maze, ./lib/hollow-gate-dungeon)
// is loaded ON DEMAND — see ./lib/hollow-gate-generator-loader for why that is free.
import { loadHollowGateTileRuntime, warmHollowGateGenerator } from "./lib/hollow-gate-generator-loader";
import { buildHollowGateRunFromStart, HOLLOW_GATE_FLOOR_LOAD_FAILED } from "./lib/hollow-gate-run-build";
import { hollowGateEncounterPresentation } from "./lib/hollow-gate-presentation";
import { resumeHollowGateServerRun, settleHollowGateRunOnly, startHollowGateServerRun, attachStartedRun, clearHollowGateRunLocal, reportHollowGateRunError } from "./lib/hollow-gate-server";
import { startHollowGateCombat, settleHollowGateCombat, type HollowGateCombatKind, type HollowGateCombatSettleResult, type HollowGateServerFight } from "./lib/hollow-gate-combat-api";
import { hollowGateRewardLines, resolveHollowGateServerEvent, sealHollowGateFloor } from "./lib/hollow-gate-event-api";
import { sealHollowGateStep } from "./lib/hollow-gate-step-api";
import {
    formatHollowGateCombatReward,
    type HollowGatePveFightRef,
} from "./lib/hollow-gate-pve";
import { useHollowGateAppFlow } from "./lib/hollow-gate-app-flow";
import type { StoryBossSettleResult } from "./lib/story-combat-api";
import { extractMentorLines, extractStoryFightScript, requestStoryBossFight } from "./lib/story-fight-theme";
import { StoryBossFightHost } from "./components/StoryBossFightHost";
import { AiFightHost } from "./components/AiFightHost";
import { wingEntryEffect } from "./lib/hollow-gate-wings";
import { markHollowGateSeen } from "./lib/hollow-gate-path";
import { useHollowGateWalk } from "./features/hollowGate/use-hollow-gate-walk";
import { hollowGateRunMaxFloor, hollowGateBossDisplayName, variantFromEventConfig, normalizeHollowGateEventConfig } from "./lib/hollow-gate-variant";
import { riftEventConfig, completeRiftRun } from "./lib/rift-run";
import type { HollowRift } from "./data/hollow-rifts";
import { attunementDailyBonus } from "./lib/hollow-gate-attunement";
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
// to ./data/sectors. villagePageImage lives in ./lib/village-page-image so the
// panorama assets sit behind lazy village/world-map screens.

const ARENA_ART_BY_BIOME: Record<Biome, readonly [string, string]> = {
    forest: ["/arena-forest.webp", "/arena-forest-floor.webp"],
    snow: ["/arena-snow.webp", "/arena-snow-floor.webp"],
    volcano: ["/arena-volcano.webp", "/arena-volcano-floor.webp"],
    shadow: ["/arena-shadow.webp", "/arena-shadow-floor.webp"],
    central: ["/arena-central.webp", "/arena-central-floor.webp"],
};
const DEATHSGATE_ARENA_ART = ["/deathsgate-arena.webp", "/deathsgate-arena-floor.webp"] as const;
const preloadedBattleArt = new Set<string>();

function preloadBattleArtUrl(url: string) {
    if (preloadedBattleArt.has(url)) return;
    preloadedBattleArt.add(url);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
}

function preloadBattleEntryAssets(biome: Biome, sector: number) {
    const urls = sector === 99 ? DEATHSGATE_ARENA_ART : ARENA_ART_BY_BIOME[biome];
    urls.forEach(preloadBattleArtUrl);
}
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
    applyPetTraitBonuses,
    collectPetTraining,
    gainPetXp,
} from "./lib/pet-balance";
import { chooseStarterPetServer, reconcileOwnedStarter } from "./lib/pet-acquisition-api";
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
// eventPetDifficultyMultiplier + scaleEventPetOpponent moved to ./lib/pet-balance,
// and no longer have a caller: an authored VN pet battle is scaled by the SERVER
// (api/pet/_authored-encounter.ts), which is a port of those two functions.
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

import { defaultAncientChestVn, defaultPetEncounterVn } from "./data/default-vn-events";
export { defaultAncientChestVn, defaultPetEncounterVn };
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

/**
 * Check both clan war history and the village war cache for unclaimed war crates.
 * Returns an updated character with any newly-found crates added, plus a count.
 * Safe to call repeatedly — already-claimed IDs are tracked in claimedWarCrateIds.
 */

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
        // Admins are name-gated out of every tutorial surface — never a live step.
        onboardingStep: "done",
    };
}

function examLevelCap(character: Character): number {
    const passed = character.examsPassed ?? [];
    for (const gate of EXAM_LEVEL_GATES) {
        if (!passed.includes(gate.exam)) return gate.level;
    }
    return MAX_LEVEL;
}

// gainXp — RETIRED XP driver, kept as a derived-level compatibility shim.
// Character XP is removed (docs/leveling-without-xp-map.md): level derives from
// the earned-points ledger (lib/stats levelForEarned/earnedStatPoints), so the
// amount is ignored and this collapses to the RISE-ONLY recompute the server
// runs (api/_xp-engine.ts applyDerivedLevel). Rise-only matters here too: a
// pre-migration save (old XP-era level above its earned-derived level) must
// never de-level locally — the server's one-time migration tops the pool up on
// its next save write. The frozen `xp` field is never touched.
export function gainXp(character: Character, _amount: number): Character {
    const updated: Character = reconcileCharacterStatBudget(character);
    const target = Math.max(1, Math.min(examLevelCap(updated), levelForEarned(earnedStatPoints(updated))));
    if (target <= updated.level) return updated;
    const nextMaxHp = maxHpForLevel(target);
    const nextMaxChakra = maxChakraForLevel(target);
    const nextMaxStamina = maxStaminaForLevel(target);
    return {
        ...updated,
        level: target,
        rankTitle: rankTitleForLevel(updated, target),
        maxHp: nextMaxHp,
        maxChakra: nextMaxChakra,
        maxStamina: nextMaxStamina,
        hp: nextMaxHp,
        chakra: nextMaxChakra,
        stamina: nextMaxStamina,
    };
}

// The Honor Seal grant helpers (vanguardOnlyHonorSeals, bonusBoneCharmsForHonor,
// bonusFateShardsForHonor and their nonVanguard* aliases) were REMOVED here on
// 2026-08-18 along with claimPendingWarCrates, their last consumer. Every site
// that pays seals now settles server-side and recomputes the payout there:
// api/war/_reward.ts applyCurrency (war MVP / consolation) and
// api/_map-control-reward.ts (the daily map-control grant) each carry the same
// arithmetic — seals to Vanguards only, charms at 8:1 with a floor of one, shards
// at 25:1 with no floor. Do not reintroduce a client-side copy; a second
// implementation of a payout is how these drift.

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

// Village-leadership portrait cache + load/save drained to
// ./lib/village-leadership-images; villageLeadership data stays in
// ./data/village-leadership (import from those modules, not from App).
import { normalizeVillageLeadershipImages, type VillageLeadershipImages } from "./data/village-leadership";
import { setVillageLeadershipImagesCache } from "./lib/village-leadership-images";
import { isDeletedJutsuEntry } from "../../shared/admin-content-tombstone";
import { isMpvpLeaseMode } from "../../shared/tower-pvp";

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
    // Character XP is retired: the field is frozen ballast (pre-wipe rollback
    // insurance) — carry it through untouched instead of curve-clamping it.
    const xp = Math.max(0, Math.floor(parsed.xp ?? 0));
    const currentMonth = currentMonthKey();
    const expectedMaxHp = maxHpForLevel(level);
    const expectedMaxChakra = maxChakraForLevel(level);
    const expectedMaxStamina = maxStaminaForLevel(level);
    const hp = normalizeLoadedVital(parsed.hp, parsed.maxHp, expectedMaxHp);
    const chakra = normalizeLoadedVital(parsed.chakra, parsed.maxChakra, expectedMaxChakra);
    const stamina = normalizeLoadedVital(parsed.stamina, parsed.maxStamina, expectedMaxStamina);
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
        hp: hp.current,
        maxHp: hp.maximum,
        chakra: chakra.current,
        maxChakra: chakra.maximum,
        stamina: stamina.current,
        maxStamina: stamina.maximum,
        rankTitle: parsed.rankTitle ?? rankFromLevel(level),
        storyTitle: parsed.storyTitle ?? "",
        storyTraits: deriveStoryTraits(Array.isArray(parsed.storyTraits) ? parsed.storyTraits.filter(Boolean) : []),
        inventory: parsed.inventory ?? [],
        equipment: parsed.equipment ?? {},
        stats,
        unspentStats: Math.max(0, Math.floor(parsed.unspentStats ?? STARTING_STAT_POINTS)), // two-axis: stored pool, not budget-derived
        equippedJutsuIds: (parsed.equippedJutsuIds ?? []).slice(0, 15),
        jutsuMastery: parsed.jutsuMastery ?? [],
        // The server is authoritative for roster entitlement and grandfathers
        // legitimate larger rosters. Hydration must not silently discard a
        // Supporter's sixth pet or any preserved overflow.
        pets: (parsed.pets ?? []).map(normalizePet),
        activePetId: parsed.activePetId,
        activePetId2v2: parsed.activePetId2v2,
        boneCharms: parsed.boneCharms ?? 0,
        auraStones: parsed.auraStones ?? 0,
        mythicSeals: parsed.mythicSeals ?? 0,
        clan: parsed.clan,
        clanFounder: parsed.clanFounder ?? false,
        clanPoints: Math.max(0, Math.floor(Number(parsed.clanPoints ?? 0) || 0)),
        weeklyClanPoints: Math.max(0, Math.floor(Number(parsed.weeklyClanPoints ?? 0) || 0)),
        weeklyClanPointsWeek: typeof parsed.weeklyClanPointsWeek === "string" ? parsed.weeklyClanPointsWeek : undefined,
        lifetimeClanPoints: Math.max(0, Math.floor(Number(parsed.lifetimeClanPoints ?? 0) || 0)),
        clanPointHistory: Array.isArray(parsed.clanPointHistory) ? parsed.clanPointHistory : [],
        clanExchangePurchases: (parsed.clanExchangePurchases && typeof parsed.clanExchangePurchases === "object" && !Array.isArray(parsed.clanExchangePurchases)) ? parsed.clanExchangePurchases : { weekly: {}, monthly: {}, oneTime: {} },
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
        // A server start persists a minimal private projection before the
        // browser generates floor 1. Never render that incomplete projection;
        // entry recovery rebuilds it from lastHollowGateStart instead.
        hollowGateRun: parsed.hollowGateRun && Array.isArray(parsed.hollowGateRun.tiles)
            ? parsed.hollowGateRun
            : null,
        hollowGateWardenKills: parsed.hollowGateWardenKills ?? 0,
        hollowGateIntroSeen: parsed.hollowGateIntroSeen ?? false,
        claimedVillageAgendaDate: parsed.claimedVillageAgendaDate,
        claimedMapControlDate: parsed.claimedMapControlDate,
        examsPassed: Array.isArray(parsed.examsPassed) ? parsed.examsPassed.filter(Boolean) : [],
    };
    return normalizeInventory(normalized); // migrate inline stackables → itemStacks (idempotent)
}




// Save-preview cache (instant login paint) lives in lib/save-preview.ts.

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
        // Begin onboarding inside the intro cinematic (the spirit-fox summons +
        // companion gift); completing it advances straight to "training".
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
        clanPoints: 0,
        weeklyClanPoints: 0,
        lifetimeClanPoints: 0,
        clanPointHistory: [],
        clanExchangePurchases: { weekly: {}, monthly: {}, oneTime: {} },
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
        onboardingStep: "done", // admins skip the cinematic + Academy Path
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
    // Tombstones ride in creatorJutsus so a delete survives publish; not jutsu.
    creatorJutsus = creatorJutsus.filter((j) => !isDeletedJutsuEntry(j));
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
    return orderEquippedJutsus(getAllJutsus(savedBloodlines, creatorJutsus, character), character.equippedJutsuIds);
}

export function stringifyServerSavePayload(payload: unknown) {
    return JSON.stringify(payload, (_key, value) => typeof value === "string" && value.startsWith("data:image") ? "" : value);
}


export default function App() {
    const [screen, setScreen] = useState<Screen>("start");
    const { mutationAvailability, refresh: refreshCapabilities, viewAvailability } = useLiveCapabilities();
    const gameplayViewAvailability = useCapabilityViewAvailability();
    const gameplayMutationAvailability = useCapabilityMutationAvailability();
    const villageWarAvailability = useCapabilityViewAvailability("villageWar");
    const gameplayViewOpen = capabilityAdmissionAllowed(gameplayViewAvailability);
    const gameplayMutationsOpen = capabilityAdmissionAllowed(gameplayMutationAvailability);
    const [petHomeReturnScreen, setPetHomeReturnScreen] = useState<Screen>("village");
    const previousPetHomeScreenRef = useRef<Screen>("start");
    useLayoutEffect(() => {
        const previousScreen = previousPetHomeScreenRef.current;
        if (isPetHomeScreen(screen) && !isPetHomeScreen(previousScreen) && previousScreen !== "start") {
            setPetHomeReturnScreen(previousScreen);
        }
        previousPetHomeScreenRef.current = screen;
    }, [screen]);
    const leavePetHome = useCallback(() => setScreen(petHomeReturnScreen), [petHomeReturnScreen]);
    // Which durable battle record the "battleLog" screen is showing. Set by the
    // Profile battle list; the screen itself fetches from the server by id.
    const [viewedBattleId, setViewedBattleId] = useState<string | null>(null);
    // Battle music is only ever STARTED from startBattle() (pet arena + dungeon
    // beast duel). Catch the exit here: leaving the Pet Arena fades the loop
    // out. Screen doesn't change mid-battle, so this never cuts music during a
    // fight; "Fight Again" restarts it with a fresh track.
    useEffect(() => {
        if (screen !== "petArena" && screen !== "petShowdown" && screen !== "petColiseum") stopBattleMusic();
    }, [screen]);
    const [worldMapKey, setWorldMapKey] = useState(0);
    const [character, setCharacter] = useState<Character | null>(null);
    const [currentAccountName, setCurrentAccountName] = useState("");
    const [viewingUserName, setViewingUserName] = useState<string | null>(null);

    // State restoration, hashes, and leaf components can all write `screen`
    // directly. Keep the render boundary fail-closed as well as the normal
    // navigate() path so a paused Sector campaign never mounts its polling
    // screen for even one render.
    useEffect(() => {
        if (villageWarAvailability !== "unavailable" || villageWarScreenMountAllowed(screen, villageWarAvailability)) return;
        const fallback: Screen = character ? "worldMap" : "start";
        perfNotifyScreen(fallback);
        setScreen(fallback);
    }, [screen, villageWarAvailability, character]);

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
    // Returning from Google. Read (and strip) the redirect once, before anything
    // renders, so the ticket never lingers in the address bar. A pending sign-in
    // holds the restore gate up too — otherwise the login form flashes underneath
    // while the claim is still in flight.
    const [googleRedirect] = useState(() => readGoogleRedirect());
    const [googleNotice, setGoogleNotice] = useState("");
    type GoogleSignupHandoff = { suggestedName: string; signupTicket: string; nonce: string };
    const [googleSignup, setGoogleSignup] = useState<GoogleSignupHandoff | null>(null);
    const [restoringSession, setRestoringSession] = useState<boolean>(() => Boolean(bootAccountName) || Boolean(googleRedirect));
    const [restoreFailed, setRestoreFailed] = useState(false);
    const sessionLoadGenerationRef = useRef(0);
    const bootRestoreStartedRef = useRef(false);
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
    useLayoutEffect(() => { perfSetBootKind(bootAccountName ? "refresh" : "cold-start"); }, []);
    useLayoutEffect(() => { perfNotifyScreen(screen); }, [screen]);
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
    // interceptor (installed at module load) can pick up the correct x-player-name
    // header. Identity only — the omitted password argument must NOT clear one.
    useEffect(() => {
        setActivePlayer(character?.name ?? currentAccountName ?? null);
    }, [character?.name, currentAccountName]);

    // Drain the durable combat-claim outbox on login/reconnect (lib/claim-outbox).
    useClaimOutboxDrain(gameplayMutationsOpen ? character?.name : undefined, (snapshot) => {
        const activeName = characterRef.current?.name.toLowerCase();
        if (!activeName || activeName !== snapshot.playerName.toLowerCase()
            || activeName !== snapshot.character.name.toLowerCase()) return;
        if (snapshot.saveVersion < latestSaveVersionRef.current) return;
        latestSaveVersionRef.current = adoptSaveVersion(latestSaveVersionRef.current, snapshot.saveVersion);
        setCharacter((current) => current?.name.toLowerCase() === activeName
            ? snapshot.character
            : current);
    });

    // ── Achievement unlock detection ───────────────────────────────────────
    // Achievement state is SERVER-OWNED: every generic /api/save overwrites
    // unlockedAchievements / achievementUnlockedAt / earnedTitles with the stored
    // copy, so POST /api/achievements/sync is the only writer that can persist an
    // unlock — and the only one that pays its reward, exactly once, from a server
    // claim ledger. This effect therefore NEVER writes those fields optimistically
    // and never computes a reward: it asks the server to reconcile, then applies
    // the authoritative reply. Writing them locally is what caused a save-churn
    // loop (dirty save → server discards → re-hydrate reverts → effect re-fires),
    // which drove /api/save into 409s then 429s and re-rendered mid-combat. The
    // gate guarantees one request per distinct divergence — see lib/achievement-sync.ts.
    const [achievementToasts, setAchievementToasts] = useState<Achievement[]>([]);
    const achievementGateRef = useRef(createAchievementSyncGate());
    useEffect(() => {
        const playerName = character?.name;
        if (!gameplayMutationsOpen || !character || !playerName) return;
        const eligibleIds = ACHIEVEMENTS.filter(a => a.check(character)).map(a => a.id);
        const plan = planAchievementSync({
            eligibleIds,
            unlocked: character.unlockedAchievements,
            earnedTitles: character.earnedTitles,
            titlesForUnlocked: titlesForAchievementIds(eligibleIds),
        });
        // First-ever sync for this save: the server seeds its claim ledger (so
        // existing progress pays no retroactive windfall), which also means it
        // rewards and toasts nothing — so suppress the popups for that pass. It
        // runs as soon as the character loads, which keeps the player's first
        // real unlock a genuine, celebrated, paid one.
        const silent = plan.uninitialized;
        if (!claimAchievementSync(achievementGateRef.current, playerName, plan)) return;
        void (async () => {
            try {
                const res = await fetch('/api/achievements/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerName }),
                });
                if (!res.ok) return;
                const data = await res.json() as AchievementSyncResponse;
                const mutation = versionedAchievementMutationFromSync(characterRef.current, data);
                if (!mutation || mutation.character.name.toLowerCase() !== playerName.toLowerCase()) return;
                if (!commitVersionedCharacter(mutation.character, mutation._saveVersion)) return;
                if (silent) { markAchievementsToasted(playerName, mutation.character.unlockedAchievements); return; }
                const toastIds = unseenAchievements(playerName, syncedToastIds(data));
                if (toastIds.length === 0) return;
                markAchievementsToasted(playerName, toastIds);
                setAchievementToasts(prev => [...prev, ...toastIds
                    .map(id => ACHIEVEMENTS.find(a => a.id === id))
                    .filter((a): a is Achievement => !!a)]);
            } catch {
                // Offline / auth blip: retries on the next unlock or page load.
                // Deliberately no immediate retry — that was the loop.
            } finally {
                releaseAchievementSync(achievementGateRef.current);
            }
        })();
    }, [character, gameplayMutationsOpen]);

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
    const [missionToasts, setMissionToasts] = useState<MissionToast[]>([]);
    useEffect(() => {
        function handler(e: Event) {
            const detail = (e as CustomEvent<{ name: string; xp: number; profession?: string; label?: string; summary?: string }>).detail;
            if (!detail?.name) return;
            setMissionToasts(prev => [...prev, {
                id: `${detail.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name: detail.name,
                xp: detail.xp ?? 0,
                profession: detail.profession,
                label: detail.label,
                summary: detail.summary,
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
    useViewportContract();

    // Toggle body class during battle so CSS can hide the left sidebar
    useEffect(() => {
        document.body.classList.toggle("in-battle", isBattleViewScreen(screen));
        return () => { document.body.classList.remove("in-battle"); };
    }, [screen]);

    const [sharedImages, setSharedImages] = useState<Record<string, string>>({});
    const [savedBloodlines, setSavedBloodlines] = useState<SavedBloodline[]>([]);
    const [publicPlayerBloodlines, setPublicPlayerBloodlines] = useState<ReviewBloodline[]>([]);
    const [worldStateVersion, setWorldStateVersion] = useState(0);
    useEffect(() => subscribeSharedWorldStateLateChanges(() => setWorldStateVersion((version) => version + 1)), []); // lazily hydrated Village Intel lands after the poll returned
    const refreshWorldStateSnapshot = useCallback(async (continuation?: PvpRewardContinuationContext) => {
        const requireContinuation = () => {
            if (continuation && (continuation.signal.aborted || !continuation.isCurrentScope())) {
                throw new DOMException("PvP completion scope changed.", "AbortError");
            }
        };
        requireContinuation();
        if (!capabilityAdmissionAllowed(viewAvailability())) return;
        try {
            const response = await fetch(WORLD_STATE_API, {
                cache: "no-cache",
                signal: continuation
                    ? AbortSignal.any([continuation.signal, AbortSignal.timeout(12000)])
                    : AbortSignal.timeout(12000),
            });
            requireContinuation();
            if (!response.ok) return;
            const data = await response.json();
            requireContinuation();
            if (hydrateSharedWorldState(data)) setWorldStateVersion((version) => version + 1);
        } catch (error) {
            if (continuation) {
                requireContinuation();
                if (error instanceof DOMException && error.name === "AbortError") throw error;
            }
            // The normal 15-second poll retries offline/transient failures.
        }
    }, [viewAvailability]);
    // Bumped whenever the clan-war list is refreshed. Drives the
    // reward auto-claim effect below (parallel to worldStateVersion
    // for village wars).
    const [clanWarStateVersion, setClanWarStateVersion] = useState(0);
    // Village war crates — check whenever the shared world state refreshes.
    // Also covers clan war crates now that the reward sweep scans
    // sharedClanWarCache; ClanHall fires its own claim too once clanData
    // is loaded.
    useWarRewardClaims(gameplayMutationsOpen ? character : null, setCharacter, commitVersionedCharacter, worldStateVersion, clanWarStateVersion);
    // Daily village tax — a ryo sink that scales with how much ground your village
    // has LOST. Server-idempotent per UTC day; the debit must be adopted here
    // because ryo is client-owned in the save ledger.
    useVillageTax(gameplayMutationsOpen ? character : null, setCharacter, (version) => { acceptExternalSaveVersion(version, character?.name ?? currentAccountName); }, gameToast);

    // Light-weight clan war polling — keeps sharedClanWarCache fresh so
    // ended-war rewards auto-claim. 30s cadence is enough (7-day claim window).
    // Clan-less players are skipped: the reward sweep short-circuits on an
    // empty `clan`, so polling the uncached endpoint for them is pure waste.
    useEffect(() => {
        if (!gameplayViewOpen || !tabVisible) return;
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
    }, [gameplayViewOpen, tabVisible, character?.name, character?.clan]);

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
        if (!gameplayMutationsOpen) return;
        if (!registerPublishedPetTemplates(editablePets)) return;
        setCharacter((prev) => {
            const pets = prev && renormalizedIfChanged(prev.pets, normalizePet);
            return pets ? { ...prev!, pets } : prev;
        });
    }, [editablePets, gameplayMutationsOpen]);
    useEffect(() => {
        if (!gameplayViewOpen || !tabVisible || !character?.name || restoringSession) return;
        let inFlight = false;
        async function refreshWorldState() {
            if (inFlight) return;
            inFlight = true;
            try {
                await refreshWorldStateSnapshot();
            } finally {
                inFlight = false;
            }
        }
        refreshWorldState(); // fetch fresh data on tab return
        const id = setInterval(refreshWorldState, 15000);
        return () => {
            clearInterval(id);
        };
    }, [character?.name, gameplayViewOpen, refreshWorldStateSnapshot, restoringSession, tabVisible]);
    useEffect(() => {
        if (!gameplayViewOpen || !tabVisible || !character?.name || restoringSession) return;
        let alive = true;
        let inFlight = false;
        async function refreshSharedGameState() {
            if (inFlight) return;
            inFlight = true;
            try {
                const owner = characterRef.current?.name ?? currentAccountName;
                setSharedGameStateOwnerName(owner); // seeds the POST (pendingClanPetBattle) owner; NOT sent as a GET query (would fragment the CDN cache key)
                const response = await fetch(GAME_STATE_API, { cache: "no-cache", signal: AbortSignal.timeout(12000) }); // no-cache (not no-store): browser revalidates via the api/game-state.ts ETag, gets 304 on unchanged frames → no re-download. Freshness identical.
                if (!response.ok) return;
                const data = await response.json();
                if (!alive) return;
                if (hydrateSharedGameState(data)) setSharedGameStateVersion(version => version + 1);
            } catch {
                // Shared game state will refresh again on the next heartbeat-sized poll.
            } finally {
                inFlight = false;
            }
        }
        refreshSharedGameState(); // fetch fresh data on tab return
        const id = setInterval(refreshSharedGameState, 10000); // 10s (was 5s): non-critical shared state, already ETag/304-revalidated
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, [currentAccountName, character?.name, gameplayViewOpen, restoringSession, tabVisible]);
    // Village leadership portraits are large base64 images that change rarely,
    // so they ride a separate slow poll (api/game-state.ts ?images=1) instead of
    // the 5s game-state frame — keeping the hot frame ~355KB lighter per poll.
    // Only logged-in players need them (Town Hall / admin), so this stays idle
    // pre-login. Bumps the shared version itself when the portraits actually change.
    useEffect(() => {
        if (!gameplayViewOpen || !tabVisible || !character?.name || restoringSession || (screen !== "townHall" && screen !== "adminPanel")) return;
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
                setVillageLeadershipImagesCache(normalized);
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
    }, [character?.name, gameplayViewOpen, restoringSession, screen, tabVisible]);
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
    const saveSessionEpochRef = useRef(0);
    const pvpCreateScopeAbortRef = useRef(new AbortController());
    const [activeJutsuTraining, setActiveJutsuTraining] = useState<ActiveJutsuTraining | null>(null);
    const [, setPendingAiProfileId] = useState("");
    const { pvpBattleId, setPvpBattleId, pvpRole, setPvpRole,
        pvpBattleContext, setPvpBattleContext, pvpSeedSession, setPvpSeedSession,
        pvpCompletionConfirmed, setPvpCompletionConfirmed, installPvpRecovery, installPvpBreadcrumb, clearPvpBattleState,
    } = usePvpSessionController({ characterName: character?.name, accountSessionEpoch: saveSessionEpochRef.current, restoringSession, storageKey: PVP_SESSION_KEY });
    const pvpContinuationResultRef = useRef(new Map<string, {
        bounty: Awaited<ReturnType<typeof claimBountyOnWin>> | undefined;
        missionCompletions: Array<{ id: string; name: string; xpReward: number }> | undefined;
    }>());
    const pvpCompletionUiRef = useRef(new Set<string>());
    useEffect(() => {
        if (screen !== "pvpBattle" && pvpCompletionConfirmed && pvpBattleId) clearPvpBattleState();
    }, [screen, pvpCompletionConfirmed, pvpBattleId]);
    const [temporaryStoryAi, setTemporaryStoryAi] = useState<CreatorAi | null>(null);
    const [storyFightOpen, setStoryFightOpen] = useState(false); // sealed story-lane fights are body portals, so `screen` never changes — screen-keyed chrome checks this instead
    // Set when a sector gambler deals the player into Chronicle Showdown.
    const [cardAutoStart, setCardAutoStart] = useState(false);
    const [raidBattleKind, setRaidBattleKind] = useState<"none" | "raidAi" | "raidPlayer" | "defense">("none");
    // Pet fight-in-progress state remains lifted so navigation cannot leave an
    // active pet match. Shinobi Arena combat routes to its authoritative host.
    const [petBattleActive, setPetBattleActive] = useState(false);
    const [petFullscreenActive, setPetFullscreenActive] = useState(false);
    // True while the player is in a mission AI fight launched from the Missions
    // screen. Mission completion (markMissionCompleted) is credited ONLY on a win
    // in winBattle and the flag is cleared on any battle end — so losing/fleeing a
    // mission no longer burns the daily slot or inflates clan contribution.
    const [missionBattleActive, setMissionBattleActive] = useState(false);
    const [endlessBattleActive, setEndlessBattleActive] = useState(false);

    // ── Hollow Gate Shrine crawler state ──────────────────────────────────────
    const [hollowGateRun, setHollowGateRun] = useState<HollowGateShrineRun | null>(null);
    const [hollowGateLog, setHollowGateLog] = useState<string[]>([]);
    const [hollowGatePveFight, setHollowGatePveFight] = useState<HollowGateServerFight | null>(null);
    const [hollowGateEvent, setHollowGateEvent] = useState<HollowGateEventModal>(null);
    const [hollowGateHiddenChamber, setHollowGateHiddenChamber] = useState<HiddenChamberState>(null);
    // Intro VN page index — null = not showing, 0..N = pages of the intro sequence.
    const [hollowGateIntroPage, setHollowGateIntroPage] = useState<number | null>(null);
    // Shared event-gate config (admin-authored, distributed via the admin-save
    // content channel like creator content; lib/hollow-gate-variant normalizes).
    const [hollowGateEventConfig, setHollowGateEventConfig] = useState<HollowGateEventConfig | null>(null);
    // Move side-effect queue. moveHollowGatePlayer's step effects (tile fire /
    // logs / ambush) MUST NOT be read from a local `let` right after
    // setHollowGateRun — React only runs the state updater eagerly when its
    // queue is empty, so during click-to-walk (rapid steps + log churn) the
    // updater runs late and the local reads stale, silently DROPPING the tile
    // fire ("walked over a chest and nothing happened"). Instead each step
    // pushes its effects here from inside the updater, and a macrotask drain
    // (which runs after React has flushed every queued updater) processes them.
    const hollowGateMoveFxRef = useRef<Array<{
        wallBump: boolean;
        blockMessage?: string;
        committedTheme?: string;
        torchSputtered: boolean;
        justResolved: { tile: HollowGateTile; nx: number; ny: number } | null;
        ambushImmediate: boolean;
        step?: { requestId: string; fromX: number; fromY: number; toX: number; toY: number };
    }>>([]);
    const hollowGatePendingAmbushRef = useRef<{ nodeId: string; kind: "ambush" | "boss" } | null>(null);
    const hollowGateStepDrainRef = useRef<Promise<void>>(Promise.resolve());

    // A sealed Hollow Gate pet duel, fought on the Showdown engine on the shrine
    // screen itself. It used to detour through the Pet Arena as a pending
    // opponent; the encounter belongs to the run, so it stays with the run.
    const [hollowGatePetFight, setHollowGatePetFight] = useState<HollowGatePetFightRef | null>(null);

    // Hollow Gate Shrine movement — click-to-walk (sector-style pathing) plus
    // the WASD/arrow key handler, both owned by the walk hook. Every walked
    // step goes through moveHollowGatePlayer, so costs/events are identical
    // to manual movement.
    const { walkTo: hollowGateWalkTo, walkTarget: hollowGateWalkTarget } = useHollowGateWalk({
        active: screen === "hollowGateShrine",
        run: hollowGateRun,
        blocked: !!hollowGateEvent || !!hollowGateHiddenChamber || hollowGateIntroPage !== null || !!hollowGatePveFight || !!hollowGatePetFight,
        moveStep: moveHollowGatePlayer,
    });

    // Warm the two on-demand Hollow Gate chunks (generator + tile resolver) for
    // EVERY way onto the shrine screen — a fresh dive, an admin playtest, and
    // all three boot-restore paths that hydrate a saved run and jump straight
    // here. Scattered call sites at the entry points kept missing the restores,
    // which is exactly the path back into a long run.
    useEffect(() => { if (screen === "hollowGateShrine") warmHollowGateGenerator(); }, [screen]);

    // Persist the in-progress shrine run to the character so it survives refresh:
    // mirror local hollowGateRun into character.hollowGateRun whenever it changes inside the shrine.
    useEffect(() => {
        if (screen !== "hollowGateShrine") return;
        setCharacter((prev) => {
            if (!prev || prev.hollowGateRun === hollowGateRun) return prev;
            return { ...prev, hollowGateRun };
        });
    }, [screen, hollowGateRun]);

    // Refresh/reconnect: the save carries only a pointer to the server board.
    // Re-submit the same sealed binding so the API can validate and return the
    // current session; a forged pointer cannot open or settle another fight.
    useEffect(() => {
        const active = hollowGateRun?.activeCombat;
        const token = hollowGateRun?.runToken;
        if (screen !== "hollowGateShrine" || !character || !active || !token || hollowGatePveFight || hollowGatePetFight) return;
        let cancelled = false;
        void startHollowGateCombat({
            playerName: character.name,
            token,
            floor: active.floor,
            nodeId: active.nodeId,
            kind: active.kind,
            mode: active.mode,
        }).then((started) => {
            if (cancelled) return;
            const fight = { ...active, runId: started.runId };
            if (started.combatMode === "pet" || active.mode === "pet") launchHollowGatePetFight(fight);
            else if (started.session) launchHollowGatePveFight(fight, started.session);
            else throw new Error("The Hollow Gate returned no sealed combat session.");
        }).catch((error) => {
            if (!cancelled) reportHollowGateRunError(error, "The active encounter could not be resumed. Retry from the shrine.", () => clearHollowGateRunState(true)); // self-heal on run-expiry instead of locking the player in the shrine
        });
        return () => { cancelled = true; };
    }, [screen, character?.name, hollowGateRun?.runToken, hollowGateRun?.activeCombat?.runId, hollowGatePveFight, hollowGatePetFight]);

    function savedJutsuPool(source: Partial<ReturnType<typeof buildPlayerSavePayload>>) {
        return [
            ...starterJutsus,
            ...(((source.creatorJutsus ?? []) as Jutsu[]).map(normalizeJutsu).map(rebalanceNonBloodlineJutsu)),
        ];
    }
    const [bloodlineMakerInitialRank, setBloodlineMakerInitialRank] = useState<Rank>("A Rank");
    const [bloodlineMakerInitialElement, setBloodlineMakerInitialElement] = useState("");
    const [bloodlineMakerRankLocked, setBloodlineMakerRankLocked] = useState(false);
    const [bloodlineMakerEditingBloodline, setBloodlineMakerEditingBloodline] = useState<SavedBloodline | null>(null);
    const [currentSector, setCurrentSector] = useState(40);

    useEffect(() => {
        if (!character?.name && !restoringSession) return;
        const biome = pvpSeedSession?.biome ?? currentBiome;
        const delayMs = screen === "pvpBattle" ? 0 : 650;
        const timer = window.setTimeout(() => {
            void loadPvpBattleScreen().catch(() => {});
            preloadBattleEntryAssets(biome, currentSector);
        }, delayMs);
        return () => window.clearTimeout(timer);
    }, [character?.name, restoringSession, currentBiome, currentSector, pvpSeedSession?.biome, screen]);

    const [travelingUntil, setTravelingUntil] = useState(0);
    const [pendingTravel, setPendingTravel] = useState<PendingTravelSave | null>(null);
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

    // Incoming duel challenges arrive over the authenticated heartbeat
    // (`data.pendingChallenges`, merged below), nudged to fire immediately by the
    // Socket.IO "kick" on an incoming challenge. A former anon-Realtime push on
    // `challenges:<slug>` was removed when that key left the kv_store anon SELECT
    // allowlist (2026-07-23 Chronicle-leak migration) — the row is no longer
    // anon-readable, so the subscription could only ever be silent. See lib/realtime.ts.
    const [processingChallengeIds, setProcessingChallengeIds] = useState<string[]>([]);
    const [pendingPetBattleOpponent, setPendingPetBattleOpponent] = useState<PetArenaOpponent | null>(null);
    const {
        exitPending: hollowGateExitPending,
        descending: hollowGateDescending,
        leave: leaveHollowGateShrine,
        abandon: abandonHollowGateShrine,
        launchPetFight: launchHollowGatePetFight,
        onBattleWin: onHollowGateBattleWin,
        onPetBattleEnd: onHollowGatePetBattleEnd,
    } = useHollowGateAppFlow({
        character,
        run: hollowGateRun,
        sharedImages,
        setCharacter,
        setRun: setHollowGateRun,
        setEvent: setHollowGateEvent,
        setHiddenChamber: setHollowGateHiddenChamber,
        setPetFight: setHollowGatePetFight,
        setScreen,
        clearRunState: clearHollowGateRunState,
        clearLog: () => setHollowGateLog([]),
        pushLog: pushHollowGateLog,
        buildRunSummary: buildHollowGateRunSummary,
    });
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
    const autoReportClanWarBattleResult = useCallback(async (
        youWon: boolean | "draw",
        opponentName?: string,
        continuation?: PvpRewardContinuationContext,
    ) => {
        if (continuation && (continuation.signal.aborted || !continuation.isCurrentScope())) {
            throw new DOMException("PvP completion scope changed.", "AbortError");
        }
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
                ...(continuation ? { signal: continuation.signal } : {}),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(String(data?.error ?? `Clan-war report failed (HTTP ${r.status}).`));
            if (continuation && (continuation.signal.aborted || !continuation.isCurrentScope())) {
                throw new DOMException("PvP completion scope changed.", "AbortError");
            }
            // Only clear the stash on a finalized report (both sides
            // matched, or the tentative auto-confirmed). Leave it in
            // place during the tentative phase so the OTHER side's
            // client gets a chance to confirm/dispute without the
            // launching player losing context.
            if (r.ok && data?.tentative === false) {
                try { sessionStorage.removeItem("clanWarChallenge.v1"); } catch { /* ignore */ }
            }
        } catch (error) {
            if (continuation) throw error;
            // Non-PvP callers retain the old best-effort behavior.
        }
    }, [character]);

    // Launch helper for clan-war challenges. ClanBattlesTab calls this
    // when the player clicks "Launch Battle" on an accepted challenge.
    // We thread it through ShinobiCouncilHall → ClanBattlesTab so the
    // battle screen state is set BEFORE navigation (avoids the blank-
    // screen bug from the audit). PvP routing maps fromPlayer→p1,
    // acceptedPlayer→p2. Pet modes stash the shared seed in
    // sessionStorage for the PetArena screen to pick up. Tile cards
    // currently route to the tavern for manual play; cross-confirmation
    // on report still keeps the result honest. onLaunchFailed fires only on retryable failures, never the permanent 2v2 block.
    const launchClanWarBattle = useCallback((ch: CwChallenge, warId?: string, onLaunchFailed?: () => void) => {
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
            case "pvp2v2": {
                // Four-player board; ClanWar2v2Battle resolves the match itself.
                if (inferredWarId) setScreen("clanWar2v2"); else onLaunchFailed?.();
                break;
            }
            case "pvp1v1": {
                const p1Name = ch.fromPlayer ?? "";
                const p2Name = ch.acceptedPlayer ?? "";
                if (!inferredWarId || !p1Name || !p2Name) {
                    alert("This accepted Clan War duel is missing its server match details. Refresh and try again.");
                    onLaunchFailed?.(); return;
                }
                const ownerName = character.name;
                void (async () => {
                    const createScope = capturePvpCreateScope(ownerName);
                    const requestBody = stringifyPvpSessionPayload({
                        clanWarId: inferredWarId,
                        clanWarChallengeId: ch.id,
                        baseRewards: true,
                        ...pvpSessionEnvironment(false, currentBiome, weatherEffects[currentWeather]?.positiveElement, weatherEffects[currentWeather]?.negativeElement),
                        p1Character: { name: p1Name },
                        p2Character: { name: p2Name },
                    });
                    try {
                        const result = await (await loadPvpSessionCreate()).createPvpSessionWithRecovery(fetch, ownerName, requestBody, {
                            signal: createScope.signal, isCurrent: createScope.isCurrent,
                        });
                        if (!createScope.isCurrent()) return;
                        if (result.kind === "recovered") {
                            installPvpRecovery(result.pending);
                            setScreen("pvpBattle");
                            return;
                        }
                        if (result.kind === "rejected") { alert(result.error); onLaunchFailed?.(); return; }
                        const battleId = result.kind === "created" ? result.battleId : result.battleId;
                        try {
                            const raw = sessionStorage.getItem("clanWarChallenge.v1");
                            const stashed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
                            sessionStorage.setItem("clanWarChallenge.v1", JSON.stringify({ ...stashed, battleId }));
                        } catch { /* optional resume breadcrumb */ }
                        if (result.kind === "created") setPvpSeedSession(result.session);
                        setPvpBattleId(battleId);
                        setPvpRole(onFromSide ? "p1" : "p2");
                        setPvpBattleContext({ mode: "clanWar1v1", clanWarChallengeId: ch.id });
                        setScreen("pvpBattle");
                        if (result.kind === "ambiguous") alert("The battle response was interrupted. Reconnecting to the authoritative session…");
                    } catch (error) {
                        if (createScope.isCurrent() && !(error instanceof DOMException && error.name === "AbortError")) {
                            alert("Could not create the authoritative Clan War battle."); onLaunchFailed?.();
                        }
                    }
                })();
                break;
            }
            case "pet1v1":
            case "pet2v2":
                // SERVER-AUTHORITATIVE: both sides field a pet through
                // /api/clan/war/pet, the server runs the deterministic duel and
                // finalizes the challenge, and this screen replays it. Nothing is
                // reported from the client — /api/clan/war/report refuses pet
                // results outright.
                setScreen("clanWarPet");
                break;
            case "tilecards": {
                // Chronicle Showdown joins idempotently from the battle screen. The
                // server owns deck validation, rules, timeouts and finalization.
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
        if (!gameplayMutationsOpen || !character) return;
        // Don't yank players out of an active battle / story / boss screen.
        // Mixed pet/tower screens stay launchable until their active owner says
        // the player is actually committed to another fight.
        const blocksBattleScreen = BATTLE_SCREENS.has(screen)
            && (screen !== "petArena" || petBattleActive)
            && (screen !== "battleTowers" || hasActiveTowerFight());
        if (blocksBattleScreen) return;

        const me = character.name.toLowerCase();
        for (const war of Object.values(sharedClanWarCache)) {
            if (war.endedAt) continue;
            for (const ch of war.pendingChallenges) {
                if (ch.status !== "accepted") continue;
                const launchKey = `${accountKey(character.name)}:${saveSessionEpochRef.current}:${ch.id}`;
                if (autoLaunchedClanWarChallenges.current.has(launchKey)) continue;
                const iAmParticipant = (ch.fromPlayer ?? "").toLowerCase() === me
                    || (ch.fromPlayer2 ?? "").toLowerCase() === me
                    || (ch.acceptedPlayer ?? "").toLowerCase() === me
                    || (ch.acceptedPlayer2 ?? "").toLowerCase() === me;
                if (!iAmParticipant) continue;
                autoLaunchedClanWarChallenges.current.add(launchKey);
                launchClanWarBattle(ch, war.id, () => autoLaunchedClanWarChallenges.current.delete(launchKey));
                return; // launch one at a time
            }
        }
    }, [character, screen, clanWarStateVersion, launchClanWarBattle, petBattleActive, gameplayMutationsOpen]);

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
    // Finale-lane capture + queued ending epilogue (lib/story-epilogue.ts). Lane is set when a kageFinale VN battle choice is picked; the queued VN pops when the player leaves the arena after the win.
    const storyEpilogueRef = useRef<{ lane: string | null; queued: CreatorEvent | null }>({ lane: null, queued: null });
    const [triggerPage, setTriggerPage] = useState(0);
    const [triggerLine, setTriggerLine] = useState(0);
    const [activeDungeonEvent, setActiveDungeonEvent] = useState<CreatorEvent | null>(null);
    const dungeonActionRef = useRef(false);
    const [activeDungeonRunToken, setActiveDungeonRunToken] = useState<string | null>(null);
    const [pendingEventEncounter, setPendingEventEncounter] = useState<PendingEventEncounter | null>(null);
    const [dungeonLine, setDungeonLine] = useState(0);
    const [dungeonReturnScreen, setDungeonReturnScreen] = useState<Screen>("worldMap");
    // Rebuild presentation from the active run after refresh. DungeonEncounter
    // derives the exact Warden/Card/Pet stage from server-owned proofs.
    useEffect(() => {
        const run = character?.activeDungeonRun;
        if (screen !== "dungeon" || !run?.token) return;
        setActiveDungeonRunToken(run.token);
        setActiveDungeonEvent((current) => current ?? creatorEvents.find((event) => event.id === DUNGEON_VN_ID) ?? hiddenDungeonVnEvent);
    }, [screen, character?.activeDungeonRun?.token, creatorEvents]);
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
    useLayoutEffect(() => { characterRef.current = character; }, [character]);
    const currentAccountNameRef = useRef(currentAccountName);
    useLayoutEffect(() => { currentAccountNameRef.current = currentAccountName; }, [currentAccountName]);
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
    const heartbeatInFlightRef = useRef(false);
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
    useEffect(() => { setLiveSectorContext(currentSector); }, [currentSector]);
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

    // Wake ONCE, when travel actually ends — not four times a second.
    //
    // `travelNow` feeds exactly one thing: the `isTraveling` boolean above. It used to
    // be re-stamped on a 250ms interval, so the whole App re-rendered 4x per second for
    // the entire trip just to recompute a flag that flips once. Every child re-rendered
    // with it, and the heaviest screen in the game is the one you are looking at while
    // travelling: WorldMap, with ~50 props, 144 sector buttons, a rAF loop per wanderer
    // and up to two WebGL canvases.
    //
    // A single timeout scheduled for the arrival instant produces the identical
    // `isTraveling` transition with one render instead of hundreds. The +50ms guards
    // against a timer firing a hair early (it would otherwise re-arm in a tight loop),
    // and the clamp keeps a far-future or corrupted `travelingUntil` from overflowing
    // the delay argument.
    useEffect(() => {
        if (!isTraveling) return;
        const delay = Math.min(Math.max(travelingUntil - Date.now() + 50, 50), 2_147_483_000);
        const id = window.setTimeout(() => setTravelNow(Date.now()), delay);
        return () => window.clearTimeout(id);
    }, [isTraveling, travelingUntil]);

    function isPresenceBattleActive(screenSnapshot: Screen = screenRef.current): boolean {
        return isUnresolvedBattle({
            screen: screenSnapshot,
            raidBattleKind,
            pvpBattleId,
            pvpBattleResolved: pvpCompletionConfirmed,
            endlessBattleActive,
            pendingArenaStoryBattle: !!pendingArenaStoryBattle,
            pendingEventEncounter: !!pendingEventEncounter,
            activeDungeonEvent: !!activeDungeonEvent,
            hollowGateTileGameActive,
            pendingPetBattle: !!pendingPetBattleOpponent,
            arenaBattleActive: false, missionBattleActive,
            petBattleActive,
        });
    }

    function isBattleFlowScreen(screenSnapshot: Screen = screenRef.current): boolean {
        return BATTLE_SCREENS.has(screenSnapshot)
            || screenSnapshot === "sectorPet"
            || screenSnapshot === "clanWarPet"
            || isPresenceBattleActive(screenSnapshot);
    }

    useEffect(() => {
        if (!gameplayMutationsOpen || !character) return;
        let heartbeatEffectActive = true;
        async function heartbeat() {
            const char = characterRef.current;
            if (!char) return;
            const heartbeatAccountKey = saveConflictAccountKey(char.name);
            const heartbeatSessionEpoch = saveSessionEpochRef.current;
            const heartbeatIsCurrent = () => heartbeatEffectActive && isCurrentSaveSession(heartbeatAccountKey, heartbeatSessionEpoch);
            if (!heartbeatIsCurrent()) return;
            // inBattle covers only unresolved fights so attack.ts/challenge.ts can
            // reject double-battle requests and healers can't heal active fighters.
            // The shared guard keeps opponent-search hubs free while still lifting
            // active arena/pet flags whose state lives inside those screens.
            const inBattleNow = isPresenceBattleActive();
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
            updateRealtimePresence({
                sector: currentSector,
                character: presenceBody.character,
                travelingUntil: presenceBody.travelingUntil,
                inBattle: inBattleNow,
                displayName: char.name,
                tile: presenceBody.tile,
            });
            if (heartbeatInFlightRef.current) return;
            heartbeatInFlightRef.current = true;
            try {
                const res = await fetch('/api/player/heartbeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(presenceBody),
                    signal: AbortSignal.timeout(12000),
                });
                if (!res.ok) return;
                const data: { sectorMates?: PlayerRecord[]; allPlayers?: PlayerRecord[]; pendingAttacker?: Character | null; pendingChallenges?: DuelChallenge[]; pendingHeal?: { by?: string } | null; pendingNotices?: unknown; forceReload?: boolean; serverNow?: number; sector?: number; traveling?: boolean } = await res.json();
                if (!heartbeatIsCurrent()) return;
                noteServerTime(data.serverNow); // the beat is our reference for the clock that mints every deadline
                // Admin reset this account — wipe local state and reload from server
                if (data.forceReload) {
                    const accountName = heartbeatAccountKey;
                    // Admin accounts never respond to force-reload signals — admin writes
                    // to player keys, not their own, so a signal on "admin1" should not
                    // disrupt the admin session. Just ack and continue.
                    if (adminLoggedIn) {
                        if (!heartbeatIsCurrent()) return;
                        await fetch(`/api/save/${encodeURIComponent(accountName)}?ack=1`, { method: "POST", signal: AbortSignal.timeout(12000) });
                        return;
                    }
                    const saveRes = await fetch(`/api/save/${encodeURIComponent(accountName)}`, { signal: AbortSignal.timeout(12000) });
                    if (!heartbeatIsCurrent()) return;
                    if (saveRes.ok) {
                        const snap = await saveRes.json() as ReturnType<typeof buildPlayerSavePayload>;
                        if (!heartbeatIsCurrent()) return;
                        const unresolved = savePersistenceRef.current?.getUnresolvedPost();
                        if (unresolved?.accountKey === heartbeatAccountKey && unresolved.sessionEpoch === heartbeatSessionEpoch) captureSaveConflictDraft(unresolved.accountName, unresolved.body);
                        else if (charDirtyRef.current && latestSaveRef.current) captureSaveConflictDraft(latestSaveRef.current.name, { ...latestSaveRef.current.payload, _baseSaveVersion: latestSaveVersionRef.current });
                        // Apply full snapshot so all admin-given changes (pets, currencies,
                        // items, etc.) are reflected across the entire player state.
                        applyServerSnapshot(snap);
                        if (!heartbeatIsCurrent()) return;
                        await fetch(`/api/save/${encodeURIComponent(accountName)}?ack=1`, { method: "POST", signal: AbortSignal.timeout(12000) });
                    } else {
                        // Save was deleted (account reset) — also clear localStorage so the
                        // stale level-100 snapshot can't be reloaded on the next login.
                        if (!heartbeatIsCurrent()) return;
                        const ack = fetch(`/api/save/${encodeURIComponent(accountName)}?ack=1`, { method: "POST", signal: AbortSignal.timeout(12000) });
                        const lsKey = accountKey(accountName);
                        if (lsKey) {
                            const accounts = loadPlayerAccounts();
                            delete accounts[lsKey];
                            savePlayerAccounts(accounts);
                        }
                        unwindToLoginForm();
                        await ack;
                    }
                    return;
                }
                // Live sector-mates → the presence store (external store) so the ~1s
                // heartbeat updates only the sector view, not all of App (Phase 1A).
                if (data.sectorMates && currentSectorRef.current === presenceBody.sector) {
                    pushLiveSectorPlayers(data.sectorMates, presenceBody.sector);
                }
                // Self-heal any drift between our currentSector and the server's
                // authoritative (lease-gated, anti-cheat-safe) world position, so
                // presence/visibility always agree and a desync — a remote raid/event
                // backdrop sector, or any future drift — can never strand a player
                // invisible in their sector. Only on the world map: a battle screen
                // keeps its own backdrop sector, and every other screen sits in the
                // safe zone. Heals on RETURN from such a fight. A real trip is never
                // bounced (see lib/sector-reconcile).
                const reconcileSector = screenRef.current === "worldMap"
                    ? worldSectorReconcileTarget({ serverSector: data.sector, serverTraveling: data.traveling, sentSector: presenceBody.sector, currentSector: currentSectorRef.current, clientTraveling: isTraveling || !!pendingTravel })
                    : null;
                if (reconcileSector != null) setCurrentSector(reconcileSector);
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
                    // battleId. Previously we routed through an Arena compatibility sink
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
                if (Array.isArray(data.pendingNotices) && data.pendingNotices.length) {
                    // Lazy import: the notice copy strings stay off the entry graph.
                    const notices = data.pendingNotices;
                    void import("./lib/offline-notices").then((m) => m.applyOfflineNotices(notices));
                }
            } catch {
                // Server unavailable — silently skip
            } finally {
                heartbeatInFlightRef.current = false;
            }
        }

        // Expose the latest heartbeat so the socket "kick" handler can fire an
        // immediate off-cycle poll on an incoming attack/challenge.
        heartbeatRef.current = heartbeat;
        const retireHeartbeat = () => {
            heartbeatEffectActive = false;
            if (heartbeatRef.current === heartbeat) heartbeatRef.current = () => {};
        };

        if (!tabVisible) return retireHeartbeat; // pause heartbeat when tab hidden
        heartbeat();
        // Adaptive heartbeat interval. When the Socket.IO presence channel is
        // CONNECTED it owns liveness: it pushes live sector presence and kicks an
        // immediate poll on incoming attack/challenge, so the HTTP poll only needs
        // to be a slow (~20s) reconcile + forceReload backstop — this is the win
        // that removes the bulk of the request volume. When the socket is DOWN we
        // fall back to a fast adaptive cadence so combat never regresses: 1s in
        // combat/arena, 3s while exploring sectors (a wild ambush is less urgent
        // than an active fight), 15s in the village (sector 0). Village-queued
        // guards stay at 1s so a raider's attack reaches the defender within ~1s.
        const currentScreen = screenRef.current;
        const SOCKET_RECONCILE_MS = 20000;
        const interval = socketConnected
            ? SOCKET_RECONCILE_MS
            : isBattleFlowScreen(currentScreen)
            ? 1000   // in combat — fast challenge/attack delivery
            : character?.guardQueued
            ? 1000   // queued for village defense — must respond to raids fast
            : currentSector === 0
            ? 15000  // village — no urgent combat needs
            : 3000;  // exploring sectors (socket down) — presence + pendingAttacker backstop, ~3x less volume than 1s
        const id = setInterval(heartbeat, interval);
        return () => { retireHeartbeat(); clearInterval(id); };
    }, [
        gameplayMutationsOpen, character?.name, character?.guardQueued, currentSector, isTraveling, travelingUntil, screen, tabVisible, socketConnected,
        raidBattleKind, pvpBattleId, pvpCompletionConfirmed, endlessBattleActive, pendingArenaStoryBattle,
        pendingEventEncounter, activeDungeonEvent, hollowGateTileGameActive, pendingPetBattleOpponent,
        petBattleActive,
    ]);

    usePresenceSocket({
        characterName: gameplayViewOpen ? character?.name : undefined,
        characterRef,
        currentSectorRef,
        heartbeatRef,
        getPresenceBattleActive: isPresenceBattleActive,
        setSocketConnected,
    });

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
        const acceptanceAccountKey = saveConflictAccountKey(character.name);
        const acceptanceSessionEpoch = saveSessionEpochRef.current;
        const acceptanceIsCurrent = () => isCurrentSaveSession(acceptanceAccountKey, acceptanceSessionEpoch);
        if (!acceptanceIsCurrent()) return;
        const acceptingCharacter = character;
        const myEligiblePets = activeCarriedPets<Pet>(acceptingCharacter);
        if (processingChallengeIds.includes(challenge.id)) return;

        // PvP pet duels are live-only (plan §10) — retire a pre-deploy challenge.
        if (retireStalePetDuel(challenge, duelChallenges, setDuelChallenges)) return;
        if (challenge.arenaMatch) { // Tactical Arena PvP — route to PetArena's responder team picker
            const arenaSize = challenge.arenaSize === 2 ? 2 : 4;
            const availablePets = myEligiblePets.filter((pet) => !isPetOnExpedition(pet)).length;
            if (availablePets < arenaSize) {
                if (!acceptanceIsCurrent()) return;
                alert(`This ${arenaSize}v${arenaSize} challenge needs ${arenaSize} available pets. You currently have ${availablePets}; pets on expeditions do not count.`);
                return;
            }
            if (!acceptanceIsCurrent()) return;
            dismissChallengeLocally(challenge.id);
            void clearChallengeOnServer(challenge);
            setPendingArenaResponse(challenge);
            setScreen("petArena");
            return;
        }

        const myPet = myEligiblePets.find(pet => pet.id === acceptingCharacter.activePetId && !isPetOnExpedition(pet)) ?? myEligiblePets.find(pet => !isPetOnExpedition(pet));
        const challengerPet = challenge.challenger.pets.find(pet => pet.id === challenge.challengerPetId && !isPetOnExpedition(pet)) ?? challenge.challenger.pets.find(pet => !isPetOnExpedition(pet));
        if (!myPet || !challengerPet || isPetOnExpedition(challengerPet)) {
            if (!acceptanceIsCurrent()) return;
            alert("Both players need a pet before this pet battle can start.");
            return;
        }

        // Keep 2v2 challenges in their requested mode: unavailable teams are
        // rejected instead of silently falling back to a 1v1 battle.
        const wantsParty = challenge.petParty === true && Array.isArray(challenge.challengerPetIds);
        const myAvailable = myEligiblePets.filter(p => !isPetOnExpedition(p));
        const requestedChallengerParty = wantsParty
            ? resolveAvailablePetBattlePair(challenge.challenger.pets, challenge.challengerPetIds!)
            : null;
        if (wantsParty && (myAvailable.length < 2 || !requestedChallengerParty)) {
            if (!acceptanceIsCurrent()) return;
            alert("A 2v2 pet battle needs two available pets on each team. This challenge cannot start as 1v1 instead.");
            return;
        }
        let myParty: [Pet, Pet] | null = null;
        let challengerParty: [Pet, Pet] | null = null;
        if (wantsParty && requestedChallengerParty) {
            challengerParty = requestedChallengerParty;
            // Smart 2v2 picker: given the challenger's locked-in lead+reserve,
            // pick MY lead+reserve to maximize summed matchup score (stat
            // ratio × element edge × trait counter penalty). Falls back to
            // top-2-by-level if the picker can't decide (shouldn't happen
            // with 2+ available pets).
            const smart = await import("./lib/pet-battle-sim")
                .then(({ pickBestPartyOrder }) => pickBestPartyOrder(myAvailable, requestedChallengerParty))
                .catch((): [Pet, Pet] | null => null);
            if (!acceptanceIsCurrent()) return;
            if (smart) {
                myParty = smart;
            } else {
                const sortedByLvl = [...myAvailable].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
                myParty = [sortedByLvl[0], sortedByLvl[1]] as [Pet, Pet];
            }
        }
        const doParty = !!(wantsParty && myParty && challengerParty);

        if (!acceptanceIsCurrent()) return;
        setProcessingChallengeIds(prev => [...prev, challenge.id]);
        dismissChallengeLocally(challenge.id);
        try {
            await clearChallengeOnServer(challenge);
            if (!acceptanceIsCurrent()) return;
            const isRanked = challenge.mode === "rankedPet";
            const acceptedNotice: DuelChallenge = {
                ...challenge,
                accepted: true,
                fromName: acceptingCharacter.name,
                toName: challenge.fromName,
                responderPetId: myPet.id,
                responderPet: myPet,
                // Stamp my pet-ranked rating so the challenger can compute its
                // symmetric Elo delta when the accepted notice routes it in.
                ...(isRanked ? { responderPetRating: acceptingCharacter.petRankedRating ?? 1000 } : {}),
                ...(doParty && myParty ? {
                    petParty: true,
                    responderPetIds: [myParty[0].id, myParty[1].id] as [string, string],
                    responderParty: myParty,
                } : {}),
            };
            const notified = await postPlayerChallengeNotice(challenge.fromName, acceptedNotice, { shouldContinue: acceptanceIsCurrent });
            if (!acceptanceIsCurrent()) return;
            const opponentForResume: PetArenaOpponent = {
                owner: challenge.fromName,
                pet: challengerPet,
                battleSeed: challenge.petBattleSeed,
                // For ranked, the challenger is my opponent — carry their rating
                // snapshot so my own Elo math has both sides. selfPet locks MY
                // combatant to the exact pet I just sent as responderPet so the
                // canonical sim matches the challenger's view of it.
                ...(isRanked ? { ranked: true, opponentRating: challenge.challengerPetRating ?? 1000, selfPet: myPet, petRankedToken: challenge.petRankedToken } : {}),
                // ONE server-sealed duel, keyed by the id the challenger also holds,
                // so both of us watch the identical fight instead of simulating our own.
                ...(isRanked ? {} : { pvpChallengeId: challenge.id }),
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
            if (!notified) alert(`${challenge.fromName} may not be pulled in automatically. Ask them to open the Pet Colosseum if they do not see the fight.`);
        } finally {
            setProcessingChallengeIds(prev => prev.filter(id => id !== challenge.id));
        }
    }

    // Fetch full server player list (includes offline players from registry)
    useEffect(() => {
        if (!gameplayViewOpen || !character?.name) return;
        async function fetchRoster() {
            try {
                const res = await fetch('/api/player/roster');
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
                            const eligiblePets = Array.isArray(incoming.eligiblePets)
                                ? incoming.eligiblePets.map(normalizePet)
                                : [];
                            const record: PlayerRecord = {
                                name: incoming.name || normalized.name,
                                level: incoming.level ?? normalized.level,
                                village: incoming.village || normalized.village,
                                specialty: (incoming.specialty as JutsuType | undefined) ?? normalized.specialty,
                                character: normalized,
                                eligiblePets,
                                currentSector: incoming.currentSector ?? 40,
                                lastSeenAt: incoming.lastSeenAt ?? Date.now(),
                                sleeping: incoming.sleeping === true,
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
        fetchRoster();
        // Poll every 60s to keep the search's 🟢/⚫ online dot fresh. Do NOT add a
        // cache-buster: this used to send `?fresh=<Date.now()>` outside the village,
        // forcing every poll past the CDN to the origin — the most amplified request in
        // the game, re-serialising EVERY player's save each time. The response is already
        // ≤60s stale by design (the server's process cache bakes the online flags in).
        const id = setInterval(fetchRoster, 60000);
        return () => clearInterval(id);
    }, [character?.name, currentSector, gameplayViewOpen]);

    useEffect(() => {
        // /api/bloodlines/list is auth-gated (it scans every save), so it 401s
        // for anonymous visitors. The public-bloodline gallery only shows inside
        // the logged-in codex anyway, so skip the fetch until a character is
        // active — this drops a wasted 401 on every cold landing.
        if (!gameplayViewOpen || !character?.name) return;
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
    }, [character?.name, gameplayViewOpen]);

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
            else alert(`${accepted.fromName} accepted your Hollow Warfront challenge. Open Pet Arena if it doesn't start.`);
            setScreen("petArena");
            return;
        }
        if (accepted.mode === "clanWarPet" || accepted.mode === "rankedPet") {
            if (accepted.responderPet) {
                const myEligiblePets = activeCarriedPets<Pet>(character);
                // Reconstruct the challenger's own party from the IDs they
                // originally sent — the current entitlement projection is the authoritative source.
                const myParty: [Pet, Pet] | undefined = (accepted.petParty && accepted.challengerPetIds && character)
                    ? (() => {
                        const [a, b] = accepted.challengerPetIds!;
                        const p1 = myEligiblePets.find(p => p.id === a);
                        const p2 = myEligiblePets.find(p => p.id === b && p.id !== a);
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
                        ? { ranked: true, opponentRating: accepted.responderPetRating ?? 1000, selfPet: myEligiblePets.find(p => p.id === accepted.challengerPetId), petRankedToken: accepted.petRankedToken }
                        // Challenger side of that same sealed duel: same id,
                        // same fight, same verdict the responder reads.
                        : { pvpChallengeId: accepted.id }),
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
                alert(`${accepted.fromName} accepted your pet battle. Open the Pet Colosseum if it does not start automatically.`);
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
        const acceptanceAccountKey = saveConflictAccountKey(character.name);
        const acceptanceSessionEpoch = saveSessionEpochRef.current;
        const acceptanceIsCurrent = () => isCurrentSaveSession(acceptanceAccountKey, acceptanceSessionEpoch);
        if (!acceptanceIsCurrent() || !requireServerSettlement("pvpSession")) return;
        const acceptingCharacter = character;
        const rankedAuthority = challenge.mode === "ranked"
            ? playerRankedAuthorityFromChallenge(challenge)
            : null;
        if (challenge.mode === "ranked" && !rankedAuthority) {
            if (!acceptanceIsCurrent()) return;
            alert("This ranked challenge is missing its server match proof. Decline it and rejoin the ranked queue.");
            return;
        }
        if (processingChallengeIds.includes(challenge.id)) return;
        if (!acceptanceIsCurrent()) return;
        setProcessingChallengeIds(prev => [...prev, challenge.id]);
        const challenger = normalizeCharacter(challenge.challenger);
        dismissChallengeLocally(challenge.id);
        try {
            const { captureOwnSaveRead } = await loadOwnSaveRead();
            if (!acceptanceIsCurrent()) return;
            const p2ReadAnchor = captureOwnSaveRead(acceptingCharacter);
            const [p1CombatSave, p2CombatSave] = await Promise.all([
                fetchPlayerCombatSave(challenge.fromName),
                fetchPlayerCombatSave(acceptingCharacter.name),
            ]);
            if (!acceptanceIsCurrent()) return;
            if (p2CombatSave) {
                const ownSaveReadResult = await adoptOwnSaveRead(p2ReadAnchor, p2CombatSave.character, p2CombatSave._saveVersion);
                if (!acceptanceIsCurrent() || ownSaveReadResult === "foreign") return;
            }
            const p1SavedBloodlines = p1CombatSave?.savedBloodlines ?? savedBloodlines;
            const p1CreatorJutsus = p1CombatSave?.creatorJutsus ?? creatorJutsus;
            const p2SavedBloodlines = p2CombatSave?.savedBloodlines ?? savedBloodlines;
            const p2CreatorJutsus = p2CombatSave?.creatorJutsus ?? creatorJutsus;
            const p1Character = p1CombatSave?.character ?? challenger;
            const p2Character = p2CombatSave?.character ?? acceptingCharacter;
            const p1AllItems = getAllItems(p1CombatSave?.creatorItems ?? creatorItems);
            const p2AllItems = getAllItems(p2CombatSave?.creatorItems ?? creatorItems);
            const p1Jutsus = p1CombatSave?.character
                ? getPvpJutsuLoadout(p1SavedBloodlines, p1CreatorJutsus, p1Character)
                : challenge.challengerJutsus?.length
                    ? challenge.challengerJutsus.map(normalizeJutsu)
                    : getPvpJutsuLoadout(p1SavedBloodlines, p1CreatorJutsus, p1Character);
            const p2Jutsus = getPvpJutsuLoadout(p2SavedBloodlines, p2CreatorJutsus, p2Character);
            const createBody = stringifyPvpSessionPayload({
                    challengeId: challenge.id,
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
                    ...(rankedAuthority ?? {}),
                    // Server-authoritative base PvP-win reward (audit #7 / Stage 3
                    // Phase 3; PvP-audit #1/#3): the server credits the winner's
                    // base ryo + XP on claim-rewards and the client DEFERS to that
                    // value (handlePvpWin → applyServerBaseReward), so the repeat-
                    // opponent decay actually sticks and a tampered client can't
                    // inflate the payout. Enabled for ALL PvP wins — including
                    // practice spars — so spar round-robins are throttled by the
                    // same decay instead of paying full ryo/XP every rematch (the
                    // honest first win/hour is unchanged). rewardSector feeds ONLY
                    // the Death's Gate 2× bonus. Spars (standard, no clan-war/sector stakes) → baseRewards false so the server grants nothing (matches isFriendlyDuel).
                    baseRewards: !(!challenge.mode || (challenge.mode === "standard" && !challenge.clanWarPoints && !challenge.sectorAttack)),
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
                });
            const createScope = capturePvpCreateScope(acceptingCharacter.name);
            const createResult = await (await loadPvpSessionCreate()).createPvpSessionWithRecovery(fetch, acceptingCharacter.name, createBody, {
                signal: createScope.signal,
                isCurrent: () => acceptanceIsCurrent() && createScope.isCurrent(),
            });
            if (!acceptanceIsCurrent()) return;
            if (createResult.kind === "recovered") {
                installPvpRecovery(createResult.pending);
                setScreen("pvpBattle");
                return;
            }
            if (createResult.kind === "rejected") throw new Error(createResult.error);
            if (createResult.kind === "ambiguous") {
                setPvpBattleId(createResult.battleId);
                setPvpRole("p2");
                setPvpBattleContext({ mode: challenge.mode, clanWarPoints: challenge.clanWarPoints, sectorAttack: challenge.sectorAttack, sector: currentSector, kageChallengeId: challenge.kageChallengeId, kageVillage: challenge.kageVillage });
                setScreen("pvpBattle");
                alert("The acceptance response was interrupted. Reconnecting to the authoritative session…");
                return;
            }
            const battleId = createResult.battleId;
            setPvpSeedSession(createResult.session);
            setPvpBattleId(battleId);
            setPvpRole("p2");
            setPvpBattleContext({ mode: challenge.mode, clanWarPoints: challenge.clanWarPoints, sectorAttack: challenge.sectorAttack, sector: currentSector, kageChallengeId: challenge.kageChallengeId, kageVillage: challenge.kageVillage });
            setScreen("pvpBattle");
            // Publication is authoritative; route the accepter before advisory
            // notification so a hung notice cannot strand a live session.
            const acceptedNotice: DuelChallenge = { ...challenge, battleId, accepted: true, fromName: acceptingCharacter.name, toName: challenge.fromName };
            void postPlayerChallengeNotice(challenge.fromName, acceptedNotice, {
                shouldContinue: () => acceptanceIsCurrent() && createScope.isCurrent(),
                signal: createScope.signal,
            }).then((notified) => {
                if (!notified && acceptanceIsCurrent() && createScope.isCurrent()) {
                    alert(`${challenge.fromName} may not be pulled in automatically. Ask them to reopen the game or wait for heartbeat.`);
                }
            });
        } catch {
            if (!acceptanceIsCurrent()) return;
            setDuelChallenges(prev => prev.some(c => c.id === challenge.id) ? prev : [challenge, ...prev]);
            if (!acceptanceIsCurrent()) return;
            alert(`${challenge.fromName}'s challenge could not be accepted. Try again if it is still pending.`);
        } finally {
            setProcessingChallengeIds(prev => prev.filter(id => id !== challenge.id));
        }
    }

    useEffect(() => {
        if (!gameplayViewOpen || bootRestoreStartedRef.current) return;
        bootRestoreStartedRef.current = true;
        let restoreCompleted = false;
        // Helper: apply a full server/local snapshot to state
        function applySnapshot(snap: ReturnType<typeof buildPlayerSavePayload>, bootLock?: ClientBattleLock | null) {
            const snapshotAccountKey = saveConflictAccountKey(snap.character.name);
            const snapVersion = (snap as Record<string, unknown>)._saveVersion;
            if (saveAuthorityAccountKeyRef.current === snapshotAccountKey) {
                const decision = acceptVersionedSnapshot(latestSaveVersionRef.current, snapVersion);
                if (!decision.accepted) return;
            }
            // Seed prevCharRef so the auto-save interval treats this load as clean
            // (no local changes yet). Without this, a second logged-in device would
            // immediately auto-save the just-loaded snapshot, overwriting progress
            // made by a more recently active device.
            const normalized = normalizeAdminCharacter(snap.character);
            prevCharRef.current = normalized;
            charDirtyRef.current = false;
            scopeSaveAuthorityToAccount(snap.character.name);
            const restoredPvpScope = {
                ownerName: snap.character.name,
                accountSessionEpoch: saveSessionEpochRef.current,
            };
            // Capture the server-issued save version on the refresh/boot load too
            // (applyServerSnapshot already does this on the login/409 paths). Without
            // it, latestSaveVersionRef stays 0 after a refresh, so the first autosave
            // echoes _baseSaveVersion:0, 409s against the stored version, and the
            // player visibly rubber-bands a few seconds of progress before it heals.
            if (typeof snapVersion === "number" && Number.isFinite(snapVersion)) {
                latestSaveVersionRef.current = adoptSaveVersion(latestSaveVersionRef.current, snapVersion);
            }
            setCharacter(normalized);
            currentAccountNameRef.current = snap.character.name;
            setCurrentAccountName(snap.character.name);
            void rehydrateSaveConflictDraft(snap.character.name, snap);
            setCurrentBiome(snap.currentBiome ?? "central");
            setActiveTraining(snap.activeTraining ?? null);
            setActiveJutsuTraining(snap.activeJutsuTraining ?? null);
            setAcceptedMissionIds(snap.acceptedMissionIds ?? []);
            setMissionProgress(snap.missionProgress ?? {});
            setTriggeredEvents(snap.triggeredEvents ?? []);
            // Pre-cutover local Arena opponent ids are presentation authority,
            // not resumable combat proof. Never hydrate them into the reducer.
            setPendingAiProfileId("");
            const snapPendingTravel = normalizePendingTravel((snap as Record<string, unknown>).pendingTravel);
            setPendingTravel(snapPendingTravel);
            setTravelingUntil(snapPendingTravel?.arrivalAt ?? 0);
            lastSnapshotMissionSigRef.current = JSON.stringify([snap.acceptedMissionIds ?? [], snap.missionProgress ?? {}, snap.triggeredEvents ?? [], snap.currentBiome ?? "central", snapPendingTravel]);
            applySnapshotSectorWithGuard(snap.currentSector ?? 40);
            if (snap.savedBloodlines) setSavedBloodlines(snap.savedBloodlines.map((bloodline: SavedBloodline) => ({ ...bloodline, jutsus: bloodline.jutsus.map(normalizeJutsu) })));
            if (snap.creatorJutsus) setCreatorJutsus(snap.creatorJutsus.map(normalizeJutsu));
            if (snap.creatorAis) setCreatorAis(balanceExistingAiProfiles(snap.creatorAis, savedJutsuPool(snap)));
            const contentAdmin = isContentAdminName(snap.character.name);
            if (snap.creatorEvents) setCreatorEvents(contentAdmin ? snap.creatorEvents : snap.creatorEvents.filter(isReleaseSafeClientEvent));
            setCreatorMissions(contentAdmin ? (snap.creatorMissions ?? []) : []);
            setCreatorRaids(contentAdmin ? (snap.creatorRaids ?? []) : []);
            if (snap.creatorCards) setCreatorCards(snap.creatorCards);
            if (snap.creatorItems) setCreatorItems(snap.creatorItems);
            if (snap.petEncounterVn) setPetEncounterVn(snap.petEncounterVn);
            if (snap.ancientChestVn) setAncientChestVn(snap.ancientChestVn);
            if (snap.editablePets) setEditablePets(mergeMissingBuiltInPets(snap.editablePets));
            // Route browser breadcrumbs immediately; the authenticated pointer
            // repairs private-mode and terminal-completion reloads.
            let restoredPvpBattleId: string | null = null;
            let pvpSessionAliveOnServer = false;
            let pvpStorage: Storage | null = null;
            try { pvpStorage = localStorage; } catch { /* private mode */ }
            const browserPvp = readPvpBrowserBreadcrumb(
                pvpStorage,
                PVP_SESSION_KEY,
                accountKey(String(snap.character.name ?? "")),
            );
            if (browserPvp) {
                restoredPvpBattleId = browserPvp.pvpBattleId;
                installPvpBreadcrumb({
                    battleId: browserPvp.pvpBattleId,
                    role: browserPvp.pvpRole,
                    context: browserPvp.pvpBattleContext,
                }, restoredPvpScope);
                pvpSessionAliveOnServer = true;
            }
            const recoveryScope = capturePvpCreateScope(snap.character.name);
            void loadPvpPendingFetch().then((m) => m.fetchPendingPvpRecoveryWithRetry(fetch, snap.character.name, recoveryScope)).then((pending) => {
                if (!pending || !recoveryScope.isCurrent()) return;
                installPvpRecovery(pending, restoredPvpScope);
                setScreen("pvpBattle");
            }).catch(() => { /* offline: retain the browser recovery route */ });

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
                    if (bootLock.kind === "battleTowers") {
                        // Tower leases are fully server-owned. Recreate the local
                        // breadcrumb and route into authoritative recovery; never
                        // turn a missing browser key into a fabricated loss.
                        const runId = typeof bootLock.meta?.runId === "string" ? bootLock.meta.runId.trim() : "";
                        // EVERY 2v2 mode resumes in the BATTLE ARENA; only the
                        // co-op climb resumes into the Towers (see isMpvpLeaseMode).
                        const arena2v2 = isMpvpLeaseMode(bootLock.meta?.mode);
                        if (runId && runId.length <= 128) {
                            if (arena2v2) setTowerPvpMatchId(runId); else setTowerFightRunId(runId);
                        }
                        setScreen(arena2v2 ? "battleArena" : "battleTowers");
                        return;
                    }
                    let recentlyResolved = "";
                    try { recentlyResolved = localStorage.getItem(BATTLE_LOCK_RESOLVED_KEY) ?? ""; } catch { /* ignore */ }
                    if (recentlyResolved && recentlyResolved === bootLock.battleId) {
                        // The fight already ended on this client; the server
                        // resolve just didn't land (network). Retry the clear and
                        // do NOT re-punish — fall through to normal restore routing.
                        try { localStorage.removeItem(BATTLE_LOCK_RESOLVED_KEY); } catch { /* ignore */ }
                        void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId });
                    } else if (bootLock.kind === "endless") {
                        // Endless combat now resumes from the server-owned solo
                        // session when the player re-enters the lobby. Retire any
                        // stale local-Arena lock without inventing a loss.
                        void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId });
                        setScreen("endlessTower");
                        return;
                    } else if (bootLock.kind === "arena") {
                        // Generic catalog AI and human PvP now have server-owned
                        // hosts. Retire a pre-cutover local reducer snapshot
                        // without inventing a loss or reviving its opponent id.
                        void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId });
                        try { localStorage.removeItem(`arena.battle.v3.${normalized.name}`); } catch { /* private mode */ }
                        setPendingAiProfileId("");
                        gameToast("Legacy local Arena combat was safely retired. Start a sealed spar when you're ready.");
                        setScreen("battleArena");
                        return;
                    } else if (bootLock.kind === "arenaStory" && (readArenaStoryContext(normalized.name)?.battle as { kind?: string } | undefined)?.kind === "hollowGateShrine") {
                        // Retire the pre-cutover local Arena lock. The save's run-bound
                        // pointer below resumes the server-owned Solo PvE session.
                        void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId });
                        if (normalized.hollowGateRun) setHollowGateRun(normalized.hollowGateRun);
                        setScreen("hollowGateShrine");
                        return;
                    } else if (bootLock.kind === "arenaStory" && (readArenaStoryContext(normalized.name)?.battle as { kind?: string } | undefined)?.kind === "dungeonAi") {
                        // A pre-cutover Warden snapshot must never revive the local
                        // combat reducer. Retire only that browser lock and preserve
                        // the active server run; Seal One can immediately relaunch
                        // through AiFightHost with its exact dungeonRunToken.
                        const legacy = readArenaStoryContext(normalized.name)?.battle as { eventId?: string } | undefined;
                        void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId });
                        try {
                            localStorage.removeItem(arenaStoryCtxKey(normalized.name));
                            localStorage.removeItem(`arena.battle.v3.${normalized.name}`);
                        } catch { /* private mode */ }
                        setPendingArenaStoryBattle(null);
                        setTemporaryStoryAi(null);
                        setPendingAiProfileId("");
                        const dungeonToken = normalized.activeDungeonRun?.token;
                        if (dungeonToken) {
                            setActiveDungeonEvent(creatorEvents.find((event) => event.id === legacy?.eventId) ?? dungeonEventTemplate());
                            setActiveDungeonRunToken(dungeonToken);
                            setDungeonLine(0);
                            gameToast("Dungeon combat upgraded. Challenge the sealed Warden to continue your reserved run.");
                            setScreen("dungeon");
                        } else {
                            setScreen("worldMap");
                        }
                        return;
                    } else if (bootLock.kind === "arenaStory" && ["triggeredEvent", "academySparring"].includes(String((readArenaStoryContext(normalized.name)?.battle as { kind?: string } | undefined)?.kind))) {
                        // Creator-event flavor fights and Academy sparring now use
                        // sealed hosts. Never revive their pre-cutover local Arena
                        // reducer or its client-authored reward settlement.
                        const legacyKind = (readArenaStoryContext(normalized.name)?.battle as { kind?: string } | undefined)?.kind;
                        void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId });
                        try { localStorage.removeItem(arenaStoryCtxKey(normalized.name)); localStorage.removeItem(`arena.battle.v3.${normalized.name}`); } catch { /* private mode */ }
                        setPendingArenaStoryBattle(null); setTemporaryStoryAi(null); setPendingAiProfileId("");
                        gameToast("Legacy local story combat was safely retired. Re-enter the sealed encounter to continue.");
                        setScreen(legacyKind === "academySparring" ? "village" : "worldMap");
                        return;
                    } else if (bootLock.kind === "arenaStory") {
                        // Unknown/older story breadcrumbs are never permission to
                        // revive a browser-owned opponent. Preserve all server
                        // run pointers and return to the sealed Story Hall entry.
                        void postBattleLock({ action: "resolve", playerName: normalized.name, battleId: bootLock.battleId });
                        try { localStorage.removeItem(arenaStoryCtxKey(normalized.name)); localStorage.removeItem(`arena.battle.v3.${normalized.name}`); } catch { /* private mode */ }
                        setPendingArenaStoryBattle(null); setTemporaryStoryAi(null); setPendingAiProfileId("");
                        setScreen("storyHall");
                        return;
                    } else if (battleResumeStateExists(bootLock, normalized.name, normalized)) {
                        // Resume state intact → drop back into the same fight; the
                        // screen's persister rehydrates it at the same HP/turn.
                        if (bootLock.kind === "hollowGateTiles") {
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
                            if (!hgRun) setCharacter({ ...normalized, hp: 0, hospitalized: true });
                            const dungeonToken = normalized.activeDungeonRun?.token;
                            if (dungeonToken) {
                                void mutateDungeonRunServer(normalized.name, "abandon", dungeonToken).then((result) => {
                                    commitVersionedCharacter({ ...result.character, hp: 0, hospitalized: true }, result._saveVersion);
                                }).catch(() => {
                                    gameToast("The interrupted dungeon run remains reserved and will be reconciled on the next load.");
                                });
                            }
                            // If this KO recovery is the first to settle the run's token, reconcile
                            // to the server credit (single-use → a no-op if the live device already did).
                            if (hgRun) void settleHollowGateRunOnly(hgRun, "death", normalized, setCharacter);
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
                    // and the safe-screen routing below. The screen sets and
                    // recovery policy live in lib/screen-guards so they cannot drift.
                    const hashRaw = (() => { try { return window.location.hash.replace(/^#\/?/, ""); } catch { return ""; } })();
                    const persisted = (DEEP_LINKABLE_SCREENS.has(hashRaw as Screen) ? (hashRaw as Screen) : null) ?? (localStorage.getItem(LAST_SCREEN_KEY) as Screen | null);
                    const inHollowGateRun = Boolean(normalized.hollowGateRun && !normalized.hollowGateRun.completed);
                    const inDungeonRun = Boolean(normalized.activeDungeonRun?.token);
                    target = restoreScreenForSave(persisted, inHollowGateRun, normalized.hospitalized, inDungeonRun, isWildSector(Number(snap.currentSector ?? 0)));
                    if (inHollowGateRun) {
                        try {
                            localStorage.removeItem("shinobix:towerRunId");
                        } catch {
                            // Storage failures must not block the Gate recovery route.
                        }
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
                    // No active run — bounce back to where the player IS
                    // (world if in a sector) rather than an empty shrine screen.
                    target = safeFallbackScreen(isWildSector(Number(snap.currentSector ?? 0)));
                } else if (target === "dungeon" && normalized.activeDungeonRun?.token) {
                    setActiveDungeonRunToken(normalized.activeDungeonRun.token);
                    setActiveDungeonEvent(creatorEvents.find((event) => event.id === DUNGEON_VN_ID) ?? hiddenDungeonVnEvent);
                    setDungeonLine(0);
                    setDungeonReturnScreen(normalized.activeDungeonRun.entry === "key" ? "centralHub" : "worldMap");
                } else if (target === "dungeon") {
                    target = safeFallbackScreen(isWildSector(Number(snap.currentSector ?? 0)));
                }
                setScreen(target);
            })();
            // Re-hydrate the visible screen after restore. Preserve the valid
            // session manifest cache instead of forcing an eight-request reload.
            loadedCatsRef.current.clear();
            setTimeout(() => {
                void loadCategory('avatar');
                loadScreenImageCategories(screenRef.current);
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
        // A Google redirect is an explicit "sign me in as this account", so it
        // takes precedence over restoring whoever used this browser last. Its
        // own effect drives the rest.
        if (googleRedirect) localAccountName = "";

        // Always try to pull full save from server (images live here, not in localStorage).
        // Re-prime the authFetch interceptor from localStorage so the auto-load fetch
        // has credentials even on a fresh tab / mobile tab restore / browser restart
        // (sessionStorage is tab-scoped and can be cleared, but the localStorage fallback
        // in authFetch now makes credentials available; setActivePlayer here syncs them
        // back into sessionStorage for the rest of this session).
        if (localAccountName) {
            const restoreLoad = beginSessionLoad(sessionLoadGenerationRef, localAccountName);
            // Re-sync the non-secret name into sessionStorage. authFetch reads the
            // persisted session token directly; no password fallback exists.
            setActivePlayer(localAccountName);

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
                const OPTIMISTIC_HUB_SCREENS = new Set<string>(["village", "profile", "inventory", "logbook", "training", "jutsuTraining", "missions", "bloodlineMaker", "clan", "worldMap", "townHall", "bank", "shop", "grandMarketplace", "hospital", "cafeteria", "storyHall", "centralHub", "home", "pets", "hunting", "tavern", "hallOfLegends", "shinobiCouncil", "messages"]);
                if (OPTIMISTIC_HUB_SCREENS.has(hubHash)) {
                    const preview = readSavePreview(localAccountName);
                    if (preview && preview.character) {
                        applyServerSnapshot(preview as ReturnType<typeof buildPlayerSavePayload>, { authoritative: false });
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
                if (!restoreLoad.isCurrent()) return;
                restoreLoad.retire();
                // retire() makes the .finally() below see a stale generation and
                // skip its setRestoringSession(false) — so the gate MUST drop
                // here, or a failed pull (expired 24h token → 401) strands the
                // player on the "Restoring…" screen forever with the 12s
                // backstop already cleared.
                setRestoringSession(false);
                setRestoreFailed(true);
                if (didOptimisticPaint) { unwindToLoginForm(); setOptimisticRestore(false); }
            };

            // Safety backstop: pullSaveFromServer has no request timeout, so a
            // connection that hangs with no response would pin the "restoring"
            // gate forever. After 12s, drop to the login fallback.
            const restoreTimer = window.setTimeout(() => {
                if (!restoreLoad.isCurrent()) return;
                revertRestoreToLogin();
                setRestoringSession(false);
            }, 12000);
            // Pull the save AND the server battle-lock together so the restore
            // routing can force re-entry into an unresolved PvE fight (a refresh
            // must not let a player flee a battle). The lock fetch never rejects.
            Promise.all([
                pullSaveFromServer(localAccountName),
                fetchBattleLockStatus(localAccountName),
            ]).then(async ([snap, lock]) => {
                if (!restoreLoad.isCurrent()) return;
                if (snap && saveConflictAccountKey(snap.character.name) === restoreLoad.accountKey) { applySnapshot(snap, lock); return; }
                // A guest has no password to fall back on, so an expired token
                // would otherwise strand them on a login form they can never
                // satisfy. Their resume credential is exactly for this moment.
                const guest = await resumeGuestFor(localAccountName, (a, b) => accountKey(a) === accountKey(b));
                if (!restoreLoad.isCurrent()) return;
                if (guest) {
                    if (guest.token) setActiveToken(guest.token);
                    setActivePlayer(guest.name);
                    const retry = await pullSaveFromServer(guest.name);
                    if (!restoreLoad.isCurrent()) return;
                    if (retry && saveConflictAccountKey(retry.character.name) === restoreLoad.accountKey) return applySnapshot(retry, lock);
                }
                // Stored account but the pull failed (expired token / 4xx /
                // network after retries) — surface the pre-filled login instead
                // of silently sitting on the start screen (or on a stale
                // optimistic paint).
                revertRestoreToLogin();
            }).finally(() => {
                restoreCompleted = true;
                window.clearTimeout(restoreTimer);
                if (!restoreLoad.isCurrent()) return;
                setRestoringSession(false);
                void pullSharedAdminContent();
            });
        } else {
            // No stored account → brand-new / anonymous visitor: show the login
            // form immediately, nothing to restore.
            setRestoringSession(false);
            restoreCompleted = true;
        }
        return () => {
            sessionLoadGenerationRef.current += 1;
            if (!restoreCompleted) bootRestoreStartedRef.current = false;
        };
        // No stored account = anonymous visitor on the landing screen. The shared
        // admin content (custom jutsu/items/events) pulls Admin 1 / Admin 2 saves,
        // which 401 without auth — so skip it here. It loads as soon as they log in
        // or create a character (both call pullSharedAdminContent), dropping two
        // wasted 401s on every cold landing.
    }, [gameplayViewOpen]);

    // Finish a Google sign-in the browser is coming back from. Google decides
    // who this is, so it wins over whatever account was last on this device.
    useEffect(() => {
        if (!googleRedirect) return;
        let cancelled = false;
        // Backstop mirroring the boot restore's 12s timer: this chain holds the
        // same "Restoring…" gate up (restoringSession initializes true on a
        // pending redirect), and its .finally only fires when the claim chain
        // SETTLES — a stalled connection on the redirect return would pin the
        // gate with no other way down. Dropping the gate does not cancel the
        // chain: a late success still signs in via the generation-guarded
        // enterGameAsPlayer, so the worst case is the login form appearing
        // before the game does.
        const googleRestoreBackstop = window.setTimeout(() => {
            if (cancelled) return;
            setGoogleNotice("Google sign-in is taking longer than expected. You can log in below — or try Google again.");
            setRestoringSession(false);
        }, 20_000);
        void finishGoogleRedirect(googleRedirect, {
            needsSignup: (handoff) => { if (!cancelled) setGoogleSignup(handoff); },
            failed: (message) => { if (!cancelled) setGoogleNotice(message); },
            signedIn: async (name, token, linked) => {
                if (cancelled) return;
                // Linking is what stops a guest character being disposable, so
                // its browser-bound credential is no longer the way back in.
                if (linked) {
                    setGoogleNotice("Google is now linked to this shinobi.");
                    clearGuestSessionFor(name, (a, b) => accountKey(a) === accountKey(b));
                }
                await enterWithToken(name, token);
            },
        }).finally(() => { window.clearTimeout(googleRestoreBackstop); if (!cancelled) setRestoringSession(false); });
        return () => { cancelled = true; window.clearTimeout(googleRestoreBackstop); };
        // Runs once, for the redirect captured before the first render.
    }, []);

    // Boot watchdog (rationale in lib/boot-gate-watchdog.ts): while the gate
    // is up and no restore is running — capabilities unreachable, or a
    // mid-restore orphan — fall through to the pre-filled login form.
    useEffect(() => {
        if (!restoringSession || !bootAccountName || googleRedirect) return;
        return startBootGateWatchdog({
            restoreStarted: bootRestoreStartedRef,
            fallThrough: () => { setRestoreFailed(true); setRestoringSession(false); },
        });
        // bootAccountName/googleRedirect are init-once state; only the gate varies.
    }, [restoringSession]);

    useEffect(() => {
        // Preserve the account marker until capability-delayed restore resolves.
        if (restoringSession) return;
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
        restoringSession,
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
            currentSector,
            pendingTravel,
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
            hollowGateEventConfig,
            ...overrides,
        };
    }

    async function pushSaveToServer(
        characterToSave: Character,
        name: string,
        overrides?: Parameters<typeof buildPlayerSavePayload>[1],
        opts?: { echoVersion?: boolean; useLatestAtExecution?: boolean },
    ) {
        const captured = opts?.useLatestAtExecution ? null : {
            character: characterToSave, payload: buildPlayerSavePayload(characterToSave, overrides), revision: savePayloadRevisionRef.current,
        };
        return savePersistenceRef.current!.persistRequired(() => {
            const executionSnapshot = opts?.useLatestAtExecution ? latestSaveRef.current : captured;
            const effectiveCharacter = executionSnapshot?.character ?? characterToSave;
            return { name, payload: executionSnapshot?.payload ?? buildPlayerSavePayload(effectiveCharacter, overrides),
                revision: executionSnapshot?.revision ?? savePayloadRevisionRef.current, echoVersion: opts?.echoVersion ?? true,
                isStillCurrent: () => latestSaveRef.current?.character === effectiveCharacter,
                onCommitted: () => { if (saveSoonTimerRef.current) { clearTimeout(saveSoonTimerRef.current); saveSoonTimerRef.current = null; } },
            };
        });
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
            // sessionLoadFetch, not plain fetch: a stalled verify used to hold
            // reauthBusy forever, and the modal disables its buttons on busy —
            // the exact trap this modal exists to prevent. The 15s deadline
            // lands in the catch below as a normal connection error.
            const res = await sessionLoadFetch('/api/player-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'verify', name: name.toLowerCase(), password: reauthPw }),
            });
            const data = await res.json().catch(() => null) as { ok?: boolean; token?: string } | null;
            // "Log out instead" is clickable while this was in flight; if the
            // player took it, the session is gone — don't resurrect credentials.
            if (!characterRef.current) return;
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
                    await pushSaveToServer(char, name, undefined, { useLatestAtExecution: true });
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
        currentAccountNameRef.current = "";
        resetSaveAuthorityScope();
        setSaveConflictDraft(null);
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

    function isContentAdminName(raw: unknown): boolean {
        const name = String(raw ?? "").trim().toLowerCase();
        return name === "admin 1" || name === "admin 2" || name === "admin1" || name === "admin2";
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
        const contentAdmin = isContentAdminName(character?.name);
        // Bloodlines are intentionally NOT synced from admin saves — each player sees only their own bloodlines.
        if (snap.creatorJutsus) setCreatorJutsus((prev) => mergeJutsusByRecency(prev, sharedCreatorJutsus));
        if (snap.creatorAis) setCreatorAis((prev) => mergeById(prev, balanceExistingAiProfiles(snap.creatorAis as CreatorAi[], [...starterJutsus, ...sharedCreatorJutsus])));
        if (snap.creatorEvents) {
            const incoming = contentAdmin
                ? snap.creatorEvents as CreatorEvent[]
                : (snap.creatorEvents as CreatorEvent[]).filter(isReleaseSafeClientEvent);
            setCreatorEvents((prev) => mergeById(contentAdmin ? prev : prev.filter(isReleaseSafeClientEvent), incoming));
        }
        if (contentAdmin) {
            if (snap.creatorMissions) setCreatorMissions((prev) => mergeById(prev, snap.creatorMissions as CreatorMission[]));
            if (snap.creatorRaids) setCreatorRaids((prev) => mergeById(prev, snap.creatorRaids as CreatorRaid[]));
        } else {
            setCreatorMissions([]);
            setCreatorRaids([]);
        }
        if (snap.creatorCards) setCreatorCards((prev) => mergeById(prev, snap.creatorCards as TileCard[]));
        if (snap.creatorItems) setCreatorItems((prev) => mergeById(prev, snap.creatorItems as GameItem[]));
        if (snap.petEncounterVn) setPetEncounterVn(snap.petEncounterVn as CreatorEvent);
        if (snap.ancientChestVn) setAncientChestVn(snap.ancientChestVn as CreatorEvent);
        // Event-gate config: recency-merged like the other shared content so
        // whichever admin edited it last wins across both admin slots.
        if (snap.hollowGateEventConfig) {
            const nextCfg = normalizeHollowGateEventConfig(snap.hollowGateEventConfig);
            if (nextCfg) setHollowGateEventConfig(prev => (!prev || (nextCfg.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) ? nextCfg : prev);
        }
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
        // Image manifests have their own short-lived cache and screen-specific
        // loader. Pulling shared metadata must not invalidate every image bucket.
        loadScreenImageCategories(screenRef.current);
    }

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
        // Your sector is WHERE YOU ARE; menus don't move you. Only entering a town resets it (lib/screen-guards).
        if (screenResetsSector(screen)) setCurrentSector(0);
    }, [screen]);

    useEffect(() => {
        if (!character || activeTriggeredEvent) return;
        if (isBattleFlowScreen(screen)) return;
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
    // The two VN auto-trigger effects below run in the same commit and would
    // both fire on the same stale null activeTriggeredEvent (last writer wins,
    // the first scene lost but marked seen). The ref is the same-commit claim;
    // it clears when the active VN closes.
    const vnTriggerClaimRef = useRef(false);
    useEffect(() => { if (!activeTriggeredEvent) vnTriggerClaimRef.current = false; }, [activeTriggeredEvent]);
    // Interlude scenes dismissed THIS SESSION (skipped / closed without a
    // choice). Deliberately not persisted: a refresh re-offers the beat instead
    // of permanently losing it and its finale reckoning gate.
    const dismissedStoryScenesRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!character || activeTriggeredEvent) return;
        if (isBattleFlowScreen(screen)) return;
        if (normalizeOnboardingStep(character.onboardingStep) !== "done") return; // never consume a VN beneath the cinematic/tutorial
        const candidate = creatorEvents.find(
            (ev) =>
                ev.eventKind === "visualNovel" &&
                !ev.trigger &&
                !triggeredEvents.includes(ev.id) &&
                character.level >= ev.levelReq
        );
        if (!candidate) return;
        if (vnTriggerClaimRef.current) return;
        vnTriggerClaimRef.current = true;
        setTriggeredEvents((ids) => [...ids, candidate.id]);
        setActiveTriggeredEvent(candidate);
        setActiveTriggerReturnScreen(screen);
        setTriggerPage(0);
        setTriggerLine(0);
    }, [activeTriggeredEvent, character, creatorEvents, screen, triggeredEvents]);

    // Auto-trigger the next story beat — a milestone chapter VN (boss) or a
    // VN-only interlude (road scene) — when the player qualifies. Selection and
    // Ordering/reward rules live in lib/story-trigger; opening a scene pays nothing.
    useEffect(() => {
        if (!character || activeTriggeredEvent) return;
        // Don't interrupt battle flows — let the VN fire after the player returns.
        if (isBattleFlowScreen(screen)) return;
        // Gate the village story behind tutorial completion (skip sets "done").
        if (normalizeOnboardingStep(character.onboardingStep) !== "done") return;
        // Don't fire beneath the forced ProfessionPicker modal (level 13+, no
        // profession) — it out-z-indexes the VN and traps input until picked.
        if (character.level >= 13 && !character.profession) return;
        // Selection lives behind the lazy story chunk (lib/story-trigger-loader);
        // the idle prefetch makes this resolve in a microtask in practice. The
        // stale guard drops a resolution whose effect deps have already changed.
        let stale = false;
        void loadStoryTrigger().then(async ({ nextStoryTrigger, overlayVnImages }) => {
            const resolved = await resolveStoryContinuation(() => nextStoryTrigger(character, triggeredEvents, [...dismissedStoryScenesRef.current]), character.name, () => currentAccountNameRef.current || characterRef.current?.name || "", () => stale);
            const next = resolved.current ? resolved.value : null;
            if (!next || vnTriggerClaimRef.current) return;
            vnTriggerClaimRef.current = true;
            // Prefer the admin-edited version from creatorEvents (uploaded images,
            // custom dialogue, etc.), then overlay any KV-stored images.
            const edited = creatorEvents.find(e => e.id === next.eventId);
            const vnEvent = overlayVnImages({ ...(edited ?? next.base), xpReward: 0, ryoReward: 0 }, next.eventId, sharedImages);
            // Opening a story beat never consumes it. Chapter milestones advance
            // only after the sealed boss win; interludes persist after a recorded
            // choice. A close is session-only and a refresh offers the beat again.
            setActiveTriggeredEvent(vnEvent);
            setActiveTriggerReturnScreen(next.returnScreen === "storyHall" ? "storyHall" : screen);
            setTriggerPage(0);
            setTriggerLine(0);
        }).catch(() => undefined);
        return () => { stale = true; };
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
                if (isPresenceBattleActive(screen)) return prev;
                if (prev.hp >= prev.maxHp && prev.chakra >= prev.maxChakra && prev.stamina >= prev.maxStamina) return prev; // idle at full vitals (common): same-ref no-op skips the per-second full-App reconcile; values are Math.min-clamped so identical — no gameplay change
                const auraBonuses = getActiveAuraSphereBonuses(prev);
                return regenerateIdleVitals(prev, 1 + auraBonuses.regen);
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [screen, raidBattleKind, pvpBattleId, pvpCompletionConfirmed, endlessBattleActive, pendingArenaStoryBattle, pendingEventEncounter, activeDungeonEvent, hollowGateTileGameActive, pendingPetBattleOpponent, petBattleActive, missionBattleActive]);

    // Image category loader — fetches from shared KV store and hydrates
    // embedded image fields so all existing display code works without changes.
    // A ref prevents duplicate fetches even when called from multiple effects.
    const loadedCatsRef = useRef<Set<string>>(new Set());
    const loadingCatsRef = useRef<Map<string, Promise<void>>>(new Map());
    const imgRetryRoundsRef = useRef<Map<string, number>>(new Map());

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
                // A starter preset is a static bundled file — never trade it for
                // the /api/img reference (same don't-clobber guard as the
                // pet/item/bloodline branches above). See lib/own-avatar.ts.
                if (isPresetAvatar(prev.avatarImage)) return prev;
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


    function loadCategory(cat: string): Promise<void> {
        if (loadedCatsRef.current.has(cat)) return Promise.resolve();
        return runSingleFlight(loadingCatsRef.current, cat, () => loadCategoryOnce(cat));
    }

    async function loadCategoryOnce(cat: string): Promise<void> {
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
                    const r = await fetch(`/api/images?cat=${encodeURIComponent(cat)}&ids=1&cb=${cb}`, { signal: AbortSignal.timeout(12_000) });
                    if (!r.ok) continue;
                    const ids = await r.json() as unknown;
                    if (!Array.isArray(ids)) continue;
                    entries = {};
                    for (const id of ids) {
                        if (typeof id === 'string') entries[id] = `/api/img?id=${encodeURIComponent(id)}`;
                    }
                } else {
                    const r = await fetch(`/api/images?cat=${encodeURIComponent(cat)}&cb=${cb}`, { signal: AbortSignal.timeout(12_000) });
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
                loadedCatsRef.current.add(cat); imgRetryRoundsRef.current.delete(cat);
                return;
            } catch { /* network error — retry */ }
        }
        // Both attempts failed — leave loadedCatsRef unset so a later screen visit retries.
        scheduleImageCategoryRetry(imgRetryRoundsRef.current, cat, () => loadedCatsRef.current.has(cat), () => void loadCategory(cat));
    }

    // Warm only shell-critical avatar metadata at login/restore. Route-specific
    // categories are requested by the map below when they can actually render.
    useEffect(() => {
        if (!character?.name && !restoringSession) return;
        // The shell needs only the player's avatar. Other tiny manifests load
        // when their screen is selected, so they cannot contend with restore,
        // the destination chunk, or the first playable paint.
        void loadCategory('avatar');
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

    // The player's OWN surfaces (left rail, mobile HUD/menu, sector marker) read
    // character.avatarImage, which is empty until the manifest hydrates it. Give
    // them the same name-keyed fallback every other render site uses — see
    // lib/own-avatar.ts.
    useEffect(() => {
        setOwnAvatarFallback(sharedImages['avatar:' + (character?.name ?? '').toLowerCase()]);
    }, [character?.name, sharedImages]);

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

    // Screen -> image categories map. These manifests do not block the screen;
    // images fill progressively from browser/CDN-cached /api/img URLs.
    function loadScreenImageCategories(activeScreen: Screen): void {
        for (const category of imageCategoriesForScreen(activeScreen)) void loadCategory(category);
    }

    useEffect(() => { loadScreenImageCategories(screen); }, [screen]);
    useEffect(() => { if (activeTriggeredEvent) void loadCategory('event'); }, [activeTriggeredEvent]);

    // The choose-your-companion overlay (onboardingStep === "starter") renders
    // starter portraits from sharedImages['pet:<id>'], but it's not a
    // 'pets'/'petArena' screen, so the screen→category effect above never
    // hydrates the pet bucket for a brand-new player. Load it when the overlay
    // is active so the uploaded art shows instead of the emoji fallback.
    // Idempotent — loadCategory's loadedCatsRef guard skips a re-fetch.
    useEffect(() => {
        // academyIntro preloads a beat early so portraits are ready at "Begin".
        if (character?.onboardingStep === "starter" || character?.onboardingStep === "academyIntro" || character?.onboardingStep === "companionIntro") void loadCategory('pet');
    }, [character?.onboardingStep]);

    // Keep a ref to the latest save payload so the interval always uses current data.
    const latestSaveRef = useRef<{
        character: Character;
        name: string;
        payload: ReturnType<typeof buildPlayerSavePayload>;
        revision: number;
    } | null>(null);
    const savePayloadRevisionRef = useRef(0);
    const savePayloadIdentityRef = useRef<readonly unknown[] | null>(null);
    const prevCharRef = useRef<Character | null>(null);
    const charDirtyRef = useRef(false);
    function installAuthoritativeSaveRef(snapshot: { name: string; payload: ReturnType<typeof buildPlayerSavePayload>; revision: number }) {
        const normalized = normalizeAdminCharacter(snapshot.payload.character);
        latestSaveRef.current = { ...snapshot, character: normalized, payload: { ...snapshot.payload, character: normalized } };
    }

    // Server-issued monotonic version of the last save we loaded or wrote.
    // We echo this back as `_baseSaveVersion` in autosave POSTs so the server
    // can detect when a second tab/device wrote in between and reject the
    // stale overwrite (HTTP 409). On 409 we refetch + reapply the server's
    // newer snapshot. The value is reset per account/session; once a stored
    // save exists the server requires this base to equal its version exactly.
    const latestSaveVersionRef = useRef<number>(0);
    const saveAuthorityAccountKeyRef = useRef("");

    function scopeSaveAuthorityToAccount(accountName: string): number {
        const accountKey = saveConflictAccountKey(accountName);
        if (saveAuthorityAccountKeyRef.current !== accountKey) {
            pvpCreateScopeAbortRef.current.abort();
            pvpCreateScopeAbortRef.current = new AbortController();
            saveAuthorityAccountKeyRef.current = accountKey;
            latestSaveVersionRef.current = 0;
            savePayloadRevisionRef.current = 0;
            savePayloadIdentityRef.current = null;
            saveFailCountRef.current = 0; setSaveBlocked(false);
            saveSessionEpochRef.current += 1;
        }
        return saveSessionEpochRef.current;
    }
    /** Drop a half-entered session and put the login form back in front. */
    function unwindToLoginForm(): void {
        currentAccountNameRef.current = "";
        resetSaveAuthorityScope();
        setSaveConflictDraft(null);
        setCharacter(null);
        setCurrentAccountName("");
        setScreen("start");
    }

    function resetSaveAuthorityScope(): void {
        pvpCreateScopeAbortRef.current.abort();
        pvpCreateScopeAbortRef.current = new AbortController();
        saveAuthorityAccountKeyRef.current = "";
        latestSaveVersionRef.current = 0;
        savePayloadRevisionRef.current = 0;
        savePayloadIdentityRef.current = null;
        saveFailCountRef.current = 0; setSaveBlocked(false);
        saveSessionEpochRef.current += 1;
    }
    function isCurrentSaveSession(accountKey: string, sessionEpoch: number): boolean {
        return saveAuthorityAccountKeyRef.current === accountKey
            && saveSessionEpochRef.current === sessionEpoch
            && activeSaveAccountKey() === accountKey;
    }
    function acceptExternalSaveVersion(incomingVersion: unknown, originatingAccount: string): "accepted" | "stale" | "foreign" {
        const accountKey = saveConflictAccountKey(originatingAccount);
        if (!accountKey || accountKey !== saveAuthorityAccountKeyRef.current || activeSaveAccountKey() !== accountKey) return "foreign";
        const previousVersion = latestSaveVersionRef.current, decision = acceptVersionedSnapshot(previousVersion, incomingVersion);
        if (!decision.accepted) return "stale"; if (decision.latestVersion > previousVersion) savePersistenceRef.current?.invalidateAuthority();
        latestSaveVersionRef.current = decision.latestVersion; return "accepted";
    }
    function capturePvpCreateScope(accountName: string): { signal: AbortSignal; isCurrent: () => boolean } {
        const accountKey = saveConflictAccountKey(accountName);
        const sessionEpoch = saveSessionEpochRef.current;
        const controller = pvpCreateScopeAbortRef.current;
        return {
            signal: controller.signal,
            isCurrent: () => controller === pvpCreateScopeAbortRef.current
                && !controller.signal.aborted
                && isCurrentSaveSession(accountKey, sessionEpoch),
        };
    }
    async function adoptOwnSaveRead(anchor: OwnSaveReadAnchor, settledCharacter: Character | null | undefined, settledVersion: unknown): Promise<OwnSaveReadResult> {
        if (settledCharacter && saveConflictAccountKey(settledCharacter.name) !== anchor.accountKey) return "foreign";
        // Callers preload this rare reconciliation chunk before starting the GET.
        const runtime = settledCharacter ? await loadOwnSaveRead() : null;
        const result = acceptExternalSaveVersion(settledVersion, anchor.accountName); if (result !== "accepted") return result;
        if (settledCharacter && runtime) setCharacter(current => runtime.reconcileOwnSaveReadVitals(current, anchor, settledCharacter));
        return "accepted";
    }
    function commitVersionedCharacter(nextCharacter: Character, incomingVersion: unknown): boolean {
        const accountKey = saveConflictAccountKey(nextCharacter.name);
        if (!accountKey || accountKey !== saveAuthorityAccountKeyRef.current || accountKey !== activeSaveAccountKey()) return false;
        const decision = acceptVersionedSnapshot(latestSaveVersionRef.current, incomingVersion);
        if (!decision.accepted) return false; latestSaveVersionRef.current = decision.latestVersion;
        savePersistenceRef.current?.invalidateAuthority();
        savePayloadRevisionRef.current = nextSavePayloadRevision(savePayloadRevisionRef.current);
        const current = latestSaveRef.current;
        if (current && saveConflictAccountKey(current.name) === accountKey) installAuthoritativeSaveRef({ ...current, revision: savePayloadRevisionRef.current, payload: { ...current.payload, character: nextCharacter } });
        setCharacter(nextCharacter); return true;
    }
    const {
        endlessFight,
        startEndlessBattle,
        settleEndlessFight,
        nextEndlessWave,
        bankEndlessRewards,
        closeEndlessFight,
    } = useEndlessTowerActions({
        character,
        commitCharacter: (next, version) => {
            commitVersionedCharacter(next, version);
        },
    });
    useEffect(() => { setEndlessBattleActive(Boolean(endlessFight)); }, [endlessFight]);
    const starterPetCommitRef = useRef<{ accountName: string; promise: Promise<boolean> } | null>(null);
    useEffect(() => {
        const onSaveVersion = (event: Event) => {
            const detail = (event as CustomEvent<Partial<SaveVersionEventDetail>>).detail, version = Number(detail?.version);
            if (!Number.isFinite(version) || version <= 0) return;
            if (detail.source !== "full-save" && typeof detail.accountName === "string") acceptExternalSaveVersion(version, detail.accountName);
        };
        window.addEventListener(SAVE_VERSION_EVENT, onSaveVersion); return () => window.removeEventListener(SAVE_VERSION_EVENT, onSaveVersion);
    }, []);
    const [saveConflictDraft, setSaveConflictDraft] = useState<SaveConflictDraft | null>(null);
    const saveConflictStoreRef = useRef<ReturnType<typeof createSaveConflictDraftStore> | null>(null);
    const saveFlightRef = useRef(createSaveFlightCoordinator());
    // #23: surface a banner when a save is persistently rejected (a payload too
    // large [413] or a sustained 5xx) so the player knows before they refresh —
    // persistSave otherwise retries silently forever. Cleared on the next success.
    const saveFailCountRef = useRef(0);
    const [saveBlocked, setSaveBlocked] = useState(false);
    const savePersistenceRef = useRef<ReturnType<typeof createSavePersistence<ReturnType<typeof buildPlayerSavePayload>>> | null>(null);

    function activeSaveAccountKey(): string {
        return saveConflictAccountKey(currentAccountNameRef.current || characterRef.current?.name || "");
    }
    function reportConflictStorageFailure(error: unknown): void {
        // Never interrupt a battle with a storage alert. The in-memory copy and
        // banner remain usable for the current session.
        console.warn("[save-conflict] Browser storage unavailable; recovery remains in memory.", error);
    }

    if (!saveConflictStoreRef.current) {
        saveConflictStoreRef.current = createSaveConflictDraftStore({
            storage: localStorage,
            activeAccountKey: activeSaveAccountKey,
            onVisibleDraft: setSaveConflictDraft,
            reportStorageFailure: reportConflictStorageFailure,
        });
    }
    // The recovery BANNER was removed (see the note on setSaveConflictDraft): the
    // capture/rehydrate machinery still protects and settles drafts silently, so
    // these stay wired; only the player-facing surface is gone.
    const captureSaveConflictDraft = saveConflictStoreRef.current.capture;
    const discardSaveConflictRevision = saveConflictStoreRef.current.discard;
    const rehydrateSaveConflictDraft = saveConflictStoreRef.current.rehydrate;
    if (!savePersistenceRef.current) {
        savePersistenceRef.current = createSavePersistence({
            flight: saveFlightRef.current,
            latestVersion: latestSaveVersionRef,
            latestPayloadRevision: savePayloadRevisionRef,
            dirty: charDirtyRef,
            failureCount: saveFailCountRef,
            isCurrentSession: isCurrentSaveSession,
            currentSessionEpoch: () => saveSessionEpochRef.current,
            captureConflict: captureSaveConflictDraft,
            currentSnapshot: () => latestSaveRef.current,
            installSnapshot: installAuthoritativeSaveRef,
            onConflictSnapshot: (snapshot) => applyServerSnapshot(snapshot),
            writePreview: writeSavePreview,
            setBlocked: setSaveBlocked,
        });
    }
    useEffect(() => {
        if (!saveConflictDraft) return;
        const nextExpiry = Math.min(...saveConflictDraft.revisions.map((revision) => revision.expiresAt));
        const timer = window.setTimeout(
            () => { void rehydrateSaveConflictDraft(saveConflictDraft.accountName); },
            Math.max(0, nextExpiry - Date.now() + 50),
        );
        return () => window.clearTimeout(timer);
    }, [saveConflictDraft]);

    const persistSave = savePersistenceRef.current.persistAutosave;

    // Dirty-tracking: only auto-save when character state actually changed locally.
    // This prevents a second device (e.g. desktop) from continuously re-uploading the
    // snapshot it loaded from the server, which would overwrite progress made on the
    // primary device (e.g. mobile still in the village).
    //
    // How it works: we compare character object references (React immutable pattern).
    // Refs only change when setCharacter() is called with new data. After a server load
    // we seed prevCharRef so the load itself isn't counted as a local change.
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
    useJutsuTrainingQueueRunner(gameplayMutationsOpen ? character?.name ?? "" : "", activeJutsuTraining, setActiveJutsuTrainingNow, commitVersionedCharacter);

    useEffect(() => {
        if (!character || !currentAccountName) {
            latestSaveRef.current = null;
            savePayloadIdentityRef.current = null;
            return;
        }
        // Detect genuine local character changes (reference inequality = new React state).
        if (character !== prevCharRef.current) {
            charDirtyRef.current = true;
            prevCharRef.current = character;
        }
        const payloadIdentity: readonly unknown[] = [
            character,
            currentBiome,
            activeTraining,
            activeJutsuTraining,
            acceptedMissionIds,
            missionProgress,
            triggeredEvents,
            currentSector,
            pendingTravel,
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
            hollowGateEventConfig,
        ];
        const previousIdentity = savePayloadIdentityRef.current;
        if (!previousIdentity
            || previousIdentity.length !== payloadIdentity.length
            || payloadIdentity.some((value, index) => !Object.is(value, previousIdentity[index]))) {
            savePayloadRevisionRef.current = nextSavePayloadRevision(savePayloadRevisionRef.current);
            savePayloadIdentityRef.current = payloadIdentity;
        }
        latestSaveRef.current = {
            character,
            name: currentAccountName,
            payload: buildPlayerSavePayload(character),
            revision: savePayloadRevisionRef.current,
        };
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
        const sig = JSON.stringify([acceptedMissionIds, missionProgress, triggeredEvents, currentBiome, pendingTravel]);
        if (lastSnapshotMissionSigRef.current === sig) { lastSnapshotMissionSigRef.current = null; return; }
        charDirtyRef.current = true;
        if (pendingTravel) flushSaveRef.current = true;
    }, [acceptedMissionIds, missionProgress, triggeredEvents, currentBiome, pendingTravel, character, currentAccountName]);

    const saveSoonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useCapabilityGuardedAutosave({
        enabled: gameplayMutationsOpen,
        debounceTriggers: { character, accountName: currentAccountName, sector: currentSector, pendingTravel, missionBattleActive },
        intervalPresenceActive: isPresenceBattleActive(),
        immediateTriggers: { activeTraining, activeJutsuTraining, hospitalized: Boolean(character?.hospitalized), pendingTravel, missionProgress, missionBattleActive },
        debounceTimerRef: saveSoonTimerRef, dirtyRef: charDirtyRef, flushRef: flushSaveRef,
        latestSnapshotRef: latestSaveRef, mutationAvailability, isPresenceBattleActive, persistSave,
    });

    // Reflection log: merge onto the synchronous authoritative save ref after
    // claim projection, then require a durable exact-version save before ACK.
    const recordBattle = useCallback(async (entry: BattleHistoryEntry, continuation?: PvpRewardContinuationContext) => {
        if (!continuation) {
            setCharacter(prev => prev ? { ...prev, battleHistory: appendBattleHistory(prev.battleHistory, entry) } : prev);
            return;
        }
        if (continuation.signal.aborted || !continuation.isCurrentScope()) throw new DOMException("PvP completion scope changed.", "AbortError");
        const snapshot = latestSaveRef.current;
        if (!snapshot || saveConflictAccountKey(snapshot.name) !== activeSaveAccountKey()) {
            throw new Error("PvP battle history lost its account scope.");
        }
        const next = { ...snapshot.character, battleHistory: appendBattleHistory(snapshot.character.battleHistory, entry) };
        installAuthoritativeSaveRef({
            name: snapshot.name,
            revision: snapshot.revision,
            payload: { ...snapshot.payload, character: next },
        });
        const installed = latestSaveRef.current!.character;
        setCharacter(installed);
        await pushSaveToServer(installed, snapshot.name);
        if (continuation.signal.aborted || !continuation.isCurrentScope()) throw new DOMException("PvP completion scope changed.", "AbortError");
    }, []);

    // Save on page unload (F5 / tab close / navigation away) so that progress
    // made since the last auto-save is not lost.
    // keepalive: true tells the browser to complete the fetch even after the
    // page has been torn down. Auth headers are injected automatically by the
    // global authFetch interceptor (window.fetch is patched at app boot and
    // spreads all RequestInit properties — including keepalive — to the real fetch).
    // The 64 KB keepalive body limit is protected by stripping embedded image
    // data before serialising.
    useEffect(() => {
        function handleBeforeUnload() {
            const unloadAccountKey = activeSaveAccountKey();
            const unloadSessionEpoch = saveSessionEpochRef.current;
            protectSaveOnUnload({ dirty: charDirtyRef.current, flightBusy: saveFlightRef.current.busy(),
                accountKey: unloadAccountKey, sessionEpoch: unloadSessionEpoch, latestVersion: latestSaveVersionRef.current,
                unresolved: savePersistenceRef.current?.getUnresolvedPost() ?? null, liveSnapshot: latestSaveRef.current,
                captureConflict: captureSaveConflictDraft, discardRevision: discardSaveConflictRevision,
                isCurrentSession: isCurrentSaveSession,
                send: capabilityAdmissionAllowed(mutationAvailability()) });
        }
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [mutationAvailability]);

    async function createPlayerAccount(newCharacter: Character, credential: SignupCredential) {
        // CharacterCreator can remain open while capability truth changes. This
        // is the last client-side checkpoint before the registration POST, and it
        // guards three signup modes now rather than one: a Google or guest signup
        // is still a registration and is gated the same way.
        const currentRegistration = await settleAdmission(() => mutationAvailability("registrations"), refreshCapabilities);
        if (currentRegistration === "unavailable") {
            const gameplay = await settleAdmission(() => viewAvailability(), refreshCapabilities);
            alert(gameplay === "unavailable" ? playerLoginAdmissionMessage(gameplay) : registrationAdmissionMessage(currentRegistration));
            return;
        }
        const createLoad = beginSessionLoad(sessionLoadGenerationRef, newCharacter.name);
        // Registration gives us a useful network window to warm the cinematic
        // that appears immediately after the first save succeeds.
        void loadIntroCinematic().catch(() => {});
        const key = accountKey(newCharacter.name);
        const password = credential.mode === "password" ? credential.password : undefined;
        let regToken: string | undefined;
        try {
            const authRes = await sessionLoadFetch('/api/player-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(signupRequestBody(newCharacter.name, credential)),
            });
            if (!createLoad.isCurrent()) return;
            const regData = await authRes.json().catch(() => null) as { error?: string; token?: string; guestResume?: string } | null;
            if (!createLoad.isCurrent()) return;
            if (authRes.status === 409) {
                alert(regData?.error ?? "A player with that name already exists. Log in instead or choose another name.");
                return;
            }
            if (!authRes.ok) {
                alert(regData?.error ?? "Could not create the server account. Try again.");
                return;
            }
            // Capture the session token from registration so the first
            // requests use the cheap HMAC path right away.
            regToken = regData?.token ?? undefined;
            if (regToken) setActiveToken(regToken);
            // A guest has no password, so this credential is their only way back
            // in once the 24h token lapses. Nothing else recovers the character.
            if (credential.mode === "guest" && regData?.guestResume) {
                rememberGuestSession({ name: newCharacter.name, resume: regData.guestResume });
            }
            if (credential.mode === "google") forgetGoogleNonce();
        } catch {
            alert("Could not reach the server to create the account. Check your connection and try again.");
            return;
        }

        const accounts = loadPlayerAccounts();
        // No token = SESSION_SECRET unset server-side: the documented fallback,
        // not an error. Bailing here was the worst outcome — registration already
        // succeeded, so the name was permanently taken by an account that could
        // never be finished. Fall back to the password credential, as
        // reauthKeepState does. (To require tokens, enforce on the SERVER first.)
        accounts[key] = { ...(accounts[key] ?? {}), ...(regToken ? { token: regToken } : {}) };
        savePlayerAccounts(accounts);
        setActivePlayer(newCharacter.name, regToken ? null : password ?? null);

        // Race the avatar publish against 12s: registration has ALREADY
        // committed (name taken, credentials stored), so a stalled upload here
        // used to strand the creator on "Creating..." with an account the
        // player never got to enter. On timeout we enter without the portrait
        // — the publish keeps running and lands whenever it finishes, same as
        // the existing rejection fallback.
        const characterToCreate = await Promise.race([
            import("./features/character-creator/starterAvatarPublish").then(({ publishStarterAvatarForCharacter }) => publishStarterAvatarForCharacter(newCharacter, (id, image) => setSharedImages(prev => ({ ...prev, [id]: image })))).catch((error) => { console.warn("[createPlayerAccount] starter avatar publish failed", error); return newCharacter; }),
            new Promise<typeof newCharacter>((resolve) => window.setTimeout(() => resolve(newCharacter), 12_000)),
        ]);
        if (!createLoad.isCurrent()) return;
        scopeSaveAuthorityToAccount(characterToCreate.name);
        currentAccountNameRef.current = characterToCreate.name;
        setCurrentAccountName(characterToCreate.name); setCharacter(characterToCreate);
        void rehydrateSaveConflictDraft(characterToCreate.name);
        setCurrentBiome("central");
        setActiveTraining(null);
        setActiveJutsuTraining(null);
        setAcceptedMissionIds([]);
        setMissionProgress({});
        setTriggeredEvents([]);
        setPendingAiProfileId("");
        setCurrentSector(40);
        // Land directly on the village; the intro cinematic (gated on the fresh
        // save's onboardingStep === "academyIntro") plays as an overlay above it.
        setScreen("village");
        // Surface a failed FIRST save instead of swallowing it. A silent first-save
        // failure is the precondition for total character loss: the character lives
        // only in memory, and on the next refresh the login save-GET 404s and the
        // account gets cleared. The 3s autosave will also retry (charDirtyRef is set
        // by setCharacter above), but warn the player so they don't refresh on a
        // dropped connection before the retry lands.
        try {
            await pushSaveToServer(characterToCreate, characterToCreate.name);
            if (!createLoad.isCurrent()) return;
        } catch (err) {
            if (!createLoad.isCurrent()) return;
            console.error("[createPlayerAccount] first save failed", err);
            alert("Your character was created, but the first save to the server didn't go through. Keep this tab open — it will retry automatically. Don't refresh yet, or your new character could be lost.");
        }
        void pullSharedAdminContent();
    }

    // Apply a full server snapshot. `authoritative: false` = cache paint, skips conflict classification (see rehydrate).
    function applyServerSnapshot(snap: ReturnType<typeof buildPlayerSavePayload>, opts: { authoritative?: boolean } = {}): boolean {
        const snapshotAccountKey = saveConflictAccountKey(snap.character.name);
        const incomingSaveVersion = (snap as Record<string, unknown>)._saveVersion;
        if (saveAuthorityAccountKeyRef.current === snapshotAccountKey) {
            const decision = acceptVersionedSnapshot(latestSaveVersionRef.current, incomingSaveVersion);
            if (!decision.accepted) return false;
        }
        // Seed prevCharRef so the auto-save interval treats this load as clean —
        // same reasoning as applySnapshot above (prevent stale re-upload).
        const normalized = normalizeAdminCharacter(snap.character);
        mergeServerPendingWorldRewards(snap.character.name, (snap as Record<string, unknown>).pendingWorldRewards); // account-side outbox mirror → local drain
        savePersistenceRef.current?.invalidateAuthority();
        savePayloadRevisionRef.current = nextSavePayloadRevision(savePayloadRevisionRef.current);
        prevCharRef.current = normalized;
        charDirtyRef.current = false;
        scopeSaveAuthorityToAccount(snap.character.name);
        // Capture server-issued save version (for multi-tab clobber detection).
        if (typeof incomingSaveVersion === "number" && Number.isFinite(incomingSaveVersion)) {
            latestSaveVersionRef.current = adoptSaveVersion(latestSaveVersionRef.current, incomingSaveVersion);
        }
        currentAccountNameRef.current = snap.character.name;
        setCurrentAccountName(snap.character.name);
        setCharacter(normalized);
        if (opts.authoritative !== false) void rehydrateSaveConflictDraft(snap.character.name, snap);
        setCurrentBiome(snap.currentBiome ?? "central");
        setActiveTraining(snap.activeTraining ?? null);
        setActiveJutsuTraining(snap.activeJutsuTraining ?? null);
        setAcceptedMissionIds(snap.acceptedMissionIds ?? []);
        setMissionProgress(snap.missionProgress ?? {});
        setTriggeredEvents(snap.triggeredEvents ?? []);
        setPendingAiProfileId("");
        const snapPendingTravel = normalizePendingTravel((snap as Record<string, unknown>).pendingTravel);
        setPendingTravel(snapPendingTravel);
        setTravelingUntil(snapPendingTravel?.arrivalAt ?? 0);
        lastSnapshotMissionSigRef.current = JSON.stringify([snap.acceptedMissionIds ?? [], snap.missionProgress ?? {}, snap.triggeredEvents ?? [], snap.currentBiome ?? "central", snapPendingTravel]);
        applySnapshotSectorWithGuard(snap.currentSector ?? 40);
        if (snap.savedBloodlines) setSavedBloodlines(snap.savedBloodlines.map((bloodline: SavedBloodline) => ({ ...bloodline, jutsus: bloodline.jutsus.map(normalizeJutsu) })));
        if (snap.creatorJutsus) setCreatorJutsus(snap.creatorJutsus.map(normalizeJutsu));
        if (snap.creatorAis) setCreatorAis(balanceExistingAiProfiles(snap.creatorAis, savedJutsuPool(snap)));
        const contentAdmin = isContentAdminName(snap.character.name);
        if (snap.creatorEvents) setCreatorEvents(contentAdmin ? snap.creatorEvents : snap.creatorEvents.filter(isReleaseSafeClientEvent));
        setCreatorMissions(contentAdmin ? (snap.creatorMissions ?? []) : []);
        setCreatorRaids(contentAdmin ? (snap.creatorRaids ?? []) : []);
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
        installAuthoritativeSaveRef({ name: snap.character.name, payload: { ...snap, character: normalized }, revision: savePayloadRevisionRef.current });
        // Re-hydrate the active screen after login while keeping valid manifests.
        loadedCatsRef.current.clear();
        setTimeout(() => {
            void loadCategory('avatar');
            loadScreenImageCategories(screenRef.current);
        }, 0);
        return true;
    }

    /** Sign in with a token already in hand — Google, guest resume, or a remembered shinobi. */
    async function enterWithToken(name: string, token?: string, opts: { silentExpiry?: boolean } = {}) {
        if (token) { setActiveToken(token); rememberAccountToken(name, token); }
        return enterGameAsPlayer(name, beginSessionLoad(sessionLoadGenerationRef, name), undefined, opts);
    }

    /** One-click return for a shinobi this browser still holds a credential for. */
    async function continueRememberedAccount(name: string): Promise<void> {
        const stored = loadPlayerAccounts()[accountKey(name)]?.token;
        // A token past its own expiry can only ever 401. Re-installing it would
        // make the save pull fail and — before this guard — report itself as
        // "No save found for that name", which reads as the account being gone.
        // Treat a dead token as no credential at all and fall through.
        if (stored && isTokenExpired(stored)) forgetAccountToken(name);
        else if (stored) {
            // The server is the only authority on a token that still LOOKS
            // alive (a session-epoch rotation revokes one without touching its
            // expiry), so a 401 here is silenced and handled like a dead one.
            const outcome = await enterWithToken(name, stored, { silentExpiry: true });
            if (outcome !== "expired") return;
        }
        // A guest's token lapses after a day, but their resume credential is
        // good for two weeks — so this is still a one-click return for them.
        const guest = await resumeGuestFor(name, (a, b) => accountKey(a) === accountKey(b));
        if (guest) { await enterWithToken(guest.name, guest.token); return; }
        alert(SESSION_ENDED_MESSAGE);
    }

    async function loginPlayerAccount(name: string, password: string) {
        const currentAvailability = await settleAdmission(() => viewAvailability(), refreshCapabilities);
        if (currentAvailability === "unavailable") {
            alert(playerLoginAdmissionMessage(currentAvailability));
            return;
        }
        const loginLoad = beginSessionLoad(sessionLoadGenerationRef, name);

        // Always verify against the server first — this is the authoritative
        // check; localStorage only provides a fast-path pre-check.
        const verdict = await verifyPlayerCredentials(name, password, loginLoad.isCurrent);
        if (!loginLoad.isCurrent() || verdict.status === "superseded") return;
        if (verdict.status !== "ok") { alert(verdict.message); return; }
        // Store the session token so every later /api/ request uses the cheap
        // HMAC path instead of re-running scrypt server-side, and migrate this
        // account to token-only by dropping any password an older build left in
        // the local blob.
        if (verdict.token) {
            setActiveToken(verdict.token);
            rememberAccountToken(name, verdict.token);
        }
        await enterGameAsPlayer(name, loginLoad, password, { armPasswordFallback: !verdict.token });
    }

    // The second half of signing in: load the save and paint the game. Shared by
    // the password login, Google sign-in, guest resume, and picking a remembered
    // shinobi — all four are "we know who you are, now bring them in".
    async function enterGameAsPlayer(
        name: string,
        loginLoad: ReturnType<typeof beginSessionLoad>,
        password?: string,
        opts: { silentExpiry?: boolean; armPasswordFallback?: boolean } = {},
    ): Promise<SaveLoadFailure | "ok" | "superseded"> {
        // Prime the authFetch interceptor *before* the save GET fires.
        // Without this, the interceptor has no credentials and the backend
        // returns 401 — which this function used to mistranslate as "no save
        // found" (see the 401 branch below, which now says what really happened).
        // Arm the password ONLY when the server minted no token (SESSION_SECRET
        // unset); behind a live token setActiveToken drops it on purpose, so an
        // expiry surfaces the re-auth modal instead of reusing a stale password.
        setActivePlayer(name, opts.armPasswordFallback ? password : null);

        // Instant-paint from localStorage while the save fetch is in flight.
        // The cached preview is written on every successful server save (both
        // autosave paths) and after every applyServerSnapshot, so it mirrors
        // the most-recent known state. The real save will arrive within a
        // few seconds and applyServerSnapshot will reconcile any drift. Skip
        // silently if no cache exists (first-time login on this device), if the
        // cache's character.name doesn't match (handled inside readSavePreview),
        // or if it predates a schema change and throws.
        const cachedPreview = readSavePreview(name);
        if (cachedPreview && cachedPreview.character) {
            try { applyServerSnapshot(cachedPreview as ReturnType<typeof buildPlayerSavePayload>); } catch { /* stale schema */ }
        }

        // Always pull the full server save — this is where the real character
        // state lives. Retries once past a transient Supabase cold start.
        const saveRes = await fetchPlayerSave(name, loginLoad.isCurrent);
        if (!loginLoad.isCurrent()) return "superseded";
        if (!saveRes) {
            alert(SAVE_UNREACHABLE_MESSAGE);
            return "unreachable";
        }
        if (saveRes.ok) {
            const serverSnapshot = await saveRes.json() as ReturnType<typeof buildPlayerSavePayload>;
            if (!loginLoad.isCurrent() || saveConflictAccountKey(serverSnapshot.character.name) !== loginLoad.accountKey) return "superseded";
            applyServerSnapshot(serverSnapshot);
            void pullSharedAdminContent();
            return "ok";
        }
        const failure = saveLoadFailure(saveRes.status);
        if (failure === "expired") {
            // Drop the dead token — it can only keep 401-ing — and hand back a
            // login form that can actually let them in. Silent when the caller
            // still has a credential left to try: the remembered-shinobi chip
            // falls through to the guest resume after this.
            forgetAccountToken(name);
            setActivePlayer(null);
            unwindToLoginForm();
            if (!opts.silentExpiry) alert(SESSION_ENDED_MESSAGE);
        } else if (failure === "no-save") {
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
            // The session token authorises this too, so it works for an account
            // that has no password to send (Google sign-in, guest).
            const clearBody = { action: 'delete', name: name.trim().toLowerCase(), ...(password ? { password } : {}) };
            void fetch('/api/player-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clearBody) });
            unwindToLoginForm();
            alert(`No save data was found for "${name}". Your login lock has been cleared — please create a new character with the same name and password.`);
        } else {
            alert(SAVE_UNREACHABLE_MESSAGE);
        }
        return failure;
    }

    async function deleteCharacter() {
        if (!character) return;
        if (!(await gameConfirm(`Delete "${character.name}"? This permanently removes your character and all save data. This cannot be undone.`, { title: "Delete Character", confirmLabel: "Delete", danger: true }))) return;
        const accountName = currentAccountName || character.name;
        // Masked, themed field — never window.prompt, which shows the password in
        // clear text. Cancel resolves null and is a silent bail-out; only an empty
        // submit is worth an error.
        const entered = await gamePasswordPrompt(
            `Enter your password to permanently delete "${accountName}" from the server.`,
            { title: "Confirm Deletion", confirmLabel: "Delete Forever", danger: true },
        );
        if (entered === null) return;
        const localPw = entered.trim();
        if (!localPw) {
            alert("Password required to delete a server account.");
            return;
        }
        // BOTH the save and the auth record must be gone before we forget the
        // account locally — see deleteServerAccount. Bail out with everything
        // intact if either half fails, rather than orphaning the name.
        const deletion = await deleteServerAccount(accountName, localPw);
        if (!deletion.ok) return alert(DELETE_ACCOUNT_ERRORS[deletion.reason]);
        const accounts = loadPlayerAccounts();
        delete accounts[accountKey(accountName)]; savePlayerAccounts(accounts); endLocalSession();
    }

    // Tear the session down and return to login. Shared by logout and account
    // deletion. setActivePlayer(null) is load-bearing — it clears the persisted
    // password + token (the sync effect only ever passes "", never null).
    function endLocalSession() {
        // Clear the in-memory battle identity before another account can load.
        // Otherwise the persistence effect could re-stamp A's unresolved battle
        // with B's owner after the character state changes.
        clearPvpBattleState();
        sessionLoadGenerationRef.current += 1;
        currentAccountNameRef.current = "";
        resetSaveAuthorityScope();
        setSaveConflictDraft(null);
        setCharacter(null);
        setCurrentAccountName("");
        setActivePlayer(null);
        setActiveTraining(null);
        setActiveJutsuTraining(null);
        setAcceptedMissionIds([]);
        setMissionProgress({});
        setTriggeredEvents([]);
        setPendingAiProfileId("");
        setCurrentSector(40);
        setActiveTriggeredEvent(null);
        setScreen("start");
    }

    // "Logout + Save" must FINISH the save before tearing the session down —
    // clearing the character (and its auth token) first lost the last chunk of
    // progress. On save failure, offer to stay logged in.
    async function logoutPlayer() {
        if (character) {
            try {
                const accountName = currentAccountName || character.name;
                await pushSaveToServer(character, accountName, undefined, { useLatestAtExecution: true });
                if (charDirtyRef.current && latestSaveRef.current) {
                    await pushSaveToServer(latestSaveRef.current.character, accountName, undefined, { useLatestAtExecution: true });
                }
                if (charDirtyRef.current) throw new Error("The save changed while logout was finishing.");
            } catch {
                charDirtyRef.current = true;
                if (!(await gameConfirm("Your progress could not be saved to the server. Logging out now will lose everything since your last successful save. Log out anyway?", { title: "Save Failed", confirmLabel: "Log out anyway", danger: true }))) return;
            }
        }
        endLocalSession();
    }

    async function recordBuiltInMissionProgress(
        playerName: string,
        missionId: string,
        kind: "field-explore" | "field-raid" | "hunt-track" | "hunt-kill",
        worldExploreRequestId?: string,
        authoritativeRunId?: string,
    ): Promise<boolean> {
        if (!playerName) return false;
        const expectedOwnerKey = playerSlug(playerName);
        let runId = authoritativeRunId ?? characterRef.current?.serverFieldMissionRuns?.[missionId]?.runId ?? "";
        if (kind === "field-explore" && !runId) {
            const state = await postFieldTrail({ playerName, missionId, action: "state" });
            if (!state.ok || !state.state?.runId || !state.character) return false;
            if (playerSlug(characterRef.current?.name ?? "") !== playerSlug(playerName)) return false;
            if (!commitVersionedCharacter(state.character, state._saveVersion)) return false;
            if (state.acceptedMissionIds) setAcceptedMissionIds(state.acceptedMissionIds);
            if (state.missionProgress) setMissionProgress(state.missionProgress);
            runId = state.state.runId;
        }
        try {
            const response = await fetch("/api/missions/record-progress", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    playerName,
                    missionId,
                    kind,
                    ...(runId ? { runId } : {}),
                    ...(worldExploreRequestId ? { worldExploreRequestId } : {}),
                }),
            });
            const result = await response.json().catch(() => null) as {
                recorded?: boolean;
                progress?: { exploreCount?: number; raidCount?: number };
            } | null;
            if (!response.ok || result?.recorded !== true || typeof result.progress?.exploreCount !== "number") return false;
            if (playerSlug(characterRef.current?.name ?? "") !== expectedOwnerKey) return false;
            const raidProgressKey = typeof result.progress.raidCount === "number"
                ? (await loadMissionCatalog()).missionRaidProgressKey(missionId)
                : "";
            if (playerSlug(characterRef.current?.name ?? "") !== expectedOwnerKey) return false;
            setMissionProgress((current) => ({
                ...current,
                [missionId]: result.progress!.exploreCount!,
                ...(raidProgressKey
                    ? { [raidProgressKey]: result.progress!.raidCount! }
                    : {}),
            }));
            return true;
        } catch {
            // Stable explore receipt retries from WorldMap recovery.
            return false;
        }
    }

    async function recordMissionExplore(sector: number, worldExploreRequestId: string, fieldProgress?: FieldExploreProgress[]): Promise<boolean> {
        const owner = characterRef.current?.name ?? "";
        if (!owner) return false;
        const expectedOwnerKey = playerSlug(owner);
        if (fieldProgress) {
            const credited = fieldProgress.filter((entry) => entry.missionId && entry.runId && Number.isFinite(entry.exploreCount));
            if (credited.length) {
                setAcceptedMissionIds((current) => [...new Set([...current, ...credited.map((entry) => entry.missionId)])]);
                setMissionProgress((current) => Object.fromEntries([
                    ...Object.entries(current),
                    ...credited.map((entry) => [entry.missionId, Math.max(0, Math.floor(entry.exploreCount))]),
                ]));
            }
            return true;
        }
        const missionCatalog = await loadMissionCatalog().catch(() => null);
        if (!missionCatalog || playerSlug(characterRef.current?.name ?? "") !== expectedOwnerKey) return false;
        const { builtinFetchMissions } = missionCatalog;
        const candidates = builtinFetchMissions.filter((mission) =>
            mission.type === "fetchExplore" &&
            !mission.id.startsWith("hunt-") &&
            mission.targetSector === sector
        );
        if (candidates.length === 0) return true;
        // Local accepted ids may be stale on a second device. Ask the server for
        // every built-in field contract targeting this tile; state:null is a
        // definitive inactive run, while transport/5xx remains retryable and
        // keeps the stable World explore operation parked.
        const activeRuns: Array<{ missionId: string; runId: string }> = [];
        for (const mission of candidates) {
            const state = await postFieldTrail({ playerName: owner, missionId: mission.id, action: "state" });
            if (!state.ok) return false;
            if (playerSlug(characterRef.current?.name ?? "") !== expectedOwnerKey) return false;
            if (state.character) commitVersionedCharacter(state.character, state._saveVersion);
            if (state.acceptedMissionIds) setAcceptedMissionIds(state.acceptedMissionIds);
            if (state.missionProgress) setMissionProgress(state.missionProgress);
            if (state.state?.runId) activeRuns.push({ missionId: mission.id, runId: state.state.runId });
        }
        if (activeRuns.length === 0) return true;
        const acknowledgements = await Promise.all(activeRuns.map(({ missionId, runId }) =>
            recordBuiltInMissionProgress(owner, missionId, "field-explore", worldExploreRequestId, runId)));
        return acknowledgements.every(Boolean);
    }

    const appliedRaidReportUiRef = useRef(new Set<string>());

    async function mirrorExactRaidMissionCredits(
        missionIds: readonly string[],
        expectedOwnerKey: string,
        continuation?: PvpRewardContinuationContext,
    ) {
        const requireCurrentOwner = () => {
            const current = !!expectedOwnerKey && playerSlug(characterRef.current?.name ?? "") === expectedOwnerKey;
            if (continuation && (continuation.signal.aborted || !continuation.isCurrentScope() || !current)) {
                throw new DOMException("PvP completion scope changed.", "AbortError");
            }
            return current;
        };
        if (!requireCurrentOwner()) return;
        for (const missionId of [...new Set(missionIds)]) {
            if (!missionId) continue;
            const state = await postFieldTrail({
                playerName: characterRef.current?.name ?? "",
                missionId,
                action: "state",
            }, continuation?.signal);
            if (!requireCurrentOwner()) return;
            if (!state.ok) {
                if (continuation) throw new Error(state.error || "Raid mission projection could not be confirmed.");
                continue;
            }
            if (state.character && !commitVersionedCharacter(state.character, state._saveVersion)) {
                if (continuation) throw new Error("Raid mission save projection became stale.");
                continue;
            }
            if (!requireCurrentOwner()) return;
            if (state.acceptedMissionIds) setAcceptedMissionIds(state.acceptedMissionIds);
            if (!requireCurrentOwner()) return;
            if (state.missionProgress) setMissionProgress(state.missionProgress);
        }
    }

    async function applyRaidReportDrain(
        result: RaidReportDrainResult,
        continuation?: PvpRewardContinuationContext,
    ): Promise<void> {
        const ownerKey = playerSlug(result.playerName);
        const requireCurrentOwner = () => {
            const current = playerSlug(characterRef.current?.name ?? "") === ownerKey;
            if (continuation && (continuation.signal.aborted || !continuation.isCurrentScope() || !current)) {
                throw new DOMException("PvP completion scope changed.", "AbortError");
            }
            return current;
        };
        if (!ownerKey || playerSlug(characterRef.current?.name ?? "") !== ownerKey) return;
        for (const acknowledged of result.acknowledgements) {
            if (!requireCurrentOwner()) return;
            if (appliedRaidReportUiRef.current.has(acknowledged.entry.battleId)) continue;
            if (acknowledged.character) {
                commitVersionedCharacter(acknowledged.character, acknowledged.saveVersion);
            }
            if (acknowledged.territoryDamage > 0) {
                await refreshWorldStateSnapshot(continuation);
                if (!requireCurrentOwner()) return;
            }
            await mirrorExactRaidMissionCredits(acknowledged.fetchMissionsCredited, ownerKey, continuation);
            if (!requireCurrentOwner()) return;
            for (const mission of acknowledged.missionsCompleted) {
                if (!requireCurrentOwner()) return;
                window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                    detail: { name: mission.name, xp: mission.xpReward, profession: 'vanguard' },
                }));
            }
            if (!requireCurrentOwner()) return;
            appliedRaidReportUiRef.current.add(acknowledged.entry.battleId);
        }
    }

    async function recordMissionRaid(
        _sector: number,
        battleId?: string,
        serverCreditedMissionIds?: readonly string[],
        expectedPlayerName = "",
        continuation?: PvpRewardContinuationContext,
    ): Promise<void> {
        const expectedOwnerKey = playerSlug(expectedPlayerName);
        const requireCurrentOwner = () => {
            const current = playerSlug(characterRef.current?.name ?? "") === expectedOwnerKey;
            if (continuation && (continuation.signal.aborted || !continuation.isCurrentScope() || !current)) {
                throw new DOMException("PvP completion scope changed.", "AbortError");
            }
            return current;
        };
        if (!expectedOwnerKey || !requireCurrentOwner()) return;

        // report-ai-fight already stamped these exact server-owned runs. Never
        // infer eligibility from the local accepted list (Apex returns none).
        if (serverCreditedMissionIds) {
            await mirrorExactRaidMissionCredits(serverCreditedMissionIds, expectedOwnerKey, continuation);
            requireCurrentOwner();
            return;
        }

        // The remaining lane is a real PvP raid carrying its server battle id.
        if (!battleId) return;
        const owner = expectedPlayerName;
        enqueueRaidReport(owner, battleId, _sector);
        requireCurrentOwner();
        const result = await flushRaidReportOutbox(owner, undefined, postPvpRaidReport, continuation?.signal);
        requireCurrentOwner();
        const acknowledgement = requireRaidReportAcknowledgement(result, battleId);
        await applyRaidReportDrain({ playerName: owner, acknowledgements: [acknowledgement] }, continuation);
        requireCurrentOwner();
    }

    // Replays a lost PvP-raid ACK on login and whenever connectivity returns.
    // The outbox is account-keyed and applyRaidReportDrain fences again before
    // touching character or mission presentation state.
    useEffect(() => {
        const owner = character?.name;
        if (!gameplayMutationsOpen || !owner) return;
        let active = true;
        const drain = () => void flushRaidReportOutbox(owner).then((result) => {
            if (active && result) void applyRaidReportDrain(result);
        });
        drain();
        window.addEventListener("online", drain);
        return () => {
            active = false;
            window.removeEventListener("online", drain);
        };
    }, [character?.name, gameplayMutationsOpen]);

    // Purge pre-cutover Arena story context after boot has had one chance to
    // route it to a sealed host. Current fights never persist browser authority.
    useEffect(() => {
        const name = character?.name;
        if (!name) return;
        try { localStorage.removeItem(arenaStoryCtxKey(name)); } catch { /* private mode */ }
    }, [character?.name]);

    const { canGoBack, goBack, inBattleRef } = useBattleNavigationGuard({
        screen, screenRef, setScreen, hospitalized: !!character?.hospitalized, fallbackScreen: () => safeFallbackScreen(isWildSector(currentSectorRef.current)),
        raidBattleKind, pvpBattleId, pvpBattleResolved: pvpCompletionConfirmed, endlessBattleActive,
        pendingArenaStoryBattle: !!pendingArenaStoryBattle,
        pendingEventEncounter: !!pendingEventEncounter,
        activeDungeonEvent: !!activeDungeonEvent,
        hollowGateTileGameActive,
        pendingPetBattle: !!pendingPetBattleOpponent,
        arenaBattleActive: false, petBattleActive, missionBattleActive,
    });

    // Stable identities for the memo'd RightMenu/MobileNav: navigate/logoutPlayer get a
    // fresh identity each render, defeating their memo. These latest-ref wrappers delegate
    // to the current fn — stable identity, no stale closure, behavior identical.
    const navigateRef = useRef(navigate);
    navigateRef.current = navigate;
    const stableNavigate = useCallback((nextScreen: Screen) => navigateRef.current(nextScreen), []);
    const logoutPlayerRef = useRef(logoutPlayer);
    logoutPlayerRef.current = logoutPlayer;
    // logoutPlayer is async (it awaits the final save); the menu props take a
    // plain `() => void`. It reports its own failures to the player.
    const stableLogout = useCallback(() => { void logoutPlayerRef.current(); }, []);

    function navigate(nextScreen: Screen, authoritativeCharacter?: Character) {
        const currentVillageWarAvailability = viewAvailability("villageWar");
        if (!villageWarScreenMountAllowed(nextScreen, currentVillageWarAvailability)) {
            alert(sectorMapAdmissionMessage(currentVillageWarAvailability));
            return;
        }
        // Lock: cannot leave during an active battle (any type — isUnresolvedBattle).
        if (inBattleRef.current) {
            alert("⚔️ You cannot leave during a battle. Finish the fight first!");
            return;
        }
        // Lock: cannot leave hospital while still admitted
        if (isHospitalNavigationBlocked(!!(authoritativeCharacter ?? character)?.hospitalized, screen, nextScreen)) {
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

        if (character && screen === "village" && nextScreen !== "village" && normalizeOnboardingStep(character.onboardingStep) === "done") {
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
        perfNotifyScreen(nextScreen);
        preloadScreen(nextScreen, character?.storyVillage || character?.village);
        setScreen(nextScreen);
    }

    async function completeTriggeredEvent(event: CreatorEvent) {
        if (character) {
            // Interludes: a made choice consumes the beat (persisted) and reports
            // to the server story record; closing without choosing only dismisses
            // it for this session so a refresh re-offers the scene.
            if (event.id.startsWith("story-interlude-")) {
                void loadStoryTrigger().then(async ({ interludeChosenTrait, reportStoryInterlude }) => {
                    const resolved = await resolveStoryContinuation(() => interludeChosenTrait(character, event.id), character.name, () => currentAccountNameRef.current || characterRef.current?.name || "");
                    if (!resolved.current) return;
                    if (resolved.value) {
                        void reportStoryInterlude(character, event.id);
                        setTriggeredEvents(ids => ids.includes(event.id) ? ids : [...ids, event.id]);
                    } else {
                        dismissedStoryScenesRef.current.add(event.id);
                    }
                }).catch(() => undefined);
            }
            if (event.id === AURA_SPHERE_VN_ID) {
                const claimed = await claimBuiltinEventReward(character.name, event.id);
                if (!claimed.character) {
                    alert(claimed.error || "The Aura Sphere could not be claimed. Try again in a moment.");
                    return;
                }
                commitVersionedCharacter(claimed.character, claimed._saveVersion);
            }
            // No kageFinale handling here: closing the finale VN without fighting
            // must NOT unlock the Kage system or grant the title. Only sealed
            // story-boss settlement may unlock it.
        }

        setActiveTriggeredEvent(null);
        setScreen(activeTriggerReturnScreen);
    }

    function dungeonEventTemplate() {
        return creatorEvents.find((event) => event.id === DUNGEON_VN_ID) ?? hiddenDungeonVnEvent;
    }

    async function triggerDungeonEncounter(returnScreen: Screen = "worldMap", dungeonOverride?: CreatorEvent, freeRunToken = "") {
        if (!character || dungeonActionRef.current) return;
        const event = dungeonOverride ?? dungeonEventTemplate();
        if (character.level < event.levelReq) return;
        // The explore-tile Hidden Dungeon (no override) is free to enter; only the
        // Central Hub relic dungeons (passed as an override) stay gated behind a key.
        if (dungeonOverride) {
            if (!character.activeDungeonRun?.token && !ownsItem(character, DUNGEON_KEY_ID)) return alert("You need a Dungeon Key to open this relic dungeon.");
            dungeonActionRef.current = true;
            try {
                const result = await mutateDungeonRunServer(character.name, "start");
                if (!commitVersionedCharacter(result.character, result._saveVersion)) return;
                setActiveDungeonRunToken(result.token);
            } catch (error) {
                alert(error instanceof Error ? error.message : "The dungeon seal is unavailable.");
                return;
            } finally {
                dungeonActionRef.current = false;
            }
        } else {
            if (!freeRunToken) return;
            setActiveDungeonRunToken(freeRunToken);
        }
        setActiveDungeonEvent(event);
        setDungeonLine(0);
        setDungeonReturnScreen(returnScreen);
        setScreen("dungeon");
    }

    function startDungeonAiFight() {
        if (!character || !activeDungeonEvent) return;
        const runToken = activeDungeonRunToken ?? character.activeDungeonRun?.token;
        if (!runToken) return alert("The Dungeon run seal is missing. Reopen this dungeon from its authoritative entrypoint.");
        setCurrentBiome(activeDungeonEvent.biome);
        setCurrentWeather(weatherForBiome(activeDungeonEvent.biome));
        if (!requestAiFight({
            // Presentation placeholder only. The start endpoint ignores it and
            // reconstructs the exact 50/75/100 Warden from the active run.
            opponentId: "dungeon-warden",
            opponentLevel: character.level,
            battleKind: "dungeon",
            dungeonRunToken: runToken,
            enemyAvatar: resolveDungeonWardenPortrait(activeDungeonEvent, sharedImages),
            returnScreen: "dungeon",
            onResolved: (result) => {
                if (result.outcome === "win" && result.character?.activeDungeonRun?.wardenDefeated) {
                    setDungeonLine(0);
                }
            },
        })) alert("The sealed Dungeon arena is unavailable. The run remains reserved.");
    }

    // Onboarding "guaranteed first win" — a scripted spar against a deliberately
    // weak Lv-1 training dummy (lib/academy-spar), which the player beats in a
    // few hits. The win advances onboardingStep -> "cafeteria"; a loss returns to
    // the village and re-prompts via the OnboardingCoach's Hospital step.
    //
    // The SEALED server fight (api/story/spar-start) is hosted by
    // StoryBossFightHost like every other story-lane bout. A failed start remains
    // fail-closed; the client never recreates the dummy or resolves the fight.
    function startAcademySparringMatch() {
        if (!character) return;
        requestStoryBossFight({
            kind: "academySpar",
            bossName: "Academy Training Dummy",
            bossPortrait: academyTrainingDummyImg,
        });
    }

    async function leaveDungeon() {
        const current = character;
        const token = activeDungeonRunToken;
        if (current && token && !dungeonActionRef.current) {
            dungeonActionRef.current = true;
            try {
                const result = await mutateDungeonRunServer(current.name, "abandon", token);
                commitVersionedCharacter(result.character, result._saveVersion);
            } catch {
                gameToast("The dungeon run remains reserved so it can be resumed safely.");
            } finally {
                dungeonActionRef.current = false;
            }
        }
        setActiveDungeonRunToken(null);
        setActiveDungeonEvent(null);
        setDungeonLine(0);
        setTemporaryStoryAi(null);
        setPendingArenaStoryBattle(null);
        setPendingAiProfileId("");
        setScreen(dungeonReturnScreen);
    }

    // (failDungeon lived here — the loss path for the dungeon Warden fight when
    // the browser-side Arena reducer hosted it. Warden fights are sealed
    // Solo-PvE now and a defeat settles server-side in
    // api/missions/report-ai-fight.ts via applyDungeonWardenSettlement, which
    // owns the run token. leaveDungeon() above still covers a manual exit.)

    async function completeDungeon() {
        if (!character || !activeDungeonEvent || dungeonActionRef.current) return;
        const token = activeDungeonRunToken;
        if (!token) {
            alert("The dungeon reward could not be verified. Return to the map and discover a new seal.");
            return;
        }
        dungeonActionRef.current = true;
        try {
            const result = await mutateDungeonRunServer(character.name, "settle", token);
            commitVersionedCharacter(result.character, result._saveVersion);
        } catch (error) {
            alert(error instanceof Error ? error.message : "The dungeon reward could not be verified.");
            return;
        } finally {
            dungeonActionRef.current = false;
        }
        setActiveDungeonRunToken(null);
        alert(`${activeDungeonEvent.name} cleared. +10 Bone Charms, +5 Aura Stones, +5 Fate Shards, +1 Dungeon Legendary Relic.`);
        setActiveDungeonEvent(null);
        setScreen(dungeonReturnScreen);
    }

    // Server-authoritative story boss settle effects (fight runs inside StoryHall
    // as a sealed Tower session): adopt the server character + App-scope finale wiring.
    function handleServerStoryBossSettled(result: StoryBossSettleResult) {
        if (!result.character) return;
        const accepted = commitVersionedCharacter(result.character, result._saveVersion);
        if (result.finale && !result.replayed) {
            const finaleCharacter = accepted ? result.character : characterRef.current;
            if (!finaleCharacter
                || saveConflictAccountKey(finaleCharacter.name) !== saveConflictAccountKey(result.character.name)) return;
            unlockVillageKageSystem(finaleCharacter.storyVillage || finaleCharacter.village, finaleCharacter.name);
            void loadStoryTrigger().then((m) => { storyEpilogueRef.current.queued = m.selectStoryEpilogueEvent(finaleCharacter, storyEpilogueRef.current.lane); }).catch(() => undefined);
        }
    }

    function startTriggeredEventArenaBattle(
        event: CreatorEvent,
        battle?: NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>[number]["battle"],
        // Explicit return target for same-tick callers (WorldMap road events):
        // reading activeTriggerReturnScreen here would see the stale pre-set value.
        returnScreen?: Screen,
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
        // Story CHAPTER battles (not interludes/roads) = the Story Hall milestone → the
        // SEALED server session via the shared host (the only path persisting
        // storyProgress). Replayed past chapters keep the flavor Arena.
        const chapterIdx = /^story-(?!interlude-|road-)[a-z0-9-]+?-(\d+)$/.exec(event.id)?.[1];
        if (battle && chapterIdx !== undefined && Number(chapterIdx) === (character?.storyProgress ?? -1)) {
            const started = requestStoryBossFight({
                bossName: battle.bossName || event.name,
                chapterLabel: `Chapter ${Number(chapterIdx) + 1} — ${event.vnTitle ?? event.name}`,
                backdropImage: sharedImages[`event:${event.id}:bg`] || sharedImages[`vn:${event.id}:page:0`] || undefined,
                bossPortrait: sharedImages[`event:${event.id}:avatar`] || sharedImages[`vn:${event.id}:page:0:right`] || undefined,
                ...extractStoryFightScript(event.vnPages, battle.bossName || ""),
                ally: extractMentorLines(event.vnPages, battle.bossName || "", character?.name ?? ""), village: event.village || character?.village,
            });
            if (started) { setActiveTriggeredEvent(null); return; }
        }
        const returnTarget = returnScreen ?? activeTriggerReturnScreen;
        const opponent = creatorEventPracticeOpponent(event.aiProfileId, battle?.aiProfileId, character?.level ?? event.levelReq);
        if (!requestAiFight({
            opponentId: opponent.id,
            opponentLevel: Math.max(1, character?.level ?? event.levelReq),
            battleKind: "practice",
            returnScreen: returnTarget,
            onResolved: (result) => {
                // Practice has no event payout. A verified win only continues
                // presentation; loss/forfeit leaves the VN available to retry.
                if (result.outcome === "win") {
                    setActiveTriggeredEvent((current) => current?.id === event.id ? null : current);
                }
            },
        })) return alert("The sealed practice arena is unavailable. Your event remains open.");
        setCurrentBiome(event.biome);
        setCurrentWeather(weatherForBiome(event.biome));
    }

    // (completePendingArenaStoryBattle / continuePendingArenaStoryBattle lived
    // here. They existed only to settle a story fight hosted by the browser-side
    // Arena reducer, which is deleted — story fights run on StoryBossFightHost
    // and settle through /api/story/settle. The former was already a bare throw.)

    // ── Hollow Gate Shrine — actions ──────────────────────────────────────────
    function pushHollowGateLog(line: string) {
        setHollowGateLog(prev => [line, ...prev].slice(0, 30));
    }
    function isActivePetEligibleForHollowGate(): boolean {
        if (!character) return false;
        const pet = activeCarriedPets<Pet>(character).find(p => p.id === character.activePetId);
        if (!pet) return false;
        if (isPetOnExpedition(pet)) return false;
        return Boolean(pet.unlockedForPve);
    }
    // buildHollowGateRunFromStart moved verbatim to lib/hollow-gate-run-build.ts
    // (it closed over nothing App owns). Its callers below now handle the
    // rejection its on-demand generator import can produce.
    async function enterHollowGateShrine(eventCfg?: HollowGateEventConfig) {
        if (!requireServerSettlement("hollowGateRun")) return;
        if (!character) return;
        // Event gates reshape the run (fewer floors / smaller board / bespoke
        // boss) and may relax the entry gates; the standard shrine when absent.
        const variant = eventCfg ? variantFromEventConfig(eventCfg) : undefined;
        const gateName = eventCfg?.label || (eventCfg ? "Event Gate" : "Hollow Gate Shrine");
        // If the start response or first browser save was interrupted, replay
        // the exact request marker. This neither spends a second key nor bumps
        // the daily count; the start endpoint returns the durable original run.
        if (!character.hollowGateRun && character.lastHollowGateStart?.requestId) {
            const pending = character.lastHollowGateStart;
            const recovered = await startHollowGateServerRun(
                character.name,
                hollowGateRunMaxFloor({ variant }),
                variant?.id,
                pending.requestId,
            );
            if (!recovered?.token || recovered.token !== pending.token) {
                alert("Your paid Hollow Gate start could not be recovered safely. No new key was spent; retry after reconnecting.");
                return;
            }
            const recoveredBase = recovered.character ?? character;
            const run = await buildHollowGateRunFromStart(recovered, variant, recoveredBase).catch(() => null);
            if (!run) {
                alert(HOLLOW_GATE_FLOOR_LOAD_FAILED);
                return;
            }
            const floorSeal = await sealHollowGateFloor(character.name, recovered.token, run);
            setHollowGateRun(run);
            setHollowGateLog([
                "You recover the descent interrupted at the broken torii. The same sealed key record restores your route.",
                ...(!floorSeal.ok ? [`Floor seal pending: ${floorSeal.error || "retry after reconnect"}. Movement remains server-blocked until the seal succeeds.`] : []),
            ]);
            setHollowGateEvent(null);
            setHollowGateHiddenChamber(null);
            setCharacter({ ...recoveredBase, hollowGateRun: run });
            setCurrentBiome("shadow");
            setCurrentWeather(weatherForBiome("shadow"));
            setScreen("hollowGateShrine");
            attachStartedRun(recovered, { playerName: character.name, setRun: setHollowGateRun, setCharacter, setEvent: setHollowGateEvent, pushLog: pushHollowGateLog });
            return;
        }
        // Restore an in-progress run, if any. Resuming a run is always free —
        // the key was already consumed when the run was started. The Character
        // normalizer resets daily counters at midnight UTC.
        if (character.hollowGateRun && !character.hollowGateRun.completed) {
            setHollowGateRun(character.hollowGateRun);
            setHollowGateLog(prev => prev.length ? prev : ["You return to your unfinished run. The floor marks and opened passages are unchanged."]);
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
        //       (Event gates skip this unless the config demands it.)
        //   (2) The player owns a Hollow Gate Key, consumed on entry (event
        //       gates may set keyCost 0 = free entry).
        const village = loadVillageState(character.village);
        if ((!eventCfg || eventCfg.requiresUnlock) && !isHollowGateUnlocked(village)) {
            alert("The Hollow Gate seal is still bound. Your village Kage must purchase the Hollow Gate upgrade from the Town Hall before anyone can enter.");
            return;
        }
        const keyCost = eventCfg ? (eventCfg.keyCost ?? 1) : 1;
        const ownedKeys = countItem(character, HOLLOW_GATE_KEY_ID);
        if (keyCost > 0 && ownedKeys <= 0) {
            alert("You need a Hollow Gate Key to enter the shrine. Forge one from Hollow Shards in Shrine Attunement (Key Forge), pry one from shrine chests, or complete your village story.");
            return;
        }
        // Daily run cap — hard-capped at 2 regardless of key inventory. The
        // shrine itself refuses to open more than twice between dawns.
        // Counter is reset when lastDailyReset != today. Event runs share it.
        const todayKey = currentDateKey();
        const runsToday = character.lastDailyReset === todayKey ? (character.dailyHollowGateRuns ?? 0) : 0;
        const DAILY_HOLLOW_GATE_CAP = 2 + attunementDailyBonus(character);
        if (runsToday >= DAILY_HOLLOW_GATE_CAP) {
            alert(`The entry seal has already admitted you ${runsToday}/${DAILY_HOLLOW_GATE_CAP} times today. Return at dawn.`);
            return;
        }
        const floorsLine = eventCfg ? `\nEvent gate: ${hollowGateRunMaxFloor({ variant })} floor${hollowGateRunMaxFloor({ variant }) === 1 ? "" : "s"}, final boss: ${hollowGateBossDisplayName({ variant })}.` : "";
        const keyLine = keyCost > 0 ? `This consumes 1 Hollow Gate Key (${ownedKeys} owned). Keys are one-time use.` : "Entry is free for this event.";
        const ok = await gameConfirm(`Enter the ${gateName}?\n${floorsLine}\n${keyLine}\nDaily runs: ${runsToday}/${DAILY_HOLLOW_GATE_CAP}.`, { title: gateName, confirmLabel: "Enter" });
        if (!ok) return;

        // Server daily-cap HARD-block (audit #7): with the server-auth flag on, ask the
        // server BEFORE spending the Key — a 'daily-cap' reply (e.g. a backdated reset
        // that beat the client gate) blocks the dive. Unreachable / SESSION unset → null
        // → hard stop. A reward-bearing local fallback is never mounted.
        // The settle ledger scales with floorDepth — a short event gate
        // declares its own depth so settlement matches the shorter run.
        const serverStart = await startHollowGateServerRun(character.name, hollowGateRunMaxFloor({ variant }), variant?.id);
        if (serverStart?.reason === "daily-cap") {
            alert("The daily entry seal has reached its limit. Return at dawn.");
            return;
        }
        if (!serverStart?.token || !serverStart.character) {
            alert("The Hollow Gate could not establish a secure server run. No key was spent locally; retry when the connection is stable.");
            return;
        }

        // The returned committed save contains the exact server-side key debit.
        const afterKey = serverStart.character;

        const run = await buildHollowGateRunFromStart(serverStart, variant, character).catch(() => null);
        if (!run) {
            alert(HOLLOW_GATE_FLOOR_LOAD_FAILED);
            return;
        }
        const floorSeal = await sealHollowGateFloor(character.name, serverStart.token, run);
        setHollowGateRun(run);
        setHollowGateLog([
            keyCost > 0
                ? "You press a Hollow Gate Key against the broken torii. The seal bends. You descend."
                : `The ${gateName} stands open because its event seal is already released. You descend.`,
            ...(!floorSeal.ok ? [`Floor seal pending: ${floorSeal.error || "retry after reconnect"}. Movement remains server-blocked until the seal succeeds.`] : []),
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
    function clearHollowGateRunState(exit?: boolean) {
        setHollowGateRun(null);
        setHollowGateEvent(null);
        setHollowGateHiddenChamber(null);
        setHollowGateLog([]);
        setHollowGateIntroPage(null); setHollowGatePveFight(null);
        setCharacter((prev) => prev ? clearHollowGateRunLocal(prev) : prev);
        if (exit) setScreen("worldMap");
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
    async function adminTestEnterHollowGateShrine(eventCfg?: HollowGateEventConfig) {
        if (!character) return;
        // Resume an existing run if the admin has one — same behavior as
        // the live entry. Otherwise start a fresh run with no gates (with the
        // event variant applied when the panel is playtesting an event gate).
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
        const variant = eventCfg ? variantFromEventConfig(eventCfg) : undefined;
        const serverStart = await startHollowGateServerRun(character.name, hollowGateRunMaxFloor({ variant }), variant?.id);
        if (!serverStart?.token) {
            alert("The Hollow Gate could not establish a secure admin playtest run.");
            return;
        }
        const run = await buildHollowGateRunFromStart(serverStart, variant, character).catch(() => null);
        if (!run) {
            alert(HOLLOW_GATE_FLOOR_LOAD_FAILED);
            return;
        }
        const floorSeal = await sealHollowGateFloor(character.name, serverStart.token, run);
        if (!floorSeal.ok) {
            alert(floorSeal.error || "The Hollow Gate floor seal is pending; reconnect to retry it.");
        }
        setHollowGateRun(run);
        setHollowGateLog([
            `(Admin test) You step through the broken torii without spending a key.${serverStart.variantId ? ` Event gate: ${eventCfg?.label || serverStart.variantId}.` : ""} The verified Hollow Gate echoes greet you.`,
            ...(!floorSeal.ok ? [`Floor seal pending: ${floorSeal.error || "retry after reconnect"}. Movement remains server-blocked until the seal succeeds.`] : []),
        ]);
        setHollowGateEvent(null);
        setHollowGateHiddenChamber(null);
        setCharacter({
            ...(serverStart.character ?? character),
            hollowGateRun: run,
            lastDailyReset: currentDateKey(),
        });
        setCurrentBiome("shadow");
        setCurrentWeather(weatherForBiome("shadow"));
        setScreen("hollowGateShrine");
        attachStartedRun(serverStart, { playerName: character.name, setRun: setHollowGateRun, setCharacter, setEvent: setHollowGateEvent, pushLog: pushHollowGateLog });
    }
    // Threat ambushes always present the same readable Hollow Hound choice as
    // authored battle tiles. The run never silently flips a coin on combat mode.
    function triggerHollowGateAmbush(sealed?: { nodeId: string; kind: "ambush" | "boss" }) {
        if (!character) return;
        // Final-floor ambush → boss fight. Avoids the climax getting cheated by
        // a random ambush firing before the boss tile. The player still sees
        // the boss fight + the shrine-cleared modal on win.
        if (sealed?.kind === "boss" || (!sealed && (hollowGateRun?.floor ?? 1) >= hollowGateRunMaxFloor(hollowGateRun))) {
            pushHollowGateLog(`The corridor itself tears open — ${hollowGateBossDisplayName(hollowGateRun)} steps through the seal!`);
            void startHollowGateBattle({ isBoss: true, nodeId: sealed?.nodeId ?? `floor:${hollowGateRun?.floor ?? 1}:ambush:boss-threat` });
            return;
        }
        pushHollowGateLog("Footsteps converge in the side passages. A Hollow Hound lunges from the mist.");
        void startHollowGateBattle({ isAmbush: true, nodeId: sealed?.nodeId });
    }
    useEffect(() => {
        if (screen !== "hollowGateShrine" || hollowGateEvent || hollowGateHiddenChamber || hollowGatePveFight || hollowGatePetFight) return;
        const pending = hollowGatePendingAmbushRef.current;
        if (!pending) return;
        hollowGatePendingAmbushRef.current = null;
        triggerHollowGateAmbush(pending);
    }, [screen, hollowGateEvent, hollowGateHiddenChamber, hollowGatePveFight, hollowGatePetFight]);
    async function startHollowGateBattle(opts: { isBoss?: boolean; isAmbush?: boolean; isBeast?: boolean; isElite?: boolean; nodeId?: string; forceMode?: "pve" | "pet" }) {
        if (!character) return;
        if (hollowGatePveFight || hollowGatePetFight) return;
        const token = hollowGateRun?.runToken;
        if (!token) {
            alert("This legacy Hollow Gate run has no secure combat seal. Leave the shrine and begin a new server-backed run before fighting.");
            return;
        }
        const floor = hollowGateRun?.floor ?? 1;
        const kind: HollowGateCombatKind = opts.isBoss ? "boss" : opts.isAmbush ? "ambush" : opts.isBeast ? "beast" : opts.isElite ? "elite" : "battle";
        const houndPresentation = hollowGateEncounterPresentation(floor, kind);
        const nodeId = opts.nodeId ?? `floor:${floor}:ambush:threat-${hollowGateRun?.playerX ?? 0}-${hollowGateRun?.playerY ?? 0}-${hollowGateRun?.tiles.filter((tile) => tile.resolved).length ?? 0}`;
        const activePet = activeCarriedPets<Pet>(character).find((pet) => pet.id === character.activePetId);
        const petReady = Boolean(activePet?.unlockedForPve && !isPetOnExpedition(activePet));
        if (!opts.forceMode && petReady && activePet) {
            setHollowGateEvent({
                title: houndPresentation.name,
                body: `${opts.isBoss ? "The Alpha seals the way forward." : `${houndPresentation.epithet} blocks the corridor.`}\n\nIts spectral chakra gathers into ${houndPresentation.signature}.\n\nChoose who enters combat. Shinobi combat uses the normal mission/explore PvE arena. Pet combat uses the tactical Pet Colosseum and ${activePet.name}; a pet defeat deals 20% max HP recoil but does not clear this encounter.`,
                kind: opts.isBoss ? "boss" : "pet_battle",
                choices: [
                    {
                        label: "Fight as Shinobi",
                        tone: "primary",
                        onSelect: () => {
                            setHollowGateEvent(null);
                            void startHollowGateBattle({ ...opts, forceMode: "pve" });
                        },
                    },
                    {
                        label: `Send ${activePet.name}`,
                        tone: "safe",
                        onSelect: () => {
                            setHollowGateEvent(null);
                            void startHollowGateBattle({ ...opts, forceMode: "pet" });
                        },
                    },
                ],
            });
            return;
        }
        const mode: "pve" | "pet" = opts.forceMode === "pet" && petReady ? "pet" : "pve";
        try {
            const started = await startHollowGateCombat({
                playerName: character.name,
                token,
                floor,
                nodeId,
                kind,
                mode,
            });
            const activeCombat = { runId: started.runId, nodeId, floor, kind, mode };
            setHollowGateRun((prev) => prev ? { ...prev, activeCombat } : prev);
            setCharacter((prev) => prev?.hollowGateRun ? { ...prev, hollowGateRun: { ...prev.hollowGateRun, activeCombat } } : prev);
            if (mode === "pet") launchHollowGatePetFight(activeCombat);
            else if (started.session) launchHollowGatePveFight(activeCombat, started.session);
            else throw new Error("The Hollow Gate returned no sealed combat session.");
            return;
        } catch (error) {
            reportHollowGateRunError(error, "The Hollow Gate encounter could not start.", () => clearHollowGateRunState(true));
            return;
        }
    }

    function launchHollowGatePveFight(fight: HollowGatePveFightRef, session: HollowGateServerFight["session"]) {
        setHollowGatePveFight({ ...fight, session });
        pushHollowGateLog(`Encounter: ${session.enemy.name}.`);
    }

    async function settleActiveHollowGateCombat(
        runId: string,
        playerName: string,
    ): Promise<HollowGateCombatSettleResult> {
        const token = hollowGateRun?.runToken ?? character?.hollowGateRun?.runToken;
        if (!token) throw new Error("The Hollow Gate run token is missing.");
        const result = await settleHollowGateCombat({ playerName, token, runId });
        if (result.character) commitVersionedCharacter(result.character, result._saveVersion);
        return result;
    }

    function finishHollowGatePveFight(result: HollowGateCombatSettleResult) {
        const fight = hollowGatePveFight;
        if (!fight) return;
        if (result.won) {
            const rewardLine = formatHollowGateCombatReward(result);
            if (rewardLine) pushHollowGateLog(`Server reward banked: ${rewardLine}.`);
            const riftId = hollowGateRun?.variant?.id;
            if (fight.kind === "boss" && riftId?.startsWith("rift-")
                && character && hollowGateRun && hollowGateRun.floor >= hollowGateRunMaxFloor(hollowGateRun)) {
                void completeRiftRun(character.name, riftId, setCharacter, pushHollowGateLog);
            }
            onHollowGateBattleWin({ isBoss: fight.kind === "boss", isAmbush: fight.kind === "ambush", nodeId: fight.nodeId });
        } else if (result.escaped) {
            setHollowGateRun((previous) => {
                const run = result.character?.hollowGateRun ?? previous;
                return run ? { ...run, activeCombat: undefined, threat: 0 } : null;
            });
            pushHollowGateLog("You withdraw from the Hollow Hound. The path remains open and Threat resets.");
        } else if (result.revived) {
            setHollowGateRun((previous) => {
                const run = result.character?.hollowGateRun ?? previous;
                return run ? { ...run, activeCombat: undefined, secondWindArmed: false, threat: 0 } : null;
            });
            pushHollowGateLog("Second Wind pulls you back from defeat at half health.");
        } else {
            setHollowGateRun(null);
            setHollowGateEvent(null);
            setHollowGateHiddenChamber(null);
            setHollowGateLog([]);
            setScreen("hospital");
        }
        setHollowGatePveFight(null);
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
            `Floor reached: ${stats.floors} / ${hollowGateRunMaxFloor(hollowGateRun)}`,
            `Chests opened: ${stats.chests}`,
            `Hollow Hounds defeated: ${stats.battles}`,
            `Pet-duel Hounds defeated: ${stats.beasts}`,
            `Tile Seals claimed: ${stats.tileSeals}`,
            `Hidden Chambers: ${stats.hiddenChambers}`,
            `Keepers blessed by: ${stats.keepers}`,
            `Traps survived: ${stats.traps}`,
            `HP remaining: ${character.hp} / ${character.maxHp}`,
        ].join("\n");
    }

    // Body lives in lib/hollow-gate-tile (drained 2026-07-28; it alone pinned App.tsx
    // to its line budget). Everything it used to close over is handed over here.
    async function resolveHollowGateTile(tile: HollowGateTile, x: number, y: number) {
        // The whole queued fx batch was already emptied by the drain, so a
        // rejection here is invisible without this: the player steps onto a
        // chest / staircase / exit and simply nothing happens.
        const runtime = await loadHollowGateTileRuntime().catch(() => null);
        if (!runtime) {
            pushHollowGateLog("The shrine could not read that tile — the connection dropped while loading it. Step off and back onto it to try again.");
            return;
        }
        const { resolveHollowGateTile: resolveHollowGateTileImpl } = runtime;
        resolveHollowGateTileImpl(tile, x, y, {
            character, hollowGateRun,
            setHollowGateRun, setHollowGateEvent, setHollowGateHiddenChamber,
            onVersionedCharacter: commitVersionedCharacter,
            pushHollowGateLog, buildHollowGateRunSummary, startHollowGateBattle,
            leaveHollowGateShrine,
        });
    }
    // Drain the queued move side-effects. Runs on a macrotask AFTER React has
    // flushed the state updater(s) that enqueued them, so the tile fire can
    // never be dropped by the eager-updater timing race (see hollowGateMoveFxRef).
    async function drainHollowGateMoveFx() {
        const queue = hollowGateMoveFxRef.current;
        if (queue.length === 0) return;
        hollowGateMoveFxRef.current = [];
        for (const fx of queue) {
            if (fx.wallBump) {
                pushHollowGateLog(fx.blockMessage ?? "Solid shrine stone. You cannot pass.");
                continue;
            }
            if (fx.committedTheme) {
                pushHollowGateLog(`You commit to the ${fx.committedTheme === "treasure" ? "Treasure" : "Beast"} wing — the other detour seals behind you. The Trial path remains open.`);
            }
            if (!fx.step || !character || !hollowGateRun?.runToken) continue;
            const step = await sealHollowGateStep({
                playerName: character.name,
                token: hollowGateRun.runToken,
                ...fx.step,
            });
            if (!step.ok) {
                pushHollowGateLog(step.error || "The shrine rejected that step.");
                setHollowGateRun((previous) => previous ? {
                    ...previous,
                    playerX: step.position?.x ?? fx.step!.fromX,
                    playerY: step.position?.y ?? fx.step!.fromY,
                } : previous);
                continue;
            }
            acceptExternalSaveVersion(step._saveVersion, character.name);
            setHollowGateRun((previous) => previous ? {
                ...previous,
                playerX: step.position?.x ?? fx.step!.toX,
                playerY: step.position?.y ?? fx.step!.toY,
                torch: step.torch ?? previous.torch,
                threat: step.threat ?? previous.threat,
                wardSteps: step.wardSteps ?? previous.wardSteps,
            } : previous);
            if (step.torchSputtered) pushHollowGateLog("The Torch of Reiki sputters out. Threat builds faster in the dark.");
            if (step.ambush) hollowGatePendingAmbushRef.current = step.ambush;
            if (fx.justResolved) {
                const { tile, nx, ny } = fx.justResolved;
                await resolveHollowGateTile(tile, nx, ny);
            }
        }
    }
    function moveHollowGatePlayer(dx: number, dy: number) {
        if (hollowGateEvent || hollowGateHiddenChamber) return;
        if (hollowGateIntroPage !== null) return;
        // A post-boss descend is building the next floor. The current board is
        // about to be replaced, so a step taken now would be discarded — and its
        // in-flight seal could stamp this floor's coordinates onto the next one.
        if (hollowGateDescending) return;

        // Functional state update so rapid WASD presses queue against the latest
        // run state (the closure form lost presses within a single render tick).
        // Step side-effects are pushed to hollowGateMoveFxRef from INSIDE the
        // updater (never a local `let` read right after — that races the eager
        // updater and drops the tile fire during click-to-walk).
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
                hollowGateMoveFxRef.current.push({ wallBump: true, torchSputtered: false, justResolved: null, ambushImmediate: false });
                return prev;
            }
            // Branching wings: block entry to a sealed wing; entering a detour
            // commits to it (sealing the other). Trial/hub are always open.
            const wingEff = wingEntryEffect(prev, tile.wing);
            if (wingEff.blocked) {
                hollowGateMoveFxRef.current.push({ wallBump: true, blockMessage: wingEff.message, torchSputtered: false, justResolved: null, ambushImmediate: false });
                return prev;
            }
            const tiles = prev.tiles.slice();
            tiles[idx] = { ...tile, revealed: true, flavor: tile.flavor ?? hollowGateFlavorFor(tile.kind) };
            // Fire the tile's event on every step onto an UNRESOLVED tile (gate on
            // `resolved` only, never on revealed — so Leave/descend/locked/boss
            // re-fire when re-entered; markResolved() still prevents double-grants).
            const justResolved = !tile.resolved;
            hollowGateMoveFxRef.current.push({
                wallBump: false,
                committedTheme: wingEff.committedTheme,
                torchSputtered: false,
                justResolved: justResolved ? { tile: { ...tile, revealed: true }, nx, ny } : null,
                ambushImmediate: false,
                step: {
                    requestId: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                        ? crypto.randomUUID()
                        : `hg-step-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    fromX: prev.playerX,
                    fromY: prev.playerY,
                    toX: nx,
                    toY: ny,
                },
            });
            // markHollowGateSeen stamps the new visibility flood as map memory
            // (dim "explored" tiles after you leave a room; click-to-walk surface).
            return markHollowGateSeen({
                ...prev,
                ...(wingEff.patch ?? {}),
                playerX: nx,
                playerY: ny,
                tiles,
            });
        });

        // Drain after the flush. A single scheduled drain empties the whole
        // queue, so back-to-back steps that batch into one flush are all
        // processed in order (extra drains just find an empty queue).
        setTimeout(() => {
            hollowGateStepDrainRef.current = hollowGateStepDrainRef.current
                .then(drainHollowGateMoveFx)
                .catch(() => undefined);
        }, 0);
    }
    function completeEventEncounter() {
        const event = pendingEventEncounter?.event;
        setPendingEventEncounter(null);
        if (event) void completeTriggeredEvent(event);
        else setScreen(activeTriggerReturnScreen);
    }

    function leaveEventEncounter() {
        setPendingEventEncounter(null);
        setScreen(activeTriggerReturnScreen);
    }

    const playableAis = [
        ...builtinAis.map((builtin) => { const o = creatorAis.find((ai) => ai.id === builtin.id); return withAcademySparringPortrait(o ? { ...builtin, image: o.image ?? builtin.image } : builtin); }), // built-in/story AIs source-authoritative; same-id override = image only (see AdminPanel allAdminAis)
        ...creatorAis.filter((ai) => !builtinAis.some((builtin) => builtin.id === ai.id)),
        ...(temporaryStoryAi ? [temporaryStoryAi] : []),
    ];
    async function searchHollowGateHiddenChamber() {
        if (!hollowGateHiddenChamber || !character || !hollowGateRun?.runToken) return;
        const result = await resolveHollowGateServerEvent({
            playerName: character.name,
            token: hollowGateRun.runToken,
            nodeId: hollowGateHiddenChamber.nodeId,
            action: "hidden-tablet",
        });
        if (!result.ok || !result.character) return pushHollowGateLog(result.error || "The Ancient Tablet's inscription cannot be read.");
        commitVersionedCharacter(result.character, result._saveVersion);
        pushHollowGateLog(`You decipher the Ancient Tablet. ${hollowGateRewardLines(result.reward).join(", ")}.`);
        setHollowGateHiddenChamber({ ...hollowGateHiddenChamber, searched: true });
    }

    async function takeHollowGateHiddenChamberRelic() {
        if (!hollowGateHiddenChamber || !hollowGateRun?.runToken || !character) return;
        const result = await resolveHollowGateServerEvent({
            playerName: character.name,
            token: hollowGateRun.runToken,
            nodeId: hollowGateHiddenChamber.nodeId,
            action: "hidden-relic",
        });
        if (!result.ok || !result.character) return pushHollowGateLog(result.error || "The chamber relic did not answer.");
        commitVersionedCharacter(result.character, result._saveVersion);
        setHollowGateRun((previous) => previous && result.runState ? { ...previous, ...result.runState } : previous);
        pushHollowGateLog(`You claim the chamber relic. ${hollowGateRewardLines(result.reward).join(", ")}, +1 Shrine Key.`);
        setHollowGateHiddenChamber({ ...hollowGateHiddenChamber, relicTaken: true });
    }

    const hideBattleChrome = shouldHideBattleChrome({
        screen,
        arenaBattleActive: false,
        petBattleActive: petBattleActive || petFullscreenActive,
    });
    const introCinematicActive = Boolean(
        character
        && (character.onboardingStep === "academyIntro" || character.onboardingStep === "starter" || character.onboardingStep === "companionIntro")
        && character.name !== "Admin 1"
        && character.name !== "Admin 2",
    );

    const surfaceBlockerMode = playerSurfaceBlockerMode(Boolean(character), screen, gameplayViewAvailability);
    return (
        <MaintenanceOperatorBoundary mode={surfaceBlockerMode}>
        <AdaptiveGameShell
            biome={currentBiome}
            screen={screen}
            village={character?.village}
            uiMode={hideBattleChrome || isBattleViewScreen(screen) ? "combat" : "noncombat"}
            facilityAccent={STUDIO_SCREEN_PRESENTATION[screen].facility?.accent}
            artwork={screen === "start" ? backgroundImage : STUDIO_SCREEN_PRESENTATION[screen].artwork}
        >
            <GameAlertHost /><GameConfirmHost /><GamePasswordPromptHost /><GameToastHost />
            <SaveErrorBanner visible={saveBlocked} />

            {sessionExpired && (
                <SessionExpiredModal
                    password={reauthPw}
                    error={reauthError}
                    busy={reauthBusy}
                    onPasswordChange={setReauthPw}
                    onContinue={() => void reauthKeepState()}
                    onLogout={logoutFromExpiry}
                />
            )}
            {character &&
                screen !== "start" &&
                !hideBattleChrome &&
                !introCinematicActive && (
                    <Suspense fallback={null}>
                    <LeftProfileCard
                        character={character}
                        updateCharacter={setCharacter}
                        currentSector={currentSector}
                        setScreen={stableNavigate}
                        activeTraining={activeTraining}
                        activeJutsuTraining={activeJutsuTraining}
                    />
                    </Suspense>
                )}

            {/* Portal target for battle HUD — rendered outside center-game to escape stacking context */}
            <div id="battle-hud-portal" />

            {screen !== "start" && character && (screen === "arena" || screen === "storyBoss") && (
                <Suspense fallback={null}>
                    <SectorBanner />
                </Suspense>
            )}

            {screen !== "start" && character && !hideBattleChrome && !introCinematicActive && (
                <Suspense fallback={null}>
                    <RightMenu
                        navigate={stableNavigate}
                        adminLoggedIn={adminLoggedIn}
                        logoutPlayer={stableLogout}
                        characterName={character?.name ?? ""}
                        characterVillage={character?.village ?? ""} storyVillage={character?.storyVillage ?? character?.village ?? ""} characterClan={character?.clan ?? ""}
                        profession={character?.profession ?? null}
                        screen={screen}
                    />
                    <MobileNav
                        navigate={stableNavigate} adminLoggedIn={adminLoggedIn} logoutPlayer={stableLogout}
                        character={character} updateCharacter={setCharacter} currentSector={currentSector}
                        activeTraining={activeTraining} activeJutsuTraining={activeJutsuTraining} screen={screen}
                    />
                </Suspense>
            )}

            {/* Viewport chrome must remain outside the document-scrolling center.
                A size-query/paint container inside that center would otherwise
                turn fixed positioning into content-relative positioning. */}
            {character && screen !== "start" && !hideBattleChrome && !introCinematicActive && (
                <Suspense fallback={null}>
                    <ScreenTopChrome
                        character={character}
                        onBack={canGoBack ? goBack : undefined}
                    />
                </Suspense>
            )}

            {incomingAttackBanner && (
                <div className="incoming-attack-banner">{incomingAttackBanner}</div>
            )}

            {/* Global incoming challenge popup — centered, clickable, visible from
                any screen. Portals to <body> so the fixed side rails don't cover it. */}
            {character && (
                <IncomingChallengeModal
                    challenges={duelChallenges}
                    selfName={character.name}
                    processingIds={processingChallengeIds}
                    onAccept={(c) => {
                        if (c.mode === "clanWarPet" || c.mode === "rankedPet") void acceptPetChallengeGlobal(c);
                        else void acceptChallengeGlobal(c);
                    }}
                    onDecline={(c) => declineChallengeGlobal(c)}
                />
            )}

            <StoryBossFightHost character={character} sharedImages={sharedImages} savedBloodlines={savedBloodlines} creatorJutsus={creatorJutsus} creatorItems={creatorItems} onSettled={handleServerStoryBossSettled} onOutcome={commitVersionedCharacter} onFightOpenChange={setStoryFightOpen} />

            {/* Sealed AI fights (hunts, guards, ambushes, raids, field missions). The host fails closed unless it receives a canonical solo-PvE session; there is no rewarding local-Arena fallback. Hooks only mirror the remaining non-world UI side effects. Both hosts are code-split (fallback null — they render nothing until a fight is requested); their chunks are fetched from App's FIRST render, i.e. before any lazy launch screen is even requested, so the request-bus listener is live long before a launch site can exist. */}
            <AiFightHost character={character} sharedImages={sharedImages} savedBloodlines={savedBloodlines} creatorJutsus={creatorJutsus} creatorItems={creatorItems} hooks={{ onMissionRaidComplete: (sector, missionIds) => recordMissionRaid(sector, undefined, missionIds, character?.name ?? "") }} onSettled={(result) => {
                if (result.character && !commitVersionedCharacter(result.character, result._saveVersion)) return;
                if ((result.raidProgression?.territoryDamage ?? 0) > 0) void refreshWorldStateSnapshot();
                for (const mission of result.raidProgression?.missionsCompleted ?? []) {
                    window.dispatchEvent(new CustomEvent("profession-mission-complete", {
                        detail: { name: mission.name, xp: mission.xpReward, profession: "vanguard" },
                    }));
                }
            }} onClose={(back) => { setMissionBattleActive(false); if (back) navigate(back as Screen); }} onRecordBattle={recordBattle} />

            <main
                className={`center-game screen-${screen}${hideBattleChrome ? " battle-focus" : ""}`}
                inert={introCinematicActive}
                style={{
                    // Darkening overlay only — the scene comes from `.app-background`.
                    // (Re-tiling the image here was the second source of the repeat.)
                    backgroundImage: `linear-gradient(rgba(2, 6, 23, 0.30), rgba(2, 6, 23, 0.72))`,
                }}
            >
                {/* Suspense for lazy screens; the per-screen ErrorBoundary (keyed by screen) isolates a render crash to one view so the nav stays usable and navigating away clears it. */}
                <Suspense fallback={<ScreenLoadingFallback screen={screen} />}>
                <ScreenErrorBoundary key={screen}>
                {/* Hidden on the full-screen battle boards — the in-combat side HUDs
                    already show the player's HP/chakra/stamina, so the top status bar
                    is redundant there and just costs vertical space. */}
                {screen === "start" && restoringSession && gameplayViewAvailability !== "unavailable" && (
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
                {screen === "start" && (!restoringSession || gameplayViewAvailability === "unavailable") && (
                    <StartScreen
                        onCreate={createPlayerAccount}
                        onLogin={loginPlayerAccount}
                        onContinueAs={continueRememberedAccount}
                        googleSignup={googleSignup}
                        initialName={restoreFailed ? bootAccountName : ""}
                        notice={googleNotice || (restoreFailed ? "Your session timed out — log back in to restore your save. No progress is lost." : "")}
                        onAdmin={() => {
                            // The dedicated admin screen requires direct entry;
                            // never shuttle this credential through storage.
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
                        onLogin={async (account, pw, role, token) => {
                            setAdminLoggedIn(true);
                            setAdminAccount(account);
                            setAdminSession(token, pw); // Phase 4: store token (else password); authFetch sends x-admin-token, never the plaintext.
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
                        updateCharacter={setCharacter} onVersionedCharacter={commitVersionedCharacter}
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
                        hollowGateEventConfig={hollowGateEventConfig}
                        setHollowGateEventConfig={setHollowGateEventConfig}
                        onHollowGateForceUnlock={adminHollowGateForceUnlock}
                        onHollowGateResetIntro={adminHollowGateResetIntro}
                        onHollowGateClearRun={() => clearHollowGateRunState()}
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
                        onCancel={() => {
                            if (/^story-(?:interlude-|[^-].*-\d+-\d+$)/.test(activeTriggeredEvent.id)) {
                                dismissedStoryScenesRef.current.add(activeTriggeredEvent.id);
                            }
                            setActiveTriggeredEvent(null);
                        }}
                        onComplete={() => { void completeTriggeredEvent(activeTriggeredEvent); }}
                        onBattle={startTriggeredEventArenaBattle}
                        onChoice={(c) => { const t = c.trait; if (t) setCharacter(prev => prev ? applyStoryChoice(prev, t) : prev); if (t && c.battle && activeTriggeredEvent.kageFinale) storyEpilogueRef.current.lane = t; }}
                        sharedImages={sharedImages}
                    />
                )}

                {!activeTriggeredEvent && screen === "dungeon" && character && activeDungeonEvent && (
                    <DungeonEncounter
                        event={activeDungeonEvent}
                        character={character}
                        creatorCards={creatorCards}
                        dungeonRunToken={activeDungeonRunToken ?? character.activeDungeonRun?.token ?? ""}
                        onVersionedCharacter={commitVersionedCharacter}
                        lineIndex={dungeonLine}
                        setLineIndex={setDungeonLine}
                        onStartAiFight={startDungeonAiFight}
                        onTileWin={() => { setDungeonLine(0); }}
                        onPetWin={() => { setDungeonLine(0); }}
                        onClaimReward={completeDungeon}
                        onLeave={leaveDungeon}
                        sharedImages={sharedImages}
                    />
                )}

                {!activeTriggeredEvent && screen === "hollowGateShrine" && character && hollowGateRun && !hollowGatePveFight && !hollowGatePetFight && (
                    <HollowGateShrineView
                        character={character}
                        hollowGateRun={hollowGateRun}
                        hollowGateLog={hollowGateLog}
                        sharedImages={sharedImages}
                        hollowGateIntroPage={hollowGateIntroPage}
                        setHollowGateIntroPage={setHollowGateIntroPage}
                        hollowGateEvent={hollowGateEvent}
                        hollowGateHiddenChamber={hollowGateHiddenChamber}
                        moveHollowGatePlayer={moveHollowGatePlayer}
                        onTileClick={hollowGateWalkTo}
                        walkTarget={hollowGateWalkTarget}
                        setHollowGateRun={setHollowGateRun}
                        onVersionedCharacter={commitVersionedCharacter}
                        pushHollowGateLog={pushHollowGateLog}
                        petEligible={isActivePetEligibleForHollowGate()}
                        exitPending={hollowGateExitPending}
                        onEmergencyForfeit={() => { void abandonHollowGateShrine(); }}
                        onSearchHiddenChamber={searchHollowGateHiddenChamber}
                        onTakeHiddenChamberRelic={takeHollowGateHiddenChamberRelic}
                        onCloseHiddenChamber={() => setHollowGateHiddenChamber(null)}
                    />
                )}

                {/* Intro cinematic (replaced VillageLoreScreen + StarterPetSelect):
                    fox summons + pet gift, then the companion's village intro. Gated
                    on the PERSISTED onboardingStep → refresh-proof; admins skip. */}
                {introCinematicActive && character && (
                    <Suspense fallback={null}>
                    <IntroCinematic
                        key={character.onboardingStep === "companionIntro" ? "companion" : "summon"}
                        character={character}
                        sharedImages={sharedImages}
                        onComplete={(pet) => {
                            // Trait-bonus grant, then summon → companionIntro → training
                            // (the guard makes pass 2 grant-free). FUNCTIONAL update: this
                            // fires from a ~2.5s-old timer closure — a render-scope spread
                            // would clobber updates that landed mid-white-out.
                            setCharacter((prev) => {
                                if (!prev || prev.onboardingStep === "training") return prev;
                                const priorStep = prev.onboardingStep;
                                const trait = pet.trait ?? "Loyal";
                                const granted = applyPetTraitBonuses({ ...pet, trait }, trait);
                                const already = prev.pets.some((p) => p.id === granted.id);
                                const updated: Character = {
                                    ...prev,
                                    pets: already ? prev.pets : [...prev.pets, granted],
                                    activePetId: prev.activePetId ?? granted.id,
                                    onboardingStep: prev.onboardingStep === "companionIntro" ? "training" : "companionIntro",
                                };
                                if ((priorStep === "academyIntro" || priorStep === "starter") && !already) {
                                    // Pet ownership is a server entitlement. The generic save
                                    // route intentionally cannot add a new pet under the strict
                                    // ledger, so commit the canonical starter through its
                                    // dedicated endpoint before the cinematic's second pass.
                                    if (starterPetCommitRef.current?.accountName !== updated.name) {
                                        const commit = chooseStarterPetServer(updated.name, pet)
                                            .then((result) => {
                                                if (!result.character) {
                                                    setCharacter((current) => {
                                                        if (!current || current.name !== updated.name) return current;
                                                        return {
                                                            ...current,
                                                            pets: current.pets.filter((entry) => entry.id !== granted.id),
                                                            activePetId: current.activePetId === granted.id ? undefined : current.activePetId,
                                                            onboardingStep: "academyIntro",
                                                        };
                                                    });
                                                    starterPetCommitRef.current = null; // else the replay pass sees this resolved-false promise and never retries
                                                    alert(result.error ?? "Your companion choice was not saved. Please choose again.");
                                                    return false;
                                                }
                                                const current = characterRef.current;
                                                if (!current || saveConflictAccountKey(current.name) !== saveConflictAccountKey(updated.name)) return false;
                                                return commitVersionedCharacter(reconcileOwnedStarter(current, result.character, granted.id), result._saveVersion);
                                            })
                                            .catch(() => {
                                                setCharacter((current) => {
                                                    if (!current || current.name !== updated.name) return current;
                                                    return {
                                                        ...current,
                                                        pets: current.pets.filter((entry) => entry.id !== granted.id),
                                                        activePetId: current.activePetId === granted.id ? undefined : current.activePetId,
                                                        onboardingStep: "academyIntro",
                                                    };
                                                });
                                                starterPetCommitRef.current = null; // same retry reset as the rejected-result path above
                                                alert("Your companion choice could not reach the server. Please choose again.");
                                                return false;
                                            });
                                        starterPetCommitRef.current = { accountName: updated.name, promise: commit };
                                    }
                                } else {
                                    const starterCommit = starterPetCommitRef.current?.accountName === updated.name
                                        ? starterPetCommitRef.current.promise
                                        : null;
                                    void (starterCommit ?? Promise.resolve(true)).then((committed) => {
                                        if (committed) return pushSaveToServer(updated, updated.name);
                                    }).catch(() => {});
                                }
                                return updated;
                            });
                        }}
                    />
                    <ScreenReadyProbe screen={screen} />
                    </Suspense>
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
                    // Coach is hidden during the spar (the in-battle SparCoach handles it) —
                    // on the local Arena by screen, and on the SEALED spar by the portal flag.
                    && screen !== "arena" && !storyFightOpen
                    && character.name !== "Admin 1"
                    && character.name !== "Admin 2"
                    && (
                    <Suspense fallback={null}>
                    <OnboardingCoach
                        character={character}
                        screen={screen}
                        activeTraining={activeTraining}
                        currentSector={currentSector}
                        guidePet={activeCarriedPets<Pet>(character)[0] ?? null}
                        sharedImages={sharedImages}
                        setScreen={navigate}
                        updateCharacter={setCharacter}
                        onStartSpar={startAcademySparringMatch}
                    />
                    </Suspense>
                )}

                {/* One-time contextual hints for free-roam systems (post-onboarding). */}
                {character && character.name !== "Admin 1" && character.name !== "Admin 2" && (
                    <Suspense fallback={null}>
                    <ScreenHint screen={screen} character={character} updateCharacter={setCharacter} />
                    </Suspense>
                )}

                {!activeTriggeredEvent && (
                    <Suspense fallback={null}>
                    <LiveServiceNotice screen={screen} onNavigate={navigate} />
                    </Suspense>
                )}

                {!activeTriggeredEvent && screen === "village" && character && (<>
                    <Suspense fallback={null}>
                        <NextGoalPin character={character} navigate={navigate} />
                    </Suspense>
                    <Village character={character} setScreen={navigate} />
                </>)}
                {!activeTriggeredEvent && screen === "worldMap" && character && (
                    <WorldMap
                        key={worldMapKey}
                        onLaunchWeeklyBoss={() => navigate("weeklyBoss")}
                        setCurrentBiome={setCurrentBiome}
                        setScreen={navigate}
                        character={character}
                        updateCharacter={setCharacter}
                        creatorEvents={creatorEvents}
                        creatorRaids={creatorRaids}
                        petEncounterVn={petEncounterVn}
                        ancientChestVn={ancientChestVn}
                        setRaidBattleKind={setRaidBattleKind}
                        setPendingPetBattleOpponent={setPendingPetBattleOpponent}
                        requestCardChallenge={() => setCardAutoStart(true)}
                        recordMissionExplore={recordMissionExplore}
                        playableAis={playableAis}
                        setCurrentWeather={setCurrentWeather}
                        playerRoster={playerRoster}
                        currentSector={currentSector}
                        setCurrentSector={setCurrentSector}
                        isTraveling={isTraveling}
                        travelingUntil={travelingUntil}
                        setTravelingUntil={setTravelingUntil}
                        setPendingTravel={setPendingTravel}
                        acceptedMissionIds={acceptedMissionIds}
                        setAcceptedMissionIds={setAcceptedMissionIds}
                        missionProgress={missionProgress}
                        setMissionProgress={setMissionProgress}
                        sharedImages={sharedImages}
                        onDungeonFound={(token) => { void triggerDungeonEncounter("worldMap", undefined, token); }}
                        onEnterHollowGate={() => { void enterHollowGateShrine(); }}
                        hollowGateEventConfig={hollowGateEventConfig}
                        onEnterHollowGateEvent={(cfg) => { void enterHollowGateShrine(cfg); }}
                        onDescendRift={(rift: HollowRift) => { void enterHollowGateShrine(riftEventConfig(rift)); }}
                        setPvpBattleId={setPvpBattleId}
                        setPvpRole={setPvpRole}
                        setPvpBattleContext={setPvpBattleContext}
                        setPvpSeedSession={setPvpSeedSession}
                        savedBloodlines={savedBloodlines}
                        creatorJutsus={creatorJutsus}
                        creatorItems={creatorItems}
                        onVersionedCharacter={commitVersionedCharacter} onOwnSaveRead={adoptOwnSaveRead}
                        capturePvpCreateScope={capturePvpCreateScope}
                        onServerVersion={(version) => acceptExternalSaveVersion(version, character.name) === "accepted"} attackSleeper={(opponent) => { void strikeDownSleeper({ opponent, attackerName: character.name, isTraveling, setCharacter, setPlayerRoster }); }}
                        sectorAttackPlayer={async (opponent) => { if (!requireServerSettlement("pvpSession")) return;
                            const createOwnerName = character.name;
                            const createScope = capturePvpCreateScope(createOwnerName);
                            const createIsCurrent = createScope.isCurrent;
                            if (isTraveling) {
                                alert("You cannot attack while traveling.");
                                return;
                            }
                            if (peerIsTraveling(opponent)) return void alert(`${opponent.name} is traveling and cannot be attacked right now.`);
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
                            // Sector-mate records from /api/player/heartbeat only carry { avatarImage }
                            // (the full character is intentionally stripped for bandwidth). Fetch the
                            // opponent's combat save and resolve their FULL loadout — stats, armor,
                            // weapons + consumables/throwables (pvpItems), jutsu and bloodline — from
                            // THEIR own bloodlines + creator content. fetchPlayerCombatSave returns null
                            // (never throws) on failure, so the optimistic navigation above stays safe;
                            // the server also re-hydrates authoritatively from the save by p2Character.name.
                            const oppSave = await fetchPlayerCombatSave(opponent.name);
                            if (!createIsCurrent()) return;
                            const oppChar = oppSave?.character ?? normalizeCharacter(opponent.character as Character);
                            const oppBloodlines = oppSave?.savedBloodlines?.length ? oppSave.savedBloodlines : savedBloodlines;
                            const oppCreatorJutsus = oppSave?.creatorJutsus?.length ? [...creatorJutsus, ...oppSave.creatorJutsus] : creatorJutsus;
                            const opponentAllItems = getAllItems(oppSave?.creatorItems?.length ? [...creatorItems, ...oppSave.creatorItems] : creatorItems);
                            const p2Jutsus = getPvpJutsuLoadout(oppBloodlines, oppCreatorJutsus, oppChar);

                            const createBody = stringifyPvpSessionPayload({
                                useCurrentVitals: true,
                                requireWorldCoLocation: true,
                                baseRewards: true,
                                rewardSector: currentSector,
                                ...pvpSessionEnvironment(false, currentBiome, weatherEffects[currentWeather]?.positiveElement, weatherEffects[currentWeather]?.negativeElement),
                                p1Character: { ...selfChar, jutsu: p1Jutsus, pvpItems: getPvpItemLoadout(selfChar, selfAllItems), bloodlineMult: getBloodlineMultiplier(selfChar, savedBloodlines), armorFactor: getCharacterArmorFactor(selfChar, selfAllItems), armorRawDR: getCharacterArmorRawDR(selfChar, selfAllItems), itemDamagePct: getEquippedItemBonus(selfChar, selfAllItems, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(selfChar, selfAllItems, "absorbPercent"), itemReflectPct: getEquippedItemBonus(selfChar, selfAllItems, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(selfChar, selfAllItems, "lifeStealPercent"), itemShield: getEquippedItemBonus(selfChar, selfAllItems, "shield") },
                                p2Character: { ...oppChar, name: opponent.name, jutsu: p2Jutsus, pvpItems: getPvpItemLoadout(oppChar, opponentAllItems), bloodlineMult: getBloodlineMultiplier(oppChar, oppBloodlines), armorFactor: getCharacterArmorFactor(oppChar, opponentAllItems), armorRawDR: getCharacterArmorRawDR(oppChar, opponentAllItems), itemDamagePct: getEquippedItemBonus(oppChar, opponentAllItems, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(oppChar, opponentAllItems, "absorbPercent"), itemReflectPct: getEquippedItemBonus(oppChar, opponentAllItems, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(oppChar, opponentAllItems, "lifeStealPercent"), itemShield: getEquippedItemBonus(oppChar, opponentAllItems, "shield") },
                            });
                            setPvpBattleId((await loadPvpSessionCreate()).pvpStableBattleIdFromRequestBody(createBody));
                            setPvpRole("p1");
                            setPvpBattleContext({ mode: "standard", sectorAttack: true, raidKind: "raidPlayer", sector: currentSector });
                            const createResult = await (await loadPvpSessionCreate()).createPvpSessionWithRecovery(fetch, createOwnerName, createBody, {
                                signal: createScope.signal, isCurrent: createIsCurrent,
                            });
                            if (!createIsCurrent()) return;
                            if (createResult.kind === "recovered") {
                                installPvpRecovery(createResult.pending);
                                setScreen("pvpBattle");
                                return;
                            }
                            if (createResult.kind === "rejected") {
                                setPvpBattleId('');
                                setPvpSeedSession(null);
                                setRaidBattleKind("none");
                                setScreen("worldMap");
                                alert(createResult.error);
                                return;
                            }
                            const battleId = createResult.battleId;
                            if (createResult.kind === "ambiguous") {
                                setPvpBattleId(battleId);
                                setScreen("pvpBattle");
                                alert("The battle response was interrupted. Reconnecting to the authoritative session…");
                                return;
                            }
                            try {
                                const { confirmSectorBattleRegistration } = await import("./lib/village-war-map"); // lazy: sector-war client stays off the startup graph
                                await confirmSectorBattleRegistration(createOwnerName, currentSector, battleId, createScope);
                            } catch (error) {
                                if (!createIsCurrent()) return;
                                alert(error instanceof Error ? error.message : "The sector battle is still registering. Retry the same attack.");
                                return;
                            }
                            if (!createIsCurrent()) return;
                            setPvpSeedSession(createResult.session);
                            setPvpBattleId(battleId);
                            setScreen("pvpBattle");

                            // Notification is advisory after session+pointer publication.
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
                                    alert(`The battle is live, but ${opponent.name} could not be notified yet.`);
                                }
                            }).catch(() => { /* defender notification is best-effort; session is live regardless */ });
                        }}
                    />
                )}
                {!activeTriggeredEvent && screen === "sunscarFestival" && character && (
                    <SunscarFestival
                        character={character}
                        onVersionedCharacter={commitVersionedCharacter}
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
                        onStartDungeon={(event) => { void triggerDungeonEncounter("centralHub", event); }}
                        onVersionedCharacter={commitVersionedCharacter}
                        onServerVersion={(version) => { acceptExternalSaveVersion(version, character.name); }}
                        creatorItems={creatorItems}
                        setCreatorItems={setCreatorItems}
                        playableAis={playableAis}
                        sharedImages={sharedImages}
                        onOpenBloodlineMaker={(rank, element) => {
                            setBloodlineMakerInitialRank(rank);
                            setBloodlineMakerInitialElement(element ?? getCharacterElements(character)[0] ?? "");
                            setBloodlineMakerRankLocked(true);
                            setScreen("bloodlineMaker");
                        }}
                    />
                )}
                {!activeTriggeredEvent && screen === "storyHall" && character && (
                    <StoryHall
                        character={character}
                        setScreen={setScreen}
                    />
                )}
                {!activeTriggeredEvent && screen === "storyBoss" && character && <StoryBoss character={character} updateCharacter={setCharacter} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "training" && character && <Training character={character} onVersionedCharacter={commitVersionedCharacter} activeTraining={activeTraining} setActiveTraining={setActiveTrainingNow} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "home" && character && <Home character={character} updateCharacter={setCharacter} onVersionedCharacter={commitVersionedCharacter} onServerVersion={(version) => { acceptExternalSaveVersion(version, character.name); }} setScreen={navigate} onBack={leavePetHome} backLabel={petHomeReturnLabel(petHomeReturnScreen)} sharedImages={sharedImages} />}
                {!activeTriggeredEvent && screen === "pets" && character && <PetYard key={character.name.trim().toLowerCase()} character={character} updateCharacter={setCharacter} onVersionedCharacter={commitVersionedCharacter} onServerVersion={(version) => acceptExternalSaveVersion(version, character.name) === "accepted"} setScreen={navigate} onBack={leavePetHome} backLabel={petHomeReturnLabel(petHomeReturnScreen)} sharedImages={sharedImages} onImmediateSave={(char) => { void pushSaveToServer(char, currentAccountName).catch(() => {}); }} />}
                {!activeTriggeredEvent && screen === "petArena" && character && <PetArena character={character} updateCharacter={setCharacter} allServerPlayers={allServerPlayers} setScreen={setScreen} returnScreen={petHomeReturnScreen} sharedImages={sharedImages} duelChallenges={duelChallenges} setDuelChallenges={setDuelChallenges} pendingPetBattleOpponent={pendingPetBattleOpponent} onPendingPetBattleStarted={() => setPendingPetBattleOpponent(null)} pendingArenaMatch={pendingArenaMatch} onPendingArenaMatchStarted={() => setPendingArenaMatch(null)} pendingArenaResponse={pendingArenaResponse} onArenaResponseHandled={() => { if (pendingArenaResponse) void clearChallengeOnServer(pendingArenaResponse); setPendingArenaResponse(null); }} onClanWarBattleEnd={autoReportClanWarBattleResult} onBattleActiveChange={setPetBattleActive} onFullscreenActiveChange={setPetFullscreenActive} onServerVersion={acceptExternalSaveVersion} onVersionedCharacter={(next, version, origin) => saveConflictAccountKey(next.name) === saveConflictAccountKey(origin) ? (commitVersionedCharacter(next, version) ? "accepted" : "stale") : "foreign"} />}
                {!activeTriggeredEvent && screen === "petShowdown" && character && <PetShowdown character={character} updateCharacter={setCharacter} setScreen={setScreen} sharedImages={sharedImages} onBattleActiveChange={setPetBattleActive} onFullscreenActiveChange={setPetFullscreenActive} />}
                {/* The Coliseum proper: the same arena, opened as a PAID bout. */}
                {!activeTriggeredEvent && screen === "petColiseum" && character && <PetShowdown bout="arena" character={character} updateCharacter={setCharacter} setScreen={setScreen} sharedImages={sharedImages} onBattleActiveChange={setPetBattleActive} onFullscreenActiveChange={setPetFullscreenActive} />}
                {!activeTriggeredEvent && screen === "petLadder" && character && <PetLadder character={character} setScreen={setScreen} sharedImages={sharedImages} />}
                {/* An authored VN pet battle. The opponent is no longer scaled here:
                    the server reads the same authored row out of its own copy of the
                    event and builds the beast from it, so this passes a SELECTOR
                    (which authored fight) rather than a statline. */}
                {!activeTriggeredEvent && screen === "eventPetBattle" && character && pendingEventEncounter && (
                    <DungeonPetBattle
                        character={character}
                        encounter={{
                            kind: "story-event",
                            eventId: pendingEventEncounter.event.id,
                            petId: pendingEventEncounter.battle?.petId ?? "",
                            difficulty: pendingEventEncounter.battle?.difficulty,
                        }}
                        enemyOwner={pendingEventEncounter.event.name}
                        onWin={completeEventEncounter}
                        onLeave={leaveEventEncounter}
                        sharedImages={sharedImages}
                    />
                )}
                {!activeTriggeredEvent && screen === "jutsuTraining" && character && <JutsuTrainingHall character={character} updateCharacter={setCharacter} onVersionedCharacter={commitVersionedCharacter} savedBloodlines={savedBloodlines} creatorJutsus={creatorJutsus} activeJutsuTraining={activeJutsuTraining} setActiveJutsuTraining={setActiveJutsuTrainingNow} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "missions" && character && <Missions key={character.name.trim().toLowerCase()} character={character} updateCharacter={setCharacter} onVersionedCharacter={commitVersionedCharacter} onServerVersion={(version) => acceptExternalSaveVersion(version, character.name) === "accepted"} creatorAis={playableAis} creatorMissions={creatorMissions} acceptedMissionIds={acceptedMissionIds} setAcceptedMissionIds={setAcceptedMissionIds} missionProgress={missionProgress} setMissionProgress={setMissionProgress} setScreen={setScreen} onBack={goBack} onMissionBattleStart={() => setMissionBattleActive(true)} onMissionBattleEnd={() => setMissionBattleActive(false)} sharedImages={sharedImages} creatorItems={creatorItems} savedBloodlines={savedBloodlines} creatorJutsus={creatorJutsus} />}
                {!activeTriggeredEvent && screen === "hunting" && character && <HunterBoard character={character} updateCharacter={setCharacter} onVersionedCharacter={commitVersionedCharacter} onServerVersion={(version) => acceptExternalSaveVersion(version, character.name) === "accepted"} creatorAis={playableAis} acceptedMissionIds={acceptedMissionIds} setAcceptedMissionIds={setAcceptedMissionIds} missionProgress={missionProgress} setMissionProgress={setMissionProgress} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "logbook" && character && <Logbook character={character} updateCharacter={setCharacter} creatorAis={playableAis} creatorMissions={creatorMissions} creatorEvents={creatorEvents} creatorRaids={creatorRaids} acceptedMissionIds={acceptedMissionIds} setAcceptedMissionIds={setAcceptedMissionIds} missionProgress={missionProgress} setMissionProgress={setMissionProgress} setCurrentSector={setCurrentSector} setCurrentBiome={setCurrentBiome} setCurrentWeather={setCurrentWeather} setScreen={setScreen} onVersionedCharacter={commitVersionedCharacter} onServerVersion={(version) => acceptExternalSaveVersion(version, character.name) === "accepted"} />}
                {!activeTriggeredEvent && screen === "townHall" && character && <TownHall character={character} updateCharacter={setCharacter} onVersionedCharacter={commitVersionedCharacter} onServerVersion={(version) => acceptExternalSaveVersion(version, character.name) === "accepted"} creatorItems={creatorItems} allServerPlayers={allServerPlayers} savedBloodlines={savedBloodlines} creatorJutsus={creatorJutsus} sharedImages={sharedImages} setScreen={setScreen} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "clan" && character && <ClanHall character={character} updateCharacter={setCharacter} onVersionedCharacter={commitVersionedCharacter} creatorItems={creatorItems} setScreen={setScreen} sharedImages={sharedImages} onRecordBattle={recordBattle} towerHostLoadout={(() => { const it = getAllItems(creatorItems); return { pvpItems: getPvpItemLoadout(character, it), bloodlineMult: getBloodlineMultiplier(character, savedBloodlines), armorFactor: getCharacterArmorFactor(character, it), armorRawDR: getCharacterArmorRawDR(character, it), itemDamagePct: getEquippedItemBonus(character, it, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(character, it, "absorbPercent"), itemReflectPct: getEquippedItemBonus(character, it, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(character, it, "lifeStealPercent"), itemShield: getEquippedItemBonus(character, it, "shield") }; })()} />}
                {!activeTriggeredEvent && screen === "bank" && character && <Bank character={character} updateCharacter={setCharacter} onVersionedCharacter={commitVersionedCharacter} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "shop" && character && <Shop character={character} creatorItems={creatorItems} creatorCards={creatorCards} onBack={goBack} onVersionedCharacter={commitVersionedCharacter} />}
                {!activeTriggeredEvent && screen === "grandMarketplace" && character && <GrandMarketplace character={character} creatorItems={creatorItems} creatorCards={creatorCards} onBack={goBack} onVersionedCharacter={commitVersionedCharacter} />}
                {!activeTriggeredEvent && screen === "shinobiTiles" && character && <CardHall character={character} updateCharacter={setCharacter} creatorCards={creatorCards} onBack={goBack} autoStart={cardAutoStart} onAutoStartConsumed={() => setCardAutoStart(false)} onVersionedCharacter={commitVersionedCharacter} onServerVersion={(version) => acceptExternalSaveVersion(version, character.name) === "accepted"} onStartFreePlay={(matchId) => { try { sessionStorage.setItem("cardClashFreePlay.v1", JSON.stringify({ matchId })); } catch { /* ignore */ } setScreen("cardClashFreePlay"); }} />}
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
                            pushHollowGateLog("The retired Tile Seal closes without granting persistent rewards.");
                            setHollowGateTileGameActive(false);
                            setScreen("hollowGateShrine");
                        }}
                        onDungeonLose={() => {
                            pushHollowGateLog("The retired Tile Seal closes without changing server-owned HP or Threat.");
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
                {!activeTriggeredEvent && screen === "hospital" && character && <Hospital character={character} updateCharacter={setCharacter} setScreen={navigate} playerRoster={playerRoster} onServerVersion={(version) => acceptExternalSaveVersion(version, character.name) === "accepted"} onVersionedCharacter={commitVersionedCharacter} />}
                {!activeTriggeredEvent && screen === "professions" && character && <Professions character={character} updateCharacter={setCharacter} setScreen={navigate} onBack={goBack} playerRoster={playerRoster} onVersionedCharacter={commitVersionedCharacter} onServerVersion={(version) => acceptExternalSaveVersion(version, character.name) === "accepted"} />}
                {!activeTriggeredEvent && screen === "cafeteria" && character && <Cafeteria character={character} onVersionedCharacter={commitVersionedCharacter} onBack={goBack} />}
                {!activeTriggeredEvent && screen === "tavern" && character && <VillageTavern character={character} onBack={goBack} sharedImages={sharedImages} onViewProfile={(name) => { setViewingUserName(name); navigate("userView"); }} playerRoster={playerRoster} />}
                {!activeTriggeredEvent && screen === "messages" && character && <Messages character={character} onBack={goBack} initialWith={viewingUserName} />}
                {!activeTriggeredEvent && screen === "hallOfLegends" && character && <HallOfLegends character={character} setScreen={setScreen} playerRoster={playerRoster} updateCharacter={setCharacter} />}
                {!activeTriggeredEvent && screen === "worldCrisis" && character && <WorldCrisis character={character} setScreen={navigate} sharedImages={sharedImages} onVersionedCharacter={commitVersionedCharacter} onRecordBattle={recordBattle} hostLoadout={(() => { const it = getAllItems(creatorItems); return { pvpItems: getPvpItemLoadout(character, it), bloodlineMult: getBloodlineMultiplier(character, savedBloodlines), armorFactor: getCharacterArmorFactor(character, it), armorRawDR: getCharacterArmorRawDR(character, it), itemDamagePct: getEquippedItemBonus(character, it, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(character, it, "absorbPercent"), itemReflectPct: getEquippedItemBonus(character, it, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(character, it, "lifeStealPercent"), itemShield: getEquippedItemBonus(character, it, "shield") }; })()} />}
                {!activeTriggeredEvent && screen === "endlessTower" && character && (
                    <EndlessTowerLobby
                        character={character}
                        onEnter={startEndlessBattle}
                        onBank={bankEndlessRewards}
                        onBack={goBack}
                    />
                )}
                {/* The sealed PET duel. It renders on the shrine because the
                    encounter belongs to the run: the bout is bound to the run
                    token server-side and mints the receipt combat-settle
                    redeems, so detouring through the Pet Arena had nothing left
                    to do except run a second engine. */}
                {!activeTriggeredEvent && screen === "hollowGateShrine" && character && hollowGatePetFight
                    && (character.pets ?? []).some((pet) => pet.id === character.activePetId) && (
                    <Suspense fallback={null}>
                        <HollowGatePetFight
                            key={hollowGatePetFight.runId}
                            character={character}
                            fight={hollowGatePetFight}
                            activePet={(character.pets ?? []).find((pet) => pet.id === character.activePetId)!}
                            sharedImages={sharedImages}
                            onSettled={(result) => {
                                const gate = hollowGatePetFight;
                                if (result.character) commitVersionedCharacter(result.character, result._saveVersion);
                                onHollowGatePetBattleEnd(result, gate);
                            }}
                            onUnavailable={(reason) => {
                                setHollowGatePetFight(null);
                                pushHollowGateLog(`The seal refused the duel: ${reason}`);
                            }}
                        />
                    </Suspense>
                )}
                {!activeTriggeredEvent && screen === "hollowGateShrine" && character && hollowGatePveFight && (
                    <HollowGateFight
                        character={character}
                        fight={hollowGatePveFight}
                        sharedImages={sharedImages}
                        savedBloodlines={savedBloodlines}
                        creatorJutsus={creatorJutsus}
                        creatorItems={creatorItems}
                        settle={settleActiveHollowGateCombat}
                        onResolved={finishHollowGatePveFight}
                        onRecordBattle={recordBattle}
                    />
                )}
                {endlessFight && character && (
                    <EndlessTowerFight
                        character={character}
                        fight={endlessFight}
                        sharedImages={sharedImages}
                        savedBloodlines={savedBloodlines}
                        creatorJutsus={creatorJutsus}
                        creatorItems={creatorItems}
                        settle={settleEndlessFight}
                        onNext={nextEndlessWave}
                        onBank={bankEndlessRewards}
                        onClose={closeEndlessFight}
                        onHospital={() => navigate("hospital")}
                    />
                )}
                {!activeTriggeredEvent && screen === "battleTowers" && character && (
                    <BattleTowers character={character} updateCharacter={setCharacter} onVersionedCharacter={commitVersionedCharacter} sharedImages={sharedImages} hostLoadout={(() => { const it = getAllItems(creatorItems); return { pvpItems: getPvpItemLoadout(character, it), bloodlineMult: getBloodlineMultiplier(character, savedBloodlines), armorFactor: getCharacterArmorFactor(character, it), armorRawDR: getCharacterArmorRawDR(character, it), itemDamagePct: getEquippedItemBonus(character, it, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(character, it, "absorbPercent"), itemReflectPct: getEquippedItemBonus(character, it, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(character, it, "lifeStealPercent"), itemShield: getEquippedItemBonus(character, it, "shield") }; })()} onExit={goBack} onRecordBattle={recordBattle} />
                )}
                {!activeTriggeredEvent && screen === "weeklyBoss" && character && (
                    <WeeklyBossArena
                        character={character}
                        onVersionedCharacter={commitVersionedCharacter}
                        creatorAis={playableAis}
                        setScreen={setScreen}
                        playerRoster={playerRoster}
                        sharedImages={sharedImages}
                    />
                )}
                {!activeTriggeredEvent && screen === "villageWar" && character && <VillageWarScreen character={character} playerRoster={playerRoster} onBack={goBack} onVersionedCharacter={commitVersionedCharacter} />}
                {!activeTriggeredEvent && screen === "villageWarMap" && villageWarScreenMountAllowed(screen, villageWarAvailability) && character && <VillageWarMap character={character} onBack={goBack} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "sectorCard" && villageWarScreenMountAllowed(screen, villageWarAvailability) && character && <SectorWarCardBattle character={character} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "sectorPet" && villageWarScreenMountAllowed(screen, villageWarAvailability) && character && <SectorWarPetBattle character={character} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "sectorGarrison" && villageWarScreenMountAllowed(screen, villageWarAvailability) && character && <SectorWarGarrisonAssault character={character} sharedImages={sharedImages} onVersionedCharacter={commitVersionedCharacter} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "clanWarPet" && character && <ClanWarPetBattle character={character} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "clanWar2v2" && character && <ClanWar2v2Battle character={character} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "cardClashFreePlay" && character && <CardClashFreePlay character={character} setScreen={setScreen} />}
                {!activeTriggeredEvent && screen === "shinobiCouncil" && character && <ShinobiCouncilHall character={character} setScreen={setScreen} playerRoster={playerRoster} launchClanWarBattle={launchClanWarBattle} onBack={goBack} />}
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
                        onVersionedCharacter={commitVersionedCharacter}
                        onDeleteCharacter={deleteCharacter}
                        onOpenBattle={(battleId) => { setViewedBattleId(battleId); setScreen("battleLog"); }}
                    />
                )}
                {!activeTriggeredEvent && screen === "battleLog" && character && viewedBattleId && (
                    <BattleLogScreen
                        battleId={viewedBattleId}
                        playerName={character.name}
                        onBack={() => setScreen("profile")}
                    />
                )}
                {!activeTriggeredEvent && screen === "inventory" && character && (
                    <Inventory
                        character={character}
                        updateCharacter={setCharacter}
                        onVersionedCharacter={commitVersionedCharacter}
                        creatorItems={creatorItems}
                        creatorCards={creatorCards}
                        setScreen={setScreen}
                    />
                )}

                {!activeTriggeredEvent && (screen === "arena" || screen === "battleArena" || screen === "arenaDistrict") && character && (
                    <Arena
                        lobbyMode={screen === "arenaDistrict" ? "arenaDistrict" : "battleArena"}
                        sharedImages={sharedImages}
                        character={character}
                        updateCharacter={setCharacter}
                        savedBloodlines={savedBloodlines}
                        creatorJutsus={creatorJutsus}
                        playerRoster={playerRoster}
                        duelChallenges={duelChallenges}
                        setDuelChallenges={setDuelChallenges}
                        setScreen={navigate}
                        setPvpBattleId={setPvpBattleId}
                        setPvpRole={setPvpRole}
                        setPendingPetBattleOpponent={setPendingPetBattleOpponent}
                        onAcceptChallenge={(challenge) => { void acceptChallengeGlobal(challenge); }}
                        onDeclineChallenge={declineChallengeGlobal}
                        onAcceptPetChallenge={(challenge) => { void acceptPetChallengeGlobal(challenge); }}
                    />
                )}

                {screen === "pvpBattle" && character && pvpBattleId && pvpRole && (() => {
                    const pvpOriginatingPlayerName = character.name;
                    const pvpOriginatingSessionEpoch = saveSessionEpochRef.current;
                    const pvpSettlementScopeKey = `${playerSlug(pvpOriginatingPlayerName)}:${pvpOriginatingSessionEpoch}:${pvpRole}:${pvpBattleId}`;
                    const pvpJutsus = getPvpJutsuLoadout(savedBloodlines, creatorJutsus, character);
                    const pvpAllItems = getAllItems(creatorItems);
                    const pvpItems = (["hand", "weapon", "thrown", "item1", "item2", "item3", "item", "potion"] as EquipmentSlot[])
                        .map(slot => character.equipment[slot])
                        .filter((id): id is string => Boolean(id))
                        .map(id => getItemById(pvpAllItems, id))
                        .filter((item): item is GameItem => Boolean(item));
                    function requirePvpContinuation(continuation?: PvpRewardContinuationContext): PvpRewardContinuationContext {
                        const ownerStillCurrent = playerSlug(characterRef.current?.name ?? "") === playerSlug(pvpOriginatingPlayerName);
                        const saveSessionStillCurrent = saveSessionEpochRef.current === pvpOriginatingSessionEpoch;
                        if (!continuation || continuation.signal.aborted || !continuation.isCurrentScope() || !ownerStillCurrent || !saveSessionStillCurrent) {
                            throw new DOMException("PvP completion scope changed.", "AbortError");
                        }
                        return continuation;
                    }
                    async function handlePvpRewardClaim(
                        claim: PvpRewardClaimConfirmed,
                        continuation?: PvpRewardContinuationContext,
                    ): Promise<void> {
                        requirePvpContinuation(continuation);
                        // A lost completion ACK replays the claim snapshot. Once
                        // this battle's local projection has landed, do not replace
                        // it with the earlier claim row and then add its deltas again.
                        if (claim.character && !pvpCompletionUiRef.current.has(pvpSettlementScopeKey)) {
                            requirePvpContinuation(continuation);
                            commitVersionedCharacter(claim.character, claim._saveVersion);
                        }
                        const progression = claim.raidProgression;
                        if (!progression) return;
                        if (!pvpBattleId) return;
                        if (!appliedRaidReportUiRef.current.has(pvpSettlementScopeKey)) {
                            await mirrorExactRaidMissionCredits(
                                progression.fetchMissionsCredited,
                                playerSlug(pvpOriginatingPlayerName),
                                continuation,
                            );
                            requirePvpContinuation(continuation);
                            for (const mission of progression.missionsCompleted) {
                                requirePvpContinuation(continuation);
                                window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                                    detail: { name: mission.name, xp: mission.xpReward, profession: 'vanguard' },
                                }));
                            }
                            if (progression.territoryDamage > 0) {
                                await refreshWorldStateSnapshot(continuation);
                                requirePvpContinuation(continuation);
                            }
                            appliedRaidReportUiRef.current.add(pvpSettlementScopeKey);
                        }
                        requirePvpContinuation(continuation);
                    }

                    async function handlePvpWin(
                        _opponentName: string,
                        opponent?: Character,
                        _serverRating?: { field: string; value: number; delta: number },
                        _serverBase?: PvpWinBaseSummary,
                        serverClaim?: PvpRewardClaimConfirmed,
                        continuation?: PvpRewardContinuationContext,
                    ): Promise<void> {
                        const activeContinuation = requirePvpContinuation(continuation);
                        if (!character) return;
                        if (!pvpBattleId) throw new Error("PvP settlement is missing its battle id.");
                        const settledBattleId = pvpBattleId;
                        const context = pvpBattleContext;
                        const rewardSector = context?.sector ?? currentSector;
                        // Hoisted here so every reward/world-state write below can skip a casual spar.
                        const isFriendlyDuel = !context?.mode
                            || (context.mode === "standard" && !context.clanWarPoints && !context.sectorAttack);
                        // Kage transfer is replayed from the committed terminal
                        // session on the server. No client resolve belongs in this
                        // completion continuation.

                        let projection = pvpContinuationResultRef.current.get(pvpSettlementScopeKey);
                        if (!projection) {
                            projection = { bounty: undefined, missionCompletions: undefined };
                            if (pvpContinuationResultRef.current.size >= 128) {
                                const oldest = pvpContinuationResultRef.current.keys().next().value as string | undefined;
                                if (oldest) pvpContinuationResultRef.current.delete(oldest);
                            }
                            pvpContinuationResultRef.current.set(pvpSettlementScopeKey, projection);
                        }

                        if (projection.bounty === undefined) {
                            const bounty = isFriendlyDuel
                                ? null
                                : await claimBountyOnWin(pvpOriginatingPlayerName, settledBattleId, activeContinuation.signal);
                            requirePvpContinuation(activeContinuation);
                            projection.bounty = bounty;
                        }

                        // PvP raid completion — pass pvpBattleId so the server
                        // can cross-validate the win against the real PvpSession.
                        if (!isFriendlyDuel
                            && rewardSector > 0
                            && context?.raidKind === "raidPlayer"
                            && !serverClaim?.raidProgression) {
                            await recordMissionRaid(rewardSector, settledBattleId, undefined, pvpOriginatingPlayerName, activeContinuation);
                            requirePvpContinuation(activeContinuation);
                        }

                        // Clan-war PvP is help-forwarded by claim-rewards from
                        // the immutable terminal session. Browser storage is no
                        // longer part of that settlement authority.
                        // Win report — server validates against the real
                        // PvpSession + its own anti-abuse rules. Feeds Vanguard
                        // mission progress AND server-side Legacy tracking, so
                        // it fires for every real (non-spar) win, any profession.
                        if (!isFriendlyDuel && opponent && !serverClaim?.raidProgression) {
                            if (projection.missionCompletions === undefined) {
                                const response = await fetch('/api/missions/report-pvp-win', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        playerName: pvpOriginatingPlayerName,
                                        battleId: settledBattleId,
                                        opponentName: opponent.name,
                                    }),
                                    signal: activeContinuation.signal,
                                });
                                const data = await response.json().catch(() => ({}));
                                if (!response.ok) throw new Error(String(data?.error ?? `Mission settlement failed (HTTP ${response.status}).`));
                                requirePvpContinuation(activeContinuation);
                                projection.missionCompletions = Array.isArray(data?.missionsCompleted) ? data.missionsCompleted : [];
                            }
                        } else if (projection.missionCompletions === undefined) {
                            projection.missionCompletions = [];
                        }

                        // Read the owner save only after every remote mutation. It
                        // includes bounty/mission/version changes and gives replay a
                        // stable base instead of incrementing the render closure.
                        const ownerSave = await readPvpOwnerSaveForContinuation(pvpOriginatingPlayerName, activeContinuation);
                        requirePvpContinuation(activeContinuation);

                        if (!pvpCompletionUiRef.current.has(pvpSettlementScopeKey)) {
                            const versionDecision = acceptVersionedSnapshot(latestSaveVersionRef.current, ownerSave.version);
                            requirePvpContinuation(activeContinuation);
                            pvpCompletionUiRef.current.add(pvpSettlementScopeKey);
                            if (versionDecision.accepted) {
                                if (!commitVersionedCharacter(ownerSave.character, ownerSave.version)) {
                                    pvpCompletionUiRef.current.delete(pvpSettlementScopeKey);
                                    throw new Error("PvP owner save became stale before projection.");
                                }
                            }

                            if (projection.bounty) {
                                requirePvpContinuation(activeContinuation);
                                gameToast(`💰 Bounty: +${projection.bounty.amount.toLocaleString()} ryo for defeating ${projection.bounty.target}!`);
                            }
                            for (const mission of projection.missionCompletions ?? []) {
                                requirePvpContinuation(activeContinuation);
                                window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                                    detail: { name: mission.name, xp: mission.xpReward, profession: 'vanguard' },
                                }));
                            }
                        }
                        requirePvpContinuation(activeContinuation);
                    }
                    return (
                        <PvpBattleScreen
                            key={`${playerSlug(pvpOriginatingPlayerName)}:${pvpOriginatingSessionEpoch}:${pvpRole}:${pvpBattleId}`}
                            character={character}
                            accountSessionEpoch={saveSessionEpochRef.current}
                            isAccountSessionCurrent={() => (
                                saveSessionEpochRef.current === pvpOriginatingSessionEpoch
                                && playerSlug(characterRef.current?.name ?? "") === playerSlug(pvpOriginatingPlayerName)
                            )}
                            battleId={pvpBattleId}
                            role={pvpRole}
                            setScreen={navigate}
                            onViewBattleRecord={(battleId) => { setViewedBattleId(battleId); navigate("battleLog"); }}
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
                            onRewardClaim={handlePvpRewardClaim}
                            onCompletionConfirmed={() => setPvpCompletionConfirmed(true)}
                            onExit={(target) => { clearPvpBattleState(); setScreen(target); }}
                            onRecordBattle={recordBattle}
                            onLoss={async (_opponent, _serverRating, serverClaim, continuation) => {
                                const activeContinuation = requirePvpContinuation(continuation);
                                if (!pvpCompletionUiRef.current.has(pvpSettlementScopeKey)) {
                                    // onRewardClaim normally adopted this exact server
                                    // save. If an older response omitted it, read the
                                    // authoritative row; never replay `losses + 1` from
                                    // a render closure.
                                    if (pvpBattleContext?.mode === "ranked" && !serverClaim?.character) {
                                        const ownerSave = await readPvpOwnerSaveForContinuation(pvpOriginatingPlayerName, activeContinuation);
                                        requirePvpContinuation(activeContinuation);
                                        if (!commitVersionedCharacter(ownerSave.character, ownerSave.version)) {
                                            throw new Error("Ranked loss save became stale before projection.");
                                        }
                                    }
                                    requirePvpContinuation(activeContinuation);
                                    pvpCompletionUiRef.current.add(pvpSettlementScopeKey);
                                }
                                requirePvpContinuation(activeContinuation);
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
                {!introCinematicActive && <ScreenReadyProbe screen={screen} />}
                </ScreenErrorBoundary>
                </Suspense>
            </main>
            <ToastStacks
                achievementToasts={achievementToasts}
                missionToasts={missionToasts}
                onDismissAchievement={(achievement) => setAchievementToasts(prev => prev.filter(x => x !== achievement))}
                onDismissMission={(id) => setMissionToasts(prev => prev.filter(x => x.id !== id))}
            />
        </AdaptiveGameShell>
        </MaintenanceOperatorBoundary>
    );
}
/* ── Mobile banner timer widget ──────────────────────────────────────
   Shown in the top-right corner of the journey banner on xs/sm screens
   only. Desktop already has the left profile card for this information.
   ──────────────────────────────────────────────────────────────────── */
export type { LbTab, TavernMessage, PvpGroundEffectState, PvpSessionState } from "./types/pvp-ui";
