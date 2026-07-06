"use strict";
// Public, query-friendly player summary stored in `player:registry`.
//
// This is intentionally a tiny derived index, not a replacement for save:*.
// The full save remains authoritative; this row exists so public leaderboards
// and roster/admin summaries do not need to deserialize every save blob just to
// sort on a handful of display-safe counters.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_INDEX_VERSION = exports.REGISTRY_KEY = void 0;
exports.buildPublicPlayerIndexEntry = buildPublicPlayerIndexEntry;
exports.parsePublicPlayerIndexEntry = parsePublicPlayerIndexEntry;
exports.needsPublicPlayerIndexBackfill = needsPublicPlayerIndexBackfill;
exports.publicPlayerIndexChanged = publicPlayerIndexChanged;
exports.publicIndexToLeaderboardRosterEntry = publicIndexToLeaderboardRosterEntry;
exports.REGISTRY_KEY = 'player:registry';
exports.PUBLIC_INDEX_VERSION = 1;
const NUMBER_FIELDS = [
    { key: 'level', fallback: 1 },
    { key: 'rankedRating', fallback: 1000 },
    { key: 'rankedWins', fallback: 0 },
    { key: 'rankedLosses', fallback: 0 },
    { key: 'petRankedRating', fallback: 1000 },
    { key: 'petRankedWins', fallback: 0 },
    { key: 'petRankedLosses', fallback: 0 },
    { key: 'totalPvpKills', fallback: 0 },
    { key: 'xp', fallback: 0 },
    { key: 'totalPetWins', fallback: 0 },
    { key: 'totalEndlessTowerWins', fallback: 0 },
    { key: 'totalVillageRaids', fallback: 0 },
    { key: 'professionXp', fallback: 0 },
    { key: 'battleTowerBestFloor', fallback: 0 },
    { key: 'battleTowerRating', fallback: 0 },
];
const STRING_FIELDS = ['name', 'village', 'specialty', 'clan'];
const MAX_PUBLIC_NUMBER = 9_000_000_000_000;
function publicString(value, fallback = '') {
    return (typeof value === 'string' ? value : fallback).slice(0, 80);
}
function publicNumber(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(0, Math.min(MAX_PUBLIC_NUMBER, Math.floor(n)));
}
function asRecord(value) {
    return value && typeof value === 'object' ? value : {};
}
function buildPublicPlayerIndexEntry(character, fallbackName, now = Date.now(), lastSeen = now) {
    const char = asRecord(character);
    const displayName = publicString(char.name, fallbackName) || publicString(fallbackName);
    return {
        _publicIndexVersion: exports.PUBLIC_INDEX_VERSION,
        name: displayName,
        level: publicNumber(char.level, 1),
        village: publicString(char.village),
        specialty: publicString(char.specialty),
        clan: publicString(char.clan),
        lastSeen: publicNumber(lastSeen, now),
        rankedRating: publicNumber(char.rankedRating, 1000),
        rankedWins: publicNumber(char.rankedWins, 0),
        rankedLosses: publicNumber(char.rankedLosses, 0),
        petRankedRating: publicNumber(char.petRankedRating, 1000),
        petRankedWins: publicNumber(char.petRankedWins, 0),
        petRankedLosses: publicNumber(char.petRankedLosses, 0),
        totalPvpKills: publicNumber(char.totalPvpKills, 0),
        xp: publicNumber(char.xp, 0),
        totalPetWins: publicNumber(char.totalPetWins, 0),
        totalEndlessTowerWins: publicNumber(char.totalEndlessTowerWins, 0),
        totalVillageRaids: publicNumber(char.totalVillageRaids, 0),
        professionXp: publicNumber(char.professionXp, 0),
        battleTowerBestFloor: publicNumber(char.battleTowerBestFloor, 0),
        battleTowerRating: publicNumber(char.battleTowerRating, 0),
    };
}
function parsePublicPlayerIndexEntry(raw, fallbackName) {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        }
        catch {
            return null;
        }
    }
    const rec = asRecord(value);
    const lastSeen = publicNumber(rec.lastSeen, 0);
    return buildPublicPlayerIndexEntry(rec, fallbackName, Date.now(), lastSeen);
}
function needsPublicPlayerIndexBackfill(raw) {
    const rec = asRecord(typeof raw === 'string' ? tryParse(raw) : raw);
    if (rec._publicIndexVersion !== exports.PUBLIC_INDEX_VERSION)
        return true;
    return NUMBER_FIELDS.some(({ key }) => !(key in rec)) || STRING_FIELDS.some((key) => !(key in rec));
}
function publicPlayerIndexChanged(existingCharacter, next) {
    const existing = existingCharacter ?? {};
    for (const key of STRING_FIELDS) {
        if (publicString(existing[key]) !== next[key])
            return true;
    }
    for (const { key, fallback } of NUMBER_FIELDS) {
        if (publicNumber(existing[key], fallback) !== next[key])
            return true;
    }
    return false;
}
function publicIndexToLeaderboardRosterEntry(entry, online = false) {
    const character = {
        rankedRating: entry.rankedRating,
        rankedWins: entry.rankedWins,
        rankedLosses: entry.rankedLosses,
        petRankedRating: entry.petRankedRating,
        petRankedWins: entry.petRankedWins,
        petRankedLosses: entry.petRankedLosses,
        totalPvpKills: entry.totalPvpKills,
        xp: entry.xp,
        totalPetWins: entry.totalPetWins,
        totalEndlessTowerWins: entry.totalEndlessTowerWins,
        totalVillageRaids: entry.totalVillageRaids,
        professionXp: entry.professionXp,
        battleTowerBestFloor: entry.battleTowerBestFloor,
        battleTowerRating: entry.battleTowerRating,
        clan: entry.clan,
    };
    return {
        name: entry.name,
        level: entry.level,
        village: entry.village,
        specialty: entry.specialty,
        online,
        character,
        lastSeenAt: entry.lastSeen,
    };
}
function tryParse(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
