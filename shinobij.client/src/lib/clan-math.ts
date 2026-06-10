/*
 * Pure clan progression / treasury / upgrade math.
 *
 * Dependency-closed pure helpers extracted verbatim from App.tsx (formulas,
 * caps, and the roster-boost tier table — all behavior unchanged). The two
 * remaining impure clan helpers stay in App.tsx: clanRoleOf (calls
 * clanContribTotal) and clanMissionProgress (reads the territory caches via
 * loadAllSectorTerritories). enhanceClanData lives here now that its only
 * App-local dependency (normalizeNoticePosts) moved to ./clan-notices.
 */

import { clampNumber } from "./utils";
import { loadAllSectorTerritories } from "./world-state";
import { cleanTreasuryItems } from "./items";
import { normalizeNoticePosts } from "./clan-notices";
import { CLAN_UPGRADE_MAX_LEVEL } from "../constants/clan";
import type { ClanData, ClanMemberEntry, ClanTreasury, ClanUpgradeKey, ClanUpgradeLevels, ClanWarRecord, EnhancedClanData, ClanRole } from "../types/clan";

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
export function enhanceClanData(data: ClanData & Partial<EnhancedClanData>): EnhancedClanData { return { ...data, level: clampNumber(Math.floor(Number(data.level ?? 1)), 1, 100), xp: Math.max(0, Math.floor(Number(data.xp ?? 0))), treasury: cleanClanTreasury(data.treasury), upgrades: cleanClanUpgrades(data.upgrades), warHistory: data.warHistory?.length ? data.warHistory : defaultClanWarHistory(data.name), activeWar: data.activeWar, roleOverrides: data.roleOverrides ?? {}, joinRequests: (data.joinRequests ?? []).filter((request) => request?.name), notices: normalizeNoticePosts(data.notices) }; }
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

export function clanRoleOf(member: ClanMemberEntry, data: EnhancedClanData): ClanRole { const override = data.roleOverrides?.[member.name]; if (override) return override; if (member.name === data.founderName || member.isFounder) return "Founder"; const sorted = [...data.members].filter(m => m.name !== data.founderName).sort((a, b) => clanContribTotal(b) - clanContribTotal(a)); const idx = sorted.findIndex(m => m.name === member.name); if (idx === 0) return "Leader"; if (idx > 0 && idx <= 2) return "Officer"; if (idx > 2 && idx <= 4) return "Elite Member"; if (clanContribTotal(member) <= 5) return "Recruit"; return "Member"; }

export function clanMissionProgress(data: EnhancedClanData, key: string) { const battle = data.members.reduce((s, m) => s + (m.battleContrib ?? 0), 0); const mission = data.members.reduce((s, m) => s + (m.missionContrib ?? 0), 0); const event = data.members.reduce((s, m) => s + (m.eventContrib ?? 0), 0); const territories = loadAllSectorTerritories().filter(territory => territory.ownerClan === data.name); if (key === "battle") return battle; if (key === "mission") return mission; if (key === "guard") return Math.min(10, territories.reduce((sum, territory) => sum + territory.guards.length, 0) + data.members.filter(m => m.level >= 5).length); if (key === "territory") return Math.min(20, Math.floor(territories.reduce((sum, territory) => sum + territory.controlScore, 0) / 1000)); if (key === "anbu") return Math.min(10, territories.reduce((sum, territory) => sum + territory.guards.length, 0) + Math.floor(battle / 5)); if (key === "donation") return data.treasury.ryo; if (key === "training") return Math.min(100, Math.floor((battle + mission + event) * 1.5)); if (key === "raid") return Math.min(5, Math.floor(event / 3)); return 0; }
// addClanWarPoints removed — replaced by the server-managed Clan War
// system (see api/clan/war/_storage.ts + autoReportClanWarBattleResult
// on the client). The old point-based score tracking lived in
// clanData.activeWar.ourScore and is no longer authoritative.
// Shared tutorial popover — rendered inside both the Clan Hall →
// Wars tab and the Shinobi Council Hall → Clan Battles tab via a "?"
// button next to the title. Keeps the rules in one place so any
// future balance change only has to update this manual.
// ClanWarManual moved to ./components/ClanWarManual.
