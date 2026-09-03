/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
import { useState, useEffect, useLayoutEffect, useMemo, useRef, lazy, Suspense, type ReactNode, type CSSProperties } from "react";
import "../styles/atlas-skin.css";
import { visiblePoll } from "../lib/poll";
// The Chronicle Scribe's codex hand-off ends on the pack-opening cinematic, so
// this screen chunk owns those two stylesheets the same way Shop does (the card
// view and the overlay are component modules and must stay CSS-free).
import "../styles/chronicle-duel.css";
import "../styles/card-pack-opening.css";
// Compact local event-modal glyphs shared with the rest of the game.
import {
    GiCardPickup,
    GiOpenTreasureChest,
    GiPawPrint,
    GiTrail,
} from "../components/icons/LightweightGameIcons";
// Currency/material rewards reuse the game's own emblem set so they match the HUD.
import { GameIcon } from "../components/icons/GameIcon";
import type { Biome, Screen, WeatherType } from "../types/core";
import type { Character, HollowGateEventConfig, PlayerRecord, VersionedCharacterCommit } from "../types/character";
import { gameConfirm } from "../components/GameAlert";
import { gameToast } from "../components/GameToast";
import type { CreatorAi } from "../types/creator-ai";
import type { CreatorMission, CreatorRaid } from "../types/missions";
import type { GameItem, Jutsu, SavedBloodline } from "../types/combat";
import type { Pet, PetTrait } from "../types/pet";
import { TERRITORY_HP_MAX, TERRITORY_REBUILD_COOLDOWN_MS } from "../constants/game";
import { getAllTileCards } from "../data/tile-cards";
import { TriggeredVisualNovel } from "../components/TriggeredVisualNovel";
import { addStoryTrait } from "../lib/character-progress";
import { SceneAmbience } from "../components/SceneAmbience";
import { SectorAvatar } from "../components/SectorAvatar";
import { WorldSectorCanvas } from "../components/WorldSectorCanvas";
import { WorldSectorOverlayLayer } from "../components/WorldSectorOverlayLayer";
import { ModalDialogScrim } from "../components/ModalDialogScrim";
import { WorldWandererDialog, type WorldWandererDialogState } from "../components/WorldWandererDialog";
import {
    WorldSectorCommandPanel,
    type WorldSectorCommandHunt,
    type WorldSectorCommandPlayer,
    type WorldSectorCommandTerritory,
} from "../components/WorldSectorCommandPanel";
import { resolveOwnAvatar } from "../lib/own-avatar";
// The dialog-only imports main carried here (SectorWanderer, questMetricForId,
// relicSurveyWalkthrough, epicForWanderer, metricLabel, timeLeftLabel) are not
// listed: the wanderer dialog they served is no longer inline in this screen —
// it is <WorldWandererDialog>, which imports what it needs itself. The
// <SectorWanderer> named in a comment further down is that component's, not a
// use from this file.
import { rollWanderers, isWanderersEnabled, currentWandererDayBucket, wandererPresenceGate, questForWanderer, isWandererOnCooldown, withWandererCooldown, WANDERER_FLEE_COOLDOWN_MS, WANDERER_DECLINE_COOLDOWN_MS, QUEST_GIVER_PRESENCE, pickRoamingQuestGivers, lockedQuestMetrics, parseWandererId, wandererRelocationSector, pruneWandererMoves, hasWandererRelocated, wanderersVisitingSector, type Wanderer } from "../lib/wanderers";
import { QUEST_BOSSES, questbookEntry, questbookStage, bossStatBonusFromChoices, rivalryEscalation } from "../lib/questbook";
import { standingReaction } from "../lib/wanderer-standing";
import {
    WANDERER_FIGHT_SETTLED_EVENT,
    WANDERER_PENDING_KEY,
    wandererFightPresentationFromContext,
    worldFightNeedsDurableFollowUp,
    type WandererFightPresentation,
    type WandererFightSettlement,
} from "../lib/wanderer-fight";
import { requestAiFight } from "../lib/ai-fight-request";
import { creatorEventPracticeOpponent } from "../lib/creator-event-practice";
import { mintAiRaidToken } from "../lib/ai-raid-api";
import type { WorldAiFightContext, WorldAiFightKind, WorldAiFightRequest } from "../../../shared/world-ai-fight";
import { wandererAvatar, wandererRobberPortrait, questBossPortrait, WANDERER_BOSS_PORTRAIT, WANDERER_NEMESIS_PORTRAIT } from "../lib/wanderer-art";
import { makeBuiltinAi } from "../lib/combat-ai";
import { genericPetArenaOpponents, type PetArenaOpponent } from "../data/pet-arena-opponents";
import { ROAD_WANDERER_PREFIX, nextRoadEvent, synthRoadWanderer, roadEventBySynthId, roadEventToCreatorEvent, reportStoryRoadEvent } from "../lib/story-road-events";
import { STORY_RECKONING_ACCEPT_TRAIT, visibleStoryReckonings, isStoryReckoningId, isStoryReckoningReturnEventId, storyReckoningForEventId, storyReckoningIntroEvent, storyReckoningPayoffEvent, acceptStoryReckoning, reportStoryReckoning, turnInStoryReckoning, abandonStoryReckoning } from "../lib/story-reckonings";
import type { StoryReckoning } from "../data/story-reckonings";
import { RIFT_GIVER_PREFIX, RIFT_ACCEPT_MARKER, RIFT_DESCEND_MARKER, RIFT_ABANDON_MARKER, nextRift, synthRiftGiver, riftBySynthId, riftIntroEvent, riftDescentEvent, riftByDescentEventId, isRiftDescentEventId, riftTargetSector, acceptRift, abandonRift } from "../lib/hollow-rifts";
import { hollowRiftById, type HollowRift } from "../data/hollow-rifts";
import { SCRIBE_WANDERER_ID, SCRIBE_ACCEPT_MARKER, CODEX_FLIP_LIMIT, scribeWandererFor, scribeIntroEvent, claimTravelersCodex, codexRevealCards } from "../lib/chronicle-scribe";
import { usePetMentorGuide } from "../lib/use-pet-mentor-guide";
import { CardPackOpening } from "../components/CardPackOpening";
import { displayCardsById } from "../lib/chronicle-duel";
// The RAW count, not lib/chronicle-duel's ownedChronicleCounts: that one applies
// the permanent starter floor, so it would report the whole teaching set as
// already owned and every card in Ihara's hand-off would lose its NEW badge.
import { countChronicleCards } from "../../../shared/chronicle-duel";
import { cardGameLockStatus } from "../lib/chronicle-lock";
import { anbuInfiltrationAdmissionEnabled } from "../lib/anbu-infiltration-api";
import {
    useCapabilityMutationAvailability,
    useCapabilityViewAvailability,
    useLiveCapabilities,
} from "../lib/live-capabilities-context";
import { capabilityAdmissionAllowed, mutationAdmissionMessage } from "../lib/live-capability-admission";
import { createPortal } from "react-dom";
import { travelMaskMs } from "../lib/travel-mask";
import { serverNow } from "../lib/server-clock";
import { peerIsTraveling } from "../lib/presence-character";

// Anbu Vault Infiltration (anbuInfiltration.v1) — lazy so the raid (which pulls
// in the whole BattleTowerFight screen) never weighs down the WorldMap chunk.
const AnbuVaultRaid = lazy(() => import("../features/anbuInfiltration/AnbuVaultRaid").then(m => ({ default: m.AnbuVaultRaid })));
import { SectorMap } from "../components/SectorMap";
import { SceneCritters } from "../components/SceneCritters";
import { DayNightSky } from "../components/DayNightSky";
import { HollowGateAttunement } from "../components/HollowGateAttunement";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { WorldToast } from "../components/WorldToast";
import { TravelingOverlay } from "../components/TravelingOverlay";
import { SECTOR_DEPTH_THEMES } from "../data/sector-depth-manifest";
import { ATLAS_SECTOR_POINTS } from "../data/sector-points";
import { sectorExits as roadExitsForSector, travelArrivalTile, type SectorExit } from "../../../shared/sector-links";
import { applyCurrencyRewards, rewardSummary } from "../lib/currency";
import { scaleWandererPetOpponent } from "../lib/pet-balance";
import { befriendWildPet, declineWildPetEncounter, startWildPetEncounter } from "../lib/wild-pet-encounter-api";
import {
    openAncientChest,
    recordSectorExplore,
    type ExploreCredit,
    type ExternalExploreProof,
    type FieldExploreProgress,
    type SectorExploreOutcome,
} from "../lib/world-reward-api";
import {
    beginExternalWorldExplore,
    beginResolvedWorldExplore,
    beginWorldDiscoveryOperation,
    beginWorldChestOperation,
    completeWorldRewardOperation,
    readPendingWorldRewards,
    type PendingWorldRewardOperation,
} from "../lib/world-reward-recovery";
import { DungeonProbeError, probeFreeDungeonServer } from "../lib/dungeon-api";
import { petCardImage } from "../lib/pet-battle-anim";
import { biomeForWorldSector, sectorRegionName, villageForOutskirtsSector, villageOutskirtsSectorNumber, weatherForBiome } from "../data/sectors";
import { biomeLabel, weatherEffects } from "../data/world";
import { builtinHuntMissions } from "../data/missions";
import { makeId, playerSlug, sameSector } from "../lib/utils";
import { setSectorReopen, takeSectorReopen, peekSectorReopen, consumeReloadIntoSector } from "../lib/sector-return";
import { isRecentlyStruckDown } from "../lib/sleeper-kill";
import { useLiveSectorRoster, setLocalSectorTile, getLocalSectorTile } from "../lib/presence-store";
import { updateRealtimeTile } from "../lib/use-presence-socket";
import { isSectorLivePeersEnabled } from "../components/sector-peers-flag";
import type { SectorPeer } from "../components/SectorPeers";
import { isWeeklyBossRoamEnabled, weeklyBossRoamState, weeklyBossRoamCooldownId, WEEKLY_BOSS_ROAM_REENGAGE_COOLDOWN_MS, type RoamingBoss } from "../lib/weekly-boss-roam";
import { playerNameTile } from "../lib/sector-tile";
import { defaultVnScene, splitDialogueLine } from "../lib/vn";
import { fetchPlayerCombatSave, pvpSessionEnvironment, stringifyPvpSessionPayload } from "../lib/pvp-session";
import { createPvpSessionWithRecovery, pvpStableBattleIdFromRequestBody } from "../lib/pvp-session-create";
import type { PendingPvpRecovery } from "../lib/pvp-pending-session";
import type { OwnSaveReadCommit } from "../lib/own-save-read";
const loadOwnSaveRead = () => import("../lib/own-save-read");
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { getAllItems } from "../lib/items";
import { getBloodlineMultiplier } from "../lib/combat-math";
import { cwListWars } from "../lib/clan-war-api";
import { fetchClanData } from "../lib/clan-api";
import { scoutIntelTier } from "../lib/clan-upgrades";
import { getCharacterArmorFactor, getCharacterArmorRawDR, getEquippedItemBonus, getPvpItemLoadout } from "../lib/equipment-stats";
import { hiddenDungeonVnEvent } from "../data/vn-events";
import { petTraitDescriptions } from "../data/pet-config";
import { starterItems } from "../data/starter-items";
import worldMapBg from "../assets/Maps/world_map-v2.webp";
import castleImg from "../assets/castle.webp";
import houseImg from "../assets/house1.webp";
import towerImg from "../assets/tower.webp";
import moonshadowImage from "../assets/moonshadow.webp";
import iceSectorImg from "../assets/sectors/ice.webp";
import darkSectorImg from "../assets/sectors/dark.webp";
import templeSectorImg from "../assets/sectors/temple.webp";
import waterSectorImg from "../assets/sectors/water.webp";
import forrestSectorImg from "../assets/sectors/forrest.webp";
import meadow2SectorImg from "../assets/sectors/meadow2.webp";
import meadowSectorImg from "../assets/sectors/meadow.webp";
import stormveilVillageImg from "../assets/sectors/stormveil-village.webp";
import stormveilLandmarkArt from "../assets/map-landmarks/stormveil.webp";
import ashenLeafLandmarkArt from "../assets/map-landmarks/ashen-leaf.webp";
import frostfangLandmarkArt from "../assets/map-landmarks/frostfang.webp";
import moonshadowLandmarkArt from "../assets/map-landmarks/moonshadow.webp";
import centralLandmarkArt from "../assets/map-landmarks/central.webp";
import hollowGateLandmarkArt from "../assets/map-landmarks/hollow-gate.webp";
import {
    gainXp,
    getPvpJutsuLoadout,
    normalizeCharacter,
    type CreatorEvent,
    type DuelChallenge,
    type EventEncounterBattle,
    type PvpSessionState,
    type SharedPvpBattleContext,
} from "../App";
import { villagePageImage } from "../lib/village-page-image";
import { villageOuterTerritoryMapUrl } from "../lib/village-outer-territory-map";
import { activeVillageWarsFor, loadSectorTerritory, territoryBreachMinsLeft, territoryIsBreached, territoryRewardsSuspended, weatherForSector, VILLAGE_WAR_GROUND_HP_MAX, VILLAGE_WAR_HP_MAX } from "../lib/world-state";
import { SECTOR_DEPLETED_MESSAGE, sectorExploreRefusal, sectorPoolViewFor } from "../lib/sector-pool";
import { richerSectorsNear, sectorRichnessLabel, sectorRichnessOf, type SectorRichness } from "../lib/sector-richness";
import { bumpSectorContractRevision, claimSectorContract, localSectorContract, useSectorContract } from "../lib/sector-contract";
import { useSectorIntelPlate } from "../lib/village-intel";
import { confirmSectorBattleRegistration, isVillageWarMapEnabled, villageAccent } from "../lib/village-war-map";
import { useAcademyWorldMapFocus, useWorldMapZoom } from "../lib/use-world-map-zoom";
import { SectorOwnershipOverlay } from "../components/SectorOwnershipOverlay";
import { isMercAiId } from "../lib/merc-ai";
import { fetchMercRoster, engageMerc, synthMercWanderer, type RoamingMercView } from "../lib/merc-roam-client";
import { fetchBountyBoard, startBountyHunter, type BountyEntry } from "../lib/pvp-bounty";
import { contractHunterLevel } from "../../../shared/contract-hunter";
import { contractHunterWanderers } from "../lib/contract-hunter-wanderers";
import { postWandererService, type WandererFavor } from "../lib/wanderer-service";
import { homeVillageForSector } from "../data/war-map-sectors";
import { isLegacyServerLive, useLegacyAvailability, useLegacyMutationAvailability, fetchSageState, fetchLegacyStatus, synthSageWanderer, LEGACY_SAGE_WANDERER_ID, type SageOfferView } from "../lib/legacy";
import { rollEmissarySpawn, EMISSARY_BY_SLUG, type EmissarySlug, type EmissaryQuestDef } from "../lib/legacy-emissaries";
import { EmissaryTrialPanel } from "../components/EmissaryTrialPanel";
import { nextUnseenRumorMilestone, markLevelRumorSeen, recordRumorHeard, rumorForCategory } from "../lib/legacy-rumors";
import { SageWhisper } from "../components/SageWhisper";
import { buildSageVnEvent } from "../lib/legacy-sage-vn";
import { SageOfferModal } from "../components/SageOfferModal";
import { huntReadyForFight, huntRequiredTracks, huntTrailSector } from "../lib/hunt-trail";
import { HUNT_PACK_STAGES, huntOpeningFor, huntPackMember, huntSignFor, type HuntChoice } from "../lib/hunt-encounter";
import { postWorldHunt, type WorldHuntTrailView } from "../lib/world-hunt-api";
import { HuntEncounterCard, type HuntEncounterView } from "../components/HuntEncounterCard";
import { beastPortrait } from "../data/hunter-art";
import { SECTOR_FLOOR_SECTORS } from "../data/sector-art-manifest";
import { FESTIVAL_SECTOR, isWildSector, MAX_WILD_SECTOR, sectorArtKey, sectorName } from "../../../shared/sector-geo";
import { shrineForSector } from "../../../shared/shrines";
import { WorldRoadsOverlay, WorldPoiPlates } from "../components/WorldRoadsOverlay";
import "../components/world-map-charting.css";
import { RouteGlowOverlay, regionSplashLabelFor, regionTintForSector } from "../components/WorldWalkFeel";
import "../components/world-walk-feel.css";
import { SectorTracesModal, type TracesModalState } from "../components/SectorTraces";
import { fetchSectorTraces, isSectorTracesEnabled, type SectorTracesView } from "../lib/sector-traces";

// Middle of the 12x12 sector board (row 6, col 6). Where a player lands after a
// map jump that has no direction to preserve, and the initial standing tile.
const SECTOR_CENTRE_TILE = 78;
// Which scene-image theme each sector shows. Single source of truth shared by
// the background image picker and the ambience-biome picker so the drifting
// particles always match the painted scene the player is looking at.
const SECTOR_IMAGE_GROUPS: Record<string, number[]> = {
    ice: [52, 48, 53, 54, 50, 55],
    dark: [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 17, 20, 19, 18, 14, 15, 13],
    temple: [34, 60, 59],
    water: [23, 26, 21, 22, 27, 32, 28, 33, 42],
    forrest: [36, 37, 38, 39, 40, 43, 46],
    stormveil: [31, 35, 10, 16],
    meadow2: [44, 24, 29, 30, 59, 1],
    meadow: [25, 41, 45, 47, 57, 51],
};

function sectorImageTheme(sector: number): string {
    for (const [theme, sectors] of Object.entries(SECTOR_IMAGE_GROUPS)) {
        if (sectors.includes(sector)) return theme;
    }
    return "meadow";
}

/*
 * Backdrop for the <SectorScene> vista stack. Since the painted top-down floors
 * cover every sector, that stack now renders ONLY for a territory carrying its
 * own custom `backgroundImage` (creator/admin art), which is passed in directly —
 * so this resolver is just the shared theme fallback. The 66 bespoke per-sector
 * vistas it used to return were retired with the opt-out path (2026-07-29): they
 * were unreachable by default and 7.3 MB of deploy weight.
 */
function sectorBackgroundImage(sector: number) {
    if (sector === 99) return "/deathgate-sector.webp";

    const village = villageForOutskirtsSector(sector);
    if (village) return villagePageImage(village);

    switch (sectorImageTheme(sector)) {
        case "ice": return iceSectorImg;
        case "dark": return darkSectorImg;
        case "temple": return templeSectorImg;
        case "water": return waterSectorImg;
        case "stormveil": return stormveilVillageImg;
        case "forrest": return forrestSectorImg;
        case "meadow2": return meadow2SectorImg;
        default: return meadowSectorImg;
    }
}

// Depth-map URL for a sector's painted scene, when one has been baked
// (scripts/gen-sector-depth.mjs). Mirrors sectorBackgroundImage's image choice
// so the depth lines up with what's shown: only theme images have maps for now —
// village outskirts, Death's Gate, and custom territory art fall back to the
// procedural depth in SectorScene3DScene.
function sectorDepthImage(sector: number): string | undefined {
    if (sector === 99) return undefined;
    if (villageForOutskirtsSector(sector)) return undefined;
    const theme = sectorImageTheme(sector);
    return SECTOR_DEPTH_THEMES.has(theme) ? `/sector-depth/${theme}.webp` : undefined;
}

/*
 * The painted top-down ADVENTURE MAP for a sector. Every sector 1-66 plus
 * Death's Gate (99) now has bespoke art, so this is a straight lookup — the ten
 * shared per-biome variant boards it used to fall back to were deleted
 * 2026-07-29 once s99 got its own board (it was the last consumer).
 *
 * Art files keep their pre-renumbering names, so resolve through sectorArtKey.
 */
function sectorMapUrl(_biome: Biome, seed: number): string | undefined {
    const artKey = sectorArtKey(seed);
    return SECTOR_FLOOR_SECTORS.has(artKey) ? `/sector-map/s${artKey}.webp` : undefined;
}

// Ambience biome (drives drifting particles + god-ray tint) chosen to match the
// painted scene image — NOT the territory biome, which can differ (e.g. a
// volcano-territory sector that paints as forest). Outskirts mirror their village.
function ambienceBiomeForSector(sector: number): Biome {
    if (sector === 99) return "volcano";
    // Every wild sector has painted floor art, and its painted region IS its
    // gameplay biome now (shared/sector-geo.ts), so ambience reads straight off
    // the registry. The village/theme fallbacks below only serve sector 0 and
    // any id outside the registry.
    if (sector >= 1) return biomeForWorldSector(sector);
    const village = villageForOutskirtsSector(sector);
    if (village === "Frostfang Village") return "snow";
    if (village === "Moonshadow Village") return "shadow";
    if (village === "Stormveil Village") return "forest";
    if (village === "Ashen Leaf Village") return "volcano";
    switch (sectorImageTheme(sector)) {
        case "ice": return "snow";
        case "dark": return "shadow";
        case "temple": return "shadow";   // cherry-blossom temple → drifting petals
        case "forrest": return "forest";
        case "stormveil": return "forest";
        case "water": return "central";   // soft motes over the lagoon
        case "meadow2": return "central";
        case "meadow": return "central";
        default: return "central";
    }
}

// "Return to the sector you were in" after an explore ambush is a one-shot latch
// in ../lib/sector-return (shared so the Hospital can clear it on a KO). See that
// module for the full lifecycle.

// Contract Hunter derivation lives in shared/contract-hunter.ts (the server
// settles the fight from the SAME function). Thin alias kept for the existing
// fight-launch call site below.
function bountyHunterLevel(playerLevel: number, amount: number): number {
    return contractHunterLevel(playerLevel, amount);
}

function interiorTileFromKey(key: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i += 1) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const col = 2 + ((h >>> 0) % 8);
    const row = 2 + (((h >>> 5) >>> 0) % 8);
    return row * 12 + col;
}

type ActiveHuntTrail = { mission: CreatorMission; sector: number; progress: number; requiredTracks: number };
type HuntToast = { id: number; kicker: string; text: string };
/** The open hunt encounter card: which trail, which beast, and what it's showing. */
type HuntEncounterState = { trail: ActiveHuntTrail; ai: CreatorAi; sector: number; view: HuntEncounterView };

const WORLD_FIGHT_KIND_BY_MODE: Readonly<Record<string, WorldAiFightKind>> = {
    single: "wanderer",
    ambush: "wanderer-ambush",
    patrol: "patrol",
    bountyHunter: "bounty-hunter",
    huntPack: "hunt-pack",
    huntTarget: "hunt-target",
    questboss: "questbook-boss",
    storyReckoning: "story-reckoning",
};

