/*
 * Clan-mission catalog + server-authoritative progress recompute.
 *
 * Mirrors the client's clanMissionDefinitions (shinobij.client/src/constants/clan.ts)
 * and clanMissionProgress (shinobij.client/src/lib/clan-math.ts). The claim
 * endpoint (api/clan/mission/claim.ts) recomputes progress here from the trusted
 * clan record + the canonical world:territory:* sectors so a crafted client can
 * never claim a clan-treasury / clan-XP reward it hasn't earned. KEEP IN SYNC
 * with those two client sources if the targets/rewards/formulas change.
 */

import { territoryRewardsSuspended } from '../_territory-lifecycle.js';

export type ClanMissionKey =
    | 'battle' | 'mission' | 'guard' | 'territory'
    | 'anbu' | 'donation' | 'training' | 'raid';

// Targets — identical to clanMissionDefinitions[].target on the client.
export const CLAN_MISSION_TARGETS: Record<ClanMissionKey, number> = {
    battle: 20,
    mission: 50,
    guard: 10,
    territory: 1,
    anbu: 10,
    donation: 25_000,
    training: 100,
    raid: 5,
};

// Concrete one-time rewards, derived from the reward strings already shown on
// the client mission cards. Missions whose advertised reward is purely a
// gameplay nudge with no concrete payout (territory = honest prestige milestone)
// are intentionally absent → not claimable, display-only.
export type ClanTreasuryCurrency = 'ryo' | 'fateShards' | 'boneCharms' | 'auraStones' | 'mythicSeals';
export interface ClanMissionReward {
    clanXp: number;
    treasury?: Partial<Record<ClanTreasuryCurrency, number>>;
}
export const CLAN_MISSION_REWARDS: Partial<Record<ClanMissionKey, ClanMissionReward>> = {
    battle:   { clanXp: 450, treasury: { ryo: 2_500 } },
    mission:  { clanXp: 650, treasury: { ryo: 3_500 } },
    guard:    { clanXp: 500, treasury: { ryo: 2_000 } },
    anbu:     { clanXp: 300 },
    donation: { clanXp: 700, treasury: { auraStones: 1 } },
    training: { clanXp: 600 },
    // No Mythic Seal: S-rank is locked and its faucet is zero (economy
    // rebalance 2026-10, I-8). The extra 450 clan XP stands in for it.
    raid:     { clanXp: 1_350 },
};

export function isClanMissionKey(v: unknown): v is ClanMissionKey {
    return typeof v === 'string' && v in CLAN_MISSION_TARGETS;
}

type ClanRec = Record<string, unknown>;
type Member = { name?: string; battleContrib?: number; missionContrib?: number; eventContrib?: number; level?: number; month?: string };
type Territory = Record<string, unknown> & { ownerClan?: string; guards?: unknown[]; controlScore?: number };

/** The UTC month a roster row's counters belong to: the same key
 *  pinMemberCounters (api/_clan-save-validate.ts) and clanPointMonthKey stamp. */
export function clanRosterMonthKey(now: number): string {
    return new Date(now).toISOString().slice(0, 7);
}

export type ClanRosterCounters = { battle: number; mission: number; event: number };

/**
 * A roster row's battle / mission / event counters, counted only when the row
 * belongs to the current month (economy rebalance 2026-10, I-15). A row is only
 * refreshed when its own member writes the clan record, so an idle member's
 * last active month used to keep paying every weekly claim forever. A row with
 * no month stamp counts as stale. Level is not month-gated.
 */
export function memberMonthCounters(member: Member | null | undefined, now: number): ClanRosterCounters {
    if (!member || member.month !== clanRosterMonthKey(now)) return { battle: 0, mission: 0, event: 0 };
    const counter = (value: unknown) => Math.max(0, Number(value) || 0);
    return { battle: counter(member.battleContrib), mission: counter(member.missionContrib), event: counter(member.eventContrib) };
}

/**
 * Credit `amount` event contribution to one roster row from a server writer
 * (ANBU raid wins). A stale row starts the current month from zero first, so
 * the credit counts instead of reviving last month's totals.
 */
export function withRosterEventContrib(member: Record<string, unknown>, amount: number, now: number): Record<string, unknown> {
    const month = clanRosterMonthKey(now);
    const current = member.month === month;
    const counter = (field: string) => current ? Math.max(0, Number(member[field]) || 0) : 0;
    return {
        ...member,
        battleContrib: counter('battleContrib'),
        missionContrib: counter('missionContrib'),
        eventContrib: counter('eventContrib') + Math.max(0, Math.floor(Number(amount) || 0)),
        month,
    };
}

