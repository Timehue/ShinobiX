// Public, query-friendly player summary stored in `player:registry`.
//
// This is intentionally a tiny derived index, not a replacement for save:*.
// The full save remains authoritative; this row exists so public leaderboards
// and roster/admin summaries do not need to deserialize every save blob just to
// sort on a handful of display-safe counters.

export const REGISTRY_KEY = 'player:registry';
export const PUBLIC_INDEX_VERSION = 1;

export type PublicPlayerIndexEntry = {
    _publicIndexVersion: number;
    name: string;
    level: number;
    village: string;
    specialty: string;
    clan: string;
    lastSeen: number;
    rankedRating: number;
    rankedWins: number;
    rankedLosses: number;
    petRankedRating: number;
    petRankedWins: number;
    petRankedLosses: number;
    totalPvpKills: number;
    xp: number;
    totalPetWins: number;
    totalEndlessTowerWins: number;
    totalVillageRaids: number;
    professionXp: number;
    battleTowerBestFloor: number;
    battleTowerRating: number;
};

type NumberField = {
    key: keyof Pick<
        PublicPlayerIndexEntry,
        | 'level'
        | 'rankedRating'
        | 'rankedWins'
        | 'rankedLosses'
        | 'petRankedRating'
        | 'petRankedWins'
        | 'petRankedLosses'
        | 'totalPvpKills'
        | 'xp'
        | 'totalPetWins'
        | 'totalEndlessTowerWins'
        | 'totalVillageRaids'
        | 'professionXp'
        | 'battleTowerBestFloor'
        | 'battleTowerRating'
    >;
    fallback: number;
};

const NUMBER_FIELDS: readonly NumberField[] = [
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

const STRING_FIELDS = ['name', 'village', 'specialty', 'clan'] as const;
const MAX_PUBLIC_NUMBER = 9_000_000_000_000;

function publicString(value: unknown, fallback = ''): string {
    return (typeof value === 'string' ? value : fallback).slice(0, 80);
}

function publicNumber(value: unknown, fallback: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(MAX_PUBLIC_NUMBER, Math.floor(n)));
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function buildPublicPlayerIndexEntry(
    character: unknown,
    fallbackName: string,
    now: number = Date.now(),
    lastSeen: number = now,
): PublicPlayerIndexEntry {
    const char = asRecord(character);
    const displayName = publicString(char.name, fallbackName) || publicString(fallbackName);
    return {
        _publicIndexVersion: PUBLIC_INDEX_VERSION,
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

export function parsePublicPlayerIndexEntry(raw: unknown, fallbackName: string): PublicPlayerIndexEntry | null {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value) as unknown;
        } catch {
            return null;
        }
    }
    const rec = asRecord(value);
    const lastSeen = publicNumber(rec.lastSeen, 0);
    return buildPublicPlayerIndexEntry(rec, fallbackName, Date.now(), lastSeen);
}

export function needsPublicPlayerIndexBackfill(raw: unknown): boolean {
    const rec = asRecord(typeof raw === 'string' ? tryParse(raw) : raw);
    if (rec._publicIndexVersion !== PUBLIC_INDEX_VERSION) return true;
    return NUMBER_FIELDS.some(({ key }) => !(key in rec)) || STRING_FIELDS.some((key) => !(key in rec));
}

export function publicPlayerIndexChanged(existingCharacter: Record<string, unknown> | null, next: PublicPlayerIndexEntry): boolean {
    const existing = existingCharacter ?? {};
    for (const key of STRING_FIELDS) {
        if (publicString(existing[key]) !== next[key]) return true;
    }
    for (const { key, fallback } of NUMBER_FIELDS) {
        if (publicNumber(existing[key], fallback) !== next[key]) return true;
    }
    return false;
}

export function publicIndexToLeaderboardRosterEntry(entry: PublicPlayerIndexEntry, online = false) {
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

function tryParse(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return null;
    }
}
