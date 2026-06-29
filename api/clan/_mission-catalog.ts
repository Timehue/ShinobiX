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

export type ClanMissionKey =
    | 'battle' | 'mission' | 'guard' | 'territory'
    | 'anbu' | 'donation' | 'training' | 'raid';

// Targets — identical to clanMissionDefinitions[].target on the client.
export const CLAN_MISSION_TARGETS: Record<ClanMissionKey, number> = {
    battle: 20,
    mission: 50,
    guard: 10,
    territory: 20,
    anbu: 10,
    donation: 25_000,
    training: 100,
    raid: 5,
};

// Concrete one-time rewards, derived from the reward strings already shown on
// the client mission cards. Missions whose advertised reward is purely a
// gameplay nudge with no concrete payout (territory = "+1 Sector claim push")
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
    raid:     { clanXp: 900, treasury: { mythicSeals: 1 } },
};

export function isClanMissionKey(v: unknown): v is ClanMissionKey {
    return typeof v === 'string' && v in CLAN_MISSION_TARGETS;
}

type ClanRec = Record<string, unknown>;
type Member = { battleContrib?: number; missionContrib?: number; eventContrib?: number; level?: number };
type Territory = { ownerClan?: string; guards?: unknown[]; controlScore?: number };

// Server mirror of clanMissionProgress(data, key). `territories` is the set of
// world:territory:* records (the caller filters/loads them); only this clan's
// owned sectors are considered, matching the client's
// loadAllSectorTerritories().filter(t => t.ownerClan === data.name).
export function clanMissionProgressServer(
    clanRec: ClanRec,
    clanName: string,
    territories: Territory[],
    key: ClanMissionKey,
): number {
    const members = Array.isArray(clanRec.members) ? (clanRec.members as Member[]) : [];
    const battle = members.reduce((s, m) => s + (Number(m.battleContrib) || 0), 0);
    const mission = members.reduce((s, m) => s + (Number(m.missionContrib) || 0), 0);
    const event = members.reduce((s, m) => s + (Number(m.eventContrib) || 0), 0);
    const owned = territories.filter((t) => String(t.ownerClan ?? '') === clanName);
    const territoryGuards = owned.reduce((sum, t) => sum + (Array.isArray(t.guards) ? t.guards.length : 0), 0);
    const treasuryRyo = Number((clanRec.treasury as Record<string, unknown> | undefined)?.ryo ?? 0) || 0;

    switch (key) {
        case 'battle': return battle;
        case 'mission': return mission;
        case 'guard': return Math.min(10, territoryGuards + members.filter((m) => (Number(m.level) || 0) >= 5).length);
        case 'territory': return Math.min(20, Math.floor(owned.reduce((sum, t) => sum + (Number(t.controlScore) || 0), 0) / 1000));
        case 'anbu': return Math.min(10, territoryGuards + Math.floor(battle / 5));
        case 'donation': return treasuryRyo;
        case 'training': return Math.min(100, Math.floor((battle + mission + event) * 1.5));
        case 'raid': return Math.min(5, Math.floor(event / 3));
        default: return 0;
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
