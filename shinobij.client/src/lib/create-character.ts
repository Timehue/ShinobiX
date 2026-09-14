/**
 * Character creation — drained verbatim out of App.tsx (lines 831-949).
 *
 * createCharacter is the client-side first-save grant: the starting vitals,
 * stat pool, currencies, counters and bloodline loadout a brand-new shinobi
 * spawns with. The SERVER owns what actually persists on a first save
 * (api/save/_first-save-baseline.ts, which deliberately mirrors this), so this
 * factory is the local render of that grant — keep the two in step, and treat
 * a change to either as an economy change.
 *
 * createAdminCharacter layers the admin overrides on top of it. It was private
 * to App; App imports it back for the one admin-login call site.
 *
 * Both bodies are byte-identical to the versions that lived in App — only their
 * address changed, plus the `export` createAdminCharacter needed to move. The
 * point of the move is the same as ./normalize-character.ts next door: living
 * here they are directly testable, and importing them no longer drags App's
 * .webp and component CSS (and the node:test ERR_UNKNOWN_FILE_EXTENSION that
 * comes with it) into every consumer.
 *
 * App re-exports createCharacter for the "../App" callers (AdminPanel, the
 * character-creator flow).
 */
import type { Character } from "../types/character";
import type { AdminAccount, JutsuType } from "../types/core";
import { STARTING_STAT_POINTS } from "../constants/game";
import {
    baseStats,
    maxedStats,
    maxChakraForLevel,
    maxHpForLevel,
    maxStaminaForLevel,
} from "./stats";
import { defaultVillageUpgrades } from "./village-upgrades";
import { currentDateKey, currentMonthKey } from "./utils";
import { starterSavedBloodlines } from "../data/jutsu";

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

export function createAdminCharacter(adminName: AdminAccount = "Admin 1"): Character {
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
