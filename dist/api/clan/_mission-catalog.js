"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLAN_MISSION_REWARDS = exports.CLAN_MISSION_TARGETS = void 0;
exports.isClanMissionKey = isClanMissionKey;
exports.clanMissionProgressServer = clanMissionProgressServer;
exports.clanXpNeededServer = clanXpNeededServer;
exports.addClanXpServer = addClanXpServer;
// Targets — identical to clanMissionDefinitions[].target on the client.
exports.CLAN_MISSION_TARGETS = {
    battle: 20,
    mission: 50,
    guard: 10,
    territory: 20,
    anbu: 10,
    donation: 25_000,
    training: 100,
    raid: 5,
};
exports.CLAN_MISSION_REWARDS = {
    battle: { clanXp: 450, treasury: { ryo: 2_500 } },
    mission: { clanXp: 650, treasury: { ryo: 3_500 } },
    guard: { clanXp: 500, treasury: { ryo: 2_000 } },
    anbu: { clanXp: 300 },
    donation: { clanXp: 700, treasury: { auraStones: 1 } },
    training: { clanXp: 600 },
    raid: { clanXp: 900, treasury: { mythicSeals: 1 } },
};
function isClanMissionKey(v) {
    return typeof v === 'string' && v in exports.CLAN_MISSION_TARGETS;
}
// Server mirror of clanMissionProgress(data, key). `territories` is the set of
// world:territory:* records (the caller filters/loads them); only this clan's
// owned sectors are considered, matching the client's
// loadAllSectorTerritories().filter(t => t.ownerClan === data.name).
function clanMissionProgressServer(clanRec, clanName, territories, key) {
    const members = Array.isArray(clanRec.members) ? clanRec.members : [];
    const battle = members.reduce((s, m) => s + (Number(m.battleContrib) || 0), 0);
    const mission = members.reduce((s, m) => s + (Number(m.missionContrib) || 0), 0);
    const event = members.reduce((s, m) => s + (Number(m.eventContrib) || 0), 0);
    const owned = territories.filter((t) => String(t.ownerClan ?? '') === clanName);
    const territoryGuards = owned.reduce((sum, t) => sum + (Array.isArray(t.guards) ? t.guards.length : 0), 0);
    const treasuryRyo = Number(clanRec.treasury?.ryo ?? 0) || 0;
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
function clanXpNeededServer(level) {
    return Math.floor(500 + level * 275 + Math.pow(level, 1.22) * 45);
}
function addClanXpServer(xp, level, amount) {
    let nextXp = xp + Math.max(0, Math.floor(amount));
    let nextLevel = level;
    while (nextLevel < 100 && nextXp >= clanXpNeededServer(nextLevel)) {
        nextXp -= clanXpNeededServer(nextLevel);
        nextLevel += 1;
    }
    return { xp: nextXp, level: nextLevel };
}
