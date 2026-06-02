/*
 * Pure clan progression / treasury / upgrade math.
 *
 * Dependency-closed pure helpers extracted verbatim from App.tsx (formulas,
 * caps, and the roster-boost tier table — all behavior unchanged). The three
 * impure clan helpers stay in App.tsx: enhanceClanData (calls
 * normalizeNoticePosts), clanRoleOf (calls clanContribTotal), and
 * clanMissionProgress (reads the territory caches via loadAllSectorTerritories).
 */

import { clampNumber } from "./utils";
import { cleanTreasuryItems } from "./items";
import { CLAN_UPGRADE_MAX_LEVEL } from "../constants/clan";
import type { ClanMemberEntry, ClanTreasury, ClanUpgradeKey, ClanUpgradeLevels, ClanWarRecord, EnhancedClanData, ClanRole } from "../types/clan";

export const clanBoostTiers = [
    { min: 3, max: 5, percent: 2 },
    { min: 6, max: 10, percent: 5 },
    { min: 11, max: 15, percent: 7 },
    { min: 16, max: Infinity, percent: 10 },
] as const;
export function defaultClanTreasury(): ClanTreasury { return { ryo: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, warSupply: 0, items: [] }; }
export function defaultClanUpgrades(): ClanUpgradeLevels { return { trainingGrounds: 0, warRoom: 0, treasury: 0, petDen: 0, medicalWing: 0, blacksmith: 0, scoutNetwork: 0 }; }
export function cleanClanTreasury(t?: Partial<ClanTreasury>): ClanTreasury { const base = defaultClanTreasury(); return { ryo: Math.max(0, Math.floor(Number(t?.ryo ?? base.ryo))), fateShards: Math.max(0, Math.floor(Number(t?.fateShards ?? base.fateShards))), boneCharms: Math.max(0, Math.floor(Number(t?.boneCharms ?? base.boneCharms))), auraStones: Math.max(0, Math.floor(Number(t?.auraStones ?? base.auraStones))), mythicSeals: Math.max(0, Math.floor(Number(t?.mythicSeals ?? base.mythicSeals))), warSupply: Math.max(0, Math.floor(Number(t?.warSupply ?? base.warSupply))), items: cleanTreasuryItems(t?.items ?? base.items) }; }
export function cleanClanUpgrades(u?: Partial<ClanUpgradeLevels>): ClanUpgradeLevels { const b = defaultClanUpgrades(); const m = { ...b, ...(u ?? {}) } as ClanUpgradeLevels; (Object.keys(b) as ClanUpgradeKey[]).forEach(k => m[k] = clampNumber(Math.floor(Number(m[k] ?? 0)), 0, CLAN_UPGRADE_MAX_LEVEL)); return m; }
export function defaultClanWarHistory(name: string): ClanWarRecord[] { return [{ opponent: "Iron Lanterns", result: "Won", finalScore: "84 - 61", topAttacker: "Rill", topDefender: "Village Guard", mvpClan: name, reward: "2,500 ryo / 450 Clan XP", date: "Recent Season" }]; }
export function clanXpNeeded(level: number) { return Math.floor(500 + level * 275 + Math.pow(level, 1.22) * 45); }
export function addClanXp(data: EnhancedClanData, amount: number): EnhancedClanData { let next = { ...data, xp: data.xp + Math.max(0, Math.floor(amount)) }; while (next.level < 100 && next.xp >= clanXpNeeded(next.level)) next = { ...next, xp: next.xp - clanXpNeeded(next.level), level: next.level + 1 }; return next; }
export function clanMemberBoostPercent(memberCount: number) { return clanBoostTiers.find(tier => memberCount >= tier.min && memberCount <= tier.max)?.percent ?? 0; }
export function clanUpgradeBonus(data: EnhancedClanData, key: ClanUpgradeKey) { if (key === "trainingGrounds" || key === "scoutNetwork") return clanMemberBoostPercent(data.members.length); return 0; }
export function canManageClan(role: ClanRole) { return role === "Founder" || role === "Leader" || role === "Officer"; }
export function clanHallTier(level: number) { if (level >= 40) return { name: "Legendary Clan Citadel", icon: "🏰", desc: "A mythic fortress known across the shinobi world." }; if (level >= 25) return { name: "War Fortress", icon: "🏰", desc: "Walls, watchtowers, and banners built for war." }; if (level >= 15) return { name: "Hidden Clan Compound", icon: "🏯", desc: "A fortified compound with training yards and sealed rooms." }; if (level >= 7) return { name: "Fortified Dojo", icon: "🏠", desc: "A proper dojo with guard posts and a treasury room." }; return { name: "Empty Clan Camp", icon: "⛺", desc: "A small camp waiting to grow into a feared clan home." }; }
export function clanContribTotal(m: ClanMemberEntry): number {
    return m.battleContrib * 10 + m.eventContrib * 5 + m.missionContrib * 2;
}
export function clanRankOf(member: ClanMemberEntry, members: ClanMemberEntry[], founderName: string): string {
    if (member.name === founderName) return "Clan Head";
    const sorted = [...members].filter(m => m.name !== founderName)
        .sort((a, b) => clanContribTotal(b) - clanContribTotal(a));
    const idx = sorted.findIndex(m => m.name === member.name);
    if (idx < 0) return "Clan Initiate";
    if (idx < 2) return "Clan Elder";
    if (idx < 5) return "Clan Enforcer";
    if (idx < 10) return "Clan Shinobi";
    return "Clan Initiate";
}