export function WorldMap({
    setCurrentBiome,
    setScreen,
    character,
    updateCharacter,
    creatorEvents,
    creatorRaids,
    petEncounterVn,
    ancientChestVn,
    setRaidBattleKind,
    setPendingPetBattleOpponent,
    requestCardChallenge,
    recordMissionExplore,
    playableAis,
    setCurrentWeather,
    playerRoster,
    currentSector,
    setCurrentSector,
    isTraveling,
    travelingUntil,
    setTravelingUntil,
    setPendingTravel,
    sectorAttackPlayer,
    attackSleeper,
    acceptedMissionIds,
    setAcceptedMissionIds,
    missionProgress,
    setMissionProgress,
    sharedImages = {},
    onDungeonFound,
    onEnterHollowGate,
    hollowGateEventConfig,
    onEnterHollowGateEvent,
    onDescendRift,
    setPvpBattleId,
    setPvpRole,
    setPvpBattleContext,
    setPvpSeedSession,
    savedBloodlines,
    creatorJutsus: wmCreatorJutsus,
    creatorItems: wmCreatorItems,
    onServerVersion,
    onVersionedCharacter,
    onOwnSaveRead,
    capturePvpCreateScope,
    onLaunchWeeklyBoss,
}: {
    setCurrentBiome: (biome: Biome) => void;
    setScreen: (screen: Screen) => void;
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    creatorEvents: CreatorEvent[];
    creatorRaids: CreatorRaid[];
    petEncounterVn: CreatorEvent;
    ancientChestVn: CreatorEvent;
    setRaidBattleKind: (kind: "none" | "raidAi" | "raidPlayer" | "defense") => void;
    setPendingPetBattleOpponent: (o: PetArenaOpponent | null) => void;
    requestCardChallenge: () => void;
    recordMissionExplore: (sector: number, worldExploreRequestId: string, fieldProgress?: FieldExploreProgress[]) => Promise<boolean>;
    playableAis: CreatorAi[];
    setCurrentWeather: (weather: WeatherType) => void;
    playerRoster: PlayerRecord[];
    currentSector: number;
    setCurrentSector: (sector: number) => void;
    isTraveling: boolean;
    travelingUntil: number;
    setTravelingUntil: (until: number) => void;
    setPendingTravel: (travel: { destinationSector: number; arrivalAt: number } | null) => void;
    sectorAttackPlayer: (opponent: PlayerRecord) => void;
    attackSleeper: (opponent: PlayerRecord) => void;
    acceptedMissionIds: string[];
    setAcceptedMissionIds: React.Dispatch<React.SetStateAction<string[]>>;
    missionProgress: Record<string, number>;
    setMissionProgress: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    sharedImages?: Record<string, string>;
    onDungeonFound: (token: string) => void;
    onEnterHollowGate?: () => void;
    // Active event gate (admin-authored) — shows the event entry in the
    // Hollow Gate menu and hands the config back on entry.
    hollowGateEventConfig?: HollowGateEventConfig | null;
    onEnterHollowGateEvent?: (cfg: HollowGateEventConfig) => void;
    // Descend into a wandering-quest rift (a scaled event Hollow Gate). Enters via
    // the same event-gate path and SHARES the daily Hollow Gate run cap (a rift
    // counts against the 2/day). If capped, the rift persists (7-day TTL) or can be
    // abandoned at the rift; the shared cap is the backstop on the shrine-clear haul.
    onDescendRift?: (rift: HollowRift) => void;
    setPvpBattleId: (id: string) => void;
    setPvpRole: (role: "p1" | "p2") => void;
    setPvpBattleContext: (context: SharedPvpBattleContext | null) => void;
    setPvpSeedSession: (session: PvpSessionState | null) => void;
    savedBloodlines: SavedBloodline[];
    creatorJutsus: Jutsu[];
    creatorItems: GameItem[];
    // Adopt the save version returned by a server-settled action (wild-pet
    // befriending), so the next autosave isn't rejected as stale.
    onServerVersion?: (version?: number) => boolean;
    onVersionedCharacter: VersionedCharacterCommit;
    onOwnSaveRead: OwnSaveReadCommit;
    capturePvpCreateScope: (ownerName: string) => { signal: AbortSignal; isCurrent: () => boolean };
    // Launch the REAL weekly-boss fight. The Phase 3 roaming encounter routes
    // through App's launchWeeklyBossFight so damage → the shared leaderboard and
    // the 3-attempt cap — same path as the "Fight Boss" button.
    onLaunchWeeklyBoss?: (bossAiId: string, bossDisplayName?: string, returnScreen?: Screen) => void;
}) {
    const legacyAvailable = useLegacyAvailability();
    const legacyActionsAvailable = useLegacyMutationAvailability();
    const { mutationAvailability } = useLiveCapabilities();
    const villageWarViewAvailability = useCapabilityViewAvailability("villageWar");
    const villageWarMutationAvailability = useCapabilityMutationAvailability("villageWar");
    const anbuViewAvailability = useCapabilityViewAvailability("anbuInfiltration");
    const anbuMutationAvailability = useCapabilityMutationAvailability("anbuInfiltration");
    const globalViewAvailability = useCapabilityViewAvailability();
    const globalMutationAvailability = useCapabilityMutationAvailability();
    const villageWarViewOpen = capabilityAdmissionAllowed(villageWarViewAvailability);
    const villageWarAdmissionOpen = capabilityAdmissionAllowed(villageWarMutationAvailability);
    const anbuViewOpen = anbuInfiltrationAdmissionEnabled(anbuViewAvailability);
    const anbuAdmissionOpen = anbuInfiltrationAdmissionEnabled(anbuMutationAvailability);
    const globalViewOpen = capabilityAdmissionAllowed(globalViewAvailability);
    const globalMutationsOpen = capabilityAdmissionAllowed(globalMutationAvailability);
    // Live players in the current sector come from the presence store. WorldMap reads
    // the MEMBERSHIP-only snapshot (useLiveSectorRoster) — it re-renders on join/leave
    // but NOT when a peer merely walks to a new tile; the walking overlay
    // (<SectorPeersLive>) subscribes to the full tile-sensitive snapshot itself, so a
    // crowd in motion doesn't re-render this whole screen.
    const liveSectorPlayers = useLiveSectorRoster();
    const [selectedSector, setSelectedSector] = useState<number | null>(null);
    const sectorIntelPlate = useSectorIntelPlate(selectedSector, character.village); // pure projection; the refresh is its effect, never a render
    // Only the ~6 posted sectors ever reach the network (the board itself is a
    // pure local computation over the same shared module the server uses).
    const sectorContract = useSectorContract(selectedSector, character.name);
    const [contractBusy, setContractBusy] = useState(false);
    // Direction the player walked in from on an edge crossing — drives the brief
    // slide-in on the sector board (cleared right after the animation plays).
    const [sectorEnterDir, setSectorEnterDir] = useState<"north" | "east" | "south" | "west" | null>(null);
    // Once-per-session region-name splash + the hovered walking-route target.
    const [regionSplash, setRegionSplash] = useState<{ label: string; tint: string; stamp: number } | null>(null);
    const [routeHoverSector, setRouteHoverSector] = useState<number | null>(null);
    const [selectedVillageTerritory, setSelectedVillageTerritory] = useState<typeof locations[number] | null>(null);
    const [territoryGuards, setTerritoryGuards] = useState<{ name: string; level: number; village: string; defenseBonusPercent?: number }[]>([]);
    const [sectorEnemyGuards, setSectorEnemyGuards] = useState<{ name: string; level: number; defenseBonusPercent?: number }[]>([]);
    const [huntToast, setHuntToast] = useState<HuntToast | null>(null);
    const [travelToast, setTravelToast] = useState<HuntToast | null>(null);
    const [huntEncounter, setHuntEncounter] = useState<HuntEncounterState | null>(null);
    const aiRaidLaunchInFlight = useRef(false);
    const [authoritativeHuntStates, setAuthoritativeHuntStates] = useState<Record<string, WorldHuntTrailView>>({});
    const activeHuntTrails = useMemo<ActiveHuntTrail[]>(() => (
        builtinHuntMissions
            .filter((mission) => acceptedMissionIds.includes(mission.id) && Boolean(mission.aiProfileId))
            .map((mission) => {
                const authoritative = authoritativeHuntStates[mission.id];
                const progress = authoritative?.progress ?? missionProgress[mission.id] ?? 0;
                const requiredTracks = authoritative?.requiredTracks ?? huntRequiredTracks(mission);
                if (authoritative?.claimable || authoritative?.targetDefeated || progress >= requiredTracks) return null;
                return {
                    mission,
                    sector: authoritative?.sector ?? huntTrailSector(mission, progress, playerSlug(character.name)),
                    progress,
                    requiredTracks,
                };
            })
            .filter((trail): trail is ActiveHuntTrail => Boolean(trail))
    ), [acceptedMissionIds, authoritativeHuntStates, missionProgress, character.name]);
    const huntTrailForSector = (sector: number) => activeHuntTrails.find((trail) => trail.sector === sector);
    const acceptedHuntKey = builtinHuntMissions
        .filter((mission) => acceptedMissionIds.includes(mission.id))
        .map((mission) => mission.id)
        .sort()
        .join("|");

    function adoptHuntProgressMirror(
        missionId: string,
        state?: WorldHuntTrailView | null,
        serverProgress?: Record<string, number>,
    ) {
        setMissionProgress((current) => {
            const next = serverProgress ? { ...serverProgress } : { ...current };
            const mission = builtinHuntMissions.find((entry) => entry.id === missionId);
            // Presentation-only completion mirror. Claim authority remains the
            // server's sealed hunt-target receipt; this merely keeps the normal
            // Hunter Guild turn-in button reachable after refresh/lost response.
            if (mission && (state?.claimable || state?.targetDefeated)) {
                next[missionId] = mission.exploreCount;
            }
            return next;
        });
    }

    // Hydrate markers from the authoritative trail ledger on every WorldMap
    // mount/account/accepted-contract change. A pending pack marker deliberately
    // remains at its decision sector; after settlement the server moves it to the
    // next lead. This also migrates accepted pre-ledger hunts without an abandon.
    useEffect(() => {
        let cancelled = false;
        const missionIds = acceptedHuntKey ? acceptedHuntKey.split("|") : [];
        if (missionIds.length === 0) {
            setAuthoritativeHuntStates({});
            return () => { cancelled = true; };
        }
        void (async () => {
            const next: Record<string, WorldHuntTrailView> = {};
            for (const missionId of missionIds) {
                const result = await postWorldHunt({ playerName: character.name, action: "state", missionId });
                if (cancelled) return;
                if (!result.ok) continue;
                if (result.character) {
                    if (!onVersionedCharacter(result.character, result._saveVersion)) continue;
                } else if (onServerVersion?.(result._saveVersion) === false) {
                    continue;
                }
                if (result.acceptedMissionIds) setAcceptedMissionIds(result.acceptedMissionIds);
                adoptHuntProgressMirror(missionId, result.state, result.missionProgress);
                if (result.state) next[missionId] = result.state;
                if (result.migrated && result.state) {
                    setHuntToast({
                        id: Date.now(),
                        kicker: "Trail recalibrated",
                        text: `The Guild moved an older contract onto its verified ledger. Your fresh lead is in Sector ${result.state.sector}.`,
                    });
                }
            }
            if (!cancelled) setAuthoritativeHuntStates(next);
        })();
        return () => { cancelled = true; };
    }, [acceptedHuntKey, character.name]);

    // Returning from an explore ambush: reopen the sector detail the player was in
    // (set by exploreSector before the fight). One-shot — consumed on this mount so
    // a normal trip to the world map still opens on the overview, and already
    // cleared by the Hospital on a KO so a death never reopens the death sector.
    useEffect(() => {
        const reopen = takeSectorReopen();
        if (reopen !== null) { setSelectedSector(reopen); return; }
        // Refresh restore: if the page was reloaded straight onto the World Map
        // while standing in a real explorable sector (see isWildSector), reopen that sector's
        // detail. selectedSector is ephemeral React state, so without this a refresh
        // dumps the player on the overview ("the refresh moved me"). currentSector is
        // only reset to 0 when the player enters a town (lib/screen-guards TOWN_SCREENS),
        // so a wild-sector reload — from the map OR from any menu opened in the field —
        // lands back in that sector; a normal in-session trip to the map still opens on
        // the overview (consumeReloadIntoSector is a one-shot, false on SPA navigation).
        if (consumeReloadIntoSector() && isWildSector(currentSector)) {
            setSelectedSector(currentSector);
        }
    }, []);

    // ── Scout Network (clan upgrade) ──────────────────────────────────────
    // During the viewer clan's active clan war, surface enemy-clan members who
    // are out in the world (hidden while they sit safe at their own village).
    // The Scout Network building level gates how much detail each dot shows.
    const [scoutInfo, setScoutInfo] = useState<{ tier: 0 | 1 | 2 | 3; enemyClans: string[] }>({ tier: 0, enemyClans: [] });
    useEffect(() => {
        let cancelled = false;
        const clan = character.clan;
        if (!clan) { setScoutInfo({ tier: 0, enemyClans: [] }); return; }
        void (async () => {
            const [clanRec, wars] = await Promise.all([
                fetchClanData(clan) as Promise<{ upgrades?: Record<string, number> } | null>,
                cwListWars(),
            ]);
            if (cancelled) return;
            const tier = scoutIntelTier(clanRec?.upgrades?.scoutNetwork ?? 0);
            const mine = clan.toLowerCase();
            const enemyClans = wars
                .filter((w) => !w.endedAt && w.clans.some((c) => c.toLowerCase() === mine))
                .map((w) => w.clans.find((c) => c.toLowerCase() !== mine) ?? "")
                .filter(Boolean);
            setScoutInfo({ tier, enemyClans });
        })();
        return () => { cancelled = true; };
    }, [character.clan]);
    const scoutedSectors = useMemo(() => {
        const map = new Map<number, PlayerRecord[]>();
        if (scoutInfo.tier < 1 || scoutInfo.enemyClans.length === 0) return map;
        const enemySet = new Set(scoutInfo.enemyClans.map((c) => c.toLowerCase()));
        const now = Date.now();
        for (const p of playerRoster) {
            const pClan = (p.clan ?? "").toLowerCase();
            if (!pClan || !enemySet.has(pClan)) continue;
            const sector = p.currentSector;
            if (typeof sector !== "number" || sector <= 0) continue;
            // Hide enemies sitting safe at their own village (home outskirts sector).
            if (sector === villageOutskirtsSectorNumber(p.village)) continue;
            // Only show recently-seen players (drop stale presence).
            if (p.lastSeenAt && now - p.lastSeenAt > 90_000) continue;
            const arr = map.get(sector) ?? [];
            arr.push(p);
            map.set(sector, arr);
        }
        return map;
    }, [playerRoster, scoutInfo]);
    function scoutDotTitle(players: PlayerRecord[], tier: 1 | 2 | 3): string {
        if (tier >= 3) return "Enemy clan: " + players.map((p) => `${p.name} (Lv ${p.level})`).join(", ");
        if (tier === 2) return `Enemy clan here · ${players.length} · level${players.length > 1 ? "s" : ""} ${players.map((p) => p.level).join(", ")}`;
        return `Enemy clan spotted · ${players.length} member${players.length > 1 ? "s" : ""}`;
    }

    useEffect(() => {
        if (!selectedVillageTerritory) { setTerritoryGuards([]); return; }
        fetch("/api/village-guard/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ village: selectedVillageTerritory.name }),
        }).then(r => r.ok ? r.json() : []).then(setTerritoryGuards).catch(() => setTerritoryGuards([]));
    }, [selectedVillageTerritory]);

    useEffect(() => {
        if (!villageWarAdmissionOpen || !selectedSector) { setSectorEnemyGuards([]); return; }
        const war = activeVillageWarsFor(character.village).find(w => w.warGroundSector === selectedSector);
        const enemyVillage = war?.villages.find(v => v !== character.village);
        if (!enemyVillage) { setSectorEnemyGuards([]); return; }
        fetch("/api/village-guard/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ village: enemyVillage }),
        }).then(r => r.ok ? r.json() : []).then(setSectorEnemyGuards).catch(() => setSectorEnemyGuards([]));
    }, [selectedSector, character.village, villageWarAdmissionOpen]);

    async function fetchSavedPlayerCharacter(name: string): Promise<Character | null> {
        // Always prefer the authoritative combat save for PvP. Roster entries can be
        // avatar-only (heartbeat broadcasts { avatarImage }, which normalizes to a
        // level-1, no-jutsu default), so trusting them would load a broken opponent.
        // Fall back to a roster character only if the save fetch fails.
        const fromSave = (await fetchPlayerCombatSave(name))?.character;
        if (fromSave) return fromSave;
        const rosterMatch = playerRoster.find((player) => player.name.toLowerCase() === name.toLowerCase());
        return rosterMatch?.character ? normalizeCharacter(rosterMatch.character) : null;
    }

    function installPendingPvp(pending: PendingPvpRecovery): void {
        setPvpSeedSession(pending.session);
        setPvpBattleId(pending.battleId);
        setPvpRole(pending.role);
        setPvpBattleContext(pending.context);
        setScreen("pvpBattle");
    }

    async function startPvpRaid(
        opponent: Character,
        sector: number,
        biome: Biome,
        weather: WeatherType,
        inheritedScope?: { signal: AbortSignal; isCurrent: () => boolean },
    ) {
        const createScope = inheritedScope ?? capturePvpCreateScope(character.name);
        if (!createScope.isCurrent()) return;
        if (!capabilityAdmissionAllowed(mutationAvailability())) return;
        if (!requireServerSettlement("pvpSession")) return;
        setCurrentSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weather);

        // Use local character data — the server hydrates both fighters from
        // their KV save records directly (see api/pvp/session.ts ~line 502),
        // so the redundant fetchPlayerCombatSave round trips that used to
        // gate this flow are unnecessary. The payload below is only
        // consulted as a fallback for fighters without a save (NPCs).
        const selfCharacter = character;
        const selfBloodlines = savedBloodlines;
        const selfCreatorJutsus = wmCreatorJutsus;
        const selfAllItems = getAllItems(wmCreatorItems);
        const p1Jutsus = getPvpJutsuLoadout(selfBloodlines, selfCreatorJutsus, selfCharacter);
        const opponentCharacter = opponent;
        const opponentBloodlines = savedBloodlines;
        const opponentCreatorJutsus = wmCreatorJutsus;
        const opponentAllItems = getAllItems(wmCreatorItems);
        const p2Jutsus = getPvpJutsuLoadout(opponentBloodlines, opponentCreatorJutsus, opponentCharacter);

        // Optimistic navigation — flip to the pvpBattle screen immediately
        // so the player sees the proper battle backdrop + a "Connecting to
        // battle session..." card instead of staring at the sector view
        // while the session POST resolves. The PvpBattleScreen session-fetch
        // effect is keyed on battleId, so the empty id just renders the
        // loading card; once we set the real id below the effect re-runs
        // and loads the grid.
        //
        // Note: this used to generate a client-side battleId and pass it
        // through both POSTs in parallel, but the server intentionally
        // ignores client-supplied ids (api/pvp/session.ts:544–550 — the
        // comment explains the scrape-via-stream vector that motivated the
        // change). The result was that the attacker's pvpBattle screen
        // fetched a non-existent session and was stuck on "Connecting..."
        // until the server-managed defender heartbeat happened to re-route
        // them — i.e. broken in production for the attacker. The challenge
        // now ships the *real* server-issued battleId so the defender
        // routes to the right session too.
        const createBody = stringifyPvpSessionPayload({
                    // Sector raid — fighters bring current vitals.
                    useCurrentVitals: true,
                    requireWorldCoLocation: true,
                    // Phase 3: server credits base ryo + XP on the win. `sector`
                    // is this raid's target (= handlePvpWin's reward sector).
                    baseRewards: true,
                    rewardSector: sector,
                    // Sector raids ride the sector's biome/weather (not ranked).
                    ...pvpSessionEnvironment(false, biome, weatherEffects[weather]?.positiveElement, weatherEffects[weather]?.negativeElement),
                    p1Character: { ...selfCharacter, jutsu: p1Jutsus, pvpItems: getPvpItemLoadout(selfCharacter, selfAllItems), bloodlineMult: getBloodlineMultiplier(selfCharacter, selfBloodlines), armorFactor: getCharacterArmorFactor(selfCharacter, selfAllItems), armorRawDR: getCharacterArmorRawDR(selfCharacter, selfAllItems), itemDamagePct: getEquippedItemBonus(selfCharacter, selfAllItems, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(selfCharacter, selfAllItems, "absorbPercent"), itemReflectPct: getEquippedItemBonus(selfCharacter, selfAllItems, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(selfCharacter, selfAllItems, "lifeStealPercent"), itemShield: getEquippedItemBonus(selfCharacter, selfAllItems, "shield") },
                    p2Character: { ...opponentCharacter, jutsu: p2Jutsus, pvpItems: getPvpItemLoadout(opponentCharacter, opponentAllItems), bloodlineMult: getBloodlineMultiplier(opponentCharacter, opponentBloodlines), armorFactor: getCharacterArmorFactor(opponentCharacter, opponentAllItems), armorRawDR: getCharacterArmorRawDR(opponentCharacter, opponentAllItems), itemDamagePct: getEquippedItemBonus(opponentCharacter, opponentAllItems, "damagePercent"), itemAbsorbPct: getEquippedItemBonus(opponentCharacter, opponentAllItems, "absorbPercent"), itemReflectPct: getEquippedItemBonus(opponentCharacter, opponentAllItems, "reflectPercent"), itemLifeStealPct: getEquippedItemBonus(opponentCharacter, opponentAllItems, "lifeStealPercent"), itemShield: getEquippedItemBonus(opponentCharacter, opponentAllItems, "shield") },
                });
        setPvpBattleId(pvpStableBattleIdFromRequestBody(createBody));
        setPvpRole("p1");
        setPvpBattleContext({ mode: "standard", sectorAttack: true, raidKind: "raidPlayer", sector });
        const createResult = await createPvpSessionWithRecovery(fetch, selfCharacter.name, createBody, createScope);
        if (!createScope.isCurrent()) return;
        if (createResult.kind === "recovered") return void installPendingPvp(createResult.pending);
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
            await confirmSectorBattleRegistration(selfCharacter.name, sector, battleId, createScope);
        } catch (error) {
            if (!createScope.isCurrent()) return;
            alert(error instanceof Error ? error.message : "The sector battle is still registering. Retry the same raid.");
            return;
        }
        if (!createScope.isCurrent()) return;
        setPvpSeedSession(createResult.session);
        setPvpBattleId(battleId);
        setScreen("pvpBattle");

        // Notify defender via DuelChallenge with the real battleId. Fire-
        // and-forget: the session is already live on the server; if the
        // defender's challenge POST fails (e.g. they just started
        // traveling) we alert and bounce the attacker back to the world
        // map so they aren't stuck waiting on an empty session.
        const challenge: DuelChallenge = {
            id: makeId(),
            fromName: character.name,
            toName: opponentCharacter.name,
            challenger: character,
            challengerJutsus: p1Jutsus,
            challengerBloodlineMult: getBloodlineMultiplier(selfCharacter, selfBloodlines),
            createdAt: Date.now(),
            mode: "standard",
            sectorAttack: true,
            battleId,
        };
        fetch('/api/player/challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetName: opponentCharacter.name, challenge }),
        }).then((res) => {
            if (!res.ok && createScope.isCurrent()) {
                alert(`The battle is live, but ${opponentCharacter.name} could not be notified yet.`);
            }
        }).catch(() => { /* defender notification is best-effort; session is live regardless */ });
    }

    function pickGuardAi(level: number, defenseBonusPercent = 0): string {
        const effectiveLevel = level + Math.floor(defenseBonusPercent * 2);
        if (effectiveLevel < 20) return "builtin-ai-mist-sentinel";
        if (effectiveLevel < 40) return "builtin-ai-ember-duelist";
        if (effectiveLevel < 60) return "builtin-ai-frost-sealer";
        if (effectiveLevel < 80) return "builtin-ai-shadow-weaver";
        return "builtin-ai-central-champion";
    }

    // Sector Wanderers. The cast is deterministic per 6h window from (sector,
    // bucket) ONLY — shared/wanderer-roster.ts, the roll the server runs too — so
    // everyone in the sector sees the same NPCs; rendering + movement live in
    // <SectorWanderer>. When an "attack" wanderer reaches the player it calls
    // startWandererAttack (the canonical server-sealed Solo-PvE host).
    const sectorWanderers = useMemo(
        () => {
            if (!isWanderersEnabled() || selectedSector == null) return [];
            const now = serverNow();
            const cd = character.wandererCooldowns;
            const moves = character.wandererMoves;
            const bucket = currentWandererDayBucket();
            // Hide natural road NPCs you've already used for a few hours, AND hide
            // ones that have since wandered off to another sector so they don't
            // reappear here when the cooldown lifts. Legacy Sage/emissaries render
            // from their own arrays below and stay exempt.
            // Content the player can't act on yet (a gambler before the codex, a
            // beast with no pet) stays ON the road like for everyone else; the verb is
            // refused in-fiction (startWandererCardDuel / startWandererPetDuel).
            const natives = rollWanderers(selectedSector, bucket)
                .filter(w => !isWandererOnCooldown(cd, w.id, now) && !hasWandererRelocated(moves, w.id));
            // Plus any wanderers that have wandered INTO this sector from elsewhere and
            // whose cooldown has now lifted — they're findable again, just somewhere new.
            const visitors = wanderersVisitingSector(selectedSector, bucket, moves, cd, now);
            return [...natives, ...visitors];
        },
        [selectedSector, character.wandererCooldowns, character.wandererMoves],
    );
    const [bountyBoard, setBountyBoard] = useState<BountyEntry[]>([]);
    useEffect(() => {
        // The board feeds the global view AND the Contract Hunters on the sector
        // floor (everyone in a sector sees the hunter stalking a bountied peer),
        // so it is polled whenever either is showing.
        if (!globalViewOpen && selectedSector == null) return;
        let alive = true;
        const load = () => {
            void fetchBountyBoard().then((board) => { if (alive) setBountyBoard(board); }).catch(() => { /* best-effort */ });
        };
        load();
        const stop = visiblePoll(load, 45000);
        return () => { alive = false; stop(); };
    }, [character.name, globalViewOpen, selectedSector != null]);
    const selfBounty = useMemo(
        () => bountyBoard.find((b) => b.target.trim().toLowerCase() === character.name.trim().toLowerCase()) ?? null,
        [bountyBoard, character.name],
    );
    // Contract Hunters on this sector floor — shared derivation in
    // lib/contract-hunter-wanderers.ts (same function the server settles from).
    const bountyHunterWanderers = useMemo<Wanderer[]>(() => {
        if (!isWanderersEnabled() || selectedSector == null) return [];
        return contractHunterWanderers({ sector: selectedSector, bountyBoard, roster: playerRoster, now: Date.now(), interiorTileFromKey, self: { name: character.name, level: character.level, wandererCooldowns: character.wandererCooldowns } });
    }, [selectedSector, bountyBoard, playerRoster, character.name, character.level, character.wandererCooldowns]);
    const courierWanderers = useMemo<Wanderer[]>(() => {
        const favor = character.activeWandererFavor;
        if (!isWanderersEnabled() || selectedSector == null || !favor || favor.targetSector !== selectedSector || serverNow() > favor.expiresAt) return [];
        const home = interiorTileFromKey(`${favor.id}:${selectedSector}`);
        return [{
            id: `courier-${favor.id}`,
            name: "Road Courier",
            archetype: "courier",
            verb: "courier",
            level: Math.max(1, Math.min(100, character.level)),
            homeTile: home,
            waypoints: [home],
            greeting: `${favor.giver} said you might come through. Hand it over.`,
            tellTint: "var(--gold-300)",
            avatarKey: "courier",
            originSector: favor.originSector,
            targetSector: favor.targetSector,
            expiresAt: favor.expiresAt,
        }];
    }, [selectedSector, character.activeWandererFavor, character.level]);
    // Roaming mercenaries (Phase 5) — a hired enemy band patrols this sector as
    // hostile, wanderer-shaped NPCs. The roster is SERVER-sourced (which bands roam
    // here keys off live wars + leases); the fight is server-resolved. villageWarMap.v1 only.
    const MERC_CLIENT_HIDE_MS = 15 * 60 * 1000;
    const [mercRoster, setMercRoster] = useState<{ sector: number; mercs: RoamingMercView[] }>({ sector: -1, mercs: [] });
    useEffect(() => {
        const village = (character.village ?? "").trim();
        const sec = selectedSector;
        if (!villageWarViewOpen || !isVillageWarMapEnabled() || sec == null || !village) return;
        let alive = true;
        const load = () => { void fetchMercRoster(character.name, village, sec).then(m => { if (alive) setMercRoster({ sector: sec, mercs: m }); }).catch(() => { /* roster is best-effort */ }); };
        load();
        const stop = visiblePoll(load, 20000);
        return () => { alive = false; stop(); };
    }, [selectedSector, character.name, character.village, villageWarViewOpen]);

    // Roaming weekly boss (weeklyBossRoam.v1, default ON — opt out per-device
    // with `weeklyBossRoam.v1 = "off"`). Poll the boss state
    // so the overworld can show where it's rampaging. The live sector + countdown
    // are derived CLIENT-side from startedAt (weeklyBossRoamState), so a slow poll
    // is plenty — GET /api/weekly-boss is edge-cached (s-maxage=10).
    const [roamingBoss, setRoamingBoss] = useState<RoamingBoss | null>(null);
    useEffect(() => {
        if (!globalViewOpen || !isWeeklyBossRoamEnabled()) return;
        let alive = true;
        const load = () => {
            void fetch("/api/weekly-boss", { method: "GET" })
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => { if (alive) setRoamingBoss(data?.boss?.aiId ? (data.boss as RoamingBoss) : null); })
                .catch(() => { /* best-effort — no marker if the fetch fails */ });
        };
        load();
        const stop = visiblePoll(load, 45000);
        return () => { alive = false; stop(); };
    }, [globalViewOpen]);

    // ── Roaming weekly boss — in-sector encounter (weeklyBossRoam.v1, Phase 3) ──
    // A slow tick so the boss-sector highlight AND the in-sector actor's presence
    // gate (is the boss in THIS sector right now?) re-evaluate near the ~13-min hop
    // boundaries even when nothing else re-renders.
    const [roamBossTick, setRoamBossTick] = useState(0);
    useEffect(() => {
        if (!isWeeklyBossRoamEnabled()) return;
        const id = setInterval(() => setRoamBossTick((t) => t + 1), 15000);
        return () => clearInterval(id);
    }, []);
    // The sector the boss is rampaging in right now — the world map highlights this
    // node (a pulsing ring + 👹 flag) instead of a floating portrait marker, per
    // owner feedback ("the highlighted area it is in is enough"). Recomputes on the
    // poll (roamingBoss) and the slow tick (roamBossTick).
    const weeklyBossSector = useMemo(() => {
        if (!isWeeklyBossRoamEnabled() || !roamingBoss) return null;
        const r = weeklyBossRoamState(roamingBoss, serverNow());
        return r?.active ? r.currentSector : null;
    }, [roamingBoss, roamBossTick]);
    // The Stand/Flee prompt shown when the boss reaches the player in its sector.
    const [bossDialog, setBossDialog] = useState<{ name: string; portrait: string; attemptsUsed: number } | null>(null);

    // Per-player back-off, keyed by weekKey in the (self-pruning) wanderer cooldown
    // map — coolWanderer no-ops relocation for this synthetic id. UX pacing only;
    // the hard 3-attempt cap is enforced server-side by /api/weekly-boss.
    function coolWeeklyBoss(ms: number) {
        if (roamingBoss?.weekKey) coolWanderer(weeklyBossRoamCooldownId(roamingBoss.weekKey), ms);
    }
    function handleBossEngage() {
        if (!roamingBoss?.aiId) return;
        setBossDialog({
            name: roamingBoss.bossName ?? "Weekly Boss",
            portrait: sharedImages["ai:" + roamingBoss.aiId] || "",
            attemptsUsed: roamingBoss.attemptsByPlayer?.[character.name.toLowerCase()] ?? 0,
        });
    }
    function standBossFight() {
        if (!globalMutationsOpen || !capabilityAdmissionAllowed(mutationAvailability())) return;
        setBossDialog(null);
        if (!roamingBoss?.aiId) return;
        // launchWeeklyBossFight bails (with an alert) if stamina < 20. Catch that
        // here FIRST so we don't burn the long fight cooldown for a fight that never
        // starts — the boss just backs off briefly (like a flee) and you return
        // once rested.
        if ((character.stamina ?? 0) < 20) {
            alert("You need at least 20 stamina to challenge the boss. It backs off — return once you've rested.");
            coolWeeklyBoss(WEEKLY_BOSS_ROAM_REENGAGE_COOLDOWN_MS);
            return;
        }
        // Brief back-off (~45s) so it doesn't instantly re-lunge on return — NOT a
        // long lockout. The boss stays present in its sector for your remaining
        // attempts (the hard 3-attempt cap is server-enforced). Only a fight that
        // logs damage burns an attempt. Return to the world map (currentSector is
        // untouched) so the hunt continues.
        coolWeeklyBoss(WEEKLY_BOSS_ROAM_REENGAGE_COOLDOWN_MS);
        onLaunchWeeklyBoss?.(roamingBoss.aiId, roamingBoss.bossName, "worldMap");
    }
    function fleeBoss() {
        coolWeeklyBoss(WEEKLY_BOSS_ROAM_REENGAGE_COOLDOWN_MS); // free — no attempt spent; brief re-lunge back-off only
        setBossDialog(null);
    }
    const mercWanderers = useMemo(() => {
        if (!villageWarViewOpen || !isVillageWarMapEnabled() || mercRoster.sector !== selectedSector) return [];
        const cd = character.wandererCooldowns; const now = Date.now();
        return mercRoster.mercs.filter(m => !isWandererOnCooldown(cd, m.id, now)).map(synthMercWanderer);
    }, [mercRoster, selectedSector, character.wandererCooldowns, villageWarViewOpen]);
    // Wandering Sage (Legacy system, legacy.v1 + server ENABLE_LEGACY). Verified
    // progress writes perform the server-owned roll; the map only reads and
    // presents an offer that already exists. While waiting, the Sage stands in
    // his sector until answered.
    const [sageOffer, setSageOffer] = useState<SageOfferView | null>(null);
    const [sageVnEvent, setSageVnEvent] = useState<CreatorEvent | null>(null);
    const [sageVnPage, setSageVnPage] = useState(0);
    const [sageVnLine, setSageVnLine] = useState(0);
    const [sageChoiceOpen, setSageChoiceOpen] = useState(false);
    // Themed delivery for the system's atmospheric beats (rumors, Sage arrival,
    // Sage departure) — these used to be native alert() dialogs.
    const [whisper, setWhisper] = useState<{ text: string; kicker?: string } | null>(null);
    const characterLegacyId = character.legacy?.legacyId ?? null;
    useEffect(() => {
        if (!legacyActionsAvailable || character.level < 50 || characterLegacyId) return;
        let alive = true;
        const refreshOffer = () => void fetchSageState(character.name).then(r => {
            if (!alive) return;
            if (r?.offer) {
                setSageOffer(r.offer);
                try { window.localStorage?.setItem("legacy.sage.lastOffer", String(r.offer.expiresAt ?? 0)); } catch { /* best-effort */ }
                let lastAnnounced = 0;
                try { lastAnnounced = Number(window.localStorage?.getItem("legacy.sage.lastAnnounced") ?? 0); } catch { /* best-effort */ }
                if (lastAnnounced !== r.offer.spawnedAt) {
                    try { window.localStorage?.setItem("legacy.sage.lastAnnounced", String(r.offer.spawnedAt)); } catch { /* best-effort */ }
                    setWhisper({ kicker: "The Sage has appeared", text: `The Wandering Sage is waiting in ${sectorRegionName(r.offer.sector)} — sector ${r.offer.sector} on your map. He's been asking after you by name.` });
                }
            } else {
                setSageOffer(null);
                // One-time "moved on" beat: we knew of an offer, and it is gone.
                try {
                    const last = Number(window.localStorage?.getItem("legacy.sage.lastOffer") ?? 0);
                    if (last > 0 && Date.now() > last) {
                        window.localStorage?.removeItem("legacy.sage.lastOffer");
                        setWhisper({ kicker: "The road is empty", text: "The Sage has moved on. Don't fret it — folk say he always circles back for the ones he's already picked out." });
                    }
                } catch { /* best-effort */ }
            }
        });
        refreshOffer();
        const poll = window.setInterval(refreshOffer, 30_000);
        return () => { alive = false; window.clearInterval(poll); };
    }, [legacyActionsAvailable, character.name, character.level, characterLegacyId]);
    // Pre-50 Legacy rumors: at level milestones, one vague hint about the
    // strongest path the player is carving (never formulas — the mystery rule).
    // Fires for the highest unseen milestone at level >= it, so leveling past
    // one offline doesn't eat the beat; heard rumors accumulate in the panel log.
    useEffect(() => {
        if (!legacyAvailable || character.level >= 50) return;
        const milestone = nextUnseenRumorMilestone(character.level);
        if (milestone == null) return;
        let alive = true;
        void fetchLegacyStatus(character.name).then(s => {
            if (!alive) return;
            // Null = the endpoint 404'd (server ENABLE_LEGACY off) or errored —
            // don't whisper about a system that isn't live, and don't burn the
            // one-time seen marker so the rumor still fires once it's on.
            if (!s) return;
            // Pass the player name + this path's server-bucketed tier so the
            // deterministic variant pick is per-player (two players / a replay
            // never hear the identical sequence) and tier-aware.
            const text = rumorForCategory(s.strongest?.[0]?.category, milestone, {
                playerName: character.name,
                tier: s.strongest?.[0]?.tier,
            });
            markLevelRumorSeen(milestone);
            recordRumorHeard(milestone, text);
            setWhisper({ text });
        });
        return () => { alive = false; };
    }, [legacyAvailable, character.name, character.level]);
    const sageWanderers = useMemo(
        () => (legacyAvailable && sageOffer && sageOffer.status === "spawned" && selectedSector === sageOffer.sector
            ? [synthSageWanderer(sageOffer.sector)] : []),
        [legacyAvailable, sageOffer, selectedSector],
    );
    // Legacy Emissaries — the eight roaming quest-givers (lib/legacy-emissaries).
    // Spawn is deterministic per (player, 6h window), like the natural roster;
    // post-acceptance the player's own category emissary walks (their
    // trial-giver), pre-acceptance (level 40+) the eight take turns. The
    // category is server-resolved once (the status endpoint) so the client
    // never ships the 100-def table.
    const [legacyCategory, setLegacyCategory] = useState<string | null>(null);
    // Emissaries are a Legacy-wave feature: they spawn only once the SERVER's
    // ENABLE_LEGACY is confirmed live (session-cached probe) — the client
    // localStorage flag alone must not surface them, or their quests would be
    // acceptable while the system is officially off (verification finding).
    const [legacyServerLive, setLegacyServerLive] = useState(false);
    useEffect(() => {
        if (!legacyAvailable) { setLegacyServerLive(false); return; }
        let alive = true;
        void isLegacyServerLive().then(live => { if (alive) setLegacyServerLive(live); });
        return () => { alive = false; };
    }, [legacyAvailable]);
    useEffect(() => {
        if (!legacyAvailable || !characterLegacyId) { setLegacyCategory(null); return; }
        let alive = true;
        void fetchLegacyStatus(character.name).then(s => { if (alive) setLegacyCategory(s?.legacyCategory ?? null); });
        return () => { alive = false; };
    }, [legacyAvailable, character.name, characterLegacyId]);
    const emissaryWanderers = useMemo(() => {
        if (!legacyAvailable || !legacyServerLive || !isWanderersEnabled() || selectedSector == null) return [];
        // A legacy holder's emissary is category-bound; until the category fetch
        // resolves, don't fall into the pre-acceptance roaming branch by mistake.
        if (characterLegacyId && !legacyCategory) return [];
        const spawn = rollEmissarySpawn(character.name, character.level, legacyCategory, currentWandererDayBucket(), selectedSector);
        return spawn && spawn.sector === selectedSector ? [spawn.wanderer] : [];
    }, [legacyAvailable, legacyServerLive, character.name, character.level, characterLegacyId, legacyCategory, selectedSector]);
    // Story road events (docs/fable-5-story-rebuild.md §10): the next eligible
    // event's NPC walks WHATEVER sector the player is in — the road finds them.
    // Completion is trait-presence, so the memo re-evaluates when traits change.
    const roadWanderers = useMemo(() => {
        if (!isWanderersEnabled() || selectedSector == null) return [];
        const event = nextRoadEvent(character);
        if (!event) return [];
        // Balance: the road finds them — but not in EVERY sector. The NPC walks
        // QUEST_GIVER_PRESENCE.road of sectors per 6h window (deterministic,
        // reshuffles each window), so an ignored story beat stops reading as
        // wallpaper yet stays a couple of hops away when the player goes looking.
        // Keyed by (event, sector, window) — never the player — so everyone agrees.
        const bucket = currentWandererDayBucket();
        if (!wandererPresenceGate(`road#${event.id}#${selectedSector}#${bucket}`, QUEST_GIVER_PRESENCE.road)) return [];
        return [synthRoadWanderer(event, selectedSector)];
    }, [character.level, character.storyProgress, character.storyTraits, character.name, selectedSector]);
    // Named story reckonings: current-canon characters stand at their own
    // village outskirts and offer one-shot server-sealed follow-up tasks.
    const storyReckoningWanderers = useMemo(() => {
        if (!isWanderersEnabled() || selectedSector == null) return [];
        return visibleStoryReckonings(character, selectedSector);
    }, [character.level, character.storyProgress, character.storyTraits, character.storyVillage, selectedSector]);
    // Hollow Gate Rift givers (lib/hollow-rifts): a rattled NPC roams the player's
    // current sector with a concrete field report from a target sector. Only while a
    // rift is available (level-gated, none active, off cooldown).
    const riftGiverWanderers = useMemo(() => {
        if (!isWanderersEnabled() || selectedSector == null) return [];
        const rift = nextRift(character);
        if (!rift) return [];
        // Balance: same presence gate as the road-event NPC, at the lowest rate of
        // the three (QUEST_GIVER_PRESENCE.rift) — a rift being available shouldn't
        // put the rattled messenger in every sector you enter. nextRift is fixed
        // for a whole UTC day, so this is the giver that most easily turns into a
        // fixture: one face, all day, in every gate-passing sector.
        const bucket = currentWandererDayBucket();
        if (!wandererPresenceGate(`rift#${rift.id}#${selectedSector}#${bucket}`, QUEST_GIVER_PRESENCE.rift)) return [];
        return [synthRiftGiver(rift, selectedSector)];
    }, [character.level, character.activeRiftQuest, character.riftCooldownUntil, character.name, selectedSector]);
    // Chronicle Scribe (lib/chronicle-scribe): one-time roaming NPC who explains
    // the card game in-fiction and hands over the traveler's codex. Retired for
    // good once the server sets starterCardsClaimed.
    const scribeWanderers = useMemo(() => {
        if (!isWanderersEnabled()) return [];
        return scribeWandererFor(character, selectedSector);
    }, [character.level, character.starterCardsClaimed, character.name, selectedSector]);
    const petMentor = usePetMentorGuide({ character, selectedSector: isWanderersEnabled() ? selectedSector : null, updateCharacter, setScreen });
    // The codex hand-off ends on the pack-opening cinematic, so the scene closes
    // on the player actually seeing the cards instead of on an alert.
    //
    // Two things have to land before it can play: the server grant has to come
    // back (it is what says WHICH cards were added) and Ihara's send-off has to
    // finish. Neither order is guaranteed — a fast click-through beats the fetch,
    // a slow reader loses that race — so whichever lands second fires the
    // cinematic. Mounting it any earlier would paint over her last line.
    const [codexReveal, setCodexReveal] = useState<{ nonce: string; cards: string[]; ownedBefore: Map<string, number>; grantedCount: number } | null>(null);
    const pendingCodexRevealRef = useRef<typeof codexReveal>(null);
    const codexSceneClosedRef = useRef(false);
    // Builtin catalog only, like the other card lookups on this screen: the codex
    // and the progression backfill grant builtin ids, never creator cards.
    const codexCardsById = useMemo(() => displayCardsById(getAllTileCards([])), []);
    /** Called when Ihara's scene closes, by either exit path. */
    function closeCodexScene() {
        codexSceneClosedRef.current = true;
        const pending = pendingCodexRevealRef.current;
        if (!pending) return;
        pendingCodexRevealRef.current = null;
        setCodexReveal(pending);
    }
    // Portaled to <body>, so it only has to be reachable in the branch the player
    // is standing in — Ihara is tapped inside a sector, and the sector view is
    // what re-renders once her scene closes. Rendered in the world view too so a
    // reveal can never be stranded by a mid-cinematic exit.
    const codexRevealOverlay = codexReveal ? (
        <CardPackOpening
            key={codexReveal.nonce}
            packType="standard"
            cards={codexReveal.cards}
            cardsById={codexCardsById}
            ownedBefore={codexReveal.ownedBefore}
            title="The Traveler's Codex"
            countLabel={`${codexReveal.grantedCount} card${codexReveal.grantedCount === 1 ? "" : "s"} from Ihara`}
            flipLimit={CODEX_FLIP_LIMIT}
            onClose={() => setCodexReveal(null)}
        />
    ) : null;
    // The rate-gated roaming givers, thinned to what actually stands here. Each
    // memo above only knows its OWN odds, so before this they stacked — a sector
    // could hold a story NPC AND a rift giver, and neither cared that you'd already
    // turned them down. Priority is main story → repeatable: the story beat is
    // finite, the rift giver comes back tomorrow.
    //
    // The Chronicle Scribe is NOT in here on purpose. She's rendered unconditionally
    // (see the render list) so she never loses a coin-flip against the rift giver:
    // she's the key to a locked system, not an offer.
    const roamingQuestGivers = useMemo(
        () => pickRoamingQuestGivers(
            [...roadWanderers, ...riftGiverWanderers],
            character.wandererCooldowns,
            Date.now(),
        ),
        [roadWanderers, riftGiverWanderers, character.wandererCooldowns],
    );
    // Turning a roaming giver down. Their VN closes through onCancel (backed out)
    // OR onComplete (played a decline choice's goodbye), and neither told us
    // whether the offer was TAKEN — so accepts stamp this ref and the close path
    // cools the NPC only when it wasn't stamped.
    //
    // Two deliberate exemptions. Story reckonings stand at their own village
    // outskirts with unfinished business, and a fixture is what they're meant to be.
    // The Chronicle Scribe must keep finding you until you take the codex — cooling
    // her for two hours because you closed her scene is exactly the wall this pass
    // exists to remove, since the card game stays sealed until she hands it over.
    const giverAcceptedRef = useRef<string | null>(null);
    function isRoamingGiverEventId(id: string): boolean {
        return id.startsWith(RIFT_GIVER_PREFIX) || id.startsWith(ROAD_WANDERER_PREFIX);
    }
    /** Called on every roaming-giver VN close. A giver whose offer wasn't taken
     *  backs off everywhere for WANDERER_DECLINE_COOLDOWN_MS. The giver's VN event
     *  id IS its wanderer id for all three, so the cooldown map keys directly off
     *  it — and these ids don't parse as natural wanderers, so coolWanderer skips
     *  the relocation branch and only writes the cooldown. */
    function noteGiverVnClosed(eventId: string) {
        if (!isRoamingGiverEventId(eventId)) return;
        const accepted = giverAcceptedRef.current === eventId;
        giverAcceptedRef.current = null;
        if (accepted) return;
        coolWanderer(eventId, WANDERER_DECLINE_COOLDOWN_MS);
        // Communicated, not silent — the same rule the Sage's decline follows: the
        // player should know the NPC backs off AND that it circles back.
        setWhisper({ kicker: "They move on", text: "You beg off, and they take it without argument. Whatever they were carrying will keep, and they will find you again once they have walked a while." });
    }
    // Put a wanderer on its anti-spam cooldown (functional update — composes with any
    // reward update in the same handler without clobbering it). `ms` defaults to the
    // full anti-farm window; flee/decline passes the short WANDERER_FLEE_COOLDOWN_MS.
    // Also records where the wanderer wanders off to, so it doesn't resurface in this
    // same sector when its cooldown lifts. Only real wanderers relocate — merc/
    // synthetic ids don't parse, so their entry is left untouched.
    function coolWanderer(id: string, ms?: number) {
        updateCharacter(prev => {
            if (!prev) return prev;
            const now = serverNow();
            const cooldowns = withWandererCooldown(prev.wandererCooldowns, id, now, ms);
            const parsed = parseWandererId(id);
            let moves = prev.wandererMoves;
            if (parsed) {
                const bucket = currentWandererDayBucket();
                const from = selectedSector != null && selectedSector >= 1 ? selectedSector : parsed.sector;
                const dest = wandererRelocationSector(id, from);
                moves = { ...pruneWandererMoves(prev.wandererMoves, bucket), [id]: dest };
            }
            return { ...prev, wandererCooldowns: cooldowns, wandererMoves: moves };
        });
    }
    function coolNaturalWanderer(w: Wanderer, ms?: number) {
        if (w.id === LEGACY_SAGE_WANDERER_ID || w.verb === "legacyQuest") return;
        if (!parseWandererId(w.id)) return;
        coolWanderer(w.id, ms);
    }
    // ── Bandit fights, level-scaling, streak & ambush ────────────────────────
    // All wanderer combat scales to the PLAYER's level (never impossible). Fending
    // off robbers builds character.robberStreak; at 5, the next bandit springs an
    // AMBUSH gauntlet — 3 robbers then a boss, back-to-back. The server seals each
    // wave, owns the streak and outcome, and carries surviving HP plus the exact
    // one-third recovery between waves. localStorage is presentation recovery only.

    function buildRobberAi(level: number, tag: string, stage = 0): CreatorAi {
        const lvl = Math.max(1, Math.min(100, Math.round(level)));
        const ai = makeBuiltinAi(`wanderer-rob-${tag}-${lvl}`, "Road Bandit", "🥷", lvl, "Wandering Road", [], 0, undefined, "bruiser");
        ai.image = wandererRobberPortrait(stage); // a different face per gang member
        return ai;
    }
    function buildBossAi(level: number): CreatorAi {
        const lvl = Math.max(1, Math.min(100, Math.round(level)));
        const ai = makeBuiltinAi(`wanderer-boss-${lvl}`, "Bandit Warlord", "💀", lvl, "Wandering Road", [], 8, undefined, "boss");
        ai.image = WANDERER_BOSS_PORTRAIT;
        return ai;
    }
    function launchWorldMapFight(
        ai: CreatorAi,
        sector: number,
        worldEncounter: WorldAiFightRequest,
    ) {
        if (!sameSector(currentSector, sector)) return gameToast(`Travel to Sector ${sector} before starting this encounter.`, { kind: "info" });
        if (!capabilityAdmissionAllowed(mutationAvailability())) return;
        const b = biomeForSector(sector);
        setCurrentBiome(b);
        setCurrentWeather(weatherForSector(sector, b));
        const launched = requestAiFight({
            opponentId: worldEncounter.sourceId,
            opponentLevel: ai.level ?? character.level,
            battleKind: "world",
            opponentName: ai.name,
            enemyAvatar: ai.image,
            sector,
            returnScreen: "worldMap",
            worldEncounter,
        });
        if (launched) setWandererDialog(null);
        else {
            alert("The combat host is unavailable. Return to the encounter and try again.");
        }
    }
    /**
     * Raid a published AI village guard / sector target through the same sealed
     * Solo-PvE host. Runtime World encounters use launchWorldMapFight above.
     */
    async function launchAiGuardRaid(aiId: string, level: number, sector: number, setup?: () => void) {
        if (!capabilityAdmissionAllowed(mutationAvailability())) return;
        if (aiRaidLaunchInFlight.current) return;
        aiRaidLaunchInFlight.current = true;
        setup?.();
        try {
            const raidProof = await mintAiRaidToken({ playerName: character.name, opponentId: aiId, sector });
            if (!raidProof) {
                alert("The village guard could not be verified. Try the raid again in a moment.");
                return;
            }
            if (raidProof.sector !== sector) {
                const sealedBiome = biomeForSector(raidProof.sector);
                setSelectedSector(raidProof.sector);
                setCurrentSector(raidProof.sector);
                setCurrentBiome(sealedBiome);
                setCurrentWeather(weatherForSector(raidProof.sector, sealedBiome));
            }
            if (!requestAiFight({
                opponentId: raidProof.opponentId,
                opponentLevel: level,
                battleKind: "raidAi",
                sector: raidProof.sector,
                raidToken: raidProof.token,
            })) {
                alert("The combat host is unavailable. Return to the sector and try again.");
            }
        } finally {
            aiRaidLaunchInFlight.current = false;
        }
    }
    function startWandererAttack(w: Wanderer, nemesis = false) {
        if (selectedSector == null) return;
        // launchWorldMapFight REFUSES SILENTLY when admission is closed. On a
        // dialog the player is already looking at, that read as a dead Fight
        // button, so say what happened instead of swallowing the click.
        const admission = mutationAvailability();
        if (!capabilityAdmissionAllowed(admission)) {
            setWandererDialog({ w, msg: mutationAdmissionMessage(admission) });
            return;
        }
        // The sealed World start owns the encounter cooldown. Do not hide or
        // relocate this NPC before the start ACK: a rejected/offline start must
        // leave the exact encounter available to retry.
        // Streak ≥ 5 → the gang ambushes: 3 robbers, then the boss. (A nemesis duel
        // is its own special encounter and skips the ambush.)
        if (!nemesis && (character.robberStreak ?? 0) >= 5) {
            launchWorldMapFight(
                buildRobberAi(character.level, "amb0", 0),
                selectedSector,
                { kind: "wanderer-ambush", sourceId: "wanderer-ambush", sector: selectedSector, stage: 0 },
            );
            return;
        }
        // A lone robber that fights as THIS wanderer — or your returning nemesis,
        // escalated by its tier — always scaled to the player.
        const nem = nemesis ? (character.wandererNemesis ?? null) : null;
        const lvl = Math.max(1, Math.min(100, character.level + (nem ? Math.max(1, nem.tier) : 1)));
        const name = nem ? nem.name : w.name;
        const statBonus = nem ? Math.min(12, Math.max(1, nem.tier) * 2) : 0;
        const ai = makeBuiltinAi(`wanderer-${nem ? "nemesis" : w.id}`, name, nem ? "😡" : "🥷", lvl, "Wandering Road", [], statBonus, undefined, "bruiser");
        ai.image = nem ? WANDERER_NEMESIS_PORTRAIT : wandererAvatar(w.avatarKey);
        launchWorldMapFight(
            ai,
            selectedSector,
            { kind: "wanderer", sourceId: nem ? "nemesis" : w.id, sector: selectedSector, stage: 0 },
        );
    }
    function roadRumorFor(w: Wanderer): string {
        const favor = character.activeWandererFavor;
        if (selfBounty) return `${w.name} lowers their voice: "Your face is on the board for ${selfBounty.amount.toLocaleString()} ryo. Hunters will smell that ink."`;
        if (favor) return `${w.name} taps the map: "A courier is waiting in ${sectorRegionName(favor.targetSector)} - sector ${favor.targetSector}. Do not let the seal go cold."`;
        if (weeklyBossSector) return `${w.name} points toward ${sectorRegionName(weeklyBossSector)}: "Something huge is moving through sector ${weeklyBossSector}."`;
        const wars = activeVillageWarsFor(character.village);
        if (wars.length > 0) return `${w.name} says, "Patrols are tight while your village is at war. Watch border roads and mercenary colors."`;
        if (legacyAvailable && sageOffer) return `${w.name} smiles faintly: "Old wisdom waits in sector ${sageOffer.sector}. That kind of meeting does not happen twice by accident."`;
        return `${w.name} studies the road dust: "${sectorRegionName(selectedSector ?? 1)} is quiet for now. Quiet roads usually mean someone is choosing the hour."`;
    }
    function askRoadRumor(w: Wanderer) {
        rememberWanderer(w);
        setWandererDialog({ w, msg: roadRumorFor(w) });
    }
    function rememberWanderer(w: Wanderer) {
        const key = w.archetype;
        updateCharacter(prev => {
            if (!prev) return prev;
            const memories = prev.wandererMemories ?? {};
            return { ...prev, wandererMemories: { ...memories, [key]: Math.min(999, (memories[key] ?? 0) + 1) } };
        });
    }
    async function tradeWithWanderer(w: Wanderer) {
        setWandererDialog({ w, busy: true });
        const data = await postWandererService({ action: "merchant", playerName: character.name, sector: selectedSector ?? 0, wandererId: w.id });
        if (data.ok && data.offer && data.totals) {
            coolWanderer(w.id);
            updateCharacter(prev => prev ? ({ ...prev, ryo: data.totals!.ryo ?? prev.ryo, boneCharms: data.totals!.boneCharms ?? prev.boneCharms }) : prev);
            const offer = data.offer as { cost?: number; boneCharms?: number };
            setWandererDialog({ w, msg: `${w.name} trades ${offer.boneCharms ?? 0} bone charm${offer.boneCharms === 1 ? "" : "s"} for ${offer.cost ?? 0} ryo, then packs up for another road.` });
        } else if (data.reason === "no-ryo") {
            const offer = data.offer as { cost?: number } | undefined;
            setWandererDialog({ w, msg: `"Come back with ${offer?.cost ?? "more"} ryo, and we can talk."` });
        } else if (data.reason === "cooldown") {
            coolWanderer(w.id);
            setWandererDialog({ w, msg: "They have already moved on. Search another sector." });
        } else {
            setWandererDialog({ w, msg: data.error ?? "The trade falls through." });
        }
    }
    async function visitWandererMedic(w: Wanderer) {
        setWandererDialog({ w, busy: true });
        const data = await postWandererService({ action: "medic", playerName: character.name, sector: selectedSector ?? 0, wandererId: w.id });
        if (data.ok && data.offer && data.totals) {
            coolWanderer(w.id);
            updateCharacter(prev => prev ? ({
                ...prev,
                ryo: data.totals!.ryo ?? prev.ryo,
                hp: data.totals!.hp ?? prev.hp,
                chakra: data.totals!.chakra ?? prev.chakra,
                stamina: data.totals!.stamina ?? prev.stamina,
            }) : prev);
            const offer = data.offer as { cost?: number };
            setWandererDialog({ w, msg: `${w.name} patches you up for ${offer.cost ?? 0} ryo. Your body remembers how to breathe again.` });
        } else if (data.reason === "already-well") {
            setWandererDialog({ w, msg: `"You are already steady. Save your ryo for worse days."` });
        } else if (data.reason === "no-ryo") {
            const offer = data.offer as { cost?: number } | undefined;
            setWandererDialog({ w, msg: `"Treatment costs ${offer?.cost ?? "more"} ryo. I cannot spend medicine on promises."` });
        } else if (data.reason === "cooldown") {
            coolWanderer(w.id);
            setWandererDialog({ w, msg: "They have already moved on. Search another sector." });
        } else {
            setWandererDialog({ w, msg: data.error ?? "The medic cannot treat you right now." });
        }
    }
    async function startWandererFavor(w: Wanderer) {
        setWandererDialog({ w, busy: true });
        const data = await postWandererService({ action: "favor-start", playerName: character.name, sector: selectedSector ?? 0, wandererId: w.id, wandererName: w.name });
        if (data.ok && data.favor) {
            coolWanderer(w.id);
            updateCharacter(prev => prev ? ({ ...prev, activeWandererFavor: data.favor as WandererFavor }) : prev);
            setWandererDialog({ w, msg: `${w.name} gives you a sealed favor. Deliver it in ${sectorRegionName(data.favor.targetSector)} - sector ${data.favor.targetSector}.` });
        } else if (data.reason === "busy" && data.favor) {
            setWandererDialog({ w, msg: `You already carry a sealed favor for sector ${data.favor.targetSector}. Finish that road first.` });
        } else if (data.reason === "cooldown") {
            coolWanderer(w.id);
            setWandererDialog({ w, msg: "They have already moved on. Search another sector." });
        } else {
            setWandererDialog({ w, msg: data.error ?? "They decide not to trust the package to you." });
        }
    }
    async function claimWandererFavor(w: Wanderer) {
        const favor = character.activeWandererFavor;
        if (!favor) return;
        setWandererDialog({ w, busy: true });
        const data = await postWandererService({ action: "favor-claim", playerName: character.name, sector: selectedSector ?? 0, favorId: favor.id });
        if (data.ok && data.reward && data.totals) {
            updateCharacter(prev => prev ? ({ ...prev, activeWandererFavor: null, ryo: data.totals!.ryo ?? prev.ryo, boneCharms: data.totals!.boneCharms ?? prev.boneCharms }) : prev);
            setWandererDialog({ w, msg: `The courier breaks the seal and pays you ${data.reward.ryo} ryo and ${data.reward.boneCharms} bone charm${data.reward.boneCharms === 1 ? "" : "s"}.` });
        } else if (data.reason === "wrong-sector" && data.favor) {
            setWandererDialog({ w, msg: `Wrong road. The delivery belongs in sector ${data.favor.targetSector}.` });
        } else {
            updateCharacter(prev => prev ? ({ ...prev, activeWandererFavor: null }) : prev);
            setWandererDialog({ w, msg: "The courier checks the seal and shakes their head. This favor is gone." });
        }
    }
    function startPatrolFight(w: Wanderer) {
        if (selectedSector == null) return;
        const hostile = activeVillageWarsFor(character.village).length > 0;
        const lvl = Math.max(1, Math.min(100, character.level + (hostile ? 3 : 1)));
        const ai = makeBuiltinAi(`wanderer-patrol-${w.id}`, hostile ? `${w.name} Captain` : w.name, "PT", lvl, "Road Patrol", [], hostile ? 7 : 3, undefined, hostile ? "defender" : "balanced");
        ai.image = w.avatarImage || wandererAvatar(w.avatarKey);
        setWandererDialog(null);
        launchWorldMapFight(ai, selectedSector, { kind: "patrol", sourceId: w.id, sector: selectedSector, stage: 0 });
    }
    function followTracker(w: Wanderer) {
        setWandererDialog({ w, msg: `${w.name} leads you to claw marks, snapped brush, and a beast that wants to test your companion.` });
        setTimeout(() => startWandererPetDuel(w), 450);
    }
    async function startBountyHunterFight(w: Wanderer) {
        if (selectedSector == null) return;
        setWandererDialog({ w, busy: true });
        const gate = await startBountyHunter(character.name, w.id);
        if (!gate.ok) {
            if (gate.reason === "no-bounty") {
                setBountyBoard(prev => prev.filter(b => b.target.trim().toLowerCase() !== character.name.trim().toLowerCase()));
                setWandererDialog({ w, msg: "The hunter checks the board slip, curses, and walks away. The bounty is gone." });
            } else {
                setWandererDialog({ w, msg: gate.error ?? "The hunter loses the trail." });
            }
            return;
        }
        const amount = w.bountyAmount ?? gate.bounty?.amount ?? selfBounty?.amount ?? 0;
        const lvl = bountyHunterLevel(character.level, amount);
        const ai = makeBuiltinAi(`bounty-ai-${w.id}`, w.name, "BH", lvl, "Bounty Board", [], Math.min(18, 8 + Math.floor(amount / 100_000)), undefined, "boss");
        ai.image = wandererAvatar("bountyHunter");
        setWandererDialog(null);
        launchWorldMapFight(ai, selectedSector, { kind: "bounty-hunter", sourceId: w.id, sector: selectedSector, stage: 0 });
    }
    function launchAmbushStage(stage: number, sector: number, chainId: string) {
        // Robbers at the player's level (+0/+1/+2); the boss a few levels above —
        // scaled to the player so the gauntlet is hard, not impossible.
        const ai = stage >= 3 ? buildBossAi(character.level + 3) : buildRobberAi(character.level + stage, `amb${stage}`, stage);
        launchWorldMapFight(ai, sector, { kind: "wanderer-ambush", sourceId: "wanderer-ambush", sector, stage, chainId });
    }
    async function claimAmbushReward(recovering = false): Promise<boolean> {
        try {
            const res = await fetch("/api/sector/wanderer-ambush", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "claim", playerName: character.name }) });
            const d = await res.json() as { ok?: boolean; reward?: { ryo: number; fateShards: number; boneCharms: number }; character?: Character; _saveVersion?: number };
            if (d.ok && d.reward && d.character) {
                if (!onVersionedCharacter(d.character, d._saveVersion)) return false;
                const parts = [`${d.reward.ryo} ryo`];
                if (d.reward.fateShards > 0) parts.push(`${d.reward.fateShards} fate shard${d.reward.fateShards === 1 ? "" : "s"}`);
                if (d.reward.boneCharms > 0) parts.push(`${d.reward.boneCharms} bone charm${d.reward.boneCharms === 1 ? "" : "s"}`);
                setTimeout(() => alert(`${recovering ? "Recovered ambush ledger — " : "You overwhelmed the bandits and felled their warlord! Loot: "}${parts.join(", ")}.`), 40);
                return true;
            }
        } catch { /* fall through to the no-loot message */ }
        if (!recovering) setTimeout(() => alert("The warlord is down, but the loot ledger is still syncing. It will retry when the World Map opens."), 40);
        return false;
    }

    function clearPendingWorldFollowUp(context: WandererFightSettlement["worldContext"]): void {
        try {
            const raw = localStorage.getItem(WANDERER_PENDING_KEY);
            if (!raw) return;
            const current = JSON.parse(raw) as WandererFightPresentation;
            if (current.sourceId === context.sourceId
                && Number(current.stage) === context.stage
                && Number(current.sector) === context.sector) {
                localStorage.removeItem(WANDERER_PENDING_KEY);
            }
        } catch { /* private mode has no local recovery marker */ }
    }

    async function syncHuntTrailAfterPack(missionId: string) {
        const state = await postWorldHunt({ playerName: character.name, action: "state", missionId });
        if (!state.ok) return null;
        if (state.character) {
            if (!onVersionedCharacter(state.character, state._saveVersion)) return null;
        } else if (onServerVersion?.(state._saveVersion) === false) {
            return null;
        }
        if (state.acceptedMissionIds) setAcceptedMissionIds(state.acceptedMissionIds);
        adoptHuntProgressMirror(missionId, state.state, state.missionProgress);
        setAuthoritativeHuntStates((current) => {
            if (!state.state) {
                const next = { ...current };
                delete next[missionId];
                return next;
            }
            return { ...current, [missionId]: state.state };
        });
        return state.state ?? null;
    }

    function resolveWandererFight(p: WandererFightPresentation, settlement: WandererFightSettlement) {
        const won = settlement.outcome === "win";
        const context = settlement.worldContext;
        if (p.mode === "patrol") {
            const hostile = p.hostile ?? / Captain$/i.test(context.displayName);
            if (won) setTimeout(() => alert(hostile ? "You broke the patrol's line and sent them running." : "The patrol yields after a clean spar."), 40);
            else setTimeout(() => alert(hostile ? "The patrol overwhelms you and leaves you for the healers." : "The patrol drops you, then drags you clear of the road."), 40);
            return;
        }
        if (p.mode === "bountyHunter") {
            // Win or lose, the bounty stays on the board. An AI hunter is a threat
            // and a warning, never a payout — a contract this size only settles
            // when a real shinobi beats you in a verified duel. (Letting an AI
            // kill clear the bounty was the self-clear exploit.)
            setTimeout(() => alert(won
                ? `You survived ${p.hunterName ?? "the bounty hunter"}. The bounty on your head still stands.`
                : `${p.hunterName ?? "The bounty hunter"} put you down — but they can't cash a contract this size. The bounty on your head still stands; only a real shinobi can collect it.`), 40);
            return;
        }
        if (p.mode === "single") {
            if (won && p.nemesis) setTimeout(() => alert(`You put your rival ${p.name ?? "the bandit"} in the dirt at last. Revenge.`), 40);
            else if (!won && p.nemesis) setTimeout(() => alert(`${p.name ?? "Your rival"} bests you again, and grows bolder. This isn't over.`), 40);
            else if (!won && p.name) setTimeout(() => alert(`${p.name} took what they wanted and laughed. You won't forget that name — and they'll be back.`), 40);
            return;
        }
        if (p.mode === "ambush") {
            if (!won) {
                setTimeout(() => alert("The ambush overwhelmed you. The bandits melt back into the wilds."), 40);
                return;
            }
            if (typeof context.nextStage === "number" && context.chainId && !context.finalStage) {
                launchAmbushStage(context.nextStage, context.sector, context.chainId);
            } else {
                void claimAmbushReward().then((claimed) => {
                    if (claimed) clearPendingWorldFollowUp(context);
                });
            }
            return;
        }
        if (p.mode === "huntPack") {
            // The beast's pack, sprung by a risky tracking decision. Waves carry HP
            // like the bandit gauntlet. Surviving the whole pack corners the target;
            // being routed alerts it. Either way the CONTRACT is untouched — the
            // trail is not advanced here, so the player still has to track and kill
            // the real beast, and the server's evidence accounting stays intact.
            const missionId = context.missionId ?? p.missionId ?? context.sourceId;
            if (!won) {
                void syncHuntTrailAfterPack(missionId).then((trail) => {
                    const lead = trail?.sector;
                    setTimeout(() => alert(lead
                        ? `The pack drives you off, but the Guild still has the trail. Regroup, then continue in Sector ${lead}.`
                        : "The pack drives you off the trail. Return to the Hunter Guild if the lead does not reappear."), 40);
                });
                return;
            }
            const mission = builtinHuntMissions.find((m) => m.id === missionId);
            const beast = mission ? playableAis.find((a) => a.id === mission.aiProfileId) : undefined;
            if (typeof context.nextStage === "number" && context.chainId && !context.finalStage && mission && beast) {
                launchHuntPackStage(mission, beast, context.nextStage, context.sector, context.chainId, context.decisionId);
                return;
            }
            void syncHuntTrailAfterPack(missionId).then((trail) => {
                const lead = trail?.sector;
                setTimeout(() => alert(lead
                    ? `The last of the pack goes down. The trail reopens in Sector ${lead}; your target is alone now.`
                    : "The last of the pack goes down. Your target is alone now — and it knows it."), 40);
            });
            return;
        }
        if (p.mode === "huntTarget") {
            const missionId = context.missionId ?? context.sourceId;
            const mission = builtinHuntMissions.find((entry) => entry.id === missionId);
            if (won && mission) {
                // Presentation mirror only. The claim remains gated by the sealed
                // hunt-target WIN receipt written by report-ai-fight.
                setMissionProgress((current) => ({ ...current, [mission.id]: mission.exploreCount }));
                setAuthoritativeHuntStates((current) => {
                    const next = { ...current };
                    delete next[mission.id];
                    return next;
                });
                setTimeout(() => alert(`${context.displayName} is down. Return to the Hunter Guild and turn in the contract for your reward.`), 40);
            } else if (!won) {
                setTimeout(() => alert(`${context.displayName} escaped. The final trail stays hot for a rematch.`), 40);
            }
            return;
        }
        if (p.mode === "questboss") {
            // A Quest Book boss stage. On a win the foe-kill counter ticked, so ask
            // the server to advance the epic (it re-checks the sealed baseline). On a
            // loss the epic is NOT lost — the player can retry from the journal.
            if (won) {
                const authoritativeEpic = settlement.character?.activeQuestbook ?? character.activeQuestbook;
                const stage = questbookStage(context.sourceId, context.stage);
                const proofRows = ((settlement.character as Character & {
                    worldAiContextWins?: Array<{ kind?: string; sourceId?: string; stage?: number; sealVersion?: string; proofId?: string }>;
                } | null | undefined)?.worldAiContextWins ?? []);
                const waveWins = Math.max(1, proofRows.filter((entry) => entry.kind === "questbook-boss"
                    && entry.sourceId === context.sourceId
                    && Number(entry.stage) === context.stage
                    && entry.sealVersion === context.sealVersion
                    && !!entry.proofId).length);
                if (authoritativeEpic?.id === context.sourceId && authoritativeEpic.stage > context.stage) {
                    setTimeout(() => alert("Stage cleared. The next chapter of your epic opens."), 40);
                    clearPendingWorldFollowUp(context);
                    return;
                }
                if (authoritativeEpic?.id === context.sourceId
                    && authoritativeEpic.stage === context.stage
                    && stage && waveWins < Math.max(1, stage.count)) {
                    setTimeout(() => alert(`Boss wave recorded: ${waveWins}/${stage.count}. The next wave is ready.`), 40);
                    clearPendingWorldFollowUp(context);
                    return;
                }
                void advanceEpic(true).then((advanced) => {
                    if (advanced) clearPendingWorldFollowUp(context);
                });
            }
            else { setTimeout(() => alert("The foe stands. Your quest holds — rest, then face them again."), 40); }
        }
        if (p.mode === "storyReckoning") {
            const arc = p.storyReckoningId ? storyReckoningForEventId(p.storyReckoningId) : null;
            if (!arc) return;
            if (won) {
                const authoritativeReckoning = settlement.character?.activeStoryReckoning ?? character.activeStoryReckoning;
                if (authoritativeReckoning?.id === context.sourceId && authoritativeReckoning.stage === "return") {
                    setTimeout(() => alert(`You recovered ${arc.task.targetName}. Return to ${arc.npcName} at the outskirts.`), 40);
                    clearPendingWorldFollowUp(context);
                    return;
                }
                void handleStoryReckoningReport(arc, false).then((reported) => {
                    if (reported) clearPendingWorldFollowUp(context);
                });
            }
            else { setTimeout(() => alert(`${arc.task.targetName} still holds the road. Rest, then try the reckoning again.`), 40); }
        }
    }

    function pendingFollowUpContext(pending: WandererFightPresentation): WorldAiFightContext | null {
        const kind = WORLD_FIGHT_KIND_BY_MODE[pending.mode];
        if (!kind) return null;
        return {
            kind,
            sourceId: pending.sourceId,
            sector: pending.sector,
            stage: pending.stage,
            displayName: pending.name ?? pending.hunterName ?? "World encounter",
            ...(kind === "wanderer-ambush" && pending.stage >= 3 ? { finalStage: true } : {}),
            ...(pending.missionId ? { missionId: pending.missionId } : {}),
        };
    }

    async function recoverUnstampedWorldFollowUp(pending: WandererFightPresentation): Promise<void> {
        if (pending.playerName.trim().toLowerCase() !== character.name.trim().toLowerCase()) return;
        if (Date.now() - (pending.at || 0) > 30 * 60 * 1000) return;
        const context = pendingFollowUpContext(pending);
        if (!context) return;

        if (pending.mode === "ambush" && pending.stage >= 3) {
            if (await claimAmbushReward(true)) clearPendingWorldFollowUp(context);
            return;
        }
        if (pending.mode === "questboss") {
            const epic = character.activeQuestbook;
            if (!epic || epic.id !== pending.sourceId || epic.stage > pending.stage) {
                clearPendingWorldFollowUp(context);
                return;
            }
            const proofs = ((character as Character & {
                worldAiContextWins?: Array<{ kind?: string; sourceId?: string; stage?: number; at?: number; proofId?: string }>;
            }).worldAiContextWins ?? []).filter((entry) => entry.kind === "questbook-boss"
                && entry.sourceId === pending.sourceId
                && Number(entry.stage) === pending.stage
                && Number(entry.at) >= pending.at
                && !!entry.proofId);
            if (proofs.length === 0) return;
            const stage = questbookStage(pending.sourceId, pending.stage);
            if (stage && proofs.length < Math.max(1, stage.count)) {
                clearPendingWorldFollowUp(context);
                return;
            }
            if (await advanceEpic(true)) clearPendingWorldFollowUp(context);
            return;
        }
        if (pending.mode === "storyReckoning") {
            const arc = storyReckoningForEventId(pending.storyReckoningId ?? pending.sourceId);
            if (!arc) return;
            const active = character.activeStoryReckoning;
            if (!active || active.id !== pending.sourceId || active.stage === "return") {
                clearPendingWorldFollowUp(context);
                return;
            }
            const proved = ((character as Character & {
                worldAiContextWins?: Array<{ kind?: string; sourceId?: string; stage?: number; at?: number; proofId?: string }>;
            }).worldAiContextWins ?? []).some((entry) => entry.kind === "story-reckoning"
                && entry.sourceId === pending.sourceId
                && Number(entry.stage) === pending.stage
                && Number(entry.at) >= pending.at
                && !!entry.proofId);
            if (!proved) return;
            if (await handleStoryReckoningReport(arc, false, true)) clearPendingWorldFollowUp(context);
        }
    }

    const worldFightResolverRef = useRef(resolveWandererFight);
    useLayoutEffect(() => { worldFightResolverRef.current = resolveWandererFight; });
    // The token-sealed report publishes the result live. localStorage is only the
    // presentation/chain recovery record; it never supplies an outcome.
    useEffect(() => {
        function consume(settlement: WandererFightSettlement) {
            if (!settlement?.worldContext) return;
            const context = settlement.worldContext;
            let stored: WandererFightPresentation | null = null;
            try {
                const raw = localStorage.getItem(WANDERER_PENDING_KEY);
                if (raw) stored = JSON.parse(raw) as WandererFightPresentation;
            } catch { /* private mode: derive presentation from the server seal */ }
            const settledName = settlement.character?.name ?? stored?.playerName ?? "";
            if (!settledName || settledName.trim().toLowerCase() !== character.name.trim().toLowerCase()) return;
            if (!settlement.character && stored && Date.now() - (stored.at || 0) > 30 * 60 * 1000) return;
            const storedMatchesSeal = stored
                && WORLD_FIGHT_KIND_BY_MODE[stored.mode] === context.kind
                && stored.sourceId === context.sourceId
                && Number(stored.stage) === context.stage
                && Number(stored.sector) === context.sector
                && Date.now() - (stored.at || 0) <= 30 * 60 * 1000;
            const p = storedMatchesSeal
                ? stored!
                : wandererFightPresentationFromContext(settledName, context);
            if (!worldFightNeedsDurableFollowUp(settlement)) {
                try { localStorage.removeItem(WANDERER_PENDING_KEY); } catch { /* private mode */ }
            }
            // AiFightHost commits the returned character just before publishing.
            // Defer the presentation callback one task so this ref points at the
            // render carrying that authoritative quest/hunt/account state.
            window.setTimeout(() => worldFightResolverRef.current(p, settlement), 0);
        }
        const onSettled = (event: Event) => consume((event as CustomEvent<WandererFightSettlement>).detail);
        window.addEventListener(WANDERER_FIGHT_SETTLED_EVENT, onSettled);
        try {
            const raw = localStorage.getItem(WANDERER_PENDING_KEY);
            if (raw) {
                const pending = JSON.parse(raw) as WandererFightPresentation & { settlement?: WandererFightSettlement };
                if (pending.settlement) consume(pending.settlement);
                else void recoverUnstampedWorldFollowUp(pending);
            }
        } catch { /* private mode */ }
        return () => window.removeEventListener(WANDERER_FIGHT_SETTLED_EVENT, onSettled);
    }, [character.name]);
    // Wanderer interaction dialog. `nemesis` flags a bandit encounter that's
    // actually your returning rival. The dialog is the only UI; rewards are
    // server-authoritative.
    const [wandererDialog, setWandererDialog] = useState<WorldWandererDialogState | null>(null);
    useEffect(() => {
        if (legacyAvailable) return;
        setSageOffer(null);
        setSageVnEvent(null);
        setSageChoiceOpen(false);
        setWandererDialog((current) => current?.w.id === LEGACY_SAGE_WANDERER_ID ? null : current);
    }, [legacyAvailable]);
    function requiresWandererChoice(d: WorldWandererDialogState | null) {
        return !!d && !d.msg && (d.w.verb === "attack" || d.w.verb === "bountyHunter");
    }
    function handleWandererEngage(w: Wanderer) {
        if (selectedSector == null || !sameSector(currentSector, selectedSector)) return;
        rememberWanderer(w);
        // Fresh scene, fresh verdict: whether the LAST giver's offer was taken must
        // never carry into this one's decline check. (The rift-accept branch closes
        // its VN directly rather than through a close path, so the stamp it leaves
        // would otherwise outlive the scene that set it.)
        if (isRoamingGiverEventId(w.id)) giverAcceptedRef.current = null;
        // The Wandering Sage opens his Legacy-offer VN instead of the dialog.
        if (w.id === LEGACY_SAGE_WANDERER_ID) {
            if (legacyAvailable && sageOffer) {
                setSageVnPage(0);
                setSageVnLine(0);
                setSageVnEvent(buildSageVnEvent(sageOffer, character.name));
            }
            return;
        }
        // A story road event opens its VN directly (no verb dialog) — same
        // pattern as the Sage. The event stays available until a choice is made.
        if (w.id.startsWith(ROAD_WANDERER_PREFIX)) {
            const roadEvent = roadEventBySynthId(w.id);
            if (roadEvent && selectedSector != null) {
                setCreatorEventPage(0);
                setCreatorEventLine(0);
                setSelectedCreatorEvent(roadEventToCreatorEvent(roadEvent, biomeForWorldSector(selectedSector)));
            }
            return;
        }
        // A rift giver brings a field report from a target sector; this opens the
        // intro VN (accept seals the rift + reveals its structure on the map).
        if (isStoryReckoningId(w.id)) {
            const arc = storyReckoningForEventId(w.id);
            if (!arc || selectedSector == null) return;
            const active = character.activeStoryReckoning;
            const biome = biomeForWorldSector(selectedSector);
            setCreatorEventPage(0);
            setCreatorEventLine(0);
            if (active?.id === arc.id && active.stage === "return") {
                setSelectedCreatorEvent(storyReckoningPayoffEvent(arc, biome));
                return;
            }
            if (active?.id === arc.id && active.stage === "task") {
                if (arc.task.kind === "collect") {
                    const got = Math.max(0, ((character[arc.task.metric] as number | undefined) ?? 0) - active.baseline);
                    if (got >= active.target) {
                        void handleStoryReckoningReport(arc, true);
                        return;
                    }
                    setWandererDialog({ w, msg: `${arc.npcName} waits while you search. Progress: ${Math.min(got, active.target)} / ${active.target}.` });
                    return;
                }
                setWandererDialog({ w, msg: `${arc.npcName} waits for proof that ${arc.task.targetName} has been dealt with.` });
                return;
            }
            if (active && active.id !== arc.id) {
                setWandererDialog({ w, msg: "Finish the reckoning you already carry before taking another." });
                return;
            }
            setSelectedCreatorEvent(storyReckoningIntroEvent(arc, biome));
            return;
        }
        if (w.id.startsWith(RIFT_GIVER_PREFIX)) {
            const rift = riftBySynthId(w.id);
            if (rift && selectedSector != null) {
                const targetSector = riftTargetSector(character.name, rift.id);
                setCreatorEventPage(0);
                setCreatorEventLine(0);
                setSelectedCreatorEvent(riftIntroEvent(rift, targetSector, biomeForWorldSector(selectedSector)));
            }
            return;
        }
        if (w.id === SCRIBE_WANDERER_ID) {
            if (selectedSector != null) {
                setCreatorEventPage(0);
                setCreatorEventLine(0);
                setSelectedCreatorEvent(scribeIntroEvent(biomeForWorldSector(selectedSector)));
            }
            return;
        }
        if (petMentor.engage(w)) return;
        // A roaming mercenary doesn't parley — it forces a server-resolved fight.
        if (isMercAiId(w.id)) { void engageRoamingMerc(w); return; }
        if (w.verb === "bountyHunter") {
            setWandererDialog({ w });
            return;
        }
        // A bandit you face while you have a rival has a chance of BEING that rival,
        // back for more.
        if (w.verb === "attack" && character.wandererNemesis && Math.random() < 0.45) {
            setWandererDialog({ w, nemesis: true });
            return;
        }
        // The world remembers your Quest Book choices (character.questStandings): a
        // spared Goro's old gang may wave you through; colder choices earn cold words.
        const react = standingReaction(w.archetype, character.questStandings, Math.random());
        if (w.verb === "attack" && react?.peace) {
            setWandererDialog({ w, standingLine: react.line, peace: true });
            return;
        }
        // Every wanderer — bandits included — opens a dialog first (a threat line
        // + Fight/Flee for bandits; greetings + actions for the rest).
        setWandererDialog({ w, standingLine: react?.line });
    }
    // A roaming merc reaching the player resolves SERVER-SIDE (no client Arena, no
    // Fight/Flee — a merc forces the fight; the server calls it). The result reuses
    // the resolved-dialog path. The merc NPC is hidden client-side after the clash;
    // the server enforces the real 15-min per-target cooldown.
    async function engageRoamingMerc(w: Wanderer) {
        if (!villageWarAdmissionOpen || !capabilityAdmissionAllowed(mutationAvailability("villageWar"))) {
            setWandererDialog({ w, msg: "Village War actions are paused. This patrol remains visible while live admission recovers." });
            return;
        }
        const sec = selectedSector;
        if (sec == null) return;
        const village = (character.village ?? "").trim();
        coolWanderer(w.id, MERC_CLIENT_HIDE_MS);
        setWandererDialog({ w, busy: true, msg: "⚔ A mercenary closes in…" });
        try {
            const r = await engageMerc(character.name, village, sec, w.id);
            const msg = r.error ? r.error
                : r.winner === "player" ? "You cut the mercenary down."
                : r.winner === "merc" ? (r.context === "village" ? "The mercenary overwhelmed you — your village bleeds for it." : "The mercenary overwhelmed you — your hold on the sector slips.")
                : "You traded blows; the mercenary broke off.";
            setWandererDialog({ w, msg });
            if (village) void fetchMercRoster(character.name, village, sec).then(m => setMercRoster({ sector: sec, mercs: m })).catch(() => { /* best-effort refresh */ });
        } catch {
            setWandererDialog({ w, msg: "You couldn't reach the contract board." });
        }
    }
    // Closing the dialog. Fleeing/declining a BANDIT (you took no reward) puts it on
    // a short cooldown so it backs off instead of re-confronting you every time you
    // step back into the sector. Non-bandit dialogs (gift/quest/pet/card) just close
    // — they cool only when you actually take their interaction. Already-resolved
    // (`msg`) dialogs just close; the cooldown was set when the action ran.
    function dismissWandererDialog() {
        const d = wandererDialog;
        setWandererDialog(null);
        if (d && !d.msg && (d.w.verb === "attack" || d.w.verb === "bountyHunter")) coolWanderer(d.w.id, WANDERER_FLEE_COOLDOWN_MS);
    }
    function handleWandererBackdropClick() {
        if (requiresWandererChoice(wandererDialog)) return;
        dismissWandererDialog();
    }

    // Sector traces — footfall + trail signs + shrine (server-authoritative snapshot,
    // refetched on sector change; action responses patch it in place).
    const [sectorTraces, setSectorTraces] = useState<SectorTracesView | null>(null);
    const [tracesModal, setTracesModal] = useState<TracesModalState | null>(null);
    useEffect(() => {
        setSectorTraces(null);
        setTracesModal(null);
        if (!isSectorTracesEnabled() || selectedSector == null || selectedSector < 1 || selectedSector > 60) return;
        let cancelled = false;
        void fetchSectorTraces(selectedSector, character.name).then((view) => {
            if (!cancelled && view && view.sector === selectedSector) setSectorTraces(view);
        });
        return () => { cancelled = true; };
    }, [selectedSector, character.name]);
    async function claimWandererGift(w: Wanderer) {
        setWandererDialog({ w, busy: true });
        try {
            const res = await fetch("/api/sector/wanderer-gift", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, sector: selectedSector ?? 0, wandererId: w.id }),
            });
            const data = await res.json() as {
                ok?: boolean; reason?: string;
                gift?: { ryo: number; fateShards: number; boneCharms: number };
                totals?: { ryo: number; fateShards: number; boneCharms: number };
            };
            // Only a REAL answer retires the road keeper. This used to run
            // unconditionally, so any rejected request — a 5xx, a dropped
            // connection, or the wild-field presence gate refusing a request
            // sent before presence settled — burned the encounter for hours
            // even though nothing was given. A refusal must cost the player
            // nothing; the server's own "nothing left" / "cooldown" answers
            // still arrive as 200 and retire it as before.
            if (res.ok) coolWanderer(w.id);
            if (data.ok && data.gift && data.totals) {
                updateCharacter(prev => prev ? ({ ...prev, ryo: data.totals!.ryo, fateShards: data.totals!.fateShards, boneCharms: data.totals!.boneCharms }) : prev);
                const parts = [`${data.gift.ryo} ryo`];
                if (data.gift.fateShards > 0) parts.push(`${data.gift.fateShards} fate shard${data.gift.fateShards === 1 ? "" : "s"}`);
                if (data.gift.boneCharms > 0) parts.push(`${data.gift.boneCharms} bone charm${data.gift.boneCharms === 1 ? "" : "s"}`);
                setWandererDialog({ w, msg: `${w.name} presses a small bundle into your hand: ${parts.join(", ")}.` });
            } else if (data.reason === "daily-cap") {
                setWandererDialog({ w, msg: "“I've nothing left to give today, friend.”" });
            } else if (data.reason === "cooldown") {
                setWandererDialog({ w, msg: "They have already moved on. Search another sector." });
            } else if (data.reason === "invalid-wanderer") {
                setWandererDialog({ w, msg: "The road shifts; this wanderer is no longer here." });
            } else {
                setWandererDialog({ w, msg: "They turn away, empty-handed." });
            }
        } catch {
            setWandererDialog({ w, msg: "You couldn't reach them." });
        }
    }
    function startWandererPetDuel(w: Wanderer) {
        // The interaction gate, same as the gambler's (the beast is on the road for
        // everyone): the Pet Arena has its own empty-roster screen, and being walked
        // into it by a beast that just challenged you is a dead end.
        if (!character.pets.length) {
            setWandererDialog({ w, msg: `The beast waits for a challenger that never comes. You have no pet to send out — tame one first, and it will still be prowling this road.` });
            return;
        }
        if (selectedSector == null || !isWildSector(selectedSector)) return;
        // This card is only a preview. The exact roster slot, verb, sector,
        // player pet, tier, scaling, seed and outcome are reconstructed/sealed
        // by battle-start before the wanderer cooldown is committed.
        const targetLevel = Math.max(1, Math.min(100, character.level));
        const tmpl = targetLevel < 20 ? genericPetArenaOpponents[0]
            : targetLevel < 45 ? genericPetArenaOpponents[1]
            : genericPetArenaOpponents[2];
        const preview = scaleWandererPetOpponent(tmpl.pet, targetLevel);
        // Deterministic preview identity from the wanderer + player tile. The
        // server ignores it and owns the actual Showdown seed.
        let seed = (sectorPlayerPos + 1) >>> 0;
        for (let i = 0; i < w.id.length; i++) seed = (Math.imul(seed, 31) + w.id.charCodeAt(i)) >>> 0;
        setPendingPetBattleOpponent({
            owner: w.name,
            // Shown on the matchup card. The SERVER builds the beast it actually
            // fights from the same rule (tier by the caller's own saved level,
            // then scaled), so this is a preview of that opponent rather than
            // the opponent itself — the arena never fights what the client sends.
            pet: preview,
            // `sector` travels with the id: the sealed wanderer session validates
            // the encounter against the sector the SAVE says you stand in, and
            // rejects a duel claimed from anywhere else.
            wanderer: { id: w.id, sector: selectedSector },
            battleSeed: seed,
            returnScreen: "worldMap",
        });
        // Remember the sector so returning from the duel reopens it (the pet battle
        // returns to the World Map, which consumes this latch on remount).
        setSectorReopen(selectedSector != null && isWildSector(selectedSector) ? selectedSector : null);
        setWandererDialog(null);
        setScreen("petArena");
    }
    function startWandererCardDuel(w: Wanderer) {
        // The interaction gate (the roster is shared by everyone, so a sealed
        // player DOES meet gamblers): never hand a sealed player to the Card Hall,
        // which would just show its "the Chronicle is sealed" wall. Say it
        // in-fiction instead — and point at Ihara, since finding her IS the way through.
        if (cardGameLockStatus(character).locked) {
            setWandererDialog({ w, msg: `${w.name} squints at your empty hands, then pockets the deck. "Come back when a scribe's put a codex in your pack — no sport in fleecing a man with nothing to play."` });
            return;
        }
        // The gambler deals you straight into Chronicle Showdown in the Card Hall.
        coolWanderer(w.id); // gambler dealt you in — gone for a few hours
        // Remember the sector so finishing the match returns the player here: the
        // Card Hall's Back goes through history to the World Map, which reopens this
        // sector on remount instead of dropping the player on the overview.
        setSectorReopen(selectedSector != null && isWildSector(selectedSector) ? selectedSector : null);
        requestCardChallenge();
        setWandererDialog(null);
        setScreen("shinobiTiles");
    }
    async function acceptWandererQuest(w: Wanderer, defOverride?: EmissaryQuestDef) {
        // Same locked-objective filter the offer text uses, so the accepted id can
        // never be the card/pet quest a sealed player was never shown.
        const def = defOverride ?? questForWanderer(w, lockedQuestMetrics(character));
        setWandererDialog({ w, busy: true });
        try {
            const res = await fetch("/api/sector/wanderer-quest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "accept", playerName: character.name, questId: def.id, sector: selectedSector ?? 0, wandererId: w.id }),
            });
            const data = await res.json() as { ok?: boolean; reason?: string; baseline?: number; target?: number };
            if (data.ok && typeof data.baseline === "number") {
                coolNaturalWanderer(w);
                updateCharacter(prev => prev ? ({ ...prev, activeWandererQuest: { id: def.id, target: def.target, baseline: data.baseline! } }) : prev);
                setWandererDialog({ w, msg: `Quest accepted — ${def.label.toLowerCase()}. Return when it's done.` });
            } else if (data.reason === "busy") {
                setWandererDialog({ w, msg: "“Finish the task you already carry first.”" });
            } else if (data.reason === "cooldown") {
                coolNaturalWanderer(w);
                setWandererDialog({ w, msg: "They have already moved on. Search another sector." });
            } else {
                setWandererDialog({ w, msg: "They reconsider, and say nothing." });
            }
        } catch {
            setWandererDialog({ w, msg: "You couldn't reach them." });
        }
    }
    async function claimWandererQuest(w: Wanderer) {
        setWandererDialog({ w, busy: true });
        try {
            const res = await fetch("/api/sector/wanderer-quest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "claim", playerName: character.name, sector: selectedSector ?? 0, wandererId: w.id }),
            });
            const data = await res.json() as { ok?: boolean; reason?: string; ryo?: number; totalRyo?: number; character?: Character; _saveVersion?: number };
            if (data.character && !onVersionedCharacter(data.character, data._saveVersion)) return;
            if (data.ok && typeof data.totalRyo === "number") {
                coolNaturalWanderer(w);
                if (!data.character && onServerVersion?.(data._saveVersion) !== false) updateCharacter(prev => prev && prev.name === character.name ? ({ ...prev, ryo: data.totalRyo!, activeWandererQuest: null }) : prev);
                setWandererDialog({ w, msg: `“Well done.” You receive ${data.ryo} ryo.` });
            } else if (data.reason === "incomplete") {
                setWandererDialog({ w, msg: "“Not yet. The roads are still dangerous.”" });
            } else if (data.reason === "cooldown") {
                coolNaturalWanderer(w);
                setWandererDialog({ w, msg: "They have already moved on. Search another sector." });
            } else {
                setWandererDialog({ w, msg: "“You carry no task of mine.”" });
            }
        } catch {
            setWandererDialog({ w, msg: "You couldn't reach them." });
        }
    }
    // ── Quest Book (multi-stage epics) ───────────────────────────────────────
    // Reuses the wanderer art for the bestiary foes (bespoke boss art is a follow-up).
    async function abandonWandererQuest(w: Wanderer) {
        if (!(await gameConfirm("Abandon this task? Your progress on it will be lost.", { danger: true, confirmLabel: "Abandon" }))) return;
        setWandererDialog({ w, busy: true });
        try {
            const res = await fetch("/api/sector/wanderer-quest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "abandon", playerName: character.name }),
            });
            const data = await res.json() as { ok?: boolean; character?: Character; _saveVersion?: number };
            if (!data.ok) throw new Error();
            if (data.character) { if (!onVersionedCharacter(data.character, data._saveVersion)) return; }
            else if (onServerVersion?.(data._saveVersion) !== false) updateCharacter(prev => prev && prev.name === character.name ? ({ ...prev, activeWandererQuest: null }) : prev);
            setWandererDialog({ w, msg: "You set the task down." });
        } catch {
            setWandererDialog({ w, msg: "The task could not be abandoned. Try again." });
        }
    }
    function epicBossPortrait(key: "bandit2" | "bandit3" | "boss" | "nemesis" | "beast"): string {
        if (key === "bandit2") return wandererRobberPortrait(1);
        if (key === "bandit3") return wandererRobberPortrait(2);
        if (key === "nemesis") return WANDERER_NEMESIS_PORTRAIT;
        if (key === "beast") return wandererAvatar("beast");
        return WANDERER_BOSS_PORTRAIT;
    }
    async function acceptEpic(w: Wanderer, questId: string) {
        setWandererDialog({ w, busy: true });
        try {
            const res = await fetch("/api/sector/questbook", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "accept", playerName: character.name, questId }),
            });
            const data = await res.json() as { ok?: boolean; reason?: string; target?: number; deadline?: number | null };
            const entry = questbookEntry(questId);
            if (data.ok && entry) {
                coolNaturalWanderer(w);
                const s0 = entry.stages[0];
                updateCharacter(prev => prev ? ({ ...prev, activeQuestbook: { id: questId, stage: 0, baseline: (prev[s0.metric] as number | undefined) ?? 0, target: s0.count, deadline: data.deadline ?? null, choices: {} } }) : prev);
                setWandererDialog({ w, msg: `Epic begun — “${entry.title}.” Your journal is open.` });
            } else if (data.reason === "busy") {
                setWandererDialog({ w, msg: "“Finish the tale you already walk first.”" });
            } else if (data.reason === "cooldown") {
                setWandererDialog({ w, msg: "“That story is freshly told. Return another day.”" });
            } else if (data.reason === "band") {
                setWandererDialog({ w, msg: "“This task is not for one of your standing — not yet.”" });
            } else {
                setWandererDialog({ w, msg: "They reconsider, and say nothing." });
            }
        } catch { setWandererDialog({ w, msg: "You couldn't reach them." }); }
    }
    async function advanceEpic(auto = false): Promise<boolean> {
        try {
            const res = await fetch("/api/sector/questbook", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "advance", playerName: character.name }),
            });
            const data = await res.json() as { ok?: boolean; reason?: string; stage?: number; target?: number; advanced?: boolean; readyToClaim?: boolean; progress?: number; resetToStage?: number; deadline?: number | null; _saveVersion?: number };
            const cur = character.activeQuestbook;
            if (data.ok && data.advanced && typeof data.stage === "number" && cur) {
                if (data._saveVersion != null && onServerVersion?.(data._saveVersion) === false) return false;
                const entry = questbookEntry(cur.id);
                const st = entry?.stages[data.stage] ?? null;
                updateCharacter(prev => {
                    if (!prev) return prev;
                    const baseline = st ? ((prev[st.metric] as number | undefined) ?? 0) : cur.baseline;
                    return { ...prev, activeQuestbook: { ...cur, stage: data.stage!, baseline, target: data.target ?? cur.target, deadline: data.deadline ?? null } };
                });
                setTimeout(() => alert("Stage cleared. The next chapter of your epic opens."), 40);
                return true;
            } else if (data.ok && data.readyToClaim) {
                if (!auto) setTimeout(() => alert("The final deed is done — claim your reward from the journal."), 40);
                return true;
            } else if (data.reason === "expired" && typeof data.resetToStage === "number" && cur) {
                if (data._saveVersion != null && onServerVersion?.(data._saveVersion) === false) return false;
                const entry = questbookEntry(cur.id);
                const st = entry?.stages[data.resetToStage] ?? null;
                updateCharacter(prev => {
                    if (!prev) return prev;
                    const baseline = st ? ((prev[st.metric] as number | undefined) ?? 0) : cur.baseline;
                    return { ...prev, activeQuestbook: { ...cur, stage: data.resetToStage!, baseline, target: data.target ?? cur.target, deadline: data.deadline ?? null } };
                });
                setTimeout(() => alert("The bell finished its sound — you were too slow. The stage resets; try again."), 40);
            } else if (!auto && data.reason === "incomplete") {
                alert(`Not yet — ${data.progress ?? 0} / ${data.target ?? "?"} done for this stage.`);
            }
        } catch { if (!auto) alert("You couldn't reach the quest-giver."); }
        return false;
    }
    async function chooseEpicOption(w: Wanderer, optionKey: string) {
        const cur = character.activeQuestbook;
        if (!cur) return;
        const curKey = questbookStage(cur.id, cur.stage)?.key ?? "";
        setWandererDialog({ w, busy: true });
        try {
            const res = await fetch("/api/sector/questbook", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "choose", playerName: character.name, optionKey }),
            });
            const data = await res.json() as { ok?: boolean; reason?: string; chose?: string; advanced?: boolean; readyToClaim?: boolean; stage?: number; target?: number; deadline?: number | null };
            if (data.ok) {
                coolNaturalWanderer(w);
                const nextChoices = { ...(cur.choices ?? {}), [curKey]: optionKey };
                if (data.advanced && typeof data.stage === "number") {
                    const entry = questbookEntry(cur.id);
                    const st = entry?.stages[data.stage] ?? null;
                    updateCharacter(prev => {
                        if (!prev) return prev;
                        const baseline = st ? ((prev[st.metric] as number | undefined) ?? 0) : cur.baseline;
                        return { ...prev, activeQuestbook: { ...cur, stage: data.stage!, baseline, target: data.target ?? cur.target, deadline: data.deadline ?? null, choices: nextChoices } };
                    });
                } else {
                    updateCharacter(prev => prev ? ({ ...prev, activeQuestbook: { ...cur, choices: nextChoices } }) : prev);
                }
                setWandererDialog({ w, msg: "Your choice is made. The path shifts." });
            } else {
                setWandererDialog({ w, msg: "The moment passes." });
            }
        } catch { setWandererDialog({ w, msg: "You couldn't reach them." }); }
    }
    async function claimEpic(w: Wanderer) {
        setWandererDialog({ w, busy: true });
        try {
            const res = await fetch("/api/sector/questbook", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "claim", playerName: character.name }),
            });
            const data = await res.json() as { ok?: boolean; reason?: string; ryo?: number; totalRyo?: number; fateShards?: number; title?: string; clearedRivalry?: boolean };
            if (data.ok && typeof data.totalRyo === "number") {
                coolNaturalWanderer(w);
                updateCharacter(prev => {
                    if (!prev) return prev;
                    const titles = prev.questTitles ?? [];
                    const nextTitles = data.title && !titles.includes(data.title) ? [...titles, data.title] : titles;
                    return { ...prev, ryo: data.totalRyo!, fateShards: (prev.fateShards ?? 0) + (data.fateShards ?? 0), questTitles: nextTitles, activeQuestbook: null, ...(data.clearedRivalry ? { wandererNemesis: null } : {}) };
                });
                const bits = [`${data.ryo} ryo`];
                if (data.fateShards) bits.push(`${data.fateShards} fate shard${data.fateShards === 1 ? "" : "s"}`);
                if (data.title) bits.push(`the title “${data.title}”`);
                if (data.clearedRivalry) bits.push("and your rivalry ends at last");
                setWandererDialog({ w, msg: `Epic complete! You earn ${bits.join(", ")}.` });
            } else if (data.reason === "incomplete") {
                setWandererDialog({ w, msg: "“The tale isn't finished yet.”" });
            } else {
                setWandererDialog({ w, msg: "“You carry no epic of mine.”" });
            }
        } catch { setWandererDialog({ w, msg: "You couldn't reach them." }); }
    }
    async function abandonEpic(w: Wanderer) {
        if (!(await gameConfirm("Abandon this epic? Your progress on it will be lost.", { danger: true, confirmLabel: "Abandon" }))) return;
        setWandererDialog({ w, busy: true });
        try {
            await fetch("/api/sector/questbook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "abandon", playerName: character.name }) });
        } catch { /* ignore — clear locally anyway */ }
        updateCharacter(prev => prev ? ({ ...prev, activeQuestbook: null }) : prev);
        setWandererDialog({ w, msg: "You set the burden down." });
    }
    function fightEpicBoss(w: Wanderer) {
        if (selectedSector == null) return;
        const active = character.activeQuestbook;
        if (!active) return;
        const stage = questbookStage(active.id, active.stage);
        if (!stage?.bossId) return;
        const spec = QUEST_BOSSES[stage.bossId];
        if (!spec) return;
        // Foe-kill boss stages launch the sealed boss in Solo-PvE; pet-win stages
        // are fulfilled in the Pet Coliseum, then advanced from the journal.
        if (stage.metric !== "totalAiKills") { setWandererDialog({ w, msg: "Face this one in the Pet Colosseum, then return to your journal." }); return; }
        let lvl = Math.max(1, Math.min(100, character.level + spec.levelOffset));
        // A branch choice (e.g. carrying the cursed bell raw) can wake the boss harder.
        let bonus = spec.statBonus + bossStatBonusFromChoices(active.id, active.choices);
        let bossName = spec.name;
        // The capstone's Kazan reflects YOUR rivalry — harder the more he's bested you,
        // and his title rises with a long-running grudge.
        const tier = character.wandererNemesis?.tier ?? 0;
        if (spec.scalesWithRivalry && tier > 0) {
            const esc = rivalryEscalation(tier);
            lvl = Math.max(1, Math.min(100, lvl + esc.level));
            bonus += esc.stat;
            if (tier >= 4) bossName = `${spec.name}, Risen`;
        }
        const ai = makeBuiltinAi(`questboss-${stage.bossId}`, bossName, spec.icon, lvl, "Wandering Road", [], bonus, undefined, spec.loadoutId, !!spec.boss);
        ai.image = questBossPortrait(stage.bossId) ?? epicBossPortrait(spec.portraitKey);
        setWandererDialog(null);
        launchWorldMapFight(
            ai,
            selectedSector,
            // The server derives the active quest stage from its durable seal.
            { kind: "questbook-boss", sourceId: active.id, sector: selectedSector },
        );
    }
    function launchStoryReckoningFight(arc: StoryReckoning) {
        if (selectedSector == null || !arc.task.boss) return;
        const boss = arc.task.boss;
        const lvl = Math.max(1, Math.min(100, character.level + boss.levelOffset));
        const ai = makeBuiltinAi(`story-reckoning-${boss.bossId}`, boss.name, boss.icon, lvl, "Story Reckoning", [], boss.statBonus, undefined, boss.loadoutId, true);
        ai.image = boss.portrait || questBossPortrait(boss.bossId) || WANDERER_BOSS_PORTRAIT;
        launchWorldMapFight(
            ai,
            selectedSector,
            { kind: "story-reckoning", sourceId: arc.id, sector: selectedSector, stage: 0 },
        );
    }
    async function handleStoryReckoningAccept(arc: StoryReckoning) {
        setSelectedCreatorEvent(null);
        const resp = await acceptStoryReckoning(character.name, arc.id);
        if (!resp.ok) {
            const msg = resp.reason === "busy" ? "Finish the story burden you already carry first."
                : resp.reason === "ineligible" ? "You are not far enough into this story yet."
                : "The reckoning could not be sealed. Try again in a moment.";
            setTimeout(() => alert(msg), 40);
            return;
        }
        if (resp.character) { if (!onVersionedCharacter(resp.character, resp._saveVersion)) return; }
        else if (onServerVersion?.(resp._saveVersion) !== false) updateCharacter(prev => prev && prev.name === character.name ? ({ ...prev, activeStoryReckoning: resp.activeStoryReckoning ?? prev.activeStoryReckoning }) : prev);
        if (arc.task.kind === "hunt") {
            launchStoryReckoningFight(arc);
        } else {
            setTimeout(() => alert(`Reckoning accepted: search the outskirts until you find ${arc.task.targetName}.`), 40);
        }
    }
    async function handleStoryReckoningReport(arc: StoryReckoning, openPayoff = false, recovering = false): Promise<boolean> {
        const resp = await reportStoryReckoning(character.name, arc.id);
        if (!resp.ok) {
            if (resp.character && !onVersionedCharacter(resp.character, resp._saveVersion)) return false;
            if (resp.reason === "incomplete") {
                if (!recovering) setTimeout(() => alert(`Not yet: ${resp.progress ?? 0} / ${resp.target ?? arc.task.target} complete.`), 40);
            } else if (!recovering) {
                setTimeout(() => alert("The account did not settle. Return to the outskirts and try again."), 40);
            }
            return false;
        }
        if (resp.character) { if (!onVersionedCharacter(resp.character, resp._saveVersion)) return false; }
        else if (onServerVersion?.(resp._saveVersion) !== false) updateCharacter(prev => prev && prev.name === character.name ? ({ ...prev, activeStoryReckoning: resp.activeStoryReckoning ?? prev.activeStoryReckoning }) : prev);
        else return false;
        if (openPayoff && selectedSector != null) {
            setCreatorEventPage(0);
            setCreatorEventLine(0);
            setSelectedCreatorEvent(storyReckoningPayoffEvent(arc, biomeForWorldSector(selectedSector)));
        } else {
            setTimeout(() => alert(`${recovering ? "Recovered reckoning ledger — " : ""}You recovered ${arc.task.targetName}. Return to ${arc.npcName} at the outskirts.`), 40);
        }
        return true;
    }
    async function handleStoryReckoningTurnIn(arc: StoryReckoning) {
        const resp = await turnInStoryReckoning(character.name, arc.id);
        if (!resp.ok) {
            if (resp.character && !onVersionedCharacter(resp.character, resp._saveVersion)) return;
            const msg = resp.reason === "no-item" ? "You do not have the keepsake yet."
                : resp.reason === "daily-cap" ? "You have settled enough reckonings today. Return tomorrow."
                : "The reckoning could not be turned in. Try again in a moment.";
            setTimeout(() => alert(msg), 40);
            return;
        }
        if (resp.character) { if (!onVersionedCharacter(resp.character, resp._saveVersion)) return; }
        else if (onServerVersion?.(resp._saveVersion) !== false) updateCharacter(prev => {
            if (!prev || prev.name !== character.name) return prev;
            const titles = prev.questTitles ?? [];
            const nextTitles = resp.title && !titles.includes(resp.title) ? [...titles, resp.title] : titles;
            const traits = prev.storyTraits ?? [];
            const nextTraits = resp.completionTrait && !traits.includes(resp.completionTrait) ? [...traits, resp.completionTrait] : traits;
            return {
                ...prev,
                ryo: resp.totalRyo ?? prev.ryo,
                fateShards: resp.totalFateShards ?? prev.fateShards,
                questTitles: nextTitles,
                storyTraits: nextTraits,
                activeStoryReckoning: null,
            };
        });
        const bits = [`${resp.ryo ?? 0} ryo`];
        if (resp.fateShards) bits.push(`${resp.fateShards} fate shard${resp.fateShards === 1 ? "" : "s"}`);
        if (resp.title) bits.push(`the title "${resp.title}"`);
        setTimeout(() => alert(`Reckoning complete: ${bits.join(", ")}.`), 40);
    }
    async function handleStoryReckoningAbandon(w: Wanderer) {
        if (!(await gameConfirm("Abandon this reckoning? Your progress and recovered keepsake will remain, but the active task will be cleared.", { danger: true, confirmLabel: "Abandon" }))) return;
        setWandererDialog({ w, busy: true });
        const resp = await abandonStoryReckoning(character.name);
        if (!resp.ok) {
            setWandererDialog({ w, msg: "The reckoning could not be abandoned. Try again." });
            return;
        }
        if (resp.character) { if (!onVersionedCharacter(resp.character, resp._saveVersion)) return; }
        else if (onServerVersion?.(resp._saveVersion) !== false) updateCharacter(prev => prev && prev.name === character.name ? ({ ...prev, activeStoryReckoning: null }) : prev);
        setWandererDialog({ w, msg: "The reckoning is released." });
    }
    // Tick once a second while a TIMED epic's journal is open so the countdown is live.
    const [, setEpicTick] = useState(0);
    useEffect(() => {
        const epic = character.activeQuestbook;
        if (!wandererDialog || !epic?.deadline) return;
        const t = setInterval(() => setEpicTick(n => (n + 1) % 1_000_000), 1000);
        return () => clearInterval(t);
    }, [wandererDialog, character.activeQuestbook?.deadline]);
    const [activePetEncounter, setActivePetEncounter] = useState<Pet | null>(null);
    // The single-use token /api/pet/encounter-start minted for the pet on screen.
    // Befriending spends it; the server owns the roll, the trait, and the roster
    // write, so nothing about this pet is real until that call succeeds.
    const petEncounterToken = useRef("");
    // Keep the external-explore receipt until the player explicitly Befriends
    // or Leaves. A refresh during the choice then restages the same sealed pet.
    const petEncounterExploreOperationId = useRef("");
    const [petBefriendPending, setPetBefriendPending] = useState(false);
    const [petVnDone, setPetVnDone] = useState(false);
    const [petVnPage, setPetVnPage] = useState(0);
    const [petVnLine, setPetVnLine] = useState(0);
    // Hard-lock the "Befriend / Leave" decision screen for a brief grace window
    // after it appears. Players who rapid-click through the encounter VN would
    // otherwise have a leftover/queued click land on "Leave" (it sits right under
    // where the VN's "Continue" button just was), silently discarding the pet
    // before they ever see the choice. Disarming the buttons for a moment forces
    // a fresh, deliberate click to keep or release the pet.
    const [petDecisionReady, setPetDecisionReady] = useState(false);
    useEffect(() => {
        if (!activePetEncounter || !petVnDone) { setPetDecisionReady(false); return; }
        setPetDecisionReady(false);
        const t = setTimeout(() => setPetDecisionReady(true), 650);
        return () => clearTimeout(t);
    }, [activePetEncounter, petVnDone]);
    // Reopening a sector after a fight restores the TILE too, not just the
    // board: "return to the sector" has to mean the spot you attacked from, and
    // this state is otherwise recreated at the centre on every remount (which
    // then broadcasts that centre tile to presence via the effect below, so
    // everyone else would see you teleport as well). presence-store keeps the
    // last tile at module scope, so it survives WorldMap's unmount during the
    // battle. Peek, never take — the mount effect above owns consuming the latch.
    const [sectorPlayerPos, setSectorPlayerPos] = useState(
        () => (peekSectorReopen() !== null ? getLocalSectorTile() : SECTOR_CENTRE_TILE),
    );
    const travelRequestInFlight = useRef(false);
    // Bridge the local player's tile to the presence store so the heartbeat (which
    // lives in App) can broadcast it; other clients render us walking to this tile.
    useEffect(() => {
        setLocalSectorTile(sectorPlayerPos);
        updateRealtimeTile(sectorPlayerPos);
    }, [sectorPlayerPos]);
    const [selectedCreatorEvent, setSelectedCreatorEvent] = useState<CreatorEvent | null>(null);
    // Anbu Vault Infiltration (anbuInfiltration.v1): the walk-up prompt on the
    // sector's vault structure, and the live raid screen (portaled full-screen).
    const [vaultPrompt, setVaultPrompt] = useState<{ sector: number; village: string } | null>(null);
    const [vaultRaid, setVaultRaid] = useState<{ sector: number; village: string } | null>(null);
    useEffect(() => {
        if (!anbuViewOpen) setVaultPrompt(null);
    }, [anbuViewOpen]);
    const [creatorEventPage, setCreatorEventPage] = useState(0);
    const [creatorEventLine, setCreatorEventLine] = useState(0);
    type ChestLoot = {
        xp: number;
        ryo?: number;
        itemId?: string;
        cardId?: string;
        fateShards?: number;
        boneCharms?: number;
        auraStones?: number;
        auraDust?: number;
    };
    const [activeChest, setActiveChest] = useState<ChestLoot | null>(null);
    const [chestVnPage, setChestVnPage] = useState(0);
    const [chestVnLine, setChestVnLine] = useState(0);
    const [chestVnDone, setChestVnDone] = useState(false);
    const locations = [
        // Crest positions sit ON each settlement in the 2026-07 keyart: the
        // pagoda cluster NW, the ice palace NE, the stilt harbour SW, the violet
        // palace SE, the great keep at the centre and the obelisk shrine east of
        // it. The painting carries no lettering — WorldPoiPlates draws the names
        // just below each crest (see components/WorldRoadsOverlay.tsx).
        { name: "Stormveil Village", type: "village", biome: "forest" as Biome, x: 16, y: 74, art: stormveilLandmarkArt },
        { name: "Ashen Leaf Village", type: "village", biome: "volcano" as Biome, x: 16, y: 20, art: ashenLeafLandmarkArt },
        { name: "Frostfang Village", type: "village", biome: "snow" as Biome, x: 76, y: 20, art: frostfangLandmarkArt },
        { name: "Moonshadow Village", type: "village", biome: "shadow" as Biome, x: 86, y: 64, art: moonshadowLandmarkArt },
        { name: "Central", type: "central", biome: "central" as Biome, x: 48, y: 40, art: centralLandmarkArt, staminaReward: 20, xpReward: 20 },
        // Hollow Gate — the violet obelisk shrine east of the keep. Sector 57
        // (Hollow Temple) sits just beside it and is map-travel-only, so this
        // crest is the way in.
        { name: "Hollow Gate", type: "hollowGate", biome: "shadow" as Biome, x: 63, y: 65, art: hollowGateLandmarkArt },
    ];
    const [selectedLandmark, setSelectedLandmark] = useState<(typeof locations)[number] | null>(null);
    const [hollowGateMenu, setHollowGateMenu] = useState(false);   // Enter / Attune choice
    const [showAttunement, setShowAttunement] = useState(false);   // Shrine Attunement panel
    // Mobile world-map pinch/drag zoom (worldMapZoom.v1). Inert on desktop / when
    // the flag is off — the map then renders via the legacy path unchanged.
    const wmZoom = useWorldMapZoom();
    // Marker layout (0–100 grid), hand-curated. Each village's nearby sectors
    // cluster around its banner; neutral sectors spread across the mid-map. A
    // sector's biome / encounters are fixed by its NUMBER (biomeForSector) — the
    // marker position is purely where the dot sits. Fixed POIs: central ring 56–60,
    // Hollow-Gate shrines 1/52, Death's Gate / PvP 99; the village / Central /
    // Hollow Gate landmarks live in `locations`, untouched. Coords were relaxed
    // (scripts/decollide capped ≤~5%) to de-overlap the mobile zoom overview; the
    // Fixed POIs above stayed pinned.
    // Atlas coordinates include presentation-only clearance nudges. Road lines,
    // route glows and ownership overlays consume the same projection, while
    // gameplay geography remains authoritative in shared/sector-links.ts.
    const sectorPoints = ATLAS_SECTOR_POINTS;
    const academySectorTargetId = useAcademyWorldMapFocus({ character, sectorPoints, zoomActive: wmZoom.active, focusPoint: wmZoom.focusPoint });
    // Village quick-jump targets for the mobile zoom HUD (worldMapZoom.v1). Each
    // chip flies the camera to the cluster centroid at a tappable zoom.
    // Region-block numbering (shared/sector-geo.ts): each village's home block,
    // the Castle City ring for Central, Death's Gate pinned.
    const WM_CLUSTERS: { label: string; ids: number[]; color: string; zoom: number }[] = [
        { label: "Frostfang", ids: [26, 27, 28, 29, 30, 31, 32, 33], color: villageAccent("Frostfang Village"), zoom: 2.6 },
        { label: "Moonshadow", ids: [17, 18, 19, 20, 21, 22, 23, 24, 25], color: villageAccent("Moonshadow Village"), zoom: 2.6 },
        { label: "Stormveil", ids: [1, 2, 3, 4, 5, 6, 7, 8], color: villageAccent("Stormveil Village"), zoom: 2.6 },
        { label: "Ashen Leaf", ids: [9, 10, 11, 12, 13, 14, 15, 16], color: villageAccent("Ashen Leaf Village"), zoom: 2.6 },
        { label: "Central", ids: [46, 47, 48, 49, 50, 51], color: "var(--slate-300)", zoom: 2.4 },
        { label: "Death's Gate", ids: [99], color: "var(--red-400)", zoom: 2.8 },
    ];

    // When the War Map is on, a sector owned by a village glows in that village's
    // accent colour (live owner from the territory cache, else its home village).
    const warMapOn = villageWarViewOpen && isVillageWarMapEnabled();
    // War-Map legibility: tint each owned sector's marker in its holder village's
    // accent (your own village ringed white) so the front line reads at a glance
    // instead of a field of identical yellow dots. Neutral / central (>=56) /
    // Death's Gate keep the default marker. Purely cosmetic — no gameplay state.
    // The shared daily pool is the one honest reason to prefer one sector over
    // another, and it was invisible on the overview: SECTOR_DEPLETED_MESSAGE told
    // players "other sectors are still rich" with no way to see which. The counts
    // for the WHOLE board already ride the world-state poll, so this is projection,
    // not a new request.
    // Territory owner ONLY — no home-village fallback. The owner village's pool
    // cap carries a +50% bonus, and the selected-sector plate and the explore
    // refusal both size their view from `loadSectorTerritory().ownerVillage`
    // alone. Falling back to the geographic home village here (which is what the
    // war-map TINT does) would give the overview a 50% larger cap than the panel
    // for every unclaimed home-block sector — so the marker would read "worked"
    // while the panel underneath it said "Picked clean".
    function sectorOwnerVillage(id: number): string | undefined {
        return loadSectorTerritory(id).ownerVillage;
    }
    function sectorRichnessTier(id: number): SectorRichness {
        if (!isWildSector(id)) return "unknown";
        return sectorRichnessOf(sectorPoolViewFor(id, sectorOwnerVillage(id), character.village));
    }

    function sectorMarkerStyle(id: number): CSSProperties {
        if (!warMapOn || id >= 56 || id === 99) return {};
        const owner = loadSectorTerritory(id).ownerVillage || homeVillageForSector(id);
        if (!owner) return {};
        const accent = villageAccent(owner);
        const mine = character.village === owner;
        return {
            background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,.6), transparent 46%), ${accent}`,
            borderColor: mine ? "#ffffff" : "rgba(2,6,23,.6)",
            color: "#ffffff",
            textShadow: "0 1px 2px rgba(0,0,0,.9)",
            boxShadow: mine
                ? `0 0 0 2px #ffffff, 0 0 9px ${accent}, 0 2px 4px rgba(0,0,0,.5)`
                : `0 0 0 1px rgba(2,6,23,.5), 0 0 7px ${accent}, 0 2px 4px rgba(0,0,0,.45)`,
        };
    }

    function biomeForSector(sector: number): Biome {
        // Table-driven from the shared geography registry (one source of truth
        // with the server's biomeForSettledSector).
        return biomeForWorldSector(sector);
    }

    // Sector adjacent to each home village (used for Outskirts)
    function villageOutskirtsSector(villageName: string): number {
        return villageOutskirtsSectorNumber(villageName);
    }

    function enterLandmark(location: typeof locations[number]) {
        setCurrentBiome(location.biome);
        setCurrentWeather(weatherForBiome(location.biome));
        // Hollow Gate is a forbidden shrine. Entry is gated by either the Kage's
        // village-wide unlock OR a Hollow Gate Key (handled inside the entry
        // function — it shows its own prompts for missing unlock / daily cap).
        if (location.type === "hollowGate") {
            setHollowGateMenu(true);   // choose: enter the shrine, or attune (spend shards)
            return;
        }
        // Enemy village ? territory exploration page; own village & Central ? normal landmark
        if (location.type === "village" && location.name !== character.village) {
            setSelectedVillageTerritory(location);
        } else {
            setSelectedLandmark(location);
        }
    }
    // Warm the destination's assets DURING the 3s travel window so arrival paints
    // instantly instead of flashing an unloaded scene. Purely best-effort browser
    // cache / lazy-chunk warming — no server writes, no state changes, no side
    // effects — so it can never alter the arrival: if any of it fails or is slow,
    // the normal on-arrival load path runs exactly as before. Reuses the same image
    // resolvers the arrival render uses, so the warmed URL can never drift from the
    // one actually painted. The destination is locked for the whole window (the
    // isTraveling guard blocks re-entry), so this warms exactly one target.
    function preloadImg(src: string | undefined) {
        if (!src) return;
        try {
            const img = new Image();
            img.src = src;
        } catch {
            /* best-effort: a failed preload just means arrival loads it normally */
        }
    }
    function prefetchTravelDestination(sector: number) {
        // The festival sector leaves the world map for the Sunscar Festival screen —
        // warm its lazy chunk (not the sector scene, which isn't shown on that arrival).
        if (sector === FESTIVAL_SECTOR) {
            void import("./SunscarFestival").catch(() => {});
            return;
        }
        // Every other sector opens its scene panel on arrival: warm the exact
        // background + depth image (and, when the flag is on, the top-down map) it
        // will paint. Only the floor is warmed — the vista stack no longer renders
        // for a normal sector, so its art would be a wasted fetch.
        preloadImg(sectorMapUrl(biomeForSector(sector), sector));
    }
    function beginSectorTravel(
        sector: number,
        arrive: (arrivalTile?: number) => void,
        request?: { mode: "edge"; originSector: number; originTile: number; exitId: string },
    ) {
        if (isTraveling || travelRequestInFlight.current) return;
        if (currentSector === sector) {
            arrive();
            return;
        }
        prefetchTravelDestination(sector); // warm the destination during the 3s window
        travelRequestInFlight.current = true;
        void (async () => {
            try {
                const response = await fetch('/api/player/travel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ destinationSector: sector, ...request }),
                    signal: AbortSignal.timeout(12_000),
                });
                const data = await response.json().catch(() => null) as { arrivalAt?: number; travelMs?: number; arrivalTile?: number; error?: string } | null;
                if (!response.ok || !data?.arrivalAt) {
                    setTravelToast({
                        id: Date.now(),
                        kicker: 'Road blocked',
                        text: data?.error || 'Could not start travel. Please try again.',
                    });
                    return;
                }
                // Mask on the server's DURATION, rebased onto our clock — never on
                // `data.arrivalAt - Date.now()`, which spans both machines' clocks and
                // turns their drift into the timer (see lib/travel-mask). The server
                // keeps its own absolute arrivalAt for the lease and attackability.
                const travelMs = travelMaskMs(data.travelMs);
                if (travelMs <= 0) {
                    // Instant edge crossing: no mask at all — the board's
                    // directional slide-in is the whole transition.
                    setSelectedVillageTerritory(null);
                    arrive(data.arrivalTile);
                    return;
                }
                const arrivalAt = Date.now() + travelMs;
                setPendingTravel({ destinationSector: sector, arrivalAt });
                setTravelingUntil(arrivalAt);
                // Keep the walking route glowing toward the destination for the
                // whole transit (mobile has no hover — this is its route view).
                setRouteHoverSector(sector);
                setSelectedSector(null);
                setSelectedVillageTerritory(null);
                window.setTimeout(() => {
                    arrive(data.arrivalTile);
                    setPendingTravel(null);
                    setTravelingUntil(0);
                    setRouteHoverSector(null);
                }, travelMs);
            } catch {
                setTravelToast({
                    id: Date.now(),
                    kicker: 'Travel unavailable',
                    text: 'Could not reach the travel server. Please try again.',
                });
            } finally {
                travelRequestInFlight.current = false;
            }
        })();
    }
    function triggerTravelPoint(sector: number) {
        // Where you stood in the sector you LEFT, captured before any state moves.
        const originSector = currentSector;
        beginSectorTravel(sector, (arrivalTile) => {
        if (sector === FESTIVAL_SECTOR) {
            setCurrentBiome("volcano");
            setCurrentWeather(weatherForSector(sector, "volcano"));
            setCurrentSector(sector);
            setScreen("sunscarFestival");
            return;
        }

        const biome = biomeForSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(sector, biome));
        setCurrentSector(sector);
        setSelectedSector(sector);
        // Put the player somewhere that makes sense in the sector they are
        // ENTERING. Travelling used to leave the tile untouched, so you kept the
        // coordinates you happened to be standing on: leave by the right-hand
        // edge and you arrived on the RIGHT of the next sector instead of the
        // left, leave from the top and you arrived at the top. That made every
        // trip read as a teleport rather than as travelling a direction.
        // Along a road, arrive on the edge facing the sector you came from —
        // identical to walking through that gate. With no road, derive that same
        // edge from the two sectors' map positions, so EVERY arrival comes in
        // from the side you travelled from; only a trip with no origin at all
        // (a fresh boot, a village spawn) still starts in the middle.
        // The SERVER seals this tile from the SAME shared definition, and it is
        // what everyone else in the destination sees; ours is the fallback for a
        // response that carries none.
        const arrival = (Number.isInteger(arrivalTile) ? arrivalTile : undefined)
            ?? (originSector == null ? null : travelArrivalTile(originSector, sector));
        setSectorPlayerPos(arrival ?? SECTOR_CENTRE_TILE);
        const splashLabel = regionSplashLabelFor(sector);
        if (splashLabel) setRegionSplash({ label: splashLabel, tint: regionTintForSector(sector), stamp: Date.now() });
        });
    }

    function crossSectorExit(exit: SectorExit) {
        if (!sameSector(currentSector, exit.sector)) return;
        setSectorPlayerPos(exit.tile);
        beginSectorTravel(exit.destinationSector, (arrivalTile) => {
            const destinationTile = Number.isInteger(arrivalTile) ? Number(arrivalTile) : exit.destinationTile;
            const destinationBiome = biomeForSector(exit.destinationSector);
            // Appear on the side you came in through, and STOP. Crossing north
            // lands you on the destination's SOUTH edge, which is what makes the
            // move read as travelling a direction; every step after that is the
            // player's. ⚖ An animated per-tile walk-in used to run here and was
            // removed — see WALK_IN_DEPTH in shared/sector-links.ts for why.
            setSectorPlayerPos(destinationTile);
            setCurrentBiome(destinationBiome);
            setCurrentWeather(weatherForSector(exit.destinationSector, destinationBiome));
            setCurrentSector(exit.destinationSector);
            setSelectedSector(exit.destinationSector);
            setSectorEnterDir(exit.direction);
            const splashLabel = regionSplashLabelFor(exit.destinationSector);
            if (splashLabel) setRegionSplash({ label: splashLabel, tint: regionTintForSector(exit.destinationSector), stamp: Date.now() });
        }, {
            mode: "edge",
            originSector: exit.sector,
            originTile: exit.tile,
            exitId: exit.id,
        });
    }

    // ── WASD / E keyboard controls inside a sector tile view ─────────────────────
    // W/A/S/D moves one tile in that direction on the 12-wide sector grid.
    // E explores the open sector.
    // Only active while a sector panel is open and focus is not in a text field.
    const SECTOR_GRID_W = 12;
    const SECTOR_GRID_SIZE = 144;
    useEffect(() => {
        if (!selectedSector || !sameSector(currentSector, selectedSector)) return;
        const activeSector = selectedSector;
        function handleKey(e: KeyboardEvent) {
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            const key = e.key.toLowerCase();
            if (key === 'e') {
                e.preventDefault();
                void exploreSector(activeSector);
                return;
            }
            if (!['w', 'a', 's', 'd'].includes(key)) return;
            e.preventDefault();
            const outwardDirection = key === 'w' ? 'north' : key === 'd' ? 'east' : key === 's' ? 'south' : 'west';
            const roadExit = roadExitsForSector(activeSector).find((exit) =>
                exit.tile === sectorPlayerPos && exit.direction === outwardDirection,
            );
            if (roadExit && sameSector(currentSector, activeSector)) {
                crossSectorExit(roadExit);
                return;
            }
            setSectorPlayerPos(prev => {
                const col = prev % SECTOR_GRID_W;
                const row = Math.floor(prev / SECTOR_GRID_W);
                if (key === 'w' && row > 0)                          return prev - SECTOR_GRID_W;
                if (key === 's' && row < (SECTOR_GRID_SIZE / SECTOR_GRID_W) - 1) return prev + SECTOR_GRID_W;
                if (key === 'a' && col > 0)                          return prev - 1;
                if (key === 'd' && col < SECTOR_GRID_W - 1)          return prev + 1;
                return prev;
            });
        }
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [selectedSector, sectorPlayerPos, currentSector, isTraveling]);

    // Clear the edge-crossing slide class right after its animation plays.
    useEffect(() => {
        if (!sectorEnterDir) return;
        const timer = window.setTimeout(() => setSectorEnterDir(null), 460);
        return () => window.clearTimeout(timer);
    }, [sectorEnterDir]);

    // Warm every adjacent sector's art while the player stands here, so an
    // INSTANT edge crossing lands on already-loaded floors (there is no travel
    // mask left to hide a fetch behind).
    useEffect(() => {
        if (!selectedSector || selectedSector === FESTIVAL_SECTOR) return;
        for (const exit of roadExitsForSector(selectedSector)) {
            // The floor is the only art an instant crossing lands on now that the
            // vista stack is retired for normal sectors, so warming it is enough —
            // and it keeps the per-step cost small on low-end mobile too.
            preloadImg(sectorMapUrl(biomeForSector(exit.destinationSector), exit.destinationSector));
        }
        // preload helpers are stable component-scope declarations; re-running on
        // their identities would just repeat cached no-op preloads.
    }, [selectedSector]);

    // rollAncientChest lived here. The Ancient Chest table is now rolled by
    // api/world/_chest.ts (rollAncientChestLoot) under the same probabilities
    // and the same card/gear pools — the client copy could only produce loot
    // the save sanitizer refused to keep.

    // The chest was rolled and banked by /api/world/open-chest the moment it was
    // found (see the explore branch), so this only dismisses the reveal. It used
    // to credit the loot locally, which the save sanitizer then threw away.
    function claimChest() {
        setActiveChest(null);
        setChestVnDone(false);
        setChestVnPage(0);
        setChestVnLine(0);
    }

    // Bank the explored tile server-side. `totalTilesExplored` has a per-save
    // delta of zero in the sanitizer and /api/world/explore is its only writer,
    // so counting the tile locally never actually counted it — which is what
    // held the genin/chunin exam gates (50 / 100 tiles) permanently shut.
    //
    // 'full' also pays the explore ryo, and only the no-outcome branch passes
    // it: a tile that turned up a chest, a pet, the dungeon, or an ambush has
    // always counted toward the total without paying the ryo line on top.
    // Returns false when the server refused, so the caller shows nothing rather
    // than an outcome the save is about to discard.
    type SettledExplore = {
        operation: PendingWorldRewardOperation;
        outcome?: SectorExploreOutcome;
        reward?: { sector: number; xp: number; ryo: number };
    };

    async function settleExplore(
        sector: number,
        options: {
            credit?: ExploreCredit;
            resolveOutcome?: boolean;
            externalOutcomeProof?: ExternalExploreProof;
            petEncounter?: Pet;
            operationId?: string;
        },
    ): Promise<SettledExplore | null> {
        const operation = options.externalOutcomeProof
            ? beginExternalWorldExplore(character.name, sector, options.externalOutcomeProof, options.petEncounter, undefined, options.operationId)
            : beginResolvedWorldExplore(character.name, sector, undefined, options.operationId);
        const settled = await recordSectorExplore(
            character.name,
            sector,
            options.credit ?? "tile",
            operation.id,
            {
                resolveOutcome: options.resolveOutcome === true,
                ...(options.externalOutcomeProof ? { externalOutcomeProof: options.externalOutcomeProof } : {}),
            },
        );
        if (!settled.character) {
            if (settled.retryable === false) {
                completeWorldRewardOperation(character.name, operation.id);
            }
            if (settled.error === "sector-depleted") { gameToast(SECTOR_DEPLETED_MESSAGE, { kind: "info" }); return null; }
            alert(settled.error === "daily-limit"
                ? "Daily tile exploration limit reached (150/150). Resets at midnight UTC."
                : settled.retryable === false
                    ? "That expired discovery was safely retired. Explore the sector again to make a new attempt."
                : "The sector could not be explored right now. Try again in a moment.");
            return null;
        }
        // Replay responses contain the already-paid balance. Adopt the full
        // versioned snapshot; adding the reward again would double it in the UI.
        if (!onVersionedCharacter(settled.character, settled.saveVersion)) return null;
        // The same stable receipt proves field-mission progress. Keep the
        // operation parked until every matching mission explicitly ACKs
        // `recorded:true`; a dropped 200 response then replays one evidence id.
        if (!(await recordMissionExplore(sector, operation.id, settled.fieldProgress))) {
            alert("The tile is safely recorded, but its mission receipt is still syncing. Reopen the map to recover it before exploring again.");
            return null;
        }
        return { operation, outcome: settled.outcome, reward: settled.reward };
    }

    function stageRecoveredPet(operation: PendingWorldRewardOperation): boolean {
        const proof = operation.externalOutcomeProof;
        if (proof?.kind !== "pet" || !operation.petEncounter) return false;
        petEncounterToken.current = proof.token;
        petEncounterExploreOperationId.current = operation.id;
        setPetBefriendPending(false);
        setActivePetEncounter(operation.petEncounter);
        setPetVnDone(false);
        setPetVnPage(0);
        setPetVnLine(0);
        return true;
    }

    async function settleDiscoveredChest(operation: PendingWorldRewardOperation): Promise<"settled" | "retryable" | "terminal"> {
        const worldExploreRequestId = operation.kind === "chest"
            ? operation.worldExploreRequestId
            : operation.id;
        if (!worldExploreRequestId) return "terminal";
        const chestOperation = operation.kind === "chest"
            ? operation
            : beginWorldChestOperation(character.name, operation.sector, worldExploreRequestId);
        const chest = await openAncientChest(
            character.name,
            operation.sector,
            chestOperation.id,
            worldExploreRequestId,
        );
        if (!chest.loot || !chest.character) {
            if (chest.error === "sector-depleted") gameToast(SECTOR_DEPLETED_MESSAGE, { kind: "info" });
            if (chest.retryable === false) {
                completeWorldRewardOperation(character.name, chestOperation.id);
                completeWorldRewardOperation(character.name, worldExploreRequestId);
                return "terminal";
            }
            return "retryable";
        }
        if (!onVersionedCharacter(chest.character, chest.saveVersion)) return "retryable";
        completeWorldRewardOperation(character.name, chestOperation.id);
        completeWorldRewardOperation(character.name, worldExploreRequestId);
        setActiveChest(chest.loot);
        setChestVnPage(0);
        setChestVnLine(0);
        setChestVnDone(false);
        return "settled";
    }

    function launchResolvedExploreBattle(sector: number, worldExploreRequestId: string): boolean {
        setSectorReopen(isWildSector(sector) ? sector : null);
        return requestAiFight({
            // The server ignores this suggestion and derives the closest-level
            // non-boss opponent from the exact exploration receipt.
            opponentId: "server-explore-opponent",
            opponentLevel: character.level,
            battleKind: "explore",
            opponentName: "Wild Challenger",
            sector,
            worldExploreRequestId,
        });
    }

    async function recoverResolvedPetOperation(
        operation: PendingWorldRewardOperation,
        encounter: Extract<Awaited<ReturnType<typeof startWildPetEncounter>>, { kind: "resolved" }>,
    ): Promise<boolean> {
        if (encounter.requestId !== operation.id) completeWorldRewardOperation(character.name, operation.id);
        focusDiscoverySector(encounter.sector);
        if (encounter.resolution !== "explored-miss") {
            completeWorldRewardOperation(character.name, encounter.requestId);
            return true;
        }
        const rebound = beginResolvedWorldExplore(character.name, encounter.sector, undefined, encounter.requestId);
        const explored = await settleExplore(rebound.sector, { resolveOutcome: true, operationId: rebound.id });
        if (!explored) return false;
        return (await finishResolvedExplore(explored, false)) !== "blocked";
    }

    async function recoverPendingExternalDiscovery(
        operation: PendingWorldRewardOperation,
        source: "pet" | "dungeon",
    ): Promise<boolean> {
        let rebound: PendingWorldRewardOperation;
        if (source === "pet") {
            const encounter = await startWildPetEncounter(character.name, operation.sector, operation.id);
            if (encounter.kind === "resolved") return recoverResolvedPetOperation(operation, encounter);
            if (encounter.kind === "miss") {
                if (encounter.requestId !== operation.id) completeWorldRewardOperation(character.name, operation.id);
                focusDiscoverySector(encounter.sector);
                const miss = beginResolvedWorldExplore(character.name, encounter.sector, undefined, encounter.requestId);
                const explored = await settleExplore(miss.sector, { resolveOutcome: true, operationId: miss.id });
                return !!explored && (await finishResolvedExplore(explored, false)) !== "blocked";
            }
            if (encounter.kind !== "hit") return false;
            const requestId = encounter.worldExploreRequestId ?? encounter.requestId;
            if (requestId !== operation.id) completeWorldRewardOperation(character.name, operation.id);
            rebound = beginExternalWorldExplore(
                character.name,
                encounter.sector,
                { kind: "pet", token: encounter.token },
                encounter.pet,
                undefined,
                requestId,
            );
        } else {
            let probe;
            try {
                probe = await probeFreeDungeonServer(character.name, operation.sector, operation.id);
            } catch (error) {
                if (error instanceof DungeonProbeError && !error.retryable) {
                    completeWorldRewardOperation(character.name, operation.id);
                    return true;
                }
                return false;
            }
            if (!onVersionedCharacter(probe.character, probe._saveVersion)) return false;
            if (probe.resolved) {
                completeWorldRewardOperation(character.name, operation.id);
                completeWorldRewardOperation(character.name, probe.requestId);
                return true;
            }
            if (!probe.found) {
                if (probe.requestId !== operation.id) completeWorldRewardOperation(character.name, operation.id);
                const next = beginWorldDiscoveryOperation(character.name, probe.sector, "pet", undefined, probe.requestId);
                return (await continueWorldDiscovery(next, false)) !== "blocked";
            }
            if (!probe.token) return false;
            const requestId = probe.worldExploreRequestId ?? probe.requestId;
            if (requestId !== operation.id) completeWorldRewardOperation(character.name, operation.id);
            rebound = beginExternalWorldExplore(
                character.name,
                probe.sector,
                { kind: "dungeon", token: probe.token },
                undefined,
                undefined,
                requestId,
            );
        }
        const result = await recordSectorExplore(
            character.name,
            rebound.sector,
            "tile",
            rebound.id,
            { externalOutcomeProof: rebound.externalOutcomeProof },
        );
        if (!result.character || !onVersionedCharacter(result.character, result.saveVersion)) {
            if (result.retryable === false) completeWorldRewardOperation(character.name, rebound.id);
            return false;
        }
        if (!(await recordMissionExplore(rebound.sector, rebound.id, result.fieldProgress))) return false;
        if (source === "pet") return stageRecoveredPet(rebound);
        if (rebound.externalOutcomeProof?.kind !== "dungeon") return false;
        onDungeonFound(rebound.externalOutcomeProof.token);
        completeWorldRewardOperation(character.name, rebound.id);
        return true;
    }

    async function recoverPendingWorldRewards(interactive = false): Promise<"none" | "recovered" | "blocked"> {
        const pending = readPendingWorldRewards(character.name);
        if (pending.length === 0) return "none";
        let blocked = false;
        let recovered = false;
        let retired = false;
        for (const operation of pending) {
            if (!readPendingWorldRewards(character.name).some((current) => current.id === operation.id)) continue;
            if (operation.kind === "explore") {
                if (operation.discoveryStage) {
                    const discovery = await continueWorldDiscovery(operation);
                    if (discovery === "recovered") {
                        recovered = true;
                        break;
                    }
                    if (discovery === "retired") retired = true;
                    else blocked = true;
                    continue;
                }
                const result = await recordSectorExplore(
                    character.name,
                    operation.sector,
                    operation.credit ?? "tile",
                    operation.id,
                    {
                        resolveOutcome: operation.resolveOutcome === true || !operation.externalOutcomeProof,
                        ...(operation.externalOutcomeProof ? { externalOutcomeProof: operation.externalOutcomeProof } : {}),
                    },
                );
                if (!result.character) {
                    if (result.error === "pending-pet-discovery" || result.error === "pending-dungeon-discovery") {
                        const source = result.error === "pending-pet-discovery" ? "pet" : "dungeon";
                        if (await recoverPendingExternalDiscovery(operation, source)) {
                            recovered = true;
                            break;
                        }
                    }
                    if (result.retryable === false) {
                        completeWorldRewardOperation(character.name, operation.id);
                        retired = true;
                    } else {
                        blocked = true;
                    }
                    continue;
                }
                if (!onVersionedCharacter(result.character, result.saveVersion)) { blocked = true; continue; }
                if (await recordMissionExplore(operation.sector, operation.id, result.fieldProgress)) {
                    if (result.outcome?.kind === "chest") {
                        const chestState = await settleDiscoveredChest(operation);
                        if (chestState === "settled") recovered = true;
                        else if (chestState === "terminal") retired = true;
                        else blocked = true;
                    } else if (result.outcome?.kind === "battle") {
                        if (launchResolvedExploreBattle(operation.sector, operation.id)) {
                            recovered = true;
                            // AiFightHost clears the operation only after start
                            // ACK (or active-session resume), closing the crash gap.
                            break;
                        }
                        blocked = true;
                    } else if (result.outcome?.kind === "external" && result.outcome.source === "dungeon"
                        && operation.externalOutcomeProof?.kind === "dungeon") {
                        onDungeonFound(operation.externalOutcomeProof.token);
                        completeWorldRewardOperation(character.name, operation.id);
                        recovered = true;
                        break;
                    } else if (result.outcome?.kind === "external" && result.outcome.source === "pet") {
                        // Never surface a cached token directly. The request receipt
                        // can reconstruct an expired active pointer, or report that
                        // the choice already resolved on another device.
                        if (await recoverPendingExternalDiscovery(operation, "pet")) recovered = true;
                        else blocked = true;
                        break;
                    } else {
                        completeWorldRewardOperation(character.name, operation.id);
                        recovered = true;
                    }
                } else {
                    blocked = true;
                }
                continue;
            }
            const chestState = await settleDiscoveredChest(operation);
            if (chestState === "settled") recovered = true;
            else if (chestState === "terminal") retired = true;
            else blocked = true;
        }
        if (interactive && blocked) {
            alert("A previous World reward is still waiting for the server. It will retry with the same receipt when you reopen the map or reconnect.");
        } else if (interactive && recovered) {
            alert("Your previous World reward was recovered from its server receipt. Explore again when you're ready.");
        } else if (interactive && retired) {
            alert("An expired World discovery was safely cleared. You can explore again now.");
        }
        return blocked ? "blocked" : (recovered || retired) ? "recovered" : "none";
    }

    useEffect(() => {
        const activeDungeon = character.activeDungeonRun && typeof character.activeDungeonRun === "object"
            ? character.activeDungeonRun as Record<string, unknown>
            : null;
        const dungeonToken = typeof activeDungeon?.token === "string" ? activeDungeon.token : "";
        const dungeonSector = Math.floor(Number(activeDungeon?.sector));
        const boundExploreId = typeof activeDungeon?.exploreReceiptId === "string"
            ? activeDungeon.exploreReceiptId
            : undefined;
        if (activeDungeon?.entry === "free" && dungeonToken && isWildSector(dungeonSector)) {
            beginExternalWorldExplore(
                character.name,
                dungeonSector,
                { kind: "dungeon", token: dungeonToken },
                undefined,
                undefined,
                boundExploreId,
            );
        }
        void recoverPendingWorldRewards(false);
    }, [character.name]);

    // Async because the tile, the wild-pet roll, and the chest are all settled
    // server-side. The in-flight guard stops a double-click from burning two
    // tiles against the daily cap while those calls are out.
    const exploreInFlight = useRef(false);
    async function exploreSector(sector: number) {
        if (exploreInFlight.current) return;
        exploreInFlight.current = true;
        const recovered = await recoverPendingWorldRewards(true);
        if (recovered !== "none") {
            exploreInFlight.current = false;
            return;
        }
        const dailyTiles = character.dailyTilesExplored ?? 0;
        if (dailyTiles >= 150) {
            alert("Daily tile exploration limit reached (150/150). Resets at midnight UTC.");
            exploreInFlight.current = false;
            return;
        }
        const depleted = sectorExploreRefusal(sector, loadSectorTerritory(sector).ownerVillage, character.village);
        if (depleted) {
            gameToast(depleted, { kind: "info" });
            exploreInFlight.current = false;
            return;
        }
        const biome = biomeForSector(sector);
        setSelectedVillageTerritory(null);
        setSelectedSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(sector, biome));
        setCurrentSector(sector);
        try {
            await resolveExplore(sector);
        } finally {
            exploreInFlight.current = false;
        }
    }

    function focusDiscoverySector(sector: number) {
        const discoveryBiome = biomeForSector(sector);
        setSelectedSector(sector);
        setCurrentSector(sector);
        setCurrentBiome(discoveryBiome);
        setCurrentWeather(weatherForSector(sector, discoveryBiome));
    }

    async function finishResolvedExplore(
        explored: SettledExplore,
        interactive: boolean,
    ): Promise<"recovered" | "blocked" | "retired"> {
        if (explored.outcome?.kind === "chest") {
            const chestState = await settleDiscoveredChest(explored.operation);
            if (interactive && chestState === "retryable") {
                alert("Your discovered chest is still syncing. Reopen the map to recover it from the same receipt.");
            } else if (interactive && chestState === "terminal") {
                alert("That chest discovery expired without a payout and was safely cleared. Explore again to make a new attempt.");
            }
            return chestState === "settled" ? "recovered" : chestState === "terminal" ? "retired" : "blocked";
        }
        if (explored.outcome?.kind === "battle") {
            if (launchResolvedExploreBattle(explored.operation.sector, explored.operation.id)) return "recovered";
            if (interactive) alert("The combat host is unavailable. Reopen the map to resume this sealed encounter.");
            return "blocked";
        }
        completeWorldRewardOperation(character.name, explored.operation.id);
        if (interactive) {
            alert(`Sector ${explored.operation.sector} explored. +${Number(explored.reward?.ryo ?? 0)} ryo.`);
        }
        return "recovered";
    }

    async function continueWorldDiscovery(
        initial: PendingWorldRewardOperation,
        interactive = false,
    ): Promise<"recovered" | "blocked" | "retired"> {
        let operation = initial;
        if (operation.discoveryStage === "dungeon") {
            try {
                const probe = await probeFreeDungeonServer(character.name, operation.sector, operation.id);
                if (!onVersionedCharacter(probe.character, probe._saveVersion)) return "blocked";
                if (probe.resolved) {
                    completeWorldRewardOperation(character.name, operation.id);
                    completeWorldRewardOperation(character.name, probe.requestId);
                    return "recovered";
                }
                if (probe.found && probe.token) {
                    const authoritativeId = probe.worldExploreRequestId ?? probe.requestId;
                    if (authoritativeId !== operation.id) completeWorldRewardOperation(character.name, operation.id);
                    focusDiscoverySector(probe.sector);
                    const explored = await settleExplore(probe.sector, {
                        credit: "tile",
                        externalOutcomeProof: { kind: "dungeon", token: probe.token },
                        operationId: authoritativeId,
                    });
                    if (!explored) return "blocked";
                    onDungeonFound(probe.token);
                    completeWorldRewardOperation(character.name, explored.operation.id);
                    return "recovered";
                }
                if (probe.requestId !== operation.id) completeWorldRewardOperation(character.name, operation.id);
                operation = beginWorldDiscoveryOperation(
                    character.name,
                    probe.sector,
                    "pet",
                    undefined,
                    probe.requestId,
                );
            } catch (error) {
                if (error instanceof DungeonProbeError && !error.retryable) {
                    completeWorldRewardOperation(character.name, operation.id);
                    if (interactive) alert("That dungeon discovery could not commit and was safely retired. Explore again to make a new attempt.");
                    return "retired";
                }
                if (interactive) alert("The hidden-dungeon search is still syncing. Try this exploration again to recover its sealed result.");
                return "blocked";
            }
        }

        if (operation.discoveryStage === "pet") {
            const petEncounter = await startWildPetEncounter(character.name, operation.sector, operation.id);
            if (petEncounter.kind === "blocked") {
                if (!petEncounter.retryable) completeWorldRewardOperation(character.name, operation.id);
                if (interactive) alert("The wild-pet search is still syncing. Try this exploration again to recover its sealed result.");
                return petEncounter.retryable ? "blocked" : "retired";
            }
            if (petEncounter.kind === "resolved") {
                return (await recoverResolvedPetOperation(operation, petEncounter)) ? "recovered" : "blocked";
            }
            if (petEncounter.kind === "hit") {
                const authoritativeId = petEncounter.worldExploreRequestId ?? petEncounter.requestId;
                if (authoritativeId !== operation.id) completeWorldRewardOperation(character.name, operation.id);
                focusDiscoverySector(petEncounter.sector);
                const explored = await settleExplore(petEncounter.sector, {
                    credit: "tile",
                    externalOutcomeProof: { kind: "pet", token: petEncounter.token },
                    petEncounter: petEncounter.pet,
                    operationId: authoritativeId,
                });
                if (!explored) return "blocked";
                petEncounterToken.current = petEncounter.token;
                petEncounterExploreOperationId.current = explored.operation.id;
                setPetBefriendPending(false);
                setActivePetEncounter(petEncounter.pet);
                setPetVnDone(false);
                setPetVnPage(0);
                setPetVnLine(0);
                return "recovered";
            }
            if (petEncounter.requestId !== operation.id) completeWorldRewardOperation(character.name, operation.id);
            operation = beginResolvedWorldExplore(character.name, petEncounter.sector, undefined, petEncounter.requestId);
        }

        const explored = await settleExplore(operation.sector, {
            resolveOutcome: true,
            operationId: operation.id,
        });
        if (!explored) return "blocked";
        return finishResolvedExplore(explored, interactive);
    }

    async function resolveExplore(sector: number) {
        // Park before the first discovery probe. The same id advances through
        // dungeon → pet → server-rolled tile outcome, so a lost miss or hit ACK
        // resumes the exact stage instead of spending another daily attempt.
        const operation = beginWorldDiscoveryOperation(
            character.name,
            sector,
            character.level >= hiddenDungeonVnEvent.levelReq ? "dungeon" : "pet",
        );
        await continueWorldDiscovery(operation, true);
    }
    async function huntSector(sector: number) {
        if (!isWildSector(sector)) {
            alert(`Hunting is only available in Sectors 1-${MAX_WILD_SECTOR}.`);
            return;
        }

        const biome = biomeForSector(sector);
        setSelectedVillageTerritory(null);
        setSelectedSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(sector, biome));
        setCurrentSector(sector);

        const activeTrail = huntTrailForSector(sector);
        if (!activeTrail) {
            setHuntToast({
                id: Date.now(),
                kicker: "No active trail",
                text: `No accepted hunt trail is active in Sector ${sector}. Check the paw marker on the world map for your current lead.`,
            });
            return;
        }
        const activeHuntMission = activeTrail.mission;

        const huntAi = playableAis.find((ai) => ai.id === activeHuntMission.aiProfileId);
        if (!huntAi) {
            alert("Beast AI not found.");
            return;
        }

        // Reconcile the durable trail before showing a sign or launching combat.
        // This also recovers a pack decision after refresh/loss without trusting a
        // client quality roll or an old missionProgress render.
        const authoritative = await postWorldHunt({
            playerName: character.name,
            action: "state",
            missionId: activeHuntMission.id,
        });
        if (!authoritative.ok || !authoritative.state) {
            if (authoritative.acceptedMissionIds) setAcceptedMissionIds(authoritative.acceptedMissionIds);
            adoptHuntProgressMirror(activeHuntMission.id, authoritative.state, authoritative.missionProgress);
            setHuntToast({
                id: Date.now(),
                kicker: "Trail unavailable",
                text: authoritative.error ?? "The Guild no longer has an active trail for this contract.",
            });
            return;
        }
        if (authoritative.character) {
            if (!onVersionedCharacter(authoritative.character, authoritative._saveVersion)) return;
        } else if (onServerVersion?.(authoritative._saveVersion) === false) {
            return;
        }
        if (authoritative.acceptedMissionIds) setAcceptedMissionIds(authoritative.acceptedMissionIds);
        adoptHuntProgressMirror(activeHuntMission.id, authoritative.state, authoritative.missionProgress);
        const trailState = authoritative.state;
        setAuthoritativeHuntStates((current) => ({ ...current, [activeHuntMission.id]: trailState }));
        if (authoritative.migrated) {
            setHuntToast({
                id: Date.now(),
                kicker: "Trail recalibrated",
                text: `The Guild moved this older contract onto its verified ledger. Your fresh lead is in Sector ${trailState.sector}.`,
            });
        }
        if (trailState.claimable || trailState.targetDefeated) {
            setHuntToast({
                id: Date.now(),
                kicker: "Contract complete",
                text: `${huntAi.name} is already logged as defeated. Return to the Hunter Guild and turn in the contract.`,
            });
            return;
        }
        if (trailState.sector !== sector) {
            setHuntToast({
                id: Date.now(),
                kicker: "The lead moved",
                text: `The Guild's current trail is in Sector ${trailState.sector}. Follow the paw marker there.`,
            });
            return;
        }
        const reconciledTrail: ActiveHuntTrail = {
            mission: activeHuntMission,
            sector: trailState.sector,
            progress: trailState.progress,
            requiredTracks: trailState.requiredTracks,
        };
        if (trailState.packPending && !trailState.packSettled && trailState.decisionId) {
            launchHuntPackStage(activeHuntMission, huntAi, 0, sector, undefined, trailState.decisionId);
            return;
        }

        // Both branches now open the encounter card instead of acting immediately.
        // Tracking used to advance a counter and silently teleport the player, and
        // the final track cut straight to the Arena behind a toast — no read, no
        // reason, and the beast's portrait never left the contract board.
        if (!huntReadyForFight(activeHuntMission, reconciledTrail.progress)) {
            setHuntEncounter({
                trail: reconciledTrail,
                ai: huntAi,
                sector,
                view: { kind: "track", sign: trailState.sign ?? huntSignFor(activeHuntMission, reconciledTrail.progress, playerSlug(character.name)) },
            });
            return;
        }
        setHuntEncounter({
            trail: reconciledTrail,
            ai: huntAi,
            sector,
            // The server owns the real opening and rebuilds it at combat start.
            // This neutral preview discloses no client-authoritative difficulty.
            view: { kind: "confront", opening: huntOpeningFor(0, huntAi.name) },
        });
    }

    /**
     * Commit one tracking decision. Quality moves first (it is what the choice
     * BOUGHT, and it must stick even when the pack then springs), then the ambush
     * roll, then the trail advance.
     */
    async function resolveHuntChoice(encounter: HuntEncounterState, choice: HuntChoice) {
        const { trail, ai, sector } = encounter;
        const mission = trail.mission;
        setHuntEncounter(null);

        const decision = await postWorldHunt({
            playerName: character.name,
            action: "choose",
            missionId: mission.id,
            sector,
            choiceId: choice.id,
        });
        if (!decision.ok) {
            alert(decision.error ?? "The trail could not be recorded. Try that sign again.");
            return;
        }
        if (decision.character && !onVersionedCharacter(decision.character, decision._saveVersion)) return;
        else if (!decision.character && onServerVersion?.(decision._saveVersion) === false) return;
        const nextProgress = decision.progress ?? trail.progress;
        setMissionProgress((current) => ({ ...current, [mission.id]: Math.max(current[mission.id] ?? 0, nextProgress) }));
        if (decision.state) setAuthoritativeHuntStates((current) => ({ ...current, [mission.id]: decision.state! }));

        // An idempotent choose retry may echo the original ambush after that pack
        // already settled. Only the authoritative live pending flag may relaunch it.
        if (decision.ambush && decision.decisionId && decision.state?.packPending && !decision.state.packSettled) {
            setHuntToast({
                id: Date.now(),
                kicker: "The pack breaks first",
                text: `You are not the hunter here. ${HUNT_PACK_STAGES} of them come out of the scrub at once.`,
            });
            launchHuntPackStage(mission, ai, 0, sector, undefined, decision.decisionId);
            return;
        }

        if (nextProgress <= trail.progress) {
            setHuntToast({
                id: Date.now(),
                kicker: "Trail lost",
                text: `You back out clean. ${ai.name} is still out there, and the sign has gone cold here.`,
            });
            return;
        }

        advanceHuntTrail({ ...trail, progress: nextProgress - 1 }, ai, sector, decision.nextSector);
    }

    /** Advance one track: server ping, local counter, toast, and the travel leg. */
    function advanceHuntTrail(trail: ActiveHuntTrail, ai: CreatorAi, sector: number, authoritativeNextSector?: number) {
        const mission = trail.mission;
        const requiredTracks = trail.requiredTracks;
        const nextProgress = Math.min(requiredTracks, trail.progress + 1);

        // Mirror the server-owned trail counter for immediate UI response.
        setMissionProgress((current) => ({
            ...current,
            [mission.id]: Math.max(nextProgress, current[mission.id] ?? 0),
        }));
        const nextSector = authoritativeNextSector ?? huntTrailSector(mission, nextProgress, playerSlug(character.name));
        const finalTrackFound = huntReadyForFight(mission, nextProgress);
        setHuntToast({
            id: Date.now(),
            kicker: finalTrackFound ? "The trail closes" : "Fresh tracks",
            text: finalTrackFound
                ? `${ai.name} circles back toward ${sectorRegionName(nextSector)}, Sector ${nextSector}. Follow the trail there to force the fight.`
                : `The sign cuts toward ${sectorRegionName(nextSector)}, Sector ${nextSector}. Trail ${nextProgress}/${Math.max(1, requiredTracks - 1)}.`,
        });
        if (nextSector !== sector) {
            beginSectorTravel(nextSector, () => {
                const nextBiome = biomeForSector(nextSector);
                setCurrentBiome(nextBiome);
                setCurrentWeather(weatherForSector(nextSector, nextBiome));
                setCurrentSector(nextSector);
                setSelectedSector(nextSector);
            });
        }
    }

    /** The contract target itself, opened according to the Hunt Quality earned. */
    function launchHuntBeastFight(encounter: HuntEncounterState) {
        // No sector plumbing needed — huntSector() already moved the player here
        // before it opened the card.
        const { trail, ai } = encounter;
        const mission = trail.mission;
        setHuntEncounter(null);

        // Keep the board's presentation at the final-track threshold while the
        // fight is open. Only report-ai-fight's sealed hunt-target WIN writes the
        // kill receipt and the settlement listener mirrors full progress; a loss
        // leaves this final lead hot for a rematch.
        setMissionProgress((current) => ({
            ...current,
            [mission.id]: Math.max(trail.requiredTracks - 1, current[mission.id] ?? 0),
        }));

        launchWorldMapFight(
            ai,
            encounter.sector,
            { kind: "hunt-target", sourceId: mission.id, sector: encounter.sector, stage: 0 },
        );
    }

    /**
     * One wave of the beast's pack. Reuses the wanderer ambush chain (HP carries
     * across waves) via a `huntPack` mode. Pack members carry derived ids, never
     * the contract beast's — a mook must not be able to stamp the kill receipt.
     */
    function launchHuntPackStage(mission: CreatorMission, beast: CreatorAi, stage: number, sector: number, chainId?: string, decisionId?: string) {
        const member = huntPackMember(mission, beast.name, stage);
        // Scaled to the player like the bandit gauntlet, and softer than the
        // contract target — these are outriders, not the beast on the poster.
        const pack = makeBuiltinAi(member.id, member.name, beast.icon, Math.max(1, character.level + stage), beast.village, [], 0, undefined, "bruiser");
        pack.image = beast.image || beastPortrait(beast.id);
        launchWorldMapFight(
            pack,
            sector,
            { kind: "hunt-pack", sourceId: mission.id, sector, stage, ...(chainId ? { chainId } : {}), ...(decisionId ? { decisionId } : {}) },
        );
    }
    function restInSector(sector: number) {
        const staminaReward = 10 + (sector % 10);

        updateCharacter({
            ...character,
            stamina: Math.min(character.maxStamina, character.stamina + staminaReward),
        });

        alert("You recovered in Sector " + sector + ". +" + staminaReward + " stamina.");
    }

    function selectedSectorCombatEnvironment() {
        const sector = selectedSector;
        if (sector == null || !sameSector(currentSector, sector)) return null;
        const biome = biomeForSector(sector);
        return { sector, biome, weather: weatherForSector(sector, biome) };
    }

    function focusSectorCombat(sector: number, biome: Biome, weather: WeatherType) {
        setCurrentSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weather);
    }

    async function handleSelectedSectorVillageWarRaid() {
        const environment = selectedSectorCombatEnvironment();
        if (!environment || !capabilityAdmissionAllowed(mutationAvailability("villageWar"))) return;
        const createScope = capturePvpCreateScope(character.name);
        if (!createScope.isCurrent()) return;
        const { sector, biome, weather } = environment;
        const guard = sectorEnemyGuards[0];
        if (guard) {
            const guardCharacter = await fetchSavedPlayerCharacter(guard.name);
            if (!createScope.isCurrent()) return;
            if (!capabilityAdmissionAllowed(mutationAvailability("villageWar"))) return;
            if (guardCharacter) {
                await startPvpRaid(guardCharacter, sector, biome, weather, createScope);
                return;
            }
            await launchAiGuardRaid(pickGuardAi(guard.level, guard.defenseBonusPercent ?? 0), guard.level, sector, () => {
                focusSectorCombat(sector, biome, weather);
            });
            return;
        }
        await launchAiGuardRaid(pickGuardAi(character.level), character.level, sector, () => {
            focusSectorCombat(sector, biome, weather);
        });
    }

    function handleSelectedSectorControlledRaid() {
        const environment = selectedSectorCombatEnvironment();
        if (!environment || !capabilityAdmissionAllowed(mutationAvailability("villageWar"))) return;
        const { sector, biome, weather } = environment;
        void launchAiGuardRaid(pickGuardAi(character.level), character.level, sector, () => {
            focusSectorCombat(sector, biome, weather);
        });
    }

    function handleSelectedSectorPlayerAttack(player: PlayerRecord) {
        const environment = selectedSectorCombatEnvironment();
        if (!environment) return;
        if (peerIsTraveling(player)) {
            alert(`${player.name} is traveling and cannot be attacked right now.`);
            return;
        }
        if (player.inBattle) {
            alert(`${player.name} is already in a battle.`);
            return;
        }
        focusSectorCombat(environment.sector, environment.biome, environment.weather);
        // sectorAttackPlayer owns routing and only navigates after its sealed PvP
        // session request succeeds.
        sectorAttackPlayer(player);
    }

    function handleSelectedSectorSleeperAttack(player: PlayerRecord) {
        if (selectedSector != null && sameSector(currentSector, selectedSector)) attackSleeper(player);
    }

    function handleOpenSectorSigns() {
        setTracesModal({ view: "signs" });
    }

    function handleOpenSectorShrine() {
        setTracesModal({ view: "shrine" });
    }

    function handleExploreSelectedSector() {
        if (selectedSector != null && sameSector(currentSector, selectedSector)) void exploreSector(selectedSector);
    }

    // Picked clean is a signpost, not a wall. The pool is shared and per-sector,
    // so a drained one always means a fuller one nearby; this walks the road graph
    // for the closest and hands the player back to the overview, where the pool
    // tiers it just named are drawn on the markers.
    async function handleClaimContract() {
        if (selectedSector == null || !sameSector(currentSector, selectedSector) || contractBusy) return;
        setContractBusy(true);
        // The server recomputes the bounty from the sealed sector and day and
        // pays from that, so the only thing to do with the answer is adopt the
        // total it reports back — never add the amount locally.
        const result = await claimSectorContract(character.name, selectedSector);
        setContractBusy(false);
        bumpSectorContractRevision();
        if (!result.ok) {
            setTravelToast({ id: Date.now(), kicker: "Contract", text: result.message });
            return;
        }
        if (onServerVersion?.(result.saveVersion) !== false) {
            updateCharacter((prev) => (prev && prev.name === character.name ? { ...prev, ryo: result.totalRyo } : prev));
        }
        setTravelToast({ id: Date.now(), kicker: "Contract settled", text: `The posting pays ${result.ryo.toLocaleString()} ryo.` });
    }

    function handleFindRicherGround() {
        if (selectedSector == null) return;
        const richer = richerSectorsNear(selectedSector, character.village, sectorOwnerVillage);
        setSelectedSector(null);
        setTravelToast({
            id: Date.now(),
            kicker: richer.length ? "Richer ground" : "Picked clean",
            text: richer.length
                ? `Still rich nearby: ${richer.map((entry) => `${sectorName(entry.sector) ?? `Sector ${entry.sector}`} (${entry.hops} ${entry.hops === 1 ? "road" : "roads"} out)`).join(", ")}.`
                : "Every road out of here has been worked over today. The pools refill at midnight UTC.",
        });
    }

    function handleHuntSelectedSector() {
        if (selectedSector != null && sameSector(currentSector, selectedSector)) void huntSector(selectedSector);
    }

    function handleRecoverSelectedSector() {
        if (selectedSector != null && sameSector(currentSector, selectedSector)) restInSector(selectedSector);
    }

    function handleLeaveSelectedSector() {
        setSelectedSector(null);
    }

    function triggerCreatorEvent(event: CreatorEvent) {
        const sector = event.targetSector ?? 56;
        const biome = biomeForWorldSector(sector);
        setCurrentSector(sector);
        setCurrentBiome(biome);
        setCurrentWeather(weatherForSector(sector, biome));
        if (character.level < event.levelReq) return alert("Requires level " + event.levelReq + ".");
        if (event.eventKind === "visualNovel") {
            setCreatorEventPage(0);
            setCreatorEventLine(0);
            setSelectedCreatorEvent(event);
            return;
        }
        const leveled = gainXp(character, 0); // XP retired — legacy xpReward ignored
        const rewarded = applyCurrencyRewards(leveled, event.currencyRewards);
        updateCharacter({ ...rewarded, ryo: rewarded.ryo + event.ryoReward, stamina: Math.min(rewarded.maxStamina, rewarded.stamina + event.staminaReward) });
        alert(event.icon + " " + event.name + "\n\n" + event.dialogue.join("\n") + "\n\n" + rewardSummary(event.ryoReward, event.staminaReward, event.currencyRewards, character));
    }
    function completeCreatorEvent(event: CreatorEvent) {
        // A roaming giver's scene can end here as well as through onCancel (a
        // decline choice plays its goodbye and then completes), so both close paths
        // run the accept check. No-op for every other event id.
        noteGiverVnClosed(event.id);
        // Story road events pay nothing here — the choice was the payoff and it
        // was reported at choice time. Just close the scene.
        if (event.id.startsWith(ROAD_WANDERER_PREFIX)) { setSelectedCreatorEvent(null); return; }
        if (isStoryReckoningId(event.id)) {
            setSelectedCreatorEvent(null);
            if (isStoryReckoningReturnEventId(event.id)) {
                const arc = storyReckoningForEventId(event.id);
                if (arc) void handleStoryReckoningTurnIn(arc);
            }
            return;
        }
        // Rift VNs (giver report / at-the-rift): accept + descend are handled in
        // onChoice; completing the scene just closes it.
        if (event.id.startsWith(RIFT_GIVER_PREFIX) || isRiftDescentEventId(event.id)) { setSelectedCreatorEvent(null); return; }
        // The codex pays no ryo/stamina (all three rewards are 0), so the generic
        // tail below would end this scene on an alert saying nothing was gained.
        // The cards ARE the payoff — close the scene and let them open.
        if (event.id === SCRIBE_WANDERER_ID) { setSelectedCreatorEvent(null); closeCodexScene(); return; }
        const leveled = gainXp(character, 0); // XP retired — legacy xpReward ignored
        const rewarded = applyCurrencyRewards(leveled, event.currencyRewards);
        updateCharacter({ ...rewarded, ryo: rewarded.ryo + event.ryoReward, stamina: Math.min(rewarded.maxStamina, rewarded.stamina + event.staminaReward) });
        alert(event.name + " complete. " + rewardSummary(event.ryoReward, event.staminaReward, event.currencyRewards, character) + ".");
        setSelectedCreatorEvent(null);
    }
    function launchCreatorEventFight(event: CreatorEvent, battle?: EventEncounterBattle) {
        const opponent = creatorEventPracticeOpponent(event.aiProfileId, battle?.aiProfileId, character.level);
        setCurrentBiome(event.biome);
        setCurrentWeather(weatherForBiome(event.biome));
        const launched = requestAiFight({
            opponentId: opponent.id,
            opponentLevel: Math.max(1, event.levelReq || character.level),
            // Published creator-event battles do not yet have a sealed event
            // receipt tying combat to the separate VN completion reward. Keep
            // the canonical Solo-PvE combat preview non-paying until they do.
            battleKind: "practice",
            sector: event.targetSector,
            returnScreen: "worldMap",
        });
        if (launched) setSelectedCreatorEvent(null);
        else alert("The sealed practice arena is unavailable. Your event remains open.");
    }
    if (activePetEncounter && !petVnDone) {
        const petActorImage = petCardImage(activePetEncounter, sharedImages);
        const sourcePages: NonNullable<CreatorEvent["vnPages"]> = petEncounterVn.vnPages?.length
            ? petEncounterVn.vnPages
            : [{
                title: petEncounterVn.vnTitle || petEncounterVn.name,
                scene: petEncounterVn.vnScene || "Fresh tracks stop beside your own.",
                speaker: petEncounterVn.vnSpeaker || "Narrator",
                dialogue: petEncounterVn.dialogue,
            }];
        const cinematicPetEvent: CreatorEvent = {
            ...petEncounterVn,
            biome: "forest",
            avatarImage: petActorImage || petEncounterVn.avatarImage,
            vnPages: sourcePages.map((page) => ({
                ...page,
                rightName: page.rightName || activePetEncounter.name,
                rightImage: page.rightImage || petActorImage || undefined,
            })),
        };
        return (
            <TriggeredVisualNovel
                event={cinematicPetEvent}
                character={character}
                pageIndex={petVnPage}
                lineIndex={petVnLine}
                setPageIndex={setPetVnPage}
                setLineIndex={setPetVnLine}
                onCancel={() => setPetVnDone(true)}
                onComplete={() => setPetVnDone(true)}
                onBattle={() => setPetVnDone(true)}
                sharedImages={sharedImages}
            />
        );
    }

    if (activePetEncounter && petVnDone) {
        return (
            <div className="card cinematic-card">
                <h2><GiPawPrint style={{ verticalAlign: "-0.12em", marginRight: "0.35rem" }} />{activePetEncounter.name} Wants to Join You!</h2>

                <div className="summary-box">
                    <h3>{activePetEncounter.name}</h3>
                    <p><strong>Rarity:</strong> {activePetEncounter.rarity}</p>
                    <p><strong>Level:</strong> {activePetEncounter.level}</p>
                    <p>
                        HP {activePetEncounter.hp} | ATK {activePetEncounter.attack} |
                        DEF {activePetEncounter.defense} | SPD {activePetEncounter.speed}
                    </p>

                    {(() => {
                        const encImg = petCardImage(activePetEncounter, sharedImages);
                        return encImg ? (
                            <div className="admin-jutsu-preview">
                                <img src={encImg} alt={activePetEncounter.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            </div>
                        ) : null;
                    })()}
                </div>

                <div className="menu">
                    <button
                        disabled={!petDecisionReady || petBefriendPending}
                        onClick={() => {
                            // Ignore clicks during the grace window — a rapid-click
                            // carried over from the VN must not auto-resolve this.
                            if (!petDecisionReady || petBefriendPending) return;
                            const encounter = activePetEncounter;
                            const token = petEncounterToken.current;
                            if (!token) return alert("This encounter has expired. Explore again to find another companion.");
                            // The server rolls the trait and commits the roster. Hold the
                            // card up (disabled) until it answers rather than showing the
                            // pet as joined and having the save strip it a moment later.
                            setPetBefriendPending(true);
                            void befriendWildPet(character.name, token).then((result) => {
                                setPetBefriendPending(false);
                                if (!result.character) {
                                    if (result.error === "invalid-or-spent-encounter") {
                                        petEncounterToken.current = "";
                                        setActivePetEncounter(null);
                                        window.setTimeout(() => { void recoverPendingWorldRewards(true); }, 0);
                                        return alert("The Guild is revalidating this pet choice from its sealed discovery receipt.");
                                    }
                                    return alert(result.error ?? "The pet could not be befriended.");
                                }
                                // Adopt the server's persisted character wholesale — a
                                // locally merged roster would be stripped on the next save.
                                if (!onVersionedCharacter(result.character, result.saveVersion)) return;
                                const operationId = petEncounterExploreOperationId.current;
                                if (operationId) completeWorldRewardOperation(character.name, operationId);
                                petEncounterExploreOperationId.current = "";
                                petEncounterToken.current = "";
                                setActivePetEncounter(null);
                                const trait = result.trait as PetTrait | null;
                                const destination = result.destination === "sanctuary" ? "\nYour carried roster was full, so they are resting safely in the Sanctuary." : "";
                                alert(trait
                                    ? `${encounter.name} joined you!\nTrait: ${trait} — ${petTraitDescriptions[trait]}${destination}`
                                    : `${encounter.name} joined you!${destination}`);
                            });
                        }}
                    >
                        {petBefriendPending ? "Befriending…" : petDecisionReady ? "Befriend Pet" : "Befriend Pet…"}
                    </button>

                    <button
                        className="danger-button"
                        disabled={!petDecisionReady || petBefriendPending}
                        onClick={() => {
                            if (!petDecisionReady || petBefriendPending) return;
                            const token = petEncounterToken.current;
                            if (!token) return alert("This encounter has expired. Reopen the map to recover it.");
                            setPetBefriendPending(true);
                            void declineWildPetEncounter(character.name, token).then((result) => {
                                setPetBefriendPending(false);
                                if (!result.ok) {
                                    if (!result.retryable) {
                                        petEncounterToken.current = "";
                                        setActivePetEncounter(null);
                                        window.setTimeout(() => { void recoverPendingWorldRewards(true); }, 0);
                                        return alert("The Guild is reconciling this pet choice from its sealed discovery receipt.");
                                    }
                                    alert(result.error ?? "The pet is still waiting. Try Leave again when the connection recovers.");
                                    return;
                                }
                                const operationId = petEncounterExploreOperationId.current;
                                if (operationId) completeWorldRewardOperation(character.name, operationId);
                                petEncounterExploreOperationId.current = "";
                                petEncounterToken.current = "";
                                setActivePetEncounter(null);
                            });
                        }}
                    >
                        Leave
                    </button>
                </div>

                {!petDecisionReady && (
                    <p className="pet-encounter-hint" style={{ textAlign: "center", opacity: 0.7, marginTop: 8 }}>
                        Make your choice…
                    </p>
                )}
            </div>
        );
    }
    if (legacyAvailable && sageVnEvent) {
        // The Wandering Sage's introduction. Completing it opens the offer
        // sheet (SageOfferModal) where the permanent choice actually happens.
        return <TriggeredVisualNovel event={sageVnEvent} character={character} pageIndex={sageVnPage} lineIndex={sageVnLine} setPageIndex={setSageVnPage} setLineIndex={setSageVnLine} onCancel={() => setSageVnEvent(null)} onComplete={() => { setSageVnEvent(null); setSageChoiceOpen(true); }} onBattle={() => { /* the Sage never fights */ }} sharedImages={sharedImages} />;
    }
    if (selectedCreatorEvent) {
        return (
            <TriggeredVisualNovel
                event={selectedCreatorEvent}
                character={character}
                pageIndex={creatorEventPage}
                lineIndex={creatorEventLine}
                setPageIndex={setCreatorEventPage}
                setLineIndex={setCreatorEventLine}
                onCancel={() => { noteGiverVnClosed(selectedCreatorEvent.id); if (selectedCreatorEvent.id === SCRIBE_WANDERER_ID) closeCodexScene(); setSelectedCreatorEvent(null); }}
                onComplete={() => completeCreatorEvent(selectedCreatorEvent)}
                onBattle={launchCreatorEventFight}
                onChoice={(c) => {
                    const ev = selectedCreatorEvent;
                    if (!ev) return;
                    if (c.trait === STORY_RECKONING_ACCEPT_TRAIT) {
                        const arc = storyReckoningForEventId(ev.id);
                        if (arc) void handleStoryReckoningAccept(arc);
                        return;
                    }
                    if (c.trait === RIFT_ACCEPT_MARKER) {
                        const rift = riftBySynthId(ev.id);
                        giverAcceptedRef.current = ev.id; // taken, not turned down
                        setSelectedCreatorEvent(null);
                        if (rift) void acceptRift(character.name, rift.id).then((resp) => {
                            if (resp.ok && resp.activeRiftQuest) {
                                updateCharacter(prev => prev ? ({ ...prev, activeRiftQuest: resp.activeRiftQuest }) : prev);
                            } else {
                                setTimeout(() => alert(resp.reason === "busy" ? "Finish the rift you already carry first." : resp.reason === "cooldown" ? "The energy has not gathered again yet. Come back later." : "The rift could not be marked. Try again in a moment."), 40);
                            }
                        });
                        return;
                    }
                    if (c.trait === SCRIBE_ACCEPT_MARKER) {
                        // Inert today — the scribe is exempt from the decline cooldown, so
                        // noteGiverVnClosed ignores her either way. Kept so the stamp is
                        // already right if she is ever brought back under that rule.
                        giverAcceptedRef.current = ev.id;
                        // Arm the pack cinematic for when this scene closes, and
                        // read the collection BEFORE the grant lands so the NEW
                        // badges are honest.
                        codexSceneClosedRef.current = false;
                        pendingCodexRevealRef.current = null;
                        const ownedBeforeCodex = countChronicleCards(character.tileCards ?? []);
                        // Leave the scene up so Ihara's send-off conclusion plays
                        // (closing here would eat the beat — see the rift-abandon
                        // note below). The server grant is idempotent: it tops the
                        // collection up to the same starter floor the first duel
                        // would grant anyway, then latches starterCardsClaimed.
                        void claimTravelersCodex(character.name).then((resp) => {
                            if (resp.ok) {
                                // Adopt the mutation version before the local
                                // mirror changes so an autosave cannot echo the
                                // pre-claim base and self-conflict with Ihara's
                                // authoritative codex write.
                                onServerVersion?.(resp._saveVersion);
                                updateCharacter(prev => prev ? ({
                                    ...prev,
                                    ...(resp.tileCards ? { tileCards: resp.tileCards } : {}),
                                    starterCardsClaimed: true,
                                }) : prev);
                                const granted = resp.granted ?? [];
                                const faces = codexRevealCards(granted);
                                if (faces.length > 0) {
                                    const reveal = { nonce: makeId(), cards: faces, ownedBefore: ownedBeforeCodex, grantedCount: granted.length };
                                    if (codexSceneClosedRef.current) setCodexReveal(reveal);
                                    else pendingCodexRevealRef.current = reveal;
                                }
                                const recordedDeeds = resp.progressionGranted?.length ?? 0;
                                if (recordedDeeds > 0) {
                                    setTravelToast({
                                        id: Date.now(),
                                        kicker: "LIVING CHRONICLE",
                                        text: `Ihara found ${recordedDeeds === 1 ? "one earlier deed" : `${recordedDeeds} earlier deeds`} in the road's surviving accounts and pressed ${recordedDeeds === 1 ? "its record" : "their records"} into your new codex.`,
                                    });
                                }
                            } else if (resp.reason === "already-claimed") {
                                // Self-heal a stale local mirror; the scribe retires.
                                updateCharacter(prev => prev ? ({ ...prev, starterCardsClaimed: true }) : prev);
                            } else {
                                setTimeout(() => alert(resp.reason === "level"
                                    ? "Ihara squints at you. \"Not yet. Find your feet first — I'll find the rest of you.\""
                                    : "The codex couldn't be claimed. Find Ihara again in a moment."), 40);
                            }
                        });
                        return;
                    }
                    if (c.trait === RIFT_DESCEND_MARKER) {
                        const rift = riftByDescentEventId(ev.id);
                        setSelectedCreatorEvent(null);
                        if (rift) onDescendRift?.(rift);
                        return;
                    }
                    if (c.trait === RIFT_ABANDON_MARKER) {
                        // Closing the scene here would unmount the VN in this same
                        // batch and throw away the choice's conclusion beat. Drop the
                        // quest now and leave the scene up: the VN plays the goodbye
                        // and ends itself through onComplete, like the sibling
                        // "step back" choice that carries no marker.
                        void abandonRift(character.name);
                        updateCharacter(prev => prev ? ({ ...prev, activeRiftQuest: null }) : prev);
                        return;
                    }
                    const t = c.trait;
                    if (t) {
                        // A road beat with a trait IS resolved — nextRoadEvent moves
                        // on — so it must not also read as "turned down" when the
                        // conclusion finishes and the scene completes.
                        giverAcceptedRef.current = ev.id;
                        updateCharacter(prev => prev ? addStoryTrait(prev, t) : prev);
                        if (ev.id.startsWith(ROAD_WANDERER_PREFIX)) void reportStoryRoadEvent(character.name, ev.id, t);
                    }
                }}
                sharedImages={sharedImages}
            />
        );
        const event = selectedCreatorEvent!;
        const eventPages = event.vnPages ?? [];
        const pages = (eventPages.length > 0 ? eventPages : [{ title: event.vnTitle || event.name, scene: event.vnScene || "", speaker: event.vnSpeaker || "Narrator", dialogue: event.dialogue, image: event.image }]) as NonNullable<CreatorEvent["vnPages"]>;
        const page = pages[Math.min(creatorEventPage, pages.length - 1)];
        const pageDialogue = page.dialogue.length > 0 ? page.dialogue : event.dialogue;
        const activeLine = pageDialogue[creatorEventLine] ?? pageDialogue[0] ?? page.scene ?? "The scene begins.";
        const { speaker, text: spoken } = splitDialogueLine(activeLine, page.speaker || event.vnSpeaker || "Narrator");
        const pageImage = page.image || event.image || defaultVnScene(event.id, event.biome);
        const savedRightWasPlayer = (page.rightName ?? "").trim().toLowerCase() === "player";
        const leftName = savedRightWasPlayer ? "Player" : (page.leftName || "Player");
        const rightName = savedRightWasPlayer ? (page.leftName || page.speaker || event.vnSpeaker || speaker) : (page.rightName || page.speaker || event.vnSpeaker || speaker);
        const leftInitials = leftName === "Narrator" ? "..." : leftName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
        const rightInitials = rightName.toLowerCase() === "player" ? character.name.slice(0, 2).toUpperCase() : rightName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
        const leftImage = savedRightWasPlayer ? character.avatarImage : (page.leftImage || (leftName.toLowerCase() === "player" ? character.avatarImage : ""));
        const rightImage = savedRightWasPlayer ? (page.leftImage || page.rightImage || event.avatarImage || "") : (page.rightImage || event.avatarImage || "");
        const canBack = creatorEventLine > 0 || creatorEventPage > 0;
        function previousLine() { if (creatorEventLine > 0) return setCreatorEventLine((index) => index - 1); if (creatorEventPage > 0) { const previousPage = pages[creatorEventPage - 1]; setCreatorEventPage((index) => index - 1); setCreatorEventLine(Math.max(0, (previousPage.dialogue.length || 1) - 1)); } }
        function nextLine() { if (creatorEventLine < pageDialogue.length - 1) return setCreatorEventLine((index) => index + 1); if (creatorEventPage < pages.length - 1) { setCreatorEventPage((index) => index + 1); setCreatorEventLine(0); return; } completeCreatorEvent(event); }
        return <div className="card cinematic-card"><div className="visual-novel admin-vn-play"><div className="vn-header"><div><p className="act-label">ADMIN VISUAL NOVEL EVENT</p><h2>{page.title || event.vnTitle || event.name}</h2></div><div className="vn-progress">Page {creatorEventPage + 1}/{pages.length} | Line {creatorEventLine + 1}/{Math.max(1, pageDialogue.length)}</div></div><div className={"vn-stage vn-biome-" + event.biome + (pageImage ? " vn-has-image" : "")} style={pageImage ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${pageImage})` } : undefined}><div className="vn-backdrop"><span className="vn-village-silhouette"></span></div><div className="vn-character mentor-character">{leftImage ? <img src={leftImage} alt={leftName} /> : leftInitials}</div><div className="vn-character hero-character">{rightImage ? <img src={rightImage} alt={rightName} /> : rightInitials}</div><div className="vn-scene-card">{page.scene || event.vnScene || "An admin-created scene unfolds across the shinobi world."}</div><div className="vn-dialogue"><div className="vn-speaker">{speaker}</div><p>{spoken}</p><div className="vn-controls"><button disabled={!canBack} onClick={previousLine}>Back</button><button onClick={nextLine}>{creatorEventPage === pages.length - 1 && creatorEventLine >= pageDialogue.length - 1 ? "Complete Event" : "Next"}</button></div></div></div><div className="vn-choice-row"><button onClick={() => { setCreatorEventPage(0); setCreatorEventLine(0); }}>Replay Scene</button><button onClick={() => launchCreatorEventFight(event)}>Battle in {biomeLabel(event.biome)}</button><button onClick={() => completeCreatorEvent(event)}>Claim Reward</button></div><div className="vn-reward-strip"><span>Requirement: Level {event.levelReq}</span><span>Reward: {rewardSummary(event.ryoReward, event.staminaReward, event.currencyRewards)}</span></div></div></div>;
    }
    if (activeChest && !chestVnDone) {
        const biome = biomeForSector(selectedSector ?? 40);
        const cinematicChestEvent: CreatorEvent = { ...ancientChestVn, biome };
        return (
            <TriggeredVisualNovel
                event={cinematicChestEvent}
                character={character}
                pageIndex={chestVnPage}
                lineIndex={chestVnLine}
                setPageIndex={setChestVnPage}
                setLineIndex={setChestVnLine}
                onCancel={() => setChestVnDone(true)}
                onComplete={() => setChestVnDone(true)}
                onBattle={() => setChestVnDone(true)}
                sharedImages={sharedImages}
            />
        );
    }

    if (activeChest && chestVnDone) {
        const allCards = getAllTileCards([]);
        const lootItem = activeChest.itemId ? starterItems.find((i) => i.id === activeChest.itemId) : null;
        const lootCard = activeChest.cardId ? allCards.find((c) => c.id === activeChest.cardId) : null;
        const alreadyHaveCard = lootCard && character.tileCards.includes(lootCard.id);
        const rewards: { icon: ReactNode; label: string; sub: string }[] = [];
        if (activeChest.ryo) rewards.push({ icon: <GameIcon name="ryo" size={22} />, label: `+${activeChest.ryo} Ryo`, sub: "Ancient gold" });
        if (lootItem) rewards.push({ icon: <GameIcon name="bag" size={22} />, label: lootItem.name, sub: `${lootItem.rarity.charAt(0).toUpperCase() + lootItem.rarity.slice(1)} ${lootItem.slot} · ${lootItem.description.slice(0, 40)}` });
        if (lootCard) rewards.push({ icon: <GiCardPickup size={22} />, label: `${lootCard.name}${alreadyHaveCard ? " (duplicate)" : ""}`, sub: `${lootCard.rarity.charAt(0).toUpperCase() + lootCard.rarity.slice(1)} · ${lootCard.element}` });
        if (activeChest.fateShards) rewards.push({ icon: <GameIcon name="shard" size={22} />, label: "+1 Fate Shard", sub: "Premium currency" });
        if (activeChest.boneCharms) rewards.push({ icon: <GameIcon name="bone" size={22} />, label: "+1 Bone Charm", sub: "Awakening Stone material" });
        if (activeChest.auraStones) rewards.push({ icon: <GameIcon name="crystal" size={22} />, label: "+1 Aura Stone", sub: "Awakening Stone material" });
        if (activeChest.auraDust) rewards.push({ icon: <GameIcon name="sparkle" size={22} />, label: `+${activeChest.auraDust} Aura Dust`, sub: "Feeds the Aura Sphere" });

        return (
            <div className="card cinematic-card ancient-chest-reveal-card">
                <div className="chest-reveal">
                    <div className="chest-reveal-header">
                        <p className="act-label"><GiOpenTreasureChest style={{ verticalAlign: "-0.14em", marginRight: "0.3rem" }} />ANCIENT CHEST CONTENTS</p>
                        <h2 className="chest-reveal-title">The chest yields its secrets</h2>
                        <p className="chest-reveal-sub">A relic of the shinobi wars, now yours to keep.</p>
                    </div>
                    <div className="chest-rewards">
                        {rewards.map((r, i) => (
                            <div key={i} className="chest-reward-row">
                                <span className="chest-reward-icon">{r.icon}</span>
                                <div className="chest-reward-text">
                                    <strong>{r.label}</strong>
                                    <small>{r.sub}</small>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button className="chest-claim-btn" onClick={() => claimChest()}>
                        <GiOpenTreasureChest style={{ verticalAlign: "-0.14em", marginRight: "0.3rem" }} />Claim All Rewards
                    </button>
                </div>
            </div>
        );
    }

    if (isTraveling) {
        // The countdown owns its own ticker (see TravelingOverlay) — App wakes
        // once at arrival, so a clock read during this render would never tick.
        return <TravelingOverlay arrivalAt={travelingUntil} />;
    }

    // Built once and mounted in BOTH render branches (sector detail above, world
    // overview below) — they are mutually exclusive early returns, so this can
    // never double-mount. The card portals to <body>, so where it sits in the
    // tree doesn't affect layout.
    const huntEncounterCard = huntEncounter && (
        <HuntEncounterCard
            view={huntEncounter.view}
            beastName={huntEncounter.ai.name}
            beastRank={huntEncounter.trail.mission.rank}
            portrait={huntEncounter.ai.image || beastPortrait(huntEncounter.ai.id)}
            icon={huntEncounter.ai.icon}
            sector={huntEncounter.sector}
            regionName={sectorRegionName(huntEncounter.sector)}
            trailStep={Math.min(huntEncounter.trail.progress + 1, Math.max(1, huntEncounter.trail.requiredTracks - 1))}
            trailTotal={Math.max(1, huntEncounter.trail.requiredTracks - 1)}
            description={huntEncounter.trail.mission.description}
            onChoose={(choice) => resolveHuntChoice(huntEncounter, choice)}
            onEngage={() => launchHuntBeastFight(huntEncounter)}
            onClose={() => setHuntEncounter(null)}
        />
    );

    if (selectedSector) {
        const biome = biomeForSector(selectedSector);
        const sectorWeather = weatherForSector(selectedSector, biome);
        const territory = loadSectorTerritory(selectedSector);
        const villageWar = villageWarViewOpen
            ? activeVillageWarsFor(character.village).find(war => war.warGroundSector === selectedSector)
            : undefined;
        const villageWarEnemy = villageWar?.villages.find(village => village !== character.village);
        const livePlayersHere = liveSectorPlayers
            .filter((p) => p.name.toLowerCase() !== character.name.toLowerCase())
            .filter((p) => sameSector(p.currentSector, selectedSector));
        // "Sleeping" targets: players who logged out / closed the tab while
        // standing in THIS wild sector. They come from playerRoster (which carries
        // every registered player tagged with their last-saved sector) minus
        // anyone who is currently LIVE here. Previously these offline players were
        // shown as if they were live and the attack 404'd ("Target not online") —
        // the ghost-in-the-sector bug. Now they're rendered distinctly with a 💤
        // badge and routed to the server-authoritative sleeper-KO flow. Capped so
        // a sector everyone last passed through (e.g. the default sector) can't
        // flood the panel. A village / Central logout saves currentSector 0, so
        // those players never appear here.
        const liveNamesHere = new Set(livePlayersHere.map((p) => p.name.toLowerCase()));
        const sleepingHere: PlayerRecord[] = playerRoster
            .filter((player) => player.name.toLowerCase() !== character.name.toLowerCase())
            .filter((player) => player.sleeping === true)
            .filter((player) => sameSector(player.currentSector, selectedSector))
            .filter((player) => !liveNamesHere.has(player.name.toLowerCase()))
            .filter((player) => !isRecentlyStruckDown(player.name))
            .slice(0, 15);
        const sectorPlayers: Array<PlayerRecord & { __sleeping?: boolean }> = sameSector(currentSector, selectedSector)
            ? [...livePlayersHere, ...sleepingHere.map((p) => ({ ...p, __sleeping: true }))]
            : [];
        // 2D live peers: when enabled (default), peers render as a walking overlay
        // at their real transmitted tile and the in-tile dots are suppressed to avoid
        // drawing each peer twice. Live peers (with real tiles) are read from the
        // presence store inside <SectorPeersLive>; only the sleepers (offline targets
        // with no live position) are derived here, on their per-name fallback tile.
        const livePeersOn = isSectorLivePeersEnabled();
        const sleeperPeers: SectorPeer[] = livePeersOn
            ? sleepingHere.map((p) => ({
                name: p.name,
                tile: playerNameTile(p.name),
                level: p.level,
                sleeping: true,
                avatar: sharedImages['avatar:' + p.name.toLowerCase()] || (p.character.avatarImage as string) || '',
            }))
            : [];
        const activeHuntTrailForSector = isWildSector(selectedSector)
            ? huntTrailForSector(selectedSector)
            : undefined;
        const activeHuntMissionForSector = activeHuntTrailForSector?.mission;
        const activeHuntAiForSector = activeHuntMissionForSector?.aiProfileId
            ? playableAis.find((ai) => ai.id === activeHuntMissionForSector.aiProfileId)
            : undefined;
        const activeHuntReadyForFight = activeHuntMissionForSector
            ? huntReadyForFight(activeHuntMissionForSector, activeHuntTrailForSector?.progress ?? 0)
            : false;

        // New sector look: a painted top-down adventure MAP behind the grid (flag-gated,
        // off by default). Replaces the 2D vista stack when active. Custom-territory
        // backdrops keep their own art.
        // The painted floor is now unconditional: every sector has one, and the
        // vista fallback (with its per-sector art) was retired. A territory with
        // its own custom backdrop still gets the <SectorScene> stack below.
        const sectorMapSrc = territory.backgroundImage
            ? undefined
            : sectorMapUrl(ambienceBiomeForSector(selectedSector), selectedSector);
        const sectorOwnerLabel = territory.ownerClan ? `${territory.ownerClan} (${territory.ownerVillage})` : "Unclaimed";
        // Clan territory is inert until a clan claims the sector. Collapse its five-row
        // card until it is owned, mid-capture, guarded, cooling down, or a live war
        // ground; untouched sectors would otherwise show rows of zeroes.
        const territoryRebuildMinsLeft = territory.rebuiltAt
            ? Math.ceil((TERRITORY_REBUILD_COOLDOWN_MS - (Date.now() - territory.rebuiltAt)) / 60000)
            : 0;
        const territoryIsLive = Boolean(
            territory.ownerClan
            || villageWar
            || territory.controlScore > 0
            || territory.guards.length > 0
            || territory.hp < TERRITORY_HP_MAX
            || territoryRebuildMinsLeft > 0,
        );
        // Claiming is a Clan Hall action, so a clanless player can never move an idle
        // sector off zero — the collapsed card would be a permanently inert row telling
        // them about a system they cannot touch. Hide it outright for them. A LIVE
        // sector still shows: someone else's hold is world state that affects them
        // (the owner's terrain buff applies against them, and they can raid it), and a
        // war ground is village-level, not clan-level.
        const showTerritoryCard = territoryIsLive || Boolean(character.clan);
        const sectorIsCurrent = sameSector(currentSector, selectedSector);
        const sectorRoadExits = roadExitsForSector(selectedSector);
        const commandTerritory: WorldSectorCommandTerritory | null = showTerritoryCard ? {
            isLive: territoryIsLive,
            isOwned: Boolean(territory.ownerClan),
            ownerLabel: sectorOwnerLabel,
            rebuildMinsLeft: territoryRebuildMinsLeft,
            controlScore: territory.controlScore,
            hp: territory.hp,
            breached: territoryIsBreached(territory),
            breachMinsLeft: territoryBreachMinsLeft(territory),
            rewardsSuspended: territoryRewardsSuspended(territory),
            guards: territory.guards,
            enemyControlled: Boolean(territory.ownerClan && territory.ownerClan !== character.clan && territory.hp > 0),
            ...(villageWar ? {
                war: {
                    playerVillage: character.village,
                    enemyVillage: villageWarEnemy,
                    warGroundHp: villageWar.warGroundHp,
                    warGroundHpMax: VILLAGE_WAR_GROUND_HP_MAX,
                    enemyVillageHp: villageWarEnemy ? villageWar.hp[villageWarEnemy] : 0,
                    enemyVillageHpMax: VILLAGE_WAR_HP_MAX,
                    ended: Boolean(villageWar.endedAt),
                },
            } : {}),
        } : null;
        const commandPlayers: WorldSectorCommandPlayer[] = sectorPlayers.map((player) => {
            const sleeping = Boolean(player.__sleeping);
            const traveling = peerIsTraveling(player);
            const fighting = Boolean(player.inBattle);
            const status: WorldSectorCommandPlayer["status"] = sleeping
                ? "Sleeping"
                : traveling ? "Traveling" : fighting ? "Fighting" : "Ready";
            return {
                target: player,
                name: player.name,
                level: player.level,
                avatarSrc: sharedImages['avatar:' + player.name.toLowerCase()] || (player.character.avatarImage as string) || "",
                status,
                sleeping,
                actionDisabled: traveling || fighting,
            };
        });
        const commandHunt: WorldSectorCommandHunt | null = activeHuntMissionForSector && activeHuntTrailForSector ? {
            targetName: activeHuntAiForSector?.name ?? "Target",
            progress: activeHuntTrailForSector.progress,
            requiredTracks: activeHuntTrailForSector.requiredTracks,
            ready: activeHuntReadyForFight,
        } : null;
        const sectorOverlayWanderers = [
            ...sectorWanderers,
            ...courierWanderers,
            ...bountyHunterWanderers,
            ...mercWanderers,
            ...sageWanderers,
            ...emissaryWanderers,
            ...storyReckoningWanderers,
            ...scribeWanderers,
            ...petMentor.wanderers,
            ...roamingQuestGivers,
        ];
        const sectorOverlayRift = (() => {
            const activeRiftQuest = character.activeRiftQuest;
            if (!activeRiftQuest || selectedSector !== activeRiftQuest.targetSector) return null;
            const rift = hollowRiftById(activeRiftQuest.id);
            if (!rift) return null;
            return {
                landmark: rift.landmark,
                title: `Rift: ${rift.bossName} — descend into the Hollow Gate`,
                onOpen: () => {
                    setCreatorEventPage(0);
                    setCreatorEventLine(0);
                    setSelectedCreatorEvent(riftDescentEvent(rift, ambienceBiomeForSector(selectedSector)));
                },
            };
        })();
        const sectorOverlayVault = (() => {
            if (!anbuViewOpen || (character.level ?? 0) < 100) return null;
            // Prefer the captured owner; fall back to the sector's home village
            // before any sector-war capture, matching the server's ownership fallback.
            const owner = territory.ownerVillage || homeVillageForSector(selectedSector);
            if (!owner || owner === character.village) return null;
            return {
                village: owner,
                onOpen: () => setVaultPrompt({ sector: selectedSector, village: owner }),
            };
        })();
        const sectorOverlayShrine = (() => {
            if (!isSectorTracesEnabled()) return null;
            const definition = shrineForSector(selectedSector);
            return definition ? { definition, tier: sectorTraces?.shrine?.tier ?? 0 } : null;
        })();
        const sectorOverlayBoss = (() => {
            if (!isWeeklyBossRoamEnabled() || !roamingBoss?.aiId || !sectorIsCurrent) return null;
            const roam = weeklyBossRoamState(roamingBoss, serverNow());
            if (!roam?.active || roam.currentSector !== selectedSector) return null;
            if (isWandererOnCooldown(character.wandererCooldowns, weeklyBossRoamCooldownId(roamingBoss.weekKey), serverNow())) return null;
            if ((roamingBoss.attemptsByPlayer?.[character.name.toLowerCase()] ?? 0) >= 3) return null;
            return {
                name: roamingBoss.bossName ?? "Weekly Boss",
                portrait: sharedImages["ai:" + roamingBoss.aiId] || "",
                onEngage: handleBossEngage,
            };
        })();
        const wandererDialogEmissary = !wandererDialog?.msg && wandererDialog?.w.verb === "legacyQuest"
            ? EMISSARY_BY_SLUG.get(wandererDialog.w.archetype as EmissarySlug)
            : undefined;
        const wandererLegacyTrial = legacyAvailable && character.legacy && wandererDialogEmissary ? (
            <EmissaryTrialPanel
                playerName={character.name}
                emissary={wandererDialogEmissary}
                onVersionedCharacter={onVersionedCharacter}
            />
        ) : null;
        const wandererDialogNow = !wandererDialog?.msg && wandererDialog?.w.verb === "quest" ? Date.now() : 0;
        const wandererDialogDayBucket = !wandererDialog?.msg && wandererDialog?.w.verb === "legacyQuest"
            ? currentWandererDayBucket()
            : 0;
        const wandererDialogAtWar = !wandererDialog?.msg && wandererDialog?.w.verb === "quest"
            ? activeVillageWarsFor(character.village).length > 0
            : false;

        return (
            <div className="map-instance">
                {petMentor.guide}
                <div className="instance-frame sector-instance-frame">
                    <WorldSectorCanvas
                        sector={selectedSector}
                        biome={biome}
                        weather={sectorWeather}
                        ambienceBiome={ambienceBiomeForSector(selectedSector)}
                        playerTile={sectorPlayerPos}
                        playerName={character.name}
                        playerAvatarImage={resolveOwnAvatar(character, sharedImages)}
                        isCurrent={sectorIsCurrent}
                        enterDirection={sectorEnterDir}
                        regionSplash={regionSplash}
                        onRegionSplashDone={() => setRegionSplash(null)}
                        mapImage={sectorMapSrc}
                        sceneImage={territory.backgroundImage || sectorBackgroundImage(selectedSector)}
                        sceneDepthImage={territory.backgroundImage ? undefined : sectorDepthImage(selectedSector)}
                        roadExits={sectorRoadExits}
                        showLivePeers={livePeersOn}
                        players={sectorPlayers.map((player) => ({
                            name: player.name,
                            level: player.level,
                            sleeping: Boolean(player.__sleeping),
                            avatarImage: sharedImages['avatar:' + player.name.toLowerCase()] || (player.character.avatarImage as string) || '',
                        }))}
                        sharedImages={sharedImages}
                        sleeperPeers={sleeperPeers}
                        onSelectTile={setSectorPlayerPos}
                        onCrossExit={crossSectorExit}
                        overlayLayer={
                            <>
                            <WorldSectorOverlayLayer
                                biome={ambienceBiomeForSector(selectedSector)}
                                playerTile={sectorPlayerPos}
                                wanderers={sectorIsCurrent ? sectorOverlayWanderers : []}
                                rift={sectorIsCurrent ? sectorOverlayRift : null}
                                vault={sectorIsCurrent ? sectorOverlayVault : null}
                                traceSigns={sectorTraces?.signs ?? []}
                                shrine={sectorOverlayShrine}
                                boss={sectorOverlayBoss}
                                onEngageWanderer={handleWandererEngage}
                                onOpenTrace={(signId) => setTracesModal({ view: "signs", focusSignId: signId })}
                                onOpenShrine={() => setTracesModal({ view: "shrine" })}
                            />
                            {sectorIsCurrent ? petMentor.roadPrompt : null}
                            {tracesModal && sectorTraces && (
                                <SectorTracesModal
                                    state={tracesModal}
                                    traces={sectorTraces}
                                    playerName={character.name}
                                    playerRyo={character.ryo ?? 0}
                                    sectorIsCurrent={sectorIsCurrent}
                                    playerTile={sectorPlayerPos}
                                    onClose={() => setTracesModal(null)}
                                    onTraces={setSectorTraces}
                                    onRyo={(ryo) => updateCharacter(prev => prev ? { ...prev, ryo } : prev)}
                                />
                            )}

                            {/* Anbu Vault — Infiltrate / Retreat prompt (portaled above nav). */}
                            {vaultPrompt && anbuViewOpen && createPortal(
                                <div style={{ position: "fixed", inset: 0, zIndex: 1000000, display: "grid", placeItems: "center", background: "rgba(4,6,12,0.72)" }} onClick={() => setVaultPrompt(null)}>
                                    <div style={{ background: "#141926", border: "1px solid #38405a", borderRadius: 14, padding: "1.1rem 1.2rem", maxWidth: 380, width: "min(92vw, 380px)", textAlign: "center" }} onClick={e => e.stopPropagation()}>
                                        <img src="/landmarks/anbu-vault.webp" alt="" style={{ width: 120, height: 120, objectFit: "contain" }} />
                                        <h3 style={{ margin: "0.3rem 0" }}>{vaultPrompt.village} War Vault</h3>
                                        <p style={{ fontSize: 13, opacity: 0.82, margin: "0.3rem 0 0.8rem" }}>
                                            Their war supplies sit behind that sealed door — and one of their Anbu guards it.
                                            Break through and you can bleed this sector's war economy. If you fall, you leave with nothing.
                                        </p>
                                        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                                            <button
                                                disabled={!anbuAdmissionOpen}
                                                style={{ padding: "0.55rem 1.15rem", opacity: anbuAdmissionOpen ? 1 : 0.55 }}
                                                onClick={() => {
                                                    if (!anbuInfiltrationAdmissionEnabled(mutationAvailability("anbuInfiltration"))) return;
                                                    setVaultRaid(vaultPrompt);
                                                    setVaultPrompt(null);
                                                }}
                                            >{anbuAdmissionOpen ? "Infiltrate" : "Operation paused"}</button>
                                            <button style={{ padding: "0.55rem 1.15rem", opacity: 0.8 }} onClick={() => setVaultPrompt(null)}>Retreat</button>
                                        </div>
                                    </div>
                                </div>,
                                document.body,
                            )}

                            {/* Anbu Vault — the live raid (traverse → Anbu fight → spoils),
                                portaled full-screen so the bottom nav can't paint over it. */}
                            {vaultRaid && createPortal(
                                <div style={{ position: "fixed", inset: 0, zIndex: 1000000, overflowY: "auto", background: "#0a0d15" }}>
                                    {anbuAdmissionOpen ? (
                                        <Suspense fallback={<div style={{ display: "grid", placeItems: "center", minHeight: "100dvh", color: "var(--slate-300)" }}>Slipping past the perimeter…</div>}>
                                            <AnbuVaultRaid
                                                character={character}
                                                sharedImages={sharedImages}
                                                sector={vaultRaid.sector}
                                                targetVillage={vaultRaid.village}
                                                onVersionedCharacter={onVersionedCharacter}
                                                onExit={() => setVaultRaid(null)}
                                            />
                                        </Suspense>
                                    ) : (
                                        <div style={{ display: "grid", placeItems: "center", minHeight: "100dvh", padding: 24 }}>
                                            <div className="card" role="status" style={{ maxWidth: 460, textAlign: "center", padding: 20 }}>
                                                <h3>ANBU operation paused</h3>
                                                <p>The vault run remains recoverable, but traversal, combat, and settlement requests are paused until live admission returns.</p>
                                                <button type="button" onClick={() => setVaultRaid(null)}>Leave operation view</button>
                                            </div>
                                        </div>
                                    )}
                                </div>,
                                document.body,
                            )}

                            {bossDialog && createPortal(
                                <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgba(0,0,0,.6)" }}>
                                    <div className="card" style={{ maxWidth: 380, width: "88%", textAlign: "center", padding: 18, border: "1px solid rgba(236,91,56,.6)" }} onClick={(e) => e.stopPropagation()}>
                                        {bossDialog.portrait
                                            ? <img src={bossDialog.portrait} alt={bossDialog.name} style={{ width: 104, height: 104, objectFit: "cover", borderRadius: "50%", border: "2px solid #ec5b38", margin: "0 auto 8px", boxShadow: "0 0 18px rgba(236,91,56,.6)" }} />
                                            : <div style={{ fontSize: 60, lineHeight: 1, margin: "0 0 6px" }}>👹</div>}
                                        <h3 style={{ margin: "0 0 4px", color: "#ffb4a0" }}>⚔ {bossDialog.name}</h3>
                                        <p style={{ fontSize: ".78rem", color: "#9aa3b2", margin: "0 0 8px" }}>The Weekly Boss bears down on you. Stand and deal all the damage you can for the server-wide leaderboard — or flee (free, no attempt spent).</p>
                                        <p style={{ fontSize: ".72rem", color: "var(--gold)", margin: "0 0 12px" }}>Attempts used: {bossDialog.attemptsUsed}/3</p>
                                        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                                            <button disabled={!globalMutationsOpen} onClick={standBossFight} style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "var(--red-400)", fontWeight: 700, opacity: globalMutationsOpen ? 1 : 0.55 }}>{globalMutationsOpen ? "Stand & Fight" : "Fight paused"}</button>
                                            <button onClick={fleeBoss}>Flee</button>
                                        </div>
                                    </div>
                                </div>,
                                document.body,
                            )}
                            {legacyAvailable && sageChoiceOpen && sageOffer && (
                                <SageOfferModal
                                    key={`${character.name.trim().toLowerCase()}:${sageOffer.spawnedAt}:${sageOffer.status}:${sageOffer.offers.map((entry) => entry.legacyId).join(",")}`}
                                    offer={sageOffer}
                                    playerName={character.name}
                                    actionsAllowed={legacyActionsAvailable}
                                    canMutate={() => capabilityAdmissionAllowed(mutationAvailability("legacy"))}
                                    onVersionedCharacter={onVersionedCharacter}
                                    onClose={() => setSageChoiceOpen(false)}
                                    onDeclined={() => {
                                        setSageOffer(null);
                                        try { window.localStorage?.removeItem("legacy.sage.lastOffer"); } catch { /* best-effort */ }
                                        // The decline cooldown must be COMMUNICATED, not
                                        // silent — the player should know he returns.
                                        setWhisper({
                                            kicker: "The Sage departs",
                                            text: "There is no shame in waiting. Give me a few days on the road — I will find you again.",
                                        });
                                    }}
                                    onDismissed={() => {
                                        // Dead offer (expired/sealed): despawn quietly —
                                        // no "I will find you again" promise here.
                                        setSageOffer(null);
                                        try { window.localStorage?.removeItem("legacy.sage.lastOffer"); } catch { /* best-effort */ }
                                    }}
                                    onAccepted={() => {
                                        setSageOffer(null);
                                        try { window.localStorage?.removeItem("legacy.sage.lastOffer"); } catch { /* best-effort */ }
                                    }}
                                />
                            )}
                            {huntToast && (
                                <WorldToast
                                    key={huntToast.id}
                                    kicker={huntToast.kicker}
                                    text={huntToast.text}
                                    icon={<GiPawPrint size={22} />}
                                    onClose={() => setHuntToast(null)}
                                />
                            )}
                            {travelToast && (
                                <WorldToast
                                    key={travelToast.id}
                                    kicker={travelToast.kicker}
                                    text={travelToast.text}
                                    icon={<GiTrail size={22} />}
                                    onClose={() => setTravelToast(null)}
                                />
                            )}
                            {huntEncounterCard}
                            {whisper && (
                                <SageWhisper
                                    text={whisper.text}
                                    {...(whisper.kicker ? { kicker: whisper.kicker } : {})}
                                    onClose={() => setWhisper(null)}
                                />
                            )}
                            {wandererDialog && createPortal(
                                <ModalDialogScrim label={`${wandererDialog.w.name} — encounter`} onBackdrop={handleWandererBackdropClick} onEscape={dismissWandererDialog}>
                                    <WorldWandererDialog
                                        wandererDialog={wandererDialog}
                                        character={character}
                                        now={wandererDialogNow}
                                        emissaryDayBucket={wandererDialogDayBucket}
                                        atWar={wandererDialogAtWar}
                                        legacyTrial={wandererLegacyTrial}
                                        closeWandererDialog={() => setWandererDialog(null)}
                                        dismissWandererDialog={dismissWandererDialog}
                                        startWandererAttack={startWandererAttack}
                                        startBountyHunterFight={startBountyHunterFight}
                                        tradeWithWanderer={tradeWithWanderer}
                                        askRoadRumor={askRoadRumor}
                                        visitWandererMedic={visitWandererMedic}
                                        startPatrolFight={startPatrolFight}
                                        followTracker={followTracker}
                                        startWandererFavor={startWandererFavor}
                                        claimWandererFavor={claimWandererFavor}
                                        claimWandererGift={claimWandererGift}
                                        startWandererPetDuel={startWandererPetDuel}
                                        startWandererCardDuel={startWandererCardDuel}
                                        chooseEpicOption={chooseEpicOption}
                                        abandonEpic={abandonEpic}
                                        claimEpic={claimEpic}
                                        advanceEpic={advanceEpic}
                                        fightEpicBoss={fightEpicBoss}
                                        claimWandererQuest={claimWandererQuest}
                                        abandonWandererQuest={abandonWandererQuest}
                                        acceptWandererQuest={acceptWandererQuest}
                                        acceptEpic={acceptEpic}
                                        handleStoryReckoningAbandon={handleStoryReckoningAbandon}
                                    />
                                </ModalDialogScrim>,
                                document.body,
                            )}
                            </>
                        }
                        encounterLayer={sectorIsCurrent ? (
                            <>
                            {creatorEvents
                                .filter((event) => event.eventKind !== "visualNovel" && event.targetSector === selectedSector)
                                .map((event) => {
                                    const col = ((event.tileX ?? 0) % 12 + 12) % 12;
                                    const row = ((event.tileY ?? 0) % 12 + 12) % 12;
                                    return (
                                        <button
                                            key={`sector-event-${event.id}`}
                                            className="sector-encounter-marker sector-event-marker"
                                            style={{
                                                gridColumn: `${col + 1} / span 1`,
                                                gridRow: `${row + 1} / span 1`,
                                                alignSelf: "center",
                                                justifySelf: "center",
                                                zIndex: 5,
                                                background: "rgba(2,6,23,.85)",
                                                color: "#f8fafc",
                                                border: "2px solid #fef3c7",
                                                borderRadius: 8,
                                                padding: "4px 6px",
                                                fontSize: 10,
                                                lineHeight: 1.05,
                                                display: "grid",
                                                gap: 1,
                                                textAlign: "center",
                                                cursor: "pointer",
                                                boxShadow: "0 3px 0 rgba(2,6,23,.8), 0 0 16px rgba(0,0,0,.58)",
                                            }}
                                            onClick={() => triggerCreatorEvent(event)}
                                            title={`${event.name} | Lvl ${event.levelReq}`}
                                        >
                                            <strong style={{ color: "var(--gold)", fontSize: 16 }}>{event.icon}</strong>
                                            <span>{event.name}</span>
                                        </button>
                                    );
                                })}

                            {creatorRaids
                                .filter((raid) => raid.targetSector === selectedSector)
                                .map((raid) => {
                                    const col = ((raid.tileX ?? 0) % 12 + 12) % 12;
                                    const row = ((raid.tileY ?? 0) % 12 + 12) % 12;
                                    return (
                                        <button
                                            key={`sector-raid-${raid.id}`}
                                            className="sector-encounter-marker sector-raid-marker"
                                            style={{
                                                gridColumn: `${col + 1} / span 1`,
                                                gridRow: `${row + 1} / span 1`,
                                                alignSelf: "center",
                                                justifySelf: "center",
                                                zIndex: 5,
                                                background: "rgba(60,10,10,.88)",
                                                color: "#fff",
                                                border: "2px solid var(--red-300)",
                                                borderRadius: 8,
                                                padding: "4px 6px",
                                                fontSize: 10,
                                                lineHeight: 1.05,
                                                display: "grid",
                                                gap: 1,
                                                textAlign: "center",
                                                cursor: "pointer",
                                                boxShadow: "0 3px 0 rgba(2,6,23,.8), 0 0 16px rgba(220,38,38,.45)",
                                            }}
                                            onClick={() => {
                                                if (character.level < raid.levelReq) {
                                                    alert(`Requires level ${raid.levelReq}.`);
                                                    return;
                                                }
                                                launchAiGuardRaid(raid.aiProfileId || "", raid.levelReq, raid.targetSector!, () => {
                                                    setCurrentSector(raid.targetSector!);
                                                    setCurrentBiome(raid.biome);
                                                    setCurrentWeather(weatherForBiome(raid.biome));
                                                });
                                            }}
                                            title={`${raid.name} | ${raid.waves} waves | Lvl ${raid.levelReq}`}
                                        >
                                            <strong style={{ color: "var(--red-300)", fontSize: 16 }}>{raid.icon}</strong>
                                            <span>{raid.name}</span>
                                        </button>
                                    );
                                })}
                            </>
                        ) : null}
                    />

                    <WorldSectorCommandPanel
                        sector={selectedSector}
                        present={sectorIsCurrent}
                        biome={biome}
                        weather={sectorWeather}
                        territory={commandTerritory}
                        gathering={isWildSector(selectedSector) ? sectorPoolViewFor(selectedSector, territory.ownerVillage, character.village) : null} intel={sectorIntelPlate}
                        villageWarAdmissionOpen={villageWarAdmissionOpen}
                        traces={sectorTraces}
                        hasLivePlayers={livePlayersHere.length > 0}
                        players={commandPlayers}
                        hunt={commandHunt}
                        onRaidEnemyVillage={handleSelectedSectorVillageWarRaid}
                        onRaidControlledSector={handleSelectedSectorControlledRaid}
                        onOpenSigns={handleOpenSectorSigns}
                        onOpenShrine={handleOpenSectorShrine}
                        onStrikeSleeper={handleSelectedSectorSleeperAttack}
                        onAttackPlayer={handleSelectedSectorPlayerAttack}
                        contract={sectorContract} contractBusy={contractBusy} onClaimContract={() => { void handleClaimContract(); }}
                        onExplore={handleExploreSelectedSector}
                        onFindRicherGround={handleFindRicherGround}
                        onHunt={handleHuntSelectedSector}
                        onRecover={handleRecoverSelectedSector}
                        onLeave={handleLeaveSelectedSector}
                    />
                </div>
                {codexRevealOverlay}
            </div>
        );
    }

    if (selectedVillageTerritory) {
        const loc = selectedVillageTerritory;
        const biome = loc.biome;
        const weather = weatherForBiome(biome);
        // Pick a virtual sector number inside the enemy territory for explore/battle logic
        const virtualSector = villageOutskirtsSector(loc.name) + 4;
        const sectorMapSrc = villageOuterTerritoryMapUrl(loc.name, virtualSector);
        return (
            <div className="map-instance">
                <div className="instance-frame">
                    <main className="tile-scene">
                        <div className="scene-title">
                            <strong>{loc.name} — Outer Territory</strong>
                            <span>{biomeLabel(biome)} | {weatherEffects[weather].name}</span>
                        </div>

                        <div className="pixel-map walkable-sector-map sector-image-map">
                            <SectorMap image={sectorMapSrc} />
                            <SceneAmbience biome={biome} weather={weather} />
                            <SceneCritters biome={biome} />
                            {Array.from({ length: 144 }).map((_, index) => {
                                const isPlayer = index === sectorPlayerPos;
                                return (
                                    <button
                                        key={index}
                                        className={`scene-tile walkable-tile transparent-sector-tile ${isPlayer ? "sector-player-tile" : ""}`}
                                        onClick={() => setSectorPlayerPos(index)}
                                    />
                                );
                            })}

                            <SectorAvatar
                                targetIndex={sectorPlayerPos}
                                sector={virtualSector}
                                avatarImage={resolveOwnAvatar(character, sharedImages)}
                                name={character.name}
                                biome={loc.biome}
                            />
                        </div>
                    </main>

                    <aside className="instance-actions">
                        <h3>{loc.name}</h3>
                        <p className="territory-hostile-tag">⚠️ Hostile Territory</p>
                        <p>{weatherEffects[weather].effect}</p>
                        <button onClick={() => { void exploreSector(virtualSector); }}>Explore Territory</button>
                        <button onClick={() => restInSector(virtualSector)}>Recover</button>

                        {/* Village Guard / Raid */}
                        <div className="territory-guard-section">
                            {territoryGuards.length > 0 ? (
                                <>
                                    <p className="territory-guard-label">🛡️ Village Guarded</p>
                                    {territoryGuards.map(g => (
                                        <p key={g.name} className="territory-guard-name">
                                            {g.name} <span className="territory-guard-lvl">Lv.{g.level}</span>{g.defenseBonusPercent ? <span className="territory-guard-lvl"> DEF +{g.defenseBonusPercent.toFixed(1)}%</span> : null}
                                        </p>
                                    ))}
                                    <button
                                        className="territory-raid-btn"
                                        onClick={async () => {
                                            if (!requireServerSettlement("pvpSession")) return;
                                            const guard = territoryGuards[0];
                                            const createScope = capturePvpCreateScope(character.name);
                                            setCurrentSector(virtualSector);
                                            setCurrentBiome(biome);
                                            setCurrentWeather(weather);

                                            // Fetch guard's actual character data
                                            let guardChar: Character | null = null;
                                            try {
                                                const cr = await fetch('/api/village-guard/challenge', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ attackerCharacter: character, village: loc.name, guardName: guard.name }),
                                                });
                                                if (!createScope.isCurrent()) return;
                                                const data = await cr.json() as { pvp?: boolean; guardCharacter?: unknown; guardLevel?: number; defenseBonusPercent?: number; };
                                                if (data.pvp && data.guardCharacter) guardChar = data.guardCharacter as Character;
                                            } catch { /* ignore */ }

                                            if (!guardChar) guardChar = await fetchSavedPlayerCharacter(guard.name);
                                            if (!createScope.isCurrent()) return;

                                            if (guardChar) {
                                                // Embed jutsu so server can resolve moves
                                                const { captureOwnSaveRead } = await loadOwnSaveRead();
                                                if (!createScope.isCurrent()) return;
                                                const selfReadAnchor = captureOwnSaveRead(character);
                                                const [selfSave, guardSave] = await Promise.all([
                                                    fetchPlayerCombatSave(character.name),
                                                    fetchPlayerCombatSave(guardChar.name),
                                                ]);
                                                if (!createScope.isCurrent()) return;
                                                if (selfSave && await onOwnSaveRead(selfReadAnchor, selfSave.character, selfSave._saveVersion) === "foreign") return;
                                                if (!createScope.isCurrent()) return;
                                                const selfChar = selfSave?.character ?? character;
                                                const selfBloodlines = selfSave?.savedBloodlines?.length ? selfSave.savedBloodlines : savedBloodlines;
                                                const selfCreatorJutsus = selfSave?.creatorJutsus?.length ? [...wmCreatorJutsus, ...selfSave.creatorJutsus] : wmCreatorJutsus;
                                                const p1j = getPvpJutsuLoadout(selfBloodlines, selfCreatorJutsus, selfChar);
                                                const guardSessionChar = guardSave?.character ?? guardChar;
                                                const guardBloodlines = guardSave?.savedBloodlines?.length ? guardSave.savedBloodlines : savedBloodlines;
                                                const guardCreatorJutsus = guardSave?.creatorJutsus?.length ? [...wmCreatorJutsus, ...guardSave.creatorJutsus] : wmCreatorJutsus;
                                                const p2j = getPvpJutsuLoadout(guardBloodlines, guardCreatorJutsus, guardSessionChar);
                                                const createBody = stringifyPvpSessionPayload({ useCurrentVitals: true, requireWorldCoLocation: true, baseRewards: true, rewardSector: virtualSector, ...pvpSessionEnvironment(false, biome, weatherEffects[weather]?.positiveElement, weatherEffects[weather]?.negativeElement), p1Character: { ...selfChar, jutsu: p1j, pvpItems: getPvpItemLoadout(selfChar, getAllItems(wmCreatorItems)), bloodlineMult: getBloodlineMultiplier(selfChar, selfBloodlines), armorFactor: getCharacterArmorFactor(selfChar, getAllItems(wmCreatorItems)), armorRawDR: getCharacterArmorRawDR(selfChar, getAllItems(wmCreatorItems)), itemDamagePct: getEquippedItemBonus(selfChar, getAllItems(wmCreatorItems), "damagePercent") }, p2Character: { ...guardSessionChar, jutsu: p2j, pvpItems: getPvpItemLoadout(guardSessionChar, getAllItems(wmCreatorItems)), bloodlineMult: getBloodlineMultiplier(guardSessionChar, guardBloodlines), armorFactor: getCharacterArmorFactor(guardSessionChar, getAllItems(wmCreatorItems)), armorRawDR: getCharacterArmorRawDR(guardSessionChar, getAllItems(wmCreatorItems)), itemDamagePct: getEquippedItemBonus(guardSessionChar, getAllItems(wmCreatorItems), "damagePercent") } });
                                                setPvpBattleId(pvpStableBattleIdFromRequestBody(createBody));
                                                setPvpRole("p1");
                                                setPvpBattleContext({ mode: "standard", sectorAttack: true, raidKind: "raidPlayer", sector: virtualSector });
                                                const createResult = await createPvpSessionWithRecovery(fetch, character.name, createBody, createScope);
                                                if (!createScope.isCurrent()) return;
                                                if (createResult.kind === "recovered") return void installPendingPvp(createResult.pending);
                                                if (createResult.kind === "rejected") {
                                                    setPvpBattleId("");
                                                    setRaidBattleKind("none");
                                                    alert(createResult.error);
                                                    return;
                                                }
                                                const battleId = createResult.battleId;
                                                setPvpBattleId(battleId);
                                                if (createResult.kind === "ambiguous") {
                                                    setScreen("pvpBattle");
                                                    alert("The guard battle response was interrupted. Reconnecting to the authoritative session…");
                                                    return;
                                                }
                                                try {
                                                    await confirmSectorBattleRegistration(character.name, virtualSector, battleId, createScope);
                                                } catch (error) {
                                                    if (!createScope.isCurrent()) return;
                                                    alert(error instanceof Error ? error.message : "The guard battle is still registering. Retry the same challenge.");
                                                    return;
                                                }
                                                if (!createScope.isCurrent()) return;
                                                setPvpSeedSession(createResult.session);
                                                setScreen("pvpBattle");
                                                fetch('/api/village-guard/challenge', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ attackerCharacter: character, village: loc.name, battleId, guardName: guardSessionChar.name }),
                                                    signal: createScope.signal,
                                                }).then((response) => {
                                                    if (!response.ok && createScope.isCurrent()) alert(`The battle is live, but ${guardSessionChar.name} could not be notified yet.`);
                                                }).catch(() => {});
                                                return;
                                            }

                                            // No guard character — AI fallback
                                            launchAiGuardRaid(pickGuardAi(guard.level, guard.defenseBonusPercent ?? 0), guard.level, virtualSector);
                                        }}
                                    >
                                        🛡️ Challenge Guard
                                    </button>
                                    <p className="hint" style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 2 }}>
                                        Guard online? Real PvP. Guard offline? AI fight.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="territory-guard-label" style={{ color: "var(--slate-600)" }}>Village Undefended</p>
                                    <button onClick={() => {
                                        launchAiGuardRaid(pickGuardAi(character.level), character.level, virtualSector, () => {
                                            setCurrentSector(virtualSector);
                                            setCurrentBiome(biome);
                                            setCurrentWeather(weather);
                                        });
                                    }}>
                                        Raid {loc.name.split(" ")[0]}
                                    </button>
                                </>
                            )}
                        </div>

                        <button onClick={() => setSelectedVillageTerritory(null)}>Leave</button>
                    </aside>
                </div>
            </div>
        );
    }

    if (selectedLandmark) {
        const isCentral = selectedLandmark.type === "central";

        const villageImage =
            selectedLandmark.name === "Ashen Leaf Village" ? houseImg :
                selectedLandmark.name === "Frostfang Village" ? castleImg :
                    selectedLandmark.name === "Stormveil Village" ? towerImg :
                        selectedLandmark.name === "Moonshadow Village" ? moonshadowImage :
                            castleImg;

        return (
            <div className="map-instance">
                <div className="village-full-scene">
                    {!isCentral ? (
                        <img src={villageImage} alt={selectedLandmark.name} />
                    ) : (
                        <div className="central-full-scene">
                            <h1>The Thousand Gates</h1>
                        </div>
                    )}

                    {/* Living preview: time-of-day wash + drifting biome ambience +
                        wildlife behind the menu, so the village breathes while you
                        decide where to go. */}
                    <DayNightSky className="amb-under" />
                    <SceneAmbience className="amb-under" biome={selectedLandmark.biome} weather={weatherForBiome(selectedLandmark.biome)} />
                    <SceneCritters className="amb-under" biome={selectedLandmark.biome} density={0.85} />

                    <div className="village-full-overlay">
                        <h2>{selectedLandmark.name}</h2>
                        <p>{biomeLabel(selectedLandmark.biome)}</p>

                        <div className="menu">
                            {isCentral ? (
                                <button onClick={() => {
                                    setCurrentBiome("central");
                                    setScreen("centralHub");
                                }}>
                                    Enter Central
                                </button>
                            ) : (
                                <button onClick={() => setScreen("village")}>Enter {selectedLandmark.name.split(" ")[0]}</button>
                            )}

                            {isCentral ? (
                                <button onClick={() => { setCurrentBiome("central"); setCurrentWeather(weatherForBiome("central")); setScreen("arena"); }}>
                                    Central Battle
                                </button>
                            ) : (
                                <button onClick={() => {
                                    const outskirtsSector = villageOutskirtsSector(character.village);
                                    setSelectedLandmark(null);
                                    triggerTravelPoint(outskirtsSector);
                                }}>
                                    Outskirts
                                </button>
                            )}

                            <button onClick={() => setSelectedLandmark(null)}>Leave</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="card">
            {wmZoom.active ? (
                <div className="wm-topbar">
                    <BackToVillageButton
                        onClick={() => isWildSector(currentSector) ? setSelectedSector(currentSector) : setScreen("village")}
                        label={isWildSector(currentSector) ? `\u2190 Return to Sector ${currentSector}` : "\u2190 Village"}
                    />
                    <div className="wm-zoom-controls">
                        <button className="wm-zoom-btn" aria-label="Zoom in" onClick={wmZoom.zoomIn}>+</button>
                        <button className="wm-zoom-btn" aria-label="Zoom out" onClick={wmZoom.zoomOut}>−</button>
                        <button className="wm-zoom-btn" aria-label="Reset view" style={{ fontSize: 15 }} onClick={wmZoom.reset}>⤢</button>
                    </div>
                </div>
            ) : (
                <BackToVillageButton
                    onClick={() => isWildSector(currentSector) ? setSelectedSector(currentSector) : setScreen("village")}
                    label={isWildSector(currentSector) ? `\u2190 Return to Sector ${currentSector}` : "\u2190 Village"}
                />
            )}
            {hollowGateMenu && (
                <div onClick={() => setHollowGateMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 8999, background: "rgba(2,6,23,0.8)", display: "grid", placeItems: "center", padding: 16 }}>
                    <div onClick={(e) => e.stopPropagation()} style={{ background: "#160f2b", border: "1px solid #7c3aed", borderRadius: 12, padding: 20, maxWidth: 380, width: "100%", textAlign: "center" }}>
                        <h3 style={{ marginTop: 0, color: "#e9d5ff" }}>⛩ The Hollow Gate</h3>
                        <p style={{ color: "#c4b5fd", fontSize: 14 }}>The broken torii waits. Steel yourself, or attune to the shrine with the Hollow Shards you've torn from its depths.</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {hollowGateEventConfig?.active && (
                                <button
                                    onClick={() => { setHollowGateMenu(false); onEnterHollowGateEvent?.(hollowGateEventConfig); }}
                                    style={{ padding: 8, borderRadius: 8, border: "1px solid #fbbf24", background: "linear-gradient(#b45309,#78350f)", color: "#fef3c7", fontWeight: 700, cursor: "pointer" }}
                                >
                                    ⭐ Event: {hollowGateEventConfig.label || "Event Gate"}
                                    <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: "var(--gold-300)" }}>
                                        {Math.max(1, hollowGateEventConfig.maxFloor ?? 1)} floor{(hollowGateEventConfig.maxFloor ?? 1) === 1 ? "" : "s"}
                                        {hollowGateEventConfig.bossName ? ` · Boss: ${hollowGateEventConfig.bossName}` : ""}
                                        {(hollowGateEventConfig.keyCost ?? 1) === 0 ? " · Free entry" : " · 1 Key"}
                                    </span>
                                </button>
                            )}
                            <button onClick={() => { setHollowGateMenu(false); onEnterHollowGate?.(); }} style={{ padding: 8, borderRadius: 8, border: "none", background: "linear-gradient(#7c3aed,#4c1d95)", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Enter the Shrine</button>
                            <button onClick={() => { setHollowGateMenu(false); setShowAttunement(true); }} style={{ padding: 8, borderRadius: 8, border: "1px solid #7c3aed", background: "transparent", color: "#e9d5ff", cursor: "pointer" }}>💎 Shrine Attunement</button>
                            <button onClick={() => setHollowGateMenu(false)} style={{ padding: 6, borderRadius: 8, border: "1px solid var(--slate-600)", background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
            {showAttunement && <HollowGateAttunement character={character} onClose={() => setShowAttunement(false)} onVersionedCharacter={onVersionedCharacter} />}
            {/* World-map viewport. Legacy: a horizontal-scroll box on narrow
                screens. With worldMapZoom.v1 (mobile default): a fit-to-screen
                pinch / drag zoom surface driven by useWorldMapZoom. */}
            <div
                className="world-map-scroll"
                ref={wmZoom.viewportRef}
                {...wmZoom.viewportHandlers}
            >
            <div
                className="anime-world-map atlas-world-map generated-world-map"
                style={{ backgroundImage: `url(${worldMapBg})`, ...wmZoom.contentStyle }}
            >
                {/* Gentle magical-dust + light-sweep over the whole world (sits
                    behind the z-10 sector/village markers). Keeps the overworld
                    feeling alive without obscuring the painted map. */}
                <SceneAmbience biome="central" intensity={0.5} />
                {/* Real-clock time-of-day wash + a high, sparse bird flock drifting
                    over the atlas. Both sit below the z-10 markers. */}
                <DayNightSky className="amb-under" intensity={0.8} />
                <SceneCritters biome="central" mode="world" className="amb-under" />
                {/* Per-nation biome atmosphere — a soft elemental glow over each
                    homeland so the four regions read at a glance. */}
                {[
                    { c: "volcano", x: 16, y: 20 },
                    { c: "snow", x: 76, y: 20 },
                    { c: "forest", x: 16, y: 74 },
                    { c: "shadow", x: 86, y: 64 },
                    { c: "central", x: 48, y: 40 },
                ].map((g) => (
                    <div key={g.c} className={"world-biome-glow wbg-" + g.c} style={{ left: g.x + "%", top: g.y + "%" }} aria-hidden="true" />
                ))}
                {/* The road graph + region name plates — the connective tissue
                    that makes the scattered sector markers read as one world. */}
                <WorldRoadsOverlay />
                {/* Name plaques for the eight headline places — the 2026-07
                    keyart carries no baked lettering. */}
                <WorldPoiPlates />
                {/* Hovered (or in-flight) walking route from where the player
                    stands — the sandbox-MMO-style "how would I walk there" glow. */}
                <RouteGlowOverlay from={currentSector} to={routeHoverSector} />
                {sectorPoints.map((sector) => {
                    const huntTrail = huntTrailForSector(sector.id);
                    const sectorShrine = isSectorTracesEnabled() ? shrineForSector(sector.id) : undefined;
                    // Resolved ONCE per marker. Both of these are real work — the
                    // richness tier reads the territory row and sizes the pool,
                    // the contract consults the day's board — and the className
                    // and the title each want them, over ~67 markers, every render.
                    const richness = sectorRichnessTier(sector.id);
                    const richnessLabel = sectorRichnessLabel(richness);
                    const contract = localSectorContract(sector.id);
                    const sectorTitle = sector.id === 99
                        ? "Death's Gate - PvP zone: 2x Ryo, stat growth & Jutsu XP, 5% Bone Charm on win"
                        : huntTrail
                            ? `${huntTrail.mission.name} trail | ${sectorName(sector.id) ?? `Sector ${sector.id}`} (S${sector.id})`
                            : `${sectorName(sector.id) ?? `Sector ${sector.id}`} (S${sector.id}) | ${weatherEffects[weatherForSector(sector.id, biomeForSector(sector.id))].name}${sectorShrine ? ` | ⛩ ${sectorShrine.name}` : ""}`;
                    return (
                    <button
                        key={sector.id}
                        className={
                            (sector.id === 99
                                ? "atlas-sector atlas-sector-deaths-gate"
                                : "atlas-sector atlas-sector-" + biomeForSector(sector.id))
                            + (sector.id === weeklyBossSector ? " atlas-sector-weekly-boss" : "")
                            + (huntTrail ? " atlas-sector-hunt-trail" : "")
                            + (sectorShrine ? " atlas-sector-shrine" : "")
                            + (currentSector === sector.id ? " atlas-sector-current" : "")
                            + (academySectorTargetId === sector.id ? " academy-click-target" : "")
                            + ` atlas-sector-pool-${richness}`
                            + (contract ? ` atlas-sector-contract${contract.nightOnly ? " atlas-sector-contract-night" : ""}` : "")
                        }
                        style={{ left: sector.x + "%", top: sector.y + "%", ...sectorMarkerStyle(sector.id) }}
                        data-academy-hint={academySectorTargetId === sector.id ? "Next · travel here" : undefined}
                        data-academy-autoscroll={academySectorTargetId === sector.id ? "true" : undefined}
                        onClick={() => triggerTravelPoint(sector.id)}
                        onMouseEnter={() => setRouteHoverSector(sector.id)}
                        onMouseLeave={() => setRouteHoverSector((current) => (current === sector.id ? null : current))}
                        title={(currentSector === sector.id ? `You are here | ${sectorTitle}` : sectorTitle) + (richnessLabel ? ` | ${richnessLabel}` : "") + (contract ? (contract.nightOnly ? " | Night contract posted today" : " | Contract posted today") : "")}
                        aria-label={currentSector === sector.id
                            ? `You are here, ${sectorName(sector.id) ?? `Sector ${sector.id}`}`
                            : `Travel to ${sectorName(sector.id) ?? `Sector ${sector.id}`} (Sector ${sector.id})`}
                    >
                        {currentSector === sector.id && <span className="atlas-you-label" aria-hidden="true">YOU</span>}
                        {sector.id === 99 ? "💀" : sector.id === FESTIVAL_SECTOR ? "☀️" : sector.id}
                        {scoutedSectors.has(sector.id) && (
                            <span
                                style={{ position: "absolute", top: -5, right: -5, fontSize: 11, lineHeight: 1, filter: "drop-shadow(0 0 2px #000)", pointerEvents: "none" }}
                                title={scoutDotTitle(scoutedSectors.get(sector.id)!, (scoutInfo.tier || 1) as 1 | 2 | 3)}
                            >🔴{scoutedSectors.get(sector.id)!.length > 1 ? scoutedSectors.get(sector.id)!.length : ""}</span>
                        )}
                        {legacyAvailable && sageOffer?.status === "spawned" && sageOffer.sector === sector.id && (
                            <img
                                src="/legacy/sage-marker.webp"
                                alt=""
                                style={{ position: "absolute", top: -12, left: -12, width: 22, height: 22, pointerEvents: "none", filter: "drop-shadow(0 0 5px var(--purple-400))" }}
                                title="A Wandering Sage waits here"
                            />
                        )}
                        {sector.id === weeklyBossSector && (
                            <span
                                className="atlas-boss-flag"
                                title={`${roamingBoss?.bossName ?? "Weekly Boss"} is rampaging here — travel in to challenge it`}
                            >👹</span>
                        )}
                        {huntTrail && (
                            <span
                                className="atlas-hunt-flag"
                                title={`${huntTrail.mission.name} trail is active here`}
                            ><GiPawPrint /></span>
                        )}
                        {academySectorTargetId === sector.id && (
                            <span className="academy-map-target-label" aria-hidden="true">Next · travel here</span>
                        )}
                    </button>
                ); })}

                {/* Village War Map ownership: holder banners + siege pulses over the
                    sector markers. Flag-gated (villageWarMap.v1) + pointer-events:none,
                    so it stays inert/invisible on the default world map. */}
                {warMapOn && <SectorOwnershipOverlay sectorPoints={sectorPoints} />}

                {/* Roaming weekly boss: the boss's current sector NODE is highlighted
                    in-place (pulsing ring + 👹 flag, see weeklyBossSector above and
                    .atlas-sector-weekly-boss in index.css) rather than a floating
                    portrait marker — per owner feedback that the sector highlight
                    alone is enough. The tracker screen still shows the hop countdown. */}

                {/* (War Ground beacons were removed from the world map.
                    The Central Hub banner + the explicit Village War
                    screen already surface active wars; a third overlay
                    on the atlas was cluttering the village markers.) */}

                {locations.map((location) => (
                        <button
                            key={location.name}
                            className={"atlas-landmark atlas-" + location.type + (currentSector === 0 && location.name === character.village ? " atlas-current-location" : "")}
                            style={{
                                left: location.x + "%",
                                top: location.y + "%",
                            }}
                            onClick={() => enterLandmark(location)}
                            title={currentSector === 0 && location.name === character.village ? `You are here | ${location.name}` : location.name}
                            aria-label={currentSector === 0 && location.name === character.village ? `You are here, ${location.name}` : `Enter ${location.name}`}
                            data-landmark-art="true"
                        >
                            {currentSector === 0 && location.name === character.village && <span className="atlas-you-label" aria-hidden="true">YOU</span>}
                            <img className="atlas-landmark-art" src={location.art} alt="" draggable={false} />
                        </button>
                ))}

                {/* (The Hollow Gate Rift structure is deliberately NOT drawn on the
                    world overview. It appears only inside its target sector's scene,
                    so a rift is reachable ONLY by going to the correct sector — see the
                    in-sector render in the sector-stage panel.) */}

                {/* Settlement life — a soft hearth glow + a rising hearth-smoke
                    wisp over each village/Central, so the towns read as lived-in.
                    Pointer-events:none + below the z-10 markers, so clicks are
                    untouched. */}
                {locations.filter((l) => l.type === "village" || l.type === "central").map((l) => (
                    <div key={"poi-life-" + l.name} className="world-poi-life" style={{ left: l.x + "%", top: l.y + "%" }} aria-hidden="true">
                        <span className="world-poi-glow" />
                        <span className="world-poi-smoke" />
                        <span className="world-poi-smoke world-poi-smoke-2" />
                    </div>
                ))}
            </div>
            </div>{/* end world-map-scroll */}
            {wmZoom.active && (
                <div className="wm-village-bar" role="group" aria-label="Jump to region">
                    {WM_CLUSTERS.map((cl) => {
                        const pts = sectorPoints.filter((s) => cl.ids.includes(s.id));
                        if (!pts.length) return null;
                        const cx = pts.reduce((a, s) => a + s.x, 0) / pts.length;
                        const cy = pts.reduce((a, s) => a + s.y, 0) / pts.length;
                        return (
                            <button key={cl.label} className="wm-village-chip" onClick={() => wmZoom.focusPoint(cx, cy, cl.zoom)}>
                                <span className="wm-chip-dot" style={{ background: cl.color }} />{cl.label}
                            </button>
                        );
                    })}
                </div>
            )}


            {/* Atmospheric whispers must also land on the OVERVIEW — the sage
                roll + rumor effects fire on mount, before a sector is opened
                (final-gate finding). SageWhisper portals to <body>, so this
                mount and the sector-view mount can never double-render. */}
            {huntToast && (
                <WorldToast
                    key={huntToast.id}
                    kicker={huntToast.kicker}
                    text={huntToast.text}
                    icon={<GiPawPrint size={22} />}
                    onClose={() => setHuntToast(null)}
                />
            )}
            {travelToast && (
                <WorldToast
                    key={travelToast.id}
                    kicker={travelToast.kicker}
                    text={travelToast.text}
                    icon={<GiTrail size={22} />}
                    onClose={() => setTravelToast(null)}
                />
            )}
            {huntEncounterCard}
            {whisper && (
                <SageWhisper
                    text={whisper.text}
                    {...(whisper.kicker ? { kicker: whisper.kicker } : {})}
                    onClose={() => setWhisper(null)}
                />
            )}
            {codexRevealOverlay}
        </div>
    );
}
