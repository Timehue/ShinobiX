/*
 * Clan data shapes — membership, notice board, treasury, upgrades, war
 * records, and the persisted/enhanced clan document.
 *
 * Pure type declarations extracted verbatim from App.tsx (erased at compile
 * time, so this move carries no runtime behavior). These types were App-local
 * (never on the "../App" surface); App.tsx now type-imports them back. Lifting
 * them here unblocks extracting the pure clan-math helpers into lib/.
 */

import type { TreasuryItemStack } from "../lib/items";

export type ClanMemberEntry = {
    name: string; village: string; level: number; specialty: string;
    battleContrib: number; eventContrib: number; missionContrib: number;
    isFounder: boolean; month: string;
};
export type ClanData = {
    name: string; village: string; founderName: string;
    image?: string;
    createdAt: number; members: ClanMemberEntry[];
};
export type ClanJoinRequest = ClanMemberEntry & { requestedAt: number };
export type NoticePostType = "order" | "clan" | "raid" | "guard" | "medic" | "trade" | "general";
export type NoticePost = {
    id: string;
    type: NoticePostType;
    title: string;
    body: string;
    author: string;
    authorRole: string;
    createdAt: number;
    pinned?: boolean;
    sector?: number;
};
export type ClanRole = "Founder" | "Leader" | "Officer" | "Elite Member" | "Member" | "Recruit";
export type ClanUpgradeKey = "trainingGrounds" | "warRoom" | "treasury" | "petDen" | "medicalWing" | "blacksmith" | "scoutNetwork";
export type ClanUpgradeLevels = Record<ClanUpgradeKey, number>;
export type ClanTreasury = { ryo: number; fateShards: number; boneCharms: number; auraStones: number; mythicSeals: number; warSupply: number; items: TreasuryItemStack[]; };
export type ClanTreasuryCurrencyKey = Exclude<keyof ClanTreasury, "items" | "warSupply">;
export type ClanWarRecord = { opponent: string; result: "Won" | "Lost" | "Draw"; finalScore: string; topAttacker: string; topDefender: string; mvpClan: string; reward: string; date: string; endedAt?: number; warCrateId?: string; };
export type EnhancedClanData = ClanData & { level: number; xp: number; treasury: ClanTreasury; upgrades: ClanUpgradeLevels; warHistory: ClanWarRecord[]; activeWar?: { opponentClan: string; enemyVillage: string; ourScore: number; enemyScore: number; startedAt: number; endsAt: number; }; roleOverrides?: Record<string, ClanRole>; joinRequests: ClanJoinRequest[]; notices: NoticePost[]; };
