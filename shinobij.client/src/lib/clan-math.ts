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
import { clanUpgradeEffectPercent } from "./clan-upgrades";
import { normalizeDoctrine } from "./clan-doctrines";
import { loadAllSectorTerritories, territoryRewardsSuspended } from "./world-state";
import { cleanTreasuryItems } from "./items";
import { normalizeNoticePosts } from "./clan-notices";
import { CLAN_UPGRADE_MAX_LEVEL } from "../constants/clan";
import type { ClanData, ClanMemberEntry, ClanTreasury, ClanUpgradeKey, ClanUpgradeLevels, ClanWarRecord, EnhancedClanData, ClanRole } from "../types/clan";

// Clan XP objective value by roster size. The authoritative server grants full
// value to every clan; small rosters already complete shared goals more slowly.
// This is deliberately not a character-XP, stat-training, mission-reward, or
// ryo boost.
export const clanXpScaleTiers = [
    { min: 1, max: Infinity, multiplier: 1 },
] as const;
export function defaultClanTreasury(): ClanTreasury { return { ryo: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, warSupply: 0, items: [] }; }
export function defaultClanUpgrades(): ClanUpgradeLevels { return { trainingGrounds: 0, warRoom: 0, treasury: 0, petDen: 0, medicalWing: 0, blacksmith: 0, scoutNetwork: 0 }; }
export function cleanClanTreasury(t?: Partial<ClanTreasury>): ClanTreasury { const base = defaultClanTreasury(); const provisions = t?.provisions === undefined || t?.provisions === null ? undefined : Math.max(0, Math.floor(Number(t.provisions) || 0)); return { ryo: Math.max(0, Math.floor(Number(t?.ryo ?? base.ryo))), fateShards: Math.max(0, Math.floor(Number(t?.fateShards ?? base.fateShards))), boneCharms: Math.max(0, Math.floor(Number(t?.boneCharms ?? base.boneCharms))), auraStones: Math.max(0, Math.floor(Number(t?.auraStones ?? base.auraStones))), mythicSeals: Math.max(0, Math.floor(Number(t?.mythicSeals ?? base.mythicSeals))), warSupply: Math.max(0, Math.floor(Number(t?.warSupply ?? base.warSupply))), ...(provisions !== undefined ? { provisions } : {}), items: cleanTreasuryItems(t?.items ?? base.items) }; }
export function cleanClanUpgrades(u?: Partial<ClanUpgradeLevels>): ClanUpgradeLevels { const b = defaultClanUpgrades(); const m = { ...b, ...(u ?? {}) } as ClanUpgradeLevels; (Object.keys(b) as ClanUpgradeKey[]).forEach(k => m[k] = clampNumber(Math.floor(Number(m[k] ?? 0)), 0, CLAN_UPGRADE_MAX_LEVEL)); return m; }
// No fabricated history — a brand-new clan has fought no wars. Real records are
// appended by the server clan-war system (see api/clan/war/*). Empty renders a
// proper "no wars yet" empty state instead of a fake "Iron Lanterns" victory.
export function defaultClanWarHistory(_name: string): ClanWarRecord[] { return []; }
export function enhanceClanData(data: ClanData & Partial<EnhancedClanData>): EnhancedClanData { return { ...data, doctrine: normalizeDoctrine(data.doctrine), recruitment: typeof data.recruitment === "string" ? data.recruitment.slice(0, 300) : "", level: clampNumber(Math.floor(Number(data.level ?? 1)), 1, 100), xp: Math.max(0, Math.floor(Number(data.xp ?? 0))), treasury: cleanClanTreasury(data.treasury), upgrades: cleanClanUpgrades(data.upgrades), warHistory: data.warHistory?.length ? data.warHistory : defaultClanWarHistory(data.name), activeWar: data.activeWar, roleOverrides: data.roleOverrides ?? {}, joinRequests: (data.joinRequests ?? []).filter((request) => request?.name), notices: normalizeNoticePosts(data.notices) }; }
export function clanXpNeeded(level: number) { return Math.floor(500 + level * 275 + Math.pow(level, 1.22) * 45); }
export function addClanXp(data: EnhancedClanData, amount: number): EnhancedClanData { let next = { ...data, xp: data.xp + Math.max(0, Math.floor(amount)) }; while (next.level < 100 && next.xp >= clanXpNeeded(next.level)) next = { ...next, xp: next.xp - clanXpNeeded(next.level), level: next.level + 1 }; return next; }
// Member-count scaling for clan-XP GAINS — mirrors clanXpMemberScale in
// api/clan/_mission-catalog.ts (server source of truth). Every roster receives
// full value for a completed objective; small clans already progress more slowly
// because fewer members contribute. KEEP IN SYNC with the server.
export function clanXpMemberScale(memberCount: number): number { const n = Math.max(1, Math.floor(Number(memberCount) || 0)); return clanXpScaleTiers.find(tier => n >= tier.min && n <= tier.max)?.multiplier ?? 1; }
export function scaledClanXp(amount: number, memberCount: number): number { return Math.max(0, Math.floor((Number(amount) || 0) * clanXpMemberScale(memberCount))); }
// Percent-point effect of a clan building at its current level, from the
// clan-upgrades table. Flat-HP / recon buildings (War Room, Scout Network)
// return 0 here — they expose their effects via warRoomBonusHp() / scoutIntelTier().
export function clanUpgradeBonus(data: EnhancedClanData, key: ClanUpgradeKey) { return clanUpgradeEffectPercent(key, data.upgrades?.[key] ?? 0); }
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