/** A member counts toward `guard` when active in clan battles or missions this month (I-15). */
function activeGuard(member: Member, now: number): boolean {
    const counters = memberMonthCounters(member, now);
    return (Number(member.level) || 0) >= 5 && (counters.battle > 0 || counters.mission > 0);
}

// Server mirror of clanMissionProgress(data, key). `territories` is the set of
// world:territory:* records (the caller filters/loads them); only this clan's
// owned sectors are considered, matching the client's
// loadAllSectorTerritories().filter(t => t.ownerClan === data.name).
export function clanMissionProgressServer(
    clanRec: ClanRec,
    clanName: string,
    territories: Territory[],
    key: ClanMissionKey,
    now: number = Date.now(),
): number {
    const members = Array.isArray(clanRec.members) ? (clanRec.members as Member[]) : [];
    const monthly = members.map((m) => memberMonthCounters(m, now));
    const battle = monthly.reduce((s, m) => s + m.battle, 0);
    const mission = monthly.reduce((s, m) => s + m.mission, 0);
    const event = monthly.reduce((s, m) => s + m.event, 0);
    const owned = territories.filter((t) => String(t.ownerClan ?? '') === clanName
        && !territoryRewardsSuspended(t, now));
    const territoryGuards = owned.reduce((sum, t) => sum + (Array.isArray(t.guards) ? t.guards.length : 0), 0);

    switch (key) {
        case 'battle': return battle;
        case 'mission': return mission;
        case 'guard': return Math.min(10, territoryGuards + members.filter((m) => activeGuard(m, now)).length);
        case 'territory': return Math.min(1, owned.length);
        case 'anbu': return Math.min(10, territoryGuards + Math.floor(battle / 5));
        // This month's donations at 1,000 ryo-equivalent per contribution
        // point (I-15). A standing treasury balance used to pay it every week.
        case 'donation': return event * 1_000;
        case 'training': return Math.min(100, Math.floor((battle + mission + event) * 1.5));
        case 'raid': return Math.min(5, Math.floor(event / 3));
        default: return 0;
    }
}

/**
 * Whether one roster member earns the mission's Clan Points on a claim, from
 * this month's counters only. Clan Points cannot come from donations
 * (DISALLOWED_CLAN_POINT_SOURCES in api/_clan-points.ts), so donation-fed
 * event contribution never qualifies on its own: `anbu` reads battles and
 * guard duty, and `raid` also needs battle or mission activity.
 */
export function clanMissionPointEligible(
    member: Member,
    missionKey: ClanMissionKey,
    isSectorGuard: boolean,
    now: number = Date.now(),
): boolean {
    const { battle, mission, event } = memberMonthCounters(member, now);
    switch (missionKey) {
        case 'battle': return battle > 0;
        case 'mission': return mission > 0;
        case 'guard': return activeGuard(member, now) || isSectorGuard;
        case 'anbu': return battle > 0 || isSectorGuard;
        case 'raid': return event > 0 && (battle > 0 || mission > 0);
        default: return false;
    }
}

// Server mirror of clanXpNeeded / addClanXp (lib/clan-math.ts) so a claim's clan
// XP reward levels the clan up identically to the client.
export function clanXpNeededServer(level: number): number {
    return Math.floor(500 + level * 275 + Math.pow(level, 1.22) * 45);
}
export function addClanXpServer(xp: number, level: number, amount: number): { xp: number; level: number } {
    let nextXp = xp + Math.max(0, Math.floor(amount));
    let nextLevel = level;
    while (nextLevel < 100 && nextXp >= clanXpNeededServer(nextLevel)) {
        nextXp -= clanXpNeededServer(nextLevel);
        nextLevel += 1;
    }
    return { xp: nextXp, level: nextLevel };
}

// Clan-XP rewards are per completed objective, so roster size should not also
// reduce their value. Small clans already complete shared objectives more slowly;
// a second 80% penalty made friendship-sized clans nonviable. KEEP IN SYNC with
// the client mirror in
// shinobij.client/src/lib/clan-math.ts (clanXpMemberScale / scaledClanXp).
export function clanXpMemberScale(memberCount: number): number {
    void memberCount;
    return 1;
}
export function scaledClanXp(amount: number, memberCount: number): number {
    return Math.max(0, Math.floor((Number(amount) || 0) * clanXpMemberScale(memberCount)));
}
