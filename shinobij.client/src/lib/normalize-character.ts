/**
 * Save hydration — drained verbatim out of App.tsx (lines 826-954).
 *
 * normalizeCharacter is what turns a stored save row into a Character the client
 * will render and re-save: it clamps level/vitals to the current curve, rebuilds
 * derived fields, back-fills every counter a older save may not carry, and runs
 * the inventory/pet/village sub-normalizers. Every player load goes through it,
 * so a behaviour change here is a save migration — treat edits accordingly.
 *
 * It is byte-for-byte the function that lived in App; only its address changed.
 * That move matters beyond the line count: lib/pvp-session.ts imported this from
 * "../App", which dragged App's .webp and component CSS into anything that
 * loaded it, and made every dependent module unloadable under node:test
 * (ERR_UNKNOWN_FILE_EXTENSION). Living here, it is directly testable — see
 * ./normalize-character.test.ts — and so is everything that imports it.
 *
 * App re-exports it for the three screens that still `import … from "../App"`.
 */
import type { Character } from "../types/character";
import type { JutsuType } from "../types/core";
import { MAX_LEVEL, STARTING_STAT_POINTS } from "../constants/game";
import {
    maxChakraForLevel,
    maxHpForLevel,
    maxStaminaForLevel,
    normalizeStats,
    rankFromLevel,
} from "./stats";
import { normalizeLoadedVital } from "./loaded-vitals";
import { normalizeInventory } from "./inventory";
import { normalizeVillageUpgrades } from "./village-upgrades";
import { currentDateKey, currentMonthKey } from "./utils";
import { getCharacterElements } from "./elements";
import { deriveStoryTraits } from "./character-progress";
import { normalizePet } from "./pet-roster";
import { villages } from "../data/sectors";

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