// Appointed-role model (matches the server: api/_clan-save-validate.ts callerRole
// + api/clan/war/_storage.ts loadClanContext). The founder is always Founder; the
// founder may appoint Leaders/Officers via roleOverrides; everyone else is a
// Member. Roles are NOT auto-derived from contribution any more — contribution is
// shown separately as points. This closes the old client/server disagreement where
// the client silently granted the top contributor "Leader" powers the server never
// recognised.
export function clanRoleOf(member: ClanMemberEntry, data: EnhancedClanData): ClanRole {
    if (member.name === data.founderName || member.isFounder) return "Founder";
    const override = data.roleOverrides?.[member.name];
    if (override === "Leader" || override === "Officer") return override;
    return "Member";
}

// The two weekly clan limits a player sees in the Clan Hall (economy rebalance
// 2026-10, #39). MIRROR: api/clan/treasury/_donation-xp.ts
// CLAN_DONATION_XP_WEEKLY_CAP and api/_clan-points.ts CLAN_POINTS_WEEKLY_CAP;
// both keyed by ISO week, as the server keys them (clanPointWeekKey).
export const CLAN_DONATION_XP_WEEKLY_CAP = 2_000;
export const CLAN_POINTS_WEEKLY_CAP = 1_000;
/** "2026-W43" — MIRROR of clanPointWeekKey in api/_clan-points.ts (ISO week, UTC). */
export function clanWeekKey(now: number = Date.now()): string { const date = new Date(now); const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7); return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`; }
/** Clan XP this player's donations have already earned this ISO week (the server-stamped quota). */
export function clanDonationXpThisWeek(character: object, now: number = Date.now()): number { const quota = (character as { clanDonationXp?: { week?: unknown; weekUsed?: unknown } }).clanDonationXp; return quota && quota.week === clanWeekKey(now) ? Math.max(0, Math.floor(Number(quota.weekUsed) || 0)) : 0; }
/** Clan Points earned toward this ISO week's cap. */
export function clanPointsThisWeek(character: { weeklyClanPoints?: number; weeklyClanPointsWeek?: string }, now: number = Date.now()): number { return character.weeklyClanPointsWeek === clanWeekKey(now) ? Math.max(0, Math.floor(Number(character.weeklyClanPoints) || 0)) : 0; }
// A roster row's counters count only in the month they were stamped — mirrors
// memberMonthCounters in api/clan/_mission-catalog.ts (economy rebalance
// 2026-10, I-15). An idle member's old month no longer feeds the missions.
export function memberMonthCounters(m: Pick<ClanMemberEntry, "battleContrib" | "missionContrib" | "eventContrib" | "month">, now: number = Date.now()) { const current = m.month === new Date(now).toISOString().slice(0, 7); return { battle: current ? Math.max(0, Number(m.battleContrib) || 0) : 0, mission: current ? Math.max(0, Number(m.missionContrib) || 0) : 0, event: current ? Math.max(0, Number(m.eventContrib) || 0) : 0 }; }
export function clanMissionProgress(data: EnhancedClanData, key: string, now: number = Date.now()) { const monthly = data.members.map(m => ({ member: m, ...memberMonthCounters(m, now) })); const battle = monthly.reduce((s, m) => s + m.battle, 0); const mission = monthly.reduce((s, m) => s + m.mission, 0); const event = monthly.reduce((s, m) => s + m.event, 0); const territories = loadAllSectorTerritories().filter(territory => territory.ownerClan === data.name && !territoryRewardsSuspended(territory)); if (key === "battle") return battle; if (key === "mission") return mission; if (key === "guard") return Math.min(10, territories.reduce((sum, territory) => sum + territory.guards.length, 0) + monthly.filter(m => m.member.level >= 5 && (m.battle > 0 || m.mission > 0)).length); if (key === "territory") return Math.min(1, territories.length); if (key === "anbu") return Math.min(10, territories.reduce((sum, territory) => sum + territory.guards.length, 0) + Math.floor(battle / 5)); if (key === "donation") return event * 1000; if (key === "training") return Math.min(100, Math.floor((battle + mission + event) * 1.5)); if (key === "raid") return Math.min(5, Math.floor(event / 3)); return 0; }
// addClanWarPoints removed — replaced by the server-managed Clan War
// system (see api/clan/war/_storage.ts + autoReportClanWarBattleResult
// on the client). The old point-based score tracking lived in
// clanData.activeWar.ourScore and is no longer authoritative.
// Shared tutorial popover — rendered inside both the Clan Hall →
// Wars tab and the Shinobi Council Hall → Clan Battles tab via a "?"
// button next to the title. Keeps the rules in one place so any
// future balance change only has to update this manual.
// ClanWarManual moved to ./components/ClanWarManual.
