/*
 * Creator mission / raid content types — the admin-authored fetch-explore
 * missions and multi-wave raids, plus the shared mission rank scale.
 *
 * Extracted from App.tsx so mission logic + screens can reference them without
 * importing the App module surface.
 */

import type { Biome } from "./core";
import type { CurrencyRewards } from "./character";

export type MissionRank = "Daily" | "D Rank" | "C Rank" | "B Rank" | "A Rank" | "S Rank";

export type CreatorMission = {
    id: string;
    name: string;
    rank: MissionRank;
    description: string;
    type: "fetchExplore";
    aiProfileId?: string;
    targetSector: number;
    tileX?: number;  // tile position within sector (0-143)
    tileY?: number;  // tile position within sector (0-143)
    exploreCount: number;
    raidCount?: number;
    levelReq: number;
    xpReward: number;
    ryoReward: number;
    staminaReward: number;
    currencyRewards?: CurrencyRewards;
    itemRewards?: string[];
};

export type CreatorRaid = {
    id: string;
    name: string;
    biome: Biome;
    targetSector?: number;
    tileX?: number;  // tile position within sector (0-143)
    tileY?: number;  // tile position within sector (0-143)
    icon: string;
    levelReq: number;
    aiProfileId?: string;
    waves: number;
    xpReward: number;
    ryoReward: number;
    staminaReward: number;
    currencyRewards?: CurrencyRewards;
    description: string;
};
